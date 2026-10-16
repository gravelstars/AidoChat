package app

import (
	"context"
	"os"
	"testing"
	"time"
)

// TestLiveTestProvider 用真实服务跑一次"测试连接"（TASK-008 的真实验收）。
// 默认跳过；Key 已在系统钥匙串、并显式设置 AGC_LIVE_SETTINGS=1 时才调用。
func TestLiveTestProvider(t *testing.T) {
	if os.Getenv("AGC_LIVE_SETTINGS") != "1" {
		t.Skip("未配置真实服务验收")
	}
	s, _ := fixture(t, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	ms, err := s.TestProvider(ctx, SaveProviderInput{ID: "deepseek", Kind: "openai", BaseURL: "https://api.deepseek.com", TestModel: "deepseek-flash"})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("测试连接通过：用时 %d ms", ms)
}
