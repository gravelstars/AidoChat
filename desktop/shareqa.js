(async () => {
  const api = await import('/wails/runtime.js')
  const report = { transport: 'native Wails + SQLite + share export', checks: {}, errors: [] }
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const until = async (fn, label, ms = 30000) => {
    void api.Events.Emit('bridge:qa-progress', label)
    const end = performance.now() + ms
    while (performance.now() < end) { const value = await fn(); if (value) return value; await sleep(50) }
    throw new Error('等待失败：' + label)
  }
  const call = (name, ...args) => api.Call.ByName('ai-group-chat/app.Service.' + name, ...args)
  const top = () => [...document.querySelectorAll('dialog[open]')].at(-1)
  const button = (text, root = document) => root && [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  const capture = async name => {
    await Promise.race([document.fonts.ready, sleep(5000)])
    await Promise.race([new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))), sleep(5000).then(() => { throw new Error('绘制帧超时') })])
    await sleep(250)
    window.__bridgeCaptureDone = ''
    await api.Events.Emit('bridge:qa-capture', name)
    await until(() => window.__bridgeCaptureDone === name, '截图 ' + name)
  }
  const pages = () => {
    const text = top()?.textContent ?? ''
    return Number(/共\s*(\d+)\s*张图片/.exec(text)?.[1] ?? 0)
  }
  try {
    await until(() => document.querySelector('nav'), '界面就绪')
    await call('SetUserProfile', { displayName: '子鹏 · Sam Altman', seal: { text: '子鹏之印', style: 'zhuwen' } })
    const boot = await call('Bootstrap')
    const group = boot.groups.find(g => g.title === '测试-01')
    if (!group) throw new Error('QA 群未创建')
    await until(() => {
      const entry = [...document.querySelectorAll('nav button')].find(b => b.textContent.includes(group.title))
      if (!entry) return false
      entry.click()
      return true
    }, '打开分享验收群')
    await until(() => document.querySelector('textarea[aria-label="消息"]'), '聊天界面')
    await until(() => button('分享图片'), '分享入口')
    button('分享图片').click()
    await until(() => top()?.textContent.includes('预览'), '分享对话框')
    await until(() => pages() >= 2, '自动分页生成至少两页', 40000)
    report.checks.pageCount = pages()
    report.checks.authorName = (await call('Bootstrap')).userDisplayName
    const next = button('下一页', top())
    if (next && !next.disabled) { next.click(); await sleep(400) }
    await capture('xuan-share-preview')
    button('保存图片', top()).click()
    await until(() => top()?.textContent.includes('已保存'), '保存成功', 40000)
    report.checks.saved = /已保存[^」]*」?[^\n]*/.exec(top().textContent)?.[0] ?? ''
    await capture('xuan-share-saved')
    top().querySelector('[aria-label="关闭"]').click()
    await until(() => !top(), '关闭分享对话框')

    document.querySelector('[aria-label="切换昼夜"]').click()
    await until(() => ['ye', 'wujin'].includes(document.documentElement.dataset.paper), '夜读纸')
    button('分享图片').click()
    await until(() => top()?.textContent.includes('预览'), '夜读分享对话框')
    await until(() => pages() >= 2, '夜读自动分页', 40000)
    report.checks.nightGroupTitle = top().textContent.includes('测试-01')
    await capture('ye-share-preview')
    await api.Events.Emit('bridge:qa-minimum')
    await until(() => window.innerWidth <= 962, '分享最小窗口')
    await sleep(300)
    await capture('ye-share-minimum')
    report.checks.windowWidth = window.innerWidth
    report.ok = true
  } catch (error) {
    report.ok = false
    report.errors.push(String(error) + '\n' + String(error?.stack || ''))
    try { await capture('share-failure') } catch {}
  }
  await api.Events.Emit('bridge:qa-result', report)
})()
