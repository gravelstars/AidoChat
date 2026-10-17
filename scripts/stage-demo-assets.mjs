import { copyFile, cp, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// 手机说明页与仓库主图复用同一份虚构演示截图。
const root = new URL('../', import.meta.url)
const target = new URL('frontend/dist-demo/showcase/', root)
await mkdir(target, { recursive: true })
await copyFile(new URL('docs/assets/main-day.png', root), new URL('main-day.png', target))
// Pages 也分发字体与 PDF 资源，因此必须把原始许可一起带入部署包。
for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
  await copyFile(new URL(name, root), new URL(`frontend/dist-demo/${name}`, root))
}
await cp(new URL('docs/licenses/', root), new URL('frontend/dist-demo/docs/licenses/', root), { recursive: true })
await mkdir(new URL('frontend/dist-demo/docs/qa/task-023/', root), { recursive: true })
await copyFile(new URL('docs/qa/task-023/licenses.md', root), new URL('frontend/dist-demo/docs/qa/task-023/licenses.md', root))
console.log('Demo screenshot staged:', fileURLToPath(target))
