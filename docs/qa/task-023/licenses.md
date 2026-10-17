# TASK-023 许可导出与审查

日期：2026-10-17。执行者：Codex（许可子任务）。

## 所有者复核结论（2026-10-17）

所有者已审阅下列发现，并接受**当前分发范围**：只公开源码与浏览器演示，不发布二进制安装包或 Release。该结论是所有者决定，不是法律意见，也不等于判定全部依赖 Apache-2.0 兼容；原始发现、原文与清单继续保留，未来发布二进制前仍需单独复核。

## 审查发现

**不能把机器扫描结果当作「全部依赖已判定 Apache-2.0 兼容」。** `pdfjs-dist@6.4.299/standard_fonts/LICENSE_LIBERATION` 明文为 **GPL v2 + font exceptions**。原文未改写，完整保存于 [LICENSE_LIBERATION](../../licenses/texts/frontend/pdfjs-dist@6.4.299/standard_fonts/LICENSE_LIBERATION)。本次不替换依赖或字体、不自行改变许可原文。

具体使用链路：`frontend/src/lib/pdf.ts:4` 的 `import.meta.glob` 包括 `standard_fonts/*.{pfb,ttf,otf}`；包含 `LiberationSans-Regular.ttf`、`LiberationSans-Bold.ttf`、`LiberationSans-Italic.ttf`、`LiberationSans-BoldItalic.ttf`。其 §1(a) 谈文档嵌入，§1(b) 另谈 physical product 的 object code/source access；这里仅标出原文条件，不把字体例外解释成应用的无条件许可。[上游原文](https://github.com/mozilla/pdf.js/blob/master/external/standard_fonts/LICENSE_LIBERATION) 可供复核；**当前锁定 npm 包的完整原文**才是本次扫描依据。

## 导出方法与范围

- 根 `LICENSE` 直接从 [Apache 官方 HTTPS 文本](https://www.apache.org/licenses/LICENSE-2.0.txt) 下载，保留原始字节，包括末尾 Apache 应用说明和占位示例，未自行重排或改写。根 `NOTICE` 使用 `AidoChat`、`2026`、所有者字面占位 `<版权所有者>`，没有批量改变源码头部。
- [scripts/export-licenses.sh](../../../scripts/export-licenses.sh) 在临时目录安装固定版本 `license-checker-rseidelsohn@4.4.2`、`github.com/google/go-licenses/v2@v2.0.1`、`github.com/google/licenseclassifier/v2/tools/identify_license@v2.0.0`，不修改应用依赖。`license-checker-rseidelsohn` 的 CLI banner 内部仍显示 4.3.0；记录的安装版本依据其 `package.json`（4.4.2）。
- 前端既保留 scanner 的 installed/all 与 production 原始 JSON，也逐条导出完整 lockfile；当前宿主未安装的跨平台 optional 包下载精确 tarball，以 lockfile 的 integrity 校验，仅复制许可/版权/NOTICE/PATENTS 文本，不将其二进制提交仓库。锁文件元数据不等同于人工兼容性批准。
- Go 保留 `go list -m -json all` 的全部模块、三个 GOOS 的应用入口 `go list -e -deps -json .`、`go-licenses report/save` 原始输出；完整模块图的原始许可文件再由 Google classifier 识别。`runtime-import-graph` 仅表示出现在至少一个应用导入图；其余明确为 `module-graph-only (build/tool/test/transitive; not proven shipped)`。三平台导入图不是跨平台构建或安装测试。
- 原始输出仅把本地绝对仓库、HOME、模块/工具缓存前缀换成显式占位符，以免把开发者路径发布进仓库。许可证原文不做这种替换，按原字节复制；SHA-256、源包路径、输入文件 hash、工具版本、执行命令见 [provenance.json](../../licenses/provenance.json) 与 [text-sources.json](../../licenses/text-sources.json)。
- Go 标准库 LICENSE/PATENTS 另外保存；Wails 等含 C/Objective-C 的依赖，保留 `go-licenses`「非 Go 代码不能进一步扫描」的警告。扫描不声称已经穷尽系统 SDK/原生二进制内部的所有法律要求。
- 完整保留三个字体包的 OFL 和版权前缀；实际安装的是 Noto Sans SC / Noto Serif SC / JetBrains Mono，不将 Noto 名称写成 Adobe Source Han。pdf.js 额外保留 CMaps（Adobe）、Foxit、Liberation、ICC、OpenJPEG、QCMS、JBIG2、pdf.js wrapper 等原始文件，即使一些 wasm/ICC 资源未被本应用资源 glob 选中，也以「包内许可」保留。

## 可复现与验证

```bash
cd frontend && npm ci
cd ..
bash scripts/export-licenses.sh
```

许可证工具安装和包下载需要网络；不会运行应用安装生命周期脚本来收集 optional 包，不新增运行依赖。生成文件与具体结果见 `docs/licenses/`。导出后的 `review-required.json` 单独保留识别出的 copyleft、缺少原文项目和限制，不以生成进程成功代替许可审查通过。

技术排查记录：首次网络调用因 sandbox DNS 限制失败，使用已授权的网络执行；npm 默认缓存权限异常，切换到临时缓存；go-licenses 在自动选择 Go 1.26.4 时用错误的默认 GOROOT 识别标准库，显式传入 `GOROOT="$(go env GOROOT)"` 后恢复。未修改应用或工具源码来绕过分类错误。

## 实际生成结果

机器扫描也发现 `modernc.org/libc` 的 `testdata/nsz.repo.hu/libc-test/src/math/crlibm/COPYING` 为 GPL-2.0。该文件是上游测试夹具许可，**不是运行代码已经判为 GPL 的结论**。已立即报告，并与实际打包的 pdf.js 字体分开保留。

内嵌版权审查发现：`modernc.org/libc@v1.77.1/uuid/uuid/uuid_linux_amd64.go`、`sys/types/types_linux_amd64.go` 等的 GNU C Library 头为 LGPL 2.1 或以后版本；Darwin 生成代码如 `limits/limits_darwin_amd64.go` 明文 APSL-1.1，`errno/errno_darwin_amd64.go` 包含 APSL-2.0 与 BSD-4-Clause-UC。这些源包位于应用平台导入图，但本次**不推断声明/生成类型是否可版权，也不把导入图当成最终机器码义务证明**；全部列为原生/生成代码许可待审阅。模块根 BSD-3-Clause 不能掩盖这些原始版权头。完整引用文本另从固定 `github.com/google/licenseclassifier/v2@v2.0.0` 参考语料 机器下载作为参考，不冒充模块自带文件。

运行源文件中的版权/许可注释按原始字节截取并按 SHA-256 去重；[go-inline-notices.json](../../licenses/go-inline-notices.json) 记录每次来源、原文件 hash 与字节区间。同一文本可对应多个文件，因此 provenance 的来源记录数大于实际文本文件数。Wails WebView2 内借用 go-ole 的 Yasuhiro Matsumoto MIT 版权等，也在此保留。

缺失与额外义务：`github.com/konoui/go-qsort@v0.1.0`、`github.com/mattn/go-localereader@v0.0.1` 在精确模块版本中没有独立 LICENSE/版权头，均为 module-graph-only，明确 UNKNOWN；26 个 npm native 平台包不附 LICENSE，本次保留其 MIT 元数据并关联同版本上层 `@napi-rs/canvas`/`rolldown` 原文，但不据此宣称 native 内部所有版权已获确认。前端锁图另有 MPL-2.0 元数据，具体包和 dev/optional 范围见 `review-required.json`。包依赖图不等于最终浏览器 bundle，特别是 Node native optional 包/构建器。

最终生成计数、哈希验证结果见下。

- 最终锁图：224 个 npm 包（171 个当前宿主安装包 + 53 个其他平台 optional 精确 tarball）；172 个 Go 模块，其中 18 个出现在至少一个应用平台导入图，154 个仅模块图。
- 原文：851 份去重后的原始文本文件，2,060 条来源记录；1,561 条运行源文件内嵌通知来源按原始字节 SHA-256 去重为 352 份文本。三个字体 LICENSE 均与实际安装包逐字节相等。
- 根 Apache 原文：11,358 字节；SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`；导出器每次重新从 apache.org 获取并逐字节核对，差异即失败。
- 逐条重新读取所有 2,060 条文本来源记录，文件存在、字节数与 SHA-256 全部匹配；`frontend/package-lock.json`、`go.mod`、`go.sum` 的 provenance hash 与当前文件相符。
- `node --check scripts/export-licenses.mjs`、`bash -n scripts/export-licenses.sh`、`scripts/check-protected.sh` 通过；`git diff --exit-code -- go.mod go.sum` 通过。没有改源码头、契约、受保护文件或应用依赖。
- Go 导出使用临时 manifest 副本；go-licenses 的 x/tools 内部以 GO111MODULE=off 查询工具链，不能继承 -modfile，因此另外在临时精确源码副本中扫描，并保留源码 hash。曾由 `go mod download all` 追加的项目 go.sum 校验和已恢复至原字节；最终脚本不再向项目 go.mod/go.sum 写入。
- `modernc.org/sqlite@v1.60.1/lib/sqlite_g_0000000000000003.go` 也保留 Apple 2002–2017 APSL-1.1 原始头，收在内嵌通知索引。是否对应最终链接内容/是否受保护表达、如何履行其条件，均未自行判定。
- 原始工具输出、源码通知出处与全部机器生成表可复核；缺原文、GPL/LGPL、APSL、BSD 四条款与 MPL 范围按前述保留为待审阅项。未进行法律背书、Windows/Linux 真机安装或分发；完整应用测试由主任务统一记录。
- 最终复跑 `LICENSE_TOOLS_DIR=/tmp/aidochat-license-tools bash scripts/export-licenses.sh` 完整退出 0，输出 `summary.json` 上述全部计数；随后重新运行原文 hash、输入 hash、字体逐字节、官方 LICENSE 与受保护文件检查，全部通过。`git diff --exit-code -- go.mod go.sum` 再次确认应用 manifest 无副作用；导出目录本地个人绝对路径扫描无命中。
- 后续 Go 全仓检查暴露许可文件名匹配包含 5 个 `copyright*.go` / `licenses.go`，Go 将其识别为 docs 中的包。本次将这些原文容器改名为 `.go.txt`，原始字节及 SHA-256 不变，同步机器索引、表格和保存的工具输出路径；生成器 `copy` 同样自动转为 `.go.txt`，防止复现。`go vet ./...` 已重新通过，2,060 条来源 hash 和三个输入 hash 再验通过；前端 package-lock 与首次最终导出记录完全一致，仍包含已批准的固定 Playwright。
