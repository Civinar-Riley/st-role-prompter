/**
 * 角色名注入 v1.0.0
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
 * 入口：酒馆助手脚本按钮「角色名注入」+ 可拖动悬浮球（可在设置里关闭）
 *
 * 版本要求：SillyTavern 1.18+ / 酒馆助手 4.x+
 */
(() => {
  'use strict';

  /* ==================== 常量 ==================== */

  const SCRIPT_VERSION = '1.0.0';
  const BUTTON_NAME = '角色名注入';
  const STORE_KEY = '角色名注入';
  const CURSOR_MARK = '|';
  const MIN_TAVERN = '1.18.0';
  const MIN_HELPER = '4.0.0';

  const PANEL_ID = 'rni-panel';
  const STYLE_ID = 'rni-style';
  const BALL_ID = 'rni-ball';
  const MODAL_ID = 'rni-modal';
  const ENTRY_ID = 'rni-entry';
  const INSTANCE_KEY = '__RNI_ACTIVE_TOKEN__';

  const TOKEN = `t${Date.now()}${Math.random().toString(36).slice(2, 9)}`;
  const TAG = '[角色名注入]';

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
   * @returns {{value: string, cursor: number}}
   */
  function buildInjectedValue(oldValue, selStart, selEnd, injectText, injectCursor, mode) {
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
      // append：输入框空则直接填，非空则清理末尾空白后换行追加
      if (!old) {
        next = text;
        base = 0;
      } else {
        const trimmed = old.replace(/\s+$/, '');
        const sep = trimmed ? '\n' : '';
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

  /* __TEST_SLICE_END__ */

  /* ==================== 状态 ==================== */

  const DEFAULT_SETTINGS = {
    injectMode: 'append',        // append | replace | cursor
    autoCloseAfterInject: true,
    showFloatingBall: true,
    theme: 'auto',               // auto | dark | light
    ballPosition: null,          // {x, y}
    panelPosition: null,         // {x, y}
  };

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
      const raw = table[STORE_KEY];
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
  function injectToInputBox(text, cursor, mode) {
    const ta = findSendTextarea();
    if (!ta) {
      const ok = copyToClipboard(text);
      toast(ok ? '未找到输入框，已复制到剪贴板' : '未找到输入框，注入失败', ok ? 'warning' : 'error');
      return false;
    }

    const selStart = typeof ta.selectionStart === 'number' ? ta.selectionStart : ta.value.length;
    const selEnd = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : selStart;
    const built = buildInjectedValue(ta.value, selStart, selEnd, text, cursor, mode);

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

    const ok = injectToInputBox(parsed.text, parsed.cursor, settings.injectMode);
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
  --rni-bg: #1e2127;
  --rni-card: #262a33;
  --rni-hover: #2f3542;
  --rni-fg: #e2dfd7;
  --rni-muted: #8b93a7;
  --rni-border: #383e4d;
  --rni-accent: #7c5cff;
  --rni-danger: #d9534f;
  position: fixed;
  z-index: 99991;
  width: 420px;
  max-width: calc(100vw - 16px);
  max-height: min(560px, calc(100vh - 60px));
  display: flex;
  flex-direction: column;
  background: var(--rni-bg);
  color: var(--rni-fg);
  border: 1px solid var(--rni-border);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,.45);
  font: 13px/1.5 "Noto Sans SC","Segoe UI","Microsoft YaHei",sans-serif;
  overflow: hidden;
  box-sizing: border-box;
}
#${PANEL_ID}.rni-light {
  --rni-bg: #f5f5f7;
  --rni-card: #ffffff;
  --rni-hover: #ececf0;
  --rni-fg: #2c2c2e;
  --rni-muted: #6b7280;
  --rni-border: #d9d9de;
}
#${PANEL_ID}.rni-hidden { display: none; }
#${PANEL_ID} * { box-sizing: border-box; }

#${PANEL_ID} .rni-head {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 10px; border-bottom: 1px solid var(--rni-border);
  cursor: grab; user-select: none; flex: 0 0 auto;
}
#${PANEL_ID} .rni-head.rni-dragging { cursor: grabbing; }
#${PANEL_ID} .rni-brand { font-weight: 600; white-space: nowrap; }
#${PANEL_ID} .rni-tabs { display: flex; gap: 4px; flex: 1 1 auto; }
#${PANEL_ID} .rni-tab {
  padding: 3px 9px; border-radius: 999px; cursor: pointer;
  border: 1px solid transparent; background: transparent;
  color: var(--rni-muted); font: inherit; font-size: 12px; white-space: nowrap;
}
#${PANEL_ID} .rni-tab:hover:not(:disabled) { background: var(--rni-hover); }
#${PANEL_ID} .rni-tab.rni-active { background: var(--rni-accent); color: #fff; }
#${PANEL_ID} .rni-tab:disabled { opacity: .4; cursor: not-allowed; }
#${PANEL_ID} .rni-head-actions { display: flex; gap: 2px; flex: 0 0 auto; }
#${PANEL_ID} .rni-icon {
  width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--rni-muted);
  border-radius: 6px; cursor: pointer; font-size: 14px; line-height: 1; padding: 0;
}
#${PANEL_ID} .rni-icon:hover { background: var(--rni-hover); color: var(--rni-fg); }

