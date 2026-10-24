# AI 美术平台（free-canvas）

参考 `text/ori/lib` 中对 holopix.cn「自由画布（无限画板）」的逆向结论，按其技术栈与工程结构搭建，并接入 **ai-flows 平台**：

- **Vue 3 + Vite + TypeScript**
- **Ant Design Vue**（暗色主题）
- **fabric.js**（对象模型、选择、变换、绘制，对应参考项目的 fabric 内核）
- **Vue Router**（画板列表 `/`、画布编辑器 `/board/:id`）
- **ai-flows 平台接口**（画板与素材按登录账号存服务端，复用平台会话 cookie）

入口：平台顶栏「AI 美术平台」（`/art`），与员工系统共用同一套登录账号；`/art` 与 `/api/art/**` 未登录会跳回 `/login`。独立开发时 `npm run dev` 会把 `/api` 代理到本地平台 `127.0.0.1:4311`。

构建产物输出到平台目录 `../web/art/`，由 `src/platform.ts` 托管；改了本工程源码后需重新 `npm run build`（在仓库根也可执行 `npm run art:build`）。

## 功能

| 模块 | 能力 |
| --- | --- |
| 无限画布 | 滚轮缩放（10%–800%）、空格/抓手/中键平移、点阵网格随视口移动 |
| 绘制 | 矩形、椭圆、直线、箭头、文字、自由画笔、对象橡皮 |
| 图片来源 | 工具栏上传、拖拽入画布、Ctrl+V 粘贴（都会先存进「我的素材」） |
| 我的素材 | 画布里导入 / 生成 / 复用的图片统一入库，可预览、上传、点选放回画布、删除 |
| 编辑 | 框选/多选、移动缩放旋转、复制、删除、图层置顶置底 |
| 图层 | 列表、选择、显隐、锁定、删除，名称自动编号（矩形 1、箭头 1 …） |
| 图层文件夹 | 新建/嵌套文件夹（最多 5 层）、拖拽归类、双击重命名、显隐与锁定继承、解散后内容回到父级 |
| 属性 | 填充/描边颜色、描边宽度、不透明度、字号 |
| 历史 | 60 步撤销/重做（`Ctrl+Z` / `Ctrl+Shift+Z`） |
| 持久化 | 内容变更后 900ms 防抖自动保存到平台 SQLite，换设备 / 换浏览器登录同一账号即可恢复 |
| 画板管理 | 新建、搜索、复制、删除、缩略图预览、占用统计（按账号隔离） |
| 导出 | 按内容包围盒导出 PNG（自动留白、限制超大尺寸） |
| 智能生成 | 离线程序化出图（模型/风格/数量），结果直接插入画布 |

也可以手动执行（开发时请先启动平台 `platform --port 4311`，接口走代理）：

```bash
npm install
npm run dev        # 开发模式 http://localhost:5188
npm run build      # 生产构建（输出 ../web/art）
npm run typecheck  # 类型检查
```

## 目录结构

```text
art/（AI 美术平台前端工程）
├─ index.html
├─ vite.config.ts             # base=/art/，构建输出 ../web/art，dev 代理 /api → 4311
├─ src/
│  ├─ main.ts / App.vue       # 入口、Ant Design 暗色主题
│  ├─ router/index.ts         # / 与 /board/:id
│  ├─ views/
│  │  ├─ BoardListView.vue    # 我的画板
│  │  └─ BoardEditorView.vue  # 画布编辑器（编排引擎与面板）
│  ├─ components/canvas/
│  │  ├─ CanvasStage.vue      # fabric 画布 + 网格 + 拖拽/粘贴
│  │  ├─ ToolRail.vue         # 左侧工具栏
│  │  ├─ EditorHeader.vue     # 顶栏（重命名/保存/撤销/导出）
│  │  ├─ LayerPanel.vue       # 图层 / 文件夹
│  │  ├─ PropertyPanel.vue    # 属性
│  │  ├─ MyAssetsPanel.vue    # 我的素材（上传 / 预览 / 点选插入 / 删除）
│  │  └─ AiPanel.vue          # 智能生成
│  ├─ core/
│  │  ├─ canvas/CanvasEngine.ts  # 视口/绘制/图层/历史/序列化/导出
│  │  ├─ layers/tree.ts          # 文件夹树的纯函数（层级、拖拽、继承、规范化）
│  │  └─ ai/mockGenerator.ts     # 离线程序化出图
│  ├─ composables/
│  │  ├─ useBoardHotkeys.ts
│  │  └─ useLayerTree.ts         # 文件夹树状态与画布对象对账
│  ├─ api/
│  │  ├─ client.ts            # 同源请求封装（复用平台登录 cookie，401 跳 /login）
│  │  ├─ board.ts             # 画板接口 → /api/art/boards*
│  │  ├─ asset.ts             # 我的素材 → /api/art/assets*
│  │  └─ ai.ts                # 生成任务（离线模拟）
│  ├─ types/board.ts
│  └─ styles/index.css
└─ README.md
```

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `V` / `H` | 选择 / 抓手 |
| `R` / `O` / `L` / `A` | 矩形 / 椭圆 / 直线 / 箭头 |
| `T` / `P` / `E` | 文字 / 画笔 / 橡皮 |
| `空格` + 拖拽 | 临时平移 |
| `Ctrl+Z` / `Ctrl+Shift+Z` | 撤销 / 重做 |
| `Ctrl+D` | 复制选中对象 |
| `Ctrl+S` | 立即保存 |
| `Ctrl+0` / `Ctrl+1` | 100% / 适应内容 |
| `Delete` / `Backspace` | 删除选中 |
| `Esc` | 回到选择工具并取消选择 |
| 双击空白处 | 添加文字 |
| 滚轮 | 以指针为中心缩放 |

