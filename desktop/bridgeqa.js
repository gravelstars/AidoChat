(async () => {
  const api = await import('/wails/runtime.js')
  const report = { transport: 'native Wails + SQLite + turn.Orchestrator', model: 'deterministic local test provider', checks: {}, errors: [] }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  window.addEventListener('error', (e) => { void api.Events.Emit('bridge:qa-diagnostic', e.message) })
  window.addEventListener('unhandledrejection', (e) => { void api.Events.Emit('bridge:qa-diagnostic', String(e.reason)) })
  const until = async (fn, label, timeout = 20000) => {
    void api.Events.Emit('bridge:qa-progress', label)
    const end = performance.now() + timeout
    while (performance.now() < end) { const result = await fn(); if (result) return result; await sleep(30) }
    throw new Error('等待失败：' + label)
  }
  const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
  const fill = async (el, text) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(60)
  }
  const call = (name, ...args) => api.Call.ByName('ai-group-chat/app.Service.' + name, ...args)
  const capture = async (name) => {
    void api.Events.Emit('bridge:qa-progress', '等待字体与绘制：' + name)
    await Promise.race([document.fonts.ready, sleep(5000).then(() => { throw new Error('字体未在 5 秒内就绪') })])
    await Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), sleep(3000).then(() => { throw new Error('窗口未在 3 秒内产生绘制帧') })])
    window.__bridgeCaptureDone = false
    await api.Events.Emit('bridge:qa-capture', name)
    await until(() => window.__bridgeCaptureDone, '截图 ' + name)
  }
  try {
    await until(() => document.querySelector('[aria-label="新建群聊"]'), '应用启动')
    document.querySelector('[aria-label="新建群聊"]').click()
    await until(() => document.querySelector('dialog[open] input'), '新建群对话框')
    await fill(document.querySelector('dialog[open] input'), '桥接验收')
    const picks = document.querySelectorAll('dialog[open] button[aria-pressed]')
    if (picks.length !== 2) throw new Error('未载入验收成员')
    picks[0].click(); await sleep(30); picks[1].click(); await sleep(30)
    button('创建').click()
    await until(() => document.querySelector('textarea[aria-label="消息"]'), '新群已打开')
    let boot = await call('Bootstrap')
    const group = boot.groups.find((g) => g.title === '桥接验收')
    if (!group) throw new Error('真实存储中没有新群')
    report.checks.createViaUI = true
    const area = () => document.querySelector('textarea[aria-label="消息"]')
    await fill(area(), '@青砚 @墨白 请讨论桥接验收。')
    button('发送').click()
    const serial = await until(async () => {
      const d = await call('OpenGroup', group.id)
      return d.messages.length === 3 && d.messages.every((m) => m.status === 'done') && !d.busy ? d : null
    }, '依次回复完成')
    report.checks.serialContext = { seq: serial.messages[2].seq, contextSeq: serial.messages[2].contextSeq, expected: serial.messages[1].seq }
    if (serial.messages[2].contextSeq !== serial.messages[1].seq) throw new Error('第二位没有读到第一位')
    report.checks.longReplyCharacters = serial.messages[2].content.length
    await until(() => document.querySelector('#msg-3')?.textContent.includes('读至 #2'), '溯源显示')
    document.querySelector('#msg-3').scrollIntoView({block:'start'})
    await capture('xuan-serial')
    document.querySelector('[aria-label="切换昼夜"]').click()
    await until(() => document.documentElement.dataset.paper === 'ye', '夜读')
    button('同时').click(); await sleep(50)
    await fill(area(), '@青砚 @墨白 现在同时讨论。')
    button('发送').click()
    await until(() => document.querySelectorAll('article[aria-busy="true"]').length === 2, '两位同时生成')
    await until(() => [...document.querySelectorAll('article[aria-busy="true"]')].every((m) => m.textContent.includes('桥接验收记录')), '两位都有增量')
    document.querySelector('#msg-5').scrollIntoView({block:'start'})
    await capture('ye-parallel')
    const start = performance.now()
    await fill(area(), '流式期间输入框仍能编辑')
    await new Promise((r) => requestAnimationFrame(r))
    report.checks.typingDuringStreaming = { value: area().value, observedMs: performance.now() - start }
    const frames = []
    let previous = performance.now()
    await new Promise((resolve) => {
      const step = (now) => { frames.push(now - previous); previous = now; if (frames.length < 25) requestAnimationFrame(step); else resolve() }
      requestAnimationFrame(step)
    })
    report.checks.framesDuringStreaming = { count: frames.length, maxMs: Math.max(...frames), averageMs: frames.reduce((a, b) => a + b) / frames.length }
    button('停止').click()
    const stopped = await until(async () => {
      const d = await call('OpenGroup', group.id)
      return d.messages.length === 6 && !d.busy && d.messages.slice(4).every((m) => m.status === 'stopped') ? d : null
    }, '停止收尾')
    report.checks.parallelContext = stopped.messages.slice(4).map((m) => m.contextSeq)
    report.checks.stoppedCharacters = stopped.messages.slice(4).map((m) => m.content.length)
    if (!stopped.messages.slice(4).every((m) => m.content.length > 0 && m.contextSeq === 4)) throw new Error('并行上下文或中断正文异常')
    await until(() => document.querySelector('#msg-6')?.textContent.includes('已中断'), '中断文案')
    await sleep(100)
    document.querySelector('#msg-6 button').scrollIntoView({block:'center'})
    await capture('ye-stopped')
    report.checks.stoppedAndRetryVisible = !!button('重新生成')
    // TASK-005：点“重新生成”应在原位置重新生成（保留 Seq，不改变消息顺序与数量）。
    const stoppedId = stopped.messages[4].id
    const stoppedSeq = stopped.messages[4].seq
    const countBefore = stopped.messages.length
    button('重新生成').click()
    const retried = await until(async () => {
      const d = await call('OpenGroup', group.id)
      const m = d.messages.find((x) => x.id === stoppedId)
      return m && m.status === 'done' && m.content.length > 0 && !d.busy ? d : null
    }, '重新生成完成')
    const after = retried.messages.find((x) => x.id === stoppedId)
    report.checks.retryInPlace = { sameId: after.id === stoppedId, seq: after.seq, expectedSeq: stoppedSeq, count: retried.messages.length, expectedCount: countBefore, status: after.status, chars: after.content.length }
    if (after.seq !== stoppedSeq) throw new Error('重试改变了消息编号')
    if (retried.messages.length !== countBefore) throw new Error('重试改变了消息数量')

    // TASK-007：成员的新建与编辑
    const navItem = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
    const isNight = () => ['ye', 'wujin'].includes(document.documentElement.dataset.paper)
    if (isNight()) {
      document.querySelector('[aria-label="切换昼夜"]').click()
      await until(() => !isNight(), '日间')
    }
    navItem('成员').click()
    await until(() => button('新建成员'), '成员页')
    button('新建成员').click()
    await until(() => document.querySelector('dialog[open] input'), '成员编辑器')
    await fill(document.querySelector('dialog[open] input'), '拾遗')
    await capture('members-day')
    const select = document.querySelector('dialog[open] select')
    if (select && select.options.length > 1) {
      select.value = select.options[1].value
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(30)
    }
    const modelInput = [...document.querySelectorAll('dialog[open] input')].find((i) => (i.placeholder || '').includes('deepseek'))
    if (!modelInput) throw new Error('找不到模型输入框')
    await fill(modelInput, 'bridge-qa-stream')
    button('创建').click()
    await until(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('拾遗')), '新成员出现在名册')
    report.checks.memberCreatedFromUI = true
    document.querySelector('[aria-label="切换昼夜"]').click()
    await until(() => isNight(), '夜读')
    await capture('members-night')
    // 打开编辑对话框验证编辑入口
    const card = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('拾遗'))
    card.click()
    await until(() => document.querySelector('dialog[open]')?.textContent.includes('编辑'), '编辑对话框')
    report.checks.memberEditorReopen = true
    document.querySelector('dialog[open] [aria-label="关闭"]').click()
    await sleep(60)
    // 新成员也应出现在「新建群聊」的邀请列表里
    document.querySelector('[aria-label="新建群聊"]').click()
    await until(() => document.querySelector('dialog[open] input'), '新建群对话框')
    if (![...document.querySelectorAll('dialog[open] button')].some((b) => b.textContent.includes('拾遗'))) throw new Error('新成员未出现在邀请列表')
    report.checks.newMemberInPicker = true
    document.querySelector('dialog[open] [aria-label="关闭"]').click()
    await sleep(60)

    // TASK-008：设置页
    if (isNight()) {
      document.querySelector('[aria-label="切换昼夜"]').click()
      await until(() => !isNight(), '日间')
    }
    navItem('设置').click()
    await until(() => document.body.textContent.includes('模型服务') && document.body.textContent.includes('纪要整理'), '设置页')
    await capture('settings-day')
    button('新建服务').click()
    await until(() => document.querySelector('dialog[open]')?.textContent.includes('服务地址'), '服务对话框')
    report.checks.settingsProviderDialog = true
    await capture('settings-provider')
    document.querySelector('dialog[open] [aria-label="关闭"]').click()
    await sleep(60)
    const scroller = [...document.querySelectorAll('section')].find((el) => el.scrollHeight > el.clientHeight + 50)
    if (scroller) scroller.scrollTop = scroller.scrollHeight
    await sleep(80)
    await capture('settings-lower')

    // §11 跨平台验收：六种纸 + 紧凑密度 + 大字号（macOS 截图）
    const radio = (name) => [...document.querySelectorAll('button[role="radio"]')].find((b) => b.textContent.includes(name))
    radio('麻纸').click()
    await sleep(150)
    await capture('paper-ma')
    radio('乌金').click()
    await sleep(150)
    await capture('paper-wujin')
    radio('大').click()
    radio('紧凑').click()
    await sleep(120)
    const readingSec = [...document.querySelectorAll('section')].find((s) => s.textContent.includes('正文字号'))
    if (readingSec) readingSec.scrollIntoView({ block: 'start' })
    await sleep(120)
    await capture('reading-compact-large')

    // TASK-009：群管理
    const rail = document.querySelector('nav[aria-label="群聊列表"]')
    const groupRow = [...rail.querySelectorAll('button')].find((b) => b.textContent.includes('桥接验收'))
    groupRow.click()
    await until(() => document.querySelector('[aria-label="群管理"]'), '回到聊天')
    document.querySelector('[aria-label="群管理"]').click()
    await until(() => document.querySelector('dialog[open]')?.textContent.includes('群设置'), '群设置对话框')
    await capture('group-settings')
    const dialog = document.querySelector('dialog[open]')
    const before = (await call('OpenGroup', group.id)).group.memberIds.length
    const removeBtns = [...dialog.querySelectorAll('button')].filter((b) => b.textContent.trim() === '移出')
    if (removeBtns.length !== before) throw new Error('成员行数量不对：' + removeBtns.length)
    removeBtns[removeBtns.length - 1].click()
    await sleep(50)
    button('保存').click()
    const afterRemove = await until(async () => {
      const d = await call('OpenGroup', group.id)
      return d.group.memberIds.length === before - 1 ? d : null
    }, '成员已移出')
    report.checks.groupMemberRemoved = { before, after: afterRemove.group.memberIds.length }
    report.checks.groupSystemMessage = afterRemove.messages.some((m) => m.authorKind === 'system' && m.content.includes('你移出了'))
    // 归档
    const menuBtn = [...rail.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('管理「桥接验收'))
    menuBtn.click()
    await until(() => button('归档'), '归档菜单')
    button('归档').click()
    await until(() => rail.textContent.includes('已归档'), '已归档区')
    report.checks.groupArchived = true
    await capture('group-archived')

    // TASK-013：头像图片的保存与读取
    const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' // 1×1 透明 GIF
    const avatarUrl = await call('UploadAvatar', 'probe.gif', 'image/gif', gif)
    report.checks.avatarUrl = avatarUrl
    const res = await fetch(avatarUrl)
    report.checks.avatarServed = res.ok && (res.headers.get('content-type') || '').includes('gif')
    const trav = await fetch('/avatars/%2e%2e%2fdata.db')
    report.checks.avatarTraversal404 = trav.status === 404
    const memberId = afterRemove.group.memberIds[0]
    await call('SetGroupAvatar', group.id, memberId, { glyph: '甲', color: 'shiqing', image: avatarUrl })
    await until(() => !!document.querySelector(`img[src="${avatarUrl}"]`), '头像图片出现在界面')
    report.checks.avatarImgRendered = true
    await capture('avatar-image')
    report.ok = true
  } catch (error) { report.errors.push(String(error)); report.ok = false }
  await api.Events.Emit('bridge:qa-result', report)
})()
