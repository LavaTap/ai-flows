"""游戏截图浏览 HTTP 服务器。

提供网页界面浏览、查看和删除游戏截图，支持补下载替换被删除的截图。

功能特性:
  - 提供 output 目录下静态文件（PNG、HTML）服务
  - POST /delete  - 删除截图并记录删除日志
  - POST /replenish - 重新下载一张截图替换被删除的截图
  - 读取 _crawl_config.json 获取爬取参数用于补充下载

使用示例:
  python .agents/skills/gameui-screenshot/scripts/tools/serve_output.py
    --dir <output_dir> --port 8080 --report <report_file>
"""
import argparse
import json
import io
import sys
import os
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log_deletion(log_path, path_str):
    """追加一条删除记录到日志文件。

    Args:
        log_path: 日志文件路径。
        path_str: 被删除文件的路径字符串。

    Returns:
        str: 写入的日志行。
    """
    line = f"[{now()}] 删除 {path_str}\n"
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception as e:
        print(f"[警告] 无法写入日志文件 {log_path}: {e}")
        # Fallback to default log
        fallback_log = Path(log_path).parent / "deletion_log.txt"
        with open(fallback_log, "a", encoding="utf-8") as f:
            f.write(line)
    return line.strip()


def replenish_screenshot(output_dir, game_dir, filename, config):
    """尝试重新下载一张替换截图。

    读取爬取配置确定风格/标签，从候选池中找一张未使用的新图片下载，
    并进行感知哈希去重，避免下载与已有图片相似的截图。

    Args:
        output_dir: 输出根目录。
        game_dir: 游戏相对目录（相对于 output_dir）。
        filename: 要替换的文件名。
        config: 爬取配置字典。

    Returns:
        tuple: (成功标志, 结果消息)
    """
    # Import crawl utilities (add scripts/ to path for cross-package import)
    SCRIPTS_DIR = Path(__file__).resolve().parents[1]
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))
    from core.fetch_screenshots import graphql_images, image_detail, download_image
    import imagehash
    from PIL import Image

    style = config.get("art_style", "欧美")
    tags = config.get("tags", [])

    game_path = output_dir / game_dir
    game_path.mkdir(parents=True, exist_ok=True)

    # Load existing hashes to avoid re-downloading duplicates
    existing_hashes = []
    for f in game_path.glob("concept_*.png"):
        if f.name != filename and "combined" not in f.name:
            try:
                im = Image.open(f)
                existing_hashes.append(imagehash.phash(im))
            except Exception:
                pass

    SIMILAR_THRESHOLD = 10

    # Look for available items in the crawl cache (if saved)
    cache_path = output_dir / "_candidates.json"
    candidates = []
    if cache_path.exists():
        with open(cache_path, "r", encoding="utf-8") as f:
            all_candidates = json.load(f)
        candidates = all_candidates.get(game_dir, all_candidates.get(game_dir, []))

    for item in candidates:
        img_id = item.get("id")
        if not img_id:
            continue
        try:
            detail = image_detail(img_id, style)
            url = detail.get("content", "")
            if not url:
                continue

            tmp_path = download_image(url, game_path, f"_tmp_replace_{img_id}.jpg")
            if not tmp_path:
                continue

            im = Image.open(tmp_path)
            h = imagehash.phash(im)

            # Check similarity with existing screenshots
            is_similar = False
            for existing_hash in existing_hashes:
                if int(h - existing_hash) <= SIMILAR_THRESHOLD:
                    is_similar = True
                    break
            if is_similar:
                try:
                    tmp_path.unlink()
                except Exception:
                    pass
                # Remove this candidate from future consideration
                if item in candidates:
                    candidates.remove(item)
                continue

            # Save as replacement
            im.save(game_path / filename, "PNG")
            try:
                tmp_path.unlink()
            except Exception:
                pass
            return True, f"已补充 {game_dir}/{filename}"

        except Exception:
            continue

    return False, f"无法补充 {game_dir}/{filename}，候选截图不足"


