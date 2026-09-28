# -*- coding: utf-8 -*-
"""
纯评论提取脚本。

从清洗后的 CSV 读取"评论内容"列，保存为 CSV 格式到 ``comments/comments.csv``。
支持单文件或多文件输入（多视频合并提取）。

既可被 ``bridge.py`` 导入复用，也可单独 CLI 运行。
"""
import argparse
import csv
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)

FIELDNAMES = ['序号', '评论内容']


def extract_from_csv(cleaned_csvs, session_dir: str):
    """从清洗后 CSV 提取评论内容，保存为 CSV 到 ``{session_dir}/comments/comments.csv``。

    Args:
        cleaned_csvs: 清洗后 CSV 路径（单个字符串或列表）。
        session_dir: 会话目录（output/{关键词}/{关键词}_{时间戳}）。

    Returns:
        (csv_path, count) — 生成的 CSV 路径和评论条数。
    """
    if isinstance(cleaned_csvs, str):
        cleaned_csvs = [cleaned_csvs]

    out_dir = os.path.join(session_dir, 'comments')
    os.makedirs(out_dir, exist_ok=True)
    csv_path = os.path.join(out_dir, 'comments.csv')

    messages = []
    for csv_path_in in cleaned_csvs:
        with open(csv_path_in, 'r', encoding='utf-8-sig') as f:
            for row in csv.DictReader(f):
                msg = (row.get('评论内容') or '').strip()
                if msg:
                    messages.append(msg)

    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        for idx, msg in enumerate(messages, 1):
            writer.writerow({'序号': idx, '评论内容': msg})

    print(f"纯评论CSV已保存: {csv_path} ({len(messages)} 条, 来自 {len(cleaned_csvs)} 个文件)")
    return csv_path, len(messages)


def main():
    parser = argparse.ArgumentParser(description='从清洗后CSV提取纯评论（CSV格式，支持多文件合并）')
    parser.add_argument('--input', '-i', required=True, nargs='+', help='清洗后CSV路径（可传入多个）')
    parser.add_argument('--session-dir', '-s', required=True,
                        help='会话目录（如 output/鸣潮/鸣潮_20260722_212543）')
    args = parser.parse_args()

    for path in args.input:
        if not os.path.exists(path):
            print(f"错误: 找不到文件 {path}")
            sys.exit(1)

    extract_from_csv(args.input, args.session_dir)


if __name__ == '__main__':
    main()
