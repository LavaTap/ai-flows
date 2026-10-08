# -*- coding: utf-8 -*-
"""
批量 Steam 评论爬取脚本。

功能：
  从 steam_appids.md 读取 46 个游戏的 AppID，跳过 output/steam/ 下已完成的，
  对剩余游戏逐个爬取 Steam 评论（每 100 条暂停 10 秒）。

用法：
    python research-crawler-skill/scripts/batch_steam_crawl.py
    python research-crawler-skill/scripts/batch_steam_crawl.py --count 500
    python research-crawler-skill/scripts/batch_steam_crawl.py --force   # 强制重爬所有
    python research-crawler-skill/scripts/batch_steam_crawl.py --resume  # 从失败处继续
"""
import argparse
import csv
import logging
import os
import sys
import time
from datetime import datetime

# 添加 skill 脚本目录到 path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPTS_DIR))
sys.path.insert(0, os.path.join(SCRIPTS_DIR, 'steam'))

# 导入 steam_crawler 中的爬取函数
from steam_crawler import crawl_steam_reviews, setup_logger

REPORTS_DIR = os.path.join(PROJECT_ROOT, 'reports', 'steam', 'program')
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output', 'steam')
DEFAULT_COUNT = 500

def parse_steam_appids_md(filepath):
    games = []
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        for line in lines:
            parts = line.strip().split('|')
            if len(parts) >= 5 and parts[1].strip().isdigit():
                game_name = parts[2].strip()
                appid = parts[3].strip()
                if appid and appid != '—':
                    games.append((game_name, appid))
    return games


def is_game_completed(game_name):
    safe_name = "".join(c for c in game_name if c.isalnum() or c in " _-")
    game_dir = os.path.join(OUTPUT_DIR, safe_name)
    if not os.path.isdir(game_dir):
        return False
    sessions = sorted([d for d in os.listdir(game_dir)
                       if os.path.isdir(os.path.join(game_dir, d))])
    if not sessions:
        return False
    latest = sessions[-1]
    out_csv = os.path.join(game_dir, latest, 'output', 'output.csv')
    if not os.path.exists(out_csv):
        return False
    with open(out_csv, 'r', encoding='utf-8-sig') as f:
        count = sum(1 for _ in csv.DictReader(f))
    return count >= 50


def main():
    parser = argparse.ArgumentParser(description='批量爬取 Steam 多游戏评论')
    parser.add_argument('--count', type=int, default=DEFAULT_COUNT,
                        help=f'每个游戏爬取评论数（默认 {DEFAULT_COUNT}）')
    parser.add_argument('--force', action='store_true',
                        help='强制重爬所有游戏（不跳过已完成）')
    parser.add_argument('--resume', action='store_true',
                        help='从上次中断处继续（跳过已完成）')
    parser.add_argument('--exclude-games', type=str, nargs='*', default=[],
                        help='要排除的游戏名称列表')
    args = parser.parse_args()

    STEAM_APPIDS_FILE = os.path.join(PROJECT_ROOT, 'output', 'steam_appids.md')
    ALL_GAMES = parse_steam_appids_md(STEAM_APPIDS_FILE)

    excluded_game_names = set(args.exclude_games)

    os.makedirs(REPORTS_DIR, exist_ok=True)
    batch_ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    batch_dir = os.path.join(REPORTS_DIR, f'batch_{batch_ts}')
    os.makedirs(batch_dir, exist_ok=True)

    # 确定要爬取的游戏
    to_crawl = []
    skipped = []
    for game_name, appid in ALL_GAMES:
        if game_name in excluded_game_names:
            skipped.append(game_name)
            continue
        if (not args.force) and is_game_completed(game_name):
            skipped.append(game_name)
            continue
        to_crawl.append((game_name, appid))

    print(f'[{batch_ts}] 总共 {len(ALL_GAMES)} 个游戏')
    print(f'  已排除 (用户指定): {len(excluded_game_names)} 个: {", ".join(list(excluded_game_names)[:5])}{"..." if len(excluded_game_names)>5 else ""}')
    print(f'  跳过（已爬取）: {len(skipped)} 个: {", ".join(skipped[:5])}{"..." if len(skipped)>5 else ""}')
    print(f'  待爬取: {len(to_crawl)} 个')
    print(f'  每游戏评论数: {args.count}')
    print(f'  每 100 条暂停 10 秒\n')

    if not to_crawl and not args.force:
        print('所有游戏已爬取完成，无需操作。')
        return

    results = []
    for i, (game_name, appid) in enumerate(to_crawl, 1):
        print(f'\n[{i}/{len(to_crawl)}] {"="*50}')
        print(f'开始爬取: {game_name} (AppID: {appid})')
        print(f'{"="*50}')

        ts = datetime.now().strftime('%Y%m%d_%H%M%S') # New timestamp for each game session
        safe_name = "".join(c for c in game_name if c.isalnum() or c in " _-")
        output_session_dir = os.path.join(OUTPUT_DIR, safe_name, f'{safe_name}_{ts}')
        session_name = f'{safe_name}_{ts}'
        log_session_dir = os.path.join(REPORTS_DIR, session_name)
        
        setup_logger(log_session_dir, ts)
        logging.info(f'====== 开始处理游戏: {game_name} ======')
        logging.info(f'找到游戏 {game_name} 的 AppID: {appid}')

        try:
            crawl_steam_reviews(game_name, appid, args.count, output_session_dir)
            results.append((game_name, '成功'))
            logging.info(f'====== 游戏处理结束: {game_name} ======')
        except Exception as e:
            logging.error(f'爬取 {game_name} 失败: {e}')
            results.append((game_name, f'失败: {e}'))

        # 游戏之间的等待间隔
        if i < len(to_crawl):
            wait = 5
            print(f'等待 {wait} 秒后开始下一个游戏...')
            time.sleep(wait)

    # 输出结果摘要
    print(f'\n\n{"="*60}')
    print(f'批量爬取完成! 时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'{"="*60}')
    success = sum(1 for r in results if r[1] == '成功')
    failed = [r for r in results if r[1] != '成功']
    print(f'成功: {success}, 失败: {len(failed)}')
    if failed:
        print(f'失败游戏:')
        for name, reason in failed:
            print(f'  - {name}: {reason}')


if __name__ == '__main__':
    main()
