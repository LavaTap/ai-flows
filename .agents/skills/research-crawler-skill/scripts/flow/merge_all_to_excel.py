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
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPTS_DIR))

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


def find_all_output_csv(root_dir: str):
    """查找所有 output.csv 文件，返回 (游戏名, 平台, 文件路径) 列表"""
    results = []
    for platform in PLATFORMS:
        platform_dir = os.path.join(root_dir, platform)
        if not os.path.exists(platform_dir):
            continue
        # 遍历每个游戏文件夹
        for game_name in os.listdir(platform_dir):
            game_dir = os.path.join(platform_dir, game_name)
            if not os.path.isdir(game_dir):
                continue
            # 查找会话文件夹中的 output/output.csv
            for session_name in os.listdir(game_dir):
                session_dir = os.path.join(game_dir, session_name)
                if not os.path.isdir(session_dir):
                    continue
                output_csv = os.path.join(session_dir, 'output', 'output.csv')
                if os.path.exists(output_csv):
                    results.append((game_name, platform, output_csv))
                    break  # 每个游戏只取第一个会话（一般只有一个）
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

    # 宽列（需要自动换行 + 参与行高计算的列）：宽度 >= 20 的文本列
    wrap_col_idx = {i for i, w in enumerate(col_widths) if w >= 20}

    # 2. 表头样式
    for col_i in range(1, n_cols + 1):
        cell = ws.cell(row=1, column=col_i)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.border = THIN_BORDER
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
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
                cell.alignment = Alignment(vertical='top', horizontal='left', wrap_text=True)
            else:
                # 短文本列：居中
                cell.alignment = Alignment(vertical='center', horizontal='center', wrap_text=False)
        # 根据评论等长文本长度动态调整行高
        ws.row_dimensions[row_i].height = calc_row_height(list(row_values), col_widths, wrap_col_idx)

    # 4. 冻结首行 + 自动筛选
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = f"A1:{get_column_letter(n_cols)}{len(df) + 1}"

    # 5. 序号类首列视觉优化：稍窄页边距视图
    ws.sheet_view.zoomScale = 90


