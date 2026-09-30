# ai-flows（ai-review CLI + AI 管线平台）

> 平台无关的 AI 代码评审链 CLI + 公司 AI 管线平台。`run` 采集 git diff → 调 LLM（DeepSeek/OpenAI 兼容接口）评审 → 门禁判定 → 生成 Markdown 报告 + 评审数据；推送只走评审页面「确认提交」（或显式 `--push`）。`platform` 子命令提供登录 + 四部门管线页 + 节点执行/批准（节点 03 触发真实 AI 评审）；`install-hook` 让每次 `git push` 先被拦截去评审，再由页面确认提交放行。
> 技术栈：TypeScript 5.6（strict）+ Node ≥22 ESM，**唯一运行时依赖 `better-sqlite3`**（原生 SQLite 绑定，其余能力用 `node:*` 内置模块 + 全局 `fetch` 自实现）；平台数据存 **三个 SQLite 库**：主库 `db/ai-flows.sqlite`（账号/节点/配置）+ AI 对话评审库 `db/ai-chat-reviews.sqlite`（ATTACH 为 schema `chat_reviews`）+ 工单库 `db/ai-tickets.sqlite`（ATTACH 为 schema `tickets`），`src/sqlite.ts` 建库建表并挂载，`src/db.ts` 数据访问（子库 SQL 带 schema 前缀，主库账号表可跨库 JOIN）；旧 `db/*.json` 仅作首次启动的一次性导入源。前端静态页在 `web/`，不引前端框架。
> 完整链路、报告页面架构、目标仓库接入步骤见 `评审链路与说明.md`；整体数据流图见 `架构与数据流.md`；平台目标、账号清单与权限模型见 `plan.md`，本文件不重复。
> 本文件是仓库 AI 指令的**唯一来源**（`CLAUDE.md` 已删除，不再维护双镜像）。

## 适用范围

| 范围 | 说明 |
|------|------|
| 生效 | 本仓库 `src/**` 全部源码、`web/**`（平台静态页）、`db/*.json`（账号 / 节点 / 评审 / 工单 / 会话 / 模型数据，**仅作 SQLite 首次导入源**），以及 `package.json` / `tsconfig.json` |
| 排除 | `dist/**` 是 `tsc` 构建产物，**禁止手工编辑**（下次构建即被覆盖）；`.agents/skills/` 下**借用的第三方 skill**（`writing-claude-md`、`skill-creator`、`ui-ux-pro-max`，均已 gitignore）各有自己的 SKILL.md/CLAUDE.md，不受本文件约束 |
| 自有 skill | `.agents/skills/ai-flows/` 是本仓库自己的 agent 操作入口（与 `src/index.ts` 同源），用户说「初始化仓库 / 接入评审 / 检查密钥 / 代码评审 / 跑评审」时**先读它的 `SKILL.md` 路由表，只读命中的那一份业务文档**（`references/` 下），其余业务文档禁止打开或 `Grep` |
| 本地文件 | `ai-review.config.json` 已 gitignore，属本地配置非源码；要维护的模板是 `config.example.json` |
| 文档同步 | `plan.md`（平台账号/权限/节点模型）、`评审链路与说明.md`（评审链实操）、`评审触发指令.md`（触发评审的工具链指令速查）、`架构与数据流.md`（数据流图）——平台行为变更时必须同步对应文档 |

## 命令

| 操作 | 命令 |
|------|------|
| 安装依赖 | `npm install`（3 个 devDeps：`@types/node` `tsx` `typescript`，外加唯一运行时依赖 `better-sqlite3`；后者是原生模块，要求 Node ≥22，包内自带各平台预编译二进制，运行期直接加载 `prebuilds/<platform>-<arch>.node`）<br>⚠️ 无 C++ 工具链的机器（npm 会对含 `binding.gyp` 的包默认执行 `node-gyp rebuild`，报 `gyp ERR! find VS`）：改用 `npm install --ignore-scripts`——跳过编译脚本，运行期仍走包内预编译二进制 |
| 开发运行 | `npm run dev`（= `tsx src/index.ts`，直接执行 TS 源码） |
| 构建 | `npm run build`（= `tsc`，产出 `dist/`） |
| **类型检查（唯一自动化门禁）** | `npx tsc --noEmit` |
| 手工端到端验证 | `npx tsx src/index.ts run --page`（需 `ai-review.config.json` + `DEEPSEEK_API_KEY`；`run` 缺省不推送，评审页面需输入 commit 信息并点「确认提交」才提交+推送） |
| 报告服务 | `npx tsx src/index.ts serve --port 4310`（列表页 `GET /`，报告页 `GET /reports/<id>`） |
| 平台服务 | `npx tsx src/index.ts platform --port 4311 [--repo <path>]`（登录页 `/login`，管线页 `/pipeline`，工单页 `/tickets`，账号页 `/account`，团队页 `/team`，GitHub 绑定页 `/github-audit`；节点 03 对 `--repo` 仓库触发真实评审，缺省当前目录；演示密码统一 123456） |
| 安装 pre-push hook | `npx tsx src/index.ts install-hook`（`git push` 前自动评审并**始终拦截**，引导到评审页面点「确认提交」） |
| 日志查看 | `npx tsx src/index.ts logs --kind <ai\|web\|all> [--lines N] [--follow]`（直读 `logs/ai.log` + `logs/web.log`；`--follow` 增量跟读，供启动脚本日志窗口用） |

