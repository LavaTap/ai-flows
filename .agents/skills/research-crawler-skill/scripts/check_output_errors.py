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
SKILL_DIR = os.path.dirname(SCRIPT_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)

# platform 参数仅允许安全字符，防止路径穿越
PLATFORM_RE = re.compile(r'^[A-Za-z0-9_-]+$')


def find_failed_sessions(output_root):
    """扫描 ``output/`` 目录，查找缺少 ``output/output.csv`` 的失败会话。

    遍历每个游戏 → 每个会话目录，检查是否存在 ``output/output.csv``。
    对失败的会话，收集搜索元数据状态、原始终端目录内容等信息。

    Args:
        output_root: 根输出目录。

    Returns:
        失败会话信息字典列表，每项包含 ``game``、``session``、``path``、
        ``has_search``、``has_raw``、``video_count``、``search_error``、``files``。
    """
    if not os.path.isdir(output_root):
        print(f"输出目录不存在: {output_root}")
        return []

    failed = []
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
                'video_count': 0, 'search_error': None, 'files': [],
            }
            if info['has_search']:
                try:
                    with open(search_json, 'r', encoding='utf-8') as f:
                        meta = json.load(f)
                        info['video_count'] = len(meta.get('videos', []))
                except Exception as e:
                    # 记录解析失败，报告中区分「确实无视频」与「元数据解析失败」
                    info['search_error'] = str(e)
            try:
                items = sorted(os.listdir(session_path))
            except OSError as e:
                info['files'].append(f'<目录读取失败: {e}>')
                items = []
            for item in items:
                item_path = os.path.join(session_path, item)
                if os.path.isdir(item_path):
                    try:
                        sub_count = len(os.listdir(item_path))
                    except OSError:
                        sub_count = 0
                    info['files'].append(f'{item}/ ({sub_count} items)')
                else:
                    try:
                        size = os.path.getsize(item_path)
                    except OSError:
                        size = 0
                    info['files'].append(f'{item} ({size:,} bytes)')
            failed.append(info)
    return failed


def main():
    """CLI 入口：扫描失败项目并写入检测报告。

    报告路径为 ``reports/error/output_errors.log``，包含失败项目详细信息。
    若所有项目均已完成，则报告注明"无错误"。
    """
    parser = argparse.ArgumentParser(description='扫描 output/ 找出缺少 output/output.csv 的失败项目。')
    parser.add_argument('--platform', '-p', required=True, help='指定平台 (e.g., bilibili, steam)')
    args = parser.parse_args()

    if not PLATFORM_RE.match(args.platform):
        print(f"错误: 非法的平台名称 {args.platform!r}，仅允许字母、数字、下划线和连字符")
        return

    output_root = os.path.join(PROJECT_ROOT, 'output', args.platform)
    reports_dir = os.path.join(PROJECT_ROOT, 'reports', args.platform, 'program')
    error_dir = os.path.join(reports_dir, 'error')

    # ensure error directory exists
    os.makedirs(error_dir, exist_ok=True)

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    failed = find_failed_sessions(output_root)

    report_path = os.path.join(error_dir, 'output_errors.log')

    lines = []
    lines.append('=' * 70)
    lines.append(f'output 错误项目检测报告 — 生成时间: {now}')
    lines.append('模式: 仅检测报告（不删除）')
    lines.append('=' * 70)
    lines.append('')

    if not failed:
        lines.append('所有 output/ 项目均已完成（均有 output/output.csv）')
        lines.append('')
        lines.append('=' * 70)
    else:
        lines.append(f'失败项目总数: {len(failed)}')
        lines.append('失败原因: 会话目录缺少 output/output.csv（仅完成搜索未完成采集）')
        lines.append('')

        for i, f in enumerate(failed, 1):
            lines.append('-' * 70)
            lines.append(f'[{i}] 游戏: {f["game"]} | 会话: {f["session"]}')
            lines.append(f'    路径: {f["path"]}')
            lines.append(f'    有搜索: {f["has_search"]} | 有raw: {f["has_raw"]} | 搜索视频数: {f["video_count"]}')
            if f.get('search_error'):
                lines.append(f'    元数据解析失败: {f["search_error"]}')
            lines.append(f'    目录内容:')
            for item in f['files']:
                lines.append(f'      {item}')
            lines.append('')

        lines.append('=' * 70)
        lines.append(f'总计: {len(failed)} 个失败项目')
        lines.append('=' * 70)

    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    print('\n'.join(lines))
    print(f'\n报告已保存: {report_path}')
    if failed:
        print('\n请将报告发送给用户确认，用户选择删除请运行 delete_output_errors.py')


if __name__ == '__main__':
    main()