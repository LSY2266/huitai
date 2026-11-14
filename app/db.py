"""SQLite 持久化层：任务队列 + 配置 + 用户/会话 + 多服务商 + 预设 + 提示词库 + 用量。

设计要点
- 所有任务都落库，进程重启不丢；启动时把残留 running 改回 pending 实现续跑。
- claim_next() 用单条 UPDATE ... RETURNING 原子抢占，多 worker 不会重复执行。
- 用户体系：users（pbkdf2 哈希）+ sessions（随机 token）。
- 普通用户只能看到 / 下载自己的任务与图片；管理员可见全部、可见用量统计。
- 数据库平滑升级：旧库自动补齐新列与新表，历史任务不丢。
"""
import hashlib
import hmac
import json
import secrets
import sqlite3
import time
import uuid
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id            TEXT PRIMARY KEY,
    user_id       TEXT,
    username      TEXT,
    provider_id   TEXT,
    provider_name TEXT,
    mode          TEXT NOT NULL,
    model         TEXT NOT NULL,
    prompt        TEXT NOT NULL,
    size          TEXT,
    quality       TEXT,
    n             INTEGER DEFAULT 1,
    output_format TEXT,
    mask_image    TEXT,
    params        TEXT,
    request_json  TEXT,
    status        TEXT NOT NULL,
    input_images  TEXT,
    output_images TEXT,
    error         TEXT,
    attempts      INTEGER DEFAULT 0,
    created_at    REAL,
    started_at    REAL,
    finished_at   REAL,
    updated_at    REAL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'user',
    created_at REAL
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at REAL,
    expires_at REAL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS providers (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    name        TEXT NOT NULL,
    config      TEXT NOT NULL,
    is_default  INTEGER DEFAULT 0,
    created_at  REAL
);

CREATE TABLE IF NOT EXISTS presets (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    content     TEXT NOT NULL,
    sort_order  INTEGER DEFAULT 0,
    created_at  REAL
);

