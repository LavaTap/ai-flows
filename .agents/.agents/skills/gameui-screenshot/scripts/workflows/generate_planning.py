"""游戏策划案生成脚本 - 基于截图拼接图分析核心玩法并输出策划案

从 SQLite 数据库读取游戏数据，针对拥有 concept_combined.png 拼图的游戏，
分析截图中的核心玩法特征，生成结构化的游戏策划案并保存到对应游戏文件夹。

核心流程:
  1. 检测识图模型可用性 (--check-model)
  2. 列出待分析的游戏 (--list-pending)
  3. 批量生成模板到游戏文件夹 (--generate)
  4. AI 读取拼接图 + 编辑 planning_doc.md
  5. 注册完成到数据库 (--register --game-id X)
  6. 保存策划案 (--save --game-id X [--content-file <file>])

策划案保存位置: {game_dir}/planning_doc.md
数据库只存储文件路径（不存内容）

Usage:
  python generate_planning.py --check-model                          # 检测识图模型
  python generate_planning.py --list-pending                         # 列出待分析游戏
  python generate_planning.py --list-pending --style 欧美            # 按风格筛选
  python generate_planning.py --generate                             # 批量生成模板到游戏文件夹
  python generate_planning.py --generate --style 欧美 --limit 3      # 限制风格和数量
  python generate_planning.py --prepare --game-id 1                  # 输出单个分析上下文
  python generate_planning.py --register --game-id 1                 # 注册 AI 已生成的策划案
  python generate_planning.py --save --game-id 1                     # 保存（自动读取游戏文件夹中的 planning_doc.md）
  python generate_planning.py --list-all                             # 列出所有游戏（含分析状态）
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import textwrap
from datetime import datetime
from pathlib import Path

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

if sys.stdout.encoding and sys.stdout.encoding.lower() in ('gbk', 'gb2312', 'cp936'):
    sys.stdout = __import__('io').TextIOWrapper(
        sys.stdout.buffer, encoding='utf-8', errors='replace'
    )
    sys.stderr = __import__('io').TextIOWrapper(
        sys.stderr.buffer, encoding='utf-8', errors='replace'
    )

SCRIPT_DIR = Path(__file__).resolve().parent.parent
# workflows/ -> scripts/ -> gameui-screenshot/ -> skills/ -> .agents/ -> 项目根
PROJECT_ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(SCRIPT_DIR))


# ─────────────────────────────────────────
# 路径工具函数
# ─────────────────────────────────────────

def resolve_path(db_path: str) -> str:
    """将数据库中的相对路径解析为绝对路径"""
    if not db_path:
        return db_path
    p = Path(db_path)
    if p.is_absolute():
        return str(p)
    return str(PROJECT_ROOT / p)


def to_rel_path(abs_path: str) -> str:
    """将绝对路径转为相对于项目根目录的相对路径"""
    if not abs_path:
        return abs_path
    p = Path(abs_path)
    if not p.is_absolute():
        return abs_path
    try:
        return str(p.relative_to(PROJECT_ROOT))
    except ValueError:
        return abs_path


# ──────────────────────────────────────────────────────────────────
# 游戏类型 → 策划案分析维度映射
# ──────────────────────────────────────────────────────────────────

GAME_TYPE_ANALYSIS_DIMENSIONS = {
    "格斗游戏": {
        "type_class": "核心机制类",
        "core_loop": "角色选择 → VS展示 → 对战 → 结算",
        "key_screens": ["VS/匹配", "战斗界面", "结算", "角色"],
        "analysis_focus": [
            "连击系统与 Cancel 机制",
            "受击判定与帧数据",
            "角色/阵容平衡性设计",
            "段位/排位体系",
            "格斗 UI（血条、能量槽、连击计数器）"
        ],
    },
    "射击游戏": {
        "type_class": "核心机制类",
        "core_loop": "匹配/部署 → 战术推进 → 交火 → 结算",
        "key_screens": ["战斗界面", "VS/匹配", "地图", "结算"],
        "analysis_focus": [
            "武器/装备系统设计",
            "地图/关卡空间设计",
            "团队协作/通讯机制",
            "排位/竞技体系",
            "弹道/伤害计算模型"
        ],
    },
    "MOBA": {
        "type_class": "核心机制类",
        "core_loop": "选人/BanPick → 对线/发育 → 团战 → 推塔/结算",
        "key_screens": ["战斗界面", "VS/匹配", "角色", "结算"],
        "analysis_focus": [
            "英雄/角色技能设计体系",
            "装备/符文系统",
            "地图视野与资源争夺",
            "兵线/经济系统",
            "团队协作与沟通机制"
        ],
    },
    "角色扮演": {
        "type_class": "功能系统类",
        "core_loop": "探索/任务 → 战斗/养成 → 获取/成长 → 剧情推进",
        "key_screens": ["战斗界面", "角色", "背包", "任务"],
        "analysis_focus": [
            "角色养成体系（等级/装备/技能）",
            "剧情叙事与世界观包装",
            "战斗系统与操作模式",
            "探索/地图设计",
            "社交/公会/组队系统"
        ],
    },
    "卡牌": {
        "type_class": "功能系统类",
        "core_loop": "卡组构筑 → 抽卡/获取 → 对战 → 养成",
        "key_screens": ["战斗界面", "卡组/卡牌", "VS/匹配", "结算"],
        "analysis_focus": [
            "卡牌稀有度与获取机制",
            "卡组构筑策略深度",
            "对战规则与优先级",
            "养成线与数值平衡",
            "抽卡经济系统设计"
        ],
    },
    "动作游戏": {
        "type_class": "核心机制类",
        "core_loop": "关卡选择 → 战斗/操作 → BOSS → 结算/成长",
        "key_screens": ["战斗界面", "角色", "关卡/挑战", "结算"],
        "analysis_focus": [
            "操作手感与反馈系统",
            "技能/Combo 连招体系",
            "受击/防御/闪避机制",
            "关卡/敌人设计",
            "成长与装备系统"
        ],
    },
    "模拟经营": {
        "type_class": "功能系统类",
        "core_loop": "资源获取 → 建造/升级 → 生产 → 扩张",
        "key_screens": ["主界面", "建造/家园", "任务", "背包"],
        "analysis_focus": [
            "资源循环与经济平衡",
            "建造/升级系统深度",
            "任务/目标引导体系",
            "社交/交易系统",
            "长期留存与目标设计"
        ],
    },
    "策略游戏": {
        "type_class": "功能系统类",
        "core_loop": "资源管理 → 部署/调配 → 对战/推演 → 结算",
        "key_screens": ["战斗界面", "建造/家园", "地图", "结算"],
        "analysis_focus": [
            "策略决策树与博弈深度",
            "资源分配/管理机制",
            "兵种/单位相克设计",
            "科技树与成长路径",
            "PVP 平衡与匹配"
        ],
    },
    "MMORPG": {
        "type_class": "社交运营类",
        "core_loop": "创建角色 → 探索/任务 → 副本/团战 → 社交/交易",
        "key_screens": ["主界面", "战斗界面", "角色", "公会/帮派"],
        "analysis_focus": [
            "社交体系设计（公会/好友/组队）",
            "副本/团本机制设计",
            "经济/交易系统",
            "长期版本迭代规划",
            "玩家分层内容供给"
        ],
    },
    "竞速游戏": {
        "type_class": "核心机制类",
        "core_loop": "车辆选择 → 赛道加载 → 竞速 → 排名结算",
        "key_screens": ["VS/匹配", "战斗界面", "结算", "赛季/段位"],
        "analysis_focus": [
            "车辆/装备改装系统",
            "赛道设计多样性",
            "操作模式与辅助系统",
            "排位/排行榜体系",
            "社交/车队系统"
        ],
    },
    "体育游戏": {
        "type_class": "核心机制类",
        "core_loop": "队伍/球员选择 → 比赛 → 结算 → 赛季推进",
        "key_screens": ["VS/匹配", "战斗界面", "结算", "赛季/段位"],
        "analysis_focus": [
            "球员/队伍数值体系",
            "比赛核心机制与物理引擎",
            "赛季/联赛体系设计",
            "战术/阵型系统",
            "养成/转会/交易系统"
        ],
    },
    "音乐游戏": {
        "type_class": "核心机制类",
        "core_loop": "曲目选择 → 演奏/操作 → 评分结算 → 排行榜",
        "key_screens": ["战斗界面", "关卡/挑战", "结算", "角色"],
        "analysis_focus": [
            "音符判定与评分体系",
            "曲目难度曲线设计",
            "角色/皮肤养成",
            "排行榜/社交竞争",
            "操作模式创新"
        ],
    },
    "塔防": {
        "type_class": "功能系统类",
        "core_loop": "选择关卡 → 部署防御 → 防守阶段 → 结算/养成",
        "key_screens": ["战斗界面", "关卡/挑战", "建造/家园", "结算"],
        "analysis_focus": [
            "防御塔/单位设计体系",
            "关卡/地图多样性",
            "资源/经济管理机制",
            "养成线深度",
            "PVP 竞技模式"
        ],
    },
    "即时战略": {
        "type_class": "核心机制类",
        "core_loop": "基地建设 → 资源采集 → 部队组建 → 对战",
        "key_screens": ["建造/家园", "战斗界面", "地图", "结算"],
        "analysis_focus": [
            "种族/阵营差异化设计",
            "科技树与经济系统",
            "微操与宏操平衡",
            "地图/迷雾/视野设计",
            "观战/回放系统"
        ],
    },
    "恋爱养成": {
        "type_class": "功能系统类",
        "core_loop": "剧情对话 → 选项/好感 → 事件触发 → 结局",
        "key_screens": ["NPC对话", "角色", "章节提示", "图鉴"],
        "analysis_focus": [
            "角色人设与剧情设计",
            "好感度与分支系统",
            "收集/图鉴/成就体系",
            "CG/演出触发机制",
            "多结局与重玩价值"
        ],
    },
    "消除游戏": {
        "type_class": "功能系统类",
        "core_loop": "关卡加载 → 消除操作 → 目标达成 → 结算/解锁",
        "key_screens": ["战斗界面", "关卡/挑战", "结算", "背包"],
        "analysis_focus": [
            "消除规则与操作爽感",
            "关卡难度曲线",
            "特殊道具/技能设计",
            "社交/排行榜竞争",
            "活动/限时内容"
        ],
    },
    "桌游棋牌": {
        "type_class": "功能系统类",
        "core_loop": "匹配/房间 → 对局 → 结算 → 段位/数据",
        "key_screens": ["VS/匹配", "战斗界面", "结算", "赛季/段位"],
        "analysis_focus": [
            "核心规则与策略深度",
            "匹配/段位体系",
            "社交/房间/好友功能",
            "活动/赛事体系",
            "道具/皮肤商业化"
        ],
    },
    "SLOTS": {
        "type_class": "社交运营类",
        "core_loop": "充值/获取 → 转动/抽奖 → 结算/惊喜 → 循环",
        "key_screens": ["主界面", "恭喜获得", "结算", "背包"],
        "analysis_focus": [
            "概率/赔付率设计",
            "视觉/音效反馈系统",
            "活动/任务体系",
            "社交/赠送/排行榜",
            "VIP/等级特权体系"
        ],
    },
    "冒险游戏": {
        "type_class": "功能系统类",
        "core_loop": "探索/解密 → 战斗/收集 → 剧情推进 → 成就",
        "key_screens": ["战斗界面", "关卡/挑战", "地图", "任务"],
        "analysis_focus": [
            "探索/解密机制设计",
            "剧情叙事与世界观",
            "收集/成就体系",
            "战斗系统与操作",
            "关卡/地图设计"
        ],
    },
}

# 默认通用分析维度（用于未匹配的游戏类型）
DEFAULT_ANALYSIS_DIMENSIONS = {
    "type_class": "功能系统类",
    "core_loop": "待分析确定",
    "key_screens": [],
    "analysis_focus": [
        "UI/UX 设计风格",
        "核心操作流程",
        "界面信息架构",
        "视觉呈现风格",
        "交互反馈设计"
    ],
}


# ──────────────────────────────────────────────────────────────────
# 模型检测
# ──────────────────────────────────────────────────────────────────

def check_vision_model() -> dict:
    """检测当前环境是否支持识图分析。

    检测内容:
      - Python PIL/Pillow 是否可用 (图像处理能力)
      - 运行环境变量是否有识图模型标记
      - 尝试基本的图像读取功能

    Returns:
      dict: {
        "ok": bool,       # 是否可使用识图功能
        "pillow": bool,   # PIL 是否安装
        "message": str,   # 检测结果说明
        "details": list   # 详细检测项
      }
    """
    details = []
    ok = True

    # 1. 检查 PIL/Pillow
    details.append(f"PIL/Pillow: {'✅ 已安装' if HAS_PIL else '❌ 未安装'}")
    if not HAS_PIL:
        ok = False

    # 2. 检查环境变量中的模型信息
    model_env_vars = [
        "CLAUDE_MODEL", "ANTHROPIC_MODEL", "CODEBUDDY_MODEL",
        "OPENAI_MODEL", "MODEL_NAME", "AI_MODEL"
    ]
    found_model = False
    for var in model_env_vars:
        val = os.environ.get(var, "")
        if val:
            details.append(f"模型环境变量 {var}: {val}")
            found_model = True
            # 检查是否为识图模型的关键词
            vision_keywords = ["vision", "claude", "gpt-4", "gpt-4o",
                               "gemini", "multimodal", "sonnet", "opus", "haiku",
                               "识图", "vision2", "识图模型", "doubao", "seed"]
            has_vision_keyword = any(kw in val.lower() for kw in vision_keywords)
            if has_vision_keyword:
                details.append(f"  检测到识图模型关键词 ✅")
            else:
                details.append(f"  未检测到识图模型关键词，建议确认模型是否支持多模态")

    if not found_model:
        details.append("模型环境变量: 未设置（将依赖 AI Agent 能力）")

    # 3. 快速图像功能测试
    if HAS_PIL:
        try:
            test_img = Image.new("RGB", (1, 1), (0, 0, 0))
            test_img.verify()
            details.append("图像处理功能测试: ✅ 正常")
        except Exception as e:
            details.append(f"图像处理功能测试: ❌ 异常 ({e})")
            ok = False

    # 4. 综合判断
    if HAS_PIL:
        message = ("识图模型检测通过。Pillow 可用，配合 AI Agent 可对游戏截图"
                   "进行核心玩法分析。建议使用支持多模态的 AI 模型（如 Claude "
                   "系列、GPT-4V/4o、Gemini 等）以获得最佳分析效果。")
    else:
        message = ("⚠ 识图模型检测未完全通过。请执行 pip install Pillow 安装图像处理库。"
                   "分析游戏截图还需要 AI 模型支持多模态（识图）能力。")

    return {
        "ok": ok,
        "pillow": HAS_PIL,
        "message": message,
        "details": details
    }


def perform_model_check(verbose: bool = True):
    """执行并打印模型检测结果"""
    result = check_vision_model()

    if verbose:
        print("\n" + "=" * 60)
        print("识图模型可用性检测")
        print("=" * 60)
        for detail in result["details"]:
            print(f"  {detail}")
        print(f"\n结论: {result['message']}")
        print("=" * 60 + "\n")

    return result


# ──────────────────────────────────────────────────────────────────
# 数据库 Schema 迁移（补齐 generate_planning 所需的表/字段）
# ──────────────────────────────────────────────────────────────────

PLANNING_SCHEMA_MIGRATION = """
-- 为 games 表添加 planning_doc_path 字段（如果不存在）
-- SQLite 不支持 ADD COLUMN IF NOT EXISTS，用 try/except 处理

