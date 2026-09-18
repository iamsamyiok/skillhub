#!/usr/bin/env bash
# build.sh — 一键视频管线：拉起 demo 实例 → 录屏 → 配音 → 合成
# 用法: bash build.sh [--only s1,s3] [--force]
# 注意: 本脚本面向目标项目布局（上级目录需有 bin/cli.js，本目录需含 record/tts/compose.js）。
# 把本 skill 的 scripts/ 目录复制到目标项目（如 video/ 目录）后使用。
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
PORT=3777
ONLY="${1:-} ${2:-}"

echo "=== 1/4 拉起演示实例（隔离临时数据目录） ==="
DEMO_DIR=$(mktemp -d /tmp/kg-video-XXXXXX)
KG_DATA_DIR="$DEMO_DIR" PORT=$PORT node bin/cli.js --demo --no-open --host 127.0.0.1 &
DEMO_PID=$!
trap 'kill $DEMO_PID 2>/dev/null || true' EXIT

for i in $(seq 1 40); do
  if curl -s -m 2 "http://localhost:$PORT/api/meta" >/dev/null 2>&1; then break; fi
  sleep 1
done
echo "演示实例就绪: http://localhost:$PORT（数据目录 $DEMO_DIR）"
sleep 2

echo "=== 2/4 分镜录屏 ==="
node "$(dirname "$0")/record.js" $ONLY

echo "=== 3/4 AI 配音 ==="
node "$(dirname "$0")/tts.js" $ONLY

echo "=== 4/4 合成 ==="
node "$(dirname "$0")/compose.js" $ONLY

echo ""
echo "完成 → out/final.mp4"
