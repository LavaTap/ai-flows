# 小红书接口规范说明

本文档整理自项目接口抓包文本，按统一模板沉淀为脚本开发参考。

## 公共安全校验规则

以下请求头为小红书接口高频校验项，实际请求需按抓包结果完整携带：

1. `x-t: <毫秒时间戳>` - 防重放校验
2. `x-s-common: <公共加密参数>` - 客户端环境签名参数
3. `x-s: <请求签名>` - 报文签名校验
4. `x-xray-traceid: <trace id>` / `x-b3-traceid: <trace id>` - 链路追踪
5. `Referer: https://www.xiaohongshu.com/` - 同站来源校验
6. `Cookie: <登录态Cookie>` - 已登录身份校验（涉及登录后接口）
7. `Content-Type` 按接口场景设置：`application/json;charset=UTF-8` 或 `text/plain`

> 说明：抓包文本里未给出固定 `Authorization`/`md5`/`X-KM-Client` 规则，小红书接口以动态签名头与 Cookie 为主。

---

## 登录链路相关接口

### 生成登录二维码

- **请求方式**: POST
- **接口地址**: （抓包文本未给出完整 URL，标记为“生成二维码”）
- **核心入参**: `{"qr_type":1}`
- **说明**: 生成网页端登录二维码，并返回 `qrId` 供后续扫码校验使用。

### 登录埋点上报

- **请求方式**: POST
- **接口地址**: （抓包文本未给出完整 URL，标记为“埋点上报”）
- **核心入参**: Base64 编码后的二进制序列化内容（非标准 JSON）
- **说明**: 上报设备与环境信息，执行前置风控校验。

### 扫码结果校验（登录成功校验）

- **请求方式**: POST
- **接口地址**: （抓包文本未给出完整 URL，标记为“扫码结果校验/扫码用户信息校验接口”）
- **核心入参**: `{"qrId":"720011784882829323","code":"337311"}`
- **说明**: 提交二维码会话与动态验证码，校验通过后刷新登录态 Cookie（如 `websectiga`、`gid`、`web_session` 等）。

---

## 搜索全链路接口

从输入关键词触发搜索到获取最终笔记结果的全流程接口逻辑，包含所有核心业务接口。

### 一、搜索前置通用埋点接口（隐式风控链路）

用户进入搜索页、输入搜索词的全流程中自动触发，上报用户行为、设备指纹数据，完成前置风控校验，是后续核心搜索接口正常放行的前提。

#### 通用行为埋点上报接口

- **请求方式**: POST
- **接口地址**: `https://t2.xiaohongshu.com/api/v2/collect`
- **核心配置**: 请求体为经过序列化编码的二进制数据，`Content-Type` 固定为 `text/plain`，无需手动构造业务参数，由客户端自动生成设备环境、搜索前的访问轨迹等风控信息上传。

### 二、搜索历史同步接口

用于和服务端双向同步用户的本地搜索历史记录，覆盖空操作初始化和新增搜索词上报两个环节。

#### 1. 空操作搜索历史同步接口

- **请求方式**: POST
- **接口地址**: `https://so.xiaohongshu.com/api/sns/web/search/history/sync`
- **核心入参**:
```json
{"client_time": 1784889274357, "ops": []}
```
- **作用**: 用户打开搜索页时触发，从服务端拉取该账号的云端历史搜索记录，同步展示在本地搜索下拉列表中。

#### 2. 新增搜索词上报接口

- **请求方式**: POST
- **接口地址**: `https://so.xiaohongshu.com/api/sns/web/search/history/sync`
- **核心入参**:
```json
{"client_time": 1784889274903, "ops": [{"act": "search", "q": "bongo cat", "ct": 1784889274903}]}
```
- **作用**: 用户完成搜索操作后触发，将本次搜索的关键词、操作时间上传到云端，更新该账号的历史搜索记录库。

### 三、搜索推荐补全接口

用户在搜索框输入关键词的过程中触发，返回对应关键词关联的实时热搜推荐、补全候选词。

- **请求方式**: GET
- **接口地址**: `https://edith.xiaohongshu.com/api/sns/web/v1/search/trending/query`
- **核心 URL 参数**:

| 参数名 | 参数说明 |
|---|---|
| `source` | 固定为 `search`，标识来源为搜索场景 |
| `search_type` | 固定为 `trend`，指定返回热搜推荐类型 |
| `hint_word` | 用户当前输入的搜索关键词 |
| `hint_word_type` | 搜索推荐的召回策略标识 |

- **作用**: 在用户输入搜索词时，实时返回关联的热门补全词，提升用户搜索效率。

### 四、搜索筛选功能预检接口

浏览器自动发起的 CORS 跨域预检请求，为后续搜索结果的筛选功能接口提前完成跨域权限放行。

