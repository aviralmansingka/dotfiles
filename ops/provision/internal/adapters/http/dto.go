package httpapi

import (
	"time"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
)

// createHostRequest is the complete accepted create body. Unknown JSON fields are
// rejected by the decoder, and this struct has no field for an executable, flake
// URL, state path, Bao path, IAM role, tag, instance type, or disk size, so those
// values cannot arrive at all.
type createHostRequest struct {
	Provider string `json:"provider"`
	Name     string `json:"name"`
	Profile  string `json:"profile"`
	Region   string `json:"region"`
	Size     string `json:"size"`
}

func (r createHostRequest) toDomain() domain.CreateHostRequest {
	return domain.CreateHostRequest{
		Provider: r.Provider,
		Name:     r.Name,
		Profile:  r.Profile,
		Region:   r.Region,
		Size:     r.Size,
	}
}

type acceptedResponse struct {
	HostID string `json:"host_id"`
	JobID  string `json:"job_id"`
}

type jobErrorResponse struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type jobResponse struct {
	JobID     string            `json:"job_id"`
	HostID    string            `json:"host_id"`
	Kind      string            `json:"kind"`
	State     string            `json:"state"`
	Stage     string            `json:"stage"`
	Error     *jobErrorResponse `json:"error"`
	Retryable bool              `json:"retryable"`
	RunID     string            `json:"run_id,omitempty"`
	CreatedAt string            `json:"created_at,omitempty"`
	UpdatedAt string            `json:"updated_at,omitempty"`
}

func toJobResponse(job application.JobView) jobResponse {
	response := jobResponse{
		JobID:     job.JobID,
		HostID:    job.HostID,
		Kind:      string(job.Kind),
		State:     string(job.State),
		Stage:     string(job.Stage),
		RunID:     job.RunID,
		CreatedAt: formatTime(job.CreatedAt),
		UpdatedAt: formatTime(job.UpdatedAt),
	}
	if job.Error != nil {
		response.Error = &jobErrorResponse{
			Code:      job.Error.Code,
			Message:   job.Error.Message,
			Retryable: job.Error.Retryable,
		}
		response.Retryable = job.Error.Retryable
	}
	return response
}

type hostResponse struct {
	HostID         string            `json:"host_id"`
	Name           string            `json:"name"`
	Provider       string            `json:"provider"`
	Profile        string            `json:"profile"`
	Region         string            `json:"region"`
	Size           string            `json:"size"`
	State          string            `json:"state"`
	JobID          string            `json:"job_id"`
	FlakeRevision  string            `json:"flake_revision"`
	PrivateAddress string            `json:"private_address"`
	RexURL         string            `json:"rex_url"`
	Ready          bool              `json:"ready"`
	Tags           map[string]string `json:"tags,omitempty"`
	CreatedAt      string            `json:"created_at,omitempty"`
	UpdatedAt      string            `json:"updated_at,omitempty"`
}

func toHostResponse(host domain.Host) hostResponse {
	return hostResponse{
		HostID:         host.ID,
		Name:           host.Name,
		Provider:       string(host.Provider),
		Profile:        host.Profile,
		Region:         host.Region,
		Size:           host.Size,
		State:          string(host.State),
		JobID:          host.JobID,
		FlakeRevision:  host.FlakeRevision,
		PrivateAddress: host.PrivateAddress,
		RexURL:         host.RexURL,
		Ready:          host.State == domain.HostStateReady,
		Tags:           host.Tags,
		CreatedAt:      formatTime(host.CreatedAt),
		UpdatedAt:      formatTime(host.UpdatedAt),
	}
}

func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}