CREATE TABLE IF NOT EXISTS prompt_items (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    kind        TEXT NOT NULL,
    text        TEXT NOT NULL,
    created_at  REAL
);
CREATE INDEX IF NOT EXISTS idx_prompt_items ON prompt_items(user_id, kind, created_at DESC);
"""

DEFAULT_PRESETS = [
    ("照片级", "照片级真实，自然光，浅景深，高细节"),
    ("电影感", "电影感构图，戏剧性光影，宽幅画面"),
    ("精致插画", "精致插画，柔和配色，细腻笔触"),
    ("3D 渲染", "3D 渲染，Octane，柔和全局光"),
    ("平面海报", "平面海报设计，强排版，大胆留白"),
    ("赛博朋克", "赛博朋克，霓虹灯，雨夜街道"),
    ("中国水墨", "东方水墨意境，留白，淡彩"),
    ("产品摄影", "商业产品摄影，干净背景，柔光箱"),
    ("黑白线稿", "黑白线稿，干净利落的线条"),
    ("像素风", "像素艺术，复古游戏风格"),
]


@contextmanager
def connect():
    conn = sqlite3.connect(str(config.DB_PATH), timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# 旧版本库可能缺少的列。新库由 SCHEMA 一次建全；旧库按「缺哪个补哪个」平滑升级。
# mode / model / prompt / status 是各版本都有的基础列，不在此列。
TASK_EXTRA_COLUMNS = (
    ("user_id", "TEXT"), ("username", "TEXT"), ("provider_id", "TEXT"),
    ("provider_name", "TEXT"), ("mask_image", "TEXT"), ("request_json", "TEXT"),
    ("params", "TEXT"), ("output_format", "TEXT"), ("size", "TEXT"), ("quality", "TEXT"),
    ("input_images", "TEXT"), ("output_images", "TEXT"), ("error", "TEXT"),
    ("n", "INTEGER DEFAULT 1"), ("attempts", "INTEGER DEFAULT 0"),
    ("created_at", "REAL"), ("started_at", "REAL"), ("finished_at", "REAL"),
    ("updated_at", "REAL"),
)


def _migrate(c):
    """必须在 executescript(SCHEMA) 之前调用。

    SCHEMA 里有引用 user_id 等新列的索引；若旧表尚未补列就执行脚本，
    SQLite 会抛 "no such column: user_id"，导致服务启动失败、容器反复重启。
    """
    exists = c.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks'"
    ).fetchone()
    if not exists:
        return  # 全新数据库，交给 SCHEMA 建表，不需要补列
    cols = {r[1] for r in c.execute("PRAGMA table_info(tasks)").fetchall()}
    for name, decl in TASK_EXTRA_COLUMNS:
        if name not in cols:
            c.execute("ALTER TABLE tasks ADD COLUMN %s %s" % (name, decl))


def init_db():
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as c:
        c.execute("PRAGMA journal_mode=WAL")
        _migrate(c)               # 先给旧库补列，幂等，可重复执行
        c.executescript(SCHEMA)   # 再建表 / 建索引
        # 引用新列的索引单独建：即使遇到结构异常的极旧库也只是少个索引，不阻断启动
        try:
            c.execute("CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, created_at DESC)")
        except sqlite3.OperationalError:
            pass
        for k, v in config.DEFAULTS.items():
            c.execute("INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)", (k, str(v)))
        # 2.1.1：老库里仍是一字未改的旧默认文生图指令，平滑升级为含动图/GIF/SVG 规则的新版；
        # 管理员在设置页自定义过的指令（值不同）一律保留，不会被覆盖。
        row = c.execute("SELECT value FROM settings WHERE key='llm_system_prompt_t2i'").fetchone()
        if row and row[0] == config.DEFAULT_OPTIMIZE_PROMPT_T2I_V1:
            c.execute("UPDATE settings SET value=? WHERE key='llm_system_prompt_t2i'",
                      (config.DEFAULT_OPTIMIZE_PROMPT_T2I,))
        c.execute(
            "UPDATE tasks SET status='pending', started_at=NULL, updated_at=? WHERE status='running'",
            (time.time(),),
        )
        c.execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))
        if c.execute("SELECT COUNT(*) FROM presets").fetchone()[0] == 0:
            for i, (name, content) in enumerate(DEFAULT_PRESETS):
                c.execute(
                    "INSERT INTO presets(id, name, content, sort_order, created_at) VALUES(?,?,?,?,?)",
                    (uuid.uuid4().hex, name, content, i, time.time()),
                )


# ------------------------------ 配置 ------------------------------

def get_settings() -> dict:
    with connect() as c:
        rows = c.execute("SELECT key, value FROM settings").fetchall()
    data = {r["key"]: r["value"] for r in rows}
    for k, v in config.DEFAULTS.items():
        data.setdefault(k, str(v))
    return data


def get_public_settings(public_only: bool = False) -> dict:
    """密钥只返回 *_set 布尔，不回显任何片段；普通用户仅拿非敏感子集。"""
    data = get_settings()
    out = {}
    for k in config.SECRET_KEYS:
        out[k + "_set"] = bool((data.get(k) or "").strip())
        data.pop(k, None)
    if public_only:
        data = {k: v for k, v in data.items() if k in config.PUBLIC_SETTING_KEYS}
    out.update(data)
    return out


def save_settings(patch: dict):
    """空字符串 = 保持原值（仅密钥）；'-' = 清空该密钥。仅管理员调用。"""
    allowed = set(config.DEFAULTS)
    with connect() as c:
        for k, v in patch.items():
            if k not in allowed:
                continue
            v = "" if v is None else str(v)
            if k in config.SECRET_KEYS:
                if v == "":
                    continue
                if v == "-":
                    v = ""
            c.execute(
                "INSERT INTO settings(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, v),
            )


# ------------------------------ 多服务商 ------------------------------

IMAGE_CFG_KEYS = ("api_base", "api_key", "models", "generate_path", "edit_path",
                  "edit_field", "mask_field", "i2i_mode", "timeout")
LLM_CFG_KEYS = ("api_base", "api_key", "model", "system_prompt", "timeout")


def _provider_dict(r) -> dict:
    try:
        cfg = json.loads(r["config"] or "{}")
    except ValueError:
        cfg = {}
    return {"id": r["id"], "kind": r["kind"], "name": r["name"], "config": cfg,
            "is_default": bool(r["is_default"]), "created_at": r["created_at"]}


def get_provider(pid: str):
    with connect() as c:
        r = c.execute("SELECT * FROM providers WHERE id=?", (pid,)).fetchone()
    return _provider_dict(r) if r else None


def list_providers(kind: str = None) -> list:
    with connect() as c:
        if kind:
            rows = c.execute("SELECT * FROM providers WHERE kind=? ORDER BY created_at", (kind,)).fetchall()
        else:
            rows = c.execute("SELECT * FROM providers ORDER BY created_at").fetchall()
    return [_provider_dict(r) for r in rows]


def providers_public(kind: str = None) -> list:
    """对外：密钥只给 *_set 布尔，不回显任何片段。"""
    out = []
    for p in list_providers(kind):
        cfg = dict(p["config"])
        cfg["api_key_set"] = bool((cfg.get("api_key") or "").strip())
        cfg.pop("api_key", None)
        p["config"] = cfg
        out.append(p)
    return out


def create_provider(kind: str, name: str, cfg: dict, is_default: bool = False) -> dict:
    if kind not in ("image", "llm"):
        raise ValueError("服务类型只能是 image 或 llm")
    name = (name or "").strip()
    if not name:
        raise ValueError("请填写服务名称")
    keys = IMAGE_CFG_KEYS if kind == "image" else LLM_CFG_KEYS
    clean = {k: str(cfg.get(k, "")) for k in keys}
    pid = uuid.uuid4().hex
    with connect() as c:
        if is_default:
            c.execute("UPDATE providers SET is_default=0 WHERE kind=?", (kind,))
        c.execute(
            "INSERT INTO providers(id, kind, name, config, is_default, created_at) VALUES(?,?,?,?,?,?)",
            (pid, kind, name, json.dumps(clean, ensure_ascii=False), 1 if is_default else 0, time.time()),
        )
    return get_provider(pid)


def update_provider(pid: str, patch: dict):
    p = get_provider(pid)
    if not p:
        raise ValueError("服务不存在")
    keys = IMAGE_CFG_KEYS if p["kind"] == "image" else LLM_CFG_KEYS
    cfg = dict(p["config"])
    incoming = patch.get("config") or {}
    for k in keys:
        if k in incoming:
            v = str(incoming[k] or "")
            if k == "api_key" and v == "":
                continue  # 留空 = 不修改密钥
            cfg[k] = "" if (k == "api_key" and v == "-") else v
    name = (patch.get("name") or "").strip() or p["name"]
    with connect() as c:
        if patch.get("is_default"):
            c.execute("UPDATE providers SET is_default=0 WHERE kind=?", (p["kind"],))
            c.execute("UPDATE providers SET name=?, config=?, is_default=1 WHERE id=?",
                      (name, json.dumps(cfg, ensure_ascii=False), pid))
        else:
            c.execute("UPDATE providers SET name=?, config=? WHERE id=?",
                      (name, json.dumps(cfg, ensure_ascii=False), pid))
    return get_provider(pid)


def delete_provider(pid: str):
    with connect() as c:
        c.execute("DELETE FROM providers WHERE id=?", (pid,))


def cfg_for_image(provider_id: str = None) -> dict:
    """任务执行时使用的图片服务配置：默认取 settings，选中服务商则覆盖图片相关键。"""
    base = get_settings()
    if not provider_id or provider_id == "__default__":
        return base
    p = get_provider(provider_id)
    if not p or p["kind"] != "image":
        return base
    out = dict(base)
    for k in IMAGE_CFG_KEYS:
        if k in p["config"]:
            out[k] = p["config"][k]
    out["provider_name"] = p["name"]
    return out


def cfg_for_llm(provider_id: str = None) -> dict:
    """提示词优化使用的语言模型配置。"""
    base = get_settings()
    if not provider_id or provider_id == "__default__":
        return base
    p = get_provider(provider_id)
    if not p or p["kind"] != "llm":
        return base
    c = p["config"]
    out = dict(base)
    out["llm_api_base"] = c.get("api_base") or base.get("llm_api_base") or base.get("api_base")
    out["llm_api_key"] = c.get("api_key") or base.get("llm_api_key") or base.get("api_key")
    out["llm_model"] = c.get("model") or base.get("llm_model")
    custom = c.get("system_prompt")
    out["llm_system_prompt"] = custom or base.get("llm_system_prompt")
    # 额外语言服务自带系统指令时维持旧行为：该指令同时覆盖两套分模式指令
    if custom:
        out["llm_system_prompt_t2i"] = custom
        out["llm_system_prompt_i2i"] = custom
    out["llm_timeout"] = c.get("timeout") or base.get("llm_timeout")
    return out


def is_configured() -> bool:
    s = get_settings()
    if (s.get("api_key") or "").strip():
        return True
    return any((p["config"].get("api_key") or "").strip() for p in list_providers("image"))


# ------------------------------ 预设提示词 ------------------------------

def list_presets() -> list:
    with connect() as c:
        rows = c.execute("SELECT * FROM presets ORDER BY sort_order, created_at").fetchall()
    return [{"id": r["id"], "name": r["name"], "content": r["content"],
             "sort_order": r["sort_order"]} for r in rows]


def create_preset(name: str, content: str) -> dict:
    name, content = (name or "").strip(), (content or "").strip()
    if not name or not content:
        raise ValueError("预设名称和提示词内容都不能为空")
    with connect() as c:
        n = c.execute("SELECT COUNT(*) FROM presets").fetchone()[0]
        pid = uuid.uuid4().hex
        c.execute("INSERT INTO presets(id, name, content, sort_order, created_at) VALUES(?,?,?,?,?)",
                  (pid, name, content, n, time.time()))
    return {"id": pid, "name": name, "content": content}


def update_preset(pid: str, patch: dict):
    with connect() as c:
        row = c.execute("SELECT * FROM presets WHERE id=?", (pid,)).fetchone()
        if not row:
            raise ValueError("预设不存在")
        c.execute("UPDATE presets SET name=?, content=? WHERE id=?",
                  ((patch.get("name") or row["name"]).strip(),
                   (patch.get("content") or row["content"]).strip(), pid))


def delete_preset(pid: str):
    with connect() as c:
        c.execute("DELETE FROM presets WHERE id=?", (pid,))


# ------------------------------ 提示词历史 / 收藏（按用户） ------------------------------

def add_prompt_item(user_id: str, kind: str, text: str, limit: int = 40) -> dict:
    if kind not in ("history", "favorite"):
        raise ValueError("类型只能是 history 或 favorite")
    text = (text or "").strip()
    if not text:
        raise ValueError("提示词不能为空")
    with connect() as c:
        # 同文本去重：先删旧的，再插新的（历史保持最新、收藏不重复）
        c.execute("DELETE FROM prompt_items WHERE user_id=? AND kind=? AND text=?", (user_id, kind, text))
        pid = uuid.uuid4().hex
        c.execute("INSERT INTO prompt_items(id, user_id, kind, text, created_at) VALUES(?,?,?,?,?)",
                  (pid, user_id, kind, text, time.time()))
        rows = c.execute(
            "SELECT id FROM prompt_items WHERE user_id=? AND kind=? ORDER BY created_at DESC", (user_id, kind)
        ).fetchall()
        for r in rows[limit:]:
            c.execute("DELETE FROM prompt_items WHERE id=?", (r["id"],))
    return {"id": pid, "text": text, "kind": kind}


def list_prompt_items(user_id: str, kind: str = None, limit: int = 40) -> list:
    with connect() as c:
        if kind:
            rows = c.execute(
                "SELECT * FROM prompt_items WHERE user_id=? AND kind=? ORDER BY created_at DESC LIMIT ?",
                (user_id, kind, limit)).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM prompt_items WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
                (user_id, limit)).fetchall()
    return [{"id": r["id"], "kind": r["kind"], "text": r["text"],
             "created_at": r["created_at"]} for r in rows]


def delete_prompt_item(user_id: str, pid: str):
    with connect() as c:
        c.execute("DELETE FROM prompt_items WHERE id=? AND user_id=?", (pid, user_id))


def prompt_counts(user_id: str) -> dict:
    with connect() as c:
        rows = c.execute("SELECT kind, COUNT(*) n FROM prompt_items WHERE user_id=? GROUP BY kind",
                         (user_id,)).fetchall()
    out = {"history": 0, "favorite": 0}
    for r in rows:
        out[r["kind"]] = r["n"]
    out["total"] = sum(out.values())
    return out


# ------------------------------ 用户与会话 ------------------------------

def _hash_password(pw: str, salt: str = None) -> str:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), bytes.fromhex(salt), 120000)
    return salt + "$" + dk.hex()


def verify_password(pw: str, stored: str) -> bool:
    try:
        salt = stored.split("$", 1)[0]
        return hmac.compare_digest(_hash_password(pw, salt), stored)
    except Exception:
        return False


def _user_dict(r) -> dict:
    return {"id": r["id"], "username": r["username"], "role": r["role"],
            "created_at": r["created_at"]}


def get_user(uid: str):
    with connect() as c:
        r = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return _user_dict(r) if r else None


def count_users() -> int:
    with connect() as c:
        return c.execute("SELECT COUNT(*) FROM users").fetchone()[0]


def init_admin(username: str, password: str) -> dict:
    username, password = (username or "").strip(), password or ""
    if len(username) < 2 or len(username) > 32:
        raise ValueError("用户名需 2-32 个字符")
    if len(password) < 6:
        raise ValueError("密码至少 6 位")
    with connect() as c:
        if c.execute("SELECT COUNT(*) FROM users").fetchone()[0] > 0:
            raise ValueError("管理员已初始化，请直接登录")
        uid = uuid.uuid4().hex
        c.execute("INSERT INTO users(id, username, password, role, created_at) VALUES(?,?,?,?,?)",
                  (uid, username, _hash_password(password), "admin", time.time()))
        c.execute("UPDATE tasks SET user_id=?, username=? WHERE user_id IS NULL OR user_id=''",
                  (uid, username))
    return get_user(uid)


def list_users() -> list:
    with connect() as c:
        rows = c.execute("SELECT * FROM users ORDER BY created_at").fetchall()
        counts = {r["user_id"]: r["n"] for r in c.execute(
            "SELECT user_id, COUNT(*) n FROM tasks GROUP BY user_id").fetchall()}
    out = []
    for r in rows:
        d = _user_dict(r)
        d["task_count"] = counts.get(r["id"], 0)
        out.append(d)
    return out


def create_user(username: str, password: str, role: str = "user") -> dict:
    username = (username or "").strip()
    if len(username) < 2 or len(username) > 32:
        raise ValueError("用户名需 2-32 个字符")
    if len(password or "") < 6:
        raise ValueError("密码至少 6 位")
    if role not in ("admin", "user"):
        raise ValueError("角色只能是 admin 或 user")
    uid = uuid.uuid4().hex
    try:
        with connect() as c:
            c.execute("INSERT INTO users(id, username, password, role, created_at) VALUES(?,?,?,?,?)",
                      (uid, username, _hash_password(password), role, time.time()))
    except sqlite3.IntegrityError:
        raise ValueError("用户名已存在")
    return get_user(uid)


def update_user(uid: str, patch: dict):
    with connect() as c:
        row = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not row:
            raise ValueError("用户不存在")
        sets, args = [], []
        if patch.get("password"):
            if len(patch["password"]) < 6:
                raise ValueError("密码至少 6 位")
            sets.append("password=?"); args.append(_hash_password(patch["password"]))
        if patch.get("role"):
            if patch["role"] not in ("admin", "user"):
                raise ValueError("角色只能是 admin 或 user")
            if row["role"] == "admin" and patch["role"] != "admin":
                if c.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0] <= 1:
                    raise ValueError("必须保留至少一名管理员")
            sets.append("role=?"); args.append(patch["role"])
        if patch.get("username"):
            name = patch["username"].strip()
            if len(name) < 2:
                raise ValueError("用户名太短")
            sets.append("username=?"); args.append(name)
        if not sets:
            return
        try:
            c.execute("UPDATE users SET " + ",".join(sets) + " WHERE id=?", args + [uid])
        except sqlite3.IntegrityError:
            raise ValueError("用户名已存在")


def delete_user(uid: str):
    with connect() as c:
        row = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not row:
            raise ValueError("用户不存在")
        if row["role"] == "admin" and c.execute(
                "SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0] <= 1:
            raise ValueError("不能删除唯一的管理员")
        c.execute("DELETE FROM users WHERE id=?", (uid,))
        c.execute("DELETE FROM sessions WHERE user_id=?", (uid,))


def authenticate(username: str, password: str):
    with connect() as c:
        row = c.execute("SELECT * FROM users WHERE username=?", ((username or "").strip(),)).fetchone()
    if row and verify_password(password or "", row["password"]):
        return _user_dict(row)
    return None


def create_session(uid: str, days: int = 30) -> str:
    token = secrets.token_urlsafe(36)
    now = time.time()
    with connect() as c:
        c.execute("INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES(?,?,?,?)",
                  (token, uid, now, now + days * 86400))
    return token


def user_by_token(token: str):
    if not token:
        return None
    with connect() as c:
        row = c.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id "
            "WHERE s.token=? AND s.expires_at>?", (token, time.time())
        ).fetchone()
    return _user_dict(row) if row else None


def delete_session(token: str):
    with connect() as c:
        c.execute("DELETE FROM sessions WHERE token=?", (token,))


def revoke_user_sessions(uid: str):
    with connect() as c:
        c.execute("DELETE FROM sessions WHERE user_id=?", (uid,))


def can_view(task: dict, user: dict) -> bool:
    if not user:
        return False
    return (task or {}).get("user_id") == user["id"]


def file_owner(name: str) -> str:
    # 反查某张图片归属哪个用户。
    # 必须精确匹配元素，不能 instr() 子串匹配——"abc.png" 会误命中别人的 "xabc.png"
    # 导致 __multi__ → 403；也不能依赖 json 序列化后的字符串做粗筛，因为 finish_ok
    # 用默认 ensure_ascii=True 存中文名（\uXXXX 转义），rename_image_refs 用 False，
    # 两种存储格式并存，粗筛必然有失配。最稳妥：全表精确 JSON 比对（任务量不大，可接受）。
    import json as _json
    with connect() as c:
        rows = c.execute(
            "SELECT user_id, output_images, input_images, mask_image FROM tasks").fetchall()
    ids = set()
    for r in rows:
        hit = False
        for col in ("output_images", "input_images"):
            try:
                arr = _json.loads(r[col] or "[]")
                if isinstance(arr, list) and name in arr:
                    hit = True
                    break
            except (ValueError, TypeError):
                pass
        if hit or r["mask_image"] == name:
            ids.add(r["user_id"] or "")
    if not ids:
        return "__none__"
    if len(ids) == 1:
        return ids.pop() or "__none__"
    return "__multi__"


# ------------------------------ 任务 ------------------------------

def _row_to_dict(r) -> dict:
    d = dict(r)
    for key in ("input_images", "output_images", "params", "request_json"):
        fallback = "{}" if key in ("params", "request_json") else "[]"
        try:
            d[key] = json.loads(d.get(key) or fallback)
        except (ValueError, TypeError):
            d[key] = {} if key in ("params", "request_json") else []
    return d


def create_task(mode, model, prompt, size, quality, n, output_format,
                params, input_images, user, request_json=None, mask_image=None,
                provider_id="", provider_name="") -> dict:
    tid = uuid.uuid4().hex
    now = time.time()
    with connect() as c:
        c.execute(
            """INSERT INTO tasks
               (id, user_id, username, provider_id, provider_name, mode, model, prompt,
                size, quality, n, output_format, mask_image, params, request_json,
                status, input_images, output_images, error, attempts,
                created_at, started_at, finished_at, updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                tid, (user or {}).get("id", ""), (user or {}).get("username", ""),
                provider_id or "", provider_name or "",
                mode, model, prompt, size, quality, n, output_format,
                mask_image or "",
                json.dumps(params, ensure_ascii=False),
                json.dumps(request_json or {}, ensure_ascii=False),
                "pending",
                json.dumps(input_images), "[]", "", 0,
                now, None, None, now,
            ),
        )
    return get_task(tid)


