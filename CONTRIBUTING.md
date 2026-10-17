# 参与贡献

先读 [AGENTS.md](AGENTS.md) 与 [HANDOFF.md](HANDOFF.md)。问题反馈和建议欢迎通过 [Issues](https://github.com/gravelstars/AidoChat/issues) 提交；不要附 API Key、数据库或私人聊天。

需要 Go（版本见 go.mod）、Node.js 24；桌面开发还需 [Wails 构建环境](build/README.md)。浏览器预览使用虚构数据与模拟回复：

```sh
cd frontend
npm ci
npm run dev
```

自检从仓库根目录运行：

```sh
go vet ./...
go test -race ./...
cd frontend && npm test && npm run build
cd .. && scripts/check-protected.sh
```

先在 `docs/tasks/` 建任务单并认领，按任务开分支，写交付和未验证项。只使用现有组件与设计 token；不改受保护文件、不刷新保护指纹、不擅改契约或增加依赖，不放宽 AI 记忆确认与来源规则。界面修改需日夜截图；真实系统未验证要明确注明。

[演示构建](docs/DEMO.md) · [一键素材](scripts/SHOWCASE.md) · [第三方许可](THIRD_PARTY_NOTICES.md)
