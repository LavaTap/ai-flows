"""Game core gameplay screenshot crawler and collage tool.

This script crawls screenshots by game type (shooting, action, RPG, etc.),
downloads core gameplay screenshots, and creates collages.

Game types and their corresponding tags are defined based on core gameplay elements.

Usage:
  python game_core_gameplay_collage.py --game-type "射击游戏" --count 3
"""

import argparse
import json
import io
import sys
import time
from pathlib import Path
from collections import defaultdict, OrderedDict
from PIL import Image

try:
    import imagehash
except ImportError:
    print("请先安装 imagehash: pip install imagehash")
    sys.exit(1)

if sys.stdout.encoding.lower() in ('gbk', 'gb2312', 'cp936'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from core.fetch_screenshots import graphql_images, image_detail, download_image
from core.log_util import LogManager

# Game type to tags mapping (from CLAUDE.md)
GAME_TYPE_TAGS = {
    "射击游戏": ["战斗界面", "VS/匹配", "结算", "地图", "组队/阵容", "赛季/段位", "背包", "技能", "关卡/挑战", "排行榜"],
    "动作游戏": ["战斗界面", "关卡/挑战", "结算", "技能", "角色", "背包", "锻造/合成", "成就", "地图", "升级提示"],
    "角色扮演": ["创建角色", "角色", "技能", "任务", "关卡/挑战", "背包", "锻造/合成", "NPC对话", "章节提示", "成就"],
    "冒险游戏": ["关卡/挑战", "地图", "章节提示", "NPC对话", "过场动画", "任务", "角色", "背包", "成就"],
    "竞速游戏": ["VS/匹配", "结算", "地图", "赛季/段位", "排行榜", "关卡/挑战", "锻造/合成", "背包"],
    "策略游戏": ["建造/家园", "组队/阵容", "关卡/挑战", "结算", "地图", "工会/帮派", "任务", "锻造/合成", "排行榜"],
    "格斗游戏": ["VS/匹配", "战斗界面", "结算", "赛季/段位", "角色", "技能", "排行榜", "胜利/失败", "关卡/挑战"],
    "即时战略": ["建造/家园", "VS/匹配", "结算", "地图", "组队/阵容", "关卡/挑战", "技能", "排行榜"],
    "体育游戏": ["VS/匹配", "结算", "赛季/段位", "组队/阵容", "排行榜", "关卡/挑战", "角色", "技能", "地图"],
    "桌游棋牌": ["VS/匹配", "结算", "卡组/卡牌", "赛季/段位", "排行榜", "关卡/挑战", "背包"],
    "模拟经营": ["建造/家园", "任务", "背包", "锻造/合成", "关卡/挑战", "成就", "地图", "NPC对话", "升级提示"],
    "音乐游戏": ["关卡/挑战", "结算", "VS/匹配", "赛季/段位", "排行榜", "角色", "技能"],
    "恋爱养成": ["NPC对话", "章节提示", "角色", "图鉴", "任务", "成就", "过场动画", "背包"],
    "卡牌": ["卡组/卡牌", "VS/匹配", "结算", "赛季/段位", "组队/阵容", "关卡/挑战", "十连抽", "招募", "技能", "排行榜"],
    "MOBA": ["战斗界面", "VS/匹配", "结算", "地图", "组队/阵容", "赛季/段位", "技能", "角色", "排行榜", "胜利/失败"],
    "消除游戏": ["关卡/挑战", "结算", "排行榜", "背包", "技能", "升级提示"],
    "塔防": ["关卡/挑战", "建造/家园", "地图", "结算", "技能", "背包", "排行榜", "升级提示"],
    "MMORPG": ["创建角色", "阵营选择", "工会/帮派", "组队/阵容", "地图", "任务", "关卡/挑战", "背包", "锻造/合成", "技能", "NPC对话", "宠物/坐骑", "拍卖行", "社交/好友", "外观/时装"],
    "SLOTS": ["转盘/抽奖", "宝箱/金币", "恭喜获得", "福利", "活动", "商城", "充值"],
}

# Exclude keywords to avoid mixing different game genres
# Games containing these keywords in their title will be prioritized lower
EXCLUDE_KEYWORDS = {
    "射击游戏": ["MOBA", "英雄联盟", "LOL", "DOTA", "王者", "王者荣耀", "LoL", "dota", "决战平安京", "英魂之刃", "300英雄"],
    "MOBA": ["射击", "枪战", "使命召唤", "CS", "CF", "绝地求生", "Apex", "Valorant", "战争雷霆", "战地"],
    "角色扮演": ["射击", "MOBA", "动作", "竞速"],
    "动作游戏": ["射击", "MOBA", "角色扮演"],
    "策略游戏": ["射击", "MOBA", "角色扮演"],
    "格斗游戏": ["射击", "MOBA", "角色扮演"],
    "即时战略": ["射击", "MOBA", "角色扮演"],
    "体育游戏": ["射击", "MOBA", "角色扮演"],
    "桌游棋牌": ["射击", "MOBA", "角色扮演"],
    "模拟经营": ["射击", "MOBA", "角色扮演"],
    "音乐游戏": ["射击", "MOBA", "角色扮演"],
    "恋爱养成": ["射击", "MOBA", "角色扮演"],
    "卡牌": ["射击", "MOBA", "角色扮演"],
    "消除游戏": ["射击", "MOBA", "角色扮演"],
    "塔防": ["射击", "MOBA", "角色扮演"],
    "MMORPG": ["射击", "MOBA", "动作"],
    "SLOTS": ["射击", "MOBA", "角色扮演"],
}

STYLES = ["欧美", "二次元", "日韩", "Q版卡通"]

GROUP_SIZE = 3
SIMILAR_THRESHOLD = 10


def safe_dirname(text):
    import re
    text = re.sub(r'[​‌‍⁠﻿]', '', text)
    cleaned = re.sub(r'[\\/:*?"<>|]', '', text).strip()
    return cleaned[:40] if cleaned else "unknown"


def calculate_exclude_score(game_name, game_type):
    """Calculate how many exclude keywords are found in the game name."""
    exclude_keywords = EXCLUDE_KEYWORDS.get(game_type, [])
    score = 0
    game_name_lower = game_name.lower()
    for kw in exclude_keywords:
        if kw.lower() in game_name_lower:
            score += 1
    return score


def is_vertical(w, h):
    return w < h


def collage_images(img_paths, collage_direction):
    """Create collage from images."""
    images = []
    for p in img_paths:
        try:
            images.append(Image.open(p))
        except Exception as e:
            print(f"    [警告] 无法打开 {p}: {e}")
    if not images:
        return None
    if len(images) == 1:
        return images[0].copy()
    if collage_direction == "horizontal":
        target_h = min(im.height for im in images)
        scaled = []
        for im in images:
            ratio = target_h / im.height
            new_w = max(1, int(im.width * ratio))
            scaled.append(im.resize((new_w, target_h), 1))  # 1 = LANCZOS
        total_w = sum(im.width for im in scaled)
        result = Image.new("RGB", (total_w, target_h), (24, 24, 24))
        x = 0
        for im in scaled:
            result.paste(im, (x, 0))
            x += im.width
    else:
        target_w = min(im.width for im in images)
        scaled = []
        for im in images:
            ratio = target_w / im.width
            new_h = max(1, int(im.height * ratio))
            scaled.append(im.resize((target_w, new_h), 1))  # 1 = LANCZOS
        total_h = sum(im.height for im in scaled)
        result = Image.new("RGB", (target_w, total_h), (24, 24, 24))
        y = 0
        for im in scaled:
            result.paste(im, (0, y))
            y += im.height
    return result


def main():
    parser = argparse.ArgumentParser(
        description="游戏核心玩法截图爬取与拼图工具"
    )
    parser.add_argument("--game-type", required=True,
                        choices=list(GAME_TYPE_TAGS.keys()),
                        help="游戏类型")
    parser.add_argument("--count", type=int, default=3,
                        help="目标游戏数 (默认 3)")
    parser.add_argument("--styles", default="欧美,二次元,日韩,Q版卡通",
                        help="游戏风格列表，逗号分隔 (默认: 欧美,二次元,日韩,Q版卡通)")
    parser.add_argument("--output-dir", default=None,
                        help="输出根目录 (默认 output/{timestamp}_{game_type}/)")
    parser.add_argument("--fetch-per-tag", type=int, default=100,
                        help="每个标签拉取的截图条数 (默认 100)")
    args = parser.parse_args()

    game_type = args.game_type
    target_count = args.count
    styles = [s.strip() for s in args.styles.split(",")]
    fetch_per_tag = args.fetch_per_tag

    # Generate output directory
    if args.output_dir is None:
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = Path("output") / f"{timestamp}_{game_type}"
    else:
        output_dir = Path(args.output_dir)

    tags = GAME_TYPE_TAGS[game_type]

    # Initialize log
    log = LogManager(output_dir, name="gameplay")
    log.header(f"游戏核心玩法爬取 - {game_type}")
    log.add(("游戏类型", game_type))
    log.add(("核心标签", ", ".join(tags)))
    log.add(("目标游戏数", target_count))
    log.add(("风格范围", ", ".join(styles)))
    log.add(("每标签拉取", fetch_per_tag))
    log.add(("输出目录", output_dir.resolve()))
    log.reset_timer()

    # Phase 1: Collect screenshots by tags
    log.sub_header("Phase 1: 按标签收集截图")
    all_items = []
    seen_ids = set()

    for tag in tags:
        log.add(f"  标签: {tag}")
        for style in styles:
            _, items = graphql_images(style=style, first=fetch_per_tag, desc=tag)
            new_count = 0
            for item in items:
                if item["id"] not in seen_ids:
                    seen_ids.add(item["id"])
                    all_items.append((item, style, tag))
                    new_count += 1
            log.add(f"    {style}: {len(items)} 条, 新增 {new_count}")

    log.add(f"")
    log.add(("去重后总数", f"{len(all_items)} 条"))

    # Phase 2: Group by game
    log.sub_header("Phase 2: 按游戏分组")
    game_items = defaultdict(list)
    game_names = {}

    for item, style, tag in all_items:
        art = item.get("article") or {}
        gname = art.get("title", "unknown") if art else "unknown"
        gdir = safe_dirname(gname)
        game_items[gdir].append((item, style, tag))
        if gdir not in game_names:
            game_names[gdir] = gname

    log.add(f"  共 {len(game_items)} 个游戏")
    log.add(f"")

    # Phase 3: Select top games (by exclude score and screenshot count)
    log.sub_header("Phase 3: 选择目标游戏")
    # First sort by exclude score ascending, then by screenshot count descending
    sorted_games = sorted(
        game_items.items(),
        key=lambda x: (
            calculate_exclude_score(game_names[x[0]], game_type),
            -len(x[1])
        ),
        reverse=False
    )
    target_games = sorted_games[:target_count]

    for gdir, items in target_games:
        log.add(f"  {game_names[gdir]}: {len(items)} 张截图")

    # Phase 4: Download with dedup
    log.sub_header("Phase 4: 去重下载")
    total_dl = 0
    game_downloads = defaultdict(list)

    for gdir, items in target_games:
        gname = game_names[gdir]
        out_game_dir = output_dir / gdir
        out_game_dir.mkdir(parents=True, exist_ok=True)

        unique_images = []
        used_hashes = []

        for item, style, tag in items:
            if len(unique_images) >= GROUP_SIZE:
                break

            img_id = item["id"]
            detail = image_detail(img_id, style)
            url = detail.get("content", "")
            if not url:
                continue

            tmp_path = download_image(url, out_game_dir, f"_tmp_{img_id}.jpg")
            if not tmp_path:
                continue

            try:
                im = Image.open(tmp_path)
                h = imagehash.phash(im)

                is_similar = False
                for existing_hash in used_hashes:
                    if int(h - existing_hash) <= SIMILAR_THRESHOLD:
                        is_similar = True
                        break

                if is_similar:
                    try:
                        tmp_path.unlink()
                    except Exception:
                        pass
                    continue

                used_hashes.append(h)
                idx = len(unique_images) + 1
                png_name = f"concept_{idx}.png"
                png_path = out_game_dir / png_name
                im.save(png_path, "PNG")
                w, h = im.size
                vert = is_vertical(w, h)
                unique_images.append((png_path, w, h, vert))
                game_downloads[gdir].append((png_path, w, h, vert, idx))
                total_dl += 1

            except Exception as e:
                continue
            finally:
                try:
                    tmp_path.unlink()
                except Exception:
                    pass

        if len(unique_images) >= GROUP_SIZE:
            log.game_line("[OK]", f"{gdir} — 3张去重完成")
        else:
            log.game_line("[不足]", f"{gdir} — 仅 {len(unique_images)} 张")

    log.add((""))
    log.add(("总下载", f"{total_dl} 张 PNG"))

    # Phase 5: Collage
    log.sub_header("Phase 5: 拼图")
    collage_count = 0

    for gdir, downloads in game_downloads.items():
        out_game_dir = output_dir / gdir
        n_imgs = len(downloads)

        if n_imgs < GROUP_SIZE:
            continue

        downloads.sort(key=lambda x: x[4])
        path_list = [p for p, _, _, _, _ in downloads]
        vert_count = sum(1 for _, _, _, v, _ in downloads if v)
        collage_dir = "horizontal" if vert_count >= n_imgs - vert_count else "vertical"

        combined_path = out_game_dir / "concept_combined.png"
        result = collage_images(path_list, collage_dir)
        if result:
            result.save(combined_path, "PNG")
            cw, ch = result.size
            dir_str = "横向" if collage_dir == "horizontal" else "纵向"
            log.game_line("[拼图]", f"{gdir}/concept_combined.png ({cw}x{ch} {dir_str})")
            collage_count += 1

    log.add((""))
    log.add(("拼图生成", f"{collage_count} 张"))

    # Phase 6: Summary
    log.sub_header("汇总")
    summary = {}
    for gdir, downloads in game_downloads.items():
        out_game_dir = output_dir / gdir
        pngs = sorted(f.name for f in out_game_dir.glob("concept_*.png") if "combined" not in f.name)
        combined = [f.name for f in out_game_dir.glob("concept_combined.png")]
        summary[gdir] = {
            "game_name": game_names.get(gdir, gdir),
            "total_images": len(downloads),
            "concept_files": pngs,
            "combined_files": combined,
        }

    summary_path = output_dir / "_summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    log.add(("汇总清单", summary_path.resolve()))
    log.close()

    print(f"\n✅ 完成！输出目录: {output_dir.resolve()}")


if __name__ == "__main__":
    main()