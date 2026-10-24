# game-screenshot-skills

## 项目身份

gameui.net 游戏截图获取工具集。CodeBuddy skill 项目，提供 Python 脚本覆盖游戏列表查询、截图批量获取、按标签/游戏整理、端到端工作流、日志清理等场景，按功能分类为 core/ work flows/ organize/ tools/ 四个子包。

## 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | Python 3.x |
| HTTP | `requests`（无需登录/Cookie） |
| 图片 | `Pillow`（PIL，转 PNG + 拼图） |
| 去重 | `imagehash.phash`（感知哈希，汉明距离 <= 10 判定为相似） |
| 日志 | `log_util.LogManager`（统一日志模块，自动计时，UTF-8） |
| SSL | `urllib3.disable_warnings()` + `verify=False`（跳过 SSL 验证） |

## 目录结构

```
.
├── .agents/skills/gameui-screenshot/
│   ├── SKILL.md                    # CodeBuddy skill 主文件（AI 引导）
│   ├── README.md                   # 使用文档
│   ├── scripts/                    # ← Python 脚本目录
│   │   ├── core/                       # 核心层（API + 共享模块）
│   │   │   ├── log_util.py             # 共享日志模块
│   │   │   ├── sso_common.py           # SSO 认证共享模块
│   │   │   ├── fetch_screenshots.py    # 截图批量获取
│   │   │   ├── download_image.py       # 单图下载
│   │   │   └── query_game_list.py      # 游戏列表查询
│   │   ├── workflows/                  # 整合工作流（★推荐入口）
│   │   │   ├── game_screenshot_by_tag.py     # 按标签和风格筛选截图
│   │   │   ├── game_core_gameplay_collage.py # 核心玩法拼图
│   │   │   └── generate_planning.py          # 策划案生成
│   │   ├── organize/                   # 整理/重组工具
│   │   │   ├── organize_by_tag.py          # 按标签分组
│   │   │   ├── organize_by_game.py         # 按游戏名整理
│   │   │   ├── organize_by_tag_in_game.py  # 游戏→标签双层整理
│   │   │   └── reorganize_output.py        # 整理 output 目录按风格分类
│   │   ├── tools/                      # 实用工具
│   │   │   ├── export_db.py                # 导出 SQLite 数据库
│   │   │   ├── update_db_from_output.py    # 一键更新数据库
│   │   │   ├── cleanup_empty.py            # 空文件夹清理+报告
│   │   │   ├── repair_incomplete.py        # 文章ID精准补图
│   │   │   ├── test_similarity.py          # 图片相似度测试
│   │   │   ├── serve_output.py             # 截图浏览服务器
│   │   │   ├── filter_games.py             # 游戏过滤
│   │   │   └── sso_tool.py                 # SSO 抓包工具
│   │   └── image-browser.html          # 截图浏览器前端
│   └── references/
│       ├── api_index.md
│       └── api_reverse.md
├── output/                          # 截图输出目录
│   └── {timestamp}_xxx/            # 按批次存储
│       └── {风格名}/               # 按游戏风格分类
│           └── {游戏名}/           # 游戏子文件夹
│               ├── concept_1.png   # 截图
│               ├── concept_2.png   # 截图2
│               ├── concept_3.png   # 截图3
│               ├── concept_combined.png  # 拼图
│               └── planning_doc.md       # 策划案（AI 直接编辑此文件）
├── db/                              # 数据库目录
│   └── game_screenshots.db          # SQLite 游戏截图数据库
├── CLAUDE.md                       # 本文件（项目根）
└── .gitignore
```

## 关键约束

### 反直觉（必须强调）

- **脚本执行路径**：所有脚本必须从项目根目录执行，使用 `python .agents/skills/gameui-screenshot/scripts/xxx.py` 或 `python .agents/skills/gameui-screenshot/scripts/workflows/xxx.py` 路径，而非直接进入脚本目录运行。
- **CDN 防盗链**：所有图片下载请求必须带 `Referer: https://www.gameui.net/` 头，否则返回 403。
- **SSL 跳过**：所有 HTTP 请求必须设 `verify=False` + `urllib3.disable_warnings()`，因为 gameui.net SSL 证书校验会失败。
- **PROJECT_ROOT 路径计算**：所有脚本统一使用 `Path(__file__).resolve().parents[5]` 计算项目根目录（脚本在 `scripts/{分类}/` 下，往上5级）。
- **跨包导入规则**：子目录脚本通过 `sys.path.insert(0, str(Path(__file__).resolve().parents[1]))` 添加 `scripts/` 到搜索路径，然后使用 `from core.xxx import ...` / `from tools.xxx import ...` 进行跨包导入。

### 不显而易见

- **分析只分析拼图**：执行游戏截图分析（核心玩法分析、策划案生成等）时，只读取 `concept_combined.png` 拼图文件进行分析，不分析单独的 `concept_1/2/3.png` 原始截图。拼图包含游戏多个界面的综合信息，能提供更完整的分析视角。
- **SKILL.md 是技能入口**：修改脚本功能后必须同步更新 `SKILL.md` 中的使用说明和参数表。SKILL.md 比 README.md 优先级更高——它是 CodeBuddy AI 加载技能时的唯一指令源。
- **新增脚本**：必须在 `SKILL.md`、`README.md` 和本文件的目录结构 + 命令表中同步注册。
- **`.gitignore` 规则**：`.gitignore` 已配置忽略 `.agents/skills/gameui-screenshot/scripts/**/*.图片文件`、`截图/` 和 `game_concepts/`。新增含图片的输出目录需追加对应规则。
- **日志文件 UTF-8**：`LogManager` 输出的日志文件为 UTF-8 编码，在 GBK 终端下 `type` 显示乱码属正常，可用 `read_file` 工具查看。

