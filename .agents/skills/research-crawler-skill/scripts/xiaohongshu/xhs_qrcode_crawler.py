# -*- coding: utf-8 -*-
"""
小红书搜索+评论采集脚本（扫码登录 + Playwright 拦截）

功能：
  模式一 --search: 按关键词搜索笔记，采集前N条笔记的评论
    python xhs_qrcode_crawler.py --search "Bongo Cat" --note-count 10 --max-comments 20
  模式二 --url: 直接采集指定笔记的评论
    python xhs_qrcode_crawler.py --url "https://www.xiaohongshu.com/discovery/item/xxx" --max-comments 30

登录：首次运行扫码登录，Cookie 保存到 .xhs_cookies.pkl 复用。
签名：x-s/x-t 等由页面 JS 自动生成，通过 Playwright response 拦截捕获接口响应。

产出：
  output/xiaohongshu/{note_id}/{note_id}_{ts}/
  ├── note_content.txt          # 笔记全文
  ├── meta.json                 # 元数据
  ├── comments/comments.csv     # 纯评论CSV
  └── output/output.csv         # 完整数据CSV（12字段）
"""
import argparse
import base64
import csv
import json
import os
import pickle
import re
import sys
import time
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output', 'xiaohongshu')
REPORTS_DIR = os.path.join(PROJECT_ROOT, 'reports', 'xiaohongshu', 'program')
COOKIES_FILE = os.path.join(SCRIPT_DIR, '.xhs_cookies.pkl')
QRCODE_PATH = os.path.join(PROJECT_ROOT, 'qrcode.png')
EDGE_PATH = os.environ.get('EDGE_PATH', r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')

# 关键 API 路径特征
QR_CODE_API_KEY = 'qrcode/create'
QR_USERINFO_API_KEY = 'qrcode/userinfo'
QR_STATUS_API_KEY = 'login/qrcode/status'
COMMENT_API = '/api/sns/web/v2/comment/page'
FEED_API = '/api/sns/web/v1/feed'
SEARCH_API = '/api/sns/web/v1/search/notes'

# 策略3（全 span 兜底扫描评论）开关：默认关闭，避免把标题/正文/点赞数/UI 文案当成评论
ENABLE_SPAN_FALLBACK = False


# ===== 工具函数 =====

def clean_note_id(note_id: str) -> str:
    """清理 note_id，移除 # 及后面的片段（避免路径问题）。"""
    if '#' in note_id:
        note_id = note_id.split('#')[0]
    return note_id


def parse_note_id(url: str) -> str:
    m = re.search(r'/item/([^?#]+)', url)
    if not m:
        raise ValueError(f"无法提取 note_id: {url}")
    return clean_note_id(m.group(1))


def extract_xsec_token(url: str) -> str:
    m = re.search(r'xsec_token=([^&]+)', url)
    return m.group(1) if m else ''


def create_logger(log_dir: str, ts: str):
    import logging
    logger = logging.getLogger('xhs')
    logger.setLevel(logging.INFO)
    logger.handlers = []
    fmt = logging.Formatter('%(asctime)s [%(levelname)s] %(message)s')
    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    logger.addHandler(ch)
    os.makedirs(log_dir, exist_ok=True)
    fh = logging.FileHandler(os.path.join(log_dir, f'{ts}.log'), encoding='utf-8')
    fh.setFormatter(fmt)
    logger.addHandler(fh)
    return logger


# ===== 采集状态 =====

class CrawlState:
    """在 Playwright response handler 与主流程之间共享的可变状态。"""

    def __init__(self):
        self.comments = []
        self.cursors = []
        self.has_more = False
        self.note_info = None
        self.search_items = []

    def reset_for_note(self):
        """切换到下一篇笔记时重置评论相关状态。"""
        self.comments = []
        self.cursors = []
        self.has_more = False
        self.note_info = None

    def reset_all(self):
        self.reset_for_note()
        self.search_items = []


# ===== 二维码提取 =====

def save_qrcode_from_response(data: dict, page, logger) -> bool:
    """从二维码生成 API 响应或 DOM 中提取二维码图片并保存。"""
    qr_data = data.get('data', {}) if data else {}
    qr_id = qr_data.get('qrId', '') or qr_data.get('qr_id', '')
    code = qr_data.get('code', '')

    img_src = page.evaluate("""
        () => {
            const canvas = document.querySelector('canvas[class*="qr"], canvas[class*="qrcode"], canvas');
            if (canvas) {
                try {
                    const dataUrl = canvas.toDataURL('image/png');
                    if (dataUrl && dataUrl.startsWith('data:image/png;base64,') && dataUrl.length > 1000) {
                        return dataUrl;
                    }
                } catch(e) {}
            }
            const imgs = document.querySelectorAll(
                'img[class*="qr"], img[class*="qrcode"], img[src*="qrcode"], ' +
                'img[src*="qr-code"], img[src*="qr"]'
            );
            for (const img of imgs) {
                const src = img.src || img.getAttribute('src');
                if (src && src.length > 100) return src;
            }
            const popup = document.querySelector('[class*="login"], [class*="Login"]');
            if (popup) {
                const img = popup.querySelector('img');
                if (img) return img.src || img.getAttribute('src') || '';
            }
            return '';
        }
    """)

    if not img_src:
        logger.warning("  未从 DOM 中找到二维码图片")
        return False

    try:
        if img_src.startswith('data:image/png;base64,'):
            b64 = img_src.split(',', 1)[1]
            img_data = base64.b64decode(b64)
        elif img_src.startswith('http'):
            resp = page.request.get(img_src, timeout=10000)
            if not resp.ok:
                logger.warning(f"  图片URL请求失败: {resp.status}")
                return False
            img_data = resp.body()
        else:
            logger.warning(f"  未知格式的二维码src: {img_src[:50]}")
            return False

        if img_data[:4] == b'\x89PNG' or img_data[:2] == b'\xff\xd8':
            with open(QRCODE_PATH, 'wb') as f:
                f.write(img_data)
            logger.info(f"二维码已保存: {QRCODE_PATH}")
            logger.info(f"  qr_id={qr_id}, code={code}, size={len(img_data)} bytes")
            return True
        else:
            logger.warning(f"  数据非图片格式（首字节: {img_data[:8].hex()}）")
    except Exception as e:
        logger.warning(f"  保存二维码失败: {e}")
    return False


# ===== 登录 =====

def ensure_login(page, context, logger) -> bool:
    """确保已登录。优先复用 Cookie，否则触发扫码登录。

    Returns:
        True 如果登录成功。
    """
    # 尝试复用已保存的 Cookie
    if os.path.exists(COOKIES_FILE):
        try:
            with open(COOKIES_FILE, 'rb') as f:
                cookies = pickle.load(f)
            if cookies:
                context.add_cookies(cookies)
                logger.info(f"已加载保存的 Cookie ({len(cookies)} 个)")
                # 验证是否有效
                page.goto('https://www.xiaohongshu.com', wait_until='domcontentloaded')
                time.sleep(3)
                cookies_now = context.cookies()
                has_ws = any(c['name'] == 'web_session' and c['value'] for c in cookies_now)
                has_wsg = any(c['name'] == 'websectiga' and c['value'] for c in cookies_now)
                if has_ws and has_wsg:
                    logger.info("Cookie 有效，已登录")
                    return True
                else:
                    logger.info(f"Cookie 不完整 (web_session={has_ws}, websectiga={has_wsg})，需要重新登录")
                    context.clear_cookies()
        except Exception as e:
            logger.warning(f"加载 Cookie 失败: {e}")

    # 清除残留二维码
    if os.path.exists(QRCODE_PATH):
        os.remove(QRCODE_PATH)
    if os.path.exists(COOKIES_FILE):
        os.remove(COOKIES_FILE)

    # ERROR清除浏览器 Cookie，触发登录弹窗
    context.clear_cookies()
    logger.info("已清除浏览器 Cookie（ERROR触发登录）")

    # 登录状态变量
    login_state = {
        'qr_data': None,
        'qrcode_downloaded': False,
        'status_received': False,
        'is_logged_in': False,
    }

    def login_response_handler(response):
        url = response.url
        try:
            if QR_CODE_API_KEY in url and 'status' not in url and 'userinfo' not in url:
                try:
                    data = response.json()
                    login_state['qr_data'] = data
                    if not login_state['is_logged_in']:
                        if save_qrcode_from_response(data, page, logger):
                            login_state['qrcode_downloaded'] = True
                except Exception as e:
                    logger.warning(f"  二维码API响应解析失败: {e}")

            elif QR_STATUS_API_KEY in url and response.request.method == 'GET':
                try:
                    data = response.json()
                    login_state['status_received'] = True
                    if data.get('code') == 0 and data.get('success', True):
                        login_data = data.get('data', {})
                        if login_data and login_data.get('status') in ('ok', 'confirmed', 'success'):
                            login_state['is_logged_in'] = True
                            logger.info("  ✓ 登录状态已确认")
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"  响应处理异常: {e}")

    page.on('response', login_response_handler)

    logger.info("=" * 60)
    logger.info("打开小红书登录页，触发二维码生成")
    logger.info("=" * 60)

    page.goto('https://www.xiaohongshu.com', wait_until='domcontentloaded')
    time.sleep(3)

    # 检查是否已经登录（需同时有 web_session 和 websectiga）
    cookies_now = context.cookies()
    has_ws = any(c['name'] == 'web_session' and c['value'] for c in cookies_now)
    has_wsg = any(c['name'] == 'websectiga' and c['value'] for c in cookies_now)
    if has_ws and has_wsg:
        login_state['is_logged_in'] = True
        logger.info("已登录（web_session + websectiga）")

    if not login_state['is_logged_in']:
        logger.info("等待二维码生成...")
        qr_start = time.time()
        while not login_state['qrcode_downloaded'] and time.time() - qr_start < 30:
            time.sleep(0.5)

        if not login_state['qrcode_downloaded']:
            logger.info("API 方式未获取到二维码，尝试从 DOM 提取...")
            qr_src = page.evaluate("""
                () => {
                    const selectors = [
                        'img[class*="qrcode"]', 'img[class*="qr-code"]',
                        'img[src*="qrcode"]', 'img[src*="qr-code"]',
                        'canvas[class*="qr"]', 'div[class*="qrcode"] img',
                        '[class*="qrcode-pc"] img'
                    ];
                    for (const sel of selectors) {
                        const el = document.querySelector(sel);
                        if (el && (el.src || el.getAttribute('src'))) {
                            return el.src || el.getAttribute('src');
                        }
                    }
                    const canvas = document.querySelector('canvas');
                    if (canvas) { try { return canvas.toDataURL('image/png'); } catch(e) {} }
                    return '';
                }
            """)
            if qr_src:
                if qr_src.startswith('data:image'):
                    b64 = qr_src.split(',', 1)[1]
                    with open(QRCODE_PATH, 'wb') as f:
                        f.write(base64.b64decode(b64))
                    login_state['qrcode_downloaded'] = True
                    logger.info(f"二维码已从 canvas 保存: {QRCODE_PATH}")
                elif qr_src.startswith('http'):
                    try:
                        resp = page.request.get(qr_src)
                        with open(QRCODE_PATH, 'wb') as f:
                            f.write(resp.body())
                        login_state['qrcode_downloaded'] = True
                        logger.info(f"二维码已保存: {QRCODE_PATH}")
                    except Exception as e:
                        logger.warning(f"从 URL 下载二维码失败: {e}")

        if login_state['qrcode_downloaded']:
            logger.info("=" * 60)
            logger.info(">>> 二维码已生成！请用小红书APP扫描项目根目录的 qrcode.png 登录 <<<")
            logger.info("=" * 60)
        else:
            logger.warning("未能自动提取二维码，请在浏览器窗口直接扫码登录")

        # 等待用户扫码登录
        logger.info("等待用户扫码并确认...")
        login_start = time.time()
        login_timeout = 180

        while not login_state['is_logged_in'] and time.time() - login_start < login_timeout:
            time.sleep(2)
            cookies_now = context.cookies()
            has_web_session = any(c['name'] == 'web_session' and c['value'] for c in cookies_now)
            has_websectiga = any(c['name'] == 'websectiga' and c['value'] for c in cookies_now)
            current_url = page.url

            if has_web_session and has_websectiga:
                login_state['is_logged_in'] = True
                logger.info("检测到登录态 Cookie（web_session + websectiga），登录成功")
                break

            if 'login' not in current_url and 'passport' not in current_url and len(cookies_now) > 5:
                if has_web_session:
                    login_state['is_logged_in'] = True
                    logger.info("登录成功（页面已离开登录页）")
                    break

        if not login_state['is_logged_in']:
            logger.warning("登录超时（3分钟），尝试继续采集...")
        else:
            logger.info("✓ 登录流程闭环完成")

        # 保存 Cookie
        cookies = context.cookies()
        with open(COOKIES_FILE, 'wb') as f:
            pickle.dump(cookies, f)
        logger.info(f"Cookie 已保存 ({len(cookies)} 个)")

    # 移除登录专用的 handler，避免后续干扰
    page.remove_listener('response', login_response_handler)
    return login_state['is_logged_in']


