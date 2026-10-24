# AI-FLOWS 公司平台化 Plan

> 把 ai-review 从"单一代码评审 CLI"包装成公司级 AI 管线平台：一条直线串起四大业务部门节点，员工按角色执行/查看工作流，部门主管操控并批准所有节点。
> 本文是规划文档，实施时逐条对齐。

## 1. 目标

1. 管线页面：一条直线，四个部门节点（产品调研 → AI产品 → 程序中台 → 产品运营），悬停展示各环节流程。
2. 环节能力：产品调研（调用自研 Skill，先留空）、产品策划案（先留空）、AI 代码评审（沿用现有 ai-review 管线）、运营（先留空）。
3. 平台化：做成公司内网平台，账号入库、登录、角色分权。

## 2. 现状与边界

| 项 | 现状 |
|---|---|
| 管线页面 | 已落地 `web/ai-pipeline.html`，纯静态、悬停详情、可浏览器直接打开 |
| 评审能力 | `ai-review` CLI 已具备：diff 采集 → LLM 评审 → 门禁 → 报告 → 推送 |
| 平台骨架 | `src/serve.ts` 已有报告 HTTP 服务（`node:http`），可扩展 |
| 零依赖红线 | 平台化不引入 express/mongodb 等；数据层用 JSON 文件 + `node:*` 自实现 |

## 3. 方向：为什么静态页先行

用户已确认：**部门为节点的直线流程** + **独立静态页面落地**。后续平台化时，把 `web/ai-pipeline.html` 的视图层提为模板，由 HTTP 服务渲染并注入账号/权限数据。

## 4. 账号体系（先写进 db，不开放注册）

- **db 形式**：`db/users.json`（零依赖），结构见 §7。
- **账号名**：邮箱，名字拼音 + `@ai-flows.com`（虚拟后缀）。

### 4.1 账号清单（待与用户确认姓名拼音）

| # | 邮箱 | 密码 | 身份 | 岗位 | 归属部门节点 | 姓名
|---|---|---|---|---|---|
| 1 | zhangli@ai-flows.com | 123456 | 主管 | 产品部门主管 | 全部节点（操控+批准） | 张丽 |
| 2 | wangxinyi@ai-flows.com | 123456 | 员工 | 用户调研实习生 | 产品调研 | 王鑫易 |
| 3 | lixiang@ai-flows.com | 123456 | 员工 | 前端开发设计师 | 程序中台（AI 代码评审） | 李翔 |
| 4 | chenyu@ai-flows.com | 123456 | 员工 | AI 产品实习生 | AI产品（产品策划案） | 陈宇  |
| 5 | liuyang@ai-flows.com | 123456 | 员工 | 初级产品运营 | 产品运营 | 刘阳 |
| 6 | liyun@ai-flows.com | 123456 | 员工 | 用户调研实习生 | 产品调研 | 李云 |

> 姓名为真实姓名，`db/users.json` 每个账号带 `name` 字段（角色卡片显示用）。密码统一 123456（演示环境明文存 JSON；上线前加盐哈希）。

## 5. 角色与权限矩阵

| 能力 | 员工 | 部门主管 |
|---|---|---|
| 查看管线全流程 | ✅ | ✅ |
| 编辑本节点需求文本 / 上传附件 | ✅（限本部门） | ✅ |
| 执行本部门节点（触发工作流 / skill） | ✅（限本部门） | ✅ |
| 提交验收（执行中 → 待验收） | ✅（限本部门） | ✅ |
| 通过验收 / 驳回（待验收 → 已执行 / 执行中） | ❌ | ✅（全部节点） |
| 操控停用/启用节点 | ❌ | ✅（权限最高） |
| 提交 bug 单 | ✅ | ✅ |
| 查看 / 流转状态 / 评论工单 | ✅（限本部门） | ✅（全部部门） |
| 指派工单负责人 | ✅（可见范围内） | ✅ |
| 查看 / 删除节点执行角色 | ❌ | ✅（全部节点） |
| 撰写 / 编辑知识库文章 | ✅（自己的；主管可改全部） | ✅ |
| 查看知识库文章 | ✅（按撰写人设定的可见范围：全体 / 指定部门 / 仅自己） | ✅（全量） |
| 查看本人消息（未读小红点） | ✅（仅本人） | ✅（仅本人） |

