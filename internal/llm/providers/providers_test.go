package providers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ai-group-chat/internal/domain"
	"ai-group-chat/internal/llm"
	"ai-group-chat/internal/secret"
	"ai-group-chat/internal/turn"
)

func TestFactoryReadsCanonicalSecretAndDispatches(t *testing.T) {
	for _, kind := range []string{"openai", "anthropic"} {
		t.Run(kind, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				header := "Authorization"
				want := "Bearer test-secret"
				if kind == "anthropic" {
					header = "x-api-key"
					want = "test-secret"
				}
				if r.Header.Get(header) != want {
					t.Error("key not used")
				}
				w.Header().Set("Content-Type", "text/event-stream")
				if kind == "openai" {
					fmt.Fprint(w, "data: [DONE]\n\n")
				} else {
					fmt.Fprint(w, "data: {\"type\":\"message_stop\"}\n\n")
				}
			}))
			defer s.Close()
			var factory turn.Providers = New(func(id string) (string, error) {
				if id != "p1" {
					t.Error("wrong secret id")
				}
				return "test-secret", nil
			})
			p, err := factory(context.Background(), domain.Provider{ID: "p1", Kind: kind, BaseURL: s.URL, KeyRef: "provider:p1"})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = p.Stream(context.Background(), llm.Request{Model: "m"}, nil); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestFactoryMissingKeyErrorsAndCancellation(t *testing.T) {
	missing := New(func(string) (string, error) { return "", secret.ErrNotFound })
	if _, err := missing(context.Background(), domain.Provider{ID: "p", Kind: "openai", BaseURL: "http://localhost:11434/v1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := missing(context.Background(), domain.Provider{ID: "p", Kind: "anthropic"}); !errors.Is(err, secret.ErrNotFound) {
		t.Fatal(err)
	}
	bad := New(func(string) (string, error) { return "", errors.New("test-secret") })
	if _, err := bad(context.Background(), domain.Provider{ID: "p", Kind: "openai", KeyRef: "provider:p"}); err == nil || strings.Contains(err.Error(), "test-secret") {
		t.Fatal("leaked secret")
	}
	for _, p := range []domain.Provider{{ID: "p", Kind: "unknown"}, {ID: "p", Kind: "openai", KeyRef: "provider:other"}} {
		if _, err := missing(context.Background(), p); err == nil {
			t.Fatal("accepted invalid config")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := missing(ctx, domain.Provider{ID: "p", Kind: "openai"}); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestKeylessEndpointDoesNotReadKeyring(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("unexpected key")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer s.Close()
	calls := 0
	factory := New(func(string) (string, error) { calls++; return "", secret.ErrUnavailable })
	p, err := factory(context.Background(), domain.Provider{ID: "ollama", Kind: "openai", BaseURL: s.URL})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = p.Stream(context.Background(), llm.Request{Model: "local"}, nil); err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Fatal("keyless endpoint accessed keyring")
	}
	_, err = factory(context.Background(), domain.Provider{ID: "cloud", Kind: "openai", KeyRef: "provider:cloud"})
	if !errors.Is(err, secret.ErrUnavailable) || calls != 1 {
		t.Fatalf("configured keyring failure must propagate: %v calls=%d", err, calls)
	}
}
