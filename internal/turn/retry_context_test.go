package turn

import (
	"context"
	"errors"
	"strings"
	"testing"

	"ai-group-chat/internal/domain"
)

func TestSerialRetryDoesNotSeeLaterMember(t *testing.T) {
	o, st, f, events := setup(domain.ModeSerial)
	f.reply["mo"] = func(context.Context, func(string)) error { return errors.New("failed") }
	f.reply["qy"] = say("LATER_REPLY_SHOULD_BE_HIDDEN")
	if _, err := o.Send(context.Background(), "g", "@墨白 @青砚 discuss", nil); err != nil {
		t.Fatal(err)
	}
	waitEnd(t, events)
	f.reply["mo"] = say("retry")
	if err := o.Retry(context.Background(), st.byAuthor("mo").ID); err != nil {
		t.Fatal(err)
	}
	waitEnd(t, events)
	for _, m := range f.reqs["mo"].Messages {
		if strings.Contains(m.Content, "LATER_REPLY_SHOULD_BE_HIDDEN") {
			t.Fatal("retry of first serial responder saw later responder's answer")
		}
	}
}

// 结束事件尚未送达时仍须拒绝新轮次，且 Sink 可以查询 Busy 而不死锁。
func TestTurnEndDeliveredBeforeNextTurnStarts(t *testing.T) {
	for _, operation := range []string{"send", "retry"} {
		t.Run(operation, func(t *testing.T) {
			o, st, f, events := setup(domain.ModeSerial)
			f.reply["mo"] = say("done")
			var failed domain.Message
			if operation == "retry" {
				f.reply["mo"] = func(context.Context, func(string)) error { return errors.New("failed") }
				if _, err := o.Send(context.Background(), "g", "@墨白 original", nil); err != nil {
					t.Fatal(err)
				}
				waitEnd(t, events)
				failed = st.byAuthor("mo")
				f.reply["mo"] = say("done")
			}
			blocked := make(chan struct{})
			releaseEnd := make(chan struct{})
			finished := make(chan struct{})
			sink := o.Emit
			o.Emit = func(e Event) {
				if e.Kind == EventTurnEnd {
					_ = o.Busy(e.GroupID)
					close(blocked)
					<-releaseEnd
				}
				sink(e)
				if e.Kind == EventTurnEnd {
					close(finished)
				}
			}
			if operation == "retry" {
				if err := o.Retry(context.Background(), failed.ID); err != nil {
					t.Fatal(err)
				}
			} else if _, err := o.Send(context.Background(), "g", "@墨白 first", nil); err != nil {
				t.Fatal(err)
			}
			<-blocked
			_, err := o.Send(context.Background(), "g", "second", nil)
			close(releaseEnd)
			<-finished
			waitEnd(t, events)
			if !errors.Is(err, ErrBusy) {
				t.Fatalf("new turn started before previous end reached Sink: %v", err)
			}
		})
	}
}

func TestRetryUsesOriginalModeAfterGroupDefaultChanges(t *testing.T) {
	for _, mode := range []domain.ReplyMode{domain.ModeSerial, domain.ModeParallel} {
		t.Run(string(mode), func(t *testing.T) {
			o, st, f, events := setup(mode)
			f.reply["mo"] = say("EARLIER_MEMBER_REPLY")
			f.reply["qy"] = func(context.Context, func(string)) error { return errors.New("failed") }
			if _, err := o.Send(context.Background(), "g", "@墨白 @青砚 discuss", nil); err != nil {
				t.Fatal(err)
			}
			waitEnd(t, events)
			if mode == domain.ModeSerial {
				st.group.DefaultMode = domain.ModeParallel
			} else {
				st.group.DefaultMode = domain.ModeSerial
			}
			f.reply["qy"] = say("retry")
			if err := o.Retry(context.Background(), st.byAuthor("qy").ID); err != nil {
				t.Fatal(err)
			}
			waitEnd(t, events)
			seen := false
			for _, m := range f.reqs["qy"].Messages {
				seen = seen || strings.Contains(m.Content, "EARLIER_MEMBER_REPLY")
			}
			if seen != (mode == domain.ModeSerial) {
				t.Fatalf("original mode=%s, saw earlier member=%v", mode, seen)
			}
		})
	}
}
