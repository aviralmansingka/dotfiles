package herdrsocket

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"time"
)

type Snapshot struct {
	PaneID   string
	Status   string
	Revision int
}

type Event struct {
	PaneID string
	Status string
}

type request struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type Client struct {
	SocketPath     string
	RequestTimeout time.Duration
}

type EventSubscription interface {
	Next() (Event, error)
	Close() error
}

type Subscription struct {
	connection net.Conn
	decoder    *json.Decoder
}

func (c Client) Subscribe(ctx context.Context, paneIDs []string) (EventSubscription, error) {
	if len(paneIDs) == 0 {
		return nil, fmt.Errorf("at least one pane is required")
	}
	connection, err := c.dial(ctx)
	if err != nil {
		return nil, err
	}
	fail := func(err error) (EventSubscription, error) {
		_ = connection.Close()
		return nil, err
	}
	subscriptions := make([]map[string]string, 0, len(paneIDs))
	for _, paneID := range paneIDs {
		subscriptions = append(subscriptions, map[string]string{
			"type":    "pane.agent_status_changed",
			"pane_id": paneID,
		})
	}
	if err := json.NewEncoder(connection).Encode(map[string]any{
		"id":     "atlas-subscribe",
		"method": "events.subscribe",
		"params": map[string]any{"subscriptions": subscriptions},
	}); err != nil {
		return fail(err)
	}
	decoder := json.NewDecoder(bufio.NewReader(connection))
	var acknowledgement struct {
		ID     string `json:"id"`
		Result struct {
			Type string `json:"type"`
		} `json:"result"`
		Error json.RawMessage `json:"error"`
	}
	if err := decoder.Decode(&acknowledgement); err != nil {
		return fail(err)
	}
	if len(acknowledgement.Error) > 0 {
		return fail(fmt.Errorf("events.subscribe: %s", acknowledgement.Error))
	}
	if acknowledgement.ID != "atlas-subscribe" ||
		acknowledgement.Result.Type != "subscription_started" {
		return fail(fmt.Errorf("unexpected events.subscribe acknowledgement"))
	}
	_ = connection.SetDeadline(time.Time{})
	return &Subscription{connection: connection, decoder: decoder}, nil
}

func (c Client) Snapshot(ctx context.Context, paneID string) (Snapshot, error) {
	connection, err := c.dial(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	defer connection.Close()
	if err := json.NewEncoder(connection).Encode(map[string]any{
		"id":     "atlas-agent-get",
		"method": "agent.get",
		"params": map[string]string{"target": paneID},
	}); err != nil {
		return Snapshot{}, err
	}
	var response struct {
		ID     string `json:"id"`
		Result struct {
			Agent struct {
				PaneID      string `json:"pane_id"`
				AgentStatus string `json:"agent_status"`
				Revision    int    `json:"revision"`
			} `json:"agent"`
		} `json:"result"`
		Error json.RawMessage `json:"error"`
	}
	if err := json.NewDecoder(bufio.NewReader(connection)).Decode(&response); err != nil {
		return Snapshot{}, err
	}
	if len(response.Error) > 0 {
		return Snapshot{}, fmt.Errorf("agent.get %s: %s", paneID, response.Error)
	}
	if response.ID != "atlas-agent-get" || response.Result.Agent.PaneID != paneID {
		return Snapshot{}, fmt.Errorf("unexpected agent.get response for %s", paneID)
	}
	return Snapshot{
		PaneID:   response.Result.Agent.PaneID,
		Status:   response.Result.Agent.AgentStatus,
		Revision: response.Result.Agent.Revision,
	}, nil
}

func (c Client) dial(ctx context.Context) (net.Conn, error) {
	if c.SocketPath == "" {
		return nil, fmt.Errorf("Herdr socket path is required")
	}
	connection, err := (&net.Dialer{}).DialContext(ctx, "unix", c.SocketPath)
	if err != nil {
		return nil, err
	}
	timeout := c.RequestTimeout
	if timeout <= 0 {
		timeout = 2 * time.Second
	}
	deadline := time.Now().Add(timeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	if err := connection.SetDeadline(deadline); err != nil {
		_ = connection.Close()
		return nil, err
	}
	return connection, nil
}

func (s *Subscription) Next() (Event, error) {
	var envelope struct {
		Event string `json:"event"`
		Data  struct {
			PaneID      string `json:"pane_id"`
			AgentStatus string `json:"agent_status"`
		} `json:"data"`
	}
	if err := s.decoder.Decode(&envelope); err != nil {
		return Event{}, err
	}
	if envelope.Event != "pane.agent_status_changed" || envelope.Data.PaneID == "" {
		return Event{}, fmt.Errorf("unexpected Herdr subscription event %q", envelope.Event)
	}
	return Event{PaneID: envelope.Data.PaneID, Status: envelope.Data.AgentStatus}, nil
}

func (s *Subscription) Close() error {
	return s.connection.Close()
}
