# B站「学生管理系统」评论采集方案与执行说明

## 一、任务理解

用户需求为：在哔哩哔哩平台搜索关键词「学生管理系统」，按人气排行取前 10 条视频，并采集这些视频的评论数据。

本 skill 对 B站采用**两阶段流程**：先搜索并确认视频链接，再执行评论采集。按红线规则，**在用户确认视频链接之前，不得执行评论采集**。因此本文档先完成第一阶段（搜索与候选清单），并给出确认后的采集执行方案。

## 二、环境与工作区准备

### 2.1 虚拟环境说明

本项目全部依赖安装在项目根目录的 `venv/` 虚拟环境中，与用户电脑本身的 Python 环境完全隔离。目的是**不污染、不破坏用户本身的 Python 环境**——所有包的安装、升级、卸载只影响项目内部，删除 `venv/` 文件夹即可彻底清理，系统中不留任何残留。

若 `venv/` 不存在，先在项目根目录创建：

```bash
python -m venv venv
```

pip 安装统一使用国内镜像（阿里云），避免境外源超时：

```bash
venv/Scripts/python.exe -m pip install requests beautifulsoup4 pandas openpyxl -i https://mirrors.aliyun.com/pypi/simple/
```

如遇搭建或下载进程长时间卡停，用户可直接终止进程，AI 将自动尝试重建 venv 或重试下载，无需用户手动干预。

### 2.2 工作区初始化（最高优先级）

首次加载本 skill 时，必须先运行工作区初始化脚本，再进行任何其他步骤。该脚本创建与 skill 同级的 `output/`、`excel/`、`reports/` 目录框架（含各平台 `ai/error/limit/program` 子目录）。脚本幂等，已存在的目录不会被删除，仅补建缺失目录。

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/tools/init_workspace.py
```

初始化后目录框架：

```
{项目根}/
├── research-crawler-skill/   ← 本 skill
├── output/{bilibili,steam,xiaohongshu}/   ← 各平台采集产出
├── excel/                    ← 各平台 Excel 汇总（每平台一个文件）
└── reports/{bilibili,steam,xiaohongshu}/
    ├── ai/        ← AI 分析报告
    ├── error/     ← 错误检测报告
    ├── limit/     ← AI 预处理（截断）报告
    └── program/   ← 运行日志与采集报告（按会话名分子目录）
```

若 `output/`、`excel/`、`reports/` 任一缺失，必须重新运行 `init_workspace.py` 补建，不得手动创建或让脚本写出到不存在的目录。

## 三、第一阶段：搜索与视频确认（B站）

### 3.1 执行方式

读取 `references/bilibili-flow.md`，按其两阶段流程执行搜索阶段。搜索阶段由 `scripts/bilibili/bridge.py` 编排，产出：

```
output/bilibili/学生管理系统/学生管理系统_{时间戳}/
├── link/video_links.txt        # 视频链接清单
└── search_result.json          # 搜索元数据（含标题、UP主、播放量、弹幕数等）
```

### 3.2 排序口径

按「人气排行」取前 10 条。B站搜索接口的排序参数中，人气对应综合热度排序（`order=totalrank`，即综合排序，权重含播放、弹幕、评论、收藏、投币等）。若需更贴近「播放量」口径，可改用 `order=click`（按播放量）。本方案默认采用**综合人气排序**，并在 `search_result.json` 中保留原始排序字段以便复核。

### 3.3 候选视频清单（待用户确认）

搜索完成后，需向用户展示候选清单，格式如下（实际数值以脚本运行结果为准，下表为字段结构示例）：

| 序号 | 视频标题 | UP主 | 播放量 | 弹幕数 | 链接 |
|---|---|---|---|---|---|
| 1 | （搜索结果第 1 条） | — | — | — | https://www.bilibili.com/video/BV... |
| 2 | （搜索结果第 2 条） | — | — | — | https://www.bilibili.com/video/BV... |
| … | … | … | … | … | … |
| 10 | （搜索结果第 10 条） | — | — | — | https://www.bilibili.com/video/BV... |

**质量门禁**：此清单必须经用户确认（可增删、可替换、可调整排序口径）后，方可进入第二阶段。未确认前不得采集评论。

## 四、第二阶段：评论采集（确认后执行）

### 4.1 采集与清洗

用户确认链接后，运行 `scripts/bilibili/bridge.py` 的采集阶段，对每条视频抓取评论。采集时执行基础清洗（`basic_clean`）：

1. **去重**：相同 rpid 的评论只保留一条
2. **去空**：评论内容为空的丢弃
3. **去@回复**：以 `@` 或 `回复 @` 开头的回复去除元信息
4. **去纯表情**：仅含单个表情符号（去除 `[xxx]` 后长度 ≤1）的丢弃
5. **规范化空白**（`normalize_whitespace`）：所有换行符替换为空格，合并连续空格/tab，使每条评论为**单行**，避免 CSV 内嵌换行导致行数膨胀

### 4.2 产出结构

```
output/bilibili/学生管理系统/学生管理系统_{时间戳}/
├── link/video_links.txt
├── search_result.json
├── raw/
│   ├── {id}.csv                       # 原始评论
│   └── clean/
│       └── {id}_clean.csv              # 逐视频清洗CSV（12字段）
├── comments/
│   ├── comments.csv                   # 纯评论CSV（序号+评论内容，全部评论）
│   └── comments_for_ai.csv            # AI分析输入CSV（≤50条）
├── analysis/
│   └── output.csv                     # AI分析结果（≤50条，12字段全填充）
└── output/
    └── output.csv                      # 全量评论（AI分析后已分析行填充AI字段）
