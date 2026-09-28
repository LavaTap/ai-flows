---
name: gameui-screenshot
description: This skill should be used when the user needs to query game UI screenshots from gameui.net, download game screenshots by style/category, or work with gameui.net APIs. It covers querying game lists by style (欧美/二次元/国风 etc.), fetching screenshots by scene description (登录界面/角色选择/战斗画面 etc.), downloading individual images, and the integrated workflow (crawl → group → collage). Trigger with phrases like "gameui", "游戏截图", "游戏UI", "欧美截图", "二次元截图", "登录界面截图", "游戏截图拼图", "gameui.net API".
---

# gameui-screenshot

gameui.net 游戏截图获取技能，覆盖游戏列表查询、截图栏目获取、单图下载、整合工作流四大场景。

## 核心行为规则

- **先查 CLAUDE.md**：在执行任何需要写文件、修改脚本、或询问用户的操作前，必须先读取项目根目录的 `CLAUDE.md` 文档。CLAUDE.md 中记录了项目的技术栈约束（SSL 跳过、CDN 防盗链、脚本执行路径等）、编码规范和命令表。所有操作必须遵循 CLAUDE.md 中定义的规则，而非自行推断。
- **CLAUDE.md 优先级高于本文件中的脚本参数**：当 CLAUDE.md 中的命令表与下方脚本说明存在差异时，以 CLAUDE.md 为准。
- **文件修改后同步更新**：修改脚本后必须同步更新本 SKILL.md、README.md 和 CLAUDE.md 中的对应说明。
- **分析只分析拼图**：执行游戏截图分析（核心玩法分析、策划案生成等）时，只读取 `concept_combined.png` 拼图文件进行分析，不分析单独的 `concept_1/2/3.png` 等原始截图。拼图包含了游戏多个界面的综合信息，一次分析即可覆盖完整玩法。

## 适用场景

- 按游戏风格查询游戏列表（欧美、二次元、国风、日韩、Q版卡通、科幻、军事）
- 按场景描述获取游戏截图（登录界面、角色选择、战斗画面等）
- 下载单张截图到本地
- **整合工作流：爬取→分组编号→转PNG→拼图**（一键出图）
- 调用 gameui.net 相关 API

## 脚本使用指引

> **输出统一规则**：所有爬取/下载脚本的输出目录统一为 `output/{timestamp}_{描述}/`，其中 `timestamp` 为运行时的 `YYYYMMDD_HHMMSS` 格式。可通过 `--output-dir` 参数自定义。

### 1. 查询游戏列表 — `scripts/core/query_game_list.py`

查询 gameui.net 游戏/文章列表，按风格筛选。

```bash
python scripts/query_game_list.py --style 欧美 --top 5 --output text
python scripts/query_game_list.py --style 二次元 --page 2 --output json
```

**参数**：
- `--style`：游戏风格，可选 `欧美` `二次元` `国风` `日韩` `Q版卡通` `科幻` `军事`
- `--page`：页码（默认 1）
- `--size`：每页条数（默认 30）
- `--sort`：排序字段（默认 createTime）
- `--order`：排序方向（默认 desc）
- `--top`：只取前N条
- `--output`：输出格式 `text` 或 `json`

### 2. 批量获取截图 — `scripts/core/fetch_screenshots.py`

从截图栏目批量获取并下载截图，支持风格和场景双维度筛选。

```bash
# 查询欧美风格的所有截图（仅列出）
python scripts/fetch_screenshots.py --style 欧美 --list-only

# 查询欧美风格的登录界面截图
python scripts/fetch_screenshots.py --style 欧美 --desc 登录界面 --list-only

# 查询并下载前5张二次元战斗画面截图
python scripts/fetch_screenshots.py --style 二次元 --desc 战斗画面 --download 5

# 输出 JSON 格式
python scripts/fetch_screenshots.py --style 国风 --desc 角色选择 --output json
```

**参数**：
- `--style`：游戏风格，同上
- `--desc`：截图场景/功能描述筛选，**支持逗号分隔多值**（如 `登录界面` `服务器选择,游戏通告`）
- `--first`：GraphQL 每页条数（默认 50）
- `--download`：下载前N张图片（默认 2）
- `--list-only`：仅列出不下载
- `--output-dir`：下载输出目录（默认 `output/{timestamp}_截图_{style}/`）
- `--output`：输出格式 `text` 或 `json`

