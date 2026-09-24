"""GameUI.net 批量截图下载器。

此脚本使用 GraphQL API 从 GameUI.net 获取截图列表，获取详细的图片信息，
并将图片下载到本地目录。

工作流程：GraphQL查询筛选列表 → 获取单张图片详情 → 下载图片。

输出目录：output/{timestamp}_截图_{style}/

使用示例：
    python fetch_screenshots.py [--style 欧美] [--desc 登录界面] [--first 50]
        [--download 2] [--output-dir ./output]"""
"""
import argparse
import json
import urllib3
import requests
import time
from pathlib import Path
from urllib.parse import quote
from datetime import datetime

urllib3.disable_warnings()

BASE = "https://www.gameui.net"

# 项目根目录（脚本在 .agents/skills/gameui-screenshot/scripts/core/，往上5级）
PROJECT_ROOT = Path(__file__).resolve().parents[5]
OUTPUT_ROOT = PROJECT_ROOT / "output"

STYLES = ["欧美", "二次元", "国风", "日韩", "Q版卡通", "科幻", "军事"]
DESC_OPTIONS = ["登录界面", "角色选择", "战斗画面", "主界面", "商店界面", "设置界面"]


def get_headers(style="欧美"):
    """生成包含正确 referer 的 API 请求头。

    根据风格生成适合的 referer URL，满足防盗链要求。

    Args:
        style: 游戏风格，用于生成 referer URL。默认为 "欧美".

    Returns:
        dict: 包含 user-agent、referer 和 origin 的 HTTP 请求头字典。
    """
    return {
        "user-agent": "Mozilla/5.0",
        "accept": "application/json, text/plain, */*",
        "referer": f"{BASE}/screenshots?style={quote(style)}&t=2",
        "origin": BASE,
    }


def graphql_images(style="欧美", first=50, desc=None, sort="id", order="DESC", category_id=None):
    """使用 GraphQL API 查询带筛选条件的截图列表。

    Args:
        style: 游戏风格筛选，如 "欧美", "二次元"。默认为 "欧美".
        first: 返回的最大结果条数。默认为 50.
        desc: 按截图描述/场景筛选，如 "登录界面"。默认为 None.
        sort: 排序字段。默认为 "id".
        order: 排序方向，"DESC" 降序或 "ASC" 升序。默认为 "DESC".
        category_id: 按游戏分类 ID 筛选，如 "228" 代表射击游戏。默认为 None.

    Returns:
        tuple: (总条数, 截图项列表)
    """
    desc_clause = f',images_desc:"{desc}"' if desc else ''
    category_clause = f',category_id:"{category_id}"' if category_id else ''
    q = f'{{images(first:{first},style:"{style}",sort:"{sort}",order:{order}{desc_clause}{category_clause}){{total,list{{id,width,height,description,tags,praise,praise_count,collect_count,create_time,article{{id,title}},user{{id,user_name,avatar}}}}}}}}'
    resp = requests.get(f"{BASE}/api", params={"query": q}, headers=get_headers(style), timeout=30, verify=False)
    data = resp.json().get("data", {}).get("images", {})
    return data.get("total", 0), data.get("list", [])


def image_detail(img_id, style="欧美"):
    """获取单张截图的详细信息，包含 CDN 下载 URL。

    Args:
        img_id: 需要获取详情的截图 ID。
        style: 游戏风格，用于 referer 请求头。默认为 "欧美".

    Returns:
        dict: 包含内容 URL 的图片详情字典。
    """
    resp = requests.get(f"{BASE}/web/v1/images/detail/v2", params={"imagesId": img_id},
                        headers=get_headers(style), timeout=30, verify=False)
    return resp.json().get("data", {})


def download_image(url, out_dir, filename=None, max_retries=2):
    """从 URL 下载图片到本地目录，使用正确的 Referer 头。

    Args:
        url: 要下载的图片 URL。
        out_dir: 保存图片的输出目录。
        filename: 自定义文件名，None 则从 URL 提取文件名。默认为 None.
        max_retries: 失败请求的最大重试次数。默认为 2.

    Returns:
        Path: 成功则返回已保存文件的 Path 对象，失败返回 None。
    """
    for attempt in range(max_retries + 1):
        try:
            resp = requests.get(url, headers={"Referer": f"{BASE}/"}, timeout=30, verify=False)
            if resp.status_code == 200 and len(resp.content) > 1000:
                if not filename:
                    filename = url.rsplit("/", 1)[-1]
                path = Path(out_dir) / filename
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(resp.content)
                return path
        except Exception as e:
            if attempt < max_retries:
                time.sleep(1)  # Wait 1 second before retrying
                continue
            print(f"    [下载失败] 尝试 {attempt+1}/{max_retries+1}: {e}")
    return None


def main():
    """批量截图下载器的主入口。

    解析命令行参数，查询截图，输出列表，然后将图片下载到指定输出目录。
    """
    parser = argparse.ArgumentParser(description="gameui.net 截图栏目获取")
    parser.add_argument("--style", default="欧美", choices=STYLES, help="游戏风格筛选")
    parser.add_argument("--desc", default=None, help="截图场景描述筛选（如: 登录界面）")
    parser.add_argument("--first", type=int, default=50, help="GraphQL 每页条数")
    parser.add_argument("--download", type=int, default=2, help="下载前N张图片")
    parser.add_argument("--list-only", action="store_true", help="仅列出不下载")
    parser.add_argument("--output-dir", default=None, help="下载输出目录 (默认 output/{timestamp}_截图_{style}/)")
    parser.add_argument("--output", default="text", choices=["text", "json"], help="输出格式")
    args = parser.parse_args()

    # 默认输出到 output/{timestamp}_截图_{style}/
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = OUTPUT_ROOT / f"{timestamp}_截图_{args.style}"
    
    total, items = graphql_images(style=args.style, first=args.first, desc=args.desc)
    print(f"[信息] 风格={args.style}  场景={args.desc or '全部'}  总数={total}  本页={len(items)}")

    if args.output == "json":
        print(json.dumps(items, ensure_ascii=False, indent=2))
        return

    # 文本列表输出
    print(f"\n{'#':<4} {'截图ID':<10} {'尺寸':<12} {'文章':<25} {'描述':<20}")
    print("-" * 75)
    for i, item in enumerate(items, 1):
        art = item.get("article") or {}
        art_title = art.get("title", "?") if art else "?"
        desc_text = (item.get("description") or "")[:18]
        print(f"{i:<4} {item['id']:<10} {item.get('width','?')}x{item.get('height','?'):<8} {art_title[:23]:<25} {desc_text:<20}")

    # 下载模式
    if not args.list_only and args.download > 0:
        print(f"\n--- 下载前 {args.download} 张 ---")
        downloaded = 0
        for item in items:
            if downloaded >= args.download:
                break
            img_id = item["id"]
            detail = image_detail(img_id, args.style)
            url = detail.get("content", "")
            if not url:
                print(f"  [跳过] ID={img_id} 无 content URL")
                continue

            art = item.get("article") or {}
            safe = "".join(c for c in (art.get("title") or "unknown") if c.isalnum() or c in " ._-")[:15]
            filename = f"screenshot_{img_id}_{safe}.jpg"
            path = download_image(url, output_dir, filename)
            if path:
                print(f"  [OK] {path.name} ({len(path.read_bytes())/1024:.0f}KB)")
                downloaded += 1
            else:
                print(f"  [失败] ID={img_id}")


if __name__ == "__main__":
    main()
