# HTTP 接口清单

两个服务：**平台服务**（`platform` 子命令，默认 4311，含页面与业务 API）、**报告服务**（`serve` 子命令，默认 4310，只读评审报告）。
约定：全部 `Content-Type: application/json` 返回；未登录业务接口一律 `401 {error:"未登录"}`；页面路由未登录 `302 → /login`。
权限只走 `platform.ts` 的 `canExecute` / `canApprove` / `canEditRequirement` / `canAccessTicket` / `filterReviewsByUser` / `filterTicketsByUser`。

---

## 一、认证与会话

- `POST /api/login` — 邮箱 + 密码登录，校验 `users` 表后签发会话 cookie，成功返回 `{user}`，失败 `401 邮箱或密码错误`。
- `POST /api/logout` — 注销当前会话并清 cookie，返回 `{ok:true}`。
- `GET /api/me` — 取当前登录用户；未登录 `401`，前端据此跳登录页。
- `GET /health` — 存活探针，纯文本 `ok`。

## 二、账号与团队

- `GET /api/account` — 取我的资料 + GitHub 绑定状态；主管额外返回全部成员 `members`（供成员管理 / 绑定审核用）。
- `POST /api/account/avatar` — 上传我的头像，body 为 base64 data URL（限 png/jpg/jpeg/gif/webp、≤2MB）。
  落盘 `db/avatars/`，`users.avatar` 只存文件名；请求体上限 4MB（`AVATAR_BODY_MAX`），返回 `{user}`。
