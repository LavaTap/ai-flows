#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
小红书笔记评论采集脚本（参考 craw_comments-master 项目重写）

原理说明：
    参考 craw_comments-master 的 list_get_comments.py 方案：
    直接用 requests + cookie 调用评论接口 edith.xiaohongshu.com/api/sns/web/v2/comment/page，
    无需 Selenium/CDP/Playwright 捕获浏览器响应，速度快且简单。
    
    Cookie 获取方式：
    - 优先复用已保存的 cookie 文件（.xhs_cookies.json）
    - Cookie 过期时，用 DrissionPage 打开小红书页面扫码登录获取新 cookie
    - 也支持从参考项目的 cookie.txt 手动导入

    比原 Selenium+CDP 方案的改进：
    1. 无需浏览器滚动等待 → requests 直接翻页，速度快 10x+
    2. 支持 cursor 分页 → 可采集任意数量的评论（原方案依赖页面滚动）
    3. DrissionPage 登录 → 比 Selenium 更稳定地获取 cookie

产出结构：
    output/xiaohongshu/{note_id}/{note_id}_{时间戳}/
    ├── meta.json
    ├── raw/{note_id}.csv          # 原始评论字段
    ├── comments/comments.txt      # 纯评论文本（//分隔）
    └── output/output.csv          # SKILL 12字段（AI字段留空）
    reports/xiaohongshu/crawl_{note_id}.log  # 运行日志（独立存放）

