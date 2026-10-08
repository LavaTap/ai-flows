# -*- coding: utf-8 -*-
"""
工作区初始化脚本 —— 首次加载 skill 时必须先运行此脚本。

功能：
  在项目根目录（与 skill 同级）创建以下目录框架：
    output/{bilibili,steam,xiaohongshu}/   — 各平台采集产出根目录
    excel/                                  — 各平台 Excel 汇总输出目录
    reports/{bilibili,steam,xiaohongshu}/   — 各平台报告根目录
      ├── ai/        — AI 分析报告
      ├── error/     — 错误检测报告
      ├── limit/     — AI 预处理（截断）报告
      └── program/   — 运行日志与采集报告（按会话名分子目录）

  脚本幂等：已存在的目录不会被删除或覆盖，仅补建缺失目录。

用法：
    venv/Scripts/python.exe research-crawler-skill/scripts/init_workspace.py
"""
import os
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)

# 支持的平台
PLATFORMS = ['bilibili', 'steam', 'xiaohongshu']

# reports 下每个平台的子目录（与 program/ 平级）
REPORT_SUBDIRS = ['ai', 'error', 'limit', 'program']


def main():
    created = []
    existed = []

    # 1. output/{platform}/
    output_root = os.path.join(PROJECT_ROOT, 'output')
    for platform in PLATFORMS:
        d = os.path.join(output_root, platform)
        if os.path.isdir(d):
            existed.append(d)
        else:
            os.makedirs(d, exist_ok=True)
            created.append(d)

    # 2. excel/
    excel_dir = os.path.join(PROJECT_ROOT, 'excel')
    if os.path.isdir(excel_dir):
        existed.append(excel_dir)
    else:
        os.makedirs(excel_dir, exist_ok=True)
        created.append(excel_dir)

    # 3. reports/{platform}/{ai,error,limit,program}/
    reports_root = os.path.join(PROJECT_ROOT, 'reports')
    for platform in PLATFORMS:
        for sub in REPORT_SUBDIRS:
            d = os.path.join(reports_root, platform, sub)
            if os.path.isdir(d):
                existed.append(d)
            else:
                os.makedirs(d, exist_ok=True)
                created.append(d)

    # 输出汇总
    print('=' * 60)
    print('工作区初始化完成')
    print('=' * 60)
    print(f'项目根目录: {PROJECT_ROOT}')
    print(f'本次新建目录: {len(created)} 个')
    for d in created:
        print(f'  [新建] {os.path.relpath(d, PROJECT_ROOT)}')
    if existed:
        print(f'已存在目录: {len(existed)} 个（跳过）')
    print('')
    print('目录框架:')
    print('  output/{bilibili,steam,xiaohongshu}/')
    print('  excel/')
    print('  reports/{bilibili,steam,xiaohongshu}/')
    print('    ├── ai/        AI分析报告')
    print('    ├── error/     错误检测报告')
    print('    ├── limit/     AI预处理(截断)报告')
    print('    └── program/   运行日志与采集报告')
    print('=' * 60)


if __name__ == '__main__':
    main()
