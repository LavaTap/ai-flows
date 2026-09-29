import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** 平台数据目录 db/（src 与 dist 均位于仓库根下一级，向上取根） */
export const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db");

/** 工单图片上传目录 db/ticket-uploads/（已 gitignore，二进制不入库） */
export const TICKET_IMAGES_DIR = join(DB_DIR, "ticket-uploads");

/** 头像上传目录 db/avatars/（已 gitignore，二进制不入库） */
export const AVATARS_DIR = join(DB_DIR, "avatars");

/** 身份：员工 / 部门主管（主管权限最高，可操控并批准所有节点） */
export type Role = "staff" | "supervisor";

/** 平台账号（种子数据见 db/users.json，不开放注册） */
export interface UserAccount {
  /** 登录邮箱：名字拼音 + @ai-flows.com（虚拟后缀） */
  email: string;
  /** 演示环境统一 123456，明文存 JSON（上线前改加盐哈希） */
  password: string;
  /** 身份：员工 / 部门主管 */
  role: Role;
  /** 岗位名，如 用户调研实习生 */
  title: string;
  /** 归属部门：用户研究部门 / 程序中台 / 运营部门（主管不限部门、权限最高） */
  department: string;
  /** 中文姓名（角色卡片展示；旧数据缺省时回退邮箱前缀） */
  name?: string;
  /** 已生效绑定的 GitHub 用户名（账号管理自助绑定；未绑定为空串/缺省） */
  github?: string;
  /** 待主管审核的 GitHub 用户名（员工自助绑定后落此，主管批准后转 github） */
  githubPending?: string;
  /** 自定义头像文件名（落 db/avatars/<file>，缺省用首字头像） */
  avatar?: string;
}

/** 节点运行时状态：待执行 / 执行中 / 待验收 / 已执行 */
export type NodeStatus = "todo" | "running" | "in_review" | "done";

/** 节点产物：一次 skill 执行产出一个文件 */
export interface NodeArtifact {
  /** 产物文件名（不含路径，下载用） */
  name: string;
  /** 相对目标仓库根的路径 */
  path: string;
  /** 产出它的 skill 名（research-crawler / product-analysis / product-manager） */
  skill: string;
  /** ISO 时间戳 */
  at: string;
}

/** 管线节点（db/pipeline.json，执行/批准会写回） */
export interface NodeState {
  /** 节点编号 01-04 */
  id: string;
  /** 负责部门名，与账号 department 对应 */
  department: string;
  /** 环节名：产品调研 / 产品策划案 / AI 代码评审 / 运营 */
  step: string;
  /** 能力是否已就绪（01/02/03 已接 skill / 评审链，04 留空待接入） */
  ready: boolean;
  /** 待执行 / 执行中 / 待验收 / 已执行 */
  status: NodeStatus;
  /** 执行器标识：ai-review 触发真实评审链；skill:<name> 触发自研 skill 生成 */
  runner?: string;
  /** 调研/规划需求文字描述（节点 01/02，主管与本部门员工可编辑） */
  requirementText?: string;
  /** 已上传附件文件名（存于目标仓库 .ai-flows-uploads/<节点id>/） */
  uploads?: string[];
  /** 执行产出的文件列表（skill 节点） */
  artifacts?: NodeArtifact[];
  /** 执行进度 0-100（执行中才有意义） */
  progress?: number;
  /** 当前阶段文案，如「模型生成中」 */
  progressLabel?: string;
  /** 最近一次驳回意见（主管驳回时写入，重新提交后清空） */
  rejection?: string;
  /** 最近一次执行结果摘要（评审通过 / 未通过 / 失败原因），展示在详情面板 */
  lastResult?: string;
  /** 最近一次评审报告页链接（runner=ai-review 执行成功后写入） */
  reportUrl?: string;
  /** 最近一次执行选用的输出目录（相对目标仓库根） */
  outputDir?: string;
}

/** 读取全部账号 */
export function loadUsers(): UserAccount[] {
  const f = join(DB_DIR, "users.json");
  const data = JSON.parse(readFileSync(f, "utf8")) as { users?: UserAccount[] };
  return data.users ?? [];
}

