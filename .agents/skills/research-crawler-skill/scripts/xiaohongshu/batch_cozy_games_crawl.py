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

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output', 'xiaohongshu')
REPORTS_DIR = os.path.join(PROJECT_ROOT, 'reports', 'xiaohongshu', 'program')

# 治愈向游戏列表 (共 39 款)
COZY_GAMES = [
    "Sky: Children of the Light",
    "Solarpunk",
    "A Little to the Left",
    "STORY OF SEASONS: Grand Bazaar",
    "Tiny Glade",
    "Outbound",
    "Dwarf Eats Mountain",
    "Town to City",
    "Gris",
    "The Artisan of Glimmith",
    "Hozy",
    "Whisper of the House",
    "Roots of Pacha",
    "Little Kitty, Big City",
    "Strange Horticulture",
    "Lost and Found Co.",
    "Fae Farm",
    "Bookshop Simulator",
    "Doloc Town",
    "Cozy Grove",
    "Good Pizza, Great Pizza",
    "KuloNiku: Bowl Up!",
    "Sticky Business",
    "TOEM",
    "Farm to Table",
    "HER TREES : PUZZLE DREAM",
    "A Short Hike",
    "Cozy Cleaner",
    "Wanderstop",
    "Arctico",
    "Melatonin",
    "Garden Galaxy",
    "Phonopolis",
    "Ooblets",
    "Jusant",
    "Gourdlets",
    "Station to Station",
    "Season: A letter to the future",
    "Naiad",
]

# 采集配置
TARGET_TOTAL_COMMENTS_PER_GAME = 300  # 每个游戏目标总评论数
MAX_NOTES_PER_SEARCH = 15  # 每次搜索最多采集多少篇笔记
MAX_COMMENTS_PER_NOTE = 30  # 单篇笔记最多采集多少评论
SKIP_IF_LESS_THAN = 50  # 如果最终累计 < 此数，标记为跳过

# 反爬间隔：逐篇笔记之间、以及相邻游戏之间的等待秒数
NOTE_INTERVAL_SECONDS = 3
GAME_INTERVAL_SECONDS = 5
# 连续采集失败的笔记数达到此值时提前终止当前游戏，避免在异常页面上空转
MAX_CONSECUTIVE_NOTE_FAILURES = 3


def sanitize_filename(name: str) -> str:
    """清理文件名，移除 Windows 不允许的字符。"""
    invalid_chars = r'<>:"/\|?*'
    for c in invalid_chars:
        name = name.replace(c, '_')
    # 控制字符（\x00-\x1f）同样不允许出现在文件名中，一并过滤
    return ''.join(ch for ch in name if ord(ch) >= 32)


def main():
    try:
        from playwright.sync_api import sync_playwright
        from xhs_qrcode_crawler import (
            CrawlState,
            ensure_login,
            search_notes,
            get_note_info_sync,
            crawl_note_comments,
            save_note_results,
            create_logger,
            COOKIES_FILE,
            EDGE_PATH,
        )
    except ImportError as e:
        # 延迟导入失败时给出明确的依赖安装提示
        print(f"缺少运行依赖，导入失败: {e}")
        print("请先安装依赖: pip install playwright && playwright install chromium")
        return 1

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
        # 登录失败或抛异常时，一并关闭 context 与 browser，避免浏览器进程泄漏
        try:
            login_ok = ensure_login(page, context, logger)
        except Exception as e:
            logger.error(f"登录异常，退出批量采集: {e}")
            try:
                context.close()
            finally:
                browser.close()
            return 1
        if not login_ok:
            logger.error("登录失败，退出批量采集")
            try:
                context.close()
            finally:
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
            consecutive_note_failures = 0

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
                # 搜索失败也要遵守游戏间隔，避免连续快速请求触发风控
                if idx_game < len(COZY_GAMES):
                    time.sleep(GAME_INTERVAL_SECONDS)
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
                    consecutive_note_failures += 1
                    game_logger.error(f"  笔记 {note_id} 采集失败: {e}", exc_info=True)
                    if consecutive_note_failures >= MAX_CONSECUTIVE_NOTE_FAILURES:
                        game_logger.error(
                            f"  连续 {consecutive_note_failures} 篇笔记采集失败，提前终止该游戏")
                        break
                else:
                    consecutive_note_failures = 0

                # 笔记间隔
                if idx_note < len(notes) and accumulated_comments < TARGET_TOTAL_COMMENTS_PER_GAME:
                    time.sleep(NOTE_INTERVAL_SECONDS)

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
                time.sleep(GAME_INTERVAL_SECONDS)

        # ===== 汇总 =====
        # 更新 Cookie
        # 注意：Cookie 仍以 pickle 存盘，与 xhs_qrcode_crawler.py 的 ensure_login 读写格式一致；
        # 改成 JSON 会与磁盘上已有的 .xhs_cookies.pkl 不兼容，故此处不改存储格式。
        # 写盘失败不应阻断后续汇总日志与 browser.close()，因此单独捕获异常。
        try:
            cookies = context.cookies()
            with open(COOKIES_FILE, 'wb') as f:
                import pickle
                pickle.dump(cookies, f)
        except Exception as e:
            logger.warning(f"Cookie 保存失败（已忽略）: {e}")

        browser.close()

        logger.info("\n" + "=" * 70)
        logger.info("批量采集完成")
        logger.info("=" * 70)
        logger.info(f"开始游戏: {total_games_started}")
        logger.info(f"完成/保留: {total_games_completed}")
        logger.info(f"跳过: {total_games_skipped}")
        logger.info(f"总评论采集: {total_comments_collected}")
        if total_games_completed > 0:
            logger.info(f"平均评论/完成游戏: {total_comments_collected / total_games_completed:.1f}")
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
