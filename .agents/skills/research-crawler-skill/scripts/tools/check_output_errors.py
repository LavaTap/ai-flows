import json
import os
import re
import sys
from datetime import datetime
import argparse

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)

# 日志中判定为错误的行（大小写不敏感匹配 ERROR，或包含中文错误关键词）
ERROR_KEYWORDS = ['ERROR', '错误', '失败', '未能找到', '跳过']


def find_failed_sessions(output_root):
    """扫描 ``output/`` 目录，查找缺少 ``output/output.csv`` 的失败会话。

    遍历每个游戏 → 每个会话目录，检查是否存在 ``output/output.csv``。
    对失败的会话，收集搜索元数据状态、原始终端目录内容等信息。

    Args:
        output_root: 根输出目录。

    Returns:
        失败会话信息字典列表，每项包含 ``game``、``session``、``path``、
        ``has_search``、``has_raw``、``video_count``、``files``。
    """
    failed = []
    if not os.path.isdir(output_root):
        return failed
    for game_name in sorted(os.listdir(output_root)):
        game_path = os.path.join(output_root, game_name)
        if not os.path.isdir(game_path):
            continue
        for session_name in sorted(os.listdir(game_path)):
            session_path = os.path.join(game_path, session_name)
            if not os.path.isdir(session_path):
                continue
            output_csv = os.path.join(session_path, 'output', 'output.csv')
            if os.path.exists(output_csv):
                continue
            search_json = os.path.join(session_path, 'search_result.json')
            info = {
                'game': game_name, 'session': session_name, 'path': session_path,
                'has_search': os.path.exists(search_json),
                'has_raw': os.path.isdir(os.path.join(session_path, 'raw')),
                'video_count': 0, 'files': [],
            }
            if info['has_search']:
                try:
                    with open(search_json, 'r', encoding='utf-8') as f:
                        meta = json.load(f)
                        info['video_count'] = len(meta.get('videos', []))
                except Exception:
                    pass
            for item in sorted(os.listdir(session_path)):
                item_path = os.path.join(session_path, item)
                if os.path.isdir(item_path):
                    sub_count = len(os.listdir(item_path)) if os.path.isdir(item_path) else 0
                    info['files'].append(f'{item}/ ({sub_count} items)')
                else:
                    size = os.path.getsize(item_path)
                    info['files'].append(f'{item} ({size:,} bytes)')
            failed.append(info)
    return failed


