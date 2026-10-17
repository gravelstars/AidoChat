# TASK-020 附件 Implementation Plan

> 执行：superpowers:subagent-driven-development，先RED，再实现，主执行者完成规格与质量复核。用户2026-10-17已批准设计、两个依赖、builder唯一保护例外及仅该文件指纹更新。

**Goal:** 图片、TXT/MD/PDF能作为真实消息附件本地保存，并按点名、预算、可见性送入真实模型。
**Architecture:** 独立attachments存储/文件服务；消息落库时事务绑定草稿；编排器先按元数据组装窗口，窗口选定后仅加载选中图片。PDF在本地worker提取，PNG/JPEG/WebP在Go验证。记忆只获取真实来源的附件文本，不发原始图片。
**Tech Stack:** Go标准库、SQLite、React/Vite；新增固定版本pdfjs-dist，兼容已配置Node24。

## 文件职责

- internal/domain/attachments.go：Attachment类型、附件文本来源格式与限额；domain.go仅扩展Message.Attachments和Member.SupportsImages。
- internal/store/migrations/004_attachments.sql、attachments.go：表、成员视觉字段、导入/读取/草稿移除/清理；messages.go/c​atalog.go只接入字段、事务绑定。
- app/attachments.go、attachments_test.go：base64导入、真实类型/长度/像素校验、随机ID安全文件、资源handler、生命周期清理。临时测试库旁建立目录，严禁使用真实用户目录。
- app/dto.go/service.go：契约映射、Send带附件ID、成员SupportsImages、Shell资源handler。
- internal/llm/llm.go、openai/openai.go、anthropic/anthropic.go：结构化Image；纯文本请求仍发送原string形态。
- internal/contextbuilder/attachments.go：新类型及附件render/cost；builder.go仅按批准patch携带文本/图像、预算、相邻角色合并。
- internal/turn/orchestrator.go：可选附件参数、只有附件也能落库、视觉预检、保存后广播、回复/重试附件窗口与延迟读图。
- internal/memory/runner.go：复制历史并把有消息编号的附件文本放入本次整理上下文，保护memory.go与Apply规则完全不改；限制文档长度影响预算，不能强行塞整个文件。
- frontend/src/backend/contract.ts/mock.ts/wails.ts：Attachment/import/remove/read接口，真实桥接与mock相同语义。
- frontend/src/lib/attachments.ts、pdf.ts：常量、base64编码、格式检测、本地PDF worker提取，中文文本/页码和失败说明。
- frontend/src/features/chat/AttachmentList.tsx/.module.css、Composer.tsx/.module.css、MessageItem.tsx：草稿队列/预览/移除、选择/粘贴/拖入、失败保留；新业务组件复用现有Button/Dialog/Field，限额使用token文字。
- MemberEditor.tsx与保存模型：支持图片开关，默认false，不自动猜模型能力。

## 1. 先建立可失败的存储/服务回归

- [ ] 新增internal/store/attachments_test.go，临时库seed服务/成员/群，保存草稿，发送绑定，读取Message.Attachments，关闭重开验证。
- [ ] 验证跨群、重复绑定、绑定不存在ID、超过4个、失败回滚、草稿删除不能删已发送附件；PRAGMA foreign_key_check为0。
- [ ] 新增app/attachments_test.go，PNG/JPEG/WebP尺寸与真实格式、PDF/TXT/MD大小、非法base64、文件名路径穿越、HTTP不暴露本机路径、清理取消草稿、群删除级联。
- [ ] 运行 `go test ./internal/store ./app -run Attachment -count=1`，将预期失败保存到/private/tmp/aidochat-020-red-store.log。

## 2. 最小存储与本地资源实现

- [ ] migration004：members.supports_images INTEGER NOT NULL DEFAULT0；messages.attachments TEXT NOT NULL DEFAULT'[]'；attachments表含id/group_id/message_id/name/mime/size/kind/text/page_count/width/height，group级联，message绑定仅允许一次；文件使用随机ID无用户路径。
- [ ] Store.InsertMessage在原事务内校验草稿属于该群且未发送，绑定并把规范元数据快照写入messages附件JSON；失败回滚。scanMessage解JSON；纯文本为[]。
- [ ] 服务导入不信任扩展名/MIME：按真实PNG/JPEG/WebP或PDF头校验；文本UTF8且拒绝NUL控制符；文档100k码点、PDF100页上限，拒绝无文本/加密文件并反馈。文件20MiB上限，图片10MiB/40MP，最多4份。
- [ ] 读取只接受随机ID，资源与数据库同一隔离目录。资源图片用正确MIME，文档下载Content-Disposition attachment、nosniff和禁止缓存。拒绝GET目录/路径穿越/不存在ID，永不执行文件正文。
- [ ] CloseService与启动清理无绑定草稿，DeleteGroup读取待清理文件后删除数据库再回收文件；失败不误删有效附件。
- [ ] 运行相关测试为GREEN，保留现有回滚测试。

