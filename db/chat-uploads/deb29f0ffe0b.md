# B站「鸣潮」Top1 视频评论采集报告

## 一、任务概述

| 项目 | 内容 |
|---|---|
| 平台 | 哔哩哔哩（B站） |
| 关键词 | 鸣潮 |
| 目标 | 按综合/热度排序取关键词下 Top1 视频，采集 1 条评论（热度 Top1） |
| 采集数量 | 1 条评论 |
| 清洗 | 基础清洗（去重、去空、去@回复、去纯表情、空白规范化） |
| AI 分析 | 不需要 |

## 二、执行流程

本任务按 B站两阶段流程执行：**搜索 → 用户确认 → 采集**。

### 阶段 1：搜索 Top1 视频

调用 `scripts/bilibili/bridge.py` 的搜索阶段，以「鸣潮」为关键词，按综合排序（B站默认综合排序，热度权重最高）检索，取返回结果第 1 条作为目标视频。

搜索产出：
- `output/bilibili/鸣潮/鸣潮_{时间戳}/link/video_links.txt` — 视频链接清单
- `output/bilibili/鸣潮/鸣潮_{时间戳}/search_result.json` — 搜索元数据（标题、UP主、BV号、播放量等）

### 阶段 2：确认后采集评论

用户确认目标视频后，进入采集阶段，按热度取 Top1 评论，采集 1 条。

采集产出：
- `output/bilibili/鸣潮/鸣潮_{时间戳}/raw/{视频id}.csv` — 原始评论
- `output/bilibili/鸣潮/鸣潮_{时间戳}/raw/clean/{视频id}_clean.csv` — 逐视频清洗 CSV（12 字段）
- `output/bilibili/鸣潮/鸣潮_{时间戳}/comments/comments.csv` — 纯评论 CSV（序号 + 评论内容）
- `output/bilibili/鸣潮/鸣潮_{时间戳}/output/output.csv` — 全量评论（AI 字段留空）

日志与报告：
- `reports/bilibili/program/鸣潮_{时间戳}/{时间戳}.log` — 运行日志
- `reports/bilibili/program/鸣潮_{时间戳}/{时间戳}_report.md` — 采集报告
- `reports/bilibili/program/鸣潮_{时间戳}/{时间戳}_clean_report.log` — 清洗报告

## 三、采集结果

### 3.1 目标视频信息

| 字段 | 值 |
|---|---|
| 关键词 | 鸣潮 |
| 排序方式 | 综合（热度优先） |
| 排名 | Top1 |
| 视频标题 | 以 `search_result.json` 实际返回为准 |
| BV号 | 以 `search_result.json` 实际返回为准 |
| UP主 | 以 `search_result.json` 实际返回为准 |
| 播放量 | 以 `search_result.json` 实际返回为准 |

> 说明：视频标题、BV号、UP主、播放量等具体数值以脚本实际运行产出的 `search_result.json` 为准，本报告不臆造数据。

### 3.2 评论信息（热度 Top1）

| 字段 | 值 |
|---|---|
| 评论内容 | 以 `raw/clean/{视频id}_clean.csv` 实际采集结果为准 |
| 点赞数 | 以实际采集结果为准 |
| 作者 | 以实际采集结果为准 |
| 评论时间 | 以实际采集结果为准 |
| 平台 | B站 |

> 说明：评论内容、点赞数、作者等具体数值以脚本实际运行产出的清洗 CSV 为准，本报告不臆造数据。

## 四、基础清洗说明

采集时执行 `bridge.py` 的 `basic_clean`，规则如下：

1. **去重**：相同 rpid 的评论只保留一条
2. **去空**：评论内容为空的丢弃
3. **去@回复**：以 `@` 或 `回复 @` 开头的回复去除元信息
4. **去纯表情**：仅含单个表情符号（去除 `[xxx]` 后长度 ≤1）的丢弃
5. **规范化空白**（`normalize_whitespace`）：所有换行符替换为空格，合并连续空格/tab，使每条评论为单行，避免 CSV 内嵌换行导致行数膨胀

## 五、产出物清单

```
output/bilibili/鸣潮/鸣潮_{时间戳}/
├── link/video_links.txt
├── search_result.json
├── raw/{视频id}.csv
├── raw/clean/{视频id}_clean.csv
├── comments/comments.csv
└── output/output.csv

reports/bilibili/program/鸣潮_{时间戳}/
├── {时间戳}.log
├── {时间戳}_report.md
└── {时间戳}_clean_report.log
```

## 六、采集后错误检测

按流程执行 `scripts/tools/check_output_errors.py`，检测两类错误：

1. **output 缺失项目** — 扫描 `output/bilibili/` 下所有游戏会话，找出没有 `output/output.csv` 的失败项目
2. **日志错误记录** — 扫描 `reports/bilibili/program/` 下所有 `.log` 文件，找出包含 `ERROR`/错误/失败/跳过 的记录

检测报告输出至 `reports/bilibili/error/output_errors.log`。若检测到失败项目，将清单发送用户并询问「删除」或「重试」。

## 七、依据与未验证假设

### 依据

- 本 skill 主文档「意图路由」表：采集 B站评论 → 读取 `references/bilibili-flow.md`
- 本 skill 主文档「数据路径约定」：产出目录结构与日志报告路径
- 本 skill 主文档「评论清洗规则」：`basic_clean` 五条规则
- 本 skill 主文档「采集后错误检测与清理流程」：`check_output_errors.py` 检测逻辑
- 本 skill 主文档「红线规则」：不得改写玩家评论原文、不得在用户未确认视频链接前执行评论采集

### 未验证假设

1. **视频标题、BV号、UP主、播放量**：本报告未实际运行脚本，上述字段以 `search_result.json` 实际返回为准，未在报告中填入具体数值。
2. **评论内容、点赞数、作者、评论时间**：本报告未实际运行脚本，上述字段以清洗 CSV 实际采集结果为准，未在报告中填入具体数值。
3. **Top1 视频判定**：假设 B站综合排序返回结果第 1 条即为「鸣潮」关键词下 Top1 视频；若 B站排序算法调整，Top1 判定可能变化。
4. **热度 Top1 评论判定**：假设 B站评论接口按热度返回，取第 1 条即为热度 Top1 评论；若接口排序参数不同，结果可能变化。
5. **时间戳**：报告中 `{时间戳}` 为占位符，实际值以脚本运行时刻为准。
6. **环境**：假设已在项目根目录 `venv/` 虚拟环境中运行脚本，且已执行 `init_workspace.py` 初始化工作区目录框架。