/** 保存全部账号（账号管理自助变更 GitHub 绑定后写回） */
export function saveUsers(users: UserAccount[]): void {
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(join(DB_DIR, "users.json"), JSON.stringify({ users }, null, 2), "utf8");
}

/** GitHub 用户名归一化：去空白与 @ 前缀；空串表示解绑；
 *  非法（长度超 39 / 含非字母数字连字符 / 首尾连字符 / 连续连字符）返回 null */
export function normalizeGithub(raw: string): string | null {
  const v = raw.trim().replace(/^@/, "");
  if (!v) return "";
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(v)) return null;
  return v;
}

/** 绑定/解绑指定账号的已生效 GitHub 用户名（空串解绑）；账号不存在返回 null */
export function setUserGithub(email: string, github: string): UserAccount | null {
  const users = loadUsers();
  const user = users.find((u) => u.email === email);
  if (!user) return null;
  if (github) user.github = github;
  else delete user.github;
  saveUsers(users);
  return user;
}

/** 员工提交 GitHub 绑定：写入待审核字段（覆盖旧的待审核值）；账号不存在返回 null */
export function setUserGithubPending(email: string, github: string): UserAccount | null {
  const users = loadUsers();
  const user = users.find((u) => u.email === email);
  if (!user) return null;
  user.githubPending = github;
  saveUsers(users);
  return user;
}

/** 清空某账号的待审核 GitHub 绑定（员工取消 / 主管驳回）；账号不存在返回 null */
export function clearUserGithubPending(email: string): UserAccount | null {
  const users = loadUsers();
  const user = users.find((u) => u.email === email);
  if (!user) return null;
  delete user.githubPending;
  saveUsers(users);
  return user;
}

/** 主管批准：把待审核的 GitHub 转为已生效（无待审核绑定视为无效）；账号不存在返回 null */
export function approveUserGithub(email: string): UserAccount | null {
  const users = loadUsers();
  const user = users.find((u) => u.email === email);
  if (!user || !user.githubPending) return null;
  user.github = user.githubPending;
  delete user.githubPending;
  saveUsers(users);
  return user;
}

/** 修改账号的姓名/部门/职位/头像（主管管理他人时调用）；只写传入的字段；账号不存在返回 null */
export function setUserProfile(
  email: string,
  patch: { name?: string; department?: string; title?: string; avatar?: string }
): UserAccount | null {
  const users = loadUsers();
  const user = users.find((u) => u.email === email);
  if (!user) return null;
  if (patch.name !== undefined) user.name = patch.name;
  if (patch.department !== undefined) user.department = patch.department;
  if (patch.title !== undefined) user.title = patch.title;
  if (patch.avatar !== undefined) {
    if (patch.avatar) user.avatar = patch.avatar;
    else delete user.avatar;
  }
  saveUsers(users);
  return user;
}

/** 邮箱 + 密码校验，命中返回账号，否则 null */
export function authenticate(email: string, password: string): UserAccount | null {
  const target = email.trim().toLowerCase();
  const user = loadUsers().find((u) => u.email === target);
  if (!user || user.password !== password) return null;
  return user;
}

/** 管线数据（db/pipeline.json） */
export interface PipelineData {
  /** 管线名称 */
  name?: string;
  /** 管线节点列表 */
  nodes: NodeState[];
}

/** 读取管线名称（缺省 "text-flow"） */
export function loadPipelineName(): string {
  const f = join(DB_DIR, "pipeline.json");
  try {
    const data = JSON.parse(readFileSync(f, "utf8")) as PipelineData;
    return data.name ?? "text-flow";
  } catch {
    return "text-flow";
  }
}

/** 写回管线名称 */
export function savePipelineName(name: string): void {
  const nodes = loadNodes();
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(join(DB_DIR, "pipeline.json"), JSON.stringify({ name, nodes }, null, 2), "utf8");
}