> 本项目**没有** linter / formatter / 测试框架 / CI。不存在 `npm run lint`、`npm test` 等 script——不要执行，也不要把它们当作"已验证"的依据。改完代码的最低验证标准是 `npx tsc --noEmit` 通过。

## 核心架构规则

模块职责（`src/` 为扁平单层，一个关注点一个文件）：

| 模块 | 职责 |
|------|------|
| `index.ts` | CLI 入口：子命令编排（`run` / `serve` / `platform` / `install-hook` / `init`）、手写 `parseArgs`、退出码、hook 安装 |
| `config.ts` | 加载 `ai-review.config.json`、合并默认值、`resolveApiKey` |
| `git.ts` | **唯一**调用 git 的模块（`execFile` 封装 diff / branch / isRepo） |
| `collector.ts` | diff 采集：按文件拆分、exclude glob 过滤、超大文件标记降级 |
| `reviewer.ts` | 调模型 + 解析 JSON + 并发池；**格式化接口** `formatReport()` |
| `gate.ts` | 门禁判定 `decideGate()`：命中 `severityBlocked` 即不通过 |
| `reporter.ts` | Markdown 报告 + HTML 模板渲染 `renderTemplate()` |
| `serve.ts` | 报告 HTTP 服务（`node:http`）+ 报告列表页 + `POST /reports/<id>/push` 确认提交（需带 commit message，有暂存先 commit 再 push；无暂存且信息与 HEAD 不同则 amend 改写） |
| `publisher.ts` | 多目标远端推送、https token 注入；内部推送置 `AI_REVIEW_INTERNAL_PUSH=1`，防被 pre-push hook 循环拦截 |
| `platform.ts` | 平台 HTTP 服务：登录会话 + 首页 `/home`（注入 `window.__HOME__`）+ `GET /api/search` 全局搜索（员工/工单/知识库）+ 管线页注入 `window.__PIPELINE__` + 节点执行/提交/验收/驳回 API + `POST /api/nodes/<id>/executors` 主管添加执行人（自动建指派工单）+ 需求编辑/附件上传/目录浏览/产物下载 + `GET /api/reviews` 评审记录（平台历史 + 外部报告聚合，按视角过滤）+ 账号管理 API（我的资料 / 头像上传 `POST /api/account/avatar` / GitHub 自助绑定 / 主管审核绑定 / 主管改他人姓名·部门·职位·头像）+ 工单 API（`/tickets` 页 + 列表/详情/新建/状态流转/评论/图片上传读取，注入 `window.__TICKETS__`；状态仅主管可切换）+ GitHub 绑定页 `/github-audit`（员工自助绑定 + 主管审核，注入 `window.__GHAUDIT__`）+ 头像读取 `GET /api/avatars/<file>` + 日志页 `/logs`（注入 `window.__LOGS__`，入口在账号设置侧栏）+ `GET /api/logs?kind=<ai\|web>&limit=N`（尾部读取，未登录 `/logs` 302、`/api/logs` 401）；权限判定 `canExecute` / `canApprove` / `canEditRequirement` / `filterReviewsByUser` / `canAccessTicket` / `filterTicketsByUser` / `isTicketStatus` / `safeRepoPath` / `decodePathSegment`；节点 02 后台跑 skill、节点 01 后台跑外部调研 agent、节点 03 后台跑评审链，`busy` 集合防并发；节点需求工单自动生成（`ensureNodeRequirementTicket`），节点面板返回 `ticketId` 可跳转工单系统 |
| `richtext.ts` | 富文本白名单净化 `sanitizeRichHtml()` / `isEmptyRichHtml()`：工单正文与评论来自 contenteditable，属不可信输入，落库与回显前必须过白名单（去 `<script>`/事件处理器/`javascript:`/外链图片），零依赖手写标签扫描器 |
| `imagefetch.ts` | 外链图片转存 `localizeExternalImages()`：正文里的 `http(s)` 图片在落库前由服务端下载到 `TICKET_IMAGES_DIR` 并把 `src` 改写成 `/api/tickets/images/<name>`（守住「正文只引用本平台图片」）；带 SSRF 防护（协议白名单 / 内网与回环地址拒绝 / 不跟随 302）、单张 ≤6MB、单次最多 10 张、8s 超时；下载失败把该 `<img>` 降级为可点链接。导出 `IMAGE_EXT_TYPES`（图片扩展名 → MIME，工单图片上传/读取共用） |
| `skill.ts` | skill 执行器：SKILL.md（剥 frontmatter）作系统提示 + 需求/附件组装 prompt → `callModel` 生成 Markdown 产物写入输出目录，进度经回调回写 db；不感知节点/权限 |
| `crawler.ts` | 节点 01 调研 agent 执行器：需求文本经 stdin 作 agent（`crawler.root` 项目内，命令 `crawler.command`）prompt → 跑完把 agent `output/` 目录打包 zip（零依赖 CRC32 + `zlib.deflateRawSync`，含 `collectFiles`）；不感知节点/权限 |
| `db.ts` | **数据访问唯一入口**（SQLite 实现，导出 API 与旧 JSON 版逐字兼容，调用方零改动）：`loadUsers` / `saveUsers`、`authenticate` 邮箱+密码校验、GitHub 绑定/待审核/资料修改（`setUserGithub` / `setUserGithubPending` / `clearUserGithubPending` / `approveUserGithub` / `setUserProfile`，`UserAccount` 含 `avatar` 字段）、管线（`loadPipelineName` / `savePipelineName` / `loadNodes` / `saveNodes`）、评审历史（`loadReviews` / `appendReview` / `appendReviews`）、工单（`loadTickets` / `saveTickets` / `appendTicket` / `updateTicket`）、AI 对话（`loadChats` / `saveChats` / `appendChat` / `updateChat` / `deleteChat`；`loadChatModels` / `saveChatModels` / `appendChatModel` / `updateChatModel` / `deleteChatModel` / `setActiveModel`）、账号投影表（`syncUserAccounts` / `loadChatAccounts` / `loadReviewAccounts`）；图片目录 `TICKET_IMAGES_DIR`、头像目录 `AVATARS_DIR`（二进制仍落盘，不入库）；首次取连接时把旧 `db/*.json` 一次性导入（按表分别写入主库 / `chat_reviews` / `tickets` 三库，`settings.migrated_from_json` 置位后不再执行）。**所有子库表 SQL 均带 schema 前缀**（如 `chat_reviews.reviews`、`tickets.tickets`、`nextOrd(c, "chat_reviews.chat_sessions")`） |
| `sqlite.ts` | SQLite 多库连接与建表：`getDb()` 单例（建目录 → 开主库 → `journal_mode=WAL` → `foreign_keys=ON` → `ATTACH` 两个子库 → 各库幂等 DDL）、`closeDb()`（子库随主连接一起关）；导出 `DB_DIR` / `DB_FILE`（`db/ai-flows.sqlite`）/ `CHAT_REVIEWS_DB_FILE` / `TICKETS_DB_FILE` 与 schema 名常量。建表分三份 DDL：主库 `settings` / `users` / `nodes` / `chat_accounts` / `review_accounts`，子库 `chat_reviews.*` 与 `tickets.*`。另含单库→多库一次性迁移 `migrateLegacyTables()`（主库里遗留的子库表整表搬到子库后 DROP，按主键 `OR REPLACE` 幂等）。**唯一**开库入口，其余模块不得自行 `new Database()`。账号投影表 `chat_accounts`（email+name）/ `review_accounts`（email+name+department）留在主库（跨库外键不可用），以 `email` 外键级联 `users`，由 `db.ts` 的 `syncUserAccounts()` 从 users 主表统一同步 |
| `auth.ts` | 内存会话 + cookie 签发/解析（`HttpOnly` `SameSite=Lax`，24h，重启即失效） |
| `log.ts` | 运行日志（零依赖）：JSON Lines 单行追加写 `logs/ai.log`（模型请求）+ `logs/web.log`（网页访问），超 1MB 轮转保留 500 行、坏行跳过；`recordAi()` / `recordWeb()` 落一条（只记元数据，错误经 `maskSecrets` 打码），`readLogTail()` 尾部读取、`readLogChunk()` 字节偏移增量跟读（轮转自动归零）、`shouldLogWeb()` 过滤静态资源与日志页轮询；`LOG_DIR` 基于 `import.meta.url` 定位仓库根 `logs/`，serve / platform / CLI 多进程共写。埋点方：`reviewer.callModel`（评审 / skill / 对话全覆盖）+ `platform.ts` 对话流式与记忆压缩 + `platform.ts` / `serve.ts` 的 `res.on("finish")` |
| `redact.ts` | `maskSecrets()`：评审产出前对 `summary` / `message` / `suggestion` 打码（密钥只留首尾各 4 位） |

