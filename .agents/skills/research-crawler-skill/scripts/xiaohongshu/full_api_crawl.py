#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""完整 API 爬取：先获取笔记评论总数作为上限，然后爬取所有评论达到上限即停止

使用方法:
    venv\Scripts\python.exe research-crawler-skill/scripts/xiaohongshu/full_api_crawl.py --url "笔记链接" [--max 500]

输出:
    output/xiaohongshu/{note_id}/{note_id}_{timestamp}/
    ├── comments/comments.csv  # 纯评论CSV
    └── output/output.csv      # 完整12字段CSV
"""

import argparse
import os
import re
import csv
import time
from datetime import datetime
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright

# 定位项目根目录
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)

OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output', 'xiaohongshu')
EDGE_PATH = os.environ.get('EDGE_PATH', r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")


def parse_note_id(url: str) -> str:
    """从URL提取note_id"""
    m = re.search(r'/item/([^?#]+)', url)
    if not m:
        raise ValueError(f"无法提取 note_id: {url}")
    note_id = m.group(1)
    if '#' in note_id:
        note_id = note_id.split('#')[0]
    return note_id


def extract_xsec_token(url: str) -> str:
    """从URL提取xsec_token"""
    m = re.search(r'xsec_token=([^&]+)', url)
    return m.group(1) if m else ''


def extract_xsec_source(url: str) -> str:
    """从URL提取xsec_source"""
    m = re.search(r'xsec_source=([^&]+)', url)
    return m.group(1) if m else 'pc_share'


def load_cookies_from_file():
    """从 cookie.txt 读取"""
    cookie_file = os.path.join(SCRIPT_DIR, 'cookie.txt')
    if not os.path.exists(cookie_file):
        print(f'未找到 {cookie_file}')
        return []

    cookies = []
    with open(cookie_file, 'r', encoding='utf-8') as f:
        cookie_str = f.read().strip()
    for item in cookie_str.split(';'):
        item = item.strip()
        if '=' in item:
            name, value = item.split('=', 1)
            cookies.append({
                'name': name.strip(),
                'value': value.strip(),
                'domain': '.xiaohongshu.com',
                'path': '/'
            })
    return cookies


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


def save_results(all_comments, note_id: str, note_url: str, session_dir: str, game_name: str):
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
        for i, c in enumerate(all_comments, 1):
            content = c.get('评论内容', '').strip()
            if content:
                writer.writerow([i, content])

    # 2. output.csv - 12字段标准格式
    fieldnames = ["序号", "平台", "游戏名称", "评论内容",
                  "情绪倾向", "情绪关键词", "是否提及治愈", "治愈相关度",
                  "治愈感受细分", "吸引游玩因素", "判断依据", "复核调整说明"]
    output_csv = os.path.join(session_dir, 'output', 'output.csv')
    # 使用传入的关键词作为游戏名称（而不是note_id）
    # 对特殊字符进行处理以兼容Windows路径
    with open(output_csv, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for i, c in enumerate(all_comments, 1):
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

    return comments_csv, output_csv


def main():
    parser = argparse.ArgumentParser(description='小红书完整评论爬取（API拦截+滚动加载）')
    parser.add_argument('--url', '-u', required=True, help='笔记完整URL（包含xsec_token）')
    parser.add_argument('--max', '-m', type=int, default=500, help='最大爬取评论数上限（默认500）')
    parser.add_argument('--keyword', '-k', default='', help='游戏/搜索关键词（作为CSV中"游戏名称"字段，默认使用note_id）')
    args = parser.parse_args()

    # 解析URL参数
    note_url = args.url
    note_id = parse_note_id(note_url)
    max_comments = args.max
    # 如果没有指定keyword，使用note_id作为游戏名称
    game_name = args.keyword if args.keyword else note_id

    print("="*80)
    print("Xiaohongshu Full Comment API Crawler")
    print("="*80)
    print(f"笔记ID: {note_id}")
    print(f"URL: {note_url}")
    print(f"最大评论数上限: {max_comments}")

    all_comments = []
    seen_ids = set()
    api_count = 0
    max_comment_count = 0

    # 创建输出目录
    # 目录结构: output/xiaohongshu/{game_name}/{note_id}_{timestamp}/
    # 同一游戏（关键词）的所有笔记放在同一个game_name目录下
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    # Windows路径不允许特殊字符: :"?*|\/  需要替换
    safe_game_name = game_name.replace(':', '_').replace('?', '__').replace('"', '^')
    session_name = f"{note_id}_{ts}"
    session_dir = os.path.join(OUTPUT_DIR, safe_game_name, session_name)
    os.makedirs(session_dir, exist_ok=True)
    print(f"输出目录: {session_dir}")

    print("\n请注意：每次运行小红书爬取前，请检查浏览器弹出的窗口中账号是否失效。")
    print("       如果账号失效，请及时更新 cookie.txt 文件以确保正常爬取。")
    print("       您可以使用 scripts/xiaohongshu/update_cookie.py 来更新cookie。")

    with sync_playwright() as p:
        launch_args = {"headless": False}
        if os.path.exists(EDGE_PATH):
            launch_args["executable_path"] = EDGE_PATH
        browser = p.chromium.launch(**launch_args)
        context = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            locale='zh-CN',
            viewport={"width": 1400, "height": 1000},
        )

        cookies = load_cookies_from_file()
        if cookies:
            context.add_cookies(cookies)
            print(f"已加载 {len(cookies)} 个 Cookie")

        page = context.new_page()
        page_cursors = set()

        # ===== 响应监听器 - 拦截评论API =====
        def handle_response_track_cursor(response):
            nonlocal api_count, max_comment_count
            url = response.url
            if 'xiaohongshu' not in url:
                return

            if 'comment' in url.lower() and '/api/sns/web/v2/comment/page' in url:
                try:
                    data = response.json()
                    api_count += 1

                    if 'data' in data and isinstance(data['data'], dict):
                        d = data['data']
                        cursor = d.get('cursor', '')
                        if cursor and cursor not in page_cursors:
                            page_cursors.add(cursor)

                        comments = d.get('comments', [])

                        for c in comments:
                            if isinstance(c, dict):
                                cid = c.get('id') or c.get('comment_id')
                                if cid and cid not in seen_ids:
                                    seen_ids.add(cid)
                                    user = c.get('user_info', {}) or {}
                                    all_comments.append({
                                        '评论ID': cid,
                                        '用户名': user.get('nickname', ''),
                                        '用户ID': user.get('user_id', ''),
                                        '评论内容': c.get('content', ''),
                                        '点赞数': c.get('like_count', 0),
                                        'IP属地': c.get('ip_location', ''),
                                        '创建时间': parse_ts(c.get('create_time', 0)),
                                        '评论类型': '主评论',
                                    })

                                    # 子评论（二级评论）
                                    sub_comments = c.get('sub_comments', [])
                                    for sc in sub_comments:
                                        scid = sc.get('id')
                                        if scid and scid not in seen_ids:
                                            seen_ids.add(scid)
                                            sub_user = sc.get('user_info', {}) or {}
                                            all_comments.append({
                                                '评论ID': scid,
                                                '用户名': sub_user.get('nickname', ''),
                                                '用户ID': sub_user.get('user_id', ''),
                                                '评论内容': sc.get('content', ''),
                                                '点赞数': sc.get('like_count', 0),
                                                'IP属地': sc.get('ip_location', ''),
                                                '创建时间': parse_ts(sc.get('create_time', 0)),
                                                '评论类型': '子评论',
                                            })

                    if max_comment_count > 0:
                        print(f"\r已捕获 {api_count} 个 API 响应, {len(all_comments)}/{min(max_comment_count, max_comments)} 条评论", end='')
                except Exception:
                    pass

        page.on("response", handle_response_track_cursor)

        # ===== 访问页面 =====
        print("\n访问笔记页面...")
        page.goto(note_url, wait_until='domcontentloaded', timeout=60000)
        time.sleep(5)

        # ===== 获取评论总数 =====
        print("\n正在获取评论总数...")
        for _ in range(3):
            try:
                page.mouse.move(700, 500)
                page.mouse.wheel(0, 600)
                time.sleep(0.3)
            except Exception:
                pass
        time.sleep(1)

        try:
            page_text = page.evaluate("document.body.innerText")
            match = re.search(r'(\d+)\s*条评论', page_text) or re.search(r'评论\s*(\d+)', page_text)
            if match:
                max_comment_count = int(match.group(1))
                print(f"从页面获取到评论总数: {max_comment_count}")
        except Exception:
            pass

        if max_comment_count == 0:
            max_comment_count = max_comments
            print(f"未能获取评论总数，使用参数上限: {max_comment_count}")

        # 限制不超过用户指定的最大值
        max_comment_count = min(max_comment_count, max_comments)

        print(f"\n开始爬取评论，目标 {max_comment_count} 条")
        print("滚动加载评论...")

        no_new_rounds = 0
        max_no_new_rounds = 2  # 连续 2 次无新增评论就停止
        round_count = 0
        prev_count = 0

        # 先滚动到评论区
        print("\n滚动到评论区...")
        for _ in range(6):
            try:
                page.mouse.move(700, 500)
                page.mouse.wheel(0, 800)
                time.sleep(0.25)
            except Exception:
                pass
        time.sleep(1.5)

        # 尝试点击激活评论区
        try:
            page.mouse.move(700, 400)
            page.mouse.click(700, 400)
            time.sleep(0.5)
        except Exception:
            pass

        while len(all_comments) < max_comment_count and no_new_rounds < max_no_new_rounds:
            round_count += 1

            # 方案1: 滚动所有可滚动容器到底部
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

            # 方案2: 点击"查看更多"等按钮
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

            # 方案3: 鼠标滚轮继续滚动
            for _ in range(6):
                try:
                    page.mouse.move(750, 500)
                    time.sleep(0.05)
                    page.mouse.wheel(0, 400)
                    time.sleep(0.2)
                except Exception:
                    pass

            # 等待加载
            for i in range(5):
                time.sleep(0.4)
                print(f"\r[轮次 {round_count}] 已获取 {len(all_comments)}/{max_comment_count} 条评论", end='')

            # 检查是否有新评论
            if len(all_comments) == prev_count:
                no_new_rounds += 1
                print(f"  (无新增 {no_new_rounds}/{max_no_new_rounds})", end='')
            else:
                no_new_rounds = 0
            prev_count = len(all_comments)

            if len(all_comments) >= max_comment_count:
                print(f"\n\n达到评论总数上限 {max_comment_count}，停止爬取！")
                break

            if no_new_rounds >= max_no_new_rounds:
                print(f"\n\n连续 {max_no_new_rounds} 次无新评论，停止爬取")
                break

        print("\n" + "="*60)
        browser.close()

    # 保存结果到标准输出目录
    comments_csv, output_csv = save_results(all_comments, note_id, note_url, session_dir, game_name)

    # 统计
    main_count = len([c for c in all_comments if c['评论类型'] == '主评论'])
    sub_count = len([c for c in all_comments if c['评论类型'] == '子评论'])

    print("\n" + "="*80)
    print("爬取完成！")
    print(f"  - 笔记评论总数上限: {max_comment_count}")
    print(f"  - API 响应数: {api_count}")
    print(f"  - 实际爬取评论数: {len(all_comments)}")
    print(f"  - 主评论: {main_count}")
    print(f"  - 子评论: {sub_count}")
    print(f"  - 纯评论CSV: {comments_csv}")
    print(f"  - 完整数据CSV: {output_csv}")
    print("="*80)

    return len(all_comments)


if __name__ == '__main__':
    main()
