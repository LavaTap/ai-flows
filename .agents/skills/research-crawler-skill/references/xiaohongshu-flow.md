# 小红书搜索+评论采集流程

当用户需要采集小红书笔记评论时，按以下步骤执行。支持两种模式：**搜索模式**（按关键词搜索笔记并采集评论）和 **单笔记模式**（直接采集指定笔记的评论）。

## 前提说明

小红书接口需要 x-s/x-t 签名请求头与有效登录 Cookie，纯 requests 无法调用。本流程使用 Playwright 驱动本地 Edge 打开页面，通过 response 拦截捕获接口响应（签名由页面 JS 自动完成）。仅需下载 ~10MB 的 ChromeDriver（webdriver-manager 自动完成），无需下载 Playwright 的 183MB Chromium。

首次运行如遇到登录弹窗，请在浏览器窗口扫码登录，Cookie 会自动保存到脚本目录 `.xhs_cookies.pkl` 复用。

## 模式一：搜索模式（推荐）

按关键词搜索笔记，采集前 N 条笔记的评论。

### 第一步：确认参数

| 参数 | 说明 | 默认值 |
|---|---|---|
| 搜索关键词 | 需要搜索的关键词（必需） | 无 |
| 笔记数量 | 采集前 N 条笔记 | 10 |
| 每笔记评论数 | 每篇笔记采集的评论数 | 20 |

### 第二步：执行搜索采集

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/xiaohongshu/xhs_qrcode_crawler.py \
    --search "关键词" --note-count 10 --max-comments 20
```

搜索全链路接口流程（详见 `references/api/xiaohongshu.md`「搜索全链路接口」）：
1. 通用行为埋点上报（`t2.xiaohongshu.com/api/v2/collect`）— 前置风控
2. 搜索历史同步（`so.xiaohongshu.com/api/sns/web/search/history/sync`）— 历史记录
3. 搜索推荐补全（`edith.xiaohongshu.com/api/sns/web/v1/search/trending/query`）— 热词
4. 搜索筛选预检（OPTIONS）— CORS 放行
5. 搜索 onebox（`worldcup/search/onebox` + `search/onebox`）— 智能卡片
6. **核心笔记搜索**（`edith.xiaohongshu.com/api/sns/web/v1/search/notes`）— 返回 note_id 列表

脚本自动拦截第 6 步的 API 响应，提取每条笔记的 `note_id` 和 `xsec_token`，然后逐笔记导航到详情页采集评论。

### 第三步：查看产出

每篇笔记的产出保存在 `output/xiaohongshu/{note_id}/{note_id}_{时间戳}/` 目录下：
- `note_content.txt` — 笔记全文
- `meta.json` — 元数据（note_id、标题、评论数、采集时间、搜索关键词）
- `comments/comments.csv` — 纯评论CSV（序号+评论内容两列）
- `output/output.csv` — SKILL 12 字段（AI 字段留空）

运行日志：`reports/xiaohongshu/program/{关键词}_{时间戳}/{时间戳}.log`

## 模式二：单笔记模式

直接采集指定笔记的评论。

```bash
venv/Scripts/python.exe research-crawler-skill/scripts/xiaohongshu/xhs_qrcode_crawler.py \
    --url "https://www.xiaohongshu.com/discovery/item/xxx?xsec_token=xxx" --max-comments 30
```

## 依赖安装（国内镜像）

```bash
venv/Scripts/python.exe -m pip install playwright -i https://mirrors.aliyun.com/pypi/simple/
venv/Scripts/python.exe -m playwright install chromium
```

## AI 分析（可选）

如果用户选择使用 AI 分析，**读取 `references/ai-analysis-flow.md`** 并按其流程执行。
AI 分析前需先运行预处理脚本生成 `comments/comments_for_ai.csv`（自动截断为前50条）。
