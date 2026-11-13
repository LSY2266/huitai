"""全局常量与环境变量默认值。

配置分两层：
1. 环境变量（部署时设定，作为初始值）
2. SQLite settings 表（管理员在网页「设置」里修改后覆盖，跨设备共享）

同一个 Docker / Windows 服务，手机和电脑打开看到的是同一份配置。
数据目录：data/（数据库 + 网页展示用图片）；output/（按用户分目录的成品存档，建议单独挂载）。
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# PyInstaller 单文件运行时：资源解压到 sys._MEIPASS，数据目录仍跟随 exe 所在位置
if getattr(__import__("sys"), "frozen", False):
    ROOT = Path(__import__("sys")._MEIPASS)

# 数据目录：exe 旁边，与代码资源分离（升级覆盖 exe 不丢数据）
if getattr(__import__("sys"), "frozen", False):
    _EXE_DIR = Path(__import__("sys").executable).resolve().parent
    DATA_DIR = Path(os.environ.get("DATA_DIR", str(_EXE_DIR / "data"))).resolve()
    OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", str(_EXE_DIR / "output"))).resolve()
else:
    DATA_DIR = Path(os.environ.get("DATA_DIR", str(ROOT / "data"))).resolve()
    OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", str(ROOT / "output"))).resolve()
IMAGES_DIR = DATA_DIR / "images"
DB_PATH = DATA_DIR / "workbench.db"

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "7401"))

# 默认模型同时覆盖 OpenAI 官方 2.5/2.6 的 API ID 与常见的中转服务简写别名。
DEFAULT_MODELS = ",".join([
    "gpt-image-2.6-sunburst",
    "gpt-image-2.6-flare",
    "gpt-image-2.5-sunburst",
    "gpt-image-2.5-flare",
    "gpt-image-2.6",
    "gpt-image-2.5",
])

# 提示词优化系统指令：文生图 / 图生图各一套。
# 文生图侧重「从零补全画面」，图生图侧重「锁定参考图 + 只描述改动」，
# 两套分开后不会出现把图生图写成重新生成一整张图的问题。
DEFAULT_OPTIMIZE_PROMPT_T2I = (
    "你是一名资深 AI 绘画提示词工程师，负责把用户的粗略想法改写成一条可直接提交给文生图模型的高质量中文提示词。\n"
    "\n"
    "【工作目标】\n"
    "1. 忠实原意：保留用户明确指定的主体、数量、动作、场景、颜色、文字内容与风格，不擅自增删或替换对象。\n"
    "2. 补全画面：主体特征（外形 / 材质 / 状态）、构图与视角、环境与背景、光线与时段、色彩基调、"
    "质感细节、氛围情绪、艺术媒介（摄影 / 插画 / 3D / 油画等）、镜头与画质。\n"
    "3. 组织顺序：主体 → 动作姿态 → 环境 → 光线 → 色彩氛围 → 风格 → 镜头画质，用逗号分隔的短语，"
    "避免长句、说理和重复修饰。\n"
    "4. 重要信息前置；不写负面词、参数名、解释性文字；不虚构用户未提及的品牌、人名或 IP。\n"
    "5. 原文已足够完整时只做润色与结构化，不要扩写成另一幅画。\n"
    "\n"
    "【动图 / GIF / SVG / 矢量图专用规则】\n"
    "当用户输入涉及动图、GIF、GIF 动图、SVG、矢量图（含 ssvg 等笔误）时：\n"
    "1. 优化后的提示词第一句必须是「请生成一张x图：」，x 按用户实际类型替换为"
    "「动图 / GIF 动图 / SVG 矢量图 / 矢量图」之一；这一句属于提示词正文，不是标题或解释，"
    "冒号后紧接优化后的内容，整段仍是一段连续中文。\n"
    "2. 优化内容必须匹配该类型画面：GIF / 动图突出主体运动、帧间变化、循环节奏与动作连贯；"
    "SVG / 矢量图突出扁平化几何构成、清晰轮廓、纯色色块与可缩放线条，"
    "不要写实摄影、景深、光影颗粒、皮肤质感等与矢量 / 动画风格冲突的描述。\n"
    "3. 用户指定的主体、文字、颜色、数量必须保留，不得因套用类型词而丢失原意。\n"
    "\n"
    "【输出格式】\n"
    "只输出改写后的提示词本身：一段连续中文，不要标题、引号、编号、分点、换行，不要任何解释或前后缀；"
    "「请生成一张x图：」这类类型前缀属于正文，必须保留。"
)

DEFAULT_OPTIMIZE_PROMPT_I2I = (
    "你是一名资深 AI 绘画提示词工程师，专门改写「图生图 / 图像编辑 / 局部重绘」任务指令。"
    "用户会同时上传一张或多张参考图，模型需要在参考图基础上做修改。\n"
    "\n"
    "【工作目标】\n"
    "1. 明确这是编辑任务：参考图里已有、且用户未要求改变的元素（主体身份、构图、视角、光线、色调、"
    "背景、画风），都要写「保持…不变 / 沿用参考图…」加以锁定。\n"
    "2. 把改动诉求写成可执行动作：改什么、改成什么、放在哪里；涉及多张参考图时用"
    "「参考图1 / 参考图2」或用户已有的 @参考图N 标记明确指代，不要改动、删除或重编号这些标记。\n"
    "3. 只描述需要变化的部分，不要重新描述整幅画面，也不要凭空生成参考图中不存在的新主体。\n"
    "4. 补充衔接要求：边缘自然过渡、光影一致、透视与原图匹配、材质与颗粒感一致、无拼接痕迹、"
    "不产生多余肢体或物体。\n"
    "5. 保留用户明确指定的文字内容、颜色、数量与风格词，不新增与原意冲突的对象。\n"
    "6. 若为局部重绘，强调「仅修改指定区域，其余区域保持像素级一致」。\n"
    "\n"
    "【输出格式】\n"
    "只输出改写后的提示词本身：一段连续中文，不要标题、引号、编号、分点、换行，不要任何解释或前后缀；"
    "原文里的 @参考图N 等标记必须原样保留。"
)

# 2.1.1 之前的默认文生图指令，仅用于老库平滑迁移：
# 只有 settings 里仍是一字未改的旧默认值时才替换，管理员自定义过的指令绝不动。
DEFAULT_OPTIMIZE_PROMPT_T2I_V1 = (
    "你是一名资深 AI 绘画提示词工程师，负责把用户的粗略想法改写成一条可直接提交给文生图模型的高质量中文提示词。\n"
    "\n"
    "【工作目标】\n"
    "1. 忠实原意：保留用户明确指定的主体、数量、动作、场景、颜色、文字内容与风格，不擅自增删或替换对象。\n"
    "2. 补全画面：主体特征（外形 / 材质 / 状态）、构图与视角、环境与背景、光线与时段、色彩基调、"
    "质感细节、氛围情绪、艺术媒介（摄影 / 插画 / 3D / 油画等）、镜头与画质。\n"
    "3. 组织顺序：主体 → 动作姿态 → 环境 → 光线 → 色彩氛围 → 风格 → 镜头画质，用逗号分隔的短语，"
    "避免长句、说理和重复修饰。\n"
    "4. 重要信息前置；不写负面词、参数名、解释性文字；不虚构用户未提及的品牌、人名或 IP。\n"
    "5. 原文已足够完整时只做润色与结构化，不要扩写成另一幅画。\n"
    "\n"
    "【输出格式】\n"
    "只输出改写后的提示词本身：一段连续中文，不要标题、引号、编号、分点、换行，不要任何解释或前后缀。"
)

# 兼容旧调用 / 旧数据库里只有一个 llm_system_prompt 的情况：默认等同文生图指令
DEFAULT_OPTIMIZE_PROMPT = DEFAULT_OPTIMIZE_PROMPT_T2I

DEFAULTS = {
    # ---- 图片模型设置（仅管理员可编辑） ----
    "api_base": os.environ.get("API_BASE", ""),
    "api_key": os.environ.get("API_KEY", ""),
    "models": os.environ.get("MODELS", DEFAULT_MODELS),
    "generate_path": os.environ.get("GENERATE_PATH", ""),
    "edit_path": os.environ.get("EDIT_PATH", ""),
    "edit_field": os.environ.get("EDIT_FIELD", "image[]"),
    "mask_field": os.environ.get("MASK_FIELD", "mask"),
    "i2i_mode": os.environ.get("I2I_MODE", "edits"),
    "concurrency": os.environ.get("CONCURRENCY", "2"),
    "timeout": os.environ.get("TIMEOUT", "600"),
    "auto_retry": os.environ.get("AUTO_RETRY", "0"),
    "access_key": os.environ.get("ACCESS_KEY", ""),
    # ---- 语言模型设置（仅管理员可编辑） ----
    # 留空表示复用图片接口的 API 地址 / Key；也可单独填一个兼容 OpenAI 的中转
    "llm_api_base": os.environ.get("LLM_API_BASE", ""),
    "llm_api_key": os.environ.get("LLM_API_KEY", ""),
    "llm_model": os.environ.get("LLM_MODEL", "gpt-4o-mini"),
    # 分模式优化系统指令；llm_system_prompt 保留为旧版单指令兼容字段
    "llm_system_prompt_t2i": os.environ.get("LLM_SYSTEM_PROMPT_T2I", DEFAULT_OPTIMIZE_PROMPT_T2I),
    "llm_system_prompt_i2i": os.environ.get("LLM_SYSTEM_PROMPT_I2I", DEFAULT_OPTIMIZE_PROMPT_I2I),
    "llm_system_prompt": os.environ.get("LLM_SYSTEM_PROMPT", ""),
    "llm_timeout": os.environ.get("LLM_TIMEOUT", "120"),
    # 创作面板三套默认参数（JSON 字符串），管理员设置、全站设备共用
    "ui_defaults": "",
}

# 密钥类：对外只暴露「是否已设置」布尔值，不回显任何片段
SECRET_KEYS = {"api_key", "access_key", "llm_api_key"}

# 普通用户允许读取的非敏感运行参数（前端需要模型列表来渲染下拉框）
PUBLIC_SETTING_KEYS = {
    "models", "i2i_mode", "edit_field", "concurrency", "timeout", "auto_retry",
    "ui_defaults",
}

# 唯一版本源：网页顶栏、/api/health、Docker 镜像 tag、离线包文件名都由这里派生。
# 发新版只改这一行，再执行 `python3.11 release.py` 自动出包，不要手改别处的版本号。
# 语义化版本 vMAJOR.MINOR.PATCH：新增功能升 MINOR，纯修 bug 升 PATCH。
# 版本号唯一来源；后续每次变更按语义化版本递增 +0.0.1（2.1.1 → 2.1.1 → …）
VERSION = "2.1.1"
