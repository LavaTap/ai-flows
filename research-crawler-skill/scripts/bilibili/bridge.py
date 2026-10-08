# -*- coding: utf-8 -*-
"""
B站视频搜索 + 热度评论采集 + 基础清洗 工作流编排器

支持两阶段运行：
  阶段一（搜索）: --search-only
    搜索视频 → 保存链接清单 → 保存搜索元数据 → 退出
    （由 AI 将链接发送给用户确认后，再执行阶段二）
  阶段二（采集）: --crawl-only --session-dir <path>
    读取搜索元数据 → 逐视频采集评论 → 清洗 → 提取纯文本 → 生成报告
  完整流程（不分阶段）: 不加 --search-only / --crawl-only
    搜索 + 采集一气呵成（不暂停确认）

会话目录: output/bilibili/{关键词}/{关键词}_{时间戳}/
目录结构：
    output/bilibili/鸣潮/鸣潮_20260722_212543/
    ├── link/video_links.txt
    ├── search_result.json
    ├── raw/BVxxx.csv
    ├── comments/comments.csv
    └── output/BVxxx_clean.csv

用法（venv 下）：
    # 阶段一：搜索
    python research-crawler-skill/scripts/bridge.py --keyword 鸣潮 --video-count 10 --search-only

    # 阶段二：采集（用户确认链接后）
    python research-crawler-skill/scripts/bridge.py --crawl-only --session-dir output/鸣潮/鸣潮_20260722_212543 --keyword 鸣潮 --comment-count 100

    # 完整流程
    python research-crawler-skill/scripts/bridge.py --keyword 鸣潮 --video-count 10 --comment-count 100
"""
import argparse
import csv
import glob
import hashlib
import json
import logging
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime

import requests

# ============ 路径 ============
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)

OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output', 'bilibili')
REPORTS_DIR = os.path.join(PROJECT_ROOT, 'reports', 'bilibili', 'program')

# 显示用（报告标识来源平台）
PLATFORM = 'bilibili'

# SKILL 输出字段（4 基础 + 8 AI分析留空）
FIELDNAMES_SKILL = [
    "序号", "平台", "游戏名称", "评论内容",
    "情绪倾向", "情绪关键词", "是否提及治愈", "治愈相关度",
    "治愈感受细分", "吸引游玩因素", "判断依据", "复核调整说明",
]

# 原始 CSV 字段（保留爬虫客观字段）
FIELDNAMES_RAW = ['编号', '昵称', '用户ID', '评论内容', '发布时间', '点赞数']

# CSV 内"平台"字段值
PLATFORM_LABEL = 'B站'


def build_session_dir(keyword: str, ts: str) -> str:
    """构建会话目录 ``output/{关键词}/{关键词}_{时间戳}/``。

    Args:
        keyword: 搜索关键词。
        ts: 时间戳字符串（格式 ``YYYYMMDD_HHMMSS``）。

    Returns:
        创建的会话目录绝对路径。
    """
    session_name = f'{keyword}_{ts}'
    session_dir = os.path.join(OUTPUT_DIR, keyword, session_name)
    os.makedirs(session_dir, exist_ok=True)
    return session_dir


# ============ WBI 签名搜索 ============

MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 37, 12, 52, 56, 7,
    0, 16, 38, 11, 61, 1, 57, 20, 54, 34, 6, 63, 40, 55, 51, 17,
    22, 44, 36, 26, 59, 13, 48, 41, 30, 39, 4, 24, 21, 60, 25, 62,
]


def get_mixin_key(orig: str) -> str:
    """根据 WBI 签名加密表获取混合密钥。

    使用预定义的 `MIXIN_KEY_ENC_TAB` 对输入字符串重新排列，
    取前 32 字符作为 WBI 签名的 mixin_key。

    Args:
        orig: 原始密钥字符串（img_key + sub_key 拼接）。

    Returns:
        重排后的 32 字符混合密钥。
    """
    return ''.join(orig[i] for i in MIXIN_KEY_ENC_TAB if i < len(orig))[:32]


def enc_wbi(params: dict, img_key: str, sub_key: str) -> dict:
    mixin_key = get_mixin_key(img_key + sub_key)
    params = dict(sorted(params.items()))
    query = urllib.parse.urlencode(params)
    w_rid = hashlib.md5((query + mixin_key).encode()).hexdigest()
    params['w_rid'] = w_rid
    return params


