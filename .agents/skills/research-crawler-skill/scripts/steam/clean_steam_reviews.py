import json
import csv
import os
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPTS_DIR))

# 文件路径配置
base_dir = os.path.join(PROJECT_ROOT, 'output', 'steam')
raw_json_path = os.path.join(base_dir, "appreviews_240_raw.json")
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

# 1. 读取原始JSON
with open(raw_json_path, "r", encoding="utf-8") as f:
    data = json.load(f)

reviews = data.get("reviews", [])
game_name = "Counter-Strike: Source"  # AppID 240 is CS:S

# 2. 写入 raw 6字段 CSV (编号, 昵称, 用户ID, 评论内容, 发布时间, 点赞数)
raw_headers = ["编号", "昵称", "用户ID", "评论内容", "发布时间", "点赞数"]
with open(raw_csv_path, "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(raw_headers)
    for i, rev in enumerate(reviews, 1):
        author = rev.get("author", {})
        steam_id = author.get("steamid", "")
        # 将换行符替换为空格以防CSV混乱
        content = rev.get("review", "").replace("\n", " ").replace("\r", "")
        timestamp = rev.get("timestamp_created", 0)
        dt = datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")
        votes_up = rev.get("votes_up", 0)
        
        writer.writerow([i, steam_id, steam_id, content, dt, votes_up])

print(f"已生成原始评论文件: {raw_csv_path}")

# 3. 写入 clean/output 12字段 CSV
clean_headers = [
    "序号", "平台", "游戏名称", "评论内容", "情绪倾向", "情绪关键词", 
    "是否提及治愈", "治愈相关度", "治愈感受细分", "吸引游玩因素", 
    "判断依据", "复核调整说明"
]

with open(clean_csv_path, "w", encoding="utf-8-sig", newline="") as f_clean, \
     open(output_csv_path, "w", encoding="utf-8-sig", newline="") as f_out:
    
    writer_clean = csv.writer(f_clean)
    writer_out = csv.writer(f_out)
    
    writer_clean.writerow(clean_headers)
    writer_out.writerow(clean_headers)
    
    for i, rev in enumerate(reviews, 1):
        content = rev.get("review", "").replace("\n", " ").replace("\r", "")
        row = [i, "Steam", game_name, content, "", "", "", "", "", "", "", ""]
        writer_clean.writerow(row)
        writer_out.writerow(row)

print(f"已生成清洗文件: {clean_csv_path}")
print(f"已生成最终输出文件: {output_csv_path}")
