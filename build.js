/**
 * 构建脚本：把 src/角色提词器.js 打包成可导入酒馆助手的脚本 JSON。
 *
 * 用法：node build.js
 *
 * 产出（dist/）：
 *   角色提词器-v<版本>.json      导入酒馆助手用
 *   角色提词器-v<版本>.full.js   完整 JS 源码（便于测试切片与排查）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src', '角色提词器.js');
const DIST = path.join(ROOT, 'dist');
const ID_FILE = path.join(ROOT, '.script-id');
const BUTTON_NAME = '角色提词器';

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
  `角色提词器 v${version}`,
  '',
  '【这是什么】',
  '一个悬浮在酒馆输入框上方的快捷面板。把常写的角色名、台词格式、Markdown 格式',
  '存成条目，点一下就注入到输入框，光标自动停在你要打字的位置——不用再手打角色名，',
  '也不用每次都敲一遍引号。',
  '',
  '【怎么用】',
  '1. 点输入框上方的脚本按钮「角色提词器」，或屏幕上的 🐧 悬浮球，打开面板',
  '2. 点面板里的条目 → 内容进入输入框，光标停在预设位置 → 接着打字',
  '',
  '【条目是什么】',
  '每个条目三段：',
  '  · 标题   —— 给你自己看的名字，比如「徐渭」',
  '  · 描述   —— 给你自己看的备注，不会注入，比如「{{user}}，冷漠剑客」',
  '  · 注入内容 —— 真正进输入框的东西，比如 徐渭：“|”',
  '',
  '注入内容里的 | 是光标标记：注入后光标停在那里，标记本身不会出现。',
  '想注入一个真正的竖线就写 \\|。不写标记时光标停在末尾。',
  '',
  '【两个池子】',
  '  · 本卡 —— 条目存在当前角色卡自己身上，切到哪张卡显示哪张卡的。',
  '           分享角色卡时条目一起带走；但更新/替换角色卡会被新卡内容覆盖，',
  '           更新卡前请先导出备份。',
  '  · 通用 —— 条目存在酒馆全局变量里，跨角色卡通用（自己的人设、反复出现的 NPC）。',
  '           没有打开角色卡时（比如群聊）只能看到这个池子。',
  '',
  '【批量加条目】',
  '  · 预设库：内置一批常用格式（对话双引号、心里话星号、Markdown 粗体/标题/链接等），',
  '            勾选后加进通用池，不勾不加。',
  '  · 批量导入 → 从世界书导入：扫描当前角色卡绑定的世界书条目，列出来给你勾，',
  '            勾过的会记住，下次不再重复列出。',
  '  · 批量导入 → 批量粘贴：一行一个名字，一次生成一批条目。',
  '',
  '【导入导出】',
  '设置里可以导出/导入条目（可分别导出通用池、本卡池或两者），',
  '导入时若标题重名，会让你逐个选择保留哪一份。',
  '',
  '【版本要求】',
  'SillyTavern 1.18.0 以上 / 酒馆助手 4.x 以上。低于要求会提示升级并停止。',
].join('\n');

const scriptJson = {
  type: 'script',
  enabled: true,
  name: `角色提词器 v${version}`,
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
const jsonPath = path.join(DIST, `角色提词器-v${version}.json`);
const jsPath = path.join(DIST, `角色提词器-v${version}.full.js`);

fs.writeFileSync(jsonPath, JSON.stringify(scriptJson, null, 2), 'utf8');
fs.writeFileSync(jsPath, source, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`已构建 v${version}`);
console.log(`  ${path.relative(ROOT, jsonPath)}  ${kb(fs.statSync(jsonPath).size)}`);
console.log(`  ${path.relative(ROOT, jsPath)}  ${kb(fs.statSync(jsPath).size)}`);
