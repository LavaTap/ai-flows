# 移植AI对话功能到管线项目

> **Workspace:** d:\code\ai-flows

---

**User**

将sqlite的数据库功能迁移到主仓库 审核过了 然后每个用户头像也要存储 每个用户的ai对话相互独立 每个账户内的ai参考aichat的记忆管理方式 每个对话上下文本超过400字符则存储做压缩 最后头栏里面的用户名字这块可以点开 然后把账户管理选项收纳进去 面板有放大的用户信息和邮箱 下面则是设置 设置点开就是账户管理

**Assistant**

### Relevant Code Snippets
1. d:\code\private\ai-chat\backend\src\routes\characterChat.ts:L350-L362
   — 对话时组装 LLM prompt：先取角色 system prompt，再查数据库取最近 50 条消息，并按 `user/assistant` 角色追加到 messages 中。

2. d:\code\private\ai-chat\backend\src\services\chatService.ts:L42-L75
   — 调用 LLM 流式补全的位置；将组装好的 messages 直接传给 OpenAI-compatible API，`max_tokens` 默认 4000，未看到额外上下文压缩逻辑。

3. d:\code\private\ai-chat\backend\src\services\characterPromptService.ts:L54-L77
   — `buildSystemPrompt()` 生成系统提示词，把角色 identity、scene_setting、language_style、behavior_rules 拼成固定 prompt，并附加回复规则。

4. d:\code\private\ai-chat\backend\src\database.ts:L72-L99
   — 记忆/对话持久化表结构：`character_conversations` 保存对话和消息数，`character_messages` 保存每轮 user/assistant 内容、情绪、token 使用量。

5. d:\code\private\ai-chat\backend\src\routes\characterChat.ts:L322-L362
   — 发送消息接口完整流程：保存用户消息、读取最近 50 条历史、构造 system+history prompt、调用流式 LLM，并保存 assistant 回复。

6. d:\code\private\ai-chat\backend\src\database.ts:L500-L503
   — `getCharacterMessages()` 查询某对话的所有消息；调用方随后用 `.slice(-50)` 限制上下文窗口。

已摸清两个仓库的关系：`d:\code\ai-flows-sqlite` 就是主仓库 + 未提交的 SQLite 改造（`src/sqlite.ts` + `src/db.ts` 重写 + `package.json`/`.gitignore`/`AGENTS.md`）。主仓库已有 AI 对话功能（commit `81d6982`），所以迁移基本是把 SQLite 数据层同步过来。

有几点需要你拍板，免得做偏：

理解一致，开始执行。先把这次调研结论落到新上下文，避免长任务里上下文被截断。

I'll verify the current state of both repos before continuing the migration.

Let me examine the SQLite repo's db.ts chat sections and platform.ts chat routes.

Now I understand the migration scope. Let me set up the task list and start.

Now let me add the `summary` column for memory compression.

The prebuilt binary ships with the package. I'll copy it from the sqlite repo instead of compiling.

SQLite migration compiles. Now the memory-compression logic — let me inspect the chat route in platform.ts.

Now the memory compression. First add the boundary column and config option.

Now add the non-streaming call and memory-summary helpers to chat.ts.

Now wire it into the platform SSE route.

Now the header user-menu dropdown. Let me inspect how the header/avatar is populated across pages.

Now implement the dropdown. First the CSS.

Now update the 6 page headers.

Now sync the docs. Let me locate the relevant AGENTS.md sections.

45/46 pass — the one failure is the pre-existing missing-skill-dir test, unrelated. Now E2E verification.

The API key is available, so let me verify memory compression end-to-end.

Two `thinking` events on msg2 confirm the compression path ran. Let me verify the summary persisted.

迁移与三项新功能都已落地并验证完毕。

## 已完成

