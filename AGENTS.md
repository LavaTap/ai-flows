# ai-flows（ai-review CLI + AI 管线平台）

> 平台无关的 AI 代码评审链 CLI + 公司 AI 管线平台。`run` 采集 git diff → 调 LLM（DeepSeek/OpenAI 兼容接口）评审 → 门禁判定 → 生成 Markdown 报告 + 评审数据；推送只走评审页面「确认提交」（或显式 `--push`）。`platform` 子命令提供登录 + 四部门管线页 + 节点执行/批准（节点 03 触发真实 AI 评审）；`install-hook` 让每次 `git push` 先被拦截去评审，再由页面确认提交放行。
> 技术栈：TypeScript 5.6（strict）+ Node ≥18 ESM，**零运行时依赖**（仅 `node:*` 内置模块 + 全局 `fetch`）；平台数据用 JSON 文件（`db/`）自实现，前端静态页在 `web/`，不引数据库 / 前端框架。
> 完整链路、报告页面架构、目标仓库接入步骤见 `评审链路与说明.md`；整体数据流图见 `架构与数据流.md`；平台目标、账号清单与权限模型见 `plan.md`，本文件不重复。
> 本文件是仓库 AI 指令的**唯一来源**（`CLAUDE.md` 已删除，不再维护双镜像）。

## 适用范围

| 范围 | 说明 |
|------|------|
| 生效 | 本仓库 `src/**` 全部源码、`web/**`（平台静态页）、`db/*.json`（账号与节点数据），以及 `package.json` / `tsconfig.json` |
| 排除 | `dist/**` 是 `tsc` 构建产物，**禁止手工编辑**（下次构建即被覆盖）；`.agents/**` 是独立第三方 skill，各有自己的 SKILL.md/CLAUDE.md，不受本文件约束 |
| 本地文件 | `ai-review.config.json` 已 gitignore，属本地配置非源码；要维护的模板是 `config.example.json` |
| 文档同步 | `plan.md`（平台账号/权限/节点模型）、`评审链路与说明.md`（评审链实操）、`评审触发指令.md`（触发评审的工具链指令速查）、`架构与数据流.md`（数据流图）——平台行为变更时必须同步对应文档 |

## 命令

| 操作 | 命令 |
|------|------|
| 安装依赖 | `npm install`（仅 3 个 devDeps：`@types/node` `tsx` `typescript`） |
| 开发运行 | `npm run dev`（= `tsx src/index.ts`，直接执行 TS 源码） |
| 构建 | `npm run build`（= `tsc`，产出 `dist/`） |
| **类型检查（唯一自动化门禁）** | `npx tsc --noEmit` |
| 手工端到端验证 | `npx tsx src/index.ts run --page`（需 `ai-review.config.json` + `DEEPSEEK_API_KEY`；`run` 缺省不推送，评审页面需输入 commit 信息并点「确认提交」才提交+推送） |
| 报告服务 | `npx tsx src/index.ts serve --port 4310`（列表页 `GET /`，报告页 `GET /reports/<id>`） |
| 平台服务 | `npx tsx src/index.ts platform --port 4311 [--repo <path>]`（登录页 `/login`，管线页 `/pipeline`；节点 03 对 `--repo` 仓库触发真实评审，缺省当前目录；演示密码统一 123456） |
| 安装 pre-push hook | `npx tsx src/index.ts install-hook`（`git push` 前自动评审并**始终拦截**，引导到评审页面点「确认提交」） |

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
| `platform.ts` | 平台 HTTP 服务：登录会话 + 管线页注入 `window.__PIPELINE__` + 节点执行/批准 API；权限判定 `canExecute` / `canApprove`；节点 03 后台跑评审链 |
| `db.ts` | JSON 库读写（`db/users.json` / `db/pipeline.json`）、`authenticate` 邮箱+密码校验 |
| `auth.ts` | 内存会话 + cookie 签发/解析（`HttpOnly` `SameSite=Lax`，24h，重启即失效） |
| `redact.ts` | `maskSecrets()`：评审产出前对 `summary` / `message` / `suggestion` 打码（密钥只留首尾各 4 位） |

约束：

| 规则 | 说明 |
|------|------|
| 相对导入必须带 `.js` 后缀 | `module: NodeNext` 的硬要求：源码文件是 `.ts`，导入路径写 `.js` |
| 零运行时依赖 | 禁止新增 `dependencies`；能力用 `node:*` 与全局 `fetch` 自实现，不要引入 commander / zod / express / axios |
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
| 平台权限唯一入口 | 节点执行/批准判定只用 `platform.ts` 的 `canExecute` / `canApprove`（员工限本部门、主管不限）；前端按钮显隐只是展示，服务端校验才算数，路由内不得另写权限逻辑 |
| 账号与密码 | 账号唯一来源 `db/users.json`，**不开放注册**；演示期密码明文 123456，上线前必须换 `node:crypto` scrypt 加盐哈希 |
| 会话与 cookie | 内存 `Map` 会话 + `HttpOnly` `SameSite=Lax` cookie；服务重启全部失效（演示可接受，不引数据库/Redis） |
| 节点状态机 | `todo → running → done → approved`；仅主管可 `approve`；服务启动时把残留 `running` 复位为 `todo`，防进程中断后永久卡死 |
| 评审节点异步执行 | `runner=ai-review` 先落 `running` 并立即响应，评审在后台跑完再回写 `lastResult` / `reportUrl`（回写前重读库，避免覆盖期间其他节点变更） |
| 注入 bootstrap 必须转义 | `window.__PIPELINE__` 注入用 `jsonForScript()`（转义 `<`）；节点顺序与 `web/ai-pipeline-app.js` 的 `data-idx` 一一对应，改注入结构必须同步该脚本 |

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
| `platform.ts` | `canExecute` / `canApprove` | 员工限本部门、主管全节点可执行；员工不可批准 |

不要求覆盖：`index.ts` 的 CLI 编排、HTTP 服务生命周期、真实模型调用（涉及网络与凭据）。
端到端回归用手工三档用例（info / warning / blocker）验证，方法见 `评审链路与说明.md` §3。

## 配置层级

配置文件解析优先级（`src/config.ts` `loadConfig`）：

```
CLI --config <path>  >  环境变量 AI_REVIEW_CONFIG  >  默认 ./ai-review.config.json
```

模型凭据解析优先级（`resolveApiKey`）：`model.apiKey`（不推荐明文）> `model.apiKeyEnv` 指向的环境变量。

`loadConfig` 兜底默认值：`severityBlocked=["blocker"]`、`targets=[]`、`diff.scope="staged"`、`diff.exclude=[]`、`diff.maxFileLines=500`。新增配置项时**必须同时更新** `config.example.json` 与 `loadConfig` 默认值。

平台节点 03 的评审配置随**目标仓库**走（`<repo>/ai-review.config.json`），与其 pre-push hook 行为一致；平台自身不存额外配置，端口用 `AI_FLOWS_PORT` 覆盖。

---

**红线：** ESM 相对导入必带 `.js` · 零运行时依赖 · 退出码 0/1/2 契约不可改 · 渲染层只认 `ReportView` · HTML 插值一律走 `esc()` · 凭据只从环境变量读 · 确认提交必须带非空 commit message · `run` 缺省不推送 · 平台权限只走 `canExecute`/`canApprove` · 注入 bootstrap 必须转义 · 演示密码 123456 不得原样上线
