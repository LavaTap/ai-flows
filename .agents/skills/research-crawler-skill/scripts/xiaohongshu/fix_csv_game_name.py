# -*- coding: utf-8 -*-
"""
修复已采集 output.csv 中的游戏名称字段

问题：原代码错误地使用 笔记标题/note_id 作为 CSV 中的"游戏名称"字段
修复：正确使用 搜索关键词（目录名）作为"游戏名称"字段

运行：
    venv/Scripts/python.exe research-crawler-skill/scripts/xiaohongshu/fix_csv_game_name.py
"""

import os
import csv

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output', 'xiaohongshu')


def fix_csv_game_name(csv_path: str, correct_game_name: str) -> bool:
    """修正 CSV 中所有行的游戏名称字段。"""
    rows = []
    fieldnames = None
    modified = False

    try:
        with open(csv_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames
            if not fieldnames:
                return False

            if '游戏名称' not in fieldnames:
                # 如果缺少'游戏名称'字段，则添加它
                fieldnames.append('游戏名称')
                print(f"    添加'游戏名称'字段到: {csv_path}")
                modified = True # 标记为已修改，因为字段结构改变了

            for row in reader:
                old_name = row.get('游戏名称')
                # 如果字段不存在、为空或不正确，则更新
                if old_name is None or old_name == '' or old_name != correct_game_name:
                    row['游戏名称'] = correct_game_name
                    modified = True
                rows.append(row)

        if modified:
            with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(rows)
            return True

        return False

    except Exception as e:
        print(f"  读取失败: {csv_path}, 错误: {e}")
        return False


def main():
    import sys
    # 解决 Windows 中文编码问题
    if sys.stdout.encoding != 'utf-8':
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except AttributeError:
            pass

    total_files = 0
    total_fixed = 0

    print("=" * 70)
    print("Xiaohongshu CSV game name fix")
    print(f"Scan directory: {OUTPUT_DIR}")
    print("=" * 70)

    # 遍历每个游戏目录
    # 强制 os.listdir 用 UTF-8 解码（解决 Windows 中文编码问题）
    for game_name in os.listdir(OUTPUT_DIR):
        # 确保名称是正确 Unicode
        if isinstance(game_name, bytes):
            game_name = game_name.decode('utf-8')
        game_dir = os.path.join(OUTPUT_DIR, game_name)
        if not os.path.isdir(game_dir):
            continue

        # 游戏名称就是目录名（就是搜索关键词）
        # Windows 路径不允许 :"?* 所以保存时替换了，这里还原
        correct_game_name = game_name
        correct_game_name = correct_game_name.replace('_', ':')
        correct_game_name = correct_game_name.replace('__', '?')
        correct_game_name = correct_game_name.replace('^', '"')
        print(f"\nGame: {correct_game_name}")

        # 遍历每个笔记会话目录
        for note_session in os.listdir(game_dir):
            if isinstance(note_session, bytes):
                note_session = note_session.decode('utf-8')
            note_dir = os.path.join(game_dir, note_session)
            if not os.path.isdir(note_dir):
                continue

            output_csv = os.path.join(note_dir, 'output', 'output.csv')
            if os.path.exists(output_csv):
                total_files += 1
                fixed = fix_csv_game_name(output_csv, correct_game_name)
                if fixed:
                    print(f"  [OK] 已修复: {note_session}")
                    total_fixed += 1
                else:
                    print(f"  [OK] 已正确: {note_session}")

    print("\n" + "=" * 70)
    print(f"Fix complete")
    print(f"Total files: {total_files}")
    print(f"Fixed files: {total_fixed}")
    print("=" * 70)


if __name__ == '__main__':
    main()
