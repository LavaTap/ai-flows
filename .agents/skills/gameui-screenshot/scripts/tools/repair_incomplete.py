"""精准修复：用文章 ID（article.id）匹配截图，而非游戏名。
适用于因标题不匹配导致补不到截图的游戏。"""
import sys
import io
from pathlib import Path
from collections import OrderedDict
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

CONCEPTS_DIR = SCRIPTS_DIR.parent / "game_concepts"
GROUP_SIZE = 3
SIMILAR_THRESHOLD = 10
FETCH_SORTS = [("id", "DESC"), ("id", "ASC"), ("praise_count", "DESC"), ("collect_count", "DESC")]

# 文章 ID 精准匹配（从游戏列表 API 查得）
GAMES_TO_FIX = [
    ("二次元", "境·界 刀鸣（朝夕光年）",   14592),
    ("二次元", "鸣潮（PC）(新UI）",        14590),
    ("欧美",   "Project Makeover（麦吉大改造）", 14673),
    ("欧美",   "Puzzles & Survival（破晓的曙光）", 14669),
    ("欧美",   "Yarn Loop！",               14661),
]


def is_vertical(w, h):
    """判断图片是否为竖屏（高度大于宽度）。

    Args:
        w: 图片宽度。
        h: 图片高度。

    Returns:
        bool: True 如果是竖屏，False 如果是横屏。
    """
    return w < h


def collage_images(img_paths, collage_direction):
    """将多张图片拼接为一张组合图。

    根据拼接方向（水平/垂直）缩放图片到相同尺寸后拼接。

    Args:
        img_paths: 要拼接的图片文件路径列表。
        collage_direction: 拼接方向，"horizontal" 横向拼接或 "vertical" 纵向拼接。

    Returns:
        Image: 拼接后的 Image 对象，图片不足2张返回 None。
    """
    images = []
    for p in img_paths:
        try:
            images.append(Image.open(p))
        except Exception:
            continue
    if not images or len(images) < 2:
        return None
    if collage_direction == "horizontal":
        target_h = min(im.height for im in images)
        scaled = []
        for im in images:
            ratio = target_h / im.height
            scaled.append(im.resize((max(1, int(im.width * ratio)), target_h), Image.LANCZOS))
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
            scaled.append(im.resize((target_w, max(1, int(im.height * ratio))), Image.LANCZOS))
        total_h = sum(im.height for im in scaled)
        result = Image.new("RGB", (target_w, total_h), (24, 24, 24))
        y = 0
        for im in scaled:
            result.paste(im, (0, y))
            y += im.height
    return result


def build_style_pool(style, fetch_per_sort=500):
    """为指定风格构建去重的截图项池。

    使用多种排序方式（id/DESC、id/ASC、praise_count/DESC 等）拉取截图，
    合并结果并按 ID 去重，得到完整的截图池供精确匹配使用。

    Args:
        style: 游戏风格。
        fetch_per_sort: 每种排序拉取的最大条数。默认为 500.

    Returns:
        list: 去重后的截图项列表。
    """
    all_items = []
    seen_ids = set()
    for sort_f, sort_o in FETCH_SORTS:
        _, items = graphql_images(style=style, first=fetch_per_sort, desc=None, sort=sort_f, order=sort_o)
        for item in items:
            if item["id"] not in seen_ids:
                seen_ids.add(item["id"])
                all_items.append(item)
    return all_items