# ===== 搜索笔记 =====

def search_notes(page, keyword: str, count: int, state: CrawlState, logger) -> list:
    """搜索关键词，返回 [(note_id, xsec_token, title)] 列表。

    导航到小红书搜索页，通过 response 拦截捕获搜索 API 响应。
    """
    from urllib.parse import quote
    state.search_items = []

    # 搜索结果拦截 handler
    def search_response_handler(response):
        url = response.url
        try:
            # 调试：记录所有 edith/so 域名的 API 响应
            if ('edith.xiaohongshu' in url or 'so.xiaohongshu' in url) and 'search' in url:
                logger.info(f"  [DEBUG] 拦截到搜索相关API: {response.request.method} {url[:120]}")

            # 匹配搜索笔记接口（放宽条件：不限定 method，匹配 search/notes）
            if 'search/notes' in url or 'search_notes' in url:
                data = response.json()
                items = data.get('data', {}).get('items', [])
                if items:
                    for item in items:
                        note_card = item.get('note_card', {})
                        note_id = item.get('id', '') or note_card.get('note_id', '')
                        note_id = clean_note_id(note_id)
                        xsec_token = item.get('xsec_token', '')
                        title = note_card.get('display_title', '') or note_card.get('title', '')
                        if note_id and note_id not in [s[0] for s in state.search_items]:
                            state.search_items.append((note_id, xsec_token, title))
                    logger.info(f"  拦截到搜索API: +{len(items)} 条, "
                                f"累计 {len(state.search_items)} 条笔记")
                else:
                    logger.info(f"  搜索API响应无items: {json.dumps(data)[:200]}")

            # 同时捕获笔记详情（如果搜索页触发了 feed）
            elif FEED_API in url:
                try:
                    data = response.json()
                    items = data.get('data', {}).get('items', [])
                    if items and items[0].get('note_card'):
                        state.note_info = items[0]['note_card']
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"  搜索响应处理异常: {e}")

    page.on('response', search_response_handler)

    # URL 编码关键词
    encoded_keyword = quote(keyword, safe='')
    search_url = f'https://www.xiaohongshu.com/search_result?keyword={encoded_keyword}&source=web_search_result_notes'
    logger.info(f"导航到搜索页: {search_url}")
    page.goto(search_url, wait_until='domcontentloaded', timeout=60000)
    time.sleep(8)

    # 检查页面是否被重定向到登录页
    current_url = page.url
    if 'login' in current_url or 'passport' in current_url:
        logger.warning(f"页面被重定向到登录页: {current_url}")
        logger.info("请扫码登录后重试")
        page.remove_listener('response', search_response_handler)
        return []

    # 如果搜索结果不足，滚动加载更多
    scroll_attempts = 0
    max_scroll = 15
    while len(state.search_items) < count and scroll_attempts < max_scroll:
        scroll_attempts += 1
        logger.info(f"  滚动加载更多搜索结果 ({scroll_attempts}/{max_scroll}), "
                    f"当前 {len(state.search_items)}/{count}")
        try:
            page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
        except Exception:
            pass
        time.sleep(3)

    page.remove_listener('response', search_response_handler)

    results = state.search_items[:count]
    logger.info(f"搜索完成: 获取 {len(results)} 条笔记")
    for i, (nid, token, title) in enumerate(results, 1):
        logger.info(f"  [{i}] note_id={nid}, title={title[:40]}")
    return results


