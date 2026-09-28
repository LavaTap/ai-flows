"""从 output 目录扫描游戏截图数据，导出到 SQLite 数据库。

数据库表结构:
  - games 表: id, name, style, screenshot_count, collage_exists, source_dir, planning_doc_path, created_at
  - screenshots 表: id, game_id, filename, path, type(single/collage), width, height, created_at
  - planning_docs 表: id, game_id, file_path, analysis_status, model_check, generated_at, created_at

所有文件路径均为相对于项目根目录的相对路径（如 output/xxx/欧美/游戏名/concept_1.png）。

Usage:
  python export_db.py                          # 扫描 output/ 导出到 db/game_screenshots.db
  python export_db.py --target output/xxx      # 指定扫描目录
  python export_db.py --db-path ./my_data.db   # 指定数据库路径
  python export_db.py --rebuild                # 重建数据库（删除旧数据）
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from datetime import datetime

try:
    from PIL import Image
except ImportError:
    Image = None

# 项目根目录（脚本在 scripts/tools/，往上5级）
PROJECT_ROOT = Path(__file__).resolve().parents[5]


def _to_rel(path: str) -> str:
    """将绝对路径转换为相对于项目根目录的相对路径。

    数据库中存储相对路径便于目录移动后路径仍然有效。

    Args:
        path: 原始绝对路径字符串。

    Returns:
        转换后的相对路径，如果无法匹配根目录则返回原路径。
    """
    if not path:
        return path
    root = str(PROJECT_ROOT).replace("\\", "/")
    p = str(path).replace("\\", "/")
    if p.startswith(root + "/"):
        return path[len(str(PROJECT_ROOT)) + 1:]  # keep original separator
    if p.startswith(root):
        return path[len(str(PROJECT_ROOT)) + 1:]
    return path


DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    style           TEXT NOT NULL,
    screenshot_count INTEGER DEFAULT 0,
    collage_exists  INTEGER DEFAULT 0,
    source_dir      TEXT,
    planning_doc_path TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS screenshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id         INTEGER NOT NULL,
    filename        TEXT NOT NULL,
    path            TEXT NOT NULL,
    type            TEXT CHECK(type IN ('single','collage')) NOT NULL,
    width           INTEGER,
    height          INTEGER,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS planning_docs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id         INTEGER NOT NULL UNIQUE,
    file_path       TEXT NOT NULL,
    content_preview TEXT,
    analysis_status TEXT CHECK(analysis_status IN ('pending','completed','failed','skipped')) DEFAULT 'pending',
    model_check     TEXT,
    generated_at    TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_screenshots_game_id ON screenshots(game_id);
CREATE INDEX IF NOT EXISTS idx_games_style ON games(style);
CREATE INDEX IF NOT EXISTS idx_games_name ON games(name);
CREATE INDEX IF NOT EXISTS idx_planning_docs_game_id ON planning_docs(game_id);
CREATE INDEX IF NOT EXISTS idx_planning_docs_status ON planning_docs(analysis_status);
"""


def get_image_size(filepath: Path) -> tuple:
    """获取图片的宽度和高度。

    Args:
        filepath: 图片文件路径。

    Returns:
        tuple: (宽度, 高度)，PIL 不可用或读取失败返回 (None, None)。
    """
    if Image is None:
        return (None, None)
    try:
        with Image.open(filepath) as im:
            return im.size
    except Exception:
        return (None, None)


def scan_output(root: Path) -> list:
    """扫描 output 目录，发现游戏数据。

    支持三种目录结构发现方式：
    1. 顶级目录有 _summary.json → 从中提取游戏列表
    2. 子目录有 _summary.json → 提取并记录来源标签
    3. 直接扫描 {style}/{game}/ 结构 → 无需 _summary.json

    Args:
        root: 要扫描的根目录（通常是 output/）。

    Returns:
        list: 扫描到的游戏数据字典列表。
    """
    results = []

    for top_dir in sorted(root.iterdir()):
        if not top_dir.is_dir() or top_dir.name.startswith('_'):
            continue

        # 方式1: 检查 _summary.json
        summary_path = top_dir / "_summary.json"
        if summary_path.exists():
            _extract_from_summary(top_dir, summary_path, results)
            continue

        # 方式2: 扫描嵌套结构 - 检查子目录是否包含 _summary.json
        for sub_dir in top_dir.iterdir():
            if sub_dir.is_dir():
                sub_summary = sub_dir / "_summary.json"
                if sub_summary.exists():
                    _extract_from_summary(sub_dir, sub_summary, results, source_label=top_dir.name)

        # 方式3: 直接扫描 {style}/{game}/ 结构（无需 _summary.json）
        # 检查是否有风格分类子目录
        has_style_dirs = any(
            d.is_dir() and not d.name.startswith('_')
            and any(sd.is_dir() and not sd.name.startswith('_') for sd in d.iterdir())
            for d in top_dir.iterdir()
        )
        if has_style_dirs:
            for style_dir in top_dir.iterdir():
                if not style_dir.is_dir() or style_dir.name.startswith('_'):
                    continue
                style = style_dir.name
                for game_dir in sorted(style_dir.iterdir()):
                    if not game_dir.is_dir():
                        continue
                    game_data = _scan_game_dir(game_dir, style, str(top_dir))
                    if game_data:
                        results.append(game_data)

    return results