def claim_next():
    now = time.time()
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute(
            """UPDATE tasks SET status='running', started_at=?, updated_at=?, attempts=attempts+1
               WHERE id = (SELECT id FROM tasks WHERE status='pending' ORDER BY created_at LIMIT 1)
                 AND status='pending'
               RETURNING *""",
            (now, now),
        ).fetchone()
        return _row_to_dict(row) if row else None


def get_task(tid: str):
    with connect() as c:
        row = c.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    return _row_to_dict(row) if row else None


def _task_where(viewer, status, q):
    where, args = [], []
    # 所有用户（含管理员）只查自己的任务：管理员不再浏览他人生成记录
    where.append("user_id = ?")
    args.append((viewer or {}).get("id") or "__nobody__")
    if status:
        where.append("status = ?")
        args.append(status)
    if q:
        where.append("(prompt LIKE ? OR model LIKE ? OR username LIKE ?)")
        args += ["%" + q + "%"] * 3
    return ("WHERE " + " AND ".join(where)) if where else "", args


def list_tasks(limit=60, offset=0, status=None, viewer=None, q=""):
    clause, args = _task_where(viewer, status, q)
    with connect() as c:
        total = c.execute("SELECT COUNT(*) FROM tasks " + clause, args).fetchone()[0]
        rows = c.execute(
            "SELECT * FROM tasks " + clause + " ORDER BY created_at DESC LIMIT ? OFFSET ?",
            args + [limit, offset],
        ).fetchall()
    return [_row_to_dict(r) for r in rows], total