# ===== 评论采集 =====

def extract_note_from_page(page, note_id: str, state: CrawlState, logger) -> bool:
    """从页面初始脚本状态中提取笔记信息（兜底方案）。

    当 Feed API 未被触发时，从 window.__INITIAL_STATE__ 或 window.__NUXT__
    递归查找目标 note_id 的 note_card。
    """
    if state.note_info:
        return True

    logger.info("  Feed API 未捕获到笔记信息，尝试从页面状态提取...")

    # 用 json.dumps 生成安全的 JS 字符串字面量，避免 note_id 含引号/反斜杠破坏脚本或注入
    nid_js = json.dumps(note_id)

    extract_js = f"""
    () => {{
        const nid = {nid_js};

        function findNoteCard(root, targetId) {{
            // BFS 广度优先迭代遍历，避免递归栈溢出
            const queue = [root];
            const visited = new WeakSet();

            while (queue.length > 0) {{
                const obj = queue.shift();
                if (!obj || typeof obj !== 'object') continue;
                if (visited.has(obj)) continue;
                visited.add(obj);

                // 检查当前对象是否是目标 note_card
                if (obj.note_card && obj.id === nid) {{
                    return obj.note_card;
                }}
                if (obj.id === nid && obj.desc && obj.title) {{
                    return obj;
                }}
                if (obj.noteId === nid && obj.content) {{
                    return obj;
                }}
                // 将所有属性加入队列继续查找
                // 限制队列长度避免处理过大对象
                let count = 0;
                for (const k in obj) {{
                    if (count > 5000) break; // 安全限制
                    if (typeof obj[k] === 'object' && obj[k] !== null) {{
                        queue.push(obj[k]);
                        count++;
                    }}
                }}
            }}
            return null;
        }}

        // 尝试各种全局状态入口
        const stateCandidates = [
            window.__INITIAL_STATE__,
            window.__NUXT__,
            window.__NUXT__?.state,
            window.__INITIAL_STATE__?.note,
            window.___INITIAL_STATE__
        ];

        for (const state of stateCandidates) {{
            if (!state) continue;
            const found = findNoteCard(state, nid);
            if (found) {{
                console.log('Found note in page state');
                return JSON.stringify(found);
            }}
        }}

        // 尝试找页面内 script 标签中的 JSON
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {{
            const content = script.textContent || '';
            if (content.includes(nid) && content.length > 100 && content.length < 1000000) {{
                try {{
                    // 搜索包含 note_id 的 JSON 对象
                    const regex = new RegExp('\\\\{{[^}}]*id["\\\\\\s:]*"' + nid + '"[^}}]*\\\\}}', 'i');
                    const match = content.match(regex);
                    if (match) {{
                        const obj = JSON.parse(match[0]);
                        if (obj.note_card || (obj.desc && obj.title)) {{
                            return JSON.stringify(obj.note_card || obj);
                        }}
                    }}
                }} catch(e) {{}}
            }}
        }}

        return null;
    }}
    """
    try:
        result = page.evaluate(extract_js)
        if result:
            note_card = json.loads(result)
            if note_card and (note_card.get('desc') or note_card.get('title')):
                state.note_info = note_card
                logger.info("  ✓ 从页面初始状态成功提取笔记信息")
                return True
    except Exception as e:
        logger.warning(f"  从页面提取笔记失败: {e}")

    return False


