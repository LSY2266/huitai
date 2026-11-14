#!/bin/sh
# 在有 Docker 的机器上执行，生成可直接导入飞牛 / Docker 的离线镜像 tar
# 产物永远落在「本脚本所在目录」，与你在哪个目录执行无关。
# 版本号唯一来源：app/config.py 的 VERSION（后续变更只改那一处，+0.0.1）。
set -e
cd "$(dirname "$0")"

VERSION=$(sed -n 's/^VERSION *= *"\([0-9][0-9.]*\)".*/\1/p' app/config.py | head -1)
if [ -z "$VERSION" ]; then
  echo "错误：在 app/config.py 里找不到 VERSION = \"x.y.z\"" >&2
  exit 1
fi
IMAGE_TAG="huitai:${VERSION}"

# Git Bash 下把 /e/... 转成 E:/...，Linux / 飞牛 NAS 下直接用 POSIX 路径
if OUT_WIN="$(pwd -W 2>/dev/null)"; then
  OUT_DIR="$OUT_WIN"
else
  OUT_DIR="$(pwd)"
fi
OUT_FILE="$OUT_DIR/huitai-v${VERSION}-amd64.tar"

echo "版本: $VERSION（来源 app/config.py）"
echo "构建目录: $OUT_DIR"
echo "产物将保存到: $OUT_FILE"
echo ""

docker build --build-arg "APP_VERSION=${VERSION}" -t "$IMAGE_TAG" .
docker save "$IMAGE_TAG" -o "$OUT_FILE"

echo ""
echo "==================== 生成完成 ===================="
echo "镜像 tar 存放地址:"
echo "  $OUT_FILE"
if [ -f "$OUT_FILE" ]; then
  echo "文件信息:"
  ls -lh "$OUT_FILE" 2>/dev/null || true
fi
echo ""
echo "导入镜像:  docker load -i \"$OUT_FILE\""
echo "或构建启动: docker compose up -d --build"
echo "================================================="