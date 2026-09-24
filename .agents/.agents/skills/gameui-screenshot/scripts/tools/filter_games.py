"""过滤游戏目录 - 删除图片少于4张的游戏目录

删除不满足完整3张截图 + 1张拼图（共4张）的游戏目录。
运行后输出统计报告。

Usage:
  python .agents/skills/gameui-screenshot/scripts/filter_games.py --input-dir ./output/xxx
"""

import argparse
import os
from pathlib import Path
import shutil


def main():
    """过滤游戏目录主入口 - 删除不满足最小图片数量要求的游戏目录。

    递归扫描目录树，删除图片数量少于指定最小值的游戏目录，
    运行后输出统计报告并保存删除列表。
    """
    parser = argparse.ArgumentParser(
        description="过滤游戏目录 - 删除图片少于4张的不完整游戏"
    )
    parser.add_argument("--input-dir", required=True,
                        help="要处理的根目录（例如 ./output/20260703_xxx_标签截图）")
    parser.add_argument("--min-images", type=int, default=4,
                        help="最小图片数量要求（默认 4 = 3张原截图 + 1张拼图）")
    parser.add_argument("--dry-run", action="store_true",
                        help="只预览不删除")
    args = parser.parse_args()

    input_dir = Path(args.input_dir).resolve()
    if not input_dir.exists():
        print(f"[错误] 目录不存在: {input_dir}")
        exit(1)

    min_images = args.min_images
    dry_run = args.dry_run

    print(f"开始扫描: {input_dir}")
    print(f"要求最少图片数: {min_images}")
    print(f"试运行模式: {'是 (只预览不删除)' if dry_run else '否 (实际删除)'}")
    print("-" * 60)

    deleted_count = 0
    kept_count = 0
    total_size_deleted = 0
    deleted_paths = []

    # Recursively find all leaf directories that contain images
    def scan_directory(dir_path):
        nonlocal deleted_count, kept_count, total_size_deleted

        # Check if this directory has concept_*.png files
        png_files = list(dir_path.glob("*.png"))

        # If this directory contains PNGs, check it
        if len(png_files) > 0:
            if len(png_files) < min_images:
                # Calculate total size
                total_size = sum(f.stat().st_size for f in png_files)
                total_kb = total_size / 1024
                print(f"[删除] {dir_path.relative_to(input_dir)} - {len(png_files)} 张图片 ({total_kb:.1f} KB)")
                if not dry_run:
                    for png in png_files:
                        png.unlink()
                    try:
                        dir_path.rmdir()
                    except Exception:
                        pass  # Directory not empty, ignore
                deleted_count += 1
                total_size_deleted += total_size
                deleted_paths.append(str(dir_path))
                return
            else:
                kept_count += 1
                return

        # Otherwise scan subdirectories
        for subdir in dir_path.iterdir():
            if subdir.is_dir() and not subdir.name.startswith("."):
                scan_directory(subdir)

    scan_directory(input_dir)

    print("-" * 60)
    print(f"完成!")
    print(f"  保留完整游戏: {kept_count} 个")
    print(f"  删除不完整: {deleted_count} 个")
    print(f"  释放空间: {total_size_deleted / 1024 / 1024:.2f} MB")

    # Write report
    if deleted_paths:
        report_path = input_dir / "_filter_deleted.txt"
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(f"过滤删除报告\n")
            f.write(f"=============\n")
            f.write(f"处理目录: {input_dir}\n")
            f.write(f"最小图片要求: {min_images} 张\n")
            f.write(f"删除数量: {deleted_count} 个\n")
            f.write(f"释放空间: {total_size_deleted / 1024 / 1024:.2f} MB\n")
            f.write(f"\n删除列表:\n")
            for path in deleted_paths:
                f.write(f"  {path}\n")
        print(f"  删除列表已保存: {report_path}")


if __name__ == "__main__":
    main()
