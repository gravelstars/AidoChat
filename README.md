# AidoChat

本地运行的 AI 群聊桌面应用，当前版本 0.1.1。配置模型服务，创建不同角色的成员，在群里用 @ 点名；支持依次或同时回复、停止、重试，以及带来源、由用户确认的群记忆。

桌面端使用 Go + Wails v3 + React，数据保存在本机 SQLite，API Key 保存在系统凭证存储。调用云端模型时，所需聊天上下文会发送到你配置的服务。

## 使用

完整操作、配置、备份和故障处理见 [使用说明书](docs/USER_GUIDE.md)。本地交付包位置见 [归档索引](docs/ARCHIVE.md)。当前验收状态见 [收尾说明](docs/CLOSEOUT.md)。

## 开发

需要 Go（版本见 go.mod）、Node.js 24 和对应系统的 Wails 原生开发环境。

```sh
cd frontend
npm ci
npm run dev
```

浏览器预览使用 mock 演示数据，不会访问桌面数据库或真实模型。开发真实桌面应用：

```sh
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.29
# 将 go env GOPATH 输出目录下的 bin 加入 PATH
wails3 dev
```

构建安装包与系统依赖见 [构建说明](build/README.md)。

## 自检

```sh
go vet ./...
go test -race ./...
cd frontend
npm test
npm run build
cd ..
bash scripts/check-protected.sh
```

源码分为 `app/`（服务层）、`internal/`（存储、模型、轮次、上下文和记忆）、`desktop/`（原生外壳）、`frontend/`（界面）。接手开发按 [AGENTS.md](AGENTS.md) 和 [HANDOFF.md](HANDOFF.md) 阅读；产品、架构、设计与 ADR 保留在 docs。历史任务和截图已迁出，索引见归档说明。
