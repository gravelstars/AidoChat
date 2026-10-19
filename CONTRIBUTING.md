# 参与贡献

欢迎提交问题、改进建议和 Pull Request。请先搜索已有 [Issues](https://github.com/gravelstars/AidoChat/issues)，避免重复；不要在 Issue、日志或提交里附 API Key、数据库文件或私人聊天记录。

## 开发环境

需要 Go（版本见 `go.mod`）、Node.js 24，以及对应平台的 Wails 构建环境。具体依赖和打包方式见 [build/README.md](build/README.md)。

```sh
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.29
cd frontend
npm ci
npm run dev        # 浏览器预览，使用虚构数据与预设回复
```

真实桌面窗口：

```sh
wails3 dev
```

## 自检

提交前请在仓库根目录运行：

```sh
go vet ./...
go test -race ./...

cd frontend
npm test
npm run build
npm run build:demo
```

演示构建的完整交互验收：

```sh
# 先在另一个终端启动 frontend 的 preview（端口 4173）
node scripts/verify-demo.mjs http://127.0.0.1:4173/AidoChat/
```

## 代码约定

- **Go**：优先使用标准库；面向用户的错误信息用中文；注释说明“为什么”，不要复述代码。
- **前端**：函数组件 + hooks；跨组件状态放在 `frontend/src/state/store.ts`；组件只通过 `backend` 访问后端，不直接调用 Wails 运行时；样式使用 CSS Modules。
- **设计与组件**：沿用 `frontend/src/design/tokens.css` 和现有组件（`Button`、`Segmented`、`Dialog`、`Field`、`Seal`、`Icon`）。不引入 UI 组件库、图标库或 Tailwind；朱色只属于用户，见 [设计规范](docs/DESIGN.md)。
- **交互**：所有可点击元素提供按下反馈；监听 Enter 的地方都要处理中文输入法组字（`isComposing`）。
- **隐私与记忆**：AI 不能产生“已确认”，不能修改已确认的条目；每条记忆必须有真实来源。不要放宽这些规则。
- **数据**：不要提交数据库、API Key、`node_modules`、`dist` 或本地用户数据。

## 提交

保持提交聚焦：一个提交解决一个问题，说明为什么改，而不是逐行复述。界面类改动请附宣纸和夜读截图，并注明哪些平台/交互尚未真机验证。

[在线演示](https://gravelstars.github.io/AidoChat/) · [使用手册](docs/USER_GUIDE.zh.md) · [构建说明](build/README.md) · [第三方许可](THIRD_PARTY_NOTICES.md)
