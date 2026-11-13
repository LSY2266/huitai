"""FastAPI 入口：HTTP API + 静态前端 + 后台 worker 生命周期。

鉴权分两层（可叠加）：
1. 访问密码 access_key（可选网关锁，Header X-Access-Key 或 ?k=）
2. 用户会话 token（HttpOnly Cookie iw_session，或 X-Auth-Token / ?t=）
管理员可管理设置与服务，普通用户只能操作自己的任务与图片。
"""
import base64
import io
import json
import logging
import re
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, provider, worker

STATIC_DIR = config.ROOT / "app" / "static"
FILENAME_RE = re.compile(r"^[\w.\-]+$", re.UNICODE)
COOKIE_NAME = "iw_session"
COOKIE_AGE = 30 * 86400


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    cfg = db.get_settings()
    try:
        n = int(cfg.get("concurrency") or 1)
    except ValueError:
        n = 1
    worker.pool.start(n)
    yield
    worker.pool.stop()


app = FastAPI(title="绘台 Huitai", version=config.VERSION, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ------------------------------ 鉴权 ------------------------------

def check_access(request: Request):
    key = (db.get_settings().get("access_key") or "").strip()
    if not key:
        return True
    given = request.headers.get("X-Access-Key") or request.query_params.get("k") or ""
    if given != key:
        raise HTTPException(401, "ACCESS_KEY_INVALID" if given else "ACCESS_KEY_REQUIRED")
    return True


def _token(request: Request) -> str:
    return (request.cookies.get(COOKIE_NAME) or request.headers.get("X-Auth-Token")
            or request.query_params.get("t") or "")


def optional_user(request: Request):
    return db.user_by_token(_token(request))


def require_user(request: Request):
    u = optional_user(request)
    if not u:
        raise HTTPException(401, "LOGIN_REQUIRED")
    return u


def require_admin(request: Request):
    u = require_user(request)
    if u["role"] != "admin":
        raise HTTPException(403, "ADMIN_REQUIRED")
    return u


def public_guard(request: Request):
    check_access(request)
    return True


def guard(request: Request):
    check_access(request)
    return require_user(request)


def admin_guard(request: Request):
    check_access(request)
    return require_admin(request)


def _set_cookie(response: Response, token: str):
    response.set_cookie(COOKIE_NAME, token, max_age=COOKIE_AGE,
                        httponly=True, samesite="lax", path="/")


def _need_task(tid: str, user: dict) -> dict:
    t = db.get_task(tid)
    if not t:
        raise HTTPException(404, "任务不存在")
    if not db.can_view(t, user):
        raise HTTPException(403, "无权访问此任务")
    return t


# ------------------------------ 基础 / 公开 ------------------------------

@app.get("/")
def index():
    return FileResponse(str(STATIC_DIR / "index.html"),
                        headers={"Cache-Control": "no-cache, must-revalidate"})


@app.get("/favicon.ico")
def favicon():
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
           '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
           '<stop stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>'
           '<rect width="64" height="64" rx="16" fill="url(#g)"/>'
           '<path d="M18 44l10-13 8 9 6-7 6 11z" fill="#fff" opacity=".92"/>'
           '<circle cx="24" cy="22" r="4" fill="#fff"/></svg>')
    return Response(svg, media_type="image/svg+xml")


@app.get("/api/health")
def health():
    cfg = db.get_settings()
    return {
        "ok": True,
        "version": config.VERSION,
        "initialized": db.count_users() > 0,
        "auth_required": bool((cfg.get("access_key") or "").strip()),
        "configured": db.is_configured(),
        "workers": worker.pool.concurrency,
    }


@app.post("/api/auth/check")
def auth_check(payload: dict):
    key = (db.get_settings().get("access_key") or "").strip()
    if not key:
        return {"ok": True}
    return {"ok": (payload or {}).get("key") == key}


@app.get("/api/bootstrap")
def bootstrap(request: Request, _=Depends(public_guard)):
    user = optional_user(request)
    is_admin = bool(user and user["role"] == "admin")
    cfg = db.get_settings()
    return {
        "initialized": db.count_users() > 0,
        "user": user,
        "version": config.VERSION,
        "auth_required": bool((cfg.get("access_key") or "").strip()),
        "configured": db.is_configured(),
        "settings": db.get_public_settings(public_only=not is_admin),
        "providers": db.providers_public(),
        "presets": db.list_presets(),
    }


