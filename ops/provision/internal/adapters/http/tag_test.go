package httpapi_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// TestCreateRejectsClientSuppliedTailnetTag covers the S03 tag rule at the
// transport: the create body has no field for a tailnet tag, so a request that
// carries one — even the approved value — is refused before the service runs.
func TestCreateRejectsClientSuppliedTailnetTag(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"approved value":   `"tailnet_tag":"tag:aws-host"`,
		"another tag":      `"tailnet_tag":"tag:someone-else"`,
		"tag list":         `"tailnet_tags":["tag:aws-host"]`,
		"single tag field": `"tag":"tag:aws-host"`,
		"advertise tags":   `"advertise_tags":["tag:aws-host"]`,
	}
	for name, field := range cases {
		field := field
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			api := newAPI(t)
			body := strings.TrimSuffix(validCreateBody, "}") + "," + field + "}"
			recorder := api.authorized(http.MethodPost, "/v1/hosts", idemKey, body)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body %s)", recorder.Code, recorder.Body.String())
			}
			payload := decodeObject(t, recorder)
			envelope, _ := payload["error"].(map[string]any)
			message, _ := envelope["message"].(string)
			if !strings.Contains(message, "unknown field") {
				t.Fatalf("message = %q, want an unknown-field refusal", message)
			}
			hosts, err := api.fakes.Store.ListHosts(context.Background())
			if err != nil {
				t.Fatalf("list hosts: %v", err)
			}
			if len(hosts) != 0 {
				t.Fatalf("hosts = %d, want 0: a tag-carrying request must create nothing", len(hosts))
			}
		})
	}
}
