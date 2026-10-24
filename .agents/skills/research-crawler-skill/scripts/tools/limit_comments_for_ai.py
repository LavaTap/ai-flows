# -*- coding: utf-8 -*-
"""
评论预处理脚本 —— 为 AI 分析准备统一输入文件

功能：
  遍历 output 目录下所有项目会话，从 comments/comments.csv 或 output/output.csv
  读取评论，截取前 50 条，生成 AI 分析输入文件：
    - comments/comments_for_ai.csv  (序号,评论内容 两列，最多50条)

规则：
  - 评论来源：优先 {会话目录}/comments/comments.csv，回退到 {会话目录}/output/output.csv
  - 评论条数 > 50 时，只保留前 50 条（按原始热度顺序，爬取时已排序）
  - 评论条数 <= 50 时，保留全部
  - 原始 comments.csv / output.csv 保留不动

用法:
  # 处理所有项目（批量）
  python research-crawler-skill/scripts/limit_comments_for_ai.py

  # 处理单个指定会话目录
  python research-crawler-skill/scripts/limit_comments_for_ai.py --session-dir "output/xxx/xxx_timestamp"
"""
import argparse
import csv
import os
import sys
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)

OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output')

MAX_COMMENTS_FOR_AI = 50

# comments_for_ai.csv 的字段
FIELDNAMES = ['序号', '评论内容']

# 支持的平台
PLATFORMS = ['bilibili', 'steam', 'xiaohongshu']


def detect_platform(session_dir: str) -> str:
    """从会话目录路径推断平台。

    会话目录结构: output/{platform}/{keyword}/{keyword}_{timestamp}/
    """
    try:
        rel = os.path.relpath(session_dir, OUTPUT_DIR)
        parts = rel.split(os.sep)
        if parts and parts[0] in PLATFORMS:
            return parts[0]
    except ValueError:
        pass
    return 'bilibili'  # 默认平台


def get_reports_dir(platform: str) -> str:
    """获取平台的 reports 根目录路径（limit 报告存于 reports/{platform}/limit/）"""
    return os.path.join(PROJECT_ROOT, 'reports', platform)


def find_all_session_dirs(root_dir: str):
    """递归查找所有会话目录（包含 output/output.csv 或 comments/comments.csv 的目录）

    会话目录结构:
      output/{platform}/{keyword}/{keyword}_{timestamp}/
    """
    result = []
    for dirpath, dirnames, filenames in os.walk(root_dir):
        # 检查是否为会话目录：有 comments 子目录且有 comments.csv，或有 output/output.csv
        has_comments_csv = 'comments' in dirnames and os.path.exists(
            os.path.join(dirpath, 'comments', 'comments.csv'))
        has_output_csv = 'output' in dirnames and os.path.exists(
            os.path.join(dirpath, 'output', 'output.csv'))
        if has_comments_csv or has_output_csv:
            result.append(dirpath)
    return sorted(result)


def read_comments_from_csv(csv_path: str):
    """从 CSV 文件读取评论列表。

    支持两种 CSV 格式：
    1. comments.csv — 序号,评论内容 两列
    2. output.csv — 12 字段，取「评论内容」列

    Returns:
        list[str] — 评论内容列表
    """
    comments = []
    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            msg = (row.get('评论内容') or '').strip()
            if msg:
                comments.append(msg)
    return comments