@app.post("/api/setup")
def setup(payload: dict, response: Response, _=Depends(public_guard)):
    try:
        u = db.init_admin((payload or {}).get("username"), (payload or {}).get("password"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    token = db.create_session(u["id"])
    _set_cookie(response, token)
    return {"ok": True, "user": u, "token": token}


@app.post("/api/login")
def login(payload: dict, response: Response, _=Depends(public_guard)):
    u = db.authenticate((payload or {}).get("username"), (payload or {}).get("password"))
    if not u:
        raise HTTPException(401, "用户名或密码不正确")
    token = db.create_session(u["id"])
    _set_cookie(response, token)
    return {"ok": True, "user": u, "token": token}


@app.post("/api/logout")
def logout(request: Request, response: Response):
    db.delete_session(_token(request))
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/me")
def me(user=Depends(guard)):
    return {"user": user, "prompt_counts": db.prompt_counts(user["id"])}


# ------------------------------ 设置 ------------------------------

@app.get("/api/settings")
def get_settings(request: Request):
    check_access(request)
    u = require_user(request)
    return db.get_public_settings(public_only=u["role"] != "admin")


@app.put("/api/settings")
def put_settings(payload: dict, _=Depends(admin_guard)):
    db.save_settings(payload or {})
    after = db.get_settings()
    try:
        worker.pool.resize(int(after.get("concurrency") or 1))
    except ValueError:
        pass
    worker.pool.notify()
    return {"ok": True, "settings": db.get_public_settings(public_only=False)}


@app.post("/api/settings/test")
def test_settings(payload: dict = None, _=Depends(admin_guard)):
    pid = ((payload or {}).get("provider_id") or "").strip()
    return provider.test_connection(db.cfg_for_image(pid or None))


def _merge_models(existing: str, new: list) -> list:
    """把手填列表与拉取结果合并去重，保留原有顺序。"""
    out, seen = [], set()
    for x in re.split(r"[,\n]", existing or ""):
        x = x.strip()
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    for x in new:
        x = str(x).strip()
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out[:500]


@app.post("/api/models/fetch")
def fetch_models_api(payload: dict = None, _=Depends(admin_guard)):
    """管理员从服务商 /v1/models 拉取可用模型。

    支持设置页里尚未保存的临时 API 地址 / Key 覆盖；save=True 时把结果
    合并写回该图片服务的 models 配置（不覆盖手填项），供所有用户使用。
    """
    p = payload or {}
    pid = (p.get("provider_id") or "").strip()
    if pid == "__default__":
        pid = ""
    kind = (p.get("kind") or "image").strip()
    if kind not in ("image", "llm"):
        kind = "image"

    prov = db.get_provider(pid) if pid else None
    if pid and (not prov or prov["kind"] != kind):
        return {"ok": False, "message": "所选服务不存在，请刷新设置后重试"}
    # 选中的具体服务商必须自己配置过 API 地址，否则明确报错，
    # 不能静默回退默认服务的地址去拉取（避免把默认模型的列表拉进备用服务）。
    if prov and not (prov["config"].get("api_base") or "").strip():
        tmp = (p.get("api_base") or "").strip()
        if not tmp:
            return {"ok": False,
                    "message": "服务商「%s」未配置 API 地址，请先在服务商管理里填写，"
                               "或在本页临时填写地址 / Key 后再拉取。" % prov["name"]}

    if kind == "llm":
        c = db.cfg_for_llm(pid or None)
        cfg = {"api_base": c.get("llm_api_base") or c.get("api_base") or "",
               "api_key": c.get("llm_api_key") or c.get("api_key") or ""}
        if prov:
            pc = prov["config"]
            cfg["api_base"] = pc.get("api_base") or cfg["api_base"]
            cfg["api_key"] = pc.get("api_key") or cfg["api_key"]
    else:
        c = db.cfg_for_image(pid or None)
        cfg = {"api_base": c.get("api_base") or "", "api_key": c.get("api_key") or ""}

    # 设置页允许「填完地址/Key 不保存直接拉取」
    ob, ok = p.get("api_base"), p.get("api_key")
    if isinstance(ob, str) and ob.strip():
        cfg["api_base"] = ob.strip()
    if isinstance(ok, str) and ok.strip():
        cfg["api_key"] = ok.strip()

    try:
        models = provider.fetch_models(cfg)
        url = provider.model_list_url(cfg["api_base"])
    except provider.ImageAPIError as e:
        return {"ok": False, "message": str(e)}

    saved, all_models = False, models
    if bool(p.get("save")) and kind == "image":
        if pid:
            pc = dict(prov["config"])
            merged = _merge_models(pc.get("models") or "", models)
            pc["models"] = ", ".join(merged)
            db.update_provider(pid, {"config": pc})
        else:
            merged = _merge_models(db.get_settings().get("models") or "", models)
            db.save_settings({"models": ", ".join(merged)})
        saved, all_models = True, merged

    return {
        "ok": True, "models": models, "count": len(models),
        "saved": saved, "all_models": all_models, "url": url,
        "message": "拉取到 %d 个模型%s" % (len(models), "，已保存到服务配置" if saved else ""),
    }


@app.get("/api/providers")
def get_providers(kind: str = "", _=Depends(guard)):
    return {"items": db.providers_public(kind or None)}


@app.post("/api/providers")
def add_provider(payload: dict, _=Depends(admin_guard)):
    try:
        p = db.create_provider((payload or {}).get("kind"), (payload or {}).get("name"),
                               (payload or {}).get("config") or {},
                               bool((payload or {}).get("is_default")))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "items": db.providers_public()}


@app.put("/api/providers/{pid}")
def edit_provider(pid: str, payload: dict, _=Depends(admin_guard)):
    try:
        db.update_provider(pid, payload or {})
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "items": db.providers_public()}


