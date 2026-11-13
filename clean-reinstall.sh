#!/bin/sh
# 绘台 Docker 版「干净重装」：清掉上一次部署 / 失败部署留下的运行态与旧程序文件，
# 然后重新拉起。解决旧容器占端口、容器名 Conflict、旧镜像与新 tag 混淆、
# 残留网络导致 compose 起不来、旧字节码被加载等重装报错。
#
# 红线：用户数据一律保留 —— data/（数据库、账号、图片）、output/（成品存档）
# 绝不删除。只清理容器、镜像、网络、字节码这些「运行态 / 程序侧」残留。
#
# 用法：
#   sh clean-reinstall.sh          # 清理 + 重新 compose up（推荐）
#   sh clean-reinstall.sh --clean  # 只清理，不启动
set -e
cd "$(dirname "$0")"

VERSION=$(sed -n 's/^VERSION *= *"\([0-9][0-9.]*\)".*/\1/p' app/config.py | head -1)
[ -n "$VERSION" ] || VERSION="未知"
IMAGE_TAR="huitai-v${VERSION}-amd64.tar"
LOG="clean-reinstall.log"

note() { echo "[清理重装] $1"; echo "$1" >> "$LOG" 2>/dev/null || true; }

note "===== $(date '+%Y-%m-%d %H:%M:%S') 开始，目标版本 ${VERSION} ====="

# 1. 已有数据：只报告，全部保留
if [ -d data ] || [ -d output ]; then
  note "检测到已有 data/ 或 output/，全部保留（数据库 / 账号 / 图片 / 成品不会删除）"
else
  note "未检测到旧数据，按全新部署处理"
fi

# 2. 运行态清理（Docker 不可用时跳过，不阻断）
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  # 2.1 先按 compose 正常停一次（尊重本项目自定义容器名）
  if [ -f docker-compose.yml ]; then
    docker compose down --remove-orphans >/dev/null 2>&1 || true
  fi

  OLD=$(docker ps -a --filter name=huitai --filter name=image-workbench --format '{{.Names}}' 2>/dev/null | tr '\n' ' ')
  if [ -n "$(echo "$OLD" | tr -d ' ')" ]; then
    note "清理旧容器: ${OLD}"
    docker rm -f ${OLD} >/dev/null 2>&1 || true
  else
    note "无旧容器"
  fi

  OLDIMG=$(docker images --filter=reference='huitai' --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | tr '\n' ' ')
  if [ -n "$(echo "$OLDIMG" | tr -d ' ')" ]; then
    note "清理旧镜像: ${OLDIMG}"
    docker rmi -f ${OLDIMG} >/dev/null 2>&1 || true
  else
    note "无旧镜像"
  fi

  for net in $(docker network ls --filter name=huitai --format '{{.Name}}' 2>/dev/null); do
    if docker network rm "$net" >/dev/null 2>&1; then note "清理旧网络: ${net}"; fi
  done
else
  note "Docker 不可用，跳过运行态清理"
fi

# 3. 旧程序文件清理（只清字节码与上一版镜像 tar）
if [ -d app ]; then
  find app -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
  find app -type f -name '*.pyc' -delete 2>/dev/null || true
  find app -type f -name '*.pyo' -delete 2>/dev/null || true
  note "已清理 app/ 下旧字节码缓存"
fi
for f in huitai-v*-amd64.tar; do
  [ -f "$f" ] || continue
  if [ "$f" != "$IMAGE_TAR" ]; then
    rm -f "$f" 2>/dev/null && note "清理旧版镜像文件: $f" || true
  fi
done
note "旧程序文件清理完成，用户数据全部保留"

if [ "${1:-}" = "--clean" ]; then
  note "仅清理模式，结束。手动启动：docker compose up -d"
  exit 0
fi

# 4. 重新拉起：优先用离线 tar，没有则本地构建
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if [ -f "$IMAGE_TAR" ]; then
    note "导入离线镜像 ${IMAGE_TAR}"
    docker load -i "$IMAGE_TAR" >/dev/null 2>&1 || note "导入失败，改用本地构建"
  fi
  if ! docker image inspect "huitai:${VERSION}" >/dev/null 2>&1; then
    note "本地构建镜像 huitai:${VERSION}"
    docker compose build >/dev/null 2>&1 || docker build --build-arg "APP_VERSION=${VERSION}" -t "huitai:${VERSION}" .
  fi
  note "启动容器"
  docker compose up -d
  note "完成。浏览器打开 http://localhost:7401 ，顶栏应显示 v${VERSION}"
else
  note "Docker 不可用，未启动。请先启动 Docker 服务再执行 docker compose up -d"
fi
exit 0