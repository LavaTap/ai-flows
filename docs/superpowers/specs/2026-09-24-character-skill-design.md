# 角色卡片 + 四态工作流 + Skill 接入 设计（character-skill）

> 分支：`character-skill`（基于 `text-flow`）。本文件是实施依据，落地时逐条对齐。
> 前置文档：`plan.md`（平台账号/权限/节点模型）、`AGENTS.md`（仓库红线）。

## 1. 背景与目标

管线页（`web/ai-pipeline.html` + `platform.ts`）目前已能登录、按部门执行/批准节点、节点 03 触发真实评审链。
本次要补齐三件事：

1. **角色可视化**：每个环节列出执行角色卡片（头像 + 姓名，悬停浮层显示 姓名 + 岗位 + 头像），每个账号有不同颜色的默认 icon。
2. **四态工作流**：`待执行 / 执行中 / 待验收 / 已执行`，执行人提交 → 待验收 → 主管审核；驳回回执行中。
3. **节点 01/02 能力接入**：通过页面直接触发三个自研 skill（`research-crawler-skill`、`product-analysis-skill`、`product-manager-skill`），产出文件到用户选择的输出目录。

## 2. 已确认的关键决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| Skill 如何"执行" | **平台内 LLM 生成** | 两个 skill 目录只有 `SKILL.md`（提示词型）；`research-crawler-skill` 有 Python 脚本但仓库无 `venv/`，跑起来需 Playwright + cookie + 外网，破坏零运行时依赖。统一走 LLM 与节点 03 评审链同构 |
| 输出目录选择 | **服务端目录浏览弹窗** | 浏览器无法访问服务端路径；新增白名单根目录下的只读浏览接口 |
| 执行完成但未提交时的状态 | **保持「执行中」** | 严格保持四态；产物就绪后「提交」按钮出现，点提交才进待验收 |
| 节点 03 是否套用新流程 | **统一新版四态** | 四个节点行为一致 |

## 3. 范围

**In**
- `db/users.json` 账号补 `name`；`db/pipeline.json` 节点补需求文本 / 产物 / 驳回意见 / 进度
- 四态状态机与 `submit / reject` 两个新动作
- 节点 01/02 的需求编辑、文件上传、执行、产物输出
- 服务端目录浏览接口、产物下载、进度查询
- 前端：角色卡片、状态徽章、进度条、需求编辑器、目录选择弹窗、上传弹窗

**Out（本次不做）**
- 真实运行 Python 采集脚本（无 venv、需外网）
- 账号注册、密码哈希（沿用 `plan.md` §8 演示期决策）
- 产物在线预览渲染（只提供下载）
- Skill 多轮对话 / 人工干预执行过程

## 4. 数据模型变更

### 4.1 `db/users.json`

新增字段：

```jsonc
{
  "email": "liyun@ai-flows.com",
  "password": "123456",
  "role": "staff",
  "title": "用户调研实习生",
  "department": "产品调研",
  "name": "李云"            // 新增：中文姓名，用于角色卡片
}
```

头像颜色**不落库**，由邮箱哈希在 6 色调色板中取值（前端 + 服务端同一套映射，保证一致）。

### 4.2 `db/pipeline.json`

`NodeState` 扩展：

```ts
export type NodeStatus = "todo" | "running" | "in_review" | "done";

export interface NodeArtifact {
  name: string;      // 产物文件名
  path: string;      // 相对仓库根的可读路径
  skill: string;     // 产出它的 skill
  at: string;        // ISO 时间
}

export interface NodeState {
  id: string;
  department: string;
  step: string;
  ready: boolean;
  status: NodeStatus;
  runner?: string;              // "ai-review" | "skill:<name>"
  requirementText?: string;     // 需求文字描述（节点 01/02）
  uploads?: string[];           // 已上传附件文件名（存于 .ai-flows-uploads/<id>/）
  artifacts?: NodeArtifact[];   // 产出物
  progress?: number;            // 0-100，执行中才有意义
  progressLabel?: string;       // 当前阶段文案
  rejection?: string;           // 最近一次驳回意见
  lastResult?: string;
  reportUrl?: string;
  outputDir?: string;           // 最近一次选用输出目录
}
```

`approved` 旧值在启动迁移时映射为 `done`。

## 5. 状态机

