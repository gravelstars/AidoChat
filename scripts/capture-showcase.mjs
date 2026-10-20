#!/usr/bin/env node
/** 只操作隔离浏览器中的真实演示界面，不写产品数据，不伪造产品 DOM。 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdir, writeFile, rm, readFile, copyFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'frontend/package.json'))
const { chromium } = require('playwright')
const out = join(root, 'docs/assets')
const langArg = process.argv.find(a => a.startsWith('--lang='))?.slice(7)
const lang = langArg === 'en' ? 'en' : 'zh'
const suffix = lang === 'zh' ? '' : `.${lang}`
const work = join(out, lang === 'zh' ? '_work' : `_work-${lang}`)
const ui = lang === 'en' ? {
  closeBanner: 'Close demo notice',
  closeHint: 'Close notice',
  nav: 'Group list',
  message: 'Message',
  replyMode: 'Reply mode',
  mentionText: '@Mira @Kai Please walk through the design and implementation priorities in order.',
  groupTitle: /Should the homepage go single-column\?/,
  settings: 'Settings',
  modelServices: 'Model services',
  papers: ['Xuan', 'Su', 'Ma', 'Qing', 'Ye', 'Wujin'],
  stamp: 'Stamp',
  memoryPanel: 'Group notes',
  send: 'Send',
  stop: 'Stop',
  toggleNight: 'Toggle day/night',
} : {
  closeBanner: '关闭演示提示',
  closeHint: '关闭试用提示',
  nav: '群聊列表',
  message: '消息',
  replyMode: '多人回复方式',
  mentionText: '@墨白 @青砚 请依次说明设计与实现的重点。',
  groupTitle: /首页要不要改单列/,
  settings: '设置',
  modelServices: '模型服务',
  papers: ['宣纸', '素笺', '麻纸', '青笺', '夜读', '乌金'],
  stamp: '盖章',
  memoryPanel: '群纪要',
  send: '发送',
  stop: '停止',
  toggleNight: '切换昼夜',
}
const python = process.env.SHOWCASE_PYTHON || 'python3'
let server, browser
const supplied = process.argv.find(a => a.startsWith('--url='))?.slice(6)
const base = supplied || 'http://127.0.0.1:4173/AidoChat/'
async function ready() {
  for (let i=0;i<120;i++) {
    try { if ((await fetch(base)).ok) return } catch {}
    await new Promise(r=>setTimeout(r,250))
  }
  throw new Error(`演示服务未启动：${base}`)
}
function run(cmd,args,opts={}) {
  const result=spawnSync(cmd,args,{cwd:root,stdio:'inherit',...opts})
  if(result.status!==0) throw new Error(`${cmd} 失败 (${result.status})`)
}
try {
  await mkdir(work,{recursive:true})
  if(!supplied) {
    run('npm',['run','build:demo'],{cwd:join(root,'frontend')})
    server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort','--outDir','dist-demo','--base','/AidoChat/'],{cwd:join(root,'frontend'),stdio:'inherit'})
  }
  await ready()
  browser=await chromium.launch({headless:true})
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2,locale:lang==='en'?'en-US':'zh-CN',timezoneId:lang==='en'?'America/New_York':'Asia/Shanghai',colorScheme:'light',reducedMotion:'reduce'})
  if(lang!=='zh') await context.addInitScript((value)=>{localStorage.setItem('aidochat.demo.v1.agc.language',value)},JSON.stringify(lang))
  const page=await context.newPage()
  const requests=[]
  context.on('request',r=>{if(!r.url().startsWith(new URL(base).origin)&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))requests.push(r.url())})
  await page.clock.setFixedTime(new Date('2026-10-17T02:00:00.000Z'))
  await page.goto(base)
  for(const name of [ui.closeBanner,ui.closeHint]) {
    const button=page.getByRole('button',{name,exact:true}); if(await button.isVisible())await button.click()
  }
  await page.getByRole('navigation',{name:ui.nav}).waitFor()
  const currentGroup=page.getByRole('navigation',{name:ui.nav}).locator('button[aria-current="page"]')
  await currentGroup.waitFor()
  await page.locator('[data-tone="confirmed"]').first().waitFor()
  const stable=async()=>{await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(180)}
  const shot=async(name,options={})=>{await stable();await page.screenshot({path:join(out,`${name}${suffix}.png`),caret:'hide',...options})}
  // 日夜主图仍然是完整 1440×900 应用窗口；截图像素为两倍。
  await shot('main-day')
  const colors={}
  colors.day=await page.evaluate(()=>Object.fromEntries(['paper','ink','ink-2','cinnabar','rule'].map(k=>[k,getComputedStyle(document.documentElement).getPropertyValue(`--${k}`).trim()])))
  await page.getByRole('button',{name:ui.toggleNight,exact:true}).click()
  await shot('main-night')
  colors.night=await page.evaluate(()=>Object.fromEntries(['paper','ink','ink-2','cinnabar','rule'].map(k=>[k,getComputedStyle(document.documentElement).getPropertyValue(`--${k}`).trim()])))
  await page.getByRole('button',{name:ui.toggleNight,exact:true}).click()
  // 纪要三种笔迹：直接裁取同一真实纪要面板，保留来源与操作。
  const memory=page.getByRole('complementary',{name:ui.memoryPanel})
  for(const tone of ['confirmed','user','ai']){
    const item=memory.locator(`[data-tone="${tone}"]`).first();await item.waitFor();await item.screenshot({path:join(work,`memory-${tone}.png`),caret:'hide'})
  }
  await stable()
  await memory.screenshot({path:join(out,`feature-memory${suffix}.png`),caret:'hide'})
  // 输入真实 @ 提及并发送串行轮次；截取正在回复的顺序条和消息。
  await page.getByRole('textbox',{name:ui.message,exact:true}).fill(ui.mentionText)
  await page.getByRole('radiogroup',{name:ui.replyMode}).locator('[data-value="serial"]').click()
  await stable();await page.getByRole('textbox',{name:ui.message,exact:true}).locator('..').screenshot({path:join(out,`feature-mentions${suffix}.png`),caret:'hide'})
  await page.getByRole('button',{name:ui.send,exact:true}).click()
  await page.getByRole('button',{name:ui.stop,exact:true}).waitFor()
  await page.screenshot({path:join(out,`feature-reply-order${suffix}.png`),clip:{x:248,y:44,width:852,height:826},caret:'hide'})
  const firstReply=await page.locator('[data-seq="11"]').boundingBox(),lastReply=await page.locator('[data-seq="12"]').boundingBox()
  await page.screenshot({path:join(work,'conversation-replies.png'),clip:{x:firstReply.x,y:firstReply.y,width:firstReply.width,height:lastReply.y+lastReply.height-firstReply.y},caret:'hide'})
  await page.getByRole('button',{name:ui.stop,exact:true}).click()
  // 六张设置纸样使用同一真实设置页面；仅拼接截图，不重新绘制纸样。
  await page.getByRole('button',{name:ui.settings,exact:true}).click()
  await stable()
  await page.getByRole('heading',{name:ui.modelServices,exact:true}).locator('..').screenshot({path:join(out,`feature-privacy${suffix}.png`),caret:'hide'})
  for(const [id,name]of ui.papers.map((name,i)=>[['xuan','su','ma','qing','ye','wujin'][i],name])) {
    const radio=page.getByRole('radio',{name:new RegExp(`^${name}`)})
    await radio.click(); await stable()
    await radio.screenshot({path:join(work,`paper-${id}.png`),caret:'hide'})
  }
  await page.getByRole('radio',{name:new RegExp(`^${ui.papers[0]}`)}).click()
  await page.getByRole('navigation',{name:ui.nav}).getByRole('button',{name:ui.groupTitle}).first().click()
  // 真实盖章事件创建真实 CSS 动画，再暂停其时间轴逐帧采样（不复制动画实现）。
  await context.setDefaultTimeout(15000)
  await page.emulateMedia({reducedMotion:'no-preference'})
  const target=page.locator('[data-tone="user"]').first()
  await target.scrollIntoViewIfNeeded(); await target.hover()
  const box=await target.boundingBox()
  const clip={x:1100,y:Math.max(44,box.y-45),width:340,height:Math.min(220,900-Math.max(44,box.y-45))}
  await page.screenshot({path:join(out,`stamp-first${suffix}.png`),clip,caret:'hide'})
  await target.getByRole('button',{name:ui.stamp,exact:true}).click()
  await page.mouse.move(1000,400)
  await page.waitForFunction(()=>document.querySelector('[class*="stampAnimate"]') && document.getAnimations().filter(a=>a instanceof CSSAnimation).length>=2)
  const stampAnimations=await page.evaluate(()=>{window.__showcaseAnimations=document.getAnimations().filter(a=>a instanceof CSSAnimation&&['stamp-in','ink-bleed'].includes(a.animationName));for(const a of window.__showcaseAnimations){a.pause();a.currentTime=0}return window.__showcaseAnimations.filter(a=>a instanceof CSSAnimation).map(a=>a.animationName)})
  if(!['stamp-in','ink-bleed'].every(name=>stampAnimations.includes(name)))throw new Error(`缺少真实盖章动画：${stampAnimations.join(', ')}`)
  await copyFile(join(out,`stamp-first${suffix}.png`),join(work,'stamp-000.png'))
  for(let i=1;i<60;i++){
    await page.evaluate(ms=>{for(const a of window.__showcaseAnimations)a.currentTime=ms},(i-1)*50)
    await page.screenshot({path:join(work,`stamp-${String(i).padStart(3,'0')}.png`),clip,caret:'hide'})
  }
  colors.version=JSON.parse(await readFile(join(root,'frontend/package.json'),'utf8')).version
  await writeFile(join(work,'tokens.json'),JSON.stringify(colors))
  // 品牌图、社交卡与徽章不区分语言，只在中文素材流程里重建一次。
  if(lang==='zh') {
    run('swift',['-module-cache-path','/tmp/aidochat-showcase-swift',join(root,'scripts/showcase-outlines.swift'),root,join(work,'tokens.json'),out])
    // SVG 通过同一浏览器光栅化社交卡，字号与路径与横幅完全一致。
    for(const theme of ['day','night']){
      const svg=await readFile(join(out,`social-${theme}.svg`),'utf8')
      const card=await context.newPage();await card.setViewportSize({width:1280,height:640})
      await card.goto('data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'))
      await card.screenshot({path:join(out,`social-${theme}.png`),scale:'css'});await card.close()
    }
  }
  if(requests.length)throw new Error(`发现外部请求：${requests.join(', ')}`)
  await writeFile(join(out,`request-audit${suffix}.json`),JSON.stringify({basePath:new URL(base).pathname,externalRequests:requests,stampAnimations},null,2)+'\n')
  run(python,[join(root,'scripts/showcase-images.py'),out,lang])
  await rm(work,{recursive:true,force:true})
  console.log(`展示素材（${lang}）已生成并通过尺寸、大小和外部请求校验。`)
}finally{await browser?.close();server?.kill('SIGTERM')}
