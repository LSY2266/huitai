#!/usr/bin/env python3
"""维护仓库根目录的 fnpack.json —— FnDepot 第三方应用源索引（V2 规范）。

每次发版把新的版本节点写进去，指向 GitHub Release 里的 FPK 资产（不落库、不复制），
客户端按自身架构挑包。已经发布过的版本保持不动（同版本号不静默替换）。

用法：
  python3 scripts/gen_fnpack.py --version 2.1.1 \
      --package x86=dist/huitai_2.1.1_x86.fpk \
      --package arm=dist/huitai_2.1.1_arm.fpk \
      --base-url https://github.com/TaroCats/huitai/releases/download/v2.1.1 \
      --changelog-file dist/notes.md --notes-out dist/release-notes.md
"""
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "packaging" / "fnos" / "manifest"
APP_KEY = "huitai"
PORT = "7401"
ARCHS = ("x86", "arm")
MAX_RELEASES = 10  # 索引只留最近若干版本，历史上的版本仍可从 Release 页取

# 仓库地址优先取 CI 里的 GITHUB_REPOSITORY：fork 或换到上游发版时不用改代码
REPO_SLUG = os.environ.get("GITHUB_REPOSITORY") or "TaroCats/huitai"
REPO_URL = f"https://github.com/{REPO_SLUG}"

# 图标/README 用绝对地址：相对路径要客户端自己拼基准 URL，换成绝对 URL 更稳（与已上架的源一致）
ICON_URL = f"{REPO_URL}/raw/main/packaging/fnos/ICON_256.PNG"
README_URL = f"{REPO_URL}#readme"

SOURCE_INFO = {
    "name": "绘台 Huitai",
    "author": REPO_SLUG.split("/")[0],
    "homepage": REPO_URL,
    "description": "绘台 AI 生图工作台的应用源：随着打 tag 自动跟随新版本，指向 GitHub Release 里的官方安装包。",
}


def read_manifest() -> dict:
    data = {}
    if not MANIFEST.is_file():
        return data
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def version_key(v: str):
    parts = re.split(r"[.\-+]", v)
    key = []
    for p in parts:
        key.append((0, int(p)) if p.isdigit() else (1, p))
    return key


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True)
    ap.add_argument("--package", action="append", required=True,
                    metavar="ARCH=PATH", help="可重复，arch 取值 x86 / arm")
    ap.add_argument("--base-url", required=True, help="Release 资产下载前缀，不带结尾斜杠")
    ap.add_argument("--changelog", default="")
    ap.add_argument("--changelog-file", default=None)
    ap.add_argument("--notes-out", default=None)
    ap.add_argument("--out", default=str(ROOT / "fnpack.json"))
    ap.add_argument("--updated-at", default=None, help="ISO 8601，默认取当前 UTC 时间")
    args = ap.parse_args()

    if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
        sys.exit(f"错误：版本号必须是 x.y.z，收到 {args.version!r}")

    updated_at = args.updated_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    changelog = args.changelog
    if args.changelog_file and Path(args.changelog_file).is_file():
        changelog = Path(args.changelog_file).read_text(encoding="utf-8").strip()

    packages, sizes = {}, {}
    for item in args.package:
        if "=" not in item:
            sys.exit(f"错误：--package 需写成 ARCH=PATH，收到 {item!r}")
        arch, path = item.split("=", 1)
        arch = arch.strip().lower()
        if arch not in ARCHS:
            sys.exit(f"错误：架构只能是 {ARCHS}，收到 {arch!r}")
        fpk = Path(path)
        if not fpk.is_file():
            sys.exit(f"错误：找不到 FPK {fpk}")
        data = fpk.read_bytes()
        packages[arch] = {
            "download_url": f"{args.base_url.rstrip('/')}/{fpk.name}",
            "sha256": hashlib.sha256(data).hexdigest(),
            "size": len(data),
            "updated_at": updated_at,
        }
        sizes[arch] = len(data)
    if set(packages) != set(ARCHS):
        sys.exit(f"错误：x86 与 arm 必须同时提供，当前只有 {sorted(packages)}")

    out = Path(args.out)
    index = {}
    if out.is_file():
        try:
            index = json.loads(out.read_text(encoding="utf-8"))
            if index.get("schema_version") != "2":
                print("警告：现有 fnpack.json 不是 V2，将重建", file=sys.stderr)
                index = {}
        except json.JSONDecodeError as exc:
            print(f"警告：现有 fnpack.json 解析失败（{exc}），将重建", file=sys.stderr)
            index = {}

    app = (index.get("apps") or {}).get(APP_KEY) or {}
    releases = app.get("releases") or {}
    if args.version in releases:
        print(f"注意：版本 {args.version} 已存在，按本次构建产物覆盖其安装包信息")

    manifest = read_manifest()
    releases[args.version] = {
        # os_min_version 写在每个版本节点里：客户端按它判断本机系统能不能装
        "os_min_version": manifest.get("os_min_version", "0.9.27"),
        "changelog": changelog or f"绘台 Huitai {args.version}",
        "updated_at": updated_at,
        "packages": packages,
    }
    # 新版本在前，多余的旧版本裁掉
    ordered = sorted(releases.items(), key=lambda kv: version_key(kv[0]), reverse=True)[:MAX_RELEASES]

    app = {
        "display_name": "绘台",
        "desc": ("AI 生图工作台：手机浏览器直接打开，接入 GPT Image 2.5 / 2.6 及任何 OpenAI 兼容生图接口，"
                 "支持文生图、图生图、局部修图、GIF 动图、SVG 矢量图。"
                 "任务提交后由服务端执行，关页面、锁屏、重启服务都不会丢。"),
        "platform": list(ARCHS),
        "categories": ["AI赋能", "影音娱乐"],
        "icon_url": ICON_URL,
        "readme_url": README_URL,
        "bug_report_url": f"{REPO_URL}/issues",
        "maintainer": "TaroCats",
        "maintainer_url": "https://github.com/TaroCats",
        "distributor": "TaroCats",
        "distributor_url": REPO_URL,
        "run_as": "package",
        "install_type": "",
        "is_docker": True,
        "service_port": PORT,
        "releases": dict(ordered),
    }

    index = {
        "schema_version": "2",
        "source_info": SOURCE_INFO,
        "apps": {APP_KEY: app},
    }
    out.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已写入 {out}")
    print(f"{APP_KEY} {args.version}: " + " / ".join(f"{a} {sizes[a]}B" for a in ARCHS))

    if args.notes_out:
        # 不写标题行：Release 标题已经是「绘台 Huitai <版本>」，正文从内容开始
        lines = []
        if changelog:
            lines += [changelog, ""]
        lines += ["## 镜像", "",
                  f"- `ghcr.io/tarocats/huitai:{args.version}`（linux/amd64 + linux/arm64 多架构）",
                  f"- `ghcr.io/tarocats/huitai:latest`", "",
                  "## 安装包", ""]
        for arch in ARCHS:
            lines.append(f"- `{packages[arch]['download_url'].rsplit('/', 1)[-1]}`"
                         f"（{arch}，{sizes[arch]} 字节）")
        lines += ["", "## 飞牛 / FnDepot 更新", "",
                  "- 飞牛应用中心手动安装上面任一 FPK；",
                  f"- 或在 FnDepot 里添加源 `{REPO_URL}`，之后自动跟随本版本更新。"]
        Path(args.notes_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.notes_out).write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"已写入 {args.notes_out}")


if __name__ == "__main__":
    main()