约束：

| 规则 | 说明 |
|------|------|
| 相对导入必须带 `.js` 后缀 | `module: NodeNext` 的硬要求：源码文件是 `.ts`，导入路径写 `.js` |
| 运行时依赖仅 `better-sqlite3` | 唯一允许的运行时依赖是 `better-sqlite3`（原生 SQLite 绑定，要求 Node ≥22）；除它之外禁止新增 `dependencies`，能力用 `node:*` 与全局 `fetch` 自实现，不要引入 commander / zod / express / axios |
| 数据库唯一入口 | 开库建表只走 `src/sqlite.ts` 的 `getDb()`，数据读写只走 `src/db.ts` 的导出函数；禁止在其他模块 `new Database()` 或裸写 SQL。表结构变更须同步 `sqlite.ts` 的 DDL 与本文档 |
| 三个库 + ATTACH 跨库查询 | 主库 `db/ai-flows.sqlite` 开连接后 `ATTACH` 两个子库：`db/ai-chat-reviews.sqlite`（schema `chat_reviews`，放 `chat_sessions` / `chat_messages` / `chat_models` / `reviews`）与 `db/ai-tickets.sqlite`（schema `tickets`，放 `tickets` / `ticket_comments`）。`db.ts` 里凡涉及子库表的 SQL **必须带 schema 前缀**（含 `nextOrd()` 传的表名），主库表（`users` / `nodes` / `settings` / 两张投影表）不加前缀；跨库 JOIN 直接写全限定名即可。外键只在同库内生效，且 `REFERENCES` 的父表名**不能**带 schema 前缀（SQLite 不支持），省略后自动绑定同库同名父表 |
| 数据落库只走 db.ts | `platform.ts` 等调用方**不得**直接读 `db/*.json`；旧 JSON 只在 `db.ts` 首次导入时被读取一次，之后为只读种子 |
| users 是账号唯一主表 | 账号信息只在 `users` 表维护；`chat_accounts` / `review_accounts` 是它的投影表（`email` 主键 + 外键级联 `users.email`），由 `syncUserAccounts()` 统一同步。凡改动 `users` 的写入路径（`saveUsers` / `setUserProfile`）必须在写完后调用 `syncUserAccounts()`，不得只改一处导致投影表与主表漂移；投影表不得自持密码等敏感字段 |
| 退出码契约 | `0` 通过 / `1` 存在 blocker（拦截）/ `2` 推送失败。pre-push hook 依赖它拦截，改动会静默废掉门禁 |
| 用 `process.exitCode` | 不调用 `process.exit()`，以便 stdout 正常 flush |
| git 调用收敛 | 所有 git 命令走 `src/git.ts` 的 `git()`，禁止在别处 `spawn` git |
| 渲染只消费 `ReportView` | AI 原始 JSON 必须先经 `normalizeIssues` → `formatReport` 转成视图模型；渲染层不得感知模型原始结构 |
| HTML 插值必须转义 | AI 返回文本视为不可信输入，插入 HTML 的值一律走 `esc()` / `rich()`，禁止裸插值 |
| 路径穿越防护 | `/reports/<id>` 与 `/api/nodes/<id>/…` 的 id 必须用 `[^/\\]+` 限定；平台静态资源只走 `STATIC_FILES` 白名单精确匹配，禁止拼路径直读 `web/` |
| 凭据只从环境变量读 | 用 `model.apiKeyEnv` / `target.tokenEnv`；禁止把 apiKey、token 明文写进配置文件 |
| 降级逻辑不可绕过 | 变更行数超 `maxFileLines`（默认 500）的文件只保留最严重一条问题 |
| 评审规范从 config 注入 | 评审维度 / 团队规范不得硬编码在 `buildPrompt`，应经 `config` 注入 |
| 模型调用带退避重试 | 429 / 5xx 需指数退避重试，避免单个文件失败导致整批评审失败 |
| 确认提交需 commit message | `POST /reports/<id>/push` 必须带非空 `message`，否则 400；有暂存变更先 `commitStaged` 再 `pushToTargets`，杜绝评审通过即自动推送；无暂存且 `message` 与 HEAD 不同时先 `amendCommitMessage` 改写最近一次提交。页面提交栏展示 HEAD 提交描述并预填完整信息（serve 渲染时实时注入 `view.head`） |
| `run` 缺省不推送 | `run` 不带 `--push` 时一律不推送；推送只走页面「确认提交」或显式 `--push` |
| 平台权限唯一入口 | 节点执行/验收/需求编辑判定只用 `platform.ts` 的 `canExecute` / `canApprove` / `canEditRequirement`（员工限本部门、主管不限）；前端按钮显隐只是展示，服务端校验才算数，路由内不得另写权限逻辑 |
| 工单可见性唯一入口 | 工单查看 / 评论判定只用 `platform.ts` 的 `canAccessTicket`（员工限本部门、主管全量），列表过滤用 `filterTicketsByUser`；前端隐藏按钮只是展示，服务端校验才算数 |
| 工单状态仅主管可切换 | `POST /api/tickets/<id>/status` 在 `canAccessTicket` 之后额外校验 `canApprove`，员工 `403`；前端对非主管只渲染只读徽章 + 「（仅主管可切换）」提示 |
| 节点需求工单自动生成 | 每个管线节点必须挂一张 `kind="requirement"` 的需求工单（`ensureNodeRequirementTicket` 幂等建单），节点面板返回 `ticketId` 可跳转 `/tickets?id=`；执行 / 审核前先确保挂单 |
| 主管加执行人即建指派工单 | `POST /api/nodes/<id>/executors` 改员工部门到节点部门，并幂等创建 `kind="requirement"` + `assigneeEmail` 的指派工单（标题 `[执行] <step>`） |
| 富文本必须净化 | 工单正文与评论来自 contenteditable，落库前必须过 `src/richtext.ts` 的 `sanitizeRichHtml()`（去 `<script>` / `on*` 事件 / `javascript:` / 外链图片），只回显净化后 HTML，禁止信任前端提交的 HTML |
| 工单图片只认本地上传 | 正文图片 `src` 只允许 `/api/tickets/images/<file>`；文件名由服务端生成 `[a-f0-9]{12}.<ext>`，读取按该形态严格校验（天然免疫穿越）；二进制落 `db/ticket-uploads/`（已 gitignore），**不入库**（工单表只存文件名）。编辑器识别出的**外链图片**（工单正文 / 评论 / 知识库正文）在落库前由 `imagefetch.ts` 下载转存本地并改写 `src`，下载失败降级为可点链接——正文里始终不出现外链图片 |
| 富文本支持 Markdown 识别 | 工单 / 知识库共用的 `web/richtext-editor.js` 会识别轻量 Markdown：行首 `# `~`#### ` 即时转 `h1`~`h4`（字号写进 style，净化白名单已放行 `font-size` / `font-weight`）；整行图片链接或 `![alt](url)` 转 `<img>`；粘贴 Markdown 文本转 HTML（标题 / 图片 / 列表 / 引用 / 粗斜体 / 行内代码 / 链接）；保存前兜底再扫一遍。外链图片的转存由服务端负责（见上一条），前端只负责插 `<img>` |
| 头像只认本地上传 | 头像二进制落 `db/avatars/`（已 gitignore），users 表只存文件名；上传走 `POST /api/account/avatar`（自己改自己，限 png/jpg/jpeg/gif/webp、≤2MB）；读取 `GET /api/avatars/<file>` 文件名严格校验 `[a-f0-9]{12}.(png|jpg|jpeg|gif|webp)`；缺省回退首字配色头像 |
| GitHub 绑定独立页 | 员工自助绑定 / 主管审核统一在 `/github-audit`（`web/github-audit.html` + `web/github-audit.js`）；`account.html` 只展示 GitHub 绑定状态只读，操作引导到 `/github-audit`；`team.html` 不再承载 GitHub 审核，只做成员资料管理 |
| 顶栏导航方形圆角 | 顶栏 `.nav-link` / `.tab` 统一 `border-radius:8px`（方形圆角，非椭圆 999px）；所有页面右上角统一展示 `user-chip`（头像 + 姓名），有自定义头像显示图片，否则首字配色 |
| 顶栏用户菜单 | 顶栏 `user-chip` 为可点开菜单（`web/user-menu.js` 共享脚本 + `ai-pipeline.css` 的 `.user-menu`/`.user-panel`）：面板上部为放大的头像 + 姓名 + 邮箱，分隔线下为「设置」项（→ `/account`）；原顶栏「账号管理」导航项已收纳进该面板，各页脚本只管 `#userName` 与 chip 头像 |
| 账号与密码 | 账号唯一来源 SQLite `users` 表（种子仍由 `db/users.json` 首次导入），**不开放注册**；演示期密码明文 123456，上线前必须换 `node:crypto` scrypt 加盐哈希 |
| 部门与账号数据 | 平台账号分三大部门：`用户研究部` / `程序中台` / `平台运营部`；节点 01/02 属用户研究、03 属程序中台、04 属运营，账号 `department` 与节点 `department` 需对齐（`canExecute`/角色卡片按它过滤） |
| GitHub 自助绑定 + 主管审核 | 主管绑定即刻写入 `github`；员工绑定写 `githubPending`，主管经 `/api/account/<email>/github/{approve,reject}` 批准后转 `github` 才生效；员工可自行取消待审或解绑已生效绑定 |
| 资料主管可改 | 设置任意账号的姓名 / 部门 / 职位只走 `POST /api/account/<email>/profile`，仅主管（`canApprove`）可调；员工只能绑自己的 GitHub，不能改任何账号资料。路径里的 email 必须经 `decodePathSegment()` 还原（前端会编码成 `%40`），解码后含 `/` `\` 一律按不存在处理 |
| 头像上传体积 | `POST /api/account/avatar` 收 base64 data URL，请求体上限 `AVATAR_BODY_MAX`（4MB，覆盖 2MB 图的 base64 膨胀）；用默认 16KB 上限会拒掉真实图片 |
| 角色卡片排版 | 节点详情「执行角色」卡片统一长方形：左头像 + 右侧加粗姓名 + 下方「部门/职位」（如 用户研究部 / 用户研究实习生）；账号管理弹窗在顶栏「账号管理」按钮打开 |
| 会话与 cookie | 内存 `Map` 会话 + `HttpOnly` `SameSite=Lax` cookie；服务重启全部失效（演示可接受，会话不写库、不引 Redis） |
| 对话记忆压缩 | AI 对话按账号隔离（`ChatSession.ownerEmail`）；未纳入摘要的历史原文累计字数超 `chat.compressChars`（默认 400）时，用 `callModelOnce` + `buildSummaryMessages` 把旧摘要与新原文合并压缩为 `session.summary` 落库（`summaryUpto` 记已覆盖条数）；此后 prompt 只送【摘要 + 未压缩近期原文】。压缩失败不阻断对话 |
| 节点状态机 | `todo → running → in_review → done` 四态；执行完成保持 `running` 等 `submit`，`submit` 进 `in_review`，仅主管可 `approve`（→ `done` 终态）/ `reject`（→ `running` 附意见）；状态不符的动作返回 409；服务启动把残留 `running` 复位为 `todo`、旧 `approved` 迁移为 `done` |
| 节点异步执行 | `runner=ai-review` / `runner=skill:<name>` 先落 `running` 并立即响应，后台跑完（skill 走 `src/skill.ts`）回写 `lastResult` / `progress` / 产物（回写前重读库，避免覆盖期间其他节点变更）；执行完成保持 `running` 等提交验收 |
| 注入 bootstrap 必须转义 | `window.__PIPELINE__` 注入用 `jsonForScript()`（转义 `<`）；节点顺序与 `web/ai-pipeline-app.js` 的 `data-idx` 一一对应，改注入结构必须同步该脚本 |
| 评审记录按视角过滤 | `GET /api/reviews` 只用 `filterReviewsByUser`（主管全量 / 员工限本部门）；外部触发（hook/手动 run）报告无账号归属，统一归到节点 03 部门「程序中台」；平台触发记录写 SQLite `reviews` 表 |
| 调研 agent 产物为 zip | 节点 01（`runner: research-crawler`）需求文本经 `stdin` 传 agent（不拼命令行）；agent 在 `crawler.root` 项目内跑完，打包其 `output/` 为 zip 落节点 `outputDir`（`safeRepoPath` 校验），不产出 Markdown；需求为空 / 未配 `crawler.root` / 目录不存在一律 400 |
| 运行日志只记元数据 | 日志不落 prompt 与回复正文，只记来源 / 模型 / 耗时 / 字数 / 状态；AI 错误经 `maskSecrets` 打码；`appendLog` 写失败静默——日志不得影响主流程 |

### ESM 相对导入

```ts
// ✅ 正确：源码文件是 .ts，但导入路径写 .js
import { loadConfig, type ReviewConfig } from "./config.js";

