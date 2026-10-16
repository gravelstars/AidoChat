package app

import (
	"context"
	"testing"
	"time"
)

func TestDestructiveChangesWaitForSendBoundary(t *testing.T) {
	for _, op := range []string{"delete-member", "delete-group", "update-group"} {
		t.Run(op, func(t *testing.T) {
			s, db := fixture(t, nil)
			seed(t, db)
			ctx := context.Background()
			group, err := s.CreateGroup(ctx, CreateGroupInput{Title: "原群名", MemberIDs: []string{"a", "b"}, DefaultMode: "serial"})
			if err != nil {
				t.Fatal(err)
			}
			s.lifecycle.Lock()
			result := make(chan error, 1)
			go func() {
				switch op {
				case "delete-member":
					result <- s.DeleteMember(ctx, "a")
				case "delete-group":
					result <- s.DeleteGroup(ctx, group.ID)
				case "update-group":
					_, e := s.UpdateGroup(ctx, UpdateGroupInput{ID: group.ID, Title: "新群名", MemberIDs: []string{"b"}, DefaultMode: "serial"})
					result <- e
				}
			}()
			early := false
			select {
			case <-result:
				early = true
			case <-time.After(25 * time.Millisecond):
			}
			s.closed = true
			s.lifecycle.Unlock()
			if early {
				t.Fatal("破坏性操作越过了发送准备阶段的边界")
			}
			select {
			case err = <-result:
				if err == nil {
					t.Fatal("关闭后仍接受变更")
				}
			case <-time.After(time.Second):
				t.Fatal("操作未结束")
			}
			current, err := db.Group(ctx, group.ID)
			if err != nil || current.Title != "原群名" || len(current.MemberIDs) != 2 {
				t.Fatalf("关闭后状态发生变化：%+v %v", current, err)
			}
		})
	}
}
