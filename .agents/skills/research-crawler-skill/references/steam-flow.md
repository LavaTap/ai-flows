# Steam调用流程

当用户需要采集 Steam 评论时，按以下步骤执行。

## 第一步：确认游戏列表

获取用户需要采集的 Steam 游戏名列表。

## 第二步：执行 Steam 爬虫

运行 Steam 批量采集脚本（此脚本会自动通过 API 匹配 AppID 并抓取评论，生成标准 12 字段结构）：

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/steam/steam_crawler.py --games {游戏名1} {游戏名2} --count {单游戏评论数}
# 或通过文件读取列表：
venv/Scripts/python.exe research-crawler-skill/scripts/steam/steam_crawler.py --file reports/steam/steam_games_list.txt --count 400
```

脚本输出会保存在 `output/steam/{关键词}/{关键词}_{时间戳}/` 目录下：
- `raw/{appid}.csv` — 原始评论（6字段）
- `raw/clean/{appid}_clean.csv` — 清洗后评论（SKILL 12字段，AI字段留空）
- `comments/comments.csv` — 纯评论CSV（序号+评论内容两列）
- `output/output.csv` — 完整数据CSV（SKILL 12字段）

日志目录（与输出会话同名，便于对应）：
- `reports/steam/program/{关键词}_{时间戳}/{时间戳}.log`

## 第三步：AI 分析（可选）

如果用户选择使用 AI 分析，**读取 `references/ai-analysis-flow.md`** 并按其流程执行。
如果用户未选择 AI 分析，跳过此步。AI 字段保持留空，待后续处理。

AI 分析前需先运行预处理脚本生成 `comments/comments_for_ai.csv`（自动截断为前50条）。
