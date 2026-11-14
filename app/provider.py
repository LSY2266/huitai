"""生图 API 适配层。

兼容目标：
- OpenAI 官方 GPT Image 2.5 / 2.6：POST /v1/images/generations、POST /v1/images/edits
- 各类中转/聚合服务：可自定义 Base URL、路径、上传字段名、图生图模式
- 局部修图：edits 的 image + mask；generations_base64 模式把 mask 作为 data URI 传入
- 多组图片/语言模型服务：调用方传入合并后的 cfg，本层不关心来源
- 响应形态：b64_json / base64 / data URI / 图片 URL / 直接返回图片二进制
- 输出：PNG / JPEG / WebP / GIF / SVG 自动嗅探并落盘，另按用户存档到 output/
另提供：请求 JSON 覆盖、提示词优化（OpenAI 兼容 LLM）、图片元信息、ZIP 打包。
"""
import base64
import io
import json
import re
import uuid
import zipfile
from datetime import datetime

import httpx
from PIL import Image, ImageOps

from . import config

MAX_SIDE = 2048

# 这些字段改由文件上传通道处理，不能出现在 JSON / form body 里，避免与 files 冲突
_FILE_KEYS = {"image", "images", "image[]", "mask", "mask[]"}


class ImageAPIError(Exception):
    pass


# ------------------------------ 请求地址与参数 ------------------------------