/** 读取全部管线节点（旧状态 approved 自动迁移为 done 并回写） */
export function loadNodes(): NodeState[] {
  const f = join(DB_DIR, "pipeline.json");
  const data = JSON.parse(readFileSync(f, "utf8")) as PipelineData;
  const nodes = data.nodes ?? [];
  if (nodes.some((n) => (n as { status?: string }).status === "approved")) {
    for (const n of nodes) {
      if ((n as { status?: string }).status === "approved") n.status = "done";
    }
    saveNodes(nodes);
  }
  return nodes;
}

/** 写回管线节点（执行/批准后持久化状态） */
export function saveNodes(nodes: NodeState[]): void {
  const name = loadPipelineName();
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(join(DB_DIR, "pipeline.json"), JSON.stringify({ name, nodes }, null, 2), "utf8");
}

/** 节点历史评审记录：一次 AI 评审 = 一条。平台可追溯「谁在何时评了什么」 */
export interface ReviewRecord {
  /** 评审产出目录 .ai-review-reports/<id>.json 的 id，报表无法确定时为空串 */
  id: string;
  /** 来源：platform=管线页「执行」触发；external=hook / 手动 run 产生 */
  source: "platform" | "external";
  /** 执行角色名（岗位/电话），外部触发视为「外部触发」 */
  actor: string;
  /** 执行人邮箱（platform 记录有值；external 为空串） */
  email: string;
  /** 执行人所属部门节点（platform 记录取账号 department；external 归节点 03 所在部门「程序中台」） */
  department: string;
  /** 执行人身份：员工 / 主管（external 无身份，按视角角色展示） */
  role: Role;
  /** ISO 时间戳（评审完成时间） */
  generatedAt: string;
  /** 门禁是否通过 */
  passed: boolean;
  /** 阻塞级问题数 */
  blockers: number;
  /** 问题总数 */
  issues: number;
  /** 评审报告页地址（平台记录落盘后回写；external 拼接报告服务地址） */
  reportUrl: string;
  /** 来源仓库名（跨仓库聚合扫描时标记；平台本仓库记录可缺省） */
  repo?: string;
}

/** 读取平台执行历史 */
export function loadReviews(): ReviewRecord[] {
  try {
    const f = join(DB_DIR, "reviews.json");
    const data = JSON.parse(readFileSync(f, "utf8")) as { reviews?: ReviewRecord[] };
    return data.reviews ?? [];
  } catch {
    // 历史文件尚未创建时按空处理，不视为错误
    return [];
  }
}

/** 写回平台执行历史（追加一条并持久化） */
export function appendReview(record: ReviewRecord): void {
  const reviews = loadReviews();
  reviews.push(record);
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(join(DB_DIR, "reviews.json"), JSON.stringify({ reviews }, null, 2), "utf8");
}

/** 批量追加评审历史（只读写一次文件） */
export function appendReviews(newRecords: ReviewRecord[]): void {
  if (!newRecords.length) return;
  const reviews = loadReviews();
  reviews.push(...newRecords);
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(join(DB_DIR, "reviews.json"), JSON.stringify({ reviews }, null, 2), "utf8");
}

/** 工单状态：待处理 / 处理中 / 已解决（三态可互相流转） */
export type TicketStatus = "open" | "doing" | "resolved";

/** 工单类型：本期只做 bug 单，预留字段便于后续扩类型 */
export type TicketKind = "bug";

/** 工单评论（同样按部门视角可见） */
export interface TicketComment {
  /** 评论 id */
  id: string;
  /** 评论人姓名（角色卡片同源） */
  author: string;
  /** 评论人邮箱 */
  email: string;
  /** 评论人部门 */
  department: string;
  /** 评论正文（白名单净化后的富文本 HTML） */
  content: string;
  /** ISO 时间戳 */
  at: string;
}

