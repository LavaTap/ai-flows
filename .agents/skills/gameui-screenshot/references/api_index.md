# gameui.net API 接口索引

---

## 文章/游戏列表

| 项目 | 说明 |
|------|------|
| **端点** | `POST /web/v1/article/list` |
| **Content-Type** | `application/x-www-form-urlencoded; charset=UTF-8` |
| **认证** | 无需登录 |

**请求参数**

| 参数 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `pageNum` | int | 页码 | `1` |
| `pageSize` | int | 每页条数 | `30` |
| `style` | string | 风格筛选 | `欧美` `二次元` `国风` `日韩` `Q版卡通` `科幻` `军事` |
| `categoryId` | int | 分类 ID | `22` |
| `orderByColumn` | string | 排序字段 | `createTime` `see` |
| `isAsc` | string | 排序方向 | `desc` `asc` |
| `rank` | string | 推荐位标识 | `首页推荐` |
| `colorrto` | string | 色调筛选 | `10` |
| `title` | string | 标题搜索 | |
| `tags` | string | 标签筛选 | |
| `device` | string | 设备筛选 | |
| `orientation` | string | 横竖屏 | |
| `era` | string | 年代 | |
| `last` | string | 游标分页 | |

**响应结构**

```json
{
  "code": 0,
  "data": [
    {
      "id": 14800,
      "title": "游戏标题",
      "image": "https://image.gameuiux.cn/路径/文件名.jpg",
      "categoryName": "塔防",
      "style": "欧美",
      "tags": "标签1,标签2",
      "device": "手游",
      "orientation": "竖屏",
      "era": "2026",
      "see": 12,
      "praise": 0,
      "totalImageCount": 116,
      "createTime": "2026-06-30 20:25:06"
    }
  ]
}
```

---

## 截图列表（GraphQL）

| 项目 | 说明 |
|------|------|
| **端点** | `GET /api?query={query}` |
| **认证** | 无需登录 |

**查询语法**

```graphql
{
  images(
    first: 50,
    category_id: "228",
    sort: "id",
    order: DESC
  ) {
    total
    list {
      id
      width
      height
      description
      tags
      praise
      praise_count
      collect
      collect_id
      collect_count
      create_time
      update_time
      article { id, title }
      user { id, user_name, avatar, create_time, update_time, price, rank }
    }
  }
}
```

**参数说明**

| 参数 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `first` | int | 每页条数 | `50` |
| `style` | string | 风格筛选 | `欧美` `二次元` 等 |
| `category_id` | string | 分类 ID 筛选（对应页面左侧"类型"筛选），**支持逗号分隔多值**（勾选多个时累加）。完整映射见下方"类型分类 ID 映射表" | `"228"` |
| `sort` | string | 排序字段 | `id` `create_time` `see` |
| `order` | string | 排序方向 | `DESC` `ASC` |
| `images_desc` | string | 按场景描述筛选，**支持逗号分隔多值**（勾选多个时累加） | `登录界面` `服务器选择,游戏通告` |

> **重要发现**: `images_desc` 支持逗号分隔的多值查询。勾选多个功能分类时，API 会将所有已选值用逗号连接传入。例如勾选"服务器选择"+"游戏通告"+"过场动画"时，值为 `服务器选择,游戏通告,过场动画`。

