package domain

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// MentionAllNames 是 @所有人 的写法。
var MentionAllNames = []string{"所有人", "all", "All", "ALL"}

// ParseMentions 从文本里解析 @。返回按首次出现顺序去重的成员 ID，以及是否 @所有人。
//
// 规则（前端 frontend/src/lib/mention.ts 必须实现同一套，共享用例在 testdata/mentions.json）：
//   - '@' 前必须是文本开头、空白或标点，避免把邮箱 a@example.com 当成 @。
//   - 在 '@' 之后做最长匹配：成员"墨白"和"墨白二号"同时存在时，"@墨白二号"匹配后者。
//   - 名字之后必须是文本结尾、空白、标点，或任意 CJK 字符以外的边界；
//     中文名后紧跟中文（"@墨白你好"）也算匹配，因为中文没有空格分词习惯。
//   - 只匹配 candidates 里的成员（即本群成员），其余 @ 当普通文字。
func ParseMentions(text string, candidates []Member) (ids []string, all bool) {
	seen := map[string]bool{}
	for i := 0; i < len(text); {
		r, size := utf8.DecodeRuneInString(text[i:])
		if r != '@' && r != '＠' {
			i += size
			continue
		}
		if i > 0 {
			prev, _ := utf8.DecodeLastRuneInString(text[:i])
			if !isBoundary(prev) {
				i += size
				continue
			}
		}
		rest := text[i+size:]

		bestLen, bestID, bestAll := 0, "", false
		for _, n := range MentionAllNames {
			if len(n) > bestLen && strings.HasPrefix(rest, n) && endsAtBoundary(rest, n) {
				bestLen, bestID, bestAll = len(n), "", true
			}
		}
		for _, m := range candidates {
			if m.Name == "" {
				continue
			}
			if len(m.Name) > bestLen && strings.HasPrefix(rest, m.Name) && endsAtBoundary(rest, m.Name) {
				bestLen, bestID, bestAll = len(m.Name), m.ID, false
			}
		}
		switch {
		case bestAll:
			all = true
		case bestID != "" && !seen[bestID]:
			seen[bestID] = true
			ids = append(ids, bestID)
		}
		i += size + bestLen
	}
	return ids, all
}

func isBoundary(r rune) bool {
	return unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r)
}

func endsAtBoundary(rest, name string) bool {
	if len(rest) == len(name) {
		return true
	}
	next, _ := utf8.DecodeRuneInString(rest[len(name):])
	last, _ := utf8.DecodeLastRuneInString(name)
	if isBoundary(next) {
		return true
	}
	// 中文名后紧跟中文也视为结束；拉丁名后紧跟字母数字则不是（@bob 不匹配 @bobby）。
	return isCJK(last) && !isLatinWord(next)
}

func isCJK(r rune) bool {
	return unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) ||
		unicode.Is(unicode.Katakana, r) || unicode.Is(unicode.Hangul, r)
}

func isLatinWord(r rune) bool {
	return r < 128 && (unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_')
}

// PlanTargets 决定本轮由谁回复、按什么顺序：
// @所有人 → 群成员顺序；否则 → @ 出现顺序。不在群里的成员被忽略。
func PlanTargets(g Group, mentions []string, all bool) []string {
	if all {
		return append([]string(nil), g.MemberIDs...)
	}
	in := map[string]bool{}
	for _, id := range g.MemberIDs {
		in[id] = true
	}
	var out []string
	for _, id := range mentions {
		if in[id] {
			out = append(out, id)
		}
	}
	return out
}