def merge_to_excel(output_path: str, root_dir: str = '.'):
    """合并所有 output.csv 到一个Excel文件（保留兼容入口）

    Deprecated: 内部按平台分组调用 merge_platform_to_excel，仅为兼容旧调用保留。
    """
    all_csvs = find_all_output_csv(root_dir)
    # 按平台分组
    by_platform = {}
    for game_name, platform, csv_path in all_csvs:
        by_platform.setdefault(platform, []).append((game_name, platform, csv_path))

    excel_dir = os.path.join(PROJECT_ROOT, 'excel')
    os.makedirs(excel_dir, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    for platform, items in sorted(by_platform.items()):
        out_file = os.path.join(excel_dir, f"{platform}_{ts}.xlsx")
        _write_platform_excel(out_file, items)


def _write_platform_excel(output_path: str, items: list):
    """将单个平台的所有游戏 output.csv 写入一个 Excel，每个游戏一个工作表。

    小红书特殊处理：同一游戏名称（搜索关键词）的多篇笔记合并为一个sheet。

    Args:
        output_path: 输出 Excel 文件路径。
        items: (game_name, platform, csv_path) 列表。
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    platform = items[0][1]
    print(f"\n>> 平台: {platform} — {len(items)} 个项目")

    # 小红书：按 CSV 内的 游戏名称 分组合并（同一关键词搜索的多篇笔记合并）
    if platform == 'xiaohongshu':
        # 先按文件夹名称读取，然后按 game_name（CSV内字段）分组
        # 外层文件夹名称就是游戏名称（因为批量采集按游戏建文件夹），所以以此为准
        grouped = {}
        for game_folder_name, _, csv_path in sorted(items):
            print(f"  读取: xiaohongshu/{game_folder_name} -> {csv_path}")
            try:
                df = pd.read_csv(csv_path, encoding='utf-8-sig')
                # 外层文件夹名称就是游戏名称（批量采集结构），所以直接用它作为分组键
                # 保证同一游戏所有笔记都在同一分组，即使CSV内有差异
                game_name = game_folder_name
                # 批量采集时文件名不能包含冒号，把冒号换成了下划线，恢复
                # 格式： "Sky_ Children of the Light" -> "Sky: Children of the Light"
                # 格式： "STORY OF SEASONS_ Grand Bazaar" -> "STORY OF SEASONS: Grand Bazaar"
                # 批量替换：所有 下划线+空格 变成 冒号+空格
                game_name = game_name.replace('_ ', ': ')
                # 如果还有下划线没替换（没有空格），替换第一个下划线为冒号+空格
                if '_' in game_name:
                    game_name = game_name.replace('_', ': ', 1)
                if game_name not in grouped:
                    grouped[game_name] = []
                grouped[game_name].append(df)
                print(f"    [OK] 读取成功: {len(df)} 条评论 -> 分组 [{game_name}]")
            except Exception as e:
                print(f"    [FAIL] 读取失败: {e}")

        # 每组合并后写入
        with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
            for game_name, dfs in sorted(grouped.items()):
                if len(dfs) > 1:
                    merged_df = pd.concat(dfs, ignore_index=True)
                    # 重新生成连续序号
                    if '序号' in merged_df.columns:
                        merged_df['序号'] = range(1, len(merged_df) + 1)
                else:
                    merged_df = dfs[0]
                sheet_name = game_name[:31].replace(':', '_').replace('\\', '_').replace('/', '_').replace('?', '').replace('*', '').replace('[', '').replace(']', '')
                merged_df.to_excel(writer, sheet_name=sheet_name, index=False)
                style_worksheet(writer.sheets[sheet_name], merged_df)
                print(f"  写入sheet [{sheet_name}]: {len(merged_df)} 条评论" +
                      (f" (合并 {len(dfs)} 篇笔记)" if len(dfs) > 1 else ""))

    # B站/Steam：保持原有逻辑，一个文件夹一个游戏
    else:
        with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
            for game_name, platform, csv_path in sorted(items):
                print(f"  读取: {platform}/{game_name} -> {csv_path}")
                try:
                    df = pd.read_csv(csv_path, encoding='utf-8-sig')
                    sheet_name = game_name[:31].replace(':', '_').replace('\\', '_').replace('/', '_').replace('?', '').replace('*', '').replace('[', '').replace(']', '')
                    df.to_excel(writer, sheet_name=sheet_name, index=False)
                    style_worksheet(writer.sheets[sheet_name], df)
                    print(f"    [OK] 写入成功: {len(df)} 条评论")
                except Exception as e:
                    print(f"    [FAIL] 读取失败: {e}")

    print(f">> 平台 Excel 完成: {output_path}")


def merge_platform_to_excel(platform: str, root_dir: str = None, output_dir: str = None):
    """合并单个平台的所有游戏 output.csv 到一个 Excel 文件。

    输出到 excel/{platform}_{timestamp}.xlsx，每个游戏作为独立工作表。

    Args:
        platform: 平台名 (bilibili/steam/xiaohongshu)。
        root_dir: output 根目录，默认项目 output/。
        output_dir: Excel 输出目录，默认项目 excel/。
    """
    if root_dir is None:
        root_dir = os.path.join(PROJECT_ROOT, 'output')
    if output_dir is None:
        output_dir = os.path.join(PROJECT_ROOT, 'excel')
    os.makedirs(output_dir, exist_ok=True)

    platform_dir = os.path.join(root_dir, platform)
    items = []
    if os.path.exists(platform_dir):
        for game_name in os.listdir(platform_dir):
            game_dir = os.path.join(platform_dir, game_name)
            if not os.path.isdir(game_dir):
                continue
            for session_name in os.listdir(game_dir):
                session_dir = os.path.join(game_dir, session_name)
                if not os.path.isdir(session_dir):
                    continue
                output_csv = os.path.join(session_dir, 'output', 'output.csv')
                if os.path.exists(output_csv):
                    items.append((game_name, platform, output_csv))
                    # 小红书：一个游戏有多篇笔记（多个会话），不要break
                    # B站/Steam：一般只有一个会话，多次也没关系，都会保留

    if not items:
        print(f"[{platform}] 没有找到任何 output.csv 文件")
        return None

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = os.path.join(output_dir, f"{platform}_{ts}.xlsx")
    _write_platform_excel(output_path, items)
    print(f"\n输出文件位置: {os.path.abspath(output_path)}")
    return output_path


def main():
    parser = argparse.ArgumentParser(description='按平台合并 output.csv 到 Excel，每个平台一个文件，每个游戏一个工作表')
    parser.add_argument('--platform', '-p', type=str, default=None,
                        help='指定单个平台 (bilibili/steam/xiaohongshu)，不指定则处理所有平台')
    parser.add_argument('--input-dir', '-i', type=str, help='output根目录',
                        default=os.path.join(PROJECT_ROOT, 'output'))
    parser.add_argument('--output-dir', '-o', type=str, help='Excel输出目录',
                        default=os.path.join(PROJECT_ROOT, 'excel'))
    args = parser.parse_args()

    platforms = [args.platform] if args.platform else PLATFORMS
    generated = []
    for platform in platforms:
        path = merge_platform_to_excel(platform, args.input_dir, args.output_dir)
        if path:
            generated.append(path)

    if generated:
        print(f"\n{'='*50}")
        print(f"共生成 {len(generated)} 个平台 Excel 文件:")
        for p in generated:
            print(f"  {os.path.abspath(p)}")
        print('=' * 50)
    else:
        print("\n未生成任何 Excel 文件（无可用 output.csv）")


if __name__ == "__main__":
    main()
