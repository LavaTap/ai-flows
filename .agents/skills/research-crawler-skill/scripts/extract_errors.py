import os
import re
import sys
import argparse
from datetime import datetime

# 目录结构假设：本脚本位于 research-crawler-skill/scripts/ 下，
# 上溯三级得到项目根目录（scripts -> research-crawler-skill -> 项目根）
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(SCRIPT_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)

# platform 参数仅允许安全字符，防止路径穿越
PLATFORM_RE = re.compile(r'^[A-Za-z0-9_-]+$')

# 错误行匹配规则：兼容 [ERROR] 标记、裸 ERROR 单词以及 logging 错误块
ERROR_LINE_RE = re.compile(r'\[ERROR\]|\bERROR\b|--- Logging error ---')


def collect_log_files(root, error_dir):
    """递归收集所有 ``.log`` 文件路径，排除指定的错误目录。

    Args:
        root: 搜索根目录。
        error_dir: 错误日志输出目录，将被排除。

    Returns:
        排序后的日志文件绝对路径列表。
    """
    result = []
    norm_error_dir = os.path.realpath(error_dir)
    for dirpath, dirnames, filenames in os.walk(root):
        # 跳过 error 输出目录（用 realpath 规范化后比较，避免符号链接/尾部分隔符差异）
        if os.path.realpath(dirpath) == norm_error_dir:
            dirnames[:] = []  # Don't recurse into this directory
            continue
        for fname in filenames:
            if fname.endswith('.log'):
                result.append(os.path.join(dirpath, fname))
    return sorted(result)


def extract_errors(log_path):
    """从指定日志文件中提取所有错误行（``[ERROR]`` / 裸 ``ERROR`` / logging 错误块）。

    Args:
        log_path: 日志文件路径。

    Returns:
        ``(errors, ok)`` 元组：错误行字符串列表，以及读取是否成功。
        读取失败时返回 ``([], False)``，调用方可据此区分「无错误」与「读取失败」。
    """
    errors = []
    try:
        with open(log_path, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                if ERROR_LINE_RE.search(line):
                    errors.append(line.rstrip('\n'))
    except Exception as e:
        print(f"读取失败 {log_path}: {e}")
        return errors, False
    return errors, True


def main():
    """CLI 入口：扫描日志 → 提取 ERROR 行 → 按文件分类输出。

    输出文件：
    - ``reports/error/{来源路径}_errors.log``：每文件错误行。
    - ``reports/error/_summary.log``：提取汇总统计。
    """
    parser = argparse.ArgumentParser(description='提取日志中所有 ERROR 行到指定平台下的 reports/program/error/ 文件夹。')
    parser.add_argument('--platform', '-p', required=True, help='指定平台 (e.g., bilibili, steam)')
    args = parser.parse_args()

    if not PLATFORM_RE.match(args.platform):
        print(f"错误: 非法的平台名称 {args.platform!r}，仅允许字母、数字、下划线和连字符")
        return

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
    failed_reads = []
    failed_writes = []
    summary_lines = [f"错误提取报告 — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"]
    summary_lines.append(f"扫描日志文件: {len(log_files)} 个\n")
    summary_lines.append("=" * 60 + "\n")

    for log_path in log_files:
        rel = os.path.relpath(log_path, REPORTS_DIR)
        # 输出文件名：仅替换结尾的 .log 扩展名，再把路径分隔符替换为下划线
        base = rel[:-4] if rel.endswith('.log') else rel
        safe_name = base.replace(os.sep, '_') + '_errors.log'
        out_path = os.path.join(ERROR_DIR, safe_name)

        errors, ok = extract_errors(log_path)
        if not ok:
            failed_reads.append(rel)
            continue
        if not errors:
            continue

        try:
            with open(out_path, 'w', encoding='utf-8') as f:
                f.write(f"# 来源: {rel}\n")
                f.write(f"# 错误数: {len(errors)}\n")
                f.write("=" * 60 + "\n")
                for e in errors:
                    f.write(e + "\n")
        except OSError as e:
            print(f"写入失败 {out_path}: {e}")
            failed_writes.append(rel)
            continue

        files_with_errors += 1
        total_errors += len(errors)

        summary_lines.append(f"{rel}: {len(errors)} 条错误 -> error/{safe_name}\n")
        print(f"[{len(errors):4d}] {rel}")

    summary_lines.append("=" * 60 + "\n")
    summary_lines.append(f"总计: {total_errors} 条错误, 来自 {files_with_errors} 个文件\n")
    if failed_reads:
        summary_lines.append(f"读取失败: {len(failed_reads)} 个文件: {', '.join(failed_reads)}\n")
    if failed_writes:
        summary_lines.append(f"写入失败: {len(failed_writes)} 个文件: {', '.join(failed_writes)}\n")

    summary_path = os.path.join(ERROR_DIR, '_summary.log')
    with open(summary_path, 'w', encoding='utf-8') as f:
        f.writelines(summary_lines)

    print(f"\n总计: {total_errors} 条错误, 来自 {files_with_errors}/{len(log_files)} 个文件")
    if failed_reads:
        print(f"读取失败: {len(failed_reads)} 个文件")
    if failed_writes:
        print(f"写入失败: {len(failed_writes)} 个文件")
    print(f"输出目录: {ERROR_DIR}")


if __name__ == '__main__':
    main()