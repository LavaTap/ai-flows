import os
import sys
import argparse
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)


def collect_log_files(root, error_dir):
    """递归收集所有 ``.log`` 文件路径，排除指定的错误目录。

    Args:
        root: 搜索根目录。
        error_dir: 错误日志输出目录，将被排除。

    Returns:
        排序后的日志文件绝对路径列表。
    """
    result = []
    for dirpath, dirnames, filenames in os.walk(root):
        # 跳过 error 输出目录
        if dirpath == error_dir:
            dirnames[:] = []  # Don't recurse into this directory
            continue
        for fname in filenames:
            if fname.endswith('.log'):
                result.append(os.path.join(dirpath, fname))
    return sorted(result)


def extract_errors(log_path):
    """从指定日志文件中提取所有含 ``[ERROR]`` 的行。

    Args:
        log_path: 日志文件路径。

    Returns:
        错误行字符串列表。
    """
    errors = []
    try:
        with open(log_path, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                if ' ERROR ' in line or '--- Logging error ---' in line:
                    errors.append(line.rstrip('\n'))
    except Exception as e:
        print(f"读取失败 {log_path}: {e}")
    return errors


def main():
    """CLI 入口：扫描日志 → 提取 ERROR 行 → 按文件分类输出。

    输出文件：
    - ``reports/error/{来源路径}_errors.log``：每文件错误行。
    - ``reports/error/_summary.log``：提取汇总统计。
    """
    parser = argparse.ArgumentParser(description='提取日志中所有 ERROR 行到指定平台下的 reports/program/error/ 文件夹。')
    parser.add_argument('--platform', '-p', required=True, help='指定平台 (e.g., bilibili, steam)')
    args = parser.parse_args()

    REPORTS_DIR = os.path.join(PROJECT_ROOT, 'reports', args.platform, 'program')
    ERROR_DIR = os.path.join(REPORTS_DIR, 'error')

    if not os.path.isdir(REPORTS_DIR):
        print(f"reports 目录不存在: {REPORTS_DIR}")
        return

    os.makedirs(ERROR_DIR, exist_ok=True)
    log_files = collect_log_files(REPORTS_DIR, ERROR_DIR)

    if not log_files:
        print("未找到日志文件")
        return

    total_errors = 0
    files_with_errors = 0
    summary_lines = [f"错误提取报告 — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"]
    summary_lines.append(f"扫描日志文件: {len(log_files)} 个\n")
    summary_lines.append("=" * 60 + "\n")

    for log_path in log_files:
        rel = os.path.relpath(log_path, REPORTS_DIR)
        # 输出文件名：把路径分隔符替换为下划线
        safe_name = rel.replace(os.sep, '_').replace('.log', '_errors.log')
        out_path = os.path.join(ERROR_DIR, safe_name)

        errors = extract_errors(log_path)
        if not errors:
            continue

        files_with_errors += 1
        total_errors += len(errors)

        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(f"# 来源: {rel}\n")
            f.write(f"# 错误数: {len(errors)}\n")
            f.write("=" * 60 + "\n")
            for e in errors:
                f.write(e + "\n")

        summary_lines.append(f"{rel}: {len(errors)} 条错误 -> error/{safe_name}\n")
        print(f"[{len(errors):4d}] {rel}")

    summary_lines.append("=" * 60 + "\n")
    summary_lines.append(f"总计: {total_errors} 条错误, 来自 {files_with_errors} 个文件\n")

    summary_path = os.path.join(ERROR_DIR, '_summary.log')
    with open(summary_path, 'w', encoding='utf-8') as f:
        f.writelines(summary_lines)

    print(f"\n总计: {total_errors} 条错误, 来自 {files_with_errors}/{len(log_files)} 个文件")
    print(f"输出目录: {ERROR_DIR}")


if __name__ == '__main__':
    main()