def _extract_from_summary(base_dir: Path, summary_path: Path, results: list, source_label: str = None):
    """从 _summary.json 提取游戏数据添加到结果列表。

    Args:
        base_dir: 包含 _summary.json 的基础目录。
        summary_path: _summary.json 文件路径。
        results: 结果列表，提取出的游戏数据会追加到此。
        source_label: 可选，来源标签，用于标记所属批次。
    """
    try:
        with open(summary_path, 'r', encoding='utf-8') as f:
            summary = json.load(f)
    except Exception as e:
        print(f"  [警告] 无法读取 {summary_path}: {e}")
        return

    games = summary.get("games", {})
    source = source_label or base_dir.name

    for key, game_data in games.items():
        parts = key.split("/", 1)
        style = parts[0] if len(parts) == 2 else "未知"
        gdir = parts[1] if len(parts) == 2 else parts[0]

        # 查找游戏目录
        # 先尝试新格式: base_dir/{style}/{gdir}
        game_dir = base_dir / style / gdir
        if not game_dir.exists():
            # 再尝试旧格式: base_dir/{gdir}
            game_dir = base_dir / gdir
        if not game_dir.exists():
            print(f"  [跳过] 目录不存在: {style}/{gdir}")
            continue

        entry = _scan_game_dir(game_dir, style, source, game_data.get("game_name", gdir))
        if entry:
            results.append(entry)


def _scan_game_dir(game_dir: Path, style: str, source: str,
                   game_name: str = None) -> dict:
    """扫描单个游戏目录，收集所有 concept 截图信息。

    Args:
        game_dir: 游戏目录路径。
        style: 游戏风格。
        source: 来源目录名称。
        game_name: 可选，覆盖默认的游戏名称（使用目录名）。

    Returns:
        dict: 扫描到的游戏数据字典，包含截图列表，无截图返回 None。
    """
    name = game_name or game_dir.name
    png_files = sorted([f for f in game_dir.glob("*.png") if not f.name.startswith("_tmp_")])

    screenshots = []
    collage_path = None

    for f in png_files:
        w, h = get_image_size(f)
        rel_path = _to_rel(str(f))
        if f.stem == "concept_combined":
            collage_path = rel_path
            screenshots.append({
                "filename": f.name,
                "path": rel_path,
                "type": "collage",
                "width": w,
                "height": h,
            })
        elif f.stem.startswith("concept_"):
            screenshots.append({
                "filename": f.name,
                "path": rel_path,
                "type": "single",
                "width": w,
                "height": h,
            })

    if not screenshots:
        return None

    # 检测策划案文件
    planning_doc_path = None
    for doc_name in ("planning_doc.md", "planning_doc.txt"):
        doc_file = game_dir / doc_name
        if doc_file.exists():
            planning_doc_path = _to_rel(str(doc_file))
            break

    return {
        "name": name,
        "style": style,
        "source_dir": source,
        "screenshot_count": len([s for s in screenshots if s["type"] == "single"]),
        "collage_exists": 1 if collage_path else 0,
        "planning_doc_path": planning_doc_path,
        "screenshots": screenshots,
    }


