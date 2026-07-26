package herdrsocket

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestV09ClientUsesHerdr071SubscriptionAndAgentGetShapes(t *testing.T) {
	socketPath := shortSocketPath(t)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	requests := make(chan request, 2)
	serverErr := make(chan error, 1)
	go func() {
		subscription, err := listener.Accept()
		if err != nil {
			serverErr <- err
			return
		}
		defer subscription.Close()
		var subscribe request
		if err := json.NewDecoder(subscription).Decode(&subscribe); err != nil {
			serverErr <- err
			return
		}
		requests <- subscribe
		if _, err := subscription.Write([]byte(
			`{"id":"atlas-subscribe","result":{"type":"subscription_started"}}` + "\n",
		)); err != nil {
			serverErr <- err
			return
		}

		snapshot, err := listener.Accept()
		if err != nil {
			serverErr <- err
			return
		}
		defer snapshot.Close()
		var get request
		if err := json.NewDecoder(snapshot).Decode(&get); err != nil {
			serverErr <- err
			return
		}
		requests <- get
		if _, err := snapshot.Write([]byte(
			`{"id":"atlas-agent-get","result":{"type":"agent_info","agent":{"pane_id":"w2R:pF","agent_status":"working","revision":41}}}` + "\n",
		)); err != nil {
			serverErr <- err
			return
		}
		_, err = subscription.Write([]byte(
			`{"event":"pane.agent_status_changed","data":{"pane_id":"w2R:pF","workspace_id":"w2R","agent_status":"idle","agent":"codex"}}` + "\n",
		))
		serverErr <- err
	}()

	client := Client{SocketPath: socketPath}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	subscription, err := client.Subscribe(ctx, []string{"w2R:pF"})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Close()
	snapshot, err := client.Snapshot(ctx, "w2R:pF")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.PaneID != "w2R:pF" || snapshot.Status != "working" || snapshot.Revision != 41 {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}
	event, err := subscription.Next()
	if err != nil {
		t.Fatal(err)
	}
	if event.PaneID != "w2R:pF" {
		t.Fatalf("unexpected event: %#v", event)
	}

	subscribe := <-requests
	if subscribe.Method != "events.subscribe" {
		t.Fatalf("first request was %q, want events.subscribe", subscribe.Method)
	}
	var params struct {
		Subscriptions []struct {
			Type   string `json:"type"`
			PaneID string `json:"pane_id"`
		} `json:"subscriptions"`
	}
	if err := json.Unmarshal(subscribe.Params, &params); err != nil {
		t.Fatal(err)
	}
	if len(params.Subscriptions) != 1 ||
		params.Subscriptions[0].Type != "pane.agent_status_changed" ||
		params.Subscriptions[0].PaneID != "w2R:pF" {
		t.Fatalf("unexpected subscriptions: %#v", params.Subscriptions)
	}
	get := <-requests
	if get.Method != "agent.get" {
		t.Fatalf("second request was %q, want agent.get", get.Method)
	}
	var target struct {
		Target string `json:"target"`
	}
	if err := json.Unmarshal(get.Params, &target); err != nil {
		t.Fatal(err)
	}
	if target.Target != "w2R:pF" {
		t.Fatalf("agent.get target = %q", target.Target)
	}
	if err := <-serverErr; err != nil {
		t.Fatal(err)
	}
}

func TestV09ClientRejectsMalformedSubscriptionAck(t *testing.T) {
	socketPath := shortSocketPath(t)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer connection.Close()
		_, _ = bufio.NewReader(connection).ReadBytes('\n')
		_, _ = connection.Write([]byte(`{"id":"atlas-subscribe","result":{"type":"ok"}}` + "\n"))
	}()

	client := Client{SocketPath: socketPath}
	if _, err := client.Subscribe(context.Background(), []string{"w2R:pF"}); err == nil {
		t.Fatal("malformed subscription acknowledgement was accepted")
	}
}

func TestV09ClientBoundsAnUnresponsiveSocket(t *testing.T) {
	socketPath := shortSocketPath(t)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	accepted := make(chan struct{})
	release := make(chan struct{})
	defer close(release)
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer connection.Close()
		close(accepted)
		_, _ = bufio.NewReader(connection).ReadBytes('\n')
		<-release
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	client := Client{SocketPath: socketPath}
	started := time.Now()
	if _, err := client.Subscribe(ctx, []string{"w2R:pF"}); err == nil {
		t.Fatal("unresponsive socket did not time out")
	}
	if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
		t.Fatalf("context deadline took %s to surface", elapsed)
	}
	<-accepted
}

func shortSocketPath(t *testing.T) string {
	t.Helper()
	directory, err := os.MkdirTemp("/tmp", "vh-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	return filepath.Join(directory, "herdr.sock")
}
