#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# 工具与缓存仅放临时目录，不更改应用依赖。
LICENSE_TOOLS_DIR="${LICENSE_TOOLS_DIR:-${TMPDIR:-/tmp}/aidochat-license-tools}"
export LICENSE_TOOLS_DIR
mkdir -p "$LICENSE_TOOLS_DIR/bin"
npm install --prefix "$LICENSE_TOOLS_DIR" --cache "$LICENSE_TOOLS_DIR/npm-cache" --no-audit --no-fund license-checker-rseidelsohn@4.4.2
GOBIN="$LICENSE_TOOLS_DIR/bin" go install github.com/google/go-licenses/v2@v2.0.1
GOBIN="$LICENSE_TOOLS_DIR/bin" go install github.com/google/licenseclassifier/v2/tools/identify_license@v2.0.0
node scripts/export-licenses.mjs
