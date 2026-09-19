#!/usr/bin/env bash
# vhs 录制 wrapper：内存预检 + timeout 兜底 + 产物验证
# 用法: ./vhs-record.sh <tape文件> [超时秒数，默认420]
set -u
TAPE="${1:?用法: $0 <tape文件> [超时秒数]}"
TIMEOUT_S="${2:-420}"
CWD="$PWD"

command -v vhs >/dev/null || { echo "未安装 vhs"; exit 1; }
[ -f "$TAPE" ] || { echo "tape 不存在: $TAPE"; exit 1; }

# 内存预检：可用低于 450MB 时警告（chromium + 演示进程的最低水位）
AVAIL_MB=$(free -m | awk '/^Mem:/{print $7}')
if [ "$AVAIL_MB" -lt 450 ]; then
  echo "警告: 可用内存仅 ${AVAIL_MB}MB，chromium 渲染可能停摆导致录制卡死"
  echo "建议: 杀掉可停的后台服务后重试，或把 tape 分辨率降到 800x500"
  read -r -p "仍要继续? [y/N] " ans
  [ "$ans" = "y" ] || exit 1
fi

BEFORE=$(ls -t ./*.gif 2>/dev/null | head -1)
timeout "$TIMEOUT_S" vhs "$TAPE"
RC=$?

# vhs 渲染完成后可能在清理阶段永久挂住，被 timeout 杀掉(exit 124)时
# GIF 已经完整落盘，不算失败
if [ $RC -eq 124 ]; then
  echo "vhs 被 timeout 收尾(清理阶段挂住属已知问题)，检查产物完整性"
elif [ $RC -ne 0 ]; then
  echo "vhs 异常退出: $RC"; exit $RC
fi

# 产物验证：tape 的 Output 相对当前 CWD，找出新出现的 gif
AFTER=$(ls -t ./*.gif docs/*.gif 2>/dev/null | head -1)
if [ "$AFTER" != "$BEFORE" ] && [ -s "$AFTER" ]; then
  SIZE=$(du -h "$AFTER" | cut -f1)
  FRAMES=$(python3 -c "from PIL import Image;print(Image.open('$AFTER').n_frames)" 2>/dev/null || echo "?")
  echo "产物: $AFTER ($SIZE, ${FRAMES}帧)"
  echo "下一步: python3 gif-trim.py $AFTER <成品路径>"
else
  echo "未发现新 GIF，按 SKILL.md 故障表排查（优先看第1条内存问题）"
  exit 2
fi

# 清理可能的孤儿 ttyd（vhs 清理失败的遗留）
ps aux | grep "ttyd --port" | grep -v grep | awk '{print $2}' | xargs -r kill 2>/dev/null
exit 0
