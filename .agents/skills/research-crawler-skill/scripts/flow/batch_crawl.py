"""
批量爬取多个游戏的评论数据。

将 46 个治愈向游戏逐个调用 ``bridge.py`` 的完整流程进行采集。
支持 ``--resume`` 跳过已完成项目，``--start`` 从指定偏移开始。
输出总日志到 ``reports/program_{时间戳}/batch_output.log``。

用法:
    python research-crawler-skill/scripts/batch_crawl.py
    python research-crawler-skill/scripts/batch_crawl.py --resume
    python research-crawler-skill/scripts/batch_crawl.py --start 10
    python research-crawler-skill/scripts/batch_crawl.py --video-count 10 --comment-count 200
"""
import argparse
import io
import os
import subprocess
import sys
import time
from datetime import datetime

# 强制 stdout/stderr 为 UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)
REPORTS_DIR = os.path.join(PROJECT_ROOT, 'reports', 'bilibili', 'program')
BATCH_LOG = ''  # 在 main() 中设为 batch_dir/batch_output.log
OUTPUT_ROOT = os.path.join(PROJECT_ROOT, 'output')

GAMES = [
    "Palia", "Paralives", "Sky: Children of the Light", "gogh: Focus with Your Avatar",
    "WEBFISHING", "Luma Island", "Solarpunk", "Leaf it Alone", "A Little to the Left",
    "STORY OF SEASONS: Grand Bazaar", "Tiny Glade", "Outbound", "Dwarf Eats Mountain",
    "Town to City", "Gris", "The Artisan of Glimmith", "Hozy", "Whisper of the House",
    "Roots of Pacha", "Little Kitty, Big City", "Strange Horticulture", "Lost and Found Co.",
    "Fae Farm", "Bookshop Simulator", "Doloc Town", "Cozy Grove", "Good Pizza, Great Pizza",
    "KuloNiku: Bowl Up!", "Sticky Business", "Toem", "Farm to Table", "HER TREES : PUZZLE DREAM",
    "A Short Hike", "Cozy Cleaner", "Wanderstop", "Arctico", "Melatonin", "Garden Galaxy",
    "Phonopolis", "Ooblets", "Jusant", "Gourdlets", "Station to Station", "凉茶王",
    "Season: A letter to the future", "Naiad"
]


def is_game_finished(game: str) -> bool:
    """检查某游戏是否已有产出目录（存在 ``output/output.csv``）。

    Args:
        game: 游戏名称。

    Returns:
        如果存在 ``output/{game}/{game}_*/output/output.csv`` 返回 ``True``。
    """
    game_dir = os.path.join(OUTPUT_ROOT, game)
    if not os.path.isdir(game_dir):
        return False
    for sub in os.listdir(game_dir):
        out_csv = os.path.join(game_dir, sub, 'output', 'output.csv')
        if os.path.exists(out_csv):
            return True
    return False


def run_game(game: str, log_file, batch_dir: str, video_count: int = 5, comment_count: int = 100):
    """调用 ``bridge.py`` 完整流程采集一个游戏的评论。

    使用 ``subprocess`` 执行 ``bridge.py --keyword <game>``，
    捕获 stdout/stderr 写入日志文件，返回执行结果。

    Args:
        game: 游戏名称。
        log_file: 已打开的日志文件对象（UTF-8 写入模式）。
        batch_dir: 批次目录路径（传给 bridge.py 的 ``--batch-dir``）。
        video_count: 每游戏视频数。
        comment_count: 每视频评论数。

    Returns:
        采集成功返回 ``True``，失败返回 ``False``。
    """
    def log(msg):
        line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
        print(line)
        log_file.write(line + '\n')
        log_file.flush()

    log("=" * 60)
    log(f"开始爬取游戏: {game}")
    log("=" * 60)

    python = sys.executable
    bridge = os.path.join(SCRIPTS_DIR, 'bilibili', 'bridge.py')
    cmd = [python, bridge, "--keyword", game, "--video-count", str(video_count),
           "--comment-count", str(comment_count), "--no-report-md"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              encoding='utf-8', errors='replace', cwd=PROJECT_ROOT)
        if proc.stdout:
            log_file.write(proc.stdout)
            log_file.flush()
        if proc.returncode == 0:
            log(f"游戏 {game} 爬取完成")
            return True
        else:
            log(f"游戏 {game} 失败 (exit={proc.returncode})")
            if proc.stderr:
                log_file.write(proc.stderr[-500:])
                log_file.flush()
            return False
    except Exception as e:
        log(f"游戏 {game} 异常: {e}")
        return False


