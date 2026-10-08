"""清理 game_concepts 中的空文件夹，输出总结日志。"""
import os
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from core.log_util import LogManager

CONCEPTS_DIR = SCRIPTS_DIR.parent / "game_concepts"


def summarize():
    """扫描 game_concepts 目录，统计各游戏完成情况并生成清理报告。

    统计：
    - 总游戏文件夹数
    - 已完成（3张截图+拼图）的游戏
    - 不完整（缺截图）的游戏
    - 空文件夹，并自动删除
    """
    if not CONCEPTS_DIR.exists():
        print(f"目录不存在: {CONCEPTS_DIR}")
        return

    log = LogManager(CONCEPTS_DIR, name="cleanup")

    styles = sorted([d for d in CONCEPTS_DIR.iterdir() if d.is_dir()])
    all_games = []
    empty_games = []
    incomplete_games = []
    complete_games = []

    for style_dir in styles:
        style = style_dir.name
        game_dirs = sorted([d for d in style_dir.iterdir() if d.is_dir()])

        for game_dir in game_dirs:
            gname = game_dir.name
            all_games.append((style, gname))

            pngs = sorted(game_dir.glob("concept_*.png"))
            has_combined = any("combined" in f.name for f in pngs)
            has_3_pngs = sum(1 for f in pngs if "combined" not in f.name)

            if not pngs:
                empty_games.append((style, gname))
            elif has_combined and has_3_pngs >= 3:
                complete_games.append((style, gname))
            else:
                png_names = [f.name for f in pngs]
                incomplete_games.append((style, gname, has_3_pngs, has_combined, png_names))

    # 删除空文件夹
    deleted_count = 0
    for style, gname in empty_games:
        path = CONCEPTS_DIR / style / gname
        try:
            path.rmdir()
            deleted_count += 1
        except OSError as e:
            print(f"  [删除失败] {style}/{gname}: {e}")

    # ── 构建日志 ──
    log.header("game_concepts 清理报告")

    log.add(("数据目录", CONCEPTS_DIR))
    log.blank()
    log.add("总览:")
    log.add(("风格数", len(styles)))
    log.add(("游戏文件夹总数", len(all_games)))
    log.add(("已完成(3张+拼图)", f"{len(complete_games)} ({len(complete_games)*100//max(len(all_games),1)}%)"))
    log.add(("不完整(缺图)", len(incomplete_games)))
    log.add(("空文件夹(已删除)", deleted_count))

    log.blank()
    log.add("各风格统计:")
    for style in styles:
        sname = style.name
        total = sum(1 for s, g in all_games if s == sname)
        done = sum(1 for s, g in complete_games if s == sname)
        empty_before = sum(1 for s, g in empty_games if s == sname)
        incomp = sum(1 for s, g, *_ in incomplete_games if s == sname)
        log.add(f"  {sname}: {total} 个文件夹, {done} 完成, {incomp} 不完整, {empty_before} 空(已删除)")

    log.blank()
    log.sub_header(f"已完成 — {len(complete_games)} 个游戏")
    for style, gname in complete_games:
        log.game_line("[OK]", f"{style}/{gname}")

    log.blank()
    log.sub_header(f"不完整 — {len(incomplete_games)} 个游戏")
    for style, gname, n, has_cmb, pngs in incomplete_games:
        flag = f"({n}张, {'有拼图' if has_cmb else '无拼图'})"
        log.game_line("[!]", f"{style}/{gname} {flag} {pngs}")

    log.blank()
    log.sub_header(f"空文件夹已删除 — {deleted_count} 个")
    for style, gname in empty_games:
        log.game_line("[DEL]", f"{style}/{gname}")

    log.close()


if __name__ == "__main__":
    summarize()
