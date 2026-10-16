// Package secret 只通过系统钥匙串保存模型 Key；没有文件或数据库回退。
package secret

import (
	"errors"
	"strings"
	"unicode"

	"github.com/zalando/go-keyring"
)

const Service = "ai-group-chat"

var ErrNotFound = errors.New("该模型服务尚未保存 API Key")
var ErrUnavailable = errors.New("系统钥匙串不可用：请检查系统凭证服务或访问授权")

type ring interface {
	Set(string, string, string) error
	Get(string, string) (string, error)
	Delete(string, string) error
}
type Store struct{ ring ring }

func newStore(r ring) *Store { return &Store{ring: r} }

type systemRing struct{}

func (systemRing) Set(s, u, p string) error        { return keyring.Set(s, u, p) }
func (systemRing) Get(s, u string) (string, error) { return keyring.Get(s, u) }
func (systemRing) Delete(s, u string) error        { return keyring.Delete(s, u) }

var system = newStore(systemRing{})

func Entry(providerID string) string { return "provider:" + providerID }
func validate(id string) error {
	if id == "" || strings.ContainsFunc(id, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) {
		return errors.New("模型服务 ID 无效")
	}
	return nil
}
func Set(providerID, key string) error      { return system.Set(providerID, key) }
func Get(providerID string) (string, error) { return system.Get(providerID) }
func Delete(providerID string) error        { return system.Delete(providerID) }
func (s *Store) Set(id, key string) error {
	if err := validate(id); err != nil {
		return err
	}
	if key == "" {
		return errors.New("API Key 不能为空；清除时请使用删除操作")
	}
	if err := s.ring.Set(Service, Entry(id), key); err != nil {
		return ErrUnavailable
	}
	return nil
}
func (s *Store) Get(id string) (string, error) {
	if err := validate(id); err != nil {
		return "", err
	}
	key, err := s.ring.Get(Service, Entry(id))
	if errors.Is(err, keyring.ErrNotFound) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", ErrUnavailable
	}
	return key, nil
}
func (s *Store) Delete(id string) error {
	if err := validate(id); err != nil {
		return err
	}
	err := s.ring.Delete(Service, Entry(id))
	if err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return ErrUnavailable
	}
	return nil
}
