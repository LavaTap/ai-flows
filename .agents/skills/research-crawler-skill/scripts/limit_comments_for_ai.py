# -*- coding: utf-8 -*-
"""
评论预处理脚本 —— 为 AI 分析准备统一输入文件

功能：
  遍历 output 目录下所有项目会话，从 comments/comments.txt 读取评论，
  清洗出「序号 + 评论内容」并生成两个统一的 AI 分析输入文件：
    - comments/comments_for_ai.csv  (序号,评论内容 两列，便于程序读取)
    - comments/comments_for_ai.txt  (// 分隔，便于 AI 直接读取)

规则：
  - 评论来源：{会话目录}/comments/comments.txt（// 分隔，由 extract_comments.py 生成）
  - 评论条数 > 50 时，只保留前 50 条（按原始热度顺序，爬取时已排序）
  - 评论条数 <= 50 时，保留全部
  - 无论是否截断，都生成 comments_for_ai.csv 和 comments_for_ai.txt
  - 原始 comments.txt 保留不动

用法:
  # 处理所有项目（批量）
  python research-crawler-skill/scripts/limit_comments_for_ai.py

  # 处理单个指定会话目录
  python research-crawler-skill/scripts/limit_comments_for_ai.py --session-dir "output/xxx/xxx_timestamp"

  # 覆盖原 comments.txt 模式（谨慎使用，不生成 _for_ai 文件）
  python research-crawler-skill/scripts/limit_comments_for_ai.py --overwrite
"""
import argparse
import csv
import os
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(SCRIPT_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)

OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output')
REPORTS_DIR = os.path.join(PROJECT_ROOT, 'reports', 'bilibili', 'program')

MAX_COMMENTS_FOR_AI = 50

# comments_for_ai.csv 的字段
FIELDNAMES = ['序号', '评论内容']


def find_all_session_dirs(root_dir: str):
    """递归查找所有会话目录（包含 comments/comments.txt 的目录）

    会话目录结构:
      output/{keyword}/{keyword}_{timestamp}/comments/comments.txt
    """
    result = []
    for dirpath, dirnames, filenames in os.walk(root_dir):
        if 'comments' in dirnames:
            comments_dir = os.path.join(dirpath, 'comments')
            if not os.path.isdir(comments_dir):
                continue
            comments_txt = os.path.join(comments_dir, 'comments.txt')
            if os.path.exists(comments_txt):
                result.append(dirpath)
    return sorted(result)


def parse_comments_txt(file_path: str):
    """解析 comments.txt 文件，返回评论列表。

    支持两种格式：
    1. 每行一条："序号\t内容"
    2. // 分隔：每条评论用 // 分割（可能多行）

    Returns:
        list[(序号, 内容)] - 评论列表
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    comments = []

    # 检测格式：如果有 // 分隔符，使用//分割
    if '//' in content:
        parts = content.split('//')
        parts = [p.strip() for p in parts if p.strip()]
        for idx, part in enumerate(parts, 1):
            # 尝试提取序号，如果开头有数字\t格式
            if '\t' in part.split('\n')[0]:
                first_line = part.split('\n')[0]
                num_str, rest = first_line.split('\t', 1)
                if num_str.isdigit():
                    comment_content = rest + '\n' + '\n'.join(part.split('\n')[1:])
                    comments.append((int(num_str), comment_content.strip()))
                else:
                    comments.append((idx, part.strip()))
            else:
                comments.append((idx, part.strip()))
    else:
        # 按行解析
        lines = [line.rstrip('\n') for line in content.splitlines() if line.strip()]
        for idx, line in enumerate(lines, 1):
            if '\t' in line:
                num_str, content = line.split('\t', 1)
                if num_str.isdigit():
                    comments.append((int(num_str), content.strip()))
                else:
                    comments.append((idx, line.strip()))
            else:
                comments.append((idx, line.strip()))

    return comments


def write_comments_for_ai_csv(comments: list, output_path: str):
    """将评论列表写入 comments_for_ai.csv（序号,评论内容 两列）

    Args:
        comments: list[(序号, 内容)]
        output_path: 输出 csv 路径
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        for seq, (_orig_num, content) in enumerate(comments, 1):
            writer.writerow({
                '序号': seq,
                '评论内容': content,
            })


