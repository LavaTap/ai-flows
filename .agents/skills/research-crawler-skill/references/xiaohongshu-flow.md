# 小红书搜索+评论采集流程

当用户需要采集小红书笔记评论时，按以下步骤执行。支持多种工作流：
- **批量游戏评论采集** (`batch_cozy_games_crawl.py`) — 从文件读取游戏列表，批量搜索和采集评论
- **分步采集** (`list_get_links.py` → `full_api_crawl.py`) — 先获取链接再逐个爬取评论，适用于自定义链接列表
- **单笔记评论采集** (`full_api_crawl.py`) — 直接采集指定笔记的评论，拦截API直到达到评论总数上限
- **单笔记详情** (`crawl_full_note.py`) — 只获取笔记元数据（点赞/评论/收藏+正文）

## 前提说明

小红书接口需要 x-s/x-t 签名请求头与有效登录 Cookie，纯 requests 无法调用。本流程使用 Playwright 驱动本地 Edge 打开页面，通过 response 拦截捕获接口响应（签名由页面 JS 自动完成）。

### 更新 Cookie

采集前如果提示登录失效，先运行更新 Cookie：

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/xiaohongshu/update_cookie.py
```

脚本会自动打开浏览器 → 你手动登录小红书 → 回车保存 Cookie 到 `cookie.txt`。

## 工作流一：分步采集（推荐批量）

先搜索获取链接，再逐个爬取评论。适合批量多关键词采集。

### 第一步：获取笔记链接列表

在 `research-crawler-skill/scripts/xiaohongshu/keywords.txt` 每行写入一个搜索关键词：
```
原神
崩坏星穹铁道
Bongo Cat
```

运行：
```bash
venv/Scripts/python.exe research-crawler-skill/scripts/xiaohongshu/list_get_links.py
```

结果保存在 `research-crawler-skill/scripts/xiaohongshu/links_data/{关键词}.txt`，每行一个完整笔记URL（含 `xsec_token`）。

### 第二步：逐个爬取评论

对链接文件中的每个URL运行：

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/xiaohongshu/full_api_crawl.py \
    --url "笔记URL" \
    --keyword "搜索关键词" \
    --max 30
```

**参数说明：**
- `--url`: 笔记完整URL（必需，含 `xsec_token`）
- `--keyword`: 搜索关键词（会作为 `output.csv` 中**游戏名称**字段）
- `--max`: 最大爬取评论数上限（默认 500）

**停止逻辑：**
1. 达到评论总数上限或 `--max` 限制 → 停止
2. **连续两次滚动没有新增评论** → 立即停止（大大缩短爬取时间，实测提速 5-10 倍）

**输出目录结构：**
```
output/xiaohongshu/{关键词}/{note_id}_{时间戳}/
├── comments/comments.csv      # 纯评论CSV（序号+评论内容）
└── output/output.csv          # 完整12字段CSV，"游戏名称"字段已正确填入关键词
```

同一关键词（游戏）的所有笔记都会放在同一个 `output/xiaohongshu/{关键词}/` 目录下，便于后续汇总。

## 批量游戏评论采集

批量采集文件中的游戏评论。每个游戏会搜索笔记，并逐篇采集评论，直到达到每个游戏的评论上限。

### 使用方法

1.  **准备游戏列表文件**：创建一个文本文件（例如 `games.txt`），每行写入一个游戏名称。
2.  **运行脚本**：

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/xiaohongshu/batch_cozy_games_crawl.py \
    --game-list "path/to/your/games.txt"
```

### 参数说明

*   `--game-list` (`-f`): 必填。包含游戏名称的文本文件路径，每行一个游戏名。

### 配置参数 (可在脚本内部调整)

以下参数在 `batch_cozy_games_crawl.py` 脚本内部定义，可根据需要修改：

*   `TARGET_TOTAL_COMMENTS_PER_GAME`: 每个游戏的目标总评论数，达到此数量停止采集该游戏。
*   `MAX_NOTES_PER_SEARCH`: 每次搜索最多采集多少篇笔记。
*   `MAX_COMMENTS_PER_NOTE`: 单篇笔记最多采集多少评论。
*   `SKIP_IF_LESS_THAN`: 如果最终累计评论数小于此值，则标记为跳过。

每篇笔记的产出保存在 `output/xiaohongshu/{note_id}/{note_id}_{时间戳}/` 目录下：
- `note_content.txt` — 笔记全文
- `meta.json` — 元数据（note_id、标题、评论数、采集时间、搜索关键词）
- `comments/comments.csv` — 纯评论CSV（序号+评论内容两列）
- `output/output.csv` — SKILL 12 字段（AI 字段留空）

运行日志：`reports/xiaohongshu/program/{关键词}_{时间戳}/{时间戳}.log`

## 工具脚本

### 获取单篇笔记元数据（点赞/评论/收藏/正文）

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/xiaohongshu/crawl_full_note.py --url "笔记URL"
```

输出：
```
output/xiaohongshu/{note_id}/{note_id}_{时间戳}/
├── note_content.txt      # 格式化文本输出
└── meta.json            # JSON 元数据
```

### 修复 CSV 游戏名称（向后兼容）

旧版本爬取错误使用 `note_id` 作为游戏名称，运行此脚本批量修复：

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/xiaohongshu/fix_csv_game_name.py
```

修复逻辑：目录名就是正确游戏关键词 → 写入所有 `output.csv` 的"游戏名称"字段。

## 模式三：单笔记直接采集

直接采集指定笔记的评论。

```bash
venc/Scripts/python.exe research-crawler-skill/scripts/xiaohongshu/full_api_crawl.py \
    --url "https://www.xiaohongshu.com/discovery/item/xxx?xsec_token=xxx" --max 30
```

## 停止逻辑优化

v20260727 更新：连续 **2 次**滚动没有新增评论就立即停止，不需要等待 12 轮。爬取速度提升 **5-10 倍**，对于评论少的笔记只需要 30-40 秒即可完成。

## 输出目录约定

```
output/xiaohongshu/{game_name}/           # 游戏名称（搜索关键词）为目录
└── {note_id}_{timestamp}/              # 单篇笔记会话
    ├── note_content.txt                # 笔记正文（crawl_full_note.py）
    ├── meta.json                       # 元数据（crawl_full_note.py）
    ├── comments/comments.csv           # 纯评论（序号+评论内容）
    └── output/output.csv               # 完整12字段CSV，游戏名称=搜索关键词
```

## 依赖安装（国内镜像）

```bash
venv/Scripts/python.exe -m pip install playwright -i https://mirrors.aliyun.com/pypi/simple/
$env:PLAYWRIGHT_DOWNLOAD_HOST="https://cdn.npmmirror.com/binaries/playwright"
venv/Scripts/python.exe -m playwright install chromium
```

## AI 分析（可选）

如果用户选择使用 AI 分析，**读取 `references/ai-analysis-flow.md`** 并按其流程执行。
AI 分析前需先运行预处理脚本生成 `comments/comments_for_ai.csv`（自动截断为前50条）。
