// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Civinar-Riley

/**
 * CSS 静态检查（不需要浏览器）。
 *
 * 用法：node test/test-css.js
 *
 * 为什么需要：v1.2.0 的日志区「展开后关不掉」是个纯 CSS 优先级问题——
 * 折叠类与被折叠元素的规则优先级相同，谁写在后面谁赢，而后者恰好设了
 * display: flex。这类问题在假 DOM 测试里完全测不出来，只能靠静态检查兜。
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', '角色提词器.js');
const source = fs.readFileSync(SRC, 'utf8');

const cssStart = source.indexOf('const CSS_TEXT = `');
const cssEnd = source.indexOf('`;', cssStart);
if (cssStart < 0 || cssEnd < 0) {
  console.error('找不到 CSS_TEXT');
  process.exit(1);
}
const cssRaw = source.slice(cssStart + 'const CSS_TEXT = `'.length, cssEnd);
const jsCode = source.slice(0, cssStart) + source.slice(cssEnd);

// 还原 CSS 里的 ${PANEL_ID} 这类插值
const ID_MAP = {};
for (const m of source.matchAll(/const (PANEL_ID|STYLE_ID|BALL_ID|ENTRY_ID|MODAL_ID) = '([^']+)'/g)) {
  ID_MAP[m[1]] = m[2];
}
const css = cssRaw
  .replace(/\$\{(\w+)\}/g, (_, name) => ID_MAP[name] || `__${name}__`)
  // 必须先去掉注释：注释里也会出现 `.类名`、`#id` 这类字样，
  // 混进选择器会让特异度算错（这个检查器自己踩过一次）。
  .replace(/\/\*[\s\S]*?\*\//g, '');

/* ---------- 断言工具 ---------- */

let pass = 0;
let fail = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; failures.push(`${name}\n    期望: ${e}\n    实际: ${a}`); }
}

/* ---------- 拆 CSS 规则 ---------- */

function parseRules(text) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    const body = m[2].trim();
    if (!selector || selector.startsWith('@')) continue;
    rules.push({ selector, body, index: m.index });
  }
  return rules;
}

const rules = parseRules(css);
check('CSS: 解析出了规则', rules.length > 10, true);

/* ---------- 选择器分析 ---------- */