def get_note_info_sync(page, note_url: str, note_id: str, xsec_token: str,
                       xsec_source: str, state: CrawlState, logger) -> bool:
    """前置步骤：获取笔记详尽信息。

    XHS 笔记页使用客户端渲染 + 延迟加载，API 拦截方式不可靠。
    改为直接从页面 DOM 和元数据提取：
      1. 导航到笔记页
      2. 等待页面渲染稳定
      3. 从 document.title / meta 标签提取标题和描述
      4. 从 page evaluate 提取 notes_info 作为 note_card
    """
    logger.info(f"  打开笔记页获取详情: {note_url}")
    page.goto(note_url, wait_until='domcontentloaded', timeout=60000)
    time.sleep(5)  # 等待 JS 渲染

    # 尝试滚动触发延迟加载
    for pos in [0.3, 0.6, 0.9]:
        try:
            page.evaluate(f'window.scrollTo(0, document.body.scrollHeight * {pos})')
        except Exception:
            pass
        time.sleep(1.5)

    # 从 DOM 提取笔记信息（meta + page title + page state）
    extract_js = f"""
    () => {{
        const result = {{}};
        result.title = document.title || '';

        // meta tags
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) result.og_title = ogTitle.content;
        const ogDesc = document.querySelector('meta[name="description"]');
        if (ogDesc) result.og_desc = ogDesc.content;
        const ogImg = document.querySelector('meta[property="og:image"]');
        if (ogImg) result.og_image = ogImg.content;

        // 寻找页面上可见的标题元素
        const titleEls = document.querySelectorAll(
            'h1, h2, [class*="title"], [class*="Title"], [id*="title"]'
        );
        for (const el of titleEls) {{
            if (el.offsetParent !== null && el.textContent.trim().length > 3) {{
                result.visible_title = el.textContent.trim();
                break;
            }}
        }}

        // 寻找页面上可见的描述/正文
        const descEls = document.querySelectorAll(
            'span[class*="desc"], div[class*="desc"], [class*="content"], ' +
            '[class*="Content"], article p'
        );
        for (const el of descEls) {{
            if (el.offsetParent !== null && el.textContent.trim().length > 5) {{
                result.visible_desc = el.textContent.trim();
                break;
            }}
        }}

        return JSON.stringify(result);
    }}
    """
    try:
        dom_info = json.loads(page.evaluate(extract_js))
        title = dom_info.get('visible_title') or dom_info.get('og_title') or dom_info.get('title', '')
        desc = dom_info.get('og_desc') or dom_info.get('visible_desc') or ''
        if title and not state.note_info:
            state.note_info = {
                'title': title,
                'display_title': title,
                'desc': desc,
                'note_id': note_id,
                'user': {'nickname': ''},
            }
            logger.info(f"  ✓ 从 DOM 提取笔记信息: title={title[:40]}")
    except Exception as e:
        logger.warning(f"  DOM 提取失败: {e}")

    # 兜底：从页面初始状态提取
    if not state.note_info:
        extract_note_from_page(page, note_id, state, logger)

    return bool(state.note_info)


