# GTA6 评论采集任务总报告

- 生成时间: 2026-09-30 15:41
- 任务: B站「GTA6」top1 视频 10 条评论 + Steam「GTA6」10 条评论
- PROJECT_ROOT: `D:\code\ai-flows`（= skill 目录的父目录，与 shell 当前工作目录无关）

## 一、总体结果

| 平台 | 目标 | 实际采集 | 清洗后 | 状态 |
| --- | --- | --- | --- | --- |
| B站 | 10 | 10 | 10 | 成功 |
| Steam | 10 | 0 | 0 | 失败（GTA VI 未发售，无商店页/AppID） |

- 本次未启用 AI 分析，8 个 AI 分析字段按要求留空。
- 合计产出评论 10 条（全部来自 B站），Steam 部分如实记录失败，未伪造数据。

## 二、B站 采集明细

- 关键词: `GTA6`，取搜索结果 **Top1**
- 视频: 【IGN】《GTA6》首个预告
  - BVID: `BV1tb4y1L7yA`
  - UP主: IGN中国
  - 播放量: 15,497,417
  - 链接: https://www.bilibili.com/video/BV1tb4y1L7yA
- 采集口径: 热度前 10 条（按点赞数）
- 清洗: 去重 / 去空 / 去@回复 / 去纯表情 / 空白规范化为单行
- 清洗丢弃: 0 条（原始 10 → 清洗 10）
- 会话目录时间戳: `20260930_154007`

### Top5 热评

| 排名 | 点赞 | 用户名 | 评论摘要 |
| --- | --- | --- | --- |
| 1 | 43,959 | Laosigaysaos | 最惊讶的是沼泽里动物都很真实，这是把大表哥里的生态系统也搬过来了 |
| 2 | 32,518 | 卼䳟 | 感觉如果一直强调"信任"的话，按照R星的习惯估计结局要么男主背叛…… |
| 3 | 28,973 | 游隼Y | 根据R星预告片的传统，可以大概率确定预告片画质就是游戏画质…… |
| 4 | 15,917 | 七夕-冷风- | 这次预告片没啥爆炸，飞车，抢劫的大场面，而是更多地刻画佛州的风土人情…… |
| 5 | 13,414 | rceth | 又盘了一遍 不仅是毛发演算 水的演算也好强啊…… |

字段完整性: 原始 CSV 含 `编号/昵称/用户ID/评论内容/发布时间/点赞数` 六字段；
清洗 CSV 含 SKILL 定义的 12 字段（AI 分析字段留空）。

## 三、Steam 失败说明

- 失败环节: AppID 匹配（`get_appid_by_name`），错误日志:
  `ERROR - 未能找到游戏 'GTA6' 的 AppID，跳过。`
- 独立复核（`store.steampowered.com/api/storesearch`）:
  - `GTA6` → total = 0
  - `GTA VI` → total = 0
  - `Grand Theft Auto VI` → 仅命中 `1546990` *Vice City – The Definitive Edition*（不同游戏）
- 根因: **GTA VI 尚未发售（档期 2026-11-19）**，Steam 无其商店页面，故无 AppID，
  评论接口 `appreviews/{appid}` 无入口，结论为**不可能采集到数据**而非网络/脚本问题。
- 详见: `reports/steam/program/GTA6_20260930_154017/GTA6_20260930_154017_report.md`

## 四、产出文件清单

### 原始与清洗数据（B站）
- `output/bilibili/GTA6/GTA6_20260930_154007/raw/BV1tb4y1L7yA.csv` — 原始评论（6 字段）
- `output/bilibili/GTA6/GTA6_20260930_154007/raw/clean/BV1tb4y1L7yA_clean.csv` — 清洗后（12 字段）
- `output/bilibili/GTA6/GTA6_20260930_154007/comments/comments.csv` — 纯评论（序号+内容）
- `output/bilibili/GTA6/GTA6_20260930_154007/output/output.csv` — 合并完整数据
- `output/bilibili/GTA6/GTA6_20260930_154007/link/video_links.txt` — 视频链接清单
- `output/bilibili/GTA6/GTA6_20260930_154007/search_result.json` — 搜索元数据

### Excel
- `excel/bilibili_20260930_154100.xlsx` — B站 GTA6 工作表（10 行）

### 报告与日志
- `reports/bilibili/program/GTA6_20260930_154007/20260930_154007_report.md` — B站采集报告
- `reports/bilibili/program/GTA6_20260930_154007/20260930_154007_clean_report.log` — 清洗报告
- `reports/bilibili/program/GTA6_20260930_154007/20260930_154007.log` — 运行日志
- `reports/bilibili/error/output_errors.log` — B站错误检测（0 错误）
- `reports/steam/program/GTA6_20260930_154017/20260930_154017_report.md` — Steam 失败报告
- `reports/steam/program/GTA6_20260930_154017/20260930_154017.log` — Steam 运行日志
- `reports/steam/error/output_errors.log` — Steam 错误检测（2 条记录）
- `reports/GTA6_task_summary_20260930.md` — 本总报告

## 五、说明与注意事项

1. **PROJECT_ROOT 解析**: 所有脚本以 `PROJECT_ROOT = dirname(skill 目录)` 解析，
   即 `D:\code\ai-flows`。产出与 shell 当前目录（CWD）**无关**，统一落在
   项目根的 `output/`、`excel/`、`reports/` 下。
2. **历史遗留会话**: 发现本次运行之前已存在同一任务的重复会话
   `output/bilibili/GTA6/GTA6_20260930_153739`（数据与本次完全一致）及
   `reports/steam/program/GTA6_20260930_153744/`。为避免 Excel 重复计入，
   本次 Excel 通过独立暂存根目录生成，**仅包含本次会话** `GTA6_20260930_154007`。
   历史目录**未删除**，如需清理请手动确认。
3. **未启用 AI 分析**: 若需愈合向情绪/标签标注，请提供 AI 分析确认后重跑。
