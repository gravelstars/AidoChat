package secret

import (
	"errors"
	"strings"
	"testing"

	"github.com/zalando/go-keyring"
)

type fakeRing struct {
	service, entry, value string
	err                   error
}

func (f *fakeRing) Set(service, user, password string) error {
	f.service, f.entry, f.value = service, user, password
	return f.err
}
func (f *fakeRing) Get(service, user string) (string, error) {
	f.service, f.entry = service, user
	return f.value, f.err
}
func (f *fakeRing) Delete(service, user string) error {
	f.service, f.entry = service, user
	return f.err
}
func TestNamespaceAndRoundTrip(t *testing.T) {
	f := &fakeRing{}
	s := newStore(f)
	if err := s.Set("p1", "test-secret"); err != nil {
		t.Fatal(err)
	}
	if f.service != "ai-group-chat" || f.entry != "provider:p1" {
		t.Fatal("wrong namespace")
	}
	key, err := s.Get("p1")
	if err != nil || key != "test-secret" {
		t.Fatal("round trip failed")
	}
	if err = s.Delete("p1"); err != nil {
		t.Fatal(err)
	}
}
func TestErrorsNeverExposeKey(t *testing.T) {
	f := &fakeRing{err: errors.New("test-secret")}
	s := newStore(f)
	for _, err := range []error{s.Set("p", "test-secret"), s.Delete("p")} {
		if err == nil || strings.Contains(err.Error(), "test-secret") {
			t.Fatal("key leaked")
		}
	}
	_, err := s.Get("p")
	if err == nil || strings.Contains(err.Error(), "test-secret") {
		t.Fatal("key leaked")
	}
	f.err = keyring.ErrNotFound
	_, err = s.Get("p")
	if !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if err = s.Delete("p"); err != nil {
		t.Fatal("delete must be idempotent")
	}
	if err = s.Set("", "test-secret"); err == nil {
		t.Fatal("accepted missing id")
	}
}
