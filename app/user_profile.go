package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

func validateUserSeal(seal UserSeal) error {
	n := utf8.RuneCountInString(seal.Text)
	if n < 1 || n > 4 || (seal.Style != "baiwen" && seal.Style != "zhuwen") {
		return errors.New("私印需要 1–4 个非空白字符，并选择白文或朱文")
	}
	for _, r := range seal.Text {
		if unicode.IsSpace(r) || unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return errors.New("印文不能包含空白或控制字符")
		}
	}
	return nil
}

// SetUserProfile 同一事务保存资料，避免保存失败时显示名和私印来自不同版本。
func (s *Service) SetUserProfile(ctx context.Context, p UserProfile) error {
	for _, r := range p.DisplayName {
		if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' || unicode.Is(unicode.Cf, r) {
			return errors.New("显示名不能包含换行或控制字符")
		}
	}
	p.DisplayName = strings.TrimSpace(p.DisplayName)
	if n := utf8.RuneCountInString(p.DisplayName); n < 1 || n > 40 {
		return errors.New("显示名需要 1–40 个字符")
	}
	if err := validateUserSeal(p.Seal); err != nil {
		return err
	}
	name, _ := json.Marshal(p.DisplayName)
	seal, _ := json.Marshal(p.Seal)
	return friendly(s.db.SetSettings(ctx, map[string]string{"ui.user_display_name": string(name), "ui.user_seal": string(seal)}), "保存个人资料")
}