#${PANEL_ID} .rni-notice {
  flex: 0 0 auto; padding: 6px 10px; font-size: 12px;
  color: var(--rni-muted); background: var(--rni-card);
  border-bottom: 1px solid var(--rni-border);
}
#${PANEL_ID} .rni-search-row { padding: 8px 10px; border-bottom: 1px solid var(--rni-border); flex: 0 0 auto; }
#${PANEL_ID} .rni-search {
  width: 100%; padding: 6px 10px; border-radius: 8px; font: inherit;
  background: var(--rni-card); color: var(--rni-fg);
  border: 1px solid var(--rni-border); outline: none;
}
#${PANEL_ID} .rni-search:focus { border-color: var(--rni-accent); }

#${PANEL_ID} .rni-list { flex: 1 1 auto; overflow-y: auto; padding: 6px; }
#${PANEL_ID} .rni-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
  border: 1px solid transparent;
}
#${PANEL_ID} .rni-item:hover { background: var(--rni-hover); border-color: var(--rni-border); }
#${PANEL_ID} .rni-item.rni-flash { background: var(--rni-accent); }
#${PANEL_ID} .rni-item-main { flex: 1 1 auto; min-width: 0; }
#${PANEL_ID} .rni-item-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#${PANEL_ID} .rni-item-desc {
  font-size: 12px; color: var(--rni-muted); margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#${PANEL_ID} .rni-item-actions { display: flex; gap: 2px; flex: 0 0 auto; opacity: 0; transition: opacity .12s; }
#${PANEL_ID} .rni-item:hover .rni-item-actions { opacity: 1; }
#${PANEL_ID} .rni-item-actions .rni-icon { width: 24px; height: 24px; font-size: 13px; }
#${PANEL_ID} .rni-item-actions .rni-del:hover { background: var(--rni-danger); color: #fff; }
#${PANEL_ID} .rni-empty { padding: 26px 16px; text-align: center; color: var(--rni-muted); font-size: 12px; line-height: 1.9; }
#${PANEL_ID} .rni-empty kbd {
  background: var(--rni-card); border: 1px solid var(--rni-border);
  border-radius: 4px; padding: 0 4px; font-family: ui-monospace, monospace;
}

#${PANEL_ID} .rni-foot {
  flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-top: 1px solid var(--rni-border);
  font-size: 12px; color: var(--rni-muted);
}
#${PANEL_ID} .rni-status { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#${PANEL_ID} .rni-foot .rni-btn { flex: 0 0 auto; }

#${PANEL_ID} .rni-btn {
  padding: 4px 10px; border-radius: 6px; cursor: pointer; font: inherit; font-size: 12px;
  background: var(--rni-card); color: var(--rni-fg); border: 1px solid var(--rni-border);
}
#${PANEL_ID} .rni-btn:hover { background: var(--rni-hover); }
#${PANEL_ID} .rni-btn.rni-primary { background: var(--rni-accent); border-color: transparent; color: #fff; }
#${PANEL_ID} .rni-btn.rni-danger { background: var(--rni-danger); border-color: transparent; color: #fff; }

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
#${BALL_ID}.rni-dragging { cursor: grabbing; }

