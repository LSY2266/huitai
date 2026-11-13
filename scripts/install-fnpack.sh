#!/usr/bin/env bash
# 准备 fnpack（飞牛官方 FPK 打包工具）。
# 优先用仓库内置的 Linux 二进制（海外 runner 访问官方下载站经常超时），
# 校验 SHA256 通过才使用；否则回退联网下载，并重试三次。
set -euo pipefail

FNPACK_VERSION="1.2.3"
FNPACK_SHA256="54b97fa7b70968c4d05c79840f5daeff508957d0bb2062fdb0376d00d9615c93"
FNPACK_URL="https://static2.fnnas.com/fnpack/fnpack-${FNPACK_VERSION}-linux-amd64"

# 本机已经装好（例如 macOS 开发机）就直接用，不折腾
if command -v fnpack >/dev/null 2>&1; then
    echo "使用已安装的 fnpack：$(command -v fnpack)"
    fnpack --help >/dev/null
    exit 0
fi

BIN_DIR="${RUNNER_TEMP:-/tmp}/fnpack-bin"
mkdir -p "$BIN_DIR"
TARGET="$BIN_DIR/fnpack"

if [ -f "tools/fnpack-linux-amd64" ]; then
    ACTUAL=$(sha256sum tools/fnpack-linux-amd64 | awk '{print $1}')
    if [ "$ACTUAL" = "$FNPACK_SHA256" ]; then
        cp tools/fnpack-linux-amd64 "$TARGET"
        chmod +x "$TARGET"
        echo "使用仓库内置 fnpack（SHA256 校验通过）"
    else
        echo "::warning::内置 fnpack 校验失败（$ACTUAL），改为联网下载"
    fi
fi

if [ ! -x "$TARGET" ]; then
    for i in 1 2 3; do
        if curl -fsSL --retry 3 --connect-timeout 20 --max-time 180 -o "$TARGET" "$FNPACK_URL"; then
            break
        fi
        echo "下载 fnpack 失败（第 ${i}/3 次），5 秒后重试"
        sleep 5
    done
    chmod +x "$TARGET"
    ACTUAL=$(sha256sum "$TARGET" | awk '{print $1}')
    [ "$ACTUAL" = "$FNPACK_SHA256" ] || { echo "::error::fnpack 校验失败：$ACTUAL"; exit 1; }
fi

if [ -n "${GITHUB_PATH:-}" ]; then
    echo "$BIN_DIR" >> "$GITHUB_PATH"
fi
"$TARGET" --help > /dev/null
echo "fnpack ${FNPACK_VERSION} 就绪：$TARGET"
