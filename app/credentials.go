package app

import "ai-group-chat/internal/secret"

// 凭证出口独立于 SQLite，便于验证系统钥匙串失败时不会留下半份服务配置。
type credentialStore interface {
	Set(providerID, key string) error
	Get(providerID string) (string, error)
	Delete(providerID string) error
}
type systemCredentials struct{}

func (systemCredentials) Set(id, key string) error      { return secret.Set(id, key) }
func (systemCredentials) Get(id string) (string, error) { return secret.Get(id) }
func (systemCredentials) Delete(id string) error        { return secret.Delete(id) }
