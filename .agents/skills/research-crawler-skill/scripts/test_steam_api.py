import json
import os
import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

# 测试目标 AppID（Counter-Strike: Source）
APP_ID = 240


def fetch_and_save(url, filename):
    output_dir = os.path.join(PROJECT_ROOT, 'output', 'steam')
    os.makedirs(output_dir, exist_ok=True)
    try:
        # 尝试通过环境变量获取代理，或设置较短超时
        proxies = {
            'http': os.environ.get('HTTP_PROXY', ''),
            'https': os.environ.get('HTTPS_PROXY', '')
        }
        # 清理空代理配置
        proxies = {k: v for k, v in proxies.items() if v}

        r = requests.get(url, timeout=10, proxies=proxies)
        print(f"状态码: {r.status_code}")
        if r.status_code != 200:
            print(f"请求返回非成功状态码: {r.status_code}")
            return None
        try:
            data = r.json()
        except Exception as e:
            print(f"解析 JSON 失败: {e}")
            try:
                with open(os.path.join(output_dir, filename.replace('.json', '.txt')), "w", encoding="utf-8") as f:
                    f.write(r.text)
            except OSError as werr:
                print(f"写入文本失败: {werr}")
            return None
        try:
            with open(os.path.join(output_dir, filename), "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except OSError as e:
            print(f"写入 JSON 失败: {e}")
        return data
    except Exception as e:
        print(f"请求失败: {e}")
        return None


def main():
    print("开始测试 Steam 接口...")

    # 1. GetAppList
    print("\n1. 测试 GetAppList API...")
    url1 = "https://api.steampowered.com/ISteamApps/GetAppList/v2/"
    data1 = fetch_and_save(url1, "applist_raw.json")
    apps = data1.get("applist", {}).get("apps") if isinstance(data1, dict) else None
    if isinstance(apps, list):
        print(f"成功获取应用列表，共包含 {len(apps)} 个应用")

    # 2. appdetails
    print(f"\n2. 测试 appdetails API (appid={APP_ID})...")
    url2 = f"https://store.steampowered.com/api/appdetails?appids={APP_ID}"
    data2 = fetch_and_save(url2, f"appdetails_{APP_ID}_raw.json")
    entry = data2.get(str(APP_ID), {}) if isinstance(data2, dict) else {}
    if entry.get("success"):
        name = (entry.get("data") or {}).get("name")
        if name:
            print(f"成功获取游戏详情: {name}")

    # 3. appreviews
    print(f"\n3. 测试 appreviews API (appid={APP_ID})...")
    url3 = f"https://store.steampowered.com/appreviews/{APP_ID}?json=1&language=all&num_per_page=100"
    data3 = fetch_and_save(url3, f"appreviews_{APP_ID}_raw.json")
    if isinstance(data3, dict) and data3.get("success") == 1:
        print(f"成功获取评论，共获取到 {len(data3.get('reviews', []))} 条本页评论")
        print(f"总评论数 (query_summary): {data3.get('query_summary', {}).get('total_reviews')}")

    print("\n接口测试完成，数据已保存到 output/steam 目录。")


if __name__ == '__main__':
    main()