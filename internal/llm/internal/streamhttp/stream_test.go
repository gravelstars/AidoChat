package streamhttp

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSSEFraming(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, ": ping\r\nevent: custom\r\ndata: first\r\ndata: second\r\n\r\ndata: done\n\n")
	}))
	defer s.Close()
	c := NewClient()
	req, _ := http.NewRequest("POST", s.URL, nil)
	var events []Event
	err := c.Stream(context.Background(), req, func(e Event) (bool, error) { events = append(events, e); return e.Data == "done", nil })
	if err != nil || len(events) != 2 || events[0].Name != "custom" || events[0].Data != "first\nsecond" {
		t.Fatalf("%+v %v", events, err)
	}
}
func TestIdleTimeoutAndHeartbeat(t *testing.T) {
	for _, heartbeat := range []bool{false, true} {
		t.Run(fmt.Sprint(heartbeat), func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				w.(http.Flusher).Flush()
				if !heartbeat {
					<-r.Context().Done()
					return
				}
				for i := 0; i < 5; i++ {
					select {
					case <-r.Context().Done():
						return
					case <-time.After(15 * time.Millisecond):
						fmt.Fprint(w, ": ping\n\n")
						w.(http.Flusher).Flush()
					}
				}
				fmt.Fprint(w, "data: done\n\n")
			}))
			defer s.Close()
			c := NewClient()
			c.IdleTimeout = 60 * time.Millisecond
			req, _ := http.NewRequest("POST", s.URL, nil)
			err := c.Stream(context.Background(), req, func(e Event) (bool, error) { return e.Data == "done", nil })
			if heartbeat && err != nil {
				t.Fatal(err)
			}
			if !heartbeat && !errors.Is(err, ErrIdleTimeout) {
				t.Fatalf("want idle timeout: %v", err)
			}
		})
	}
}
func TestHeadersTimeoutAndRedirect(t *testing.T) {
	c := NewClient()
	transport := c.HTTP.Transport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 30 * time.Millisecond
	c.HTTP.Transport = transport
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer s.Close()
	req, _ := http.NewRequest("POST", s.URL, nil)
	if err := c.Stream(context.Background(), req, func(Event) (bool, error) { return false, nil }); err == nil || !strings.Contains(err.Error(), "超时") {
		t.Fatal(err)
	}
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("must not redirect credentials") }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()
	req, _ = http.NewRequest("POST", redirect.URL, nil)
	if err := NewClient().Stream(context.Background(), req, func(Event) (bool, error) { return false, nil }); err == nil {
		t.Fatal("accepted redirect")
	}
}
func TestEndpointValidation(t *testing.T) {
	for _, base := range []string{"file:///tmp/key", "https://user:password@example.com/v1", "https://example.com/v1?key=secret", "/v1"} {
		if _, err := Endpoint(base, "/chat/completions"); err == nil {
			t.Fatal("accepted invalid base")
		}
	}
}

func TestCancelStopsBufferedEvents(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: first\n\ndata: second\n\ndata: done\n\n")
	}))
	defer s.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request, _ := http.NewRequest("POST", s.URL, nil)
	var seen []string
	err := NewClient().Stream(ctx, request, func(e Event) (bool, error) { seen = append(seen, e.Data); cancel(); return e.Data == "done", nil })
	if !errors.Is(err, context.Canceled) || len(seen) != 1 {
		t.Fatalf("events after cancel: %v %v", seen, err)
	}
}