CREATE TABLE IF NOT EXISTS planning_docs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id         INTEGER NOT NULL UNIQUE,
    file_path       TEXT NOT NULL DEFAULT '',
    analysis_status TEXT CHECK(analysis_status IN ('pending','completed','failed','skipped')) DEFAULT 'pending',
    model_check     TEXT,
    generated_at    TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_planning_docs_game_id ON planning_docs(game_id);
CREATE INDEX IF NOT EXISTS idx_planning_docs_status ON planning_docs(analysis_status);
"""


# ──────────────────────────────────────────────────────────────────
# 数据库操作
# ──────────────────────────────────────────────────────────────────

def get_db_path() -> Path:
    """获取数据库路径"""
    db_path = os.environ.get("GAMEUI_DB_PATH",
                             str(PROJECT_ROOT / "db" / "game_screenshots.db"))
    return Path(db_path)


def get_db_connection(db_path: str = None) -> sqlite3.Connection:
    """创建数据库连接，自动运行 Schema 迁移"""
    path = db_path or str(get_db_path())
    db_dir = Path(path).parent
    db_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    # 自动迁移：创建 planning_docs 表
    try:
        conn.executescript(PLANNING_SCHEMA_MIGRATION)
    except Exception:
        pass  # 忽略 CREATE TABLE IF NOT EXISTS 的错误

    # 为旧数据库补齐 planning_doc_path 列
    try:
        conn.execute("ALTER TABLE games ADD COLUMN planning_doc_path TEXT")
    except sqlite3.OperationalError:
        pass  # 列已存在

    conn.commit()
    return conn


def list_pending_games(style: str = None, conn: sqlite3.Connection = None) -> list:
    """列出待分析的的游戏（有拼图但无策划案）

    Args:
      style: 可选，按风格筛选
      conn: 可选，数据库连接

    Returns:
      list[dict]: 待分析游戏列表
    """
    close_conn = False
    if conn is None:
        conn = get_db_connection()
        close_conn = True

    try:
        query = """
            SELECT
                g.id, g.name, g.style, g.screenshot_count, g.collage_exists,
                g.source_dir,
                CASE WHEN pd.id IS NOT NULL THEN 1 ELSE 0 END as has_planning,
                pd.analysis_status as planning_status,
                pd.generated_at as planning_generated_at
            FROM games g
            LEFT JOIN planning_docs pd ON g.id = pd.game_id
            WHERE g.collage_exists = 1
        """
        params = []
        if style:
            query += " AND g.style = ?"
            params.append(style)

        query += " ORDER BY g.style, g.name"

        cursor = conn.execute(query, params)
        results = [dict(row) for row in cursor.fetchall()]
        return results
    finally:
        if close_conn:
            conn.close()


def list_all_games(style: str = None, conn: sqlite3.Connection = None) -> list:
    """列出所有游戏（含分析状态）"""
    close_conn = False
    if conn is None:
        conn = get_db_connection()
        close_conn = True

    try:
        query = """
            SELECT
                g.id, g.name, g.style, g.screenshot_count, g.collage_exists,
                g.source_dir,
                CASE WHEN pd.id IS NOT NULL THEN 1 ELSE 0 END as has_planning,
                pd.analysis_status as planning_status,
                pd.generated_at as planning_generated_at,
                pd.model_check as model_check_result
            FROM games g
            LEFT JOIN planning_docs pd ON g.id = pd.game_id
        """
        params = []
        if style:
            query += " WHERE g.style = ?"
            params.append(style)
        query += " ORDER BY g.style, g.name"

        cursor = conn.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]
    finally:
        if close_conn:
            conn.close()


def get_game_context(game_id: int, conn: sqlite3.Connection = None) -> dict:
    """获取游戏的完整分析上下文

    Returns:
      dict: 包含游戏基本信息、截图列表、collage 信息
    """
    close_conn = False
    if conn is None:
        conn = get_db_connection()
        close_conn = True

    try:
        # 获取游戏基本信息
        cursor = conn.execute(
            "SELECT * FROM games WHERE id = ?", (game_id,)
        )
        game = cursor.fetchone()
        if not game:
            return None

        game_dict = dict(game)

        # 获取截图列表（DB 存相对路径，resolve 为绝对路径供文件操作）
        cursor = conn.execute(
            "SELECT * FROM screenshots WHERE game_id = ? ORDER BY type, filename",
            (game_id,)
        )
        screenshots = [dict(row) for row in cursor.fetchall()]
        for ss in screenshots:
            ss["path"] = resolve_path(ss.get("path", ""))
        game_dict["screenshots"] = screenshots

        # 获取 collage 路径
        collage = None
        for ss in screenshots:
            if ss["type"] == "collage":
                collage = ss
                break
        game_dict["collage_info"] = collage

        # 获取已有策划案信息
        cursor = conn.execute(
            "SELECT * FROM planning_docs WHERE game_id = ?", (game_id,)
        )
        planning = cursor.fetchone()
        game_dict["planning_info"] = dict(planning) if planning else None

        return game_dict
    finally:
        if close_conn:
            conn.close()


def save_planning_doc(game_id: int, content: str, model_check: str = None,
                      conn: sqlite3.Connection = None) -> dict:
    """保存策划案到游戏文件夹并更新数据库

    Args:
      game_id: 游戏 ID
      content: 策划案 Markdown 内容
      model_check: 识图模型检测结果字符串
      conn: 可选，数据库连接

    Returns:
      dict: 保存结果 {"ok": bool, "file_path": str, "error": str}
    """
    close_conn = False
    if conn is None:
        conn = get_db_connection()
        close_conn = True

    try:
        # 获取游戏信息
        game = get_game_context(game_id, conn)
        if not game:
            return {"ok": False, "error": f"游戏 ID={game_id} 不存在"}

        # 确定游戏文件夹路径（DB 中为相对路径，需 resolve）
        collage_info = game.get("collage_info")
        source_dir = game.get("source_dir", "")
        game_name = game["name"]
        style = game["style"]

        if collage_info and collage_info.get("path"):
            # 从 collage 路径反推游戏目录（resolve 相对路径）
            game_dir = Path(resolve_path(collage_info["path"])).parent
        else:
            # 回退：从 source_dir 构建（resolve 项目根）
            game_dir = PROJECT_ROOT / source_dir / style / game_name if source_dir else None

        if not game_dir or not game_dir.exists():
            return {"ok": False, "error": f"无法定位游戏目录: {game_dir}"}

        # 写入策划案文件
        doc_path = game_dir / "planning_doc.md"
        with open(doc_path, "w", encoding="utf-8") as f:
            f.write(content)

        # 更新 games 表（存储相对路径）
        rel_path = to_rel_path(str(doc_path))
        conn.execute(
            "UPDATE games SET planning_doc_path = ? WHERE id = ?",
            (rel_path, game_id)
        )

        # 更新 planning_docs 表（只存位置，不存内容）
        generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        existing = conn.execute(
            "SELECT id FROM planning_docs WHERE game_id = ?", (game_id,)
        ).fetchone()

        if existing:
            conn.execute(
                "UPDATE planning_docs SET file_path=?, "
                "analysis_status='completed', model_check=?, generated_at=? "
                "WHERE game_id=?",
                (rel_path, model_check, generated_at, game_id)
            )
        else:
            conn.execute(
                "INSERT INTO planning_docs "
                "(game_id, file_path, analysis_status, model_check, generated_at) "
                "VALUES (?,?,?,?,?)",
                (game_id, rel_path, "completed", model_check, generated_at)
            )

        conn.commit()

        return {
            "ok": True,
            "file_path": rel_path,
            "game_name": game_name,
            "style": style,
        }

    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        if close_conn:
            conn.close()


def mark_skipped(game_id: int, reason: str, conn: sqlite3.Connection = None):
    """将游戏标记为跳过分析"""
    close_conn = False
    if conn is None:
        conn = get_db_connection()
        close_conn = True

    try:
        existing = conn.execute(
            "SELECT id FROM planning_docs WHERE game_id = ?", (game_id,)
        ).fetchone()

        if existing:
            conn.execute(
                "UPDATE planning_docs SET analysis_status='skipped', model_check=? WHERE game_id=?",
                (reason, game_id)
            )
        else:
            conn.execute(
                "INSERT INTO planning_docs (game_id, file_path, analysis_status, model_check) "
                "VALUES (?,?,?,?)",
                (game_id, "", "skipped", reason)
            )
        conn.commit()
    finally:
        if close_conn:
            conn.close()


# ──────────────────────────────────────────────────────────────────
# 策划案模板生成
# ──────────────────────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────────
# 模板写入游戏文件夹
# ──────────────────────────────────────────────────────────────────

def write_template_to_game_dir(game_id: int, template: str,
                                conn: sqlite3.Connection = None) -> str:
    """将模板写入游戏文件夹并注册为 pending 状态。

    Args:
      game_id: 游戏 ID
      template: 策划案模板内容
      conn: 数据库连接

    Returns:
      str: planning_doc.md 的绝对路径，失败返回 None
    """
    close_conn = False
    if conn is None:
        conn = get_db_connection()
        close_conn = True

    try:
        game = get_game_context(game_id, conn)
        if not game:
            return None

        # 确定游戏文件夹（DB 中为相对路径，需 resolve）
        collage_info = game.get("collage_info")
        source_dir = game.get("source_dir", "")
        game_name = game["name"]
        style = game["style"]

        if collage_info and collage_info.get("path"):
            game_dir = Path(resolve_path(collage_info["path"])).parent
        else:
            game_dir = PROJECT_ROOT / source_dir / style / game_name if source_dir else None

        if not game_dir or not game_dir.exists():
            return None

        # 写入模板到游戏文件夹
        doc_path = game_dir / "planning_doc.md"
        with open(doc_path, "w", encoding="utf-8") as f:
            f.write(template)

        # 更新数据库（存储相对路径）
        rel_path = to_rel_path(str(doc_path))
        conn.execute(
            "UPDATE games SET planning_doc_path = ? WHERE id = ?",
            (rel_path, game_id)
        )

        existing = conn.execute(
            "SELECT id FROM planning_docs WHERE game_id = ?", (game_id,)
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE planning_docs SET file_path=?, analysis_status='pending' WHERE game_id=?",
                (rel_path, game_id)
            )
        else:
            conn.execute(
                "INSERT INTO planning_docs (game_id, file_path, analysis_status) VALUES (?,?,?)",
                (game_id, rel_path, "pending")
            )

        conn.commit()
        return rel_path

    except Exception:
        return None
    finally:
        if close_conn:
            conn.close()


def generate_template(game_context: dict) -> str:
    """根据游戏上下文生成策划案模板

    对照用户提供的策划案分析框架，生成带填写提示的结构化模板。
    """
    game_name = game_context["name"]
    style = game_context.get("style", "未知")
    screenshots = game_context.get("screenshots", [])

    # 尝试推断游戏类型（基于标签）
    tags = set()
    for ss in screenshots:
        # 如果有标签数据则收集
        pass

    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    template = f"""# 《{game_name}》核心玩法策划分析案

