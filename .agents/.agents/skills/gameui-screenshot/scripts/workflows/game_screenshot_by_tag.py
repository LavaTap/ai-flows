"""按标签和游戏风格筛选截图的脚本

支持按游戏风格（欧美/二次元/日韩/Q版卡通）和自定义标签筛选截图，每个标签获取约1张，每个风格爬取指定数量的游戏。

Usage:
  python game_screenshot_by_tag.py --styles "欧美,二次元" --tags "战斗界面,VS/匹配" --count-per-style 4
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

STYLES = ["欧美", "二次元", "日韩", "Q版卡通"]
GROUP_SIZE = 3
SIMILAR_THRESHOLD = 10


def safe_dirname(text):
    import re
    text = re.sub(r'[​‌‍⁠﻿]', '', text)
    cleaned = re.sub(r'[\\/:*?"<>|]', '', text).strip()
    return cleaned[:40] if cleaned else "unknown"


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
        description="按标签和游戏风格筛选截图的脚本"
    )
    parser.add_argument("--styles", default="欧美,二次元,日韩,Q版卡通",
                        help="游戏风格列表，逗号分隔 (默认: 欧美,二次元,日韩,Q版卡通)")
    parser.add_argument("--tags", required=True,
                        help="要筛选的标签列表，逗号分隔，例如 '战斗界面,VS/匹配,结算'")
    parser.add_argument("--fallback-tags", default="新手引导,技能,任务,主界面,Loading",
                        help="备用标签列表，当主标签不足时使用，逗号分隔")
    parser.add_argument("--count-per-style", type=int, default=4,
                        help="每个风格目标游戏数 (默认 4)")
    parser.add_argument("--fetch-per-tag", type=int, default=50,
                        help="每个标签拉取的截图条数 (默认 50)")
    parser.add_argument("--output-dir", default=None,
                        help="输出根目录 (默认 output/{timestamp}_标签截图/)")
    args = parser.parse_args()

    styles = [s.strip() for s in args.styles.split(",")]
    tags = [t.strip() for t in args.tags.split(",")]
    fallback_tags = [t.strip() for t in args.fallback_tags.split(",")]
    count_per_style = args.count_per_style
    fetch_per_tag = args.fetch_per_tag

    # Generate output directory
    if args.output_dir is None:
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        tag_str = "_".join(tags[:3]) + ("_etc" if len(tags) > 3 else "")
        output_dir = Path("output") / f"{timestamp}_{tag_str}_标签截图"
    else:
        output_dir = Path(args.output_dir)

    # Initialize log
    log = LogManager(output_dir, name="tag_screenshot")
    log.header(f"按标签筛选截图 - {', '.join(tags)}")
    log.add(("游戏风格", ", ".join(styles)))
    log.add(("每个风格游戏数", count_per_style))
    log.add(("每个标签拉取数", fetch_per_tag))
    log.add(("输出目录", output_dir.resolve()))
    log.reset_timer()

    # Phase 1: Collect screenshots by tags and styles
    log.sub_header("Phase 1: 按标签和风格收集截图")
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

    # Phase 2: Group by game and style
    log.sub_header("Phase 2: 按游戏和风格分组")
    game_items = defaultdict(list)
    game_info = {}

    for item, style, tag in all_items:
        art = item.get("article") or {}
        gname = art.get("title", "unknown") if art else "unknown"
        gdir = safe_dirname(gname)
        game_items[(gdir, style)].append((item, tag))
        if (gdir, style) not in game_info:
            game_info[(gdir, style)] = gname

    log.add(f"  共 {len(game_items)} 个游戏-风格组合")
    log.add(f"")

    # Phase 3: Select top games for each style
    log.sub_header("Phase 3: 为每个风格选择目标游戏")
    style_targets = defaultdict(list)

    # 按风格分组游戏
    style_games = defaultdict(list)
    for (gdir, style), items in game_items.items():
        style_games[style].append(((gdir, style), items))

    # 为每个风格选择游戏
    for style in styles:
        style_games_list = style_games.get(style, [])
        if not style_games_list:
            log.add(f"  {style}: 无可用游戏")
            continue

        # 按截图数降序排序
        sorted_games = sorted(style_games_list, key=lambda x: -len(x[1]))
        selected = sorted_games[:count_per_style]
        style_targets[style] = selected

        log.add(f"  {style}: 选择了 {len(selected)} 个游戏")
        for (gdir, _), items in selected:
            log.add(f"    {game_info[(gdir, style)]}: {len(items)} 张截图")

    # Phase 4: Download screenshots for each selected game and tag
    log.sub_header("Phase 4: 下载截图")
    total_dl = 0
    game_results = {}

    for style in styles:
        log.sub_header(f"处理风格: {style}")

        for (gdir, _), items in style_targets.get(style, []):
            gname = game_info[(gdir, style)]
            # 按风格分类输出：{风格}/{游戏名}/
            game_output_dir = output_dir / style / gdir
            game_output_dir.mkdir(parents=True, exist_ok=True)

            log.game_line("[处理游戏]", f"{gname}")

            # 下载截图逻辑：确保每组至少3张，不足则补充其他标签
            downloaded = 0
            used_hashes = []
            downloaded_tags = {}  # 已下载的标签: {tag: path}

            # 先处理已经收集到的截图
            for item, tag in items:
                if len(downloaded_tags) >= len(tags):
                    break
                if tag in downloaded_tags:  # 跳过已下载的标签
                    continue

                img_id = item["id"]
                detail = image_detail(img_id, style)
                url = detail.get("content", "")
                if not url:
                    continue

                tmp_path = download_image(url, game_output_dir, f"_tmp_{img_id}.jpg")
                if not tmp_path:
                    continue

                try:
                    im = Image.open(tmp_path)
                    h = imagehash.phash(im)

                    # 去重检查
                    is_sim = False
                    for existing_hash in used_hashes:
                        if int(h - existing_hash) <= SIMILAR_THRESHOLD:
                            is_sim = True
                            break

                    if is_sim:
                        try:
                            tmp_path.unlink()
                        except Exception:
                            pass
                        continue

                    used_hashes.append(h)

                    # 保存为顺序命名的文件: concept_1.png, concept_2.png, concept_3.png...
                    safe_tag = safe_dirname(tag)
                    seq_num = len(downloaded_tags) + 1
                    png_name = f"concept_{seq_num}.png"
                    png_path = game_output_dir / png_name
                    im.save(png_path, "PNG")

                    w, h_im = im.size
                    log.game_line("[下载]", f"  {tag}: {png_name} ({w}x{h_im})")
                    downloaded_tags[tag] = png_path
                    total_dl += 1

                except Exception as e:
                    print(f"    [错误] 处理图片 {img_id}: {e}")
                finally:
                    try:
                        tmp_path.unlink()
                    except Exception:
                        pass

            # 补充下载缺失的标签
            missing_tags = [t for t in tags if t not in downloaded_tags]
            all_fallback_tags = tags + fallback_tags

            if missing_tags and len(downloaded_tags) < GROUP_SIZE:
                log.game_line("[补充]", f"  缺失主标签: {', '.join(missing_tags)}")
                log.game_line("[备用标签]", f"  使用备用标签: {', '.join(fallback_tags)}")

                # 先尝试补充主标签，再使用备用标签
                for target_tag in missing_tags + fallback_tags:
                    if len(downloaded_tags) >= GROUP_SIZE:
                        break
                    if target_tag in downloaded_tags:
                        continue

                    # 搜索该游戏和风格下的目标标签截图
                    _, extra_items = graphql_images(
                        style=style,
                        first=100,
                        desc=target_tag
                    )

                    # 过滤当前游戏的截图
                    current_game_title = game_info[(gdir, style)].lower()
                    for extra_item in extra_items:
                        if len(downloaded_tags) >= GROUP_SIZE:
                            break

                        art = extra_item.get("article") or {}
                        art_title = art.get("title", "").lower() if art else ""

                        # 匹配当前游戏（模糊匹配）
                        if current_game_title in art_title or art_title in current_game_title:
                            img_id = extra_item["id"]
                            detail = image_detail(img_id, style)
                            url = detail.get("content", "")
                            if not url:
                                continue

                            tmp_path = download_image(url, game_output_dir, f"_tmp_{img_id}.jpg")
                            if not tmp_path:
                                continue

                            try:
                                im = Image.open(tmp_path)
                                h = imagehash.phash(im)

                                # 去重检查
                                is_sim = False
                                for existing_hash in used_hashes:
                                    if int(h - existing_hash) <= SIMILAR_THRESHOLD:
                                        is_sim = True
                                        break

                                if is_sim:
                                    try:
                                        tmp_path.unlink()
                                    except Exception:
                                        pass
                                    continue

                                used_hashes.append(h)

                                # 保存为顺序命名的文件: concept_1.png, concept_2.png, concept_3.png...
                                seq_num = len(downloaded_tags) + 1
                                png_name = f"concept_{seq_num}.png"
                                png_path = game_output_dir / png_name
                                im.save(png_path, "PNG")

                                w, h_im = im.size
                                log.game_line("[补充下载]", f"  {target_tag}: {png_name} ({w}x{h_im})")
                                downloaded_tags[target_tag] = png_path
                                total_dl += 1

                            except Exception as e:
                                print(f"    [错误] 处理补充图片 {img_id}: {e}")
                            finally:
                                try:
                                    tmp_path.unlink()
                                except Exception:
                                    pass

            # 记录游戏结果
            game_results[f"{style}/{gdir}"] = {
                "game_name": gname,
                "style": style,
                "downloaded_tags": len(downloaded_tags),
                "total_tags": len(tags),
                "downloaded_tag_list": list(downloaded_tags.keys()),
                "files": [f.name for f in game_output_dir.glob("*.png") if not f.name.startswith("_tmp_")]
            }

            if len(downloaded_tags) >= len(tags):
                log.game_line("[完成]", f"{gname}: 已下载所有 {len(tags)} 个标签的截图: {', '.join(downloaded_tags.keys())}")
            else:
                log.game_line("[部分完成]", f"{gname}: 仅下载了 {len(downloaded_tags)}/{len(tags)} 个标签的截图: {', '.join(downloaded_tags.keys())}")
            # 如果补充了标签，显示补充信息
            if len(downloaded_tags) > len(items) / len(tags) if tags else 0:
                log.game_line("[补充]", f"{gname}: 补充了 {len(downloaded_tags) - (len(items) // len(tags) if tags else 0)} 个标签的截图")

    log.add(f"")
    log.add(("总下载", f"{total_dl} 张 PNG"))

    # Phase 5: Create collages for each game
    log.sub_header("Phase 5: 生成拼图")
    collage_count = 0

    # 按风格分类扫描：{风格}/{游戏名}/
    for style_dir in output_dir.iterdir():
        if not style_dir.is_dir() or style_dir.name.startswith('_'):
            continue
        for game_dir in style_dir.iterdir():
            if not game_dir.is_dir():
                continue

            # 确保每组恰好3张截图（按顺序取前3张）
            image_files = list(game_dir.glob("*.png"))
            # 按文件名排序（确保顺序稳定：concept_1, concept_2, concept_3）
            image_files.sort()
            path_list = [str(f) for f in image_files[:GROUP_SIZE]]

            if len(path_list) < GROUP_SIZE:
                continue

            # 确定拼接方向：严格按照用户要求
            # 横屏图(width > height) → 竖着拼接(vertical, 上下堆叠)
            # 竖屏图(height > width) → 横着拼接(horizontal, 左右并排)
            horiz_count = 0
            vert_count = 0
            total_width = 0
            total_height = 0
            sample_images = []

            for f in path_list:
                with Image.open(f) as im:
                    w, h = im.size
                    total_width += w
                    total_height += h
                    sample_images.append((w, h))
                    if w > h:  # 横屏图
                        horiz_count +=1
                    else:  # 竖屏图
                        vert_count +=1

            # 多数为竖屏图 → 横着拼接(horizontal side-by-side)
            # 多数为横屏图 → 竖着拼接(vertical stack)
            collage_dir = "horizontal" if vert_count >= len(path_list) - vert_count else "vertical"
            result = collage_images(path_list, collage_dir)

            if result:
                combined_path = game_dir / "concept_combined.png"
                result.save(combined_path, "PNG")
                cw, ch = result.size
                dir_str = "横向" if collage_dir == "horizontal" else "纵向"
                log.game_line("[拼图]", f"{game_dir.name}: concept_combined.png ({cw}x{ch}) {dir_str}")
                collage_count +=1

    log.add(f"")
    log.add(("拼图生成", f"{collage_count} 张"))

    # Phase 6: Save summary
    log.sub_header("汇总")
    summary_path = output_dir / "_summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump({
            "styles": styles,
            "tags": tags,
            "count_per_style": count_per_style,
            "total_downloaded": total_dl,
            "collages_created": collage_count,
            "games": game_results
        }, f, ensure_ascii=False, indent=2)

    log.add(("汇总清单", summary_path.resolve()))
    log.close()

    print(f"\n✅ 完成！输出目录: {output_dir.resolve()}")


if __name__ == "__main__":
    main()