> **注意**: `--desc` 支持逗号分隔多值查询！例如 `--desc "服务器选择,游戏通告,过场动画"` 会同时返回这三种功能的截图。详情见下方"功能分类"表格。

### 3. 单图下载 — `scripts/core/download_image.py`

通过截图 ID 或 CDN URL 直接下载单张图片。

```bash
# 通过 imagesId 下载
python scripts/download_image.py 1959220

# 通过 CDN URL 下载
python scripts/download_image.py "https://image.gameuiux.cn/2026/06/30/xxx.jpg"
```

**参数**：
- `target`：imagesId（数字）或 CDN URL
- `--output-dir`：下载输出目录（默认 `output/{timestamp}_单图/`）

### 4. 按标签和风格筛选截图 — `scripts/workflows/game_screenshot_by_tag.py` ★推荐

按游戏风格和自定义标签筛选截图，每个标签获取约1张，每个风格爬取指定数量的游戏。

```bash
# 欧美、二次元风格，筛选战斗界面和VS/匹配标签，每个风格4个游戏
python scripts/workflows/game_screenshot_by_tag.py --styles "欧美,二次元" --tags "战斗界面,VS/匹配" --count-per-style 4

# 全风格筛选，自定义标签和输出目录
python scripts/workflows/game_screenshot_by_tag.py --styles "欧美,二次元,日韩,Q版卡通" --tags "登录界面,主界面,战斗界面" --output-dir ./my_screenshots
```

**参数**：
- `--styles`: 游戏风格列表，逗号分隔（默认: 欧美,二次元,日韩,Q版卡通）
- `--tags`: 要筛选的标签列表，逗号分隔，例如 "战斗界面,VS/匹配,结算"
- `--count-per-style`: 每个风格目标游戏数（默认 4）
- `--fetch-per-tag`: 每个标签拉取的截图条数（默认 50）
- `--output-dir`: 输出根目录（默认: output/{timestamp}_标签截图/）

**核心流程**：
1. 按标签和风格批量收集截图
2. 按游戏和风格分组
3. 为每个风格选择目标游戏
4. 为每个游戏的每个标签下载一张截图并去重
5. 生成拼图（如果有足够截图）

**输出结构**：
```
output/{timestamp}_标签截图/
  {风格名}/                   ← 风格分类层（如 二次元、欧美、国风...）
    {游戏名1}/
      concept_1.png            # 第1张去重后截图（PNG格式）
      concept_2.png            # 第2张去重后截图
      concept_3.png            # 第3张去重后截图
      concept_4.png            # 第4张（如有）
      concept_combined.png     # 所有图片的拼接图
    {游戏名2}/
      concept_1.png
      concept_2.png
      concept_3.png
      concept_combined.png
    ...
  {风格名2}/
    ...
  _summary.json              # 汇总数据（JSON格式）
```
> **风格分类层**：游戏按风格分目录存放，便于按风格浏览和管理。

**拼图规则**：
- **竖屏图(height > width)** → **横向拼接**（并排排列，适合竖屏截图）
- **横屏图(width > height)** → **纵向拼接**（上下排列，适合横屏截图）
- 自动根据多数图片方向决定拼接方式
- 每组严格3张，不足3张的游戏不生成拼图

### 5. 按游戏类型爬取 — `scripts/workflows/game_core_gameplay_collage.py`

按游戏类型（射击、动作、RPG 等）爬取核心玩法截图并拼图。

```bash
python scripts/workflows/game_core_gameplay_collage.py --game-type "射击游戏" --count 3
```

**参数**：
- `--game-type`：游戏类型（如 `射击游戏` `动作游戏`）
- `--count`：爬取游戏数（默认 3）

### 6. 整理输出目录 — `scripts/organize/reorganize_output.py`

将旧格式（扁平）output 目录整理为新格式（按风格分类）。读取 `_summary.json` 将游戏子文件夹移动到对应风格子目录下。

```bash
# 整理所有 output 子目录
python scripts/reorganize_output.py

# 整理指定目录
python scripts/reorganize_output.py --target output/20260713_102521_xxx

# 预览（不实际移动）
python scripts/reorganize_output.py --dry-run
```