def crawl_note_comments(page, note_url: str, note_id: str, max_comments: int,
                        state: CrawlState, logger) -> list:
    """采集单篇笔记的评论。

    导航到笔记页，通过 response 拦截捕获评论 API 响应，滚动触发分页。
    前置：get_note_info_sync 已经获取了笔记详情与首屏 API 评论，二者分别保存在
    state.note_info / state.comments 中，本函数直接沿用（见下方 all_comments 初值），
    不再单独转存副本。
    """
    state.cursors = []
    state.has_more = True

    # 评论拦截 handler
    def comment_response_handler(response):
        url = response.url
        try:
            if COMMENT_API in url:
                data = response.json()
                d = data.get('data', {})
                comments = d.get('comments', [])
                cursor = d.get('cursor', '')
                has_more = d.get('has_more', False)

                if comments:
                    for c in comments:
                        cid = c.get('id', '')
                        if cid and not any(ec.get('id') == cid for ec in state.comments):
                            state.comments.append(c)

                if cursor:
                    state.cursors.append(cursor)
                state.has_more = has_more
                logger.info(f"  拦截评论API: +{len(comments)}条, "
                            f"累计{len(state.comments)}, has_more={has_more}")

            # 仍然监听 Feed API 作为补充
            elif FEED_API in url and not state.note_info:
                try:
                    data = response.json()
                    items = data.get('data', {}).get('items', [])
                    if items and items[0].get('note_card'):
                        state.note_info = items[0]['note_card']
                except Exception:
                    pass
        except Exception:
            pass

    page.on('response', comment_response_handler)

    # 如果页面还没加载，重新导航
    if not state.note_info:
        logger.info(f"打开笔记页: {note_url}")
        page.goto(note_url, wait_until='domcontentloaded', timeout=60000)
        time.sleep(5)

        # 等待笔记详情 API
        for _ in range(15):
            time.sleep(1)
            if state.note_info:
                break

    note_title = ''
    note_desc = ''
    if state.note_info:
        note_title = (state.note_info.get('title', '') or
                      state.note_info.get('display_title', '') or '')
        note_desc = state.note_info.get('desc', '') or ''
        logger.info(f"笔记标题: {note_title}")

    # 滚动 + DOM 提取评论（XHS 评论通过滚动触发延迟加载）
    logger.info(f"采集评论（目标 {max_comments} 条，DOM 提取）")

    last_count = 0
    scroll_round = 0
    stale_rounds = 0
    max_stale = 15

    def extract_comments_js():
        """从页面 DOM 提取所有可见评论内容。

        策略3（全 span 兜底扫描）默认关闭：它会把标题、正文、点赞数、UI 文案
        一并当作评论，造成数据污染；且无法确定绝对安全的评论容器选择器。
        仅在明确需要兜底时通过 ENABLE_SPAN_FALLBACK 打开，且只在评论容器内提取。
        """
        return page.evaluate("""
            (opt) => {
                const comments = [];
                const seen = new Set();

                // 策略1：查找包含文本的、可见的评论容器
                const candidates = document.querySelectorAll(
                    '[class*="comment"] [class*="content"], ' +
                    '[class*="comment"] [class*="text"], ' +
                    '[class*="Comment"] [class*="text"], ' +
                    '[class*="Comment"] [class*="content"], ' +
                    '[class*="reply"] [class*="text"], ' +
                    '[class*="review-item"] [class*="text"], ' +
                    'div[class*="comment-item"] > span, ' +
                    'div[class*="comment-text"], ' +
                    'li[class*="comment"] span[class*="text"], ' +
                    'div[class*="note-comment"] [class*="text"]'
                );

                for (const el of candidates) {
                    const txt = el.textContent.trim();
                    if (txt.length >= 4 && !seen.has(txt)) {
                        seen.add(txt);
                        comments.push(txt);
                    }
                }

                // 策略2：如果上面没找到，尝试更广泛的搜索
                if (comments.length === 0) {
                    const allDivs = document.querySelectorAll('[class*="comment"]');
                    for (const div of allDivs) {
                        const txt = div.textContent.trim();
                        if (txt.length >= 4 && txt.length <= 2000 && !seen.has(txt)) {
                            seen.add(txt);
                            comments.push(txt);
                        }
                    }
                }

                // 策略3：兜底扫描 span（默认关闭，见 ENABLE_SPAN_FALLBACK）
                if (opt.enableSpanFallback && comments.length === 0) {
                    // 严格限制在评论/回复容器内，避免把标题、正文、点赞数、UI 文案当成评论
                    const spans = document.querySelectorAll(
                        '[class*="comment"] span, [class*="Comment"] span, ' +
                        '[class*="reply"] span, [class*="review-item"] span'
                    );
                    for (const span of spans) {
                        const txt = span.textContent.trim();
                        if (txt.length >= 4 && txt.length <= 2000 && !seen.has(txt)) {
                            seen.add(txt);
                            comments.push(txt);
                        }
                    }
                }

                return comments;
            }
        """, {"enableSpanFallback": ENABLE_SPAN_FALLBACK})

    # 先等待页面加载
    logger.info("等待页面渲染并触发评论加载...")
    try:
        page.wait_for_load_state('domcontentloaded', timeout=15000)
    except Exception:
        pass
    time.sleep(3)

    # 滚动触发首屏评论
    for pos in [0.4, 0.7, 0.85, 1.0]:
        try:
            page.evaluate(f'window.scrollTo(0, document.body.scrollHeight * {pos})')
        except Exception:
            pass
        time.sleep(1.5)

    # 合并 API 捕获的评论（dict，含 get_note_info_sync 阶段已入 state.comments 的首屏评论）
    # 与 DOM 提取的评论（str），统一为 {id, content} 结构
    all_comments = list(state.comments)
    seen_ids = {c.get('id') for c in all_comments if c.get('id')}
    seen_contents = {(c.get('content') or '').strip() for c in all_comments}

    def add_comment(cid, content):
        """按 id + 内容去重后加入 all_comments，返回是否新增。"""
        content = (content or '').strip()
        if not content or content in seen_contents or (cid and cid in seen_ids):
            return False
        if cid:
            seen_ids.add(cid)
        seen_contents.add(content)
        all_comments.append({'id': cid or f'dom_{len(all_comments) + 1}', 'content': content})
        return True

    # 主循环：滚动 + DOM 提取
    while len(all_comments) < max_comments and stale_rounds < max_stale:
        scroll_round += 1

        # 点击"查看更多评论"按钮
        try:
            page.evaluate("""
                () => {
                    const btns = document.querySelectorAll('button, span, div');
                    const keywords = ['查看更多', '全部回复', '查看全部', '展开回复', '展开评论', '加载更多', '展开'];
                    for (const btn of btns) {
                        if (btn.offsetParent === null) continue;
                        const t = btn.textContent.trim();
                        if (t.length < 30 && keywords.some(k => t.includes(k))) {
                            btn.click();
                            return t;
                        }
                    }
                    return '';
                }
            """)
        except Exception:
            pass

        # 滚动到页面底部和容器内部
        try:
            page.evaluate("""
                () => {
                    window.scrollTo(0, document.body.scrollHeight);
                    const containers = document.querySelectorAll(
                        '[class*="scroll"],[class*="list"],[class*="comment"]'
                    );
                    for (const c of containers) {
                        try { c.scrollTop = c.scrollHeight; } catch(e) {}
                    }
                }
            """)
        except Exception:
            pass

        try:
            page.mouse.wheel(0, 1500)
        except Exception:
            pass
        time.sleep(2)

        # 从 DOM 提取评论
        try:
            dom_comments = extract_comments_js()
            for c in dom_comments:
                add_comment('', c)
        except Exception as e:
            logger.warning(f"  DOM 提取异常: {e}")

        new_added = len(all_comments) - last_count
        if new_added > 0:
            stale_rounds = 0
            last_count = len(all_comments)
            logger.info(f"  第{scroll_round}轮: +{new_added}, 累计{len(all_comments)}/{max_comments}")
        else:
            stale_rounds += 1
            logger.info(f"  第{scroll_round}轮: 无新数据 ({stale_rounds}/{max_stale})")
            time.sleep(1)

    logger.info(f"采集完成: {len(all_comments)} 条评论")

    # 统一结构（API 与 DOM 结果已按 id+内容去重）后回写 state，避免重复计数
    state.comments = all_comments

    # 收尾：移除 response 监听器，避免批量模式下监听器累积、回调重复触发
    page.remove_listener('response', comment_response_handler)
    return all_comments