/** 工单（db/tickets.json）。department 决定可见范围：本部门员工 + 主管 */
export interface TicketRecord {
  /** 工单 id（t- 前缀 + 时间戳 + 随机串） */
  id: string;
  /** 类型：bug */
  kind: TicketKind;
  /** 标题 */
  title: string;
  /** 正文（白名单净化后的富文本 HTML，落库前必过 sanitizeRichHtml） */
  content: string;
  /** 状态：待处理 / 处理中 / 已解决 */
  status: TicketStatus;
  /** 提交人所属部门（可见性判据） */
  department: string;
  /** 提交人姓名 */
  authorName: string;
  /** 提交人邮箱 */
  authorEmail: string;
  /** ISO 创建时间 */
  createdAt: string;
  /** ISO 最近更新时间（改状态 / 加评论后刷新） */
  updatedAt: string;
  /** 正文引用的图片文件名列表（存 db/ticket-uploads/） */
  images: string[];
  /** 评论列表（按时间正序） */
  comments: TicketComment[];
}

/** 读取全部工单（文件不存在时按空处理） */
export function loadTickets(): TicketRecord[] {
  try {
    const f = join(DB_DIR, "tickets.json");
    const data = JSON.parse(readFileSync(f, "utf8")) as { tickets?: TicketRecord[] };
    return data.tickets ?? [];
  } catch {
    // 工单库尚未创建时按空处理，不视为错误
    return [];
  }
}

/** 写回全部工单 */
export function saveTickets(tickets: TicketRecord[]): void {
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(join(DB_DIR, "tickets.json"), JSON.stringify({ tickets }, null, 2), "utf8");
}

/** 追加一条工单 */
export function appendTicket(record: TicketRecord): void {
  const tickets = loadTickets();
  tickets.push(record);
  saveTickets(tickets);
}

/** 按 id 更新工单（mutate 回调内修改字段）；工单不存在返回 null */
export function updateTicket(
  id: string,
  mutate: (t: TicketRecord) => void
): TicketRecord | null {
  const tickets = loadTickets();
  const ticket = tickets.find((t) => t.id === id);
  if (!ticket) return null;
  mutate(ticket);
  saveTickets(tickets);
  return ticket;
}

// ============ AI 对话：会话 + 消息（db/chats.json） ============

/** 聊天消息角色 */
export type ChatRole = "user" | "assistant";

/** 聊天消息 */
export interface ChatMessage {
  /** 消息 id（UUID） */
  id: string;
  /** 角色：用户 / AI */
  role: ChatRole;
  /** 内容（原始文本，落库原文；前端渲染时再转义） */
  content: string;
  /** ISO 时间戳 */
  at: string;
  /** 选用的模型配置 id（assistant 消息有值） */
  modelId?: string;
  /** token 用量（assistant 消息有值，total tokens） */
  tokens?: number;
}

/** 聊天会话（按 ownerEmail 私有，不按部门过滤） */
export interface ChatSession {
  /** 会话 id（UUID） */
  id: string;
  /** 所有人邮箱（私有可见性判据） */
  ownerEmail: string;
  /** 会话标题（首条 user 消息前 30 字截断） */
  title: string;
  /** ISO 创建时间 */
  createdAt: string;
  /** ISO 最近更新时间（发消息后刷新） */
  updatedAt: string;
  /** 消息列表（按时间正序） */
  messages: ChatMessage[];
}

/** 聊天库（db/chats.json） */
export interface ChatStore {
  sessions: ChatSession[];
}

/** 读取全部聊天会话（文件不存在时按空处理） */
export function loadChats(): ChatStore {
  try {
    const f = join(DB_DIR, "chats.json");
    const data = JSON.parse(readFileSync(f, "utf8")) as ChatStore;
    return { sessions: data.sessions ?? [] };
  } catch {
    return { sessions: [] };
  }
}

/** 写回全部聊天会话 */
export function saveChats(store: ChatStore): void {
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(join(DB_DIR, "chats.json"), JSON.stringify(store, null, 2), "utf8");
}

/** 追加一条会话 */
export function appendChat(session: ChatSession): void {
  const store = loadChats();
  store.sessions.push(session);
  saveChats(store);
}

/** 按 id 更新会话（mutate 回调内修改字段）；会话不存在返回 null */
export function updateChat(
  id: string,
  mutate: (s: ChatSession) => void
): ChatSession | null {
  const store = loadChats();
  const session = store.sessions.find((s) => s.id === id);
  if (!session) return null;
  mutate(session);
  saveChats(store);
  return session;
}