def get_wbi_keys(s: requests.Session):
    """从 B 站导航接口获取 WBI 签名所需的 img_key 和 sub_key。

    Args:
        s: 已配置 User-Agent 的 requests Session。

    Returns:
        (img_key, sub_key) 二元组。
    """
    r = s.get('https://api.bilibili.com/x/web-interface/nav')
    d = r.json()['data']['wbi_img']
    return d['img_url'].rsplit('/', 1)[-1].split('.')[0], d['sub_url'].rsplit('/', 1)[-1].split('.')[0]


def search_videos(keyword: str, page: int = 1, page_size: int = 20, order: str = 'click'):
    """搜索 B 站视频，返回按指定排序的视频信息列表。

    使用 WBI 签名调用 B 站搜索 API，解析结果并清洗标题中的 HTML 标签。

    Args:
        keyword: 搜索关键词。
        page: 页码。默认为 1。
        page_size: 每页条数。默认为 20。
        order: 排序方式，``click`` 表示按播放量排序。默认为 ``click``。

    Returns:
        视频信息字典列表，每项包含 ``bvid``、``title``、``play``、``author``、``url``。
    """
    s = requests.Session()
    s.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
    })
    img_key, sub_key = get_wbi_keys(s)
    params = {
        'keyword': keyword,
        'search_type': 'video',
        'page': page,
        'ps': page_size,
        'order': order,
        'wts': int(time.time()),
    }
    signed = enc_wbi(params, img_key, sub_key)
    r = s.get('https://api.bilibili.com/x/web-interface/wbi/search/type', params=signed)
    data = r.json()
    if data.get('code') != 0:
        logging.error("搜索API错误: %s", data)
        return []

    videos = []
    for item in data.get('data', {}).get('result', []):
        bvid = item.get('bvid', '')
        title = re.sub(r'<[^>]+>', '', item.get('title', ''))
        play = item.get('play', 0)
        author = item.get('author', '')
        videos.append({
            'bvid': bvid,
            'title': title,
            'play': play,
            'author': author,
            'url': f'https://www.bilibili.com/video/{bvid}',
        })
    return videos


# ============ 链接保存 ============

def save_video_links(videos: list, keyword: str, session_dir: str):
    """将视频链接清单写入 ``{session_dir}/link/video_links.txt``。

    文件包含关键词、生成时间，以及按播放量排序的每视频标题、UP 主、BVID 和链接。

    Args:
        videos: 视频信息字典列表。
        keyword: 搜索关键词。
        session_dir: 会话目录路径。

    Returns:
        生成的链接文件绝对路径。
    """
    out_dir = os.path.join(session_dir, 'link')
    os.makedirs(out_dir, exist_ok=True)
    link_path = os.path.join(out_dir, 'video_links.txt')
    with open(link_path, 'w', encoding='utf-8') as f:
        f.write(f'# 关键词: {keyword}\n')
        f.write(f'# 生成时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}\n')
        f.write(f'# 视频数: {len(videos)}\n\n')
        for i, v in enumerate(videos, 1):
            f.write(f'{i}. {v["title"]}\n')
            f.write(f'   播放: {v["play"]:,}  UP主: {v["author"]}  BVID: {v["bvid"]}\n')
            f.write(f'   {v["url"]}\n\n')
    logging.info("视频链接已保存: %s (%d 个)", link_path, len(videos))
    return link_path


def save_search_result(videos: list, keyword: str, ts: str, video_count: int, session_dir: str):
    """保存搜索元数据到 {会话目录}/search_result.json（供阶段二读取）"""
    path = os.path.join(session_dir, 'search_result.json')
    data = {
        'keyword': keyword,
        'timestamp': ts,
        'video_count': video_count,
        'videos': videos,
    }
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    logging.info("搜索元数据已保存: %s", path)
    return path


def load_search_result(session_dir: str):
    """从 {会话目录}/search_result.json 读取搜索元数据"""
    path = os.path.join(session_dir, 'search_result.json')
    if not os.path.exists(path):
        logging.error("找不到搜索元数据: %s", path)
        return None
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


# ============ 评论获取 ============

def get_aid_by_bvid(bvid: str, s: requests.Session) -> int:
    """通过 BVID 获取视频对应的 AID。

    调用 B 站视频详情 API ``/x/web-interface/view`` 获取 aid。

    Args:
        bvid: 视频 BVID（如 ``BV1xx411c7mD``）。
        s: 已配置的 requests Session。

    Returns:
        视频的 AID 整数；失败时返回 ``None``。
    """
    r = s.get(f'https://api.bilibili.com/x/web-interface/view?bvid={bvid}')
    data = r.json()
    if data.get('code') != 0:
        logging.error("获取aid失败: %s", data)
        return None
    return data['data']['aid']


