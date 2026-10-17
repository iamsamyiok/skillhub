#!/usr/bin/env bash
# pdfctl 一键构建脚本：为当前平台编译 release 二进制并安装到 bin/。
# 用法:
#   ./build.sh              # 构建当前平台
#   ./build.sh --windows    # 交叉编译 Windows x86_64（需 mingw-w64）
#   ./build.sh --all        # Linux + Windows 都构建
set -euo pipefail
cd "$(dirname "$0")"

TARGET_DIR="target"
BIN_DIR="bin"
LINUX_BIN="$TARGET_DIR/release/pdfctl"
WIN_TARGET="x86_64-pc-windows-gnu"
WIN_BIN="$TARGET_DIR/$WIN_TARGET/release/pdfctl.exe"

mkdir -p "$BIN_DIR"

build_linux() {
    echo "==> 构建 Linux x86_64"
    cargo build --release
    cp -f "$LINUX_BIN" "$BIN_DIR/pdfctl-linux-x86_64"
    echo "    -> $BIN_DIR/pdfctl-linux-x86_64"
}

build_windows() {
    echo "==> 交叉编译 Windows x86_64 (gnu)"
    if ! rustup target list --installed | grep -q "$WIN_TARGET"; then
        echo "    安装 rustup target: $WIN_TARGET"
        rustup target add "$WIN_TARGET"
    fi
    if ! command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1; then
        echo "错误: 未找到 x86_64-w64-mingw32-gcc，请先安装 mingw-w64:" >&2
        echo "  Debian/Ubuntu: sudo apt-get install mingw-w64-x86-64" >&2
        echo "  Windows: 安装 MSYS2 后 pacman -S mingw-w64-x86_64-gcc，或用 --windows-msvc" >&2
        exit 1
    fi
    cargo build --release --target "$WIN_TARGET"
    cp -f "$WIN_BIN" "$BIN_DIR/pdfctl-windows-x86_64.exe"
    echo "    -> $BIN_DIR/pdfctl-windows-x86_64.exe"
}

case "${1:-}" in
    --windows) build_windows ;;
    --all) build_linux; build_windows ;;
    *) build_linux ;;
esac

echo "==> 完成。可用 pdfctl --help 查看命令。"
