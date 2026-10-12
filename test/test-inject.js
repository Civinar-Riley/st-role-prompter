/**
 * 注入路径的端到端测试（用假 DOM，不需要浏览器）。
 *
 * 用法：node test/test-inject.js
 *
 * 做法：从源码里切片出 findSendTextarea + injectToInputBox，在隔离作用域里
 * 注入假的 doc / host / toast / copyToClipboard，然后断言输入框的最终状态。
 * 覆盖的是真正的注入代码，不是复制的副本。
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

const pureCode = slice('/* __TEST_SLICE_START__ */', '/* __TEST_SLICE_END__ */');
const injectCode = slice('/* __INJECT_SLICE_START__ */', '/* __INJECT_SLICE_END__ */');

/* ---------- 假 DOM ---------- */

class FakeEvent {
  constructor(type, opts) {
    this.type = type;
    this.bubbles = !!(opts && opts.bubbles);
  }
}

function makeTextarea(value) {
  const listeners = {};
  return {
    tagName: 'TEXTAREA',
    value: value || '',
    selectionStart: (value || '').length,
    selectionEnd: (value || '').length,
    focused: false,
    selection: null,
    events: [],
    dispatchEvent(e) {
      this.events.push(e.type);
      (listeners[e.type] || []).forEach((fn) => fn(e));
      return true;
    },
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    focus() { this.focused = true; },
    setSelectionRange(s, e) { this.selection = [s, e]; },
  };
}

function makeEnv({ textarea, selectorMiss = false } = {}) {
  const toasts = [];
  const copies = [];
  let lastCreated = null;
  const doc = {
    querySelector(sel) {
      if (selectorMiss) return null;
      return sel === '#send_textarea' ? textarea : null;
    },
    // 供 copyToClipboard 的降级路径使用（createElement + execCommand('copy')）
    createElement() {
      lastCreated = {
        value: '',
        style: { cssText: '' },
        appendChild() {},
        remove() {},
        select() {},
      };
      return lastCreated;
    },
    body: { appendChild() {}, removeChild() {} },
    execCommand(cmd) {
      if (cmd === 'copy') {
        if (lastCreated) copies.push(lastCreated.value);
        return true;
      }
      return false;
    },
  };
  const host = { navigator: null };
  return {
    textarea,
    toasts,
    copies,
    sandbox: {
      doc,
      host,
      TAG: '[test]',
      Event: FakeEvent,
      console,
      Math,
      String,
      Number,
      Array,
      Object,
      JSON,
      Set,
      Map,
      RegExp,
      Date,
      toast: (msg, type) => toasts.push({ msg, type }),
    },
  };
}

function run({ textarea, selectorMiss, mode, text, cursor, quiet }) {
  const env = makeEnv({ textarea, selectorMiss });
  if (quiet) {
    // 故意触发异常的用例：把 console.error 静音，保持测试输出干净
    env.sandbox.console = { info() {}, log() {}, warn() {}, error() {} };
  }
  vm.createContext(env.sandbox);
  vm.runInContext(
    `${pureCode}\n${injectCode}\n;globalThis.__fns = { findSendTextarea, injectToInputBox };`,
    env.sandbox,
  );
  const ok = env.sandbox.__fns.injectToInputBox(text, cursor, mode);
  return { ok, env };
}

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

/* ---- 1. 基本注入：光标停在引号中间 ---- */
{
  const ta = makeTextarea('');
  const { ok, env } = run({ textarea: ta, mode: 'append', text: '徐渭：“”', cursor: 4 });
  check('注入: 返回成功', ok, true);
  check('注入: 输入框文本', ta.value, '徐渭：“”');
  check('注入: 光标位置', ta.selection, [4, 4]);
  check('注入: 输入框获得焦点', ta.focused, true);
  check('注入: 派发了 input 事件', ta.events.includes('input'), true);
  check('注入: 无错误提示', env.toasts.length, 0);
}

/* ---- 2. 追加模式 ---- */
{
  const ta = makeTextarea('沈砚：“”');
  ta.selectionStart = 5;
  ta.selectionEnd = 5;
  run({ textarea: ta, mode: 'append', text: '徐渭：“”', cursor: 4 });
  check('追加: 换行拼接', ta.value, '沈砚：“”\n徐渭：“”');
  check('追加: 光标落在新条目', ta.selection, [10, 10]);
}

/* ---- 3. 替换模式 ---- */
{
  const ta = makeTextarea('要被清掉的内容');
  ta.selectionStart = 2;
  ta.selectionEnd = 4;
  run({ textarea: ta, mode: 'replace', text: '新内容', cursor: 3 });
  check('替换: 覆盖全部', ta.value, '新内容');
  check('替换: 光标位置', ta.selection, [3, 3]);
}

/* ---- 4. 插入光标处模式 ---- */
{
  const ta = makeTextarea('前XX后');
  ta.selectionStart = 1;
  ta.selectionEnd = 3;
  run({ textarea: ta, mode: 'cursor', text: '中间', cursor: 2 });
  check('插入: 替换选区', ta.value, '前中间后');
  check('插入: 光标位置', ta.selection, [3, 3]);
}

/* ---- 5. 找不到输入框 → 复制到剪贴板 ---- */
{
  const ta = makeTextarea('');
  const { ok, env } = run({ textarea: ta, selectorMiss: true, mode: 'append', text: '徐渭：“”', cursor: 4 });
  check('降级: 返回失败', ok, false);
  check('降级: 复制了文本', env.copies, ['徐渭：“”']);
  check('降级: 给了提示', env.toasts.length, 1);
  check('降级: 提示类型', env.toasts[0].type, 'warning');
  check('降级: 没有动输入框', ta.value, '');
}

/* ---- 6. setSelectionRange 抛错时不崩（预期会打一条 console.error，已静音） ---- */
{
  const ta = makeTextarea('');
  ta.setSelectionRange = () => { throw new Error('boom'); };
  const { ok } = run({ textarea: ta, mode: 'append', text: 'abc', cursor: 1, quiet: true });
  check('异常: 捕获后返回失败', ok, false);
  check('异常: 文本已写入', ta.value, 'abc');
}

/* ---- 7. 无光标标记（光标在末尾） ---- */
{
  const ta = makeTextarea('');
  run({ textarea: ta, mode: 'append', text: '徐渭：“”', cursor: 5 });
  check('无标记: 光标在末尾', ta.selection, [5, 5]);
}

/* ---- 8. 多行模板 ---- */
{
  const ta = makeTextarea('');
  run({ textarea: ta, mode: 'append', text: '徐渭：“”\n（他抬起头）', cursor: 4 });
  check('多行: 完整注入', ta.value, '徐渭：“”\n（他抬起头）');
  check('多行: 光标位置', ta.selection, [4, 4]);
}

/* ---- 汇总 ---- */
console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('\n失败详情：');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('全部通过 ✓');
