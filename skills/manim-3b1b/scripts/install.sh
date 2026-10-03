#!/usr/bin/env bash
# 安装 Manim + 3Blue1Brown 风格动画 + 中文配音 所需全部依赖（Ubuntu/Debian）
# 注意：manim 与 edge-tts 都装在「系统 Python」（/usr/bin/python3），
#       若当前 shell 的 python3 是 pyenv 版本，请用 /usr/bin/python3 跑配音/合成脚本。
set -e

echo "==> 1/4 系统依赖（ffmpeg / cairo / pango / CJK 字体 / espeak-ng 离线降级）"
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq || true
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ffmpeg libcairo2-dev libpango1.0-dev pkg-config python3-dev libffi-dev \
  fonts-noto-cjk espeak-ng

echo "==> 2/4 安装 manim（Python 包）"
# --break-system-packages            : 绕过 PEP 668 外部管理限制
# --ignore-installed typing-extensions : 跳过系统自带 typing_extensions 的卸载冲突
sudo pip3 install --break-system-packages --ignore-installed typing-extensions manim

echo "==> 3/4 安装配音相关（edge-tts 主用 / gTTS 备用 / pydub 处理）"
sudo pip3 install --break-system-packages --ignore-installed typing-extensions edge-tts gTTS pydub

echo "==> 4/4 修复 click 版本冲突（gTTS 会把 click 降级，导致 manim 依赖的 cloup 失效）"
sudo pip3 install --break-system-packages 'click>=8.5,<9'

echo "==> 完成。版本校验："
manim --version 2>/dev/null || echo "manim 未就绪（请检查 python3 是否为系统版本）"
python3 -c "import edge_tts; print('edge-tts OK')" 2>/dev/null || /usr/bin/python3 -c "import edge_tts; print('edge-tts OK (system python)')"
