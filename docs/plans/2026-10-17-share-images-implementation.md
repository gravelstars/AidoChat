# TASK-021 分享图片 Implementation Plan

> 执行：superpowers:subagent-driven-development，先RED后实现，再规格与质量复核。所有者已批准起止消息、自动分页、html-to-image以及新业务组件/契约。

**Goal:** 在真实桌面应用中，将选定起止范围导出为不截断、长度受限的多张PNG。
**Architecture:** 选择冻结快照→独立白名单导出DOM→按语义测量分页→逐页PNG Blob预览→原生选目录→后端会话写入并原子发布整组图片。
**Tech Stack:** 现有ReactMarkdown/remarkGfm、Wails、Go标准库、html-to-image固定1.11.13。不加入通用UI库。

## 文件职责与接口

- frontend/src/features/share/ShareExportDialog.tsx/.module.css：现有Dialog/Field/Button/Segmented选择、开关、进度、预览、取消和保存。
- frontend/src/features/share/SharePage.tsx/.module.css：冻结快照白名单渲染，仅姓名、印章/头像、时间(可选)、正文、附件摘要及页码。ReactMarkdown同GFM，代码保留原文并仅导出自动换行。禁止直接克隆含模型信息/交互按钮的生产MessageItem DOM。
- frontend/src/lib/share/{snapshot,paginate,fonts,render}.ts：范围校验/快照、真实DOM高度分页、实际字形本地字体筛选、逐页渲染与释放。
- frontend/src/features/chat/ChatView.tsx/.module.css：文字“分享图片”入口；消息菜单或选择模式提供起点/终点，不添加新图标。
- frontend/src/backend/{contract,wails,mock}.ts：beginShareExport({title,pageCount})→{sessionId,cancelled}；writeShareExportPage({sessionId,index,pngBase64})；commitShareExport(sessionId)→{count,folderName}；cancelShareExport(sessionId)。组件只调backend/store。
- app/share_export.go/tests：纯Go导出会话、PNG/尺寸/序号验证、受控目录、暂存/取消/提交清理。Service注入SelectExportDirectory回调，业务不依赖Wails。
- desktop/shell.go：原生选择目录回调，应用启动时注入service；QA专用构建可注入临时目录，生产不允许前端传任意本机路径。

## 1. 范围与快照 RED/GREEN

- [ ] 先测起止包含两端、非法逆序、不存在seq、pending/streaming拒绝、排序、空群、已删除成员、用户当前显示名/私印。
- [ ] snapshot选择seq闭区间并structuredClone允许字段，所有provider/model/key/path字段从对象级丢弃，不渲染后用CSS藏。附件仅公开名/类型/图URL，不含提取全文或源路径。
- [ ] 默认群名/日期/姓名/AidoChat署名，群名/时间/署名可关；选当前纸或宣纸，预览改选使旧任务失效并释放旧Blob URL。

## 2. DOM分页 RED/GREEN

- [ ] 单元回归至少包含文本逐字回拼、Unicode字素边界、代码换行、表格行续页、20/21页和无法容纳报错。DOM测量与真实字体在原生QA校验，不能只伪造尺寸声称通过。
- [ ] 导出离屏根固定width1080，非display:none/opacity0，data-paper作用域，关闭动画，不影响聊天滚动；await document.fonts.ready和所有image.decode。
- [ ] 每页预留完整页头/页尾；尝试整条消息，按ceil实际scrollHeight/rect.height<=10000判定。整条放不下先下一页，空页仍过高才分块。
- [ ] 语义块p/heading/list-item/blockquote/pre/table/image顺序处理，重建author/续标记。长段落用TreeWalker映射文本UTF16位置，Intl.Segmenter(grapheme)边界二分最大可放前缀；Range.cloneContents保留strong/link/inline-code，剩余下页。每片需实测含包装、边距与姓名。单字素无法容纳直接错误，禁止零进度循环。
- [ ] 列表/引用递归保留包装，ol start保持编号；代码pre-wrap和overflow-wrap:anywhere，先按原始代码行二分，单行过高再按字素分段，不丢空白或换行。
- [ ] 表格table-layout:fixed;width100%，单元格可换行，按tbody tr拆页并重复thead。宽表格无法保证可读时明确停止提示，不丢列/不缩到看不清；单元格超过空页时按文本字素拆为续行，耗尽格为空，逐格回拼必须与原文一致。
- [ ] 页数>20立即清理并提示缩小范围；每页scrollWidth<=clientWidth，不允许横向裁切。图片限制到页内完整缩略，不裁掉图像内容。

## 3. 字体与PNG RED/GREEN

- [ ] `npm install --save-exact html-to-image@1.11.13 --cache /private/tmp/agc-npm-cache`。
- [ ] 筛选导出DOM实际使用的font-family、weight及字符unicode-range，按本地CSS @font-face只嵌所需woff2；禁止全量嵌入所有中文分片。字体CSS对整次任务缓存复用，字体加载失败要明确报错，不无声换字造成预览/文件不同。
- [ ] toCanvas设置pixelRatio:1、width1080、height实际；toBlob PNG后立即canvas.width=canvas.height=0，只留Blob/objectURL。逐页处理，不先建10000px×20的大canvas。
- [ ] decode/校验所有PNG宽1080、高1..10000；截图需实际内容，不能只验证文件存在/纯色。macOS WebKit对本地字体、SVG foreignObject与图片资源原生验收；不适配时报告证据再修复，不静默回退成纯文本。
- [ ] 改范围、关闭预览、失败及离开群时abort任务、revoke所有ObjectURL、清理离屏DOM；旧异步结果不能覆盖新预览。

## 4. 本地保存 RED/GREEN

- [ ] 先Go测试：目录选择取消、伪造PNG、超宽/超高、重复/缺失页序、21页、非法session、写入失败、取消、重复导出不覆盖、提交失败回收、shutdown无残留。
- [ ] Wails真实API：`application.Get().Dialog.OpenFile().CanChooseDirectories(true).CanChooseFiles(false).CanCreateDirectories(true).AttachToWindow(shell.window).SetTitle("选择分享图片保存位置").PromptForSingleSelection()`；空string=取消。
- [ ] 目录由原生选择，不接受前端路径；随机session绑定目录和最多20页，PNG数据逐页base64到后端，先检查编码长度再解码，PNG DecodeConfig检查真实类型与尺寸。单页压缩大小上限由常量限制并提示，不能绕过图片像素限额。
- [ ] 同目录隐藏随机暂存文件夹0700、PNG0600，O_EXCL序号文件，写入/flush/close成功后登记；complete要求所有1..N页，rename整个文件夹到唯一“群名-日期-短随机ID”。不覆盖任何旧文件、避免整组半成功。
- [ ] cancel/error/timeout/CloseService清理暂存；后端操作session锁，防取消/写入竞态。回传folderName/count，不暴露本机绝对路径；用户可在已选择目录查看。
- [ ] mock只模拟保存成功或浏览器明确下载每页，不能把mock下载当桌面保存验收。

## 5. 原生验证与交付

- [ ] 用临时QA库构造足够长的中英文消息、代码长行、表格、附件、已删除成员与完整显示名；选择区间生成>=2页，保存到QA临时目录。
- [ ] 核对PNG逐页尺寸/非空内容、字体/头像/正文渲染、起止范围与正文回拼、不泄露model/provider/path；宣纸与夜读截图、960x640预览、Windows布局。
- [ ] 全量Go vet/race，npm test/build，check-protected；本任务不需要新的保护例外。
- [ ] 规格与质量复审通过后提交；更新使用手册、统一版本/打包/安装/CI，归档过程并清理源码缓存。
