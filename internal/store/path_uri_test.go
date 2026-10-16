package store

import (
	"net/url"
	"path/filepath"
	"testing"
)

// 盘符不能变成 URI 的 authority，中文、空格和查询分隔符也必须保留为文件名。
func TestDatabaseURIPaths(t *testing.T) {
	for _, path := range []string{"C:/Users/用户/App Data/data #1?.db", "/tmp/用户 App/data #1?.db"} {
		t.Run(path, func(t *testing.T) {
			u, err := url.Parse(databaseURI(path))
			if err != nil {
				t.Fatal(err)
			}
			if u.Host != "" || u.Scheme != "file" {
				t.Fatalf("文件 URI 不能包含主机名：%s", u)
			}
			want := path
			if want[0] != '/' {
				want = "/" + want
			}
			if u.Path != want {
				t.Fatalf("path=%q want=%q", u.Path, want)
			}

		})
	}
}

func TestOpenPathWithURICharacters(t *testing.T) {
	path := filepath.Join(t.TempDir(), "用户 App #1", "data #1.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("CREATE TABLE uri_roundtrip(value TEXT); INSERT INTO uri_roundtrip VALUES ('保留')"); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var got string
	if err := s.db.QueryRow("SELECT value FROM uri_roundtrip").Scan(&got); err != nil || got != "保留" {
		t.Fatalf("got %q: %v", got, err)
	}
}