- `POST /api/account/<email>/profile` — 主管改任意账号的姓名 / 部门 / 职位 / 头像；非主管 `403`。
  路径 email 走 `decodePathSegment()` 还原（前端编码成 `%40`），解码含 `/` `\` 按不存在处理。
- `GET /api/avatars/<file>` — 读头像二进制，文件名严格校验 `[a-f0-9]{12}\.(png|jpg|jpeg|gif|webp)`，缺则 404。

## 三、GitHub 绑定与审核

- `POST /api/account/github/bind` — 自助绑定 GitHub 用户名；主管即刻写入 `github`，员工写 `githubPending` 待审。
- `POST /api/account/github/cancel` — 员工撤销自己待审核的绑定。
- `POST /api/account/github/unbind` — 解绑自己已生效的 GitHub。
- `POST /api/account/<email>/github/approve|reject` — 主管批准 / 驳回某员工待审核绑定，仅 `canApprove` 可调。
  批准把 `githubPending` 转正为 `github`；驳回清掉待审；账号不存在或无待审返回 404。

## 四、AI 管线

- `GET /api/nodes` — 节点列表 + 当前用户权限 + 部门成员 + 忙节点 `busy`；登录即可查看全流程。
  每个节点返回 `canExecute` / `canApprove` / `canEdit` / `ticketId`（该节点需求工单编号，可跳 `/tickets?id=`）。
- `POST /api/pipeline/rename` — 重命名管线，body `{name}`，空名 400。
- `POST /api/nodes/<id>/execute` — 执行节点（仅本部门员工 / 主管），先确保挂上需求工单再跑；异步，落 `running` 立即响应。
  skill 节点后台跑 skill、调研节点后台跑外部 agent、`ai-review` 节点后台跑评审链；`busy` 内或状态不符返回 400/409。
- `POST /api/nodes/<id>/submit` — 提交验收，`running → in_review`。
- `POST /api/nodes/<id>/approve` — 主管审核通过，任意非 `done` 状态可用，`→ done`；员工未提交文件（`uploads` 为空）返回 409。
- `POST /api/nodes/<id>/reject` — 主管驳回，body `{reason}`，退回 `running` 并附驳回意见。
- `POST /api/nodes/<id>/executors` — 主管把员工加入该节点执行人：改其部门到节点部门，并自动在该账号下建指派工单（幂等）。
  body `{email}`；这是「员工被归入执行人 → 自动生成工单」的唯一入口。
- `GET /api/reviews` — 节点 03 评审记录：平台历史 + 外部报告聚合，按视角过滤（主管全量 / 员工本部门）。
  外部触发（hook / 手动 run）无归属，统一归「程序中台」。

## 五、节点需求 / 附件 / 产物 / 目录

- `PUT /api/nodes/<id>/requirement` — 保存节点需求文本，body `{text}`，权限同执行（本部门员工 / 主管），超长 400。
- `POST /api/nodes/<id>/upload` — 上传节点附件（body base64，避免 multipart），落 `.ai-flows-uploads/<节点id>/` 并记入 `uploads`。
- `GET /api/artifacts/<nodeId>/<name>` — 下载节点产物（skill 产出的 Markdown / 调研 agent 的 zip）。
- `GET /api/fs?path=` — 浏览目标仓库内子目录（供输出目录选择弹窗），越权路径 403。
- `POST /api/fs/mkdir` — 在目标仓库内新建子目录，body `{path, name}`。

## 六、工单系统

- `GET /api/tickets` — 工单列表，按视角过滤（主管全量 / 员工本部门）并按更新时间倒序。
- `POST /api/tickets` — 新建工单，body `{title, content}`；正文来自 contenteditable，必须过 `sanitizeRichHtml()` 净化后落库。
  归属提交人部门，可见范围 = 本部门 + 主管；标题 / 正文为空或过长返回 400，成功 201。
- `GET /api/tickets/<id>` — 工单详情（含评论），仅 `canAccessTicket` 可看，越权 403。
- `POST /api/tickets/<id>/status` — 切换工单状态，**仅主管可调**（员工 403），body `{status}` 只认 `open|doing|resolved`。
- `POST /api/tickets/<id>/comments` — 新增评论（本部门员工 / 主管），正文同样净化后落库，成功 201。
- `POST /api/tickets/upload` — 上传工单正文图片，body base64，限 png/jpg/gif/webp，服务端生成 `[a-f0-9]{12}.<ext>` 落 `db/ticket-uploads/`。
- `GET /api/tickets/images/<file>` — 读工单图片，文件名按 `[a-f0-9]{12}.<ext>` 严格校验（天然免疫穿越）。

## 七、AI 对话

- `GET /api/chat/sessions` — 我的会话列表（按 `ownerEmail` 隔离），按更新时间倒序，只返列表项。
- `POST /api/chat/sessions` — 新建空会话，标题「新对话」，成功 201。
- `GET /api/chat/sessions/<id>` — 会话详情（含 messages 全量），仅 owner 可访问，他人 403。
- `DELETE /api/chat/sessions/<id>` — 删除会话，仅 owner。
- `POST /api/chat/sessions/<id>/messages` — 发送消息，SSE 流式返回模型输出；写完 user 消息后调模型，再把 assistant 消息落库。
  历史原文超过 `chat.compressChars`（默认 400）时，用 `callModelOnce` + 摘要压缩为 `session.summary`，之后 prompt 只送【摘要 + 未压缩近期原文】。
- `GET /api/chat/models` — 模型列表（不暴露 `apiKeyEnv`）+ 当前激活模型 id。
- `POST /api/chat/models` — 新增模型配置（仅主管），必填 `name / provider / model / apiKeyEnv`。
- `PUT /api/chat/models/<id>` — 修改模型配置（仅主管）。
- `DELETE /api/chat/models/<id>` — 删除模型配置（仅主管）。
- `POST /api/chat/models/<id>/activate` — 切换激活模型（任何登录用户可调）。

## 八、首页搜索

- `GET /api/search?type=<user|ticket|kb>&q=` — 首页全局搜索，最多各返 50 条。
  `user` 按姓名 / 邮箱 / 职位 / 部门匹配全员；`ticket` 按标题 / 提交人 / 正文纯文本匹配且按视角过滤；`kb` 知识库先留空返回 `[]`。

## 九、页面路由（HTML，未登录 302 → /login）

- `GET /` — 按登录态分流：已登录 → `/home`，未登录 → `/login`。
- `GET /login` — 登录页（无需登录）。
- `GET /home` — 首页：顶栏 + 中心搜索框 + 类型筛选（知识库 / 工单 / 员工）。
- `GET /pipeline` — AI 管线页，注入 `window.__PIPELINE__`。
- `GET /tickets` — 工单系统页，注入 `window.__TICKETS__`；支持 `?id=<工单id>` 深链直接打开详情。
- `GET /account` — 账号管理页（左侧栏仅「账号管理」）。
- `GET /team` — 团队管理页，**仅主管**可访问，员工 403；左侧栏含「团队管理」/「GitHub 绑定」。
- `GET /github-audit` — GitHub 绑定页：员工自助绑定 + 主管审核，注入 `window.__GHAUDIT__`。
- `GET /chat` — AI 对话页，注入 `window.__CHAT__`。

## 十、静态资源

- `GET /<file>` — 只走 `STATIC_FILES` 白名单精确匹配（`web/` 下的 `.css` / `.js` / `.html`），禁止拼路径直读。

---

## 十一、报告服务（`serve`，默认 4310）

- `GET /` — 评审报告列表页。
- `GET /health` — 存活探针，回带本实例的报告目录：`{"ok":true,"dir":"<abs>"}`。`ensureReportServer` 据此校验「该端口上的实例确实是本仓库的」，避免陈旧 `.server` 指向同端口别的 ai-review 实例而被误信（旧版仅回纯文本 `ok`，无法辨识归属）导致报告页 404。
- `GET /reports/<id>` — 报告详情页；id 用 `[^/\\]+` 限定防穿越，渲染前实时注入 HEAD 提交信息 `view.head`。
- `POST /reports/<id>/push` — 确认提交：**必须带非空 `message`**（否则 400），评审未通过 400、报告不存在 404。
  有暂存变更先 `commitStaged` 再 `pushToTargets`；无暂存且 `message` 与 HEAD 不同则 `amendCommitMessage` 改写最近一次提交。