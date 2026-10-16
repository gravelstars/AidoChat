#!/usr/bin/env bash
# CI 中磁盘仲裁偶发忙碌；只对 Resource busy 做有限重试，其他错误立即保留失败。
set -euo pipefail
app="$1"
out="$2"
log=$(mktemp)
trap 'rm -f "$log"' EXIT
for attempt in 1 2 3; do
  if hdiutil create -volname ai-group-chat -srcfolder "$app" -ov -fs HFS+ -format UDZO "$out" >"$log" 2>&1; then
    cat "$log"
    exit 0
  else
    status=$?
  fi
  cat "$log" >&2
  if ! grep -qi 'Resource busy' "$log" || [ "$attempt" -eq 3 ]; then
    exit "$status"
  fi
  sleep 2
done