# ===== 保存结果 =====

def save_note_results(comments: list, state: CrawlState, note_id: str,
                      note_url: str, keyword: str, session_dir: str, logger):
    """保存单篇笔记的采集结果到 session_dir。"""
    os.makedirs(os.path.join(session_dir, 'comments'), exist_ok=True)
    os.makedirs(os.path.join(session_dir, 'output'), exist_ok=True)

    note_info = state.note_info or {}
    note_title = (note_info.get('title', '') or
                  note_info.get('display_title', '') or note_id)
    note_desc = note_info.get('desc', '') or ''

    # 1. 笔记内容
    note_content_path = os.path.join(session_dir, 'note_content.txt')
    with open(note_content_path, 'w', encoding='utf-8') as f:
        f.write(f"标题: {note_title}\n")
        f.write(f"作者: {note_info.get('user', {}).get('nickname', '')}\n")
        f.write(f"笔记ID: {note_id}\n")
        f.write(f"URL: {note_url}\n")
        f.write(f"采集时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"{'='*50}\n\n")
        f.write(note_desc if note_desc else '(无描述内容)')
    logger.info(f"笔记内容已保存: {note_content_path}")

    # 2. 元数据
    meta = {
        'note_id': note_id,
        'note_title': note_title,
        'note_desc': note_desc,
        'url': note_url,
        'keyword': keyword,
        'scrape_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'total_collected': len(comments),
        'note_info': note_info,
    }
    with open(os.path.join(session_dir, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    # 3. comments.csv
    csv_path = os.path.join(session_dir, 'comments', 'comments.csv')
    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['序号', '评论内容'])
        for i, c in enumerate(comments, 1):
            content = (c.get('content') or '').strip()
            if content:
                writer.writerow([i, content])

    # 4. output.csv（12字段）
    fieldnames = ["序号", "平台", "游戏名称", "评论内容",
                  "情绪倾向", "情绪关键词", "是否提及治愈", "治愈相关度",
                  "治愈感受细分", "吸引游玩因素", "判断依据", "复核调整说明"]
    output_csv = os.path.join(session_dir, 'output', 'output.csv')
    with open(output_csv, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for i, c in enumerate(comments, 1):
            content = (c.get('content') or '').strip()
            # 游戏名称使用搜索关键词 keyword，不是笔记标题
            game_name = keyword if keyword else note_title or note_id
            writer.writerow({'序号': i, '平台': '小红书',
                             '游戏名称': game_name,
                             '评论内容': content})

    logger.info(f"保存完成: 评论{len(comments)}条, output.csv={output_csv}")
    return output_csv


# ===== 主入口 =====

def main():
    parser = argparse.ArgumentParser(description='小红书搜索+评论采集（扫码登录+Playwright拦截）')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--search', type=str, help='搜索关键词（搜索模式）')
    mode.add_argument('--url', type=str, help='笔记链接（单笔记模式）')
    mode.add_argument('--batch-file', type=str, help='批量搜索：文件路径，每行一个游戏名')
    parser.add_argument('--note-count', type=int, default=15, help='每游戏采集前N条笔记（默认15）')
    parser.add_argument('--max-comments', type=int, default=8, help='每篇笔记目标评论数（默认8）')
    args = parser.parse_args()

    if not args.search and not args.url and not args.batch_file:
        parser.print_help()
        return

    ts = datetime.now().strftime('%Y%m%d_%H%M%S')

    # 确定搜索关键词列表
    if args.batch_file:
        with open(args.batch_file, 'r', encoding='utf-8') as f:
            keywords = [line.strip() for line in f if line.strip()]
    elif args.search:
        keywords = [args.search]
    else:
        keywords = []

    session_prefix = keywords[0] if keywords else parse_note_id(args.url)
    log_dir = os.path.join(REPORTS_DIR, f"batch_{session_prefix}_{ts}")
    logger = create_logger(log_dir, ts)

    logger.info(f"模式: {'批量搜索' if args.batch_file else ('搜索' if args.search else '单笔记')}")
    if keywords:
        logger.info(f"搜索关键词数: {len(keywords)}")
        for k in keywords:
            logger.info(f"  - {k}")
    logger.info(f"每游戏笔记数: {args.note_count}")
    logger.info(f"每笔记评论数: {args.max_comments}")

    from playwright.sync_api import sync_playwright

    state = CrawlState()

    with sync_playwright() as p:
        logger.info("启动 Edge 浏览器...")
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

        # ===== 登录 =====
        logged_in = ensure_login(page, context, logger)
        if not logged_in:
            logger.error("登录失败，无法继续采集")
            browser.close()
            return

        if keywords:
            # ===== 搜索模式（单关键词/批量文件） =====
            for kidx, keyword in enumerate(keywords, 1):
                logger.info(f"\n{'='*60}")
                logger.info(f"关键词 {kidx}/{len(keywords)}: {keyword}")
                logger.info(f"{'='*60}")

                state.reset_all()
                notes = search_notes(page, keyword, args.note_count, state, logger)

                if not notes:
                    logger.warning(f"「{keyword}」未获取到搜索结果，跳过")
                    continue

                # ===== 逐笔记采集评论 =====
                success_count = 0
                for idx, (note_id, xsec_token, title) in enumerate(notes, 1):
                    logger.info(f"\n{'─'*50}")
                    logger.info(f"笔记 {idx}/{len(notes)}: {title[:40]} (note_id={note_id})")
                    logger.info(f"{'─'*50}")

                    # 构建笔记 URL
                    if xsec_token:
                        note_url = (f"https://www.xiaohongshu.com/discovery/item/{note_id}"
                                    f"?xsec_token={xsec_token}&xsec_source=pc_search")
                    else:
                        note_url = f"https://www.xiaohongshu.com/discovery/item/{note_id}"

                    note_ts = datetime.now().strftime('%Y%m%d_%H%M%S')
                    note_session = f"{note_id}_{note_ts}"
                    session_dir = os.path.join(OUTPUT_DIR, note_id, note_session)

                    try:
                        get_note_info_sync(page, note_url, note_id, xsec_token, "pc_search", state, logger)
                        comments = crawl_note_comments(
                            page, note_url, note_id, args.max_comments, state, logger)
                        save_note_results(
                            comments, state, note_id, note_url, keyword, session_dir, logger)
                        success_count += 1
                    except Exception as e:
                        logger.error(f"笔记 {note_id} 采集失败: {e}")

                    if idx < len(notes):
                        time.sleep(3)

                logger.info(f"\n  → 「{keyword}」完成: {success_count}/{len(notes)} 篇笔记成功")

        elif args.url:
            # ===== 单笔记模式 =====
            note_id = parse_note_id(args.url)
            xsec_token = extract_xsec_token(args.url)
            if 'xsec_source=pc_share' in args.url or 'source=webshare' in args.url:
                xsec_source = 'pc_share'
            elif 'xsec_source=pc_search' in args.url:
                xsec_source = 'pc_search'
            else:
                xsec_source = 'pc_share'
            note_ts = datetime.now().strftime('%Y%m%d_%H%M%S')
            note_session = f"{note_id}_{note_ts}"
            session_dir = os.path.join(OUTPUT_DIR, note_id, note_session)

            get_note_info_sync(page, args.url, note_id, xsec_token, xsec_source, state, logger)
            comments = crawl_note_comments(
                page, args.url, note_id, args.max_comments, state, logger)
            save_note_results(
                comments, state, note_id, args.url, '', session_dir, logger)

        # 更新 Cookie
        cookies = context.cookies()
        with open(COOKIES_FILE, 'wb') as f:
            pickle.dump(cookies, f)
        browser.close()
        logger.info("浏览器已关闭")

    print(f"\n{'='*60}")
    print(f"  采集完成!")
    print(f"  日志: {log_dir}")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
