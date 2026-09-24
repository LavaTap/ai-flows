---
name: research-crawler-skill
description: 游戏评论采集与治愈向正向复核分析。支持B站、Steam、小红书三平台，采集热度评论、基础清洗、可选AI分析（情绪/治愈相关度/标签标注）。
description_zh: 游戏评论采集与治愈向正向复核分析。支持B站、Steam、小红书三平台。按平台读取流程文档，可选AI分析。
---

# 游戏评论采集与治愈向分析

本 skill 采集游戏相关评论并按治愈游戏研究框架进行情绪、治愈相关度和标签标注。支持 B站、Steam、小红书三平台，以及可选 AI 分析和 Excel 汇总。

## 首次加载初始化（最高优先级，先于一切流程执行）

**首次加载本 skill 时，必须先运行工作区初始化脚本，然后再进行任何其他步骤。** 该脚本创建与 skill 同级的 `output/`、`excel/`、`reports/` 目录框架（含各平台 `ai/error/limit/program` 子目录）。脚本幂等，已存在的目录不会被删除，仅补建缺失目录。

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

若 `output/`、`excel/`、`reports/` 任一缺失，**必须重新运行 init_workspace.py 补建**，不得手动创建或让脚本写出到不存在的目录。

## 环境要求（先于采集流程执行）

**所有脚本必须在项目根目录的虚拟环境 `venv/` 中运行。搭建环境前必须先向用户说明以下目的：**

> 本项目的全部依赖都安装在项目根目录的 `venv/` 虚拟环境中，与你电脑本身的 Python 环境完全隔离。目的是**不污染、不破坏你电脑本身的 Python 环境**——所有包的安装、升级、卸载只影响项目内部，删除 `venv/` 文件夹即可彻底清理，系统中不留任何残留。

**⚠️ 长时间卡停提醒**：搭建虚拟环境或下载浏览器过程中，如遇到进程卡停时间过长，用户可以直接终止进程。AI 将自动尝试重新搭建（如重建 venv、重试下载等），无需用户手动干预。

### 执行规则

1. **虚拟环境位置**：项目根目录 `venv/`（Windows：`venv/Scripts/python.exe`；macOS/Linux：`venv/bin/python`）
2. **环境缺失时**先在项目根目录创建：
   ```bash
   python -m venv venv
   ```
3. **pip 安装必须使用国内镜像**（阿里云，避免境外源超时）：
   ```bash
   venv/Scripts/python.exe -m pip install <包名> -i https://mirrors.aliyun.com/pypi/simple/
   ```
4. **Playwright 浏览器下载必须使用国内镜像**（如仍需 Playwright，使用 npmmirror 二进制源）：
   ```powershell
   $env:PLAYWRIGHT_DOWNLOAD_HOST="https://cdn.npmmirror.com/binaries/playwright"
   venv/Scripts/python.exe -m playwright install chromium
   ```
   **优先使用 Selenium + webdriver-manager**（仅下载 ~10MB ChromeDriver，使用本地 Chrome，无需 183MB Chromium）：
   ```bash
   venv/Scripts/python.exe -m pip install selenium webdriver-manager -i https://mirrors.aliyun.com/pypi/simple/
   ```
5. **运行脚本必须使用 venv 内解释器**，禁止使用系统 Python
6. **venv 损坏时**：删除 `venv/` 后按第 2-4 步重建，不得改用系统 Python 绕过

### 依赖清单

| 依赖 | 用途 | 安装方式 |
|---|---|---|
| requests | API 请求 | pip（国内镜像） |
| beautifulsoup4 | HTML 解析 | pip（国内镜像） |
| pandas + openpyxl | Excel 合并与排版 | pip（国内镜像） |
| selenium + webdriver-manager | 小红书等需浏览器签名的平台（ChromeDriver ~10MB，使用本地 Chrome） | pip（国内镜像） |
| selenium + webdriver-manager | 备用浏览器方案 | pip（国内镜像） |

## 意图路由

当用户调用本 skill 时，根据意图匹配以下流程并**读取对应参考文档**：

| 用户意图 | 读取参考文档 | 说明 |
|---|---|---|
| 采集 **B站** 评论 | `references/bilibili-flow.md` | 搜索→确认→采集，两阶段流程 |
| 采集 **Steam** 评论 | `references/steam-flow.md` | 自动匹配 AppID 并采集 |
| 采集 **小红书** 评论 | `references/xiaohongshu-flow.md` | Playwright 捕获评论接口 |
| 合并为 **Excel** | 执行 `scripts/flow/merge_all_to_excel.py`（按平台输出到 `excel/{平台}_{时间戳}.xlsx`） | 无需额外文档 |
| **AI 分析**评论 | 询问用户是否需要 → 确认后读取 `references/ai-analysis-flow.md` | 各平台共用 |
| **错误检测**/清理 | 见下方「采集后错误检测与清理流程」章节 | 采集后必须执行 |
| 其他/未知意图 | 询问用户具体需求后再路由 | — |

