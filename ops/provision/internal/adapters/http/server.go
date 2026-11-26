// Package httpapi is the client-facing transport: Bearer authentication,
// idempotent host creation, job and inventory reads, and asynchronous deletion.
// It binds to loopback by default and is published only through Tailscale Serve.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/aviralmansingka/dotfiles/ops/provision/internal/application"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/domain"
	"github.com/aviralmansingka/dotfiles/ops/provision/internal/ports"
)

const (
	// maxBodyBytes bounds every request body. The largest accepted document is a
	// five-field create request.
	maxBodyBytes = 16 << 10
	// bearerRealm is the challenge realm for missing or invalid credentials.
	bearerRealm = "fleet-provision"
)

// Server serves the v1 API.
type Server struct {
	svc     *application.Service
	log     ports.Logger
	handler http.Handler
}

// New builds the API handler tree.
func New(svc *application.Service, log ports.Logger) (*Server, error) {
	if svc == nil {
		return nil, errors.New("httpapi: service is required")
	}
	if log == nil {
		return nil, errors.New("httpapi: logger is required")
	}
	server := &Server{svc: svc, log: log}
	mux := http.NewServeMux()
	// /healthz is the liveness probe: a probe cannot hold a bearer token, so this
	// route answers without one and reports nothing but the fact that the process
	// is serving. It touches no state.
	mux.HandleFunc("GET /healthz", server.handleHealth)
	mux.HandleFunc("POST /v1/hosts", server.handleCreateHost)
	mux.HandleFunc("GET /v1/hosts", server.handleListHosts)
	mux.HandleFunc("GET /v1/hosts/{id}", server.handleGetHost)
	mux.HandleFunc("DELETE /v1/hosts/{id}", server.handleDeleteHost)
	mux.HandleFunc("GET /v1/jobs/{id}", server.handleGetJob)
	mux.HandleFunc("/", server.handleNotFound)
	server.handler = server.withAuth(mux)
	return server, nil
}

// Handler returns the authenticated handler.
func (s *Server) Handler() http.Handler { return s.handler }

type principalKey struct{}

// withAuth enforces Bearer authentication on every route. A request without a
// valid, unrevoked client token never reaches a handler.
func (s *Server) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.URL.Path == "/healthz" {
			// The liveness probe has no credential to present; only this one route
			// skips the check, and only for the path the mux already limits to GET.
			next.ServeHTTP(w, r)
			return
		}
		token, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok {
			s.unauthorized(w, r, "missing bearer token")
			return
		}
		principal, err := s.svc.Authorize(r.Context(), token)
		if err != nil {
			s.unauthorized(w, r, "invalid or revoked bearer token")
			return
		}
		ctx := context.WithValue(r.Context(), principalKey{}, principal)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// bearerToken extracts a well-formed Bearer credential. The scheme comparison is
// case-insensitive per RFC 7235; whitespace and empty tokens are rejected.
func bearerToken(header string) (string, bool) {
	header = strings.TrimSpace(header)
	if header == "" {
		return "", false
	}
	scheme, token, found := strings.Cut(header, " ")
	if !found || !strings.EqualFold(scheme, "Bearer") {
		return "", false
	}
	token = strings.TrimSpace(token)
	if token == "" || strings.ContainsAny(token, " \t") {
		return "", false
	}
	return token, true
}