def fetch_comments(bvid: str, max_count: int = 100):
    """
    通过 B站评论API /x/v2/reply/main 获取评论（无需登录）
    mode=3 按热度排序，cursor.next 翻页
    """
    s = requests.Session()
    s.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': f'https://www.bilibili.com/video/{bvid}',
    })

    aid = get_aid_by_bvid(bvid, s)
    if aid is None:
        return []

    logging.info("视频 bvid=%s, aid=%s", bvid, aid)
    logging.info("正在获取 %d 条热度评论...", max_count)

    comments = []
    seen_rpids = set()
    next_val = 0
    page = 0

    while len(comments) < max_count:
        page += 1
        params = {
            'type': 1,
            'oid': aid,
            'mode': 3,
            'next': next_val,
        }
        r = s.get('https://api.bilibili.com/x/v2/reply/main', params=params)
        try:
            data = r.json()
        except requests.exceptions.JSONDecodeError:
            logging.error("无法解析返回的数据，可能被风控拦截或Cookie失效（返回了HTML拦截页）。")
            logging.error("HTTP 状态码: %s", r.status_code)
            logging.error("返回内容前500字符: %s", r.text[:500])
            break

        if data.get('code') != 0:
            logging.error("评论API错误: code=%s, msg=%s", data.get('code'), data.get('message'))
            break

        cursor = data.get('data', {}).get('cursor', {})
        replies = data.get('data', {}).get('replies', [])
        total = cursor.get('all_count', 0)

        new_this_page = 0
        for reply in replies:
            if len(comments) >= max_count:
                break
            rpid = reply.get('rpid', 0)
            if rpid in seen_rpids:
                continue
            seen_rpids.add(rpid)
            new_this_page += 1

            member = reply.get('member', {})
            uname = member.get('uname', '')
            mid = member.get('mid', '')
            content_obj = reply.get('content', {})
            message = content_obj.get('message', '')
            like = reply.get('like', 0)
            ctime = reply.get('ctime', 0)
            time_str = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(ctime)) if ctime else ''

            comments.append({
                'rpid': rpid,
                'uname': uname,
                'mid': mid,
                'message': message,
                'like': like,
                'time': time_str,
            })

        logging.info("  第%d页: 新增%d条, 累计%d/%d (总评论数%s)", page, new_this_page, len(comments), max_count, f"{total:,}")

        if len(comments) > 0 and len(comments) % 100 < new_this_page and len(comments) >= 100:
            logging.info("已累计获取达到 100 条倍数，暂停 5 秒防风控...")
            time.sleep(5)

        if cursor.get('is_end'):
            logging.info("已到最后一页。")
            break
        next_val = cursor.get('next', next_val + 1)
        time.sleep(0.5)

    return comments


def save_raw_csv(bvid: str, comments: list, session_dir: str):
    """保存原始评论到 {会话目录}/raw/{bvid}.csv（6字段）"""
    out_dir = os.path.join(session_dir, 'raw')
    os.makedirs(out_dir, exist_ok=True)
    csv_path = os.path.join(out_dir, f'{bvid}.csv')
    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES_RAW)
        writer.writeheader()
        for i, c in enumerate(comments, 1):
            writer.writerow({
                '编号': i,
                '昵称': c['uname'],
                '用户ID': c['mid'],
                '评论内容': c['message'],
                '发布时间': c['time'],
                '点赞数': c['like'],
            })
    logging.info("原始评论已保存: %s (%d 条)", csv_path, len(comments))
    return csv_path


# ============ 基础清洗 ============

def strip_meta(text: str) -> str:
    """去除 @回复 等元信息"""
    t = re.sub(r'回复\s*@[^：:\s]+[：:]\s*', '', text)
    t = re.sub(r'@\S+\s*', '', t)
    return t.strip()


def normalize_whitespace(text: str) -> str:
    """规范化空白：所有换行替换为空格，合并连续空格/tab，使评论为单行。

    - 所有换行符（``\\r\\n`` / ``\\r`` / ``\\n``）替换为空格
    - 合并连续空格/tab 为单个空格
    - 去除首尾空白
    """
    t = text.replace('\r\n', ' ').replace('\r', ' ').replace('\n', ' ')
    t = re.sub(r'[ \t]+', ' ', t)
    return t.strip()


