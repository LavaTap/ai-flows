import os
import shutil
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


def find_failed_sessions(output_root):
    """扫描 ``output/`` 目录，查找缺少 ``output/output.csv`` 的失败会话。

    与 ``check_output_errors.py`` 的 `find_failed_sessions` 逻辑相同，
    但只收集删除所需的最小信息（game、session、path、game_path）。

    Args:
        output_root: 根输出目录。

    Returns:
        失败会话字典列表，每项包含 ``game``、``session``、``path``、``game_path``。
    """
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
            failed.append({
                'game': game_name, 'session': session_name,
                'path': session_path, 'game_path': game_path,
            })
    return failed


def main():
    """CLI 入口：通过 ``--dry-run`` 判断模式，执行删除或预览。

    逻辑：
    1. 扫描失败会话。
    2. 逐项删除（或预览）会话目录。
    3. 清理删除后变空的游戏文件夹。
    4. 将操作报告写入 ``reports/error/delete_output.log``。
    """
    parser = argparse.ArgumentParser(description='删除 output/ 中缺少 output/output.csv 的失败项目。')
    parser.add_argument('--platform', '-p', required=True, help='指定平台 (e.g., bilibili, steam)')
    parser.add_argument('--dry-run', action='store_true', help='预览删除效果而不实际执行')
    args = parser.parse_args()

    OUTPUT_ROOT = os.path.join(PROJECT_ROOT, 'output', args.platform)
    REPORTS_DIR = os.path.join(PROJECT_ROOT, 'reports', args.platform)
    ERROR_DIR = os.path.join(REPORTS_DIR, 'error')
    dry = args.dry_run

    # ensure error directory exists
    os.makedirs(ERROR_DIR, exist_ok=True)

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    failed = find_failed_sessions(OUTPUT_ROOT)

    report_path = os.path.join(ERROR_DIR, 'delete_output.log')

    lines = []
    lines.append('=' * 70)
    lines.append(f'output 失败项目删除 — 执行时间: {now}')
    lines.append(f'模式: {"预览（不删除）" if dry else "删除"}')
    lines.append('=' * 70)
    lines.append('')

    if not failed:
        lines.append('没有需要删除的失败项目')
        lines.append('')
        lines.append('=' * 70)
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines) + '\n')
        print('\n'.join(lines))
        return

    lines.append(f'待删除项目: {len(failed)}')
    lines.append('')

    deleted_count = 0
    empty_games = set()

    for i, f in enumerate(failed, 1):
        if dry:
            lines.append(f'  [{i}] [DRY] 将删除: {f["game"]}/{f["session"]}')
            lines.append(f'        路径: {f["path"]}')
        else:
            shutil.rmtree(f['path'])
            lines.append(f'  [{i}] 已删除: {f["game"]}/{f["session"]}')
            deleted_count += 1
        empty_games.add(f['game_path'])

    lines.append('')

    # 清理空的游戏文件夹
    cleaned_games = 0
    for game_path in empty_games:
        if not os.path.isdir(game_path):
            continue
        if not os.listdir(game_path):
            game_name = os.path.basename(game_path)
            if dry:
                lines.append(f'  [DRY] 将删除空游戏文件夹: {game_name}/ ')
            else:
                os.rmdir(game_path)
                lines.append(f'  已删除空游戏文件夹: {game_name}/')
                cleaned_games += 1

    lines.append('')
    lines.append('=' * 70)
    lines.append(f'总计: {len(failed)} 个失败项目, 删除: {deleted_count}, 清理空游戏文件夹: {cleaned_games}')
    lines.append('=' * 70)

    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    print('\n'.join(lines))
    print(f'\n删除报告已保存: {report_path}')


if __name__ == '__main__':
    main()