## 3. 请求协议与上下文RED/GREEN

- [ ] 先新增OpenAI/Anthropic httptest，断言文本shape不变、图像块真实base64/MIME正确、不支持类型拒绝、响应错误可读。
- [ ] 新增builder测试：附件文本有消息编号/文件名/页码；图片只进选中消息，相邻user合并保留所有图片，历史裁剪不遗留图像，串并行/重试可见性保持原逻辑。
- [ ] Orchestrator.Send保持旧调用可编译（可选variadic附件），发送前针对本条图片检查所有被@目标SupportsImages；无@仅保存；文本成员读取历史图片时明确图像未提供，绝不悄悄宣称看过。
- [ ] 仅批准修改builder.go的Input附加元数据、render附加文本、cost附加图像估算、toMessages合并图像。图像使用ID占位，Build选完后再读取选中的图片，防止读入所有历史大图。
- [ ] 对当前必选附件超过成员预算的请求，在落库前报告模型/限额与缩小建议，不截断附件。图像token为明确保守粗估，和现有token估计同等边界，不承诺厂商精确计费。
- [ ] Runner复制用于整理的窗口，将附件文本计入Policy预算，再BuildRequest；Apply仍针对同ID/Seq真实来源校验，不改受保护memory.go。
- [ ] 运行 `go test ./internal/llm/... ./internal/contextbuilder ./internal/turn ./internal/memory -count=1`；先RED日志再GREEN日志。

## 4. 前端与PDF RED/GREEN

- [ ] `npm install --save-exact pdfjs-dist@6.4.299 --cache /private/tmp/agc-npm-cache`；已核对官方engines支持Node>=24，CLI固定24。不使用全局/root缓存。
- [ ] 先写纯函数测试：4份/字节/像素/页数/文本边界，错误保留草稿，生成页码来源，未知MIME拒绝；model supportsImages默认为false。
- [ ] PDF使用Vite本地worker URL，不加载外网脚本/资源，不运行文档脚本；逐页getTextContent并保留页码/换行。无文本或密码保护给出明确错误；提取结果可在预览查看。
- [ ] importAttachment传base64，不传巨大number[]，后端再次检查解码前/后长度；组件通过store/backend，不直接调用Wails。
- [ ] Composer增加“添加附件”文字按钮和隐藏file input；图片paste/drop与选择同一校验/导入链，异步导入时切群/关闭/删除能取消结果并清理。已有文本草稿在失败时保留；Enter输入法保护不变。
- [ ] AttachmentList在草稿/历史显示图片缩略图、文本/PDF文件名和大小；预览显示导入文本，不把长正文默认铺开。
- [ ] send有附件时不再仅以text为空禁用；发送中不可重复绑定，失败保留可重试草稿；成功只清理本次发送的草稿，不误清新输入。
- [ ] MemberEditor保存视觉开关；mock与Wails、真实DTO同步，老fixtures默认false，逐项修复编译引用，不降低测试断言。
- [ ] `npm --prefix frontend test` / `npm --prefix frontend run build`，本地worker确实进入dist且可离线加载。

## 5. 交付门禁

- [ ] Go vet/race全量、前端test/build，保护文件除builder外diff为空。
- [ ] 按用户明确授权用Python只替换scripts/protected.sha256中builder.go的单行哈希，不运行--update；对比其余行字节完全相同，再运行check-protected。
- [ ] 原生独立临时库QA：实际导入图片/TXT/PDF、预览、点名请求结构、缺视觉能力反馈、重启回读、路径拒绝；宣纸/夜读、960x640、Windows布局。
- [ ] 规格审查通过后质量审查；修复所有可行动发现。记录TASK020交付、未真机部分与证据路径，再提交本任务。
