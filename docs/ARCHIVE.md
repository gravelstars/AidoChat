# 归档与交付索引

AidoChat 0.1.2 本机交付：

| 路径 | 内容 |
| --- | --- |
| `/Applications/AidoChat.app` | 当前安装版；0.1.2 包已生成，是否替换安装由所有者决定 |
| `/Users/zoupengcheng/Desktop/AidoChat-release/0.1.2/` | AidoChat.dmg、SHA256SUMS、使用说明书、发布说明 |
| `/Users/zoupengcheng/Desktop/AidoChat-release/0.1.1/` | 上一版 AidoChat.dmg、SHA256SUMS、使用说明书，保留作回退 |
| `/Users/zoupengcheng/Desktop/group-chat-ai-archive/2026-10-17-aidochat/` | TASK-017 过程记录、测试日志、原生截图、安装/数据核对与旧包删除记录 |
| 该归档下 `private-user-data-before-upgrade/` | 升级前的私密用户数据备份，权限0700；不上传仓库、不包含系统钥匙串 |

本地归档与安装包不随源码上传，移动电脑时需单独备份。GitHub 三平台包见 [Actions](https://github.com/rickepicepic/AidoChat/actions)，选择与所需源码版本一致的成功运行和 AidoChat-* Artifacts。

历史归档：`/Users/zoupengcheng/Desktop/group-chat-ai-archive/2026-10-16-closeout/`。

| 文件 | 内容 |
| --- | --- |
| project-history.tar.gz / history-manifest.json | TASK-001–014、旧交接、过程计划和 QA，69 文件，基线158b4e1 |
| closeout-records.tar.gz / closeout-records-manifest.json | TASK-015/016 交付和调查记录 |
| legacy-builds-manifest.json | 已删除旧包的历史元数据 |
| archive-index.json / SHA256SUMS | 当前保留的归档载荷与校验值 |
| verification/ | 历史原生桥接、截图与平台构建证据 |

旧 `legacy-builds.tar.gz`、`release/macos/` 和 `release/macos-before-platform-validation/` 中的旧应用、zip、dmg 已在新版验证后按所有者要求删除。原始校验元数据和删除清单保留，旧文件不再作为交付包。

## 校验与恢复

在对应归档或交付目录运行 `shasum -a 256 -c SHA256SUMS`。过程归档还提供逐文件 manifest；归档已核对全部成员内容后再清理源文件。不要直接解压覆盖工作区，在空目录解压查阅：

```sh
mkdir -p /tmp/aidochat-history
cd /tmp/aidochat-history
tar -xzf /Users/zoupengcheng/Desktop/group-chat-ai-archive/2026-10-16-closeout/project-history.tar.gz
```

历史源码提交和本地分支保留在 .git，未重写。过程归档没有 API Key 或 Git 凭证。用户数据备份与过程证据分开存放，其恢复方法见 [使用说明书](USER_GUIDE.md)。
