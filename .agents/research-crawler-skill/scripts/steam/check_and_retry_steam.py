import os
import csv

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPTS_DIR))

STEAM_OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output', 'steam')
GAMES_LIST_FILE = os.path.join(PROJECT_ROOT, 'reports', 'steam', 'steam_games_list.txt')
FAILED_LIST_FILE = os.path.join(PROJECT_ROOT, 'reports', 'steam', 'steam_failed_games_to_retry.txt')

def get_games_from_list(filepath):
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
            # 查找子目录中的 output/output.csv
            for sub_dir in os.listdir(game_dir):
                sub_path = os.path.join(game_dir, sub_dir)
                if os.path.isdir(sub_path):
                    output_csv = os.path.join(sub_path, 'output', 'output.csv')
                    if os.path.exists(output_csv):
                        # 检查是否有内容
                        with open(output_csv, 'r', encoding='utf-8-sig') as f:
                            rows = list(csv.reader(f))
                            if len(rows) > 1:  # 大于1行说明有评论内容
                                is_success = True
                                break
        
        if not is_success:
            failed_games.append(game)
            
    print(f"共发现 {len(failed_games)} 个失败/未完成的游戏。")
    with open(FAILED_LIST_FILE, 'w', encoding='utf-8') as f:
        for game in failed_games:
            f.write(game + '\n')
            print(f"- {game}")
            
    return FAILED_LIST_FILE

if __name__ == "__main__":
    check_failed_games()
