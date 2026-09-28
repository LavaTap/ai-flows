"""
扫描 ``output/`` 生成项目总报告（``report.log``），写入指定批次目录。

报告包含：游戏统计（总数/已完成/失败/完成率）、评论统计（原始/清洗/丢弃）、
错误分类统计（412 风控/JSON 解析失败/Cookie 失效/其他）以及逐游戏明细。

用法:
    python research-crawler-skill/scripts/generate_report.py --batch-dir reports/program_20260723_101557
    python research-crawler-skill/scripts/generate_report.py
"""
import argparse
import csv
import os
import sys
from datetime import datetime

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)
OUTPUT_ROOT = os.path.join(PROJECT_ROOT, 'output')
REPORTS_DIR = os.path.join(PROJECT_ROOT, 'reports', 'bilibili', 'program')
ERROR_DIR = os.path.join(REPORTS_DIR, 'error')


def scan_games():
    """扫描 ``output/`` 目录，按游戏归类所有会话及其状态。

    状态判定：
    - ``completed``：存在 ``output/output.csv``。
    - ``failed``：仅有 ``search_result.json`` 无 output.csv。
    - ``unknown``：无搜索元数据也无 output.csv。

    Returns:
        游戏字典列表，每项包含 ``name`` 和 ``sessions``（会话列表）。
    """
    for game_name in sorted(os.listdir(OUTPUT_ROOT)):
        game_path = os.path.join(OUTPUT_ROOT, game_name)
        if not os.path.isdir(game_path):
            continue
        sessions = []
        for session_name in os.listdir(game_path):
            session_path = os.path.join(game_path, session_name)
            if not os.path.isdir(session_path):
                continue
            has_output_csv = os.path.exists(os.path.join(session_path, 'output', 'output.csv'))
            has_search = os.path.exists(os.path.join(session_path, 'search_result.json'))
            sessions.append({
                'name': session_name, 'path': session_path,
                'status': 'completed' if has_output_csv else ('failed' if has_search else 'unknown'),
            })
        games.append({'name': game_name, 'sessions': sessions})
    return games


def count_comments(session_path):
    """统计指定会话目录中的原始评论数和清洗后评论数。

    分别统计 ``raw/`` 和 ``raw/clean/`` 下的 CSV 文件行数（减表头）。

    Args:
        session_path: 会话目录路径。

    Returns:
        (total_raw, total_clean) 二元组。
    """
    total_raw = 0
    total_clean = 0
    if os.path.isdir(raw_dir):
        for fname in os.listdir(raw_dir):
            if fname.endswith('.csv') and '_clean' not in fname:
                try:
                    with open(os.path.join(raw_dir, fname), 'r', encoding='utf-8-sig') as f:
                        total_raw += sum(1 for _ in csv.reader(f)) - 1
                except Exception:
                    pass
    if os.path.isdir(clean_dir):
        for fname in os.listdir(clean_dir):
            if fname.endswith('.csv'):
                try:
                    with open(os.path.join(clean_dir, fname), 'r', encoding='utf-8-sig') as f:
                        total_clean += sum(1 for _ in csv.reader(f)) - 1
                except Exception:
                    pass
    return total_raw, total_clean


def classify_errors(batch_dir):
    """从批次日志中分类统计错误类型。

    错误类别：
    - ``412风控``：包含 412 状态码。
    - ``JSON解析失败``：包含 JSON/Expecting value 关键词。
    - ``Cookie失效``：包含 Cookie/cookie 关键词。
    - ``其他``：不属于以上类别的 ERROR 行。

    Args:
        batch_dir: 批次目录路径（包含日志文件）。

    Returns:
        (categories, error_files) 二元组：
        - categories: 各类别错误计数 dict。
        - error_files: 包含错误的日志文件数。
    """
    error_files = 0
    if os.path.isdir(batch_dir):
        for fname in os.listdir(batch_dir):
            if not fname.endswith('.log'):
                continue
            error_files += 1
            try:
                with open(os.path.join(batch_dir, fname), 'r', encoding='utf-8', errors='replace') as f:
                    for line in f:
                        if '[ERROR]' not in line and '--- Logging error' not in line:
                            continue
                        if '412' in line:
                            categories['412风控'] += 1
                        elif 'JSON' in line or 'json' in line.lower() or 'Expecting value' in line:
                            categories['JSON解析失败'] += 1
                        elif 'Cookie' in line or 'cookie' in line:
                            categories['Cookie失效'] += 1
                        else:
                            categories['其他'] += 1
            except Exception:
                pass
    return categories, error_files


