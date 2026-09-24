"""游戏截图工作流的共享日志管理模块。

此模块提供结构化的日志记录功能，包含时间记录和章节划分。
所有日志最终以 UTF-8 编码保存到文件，同时支持输出到终端。

使用示例：
    from log_util import LogManager
    log = LogManager(output_dir)
    log.header("配置")
    log.add("风格", styles)
    log.add("目标游戏数", games_per_style)
    log.duration()  # 自动记录运行时长
    log.save()      # 写入 _report.txt 文件
    log.print()     # 输出到终端

日志在调用 save() 方法后自动写入 _report.txt 文件。
"""
import time
import os
from pathlib import Path
from datetime import datetime


class LogManager:
    """结构化日志管理器，支持章节划分、计时统计和文件输出。

    用于统一所有工作流脚本的日志格式，同时输出到终端和文件，
    自动记录运行时长，支持多级标题（主标题、子标题）。
    """

    def __init__(self, output_dir, name="workflow"):
        """初始化日志管理器。

        Args:
            output_dir: 日志输出目录，会自动创建。
            name: 日志名称，用于生成报告文件名。默认为 "workflow"。
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.name = name
        self.start_time = time.time()
        self.lines = []
        self._section_open = False

    # ── header ──────────────────────────────────────────────────

    def header(self, title):
        """开始一个新的主章节，添加分隔线标题。

        Args:
            title: 章节标题。
        """
        if self._section_open:
            self.lines.append("")
        width = 65
        self.lines.append("=" * width)
        self.lines.append(f"{title}  [{now()}]")
        self.lines.append("=" * width)
        self._section_open = True

    # ── add line(s) ─────────────────────────────────────────────

    def add(self, *args):
        """添加一行或多行日志，支持纯文本或(标签, 值)元组格式。

        Args:
            *args: 要添加的内容，可以是：
                - 字符串：直接作为一行添加
                - (标签, 值)元组：自动格式化为 "  标签: 值"
        """
        for arg in args:
            if isinstance(arg, tuple):
                label, value = arg
                self.lines.append(f"  {label}: {value}")
            else:
                self.lines.append(str(arg))

    def blank(self):
        """添加一个空行，用于分隔内容。"""
        self.lines.append("")

    # ── elapsed / duration ──────────────────────────────────────

    def duration(self, label="运行时长"):
        """记录从开始（或上次计时）到现在的耗时。

        Args:
            label: 计时标签。默认为 "运行时长"。

        Returns:
            float: 经过的秒数。
        """
        elapsed = time.time() - self.start_time
        hrs, rem = divmod(int(elapsed), 3600)
        mins, secs = divmod(rem, 60)
        if hrs > 0:
            ts = f"{hrs}h {mins}m {secs}s"
        elif mins > 0:
            ts = f"{mins}m {secs}s"
        else:
            ts = f"{secs}s"
        self.lines.append(f"  {label}: {ts}")
        return elapsed

    def reset_timer(self):
        """重置计时器，用于下一轮计时。"""
        self.start_time = time.time()

    # ── section helpers ─────────────────────────────────────────

    def sub_header(self, title):
        """添加一个子章节标题。

        Args:
            title: 子章节标题。
        """
        if self._section_open:
            self.lines.append("")
        self.lines.append(f"--- {title} ---")
        self._section_open = True

    def game_line(self, status_tag, text):
        """添加一行游戏级别的进度信息。

        Args:
            status_tag: 状态标签（如 ✅、⏳）。
            text: 进度文本。
        """
        self.lines.append(f"  {status_tag} {text}")

    # ── save / print / close ────────────────────────────────────

    def save(self, filename=None):
        """将缓存的日志内容写入文件。

        Args:
            filename: 自定义文件名，默认生成 `_{name}_report.txt`。

        Returns:
            Path: 保存的文件路径。
        """
        fn = filename or f"_{self.name}_report.txt"
        path = self.output_dir / fn
        content = "\n".join(self.lines)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
            if not content.endswith("\n"):
                f.write("\n")
        return path

    def print(self):
        """将所有缓存的日志行打印到标准输出。"""
        for line in self.lines:
            print(line)

    @property
    def text(self):
        """获取当前所有日志内容的字符串。"""
        return "\n".join(self.lines)

    def close(self):
        """完成日志记录，保存并打印。

        自动添加运行时长和结束时间标记，然后保存到文件并打印到终端。

        Returns:
            Path: 保存的日志文件路径。
        """
        self.duration()
        self.lines.append("")
        self.lines.append(f"日志结束: {now()}")
        path = self.save()
        self.print()
        print(f"\n日志已保存: {path}")
        return path


def now():
    """获取当前时间的格式化字符串。

    Returns:
        str: "YYYY-MM-DD HH:MM:SS" 格式的当前时间。
    """
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