> 判定只走 `platform.ts` 的 `canExecute` / `canApprove` / `canEditRequirement`；工单可见与操作判定走 `canAccessTicket` / `filterTicketsByUser`；知识库可见与编辑判定走 `canViewKb` / `filterKbByUser`；前端按钮显隐仅是展示。

## 6. 管线节点模型

| 节点 | 部门 | 环节 | runner | 状态 | 说明 |
|---|---|---|---|---|---|
| 01 | 产品调研 | 产品调研 | `research-crawler` | 已接入 | 需求文字直接作 prompt → 调外部调研 agent（Research-Crawler，`crawler.root` 配置）跑 skill；产物为 agent `output/` 目录打包的 zip（不再产出 md） |
| 02 | AI产品 | 产品策划案 | `skill:product-manager` | 已接入 | 需求文字 + 附件 → LLM 生成产品规划 |
| 03 | 程序中台 | AI 代码评审 | `ai-review` | 已就绪 | 接现有 ai-review 管线（统一四态，执行完成保持执行中待提交） |
| 04 | 产品运营 | 运营 | — | 留空待接入 | — |

节点状态四态：`todo（待执行）→ running（执行中）→ in_review（待验收）→ done（已执行）`；主管驳回 `in_review → running`（附意见）；`done` 为终态（重复执行 409）；服务启动把残留 `running` 复位为 `todo`。

## 7. 技术方案

### 7.1 目录规划

```
ai-flows/
├── web/
│   ├── ai-pipeline.html      # DONE：管线静态页（平台态由 platform 服务注入 bootstrap）
│   ├── ai-pipeline.css       # DONE：管线页样式（纸灰 + 玻璃 + LED 风）
│   ├── ai-pipeline-app.js    # DONE：平台增强脚本（登录态 + 执行/批准按钮，静态预览不生效）
│   ├── tickets.html          # DONE：工单（bug 单）静态页（左列表 + 右详情/编辑器）
│   ├── tickets.js            # DONE：工单页脚本（富文本编辑器 + 筛选 + 状态流转 + 评论）
│   ├── github-audit.html     # DONE：GitHub 绑定管理页（员工自助 + 主管审核）
│   ├── github-audit.js       # DONE：GitHub 绑定页脚本
│   ├── login.html            # DONE：登录页
│   └── login.css             # DONE：登录页样式
├── db/
│   ├── users.json            # DONE：账号库（6 个种子账号，不开放注册）
│   ├── pipeline.json         # DONE：节点运行时状态（执行/批准写回）
│   ├── tickets.json          # DONE：工单库（提交/状态/评论写回）
│   └── ticket-uploads/       # 工单图片（gitignore，运行时创建）
└── src/
    ├── db.ts                 # DONE：账号/节点/工单读写 + authenticate（JSON + node:fs）
    ├── auth.ts               # DONE：内存会话 + cookie（HttpOnly，24h）
    ├── platform.ts           # DONE：平台 HTTP 服务（路由 + 权限 + 注入渲染）
    ├── richtext.ts           # DONE：富文本白名单净化（工单正文/评论防 XSS）
    ├── skill.ts              # DONE：skill 执行器（SKILL.md 作系统提示 → LLM 生成 → 产物落盘 + 进度回调）
    └── index.ts              # DONE：新增 platform 子命令
```

### 7.2 实施步骤

