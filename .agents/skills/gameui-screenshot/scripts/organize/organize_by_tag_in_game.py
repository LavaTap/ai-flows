"""将截图整理为二级目录结构：游戏 → 标签分组（每组最多3张）。

创建二级目录结构，截图先按游戏分组，再在每个游戏内按标签分组，
每个标签组最多包含3张截图。

输入结构（来自 organize_by_game）：
    input_dir/game_name/image.jpg

输出结构：
    output_dir/game_name/001_tag/image.jpg

使用示例：
    python .agents/skills/gameui-screenshot/scripts/organize/organize_by_tag_in_game.py
        [--input-dir ./screenshots_output_multi]
        [--output-dir ./screenshots_organized] [--dry-run]
"""
import argparse
import shutil
from pathlib import Path
from collections import defaultdict

# 项目根目录（脚本在 scripts/organize/，往上5级）
PROJECT_ROOT = Path(__file__).resolve().parents[5]


def parse_tag(filename):
    """从文件名提取标签（下划线分隔的第二段）。

    示例: "01_主界面_575887_足球天才.jpg" → "主界面"

    Args:
        filename: 要解析的文件名。

    Returns:
        str: 提取出的标签名，解析失败返回 "未知"。
    """
    parts = Path(filename).stem.split("_")
    return parts[1] if len(parts) >= 2 else "未知"


def organize(input_dir, output_dir, dry_run=False):
    """将截图整理为二级 游戏→标签 目录结构。

    读取已经按游戏分组的截图，在每个游戏内按标签再次分组，
    为每个标签创建编号文件夹，每个文件夹最多放3张截图。

    Args:
        input_dir: 包含游戏子目录和 JPG 的输入目录。
        output_dir: 二级整理结构的输出目录。
        dry_run: 如果为 True，只打印将要执行的操作，不实际复制。默认为 False.
    """
    src = Path(input_dir)
    dst = Path(output_dir)

    if not src.is_dir():
        print(f"[错误] 目录不存在: {src}")
        return

    game_dirs = sorted([d for d in src.iterdir() if d.is_dir()])
    if not game_dirs:
        # 也可能是直接在目录下有jpg文件
        jpgs = list(src.glob("*.jpg"))
        if jpgs:
            game_dirs = [src]
        else:
            print(f"[信息] 没有找到游戏子目录或jpg文件: {src}")
            return

    total_groups = 0
    total_copied = 0

    for game_dir in game_dirs:
        game_name = game_dir.name
        jpg_files = sorted(game_dir.glob("*.jpg"))
        if not jpg_files:
            continue

        # 按标签分组
        tag_groups = defaultdict(list)
        for f in jpg_files:
            tag = parse_tag(f.name)
            tag_groups[tag].append(f)

        # 拆分每组为至多3张的块
        game_groups = []  # [(folder_name, [files])]
        seq = 0
        for tag, files in sorted(tag_groups.items(), key=lambda x: -len(x[1])):
            for chunk_start in range(0, len(files), 3):
                chunk = files[chunk_start:chunk_start + 3]
                seq += 1
                safe_tag = "".join(c for c in tag if c.isalnum() or c in "_-. ").strip()
                folder_name = f"{seq:03d}_{safe_tag}"
                game_groups.append((folder_name, chunk))

        # 输出
        game_out = dst / game_name
        for folder_name, file_list in game_groups:
            group_dir = game_out / folder_name
            if dry_run:
                print(f"  {game_name}/{folder_name}/ ({len(file_list)}张)")
            else:
                group_dir.mkdir(parents=True, exist_ok=True)
            for f in file_list:
                dest = group_dir / f.name
                if not dry_run:
                    shutil.copy2(str(f), str(dest))
                    total_copied += 1
                else:
                    print(f"    {f.name}")

        total_groups += len(game_groups)
        print(f"  [{game_name}] {len(jpg_files)}张 → {len(game_groups)}组")

    print(f"\n{'='*50}")
    if dry_run:
        print(f"[模拟] 共 {len(game_dirs)} 个游戏，将创建 {total_groups} 个标签组")
    else:
        print(f"[完成] 共 {len(game_dirs)} 个游戏，{total_groups} 组，复制 {total_copied} 个文件")
        print(f"输出目录: {dst.resolve()}")


def main():
    """二级（游戏 → 标签）整理的主入口。

    解析命令行参数并执行二级整理流程。
    """
    parser = argparse.ArgumentParser(description="游戏→标签双层整理（至多3张一组）")
    parser.add_argument("--input-dir", default=str(PROJECT_ROOT / "screenshots_output_multi"), help="已按游戏分好的目录")
    parser.add_argument("--output-dir", default=str(PROJECT_ROOT / "screenshots_organized"), help="输出目录")
    parser.add_argument("--dry-run", action="store_true", help="仅模拟")
    args = parser.parse_args()
    organize(args.input_dir, args.output_dir, args.dry_run)


if __name__ == "__main__":
    main()
