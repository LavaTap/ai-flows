"""
治愈游戏评论数据处理脚本 v4 - 含 AI 复核，支持按平台输出
读取 data/raw/ 中的 CSV，输出到 output/{平台}/ 目录下。
"""
import csv, re, sys, os, json

HEALING_TAGS = ["放松解压","安心平静","温暖陪伴","美术疗愈","音乐疗愈","自然疗愈",
                "慢节奏休闲","情绪共鸣","社交温情","创造满足","可爱愉悦","非治愈/负向"]
ATTRACTION_TAGS = ["治愈感","美术","音乐","玩法","探索","建造装饰","收集养成",
                   "剧情角色","社交","低压力","价格/口碑","其他"]

# 平台识别关键词映射（按优先级从高到低）
# 优先检查数据内部特征（如头像域名），再检查文件名中的平台标识
BILIBILI_DOMAINS = ["hdslb.com", "bilibili", "biligame"]
PLATFORM_FILENAME_KWS = {
    "Steam": ["steam", "Steam", "STEAM"],
    "TapTap": ["taptap", "TapTap", "TAPTAP"],
    "Reddit": ["reddit", "Reddit", "REDDIT"],
    "小红书": ["小红书", "xiaohongshu"],
}
DEFAULT_PLATFORM = "其他"


def detect_platform(filename, rows=None):
    """从文件名和评论数据中推断平台。"""
    basename = os.path.basename(filename)

    # 1. 优先从数据内部特征检测（更准确）
    if rows:
        for row in rows[:5]:  # 检查前5行
            for key in ("头像", "头像链接", "avatar"):
                val = row.get(key, "")
                if any(domain in val for domain in BILIBILI_DOMAINS):
                    return "B站"
            # 检查是否有"大会员"字段
            if "是否是大会员" in row:
                return "B站"

    # 2. 从文件名检测
    # 先检查B站（排除"steam好评率"这种误匹配）
    if any(kw in basename for kw in ["bilibili", "哔哩哔哩", "biligame", "BV", "av"]):
        return "B站"

    # 再检查其他平台
    for platform, kws in PLATFORM_FILENAME_KWS.items():
        if any(kw in basename for kw in kws):
            return platform

    # 3. 最后从评论内容检测
    if rows:
        for row in rows[:10]:
            text = row.get("评论内容", "") if isinstance(row, dict) else str(row)
            for domain in BILIBILI_DOMAINS:
                if domain in text:
                    return "B站"

    return DEFAULT_PLATFORM


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
    """
    基于 SKILL.md 规则 + 语义规则进行 AI 级别分析。
    两轮分析: 第一轮初判 + 第二轮正向优先复核。
    """
    pure = strip_meta(text)
    
    # ---- 模式识别 ----
    # 强正向线索
    strong_pos_words = ["喜欢","推荐","好玩","舒服","可爱","漂亮","放松","温暖",
                        "平静","治愈","解压","陪伴","沉浸","自由","惬意","唯美",
                        "感动","温馨","种草","期待","爱了","最爱","棒","绝了",
                        "惊艳","有趣","好治愈","好可爱","好喜欢","好美","很不错",
                        "打call","好治愈","致敬","热爱","有意思","有意义","最棒",
                        "想玩","挺好的","好宁静","怀念","沁人心脾","好心水",
                        "美腻","心水","兴奋","哇哇哇","为游戏买单"]
    strong_pos = [w for w in strong_pos_words if w in pure]
    
    # 额外正向判断
    extra_pos_patterns = [
        r'好\w+玩', r'很\w+好', r'从\w+玩到了', r'住在',
        r'^最', r'入.*谷', r'就要', r'神作',
    ]
    extra_pos = any(re.search(p, pure) for p in extra_pos_patterns)
    
    # 美术/音乐/画面线索
    art_words = ["画风","画面","好看","好听","漂亮","唯美","配色","色彩","艺术",
                 "像素","美术","音乐","BGM","bgm","配乐","音效","风景"]
    art_hit = [w for w in art_words if w in pure]
    
    # 负向线索
    neg_words = ["失望","无聊","压抑","焦虑","烦躁","太肝","太累","后悔","不推荐",
                 "退款","差评","不好玩","没意思","不喜欢","卸载","头晕","无趣",
                 "不想玩","不玩了"]
    strong_neg = [w for w in neg_words if w in pure]
    
    # 额外负向模式
    neg_patterns = [r'就像继续上班', r'起早贪黑', r'凭什么']
    extra_neg = any(re.search(p, pure) for p in neg_patterns)
    
    # 纯功能性评论
    is_func = False
    if not text or len(text.strip()) <= 1: is_func = True
    elif text.startswith('@'): is_func = True
    elif re.match(r'^回复\s*@', text): is_func = True
    
    stripped_text = re.sub(r'\[.*?\]', '', text).strip()
    short_positive = {"好宁静","好治愈","好可爱","好喜欢","好美","好治愈","爱了","特别好玩","太美了","好棒"}
    if len(stripped_text) <= 3 and stripped_text not in short_positive:
        is_func = True
    
    pos_emoji, neg_emoji = has_emoji(text)
    special_pos = bool(re.search(r'有一种想哭的美|好宁静|哇哇哇|爱了|好想玩', pure))
    
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
        if strong_pos_combined:
            final_sent = "正向"
            notes = f"上调：发现正向线索"
        elif art_hit:
            final_sent = "正向"
            notes = "上调：美术/音乐等正向元素"
        elif extra_pos:
            final_sent = "正向"
            notes = "上调：隐含正向表达"
        elif re.search(r'有意思|有意义|致敬|热爱', pure):
            final_sent = "正向"
            notes = "上调：表达积极态度"
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
        "情绪共鸣": ["感动","共鸣","想哭","怀念","回忆","小时候","童年"],
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
        "治愈相关度": relevance,
        "治愈感受细分": "、".join(tags[:3]),
        "吸引游玩因素": "、".join(factors[:3]),
        "判断依据": "；".join(basis_parts),
        "复核调整说明": notes,
    }


