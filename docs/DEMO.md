# 浏览器演示与下载

在线试玩入口准备就绪，**GitHub Pages 尚待仓库所有者手动开启**。开启并部署成功后的地址：[AidoChat 在线试玩](https://gravelstars.github.io/AidoChat/)。在此之前，请使用下面的本地预览，避免将未部署页面误认为故障。

当前仓库可见性为 **private**，未登录访客无法查看首页。是否公开仓库、私有仓库是否具备 Pages 使用资格，由所有者确认；本任务不会更改可见性。首次推送后的 Pages 工作流在 `configure-pages` 报 `Get Pages site failed / Not Found`，原因是尚未启用 Pages，不是本地演示构建失败。

```sh
cd frontend
npm ci
npm run build:demo
npm run preview -- --outDir dist-demo --base=/AidoChat/ --port 4173
```

打开 http://localhost:4173/AidoChat/ 。回复是预设文案，不调用模型，无需 Key。盖章、群聊、成员与外观改动只保存在当前浏览器的演示命名空间；“重置演示”清除此演示的数据。演示附件每份最多 512 KiB，总存储空间有限；浏览器配额与清理策略可能导致本地数据丢失，请勿把它作为正式记录或输入私密数据。

演示保留主要界面与交互；模型连接、系统凭证、打开桌面目录和 PNG 保存需要桌面版。分享图片在演示中可预览，保存入口明确禁用。宽度小于 900px 时显示电脑访问说明，不支持手机端操作。

## 下载 / Download

本仓库当前只公开源码与浏览器演示，不发布二进制安装包。Windows、macOS、Linux 请按 [构建说明](../build/README.md) 从源码构建；本机已构建的包不等于公开下载，也不作为 Release 附件发布。第三方许可审阅未关闭，因此不提供安装包下载。

The browser demo uses preset replies and never calls a model. This repository currently publishes source and the browser demo only; no binary installers are published. Build locally with [the build instructions](../build/README.md). Third-party license review remains open, so installers are not offered for download.

## 所有者设置

1. 版权署名已确定为 `gravelstars`，NOTICE 已填写。仍须审阅 [第三方许可](../THIRD_PARTY_NOTICES.md) 中的待确认项；当前不能宣称“全部依赖兼容性已通过”。本仓库决定只公开源码与浏览器演示，不发布二进制安装包。
2. 首次自行提交前，在此仓库设置个人邮箱：`git config user.email 你的个人邮箱`。执行者不替你猜测或设置个人邮箱。
3. 仓库可见性改为 **public**（`Settings → General → Danger Zone → Change visibility`）。私有仓库的 Pages 需要付费计划；当前所有者选择公开。
4. 进入仓库 **Settings → Pages → Build and deployment → Source → GitHub Actions**。开启后可推送 `main`，或由执行者手动触发 **Browser demo Pages**。演示地址为 `https://gravelstars.github.io/AidoChat/`。确认可访问后，将中英 README 的“在线试玩（待开启）”入口改为该地址，移除待开启说明。
5. 社交分享图：**Settings → General → Social preview → Edit → Upload an image**，上传 `docs/assets/social-day.png`（1280×640）；夜间版本为 `social-night.png`。

About 中文（可直接复制）：

> 本地 AI 群聊桌面应用：用 @ 点名讨论，给有来源的群纪要盖章。

About English（少于 100 字符）：

> Local AI group chat. Mention members, trace shared notes, and stamp your decisions.

Topics（7 个）：`ai-chat`、`desktop-app`、`local-first`、`wails`、`react`、`golang`、`group-chat`。

本任务交付工作流与文件，不修改仓库 About、Topics、Pages 或社交图设置，不发布 Release。所有者后来明确授权上传代码，推送授权不包含这些设置。