def rename_image_refs(old: str, new: str):
    """把 tasks 表里所有 JSON 列对该图片名的引用换成新名称，保持 file_owner() 反查可用。"""
    with connect() as c:
        rows = c.execute("SELECT id, input_images, output_images, mask_image FROM tasks").fetchall()
        for row in rows:
            def swap(raw):
                try:
                    arr = json.loads(raw or "[]")
                except (ValueError, TypeError):
                    arr = []
                hit = old in arr
                return ([new if x == old else x for x in arr] if hit else arr), hit
            ii, h1 = swap(row["input_images"])
            oo, h2 = swap(row["output_images"])
            h3 = row["mask_image"] == old
            if h1 or h2 or h3:
                c.execute(
                    "UPDATE tasks SET input_images=?, output_images=?, mask_image=?, updated_at=? WHERE id=?",
                    (json.dumps(ii, ensure_ascii=False), json.dumps(oo, ensure_ascii=False),
                     new if h3 else row["mask_image"], time.time(), row["id"]))


def remove_image_refs(name: str):
    """从所有任务的 JSON 引用里移除该图片名。

    输出图被删空后，任务失去价值（前端会误渲染「接口没有返回图片」错误框），
    因此一并删除任务记录；参考图 / 遮罩被删但输出图仍在时保留任务、只清对应引用。
    """
    with connect() as c:
        rows = c.execute("SELECT id, input_images, output_images, mask_image FROM tasks").fetchall()
        for row in rows:
            def cut(raw):
                try:
                    arr = json.loads(raw or "[]")
                except (ValueError, TypeError):
                    arr = []
                if name in arr:
                    return [x for x in arr if x != name], True
                return arr, False
            ii, h1 = cut(row["input_images"])
            oo, h2 = cut(row["output_images"])
            h3 = row["mask_image"] == name
            if not (h1 or h2 or h3):
                continue
            if not oo:
                # 输出图空了 → 删除任务（图生图 / 局部修图的参考图随之不再有意义）
                c.execute("DELETE FROM tasks WHERE id=?", (row["id"],))
            else:
                c.execute(
                    "UPDATE tasks SET input_images=?, output_images=?, mask_image=?, updated_at=? WHERE id=?",
                    (json.dumps(ii, ensure_ascii=False), json.dumps(oo, ensure_ascii=False),
                     "" if h3 else row["mask_image"], time.time(), row["id"]))