### 工具链强制执行（无需 CLAUDE.md 重复）

| 规则 | 工具/机制 |
|------|----------|
| 忽略截图文件 | `.gitignore` |
| Python 语法 | Python 解释器 |
| 请求超时 | 脚本内 `timeout=30` 参数 |
| 输出目录创建 | `Path.mkdir(parents=True, exist_ok=True)` |
| 图片依赖 | `pip install Pillow` |
| 去重依赖 | `pip install imagehash` |

## 脚本命令表

所有命令在项目根目录下执行，`SCRIPTS=.agents/skills/gameui-screenshot/scripts`。

### 核心层 (core/)

| 用途 | 命令 |
|------|------|
| 查游戏列表 | `python %SCRIPTS%/core/query_game_list.py --style 欧美 --top 5` |
| 列出截图 | `python %SCRIPTS%/core/fetch_screenshots.py --style 欧美 --desc 登录界面 --list-only` |
| 下载截图 | `python %SCRIPTS%/core/fetch_screenshots.py --style 二次元 --desc 战斗画面 --download 5` |
| 单图下载(ID) | `python %SCRIPTS%/core/download_image.py 1959220` |
| 单图下载(URL) | `python %SCRIPTS%/core/download_image.py "https://image.gameuiux.cn/xxx.jpg"` |

### 工作流 (workflows/)

| 用途 | 命令 |
|------|------|
| 按标签和风格筛选 | `python %SCRIPTS%/workflows/game_screenshot_by_tag.py --styles "欧美,二次元" --tags "战斗界面,VS/匹配"` |
| 核心玩法拼图 | `python %SCRIPTS%/workflows/game_core_gameplay_collage.py --game-type "射击游戏" --count 3` |
| 生成策划案 | `python %SCRIPTS%/workflows/generate_planning.py --generate` → AI 编辑 planning_doc.md → `--register --game-id X` |

### 整理工具 (organize/)

| 用途 | 命令 |
|------|------|
| 按游戏名整理 | `python %SCRIPTS%/organize/organize_by_game.py --input-dir ./screenshots_output_multi` |
| 按标签分组 | `python %SCRIPTS%/organize/organize_by_tag.py --input-dir ./screenshots_output_multi` |
| 游戏→标签双层 | `python %SCRIPTS%/organize/organize_by_tag_in_game.py --input-dir ./screenshots_output_multi` |
| 整理输出目录 | `python %SCRIPTS%/organize/reorganize_output.py --dry-run` |

### 实用工具 (tools/)

| 用途 | 命令 |
|------|------|
| 截图浏览服务器 | `python %SCRIPTS%/tools/serve_output.py --dir output --port 8080` |
| 空文件夹清理 | `python %SCRIPTS%/tools/cleanup_empty.py` |
| 图片相似度测试 | `python %SCRIPTS%/tools/test_similarity.py` |
| 更新数据库 | `python %SCRIPTS%/tools/update_db_from_output.py --rebuild` |
| 导出数据库 | `python %SCRIPTS%/tools/export_db.py --rebuild` |
| SSO 抓包工具 | `python %SCRIPTS%/tools/sso_tool.py` |

### 风格参数速查

- `--style`：`欧美` `二次元` `国风` `日韩` `Q版卡通` `科幻` `军事`
- `--desc`（场景）：`登录界面` `主界面` `角色选择` `战斗画面` `商店界面` `设置界面`
- `--desc`（功能，逗号分隔多值）：`服务器选择` `游戏通告` `过场动画` `新手引导` `Loading` `战斗界面` `战斗提示` `VS/匹配` `升级提示` `恭喜获得` `结算` `数据统计` `姓名输入` `NPC对话` `章节提示` `阵营选择` `功能解锁` `菜单` `玩家信息` `角色` `背包` `锻造/合成` `技能` `任务` `成就` `关卡/挑战` `公会/帮派` `外观/时装` `图鉴`

## API 核心流程

```
游戏列表 (REST POST) → 截图列表 (GraphQL GET) → 截图详情 (REST GET) → CDN 图片下载（需 Referer）
```

- 全部无需登录/Cookie
- 基础 URL：`https://www.gameui.net`
- 图片 CDN：`https://image.gameuiux.cn`

## 编码规范

- **导入顺序**：标准库 → 第三方库 → 本地模块，每组空行分隔
- **日志系统**：统一使用 `log_util.LogManager`。流程脚本使用 `.add()`/`.sub_header()`/`.game_line()` 组织日志，`.close()` 自动保存 `_report.txt`。终端输出通过 `log.print()` 统一打印。禁止混用裸 `print()` 和 LogManager。
- **函数文档**：Google style docstring
- **脚本入口**：标准 `def main()` + `if __name__ == "__main__": main()` 模式
- **环境兼容**：`sys.stdout.encoding` 检查 + GBK 转 UTF-8 兜底（Windows 中文环境），日志文件始终 UTF-8
- **安全文件名**：`safe_dirname()` / 正则替换非法字符 `[\\/:*?"<>|]`，避免中文文件名问题
