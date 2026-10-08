"""整理现有 output 目录：按 _summary.json 将游戏子文件夹移动到风格分类子目录下。

Usage:
  python reorganize_output.py                                    # 整理所有 output 子目录
  python reorganize_output.py --target output/20260713_102521_xxx  # 指定目录
  python reorganize_output.py --dry-run                            # 预览不执行
"""

import argparse
import shutil
import sys
from pathlib import Path
from datetime import datetime

try:
    import json
except ImportError:
    pass


def main():
    """整理现有 output 目录的主入口。

    根据 _summary.json 将游戏子文件夹移动到对应风格分类子目录下，
    完成从旧格式（扁平）到新格式（按风格分类）的转换。
    """
    parser = argparse.ArgumentParser(description="整理 output 目录：按风格分类游戏子文件夹")
    parser.add_argument("--target", default=None,
                        help="指定目标目录（默认: 扫描 output/ 所有子目录）")
    parser.add_argument("--dry-run", action="store_true",
                        help="预览模式，不实际移动文件")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[5]
    output_root = project_root / "output"

    if args.target:
        targets = [Path(args.target)]
    else:
        targets = sorted([d for d in output_root.iterdir() if d.is_dir()])

    moved_count = 0
    skipped_count = 0
    report_lines = []

    for target_dir in targets:
        # 搜索该目录及直接子目录中的 _summary.json
        summary_path = target_dir / "_summary.json"
        if not summary_path.exists():
            # 检查是否有子目录包含 _summary.json
            for sub in target_dir.iterdir():
                if sub.is_dir():
                    candidate = sub / "_summary.json"
                    if candidate.exists():
                        summary_path = candidate
                        target_dir = sub
                        break

        if not summary_path.exists():
            # 检查是否已经是新格式（有风格子目录）
            has_style_dirs = any(
                d.is_dir() and not d.name.startswith('_')
                and any(sd.is_dir() for sd in d.iterdir())
                for d in target_dir.iterdir()
            )
            if has_style_dirs:
                print(f"[跳过] {target_dir.name}: 已经是新格式（风格分类）")
                skipped_count += 1
                continue
            print(f"[跳过] {target_dir.name}: 未找到 _summary.json")
            skipped_count += 1
            continue

        with open(summary_path, 'r', encoding='utf-8') as f:
            summary = json.load(f)

        games = summary.get("games", {})
        if not games:
            print(f"[跳过] {target_dir.name}: _summary.json 中无游戏数据")
            skipped_count += 1
            continue

        print(f"\n{'[预览]' if args.dry_run else '[整理]'} {target_dir.name}")
        print(f"  发现 {len(games)} 个游戏")

        for key, game_data in games.items():
            # key 格式: "{style}/{gdir}", 如 "二次元/克瑞因的纷争"
            parts = key.split("/", 1)
            if len(parts) != 2:
                print(f"  [异常] 无法解析 key: {key}")
                continue

            style, gdir = parts[0], parts[1]
            old_path = target_dir / gdir

            if not old_path.exists() or not old_path.is_dir():
                print(f"  [不存在] {style}/{gdir} -> {old_path}")
                continue

            new_path = target_dir / style / gdir

            if args.dry_run:
                print(f"  [预览] {gdir} -> {style}/{gdir}")
                continue

            # 移动
            new_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                shutil.move(str(old_path), str(new_path))
                print(f"  [移动] {gdir} -> {style}/{gdir}")
                report_lines.append(f"  {target_dir.name}/{gdir} -> {style}/{gdir}")
                moved_count += 1
            except Exception as e:
                print(f"  [错误] {gdir}: {e}")

    print(f"\n{'='*60}")
    if args.dry_run:
        print(f"预览完成: 待移动 {moved_count} 个游戏, 跳过 {skipped_count} 个目录")
    else:
        print(f"整理完成: 移动 {moved_count} 个游戏, 跳过 {skipped_count} 个目录")

    # Save report
    if not args.dry_run and report_lines:
        report_path = output_root / f"_reorganize_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write(f"重组织报告 - {datetime.now().isoformat()}\n\n")
            for line in report_lines:
                f.write(line + "\n")
        print(f"报告已保存: {report_path}")


if __name__ == "__main__":
    main()
