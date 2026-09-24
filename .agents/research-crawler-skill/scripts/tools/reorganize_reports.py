"""
整理 ``reports/`` 目录结构：将旧的 ``program_{ts}/`` 批次文件夹合并为一个。

新版日志按会话命名（{keyword}_{ts}），不再需要合并。
此脚本仅用于合并历史遗留的 ``program_{ts}/`` 批次文件夹。

当存在多个旧批次目录时，将所有文件移入最早时间戳的批次文件夹，
删除空的源目录。已知子文件夹（ai/、error/、limit/、batch_*）会被跳过。

用法:
    python research-crawler-skill/scripts/reorganize_reports.py
    python research-crawler-skill/scripts/reorganize_reports.py --dry-run
"""
import argparse
import os
import re
import sys
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)
REPORTS_DIR = os.path.join(PROJECT_ROOT, 'reports', 'bilibili', 'program')

# 旧命名模式: program_{ts}
PROGRAM_PATTERN = re.compile(r'^program_(\d{8}_\d{6})$')
# 需要跳过的已知子文件夹
SKIP_FOLDERS = {'ai', 'error', 'limit'}


def main():
    """CLI 入口：通过 ``--dry-run`` 判断模式，执行合并或预览。

    逻辑：
    1. 扫描 ``reports/`` 下所有 ``program_{ts}/`` 文件夹（跳过 ai/ error/ limit/ batch_*）。
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

    # 收集所有 program_{ts}/ 文件夹（排除 ai/ error/ limit/ batch_*）
    program_dirs = []
    for name in sorted(os.listdir(REPORTS_DIR)):
        path = os.path.join(REPORTS_DIR, name)
        if not os.path.isdir(path):
            continue
        # 跳过已知子文件夹
        if name in SKIP_FOLDERS:
            continue
        # 跳过 batch_* 文件夹（新命名）
        if name.startswith('batch_'):
            continue
        m = PROGRAM_PATTERN.match(name)
        if m:
            program_dirs.append((name, m.group(1), path))

    if not program_dirs:
        print("未找到需要合并的 program_{ts}/ 文件夹")
        return

    print(f"找到 {len(program_dirs)} 个 program_{{ts}}/ 文件夹")

    # 如果只有 1 个，无需合并
    if len(program_dirs) == 1:
        print("只有 1 个，无需合并")
        return

    # 创建合并批次文件夹（用最早的时间戳）
    batch_ts = min(ts for _, ts, _ in program_dirs)
    batch_name = f'program_{batch_ts}'
    batch_path = os.path.join(REPORTS_DIR, batch_name)
    if dry:
        print(f"[DRY] 合并到 {batch_name}/")
    else:
        os.makedirs(batch_path, exist_ok=True)

    moved = 0
    for prog_name, ts, prog_path in program_dirs:
        if prog_name == batch_name:
            continue  # 跳过目标文件夹自身
        for fname in os.listdir(prog_path):
            src = os.path.join(prog_path, fname)
            dst = os.path.join(batch_path, fname)
            if dry:
                print(f"  [DRY] {prog_name}/{fname} -> {batch_name}/{fname}")
            else:
                if os.path.exists(dst):
                    continue
                os.rename(src, dst)
                moved += 1
        # 删除空文件夹
        if not dry and os.path.isdir(prog_path) and not os.listdir(prog_path):
            os.rmdir(prog_path)

    action = "预览" if dry else "已完成"
    print(f"{action}: 合并 {moved} 个文件到 {batch_name}/")


if __name__ == '__main__':
    main()
