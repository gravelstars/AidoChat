(async () => {
  const api = await import('/wails/runtime.js')
  const report = { transport: 'native Wails + empty SQLite', checks: {}, errors: [] }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const until = async (fn, label) => {
    void api.Events.Emit('bridge:qa-progress', label)
    const end = performance.now() + 15000
    while (performance.now() < end) { const r = await fn(); if (r) return r; await sleep(40) }
    throw new Error('等待失败：' + label)
  }
  const assert = (condition, label) => { if (!condition) throw new Error(label) }
  const dialogs = () => [...document.querySelectorAll('dialog[open]')]
  const top = () => dialogs().at(-1)
  const button = (text, root = document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  const field = (label, root = top()) => {
    if (!root) return null
    const el = [...root.querySelectorAll('label')].find(l => l.textContent === label)
    return el && document.getElementById(el.htmlFor)
  }
  const fill = async (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true })); await sleep(70)
  }
  const call = (name, ...args) => api.Call.ByName('ai-group-chat/app.Service.' + name, ...args)
  const capture = async (name) => {
    await Promise.race([document.fonts.ready, sleep(5000)])
    await Promise.race([new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))), sleep(4000).then(() => { throw new Error('绘制帧超时') })])
    await sleep(220) // 等现有纸张与对话框过渡结束后再留存稳态截图
    window.__bridgeCaptureDone = false
    await api.Events.Emit('bridge:qa-capture', name)
    await until(() => window.__bridgeCaptureDone, '截图 ' + name)
  }
  const geometry = (labels, root = top()) => labels.map(label => {
    const r = field(label, root).getBoundingClientRect()
    return { label, top: r.top, left: r.left, width: r.width, right: r.right }
  })
  const aligned = rows => {
    assert(Math.abs(rows[0].top - rows[1].top) < 1, '第一行上下未对齐')
    if (rows.length === 4) {
      assert(Math.abs(rows[2].top - rows[3].top) < 1, '第二行上下未对齐')
      assert(Math.abs(rows[0].left - rows[2].left) < 1 && Math.abs(rows[1].left - rows[3].left) < 1, '两行列边未对齐')
    }
  }
  try {
    await until(() => button('配置成员与模型服务'), '空库首次引导')
    assert(document.querySelector('nav').textContent.includes('AidoChat'), '侧栏未更名')
    const initial = await call('Bootstrap')
    assert(initial.providers.length === 0 && initial.members.length === 0 && initial.groups.length === 0, '未使用空验收库')
    document.querySelector('[aria-label="新建群聊"]').click()
    await until(() => field('群名'), '新建群')
    await fill(field('群名'), '首次使用验收')
    assert(top().textContent.includes('还没有可邀请的成员'), '空成员未说明下一步')
    button('新建成员', top()).click()
    await until(() => field('名字'), '从群表单新建成员')
    const memberDialog = top()
    await fill(field('名字'), '首次成员')
    await fill(field('一句话简介'), '这份草稿必须保留')
    await fill(field('角色提示词'), '本地验收角色')
    assert(field('模型服务').disabled && top().textContent.includes('还没有模型服务'), '空服务缺少说明或错误下拉仍可用')
    report.checks.emptyProviderGuidance = true
    await capture('xuan-empty-provider')
    button('新建模型服务', top()).click()
    await until(() => field('服务地址'), '从成员表单新建服务')
    button('测试连接', top()).click()
    await until(() => top().textContent.includes('填入这个服务实际可用的模型名'), '空测试模型本地反馈')
    field('测试连接').scrollIntoView({ block: 'center' })
    await capture('xuan-provider-model-required')
    button('Ollama', top()).click()
    await sleep(80)
    await fill(field('名称'), '免Key验收')
    await fill(field('测试连接'), 'local-test-model')
    button('创建', top()).click()
    await until(() => top() === memberDialog && field('模型服务').value, '保存服务后自动返回并选中')
    assert(field('名字').value === '首次成员' && field('一句话简介').value === '这份草稿必须保留' && field('角色提示词').value === '本地验收角色', '服务配置丢失成员草稿')
    assert(field('模型').value === 'local-test-model', '未带回用户明确填写的模型名')
    assert(!memberDialog.textContent.includes('缺少 Key'), '免Key服务误报缺少Key')
    report.checks.draftPreservedAndProviderSelected = true
    report.checks.memberFields = geometry(['模型服务', '模型', '上下文预算', '温度'])
    aligned(report.checks.memberFields)
    await fill(field('模型'), '')
    button('创建', top()).click()
    await until(() => top().textContent.includes('填写这个服务实际可用的模型名'), '空模型字段错误')
    await fill(field('模型'), 'local-test-model')
    button('创建', top()).click()
    await until(() => field('群名'), '创建成员后回到群草稿')
    assert(field('群名').value === '首次使用验收', '新建成员丢失群名草稿')
    assert(top().querySelectorAll('button[aria-pressed="true"]').length === 1, '新成员未自动加入邀请')
    report.checks.groupDraftAndAutoInvite = true
    button('创建', top()).click()
    await until(() => document.querySelector('textarea[aria-label="消息"]'), '完成首次群聊')
    const saved = await call('Bootstrap')
    assert(saved.providers.length === 1 && saved.members.length === 1 && saved.groups.length === 1, '首次配置未持久化')
    report.checks.persistedSetup = { providers: 1, members: 1, groups: 1 }
    document.querySelector('[aria-label="切换昼夜"]').click()
    await until(() => document.documentElement.dataset.paper === 'ye', '夜读')
    button('成员').click(); await until(() => button('新建成员'), '成员页')
    button('新建成员').click(); await until(() => field('名字'), '夜读表单')
    aligned(geometry(['模型服务', '模型', '上下文预算', '温度']))
    button('编辑当前服务', top()).click()
    await until(() => field('测试连接')?.value === 'local-test-model', '编辑服务带回实际成员模型')
    report.checks.editProbeModelPrefilled = true
    field('测试连接').scrollIntoView({ block: 'center' })
    await capture('ye-provider-test-model')
    button('取消', top()).click()
    await until(() => field('名字'), '返回成员表单')
    await capture('ye-member-aligned')
    await api.Events.Emit('bridge:qa-minimum')
    await until(() => window.innerWidth <= 962, '最小窗口')
    assert(top().scrollWidth <= top().clientWidth + 1, '最小窗口表单横向溢出')
    field('温度').scrollIntoView({ block: 'end' })
    await capture('ye-member-minimum')
    button('取消', top()).click()
    button('设置').click(); await until(() => field('整理服务', document), '纪要设置')
    field('整理服务', document).scrollIntoView({ block: 'center' })
    report.checks.memoryFields = geometry(['整理服务', '整理模型'], document)
    aligned(report.checks.memoryFields)
    await capture('ye-memory-aligned')
    document.querySelector('[aria-label="切换昼夜"]').click()
    await until(() => document.documentElement.dataset.paper === 'xuan', '宣纸')
    await capture('xuan-memory-aligned')
    report.checks.minimumWidth = window.innerWidth
    report.ok = true
  } catch (e) { report.ok = false; report.errors.push(String(e) + '\n' + String(e?.stack || '')) }
  await api.Events.Emit('bridge:qa-result', report)
})()
