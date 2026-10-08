# AI 分析流程

当用户选择 AI 分析评论时，按以下步骤执行。此流程适用于所有平台（B站、Steam、小红书）。

## 前提：读取参考文档（必须）

AI 分析前**必须**读取以下两个参考文档，不得跳过：

| 文档 | 内容 | 何时读取 |
|---|---|---|
| `references/output-fields.md` | 12 字段定义、标签体系（治愈感受细分、吸引游玩因素） | 分析前 |
| `references/analysis-rules.md` | 正向优先规则、治愈评分标准、两轮分析流程、判定示例、质量要求 | 分析前 |

## 步骤 1：预处理评论（生成 AI 输入文件）

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/tools/limit_comments_for_ai.py --session-dir {会话目录路径}
```

脚本从 `{会话目录}/comments/comments.csv` 读取评论（回退到 `output/output.csv`），
截取前 50 条，生成 AI 分析输入文件：
- `comments/comments_for_ai.csv` — **序号 + 评论内容** 两列 CSV，最多 50 条

**截断规则**：评论条数 > 50 时只保留前 50 条（热度排序）；≤ 50 条全量保留。原始 `comments.csv` / `output.csv` 保留不动。

## 步骤 2：读取评论数据

- **唯一输入**：`{会话目录}/comments/comments_for_ai.csv`（序号,评论内容 两列，已截断到50条）
- **回退**：`{会话目录}/output/output.csv`（此时需自行截断到前50条）
- ⚠️ 不得直接使用全量数据进行分析（会超出 token 限制）

## 步骤 3：逐条分析

严格按照参考文档中的规则，为每条评论填充 8 个 AI 分析字段：
- 情绪倾向、情绪关键词、是否提及治愈、治愈相关度
- 治愈感受细分、吸引游玩因素、判断依据、复核调整说明

## 步骤 4：两轮复核

完成第一轮后，对中性/负向/混合记录进行第二轮正向优先复核。

## 步骤 5：保存结果

- **生成 `analysis/output.csv`**：将已分析评论（前50条，12 字段全填充）保存到 `{会话目录}/analysis/output.csv`
- **合并回 `output/output.csv`**：按评论内容匹配，将 AI 字段回填到 `{会话目录}/output/output.csv`（未分析的行 AI 字段留空）
- **生成 AI 分析报告**：`reports/{平台}/ai/{会话名}/ai_report.md`（文件夹名与 output 会话目录同名）

> ⚠️ AI 分析产出两个文件：
> - `analysis/output.csv` — 仅已分析评论（≤50条，AI 字段全填充），作为分析结果存档
> - `output/output.csv` — 全量评论（合并后，已分析的行填充 AI 字段，其余行 AI 字段留空）

## 批量 AI 分析（对所有项目执行）

当用户要求「AI 分析所有项目」时：

```bash
# 1. 批量预处理所有项目
venv/Scripts/python.exe research-crawler-skill/scripts/tools/limit_comments_for_ai.py

# 2. 批量 AI 分析
venv/Scripts/python.exe research-crawler-skill/scripts/flow/batch_ai_analysis.py
```

遍历 `output/` 下所有会话目录，对每个存在 `comments/comments_for_ai.csv` 的项目执行上述步骤 2-5。
每个会话的 AI 报告按平台存放在 `reports/{平台}/ai/{会话名}/ai_report.md`。

## 步骤 6：错误检测与 Excel 汇总

AI 分析完成后，执行错误检测并生成 Excel：

```bash
# 1. 错误检测（按平台，报告→reports/{平台}/error/）
venv/Scripts/python.exe research-crawler-skill/scripts/tools/check_output_errors.py --platform bilibili
venv/Scripts/python.exe research-crawler-skill/scripts/tools/check_output_errors.py --platform steam

# 2. 按平台生成 Excel（每平台一个文件，输出到 excel/{平台}_{时间戳}.xlsx）
venv/Scripts/python.exe research-crawler-skill/scripts/flow/merge_all_to_excel.py --platform bilibili
venv/Scripts/python.exe research-crawler-skill/scripts/flow/merge_all_to_excel.py --platform steam
```