def endpoint(base: str, configured: str, tail: str) -> str:
    base = (base or "").strip().rstrip("/")
    if not base:
        raise ImageAPIError("尚未配置 API 地址，请管理员在「设置」中填写。")
    configured = (configured or "").strip()
    if configured:
        if configured.startswith("http://") or configured.startswith("https://"):
            return configured
        return base + (configured if configured.startswith("/") else "/" + configured)
    for suffix in ("/images/generations", "/images/edits"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
            break
    if base.endswith("/v1"):
        return base + tail
    return base + "/v1" + tail


def chat_endpoint(base: str) -> str:
    base = (base or "").strip().rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return base + "/chat/completions"
    return base + "/v1/chat/completions"


def _clean(model, prompt, size, quality, n, output_format, params):
    """兜底请求体（无 request_json 时）。

    这里刻意**不做参数白名单**：旧版按 gif/svg 白名单过滤会丢掉 `svg` 对象、
    `complexity`、`frame_size`、`aspect_ratio` 等，正是填了参数却返回静态 PNG 的
    常见原因。只排除文件上传字段和空值，其余一律透传给网关。
    """
    fmt = (output_format or "").lower()
    body = {"model": model, "prompt": prompt, "n": int(n)}
    # GIF / SVG 用 aspect_ratio + resolution 或 frame_size 控制尺寸，不能带位图的 size
    if size and size != "auto" and fmt not in ("gif", "svg"):
        body["size"] = size
    if quality:
        body["quality"] = quality
    if output_format:
        body["output_format"] = output_format
    extra = params or {}
    if isinstance(extra, str):
        try:
            extra = json.loads(extra)
        except ValueError:
            extra = {}
    if isinstance(extra, dict):
        for k, v in extra.items():
            if k in _FILE_KEYS or v is None or v == "":
                continue
            body[k] = v
    return body


def _headers(cfg, key=None):
    k = (key if key is not None else cfg.get("api_key") or "").strip()
    if not k:
        raise ImageAPIError("尚未配置 API Key，请管理员在「设置」中填写。")
    # 不写 Content-Type：JSON 请求由 httpx 的 json= 自动设置，
    # 图生图 multipart 请求必须让 httpx 自动带 boundary，否则服务端收不到文件。
    return {
        "Authorization": "Bearer " + k,
        "Accept": "application/json",
        "User-Agent": "huitai/%s" % config.VERSION,
    }


def _timeout(cfg):
    try:
        return max(30, int(float(cfg.get("timeout") or 600)))
    except ValueError:
        return 600


def _request_json(client, method, url, cfg, **kwargs):
    try:
        r = client.request(method, url, headers=_headers(cfg), **kwargs)
    except httpx.HTTPError as e:
        raise ImageAPIError("请求生图接口失败：%s" % e) from e
    if r.status_code >= 400:
        raise ImageAPIError("生图接口返回 HTTP %s：%s" % (r.status_code, _brief(r.text)))
    return r


def _brief(text, limit=1200):
    text = (text or "").strip()
    return text[:limit] + ("…" if len(text) > limit else "")


# ------------------------------ 发起生成 ------------------------------

def _body_for(task: dict) -> dict:
    """优先使用前端「请求 JSON 编辑」里定稿的完整 body；否则按旧字段拼装。"""
    rj = task.get("request_json") or {}
    if isinstance(rj, str):
        try:
            rj = json.loads(rj)
        except ValueError:
            rj = {}
    if isinstance(rj, dict) and rj:
        body = dict(rj)
        body.setdefault("model", task["model"])
        body.setdefault("prompt", task["prompt"])
        return body
    return _clean(
        task["model"], task["prompt"], task.get("size") or "auto",
        task.get("quality") or "", task.get("n") or 1,
        task.get("output_format") or "", task.get("params") or {},
    )


def generate(cfg: dict, task: dict) -> list:
    """返回 [(bytes, ext), ...]。"""
    input_names = task.get("input_images") or []
    is_edit = task.get("mode") == "i2i" and input_names
    body = _body_for(task)
    for k in _FILE_KEYS:
        body.pop(k, None)
    timeout = _timeout(cfg)
    gen_url = endpoint(cfg.get("api_base"), cfg.get("generate_path"), "/images/generations")
    mask_name = task.get("mask_image") or ""

    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        if not is_edit:
            r = _request_json(client, "POST", gen_url, cfg, json=body)
            return _parse_response(r, client)

        mode = cfg.get("i2i_mode") or "edits"
        if mode == "generations_base64":
            blobs = [_read_input(n) for n in input_names]
            body["image"] = "data:image/png;base64," + base64.b64encode(blobs[0]).decode()
            if len(blobs) > 1:
                body["images"] = ["data:image/png;base64," + base64.b64encode(b).decode() for b in blobs]
            if mask_name:
                body["mask"] = "data:image/png;base64," + base64.b64encode(_read_input(mask_name)).decode()
            r = _request_json(client, "POST", gen_url, cfg, json=body)
            return _parse_response(r, client)

        edit_url = endpoint(cfg.get("api_base"), cfg.get("edit_path"), "/images/edits")
        field = (cfg.get("edit_field") or "image[]").strip() or "image[]"
        mask_field = (cfg.get("mask_field") or "mask").strip() or "mask"
        form = {}
        for k, v in body.items():
            form[k] = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
        files = []
        for name in input_names:
            data, ext, mime = _read_input_with_meta(name)
            files.append((field, ("input_%s.%s" % (uuid.uuid4().hex[:8], ext), data, mime)))
        if mask_name:
            data, _ext, mime = _read_input_with_meta(mask_name)
            files.append((mask_field, ("mask.png", data, mime)))
        try:
            r = client.post(edit_url, headers=_headers(cfg), data=form, files=files, timeout=timeout)
        except httpx.HTTPError as e:
            raise ImageAPIError("请求图生图接口失败：%s" % e) from e
        if r.status_code >= 400:
            raise ImageAPIError("图生图接口返回 HTTP %s：%s" % (r.status_code, _brief(r.text)))
        return _parse_response(r, client)


def test_connection(cfg: dict) -> dict:
    """只探测 /models，不产生任何生图费用。"""
    base = (cfg.get("api_base") or "").strip().rstrip("/")
    if not base:
        return {"ok": False, "message": "请先填写 API 地址"}
    url = base if base.endswith("/models") else (base + "/models" if base.endswith("/v1") else base + "/v1/models")
    if not (cfg.get("api_key") or "").strip():
        return {"ok": False, "message": "请先填写 API Key"}
    import time
    t0 = time.time()
    try:
        with httpx.Client(timeout=15, follow_redirects=True) as client:
            r = client.get(url, headers=_headers(cfg))
        cost = round((time.time() - t0) * 1000)
        ok = r.status_code < 500
        return {
            "ok": ok,
            "status": r.status_code,
            "latency_ms": cost,
            "message": ("连接正常（%s ms，HTTP %s）" % (cost, r.status_code)) if ok
                       else ("服务返回 HTTP %s：%s" % (r.status_code, _brief(r.text, 300))),
        }
    except Exception as e:
        return {"ok": False, "message": "连接失败：%s" % e}


# ------------------------------ 拉取模型列表 ------------------------------

def model_list_url(base: str) -> str:
    """把任意填法的 API 地址归一成 /v1/models 的完整 URL。"""
    b = (base or "").strip().rstrip("/")
    if not b:
        raise ImageAPIError("请先填写 API 地址，再拉取模型列表。")
    for suffix in ("/images/generations", "/images/edits", "/chat/completions"):
        if b.endswith(suffix):
            b = b[: -len(suffix)]
            break
    if b.endswith("/models"):
        return b
    if b.endswith("/v1"):
        return b + "/models"
    return b + "/v1/models"


def extract_model_ids(node) -> list:
    """从 /v1/models 的多种响应形态里提取模型 ID，去重且保持接口顺序。

    兼容：OpenAI {"data":[{"id":...}]}、{"models":[...]}、顶层数组、
    纯字符串数组、以及 data/models/items/result 等嵌套容器。
    """
    out, seen = [], set()
    # 容器字段的常见元数据值，不当作模型名
    noise = {"list", "object", "success", "true", "false", "null", "data", "models"}
    id_keys = ("id", "model", "name", "model_name", "model_id", "slug", "value")

    def add(v):
        if not isinstance(v, str):
            return
        v = v.strip()
        if not v or len(v) > 200 or v.lower() in noise or v in seen:
            return
        seen.add(v)
        out.append(v)

    def walk(x):
        if isinstance(x, str):
            add(x)
        elif isinstance(x, list):
            for v in x:
                walk(v)
        elif isinstance(x, dict):
            containers = [x[k] for k in ("data", "models", "items", "list", "result", "results")
                          if isinstance(x.get(k), (list, dict))]
            if containers:
                for c in containers:
                    walk(c)
            else:
                for k in id_keys:
                    if isinstance(x.get(k), str):
                        add(x[k])
                        break

    walk(node)
    return out[:1000]


def fetch_models(cfg: dict) -> list:
    """GET /v1/models，返回去重后的模型 ID 列表；失败抛 ImageAPIError。"""
    url = model_list_url(cfg.get("api_base"))
    key = (cfg.get("api_key") or "").strip()
    if not key:
        raise ImageAPIError("请先填写 API Key（或先在设置里保存），再拉取模型列表。")
    try:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            r = client.get(url, headers=_headers(cfg, key))
    except httpx.HTTPError as e:
        raise ImageAPIError("拉取模型列表失败：%s" % e) from e
    if r.status_code >= 400:
        raise ImageAPIError("模型列表接口返回 HTTP %s：%s" % (r.status_code, _brief(r.text, 300)))
    try:
        data = r.json()
    except ValueError:
        raise ImageAPIError("模型列表接口返回的不是 JSON：%s" % _brief(r.text, 300))
    ids = extract_model_ids(data)
    if not ids:
        raise ImageAPIError("接口返回里没找到模型 ID，响应片段：%s"
                            % _brief(json.dumps(data, ensure_ascii=False), 400))
    return ids


# ------------------------------ 提示词优化（LLM） ------------------------------

def optimize_prompt(cfg: dict, prompt: str, mode: str = "t2i", fmt_kind: str = "") -> str:
    base = (cfg.get("llm_api_base") or cfg.get("api_base") or "").strip().rstrip("/")
    api_key = (cfg.get("llm_api_key") or cfg.get("api_key") or "").strip()
    if not base:
        raise ImageAPIError("尚未配置语言模型 API 地址，请管理员在「语言模型设置」中填写")
    if not api_key:
        raise ImageAPIError("尚未配置语言模型 API Key，请管理员在「语言模型设置」中填写")
    model = (cfg.get("llm_model") or "gpt-4o-mini").strip()
    # 文生图 / 图生图各用一套系统指令；旧库只有单一指令时向下兼容
    # 注意：键名变量绝不能复用 api_key，否则 _headers 会把键名当成 Bearer Token 发出去（401）
    is_i2i = (mode == "i2i")
    prompt_key = "llm_system_prompt_i2i" if is_i2i else "llm_system_prompt_t2i"
    fallback = config.DEFAULT_OPTIMIZE_PROMPT_I2I if is_i2i else config.DEFAULT_OPTIMIZE_PROMPT_T2I
    system = ((cfg.get(prompt_key) or "").strip()
              or (cfg.get("llm_system_prompt") or "").strip()
              or fallback)
    # GIF·SVG 页签沿用文生图那套指令，但把具体类型写进任务说明，
    # 这样即使用户只写「扁平化山峦 logo」没提 SVG，类型专用规则也必然触发。
    fmt_label = {"gif": "GIF 动图", "svg": "SVG 矢量图"}.get((fmt_kind or "").strip().lower(), "")
    if mode == "fmt" and fmt_label:
        task_label = ("文生图（输出类型：%s，必须套用系统指令中的「动图 / GIF / SVG / 矢量图专用规则」，"
                      "第一句以「请生成一张x图：」开头）" % fmt_label)
    else:
        task_label = "图生图" if is_i2i else "文生图"
    user_msg = "任务类型：%s\n原始描述：%s" % (task_label, prompt)
    body = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
        "temperature": 0.7,
    }
    try:
        timeout = max(20, int(float(cfg.get("llm_timeout") or 120)))
    except ValueError:
        timeout = 120
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            r = client.post(chat_endpoint(base), headers=_headers(cfg, api_key), json=body)
    except httpx.HTTPError as e:
        raise ImageAPIError("请求语言模型失败：%s" % e) from e
    if r.status_code >= 400:
        raise ImageAPIError("语言模型返回 HTTP %s：%s" % (r.status_code, _brief(r.text, 400)))
    try:
        data = r.json()
    except ValueError:
        raise ImageAPIError("语言模型返回的不是 JSON：%s" % _brief(r.text, 300))
    text = ""
    try:
        ch = (data.get("choices") or [])[0]
        content = (ch.get("message") or {}).get("content")
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            text = "".join(p.get("text", "") for p in content if isinstance(p, dict))
        if not text:
            text = ch.get("text") or ""
    except (IndexError, AttributeError, TypeError):
        pass
    if not text:
        text = data.get("output_text") or ""
    text = (text or "").strip().strip('"').strip("'").strip()
    if not text:
        raise ImageAPIError("语言模型没有返回可用的提示词")
    return text