**AI 分析路由规则**：主文档只询问用户「是否需要 AI 分析」并记录选择。确认需要后，读取 `references/ai-analysis-flow.md` 执行详细流程；不需要则 AI 字段留空。

## 数据路径约定

所有产出按平台及关键词分组：

```
output/{平台}/{关键词}/{关键词}_{时间戳}/
├── link/video_links.txt                # 视频链接清单 (B站特有)
├── search_result.json                  # 搜索元数据 (B站特有)
├── raw/
│   ├── {id}.csv                       # 原始评论
│   └── clean/
│       └── {id}_clean.csv              # 逐视频清洗CSV（12字段）
├── comments/
│   ├── comments.csv                   # 纯评论CSV（序号+评论内容，全部评论）
│   └── comments_for_ai.csv            # AI分析输入CSV（≤50条）★首选
├── analysis/
│   └── output.csv                     # AI分析结果（≤50条，12字段全填充）
└── output/
    └── output.csv                      # 全量评论（AI分析后已分析行填充AI字段）

日志与报告（独立存放，按平台归类，ai/error/limit 与 program 平级）：
reports/{平台}/program/{会话名}/{时间戳}.log                    # 运行日志（会话名与output目录同名）
reports/{平台}/program/{会话名}/{时间戳}_report.md              # 采集报告
reports/{平台}/program/{会话名}/{时间戳}_clean_report.log       # 清洗报告（--clean-report 时）
reports/{平台}/ai/{会话名}/ai_report.md                         # AI分析报告（文件夹名与output目录同名）
reports/{平台}/ai/batch_{时间戳}/ai_batch_report.md             # AI批量汇总报告
reports/{平台}/error/output_errors.log                          # 错误检测报告
reports/{平台}/error/delete_output.log                          # 删除操作报告
reports/{平台}/limit/limit_{时间戳}/report.md                   # AI预处理（截断）报告
reports/{平台}/program/batch_{时间戳}/                          # 批量爬取汇总（batch_crawl/batch_steam使用）

Excel 汇总（按平台独立输出，每平台一个文件）：
excel/{平台}_{时间戳}.xlsx                                       # 如 bilibili_20260724_120000.xlsx
```

CSV 内"平台"字段按实际来源填写（`B站`/`Steam`/`小红书`），与目录结构无关。

# 采集后错误检测与清理流程

每次完成一轮爬取后，**必须**执行以下流程检查产出完整性。

## 步骤 1：检测失败项目

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/tools/check_output_errors.py
```

脚本检测两类错误，生成报告到 `reports/{平台}/error/output_errors.log`：

1. **output 缺失项目** — 扫描 `output/{平台}/` 下所有游戏会话，找出没有 `output/output.csv` 的失败项目（仅完成搜索未完成采集）
2. **日志错误记录** — 扫描 `reports/{平台}/program/` 下所有 `.log` 文件，找出包含 `ERROR`/错误/失败/跳过 的记录（包括无 output 产出的采集失败，如 AppID 匹配失败等）

## 步骤 2：发送报告并询问用户

读取 `reports/{平台}/error/output_errors.log`，将失败项目清单发送给用户，询问：

> 检测到 N 个失败项目（仅有搜索无采集）。是否知悉？
> - **删除**：清除这些失败项目文件夹（运行 `delete_output_errors.py`）
> - **重试**：重新对这些游戏执行采集流程

## 步骤 3a：用户选择删除

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/tools/delete_output_errors.py
```

删除所有失败项目子文件夹，同时清理变空的游戏文件夹。删除结果写入 `reports/{平台}/error/delete_output.log`。

## 步骤 3b：用户选择重试

对失败的游戏重新执行对应平台的采集流程（读取对应平台 reference 文档）。
重试后再次运行步骤 1 确认。

## 参考文档索引

| 文档 | 内容 | 何时读取 |
|---|---|---|
| `references/bilibili-flow.md` | B站完整采集流程（5步） | 用户意图采集B站评论时 |
| `references/steam-flow.md` | Steam完整采集流程 | 用户意图采集Steam评论时 |
| `references/xiaohongshu-flow.md` | 小红书完整采集流程 | 用户意图采集小红书评论时 |
| `references/ai-analysis-flow.md` | AI分析完整流程（5步+批量） | 用户确认需要AI分析时 |
| `references/output-fields.md` | 12 字段定义、标签体系 | AI 分析前 |
| `references/analysis-rules.md` | 正向优先规则、治愈评分、两轮流程 | AI 分析前 |

## 脚本目录结构

