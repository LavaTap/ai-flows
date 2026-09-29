# -*- coding: utf-8 -*-
"""
小红书批量采集治愈向(Cozy)游戏评论
逐个搜索游戏关键词，累计评论达到 target_total_comments 停止，不足则跳过。

运行:
    venv/Scripts/python.exe research-crawler-skill/scripts/xiaohongshu/batch_cozy_games_crawl.py
"""

import os
import sys
import time
from datetime import datetime
import argparse
import logging
import pickle
import csv
import re
from urllib.parse import quote

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output', 'xiaohongshu')
REPORTS_DIR = os.path.join(PROJECT_ROOT, 'reports', 'xiaohongshu', 'program')
COOKIES_FILE = os.path.join(SCRIPT_DIR, '.xhs_cookies.pkl')
EDGE_PATH = os.environ.get('EDGE_PATH', r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")

class CrawlState:
    def __init__(self):
        self.api_count = 0
        self.page_cursors = set()
        self.seen_comment_ids = set()
        self.all_comments = []

def create_logger(log_dir: str, name: str):
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')

    file_handler = logging.FileHandler(os.path.join(log_dir, f'{name}.log'), encoding='utf-8')
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    return logger

def load_game_list(file_path: str) -> list[str]:
    """从文件中加载游戏列表，每行一个游戏名"""
    games = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                game = line.strip()
                if game:
                    games.append(game)
    except FileNotFoundError:
        print(f"错误: 游戏列表文件未找到: {file_path}")
        sys.exit(1)
    return games

# 采集配置
TARGET_TOTAL_COMMENTS_PER_GAME = 300  # 每个游戏目标总评论数
MAX_NOTES_PER_SEARCH = 15  # 每次搜索最多采集多少篇笔记
MAX_COMMENTS_PER_NOTE = 30  # 单篇笔记最多采集多少评论
SKIP_IF_LESS_THAN = 50  # 如果最终累计 < 此数，标记为跳过

def load_cookies_to_context(context, logger):
    if os.path.exists(COOKIES_FILE):
        with open(COOKIES_FILE, 'rb') as f:
            cookies = pickle.load(f)
            # 转换 DrissionPage cookie 格式为 Playwright 格式
            # 需要确保每个 cookie 都有 domain/path
            playwright_cookies = []
            for c in cookies:
                # DrissionPage 的格式: {'name': 'xxx', 'value': 'xxx', 'domain': 'xxx', ...}
                if 'name' in c and 'value' in c:
                    pc = {
                        'name': c['name'],
                        'value': c['value'],
                    }
                    # 复制必要字段
                    for field in ['domain', 'path', 'expires', 'httpOnly', 'secure', 'sameSite']:
                        if field in c and c[field] is not None:
                            pc[field] = c[field]
                    # 如果没有 domain/path，给小红书添加默认值
                    if 'domain' not in pc:
                        pc['domain'] = '.xiaohongshu.com'
                    if 'path' not in pc:
                        pc['path'] = '/'
                    playwright_cookies.append(pc)
            context.add_cookies(playwright_cookies)
            logger.info(f'已加载 {len(playwright_cookies)} 个 Cookie 到浏览器上下文')
    else:
        logger.warning(f'未找到 {COOKIES_FILE}, 请先运行 update_cookie.py 进行登录。')

def ensure_login(page, context, logger) -> bool:
    load_cookies_to_context(context, logger)
    page.goto("https://www.xiaohongshu.com", wait_until='domcontentloaded')
    # 简单判断是否登录成功，例如检查是否有登录/注册按钮，或者检查是否存在用户头像等
    # 这里我们尝试多种选择器，如果其中一个匹配就认为登录成功
    selectors_to_check = [
        'div.user-avatar',
        '.user-img',
        '#userAvatar',
        '.avatar',
        '[data-testid="user-avatar"]',
        '.side-bar .avatar-wrapper',
    ]
    for selector in selectors_to_check:
        try:
            page.wait_for_selector(selector, timeout=2000)
            logger.info(f"登录状态正常 (找到 {selector})")
            return True
        except Exception:
            continue

    # 如果没有找到任何登录后元素，但不直接失败
    # Cookie 可能仍然有效，尝试继续采集，让后续操作验证
    logger.warning("未检测到明确的登录元素，但继续尝试（Cookie 可能仍然有效)")
    return True

def search_notes(page, keyword: str, max_notes: int, state: CrawlState, logger) -> list:
    collected_notes = [] # list of (note_id, xsec_token, title)
    seen_urls = set()

    def search_response_handler(response):
        url = response.url
        try:
            if ('search/notes' in url or 'search_notes' in url) and response.ok:
                data = response.json()
                items = data.get('data', {}).get('items', [])
                if items:
                    for item in items:
                        note_card = item.get('note_card', {})
                        note_id = item.get('id', '') or note_card.get('note_id', '')
                        if '#' in note_id:
                            note_id = note_id.split('#')[0]
                        xsec_token = item.get('xsec_token', '')
                        title = note_card.get('display_title', '') or note_card.get('title', '')
                        
                        # Build a unique identifier for the note to prevent duplicates
                        note_identifier = f"{note_id}-{xsec_token}"
                        
                        if note_id and xsec_token and note_identifier not in seen_urls:
                            seen_urls.add(note_identifier)
                            collected_notes.append((note_id, xsec_token, title))
                            logger.info(f"  拦截到搜索API: +1 条, 累计 {len(collected_notes)} 条笔记")
        except Exception as e:
            logger.error(f"  搜索响应处理异常: {e}")

    page.on('response', search_response_handler)

    encoded_keyword = quote(keyword, safe='')
    search_url = f'https://www.xiaohongshu.com/search_result?keyword={encoded_keyword}&source=web_search_result_notes'
    logger.info(f"导航到搜索页: {search_url}")
    page.goto(search_url, wait_until='domcontentloaded', timeout=60000)
    time.sleep(5)

    current_url = page.url
    if 'login' in current_url or 'passport' in current_url:
        logger.warning("页面被重定向到登录页，请检查 cookie 是否有效")
        page.remove_listener('response', search_response_handler)
        return []

    scroll_attempts = 0
    max_scroll = 20
    while len(collected_notes) < max_notes and scroll_attempts < max_scroll:
        scroll_attempts += 1
        logger.info(f"  滚动加载更多搜索结果 ({scroll_attempts}/{max_scroll}), 当前 {len(collected_notes)}/{max_notes}")
        try:
            page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
        except Exception:
            pass
        time.sleep(3)

    page.remove_listener('response', search_response_handler)

    result = collected_notes[:max_notes]
    logger.info(f"搜索完成: 获取 {len(result)} 条笔记")
    return result

def parse_ts(ts):
    """解析时间戳"""
    try:
        if isinstance(ts, str):
            ts = int(ts)
        if ts > 999999999999:  # 毫秒
            ts = ts // 1000
        return datetime.fromtimestamp(ts).strftime('%Y-%m-%d %H:%M')
    except:
        return str(ts)

def get_note_info_sync(page, note_url: str, note_id: str, xsec_token: str, search_source: str, state: CrawlState, logger):
    """获取笔记的基本信息，包括评论总数"""
    logger.info(f"访问笔记页面获取信息: {note_url}")
    page.goto(note_url, wait_until='domcontentloaded', timeout=60000)
    time.sleep(5) # Give page some time to load

    # Get comment count
    try:
        page.mouse.move(700, 500)
        page.mouse.wheel(0, 600)
        time.sleep(0.3)
        page_text = page.evaluate("document.body.innerText")
        match = re.search(r'(\d+)\s*条评论', page_text) or re.search(r'评论\s*(\d+)', page_text)
        if match:
            state.max_comment_count = int(match.group(1))
            logger.info(f"从页面获取到评论总数: {state.max_comment_count}")
        else:
            state.max_comment_count = 0
    except Exception as e:
        logger.warning(f"未能从页面获取评论总数: {e}")
        state.max_comment_count = 0

def crawl_note_comments(page, note_url: str, note_id: str, max_comments_per_note: int, state: CrawlState, logger) -> list:
    """采集单篇笔记的评论"""
    all_comments_for_note = []
    seen_comment_ids_for_note = set()
    api_response_count = 0

    def handle_response_track_cursor(response):
        nonlocal api_response_count
        url = response.url
        if 'xiaohongshu' not in url:
            return

        # 放宽匹配条件：只要 URL 包含 comment 和 api 就可能是评论接口
        if 'comment' in url.lower() and 'api' in url.lower():
            try:
                data = response.json()
                api_response_count += 1

                if 'data' in data and isinstance(data['data'], dict):
                    d = data['data']
                    comments = d.get('comments', [])

                    for c in comments:
                        if isinstance(c, dict):
                            cid = c.get('id') or c.get('comment_id')
                            if cid and cid not in seen_comment_ids_for_note:
                                seen_comment_ids_for_note.add(cid)
                                user = c.get('user_info', {}) or {}
                                all_comments_for_note.append({
                                    '评论ID': cid,
                                    '用户名': user.get('nickname', ''),
                                    '用户ID': user.get('user_id', ''),
                                    '评论内容': c.get('content', ''),
                                    '点赞数': c.get('like_count', 0),
                                    'IP属地': c.get('ip_location', ''),
                                    '创建时间': parse_ts(c.get('create_time', 0)),
                                    '评论类型': '主评论',
                                })

                                sub_comments = c.get('sub_comments', [])
                                for sc in sub_comments:
                                    scid = sc.get('id')
                                    if scid and scid not in seen_comment_ids_for_note:
                                        seen_comment_ids_for_note.add(scid)
                                        sub_user = sc.get('user_info', {}) or {}
                                        all_comments_for_note.append({
                                            '评论ID': scid,
                                            '用户名': sub_user.get('nickname', ''),
                                            '用户ID': sub_user.get('user_id', ''),
                                            '评论内容': sc.get('content', ''),
                                            '点赞数': sc.get('like_count', 0),
                                            'IP属地': sc.get('ip_location', ''),
                                            '创建时间': parse_ts(sc.get('create_time', 0)),
                                            '评论类型': '子评论',
                                        })

                if state.max_comment_count > 0:
                    print(f"\r已捕获 {api_response_count} 个 API 响应, {len(all_comments_for_note)}/{min(state.max_comment_count, max_comments_per_note)} 条评论", end='', flush=True)
            except Exception as e:
                logger.error(f"处理评论API响应异常: {e}")

    page.on("response", handle_response_track_cursor)

    logger.info(f"开始采集评论，目标 {max_comments_per_note} 条")

    no_new_rounds = 0
    max_no_new_rounds = 2  # 连续 2 次无新增评论就停止
    round_count = 0
    prev_count = 0

    # 滚动到评论区并尝试加载
    for _ in range(6):
        try:
            page.mouse.move(700, 500)
            page.mouse.wheel(0, 800)
            time.sleep(0.25)
        except Exception:
            pass
    time.sleep(1.5)

    try:
        page.mouse.move(700, 400)
        page.mouse.click(700, 400)
        time.sleep(0.5)
    except Exception:
        pass

    while len(all_comments_for_note) < max_comments_per_note and no_new_rounds < max_no_new_rounds:
        round_count += 1

        try:
            page.evaluate("""() => {
                const allElements = document.querySelectorAll('*');
                for (const el of allElements) {
                    if (el.scrollHeight > el.clientHeight + 50) {
                        el.scrollTop = el.scrollHeight;
                    }
                }
                window.scrollTo(0, document.body.scrollHeight);
            }""")
        except Exception:
            pass

        try:
            page.evaluate("""() => {
                const texts = ['查看更多', '加载更多', '更多评论', '点击加载', '评论', '展开'];
                for (const text of texts) {
                    const elements = Array.from(document.querySelectorAll('*')).filter(el =>
                        el.textContent && el.textContent.includes(text) && el.offsetParent !== null);
                    elements.forEach(el => { try { el.click(); } catch(e) {} });
                }
            }""")
        except Exception:
            pass

        for _ in range(6):
            try:
                page.mouse.move(750, 500)
                time.sleep(0.05)
                page.mouse.wheel(0, 400)
                time.sleep(0.2)
            except Exception:
                pass

        for i in range(5):
            time.sleep(0.4)
            print(f"\r[轮次 {round_count}] 已获取 {len(all_comments_for_note)}/{max_comments_per_note} 条评论", end='', flush=True)

        if len(all_comments_for_note) == prev_count:
            no_new_rounds += 1
            print(f"  (无新增 {no_new_rounds}/{max_no_new_rounds})", end='', flush=True)
        else:
            no_new_rounds = 0
        prev_count = len(all_comments_for_note)

        if len(all_comments_for_note) >= max_comments_per_note:
            logger.info(f"\n达到评论总数上限 {max_comments_per_note}，停止爬取！")
            break

        if no_new_rounds >= max_no_new_rounds:
            logger.info(f"\n连续 {max_no_new_rounds} 次无新评论，停止爬取")
            break

    page.remove_listener("response", handle_response_track_cursor)
    return all_comments_for_note

def save_note_results(comments, state: CrawlState, note_id: str, note_url: str, game_name: str, session_dir: str, logger):
    """保存结果到标准输出目录

    输出结构:
        session_dir/comments/comments.csv  - 纯评论
        session_dir/output/output.csv      - 12字段完整CSV
    """
    os.makedirs(os.path.join(session_dir, 'comments'), exist_ok=True)
    os.makedirs(os.path.join(session_dir, 'output'), exist_ok=True)

    # 1. comments.csv - 纯评论（序号 + 评论内容）
    comments_csv = os.path.join(session_dir, 'comments', 'comments.csv')
    with open(comments_csv, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['序号', '评论内容'])
        for i, c in enumerate(comments, 1):
            content = c.get('评论内容', '').strip()
            if content:
                writer.writerow([i, content])
    logger.info(f"保存纯评论到: {comments_csv}")

    # 2. output.csv - 12字段标准格式
    fieldnames = ["序号", "平台", "游戏名称", "评论内容",
                  "情绪倾向", "情绪关键词", "是否提及治愈", "治愈相关度",
                  "治愈感受细分", "吸引游玩因素", "判断依据", "复核调整说明"]
    output_csv = os.path.join(session_dir, 'output', 'output.csv')
    with open(output_csv, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for i, c in enumerate(comments, 1):
            content = c.get('评论内容', '').strip()
            if content:
                writer.writerow({
                    "序号": i,
                    "平台": "小红书",
                    "游戏名称": game_name,
                    "评论内容": content,
                    "情绪倾向": "",
                    "情绪关键词": "",
                    "是否提及治愈": "",
                    "治愈相关度": "",
                    "治愈感受细分": "",
                    "吸引游玩因素": "",
                    "判断依据": "",
                    "复核调整说明": ""
                })
    logger.info(f"保存完整数据到: {output_csv}")

def sanitize_filename(name: str) -> str:
    """清理文件名，移除 Windows 不允许的字符。"""
    invalid_chars = r':?"\/|*<>:'
    for c in invalid_chars:
        name = name.replace(c, '_')
    return name


def main():
    parser = argparse.ArgumentParser(description='小红书批量采集游戏评论')
    parser.add_argument('--game-list-file', '-f', type=str, required=True, help='包含游戏名称的文本文件路径，每行一个游戏名')
    args = parser.parse_args()

    COZY_GAMES = load_game_list(args.game_list_file)

    from playwright.sync_api import sync_playwright

    ts_batch = datetime.now().strftime('%Y%m%d_%H%M%S')
    log_dir = os.path.join(REPORTS_DIR, f"batch_cozy_{ts_batch}")
    os.makedirs(log_dir, exist_ok=True)
    logger = create_logger(log_dir, ts_batch)

    logger.info("=" * 70)
    logger.info("小红书批量采集治愈向游戏评论")
    logger.info("=" * 70)
    logger.info(f"游戏总数: {len(COZY_GAMES)}")
    logger.info(f"目标评论/游戏: {TARGET_TOTAL_COMMENTS_PER_GAME}")
    logger.info(f"最大笔记/搜索: {MAX_NOTES_PER_SEARCH}")
    logger.info(f"最大评论/笔记: {MAX_COMMENTS_PER_NOTE}")
    logger.info(f"跳过阈值(<): {SKIP_IF_LESS_THAN}")
    logger.info("")

    total_games_started = 0
    total_games_completed = 0
    total_games_skipped = 0
    total_comments_collected = 0

    with sync_playwright() as p:
        logger.info("启动 Edge 浏览器...")
        browser = p.chromium.launch(
            executable_path=EDGE_PATH,
            headless=False,
            args=['--no-sandbox', '--disable-gpu', '--window-size=1280,900',
                  '--disable-blink-features=AutomationControlled']
        )
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0.0.0 Safari/537.36"
            ),
            viewport={'width': 1280, 'height': 900},
            locale='zh-CN',
        )
        page = context.new_page()

        # ===== 登录 =====
        login_ok = ensure_login(page, context, logger)
        if not login_ok:
            logger.error("登录失败，退出批量采集")
            browser.close()
            return 1

        logger.info("登录成功，开始批量处理...\n")

        # ===== 逐个处理游戏 =====
        for idx_game, game_name in enumerate(COZY_GAMES, 1):
            logger.info("-" * 70)
            logger.info(f"[{idx_game}/{len(COZY_GAMES)}] 游戏: {game_name}")
            logger.info("-" * 70)

            total_games_started += 1
            accumulated_comments = 0
            notes_processed = 0
            game_success_notes = 0

            ts_game = datetime.now().strftime('%Y%m%d_%H%M%S')
            safe_game_name = sanitize_filename(game_name[:30])
            game_log_dir = os.path.join(log_dir, f"{idx_game:02d}_{safe_game_name}")
            os.makedirs(game_log_dir, exist_ok=True)
            game_logger = create_logger(game_log_dir, ts_game)

            state = CrawlState()

            # 搜索
            game_logger.info(f"搜索笔记: {game_name}")
            notes = search_notes(page, game_name, MAX_NOTES_PER_SEARCH, state, game_logger)

            if not notes:
                logger.warning(f"  ❌ 未搜索到任何笔记，跳过")
                total_games_skipped += 1
                continue

            game_logger.info(f"获取到 {len(notes)} 条笔记，开始逐篇采集...")

            # 逐篇采集，直到累计评论达标
            for idx_note, (note_id, xsec_token, title) in enumerate(notes, 1):
                if accumulated_comments >= TARGET_TOTAL_COMMENTS_PER_GAME:
                    game_logger.info(f"  ✅ 已累计 {accumulated_comments} 条评论，达到目标，停止采集更多笔记")
                    break

                game_logger.info(f"\n  笔记 {idx_note}/{len(notes)}: {title[:40]} (note_id={note_id})")

                # 构建笔记 URL
                if xsec_token:
                    note_url = (f"https://www.xiaohongshu.com/discovery/item/{note_id}"
                                f"?xsec_token={xsec_token}&xsec_source=pc_search")
                else:
                    note_url = f"https://www.xiaohongshu.com/discovery/item/{note_id}"

                note_ts = datetime.now().strftime('%Y%m%d_%H%M%S')
                note_session = f"{note_id}_{note_ts}"
                safe_game_dir = sanitize_filename(game_name)
                session_dir = os.path.join(OUTPUT_DIR, safe_game_dir, note_session)

                try:
                    # 前置获取笔记详情
                    get_note_info_sync(page, note_url, note_id, xsec_token, "pc_search", state, game_logger)
                    comments = crawl_note_comments(
                        page, note_url, note_id, MAX_COMMENTS_PER_NOTE, state, game_logger)
                    save_note_results(
                        comments, state, note_id, note_url, game_name, session_dir, game_logger)

                    note_count = len(comments)
                    accumulated_comments += note_count
                    notes_processed += 1
                    if note_count > 0:
                        game_success_notes += 1

                    game_logger.info(f"  本笔记 {note_count} 条，累计 {accumulated_comments} 条")

                except Exception as e:
                    game_logger.error(f"  笔记 {note_id} 采集失败: {e}", exc_info=True)

                # 笔记间隔
                if idx_note < len(notes) and accumulated_comments < TARGET_TOTAL_COMMENTS_PER_GAME:
                    time.sleep(3)

            # 采集完毕，检查是否达标
            logger.info(f"  游戏 [{game_name}] 采集完成: {notes_processed} 笔记, {accumulated_comments} 评论")

            if accumulated_comments >= TARGET_TOTAL_COMMENTS_PER_GAME:
                logger.info(f"  ✅ 达到目标 {TARGET_TOTAL_COMMENTS_PER_GAME}，完成")
                total_games_completed += 1
            elif accumulated_comments >= SKIP_IF_LESS_THAN:
                logger.info(f"  ⚠  未达标，但评论数 {accumulated_comments} ≥ {SKIP_IF_LESS_THAN}，保留")
                total_games_completed += 1
            else:
                logger.warning(f"  ❌ 评论数 {accumulated_comments} < {SKIP_IF_LESS_THAN}，跳过")
                total_games_skipped += 1

            total_comments_collected += accumulated_comments

            # 游戏间隔
            if idx_game < len(COZY_GAMES):
                logger.info(f"等待下一个游戏...\n")
                time.sleep(5)

        # ===== 汇总 =====
        # 更新 Cookie
        cookies = context.cookies()
        with open(COOKIES_FILE, 'wb') as f:
            import pickle
            pickle.dump(cookies, f)

        browser.close()

        logger.info("\n" + "=" * 70)
        logger.info("批量采集完成")
        logger.info("=" * 70)
        logger.info(f"开始游戏: {total_games_started}")
        logger.info(f"完成/保留: {total_games_completed}")
        logger.info(f"跳过: {total_games_skipped}")
        logger.info(f"总评论采集: {total_comments_collected}")
        if total_games_completed > 0:
            logger.info(f"平均评论/完成游戏: {total_comments_collected // total_games_completed}")
        logger.info("")
        logger.info(f"输出目录: {OUTPUT_DIR}")
        logger.info(f"日志目录: {log_dir}")

        print("\n" + "=" * 70)
        print(f"  批量采集完成!")
        print(f"  完成: {total_games_completed} / 跳过: {total_games_skipped}")
        print(f"  总评论: {total_comments_collected}")
        print(f"  日志: {log_dir}")
        print("=" * 70 + "\n")

        return 0


if __name__ == '__main__':
    sys.exit(main())
