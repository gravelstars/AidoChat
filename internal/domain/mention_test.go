package domain

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
)

func TestParseMentionsSharedCases(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/mentions.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Members []struct{ ID, Name string }
		Cases   []struct {
			Text string
			IDs  []string
			All  bool
		}
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	var members []Member
	for _, m := range fx.Members {
		members = append(members, Member{ID: m.ID, Name: m.Name})
	}
	for _, c := range fx.Cases {
		ids, all := ParseMentions(c.Text, members)
		if !slices.Equal(ids, c.IDs) && !(len(ids) == 0 && len(c.IDs) == 0) || all != c.All {
			t.Errorf("%q: got ids=%v all=%v, want ids=%v all=%v", c.Text, ids, all, c.IDs, c.All)
		}
	}
}

func TestPlanTargets(t *testing.T) {
	g := Group{MemberIDs: []string{"a", "b", "c"}}
	if got := PlanTargets(g, nil, true); !slices.Equal(got, []string{"a", "b", "c"}) {
		t.Errorf("all: %v", got)
	}
	if got := PlanTargets(g, []string{"c", "x", "a"}, false); !slices.Equal(got, []string{"c", "a"}) {
		t.Errorf("mentions: %v", got)
	}
}
