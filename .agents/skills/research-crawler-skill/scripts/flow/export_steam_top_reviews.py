#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按有用度（点赞数）导出 Steam 评论 Top N 到 Excel。

Steam 公开 appreviews 接口只提供帮助度排序，没有“按点赞数排序”参数，因此流程为：
先按帮助度抓取一个评论池（steam_crawler.py），再在本地按点赞数降序取 Top N。

输出：
  excel/steam_{时间戳}.xlsx                              每个游戏一个工作表
  output/steam/{游戏}/{会话}/output/output_top{N}.csv    Top N 明细（留档，便于复核）

字段：序号, 平台, 游戏名称, AppID, 评论内容, 点赞数, 评论时间, 是否推荐, 是否购买
"""

import argparse
import csv
import os
import re
import sys
from datetime import datetime

import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPTS_DIR))
sys.path.insert(0, SCRIPT_DIR)

from merge_all_to_excel import style_worksheet  # noqa: E402

OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output', 'steam')
EXCEL_DIR = os.path.join(PROJECT_ROOT, 'excel')

EXPORT_FIELDS = ['序号', '平台', '游戏名称', 'AppID', '评论内容', '点赞数', '评论时间', '是否推荐', '是否购买']


def safe_name(name: str) -> str:
    return "".join(c for c in name if c.isalnum() or c in " _-")


def latest_session(game_name: str) -> str:
    """返回该游戏下最近一次采集会话目录"""
    game_dir = os.path.join(OUTPUT_DIR, safe_name(game_name))
    if not os.path.isdir(game_dir):
        raise FileNotFoundError(f"未找到游戏输出目录: {game_dir}")
    sessions = [d for d in os.listdir(game_dir) if os.path.isdir(os.path.join(game_dir, d))]
    if not sessions:
        raise FileNotFoundError(f"{game_dir} 下没有任何采集会话")
    sessions.sort()
    return os.path.join(game_dir, sessions[-1])


def find_raw_csv(session_dir: str, appid: str = None) -> str:
    """定位会话内的 raw 评论 CSV（raw/{appid}.csv）"""
    raw_dir = os.path.join(session_dir, 'raw')
    if not os.path.isdir(raw_dir):
        raise FileNotFoundError(f"未找到 raw 目录: {raw_dir}")
    if appid:
        candidate = os.path.join(raw_dir, f"{appid}.csv")
        if os.path.exists(candidate):
            return candidate
    csvs = [f for f in os.listdir(raw_dir) if f.endswith('.csv')]
    if not csvs:
        raise FileNotFoundError(f"{raw_dir} 下没有 CSV 文件")
    return os.path.join(raw_dir, sorted(csvs)[0])


def normalize_whitespace(text: str) -> str:
    """换行/制表符统一为空格，合并连续空格，保证单行"""
    text = str(text).replace('\r', ' ').replace('\n', ' ').replace('\t', ' ')
    return re.sub(r' {2,}', ' ', text).strip()


def clean_reviews(df: pd.DataFrame) -> tuple:
    """基础清洗：规范化空白、去空、去重（同内容保留点赞数最高的一条）。

    返回 (清洗后 DataFrame, 清洗统计 dict)
    """
    stats = {'原始': len(df)}
    df = df.copy()
    df['评论内容'] = df['评论内容'].apply(normalize_whitespace)

    before = len(df)
    df = df[df['评论内容'] != '']
    stats['去空'] = before - len(df)

    df['点赞数'] = pd.to_numeric(df['点赞数'], errors='coerce').fillna(0).astype(int)
    before = len(df)
    df = df.sort_values('点赞数', ascending=False).drop_duplicates(subset=['评论内容'], keep='first')
    stats['去重'] = before - len(df)

    stats['清洗后'] = len(df)
    return df, stats


def export(game_name: str, top_n: int, appid: str = None) -> str:
    session_dir = latest_session(game_name)
    raw_csv = find_raw_csv(session_dir, appid)
    if appid is None:
        appid = os.path.splitext(os.path.basename(raw_csv))[0]

    df = pd.read_csv(raw_csv, encoding='utf-8-sig')
    if '是否推荐' not in df.columns:
        raise KeyError("raw CSV 缺少 '是否推荐' 字段，请确认使用支持 voted_up 的 steam_crawler.py 采集")
    df, stats = clean_reviews(df)

    top = df.sort_values('点赞数', ascending=False).head(top_n).reset_index(drop=True)

    rows = []
    for i, r in top.iterrows():
        rows.append({
            '序号': i + 1,
            '平台': 'Steam',
            '游戏名称': game_name,
            'AppID': str(appid),
            '评论内容': r['评论内容'],
            '点赞数': int(r['点赞数']),
            '评论时间': r['发布时间'],
            '是否推荐': r['是否推荐'],
            '是否购买': r.get('是否购买', ''),
        })
    out_df = pd.DataFrame(rows, columns=EXPORT_FIELDS)

    # 1) Top N 明细留档到会话内，便于复核
    detail_path = os.path.join(session_dir, 'output', f'output_top{top_n}.csv')
    os.makedirs(os.path.dirname(detail_path), exist_ok=True)
    out_df.to_csv(detail_path, index=False, encoding='utf-8-sig')

    # 2) Excel 汇总（按平台一个文件）
    os.makedirs(EXCEL_DIR, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    excel_path = os.path.join(EXCEL_DIR, f'steam_{ts}.xlsx')
    sheet_name = game_name[:31].replace(':', '_').replace('\\', '_').replace('/', '_') \
        .replace('?', '').replace('*', '').replace('[', '').replace(']', '')
    with pd.ExcelWriter(excel_path, engine='openpyxl') as writer:
        out_df.to_excel(writer, sheet_name=sheet_name, index=False)
        style_worksheet(writer.sheets[sheet_name], out_df)

    print(f"数据来源会话: {session_dir}")
    print(f"raw 文件: {raw_csv}")
    print(f"清洗统计: {stats}")
    print(f"导出 Top {top_n}（按点赞数降序）")
    print(f"点赞数区间: {out_df['点赞数'].min()} - {out_df['点赞数'].max()}")
    print(f"推荐分布: {dict(out_df['是否推荐'].value_counts())}")
    print(f"Top N 明细: {detail_path}")
    print(f"Excel: {excel_path}")
    return excel_path


def main():
    parser = argparse.ArgumentParser(description='导出 Steam 评论 Top N（按点赞数）到 Excel')
    parser.add_argument('--game', required=True, help='游戏名称（与 output/steam 下文件夹同名）')
    parser.add_argument('--top', type=int, default=10, help='导出条数，默认 10')
    parser.add_argument('--appid', default=None, help='AppID，默认从 raw 文件名推断')
    args = parser.parse_args()
    export(args.game, args.top, args.appid)


if __name__ == '__main__':
    main()
