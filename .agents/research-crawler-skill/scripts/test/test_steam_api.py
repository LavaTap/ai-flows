import requests
import json
import os
import urllib3

urllib3.disable_warnings()

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(SCRIPT_DIR)
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPTS_DIR))

output_dir = os.path.join(PROJECT_ROOT, 'output', 'steam')
os.makedirs(output_dir, exist_ok=True)

print("开始测试 Steam 接口...")

def fetch_and_save(url, filename):
    try:
        # 尝试通过环境变量获取代理，或设置较短超时
        proxies = {
            'http': os.environ.get('HTTP_PROXY', ''),
            'https': os.environ.get('HTTPS_PROXY', '')
        }
        # 清理空代理配置
        proxies = {k: v for k, v in proxies.items() if v}
        
        r = requests.get(url, timeout=10, proxies=proxies, verify=False)
        print(f"状态码: {r.status_code}")
        try:
            data = r.json()
            with open(os.path.join(output_dir, filename), "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return data
        except Exception as e:
            print(f"解析 JSON 失败: {e}")
            with open(os.path.join(output_dir, filename.replace('.json', '.txt')), "w", encoding="utf-8") as f:
                f.write(r.text)
            return None
    except Exception as e:
        print(f"请求失败: {e}")
        return None

# 1. GetAppList
print("\n1. 测试 GetAppList API...")
url1 = "https://api.steampowered.com/ISteamApps/GetAppList/v2/"
data1 = fetch_and_save(url1, "applist_raw.json")
if data1 and "applist" in data1 and "apps" in data1["applist"]:
    print(f"成功获取应用列表，共包含 {len(data1['applist']['apps'])} 个应用")

# 2. appdetails
print("\n2. 测试 appdetails API (appid=240)...")
url2 = "https://store.steampowered.com/api/appdetails?appids=240"
data2 = fetch_and_save(url2, "appdetails_240_raw.json")
if data2 and "240" in data2 and data2["240"].get("success"):
    print(f"成功获取游戏详情: {data2['240']['data']['name']}")

# 3. appreviews
print("\n3. 测试 appreviews API (appid=240)...")
url3 = "https://store.steampowered.com/appreviews/240?json=1&language=all&num_per_page=100"
data3 = fetch_and_save(url3, "appreviews_240_raw.json")
if data3 and "success" in data3 and data3["success"] == 1:
    print(f"成功获取评论，共获取到 {len(data3.get('reviews', []))} 条本页评论")
    print(f"总评论数 (query_summary): {data3.get('query_summary', {}).get('total_reviews')}")

print("\n接口测试完成，数据已保存到 output/steam 目录。")
