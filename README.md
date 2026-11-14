# 绘台 Huitai · AI 生图工作台

> 一个跑在**你自己的 Windows 电脑 / NAS / 服务器**上的 AI 生图前端。
> 手机浏览器直接打开，接入 GPT Image 2.5 / 2.6 及任何 OpenAI 兼容生图接口，
> 支持**文生图、图生图、局部修图、GIF 动图、SVG 矢量图**。
>
> **它最核心的一句话：任务提交后由服务端执行，不依赖浏览器。请求JSON及返回JSON皆可查看可编辑**
> 关页面、锁屏、刷新、重启服务，任务都不会丢。


---

## 一、为什么做它

市面上的 AI 生图工具大致分两类，各有各的别扭：

| 路线 | 代表 | 别扭在哪 |
| --- | --- | --- |
| 本地推理全家桶 | ComfyUI、SD WebUI、Fooocus | 为「本地显卡跑 Stable Diffusion / Flux」而生：要求 GPU、依赖 Python 节点生态、桌面优先、单用户。只是想用云端生图 API 的人，要为此装一整套推理环境 |
| 云端生图服务 | Midjourney、DALL·E 官网、各类在线工具 | 提示词、历史、图片全存在别人服务器上；按人头收费，想和家人 / 团队共用一个 API Key 很别扭；手机上体验参差 |

而「直接调 API」的路（cURL、Postman、ChatGPT 式聊天框）在真正出图时都不够用：
**手机没法拍照上传参考图、没法画遮罩做局部修图、没法看历史画廊、没法打包下载、任务还和浏览器页面绑死**。

本项目的起点就是填这几条缝：

1. **任务和浏览器解绑**。常见 Web 前端把生图任务放在浏览器页面里——手机锁屏、切后台、关页面，任务就死了。绘台把任务写进服务端 SQLite，由后台线程执行，浏览器只是「查看器」。这是它和绝大多数同类工具最本质的区别。
2. **生图 API 的 GIF / SVG 能力**。新的图像 API 支持 GIF 动图和 SVG 矢量图，但主流前端要么没有入口，要么参数白名单把 `frame_count`、`svg.model` 这些字段直接丢掉——「明明填了参数却返回静态 PNG」。绘台把它做成第三个独立面板，参数按官方 API 与社区实测收敛，完整透传。
3. **一个 Key，多人共用**。家庭、小团队里管理员配一次 API Key，普通用户只管出图，各人只看得到自己的图和提示词库；Key 保存后不回显任何字符，连后四位都不给。
4. **手机优先**。尺寸 / 分辨率 / 画质全是自绘的可搜索下拉，不弹系统原生选择器；支持相册选图、拍照、粘贴；自动单栏布局。
5. **数据留在自己家里**。跑在 Windows / NAS Docker 上，数据库、图片、存档全在你自己的硬盘，配合 NAS 的文件管理和备份习惯。

---

## 二、功能

| 分组 | 能力 |
| --- | --- |
| **生图三面板** | 文生图、图生图（最多 8 张参考图 + 画笔遮罩局部修图）、GIF 动图 / SVG 矢量图，三个独立面板 |
| **参数** | 比例（含自定义）/ 1K·2K·4K 分辨率 / 画质 / 深度规划，实时换算像素；GIF 面板另有帧数、帧时长、帧尺寸与像素预算条 |
| **请求 JSON 编辑** | 高级参数下方可展开，直接查看并改写**最终发送的完整请求体**——排查中转参数支持问题最直观的入口 |
| **提示词** | 管理员预设标签（点击追加 / 再点移除，高亮自动跟随内容）、LLM 提示词优化（可一键撤回）、按用户隔离的历史与收藏 |
| **参考图** | 点击 / 拖拽 / 粘贴 / 手机拍照，可从历史生成图选取；拖拽排序自动编号；提示词输入 `@` 弹出引用菜单（按编号或文件名过滤） |
| **图片操作** | 大图预览（格式 / 分辨率 / 大小）、**勾选打包 ZIP**、卡片一键把结果图加入图生图、局部修图 |
| **账号** | 管理员 / 普通用户；普通用户只能看自己的图，右上角无设置入口；管理员有用量统计 |
| **多服务商** | 图片模型服务、语言模型服务都可添加多组（各自地址 / Key / 模型），创作面板随时切换 |
| **模型列表** | 从 `/v1/models` 一键拉取（不产生费用），自动合并保存到服务配置，全设备可用 |
| **统一下拉框** | 全部参数下拉为同一套自绘浮层：输入过滤、键盘选择、Esc 收起；手机不弹系统选择器，点别处立即收起 |
| **后台队列** | SQLite 持久化 + 后台线程池（1–8 并发可调），`UPDATE … RETURNING` 原子抢占不会重复出图；重启自动续跑，失败自动重试 |
| **成品存档** | `output/<用户名>/` 分目录保存，附 `manifest.jsonl` 记录提示词、模型、参数；删除任务不删存档 |

