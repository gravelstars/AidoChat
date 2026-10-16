#!/usr/bin/env bash
# 校验受保护文件未被改动。用法：
#   scripts/check-protected.sh           校验（执行者在交付前必须运行，CI 门禁）
#   scripts/check-protected.sh --update  重新生成指纹（仅限项目所有者，执行者禁止运行）
set -euo pipefail
cd "$(dirname "$0")/.."
list=scripts/protected.txt
sums=scripts/protected.sha256

hash() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
files() { grep -v '^\s*#' "$list" | grep -v '^\s*$' | grep -v '^scripts/protected.sha256$'; }

if [[ "${1:-}" == "--update" ]]; then
  files | while read -r f; do
    [[ -f "$f" ]] || { echo "缺少文件 $f" >&2; exit 1; }
    hash "$f"
  done > "$sums"
  echo "已更新 $(wc -l < "$sums" | tr -d ' ') 个受保护文件的指纹"
  exit 0
fi

fail=0
while read -r expected path; do
  if [[ ! -f "$path" ]]; then echo "✗ 缺失：$path"; fail=1; continue; fi
  actual=$(hash "$path" | awk '{print $1}')
  [[ "$actual" == "$expected" ]] || { echo "✗ 被改动：$path"; fail=1; }
done < "$sums"
for path in $(files); do
  grep -q "  $path\$" "$sums" || { echo "✗ 清单里有但未登记指纹：$path"; fail=1; }
done
if [[ $fail -ne 0 ]]; then
  echo "受保护文件被改动。请撤销改动，在任务单里写阻塞记录交项目所有者决定。"
  exit 1
fi
echo "✓ 受保护文件完好"
