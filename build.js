/**
 * 构建脚本：把 src/角色名注入.js 打包成可导入酒馆助手的脚本 JSON。
 *
 * 用法：node build.js
 *
 * 产出（dist/）：
 *   角色名注入-v<版本>.json      导入酒馆助手用
 *   角色名注入-v<版本>.full.js   完整 JS 源码（便于测试切片与排查）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src', '角色名注入.js');
const DIST = path.join(ROOT, 'dist');
const ID_FILE = path.join(ROOT, '.script-id');
const BUTTON_NAME = '角色名注入';

const source = fs.readFileSync(SRC, 'utf8');

// 版本号从源码里读，只维护一处
const versionMatch = source.match(/const SCRIPT_VERSION = '([^']+)'/);
if (!versionMatch) {
  console.error('构建失败：源码里找不到 SCRIPT_VERSION');
  process.exit(1);
}
const version = versionMatch[1];

// 脚本 id 保持稳定：首次构建生成，之后复用（避免用户导入后出现两个脚本）
let scriptId;
if (fs.existsSync(ID_FILE)) {
  scriptId = fs.readFileSync(ID_FILE, 'utf8').trim();
}
if (!scriptId) {
  scriptId = crypto.randomUUID();
  fs.writeFileSync(ID_FILE, scriptId, 'utf8');
  console.log(`已生成脚本 id：${scriptId}`);
}

const info = [
  `角色名注入 v${version}`,
  '',
  '悬浮面板管理「标题 / 描述 / 注入内容」条目，点击条目把注入内容送进酒馆输入框，',
  '光标停在注入内容里 | 标记的位置（\\| 表示一个字面竖线）。',
  '',
  '· 入口：脚本按钮「角色名注入」，或屏幕上的悬浮球（可右键隐藏，设置里可开回来）',
  '· 本卡池：条目存在当前角色卡上，随角色卡导出',
  '· 通用池：条目存在全局变量里，跨角色卡通用',
  '· 批量导入：可从世界书扫描条目名，或直接粘贴名字列表',
  '',
  `要求：SillyTavern 1.18+ / 酒馆助手 4.x+`,
].join('\n');

const scriptJson = {
  type: 'script',
  enabled: true,
  name: `角色名注入 v${version}`,
  id: scriptId,
  content: source,
  info,
  button: {
    enabled: true,
    buttons: [{ name: BUTTON_NAME, visible: true }],
  },
  data: {},
  export_with: { data: true, button: true },
};

fs.mkdirSync(DIST, { recursive: true });
const jsonPath = path.join(DIST, `角色名注入-v${version}.json`);
const jsPath = path.join(DIST, `角色名注入-v${version}.full.js`);

fs.writeFileSync(jsonPath, JSON.stringify(scriptJson, null, 2), 'utf8');
fs.writeFileSync(jsPath, source, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`已构建 v${version}`);
console.log(`  ${path.relative(ROOT, jsonPath)}  ${kb(fs.statSync(jsonPath).size)}`);
console.log(`  ${path.relative(ROOT, jsPath)}  ${kb(fs.statSync(jsPath).size)}`);