def basic_clean(comments: list):
    """
    基础清洗：去 rpid 重复 / 去空 / 去 @回复 / 去纯表情单字 / 去空行合并空白
    返回 (清洗后列表, 丢弃数)
    """
    seen = set()
    cleaned = []
    dropped = 0
    for c in comments:
        rpid = c.get('rpid')
        if rpid in seen:
            dropped += 1
            continue
        seen.add(rpid)

        msg = c.get('message', '') or ''
        pure = strip_meta(msg)
        # 规范化空白：去除空行、合并连续空格
        pure = normalize_whitespace(pure)
        no_emoji = re.sub(r'\[.*?\]', '', pure).strip()
        if not pure:
            dropped += 1
            continue
        if len(no_emoji) <= 1:
            dropped += 1
            continue

        cleaned.append({
            'rpid': rpid,
            'uname': c.get('uname', ''),
            'mid': c.get('mid', ''),
            'message': pure,
            'like': c.get('like', 0),
            'time': c.get('time', ''),
        })
    return cleaned, dropped


def save_clean_csv(bvid: str, cleaned: list, keyword: str, session_dir: str):
    """将清洗后的评论保存为 SKILL 12 字段 CSV。

    写入 ``{session_dir}/raw/clean/{bvid}_clean.csv``，包含：
    - 4 个基础字段：序号、平台、游戏名称、评论内容
    - 8 个 AI 分析字段（留空，供后续 `process_comments.py` 填充）

    Args:
        bvid: 视频 BVID，用于命名文件。
        cleaned: 清洗后的评论字典列表。
        keyword: 搜索关键词（填入游戏名称字段）。
        session_dir: 会话目录路径。

    Returns:
        生成的 CSV 文件绝对路径。
    """
    out_dir = os.path.join(session_dir, 'raw', 'clean')
    os.makedirs(out_dir, exist_ok=True)
    csv_path = os.path.join(out_dir, f'{bvid}_clean.csv')
    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES_SKILL)
        writer.writeheader()
        for i, c in enumerate(cleaned, 1):
            writer.writerow({
                '序号': i,
                '平台': PLATFORM_LABEL,
                '游戏名称': keyword,
                '评论内容': c['message'],
                '情绪倾向': '',
                '情绪关键词': '',
                '是否提及治愈': '',
                '治愈相关度': '',
                '治愈感受细分': '',
                '吸引游玩因素': '',
                '判断依据': '',
                '复核调整说明': '',
            })
    logging.info("清洗后评论已保存: %s (%d 条, SKILL 12字段)", csv_path, len(cleaned))
    return csv_path


# ============ 合并清洗CSV ============

def merge_clean_csvs(session_dir: str, keyword: str, ts: str):
    """合并会话内所有视频的清洗 CSV 为一个完整 CSV。

    读取 ``{session_dir}/raw/clean/*_clean.csv``，
    合并为 ``{session_dir}/output/output.csv``。
    每个视频的每行评论保留，序号全局递增。

    Args:
        session_dir: 会话目录。
        keyword: 关键词（保留参数兼容）。
        ts: 时间戳（保留参数兼容）。

    Returns:
        合并后的 CSV 路径，若无数据则返回 ``None``。
    """
    clean_dir = os.path.join(session_dir, 'raw', 'clean')
    pattern = os.path.join(clean_dir, '*_clean.csv')
    clean_files = sorted(glob.glob(pattern))

    if not clean_files:
        return None

    seq = 1
    rows = []
    for f in clean_files:
        with open(f, 'r', encoding='utf-8-sig') as fh:
            for row in csv.DictReader(fh):
                row['序号'] = str(seq)
                rows.append(row)
                seq += 1

    out_dir = os.path.join(session_dir, 'output')
    os.makedirs(out_dir, exist_ok=True)
    csv_path = os.path.join(out_dir, 'output.csv')
    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES_SKILL)
        writer.writeheader()
        writer.writerows(rows)

    logging.info("合并清洗CSV已保存: %s (%d 条, 来自 %d 个视频)",
                  csv_path, len(rows), len(clean_files))
    return csv_path


# ============ 纯评论提取（复用 extract_comments.py）============

