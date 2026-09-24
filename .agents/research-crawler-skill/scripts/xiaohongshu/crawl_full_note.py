#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""获取小红书单条笔记详情：点赞数、评论总数、收藏数、标题正文等元数据

使用方法:
    venv\Scripts\python.exe research-crawler-skill/scripts/xiaohongshu/crawl_full_note.py --url "笔记链接"

输出:
    output/xiaohongshu/{note_id}/{note_id}_{timestamp}/
    └── note_content.txt  # 笔记详情文本
    └── meta.json         # 元数据JSON
"""

import argparse
import os
import json
import time
import re
from datetime import datetime
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

# 定位项目根目录
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)

OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output', 'xiaohongshu')
COOKIE_FILE = os.path.join(SCRIPT_DIR, 'cookie.txt')
EDGE_PATH = os.environ.get('EDGE_PATH', r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")


# ===== 工具函数 =====

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
    qs = parse_qs(urlparse(url).query)
    return (qs.get("xsec_source") or ["pc_share"])[0]


# ===== Cookie 相关 =====

def load_cookies_from_file():
    """从 cookie.txt 读取"""
    cookie_file = COOKIE_FILE
    if not os.path.exists(cookie_file):
        print(f'未找到 {cookie_file}')
        return None

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
                'path': '/',
            })
    return cookies


# ===== 笔记详情解析 =====

def walk(obj):
    """递归遍历 JSON-like 数据。"""
    if isinstance(obj, dict):
        yield obj
        for value in obj.values():
            yield from walk(value)
    elif isinstance(obj, list):
        for item in obj:
            yield from walk(item)


def score_card(card: dict, note_id: str) -> int:
    score = 0
    if card.get("note_id") == note_id or card.get("id") == note_id:
        score += 100
    if card.get("desc"):
        score += 30
    if card.get("title") or card.get("display_title"):
        score += 20
    if card.get("interact_info"):
        score += 20
    if card.get("user"):
        score += 10
    return score


def find_note_card(data, note_id: str) -> dict | None:
    """从接口响应、页面状态或任意 JSON 中寻找目标笔记详情。"""
    candidates = []
    for node in walk(data):
        card = node.get("note_card")
        if isinstance(card, dict):
            node_text = json.dumps(node, ensure_ascii=False)
            note_id_found = node.get("id") or card.get("note_id") or card.get("id")
            if note_id_found == note_id or note_id in node_text:
                merged = dict(card)
                merged.setdefault("note_id", note_id_found)
                if node.get("xsec_token"):
                    merged.setdefault("xsec_token", node.get("xsec_token"))
                candidates.append(merged)

        node_id = node.get("note_id") or node.get("id")
        if node_id == note_id and any(k in node for k in ("desc", "title", "display_title", "interact_info", "user")):
            candidates.append(dict(node))

    if not candidates:
        return None
    return sorted(candidates, key=lambda c: score_card(c, note_id), reverse=True)[0]


def extract_from_dom(page, note_id: str) -> dict | None:
    """接口未捕获时，从页面状态/DOM 元信息兜底提取。"""
    found = page.evaluate(
        f"""
        () => {{
            const TARGET_ID = "{note_id}";

            function findNoteCard(obj) {{
                if (!obj || typeof obj !== 'object') return null;
                if (Array.isArray(obj)) {{
                    for (const item of obj) {{
                        const found = findNoteCard(item);
                        if (found) return found;
                    }}
                    return null;
                }}
                if (obj.note_card && (obj.id === TARGET_ID || obj.note_card.id === TARGET_ID)) {{
                    return obj.note_card;
                }}
                if ((obj.id === TARGET_ID || obj.note_id === TARGET_ID || obj.noteId === TARGET_ID) &&
                    (obj.desc || obj.title || obj.display_title)) {{
                    return obj;
                }}
                for (const k in obj) {{
                    if (typeof obj[k] === 'object') {{
                        const found = findNoteCard(obj[k]);
                        if (found) return found;
                    }}
                }}
                return null;
            }}

            let found = null;
            for (const key of ['__INITIAL_STATE__', '__NUXT__', '__REDUX_STATE__']) {{
                try {{
                    if (window[key]) {{
                        found = findNoteCard(window[key]);
                        if (found) break;
                    }}
                }} catch(e) {{}}
            }}

            const titleEl = document.querySelector('meta[property="og:title"], meta[name="title"]');
            const descEl = document.querySelector('meta[property="og:description"], meta[name="description"]');
            const meta = {{
                title: titleEl ? titleEl.getAttribute('content') : (document.title || ''),
                desc: descEl ? descEl.getAttribute('content') : ''
            }};

            return {{ found, meta }};
        }}
        """
    )

    if found and found.get("found"):
        card = found["found"]
        if not card.get("note_id") and not card.get("id"):
            card["note_id"] = note_id
        card["source"] = "page_initial_state"
        return card

    meta = found.get("meta") if found else {"title": "", "desc": ""}
    title = (meta.get("title") or "").strip()
    desc = (meta.get("desc") or "").strip()
    if title or desc:
        return {"note_id": note_id, "title": title, "desc": desc, "source": "dom_meta"}
    return None


def count_to_text(value) -> str:
    if value is None:
        return ""
    return str(value)


def get_note_metadata(note_url: str, note_id: str):
    """获取笔记元数据，返回包含点赞数、评论数、收藏数"""
    print("="*80)
    print("Xiaohongshu Note Metadata Crawler")
    print("="*80)
    print(f"笔记ID: {note_id}")
    print(f"URL: {note_url}")

    note_captured = {"card": None, "source": "", "raw": None}

    with sync_playwright() as p:
        launch_args = {"headless": False}
        if os.path.exists(EDGE_PATH):
            launch_args["executable_path"] = EDGE_PATH
        browser = p.chromium.launch(**launch_args)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0"
            ),
            locale="zh-CN",
            viewport={"width": 1400, "height": 1000},
        )

        # 加载 Cookie
        cookies = load_cookies_from_file()
        if cookies:
            context.add_cookies(cookies)
            print(f"已加载 {len(cookies)} 个 Cookie")
        else:
            print("未找到 Cookie 文件")

        page = context.new_page()

        # 拦截笔记详情响应
        def on_response(response):
            if note_captured["card"] is not None or "xiaohongshu.com" not in response.url:
                return
            content_type = response.headers.get("content-type", "")
            if "json" not in content_type and not any(key in response.url for key in ("/feed", "/note", "/search")):
                return
            try:
                data = response.json()
            except Exception:
                return
            card = find_note_card(data, note_id)
            if card:
                note_captured["card"] = card
                note_captured["source"] = f"response:{response.request.method} {response.url}"
                note_captured["raw"] = data
                print(f"捕获到笔记详情数据: {note_captured['source']}")

        page.on("response", on_response)

        # 访问笔记页面
        try:
            page.goto(note_url, wait_until="domcontentloaded", timeout=60000)
        except PlaywrightTimeoutError:
            print("页面加载超时，继续读取已加载内容。")

        time.sleep(3)

        # 等待详情数据捕获
        for _ in range(10):
            if note_captured["card"] is not None:
                break
            time.sleep(1)

        # 兜底：从页面状态/DOM提取
        if note_captured["card"] is None:
            print("未从接口响应捕获详情，尝试读取页面状态/DOM。")
            note_captured["card"] = extract_from_dom(page, note_id)
            note_captured["source"] = "dom_or_initial_state" if note_captured["card"] else "not_found"

        browser.close()

    # 解析元数据
    card = note_captured["card"] or {}
    source = note_captured["source"] or ""
    interact = card.get("interact_info") or {}
    user = card.get("user") or {}
    title = card.get("title") or card.get("display_title") or ""
    desc = card.get("desc") or card.get("description") or ""
    liked_count = count_to_text(interact.get("liked_count") or card.get("liked_count"))
    comment_count = count_to_text(interact.get("comment_count") or card.get("comment_count"))
    collected_count = count_to_text(interact.get("collected_count") or card.get("collected_count"))
    nickname = user.get("nickname") or card.get("nickname") or ""

    # 转换评论数为数字
    try:
        comment_count_int = int(comment_count) if comment_count.isdigit() else 0
    except:
        comment_count_int = 0

    result = {
        "title": title,
        "author": nickname,
        "note_id": note_id,
        "liked_count": liked_count,
        "comment_count": comment_count_int,
        "comment_count_text": comment_count,
        "collected_count": collected_count,
        "desc": desc,
        "source": source,
        "url": note_url,
        "xsec_source": extract_xsec_source(note_url),
        "crawl_time": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    }

    return result


def save_result(result, note_id: str):
    """保存结果到标准输出目录"""
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    session_name = f"{note_id}_{ts}"
    session_dir = os.path.join(OUTPUT_DIR, note_id, session_name)
    os.makedirs(session_dir, exist_ok=True)

    # 1. 文本格式输出
    title = result["title"]
    desc = result["desc"]
    output_txt = os.path.join(session_dir, "note_content.txt")

    output_text = "\n".join([
        "="*80,
        "小红书笔记详情",
        "="*80,
        "",
        f"标题: {title}",
        f"作者: {result['author']}",
        f"笔记ID: {result['note_id']}",
        f"URL: {result['url']}",
        f"xsec_source: {result['xsec_source']}",
        f"点赞数: {result['liked_count']}",
        f"评论数: {result['comment_count_text']}",
        f"收藏数: {result['collected_count']}",
        f"数据来源: {result['source']}",
        f"采集时间: {result['crawl_time']}",
        "="*80,
        "",
        "【笔记正文】",
        desc if desc else "(无描述内容)",
        "",
    ])

    with open(output_txt, "w", encoding="utf-8") as f:
        f.write(output_text)

    # 2. JSON 元数据
    meta_json = os.path.join(session_dir, "meta.json")
    with open(meta_json, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\n保存完成:")
    print(f"  笔记详情: {output_txt}")
    print(f"  元数据: {meta_json}")

    return output_txt, meta_json


def main():
    parser = argparse.ArgumentParser(description='获取小红书单条笔记元数据（点赞/评论/收藏+标题正文）')
    parser.add_argument('--url', '-u', required=True, help='笔记完整URL（包含xsec_token）')
    args = parser.parse_args()

    # 解析参数
    note_url = args.url
    note_id = parse_note_id(note_url)

    # 获取并保存数据
    result = get_note_metadata(note_url, note_id)
    output_txt, meta_json = save_result(result, note_id)

    # 终端输出摘要
    print("\n" + "="*80)
    print("提取到的元数据：")
    for k, v in result.items():
        if k != 'desc':
            print(f"  {k}: {v}")
    if len(result['desc']) > 80:
        print(f"  desc: {result['desc'][:80]}...")
    else:
        print(f"  desc: {result['desc']}")
    print("="*80)


if __name__ == "__main__":
    main()