def export_to_db(data: list, db_path: str, rebuild: bool = False):
    """将扫描到的游戏数据导出到 SQLite 数据库。

    创建表结构（如果不存在），插入游戏和截图数据，支持增量更新。

    Args:
        data: 扫描到的游戏数据列表。
        db_path: 输出数据库文件路径。
        rebuild: 如果为 True，删除旧数据库重建。默认为 False。

    Returns:
        Path: 写入的数据库文件路径。
    """
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    if rebuild and db_path.exists():
        db_path.unlink()
        print(f"[重建] 已删除旧数据库: {db_path}")

    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        conn.executescript(DB_SCHEMA)

        if rebuild:
            conn.execute("DELETE FROM screenshots")
            conn.execute("DELETE FROM games")
            conn.commit()

        game_count = 0
        screenshot_count = 0

        for entry in data:
            # Check if game already exists (by name + style + source_dir)
            cursor = conn.execute(
                "SELECT id FROM games WHERE name=? AND style=? AND source_dir=?",
                (entry["name"], entry["style"], entry["source_dir"])
            )
            existing = cursor.fetchone()

            if existing and not rebuild:
                game_id = existing[0]
                # Update existing game
                conn.execute(
                    "UPDATE games SET screenshot_count=?, collage_exists=?, planning_doc_path=? WHERE id=?",
                    (entry["screenshot_count"], entry["collage_exists"],
                     entry.get("planning_doc_path"), game_id)
                )
                print(f"  [更新] {entry['style']}/{entry['name']} (game_id={game_id})")
            else:
                cursor = conn.execute(
                    "INSERT INTO games (name, style, screenshot_count, collage_exists, source_dir, planning_doc_path) VALUES (?,?,?,?,?,?)",
                    (entry["name"], entry["style"], entry["screenshot_count"],
                     entry["collage_exists"], entry["source_dir"],
                     entry.get("planning_doc_path"))
                )
                game_id = cursor.lastrowid
                game_count += 1
                print(f"  [新增] {entry['style']}/{entry['name']} (game_id={game_id})")

            # Handle planning_docs table（只存路径，不存内容）
            if entry.get("planning_doc_path"):
                existing_plan = conn.execute(
                    "SELECT id FROM planning_docs WHERE game_id=?", (game_id,)
                ).fetchone()
                if not existing_plan:
                    conn.execute(
                        "INSERT INTO planning_docs (game_id, file_path, analysis_status) "
                        "VALUES (?,?,?)",
                        (game_id, entry["planning_doc_path"], "completed")
                    )

            # Insert screenshots (delete old ones for this game first)
            conn.execute("DELETE FROM screenshots WHERE game_id=?", (game_id,))
            for ss in entry["screenshots"]:
                conn.execute(
                    "INSERT INTO screenshots (game_id, filename, path, type, width, height) VALUES (?,?,?,?,?,?)",
                    (game_id, ss["filename"], ss["path"], ss["type"], ss["width"], ss["height"])
                )
                screenshot_count += 1

        conn.commit()

        # Print summary
        print(f"\n{'='*60}")
        print(f"数据库: {db_path.resolve()}")
        print(f"新增游戏: {game_count} 个")
        print(f"写入截图: {screenshot_count} 张")
        print(f"{'='*60}")

        # Show stats
        cursor = conn.execute(
            "SELECT style, COUNT(*) as cnt, SUM(screenshot_count) as ss_total, "
            "SUM(collage_exists) as collages, "
            "SUM(CASE WHEN g.planning_doc_path IS NOT NULL THEN 1 ELSE 0 END) as planning_count "
            "FROM games g GROUP BY style ORDER BY style"
        )
        print("\n按风格统计:")
        print(f"  {'风格':<12} {'游戏数':>6} {'截图数':>8} {'拼图数':>6} {'策划案':>6}")
        print(f"  {'-'*48}")
        for row in cursor.fetchall():
            print(f"  {row[0]:<12} {row[1]:>6} {row[2]:>8} {row[3]:>6} {row[4]:>6}")

        # Show sample games
        cursor = conn.execute(
            "SELECT g.name, g.style, COUNT(s.id) as cnt, g.collage_exists "
            "FROM games g LEFT JOIN screenshots s ON g.id=s.game_id "
            "GROUP BY g.id ORDER BY g.style, g.name"
        )
        print(f"\n游戏清单:")
        print(f"  {'游戏名':<30} {'风格':<12} {'截图':>6} {'拼图':>6}")
        print(f"  {'-'*58}")
        for row in cursor.fetchall():
            print(f"  {row[0]:<30} {row[1]:<12} {row[2]:>6} {'是' if row[3] else '否':>6}")

    finally:
        conn.close()

    return db_path


def main():
    """导出数据库脚本主入口。

    扫描 output 目录中的游戏截图数据，导出到 SQLite 数据库，
    支持增量更新和重建。
    """
    parser = argparse.ArgumentParser(description="导出 output 游戏截图数据到 SQLite 数据库")
    parser.add_argument("--target", default=None,
                        help="指定 output 目录（默认: output/）")
    parser.add_argument("--db-path", default=None,
                        help="数据库路径（默认: db/game_screenshots.db）")
    parser.add_argument("--rebuild", action="store_true",
                        help="重建数据库（清空旧数据）")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[5]

    if args.target:
        scan_root = Path(args.target)
    else:
        scan_root = project_root / "output"

    if not scan_root.exists():
        print(f"错误: 目录不存在: {scan_root}")
        sys.exit(1)

    if args.db_path:
        db_path = args.db_path
    else:
        db_path = str(project_root / "db" / "game_screenshots.db")

    print(f"扫描目录: {scan_root}")
    print(f"数据库: {db_path}")
    print(f"模式: {'重建' if args.rebuild else '增量更新'}\n")

    data = scan_output(scan_root)
    print(f"发现 {len(data)} 个游戏\n")

    if data:
        export_to_db(data, db_path, rebuild=args.rebuild)
    else:
        print("未发现游戏数据。")


if __name__ == "__main__":
    main()
