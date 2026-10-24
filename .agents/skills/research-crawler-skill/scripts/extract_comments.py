# -*- coding: utf-8 -*-
"""
纯评论提取脚本。

从清洗后的 CSV 读取"评论内容"列，用 ``//`` 拼接保存到文本文件。
支持单文件或多文件输入（多视频合并提取）。

既可被 ``bridge.py`` 导入复用，也可单独 CLI 运行。
"""
import argparse
import csv
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(SCRIPT_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)

SEPARATOR = '//'
# 去除评论中的空白（含词间空格），与既有清洗行为保持一致
WHITESPACE_RE = re.compile(r'\s+')
# 必需的列名，CSV 表头缺失时无法提取
REQUIRED_COLUMN = '评论内容'


def extract_from_csv(cleaned_csvs, session_dir: str):
    """
    从清洗后 CSV 提取评论内容，// 拼接存到 {session_dir}/comments/comments.txt

    Args:
        cleaned_csvs: 清洗后 CSV 路径（单个字符串或列表）
        session_dir: 会话目录（output/{关键词}/{关键词}_{时间戳}）

    Returns:
        (txt_path, count)
    """
    if isinstance(cleaned_csvs, str):
        cleaned_csvs = [cleaned_csvs]

    out_dir = os.path.join(session_dir, 'comments')
    os.makedirs(out_dir, exist_ok=True)
    txt_path = os.path.join(out_dir, 'comments.txt')

    messages = []
    for csv_path in cleaned_csvs:
        if not os.path.exists(csv_path):
            print(f"错误: 找不到文件 {csv_path}")
            continue
        try:
            with open(csv_path, 'r', encoding='utf-8-sig') as f:
                reader = csv.DictReader(f)
                if not reader.fieldnames or REQUIRED_COLUMN not in reader.fieldnames:
                    print(f"警告: {csv_path} 缺少「{REQUIRED_COLUMN}」列，跳过")
                    continue
                for row in reader:
                    msg = WHITESPACE_RE.sub('', row.get(REQUIRED_COLUMN) or '')
                    if msg:
                        messages.append(msg)
        except (OSError, UnicodeDecodeError) as e:
            print(f"读取失败 {csv_path}: {e}")
            continue

    if not messages:
        print(f"警告: 未提取到任何评论内容，写入空文件 {txt_path}")

    try:
        with open(txt_path, 'w', encoding='utf-8') as f:
            f.write(SEPARATOR.join(messages))
    except OSError as e:
        print(f"写入失败 {txt_path}: {e}")
        return txt_path, 0

    print(f"纯评论文本已保存: {txt_path} ({len(messages)} 条, 来自 {len(cleaned_csvs)} 个文件)")
    return txt_path, len(messages)


def main():
    parser = argparse.ArgumentParser(description='从清洗后CSV提取纯评论（//分隔，支持多文件合并）')
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