def write_comments_for_ai_txt(comments: list, output_path: str):
    """将评论列表写入 comments_for_ai.txt（// 分隔格式）

    格式：序号\t内容（输出序号为按列表重新编号），多条用 ' // ' 分隔。
    该格式与 parse_comments_txt 的解析逻辑形成隐式契约，因此评论内容中
    不得包含 ' // ' 分隔符或换行符，否则会破坏解析边界。

    Args:
        comments: list[(序号, 内容)]，序号不会被使用（输出统一重新编号）
        output_path: 输出 txt 路径
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    lines = []
    for seq, (_orig_num, content) in enumerate(comments, 1):
        lines.append(f"{seq}\t{content}")
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(' // '.join(lines) + '\n')


def process_session(session_dir: str, overwrite: bool = False):
    """处理单个会话目录：读取评论，生成 comments_for_ai.csv 和 comments_for_ai.txt

    Args:
        session_dir: 会话目录路径
        overwrite: 是否覆盖原 comments.txt（默认 False，生成 _for_ai 文件）

    Returns:
        dict: 处理结果统计
    """
    comments_path = os.path.join(session_dir, 'comments', 'comments.txt')
    if not os.path.exists(comments_path):
        print("[-] 跳过: %s - 未找到 comments/comments.txt" % os.path.relpath(session_dir, PROJECT_ROOT))
        return None

    comments = parse_comments_txt(comments_path)
    total = len(comments)

    rel_path = os.path.relpath(session_dir, PROJECT_ROOT)

    if overwrite:
        # 覆盖原文件模式（谨慎使用）
        if total <= MAX_COMMENTS_FOR_AI:
            print("[+] 跳过(覆盖模式): %s - %d 条 <= %d" % (rel_path, total, MAX_COMMENTS_FOR_AI))
            return {
                'session_dir': session_dir,
                'total': total,
                'kept': total,
                'processed': False,
                'truncated': False
            }
        kept = MAX_COMMENTS_FOR_AI
        limited_comments = comments[:kept]
        # 先写临时文件再原子替换，避免写入中断（磁盘满/进程被杀）破坏原文件
        tmp_path = comments_path + '.tmp'
        write_comments_for_ai_txt(limited_comments, tmp_path)
        os.replace(tmp_path, comments_path)
        print("[*] 处理(覆盖模式): %s - %d -> %d 条 (覆盖原文件)" % (rel_path, total, kept))
        return {
            'session_dir': session_dir,
            'total': total,
            'kept': kept,
            'processed': True,
            'truncated': True,
            'mode': 'overwrite',
            'output_path': comments_path
        }

    # 默认模式：生成 comments_for_ai.csv 和 comments_for_ai.txt
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
    txt_path = os.path.join(session_dir, 'comments', 'comments_for_ai.txt')

    write_comments_for_ai_csv(limited_comments, csv_path)
    write_comments_for_ai_txt(limited_comments, txt_path)

    print("[*] 处理: %s - %s -> 生成 comments_for_ai.csv + comments_for_ai.txt" % (rel_path, status))

    return {
        'session_dir': session_dir,
        'total': total,
        'kept': kept,
        'processed': True,
        'truncated': truncated,
        'mode': 'for_ai',
        'csv_path': csv_path,
        'txt_path': txt_path
    }


def generate_report(results: list, output_dir: str = None):
    """生成批量处理报告写入 reports 目录"""
    if output_dir is None:
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_dir = os.path.join(REPORTS_DIR, 'limit', 'limit_%s' % ts)
    os.makedirs(output_dir, exist_ok=True)

    report_path = os.path.join(output_dir, 'report.md')
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    valid = [r for r in results if r]
    processed = [r for r in valid if r.get('processed')]
    processed_overwrite = [r for r in processed if r.get('mode') == 'overwrite']
    processed_for_ai = [r for r in processed if r.get('mode') != 'overwrite']
    truncated = [r for r in processed_for_ai if r.get('truncated')]
    full_kept = [r for r in processed_for_ai if not r.get('truncated')]
    skipped = [r for r in valid if not r.get('processed')]

    total_original = sum(r['total'] for r in processed)
    total_kept = sum(r['kept'] for r in processed)
    total_truncated = total_original - total_kept

    lines = []
    lines.append('# AI 分析评论预处理报告\n')
    lines.append('- 生成时间: %s' % now)
    lines.append('- 最大保留条数: %d' % MAX_COMMENTS_FOR_AI)
    lines.append('- 扫描会话数: %d' % len(valid))
    lines.append('- 生成 comments_for_ai 文件: %d\n' % len(processed_for_ai))

    lines.append('## 处理统计\n')
    lines.append('| 统计项 | 数值 |')
    lines.append('| --- | --- |')
    lines.append('| 扫描项目数 | %d |' % len(valid))
    lines.append('| 生成 _for_ai 文件 | %d |' % len(processed_for_ai))
    lines.append('|   其中截断(>50条) | %d |' % len(truncated))
    lines.append('|   其中全量保留(<=50条) | %d |' % len(full_kept))
    lines.append('| 覆盖原文件(--overwrite) | %d |' % len(processed_overwrite))
    lines.append('| 跳过(无 comments.txt) | %d |' % len(skipped))
    lines.append('| 处理前总评论数 | %d |' % total_original)
    lines.append('| 处理后总评论数 | %d |' % total_kept)
    lines.append('| 截断总条数 | %d |\n' % total_truncated)

    if processed:
        lines.append('## 处理明细\n')
        lines.append('| 序号 | 项目路径 | 原始条数 | 保留条数 | 是否截断 |')
        lines.append('| --- | --- | --- | --- | --- |')
        for i, r in enumerate(processed, 1):
            rel_path = os.path.relpath(r['session_dir'], PROJECT_ROOT)
            trunc_flag = '是' if r.get('truncated') else '否'
            lines.append('| %d | `%s` | %d | %d | %s |' % (i, rel_path, r['total'], r['kept'], trunc_flag))
        lines.append('')

    lines.append('## 说明\n')
    lines.append('- 本脚本为每个会话目录生成两个 AI 分析输入文件：')
    lines.append('  - `comments/comments_for_ai.csv` — 序号+评论内容 两列 CSV，便于程序读取')
    lines.append('  - `comments/comments_for_ai.txt` — // 分隔文本，便于 AI 直接读取')
    lines.append('- 当评论条数 **超过 %d 条** 时，只保留前 %d 条（热度排序，前50条足以代表社区主流观点）' % (MAX_COMMENTS_FOR_AI, MAX_COMMENTS_FOR_AI))
    lines.append('- 当评论条数 **<= %d 条** 时，全量保留' % MAX_COMMENTS_FOR_AI)
    lines.append('- 原始 `comments.txt` 保留不动（除非指定 --overwrite 参数）')
    lines.append('- AI 分析时应**优先读取 `comments_for_ai.csv` 或 `comments_for_ai.txt`**')

    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print("\n[+] 报告已生成: %s" % report_path)
    return report_path


def main():
    parser = argparse.ArgumentParser(
        description='AI 分析评论预处理：生成 comments_for_ai.csv 和 comments_for_ai.txt（超过%d条截断）' % MAX_COMMENTS_FOR_AI
    )
    parser.add_argument('--session-dir', '-s', default='',
                        help='处理单个指定会话目录，不指定则处理所有项目')
    parser.add_argument('--overwrite', '-o', action='store_true',
                        help='覆盖原 comments.txt（默认：生成 _for_ai 文件）')
    args = parser.parse_args()

    if args.session_dir:
        # 处理单个会话
        if not os.path.isabs(args.session_dir):
            session_dir = os.path.join(PROJECT_ROOT, args.session_dir)
        else:
            session_dir = args.session_dir
        # 规范化路径并校验其位于 OUTPUT_DIR 之内，拒绝路径穿越/越权读写
        session_dir = os.path.realpath(session_dir)
        output_root = os.path.realpath(OUTPUT_DIR)
        try:
            within_output = os.path.commonpath([session_dir, output_root]) == output_root
        except ValueError:
            within_output = False
        if not within_output:
            print("[!] 错误: --session-dir 必须位于 %s 之内: %s" % (output_root, session_dir))
            return
        result = process_session(session_dir, args.overwrite)
        if result:
            generate_report([result])
        return

    # 批量处理所有项目
    print("[*] 扫描 %s 目录下所有会话..." % OUTPUT_DIR)
    session_dirs = find_all_session_dirs(OUTPUT_DIR)
    print("[*] 找到 %d 个会话目录\n" % len(session_dirs))

    results = []
    for session_dir in session_dirs:
        result = process_session(session_dir, args.overwrite)
        if result:
            results.append(result)

    # 生成报告
    if results:
        generate_report(results)
    else:
        print("\n[+] 没有找到可处理的项目")


if __name__ == '__main__':
    main()