@app.delete("/api/providers/{pid}")
def del_provider(pid: str, _=Depends(admin_guard)):
    db.delete_provider(pid)
    return {"ok": True, "items": db.providers_public()}


# ------------------------------ 预设 / 提示词库 ------------------------------

@app.get("/api/presets")
def get_presets(_=Depends(guard)):
    return {"items": db.list_presets()}


@app.post("/api/presets")
def add_preset(payload: dict, _=Depends(admin_guard)):
    try:
        p = db.create_preset((payload or {}).get("name"), (payload or {}).get("content"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "items": db.list_presets(), "created": p}


@app.put("/api/presets/{pid}")
def edit_preset(pid: str, payload: dict, _=Depends(admin_guard)):
    try:
        db.update_preset(pid, payload or {})
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "items": db.list_presets()}


@app.delete("/api/presets/{pid}")
def del_preset(pid: str, _=Depends(admin_guard)):
    db.delete_preset(pid)
    return {"ok": True, "items": db.list_presets()}


@app.get("/api/prompts")
def get_prompts(kind: str = "", user=Depends(guard)):
    items = db.list_prompt_items(user["id"], kind or None)
    return {"items": items, "counts": db.prompt_counts(user["id"])}


@app.post("/api/prompts")
def add_prompt(payload: dict, user=Depends(guard)):
    try:
        item = db.add_prompt_item(user["id"], (payload or {}).get("kind") or "favorite",
                                 (payload or {}).get("text"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "items": db.list_prompt_items(user["id"]),
            "counts": db.prompt_counts(user["id"]), "created": item}


@app.delete("/api/prompts/{pid}")
def del_prompt(pid: str, user=Depends(guard)):
    db.delete_prompt_item(user["id"], pid)
    return {"ok": True, "items": db.list_prompt_items(user["id"]),
            "counts": db.prompt_counts(user["id"])}


@app.post("/api/prompt/optimize")
def optimize(payload: dict, user=Depends(guard)):
    prompt = ((payload or {}).get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(400, "请先填写提示词")
    cfg = db.cfg_for_llm((payload or {}).get("llm_provider_id") or None)
    try:
        text = provider.optimize_prompt(cfg, prompt, (payload or {}).get("mode") or "t2i",
                                        (payload or {}).get("fmt_kind") or "")
    except provider.ImageAPIError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "prompt": text}


# ------------------------------ 用户管理 ------------------------------

@app.get("/api/users")
def get_users(_=Depends(admin_guard)):
    return {"items": db.list_users()}


@app.post("/api/users")
def add_user(payload: dict, _=Depends(admin_guard)):
    try:
        u = db.create_user((payload or {}).get("username"), (payload or {}).get("password"),
                           (payload or {}).get("role") or "user")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "items": db.list_users(), "created": u}


