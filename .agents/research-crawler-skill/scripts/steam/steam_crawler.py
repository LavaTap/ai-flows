import argparse
import csv
import json
import logging
import os
import time
import urllib.parse
from datetime import datetime
import requests
import urllib3

urllib3.disable_warnings()

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPTS_DIR))
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output', 'steam')
REPORTS_DIR = os.path.join(PROJECT_ROOT, 'reports', 'steam', 'program')

PLATFORM = 'steam'
PLATFORM_LABEL = 'Steam'

FIELDNAMES_SKILL = [
    "序号", "平台", "游戏名称", "评论内容",
    "情绪倾向", "情绪关键词", "是否提及治愈", "治愈相关度",
    "治愈感受细分", "吸引游玩因素", "判断依据", "复核调整说明",
]
FIELDNAMES_RAW = ['编号', '昵称', '用户ID', '评论内容', '发布时间', '点赞数']

def setup_logger(log_dir: str, ts: str = ''):
    """配置日志：同时输出控制台 + {log_dir}/{ts}.log

    Args:
        log_dir: 日志目录路径（如 reports/steam/program/{session_name}）。
        ts: 时间戳，用于日志文件名。为空则用 crawl.log。
    """
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    logger.handlers = []

    formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')

    ch = logging.StreamHandler()
    ch.setFormatter(formatter)
    logger.addHandler(ch)

    os.makedirs(log_dir, exist_ok=True)
    log_filename = f'{ts}.log' if ts else 'crawl.log'
    fh = logging.FileHandler(os.path.join(log_dir, log_filename), encoding='utf-8')
    fh.setFormatter(formatter)
    logger.addHandler(fh)

def get_appid_by_name(game_name: str) -> str:
    """通过 Steam Store Search API 根据游戏名称查找 appid"""
    url = f"https://store.steampowered.com/api/storesearch/?term={urllib.parse.quote(game_name)}&l=english&cc=US"
    for attempt in range(3):
        try:
            proxies = {k: v for k, v in {
                'http': os.environ.get('HTTP_PROXY', ''),
                'https': os.environ.get('HTTPS_PROXY', '')
            }.items() if v}
            r = requests.get(url, timeout=(10, 30), proxies=proxies, verify=False)
            data = r.json()
            if data.get('total', 0) > 0:
                items = data.get('items', [])
                # 尝试精准匹配，或者直接取第一个
                for item in items:
                    if game_name.lower() in item.get('name', '').lower() or item.get('name', '').lower() in game_name.lower():
                        return str(item.get('id'))
                return str(items[0].get('id'))
            break
        except Exception as e:
            logging.error(f"查找 {game_name} 的 appid 失败 (尝试 {attempt+1}/3): {e}")
            time.sleep(5)
    return None

