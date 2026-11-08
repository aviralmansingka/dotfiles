package application_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/testsupport/fakes"
)

func enrollmentRequest() application.EnrollRequest {
	return application.EnrollRequest{
		HostID:         "host-0001",
		Name:           "rex-1",
		InstanceID:     "i-0123456789abcdef0",
		PrivateAddress: "10.0.1.23",
		Profile:        "rex",
	}
}

func newEnrollmentService(t *testing.T, tailnet *fakes.Tailnet, enroller *fakes.Enroller) (*application.EnrollmentService, *fakes.Logger) {
	t.Helper()
	logger := &fakes.Logger{}
	service, err := application.NewEnrollmentService(application.EnrollmentDeps{
		Profiles: fakes.Catalog(t),
		Devices:  tailnet,
		Enroller: enroller,
		Logger:   logger,
	})
	if err != nil {
		t.Fatalf("NewEnrollmentService: %v", err)
	}
	return service, logger
}

// TestEnrollResumesAnAlreadyRunningDevice is the retry rule: a device that is
// already up is resumed, and nothing is minted or registered a second time.
func TestEnrollResumesAnAlreadyRunningDevice(t *testing.T) {
	t.Parallel()
	tailnet := fakes.NewTailnet()
	existingID, err := tailnet.Join("rex-1", domain.ApprovedTailnetTag, "key-from-a-previous-attempt")
	if err != nil {
		t.Fatalf("seed device: %v", err)
	}
	enroller := fakes.NewEnroller(tailnet)
	service, logger := newEnrollmentService(t, tailnet, enroller)

	result, err := service.Enroll(context.Background(), enrollmentRequest())
	if err != nil {
		t.Fatalf("Enroll: %v", err)
	}
	if !result.Resumed {
		t.Fatal("Resumed = false, want true for an already running device")
	}
	if result.DeviceID != existingID {
		t.Fatalf("device id = %q, want %q", result.DeviceID, existingID)
	}
	if enroller.CallCount() != 0 {
		t.Fatalf("enroller calls = %d, want 0: a resumed enrollment must not bootstrap again", enroller.CallCount())
	}
	if tailnet.JoinCount() != 1 {
		t.Fatalf("joins = %d, want 1: a retry must not create a second device", tailnet.JoinCount())
	}
	if result.TailnetTag != domain.ApprovedTailnetTag {
		t.Fatalf("tailnet tag = %q, want %q", result.TailnetTag, domain.ApprovedTailnetTag)
	}
	found := false
	for _, line := range logger.Lines() {
		if strings.Contains(line, "host.enroll.resumed") {
			found = true
		}
	}
	if !found {
		t.Fatalf("resume was not logged: %v", logger.Lines())
	}
}

// TestEnrollmentRetryDoesNotCreateASecondDevice runs the first attempt and then
// the retry, and asserts device count rather than only a call count.
func TestEnrollmentRetryDoesNotCreateASecondDevice(t *testing.T) {
	t.Parallel()
	tailnet := fakes.NewTailnet()
	enroller := fakes.NewEnroller(tailnet)
	service, _ := newEnrollmentService(t, tailnet, enroller)

	first, err := service.Enroll(context.Background(), enrollmentRequest())
	if err != nil {
		t.Fatalf("first Enroll: %v", err)
	}
	if first.Resumed {
		t.Fatal("first enrollment reported Resumed = true")
	}
	if enroller.CallCount() != 1 {
		t.Fatalf("enroller calls after the first attempt = %d, want 1", enroller.CallCount())
	}

	second, err := service.Enroll(context.Background(), enrollmentRequest())
	if err != nil {
		t.Fatalf("retry Enroll: %v", err)
	}
	if !second.Resumed {
		t.Fatal("retry reported Resumed = false, want true")
	}
	if second.DeviceID != first.DeviceID {
		t.Fatalf("retry device id = %q, want %q", second.DeviceID, first.DeviceID)
	}
	if enroller.CallCount() != 1 {
		t.Fatalf("enroller calls after the retry = %d, want 1", enroller.CallCount())
	}
	if devices := tailnet.Devices(); len(devices) != 1 {
		t.Fatalf("devices = %d, want 1: a retry must not register a second node", len(devices))
	}
}

// TestRegisteredButNotRunningDeviceIsBootstrapped proves a stale record does not
// count as success: the enrollment retries.
func TestRegisteredButNotRunningDeviceIsBootstrapped(t *testing.T) {
	t.Parallel()
	tailnet := fakes.NewTailnet()
	if _, err := tailnet.Join("rex-1", domain.ApprovedTailnetTag, "key-from-a-failed-attempt"); err != nil {
		t.Fatalf("seed device: %v", err)
	}
	tailnet.SetState("rex-1", "registered")
	enroller := fakes.NewEnroller(tailnet)
	service, _ := newEnrollmentService(t, tailnet, enroller)

	result, err := service.Enroll(context.Background(), enrollmentRequest())
	if err != nil {
		t.Fatalf("Enroll: %v", err)
	}
	if result.Resumed {
		t.Fatal("a registered-but-idle device must not be reported as resumed")
	}
	if enroller.CallCount() != 1 {
		t.Fatalf("enroller calls = %d, want 1", enroller.CallCount())
	}
}