@app.put("/api/users/{uid}")
def edit_user(uid: str, payload: dict, _=Depends(admin_guard)):
    try:
        db.update_user(uid, payload or {})
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "items": db.list_users()}


@app.delete("/api/users/{uid}")
def del_user(uid: str, _=Depends(admin_guard)):
    try:
        db.delete_user(uid)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "items": db.list_users()}


# ------------------------------ 统计 ------------------------------

@app.get("/api/stats")
def get_stats(user=Depends(guard)):
    s = db.stats(user)
    s["workers"] = worker.pool.concurrency
    s["configured"] = db.is_configured()
    return s


@app.get("/api/usage")
def get_usage(request: Request, _=Depends(admin_guard)):
    return db.usage_stats(require_user(request)["id"])


# ------------------------------ 任务 ------------------------------

@app.get("/api/tasks")
def get_tasks(limit: int = 60, offset: int = 0, status: str = "", q: str = "",
              user=Depends(guard)):
    items, total = db.list_tasks(max(1, min(200, limit)), max(0, offset),
                                 status or None, user, q.strip())
    return {"items": items, "total": total, "server_time": time.time()}


@app.get("/api/tasks/{tid}")
def get_task(tid: str, user=Depends(guard)):
    return _need_task(tid, user)


@app.post("/api/tasks")
async def create_task(request: Request, user=Depends(guard)):
    ct = request.headers.get("content-type", "").lower()
    fields, uploads, mask_raw = {}, [], None
    if "multipart/form-data" in ct or "x-www-form-urlencoded" in ct:
        form = await request.form()
        for k in ("mode", "model", "prompt", "size", "quality", "n", "output_format",
                  "params", "request_json", "provider_id"):
            v = form.get(k)
            if v is not None and not hasattr(v, "filename"):
                fields[k] = str(v)
        for item in form.getlist("images"):
            if hasattr(item, "read"):
                uploads.append((await item.read(), item.filename or "upload.png"))
        m = form.get("mask")
        if hasattr(m, "read"):
            mask_raw = await m.read()
    else:
        try:
            body = await request.json()
        except Exception:
            body = {}
        fields = dict(body or {})
        for img in (body or {}).get("images") or []:
            if isinstance(img, str) and ";base64," in img:
                try:
                    uploads.append((base64.b64decode(img.split(",", 1)[1]), "pasted.png"))
                except Exception:
                    pass

    if len(uploads) > 8:
        raise HTTPException(400, "最多上传 8 张参考图")
    for raw, _ in uploads:
        if len(raw) > 30 * 1024 * 1024:
            raise HTTPException(400, "单张参考图不能超过 30MB")
    if mask_raw and len(mask_raw) > 30 * 1024 * 1024:
        raise HTTPException(400, "遮罩图不能超过 30MB")

    mode = (fields.get("mode") or "t2i").strip()
    if mode not in ("t2i", "i2i"):
        mode = "t2i"
    prompt = (fields.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(400, "请填写提示词")
    if mode == "i2i" and not uploads:
        raise HTTPException(400, "图生图需要至少上传 1 张参考图")
    if mode == "t2i":
        uploads, mask_raw = [], None

    try:
        n = max(1, min(4, int(fields.get("n") or 1)))
    except ValueError:
        n = 1

    def parse_obj(v, label):
        if not v:
            return {}
        if isinstance(v, str):
            try:
                v = json.loads(v)
            except ValueError:
                raise HTTPException(400, label + "必须是合法 JSON")
        if not isinstance(v, dict):
            raise HTTPException(400, label + "必须是 JSON 对象")
        return v

    raw_params = parse_obj(fields.get("params"), "高级参数")
    request_json = parse_obj(fields.get("request_json"), "请求 JSON")

    provider_id = (fields.get("provider_id") or "").strip()
    provider_name = "默认服务"
    p = db.get_provider(provider_id) if provider_id and provider_id != "__default__" else None
    if p and p["kind"] == "image":
        provider_name = p["name"]
    else:
        provider_id = ""

    saved, mask_name = [], ""
    try:
        for raw, _name in uploads:
            saved.append(provider.prepare_input(raw))
        if mask_raw:
            mask_name = provider.prepare_mask(mask_raw)
    except provider.ImageAPIError as e:
        provider.remove_files(saved + ([mask_name] if mask_name else []))
        raise HTTPException(400, str(e))

    try:
        task = db.create_task(
            mode=mode,
            model=(fields.get("model") or "").strip() or "gpt-image-2.6-sunburst",
            prompt=prompt,
            size=(fields.get("size") or "1024x1024").strip(),
            quality=(fields.get("quality") or "").strip(),
            n=n,
            output_format=(fields.get("output_format") or "").strip(),
            params=raw_params,
            input_images=saved,
            user=user,
            request_json=request_json,
            mask_image=mask_name,
            provider_id=provider_id,
            provider_name=provider_name,
        )
        db.add_prompt_item(user["id"], "history", prompt)
    except Exception:
        provider.remove_files(saved + ([mask_name] if mask_name else []))
        raise
    worker.pool.notify()
    return task


@app.post("/api/tasks/{tid}/retry")
def retry_task(tid: str, user=Depends(guard)):
    old = _need_task(tid, user)
    names = provider.copy_inputs(old["input_images"])
    mask_name = provider.copy_mask(old.get("mask_image") or "")
    task = db.create_task(
        mode=old["mode"], model=old["model"], prompt=old["prompt"],
        size=old["size"], quality=old["quality"], n=old["n"],
        output_format=old["output_format"], params=old["params"],
        input_images=names, user=user, request_json=old.get("request_json") or {},
        mask_image=mask_name,
        provider_id=old.get("provider_id") or "", provider_name=old.get("provider_name") or "",
    )
    worker.pool.notify()
    return task


@app.delete("/api/tasks")
def delete_tasks(scope: str = "", user=Depends(guard)):
    if scope == "finished":
        provider.remove_files(db.clear_finished(user))
        return {"ok": True}
    if scope == "finished_all":
        # 显式全站清理：仅管理员，避免误把「清空已完成」当成全站操作
        if user.get("role") != "admin":
            raise HTTPException(403, "ADMIN_REQUIRED")
        provider.remove_files(db.clear_finished(user, all_users=True))
        return {"ok": True}
    raise HTTPException(400, "不支持的清理范围")


@app.delete("/api/tasks/{tid}")
def delete_task(tid: str, user=Depends(guard)):
    _need_task(tid, user)
    names = db.delete_task(tid)
    if names is None:
        raise HTTPException(404, "任务不存在")
    if names == "running":
        raise HTTPException(409, "任务正在生成中，请稍后再删除")
    provider.remove_files(names)
    return {"ok": True}


def _zip_response(data: bytes, filename: str):
    return StreamingResponse(
        io.BytesIO(data), media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="%s"' % filename,
                 "Content-Length": str(len(data))},
    )


