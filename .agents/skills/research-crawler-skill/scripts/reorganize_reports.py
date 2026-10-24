"""
整理 ``reports/`` 目录结构：将多个 ``program_{ts}/`` 批次文件夹合并为一个。

当存在多个历史批次目录时，将所有文件移入最早时间戳的批次文件夹，
删除空的源目录。最终形成单一批次结构：

::

    reports/
    ├── program_{batch_ts}/
    │   ├── {ts1}.log
    │   ├── {ts1}_report.md
    │   └── ...
    ├── batch_output.log
    └── error/

支持 ``--dry-run`` 预览合并结果。

用法:
    python research-crawler-skill/scripts/reorganize_reports.py
    python research-crawler-skill/scripts/reorganize_reports.py --dry-run
"""
import argparse
import os
import re
import shutil
import sys
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(SCRIPT_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)
REPORTS_DIR = os.path.join(PROJECT_ROOT, 'reports', 'bilibili', 'program')

# 时间戳格式 YYYYMMDD_HHMMSS
TS_REGEX = r'\d{8}_\d{6}'
PROGRAM_PATTERN = re.compile(r'^program_(' + TS_REGEX + r')$')


def main():
    """CLI 入口：通过 ``--dry-run`` 判断模式，执行合并或预览。

    逻辑：
    1. 扫描 ``reports/`` 下所有 ``program_{ts}/`` 文件夹。
    2. 如果少于 2 个，跳过（无需合并）。
    3. 以最早时间戳为目标批次，移动文件并删除空源目录。
    4. 输出操作日志到控制台。
    """
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    dry = args.dry_run

    if not os.path.isdir(REPORTS_DIR):
        print(f"reports 目录不存在: {REPORTS_DIR}")
        return

    # 收集所有 program_{ts}/ 文件夹
    program_dirs = []
    for name in sorted(os.listdir(REPORTS_DIR)):
        path = os.path.join(REPORTS_DIR, name)
        if not os.path.isdir(path):
            continue
        m = PROGRAM_PATTERN.match(name)
        if m:
            program_dirs.append((name, m.group(1), path))

    if not program_dirs:
        print("未找到 program_{ts}/ 文件夹")
        return

    print(f"找到 {len(program_dirs)} 个 program_{{ts}}/ 文件夹")

    # 如果只有 1 个，无需合并
    if len(program_dirs) == 1:
        print("只有 1 个，无需合并")
        return

    # 创建合并批次文件夹（用最早的时间戳）
    # 时间戳为 YYYYMMDD_HHMMSS 格式，字典序与时间序一致，故 min() 即取最早
    batch_ts = min(ts for _, ts, _ in program_dirs)
    batch_name = f'program_{batch_ts}'
    batch_path = os.path.join(REPORTS_DIR, batch_name)
    if dry:
        print(f"[DRY] 合并到 {batch_name}/")
    else:
        os.makedirs(batch_path, exist_ok=True)

    moved = 0
    skipped = 0
    failed = []
    for prog_name, ts, prog_path in program_dirs:
        if prog_name == batch_name:
            continue  # 跳过目标文件夹自身
        try:
            entries = os.listdir(prog_path)
        except OSError as e:
            print(f"  读取失败 {prog_name}: {e}")
            failed.append(prog_name)
            continue
        for fname in entries:
            src = os.path.join(prog_path, fname)
            dst = os.path.join(batch_path, fname)
            if dry:
                print(f"  [DRY] {prog_name}/{fname} -> {batch_name}/{fname}")
                continue
            if os.path.exists(dst):
                skipped += 1
                continue
            try:
                # 使用 shutil.move 以兼容跨文件系统移动
                shutil.move(src, dst)
                moved += 1
            except OSError as e:
                print(f"  移动失败 {prog_name}/{fname}: {e}")
                failed.append(f"{prog_name}/{fname}")
        # 删除空文件夹（非空或删除失败时跳过，避免中断）
        if not dry and os.path.isdir(prog_path):
            try:
                os.rmdir(prog_path)
            except OSError as e:
                print(f"  目录未删除（可能非空）{prog_name}: {e}")

    action = "预览" if dry else "已完成"
    print(f"{action}: 合并 {moved} 个文件到 {batch_name}/")
    if not dry:
        if skipped:
            print(f"跳过（目标已存在）: {skipped} 个文件")
        if failed:
            print(f"失败: {len(failed)} 项 -> {', '.join(failed)}")


if __name__ == '__main__':
    main()