**功能分类（对应页面"功能"标签页）**
用于第一次筛选（对应页面顶部"场景"标签页）：
| 值 | 说明 |
|----|------|
| `登录界面` | 游戏登录/启动画面（各风格均有数据） |
| `主界面` | 游戏主界面/HUD（各风格均有数据） |
| `角色选择` | **API 无数据（返回 0）** |
| `战斗画面` | **API 无数据（返回 0）** |
| `商店界面` | **API 无数据（返回 0）** |
| `设置界面` | **API 无数据（返回 0）** |
用于第二次筛选，支持 30 个子分类（按网站 UI 排列顺序）：
| 值 | 说明 |
|----|------|
| `服务器选择` | 服务器选择界面 |
| `游戏通告` | 游戏公告/通告 |
| `过场动画` | 过场动画/CG |
| `新手引导` | 新手教程/引导 |
| `主界面` | 主界面/HUD |
| `Loading` | 加载界面 |
| `战斗界面` | 战斗/对战界面 |
| `战斗提示` | 战斗提示/操作指引 |
| `VS/匹配` | VS画面/匹配界面 |
| `升级提示` | 升级提示 |
| `恭喜获得` | 获得物品/奖励 |
| `结算` | 结算/结果界面 |
| `数据统计` | 数据统计 |
| `姓名输入` | 姓名/昵称输入 |
| `NPC对话` | NPC对话 |
| `章节提示` | 章节/关卡提示 |
| `阵营选择` | 阵营/势力选择 |
| `功能解锁` | 功能解锁提示 |
| `菜单` | 菜单界面 |
| `玩家信息` | 玩家信息/资料 |
| `角色` | 角色/英雄列表 |
| `背包` | 背包/仓库 |
| `锻造/合成` | 锻造/合成系统 |
| `技能` | 技能系统 |
| `任务` | 任务系统 |
| `成就` | 成就系统 |
| `关卡/挑战` | 关卡/挑战模式 |
| `公会/帮派` | 公会/帮派系统 |
| `外观/时装` | 外观/时装界面 |
| `图鉴` | 图鉴/收集系统 |

---

## 截图详情

| 项目 | 说明 |
|------|------|
| **端点** | `GET /web/v1/images/detail/v2?imagesId={id}` |
| **认证** | 无需登录 |

**响应关键字段**

```json
{
  "code": 0,
  "data": {
    "id": 1959220,
    "content": "https://image.gameuiux.cn/.../文件名.jpg",
    "originUrl": "https://www.gameui.net/inspirationInfo/14800",
    "width": 720,
    "height": 1280,
    "tags": "--",
    "collectedCount": 0,
    "createTime": "2026-06-30 20:25:06"
  }
}
```

> `content` 字段即为图片下载地址。

---

## 风格分类列表

| 项目 | 说明 |
|------|------|
| **端点** | `GET /web/v1/article/category/getIndexRecommendCategory` |
| **认证** | 无需登录 |

**响应示例**

| 风格 | ID | 文章数 | 图片数 |
|------|-----|--------|--------|
| Q版卡通 | 33 | 3,679 | 436,238 |
| 二次元 | 15 | 1,761 | 324,423 |
| 国风 | 35 | 1,812 | 327,918 |
| 欧美 | 10 | 2,092 | 262,828 |
| 日韩 | 34 | 730 | 111,369 |
| 科幻 | 36 | 338 | 49,866 |
| 军事 | 37 | 195 | 30,153 |

---

## 截图筛选选项

| 项目 | 说明 |
|------|------|
| **端点** | `GET /web/v1/article/category/getCategoryFilter?type=linggan&subType=images` |
| **认证** | 无需登录 |

**返回参数**

- 排序：`see`（最受欢迎）、`createTime`（最新添加）
- 来源：`原创`、`转载`、`翻译`、`全部`

---

## 成员搜索列表

| 项目 | 说明 |
|------|------|
| **端点** | `POST /web/v1/member/search/list` |
| **Content-Type** | `application/x-www-form-urlencoded; charset=UTF-8` |
| **认证** | 无需登录 |

**请求参数**

| 参数 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `currentUserId` | int | 当前用户 ID（可选） | `112732` |
| `pageNum` | int | 页码 | `1` |
| `pageSize` | int | 每页条数 | `5` |
| `orderByColumn` | string | 排序字段 | `createTime` |
| `isAsc` | string | 排序方向 | `desc` `asc` |

---

## 类型分类 ID 映射表（screenshots 页面）

对应页面左侧「类型」筛选栏，通过 `screenshots?categoryIds={id}&t=2` 页面 URL 传递分类筛选。

**GraphQL 查询中 `category_id` 参数传入对应 ID，支持逗号分隔多选（累加筛选）。**

