import os
import csv

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

STEAM_OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output', 'steam')
GAMES_LIST_FILE = os.path.join(PROJECT_ROOT, 'reports', 'steam', 'steam_games_list.txt')
FAILED_LIST_FILE = os.path.join(PROJECT_ROOT, 'reports', 'steam', 'steam_failed_games_to_retry.txt')

# output.csv 首行为表头，数据行数大于该值即视为已采集到评论
MIN_DATA_ROWS = 1

def get_games_from_list(filepath):
    if not os.path.exists(filepath):
        print(f"错误: 找不到游戏清单文件 {filepath}")
        return []
    games = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            name = line.strip()
            if name:
                games.append(name)
    return games

def check_failed_games():
    games = get_games_from_list(GAMES_LIST_FILE)
    failed_games = []
    
    for game in games:
        safe_name = "".join(c for c in game if c.isalnum() or c in " _-")
        game_dir = os.path.join(STEAM_OUTPUT_DIR, safe_name)
        
        is_success = False
        if os.path.exists(game_dir):
            # 查找子目录中的 output/output.csv（跳过隐藏目录，目录读取失败不影响整体流程）
            try:
                sub_dirs = [d for d in os.listdir(game_dir) if not d.startswith('.')]
            except OSError as e:
                print(f"读取目录失败 {game_dir}: {e}")
                sub_dirs = []
            for sub_dir in sub_dirs:
                sub_path = os.path.join(game_dir, sub_dir)
                if os.path.isdir(sub_path):
                    output_csv = os.path.join(sub_path, 'output', 'output.csv')
                    if os.path.exists(output_csv):
                        # 逐行计数，无需把整个 CSV 读入内存
                        try:
                            with open(output_csv, 'r', encoding='utf-8-sig') as f:
                                data_rows = 0
                                for _ in csv.reader(f):
                                    data_rows += 1
                                    if data_rows > MIN_DATA_ROWS:
                                        break
                        except (OSError, UnicodeDecodeError) as e:
                            print(f"读取失败 {output_csv}: {e}")
                            continue
                        if data_rows > MIN_DATA_ROWS:  # 存在数据行说明有评论内容
                            is_success = True
                            break
        
        if not is_success:
            failed_games.append(game)
            
    print(f"共发现 {len(failed_games)} 个失败/未完成的游戏。")
    os.makedirs(os.path.dirname(FAILED_LIST_FILE), exist_ok=True)
    with open(FAILED_LIST_FILE, 'w', encoding='utf-8') as f:
        for game in failed_games:
            f.write(game + '\n')
            print(f"- {game}")
            
    return FAILED_LIST_FILE

if __name__ == "__main__":
    check_failed_games()