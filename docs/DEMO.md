# 浏览器演示与下载

在线试玩入口准备就绪，**GitHub Pages 尚待仓库所有者手动开启**。开启并部署成功后的地址：[AidoChat 在线试玩](https://gravelstars.github.io/AidoChat/)。在此之前，请使用下面的本地预览，避免将未部署页面误认为故障。

```sh
cd frontend
npm ci
npm run build:demo
npm run preview -- --outDir dist-demo --base=/AidoChat/ --port 4173
```

打开 http://localhost:4173/AidoChat/ 。回复是预设文案，不调用模型，无需 Key。盖章、群聊、成员与外观改动只保存在当前浏览器的演示命名空间；“重置演示”清除此演示的数据。演示附件每份最多 512 KiB，总存储空间有限；浏览器配额与清理策略可能导致本地数据丢失，请勿把它作为正式记录或输入私密数据。

演示保留主要界面与交互；模型连接、系统凭证、打开桌面目录和 PNG 保存需要桌面版。分享图片在演示中可预览，保存入口明确禁用。宽度小于 900px 时显示电脑访问说明，不支持手机端操作。

## 下载 / Download

仓库当前没有公开 Release。Windows、macOS、Linux 安装包即将发布；本机已构建的包不等于公开下载。发布后将在 [Releases](https://github.com/gravelstars/AidoChat/releases) 提供对应文件，当前不提供未经核实的文件直链。

The browser demo uses preset replies and never calls a model. GitHub Pages is awaiting owner setup. Desktop installers for Windows, macOS and Linux are coming soon; no public Release is available yet. See [the user guide](USER_GUIDE.md) and [build instructions](../build/README.md) for local use.

## 所有者设置

1. 先审阅 [第三方许可](../THIRD_PARTY_NOTICES.md) 中待确认项；当前不能宣称“全部依赖兼容性已通过”。确认 NOTICE 中 `<版权所有者>` 的正式名称。LICENSE 必须保留 Apache 官方原文，附录中的 `[name of copyright owner]` 是官方示例，不直接替换。
2. 首次自行提交前，在此仓库设置个人邮箱：`git config user.email 你的个人邮箱`。执行者不替你猜测或设置个人邮箱。
3. 进入仓库 **Settings → Pages → Build and deployment → Source → GitHub Actions**。工作流 `.github/workflows/demo-pages.yml` 只在推送到 `main` 时运行，未手动开启 Pages 时可能部署失败；本次不会替你开启。
4. 开启后推送到 `main`，等待 **Browser demo Pages** 成功。演示地址为 `https://gravelstars.github.io/AidoChat/`。确认可访问后，将中英 README 的“在线试玩（待开启）”入口改为该地址，移除待开启说明。
5. 社交分享图：**Settings → General → Social preview → Edit → Upload an image**，上传 `docs/assets/social-day.png`（1280×640）；夜间版本为 `social-night.png`。

About 中文（可直接复制）：

> 本地 AI 群聊桌面应用：用 @ 点名讨论，给有来源的群纪要盖章。

About English（少于 100 字符）：

> Local AI group chat. Mention members, trace shared notes, and stamp your decisions.

Topics（7 个）：`ai-chat`、`desktop-app`、`local-first`、`wails`、`react`、`golang`、`group-chat`。

本任务交付工作流与文件，不修改仓库 About、Topics、Pages 或社交图设置，不发布 Release。所有者后来明确授权上传代码，推送授权不包含这些设置。
