(async () => {
  const api = await import('/wails/runtime.js')
  const report = { transport: 'native Wails restart readback', checks: {}, errors: [] }
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const until = async (fn, label, ms = 20000) => {
    void api.Events.Emit('bridge:qa-progress', label)
    const end = performance.now() + ms
    while (performance.now() < end) { const value = await fn(); if (value) return value; await sleep(50) }
    throw new Error('等待失败：' + label)
  }
  const call = (name, ...args) => api.Call.ByName('ai-group-chat/app.Service.' + name, ...args)
  const capture = async name => {
    await Promise.race([document.fonts.ready, sleep(5000)])
    await Promise.race([new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))), sleep(5000).then(() => { throw new Error('绘制帧超时') })])
    await sleep(220)
    window.__bridgeCaptureDone = ''
    await api.Events.Emit('bridge:qa-capture', name)
    await until(() => window.__bridgeCaptureDone === name, '截图 ' + name)
  }
  try {
    await until(() => document.querySelector('nav'), '界面就绪')
    const boot = await call('Bootstrap')
    const group = boot.groups.find(g => g.title === '附件原生验收')
    if (!group) throw new Error('重启后找不到验收群')
    await until(() => {
      const entry = [...document.querySelectorAll('nav button')].find(b => b.textContent.includes(group.title))
      if (!entry) return false
      entry.click()
      return true
    }, '打开验收群')
    await until(() => document.querySelector('textarea[aria-label="消息"]'), '聊天界面')
    const state = await call('OpenGroup', group.id)
    const user = state.messages.find(m => m.authorKind === 'user')
    if (!user || user.attachments.length !== 4) throw new Error('重启后附件数量不符')
    if (state.messages.filter(m => m.authorKind === 'member' && m.status === 'done').length !== 2) throw new Error('重启后回复缺失')
    for (const attachment of user.attachments) {
      const stored = await call('ReadAttachment', attachment.id)
      if (stored.id !== attachment.id || JSON.stringify(stored).includes('/private/')) throw new Error('附件身份或绝对路径异常')
      const response = await fetch(stored.url)
      if (!response.ok) throw new Error('附件资源重启后不可读：' + attachment.name)
      if ((await response.arrayBuffer()).byteLength !== stored.size) throw new Error('附件资源大小改变：' + attachment.name)
      if (attachment.kind === 'document' && !stored.text) throw new Error('文档来源文本缺失：' + attachment.name)
    }
    const pdf = user.attachments.find(a => a.name === 'sample.pdf')
    if (!pdf || !pdf.text.includes('AidoChat attachment fixture') || pdf.pageCount !== 1) throw new Error('PDF 提取结果未持久化')
    report.checks.restartAttachments = user.attachments.map(a => a.kind + ':' + a.name)
    report.checks.restartReplies = state.messages.filter(m => m.authorKind === 'member').length
    const isNight = () => ['ye', 'wujin'].includes(document.documentElement.dataset.paper)
    // 上次退出可能停在夜读，先回到宣纸再依次截两种纸。
    if (isNight()) {
      document.querySelector('[aria-label="切换昼夜"]').click()
      await until(() => !isNight(), '切回宣纸')
    }
    await capture('xuan-attachment-restart')
    document.querySelector('[aria-label="切换昼夜"]').click()
    await until(isNight, '附件夜读回读')
    await capture('ye-attachment-restart')
    report.ok = true
  } catch (error) {
    report.ok = false
    report.errors.push(String(error) + '\n' + String(error?.stack || ''))
    try { await capture('attachment-restart-failure') } catch {}
  }
  await api.Events.Emit('bridge:qa-result', report)
})()