**参数**：
- `--target`：指定目标目录（默认扫描 `output/` 所有子目录）
- `--dry-run`：预览模式，只显示将要执行的操作

### 7. 更新数据库 — `scripts/tools/update_db_from_output.py` + `scripts/tools/export_db.py` ★

扫描 output 目录中的所有游戏截图数据，增量更新到根目录 `db/` 下的 SQLite 数据库。**每次完成截图爬取/整理后，应执行此步骤同步数据库**。

```bash
# 一键更新：扫描所有 output/ 目录，增量同步到数据库
python scripts/tools/update_db_from_output.py

# 指定扫描目录
python scripts/tools/update_db_from_output.py --target output/20260713_102521_xxx

# 重建数据库（清空旧数据全量重新导入）
python scripts/tools/update_db_from_output.py --rebuild

# 仅预览（不写入）
python scripts/tools/update_db_from_output.py --dry-run
```

**参数**：
- `--target`：指定扫描目录（默认 `output/`，扫描所有子目录）
- `--db-path`：数据库路径（默认 `db/game_screenshots.db`）
- `--rebuild`：重建数据库（清空旧数据重新导入）
- `--dry-run`：仅预览扫描结果，不写入数据库

**数据库表结构**：
| 表名 | 字段 | 说明 |
|------|------|------|
| `games` | id, name, style, screenshot_count, collage_exists, source_dir, planning_doc_path, created_at | 游戏信息表 |
| `screenshots` | id, game_id, filename, path, type(single/collage), width, height, created_at | 截图明细表 |
| `planning_docs` | id, game_id, file_path, content_preview, analysis_status, model_check, generated_at, created_at | 策划案记录表 |

**更新逻辑**：
- 按 `(name, style, source_dir)` 三元组去重，已存在则更新字段，不存在则新增
- 每次更新会刷新该游戏的 screenshots 明细表
- 检测策划案文件 `planning_doc.md` 存在则同步记录

### 8. 生成策划案 — `scripts/workflows/generate_planning.py` ★核心玩法分析

基于游戏中的 **`concept_combined.png` 拼接图**（遵循「分析只分析拼图」规则），使用 AI 多模态分析核心玩法并输出结构化策划案。**分析前自动检测识图模型可用性**。

```bash
# 检测识图模型是否可用
python scripts/workflows/generate_planning.py --check-model

# 列出待分析的游戏（有拼图但无策划案）
python scripts/workflows/generate_planning.py --list-pending
python scripts/workflows/generate_planning.py --list-pending --style 欧美

# 列出所有游戏及其分析状态
python scripts/workflows/generate_planning.py --list-all

# 准备指定游戏的分析上下文（包含策划案模板）
python scripts/workflows/generate_planning.py --prepare --game-id 1

# 保存策划案到游戏目录（分析完成后）
python scripts/workflows/generate_planning.py --save --game-id 1 --content-file ./planning_doc.md
```

**参数**：
- `--check-model`：检测识图模型可用性（Pillow + 环境变量检测）
- `--list-pending`：列出待分析的游戏（有拼图无策划案）
- `--list-all`：列出所有游戏及其分析状态
- `--generate`：自动遍历所有待分析游戏并输出分析上下文
- `--limit N`：`--generate` 模式下限制输出数量（默认 10）
- `--prepare` - `--game-id X`：输出单个游戏分析上下文 + 策划案模板
- `--save` - `--game-id X` - `--content-file <file>`：保存策划案并更新数据库
- `--style`：按风格筛选（配合 `--list-pending` / `--list-all` / `--generate`）
- `--db-path`：数据库路径

**核心流程**：
1. 检测识图模型可用性（Pillow 安装 + 环境变量检测）
2. 从数据库读取游戏列表和截图信息
3. 读取 `concept_combined.png` 拼接图进行多模态分析（分析唯一依据）
4. 自动推断游戏类型（格斗/射击/MOBA/卡牌等 19 种）
5. 匹配品类专用的分析维度（核心循环模式、关键界面、分析重点）
6. 生成结构化策划案 Markdown 文档
7. 保存策划案到游戏目录 `{game_dir}/planning_doc.md`
8. 同步更新数据库 `planning_docs` 表和 `games.planning_doc_path` 字段

