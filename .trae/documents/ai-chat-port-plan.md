# AI 对话移植方案

## Context

ai-flows 平台目前只有「评审链 + 节点 skill 执行」能力（`src/skill.ts`、`src/reviewer.ts`），缺少通用的多轮 AI 对话能力。用户希望参考 `d:\code\private\ai-chat` 项目的「记忆管理 + 模型切换」机制，在 ai-flows 平台新增独立的「AI 对话」页（与 AI 管线页平行，不挂节点状态机），复用 ai-flows 现有视觉风格。

**约束**：零运行时依赖（不引 OpenAI SDK / express）、JSON 文件存储（不引数据库）、ESM 相对导入必带 `.js`、凭据只从环境变量读（`apiKeyEnv` 字段不存明文 key）、HTML 插值一律转义、手写 `node:http` 路由。

---

## 总体策略

- **不复用** `src/reviewer.ts` 的 `callModel()`（它强制 `response_format: json_object` 且无 stream，签名不兼容），新建 `callModelStream()`，仅共用 `resolveApiKey()` 与 `ModelConfig` 类型。
- **复用** `src/db.ts` 的 tickets 读写模式：`db/chats.json` 存会话+消息，`db/models.json` 存模型配置 + `activeId`。
- **复用** `src/platform.ts` 的路由 + bootstrap 注入模式：`/chat` 页 + `/api/chat/*` API + STATIC_FILES 白名单 + `window.__CHAT__` 注入。
- **复用** `web/ai-pipeline.css` 视觉变量（`--paper/--ink/--led/--radius-pill` 等），chat 页顶栏与 `ai-pipeline.html` 完全同构。
- **会话私有**：按 `ownerEmail` 过滤，不进部门权限体系；模型切换全员可用（简化权限）。

---

## 新增文件

### 1. `src/chat.ts` — 对话核心模块

```ts
export interface ChatMessage { id: string; role: "user" | "assistant"; content: string; at: string; modelId?: string; tokens?: number; }
export interface ChatSession { id: string; ownerEmail: string; title: string; createdAt: string; updatedAt: string; messages: ChatMessage[]; }

/** 6 个 provider 默认 endpoint 映射（移植自 ai-chat） */
export const PROVIDER_DEFAULT_ENDPOINTS: Record<string, string>;

/** 流式调用 OpenAI 兼容接口。零依赖手写 fetch + ReadableStream 解析 SSE chunks。 */
export async function* callModelStream(
  model: ModelConfig,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal }
): AsyncGenerator<{ type: "delta" | "usage" | "done"; delta?: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }>;

/** 拼装 [system, ...history.slice(-50), user]，过滤空 content。纯函数。 */
export function buildChatMessages(system: string, history: ChatMessage[], userContent: string): { role: "system" | "user" | "assistant"; content: string }[];

/** 会话标题：首条 user 消息前 30 字截断 + 省略号。纯函数。 */
export function truncateTitle(text: string, n?: number): string;

/** HTML 转义（与 reporter.head.ts:esc 同实现，独立导出避免循环导入）。 */
export function esc(text: unknown): string;
```

**SSE 解析关键点**：用 `res.body.getReader()` + `TextDecoder` 按行扫描，维护 `pending: string` 缓冲按 `\n\n` 切事件块，每行去 `data: ` 前缀后 `JSON.parse`，遇 `data: [DONE]` 收尾。

### 2. `web/chat.html` — 对话页

顶栏与 `ai-pipeline.html` 同构（`.brand` + `.top-right` nav-link × 6，新增 `<a class="nav-link active" href="/chat">AI 对话</a>`，其他页 active 去掉）。主区：

- 左侧 `<aside class="chat-sidebar">`（复用 `pipeline-sidebar` 样式）：会话列表 + 「+ 新建会话」按钮 + 底部模型下拉 `<select id="modelSelect">`。
- 右侧 `<main class="chat-main">`：消息流 `<div class="messages">`（user 右对齐、assistant 左对齐）+ 底部输入区（textarea + 发送按钮 + 中止按钮）。

### 3. `web/chat.js` — 前端逻辑