def crawl_steam_reviews(game_name: str, appid: str, max_reviews: int, session_dir: str):
    """爬取 Steam 评论并保存为标准格式"""
    raw_dir = os.path.join(session_dir, 'raw')
    clean_dir = os.path.join(raw_dir, 'clean')
    comments_dir = os.path.join(session_dir, 'comments')
    out_dir = os.path.join(session_dir, 'output')
    
    for d in [raw_dir, clean_dir, comments_dir, out_dir]:
        os.makedirs(d, exist_ok=True)

    raw_csv_path = os.path.join(raw_dir, f"{appid}.csv")
    clean_csv_path = os.path.join(clean_dir, f"{appid}_clean.csv")
    comments_csv_path = os.path.join(comments_dir, "comments.csv")
    output_csv_path = os.path.join(out_dir, "output.csv")

    reviews = []
    cursor = '*'
    fetched = 0
    
    logging.info(f"开始抓取 {game_name} (AppID: {appid}) 的评论，目标数量: {max_reviews}...")

    proxies = {k: v for k, v in {
        'http': os.environ.get('HTTP_PROXY', ''),
        'https': os.environ.get('HTTPS_PROXY', '')
    }.items() if v}

    while fetched < max_reviews:
        count_to_fetch = min(100, max_reviews - fetched)
        # Steam 接口默认 num_per_page 最大 100
        url = f"https://store.steampowered.com/appreviews/{appid}?json=1&language=all&num_per_page=100&cursor={urllib.parse.quote(cursor)}"
        
        success = False
        for attempt in range(5):
            try:
                r = requests.get(url, timeout=(10, 60), proxies=proxies, verify=False)
                data = r.json()
                if data.get('success') != 1:
                    logging.error(f"抓取失败，返回状态异常: {data}")
                    break
                
                page_reviews = data.get('reviews', [])
                if not page_reviews:
                    logging.info("没有更多评论了。")
                    success = True
                    break
                    
                reviews.extend(page_reviews)
                fetched += len(page_reviews)
                logging.info(f"已抓取 {fetched} 条评论...")
                
                cursor = data.get('cursor')
                success = True
                break
            except Exception as e:
                logging.error(f"抓取页面时出错 (尝试 {attempt+1}/5): {e}")
                time.sleep(10)
                
        if not success or not cursor:
            break
            
        if fetched < max_reviews:
            logging.info("休眠 10 秒钟以控制请求速率...")
            time.sleep(10)

    if not reviews:
        logging.warning(f"未抓取到 {game_name} 的任何评论。")
        return

    # 写入文件
    # 1. 原始文件 raw
    with open(raw_csv_path, "w", encoding="utf-8-sig", newline="") as f_raw:
        writer_raw = csv.writer(f_raw)
        writer_raw.writerow(FIELDNAMES_RAW)
        for i, rev in enumerate(reviews, 1):
            steam_id = rev.get("author", {}).get("steamid", "")
            content = rev.get("review", "").replace("\n", " ").replace("\r", "")
            dt = datetime.fromtimestamp(rev.get("timestamp_created", 0)).strftime("%Y-%m-%d %H:%M:%S")
            writer_raw.writerow([i, steam_id, steam_id, content, dt, rev.get("votes_up", 0)])

    # 2. 清洗文件及最终输出
    all_comments = []
    with open(clean_csv_path, "w", encoding="utf-8-sig", newline="") as f_clean, \
         open(output_csv_path, "w", encoding="utf-8-sig", newline="") as f_out:
        
        writer_clean = csv.writer(f_clean)
        writer_out = csv.writer(f_out)
        writer_clean.writerow(FIELDNAMES_SKILL)
        writer_out.writerow(FIELDNAMES_SKILL)
        
        for i, rev in enumerate(reviews, 1):
            content = rev.get("review", "").replace("\n", " ").replace("\r", "")
            if not content.strip():
                continue
            all_comments.append(content)
            row = [i, PLATFORM_LABEL, game_name, content, "", "", "", "", "", "", "", ""]
            writer_clean.writerow(row)
            writer_out.writerow(row)

    # 3. 纯文本评论 csv
    with open(comments_csv_path, "w", encoding="utf-8-sig", newline="") as f_csv:
        writer = csv.writer(f_csv)
        writer.writerow(["序号", "评论内容"])
        for i, content in enumerate(all_comments, 1):
            writer.writerow([i, content])

    logging.info(f"{game_name} 评论抓取完成，共 {len(reviews)} 条。保存在: {session_dir}")

def main():
    parser = argparse.ArgumentParser(description="Steam 评论爬虫")
    parser.add_argument("--games", type=str, nargs='+', help="要爬取游戏名列表")
    parser.add_argument("--file", type=str, help="包含游戏名的文本文件（每行一个）")
    parser.add_argument("--count", type=int, default=400, help="每个游戏爬取评论数")
    args = parser.parse_args()

    games_to_crawl = []
    if args.games:
        games_to_crawl.extend(args.games)
    if args.file and os.path.exists(args.file):
        with open(args.file, 'r', encoding='utf-8') as f:
            for line in f:
                name = line.strip()
                if name:
                    games_to_crawl.append(name)
                    
    if not games_to_crawl:
        logging.error("没有提供要爬取的主题游戏。")
        return

    for game in games_to_crawl:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_name = "".join(c for c in game if c.isalnum() or c in " _-")
        output_session_dir = os.path.join(OUTPUT_DIR, safe_name, f"{safe_name}_{ts}")
        session_name = f"{safe_name}_{ts}"
        log_session_dir = os.path.join(REPORTS_DIR, session_name)
        setup_logger(log_session_dir, ts)
        
        # Pass output_session_dir to crawl_steam_reviews for data output
        logging.info(f"====== 开始处理游戏: {game} ======")
        appid = get_appid_by_name(game)
        if not appid:
            logging.error(f"未能找到游戏 '{game}' 的 AppID，跳过。")
            continue
            
        logging.info(f"找到游戏 '{game}' 的 AppID: {appid}")
        crawl_steam_reviews(game, appid, args.count, output_session_dir)
        logging.info("====== 游戏处理结束 ======\n")

if __name__ == "__main__":
    main()