/** 按 id 删除会话；不存在返回 false */
export function deleteChat(id: string): boolean {
  const store = loadChats();
  const idx = store.sessions.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  store.sessions.splice(idx, 1);
  saveChats(store);
  return true;
}

// ============ AI 对话：模型配置（db/models.json） ============

/** 聊天模型配置。红线：apiKeyEnv 只存环境变量名，不存明文 key */
export interface ChatModel {
  /** 配置 id（UUID） */
  id: string;
  /** 展示名，如 "DeepSeek Chat" */
  name: string;
  /** provider：deepseek / google / aliyun / xfyun / bytedance / baidu */
  provider: string;
  /** 模型名，如 deepseek-chat / gpt-4o-mini */
  model: string;
  /** API base URL（缺省从 PROVIDER_DEFAULT_ENDPOINTS 回退） */
  baseUrl: string;
  /** API Key 环境变量名（红线：不存明文 key） */
  apiKeyEnv: string;
  /** 是否激活（同一时刻只能有一条 active） */
  isActive?: boolean;
  /** 类别：text / vision / ... */
  category?: string;
}

/** 模型配置库（db/models.json） */
export interface ChatModelStore {
  /** 当前激活模型 id */
  activeId: string;
  /** 全部模型配置 */
  models: ChatModel[];
}

/** 种子模型：DeepSeek 默认配置（文件不存在时首次落盘） */
export const CHAT_MODEL_SEED: ChatModel = {
  id: "ds-default",
  name: "DeepSeek Chat",
  provider: "deepseek",
  model: "deepseek-chat",
  baseUrl: "https://api.deepseek.com",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  isActive: true,
  category: "text",
};

/** 读取全部模型配置（文件不存在时返回种子 DeepSeek 配置并落盘一次） */
export function loadChatModels(): ChatModelStore {
  try {
    const f = join(DB_DIR, "models.json");
    const data = JSON.parse(readFileSync(f, "utf8")) as ChatModelStore;
    const models = data.models ?? [];
    if (models.length === 0) {
      // 空库：落盘种子并返回
      const store: ChatModelStore = { activeId: CHAT_MODEL_SEED.id, models: [CHAT_MODEL_SEED] };
      saveChatModels(store);
      return store;
    }
    return { activeId: data.activeId ?? models.find((m) => m.isActive)?.id ?? models[0].id, models };
  } catch {
    const store: ChatModelStore = { activeId: CHAT_MODEL_SEED.id, models: [CHAT_MODEL_SEED] };
    saveChatModels(store);
    return store;
  }
}

/** 写回全部模型配置 */
export function saveChatModels(store: ChatModelStore): void {
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(join(DB_DIR, "models.json"), JSON.stringify(store, null, 2), "utf8");
}

/** 追加一条模型配置 */
export function appendChatModel(model: ChatModel): void {
  const store = loadChatModels();
  store.models.push(model);
  saveChatModels(store);
}

/** 按 id 更新模型配置；不存在返回 null */
export function updateChatModel(
  id: string,
  mutate: (m: ChatModel) => void
): ChatModel | null {
  const store = loadChatModels();
  const model = store.models.find((m) => m.id === id);
  if (!model) return null;
  mutate(model);
  saveChatModels(store);
  return model;
}

/** 按 id 删除模型配置；不存在返回 false */
export function deleteChatModel(id: string): boolean {
  const store = loadChatModels();
  const idx = store.models.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  store.models.splice(idx, 1);
  saveChatModels(store);
  return true;
}

/** 切换激活模型（把指定 id 设为 active，其余清掉）；不存在返回 null */
export function setActiveModel(id: string): ChatModel | null {
  const store = loadChatModels();
  const target = store.models.find((m) => m.id === id);
  if (!target) return null;
  for (const m of store.models) m.isActive = m.id === id;
  store.activeId = id;
  saveChatModels(store);
  return target;
}
