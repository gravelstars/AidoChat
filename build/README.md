# 桌面构建与安装

固定 Wails `v3.0.0-beta.29`。真实桌面端使用 Go 服务与 SQLite；浏览器 Vite 预览使用 mock。

## 公共准备

使用 go.mod 指定的 Go 版本和 Node.js 24。

```sh
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.29
cd frontend
npm ci
cd ..
wails3 dev
# 或构建本机平台安装包
wails3 task package
```

将 GOPATH/bin 加入 PATH。开发服务器固定 127.0.0.1:5173。生产构建自动先生成 frontend/dist 并嵌入二进制；默认 Go 测试不要求 dist 存在。

## macOS

需要 Xcode Command Line Tools。`wails3 task package` 构建 Intel + Apple Silicon 通用二进制、.app、保留权限的 zip 和 dmg，输出到 build/bin。可选图标存在时才复制到包中。

当前为本地 ad-hoc 签名，未做 Developer ID 签名和公证，不是正式分发版本。最新本地包位置见 [归档索引](../docs/ARCHIVE.md)。

```sh
codesign --verify --deep --strict build/bin/ai-group-chat.app
file build/bin/ai-group-chat.app/Contents/MacOS/ai-group-chat
hdiutil verify build/bin/ai-group-chat.dmg
```

## Windows

在原生 Windows 环境安装 Go、Node.js 24、固定 Wails CLI；打包 NSIS 另需 makensis 位于 PATH。

```sh
wails3 task package
wails3 task windows:nsis
```

输出 GUI exe、zip 和 NSIS 安装程序。NSIS 包含官方 WebView2 在线引导安装器；缺少运行时时安装需要联网。安装器当前面向默认 amd64 构建，未承诺 ARM 安装支持。macOS 上仅可交叉编译 exe，不能执行 Windows 专用压缩/安装验收。

## Linux

当前目标为 Ubuntu 24.04、GTK4 / WebKitGTK 6.0。原生环境准备：

```sh
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libgtk-4-dev libwebkitgtk-6.0-dev dpkg-dev
wails3 task package
wails3 task linux:deb
sudo apt install ./build/bin/ai-group-chat.deb
```

AppImage 另需 appimagetool 与已生成的应用 PNG 图标：`wails3 task linux:appimage`。CI 固定 appimagetool 1.9.1 并校验 SHA-256。该配方没有捆绑全部 GTK/WebKit 系统库，不保证任意 Linux 发行版免依赖运行；优先使用 Ubuntu deb。正式图标母版仍待所有者确认，生成方法见 scripts/make-icons.sh。CI 只在仓库变量 APP_ICON_APPROVED=true 时运行该脚本；未生成图标时跳过 AppImage，仍构建 deb 和 tar.gz。

## CI 与验收边界

.github/workflows/desktop-build.yml 使用三个原生 runner，执行自检并产出各平台包。只有远程运行成功才算 CI 通过；安装后窗口、中文输入法、系统凭证和实际聊天仍需真机检查。当前结论见 [收尾说明](../docs/CLOSEOUT.md)。构建产物、依赖和本地数据库不提交。

## 可复用桌面 QA

macOS 下 `desktopqa` 标签提供本应用视图截图和桥接测试，正常生产构建不包含这些入口。使用独立临时数据库和窗口状态，不要指向用户数据：

```sh
cd frontend && npm run build
cd ..
go build -tags 'production,desktopqa' -o /tmp/ai-group-chat-qa .
AGC_QA_DIR=/tmp/ai-group-chat-qa-images AGC_QA_STATE=/tmp/ai-group-chat-qa-window.json /tmp/ai-group-chat-qa
```

真实服务桥接模式还需 AGC_QA_BRIDGE=1 与独立的 AGC_QA_DB，具体流程见 desktop/bridgeqa.js。截图结果只证明捕获时的视图；本轮桥接回归及宣纸/夜读截图已通过，详见收尾说明。