def main():
    """CLI 入口：解析参数并逐个串行执行游戏采集。

    支持参数：
    - ``--resume``: 跳过已有 output/output.csv 的已完成游戏。
    - ``--start N``: 从第 N 个游戏开始（0-based）。
    - ``--video-count N``: 每游戏爬取视频数（默认 5）。
    - ``--comment-count N``: 每视频爬取评论数（默认 100）。
    采集完成后自动调用 ``generate_report.py`` 生成项目总报告。
    """
    parser = argparse.ArgumentParser(description='批量爬取多游戏评论')
    parser.add_argument('--resume', action='store_true', help='跳过已完成的')
    parser.add_argument('--start', type=int, default=0, help='从第 N 个游戏开始（0-based）')
    parser.add_argument('--video-count', type=int, default=5, help='每游戏爬取视频数（默认 5）')
    parser.add_argument('--comment-count', type=int, default=100, help='每视频爬取评论数（默认 100）')
    args = parser.parse_args()

    os.makedirs(REPORTS_DIR, exist_ok=True)
    batch_ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    batch_dir = os.path.join(REPORTS_DIR, f'batch_{batch_ts}')
    os.makedirs(batch_dir, exist_ok=True)
    batch_log_path = os.path.join(batch_dir, 'batch_output.log')

    games = GAMES[args.start:]
    log_count = 0
    ok_count = 0
    fail_count = 0
    start_time = datetime.now()

    # 用 UTF-8 写总日志到批次目录
    with open(batch_log_path, 'w', encoding='utf-8') as log_file:
        header = f"批量爬取开始: {start_time.strftime('%Y-%m-%d %H:%M:%S')} | 游戏: {len(games)}\n"
        log_file.write(header)
        print(header, end='')

        for i, game in enumerate(games, 1):
            if args.resume and is_game_finished(game):
                print(f"[{i}/{len(games)}] 跳过已完成: {game}")
                log_file.write(f"[{i}/{len(games)}] 跳过已完成: {game}\n")
                log_file.flush()
                continue

            print(f"\n[{i}/{len(games)}] 处理: {game}")
            log_file.write(f"\n[{i}/{len(games)}] 处理: {game}\n")
            log_file.flush()

            success = run_game(game, log_file, batch_dir, args.video_count, args.comment_count)
            log_count += 1
            if success:
                ok_count += 1
            else:
                fail_count += 1

            if i < len(games):
                time.sleep(5)

        end_time = datetime.now()
        summary = (f"\n{'=' * 60}\n"
                   f"批量爬取完成: {end_time.strftime('%Y-%m-%d %H:%M:%S')}\n"
                   f"耗时: {end_time - start_time}\n"
                   f"总游戏: {len(games)} | 成功: {ok_count} | 失败: {fail_count}\n"
                   f"总日志: {batch_log_path}\n")
        log_file.write(summary)
        print(summary)

    # 生成项目总报告到批次目录
    print("\n生成项目总报告...")
    gen_report = os.path.join(SCRIPT_DIR, 'generate_report.py')
    subprocess.run([sys.executable, gen_report, '--batch-dir', batch_dir],
                   cwd=PROJECT_ROOT, encoding='utf-8', errors='replace')


if __name__ == '__main__':
    main()
