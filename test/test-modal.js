// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Civinar-Riley

/**
 * 弹窗串联的回归测试（用假 DOM 驱动真实弹窗代码）。
 *
 * 用法：node test/test-modal.js
 *
 * 为什么需要这个测试：清空数据用的是"三次确认串联"，踩过一个真实的时序坑——
 * 按钮处理器里 `await b.onClick()` 之后才调 closeModal，而 onClick 里 resolve 的
 * Promise 续体是更早入队的微任务，于是续体可能已经弹出了下一个确认框，
 * 这时无令牌的 closeModal 会把**新弹窗**关掉，表现为"点继续等于取消"。
 * 这个测试就是盯住这个行为。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', '角色提词器.js');
const source = fs.readFileSync(SRC, 'utf8');

function slice(startMark, endMark) {
  const a = source.indexOf(startMark);
  const b = source.indexOf(endMark);
  if (a < 0 || b < 0) throw new Error(`切片标记缺失：${startMark}`);
  return source.slice(a + startMark.length, b);
}

const elCode = slice('/* __EL_SLICE_START__ */', '/* __EL_SLICE_END__ */');
const modalCode = slice('/* __MODAL_SLICE_START__ */', '/* __MODAL_SLICE_END__ */');

/* ---------- 假 DOM ---------- */

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.className = '';
    this.textContent = '';
    this.children = [];
    this.parent = null;
    this.style = { cssText: '' };
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    const classes = new Set();
    this.classList = {
      toggle: (cls, force) => {
        const on = force === undefined ? !classes.has(cls) : !!force;
        if (on) classes.add(cls); else classes.delete(cls);
        return on;
      },
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    };
  }

  setAttribute(k, v) {
    this.attrs[k] = v;
    if (k === 'id') this.id = v;
  }

  appendChild(node) {
    node.parent = this;
    this.children.push(node);
    return node;
  }

  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
  }

  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }

  removeEventListener(type, fn) {
    if (this.listeners[type]) this.listeners[type] = this.listeners[type].filter((f) => f !== fn);
  }

  /** 触发事件：同步跑到处理器的第一个 await，返回处理器返回的 promise 数组 */
  fire(type, evt) {
    const list = this.listeners[type] || [];
    return list.map((fn) => fn(evt || { type, target: this }));
  }

  find(pred) {
    if (pred(this)) return this;
    for (const c of this.children) {
      const r = c.find(pred);
      if (r) return r;
    }
    return null;
  }

  findAll(pred, out = []) {
    if (pred(this)) out.push(this);
    for (const c of this.children) c.findAll(pred, out);
    return out;
  }
}

