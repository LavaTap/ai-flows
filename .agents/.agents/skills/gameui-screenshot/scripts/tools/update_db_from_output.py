"""从 output 目录更新 SQLite 数据库（增量同步工具）。

与 export_db.py 共享核心逻辑（扫描 + 导出），提供更简洁的用户接口。
推荐在每次完成截图爬取/整理后运行此脚本。

Usage:
  python update_db_from_output.py                          # 扫描全部 output/ 增量更新
  python update_db_from_output.py --target output/xxx      # 指定目录
  python update_db_from_output.py --rebuild                # 重建数据库
  python update_db_from_output.py --dry-run                # 仅预览
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
    """将绝对路径转为相对于项目根目录的相对路径"""
    if not path:
        return path
    root = str(PROJECT_ROOT).replace("\\", "/")
    p = str(path).replace("\\", "/")
    if p.startswith(root + "/"):
        return path[len(str(PROJECT_ROOT)) + 1:]
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
    """获取图片尺寸"""
    if Image is None:
        return (None, None)
    try:
        with Image.open(filepath) as im:
            return im.size
    except Exception:
        return (None, None)


def scan_output(root: Path) -> list:
    """扫描 output 目录，发现所有游戏截图数据"""
    results = []

    for top_dir in sorted(root.iterdir()):
        if not top_dir.is_dir() or top_dir.name.startswith('_'):
            continue

        # 方式1: 检查 _summary.json
        summary_path = top_dir / "_summary.json"
        if summary_path.exists():
            _extract_from_summary(top_dir, summary_path, results)
            continue

        # 方式2: 扫描嵌套结构
        for sub_dir in top_dir.iterdir():
            if sub_dir.is_dir():
                sub_summary = sub_dir / "_summary.json"
                if sub_summary.exists():
                    _extract_from_summary(sub_dir, sub_summary, results,
                                          source_label=top_dir.name)

        # 方式3: 直接扫描 {style}/{game}/ 结构
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


def _extract_from_summary(base_dir: Path, summary_path: Path, results: list,
                          source_label: str = None):
    """从 _summary.json 提取游戏数据"""
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

        game_dir = base_dir / style / gdir
        if not game_dir.exists():
            game_dir = base_dir / gdir
        if not game_dir.exists():
            print(f"  [跳过] 目录不存在: {style}/{gdir}")
            continue

        entry = _scan_game_dir(game_dir, style, source,
                               game_data.get("game_name", gdir))
        if entry:
            results.append(entry)


def _scan_game_dir(game_dir: Path, style: str, source: str,
                   game_name: str = None) -> dict:
    """扫描单个游戏目录"""
    name = game_name or game_dir.name
    png_files = sorted(
        [f for f in game_dir.glob("*.png") if not f.name.startswith("_tmp_")])

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


def export_to_db(data: list, db_path: str, rebuild: bool = False) -> dict:
    """导出数据到 SQLite 数据库，返回统计信息"""
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    if rebuild and db_path.exists():
        db_path.unlink()
        print(f"[重建] 已删除旧数据库: {db_path}")

    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys = ON")

    stats = {"new_games": 0, "updated_games": 0, "screenshots": 0,
             "errors": 0}

    try:
        conn.executescript(DB_SCHEMA)

        if rebuild:
            conn.execute("DELETE FROM screenshots")
            conn.execute("DELETE FROM games")
            conn.execute("DELETE FROM planning_docs")
            conn.commit()

        for entry in data:
            try:
                # 按 (name, style, source_dir) 去重
                cursor = conn.execute(
                    "SELECT id FROM games WHERE name=? AND style=? AND source_dir=?",
                    (entry["name"], entry["style"], entry["source_dir"])
                )
                existing = cursor.fetchone()

                if existing and not rebuild:
                    game_id = existing[0]
                    conn.execute(
                        "UPDATE games SET screenshot_count=?, collage_exists=?, "
                        "planning_doc_path=? WHERE id=?",
                        (entry["screenshot_count"], entry["collage_exists"],
                         entry.get("planning_doc_path"), game_id)
                    )
                    stats["updated_games"] += 1
                else:
                    cursor = conn.execute(
                        "INSERT INTO games (name, style, screenshot_count, "
                        "collage_exists, source_dir, planning_doc_path) "
                        "VALUES (?,?,?,?,?,?)",
                        (entry["name"], entry["style"],
                         entry["screenshot_count"], entry["collage_exists"],
                         entry["source_dir"], entry.get("planning_doc_path"))
                    )
                    game_id = cursor.lastrowid
                    stats["new_games"] += 1

                # 同步 planning_docs 表（存在则更新 file_path，不存在则插入）
                if entry.get("planning_doc_path"):
                    existing_plan = conn.execute(
                        "SELECT id FROM planning_docs WHERE game_id=?",
                        (game_id,)
                    ).fetchone()
                    if existing_plan:
                        conn.execute(
                            "UPDATE planning_docs SET file_path=?, "
                            "analysis_status='completed' WHERE game_id=?",
                            (entry["planning_doc_path"], game_id)
                        )
                    else:
                        conn.execute(
                            "INSERT INTO planning_docs (game_id, file_path, "
                            "analysis_status) VALUES (?,?,?)",
                            (game_id, entry["planning_doc_path"], "completed")
                        )

                # 刷新截图记录
                conn.execute("DELETE FROM screenshots WHERE game_id=?",
                             (game_id,))
                for ss in entry["screenshots"]:
                    conn.execute(
                        "INSERT INTO screenshots (game_id, filename, path, "
                        "type, width, height) VALUES (?,?,?,?,?,?)",
                        (game_id, ss["filename"], ss["path"], ss["type"],
                         ss["width"], ss["height"])
                    )
                    stats["screenshots"] += 1

            except Exception as e:
                print(f"  [错误] {entry.get('style','?')}/{entry.get('name','?')}: {e}")
                stats["errors"] += 1
                continue

        conn.commit()
    finally:
        conn.close()

    return stats


def print_dry_run(data: list):
    """预览模式：打印将要入库的数据"""
    print(f"\n{'='*60}")
    print(f"  [预览模式] 发现 {len(data)} 个游戏，不会写入数据库")
    print(f"{'='*60}")

    # 按风格分组统计
    style_stats = {}
    for entry in data:
        s = entry["style"]
        if s not in style_stats:
            style_stats[s] = {"count": 0, "collages": 0, "planning": 0,
                              "total_ss": 0}
        style_stats[s]["count"] += 1
        style_stats[s]["collages"] += entry["collage_exists"]
        style_stats[s]["planning"] += 1 if entry.get("planning_doc_path") else 0
        style_stats[s]["total_ss"] += entry["screenshot_count"]

    print(f"\n  {'风格':<12} {'游戏数':>6} {'拼图':>6} {'策划案':>6} {'截图':>8}")
    print(f"  {'-'*46}")
    for style, s in sorted(style_stats.items()):
        print(f"  {style:<12} {s['count']:>6} {s['collages']:>6} "
              f"{s['planning']:>6} {s['total_ss']:>8}")

    # 列出所有游戏
    print(f"\n  游戏清单:")
    for entry in data:
        tags = []
        if entry["collage_exists"]:
            tags.append("拼图")
        if entry.get("planning_doc_path"):
            tags.append("策划案")
        tag_str = f" [{', '.join(tags)}]" if tags else ""
        print(f"    {entry['style']:<10} {entry['name']:<40} "
              f"{entry['screenshot_count']}张截图{tag_str}")


def print_db_stats(db_path: str):
    """打印数据库当前统计"""
    if not Path(db_path).exists():
        print(f"\n  数据库不存在: {db_path}")
        return

    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.execute(
            "SELECT style, COUNT(*) as cnt, SUM(screenshot_count) as ss_total, "
            "SUM(collage_exists) as collages, "
            "SUM(CASE WHEN g.planning_doc_path IS NOT NULL THEN 1 ELSE 0 END) "
            "as planning_count "
            "FROM games g GROUP BY style ORDER BY style"
        )
        print(f"\n  {'风格':<12} {'游戏数':>6} {'截图数':>8} {'拼图数':>6} "
              f"{'策划案':>6}")
        print(f"  {'-'*46}")
        total_games = 0
        total_ss = 0
        total_collages = 0
        total_planning = 0
        for row in cursor.fetchall():
            print(f"  {row[0]:<12} {row[1]:>6} {row[2]:>8} {row[3]:>6} "
                  f"{row[4]:>6}")
            total_games += row[1]
            total_ss += row[2]
            total_collages += row[3]
            total_planning += row[4]
        print(f"  {'-'*46}")
        print(f"  {'合计':<12} {total_games:>6} {total_ss:>8} "
              f"{total_collages:>6} {total_planning:>6}")
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(
        description="从 output 目录更新 SQLite 数据库（增量同步）")
    parser.add_argument("--target", default=None,
                        help="指定 output 目录（默认: output/，扫描所有子目录）")
    parser.add_argument("--db-path", default=None,
                        help="数据库路径（默认: db/game_screenshots.db）")
    parser.add_argument("--rebuild", action="store_true",
                        help="重建数据库（清空旧数据全量导入）")
    parser.add_argument("--dry-run", action="store_true",
                        help="仅预览扫描结果，不写入数据库")
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
    print(f"数据库:   {db_path}")
    mode = "重建" if args.rebuild else ("预览" if args.dry_run else "增量更新")
    print(f"模式:     {mode}")
    print()

    # 扫描
    data = scan_output(scan_root)
    print(f"发现 {len(data)} 个游戏")

    if not data:
        print("未发现游戏数据，无需更新。")
        sys.exit(0)

    if args.dry_run:
        print_dry_run(data)
        sys.exit(0)

    # 导出
    print(f"\n开始{'重建' if args.rebuild else '增量'}同步到数据库...\n")
    stats = export_to_db(data, db_path, rebuild=args.rebuild)

    # 打印结果
    print(f"\n{'='*60}")
    print(f"数据库: {Path(db_path).resolve()}")
    print(f"新增游戏: {stats['new_games']} 个")
    print(f"更新游戏: {stats['updated_games']} 个")
    print(f"写入截图: {stats['screenshots']} 张")
    if stats['errors']:
        print(f"失败:     {stats['errors']} 个")
    print(f"{'='*60}")

    # 数据库统计
    print_db_stats(db_path)


if __name__ == "__main__":
    main()
