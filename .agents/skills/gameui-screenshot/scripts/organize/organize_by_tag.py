"""按三标签分类整理截图，每个文件夹最多3张，使用编号命名。

此脚本解析 `crawl_all_categories.py` 生成的文件名（格式：
"序号_标签_游戏名.jpg"），按标签分组，创建编号文件夹，每组最多3张截图。
基于三键分类体系自动在文件夹名称中包含分类信息。

使用示例：
    python .agents/skills/gameui-screenshot/scripts/organize/organize_by_tag.py
        [--input-dir ./screenshots_output_multi]
        [--output-dir ./screenshots_by_tag] [--dry-run]
"""
import argparse
import shutil
from pathlib import Path
from collections import defaultdict

# 项目根目录（脚本在 scripts/organize/，往上5级）
PROJECT_ROOT = Path(__file__).resolve().parents[5]


def parse_tag(filename):
    """从文件名提取标签（下划线分隔的第二段）。

    示例: "01_主界面_575887_足球天才.jpg" -> "主界面"

    Args:
        filename: 要解析的文件名。

    Returns:
        str: 提取出的标签名，解析失败返回 "未知"。
    """
    stem = Path(filename).stem
    parts = stem.split("_")
    return parts[1] if len(parts) >= 2 else "未知"


def organize_by_tag(input_dir, output_dir, dry_run=False):
    """按标签整理截图，最多3张分到一个编号组。

    在输入目录递归查找所有 JPG 文件，按提取出的标签分组，
    切分为最多3张每块，复制到输出目录的编号文件夹。

    Args:
        input_dir: 包含下载的 JPG 截图的输入目录。
        output_dir: 整理后分组的输出目录。
        dry_run: 如果为 True，只打印将要执行的操作，不实际复制。默认为 False.
    """
    src = Path(input_dir)
    dst = Path(output_dir)

    if not src.is_dir():
        print(f"[错误] 输入目录不存在: {src}")
        return

    # 1. 递归收集所有 jpg
    jpg_files = list(src.rglob("*.jpg"))
    if not jpg_files:
        print(f"[信息] 目录中没有 .jpg 文件: {src}")
        return

    print(f"[信息] 共找到 {len(jpg_files)} 张截图")

    # 2. 按标签分组
    tag_groups = defaultdict(list)
    for f in sorted(jpg_files):
        tag = parse_tag(f.name)
        tag_groups[tag].append(f)

    # 3. 拆分每组（至多3张），生成编号
    group_entries = []  # [(folder_name, [files]), ...]
    seq = 0
    for tag, files in sorted(tag_groups.items(), key=lambda x: -len(x[1])):
        # 统计该标签包含的三大要素分类
        cats = set()
        for cat_name, tag_list in CATEGORIES.items():
            if tag in tag_list:
                cats.add(cat_name)
        cat_info = "_".join(sorted(cats)) if cats else ""

        for chunk_start in range(0, len(files), 3):
            chunk = files[chunk_start:chunk_start + 3]
            seq += 1
            # 文件夹名: 序号_标签 (从属分类)
            safe_tag = "".join(c for c in tag if c.isalnum() or c in "_-. ").strip()
            suffix = f"_{cat_info}" if cat_info else ""
            folder_name = f"{seq:03d}_{safe_tag}{suffix}"
            group_entries.append((folder_name, chunk))

    print(f"[信息] 共分为 {len(group_entries)} 组\n")

    # 4. 复制文件到编号文件夹
    copied = 0
    for folder_name, file_list in group_entries:
        group_dir = dst / folder_name
        if dry_run:
            print(f"  [模拟] {folder_name}/ ({len(file_list)}张)")
        else:
            group_dir.mkdir(parents=True, exist_ok=True)

        for f in file_list:
            dest = group_dir / f.name
            if dry_run:
                print(f"           {f.name}")
            else:
                shutil.copy2(str(f), str(dest))
                copied += 1

    # 5. 输出汇总
    print(f"\n{'='*60}")
    if dry_run:
        print(f"[模拟] 将创建 {len(group_entries)} 个文件夹，复制 {len(jpg_files)} 个文件")
    else:
        print(f"[完成] 已创建 {len(group_entries)} 个文件夹，复制 {copied} 个文件")
        print(f"输出目录: {dst.resolve()}")

    print(f"\n分组汇总：")
    print(f"{'文件夹':<35} {'标签':<12} {'张数':<6}")
    print('-' * 55)
    for folder_name, file_list in group_entries:
        tag = parse_tag(file_list[0].name)
        print(f"{folder_name:<35} {tag:<12} {len(file_list):<6}")


# 三大要素分类（用于标注从属关系）
CATEGORIES = {
    "卖点信息_玩法": [
        "战斗界面", "VS", "匹配", "结算", "卡组", "卡牌",
        "建造", "家园", "关卡", "挑战", "组队", "阵容",
        "赛季", "段位", "锻造", "合成", "技能", "任务", "地图"
    ],
    "卖点信息_题材世界观": [
        "创建角色", "阵营选择", "章节提示", "NPC对话",
        "宠物", "坐骑", "图鉴", "工会", "帮派", "姓名输入"
    ],
    "卖点信息_美术": [
        "过场动画", "主界面"
    ],
    "美术风格与调性": [
        "登录界面", "Loading", "过场动画", "主界面", "战斗界面",
        "地图", "创建角色", "外观", "时装", "拍照"
    ],
    "特殊吸量元素": [
        "十连抽", "招募", "转盘", "抽奖", "七日", "签到",
        "福利", "活动", "首充", "通行证", "VIP", "商城",
        "宝箱", "金币", "头像框", "称号", "结婚", "邀请好友",
        "排行榜", "拍脸图", "红包"
    ]
}


def main():
    """基于标签的整理脚本主入口。

    解析命令行参数并执行整理流程。
    """
    parser = argparse.ArgumentParser(description="按标签分类整理截图，至多3张一组编号文件夹")
    parser.add_argument("--input-dir", default=str(PROJECT_ROOT / "screenshots_output_multi"), help="输入目录（支持递归）")
    parser.add_argument("--output-dir", default=str(PROJECT_ROOT / "screenshots_by_tag"), help="输出目录")
    parser.add_argument("--dry-run", action="store_true", help="仅模拟不复制")
    args = parser.parse_args()
    organize_by_tag(args.input_dir, args.output_dir, args.dry_run)


if __name__ == "__main__":
    main()