func (s *Server) unauthorized(w http.ResponseWriter, r *http.Request, message string) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="`+bearerRealm+`"`)
	s.log.Warn("api.unauthorized", "path", r.URL.Path, "reason", message)
	writeJSON(w, http.StatusUnauthorized, errorResponse{Error: apiError{
		Code:    "unauthorized",
		Message: "authentication required",
	}})
}

func (s *Server) handleCreateHost(w http.ResponseWriter, r *http.Request) {
	principal := principalFrom(r.Context())
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idempotencyKey == "" {
		writeError(w, s.log, domain.Invalid("Idempotency-Key", "header is required"))
		return
	}
	var body createHostRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, s.log, err)
		return
	}
	accepted, err := s.svc.CreateHost(r.Context(), principal, idempotencyKey, body.toDomain())
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusAccepted, acceptedResponse{HostID: accepted.HostID, JobID: accepted.JobID})
}

func (s *Server) handleListHosts(w http.ResponseWriter, r *http.Request) {
	principal := principalFrom(r.Context())
	hosts, err := s.svc.ListHosts(r.Context(), principal)
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	out := make([]hostResponse, 0, len(hosts))
	for _, host := range hosts {
		out = append(out, toHostResponse(host))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleGetHost(w http.ResponseWriter, r *http.Request) {
	principal := principalFrom(r.Context())
	host, err := s.svc.GetHost(r.Context(), principal, r.PathValue("id"))
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, toHostResponse(host))
}

func (s *Server) handleDeleteHost(w http.ResponseWriter, r *http.Request) {
	principal := principalFrom(r.Context())
	accepted, err := s.svc.DeleteHost(r.Context(), principal, r.PathValue("id"))
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusAccepted, acceptedResponse{HostID: accepted.HostID, JobID: accepted.JobID})
}

func (s *Server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	principal := principalFrom(r.Context())
	job, err := s.svc.GetJob(r.Context(), principal, r.PathValue("id"))
	if err != nil {
		writeError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, toJobResponse(job))
}

func (s *Server) handleNotFound(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotFound, errorResponse{Error: apiError{
		Code:    "not_found",
		Message: "no such route",
	}})
}

// handleHealth answers the liveness probe. It reads no state and names no
// dependency, so a green answer means exactly "this process is serving".
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func principalFrom(ctx context.Context) ports.Principal {
	principal, _ := ctx.Value(principalKey{}).(ports.Principal)
	return principal
}

// decodeJSON decodes exactly one JSON object and rejects unknown fields. An
// attempt to smuggle an executable, flake URL, state path, Bao path, or IAM role
// is therefore a 400, not a silently ignored field.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	if contentType := r.Header.Get("Content-Type"); contentType != "" {
		mediaType := contentType
		if idx := strings.IndexByte(mediaType, ';'); idx >= 0 {
			mediaType = mediaType[:idx]
		}
		if !strings.EqualFold(strings.TrimSpace(mediaType), "application/json") {
			return domain.Invalid("Content-Type", "must be application/json")
		}
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return domain.Invalid("body", decodeErrorMessage(err))
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return domain.Invalid("body", "must contain exactly one JSON object")
	}
	return nil
}

func decodeErrorMessage(err error) string {
	var typeErr *json.UnmarshalTypeError
	switch {
	case errors.As(err, &typeErr):
		return "field " + typeErr.Field + " has the wrong type"
	case errors.Is(err, io.EOF):
		return "is required"
	case strings.HasPrefix(err.Error(), "json: unknown field "):
		// The unknown field name comes from the caller's own input.
		return "unknown field " + strings.TrimPrefix(err.Error(), "json: unknown field ") + " is not accepted"
	case strings.Contains(err.Error(), "http: request body too large"):
		return "must be at most 16 KiB"
	default:
		return "malformed JSON"
	}
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}

type errorResponse struct {
	Error apiError `json:"error"`
}

func writeError(w http.ResponseWriter, log ports.Logger, err error) {
	var invalid *domain.ValidationError
	switch {
	case errors.As(err, &invalid):
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: apiError{
			Code:    ports.CodeInvalidRequest,
			Message: domain.SanitizeMessage(invalid.Message),
			Field:   invalid.Field,
		}})
	case errors.Is(err, domain.ErrUnauthorized):
		writeJSON(w, http.StatusUnauthorized, errorResponse{Error: apiError{
			Code:    "unauthorized",
			Message: "authentication required",
		}})
	case errors.Is(err, domain.ErrIdempotencyConflict):
		writeJSON(w, http.StatusConflict, errorResponse{Error: apiError{
			Code:    "idempotency_conflict",
			Message: "Idempotency-Key was already used with a different request body",
		}})
	case errors.Is(err, domain.ErrNotFound):
		writeJSON(w, http.StatusNotFound, errorResponse{Error: apiError{
			Code:    "not_found",
			Message: "resource not found",
		}})
	case errors.Is(err, domain.ErrHostDeleted):
		writeJSON(w, http.StatusConflict, errorResponse{Error: apiError{
			Code:    "host_deleted",
			Message: "host is already deleted",
		}})
	default:
		log.Error("api.internal_error", "error", domain.SanitizeMessage(err.Error()))
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: apiError{
			Code:    "internal_error",
			Message: "internal error",
		}})
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if body == nil {
		return
	}
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(true)
	_ = encoder.Encode(body)
}
