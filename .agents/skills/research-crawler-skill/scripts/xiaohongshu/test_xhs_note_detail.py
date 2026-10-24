# -*- coding: utf-8 -*-
"""小红书笔记详情接口测试脚本。

打开目标笔记页，尝试捕获/调用网页端详情接口，提取笔记正文、点赞数、评论数，
并写入项目根目录 note_content.txt。

运行：
    venv\Scripts\python.exe test_xhs_note_detail.py
"""

from __future__ import annotations

import json
import os
import pickle
import re
import threading
import time
from datetime import datetime
from typing import Any
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# 真正的项目根目录：scripts/xiaohongshu → scripts → research-crawler-skill → 项目根
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
OUTPUT_PATH = os.path.join(PROJECT_ROOT, "note_content.txt")
RAW_RESPONSE_PATH = os.path.join(PROJECT_ROOT, "note_detail_response.json")
COOKIE_CANDIDATES = [
    # 主路径：与 xhs_qrcode_crawler.py 的 COOKIES_FILE 保持一致
    os.path.join(PROJECT_ROOT, "research-crawler-skill", "scripts", "xiaohongshu", ".xhs_cookies.pkl"),
    # 兼容旧版本脚本曾把 Cookie 放在 scripts 目录下的情况
    os.path.join(PROJECT_ROOT, "research-crawler-skill", "scripts", ".xhs_cookies.pkl"),
    # 兼容 .codebuddy/skills 方式安装 skill 的历史目录结构
    os.path.join(PROJECT_ROOT, ".codebuddy", "skills", "research-crawler-skill", "scripts", ".xhs_cookies.pkl"),
]
# Edge 可执行文件路径，可用环境变量 EDGE_PATH 覆盖；找不到时会回退到 Playwright 自带 Chromium
EDGE_PATH = os.environ.get("EDGE_PATH", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")

# 滚动等待参数：最多尝试 MAX_SCROLL_ATTEMPTS 轮，每轮向下滚动 SCROLL_STEP_PX 像素
MAX_SCROLL_ATTEMPTS = 30
SCROLL_STEP_PX = 700

# find_note_card 打分权重：note_id 精确命中最可信，其次是正文/标题/互动/作者等字段
SCORE_ID_MATCH = 100  # note_id 与目标笔记完全一致
SCORE_DESC = 30       # 含正文 desc
SCORE_TITLE = 20      # 含标题
SCORE_INTERACT = 20   # 含互动数据（点赞/评论/收藏数）
SCORE_USER = 10       # 含作者信息

# 笔记 ID 与 xsec_token 属会话/分享凭证，不再硬编码进仓库，改由环境变量注入：
#   XHS_NOTE_ID      目标笔记 ID（必填）
#   XHS_XSEC_TOKEN   分享链接中的临时 xsec_token（可选）
NOTE_ID = os.environ.get("XHS_NOTE_ID", "")
XSEC_TOKEN = os.environ.get("XHS_XSEC_TOKEN", "")
NOTE_URL = (
    f"https://www.xiaohongshu.com/discovery/item/{NOTE_ID}"
    "?source=webshare&xhsshare=pc_web"
    f"&xsec_token={XSEC_TOKEN}"
    "&xsec_source=pc_share"
)

# Playwright 的 response 回调与主流程共享 captured，用锁保证读写的原子性
_capture_lock = threading.Lock()


def load_cookies(context) -> str:
    """加载项目内已保存的小红书 Cookie。

    注意：Cookie 以 pickle 存盘（与 xhs_qrcode_crawler.py 保持一致），
    pickle 反序列化存在代码执行风险，请勿加载来源不可信的 .pkl 文件。
    改为 JSON 会与磁盘上已有的 .xhs_cookies.pkl 不兼容，故暂不改存储格式。
    """
    for path in COOKIE_CANDIDATES:
        if not os.path.exists(path):
            continue
        try:
            with open(path, "rb") as f:
                cookies = pickle.load(f)
        except Exception as exc:
            # 文件损坏/格式不匹配时跳过该候选，继续尝试下一个
            print(f"读取 Cookie 失败（已跳过）: {path} ({exc})")
            continue
        if cookies:
            context.add_cookies(cookies)
            return path
    return ""


def parse_query_param(url: str, key: str, default: str = "") -> str:
    """从 URL 查询串中取出指定参数，缺失时返回 default。"""
    qs = parse_qs(urlparse(url).query)
    return (qs.get(key) or [default])[0]


def parse_xsec_source(url: str) -> str:
    return parse_query_param(url, "xsec_source", "pc_share")


def parse_xsec_token(url: str) -> str:
    return parse_query_param(url, "xsec_token", "")


def walk(obj: Any):
    """递归遍历 JSON-like 数据。"""
    if isinstance(obj, dict):
        yield obj
        for value in obj.values():
            yield from walk(value)
    elif isinstance(obj, list):
        for item in obj:
            yield from walk(item)


def count_to_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def score_card(card: dict[str, Any]) -> int:
    score = 0
    if card.get("note_id") == NOTE_ID or card.get("id") == NOTE_ID:
        score += SCORE_ID_MATCH
    if card.get("desc"):
        score += SCORE_DESC
    if card.get("title") or card.get("display_title"):
        score += SCORE_TITLE
    if card.get("interact_info"):
        score += SCORE_INTERACT
    if card.get("user"):
        score += SCORE_USER
    return score


def find_note_card(data: Any) -> dict[str, Any] | None:
    """从接口响应、页面状态或任意 JSON 中寻找目标笔记详情。"""
    candidates: list[dict[str, Any]] = []
    for node in walk(data):
        card = node.get("note_card")
        if isinstance(card, dict):
            # 只比较明确的 id 字段，避免全量序列化与子串误命中
            note_id = node.get("id") or card.get("note_id") or card.get("id")
            if note_id == NOTE_ID:
                merged = dict(card)
                merged.setdefault("note_id", note_id)
                if node.get("xsec_token"):
                    merged.setdefault("xsec_token", node.get("xsec_token"))
                candidates.append(merged)

        node_id = node.get("note_id") or node.get("id")
        if node_id == NOTE_ID and any(k in node for k in ("desc", "title", "display_title", "interact_info", "user")):
            candidates.append(dict(node))

    if not candidates:
        return None
    return sorted(candidates, key=score_card, reverse=True)[0]


def extract_json_from_html(html: str) -> list[Any]:
    """从页面 HTML 的脚本状态中提取 JSON。"""
    objects: list[Any] = []
    patterns = [
        r"window\.__INITIAL_STATE__\s*=\s*({.*?})\s*</script>",
        r"window\.__NUXT__\s*=\s*({.*?})\s*</script>",
        r"<script[^>]*type=[\"']application/json[\"'][^>]*>(.*?)</script>",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, html, re.S):
            raw = match.group(1).strip()
            try:
                objects.append(json.loads(raw))
            except Exception as exc:
                # 正则截断/结构异常时记录原因，避免静默 continue 难以排查
                print(f"跳过无法解析的页面状态 JSON: {exc}")
                continue
    return objects


def extract_from_dom(page) -> dict[str, Any] | None:
    """接口未捕获时，从页面状态/DOM 元信息兜底提取。"""
    # 在页面内完成查找，只返回找到的目标笔记，避免序列化大对象
    found = page.evaluate(
        f"""
        () => {{
            const TARGET_ID = "{NOTE_ID}";

            function findNoteCard(obj) {{
                if (!obj || typeof obj !== 'object') return null;
                if (Array.isArray(obj)) {{
                    for (const item of obj) {{
                        const found = findNoteCard(item);
                        if (found) return found;
                    }}
                    return null;
                }}
                // 检查当前对象
                if (obj.note_card && (obj.id === TARGET_ID || obj.note_card.id === TARGET_ID)) {{
                    return obj.note_card;
                }}
                if ((obj.id === TARGET_ID || obj.note_id === TARGET_ID || obj.noteId === TARGET_ID) &&
                    (obj.desc || obj.title || obj.display_title)) {{
                    return obj;
                }}
                // 递归
                for (const k in obj) {{
                    if (typeof obj[k] === 'object') {{
                        const found = findNoteCard(obj[k]);
                        if (found) return found;
                    }}
                }}
                return null;
            }}

            // 尝试各种全局状态入口
            let found = null;
            for (const key of ['__INITIAL_STATE__', '__NUXT__', '__REDUX_STATE__']) {{
                try {{
                    if (window[key]) {{
                        found = findNoteCard(window[key]);
                        if (found) break;
                    }}
                }} catch(e) {{}}
            }}

            // 提取 meta 信息作为兜底
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

    # page.evaluate 理论上返回 {found, meta}，但页面无全局状态时可能返回 None，需显式判型
    if isinstance(found, dict) and found.get("found"):
        card = found["found"]
        if not card.get("note_id") and not card.get("id"):
            card["note_id"] = NOTE_ID
        card["source"] = "page_initial_state"
        return card

    # 从 meta 获取
    meta = found.get("meta") if isinstance(found, dict) else {"title": "", "desc": ""}
    title = (meta.get("title") or "").strip()
    desc = (meta.get("desc") or "").strip()
    if title or desc:
        return {"note_id": NOTE_ID, "title": title, "desc": desc, "source": "dom_meta"}
    return None


def try_feed_fetch(page) -> dict[str, Any] | None:
    """在页面上下文尝试直接 POST Feed 接口。"""
    body = {
        "source_note_id": NOTE_ID,
        "image_formats": ["jpg", "webp", "avif"],
        "extra": {"need_body_topic": "1"},
        "xsec_source": parse_xsec_source(NOTE_URL),
        "xsec_token": parse_xsec_token(NOTE_URL),
    }
    return page.evaluate(
        """
        async ({body}) => {
            try {
                const resp = await fetch('https://edith.xiaohongshu.com/api/sns/web/v1/feed', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {'content-type': 'application/json;charset=UTF-8'},
                    body: JSON.stringify(body)
                });
                const text = await resp.text();
                let json = null;
                try { json = JSON.parse(text); } catch(e) {}
                return {ok: resp.ok, status: resp.status, json, text: text.slice(0, 500)};
            } catch (e) {
                return {ok: false, status: 0, error: String(e)};
            }
        }
        """,
        {"body": body},
    )


def format_note(card: dict[str, Any], source: str) -> str:
    """把笔记 card 渲染为可读文本。

    输出为逐行的 ``字段: 值``：标题 / 作者 / 笔记ID / URL / xsec_source /
    点赞数 / 评论数 / 收藏数 / 数据来源 / 采集时间，随后是分隔线与正文 desc。
    """
    interact = card.get("interact_info") or {}
    user = card.get("user") or {}
    title = card.get("title") or card.get("display_title") or ""
    desc = card.get("desc") or card.get("description") or ""
    liked_count = count_to_text(interact.get("liked_count") or card.get("liked_count"))
    comment_count = count_to_text(interact.get("comment_count") or card.get("comment_count"))
    collected_count = count_to_text(interact.get("collected_count") or card.get("collected_count"))
    nickname = user.get("nickname") or card.get("nickname") or ""
    xsec_source = parse_xsec_source(NOTE_URL)

    return "\n".join(
        [
            f"标题: {title}",
            f"作者: {nickname}",
            f"笔记ID: {NOTE_ID}",
            f"URL: {NOTE_URL}",
            f"xsec_source: {xsec_source}",
            f"点赞数: {liked_count}",
            f"评论数: {comment_count}",
            f"收藏数: {collected_count}",
            f"数据来源: {source}",
            f"采集时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "=" * 50,
            "",
            desc if desc else "(无描述内容)",
            "",
        ]
    )


def main() -> int:
    if not NOTE_ID:
        print("缺少目标笔记 ID：请设置环境变量 XHS_NOTE_ID（可选 XHS_XSEC_TOKEN）后重试。")
        return 2

    captured: dict[str, Any] = {"card": None, "source": "", "raw": None}

    with sync_playwright() as p:
        launch_args: dict[str, Any] = {"headless": False}
        if os.path.exists(EDGE_PATH):
            launch_args["executable_path"] = EDGE_PATH
        else:
            # 显式提示回退行为，避免隐式依赖本机是否安装 Edge
            print(f"未找到 Edge（{EDGE_PATH}），回退使用 Playwright 自带 Chromium。")
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
        cookie_path = load_cookies(context)
        print(f"已加载 Cookie: {cookie_path}" if cookie_path else "未找到已保存 Cookie。")

        page = context.new_page()

        def on_response(response):
            if "xiaohongshu.com" not in response.url:
                return
            with _capture_lock:
                if captured["card"] is not None:
                    return
            content_type = response.headers.get("content-type", "")
            if "json" not in content_type and not any(key in response.url for key in ("/feed", "/note", "/search")):
                return
            try:
                data = response.json()
            except Exception:
                return
            card = find_note_card(data)
            if card:
                with _capture_lock:
                    if captured["card"] is not None:
                        return
                    captured["card"] = card
                    captured["source"] = f"response:{response.request.method} {response.url}"
                    captured["raw"] = data
                print(f"捕获到详情数据: {captured['source']}")

        page.on("response", on_response)

        try:
            page.goto(NOTE_URL, wait_until="domcontentloaded", timeout=60000)
        except PlaywrightTimeoutError:
            # 超时后页面可能仍在渲染，给一次短暂等待机会，避免在空白页上误判 not_found
            print("页面加载超时，继续读取已加载内容。")
            try:
                page.wait_for_load_state("domcontentloaded", timeout=15000)
            except Exception:
                pass

        # 明确尝试调用 Feed 接口；若签名缺失失败，则继续依赖页面真实请求/DOM 兜底。
        try:
            feed_result = try_feed_fetch(page)
        except Exception as exc:
            feed_result = None
            print(f"手动 Feed 调用失败，继续捕获页面请求: {exc}")

        if isinstance(feed_result, dict):
            # 仅在接口成功返回时落盘原始响应，避免把服务端错误/无关敏感响应写入文件
            if feed_result.get("ok"):
                try:
                    with open(RAW_RESPONSE_PATH, "w", encoding="utf-8") as f:
                        json.dump({"manual_feed_fetch": feed_result}, f, ensure_ascii=False, indent=2)
                except Exception as exc:
                    print(f"原始响应写入失败（已忽略）: {exc}")
            card = find_note_card(feed_result.get("json"))
            if card and captured["card"] is None:
                captured["card"] = card
                captured["source"] = "manual_feed_fetch"
                captured["raw"] = feed_result

        for _ in range(MAX_SCROLL_ATTEMPTS):
            if captured["card"] is not None:
                break
            try:
                page.mouse.wheel(0, SCROLL_STEP_PX)
            except Exception:
                pass
            time.sleep(1)

        if captured["card"] is None:
            print("未从接口响应捕获详情，尝试读取页面状态/DOM。")
            captured["card"] = extract_from_dom(page)
            captured["source"] = "dom_or_initial_state" if captured["card"] else "not_found"

        if captured["card"] is None:
            text = format_note({"title": "(未能读取笔记标题)", "desc": "(未能读取笔记详尽信息)"}, "not_found")
            with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
                f.write(text)
            browser.close()
            print(f"未能读取详情，已写入失败信息: {OUTPUT_PATH}")
            return 2

        text = format_note(captured["card"], captured["source"])
        with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
            f.write(text)
        if captured["raw"] is not None:
            with open(RAW_RESPONSE_PATH, "w", encoding="utf-8") as f:
                json.dump(captured["raw"], f, ensure_ascii=False, indent=2)
        browser.close()

    print(f"已写入: {OUTPUT_PATH}（{len(text)} 字符，内容见文件）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