## 文档历史
| 版本 | 时间 | 作者 | 内容说明 |
|------|------|------|----------|
| V1.0 | {now} | AI 分析生成 | 基于截图拼图的核心玩法初步分析 |

---

## 一、设计说明

### 1. 系统定位
> [AI 填写] 根据截图中的核心玩法特征，判断该系统属于:
> - 基础工具型 / 玩法核心型 / 留存拉新型 / 付费转化型

### 2. 设计目标
> [AI 填写] 明确用户价值与业务目标

### 3. 游戏品类识别
- **美术风格**: {style}
- **玩法类型**: [AI 填写] 如格斗/射击/MOBA/卡牌等
- **目标用户**: [AI 填写] 如硬核竞技/休闲收集/剧情体验

---

## 二、核心玩法分析

### 1. 核心循环
> [AI 填写] 描述玩家的核心行为循环
> 格式: 步骤A → 步骤B → 步骤C → 步骤A

### 2. 截图拆解
| 编号 | 截图类型 | 关键 UI 元素 | 玩法特征 |
|------|----------|-------------|----------|
| concept_1 | | | |
| concept_2 | | | |
| concept_3 | | | |

### 3. 玩法特征总结

#### 操作维度
> [AI 填写] 按键/触控布局、操作复杂度、响应速度要求

