"""无额外图像应用依赖：Pillow 压缩真实截图、拼接纸样与编码 GIF。"""
import json, sys
from pathlib import Path
from PIL import Image, ImageOps
root = Path(sys.argv[1])
# PNG 使用确定性的自适应调色板；保留截图分辨率，避免超出 README 单张预算。
for path in sorted(root.glob('*.png')):
    im = Image.open(path).convert('RGB')
    im.quantize(colors=128, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)
    if path.stat().st_size >= 500 * 1024:
        # 高频纸纹影响 PNG 预算；5bit 量化保留尺寸与文本，避免缩小主图。
        ImageOps.posterize(im, 5).quantize(colors=128).save(path, optimize=True)
papers = [Image.open(root / '_work' / f'paper-{p}.png').convert('RGB') for p in ('xuan','su','ma','qing','ye','wujin')]
w, h = max(im.width for im in papers), max(im.height for im in papers)
canvas = Image.new('RGB', (w * 6, h), papers[0].getpixel((0,0)))
for i, im in enumerate(papers): canvas.paste(im, (i*w, 0))
canvas.quantize(colors=128).save(root / 'feature-papers.png', optimize=True)
# 纪要比较与对话特写只拼接真实元素截图，留白使用截图自身的纸色。
for name, inputs, horizontal in [
    ('feature-memory-comparison.png',[root/'_work'/f'memory-{t}.png' for t in ('confirmed','user','ai')],True),
    ('feature-conversation.png',[root/'feature-mentions.png',root/'_work'/'conversation-replies.png'],False),
]:
    ims=[Image.open(p).convert('RGB') for p in inputs]
    size=(sum(i.width for i in ims),max(i.height for i in ims)) if horizontal else (max(i.width for i in ims),sum(i.height for i in ims))
    panel=Image.new('RGB',size,ims[0].getpixel((0,0)));offset=0
    for im in ims:
        panel.paste(im,(offset,0) if horizontal else (0,offset));offset+=im.width if horizontal else im.height
    panel.quantize(colors=128).save(root/name,optimize=True)
frames = [Image.open(p).convert('RGB') for p in sorted((root / '_work').glob('stamp-*.png'))]
# 一个共享调色板避免静止的文字在相邻帧闪烁。
palette = frames[-1].quantize(colors=128)
quantized = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in frames]
quantized[0].save(root / 'stamp.gif', save_all=True, append_images=quantized[1:], duration=50, loop=0, optimize=True, disposal=1)
files = {}
for path in sorted(root.glob('*')):
    if path.suffix == '.png':
        with Image.open(path) as im:
            if path.name.startswith('main-'): assert im.size == (2880, 1800), (path, im.size)
            if path.name.startswith('social-'): assert im.size == (1280, 640), (path, im.size)
            assert path.stat().st_size < 500 * 1024, (path, path.stat().st_size)
            files[path.name] = {'width': im.width, 'height': im.height, 'bytes': path.stat().st_size}
    if path.suffix == '.svg':
        data=path.read_text()
        assert '<text' not in data.lower() and '<image' not in data.lower(), path
        if not path.name.startswith('badge-'): assert 'width="1280"' in data, path
        files[path.name]={'bytes':path.stat().st_size,'outlined':True}
with Image.open(root / 'stamp.gif') as im:
    assert im.n_frames >= 3, 'GIF 必须包含真实落印与墨晕的多个不同帧'
    duration=0
    for frame in range(im.n_frames):
        im.seek(frame); duration += im.info.get('duration',0)
    assert duration == 3000, duration
    assert (root / 'stamp.gif').stat().st_size < 3 * 1024 * 1024
    files['stamp.gif']={'width':im.width,'height':im.height,'durationMs':duration,'frames':im.n_frames,'bytes':(root/'stamp.gif').stat().st_size}
(root / 'manifest.json').write_text(json.dumps({'fixture':'mock:g1 首页改版评审','viewport':[1440,900],'deviceScaleFactor':2,'clock':'2026-10-17T02:00:00.000Z','files':files}, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(files,ensure_ascii=False,indent=2))