// ❌ 错误：NodeNext 下无法解析
import { loadConfig } from "./config";
import { loadConfig } from "./config.ts";
```

### 退出码契约

```ts
// ✅ 通过 process.exitCode 表达结果，main() 在 catch 里兜底设 1
process.exitCode = await run(cfg, { push, reportOut, page });

// ❌ 禁止：process.exit(1) 会截断 stdout，且绕过统一错误处理
if (!gate.passed) process.exit(1);
```

### 渲染契约

```ts
// ✅ AI JSON → ReviewResult → formatReport → ReportView → renderTemplate
const view = buildReportView(result, files, gate, pushes, { ref });
writeFileSync(join(dir, `${id}.json`), JSON.stringify(view, null, 2));

// ❌ 禁止：把模型原始 JSON 直接丢给模板/落盘，跳过视图模型
res.end(renderTemplate(JSON.parse(modelRawText)));
```

## 代码风格

| 类型 | 约定 | 示例 |
|------|------|------|
| 文件名 | 全小写单词，一个关注点一个文件 | `collector.ts`（不是 `diffCollector.ts`） |
| 接口 | PascalCase，对象形状用 `interface` 并导出 | `interface ReviewConfig`、`interface DiffFile` |
| 联合类型 | 用 `type` + 字符串字面量，**禁止 `enum`** | `type Severity = "blocker" \| "warning" \| "info"` |
| 函数 / 变量 | camelCase | `collectDiff`、`changedLines` |
| 常量 | UPPER_SNAKE_CASE | `REPORTS_DIR`、`DEFAULT_CONFIG_PATH`、`RED` |
| 导出 | 全部具名导出，**不用 `export default`** | `export function decideGate(...)` |
| 注释 / 文案 | 中文；导出函数写 `/** */` JSDoc，字段逐个注释 | `/** 命中这些 severity 视为阻塞合并 */` |
| `any` | 仅允许在不可信数据解析边界 | 模型返回 `data: any`、`catch (err: any)`；内部逻辑不得用 |

导入顺序：`node:*` 内置模块 → 相对模块（带 `.js`）→ 类型导入，类型用内联 `type` 修饰符。

```ts
// ✅ 正确的文件头形态（见 src/index.ts）
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadConfig, type ReviewConfig } from "./config.js";
import { pushToTargets, type PushResult } from "./publisher.js";