def main():
    """CLI 入口：解析 ``--batch-dir`` 参数并生成项目总报告。

    报告写入 ``{batch_dir}/report.log``，包含游戏统计、评论统计、
    错误分类和逐游戏明细。
    """
    parser = argparse.ArgumentParser()
    parser.add_argument('--batch-dir', default='', help='批次目录路径（report.log 写入此处）')
    args = parser.parse_args()

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    if args.batch_dir:
        batch_dir = args.batch_dir
    else:
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        batch_dir = os.path.join(REPORTS_DIR, f'program_{ts}')
    os.makedirs(batch_dir, exist_ok=True)

    games = scan_games()
    total_games = len(games)
    completed = 0
    failed = 0
    total_raw_all = 0
    total_clean_all = 0
    failed_list = []

    for game in games:
        game_completed = False
        for session in game['sessions']:
            if session['status'] == 'completed':
                game_completed = True
                raw, clean = count_comments(session['path'])
                total_raw_all += raw
                total_clean_all += clean
            elif session['status'] == 'failed':
                failed_list.append(f"  {game['name']}/{session['name']}")
        if game_completed:
            completed += 1
        else:
            failed += 1

    error_cats, error_files = classify_errors(batch_dir)
    total_errors = sum(error_cats.values())

    lines = []
    lines.append('=' * 70)
    lines.append(f'项目总报告 — 生成时间: {now}')
    lines.append(f'批次目录: {batch_dir}')
    lines.append('=' * 70)
    lines.append('')
    lines.append('一、游戏统计')
    lines.append('-' * 40)
    lines.append(f'  游戏总数:      {total_games}')
    lines.append(f'  已完成:        {completed}')
    lines.append(f'  失败/未完成:   {failed}')
    lines.append(f'  完成率:        {completed/max(total_games,1)*100:.1f}%')
    lines.append('')
    lines.append('二、评论统计')
    lines.append('-' * 40)
    lines.append(f'  原始评论总数:  {total_raw_all}')
    lines.append(f'  清洗后总数:    {total_clean_all}')
    lines.append(f'  丢弃总数:      {total_raw_all - total_clean_all}')
    lines.append('')
    lines.append('三、错误分类统计')
    lines.append('-' * 40)
    lines.append(f'  错误日志文件:  {error_files}')
    lines.append(f'  错误总数:      {total_errors}')
    for cat, count in error_cats.items():
        lines.append(f'    {cat}: {count}')
    lines.append('')

    if failed_list:
        lines.append('四、失败项目列表')
        lines.append('-' * 40)
        for item in failed_list:
            lines.append(item)
        lines.append('')

    lines.append('五、逐游戏明细')
    lines.append('-' * 70)
    lines.append(f'{"游戏名":<30} {"状态":<10} {"原始":>8} {"清洗":>8}')
    for game in games:
        status = 'completed' if any(s['status'] == 'completed' for s in game['sessions']) else 'FAILED'
        raw_sum = 0
        clean_sum = 0
        for s in game['sessions']:
            if s['status'] == 'completed':
                r, c = count_comments(s['path'])
                raw_sum += r
                clean_sum += c
        name = game['name'][:28]
        lines.append(f'{name:<30} {status:<10} {raw_sum:>8} {clean_sum:>8}')
    lines.append('')
    lines.append('=' * 70)
    lines.append('报告结束')
    lines.append('=' * 70)

    report_path = os.path.join(batch_dir, 'report.log')
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print('\n'.join(lines))
    print(f'\n报告已保存: {report_path}')


if __name__ == '__main__':
    main()
