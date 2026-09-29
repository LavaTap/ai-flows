# -*- coding: utf-8 -*-
"""
批量 AI 分析脚本：读取 comments_for_ai.csv，用 classify_by_ai 分析，回写到 output.csv

产出：
  - {会话目录}/analysis/output.csv — 仅已分析评论（≤50条，12字段全填充）
  - {会话目录}/output/output.csv — 全量评论（合并后，已分析的行填充AI字段）
  - reports/{platform}/program/ai/{session_name}/ai_report.md — 每个会话一份AI报告

用法:
    # 测试单个项目
    python research-crawler-skill/scripts/batch_ai_analysis.py --session-dir "output/bilibili/A Short Hike/A Short Hike_20260723_112807"

    # 批量处理所有项目
    python research-crawler-skill/scripts/batch_ai_analysis.py

    # 从上一次中断处继续
    python research-crawler-skill/scripts/batch_ai_analysis.py --resume
"""
import argparse
import csv
import os
import re
import sys
import time
from datetime import datetime

# ============ 路径 ============
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
PROJECT_ROOT = os.path.dirname(SKILL_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output')

MAX_COMMENTS = 50

# 支持的平台
PLATFORMS = ['bilibili', 'steam', 'xiaohongshu']

# ---------- 以下为 classify_by_ai 函数，从 process_comments.py 复用 ----------

HEALING_TAGS = ["放松解压","安心平静","温暖陪伴","美术疗愈","音乐疗愈","自然疗愈",
                "慢节奏休闲","情绪共鸣","社交温情","创造满足","可爱愉悦","非治愈/负向"]
ATTRACTION_TAGS = ["治愈感","美术","音乐","玩法","探索","建造装饰","收集养成",
                   "剧情角色","社交","低压力","价格/口碑","其他"]


def strip_meta(text):
    t = re.sub(r'回复\s*@[^：:\s]+[：:]\s*', '', text)
    t = re.sub(r'@\S+\s*', '', t)
    return t.strip()


def has_emoji(text):
    pos = ['星星眼','打call','脸红','喜欢','点赞','OK','比心','脱单doge','打尻','微笑']
    neg = ['大哭','无语','疑惑']
    return ([e for e in pos if f'[{e}]' in text or f'[{e}' in text],
            [e for e in neg if f'[{e}]' in text or f'[{e}' in text])


def classify_by_ai(text):
    """基于 SKILL.md 规则 + 语义规则进行 AI 级别分析。两轮分析: 第一轮初判 + 第二轮正向优先复核。"""
    pure = strip_meta(text)

    strong_pos_words = ["喜欢","推荐","好玩","舒服","可爱","漂亮","放松","温暖",
                        "平静","治愈","解压","陪伴","沉浸","自由","惬意","唯美",
                        "感动","温馨","种草","期待","爱了","最爱","棒","绝了",
                        "惊艳","有趣","好治愈","好可爱","好喜欢","好美","很不错",
                        "打call","好治愈","致敬","热爱","有意思","有意义","最棒",
                        "想玩","挺好的","好宁静","怀念","沁人心脾","好心水",
                        "美腻","心水","兴奋","哇哇哇","为游戏买单",
                        "好想","想哭","没有绷住","哭出来","泪水","泪目","哽咽",
                        "泪流满面","泪崩","哭了","治愈系","治好了","好舒服",
                        "真舒服","太棒","太美","动人","震撼","绝美","好暖","暖心",
                        "好温馨"]
    strong_pos = [w for w in strong_pos_words if w in pure]

    extra_pos_patterns = [
        r'好\w+玩', r'很\w+好', r'从\w+玩到了', r'住在',
        r'^最', r'入.*谷', r'就要', r'神作',
        r'治好.*精神', r'治愈.*心灵', r'温暖.*梦', r'温暖.*软',
        r'登顶', r'爬山', r'滑翔', r'飞到',
    ]
    extra_pos = any(re.search(p, pure) for p in extra_pos_patterns)

    art_words = ["画风","画面","好看","好听","漂亮","唯美","配色","色彩","艺术",
                 "像素","美术","音乐","BGM","bgm","配乐","音效","风景"]
    art_hit = [w for w in art_words if w in pure]

    neg_words = ["失望","无聊","压抑","焦虑","烦躁","太肝","太累","后悔","不推荐",
                 "退款","差评","不好玩","没意思","不喜欢","卸载","头晕","无趣",
                 "不想玩","不玩了","更抑郁","去世","离开了我","不会再"]
    strong_neg = [w for w in neg_words if w in pure]

    neg_patterns = [r'就像继续上班', r'起早贪黑', r'凭什么']
    extra_neg = any(re.search(p, pure) for p in neg_patterns)

    is_func = False
    if not text or len(text.strip()) <= 1:
        is_func = True
    elif text.startswith('@'):
        is_func = True
    elif re.match(r'^回复\s*@', text):
        is_func = True

    stripped_text = re.sub(r'\[.*?\]', '', text).strip()
    short_positive = {"好宁静","好治愈","好可爱","好喜欢","好美","好治愈","爱了","特别好玩","太美了","好棒","暖暖的","太暖","真好","好暖"}
    if len(stripped_text) <= 3 and stripped_text not in short_positive:
        is_func = True

    pos_emoji, neg_emoji = has_emoji(text)
    special_pos = bool(re.search(r'有一种想哭的美|好宁静|哇哇哇|爱了|好想玩|没有绷住|哭出来|哭了|泪崩|泪目|治好了|好想好想', pure))

    # ---- 第一轮判定 ----
    strong_neg_combined = strong_neg or extra_neg
    strong_pos_combined = strong_pos or extra_pos

    if (strong_neg_combined or neg_emoji) and not (strong_pos_combined or pos_emoji or special_pos):
        sentiment = "负向"
        keywords = (strong_neg + (["不想玩"] if extra_neg else []))[:5]
    elif (strong_neg_combined or neg_emoji) and (strong_pos_combined or pos_emoji or special_pos):
        sentiment = "混合"
        keywords = (strong_pos + pos_emoji + strong_neg)[:5]
    elif strong_pos_combined or pos_emoji or special_pos:
        sentiment = "正向"
        keywords = (strong_pos + pos_emoji)[:5]
    elif art_hit:
        sentiment = "正向"
        keywords = art_hit[:5]
    else:
        sentiment = "中性"
        keywords = []

    # ---- 第二轮复核（正向优先） ----
    final_sent = sentiment
    notes = ""

    if sentiment == "中性":
        if stripped_text in short_positive:
            final_sent = "正向"
            notes = "上调：短正向表达"
        elif strong_pos_combined:
            final_sent = "正向"
            notes = "上调：发现正向线索"
        elif art_hit:
            final_sent = "正向"
            notes = "上调：美术/音乐等正向元素"
        elif extra_pos:
            final_sent = "正向"
            notes = "上调：隐含正向表达"
        elif re.search(r'有意思|有意义|致敬|热爱|温暖|感动|泪目|好想', pure):
            final_sent = "正向"
            notes = "上调：表达积极态度或情感共鸣"
        elif is_func or len(stripped_text) <= 4:
            notes = "维持：纯功能性/简短评论"
        else:
            notes = "维持：信息不足或纯讨论"

    if sentiment == "负向" and (strong_pos_combined or art_hit or pos_emoji):
        if (strong_neg or extra_neg) and (strong_pos or pos_emoji):
            final_sent = "混合"
            notes = "上调：正反证据并存"
        elif art_hit and not strong_neg:
            final_sent = "正向"
            notes = "上调：美术/音乐元素予以上调"

    if sentiment == "混合":
        if strong_pos_combined and not strong_neg:
            final_sent = "正向"
            notes = "上调：正向线索压倒轻度负面"

    if final_sent == "正向" and not notes:
        notes = "维持：正向"
    if sentiment == "负向" and not notes and extra_neg and not strong_pos:
        notes = "维持：强负面证据，不上调"

    # ---- 治愈相关度评分 ----
    if "治愈" in pure or "疗愈" in pure:
        healing = "是"
        relevance = 5
    elif any(w in pure for w in ["舒服","平静","放松","温暖","可爱","惬意","沉浸",
                                  "解压","舒缓","宁静","温馨","暖心","唯美"]):
        healing = "间接相关"
        relevance = 4
    elif art_hit:
        healing = "间接相关"
        relevance = 3
    elif final_sent == "负向":
        healing = "否"
        relevance = 1
    else:
        healing = "否"
        relevance = 2

    if final_sent in ("正向", "混合") and relevance < 4 and (strong_pos_combined or art_hit):
        relevance = max(relevance, 3)

    # ---- 治愈感受细分 ----
    tag_map = {
        "放松解压": ["放松","解压","舒缓","减压","轻松"],
        "安心平静": ["平静","宁静","安静","安心","静心","平和"],
        "温暖陪伴": ["温暖","陪伴","温馨","暖心","温情"],
        "美术疗愈": ["美术","画风","画面","像素","艺术","漂亮","唯美","好看","美腻","色彩","配色"],
        "音乐疗愈": ["音乐","BGM","配乐","好听","音效","旋律","bgm"],
        "自然疗愈": ["自然","风景","森林","河流","花","草","阳光"],
        "慢节奏休闲": ["休闲","慢节奏","养老","慢","惬意","节奏","种田"],
        "情绪共鸣": ["感动","共鸣","想哭","怀念","回忆","小时候","童年","泪水",
                      "泪目","泪崩","哽咽","妈妈","母爱","母亲"],
        "社交温情": ["联机","朋友","一起","社交","结婚","村民","NPC","开黑","陪伴"],
        "创造满足": ["建造","装饰","种地","农场","创造","装修","种","酿酒","炸矿","钓鱼"],
        "可爱愉悦": ["可爱","萌","有趣","喜欢","开心","快乐","好玩","好","棒"],
    }
    tags = []
    for tag, kws in tag_map.items():
        if any(k in pure for k in kws):
            tags.append(tag)
    if not tags:
        tags = ["可爱愉悦"] if final_sent == "正向" else ["慢节奏休闲"]

    # ---- 吸引游玩因素 ----
    attr_map = {
        "治愈感": ["治愈","疗愈","解压","放松","平静","温暖"],
        "美术": ["美术","画风","画面","像素","艺术","漂亮","好看","唯美","色彩","配色"],
        "音乐": ["音乐","BGM","配乐","好听","音效","bgm"],
        "玩法": ["玩法","操作","机制","系统","开放","自由","demo","试玩","mod","种田"],
        "探索": ["探索","冒险","收集","找","解谜","收藏","钓鱼"],
        "建造装饰": ["建造","装饰","装修","种地","农场","耕","酿酒","炸矿"],
        "收集养成": ["收集","养成","成就","全"],
        "剧情角色": ["剧情","故事","角色","人物","NPC","情节","作者","制作人"],
        "社交": ["联机","朋友","一起","社交","合作","开黑","陪伴"],
        "低压力": ["低压力","休闲","养老","压力","自由","随心","没压力"],
        "价格/口碑": ["价格","免费","打折","好评","口碑","推荐","买"],
    }
    factors = []
    for f, kws in attr_map.items():
        if any(k in pure for k in kws):
            factors.append(f)
    if not factors:
        factors = ["其他"]

    # ---- 判断依据 ----
    sentences = re.split(r'[。！？，,\.!?]', pure)
    meaningful = [s.strip() for s in sentences if len(s.strip()) >= 4 and
                  any(c.isalpha() for c in s)]
    basis_parts = meaningful[:2] if meaningful else [pure[:30]]
    basis_parts.append(f"治愈感受:{','.join(tags[:2])}")
    basis_parts.append(f"吸引因素:{','.join(factors[:2])}")

    return {
        "情绪倾向": final_sent,
        "情绪关键词": "、".join(keywords) if keywords else "",
        "是否提及治愈": healing,
        "治愈相关度": str(relevance),
        "治愈感受细分": "、".join(tags[:3]),
        "吸引游玩因素": "、".join(factors[:3]),
        "判断依据": "；".join(basis_parts),
        "复核调整说明": notes,
    }


# ---------- 辅助函数 ----------

def normalize_text(text):
    """归一化文本：移除所有空白字符，用于模糊匹配"""
    return re.sub(r'\s+', '', text).strip()


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
    return 'bilibili'


def get_session_name(session_dir: str) -> str:
    """获取会话目录名（如 A Little to the Left_20260723_111926）"""
    return os.path.basename(session_dir)


def find_session_dirs(root_dir):
    """查找所有包含 comments_for_ai.csv 或 output.csv 的会话目录"""
    result = []
    for dirpath, dirnames, filenames in os.walk(root_dir):
        # 优先找有 comments_for_ai.csv 的
        if 'comments' in dirnames:
            comments_dir = os.path.join(dirpath, 'comments')
            for_ai_csv = os.path.join(comments_dir, 'comments_for_ai.csv')
            if os.path.exists(for_ai_csv):
                result.append(dirpath)
                continue
        # 退而求其次找有 output.csv 的
        if 'output' in dirnames:
            output_csv = os.path.join(dirpath, 'output', 'output.csv')
            if os.path.exists(output_csv):
                result.append(dirpath)
    return sorted(set(result))


def has_ai_result(session_dir):
    """检查是否已有 AI 分析结果（analysis/output.csv 是否存在）"""
    analysis_csv = os.path.join(session_dir, 'analysis', 'output.csv')
    return os.path.exists(analysis_csv)


# ---------- 主分析逻辑 ----------

def analyze_session(session_dir):
    """对单个会话目录执行 AI 分析

    流程:
      1. 读取 comments/comments_for_ai.csv 作为输入（若无则回退到 output/output.csv 前50条）
      2. 逐条 AI 分析（classify_by_ai），填充 8 个 AI 字段
      3. 写入 analysis/output.csv（仅已分析评论，12 字段全填充）
      4. 合并回 output/output.csv（按文本匹配回填 AI 字段，未分析的行 AI 字段留空）
      5. 生成 reports/{platform}/program/ai/{session_name}/ai_report.md
    """
    rel_path = os.path.relpath(session_dir, PROJECT_ROOT)
    session_name = get_session_name(session_dir)
    platform = detect_platform(session_dir)
    print(f"\n{'='*60}")
    print(f"分析: {rel_path} (平台: {platform})")

    # 1. 确定输入源：优先 comments_for_ai.csv
    for_ai_csv = os.path.join(session_dir, 'comments', 'comments_for_ai.csv')
    input_csv = None
    total_count = 0

    if os.path.exists(for_ai_csv):
        input_csv = for_ai_csv
        with open(for_ai_csv, 'r', encoding='utf-8-sig') as f:
            input_rows = list(csv.DictReader(f))
        total_count = len(input_rows)
        print(f"  输入: comments_for_ai.csv ({total_count} 条)")
    else:
        # 回退到 output.csv，手动截断到50条
        out_csv_fallback = os.path.join(session_dir, 'output', 'output.csv')
        if os.path.exists(out_csv_fallback):
            print("  回退: 无 comments_for_ai.csv，使用 output/output.csv 前50条")
            with open(out_csv_fallback, 'r', encoding='utf-8-sig') as f:
                all_rows = list(csv.DictReader(f))
            input_rows = []
            for idx, row in enumerate(all_rows[:MAX_COMMENTS], 1):
                input_rows.append({'序号': str(idx), '评论内容': row.get('评论内容', '')})
            total_count = len(input_rows)
            print(f"  输入: output.csv ({len(all_rows)} -> {total_count} 条)")
        else:
            print("  !! 未找到 comments/comments_for_ai.csv 或 output/output.csv")
            return None

    if not input_rows:
        print("  !! 无评论数据")
        return None

    # 2. 读取 output.csv（用于回填平台、游戏名称）
    out_csv = os.path.join(session_dir, 'output', 'output.csv')
    if not os.path.exists(out_csv):
        print(f"  !! 未找到 {out_csv}")
        return None

    with open(out_csv, 'r', encoding='utf-8-sig') as f:
        out_rows = list(csv.DictReader(f))

    print(f"  output.csv: {len(out_rows)} 条记录")

    # 3. 逐条 AI 分析，构建 analysis_rows（已分析评论的完整 12 字段记录）
    fieldnames = ["序号","平台","游戏名称","评论内容","情绪倾向","情绪关键词",
                  "是否提及治愈","治愈相关度","治愈感受细分","吸引游玩因素",
                  "判断依据","复核调整说明"]

    # 从 output.csv 推断平台和游戏名称
    platform_label = "B站"
    game_name = ""
    if out_rows:
        platform_label = out_rows[0].get('平台', 'B站') or 'B站'
        game_name = out_rows[0].get('游戏名称', '') or ''

    analysis_rows = []
    for idx, row in enumerate(input_rows, 1):
        text = row['评论内容']
        ai_result = classify_by_ai(text)
        analysis_rows.append({
            '序号': str(idx),
            '平台': platform_label,
            '游戏名称': game_name,
            '评论内容': text,
            '情绪倾向': ai_result['情绪倾向'],
            '情绪关键词': ai_result['情绪关键词'],
            '是否提及治愈': ai_result['是否提及治愈'],
            '治愈相关度': ai_result['治愈相关度'],
            '治愈感受细分': ai_result['治愈感受细分'],
            '吸引游玩因素': ai_result['吸引游玩因素'],
            '判断依据': ai_result['判断依据'],
            '复核调整说明': ai_result['复核调整说明'],
        })

    # 4. 写入 analysis/output.csv（仅已分析评论，12 字段全填充）
    analysis_dir = os.path.join(session_dir, 'analysis')
    os.makedirs(analysis_dir, exist_ok=True)
    analysis_csv = os.path.join(analysis_dir, 'output.csv')
    with open(analysis_csv, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(analysis_rows)
    print(f"  已生成: analysis/output.csv ({len(analysis_rows)} 条已分析)")

    # 5. 合并回 output/output.csv：按文本匹配回填 AI 字段
    out_by_normalized = {}
    for r in out_rows:
        norm = normalize_text(r.get('评论内容', ''))
        out_by_normalized[norm] = r

    write_back_count = 0
    not_found_count = 0

    for analysis_row in analysis_rows:
        ai_text = analysis_row['评论内容']
        norm_ai = normalize_text(ai_text)

        matched_row = out_by_normalized.get(norm_ai)
        if matched_row is None:
            # 尝试更宽松的匹配：取前50字符
            for norm, r in out_by_normalized.items():
                if norm_ai[:50] in norm or norm[:50] in norm_ai:
                    matched_row = r
                    break

        if matched_row is None:
            not_found_count += 1
        else:
            matched_row['情绪倾向'] = analysis_row['情绪倾向']
            matched_row['情绪关键词'] = analysis_row['情绪关键词']
            matched_row['是否提及治愈'] = analysis_row['是否提及治愈']
            matched_row['治愈相关度'] = analysis_row['治愈相关度']
            matched_row['治愈感受细分'] = analysis_row['治愈感受细分']
            matched_row['吸引游玩因素'] = analysis_row['吸引游玩因素']
            matched_row['判断依据'] = analysis_row['判断依据']
            matched_row['复核调整说明'] = analysis_row['复核调整说明']
            write_back_count += 1

    # 6. 写回 output/output.csv（合并后：全部行，AI 字段已回填）
    with open(out_csv, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(out_rows)

    # 7. 生成 per-session AI 报告：reports/{platform}/program/ai/{session_name}/ai_report.md
    report_result = generate_session_report(
        session_dir, platform, session_name, analysis_rows, out_rows,
        write_back_count, not_found_count)

    # 8. 统计
    sentiments = [r['情绪倾向'] for r in analysis_rows if r.get('情绪倾向')]
    total_analyzed = len(sentiments)
    sent_counts = {}
    for s in sentiments:
        sent_counts[s] = sent_counts.get(s, 0) + 1

    print(f"  合并回写: {write_back_count}/{total_count} (未匹配: {not_found_count})")
    print(f"  已分析: {total_analyzed} 条 (analysis/output.csv)")
    print(f"  总记录: {len(out_rows)} 条 (output/output.csv 合并后)")
    for s in ["正向","中性","负向","混合"]:
        c = sent_counts.get(s, 0)
        if total_analyzed > 0:
            print(f"    {s}: {c} ({c/total_analyzed*100:.1f}%)")

    return {
        'session_dir': session_dir,
        'session_name': session_name,
        'platform': platform,
        'total': len(out_rows),
        'analyzed': total_analyzed,
        'written': write_back_count,
        'not_found': not_found_count,
        'sentiments': sent_counts,
        'analysis_csv': analysis_csv,
        'report_path': report_result,
    }


def generate_session_report(session_dir, platform, session_name, analysis_rows,
                            out_rows, write_back_count, not_found_count):
    """生成单个会话的 AI 分析报告到 reports/{platform}/program/ai/{session_name}/ai_report.md

    报告文件夹名与 output 会话目录名一致，便于对应。
    """
    reports_ai_dir = os.path.join(
        PROJECT_ROOT, 'reports', platform, 'ai', session_name)
    os.makedirs(reports_ai_dir, exist_ok=True)
    report_path = os.path.join(reports_ai_dir, 'ai_report.md')
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    sentiments = [r['情绪倾向'] for r in analysis_rows if r.get('情绪倾向')]
    total_analyzed = len(sentiments)
    sent_counts = {}
    for s in sentiments:
        sent_counts[s] = sent_counts.get(s, 0) + 1

    rel_path = os.path.relpath(session_dir, PROJECT_ROOT)

    lines = []
    lines.append('# AI 分析报告\n')
    lines.append(f'- 平台: {platform}')
    lines.append(f'- 会话: {session_name}')
    lines.append(f'- 项目路径: `{rel_path}`')
    lines.append(f'- 生成时间: {now}\n')

    lines.append('## 统计概览\n')
    lines.append('| 统计项 | 数值 |')
    lines.append('| --- | --- |')
    lines.append(f'| 总评论数 | {len(out_rows)} |')
    lines.append(f'| 已分析数 | {total_analyzed} |')
    lines.append(f'| 合并回写 | {write_back_count} |')
    lines.append(f'| 未匹配 | {not_found_count} |\n')

    lines.append('## 情绪分布\n')
    lines.append('| 情绪倾向 | 数量 | 占比 |')
    lines.append('| --- | --- | --- |')
    for s in ["正向","中性","负向","混合"]:
        c = sent_counts.get(s, 0)
        pct = f"{c/total_analyzed*100:.1f}%" if total_analyzed > 0 else "0%"
        lines.append(f'| {s} | {c} | {pct} |')
    lines.append('')

    lines.append('## 分析明细（前20条预览）\n')
    lines.append('| 序号 | 情绪倾向 | 治愈相关度 | 治愈感受细分 | 评论内容(摘要) |')
    lines.append('| --- | --- | --- | --- | --- |')
    for r in analysis_rows[:20]:
        msg = r['评论内容'].replace('\n', ' ').replace('|', '\\|')[:50]
        lines.append(f"| {r['序号']} | {r['情绪倾向']} | {r['治愈相关度']} | {r['治愈感受细分']} | {msg} |")
    if len(analysis_rows) > 20:
        lines.append(f'\n> 共 {len(analysis_rows)} 条，仅显示前20条。')
    lines.append('')

    lines.append('## 产出文件\n')
    lines.append(f'- `analysis/output.csv` — 已分析评论（{total_analyzed}条，12字段全填充）')
    lines.append(f'- `output/output.csv` — 全量评论（{len(out_rows)}条，已合并AI字段）')

    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print(f"  AI报告: {report_path}")
    return report_path


def generate_batch_summary(results, batch_ts):
    """生成批量汇总报告到各平台的 reports/{platform}/program/ai/batch_{batch_ts}/"""
    # 按平台分组
    platform_results = {}
    for r in results:
        if r is None:
            continue
        platform = r.get('platform', 'bilibili')
        platform_results.setdefault(platform, []).append(r)

    for platform, plat_results in platform_results.items():
        batch_dir = os.path.join(
            PROJECT_ROOT, 'reports', platform, 'ai', f'batch_{batch_ts}')
        os.makedirs(batch_dir, exist_ok=True)
        report_path = os.path.join(batch_dir, 'ai_batch_report.md')
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        lines = []
        lines.append('# AI 分析批量汇总报告\n')
        lines.append(f'- 平台: {platform}')
        lines.append(f'- 生成时间: {now}')
        lines.append(f'- 批次: {batch_ts}')
        lines.append(f'- 项目数: {len(plat_results)}\n')

        lines.append('## 各项目统计\n')
        lines.append('| 序号 | 会话名 | 总条数 | 已分析 | 正向 | 中性 | 负向 | 混合 |')
        lines.append('| --- | --- | --- | --- | --- | --- | --- | --- |')
        total_sent = {}
        for i, r in enumerate(plat_results, 1):
            s = r['sentiments']
            lines.append(f"| {i} | `{r['session_name']}` | {r['total']} | {r['analyzed']} | "
                         f"{s.get('正向',0)} | {s.get('中性',0)} | {s.get('负向',0)} | {s.get('混合',0)} |")
            for k, v in s.items():
                total_sent[k] = total_sent.get(k, 0) + v

        total_comments = sum(r['total'] for r in plat_results)
        total_analyzed = sum(r['analyzed'] for r in plat_results)
        lines.append('')
        lines.append('## 总体统计\n')
        lines.append(f'- 总项目: {len(plat_results)}')
        lines.append(f'- 总评论: {total_comments}')
        lines.append(f'- 已分析: {total_analyzed}')
        for s in ["正向","中性","负向","混合"]:
            c = total_sent.get(s, 0)
            pct = c/total_analyzed*100 if total_analyzed > 0 else 0
            lines.append(f'- {s}: {c} ({pct:.1f}%)')

        with open(report_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
        print(f"\n[{platform}] 批量汇总报告: {report_path}")


def main():
    parser = argparse.ArgumentParser(description='批量 AI 分析评论')
    parser.add_argument('--session-dir', '-s', help='分析单个会话目录')
    parser.add_argument('--resume', action='store_true', help='跳过已有 AI 结果的项目')
    args = parser.parse_args()

    batch_ts = datetime.now().strftime('%Y%m%d_%H%M%S')

    if args.session_dir:
        # 单个项目
        if not os.path.isabs(args.session_dir):
            session_dir = os.path.join(PROJECT_ROOT, args.session_dir)
        else:
            session_dir = args.session_dir
        result = analyze_session(session_dir)
        if result:
            generate_batch_summary([result], batch_ts)
        return

    # 批量处理所有项目
    print("[*] 扫描 output/ 下所有会话...")
    session_dirs = find_session_dirs(OUTPUT_DIR)
    print(f"[*] 找到 {len(session_dirs)} 个会话\n")

    results = []
    for i, session_dir in enumerate(session_dirs, 1):
        if args.resume and has_ai_result(session_dir):
            rel = os.path.relpath(session_dir, PROJECT_ROOT)
            print(f"[{i}/{len(session_dirs)}] 跳过已有AI结果: {rel}")
            continue

        print(f"\n[{i}/{len(session_dirs)}]", end='')
        result = analyze_session(session_dir)
        if result:
            results.append(result)
        time.sleep(1)

    if results:
        generate_batch_summary(results, batch_ts)


if __name__ == '__main__':
    main()