// ❌ 混排、漏 .js、默认导出
import { loadConfig } from "./config";
export default function main() {}
```

格式：2 空格缩进、双引号、语句末尾分号、行宽约 100 列。**未配置 formatter**，靠人工保持一致——不要引入 Prettier/ESLint，也不要整体重排既有代码。

## 测试

| 项 | 约定 |
|----|------|
| 框架 | `node:test` + `node:assert`（零依赖，**禁止引入 vitest / jest**） |
| 运行 | `npx tsx --test "src/**/*.test.ts"` |
| 位置 | 与被测模块同目录：`src/<module>.test.ts` |
| 命名 | `test("should <预期> when <条件>", ...)` |

必须覆盖的纯函数（改动它们时必须补测试）：

| 模块 | 函数 | 关注点 |
|------|------|--------|
| `gate.ts` | `decideGate` | 命中 `severityBlocked` 即不通过；warning/info 只提示 |
| `collector.ts` | `globToRegExp` / `isExcluded` | `*` `**` `?` 转义；`dist/` 前缀匹配 |
| `reviewer.ts` | `extractJson` | 带围栏、带前后缀文字、非法 JSON 抛错 |
| `publisher.ts` | `injectToken` | https 注入、已有凭据剥离、ssh 地址不动 |
| `serve.ts` | `/reports/<id>` 路由 | `../` 等路径穿越必须 404 |
| `platform.ts` | `canExecute` / `canApprove` / `canEditRequirement` / `filterReviewsByUser` / `canAccessTicket` / `filterTicketsByUser` / `isTicketStatus` / `collectTicketImages` / `safeRepoPath` / `decodePathSegment` / `ensureNodeRequirementTicket` / `htmlToPlainText` | 员工限本部门、主管全节点可执行；员工不可批准；需求编辑同执行权限；评审记录主管全量、员工本部门；工单主管全量、员工本部门；状态取值白名单；正文图片引用去重提取；目录穿越拦截；路径段 URL 解码并拒绝含分隔符、非法编码；节点需求工单幂等建单（缺则补齐）；HTML 转 纯文本用于工单搜索 |
| `richtext.ts` | `sanitizeRichHtml` / `isEmptyRichHtml` | 保留编辑器产出的白名单标签与属性；去 `<script>`/事件处理器/`javascript:`/外链图片；未知标签丢标签留文本；裸 `<` `&` 转义；纯标签空正文判空 |
| `imagefetch.ts` | `isBlockedHost` / `pickExt` / `localizeExternalImages` | 内网/回环/IPv6 字面量一律拦截、公网放行；MIME 优先、路径兜底推断扩展名；无外链图片时原样返回；外链指向内网时降级为可点链接 |
| `skill.ts` | `sanitizeFilename` / `buildSkillPrompt` / `resolveSkillDoc` | 文件名净化；含/不含附件的 prompt 组装；未知 skill 抛错 |
| `crawler.ts` | `crc32` / `buildZip` / `collectFiles` | CRC32 标准校验值；zip 经 `inflateRawSync` 往返一致、空条目归档合法；目录递归条目名为 posix 相对路径 |
| `log.ts` | `parseLine` / `formatEntry` / `shouldLogWeb` / `formatLogLine` | JSON 行往返一致、换行转义、坏行/空行容错；静态资源与日志页轮询过滤；ai（成功/失败）与 web 展示行格式 |

不要求覆盖：`index.ts` 的 CLI 编排、HTTP 服务生命周期、真实模型调用（涉及网络与凭据）。
SQLite 数据层（`sqlite.ts` / `db.ts`）也不写自动化单测——依赖真实库文件；用手工往返验证：删掉三个 `db/*.sqlite`（含 `-wal` / `-shm`）→ 调 `getDb()` 建三库并导入旧 JSON → 增删改查各域（含跨库 JOIN）→ `closeDb()`，并核对各库表行数与 `db/*.json` 源数据一致；已有单库升级场景则保留旧 `db/ai-flows.sqlite` 直接启动，核对 `migrateLegacyTables()` 把子库表搬走且主库不再残留。
端到端回归用手工三档用例（info / warning / blocker）验证，方法见 `评审链路与说明.md` §3。

## 配置层级

配置文件解析优先级（`src/config.ts` `loadConfig`）：

```
CLI --config <path>  >  环境变量 AI_REVIEW_CONFIG  >  默认 ./ai-review.config.json
```

模型凭据解析优先级（`resolveApiKey`）：`model.apiKey`（不推荐明文）> `model.apiKeyEnv` 指向的环境变量。

`loadConfig` 兜底默认值：`severityBlocked=["blocker"]`、`targets=[]`、`diff.scope="staged"`、`diff.exclude=[]`、`diff.maxFileLines=500`、`reviews.scanRoots=["."]`、`crawler.command="claude"`、`crawler.args=["-p","--permission-mode","bypassPermissions"]`、`crawler.outputDir="output"`、`crawler.timeoutMs=600000`、`chat.maxHistory=50`、`chat.maxTokens=2000`、`chat.temperature=0.7`、`chat.compressChars=400`。新增配置项时**必须同时更新** `config.example.json` 与 `loadConfig` 默认值。

节点 01 的调研 agent 配置读**平台自身** `ai-review.config.json` 的 `crawler` 段（`root` 为 agent 项目根，缺省空即拒绝执行）；产物是 agent `output/` 目录打包的 zip，落在节点 `outputDir`（须在目标仓库内，经 `safeRepoPath` 校验），不再产出 Markdown。

平台节点 03 的评审配置随**目标仓库**走（`<repo>/ai-review.config.json`），与其 pre-push hook 行为一致；平台自身不存额外配置，端口用 `AI_FLOWS_PORT` 覆盖。

---

**红线：** ESM 相对导入必带 `.js` · 运行时依赖仅 `better-sqlite3` · 退出码 0/1/2 契约不可改 · 渲染层只认 `ReportView` · HTML 插值一律走 `esc()` · 凭据只从环境变量读 · 确认提交必须带非空 commit message · `run` 缺省不推送 · 平台权限只走 `canExecute`/`canApprove` · 注入 bootstrap 必须转义 · 演示密码 123456 不得原样上线