@app.get("/api/tasks/{tid}/download")
def download_task(tid: str, user=Depends(guard)):
    t = _need_task(tid, user)
    if t["status"] != "succeeded" or not t["output_images"]:
        raise HTTPException(400, "该任务还没有可下载的图片")
    stamp = time.strftime("%Y%m%d-%H%M", time.localtime(t["created_at"] or time.time()))
    entries = [(name, "%s_%s_%02d%s" % (stamp, tid[:8], i + 1, _suffix(name)))
               for i, name in enumerate(t["output_images"])
               if FILENAME_RE.fullmatch(name) and ".." not in name]
    if not entries:
        raise HTTPException(400, "该任务还没有可下载的图片")
    return _zip_response(provider.build_zip(entries), "images-%s.zip" % tid[:8])


@app.post("/api/tasks/download")
def download_many(payload: dict, user=Depends(guard)):
    payload = payload or {}
    # 新：files=[{tid, name}] —— 只打包界面上勾选的那几张图。
    # 逐个校验「文件确实属于该任务且本人有权查看」，避免借文件名读取 output/ 下任意内容。
    files = payload.get("files")
    if files is not None:
        if not isinstance(files, list) or len(files) > 500:
            raise HTTPException(400, "最多一次打包 500 张图片")
        entries, seen = [], set()
        for item in files:
            if not isinstance(item, dict):
                continue
            tid, name = str(item.get("tid") or ""), str(item.get("name") or "")
            if not tid or not name or "/" in name or "\\" in name or ".." in name:
                continue
            t = db.get_task(tid)
            if not t or not db.can_view(t, user) or t["status"] != "succeeded":
                continue
            outs = t["output_images"] or []
            if name not in outs:
                continue
            key = (tid, name)
            if key in seen:
                continue
            seen.add(key)
            entries.append((name, "%s/%02d%s" % (tid[:8], outs.index(name) + 1, _suffix(name))))
        if not entries:
            raise HTTPException(400, "没有可下载的图片")
        return _zip_response(provider.build_zip(entries), "images-selected.zip")
    # 兼容旧调用：按任务 id 打包整组图片
    ids = payload.get("ids") or []
    if not isinstance(ids, list) or len(ids) > 100:
        raise HTTPException(400, "最多一次打包 100 个任务")
    entries = []
    for tid in ids:
        t = db.get_task(str(tid))
        if not t or not db.can_view(t, user) or t["status"] != "succeeded":
            continue
        for i, name in enumerate(t["output_images"] or []):
            if FILENAME_RE.fullmatch(name) and ".." not in name:
                entries.append((name, "%s/%02d%s" % (str(tid)[:8], i + 1, _suffix(name))))
    if not entries:
        raise HTTPException(400, "没有可下载的图片")
    return _zip_response(provider.build_zip(entries), "images-batch.zip")


