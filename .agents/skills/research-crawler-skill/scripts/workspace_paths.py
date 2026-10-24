# -*- coding: utf-8 -*-
"""
workspace_paths —— 本 skill 产出目录的唯一来源。

所有采集产出统一写到仓库根的 .agents/agents-output/ 下：
    .agents/agents-output/output/{平台}/...    — 采集产出
    .agents/agents-output/excel/               — Excel 汇总
    .agents/agents-output/reports/{平台}/...   — 运行日志与报告

仓库根通过「向上查找包含 .agents 目录的目录」定位，因此本 skill 放在
<仓库根>/.agents/skills/research-crawler-skill 下即可正确解析。
"""
import os

# 本文件位于 <仓库根>/.agents/skills/research-crawler-skill/scripts/
_HERE = os.path.dirname(os.path.abspath(__file__))


def find_repo_root(start=None):
    """从 start 开始向上找包含 .agents 目录的仓库根。"""
    cur = os.path.abspath(start or _HERE)
    while True:
        if os.path.isdir(os.path.join(cur, '.agents')):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    # 兜底：按 <仓库根>/.agents/skills/<skill>/scripts 反推四级
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(_HERE))))


# AI-Flows 仓库根
REPO_ROOT = find_repo_root()
# 所有 agent 产出根
AGENTS_OUTPUT = os.path.join(REPO_ROOT, '.agents', 'agents-output')
# 采集产出 / Excel 汇总 / 报告
OUTPUT_ROOT = os.path.join(AGENTS_OUTPUT, 'output')
EXCEL_DIR = os.path.join(AGENTS_OUTPUT, 'excel')
REPORTS_ROOT = os.path.join(AGENTS_OUTPUT, 'reports')
