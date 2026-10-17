(async () => {
  const api = await import('/wails/runtime.js')
  const report = { transport: 'native Wails + SQLite + synthetic attachment model', checks: {}, errors: [] }
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const until = async (fn, label, ms = 20000) => {
    void api.Events.Emit('bridge:qa-progress', label)
    const end = performance.now() + ms
    while (performance.now() < end) { const value = await fn(); if (value) return value; await sleep(50) }
    throw new Error('等待失败：' + label)
  }
  const assert = (value, label) => { if (!value) throw new Error(label) }
  const call = (name, ...args) => api.Call.ByName('ai-group-chat/app.Service.' + name, ...args)
  const top = () => [...document.querySelectorAll('dialog[open]')].at(-1)
  const button = (text, root = document) => root && [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  const field = (text, root = top()) => {
    const label = root && [...root.querySelectorAll('label')].find(l => l.textContent === text)
    return label && document.getElementById(label.htmlFor)
  }
  const fill = async (element, value) => {
    const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true })); await sleep(80)
  }
  const capture = async name => {
    await Promise.race([document.fonts.ready, sleep(5000)])
    await Promise.race([new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))), sleep(5000).then(() => { throw new Error('绘制帧超时') })])
    await sleep(220)
    window.__bridgeCaptureDone = ''
    await api.Events.Emit('bridge:qa-capture', name)
    await until(() => window.__bridgeCaptureDone === name, '截图 ' + name)
  }
  const fixtureFile = (name, alias = name) => {
    const mime = { png: 'image/png', txt: 'text/plain', md: 'text/markdown', pdf: 'application/pdf' }[name.split('.').at(-1)]
    const raw = atob(window.__attachmentQAFixtures[name])
    return new File([Uint8Array.from(raw, c => c.charCodeAt(0))], alias, { type: mime })
  }
  const importFile = async (name, alias = name) => {
    const input = document.querySelector('input[type="file"][accept*=".pdf"]')
    assert(input, '附件文件输入不存在')
    const transfer = new DataTransfer(); transfer.items.add(fixtureFile(name, alias))
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(100)
  }
  const drafts = () => [...document.querySelectorAll('ul[aria-label="待发送附件"] li')]
  const preview = name => document.querySelector('[aria-label="预览附件：' + name + '"]')
  const alert = text => [...document.querySelectorAll('[role="alert"]')].some(e => e.textContent.includes(text))
  let group
  try {
    await until(() => document.querySelector('nav'), '界面就绪')
    await api.Events.Emit('bridge:qa-fixtures')
    await until(() => window.__attachmentQAFixtures?.['sample.pdf'], '独立合成附件样本')
    const boot = await call('Bootstrap')
    assert(boot.members.length === 2 && boot.providers.length === 1, '不是附件独立验收库')
    document.querySelector('[aria-label="新建群聊"]').click()
    await until(() => field('群名'), '附件验收群表单')
    await fill(field('群名'), '附件原生验收')
    for (const pick of top().querySelectorAll('button[aria-pressed="false"]')) pick.click()
    await until(() => top()?.querySelectorAll('button[aria-pressed="true"]').length === 2, '选择两位成员')
    button('创建', top()).click()
    await until(() => document.querySelector('textarea[aria-label="消息"]'), '附件验收群')
    group = (await call('Bootstrap')).groups.find(g => g.title === '附件原生验收')
    assert(group, '验收群未持久化')

    const probe = await call('ImportAttachment', { groupId: group.id, name: 'backend.png', mime: 'image/png', base64: window.__attachmentQAFixtures['sample.png'], text: '', pageCount: 0 })
    let rejected = ''
    try { await call('SendWithAttachments', group.id, '@青砚 检查这张图', null, [probe.id]) } catch (e) {
      rejected = [e?.name, e?.message, String(e), e?.cause && JSON.stringify(e.cause)].filter(Boolean).join(' | ')
    }
    assert(rejected.includes('青砚') && /图片|视觉/.test(rejected), '后端未阻止无视觉成员：' + rejected)
    assert((await call('OpenGroup', group.id)).messages.filter(m => m.authorKind === 'user').length === 0, '视觉拒绝仍写入了用户消息')
    await call('RemoveDraftAttachment', probe.id)
    report.checks.backendVisionPreflight = true

    await importFile('sample.png')
    await until(() => drafts().length === 1, '真实文件输入导入图片')
    await fill(document.querySelector('textarea[aria-label="消息"]'), '@青砚 图片能力检查')
    button('发送').click()
    await until(() => alert('青砚'), '无视觉成员前端反馈')
    assert(drafts().length === 1 && document.querySelector('textarea[aria-label="消息"]').value.includes('图片能力检查'), '发送失败丢失草稿')
    await capture('xuan-attachment-vision-error')
    document.querySelector('[aria-label="移除附件：sample.png"]').click()
    await until(() => drafts().length === 0, '移除未发送附件')
    report.checks.failedSendKeepsDraft = true

    button('成员').click()
    for (const name of ['青砚', '墨白']) {
      await until(() => button('新建成员'), '成员名册')
      const card = [...document.querySelectorAll('main button')].find(b => b.querySelector('h2')?.textContent === name)
      assert(card, '找不到成员 ' + name); card.click()
      await until(() => field('名字'), '编辑视觉能力 ' + name)
      const check = top().querySelector('input[type="checkbox"]')
      assert(check, '缺少图片能力开关'); if (!check.checked) check.click()
      button('保存', top()).click()
      await until(() => !top(), '保存视觉能力 ' + name)
    }
    ;[...document.querySelectorAll('nav button')].find(b => b.textContent.includes(group.title)).click()
    await until(() => document.querySelector('textarea[aria-label="消息"]'), '返回附件群')

    await importFile('sample.png'); await until(() => drafts().length === 1, '图片重新导入')
    await importFile('sample.txt'); await until(() => drafts().length === 2, '中文文本导入')
    await importFile('sample.md'); await until(() => drafts().length === 3, 'Markdown导入')
    await importFile('sample.pdf'); await until(() => drafts().length === 4 || alert('PDF'), '本地PDF worker导入', 40000)
    assert(drafts().length === 4, 'PDF未导入：' + [...document.querySelectorAll('[role="alert"]')].map(e => e.textContent).join(' | '))
    preview('sample.pdf').click()
    await until(() => top()?.textContent.includes('AidoChat attachment fixture - page 1'), 'PDF提取结果预览')
    assert(top().textContent.includes('第 1 页'), 'PDF正文无页码来源')
    await capture('xuan-pdf-preview')
    top().querySelector('[aria-label="关闭"]').click()
    await until(() => !top(), '关闭PDF预览')
    await importFile('sample.txt', 'fifth.txt')
    await until(() => alert('4'), '附件数量限制')
    assert(drafts().length === 4, '数量上限导致已有草稿丢失')
    const before = await call('OpenGroup', group.id)
    const requestedMode = [...document.querySelectorAll('[role="radiogroup"][aria-label="多人回复方式"] button')].find(b => b.textContent.trim() === '同时')
    assert(requestedMode, '缺少并行模式'); requestedMode.click()
    await fill(document.querySelector('textarea[aria-label="消息"]'), '@所有人 检查附件原生链路与真实来源')
    button('发送').click()
    await until(async () => {
      const state = await call('OpenGroup', group.id)
      return !state.busy && state.messages.filter(m => m.authorKind === 'member' && m.status === 'done').length === 2
    }, '带四份附件并行回复', 30000)
    const after = await call('OpenGroup', group.id)
    const sent = after.messages.find(m => m.authorKind === 'user')
    assert(sent?.attachments?.length === 4 && sent.replyMode === 'parallel', '附件身份或并行模式未保存')
    assert(after.messages.length === before.messages.length + 3, '发送出现额外/缺失消息')
    assert(drafts().length === 0, '发送成功仍保留原附件草稿')
    const pdf = sent.attachments.find(a => a.name === 'sample.pdf')
    assert(pdf.text.includes('AidoChat attachment fixture') && pdf.pageCount === 1, 'PDF提取内容未持久化')
    for (const attachment of sent.attachments) {
      const stored = await call('ReadAttachment', attachment.id)
      assert(stored.id === attachment.id && !JSON.stringify(stored).includes('/private/'), '附件暴露本机路径或身份改变')
      const response = await fetch(stored.url)
      assert(response.ok && response.headers.get('x-content-type-options') === 'nosniff', '附件资源不可读或缺少类型防护')
      assert((await response.arrayBuffer()).byteLength === stored.size, '原始资源大小改变')
    }
    report.checks.persistedAttachmentKinds = sent.attachments.map(a => a.kind + ':' + a.mime)
    report.checks.pdfWorkerAndPageSource = true
    report.checks.parallelAttachmentReply = true
    report.checks.selectedAttachmentIDs = sent.attachments.map(a => a.id)
    const isNight = () => ['ye', 'wujin'].includes(document.documentElement.dataset.paper)
    if (isNight()) {
      document.querySelector('[aria-label="切换昼夜"]').click()
      await until(() => !isNight(), '切回宣纸')
    }
    const rootStyle = getComputedStyle(document.documentElement)
    report.checks.paperBeforeChat = document.documentElement.dataset.paper + '/' + rootStyle.getPropertyValue('--paper').trim()
    await capture('xuan-attachment-chat')
    await sleep(800)
    document.querySelector('[aria-label="切换昼夜"]').click()
    await until(isNight, '附件夜读')
    await api.Events.Emit('bridge:qa-minimum')
    await until(() => window.innerWidth <= 962, '附件最小窗口')
    assert(document.documentElement.scrollWidth <= window.innerWidth + 1, '附件聊天横向溢出')
    await capture('ye-attachment-minimum')

    await importFile('no-text.pdf')
    await until(() => alert('文本') || alert('OCR'), '扫描PDF说明', 30000)
    assert(drafts().length === 0, '空文本PDF被假装成已理解附件')
    await importFile('invalid.pdf')
    await until(() => alert('损坏') || alert('无效'), '损坏PDF说明', 30000)
    assert(drafts().length === 0, '损坏PDF被保存')
    const traversal = await fetch('/attachments/..%2Fdata.db')
    assert(!traversal.ok, '附件路径穿越可读')
    report.checks.invalidPDFAndLimits = true
    report.checks.pathTraversalRejected = true
    report.checks.windowWidth = window.innerWidth
    report.ok = true
  } catch (error) {
    report.ok = false
    report.errors.push(String(error) + '\n' + String(error?.stack || ''))
    try { await capture('attachment-failure') } catch {}
  }
  await api.Events.Emit('bridge:qa-result', report)
})()
