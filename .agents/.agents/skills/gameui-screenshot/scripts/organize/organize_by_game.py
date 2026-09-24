"""按游戏名将截图整理到子目录。

解析 "序号_标签ID_游戏名.jpg" 格式的文件名，将截图移动到
输入目录下以游戏名命名的子目录中。

使用示例：
    python .agents/skills/gameui-screenshot/scripts/organize/organize_by_game.py
        [--input-dir ./screenshots_output_multi] [--dry-run]
"""
import argparse
import shutil
from pathlib import Path

# 项目根目录（脚本在 scripts/organize/，往上5级）
PROJECT_ROOT = Path(__file__).resolve().parents[5]


def parse_filename(filename):
    """解析文件名提取序号、标签、图片ID和游戏名。

    期望格式: "序号_标签_图片ID_游戏名.jpg"
    示例: "01_主界面_575887_足球天才"

    Args:
        filename: 要解析的文件名。

    Returns:
        tuple: (序号, 标签, 图片ID, 游戏名)，解析失败返回 None。
    """
    stem = Path(filename).stem  # 去掉扩展名
    # 格式: 序号_标签_ID_游戏名  如: 01_主界面_575887_足球天才
    parts = stem.split("_")
    if len(parts) >= 4:
        # 第一部分是序号，第二部分是标签，第三部分是ID，剩下的都是游戏名
        seq = parts[0]
        tag = parts[1]
        img_id = parts[2]
        game_name = "_".join(parts[3:])
        return seq, tag, img_id, game_name
    return None


def organize_dir(input_dir, dry_run=False):
    """整理目录中所有 JPG 截图，按从文件名解析出的游戏名
    移动到子目录中。

    Args:
        input_dir: 包含待整理 JPG 截图的目录。
        dry_run: 如果为 True，只打印将要执行的操作，不实际移动。默认为 False.
    """
    src = Path(input_dir)
    if not src.is_dir():
        print(f"[错误] 目录不存在: {src}")
        return

    jpg_files = sorted(src.glob("*.jpg"))
    if not jpg_files:
        print(f"[信息] 目录中没有 .jpg 文件: {src}")
        return

    print(f"[信息] 共找到 {len(jpg_files)} 张截图")
    print(f"[信息] 按游戏名归类到子文件夹...\n")

    moved_count = 0
    skipped_count = 0
    game_stats = {}

    for f in jpg_files:
        parsed = parse_filename(f.name)
        if not parsed:
            print(f"  [跳过] 文件名格式无法解析: {f.name}")
            skipped_count += 1
            continue

        seq, tag, img_id, game_name = parsed
        if not game_name:
            print(f"  [跳过] 无法提取游戏名: {f.name}")
            skipped_count += 1
            continue

        game_dir = src / game_name
        dest = game_dir / f.name

        game_stats[game_name] = game_stats.get(game_name, 0) + 1

        if dry_run:
            print(f"  [模拟] {f.name} -> {game_name}/")
        else:
            game_dir.mkdir(parents=True, exist_ok=True)
            shutil.move(str(f), str(dest))
            moved_count += 1

    print(f"\n{'=' * 50}")
    if dry_run:
        print(f"[模拟] 将移动 {moved_count} 个文件（跳过 {skipped_count} 个）")
    else:
        print(f"[完成] 已移动 {moved_count} 个文件（跳过 {skipped_count} 个）")
    
    print(f"\n游戏分布:")
    print(f"{'游戏名':<25} {'截图数':<10}")
    print('-' * 35)
    for gname, count in sorted(game_stats.items(), key=lambda x: -x[1]):
        print(f"{gname:<25} {count:<10}")
    print(f"\n总计 {len(game_stats)} 个游戏")


def main():
    """按游戏分类整理脚本主入口。

    解析命令行参数并按游戏名整理截图。
    """
    parser = argparse.ArgumentParser(description="按游戏名整理截图文件")
    parser.add_argument("--input-dir", default=str(PROJECT_ROOT / "screenshots_output_multi"), help="截图所在目录")
    parser.add_argument("--dry-run", action="store_true", help="仅模拟不实际移动")
    args = parser.parse_args()
    organize_dir(args.input_dir, args.dry_run)


if __name__ == "__main__":
    main()