def finish_ok(tid: str, images: list) -> bool:
    now = time.time()
    with connect() as c:
        cur = c.execute(
            "UPDATE tasks SET status='succeeded', output_images=?, error='', finished_at=?, updated_at=? WHERE id=?",
            (json.dumps(images), now, now, tid),
        )
        return cur.rowcount > 0


def finish_fail(tid: str, error: str) -> bool:
    now = time.time()
    with connect() as c:
        cur = c.execute(
            "UPDATE tasks SET status='failed', error=?, finished_at=?, updated_at=? WHERE id=?",
            (error[:4000], now, now, tid),
        )
        return cur.rowcount > 0


def requeue(tid: str, error: str) -> bool:
    now = time.time()
    with connect() as c:
        cur = c.execute(
            "UPDATE tasks SET status='pending', started_at=NULL, error=?, updated_at=? WHERE id=?",
            (error[:4000], now, tid),
        )
        return cur.rowcount > 0


def delete_task(tid: str):
    with connect() as c:
        row = c.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
        if not row:
            return None
        d = _row_to_dict(row)
        if d["status"] == "running":
            return "running"
        c.execute("DELETE FROM tasks WHERE id=?", (tid,))
    names = d["input_images"] + d["output_images"]
    if d.get("mask_image"):
        names.append(d["mask_image"])
    return names