def write_comments_for_ai_csv(comments: list, output_path: str):
    """将评论列表写入 comments_for_ai.csv（序号,评论内容 两列）

    Args:
        comments: list[str] 评论内容列表
        output_path: 输出 csv 路径
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        for seq, content in enumerate(comments, 1):
            writer.writerow({'序号': seq, '评论内容': content})


def process_session(session_dir: str):
    """处理单个会话目录：读取评论，截取前50条，生成 comments_for_ai.csv

    Args:
        session_dir: 会话目录路径

    Returns:
        dict: 处理结果统计，或 None（无可用数据时）
    """
    rel_path = os.path.relpath(session_dir, PROJECT_ROOT)

    # 优先从 comments/comments.csv 读取，回退到 output/output.csv
    comments_csv = os.path.join(session_dir, 'comments', 'comments.csv')
    output_csv = os.path.join(session_dir, 'output', 'output.csv')

    if os.path.exists(comments_csv):
        comments = read_comments_from_csv(comments_csv)
        source = 'comments.csv'
    elif os.path.exists(output_csv):
        comments = read_comments_from_csv(output_csv)
        source = 'output.csv'
    else:
        print("[-] 跳过: %s - 未找到 comments/comments.csv 或 output/output.csv" % rel_path)
        return None

    total = len(comments)

    # 截取前 50 条
    truncated = total > MAX_COMMENTS_FOR_AI
    if truncated:
        kept = MAX_COMMENTS_FOR_AI
        limited_comments = comments[:kept]
        status = "%d -> %d 条 (已截断)" % (total, kept)
    else:
        kept = total
        limited_comments = comments
        status = "%d 条 (全量保留)" % total

    csv_path = os.path.join(session_dir, 'comments', 'comments_for_ai.csv')
    write_comments_for_ai_csv(limited_comments, csv_path)

    print("[*] 处理: %s - %s -> 生成 comments_for_ai.csv (源: %s)" % (rel_path, status, source))

    return {
        'session_dir': session_dir,
        'total': total,
        'kept': kept,
        'processed': True,
        'truncated': truncated,
        'csv_path': csv_path,
        'source': source,
    }


def generate_report(results: list, platform: str = 'bilibili'):
    """生成批量处理报告写入对应平台的 reports/program/limit 目录"""
    reports_dir = get_reports_dir(platform)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_dir = os.path.join(reports_dir, 'limit', 'limit_%s' % ts)
    os.makedirs(output_dir, exist_ok=True)

    report_path = os.path.join(output_dir, 'report.md')
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    valid = [r for r in results if r]
    processed = [r for r in valid if r.get('processed')]
    truncated = [r for r in processed if r.get('truncated')]
    full_kept = [r for r in processed if not r.get('truncated')]

    total_original = sum(r['total'] for r in processed)
    total_kept = sum(r['kept'] for r in processed)
    total_truncated = total_original - total_kept

    lines = []
    lines.append('# AI 分析评论预处理报告\n')
    lines.append('- 平台: %s' % platform)
    lines.append('- 生成时间: %s' % now)
    lines.append('- 最大保留条数: %d' % MAX_COMMENTS_FOR_AI)
    lines.append('- 扫描会话数: %d' % len(valid))
    lines.append('- 生成 comments_for_ai.csv: %d\n' % len(processed))

    lines.append('## 处理统计\n')
    lines.append('| 统计项 | 数值 |')
    lines.append('| --- | --- |')
    lines.append('| 扫描项目数 | %d |' % len(valid))
    lines.append('| 生成 comments_for_ai.csv | %d |' % len(processed))
    lines.append('|   其中截断(>50条) | %d |' % len(truncated))
    lines.append('|   其中全量保留(<=50条) | %d |' % len(full_kept))
    lines.append('| 处理前总评论数 | %d |' % total_original)
    lines.append('| 处理后总评论数 | %d |' % total_kept)
    lines.append('| 截断总条数 | %d |\n' % total_truncated)

    if processed:
        lines.append('## 处理明细\n')
        lines.append('| 序号 | 项目路径 | 原始条数 | 保留条数 | 是否截断 | 来源 |')
        lines.append('| --- | --- | --- | --- | --- | --- |')
        for i, r in enumerate(processed, 1):
            rel_path = os.path.relpath(r['session_dir'], PROJECT_ROOT)
            trunc_flag = '是' if r.get('truncated') else '否'
            lines.append('| %d | `%s` | %d | %d | %s | %s |' % (
                i, rel_path, r['total'], r['kept'], trunc_flag, r.get('source', '')))
        lines.append('')

    lines.append('## 说明\n')
    lines.append('- 本脚本为每个会话目录生成 `comments/comments_for_ai.csv`（序号+评论内容 两列 CSV）')
    lines.append('- 当评论条数 **超过 %d 条** 时，只保留前 %d 条（热度排序，前50条足以代表社区主流观点）' % (
        MAX_COMMENTS_FOR_AI, MAX_COMMENTS_FOR_AI))
    lines.append('- 当评论条数 **<= %d 条** 时，全量保留' % MAX_COMMENTS_FOR_AI)
    lines.append('- 评论来源优先 `comments/comments.csv`，回退到 `output/output.csv`')
    lines.append('- AI 分析时应**读取 `comments/comments_for_ai.csv`**')

    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print("\n[+] 报告已生成: %s" % report_path)
    return report_path


def main():
    parser = argparse.ArgumentParser(
        description='AI 分析评论预处理：生成 comments_for_ai.csv（超过%d条截断）' % MAX_COMMENTS_FOR_AI
    )
    parser.add_argument('--session-dir', '-s', default='',
                        help='处理单个指定会话目录，不指定则处理所有项目')
    args = parser.parse_args()

    if args.session_dir:
        # 处理单个会话
        if not os.path.isabs(args.session_dir):
            session_dir = os.path.join(PROJECT_ROOT, args.session_dir)
        else:
            session_dir = args.session_dir
        result = process_session(session_dir)
        if result:
            platform = detect_platform(session_dir)
            generate_report([result], platform)
        return

    # 批量处理所有项目（按平台分组生成报告）
    print("[*] 扫描 %s 目录下所有会话..." % OUTPUT_DIR)
    session_dirs = find_all_session_dirs(OUTPUT_DIR)
    print("[*] 找到 %d 个会话目录\n" % len(session_dirs))

    # 按平台分组
    platform_results = {}
    for session_dir in session_dirs:
        platform = detect_platform(session_dir)
        result = process_session(session_dir)
        if result:
            platform_results.setdefault(platform, []).append(result)

    # 每个平台生成一份报告
    for platform, results in platform_results.items():
        print("\n--- %s 平台报告 ---" % platform)
        generate_report(results, platform)

    if not platform_results:
        print("\n[+] 没有找到可处理的项目")


if __name__ == '__main__':
    main()