.rni-modal-mask {
  position: fixed; inset: 0; z-index: 99999;
  background: rgba(0,0,0,.5);
  display: flex; align-items: center; justify-content: center;
}
.rni-modal {
  --rni-bg: #1e2127;
  --rni-card: #262a33;
  --rni-hover: #2f3542;
  --rni-fg: #e2dfd7;
  --rni-muted: #8b93a7;
  --rni-border: #383e4d;
  --rni-accent: #7c5cff;
  --rni-danger: #d9534f;
  width: min(560px, 94vw); max-height: 88vh; overflow: auto;
  background: var(--rni-bg); color: var(--rni-fg);
  border: 1px solid var(--rni-border); border-radius: 12px;
  padding: 16px 18px;
  box-shadow: 0 16px 48px rgba(0,0,0,.55);
  font: 13px/1.55 "Noto Sans SC","Segoe UI","Microsoft YaHei",sans-serif;
  box-sizing: border-box;
}
.rni-modal.rni-light {
  --rni-bg: #f5f5f7;
  --rni-card: #ffffff;
  --rni-hover: #ececf0;
  --rni-fg: #2c2c2e;
  --rni-muted: #6b7280;
  --rni-border: #d9d9de;
}
.rni-modal * { box-sizing: border-box; }
.rni-modal h3 { margin: 0 0 14px; font-size: 15px; font-weight: 600; }
.rni-modal .rni-field { margin-bottom: 12px; }
.rni-modal .rni-label { display: block; font-size: 12px; color: var(--rni-muted); margin-bottom: 4px; }
.rni-modal .rni-input, .rni-modal .rni-textarea {
  width: 100%; padding: 7px 10px; border-radius: 8px; font: inherit;
  background: var(--rni-card); color: var(--rni-fg);
  border: 1px solid var(--rni-border); outline: none;
}
.rni-modal .rni-textarea { min-height: 88px; resize: vertical; line-height: 1.5; }
.rni-modal .rni-input:focus, .rni-modal .rni-textarea:focus { border-color: var(--rni-accent); }
.rni-modal .rni-hint { font-size: 11.5px; color: var(--rni-muted); margin-top: 5px; }
.rni-modal .rni-hint kbd {
  background: var(--rni-card); border: 1px solid var(--rni-border);
  border-radius: 4px; padding: 0 4px; font-family: ui-monospace, monospace;
}
.rni-modal .rni-preview {
  margin-top: 8px; padding: 8px 10px; border-radius: 8px;
  background: var(--rni-card); border: 1px dashed var(--rni-border);
  font-size: 12.5px; word-break: break-all; white-space: pre-wrap;
}
.rni-modal .rni-caret {
  display: inline-block; width: 2px; height: 1.05em; vertical-align: -.15em;
  background: var(--rni-accent); animation: rni-blink 1s steps(1) infinite;
}
@keyframes rni-blink { 50% { opacity: 0; } }
.rni-modal .rni-actions {
  display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;
}
.rni-modal .rni-actions.rni-split { justify-content: space-between; }
.rni-modal .rni-btn {
  padding: 6px 14px; border-radius: 7px; cursor: pointer; font: inherit;
  background: var(--rni-card); color: var(--rni-fg); border: 1px solid var(--rni-border);
}
.rni-modal .rni-btn:hover { background: var(--rni-hover); }
.rni-modal .rni-btn.rni-primary { background: var(--rni-accent); border-color: transparent; color: #fff; }
.rni-modal .rni-btn.rni-danger { background: var(--rni-danger); border-color: transparent; color: #fff; }
.rni-modal .rni-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.rni-modal .rni-row label { flex: 1 1 auto; }
.rni-modal select.rni-input { cursor: pointer; }
.rni-modal .rni-check-list {
  max-height: 320px; overflow-y: auto; margin-top: 8px;
  border: 1px solid var(--rni-border); border-radius: 8px; padding: 4px;
}
.rni-modal .rni-check-item {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 6px 8px; border-radius: 6px; cursor: pointer;
}
.rni-modal .rni-check-item:hover { background: var(--rni-hover); }
.rni-modal .rni-check-item input { margin-top: 3px; flex: 0 0 auto; }
.rni-modal .rni-check-main { min-width: 0; flex: 1 1 auto; }
.rni-modal .rni-check-name { font-weight: 600; }
.rni-modal .rni-check-preview {
  font-size: 11.5px; color: var(--rni-muted); margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rni-modal .rni-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.rni-modal .rni-tab {
  padding: 4px 12px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 12.5px;
  background: var(--rni-card); color: var(--rni-muted); border: 1px solid var(--rni-border);
}
.rni-modal .rni-tab.rni-active { background: var(--rni-accent); color: #fff; border-color: transparent; }
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
    node.classList.toggle('rni-light', isLight());
  }

  /* ==================== 弹窗 ==================== */

  function showModal({ title, contentEl, buttons, wide }) {
    closeModal();
    const box = el('div', { class: 'rni-modal' }, [
      el('h3', { text: title }),
      contentEl || null,
    ]);
    if (wide) box.style.width = 'min(720px, 96vw)';

    const actions = el('div', { class: 'rni-actions' });
    const buttonList = buttons || [];
    for (const b of buttonList) {
      const btn = el('button', {
        class: `rni-btn${b.primary ? ' rni-primary' : ''}${b.danger ? ' rni-danger' : ''}`,
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
        if (ok !== false) closeModal();
      });
      actions.appendChild(btn);
    }
    // 按钮为空时不渲染操作行（面板自带操作行的弹窗用这个分支）
    if (buttonList.length) box.appendChild(actions);

    const mask = el('div', { class: 'rni-modal-mask' }, box);
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) closeModal(); });
    doc.body.appendChild(mask);
    applyTheme(box);
    state.openModalEl = mask;
    return mask;
  }

  function closeModal() {
    if (state.openModalEl) {
      state.openModalEl.remove();
      state.openModalEl = null;
    }
  }

  const modalOpen = () => !!state.openModalEl;

  /* ==================== 面板 ==================== */

  function buildPanel() {
    const existing = doc.getElementById(PANEL_ID);
    if (existing) return existing;

    let searchTimer = null;

    const panel = el('div', { id: PANEL_ID, class: 'rni-hidden' });

    const head = el('div', { class: 'rni-head' }, [
      el('span', { class: 'rni-brand', text: '🎭 角色名注入' }),
      el('div', { class: 'rni-tabs' }, [
        el('button', { class: 'rni-tab', dataset: { pool: 'card' }, type: 'button' }),
        el('button', { class: 'rni-tab', dataset: { pool: 'global' }, type: 'button' }),
      ]),
      el('div', { class: 'rni-head-actions' }, [
        el('button', { class: 'rni-icon', title: '新建条目', text: '＋', dataset: { act: 'add' }, type: 'button' }),
        el('button', { class: 'rni-icon', title: '批量导入', text: '⇩', dataset: { act: 'import' }, type: 'button' }),
        el('button', { class: 'rni-icon', title: '设置', text: '⚙', dataset: { act: 'settings' }, type: 'button' }),
        el('button', { class: 'rni-icon', title: '关闭', text: '✕', dataset: { act: 'close' }, type: 'button' }),
      ]),
    ]);

    const searchRow = el('div', { class: 'rni-search-row' }, [
      el('input', { class: 'rni-search', placeholder: '🔍 搜索标题或描述…', type: 'text' }),
    ]);

    const list = el('div', { class: 'rni-list' });

    const foot = el('div', { class: 'rni-foot' }, [
      el('span', { class: 'rni-status', text: '就绪' }),
      el('button', { class: 'rni-btn', text: '批量导入', dataset: { act: 'import' }, type: 'button' }),
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
    head.querySelector('.rni-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.rni-tab');
      if (!btn || btn.disabled) return;
      state.pool = btn.dataset.pool;
      state.poolPinned = true;
      state.keyword = '';
      clearTimeout(searchTimer);          // 取消挂起的搜索防抖，否则旧关键词会被写回来
      const s = panel.querySelector('.rni-search');
      if (s) s.value = '';
      renderAll();
    });

    head.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'add') openEntryEditor(null);
      else if (act === 'import') openImportDialog();
      else if (act === 'settings') openSettings();
      else if (act === 'close') closePanel();
    });

    foot.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act="import"]');
      if (btn) openImportDialog();
    });

    // 搜索（防抖；searchTimer 在页签切换时会被清掉）
    searchRow.querySelector('.rni-search').addEventListener('input', (e) => {
      const v = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.keyword = v; renderList(); }, 120);
    });

    // 列表点击（事件委托）
    list.addEventListener('click', (e) => {
      const item = e.target.closest('.rni-item');
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
    const cardBtn = panel.querySelector('.rni-tab[data-pool="card"]');
    const globalBtn = panel.querySelector('.rni-tab[data-pool="global"]');
    const cardCount = cardStore ? cardStore.entries.length : 0;
    const globalCount = globalStore ? globalStore.entries.length : 0;

    cardBtn.textContent = `本卡 ${cardCount}`;
    globalBtn.textContent = `通用 ${globalCount}`;
    cardBtn.disabled = !cardStore;
    cardBtn.title = cardStore ? '当前角色卡的条目（随角色卡导出）' : '没有打开角色卡';
    globalBtn.title = '跨角色卡通用的条目（随用户存档）';

    cardBtn.classList.toggle('rni-active', state.pool === 'card');
    globalBtn.classList.toggle('rni-active', state.pool === 'global');

    // 没有角色卡时给一行常驻提示（页签置灰容易被忽略）
    let notice = panel.querySelector('.rni-notice');
    if (!cardStore) {
      if (!notice) {
        notice = el('div', { class: 'rni-notice', text: '没有打开角色卡，只能看到「通用」条目' });
        panel.insertBefore(notice, panel.querySelector('.rni-search-row'));
      }
    } else if (notice) {
      notice.remove();
    }
  }

  function renderList() {
    const panel = doc.getElementById(PANEL_ID);
    if (!panel) return;
    const list = panel.querySelector('.rni-list');
    list.textContent = '';

    if (!currentStore()) {
      list.appendChild(el('div', { class: 'rni-empty' }, [
        '当前没有打开角色卡，看不到「本卡」条目。',
        el('br'),
        '可以切到「通用」页签，或先打开一张角色卡。',
      ]));
      return;
    }

    const entries = filterEntries(currentEntries(), state.keyword);
    if (!entries.length) {
      const isSearching = !!String(state.keyword || '').trim();
      list.appendChild(el('div', { class: 'rni-empty' }, isSearching ? [
        '没有匹配的条目。',
      ] : [
        '这里还没有条目。',
        el('br'),
        '点右上角 ',
        el('kbd', { text: '＋' }),
        ' 新建，或用 ',
        el('kbd', { text: '⇩' }),
        ' 从世界书批量导入。',
        el('br'),
        '在注入内容里写 ',
        el('kbd', { text: '|' }),
        ' 可以指定光标落点。',
      ]));
      return;
    }

    for (const entry of entries) {
      const item = el('div', { class: 'rni-item', dataset: { id: entry.id } }, [
        el('div', { class: 'rni-item-main' }, [
          el('div', { class: 'rni-item-title', text: entry.title || '（无标题）' }),
          entry.desc ? el('div', { class: 'rni-item-desc', title: entry.desc, text: entry.desc }) : null,
        ]),
        el('div', { class: 'rni-item-actions' }, [
          el('button', { class: 'rni-icon', title: '编辑', text: '✎', dataset: { act: 'edit' }, type: 'button' }),
          el('button', { class: 'rni-icon rni-del', title: '删除', text: '×', dataset: { act: 'del' }, type: 'button' }),
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
    const node = panel.querySelector('.rni-status');
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
      toast('检测到另一个角色名注入实例在运行，请到脚本库只保留一个', 'error');
      return;
    }
    // 同一次点击里刚被"点击外部"关掉时不立刻重开，让入口表现为开关切换
    if (Date.now() - state.lastClosedAt < 400) return;

    buildPanel();
    const panel = doc.getElementById(PANEL_ID);
    panel.style.visibility = 'hidden';
    panel.classList.remove('rni-hidden');
    applyTheme(panel);
    applyPanelPosition();
    renderAll();
    panel.style.visibility = '';
  }

  function closePanel() {
    const panel = doc.getElementById(PANEL_ID);
    if (panel) panel.classList.add('rni-hidden');
    state.lastClosedAt = Date.now();
  }

  const panelOpen = () => {
    const panel = doc.getElementById(PANEL_ID);
    return !!(panel && !panel.classList.contains('rni-hidden'));
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
      target.classList.add('rni-dragging');
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
      target.classList.remove('rni-dragging');
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
      title: '角色名注入（点击打开，右键隐藏）',
      text: '🎭',
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
      ball.classList.remove('rni-dragging');
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
      ball.classList.add('rni-dragging');
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
      class: 'rni-input', type: 'text', placeholder: '例如：徐渭',
      value: editing ? editing.title : '',
    });
    const descInput = el('input', {
      class: 'rni-input', type: 'text', placeholder: '例如：{{user}}，冷漠剑客（只给自己看，不会注入）',
      value: editing ? editing.desc : '',
    });
    const contentArea = el('textarea', {
      class: 'rni-textarea',
      placeholder: '例如：徐渭：“|”',
    });
    contentArea.value = editing ? editing.content : '';

    const preview = el('div', { class: 'rni-preview' });
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
      preview.appendChild(el('span', { class: 'rni-caret' }));
      preview.appendChild(doc.createTextNode(after));
    };
    contentArea.addEventListener('input', renderPreview);
    renderPreview();

    const body = el('div', {}, [
      el('div', { class: 'rni-field' }, [
        el('label', { class: 'rni-label', text: '标题' }),
        titleInput,
      ]),
      el('div', { class: 'rni-field' }, [
        el('label', { class: 'rni-label', text: '描述（只给自己看，不会注入）' }),
        descInput,
      ]),
      el('div', { class: 'rni-field' }, [
        el('label', { class: 'rni-label', text: '注入内容' }),
        contentArea,
        el('div', { class: 'rni-hint' }, [
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
    const tabs = el('div', { class: 'rni-tabs' }, [
      el('button', { class: 'rni-tab rni-active', text: '从世界书导入', dataset: { mode: 'worldbook' }, type: 'button' }),
      el('button', { class: 'rni-tab', text: '批量粘贴', dataset: { mode: 'paste' }, type: 'button' }),
    ]);
    const pane = el('div', {});
    body.appendChild(tabs);
    body.appendChild(pane);

    let buildWorldbookPane = () => {};
    let buildPastePane = () => {};

    const switchMode = (next) => {
      mode = next;
      tabs.querySelectorAll('.rni-tab').forEach((b) => b.classList.toggle('rni-active', b.dataset.mode === mode));
      pane.textContent = '';
      if (mode === 'worldbook') buildWorldbookPane();
      else buildPastePane();
    };
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.rni-tab');
      if (btn) switchMode(btn.dataset.mode);
    });

    /* ---- 批量粘贴 ---- */
    buildPastePane = () => {
      const area = el('textarea', {
        class: 'rni-textarea',
        placeholder: '一行一个名字，例如：\n徐渭\n沈砚\n柳娘',
      });
      area.style.minHeight = '180px';

      pane.appendChild(el('div', { class: 'rni-field' }, [
        el('label', { class: 'rni-label', text: '名字列表' }),
        area,
        el('div', { class: 'rni-hint', text: '每行生成一个条目，注入内容自动填成「名字：“|”」，生成后可以逐个改。' }),
      ]));

      const stats = el('div', { class: 'rni-hint' });
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

      const actions = el('div', { class: 'rni-actions' }, [
        el('button', { class: 'rni-btn', text: '取消', type: 'button', onclick: closeModal }),
        el('button', {
          class: 'rni-btn rni-primary', text: '导入', type: 'button',
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
      const hint = el('div', { class: 'rni-hint', text: '正在读取世界书…' });
      pane.appendChild(hint);

      const status = el('div', { class: 'rni-hint' });
      const filterInput = el('input', { class: 'rni-input', type: 'text', placeholder: '🔍 过滤条目名或内容…' });
      const listBox = el('div', { class: 'rni-check-list' });
      const toolbar = el('div', { class: 'rni-row' }, [
        el('button', { class: 'rni-btn', text: '全选', type: 'button' }),
        el('button', { class: 'rni-btn', text: '全不选', type: 'button' }),
        el('button', { class: 'rni-btn', text: '反选', type: 'button' }),
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
          listBox.appendChild(el('div', { class: 'rni-hint', text: candidates.length ? '没有匹配的条目。' : '没有可导入的新条目。' }));
        }

        for (const c of shown) {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = checked.has(c.name);
          cb.addEventListener('change', () => {
            if (cb.checked) checked.add(c.name);
            else checked.delete(c.name);
            updateStatus();
          });
          const item = el('label', { class: 'rni-check-item' }, [
            cb,
            el('div', { class: 'rni-check-main' }, [
              el('div', { class: 'rni-check-name', text: c.name }),
              c.preview ? el('div', { class: 'rni-check-preview', title: c.preview, text: c.preview }) : null,
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
        const btn = e.target.closest('.rni-btn');
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

      const actions = el('div', { class: 'rni-actions' }, [
        el('button', { class: 'rni-btn', text: '取消', type: 'button', onclick: closeModal }),
        el('button', {
          class: 'rni-btn rni-primary', text: '导入所选', type: 'button',
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

      pane.appendChild(el('div', { class: 'rni-field' }, [filterInput]));
      pane.appendChild(el('div', { class: 'rni-row' }, [
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

  /* ==================== 设置 ==================== */

  function openSettings() {
    const modeSelect = el('select', { class: 'rni-input' }, [
      el('option', { value: 'append', text: '追加到末尾（默认）' }),
      el('option', { value: 'replace', text: '替换输入框全部内容' }),
      el('option', { value: 'cursor', text: '插入到当前光标处' }),
    ]);
    modeSelect.value = settings.injectMode;

    const autoClose = el('input', { type: 'checkbox' });
    autoClose.checked = !!settings.autoCloseAfterInject;

    const showBall = el('input', { type: 'checkbox' });
    showBall.checked = !!settings.showFloatingBall;

    const themeSelect = el('select', { class: 'rni-input' }, [
      el('option', { value: 'auto', text: '跟随酒馆（自动判断明暗）' }),
      el('option', { value: 'dark', text: '始终用深色' }),
      el('option', { value: 'light', text: '始终用浅色' }),
    ]);
    themeSelect.value = settings.theme || 'auto';

    const body = el('div', {}, [
      el('div', { class: 'rni-field' }, [
        el('label', { class: 'rni-label', text: '注入方式' }),
        modeSelect,
      ]),
      el('div', { class: 'rni-row' }, [
        el('label', {}, [autoClose, ' 注入后自动收起面板']),
      ]),
      el('div', { class: 'rni-row' }, [
        el('label', {}, [showBall, ' 显示悬浮球']),
      ]),
      el('div', { class: 'rni-field' }, [
        el('label', { class: 'rni-label', text: '面板配色' }),
        themeSelect,
      ]),
      el('hr', { style: 'border:none;border-top:1px solid var(--rni-border);margin:14px 0;' }),
      el('div', { class: 'rni-row' }, [
        el('button', { class: 'rni-btn', text: '导出通用池条目', type: 'button', onclick: exportEntries }),
        el('button', { class: 'rni-btn', text: '导入条目', type: 'button', onclick: openImportJson }),
      ]),
      el('div', { class: 'rni-hint' }, [
        `角色名注入 v${SCRIPT_VERSION}`,
        el('br'),
        '本卡池条目随角色卡导出；通用池条目随用户存档。导出按钮导出的是通用池。',
      ]),
    ]);

    const save = async () => {
      settings.injectMode = modeSelect.value;
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

  function exportEntries() {
    const store = globalStore;
    if (!store) return;
    if (!store.entries.length) { toast('通用池里还没有条目', 'warning'); return; }
    const payload = {
      __角色名注入__: true,
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: store.entries,
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = `角色名注入-通用池-${new Date().toISOString().slice(0, 10)}.json`;
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(`已导出 ${store.entries.length} 个条目`, 'success');
    } catch (e) {
      copyToClipboard(text);
      toast('已复制到剪贴板（文件下载不可用）');
    }
  }

  function openImportJson() {
    const area = el('textarea', { class: 'rni-textarea', placeholder: '把导出的 JSON 粘贴到这里' });
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
      el('div', { class: 'rni-field' }, [
        el('label', { class: 'rni-label', text: '粘贴 JSON' }),
        area,
        el('div', { class: 'rni-hint' }, [
          el('button', { class: 'rni-btn', text: '选择文件…', type: 'button', onclick: () => fileInput.click() }),
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
      const incoming = Array.isArray(data && data.entries) ? data.entries : null;
      if (!incoming) { toast('这份 JSON 里没有 entries 字段', 'error'); return false; }

      const store = globalStore;
      if (!store) return false;

      const conflicts = [];
      for (const raw of incoming) {
        const entry = normalizeEntry(raw);
        const dup = store.entries.find((x) => x.title === entry.title);
        if (dup) conflicts.push({ entry, dup });
      }

      const apply = async (resolutions) => {
        if (!storeStillValid('global', store)) return false;
        let added = 0;
        let replaced = 0;

        const res = await mutateStore('global', (live) => {
          for (const raw of incoming) {
            const entry = normalizeEntry(raw);
            const idx = live.entries.findIndex((x) => x.title === entry.title);
            if (idx < 0) {
              live.entries.push(entry);
              added++;
              continue;
            }
            const how = resolutions.get(entry.title) || 'skip';
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

        if (res.ok) {
          renderAll();
          setStatus(`导入完成：新增 ${added}，覆盖 ${replaced}`);
          toast(`导入完成：新增 ${added}，覆盖 ${replaced}`, 'success');
        }
        return res.ok;
      };

      if (!conflicts.length) {
        const ok = await apply(new Map());
        if (ok) closeModal();
        return ok;
      }

      // 有冲突：逐个选
      const resolutions = new Map();
      const listBox = el('div', { class: 'rni-check-list' });
      for (const { entry, dup } of conflicts) {
        const sel = el('select', { class: 'rni-input' }, [
          el('option', { value: 'skip', text: '保留我的（跳过这条）' }),
          el('option', { value: 'theirs', text: '用对方的覆盖' }),
          el('option', { value: 'both', text: '两个都留' }),
        ]);
        sel.addEventListener('change', () => resolutions.set(entry.title, sel.value));
        resolutions.set(entry.title, 'skip');
        listBox.appendChild(el('div', { class: 'rni-check-item' }, [
          el('div', { class: 'rni-check-main' }, [
            el('div', { class: 'rni-check-name', text: entry.title }),
            el('div', { class: 'rni-check-preview', text: `我的：${dup.content || '（空）'}` }),
            el('div', { class: 'rni-check-preview', text: `对方：${entry.content || '（空）'}` }),
            sel,
          ]),
        ]));
      }

      const conflictBody = el('div', {}, [
        el('div', { class: 'rni-hint', text: `有 ${conflicts.length} 个标题重名，请逐个选择处理方式：` }),
        listBox,
      ]);

      showModal({
        title: '处理重名冲突',
        contentEl: conflictBody,
        wide: true,
        buttons: [
          { text: '取消' },
          {
            text: '确认导入',
            primary: true,
            onClick: async () => { await apply(resolutions); },
          },
        ],
      });
      return false; // 不关闭当前弹窗，交给冲突弹窗处理
    };

    showModal({
      title: '导入条目（导入到通用池）',
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
      title: '角色名注入',
      text: '🎭',
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

  function registerGlobalHandlers() {
    // 点击面板外部关闭（弹窗打开时不生效，点悬浮球/入口按钮不算外部）
    onPage(doc, 'mousedown', (e) => {
      if (!panelOpen() || modalOpen()) return;
      const panel = doc.getElementById(PANEL_ID);
      if (panel && panel.contains(e.target)) return;
      const ball = doc.getElementById(BALL_ID);
      if (ball && ball.contains(e.target)) return;
      const entry = doc.getElementById(ENTRY_ID);
      if (entry && entry.contains(e.target)) return;
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
      if (panel && !panel.classList.contains('rni-hidden')) {
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
        id,
        title: `角色名注入启动失败：${msg}\n（点一下复制错误信息）`,
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
      const msg = `角色名注入无法启动：${problems.join('；')}`;
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
    [PANEL_ID, STYLE_ID, BALL_ID, ENTRY_ID].forEach((id) => {
      const node = doc.getElementById(id);
      if (node) node.remove();
    });
    closeModal();
  }

  function uninstall() {
    // eventOn 注册的监听会随脚本关闭自动卸载，这里清理自己注入的 DOM 与页面监听
    clearBallListeners();
    clearPageListeners();
    [PANEL_ID, STYLE_ID, BALL_ID, ENTRY_ID, `${ENTRY_ID}-fatal`].forEach((id) => {
      const node = doc.getElementById(id);
      if (node) node.remove();
    });
    closeModal();
    if (host[INSTANCE_KEY] === TOKEN) delete host[INSTANCE_KEY];
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
          toast('角色名注入启动失败：' + msg, 'error');
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
