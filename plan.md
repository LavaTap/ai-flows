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

> 判定只走 `platform.ts` 的 `canExecute` / `canApprove` / `canEditRequirement`；前端按钮显隐仅是展示。

## 6. 管线节点模型

| 节点 | 部门 | 环节 | runner | 状态 | 说明 |
|---|---|---|---|---|---|
| 01 | 产品调研 | 产品调研 | `skill:research-crawler` | 已接入 | 需求文字 + 附件 → LLM 生成调研文档；另有「需求分析」按钮（`product-analysis` skill） |
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
│   ├── login.html            # DONE：登录页
│   └── login.css             # DONE：登录页样式
├── db/
│   ├── users.json            # DONE：账号库（6 个种子账号，不开放注册）
│   └── pipeline.json         # DONE：节点运行时状态（执行/批准写回）
└── src/
    ├── db.ts                 # DONE：账号/节点读写 + authenticate（JSON + node:fs）
    ├── auth.ts               # DONE：内存会话 + cookie（HttpOnly，24h）
    ├── platform.ts           # DONE：平台 HTTP 服务（路由 + 权限 + 注入渲染）
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

## 8. 待确认事项（实施时已按默认处理）

- [x] 6 个账号姓名：已确认为真实姓名（张丽/王鑫易/李翔/陈宇/刘阳/李云），`db/users.json` 每个账号带 `name` 字段
- [x] 主管不区分部门：`supervisor` 角色直接放开全部节点的操控+批准（权限最高）
- [x] 密码演示期明文存 JSON（统一 123456），上线前再换 `node:crypto` scrypt
- [x] 平台入口：独立子命令 `platform` + 独立端口 4311，不与 `serve` 报告服务（4310）混跑

## 9. 约束（对齐 AGENTS.md 红线）

- ESM 相对导入带 `.js`；零运行时依赖；不引 express / zod / 数据库驱动。
- HTML 插值一律转义；路径穿越防护沿用 `[^/\\]+` 规则。
- `process.exitCode` 表达退出码，不 `process.exit()`。