class ScreenshotHandler(SimpleHTTPRequestHandler):
    """自定义 HTTP 请求处理器，提供静态文件服务并处理删除/补图请求。

    继承自 SimpleHTTPRequestHandler，添加了:
    - CORS 头支持跨域
    - /list-images 端点列出目录中所有图片
    - /delete 端点删除指定截图
    - /replenish 端点补下载截图
    - /add-folder 端点添加外部文件夹扫描
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def end_headers(self):
        # Add CORS headers
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/list-images":
            self._handle_list_images()
        else:
            super().do_GET()

    def _handle_list_images(self):
        """处理 /list-images 请求，返回服务目录中所有图片文件的 JSON 列表。"""
        base_dir = Path(self.directory)
        image_extensions = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}
        images = []

        for f in sorted(base_dir.rglob("*")):
            if f.suffix.lower() in image_extensions:
                rel_path = f.relative_to(base_dir).as_posix()
                parts = rel_path.split("/")
                game_dir = parts[-2] if len(parts) >= 2 else ""
                images.append({
                    "path": rel_path,
                    "gameDir": game_dir,
                    "filename": f.name,
                    "url": f"/{rel_path}",
                })

        self._json_response(200, {"success": True, "images": images, "total": len(images)})

    def do_POST(self):
        parsed = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8")

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._json_response(400, {"success": False, "error": "无效的 JSON"})
            return

        if parsed.path == "/delete":
            self._handle_delete(data)
        elif parsed.path == "/replenish":
            self._handle_replenish(data)
        elif parsed.path == "/add-folder":
            self._handle_add_folder(data)
        else:
            self._json_response(404, {"success": False, "error": "未知端点"})

    def _handle_delete(self, data):
        # Use full path if provided, otherwise fallback to game_dir + filename
        file_path_str = data.get("path", "")
        game_dir = data.get("game_dir", "")
        filename = data.get("filename", "")

        base_dir = Path(self.directory)

        if file_path_str:
            file_path = (base_dir / file_path_str).resolve()
            # Security: ensure the resolved path is within base_dir
            if not str(file_path).startswith(str(base_dir.resolve())):
                self._json_response(403, {"success": False, "error": "路径不合法"})
                return
        elif game_dir and filename:
            file_path = base_dir / game_dir / filename
        else:
            self._json_response(400, {"success": False, "error": "参数不完整"})
            return

        if not file_path.exists():
            self._json_response(404, {"success": False, "error": "文件不存在"})
            return

        try:
            file_path.unlink()
            # Log deletion
            if hasattr(self.server, 'report_file') and self.server.report_file:
                log_path = Path(self.server.report_file)
            else:
                log_path = base_dir / "deletion_log.txt"
            log_line = log_deletion(log_path, file_path_str or f"{game_dir}/{filename}")
            print(f"[删除] {log_line}")

            self._json_response(200, {
                "success": True,
                "message": "删除成功",
            })
        except Exception as e:
            self._json_response(500, {"success": False, "error": str(e)})

    def _handle_replenish(self, data):
        # Use full path if provided, otherwise fallback to game_dir + filename
        file_path_str = data.get("path", "")
        game_dir = data.get("game_dir", "")
        filename = data.get("filename", "")

        if file_path_str:
            # Extract directory from path (parent of the file)
            p = Path(file_path_str)
            game_dir = str(p.parent).replace("\\", "/")
            filename = p.name
        elif not game_dir or not filename:
            self._json_response(400, {"success": False, "error": "参数不完整"})
            return

        base_dir = Path(self.directory)
        config_path = base_dir / "_crawl_config.json"

        config = {}
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)

        success, message = replenish_screenshot(base_dir, game_dir, filename, config)

        if success:
            self._json_response(200, {"success": True, "message": message})
        else:
            self._json_response(200, {"success": False, "warning": message})

    def _handle_add_folder(self, data):
        """处理 /add-folder 请求，添加外部文件夹并扫描其中的图片。

        Args:
            data: 请求 JSON 数据，包含 folder_path 字段。
        """
        folder_path = data.get("folder_path", "").strip()

        if not folder_path:
            self._json_response(400, {"success": False, "error": "文件夹路径不能为空"})
            return

        # Resolve the path - if relative, relative to the served directory
        base_dir = Path(self.directory)
        try:
            if Path(folder_path).is_absolute():
                target_dir = Path(folder_path).resolve()
            else:
                target_dir = (base_dir / folder_path).resolve()
        except Exception as e:
            self._json_response(400, {"success": False, "error": f"路径格式错误: {str(e)}"})
            return

        if not target_dir.exists():
            self._json_response(404, {"success": False, "error": f"文件夹不存在: {target_dir}"})
            return

        if not target_dir.is_dir():
            self._json_response(400, {"success": False, "error": f"不是有效的文件夹: {target_dir}"})
            return

        # Scan for images
        image_extensions = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}
        images = []
        base_served = Path(self.directory).resolve()

        try:
            for f in sorted(target_dir.rglob("*")):
                if f.suffix.lower() in image_extensions:
                    # Get relative path from the served directory
                    try:
                        # If the folder is inside served dir, use relative path
                        rel_path = f.relative_to(base_served).as_posix()
                    except ValueError:
                        # If outside, we need to create a virtual path under /external/
                        # We can't actually serve files outside the cwd due to SimpleHTTP constraints
                        # So we just return the info but note they need to be under the served root
                        rel_path = f"external/{f.name}"

                    parts = rel_path.split("/")
                    game_dir = parts[-2] if len(parts) >= 2 else ""
                    images.append({
                        "path": rel_path,
                        "gameDir": game_dir,
                        "filename": f.name,
                        "url": f"/{rel_path}",
                    })

            self._json_response(200, {
                "success": True,
                "message": f"找到 {len(images)} 张图片",
                "folder_path": str(target_dir),
                "images": images,
                "total": len(images)
            })

        except Exception as e:
            self._json_response(500, {"success": False, "error": f"扫描失败: {str(e)}"})

    def _json_response(self, status_code, data):
        """发送 JSON 格式的 HTTP 响应。

        Args:
            status_code: HTTP 状态码。
            data: 要发送的 JSON 数据字典。
        """
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


def main():
    """游戏截图浏览服务器主入口。

    启动 HTTP 服务器提供网页界面浏览截图，支持删除和补充下载。
    自动将预构建的 image-browser.html 复制到输出目录作为首页。
    """
    parser = argparse.ArgumentParser(description="游戏截图浏览服务器")
    parser.add_argument("--dir", "-d", default="./output",
                        help="截图输出目录（默认 ./output）")
    parser.add_argument("--port", "-p", type=int, default=8080,
                        help="监听端口（默认 8080）")
    parser.add_argument("--bind", default="127.0.0.1",
                        help="绑定地址（默认 127.0.0.1）")
    parser.add_argument("--report", "-r",
                        help="删除记录报告文件路径（如 _tag_screenshot_report.txt）")
    args = parser.parse_args()

    output_dir = Path(args.dir).resolve()
    if not output_dir.exists():
        print(f"[错误] 目录不存在: {output_dir}")
        sys.exit(1)

    # Copy the image-browser.html to output directory if no index exists (top-level only)
    index_files = list(output_dir.glob("index.html"))
    if not index_files:
        # Copy our pre-built image browser to the output directory
        source_html = Path(__file__).parent / "image-browser.html"
        target_index = output_dir / "index.html"
        if source_html.exists():
            with open(source_html, "r", encoding="utf-8") as f:
                content = f.read()
            with open(target_index, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"[信息] 已创建浏览页面: {target_index}")
            target_dir = output_dir
        else:
            target_dir = output_dir
            print(f"[警告] 未找到 image-browser.html，直接服务: {target_dir}")
    else:
        # Use the most recent index.html's parent as the serve directory
        index_files.sort(key=lambda p: p.stat().st_mtime)
        target_dir = index_files[-1].parent
        print(f"[信息] 找到浏览页面: {target_dir / 'index.html'}")

    # Handle report file
    report_file = None
    if args.report:
        report_file = Path(args.report).resolve()
        if not report_file.exists():
            print(f"[警告] 报告文件不存在，将创建: {report_file}")
        print(f"[信息] 删除记录将写入: {report_file}")

    # We need to patch the directory because SimpleHTTPRequestHandler uses self.directory
    # The correct way is to create a subclass with the directory bound
    original_cwd = os.getcwd()
    os.chdir(target_dir)

    server = HTTPServer((args.bind, args.port), ScreenshotHandler)
    # Store report_file in server instance for handler to access
    server.report_file = report_file

    print("=" * 60)
    print(f"游戏截图浏览服务器已启动")
    print(f"  地址: http://{args.bind}:{args.port}")
    print(f"  目录: {target_dir.resolve()}")
    if report_file:
        print(f"  报告: {report_file}")
    print(f"  打开浏览器访问即可查看和删除截图")
    print(f"  - 单击图片 选中/取消选中")
    print(f"  - 双击图片 放大预览")
    print(f"  - 删除后自动触发补充下载")
    print(f"  按 Ctrl+C 停止服务器")
    print("=" * 60)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")
        server.server_close()
        os.chdir(original_cwd)


if __name__ == "__main__":
    main()