依赖：pip install DrissionPage requests pandas（国内镜像）
首次运行如遇到 cookie 过期，会自动打开浏览器等待扫码登录。
"""

import argparse
import csv
import json
import logging
import os
import re
import time
from datetime import datetime

import requests
from DrissionPage import ChromiumPage, ChromiumOptions

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output', 'xiaohongshu')
REPORTS_DIR = os.path.join(PROJECT_ROOT, 'reports', 'xiaohongshu')
COOKIES_FILE = os.path.join(SCRIPT_DIR, '.xhs_cookies.json')
# 兼容参考项目的 cookie.txt
COOKIE_TXT_FILE = os.path.join(SCRIPT_DIR, 'cookie.txt')

PLATFORM = 'xiaohongshu'
PLATFORM_LABEL = '小红书'

COMMENT_API = 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page'
NOTE_API = 'https://edith.xiaohongshu.com/api/sns/web/v1/feed'

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')

FIELDNAMES_SKILL = [
    "序号", "平台", "游戏名称", "评论内容",
    "情绪倾向", "情绪关键词", "是否提及治愈", "治愈相关度",
    "治愈感受细分", "吸引游玩因素", "判断依据", "复核调整说明",
]
FIELDNAMES_RAW = ['评论ID', '昵称', '用户ID', '评论内容', '发布时间', '点赞数', 'IP属地', '子评论数']

# 产出子目录名（raw/comments/output）
SUBDIRS = ['raw', 'comments', 'output']

# 示例分享链接（仅供演示），实际使用请通过 --url 传入笔记链接
DEFAULT_URL = ("https://www.xiaohongshu.com/discovery/item/6a3c83d400000000210200b0"
               "?source=webshare&xhsshare=pc_web"
               "&xsec_token=AB1ManT_w7-WXxOiv6cF8Wfg5HubZVrqAknj0RgAlYq6g=&xsec_source=pc_share")


# ============ 日志 ============

def setup_logger(note_id: str):
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    logger.handlers = []
    formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
    ch = logging.StreamHandler()
    ch.setFormatter(formatter)
    logger.addHandler(ch)
    os.makedirs(REPORTS_DIR, exist_ok=True)
    fh = logging.FileHandler(os.path.join(REPORTS_DIR, f'crawl_{note_id}.log'), encoding='utf-8')
    fh.setFormatter(formatter)
    logger.addHandler(fh)
    return logger


# ============ Cookie 管理 ============

def load_cookie_string() -> str:
    """加载 cookie 字符串：优先 .xhs_cookies.json，其次 cookie.txt"""
    # 优先 JSON 格式
    if os.path.exists(COOKIES_FILE):
        try:
            with open(COOKIES_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            # 文件损坏/不可读时忽略，继续尝试 cookie.txt
            data = None
        if isinstance(data, dict) and 'cookie_string' in data:
            return data['cookie_string']
        if isinstance(data, str):
            return data

    # 兼容参考项目 cookie.txt（一行纯文本）
    if os.path.exists(COOKIE_TXT_FILE):
        with open(COOKIE_TXT_FILE, 'r', encoding='utf-8') as f:
            return f.readline().strip()

    return ''


def save_cookie_string(cookie_str: str):
    """保存 cookie 字符串到 JSON 文件"""
    with open(COOKIES_FILE, 'w', encoding='utf-8') as f:
        json.dump({'cookie_string': cookie_str, 'saved_at': datetime.now().isoformat()}, f, ensure_ascii=False)
    # 限制为仅属主可读写，降低 cookie 泄露风险（Windows 上 chmod 能力有限，失败可忽略）
    try:
        os.chmod(COOKIES_FILE, 0o600)
    except OSError:
        pass


def login_via_drissionpage(logger) -> str:
    """使用 DrissionPage 打开小红书，等待用户扫码登录，提取 cookie"""
    logger.info("启动 DrissionPage 浏览器，等待扫码登录...")
    co = ChromiumOptions()
    co.set_argument('--window-size=1280,900')
    co.set_argument('--no-sandbox')
    co.set_argument('--lang=zh-CN')
    co.set_user_agent(UA)
    # 不使用 headless，需要用户扫码
    page = None
    cookie_str = ''
    try:
        page = ChromiumPage(co)
        page.get('https://www.xiaohongshu.com')

        logger.info("请在弹出的浏览器窗口中扫码登录（等待最多 180 秒）...")

        # 等待登录完成：检测用户头像元素出现
        for _ in range(180):
            time.sleep(1)
            try:
                avatar = page.ele('.user-avatar', timeout=0.5)
                if avatar:
                    logger.info("登录成功！")
                    break
            except Exception:
                pass
        else:
            logger.warning("等待超时（180秒），尝试继续提取 cookie...")

        # 提取 cookie
        cookies = page.cookies()
        cookie_str = '; '.join(f"{c['name']}={c['value']}" for c in cookies)
    finally:
        # 确保浏览器进程退出，避免异常路径下残留
        if page is not None:
            try:
                page.quit()
            except Exception:
                pass

    if cookie_str:
        save_cookie_string(cookie_str)
        logger.info(f"Cookie 已保存: {COOKIES_FILE}")
    return cookie_str


# ============ 评论采集 ============

def parse_note_id(url: str) -> str:
    m = re.search(r'/(?:discovery/item|explore)/([0-9a-fA-F]{24})', url)
    if m:
        return m.group(1)
    m = re.search(r'/([0-9a-fA-F]{24})', url)
    return m.group(1) if m else 'unknown'


def extract_xsec_token(url: str) -> str:
    m = re.search(r'xsec_token=([A-Za-z0-9_\-+=.]+)', url)
    return m.group(1) if m else ''


def format_time(ms) -> str:
    try:
        return datetime.fromtimestamp(int(ms) / 1000).strftime('%Y-%m-%d %H:%M:%S')
    except (TypeError, ValueError, OSError, OverflowError):
        return ''


def normalize_comment(c: dict) -> dict:
    user = c.get('user_info') or {}
    return {
        '评论ID': c.get('id', ''),
        '昵称': user.get('nickname', ''),
        '用户ID': user.get('user_id', ''),
        '评论内容': (c.get('content') or '').replace('\r', ' ').strip(),
        '发布时间': format_time(c.get('create_time')),
        '点赞数': c.get('like_count', 0),
        'IP属地': c.get('ip_location', ''),
        '子评论数': c.get('sub_comment_count', 0),
    }


def get_note_info(note_id: str, xsec_token: str, cookie_str: str, logger) -> dict:
    """获取笔记元信息（标题等）"""
    headers = {'User-Agent': UA, 'Cookie': cookie_str}
    params = {
        'source_note_id': note_id,
        'image_formats': 'jpg,webp,avif',
        'xsec_source': 'pc_share',
        'xsec_token': xsec_token,
    }
    try:
        r = requests.get(NOTE_API, headers=headers, params=params, timeout=10)
        data = r.json()
        if not (data.get('success') or data.get('code') == 0):
            logger.warning(f"获取笔记信息失败: code={data.get('code')}")
            return {}
        item = data.get('data', {}).get('items', [{}])[0]
        note_card = item.get('note_card', {})
        return {
            'title': note_card.get('title', ''),
            'desc': note_card.get('desc', ''),
            'type': note_card.get('type', ''),
            'user': (note_card.get('user', {}) or {}).get('nickname', ''),
        }
    except Exception as e:
        logger.warning(f"获取笔记信息异常: {e}")
        return {}


def fetch_comments(note_id: str, max_comments: int, cookie_str: str, logger) -> list:
    """
    直接用 requests 调用评论接口（参考 craw_comments-master 的 list_get_comments.py）
    支持 cursor 分页，可采集任意数量评论
    """
    headers = {'User-Agent': UA, 'Cookie': cookie_str}
    comments = {}
    cursor = ''
    top_comment_id = ''
    page_num = 0

    while len(comments) < max_comments:
        page_num += 1
        params = {
            'note_id': note_id,
            'cursor': cursor,
            'top_comment_id': top_comment_id,
            'image_formats': 'jpg,webp,avif',
        }

        logger.info(f"请求第 {page_num} 页评论 (cursor={cursor or '首页'})...")
        try:
            r = requests.get(COMMENT_API, headers=headers, params=params, timeout=15)
        except requests.RequestException as e:
            logger.error(f"请求失败: {e}")
            break

        if r.status_code != 200:
            logger.error(f"HTTP 状态码: {r.status_code}")
            break

        try:
            data = r.json()
        except ValueError as e:
            logger.error(f"响应非 JSON（可能被风控）: {e}")
            break

        # 检测 cookie 过期（仅依据明确的过期 code 判定，其余失败走通用分支）
        if data.get('code') == -100:
            logger.warning("Cookie 已过期，需要重新登录！")
            return []

        if not (data.get('success') or data.get('code') == 0):
            logger.warning(f"接口返回失败: code={data.get('code')}, msg={data.get('msg', '')}")
            break

        comment_list = (data.get('data') or {}).get('comments') or []
        if not comment_list:
            logger.info("本页无评论，已采集完毕")
            break

        for c in comment_list:
            cid = c.get('id')
            if cid and cid not in comments:
                comments[cid] = normalize_comment(c)
                logger.info(f"  [{len(comments)}/{max_comments}] "
                            f"{comments[cid]['昵称']}: {comments[cid]['评论内容'][:40]}")

        # 提取下一页 cursor
        next_cursor = (data.get('data') or {}).get('cursor', '')
        has_more = (data.get('data') or {}).get('has_more', False)

        if not has_more or not next_cursor:
            logger.info(f"评论已全部加载（共 {len(comments)} 条）")
            break

        # cursor 未变化说明分页未推进，避免死循环
        if next_cursor == cursor:
            logger.warning("cursor 未变化，停止翻页以避免死循环")
            break

        cursor = next_cursor

        # 间隔避免频率过高
        time.sleep(1)

    return list(comments.values())[:max_comments]


# ============ 产出保存 ============

def save_outputs(rows: list, note_id: str, note_title: str, url: str, logger):
    """按项目约定保存 raw / comments / output 三层产出"""
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    session_dir = os.path.join(OUTPUT_DIR, note_id, f"{note_id}_{ts}")
    for sub in SUBDIRS:
        os.makedirs(os.path.join(session_dir, sub), exist_ok=True)

    raw_path = os.path.join(session_dir, 'raw', f'{note_id}.csv')
    with open(raw_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES_RAW)
        writer.writeheader()
        writer.writerows(rows)

    txt_path = os.path.join(session_dir, 'comments', 'comments.txt')
    with open(txt_path, 'w', encoding='utf-8') as f:
        f.write('//'.join(r['评论内容'] for r in rows if r['评论内容']))

    out_path = os.path.join(session_dir, 'output', 'output.csv')
    game_name = note_title or note_id
    with open(out_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES_SKILL)
        writer.writeheader()
        for i, r in enumerate(rows, start=1):
            # AI 相关字段留空，由后续 SKILL 流程填充
            writer.writerow({
                "序号": i, "平台": PLATFORM_LABEL, "游戏名称": game_name,
                "评论内容": r['评论内容'],
                "情绪倾向": "", "情绪关键词": "", "是否提及治愈": "", "治愈相关度": "",
                "治愈感受细分": "", "吸引游玩因素": "", "判断依据": "", "复核调整说明": "",
            })

    meta_path = os.path.join(session_dir, 'meta.json')
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump({'note_id': note_id, 'note_title': note_title, 'url': url,
                   'comment_count': len(rows), 'crawl_time': ts},
                  f, ensure_ascii=False, indent=2)

    logger.info(f"产出目录: {session_dir}")
    return session_dir


# ============ 主流程 ============

def main():
    parser = argparse.ArgumentParser(
        description='小红书笔记评论采集（requests + cookie 直调接口，参考 craw_comments-master）')
    parser.add_argument('--url', type=str, default=DEFAULT_URL, help='笔记分享链接')
    parser.add_argument('--max-comments', type=int, default=10, help='目标评论条数，默认10')
    parser.add_argument('--login', action='store_true', help='ERROR打开浏览器扫码登录获取新 cookie')
    args = parser.parse_args()

    note_id = parse_note_id(args.url)
    xsec_token = extract_xsec_token(args.url)
    logger = setup_logger(note_id)

    if note_id == 'unknown':
        logger.error(f"无法从 URL 解析 note_id，请检查 --url 参数: {args.url}")
        raise SystemExit(1)

    logger.info(f"目标: 采集 {args.max_comments} 条评论 | note_id={note_id} | 驱动=requests+cookie")

    # ── 获取 cookie ──
    if args.login:
        cookie_str = login_via_drissionpage(logger)
    else:
        cookie_str = load_cookie_string()

    if not cookie_str:
        logger.info("无可用 cookie，启动 DrissionPage 登录...")
        cookie_str = login_via_drissionpage(logger)

    if not cookie_str:
        logger.error("无法获取 cookie，退出")
        raise SystemExit(1)

    # ── 获取笔记信息 ──
    note_info = get_note_info(note_id, xsec_token, cookie_str, logger)
    note_title = note_info.get('title', '')
    if note_title:
        logger.info(f"笔记标题: {note_title}")
    else:
        logger.warning("未能获取笔记标题（cookie 可能过期），将使用 note_id 作为名称")

    # ── 采集评论 ──
    rows = fetch_comments(note_id, args.max_comments, cookie_str, logger)

    if not rows:
        logger.warning("未获取到评论：可能 cookie 已过期、笔记无评论，或接口风控。"
                       "可尝试 --login 重新扫码登录获取新 cookie")
        raise SystemExit(1)

    save_outputs(rows, note_id, note_title, args.url, logger)
    logger.info(f"[OK] 采集完成: {len(rows)} 条评论")


if __name__ == '__main__':
    main()