def extract_comments_text(cleaned_csvs: list, session_dir: str):
    """调用 extract_comments.py 从多个清洗 CSV 提取纯评论，保存为 CSV 到 {会话目录}/comments/comments.csv"""
    sys.path.insert(0, os.path.join(SCRIPTS_DIR, 'tools'))
    from extract_comments import extract_from_csv
    csv_path, count = extract_from_csv(cleaned_csvs, session_dir)
    logging.info("纯评论CSV已保存: %s (%d 条)", csv_path, count)
    return csv_path, count


# ============ 日志与报告 ============

def setup_logging(ts: str, batch_dir: str = '', session_name: str = ''):
    """配置日志：同时输出控制台 + {batch_dir}/{时间戳}.log

    Args:
        ts: 项目时间戳。
        batch_dir: 批次目录路径。为空则自动用 reports/{session_name}（与 output 会话目录同名）。
        session_name: 会话名（{关键词}_{时间戳}），用于默认 batch_dir。
    """
    if not batch_dir:
        if session_name:
            batch_dir = os.path.join(REPORTS_DIR, session_name)
        else:
            batch_dir = os.path.join(REPORTS_DIR, f'program_{ts}')
    os.makedirs(batch_dir, exist_ok=True)
    log_path = os.path.join(batch_dir, f'{ts}.log')
    fmt = '%(asctime)s [%(levelname)s] %(message)s'
    handlers = [
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(log_path, encoding='utf-8'),
    ]
    logging.basicConfig(level=logging.INFO, format=fmt, handlers=handlers, force=True)
    return log_path


def write_report(ts: str, keyword: str, session_dir: str, videos: list,
                 crawl_stats: list, link_path: str, merge_csv: str = '',
                 batch_dir: str = '', session_name: str = ''):
    """生成 {batch_dir}/{时间戳}_report.md 摘要报告（多视频汇总）"""
    if not batch_dir:
        if session_name:
            batch_dir = os.path.join(REPORTS_DIR, session_name)
        else:
            batch_dir = os.path.join(REPORTS_DIR, f'program_{ts}')
    os.makedirs(batch_dir, exist_ok=True)
    report_path = os.path.join(batch_dir, f'{ts}_report.md')
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    total_raw = sum(s['raw'] for s in crawl_stats)
    total_clean = sum(s['clean'] for s in crawl_stats)
    total_dropped = sum(s['dropped'] for s in crawl_stats)
    total_extract = sum(s['extract'] for s in crawl_stats)

    lines = []
    lines.append(f'# B站评论采集清洗报告 — {keyword}\n')
    lines.append(f'- 生成时间: {now}')
    lines.append(f'- 时间戳: {ts}')
    lines.append(f'- 关键词: {keyword}')
    lines.append(f'- 平台: {PLATFORM}')
    lines.append(f'- 会话目录: `{session_dir}`\n')

    lines.append('## 一、搜索结果\n')
    lines.append('| 序号 | 视频标题 | 播放量 | UP主 | BVID | 链接 |')
    lines.append('| --- | --- | --- | --- | --- | --- |')
    for i, v in enumerate(videos, 1):
        title = v['title'].replace('|', '\\|')
        lines.append(f"| {i} | {title} | {v['play']:,} | {v['author']} | {v['bvid']} | [链接]({v['url']}) |")
    lines.append('')
    lines.append(f'> 链接清单文件: `{link_path}`\n')

    lines.append('## 二、评论采集统计\n')
    lines.append('| 序号 | BVID | 视频标题 | 原始 | 清洗后 | 丢弃 | 提取 |')
    lines.append('| --- | --- | --- | --- | --- | --- | --- |')
    for i, (v, s) in enumerate(zip(videos, crawl_stats), 1):
        title = v['title'].replace('|', '\\|')[:30]
        lines.append(f"| {i} | {v['bvid']} | {title} | {s['raw']} | {s['clean']} | {s['dropped']} | {s['extract']} |")
    lines.append(f"| **合计** | | | **{total_raw}** | **{total_clean}** | **{total_dropped}** | **{total_extract}** |")
    lines.append('')

    lines.append('## 三、Top5 热评预览\n')
    all_top = []
    for s in crawl_stats:
        all_top.extend(s.get('top_comments', []))
    all_top.sort(key=lambda x: x.get('like', 0), reverse=True)
    for i, c in enumerate(all_top[:5], 1):
        msg = c['message'].replace('\n', ' ')[:80]
        lines.append(f'{i}. [{c["like"]}赞] {c["uname"]}: {msg}')
    lines.append('')

    lines.append('## 四、文件清单\n')
    lines.append(f'- `{link_path}` — 视频链接清单')
    lines.append(f'- `{session_dir}/search_result.json` — 搜索元数据')
    lines.append(f'- `{session_dir}/raw/` — 原始评论CSV（每视频一个，6字段）')
    lines.append(f'- `{session_dir}/raw/clean/` — 逐视频清洗CSV（SKILL 12字段，AI字段留空）')
    if merge_csv:
        lines.append(f'- `{merge_csv}` — 全部视频合并完整数据CSV')
    lines.append(f'- `{session_dir}/comments/comments.csv` — 纯评论CSV（序号+评论内容）')

    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    logging.info("摘要报告已生成: %s", report_path)
    return report_path


