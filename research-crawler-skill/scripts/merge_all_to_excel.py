#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
合并所有游戏的 output.csv 到一个Excel文件
每个游戏作为一个独立工作表(sheet)，sheet名即为游戏名称

排版特性：
- 按列内容类型设置差异化列宽（评论内容宽、序号窄等）
- 根据单元格文本长度自动估算换行数，动态调整行高
- 表头样式、冻结首行、自动筛选、斑马纹、自动换行
"""

import math
import os
import pandas as pd
import argparse
from datetime import datetime

from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

# 参与合并的平台目录
PLATFORMS = ['bilibili', 'steam', 'xiaohongshu']

# ============ 排版配置 ============

# 列宽规则：按列名关键词匹配，值为Excel列宽单位（约等于半角字符数）
# 匹配不到的列使用 estimate_fallback_width() 估算
COLUMN_WIDTH_RULES = [
    (('序号',), 6),
    (('平台',), 8),
    (('游戏名称', '游戏'), 18),
    (('评论内容', '评论'), 70),
    (('情绪倾向', '是否提及', '相关度'), 12),
    (('情绪关键词', '感受细分', '吸引游玩'), 24),
    (('判断依据', '调整说明', '依据', '说明'), 38),
]
DEFAULT_COL_WIDTH = 15
MIN_COL_WIDTH = 8
MAX_COL_WIDTH = 45  # 兜底列宽上限（评论类长文本列由规则显式指定）

# 列宽 >= 该阈值的列视为长文本列：自动换行并参与行高计算
WRAP_COL_MIN_WIDTH = 20

# 行高配置（单位：磅）
LINE_HEIGHT = 15        # 单行文本高度（11pt字体）
ROW_PADDING = 4         # 行内上下留白
MIN_ROW_HEIGHT = 20     # 最小行高
MAX_ROW_HEIGHT = 300    # 最大行高（防止超长评论把行拉得过高）

# 样式
HEADER_FILL = PatternFill('solid', fgColor='2F5B3F')      # 深绿表头
HEADER_FONT = Font(name='微软雅黑', size=11, bold=True, color='FFFFFF')
BODY_FONT = Font(name='微软雅黑', size=10)
BAND_FILL = PatternFill('solid', fgColor='F2F7F3')        # 浅绿斑马纹
THIN_BORDER = Border(
    left=Side(style='thin', color='D9D9D9'),
    right=Side(style='thin', color='D9D9D9'),
    top=Side(style='thin', color='D9D9D9'),
    bottom=Side(style='thin', color='D9D9D9'),
)

# 单元格对齐：复用同一实例，避免逐单元格重复创建 Alignment 对象
ALIGN_HEADER = Alignment(horizontal='center', vertical='center', wrap_text=True)
ALIGN_WRAP = Alignment(vertical='top', horizontal='left', wrap_text=True)
ALIGN_CENTER = Alignment(vertical='center', horizontal='center', wrap_text=False)


def find_all_output_csv(root_dir: str):
    """查找所有 output.csv 文件，返回 (游戏名, 平台, 文件路径) 列表"""
    results = []
    for platform in PLATFORMS:
        platform_dir = os.path.join(root_dir, platform)
        if not os.path.exists(platform_dir):
            continue
        # 遍历每个游戏文件夹
        try:
            game_names = sorted(os.listdir(platform_dir))
        except OSError as e:
            print(f"  [WARN] 无法读取目录 {platform_dir}: {e}")
            continue
        for game_name in game_names:
            game_dir = os.path.join(platform_dir, game_name)
            if not os.path.isdir(game_dir):
                continue
            # 查找会话文件夹中的 output/output.csv；多个会话时取最新一个（按会话名排序）
            try:
                session_names = sorted(os.listdir(game_dir))
            except OSError as e:
                print(f"  [WARN] 无法读取目录 {game_dir}: {e}")
                continue
            csv_sessions = [s for s in session_names
                            if os.path.exists(os.path.join(game_dir, s, 'output', 'output.csv'))]
            if not csv_sessions:
                continue
            if len(csv_sessions) > 1:
                print(f"  [WARN] {platform}/{game_name} 存在 {len(csv_sessions)} 个含 output.csv 的会话，取最新: {csv_sessions[-1]}")
            results.append((game_name, platform,
                            os.path.join(game_dir, csv_sessions[-1], 'output', 'output.csv')))
    return results


# ============ 排版算法 ============

def text_display_width(text: str) -> int:
    """计算文本显示宽度：全角字符(CJK等)计2，半角计1"""
    return sum(2 if ord(c) > 127 else 1 for c in text)


def get_column_width(col_name: str, series: pd.Series) -> float:
    """根据列名规则确定列宽；无匹配时按内容采样估算"""
    for keywords, width in COLUMN_WIDTH_RULES:
        if any(kw in col_name for kw in keywords):
            return width
    # 兜底：采样前100行内容估算合适宽度
    sample = series.dropna().astype(str).head(100)
    max_w = text_display_width(col_name)
    for v in sample:
        # 只取第一段避免极端长文本干扰
        first_line = v.split('\n')[0]
        max_w = max(max_w, min(text_display_width(first_line), MAX_COL_WIDTH))
    return max(MIN_COL_WIDTH, min(max_w + 2, MAX_COL_WIDTH))


def estimate_row_lines(text: str, col_width: float) -> int:
    """估算一段文本在指定列宽下占用的行数（按显示宽度 + 显式换行符计算）"""
    if not text:
        return 1
    usable = max(col_width - 2, 4)  # 减去单元格左右内边距
    lines = 0
    for paragraph in str(text).split('\n'):
        w = text_display_width(paragraph)
        lines += max(1, math.ceil(w / usable))
    return lines


def calc_row_height(row_values, col_widths, wrap_col_idx) -> float:
    """根据整行各单元格文本估算所需行高"""
    max_lines = 1
    for idx, value in enumerate(row_values):
        if idx >= len(col_widths):
            break
        if idx not in wrap_col_idx or value is None or (isinstance(value, float) and math.isnan(value)):
            continue
        lines = estimate_row_lines(str(value), col_widths[idx])
        max_lines = max(max_lines, lines)
    height = max_lines * LINE_HEIGHT + ROW_PADDING
    return max(MIN_ROW_HEIGHT, min(height, MAX_ROW_HEIGHT))


def style_worksheet(ws, df: pd.DataFrame):
    """对单个工作表应用排版：列宽、行高、样式、冻结、筛选"""
    n_cols = len(df.columns)

    # 1. 计算每列宽度
    col_widths = [get_column_width(str(col), df[col]) for col in df.columns]
    for i, w in enumerate(col_widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w

    # 宽列（需要自动换行 + 参与行高计算的列）：宽度 >= WRAP_COL_MIN_WIDTH 的文本列
    wrap_col_idx = {i for i, w in enumerate(col_widths) if w >= WRAP_COL_MIN_WIDTH}

    # 2. 表头样式
    for col_i in range(1, n_cols + 1):
        cell = ws.cell(row=1, column=col_i)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.border = THIN_BORDER
        cell.alignment = ALIGN_HEADER
    ws.row_dimensions[1].height = 28

    # 3. 数据行：样式 + 动态行高
    values = df.where(df.notna(), None).values
    for row_i, row_values in enumerate(values, start=2):
        banded = (row_i % 2 == 0)
        for col_i, value in enumerate(row_values, start=1):
            cell = ws.cell(row=row_i, column=col_i)
            cell.font = BODY_FONT
            cell.border = THIN_BORDER
            if banded:
                cell.fill = BAND_FILL
            if (col_i - 1) in wrap_col_idx:
                # 长文本列：自动换行、顶部对齐、左对齐
                cell.alignment = ALIGN_WRAP
            else:
                # 短文本列：居中
                cell.alignment = ALIGN_CENTER
        # 根据评论等长文本长度动态调整行高
        ws.row_dimensions[row_i].height = calc_row_height(list(row_values), col_widths, wrap_col_idx)

    # 4. 冻结首行 + 自动筛选
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = f"A1:{get_column_letter(n_cols)}{len(df) + 1}"

    # 5. 序号类首列视觉优化：稍窄页边距视图
    ws.sheet_view.zoomScale = 90


def make_unique_sheet_name(name: str, used: set) -> str:
    """生成合法且唯一的 Excel 工作表名。

    Excel 限制：名称非空、不超过 31 字符、不能使用保留名（如 History），
    且同一工作簿内不能重名；重名时追加序号。
    """
    safe = str(name)[:31]
    safe = (safe.replace(':', '_').replace('\\', '_').replace('/', '_')
            .replace('?', '').replace('*', '').replace('[', '').replace(']', ''))
    safe = safe.strip()
    if not safe:
        safe = 'Sheet'
    base = safe
    idx = 1
    while safe.lower() in used or safe.lower() == 'history':
        suffix = f'_{idx}'
        safe = base[:31 - len(suffix)] + suffix
        idx += 1
    used.add(safe.lower())
    return safe


def merge_to_excel(output_path: str, root_dir: str = os.path.join(PROJECT_ROOT, 'output')):
    """合并所有 output.csv 到一个Excel文件"""
    all_csvs = find_all_output_csv(root_dir)
    print(f"找到 {len(all_csvs)} 个游戏项目的 output.csv")

    if not all_csvs:
        print("没有找到任何 output.csv 文件")
        return

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # 维护已用 sheet 名，避免截断/替换后重名或为空
    used_sheet_names = set()

    # 创建Excel写入器
    with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
        for game_name, platform, csv_path in sorted(all_csvs):
            print(f"  读取: {platform}/{game_name} -> {csv_path}")
            try:
                df = pd.read_csv(csv_path, encoding='utf-8-sig')
            except Exception as e:
                print(f"    [FAIL] 读取失败: {e}")
                continue
            # sheet名称不能超过31字符（Excel限制），替换非法字符
            sheet_name = make_unique_sheet_name(game_name, used_sheet_names)
            try:
                df.to_excel(writer, sheet_name=sheet_name, index=False)
            except Exception as e:
                print(f"    [FAIL] 写入失败: {e}")
                continue
            # 应用排版（与写入分开捕获：排版失败时数据已写入，需明确告警）
            try:
                style_worksheet(writer.sheets[sheet_name], df)
                print(f"    [OK] 写入成功: {len(df)} 条评论")
            except Exception as e:
                print(f"    [WARN] 排版失败（数据已写入）: {e}")

    print(f"\n>> 合并完成！输出文件: {output_path}")
    print(f">> 总计 {len(all_csvs)} 个游戏工作表")


def main():
    parser = argparse.ArgumentParser(description='合并所有游戏output.csv到单个Excel，每个游戏一个工作表')
    parser.add_argument('--output', '-o', type=str, help='输出Excel文件路径', default=None)
    parser.add_argument('--input-dir', '-i', type=str, help='output根目录',
                        default=os.path.join(PROJECT_ROOT, 'output'))
    args = parser.parse_args()

    if args.output is None:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        args.output = os.path.join(PROJECT_ROOT, 'reports', f"all_games_merged_{ts}.xlsx")

    merge_to_excel(args.output, args.input_dir)
    print(f"\n输出文件位置: {os.path.abspath(args.output)}")


if __name__ == "__main__":
    main()