/** 把一个选择器拆成"作用在哪个元素上"的描述 */
function analyze(selector) {
  const last = selector.split(/\s+|>/).filter(Boolean).pop() || selector;
  const ids = new Set((last.match(/#[\w-]+/g) || []).map((s) => s.slice(1)));
  const classes = new Set((last.match(/\.[\w-]+/g) || []).map((s) => s.slice(1)));
  return { last, ids, classes, depth: selector.split(/\s+|>/).filter(Boolean).length };
}

/** 特异度：id 权重 100，class 权重 10 */
function specificity(selector) {
  return (selector.match(/#[\w-]+/g) || []).length * 100
    + (selector.match(/\.[\w-]+/g) || []).length * 10;
}

/**
 * 两个选择器能否命中同一个元素。
 * 关键点：深度必须相同（`#panel.hidden` 命中的是面板本身，
 * 而 `#panel .item` 命中的是面板里的元素，两者永远不冲突）。
 */
function canMatchSameElement(a, b) {
  if (a.depth !== b.depth) return false;
  for (const id of a.ids) if (b.ids.size && !b.ids.has(id)) return false;
  for (const id of b.ids) if (a.ids.size && !a.ids.has(id)) return false;
  return true;
}

/* ---------- 检查 1：隐藏规则会不会被后面的同优先级规则盖掉 ---------- */

// 这就是日志区那个 bug 的形态：
//   #panel .rpt-collapsed { display: none; }        ← 先写
//   #panel .rpt-logs { display: flex; }             ← 后写，优先级相同 → 赢
// 只有"能命中同一元素 + 优先级不低于它 + 写在后面"才算真冲突。
const displayRules = rules.filter((r) => /(^|;)\s*display\s*:/.test(r.body));
const conflicts = [];

for (const hide of displayRules) {
  if (!/display\s*:\s*none/.test(hide.body)) continue;
  if (/display\s*:\s*none\s*!important/.test(hide.body)) continue;   // 带 !important 就免疫

  const a = analyze(hide.selector);
  for (const other of displayRules) {
    if (other.index <= hide.index) continue;                          // 只看写在后面的
    if (/display\s*:\s*none/.test(other.body)) continue;               // 都是隐藏，不冲突
    const b = analyze(other.selector);
    if (!canMatchSameElement(a, b)) continue;
    if (specificity(other.selector) < specificity(hide.selector)) continue;  // 优先级低，盖不掉
    conflicts.push(`${hide.selector}  (display:none)  被后面的  ${other.selector}  盖掉`);
    break;
  }
}

check('CSS: 隐藏规则不会被后面的同优先级规则盖掉', conflicts, []);

/* ---------- 检查 2：JS 里用到的类名必须能在 CSS 里找到 ---------- */

// 只从"类名出现的上下文"里提取，避免把 id 常量、CSS 变量名混进来
const classStrings = [];
for (const m of jsCode.matchAll(/class:\s*(['"`])([^'"`]*)\1/g)) classStrings.push(m[2]);
for (const m of jsCode.matchAll(/classList\.(?:toggle|add|remove|contains)\(\s*'([^']+)'/g)) classStrings.push(m[1]);

const jsClasses = new Set();
for (const s of classStrings) {
  for (const tok of s.match(/rpt-[a-z][a-z0-9-]*/g) || []) {
    if (tok.endsWith('-')) continue;   // 模板拼接的前缀（如 rpt-log-），不是完整类名
    jsClasses.add(tok);
  }
}

const cssClasses = new Set();
for (const m of css.matchAll(/\.(rpt-[a-z][a-z0-9-]*)/g)) cssClasses.add(m[1]);

const missing = [...jsClasses].filter((c) => !cssClasses.has(c)).sort();
check('CSS: JS 里用到的每个类名都有对应样式（防拼错）', missing, []);

/* ---------- 检查 3：CSS 引用的 id 必须真的会被创建 ---------- */

const cssIds = new Set();
for (const m of css.matchAll(/#(rpt-[a-z][a-z0-9-]*)/g)) cssIds.add(m[1]);
const jsIds = new Set(Object.values(ID_MAP));
const orphanIds = [...cssIds].filter((id) => !jsIds.has(id)).sort();
check('CSS: 引用的 id 都在 JS 里定义过（防写错 id）', orphanIds, []);

/* ---------- 检查 4：动态拼接的类后缀要有定义 ---------- */

// rpt-log-${level} 这种拼接出来的类，把可能的后缀列出来确认有定义
const dynamicSuffixes = ['info', 'warn', 'error', 'empty'];
const missingSuffix = dynamicSuffixes
  .filter((s) => !cssClasses.has(`rpt-log-${s}`) && !cssClasses.has('rpt-log'))
  .map((s) => `rpt-log-${s}`);
check('CSS: 日志级别的动态类有定义', missingSuffix, []);

/* ---------- 检查 5：折叠类两端都在 ---------- */

check('CSS: rpt-collapsed 有隐藏样式', cssClasses.has('rpt-collapsed'), true);
check('CSS: rpt-collapsed 用 classList.toggle 切换', /classList\.toggle\('rpt-collapsed'\)/.test(jsCode), true);
check(
  'CSS: rpt-collapsed 的隐藏带 !important（它必须能压过元素自身样式）',
  /\.rpt-collapsed\s*\{[^}]*display\s*:\s*none\s*!important/.test(css),
  true,
);

/* ---------- 汇总 ---------- */

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('\n失败详情：');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('全部通过 ✓');