```

日志与报告独立存放：

```
reports/bilibili/program/学生管理系统_{时间戳}/{时间戳}.log
reports/bilibili/program/学生管理系统_{时间戳}/{时间戳}_report.md
reports/bilibili/program/学生管理系统_{时间戳}/{时间戳}_clean_report.log
```

CSV 内「平台」字段按实际来源填写为 `B站`。

## 五、采集后错误检测与清理（必做）

每完成一轮爬取后，必须执行以下流程检查产出完整性。

### 5.1 检测失败项目

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/tools/check_output_errors.py
```

脚本检测两类错误，生成报告到 `reports/bilibili/error/output_errors.log`：

1. **output 缺失项目** — 扫描 `output/bilibili/` 下所有游戏会话，找出没有 `output/output.csv` 的失败项目（仅完成搜索未完成采集）
2. **日志错误记录** — 扫描 `reports/bilibili/program/` 下所有 `.log` 文件，找出包含 `ERROR`/错误/失败/跳过 的记录

### 5.2 发送报告并询问用户

读取 `reports/bilibili/error/output_errors.log`，将失败项目清单发送给用户，询问：

> 检测到 N 个失败项目（仅有搜索无采集）。是否知悉？
> - **删除**：清除这些失败项目文件夹（运行 `delete_output_errors.py`）
> - **重试**：重新对这些游戏执行采集流程

### 5.3 分支处理

- 用户选择删除：

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/tools/delete_output_errors.py
```

删除所有失败项目子文件夹，同时清理变空的游戏文件夹。删除结果写入 `reports/bilibili/error/delete_output.log`。

- 用户选择重试：对失败项目重新执行 B站采集流程，重试后再次运行步骤 5.1 确认。

## 六、Excel 汇总

数据汇总按平台独立输出，每平台一个文件：

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/flow/merge_all_to_excel.py
```

输出：`excel/bilibili_{时间戳}.xlsx`，含动态行高排版。

## 七、AI 分析（可选，需用户确认）

主流程只负责询问用户「是否需要 AI 分析」并记录选择。确认需要后，读取 `references/ai-analysis-flow.md` 执行详细流程；不需要则 AI 字段留空。

### 7.1 预处理（截断）

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/tools/limit_comments_for_ai.py
```

读取 `comments.csv`/`output.csv` 生成 `comments_for_ai.csv`（超过 50 条时截断），报告写入 `reports/bilibili/limit/limit_{时间戳}/report.md`。

### 7.2 批量分析

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/flow/batch_ai_analysis.py
```

生成 `analysis/output.csv`，合并回 `output/output.csv`，每会话 AI 报告写入 `reports/bilibili/ai/{会话名}/ai_report.md`，批量汇总写入 `reports/bilibili/ai/batch_{时间戳}/ai_batch_report.md`。

### 7.3 分析规则约束

分析前必须读取 `references/output-fields.md`（12 字段定义、标签体系）与 `references/analysis-rules.md`（正向优先规则、治愈评分、两轮流程）。执行中遵守：

- 不得改写玩家评论原文
- 不得为了提高正向比例把强负评硬判为正向
- 不得删除可疑负向样本

## 八、执行顺序总览

1. 运行 `init_workspace.py` 初始化工作区（首次加载必做）
2. 确认 `venv/` 环境与依赖（国内镜像安装）
3. 读取 `references/bilibili-flow.md`，执行搜索阶段，产出候选清单
4. **向用户展示候选清单并等待确认**（质量门禁）
5. 用户确认后执行评论采集与清洗
6. 运行 `check_output_errors.py`，向用户报告失败项目并按其选择删除或重试
7. 运行 `merge_all_to_excel.py` 生成 `excel/bilibili_{时间戳}.xlsx`
8. 询问用户是否需要 AI 分析；确认后按 `references/ai-analysis-flow.md` 执行

## 九、依据与未验证假设

### 依据

- 本 skill 主文档「意图路由」「数据路径约定」「评论清洗规则」「采集后错误检测与清理流程」「红线规则」章节
- `references/bilibili-flow.md`（B站两阶段采集流程）
- `references/output-fields.md`、`references/analysis-rules.md`（AI 分析字段与规则）
- 脚本清单中 `scripts/bilibili/bridge.py`、`scripts/tools/init_workspace.py`、`scripts/tools/check_output_errors.py`、`scripts/tools/delete_output_errors.py`、`scripts/tools/limit_comments_for_ai.py`、`scripts/flow/batch_ai_analysis.py`、`scripts/flow/merge_all_to_excel.py` 的职责定义

### 未验证假设

- 假设 B站搜索接口在本次执行时可用且返回结果稳定；实际候选视频的标题、UP主、播放量、弹幕数、BV 号需以脚本运行输出为准，本文档未预填具体数值。
- 假设「人气排行」对应综合排序参数 `order=totalrank`；若用户实际期望按播放量排序，需改用 `order=click`，此口径差异尚未与用户确认。
- 假设目标视频评论区可正常访问且评论量在可采集范围内；若存在仅粉丝可见、已关闭评论区或需登录态的情况，采集可能失败并进入错误检测流程。
- 假设用户会在候选清单确认环节给出明确反馈；在未收到确认前，评论采集阶段不会启动。
- 假设 `venv/` 尚未创建或依赖尚未安装；实际执行时需先探测环境状态，已存在则跳过对应安装步骤。
- 假设 AI 分析为可选项且默认不执行；是否启用需用户明确确认。