# ------------------------------ 响应解析 ------------------------------

def _parse_response(r, client) -> list:
    ctype = (r.headers.get("content-type") or "").lower()
    if ctype.startswith("image/") or ctype in ("image/svg+xml", "application/octet-stream"):
        if r.content[:200]:
            return [(r.content, sniff_ext(r.content))]
    try:
        payload = r.json()
    except ValueError:
        text = r.text or ""
        urls = re.findall(r"https?://[^\s\"'<>)]+\.(?:png|jpe?g|webp|gif|svg)(?:\?[^\s\"'<>]*)?", text, re.I)
        if urls:
            return [_fetch_url(client, u) for u in urls[:4]]
        raise ImageAPIError("接口返回的不是 JSON，且未找到图片：%s" % _brief(text, 500))

    found = extract_payload(payload)
    if not found:
        found = _scan_plain_b64(payload)
    result = []
    for kind, value in found:
        if kind == "b64":
            try:
                raw = base64.b64decode(re.sub(r"\s+", "", value), validate=False)
            except Exception:
                continue
            if len(raw) > 100:
                result.append((raw, sniff_ext(raw)))
        else:
            try:
                result.append(_fetch_url(client, value))
            except Exception:
                continue
    if not result:
        raise ImageAPIError("接口成功但没有解析出图片，响应片段：%s" % _brief(json.dumps(payload, ensure_ascii=False), 800))
    return result


