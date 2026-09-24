#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按关键词搜索小红书笔记，获取笔记链接列表（含完整xsec_token）

使用方法:
    1. 在当前目录创建 keywords.txt，每行一个关键词
    2. 运行: venv\Scripts\python.exe research-crawler-skill/scripts/xiaohongshu/list_get_links.py

输出:
    scripts/xiaohongshu/links_data/{keyword}.txt - 每行一个完整笔记URL
"""

import os
import time
from urllib.parse import quote
from playwright.sync_api import sync_playwright

# 定位项目根目录
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)

COOKIE_FILE = os.path.join(SCRIPT_DIR, 'cookie.txt')
EDGE_PATH = os.environ.get('EDGE_PATH', r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")

# 每个关键词最多采集多少篇笔记
MAX_NOTES_PER_KEYWORD = 30


def read_keywords() -> list:
    """读取 keywords.txt"""
    keywords_file = os.path.join(SCRIPT_DIR, 'keywords.txt')
    if not os.path.exists(keywords_file):
        print(f"未找到 {keywords_file}，请创建该文件并每行写入一个关键词")
        return []
    with open(keywords_file, 'r', encoding="utf-8") as file:
        keywords = [line.strip() for line in file.readlines() if line.strip()]
    return keywords


def set_cookies(context):
    """从 cookie.txt 读取 cookie 并设置到浏览器上下文"""
    if not os.path.exists(COOKIE_FILE):
        print(f'未找到 {COOKIE_FILE}，跳过 cookie 设置')
        return
    with open(COOKIE_FILE, 'r', encoding='utf-8') as f:
        cookie_str = f.read().strip()
    cookies = []
    for item in cookie_str.split(';'):
        item = item.strip()
        if '=' in item:
            name, value = item.split('=', 1)
            cookie = {
                'name': name.strip(),
                'value': value.strip(),
                'domain': '.xiaohongshu.com',
                'path': '/'
            }
            cookies.append(cookie)
    context.add_cookies(cookies)
    print(f'已设置 {len(cookies)} 个 cookie 从 cookie.txt')


def search_and_collect(page, keyword: str, max_notes: int) -> list:
    """搜索关键词，通过 API 响应拦截获取笔记链接（xsec_token 直接从 API 获取）

    Args:
        page: Playwright page 对象
        keyword: 搜索关键词
        max_notes: 最多收集多少篇笔记

    Returns:
        list: 完整链接列表
    """
    collected = []
    search_items = []

    # 搜索结果拦截 handler - 拦截搜索 API 响应
    def search_response_handler(response):
        url = response.url
        try:
            # 匹配搜索笔记接口
            if ('search/notes' in url or 'search_notes' in url) and response.ok:
                try:
                    data = response.json()
                except Exception:
                    return
                items = data.get('data', {}).get('items', [])
                if items:
                    for item in items:
                        note_card = item.get('note_card', {})
                        note_id = item.get('id', '') or note_card.get('note_id', '')
                        # 清理 note_id
                        if '#' in note_id:
                            note_id = note_id.split('#')[0]
                        xsec_token = item.get('xsec_token', '')
                        title = note_card.get('display_title', '') or note_card.get('title', '')
                        if note_id and xsec_token:
                            # 构建完整链接
                            note_url = (f"https://www.xiaohongshu.com/discovery/item/{note_id}"
                                        f"?xsec_token={xsec_token}&xsec_source=pc_search")
                            if note_url not in collected:
                                collected.append(note_url)
                                search_items.append((note_id, xsec_token, title))
                    print(f"  拦截到搜索API: +{len(items)} 条, 累计 {len(collected)} 条笔记")
        except Exception as e:
            print(f"  搜索响应处理异常: {e}")

    page.on('response', search_response_handler)

    # URL 编码关键词
    encoded_keyword = quote(keyword, safe='')
    search_url = f'https://www.xiaohongshu.com/search_result?keyword={encoded_keyword}&source=web_search_result_notes'
    print(f"导航到搜索页: {search_url}")
    page.goto(search_url, wait_until='domcontentloaded', timeout=60000)
    time.sleep(5)

    # 检查是否跳登录页
    current_url = page.url
    if 'login' in current_url or 'passport' in current_url:
        print("页面被重定向到登录页，请检查 cookie 是否有效")
        page.remove_listener('response', search_response_handler)
        return []

    # 滚动加载更多，直到收集足够笔记
    scroll_attempts = 0
    max_scroll = 20
    while len(collected) < max_notes and scroll_attempts < max_scroll:
        scroll_attempts += 1
        print(f"  滚动加载更多搜索结果 ({scroll_attempts}/{max_scroll}), 当前 {len(collected)}/{max_notes}")
        try:
            page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
        except Exception:
            pass
        time.sleep(3)

    page.remove_listener('response', search_response_handler)

    # 截断到最大数量
    result = collected[:max_notes]
    print(f"搜索完成: 获取 {len(result)} 条链接")
    for i, url in enumerate(result, 1):
        print(f"  [{i}] {url[:80]}...")
    return result


def save_links(keyword: str, links: list):
    """保存链接到 links_data 目录"""
    links_dir = os.path.join(SCRIPT_DIR, 'links_data')
    os.makedirs(links_dir, exist_ok=True)
    output_file = os.path.join(links_dir, keyword + ".txt")
    with open(output_file, "w", encoding='utf-8') as file:
        for link in links:
            file.write(link + "\n")
    print(f"关键词「{keyword}」已保存 {len(links)} 条链接到: {output_file}")


def main():
    keywords = read_keywords()
    if not keywords:
        print("未读取到关键词，请检查 keywords.txt")
        return

    print("="*60)
    print(f"读取到 {len(keywords)} 个关键词")
    for i, kw in enumerate(keywords, 1):
        print(f"  [{i}] {kw}")
    print("="*60)

    with sync_playwright() as p:
        # 使用 Edge 浏览器
        browser = p.chromium.launch(
            executable_path=EDGE_PATH,
            headless=False,
            args=['--no-sandbox', '--disable-gpu', '--window-size=1280,900',
                  '--disable-blink-features=AutomationControlled']
        )
        context = browser.new_context(
            user_agent=('Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                        'AppleWebKit/537.36 (KHTML, like Gecko) '
                        'Chrome/126.0.0.0 Safari/537.36'),
            viewport={'width': 1280, 'height': 900},
            locale='zh-CN',
        )
        page = context.new_page()

        # 先导航到首页再设置 cookie
        page.goto('https://www.xiaohongshu.com', wait_until='domcontentloaded')
        set_cookies(context)
        page.goto('https://www.xiaohongshu.com', wait_until='domcontentloaded')
        time.sleep(3)

        for keyword in keywords:
            print(f"\n{'='*60}")
            print(f"正在采集: {keyword}")
            print(f"{'='*60}")

            links = search_and_collect(page, keyword, MAX_NOTES_PER_KEYWORD)
            save_links(keyword, links)

        browser.close()
        print("\n全部完成！")


if __name__ == '__main__':
    main()