- **请求方式**: OPTIONS
- **接口地址**: 搜索筛选预检接口
- **核心配置**: 声明后续筛选请求为 GET 方式，提前告知服务端放行小红书 5 个专属加密校验头：`x-b3-traceid`、`x-s`、`x-s-common`、`x-t`、`x-xray-traceid`。
- **URL 携带参数**: `keyword=bongo cat&search_id=2go643kxrixsvdntky38v`，和本次搜索唯一标识绑定。

### 五、核心搜索结果前置接口（Onebox）

返回搜索场景的 onebox 智能结构化结果，在普通笔记结果之上优先展示精准匹配的特殊内容（如官方专题、聚合卡片等）。

#### 1. 活动类搜索 onebox 接口

- **请求方式**: POST
- **接口地址**: `https://so.xiaohongshu.com/api/sns/web/v1/worldcup/search/onebox`
- **核心入参**:
```json
{"keyword": "bongo cat", "app_search_id": "2go643kxrixsvdntky38v"}
```
- **作用**: 返回和搜索词关联的平台活动、专题聚合类特殊搜索结果。

#### 2. 通用搜索 onebox 接口

- **请求方式**: POST
- **接口地址**: `https://edith.xiaohongshu.com/api/sns/web/v1/search/onebox`
- **核心入参**:
```json
{"keyword": "bongo cat", "search_id": "2go643kxrixsvdntky38v", "biz_type": "web_search_user", "request_id": "1991285347-1784889274904"}
```
- **作用**: 返回搜索结果的头部智能结构化卡片（用户账号聚合、商品聚合、知识类特殊结果等），优先在搜索页顶部展示。

### 六、核心笔记搜索结果接口（最终笔记列表）

完成前置所有搜索链路之后，通过核心笔记搜索接口直接获取关键词匹配的笔记列表数据。

- **请求方式**: POST
- **接口地址**: `https://edith.xiaohongshu.com/api/sns/web/v1/search/notes`
- **核心入参**:
```json
{
  "keyword": "bongo cat",
  "page": 1,
  "page_size": 20,
  "search_id": "2go643kxrixsvdntky38v",
  "sort": "general",
  "note_type": 0,
  "ext_flags": [],
  "image_formats": ["jpg", "webp", "avif"]
}
```
- **返回核心字段**:

| 字段路径 | 说明 |
|---|---|
| `data.items[].id` | 笔记 note_id（24位十六进制） |
| `data.items[].note_card.display_title` | 笔记标题 |
| `data.items[].note_card.type` | 笔记类型（`normal`/`video`） |
| `data.items[].note_card.user.nickname` | 发布者昵称 |
| `data.items[].xsec_token` | 笔记级动态校验令牌（拼接详情链接用） |
| `data.has_more` | 是否有下一页 |

- **笔记详情链接格式**: `https://www.xiaohongshu.com/discovery/item/{note_id}`
- **带令牌链接格式**: `https://www.xiaohongshu.com/discovery/item/{note_id}?xsec_token={xsec_token}&xsec_source=pc_search`

> 后续调用笔记详情 feed 接口（`/api/sns/web/v1/feed`）传入对应 note_id + xsec_token，即可拿到笔记全量的正文、图片、发布者信息等完整内容。评论获取使用 `/api/sns/web/v2/comment/page` 接口（见下方「笔记与评论相关接口」章节）。

---

## 笔记与评论相关接口

### 笔记 SEO 元数据预加载

- **请求方式**: POST
- **接口地址**: `note/seo`（抓包文本为相对路径）
- **核心入参**: `{"note_ids":["6a3c88cd000000001c0250cb"]}`
- **说明**: 预加载笔记标题、摘要、首图等 SEO 元信息。

### 笔记详情拉取（Feed）

- **请求方式**: POST
- **接口地址**: `https://edith.xiaohongshu.com/api/sns/web/v1/feed`
- **核心入参（JSON Body）**:

```json
{
  "source_note_id": "6a1b013700000000350334a7",
  "image_formats": ["jpg", "webp", "avif"],
  "extra": {"need_body_topic": "1"},
  "xsec_source": "pc_share",
  "xsec_token": "ABxYkjUQdpOv4bm_YfDb23LCi08smdITrlW1mvsJR_Pco="
}
```

- **抓包样例笔记**: `https://www.xiaohongshu.com/discovery/item/6a1b013700000000350334a7?source=webshare&xhsshare=pc_web&xsec_token=ABxYkjUQdpOv4bm_YfDb23LCi08smdITrlW1mvsJR_Pco=&xsec_source=pc_share`
- **说明**: 拉取标题、正文、作者、图片、视频、点赞数、收藏数、评论数等笔记主内容。该接口必须处于已登录网页端上下文中，并携带当前页面实时生成的 `x-s`、`x-t`、`x-s-common`、`x-b3-traceid`、`x-xray-traceid` 与 Cookie。

