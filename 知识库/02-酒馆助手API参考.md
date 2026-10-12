# 02 酒馆助手 API 参考

所有接口挂在 `window.TavernHelper` 上；**同时函数本身也直接暴露为全局函数**，所以脚本里可以直接写 `getChatMessages(...)`、`triggerSlash(...)`，不必加 `TavernHelper.` 前缀。

类型定义来源：`整理后的SillyTavern资料/模板与示例/tavern_helper_template-main/@types/`，以及 `插件开发/酒馆助手插件开发资料/接口定义/`。

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

## 十、类型定义原文在哪

需要精确签名时直接查这些文件（本地已有一份完整拷贝）：

- `整理后的SillyTavern资料/模板与示例/tavern_helper_template-main/@types/function/`（22 个 `.d.ts`，对应 `window.TavernHelper` 成员）
- `整理后的SillyTavern资料/模板与示例/tavern_helper_template-main/@types/iframe/`（`event.d.ts`、`script.d.ts`、`util.d.ts`、`variables.d.ts` 等，只能在脚本/前端界面内用）
- `整理后的SillyTavern资料/插件开发/酒馆助手插件开发资料/接口定义/`（同内容的另一份拷贝）