def write_clean_report(ts: str, keyword: str, session_dir: str, videos: list,
                       crawl_stats: list, batch_dir: str = '', session_name: str = ''):
    """生成 {batch_dir}/{时间戳}_clean_report.log 清洗报告（脚本生成）"""
    if not batch_dir:
        if session_name:
            batch_dir = os.path.join(REPORTS_DIR, session_name)
        else:
            batch_dir = os.path.join(REPORTS_DIR, f'program_{ts}')
    os.makedirs(batch_dir, exist_ok=True)
    report_path = os.path.join(batch_dir, f'{ts}_clean_report.log')
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    total_raw = sum(s['raw'] for s in crawl_stats)
    total_clean = sum(s['clean'] for s in crawl_stats)
    total_dropped = sum(s['dropped'] for s in crawl_stats)
    total_extract = sum(s['extract'] for s in crawl_stats)

    lines = []
    lines.append('=' * 70)
    lines.append(f'清洗报告（脚本生成）— {keyword}')
    lines.append(f'生成时间: {now} | 时间戳: {ts} | 会话目录: {session_dir}')
    lines.append('=' * 70)
    lines.append('')

    lines.append('一、总体统计')
    lines.append('-' * 40)
    lines.append(f'  视频数:        {len(videos)}')
    lines.append(f'  原始评论:      {total_raw}')
    lines.append(f'  清洗后评论:    {total_clean}')
    lines.append(f'  丢弃评论:      {total_dropped} ({total_dropped/max(total_raw,1)*100:.1f}%)')
    lines.append(f'  提取评论:      {total_extract}')
    lines.append('')

    lines.append('二、逐视频清洗明细')
    lines.append('-' * 70)
    lines.append(f'{"序号":>4} {"BVID":<14} {"原始":>6} {"清洗":>6} {"丢弃":>6} {"丢弃率":>8}')
    for i, (v, s) in enumerate(zip(videos, crawl_stats), 1):
        rate = f"{s['dropped']/max(s['raw'],1)*100:.1f}%"
        lines.append(f'{i:>4} {v["bvid"]:<14} {s["raw"]:>6} {s["clean"]:>6} {s["dropped"]:>6} {rate:>8}')
    lines.append(f'{"合计":>4} {"":<14} {total_raw:>6} {total_clean:>6} {total_dropped:>6}')
    lines.append('')

    lines.append('三、清洗规则说明')
    lines.append('-' * 40)
    lines.append('  1. 去重：相同 rpid 的评论只保留一条')
    lines.append('  2. 去空：评论内容为空或纯空白的丢弃')
    lines.append('  3. 去@回复：以 @ 开头的回复丢弃')
    lines.append('  4. 去纯表情：仅含单个表情符号的丢弃')
    lines.append('')

    lines.append('四、文件清单')
    lines.append('-' * 70)
    for root, dirs, files in os.walk(session_dir):
        for fname in sorted(files):
            fpath = os.path.join(root, fname)
            size = os.path.getsize(fpath)
            rel = os.path.relpath(fpath, session_dir)
            lines.append(f'  {rel}  ({size:,} bytes)')
    lines.append('')

    lines.append('=' * 70)
    lines.append('清洗报告结束')
    lines.append('=' * 70)

    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    logging.info("清洗报告已生成: %s", report_path)
    return report_path


# ============ 阶段一：搜索 ============