#### Feed 返回结构与字段映射

| 目标字段 | 推荐读取路径 | 备用路径 |
|---|---|---|
| 笔记标题 | `data.items[0].note_card.title` | `data.items[0].note_card.display_title` |
| 正文内容 | `data.items[0].note_card.desc` | 页面内初始状态 JSON 的 `note.desc` / `note_card.desc` |
| 作者昵称 | `data.items[0].note_card.user.nickname` | 搜索结果卡片 `note_card.user.nickname` |
| 点赞数 | `data.items[0].note_card.interact_info.liked_count` | `data.items[0].note_card.liked_count` |
| 评论数 | `data.items[0].note_card.interact_info.comment_count` | `data.items[0].note_card.comment_count` |
| 收藏数 | `data.items[0].note_card.interact_info.collected_count` | `data.items[0].note_card.collected_count` |

#### 无法读取笔记详尽信息的常见原因与修复规则

1. **接口路径匹配过窄**：脚本只匹配 `/api/sns/web/v1/feed` 时，若页面改为其他详情接口或缓存首屏数据，`note_info` 会保持空对象。修复方式是同时监听所有 `edith.xiaohongshu.com` JSON 响应，并按 `note_id` 在响应体中递归查找 `note_card`。
2. **只等待 network response，不读取页面初始状态**：部分分享页详情直接注入到页面脚本状态中，未必再次触发 Feed 请求。修复方式是在拦截接口失败时，从页面 `<script>` 文本、`window.__INITIAL_STATE__`、`window.__NUXT__` 等状态对象中递归提取目标笔记。
3. **`xsec_source` 与入口不一致**：分享链接应优先使用 `pc_share`，搜索结果入口使用 `pc_search`，详情流入口使用 `pc_feed`。入口不匹配时 Feed 可能返回空、失败或只返回评论。
4. **旧脚本只在评论采集阶段顺带捕获详情**：如果评论接口先触发、Feed 未触发或被缓存，最终 `meta.json.note_info` 为空，`note_content.txt` 只能写入 note_id。修复方式是将“详情获取”作为独立前置步骤，先拿到 `note_card` 后再采集评论。

#### 目标笔记 6a1b013700000000350334a7 测试调用建议

1. 使用已登录浏览器上下文打开原始分享链接。
2. 注册响应监听，捕获 Feed 或任意包含目标 `note_id` 的 JSON 响应。
3. 若 15-30 秒内未捕获到详情 JSON，则从页面 DOM 与脚本状态递归提取。
4. 输出 `标题`、`作者`、`正文`、`点赞数`、`评论数` 到项目根目录 `note_content.txt`。

### 笔记附属组件数据

- **请求方式**: POST
- **接口地址**: （抓包文本未给出完整 URL，标记为“笔记组件接口”）
- **核心入参**: `note_id=6a3c88cd000000001c0250cb&scene=web&mode=1&source=web_feed`
- **说明**: 拉取相关推荐、搜索建议、扩展组件数据。

### 小红书笔记评论获取 & 分页翻页接口全流程解析（note_id=644f32ac0000000013035b18）

> 适用范围：已登录小红书网页端会话。所有评论请求需携带合规浏览器 UA、平台标准请求头与有效登录态 Cookie。

#### 一、评论拉取核心机制

评论分页采用固定的两步链路，每一页都重复执行：

1. **OPTIONS 预检请求（CORS 放行）**
   - 声明后续真实请求方法（GET）与自定义头。
   - 服务端通过后，浏览器才会放行真实业务请求。
2. **GET 业务请求（评论数据拉取）**
   - 拉取当前游标对应分页的评论列表。
   - 读取响应内新 `cursor` 与 `has_more`，驱动下一页拉取。

#### 二、首次评论加载

##### 1) 预检请求（OPTIONS）

- **请求方式**: `OPTIONS`
- **完整地址**:

```text
https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=644f32ac0000000013035b18&cursor=&top_comment_id=&image_formats=jpg,webp,avif&xsec_token=ABbpHsLUVDfzFGQhVGvLVuGoeO0M92Tn888AMYRM4UaAE%3D
```

- **关键请求头**:
  - `accept: */*`
  - `access-control-request-method: GET`
  - `access-control-request-headers: x-b3-traceid,x-s,x-s-common,x-t,x-xray-traceid`
  - `origin: https://www.xiaohongshu.com`
  - `referer: https://www.xiaohongshu.com/`
- **说明**: 首次拉取时 `cursor` 可留空，由服务端返回第一页评论与下一游标。

##### 2) 业务请求（GET）