// TestEnrollmentRejectsAClientSuppliedTag is the transport-level half of the tag
// rule: a tag that is not the resolved one never reaches the enroller.
func TestEnrollmentRejectsAClientSuppliedTag(t *testing.T) {
	t.Parallel()
	tailnet := fakes.NewTailnet()
	enroller := fakes.NewEnroller(tailnet)
	service, _ := newEnrollmentService(t, tailnet, enroller)

	request := enrollmentRequest()
	request.TailnetTag = "tag:some-other-fleet"
	if _, err := service.Enroll(context.Background(), request); err == nil {
		t.Fatal("a client-supplied tag must be rejected")
	}
	if enroller.CallCount() != 0 {
		t.Fatal("a rejected tag must not reach the enroller")
	}
	if tailnet.JoinCount() != 0 {
		t.Fatal("a rejected tag must not register a device")
	}

	// The tag the workflow copies back from the plan is the resolved one, and it
	// is not a selection.
	request = enrollmentRequest()
	request.TailnetTag = domain.ApprovedTailnetTag
	if _, err := service.Enroll(context.Background(), request); err != nil {
		t.Fatalf("the resolved tag must be accepted: %v", err)
	}
}

// TestEnrollmentFailsClosedWhenTheDeviceLookupFails proves a lookup error cannot
// fall through to minting, which is the path that would duplicate a device.
func TestEnrollmentFailsClosedWhenTheDeviceLookupFails(t *testing.T) {
	t.Parallel()
	tailnet := fakes.NewTailnet()
	tailnet.FailLookup(errors.New("tailnet api unavailable"))
	enroller := fakes.NewEnroller(tailnet)
	service, _ := newEnrollmentService(t, tailnet, enroller)

	if _, err := service.Enroll(context.Background(), enrollmentRequest()); err == nil {
		t.Fatal("a lookup failure must fail the enrollment")
	}
	if enroller.CallCount() != 0 {
		t.Fatalf("enroller calls = %d, want 0", enroller.CallCount())
	}
}

// TestEnrollmentPassesTheResolvedPlanToTheEnroller proves the tag and the whole
// key policy reach the bootstrap from server-side configuration.
func TestEnrollmentPassesTheResolvedPlanToTheEnroller(t *testing.T) {
	t.Parallel()
	tailnet := fakes.NewTailnet()
	enroller := fakes.NewEnroller(tailnet)
	service, _ := newEnrollmentService(t, tailnet, enroller)

	if _, err := service.Enroll(context.Background(), enrollmentRequest()); err != nil {
		t.Fatalf("Enroll: %v", err)
	}
	requests := enroller.Requests()
	if len(requests) != 1 {
		t.Fatalf("enroller requests = %d, want 1", len(requests))
	}
	if requests[0].TailnetTag != domain.ApprovedTailnetTag {
		t.Fatalf("tag = %q, want %q", requests[0].TailnetTag, domain.ApprovedTailnetTag)
	}
	if requests[0].KeyPolicy != domain.ApprovedAuthKeyPolicy() {
		t.Fatalf("policy = %+v, want %+v", requests[0].KeyPolicy, domain.ApprovedAuthKeyPolicy())
	}
	if requests[0].InstanceID != "i-0123456789abcdef0" {
		t.Fatalf("instance id = %q, want the provider resource", requests[0].InstanceID)
	}
}

// TestEnrollmentRejectsAnUnknownProfile proves an unapproved profile cannot
// resolve a tag.
func TestEnrollmentRejectsAnUnknownProfile(t *testing.T) {
	t.Parallel()
	tailnet := fakes.NewTailnet()
	enroller := fakes.NewEnroller(tailnet)
	service, _ := newEnrollmentService(t, tailnet, enroller)

	request := enrollmentRequest()
	request.Profile = "unsupported"
	if _, err := service.Enroll(context.Background(), request); err == nil {
		t.Fatal("an unapproved profile must be rejected")
	}
	if enroller.CallCount() != 0 {
		t.Fatal("an unapproved profile must not reach the enroller")
	}
}

// TestEnrollmentRequiresADeviceLookup proves the service refuses to run without
// the port the retry rule depends on.
func TestEnrollmentRequiresADeviceLookup(t *testing.T) {
	t.Parallel()
	if _, err := application.NewEnrollmentService(application.EnrollmentDeps{
		Profiles: fakes.Catalog(t),
		Enroller: fakes.NewEnroller(nil),
		Logger:   &fakes.Logger{},
	}); err == nil {
		t.Fatal("a missing device lookup must be refused: without it a retry cannot avoid a second device")
	}
	if _, err := application.NewEnrollmentService(application.EnrollmentDeps{
		Profiles: fakes.Catalog(t),
		Devices:  fakes.NewTailnet(),
		Logger:   &fakes.Logger{},
	}); err == nil {
		t.Fatal("a missing enroller must be refused")
	}
}