def extract_payload(node):
    """递归收集所有疑似图片的 b64 / URL，自动去重。"""
    out, seen = [], set()

    def add(kind, v):
        key = (kind, v[:120] if len(v) > 120 else v)
        if key not in seen:
            seen.add(key)
            out.append((kind, v))

    def walk(x):
        if isinstance(x, dict):
            u = x.get("url") or x.get("image_url") or x.get("download_url")
            if isinstance(u, str) and (u.startswith("http://") or u.startswith("https://") or u.startswith("data:image/")):
                add("url", u)
            for k in ("b64_json", "base64", "image_base64", "b64"):
                v = x.get(k)
                if isinstance(v, str) and len(v) > 100:
                    add("b64", v)
            for k, v in x.items():
                if k in ("b64_json", "base64", "image_base64", "b64", "url", "image_url", "download_url", "revised_prompt"):
                    continue
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
        elif isinstance(x, str):
            s = x.strip()
            if s.startswith("data:image/") and ";base64," in s:
                add("b64", s.split(",", 1)[1])
            elif re.match(r"^https?://\S+$", s) and re.search(r"\.(png|jpe?g|webp|gif|svg)(\?|$)", s, re.I):
                add("url", s)

    walk(node)
    return out


def _valid_image(raw: bytes) -> bool:
    return (raw.startswith(b"\x89PNG\r\n\x1a\n") or raw.startswith(b"\xff\xd8\xff")
            or raw[:4] == b"RIFF" or raw[:4] in (b"GIF8", b"GIF9")
            or b"<svg" in raw[:600].lower())