### 为什么「关掉页面也不会停」

```
浏览器 ──POST /api/tasks──> SQLite(pending) ──> 后台 worker 线程 ──> 生图 API
                                  │                     │
                                  └── status/结果写回 ───┘
浏览器 ──GET /api/tasks──> 读到最新状态与图片（随时打开都行）
```

- 任务一提交就写进 `data/workbench.db`，浏览器只是查看器；
- worker 是服务端独立线程，数据库级原子抢占，多并发不会重复生成；
- 服务重启 / 容器重建时把残留任务改回待执行，自动续跑；
- 图片落盘两份：`data/images/` 供网页展示，`output/<用户名>/` 长期存档。

### GIF / SVG 面板的特殊处理

> **红线**：GIF、SVG 只支持文生图（新建图）。图生图 / 编辑接口无论怎么填参数，一律返回静态 PNG。
> 工作台把它们独立成第三个面板，面板里不显示参考图上传、不带位图的 `size`，从根上避免误用。

| 参数 | GIF | SVG | 说明 |
| --- | --- | --- | --- |
| `output_format` | `gif` | `svg` | 必填，不写就是静态图 |
| `n` | 1 | **强制 1** | `n>1` 时 SVG 直接报错 |
| `frame_count` | **2–16，默认 9** | — | 官方 guide 写 2–64，API 实测只接受 2–16 |
| `frame_duration_ms` | **20–2000，默认 200** | — | 越小越快 |
| `svg.model` | — | 默认 `gpt-6.1-sol`，可改 | 多数网关必填，缺失报 `SVG generation requires 'svg.model'` |
| `quality` | low/medium/high/xhigh/**max** | 可选（实际无效果） | 官方枚举含 `max` |

旧版参数白名单会丢弃 `svg` 对象，是「填了参数却返回 PNG」的主因之一——绘台**完整透传**。

---



### 三、优势汇总

1. **任务永不丢**——服务端执行、数据库排队、重启续跑。你可以提交后直接锁屏出门，回家再看结果。
2. **手机是第一公民**——不是「桌面页面缩到手机上」，而是拍照上传、自绘下拉、单栏布局都按手机做。
3. **GIF / SVG 这条线真的能用**——参数按官方 API 与社区实测收敛，红线处理（GIF/SVG 只走文生图）从 UI 上防止误用，「返回 PNG」的排查路径直接内建（请求 JSON 编辑 + 返回格式检测提示）。
4. **一个 Key 全家用**——普通用户看不到设置，碰不到 Key；各人历史、收藏、成品互相隔离。
5. **多服务商随切**——官方、中转、不同模型各存一组配置，面板里随时切；「测试连接」只请求 `/v1/models`，不产生费用。
6. **零构建前端**——原生 HTML/CSS/JS，无 npm、无 CDN、无需联网装前端依赖；NAS 断网也能打开页面看历史。
7. **重装不怕**——安装 / 升级前自动清理旧容器、旧镜像、残留网络，`data/` 与 `output/` 一律保留；版本号单一来源，顶栏版本与安装包文件名必定一致。
8. **部署是「上传 + 粘贴」级别的**——NAS 用离线镜像不用联网装依赖；Windows 双击 `run_windows.bat` 自动建环境开浏览器。

### 诚实说明（它不做什么）

- 它是 **API 客户端**，不做本地推理：没有 LoRA 训练、没有节点图、不管理 checkpoints。这些请用 ComfyUI / SD WebUI——两者定位不同，甚至可以共存（同一台 NAS，各占一个端口）。
- GIF / SVG 的效果取决于你接入的生图 API 与网关是否支持并完整转发参数；工作台会把最终请求体交给你核对，但接口本身返回 PNG 时它会如实告诉你「这是接口行为，不是工作台转换」。

---

## 四、快速开始

### Windows

1. 安装 [Python 3.10+](https://www.python.org/downloads/)，勾选 `Add Python to PATH`；
2. 下载项目，双击 **`run_windows.bat`**（首次自动建虚拟环境、装依赖、开浏览器）；
3. 打开 `http://localhost:7401` → 创建管理员 → 右上角设置里填 API 地址和 Key。

### NAS / 服务器 Docker

```bash
cd /volume1/docker/huitai
mkdir -p data output                # 两个并列文件夹，compose 自动映射
docker compose up -d --build
```

打开 `http://NAS的IP:7401`。国内构建卡在 `pip install` 时，把 `.env` 里 `PIP_INDEX_URL` 换成清华源。
不想在设备上构建就直接拉现成镜像：`docker pull ghcr.io/tarocats/huitai:2.1.1`（多架构，amd64 / arm64 都含）；
断网环境用 `bash build-image.sh` 在本机打的 `huitai-v<版本>-amd64.tar` 导入也行。

### 手机

同一 WiFi 访问 `http://电脑或NAS的局域网IP:7401`。外网访问建议反代 + HTTPS，并开启「访问密码」。

> **v2.1 起需要登录**：第一次打开会引导创建管理员账号；普通用户由管理员在「用户管理」里添加。
> 环境变量（`API_BASE` 等）只在首次启动时作为初始值写入，之后一律以网页设置为准。

### 飞牛 NAS（fnOS）

先确认设备架构：`uname -m` 出 `x86_64` 就选 **x86** 包，出 `aarch64` 就选 **arm** 包（两个包内容一样，只是 `manifest` 里声明的平台不同，装错了应用中心会拒绝）。

**1. 应用中心手动装**

到 [Releases](https://github.com/TaroCats/huitai/releases) 下载 `huitai_<版本>_x86.fpk` 或 `huitai_<版本>_arm.fpk`，
打开「应用中心 → 手动安装」上传即可。装完桌面出现「绘台」图标，点开就是 `http://设备IP:7401`。

数据落在 `/var/apps/huitai/shares/huitai/` 下：`data/` 存数据库与展示图，`output/` 存成品图。
这块目录由飞牛托管，升级覆盖、卸载重装都不会动它，也能在「文件管理」里直接翻到成品图。

**2. FnDepot 第三方源（装完自动跟随新版本）**

在 FnDepot 里添加源：

```
https://github.com/TaroCats/huitai
```

它读仓库根目录的 `fnpack.json`（FnDepot 外部源 V2 规范）。这个文件由 CI 在每次发版时自动回写，
所以之后有新版本会直接出现在更新列表里，不用再手动下 FPK。

**3. 只跑镜像，不要应用中心那一层**

```bash
docker run -d --name huitai -p 7401:7401 \
  -v /vol1/1000/huitai/data:/app/data \
  -v /vol1/1000/huitai/output:/app/output \
  ghcr.io/tarocats/huitai:2.1.1
```

镜像同时含 `linux/amd64` 与 `linux/arm64` 两层，设备自动挑对应那一层。

> **拉不到镜像先看这里**：GHCR 的包第一次推送后默认是**私有**的，而装 FPK 的设备不会 `docker login`。
> 到仓库 → **Packages** → `huitai` → **Package settings** → 把可见性改成 **Public**（只需一次）。
> 发版流水线里有一道匿名拉取校验，包还是私有会直接报红并提示这一步。

---

## 五、技术概览

单进程 FastAPI + SQLite + 后台线程池，前端原生 HTML/CSS/JS 无构建：

```
app/
├── main.py        # FastAPI 路由、登录鉴权、权限隔离（~836 行）
├── db.py          # SQLite：任务/用户/会话/服务商/预设/提示词库/用量（~884 行）
├── provider.py    # 生图接口适配、请求 JSON 覆盖、LLM 优化、落盘与存档（~695 行）
├── worker.py      # 后台任务线程池（1–8 并发，原子抢占，~91 行）
├── config.py      # 路径与环境变量默认值
└── static/        # 前端（index.html 829 / style.css 1089 / app.js 4516，无依赖）
```

- **版本号单一来源**：`app/config.py` 的 `VERSION`。镜像 tag、离线包文件名、网页顶栏、`/api/health` 全部由它派生，发版脚本自动校验一致性；
- **隐私**：仓库与发布包不内置任何 API 地址 / Key（默认值全部为空），装好后由你在网页里填写；所有 Key 密码框保存后不回显；
- **两个必挂载目录**：`data/`（数据库 + 展示图片，删了丢历史）、`output/`（按用户存档，删任务不删这里）。

---


## 六、常见问题（速览）

**Q：任务提交后能不能关电脑？**
Windows 本机运行：关机即停服务，已提交任务在下次启动时自动续跑；NAS / 服务器：只要 Docker 容器在跑，任务就在后台执行，与任何浏览器无关。

**Q：忘了管理员密码？**
两条 SQL 清空用户表即可，任务和历史都保留（见 README.md 常见问题）。

**Q：选了 GIF / SVG 却返回静态 PNG？**
按顺序排查：是否误用图生图 / 局部修图（GIF/SVG 只走文生图）→ 网关是否丢弃参数（展开「请求 JSON 编辑」核对）→ SVG 是否缺 `svg.model`。工作台会在卡片上提示「接口返回的是 PNG，不是 GIF/SVG」，说明是接口行为。

**Q：一打开就要求「访问密码」？**
它不是管理员密码，是可选网关锁，默认关闭。清空 `data/workbench.db` 的 `access_key` 设置并检查环境变量 `ACCESS_KEY` 即可（详见 README.md）。


---

## 七、发版与 CI（维护者看）

版本号只有**一个**地方改：`app/config.py` 里的 `VERSION`。镜像 tag、FPK 的 `manifest`、`/api/health`、网页顶栏全都从它派生。

```bash
# 1. 改 app/config.py → VERSION = "2.1.2"
git commit -am "feat: ..."
git tag v2.1.2
git push origin main --tags
```

推 tag 后 [`.github/workflows/release.yml`](.github/workflows/release.yml) 跑五段：

| 阶段 | 干什么 |
| --- | --- |
| `prepare` | 从 `app/config.py` 读版本，并校验 tag 与之一致，不一致当场失败 |
| `docker`（矩阵 amd64 / arm64） | QEMU + buildx 各建一份，**按 digest 推送不打 tag** |
| `manifest` | 两个 digest 合成多架构清单，打 `:2.1.2` / `:2.1` / `:latest`；起容器打 `/api/health` 冒烟 |
| `fpk`（矩阵 x86 / arm） | 渲染 `manifest` 与镜像 tag，`fnpack build` 出 `huitai_2.1.2_x86.fpk` / `_arm.fpk` |
| `release` | 建 GitHub Release 挂两个 FPK；把 `fnpack.json` 回写 main；校验镜像可匿名拉取 |

几个刻意的设计：

- **tag 必须等于 `v` + `VERSION`**，否则 `prepare` 直接报错——防止「tag 打了、包还是旧版本号」这种事后才发现；
- **镜像先按 digest 推、再合成清单**，所以中途不会出现只有 amd64 的 `:latest` 被谁拉走；
- **`fnpack.json` 由 CI 生成并提交回 main**，不要手改；要调整内容改 `scripts/gen_fnpack.py`；
- **FPK 里写死的镜像 tag 由 CI 注入**，不在模板里手写，避免包与镜像版本走偏。

本地想验一遍打包（不推任何东西）：

```bash
bash scripts/install-fnpack.sh                     # 取 fnpack 1.2.3（带 SHA256 校验）
python3 scripts/build_fpk.py --arch x86 --version 2.1.1 \
    --image ghcr.io/tarocats/huitai:2.1.1 --out-dir dist
python3 scripts/gen_fnpack.py --version 2.1.1 \
    --package x86=dist/huitai_2.1.1_x86.fpk --package arm=dist/huitai_2.1.1_arm.fpk \
    --base-url https://github.com/TaroCats/huitai/releases/download/v2.1.1
```


