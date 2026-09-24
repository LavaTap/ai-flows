# B站调用流程（必须严格遵守）

当用户调用本 skill 进行 B站评论采集时，**必须**按以下顺序执行，不得跳过任何步骤。

## 第一步：收集参数

向用户确认以下 5 个参数，缺一不可：

| 参数 | 说明 | 示例 |
|---|---|---|
| 游戏名称（关键词） | B站搜索关键词，同时作为目录名 | 崩坏星穹铁道 |
| 爬取视频条数 | 取搜索结果前 N 条视频 | 10 |
| 每条视频爬取评论条数 | 每个视频采集的热度评论数 | 100 |
| 是否使用 AI 分析评论 | 是：AI 填充 8 个分析字段；否：留空后续处理 | 否 |
| 是否生成报告 md | 是：阶段二完成后生成 `reports/{platform}/program/{session_name}/{ts}_report.md`；否：不生成 | 是 |

如果用户未提供全部参数，**必须逐一向用户询问**，不得使用默认值继续。

## 第二步：搜索视频（阶段一）

运行搜索脚本（venv 下）：

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/bilibili/bridge.py \
    --keyword {关键词} --video-count {N} --search-only
```

脚本会创建会话目录 `output/bilibili/{关键词}/{关键词}_{时间戳}/` 并保存：
- `link/video_links.txt` — 视频链接清单
- `search_result.json` — 搜索结果元数据（供阶段二使用）

日志目录（与输出会话同名，便于对应）：
- `reports/bilibili/program/{关键词}_{时间戳}/{时间戳}.log`

脚本输出会打印 `SESSION_DIR=...`，记录此路径供阶段二使用。

## 第三步：视频链接确认（必须暂停等待用户）

读取 `{会话目录}/link/video_links.txt` 文件内容，发送给用户，并询问：

> 请检查以上视频链接：
> 1. 视频内容是否符合要求？
> 2. 是否有无法访问或无权限的视频？
> 3. 是否可以继续采集评论？
>
> 如需调整关键词或参数，请告知。如有个别视频需要跳过，请提供其 BVID。

**必须等待用户明确确认后才能继续。** 不得自动跳过此步。

如果用户要求调整关键词或参数，重新执行第二步。
如果用户指出需要跳过某些视频（提供 BVID），在第四步使用 `--skip-bvids` 参数跳过。

## 第四步：采集评论（阶段二）

用户确认后，运行采集脚本：

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/bilibili/bridge.py \
    --crawl-only --session-dir {会话目录路径} \
    --keyword {关键词} --comment-count {M} \
    [--skip-bvids BVxxx,BVyyy] \
    [--no-report-md]   # 如不需要报告md则加此参数
    [--clean-report]   # 如需要清洗报告则加此参数
```

此阶段对每条视频逐一采集评论、基础清洗、提取纯文本，产出：
- `raw/{bvid}.csv` — 每个视频的原始评论（6字段）
- `raw/clean/{bvid}_clean.csv` — 每个视频的清洗后评论（SKILL 12字段，AI 字段留空）
- `output/output.csv` — **全部视频合并**的完整数据CSV（序号全局递增，SKILL 12字段）
- `comments/comments.csv` — 全部视频评论的纯评论CSV（序号+评论内容两列）

日志目录（与输出会话同名，便于对应）：
- `reports/bilibili/program/{关键词}_{时间戳}/{时间戳}.log`
- `reports/bilibili/program/{关键词}_{时间戳}/{时间戳}_report.md`

## 第五步：AI 分析（仅当用户选择「是」）

如果用户选择使用 AI 分析，**读取 `references/ai-analysis-flow.md`** 并按其流程执行。
如果用户未选择 AI 分析，跳过此步。AI 字段保持留空，待后续处理。

AI 分析前需先运行预处理脚本生成 `comments/comments_for_ai.csv`（自动截断为前50条），
AI 分析结果保存在 `analysis/output.csv` 中。