**1. SQLite 迁移到主仓库 `d:\code\ai-flows`**
- 新增 [sqlite.ts](file:///d:/code/ai-flows/src/sqlite.ts)（`getDb()` 单例 + WAL + 外键 + 幂等 DDL），[db.ts](file:///d:/code/ai-flows/src/db.ts) 重写为 SQLite 数据访问 —— 导出 API 与旧 JSON 版逐字兼容，调用方零改动
- [package.json](file:///d:/code/ai-flows/package.json)：`engines.node>=22`、`dependencies: better-sqlite3 ^13.0.3`、devDep `@types/better-sqlite3`；package-lock.json 同步；[.gitignore](file:///d:/code/ai-flows/.gitignore) 加 `db/ai-flows.sqlite(+wal/shm)`、`db/chats.json`；[AGENTS.md](file:///d:/code/ai-flows/AGENTS.md) 红线改为「运行时依赖仅 better-sqlite3」
- 首次启动自动导入旧 `db/*.json`（`settings.migrated_from_json` 置位后不再执行）。实测导入：users 6 / nodes 4 / reviews 3 / chat_sessions 2 / chat_messages 10 / chat_models 1

**2. 头像存储**：沿用「users 表只存文件名 + 二进制落 `db/avatars/`」，SQLite `users` 表含 `avatar` 列，上传/读取路由不变

**3. AI 对话按账号隔离**：`ChatSession.ownerEmail`（实测 liuyang 登录后看不到 zhangli 的会话）

**4. 记忆管理（参考 ai-chat 的历史截断 + 新增压缩）**
- `chat_sessions` 新增 `summary` / `summary_upto` 列
- [chat.ts](file:///d:/code/ai-flows/src/chat.ts) 新增 `callModelOnce`（非流式）、`MEMORY_SUMMARY_SYSTEM`、`historyToText`、`countChars`、`buildSummaryMessages`；`buildChatMessages` 增 `memory` 参数
- `config.chat.compressChars` 默认 **400**（[config.example.json](file:///d:/code/ai-flows/config.example.json) 同步）
- [platform.ts](file:///d:/code/ai-flows/src/platform.ts#L1970-L2005) SSE 路由：未压缩原文累计超 400 字时，把旧摘要 + 新原文压缩成新摘要落库（滚动更新，失败不阻断对话）；之后 prompt 只送【摘要 + 未压缩近期原文】
- **实测**：第 2 条消息触发压缩，`summary` 落库 335 字、`summary_upto=2`

**5. 顶栏用户菜单**：新增 [user-menu.js](file:///d:/code/ai-flows/web/user-menu.js) + [ai-pipeline.css](file:///d:/code/ai-flows/web/ai-pipeline.css#L274-L366) 样式；6 个页面（管线/工单/账号/团队/GitHub/AI 对话）顶栏 `user-chip` 可点开，面板上部放大头像 + 姓名 + 邮箱，分隔线下「设置」→ `/account`；原「账号管理」导航项已收纳进面板

**验证**：`npx tsc --noEmit` 通过；单测 46 项 45 通过（唯一失败是 `skill.test.ts` 因 `.agents` 下 skill 未安装，与本次改动无关），新增 6 项 chat 测试全通过；平台起在 4316 实测 6 个页面 + `/user-menu.js` 全部 200。

## 两点需要你确认

一个环境问题：本机 `npm install` 编译 `better-sqlite3` 时因缺 Visual Studio C++ 工具链失败（`gyp ERR! find VS`）。我改为从 `ai-flows-sqlite` 复制已带预编译二进制（`prebuilds/win32-x64.node`）的 `node_modules/better-sqlite3` 与 `@types/better-sqlite3` —— 运行没问题，但**换台机器全新 `npm install` 会失败**。

另外发现工作区里 `review-report.md` 处于被删除状态（我本次没有动它）。

已按你的选择处理：`review-report.md` 保持删除状态；AGENTS.md 安装行补上了 `--ignore-scripts` 说明（[AGENTS.md](file:///d:/code/ai-flows/AGENTS.md#L22)）。

## 本次改动清单（主仓库 `d:\code\ai-flows`）

**新增**
- [src/sqlite.ts](file:///d:/code/ai-flows/src/sqlite.ts) —— SQLite 连接与建表（唯一开库入口）
- [web/user-menu.js](file:///d:/code/ai-flows/web/user-menu.js) —— 顶栏用户菜单共享脚本

**修改**
- [src/db.ts](file:///d:/code/ai-flows/src/db.ts) —— JSON → SQLite 数据访问（API 兼容，含 `summary`/`summaryUpto` 字段）
- [src/chat.ts](file:///d:/code/ai-flows/src/chat.ts) —— `callModelOnce` + 记忆摘要相关纯函数
- [src/config.ts](file:///d:/code/ai-flows/src/config.ts) / [config.example.json](file:///d:/code/ai-flows/config.example.json) —— `chat.compressChars`（默认 400）
- [src/platform.ts](file:///d:/code/ai-flows/src/platform.ts) —— SSE 路由记忆压缩、`/user-menu.js` 白名单
- [src/chat.test.ts](file:///d:/code/ai-flows/src/chat.test.ts) —— 新增 6 项测试
- [package.json](file:///d:/code/ai-flows/package.json) / package-lock.json / .gitignore / AGENTS.md
- web 6 页 HTML 顶栏 + [ai-pipeline.css](file:///d:/code/ai-flows/web/ai-pipeline.css)

**待你确认的边界**：`db/ai-flows.sqlite` 是运行时文件（已 gitignore），首次启动已自动完成旧 JSON 导入；`better-sqlite3` 的 `node_modules` 是我从 `ai-flows-sqlite` 复制过来的，本机直接可跑，换机器请用 `npm install --ignore-scripts`。改动均未提交，需要我提交时说一声。

---

**User**

把目前的chat reviews单独分出两张表去 注意要和现在的表联通 有email name共同字段

**User**

把目前的chat reviews单独分出两张表去 注意要和现在的表联通 有email name共同字段 reviews额外记录部门字段

**Assistant**



*正在请求专家建议，优化解决方案，该过程耗时可能较长，请耐心等待...*

需求里有一处我不敢替你拍板的地方，先确认再动手。

我的理解是：`users` 表存账号（email/name/department），而 chat 与 reviews 想各自**单独分出一张表**、通过 `email` 与 `users` 联通，字段上自持 `email` + `name`（reviews 再加 `department`）。但"分出"的具体形态有几种做法，改动量和后续维护方式差别很大：

- `users` 本身已经有 `name` 和 `department` 了，所以纯"投影表"会有冗余，需要明确以哪一边为准
- 现有 `chat_sessions` 只有 `owner_email`；`reviews` 已经有 `email` / `department` / `actor`

明白了：`users` 作为独立主表，新增 `chat_accounts` / `review_accounts` 两张账号表由它同步。先看现库的用户写入路径。

`syncUserAccounts()` 内部调 `loadUsers()` 会再次触发 `db()`，因 `ready` 已置 true 不会死循环。现在补 API 端点。



更正一下：API 端点没必要加，这两张表是数据层的账号投影表，保持最小改动。先验证表能正确建立并同步。

FK 与数据均正确。再验证「改用户资料 → 两张表自动同步」。

同步正常（资料名 `李云SYNC` 因 `setUserProfile` 走的是 `syncUserAccounts` 的 `name ?? ''`，但库里 `users.name` 显示仍是 `李云`？让我核实数据源，确保没有覆盖错误）。



`setUserProfile` 直连 UPDATE，没走 `saveUsers`，所以漏了同步。补上。

同步验证通过（`synced: true`）。停服务并补文档。

`db/*.json` 种子文件被删了，先查原因。

本次改动已完成并验证：

## 新增两张账号表（`users` 为主表，其他表同步它）

**DDL**（[sqlite.ts](file:///d:/code/ai-flows/src/sqlite.ts#L129-L141)）
- `chat_accounts(email PK, name)` —— email 外键 → `users.email`，`ON DELETE CASCADE`
- `review_accounts(email PK, name, department)` —— 同上，额外带 `department`

**联通关系**：`email` 既是两张表的主键，也是指向 `users.email` 的外键；同时与 `chat_sessions.owner_email`、`reviews.email` 同键对应。

**同步逻辑**（[db.ts](file:///d:/code/ai-flows/src/db.ts#L768-L808)）
- `syncUserAccounts()` —— 从 `users` 整表重建两张投影表（先清空再写，保证与主表完全一致；`users` 行被删时外键已级联清理）
- 触发点：`saveUsers()`、`setUserProfile()`（第二条 users 写入路径，第一版漏了、已补）、以及每次进程启动（覆盖"旧库已迁移过、新表还是空"的升级场景）
- `loadChatAccounts()` / `loadReviewAccounts()` 供读取

**验证**：两张表各同步出 6 个账号，姓名/部门与 `users` 一致；走 `/api/account/<email>/profile` 改名后两张表立即跟着变（`synced: true`）；`npx tsc --noEmit` 通过、chat 单测 16/16 通过。AGENTS.md 补了红线「users 是账号唯一主表」。

改动未提交。

## 但有个问题必须先跟你确认

`git status` 显示这 4 个**已跟踪**的文件当前处于被删除状态：

```
D db/models.json   D db/pipeline.json   D db/reviews.json   D db/users.json
```

它们不是我删的（`src/` 里没有任何 `unlink`）。但麻烦在于：[db.ts](file:///d:/code/ai-flows/src/db.ts#L296) 的首次导入仍靠它们播种 —— 文件没了，全新环境启动会得到一个**空 users 表，谁都登录不上**。而且 [.gitignore](file:///d:/code/ai-flows/.gitignore) 把 `db/ai-flows.sqlite` 忽略了，SQLite 文件也不会进仓库。

你已经还原好了，工作区现在只剩本次的 3 个改动文件。

```
 M AGENTS.md
 M src/db.ts
 M src/sqlite.ts
```

`db/models.json`、`db/pipeline.json`、`db/reviews.json`、`db/users.json` 都已回到与 HEAD 一致的状态，`importLegacyJson` 的播种链路完好 —— 全新克隆或删掉 `db/ai-flows.sqlite` 重建时，仍会从 JSON 导入（现有库因为 `settings.migrated_from_json` 已置位，不会重复导入）。

## 本次交付

**两张账号表**（[sqlite.ts](file:///d:/code/ai-flows/src/sqlite.ts#L129-L141)）
- `chat_accounts(email PK → users.email ON DELETE CASCADE, name)`
- `review_accounts(email PK → users.email ON DELETE CASCADE, name, department)`

**同步机制**（[db.ts](file:///d:/code/ai-flows/src/db.ts#L768-L808)）：`users` 是唯一主表，`syncUserAccounts()` 从它整体重建两张投影表；`saveUsers()` / `setUserProfile()` 写完后调用，进程启动也同步一次。读取用 `loadChatAccounts()` / `loadReviewAccounts()`。

**联通**：`email` 既是两张表主键、也是指向 `users.email` 的外键，同时与 `chat_sessions.owner_email`、`reviews.email` 同键对应。

**验证**：6 个账号两表均同步；改资料后同步跟随（`synced: true`）；`tsc --noEmit` 通过、chat 单测 16/16 通过。AGENTS.md 补了「users 是账号唯一主表」红线（[AGENTS.md](file:///d:/code/ai-flows/AGENTS.md#L65)）。

改动未提交 —— 要提交时说一声。另外这两张表目前是纯数据层投影，还没接到任何 API/页面；需要的话我再把对话与评审列表改成从它们取名/部门。

---

**User**

`d:\code\ai-flows/.agents\skills\api.md`1 把所有接口整理进md 要求按照业务分类 每行只需要接口描述＋业务内容 每行内容尽量不要太长最好不超过三行 2 目前ai管钱ui前面新增一个首页 首页中心新增一个搜索框 搜索框旁边新增一个筛选可以筛选知识库/工单/员工 可以搜索所有员工（根据姓名/邮箱/职位/部门都可以搜索）或工单（知识库先空着）3 bug单更名为工单系统 当员工被归入管线节点执行人时自动往这个账户上面新增工单 4 工单状态只能由主管切换 5 管线节点面板新增工单引用 每个节点必须要挂需求工单 

**Assistant**

先看 4311 启动失败的原因，同时并行摸清管线页 / 工单的现有实现。

4311 已停（我会在改完后重启）。现在并行摸清三块现状。

### Relevant Code Snippets
1. d:\code\ai-flows\src\db.ts:L145-L191
   — 定义工单数据模型：`TicketStatus`、`TicketKind="bug"`、`TicketComment`、`TicketRecord`，其中 `department` 决定可见范围，`images/comments` 为关联数据。

2. d:\code\ai-flows\src\sqlite.ts:L70-L93
   — SQLite DDL 中 `tickets` / `ticket_comments` 两张表字段，包括 `id/kind/title/content/status/department/author*/images` 和评论的 `ticket_id/author/email/department/content/at`。

3. d:\code\ai-flows\src\db.ts:L964-L1021
   — 工单相关数据库操作：`loadTickets()` 从 `tickets` 和 `ticket_comments` 读取并组装评论；`saveTickets()`、`appendTicket()`、`updateTicket()` 负责写回、新建和按 id 更新。

4. d:\code\ai-flows\src\platform.ts:L96-L108
   — 工单权限与过滤核心：`canAccessTicket()` 允许主管或同部门员工访问；`filterTicketsByUser()` 主管全量、员工只看本部门；`isTicketStatus()` 校验状态取值。

5. d:\code\ai-flows\src\platform.ts:L1615-L1680
   — `/api/tickets` GET/POST 路由：列表按 `filterTicketsByUser()` 过滤并按更新时间倒序；新建工单固定 `kind:"bug"`、`status:"open"`，归属提交人 `department`。

6. d:\code\ai-flows\src\platform.ts:L1739-L1838
   — 工单状态流转、评论、详情接口：`/status`、`/comments`、`/tickets/:id` 均调用 `canAccessTicket()`，未登录/不存在/无权限分别返回 401/404/403。

7. d:\code\ai-flows\web\tickets.html:L157-L221
   — 工单前端页面结构：标题区“Bug 单”、新建按钮、左侧筛选列表、右侧详情/状态栏/评论/富文本编辑器，以及“新建 bug 单”表单。

8. d:\code\ai-flows\web\tickets.js:L55-L142
   — 前端富文本编辑器实现：工具栏按钮、图片上传到 `/api/tickets/upload`、插入图片、粘贴纯文本，是工单正文/评论富文本交互的核心逻辑。

### Relevant Code Snippets
1. d:\code\ai-flows\src\platform.ts:L63-L76
   — 定义平台核心权限判定：`canExecute`（本部门员工+主管）、`canApprove`（仅主管）、`canEditRequirement`（与执行权限一致），后续路由据此做 403 拦截。

2. d:\code\ai-flows\src\platform.ts:L95-L104
   — 定义工单访问/过滤权限：本部门员工+主管可访问，主管全量，员工只看本部门提交的工单。

3. d:\code\ai-flows\src\platform.ts:L307-L329
   — `STATIC_FILES` 白名单及静态资源响应逻辑；包含 `/login`、`/ai-pipeline`、`/account`、`/team`、`/tickets`、`/github-audit`、`/chat` 等页面/脚本资源。

4. d:\code\ai-flows\src\platform.ts:L713-L761
   — 平台 HTTP 入口的前半段路由：静态资源、登录页、`POST /api/login` 签发 cookie、`POST /api/logout` 清 cookie、`GET /api/me` 未登录 401。

5. d:\code\ai-flows\src\platform.ts:L764-L866
   — 账号管理与 GitHub 绑定路由：`/api/account`、绑定/取消/解绑、主管审核 `approve|reject`，权限要求从“登录即可”到“仅部门主管可审核”。

6. d:\code\ai-flows\src\platform.ts:L917-L988
   — 管线与节点数据路由：`GET /api/nodes` 登录即可查看全流程，`POST /api/pipeline/rename` 登录即可，`GET /api/reviews` 登录并按角色/部门过滤，`GET /pipeline` 未登录重定向登录。

7. d:\code\ai-flows\src\platform.ts:L1093-L1174
   — 需求与附件路由：`PUT /api/nodes/<id>/requirement` 和 `POST /api/nodes/<id>/upload` 均要求登录，并调用 `canEditRequirement`，仅本部门员工或主管可编辑/上传。

8. d:\code\ai-flows\src\platform.ts:L1176-L1420
   — 节点动作路由：`POST /api/nodes/<id>/{execute,submit,approve,reject}`，根据节点动作和 `canExecute/canApprove` 等权限拦截；包含 skill、research-crawler、ai-review 执行逻辑。

9. d:\code\ai-flows\src\serve.ts:L192-L209
   — 报告服务 HTTP 入口：`GET /` 报告列表、`GET /health`、`POST /reports/<id>/push` 确认提交路由。

10. d:\code\ai-flows\src\serve.ts:L272-L289
   — 报告详情路由：`GET /reports/<id>` 读取 `<id>.json` 并渲染，否则 404。

11. d:\code\ai-flows\src\index.ts:L247-L296
   — CLI 入口中会启动 HTTP 服务的子命令：`serve` 启动报告服务，`platform` 启动 AI 管线平台，并打印默认端口/登录页信息。

### Relevant Code Snippets
1. d:\code\ai-flows\web\ai-pipeline.html:L11-L42
   — AI 管线页 HTML 顶栏骨架：包含品牌区、导航 `nav-link`（AI 管线/工单/GitHub/团队管理/AI 对话）、`user-chip`、用户面板及退出登录按钮。

2. d:\code\ai-flows\web\ai-pipeline.html:L45-L64
   — 页面主体左侧：管线列表侧栏，包含管线列表、新增输入、添加按钮和当前仓库展示。

3. d:\code\ai-flows\web\ai-pipeline.html:L66-L137
   — 页面主体右侧：管线节点列表/流程区，包含多个 `.cell` 节点、节点按钮、箭头以及底部权限提示。

4. d:\code\ai-flows\web\ai-pipeline.html:L140-L191
   — 节点详情/悬停模板：每个节点有独立 `template`，展示节点名称、状态、负责部门、执行角色、权限等信息。

5. d:\code\ai-flows\web\ai-pipeline-app.js:L6-L18
   — 管线应用入口：从 `window.__PIPELINE__` 读取 `user/members/nodes`，定义角色、状态、部门、头像颜色等前端配置。

6. d:\code\ai-flows\web\ai-pipeline-app.js:L352-L386
   — 顶栏用户信息渲染：根据 `boot.user` 渲染 `user-chip` 头像、姓名、岗位、角色，并控制团队链接可见性。

7. d:\code\ai-flows\web\ai-pipeline-app.js:L390-L464
   — 节点“执行角色”卡片渲染：按 `node.department` 从 `members` 筛选本部门员工，渲染紧凑角色 chip，并在 hover 时展示姓名/部门/职位/邮箱详情卡。

8. d:\code\ai-flows\web\ai-pipeline-app.js:L1086-L1194
   — 节点详情面板渲染主逻辑：更新状态徽章、渲染执行角色、进度条、结果、产物、报告链接、提交文件区和操作按钮。

9. d:\code\ai-flows\web\ai-pipeline-app.js:L1236-L1309
   — 节点操作按钮渲染与权限控制：根据 `node.ready`、`node.canExecute`、`node.canApprove`、`node.status` 决定执行/提交/验收/驳回按钮是否展示。

10. d:\code\ai-flows\src\db.ts:L74-L106
   — `NodeState` 数据模型定义：包含 `id/department/step/ready/status/runner/requirementText/uploads/artifacts/progress/rejection/lastResult/reportUrl/outputDir` 等字段。

11. d:\code\ai-flows\src\platform.ts:L917-L933
   — `/api/nodes` 接口：服务端返回 `pipelineName/user/members/nodes/busy`，其中 `members` 是前端筛选执行角色的数据源，`nodes` 经 `toNodeView` 后供管线页使用。

12. d:\code\ai-flows\src\db.ts:L325-L337
   — 节点数据持久化：SQLite 迁移/写入 `nodes` 表，字段映射与 `NodeState` 一致，说明节点数据来自 JSON 种子并落盘到 SQLite。

调研完成，现状清楚了。开工前有 3 个会决定数据模型的点需要你拍板。

调研与决策已就绪，接下来是跨多文件的大改造（含数据库拆库），我先切一个干净的上下文继续执行。

I'll start by understanding the current state of the codebase, then plan the work.

This is a large task. Let me set up the todo list and explore the key files first.



Now let me check remaining pages' topbars and .gitignore.

---

