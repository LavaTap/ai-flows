"""GameUI.net 游戏列表查询脚本。

此脚本从 gameui.net 查询游戏/文章列表，支持按风格筛选、分页和排序。
支持文本和 JSON 两种输出格式，可用于浏览有哪些游戏可供爬取。

使用示例：
    python .agents/skills/gameui-screenshot/scripts/core/query_game_list.py
        --style 欧美 --top 5 --output text
    python .agents/skills/gameui-screenshot/scripts/core/query_game_list.py
        --style 二次元 --page 2 --output json
"""
import argparse
import json
import urllib3
import requests

urllib3.disable_warnings()

BASE = "https://www.gameui.net"

STYLES = ["欧美", "二次元", "国风", "日韩", "Q版卡通", "科幻", "军事"]

DEFAULT_HEADERS = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "origin": BASE,
    "referer": f"{BASE}/games?t=1",
}


def query_game_list(style="欧美", page=1, size=30, sort="createTime", order="desc", top=None):
    """从 GameUI API 查询游戏文章列表。

    发送 POST 请求获取经过风格筛选的分页游戏列表，兼容多种响应结构。

    Args:
        style: 游戏风格筛选，可选 "欧美", "二次元", "国风", "日韩", "Q版卡通", "科幻", "军事"。
            默认为 "欧美"。
        page: 要查询的页码。默认为 1。
        size: 每页返回条数。默认为 30。
        sort: 排序字段。默认为 "createTime"。
        order: 排序方向，"desc" 降序或 "asc" 升序。默认为 "desc"。
        top: 限制只返回前 N 条，None 表示不限制。默认为 None。

    Returns:
        dict: 包含总条数 `total`、过滤后行数据 `rows` 和原始响应 `raw` 的字典。
    """
    data = {
        "pageNum": str(page),
        "pageSize": str(size),
        "style": style,
        "categoryId": "22",
        "orderByColumn": sort,
        "isAsc": order,
        "colorrto": "10",
        "title": "",
        "rank": "首页推荐",
        "categoryIds": "",
        "device": "",
        "last": "",
        "tags": "",
        "paramImagesDescFunc": "",
        "paramImagesDescMaterial": "",
        "orientation": "",
        "era": "",
    }
    resp = requests.post(f"{BASE}/web/v1/article/list", headers=DEFAULT_HEADERS, data=data, timeout=30, verify=False)
    body = resp.json()

    # 提取列表（兼容多种响应结构）
    data_block = body.get("data") or body.get("result") or body
    if isinstance(data_block, list):
        rows = data_block
    else:
        rows = data_block.get("list") or data_block.get("rows") or data_block.get("records") or []

    if top:
        rows = rows[:top]

    return {"total": len(rows), "rows": rows, "raw": body}


def format_text(result):
    """将查询结果格式化为人类可读的文本表格。

    Args:
        result: 包含 "rows" 数据的查询结果字典。

    Returns:
        str: 对齐列格式化后的文本，显示游戏基本信息。
    """
    rows = result["rows"]
    lines = [f"风格: {rows[0].get('style', '?') if rows else '?'}  共 {result['total']} 条"]
    lines.append(f"{'#':<4} {'ID':<8} {'标题':<35} {'分类':<10} {'截图数':<8}")
    lines.append("-" * 70)
    for i, item in enumerate(rows, 1):
        tid = item.get("id", "?")
        title = (item.get("title") or "?")[:30]
        cat = item.get("categoryName") or "?"
        img_count = item.get("totalImageCount", 0)
        lines.append(f"{i:<4} {tid:<8} {title:<35} {cat:<10} {img_count:<8}")
    return "\n".join(lines)


def main():
    """脚本主入口。

    解析命令行参数并执行查询，然后按请求的格式打印结果。
    """
    parser = argparse.ArgumentParser(description="gameui.net 游戏列表查询")
    parser.add_argument("--style", default="欧美", choices=STYLES, help="游戏风格筛选")
    parser.add_argument("--page", type=int, default=1, help="页码")
    parser.add_argument("--size", type=int, default=30, help="每页条数")
    parser.add_argument("--sort", default="createTime", help="排序字段")
    parser.add_argument("--order", default="desc", choices=["desc", "asc"], help="排序方向")
    parser.add_argument("--top", type=int, default=None, help="只取前N条")
    parser.add_argument("--output", default="text", choices=["text", "json"], help="输出格式")
    args = parser.parse_args()

    result = query_game_list(
        style=args.style, page=args.page, size=args.size,
        sort=args.sort, order=args.order, top=args.top
    )

    if args.output == "json":
        print(json.dumps(result["rows"], ensure_ascii=False, indent=2))
    else:
        print(format_text(result))


if __name__ == "__main__":
    main()
