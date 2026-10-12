/**
 * 纯函数单元测试。
 *
 * 用法：node test/test-parser.js
 *
 * 做法：从源码里切片出被标记的纯函数区段（__TEST_SLICE_START__ / __TEST_SLICE_END__），
 * 在一个隔离作用域里 eval 后逐项断言。这样不引入任何测试框架，也能保证核心逻辑正确。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', '角色提词器.js');
const source = fs.readFileSync(SRC, 'utf8');

const START = '/* __TEST_SLICE_START__ */';
const END = '/* __TEST_SLICE_END__ */';
const startIdx = source.indexOf(START);
const endIdx = source.indexOf(END);
if (startIdx < 0 || endIdx < 0) {
  console.error('切片标记缺失，无法测试');
  process.exit(1);
}
const slice = source.slice(startIdx + START.length, endIdx);

// 切片里用到的外部常量
const sandbox = { CURSOR_MARK: '|', console, crypto: require('crypto').webcrypto, Date, Math, String, Number, Array, Object, JSON, Set, Map, RegExp };
vm.createContext(sandbox);
vm.runInContext(`${slice}\n;globalThis.__fns = { compareVersion, parseContent, buildInjectedValue, defaultContent, newId, normalizeEntry, filterEntries, uniqueTitle, worldbookCandidates, esc, clamp, LIBRARY };`, sandbox);
const F = sandbox.__fns;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}\n    期望: ${e}\n    实际: ${a}`);
  }
}

/* ---------- compareVersion ---------- */
check('版本: 相等', F.compareVersion('1.18.0', '1.18.0'), 0);
check('版本: 大于', F.compareVersion('1.19.0', '1.18.0'), 1);
check('版本: 小于', F.compareVersion('1.17.9', '1.18.0'), -1);
check('版本: 位数不同', F.compareVersion('4.0', '4.0.0'), 0);
check('版本: 补零比较', F.compareVersion('4.0.1', '4.0'), 1);
check('版本: 大版本差', F.compareVersion('5.0.0', '4.11.3'), 1);
check('版本: 空值兜底', F.compareVersion(null, '1.0.0'), -1);

/* ---------- parseContent ---------- */
check('标记: 引号中间', F.parseContent('徐渭：“|”'), { text: '徐渭：“”', cursor: 4 });
check('标记: 开头', F.parseContent('|abc'), { text: 'abc', cursor: 0 });
check('标记: 末尾', F.parseContent('abc|'), { text: 'abc', cursor: 3 });
check('标记: 无标记则光标在末尾', F.parseContent('徐渭：“”'), { text: '徐渭：“”', cursor: 5 });
check('标记: 空字符串', F.parseContent(''), { text: '', cursor: 0 });
check('标记: 只取第一个', F.parseContent('a|b|c'), { text: 'ab|c', cursor: 1 });
check('标记: 转义竖线', F.parseContent('a\\|b'), { text: 'a|b', cursor: 3 });
check('标记: 转义后再标记', F.parseContent('a\\|b|c'), { text: 'a|bc', cursor: 3 });
check('标记: 多行模板', F.parseContent('徐渭：“|”\n（他抬起头）'), { text: '徐渭：“”\n（他抬起头）', cursor: 4 });
check('标记: null 输入', F.parseContent(null), { text: '', cursor: 0 });

/* ---------- buildInjectedValue ---------- */
check('追加: 空输入框', F.buildInjectedValue('', 0, 0, '徐渭：“”', 4, 'append'), { value: '徐渭：“”', cursor: 4 });
check('追加: 非空输入框换行', F.buildInjectedValue('沈砚：“”', 5, 5, '徐渭：“”', 4, 'append'), { value: '沈砚：“”\n徐渭：“”', cursor: 10 });
check('追加: 清理末尾空白', F.buildInjectedValue('沈砚：“”   \n', 10, 10, '徐渭：“”', 4, 'append'), { value: '沈砚：“”\n徐渭：“”', cursor: 10 });
check('追加: 只有空白视为空', F.buildInjectedValue('   ', 3, 3, '徐渭：“”', 4, 'append'), { value: '徐渭：“”', cursor: 4 });
check('替换: 覆盖全部', F.buildInjectedValue('旧内容很长', 3, 5, '新', 1, 'replace'), { value: '新', cursor: 1 });
check('插入: 光标处', F.buildInjectedValue('前后', 1, 1, '中间', 2, 'cursor'), { value: '前中间后', cursor: 3 });
check('插入: 替换选区', F.buildInjectedValue('前XX后', 1, 3, '中间', 2, 'cursor'), { value: '前中间后', cursor: 3 });
check('插入: 选区越界兜底', F.buildInjectedValue('abc', 99, 99, 'X', 1, 'cursor'), { value: 'abcX', cursor: 4 });
check('默认模式为追加', F.buildInjectedValue('a', 1, 1, 'b', 1, undefined), { value: 'a\nb', cursor: 3 });
check('光标越界兜底', F.buildInjectedValue('', 0, 0, 'ab', 99, 'replace'), { value: 'ab', cursor: 2 });

/* ---------- 追加模式的分隔符 ---------- */
check('分隔符: 换行（默认）', F.buildInjectedValue('a', 1, 1, 'b', 1, 'append', '\n'), { value: 'a\nb', cursor: 3 });
check('分隔符: 不传参数默认换行', F.buildInjectedValue('a', 1, 1, 'b', 1, 'append'), { value: 'a\nb', cursor: 3 });
check('分隔符: 空格', F.buildInjectedValue('a', 1, 1, 'b', 1, 'append', ' '), { value: 'a b', cursor: 3 });
check('分隔符: 不分隔', F.buildInjectedValue('a', 1, 1, 'b', 1, 'append', ''), { value: 'ab', cursor: 2 });
check('分隔符: 空输入框时不加分隔符', F.buildInjectedValue('', 0, 0, 'b', 1, 'append', '\n'), { value: 'b', cursor: 1 });
check('分隔符: 只有空白时不加', F.buildInjectedValue('   ', 3, 3, 'b', 1, 'append', '\n'), { value: 'b', cursor: 1 });
check('分隔符: 不影响替换模式', F.buildInjectedValue('a', 0, 1, 'b', 1, 'replace', '\n'), { value: 'b', cursor: 1 });
check('分隔符: 不影响插入模式', F.buildInjectedValue('ab', 1, 1, 'X', 1, 'cursor', '\n'), { value: 'aXb', cursor: 2 });

/* ---------- 预设库数据自检 ---------- */
{
  check('预设库: 非空', F.LIBRARY.length > 0, true);
  const titles = F.LIBRARY.map((i) => i.title);
  check('预设库: 标题不重复', new Set(titles).size, titles.length);
  const badParse = F.LIBRARY.filter((i) => {
    const p = F.parseContent(i.content);
    // 解析后必须还有内容，且光标落在合法范围内
    return !p.text || p.cursor < 0 || p.cursor > p.text.length;
  });
  check('预设库: 每条都能正确解析', badParse.map((i) => i.title), []);
  const noMark = F.LIBRARY.filter((i) => F.parseContent(i.content).cursor === F.parseContent(i.content).text.length && !i.content.includes('|'));
  check('预设库: 都带光标标记', noMark.map((i) => i.title), []);
  check('预设库: 每条都有分组和描述', F.LIBRARY.filter((i) => !i.group || !i.desc).length, 0);
  check('预设库: 对话格式正确', F.parseContent(F.LIBRARY.find((i) => i.title === '对话').content).text, '“”');
  check('预设库: 心里话格式正确', F.parseContent(F.LIBRARY.find((i) => i.title === '心里话').content).text, '**');
  check('预设库: 代码块可解析', F.parseContent(F.LIBRARY.find((i) => i.title === '代码块').content).text, '```\n\n```');
}

/* ---------- defaultContent ---------- */
check('默认内容', F.defaultContent('徐渭'), '徐渭：“|”');
check('默认内容: 空标题', F.defaultContent(''), '：“|”');
check('默认内容: 标题含竖线要转义', F.defaultContent('A|B'), 'A\\|B：“|”');
check('默认内容: 转义后解析正确', F.parseContent(F.defaultContent('A|B')).text, 'A|B：“”');

/* ---------- normalizeEntry ---------- */
const norm = F.normalizeEntry({ title: '徐渭' });
check('规整: 补全字段', [norm.title, norm.desc, norm.content, norm.useCount], ['徐渭', '', '', 0]);
check('规整: 生成 id', typeof norm.id === 'string' && norm.id.length > 0, true);
check('规整: null 输入不崩', typeof F.normalizeEntry(null).id, 'string');
check('规整: 保留已有 id', F.normalizeEntry({ id: 'keep-me', title: 'a' }).id, 'keep-me');
check('规整: 数字字段兜底', F.normalizeEntry({ useCount: 'x' }).useCount, 0);

/* ---------- filterEntries ---------- */
const entries = [
  { title: '徐渭', desc: '冷漠剑客' },
  { title: '沈砚', desc: '话痨书生' },
  { title: '柳娘', desc: '客栈老板娘' },
];
check('搜索: 空关键词返回全部', F.filterEntries(entries, '').length, 3);
check('搜索: 匹配标题', F.filterEntries(entries, '徐').map((e) => e.title), ['徐渭']);
check('搜索: 匹配描述', F.filterEntries(entries, '书生').map((e) => e.title), ['沈砚']);
check('搜索: 忽略大小写', F.filterEntries([{ title: 'Alice', desc: '' }], 'alice').length, 1);
check('搜索: 无匹配', F.filterEntries(entries, '不存在').length, 0);
check('搜索: 不修改原数组', (() => { F.filterEntries(entries, ''); return entries.length; })(), 3);

/* ---------- uniqueTitle ---------- */
check('去重: 无冲突', F.uniqueTitle('徐渭', ['沈砚']), '徐渭');
check('去重: 一次冲突', F.uniqueTitle('徐渭', ['徐渭']), '徐渭 2');
check('去重: 多次冲突', F.uniqueTitle('徐渭', ['徐渭', '徐渭 2', '徐渭 3']), '徐渭 4');
check('去重: 空标题兜底', F.uniqueTitle('', []), '未命名');
check('去重: 空标题冲突', F.uniqueTitle('  ', ['未命名']), '未命名 2');

/* ---------- worldbookCandidates ---------- */
const wbEntries = [
  { name: '徐渭', content: '冷漠剑客，佩剑「霜白」。', enabled: true },
  { name: '沈砚', content: '话痨书生。', enabled: true },
  { name: '', content: '没有名字的条目' },
  { name: '柳娘', content: '客栈老板娘。', enabled: false },
];
check('世界书: 跳过无名条目', F.worldbookCandidates(wbEntries, [], '').length, 3);
check('世界书: 跳过已导入', F.worldbookCandidates(wbEntries, ['徐渭'], '').map((c) => c.name).sort(), ['沈砚', '柳娘'].sort());
check('世界书: 关键词匹配名字', F.worldbookCandidates(wbEntries, [], '沈').map((c) => c.name), ['沈砚']);
check('世界书: 关键词匹配内容', F.worldbookCandidates(wbEntries, [], '佩剑').map((c) => c.name), ['徐渭']);
check('世界书: 摘要截断', F.worldbookCandidates([{ name: 'x', content: 'a'.repeat(200) }], [], '')[0].preview.length, 60);
check('世界书: 摘要压缩空白', F.worldbookCandidates([{ name: 'x', content: 'a\n\n  b' }], [], '')[0].preview, 'a b');
check('世界书: 保留禁用标记', F.worldbookCandidates(wbEntries, [], '').find((c) => c.name === '柳娘').enabled, false);
check('世界书: 中文排序', F.worldbookCandidates(wbEntries, [], '').map((c) => c.name).length, 3);
check('世界书: 空输入', F.worldbookCandidates(null, null, null).length, 0);

/* ---------- esc ---------- */
check('转义: 尖括号', F.esc('<script>'), '&lt;script&gt;');
check('转义: 引号', F.esc('a"b\'c'), 'a&quot;b&#39;c');
check('转义: &', F.esc('a&b'), 'a&amp;b');
check('转义: null', F.esc(null), '');

/* ---------- clamp ---------- */
check('夹取: 正常', F.clamp(5, 0, 10), 5);
check('夹取: 下界', F.clamp(-5, 0, 10), 0);
check('夹取: 上界', F.clamp(50, 0, 10), 10);
check('夹取: NaN 兜底', F.clamp('x', 3, 10), 3);

/* ---------- 汇总 ---------- */
console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('\n失败详情：');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('全部通过 ✓');