function makeEnv() {
  const body = new FakeNode('body');
  const doc = {
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (text) => {
      const n = new FakeNode('#text');
      n.textContent = String(text);
      return n;
    },
    body,
  };
  const state = { openModalEl: null, openModalToken: 0, openModalOnClose: null };
  const sandbox = {
    doc,
    state,
    applyTheme: () => {},
    settings: { theme: 'dark' },
    TAG: '[test]',
    console,
    Object,
    Array,
    String,
    Number,
    Math,
    JSON,
    Promise,
    Set,
    Map,
    Date,
    RegExp,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${elCode}\n${modalCode}\n;globalThis.__fns = { el, showModal, closeModal, modalOpen, askConfirm };`,
    sandbox,
  );
  return { doc, state, body, fns: sandbox.__fns };
}

/** 让所有待处理的微任务和宏任务跑完 */
const flush = () => new Promise((r) => setTimeout(r, 0));

/* ---------- 断言 ---------- */

let pass = 0;
let fail = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; failures.push(`${name}\n    期望: ${e}\n    实际: ${a}`); }
}

function modalInfo(state) {
  const mask = state.openModalEl;
  if (!mask) return null;
  const h3 = mask.find((n) => n.tagName === 'H3');
  const buttons = mask.findAll((n) => n.tagName === 'BUTTON').map((b) => b.textContent);
  return { title: h3 ? h3.textContent : '', buttons };
}

/** 点当前弹窗上指定文字的按钮；不传 label 就点第一个非「取消」的 */
function clickModal(state, label) {
  const mask = state.openModalEl;
  if (!mask) return false;
  const btns = mask.findAll((n) => n.tagName === 'BUTTON');
  const btn = label ? btns.find((b) => b.textContent === label) : btns.find((b) => b.textContent !== '取消');
  if (!btn) return false;
  btn.fire('click');
  return true;
}

/* ---------- 同步断言部分 ---------- */

function syncTests() {
  // 1. 基本
  {
    const { state, fns } = makeEnv();
    fns.showModal({ title: '标题A', buttons: [{ text: '取消' }, { text: '确定', primary: true }] });
    check('基本: 弹窗已开', fns.modalOpen(), true);
    check('基本: 标题正确', modalInfo(state).title, '标题A');
    check('基本: 按钮正确', modalInfo(state).buttons, ['取消', '确定']);
    check('基本: 令牌是 1', state.openModalToken, 1);

    fns.closeModal();
    check('基本: 已关闭', fns.modalOpen(), false);
    check('基本: DOM 已移除', state.openModalEl, null);
  }

  // 2. 令牌隔离
  {
    const { state, fns } = makeEnv();
    fns.showModal({ title: '第一个', buttons: [{ text: '确定' }] });
    const token1 = state.openModalToken;
    fns.showModal({ title: '第二个', buttons: [{ text: '确定' }] });
    const token2 = state.openModalToken;

    check('令牌: 两次弹窗令牌不同', token1 !== token2, true);

    fns.closeModal(token1);
    check('令牌: 旧令牌关不掉新弹窗', fns.modalOpen(), true);
    check('令牌: 新弹窗还在', modalInfo(state).title, '第二个');

    fns.closeModal(token2);
    check('令牌: 自己的令牌能关掉', fns.modalOpen(), false);
  }

  // 3. 无令牌仍能关当前（替换场景）
  {
    const { state, fns } = makeEnv();
    fns.showModal({ title: 'A', buttons: [{ text: '确定' }] });
    fns.closeModal();
    check('无令牌: 关掉当前弹窗', fns.modalOpen(), false);
    check('无令牌: 令牌清零', state.openModalToken, 0);
  }

  // 4. onClose 只回调一次
  {
    const { fns } = makeEnv();
    let count = 0;
    fns.showModal({ title: 'X', buttons: [{ text: '确定' }], onClose: () => { count++; } });
    fns.closeModal();
    check('onClose: 关闭时回调一次', count, 1);
    fns.closeModal();
    check('onClose: 重复关闭不再回调', count, 1);
  }

  // 5. 用新弹窗替换旧弹窗时，旧弹窗的 onClose 要触发
  {
    const { state, fns } = makeEnv();
    let closed = 0;
    fns.showModal({ title: '旧', buttons: [{ text: '确定' }], onClose: () => { closed++; } });
    fns.showModal({ title: '新', buttons: [{ text: '确定' }] });
    check('替换: 旧弹窗的 onClose 触发了', closed, 1);
    check('替换: 当前是新的那个', modalInfo(state).title, '新');
  }

  // 6. 回归：closeModal 被当作事件处理器直接绑定（`onclick: closeModal`）时，
  //    第一个参数是 MouseEvent 而不是令牌。不能把它当成令牌而拒绝关闭。
  {
    const { fns } = makeEnv();
    fns.showModal({ title: 'X', buttons: [{ text: '取消' }] });
    fns.closeModal({ type: 'click', target: {} });
    check('容错: 事件对象当参数也能关闭', fns.modalOpen(), false);
  }
  {
    const { fns } = makeEnv();
    fns.showModal({ title: 'X', buttons: [{ text: '取消' }] });
    fns.closeModal(null);
    check('容错: null 当参数也能关闭', fns.modalOpen(), false);
  }
  // 而真正的数字令牌仍然要能拦住"关错弹窗"
  {
    const { fns, state } = makeEnv();
    fns.showModal({ title: 'A', buttons: [{ text: '确定' }] });
    const t1 = state.openModalToken;
    fns.showModal({ title: 'B', buttons: [{ text: '确定' }] });
    fns.closeModal(t1);
    check('容错: 数字令牌仍被识别并拦住', fns.modalOpen(), true);
  }
}

/* ---------- 异步断言部分 ---------- */

async function asyncTests() {
  // 6. askConfirm 基本行为
  {
    const { state, fns } = makeEnv();
    const p1 = fns.askConfirm('确认？', '正文', { danger: true, okText: '继续' });
    check('确认框: 标题', modalInfo(state).title, '确认？');
    check('确认框: 按钮用 okText', modalInfo(state).buttons, ['取消', '继续']);
    clickModal(state, '继续');
    check('确认框: 点继续返回 true', await p1, true);
  }
  {
    const { state, fns } = makeEnv();
    const p2 = fns.askConfirm('确认？', '正文', { okText: '继续' });
    clickModal(state, '取消');
    check('确认框: 点取消返回 false', await p2, false);
  }

  // 7. 关键回归：三次确认串联（就是踩过的那个坑）
  {
    const { state, fns } = makeEnv();

    const steps = ['第一次', '第二次', '第三次'];
    const threeStep = (async () => {
      for (let i = 0; i < steps.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await fns.askConfirm(
          `清空（第 ${i + 1}/3 次确认）`,
          steps[i],
          { danger: true, okText: i === 2 ? '确认清空' : '继续' },
        );
        if (!ok) return false;
      }
      return true;
    })();

    const seenTitles = [];
    let broken = false;

    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line no-await-in-loop
      await flush();
      const info = modalInfo(state);
      if (!info) { broken = true; break; }
      seenTitles.push(info.title);
      clickModal(state);                        // 点非「取消」那个
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }

    const result = await threeStep;

    check('串联: 三次确认框依次弹出', seenTitles, [
      '清空（第 1/3 次确认）',
      '清空（第 2/3 次确认）',
      '清空（第 3/3 次确认）',
    ]);
    check('串联: 中途没有断掉', broken, false);
    check('串联: 三次都确认后返回 true', result, true);
    check('串联: 结束后无残留弹窗', fns.modalOpen(), false);
  }

  // 8. 串联中途取消应中止
  {
    const { state, fns } = makeEnv();

    const threeStep = (async () => {
      for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await fns.askConfirm(`第 ${i + 1} 次`, '正文', { okText: '继续' });
        if (!ok) return false;
      }
      return true;
    })();

    await flush();
    clickModal(state, '继续');
    await flush();
    const info2 = modalInfo(state);
    check('取消: 第 2 次确认框已弹出', info2 ? info2.title : '(没有弹窗)', '第 2 次');
    clickModal(state, '取消');
    await flush();

    check('取消: 返回 false', await threeStep, false);
    check('取消: 弹窗已关闭', fns.modalOpen(), false);
  }

  // 9. 点遮罩关闭算取消
  {
    const { state, fns } = makeEnv();
    const p = fns.askConfirm('问一句', '正文', { okText: '继续' });
    await flush();
    const mask = state.openModalEl;
    check('遮罩: 弹窗存在', !!mask, true);
    if (mask) {
      mask.fire('mousedown', { type: 'mousedown', target: mask });
      check('遮罩: 关闭算取消', await p, false);
    }
  }

  // 10. 回归：异步回调期间禁用按钮，防止双击跑两遍回调
  //     （双击「保存」会新建出两条条目：「徐渭」和「徐渭 2」）
  {
    const { state, fns } = makeEnv();
    let calls = 0;
    let release;
    fns.showModal({
      title: '编辑',
      buttons: [
        { text: '取消' },
        {
          text: '保存',
          primary: true,
          onClick: () => {
            calls++;
            return new Promise((r) => { release = r; });
          },
        },
      ],
    });
    const mask = state.openModalEl;
    const saveBtn = mask.findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent === '保存');
    const cancelBtn = mask.findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent === '取消');

    saveBtn.fire('click');                       // 第一次点击，进入 await
    check('防重复: 第一次点击后按钮已禁用', saveBtn.disabled, true);
    check('防重复: 同组按钮也一起禁用', cancelBtn.disabled, true);

    saveBtn.fire('click');                       // 模拟双击
    check('防重复: 双击只调用一次回调', calls, 1);

    release();                                   // 让回调结束
    await flush();
    check('防重复: 完成后按钮恢复可用', saveBtn.disabled, false);
    check('防重复: 完成后弹窗已关闭', fns.modalOpen(), false);
  }

  // 11. 回调返回 false 时按钮也要恢复（让用户能重试）
  {
    const { state, fns } = makeEnv();
    fns.showModal({
      title: 'X',
      buttons: [{ text: '保存', primary: true, onClick: () => false }],
    });
    const mask = state.openModalEl;
    const btn = mask.findAll((n) => n.tagName === 'BUTTON')[0];
    btn.fire('click');
    await flush();
    check('返回 false: 按钮恢复可用', btn.disabled, false);
    check('返回 false: 弹窗保持打开', fns.modalOpen(), true);
  }
}

/* ---------- 入口 ---------- */

(async () => {
  syncTests();
  await asyncTests();

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) {
    console.log('\n失败详情：');
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log('全部通过 ✓');
})();