| 序号 | 游戏类型 | category_id | 页面 URL |
|:---:|---------|:-----------:|----------|
| 1 | 射击游戏 | `228` | `/screenshots?categoryIds=228&t=2` |
| 2 | 动作游戏 | `229` | `/screenshots?categoryIds=229&t=2` |
| 3 | 角色扮演 | `230` | `/screenshots?categoryIds=230&t=2` |
| 4 | 冒险游戏 | `231` | `/screenshots?categoryIds=231&t=2` |
| 5 | 竞速游戏 | `232` | `/screenshots?categoryIds=232&t=2` |
| 6 | 策略游戏 | `233` | `/screenshots?categoryIds=233&t=2` |
| 7 | 格斗游戏 | `234` | `/screenshots?categoryIds=234&t=2` |
| 8 | 即时战略 | `247` | `/screenshots?categoryIds=247&t=2` |
| 9 | 体育游戏 | `235` | `/screenshots?categoryIds=235&t=2` |
| 10 | 桌游棋牌 | `236` | `/screenshots?categoryIds=236&t=2` |
| 11 | 模拟经营 | `237` | `/screenshots?categoryIds=237&t=2` |
| 12 | 音乐游戏 | `238` | `/screenshots?categoryIds=238&t=2` |
| 13 | 恋爱养成 | `239` | `/screenshots?categoryIds=239&t=2` |
| 14 | 卡牌 | `240` | `/screenshots?categoryIds=240&t=2` |
| 15 | MOBA | `241` | `/screenshots?categoryIds=241&t=2` |
| 16 | 消除游戏 | `242` | `/screenshots?categoryIds=242&t=2` |
| 17 | 塔防 | `243` | `/screenshots?categoryIds=243&t=2` |
| 18 | MMORPG | `244` | `/screenshots?categoryIds=244&t=2` |
| 19 | SLOTS | `260` | `/screenshots?categoryIds=260&t=2` |

> **筛选说明**：多选时 categoryId 逗号累加，例如选中"射击游戏(228)+动作游戏(229)"时 URL 为 `/screenshots?categoryIds=228,229&t=2`，GraphQL 中 `category_id:"228,229"`。此行为与 `images_desc` 参数的多值模式一致。|

---

## 浏览/搜索历史

| 项目 | 说明 |
|------|------|
| **端点** | `POST /web/v1/search/history` |
| **Content-Type** | `application/x-www-form-urlencoded` |

**请求参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| `showAll` | bool | 是否显示全部 |
| `pageNum` | int | 页码 |
| `pageSize` | int | 每页条数 |
| `type` | int | `0`=搜索历史，`1`=浏览历史 |

---

## 系统配置

| 项目 | 说明 |
|------|------|
| **端点** | `GET /web/v1/configuration/get` |
| **认证** | 无需登录 |

---

## 广告弹窗

| 项目 | 说明 |
|------|------|
| **端点** | `POST /web/v1/ad/indexDialog` |
| **Content-Type** | `application/x-www-form-urlencoded` |

请求体为空。

---

## 推荐链接

| 项目 | 说明 |
|------|------|
| **端点** | `POST /web/v1/links/searchRecommend?pageNum=1&pageSize=4` |
| **Content-Type** | `application/x-www-form-urlencoded` |

请求体为空。

---

## 游戏详情页

| 项目 | 说明 |
|------|------|
| **端点** | `GET /game/{articleId}` |
| **返回** | HTML 页面（非 API） |

---

## 图片 CDN

| 项目 | 说明 |
|------|------|
| **域名** | `https://image.gameuiux.cn` |
| **路径格式** | `/{year}/{month}/{day}/{filename}` |
| **限制** | 需要 `Referer: https://www.gameui.net/` 头，否则返回 403 |
| **支持协议** | HTTPS |

---

## 请求头参考

| Header | 说明 |
|--------|------|
| `User-Agent` | 浏览器标识 |
| `v` | 客户端版本（浏览器自动携带，可选） |
| `token` | 认证 Token（浏览器登录后自动携带，可选） |
| `Content-Type` | POST 时为 `application/x-www-form-urlencoded; charset=UTF-8` |
| `Origin` | `https://www.gameui.net` |
| `Referer` | 来源页面 URL |
| `Accept` | `application/json, text/plain, */*` |

---

## 关键注意事项

1. **所有接口无需登录** — 不需要 Cookie/JSESSIONID，`token`/`v` 头均为浏览器自动携带（可选）
2. **CDN 防盗链** — 下载图片必须带 `Referer: https://www.gameui.net/` 头
3. **SSL 验证** — Python 环境需 `verify=False` + `urllib3.disable_warnings()`
4. **游戏列表用 REST** — `/web/v1/article/list`
5. **截图栏目用 GraphQL** — `/api?query={images(...)}`
6. **截图需两步获取** — GraphQL 列表 → `/web/v1/images/detail/v2` 获取 CDN URL