def _suffix(name: str) -> str:
    i = name.rfind(".")
    return name[i:] if i > 0 else ".png"


# ------------------------------ 图片文件 ------------------------------

@app.post("/api/rename-file")
def rename_file(payload: dict, user=Depends(guard)):
    """物理重命名成品图片：data/images 改名 + 任务 JSON 引用更新 + output 补一份新名称副本。"""
    import shutil
    old = str((payload or {}).get("old") or "")
    wanted = str((payload or {}).get("new") or "").strip()
    if not old or not FILENAME_RE.fullmatch(old) or ".." in old:
        raise HTTPException(400, "原文件名不合法")
    if db.file_owner(old) != user["id"]:
        raise HTTPException(403, "无权修改此图片")
    src = config.IMAGES_DIR / old
    if not src.is_file():
        raise HTTPException(404, "文件不存在")
    ext = src.suffix or ".png"
    stem = wanted
    if stem.lower().endswith(ext.lower()):
        stem = stem[:-len(ext)]
    stem = re.sub(r"[^\w.\-]", "_", stem, flags=re.UNICODE).strip("._") or "image"
    new = stem + ext
    if not FILENAME_RE.fullmatch(new) or ".." in new:
        raise HTTPException(400, "名称含非法字符")
    if new == old:
        return {"ok": True, "name": old}
    dst = config.IMAGES_DIR / new
    if dst.exists():
        raise HTTPException(409, "同名文件已存在")
    src.rename(dst)
    db.rename_image_refs(old, new)
    # output 存档只保留一份：找到内容相同的旧存档，直接改名并修正 manifest；
    # 若有多份（历史遗留）则一并去重，不再新增副本占用磁盘。
    try:
        import hashlib
        folder = config.OUTPUT_DIR / provider._safe_dir(user["username"])
        folder.mkdir(parents=True, exist_ok=True)

        def digest(path):
            h = hashlib.sha256()
            with path.open("rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            return h.hexdigest()

        size, want = dst.stat().st_size, digest(dst)
        keep = folder / new
        same = []
        for item in sorted(folder.iterdir()):
            if not item.is_file() or item.name == "manifest.jsonl":
                continue
            if item.suffix.lower() != ext.lower() or item.stat().st_size != size:
                continue
            if digest(item) == want:
                same.append(item)
        gone = set()
        if not same:
            shutil.copyfile(dst, keep)
        else:
            chosen = next((it for it in same if it.name == new), same[0])
            for it in same:
                if it is chosen:
                    continue
                gone.add(it.name)
                it.unlink()
            if chosen.name != new:
                gone.add(chosen.name)
                if keep.exists():
                    keep.unlink()
                chosen.rename(keep)
        mf = folder / "manifest.jsonl"
        if gone and mf.is_file():
            lines = mf.read_text(encoding="utf-8").splitlines()
            out = []
            for line in lines:
                try:
                    rec = json.loads(line)
                    if rec.get("file") in gone:
                        rec["file"] = new
                        line = json.dumps(rec, ensure_ascii=False)
                except (ValueError, TypeError):
                    pass
                out.append(line)
            mf.write_text("\n".join(out) + "\n", encoding="utf-8")
    except Exception:
        logging.exception("同步 output 存档失败（不影响改名结果）")
    return {"ok": True, "name": new}


@app.post("/api/delete-images")
def delete_images(payload: dict, user=Depends(guard)):
    """删除自己拥有的已生成图片：物理文件 + 任务引用 + output 存档一并清理。

    body: {"names": ["a.png", ...]}——任务页 / 资产库勾选后批量删除。
    只删「引用它的任务全部属于当前用户」的图片；被别人或多个用户引用的图跳过并在结果里说明。
    """
    names = (payload or {}).get("names") or []
    if not isinstance(names, list):
        raise HTTPException(400, "names 必须是数组")
    names = [str(n or "").strip() for n in names]
    names = [n for n in names if n and FILENAME_RE.fullmatch(n) and ".." not in n]
    if not names:
        raise HTTPException(400, "请先勾选要删除的图片")
    if len(names) > 200:
        raise HTTPException(400, "一次最多删除 200 张")
    removed, skipped, missing = [], [], []
    import shutil as _shutil
    for name in names:
        owner = db.file_owner(name)
        if owner != user["id"]:
            skipped.append(name)
            continue
        src = config.IMAGES_DIR / name
        if not src.is_file():
            missing.append(name)
            continue
        src.unlink(missing_ok=True)
        db.remove_image_refs(name)
        # output 存档同步删除（存档目录按用户名隔离，只动自己的）
        try:
            folder = config.OUTPUT_DIR / provider._safe_dir(user["username"])
            target = folder / name
            if target.is_file():
                target.unlink()
            mf = folder / "manifest.jsonl"
            if mf.is_file():
                lines = mf.read_text(encoding="utf-8").splitlines()
                kept = []
                for line in lines:
                    try:
                        if json.loads(line).get("file") == name:
                            continue
                    except (ValueError, TypeError):
                        pass
                    kept.append(line)
                if len(kept) != len(lines):
                    mf.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")
        except Exception:
            logging.exception("同步 output 存档删除失败（不影响主删除）")
        removed.append(name)
    return {"ok": True, "removed": removed, "skipped": skipped, "missing": missing}


def _check_file_access(request: Request, name: str):
    check_access(request)
    u = require_user(request)
    if db.file_owner(name) != u["id"]:
        raise HTTPException(403, "无权访问此图片")
    if not FILENAME_RE.fullmatch(name):
        raise HTTPException(404, "文件不存在")
    path = config.IMAGES_DIR / name
    if not path.is_file():
        raise HTTPException(404, "文件不存在")
    return path


@app.get("/api/files/{name}/meta")
def file_meta(name: str, request: Request):
    _check_file_access(request, name)
    return provider.image_meta(name) or {"name": name, "format": "未知", "bytes": 0,
                                         "width": None, "height": None}


@app.get("/api/files/{name}")
def get_file(name: str, request: Request):
    path = _check_file_access(request, name)
    ext = path.suffix.lstrip(".").lower()
    headers = {"Cache-Control": "private, max-age=3600",
               "X-Content-Type-Options": "nosniff"}
    if ext == "svg":
        headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'"
    return FileResponse(str(path), media_type=provider.MIME_BY_EXT.get(ext, "application/octet-stream"),
                        headers=headers)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    # 异常详情（可能含 SQL、磁盘路径、上游 URL）只写服务端日志，不回显给浏览器
    logging.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500,
                        content={"detail": "服务器内部错误，请稍后重试或查看容器日志"})