def _scan_plain_b64(node):
    """递归找出所有字符串，把「看起来是图片二进制的纯 base64」当成图片返回。"""
    def strings(x):
        if isinstance(x, str):
            yield x
        elif isinstance(x, dict):
            for v in x.values():
                yield from strings(v)
        elif isinstance(x, list):
            for v in x:
                yield from strings(v)

    for s in strings(node):
        s = s.strip()
        if len(s) < 300 or not re.fullmatch(r"[A-Za-z0-9+/=\s]+", s):
            continue
        try:
            raw = base64.b64decode(re.sub(r"\s+", "", s))
        except Exception:
            continue
        if _valid_image(raw):
            return [("b64", s)]
    return []


def _fetch_url(client, url):
    if url.startswith("data:image/"):
        raw = base64.b64decode(url.split(",", 1)[1])
        return raw, sniff_ext(raw)
    r = client.get(url, timeout=120, follow_redirects=True)
    r.raise_for_status()
    return r.content, sniff_ext(r.content)


def sniff_ext(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:4] in (b"GIF8", b"GIF9"):
        return "gif"
    head = data[:600].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    if head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in head) or head.startswith(b"<!--") and b"<svg" in head:
        return "svg"
    return "png"


MIME_BY_EXT = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
               "webp": "image/webp", "gif": "image/gif", "svg": "image/svg+xml"}


# ------------------------------ 图片读写 ------------------------------

def prepare_input(data: bytes) -> str:
    """归一化上传的参考图：纠正 EXIF 方向、限制像素、压成 PNG/JPEG，返回文件名。"""
    ext, out = None, None
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
        img = ImageOps.exif_transpose(img)
        if max(img.size) > MAX_SIDE:
            img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
        buf = io.BytesIO()
        if has_alpha:
            img.convert("RGBA").save(buf, format="PNG", optimize=True)
            ext = "png"
        else:
            img.convert("RGB").save(buf, format="JPEG", quality=92, optimize=True)
            ext = "jpg"
        out = buf.getvalue()
    except Exception as e:
        raise ImageAPIError("无法读取参考图（仅支持 PNG/JPEG/WEBP 等位图）：%s" % e) from e
    name = "in_%s.%s" % (uuid.uuid4().hex, ext)
    (config.IMAGES_DIR / name).write_bytes(out)
    return name


def prepare_mask(data: bytes) -> str:
    """局部修图遮罩：转成黑白 PNG，白色=需要重绘的区域，不做有损压缩。"""
    try:
        img = Image.open(io.BytesIO(data)).convert("L")
        img = img.point(lambda p: 255 if p > 127 else 0)
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        out = buf.getvalue()
    except Exception as e:
        raise ImageAPIError("无法读取遮罩图：%s" % e) from e
    name = "mask_%s.png" % uuid.uuid4().hex
    (config.IMAGES_DIR / name).write_bytes(out)
    return name


def _read_input(name: str) -> bytes:
    return _read_input_with_meta(name)[0]


def _read_input_with_meta(name: str):
    p = config.IMAGES_DIR / name
    if not p.is_file():
        raise ImageAPIError("参考图文件已丢失：%s" % name)
    ext = p.suffix.lstrip(".").lower()
    return p.read_bytes(), ext, MIME_BY_EXT.get(ext, "image/png")


def _safe_dir(username: str) -> str:
    s = re.sub(r"[^\w\u4e00-\u9fff\-]", "_", (username or "unknown").strip())
    return s[:48] or "unknown"