def extract_game_name(filename):
    """从文件名中提取游戏名称。"""
    basename = os.path.splitext(os.path.basename(filename))[0]
    # 去掉 _评论 或 _整理后 后缀
    basename = re.sub(r'_评论$', '', basename)
    basename = re.sub(r'_整理后$', '', basename)
    # 去掉平台/评价前缀
    basename = re.sub(r'^【[^】]*】', '', basename)
    # 如果包含 "steam好评率" 之类的描述，截取前面的游戏名
    for sep in [' steam好评', ' steam', ' steam', ' Steam', 'steam好评']:
        if sep in basename:
            basename = basename.split(sep)[0].strip()
            break
    for sep in ['-', '『', '【', '(', '（']:
        if sep in basename:
            basename = basename.split(sep)[0].strip()
    # 如果太长则截取
    if len(basename) > 20:
        basename = basename[:20]
    return basename.strip()


def find_project_root(skill_dir):
    """从技能目录向上查找项目根目录。

    通过检查目录中是否包含 ``data/`` 子目录来识别项目根目录，
    最多向上查找 5 层。

    Args:
        skill_dir: 技能脚本所在目录路径。

    Returns:
        项目根目录的绝对路径。
    """
    current = skill_dir
    for _ in range(5):  # 最多向上找 5 层
        if os.path.isdir(os.path.join(current, 'data')):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return os.path.dirname(skill_dir)  # fallback: skill 的父目录


def process_csv(input_path, output_path=None, game_name=None, platform=None):
    """
    处理单个 CSV 文件。
    
    Args:
        input_path: 输入 CSV 路径
        output_path: 输出 CSV 路径（若为 None 则自动生成到 output/{platform}/）
        game_name: 游戏名称（若为 None 则从文件名提取）
        platform: 平台（若为 None 则自动检测）
    """
    skill_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    project_root = os.path.dirname(skill_dir)
    
    with open(input_path, 'r', encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))
    
    print(f"读取到 {len(rows)} 条评论")
    
    # 自动检测平台
    if platform is None:
        platform = detect_platform(input_path, rows)
    print(f"平台: {platform}")
    
    # 自动提取游戏名
    if game_name is None:
        game_name = extract_game_name(input_path)
    print(f"游戏: {game_name}")
    
    # 自动生成输出路径
    if output_path is None:
        out_dir = os.path.join(project_root, 'output', platform)
        os.makedirs(out_dir, exist_ok=True)
        base = os.path.splitext(os.path.basename(input_path))[0]
        output_path = os.path.join(out_dir, f"{base}_整理后.csv")
    
    fieldnames = ["序号","平台","游戏名称","评论内容","情绪倾向","情绪关键词",
                  "是否提及治愈","治愈相关度","治愈感受细分","吸引游玩因素",
                  "判断依据","复核调整说明"]
    
    results = []
    for idx, row in enumerate(rows, 1):
        text = row.get("评论内容", "").strip()
        ai = classify_by_ai(text)
        results.append({
            "序号": idx,
            "平台": platform,
            "游戏名称": game_name,
            "评论内容": text,
            **ai
        })
    
    with open(output_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)
    
    sentiments = [r["情绪倾向"] for r in results]
    total = len(results)
    print(f"\n处理完成！输出: {output_path}")
    for s in ["正向","中性","负向","混合"]:
        c = sentiments.count(s)
        print(f"  {s}: {c} ({c/total*100:.1f}%)")
    
    return output_path


if __name__ == "__main__":
    """CLI 入口：解析命令行参数并调用 `process_csv` 执行处理。"""
    parser = argparse.ArgumentParser(description="治愈游戏评论分析 v4")
    parser.add_argument("input", help="输入 CSV 路径（在 data/raw/ 下）")
    parser.add_argument("--output", "-o", help="输出 CSV 路径（默认 output/{平台}/{文件名}_整理后.csv）")
    parser.add_argument("--game", "-g", help="游戏名称（默认从文件名提取）")
    parser.add_argument("--platform", "-p", help="平台（B站/Steam/TapTap/Reddit/小红书，默认自动检测）")
    args = parser.parse_args()
    
    if not os.path.exists(args.input):
        print(f"错误: 找不到文件 {args.input}")
        sys.exit(1)
    process_csv(args.input, args.output, args.game, args.platform)