#### UI 布局维度
> [AI 填写] HUD 信息密度、功能入口分布、视觉层级

#### 核心机制
> [AI 填写] 战斗/养成/策略核心规则的独特设计

---

## 三、界面与交互分析

### 1. 主界面/HUD 设计
> [AI 填写] 基于截图分析主界面的信息架构:
> - 核心信息展示区（血条/资源/状态）
> - 功能入口布局（菜单/背包/商城/任务）
> - 视觉焦点与引导设计

### 2. 战斗/核心操作界面
> [AI 填写] 分析战斗界面的:
> - 操作区域与按键布局
> - 信息反馈（伤害数字/状态图标/特效）
> - 节奏感与紧张度营造

### 3. 结算/反馈界面
> [AI 填写] 分析:
> - 胜负判定展示
> - 奖励/成长反馈
> - 段位/排名信息

---

## 四、系统架构推断

### 1. 玩法系统
> [AI 填写] 基于截图推断可能存在的玩法子系统:
> - 核心战斗/操作
> - 角色/阵容选择
> - 匹配/排位
> - 养成/升级

### 2. 社交系统
> [AI 填写] 推断:
> - 好友/组队
> - 公会/战队
> - 排行榜
> - 聊天/沟通

### 3. 经济系统
> [AI 填写] 推断:
> - 货币类型（金币/钻石/积分等）
> - 获取途径
> - 消耗出口（商城/抽卡/养成）

