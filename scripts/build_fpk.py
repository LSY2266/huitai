#!/usr/bin/env python3
"""把 packaging/fnos 渲染成指定架构的 FPK 安装包。

为什么需要它：飞牛的 manifest 是纯文本 INI，一个包只能声明一种架构；
双架构发布要么打两次包、要么两个目录各维护一份 manifest。这里用模板
渲染（版本号取自 app/config.py，platform 取自 --arch），避免两处手改走偏。

用法：
  python3 scripts/build_fpk.py --arch x86 --image ghcr.io/tarocats/huitai:2.1.1
  python3 scripts/build_fpk.py --arch arm --out-dir dist
"""
import argparse
import hashlib
import io
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "packaging" / "fnos"
CONFIG_PY = ROOT / "app" / "config.py"
APP_NAME = "huitai"
ARCHS = {"x86": "x86", "arm": "arm"}


def app_version() -> str:
    m = re.search(r'(?m)^VERSION\s*=\s*"([0-9][0-9.]*)"', CONFIG_PY.read_text(encoding="utf-8"))
    if not m:
        sys.exit(f"错误：{CONFIG_PY} 里找不到 VERSION = \"x.y.z\"")
    return m.group(1)


def render(stage: Path, version: str, arch: str, image: str) -> None:
    manifest = stage / "manifest"
    text = manifest.read_text(encoding="utf-8")
    text, n1 = re.subn(r"(?m)^version\s*=.*$", f"version               = {version}", text)
    text, n2 = re.subn(r"(?m)^platform\s*=.*$", f"platform              = {arch}", text)
    if not (n1 and n2):
        sys.exit("错误：manifest 缺少 version 或 platform 行")
    manifest.write_text(text, encoding="utf-8")

    compose = stage / "app" / "docker" / "docker-compose.yaml"
    ctext = compose.read_text(encoding="utf-8")
    if "__IMAGE__" not in ctext:
        sys.exit("错误：docker-compose.yaml 里没有 __IMAGE__ 占位符")
    compose.write_text(ctext.replace("__IMAGE__", image), encoding="utf-8")


def verify(fpk: Path, version: str, arch: str, image: str) -> None:
    with tarfile.open(fpk) as tar:
        names = set(tar.getnames())
        for need in ("manifest", "app.tgz", "cmd/main", "config/privilege", "config/resource",
                     "ICON.PNG", "ICON_256.PNG"):
            if need not in names:
                sys.exit(f"错误：{fpk.name} 内缺少 {need}")
        manifest = tar.extractfile("manifest").read().decode("utf-8")
        # 注意：tar 关闭后 extractfile 返回的句柄会失效，必须先读进内存
        app_tgz = tar.extractfile("app.tgz").read()

    def field(key: str) -> str:
        m = re.search(rf"(?m)^{key}\s*=\s*(.*)$", manifest)
        return (m.group(1).strip() if m else "")

    problems = []
    if field("appname") != APP_NAME:
        problems.append(f"appname={field('appname')!r}，期望 {APP_NAME!r}")
    if field("version") != version:
        problems.append(f"version={field('version')!r}，期望 {version!r}")
    if field("platform") != arch:
        problems.append(f"platform={field('platform')!r}，期望 {arch!r}")
    if not field("checksum"):
        problems.append("manifest 缺少 fnpack 写入的 checksum")

    # app.tgz 里必须是渲染后的真实镜像，而不是 __IMAGE__ 占位符
    with tempfile.TemporaryDirectory() as tmp:
        with tarfile.open(fileobj=io.BytesIO(app_tgz)) as inner:
            inner.extractall(tmp, filter="data")
        compose = Path(tmp) / "docker" / "docker-compose.yaml"
        if not compose.exists():
            problems.append("app.tgz 内缺少 docker/docker-compose.yaml")
        else:
            body = compose.read_text(encoding="utf-8")
            if image not in body:
                problems.append(f"app.tgz 内的镜像不是 {image}")
            if "__IMAGE__" in body:
                problems.append("app.tgz 内仍残留 __IMAGE__ 占位符")

    if problems:
        sys.exit("错误：" + "；".join(problems))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--arch", required=True, choices=sorted(ARCHS))
    ap.add_argument("--version", default=None, help="默认取 app/config.py 的 VERSION")
    ap.add_argument("--image", default=None, help="默认 ghcr.io/tarocats/huitai:<version>")
    ap.add_argument("--appname", default=APP_NAME)
    ap.add_argument("--out-dir", default=str(ROOT / "dist"))
    args = ap.parse_args()

    version = args.version or app_version()
    arch = ARCHS[args.arch]
    image = args.image or f"ghcr.io/tarocats/{args.appname}:{version}"
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    fnpack = shutil.which("fnpack")
    if not fnpack:
        sys.exit("错误：PATH 里找不到 fnpack，请先安装 fnpack 1.2.3")

    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp) / "stage"
        shutil.copytree(SRC, stage)
        # 模板里可能残留的构建产物不要带进包
        for junk in stage.glob("*.fpk"):
            junk.unlink()
        render(stage, version, arch, image)

        proc = subprocess.run([fnpack, "build", "--directory", str(stage)],
                              cwd=stage, text=True, capture_output=True)
        if proc.returncode != 0:
            sys.exit(f"错误：fnpack build 失败\n{proc.stdout}\n{proc.stderr}")
        built = sorted(stage.glob("*.fpk"))
        if len(built) != 1:
            sys.exit(f"错误：期望生成 1 个 fpk，实际 {len(built)} 个")

        target = out_dir / f"{args.appname}_{version}_{arch}.fpk"
        shutil.move(str(built[0]), target)

    verify(target, version, arch, image)
    data = target.read_bytes()
    print(f"FPK      : {target}")
    print(f"版本/架构: {version} / {arch}")
    print(f"镜像     : {image}")
    print(f"大小     : {len(data)} 字节")
    print(f"SHA256   : {hashlib.sha256(data).hexdigest()}")


if __name__ == "__main__":
    main()