def run_search(keyword: str, video_count: int = 10, batch_dir: str = ''):
    """阶段一：搜索视频 + 保存链接 + 保存元数据"""
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    session_name = f'{keyword}_{ts}'
    setup_logging(ts, batch_dir, session_name)
    session_dir = build_session_dir(keyword, ts)

    logging.info("=" * 70)
    logging.info("【阶段一】B站视频搜索")
    logging.info("关键词: %s | 视频数: %d", keyword, video_count)
    logging.info("时间戳: %s", ts)
    logging.info("会话目录: %s", session_dir)
    logging.info("=" * 70)

    logging.info("搜索B站视频「%s」按播放量排序 Top%d", keyword, video_count)
    videos = search_videos(keyword, page=1, page_size=20, order='click')
    top_videos = videos[:video_count]
    if not top_videos:
        logging.error("未搜索到视频，退出。")
        return None, [], None

    logging.info("搜索到 %d 个视频，取前 %d 个。", len(videos), len(top_videos))
    for i, v in enumerate(top_videos, 1):
        logging.info("  %2d. %s | 播放:%s | UP:%s", i, v['title'], f"{v['play']:,}", v['author'])

    link_path = save_video_links(top_videos, keyword, session_dir)
    save_search_result(top_videos, keyword, ts, video_count, session_dir)

    logging.info("=" * 70)
    logging.info("【阶段一】搜索完成！")
    logging.info("  会话目录: %s", session_dir)
    logging.info("  链接清单: %s", link_path)
    logging.info("  请用户确认视频链接后，执行阶段二采集。")
    logging.info("=" * 70)
    # 打印 SESSION_DIR 供 AI 解析
    print(f"SESSION_DIR={session_dir}")

    return session_dir, top_videos, link_path


# ============ 阶段二：采集 ============

def run_crawl(session_dir: str, keyword: str, comment_count: int = 100, skip_bvids: str = '', report_md: bool = True, clean_report: bool = False, batch_dir: str = ''):
    """阶段二：逐视频采集评论 + 清洗 + 提取 + 报告"""
    # 读取搜索元数据
    meta = load_search_result(session_dir)
    if meta is None:
        logging.error("无法读取搜索元数据，退出。")
        return

    ts = meta['timestamp']
    videos = meta['videos']
    session_name = os.path.basename(session_dir)

    # 解析跳过列表
    skip_set = set()
    if skip_bvids:
        skip_set = {b.strip() for b in skip_bvids.split(',') if b.strip()}

    setup_logging(ts, batch_dir, session_name)

    logging.info("=" * 70)
    logging.info("【阶段二】B站评论采集与清洗")
    logging.info("关键词: %s | 视频数: %d | 每视频评论数: %d", keyword, len(videos), comment_count)
    if skip_set:
        logging.info("跳过视频: %s", ', '.join(skip_set))
    logging.info("会话目录: %s", session_dir)
    logging.info("=" * 70)

    crawl_stats = []
    all_clean_csvs = []
    total_raw = 0
    total_clean = 0
    total_dropped = 0

    for idx, v in enumerate(videos, 1):
        if total_clean >= 200:
            logging.info("【停止】总清洗评论数已达到或超过 200 条，停止爬取后续视频。")
            break

        bvid = v['bvid']
        if bvid in skip_set:
            logging.info("【%d/%d】跳过视频: %s (BV:%s)", idx, len(videos), v['title'], bvid)
            continue

        logging.info("【%d/%d】采集视频: 《%s》", idx, len(videos), v['title'])
        comments = fetch_comments(bvid, max_count=comment_count)
        raw_count = len(comments)
        raw_csv = save_raw_csv(bvid, comments, session_dir)

        cleaned, dropped = basic_clean(comments)
        clean_csv = save_clean_csv(bvid, cleaned, keyword, session_dir)
        all_clean_csvs.append(clean_csv)

        top_comments = sorted(cleaned, key=lambda x: x.get('like', 0), reverse=True)[:5]
        crawl_stats.append({
            'bvid': bvid,
            'title': v['title'],
            'raw': raw_count,
            'clean': len(cleaned),
            'dropped': dropped,
            'extract': len(cleaned),
            'top_comments': top_comments,
        })

        total_raw += raw_count
        total_clean += len(cleaned)
        total_dropped += dropped
        logging.info("  原始: %d → 清洗后: %d (丢弃 %d)", raw_count, len(cleaned), dropped)

    # 提取纯评论（合并所有视频）
    if all_clean_csvs:
        logging.info("提取纯评论内容保存为CSV（合并 %d 个视频）", len(all_clean_csvs))
        comments_csv, extract_count = extract_comments_text(all_clean_csvs, session_dir)
    else:
        logging.warning("无有效清洗CSV，跳过提取。")
        comments_csv = ''
        extract_count = 0

    link_path = os.path.join(session_dir, 'link', 'video_links.txt')

    # 合并所有清洗 CSV 为完整数据
    merge_csv = merge_clean_csvs(session_dir, keyword, ts)

    # 生成报告
    if report_md:
        report_path = write_report(ts, keyword, session_dir, videos, crawl_stats,
                                   link_path, merge_csv, batch_dir, session_name)
        report_msg = f"  报告: {report_path}"
    else:
        report_path = ''
        report_msg = '  报告: 已跳过（--no-report-md）'

    # 生成清洗报告（脚本生成，非 AI）
    if clean_report:
        clean_path = write_clean_report(ts, keyword, session_dir, videos, crawl_stats, batch_dir, session_name)
        report_msg += f"\n  清洗报告: {clean_path}"

    logging.info("=" * 70)
    logging.info("【阶段二】采集完成！")
    logging.info("  关键词: %s", keyword)
    logging.info("  会话目录: %s", session_dir)
    logging.info("  视频数: %d | 原始评论: %d → 清洗后: %d (丢弃 %d)",
                  len(videos), total_raw, total_clean, total_dropped)
    logging.info("  纯评论CSV: %d 条", extract_count)
    logging.info(report_msg)
    logging.info("=" * 70)