1. **P0 静态页**（已完成）：`web/ai-pipeline.html` 预览确认。
2. **P1 账号入库**（已完成）：`db/users.json` 6 个账号 + `db/pipeline.json` 节点状态 + `src/db.ts`。
3. **P2 登录**（已完成）：`login.html` + `POST /api/login`（邮箱+密码，会话 cookie）；零依赖，密码暂明文。
4. **P3 角色渲染**（已完成）：`GET /pipeline` 注入 `window.__PIPELINE__`（用户 + 节点权限）；员工仅本部门可执行，主管有批准按钮。
5. **P4 节点动作**（已完成）：`POST /api/nodes/:id/execute|approve`；员工限本部门、主管全节点，待接入节点拒绝执行；状态落 `db/pipeline.json`。
6. **P5 接能力**（已完成）：节点 03（`runner: ai-review`）执行时在目标仓库（`--repo` 指定，缺省平台启动目录）真正触发 ai-review 评审链：状态 `todo → running → done`（失败回 `todo` 并记录原因），评审配置随目标仓库的 `ai-review.config.json`；完成后详情面板展示门禁结果与「查看评审报告」链接（报告服务复用 4310 端口自动拉起，前端 2s 轮询刷新）；空 diff / 非仓库等异常回滚并提示。节点 01/02/04 按用户后续 Skill 接入。
7. **P6 服务整合**（已完成）：`ai-review platform [--port 4311] [--repo <path>]` 子命令，走 `dist/` 构建产物；冒烟测试 22 项全过（登录/权限/执行/批准/穿越防护），P5 后另做真实评审端到端验证（执行 → LLM 评审 → 报告页 200）。
8. **P7 角色卡片 + 四态工作流 + Skill 接入**（已完成）：状态机改四态 `todo → running → in_review → done`（新增 `submit`/`reject` 动作；approve/reject 非 `in_review` 返回 409；旧 `approved` 启动自动迁移为 `done`）；详情面板角色卡片（首字头像按邮箱哈希 6 色取色 + 悬停浮层显示姓名/岗位）；节点 01/02 接入 `.agents` 自研 skill（SKILL.md 剥 frontmatter 作系统提示 → 平台内 LLM 生成 Markdown 产物，写入用户经目录弹窗选定的输出目录，进度 10/35/70/95/100 回写 db，产物可下载）；节点 01 另有「需求分析」按钮（`product-analysis` skill）；需求文字编辑 + 附件上传 + busy 并发防护。设计详见 `docs/superpowers/specs/2026-09-24-character-skill-design.md`。
9. **P8 评审记录跨仓库聚合 + 报告页改造**（已完成）：`ai-review.config.json` 新增 `reviews.scanRoots`（默认 `["."]`）+ `reviews.gitHubTokenEnv`（默认 `GH_TOKEN`）；`collectExternalReviews` 改递归遍历 scanRoots（限 3 层深度，跳过 `.git`/`node_modules`/`dist` 等），跨仓库报告带 `repo` 字段标记来源仓库名；`reportUrl` 仅在报告 JSON 存在于平台当前仓库时回填（跨仓库报告留空，详情面板显示来源仓库标签）；启动时加载平台自身配置的 scanRoots（加载失败回退到只扫本仓库）。报告页布局重排：左侧新建「仓库面板」（上半仓库目录树 + 中变更文件目录 + 下问题列表，整面板可折叠为窄条）；目录树数据源 auto fallback：优先 GitHub Trees API（`git remote get-url origin` 解析 owner/repo + `GET /repos/{o}/{r}/git/trees/{branch}?recursive=1`，token 从环境变量读，零依赖走全局 `fetch`），失败回退 `node:fs` 本地递归；问题列表精简为一行（severity + 条例 ID + 行号区间），完整内容通过 `<script type="application/json" id="issueStore">` 注入；点击问题项 → 在 diff 区间末尾行后展开堆叠菜单（含完整错误 + 修复建议，同区间多问题堆叠）+ 高亮区间按 severity 配色（blocker 红 / warning 琥珀 / info 青绿，遵守禁蓝色约束）。

