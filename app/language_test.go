package app

import (
	"context"
	"strings"
	"testing"
)

func TestLanguageSettingAndSystemMessages(t *testing.T) {
	s, db := fixture(t, nil)
	seed(t, db)
	ctx := context.Background()

	if err := s.SetLanguage(ctx, "not a language"); err == nil {
		t.Fatal("invalid language accepted")
	}
	if err := s.SetLanguage(ctx, "en"); err != nil {
		t.Fatal(err)
	}
	b, err := s.Bootstrap(ctx)
	if err != nil || b.Language != "en" {
		t.Fatalf("language = %q, %v", b.Language, err)
	}

	g, err := s.CreateGroup(ctx, CreateGroupInput{Title: "Review", MemberIDs: []string{"a", "b"}, DefaultMode: "serial"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.UpdateGroup(ctx, UpdateGroupInput{ID: g.ID, Title: "Plan review", MemberIDs: []string{"a", "b"}, DefaultMode: "serial"}); err != nil {
		t.Fatal(err)
	}
	d, err := s.OpenGroup(ctx, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSystemMessage(d.Messages, "You renamed the group to “Plan review”") {
		t.Fatalf("missing English system message: %+v", d.Messages)
	}

	// 第三种语言还没有系统消息模板时回退英文，而不是中文。
	if err = s.SetLanguage(ctx, "fr"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.UpdateGroup(ctx, UpdateGroupInput{ID: g.ID, Title: "Launch review", MemberIDs: []string{"a", "b"}, DefaultMode: "serial"}); err != nil {
		t.Fatal(err)
	}
	d, err = s.OpenGroup(ctx, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSystemMessage(d.Messages, "You renamed the group to “Launch review”") {
		t.Fatalf("missing fallback system message: %+v", d.Messages)
	}

	if err = s.SetLanguage(ctx, "zh"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.UpdateGroup(ctx, UpdateGroupInput{ID: g.ID, Title: "上线评审", MemberIDs: []string{"a", "b"}, DefaultMode: "serial"}); err != nil {
		t.Fatal(err)
	}
	d, err = s.OpenGroup(ctx, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !hasSystemMessage(d.Messages, "你把群名改为「上线评审」") {
		t.Fatalf("missing Chinese system message: %+v", d.Messages)
	}
}

func hasSystemMessage(messages []Message, want string) bool {
	for _, m := range messages {
		if m.AuthorKind == "system" && strings.Contains(m.Content, want) {
			return true
		}
	}
	return false
}