def find_log_errors(program_dir, output_root):
    """扫描 ``reports/{platform}/program/`` 下的日志文件，查找包含错误的记录。

    检测那些在日志中记录了 ERROR/错误/失败，但可能没有对应 output 产出的采集失败。
    这类失败不会在 ``output/`` 中留下目录，仅有日志痕迹。

    Args:
        program_dir: ``reports/{platform}/program`` 目录路径。
        output_root: ``output/{platform}`` 目录路径，用于交叉验证是否有产出。

    Returns:
        日志错误字典列表，每项包含 ``session``、``game``、``log_dir``、
        ``log_files``、``error_lines``、``has_output``。
    """
    errors = []
    if not os.path.isdir(program_dir):
        return errors

    for session_name in sorted(os.listdir(program_dir)):
        session_log_dir = os.path.join(program_dir, session_name)
        if not os.path.isdir(session_log_dir):
            continue

        # 查找 .log 文件
        log_files = sorted(f for f in os.listdir(session_log_dir) if f.endswith('.log'))
        if not log_files:
            continue

        # 提取游戏名（去掉 _YYYYMMDD_HHMMSS 后缀）
        game_name = re.sub(r'_\d{8}_\d{6}$', '', session_name)

        # 读取所有 log 文件，收集错误行
        all_error_lines = []
        for log_file in log_files:
            log_path = os.path.join(session_log_dir, log_file)
            try:
                with open(log_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        line_stripped = line.strip()
                        if not line_stripped:
                            continue
                        upper = line_stripped.upper()
                        if any(kw.upper() in upper for kw in ERROR_KEYWORDS):
                            all_error_lines.append(line_stripped)
            except Exception:
                pass

        if not all_error_lines:
            continue

        # 检查是否有对应的 output 产出
        has_output = False
        game_output_dir = os.path.join(output_root, game_name)
        if os.path.isdir(game_output_dir):
            for sub in os.listdir(game_output_dir):
                if os.path.exists(os.path.join(game_output_dir, sub, 'output', 'output.csv')):
                    has_output = True
                    break

        errors.append({
            'session': session_name,
            'game': game_name,
            'log_dir': session_log_dir,
            'log_files': log_files,
            'error_lines': all_error_lines,
            'has_output': has_output,
        })

    return errors


def main():
    """CLI 入口：扫描 output 缺失项目 + 日志错误记录，写入检测报告。

    报告路径为 ``reports/{platform}/error/output_errors.log``，包含两类错误：
    1. output 缺失项目 — output/ 中有会话目录但缺少 output/output.csv
    2. 日志错误记录 — reports/program/ 日志中包含 ERROR 的采集失败（可能无 output 产出）
    """
    parser = argparse.ArgumentParser(description='扫描 output/ 缺失项目 + 日志错误记录。')
    parser.add_argument('--platform', '-p', required=True, help='指定平台 (e.g., bilibili, steam)')
    args = parser.parse_args()

    OUTPUT_ROOT = os.path.join(PROJECT_ROOT, 'output', args.platform)
    REPORTS_DIR = os.path.join(PROJECT_ROOT, 'reports', args.platform)
    PROGRAM_DIR = os.path.join(REPORTS_DIR, 'program')
    ERROR_DIR = os.path.join(REPORTS_DIR, 'error')

    # ensure error directory exists
    os.makedirs(ERROR_DIR, exist_ok=True)

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    failed_sessions = find_failed_sessions(OUTPUT_ROOT)
    log_errors = find_log_errors(PROGRAM_DIR, OUTPUT_ROOT)

    report_path = os.path.join(ERROR_DIR, 'output_errors.log')

    lines = []
    lines.append('=' * 70)
    lines.append(f'错误检测报告 — 生成时间: {now}')
    lines.append(f'平台: {args.platform}')
    lines.append('模式: 仅检测报告（不删除）')
    lines.append('=' * 70)
    lines.append('')

    total_errors = len(failed_sessions) + len(log_errors)

    # ---- 第一部分：output 缺失项目 ----
    lines.append('一、output 缺失项目检测')
    lines.append('-' * 70)
    if not failed_sessions:
        lines.append('  所有 output/ 项目均已完成（均有 output/output.csv）')
    else:
        lines.append(f'  失败项目总数: {len(failed_sessions)}')
        lines.append('  失败原因: 会话目录缺少 output/output.csv（仅完成搜索未完成采集）')
        for i, f in enumerate(failed_sessions, 1):
            lines.append('')
            lines.append(f'  [{i}] 游戏: {f["game"]} | 会话: {f["session"]}')
            lines.append(f'      路径: {f["path"]}')
            lines.append(f'      有搜索: {f["has_search"]} | 有raw: {f["has_raw"]} | 搜索视频数: {f["video_count"]}')
            lines.append(f'      目录内容:')
            for item in f['files']:
                lines.append(f'        {item}')
    lines.append('')

    # ---- 第二部分：日志错误记录 ----
    lines.append('二、日志错误记录检测')
    lines.append('-' * 70)
    if not log_errors:
        lines.append('  未在 reports/program/ 日志中发现错误记录')
    else:
        lines.append(f'  日志错误记录总数: {len(log_errors)}')
        for i, e in enumerate(log_errors, 1):
            status = '有产出（采集完成但有错误）' if e['has_output'] else '无产出（采集失败）'
            lines.append('')
            lines.append(f'  [{i}] 游戏: {e["game"]} | 会话: {e["session"]}')
            lines.append(f'      日志目录: {e["log_dir"]}')
            lines.append(f'      日志文件: {", ".join(e["log_files"])}')
            lines.append(f'      产出状态: {status}')
            lines.append(f'      错误明细:')
            for el in e['error_lines']:
                lines.append(f'        {el}')
    lines.append('')

    # ---- 汇总 ----
    lines.append('=' * 70)
    lines.append(f'总计: {total_errors} 个错误')
    lines.append(f'  output 缺失项目: {len(failed_sessions)}')
    lines.append(f'  日志错误记录: {len(log_errors)}')
    lines.append('=' * 70)

    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    print('\n'.join(lines))
    print(f'\n报告已保存: {report_path}')
    if log_errors:
        print('\n注意: 日志错误记录中的「无产出」项目仅有日志痕迹，无 output 目录可删除。')
        print('如需清理日志，可手动删除对应的 reports/program/{会话名}/ 目录。')


if __name__ == '__main__':
    main()