**分析框架参考**：
完整的策划案分析框架、分品类风格适配和撰写模板已移至：
`references/game_planning_framework.md`

分析游戏玩法时会参考该文档中的标准化框架。

**策划案文档结构**（对照游戏策划案行业规范）：
```
游戏目录/
  planning_doc.md    # 结构化策划案文档
  concept_1.png      # 去重截图
  concept_2.png
  concept_3.png
  concept_combined.png  # 拼接图（分析依据）
```

## API 参考指引

详细 API 接口规范见 `references/api_index.md`，逆向分析过程见 `references/api_reverse.md`。

**核心 API 流程**：
1. 游戏列表 → REST `POST /web/v1/article/list`（`style` 参数控制风格筛选）
2. 截图列表 → GraphQL `GET /api?query={images(...)}`（`style` + `images_desc` 控制场景筛选）
3. 截图详情 → REST `GET /web/v1/images/detail/v2?imagesId=X`（获取 CDN 下载 URL）
4. 图片下载 → CDN URL + `Referer: https://www.gameui.net/` 头（防 403）

**关键注意**：
- 所有 API 无需登录/Cookie
- 图片 CDN 需 Referer 头防盗链
- Python 需 `verify=False` + `urllib3.disable_warnings()` 跳过 SSL 验证

## 风格与场景速查

**游戏风格**（`style` 参数）：
| 风格 | 说明 |
|------|------|
| 欧美 | 欧美风格游戏 |
| 二次元 | 二次元/动漫风格 |
| 国风 | 中国风/国风游戏 |
| 日韩 | 日韩风格游戏 |
| Q版卡通 | Q版卡通风格 |
| 科幻 | 科幻题材游戏 |
| 军事 | 军事题材游戏 |

**截图场景**（`images_desc` 参数，"场景"标签页）：
| 场景 | 说明 | API 状态 |
|------|------|----------|
| 登录界面 | 游戏登录/启动画面 | ✅ 有数据 |
| 主界面 | 游戏主界面/HUD | ✅ 有数据 |
| 角色选择 | 角色创建/选择界面 | ❌ 无数据 |
| 战斗画面 | 战斗/对决场景截图 | ❌ 无数据 |
| 商店界面 | 商城/商店UI | ❌ 无数据 |
| 设置界面 | 游戏设置/选项界面 | ❌ 无数据 |

**功能分类**（`images_desc` 参数，"功能"标签页，**支持逗号分隔多值勾选**）：
| 分类 | 说明 |
|------|------|
| `服务器选择` | 服务器选择界面 |
| `游戏通告` | 游戏公告/系统通知 |
| `过场动画` | 过场动画/CG |
| `新手引导` | 新手教程/引导 |
| `主界面` | 主界面/HUD |
| `Loading` | 加载界面 |
| `战斗界面` | 战斗/对战界面 |
| `战斗提示` | 战斗提示/操作指引 |
| `VS/匹配` | VS画面/匹配界面 |
| `升级提示` | 升级提示界面 |
| `恭喜获得` | 获得物品/奖励弹窗 |
| `结算` | 结算/结果界面 |
| `数据统计` | 数据统计界面 |
| `姓名输入` | 姓名/昵称输入 |
| `NPC对话` | NPC对话界面 |
| `章节提示` | 章节/关卡提示 |
| `阵营选择` | 阵营/势力选择 |
| `功能解锁` | 功能解锁提示 |
| `菜单` | 菜单界面 |
| `玩家信息` | 玩家信息/资料 |
| `角色` | 角色/英雄列表 |
| `背包` | 背包/仓库 |
| `锻造/合成` | 锻造/合成系统 |
| `技能` | 技能系统 |
| `任务` | 任务系统 |
| `成就` | 成就系统 |
| `关卡/挑战` | 关卡/挑战模式 |
| `公会/帮派` | 公会/帮派系统 |
| `外观/时装` | 外观/时装界面 |
| `图鉴` | 图鉴/收集系统 |

> **用法示例**: `--desc "服务器选择,游戏通告,过场动画"` 可同时查询三类功能截图