def _archive(task: dict, items: list):
    """成品按用户分目录写到 output/，并追加 manifest.jsonl（存档不随任务删除而删除）。"""
    folder = config.OUTPUT_DIR / _safe_dir(task.get("username"))
    folder.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    tid = (task.get("id") or "")[:8]
    lines = []
    for i, (raw, ext) in enumerate(items):
        fn = "%s_%s_%02d.%s" % (ts, tid, i + 1, ext)
        (folder / fn).write_bytes(raw)
        meta = image_meta_from_bytes(raw, ext)
        lines.append(json.dumps({
            "file": fn, "task_id": task.get("id"),
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "username": task.get("username"), "prompt": task.get("prompt"),
            "mode": task.get("mode"), "model": task.get("model"),
            "provider": task.get("provider_name") or "默认服务",
            "size": task.get("size"), "quality": task.get("quality"),
            "output_format": task.get("output_format"),
            "width": meta.get("width"), "height": meta.get("height"),
            "bytes": len(raw), "format": ext,
        }, ensure_ascii=False))
    with (folder / "manifest.jsonl").open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def save_images(task_id: str, items: list, task: dict = None) -> list:
    names = []
    for i, (raw, ext) in enumerate(items):
        name = "out_%s_%d.%s" % (task_id[:16], i, ext)
        (config.IMAGES_DIR / name).write_bytes(raw)
        names.append(name)
    if task:
        try:
            _archive(task, items)
        except Exception:
            pass  # 存档失败不影响主流程
    return names


def copy_inputs(names: list) -> list:
    """重试任务时复制参考图，避免与原任务共享文件后被删除。"""
    out = []
    for n in names:
        try:
            p = config.IMAGES_DIR / n
            if not p.is_file():
                continue
            new = "in_%s%s" % (uuid.uuid4().hex, p.suffix)
            (config.IMAGES_DIR / new).write_bytes(p.read_bytes())
            out.append(new)
        except OSError:
            continue
    return out


def copy_mask(name: str) -> str:
    if not name:
        return ""
    try:
        p = config.IMAGES_DIR / name
        if not p.is_file():
            return ""
        new = "mask_%s.png" % uuid.uuid4().hex
        (config.IMAGES_DIR / new).write_bytes(p.read_bytes())
        return new
    except OSError:
        return ""


def remove_files(names: list):
    for n in names or []:
        if not re.fullmatch(r"[A-Za-z0-9_.\-]+", str(n)):
            continue
        try:
            (config.IMAGES_DIR / n).unlink(missing_ok=True)
        except OSError:
            pass


# ------------------------------ 元信息 / 打包 ------------------------------

def image_meta_from_bytes(raw: bytes, ext: str) -> dict:
    ext = (ext or "").lstrip(".").lower()
    fmt = {"jpg": "JPEG", "jpeg": "JPEG", "png": "PNG", "webp": "WebP",
           "gif": "GIF", "svg": "SVG"}.get(ext, ext.upper() or "未知")
    out = {"format": fmt, "bytes": len(raw), "width": None, "height": None}
    if ext == "svg":
        m = re.search(rb"<svg[^>]*>", raw[:3000], re.I)
        if m:
            tag = m.group(0).decode("utf-8", "ignore")
            w = re.search(r"\bwidth=[\"']?([\d.]+)", tag)
            h = re.search(r"\bheight=[\"']?([\d.]+)", tag)
            vb = re.search(r"\bviewBox=[\"']?[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)", tag)
            if w and h:
                out["width"], out["height"] = int(float(w.group(1))), int(float(h.group(1)))
            elif vb:
                out["width"], out["height"] = int(float(vb.group(1))), int(float(vb.group(2)))
    else:
        try:
            with Image.open(io.BytesIO(raw)) as im:
                out["width"], out["height"] = im.size
        except Exception:
            pass
    return out


def image_meta(name: str):
    p = config.IMAGES_DIR / name
    if not p.is_file():
        return None
    ext = p.suffix.lstrip(".").lower()
    info = image_meta_from_bytes(p.read_bytes(), ext)
    info["name"] = name
    return info


def build_zip(entries) -> bytes:
    """entries: [(磁盘文件名, zip 内文件名), ...]"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for disk_name, arc_name in entries:
            p = config.IMAGES_DIR / disk_name
            if p.is_file():
                z.write(str(p), arc_name)
    return buf.getvalue()
