# ai-review 评审链用法

> 业务文档：由主文档 `SKILL.md` 在「跑评审 / 起服务 / CLI 用法」意图下路由到这里。

## 触发条件

用户说「跑评审」「执行 ai-review」「起报告服务」「起平台」「装 pre-push hook」「AI 评审链怎么用」等。

## 1. 评审链做什么

`run` 采集 git diff → 调 LLM（DeepSeek / OpenAI 兼容）评审 → 门禁判定 → 生成 Markdown 报告 + 评审数据；推送只走评审页面「确认提交」（或显式 `--push`）。

## 2. 命令

| 操作 | 命令 |
|---|---|
| 开发运行 | `npm run dev`（= `tsx src/index.ts`） |
| 构建 | `npm run build`（= `tsc`，产出 `dist/`） |
| 类型检查（唯一自动化门禁） | `npx tsc --noEmit` |
| 跑评审（不推送 + 出页面） | `npx tsx src/index.ts run --page` |
| 报告服务 | `npx tsx src/index.ts serve --port 4310` |
| 平台服务 | `npx tsx src/index.ts platform --port 4311 [--repo <path>]` |
| 装 pre-push hook | `npx tsx src/index.ts install-hook` |
| 生成配置 | `npx tsx src/index.ts init` |

`run` 缺省**不推送**：评审通过后需在评审页面输入 commit 信息并点「确认提交」，或加 `--push` 由命令行直接推送。

## 3. 退出码契约（不可改）

| 码 | 含义 |
|---|---|
| `0` | 通过 |
| `1` | 存在 blocker，拦截 |
| `2` | 推送失败 |

pre-push hook 依赖它拦截，改动会静默废掉门禁。

## 4. 配置

配置文件解析优先级：

```
CLI --config <path>  >  环境变量 AI_REVIEW_CONFIG  >  默认 ./ai-review.config.json
```

模型凭据解析优先级（`resolveApiKey`）：`model.apiKey`（不推荐明文）> `model.apiKeyEnv` 指向的环境变量。

`loadConfig` 兜底默认值：`severityBlocked=["blocker"]`、`targets=[]`、`diff.scope="staged"`、`diff.exclude=[]`、`diff.maxFileLines=500`。

常用环境变量：

| 变量 | 用途 |
|---|---|
| `DEEPSEEK_API_KEY` | 模型 API Key（或 config 里 `model.apiKeyEnv` 指定） |
| `AI_REVIEW_CONFIG` | 配置文件路径（默认 `./ai-review.config.json`） |
| `AI_REVIEW_PORT` | 报告服务端口（默认 4310） |
| `AI_REVIEW_GITHUB_TOKEN` | https 目标远端 token 认证 |

## 5. 报告服务与平台

- 报告服务：`serve`，列表页 `GET /`，报告页 `GET /reports/<id>`；页面「确认提交」= `POST /reports/<id>/push`（必须带非空 commit message）。
- 平台服务：`platform`，登录页 `/login`，管线页 `/pipeline`；账号见 `db/users.json`（演示密码统一 123456）。

## 6. 规范输出（不靠 prompt）

评审输出格式**由代码保证，不依赖 prompt 约束模型自觉守格式**。两侧各有一道归一器，契约一致：

| 侧 | 位置 | 作用 |
|---|---|---|
| 项目 | `src/reviewer.ts` `normalizeIssues` / `writeReviewLog` | 评审链内强制校验：severity 走白名单（非法值兜底 `warning`）、`line`/`lineStart`/`lineEnd` 兼容、无 message 条目丢弃、兜底 category |
| 技能 | `<skill-dir>/scripts/normalize-review.mjs` | 把模型原始输出（含围栏/前后缀）归一成标准 JSON，供手工核对或接入 |

技能侧脚本用法：

```bash
node <skill-dir>/scripts/normalize-review.mjs <input-file>   # 或 - 从 stdin 读
node <skill-dir>/scripts/normalize-review.mjs raw.txt --out out.json --no-log
```

标准评审 JSON：`{ summary, issues[{file,lineStart,lineEnd,severity,category,message,suggestion?}], counts, total }`。
退出码：`0` 归一成功 / `1` 无法解析出 JSON。

## 7. 评审日志

每次评审落一份日志到 `.agents/skills/ai-flows/log/code-review/`，文件名 `YYYYMMDDHHmmss`（本地时区，精确到秒），例如 `20260928112130.log`。

- 项目侧：`src/reviewer.ts` 的 `reviewBatch` 自动落盘，按模块自身定位（评审其他仓库时也写回 ai-flows skill 目录，不污染目标仓库）；可用 `AI_REVIEW_LOG_DIR` 覆盖目录；写失败不阻断评审。
- 技能侧：`normalize-review.mjs` 默认同目录落日志，`--no-log` 可关。
- 日志已被 `.gitignore` 的 `*.log` 忽略，不进版本库。

## 8. 验证手段

本项目**没有** linter / formatter / 测试框架 / CI。不存在 `npm run lint`、`npm test` 等 script——不要执行，也不要把它们当作“已验证”的依据。改完代码的最低验证标准是 `npx tsc --noEmit` 通过。
