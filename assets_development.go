//go:build !production

package main

import "os"

// 普通 go test/vet 不要求先生成 dist；wails3 dev 会先构建，再通过 Vite 代理加载。
var assets = os.DirFS("frontend/dist")