def clear_finished(viewer=None, all_users: bool = False) -> list:
    """清理已完成 / 失败的任务并回收图片名。

    默认**只清调用者自己的任务**：管理员在公共实例上点「清空已完成」时，
    旧版会把所有用户的历史一起删掉（列表页管理员能看见全站任务，容易误触，
    且图片文件会被物理删除，不可恢复）。全站清理需显式 all_users=True，
    仅 /api/tasks?scope=finished_all 的管理员分支使用。
    """
    where, args = [], []
    if not all_users:
        where.append("user_id = ?")
        args.append((viewer or {}).get("id") or "__nobody__")
    clause = ("WHERE status IN ('succeeded','failed')" +
              (" AND " + " AND ".join(where) if where else ""))
    with connect() as c:
        rows = c.execute(
            "SELECT input_images, output_images, mask_image FROM tasks " + clause, args
        ).fetchall()
        names = []
        for r in rows:
            for k in ("input_images", "output_images"):
                try:
                    names += json.loads(r[k] or "[]")
                except ValueError:
                    pass
            if r["mask_image"]:
                names.append(r["mask_image"])
        c.execute("DELETE FROM tasks " + clause, args)
    return names


def stats(viewer=None) -> dict:
    where, args = [], []
    where.append("user_id = ?")
    args.append((viewer or {}).get("id") or "__nobody__")
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    with connect() as c:
        rows = c.execute("SELECT status, COUNT(*) n FROM tasks " + clause + " GROUP BY status", args).fetchall()
    out = {"pending": 0, "running": 0, "succeeded": 0, "failed": 0}
    for r in rows:
        out[r["status"]] = r["n"]
    out["total"] = sum(out.values())
    return out


