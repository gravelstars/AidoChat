# 展示素材

在 macOS 上从仓库根目录运行：

```sh
cd frontend
npm ci
npx playwright install chromium
cd ..
SHOWCASE_PYTHON=/path/to/python-with-pillow node scripts/capture-showcase.mjs
# English README assets
SHOWCASE_PYTHON=/path/to/python-with-pillow node scripts/capture-showcase.mjs --lang=en
```

前置条件：Node 满足前端要求、已安装 Playwright Chromium、macOS Command Line Tools 的 `swift` / CoreText、Python 3 与 Pillow。Playwright 是经所有者批准的开发依赖；Pillow 是素材工具运行环境，不添加到应用依赖。脚本默认使用 PATH 中的 `python3`，也可通过 `SHOWCASE_PYTHON` 指定已有 Pillow 的解释器。

脚本默认执行 `npm run build:demo`，只在 `127.0.0.1:4173/AidoChat/` 启动预览，完成或失败后关闭自己启动的服务。已有演示服务可传 `--url=http://127.0.0.1:4173/AidoChat/`；此时不重新构建，也不关闭外部服务。首次 Swift 编译需建立 `/tmp/aidochat-showcase-swift` 缓存，可能较慢。

素材全部输出到 `docs/assets/`。中文素材保持原名，英文素材带 `.en` 后缀（如 `main-day.en.png`），`README.md` 使用英文素材，`README.zh.md` 使用中文素材。主图使用 1440×900 视口、2 倍设备像素比；PNG 实际为 2880×1800。中文使用 `zh-CN`、上海时区；英文使用 `en-US`、纽约时区；时钟固定为 `2026-10-17`，使用新建无痕浏览器上下文，不访问桌面数据、不读取真实 Key。英文流程在页面加载前写入演示语言，从而使用英文成员、群名、消息与纪要；不使用 `zh-CN` 截图冒充英文界面。中文示例为「首页要不要改单列」，英文示例为「Should the homepage go single-column?」。日间为宣纸，夜间为夜读。主图、@ 提及、串行回复顺序、纪要三种笔迹与六张设置纸样均来自实际界面；纸样仅拼接截图。`feature-memory-comparison.png` 把三个真实纪要 article 并排，`feature-conversation.png` 把真实输入顺序条和回复状态上下拼接，便于 README 保持紧凑。

`stamp.gif` / `stamp.en.gif` 来自实际点击盖章按钮创建的 CSS 动画。脚本在点击后暂停真实 Web Animations 时间轴，保留点击前首帧，随后以 50ms 间隔采样动画，组成 60 帧；没有重画落印与墨晕。最终 GIF 3 秒、循环播放；`stamp-first.png` 是点击前的静态首帧，可作为减少动效或无法显示 GIF 时的替代。其他截图尊重减少动态偏好。

`feature-privacy.png` 裁取实际设置中的模型服务一节，展示演示版不接收 Key、不请求模型的说明与虚构配置。三个静态徽章（版本、Apache-2.0、桌面平台）也由同一轮廓工具生成；版本读取 `frontend/package.json`，不请求外部徽章服务。

日夜横幅与社交图只包含产品名、一句定位与用户「我」私印。`showcase-outlines.swift` 用 CoreText 读取前端随包的 Noto Serif SC WOFF2，将每个字形写成 SVG 路径；不使用系统字体，不含 `<text>` 或远程字体引用。朱色仅用于用户私印。颜色从实际页面 token 读取。SVG 的无障碍名称保留完整文字描述。

`showcase-images.py` 用 Pillow 做调色板压缩与 GIF 编码；不裁缩主图。超过体积预算的 PNG 先做每通道 5 bit 色阶量化，以减少纸纹高频噪声；可能轻微改变纸纹与颜色层次，不重画产品内容。脚本自动校验每张 PNG 小于 500 KiB、GIF 小于 3 MiB / 3 秒、主图及社交图尺寸、SVG 无文字节点；不合格会失败。`manifest.json` 记录尺寸与体积，不写生成时间；`request-audit.json` 记录 `/AidoChat/` 子路径、外部请求列表和实际 `stamp-in` / `ink-bleed` 动画名称，出现外部请求会失败。中间帧写入 `docs/assets/_work/` 并在成功时删除，失败时保留以便排查。

这些素材属于浏览器 Chromium 演示证据，不能作为三平台原生 WebView、安装包或云模型调用的验证。
