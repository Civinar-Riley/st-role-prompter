# 02 酒馆助手 API 参考

所有接口挂在 `window.TavernHelper` 上；**同时函数本身也直接暴露为全局函数**，所以脚本里可以直接写 `getChatMessages(...)`、`triggerSlash(...)`，不必加 `TavernHelper.` 前缀。

类型定义来源：`整理后的SillyTavern资料/模板与示例/tavern_helper_template-main/@types/`，以及 `插件开发/酒馆助手插件开发资料/接口定义/`。

> 这些 `.d.ts` 源自 [JS-Slash-Runner](https://github.com/N0VI028/JS-Slash-Runner) 项目。
> 本文引用的是**接口签名**（函数名、参数、返回值），属于 API 事实性描述，用于编写兼容代码。
> 需要完整定义请到上游仓库取。

---

## 一、脚本内专有函数（🚫 只能在脚本 iframe 里用）

### 脚本按钮

```ts
type ScriptButton = { name: string; visible: boolean };

/** 为按钮列表末尾添加不存在的按钮，不会重复添加同名按钮 */
declare function appendInexistentScriptButtons(buttons: ScriptButton[]): void;

/** 完全替换当前脚本的按钮列表 */
declare function replaceScriptButtons(buttons: ScriptButton[]): void;

/** 用 updater 更新按钮列表 */
declare function updateScriptButtonsWith(updater: (buttons: ScriptButton[]) => ScriptButton[]): ScriptButton[];
declare function updateScriptButtonsWith(updater: (buttons: ScriptButton[]) => Promise<ScriptButton[]>): Promise<ScriptButton[]>;

/** 获取当前脚本的按钮列表 */
declare function getScriptButtons(): ScriptButton[];

/** 获取按钮对应的事件类型 */
declare function getButtonEvent(button_name: string): string;

/** 获取脚本名称 / 作者注释 */
declare function getScriptName(): string;
declare function getScriptInfo(): string;
declare function replaceScriptInfo(info: string): void;
```

标准用法（**本项目入口就用这个**）：

```javascript
appendInexistentScriptButtons([{ name: '角色名注入', visible: true }]);

eventOn(getButtonEvent('角色名注入'), () => {
  togglePanel();
});
```

注意：按钮名必须与 `getButtonEvent()` 里的字符串**完全一致**。

### 环境与标识

```ts
/** 获取脚本库 id（只能在脚本内使用，否则 throw） */
declare function getScriptId(): string;

/** 获取 iframe 标识名：脚本为 `TH-script--脚本名--脚本id` */
declare function getIframeName(): string;

/** 重新加载脚本（等价 window.location.reload()） */
declare function reloadIframe(): void;
```

### 工具函数

```ts
/** 替换字符串里的酒馆宏，如 {{char}} {{user}} {{lastMessageId}} */
declare function substitudeMacros(text: string): string;

/** 最新楼层 id */
declare function getLastMessageId(): number;

/** 包装函数，让报错通过酒馆通知显示 */
declare function errorCatched<T extends any[], U>(fn: (...args: T) => U): (...args: T) => U;
```

---

## 二、事件系统

```ts
type EventOnReturn = { stop: () => void };
type EventType = IframeEventType | TavernEventType | string;   // string = 自定义事件

declare function eventOn<T extends EventType>(event_type: T, listener: ListenerType[T]): EventOnReturn;
declare function eventOnce<T extends EventType>(event_type: T, listener: ListenerType[T]): EventOnReturn;
declare function eventMakeFirst<T extends EventType>(event_type: T, listener: ListenerType[T]): EventOnReturn;
declare function eventMakeLast<T extends EventType>(event_type: T, listener: ListenerType[T]): EventOnReturn;
declare function eventEmit<T extends EventType>(event_type: T, ...data: Parameters<ListenerType[T]>): Promise<void>;
declare function eventEmitAndWait<T extends EventType>(event_type: T, ...data: Parameters<ListenerType[T]>): void;
declare function eventRemoveListener<T extends EventType>(event_type: T, listener: ListenerType[T]): void;
declare function eventClearEvent(event_type: EventType): void;
declare function eventClearListener(listener: Function): void;
declare function eventClearAll(): void;
```

**脚本关闭时，`eventOn` 注册的监听会自动卸载。**

### iframe_events（6 个）

| 常量 | 字符串值 | 含义 |
| --- | --- | --- |
| `iframe_events.MESSAGE_IFRAME_RENDER_STARTED` | `message_iframe_render_started` | 楼层界面开始渲染 |
| `iframe_events.MESSAGE_IFRAME_RENDER_ENDED` | `message_iframe_render_ended` | 楼层界面渲染结束 |
| `iframe_events.GENERATION_STARTED` | `js_generation_started` | `generate()` 开始 |
| `iframe_events.STREAM_TOKEN_RECEIVED_FULLY` | `js_stream_token_received_fully` | 流式完整文本 |
| `iframe_events.STREAM_TOKEN_RECEIVED_INCREMENTALLY` | `js_stream_token_received_incrementally` | 流式增量 |
| `iframe_events.GENERATION_ENDED` | `js_generation_ended` | `generate()` 结束 |

### tavern_events（常用节选，共 70+ 个）

| 常量 | 值 | 回调签名 / 含义 |
| --- | --- | --- |
| `tavern_events.APP_READY` | `app_ready` | 酒馆加载完成 |
| `tavern_events.CHAT_CHANGED` | `chat_id_changed` | `(chat_file_name) => void` 切换聊天文件 |
| `tavern_events.MESSAGE_SENT` | `message_sent` | `(message_id) => void` 用户发出消息 |
| `tavern_events.MESSAGE_RECEIVED` | `message_received` | `(message_id, type) => void` 收到 AI 消息 |
| `tavern_events.MESSAGE_UPDATED` | `message_updated` | `(message_id) => void` 消息被修改 |
| `tavern_events.MESSAGE_EDITED` | `message_edited` | 消息被编辑 |
| `tavern_events.MESSAGE_DELETED` | `message_deleted` | 消息被删除 |
| `tavern_events.MESSAGE_SWIPED` | `message_swiped` | 滑动切换 swipe |
| `tavern_events.USER_MESSAGE_RENDERED` | `user_message_rendered` | 用户楼层渲染完成 |
| `tavern_events.CHARACTER_MESSAGE_RENDERED` | `character_message_rendered` | 角色楼层渲染完成 |
| `tavern_events.GENERATION_STARTED` | `generation_started` | 开始生成 |
| `tavern_events.GENERATION_ENDED` | `generation_ended` | 生成结束 |
| `tavern_events.GENERATION_STOPPED` | `generation_stopped` | 生成被停止 |
| `tavern_events.STREAM_TOKEN_RECEIVED` | `stream_token_received` | 收到流式 token |
| `tavern_events.SETTINGS_LOADED` | `settings_loaded` | 设置加载完成 |
| `tavern_events.WORLDINFO_UPDATED` | `worldinfo_updated` | 世界书更新 |
| `tavern_events.WORLD_INFO_ACTIVATED` | `world_info_activated` | 世界书条目被激活 |
| `tavern_events.PRESET_CHANGED` | `preset_changed` | 预设切换 |
| `tavern_events.CHAT_CREATED` / `CHAT_DELETED` | — | 聊天创建 / 删除 |

自定义事件：任意字符串都可作为事件名，配合 `eventEmit('我的事件', 数据)` 与 `eventOn('我的事件', cb)` 使用。

---

## 三、变量系统

```ts
type VariableOption =
  | { type: 'chat' | 'preset' | 'global' }
  | { type: 'character' }                                          // 未打开角色卡会 throw
  | { type: 'message'; message_id?: number | 'latest' }             // 负数 = 深度索引
  | { type: 'script'; script_id?: string }                          // 脚本内可省略 script_id
  | { type: 'extension'; extension_id: string };

declare function getVariables(option: VariableOption): Record<string, any>;
declare function replaceVariables(variables: Record<string, any>, option: VariableOption): void;
declare function updateVariablesWith(
  updater: (variables: Record<string, any>) => Record<string, any>,
  option: VariableOption,
): Record<string, any>;
declare function insertOrAssignVariables(variables: Record<string, any>, option: VariableOption): Record<string, any>;
declare function insertVariables(variables: Record<string, any>, option: VariableOption): Record<string, any>;
declare function deleteVariable(variable_path: string, option: VariableOption):
  { variables: Record<string, any>; delete_occurred: boolean };
declare function registerVariableSchema(schema: z.ZodType<any>, option: { type: 'global' | 'preset' | 'character' | 'chat' | 'message' }): void;
```

另有一个合并视图（脚本/界面内可用）：

```ts
/** 合并 全局→角色卡→脚本→聊天→楼层 后的变量表 */
declare function getAllVariables(): Record<string, any>;
```

内置 lodash（全局 `_`），可以这样用：

```javascript
const variables = getVariables({ type: 'global' });
if (_.has(variables, '徐渭.好感度')) { /* ... */ }

updateVariablesWith(v => _.set(v, '徐渭.好感度', 10), { type: 'global' });
```

细节与选型见 [04-数据持久化.md](04-数据持久化.md)。

---

## 四、聊天消息（楼层）

```ts
type ChatMessage = {
  message_id: number;
  name: string;
  role: 'system' | 'assistant' | 'user';
  is_hidden: boolean;
  message: string;
  data: Record<string, any>;
  extra: Record<string, any>;
};

/** range 可以是楼层号、负数（深度）、或字符串范围如 '0-{{lastMessageId}}' */
declare function getChatMessages(range: string | number, option?: {
  role?: 'all' | 'system' | 'assistant' | 'user';
  hide_state?: 'all' | 'hidden' | 'unhidden';
  include_swipes?: boolean;
}): ChatMessage[];

declare function setChatMessages(
  chat_messages: Array<{ message_id: number } & Partial<ChatMessage>>,
  option?: { refresh?: 'none' | 'affected' | 'all' },
): Promise<void>;

declare function createChatMessages(
  chat_messages: Array<{ name?: string; role: 'system' | 'assistant' | 'user'; is_hidden?: boolean; message: string; data?: any }>,
  option?: { insert_before?: number; refresh?: 'none' | 'affected' | 'all' },
): Promise<void>;

declare function deleteChatMessages(message_ids: number[], option?: { refresh?: 'none' | 'affected' | 'all' }): Promise<void>;

declare function rotateChatMessages(begin: number, middle: number, end: number, option?: { refresh?: ... }): Promise<void>;
```

**没有 `'0-end'` 这种写法**，范围要写 `'0-{{lastMessageId}}'`。取最新一条用 `getChatMessages(-1)`。

---

## 五、AI 生成

```ts
declare function generate(config: GenerateConfig): Promise<string>;
declare function generateRaw(config: GenerateRawConfig): Promise<string>;
declare function getModelList(custom_api?: { apiurl: string; key?: string }): Promise<string[]>;
declare function stopGenerationById(generation_id: string): boolean;
declare function stopAllGeneration(): boolean;
```

`generate` 走酒馆当前预设，`generateRaw` 用自定义的 `ordered_prompts` 不套预设。

关键字段：

```ts
type GenerateConfig = {
  generation_id?: string;
  user_input?: string;
  should_stream?: boolean;        // 默认 false
  should_silence?: boolean;       // true 时不占用酒馆的停止按钮
  overrides?: Overrides;          // 覆盖 char_description / chat_history 等
  injects?: Omit<InjectionPrompt, 'id'>[];
  max_chat_history?: 'all' | number;
  custom_api?: { apiurl?: string; key?: string; model?: string; source?: string; temperature?: number; max_tokens?: number; ... };
};

type GenerateRawConfig = GenerateConfig & {
  ordered_prompts?: (BuiltinPrompt | RolePrompt)[];
};
```

实战写法：

```javascript
const result = await generateRaw({
  ordered_prompts: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ],
});

// 走酒馆预设，额外注入一条系统提示
const result2 = await generate({
  user_input: '你好',
  should_silence: true,
  injects: [{ role: 'system', content: '额外指令', position: 'in_chat', depth: 0, should_scan: false }],
});
```

---

## 六、提示词注入

```ts
type InjectionPrompt = {
  id: string;
  position: 'in_chat' | 'none';   // 'none' 不发给 AI，但可激活世界书
  depth: number;
  role: 'system' | 'assistant' | 'user';
  content: string;
  filter?: (() => boolean) | (() => Promise<boolean>);
  should_scan?: boolean;
};

declare function injectPrompts(prompts: InjectionPrompt[], options?: { once?: boolean }): { uninject: () => void };
declare function uninjectPrompts(ids: string[]): void;
```

注入的提示词**只在当前聊天文件有效**；跨聊天要监听 `tavern_events.CHAT_CHANGED` 重新注入，或监听 `tavern_events.GENERATION_AFTER_COMMANDS` 在生成前注入。

---

## 七、角色卡 / 用户人设

```ts
// 角色卡
declare function getCharacterNames(): string[];
declare function getCurrentCharacterName(): string | null;
declare function getCharacter(character_name: string | 'current'): RawCharacter;
declare function createCharacter(...): Promise<void>;
declare function replaceCharacter(...): Promise<void>;
declare function updateCharacterWith(...): Promise<void>;
declare function deleteCharacter(...): Promise<void>;
declare function getCharData(character_name?: string | 'current'): Promise<v2CharData>;
declare function getCharAvatarPath(character_name?: string | 'current'): Promise<string>;

// 用户人设
declare function getPersonaNames(): string[];
declare function getCurrentPersonaName(): string | null;
declare function getPersona(persona_name: string | 'current'): Persona;
```

`RawCharacter` 上可读到 `first_messages`（开场白数组）等字段。

---

## 八、世界书

```ts
declare function getWorldbookNames(): string[];
declare function getGlobalWorldbookNames(): string[];
declare function rebindGlobalWorldbooks(names: string[]): Promise<void>;
declare function getCharWorldbookNames(character_name: string | 'current'): Promise<{ primary: string | null; additional: string[] }>;
declare function rebindCharWorldbooks(character_name: string | 'current', worldbook_names: { primary: string | null; additional: string[] }): Promise<void>;
declare function getChatWorldbookName(chat_name: string | 'current'): Promise<string | null>;
declare function rebindChatWorldbook(chat_name: string | 'current', worldbook_name: string): Promise<void>;
declare function getOrCreateChatWorldbook(chat_name: string | 'current'): Promise<string>;
declare function createWorldbook(worldbook_name: string, entries?: WorldbookEntry[]): Promise<void>;
declare function createOrReplaceWorldbook(worldbook_name: string, entries?: WorldbookEntry[]): Promise<void>;
declare function deleteWorldbook(worldbook_name: string): Promise<void>;
declare function getWorldbook(worldbook_name: string): Promise<WorldbookEntry[]>;
declare function replaceWorldbook(worldbook_name: string, entries: WorldbookEntry[]): Promise<void>;
declare function updateWorldbookWith(worldbook_name: string, updater: (entries: WorldbookEntry[]) => WorldbookEntry[]): Promise<WorldbookEntry[]>;
declare function createWorldbookEntries(worldbook_name: string, entries: Partial<WorldbookEntry>[]): Promise<{ worldbook: WorldbookEntry[]; new_entries: WorldbookEntry[] }>;
declare function deleteWorldbookEntries(worldbook_name: string, predicate: (entry: WorldbookEntry) => boolean): Promise<WorldbookEntry[]>;
```

`WorldbookEntry` 关键字段：

```ts
{
  uid, name, enabled, content, use_regex,
  strategy: { type: 'constant' | 'selective' | 'vectorized', keys: string[], keys_secondary: { logic, keys }, scan_depth },
  position: { type: 'before_character_definition' | 'after_character_definition' | ... | 'at_depth' | 'outlet', role, depth, order },
  recursion: { prevent_incoming, prevent_outgoing, delay_until },
  effect: { sticky, cooldown, delay },
}
```

**旧版 `lorebook` / `lorebook_entry` 系列已全部 `@deprecated`，不要用。**

---

## 九、其他

### builtin

```ts
builtin.addOneMessage(message, options?)   // 往页面插一条渲染的消息
builtin.copyText(text)                     // 复制到剪贴板
builtin.uuidv4()                           // UUID
builtin.renderMarkdown(text)               // Markdown 转 HTML
builtin.duringGenerating()                 // 是否正在生成
builtin.saveSettings()                     // 保存酒馆设置
builtin.promptManager.messages             // 提示词集合
builtin.promptManager.getPromptCollection()
```

### 显示层

```ts
declare function retrieveDisplayedMessage(message_id: number): JQuery;
declare function formatAsDisplayedMessage(text: string, option?: { message_id?: number | 'last' }): string;
declare function refreshOneMessage(message_id: number, $mes?: JQuery): void;
```

### 宏注册

```ts
declare function registerMacroLike(regex: RegExp, replacer: (context: any, substring: string, ...args: any[]) => string): { unregister: () => void };
```

### 跨脚本共享接口

```ts
declare function initializeGlobal(global: string, value: any): void;   // 发布
await waitGlobalInitialized('Mvu');                                    // 等待
```

### Slash 命令

```ts
/** 执行 slash 命令。命令写错不会有反馈；命令出错会 throw */
declare function triggerSlash(command: string): Promise<string>;
```

### 版本

```ts
declare function getTavernHelperVersion(): string;
declare function getTavernHelperExtensionId(): string;
declare function getTavernVersion(): string;
```

### 脚本树管理（跨脚本操作，非脚本内也可用）

```ts
type ScriptTreesOptions = { type: 'global' | 'preset' | 'character' };
declare function getScriptTrees(option: ScriptTreesOptions): ScriptTree[];
declare function replaceScriptTrees(script_trees: PartialDeep<ScriptTree>[], option: ScriptTreesOptions): void;
declare function updateScriptTreesWith(updater, option): ScriptTree[];
declare function getAllEnabledScriptButtons(): { [script_id: string]: { button_id: string; button_name: string }[] };
```

---

## 十、版本要求与 API 引入版本

> 本地资料的更新日志停在 **4.6.3**（2025 年 9 月整理），核实日期 2026-10-12 时酒馆助手最新为 **4.11.3**。查最新变更请到官方文档站或 GitHub。

### 酒馆助手自身的版本要求

`manifest.json`（核实于 4.11.3）：

```json
{
  "display_name": "酒馆助手",
  "version": "4.11.3",
  "minimum_client_version": "1.13.0"
}
```

即酒馆助手的硬性下限是 **SillyTavern 1.13.0**。

### 本项目依赖的 API 是哪个版本引入的

| API | 引入版本 | 变更日志原文 |
| --- | --- | --- |
| `getVariables({type:'character'})`（角色卡变量） | **3.0.2** | "getVariables 等变量操作现在支持获取和修改绑定在角色卡的变量" |
| `appendInexistentScriptButtons` | **3.4.0** | "新增 appendInexistentScriptButtons 函数, 便于为已经有按钮的脚本新增脚本按钮" |
| `getButtonEvent` | **3.4.8** | "新增 getButtonEvent 来获取脚本按钮对应的事件"；同时弃用 `eventOnButton` |
| `getWorldbook` | 早于 3.4.0（3.4.0 改为按自定义顺序返回） | — |

**结论**：本项目实际需要的酒馆助手版本门槛很低（3.4.8 即可），但项目定为 **4.x 以上**，理由是 4.x 的接口与 `@types` 类型定义一致、且当前最新已是 4.11.3。

### 输入框相关 API：确认不存在

核实了官方文档站的"其他工具函数"页与 4.11.3 的变更日志：**没有任何输入框操作 API**（不能设置输入框文本，也不能设置光标位置）。变更日志里与输入框有关的条目只有 UI 修复类，例如：

- 3.4.19："修复在手机点击脚本按钮会收起输入法的问题"
- 4.4.3："从输入框左下角魔棒移除了开关前端渲染快捷按钮"

**所以注入输入框必须走 DOM 方案**（见 [03-输入框注入方案.md](03-输入框注入方案.md)）。

---

## 十一、类型定义原文在哪

需要精确签名时直接查这些文件（本地已有一份完整拷贝）：

- `整理后的SillyTavern资料/模板与示例/tavern_helper_template-main/@types/function/`（22 个 `.d.ts`，对应 `window.TavernHelper` 成员）
- `整理后的SillyTavern资料/模板与示例/tavern_helper_template-main/@types/iframe/`（`event.d.ts`、`script.d.ts`、`util.d.ts`、`variables.d.ts` 等，只能在脚本/前端界面内用）
- `整理后的SillyTavern资料/插件开发/酒馆助手插件开发资料/接口定义/`（同内容的另一份拷贝）