- 从 `window.__CHAT__` 读 `user/models/activeModelId`。
- SSE 接收用 **`fetch(POST, body)` + `ReadableStream`**（不能用 EventSource，因为 EventSource 不支持 POST + 自定义 cookie 头）。
- 事件序列：`thinking`（loading 占位）→ `delta`×N（追加 DOM，文本走 `esc()`）→ `usage` → `message_end`。
- 中止按钮：本地 `AbortController.abort()` 触发 fetch 中断。
- 模型下拉切换调 `POST /api/chat/models/<id>/activate`。

### 4. `src/chat.test.ts` — 纯函数测试（`node:test`）

覆盖：`buildChatMessages`（最近 50 条截断、system 注入、空 content 过滤）、`truncateTitle`、`esc()`（`<>&"'` 转义）、`PROVIDER_DEFAULT_ENDPOINTS` 命中。

---

## 修改文件

### 1. `src/db.ts` — 追加 chat 接口（参考 tickets 模式 L333-369）

```ts
export interface ChatModel {
  id: string;
  name: string;
  provider: string;       // deepseek/google/aliyun/...
  model: string;          // deepseek-chat / gpt-4o-mini / ...
  baseUrl: string;        // 缺省从 PROVIDER_DEFAULT_ENDPOINTS 回退
  apiKeyEnv: string;      // 红线：只存环境变量名，不存明文 key
  isActive?: boolean;
  category?: string;      // text / vision / ...
}

export function loadChats(): { sessions: ChatSession[] };
export function saveChats(data: { sessions: ChatSession[] }): void;
export function appendChat(session: ChatSession): void;
export function updateChat(id: string, mutate: (s: ChatSession) => void): ChatSession | null;
export function deleteChat(id: string): boolean;

export function loadChatModels(): { activeId: string; models: ChatModel[] };   // 文件不存在返回种子：DeepSeek 默认
export function saveChatModels(data: { activeId: string; models: ChatModel[] }): void;
export function appendChatModel(m: ChatModel): ChatModel;
export function updateChatModel(id: string, mutate: (m: ChatModel) => void): ChatModel | null;
export function deleteChatModel(id: string): boolean;
export function setActiveModel(id: string): ChatModel | null;
```

**种子模型**（仅文件不存在时首次落盘）：`{ id: "ds-default", name: "DeepSeek Chat", provider: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY", isActive: true, category: "text" }`。用户配 `DEEPSEEK_API_KEY` 即开箱即用。

### 2. `src/platform.ts` — 5 处改动

**(1) `STATIC_FILES`（L280-290）追加**：`"/chat.js": { file: "chat.js", type: "text/javascript; charset=utf-8" }`。

**(2) 新增 `chatHtml(user)`**（参考 `ticketsHtml` L365-374）：
```ts
function chatHtml(user: UserAccount): string {
  const raw = readFileSync(join(WEB_DIR, "chat.html"), "utf8");
  const { activeId, models } = loadChatModels();
  const boot = { user: toUserView(user), models, activeModelId: activeId };
  const inject = `<script>window.__CHAT__ = ${jsonForScript(boot)};</script>\n<script src="/chat.js" defer></script>`;
  return raw.replace("</body>", `${inject}\n</body>`);
}
```

**(3) 路由块**（参考 L1492-1570 模式，集中追加在 `/api/tickets/*` 路由块附近）：
- `GET /chat` → 未登录 302 `/login`，否则 `res.end(chatHtml(user))`。
- `GET /api/chat/sessions` → 按 `ownerEmail === user.email` 过滤（**不按部门，私有**），按 `updatedAt` 倒序，只返 `{id,title,updatedAt,messageCount}` 列表项（不含 messages 全量）。
- `POST /api/chat/sessions` → body `{title?}`，新建空会话返回完整对象。
- `GET /api/chat/sessions/<id>`（`[^/\\]+` 限定）→ 校验 `ownerEmail` 后返完整 messages。
- `DELETE /api/chat/sessions/<id>` → 校验 `ownerEmail` 后删，返 200。
- `POST /api/chat/sessions/<id>/messages`（**SSE 流式入口**）：
  1. `currentUser` 鉴权 + `ownerEmail` 校验，403 即退
  2. `readBody` 取 `content`，非空校验
  3. `appendChat` 写入 user message（id 由 `randomBytes` 生成）
  4. `buildChatMessages(systemPrompt, session.messages, content)`
  5. `res.writeHead(200, {"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive","X-Accel-Buffering":"no"})`
  6. `res.write("event: thinking\ndata: {...}\n\n")`
  7. `const ac = new AbortController(); req.on("close", () => ac.abort())`
  8. `for await (const chunk of callModelStream(model, messages, { signal: ac.signal, maxTokens, temperature }))` → 透传 `event: delta`，遇到 `usage` 写 `event: usage`
  9. 收尾把 assistant message `appendChat` 写回（带 `tokens`），发 `event: message_end`
  10. try/catch 写 `event: error`，最终 `res.end()`