```
scripts/
├── bilibili/              # B站平台爬取
│   └── bridge.py
├── steam/                 # Steam平台爬取
│   ├── steam_crawler.py
│   ├── clean_steam_reviews.py
│   └── check_and_retry_steam.py
├── xiaohongshu/           # 小红书平台爬取
│   └── xhs_qrcode_crawler.py
├── tools/                 # 工具脚本（清洗、提取、错误检测等）
│   ├── init_workspace.py
│   ├── extract_comments.py
│   ├── check_output_errors.py
│   ├── delete_output_errors.py
│   ├── limit_comments_for_ai.py
│   ├── extract_errors.py
│   ├── process_comments.py
│   └── reorganize_reports.py
├── flow/                  # 工作流脚本（批量编排、汇总）
│   ├── batch_crawl.py
│   ├── batch_steam_crawl.py
│   ├── batch_ai_analysis.py
│   ├── merge_all_to_excel.py
│   └── generate_report.py
└── test/                  # 测试脚本
    └── test_steam_api.py
```

## 评论清洗规则

B站评论采集时执行基础清洗（`bridge.py` 的 `basic_clean`）：

1. **去重**：相同 rpid 的评论只保留一条
2. **去空**：评论内容为空的丢弃
3. **去@回复**：以 `@` 或 `回复 @` 开头的回复去除元信息
4. **去纯表情**：仅含单个表情符号（去除 `[xxx]` 后长度 ≤1）的丢弃
5. **规范化空白**（`normalize_whitespace`）：所有换行符替换为空格，合并连续空格/tab，使每条评论为**单行**——避免 CSV 内嵌换行导致行数膨胀

## 脚本清单

| 脚本 | 作用 | 何时运行 |
|---|---|---|
| `scripts/tools/init_workspace.py` | 初始化工作区目录框架（output/excel/reports 各平台 ai/error/limit/program） | **首次加载 skill 必须先运行**；目录缺失时补建 |
| `scripts/bilibili/bridge.py` | B站搜索+采集+清洗（两阶段编排器，含 normalize_whitespace 单行清洗） | B站流程 |
| `scripts/steam/steam_crawler.py` | Steam 评论采集（自动匹配 AppID） | Steam 流程 |
| `scripts/xiaohongshu/batch_cozy_games_crawl.py` | 小红书批量游戏评论采集（从文件读取游戏列表，批量搜索采集） | 小红书流程 |
| `scripts/xiaohongshu/list_get_links.py` | 小红书搜索笔记并获取链接 | 小红书流程 |
| `scripts/xiaohongshu/full_api_crawl.py` | 小红书单篇笔记评论采集（Playwright+CDP 捕获接口） | 小红书流程 |
| `scripts/flow/merge_all_to_excel.py` | 按平台合并 output.csv 为 Excel，每平台输出 `excel/{平台}_{时间戳}.xlsx`（动态行高排版） | 数据汇总 |
| `scripts/tools/limit_comments_for_ai.py` | 评论预处理：读取 comments.csv/output.csv 生成 comments_for_ai.csv（>50条截断），报告→`reports/{平台}/limit/` | AI 分析前 |
| `scripts/flow/batch_ai_analysis.py` | 批量 AI 分析：生成 analysis/output.csv + 合并回 output/output.csv + 每会话AI报告→`reports/{平台}/ai/` | AI 分析 |
| `scripts/flow/batch_crawl.py` | 批量爬取多游戏评论（B站） | 批量采集 |
| `scripts/flow/batch_steam_crawl.py` | 批量 Steam 爬取 | 批量 Steam 采集 |
| `scripts/tools/check_output_errors.py` | 检测 output 缺失项目 + 日志错误记录（报告→`reports/{平台}/error/output_errors.log`） | 采集后 |
| `scripts/tools/delete_output_errors.py` | 删除失败项目文件夹（报告→`reports/{平台}/error/delete_output.log`） | 用户选择删除 |
| `scripts/flow/generate_report.py` | 生成项目总报告 | 批量采集后 |
| `scripts/tools/reorganize_reports.py` | 整理旧版 reports 目录结构 | 报告归档 |

## 红线规则

- 不得在虚拟环境 `venv/` 之外安装依赖或运行采集脚本，安装依赖前必须告知用户隔离目的
- 下载 pip 包 / Playwright 浏览器必须优先使用国内镜像，不得默认走境外源
- 搭建环境时如进程卡停过长，提醒用户可随时终止，AI 应尝试自行重建
- 不得在未获取用户全部必要参数前开始采集
- 不得在用户未确认视频链接前执行评论采集（B站）
- 不得改写玩家评论原文
- 不得为了提高正向比例把强负评硬判为正向
- 不得删除可疑负向样本
- 不得在未读取参考文档的情况下进行 AI 分析
- 本 skill 修改脚本时，不得添加任何 emoji。