10. **P9 节点 01 改接外部调研 agent**（已完成）：`ai-review.config.json` 新增 `crawler` 段（`root` 调研 agent 项目根 / `command` 缺省 `claude` / `args` / `outputDir` 缺省 `output` / `timeoutMs`）；节点 01 runner 由 `skill:research-crawler` 改为 `research-crawler`，执行时把「调研需求内容」文本经 stdin 直接作为 agent prompt，在该项目内跑完 skill 后把 `output/` 整目录打包为 zip（`src/crawler.ts` 零依赖 zip：CRC32 + `zlib.deflateRawSync`）落盘到节点输出目录，作为可下载产物；不再产出 Markdown，节点 01 的「需求分析」（`product-analysis`）按钮同步移除。

11. **P10 工单平台 · bug 单页**（已完成）：挂现有 platform 服务（`GET /tickets`，页面 `web/tickets.html` + `web/tickets.js`，顶栏各页统一补「工单」入口）。每个登录用户在页面内有独立富文本编辑器（`contenteditable` + `execCommand` 工具栏：加粗/斜体/下划线/删除线、字号、无序/有序列表、引用、插入图片、清除格式；粘贴统一转纯文本）。数据落 `db/tickets.json`（`src/db.ts` 新增 `loadTickets`/`appendTicket`/`updateTicket`），提交人 `department` 即可见范围判据：本部门员工 + 主管（`canAccessTicket` / `filterTicketsByUser`，与服务端校验双保险，路由内不另写权限）。工单三态 `open（待处理）/ doing（处理中）/ resolved（已解决）` 可互相流转；评论与正文同权、按部门可见。接口：`GET/POST /api/tickets`、`GET /api/tickets/<id>`、`POST /api/tickets/<id>/status`、`POST /api/tickets/<id>/comments`、`POST /api/tickets/upload`、`GET /api/tickets/images/<file>`。富文本一律经 `src/richtext.ts` 的 `sanitizeRichHtml` 白名单净化后才落库并回显（`<script>`/事件处理器/`javascript:`/外链图片全丢）；图片按 base64 上传，服务端生成 `[a-f0-9]{12}.<ext>` 文件名落 `db/ticket-uploads/`（已 gitignore），正文只存 `/api/tickets/images/<file>` 引用，图片读取按文件名严格校验防穿越。列表页支持状态分段筛选 + 关键词搜索 + 「只看我提交的」。冒烟 25 项全过（净化、可见性、跨部门 403、状态/评论、图片上传与读取、未登录 401/302、路径穿越 404）。

12. **P11 账号头像 + GitHub 独立页 + 顶栏统一**（已完成）：`UserAccount` 新增 `avatar` 字段，二进制落 `db/avatars/`（gitignore），`users.json` 只存文件名。账号管理页（`account.html`）头像可点击上传，前端 canvas 居中裁剪为正方形 + 滑块缩放 + 圆形预览，确认后 `POST /api/account/avatar`（限 png/jpg/jpeg/gif/webp、≤2MB）上传，`GET /api/avatars/<file>` 读取（文件名严格校验 `[a-f0-9]{12}.<ext>` 防穿越）；缺省回退首字配色头像。GitHub 绑定管理从 `account.html`（操作）+ `team.html`（审核）拆出独立页 `/github-audit`（`web/github-audit.html` + `web/github-audit.js`）：员工区自助绑定/解绑/取消待审，主管区待审核列表 + 成员 GitHub 一览；`account.html` 只展示 GitHub 状态只读并引导到 `/github-audit`，`team.html` 移除 GitHub 审核卡只保留成员资料管理。顶栏统一：`.nav-link` / `.tab` 由椭圆 `999px` 改为方形圆角 `8px`；所有页面（管线/工单/账号/团队/GitHub）右上角统一展示 `user-chip`（自定义头像图片或首字配色 + 姓名）+ 退出按钮。团队页部门下拉 `.edit-select` 统一自定义箭头 + `border-radius:8px`，与 `.edit-input` 风格一致。冒烟 15 项全过（页面渲染、头像上传/读取/穿越拦截、未登录 302、员工 team 403）。