- `GET /api/chat/models` → 返 `{ models, activeModelId }`，**不暴露 apiKeyEnv**（只返 name/provider/model/category/isActive，前端永远拿不到 key）。
- `POST /api/chat/models` → 新增模型配置（仅主管可调，复用 `canApprove`）。
- `PUT /api/chat/models/<id>` → 更新模型配置（仅主管）。
- `DELETE /api/chat/models/<id>` → 删除（仅主管）。
- `POST /api/chat/models/<id>/activate` → 切换激活模型（**任何登录用户**可调，避免再增权限函数）。

**(4) `loadSkillModelConfig`（L377-380）不动** — chat 模型配置走 `db/models.json`，与 `ai-review.config.json` 解耦。

**(5) 顶栏导航**：在 `web/ai-pipeline.html` / `web/account.html` / `web/team.html` / `web/github-audit.html` / `web/tickets.html` 的 `.top-right` 内（参考 ai-pipeline.html L22-26）追加 `<a class="nav-link" href="/chat">AI 对话</a>`；当前页保留 `active` 类。

### 3. `src/config.ts` + `config.example.json` — 加 `chat` 配置段

```ts
export interface ChatConfig {
  systemPrompt?: string;     // 默认 "你是 ai-flows 平台的 AI 助手…"
  maxHistory?: number;       // 默认 50
  maxTokens?: number;        // 默认 2000
  temperature?: number;      // 默认 0.7
}
// ReviewConfig 加 chat?: ChatConfig
// loadConfig 兜底默认值如上
```

`config.example.json` 同步加 `chat` 段示例。

---

## 关键技术决策

| 项 | 决策 | 理由 |
|----|------|------|
| 流式实现 | 全局 `fetch` + `res.body.getReader()` + `TextDecoder` 按行解析 `data: {...}\n\n` | 零依赖红线，不引 OpenAI SDK |
| 前端 SSE | `fetch(POST, body)` + `ReadableStream` 解析 | EventSource 不支持 POST + cookie 头 |
| 中止 | 前端 `AbortController.abort()` + 服务端 `req.on("close", () => ac.abort())` 传 `signal` 进 fetch | 防客户端早断导致上游泄漏 |
| 模型配置存储 | `db/models.json` 只存 `apiKeyEnv` 字段名，运行时 `resolveApiKey(model)` 从 `process.env[apiKeyEnv]` 取真实 key | 遵守「凭据只从环境变量读」红线 |
| 与 callModel 关系 | **不复用**，新建 `callModelStream` | `callModel` 强制 `response_format: json_object` 且无 stream；改签名会波及 `reviewer`/`skill` 调用方，违反零回归 |
| 会话权限 | 按 `ownerEmail` 私有，不按部门 | 简化权限，不进 `filterByUser`/`canExecute` 体系 |
| 模型切换权限 | 任何登录用户可切换激活；CRUD 仅主管 | 切换是个人偏好，CRUD 影响团队 |
| 顶栏导航 | 所有页面 HTML 加 `<a class="nav-link" href="/chat">AI 对话</a>` | 现有 5 个页面顶栏都是手写重复，需全部同步 |
| chat 是否进节点状态机 | 不进，独立功能页 | 与 pipeline 平行，避免污染节点四态 |

---

## 潜在坑点