```
         执行               提交              主管通过
todo ──────────▶ running ──────────▶ in_review ──────────▶ done
  ▲                  ▲                    │
  └──────────────────┴────────────────────┘
        主管驳回（写 rejection）回 running
```

| 动作 | 允许的起始状态 | 权限 | 结果状态 |
|---|---|---|---|
| `execute` | `todo` / `running` | 本部门员工 + 主管 | `running`（后台执行，完成仍为 `running`，产物就绪） |
| `submit` | `running`（且已有产物或节点无 runner） | 本部门员工 + 主管 | `in_review` |
| `approve` | `in_review` | 仅主管 | `done` |
| `reject` | `in_review` | 仅主管 | `running`（附 `rejection`） |

- 服务启动时把残留 `running` 复位为 `todo` 并写入 `lastResult`（沿用现有逻辑）。
- 新增硬性校验：`approve` 要求 `status === "in_review"`，`submit` 要求 `status === "running"`，否则 409。

## 6. 后端接口

新增/变更路由（均在 `src/platform.ts`，id 用 `[^/\\]+` 限定）：

| 方法 | 路径 | 说明 |
|---|---|---|
| `PUT` | `/api/nodes/:id/requirement` | 保存需求文本。主管 + 本节点部门员工可写，body `{ text }`，长度上限 4000 |
| `POST` | `/api/nodes/:id/upload` | 上传附件，body `{ filename, contentBase64 }`（避免手写 multipart），文件名净化后落 `.ai-flows-uploads/<id>/` |
| `POST` | `/api/nodes/:id/execute` | 执行节点，body `{ outputDir? }`（节点 01/02 必填） |
| `POST` | `/api/nodes/:id/submit` | 执行人提交 → `in_review` |
| `POST` | `/api/nodes/:id/approve` | 主管通过 → `done`（现有路由，加状态校验） |
| `POST` | `/api/nodes/:id/reject` | 主管驳回，body `{ reason? }` → `running` |
| `GET` | `/api/fs?path=` | 浏览输出目录树，只返回白名单根下的目录项 |
| `GET` | `/api/artifacts/:id/:name` | 下载产物（`name` 白名单校验，禁止穿越） |
| `GET` | `/api/nodes` | 扩展返回上述新字段 |

`GET /api/fs` 规则：
- 白名单根：仓库根目录（`--repo` 指定），即只能在其下浏览
- 入参 `path` 归一化后必须仍在根内（`resolve` 后前缀校验），否则 403
- 只列目录（不列文件内容），每项 `{ name, path }`；`..` 不出现在返回里
- 支持 body 传 `newDir` 建子目录（`POST /api/fs/mkdir`）

## 7. Skill 调用机制

新模块 `src/skill.ts`，职责单一：**把 SKILL.md + 输入 → LLM → 产物文件**。

```ts
export interface SkillRunInput {
  skill: string;        // "research-crawler" | "product-analysis" | "product-manager"
  requirement: string;  // 需求文本
  uploads: string[];    // 附件绝对路径
  outputDir: string;    // 已校验的输出目录（绝对路径）
  repo: string;         // 白名单根
  onProgress: (pct: number, label: string) => void;  // 阶段回调，回写 db
}

export interface SkillRunResult {
  artifactName: string;
  artifactPath: string;
}

export async function runSkill(input: SkillRunInput, cfg: ReviewConfig): Promise<SkillRunResult>;
```

- **Skill 名 → SKILL.md 路径**映射表 `SKILL_DIRS`，路径写在 `src/skill.ts`（不硬编码在 `platform.ts`）。
- **Prompt 组装**：`SKILL.md` 全文作 system（剥离 frontmatter），用户消息给出需求文本 + 附件清单 + 交付要求（输出 Markdown）。
- **附件**：以文件名 + 文本内容（限长）注入 prompt；二进制文件只列名。
- **模型调用**：复用 `reviewer.ts` 的模型调用与退避重试能力（抽公共函数或直接调用既有导出），**不新增依赖**。
- **产出**：写入 `<outputDir>/<skill>-<时间戳>.md`，同时记录到 `NodeArtifact`。
- **进度**：分 4 个阶段推进 `10 → 35 → 70 → 100`（准备 / 读取需求与附件 / 模型生成 / 写文件），每阶段调用 `onProgress` 回写 `db/pipeline.json`。
- **错误**：捕获后把 `lastResult` 写为错误原因，节点保持 `running` 但不写入产物（用户可重试执行）。

