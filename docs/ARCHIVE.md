# 归档索引

本机外部归档：`/Users/zoupengcheng/Desktop/group-chat-ai-archive/2026-10-16-closeout/`。

这是本地交付路径，不随源码仓库上传。移动电脑时请单独备份此目录。

| 文件 | 内容 |
| --- | --- |
| project-history.tar.gz | 旧交接、旧 README、TASK-001–014、过程计划及 QA 证据，共 69 文件 |
| history-manifest.json | 原始相对路径、大小、逐文件 SHA-256，代码基线 158b4e1 |
| legacy-builds.tar.gz | 历史 build/bin 内容，仅供追溯，不作为最新安装包 |
| legacy-builds-manifest.json | 旧包逐文件校验表 |
| archive-index.json / SHA256SUMS | 外层归档文件大小和校验值 |
| verification/closeout-macos/ | 本轮原生桥接报告、截图和日志 |
| release/macos/ | 收尾时重新构建的本地安装包及校验表（已构建并校验） |

历史源码提交和本地分支仍保留在 .git，未压缩或重写。GitHub 初次发布使用清理后的源码快照，避免上传历史截图和旧构建。

## 校验和恢复

在归档目录运行 `shasum -a 256 -c SHA256SUMS`。每个归档创建后均按清单读取所有成员并比较 SHA-256，再清理原文件。不要直接解压覆盖当前工作区；在空目录中解压后按相对路径查阅：

```sh
mkdir -p /tmp/ai-group-chat-history
cd /tmp/ai-group-chat-history
tar -xzf /Users/zoupengcheng/Desktop/group-chat-ai-archive/2026-10-16-closeout/project-history.tar.gz
```

归档没有 API Key、用户数据库、依赖目录或 Git 凭证。真实聊天数据的备份方法见使用说明书。