- **SSE 长连接 + Windows fd**：node:http 单实例多路复用没问题；客户端断开必须 `req.on("close")` abort 上游，否则 fetch 持续消耗。
- **OpenAI SSE 解析 buffer 拼接**：`data: ` chunk 可能跨多个 `value`，必须维护 `pending: string` 缓冲按 `\n` 切，遇完整 `data:` 行才 `JSON.parse`，遇 `[DONE]` 才结束。
- **`db/models.json` 种子落盘**：`loadChatModels` 缺文件时返种子 DeepSeek 配置，**但必须 `saveChatModels(seed)` 落盘一次**，避免每次重启回退用户改动。
- **会话膨胀**：MVP 不分页，单会话超过 50 条历史仍只取最近 50（`buildChatMessages` 内截断），落盘全量。
- **中止按钮异常路径**：前端 `AbortController` 抛 `AbortError`，路由层 try/catch 捕获后**不要写 `event: error`**（避免已 end 的 socket 二次写），直接 `res.end()`。
- **`DEEPSEEK_API_KEY` 未配**：首次发消息时 `resolveApiKey` 返回空，`callModelStream` 抛 `缺少模型 API Key`，路由层 catch 后发 `event: error` 提示用户。
- **HTML 转义**：用户消息 + AI 回复一律走 `esc()` 后插入 DOM（前端）或写入 `db/chats.json`（后端原文存）。前端渲染时再 esc，落盘原文，与 `tickets` 富文本模式一致。

---

## 验证步骤

1. **类型检查**：`npx tsc --noEmit` 通过。
2. **单测**：`npx tsx --test "src/**/*.test.ts"` — `chat.test.ts` 全绿。
3. **手工 E2E**：
   - `set DEEPSEEK_API_KEY=sk-... && npx tsx src/index.ts platform --port 4311`
   - 浏览器开 `http://localhost:4311/login`，用任一账号（密码 123456）登录。
   - 顶栏点「AI 对话」进 `/chat` → 左侧「+ 新建会话」→ 输入 "你好" → 看到流式逐字输出 → 切换模型下拉 → 删除会话验证持久化。
   - 网络面板看 `/api/chat/sessions/<id>/messages` 响应头 `Content-Type: text/event-stream`，事件序列 `thinking → delta×N → usage → message_end`。
   - 重启服务后会话仍在（验证 `db/chats.json` 落盘）。
   - 用另一账号登录，构造他人 `session id` 直接 GET `/api/chat/sessions/<id>` → 403（验证 `ownerEmail` 鉴权）。
   - 主管账号登录，访问「模型配置」入口（前端 select 旁的齿轮按钮）→ 新增/编辑/删除模型 → 切换激活。

---

## 实现顺序

1. `src/db.ts` 追加 chat/models 接口（最先做，其他模块依赖它）。
2. `src/chat.ts` 实现 `callModelStream` + `buildChatMessages` + `truncateTitle` + `esc` + `PROVIDER_DEFAULT_ENDPOINTS`。
3. `src/chat.test.ts` 写纯函数测试。
4. `src/config.ts` + `config.example.json` 加 `chat` 段。
5. `src/platform.ts` 加 STATIC_FILES + `chatHtml` + `/chat` 页路由 + `/api/chat/*` API（最后做 SSE 路由）。
6. `web/chat.html` + `web/chat.js` 实现 UI。
7. 5 个页面 HTML 顶栏加「AI 对话」nav-link。
8. `npx tsc --noEmit` + `npx tsx --test` + 手工 E2E。

---

## 红线遵守清单

- [x] 零运行时依赖：`callModelStream` 用全局 `fetch`，不引 OpenAI SDK
- [x] 凭据只从环境变量读：`ChatModel.apiKeyEnv` 只存字段名，`resolveApiKey` 取 `process.env`
- [x] HTML 插值必须转义：用户/AI 文本一律 `esc()`
- [x] 路径穿越防护：`/api/chat/sessions/<id>` 的 id 用 `[^/\\]+` 限定
- [x] 静态资源白名单：`STATIC_FILES` 加 `/chat.js`，不拼路径
- [x] ESM 相对导入必带 `.js`
- [x] JSON 文件存储：`db/chats.json` + `db/models.json`
- [x] `process.exitCode` 契约（chat 路由不涉及 CLI 退出码，但沿用模式）
- [x] 注入 bootstrap 必须转义：`window.__CHAT__` 用 `jsonForScript()` 转义 `<`
- [x] 顶栏导航方形圆角：`nav-link` 用 `border-radius:8px`（与现有页面一致）
