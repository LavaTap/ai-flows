import json
import csv
import os
import sys
import argparse
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

# 默认游戏名称：AppID 240 为 Counter-Strike: Source，可通过 --game-name 覆盖
DEFAULT_GAME_NAME = "Counter-Strike: Source"

RAW_HEADERS = ["编号", "昵称", "用户ID", "评论内容", "发布时间", "点赞数"]
CLEAN_HEADERS = [
    "序号", "平台", "游戏名称", "评论内容", "情绪倾向", "情绪关键词",
    "是否提及治愈", "治愈相关度", "治愈感受细分", "吸引游玩因素",
    "判断依据", "复核调整说明"
]


def convert(raw_json_path, base_dir, game_name):
    """读取原始 JSON，写出 raw / clean / output 三个 CSV。

    Args:
        raw_json_path: Steam appreviews 原始 JSON 路径。
        base_dir: 输出根目录（``output/steam``）。
        game_name: 写入 CSV 的游戏名称。

    Returns:
        是否成功。
    """
    raw_csv_dir = os.path.join(base_dir, "raw")
    clean_csv_dir = os.path.join(raw_csv_dir, "clean")
    output_csv_dir = os.path.join(base_dir, "output")

    # 创建所需目录
    os.makedirs(raw_csv_dir, exist_ok=True)
    os.makedirs(clean_csv_dir, exist_ok=True)
    os.makedirs(output_csv_dir, exist_ok=True)

    raw_csv_path = os.path.join(raw_csv_dir, "240.csv")
    clean_csv_path = os.path.join(clean_csv_dir, "240_clean.csv")
    output_csv_path = os.path.join(output_csv_dir, "output.csv")

    if not os.path.exists(raw_json_path):
        print(f"错误: 找不到原始 JSON 文件 {raw_json_path}")
        return False

    # 1. 读取原始JSON
    with open(raw_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    reviews = data.get("reviews", [])

    # 2. 写入 raw 6字段 CSV (编号, 昵称, 用户ID, 评论内容, 发布时间, 点赞数)
    with open(raw_csv_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(RAW_HEADERS)
        for i, rev in enumerate(reviews, 1):
            author = rev.get("author", {})
            steam_id = author.get("steamid", "")
            # 将换行符替换为空格以防CSV混乱
            content = rev.get("review", "").replace("\n", " ").replace("\r", "")
            timestamp = rev.get("timestamp_created", 0)
            # 时间戳缺失或非法时留空，避免生成 1970-01-01 的误导性时间
            if isinstance(timestamp, (int, float)) and timestamp > 0:
                dt = datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")
            else:
                dt = ""
            votes_up = rev.get("votes_up", 0)

            writer.writerow([i, author.get("personaname", ""), steam_id, content, dt, votes_up])

    print(f"已生成原始评论文件: {raw_csv_path}")

    # 3. 写入 clean/output 12字段 CSV
    # clean 为中间产物，output 为下游流程消费的最终产物，两者内容一致、均保留以兼容既有流程
    with open(clean_csv_path, "w", encoding="utf-8-sig", newline="") as f_clean, \
         open(output_csv_path, "w", encoding="utf-8-sig", newline="") as f_out:

        writer_clean = csv.writer(f_clean)
        writer_out = csv.writer(f_out)

        writer_clean.writerow(CLEAN_HEADERS)
        writer_out.writerow(CLEAN_HEADERS)

        for i, rev in enumerate(reviews, 1):
            content = rev.get("review", "").replace("\n", " ").replace("\r", "")
            row = [i, "Steam", game_name, content, "", "", "", "", "", "", "", ""]
            writer_clean.writerow(row)
            writer_out.writerow(row)

    print(f"已生成清洗文件: {clean_csv_path}")
    print(f"已生成最终输出文件: {output_csv_path}")
    return True


def main():
    parser = argparse.ArgumentParser(description='将 Steam 原始评论 JSON 转换为 raw/clean/output CSV。')
    parser.add_argument('--game-name', default=DEFAULT_GAME_NAME,
                        help=f'游戏名称（默认: {DEFAULT_GAME_NAME}）')
    args = parser.parse_args()

    base_dir = os.path.join(PROJECT_ROOT, 'output', 'steam')
    raw_json_path = os.path.join(base_dir, "appreviews_240_raw.json")
    if not convert(raw_json_path, base_dir, args.game_name):
        sys.exit(1)


if __name__ == "__main__":
    main()