def main():
    """不完整游戏修复工具主入口。

    通过文章 ID 精准匹配截图，修复因游戏名匹配失败导致的缺图问题。
    流程：
    1. 按风格构建去重截图池（多种排序拉取并去重）
    2. 对每个待修复游戏，根据文章 ID 从池中筛选截图
    3. 下载缺额截图并感知哈希去重
    4. 凑够 3 张后生成拼接图
    """
    log = LogManager(CONCEPTS_DIR, name="repair_v3")
    log.header("不完整游戏修复 v3 — 文章ID精确匹配")

    # 按风格分组拉取截图池（每组仅拉一次）
    style_pools = {}
    unique_styles = set(s for s, _, _ in GAMES_TO_FIX)
    for style in unique_styles:
        log.sub_header(f"[{style}] 拉取截图池")
        pool = build_style_pool(style, fetch_per_sort=500)
        style_pools[style] = pool
        log.add(f"  {len(pool)} 条不重复截图")
    log.blank()
    log.sub_header("补图 + 去重 + 拼图")

    fixed_count = 0
    fail_count = 0

    for style, gname, article_id in GAMES_TO_FIX:
        safe_name = "".join(c for c in gname if c not in '\\/:*?"<>|').strip()[:40]
        safe_name = safe_name.replace('\u200b', '').replace('\ufeff', '')
        game_dir = CONCEPTS_DIR / style / safe_name

        if not game_dir.exists():
            log.game_line("[跳过]", f"{style}/{safe_name} 目录不存在")
            continue

        # 扫描已有 PNG
        existing = sorted([f for f in game_dir.glob("concept_*.png") if "combined" not in f.name])
        have = len(existing)
        need = GROUP_SIZE - have

        log.game_line("[处理]", f"{style}/{safe_name} (article_id={article_id}) 已有{have}张，缺{need}张")

        if need <= 0:
            # 已够数，检查是否缺拼图
            if not list(game_dir.glob("concept_combined.png")):
                pngs = [str(p) for p in existing]
                if len(pngs) >= 2:
                    vc = sum(1 for p in pngs if is_vertical(*Image.open(p).size))
                    cd = "horizontal" if vc >= len(pngs) - vc else "vertical"
                    result = collage_images(pngs, cd)
                    if result:
                        result.save(game_dir / "concept_combined.png", "PNG")
                        log.game_line("[拼图]", f"{style}/{safe_name}")
                        fixed_count += 1
                        continue
            log.game_line("[OK]", f"{style}/{safe_name} 已完成")
            fixed_count += 1
            continue

        # 从截图池中按 article.id 精确筛选
        pool = style_pools.get(style, [])
        game_items = [it for it in pool if (it.get("article") or {}).get("id") == article_id]
        log.game_line("", f"  截图池中 {len(game_items)} 条属于此文章ID")

        if not game_items:
            log.game_line("[不足]", f"  API 中无此文章的任何截图")
            fail_count += 1
            continue

        # 加载已有哈希
        used_hashes = []
        for p in existing:
            try:
                used_hashes.append(imagehash.phash(Image.open(p)))
            except Exception:
                pass

        # 下载 + 去重
        new_dl = 0
        for item in game_items:
            if new_dl >= need:
                break
            img_id = item["id"]
            detail = image_detail(img_id, style)
            url = detail.get("content", "")
            if not url:
                continue

            tmp_path = download_image(url, game_dir, f"_tmp_{img_id}.jpg")
            if not tmp_path:
                continue

            try:
                im = Image.open(tmp_path)
                h = imagehash.phash(im)

                is_sim = any(int(h - eh) <= SIMILAR_THRESHOLD for eh in used_hashes)
                if is_sim:
                    try:
                        tmp_path.unlink()
                    except Exception:
                        pass
                    log.game_line("[去重]", f"  img_{img_id} 跳过 (与已有相似)")
                    continue

                used_hashes.append(h)
                idx = have + new_dl + 1
                png_name = f"concept_{idx}.png"
                png_path = game_dir / png_name
                im.save(png_path, "PNG")
                w, h = im.size
                new_dl += 1
                log.game_line("[下载]", f"  {png_name} ({w}x{h})")
            except Exception as e:
                log.game_line("[错误]", f"  img_{img_id}: {e}")
            finally:
                try:
                    tmp_path.unlink()
                except Exception:
                    pass

        # 拼图
        final = sorted([f for f in game_dir.glob("concept_*.png") if "combined" not in f.name])
        if len(final) >= GROUP_SIZE:
            pngs = [str(p) for p in final]
            vc = sum(1 for p in pngs if is_vertical(*Image.open(p).size))
            cd = "horizontal" if vc >= len(pngs) - vc else "vertical"
            result = collage_images(pngs, cd)
            if result:
                result.save(game_dir / "concept_combined.png", "PNG")
                log.game_line("[完成]", f"{style}/{safe_name} ({len(final)}张+拼图)")
                fixed_count += 1
                continue

        log.game_line("[不足]", f"{style}/{safe_name} 最终仅{len(final)}张")

    log.blank()
    log.add(("修复完成", fixed_count))
    log.close()


if __name__ == "__main__":
    main()
