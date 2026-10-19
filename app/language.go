package app

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
)

type systemNote struct {
	key  string
	args []string
}

// 系统消息在创建时按当前界面语言落库；历史消息保持创建时的语言。
var systemTemplates = map[string][2]string{
	"group.rename": {"你把群名改为「{name}」", "You renamed the group to “{name}”"},
	"group.topic":  {"你改了群主题", "You changed the group topic"},
	"group.mode":   {"你把默认回复方式改为{mode}", "You changed the default reply mode to {mode}"},
	"group.invite": {"你邀请了 {name}", "You invited {name}"},
	"group.remove": {"你移出了 {name}", "You removed {name}"},
	"group.order":  {"你调整了发言顺序", "You changed the speaker order"},
}

// 接受 BCP 47 风格的短代码；第三种语言只需在前端新增 locale 文件。
var languageCode = regexp.MustCompile(`^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$`)

func (s *Service) SetLanguage(ctx context.Context, language string) error {
	if !languageCode.MatchString(language) {
		return errors.New("界面语言无效")
	}
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	if s.closed {
		return errors.New("应用正在关闭")
	}
	raw, err := json.Marshal(language)
	if err != nil {
		return err
	}
	if err := s.db.SetSetting(ctx, "ui.language", string(raw)); err != nil {
		return friendly(err, "保存界面语言")
	}
	s.language = language
	return nil
}

func (s *Service) systemMessageKey(ctx context.Context, groupID, key string, args ...string) {
	templates, ok := systemTemplates[key]
	if !ok {
		return
	}
	// 尚未提供该语言模板时回退英文，而不是让第三方语言用户看到中文。
	text := templates[1]
	if s.language == "zh" {
		text = templates[0]
	}
	for i := 0; i+1 < len(args); i += 2 {
		text = strings.ReplaceAll(text, "{"+args[i]+"}", args[i+1])
	}
	s.systemMessage(ctx, groupID, text)
}