# ------------------------------ 用量统计（仅管理员） ------------------------------

def usage_stats(user_id=None) -> dict:
    sql = ("SELECT user_id, username, model, provider_name, status, n, "
           "created_at, started_at, finished_at, output_images FROM tasks")
    args = []
    if user_id:
        sql += " WHERE user_id = ?"
        args.append(user_id)
    with connect() as c:
        rows = c.execute(sql, args).fetchall()
    by_user, by_model, by_day = defaultdict(lambda: {"total": 0, "succeeded": 0, "failed": 0, "images": 0}), \
                                defaultdict(lambda: {"total": 0, "succeeded": 0, "images": 0}), \
                                defaultdict(lambda: {"total": 0, "succeeded": 0, "images": 0})
    durations, total_images = [], 0
    for r in rows:
        ok = r["status"] == "succeeded"
        try:
            imgs = len(json.loads(r["output_images"] or "[]"))
        except ValueError:
            imgs = 0
        total_images += imgs
        u = by_user[r["username"] or "未知用户"]
        u["total"] += 1; u["images"] += imgs
        u["succeeded" if ok else "failed"] += 1
        m = by_model[r["model"] or "未知模型"]
        m["total"] += 1; m["images"] += imgs
        if ok: m["succeeded"] += 1
        day = datetime.fromtimestamp(r["created_at"] or 0).strftime("%Y-%m-%d")
        d = by_day[day]
        d["total"] += 1; d["images"] += imgs
        if ok: d["succeeded"] += 1
        if ok and r["started_at"] and r["finished_at"] and r["finished_at"] > r["started_at"]:
            durations.append(r["finished_at"] - r["started_at"])

    def ranked(d, key):
        return [dict(**{key: k}, **v) for k, v in sorted(d.items(), key=lambda x: -x[1]["total"])]

    return {
        "total_tasks": len(rows),
        "succeeded": sum(1 for r in rows if r["status"] == "succeeded"),
        "failed": sum(1 for r in rows if r["status"] == "failed"),
        "images": total_images,
        "avg_seconds": round(sum(durations) / len(durations), 1) if durations else 0,
        "by_user": ranked(by_user, "username"),
        "by_model": ranked(by_model, "model"),
        "by_day": sorted([dict(day=k, **v) for k, v in by_day.items()], key=lambda x: x["day"], reverse=True)[:30],
    }