13. **P12 消息中心 + 工单负责人 + 编辑器增强 + 知识库**（已完成）：主库新增 `messages` 表（`email` 收件人 + `type` + `refType`/`refId` 跳转 + `read_at`），`src/db.ts` 增 `loadPlatformMessages` / `appendPlatformMessage` / `markMessageRead` / `markAllMessagesRead`；全站顶栏在 `user-chip` 左侧挂消息铃铛（未读小红点，读 `GET /api/messages/unread`，逻辑收在共享 `web/user-menu.js`），独立消息页 `/messages`（`web/messages.html` + `web/messages.js`，`GET /api/messages` 列表 + `POST /api/messages/<id>/read` 单条已读 + `POST /api/messages/read-all` 全部已读）。工单新增「负责人」`assigneeEmail`（`POST /api/tickets/<id>/assignee`，仅主管可指派）：指派 / 改派给被指派人投递消息（未读 +1，`ticket_assign`）；工单挂管线节点（`nodeId`）时负责人自动挂进该节点执行角色，主管「+」加执行人则反向自动建指派工单（`[执行] <step>`）并投递消息。节点执行角色支持移除：鼠标移到角色头像上侧边展开「删除」按钮（仅主管，`DELETE /api/nodes/<id>/executors/<email>`，删后通知本人）；修复员工个人主页顶栏头像信息为空。工单评论区改纯文本（不加载富文本编辑器）；@提及渲染为「头像 + 名字」胶囊，悬停弹出用户卡片（共享 `web/user-card.js`，工单 / 知识库页复用）。富文本编辑器增强（`web/richtext-editor.js`）：修复字号下拉不生效（`execCommand fontSize=7` 打标后替换为 `span[style=font-size:Npx]`）、插入图片可设尺寸（25/50/75/100% 或自定义 px）+ 右下角拖拽缩放手柄 + 文字环绕（左/右/居中/不环绕），`src/richtext.ts` 白名单同步放行。新增知识库：主库 `kb_articles` 表（`title` / `content` / `author_*` / `visibility` / `departments` / `updated_by_*`）+ `/kb` 独立页（`web/kb.html` + `web/kb.js`，撰写 / 编辑，无工单状态机）；可见范围三档 `all（全体）/ departments（指定部门）/ private（仅自己）`，判定走 `canViewKb` / `filterKbByUser`（主管全量、作者全权），写入校验走 `isKbVisibility` + `normalizeDepartments`（必须命中平台已知部门）；`GET/POST /api/kb`、`GET/PUT /api/kb/<id>`；工单 / 知识库编辑器工具条新增「知识库」按钮，插入 `data-kb-id` 链接（白名单放行），渲染为知识卡片（知识库名 + 撰写人 + 最近更新时间 + 更新人）；首页 / 全局搜索接入 `type=kb`。冒烟全过（页面渲染 / 可见性过滤 / 越权 403 与 404 / 部门校验 400 / 搜索 / 导航）。

14. **P13 运行日志 + 启动脚本多窗口**（已完成）：新增 `src/log.ts` 统一日志模块（零依赖）：`logs/ai.log`（模型请求）+ `logs/web.log`（网页访问）两本，JSON Lines 单行格式 `appendFileSync` 追加、超 1MB 轮转保留最后 500 行、坏行跳过；`LOG_DIR` 基于 `import.meta.url` 定位仓库根 `logs/`（src / dist 一致），serve / platform / CLI 多进程共写同一文件。埋点两类：① AI 请求日志在底层 `reviewer.callModel` 统一记录（评审 / skill / 对话全覆盖），字段含来源 `review|chat|skill`、模型、触发对象、耗时、成功与否、提示与回复字数、错误（经 `maskSecrets` 打码），不落 prompt 正文；对话侧流式每轮 + 记忆压缩各记一条（提示字数经纯函数 `countPromptChars` 只算文本段，多模态图片不计）。② 网页访问日志在 `platform.ts` / `serve.ts` 的 `res.on("finish")` 记录方法 / 路径 / 状态码 / 耗时 / 登录邮箱，`shouldLogWeb` 过滤静态资源与日志页自身轮询。CLI 新增 `logs` 子命令（`--kind ai|web|all`、`--lines N`、`--follow` 按字节偏移增量跟读，轮转自动归零）。平台新增 `/logs` 页（`web/logs.html` + `web/logs.js`：AI 请求 / 网页访问两档切换 + 自动刷新，仅登录可见，入口挂账号设置侧栏）+ `GET /api/logs?kind=&limit=`（尾部读取 + 解析容错）。`start-platform.bat` 重写为一键起 4 个进程：评审服务 4310 / 管线平台 4311（两个可见窗口）+ AI 请求日志跟读 / 网页访问日志跟读（隐性窗口 `start /B` 后台运行、不弹窗，输出丢空设备，日志统一在平台 `/logs` 页看）（退出按窗口标题 taskkill + 端口兜底 + 按命令行特征 PowerShell 兜底清理）；`logs/` 已 gitignore。冒烟全过（tsc 类型检查 / 单测 78 项 / 未登录 `/logs` 302、`/api/logs` 401 / 登录后日志页与接口 / CLI 三种 kind / 启动脚本试跑（2 可见窗口 + 2 隐性日志进程）+ quit 后无残留）。