# ============ 完整流程（不分阶段） ============

def run(keyword: str, video_count: int = 10, comment_count: int = 100, report_md: bool = True, clean_report: bool = False, batch_dir: str = ''):
    """完整流程：搜索 + 采集一气呵成（不暂停确认）"""
    session_dir, videos, link_path = run_search(keyword, video_count, batch_dir)
    if session_dir is None:
        return
    run_crawl(session_dir, keyword, comment_count, report_md=report_md, clean_report=clean_report, batch_dir=batch_dir)


# ============ CLI ============

def main():
    """CLI 入口：解析命令行参数并调度工作流。

    支持三种运行模式：
    - ``--search-only``: 仅执行阶段一（搜索 + 保存链接）。
    - ``--crawl-only --session-dir <path>``: 仅执行阶段二（采集 + 清洗）。
    - 不加上述参数：完整流程（搜索 + 采集一气呵成）。
    """
    parser = argparse.ArgumentParser(description='B站视频搜索+评论采集+清洗工作流')
    parser.add_argument('--keyword', '-k', default='鸣潮', help='搜索关键词（默认: 鸣潮）')
    parser.add_argument('--video-count', '-v', type=int, default=10, help='获取视频数（默认: 10）')
    parser.add_argument('--comment-count', '-c', type=int, default=100, help='每视频获取评论数（默认: 100）')
    parser.add_argument('--search-only', action='store_true', help='仅执行阶段一（搜索视频+保存链接）')
    parser.add_argument('--crawl-only', action='store_true', help='仅执行阶段二（采集评论+清洗）')
    parser.add_argument('--session-dir', '-s', help='会话目录路径（--crawl-only 时必须提供）')
    parser.add_argument('--skip-bvids', default='', help='跳过的BVID列表（逗号分隔，如 BVxxx,BVyyy）')
    parser.add_argument('--report-md', action='store_true', default=True,
                        help='生成报告 md（默认开启）')
    parser.add_argument('--no-report-md', action='store_false', dest='report_md',
                        help='不生成报告 md')
    parser.add_argument('--clean-report', action='store_true', default=False,
                        help='生成清洗报告 log（脚本生成，非 AI）')
    parser.add_argument('--batch-dir', default='', help='批次目录路径（批量爬取时共享一个 program_{ts}）')
    args = parser.parse_args()

    if args.search_only and args.crawl_only:
        parser.error("--search-only 和 --crawl-only 不能同时使用")

    if args.crawl_only:
        if not args.session_dir:
            parser.error("--crawl-only 需要配合 --session-dir 使用")
        run_crawl(args.session_dir, args.keyword, args.comment_count, args.skip_bvids,
                  report_md=args.report_md, clean_report=args.clean_report, batch_dir=args.batch_dir)
    elif args.search_only:
        run_search(args.keyword, args.video_count, batch_dir=args.batch_dir)
    else:
        run(args.keyword, args.video_count, args.comment_count, report_md=args.report_md,
            clean_report=args.clean_report, batch_dir=args.batch_dir)


if __name__ == '__main__':
    main()
