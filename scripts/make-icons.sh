#!/usr/bin/env bash
# 由 build/icons/icon-master.svg 生成各平台图标（TASK-012）。
# 仅在项目所有者确认造型后运行；需要本机具备：
#   - 一个 SVG 光栅化工具：rsvg-convert 或 ImageMagick(magick/convert) 或 Inkscape
#   - macOS：sips + iconutil（生成 .icns）
#   - Windows/.ico：ImageMagick（生成 .ico）
# 产物：
#   build/darwin/icon.icns
#   build/windows/icon.ico
#   build/linux/icons/<size>.png（及 512 png 供 AppImage）
set -euo pipefail
cd "$(dirname "$0")/.."

MASTER=${MASTER:-build/icons/icon-master.svg}
[ -f "$MASTER" ] || { echo "缺少母版 $MASTER" >&2; exit 1; }

rasterize() { # <size> <out.png>
  local size="$1" out="$2"
  if command -v rsvg-convert >/dev/null; then
    rsvg-convert -w "$size" -h "$size" "$MASTER" -o "$out"
  elif command -v magick >/dev/null; then
    magick -background none -density 384 "$MASTER" -resize "${size}x${size}" "$out"
  elif command -v convert >/dev/null; then
    convert -background none -density 384 "$MASTER" -resize "${size}x${size}" "$out"
  elif command -v inkscape >/dev/null; then
    inkscape "$MASTER" -w "$size" -h "$size" -o "$out"
  else
    echo "没有可用的 SVG 光栅化工具（rsvg-convert / ImageMagick / Inkscape）" >&2
    return 1
  fi
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# macOS .icns
if command -v iconutil >/dev/null; then
  set="$tmp/icon.iconset"; mkdir -p "$set"
  for s in 16 32 128 256 512; do
    rasterize "$s" "$set/icon_${s}x${s}.png"
    rasterize "$((s * 2))" "$set/icon_${s}x${s}@2x.png"
  done
  mkdir -p build/darwin
  iconutil -c icns "$set" -o build/darwin/icon.icns
  echo "生成 build/darwin/icon.icns"
else
  echo "跳过 .icns（没有 iconutil，非 macOS）"
fi

# Windows .ico
if command -v magick >/dev/null || command -v convert >/dev/null; then
  mkdir -p build/windows
  convert_src="$(command -v magick >/dev/null && echo magick || echo convert)"
  "$convert_src" -background none "$MASTER" -define icon:auto-resize=256,128,64,48,32,16 build/windows/icon.ico
  echo "生成 build/windows/icon.ico"
else
  echo "跳过 .ico（没有 ImageMagick）"
fi

# Linux pngs
mkdir -p build/linux/icons
for s in 16 32 48 64 128 256 512; do
  rasterize "$s" "build/linux/icons/${s}x${s}.png"
done
echo "生成 build/linux/icons/*.png"
echo "完成。"