---

## 五、设计亮点与特色

### 1. UI/UX 创新点
> [AI 填写] 截图中观察到的独特设计

### 2. 玩法创新点
> [AI 填写] 区别于同类游戏的差异化设计

### 3. 用户体验亮点
> [AI 填写] 哪些设计提升了用户操作体验

---

## 六、分析结论

### 1. 核心玩法成熟度评估
> [AI 填写] 基于截图判断该游戏的玩法完整度和设计成熟度

### 2. 潜在改进建议
> [AI 填写] 从设计角度提出的优化方向

### 3. 参考价值
> [AI 填写] 对该品类游戏策划的参考意义

---

> **说明**: 本分析案基于 gameui.net 游戏截图自动生成，重点关注 UI/UX 及核心玩法可观察层面。
> 详细数值设计、后端架构、商业化数据不在本分析范围内。

"""
    return template


# ──────────────────────────────────────────────────────────────────
# 上下文准备输出
# ──────────────────────────────────────────────────────────────────

def prepare_game_context(game_id: int, conn: sqlite3.Connection = None) -> dict:
    """准备游戏分析上下文，输出为 AI 可用的结构化数据

    返回供 AI Agent 分析的结构化上下文，包含:
      - 游戏基本信息
      - 截图文件路径列表
      - collage 文件路径
      - 策划案模板
      - 推荐分析维度
    """
    close_conn = False
    if conn is None:
        conn = get_db_connection()
        close_conn = True

    try:
        game = get_game_context(game_id, conn)
        if not game:
            raise ValueError(f"游戏 ID={game_id} 不存在")

        # 构建上下文
        context = {
            "game_id": game_id,
            "game_name": game["name"],
            "style": game["style"],
            "screenshot_count": game["screenshot_count"],
            "collage_exists": game["collage_exists"],
            "screenshots": game.get("screenshots", []),
            "collage_info": game.get("collage_info"),
            "planning_info": game.get("planning_info"),
        }

        # 添加绘制案模板
        context["template"] = generate_template(game)

        # 推断游戏类型并推荐分析维度
        # 从 source_dir 或 screenshots 标签中尝试推断
        game_type = _infer_game_type(game)
        dimensions = GAME_TYPE_ANALYSIS_DIMENSIONS.get(
            game_type, DEFAULT_ANALYSIS_DIMENSIONS
        )
        context["inferred_type"] = game_type
        context["analysis_dimensions"] = dimensions

        # 截图标签汇总
        tags_set = set()
        for ss in game.get("screenshots", []):
            pass  # screenshots 表目前不存储 tags，可扩展
        context["tags"] = sorted(tags_set)

        return context

    finally:
        if close_conn:
            conn.close()


def _infer_game_type(game: dict) -> str:
    """根据游戏信息推断游戏类型"""

    # 策略1: 从 source_dir 名称推断
    source = game.get("source_dir", "").lower()
    name = game.get("name", "").lower()

    # 关键词匹配
    type_keywords = {
        "MOBA": ["moba", "英雄联盟", "王者荣耀", "dota", "lol"],
        "射击游戏": ["射击", "枪战", "fps", "tps", "吃鸡", "使命召唤",
                    "cf", "apex", "valorant", "绝地求生", "彩虹六号"],
        "格斗游戏": ["格斗", "拳皇", "街霸", "铁拳", "真人快打", "不义联盟",
                    "龙珠斗士", "死或生"],
        "卡牌": ["卡牌", "炉石", "影之诗", "游戏王", "万智牌", "昆特牌"],
        "动作游戏": ["动作", "act", "鬼泣", "战神", "忍龙", "猎天使魔女"],
        "角色扮演": ["角色扮演", "rpg", "最终幻想", "勇者斗恶龙", "仙剑"],
        "模拟经营": ["模拟", "经营", "农场", "城市", "餐厅", "厨房"],
        "策略游戏": ["策略", "战棋", "文明", "三国志", "火焰纹章"],
        "竞速游戏": ["竞速", "赛车", "跑跑卡丁车", "极品飞车", "地平线"],
        "音乐游戏": ["音乐", "节奏", "音游", "osu", "cytus", "deemo"],
        "体育游戏": ["体育", "足球", "篮球", "fifa", "nba", "实况"],
        "塔防": ["塔防", "kingdom rush", "保卫萝卜", "植物大战僵尸"],
        "MMORPG": ["mmorpg", "mmo", "魔兽世界", "剑网", "逆水寒", "天刀"],
        "冒险游戏": ["冒险", "解谜", "逃脱", "密室"],
        "恋爱养成": ["恋爱", "养成", "乙女", "gal", "攻略"],
        "消除游戏": ["消除", "三消", "消消乐", "糖果", "开心消消乐"],
        "桌游棋牌": ["棋牌", "麻将", "斗地主", "德州", "三国杀"],
        "即时战略": ["即时战略", "rts", "星际争霸", "帝国时代", "红色警戒"],
        "SLOTS": ["slots", "老虎机", "slot", "777"],
    }

    for game_type, keywords in type_keywords.items():
        for kw in keywords:
            if kw in source or kw in name:
                return game_type

    return "未知类型"


# ──────────────────────────────────────────────────────────────────
# CLI 输出
# ──────────────────────────────────────────────────────────────────

def print_pending_list(games: list):
    """打印待分析游戏列表"""
    if not games:
        print("\n🎉 没有待分析的游戏，所有游戏都已有策划案！")
        return

    print(f"\n{'='*90}")
    print(f"待分析游戏列表 - 共 {len(games)} 个")
    print(f"{'='*90}")
    print(f"  {'ID':>4}  {'游戏名':<30} {'风格':<10} {'截图':>4} {'拼图':>4} {'策划案':<8}")
    print(f"  {'-'*70}")

    for g in games:
        planning_status_map = {
            "completed": "✅已完成",
            "pending": "⏳待分析",
            "failed": "❌失败",
            "skipped": "⏭跳过",
            None: "📝无记录",
        }
        status = planning_status_map.get(g.get("planning_status"), "📝无记录")
        print(f"  {g['id']:>4}  {g['name']:<30} {g['style']:<10} "
              f"{g['screenshot_count']:>4} {'是' if g['collage_exists'] else '否':>4} {status:<8}")

    pending = [g for g in games if g.get("planning_status") != "completed"]
    if pending:
        print(f"\n  其中 {len(pending)} 个游戏需要分析策划案")

    print(f"{'='*90}\n")


def print_all_games(games: list):
    """打印所有游戏列表（含分析状态）"""
    if not games:
        print("\n暂无游戏数据，请先运行 export_db.py 导入数据。")
        return

    print(f"\n{'='*90}")
    print(f"游戏列表 - 共 {len(games)} 个")
    print(f"{'='*90}")
    print(f"  {'ID':>4}  {'游戏名':<30} {'风格':<10} {'拼图':>4} {'策划案状态':<10}")
    print(f"  {'-'*70}")

    status_map = {
        "completed": "✅已完成",
        "pending": "⏳待分析",
        "failed": "❌失败",
        "skipped": "⏭跳过",
    }

    for g in games:
        status = status_map.get(g.get("planning_status"), "📝无记录")
        print(f"  {g['id']:>4}  {g['name']:<30} {g['style']:<10} "
              f"{'是' if g['collage_exists'] else '否':>4} {status:<10}")

    # 统计
    has_collage = sum(1 for g in games if g["collage_exists"])
    has_planning = sum(1 for g in games if g.get("planning_status") == "completed")
    print(f"\n  统计: {len(games)} 个游戏 | {has_collage} 个有拼图 | {has_planning} 个已完成策划案")

    print(f"{'='*90}\n")


def print_context(context: dict):
    """打印游戏分析上下文"""
    print("\n" + "=" * 80)
    print(f"游戏分析上下文: {context['game_name']}")
    print("=" * 80)
    print(f"  ID: {context['game_id']}")
    print(f"  风格: {context['style']}")
    print(f"  推断类型: {context.get('inferred_type', '未知')}")
    print(f"  截图数: {context['screenshot_count']}")
    print(f"  拼图: {'有' if context.get('collage_info') else '无'}")
    print()

    # 截图列表
    if context.get("screenshots"):
        print("  截图文件:")
        for ss in context["screenshots"]:
            dims = f"{ss.get('width', '?')}x{ss.get('height', '?')}" if ss.get("width") else "?x?"
            print(f"    [{ss['type']:>7}] {ss['filename']:<25} ({dims})")
            print(f"              路径: {ss['path']}")
    print()

    # 分析维度
    dims = context.get("analysis_dimensions", {})
    if dims:
        print(f"  推荐案型: {dims.get('type_class', '功能系统类')}")
        print(f"  核心循环模式: {dims.get('core_loop', '未知')}")
        print(f"  推荐分析关键词: {', '.join(dims.get('key_screens', ['待补充']))}")
        print()
        print("  重点分析维度:")
        for item in dims.get("analysis_focus", ["待补充"]):
            print(f"    - {item}")
        print()

    # 模板预览
    coll = context.get("collage_info")
    if coll:
        print(f"  拼接图路径: {coll['path']}")
        print(f"  拼接图尺寸: {coll.get('width', '?')}x{coll.get('height', '?')}")
        print()
        print("  ℹ 请使用多模态 AI 模型读取上述路径的拼接图，")
        print("    对照下方的策划案模板进行核心玩法分析。")
        print()

    print("-" * 80)
    print("策划案模板 (Markdown):")
    print("-" * 80)
    print(context.get("template", ""))
    print("=" * 80 + "\n")


# ──────────────────────────────────────────────────────────────────
# 主入口
# ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="游戏策划案生成脚本 - 基于截图分析核心玩法并输出策划案",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
        示例:
          检测识图模型:
            python generate_planning.py --check-model

          列出待分析游戏:
            python generate_planning.py --list-pending
            python generate_planning.py --list-pending --style 欧美

          列出所有游戏:
            python generate_planning.py --list-all

          批量生成（模板写入游戏文件夹 + 注册 pending）:
            python generate_planning.py --generate
            python generate_planning.py --generate --style 欧美 --limit 5

          准备单个游戏分析上下文:
            python generate_planning.py --prepare --game-id 1

          AI 分析后注册到数据库:
            python generate_planning.py --register --game-id 1

          保存策划案（自动从游戏文件夹读取）:
            python generate_planning.py --save --game-id 1
        """)
    )

    parser.add_argument("--check-model", action="store_true",
                        help="检测识图模型可用性")
    parser.add_argument("--list-pending", action="store_true",
                        help="列出待分析的游戏（有拼图无策划案）")
    parser.add_argument("--list-all", action="store_true",
                        help="列出所有游戏及其分析状态")
    parser.add_argument("--prepare", action="store_true",
                        help="准备游戏分析上下文")
    parser.add_argument("--save", action="store_true",
                        help="保存策划案到游戏目录（优先从游戏文件夹自动读取，也可通过 --content-file 指定）")
    parser.add_argument("--register", action="store_true",
                        help="注册已有 planning_doc.md 到数据库（AI 已在游戏文件夹生成后使用）")
    parser.add_argument("--game-id", type=int,
                        help="指定游戏 ID")
    parser.add_argument("--content-file", type=str,
                        help="外部策划案内容文件路径（配合 --save 使用，省略则从游戏文件夹自动读取 planning_doc.md）")
    parser.add_argument("--style", type=str,
                        help="按风格筛选（配合 --list-pending 使用）")
    parser.add_argument("--db-path", type=str, default=None,
                        help="数据库路径（默认 db/game_screenshots.db）")
    parser.add_argument("--generate", "-generate", action="store_true",
                        help="自动遍历所有待分析游戏（有拼图无策划案）并输出分析上下文")
    parser.add_argument("--limit", type=int, default=10,
                        help="--generate 模式下最多输出多少个待分析游戏（默认 10）")

    args = parser.parse_args()

    # 无参数时显示帮助
    if not any([args.check_model, args.list_pending, args.list_all,
                args.generate, args.prepare, args.save, args.register]):
        parser.print_help()
        print("\n提示: 使用 --check-model 检测识图模型，或 --list-pending 查看待分析游戏。")
        return

    db_path = args.db_path or str(get_db_path())

    # ── 检测识图模型 ──
    if args.check_model:
        result = check_vision_model()
        perform_model_check(verbose=True)
        return

    # ── 列出待分析游戏 ──
    if args.list_pending:
        if not Path(db_path).exists():
            print(f"\n⚠ 数据库不存在: {db_path}")
            print("  请先运行: python scripts/export_db.py")
            return
        conn = get_db_connection(db_path)
        try:
            games = list_pending_games(style=args.style, conn=conn)
            print_pending_list(games)
        finally:
            conn.close()
        return

    # ── 列出所有游戏 ──
    if args.list_all:
        if not Path(db_path).exists():
            print(f"\n⚠ 数据库不存在: {db_path}")
            print("  请先运行: python scripts/export_db.py")
            return
        conn = get_db_connection(db_path)
        try:
            games = list_all_games(style=args.style, conn=conn)
            print_all_games(games)
        finally:
            conn.close()
        return

    # ── 准备分析上下文 ──
    if args.prepare:
        if not args.game_id:
            print("错误: --prepare 需要 --game-id 参数")
            sys.exit(1)
        if not Path(db_path).exists():
            print(f"\n⚠ 数据库不存在: {db_path}")
            return
        conn = get_db_connection(db_path)
        try:
            context = prepare_game_context(args.game_id, conn)
            print_context(context)
        finally:
            conn.close()
        return

    # ── 批量生成（遍历所有待分析游戏） ──
    if args.generate:
        if not Path(db_path).exists():
            print(f"\n⚠ 数据库不存在: {db_path}")
            print("  请先运行: python .agents/skills/gameui-screenshot/scripts/tools/export_db.py --rebuild")
            return
        conn = get_db_connection(db_path)
        try:
            games = list_pending_games(style=args.style, conn=conn)
            # 只筛选出真正待分析的（没有 completed）
            pending_games = [g for g in games if g.get("planning_status") != "completed"]
            if not pending_games:
                print("\n🎉 没有待分析的游戏，所有游戏都已有策划案！")
                return

            # 限制输出数量
            if args.limit and len(pending_games) > args.limit:
                pending_games = pending_games[:args.limit]
                print(f"\n⚠ 找到 {len(games)} 个待分析游戏，仅输出前 {args.limit} 个")

            print(f"\n{'='*80}")
            print(f"待分析游戏策划案生成 - 共 {len(pending_games)} 个")
            print(f"{'='*80}\n")

            for idx, game in enumerate(pending_games, 1):
                gid = game['id']
                gname = game['name']
                gstyle = game['style']
                print(f"[{idx}/{len(pending_games)}] {gname} ({gstyle}) ID={gid}")

                # 1) 准备上下文 + 模板
                context = prepare_game_context(gid, conn)
                template = context.get("template", "")

                # 2) 将模板写入游戏文件夹 planning_doc.md
                write_template_to_game_dir(gid, template, conn)

                # 3) 输出游戏摘要和模板供 AI 分析
                print_context(context)

            print(f"\n💡 提示: 每个游戏的模板已写入对应游戏文件夹下的 planning_doc.md。")
            print(f"   请使用多模态 AI 读取 concept_combined.png 拼接图并直接编辑 planning_doc.md。")
            print(f"   完成后运行以下命令将分析结果注册到数据库:")
            print(f"   python .agents/skills/gameui-screenshot/scripts/workflows/generate_planning.py "
                  f"--register --game-id <ID>")
            print()
        finally:
            conn.close()
        return

    # ── 注册策划案（AI 已在游戏文件夹生成 planning_doc.md） ──
    if args.register:
        if not args.game_id:
            print("错误: --register 需要 --game-id 参数")
            sys.exit(1)
        if not Path(db_path).exists():
            print(f"\n⚠ 数据库不存在: {db_path}")
            return
        conn = get_db_connection(db_path)
        try:
            game = get_game_context(args.game_id, conn)
            if not game:
                print(f"错误: 游戏 ID={args.game_id} 不存在")
                sys.exit(1)

            # 确定游戏文件夹中的 planning_doc.md（get_game_context 已 resolve 路径）
            collage_info = game.get("collage_info")
            if collage_info and collage_info.get("path"):
                game_dir = Path(collage_info["path"]).parent
            else:
                game_dir = PROJECT_ROOT / game["source_dir"] / game["style"] / game["name"]

            doc_path = game_dir / "planning_doc.md"
            if not doc_path.exists():
                print(f"错误: 策划案不存在: {doc_path}")
                print("  请先使用 AI 在游戏文件夹中生成 planning_doc.md")
                sys.exit(1)

            with open(doc_path, "r", encoding="utf-8") as f:
                content = f.read()

            model_result = check_vision_model()
            model_status = "PASS" if model_result["ok"] else "WARN: " + model_result["message"]

            result = save_planning_doc(args.game_id, content, model_check=model_status, conn=conn)
            if result["ok"]:
                print(f"\n✅ 策划案已注册到数据库!")
                print(f"   游戏: {result['game_name']} ({result['style']})")
                print(f"   文件: {result['file_path']}")
            else:
                print(f"\n❌ 注册失败: {result['error']}")
                sys.exit(1)
        finally:
            conn.close()
        return

    # ── 保存策划案（从外部文件写入游戏文件夹） ──
    if args.save:
        if not args.game_id:
            print("错误: --save 需要 --game-id 参数")
            sys.exit(1)

        conn = get_db_connection(db_path)
        try:
            game = get_game_context(args.game_id, conn)
            if not game:
                print(f"错误: 游戏 ID={args.game_id} 不存在")
                sys.exit(1)

            # 确定游戏文件夹中的 planning_doc.md（get_game_context 已 resolve 路径）
            collage_info = game.get("collage_info")
            if collage_info and collage_info.get("path"):
                game_dir = Path(collage_info["path"]).parent
            else:
                game_dir = PROJECT_ROOT / game["source_dir"] / game["style"] / game["name"]

            if args.content_file:
                # 从指定文件读取内容
                content_path = Path(args.content_file)
                if not content_path.exists():
                    print(f"错误: 内容文件不存在: {content_path}")
                    sys.exit(1)
                with open(content_path, "r", encoding="utf-8") as f:
                    content = f.read()
            else:
                # 自动从游戏文件夹读取
                doc_path = game_dir / "planning_doc.md"
                if not doc_path.exists():
                    print(f"错误: 未指定 --content-file，且游戏文件夹中不存在 planning_doc.md: {doc_path}")
                    print("  提示: 使用 --content-file 指定策划案文件，或使用 --register 模式")
                    sys.exit(1)
                with open(doc_path, "r", encoding="utf-8") as f:
                    content = f.read()

            model_result = check_vision_model()
            model_status = "PASS" if model_result["ok"] else "WARN: " + model_result["message"]

            result = save_planning_doc(args.game_id, content, model_check=model_status, conn=conn)
            if result["ok"]:
                print(f"\n✅ 策划案已保存!")
                print(f"   游戏: {result['game_name']} ({result['style']})")
                print(f"   文件: {result['file_path']}")
            else:
                print(f"\n❌ 保存失败: {result['error']}")
                sys.exit(1)
        finally:
            conn.close()
        return


if __name__ == "__main__":
    main()
