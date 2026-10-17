# 浏览器演示与下载

在线演示：[AidoChat 在线演示](https://gravelstars.github.io/AidoChat/)。回复是预设文案，不调用模型，无需 Key；改动只保存在当前浏览器的演示命名空间。

## 本地预览

```sh
cd frontend
npm ci
npm run build:demo
npm run preview -- --outDir dist-demo --base=/AidoChat/ --port 4173
```

打开 http://localhost:4173/AidoChat/ 。盖章、群聊、成员与外观改动只保存在当前浏览器的演示命名空间；“重置演示”清除此演示的数据。演示附件每份最多 512 KiB，总存储空间有限；浏览器配额与清理策略可能导致本地数据丢失，请勿把它作为正式记录或输入私密数据。

演示保留主要界面与交互；模型连接、系统凭证、打开桌面目录和 PNG 保存需要桌面版。分享图片在演示中可预览，保存入口明确禁用。宽度小于 900px 时显示电脑访问说明，不支持手机端操作。

## 下载 / Download

安装包在 [GitHub Releases](https://github.com/gravelstars/AidoChat/releases/latest) 发布：macOS 下载 dmg，Windows 下载 setup.exe，Ubuntu 下载 deb。也可以按 [构建说明](../build/README.md) 从源码构建。

Installers are published on [GitHub Releases](https://github.com/gravelstars/AidoChat/releases/latest): dmg for macOS, setup.exe for Windows, and deb for Ubuntu. You can also build from [source](../build/README.md).
