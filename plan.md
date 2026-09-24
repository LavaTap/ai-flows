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
| 1 | zhaoli@ai-flows.com | 123456 | 主管 | 产品部门主管 | 全部节点（操控+批准） | 张丽 |
| 2 | wangxinyi@ai-flows.com | 123456 | 员工 | 用户调研实习生 | 产品调研 | 王鑫易 |
| 3 | lixiang@ai-flows.com | 123456 | 员工 | 前端开发设计师 | 程序中台（AI 代码评审） | 李翔 |
| 4 | chenyu@ai-flows.com | 123456 | 员工 | AI 产品实习生 | AI产品（产品策划案） | 陈宇  |
| 5 | liuyang@ai-flows.com | 123456 | 员工 | 初级产品运营 | 产品运营 | 刘阳 |
| 6 | liyun@ai-flows.com | 123456 | 员工 | 用户调研实习生 | 产品调研 | 李云 |

> 姓名拼音为占位，待用户给真实姓名后替换。密码统一 123456（演示环境明文存 JSON；上线前加盐哈希）。

## 5. 角色与权限矩阵

| 能力 | 员工 | 部门主管 |
|---|---|---|
| 查看管线全流程 | ✅ | ✅ |
| 执行本部门节点（提交/触发工作流） | ✅（限本部门） | ✅ |
| 批准节点（放行到下一环节） | ❌ | ✅（全部节点） |
| 操控停用/启用节点 | ❌ | ✅（权限最高） |

## 6. 管线节点模型

| 节点 | 部门 | 环节 | 状态 | 说明 |
|---|---|---|---|---|
| 01 | 产品调研 | 产品调研 | 留空待接入 | 调用用户自研 Skill |
| 02 | AI产品 | 产品策划案 | 留空待接入 | — |
| 03 | 程序中台 | AI 代码评审 | 已就绪 | 接现有 ai-review 管线 |
| 04 | 产品运营 | 运营 | 留空待接入 | — |

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

## 8. 待确认事项（实施时已按默认处理）

- [x] 6 个账号姓名拼音：沿用占位拼音（zhaoli/wangxinyi/lixiang/chenyu/liuyang/liyun），改 `db/users.json` 即可
- [x] 主管不区分部门：`supervisor` 角色直接放开全部节点的操控+批准（权限最高）
- [x] 密码演示期明文存 JSON（统一 123456），上线前再换 `node:crypto` scrypt
- [x] 平台入口：独立子命令 `platform` + 独立端口 4311，不与 `serve` 报告服务（4310）混跑

## 9. 约束（对齐 AGENTS.md 红线）

- ESM 相对导入带 `.js`；零运行时依赖；不引 express / zod / 数据库驱动。
- HTML 插值一律转义；路径穿越防护沿用 `[^/\\]+` 规则。
- `process.exitCode` 表达退出码，不 `process.exit()`。