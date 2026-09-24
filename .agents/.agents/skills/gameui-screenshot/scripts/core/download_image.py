"""GameUI.net 单张截图下载器。

此脚本用于从 GameUI.net 下载单张截图，支持通过截图ID或直接CDN URL下载。
需要正确的 Referer 请求头才能成功从CDN下载图片。

输出目录：output/{timestamp}_单图/

使用示例：
    python download_image.py <imagesId> [--output-dir ./output]
    python download_image.py <cdn_url> [--output-dir ./output]"""
"""
import argparse
import urllib3
import requests
import time
from pathlib import Path
from urllib.parse import urlparse
from datetime import datetime

urllib3.disable_warnings()

BASE = "https://www.gameui.net"

# 项目根目录（脚本在 .agents/skills/gameui-screenshot/scripts/core/，往上5级）
PROJECT_ROOT = Path(__file__).resolve().parents[5]
OUTPUT_ROOT = PROJECT_ROOT / "output"


def get_detail_headers():
    """生成图片详情请求的 HTTP 请求头。

    Returns:
        dict: 包含正确 user-agent、origin 和 referer 的 HTTP 请求头。
    """
    return {
        "user-agent": "Mozilla/5.0",
        "accept": "application/json, text/plain, */*",
        "origin": BASE,
        "referer": f"{BASE}/",
    }


def get_image_by_id(img_id):
    """通过截图 ID 获取图片详情，包含 CDN URL。

    Args:
        img_id: 要获取的截图 ID。

    Returns:
        dict: 包含内容 URL 和尺寸的图片详情字典。
    """
    resp = requests.get(f"{BASE}/web/v1/images/detail/v2", params={"imagesId": img_id},
                        headers=get_detail_headers(), timeout=30, verify=False)
    return resp.json().get("data", {})


def download_cdn_image(url, out_dir, filename=None, max_retries=2):
    """从 CDN 下载图片，使用必需的 Referer 头。

    GameUI CDN 需要正确的 Referer 头才允许下载。

    Args:
        url: 要下载图片的 CDN URL。
        out_dir: 保存图片的输出目录。
        filename: 自定义文件名，None 则从 URL 路径提取。默认为 None.
        max_retries: 失败请求的最大重试次数。默认为 2.

    Returns:
        Path: 成功则返回已保存文件的 Path 对象，失败返回 None。
    """
    headers = {"Referer": f"{BASE}/"}
    for attempt in range(max_retries + 1):
        try:
            resp = requests.get(url, headers=headers, timeout=30, verify=False)
            if resp.status_code == 200 and len(resp.content) > 1000:
                if not filename:
                    filename = urlparse(url).path.rsplit("/", 1)[-1] or f"image_{id}.jpg"
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
    """单图片下载器的主入口。

    解析命令行参数，通过 ID 或直接 CDN URL 下载指定图片。
    """
    parser = argparse.ArgumentParser(description="gameui.net 单图下载工具")
    parser.add_argument("target", help="imagesId (数字) 或 CDN URL")
    parser.add_argument("--output-dir", default=None, help="下载输出目录 (默认 output/{timestamp}_单图/)")
    args = parser.parse_args()

    # 默认输出到 output/{timestamp}_单图/
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = OUTPUT_ROOT / f"{timestamp}_单图"

    target = args.target

    # 判断是 ID 还是 URL
    if target.isdigit():
        img_id = int(target)
        detail = get_image_by_id(img_id)
        url = detail.get("content", "")
        if not url:
            print(f"[错误] imagesId={img_id} 无 content URL")
            print(f"  响应: {detail}")
            return
        print(f"[信息] imagesId={img_id}")
        print(f"  尺寸: {detail.get('width','?')}x{detail.get('height','?')}")
        print(f"  URL: {url}")
    elif target.startswith("http"):
        url = target
        img_id = "direct"
    else:
        print("[错误] target 必须是数字ID或URL")
        return

    path = download_cdn_image(url, output_dir)
    if path:
        size_kb = len(path.read_bytes()) / 1024
        print(f"[OK] 已下载: {path} ({size_kb:.0f}KB)")
    else:
        print(f"[失败] 下载失败: {url}")


if __name__ == "__main__":
    main()
