/* 绘台 · AI 生图工作台 前端逻辑（无构建、无外部依赖） */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const STATUS = {
    pending: ['排队中', 'pending'], running: ['生成中', 'running'],
    succeeded: ['已完成', 'succeeded'], failed: ['失败', 'failed'],
  };
  const RATIOS = [
    ['1:1', 1, 1], ['4:3', 4, 3], ['3:4', 3, 4], ['3:2', 3, 2], ['2:3', 2, 3],
    ['16:9', 16, 9], ['9:16', 9, 16], ['21:9', 21, 9], ['5:4', 5, 4], ['4:5', 4, 5],
  ];
  const RATIO_WH = Object.fromEntries(RATIOS.map(([k, w, h]) => [k, [w, h]]));
  const SIZE_TABLE = {
    '1:1':  { '1k': '1024x1024', '2k': '2048x2048', '4k': '4096x4096' },
    '4:3':  { '1k': '1024x768',  '2k': '2048x1536', '4k': '4096x3072' },
    '3:4':  { '1k': '768x1024',  '2k': '1536x2048', '4k': '3072x4096' },
    '3:2':  { '1k': '1152x768',  '2k': '2304x1536', '4k': '4608x3072' },
    '2:3':  { '1k': '768x1152',  '2k': '1536x2304', '4k': '3072x4608' },
    '16:9': { '1k': '1280x720',  '2k': '2560x1440', '4k': '3840x2160' },
    '9:16': { '1k': '720x1280',  '2k': '1440x2560', '4k': '2160x3840' },
    '21:9': { '1k': '1680x720',  '2k': '3360x1440', '4k': '5040x2160' },
    '5:4':  { '1k': '1152x896',  '2k': '2304x1792', '4k': '4608x3584' },
    '4:5':  { '1k': '896x1152',  '2k': '1792x2304', '4k': '3584x4608' },
  };
  const GIF_HINT = '无缝循环动画，动作连贯，明确运动变化，禁止画面抖动与形变';
  const SVG_HINT = '扁平化矢量图形，纯路径与色块，无位图、无渐变贴图，可编辑 SVG';
  const BODY_KEYS = new Set(['model', 'prompt', 'n', 'size', 'quality', 'output_format',
    'reasoning_effort', 'background', 'frame_count', 'frame_duration_ms',
    'aspect_ratio', 'resolution', 'complexity', 'frame_size', 'svg']);
  // GIF / SVG 面板默认值（与 OpenAI Images 2.6 官方 / 实测规范对齐）
  const FMT_DEFAULTS = {
    // GIF / SVG 默认 1:1（接口默认比例），避免默认 16:9 触发网关尺寸/拼图预算问题
    ratio: '1:1', resolution: '1k', quality: '', complexity: '',
    frames: '9', duration: '200', frameSize: '', svgModel: 'gpt-6.1-sol', svgEffort: 'medium',
  };

  // 创作面板默认参数（文生图 / 图生图一致，用户仍可随时手动改）
  const DEFAULT_PARAMS = {
    ratio: '16:9', resolution: '4k', quality: 'xhigh', reasoning: 'high',
    count: '1', format: '', background: '',
  };

  // 与 app/config.py 的 DEFAULT_OPTIMIZE_PROMPT_T2I / _I2I 保持同步，
  // 供设置页「恢复推荐」按钮使用（改文案时前后端要一起改）。
  const RECOMMENDED_OPTIMIZE = {
    t2i: [
      '你是一名资深 AI 绘画提示词工程师，负责把用户的粗略想法改写成一条可直接提交给文生图模型的高质量中文提示词。',
      '',
      '【工作目标】',
      '1. 忠实原意：保留用户明确指定的主体、数量、动作、场景、颜色、文字内容与风格，不擅自增删或替换对象。',
      '2. 补全画面：主体特征（外形 / 材质 / 状态）、构图与视角、环境与背景、光线与时段、色彩基调、质感细节、氛围情绪、艺术媒介（摄影 / 插画 / 3D / 油画等）、镜头与画质。',
      '3. 组织顺序：主体 → 动作姿态 → 环境 → 光线 → 色彩氛围 → 风格 → 镜头画质，用逗号分隔的短语，避免长句、说理和重复修饰。',
      '4. 重要信息前置；不写负面词、参数名、解释性文字；不虚构用户未提及的品牌、人名或 IP。',
      '5. 原文已足够完整时只做润色与结构化，不要扩写成另一幅画。',
      '',
      '【动图 / GIF / SVG / 矢量图专用规则】',
      '当用户输入涉及动图、GIF、GIF 动图、SVG、矢量图（含 ssvg 等笔误）时：',
      '1. 优化后的提示词第一句必须是「请生成一张x图：」，x 按用户实际类型替换为「动图 / GIF 动图 / SVG 矢量图 / 矢量图」之一；这一句属于提示词正文，不是标题或解释，冒号后紧接优化后的内容，整段仍是一段连续中文。',
      '2. 优化内容必须匹配该类型画面：GIF / 动图突出主体运动、帧间变化、循环节奏与动作连贯；SVG / 矢量图突出扁平化几何构成、清晰轮廓、纯色色块与可缩放线条，不要写实摄影、景深、光影颗粒、皮肤质感等与矢量 / 动画风格冲突的描述。',
      '3. 用户指定的主体、文字、颜色、数量必须保留，不得因套用类型词而丢失原意。',
      '',
      '【输出格式】',
      '只输出改写后的提示词本身：一段连续中文，不要标题、引号、编号、分点、换行，不要任何解释或前后缀；「请生成一张x图：」这类类型前缀属于正文，必须保留。',
    ].join('\n'),
    i2i: [
      '你是一名资深 AI 绘画提示词工程师，专门改写「图生图 / 图像编辑 / 局部重绘」任务指令。用户会同时上传一张或多张参考图，模型需要在参考图基础上做修改。',
      '',
      '【工作目标】',
      '1. 明确这是编辑任务：参考图里已有、且用户未要求改变的元素（主体身份、构图、视角、光线、色调、背景、画风），都要写「保持…不变 / 沿用参考图…」加以锁定。',
      '2. 把改动诉求写成可执行动作：改什么、改成什么、放在哪里；涉及多张参考图时用「参考图1 / 参考图2」或用户已有的 @参考图N 标记明确指代，不要改动、删除或重编号这些标记。',
      '3. 只描述需要变化的部分，不要重新描述整幅画面，也不要凭空生成参考图中不存在的新主体。',
      '4. 补充衔接要求：边缘自然过渡、光影一致、透视与原图匹配、材质与颗粒感一致、无拼接痕迹、不产生多余肢体或物体。',
      '5. 保留用户明确指定的文字内容、颜色、数量与风格词，不新增与原意冲突的对象。',
      '6. 若为局部重绘，强调「仅修改指定区域，其余区域保持像素级一致」。',
      '',
      '【输出格式】',
      '只输出改写后的提示词本身：一段连续中文，不要标题、引号、编号、分点、换行，不要任何解释或前后缀；原文里的 @参考图N 等标记必须原样保留。',
    ].join('\n'),
  };

  const state = {
    user: null, settings: {}, providers: [], presets: [],
    tasks: [], serverTime: Date.now() / 1000, stats: {}, filter: 'all', q: '', mode: 't2i',
    fmtKind: 'gif',
    files: [], cards: new Map(), accessKey: localStorage.getItem('iw_access_key') || '',
    timer: null, searchTimer: null, lb: { names: [], idx: 0, taskId: null },
    reqJsonEdited: false, reqJsonManual: false, sizeOverride: '', promptBeforeOptimize: null, clockOffset: 0,
    promptKind: 'history', promptViewQuery: '', bankTab: 'preset', setupMode: false,
    inpaint: { taskId: null, name: null, blob: null, url: null, tool: 'brush',
               drawing: false, start: null, last: null, snapshot: null, hasPaint: false },
    modelMenu: { open: false, filtered: [], index: -1 },
    fetchedModels: (() => {
      try { return JSON.parse(localStorage.getItem('iw_fetched_models') || '{}'); }
      catch (e) { return {}; }
    })(),
    picker: { items: [], filtered: [], selected: new Set(), index: 0, target: null, single: false },
    // 打包下载：勾选的图片，key = 任务 id + '|' + 输出文件名
    pickedImages: new Set(),
    at: { open: false, query: '', index: 0, start: -1, end: -1, items: [] },
    // 批次一新增（F01 / F14）：纯前端运行状态，不进 settings 表、不改任何 API/DB
    offline: false, configured: true, bootConfigured: false,
    // 批次二新增（F03 / F08 / F10 / F12 / F13 / F17 / F18 / F19）：同样全部只在浏览器内
    mainView: 'workbench', mobilePane: 'compose',
    filters: { model: '', provider: '', author: '', range: 'all' },
    groupBy: 'none', collapsedGroups: new Set(), groupHeaders: new Map(),
    assetCards: new Map(), assetQuery: '', assetSort: 'new',
    paramPresets: [], activePresetName: '',
    compare: { open: false, mode: 'grid', idx: 0, items: [] },
    cmd: { open: false, index: 0, items: [] },
    confirmResolve: null, overlayFocus: null, lastPick: null,
    atRefMapping: null, refPickerOpen: false,
    // 图片显示名别名：只存浏览器本地，不动文件名 / API / DB / output 存档
    imgNames: (() => { try { return JSON.parse(localStorage.getItem('iw_image_names') || '{}'); } catch (e) { return {}; } })(),
    nameRev: 0, renameTarget: '', ctxTarget: null, uiDefaults: {},
    imgTags: (() => { try { return JSON.parse(localStorage.getItem('iw_image_tags') || '{}'); } catch (e) { return {}; } })(),
    lbZoom: { scale: 1, x: 0, y: 0 },
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const fileUrl = (n) => '/api/files/' + encodeURIComponent(n) +
    (state.accessKey ? '?k=' + encodeURIComponent(state.accessKey) : '');
  const fmtTime = (ts) => { if (!ts) return ''; const d = new Date(ts * 1000); const p = (x) => String(x).padStart(2, '0'); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const dur = (a, b) => { const s = Math.max(0, Math.round((b || Date.now() / 1000) - (a || 0))); return s < 60 ? s + '秒' : Math.floor(s / 60) + '分' + (s % 60) + '秒'; };
  const isAdmin = () => !!(state.user && state.user.role === 'admin');
  const humanSize = (n) => n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

  let toastTimer;
  function toast(msg, type = '') {
    const el = $('#toast');
    el.textContent = msg; el.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast ' + type; }, 3200);
  }

  // ====================== 批次一：F01 亮 / 暗主题 ======================
  // 偏好存 localStorage['iw_theme']（与 iw_access_key / iw_fetched_models 同构），
  // 默认跟随 prefers-color-scheme；不进 settings 表、不新增任何 API/DB 字段。
  const THEME_KEY = 'iw_theme';

  function systemTheme() {
    try {
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'dark' : 'light';
    } catch (e) { return 'light'; }
  }
  function storedTheme() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return (v === 'dark' || v === 'light') ? v : '';
    } catch (e) { return ''; }
  }
  // 只切换 <html data-theme>，不重绘任何 DOM：当前表单内容与
  // state.pickedImages 勾选态全部保留（V4）。theme-color 与 --bg 同源。
  function applyTheme(theme) {
    const root = document.documentElement;
    root.dataset.theme = (theme === 'dark') ? 'dark' : 'light';
    try {
      const cs = getComputedStyle(root);
      const bg = (cs.getPropertyValue('--c-canvas') || '').trim();
      const meta = $('#metaThemeColor') || $('meta[name="theme-color"]');
      if (meta && bg) meta.setAttribute('content', bg);
    } catch (e) { /* 极端环境：保留 HTML 里的默认 theme-color，不影响功能 */ }
  }
  function toggleTheme() {
    const next = (document.documentElement.dataset.theme === 'dark') ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 隐私模式忽略 */ }
    applyTheme(next);
    toast(next === 'dark' ? '已切换到暗色主题' : '已切换到亮色主题');
  }
  function initTheme() {
    applyTheme(storedTheme() || systemTheme());
    const btn = $('#btnTheme');
    if (btn) btn.addEventListener('click', toggleTheme);
    // 未显式设置过偏好时跟随系统；用户点过开关后以 localStorage 为准
    try {
      const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
      if (mq) {
        const onChange = () => { if (!storedTheme()) applyTheme(systemTheme()); };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
      }
    } catch (e) { /* 忽略 */ }
  }

  // ============ 批次一：F14 统一空 / 加载 / 失败态（前端分流） ============
  function markOffline(msg) {
    state.offline = true;
    const banner = $('#connBanner');
    if (banner) {
      const txt = $('#connText');
      if (txt) txt.textContent = msg || '连接中断，正在自动重试…';
      banner.classList.remove('hidden');
    }
    // 主区仍有卡片时只显示降级条，不把空态盖在卡片上
    renderEmptyState(filtered().length ? 'none' : currentEmptyKind());
  }
  function markOnline() {
    if (!state.offline) return;
    state.offline = false;
    const banner = $('#connBanner');
    if (banner) banner.classList.add('hidden');
  }
  function currentEmptyKind() {
    if (state.offline) return 'offline';
    if (state.q) return 'search';
    if (state.filter !== 'all') return 'filter';
    if (!state.tasks.length && !state.configured && isAdmin()) return 'unconfigured';
    return 'no-tasks';
  }
  // 五类空态：未配置 API / 还没有任务 / 搜索无结果 / 筛选为空 / 服务断连
  function renderEmptyState(kind) {
    const box = $('#emptyState');
    if (!box) return;
    const copy = {
      offline: ['连接中断', '无法连接到服务，请确认服务正在运行；恢复后会自动继续轮询。'],
      unconfigured: ['还没配置生图接口', '请在「设置」里填入 API 地址与 Key，完成后即可开始生成。'],
      'no-tasks': ['还没有任务', '写下一句提示词，开始生成第一张图吧。'],
      search: ['没有匹配的任务', '换个关键词试试，或清空搜索框查看全部任务。'],
      filter: ['当前筛选下没有任务', '切换到「全部」可查看所有任务记录。'],
    };
    const c = copy[kind] || copy['no-tasks'];
    const title = $('#emptyTitle'), desc = $('#emptyDesc'), actions = $('#emptyActions');
    if (title) title.textContent = c[0];
    if (desc) desc.textContent = c[1];
    if (actions) actions.classList.toggle('hidden', kind !== 'offline');
    box.dataset.kind = kind;
    box.classList.toggle('hidden', kind === 'none');
  }

  // ==================== 批次一：F05 导出 CSV / Markdown ====================
  function csvCell(v) {
    let s = String(v ?? '');
    // 公式注入防护：以 = + - @ 制表符 / 回车开头的单元格前置单引号
    if (/^[=+\-@\t\r\n]/.test(s)) s = "'" + s;
    // 逗号 / 双引号 / 换行：按 RFC4180 包裹并转义双引号
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function mdCell(v) {
    return String(v ?? '').replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').replace(/`/g, "'");
  }
  function downloadText(filename, text, mime, bom) {
    const parts = (bom ? ['\ufeff'] : []).concat([text]);
    const blob = new Blob(parts, { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function exportStamp() {
    const d = new Date(), p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes());
  }
  // 按「当前筛选」导出：复用 filtered()，与画廊看到的列表完全一致
  function exportRows() {
    return filtered().map((t) => {
      const elapsed = t.finished_at
        ? dur(t.started_at || t.created_at, t.finished_at)
        : dur(t.created_at, serverNow());
      const params = (t.params && typeof t.params === 'object' && !Array.isArray(t.params))
        ? t.params : {};
      const fmt = String(t.output_format || '').toLowerCase();
      const mode = (fmt === 'gif' || fmt === 'svg') ? 'GIF/SVG'
        : (t.mode === 'i2i' ? '图生图' : '文生图');
      return {
        id: t.id || '',
        created: fmtTime(t.created_at),
        status: (STATUS[t.status] || ['未知'])[0],
        prompt: t.prompt || '',
        model: t.model || '',
        mode,
        provider: t.provider_name || '默认服务',
        size: t.size || '',
        quality: t.quality || '',
        n: String(t.n ?? 1),
        output_format: t.output_format || '',
        params: JSON.stringify(params),
        elapsed,
        error: t.error || '',
      };
    });
  }
  function doExport(kind) {
    const rows = exportRows();
    if (!rows.length) { toast('当前筛选下没有可导出的任务', 'error'); return; }
    const scope = state.filter === 'all' ? '全部'
      : ({ active: '进行中', succeeded: '已完成', failed: '失败' }[state.filter] || state.filter);
    const stamp = exportStamp();
    try {
      if (kind === 'csv') {
        const head = ['任务ID', '创建时间', '状态', '提示词', '模型', '模式', '服务商',
          '尺寸', '画质', '数量', '输出格式', '附加参数', '耗时', '错误信息'];
        const keys = ['id', 'created', 'status', 'prompt', 'model', 'mode', 'provider',
          'size', 'quality', 'n', 'output_format', 'params', 'elapsed', 'error'];
        const lines = [head.map(csvCell).join(',')];
        rows.forEach((r) => lines.push(keys.map((k) => csvCell(r[k])).join(',')));
        downloadText('绘台任务清单-' + stamp + '.csv', lines.join('\r\n'),
          'text/csv;charset=utf-8', true);
      } else {
        const head = ['创建时间', '状态', '提示词', '模型', '模式', '服务商', '尺寸',
          '画质', '数量', '输出格式', '附加参数', '耗时', '错误信息'];
        const keys = ['created', 'status', 'prompt', 'model', 'mode', 'provider', 'size',
          'quality', 'n', 'output_format', 'params', 'elapsed', 'error'];
        const lines = [
          '# 绘台 · 任务清单',
          '',
          '导出时间：' + new Date().toLocaleString('zh-CN') +
            '　筛选：' + scope + (state.q ? '　搜索：' + state.q : '') + '　共 ' + rows.length + ' 条',
          '',
          '| ' + head.join(' | ') + ' |',
          '| ' + head.map(() => '---').join(' | ') + ' |',
        ];
        rows.forEach((r) => lines.push('| ' + keys.map((k) => mdCell(r[k])).join(' | ') + ' |'));
        downloadText('绘台任务清单-' + stamp + '.md', lines.join('\n'),
          'text/markdown;charset=utf-8', false);
      }
      toast('已导出 ' + rows.length + ' 条任务（' + (kind === 'csv' ? 'CSV' : 'Markdown') + '）');
    } catch (e) { toast('导出失败：' + e.message, 'error'); }
  }

  // ==================== 批次一：F11 失败排查面板 ====================
  // 启发式归类，数据全部来自 t.error / t.request_json / t.params，不新增 API。
  function classifyError(t) {
    const e = String(t.error || '').toLowerCase();
    const want = String(t.output_format || '').toLowerCase();
    if (/401|unauthorized|invalid[_ -]?api[_ -]?key|api[_ -]?key|authentication|access_key|403|forbidden|permission denied|鉴权|密钥|未授权|令牌/.test(e)) {
      return { key: 'auth', label: '鉴权失败',
        advice: '检查「设置 → 图片模型设置」里的 API Key 是否正确、是否过期；若使用中转服务，确认网关 Key 与 API 地址匹配。访问密码开启后还要确保本机已解锁。' };
    }
    if (/400|bad request|invalid (param|parameter|field|value)|unsupported (param|parameter|field)|unknown (param|parameter|field)|missing (param|parameter|field)|schema|must be|参数错误|字段|不合法/.test(e)) {
      return { key: 'param', label: '参数错误',
        advice: '多半是请求体里有网关不认识的字段。请点下方「查看最终请求 JSON」核对，再回到面板调整比例 / 画质 / 附加参数，或清空「附加参数 JSON」后重试。' };
    }
    if (/timeout|timed out|超时|504|gateway time-?out|deadline exceeded|etimedout|econnaborted/.test(e)) {
      return { key: 'timeout', label: '请求超时',
        advice: '调高「设置 → 超时（秒）」，或降低分辨率 / 张数 / GIF 帧数后重试；也可稍后再试，避开上游高峰。' };
    }
    if (/429|rate limit|too many requests|500|502|503|bad gateway|upstream|econnrefused|econnreset|network|socket|网关|上游|频繁|连接失败/.test(e)) {
      return { key: 'gateway', label: '网关 / 上游错误',
        advice: '上游服务暂时不可用或限流。先点「用相同参数重试」；若持续失败，用「测试图片接口」确认连通性，或切换到另一组图片服务。' };
    }
    if ((want === 'gif' || want === 'svg') && /static png|返回.*png|fallback|降级|not support|不支持|svg generation requires|output_format/.test(e)) {
      return { key: 'format', label: '格式降级',
        advice: '接口忽略了 output_format 或帧参数，返回了静态位图。确认网关完整透传请求体（不要做参数白名单），并换用支持 GIF / SVG 的模型。' };
    }
    return { key: 'other', label: '其他错误',
      advice: '先复制原始错误到上游文档比对；再点「查看最终请求 JSON」核对最终请求体，必要时用「用相同参数重试」。' };
  }
  function finalRequestView(t) {
    const rj = (t.request_json && typeof t.request_json === 'object' && !Array.isArray(t.request_json))
      ? t.request_json : {};
    const pm = (t.params && typeof t.params === 'object' && !Array.isArray(t.params)) ? t.params : {};
    return {
      最终请求体: rj,
      面板附加参数: pm,
      任务信息: {
        id: t.id || '', mode: t.mode || '', model: t.model || '', size: t.size || '',
        quality: t.quality || '', n: t.n ?? 1, output_format: t.output_format || '',
        provider_name: t.provider_name || '', status: t.status || '', attempts: t.attempts ?? 0,
      },
      原始错误: t.error || '',
    };
  }
  // F09 / F14：骨架按任务的真实出图比例占位（解析 t.size 或 fmt 的 aspect_ratio）
  function skeletonRatio(t) {
    const raw = String(t.size || '');
    const m = /^(\d+)x(\d+)$/i.exec(raw);
    if (m && Number(m[1]) > 0 && Number(m[2]) > 0) return Number(m[1]) + ' / ' + Number(m[2]);
    const rj = (t.request_json && typeof t.request_json === 'object') ? t.request_json : {};
    const ar = String(rj.aspect_ratio || '');
    const am = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(ar);
    if (am && Number(am[1]) > 0 && Number(am[2]) > 0) return Number(am[1]) + ' / ' + Number(am[2]);
    if (RATIO_WH[ar]) return RATIO_WH[ar][0] + ' / ' + RATIO_WH[ar][1];
    return '1 / 1';
  }

  // 主题开关 / 断连重试 / 导出菜单 / 空态重试：静态节点，全局绑定一次，
  // 登录前后都可用（不放进只有登录后执行的 bindEvents()）。
  function bindGlobalEvents() {
    const emptyRetry = $('#btnEmptyRetry');
    if (emptyRetry) emptyRetry.addEventListener('click', () => { toast('正在重试连接…'); tick(); });
    const connRetry = $('#btnConnRetry');
    if (connRetry) connRetry.addEventListener('click', () => { toast('正在重试连接…'); tick(); });
    const btn = $('#btnExport'), menu = $('#exportMenu');
    if (btn && menu) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('hidden');
        const open = !menu.classList.contains('hidden');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      $$('#exportMenu [data-export]').forEach((b) => b.addEventListener('click', () => {
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        doExport(b.dataset.export);
      }));
      document.addEventListener('click', (e) => {
        if (!menu.classList.contains('hidden') && !$('#exportWrap').contains(e.target)) {
          menu.classList.add('hidden');
          btn.setAttribute('aria-expanded', 'false');
        }
      });
    }
    // 批次二：全部新增静态节点的事件只在这里绑一次（登录前后都可用）
    bindBatch2Events();
  }

  async function api(path, opts = {}) {
    const headers = new Headers(opts.headers || {});
    if (state.accessKey) headers.set('X-Access-Key', state.accessKey);
    let res;
    try { res = await fetch(path, { ...opts, headers, credentials: 'same-origin' }); }
    catch (e) { throw new Error('无法连接服务，请确认服务正在运行'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      const detail = data.detail || '';
      if (detail.startsWith('ACCESS_KEY_')) showLock();
      else if (detail === 'LOGIN_REQUIRED') showLogin(false);
      throw new Error(detail === 'LOGIN_REQUIRED' ? '登录已过期，请重新登录' : '访问密码不正确');
    }
    if (!res.ok) throw new Error(data.detail || ('HTTP ' + res.status));
    return data;
  }

  // ------------------------------ 启动 / 身份 ------------------------------
  async function boot() {
    let b;
    try {
      const res = await fetch('/api/bootstrap', {
        headers: state.accessKey ? { 'X-Access-Key': state.accessKey } : {},
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        const d = await res.json().catch(() => ({}));
        if ((d.detail || '').startsWith('ACCESS_KEY_')) { showLock(); return; }
      }
      b = await res.json();
    } catch (e) { setStatus('bad', '服务未连接'); markOffline('服务未连接，请确认服务正在运行'); return; }
    // 版本号由服务端下发，网页与压缩包文件名永远一致
    const verEl = $('#appVersion');
    if (verEl) verEl.textContent = b.version ? 'v' + b.version : '';
    state.providers = b.providers || [];
    state.presets = b.presets || [];
    state.settings = b.settings || {};
    parseUiDefaults(state.settings);
    if (!b.initialized) { showLogin(true); return; }
    if (!b.user) { showLogin(false); return; }
    state.user = b.user;
    initUI(b);
  }

  function setStatus(kind, text) {
    const el = $('#statusPill');
    el.className = 'status-pill ' + kind;
    $('span', el).textContent = text;
  }

  function initUI(b) {
    state.configured = !!b.configured;
    $('#userChip').classList.remove('hidden');
    $('#userName').textContent = state.user.username + (isAdmin() ? ' · 管理员' : '');
    $('#btnSettings').classList.toggle('hidden', !isAdmin());
    $('#btnUsage').classList.toggle('hidden', !isAdmin());
    $('#configBanner').classList.toggle('hidden', !(isAdmin() && !b.configured));
    state.bootConfigured = !!b.configured;
    migrateLegacyImgNames();

    fillRatios();
    fillProviders();
    renderChips();
    // 首次打开即套用保存的默认参数（切模式 / 提交成功后由 resetForm 再套用）
    applyDefaults('t2i', defaultsFor('t2i'));
    applyDefaults('fmt', defaultsFor('fmt'));
    bindEvents();
    onParamChange();
    Promise.all([loadSettings(), loadProviders(), loadPresets(), loadTasks()])
      .then(() => api('/api/stats'))
      .then((st) => { state.stats = st; renderCounters(st); })
      .catch((e) => { setStatus('bad', '连接异常'); toast(e.message, 'error'); });
    schedule(2500);
    setInterval(updateElapsed, 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  }

  function showLogin(setup) {
    state.setupMode = !!setup;
    $('#loginTitle').textContent = setup ? '创建管理员账号' : '登录绘台';
    $('#loginDesc').textContent = setup
      ? '首次使用，请创建管理员账号。之后可在「用户管理」里添加普通用户。'
      : '请输入账号密码，任务与图片按账号隔离。';
    $('#loginPass2').classList.toggle('hidden', !setup);
    $('#btnLogin').textContent = setup ? '创建并进入' : '进入工作台';
    $('#loginError').textContent = '';
    $('#loginOverlay').classList.remove('hidden');
    setTimeout(() => $('#loginName').focus(), 100);
  }

  async function doLogin() {
    const name = $('#loginName').value.trim(), pass = $('#loginPass').value;
    if (!name || !pass) { $('#loginError').textContent = '请填写用户名和密码'; return; }
    if (state.setupMode && pass !== $('#loginPass2').value) {
      $('#loginError').textContent = '两次输入的密码不一致'; return;
    }
    const btn = $('#btnLogin'); btn.disabled = true;
    try {
      const res = await fetch(state.setupMode ? '/api/setup' : '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
          ...(state.accessKey ? { 'X-Access-Key': state.accessKey } : {}) },
        body: JSON.stringify({ username: name, password: pass }),
        credentials: 'same-origin',
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { $('#loginError').textContent = d.detail || '操作失败'; return; }
      location.reload();
    } catch (e) { $('#loginError').textContent = '连接失败'; }
    finally { btn.disabled = false; }
  }

  function showLock() {
    $('#lockOverlay').classList.remove('hidden');
    $('#lockError').textContent = '';
    setTimeout(() => $('#lockKey').focus(), 100);
  }
  async function unlock() {
    const key = $('#lockKey').value;
    if (!key) { $('#lockError').textContent = '请输入密码'; return; }
    try {
      const r = await fetch('/api/auth/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      }).then((x) => x.json());
      if (!r.ok) { $('#lockError').textContent = '密码不正确，请重试'; return; }
      state.accessKey = key; localStorage.setItem('iw_access_key', key);
      location.reload();
    } catch (e) { $('#lockError').textContent = '连接失败'; }
  }

  // ------------------------------ 数据加载 ------------------------------
  async function loadSettings() {
    const s = await api('/api/settings');
    state.settings = s;
    parseUiDefaults(s);
    syncConfigured();
    refreshModelList();
    fillSvgModelOptions();
    renderDefaultModelCards();
    return s;
  }
  async function loadProviders() {
    const r = await api('/api/providers');
    state.providers = r.items || [];
    fillProviders();
  }
  async function loadPresets() {
    const r = await api('/api/presets');
    state.presets = r.items || [];
    renderChips();
  }
  async function loadTasks() {
    const r = await api('/api/tasks?limit=100&q=' + encodeURIComponent(state.q));
    state.tasks = r.items || [];
    state.serverTime = r.server_time || Date.now() / 1000;
    state.clockOffset = state.serverTime - Date.now() / 1000;
    renderTasks();
    renderHistorySelect();
  }
  async function tick() {
    try {
      const [r, st] = await Promise.all([
        api('/api/tasks?limit=100&q=' + encodeURIComponent(state.q)), api('/api/stats'),
      ]);
      state.tasks = r.items || [];
      state.serverTime = r.server_time || Date.now() / 1000;
      state.clockOffset = state.serverTime - Date.now() / 1000;
      state.stats = st;
      markOnline();
      renderTasks(); renderHistorySelect(); renderCounters(st);
      if (state.mainView === 'assets') renderAssets();   // 资产库也要跟着任务数据实时刷新（删除/改名后不用切换视图）
    } catch (e) {
      setStatus('bad', '连接中断');
      markOffline('连接中断，无法获取最新任务；恢复后会自动继续轮询');
    }
  }
  function schedule(ms) {
    clearTimeout(state.timer);
    state.timer = setTimeout(async () => { await tick(); schedule(document.hidden ? 8000 : 2500); }, ms);
  }

  // 与服务器时间对齐的本地时钟：运行 / 排队任务按秒刷新「已用」时长。
  // 只改这一小段文本，不整卡重绘（避免打断图片预览、按钮与滚动位置）。
  function serverNow() { return Date.now() / 1000 + (state.clockOffset || 0); }
  function updateElapsed() {
    const now = serverNow();
    $$('#taskList .card-elapsed').forEach((el) => {
      const st = Number(el.dataset.start) || 0;
      if (st) el.textContent = dur(st, now);
    });
  }
  function renderCounters(st) {
    if (st.pending || st.running) setStatus('busy', `队列 ${st.pending} · 生成中 ${st.running}`);
    else if (!st.configured) setStatus('bad', '待配置接口');
    else setStatus('ok', '服务就绪');
    $('#queueInfo').textContent = `共 ${st.total || 0} 个任务 · 排队 ${st.pending || 0} · 生成中 ${st.running || 0}`;
    renderQueueViz(st);   // F20：普通用户也可见的队列概览（数据只来自 /api/stats）
  }

  // ------------------------------ 通用自定义下拉 ------------------------------
  // 原生 <select> 在手机上会弹系统选择器，样式与模型下拉不一致、也不能搜索。
  // 这里保留原生 select 作为「数据载体」（现有 sel.value / sel.innerHTML / options
  // 的写法全部不用改），在外层挂一个自定义浮层：搜索、↑↓、回车、Esc、点选。
  const SEL_REFS = [];
  let selOpen = null;

  function selOptions(sel) {
    return Array.from(sel.options).map((o) => ({
      v: o.value, label: (o.textContent || '').trim(), disabled: !!o.disabled,
    }));
  }

  function bindSelects() {
    const ids = [
      'provider', 'historySelect', 'llmProvider', 'ratio', 'resolution', 'quality',
      'reasoning', 'count', 'format', 'background',
      'fRatio', 'fResolution', 'fQuality', 'fComplexity', 'gifFrameSize', 'svgEffort',
      'sI2iMode', 'sEditField', 'sConcurrency', 'sAutoRetry', 'nuRole',
    ];
    ids.forEach((id) => { const el = document.getElementById(id); if (el) enhanceSelect(el); });
    // 滚动 / 视口变化只重新定位，绝不关闭：手机上点开下拉会唤起软键盘，
    // 紧接着的 resize + scroll 曾把刚打开的菜单直接关掉（表现为「一闪就没」）。
    // 菜单是 fixed 定位并跟随 trigger，重新 place() 就能一直贴着，不需要关。
    const reflow = () => { if (selOpen && selOpen.place) selOpen.place(); };
    // scroll / click 的 target 可能是 window、document 等非元素对象，
    // 直接调 contains() 会抛 TypeError，先做节点类型判断。
    const isInside = (root, t) => !!(root && t && t.nodeType && root.contains(t));
    window.addEventListener('scroll', (e) => {
      if (!selOpen || isInside(selOpen.menu, e.target)) return;   // 菜单内部滚动不动
      reflow();
    }, true);
    window.addEventListener('resize', reflow);
    // 外部点击关闭：label 也算「内部」——点字段名展开时 label 的 click 会冒泡到这里，
    // 不排除就会刚 open 就被 close，这是另一种「闪退」。
    document.addEventListener('click', (e) => {
      if (!selOpen) return;
      const t = e.target;
      if (isInside(selOpen.wrap, t) || isInside(selOpen.menu, t) || isInside(selOpen.label, t)) return;
      // 不再做「打开后 350ms 内忽略所有外部点击」：那会让用户点开下拉后
      // 立刻点别处关不掉，得再点一次。label 的冒泡已由上面的 isInside 解决，
      // 触屏补发的 click 目标通常仍是 trigger/label（同属内部），无需全局屏蔽。
      closeSel(selOpen);
    });
  }

  function enhanceSelect(sel) {
    if (!sel || sel.dataset.selEnhanced) return;
    sel.dataset.selEnhanced = '1';

    const wrap = document.createElement('div');
    wrap.className = 'sel-wrap';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('sel-native');
    sel.setAttribute('tabindex', '-1');
    sel.setAttribute('aria-hidden', 'true');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'sel-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = '<span class="sel-text"></span>' +
      '<svg class="sel-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    wrap.appendChild(trigger);

    const menu = document.createElement('div');
    menu.className = 'sel-menu hidden';
    menu.setAttribute('role', 'listbox');
    menu.innerHTML = '<div class="sel-search-wrap"><input class="sel-search" type="text" ' +
      'placeholder="输入关键词搜索…" spellcheck="false" autocomplete="off"></div>' +
      '<div class="sel-options"></div>';
    document.body.appendChild(menu);   // fixed 定位，避免被 overflow 容器裁剪

    const ref = {
      sel, wrap, trigger, menu,
      text: $('.sel-text', trigger), search: $('.sel-search', menu),
      searchWrap: $('.sel-search-wrap', menu), optsBox: $('.sel-options', menu),
      items: [], filtered: [], index: 0, open: false,
    };
    SEL_REFS.push(ref);

    function syncText() {
      const o = sel.selectedOptions && sel.selectedOptions[0];
      ref.text.textContent = o ? (o.textContent || '').trim() : '请选择';
    }

    function render(query) {
      const q = String(query || '').trim().toLowerCase();
      const all = selOptions(sel);
      ref.items = all;
      ref.filtered = q ? all.filter((x) => (x.label + ' ' + x.v).toLowerCase().includes(q)) : all;
      if (ref.index >= ref.filtered.length) ref.index = 0;
      const cur = sel.value;
      ref.optsBox.innerHTML = ref.filtered.length
        ? ref.filtered.map((x, i) =>
            `<div class="sel-opt${i === ref.index ? ' active' : ''}${x.v === cur ? ' chosen' : ''}${x.disabled ? ' disabled' : ''}" ` +
            `data-i="${i}" role="option" title="${esc(x.label)}">` +
            `<span class="so-label">${esc(x.label)}</span>${x.v === cur ? '<span class="so-check">✓ 当前</span>' : ''}</div>`).join('')
        : '<div class="sel-empty">没有匹配的选项</div>';
      $$('.sel-opt', ref.optsBox).forEach((el) => {
        const pick = (e) => {
          e.preventDefault();
          const x = ref.filtered[Number(el.dataset.i)];
          if (x && !x.disabled) choose(x.v);
        };
        el.addEventListener('mousedown', pick);
        el.addEventListener('click', pick);
      });
    }

    function place() {
      const r = trigger.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const want = Math.min(380, Math.max(150, ref.items.length * 38 + 92));
      const below = vh - r.bottom - 12, above = r.top - 12;
      const up = below < Math.min(want, 160) && above > below;
      const avail = Math.max(90, Math.min(want, up ? above : below));
      menu.style.left = Math.max(8, Math.min(r.left, vw - 200)) + 'px';
      menu.style.width = Math.max(Math.min(r.width, vw - 16), 180) + 'px';
      menu.style.maxHeight = avail + 'px';
      if (up) { menu.style.top = 'auto'; menu.style.bottom = (vh - r.top + 6) + 'px'; }
      else { menu.style.bottom = 'auto'; menu.style.top = (r.bottom + 6) + 'px'; }
    }

    function handleKey(e) {
      if (!ref.open) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter' || e.key === 'Tab') {
        const x = ref.filtered[ref.index];
        if (x && !x.disabled) { e.preventDefault(); choose(x.v); }
        else if (e.key === 'Enter') { e.preventDefault(); close(); }
      } else if (e.key === 'Escape') {
        e.preventDefault(); close(); trigger.focus({ preventScroll: true });
      }
    }

    function move(delta) {
      const n = ref.filtered.length;
      if (!n) return;
      ref.index = (ref.index + delta + n) % n;
      render(ref.search.value);
      const el = $(`.sel-opt[data-i="${ref.index}"]`, ref.optsBox);
      if (el) el.scrollIntoView({ block: 'nearest' });
    }

    function open(initial) {
      if (selOpen && selOpen !== ref) closeSel(selOpen);
      ref.open = true; selOpen = ref;
      wrap.classList.add('open'); menu.classList.remove('hidden');
      trigger.setAttribute('aria-expanded', 'true');
      const all = selOptions(sel);
      ref.searchWrap.classList.toggle('hidden', all.length < 6);  // 短列表不弹手机软键盘
      ref.search.value = initial || '';
      render(ref.search.value);
      const curIdx = ref.filtered.findIndex((x) => x.v === sel.value);
      ref.index = curIdx >= 0 ? curIdx : 0;
      render(ref.search.value);
      place();
      if (all.length >= 6) ref.search.focus({ preventScroll: true });
      else trigger.focus({ preventScroll: true });
    }

    function close() {
      ref.open = false; if (selOpen === ref) selOpen = null;
      wrap.classList.remove('open'); menu.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
    }
    ref.close = close;

    function choose(v) {
      const changed = sel.value !== v;
      if (changed) {
        sel.value = v;                       // 触发下面的 value 补丁，自动同步显示
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      close(); syncText();
      trigger.focus({ preventScroll: true });
    }

    ref.place = place;
    trigger.addEventListener('click', () => { if (ref.open) close(); else open(''); });
    trigger.addEventListener('keydown', (e) => {
      if (!ref.open) {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(''); }
        return;
      }
      handleKey(e);
    });
    ref.search.addEventListener('input', () => {
      const q = ref.search.value;
      ref.index = 0;
      render(q);
      // 清空搜索后回到当前选中项，按 ↓ 才是「当前值的下一项」
      if (!q.trim()) {
        const i = ref.filtered.findIndex((x) => x.v === sel.value);
        if (i >= 0) { ref.index = i; render(q); }
      }
      place();
    });
    // 只绑在搜索框 / 触发按钮上；再绑到 menu 会因冒泡让 ↑↓ 被处理两次
    ref.search.addEventListener('keydown', handleKey);

    // 让现有 `sel.value = x` 写法自动同步自定义显示文本
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    try {
      Object.defineProperty(sel, 'value', {
        configurable: true,
        get() { return desc.get.call(this); },
        set(v) { desc.set.call(this, v); syncText(); },
      });
    } catch (_) { /* 极端环境下降级为打开时同步 */ }
    // innerHTML / options 动态替换时同步（fillRatios / fillProviders / renderHistorySelect）
    new MutationObserver(syncText).observe(sel, { childList: true, subtree: true });
    // 点标签也展开自定义菜单，并移除 for 以免移动端触发系统原生选择器
    if (sel.id) {
      const lab = document.querySelector(`label[for="${sel.id}"]`);
      if (lab) {
        ref.label = lab;   // 让 document 的外部点击判断把它当「内部」
        lab.removeAttribute('for');
        lab.style.cursor = 'pointer';
        lab.addEventListener('click', (e) => {
          if (e.target.closest('button, a, input, textarea')) return;
          e.preventDefault();
          if (ref.open) close(); else open('');
        });
      }
    }
    syncText();
  }

  function closeSel(ref) { if (ref && ref.close) ref.close(); }

  // ------------------------------ 服务商 / 模型 / 比例 ------------------------------
  function fillRatios() {
    $('#ratio').innerHTML = RATIOS.map(([k]) =>
      `<option value="${k}"${k === DEFAULT_PARAMS.ratio ? ' selected' : ''}>${k}</option>`).join('') +
      '<option value="custom">自定义 x:x …</option>';
    $('#fRatio').innerHTML = RATIOS.map(([k]) =>
      `<option value="${k}"${k === FMT_DEFAULTS.ratio ? ' selected' : ''}>${k}${k === '1:1' ? '（接口默认）' : ''}</option>`).join('');
    // 首屏统一套用默认参数：浏览器可能自动恢复上次表单值，这里强制覆盖
    $('#ratio').value = DEFAULT_PARAMS.ratio;
    $('#resolution').value = DEFAULT_PARAMS.resolution;
    $('#quality').value = DEFAULT_PARAMS.quality;
    $('#reasoning').value = DEFAULT_PARAMS.reasoning;
    $('#count').value = DEFAULT_PARAMS.count;
    $('#format').value = DEFAULT_PARAMS.format;
  }

  function imageProviders() { return state.providers.filter((p) => p.kind === 'image'); }
  function llmProviders() { return state.providers.filter((p) => p.kind === 'llm'); }

  function fillProviders() {
    const pSel = $('#provider'), lSel = $('#llmProvider');
    const curP = pSel.value, curL = lSel.value;
    const img = imageProviders(), llms = llmProviders();
    const defImg = img.find((p) => p.is_default), defLlm = llms.find((p) => p.is_default);
    pSel.innerHTML = '<option value="__default__">默认服务（系统设置）</option>' +
      img.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    lSel.innerHTML = '<option value="__default__">默认语言模型</option>' +
      llms.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    pSel.value = (curP && (curP === '__default__' || img.some((p) => p.id === curP))) ? curP
      : (defImg ? defImg.id : '__default__');
    lSel.value = (curL && (curL === '__default__' || llms.some((p) => p.id === curL))) ? curL
      : (defLlm ? defLlm.id : '__default__');
    refreshModelList();
    fillSvgModelOptions();
    renderDefaultModelCards();
  }

  // svg.model 的下拉候选：系统默认语言模型 + 「设置 → 语言模型」里已添加的每一个语言服务。
  // 用 datalist 而非 select，保留手填任意模型名的能力（网关常要求特定模型 ID）。
  function fillSvgModelOptions() {
    const dl = $('#svgModelList'); if (!dl) return;
    const cur = String($('#svgModel')?.value || '').trim();
    const seen = new Set(), opts = [];
    const add = (v, label) => {
      const s = String(v || '').trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      opts.push(`<option value="${esc(s)}">${esc(label || '')}</option>`);
    };
    add(state.settings.llm_model, '系统默认语言模型');
    llmProviders().forEach((p) => add((p.config || {}).model, p.name));
    add(cur, '当前填写值');
    dl.innerHTML = opts.join('');
  }

  function activeImageCfg() {
    const pid = $('#provider').value;
    if (pid && pid !== '__default__') {
      const p = imageProviders().find((x) => x.id === pid);
      if (p) return p.config;
    }
    return state.settings;
  }
  function modelCacheKey() { return $('#provider')?.value || '__default__'; }
  function modelsOfCurrent() {
    const c = activeImageCfg();
    return String(c.models || '').split(',').map((x) => x.trim()).filter(Boolean);
  }
  function modelOptions() {
    // 配置里的手填列表 + 本服务曾拉取到的模型（按服务商分别缓存）
    const extra = state.fetchedModels[modelCacheKey()] || [];
    return Array.from(new Set([...modelsOfCurrent(), ...extra])).filter(Boolean);
  }
  function persistModelCache() {
    try { localStorage.setItem('iw_fetched_models', JSON.stringify(state.fetchedModels)); }
    catch (e) { /* 隐私模式下 localStorage 不可用，忽略 */ }
  }
  function defaultModel() { return modelOptions()[0] || 'gpt-image-2.6-sunburst'; }
  function refreshModelList() {
    const list = modelOptions();
    if (!$('#model').value.trim() && list.length) $('#model').value = list[0];
    if (state.modelMenu.open) renderModelMenu();
  }

  // ------------------------------ 模型下拉：搜索 + 键盘上下选择 ------------------------------
  function comboQuery() {
    const v = $('#model').value.trim();
    // 输入框里已是某个完整模型名时视为「已选中」，打开菜单展示全部
    if (v && modelOptions().some((m) => m === v)) return '';
    return v.toLowerCase();
  }
  function menuHits() {
    const q = comboQuery(), all = modelOptions();
    return q ? all.filter((m) => m.toLowerCase().includes(q)) : all;
  }
  function renderModelMenu() {
    const hits = menuHits();
    const list = hits.slice(0, 200);
    state.modelMenu.filtered = list;
    if (state.modelMenu.index >= list.length) state.modelMenu.index = list.length ? 0 : -1;
    const cur = $('#model').value.trim(), menu = $('#modelMenu');
    if (!list.length) {
      menu.innerHTML = '<div class="combo-empty">没有匹配的模型' +
        (cur ? '，可直接手填「' + esc(cur) + '」' : '，点「拉取模型」从接口获取') + '</div>';
    } else {
      menu.innerHTML = list.map((m, i) =>
        `<div class="combo-item${i === state.modelMenu.index ? ' active' : ''}${m === cur ? ' chosen' : ''}"
              data-i="${i}" data-v="${esc(m)}" role="option" aria-selected="${m === cur}">
           <span class="ci-name">${esc(m)}</span>${m === cur ? '<span class="ci-check">✓ 当前</span>' : ''}
         </div>`).join('') +
        (hits.length > list.length
          ? `<div class="combo-foot">还有 ${hits.length - list.length} 个未显示，继续输入关键词可缩小范围</div>` : '');
    }
    $('#model').setAttribute('aria-expanded', 'true');
  }
  function openModelMenu(selectText) {
    state.modelMenu.open = true;
    $('#modelMenu').classList.remove('hidden');
    const list = menuHits().slice(0, 200), cur = $('#model').value.trim();
    state.modelMenu.index = cur ? list.indexOf(cur) : (list.length ? 0 : -1);
    if (state.modelMenu.index < 0 && list.length) state.modelMenu.index = 0;
    renderModelMenu();
    if (selectText) $('#model').select();
    highlightActive(true);
  }
  function closeModelMenu() {
    state.modelMenu.open = false;
    $('#modelMenu').classList.add('hidden');
    $('#model').setAttribute('aria-expanded', 'false');
  }
  function highlightActive(scroll) {
    const menu = $('#modelMenu');
    $$('.combo-item', menu).forEach((el) =>
      el.classList.toggle('active', Number(el.dataset.i) === state.modelMenu.index));
    if (scroll && state.modelMenu.index >= 0) {
      const el = $(`.combo-item[data-i="${state.modelMenu.index}"]`, menu);
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }
  function moveModelIndex(delta) {
    const n = state.modelMenu.filtered.length;
    if (!n) return;
    state.modelMenu.index = state.modelMenu.index < 0
      ? (delta > 0 ? 0 : n - 1)
      : (state.modelMenu.index + delta + n) % n;
    highlightActive(true);
  }
  function chooseModel(v) {
    $('#model').value = v;
    closeModelMenu();
    onParamChange();
  }
  function bindModelCombo() {
    const input = $('#model'), menu = $('#modelMenu');
    input.addEventListener('focus', () => openModelMenu(true));
    input.addEventListener('click', () => { if (!state.modelMenu.open) openModelMenu(false); });
    input.addEventListener('input', () => {
      if (!state.modelMenu.open) { state.modelMenu.open = true; menu.classList.remove('hidden'); }
      state.modelMenu.index = 0;
      renderModelMenu();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!state.modelMenu.open) openModelMenu(false); moveModelIndex(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (!state.modelMenu.open) openModelMenu(false); moveModelIndex(-1); }
      else if (e.key === 'Enter') {
        if (state.modelMenu.open && state.modelMenu.index >= 0 &&
            state.modelMenu.filtered[state.modelMenu.index]) {
          e.preventDefault(); e.stopPropagation();
          chooseModel(state.modelMenu.filtered[state.modelMenu.index]);
        }
      } else if (e.key === 'Escape') { if (state.modelMenu.open) { e.preventDefault(); closeModelMenu(); } }
      else if (e.key === 'Tab') { closeModelMenu(); }
    });
    menu.addEventListener('mousedown', (e) => {
      const it = e.target.closest('.combo-item');
      if (it) { e.preventDefault(); chooseModel(it.dataset.v); }
    });
    document.addEventListener('click', (e) => {
      if (state.modelMenu.open && !$('#modelCombo').contains(e.target)) closeModelMenu();
    });
  }

  // ------------------------------ 从接口拉取模型 ------------------------------
  async function fetchModelsForPanel() {
    const btn = $('#btnFetchModels');
    btn.disabled = true; btn.textContent = '拉取中…';
    try {
      const r = await api('/api/models/fetch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_id: $('#provider').value, kind: 'image', save: true }),
      });
      if (!r.ok) { toast(r.message || '拉取失败', 'error'); return; }
      const key = modelCacheKey();
      state.fetchedModels[key] = Array.from(new Set([
        ...(state.fetchedModels[key] || []), ...r.models,
      ]));
      persistModelCache();
      await Promise.all([loadSettings(), loadProviders()]);
      const info = $('#modelFetchInfo');
      info.textContent = `已从 ${r.url} 拉取 ${r.count} 个模型并保存到服务配置，可在上方搜索选择。`;
      info.classList.remove('hidden');
      toast(r.message);
      $('#model').focus();
      openModelMenu(true);
    } catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '↻ 拉取模型'; }
  }
  async function fetchModelsInto(opts) {
    const btn = opts.btn;
    if (btn) { btn.disabled = true; btn.dataset.oldText = btn.textContent; btn.textContent = '拉取中…'; }
    try {
      const body = { provider_id: opts.providerId || '', kind: opts.kind || 'image', save: false };
      if (opts.baseEl && opts.baseEl.value.trim()) body.api_base = opts.baseEl.value.trim();
      if (opts.keyEl && opts.keyEl.value.trim()) body.api_key = opts.keyEl.value.trim();
      const r = await api('/api/models/fetch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) { toast(r.message || '拉取失败', 'error'); return; }
      openModelPicker(r.models, opts.target, !!opts.single);
    } catch (e) { toast(e.message, 'error'); }
    finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.oldText || '↻ 拉取'; }
    }
  }

  // ------------------------------ 模型选择弹层：搜索 + 键盘上下选择 ------------------------------
  function openModelPicker(models, target, single) {
    if (!target) return;
    state.picker = { items: models.slice(), filtered: [], selected: new Set(),
                     index: 0, target, single: !!single };
    $('#mpCount').textContent = `（共 ${models.length} 个）`;
    $('#mpSearch').value = '';
    $('#mpAll').classList.toggle('hidden', state.picker.single);
    $('#mpNone').classList.toggle('hidden', state.picker.single);
    $('#mpConfirm').classList.toggle('hidden', state.picker.single);
    $('#modelPickerOverlay').classList.remove('hidden');
    renderModelPicker();
    setTimeout(() => $('#mpSearch').focus(), 60);
  }
  function closeModelPicker() { $('#modelPickerOverlay').classList.add('hidden'); }
  function renderModelPicker() {
    const p = state.picker, q = $('#mpSearch').value.trim().toLowerCase();
    p.filtered = (q ? p.items.filter((m) => m.toLowerCase().includes(q)) : p.items.slice()).slice(0, 500);
    if (p.index >= p.filtered.length) p.index = p.filtered.length ? 0 : -1;
    $('#mpList').innerHTML = p.filtered.length ? p.filtered.map((m, i) =>
      `<div class="mp-item${i === p.index ? ' active' : ''}${p.selected.has(m) ? ' picked' : ''}"
            data-i="${i}" data-v="${esc(m)}">
         <span class="mp-box">${p.selected.has(m) ? '✓' : ''}</span>
         <span class="mp-name">${esc(m)}</span>
         <span class="mp-tag">${p.selected.has(m) ? '已勾选' : ''}</span>
       </div>`).join('') : '<p class="tip">没有匹配的模型，换个关键词试试。</p>';
    $('#mpSelInfo').textContent = p.single ? '' : `已勾选 ${p.selected.size} 个`;
  }
  function mpMove(delta) {
    const p = state.picker, n = p.filtered.length;
    if (!n) return;
    p.index = p.index < 0 ? (delta > 0 ? 0 : n - 1) : (p.index + delta + n) % n;
    renderModelPicker();
    const el = $(`.mp-item[data-i="${p.index}"]`, $('#mpList'));
    if (el) el.scrollIntoView({ block: 'nearest' });
  }
  function mpToggle(i) {
    const p = state.picker, m = p.filtered[i];
    if (!m) return;
    if (p.single) { applyModelPicker([m]); return; }
    if (p.selected.has(m)) p.selected.delete(m); else p.selected.add(m);
    renderModelPicker();
  }
  function applyModelPicker(list) {
    const p = state.picker, t = p.target;
    if (!t) return;
    let added = 0;
    if (p.single) {
      t.value = list[0] || t.value;
    } else {
      const cur = String(t.value || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
      list.forEach((m) => { if (!cur.includes(m)) { cur.push(m); added++; } });
      t.value = cur.join(', ');
    }
    // 让面板感知输入变化（请求 JSON 等联动）
    t.dispatchEvent(new Event('input', { bubbles: true }));
    t.dispatchEvent(new Event('change', { bubbles: true }));
    closeModelPicker();
    toast(p.single ? '已选用模型：' + (list[0] || '')
                   : (added ? `已加入 ${added} 个新模型，记得保存设置`
                            : '所选模型已经在列表里了'));
  }
  function bindModelPicker() {
    $('#mpSearch').addEventListener('input', () => { state.picker.index = 0; renderModelPicker(); });
    $('#mpSearch').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); mpMove(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mpMove(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); mpToggle(state.picker.index); }
      else if (e.key === 'Escape') { e.preventDefault(); closeModelPicker(); }
    });
    $('#mpList').addEventListener('click', (e) => {
      const it = e.target.closest('.mp-item');
      if (it) mpToggle(Number(it.dataset.i));
    });
    $('#mpAll').addEventListener('click', () => {
      state.picker.filtered.forEach((m) => state.picker.selected.add(m));
      renderModelPicker();
    });
    $('#mpNone').addEventListener('click', () => { state.picker.selected.clear(); renderModelPicker(); });
    $('#mpConfirm').addEventListener('click', () => {
      const list = state.picker.items.filter((m) => state.picker.selected.has(m));
      if (!list.length) { toast('请先勾选模型', 'error'); return; }
      applyModelPicker(list);
    });
    $('#btnCloseModelPicker').addEventListener('click', closeModelPicker);
    $('#modelPickerOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'modelPickerOverlay') closeModelPicker();
    });
  }

  function ratioPair() {
    const v = $('#ratio').value;
    if (v === 'custom') {
      const m = /^\s*(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)\s*$/.exec($('#ratioCustom').value || '');
      return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
    }
    return RATIO_WH[v] || [1, 1];
  }
  function ratioLabel() {
    const v = $('#ratio').value;
    if (v !== 'custom') return v;
    const m = /^\s*(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)\s*$/.exec($('#ratioCustom').value || '');
    return m ? (parseFloat(m[1]) + ':' + parseFloat(m[2])) : '';
  }
  function computeSize() {
    if (state.sizeOverride) return state.sizeOverride;
    const label = ratioLabel(), res = $('#resolution').value;
    if (label && SIZE_TABLE[label] && SIZE_TABLE[label][res]) return SIZE_TABLE[label][res];
    const pair = ratioPair();
    if (!pair) return '1024x1024';
    const B = { '1k': 1024, '2k': 2048, '4k': 4096 }[res] || 2048;
    const w = Math.max(64, Math.floor(Math.sqrt(B * B * pair[0] / pair[1]) / 64) * 64);
    const h = Math.max(64, Math.floor(Math.sqrt(B * B * pair[1] / pair[0]) / 64) * 64);
    return w + 'x' + h;
  }

  // ------------------------------ 面板参数 / 请求 JSON ------------------------------
  function collectExtra() {
    const raw = $('#extra').value.trim();
    if (!raw) return {};
    try {
      const obj = JSON.parse(raw);
      if (typeof obj !== 'object' || Array.isArray(obj) || obj === null) throw new Error('必须是 JSON 对象');
      return obj;
    } catch (e) { toast('附加参数 JSON 格式有误：' + e.message, 'error'); return null; }
  }

  function clampInt(v, lo, hi, dft) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dft;
  }

  function fmtPrompt(kind, p) {
    const base = (p || '').trim();
    if (kind === 'svg') {
      if (!$('#svgPromptHint').checked || /扁平化矢量|纯矢量|可编辑\s*svg/i.test(base)) return p;
      return (base ? base + '，' : '') + SVG_HINT;
    }
    let out = base;
    if ($('#gifLoopHint').checked && !/无缝循环/.test(out)) out = (out ? out + '，' : '') + GIF_HINT;
    if ($('#gifAnimHint').checked &&
        !/(循环动画|无缝循环|运动变化|动画|挥手|摆动|移动|loop|anim)/i.test(out)) {
      out = (out ? out + '，' : '') + '循环动画，画面中要有明确的运动变化';
    }
    return out || p;
  }

  // frame_size：'' = 自动（不传，让接口按帧数缩放），或 'WxH'
  function frameSizeValue() {
    const v = $('#gifFrameSize').value;
    if (v !== 'custom') return v;
    const m = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec($('#gifFrameSizeCustom').value || '');
    return m ? (Number(m[1]) + 'x' + Number(m[2])) : '';
  }

  // GIF 拼图预算：整体每边 ≤3840、总像素 ≤8,294,400、长宽比 ≤3:1
  function gifBudget() {
    const n = clampInt($('#gifFrames').value, 2, 16, 9);
    const fs = frameSizeValue(), box = $('#gifBudget');
    if (!fs) {
      box.className = 'fmt-budget';
      box.textContent = `✓ ${n} 帧 · 单帧尺寸自动：由接口按帧数缩放到拼图上限内（推荐）`;
      return { ok: true, n };
    }
    const m = /^(\d+)x(\d+)$/.exec(fs);
    if (!m) {
      box.className = 'fmt-budget bad';
      box.textContent = '✗ 帧尺寸格式应为 WxH，例如 512x512';
      return { ok: false, n };
    }
    const w = Number(m[1]), h = Number(m[2]);
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const sw = cols * w, sh = rows * h, total = sw * sh;
    const ratio = Math.max(sw, sh) / Math.max(1, Math.min(sw, sh));
    const issues = [];
    if (w % 16 || h % 16) issues.push('帧尺寸两边须为 16 的倍数');
    if (Math.max(sw, sh) > 3840) issues.push(`拼图 ${sw}×${sh} 单边超过 3840`);
    if (total > 8294400) issues.push(`拼图总像素 ${(total / 1e6).toFixed(2)}M 超过 8.29M`);
    if (ratio > 3) issues.push(`拼图长宽比 ${ratio.toFixed(2)}:1 超过 3:1`);
    if (n > 12 && Math.max(w, h) >= 768) issues.push(`${n} 帧时 768×768 及以上最多 12 帧`);
    if (issues.length) {
      box.className = 'fmt-budget bad';
      box.textContent = `✗ ${issues.join('；')}。建议改用「自动」或 512×512。`;
      return { ok: false, n };
    }
    box.className = 'fmt-budget';
    box.textContent = `✓ ${n} 帧 × ${w}×${h} → ${cols}×${rows} 拼图 ${sw}×${sh} ≈ ${(total / 1e6).toFixed(2)}M 像素，符合上限`;
    return { ok: true, n };
  }

  function updateFmtPreview() {
    const kind = state.fmtKind, ar = $('#fRatio').value, res = $('#fResolution').value;
    $('#gifFrameSizeCustom').classList.toggle('hidden', $('#gifFrameSize').value !== 'custom');
    const dims = `<b>aspect_ratio = ${esc(ar)} · resolution = ${esc(res)}</b>（不传 size）`;
    const warns = [];
    if (kind === 'gif') {
      const fs = frameSizeValue();
      $('#fmtSizePreview').innerHTML = fs
        ? `请求体尺寸参数 <b>frame_size = ${esc(fs)}</b>（指定帧尺寸时不传 aspect_ratio / resolution）`
        : '请求体尺寸参数 ' + dims.replace('（不传 size）', '（不传 size / frame_size）');
      const b = gifBudget();
      if (!b.ok) warns.push('帧尺寸超出拼图预算，接口会拒绝请求或降级为静态图');
      if (res === '4k' && !fs) warns.push('GIF 不建议开 4K 分辨率：极易触发尺寸超限、降级成静态图');
      if (!/(循环|动画|运动|挥手|摆动|移动|loop|anim)/i.test($('#prompt').value))
        warns.push('提示词未描述「循环动画 / 运动变化」，模型容易降级输出静态图');
    } else {
      $('#fmtSizePreview').innerHTML = '请求体尺寸参数 ' + dims;
      if (!$('#svgModel').value.trim())
        warns.push("缺少 svg.model，多数网关会报 SVG generation requires 'svg.model' 或直接返回 PNG");
      if ($('#fQuality').value) warns.push('quality 对 SVG 输出无效果，可留空避免无效参数');
      if (/(写实|照片|光影|渐变贴图|复杂海报)/.test($('#prompt').value))
        warns.push('SVG 适合扁平矢量 / 图标 / logo；写实照片、复杂光影会渲染失败并回退成位图');
    }
    const box = $('#fmtWarn');
    if (warns.length) { box.className = 'fmt-warn'; box.innerHTML = '⚠ ' + warns.map(esc).join('<br>⚠ '); }
    else box.className = 'fmt-warn hidden';
  }

  // GIF / SVG 专用请求体：只发官方 / 实测规范允许的字段，网关需要透传的全部带上
  function buildFmtRequestJson(model, prompt) {
    const kind = state.fmtKind;
    const body = { model, prompt: fmtPrompt(kind, prompt), n: 1, output_format: kind };
    const ar = $('#fRatio').value, res = $('#fResolution').value;
    const q = $('#fQuality').value, cx = $('#fComplexity').value;
    if (q) body.quality = q;
    if (cx) body.complexity = cx;
    if (kind === 'gif') {
      const fs = frameSizeValue();
      if (fs) body.frame_size = fs;
      else { body.aspect_ratio = ar; body.resolution = res; }
      body.frame_count = clampInt($('#gifFrames').value, 2, 16, 9);
      body.frame_duration_ms = Math.max(20, Math.min(2000,
        Math.round(clampInt($('#gifDuration').value, 20, 2000, 200) / 10) * 10));
    } else {
      body.aspect_ratio = ar; body.resolution = res;
      const sm = $('#svgModel').value.trim(), ef = $('#svgEffort').value;
      const svg = {};
      if (sm) svg.model = sm;
      if (ef) svg.reasoning = { effort: ef };
      if (Object.keys(svg).length) body.svg = svg;
    }
    const extra = collectExtra();
    if (extra) Object.assign(body, extra);   // 网关专属字段 / 兼容旧字段名兜底
    return body;
  }

  function buildRequestJson(promptOverride) {
    const model = $('#model').value.trim() || defaultModel();
    const prompt = promptOverride !== undefined ? promptOverride : ($('#prompt').value.trim() || '（请填写提示词）');
    if (state.mode === 'fmt') return buildFmtRequestJson(model, prompt);
    const fmt = $('#format').value, size = computeSize();
    const n = Number($('#count').value) || 1;
    const reasoning = $('#reasoning').value, bg = $('#background').value;
    const body = { model, prompt, n, size, quality: $('#quality').value };
    if (fmt) body.output_format = fmt;
    if (reasoning) body.reasoning_effort = reasoning;
    if (bg) body.background = bg;
    const extra = collectExtra();
    if (extra) Object.assign(body, extra);
    return body;
  }

  function currentRequestJson() {
    const raw = $('#reqJson').value.trim();
    if (state.reqJsonEdited && raw) {
      try {
        const o = JSON.parse(raw);
        if (o && typeof o === 'object' && !Array.isArray(o)) return o;
        toast('请求 JSON 必须是对象', 'error'); return null;
      } catch (e) { toast('请求 JSON 格式有误：' + e.message, 'error'); return null; }
    }
    const extra = collectExtra();
    if (extra === null) return null;
    return buildRequestJson();
  }

  function refreshReqJson(force) {
    // 手动编辑过请求体：面板改动不覆盖（提交以编辑内容为准）；点「按面板参数重新生成」可恢复跟随。
    if (state.reqJsonManual) return;
    // 面板参数变动（force）→ 复用标记失效，提交回归「以面板为准」，即使折叠也保持一致。
    if (force) state.reqJsonEdited = false;
    if (!$('#reqJsonDetails').open) return;
    if (state.reqJsonEdited) return;
    $('#reqJson').value = JSON.stringify(buildRequestJson(), null, 2);
    $('#reqJsonStatus').className = 'req-status';
    $('#reqJsonStatus').textContent = '与面板参数同步';
  }

  function onParamChange() {
    $('#ratioCustom').classList.toggle('hidden', $('#ratio').value !== 'custom');
    const sz = computeSize();
    $('#sizePreview').innerHTML = '实际尺寸 <b>' + esc(sz.replace('x', ' × ')) + '</b>' +
      (state.sizeOverride ? ' <span>（复用任务原尺寸，改动比例即重新换算）</span>' : '');
    $$('#fmtSeg button').forEach((b) => b.classList.toggle('active', b.dataset.fmt === state.fmtKind));
    // GIF 帧参数已收纳进「高级参数」（在 #fmtParams 之外），必须按模式无条件显隐，
    // 否则从 GIF 切回文生图时它会在折叠区里露出来。
    $('#gifParams').classList.toggle('hidden', state.mode !== 'fmt' || state.fmtKind !== 'gif');
    $('#svgParams').classList.toggle('hidden', state.mode !== 'fmt' || state.fmtKind !== 'svg');
    if (state.mode === 'fmt') updateFmtPreview();
    refreshReqJson(true);   // force：面板参数变动时始终重建请求体（复用后改参数也要跟上）
    renderAtRefs();
    syncChips();   // 预设标签的绿高亮始终跟着提示词内容走
    syncModelSettingsSummary();
  }

  function applyFormatConstraints() {
    // GIF / SVG 已独立成第三个面板，位图格式下拉不再包含它们（历史任务复用时兜底）
    if (['gif', 'svg'].includes($('#format').value)) $('#format').value = '';
  }

  function resetForm() {
    $('#prompt').value = '';
    closeAtMenu();
    state.promptBeforeOptimize = null;
    updateOptimizeBtn();
    clearFiles();
    state.reqJsonEdited = false; state.reqJsonManual = false; state.sizeOverride = '';
    $('#reqJson').value = '';
    $('#reqJsonStatus').textContent = '';
    $('#reqJsonDetails').open = false;
    const bm = state.mode === 'fmt' ? 't2i' : state.mode;
    applyDefaults(bm, defaultsFor(bm));
    applyDefaults('fmt', defaultsFor('fmt'));
    $('#ratioCustom').value = '';
    $('#gifFrameSizeCustom').value = '';
    $('#gifLoopHint').checked = true; $('#gifAnimHint').checked = true;
    $('#svgPromptHint').checked = true;
    $('#model').value = defaultModel();
    applyFormatConstraints();
    onParamChange();
    refreshModelList();
    // F08：提交后表单照旧重置，但已保存的参数预设保留在 localStorage，可随时再套用
    state.activePresetName = '';
    renderParamPresets();
  }

  function setMode(mode, skipReset) {
    state.mode = mode;
    const isFmt = mode === 'fmt';
    $$('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('#uploadBlock').classList.toggle('hidden', mode !== 'i2i');
    $('#btnAtRef').classList.toggle('hidden', mode !== 'i2i');
    $('#bitmapParams').classList.toggle('hidden', isFmt);
    $('#fmtParams').classList.toggle('hidden', !isFmt);
    $('#bgField').classList.toggle('hidden', isFmt);
    closeAtMenu();
    $('#prompt').placeholder = mode === 'i2i'
      ? '描述要对参考图做的修改，例如：把背景换成雪夜，保留人物与构图…'
      : (isFmt ? '描述画面与运动 / 矢量要求，例如：扁平化山峦 logo，缓慢循环飘动的云…'
               : '描述你想要的画面：主体、环境、光线、构图、风格…');
    if (!skipReset) resetForm();
    else { applyFormatConstraints(); onParamChange(); }
  }

  // ------------------------------ 事件绑定 ------------------------------
  function bindEvents() {
    bindSelects();
    // 图片右键菜单（只在图片区域接管 contextmenu）与重命名对话框
    document.addEventListener('contextmenu', onImgContextMenu);
    document.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-ctx]');
      if (b) { ev.preventDefault(); onCtxAction(b.dataset.ctx); return; }
      if (!ev.target.closest('#imgCtxMenu')) hideCtxMenu();
    });
    window.addEventListener('scroll', hideCtxMenu, true);
    window.addEventListener('resize', hideCtxMenu);
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      hideCtxMenu();
      if (!$('#renameOverlay').classList.contains('hidden')) closeRename();
      closeBatchMedia();
    });
    $('#btnBatchMedia').addEventListener('click', openBatchMedia);
    $('#btnBatchMediaAsset').addEventListener('click', openBatchMedia);
    $('#btnBmRename').addEventListener('click', batchRename);
    $('#btnBmTagAdd').addEventListener('click', () => batchTag(true));
    $('#btnBmTagClear').addEventListener('click', () => batchTag(false));
    $('#btnBmClose').addEventListener('click', closeBatchMedia);
    $('#lbImage').addEventListener('wheel', onLbWheel, { passive: false });
    $('#btnLbReset').addEventListener('click', resetLbZoom);
    bindLbDrag();
    bindSplitResize();
    $('#queueInfo').addEventListener('click', () => {
      const t = (state.tasks || []).find((x) => x.status === 'running' || x.status === 'pending');
      if (!t) { toast('当前没有排队或生成中的任务'); return; }
      const card = state.cards.get(t.id);
      if (!card) { toast('任务卡片尚未加载'); return; }
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const panel = $('.status-panel', card);
      if (panel) {
        panel.classList.remove('hidden');
        const btn = $('.status-ops button', card);
        if (btn) btn.textContent = '▾ 收起状态';
      }
    });
    const ms = $('#modelSettings');
    if (ms) ms.addEventListener('toggle', syncModelSettingsSummary);
    $('#btnResetPromptT2i').addEventListener('click', () => {
      $('#sLlmPromptT2i').value = RECOMMENDED_OPTIMIZE.t2i;
      toast('已填入文生图推荐指令，记得点保存设置');
    });
    $('#btnResetPromptI2i').addEventListener('click', () => {
      $('#sLlmPromptI2i').value = RECOMMENDED_OPTIMIZE.i2i;
      toast('已填入图生图推荐指令，记得点保存设置');
    });
    bindDefaultModelCards();
    $('#btnDefSave').addEventListener('click', saveDefaults);
    $('#btnDefReset').addEventListener('click', resetDefaults);
    $('#btnDefFill').addEventListener('click', fillDefFromPanel);
    $('#btnRenameOk').addEventListener('click', saveRename);
    $('#btnRenameCancel').addEventListener('click', closeRename);
    $('#btnRenameReset').addEventListener('click', () => {
      $('#renameInput').value = state.renameTarget || '';
      $('#renameInput').focus();
    });
    $('#renameInput').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); saveRename(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); closeRename(); }
    });
    $$('#modeSeg button').forEach((b) => b.addEventListener('click', () => {
      if (state.mode !== b.dataset.mode) setMode(b.dataset.mode);
    }));
    $$('#fmtSeg button').forEach((b) => b.addEventListener('click', () => {
      state.fmtKind = b.dataset.fmt;
      onParamChange();
    }));
    $('#taskForm').addEventListener('submit', submitTask);
    $('#btnClearPrompt').addEventListener('click', () => { $('#prompt').value = ''; closeAtMenu(); onParamChange(); $('#prompt').focus(); });
    bindAt();
    $('#btnOptimize').addEventListener('click', optimizePrompt);
    $('#btnFav').addEventListener('click', favoriteCurrent);
    $('#btnPromptLib').addEventListener('click', () => openPromptLib(state.promptKind));
    $('#btnSettings').addEventListener('click', () => openSettings('image'));
    $('#bannerSettings').addEventListener('click', () => openSettings('image'));
    $('#btnUsage').addEventListener('click', openUsage);
    $('#btnCloseSettings').addEventListener('click', () => $('#settingsOverlay').classList.add('hidden'));
    $('#settingsOverlay').addEventListener('click', (e) => { if (e.target.id === 'settingsOverlay') $('#settingsOverlay').classList.add('hidden'); });
    $('#btnCloseUsage').addEventListener('click', () => $('#usageOverlay').classList.add('hidden'));
    $('#btnClosePromptLib').addEventListener('click', () => $('#promptLibOverlay').classList.add('hidden'));
    $('#btnCloseInpaint').addEventListener('click', closeInpaint);
    $('#btnSaveSettings').addEventListener('click', () => saveSettings(false));
    $('#btnTest').addEventListener('click', testConnection);
    $('#btnLogout').addEventListener('click', logout);
    $('#btnClear').addEventListener('click', clearFinished);
    $('#btnDownloadAll').addEventListener('click', () => downloadSelected(null));
    $('#btnDeleteSelected').addEventListener('click', deleteSelected);
    $('#btnSelectAll').addEventListener('click', () => {
      if (selectedFiles().length) state.pickedImages.clear();
      else filtered().forEach((t) => {
        if (t.status === 'succeeded') (t.output_images || []).forEach((n) => state.pickedImages.add(pickKey(t.id, n)));
      });
      applySelection();
    });
    $$('.filters button').forEach((b) => b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      $$('.filters button').forEach((x) => x.classList.toggle('active', x === b));
      renderTasks();
    }));
    $('#searchInput').addEventListener('input', () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => { state.q = $('#searchInput').value.trim(); tick(); }, 250);
    });

    $$('#settingsTabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $$('#promptTabs button').forEach((b) => b.addEventListener('click', () => {
      state.promptKind = b.dataset.kind;
      renderPromptLib();
    }));

    ['#ratio', '#ratioCustom', '#resolution', '#quality', '#reasoning', '#count',
     '#format', '#background', '#extra', '#prompt', '#model',
     '#fRatio', '#fResolution', '#fQuality', '#fComplexity',
     '#gifFrames', '#gifDuration', '#gifFrameSize', '#gifFrameSizeCustom',
     '#gifLoopHint', '#gifAnimHint', '#svgModel', '#svgEffort', '#svgPromptHint']
      .forEach((s) => {
        const el = $(s);
        if (!el) return;
        const fn = () => {
          if (s === '#ratio' || s === '#resolution' || s === '#ratioCustom') state.sizeOverride = '';
          onParamChange();
        };
        el.addEventListener('change', fn);
        el.addEventListener('input', fn);
      });
    $('#provider').addEventListener('change', () => {
      $('#model').value = ''; closeModelMenu(); refreshModelList(); onParamChange();
      const cached = state.fetchedModels[modelCacheKey()] || [], info = $('#modelFetchInfo');
      info.classList.toggle('hidden', !cached.length);
      if (cached.length) info.textContent = `本服务已缓存 ${cached.length} 个从接口拉取的模型，可在上方搜索选择。`;
    });
    $('#reqJsonDetails').addEventListener('toggle', () => { if ($('#reqJsonDetails').open) refreshReqJson(); });
    $('#reqJson').addEventListener('input', () => {
      // 手动编辑请求体：标记为「以编辑内容为准」，此时面板参数变动不再覆盖它
      state.reqJsonManual = true;
      state.reqJsonEdited = true;
      $('#reqJsonStatus').className = 'req-status edited';
      $('#reqJsonStatus').textContent = '已手动编辑，提交时以此内容为准（点「按面板参数重新生成」恢复跟随）';
    });
    $('#btnRebuildJson').addEventListener('click', () => {
      state.reqJsonEdited = false; state.reqJsonManual = false; refreshReqJson(true); toast('已按面板参数重新生成');
    });

    const dz = $('#dropZone'), fi = $('#fileInput');
    dz.addEventListener('click', () => fi.click());
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
    fi.addEventListener('change', () => { addFiles(fi.files); fi.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
    document.addEventListener('paste', (e) => {
      const items = Array.from(e.clipboardData?.items || []).filter((i) => i.type.startsWith('image/'));
      if (items.length) { e.preventDefault(); addFiles(items.map((i) => i.getAsFile()).filter(Boolean)); }
    });
    $('#historySelect').addEventListener('change', async (e) => {
      const name = e.target.value;
      if (!name) return;
      e.target.value = '';
      await addRemoteRef(name);
    });

    $('#taskList').addEventListener('click', onCardClick);
    $('#lbClose').addEventListener('click', closeLb);
    $('#lbPrev').addEventListener('click', () => lbStep(-1));
    $('#lbNext').addEventListener('click', () => lbStep(1));
    $('#lbToI2i').addEventListener('click', lbToI2i);
    $('#lbInpaint').addEventListener('click', lbInpaint);
    $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLb(); });
    document.addEventListener('keydown', (e) => {
      if (!$('#lightbox').classList.contains('hidden')) {
        if (e.key === 'Escape') closeLb();
        if (e.key === 'ArrowLeft') lbStep(-1);
        if (e.key === 'ArrowRight') lbStep(1);
      }
    });
    $('#prompt').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('#taskForm').requestSubmit(); }
    });

    $('#btnAddImageProvider').addEventListener('click', addImageProvider);
    $('#btnAddLlmProvider').addEventListener('click', addLlmProvider);
    $('#btnAddPreset').addEventListener('click', addPreset);
    $('#btnAddUser').addEventListener('click', addUser);
    $('#btnIpClear').addEventListener('click', () => clearCanvas());
    $('#btnIpSubmit').addEventListener('click', submitInpaint);
    $$('#ipTools button').forEach((b) => b.addEventListener('click', () => {
      state.inpaint.tool = b.dataset.tool;
      $$('#ipTools button').forEach((x) => x.classList.toggle('active', x === b));
    }));
    bindCanvas();

    // 模型下拉与模型选择弹层
    bindModelCombo();
    bindModelPicker();
    $('#btnFetchModels').classList.toggle('hidden', !isAdmin());
    $('#btnFetchModels').addEventListener('click', fetchModelsForPanel);
    $('#btnFetchDefaultModels').addEventListener('click', () => fetchModelsInto({
      btn: $('#btnFetchDefaultModels'), providerId: '', kind: 'image',
      baseEl: $('#sApiBase'), keyEl: $('#sApiKey'), target: $('#sModels'),
    }));
    $('#btnFetchNewImageModels').addEventListener('click', () => fetchModelsInto({
      btn: $('#btnFetchNewImageModels'), kind: 'image',
      baseEl: $('#ipBase'), keyEl: $('#ipKey'), target: $('#ipModels'),
    }));
    $('#btnFetchDefaultLlmModels').addEventListener('click', () => fetchModelsInto({
      btn: $('#btnFetchDefaultLlmModels'), kind: 'llm', single: true,
      baseEl: $('#sLlmBase'), keyEl: $('#sLlmKey'), target: $('#sLlmModel'),
    }));
    $('#btnFetchNewLlmModels').addEventListener('click', () => fetchModelsInto({
      btn: $('#btnFetchNewLlmModels'), kind: 'llm', single: true,
      baseEl: $('#lpBase'), keyEl: $('#lpKey'), target: $('#lpModel'),
    }));
  }

  async function logout() {
    try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    location.reload();
  }

  // ------------------------------ 预设提示词 ------------------------------
  // 高亮完全由提示词内容派生：手动删字、清空、回填历史 / 收藏、优化提示词、
  // 复用参数、在设置里增删改预设后，标签都会自动跟着变。点击标签是「加入 / 移除」的开关。
  // 预设按「，, 、；;换行」分段。旧的 text.includes(v) 是子串匹配，会误判：
  // 「电影感」会命中「电影感 高清」、移除时还会把长预设切成「高清」。
  // 改成「前后必须是分隔符或字符串边界」，既保留内容派生高亮，又不会串味。
  // 注意不把空格当分隔符：中文提示词常用空格连写短语（如「电影感 高清」）。
  const PRESET_BOUNDARY = /[，,、；;\n]/;
  function presetHitAt(s, v, start) {
    const before = start === 0 ? '' : s[start - 1];
    const end = start + v.length;
    const after = end >= s.length ? '' : s[end];
    return (!before || PRESET_BOUNDARY.test(before)) && (!after || PRESET_BOUNDARY.test(after));
  }
  function hasPreset(text, v) {
    if (!v) return false;
    const s = String(text || '');
    let i = s.indexOf(v);
    while (i >= 0) {
      if (presetHitAt(s, v, i)) return true;
      i = s.indexOf(v, i + 1);
    }
    return false;
  }
  function syncChips() {
    const p = $('#prompt');
    if (!p) return;
    const text = p.value;
    $$('#styleChips .chip[data-v]').forEach((b) => {
      const v = b.dataset.v;
      const on = hasPreset(text, v);
      b.classList.toggle('added', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.title = on ? '已加入提示词，再点一次移除' : (v || '');
    });
  }

  // 只摘掉「整段等于预设」的那一处，并清理前后多余分隔符；不会切坏包含它的更长短语。
  function removePresetText(text, v) {
    const s = String(text || '');
    let i = -1, from = 0;
    while ((from = s.indexOf(v, from)) >= 0) {
      if (presetHitAt(s, v, from)) { i = from; break; }
      from += 1;
    }
    if (i < 0) return s;
    let a = i, b = i + v.length;
    while (a > 0 && /[\s，,、；;\n]/.test(s[a - 1])) a--;
    while (b < s.length && /[\s，,、；;\n]/.test(s[b])) b++;
    const left = s.slice(0, a).replace(/[\s，,、；;\n]+$/, '');
    const right = s.slice(b).replace(/^[\s，,、；;\n]+/, '');
    return (left && right) ? left + '，' + right : (left || right);
  }

  function renderChips() {
    const chips = state.presets.map((p) =>
      `<button class="chip" type="button" data-id="${esc(p.id)}" data-v="${esc(p.content)}" aria-pressed="false" title="${esc(p.content)}">${esc(p.name)}</button>`).join('');
    $('#styleChips').innerHTML = chips + (isAdmin()
      ? '<button class="chip manage" type="button" id="chipManage">⚙ 管理预设</button>' : '');
    $$('#styleChips .chip[data-v]').forEach((b) => b.addEventListener('click', () => {
      const p = $('#prompt'), v = b.dataset.v;
      if (!v) return;
      if (hasPreset(p.value, v)) {
        p.value = removePresetText(p.value, v);
        toast('已移除这条预设');
      } else {
        const base = p.value.trim().replace(/[\s，,、；;\n]+$/, '');
        p.value = (base ? base + '，' : '') + v;
      }
      p.focus(); onParamChange();   // onParamChange 内会调用 syncChips 同步高亮
    }));
    const m = $('#chipManage');
    if (m) m.addEventListener('click', () => { openSettings('image'); setTimeout(() => {
      const el = $('#presetList'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120); });
    syncChips();
  }

  // ------------------------------ 参考图 ------------------------------
  // 上游只接受静态位图作参考图；GIF 动图 / SVG 矢量会被静默降级或拒绝。
  // 统一判定，覆盖本地上传、拖放、粘贴、历史选择、缩略图挑选、结果卡片等全部入口。
  function isNonBitmap(name, type) {
    return /\.(gif|svg)$/i.test(String(name || '')) ||
      /^image\/(gif|svg\+xml)$/i.test(String(type || ''));
  }

  async function compress(file) {
    if (file.size < 1.5 * 1024 * 1024 || typeof createImageBitmap !== 'function') return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close && bmp.close();
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }) : file;
    } catch (e) { return file; }
  }

  async function addFiles(fileList) {
    const arr = Array.from(fileList || []).filter((f) => f && f.type && f.type.startsWith('image/'));
    if (!arr.length) return 0;
    let added = 0, blocked = 0;
    for (const f of arr) {
      if (isNonBitmap(f.name, f.type)) { blocked++; continue; }
      if (state.files.length >= 8) { toast('最多上传 8 张参考图', 'error'); break; }
      const blob = await compress(f);
      state.files.push({ file: blob, name: f.name || 'image.png', url: URL.createObjectURL(blob) });
      added++;
    }
    if (blocked) toast('GIF / SVG 不能作为参考图，已跳过', 'error');
    if (added) renderRefs();
    return added;
  }

  async function addRemoteRef(name) {
    if (isNonBitmap(name)) { toast('GIF / SVG 不能作为参考图', 'error'); return 0; }
    try {
      const res = await fetch(fileUrl(name), { credentials: 'same-origin' });
      if (!res.ok) throw new Error('图片读取失败');
      const blob = await res.blob();
      // 文件名可能被截断丢掉后缀，再按服务端返回的 MIME 兜一道
      if (isNonBitmap(name, blob.type)) { toast('GIF / SVG 不能作为参考图', 'error'); return 0; }
      const label = name.replace(/^out_/, '').slice(0, 24);
      const added = await addFiles([new File([blob], label, { type: blob.type || 'image/png' })]);
      if (added) toast('已添加为参考图 ' + state.files.length);
      return added;
    } catch (e) { toast(e.message, 'error'); return 0; }
  }

  function renderRefs() {
    warnAtRefsChanged();
    const box = $('#refList');
    box.innerHTML = state.files.map((f, i) =>
      `<div class="ref-item" draggable="true" data-i="${i}">
         <span class="ref-no">参考图 ${i + 1}</span>
         <img src="${esc(f.url)}" alt="参考图 ${i + 1}">
         <span class="ref-no-badge" aria-hidden="true">${i + 1}</span>
         <span class="ref-name">${esc(f.name)}</span>
         <div class="ref-ops">
           <button type="button" data-op="up" data-i="${i}" title="上移">↑</button>
           <button type="button" data-op="down" data-i="${i}" title="下移">↓</button>
           <button type="button" class="del" data-op="del" data-i="${i}" title="移除">✕</button>
         </div>
       </div>`).join('');
    $$('#refList [data-op]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = Number(b.dataset.i), op = b.dataset.op;
      if (op === 'del') {
        const f = state.files.splice(i, 1)[0];
        if (f) URL.revokeObjectURL(f.url);
      } else {
        const j = op === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= state.files.length) return;
        [state.files[i], state.files[j]] = [state.files[j], state.files[i]];
      }
      renderRefs();
    }));
    let dragFrom = null;
    $$('#refList .ref-item').forEach((el) => {
      el.addEventListener('dragstart', () => { dragFrom = Number(el.dataset.i); el.classList.add('dragging'); });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); $$('#refList .ref-item').forEach((x) => x.classList.remove('dragover')); });
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('dragover'); });
      el.addEventListener('dragleave', () => el.classList.remove('dragover'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const to = Number(el.dataset.i);
        if (dragFrom === null || dragFrom === to) return;
        const [moved] = state.files.splice(dragFrom, 1);
        state.files.splice(to, 0, moved);
        dragFrom = null;
        renderRefs();
      });
    });
    renderAtRefs();   // 参考图增删/重排后同步刷新「已引用」chips（含编号是否仍有效）
  }

  function clearFiles() {
    state.files.forEach((f) => URL.revokeObjectURL(f.url));
    state.files = []; closeAtMenu(); renderRefs();
  }

  function renderHistorySelect() {
    const sel = $('#historySelect');
    const items = [];
    for (const t of state.tasks) {
      if (t.status !== 'succeeded') continue;
      (t.output_images || []).forEach((n, i) => {
        if (isNonBitmap(n)) return;   // 历史选择里不出现 GIF / SVG
        items.push({ name: n, label: `${fmtTime(t.created_at)} · ${(t.prompt || '').slice(0, 18)} · #${i + 1}` });
      });
    }
    const sig = items.slice(0, 60).map((x) => x.name).join('|');
    if (sel.dataset.sig === sig) return;
    sel.dataset.sig = sig;
    sel.innerHTML = '<option value="">从已生成图片选择参考图…</option>' +
      items.slice(0, 60).map((x) => `<option value="${esc(x.name)}">${esc(x.label)}</option>`).join('');
  }

  // ------------------------------ 提示词 @ 引用参考图 ------------------------------
  // 图生图上传的参考图按 state.files 的顺序一并提交，模型按「第 N 张」理解。
  // 输入 @ 可插入「@参考图N」文本标记，方便在长提示词里明确指代某张图；
  // 标记本身就是提示词文本，会随 prompt 一起发给接口（不改变实际上传的图片）。
  const AT_RE = /@参考图(\d+)/g;

  function atTokens(text) {
    const out = []; let m;
    AT_RE.lastIndex = 0;
    while ((m = AT_RE.exec(text))) out.push({ n: Number(m[1]), raw: m[0], at: m.index });
    return out;
  }

  // 取光标前尚未结束的 @token；@ 后一旦出现空白 / 标点就视为已输入完毕，菜单收起。
  function atContext() {
    if (state.mode !== 'i2i') return null;   // @ 引用只在图生图有效
    const ta = $('#prompt');
    const pos = ta.selectionStart;
    if (pos == null) return null;
    const before = ta.value.slice(0, pos);
    const at = before.lastIndexOf('@');
    if (at < 0) return null;
    const seg = before.slice(at + 1);
    if (!/^[0-9A-Za-z\u4e00-\u9fa5_.\-]*$/.test(seg)) return null;
    const prev = at > 0 ? before[at - 1] : '';
    if (/[A-Za-z0-9_]/.test(prev)) return null;   // 避免邮箱 a@b 之类误触发
    return { start: at, end: pos, query: seg };
  }

  function closeAtMenu() {
    state.at.open = false;
    state.at.items = [];
    const m = $('#atMenu');
    if (m) m.classList.add('hidden');
  }

  function openAtMenu(ctx) {
    state.at.open = true;
    state.at.start = ctx.start;
    state.at.end = ctx.end;
    state.at.query = ctx.query || '';
    state.at.index = 0;
    renderAtMenu();
  }

  function renderAtMenu() {
    const menu = $('#atMenu');
    if (!menu) return;
    if (!state.at.open) { menu.classList.add('hidden'); return; }
    const q = state.at.query.toLowerCase();
    const items = state.files.map((f, i) => ({
      i, n: i + 1, label: '参考图 ' + (i + 1), name: f.name, url: f.url,
    })).filter((x) => !q ||
      (x.label + ' ' + x.n + ' ' + x.name).toLowerCase().includes(q));
    state.at.items = items;
    if (state.at.index >= items.length) state.at.index = 0;
    if (!items.length) {
      menu.innerHTML = state.files.length
        ? '<div class="at-empty">没有匹配的参考图，换个关键词或直接输入编号</div>'
        : '<div class="at-empty">还没有上传参考图</div>';
    } else {
      menu.innerHTML = items.map((x, k) =>
        `<div class="at-item${k === state.at.index ? ' active' : ''}" data-k="${k}" role="option">
           <img class="at-thumb" src="${esc(x.url)}" alt="">
           <span class="at-label">${esc(x.label)}</span>
           <span class="at-name">${esc(x.name)}</span>
         </div>`).join('');
      $$('#atMenu .at-item').forEach((el) => {
        el.addEventListener('mousedown', (e) => { e.preventDefault(); pickAt(Number(el.dataset.k)); });
      });
    }
    const wasHidden = menu.classList.contains('hidden');
    menu.classList.remove('hidden');
    // 提示词框常位于页面下方，菜单向下展开可能被视口裁掉；打开时滚进视口一次
    if (wasHidden && menu.scrollIntoView) menu.scrollIntoView({ block: 'nearest' });
  }

  function pickAt(k) {
    const ctx = state.at, ta = $('#prompt');
    const item = ctx.items[k];
    if (!item) return;
    const token = '@参考图' + item.n;
    const v = ta.value;
    const start = Math.min(ctx.start, v.length), end = Math.min(ctx.end, v.length);
    ta.value = v.slice(0, start) + token + ' ' + v.slice(end);
    const caret = start + token.length + 1;
    closeAtMenu();
    ta.focus();
    ta.setSelectionRange(caret, caret);
    onParamChange();
    toast('已引用 ' + token + '（第 ' + item.n + ' 张参考图）');
  }

  // 提示词下方的「已引用」chips：实时反映引用了哪几张、编号是否仍有效。
  function renderAtRefs() {
    const box = $('#atRefs');
    if (!box) return;
    const toks = atTokens($('#prompt').value);
    if (!toks.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const seen = new Set();
    box.innerHTML = '<span class="at-refs-lead">提示词已引用：</span>' + toks.map((t) => {
      const dup = seen.has(t.n); seen.add(t.n);
      const f = state.files[t.n - 1];
      const invalid = t.n < 1 || t.n > state.files.length;
      return `<span class="at-chip${invalid ? ' invalid' : ''}" title="${esc(t.raw)} 对应第 ${t.n} 张参考图">
        ${f ? `<img src="${esc(f.url)}" alt="">` : ''}<b>${esc(t.raw)}</b>${invalid ? ' · 已无此图' : (dup ? ' · 重复' : '')}
      </span>`;
    }).join('');
    box.classList.remove('hidden');
  }

  function validateAtRefs(prompt) {
    const bad = atTokens(prompt).find((t) => t.n < 1 || t.n > state.files.length);
    if (bad) {
      toast(`提示词引用了 ${bad.raw}，但当前只有 ${state.files.length} 张参考图，请调整引用或重新上传`, 'error');
      $('#prompt').focus();
      return false;
    }
    return true;
  }

  // F18：参考图被删除 / 重排时，按文件名算出「旧编号 → 新编号」映射，
  // 给出失效提示与「一键重编号」；@参考图N 仍是提示词文本，随 prompt 一起发送（契约不变）。
  let lastRefNames = null;
  function warnAtRefsChanged() {
    const names = state.files.map((f) => f.name);
    const promptEl = $('#prompt');
    const hasTokens = atTokens(promptEl.value).length > 0;
    if (lastRefNames && hasTokens) {
      const prev = lastRefNames, cur = names;
      const shrunk = cur.length < prev.length;
      const reordered = !shrunk && cur.length === prev.length && cur.some((n, i) => n !== prev[i]);
      if (shrunk || reordered) {
        const map = new Map();
        prev.forEach((n, i) => {
          const j = cur.indexOf(n);
          if (j >= 0 && !map.has(i + 1)) map.set(i + 1, j + 1);
          else if (j >= 0) {
            // 同名文件重复时按剩余位置顺序分配，避免把多个旧编号都映射到同一个新编号
            let k = cur.findIndex((x, p) => x === n && !Array.from(map.values()).includes(p + 1));
            if (k >= 0) map.set(i + 1, k + 1);
          }
        });
        state.atRefMapping = map;
        renderAtHint();
        toast('参考图被删除或调整顺序，请检查提示词里的 @参考图N 是否仍对应正确', 'error');
      }
    }
    lastRefNames = names;
  }

  function bindAt() {
    const ta = $('#prompt');
    ta.addEventListener('input', () => {
      const ctx = atContext();
      if (ctx) openAtMenu(ctx); else closeAtMenu();
      renderAtRefs();
    });
    ta.addEventListener('keydown', (e) => {
      if (!state.at.open) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') return;  // 让 Ctrl+Enter 提交照常生效
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = state.at.items.length;
        if (n) state.at.index = (state.at.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        renderAtMenu();
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (state.at.items.length) { e.preventDefault(); pickAt(state.at.index); }
      } else if (e.key === 'Escape') {
        e.preventDefault(); closeAtMenu();
      }
    });
    ta.addEventListener('click', () => { if (!atContext()) closeAtMenu(); renderAtRefs(); });
    ta.addEventListener('blur', (e) => {
      const menu = $('#atMenu');
      if (e.relatedTarget && menu.contains(e.relatedTarget)) return;  // 点菜单项由 mousedown 处理
      // 按钮会在点击后把焦点还给提示框，这种情况不要误关菜单
      setTimeout(() => { if (document.activeElement !== ta) closeAtMenu(); }, 160);
    });
    $('#btnAtRef').addEventListener('click', () => {
      if (state.mode !== 'i2i') {
        toast('@ 引用参考图只在「图生图」模式可用，请先切换模式', 'error');
        return;
      }
      if (!state.files.length) {
        toast('请先上传至少一张参考图，再使用 @ 引用', 'error');
        $('#dropZone').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const pos = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, pos) + '@' + ta.value.slice(pos);
      ta.focus();
      ta.setSelectionRange(pos + 1, pos + 1);
      onParamChange();
      openAtMenu({ start: pos, end: pos + 1, query: '' });
    });
  }

  // ------------------------------ 提交 ------------------------------
  async function submitTask(e) {
    e.preventDefault();
    const body = currentRequestJson();
    if (!body) return;
    const prompt = String(body.prompt || '').trim();
    if (!prompt || prompt === '（请填写提示词）') { toast('请先写点提示词', 'error'); $('#prompt').focus(); return; }
    if (state.mode === 'i2i' && !state.files.length) { toast('图生图需要先上传参考图', 'error'); return; }
    if (state.mode === 'i2i' && !validateAtRefs(prompt)) return;

    const isFmt = state.mode === 'fmt';
    const fd = new FormData();
    // GIF / SVG 只支持文生图接口；这里统一映射为 t2i，后端会清空任何参考图
    fd.append('mode', state.mode === 'i2i' ? 'i2i' : 't2i');
    fd.append('model', String(body.model || $('#model').value.trim() || defaultModel()));
    fd.append('prompt', prompt);
    fd.append('size', isFmt ? '' : String(body.size || computeSize()));
    fd.append('quality', isFmt ? $('#fQuality').value : $('#quality').value);
    fd.append('n', isFmt ? '1' : $('#count').value);
    fd.append('output_format', isFmt ? state.fmtKind : $('#format').value);
    fd.append('params', JSON.stringify(collectExtra() || {}));
    fd.append('request_json', JSON.stringify(body));
    fd.append('provider_id', $('#provider').value);
    if (state.mode === 'i2i') state.files.forEach((f) => fd.append('images', f.file, f.name));

    const btn = $('#btnSubmit');
    btn.disabled = true; $('span', btn).textContent = '提交中…';
    try {
      const task = await api('/api/tasks', { method: 'POST', body: fd });
      state.tasks.unshift(task);
      renderTasks(); renderHistorySelect();
      toast('已开始生成，参数已重置，可继续下一次生成');
      resetForm();
      tick();
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; $('span', btn).textContent = '开始生成'; }
  }

  // ------------------------------ 提示词优化 / 收藏 / 历史 ------------------------------
  function updateOptimizeBtn() {
    const b = $('#btnOptimize');
    if (state.promptBeforeOptimize !== null) { b.textContent = '↩ 撤回提示词优化'; b.style.color = 'var(--warn)'; }
    else { b.textContent = '✨ 优化提示词'; b.style.color = ''; }
  }
  async function optimizePrompt() {
    if (state.promptBeforeOptimize !== null) {
      $('#prompt').value = state.promptBeforeOptimize;
      state.promptBeforeOptimize = null;
      updateOptimizeBtn(); onParamChange(); toast('已撤回优化');
      return;
    }
    const p = $('#prompt').value.trim();
    if (!p) { toast('请先写点提示词', 'error'); return; }
    const btn = $('#btnOptimize'); btn.disabled = true; btn.textContent = '优化中…';
    try {
      const r = await api('/api/prompt/optimize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: p, mode: state.mode,
          // GIF·SVG 页签下把具体类型显式传给后端，即使用户没写「SVG」二字也能触发类型规则
          fmt_kind: state.mode === 'fmt' ? state.fmtKind : '',
          llm_provider_id: $('#llmProvider').value,
        }),
      });
      state.promptBeforeOptimize = p;
      $('#prompt').value = r.prompt;
      onParamChange(); toast('提示词已优化，可点「撤回」恢复原文');
    } catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; updateOptimizeBtn(); }
  }
  async function favoriteCurrent() {
    const p = $('#prompt').value.trim();
    if (!p) { toast('请先写点提示词', 'error'); return; }
    try { await api('/api/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'favorite', text: p }) }); toast('已收藏到「我的提示词」'); }
    catch (e) { toast(e.message, 'error'); }
  }

  // ---------- 提示词库（预设 / 收藏 / 历史 → 生成端） ----------
  function bankItems() {
    const tab = state.bankTab || 'preset';
    let list;
    if (tab === 'preset') {
      list = (state.presets || []).map((p) => ({ id: p.id, name: p.name, text: p.content, kind: 'preset' }));
    } else {
      list = (state.promptItems || []).filter((x) => x.kind === tab)
        .map((x) => ({ id: x.id, name: tab === 'favorite' ? '收藏' : '历史', text: x.text, kind: tab }));
    }
    const q = String(state.promptViewQuery || '').trim().toLowerCase();
    return q ? list.filter((x) => (String(x.name) + ' ' + String(x.text)).toLowerCase().includes(q)) : list;
  }
  function applyBankText(text, append) {
    const ta = $('#prompt');
    if (append) {
      const cur = ta.value.trim();
      ta.value = cur ? cur.replace(/[，,；;]\s*$/, '') + '，' + text : text;
    } else ta.value = text;
    onParamChange();
    switchMainView('workbench');
    ta.focus();
    toast(append ? '已追加到提示词' : '已套用提示词，可直接开始生成');
  }
  function renderPromptBank() {
    const box = $('#promptViewBody'); if (!box) return;
    const items = bankItems();
    $$('#promptViewTabs button').forEach((b) =>
      b.classList.toggle('active', b.dataset.bank === (state.bankTab || 'preset')));
    const np = $('#btnBankNewPreset'); if (np) np.classList.toggle('hidden', !isAdmin());
    const tag = { preset: '共享预设', favorite: '我的收藏', history: '提交历史' };
    box.innerHTML = items.length ? items.map((x) => `
      <div class="bank-card">
        <div class="bank-card-head"><b>${esc(x.name)}</b><span class="bank-kind">${tag[x.kind] || ''}</span></div>
        <p>${esc(x.text)}</p>
        <div class="bank-ops">
          <button type="button" class="ghost-btn" data-bank-act="apply" data-text="${esc(x.text)}">套用</button>
          <button type="button" class="ghost-btn" data-bank-act="append" data-text="${esc(x.text)}">追加</button>
          <button type="button" class="ghost-btn" data-bank-act="copy" data-text="${esc(x.text)}">复制</button>
          ${x.kind === 'history' ? `<button type="button" class="ghost-btn" data-bank-act="fav" data-text="${esc(x.text)}">收藏</button>` : ''}
          <button type="button" class="ghost-btn danger" data-bank-act="del" data-id="${esc(x.id)}" data-kind="${esc(x.kind)}">删除</button>
        </div>
      </div>`).join('') : '<p class="tip">这里还没有内容。可在上方写入提示词后点「＋ 存入收藏」。</p>';
    const cnt = $('#promptViewCount'); if (cnt) cnt.textContent = `(${items.length})`;
    $$('#promptViewBody [data-bank-act]').forEach((b) => b.addEventListener('click', async () => {
      const act = b.dataset.bankAct, text = b.dataset.text || '';
      if (act === 'apply') { applyBankText(text, false); return; }
      if (act === 'append') { applyBankText(text, true); return; }
      if (act === 'copy') { await copyText(text, '已复制'); return; }
      try {
        if (act === 'fav') {
          await api('/api/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'favorite', text }) });
          await loadPromptItems(); renderPromptBank(); toast('已收藏');
        } else if (act === 'del') {
          if (b.dataset.kind === 'preset') {
            await api('/api/presets/' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
            await loadPresets();
          } else {
            const r = await api('/api/prompts/' + encodeURIComponent(b.dataset.id), { method: 'DELETE' });
            state.promptItems = r.items || [];
          }
          renderPromptBank();
        }
      } catch (e) { toast(e.message, 'error'); }
    }));
  }
  async function enterPromptBank() {
    const cur = $('#bankCurrent'); if (cur) cur.value = $('#prompt').value || '';
    await Promise.all([loadPromptItems(), loadPresets()]);
    renderPromptBank();
  }
  async function saveBankFavorite() {
    const text = ($('#bankCurrent').value || '').trim();
    if (!text) { toast('请先写点提示词', 'error'); return; }
    try {
      await api('/api/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'favorite', text }) });
      await loadPromptItems(); renderPromptBank(); toast('已存入收藏');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function saveBankPreset() {
    const name = $('#bankPresetName').value.trim(), content = $('#bankPresetContent').value.trim();
    if (!name || !content) { toast('名称和内容都要填', 'error'); return; }
    try {
      await api('/api/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }) });
      await loadPresets();
      $('#bankPresetName').value = ''; $('#bankPresetContent').value = '';
      $('#bankNewPreset').classList.add('hidden');
      renderPromptBank(); toast('预设已创建，所有人可用');
    } catch (e) { toast(e.message, 'error'); }
  }
  function syncPromptTabs() {
    $$('#promptTabs button').forEach((x) =>
      x.classList.toggle('active', x.dataset.kind === state.promptKind));
  }
  async function loadPromptItems() {
    try {
      const r = await api('/api/prompts');
      state.promptItems = r.items || [];
      renderPromptLib();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function openPromptLib(kind) {
    state.promptKind = kind || 'history';
    syncPromptTabs();
    $('#promptLibOverlay').classList.remove('hidden');
    await loadPromptItems();
  }
  function libHTML(list) {
    return list.length
      ? list.map((x) => `<div class="prompt-lib-item">
           <p data-use="${esc(x.text)}" title="点击回填到创作面板">${esc(x.text)}</p>
           <span class="pl-time">${fmtTime(x.created_at)}</span>
           <button class="ghost-btn" type="button" data-del="${esc(x.id)}">删除</button>
         </div>`).join('')
      : '<p class="tip">这里还没有内容。' + (state.promptKind === 'history' ? '每次提交生成都会自动记录一条历史。' : '点提示词框上方的「☆ 收藏」把常用句子存起来。') + '</p>';
  }
  function renderPromptLib() {
    syncPromptTabs();
    const items = (state.promptItems || []).filter((x) => x.kind === state.promptKind);
    $('#promptLibBody').innerHTML = libHTML(items);

    $$('#promptLibBody [data-use]').forEach((p) => p.addEventListener('click', () => {
      $('#prompt').value = p.dataset.use;
      $('#promptLibOverlay').classList.add('hidden');
      if (state.mainView === 'prompts') switchMainView('workbench');
      onParamChange(); toast('已回填提示词');
    }));
    $$('#promptLibBody [data-del]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const r = await api('/api/prompts/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
        state.promptItems = r.items || []; renderPromptLib();
      } catch (e) { toast(e.message, 'error'); }
    }));
  }

  // ------------------------------ 任务卡片 ------------------------------
  // F10：状态筛选（既有）之后叠加模型 / 服务商 / 作者 / 时间范围四个纯前端维度。
  // 搜索词 q 由服务端 /api/tasks?q= 过滤，state.tasks 已是搜索后的结果。
  // filtered() 同时是 F05 导出、F14 空态、F19 分组、全选 / 打包选中 的唯一取数口径。
  function filtered() {
    let out = state.tasks;
    if (state.filter === 'active') out = out.filter((t) => t.status === 'pending' || t.status === 'running');
    else if (state.filter !== 'all') out = out.filter((t) => t.status === state.filter);
    const f = state.filters;
    if (f.model) {
      const q = f.model.toLowerCase();
      out = out.filter((t) => String(t.model || '').toLowerCase().includes(q));
    }
    if (f.provider) {
      const q = f.provider.toLowerCase();
      out = out.filter((t) => String(t.provider_name || '默认服务').toLowerCase().includes(q));
    }
    if (f.author) {
      const q = f.author.toLowerCase();
      out = out.filter((t) => String(t.username || '').toLowerCase().includes(q));
    }
    // 只认 HTML 里 fRangeSeg 的两个具体值；未知值一律不筛，避免新增档位时误当 7 天。
    if (f.range === 'today' || f.range === '7d') {
      let start = 0;
      if (f.range === 'today') {
        const d = new Date(); d.setHours(0, 0, 0, 0);
        start = d.getTime() / 1000;
      } else {
        start = Date.now() / 1000 - 7 * 86400;
      }
      out = out.filter((t) => (t.created_at || 0) >= start);
    }
    return out;
  }
  // F19：分组表头与卡片共用 #taskList 一条 DOM 流；表头用 state.groupHeaders 单独复用，
  // 卡片继续用 state.cards + dataset.sig 增量重绘，两者互不覆盖（02 文档 F.1 第 10 条）。
  // F10：sig 并入 state.q 与 state.filters，保证搜索高亮 / 筛选变化后卡片确实重绘。
  function renderTasks() {
    const list = $('#taskList'), visible = filtered();
    const ids = new Set(visible.map((t) => t.id));
    for (const [id, el] of state.cards) {
      if (!ids.has(id)) { el.remove(); state.cards.delete(id); }
    }
    const ensureCard = (t) => {
      let el = state.cards.get(t.id);
      if (!el) { el = document.createElement('article'); el.className = 'card'; state.cards.set(t.id, el); }
      const sig = JSON.stringify([t.status, t.output_images, t.error, t.attempts, t.prompt,
        state.accessKey, state.q, JSON.stringify(state.filters), state.nameRev]);
      if (el.dataset.sig !== sig) { el.innerHTML = cardHTML(t); el.dataset.sig = sig; }
      return el;
    };
    const order = [];
    if (state.groupBy === 'none') {
      visible.forEach((t) => order.push(ensureCard(t)));
      if (state.groupHeaders.size) {
        state.groupHeaders.forEach((el) => el.remove());
        state.groupHeaders.clear();
      }
    } else {
      const used = new Set();
      groupTasks(visible).forEach((g) => {
        const key = state.groupBy + '|' + g.label;
        used.add(key);
        let h = state.groupHeaders.get(key);
        if (!h) {
          h = document.createElement('div');
          h.className = 'group-head';
          h.setAttribute('data-act', 'togglegroup');
          h.setAttribute('data-group', key);
          state.groupHeaders.set(key, h);
        }
        const collapsed = state.collapsedGroups.has(key);
        h.innerHTML = `<button type="button" class="group-toggle" data-act="togglegroup" data-group="${esc(key)}" aria-expanded="${collapsed ? 'false' : 'true'}">
            <span class="group-chevron">${collapsed ? '▸' : '▾'}</span>${esc(g.label)}</button>
          <span class="group-title">${g.tasks.length} 个任务</span>
          <span class="group-meta">${collapsed ? '已折叠 · 点击展开' : '点击标题可折叠'}</span>`;
        order.push(h);
        if (!collapsed) g.tasks.forEach((t) => order.push(ensureCard(t)));
      });
      for (const [key, el] of state.groupHeaders) {
        if (!used.has(key)) { el.remove(); state.groupHeaders.delete(key); }
      }
    }
    // 统一按 order 重排：折叠组的卡片只是从 DOM 上摘下（Map 里仍保留），展开后原节点直接回插，不重新加载图片
    const keep = new Set(order);
    Array.from(list.children).forEach((n) => { if (!keep.has(n)) n.remove(); });
    order.forEach((n, i) => { if (list.children[i] !== n) list.insertBefore(n, list.children[i] || null); });
    $('#taskCount').textContent = `(${state.tasks.length})`;
    // F14：五类空态按当前状态分流
    renderEmptyState(visible.length ? 'none' : currentEmptyKind());
    // F14：排队位置随轮询刷新，只改文本不整卡重绘（避免打断图片预览与滚动）
    const waiting = state.tasks.filter((x) => x.status === 'pending')
      .slice().sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    waiting.forEach((t, i) => {
      const card = state.cards.get(t.id);
      if (!card) return;
      const q = $('.queue-pos', card);
      if (q) q.textContent = `排队第 ${i + 1} 位 · 共 ${waiting.length} 个待处理`;
    });
    renderCounters(state.stats.total !== undefined ? state.stats : {
      total: state.tasks.length,
      pending: state.tasks.filter((t) => t.status === 'pending').length,
      running: state.tasks.filter((t) => t.status === 'running').length,
      configured: true,
    });
    applySelection();   // 卡片重绘后恢复勾选视觉
    syncConfigured();
  }

  // ------------------------------ 打包勾选 ------------------------------
  function pickKey(id, name) { return id + '|' + name; }
  function applySelection() {
    $$('#taskList .img-wrap[data-key]').forEach((w) => {
      const on = state.pickedImages.has(w.dataset.key);
      w.classList.toggle('picked', on);
      const b = $('.img-pick', w);
      if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    // 只统计仍然有效的勾选：任务被删除 / 重跑后，Set 里的残留 key 不该算进去
    const n = selectedFiles().length;
    const info = $('#pickInfo');
    if (info) info.textContent = `已选 ${n} 张`;
    const all = $('#btnSelectAll');
    if (all) all.textContent = n ? '取消选择' : '全选';
    syncAssetSelection();   // F03：资产库与画廊共用同一份 state.pickedImages
  }
  function togglePick(id, name) {
    const k = pickKey(id, name);
    if (state.pickedImages.has(k)) state.pickedImages.delete(k);
    else state.pickedImages.add(k);
    applySelection();
  }
  function selectedFiles(onlyTask) {
    const out = [];
    state.pickedImages.forEach((k) => {
      const i = k.indexOf('|');
      if (i < 1) return;
      const tid = k.slice(0, i), name = k.slice(i + 1);
      if (onlyTask && tid !== onlyTask) return;
      const t = state.tasks.find((x) => x.id === tid);
      if (!t || t.status !== 'succeeded' || !(t.output_images || []).includes(name)) return;
      out.push({ tid, name });
    });
    return out;
  }
  function cardHTML(t) {
    const [label, cls] = STATUS[t.status] || ['未知', 'pending'];
    let sub = esc(fmtTime(t.created_at));
    if (t.status === 'running') {
      const st = t.started_at || t.created_at;
      sub += ' · 已用 <span class="card-elapsed" data-start="' + Number(st) + '">' + esc(dur(st, serverNow())) + '</span>';
    } else if (t.status === 'pending') {
      const st = t.created_at;
      sub += ' · 已等待 <span class="card-elapsed" data-start="' + Number(st) + '">' + esc(dur(st, serverNow())) + '</span>';
    } else if (t.status === 'succeeded' || t.status === 'failed') {
      sub += ' · 耗时 ' + esc(dur(t.created_at, t.finished_at));
    }
    const hasOut = t.status === 'succeeded' && !!(t.output_images && t.output_images.length);
    const ops = `
      <button type="button" data-act="reuse" data-id="${t.id}">复用参数</button>
      <button type="button" data-act="copy" data-id="${t.id}">复制提示词</button>
      ${hasOut ? `<button type="button" data-act="toi2i-all" data-id="${t.id}" title="把本任务的生成图加入图生图参考图">＋ 加入图生图</button>` : ''}
      ${hasOut ? `<button type="button" data-act="zip" data-id="${t.id}" title="只打包本任务里已勾选的图片">打包选中</button>` : ''}
      ${hasOut ? `<button type="button" data-act="dlall" data-id="${t.id}" title="打包本任务全部原图">⤓ 下载原图</button>` : ''}
      ${t.status === 'succeeded' && t.mode !== 'i2i' ? `<button type="button" data-act="again" data-id="${t.id}" title="用本任务的原参数再排一张">↻ 再生成一张</button>` : ''}
      <button type="button" data-act="retry" data-id="${t.id}">重试</button>
      ${t.status !== 'running' ? `<button type="button" class="danger" data-act="del" data-id="${t.id}">删除</button>` : ''}`;
    const meta = [t.model, t.mode === 'i2i' ? '图生图' : '文生图', t.size,
      t.quality ? '画质 ' + t.quality : '', '×' + t.n,
      t.provider_name && t.provider_name !== '默认服务' ? t.provider_name : '']
      .filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('');
    let refs = '';
    if (t.input_images && t.input_images.length) {
      refs = `<div class="card-refs">${t.input_images.map((n, i) =>
        `<img src="${fileUrl(n)}" data-act="view" data-id="${t.id}" data-idx="r${i}" alt="参考图">`).join('')}</div>`;
    }
    if (t.mask_image) refs += `<div class="card-meta"><span>含局部修图遮罩</span></div>`;
    let images = '';
    if (t.status === 'succeeded') {
      images = t.output_images.length
        ? `<div class="card-images">${t.output_images.map((n, i) => `
            <div class="img-wrap" data-key="${esc(t.id + '|' + n)}" data-img-name="${esc(n)}" data-task-id="${esc(t.id)}">
              <img src="${fileUrl(n)}" data-act="view" data-id="${t.id}" data-idx="${i}" alt="生成结果 ${i + 1}" title="${esc(imgLabel(n))}" loading="lazy">
              <button type="button" class="img-pick" data-act="pick" data-id="${t.id}" data-idx="${i}" data-name="${esc(n)}" aria-pressed="false" title="勾选后打包下载（可多选）">
                <span class="pick-box">✓</span><span class="pick-label">选择</span>
              </button>
              <div class="img-quick">
                <button type="button" data-act="copyimg" data-id="${t.id}" data-name="${esc(n)}">⧉ 复制</button>
                <button type="button" data-act="download" data-name="${esc(n)}">⤓ 下载原图</button>
                ${/\.(gif|svg)$/i.test(n) ? '' : `<button type="button" data-act="toi2i" data-id="${t.id}" data-idx="${i}">＋ 参考图</button>`}
                ${/\.(gif|svg)$/i.test(n) ? '' : `<button type="button" data-act="inpaint" data-id="${t.id}" data-idx="${i}">▣ 局部修图</button>`}
              </div>
            </div>`).join('')}</div>`
        : '<div class="card-error">该任务的图片已不存在（可能已被删除）。</div>';
    } else if (t.status === 'pending' || t.status === 'running') {
      const cells = Math.min(4, Math.max(1, t.n || 1));
      const ratio = skeletonRatio(t);
      const statusText = t.status === 'pending'
        ? '<div class="skeleton-status">静态占位 · <span class="queue-pos">排队中</span></div>'
        : '<div class="skeleton-status">静态占位 · 正在生成，请稍候</div>';
      images = `<div class="skeleton-grid" style="--sk-ratio:${ratio}">` +
        Array.from({ length: cells }, () => '<div class="skeleton"></div>').join('') +
        `</div><div class="progress"></div>${statusText}
         <div class="status-ops"><button type="button" data-act="status" data-id="${t.id}">▸ 查看当前状态</button></div>
         ${statusPanelHTML(t)}`;
    }
    const err = t.error ? `<details class="err-details"><summary>错误信息</summary><pre>${esc(t.error)}</pre></details>` : '';
    // F11：失败卡片给出归类、针对性建议与三个排查动作；
    // .card-error 仍完整保留原始错误（V8），fmtWarn 逻辑不动（E12 / V8）。
    let failPanel = '';
    if (t.status === 'failed') {
      const c = classifyError(t);
      const view = esc(JSON.stringify(finalRequestView(t), null, 2));
      failPanel = `<div class="fail-panel">
        <div class="fail-head"><span class="fail-cat">${esc(c.label)}</span>
          <span class="card-time">按错误内容自动归类，仅供参考</span></div>
        <p class="fail-advice">${esc(c.advice)}</p>
        <div class="fail-ops">
          <button type="button" data-act="reqjson" data-id="${t.id}">查看最终请求 JSON</button>
          <button type="button" data-act="copyerr" data-id="${t.id}">复制错误</button>
          <button type="button" data-act="retrysame" data-id="${t.id}">用相同参数重试</button>
        </div>
        <details class="fail-req"><summary>最终请求 JSON（可展开核对）</summary><pre>${view}</pre></details>
      </div>`;
    }
    // 请求 GIF / SVG 但接口实际返回了别的格式：明确告知，避免误以为系统把动图转成了静态图
    const wantFmt = String(t.output_format || '').toLowerCase();
    let fmtWarn = '';
    if ((wantFmt === 'gif' || wantFmt === 'svg') && t.status === 'succeeded' && t.output_images.length) {
      const extOf = (n) => (String(n).split('.').pop() || '').toLowerCase();
      if (!t.output_images.some((n) => extOf(n) === wantFmt)) {
        const got = (extOf(t.output_images[0]) || '未知').toUpperCase();
        fmtWarn = `<div class="card-error">接口返回的是 ${got}，不是 ${wantFmt.toUpperCase()}：当前服务或模型可能不支持 <code>output_format: ${wantFmt}</code>（或忽略了帧参数）。图片已按实际格式保存，可在「请求 JSON 编辑」里核对参数名，或换用支持动图的模型。</div>`;
      }
    }
    const outNames = t.output_images || [];
    const fileNames = (t.status === 'succeeded' && outNames.length)
      ? `<div class="card-filenames">${outNames.map((n) => `<span>文件名：${esc(imgLabel(n))}</span>`).join('')}</div>` : '';
    const jsonBoxes = (t.status === 'succeeded' && outNames.length)
      ? `<div class="card-json">
           <details><summary>请求 JSON</summary><pre>${esc(JSON.stringify(finalRequestView(t), null, 2))}</pre></details>
           <details><summary>返回 JSON</summary><pre>${esc(JSON.stringify({
               status: t.status, output_format: t.output_format || '',
               images: outNames.map((n) => ({ name: n, data: '（图片数据已省略）' })),
               finished_at: t.finished_at || null
             }, null, 2))}</pre></details>
         </div>` : '';
    return `<div class="card-head">
        <span class="badge ${cls}"><i></i>${label}</span>
        <span class="card-time">${sub}</span>
        ${isAdmin() && t.username ? `<span class="card-mode">${esc(t.username)}</span>` : ''}
        <!-- F17：操作收进「⋯」次级菜单；data-act 委托属性与 #taskList 委托根原样保留 -->
        <div class="card-ops"><details class="card-ops-menu"><summary aria-label="任务操作">⋯ 操作</summary><div class="card-ops-list">${ops}</div></details></div>
      </div>
      <!-- F10：搜索命中高亮，按「先切片后逐段 esc」保证 HTML 转义不被破坏 -->
      <p class="card-prompt">${highlightText(t.prompt, state.q)}</p>
      <div class="card-meta">${meta}</div>
      ${refs}${images}${failPanel}${err}${fmtWarn}${fileNames}${jsonBoxes}`;
  }
  async function onCardClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, id = el.dataset.id;
    // F19：分组表头不是任务卡片，先于 t 查找处理（仍走 #taskList 事件委托根）
    if (act === 'togglegroup') {
      const key = el.dataset.group;
      if (state.collapsedGroups.has(key)) state.collapsedGroups.delete(key);
      else state.collapsedGroups.add(key);
      renderTasks();
      return;
    }
    if (act === 'copyimg') { await copyImageFile(el.dataset.name); return; }
    if (act === 'download') { await downloadOriginal(el.dataset.name); return; }
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    const idx = Number(el.dataset.idx);
    if (act === 'view') {
      const isRef = String(el.dataset.idx).startsWith('r');
      const names = isRef ? t.input_images : t.output_images;
      openLb(names || [], isRef ? Number(String(el.dataset.idx).slice(1)) : idx, id);
      return;
    }
    if (act === 'status') {
      const card = el.closest('.card');
      const panel = card ? $('.status-panel', card) : null;
      if (panel) {
        panel.classList.toggle('hidden');
        el.textContent = panel.classList.contains('hidden') ? '▸ 查看当前状态' : '▾ 收起状态';
      }
      return;
    }
    if (act === 'dlall') { await downloadTaskImages(t.output_images || []); return; }
    if (act === 'renameimg') { openRename(el.dataset.name); return; }
    if (act === 'pick') {
      // F13：Shift 连选同一任务内的图片区间
      if (e.shiftKey && state.lastPick && state.lastPick.id === id) {
        const names = t.output_images || [];
        const a = names.indexOf(state.lastPick.name), b2 = names.indexOf(el.dataset.name);
        if (a >= 0 && b2 >= 0) {
          const lo = Math.min(a, b2), hi = Math.max(a, b2);
          for (let i = lo; i <= hi; i++) state.pickedImages.add(pickKey(id, names[i]));
          state.lastPick = { id, name: el.dataset.name };
          applySelection();
          return;
        }
      }
      togglePick(id, el.dataset.name);
      state.lastPick = { id, name: el.dataset.name };
      return;
    }
    if (act === 'reuse') { reuse(t); return; }
    if (act === 'again') {
      reuse(t);
      const f = $('#taskForm');
      if (f.requestSubmit) f.requestSubmit(); else $('#btnSubmit').click();
      return;
    }
    if (act === 'copy') { copyText(t.prompt || ''); return; }
    if (act === 'zip') { await downloadSelected(id, el); return; }
    if (act === 'toi2i-all') { await useAsRefAll(id); return; }
    if (act === 'toi2i') { await useAsRef(id, idx); return; }
    if (act === 'inpaint') { await openInpaint(id, idx); return; }
    // F11 失败排查面板的三个动作：继续复用 #taskList 事件委托根，不新增监听器、不新增 API
    if (act === 'reqjson') {
      const panel = el.closest('.fail-panel');
      const det = panel ? $('.fail-req', panel) : null;
      if (det) {
        det.open = !det.open;
        if (det.open) det.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      return;
    }
    if (act === 'copyerr') { await copyText(t.error || '暂无错误信息', '错误已复制'); return; }
    if (act === 'retrysame') {
      try { await api(`/api/tasks/${id}/retry`, { method: 'POST' }); toast('已用相同参数重新提交'); tick(); }
      catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (act === 'retry') {
      try { await api(`/api/tasks/${id}/retry`, { method: 'POST' }); toast('已用相同参数重新提交'); tick(); }
      catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (act === 'del') {
      // F17：原生 confirm() 换成内联确认条；确认后仍走既有的 DELETE /api/tasks/{tid}
      if (!(await confirmInline('确定删除这个任务及其图片吗？（output/ 里的存档会保留）'))) return;
      try { await api(`/api/tasks/${id}`, { method: 'DELETE' }); tick(); }
      catch (err) { toast(err.message, 'error'); }
    }
  }
  async function copyText(s, okMsg = '提示词已复制') {
    try { await navigator.clipboard.writeText(s); toast(okMsg); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = s; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(okMsg); } catch (_) { toast('复制失败，请手动选择', 'error'); }
      ta.remove();
    }
  }




  // ---------- 配置状态 / 下载原图 / 分栏拖拽 ----------
  function syncModelSettingsSummary() {
    const el = $('#modelSettingsSummary'); if (!el) return;
    const p = $('#provider'), m = $('#model');
    const pname = (p && p.selectedOptions && p.selectedOptions[0])
      ? String(p.selectedOptions[0].textContent || '').trim() : '';
    const mname = m ? String(m.value || '').trim() : '';
    el.textContent = [pname, mname].filter(Boolean).join(' · ');
  }
  function syncConfigured() {
    const s = state.settings || {};
    const hasProvider = (state.providers || []).length > 0;
    const hasSuccess = (state.tasks || []).some((t) => t.status === 'succeeded');
    state.configured = !!(state.bootConfigured || s.api_key_set || hasProvider || hasSuccess);
    const banner = $('#configBanner');
    if (banner) banner.classList.toggle('hidden', !(isAdmin() && !state.configured));
    const empty = $('#emptyState');
    if (empty && !empty.classList.contains('hidden')) renderEmptyState(currentEmptyKind());
  }
  async function downloadOriginal(name, quiet) {
    const url = fileUrl(name);
    if (window.showSaveFilePicker) {
      try {
        const ext = (String(name).split('.').pop() || 'png').toLowerCase();
        const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
          gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
        const mime = MIME[ext];
        if (!mime) throw new Error('该格式不支持另存为');
        const h = await window.showSaveFilePicker({ suggestedName: name,
          types: [{ description: '图片', accept: { [mime]: ['.' + ext] } }] });
        const res = await fetch(url);
        if (!res.ok) throw new Error('读取失败');
        const w = await h.createWritable();
        await w.write(await res.blob());
        await w.close();
        if (!quiet) toast('已保存到所选位置');
        return;
      } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    if (!quiet) toast('已开始下载');
  }
  async function downloadTaskImages(names) {
    if (!names.length) { toast('没有可下载的图片', 'error'); return; }
    // 逐张弹出「另存为」选择文件存放位置（单张时最自然）；
    // 多张时浏览器若不再允许连续弹窗，自动降级为默认下载目录。
    for (const n of names) await downloadOriginal(n, true);
    toast(`已处理 ${names.length} 张原图`);
  }
  function bindSplitResize() {
    const pane = $('.compose'), handle = $('#splitHandle');
    if (!pane || !handle) return;
    const MIN = 320, DEFAULT_W = 420;
    const placeHandle = () => {
      if (window.innerWidth <= 920 || $('#mainWorkbench').classList.contains('hidden')) {
        handle.classList.add('hidden'); return;
      }
      const r = pane.getBoundingClientRect();
      if (!r.width) { handle.classList.add('hidden'); return; }
      handle.classList.remove('hidden');
      handle.style.left = r.right + 'px';
      handle.style.top = Math.max(64, r.top) + 'px';
      handle.style.height = Math.max(120, Math.min(r.height, window.innerHeight - r.top - 16)) + 'px';
    };
    const setW = (px) => {
      const w = Math.max(MIN, Math.min(window.innerWidth - 420, px));
      document.documentElement.style.setProperty('--compose-w', w + 'px');
      placeHandle();
      return w;
    };
    try {
      const saved = localStorage.getItem('iw_compose_w');
      if (saved) setW(parseFloat(saved) || DEFAULT_W);
    } catch (e) {}
    let dragging = false, sx = 0, sw = 0;
    const start = (x) => {
      const r = pane.getBoundingClientRect();
      dragging = true; sx = x; sw = r.width;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };
    const finish = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const w = getComputedStyle(document.documentElement).getPropertyValue('--compose-w').trim();
      try { localStorage.setItem('iw_compose_w', w); } catch (e) {}
    };
    // 可见手柄本身：18px 宽命中区，不用再精确压在 1px 线上
    handle.addEventListener('mousedown', (e) => { e.preventDefault(); start(e.clientX); });
    // 左栏右缘 ±14px 的兜底命中区
    pane.addEventListener('mousemove', (e) => {
      if (dragging || window.innerWidth <= 920) return;
      const r = pane.getBoundingClientRect();
      pane.style.cursor = (e.clientX >= r.right - 14 && e.clientX <= r.right + 14) ? 'col-resize' : '';
    });
    pane.addEventListener('mousedown', (e) => {
      if (window.innerWidth <= 920) return;
      const r = pane.getBoundingClientRect();
      if (e.clientX < r.right - 14 || e.clientX > r.right + 14) return;
      e.preventDefault(); start(e.clientX);
    });
    window.addEventListener('mousemove', (e) => { if (dragging) setW(sw + e.clientX - sx); });
    window.addEventListener('mouseup', finish);
    handle.addEventListener('dblclick', () => {
      setW(DEFAULT_W);
      try { localStorage.setItem('iw_compose_w', DEFAULT_W + 'px'); } catch (e) {}
      toast('左右栏宽度已复位');
    });
    handle.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--compose-w')) || DEFAULT_W;
      setW(cur + (e.key === 'ArrowRight' ? 20 : -20));
      try {
        localStorage.setItem('iw_compose_w',
          getComputedStyle(document.documentElement).getPropertyValue('--compose-w').trim());
      } catch (err) {}
    });
    window.addEventListener('resize', placeHandle);
    window.addEventListener('scroll', placeHandle, { passive: true });
    window.addEventListener('iw:viewchange', placeHandle);
    placeHandle();
  }
  // ---------- 批量改名 / 标签 / 灯箱缩放 ----------
  const IMG_TAG_KEY = 'iw_image_tags';
  function imgTagsOf(n) { return state.imgTags[n] || []; }
  async function renameImageOnServer(oldName, wanted) {
    const r = await api('/api/rename-file', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old: oldName, new: wanted }) });
    return r.name;
  }
  async function batchSetImgNames(pairs) {
    for (const [n, v] of pairs) {
      const val = String(v || '').trim();
      if (!val || val === n) continue;
      try {
        await renameImageOnServer(n, val);
        delete state.imgNames[n];
      } catch (e) { toast(n + '：' + e.message, 'error'); }
    }
    try { localStorage.setItem('iw_image_names', JSON.stringify(state.imgNames)); } catch (e) {}
    state.nameRev++;
    await tick();
  }
  async function migrateLegacyImgNames() {
    if (state.legacyMigrated) return;
    state.legacyMigrated = true;
    const olds = Object.keys(state.imgNames || {});
    if (!olds.length) return;
    let seq = 1;
    for (const n of olds) {
      const alias = state.imgNames[n];
      if (!alias) continue;
      try {
        await renameImageOnServer(n, alias);
        delete state.imgNames[n];
      } catch (e) {
        // 多张图起了同一个别名会撞名，自动加序号重试，避免每次打开都重复迁移
        try {
          await renameImageOnServer(n, alias + '_' + (seq++));
          delete state.imgNames[n];
        } catch (_) { /* 保留别名，下次再说 */ }
      }
    }
    try { localStorage.setItem('iw_image_names', JSON.stringify(state.imgNames)); } catch (e) {}
    await tick();
  }
  function batchSetTags(names, tag, add) {
    for (const n of names) {
      const cur = new Set(state.imgTags[n] || []);
      if (add && tag) cur.add(tag);
      else if (!add && tag) cur.delete(tag);
      else if (!add) cur.clear();
      const arr = Array.from(cur);
      if (arr.length) state.imgTags[n] = arr; else delete state.imgTags[n];
    }
    try { localStorage.setItem(IMG_TAG_KEY, JSON.stringify(state.imgTags)); } catch (e) {}
    state.nameRev++; renderTasks(); renderAssets();
  }
  function openBatchMedia() {
    const n = selectedFiles().length;
    if (!n) { toast('请先勾选图片', 'error'); return; }
    $('#bmCount').textContent = n + ' 张';
    $('#batchMediaOverlay').classList.remove('hidden');
  }
  function closeBatchMedia() { $('#batchMediaOverlay').classList.add('hidden'); }
  async function batchRename() {
    const files = selectedFiles(), tpl = $('#bmName').value.trim();
    if (!files.length) { toast('请先勾选图片', 'error'); return; }
    if (!tpl) { toast('请填写名称', 'error'); return; }
    const pairs = files.map((f, i) => [f.name,
      tpl.includes('{n}') ? tpl.replaceAll('{n}', String(i + 1)) : tpl + ' ' + (i + 1)]);
    await batchSetImgNames(pairs);
    toast('已重命名 ' + files.length + ' 张');
    closeBatchMedia();
  }
  function batchTag(add) {
    const files = selectedFiles(), tag = $('#bmTag').value.trim();
    if (!files.length) { toast('请先勾选图片', 'error'); return; }
    if (add && !tag) { toast('请填写标签', 'error'); return; }
    batchSetTags(files.map((f) => f.name), tag, add);
    toast(add ? '已给 ' + files.length + ' 张加标签' : '已清除标签');
  }
  function resetLbZoom() { state.lbZoom = { scale: 1, x: 0, y: 0 }; applyLbZoom(); }
  function applyLbZoom() {
    const im = $('#lbImage'); if (!im) return;
    const z = state.lbZoom;
    im.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.scale})`;
    const info = $('#lbZoomInfo'); if (info) info.textContent = Math.round(z.scale * 100) + '%';
  }
  function onLbWheel(e) {
    e.preventDefault();
    const z = state.lbZoom;
    z.scale = Math.max(0.5, Math.min(8, z.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    if (z.scale <= 1) { z.x = 0; z.y = 0; }
    applyLbZoom();
  }
  function bindLbDrag() {
    const im = $('#lbImage'); if (!im) return;
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    im.addEventListener('mousedown', (e) => {
      if (state.lbZoom.scale <= 1) return;
      e.preventDefault(); dragging = true;
      sx = e.clientX; sy = e.clientY; ox = state.lbZoom.x; oy = state.lbZoom.y;
      im.classList.add('lb-dragging');
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      state.lbZoom.x = ox + e.clientX - sx;
      state.lbZoom.y = oy + e.clientY - sy;
      applyLbZoom();
    });
    window.addEventListener('mouseup', () => { dragging = false; im.classList.remove('lb-dragging'); });
    im.addEventListener('dblclick', resetLbZoom);
  }
  // ---------- 默认参数（服务端 settings.ui_defaults，三套独立，全站设备共用） ----------
  const DEF_FIELDS = {
    t2i: { ratio:'#ratio', resolution:'#resolution', quality:'#quality', reasoning:'#reasoning',
           count:'#count', format:'#format', background:'#background', extra:'#extra' },
    i2i: { ratio:'#ratio', resolution:'#resolution', quality:'#quality', reasoning:'#reasoning',
           count:'#count', format:'#format', background:'#background', extra:'#extra' },
    fmt: { ratio:'#fRatio', resolution:'#fResolution', quality:'#fQuality', complexity:'#fComplexity',
           frames:'#gifFrames', duration:'#gifDuration', frameSize:'#gifFrameSize',
           svgModel:'#svgModel', svgEffort:'#svgEffort' },
  };
  const BUILTIN_DEFAULTS = {
    t2i: { ratio:'16:9', resolution:'4k', quality:'xhigh', reasoning:'high', count:'1', format:'', background:'', extra:'' },
    i2i: { ratio:'16:9', resolution:'4k', quality:'xhigh', reasoning:'high', count:'1', format:'', background:'', extra:'' },
    fmt: { ratio:'1:1', resolution:'1k', quality:'', complexity:'', frames:'9', duration:'200',
           frameSize:'', svgModel:'gpt-6.1-sol', svgEffort:'medium' },
  };
  const DEF_LABEL = { t2i:'文生图', i2i:'图生图', fmt:'GIF / SVG' };
  const defBoxId = (m) => '#def' + m.charAt(0).toUpperCase() + m.slice(1);
  function parseUiDefaults(s) {
    let v = {};
    try { v = JSON.parse((s && s.ui_defaults) || '{}'); } catch (e) {}
    state.uiDefaults = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  }
  function defaultsFor(mode) {
    const m = DEF_FIELDS[mode] ? mode : 't2i';
    return Object.assign({}, BUILTIN_DEFAULTS[m], state.uiDefaults[m] || {});
  }
  function applyDefaults(mode, obj) {
    const map = DEF_FIELDS[mode]; if (!map) return;
    for (const [k, sel] of Object.entries(map)) {
      const el = $(sel); if (el) el.value = obj[k] === undefined ? '' : String(obj[k]);
    }
  }
  function collectDefaults(mode) {
    const map = DEF_FIELDS[mode] || DEF_FIELDS.t2i, out = {};
    for (const [k, sel] of Object.entries(map)) { const el = $(sel); out[k] = el ? el.value : ''; }
    return out;
  }
  function currentDefMode() { return state.mode === 'fmt' ? 'fmt' : (state.mode === 'i2i' ? 'i2i' : 't2i'); }
  function renderDefaults() {
    ['t2i','i2i','fmt'].forEach((m) => {
      const el = $(defBoxId(m)); if (el) el.value = JSON.stringify(defaultsFor(m), null, 2);
    });
  }
  function saveDefaults() {
    const all = {};
    for (const m of ['t2i','i2i','fmt']) {
      const el = $(defBoxId(m));
      try {
        const v = JSON.parse((el && el.value) || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('须为 JSON 对象');
        all[m] = v;
      } catch (e) { toast(DEF_LABEL[m] + ' 默认参数不是合法 JSON：' + e.message, 'error'); return; }
    }
    state.uiDefaults = all;
    saveSettings(true).then((ok) => {
      if (!ok) return;
      renderDefaults();
      const m = currentDefMode();
      applyDefaults(m, defaultsFor(m));
      onParamChange();
      $('#defStatus').textContent = '已保存（全站共用）';
      toast('默认参数已保存，所有设备生效');
    });
  }
  function resetDefaults() {
    state.uiDefaults = {};
    saveSettings(true).then((ok) => {
      if (!ok) return;
      renderDefaults();
      $('#defStatus').textContent = '已恢复内置默认';
      toast('已恢复内置默认参数');
    });
  }
  function fillDefFromPanel() {
    const m = currentDefMode(), el = $(defBoxId(m));
    if (el) el.value = JSON.stringify(collectDefaults(m), null, 2);
    $('#defStatus').textContent = '已填入「' + DEF_LABEL[m] + '」当前参数，记得点保存';
  }
  // 排队 / 生成中：点击展开当前状态明细（数据全部来自 state.tasks，不新增 API）
  function statusPanelHTML(t) {
    const rows = [
      ['当前状态', STATUS[t.status] ? STATUS[t.status][0] : t.status],
      ['模型', t.model],
      ['模式', t.mode === 'i2i' ? '图生图' : (t.mode === 'fmt' ? 'GIF / SVG' : '文生图')],
      ['尺寸', t.size], ['画质', t.quality], ['数量', t.n],
      ['服务商', t.provider_name], ['重试次数', t.attempts],
      ['提交时间', fmtTime(t.created_at)],
    ];
    const body = rows.filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    return `<div class="status-panel hidden"><div class="status-grid">${body}</div>
      <p class="status-prompt">${esc(String(t.prompt || '').slice(0, 400))}</p></div>`;
  }
  // ---------- 图片：复制 / 显示名 / 右键菜单（纯前端） ----------
  // 显示名只存在 localStorage：不改 out_ 文件名、不动 API/DB、不动 output/ 存档，
  // 避免破坏 FILENAME_RE / file_owner() 反查 / 图片 URL 这套文件命名契约。
  const IMG_NAME_KEY = 'iw_image_names';
  function imgName(n) { return state.imgNames[n] || ''; }
  function imgLabel(n) { return imgName(n) || String(n || ''); }
  async function setImgName(n, v) { await batchSetImgNames([[n, v]]); }
  function paramsText(t) {
    const rows = [
      ['模型', t.model],
      ['模式', t.mode === 'i2i' ? '图生图' : (t.mode === 'fmt' ? 'GIF / SVG' : '文生图')],
      ['尺寸', t.size], ['画质', t.quality], ['数量', t.n],
      ['输出格式', t.output_format], ['深度规划', t.reasoning_effort],
      ['服务商', t.provider_name], ['提示词', t.prompt],
    ];
    const lines = rows.filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}：${v}`);
    const rj = t.request_json || t.params;
    if (rj && typeof rj === 'object' && Object.keys(rj).length) {
      lines.push('\n请求体：\n' + JSON.stringify(rj, null, 2));
    }
    return lines.join('\n');
  }
  async function copyImageFile(name) {
    if (!navigator.clipboard || !window.ClipboardItem) {
      toast('当前环境不支持复制图片，请用下载', 'error'); return;
    }
    try {
      const res = await fetch(fileUrl(name));
      if (!res.ok) throw new Error('读取图片失败');
      let blob = await res.blob();
      if (!/image\/png/i.test(blob.type)) {
        const url = URL.createObjectURL(blob);
        try {
          const im = new Image(); im.src = url; await im.decode();
          const cv = document.createElement('canvas');
          cv.width = im.naturalWidth || 1024; cv.height = im.naturalHeight || 1024;
          cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
          blob = await new Promise((ok, no) =>
            cv.toBlob((b) => b ? ok(b) : no(new Error('转换为 PNG 失败')), 'image/png'));
        } finally { URL.revokeObjectURL(url); }
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('原图已复制到剪贴板');
    } catch (err) { toast('复制失败：' + err.message, 'error'); }
  }
  function hideCtxMenu() {
    const m = $('#imgCtxMenu');
    if (m) m.classList.add('hidden');
    state.ctxTarget = null;
  }
  function onImgContextMenu(e) {
    const tile = e.target.closest('[data-img-name]');
    if (!tile) { hideCtxMenu(); return; }
    e.preventDefault();
    state.ctxTarget = { name: tile.dataset.imgName, id: tile.dataset.taskId };
    const m = $('#imgCtxMenu');
    m.classList.remove('hidden');
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(e.clientX, window.innerWidth - w - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(e.clientY, window.innerHeight - h - 8)) + 'px';
  }
  async function onCtxAction(act) {
    const c = state.ctxTarget;
    hideCtxMenu();
    if (!c) return;
    if (act === 'copyimg') { await copyImageFile(c.name); return; }
    if (act === 'download') { await downloadOriginal(c.name); return; }
    const t = state.tasks.find((x) => x.id === c.id);
    if (!t) return;
    if (act === 'copyparams') { await copyText(paramsText(t), '参数已复制'); return; }
    if (act === 'reuse') { reuse(t); return; }
    if (act === 'copyprompt') { await copyText(t.prompt || '', '提示词已复制'); return; }
    if (act === 'rename') { openRename(c.name); return; }
    if (act === 'del') {
      if (!(await confirmInline('确定删除这个任务及其全部图片吗？（output/ 存档会保留）'))) return;
      try { await api(`/api/tasks/${c.id}`, { method: 'DELETE' }); tick(); }
      catch (err) { toast(err.message, 'error'); }
    }
  }
  function openRename(name) {
    state.renameTarget = name;
    $('#renameInput').value = imgLabel(name);
    $('#renameOrigName').textContent = '文件名：' + name;
    $('#renameOverlay').classList.remove('hidden');
    $('#renameInput').focus(); $('#renameInput').select();
  }
  function closeRename() {
    $('#renameOverlay').classList.add('hidden');
    state.renameTarget = '';
  }
  async function saveRename() {
    const n = state.renameTarget;
    if (!n) return;
    const btn = $('#btnRenameOk'); if (btn) btn.disabled = true;
    try { await setImgName(n, $('#renameInput').value); closeRename(); }
    finally { if (btn) btn.disabled = false; }
  }
  // onlyTask 非空时只打包该任务里勾选的图片；为空时打包全局勾选的图片。
  // 没有勾选就明确提示，不再默认把全部图片打包进去。
  async function downloadSelected(onlyTask, triggerBtn) {
    const files = selectedFiles(onlyTask || null);
    if (!files.length) {
      toast(onlyTask ? '请先在这个任务里勾选要打包的图片' : '请先勾选图片右上角的「选择」，再点打包选中', 'error');
      return;
    }
    // 从卡片点「打包选中」时只改卡片按钮的状态，别去动顶部按钮（旧版会错改顶部）
    const btn = triggerBtn || $('#btnDownloadAll');
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '打包中…'; }
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (state.accessKey) headers['X-Access-Key'] = state.accessKey;
      const res = await fetch('/api/tasks/download', {
        method: 'POST', headers, body: JSON.stringify({ files }), credentials: 'same-origin',
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || '打包失败'); }
      const blob = await res.blob(), url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'images-selected.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast(`已打包 ${files.length} 张勾选的图片`);
    } catch (e) { toast(e.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = old || '打包选中'; } }
  }
  // 删除已勾选的图片（任务页 / 资产库共用）：物理删除 + 引用清理 + output 存档同步。
  async function deleteSelected() {
    const files = selectedFiles(null);
    if (!files.length) {
      toast('请先勾选图片右上角的「选择」，再点删除已选', 'error');
      return;
    }
    if (!(await confirmInline(`确定删除已勾选的 ${files.length} 张图片？图片文件将被物理删除且不可恢复（output/ 存档同步清理，不影响其他用户）。`))) return;
    const names = files.map((f) => f.name);
    const btn = $('#btnDeleteSelected');
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '删除中…'; }
    try {
      const r = await api('/api/delete-images', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      const removed = (r.removed || []).length;
      const skipped = (r.skipped || []).length;
      names.forEach((n) => state.pickedImages.forEach((k) => {
        if (k.endsWith('|' + n)) state.pickedImages.delete(k);
      }));
      applySelection();
      await tick();
      toast(skipped ? `已删除 ${removed} 张，${skipped} 张因权限跳过` : `已删除 ${removed} 张图片`);
    } catch (e) { toast(e.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = old || '🗑 删除已选'; } }
  }
  function reuse(t) {
    const rj = t.request_json && Object.keys(t.request_json).length ? t.request_json : {};
    const rjFmt = String(rj.output_format || t.output_format || '').toLowerCase();
    const isFmt = rjFmt === 'gif' || rjFmt === 'svg';
    setMode(isFmt ? 'fmt' : (t.mode === 'i2i' ? 'i2i' : 't2i'), true);
    $('#model').value = rj.model || t.model || '';
    $('#prompt').value = rj.prompt || t.prompt || '';
    state.promptBeforeOptimize = null; updateOptimizeBtn();
    const size = rj.size || t.size || '';
    state.sizeOverride = isFmt ? '' : size;
    if (isFmt) {
      state.fmtKind = rjFmt;
      $$('#fmtSeg button').forEach((b) => b.classList.toggle('active', b.dataset.fmt === rjFmt));
      $('#fRatio').value = RATIO_WH[rj.aspect_ratio] ? rj.aspect_ratio : FMT_DEFAULTS.ratio;
      $('#fResolution').value = ['1k', '2k', '4k'].includes(rj.resolution) ? rj.resolution : FMT_DEFAULTS.resolution;
      $('#fQuality').value = rj.quality || '';
      $('#fComplexity').value = ['low', 'medium', 'high'].includes(rj.complexity) ? rj.complexity : '';
      $('#gifFrames').value = String(clampInt(rj.frame_count, 2, 16, 9));
      $('#gifDuration').value = String(clampInt(rj.frame_duration_ms, 20, 2000, 200));
      const fs = String(rj.frame_size || ''), known = ['', '512x512', '720x720', '768x768'];
      $('#gifFrameSize').value = known.includes(fs) ? fs : (fs ? 'custom' : '');
      $('#gifFrameSizeCustom').value = fs && !known.includes(fs) ? fs : '';
      const svgObj = (rj.svg && typeof rj.svg === 'object') ? rj.svg : {};
      $('#svgModel').value = svgObj.model || FMT_DEFAULTS.svgModel;
      const ef = svgObj.reasoning ? svgObj.reasoning.effort : '';
      $('#svgEffort').value = ['', 'low', 'medium', 'high'].includes(ef || '') ? (ef || '') : FMT_DEFAULTS.svgEffort;
      $('#format').value = '';
    } else {
      let hit = null;
      for (const [ratio, tbl] of Object.entries(SIZE_TABLE)) {
        for (const [res, val] of Object.entries(tbl)) if (val === size) hit = { ratio, res };
      }
      if (hit) { $('#ratio').value = hit.ratio; $('#resolution').value = hit.res; state.sizeOverride = ''; }
      else if (size) { $('#ratio').value = 'custom'; $('#ratioCustom').value = size; }
      $('#quality').value = rj.quality || 'auto';
      $('#reasoning').value = rj.reasoning_effort || '';
      $('#count').value = String(rj.n || t.n || 1);
      $('#format').value = rj.output_format || t.output_format || '';
      $('#background').value = rj.background || '';
    }
    const extra = {};
    for (const [k, v] of Object.entries(rj)) if (!BODY_KEYS.has(k)) extra[k] = v;
    $('#extra').value = Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '';
    if (t.provider_id) $('#provider').value = t.provider_id;
    $('#reqJson').value = JSON.stringify(rj, null, 2);
    state.reqJsonEdited = !!Object.keys(rj).length;
    $('#reqJsonStatus').textContent = state.reqJsonEdited ? '复用任务的原请求 JSON（改面板参数将按面板重建）' : '';
    applyFormatConstraints(); onParamChange();
    toast('参数已回填' + (t.mode === 'i2i' ? '，参考图需重新选择' : (isFmt ? '（GIF / SVG 面板）' : '')));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function clearFinished() {
    if (!(await confirmInline('清空「我自己」已完成 / 失败的任务及其图片？此操作不可撤销（output/ 存档保留，不会影响其他用户）。'))) return;
    try { await api('/api/tasks?scope=finished', { method: 'DELETE' }); toast('已清空'); tick(); }
    catch (e) { toast(e.message, 'error'); }
  }

  // ------------------------------ 灯箱 ------------------------------
  function openLb(names, idx, taskId) {
    if (!names || !names.length) return;
    state.lb = { names, idx: Math.max(0, Math.min(names.length - 1, idx || 0)), taskId: taskId || null };
    $('#lightbox').classList.remove('hidden');
    paintLb();
  }
  async function paintLb() {
    const { names, idx } = state.lb;
    const name = names[idx];
    $('#lbImage').src = fileUrl(name);
    resetLbZoom();
    const isVec = /\.(gif|svg)$/i.test(name || '');
    $('#lbToI2i').classList.toggle('hidden', isVec);
    $('#lbInpaint').classList.toggle('hidden', isVec);
    $('#lbIndex').textContent = `${idx + 1} / ${names.length}`;
    const a = $('#lbDownload'); a.href = fileUrl(name); a.setAttribute('download', name);
    $('#lbPrev').classList.toggle('hidden', names.length < 2);
    $('#lbNext').classList.toggle('hidden', names.length < 2);
    $('#lbMeta').textContent = '读取参数中…';
    try {
      const m = await api('/api/files/' + encodeURIComponent(name) + '/meta');
      $('#lbMeta').textContent = `${m.format} · ${m.width && m.height ? m.width + ' × ' + m.height : '尺寸未知'} · ${humanSize(m.bytes || 0)}`;
    } catch (e) { $('#lbMeta').textContent = '参数读取失败'; }
  }
  function lbStep(d) {
    const n = state.lb.names.length;
    if (n < 2) return;
    state.lb.idx = (state.lb.idx + d + n) % n;
    paintLb();
  }
  function closeLb() { $('#lightbox').classList.add('hidden'); $('#lbImage').src = ''; resetLbZoom(); }
  // 切到图生图但保留当前提示词与已上传的参考图：
  // 原来 setMode('i2i') 不带 skipReset，会走 resetForm 把提示词和参考图一起清空。
  function ensureI2iMode() {
    if (state.mode !== 'i2i') setMode('i2i', true);
  }
  async function useAsRef(id, idx) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t || !t.output_images[idx]) return;
    if (/\.(gif|svg)$/i.test(t.output_images[idx])) { toast('GIF / SVG 不能作为参考图', 'error'); return; }
    closeLb();
    ensureI2iMode();
    await addRemoteRef(t.output_images[idx]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  // 任务卡片顶部常驻按钮：把该任务所有生成图加入图生图参考图（受 8 张上限约束）。
  async function useAsRefAll(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t || !(t.output_images || []).length) return;
    const all = t.output_images || [];
    const names = all.filter((n) => !isNonBitmap(n));
    if (!names.length) { toast('GIF / SVG 不能作为参考图', 'error'); return; }
    ensureI2iMode();
    let added = 0, skipped = all.length - names.length;
    for (const name of names) {
      if (state.files.length >= 8) { skipped++; continue; }
      const ok = await addRemoteRef(name);
      if (ok) added++; else skipped++;
    }
    if (skipped) toast(`已加入 ${added} 张参考图，另有 ${skipped} 张被跳过（格式不支持或超出 8 张上限）`, 'error');
    else toast(`已加入 ${added} 张图生图参考图`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function lbToI2i() { useAsRef(state.lb.taskId, state.lb.idx); }
  function lbInpaint() {
    closeLb();
    openInpaint(state.lb.taskId, state.lb.idx);
  }

  // ------------------------------ 局部修图 ------------------------------
  async function openInpaint(id, idx) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t || !t.output_images[idx]) return;
    const name = t.output_images[idx];
    if (/\.(gif|svg)$/i.test(name)) { toast('GIF / SVG 不支持局部修图', 'error'); return; }
    try {
      const res = await fetch(fileUrl(name), { credentials: 'same-origin' });
      if (!res.ok) throw new Error('图片读取失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      state.inpaint = { taskId: id, name, blob, url, tool: 'brush', drawing: false,
                        start: null, last: null, snapshot: null, hasPaint: false };
      $$('#ipTools button').forEach((x) => x.classList.toggle('active', x.dataset.tool === 'brush'));
      $('#ipPrompt').value = '';
      $('#ipInfo').textContent = '载入中…';
      $('#inpaintOverlay').classList.remove('hidden');
      const img = $('#ipImage');
      img.onload = () => {
        const c = $('#ipCanvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').clearRect(0, 0, c.width, c.height);
        $('#ipInfo').textContent = `原图 ${c.width} × ${c.height}`;
      };
      img.src = url;
    } catch (e) { toast(e.message, 'error'); }
  }
  function closeInpaint() {
    $('#inpaintOverlay').classList.add('hidden');
    if (state.inpaint.url) { URL.revokeObjectURL(state.inpaint.url); state.inpaint.url = null; }
  }
  function ipPos(e) {
    const c = $('#ipCanvas'), r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height };
  }
  function ipCtx() { return $('#ipCanvas').getContext('2d', { willReadFrequently: true }); }
  function ipStyle(ctx, erase) {
    ctx.lineWidth = Number($('#ipBrush').value) || 40;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (erase) { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; ctx.fillStyle = 'rgba(0,0,0,1)'; }
    else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = 'rgba(255,70,90,0.45)'; ctx.fillStyle = 'rgba(255,70,90,0.45)'; }
  }
  function ipDot(p, erase) {
    const ctx = ipCtx(); ipStyle(ctx, erase);
    ctx.beginPath(); ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
    state.inpaint.hasPaint = true;
  }
  function ipLine(a, b, erase) {
    const ctx = ipCtx(); ipStyle(ctx, erase);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    state.inpaint.hasPaint = true;
  }
  function ipShape(a, b) {
    const ctx = ipCtx(); ipStyle(ctx, false);
    ctx.beginPath();
    if (state.inpaint.tool === 'rect') ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    else {
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      ctx.ellipse(cx, cy, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
    }
    ctx.fill();
    state.inpaint.hasPaint = true;
  }
  function bindCanvas() {
    const c = $('#ipCanvas');
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault(); c.setPointerCapture(e.pointerId);
      const ip = state.inpaint, p = ipPos(e), ctx = ipCtx();
      ip.drawing = true; ip.start = p; ip.last = p;
      if (ip.tool === 'brush' || ip.tool === 'eraser') ipDot(p, ip.tool === 'eraser');
      else ip.snapshot = ctx.getImageData(0, 0, c.width, c.height);
    });
    c.addEventListener('pointermove', (e) => {
      const ip = state.inpaint;
      if (!ip.drawing) return;
      e.preventDefault();
      const p = ipPos(e);
      if (ip.tool === 'brush' || ip.tool === 'eraser') { ipLine(ip.last, p, ip.tool === 'eraser'); ip.last = p; }
      else if (ip.snapshot) { ipCtx().putImageData(ip.snapshot, 0, 0); ipShape(ip.start, p); }
    });
    const end = (e) => {
      const ip = state.inpaint;
      if (!ip.drawing) return;
      if ((ip.tool === 'rect' || ip.tool === 'ellipse') && ip.snapshot) {
        ipCtx().putImageData(ip.snapshot, 0, 0); ipShape(ip.start, ipPos(e));
      }
      ip.drawing = false; ip.snapshot = null; ip.last = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }
  function clearCanvas() {
    const c = $('#ipCanvas');
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    state.inpaint.hasPaint = false;
  }
  function maskBlob() {
    const c = $('#ipCanvas'), src = ipCtx().getImageData(0, 0, c.width, c.height);
    const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    const t = tmp.getContext('2d');
    t.fillStyle = '#000'; t.fillRect(0, 0, tmp.width, tmp.height);
    const out = t.getImageData(0, 0, tmp.width, tmp.height);
    for (let i = 0; i < src.data.length; i += 4) {
      if (src.data[i + 3] > 10) { out.data[i] = 255; out.data[i + 1] = 255; out.data[i + 2] = 255; }
    }
    t.putImageData(out, 0, 0);
    return new Promise((r) => tmp.toBlob(r, 'image/png'));
  }
  async function submitInpaint() {
    const prompt = $('#ipPrompt').value.trim();
    if (!prompt) { toast('请写下圈选区域要变成什么', 'error'); return; }
    if (!state.inpaint.hasPaint) { toast('请先用画笔或框选涂出要重绘的区域', 'error'); return; }
    const mask = await maskBlob();
    if (!mask) { toast('遮罩生成失败', 'error'); return; }
    const body = buildRequestJson(prompt);
    delete body.output_format;
    delete body.quality;
    const fd = new FormData();
    fd.append('mode', 'i2i');
    fd.append('model', String(body.model || defaultModel()));
    fd.append('prompt', prompt);
    fd.append('size', String(body.size || computeSize()));
    fd.append('quality', $('#quality').value);
    fd.append('n', $('#count').value);
    fd.append('output_format', '');
    fd.append('params', '{}');
    fd.append('request_json', JSON.stringify(body));
    fd.append('provider_id', $('#provider').value);
    fd.append('images', state.inpaint.blob, 'inpaint_source.png');
    fd.append('mask', mask, 'mask.png');
    const btn = $('#btnIpSubmit'); btn.disabled = true; btn.textContent = '提交中…';
    try {
      await api('/api/tasks', { method: 'POST', body: fd });
      toast('局部修图已加入队列');
      closeInpaint();
      resetForm();
      tick();
    } catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '生成局部修图'; }
  }

  // ------------------------------ 设置（管理员） ------------------------------
  function switchTab(tab) {
    $$('#settingsTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.tab-page').forEach((p) => p.classList.toggle('hidden', p.dataset.page !== tab));
  }
  async function openSettings(tab) {
    if (!isAdmin()) { toast('仅管理员可用', 'error'); return; }
    $('#settingsOverlay').classList.remove('hidden');
    switchTab(tab || 'image');
    try {
      await Promise.all([loadSettings(), loadProviders(), loadPresets()]);
    renderDefaults();
      const s = state.settings;
      $('#sApiBase').value = s.api_base || '';
      $('#sApiKey').value = '';
      $('#sApiKey').placeholder = s.api_key_set ? '已配置（留空表示不修改）' : '留空表示不修改';
      $('#sApiKeyHint').textContent = s.api_key_set ? '密钥已保存且不可见；填 - 可清空' : '密钥保存后不可见';
      $('#sModels').value = s.models || '';
      $('#sI2iMode').value = s.i2i_mode || 'edits';
      $('#sEditField').value = s.edit_field || 'image[]';
      $('#sMaskField').value = s.mask_field || 'mask';
      $('#sConcurrency').value = String(s.concurrency || 1);
      $('#sTimeout').value = s.timeout || 600;
      $('#sAutoRetry').value = String(s.auto_retry || 0);
      $('#sGenPath').value = s.generate_path || '';
      $('#sEditPath').value = s.edit_path || '';
      $('#sAccessKey').value = '';
      $('#sAccessKey').placeholder = s.access_key_set ? '已设置（留空表示不修改）' : '留空表示不启用';
      $('#sAccessKeyHint').textContent = '开启后所有设备访问都需要密码；填 - 关闭';
      $('#sLlmBase').value = s.llm_api_base || '';
      $('#sLlmKey').value = '';
      $('#sLlmKey').placeholder = s.llm_api_key_set ? '已配置（留空表示不修改）' : '留空表示不修改';
      $('#sLlmKeyHint').textContent = s.llm_api_key_set ? '密钥已保存且不可见；填 - 可清空' : '留空则复用图片服务的 Key';
      $('#sLlmModel').value = s.llm_model || 'gpt-4o-mini';
      $('#sLlmTimeout').value = s.llm_timeout || 120;
      $('#sLlmPromptT2i').value = s.llm_system_prompt_t2i || RECOMMENDED_OPTIMIZE.t2i;
      $('#sLlmPromptI2i').value = s.llm_system_prompt_i2i || RECOMMENDED_OPTIMIZE.i2i;
      renderProviderLists();
      renderPresetList();
      await loadUsers();
    } catch (e) { toast(e.message, 'error'); }
  }
  function settingsPayload() {
    return {
      api_base: $('#sApiBase').value.trim(), api_key: $('#sApiKey').value,
      models: $('#sModels').value.trim(), i2i_mode: $('#sI2iMode').value,
      edit_field: $('#sEditField').value, mask_field: $('#sMaskField').value.trim() || 'mask',
      concurrency: $('#sConcurrency').value, timeout: $('#sTimeout').value,
      auto_retry: $('#sAutoRetry').value, generate_path: $('#sGenPath').value.trim(),
      edit_path: $('#sEditPath').value.trim(), access_key: $('#sAccessKey').value,
      llm_api_base: $('#sLlmBase').value.trim(), llm_api_key: $('#sLlmKey').value,
      llm_model: $('#sLlmModel').value.trim(), llm_timeout: $('#sLlmTimeout').value,
      llm_system_prompt_t2i: $('#sLlmPromptT2i').value,
      llm_system_prompt_i2i: $('#sLlmPromptI2i').value,
      // 兼容旧版 / 额外语言服务读取的单一指令字段：同步为文生图指令
      llm_system_prompt: $('#sLlmPromptT2i').value,
      ui_defaults: JSON.stringify(state.uiDefaults || {}),
    };
  }
  async function saveSettings(quiet) {
    const payload = settingsPayload();
    try {
      await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const k = payload.access_key;
      if (k === '-') { localStorage.removeItem('iw_access_key'); state.accessKey = ''; }
      else if (k) { state.accessKey = k; localStorage.setItem('iw_access_key', k); }
      await loadSettings();
      syncConfigured();
      $('#sApiKey').value = ''; $('#sAccessKey').value = ''; $('#sLlmKey').value = '';
      $('#sApiKey').placeholder = state.settings.api_key_set ? '已配置（留空表示不修改）' : '留空表示不修改';
      $('#sAccessKey').placeholder = state.settings.access_key_set ? '已设置（留空表示不修改）' : '留空表示不启用';
      $('#sLlmKey').placeholder = state.settings.llm_api_key_set ? '已配置（留空表示不修改）' : '留空表示不修改';
      if (!quiet) toast('设置已保存');
      refreshModelList(); tick();
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  }
  async function testConnection() {
    const btn = $('#btnTest'); btn.disabled = true; btn.textContent = '测试中…';
    try {
      await saveSettings(true);
      const r = await api('/api/settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      toast(r.message, r.ok ? '' : 'error');
    } catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '测试图片接口'; }
  }

  // WorkBuddy 风格模型行：菱形徽标 + 名称/标签 + 副标题，右侧一组图标操作。
  // 列表行用 data-pa（沿用既有 bindProviderActions），默认卡片行用 data-ma（单独委托）。
  function modelRowHTML(o) {
    const attr = o.pid ? 'pa' : 'ma';
    return `<div class="model-row${o.isDefault ? ' is-default' : ''}"${o.pid ? ` data-pid="${esc(o.pid)}" data-kind="${esc(o.kind || '')}"` : ''}>
      <span class="model-ico" aria-hidden="true">◇</span>
      <div class="model-main">
        <div class="model-name">${esc(o.name)}<span class="model-badge${o.isDefault ? ' default' : ''}">${esc(o.badge || '自定义')}</span></div>
        <div class="model-sub">${esc(o.sub || '')}</div>
      </div>
      <div class="model-ops">${(o.ops || []).map((x) =>
        `<button type="button" class="model-op${x.danger ? ' danger' : ''}" data-${attr}="${esc(x.a)}" title="${esc(x.title)}" aria-label="${esc(x.title)}">${x.icon}</button>`).join('')}</div>
      ${o.extra || ''}
    </div>`;
  }

  // 「默认图片服务 / 默认语言模型」重建为模型卡片：一眼看到当前默认是谁、能否连通、怎么改
  function renderDefaultModelCards() {
    const s = state.settings || {};
    const defImg = imageProviders().find((p) => p.is_default);
    const defLlm = llmProviders().find((p) => p.is_default);
    const imgBox = $('#defaultImageCard'), llmBox = $('#defaultLlmCard');
    if (imgBox) {
      const c = defImg ? (defImg.config || {}) : {};
      const sub = defImg
        ? `${c.api_base || '未填地址'} · ${String(c.models || '').slice(0, 56)}`
        : `${s.api_base || '未填地址'} · ${String(s.models || '').split(',')[0] || '未配置模型'} · ${s.api_key_set ? 'Key 已配置' : 'Key 未配置'}`;
      imgBox.innerHTML = modelRowHTML({
        name: defImg ? defImg.name : '系统默认服务',
        badge: defImg ? '自定义' : '内置', isDefault: true, sub,
        ops: [
          { a: 'edit-image', icon: '✎', title: '编辑默认图片服务配置' },
          { a: 'test-image', icon: '⛓', title: '测试图片接口' },
          { a: 'goto-image', icon: '☆', title: '管理 / 切换已添加的图片服务' },
        ],
      });
    }
    if (llmBox) {
      const c = defLlm ? (defLlm.config || {}) : {};
      const sub = defLlm
        ? `${c.api_base || '未填地址'} · ${c.model || '未配置模型'}${c.api_key_set ? ' · Key 已配置' : ''}`
        : `${s.llm_api_base || s.api_base || '复用图片服务地址'} · ${s.llm_model || 'gpt-4o-mini'}${s.llm_api_key_set || s.api_key_set ? ' · Key 已配置' : ''}`;
      llmBox.innerHTML = modelRowHTML({
        name: defLlm ? defLlm.name : '系统默认语言模型',
        badge: defLlm ? '自定义' : '内置', isDefault: true, sub,
        ops: [
          { a: 'edit-llm', icon: '✎', title: '编辑默认语言模型配置' },
          { a: 'test-llm', icon: '⛓', title: '测试语言模型' },
          { a: 'goto-llm', icon: '☆', title: '管理 / 切换已添加的语言服务' },
        ],
      });
    }
  }

  function bindDefaultModelCards() {
    const handler = (e) => {
      const b = e.target instanceof Element ? e.target.closest('[data-ma]') : null;
      if (!b) return;
      const a = b.dataset.ma;
      const jump = (id) => { const el = $('#' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
      if (a === 'edit-image') { jump('sApiBase'); $('#sApiBase')?.focus(); }
      else if (a === 'edit-llm') { jump('sLlmModel'); $('#sLlmModel')?.focus(); }
      else if (a === 'test-image') $('#btnTest')?.click();
      else if (a === 'test-llm') $('#btnTestLlm')?.click();
      else if (a === 'goto-image') jump('secProviders');
      else if (a === 'goto-llm') jump('secLlm');
    };
    ['#defaultImageCard', '#defaultLlmCard'].forEach((s) => {
      const el = $(s); if (el) el.addEventListener('click', handler);
    });
  }

  function renderProviderLists() {
    const img = imageProviders(), llms = llmProviders();
    $('#imageProviderList').innerHTML = img.length ? img.map((p) => {
      const c = p.config || {};
      return modelRowHTML({
        pid: p.id, kind: 'image', isDefault: !!p.is_default, name: p.name,
        sub: `${c.api_base || '未填地址'} · ${String(c.models || '').slice(0, 60)} · ${c.api_key_set ? 'Key 已配置' : 'Key 未配置'}`,
        ops: [
          { a: 'default', icon: '★', title: '设为默认' },
          { a: 'edit', icon: '✎', title: '编辑' },
          { a: 'fetch', icon: '⛓', title: '测试并拉取模型' },
          { a: 'del', icon: '✕', title: '删除', danger: true },
        ],
        extra: `<div class="add-box hidden">
          <div class="grid2">
            <div class="field"><label>名称</label><input data-pf="name" value="${esc(p.name)}"></div>
            <div class="field"><label>API 地址</label><input data-pf="api_base" value="${esc(c.api_base || '')}"></div>
            <div class="field"><label>API Key（留空不修改）</label><input data-pf="api_key" type="password" autocomplete="new-password"></div>
            <div class="field"><label>模型列表</label><input data-pf="models" value="${esc(c.models || '')}"></div>
          </div>
          <button class="ghost-btn" type="button" data-pa="fetch">↻ 拉取模型</button>
          <button class="ghost-btn" type="button" data-pa="save">保存修改</button>
        </div>`,
      });
    }).join('') : '<div class="model-tip">还没有额外图片服务。默认服务用上面的系统设置；也可以在下面添加多个中转 / 官方服务。</div>';
    $('#llmProviderList').innerHTML = llms.length ? llms.map((p) => {
      const c = p.config || {};
      return modelRowHTML({
        pid: p.id, kind: 'llm', isDefault: !!p.is_default, name: p.name,
        sub: `${c.api_base || '未填地址'} · ${c.model || ''} · ${c.api_key_set ? 'Key 已配置' : 'Key 未配置'}`,
        ops: [
          { a: 'default', icon: '★', title: '设为默认' },
          { a: 'edit', icon: '✎', title: '编辑' },
          { a: 'fetch', icon: '⛓', title: '测试并拉取模型' },
          { a: 'del', icon: '✕', title: '删除', danger: true },
        ],
        extra: `<div class="add-box hidden">
          <div class="grid2">
            <div class="field"><label>名称</label><input data-pf="name" value="${esc(p.name)}"></div>
            <div class="field"><label>API 地址</label><input data-pf="api_base" value="${esc(c.api_base || '')}"></div>
            <div class="field"><label>API Key（留空不修改）</label><input data-pf="api_key" type="password" autocomplete="new-password"></div>
            <div class="field"><label>模型</label><input data-pf="model" value="${esc(c.model || '')}"></div>
          </div>
          <div class="field"><label>系统指令</label><textarea data-pf="system_prompt" rows="2">${esc(c.system_prompt || '')}</textarea></div>
          <button class="ghost-btn" type="button" data-pa="fetch">↻ 拉取模型</button>
          <button class="ghost-btn" type="button" data-pa="save">保存修改</button>
        </div>`,
      });
    }).join('') : '<div class="model-tip">还没有额外语言服务。默认语言模型用上面的系统设置。</div>';
    renderDefaultModelCards();
    bindProviderActions();
  }
  function bindProviderActions() {
    $$('#imageProviderList .model-row, #llmProviderList .model-row').forEach((item) => {
      const pid = item.dataset.pid;
      $$('[data-pa]', item).forEach((b) => b.addEventListener('click', async () => {
        const act = b.dataset.pa;
        if (act === 'edit') { $('.add-box', item).classList.toggle('hidden'); return; }
        if (act === 'fetch') {
          const kind = item.dataset.kind;
          await fetchModelsInto({
            btn: b, providerId: pid, kind, single: kind === 'llm',
            baseEl: $('[data-pf="api_base"]', item),
            keyEl: $('[data-pf="api_key"]', item),
            target: $(`[data-pf="${kind === 'image' ? 'models' : 'model'}"]`, item),
          });
          return;
        }
        if (act === 'del') {
          if (!(await confirmInline('删除这个服务？已生成的任务和图片不受影响。'))) return;
          try { await api('/api/providers/' + pid, { method: 'DELETE' }); state.providers = (await api('/api/providers')).items; fillProviders(); renderProviderLists(); toast('已删除'); }
          catch (e) { toast(e.message, 'error'); }
          return;
        }
        if (act === 'default') {
          try { await api('/api/providers/' + pid, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_default: true }) }); state.providers = (await api('/api/providers')).items; fillProviders(); renderProviderLists(); toast('已设为默认'); }
          catch (e) { toast(e.message, 'error'); }
          return;
        }
        if (act === 'save') {
          const cfg = {};
          $$('[data-pf]', item).forEach((inp) => { cfg[inp.dataset.pf] = inp.value; });
          try {
            await api('/api/providers/' + pid, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: cfg.name, config: cfg }) });
            state.providers = (await api('/api/providers')).items;
            fillProviders(); renderProviderLists(); toast('服务已保存');
          } catch (e) { toast(e.message, 'error'); }
        }
      }));
    });
  }
  async function addImageProvider() {
    const name = $('#ipName').value.trim(), base = $('#ipBase').value.trim(),
      key = $('#ipKey').value, models = $('#ipModels').value.trim();
    if (!name || !base) { toast('请填写服务名称和 API 地址', 'error'); return; }
    try {
      await api('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'image', name, config: { api_base: base, api_key: key, models } }) });
      ['#ipName', '#ipBase', '#ipKey', '#ipModels'].forEach((s) => { $(s).value = ''; });
      await loadProviders(); fillProviders(); renderProviderLists(); toast('图片服务已添加');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function addLlmProvider() {
    const name = $('#lpName').value.trim(), base = $('#lpBase').value.trim(),
      key = $('#lpKey').value, model = $('#lpModel').value.trim(), prompt = $('#lpPrompt').value;
    if (!name || !base) { toast('请填写服务名称和 API 地址', 'error'); return; }
    try {
      await api('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'llm', name, config: { api_base: base, api_key: key, model, system_prompt: prompt } }) });
      ['#lpName', '#lpBase', '#lpKey', '#lpModel', '#lpPrompt'].forEach((s) => { $(s).value = ''; });
      await loadProviders(); fillProviders(); renderProviderLists(); toast('语言服务已添加');
    } catch (e) { toast(e.message, 'error'); }
  }
  function renderPresetList() {
    $('#presetList').innerHTML = state.presets.length ? state.presets.map((p) =>
      `<div class="manage-item" data-id="${esc(p.id)}">
        <input data-f="name" value="${esc(p.name)}" style="max-width:150px">
        <input data-f="content" value="${esc(p.content)}" style="flex:1;min-width:180px">
        <button class="ghost-btn" type="button" data-a="save">保存</button>
        <button class="ghost-btn" type="button" data-a="del">删除</button>
      </div>`).join('') : '<p class="tip">还没有预设，可在下方添加。</p>';
    $$('#presetList .manage-item').forEach((item) => {
      const id = item.dataset.id;
      $('[data-a="save"]', item).addEventListener('click', async () => {
        try {
          await api('/api/presets/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: $('[data-f="name"]', item).value, content: $('[data-f="content"]', item).value }) });
          await loadPresets(); renderPresetList(); toast('预设已保存');
        } catch (e) { toast(e.message, 'error'); }
      });
      $('[data-a="del"]', item).addEventListener('click', async () => {
        try { await api('/api/presets/' + id, { method: 'DELETE' }); await loadPresets(); renderPresetList(); toast('预设已删除'); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
  }
  async function addPreset() {
    const name = $('#presetName').value.trim(), content = $('#presetContent').value.trim();
    if (!name || !content) { toast('请填写标签名和提示词内容', 'error'); return; }
    try {
      await api('/api/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, content }) });
      $('#presetName').value = ''; $('#presetContent').value = '';
      await loadPresets(); renderPresetList(); toast('预设已添加');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function loadUsers() {
    const r = await api('/api/users');
    state.users = r.items || [];
    $('#userList').innerHTML = state.users.map((u) =>
      `<div class="manage-item" data-uid="${esc(u.id)}">
        <div class="mi-main">
          <div class="mi-title">${esc(u.username)} <span class="mi-badge ${u.role === 'admin' ? 'admin' : ''}">${u.role === 'admin' ? '管理员' : '普通用户'}</span></div>
          <div class="mi-sub">${u.task_count || 0} 个任务 · 创建于 ${fmtTime(u.created_at)}</div>
        </div>
        <select data-f="role" style="max-width:120px">
          <option value="user" ${u.role === 'user' ? 'selected' : ''}>普通用户</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理员</option>
        </select>
        <input data-f="password" type="password" placeholder="改密码（留空不改）" autocomplete="new-password" style="max-width:170px">
        <button class="ghost-btn" type="button" data-a="save">保存</button>
        <button class="ghost-btn" type="button" data-a="del">删除</button>
      </div>`).join('');
    $$('#userList .manage-item').forEach((item) => {
      const uid = item.dataset.uid;
      $('[data-a="save"]', item).addEventListener('click', async () => {
        try {
          await api('/api/users/' + uid, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: $('[data-f="role"]', item).value, password: $('[data-f="password"]', item).value }) });
          await loadUsers(); toast('用户已保存');
        } catch (e) { toast(e.message, 'error'); }
      });
      $('[data-a="del"]', item).addEventListener('click', async () => {
        if (!(await confirmInline('删除该用户？其已生成的图片仍会保留在 output/ 存档中。'))) return;
        try { await api('/api/users/' + uid, { method: 'DELETE' }); await loadUsers(); toast('用户已删除'); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
  }
  async function addUser() {
    const username = $('#nuName').value.trim(), password = $('#nuPass').value, role = $('#nuRole').value;
    if (!username || !password) { toast('请填写用户名和密码', 'error'); return; }
    try {
      await api('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role }) });
      $('#nuName').value = ''; $('#nuPass').value = '';
      await loadUsers(); toast('用户已添加');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ------------------------------ 用量统计（仅管理员） ------------------------------
  async function openUsage() {
    $('#usageOverlay').classList.remove('hidden');
    $('#usageBody').innerHTML = '<p class="tip">统计中…</p>';
    try {
      const u = await api('/api/usage');
      const card = (v, l) => `<div class="stat-card"><b>${v}</b><span>${l}</span></div>`;
      const table = (title, cols, rows) => `<h3 class="sec-title">${title}</h3>
        <table class="data-table"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${rows.length ? rows.map((r) => `<tr>${r.map((x, i) => `<td>${i === 0 ? '<b>' + esc(x) + '</b>' : esc(x)}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="' + cols.length + '">暂无数据</td></tr>'}</tbody></table>`;
      $('#usageBody').innerHTML = `
        <div class="stat-grid">
          ${card(u.total_tasks, '总任务数')}${card(u.succeeded, '成功')}
          ${card(u.failed, '失败')}${card(u.images, '生成图片数')}
          ${card(u.avg_seconds + 's', '平均生成耗时')}
        </div>
        ${table('按用户', ['用户', '任务', '成功', '失败', '图片'], u.by_user.map((x) => [x.username, x.total, x.succeeded, x.failed, x.images]))}
        ${table('按模型', ['模型', '任务', '成功', '图片'], u.by_model.map((x) => [x.model, x.total, x.succeeded, x.images]))}
        ${table('按日期（近 30 天）', ['日期', '任务', '成功', '图片'], u.by_day.map((x) => [x.day, x.total, x.succeeded, x.images]))}
        ${renderUsageTrend(u)}`;
    } catch (e) { toast(e.message, 'error'); $('#usageBody').innerHTML = '<p class="tip">读取失败</p>'; }
  }

  // ======================================================================
  // 批次二：11 条进阶纯前端功能
  //   F03 资产库第二视图 / F08 参数预设 / F10 多维筛选+高亮 / F12 结果对比
  //   F13 键盘效率 / F15 设置页信息架构 / F16 移动端导航 / F17 可访问性统一
  //   F18 参考图与 @ 引用增强 / F19 分组时间线 / F20 队列与用量可视化
  // 约束：不新增 /api/* 路径、不改请求响应形状、不写 settings 表、不新增静态文件；
  //       所有新 DOM 只用新 id/class；21 个原生 select 与 label[for] 一个不动。
  // ======================================================================

  // ---------- 通用工具 ----------
  // F10 搜索高亮：先按字面量切片、再逐段 esc()，保证 HTML 转义不被破坏
  function highlightText(text, q) {
    const s = String(text ?? '');
    const needle = String(q || '').trim();
    if (!needle) return esc(s);
    const lower = s.toLowerCase(), n = needle.toLowerCase();
    let out = '', i = 0;
    while (i < s.length) {
      const hit = lower.indexOf(n, i);
      if (hit < 0) { out += esc(s.slice(i)); break; }
      out += esc(s.slice(i, hit)) + '<mark class="hl">' + esc(s.slice(hit, hit + needle.length)) + '</mark>';
      i = hit + needle.length;
    }
    return out;
  }

  // F19：按天 / 模型 / 服务商把 filtered() 的结果聚合成有序组
  function groupTasks(tasks) {
    const map = new Map();
    const keyOf = (t) => {
      if (state.groupBy === 'day') {
        const d = new Date((t.created_at || 0) * 1000);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      if (state.groupBy === 'model') return String(t.model || '未指定模型');
      const p = t.provider_name;
      return String(p && p !== '默认服务' ? p : '默认服务');
    };
    tasks.forEach((t) => {
      const k = keyOf(t);
      if (!map.has(k)) map.set(k, { label: k, tasks: [] });
      map.get(k).tasks.push(t);
    });
    const arr = Array.from(map.values());
    if (state.groupBy === 'day') arr.sort((a, b) => b.label.localeCompare(a.label));
    return arr;
  }

  // ---------- F17 内联确认条 / 浮层键盘协议 ----------
  function confirmInline(msg) {
    return new Promise((resolve) => {
      const box = $('#confirmOverlay');
      if (!box) { resolve(false); return; }
      if (state.confirmResolve) state.confirmResolve(false);
      state.confirmResolve = resolve;
      $('#confirmText').textContent = msg;
      box.classList.remove('hidden');
      const ok = $('#btnConfirmOk');
      if (ok) ok.focus();
    });
  }
  function settleConfirm(v) {
    const box = $('#confirmOverlay');
    if (box) box.classList.add('hidden');
    const r = state.confirmResolve;
    state.confirmResolve = null;
    if (r) r(v);
  }
  function isTransientMenuOpen() {
    const visible = (s) => $$(s).some((el) => !el.classList.contains('hidden'));
    return visible('.sel-menu') || visible('#atMenu') || visible('#modelMenu') ||
      visible('#exportMenu') || visible('#refPicker');
  }
  // 统一 Esc：只处理顶层浮层；增强下拉 / @ 菜单仍由各自处理器收起。
  // 登录 / 访问密码弹层不允许被 Esc 关掉，避免用户把自己锁在门外。
  function closeTopOverlay() {
    const ov = $$('.overlay').find((el) => !el.classList.contains('hidden'));
    if (ov) {
      if (ov.id === 'loginOverlay' || ov.id === 'lockOverlay') return false;
      if (ov.id === 'confirmOverlay') { settleConfirm(false); return true; }
      ov.classList.add('hidden');
      if (ov.id === 'cmdOverlay') state.cmd.open = false;
      if (ov.id === 'compareOverlay') state.compare.open = false;
      return true;
    }
    if (!$('#lightbox').classList.contains('hidden')) { closeLb(); return true; }
    return false;
  }
  function bindOverlayA11y() {
    // 四套浮层（enhanceSelect / bindModelCombo / bindModelPicker / bindAt 之外）
    // 统一焦点协议：打开时聚焦首个可聚焦元素，关闭时还原焦点；Tab 圈定在浮层内。
    const overlays = $$('.overlay');
    const obs = new MutationObserver((records) => {
      records.forEach((r) => {
        const el = r.target;
        if (!el.classList || !el.classList.contains('overlay')) return;
        if (!el.classList.contains('hidden')) {
          state.overlayFocus = document.activeElement;
          const f = $('input:not([type="hidden"]),textarea,button,[tabindex]:not([tabindex="-1"])', el);
          if (f) f.focus();
        } else if (state.overlayFocus && document.body.contains(state.overlayFocus)) {
          state.overlayFocus.focus();
          state.overlayFocus = null;
        }
      });
    });
    overlays.forEach((el) => obs.observe(el, { attributes: true, attributeFilter: ['class'] }));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const active = $$('.overlay').find((el) => !el.classList.contains('hidden'));
      if (!active) return;
      const items = $$('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])', active)
        .filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    // F16 抽屉下滑关闭：只在内容区已滚到顶部时生效，不与内部滚动抢手势
    $$('.overlay').forEach((ov) => {
      const dr = $('.drawer', ov);
      if (!dr) return;
      let y0 = null;
      dr.addEventListener('touchstart', (e) => { y0 = e.touches[0] ? e.touches[0].clientY : null; }, { passive: true });
      dr.addEventListener('touchend', (e) => {
        if (y0 === null || !e.changedTouches[0]) return;
        const dy = e.changedTouches[0].clientY - y0;
        y0 = null;
        const body = $('.drawer-body', dr);
        if (dy > 90 && (!body || body.scrollTop <= 0)) ov.classList.add('hidden');
      }, { passive: true });
    });
  }

  // ---------- F03 资产库第二视图 ----------
  function switchMainView(v) {
    state.mainView = (v === 'assets' || v === 'prompts') ? v : 'workbench';
    const isAssets = state.mainView === 'assets';
    const isPrompts = state.mainView === 'prompts';
    const isWork = state.mainView === 'workbench';
    $('#mainWorkbench').classList.toggle('hidden', !isWork);
    $('#assetView').classList.toggle('hidden', !isAssets);
    $('#promptView').classList.toggle('hidden', !isPrompts);
    [['#btnViewWork', isWork], ['#btnViewAssets', isAssets], ['#btnViewPrompts', isPrompts]]
      .forEach(([sel, on]) => {
        const b = $(sel); if (!b) return;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    syncMobileNav();
    if (isAssets) renderAssets();
    if (isPrompts) enterPromptBank();
    window.dispatchEvent(new Event('iw:viewchange'));   // 分栏手柄随主视图显隐
  }
  function assetItems() {
    const q = String(state.assetQuery || '').trim().toLowerCase();
    const items = [];
    (state.tasks || []).forEach((t) => {
      if (t.status !== 'succeeded') return;
      (t.output_images || []).forEach((name) => {
        if (q && ![t.prompt, t.model, t.provider_name, name, imgLabel(name), imgTagsOf(name).join(' ')]
          .some((x) => String(x || '').toLowerCase().includes(q))) return;
        items.push({ t, name });
      });
    });
    if (state.assetSort === 'old') items.reverse();
    else if (state.assetSort === 'model') {
      items.sort((a, b) => String(a.t.model || '').localeCompare(String(b.t.model || '')));
    }
    return items;
  }
  function assetTileInnerHTML(x) {
    const t = x.t, key = pickKey(t.id, x.name);
    return `<img src="${fileUrl(x.name)}" data-act="view" data-name="${esc(x.name)}" data-id="${esc(t.id)}" alt="生成结果" title="${esc(imgLabel(x.name))}" loading="lazy">
      <button type="button" class="img-pick" data-act="pick" data-key="${esc(key)}" data-name="${esc(x.name)}" aria-pressed="false" title="勾选后打包下载">
        <span class="pick-box">✓</span><span class="pick-label">选择</span></button>
      <div class="asset-cap"><b>文件名：${esc(imgLabel(x.name))}</b>
        <span>${esc(String(t.prompt || '').slice(0, 40))}</span>
        ${imgTagsOf(x.name).length ? `<span class="asset-tags">${imgTagsOf(x.name).map((g) => `<i>${esc(g)}</i>`).join('')}</span>` : ''}
        <span class="asset-name"><span class="asset-name-text">${esc(fmtTime(t.created_at))} · ${esc(t.model || '')}</span>
          <button type="button" class="asset-rename" data-act="copyimg" data-name="${esc(x.name)}" data-id="${esc(t.id)}" title="复制原图">⧉</button>
          <button type="button" class="asset-rename" data-act="download" data-name="${esc(x.name)}" data-id="${esc(t.id)}" title="下载原图">⤓</button>
          ${/\.(gif|svg)$/i.test(x.name) ? '' : `<button type="button" class="asset-rename" data-act="inpaintAsset" data-name="${esc(x.name)}" data-id="${esc(t.id)}" title="局部修图（遮罩重绘）">▣</button>`}
          <button type="button" class="asset-rename" data-act="renameimg" data-name="${esc(x.name)}" data-id="${esc(t.id)}" title="重命名">✎</button></span></div>`;
  }
  // 资产库自带 state.assetCards + dataset.sig，与 #taskList 的 state.cards 完全隔离
  function renderAssets() {
    const wall = $('#assetWall');
    if (!wall) return;
    const items = assetItems();
    const keys = items.map((x) => pickKey(x.t.id, x.name));
    const keep = new Set(keys);
    for (const [k, el] of state.assetCards) {
      if (!keep.has(k)) { el.remove(); state.assetCards.delete(k); }
    }
    const order = items.map((x) => {
      const k = pickKey(x.t.id, x.name);
      let el = state.assetCards.get(k);
      if (!el) {
        el = document.createElement('div');
        el.className = 'asset-tile';
        el.dataset.key = k;
        state.assetCards.set(k, el);
      }
      el.dataset.imgName = x.name; el.dataset.taskId = x.t.id;
      const sig = JSON.stringify([x.t.status, x.t.prompt, x.t.model, x.t.output_images,
        state.accessKey, state.nameRev]);
      if (el.dataset.sig !== sig) { el.innerHTML = assetTileInnerHTML(x); el.dataset.sig = sig; }
      return el;
    });
    const valid = new Set(order);
    Array.from(wall.children).forEach((n) => { if (!valid.has(n)) n.remove(); });
    order.forEach((n, i) => { if (wall.children[i] !== n) wall.insertBefore(n, wall.children[i] || null); });
    $('#assetCount').textContent = `(${keys.length})`;
    $('#assetEmpty').classList.toggle('hidden', keys.length > 0);
    syncAssetSelection();
  }
  function syncAssetSelection() {
    $$('#assetWall .asset-tile').forEach((tile) => {
      const on = state.pickedImages.has(tile.dataset.key);
      tile.classList.toggle('picked', on);
      const b = $('.img-pick', tile);
      if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const info = $('#assetPickInfo');
    if (info) info.textContent = `已选 ${selectedFiles().length} 张`;
  }
  async function onAssetClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'download') { await downloadOriginal(el.dataset.name); return; }
    if (el.dataset.act === 'inpaintAsset') {
      const t = state.tasks.find((x) => x.id === el.dataset.id);
      if (t) await openInpaint(t.id, Math.max(0, (t.output_images || []).indexOf(el.dataset.name)));
      return;
    }
    if (el.dataset.act === 'renameimg') { openRename(el.dataset.name); return; }
    if (el.dataset.act === 'copyimg') { await copyImageFile(el.dataset.name); return; }
    if (el.dataset.act === 'pick') {
      const k = el.dataset.key;
      if (state.pickedImages.has(k)) state.pickedImages.delete(k);
      else state.pickedImages.add(k);
      applySelection();
      return;
    }
    if (el.dataset.act === 'view') {
      const t = state.tasks.find((x) => x.id === el.dataset.id);
      if (!t) return;
      const names = t.output_images || [];
      openLb(names, Math.max(0, names.indexOf(el.dataset.name)), t.id);
    }
  }
  function toggleAssetSelectAll() {
    const items = assetItems();
    const allPicked = items.length > 0 && items.every((x) => state.pickedImages.has(pickKey(x.t.id, x.name)));
    items.forEach((x) => {
      const k = pickKey(x.t.id, x.name);
      if (allPicked) state.pickedImages.delete(k);
      else state.pickedImages.add(k);
    });
    applySelection();
  }

  // ---------- F08 参数预设（localStorage，不进 settings 表） ----------
  const PARAM_PRESET_KEY = 'iw_param_presets';
  const PRESET_FIELDS = ['model', 'ratio', 'ratioCustom', 'resolution', 'quality', 'reasoning',
    'count', 'format', 'background', 'extra', 'fRatio', 'fResolution', 'fQuality', 'fComplexity',
    'gifFrames', 'gifDuration', 'gifFrameSize', 'gifFrameSizeCustom', 'svgModel', 'svgEffort'];
  const PRESET_CHECKS = ['gifLoopHint', 'gifAnimHint', 'svgPromptHint'];
  function loadParamPresets() {
    try {
      const raw = JSON.parse(localStorage.getItem(PARAM_PRESET_KEY) || '[]');
      state.paramPresets = Array.isArray(raw) ? raw.filter((p) => p && p.name && p.params) : [];
    } catch (e) { state.paramPresets = []; }
  }
  function persistParamPresets() {
    try { localStorage.setItem(PARAM_PRESET_KEY, JSON.stringify(state.paramPresets)); }
    catch (e) { toast('预设保存失败：浏览器存储不可用', 'error'); }
  }
  function snapshotParams() {
    const p = { mode: state.mode, fmtKind: state.fmtKind };
    PRESET_FIELDS.forEach((id) => { const el = $('#' + id); if (el) p[id] = el.value; });
    PRESET_CHECKS.forEach((id) => { const el = $('#' + id); if (el) p[id] = el.checked; });
    return p;
  }
  function applyParamPreset(preset) {
    const p = preset.params || {};
    if (state.mode !== (p.mode || 't2i')) setMode(p.mode || 't2i', true);
    if (p.fmtKind) { state.fmtKind = p.fmtKind; }
    PRESET_FIELDS.forEach((id) => { const el = $('#' + id); if (el && p[id] !== undefined) el.value = p[id]; });
    PRESET_CHECKS.forEach((id) => { const el = $('#' + id); if (el && p[id] !== undefined) el.checked = !!p[id]; });
    state.sizeOverride = '';
    state.reqJsonEdited = false; state.reqJsonManual = false;
    $('#reqJson').value = '';
    applyFormatConstraints();
    onParamChange();
    state.activePresetName = preset.name;
    renderParamPresets();
    toast('已套用参数预设「' + preset.name + '」（提示词与参考图不变）');
  }
  function renderParamPresets() {
    const box = $('#paramPresetChips');
    if (!box) return;
    box.innerHTML = state.paramPresets.length
      ? state.paramPresets.map((p, i) =>
        `<span class="preset-chip${state.activePresetName === p.name ? ' active' : ''}">
          <button type="button" class="preset-apply" data-preset="${i}" title="套用「${esc(p.name)}」">${esc(p.name)}</button>
          <button type="button" class="preset-del" data-delpreset="${i}" aria-label="删除预设 ${esc(p.name)}">✕</button>
        </span>`).join('')
      : '<small class="hint-left">还没有保存的参数预设。</small>';
    $$('#paramPresetChips [data-preset]').forEach((b) => b.addEventListener('click', () => {
      const p = state.paramPresets[Number(b.dataset.preset)];
      if (p) applyParamPreset(p);
    }));
    $$('#paramPresetChips [data-delpreset]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.delpreset);
      const p = state.paramPresets[i];
      if (!p) return;
      state.paramPresets.splice(i, 1);
      persistParamPresets();
      renderParamPresets();
      toast('已删除参数预设「' + p.name + '」');
    }));
  }
  function saveParamPreset() {
    const nameEl = $('#presetNewName');
    const name = String(nameEl.value || '').trim().slice(0, 24);
    if (!name) { toast('请先给预设起个名字', 'error'); nameEl.focus(); return; }
    const params = snapshotParams();
    const i = state.paramPresets.findIndex((p) => p.name === name);
    if (i >= 0) state.paramPresets[i] = { name, params };
    else state.paramPresets.push({ name, params });
    persistParamPresets();
    nameEl.value = '';
    state.activePresetName = name;
    renderParamPresets();
    toast('参数预设「' + name + '」已保存到本机浏览器');
  }

  // ---------- F10 多维筛选控件 / F19 分组控件 ----------
  function renderAdvFilterUI() {
    $('#fModel').value = state.filters.model;
    $('#fProvider').value = state.filters.provider;
    $('#fAuthor').value = state.filters.author;
    $$('#fRangeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.range === state.filters.range));
    $$('#fGroupSeg button').forEach((b) => b.classList.toggle('active', b.dataset.group === state.groupBy));
  }
  function clearAdvFilters() {
    state.filters = { model: '', provider: '', author: '', range: 'all' };
    state.groupBy = 'none';
    state.collapsedGroups.clear();
    renderAdvFilterUI();
    renderTasks();
    toast('已清空多维筛选与分组');
  }

  // ---------- F12 结果对比（复用 state.pickedImages 与 openLb） ----------
  function openCompare() {
    const files = selectedFiles();
    if (files.length < 2 || files.length > 4) {
      toast('请先在画廊勾选 2–4 张生成图，再点「对比 2–4 张」', 'error');
      return;
    }
    state.compare.items = files.map((f) => ({ ...f, t: state.tasks.find((x) => x.id === f.tid) }));
    state.compare.open = true;
    state.compare.mode = 'grid';
    state.compare.idx = 0;
    $('#compareOverlay').classList.remove('hidden');
    renderCompare();
  }
  function compareFields(x) {
    const t = x.t || {};
    return {
      提示词: String(t.prompt || '').slice(0, 60),
      模型: String(t.model || '—'),
      尺寸: String(t.size || '—'),
      画质: String(t.quality || '—'),
      数量: String(t.n ?? 1),
      服务商: String(t.provider_name || '默认服务'),
      输出格式: String(t.output_format || '跟随接口默认'),
    };
  }
  function renderCompare() {
    const grid = $('#compareGrid'), items = state.compare.items;
    const ab = state.compare.mode === 'ab';
    grid.classList.toggle('ab-mode', ab);
    $('#compareCount').textContent = `(${items.length})`;
    $$('#compareModeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.cmode === state.compare.mode));
    $('#btnComparePrev').classList.toggle('hidden', !ab);
    $('#btnCompareNext').classList.toggle('hidden', !ab);
    const base = compareFields(items[0]);
    const shown = ab ? [{ item: items[Math.min(state.compare.idx, items.length - 1)], real: state.compare.idx }] :
      items.map((item, real) => ({ item, real }));
    grid.innerHTML = shown.map(({ item: x, real }, i) => {
      const f = compareFields(x);
      const rows = Object.keys(f).map((k) => {
        const diff = !ab && k !== '提示词' && f[k] !== base[k];
        return `<span class="${diff ? 'diff' : ''}">${esc(k)}：${esc(f[k])}${diff ? ' · 与首张不同' : ''}</span>`;
      }).join('');
      const label = ab ? `第 ${state.compare.idx + 1} / ${items.length} 张` : `图 ${i + 1}`;
      return `<div class="compare-col"><h4>${esc(label)} · ${esc(imgLabel(x.name))}</h4>
        <img src="${fileUrl(x.name)}" data-cmp="${real}" alt="对比图">
        <div class="compare-meta">${rows}</div></div>`;
    }).join('');
    $$('#compareGrid img[data-cmp]').forEach((img) => img.addEventListener('click', () => {
      const x = items[Number(img.dataset.cmp)];
      if (x && x.t) {
        const names = x.t.output_images || [];
        openLb(names, Math.max(0, names.indexOf(x.name)), x.t.id);
      }
    }));
  }
  function compareStep(d) {
    const n = state.compare.items.length;
    if (!n) return;
    state.compare.idx = (state.compare.idx + d + n) % n;
    renderCompare();
  }
  function closeCompare() {
    $('#compareOverlay').classList.add('hidden');
    state.compare.open = false;
  }

  // ---------- F13 命令面板 / 快捷键 ----------
  function commandList() {
    const cmds = [
      { id: 'mode-t2i', name: '切到「文生图」', hint: '模式' },
      { id: 'mode-i2i', name: '切到「图生图」', hint: '模式' },
      { id: 'mode-fmt', name: '切到「GIF / SVG」', hint: '模式' },
      { id: 'focus-search', name: '搜索任务', hint: '聚焦搜索框' },
      { id: 'view-assets', name: '打开资产库', hint: '视图' },
      { id: 'view-work', name: '回到工作台', hint: '视图' },
      { id: 'group-day', name: '任务按天分组', hint: 'F19' },
      { id: 'group-none', name: '取消任务分组', hint: 'F19' },
      { id: 'clear-filters', name: '清空筛选与分组', hint: 'F10 / F19' },
      { id: 'open-usage', name: '打开用量统计', hint: '管理员', admin: true },
      { id: 'open-settings', name: '打开设置', hint: '管理员', admin: true },
      { id: 'help', name: '查看全部快捷键', hint: '?' },
    ];
    state.paramPresets.forEach((p, i) => cmds.push({
      id: 'preset-' + i, name: '套用参数预设「' + p.name + '」', hint: 'F08',
    }));
    return cmds.filter((c) => !c.admin || isAdmin());
  }
  function renderCmd() {
    const q = String($('#cmdInput').value || '').trim().toLowerCase();
    const all = commandList().filter((c) => !q || (c.name + ' ' + c.hint).toLowerCase().includes(q));
    state.cmd.items = all;
    if (state.cmd.index >= all.length) state.cmd.index = 0;
    $('#cmdList').innerHTML = all.length
      ? all.map((c, i) => `<div class="cmd-item${i === state.cmd.index ? ' active' : ''}" data-ci="${i}" role="option">
          <span>${esc(c.name)}</span><small>${esc(c.hint)}</small></div>`).join('')
      : '<div class="cmd-item"><span>没有匹配的命令</span></div>';
    $$('#cmdList [data-ci]').forEach((el) => el.addEventListener('click', () => runCmd(Number(el.dataset.ci))));
  }
  function openCmd() {
    state.cmd.open = true;
    state.cmd.index = 0;
    $('#cmdInput').value = '';
    $('#cmdOverlay').classList.remove('hidden');
    renderCmd();
    $('#cmdInput').focus();
  }
  function closeCmd() { $('#cmdOverlay').classList.add('hidden'); state.cmd.open = false; }
  function runCmd(i) {
    const c = state.cmd.items[i];
    if (!c) return;
    closeCmd();
    if (c.id.startsWith('mode-')) { setMode(c.id.slice(5)); return; }
    if (c.id.startsWith('preset-')) {
      const p = state.paramPresets[Number(c.id.slice(7))];
      if (p) applyParamPreset(p);
      return;
    }
    switch (c.id) {
      case 'focus-search': $('#searchInput').focus(); break;
      case 'view-assets': switchMainView('assets'); break;
      case 'view-work': switchMainView('workbench'); break;
      case 'group-day': state.groupBy = 'day'; renderAdvFilterUI(); renderTasks(); break;
      case 'group-none': state.groupBy = 'none'; renderAdvFilterUI(); renderTasks(); break;
      case 'clear-filters': clearAdvFilters(); break;
      case 'open-usage': if (isAdmin()) openUsage(); break;
      case 'open-settings': if (isAdmin()) openSettings('image'); break;
      case 'help': openHelp(); break;
      default: break;
    }
  }
  function openHelp() {
    const rows = [
      ['Ctrl / ⌘ + K', '打开 / 关闭命令面板'],
      ['Ctrl / ⌘ + Enter', '提交生成任务（提示词框内）'],
      ['?', '打开本快捷键帮助'],
      ['Esc', '关闭当前浮层（增强下拉 / @ 菜单仍由各自处理器收起）'],
      ['↑ ↓ / Enter / Tab', '增强下拉、@ 菜单、模型选择'],
      ['← →', '灯箱翻页'],
      ['Shift + 点击「选择」', '同一任务内连选图片区间'],
    ];
    $('#helpBody').innerHTML = rows.map(([k, v]) =>
      `<div class="help-row"><kbd>${esc(k)}</kbd><span>${esc(v)}</span></div>`).join('');
    $('#helpOverlay').classList.remove('hidden');
  }
  function bindKeyboard() {
    $('#cmdInput').addEventListener('input', () => { state.cmd.index = 0; renderCmd(); });
    $('#cmdInput').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.cmd.index = Math.min(state.cmd.index + 1, state.cmd.items.length - 1);
        renderCmd();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.cmd.index = Math.max(state.cmd.index - 1, 0);
        renderCmd();
      } else if (e.key === 'Enter') { e.preventDefault(); runCmd(state.cmd.index); }
      else if (e.key === 'Escape') { e.preventDefault(); closeCmd(); }
    });
    document.addEventListener('keydown', (e) => {
      // 必须放在 isTransientMenuOpen() 之前：浮层打开时按 Ctrl+S 也不弹浏览器另存为
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); return; }
      const tag = String((e.target && e.target.tagName) || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || !!(e.target && e.target.isContentEditable);
      // F13 硬约束：21 个增强下拉 / @ 菜单 / 模型下拉占用按键时，全局快捷键一律让路
      if (isTransientMenuOpen()) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (state.cmd.open) closeCmd(); else openCmd();
        return;
      }
      if (e.key === 'Escape') {
        if (closeTopOverlay()) e.preventDefault();
        return;
      }
      if (!typing && e.key === '?') { e.preventDefault(); openHelp(); return; }
      if (!typing && state.compare.open && state.compare.mode === 'ab') {
        if (e.key === 'ArrowLeft') { e.preventDefault(); compareStep(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); compareStep(1); }
      }
    });
  }

  // ---------- F15 设置页小节锚点 / 测试语言模型 ----------
  function switchSettingsSection(sec) {
    const el = $('#' + sec);
    if (!el) return;
    const page = el.closest('.tab-page');
    if (page && page.dataset.page) switchTab(page.dataset.page);
    $$('#settingsNav button').forEach((b) => b.classList.toggle('active', b.dataset.sec === sec));
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // 用既有的 /api/prompt/optimize 做连通性验证，不新增任何端点
  async function testLlmConnection() {
    const btn = $('#btnTestLlm');
    btn.disabled = true; btn.textContent = '测试中…';
    try {
      await saveSettings(true);
      const r = await api('/api/prompt/optimize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: '一只坐在窗台上的橘猫', mode: 't2i', llm_provider_id: $('#llmProvider').value }),
      });
      toast(r.prompt ? '语言模型连通，优化接口返回正常' : '语言模型未返回内容', r.prompt ? '' : 'error');
    } catch (e) { toast('语言模型测试失败：' + e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '测试语言模型'; }
  }

  // ---------- F16 移动端视图切换 ----------
  function syncMobileNav() {
    $$('#mobileNav button').forEach((b) => {
      const on = (b.id === 'btnMobileCompose' && state.mobilePane === 'compose' && state.mainView === 'workbench') ||
        (b.id === 'btnMobileTask' && state.mobilePane === 'tasks' && state.mainView === 'workbench') ||
        (b.id === 'btnMobileAssets' && state.mainView === 'assets') ||
        (b.id === 'btnMobilePrompts' && state.mainView === 'prompts');
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  function switchMobilePane(p) {
    state.mobilePane = (p === 'tasks' || p === 'assets') ? p : 'compose';
    if (state.mobilePane === 'assets') switchMainView('assets');
    else {
      // 从「提示词库 / 资产库」任一视图点底部「创作 / 任务」都要回到工作台，
      // 旧代码只判断了 assets，停留在提示词页时点创作会毫无反应。
      if (state.mainView !== 'workbench') switchMainView('workbench');
      $('#mainWorkbench').dataset.pane = state.mobilePane === 'tasks' ? 'tasks' : 'compose';
    }
    syncMobileNav();
    window.dispatchEvent(new Event('iw:viewchange'));
  }

  // ---------- F18 @ 引用重编号 / 缩略图选择器 ----------
  function renderAtHint() {
    const box = $('#atRefHint');
    if (!box) return;
    const toks = atTokens($('#prompt').value);
    const m = state.atRefMapping;
    if (!m || !toks.length) { box.classList.add('hidden'); return; }
    const affected = toks.filter((t) => m.has(t.n) && m.get(t.n) !== t.n).length;
    const lost = toks.filter((t) => t.n > state.files.length).length;
    $('#atRefHintText').textContent = `参考图顺序已变化：${toks.length} 处 @参考图N 引用中，${affected} 处编号需要更新` +
      (lost ? `，${lost} 处已无对应图片` : '') + '。点「一键重编号」按当前顺序改写提示词文本。';
    box.classList.remove('hidden');
  }
  // @参考图N 是提示词文本、随 prompt 一起发送；这里只改写文本，不改变上传顺序 = 编号的契约
  function renumberAtRefs() {
    const m = state.atRefMapping;
    const ta = $('#prompt');
    if (!m || !m.size) { toast('当前没有需要重编号的引用', 'error'); return; }
    const before = ta.value;
    const after = before.replace(/@参考图(\d+)/g, (raw, n) => {
      const to = m.get(Number(n));
      return (to && to >= 1 && to <= state.files.length) ? '@参考图' + to : raw;
    });
    ta.value = after;
    state.atRefMapping = null;
    $('#atRefHint').classList.add('hidden');
    onParamChange();
    toast(after !== before ? '已按当前参考图顺序重编号（仍随提示词一起发送）' : '引用编号已是正确的，无需改动');
  }
  function toggleRefPicker() {
    const box = $('#refPicker');
    state.refPickerOpen = !state.refPickerOpen;
    box.classList.toggle('hidden', !state.refPickerOpen);
    if (state.refPickerOpen) renderRefPicker();
  }
  function renderRefPicker() {
    const box = $('#refPicker');
    const items = [];
    (state.tasks || []).forEach((t) => {
      if (t.status !== 'succeeded') return;
      (t.output_images || []).forEach((n) => {
        if (isNonBitmap(n)) return;   // 缩略图挑选里不出现 GIF / SVG
        items.push({ n, t });
      });
    });
    box.innerHTML = items.length
      ? items.slice(0, 40).map((x) =>
        `<button type="button" class="ref-pick-item" data-refname="${esc(x.n)}" title="${esc(x.t.prompt || '')}">
          <img src="${fileUrl(x.n)}" alt=""><span>${esc(fmtTime(x.t.created_at))}</span></button>`).join('')
      : '<div class="at-empty">还没有已生成的图片</div>';
    $$('#refPicker [data-refname]').forEach((b) => b.addEventListener('click', async () => {
      state.refPickerOpen = false;
      box.classList.add('hidden');
      await addRemoteRef(b.dataset.refname);
    }));
  }

  // ---------- F20 队列概览 / 用量趋势（只复用 /api/stats 与 /api/usage） ----------
  function renderQueueViz(st) {
    const put = (id, v) => { const el = $('#' + id); if (el) el.textContent = String(v); };
    const total = Number(st.total || 0), ok = Number(st.succeeded || 0), fail = Number(st.failed || 0);
    const busy = Number(st.pending || 0) + Number(st.running || 0);
    put('qvTotal', total); put('qvSucceeded', ok); put('qvFailed', fail);
    put('qvPending', st.pending || 0); put('qvRunning', st.running || 0);
    const pct = (v) => total ? Math.round(v / total * 100) : 0;
    const okBar = $('#qvOkBar'), failBar = $('#qvFailBar'), busyBar = $('#qvBusyBar');
    if (okBar) okBar.style.width = pct(ok) + '%';
    if (failBar) failBar.style.width = pct(fail) + '%';
    if (busyBar) busyBar.style.width = pct(busy) + '%';
    const rate = $('#qvRate');
    if (rate) rate.textContent = (ok + fail) ? `成功率 ${Math.round(ok / (ok + fail) * 100)}%` : '成功率 —';
  }
  function renderUsageTrend(u) {
    const bar = (label, val, max, suffix) => {
      const pct = max > 0 ? Math.max(0, Math.min(100, Math.round(val / max * 100))) : 0;
      return `<div class="trend-row"><span>${esc(label)}</span>
        <span class="trend-track"><span class="trend-fill" style="width:${pct}%"></span></span>
        <span class="trend-val">${esc(val)}${esc(suffix || '')}</span></div>`;
    };
    // db.usage_stats() 的 by_day 按日期倒序返回（最新在前）：取前 10 条再反转成时间正序，
    // 才是文案里说的「近 10 天」；用 slice(-10) 会拿到最旧的 10 天。
    const dayRows = (u.by_day || []).slice(0, 10).reverse().map((d) =>
      bar(String(d.day), d.total ? Math.round(d.succeeded / d.total * 100) : 0, 100, '%')).join('');
    const modelRows = (u.by_model || []).slice(0, 8).map((m) =>
      bar(String(m.model || '未指定'), m.total ? Math.round(m.succeeded / m.total * 100) : 0, 100, '%')).join('');
    return `<h3 class="sec-title">成功率趋势 <small>近 10 天</small></h3>
      ${dayRows || '<p class="tip">暂无按天数据</p>'}
      <h3 class="sec-title">按模型成功率对比</h3>
      ${modelRows || '<p class="tip">暂无按模型数据</p>'}
      <h3 class="sec-title">平均生成耗时</h3><p class="tip">${esc(String(u.avg_seconds ?? 0))} 秒 / 任务</p>`;
  }

  // ---------- 批次二统一绑定 / 初始化 ----------
  function bindBatch2Events() {
    // F03 主视图 / 资产库
    $('#btnViewWork').addEventListener('click', () => switchMainView('workbench'));
    $('#btnViewAssets').addEventListener('click', () => switchMainView('assets'));
    $('#btnViewPrompts').addEventListener('click', () => switchMainView('prompts'));
    $('#promptViewSearch').addEventListener('input', (e) => {
      state.promptViewQuery = e.target.value; renderPromptBank();
    });
    $$('#promptViewTabs button').forEach((b) => b.addEventListener('click', () => {
      state.bankTab = b.dataset.bank; renderPromptBank();
    }));
    $('#bankCurrent').addEventListener('input', (e) => { $('#prompt').value = e.target.value; onParamChange(); });
    $('#btnBankSaveCurrent').addEventListener('click', saveBankFavorite);
    $('#btnBankNewPreset').addEventListener('click', () => $('#bankNewPreset').classList.toggle('hidden'));
    $('#btnBankPresetSave').addEventListener('click', saveBankPreset);
    $('#assetSearch').addEventListener('input', () => {
      state.assetQuery = $('#assetSearch').value.trim();
      renderAssets();
    });
    $$('#assetViewSeg button').forEach((b) => b.addEventListener('click', () => {
      state.assetSort = b.dataset.sort;
      $$('#assetViewSeg button').forEach((x) => x.classList.toggle('active', x === b));
      renderAssets();
    }));
    $('#assetWall').addEventListener('click', onAssetClick);
    $('#btnAssetSelectAll').addEventListener('click', toggleAssetSelectAll);
    $('#btnAssetDownload').addEventListener('click', () => downloadSelected(null));
    $('#btnAssetDelete').addEventListener('click', deleteSelected);
    // F08 参数预设
    $('#btnSaveParamPreset').addEventListener('click', saveParamPreset);
    $('#presetNewName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveParamPreset(); }
    });
    // F10 多维筛选 / F19 分组
    [['#fModel', 'model'], ['#fProvider', 'provider'], ['#fAuthor', 'author']].forEach(([s, k]) => {
      $(s).addEventListener('input', () => { state.filters[k] = $(s).value.trim(); renderTasks(); });
    });
    $$('#fRangeSeg button').forEach((b) => b.addEventListener('click', () => {
      state.filters.range = b.dataset.range;
      $$('#fRangeSeg button').forEach((x) => x.classList.toggle('active', x === b));
      renderTasks();
    }));
    $$('#fGroupSeg button').forEach((b) => b.addEventListener('click', () => {
      state.groupBy = b.dataset.group;
      state.collapsedGroups.clear();
      $$('#fGroupSeg button').forEach((x) => x.classList.toggle('active', x === b));
      renderTasks();
    }));
    $('#btnClearFilters').addEventListener('click', clearAdvFilters);
    // F12 结果对比
    $('#btnCompare').addEventListener('click', openCompare);
    $('#btnCompareClose').addEventListener('click', closeCompare);
    $$('#compareModeSeg button').forEach((b) => b.addEventListener('click', () => {
      state.compare.mode = b.dataset.cmode;
      state.compare.idx = 0;
      renderCompare();
    }));
    $('#btnComparePrev').addEventListener('click', () => compareStep(-1));
    $('#btnCompareNext').addEventListener('click', () => compareStep(1));
    // F13 命令面板 / 帮助 / 全局键盘
    $('#btnHelpClose').addEventListener('click', () => $('#helpOverlay').classList.add('hidden'));
    bindKeyboard();
    // F15 设置页
    $$('#settingsNav button').forEach((b) => b.addEventListener('click', () => switchSettingsSection(b.dataset.sec)));
    $('#btnTestLlm').addEventListener('click', testLlmConnection);
    // F16 移动端
    $('#btnMobileCompose').addEventListener('click', () => switchMobilePane('compose'));
    $('#btnMobileTask').addEventListener('click', () => switchMobilePane('tasks'));
    $('#btnMobileAssets').addEventListener('click', () => switchMobilePane('assets'));
    $('#btnMobilePrompts').addEventListener('click', () => switchMainView('prompts'));
    // F17 内联确认 / 浮层键盘协议
    $('#btnConfirmOk').addEventListener('click', () => settleConfirm(true));
    $('#btnConfirmCancel').addEventListener('click', () => settleConfirm(false));
    bindOverlayA11y();
    // F18 参考图
    $('#btnRenumberRefs').addEventListener('click', renumberAtRefs);
    $('#btnRefQuickPick').addEventListener('click', (e) => { e.stopPropagation(); toggleRefPicker(); });
    document.addEventListener('click', (e) => {
      if (state.refPickerOpen && !$('#refPicker').contains(e.target) && e.target.id !== 'btnRefQuickPick') {
        state.refPickerOpen = false;
        $('#refPicker').classList.add('hidden');
      }
      // F17：点卡片外或另一张卡片时收起已展开的「⋯ 操作」菜单；
      // 选择器只作用于批次二新增的 .card-ops-menu，既有 <details> 原生语义不动。
      const inMenu = e.target instanceof Element && e.target.closest('.card-ops-menu');
      if (!inMenu) $$('#taskList .card-ops-menu[open]').forEach((d) => { d.open = false; });
    });
  }
  function initBatch2() {
    loadParamPresets();
    renderParamPresets();
    renderAdvFilterUI();
    switchMainView('workbench');
    switchMobilePane('compose');
    renderQueueViz(state.stats || {});
  }

  // 登录 / 初始化 / 访问密码的弹窗在「未登录」时就要可用，
  // 因此这些事件必须在 boot() 之前绑定，不能放进登录后才执行的 bindEvents()。
  function bindAuthEvents() {
    $('#btnLogin').addEventListener('click', doLogin);
    ['#loginName', '#loginPass', '#loginPass2'].forEach((s) =>
      $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); }));
    $('#btnUnlock').addEventListener('click', unlock);
    $('#lockKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
  }

  bindAuthEvents();
  // F01 / F05 / F14：静态节点全局只绑一次，登录前后都可用；主题在 boot() 之前落地。
  initTheme();
  bindGlobalEvents();
  // 批次二：预设读取、视图 / 分组 / 筛选控件初始化（不请求任何新接口）
  initBatch2();
  boot();
})();