## 图层文件夹

- 面板顶部「新建文件夹」创建顶层文件夹；文件夹的「更多」菜单可新建子文件夹，**最多 5 层**，第 6 层入口自动禁用。
- 拖拽图层或文件夹到文件夹行即可归类；拖到面板标题栏可移出到顶层。禁止把文件夹拖进自身或子孙文件夹。
- 双击名称（或菜单「重命名」）可修改文件夹与图层名称，`Enter` 保存、`Esc` 取消。
- 文件夹的显隐/锁定会继承给全部子项，子项仍保留自己的开关状态。
- 「解散文件夹」只移除文件夹层级，内容回到父级，不删除画布对象。
- 文件夹只影响面板组织与显隐/锁定继承，不改变画布对象的叠放顺序。
- 文件夹树与画板一起持久化，刷新或重开浏览器后保持。

## 数据与接口

- 画板数据存平台库 `db/ai-art.sqlite`（schema `art`）：`art_boards` 存画板名、fabric 画布 JSON、图层文件夹树、缩略图与对象数，`art_assets` 存「我的素材」元数据；图片二进制落 `db/art-assets/`，不入库。
- 所有读写都按登录账号隔离（服务端取会话里的 email，前端不能指定归属人）。
- 接口：`/api/art/boards`（`GET` 列表 / `POST` 新建）、`/api/art/boards/<id>`（`GET` / `PUT` / `DELETE`）、`/api/art/boards/<id>/duplicate`、`/api/art/assets`（`GET` / `POST` 上传 data URL）、`/api/art/assets/<id>`（`GET` 取图 / `DELETE`）。
- 画布里的图片只保存素材地址（`/api/art/assets/<id>`），不存 base64，避免画板 JSON 被撑大。
- 智能生成同理：替换 `src/api/ai.ts` 中的 `generateArtwork`，保持 `{ taskId, images }` 返回结构即可，画布侧无需改动。

## 实现要点

- **视口**：直接操作 fabric 的 `viewportTransform`，缩放通过 `zoomToPoint` 保证指针下的世界坐标不动；网格用 CSS 径向渐变跟随 `offset` 与 `zoom` 渲染，不额外增加画布对象。
- **图层与序列化**：给 `FabricObject` 注入 `id / name / locked` 三个自定义属性（`FabricObject.customProperties`），随 `canvas.toJSON()` 一起保存，恢复时重新应用锁定态。
- **历史记录**：以序列化快照为栈，最多 60 条；绘制过程中的临时对象用 `quiet` 标记跳过入栈。
- **箭头**：直线 + 三角形组成 Group，拖动时实时重建，保证箭头方向与长度正确。
- **缩略图 / 导出**：缩略图取当前视口 0.24 倍；导出 PNG 时临时按内容包围盒重设画布尺寸，完成后恢复视口，避免导出空白区域。

## 已知边界

- 「智能生成」为离线程序化预览，不代表真实模型效果；
- 未实现多人协作、PSD/AI 分层导入（参考项目对应能力需要后端与专用解析器）；
- 撤销删除后恢复的图层会回到顶层，不会自动回到原文件夹；
- 浏览器需支持 Canvas 2D（Chrome / Edge / Firefox 现代版本均可）。