15. **P14 Token 面板**（已完成）：主库新增 `token_usage` 表（`email` / `source` / `model` / `prompt_tokens` / `completion_tokens` / `total_tokens` / `at`，按 `at` 与 `email` 建索引；故意不加外键——`saveUsers` 整表替换会级联清空用量，归属人靠 email 逻辑匹配，外部触发无账号时为空串），`src/db.ts` 增 `TokenUsageRecord` / `appendTokenUsage` / `recordTokenUsage`（自带 id 与 `localIso()` 时间戳、写失败静默）/ `loadTokenUsage`。用量只取模型接口回传的真实 `usage`（不按字符数估算），写入点三处：`reviewer.callModel`（评审 / skill，`opts.email` 归属）+ 平台对话流式轮次（`chunk.type === "usage"`）与记忆压缩（`callModelOnce` 的 `onUsage` 回调）。平台新增 Token 面板页 `/tokens`（`web/tokens.html` + `web/tokens.js`，注入 `window.__TOKENS__`，入口挂账号设置侧栏，与「账号管理」「日志」并列）+ `GET /api/tokens`（员工只回本人 `me` 且 `scope=self`、`team` 为空；主管回 `me` + 全员 `team`（`scope=team`），无归属记录单列「外部触发 / 程序中台」）。聚合口径走纯函数 `platform.ts` 的 `summarizeTokenUsage`：今天按本地日历日、近 7 天 / 近 30 天为滚动窗口、另附累计，非法时间戳只计累计。页面展示 4 张统计卡（今天 / 近 7 天 / 近 30 天 / 累计）+ 主管可见的团队表（成员 / 占比条 / 各时段 / 累计）。冒烟全过（tsc 类型检查 / 单测 88 项含新增 2 项 `summarizeTokenUsage` 用例 / 未登录 `/tokens` 302、`/api/tokens` 401 / 主管 `scope=team` 全员列表 / 员工 `scope=self` 且 team 为空 / 页面 HTML 注入与静态白名单）。

## 8. 待确认事项（实施时已按默认处理）

- [x] 6 个账号姓名：已确认为真实姓名（张丽/王鑫易/李翔/陈宇/刘阳/李云），`db/users.json` 每个账号带 `name` 字段
- [x] 主管不区分部门：`supervisor` 角色直接放开全部节点的操控+批准（权限最高）
- [x] 密码演示期明文存 JSON（统一 123456），上线前再换 `node:crypto` scrypt
- [x] 平台入口：独立子命令 `platform` + 独立端口 4311，不与 `serve` 报告服务（4310）混跑

## 9. 约束（对齐 AGENTS.md 红线）

- ESM 相对导入带 `.js`；零运行时依赖；不引 express / zod / 数据库驱动。
- HTML 插值一律转义；路径穿越防护沿用 `[^/\\]+` 规则。
- `process.exitCode` 表达退出码，不 `process.exit()`。