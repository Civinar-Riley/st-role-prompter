// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Civinar-Riley

/**
 * 角色提词器 v1.0.0
 *
 * 酒馆助手（JS-Slash-Runner）脚本。
 * 悬浮面板管理「标题 / 描述 / 注入内容」条目，点击条目把注入内容送进酒馆输入框，
 * 并把光标停在注入内容里 `|` 标记处（`\|` 表示一个字面竖线）。
 *
 * 双池存储：
 *   - 本卡池 → 角色卡变量，随角色卡导出（分享角色卡时条目自动带上）
 *   - 通用池 → 全局变量，随用户存档
 *   设置单独存全局变量（全局偏好，不分池）
 *
 * 入口：酒馆助手脚本按钮「角色提词器」+ 可拖动悬浮球（可在设置里关闭）
 *
 * 版本要求：SillyTavern 1.18+ / 酒馆助手 4.x+
 */
(() => {
  'use strict';

  /* ==================== 常量 ==================== */

  const SCRIPT_VERSION = '1.1.2';
  const BUTTON_NAME = '角色提词器';
  const STORE_KEY = '角色提词器';
  // v1.0.0 时叫「角色名注入」，改名的同时把老数据搬过来（读到这里时会自动迁移）
  const LEGACY_STORE_KEY = '角色名注入';
  // v1.0.0 用的元素 id 前缀是 rni-，卸载时一并清掉，避免新旧版本同时启用留下残骸
  const LEGACY_ID_PREFIX = 'rni-';
  const CURSOR_MARK = '|';
  const MIN_TAVERN = '1.18.0';
  const MIN_HELPER = '4.0.0';

  const PANEL_ID = 'rpt-panel';
  const STYLE_ID = 'rpt-style';
  const BALL_ID = 'rpt-ball';
  const MODAL_ID = 'rpt-modal';
  const ENTRY_ID = 'rpt-entry';
  const INSTANCE_KEY = '__RPT_ACTIVE_TOKEN__';

  const TOKEN = `t${Date.now()}${Math.random().toString(36).slice(2, 9)}`;
  const TAG = '[角色提词器]';

  /* ==================== 环境 ==================== */

  const host = window.parent && window.parent !== window ? window.parent : window;
  const doc = host.document;

  /* ==================== 酒馆助手 API 探测 ==================== */
  // 铁律：不要假设任何全局函数一定存在

  const G = (name) => {
    try {
      if (typeof globalThis[name] === 'function') return globalThis[name].bind(globalThis);
    } catch (e) { /* ignore */ }
    try {
      const th = host.TavernHelper;
      if (th && typeof th[name] === 'function') return th[name].bind(th);
    } catch (e) { /* ignore */ }
    return null;
  };

  /**
   * 只在本脚本 iframe 内查找的接口探测。
   * eventOn / getButtonEvent / appendInexistentScriptButtons 等按官方文档标记为
   * 🚫TavernHelper（只能在脚本内使用），不能从宿主页面的 TavernHelper 上取——
   * 那样会"注册成功"但按钮点不动，还不如老实走降级入口。
   */
  const GScript = (name) => {
    try {
      if (typeof globalThis[name] === 'function') return globalThis[name].bind(globalThis);
    } catch (e) { /* ignore */ }
    return null;
  };

  /* ==================== 纯函数（可测试，见 test/test-parser.js） ==================== */
  /* __TEST_SLICE_START__ */

  /** 版本号比较：a > b 返回 1，a < b 返回 -1，相等返回 0 */
  function compareVersion(a, b) {
    const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  /**
   * 解析注入内容里的光标标记。
   * 第一个未被转义的 `|` 是光标落点，会被移除；`\|` 表示一个字面竖线。
   * 没有标记时，光标落在文本末尾。
   * @returns {{text: string, cursor: number}}
   */
  function parseContent(text) {
    const src = String(text == null ? '' : text);
    let out = '';
    let cursor = -1;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === '\\' && src[i + 1] === '|') {
        out += '|';
        i++;
        continue;
      }
      if (ch === '|' && cursor < 0) {
        cursor = out.length;
        continue;
      }
      out += ch;
    }
    if (cursor < 0) cursor = out.length;
    return { text: out, cursor };
  }

  /**
   * 按注入模式拼出输入框的新值，并算出光标落点。
   * @param {string} oldValue 输入框当前值
   * @param {number} selStart 当前选区起点
   * @param {number} selEnd 当前选区终点
   * @param {string} injectText 要注入的文本（已去掉光标标记）
   * @param {number} injectCursor 光标在 injectText 里的下标
   * @param {'append'|'replace'|'cursor'} mode
   * @param {string} [separator] 追加模式下与已有内容的分隔符（默认换行）
   * @returns {{value: string, cursor: number}}
   */
  function buildInjectedValue(oldValue, selStart, selEnd, injectText, injectCursor, mode, separator) {
    const old = String(oldValue == null ? '' : oldValue);
    const text = String(injectText == null ? '' : injectText);
    let next;
    let base;

    if (mode === 'replace') {
      next = text;
      base = 0;
    } else if (mode === 'cursor') {
      const s = clamp(selStart == null ? old.length : selStart, 0, old.length);
      const e = clamp(selEnd == null ? s : selEnd, s, old.length);
      next = old.slice(0, s) + text + old.slice(e);
      base = s;
    } else {
      // append：输入框空则直接填，非空则清理末尾空白后用分隔符接上
      if (!old) {
        next = text;
        base = 0;
      } else {
        const trimmed = old.replace(/\s+$/, '');
        const sep = trimmed ? (typeof separator === 'string' ? separator : '\n') : '';
        next = trimmed + sep + text;
        base = trimmed.length + sep.length;
      }
    }

    let cursor = base + (Number.isFinite(injectCursor) ? injectCursor : text.length);
    if (cursor < 0) cursor = 0;
    if (cursor > next.length) cursor = next.length;
    return { value: next, cursor };
  }

  /** 新建条目时的默认注入内容（标题里的竖线要转义，否则会被当成光标标记） */
  function defaultContent(title) {
    const safe = String(title == null ? '' : title).replace(/\|/g, '\\|');
    return `${safe}：“${CURSOR_MARK}”`;
  }

  /** 生成条目 id */
  function newId() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (e) { /* ignore */ }
    return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  /** 把任意来源的数据规整成合法条目 */
  function normalizeEntry(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const now = Date.now();
    return {
      id: typeof r.id === 'string' && r.id ? r.id : newId(),
      title: typeof r.title === 'string' ? r.title : '',
      desc: typeof r.desc === 'string' ? r.desc : '',
      content: typeof r.content === 'string' ? r.content : '',
      useCount: Number.isFinite(r.useCount) ? r.useCount : 0,
      lastUsedAt: Number.isFinite(r.lastUsedAt) ? r.lastUsedAt : 0,
      createdAt: Number.isFinite(r.createdAt) ? r.createdAt : now,
      updatedAt: Number.isFinite(r.updatedAt) ? r.updatedAt : now,
      source: r.source && typeof r.source === 'object' ? r.source : null,
    };
  }

  /** 按关键词过滤条目（标题 + 描述，忽略大小写） */
  function filterEntries(entries, keyword) {
    const kw = String(keyword == null ? '' : keyword).trim().toLowerCase();
    const list = Array.isArray(entries) ? entries : [];
    if (!kw) return list.slice();
    return list.filter((e) => {
      const t = String(e && e.title ? e.title : '').toLowerCase();
      const d = String(e && e.desc ? e.desc : '').toLowerCase();
      return t.includes(kw) || d.includes(kw);
    });
  }

  /** 在已有标题集合里生成一个不重名的标题（重名则追加 2、3、4…） */
  function uniqueTitle(base, existingTitles) {
    const name = String(base == null ? '' : base).trim() || '未命名';
    const used = new Set((existingTitles || []).map((t) => String(t)));
    if (!used.has(name)) return name;
    let i = 2;
    while (used.has(`${name} ${i}`)) i++;
    return `${name} ${i}`;
  }

  /**
   * 从世界书条目里筛出可导入的候选。
   * 已导入过的按名字跳过；keyword 同时匹配条目名与内容摘要。
   */
  function worldbookCandidates(wbEntries, importedNames, keyword) {
    const imported = new Set((importedNames || []).map((n) => String(n)));
    const kw = String(keyword == null ? '' : keyword).trim().toLowerCase();
    const out = [];
    for (const e of Array.isArray(wbEntries) ? wbEntries : []) {
      if (!e) continue;
      const name = String(e.name == null ? '' : e.name).trim();
      if (!name || imported.has(name)) continue;
      const preview = String(e.content == null ? '' : e.content).replace(/\s+/g, ' ').trim().slice(0, 60);
      if (kw && !name.toLowerCase().includes(kw) && !preview.toLowerCase().includes(kw)) continue;
      out.push({ name, preview, enabled: e.enabled !== false });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    return out;
  }

  /** HTML 转义 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 数值夹取 */
  function clamp(n, min, max) {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    if (max < min) return min;
    return Math.min(Math.max(v, min), max);
  }

  /**
   * 内置预设库：常用格式片段。不自动进任何池子，由用户在「预设库」里勾选后手动添加。
   * content 里用 | 标记光标落点。
   */
  const LIBRARY = [
    // ---- 角色扮演常用 ----
    { group: '角色扮演', title: '对话', desc: '双引号台词，光标在引号中间', content: '“|”' },
    { group: '角色扮演', title: '心里话', desc: '星号内心独白（Markdown 里就是斜体）', content: '*|*' },
    { group: '角色扮演', title: '旁白', desc: '括号包住的动作或旁白', content: '（|）' },
    { group: '角色扮演', title: '双人对答', desc: '两句台词连着写，光标在第一句里', content: '“|”\n“”' },
    { group: '角色扮演', title: '场景切换', desc: '分隔线式转场', content: '—— | ——' },
    // ---- Markdown 格式 ----
    { group: 'Markdown 格式', title: '斜体', desc: '同 Ctrl+I（和「心里话」是同一种写法）', content: '*|*' },
    { group: 'Markdown 格式', title: '粗体', desc: '同 Ctrl+B', content: '**|**' },
    { group: 'Markdown 格式', title: '粗斜体', desc: '又粗又斜', content: '***|***' },
    { group: 'Markdown 格式', title: '下划线', desc: '同 Ctrl+U', content: '__|__' },
    { group: 'Markdown 格式', title: '删除线', desc: '同 Ctrl+Shift+`', content: '~~|~~' },
    { group: 'Markdown 格式', title: '行内代码', desc: '同 Ctrl+K', content: '`|`' },
    { group: 'Markdown 格式', title: '代码块', desc: '多行代码块', content: '```\n|\n```' },
    { group: 'Markdown 格式', title: '引用', desc: '引用块', content: '> |' },
    { group: 'Markdown 格式', title: '大标题', desc: '一级标题', content: '# |' },
    { group: 'Markdown 格式', title: '中标题', desc: '二级标题', content: '## |' },
    { group: 'Markdown 格式', title: '小标题', desc: '三级标题', content: '### |' },
    { group: 'Markdown 格式', title: '超链接', desc: '光标在链接文字处', content: '[|]()' },
    { group: 'Markdown 格式', title: '图像', desc: '光标在图片网址处', content: '![](|)' },
  ];

  /* __TEST_SLICE_END__ */

  /* ==================== 状态 ==================== */

  const DEFAULT_SETTINGS = {
    injectMode: 'append',        // append | replace | cursor
    appendSeparator: 'newline',  // newline | space | none —— 仅追加模式用
    autoCloseAfterInject: true,
    showFloatingBall: true,
    theme: 'auto',               // auto | dark | light
    ballPosition: null,          // {x, y}
    panelPosition: null,         // {x, y}
  };

  /** 把设置里的分隔符名转成实际字符串 */
  const SEPARATOR_MAP = { newline: '\n', space: ' ', none: '' };

  let globalStore = null;        // 通用池：{ version, entries, importedWorldbookEntries, settings }
  let cardStore = null;          // 本卡池：{ version, entries, importedWorldbookEntries }；无角色卡时为 null
  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let state = {
    pool: 'card',                // card | global
    poolPinned: false,           // 用户是否手动切过页签（切过就不再自动改）
    keyword: '',
    editingId: null,
    lastClosedAt: 0,
    openModalEl: null,
    openModalToken: 0,           // 当前弹窗的令牌，closeModal 靠它避免关错弹窗
    openModalOnClose: null,
  };

  /* ==================== 小工具 ==================== */

  const log = (...args) => console.info(TAG, ...args);

  function toast(msg, type = 'info') {
    try {
      const t = host.toastr || (typeof toastr !== 'undefined' ? toastr : null);
      if (t && typeof t[type] === 'function') { t[type](msg); return; }
    } catch (e) { /* ignore */ }
    log(`[${type}] ${msg}`);
  }

  /** 调用可能是异步的酒馆助手接口 */
  function callApi(fn, ...args) {
    try {
      const r = fn(...args);
      if (r && typeof r.then === 'function') {
        return r.catch((e) => { console.error(TAG, '接口调用失败', e); throw e; });
      }
      return r;
    } catch (e) {
      console.error(TAG, '接口调用失败', e);
      throw e;
    }
  }

  /* __EL_SLICE_START__ */
  function el(tag, attrs, children) {
    const node = doc.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style') node.style.cssText = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      }
    }
    if (children != null) {
      for (const c of [].concat(children)) {
        if (c == null || c === false) continue;
        node.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
      }
    }
    return node;
  }
  /* __EL_SLICE_END__ */

  // 统一登记注册在酒馆页面上的监听，卸载时一次性摘除，避免脚本停用后残留
  const pageListeners = [];
  function onPage(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    pageListeners.push([target, type, fn, opts]);
  }
  function clearPageListeners() {
    for (const [target, type, fn, opts] of pageListeners) {
      try { target.removeEventListener(type, fn, opts); } catch (e) { /* ignore */ }
    }
    pageListeners.length = 0;
  }

  /* ==================== 存储层 ==================== */

  const poolOption = (pool) => ({ type: pool === 'card' ? 'character' : 'global' });
  const poolName = (pool) => (pool === 'card' ? '本卡' : '通用');

  function emptyStore() {
    return { version: 1, entries: [], importedWorldbookEntries: {} };
  }

  // 读取异常标记：一旦读取出过问题，就禁止写盘，避免把真实数据覆盖成空
  let dataReadFailed = false;
  // 哪些池这次是从旧键（v1.0.0 的「角色名注入」）读出来的，保存成功后要清掉旧键
  const legacyKeyUsed = { global: false, card: false };

  /**
   * 读取某个池。返回 null 表示该池当前不可用（没有打开角色卡）。
   */
  function readStore(pool) {
    const fn = G('getVariables');
    if (!fn) return pool === 'card' ? null : emptyStore();
    try {
      const vars = callApi(fn, poolOption(pool));
      if (vars && typeof vars.then === 'function') {
        // getVariables 按类型定义是同步的。真返回 Promise 说明环境异常，
        // 此时绝不能当成"没有数据"——否则下一次保存会把真实数据整份覆盖掉。
        dataReadFailed = true;
        console.error(TAG, 'getVariables 意外返回 Promise，已放弃本次读取以保护数据');
        return pool === 'card' ? null : emptyStore();
      }
      const table = vars || {};
      let raw = table[STORE_KEY];
      if (!raw || typeof raw !== 'object') {
        // 兼容 v1.0.0 的旧键，读到就沿用，等保存成功后清掉
        const legacy = table[LEGACY_STORE_KEY];
        if (legacy && typeof legacy === 'object') {
          raw = legacy;
          legacyKeyUsed[pool] = true;
          log(`检测到旧版数据（键名「${LEGACY_STORE_KEY}」），已自动接管`);
        }
      }
      if (!raw || typeof raw !== 'object') return emptyStore();
      const store = emptyStore();
      store.version = Number.isFinite(raw.version) ? raw.version : 1;
      store.entries = Array.isArray(raw.entries) ? raw.entries.map(normalizeEntry) : [];
      if (raw.importedWorldbookEntries && typeof raw.importedWorldbookEntries === 'object') {
        store.importedWorldbookEntries = raw.importedWorldbookEntries;
      }
      if (raw.settings && typeof raw.settings === 'object') store.settings = raw.settings;
      return store;
    } catch (e) {
      // 没有打开角色卡时，角色卡变量会抛错
      return pool === 'card' ? null : emptyStore();
    }
  }

  /**
   * 真正写盘（内部实现，外部请用 saveStore）。
   * 用 insertOrAssignVariables（只动自己的键），
   * 绝不能用 replaceVariables——那会整体替换变量表，清掉其他脚本的数据。
   */
  async function writeStore(pool) {
    if (dataReadFailed) {
      toast('保存已阻止：之前的数据读取异常，刷新页面后再试', 'error');
      return false;
    }
    const fn = G('insertOrAssignVariables');
    if (!fn) { toast('保存失败：酒馆助手接口不可用', 'error'); return false; }
    const store = pool === 'card' ? cardStore : globalStore;
    if (!store) { toast('保存失败：数据池不可用（可能没有打开角色卡）', 'error'); return false; }

    const payload = {
      version: 1,
      entries: store.entries,
      importedWorldbookEntries: store.importedWorldbookEntries,
    };
    if (pool === 'global') payload.settings = settings;

    try {
      await callApi(fn, { [STORE_KEY]: payload }, poolOption(pool));
      // 新键写成功后再清旧键，顺序不能反——万一清完写失败，数据就没了
      if (legacyKeyUsed[pool]) {
        legacyKeyUsed[pool] = false;
        try {
          const del = G('deleteVariable');
          if (del) await callApi(del, LEGACY_STORE_KEY, poolOption(pool));
          log('已清理旧版数据键');
        } catch (e) { /* 清不掉也无妨，下次读取仍会优先用新键 */ }
      }
      return true;
    } catch (e) {
      console.error(TAG, '保存失败', e);
      toast(`保存失败：${e && e.message ? e.message : e}`, 'error');
      return false;
    }
  }

  // 写盘串行队列：点击条目这类操作是"即发即忘"地保存，
  // 快速连点时如果并发写盘，先发的旧数据可能后落盘，把新数据盖掉。
  let saveChain = Promise.resolve();
  function saveStore(pool) {
    const run = saveChain.then(() => writeStore(pool), () => writeStore(pool));
    saveChain = run.then(() => {}, () => {});
    return run;
  }

  /** 弹窗保存前的检查：数据池是否还是打开弹窗时那一个（切聊天/角色卡会换掉） */
  function storeStillValid(pool, captured) {
    const live = pool === 'card' ? cardStore : globalStore;
    if (!live || live !== captured) {
      toast('聊天或角色卡已切换，请关掉弹窗重新操作', 'warning');
      return false;
    }
    return true;
  }

  /**
   * 对某个池做一次「改动 → 保存 → 失败回滚」的原子操作。
   * 所有写盘路径都必须走这里：先改内存再保存，保存失败就把内存还原，
   * 否则会留下"界面显示已改、磁盘上没改"的幽灵状态，后续任何一次保存都会把它落盘。
   * @param {(store: object) => void} mutator 在 store 上做改动；抛错则自动回滚
   */
  async function mutateStore(pool, mutator) {
    const live = pool === 'card' ? cardStore : globalStore;
    if (!live) { toast('保存失败：数据池不可用', 'error'); return { ok: false, reason: 'no-store' }; }

    const snapshotEntries = live.entries.map((e) => JSON.parse(JSON.stringify(e)));
    const snapshotImported = JSON.parse(JSON.stringify(live.importedWorldbookEntries || {}));
    const rollback = () => {
      live.entries = snapshotEntries;
      live.importedWorldbookEntries = snapshotImported;
    };

    try {
      mutator(live);
    } catch (e) {
      console.error(TAG, '改动数据出错', e);
      rollback();
      toast('操作失败：' + (e && e.message ? e.message : e), 'error');
      return { ok: false, reason: 'mutator-error' };
    }

    const ok = await saveStore(pool);
    if (!ok) {
      rollback();
      return { ok: false, reason: 'save-failed' };
    }
    return { ok: true };
  }

  function loadAll() {
    globalStore = readStore('global') || emptyStore();
    cardStore = readStore('card');
    settings = Object.assign({}, DEFAULT_SETTINGS, globalStore.settings || {});
    // 用户手动切过页签就尊重他的选择，否则自动挑可用的池
    if (!state.poolPinned) state.pool = cardStore ? 'card' : 'global';
    else if (!cardStore && state.pool === 'card') state.pool = 'global';
  }

  const currentStore = () => (state.pool === 'card' ? cardStore : globalStore);
  const currentEntries = () => {
    const s = currentStore();
    return s ? s.entries : [];
  };

  /* ==================== 输入框注入 ==================== */
  /* __INJECT_SLICE_START__ */

  /** 降级查找输入框（快速回复等扩展可能替换掉整个输入栏） */
  function findSendTextarea() {
    const tries = [
      '#send_textarea',
      '#nonQRFormItems textarea',
      '#send_form textarea',
      '#form_sheld textarea',
    ];
    for (const sel of tries) {
      try {
        const node = doc.querySelector(sel);
        if (node) return node;
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  function copyToClipboard(text) {
    /** 老式兜底：临时 textarea + execCommand('copy') */
    const legacy = () => {
      try {
        const ta = doc.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
        doc.body.appendChild(ta);
        ta.select();
        const ok = doc.execCommand('copy');
        ta.remove();
        return !!ok;
      } catch (e) {
        return false;
      }
    };

    try {
      const cb = host.navigator && host.navigator.clipboard;
      if (cb && typeof cb.writeText === 'function') {
        const p = cb.writeText(text);
        if (p && typeof p.then === 'function') {
          // 异步通道的失败同步抓不到：失败时退回 execCommand，再失败就明确报错
          p.catch(() => {
            if (!legacy()) toast('复制到剪贴板失败，请手动复制', 'error');
          });
          return true;
        }
        return true;
      }
    } catch (e) { /* 落到 legacy */ }
    return legacy();
  }

  /**
   * 把文本注入酒馆输入框。
   * 写法与 SillyTavern 官方一致（/setinput、/impersonate、发送后清空三处都这么写）：
   *   设 value → 派发 input 事件 → focus → setSelectionRange
   */
  function injectToInputBox(text, cursor, mode, separator) {
    const ta = findSendTextarea();
    if (!ta) {
      const ok = copyToClipboard(text);
      toast(ok ? '未找到输入框，已复制到剪贴板' : '未找到输入框，注入失败', ok ? 'warning' : 'error');
      return false;
    }

    const selStart = typeof ta.selectionStart === 'number' ? ta.selectionStart : ta.value.length;
    const selEnd = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : selStart;
    const built = buildInjectedValue(ta.value, selStart, selEnd, text, cursor, mode, separator);

    try {
      ta.value = built.value;
      // 让酒馆同步内部状态（高度自适应、自动补全、其他扩展）
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
      if (typeof ta.setSelectionRange === 'function') {
        ta.setSelectionRange(built.cursor, built.cursor);
      }
      return true;
    } catch (e) {
      console.error(TAG, '注入失败', e);
      toast('注入失败：' + (e && e.message ? e.message : e), 'error');
      return false;
    }
  }
  /* __INJECT_SLICE_END__ */

  /** 点击条目 → 注入 */
  function injectEntry(entry) {
    if (!entry) return;
    const parsed = parseContent(entry.content);
    if (!parsed.text) { toast('这个条目还没有注入内容', 'warning'); return; }

    const ok = injectToInputBox(
      parsed.text,
      parsed.cursor,
      settings.injectMode,
      SEPARATOR_MAP[settings.appendSeparator],
    );
    if (!ok) return;

    entry.useCount = (entry.useCount || 0) + 1;
    entry.lastUsedAt = Date.now();
    saveStore(state.pool);

    setStatus(`已注入：${entry.title || '（无标题）'}`);
    if (settings.autoCloseAfterInject) closePanel();
  }

  /* ==================== 样式 ==================== */

  const CSS_TEXT = `
#${PANEL_ID} {
  --rpt-bg: #1e2127;
  --rpt-card: #262a33;
  --rpt-hover: #2f3542;
  --rpt-fg: #e2dfd7;
  --rpt-muted: #8b93a7;
  --rpt-border: #383e4d;
  --rpt-accent: #7c5cff;
  --rpt-danger: #d9534f;
  /* kbd 用独立配色：深色主题下 muted 灰在深底上对比度不够 */
  --rpt-key: #333a47;
  --rpt-key-fg: #f0eee8;
  position: fixed;
  z-index: 99991;
  width: 420px;
  max-width: calc(100vw - 16px);
  max-height: min(560px, calc(100vh - 60px));
  display: flex;
  flex-direction: column;
  background: var(--rpt-bg);
  color: var(--rpt-fg);
  border: 1px solid var(--rpt-border);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,.45);
  font: 13px/1.5 "Noto Sans SC","Segoe UI","Microsoft YaHei",sans-serif;
  overflow: hidden;
  box-sizing: border-box;
}
#${PANEL_ID}.rpt-light {
  --rpt-bg: #f5f5f7;
  --rpt-card: #ffffff;
  --rpt-hover: #ececf0;
  --rpt-fg: #2c2c2e;
  --rpt-muted: #6b7280;
  --rpt-border: #d9d9de;
  --rpt-key: #e6e6eb;
  --rpt-key-fg: #2c2c2e;
}
#${PANEL_ID}.rpt-hidden { display: none; }
#${PANEL_ID} * { box-sizing: border-box; }

#${PANEL_ID} .rpt-head {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 10px; border-bottom: 1px solid var(--rpt-border);
  cursor: grab; user-select: none; flex: 0 0 auto;
}
#${PANEL_ID} .rpt-head.rpt-dragging { cursor: grabbing; }
#${PANEL_ID} .rpt-brand { font-weight: 600; white-space: nowrap; }
#${PANEL_ID} .rpt-tabs { display: flex; gap: 4px; flex: 1 1 auto; }
#${PANEL_ID} .rpt-tab {
  padding: 3px 9px; border-radius: 999px; cursor: pointer;
  border: 1px solid transparent; background: transparent;
  color: var(--rpt-muted); font: inherit; font-size: 12px; white-space: nowrap;
}
#${PANEL_ID} .rpt-tab:hover:not(:disabled) { background: var(--rpt-hover); }
#${PANEL_ID} .rpt-tab.rpt-active { background: var(--rpt-accent); color: #fff; }
#${PANEL_ID} .rpt-tab:disabled { opacity: .4; cursor: not-allowed; }
#${PANEL_ID} .rpt-head-actions { display: flex; gap: 2px; flex: 0 0 auto; }
#${PANEL_ID} .rpt-icon {
  width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--rpt-muted);
  border-radius: 6px; cursor: pointer; font-size: 14px; line-height: 1; padding: 0;
}
#${PANEL_ID} .rpt-icon:hover { background: var(--rpt-hover); color: var(--rpt-fg); }

#${PANEL_ID} .rpt-notice {
  flex: 0 0 auto; padding: 6px 10px; font-size: 12px;
  color: var(--rpt-fg); background: var(--rpt-card);
  border-bottom: 1px solid var(--rpt-border); line-height: 1.7;
}
#${PANEL_ID} .rpt-search-row { padding: 8px 10px; border-bottom: 1px solid var(--rpt-border); flex: 0 0 auto; }
#${PANEL_ID} .rpt-search {
  width: 100%; padding: 6px 10px; border-radius: 8px; font: inherit;
  background: var(--rpt-card); color: var(--rpt-fg);
  border: 1px solid var(--rpt-border); outline: none;
}
#${PANEL_ID} .rpt-search:focus { border-color: var(--rpt-accent); }

#${PANEL_ID} .rpt-list { flex: 1 1 auto; overflow-y: auto; padding: 6px; }
#${PANEL_ID} .rpt-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
  border: 1px solid transparent;
}
#${PANEL_ID} .rpt-item:hover { background: var(--rpt-hover); border-color: var(--rpt-border); }
#${PANEL_ID} .rpt-item.rpt-flash { background: var(--rpt-accent); }
#${PANEL_ID} .rpt-item-main { flex: 1 1 auto; min-width: 0; }
#${PANEL_ID} .rpt-item-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#${PANEL_ID} .rpt-item-desc {
  font-size: 12px; color: var(--rpt-muted); margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#${PANEL_ID} .rpt-item-actions { display: flex; gap: 2px; flex: 0 0 auto; opacity: 0; transition: opacity .12s; }
#${PANEL_ID} .rpt-item:hover .rpt-item-actions { opacity: 1; }
#${PANEL_ID} .rpt-item-actions .rpt-icon { width: 24px; height: 24px; font-size: 13px; }
#${PANEL_ID} .rpt-item-actions .rpt-del:hover { background: var(--rpt-danger); color: #fff; }
#${PANEL_ID} .rpt-empty { padding: 26px 16px; text-align: center; color: var(--rpt-muted); font-size: 12px; line-height: 1.9; }
#${PANEL_ID} .rpt-empty kbd, #${PANEL_ID} .rpt-notice kbd {
  background: var(--rpt-key); color: var(--rpt-key-fg);
  border: 1px solid var(--rpt-border); border-radius: 4px;
  padding: 0 5px; font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: 12px;
}

#${PANEL_ID} .rpt-foot {
  flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-top: 1px solid var(--rpt-border);
  font-size: 12px; color: var(--rpt-muted);
}
#${PANEL_ID} .rpt-status { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#${PANEL_ID} .rpt-foot .rpt-btn { flex: 0 0 auto; }

#${PANEL_ID} .rpt-btn {
  padding: 4px 10px; border-radius: 6px; cursor: pointer; font: inherit; font-size: 12px;
  background: var(--rpt-card); color: var(--rpt-fg); border: 1px solid var(--rpt-border);
}
#${PANEL_ID} .rpt-btn:hover { background: var(--rpt-hover); }
#${PANEL_ID} .rpt-btn.rpt-primary { background: var(--rpt-accent); border-color: transparent; color: #fff; }
#${PANEL_ID} .rpt-btn.rpt-danger { background: var(--rpt-danger); border-color: transparent; color: #fff; }

#${BALL_ID} {
  position: fixed; z-index: 999990;
  width: 46px; height: 46px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 21px; line-height: 1;
  background: rgba(15,23,42,.92); color: #fff;
  border: 1px solid rgba(255,255,255,.2);
  box-shadow: 0 4px 14px rgba(0,0,0,.4);
  cursor: grab; user-select: none; touch-action: none;
}
#${BALL_ID}.rpt-dragging { cursor: grabbing; }

.rpt-modal-mask {
  position: fixed; inset: 0; z-index: 99999;
  background: rgba(0,0,0,.5);
  display: flex; align-items: center; justify-content: center;
}
.rpt-modal {
  --rpt-bg: #1e2127;
  --rpt-card: #262a33;
  --rpt-hover: #2f3542;
  --rpt-fg: #e2dfd7;
  --rpt-muted: #8b93a7;
  --rpt-border: #383e4d;
  --rpt-accent: #7c5cff;
  --rpt-danger: #d9534f;
  --rpt-key: #333a47;
  --rpt-key-fg: #f0eee8;
  width: min(560px, 94vw); max-height: 88vh; overflow: auto;
  background: var(--rpt-bg); color: var(--rpt-fg);
  border: 1px solid var(--rpt-border); border-radius: 12px;
  padding: 16px 18px;
  box-shadow: 0 16px 48px rgba(0,0,0,.55);
  font: 13px/1.55 "Noto Sans SC","Segoe UI","Microsoft YaHei",sans-serif;
  box-sizing: border-box;
}
.rpt-modal.rpt-light {
  --rpt-bg: #f5f5f7;
  --rpt-card: #ffffff;
  --rpt-hover: #ececf0;
  --rpt-fg: #2c2c2e;
  --rpt-muted: #6b7280;
  --rpt-border: #d9d9de;
  --rpt-key: #e6e6eb;
  --rpt-key-fg: #2c2c2e;
}
.rpt-modal * { box-sizing: border-box; }
.rpt-modal h3 { margin: 0 0 14px; font-size: 15px; font-weight: 600; }
.rpt-modal .rpt-field { margin-bottom: 12px; }
.rpt-modal .rpt-label { display: block; font-size: 12px; color: var(--rpt-muted); margin-bottom: 4px; }
.rpt-modal .rpt-input, .rpt-modal .rpt-textarea {
  width: 100%; padding: 7px 10px; border-radius: 8px; font: inherit;
  background: var(--rpt-card); color: var(--rpt-fg);
  border: 1px solid var(--rpt-border); outline: none;
}
.rpt-modal .rpt-textarea { min-height: 88px; resize: vertical; line-height: 1.5; }
.rpt-modal .rpt-input:focus, .rpt-modal .rpt-textarea:focus { border-color: var(--rpt-accent); }
.rpt-modal .rpt-hint { font-size: 11.5px; color: var(--rpt-muted); margin-top: 5px; }
.rpt-modal kbd {
  background: var(--rpt-key); color: var(--rpt-key-fg);
  border: 1px solid var(--rpt-border); border-radius: 4px;
  padding: 0 5px; font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: 12px;
}
.rpt-modal .rpt-preview {
  margin-top: 8px; padding: 8px 10px; border-radius: 8px;
  background: var(--rpt-card); border: 1px dashed var(--rpt-border);
  font-size: 12.5px; word-break: break-all; white-space: pre-wrap;
}
.rpt-modal .rpt-caret {
  display: inline-block; width: 2px; height: 1.05em; vertical-align: -.15em;
  background: var(--rpt-accent); animation: rpt-blink 1s steps(1) infinite;
}
@keyframes rpt-blink { 50% { opacity: 0; } }
.rpt-modal .rpt-actions {
  display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;
}
.rpt-modal .rpt-actions.rpt-split { justify-content: space-between; }
.rpt-modal .rpt-btn {
  padding: 6px 14px; border-radius: 7px; cursor: pointer; font: inherit;
  background: var(--rpt-card); color: var(--rpt-fg); border: 1px solid var(--rpt-border);
}
.rpt-modal .rpt-btn:hover { background: var(--rpt-hover); }
.rpt-modal .rpt-btn.rpt-primary { background: var(--rpt-accent); border-color: transparent; color: #fff; }
.rpt-modal .rpt-btn.rpt-danger { background: var(--rpt-danger); border-color: transparent; color: #fff; }
.rpt-modal .rpt-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.rpt-modal .rpt-row label { flex: 1 1 auto; }
.rpt-modal select.rpt-input { cursor: pointer; }
.rpt-modal .rpt-check-list {
  max-height: 320px; overflow-y: auto; margin-top: 8px;
  border: 1px solid var(--rpt-border); border-radius: 8px; padding: 4px;
}
.rpt-modal .rpt-check-item {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 6px 8px; border-radius: 6px; cursor: pointer;
}
.rpt-modal .rpt-check-item:hover { background: var(--rpt-hover); }
.rpt-modal .rpt-check-item.rpt-exists { opacity: .5; cursor: not-allowed; }
.rpt-modal .rpt-check-item input { margin-top: 3px; flex: 0 0 auto; }
.rpt-modal .rpt-check-main { min-width: 0; flex: 1 1 auto; }
.rpt-modal .rpt-check-name { font-weight: 600; }
.rpt-modal .rpt-check-preview {
  font-size: 11.5px; color: var(--rpt-muted); margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rpt-modal .rpt-lib-group {
  font-size: 11.5px; color: var(--rpt-muted); font-weight: 600;
  padding: 8px 8px 4px; letter-spacing: .04em;
}
.rpt-modal .rpt-lib-group:first-child { padding-top: 4px; }
.rpt-modal .rpt-lib-sample {
  display: inline-block; margin-left: 6px; padding: 0 5px;
  background: var(--rpt-key); color: var(--rpt-key-fg);
  border-radius: 4px; font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: 11px; white-space: pre;
}
.rpt-modal .rpt-tag {
  margin-left: 6px; padding: 0 5px; border-radius: 4px; font-size: 10.5px;
  font-weight: 400; background: var(--rpt-key); color: var(--rpt-muted);
}
.rpt-modal .rpt-danger-zone {
  border: 1px solid var(--rpt-danger); border-radius: 8px;
  padding: 10px 12px; margin-top: 4px;
}
.rpt-modal .rpt-danger-zone .rpt-hint { margin-top: 8px; }
.rpt-modal .rpt-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.rpt-modal .rpt-tab {
  padding: 4px 12px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 12.5px;
  background: var(--rpt-card); color: var(--rpt-muted); border: 1px solid var(--rpt-border);
}
.rpt-modal .rpt-tab.rpt-active { background: var(--rpt-accent); color: #fff; border-color: transparent; }
`;

  function detectDark() {
    // 酒馆没有明暗类名，改为计算背景色亮度
    try {
      const body = doc.body;
      if (body && (body.classList.contains('dark') || doc.documentElement.classList.contains('dark'))) return true;
      let node = body;
      for (let i = 0; i < 4 && node; i++) {
        const bg = host.getComputedStyle(node).backgroundColor;
        const m = bg && bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/);
        if (m && (m[4] === undefined || parseFloat(m[4]) > 0.5)) {
          const lum = (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
          return lum < 0.55;
        }
        node = node.parentElement || doc.documentElement;
      }
    } catch (e) { /* ignore */ }
    return true;
  }

  function injectStyles() {
    let style = doc.getElementById(STYLE_ID);
    if (!style) {
      style = doc.createElement('style');
      style.id = STYLE_ID;
      doc.head.appendChild(style);
    }
    style.textContent = CSS_TEXT;
  }

  const isLight = () => settings.theme === 'light' || (settings.theme !== 'dark' && !detectDark());

  function applyTheme(node) {
    if (!node) return;
    node.classList.toggle('rpt-light', isLight());
  }

  /* ==================== 弹窗 ==================== */
  /* __MODAL_SLICE_START__ */

  let modalSeq = 0;              // 弹窗令牌自增源

  /**
   * 弹出弹窗。
   *
   * 关于令牌：`closeModal()` 只关「令牌匹配」的那一个弹窗。
   * 原因是一个真实踩过的时序坑——按钮处理器里 `await b.onClick()` 之后才调
   * closeModal，而 onClick 里 resolve 的 Promise 续体是更早入队的微任务，
   * 于是续体可能已经弹出了下一个弹窗、`state.openModalEl` 已经指向新弹窗，
   * 这时无令牌的 closeModal 会把**新弹窗**关掉。串联确认（清空数据的三次确认）
   * 正是这种模式，表现为"点继续等于取消"。
   */
  function showModal({ title, contentEl, buttons, wide, onClose }) {
    closeModal();
    const token = ++modalSeq;
    const box = el('div', { class: 'rpt-modal' }, [
      el('h3', { text: title }),
      contentEl || null,
    ]);
    if (wide) box.style.width = 'min(720px, 96vw)';

    const actions = el('div', { class: 'rpt-actions' });
    const buttonList = buttons || [];
    for (const b of buttonList) {
      const btn = el('button', {
        class: `rpt-btn${b.primary ? ' rpt-primary' : ''}${b.danger ? ' rpt-danger' : ''}`,
        text: b.text,
        type: 'button',
      });
      btn.addEventListener('click', async () => {
        let ok = true;
        if (b.onClick) {
          try {
            ok = (await b.onClick()) !== false;
          } catch (e) {
            console.error(TAG, '弹窗按钮回调出错', e);
            ok = false;
          }
        }
        if (ok !== false) closeModal(token);
      });
      actions.appendChild(btn);
    }
    // 按钮为空时不渲染操作行（面板自带操作行的弹窗用这个分支）
    if (buttonList.length) box.appendChild(actions);

    const mask = el('div', { class: 'rpt-modal-mask' }, box);
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) closeModal(token); });
    doc.body.appendChild(mask);
    applyTheme(box);
    state.openModalEl = mask;
    state.openModalToken = token;
    state.openModalOnClose = typeof onClose === 'function' ? onClose : null;
    return mask;
  }

  /**
   * 关闭弹窗。
   * @param {number} [token] 只关这一个；不传则关当前弹窗（用于"替换"场景）
   */
  function closeModal(token) {
    if (!state.openModalEl) return;
    if (token !== undefined && token !== state.openModalToken) return;
    const cb = state.openModalOnClose;
    state.openModalEl.remove();
    state.openModalEl = null;
    state.openModalToken = 0;
    state.openModalOnClose = null;
    if (cb) {
      try { cb(); } catch (e) { /* ignore */ }
    }
  }

  const modalOpen = () => !!state.openModalEl;

  /**
   * Promise 化的确认框。返回 true 表示用户确认，false 表示取消/关闭。
   * 用于需要串联多次确认的危险操作。
   */
  function askConfirm(title, message, opts = {}) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      showModal({
        title,
        contentEl: el('div', { style: 'line-height:1.9;' }, message),
        onClose: () => finish(false),
        buttons: [
          { text: opts.cancelText || '取消', onClick: () => finish(false) },
          {
            text: opts.okText || '确定',
            danger: !!opts.danger,
            primary: !opts.danger,
            onClick: () => finish(true),
          },
        ],
      });
    });
  }
  /* __MODAL_SLICE_END__ */

  /* ==================== 面板 ==================== */

  function buildPanel() {
    const existing = doc.getElementById(PANEL_ID);
    if (existing) return existing;

    let searchTimer = null;

    const panel = el('div', { id: PANEL_ID, class: 'rpt-hidden' });

    const head = el('div', { class: 'rpt-head' }, [
      el('span', { class: 'rpt-brand', text: '🐧 角色提词器' }),
      el('div', { class: 'rpt-tabs' }, [
        el('button', { class: 'rpt-tab', dataset: { pool: 'card' }, type: 'button' }),
        el('button', { class: 'rpt-tab', dataset: { pool: 'global' }, type: 'button' }),
      ]),
      el('div', { class: 'rpt-head-actions' }, [
        el('button', { class: 'rpt-icon', title: '新建条目', text: '＋', dataset: { act: 'add' }, type: 'button' }),
        el('button', { class: 'rpt-icon', title: '设置', text: '⚙', dataset: { act: 'settings' }, type: 'button' }),
        el('button', { class: 'rpt-icon', title: '关闭', text: '✕', dataset: { act: 'close' }, type: 'button' }),
      ]),
    ]);

    const searchRow = el('div', { class: 'rpt-search-row' }, [
      el('input', { class: 'rpt-search', placeholder: '🔍 搜索标题或描述…', type: 'text' }),
    ]);

    const list = el('div', { class: 'rpt-list' });

    const foot = el('div', { class: 'rpt-foot' }, [
      el('span', { class: 'rpt-status', text: '就绪' }),
      el('button', { class: 'rpt-btn', text: '预设库', dataset: { act: 'library' }, type: 'button' }),
      el('button', { class: 'rpt-btn', text: '批量导入', dataset: { act: 'import' }, type: 'button' }),
    ]);

    panel.appendChild(head);
    panel.appendChild(searchRow);
    panel.appendChild(list);
    panel.appendChild(foot);
    doc.body.appendChild(panel);

    // 拖动
    makeDraggable(panel, head, (pos) => {
      settings.panelPosition = pos;
      saveStore('global');
    });

    // 头部按钮
    head.querySelector('.rpt-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.rpt-tab');
      if (!btn || btn.disabled) return;
      state.pool = btn.dataset.pool;
      state.poolPinned = true;
      state.keyword = '';
      clearTimeout(searchTimer);          // 取消挂起的搜索防抖，否则旧关键词会被写回来
      const s = panel.querySelector('.rpt-search');
      if (s) s.value = '';
      renderAll();
    });

    const handleAct = (act) => {
      if (act === 'add') openEntryEditor(null);
      else if (act === 'import') openImportDialog();
      else if (act === 'library') openLibraryDialog();
      else if (act === 'settings') openSettings();
      else if (act === 'close') closePanel();
    };

    head.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn) handleAct(btn.dataset.act);
    });

    foot.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn) handleAct(btn.dataset.act);
    });

    // 搜索（防抖；searchTimer 在页签切换时会被清掉）
    searchRow.querySelector('.rpt-search').addEventListener('input', (e) => {
      const v = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.keyword = v; renderList(); }, 120);
    });

    // 列表点击（事件委托）
    list.addEventListener('click', (e) => {
      const item = e.target.closest('.rpt-item');
      if (!item) return;
      const id = item.dataset.id;
      const actBtn = e.target.closest('[data-act]');
      if (actBtn) {
        e.stopPropagation();
        if (actBtn.dataset.act === 'edit') openEntryEditor(id);
        else if (actBtn.dataset.act === 'del') confirmDelete(id);
        return;
      }
      const entry = currentEntries().find((x) => x.id === id);
      if (entry) injectEntry(entry);
    });

    applyTheme(panel);
    return panel;
  }

  function renderTabs() {
    const panel = doc.getElementById(PANEL_ID);
    if (!panel) return;
    const cardBtn = panel.querySelector('.rpt-tab[data-pool="card"]');
    const globalBtn = panel.querySelector('.rpt-tab[data-pool="global"]');
    const cardCount = cardStore ? cardStore.entries.length : 0;
    const globalCount = globalStore ? globalStore.entries.length : 0;

    cardBtn.textContent = `本卡 ${cardCount}`;
    globalBtn.textContent = `通用 ${globalCount}`;
    cardBtn.disabled = !cardStore;
    cardBtn.title = cardStore ? '当前角色卡的条目（随角色卡导出）' : '没有打开角色卡';
    globalBtn.title = '跨角色卡通用的条目（随用户存档）';

    cardBtn.classList.toggle('rpt-active', state.pool === 'card');
    globalBtn.classList.toggle('rpt-active', state.pool === 'global');

    // 没有角色卡时给一行常驻提示（页签置灰容易被忽略）
    let notice = panel.querySelector('.rpt-notice');
    if (!cardStore) {
      if (!notice) {
        notice = el('div', { class: 'rpt-notice', text: '没有打开角色卡，只能看到「通用」条目' });
        panel.insertBefore(notice, panel.querySelector('.rpt-search-row'));
      }
    } else if (notice) {
      notice.remove();
    }
  }

  function renderList() {
    const panel = doc.getElementById(PANEL_ID);
    if (!panel) return;
    const list = panel.querySelector('.rpt-list');
    list.textContent = '';

    if (!currentStore()) {
      list.appendChild(el('div', { class: 'rpt-empty' }, [
        '当前没有打开角色卡，看不到「本卡」条目。',
        el('br'),
        '可以切到「通用」页签，或先打开一张角色卡。',
      ]));
      return;
    }

    const entries = filterEntries(currentEntries(), state.keyword);
    if (!entries.length) {
      const isSearching = !!String(state.keyword || '').trim();
      list.appendChild(el('div', { class: 'rpt-empty' }, isSearching ? [
        '没有匹配的条目。',
      ] : [
        '这里还没有条目。',
        el('br'),
        '点右上角 ',
        el('kbd', { text: '＋' }),
        ' 新建一条，或点底部的「预设库」挑几个常用格式。',
        el('br'),
        '「批量导入」能从世界书里扫出一堆角色名，也可以直接粘贴名字列表。',
        el('br'),
        '在注入内容里写 ',
        el('kbd', { text: '|' }),
        ' 可以指定光标落点。',
      ]));
      return;
    }

    for (const entry of entries) {
      const item = el('div', { class: 'rpt-item', dataset: { id: entry.id } }, [
        el('div', { class: 'rpt-item-main' }, [
          el('div', { class: 'rpt-item-title', text: entry.title || '（无标题）' }),
          entry.desc ? el('div', { class: 'rpt-item-desc', title: entry.desc, text: entry.desc }) : null,
        ]),
        el('div', { class: 'rpt-item-actions' }, [
          el('button', { class: 'rpt-icon', title: '编辑', text: '✎', dataset: { act: 'edit' }, type: 'button' }),
          el('button', { class: 'rpt-icon rpt-del', title: '删除', text: '×', dataset: { act: 'del' }, type: 'button' }),
        ]),
      ]);
      list.appendChild(item);
    }
  }

  function renderAll() {
    renderTabs();
    renderList();
  }

  function setStatus(text) {
    const panel = doc.getElementById(PANEL_ID);
    if (!panel) return;
    const node = panel.querySelector('.rpt-status');
    if (node) node.textContent = text;
  }

  function applyPanelPosition() {
    const panel = doc.getElementById(PANEL_ID);
    if (!panel) return;
    const w = panel.offsetWidth || 420;
    const h = panel.offsetHeight || 480;

    const saved = settings.panelPosition;
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      panel.style.left = clamp(saved.x, 8, Math.max(8, host.innerWidth - w - 8)) + 'px';
      panel.style.top = clamp(saved.y, 8, Math.max(8, host.innerHeight - h - 8)) + 'px';
      return;
    }

    let left = clamp(Math.round((host.innerWidth - w) / 2), 8, Math.max(8, host.innerWidth - w - 8));
    let top = clamp(Math.round((host.innerHeight - h) / 2), 8, Math.max(8, host.innerHeight - h - 8));

    const ta = findSendTextarea();
    if (ta) {
      try {
        const r = ta.getBoundingClientRect();
        left = clamp(Math.round(r.left + r.width / 2 - w / 2), 8, Math.max(8, host.innerWidth - w - 8));
        const above = Math.round(r.top - h - 10);
        top = above >= 8 ? above : clamp(Math.round(r.bottom + 10), 8, Math.max(8, host.innerHeight - h - 8));
      } catch (e) { /* ignore */ }
    }
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  function openPanel() {
    if (host[INSTANCE_KEY] !== TOKEN) {
      toast('检测到另一个角色提词器实例在运行，请到脚本库只保留一个', 'error');
      return;
    }
    // 同一次点击里刚被"点击外部"关掉时不立刻重开，让入口表现为开关切换
    if (Date.now() - state.lastClosedAt < 400) return;

    buildPanel();
    const panel = doc.getElementById(PANEL_ID);
    panel.style.visibility = 'hidden';
    panel.classList.remove('rpt-hidden');
    applyTheme(panel);
    applyPanelPosition();
    renderAll();
    panel.style.visibility = '';
  }

  function closePanel() {
    const panel = doc.getElementById(PANEL_ID);
    if (panel) panel.classList.add('rpt-hidden');
    state.lastClosedAt = Date.now();
  }

  const panelOpen = () => {
    const panel = doc.getElementById(PANEL_ID);
    return !!(panel && !panel.classList.contains('rpt-hidden'));
  };

  function togglePanel() {
    if (panelOpen()) closePanel();
    else openPanel();
  }

  /* ==================== 拖动 ==================== */

  function makeDraggable(target, handle, onEnd) {
    let dragging = false;
    let moved = false;
    let sx = 0; let sy = 0; let ox = 0; let oy = 0;

    const begin = (x, y) => {
      const r = target.getBoundingClientRect();
      sx = x; sy = y; ox = r.left; oy = r.top;
      dragging = true; moved = false;
      target.classList.add('rpt-dragging');
    };
    const move = (x, y) => {
      if (!dragging) return;
      const dx = x - sx;
      const dy = y - sy;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      const w = target.offsetWidth;
      const h = target.offsetHeight;
      target.style.left = clamp(ox + dx, 8, Math.max(8, host.innerWidth - w - 8)) + 'px';
      target.style.top = clamp(oy + dy, 8, Math.max(8, host.innerHeight - h - 8)) + 'px';
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      target.classList.remove('rpt-dragging');
      if (moved && typeof onEnd === 'function') {
        onEnd({
          x: parseFloat(target.style.left) || 0,
          y: parseFloat(target.style.top) || 0,
        });
      }
      // 拖动结束后紧跟的 click 要拦掉，否则会误触发点击
      if (moved) {
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        doc.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => doc.removeEventListener('click', swallow, { capture: true }), 0);
      }
    };

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest('button,input,textarea,select')) return;
      e.preventDefault();
      begin(e.clientX, e.clientY);
    });
    onPage(doc, 'mousemove', (e) => move(e.clientX, e.clientY));
    onPage(doc, 'mouseup', end);

    handle.addEventListener('touchstart', (e) => {
      if (e.target.closest && e.target.closest('button,input,textarea,select')) return;
      const t = e.touches[0];
      if (t) begin(t.clientX, t.clientY);
    }, { passive: true });
    onPage(doc, 'touchmove', (e) => {
      const t = e.touches[0];
      if (t) move(t.clientX, t.clientY);
    }, { passive: true });
    onPage(doc, 'touchend', end);
  }

  /* ==================== 悬浮球 ==================== */

  // 悬浮球会在设置里开关，重建时必须撤掉上一轮注册在 doc 上的监听，否则会越积越多
  let ballListeners = [];
  function clearBallListeners() {
    for (const [target, type, fn] of ballListeners) {
      try { target.removeEventListener(type, fn); } catch (e) { /* ignore */ }
    }
    ballListeners = [];
  }
  function onBall(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    ballListeners.push([target, type, fn]);
  }

  function buildBall() {
    clearBallListeners();
    const old = doc.getElementById(BALL_ID);
    if (old) old.remove();
    if (!settings.showFloatingBall) return;

    const size = 46;
    const pos = settings.ballPosition && Number.isFinite(settings.ballPosition.x)
      ? settings.ballPosition
      : { x: host.innerWidth - size - 18, y: Math.round(host.innerHeight * 0.72) };

    const ball = el('div', {
      id: BALL_ID,
      title: '角色提词器（点击打开，右键隐藏）',
      text: '🐧',
    });
    ball.style.left = clamp(pos.x, 8, Math.max(8, host.innerWidth - size - 8)) + 'px';
    ball.style.top = clamp(pos.y, 8, Math.max(8, host.innerHeight - size - 8)) + 'px';

    let sx = 0; let sy = 0; let ox = 0; let oy = 0;
    let dragging = false;
    let moved = false;

    const move = (x, y) => {
      if (!dragging) return;
      const dx = x - sx;
      const dy = y - sy;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      ball.style.left = clamp(ox + dx, 8, Math.max(8, host.innerWidth - size - 8)) + 'px';
      ball.style.top = clamp(oy + dy, 8, Math.max(8, host.innerHeight - size - 8)) + 'px';
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      ball.classList.remove('rpt-dragging');
      if (moved) {
        settings.ballPosition = {
          x: parseFloat(ball.style.left) || 0,
          y: parseFloat(ball.style.top) || 0,
        };
        saveStore('global');
        setTimeout(() => { moved = false; }, 120);
      }
    };
    const begin = (x, y) => {
      const r = ball.getBoundingClientRect();
      sx = x; sy = y; ox = r.left; oy = r.top;
      dragging = true; moved = false;
      ball.classList.add('rpt-dragging');
    };

    ball.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      begin(e.clientX, e.clientY);
    });
    onBall(doc, 'mousemove', (e) => move(e.clientX, e.clientY));
    onBall(doc, 'mouseup', end);

    ball.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (t) begin(t.clientX, t.clientY);
    }, { passive: true });
    onBall(doc, 'touchmove', (e) => {
      const t = e.touches[0];
      if (t) move(t.clientX, t.clientY);
    }, { passive: true });
    onBall(doc, 'touchend', end);

    ball.addEventListener('click', (e) => {
      if (moved) return;
      e.stopPropagation();
      togglePanel();
    });

    ball.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // 右键是唯一的"破坏性"入口，加一次确认，避免误触后找不到入口
      let yes = true;
      try {
        yes = typeof host.confirm === 'function' ? host.confirm('隐藏悬浮球？可在设置里重新开启。') : true;
      } catch (err) { yes = true; }
      if (!yes) return;
      settings.showFloatingBall = false;
      saveStore('global');
      clearBallListeners();
      ball.remove();
      toast('悬浮球已隐藏，可在设置里重新开启');
    });

    doc.body.appendChild(ball);
  }

  /* ==================== 条目编辑 ==================== */

  function openEntryEditor(id) {
    const store = currentStore();
    if (!store) { toast('当前没有可用条目池', 'warning'); return; }

    const editing = id ? store.entries.find((x) => x.id === id) : null;
    state.editingId = editing ? editing.id : null;

    const titleInput = el('input', {
      class: 'rpt-input', type: 'text', placeholder: '例如：徐渭',
      value: editing ? editing.title : '',
    });
    const descInput = el('input', {
      class: 'rpt-input', type: 'text', placeholder: '例如：{{user}}，冷漠剑客（只给自己看，不会注入）',
      value: editing ? editing.desc : '',
    });
    const contentArea = el('textarea', {
      class: 'rpt-textarea',
      placeholder: '例如：徐渭：“|”',
    });
    contentArea.value = editing ? editing.content : '';

    const preview = el('div', { class: 'rpt-preview' });
    const renderPreview = () => {
      const raw = contentArea.value;
      if (!raw) {
        preview.textContent = '（还没有注入内容）';
        return;
      }
      const parsed = parseContent(raw);
      preview.textContent = '';
      const before = parsed.text.slice(0, parsed.cursor);
      const after = parsed.text.slice(parsed.cursor);
      preview.appendChild(doc.createTextNode(before));
      preview.appendChild(el('span', { class: 'rpt-caret' }));
      preview.appendChild(doc.createTextNode(after));
    };
    contentArea.addEventListener('input', renderPreview);
    renderPreview();

    const body = el('div', {}, [
      el('div', { class: 'rpt-field' }, [
        el('label', { class: 'rpt-label', text: '标题' }),
        titleInput,
      ]),
      el('div', { class: 'rpt-field' }, [
        el('label', { class: 'rpt-label', text: '描述（只给自己看，不会注入）' }),
        descInput,
      ]),
      el('div', { class: 'rpt-field' }, [
        el('label', { class: 'rpt-label', text: '注入内容' }),
        contentArea,
        el('div', { class: 'rpt-hint' }, [
          '用 ',
          el('kbd', { text: '|' }),
          ' 标记光标落点（注入后光标停在这里，标记本身不会出现）。',
          el('br'),
          '想注入一个真正的竖线就写 ',
          el('kbd', { text: '\\|' }),
          '。不写标记时光标停在末尾。',
        ]),
        preview,
      ]),
    ]);

    const save = async () => {
      const title = titleInput.value.trim();
      if (!title) { toast('标题不能为空', 'warning'); return false; }
      // 注入内容留空时按设计自动填默认模板，而不是拦着不让存
      const content = contentArea.value.trim() ? contentArea.value : defaultContent(title);

      if (!storeStillValid(state.pool, store)) return false;

      const editingId = editing ? editing.id : null;
      const res = await mutateStore(state.pool, (live) => {
        if (editingId) {
          const target = live.entries.find((x) => x.id === editingId);
          if (!target) throw new Error('条目已不存在，可能已被删除');
          target.title = title;
          target.desc = descInput.value;
          target.content = content;
          target.updatedAt = Date.now();
        } else {
          const titles = live.entries.map((x) => x.title);
          live.entries.push(normalizeEntry({
            id: newId(),
            title: uniqueTitle(title, titles),
            desc: descInput.value,
            content,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }));
        }
      });

      if (res.ok) {
        renderAll();
        setStatus(editingId ? '已保存修改' : '已新建条目');
      }
      return res.ok;
    };

    showModal({
      title: editing ? '编辑条目' : '新建条目',
      contentEl: body,
      buttons: [
        { text: '取消' },
        { text: '保存', primary: true, onClick: save },
      ],
    });

    titleInput.focus();
    titleInput.select();
  }

  function confirmDelete(id) {
    const store = currentStore();
    if (!store) return;
    const entry = store.entries.find((x) => x.id === id);
    if (!entry) return;

    showModal({
      title: '删除条目',
      contentEl: el('div', {}, [
        '确定要删除「',
        el('b', { text: entry.title || '（无标题）' }),
        '」吗？此操作不可撤销。',
      ]),
      buttons: [
        { text: '取消' },
        {
          text: '删除',
          danger: true,
          onClick: async () => {
            if (!storeStillValid(state.pool, store)) return false;
            const res = await mutateStore(state.pool, (live) => {
              live.entries = live.entries.filter((x) => x.id !== id);
            });
            if (res.ok) {
              renderAll();
              setStatus(`已删除：${entry.title}`);
            }
            return res.ok;
          },
        },
      ],
    });
  }

  /* ==================== 批量导入 ==================== */

  function openImportDialog() {
    const store = currentStore();
    if (!store) { toast('当前没有可用条目池', 'warning'); return; }

    let mode = 'worldbook';

    const body = el('div', {});
    const tabs = el('div', { class: 'rpt-tabs' }, [
      el('button', { class: 'rpt-tab rpt-active', text: '从世界书导入', dataset: { mode: 'worldbook' }, type: 'button' }),
      el('button', { class: 'rpt-tab', text: '批量粘贴', dataset: { mode: 'paste' }, type: 'button' }),
    ]);
    const pane = el('div', {});
    body.appendChild(tabs);
    body.appendChild(pane);

    let buildWorldbookPane = () => {};
    let buildPastePane = () => {};

    const switchMode = (next) => {
      mode = next;
      tabs.querySelectorAll('.rpt-tab').forEach((b) => b.classList.toggle('rpt-active', b.dataset.mode === mode));
      pane.textContent = '';
      if (mode === 'worldbook') buildWorldbookPane();
      else buildPastePane();
    };
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.rpt-tab');
      if (btn) switchMode(btn.dataset.mode);
    });

    /* ---- 批量粘贴 ---- */
    buildPastePane = () => {
      const area = el('textarea', {
        class: 'rpt-textarea',
        placeholder: '一行一个名字，例如：\n徐渭\n沈砚\n柳娘',
      });
      area.style.minHeight = '180px';

      pane.appendChild(el('div', { class: 'rpt-field' }, [
        el('label', { class: 'rpt-label', text: '名字列表' }),
        area,
        el('div', { class: 'rpt-hint', text: '每行生成一个条目，注入内容自动填成「名字：“|”」，生成后可以逐个改。' }),
      ]));

      const stats = el('div', { class: 'rpt-hint' });
      const refresh = () => {
        const n = area.value.split('\n').map((s) => s.trim()).filter(Boolean).length;
        stats.textContent = n ? `将生成 ${n} 个条目` : '';
      };
      area.addEventListener('input', refresh);
      pane.appendChild(stats);

      const doImport = async () => {
        const names = area.value.split('\n').map((s) => s.trim()).filter(Boolean);
        if (!names.length) { toast('请先粘贴名字', 'warning'); return false; }
        if (!storeStillValid(state.pool, store)) return false;

        let added = 0;
        const res = await mutateStore(state.pool, (live) => {
          const titles = live.entries.map((x) => x.title);
          for (const name of names) {
            const title = uniqueTitle(name, titles);
            titles.push(title);
            live.entries.push(normalizeEntry({
              title,
              desc: '',
              content: defaultContent(name),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }));
            added++;
          }
        });

        if (res.ok) {
          renderAll();
          setStatus(`已导入 ${added} 个条目`);
          toast(`已导入 ${added} 个条目`, 'success');
        }
        return res.ok;
      };

      const actions = el('div', { class: 'rpt-actions' }, [
        el('button', { class: 'rpt-btn', text: '取消', type: 'button', onclick: closeModal }),
        el('button', {
          class: 'rpt-btn rpt-primary', text: '导入', type: 'button',
          onclick: async (e) => {
            e.target.disabled = true;
            const ok = await doImport();
            e.target.disabled = false;
            if (ok) closeModal();
          },
        }),
      ]);
      pane.appendChild(actions);
    };

    /* ---- 世界书扫描 ---- */
    buildWorldbookPane = () => {
      const hint = el('div', { class: 'rpt-hint', text: '正在读取世界书…' });
      pane.appendChild(hint);

      const status = el('div', { class: 'rpt-hint' });
      const filterInput = el('input', { class: 'rpt-input', type: 'text', placeholder: '🔍 过滤条目名或内容…' });
      const listBox = el('div', { class: 'rpt-check-list' });
      const toolbar = el('div', { class: 'rpt-row' }, [
        el('button', { class: 'rpt-btn', text: '全选', type: 'button' }),
        el('button', { class: 'rpt-btn', text: '全不选', type: 'button' }),
        el('button', { class: 'rpt-btn', text: '反选', type: 'button' }),
      ]);
      const includeGlobalLabel = el('label', {}, [
        el('input', { type: 'checkbox' }),
        ' 同时扫描全局世界书',
      ]);

      let candidates = [];
      const checked = new Set();

      const renderCandidates = () => {
        listBox.textContent = '';
        const kw = filterInput.value;
        const shown = candidates.filter((c) => {
          const k = String(kw || '').trim().toLowerCase();
          if (!k) return true;
          return c.name.toLowerCase().includes(k) || c.preview.toLowerCase().includes(k);
        });

        if (!shown.length) {
          listBox.appendChild(el('div', { class: 'rpt-hint', text: candidates.length ? '没有匹配的条目。' : '没有可导入的新条目。' }));
        }

        for (const c of shown) {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = checked.has(c.name);
          cb.addEventListener('change', () => {
            if (cb.checked) checked.add(c.name);
            else checked.delete(c.name);
            updateStatus();
          });
          const item = el('label', { class: 'rpt-check-item' }, [
            cb,
            el('div', { class: 'rpt-check-main' }, [
              el('div', { class: 'rpt-check-name', text: c.name }),
              c.preview ? el('div', { class: 'rpt-check-preview', title: c.preview, text: c.preview }) : null,
            ]),
          ]);
          listBox.appendChild(item);
        }
        updateStatus();
      };

      const updateStatus = () => {
        status.textContent = `候选 ${candidates.length} 条，已选 ${checked.size} 条`;
      };

      let filterTimer = null;
      filterInput.addEventListener('input', () => {
        clearTimeout(filterTimer);
        filterTimer = setTimeout(renderCandidates, 120);
      });

      toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('.rpt-btn');
        if (!btn) return;
        const kw = String(filterInput.value || '').trim().toLowerCase();
        const visible = candidates.filter((c) => !kw || c.name.toLowerCase().includes(kw) || c.preview.toLowerCase().includes(kw));
        if (btn.textContent === '全选') visible.forEach((c) => checked.add(c.name));
        else if (btn.textContent === '全不选') visible.forEach((c) => checked.delete(c.name));
        else visible.forEach((c) => { if (checked.has(c.name)) checked.delete(c.name); else checked.add(c.name); });
        renderCandidates();
      });

      const load = async () => {
        const fnChar = G('getCharWorldbookNames');
        const fnGlobal = G('getGlobalWorldbookNames');
        const fnGet = G('getWorldbook');
        if (!fnGet) {
          hint.textContent = '酒馆助手接口不可用，无法读取世界书。';
          return;
        }

        const names = [];
        try {
          if (fnChar) {
            const binds = await callApi(fnChar, 'current');
            if (binds && binds.primary) names.push(binds.primary);
            if (binds && Array.isArray(binds.additional)) names.push(...binds.additional);
          }
        } catch (e) {
          console.error(TAG, '读取角色卡世界书绑定失败', e);
        }

        if (includeGlobalLabel.querySelector('input').checked && fnGlobal) {
          try {
            const g = await callApi(fnGlobal);
            if (Array.isArray(g)) names.push(...g);
          } catch (e) { /* ignore */ }
        }

        const uniq = [...new Set(names.filter(Boolean))];
        if (!uniq.length) {
          hint.textContent = '没有找到世界书。可以切到「批量粘贴」手动输入名字。';
          return;
        }

        const imported = store.importedWorldbookEntries || {};
        const collected = [];
        for (const wbName of uniq) {
          try {
            const entries = await callApi(fnGet, wbName);
            const list = Array.isArray(entries) ? entries : [];
            const cands = worldbookCandidates(list, imported[wbName] || [], '');
            for (const c of cands) collected.push({ ...c, worldbook: wbName });
          } catch (e) {
            console.error(TAG, `读取世界书「${wbName}」失败`, e);
          }
        }

        candidates = collected;
        hint.textContent = `已扫描 ${uniq.length} 本世界书：${uniq.join('、')}`;
        renderCandidates();
      };

      includeGlobalLabel.querySelector('input').addEventListener('change', () => {
        candidates = [];
        checked.clear();
        listBox.textContent = '';
        load();
      });

      const actions = el('div', { class: 'rpt-actions' }, [
        el('button', { class: 'rpt-btn', text: '取消', type: 'button', onclick: closeModal }),
        el('button', {
          class: 'rpt-btn rpt-primary', text: '导入所选', type: 'button',
          onclick: async (e) => {
            if (!checked.size) { toast('还没有选中任何条目', 'warning'); return; }
            if (!storeStillValid(state.pool, store)) return;
            e.target.disabled = true;

            const picked = candidates.filter((c) => checked.has(c.name));
            const res = await mutateStore(state.pool, (live) => {
              const titles = live.entries.map((x) => x.title);
              for (const c of picked) {
                const title = uniqueTitle(c.name, titles);
                titles.push(title);
                live.entries.push(normalizeEntry({
                  title,
                  desc: '',
                  content: defaultContent(c.name),
                  source: { type: 'worldbook', worldbook: c.worldbook, entryName: c.name },
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                }));
                const imp = live.importedWorldbookEntries;
                if (!imp[c.worldbook]) imp[c.worldbook] = [];
                if (!imp[c.worldbook].includes(c.name)) imp[c.worldbook].push(c.name);
              }
            });

            if (res.ok) {
              renderAll();
              setStatus(`已从世界书导入 ${picked.length} 个条目`);
              toast(`已导入 ${picked.length} 个条目`, 'success');
            }
            e.target.disabled = false;
            if (res.ok) closeModal();
          },
        }),
      ]);

      pane.appendChild(el('div', { class: 'rpt-field' }, [filterInput]));
      pane.appendChild(el('div', { class: 'rpt-row' }, [
        el('div', { style: 'flex:1 1 auto' }, [includeGlobalLabel]),
        toolbar,
      ]));
      pane.appendChild(listBox);
      pane.appendChild(status);
      pane.appendChild(actions);
      load();
    };

    showModal({
      title: `批量导入到「${poolName(state.pool)}」`,
      contentEl: body,
      buttons: [],
      wide: true,
    });

    switchMode('worldbook');
  }

  /* ==================== 预设库 ==================== */

  /**
   * 内置预设库：列出常用格式片段供勾选。
   * 默认不放进任何池子——用户勾了才加，且固定加到「通用」池（这些是通用格式，不属于某张卡）。
   */
  function openLibraryDialog() {
    const target = globalStore;
    if (!target) { toast('通用池不可用', 'error'); return; }

    const existingTitles = new Set(target.entries.map((x) => x.title));
    const checked = new Set();
    const listBox = el('div', { class: 'rpt-check-list' });
    listBox.style.maxHeight = '360px';

    const render = () => {
      listBox.textContent = '';
      let lastGroup = null;
      for (const item of LIBRARY) {
        if (item.group !== lastGroup) {
          lastGroup = item.group;
          listBox.appendChild(el('div', { class: 'rpt-lib-group', text: item.group }));
        }
        const exists = existingTitles.has(item.title);
        const cb = el('input', { type: 'checkbox' });
        cb.checked = checked.has(item.title);
        cb.disabled = exists;
        cb.addEventListener('change', () => {
          if (cb.checked) checked.add(item.title);
          else checked.delete(item.title);
          updateStatus();
        });
        listBox.appendChild(el('label', {
          class: `rpt-check-item${exists ? ' rpt-exists' : ''}`,
        }, [
          cb,
          el('div', { class: 'rpt-check-main' }, [
            el('div', { class: 'rpt-check-name' }, [
              item.title,
              exists ? el('span', { class: 'rpt-tag', text: '已存在' }) : null,
            ]),
            el('div', { class: 'rpt-check-preview' }, [
              item.desc,
              el('span', { class: 'rpt-lib-sample', text: parseContent(item.content).text || item.content }),
            ]),
          ]),
        ]));
      }
      updateStatus();
    };

    const status = el('div', { class: 'rpt-hint' });
    const updateStatus = () => {
      const total = LIBRARY.filter((i) => !existingTitles.has(i.title)).length;
      status.textContent = `可添加 ${total} 项，已选 ${checked.size} 项`;
    };

    const toolbar = el('div', { class: 'rpt-row' }, [
      el('button', {
        class: 'rpt-btn', text: '全选', type: 'button',
        onclick: () => {
          for (const i of LIBRARY) if (!existingTitles.has(i.title)) checked.add(i.title);
          render();
        },
      }),
      el('button', {
        class: 'rpt-btn', text: '全不选', type: 'button',
        onclick: () => { checked.clear(); render(); },
      }),
    ]);

    const body = el('div', {}, [
      el('div', { class: 'rpt-hint', text: '这些是常用格式片段，勾选后加进「通用」池（跨角色卡通用）。加入后可以随时编辑或删除。' }),
      toolbar,
      listBox,
      status,
    ]);

    render();

    showModal({
      title: '预设库',
      contentEl: body,
      wide: true,
      buttons: [
        { text: '取消' },
        {
          text: '加入通用池',
          primary: true,
          onClick: async () => {
            if (!checked.size) { toast('还没有勾选任何项', 'warning'); return false; }
            if (!storeStillValid('global', target)) return false;
            const picked = LIBRARY.filter((i) => checked.has(i.title));
            const res = await mutateStore('global', (live) => {
              const titles = live.entries.map((x) => x.title);
              for (const item of picked) {
                const title = uniqueTitle(item.title, titles);
                titles.push(title);
                live.entries.push(normalizeEntry({
                  title,
                  desc: item.desc,
                  content: item.content,
                  source: { type: 'library', libraryTitle: item.title },
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                }));
              }
            });
            if (res.ok) {
              renderAll();
              setStatus(`已从预设库加入 ${picked.length} 项`);
              toast(`已加入 ${picked.length} 项到通用池`, 'success');
            }
            return res.ok;
          },
        },
      ],
    });
  }

  /* ==================== 设置 ==================== */

  function openSettings() {
    const modeSelect = el('select', { class: 'rpt-input' }, [
      el('option', { value: 'append', text: '追加到末尾（默认）' }),
      el('option', { value: 'replace', text: '替换输入框全部内容' }),
      el('option', { value: 'cursor', text: '插入到当前光标处' }),
    ]);
    modeSelect.value = settings.injectMode;

    const sepSelect = el('select', { class: 'rpt-input' }, [
      el('option', { value: 'newline', text: '另起一行（默认）' }),
      el('option', { value: 'space', text: '空一格' }),
      el('option', { value: 'none', text: '直接接上，不分隔' }),
    ]);
    sepSelect.value = settings.appendSeparator || 'newline';

    const autoClose = el('input', { type: 'checkbox' });
    autoClose.checked = !!settings.autoCloseAfterInject;

    const showBall = el('input', { type: 'checkbox' });
    showBall.checked = !!settings.showFloatingBall;

    const themeSelect = el('select', { class: 'rpt-input' }, [
      el('option', { value: 'auto', text: '跟随酒馆（自动判断明暗）' }),
      el('option', { value: 'dark', text: '始终用深色' }),
      el('option', { value: 'light', text: '始终用浅色' }),
    ]);
    themeSelect.value = settings.theme || 'auto';

    const body = el('div', {}, [
      el('div', { class: 'rpt-hint', style: 'margin-bottom:12px;' }, [
        '把常写的角色名、台词格式存成条目，点一下注入输入框，光标停在预设位置。',
        '注入内容里用 ',
        el('kbd', { text: '|' }),
        ' 标记光标落点。',
      ]),
      el('div', { class: 'rpt-field' }, [
        el('label', { class: 'rpt-label', text: '注入方式' }),
        modeSelect,
      ]),
      el('div', { class: 'rpt-field' }, [
        el('label', { class: 'rpt-label', text: '追加时与已有内容的分隔符（只对「追加」有效）' }),
        sepSelect,
      ]),
      el('div', { class: 'rpt-row' }, [
        el('label', {}, [autoClose, ' 注入后自动收起面板']),
      ]),
      el('div', { class: 'rpt-row' }, [
        el('label', {}, [showBall, ' 显示悬浮球']),
      ]),
      el('div', { class: 'rpt-field' }, [
        el('label', { class: 'rpt-label', text: '面板配色' }),
        themeSelect,
      ]),
      el('hr', { style: 'border:none;border-top:1px solid var(--rpt-border);margin:14px 0;' }),

      el('div', { class: 'rpt-row' }, [
        el('button', { class: 'rpt-btn', text: '📚 预设库', type: 'button', onclick: openLibraryDialog }),
        el('button', { class: 'rpt-btn', text: '导出条目…', type: 'button', onclick: openExportDialog }),
        el('button', { class: 'rpt-btn', text: '导入条目…', type: 'button', onclick: openImportJson }),
      ]),

      el('div', { class: 'rpt-hint' }, [
        '条目存在哪：',
        el('br'),
        '· 「本卡」条目存在**角色卡自己**里（角色卡数据的 extensions 字段），所以分享角色卡时会一起带走；',
        '反过来，**更新或替换角色卡会让本卡条目变成新卡里的内容**——新卡没带就会清空。更新卡前请先导出备份。',
        el('br'),
        '· 「通用」条目存在酒馆全局变量里，跨角色卡通用，随用户存档。',
      ]),

      el('hr', { style: 'border:none;border-top:1px solid var(--rpt-border);margin:14px 0;' }),

      el('div', { class: 'rpt-danger-zone' }, [
        el('div', { style: 'font-weight:600;margin-bottom:6px;' }, ['危险操作']),
        el('button', { class: 'rpt-btn rpt-danger', text: '清空数据…', type: 'button', onclick: openClearData }),
        el('div', { class: 'rpt-hint', text: '清空前建议先导出备份。' }),
      ]),

      el('div', { class: 'rpt-hint' }, [
        `角色提词器 v${SCRIPT_VERSION}`,
        el('br'),
        '要求 SillyTavern 1.18+ / 酒馆助手 4.x+',
      ]),
    ]);

    const save = async () => {
      settings.injectMode = modeSelect.value;
      settings.appendSeparator = sepSelect.value;
      settings.autoCloseAfterInject = autoClose.checked;
      settings.showFloatingBall = showBall.checked;
      settings.theme = themeSelect.value;
      await saveStore('global');
      buildBall();
      const panel = doc.getElementById(PANEL_ID);
      if (panel) applyTheme(panel);
      setStatus('设置已保存');
      return true;
    };

    showModal({
      title: '设置',
      contentEl: body,
      buttons: [
        { text: '取消' },
        { text: '保存', primary: true, onClick: save },
      ],
    });
  }

  /* ==================== 清空数据 ==================== */

  /** 清空指定池（走 mutateStore，失败会回滚） */
  async function clearOnePool(pool) {
    if (pool === 'card' && !cardStore) {
      toast('没有打开角色卡，无法清空本卡池', 'warning');
      return false;
    }
    const res = await mutateStore(pool, (live) => {
      live.entries = [];
      live.importedWorldbookEntries = {};
    });
    if (res.ok) {
      renderAll();
      setStatus(`已清空「${poolName(pool)}」池`);
      toast(`「${poolName(pool)}」池已清空`, 'success');
    }
    return res.ok;
  }

  /** 三次确认后清空 */
  async function clearPools(which) {
    const label = which === 'both' ? '通用池 + 本卡池' : `「${poolName(which)}」池`;
    const countOf = (pool) => (pool === 'card' ? (cardStore ? cardStore.entries.length : 0) : (globalStore ? globalStore.entries.length : 0));
    const total = which === 'both' ? countOf('global') + countOf('card') : countOf(which);

    if (total === 0) { toast('要清空的池子里没有条目', 'warning'); return; }

    const steps = [
      `即将清空 ${label}，共 ${total} 条。这个操作不可撤销，确定继续吗？`,
      `再确认一次：${label} 的条目会被**全部删除**，包括标题、描述和注入内容。`,
      `最后一次确认：删除后无法恢复（除非你之前导出过备份）。真的清空吗？`,
    ];

    for (let i = 0; i < steps.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await askConfirm(
        `清空 ${label}（第 ${i + 1}/3 次确认）`,
        steps[i],
        { danger: true, okText: i === 2 ? '确认清空' : '继续' },
      );
      if (!ok) { toast('已取消清空'); return; }
    }

    if (which === 'global' || which === 'both') await clearOnePool('global');
    if ((which === 'card' || which === 'both') && cardStore) await clearOnePool('card');
  }

  function openClearData() {
    const hasCard = !!cardStore;
    const gCount = globalStore ? globalStore.entries.length : 0;
    const cCount = cardStore ? cardStore.entries.length : 0;

    const makeBtn = (text, which, disabled) => {
      const btn = el('button', {
        class: 'rpt-btn rpt-danger', text, type: 'button',
        onclick: async () => {
          closeModal();
          // 等弹窗关闭再弹确认，避免确认框叠在设置框上
          setTimeout(() => { void clearPools(which); }, 0);
        },
      });
      btn.disabled = !!disabled;
      if (disabled) btn.style.opacity = '.45';
      return btn;
    };

    const body = el('div', {}, [
      el('div', { class: 'rpt-hint' }, [
        '三个选项都是**不可撤销**的，每个都需要连续确认三次。',
        el('br'),
        '注意：本卡池只能清空**当前打开的那张卡**。其他卡的数据要逐张打开才能清。',
      ]),
      el('div', { class: 'rpt-field', style: 'margin-top:12px;' }, [
        el('div', { style: 'font-weight:600;margin-bottom:6px;' }, [`通用池（${gCount} 条）`]),
        makeBtn('清空通用池', 'global', gCount === 0),
      ]),
      el('div', { class: 'rpt-field' }, [
        el('div', { style: 'font-weight:600;margin-bottom:6px;' }, [
          hasCard ? `本卡池（${cCount} 条）` : '本卡池（没有打开角色卡）',
        ]),
        makeBtn('清空本卡池', 'card', !hasCard || cCount === 0),
      ]),
      el('div', { class: 'rpt-field' }, [
        el('div', { style: 'font-weight:600;margin-bottom:6px;' }, ['两个一起清']),
        makeBtn('清空通用池 + 本卡池', 'both', gCount + cCount === 0),
      ]),
    ]);

    showModal({
      title: '清空数据',
      contentEl: body,
      buttons: [{ text: '取消' }],
    });
  }

  /* ==================== 导出 ==================== */

  function openExportDialog() {
    const gCount = globalStore ? globalStore.entries.length : 0;
    const cCount = cardStore ? cardStore.entries.length : 0;
    const hasCard = !!cardStore;

    const target = el('select', { class: 'rpt-input' }, [
      el('option', { value: 'global', text: `通用池（${gCount} 条）` }),
      el('option', { value: 'card', text: hasCard ? `本卡池（${cCount} 条）` : '本卡池（没有打开角色卡）' }),
      el('option', { value: 'both', text: `两个都导（${gCount} + ${cCount} 条）` }),
    ]);
    if (!hasCard) {
      const opt = target.querySelector('option[value="card"]');
      if (opt) opt.disabled = true;
    }
    // 有卡时默认导出本卡池——因为卡池有"更新卡被冲掉"的风险，备份它更重要
    target.value = hasCard ? 'card' : 'global';

    const body = el('div', {}, [
      el('div', { class: 'rpt-field' }, [
        el('label', { class: 'rpt-label', text: '导出哪些条目' }),
        target,
      ]),
      el('div', { class: 'rpt-hint' }, [
        '本卡池条目虽然会随角色卡一起导出，但更新/替换角色卡时会被新卡覆盖，',
        '所以更新卡之前单独导出一份本卡池是稳妥做法。',
      ]),
    ]);

    showModal({
      title: '导出条目',
      contentEl: body,
      buttons: [
        { text: '取消' },
        {
          text: '导出',
          primary: true,
          onClick: () => {
            const which = target.value;
            if (which === 'card' && !hasCard) { toast('没有打开角色卡', 'warning'); return false; }
            const payload = {
              __角色提词器__: true,
              version: 1,
              exportedAt: new Date().toISOString(),
            };
            let n = 0;
            if (which === 'global' || which === 'both') {
              payload.global = globalStore ? globalStore.entries : [];
              n += payload.global.length;
            }
            if ((which === 'card' || which === 'both') && cardStore) {
              payload.card = cardStore.entries;
              payload.cardName = getCurrentCardName();
              n += payload.card.length;
            }
            if (!n) { toast('要导出的池子里没有条目', 'warning'); return false; }
            downloadJson(payload, which, n);
            return true;
          },
        },
      ],
    });
  }

  function getCurrentCardName() {
    try {
      const fn = G('getCurrentCharacterName');
      if (fn) return fn() || '';
    } catch (e) { /* ignore */ }
    return '';
  }

  function downloadJson(payload, which, count) {
    const text = JSON.stringify(payload, null, 2);
    const suffix = which === 'both' ? '全部' : poolName(which);
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = `角色提词器-${suffix}-${stamp}.json`;
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(`已导出 ${count} 条`, 'success');
    } catch (e) {
      // 下载不可用（某些内嵌环境）：退回复制到剪贴板
      copyToClipboard(text);
      toast('已复制到剪贴板（文件下载不可用）');
    }
  }

  /* ==================== 导入 ==================== */

  /** 把导入文件解析成「每个池要导入哪些条目」 */
  function parseImportPayload(data) {
    if (!data || typeof data !== 'object') return null;
    // 新格式：global / card 分开；旧格式（v1.0.0）：entries 就是通用池
    const out = { global: null, card: null, cardName: '' };
    if (Array.isArray(data.global)) out.global = data.global;
    if (Array.isArray(data.card)) out.card = data.card;
    if (out.global === null && out.card === null && Array.isArray(data.entries)) {
      out.global = data.entries;
    }
    if (typeof data.cardName === 'string') out.cardName = data.cardName;
    if (out.global === null && out.card === null) return null;
    return out;
  }

  function openImportJson() {
    const area = el('textarea', { class: 'rpt-textarea', placeholder: '把导出的 JSON 粘贴到这里' });
    area.style.minHeight = '160px';
    const fileInput = el('input', { type: 'file', accept: '.json,application/json' });
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { area.value = String(reader.result || ''); };
      reader.readAsText(f);
    });

    const body = el('div', {}, [
      el('div', { class: 'rpt-field' }, [
        el('label', { class: 'rpt-label', text: '粘贴 JSON' }),
        area,
        el('div', { class: 'rpt-hint' }, [
          el('button', { class: 'rpt-btn', text: '选择文件…', type: 'button', onclick: () => fileInput.click() }),
          ' 导入时会检测标题重名，让你逐个决定怎么处理。',
        ]),
        fileInput,
      ]),
    ]);

    const doImport = async () => {
      let data;
      try {
        data = JSON.parse(area.value);
      } catch (e) {
        toast('JSON 解析失败：' + (e && e.message ? e.message : e), 'error');
        return false;
      }
      const parsed = parseImportPayload(data);
      if (!parsed) {
        toast('这份 JSON 里没有可导入的条目（缺少 global / card / entries 字段）', 'error');
        return false;
      }

      const gIncoming = (parsed.global || []).map(normalizeEntry);
      const cIncoming = (parsed.card || []).map(normalizeEntry);
      const cardAvailable = !!cardStore;
      const sourceCardName = parsed.cardName || '';

      /** 按目标选择算出「每个池要导入哪些条目」 */
      const plan = (which) => {
        const out = { global: [], card: [] };
        if (which === 'global') {
          out.global = gIncoming.concat(cIncoming);
        } else if (which === 'card') {
          out.card = gIncoming.concat(cIncoming);
        } else {
          out.global = gIncoming.slice();
          out.card = cIncoming.slice();
          // 没有角色卡时本卡条目无处可放，退回通用池
          if (!cardAvailable && out.card.length) {
            out.global = out.global.concat(out.card);
            out.card = [];
          }
        }
        return out;
      };

      // ---- 目标选择 ----
      const targetSelect = el('select', { class: 'rpt-input' }, [
        el('option', { value: 'bySource', text: '按来源归位（通用→通用池，本卡→本卡池）' }),
        el('option', { value: 'global', text: '全部导入通用池' }),
        el('option', { value: 'card', text: cardAvailable ? '全部导入本卡池' : '全部导入本卡池（没有打开角色卡）' }),
      ]);
      const cardOpt = targetSelect.querySelector('option[value="card"]');
      if (!cardAvailable && cardOpt) cardOpt.disabled = true;
      if (!cardAvailable) targetSelect.value = 'global';
      else if (!cIncoming.length && gIncoming.length) targetSelect.value = 'bySource';
      else if (!gIncoming.length && cIncoming.length) targetSelect.value = 'bySource';

      const summary = el('div', { class: 'rpt-hint' });
      const conflictBox = el('div', {});
      const resolutions = new Map();

      const renderPlan = () => {
        const which = targetSelect.value;
        const p = plan(which);

        summary.textContent = '';
        summary.appendChild(doc.createTextNode(
          `文件里：通用池 ${gIncoming.length} 条${sourceCardName ? `，来自「${sourceCardName}」的本卡池 ${cIncoming.length} 条` : cIncoming.length ? `，本卡池 ${cIncoming.length} 条` : ''}。`,
        ));
        summary.appendChild(el('br'));
        summary.appendChild(doc.createTextNode(
          `将导入：通用池 ${p.global.length} 条，本卡池 ${p.card.length} 条。`,
        ));
        if (!cardAvailable && cIncoming.length) {
          summary.appendChild(el('br'));
          summary.appendChild(doc.createTextNode('（没有打开角色卡，本卡池条目已改投通用池）'));
        }

        // 冲突检测
        resolutions.clear();
        conflictBox.textContent = '';
        const conflicts = [];
        for (const pool of ['global', 'card']) {
          const store = pool === 'card' ? cardStore : globalStore;
          if (!store) continue;
          for (const entry of p[pool]) {
            const dup = store.entries.find((x) => x.title === entry.title);
            if (dup) conflicts.push({ pool, entry, dup });
          }
        }
        if (!conflicts.length) return;

        conflictBox.appendChild(el('div', { class: 'rpt-hint', text: `有 ${conflicts.length} 个标题重名，请逐个选择处理方式：` }));
        const listBox = el('div', { class: 'rpt-check-list' });
        for (const { pool, entry, dup } of conflicts) {
          const key = `${pool}::${entry.title}`;
          const sel = el('select', { class: 'rpt-input' }, [
            el('option', { value: 'skip', text: '保留我的（跳过这条）' }),
            el('option', { value: 'theirs', text: '用对方的覆盖' }),
            el('option', { value: 'both', text: '两个都留' }),
          ]);
          sel.addEventListener('change', () => resolutions.set(key, sel.value));
          resolutions.set(key, 'skip');
          listBox.appendChild(el('div', { class: 'rpt-check-item' }, [
            el('div', { class: 'rpt-check-main' }, [
              el('div', { class: 'rpt-check-name', text: `${entry.title}　（${poolName(pool)}池）` }),
              el('div', { class: 'rpt-check-preview', text: `我的：${dup.content || '（空）'}` }),
              el('div', { class: 'rpt-check-preview', text: `对方：${entry.content || '（空）'}` }),
              sel,
            ]),
          ]));
        }
        conflictBox.appendChild(listBox);
      };

      targetSelect.addEventListener('change', renderPlan);

      const body = el('div', {}, [
        el('div', { class: 'rpt-field' }, [
          el('label', { class: 'rpt-label', text: '导入到哪' }),
          targetSelect,
        ]),
        summary,
        conflictBox,
      ]);

      const apply = async () => {
        const which = targetSelect.value;
        const p = plan(which);
        let added = 0;
        let replaced = 0;
        let failed = false;

        for (const pool of ['global', 'card']) {
          const list = p[pool];
          if (!list.length) continue;
          const store = pool === 'card' ? cardStore : globalStore;
          if (!store || !storeStillValid(pool, store)) { failed = true; break; }

          // eslint-disable-next-line no-await-in-loop
          const res = await mutateStore(pool, (live) => {
            for (const entry of list) {
              const idx = live.entries.findIndex((x) => x.title === entry.title);
              if (idx < 0) {
                live.entries.push(entry);
                added++;
                continue;
              }
              const how = resolutions.get(`${pool}::${entry.title}`) || 'skip';
              if (how === 'theirs') {
                entry.id = live.entries[idx].id;
                live.entries[idx] = entry;
                replaced++;
              } else if (how === 'both') {
                const titles = live.entries.map((x) => x.title);
                entry.title = uniqueTitle(entry.title, titles);
                entry.id = newId();
                live.entries.push(entry);
                added++;
              }
            }
          });
          if (!res.ok) { failed = true; break; }
        }

        if (!failed) {
          renderAll();
          setStatus(`导入完成：新增 ${added}，覆盖 ${replaced}`);
          toast(`导入完成：新增 ${added}，覆盖 ${replaced}`, 'success');
        }
        return !failed;
      };

      renderPlan();

      showModal({
        title: '确认导入',
        contentEl: body,
        wide: true,
        buttons: [
          { text: '取消' },
          { text: '确认导入', primary: true, onClick: apply },
        ],
      });
      return false; // 不关闭当前弹窗，交给确认弹窗处理
    };

    showModal({
      title: '导入条目',
      contentEl: body,
      buttons: [
        { text: '取消' },
        { text: '下一步', primary: true, onClick: doImport },
      ],
    });
  }

  /* ==================== 入口与生命周期 ==================== */

  function registerScriptButton() {
    const appendBtns = GScript('appendInexistentScriptButtons');
    const getBtnEvent = GScript('getButtonEvent');
    const eventOn = GScript('eventOn');
    if (appendBtns && getBtnEvent && eventOn) {
      try {
        appendBtns([{ name: BUTTON_NAME, visible: true }]);
        eventOn(getBtnEvent(BUTTON_NAME), togglePanel);
        log(`已注册脚本按钮「${BUTTON_NAME}」`);
        return true;
      } catch (e) {
        log('注册脚本按钮失败', e);
      }
    } else {
      log('缺少脚本按钮 API，改用输入框旁的按钮');
    }
    return false;
  }

  function injectFallbackEntry() {
    const old = doc.getElementById(ENTRY_ID);
    if (old) old.remove();

    const entry = el('div', {
      id: ENTRY_ID,
      title: '角色提词器',
      text: '🐧',
    });
    entry.style.cssText = 'cursor:pointer;display:flex;align-items:center;justify-content:center;width:28px;height:28px;font-size:16px;';
    entry.addEventListener('click', togglePanel);

    try {
      const rightForm = doc.querySelector('#rightSendForm');
      const sendBut = rightForm && rightForm.querySelector('#send_but');
      if (rightForm) {
        if (sendBut) rightForm.insertBefore(entry, sendBut);
        else rightForm.appendChild(entry);
        return;
      }
      const sheld = doc.querySelector('#form_sheld');
      if (sheld) { sheld.appendChild(entry); return; }
      entry.style.cssText += 'position:fixed;right:12px;bottom:12px;z-index:99990;background:rgba(15,23,42,.92);border-radius:50%;color:#fff;';
      doc.body.appendChild(entry);
    } catch (e) {
      console.error(TAG, '注入入口按钮失败', e);
    }
  }

  /**
   * 点击是否落在酒馆输入区里。
   * 必须豁免：用户会先点输入框把光标挪到想插入的位置，再点条目注入。
   * 如果这时面板被"点击外部"逻辑关掉，"插入到光标处"就没法用了。
   */
  function isInSendArea(target) {
    try {
      if (!target || typeof target.closest !== 'function') return false;
      return !!target.closest('#form_sheld, #send_form, #send_textarea, #nonQRFormItems, #rightSendForm');
    } catch (e) {
      return false;
    }
  }

  function registerGlobalHandlers() {
    // 点击面板外部关闭（弹窗打开时不生效；点悬浮球/入口按钮/输入区不算外部）
    onPage(doc, 'mousedown', (e) => {
      if (!panelOpen() || modalOpen()) return;
      const panel = doc.getElementById(PANEL_ID);
      if (panel && panel.contains(e.target)) return;
      const ball = doc.getElementById(BALL_ID);
      if (ball && ball.contains(e.target)) return;
      const entry = doc.getElementById(ENTRY_ID);
      if (entry && entry.contains(e.target)) return;
      if (isInSendArea(e.target)) return;
      closePanel();
    }, true);

    // Esc 关闭（弹窗优先）
    onPage(doc, 'keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (modalOpen()) { closeModal(); return; }
      if (panelOpen()) closePanel();
    });

    // 窗口尺寸变化：把面板与悬浮球夹回视口
    onPage(host, 'resize', () => {
      const panel = doc.getElementById(PANEL_ID);
      if (panel && !panel.classList.contains('rpt-hidden')) {
        panel.style.left = clamp(parseFloat(panel.style.left) || 8, 8, Math.max(8, host.innerWidth - panel.offsetWidth - 8)) + 'px';
        panel.style.top = clamp(parseFloat(panel.style.top) || 8, 8, Math.max(8, host.innerHeight - panel.offsetHeight - 8)) + 'px';
      }
      const ball = doc.getElementById(BALL_ID);
      if (ball) {
        ball.style.left = clamp(parseFloat(ball.style.left) || 8, 8, Math.max(8, host.innerWidth - ball.offsetWidth - 8)) + 'px';
        ball.style.top = clamp(parseFloat(ball.style.top) || 8, 8, Math.max(8, host.innerHeight - ball.offsetHeight - 8)) + 'px';
      }
    });

    // 切换聊天/角色卡时重载数据
    const events = (typeof tavern_events !== 'undefined' && tavern_events)
      || (host && host.tavern_events)
      || null;
    const eventOn = GScript('eventOn');
    if (events && events.CHAT_CHANGED && eventOn) {
      try {
        eventOn(events.CHAT_CHANGED, () => {
          log('聊天/角色卡变更，重载数据');
          // 弹窗里缓存的是旧数据池的引用，切了上下文就必须关掉，否则保存会写错对象
          if (modalOpen()) {
            closeModal();
            toast('聊天或角色卡已切换，操作已取消', 'warning');
          }
          loadAll();
          if (panelOpen()) renderAll();
        });
      } catch (e) {
        log('注册 CHAT_CHANGED 失败', e);
      }
    }
  }

  /** 启动失败时的可见兜底：往酒馆页面塞一个 ❗ 按钮（用户不会去看 F12） */
  function showFatalError(msg) {
    try {
      const id = `${ENTRY_ID}-fatal`;
      const old = doc.getElementById(id);
      if (old) old.remove();
      const btn = el('div', {
        id: `${ENTRY_ID}-fatal`,
        title: `角色提词器启动失败：${msg}\n（点一下复制错误信息）`,
        text: '❗',
      });
      btn.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:999990;width:36px;height:36px;'
        + 'border-radius:50%;display:flex;align-items:center;justify-content:center;'
        + 'background:#d9534f;color:#fff;font-size:18px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4);';
      btn.addEventListener('click', () => {
        copyToClipboard(`${TAG} 启动失败：${msg}`);
        toast('错误信息已复制到剪贴板', 'info');
      });
      doc.body.appendChild(btn);
    } catch (e) { /* ignore */ }
  }

  function checkVersions() {
    const fnTavern = G('getTavernVersion');
    const fnHelper = G('getTavernHelperVersion');
    let tavern = null;
    let helper = null;
    try { if (fnTavern) tavern = fnTavern(); } catch (e) { /* ignore */ }
    try { if (fnHelper) helper = fnHelper(); } catch (e) { /* ignore */ }

    const problems = [];
    if (tavern && compareVersion(tavern, MIN_TAVERN) < 0) {
      problems.push(`SillyTavern 需要 ${MIN_TAVERN} 以上，当前 ${tavern}`);
    }
    if (helper && compareVersion(helper, MIN_HELPER) < 0) {
      problems.push(`酒馆助手需要 ${MIN_HELPER} 以上，当前 ${helper}`);
    }

    if (problems.length) {
      const msg = `角色提词器无法启动：${problems.join('；')}`;
      console.error(TAG, msg);
      toast(msg, 'error');
      return false;
    }
    log(`环境检查通过：SillyTavern ${tavern || '未知'} / 酒馆助手 ${helper || '未知'}`);
    return true;
  }

  function cleanupStaleInstance() {
    const prev = host[INSTANCE_KEY];
    if (prev && prev !== TOKEN) {
      console.warn(TAG, '检测到另一个实例（可能是新旧版本同时启用），本实例已接管；请到脚本库停用旧版本。');
    }
    host[INSTANCE_KEY] = TOKEN;
    removeOwnNodes();
    closeModal();
  }

  /** 清掉自己注入的所有 DOM（含 v1.0.0 用的 rni- 前缀节点，避免新旧版本并存留残骸） */
  function removeOwnNodes() {
    const ids = [PANEL_ID, STYLE_ID, BALL_ID, ENTRY_ID, `${ENTRY_ID}-fatal`, MODAL_ID];
    for (const id of ids) {
      const node = doc.getElementById(id);
      if (node) node.remove();
    }
    const legacy = [
      `${LEGACY_ID_PREFIX}panel`,
      `${LEGACY_ID_PREFIX}style`,
      `${LEGACY_ID_PREFIX}ball`,
      `${LEGACY_ID_PREFIX}entry`,
      `${LEGACY_ID_PREFIX}entry-fatal`,
    ];
    for (const id of legacy) {
      const node = doc.getElementById(id);
      if (node) node.remove();
    }
  }

  function uninstall() {
    // eventOn 注册的监听会随脚本关闭自动卸载，这里清理自己注入的 DOM 与页面监听
    clearBallListeners();
    clearPageListeners();
    // 实例令牌已被更新的版本接管时不要动 DOM——那已经是别人的界面了。
    // 否则用户停用旧版本时，会把新版本的界面一起抹掉。
    if (host[INSTANCE_KEY] === TOKEN) {
      removeOwnNodes();
      delete host[INSTANCE_KEY];
    }
    closeModal();
  }

  /* ==================== 启动 ==================== */

  function init() {
    if (!checkVersions()) return;

    cleanupStaleInstance();
    injectStyles();

    // 先把入口绑上，再做其余初始化——后面的初始化万一报错，用户至少还有入口
    const hasButton = registerScriptButton();
    if (!hasButton) injectFallbackEntry();

    loadAll();
    buildBall();
    registerGlobalHandlers();

    // 卸载清理
    try {
      if (typeof $ === 'function') $(window).on('pagehide', uninstall);
      else host.addEventListener('pagehide', uninstall);
    } catch (e) { /* ignore */ }

    log(`已加载 v${SCRIPT_VERSION}，点脚本按钮「${BUTTON_NAME}」或悬浮球打开面板`);
  }

  // 等酒馆页面就绪（官方要求：用 $() 而不是 DOMContentLoaded）
  try {
    if (typeof $ === 'function') {
      $(() => {
        try { init(); } catch (e) {
          console.error(TAG, '启动失败', e);
          const msg = e && e.message ? e.message : String(e);
          toast('角色提词器启动失败：' + msg, 'error');
          showFatalError(msg);
        }
      });
    } else {
      throw new Error('jQuery 不可用');
    }
  } catch (e) {
    console.error(TAG, '启动失败', e);
    // 兜底：直接在页面就绪后启动
    const boot = () => {
      try { init(); } catch (e2) {
        console.error(TAG, e2);
        showFatalError(e2 && e2.message ? e2.message : String(e2));
      }
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