## 8. 前端交互（`web/ai-pipeline-app.js` + `.css` + `.html`）

- **角色卡片**：详情面板内按节点部门渲染 `.role-card` 列表；卡片 = 圆形头像（首字 + 哈希色）+ 姓名；hover 显示浮层 `姓名 / 岗位 / 头像`。
- **状态徽章**：节点与详情面板共用 `STATUS_TEXT = { todo: "待执行", running: "执行中", in_review: "待验收", done: "已执行" }`，颜色区分四态。
- **需求编辑器**：节点 01/02 详情内多行文本框 + 「保存」；无权限时禁用并提示只读。
- **提交文件**：按钮 → 弹窗选本地文件 → 读为 base64 → `POST upload` → 刷新附件列表。
- **直接执行 / 执行**：按钮 → （节点 01 先弹目录选择）→ `POST execute` → 进入 `running` + 进度条 → 2s 轮询。
- **目录选择弹窗**：面包屑 + 目录列表 + 「新建文件夹」+ 「选定此目录」；数据来自 `GET /api/fs`。
- **需求分析**（节点 01）：弹窗提交文件 → `POST execute`（`skill: product-analysis`）。
- **提交 / 审核**：`running` 显示「提交」；`in_review` 显示「通过 / 驳回（填意见）」，仅主管可见。
- 所有插值走既有 `esc()`；`window.__PIPELINE__` 注入结构变化必须同步 `data-idx`。

## 9. 权限矩阵

| 能力 | 员工 | 主管 |
|---|---|---|
| 查看全流程 | ✅ | ✅ |
| 编辑本节点需求文本 | ✅（限本部门） | ✅ |
| 上传附件 / 执行 | ✅（限本部门） | ✅ |
| 提交验收 | ✅（限本部门） | ✅ |
| 通过 / 驳回 | ❌ | ✅（全部节点） |
| 浏览输出目录 | ✅（白名单根内） | ✅ |

判定**只走** `platform.ts` 的 `canExecute` / `canApprove` 及新增的 `canEditRequirement`；前端按钮显隐仅是展示。

## 10. 错误处理

| 场景 | 处理 |
|---|---|
| 非仓库 / 目录不存在 | 400 + 明确文案，状态不变 |
| 输出目录越权（不在白名单根内） | 403，拒绝执行 |
| skill 的 SKILL.md 缺失 | 500 + "skill 未安装" |
| LLM 调用失败/超时 | 沿用退避重试；最终失败 → `lastResult` 写原因，节点回 `running` 且无产物 |
| 上传文件名含路径分隔符 | 净化（只留 basename + 白名单字符） |
| 产物下载名含 `../` | 404 |

## 11. 测试

`node:test` + `node:assert`，新增/扩展 `src/<module>.test.ts`：

- `db.ts`：`approved` → `done` 迁移；四态读写
- `platform.ts`：`canExecute` / `canApprove` / `canEditRequirement`；`submit`/`approve`/`reject` 的状态校验（409 分支）；`/api/fs` 路径穿越拦截；`/api/artifacts` 名字穿越拦截
- `skill.ts`：`buildSkillPrompt`（含/不含附件）、`resolveSkillDoc`（缺文件报错）、`sanitizeFilename`
- 端到端手工回归：登录 → 李云编辑需求 → 执行（选目录）→ 进度条 → 产物生成 → 提交 → 张丽通过；再走一遍驳回路径

门禁：`npx tsc --noEmit` 通过 + `npx tsx --test "src/**/*.test.ts"` 全绿（若测试脚本存在）。

## 12. 实施顺序

1. `db.ts`：四态 + 新字段 + 启动迁移；`db/users.json` 补 `name`
2. `src/skill.ts`：SKILL.md 加载 + prompt 组装 + 产物写入 + 进度回调（含单测）
3. `platform.ts`：新路由 + 状态校验 + 目录浏览/产物下载（含单测）
4. `web/*`：角色卡片 → 状态徽章 → 需求编辑器 → 上传 → 目录弹窗 → 进度条 → 提交/审核
5. `plan.md` 同步（§4.1 姓名列、§5 权限、§6 节点模型、§7.2 加 P7）
6. `npx tsc --noEmit` + 重建 `dist/` + 端到端冒烟