- **请求方式**: `GET`
- **完整地址（抓包样例）**:

```text
https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=644f32ac0000000013035b18&cursor=644f52fd000000001403b0c3&top_comment_id=&image_formats=jpg,webp,avif&xsec_token=ABbpHsLUVDfzFGQhVGvLVuGoeO0M92Tn888AMYRM4UaAE%3D
```

- **关键请求头**:
  - 常规浏览器头：UA、平台标识等
  - 小红书签名头：`x-xray-traceid`、`x-t`、`x-b3-traceid`、`x-s-common`、`x-s`
  - 完整登录态 Cookie：如 `webId`、`websectiga` 等

- **参数说明**:

| 参数名 | 作用说明 |
|---|---|
| `note_id` | 目标笔记唯一 ID，固定为 `644f32ac0000000013035b18` |
| `cursor` | 服务端返回的分页游标，用于定位下一页起点 |
| `top_comment_id` | 留空时按笔记默认置顶评论策略返回 |
| `image_formats` | 声明支持 `jpg,webp,avif` 图片格式 |
| `xsec_token` | 笔记级动态校验令牌，与笔记 ID 强绑定 |

- **返回核心字段**:
  - `comments`: 当前页评论列表（含内容、发布者、点赞数、子评论）
  - `cursor`: 下一页游标
  - `has_more`: 是否仍有下一页

#### 三、分页翻页规则（第二页及后续）

##### 1) 翻页预检（OPTIONS）

- **请求方式**: `OPTIONS`
- **完整地址（第二页样例）**:

```text
https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=644f32ac0000000013035b18&cursor=644f420f000000001402f0a4&top_comment_id=&image_formats=jpg,webp,avif&xsec_token=ABbpHsLUVDfzFGQhVGvLVuGoeO0M92Tn888AMYRM4UaAE%3D
```

- **规则**: 仅替换 `cursor` 为上一页返回的新值，其余预检头保持一致。

##### 2) 翻页业务请求（GET）

- **调用规则**:
  1. 预检通过后立即发起同结构 GET 请求。
  2. 每次请求都使用上一次响应返回的最新 `cursor`。
  3. 当 `has_more=false` 时停止翻页，表示评论已全部加载完成。

#### 四、配套埋点与静态资源请求

评论加载过程中会并行触发以下非核心业务请求：

1. **埋点上报接口（POST）**
   - 地址：`https://t2.xiaohongshu.com/api/v2/collect`
   - 请求体：序列化加密设备与行为数据
   - `content-type`: `text/plain`
   - 特征：抓包记录中出现约 4 次
2. **静态资源请求**
   - 用于评论页图标/UI 渲染
   - 不参与评论业务分页逻辑

#### 五、实现要点（脚本开发侧）

1. 分页循环严格执行 `OPTIONS -> GET` 的双请求顺序。
2. 每页请求实时更新签名相关头与时间戳字段，避免时效失效。
3. 将 `has_more` 作为终止条件，`cursor` 作为唯一翻页状态。
4. 埋点请求可作为行为链路观测信息，不应与评论主流程混淆。

---

## 其他已识别接口（地址待补齐）

### 当前登录用户信息

- **请求方式**: GET
- **接口地址**: （抓包文本标记为“用户信息接口”）
- **核心入参**: `user_id=661a20a50000000003032d3c`
- **说明**: 获取当前登录用户昵称、头像、等级等资料。

### IM 消息入口信息

- **请求方式**: GET
- **接口地址**: （抓包文本标记为“消息入口接口”）
- **核心入参**: 无（按抓包请求）
- **说明**: 获取私信入口配置与未读消息信息。

---

## 使用建议

1. 抓包文本中多处仅保留“接口名称”未提供完整 URL，脚本落地前需二次抓包补齐。
2. 小红书接口对签名与时效敏感，`x-t`/`x-s`/`x-s-common` 需按请求实时生成。
3. 评论翻页需控制请求频率，避免触发风控限流。


---

## 实际爬取实践总结

### 推荐方案：浏览器自动化（DrissionPage）

经过实测，直接调用 API 方式（即使使用 xhshow 生成签名）仍会触发小红书风控校验，**推荐使用 DrissionPage 浏览器自动化方式**：

1. **优势**：自动处理所有动态签名（x-s/x-s-common/x-t）、Cookie 管理、浏览器指纹
2. **流程**：访问笔记页面 → 等待3秒加载 → 滚动到评论区 → 循环滚动加载所有评论
3. **终止条件**：连续5次滚动无新评论时停止（保证不超过实际评论总量）
4. **元素选择器**：（主评论）、（子回复）

### Cookie 更新

使用 DrissionPage 打开小红书登录后，提取所有 Cookie 并保存，即可用于后续爬取。
