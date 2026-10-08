#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""更新 cookie：打开浏览器 -> 用户登录 -> 按回车保存 cookie

使用方法:
    venv\\Scripts\\python.exe research-crawler-skill/scripts/xiaohongshu/update_cookie.py

1. 运行脚本，浏览器会自动打开小红书
2. 你在浏览器中手动完成登录
3. 登录完成后，回到控制台按回车键保存 cookie
"""

import os
import pickle
import time
from DrissionPage import ChromiumPage
from DrissionPage._configs.chromium_options import ChromiumOptions

# 定位项目根目录：从脚本目录向上找 3 层
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RESEARCH_CRAWLER_SKILL_DIR = os.path.dirname(SCRIPT_DIR)
PROJECT_ROOT = os.path.dirname(RESEARCH_CRAWLER_SKILL_DIR)

COOKIES_FILE = os.path.join(SCRIPT_DIR, '.xhs_cookies.pkl')
EDGE_PATH = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

def main():
    co = ChromiumOptions()
    co.set_browser_path(EDGE_PATH)
    page = ChromiumPage(co)

    try:
        print("="*60)
        print("Xiaohongshu Cookie Update Tool")
        print("="*60)
        print("\n浏览器已打开，正在导航到小红书...")
        page.get('https://www.xiaohongshu.com')
        time.sleep(2)

        print("\n" + "="*60)
        print(">>> 请在浏览器中完成登录操作")
        print(">>> 登录成功后，回到这里按回车键保存 cookie")
        print("="*60)

        try:
            input("\n按回车键开始保存...")
        except:
            pass

        print("\n正在保存 cookie...")
        # DrissionPage 的 page.cookies() 返回的 cookies 是 Playwright 格式的
        # 兼容 pickle.dump，直接保存整个列表
        cookies = page.cookies()

        with open(COOKIES_FILE, 'wb') as f:
            pickle.dump(cookies, f)

        print("\n" + "="*60)
        print("OK .xhs_cookies.pkl updated!")
        print(f"   {len(cookies)} cookies saved")
        print(f"   Save to: {COOKIES_FILE}")
        print("="*60)

    finally:
        page.quit()


if __name__ == '__main__':
    main()