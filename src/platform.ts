import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, basename, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadNodes, saveNodes, loadPipelineName, savePipelineName, authenticate, loadUsers, loadReviews, appendReview, appendReviews, normalizeGithub, setUserGithub, setUserGithubPending, clearUserGithubPending, approveUserGithub, setUserProfile, loadTickets, appendTicket, updateTicket, loadPlatformMessages, appendPlatformMessage, markMessageRead, markAllMessagesRead, TICKET_IMAGES_DIR, AVATARS_DIR, CHAT_UPLOADS_DIR, loadChats, appendChat, updateChat, deleteChat, loadChatModels, appendChatModel, updateChatModel, deleteChatModel, setActiveModel, type ReviewRecord, type NodeState, type UserAccount, type TicketRecord, type TicketStatus, type TicketComment, type ChatSession, type ChatMessage, type ChatModel, type ChatAttachment, type ChatRef, type ChatSkillCall, type PlatformMessage, type MessageType } from "./db.js";
import {
  callModelStream,
  callModelOnce,
  buildChatMessages,
  buildSummaryMessages,
  buildUserContent,
  historyToText,
  countChars,
  truncateTitle,
  esc,
  PROVIDER_DEFAULT_ENDPOINTS,
  type ContentPart,
  type ToolDef,
  type ToolCall,
} from "./chat.js";
import { createSession, destroySession, currentUser, sessionCookie, clearCookie, SESSION_COOKIE, parseCookies } from "./auth.js";
import { loadConfig, type CrawlerConfig, type ReviewConfig } from "./config.js";
import { collectDiff } from "./collector.js";
import { reviewBatch } from "./reviewer.js";
import { decideGate } from "./gate.js";
import { writeReviewReport, buildReportView, fetchRepoTree } from "./reporter.js";
import { isRepo, currentBranch } from "./git.js";
import { ensureReportServer, REPORTS_DIR } from "./serve.js";
import { runSkill, sanitizeFilename, listSkills, resolveSkillDocByName, REPO_ROOT, type SkillInfo } from "./skill.js";
import { runCrawler, runSkillAgent, packZip } from "./crawler.js";
import { sanitizeRichHtml, isEmptyRichHtml } from "./richtext.js";
import {
  CHAT_IMAGE_TYPES,
  isImageName,
  isTextName,
  extOf,
  readTextAttachment,
  cleanAttachmentName,
  imageToDataUrl,
} from "./attach.js";

/** 平台静态资源目录 web/（src 与 dist 均位于仓库根下一级，向上取根） */
export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "web");

/** 平台默认端口（与报告服务 4310 错开） */
export const DEFAULT_PLATFORM_PORT = 4311;

/** 节点附件上传目录名（位于目标仓库根下） */
const UPLOADS_DIR = ".ai-flows-uploads";

/** 需求文本长度上限 */
const REQUIREMENT_MAX = 4000;

/** 工单标题长度上限 */
const TICKET_TITLE_MAX = 100;

/** 工单富文本正文 / 评论长度上限（净化前的原始 HTML 长度） */
const TICKET_CONTENT_MAX = 20000;

/** 工单图片允许的扩展名 → MIME */
const TICKET_IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** 工单图片文件名形态（上传时由服务端生成，严格校验防路径穿越） */
const TICKET_IMAGE_NAME_RE = /^[a-f0-9]{12}\.(png|jpg|jpeg|gif|webp)$/;

/** 头像上传请求体上限：base64 data URL（2MB 图约 2.8MB），留余量 */
const AVATAR_BODY_MAX = 4 * 1024 * 1024;

/** 对话附件文件名形态（上传 / skill 产物均由服务端生成，严格校验防路径穿越） */
const CHAT_FILE_NAME_RE = /^[a-f0-9]{12}\.[a-z0-9]{1,8}$/;

/** 对话上传请求体上限：base64 data URL（8MB 文件约 11MB），覆盖图片与文本类文件 */
const CHAT_UPLOAD_BODY_MAX = 16 * 1024 * 1024;

/** 单个被引用会话注入 prompt 的字符上限（超出截断，防上下文溢出） */
const CHAT_REF_TEXT_LIMIT = 6000;

/** skill 产物回灌 prompt / 展示的字符上限 */
const CHAT_SKILL_TEXT_LIMIT = 12000;

/** 一次对话内最多执行 skill 工具的轮数（防无限循环） */
const CHAT_SKILL_ROUNDS = 3;

/** 单次 skill 执行最多收集的产物文件数 */
const CHAT_SKILL_MAX_FILES = 12;

/** 单个 skill 产物文件大小上限（超出不收集，避免把大包塞进对话） */
const CHAT_SKILL_FILE_MAX = 16 * 1024 * 1024;

/** 收集 skill 产物时跳过的噪音目录（依赖、缓存、虚拟环境） */
const SKILL_OUTPUT_SKIP = new Set(["node_modules", "venv", "__pycache__"]);

/** 会话标题长度上限（用户手工重命名时超出按此截断） */
const CHAT_TITLE_MAX = 60;

/** 员工只能执行本部门节点；部门主管不限部门（权限最高） */
export function canExecute(user: UserAccount, node: NodeState): boolean {
  return user.role === "supervisor" || user.department === node.department;
}

/** 仅部门主管可批准节点（操控并批准所有节点） */
export function canApprove(user: UserAccount): boolean {
  return user.role === "supervisor";
}

/** 需求文本/附件编辑权限：与本节点执行权限一致（本部门员工 + 主管） */
export function canEditRequirement(user: UserAccount, node: NodeState): boolean {
  return canExecute(user, node);
}

/** 目标仓库内路径安全解析：rel 归一化后必须仍在 repo 内，越权返回 null */
export function safeRepoPath(repo: string, rel: string): string | null {
  const root = resolve(repo);
  const abs = resolve(root, rel || ".");
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

/** 节点 03（AI 代码评审）所属部门：外部触发（hook/手动 run）的报告无账号归属，统一归到该部门 */
const AI_REVIEW_DEPT = "程序中台";

/** 按视角过滤评审记录：主管看全部；员工只看本部门；外部触发记录已归到部门，可随部门可见 */
export function filterReviewsByUser(reviews: ReviewRecord[], user: UserAccount): ReviewRecord[] {
  if (user.role === "supervisor") return reviews;
  return reviews.filter((r) => r.department === user.department);
}

/** 工单访问权限：本部门员工 + 部门主管（主管全量）。查看 / 改状态 / 评论同权，不另设入口 */
export function canAccessTicket(user: UserAccount, ticket: { department: string }): boolean {
  return user.role === "supervisor" || user.department === ticket.department;
}

/** 按视角过滤工单：主管全量；员工只看本部门提交的工单 */
export function filterTicketsByUser(tickets: TicketRecord[], user: UserAccount): TicketRecord[] {
  if (user.role === "supervisor") return tickets;
  return tickets.filter((t) => t.department === user.department);
}

/** 工单状态取值合法（用于请求体校验） */
export function isTicketStatus(v: unknown): v is TicketStatus {
  return v === "open" || v === "doing" || v === "resolved";
}

/** 从净化后的正文中收集引用的本平台图片文件名（挂到工单记录，便于统计/审计） */
export function collectTicketImages(html: string): string[] {
  const out = new Set<string>();
  const re = /<img\b[^>]*\bsrc="\/api\/tickets\/images\/([A-Za-z0-9._-]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.add(m[1]);
  return [...out];
}

/** 解码 URL 路径段（前端对 email 的 @ 会编码成 %40，不还原就查不到账号）。
 *  非法编码或解码后含路径分隔符时返回 null，交调用方按「账号不存在」处理。 */
export function decodePathSegment(seg: string): string | null {
  let out: string;
  try {
    out = decodeURIComponent(seg);
  } catch {
    return null;
  }
  if (!out || out.includes("/") || out.includes("\\")) return null;
  return out;
}

/** 净化 + 长度校验富文本字段；非法时返回 null */
function normalizeRichField(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > TICKET_CONTENT_MAX) return null;
  return sanitizeRichHtml(raw);
}

/** 按 id 去重，platform 优先于 external（platform 记录有更完整的执行人/角色元信息） */
function dedupReviews(reviews: ReviewRecord[]): ReviewRecord[] {
  const seen = new Map<string, ReviewRecord>();
  for (const r of reviews) {
    const existing = seen.get(r.id);
    if (!existing || (r.source === "platform" && existing.source === "external")) {
      seen.set(r.id, r);
    }
  }
  return [...seen.values()];
}

/** 用当前报告服务地址刷新评审记录的 reportUrl（报告 JSON 文件存在于当前仓库才刷新） */
async function refreshReviewUrls(
  reviews: ReviewRecord[],
  repo: string,
): Promise<ReviewRecord[]> {
  const dir = join(repo, REPORTS_DIR);
  const base = await ensureReportServer(repo);
  return reviews.map((r) => {
    if (existsSync(join(dir, `${r.id}.json`))) {
      return { ...r, reportUrl: `${base}/reports/${r.id}` };
    }
    return r;
  });
}

/** 刷新节点的 reportUrl（报告 JSON 文件存在于当前仓库才刷新） */
async function refreshNodeReportUrl(
  node: NodeState,
  repo: string,
): Promise<NodeState> {
  if (!node.reportUrl) return node;
  const dir = join(repo, REPORTS_DIR);
  // 从旧 URL 里提取 id，兼容各种端口场景
  const m = node.reportUrl.match(/\/reports\/([^/]+)/);
  if (!m) return node;
  const id = m[1];
  if (!existsSync(join(dir, `${id}.json`))) return node;
  const base = await ensureReportServer(repo);
  return { ...node, reportUrl: `${base}/reports/${id}` };
}

/** 视图层用户模型（不含密码） */
interface UserView {
  email: string;
  /** 中文姓名（角色卡片展示） */
  name?: string;
  role: UserAccount["role"];
  title: string;
  department: string;
  /** 已生效绑定的 GitHub 用户名（账号管理自助绑定；未绑定为缺省） */
  github?: string;
  /** 待主管审核的 GitHub 用户名（员工自助绑定后展示「待审核」态；缺省表示无待审绑定） */
  githubPending?: string;
  /** 自定义头像文件名（落 db/avatars/<file>，缺省用首字头像） */
  avatar?: string;
}

/** 视图层节点模型（带当前用户权限标记，注入页面 bootstrap） */
interface NodeView extends NodeState {
  /** 当前用户能否执行该节点 */
  canExecute: boolean;
  /** 当前用户能否批准该节点 */
  canApprove: boolean;
  /** 当前用户能否编辑需求文本/上传附件（与执行权限一致） */
  canEdit: boolean;
  /** 挂在该节点上的需求工单 id（每节点一张，未挂单不允许执行/审核） */
  ticketId?: string;
  /** 执行角色列表（部门成员 ∪ 显式添加 − 显式排除），前端直接渲染角色卡片 */
  executorList: UserView[];
}

/** 剥离密码，输出视图层用户 */
function toUserView(u: UserAccount): UserView {
  return { email: u.email, name: u.name, role: u.role, title: u.title, department: u.department, github: u.github, githubPending: u.githubPending, avatar: u.avatar };
}

/** 节点需求工单：nodeId 命中且未指派给具体员工的那张 requirement 工单 */
function findRequirementTicket(nodeId: string, tickets?: TicketRecord[]): TicketRecord | undefined {
  const list = tickets ?? loadTickets();
  return list.find((t) => t.nodeId === nodeId && t.kind === "requirement" && !t.assigneeEmail);
}

/** 自动生成工单 id（t- 前缀 + 时间戳 + 随机串，与手动工单同形） */
function newTicketId(): string {
  return `t-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

/** 为单个节点补齐需求工单（幂等），返回该节点的需求工单 */
function ensureNodeRequirementTicket(node: NodeState): TicketRecord {
  const existing = findRequirementTicket(node.id);
  if (existing) return existing;
  const now = new Date().toISOString();
  const text = (node.requirementText ?? "").trim();
  const record: TicketRecord = {
    id: newTicketId(),
    kind: "requirement",
    title: `[需求] ${node.step}`,
    content:
      `<p>节点「${esc(node.step)}」（${esc(node.department)}）的需求工单。</p>` +
      (text ? `<p>${esc(text)}</p>` : "<p>需求内容待补充。</p>"),
    status: "open",
    department: node.department,
    authorName: "系统",
    authorEmail: "",
    createdAt: now,
    updatedAt: now,
    images: [],
    comments: [],
    nodeId: node.id,
  };
  appendTicket(record);
  return record;
}

/** 为全部节点补齐需求工单（幂等），返回最新工单列表 */
function ensureNodeRequirementTickets(): TicketRecord[] {
  for (const node of loadNodes()) ensureNodeRequirementTicket(node);
  return loadTickets();
}

/** 剥离富文本标签取纯文本（首页搜索工单正文用） */
function htmlToPlainText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ").toLowerCase();
}

/** 节点 + 权限 → 视图模型（tickets 传入可避免逐节点重复查库） */
function toNodeView(user: UserAccount, node: NodeState, tickets?: TicketRecord[]): NodeView {
  const req = findRequirementTicket(node.id, tickets);
  return {
    ...node,
    ticketId: req?.id,
    executorList: nodeExecutors(node, loadUsers()),
    canExecute: canExecute(user, node),
    canApprove: canApprove(user),
    canEdit: canEditRequirement(user, node),
  };
}

/** 节点执行角色集合 = 部门成员 ∪ 显式添加名单 − 显式排除名单（按部门/邮箱去重） */
function nodeExecutors(node: NodeState, users: UserAccount[]): UserAccount[] {
  const removed = new Set(node.removedExecutors ?? []);
  const map = new Map<string, UserAccount>();
  for (const u of users) {
    if (u.department === node.department && !removed.has(u.email)) map.set(u.email, u);
  }
  for (const e of node.executors ?? []) {
    const u = users.find((x) => x.email === e.email);
    if (u && !removed.has(u.email)) map.set(u.email, u);
  }
  return Array.from(map.values());
}

/** 把员工挂到节点执行角色（幂等）。from 记录加入前部门，删除时可回滚 */
function addNodeExecutor(node: NodeState, email: string): NodeState | null {
  const target = loadUsers().find((u) => u.email === email);
  if (!target) return null;
  const nodes = loadNodes();
  const cur = nodes.find((n) => n.id === node.id);
  if (!cur) return null;
  const executors = cur.executors ?? [];
  const removed = (cur.removedExecutors ?? []).filter((e) => e !== email);
  const known = executors.some((e) => e.email === email);
  const next: NodeState = {
    ...cur,
    executors: known ? executors : [...executors, { email, from: target.department }],
    removedExecutors: removed.length ? removed : undefined,
  };
  saveNodes(nodes.map((n) => (n.id === cur.id ? next : n)));
  // 对齐部门，保证该员工对本节点有执行权限（canExecute 按部门判定）
  if (target.department !== cur.department) {
    setUserProfile(target.email, { department: cur.department });
  }
  return next;
}

/** 从节点执行角色移除员工（显式添加的回滚部门；部门派生的记入排除名单） */
function removeNodeExecutor(node: NodeState, email: string): NodeState | null {
  const nodes = loadNodes();
  const cur = nodes.find((n) => n.id === node.id);
  if (!cur) return null;
  const entry = (cur.executors ?? []).find((e) => e.email === email);
  const executors = (cur.executors ?? []).filter((e) => e.email !== email);
  const removed = new Set(cur.removedExecutors ?? []);
  if (!entry) removed.add(email);
  const next: NodeState = {
    ...cur,
    executors: executors.length ? executors : undefined,
    removedExecutors: removed.size ? Array.from(removed) : undefined,
  };
  saveNodes(nodes.map((n) => (n.id === cur.id ? next : n)));
  // 显式加入的成员：回滚到加入前的部门（若原部门为空则不动）
  if (entry && entry.from && entry.from !== cur.department) {
    setUserProfile(email, { department: entry.from });
  }
  return next;
}

/** 工单列表项视图（不含正文，列表页只渲染摘要，避免大正文拖慢接口） */
export interface TicketListItem {
  id: string;
  kind: TicketRecord["kind"];
  title: string;
  status: TicketStatus;
  department: string;
  authorName: string;
  authorEmail: string;
  createdAt: string;
  updatedAt: string;
  /** 评论条数（详情用 commentList 拿正文） */
  commentCount: number;
  /** 正文引用图片数（详情用 content 内的 img 标签渲染） */
  imageCount: number;
  /** 关联的管线节点 id（节点自动生成的工单才有） */
  nodeId?: string;
  /** 指派给的员工邮箱（负责人） */
  assigneeEmail?: string;
  /** 负责人展示名（邮箱查找姓名；查不到回退邮箱前缀） */
  assigneeName?: string;
}

/** 邮箱 → 展示名（查不到回退邮箱前缀） */
function nameOfEmail(email: string): string {
  const u = loadUsers().find((x) => x.email === email);
  return u ? u.name?.trim() || u.email.split("@")[0] : email;
}

/** 邮箱 → 展示名映射（列表场景一次构表，避免逐条查库） */
function userNameMap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const u of loadUsers()) m.set(u.email, u.name?.trim() || u.email.split("@")[0]);
  return m;
}

/** 工单完整视图（详情 / 新建后返回；正文已净化，可直接 innerHTML 渲染） */
export interface TicketView extends TicketListItem {
  content: string;
  commentList: TicketComment[];
  /** 是否由当前用户提交（前端据此做「我提交的」标记） */
  mine: boolean;
}

/** 工单 → 列表项视图（nameOf 传入可复用姓名映射，避免逐条查库） */
function toTicketListItem(t: TicketRecord, nameOf?: (email: string) => string): TicketListItem {
  const name = t.assigneeEmail ? (nameOf ?? nameOfEmail)(t.assigneeEmail) : undefined;
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    status: t.status,
    department: t.department,
    authorName: t.authorName,
    authorEmail: t.authorEmail,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    commentCount: t.comments?.length ?? 0,
    imageCount: t.images?.length ?? 0,
    nodeId: t.nodeId,
    assigneeEmail: t.assigneeEmail,
    assigneeName: name,
  };
}

/** 工单 + 当前用户 → 完整视图 */
function toTicketView(t: TicketRecord, user: UserAccount): TicketView {
  return {
    ...toTicketListItem(t),
    content: t.content,
    commentList: t.comments ?? [],
    mine: t.authorEmail === user.email,
  };
}

/** 站内消息视图（收件人视角；refType/refId 供前端跳转关联对象） */
interface MessageView {
  id: string;
  type: MessageType;
  title: string;
  body?: string;
  refType?: string;
  refId?: string;
  read: boolean;
  at: string;
}

function toMessageView(m: PlatformMessage): MessageView {
  return {
    id: m.id,
    type: m.type,
    title: m.title,
    body: m.body,
    refType: m.refType,
    refId: m.refId,
    read: !!m.readAt,
    at: m.at,
  };
}

/** 本人视角的消息列表（按时间倒序） */
function myMessages(email: string): MessageView[] {
  return loadPlatformMessages()
    .filter((m) => m.email === email)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(toMessageView);
}

/** 本人未读消息数（顶栏铃铛红点） */
function unreadMessageCount(email: string): number {
  return loadPlatformMessages().filter((m) => m.email === email && !m.readAt).length;
}

/** 投递一条站内消息（自己给自己不投递，避免自触发噪音） */
function notify(
  email: string,
  type: MessageType,
  title: string,
  opts?: { body?: string; refType?: string; refId?: string }
): void {
  const to = (email ?? "").trim();
  if (!to) return;
  const msg: PlatformMessage = {
    id: `m-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
    email: to,
    type,
    title,
    at: new Date().toISOString(),
  };
  if (opts?.body) msg.body = opts.body;
  if (opts?.refType) msg.refType = opts.refType;
  if (opts?.refId) msg.refId = opts.refId;
  appendPlatformMessage(msg);
}

/** 渲染消息页：读静态 messages.html，注入登录用户 + 本人消息 bootstrap */
function messagesHtml(user: UserAccount): string {
  const raw = readFileSync(join(WEB_DIR, "messages.html"), "utf8");
  const list = myMessages(user.email);
  const boot = {
    user: toUserView(user),
    isSupervisor: user.role === "supervisor",
    messages: list,
    unread: list.filter((m) => !m.read).length,
  };
  const inject = `<script>window.__MESSAGES__ = ${jsonForScript(boot)};</script>\n<script src="/messages.js" defer></script>`;
  return raw.replace("</body>", `${inject}\n</body>`);
}

/** JSON 序列化为可安全内嵌 <script> 的字符串（转义 < 防提前闭合标签） */
function jsonForScript(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

/** 统一 JSON 响应 */
function sendJson(res: ServerResponse, status: number, v: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(v));
}

/** 读取请求体并按上限截断（与报告服务一致的防大 body 策略） */
function readBody(req: IncomingMessage, maxBytes = 16 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** 静态资源白名单：文件名 → MIME（精确匹配，天然免疫路径穿越） */
const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/login.css": { file: "login.css", type: "text/css; charset=utf-8" },
  "/ai-pipeline.css": { file: "ai-pipeline.css", type: "text/css; charset=utf-8" },
  "/ai-pipeline-app.js": { file: "ai-pipeline-app.js", type: "text/javascript; charset=utf-8" },
  "/user-menu.js": { file: "user-menu.js", type: "text/javascript; charset=utf-8" },
  "/ai-review-report.css": { file: "ai-review-report.css", type: "text/css; charset=utf-8" },
  "/ai-review-report.js": { file: "ai-review-report.js", type: "text/javascript; charset=utf-8" },
  "/account.js": { file: "account.js", type: "text/javascript; charset=utf-8" },
  "/team.js": { file: "team.js", type: "text/javascript; charset=utf-8" },
  "/tickets.js": { file: "tickets.js", type: "text/javascript; charset=utf-8" },
  "/github-audit.js": { file: "github-audit.js", type: "text/javascript; charset=utf-8" },
  "/chat.js": { file: "chat.js", type: "text/javascript; charset=utf-8" },
  "/home.js": { file: "home.js", type: "text/javascript; charset=utf-8" },
  "/profile.js": { file: "profile.js", type: "text/javascript; charset=utf-8" },
  "/messages.js": { file: "messages.js", type: "text/javascript; charset=utf-8" },
};

/** 读 web/ 下静态文件并响应，不存在返回 false */
function serveStatic(res: ServerResponse, route: string): boolean {
  const entry = STATIC_FILES[route];
  if (!entry) return false;
  try {
    const content = readFileSync(join(WEB_DIR, entry.file));
    res.setHeader("Content-Type", entry.type);
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

/** 渲染管线页：读静态 ai-pipeline.html，注入登录用户 + 部门成员 + 节点状态 + 权限 bootstrap，再挂平台脚本 */
async function pipelineHtml(user: UserAccount, repo: string): Promise<string> {
  const raw = readFileSync(join(WEB_DIR, "ai-pipeline.html"), "utf8");
  const nodesWithUrls = await Promise.all(
    loadNodes().map((n) => refreshNodeReportUrl(n, repo)),
  );
  const repoName = repo.replace(/[\\/]/g, "").split(".").slice(-2).join(".") || repo;
  const tickets = ensureNodeRequirementTickets();
  const boot = {
    pipelineName: loadPipelineName(),
    repoName: repoName.replace(/^.*[\\/]/, ""),
    repoPath: repo,
    user: toUserView(user),
    members: loadUsers().map(toUserView),
    nodes: nodesWithUrls.map((n) => toNodeView(user, n, tickets)),
  };
  const inject = `<script>window.__PIPELINE__ = ${jsonForScript(boot)};</script>\n<script src="/ai-pipeline-app.js" defer></script>`;
  return raw.replace("</body>", `${inject}\n</body>`);
}

/** 渲染账号管理页：读静态 account.html，注入登录用户 bootstrap */
function accountHtml(user: UserAccount): string {
  const raw = readFileSync(join(WEB_DIR, "account.html"), "utf8");
  const boot = {
    user: toUserView(user),
    isSupervisor: user.role === "supervisor",
  };
  const inject = `<script>window.__ACCOUNT__ = ${jsonForScript(boot)};</script>\n<script src="/account.js" defer></script>`;
  return raw.replace("</body>", `${inject}\n</body>`);
}

/** 渲染团队管理页：读静态 team.html，注入用户 + 成员 + 部门列表 bootstrap（仅主管可访问） */
function teamHtml(user: UserAccount): string {
  const raw = readFileSync(join(WEB_DIR, "team.html"), "utf8");
  const allUsers = loadUsers();
  const departments = Array.from(new Set(allUsers.map((u) => u.department).filter(Boolean)));
  const boot = {
    user: toUserView(user),
    members: allUsers.map(toUserView),
    departments,
    isSupervisor: user.role === "supervisor",
  };
  const inject = `<script>window.__TEAM__ = ${jsonForScript(boot)};</script>\n<script src="/team.js" defer></script>`;
  return raw.replace("</body>", `${inject}\n</body>`);
}

/** 渲染 GitHub 绑定管理页：员工自助绑定 + 主管审核；读静态 github-audit.html，注入用户 + 成员 + 部门 bootstrap */
function githubAuditHtml(user: UserAccount): string {
  const raw = readFileSync(join(WEB_DIR, "github-audit.html"), "utf8");
  const allUsers = loadUsers();
  const boot = {
    user: toUserView(user),
    members: allUsers.map(toUserView),
    isSupervisor: user.role === "supervisor",
  };
  const inject = `<script>window.__GHAUDIT__ = ${jsonForScript(boot)};</script>\n<script src="/github-audit.js" defer></script>`;
  return raw.replace("</body>", `${inject}\n</body>`);
}

/** 渲染工单页：读静态 tickets.html，注入登录用户 + 部门列表 + 成员 + 主管标记 bootstrap */
function ticketsHtml(user: UserAccount): string {
  const raw = readFileSync(join(WEB_DIR, "tickets.html"), "utf8");
  const allUsers = loadUsers();
  const boot = {
    user: toUserView(user),
    departments: Array.from(new Set(allUsers.map((u) => u.department).filter(Boolean))),
    members: allUsers.map(toUserView),
    isSupervisor: user.role === "supervisor",
  };
  const inject = `<script>window.__TICKETS__ = ${jsonForScript(boot)};</script>\n<script src="/tickets.js" defer></script>`;
  return raw.replace("</body>", `${inject}\n</body>`);
}

/** 把 ChatModel 转成前端视图（不暴露 apiKeyEnv，前端永远拿不到 key） */
function toChatModelView(m: ChatModel): { id: string; name: string; provider: string; model: string; baseUrl: string; category?: string; isActive: boolean } {
  return { id: m.id, name: m.name, provider: m.provider, model: m.model, baseUrl: m.baseUrl, category: m.category, isActive: !!m.isActive };
}

/** 聊天消息视图（落库原文，前端渲染时再转义） */
function toChatMessageView(m: ChatMessage): { id: string; role: ChatMessage["role"]; content: string; at: string; modelId?: string; tokens?: number; attachments?: ChatAttachment[]; refs?: ChatRef[]; skillCalls?: ChatSkillCall[] } {
  return { id: m.id, role: m.role, content: m.content, at: m.at, modelId: m.modelId, tokens: m.tokens, attachments: m.attachments, refs: m.refs, skillCalls: m.skillCalls };
}

/** 渲染 AI 对话页：读静态 chat.html，注入登录用户 + 模型列表 + 激活模型 bootstrap */
function chatHtml(user: UserAccount): string {
  const raw = readFileSync(join(WEB_DIR, "chat.html"), "utf8");
  const { activeId, models } = loadChatModels();
  const boot = {
    user: toUserView(user),
    models: models.map(toChatModelView),
    activeModelId: activeId,
    isSupervisor: user.role === "supervisor",
  };
  const inject = `<script>window.__CHAT__ = ${jsonForScript(boot)};</script>\n<script src="/chat.js" defer></script>`;
  return raw.replace("</body>", `${inject}\n</body>`);
}

/** 渲染首页：读静态 home.html，注入登录用户 bootstrap */
function homeHtml(user: UserAccount): string {
  const raw = readFileSync(join(WEB_DIR, "home.html"), "utf8");
  const boot = { user: toUserView(user) };
  const inject = `<script>window.__HOME__ = ${jsonForScript(boot)};</script>\n<script src="/home.js" defer></script>`;
  return raw.replace("</body>", `${inject}\n</body>`);
}

/** 渲染员工个人主页：读静态 profile.html，注入当前用户 + 目标用户 */
function profileHtml(user: UserAccount, target: UserAccount): string {
  const raw = readFileSync(join(WEB_DIR, "profile.html"), "utf8");
  const boot = {
    user: toUserView(user),
    target: toUserView(target),
    isSupervisor: user.role === "supervisor",
  };
  const inject = `<script>window.__PROFILE__ = ${jsonForScript(boot)};</script>\n<script src="/profile.js" defer></script>`;
  return raw.replace("</body>", `${inject}\n</body>`);
}

/** 加载 chat 配置（缺省回退平台启动目录配置） */
function loadChatConfig(): {
  systemPrompt: string;
  maxHistory: number;
  maxTokens: number;
  temperature: number;
  compressChars: number;
} {
  try {
    const cfg = loadConfig(undefined);
    const c = cfg.chat ?? {};
    return {
      systemPrompt: c.systemPrompt ?? "你是 ai-flows 平台的 AI 助手。",
      maxHistory: c.maxHistory ?? 50,
      maxTokens: c.maxTokens ?? 2000,
      temperature: c.temperature ?? 0.7,
      compressChars: c.compressChars ?? 400,
    };
  } catch {
    return {
      systemPrompt: "你是 ai-flows 平台的 AI 助手。",
      maxHistory: 50,
      maxTokens: 2000,
      temperature: 0.7,
      compressChars: 400,
    };
  }
}

/** 把 ChatModel 转成 reviewer 的 ModelConfig（共用 resolveApiKey） */
function chatModelToModelConfig(m: ChatModel): { baseUrl: string; apiKeyEnv: string; model: string; timeoutMs?: number } {
  const baseUrl = m.baseUrl || PROVIDER_DEFAULT_ENDPOINTS[m.provider] || "";
  return { baseUrl, apiKeyEnv: m.apiKeyEnv, model: m.model, timeoutMs: 120000 };
}

// ---------- AI 对话：附件 / 引用会话 / skill 工具 ----------

/** 把消息附件还原成 prompt 分段：图片转 data URL，文本类读内容拼成文本段 */
function attachmentParts(atts: ChatAttachment[] | undefined): { imageUrls: string[]; fileSections: string[] } {
  const imageUrls: string[] = [];
  const fileSections: string[] = [];
  for (const a of atts ?? []) {
    const abs = join(CHAT_UPLOADS_DIR, a.file);
    if (a.kind === "image") {
      const url = imageToDataUrl(abs, a.mime);
      if (url) imageUrls.push(url);
    } else {
      const text = readTextAttachment(abs);
      fileSections.push(`### 附件：${a.name}\n${text ?? "（二进制附件，仅提供文件名，不做内容分析）"}`);
    }
  }
  return { imageUrls, fileSections };
}

/** 历史消息还原器：带附件的历史也还原成多模态内容，保证上下文完整 */
function renderHistoryMessage(m: ChatMessage): string | ContentPart[] {
  if (!m.attachments?.length) return m.content;
  const { imageUrls, fileSections } = attachmentParts(m.attachments);
  return buildUserContent(m.content, imageUrls, fileSections);
}

/** 组装被引用会话的上下文文本（只取当前用户自己的会话，防越权读取他人对话） */
function buildRefContext(ownerEmail: string, refs: ChatRef[]): string {
  if (!refs.length) return "";
  const sessions = loadChats().sessions;
  const parts: string[] = [];
  for (const r of refs) {
    const s = sessions.find((x) => x.id === r.id && x.ownerEmail === ownerEmail);
    if (!s) continue;
    const text = historyToText(s.messages).slice(0, CHAT_REF_TEXT_LIMIT);
    if (text) parts.push(`【引用会话：${s.title || "未命名"}】\n${text}`);
  }
  return parts.join("\n\n");
}

/** 组装 skill 工具定义：单个 invoke_skill 工具，skill 参数用枚举限定在市面可用的 skill 目录 */
function buildSkillTool(): { tool: ToolDef; skills: Map<string, SkillInfo> } | null {
  const list = listSkills();
  if (!list.length) return null;
  const lines = list.map(
    (s) => `- ${s.dir}：${s.name}${s.description ? ` — ${s.description}` : ""}${s.executable ? "（含脚本，可真实执行）" : "（纯文档）"}`
  );
  const tool: ToolDef = {
    type: "function",
    function: {
      name: "invoke_skill",
      description: `调用平台内置 Skill 处理任务并产出专业文档。可用 Skill：\n${lines.join("\n")}\n当用户显式要求使用某个 Skill，或任务与上述 Skill 的用途高度契合时调用。`,
      parameters: {
        type: "object",
        properties: {
          skill: { type: "string", enum: list.map((s) => s.dir), description: "要调用的 Skill 目录名" },
          requirement: { type: "string", description: "交给该 Skill 的完整任务需求描述" },
        },
        required: ["skill", "requirement"],
      },
    },
  };
  return { tool, skills: new Map(list.map((s) => [s.dir, s])) };
}

/** 附件展示 / 下载用 MIME：按扩展名给出真实类型，未知类型落 octet-stream */
function chatMimeOf(name: string): string {
  const ext = extOf(name);
  const known: Record<string, string> = {
    md: "text/markdown; charset=utf-8",
    json: "application/json; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    log: "text/plain; charset=utf-8",
    zip: "application/zip",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    pdf: "application/pdf",
  };
  return CHAT_IMAGE_TYPES[ext] ?? known[ext] ?? "application/octet-stream";
}

/** 递归收集 skill 产物目录下本次执行新产生的文件（mtime ≥ sinceMs），跳过噪音目录与超大文件 */
function collectNewFiles(dir: string, sinceMs: number, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= CHAT_SKILL_MAX_FILES) return;
    if (e.name.startsWith(".") || SKILL_OUTPUT_SKIP.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      collectNewFiles(full, sinceMs, out);
      continue;
    }
    if (!e.isFile()) continue;
    try {
      if (statSync(full).mtimeMs < sinceMs) continue;
    } catch {
      continue;
    }
    out.push(full);
  }
}

/** 把 skill 本次产出的文件收进 db/chat-uploads/，返回可下载附件（供消息里的文件卡片展示）。
 *  产出 ≥2 个文件时优先打包成一个 zip：先试 7-Zip，不可用则回退零依赖内置压缩。 */
async function collectSkillOutputs(
  root: string,
  outputDirName: string,
  sinceMs: number,
  skill: string,
  zipCommand: string,
  onStage?: (label: string) => void
): Promise<ChatAttachment[]> {
  if (!outputDirName) return [];
  const abs = join(root, outputDirName);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];

  const found: string[] = [];
  collectNewFiles(abs, sinceMs, found);

  const usable: Array<{ full: string; size: number }> = [];
  for (const full of found) {
    try {
      const size = statSync(full).size;
      if (size <= CHAT_SKILL_FILE_MAX) usable.push({ full, size });
    } catch {
      /* 读取失败的跳过 */
    }
  }
  if (!usable.length) return [];
  mkdirSync(CHAT_UPLOADS_DIR, { recursive: true });

  if (usable.length >= 2) {
    onStage?.(`打包 ${usable.length} 个产物…`);
    const file = `${randomBytes(6).toString("hex")}.zip`;
    const outPath = join(CHAT_UPLOADS_DIR, file);
    try {
      await packZip({ base: abs, files: usable.map((u) => u.full), outPath, command: zipCommand });
      return [
        {
          kind: "file",
          file,
          name: cleanAttachmentName(`${skill}-产物.zip`),
          mime: "application/zip",
          size: statSync(outPath).size,
        },
      ];
    } catch {
      /* 打包失败退回逐个文件，不让用户拿不到产物 */
    }
  }

  onStage?.("收集产物…");
  const out: ChatAttachment[] = [];
  for (const { full, size } of usable) {
    const name = basename(full);
    const file = `${randomBytes(6).toString("hex")}.${extOf(name)}`;
    if (!CHAT_FILE_NAME_RE.test(file)) continue; // 无扩展名 / 扩展名过长的不收集（不然无法经 /api/chat/files 取回）
    try {
      writeFileSync(join(CHAT_UPLOADS_DIR, file), readFileSync(full));
    } catch {
      continue;
    }
    out.push({ kind: "file", file, name: cleanAttachmentName(name), mime: chatMimeOf(name), size });
  }
  return out;
}

/** 对话页执行 skill：纯文档 skill 直接回 SKILL.md 注入上下文；含脚本 skill 在 skill 项目根内跑 agent 真执行 */
async function executeChatSkill(
  dir: string,
  info: SkillInfo,
  requirement: string,
  emit: (payload: Record<string, unknown>) => void
): Promise<{ text: string; files: ChatAttachment[] }> {
  // 纯文档 skill：不跑进程，直接把 SKILL.md 灌进上下文；同样报 start/done，让前端消息流里也出现灰字提示
  if (!info.executable) {
    emit({ status: "start", skill: dir });
    const doc = resolveSkillDocByName(dir);
    emit({ status: "done", skill: dir });
    return { text: doc, files: [] };
  }

  const crawler = loadCrawlerConfig();
  // 执行根：仓库内 skill（脚本以仓库相对路径调用）缺省落在仓库根，需外部项目环境的 skill 走 skillRoots 覆盖
  const root = crawler.skillRoots[dir] || REPO_ROOT;
  emit({ status: "start", skill: dir });
  const doc = resolveSkillDocByName(dir);
  // 产物只认本次执行期间写进输出目录的文件；留 2s 时钟余量，避免漏掉恰好与起始同秒落盘的文件
  const sinceMs = Date.now() - 2000;
  let lastEcho = 0;
  const text = await runSkillAgent({
    root,
    command: crawler.command,
    args: crawler.args,
    prompt: `请按下面的 Skill 说明文档执行任务，直接给出最终结果，不要复述文档内容。\n\n${doc}\n\n## 用户需求\n${requirement}`,
    timeoutMs: crawler.timeoutMs,
    onProgress: (pct, label) => emit({ status: "progress", skill: dir, pct, label }),
    // agent 输出实时回显：频率上限 1.2s 一条，避免刷屏把 SSE 打满
    onOutput: (line) => {
      const now = Date.now();
      if (now - lastEcho < 1200) return;
      lastEcho = now;
      emit({ status: "progress", skill: dir, label: `运行中：${line.slice(0, 160)}` });
    },
  });
  const files = await collectSkillOutputs(root, crawler.outputDir, sinceMs, dir, crawler.zipCommand, (label) =>
    emit({ status: "progress", skill: dir, label })
  );
  emit({
    status: "done",
    skill: dir,
    files: files.map((f) => ({ file: f.file, name: f.name, size: f.size })),
  });
  return { text, files };
}

/** 规范化对话附件入参：只保留文件名合法且确实存在的条目（防伪造 / 穿越） */
function normalizeAttachments(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatAttachment[] = [];
  for (const item of raw as any[]) {
    const file = String(item?.file ?? "");
    if (!CHAT_FILE_NAME_RE.test(file)) continue;
    if (!existsSync(join(CHAT_UPLOADS_DIR, file))) continue;
    const kind = item?.kind === "image" ? "image" : "file";
    out.push({
      kind,
      file,
      name: cleanAttachmentName(String(item?.name ?? file)),
      mime: String(item?.mime ?? "application/octet-stream"),
      size: Number(item?.size ?? 0) || 0,
    });
  }
  return out;
}

/** 规范化引用会话入参：只保留 id 形态合法的条目（归属另在 buildRefContext 校验） */
function normalizeRefs(raw: unknown): ChatRef[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatRef[] = [];
  for (const item of raw as any[]) {
    const id = String(item?.id ?? "");
    if (!id || /[/\\]/.test(id)) continue;
    out.push({ id, title: String(item?.title ?? "").slice(0, 120) });
  }
  return out;
}

/** skill 执行用的模型配置：优先目标仓库的 ai-review.config.json，缺省回退平台启动目录配置 */
function loadSkillModelConfig(repo: string): ReviewConfig {
  const repoCfg = join(repo, "ai-review.config.json");
  return loadConfig(existsSync(repoCfg) ? repoCfg : undefined);
}

/** 节点 01 调研 agent 配置：读平台自身 ai-review.config.json，缺省值兜底（root 解析为绝对路径） */
function loadCrawlerConfig(): Required<CrawlerConfig> {
  let cfg: CrawlerConfig = {};
  try {
    const cfgPath = join(process.cwd(), "ai-review.config.json");
    if (existsSync(cfgPath)) cfg = loadConfig(cfgPath).crawler ?? {};
  } catch {
    /* 平台配置缺失/损坏时按空配置兜底，由调用方给出可读报错 */
  }
  return {
    root: cfg.root ? resolve(cfg.root) : "",
    skillRoots: Object.fromEntries(
      Object.entries(cfg.skillRoots ?? {}).map(([k, v]) => [k, v ? resolve(v) : ""])
    ),
    command: cfg.command || "claude",
    args: cfg.args ?? ["-p", "--permission-mode", "bypassPermissions"],
    outputDir: cfg.outputDir || "output",
    timeoutMs: cfg.timeoutMs ?? 600000,
    zipCommand: cfg.zipCommand || "",
  };
}

/** 重新读库更新单个节点（后台任务完成后回写，避免覆盖期间其他节点的状态变更） */
function updateNode(id: string, mutate: (n: NodeState) => void): void {
  const nodes = loadNodes();
  const n = nodes.find((x) => x.id === id);
  if (!n) return;
  mutate(n);
  saveNodes(nodes);
}

/** 节点 03（AI 代码评审）执行器：在目标仓库上跑完整评审链
 *  diff 采集 → LLM 评审 → 门禁 → 报告落盘，返回报告页链接与门禁结果 */
async function runAiReviewNode(repo: string): Promise<{
  id: string;
  reportUrl: string;
  passed: boolean;
  blockers: number;
  issues: number;
}> {
  if (!(await isRepo(repo))) {
    throw new Error(`评审目标不是 git 仓库：${repo}`);
  }
  // 评审配置随目标仓库走（与其 pre-push hook 行为一致）
  const cfg = loadConfig(join(repo, "ai-review.config.json"));
  const files = await collectDiff(cfg.diff, repo);
  const result = await reviewBatch(files, cfg.model);
  const gate = decideGate(result, cfg);

  const id = `review-${Date.now().toString(36)}`;
  writeReviewReport(result, gate, { outPath: join(repo, "review-report.md") });
  let ref: string | undefined;
  try {
    ref = await currentBranch(repo);
  } catch {
    /* detached HEAD 等场景忽略 */
  }
  const view = buildReportView(result, files, gate, undefined, {
    ref,
    repoCwd: repo,
    targets: cfg.targets,
    repoTree: await fetchRepoTree(repo, { tokenEnv: cfg.reviews?.gitHubTokenEnv }),
  });
  const dir = join(repo, REPORTS_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(view, null, 2), "utf-8");

  const base = await ensureReportServer(repo);
  return {
    id,
    reportUrl: `${base}/reports/${id}`,
    passed: gate.passed,
    blockers: gate.blockers.length,
    issues: result.issues.length,
  };
}

/** 跨仓库聚合扫描时跳过的目录名（避免扫到 node_modules/dist 等噪声） */
const EXTERNAL_SCAN_SKIP = new Set([".git", "node_modules", "dist", "build", ".vscode", ".idea", "coverage", ".next", ".cache", ".turbo", ".ai-flows-uploads"]);

/** 在 scanRoot 下递归查找所有 `.ai-review-reports/` 目录（限 3 层深度防性能问题） */
function findReportsDirs(root: string, maxDepth = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    const candidate = join(dir, REPORTS_DIR);
    try {
      if (existsSync(candidate) && statSync(candidate).isDirectory()) {
        if (!seen.has(candidate)) {
          seen.add(candidate);
          out.push(candidate);
        }
      }
    } catch {
      /* 权限或符号链接异常忽略 */
    }
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      if (EXTERNAL_SCAN_SKIP.has(name)) continue;
      if (name.startsWith(".") && name !== "." && name !== "..") continue;
      const full = join(dir, name);
      try {
        if (statSync(full).isDirectory()) walk(full, depth + 1);
      } catch {
        /* 跳过 */
      }
    }
  };
  walk(root, 0);
  return out;
}

/** 读取 scanRoots 下所有 `.ai-review-reviews/` 中的外部触发报告（hook / 手动 run 落盘），
 *  归为「外部触发」执行角色，嫁接到节点 03 所属部门，供「评审记录」面板聚合展示。
 *  跨仓库报告带 repo 字段标记来源；reportUrl 仅在报告文件存在于平台当前仓库时才回填 */
async function collectExternalReviews(
  scanRoots: string[],
  platformRepo: string
): Promise<ReviewRecord[]> {
  const records: ReviewRecord[] = [];
  const platformRoot = resolve(platformRepo);
  for (const root of scanRoots) {
    // 相对路径相对平台仓库根解析；路径穿越防护：解析后若仍在 cwd 之上且未授权则跳过
    const absRoot = resolve(platformRoot, root);
    const dirs = findReportsDirs(absRoot);
    for (const dir of dirs) {
      const repoPath = dirname(dir);
      const repoName = basename(repoPath);
      let files: string[];
      try {
        files = readdirSync(dir).filter(
          (f) => f.endsWith(".json") && !f.startsWith(".")
        );
      } catch {
        continue;
      }
      for (const f of files) {
        try {
          const view = JSON.parse(readFileSync(join(dir, f), "utf8")) as {
            passed?: boolean;
            generatedAt?: string;
            counts?: { blocker?: number; warning?: number; info?: number };
          };
          records.push({
            id: f.replace(/\.json$/, ""),
            source: "external",
            actor: "外部触发",
            email: "",
            department: AI_REVIEW_DEPT,
            role: "staff",
            generatedAt: view.generatedAt ?? "",
            passed: !!view.passed,
            blockers: view.counts?.blocker ?? 0,
            issues:
              (view.counts?.blocker ?? 0) +
              (view.counts?.warning ?? 0) +
              (view.counts?.info ?? 0),
            reportUrl: "",
            repo: repoName,
          });
        } catch {
          /* 单个损坏报告跳过，不影响整体列表 */
        }
      }
    }
  }
  // 扫到的记录中，db 里不存在的批量补录（只读写一次文件）
  if (records.length) {
    const existingIds = new Set(loadReviews().map((r) => r.id));
    const fresh = records.filter((r) => !existingIds.has(r.id));
    if (fresh.length) appendReviews(fresh);
  }
  // reportUrl 刷新：仅当报告 JSON 存在于平台当前仓库的 .ai-review-reports/ 时才能通过报告服务访问
  if (records.length) {
    const base = await ensureReportServer(platformRepo);
    const dir = join(platformRepo, REPORTS_DIR);
    for (const r of records) {
      if (existsSync(join(dir, `${r.id}.json`))) {
        r.reportUrl = `${base}/reports/${r.id}`;
      }
    }
  }
  return records;
}

export interface PlatformServer {
  server: Server;
  port: number;
  host: string;
  url: string;
  close(): Promise<void>;
}

/** 启动 AI 管线平台 HTTP 服务：登录会话 + 管线页角色渲染 + 节点执行/提交/批准/驳回 API。
 *  opts.repo 为节点执行的目标仓库（skill 产物与附件落在该仓库，节点 03 评审链也在其上执行）。 */
export async function startPlatformServer(
  opts: { host?: string; port?: number; repo?: string } = {}
): Promise<PlatformServer> {
  const host = opts.host ?? "127.0.0.1";
  const repo = opts.repo ?? process.cwd();

  // 加载平台自身 ai-review.config.json 的 reviews.scanRoots（跨仓库评审聚合扫描根）；
  // 加载失败或未配置回退到 [repo] 自身（保持原行为：仅扫本仓库 .ai-review-reports/）
  let scanRoots: string[] = [repo];
  try {
    const cfgPath = join(process.cwd(), "ai-review.config.json");
    if (existsSync(cfgPath)) {
      const cfg = loadConfig(cfgPath);
      scanRoots = (cfg.reviews?.scanRoots ?? ["."]).map((r) =>
        r === "." ? repo : r
      );
    }
  } catch {
    /* 平台配置加载失败，回退到只扫本仓库 */
  }

  // 后台任务在途的节点 id（防并发重复执行；完成/失败后移除）
  const busy = new Set<string>();

  // 清理上次进程异常退出残留的 running 状态，避免节点永久卡在执行中
  const bootNodes = loadNodes();
  let dirty = false;
  for (const n of bootNodes) {
    if (n.status === "running") {
      n.status = "todo";
      n.lastResult = "平台重启导致执行中断，请重新执行";
      dirty = true;
    }
  }
  if (dirty) saveNodes(bootNodes);

  // 启动即为每个节点补齐需求工单（每节点必须有需求工单才能执行/审核）
  ensureNodeRequirementTickets();

  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", `http://${host}`);
    const path = u.pathname;

    if (path === "/health") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("ok");
      return;
    }

    // 静态资源（白名单精确匹配）
    if (req.method === "GET" && serveStatic(res, path)) return;

    // 登录页
    if (path === "/login" && req.method === "GET") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(readFileSync(join(WEB_DIR, "login.html")));
      return;
    }

    // 登录接口：校验 db/users.json 账号，签发会话 cookie
    if (path === "/api/login" && req.method === "POST") {
      let email = "";
      let password = "";
      try {
        const body = JSON.parse(await readBody(req)) as { email?: unknown; password?: unknown };
        if (typeof body.email === "string") email = body.email;
        if (typeof body.password === "string") password = body.password;
      } catch {
        /* 解析失败按空凭据处理，下面统一 401 */
      }
      const user = authenticate(email, password);
      if (!user) {
        sendJson(res, 401, { error: "邮箱或密码错误" });
        return;
      }
      const token = createSession(user.email);
      res.setHeader("Set-Cookie", sessionCookie(token));
      sendJson(res, 200, { ok: true, user: toUserView(user) });
      return;
    }

    // 注销
    if (path === "/api/logout" && req.method === "POST") {
      destroySession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
      res.setHeader("Set-Cookie", clearCookie());
      sendJson(res, 200, { ok: true });
      return;
    }

    // 当前用户（未登录 401，前端据此跳登录页）
    if (path === "/api/me" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      sendJson(res, 200, { user: toUserView(user) });
      return;
    }

    // 账号管理：我的资料 + GitHub 绑定状态；主管额外返回全部成员（供成员管理 / 绑定审核）
    if (path === "/api/account" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      sendJson(res, 200, {
        user: toUserView(user),
        members: user.role === "supervisor" ? loadUsers().map(toUserView) : undefined,
      });
      return;
    }

    // 绑定 GitHub：主管即刻生效；员工写入待审核，等待主管批准
    if (path === "/api/account/github/bind" && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      let raw = "";
      try {
        const body = JSON.parse(await readBody(req)) as { github?: unknown };
        if (typeof body.github === "string") raw = body.github;
      } catch {
        sendJson(res, 400, { error: "请求体不是合法 JSON" });
        return;
      }
      const github = normalizeGithub(raw);
      if (github === null || !github) {
        sendJson(res, 400, { error: "GitHub 用户名不合法（限字母数字连字符，≤39 位）" });
        return;
      }
      const updated =
        user.role === "supervisor"
          ? setUserGithub(user.email, github)
          : setUserGithubPending(user.email, github);
      if (!updated) {
        sendJson(res, 404, { error: "账号不存在" });
        return;
      }
      sendJson(res, 200, { user: toUserView(updated), pending: !!updated.githubPending });
      return;
    }

    // 取消待审核的 GitHub 绑定（员工自助反悔）
    if (path === "/api/account/github/cancel" && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const updated = clearUserGithubPending(user.email);
      if (!updated) {
        sendJson(res, 404, { error: "账号不存在" });
        return;
      }
      sendJson(res, 200, { user: toUserView(updated) });
      return;
    }

    // 解绑已生效的 GitHub（自助；如需更换可先解绑再重新绑定）
    if (path === "/api/account/github/unbind" && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const updated = setUserGithub(user.email, "");
      if (!updated) {
        sendJson(res, 404, { error: "账号不存在" });
        return;
      }
      sendJson(res, 200, { user: toUserView(updated) });
      return;
    }

    // 主管审核：批准 / 驳回某员工待审核的 GitHub 绑定
    const gam = path.match(/^\/api\/account\/([^/\\]+)\/github\/(approve|reject)$/);
    if (gam && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      if (!canApprove(user)) {
        sendJson(res, 403, { error: "仅部门主管可审核 GitHub 绑定" });
        return;
      }
      const target = decodePathSegment(gam[1]);
      const updated = target
        ? gam[2] === "approve"
          ? approveUserGithub(target)
          : clearUserGithubPending(target)
        : null;
      if (!updated) {
        sendJson(res, 404, { error: "账号不存在或没有待审核的绑定" });
        return;
      }
      sendJson(res, 200, { user: toUserView(updated) });
      return;
    }

    // 主管设置账号的姓名 / 部门 / 职位（管理他人）
    const pm = path.match(/^\/api\/account\/([^/\\]+)\/profile$/);
    if (pm && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      if (!canApprove(user)) {
        sendJson(res, 403, { error: "仅部门主管可设置账号的姓名/部门/职位" });
        return;
      }
      let patch: { name?: string; department?: string; title?: string; avatar?: string } = {};
      try {
        const body = JSON.parse(await readBody(req)) as {
          name?: unknown;
          department?: unknown;
          title?: unknown;
          avatar?: unknown;
        };
        if (typeof body.name === "string") patch.name = body.name.trim();
        if (typeof body.department === "string") patch.department = body.department.trim();
        if (typeof body.title === "string") patch.title = body.title.trim();
        if (typeof body.avatar === "string") patch.avatar = body.avatar;
      } catch {
        sendJson(res, 400, { error: "请求体不是合法 JSON" });
        return;
      }
      for (const k of ["name", "department", "title"] as const) {
        const v = patch[k];
        if (v !== undefined && (!v || v.length > 30)) {
          sendJson(res, 400, { error: `${k} 不能为空且不超过 30 字符` });
          return;
        }
      }
      if (patch.avatar !== undefined && patch.avatar !== "" && !/^[a-f0-9]{12}\.(png|jpg|jpeg|gif|webp)$/.test(patch.avatar)) {
        sendJson(res, 400, { error: "头像文件名不合法" });
        return;
      }
      const target = decodePathSegment(pm[1]);
      const updated = target ? setUserProfile(target, patch) : null;
      if (!updated) {
        sendJson(res, 404, { error: "账号不存在" });
        return;
      }
      sendJson(res, 200, { user: toUserView(updated) });
      return;
    }

    // 节点列表 + 当前用户权限 + 部门成员（角色卡片数据源；登录即可查看全流程）
    if (path === "/api/nodes" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const nodesWithUrls = await Promise.all(
        loadNodes().map((n) => refreshNodeReportUrl(n, repo)),
      );
      const tickets = ensureNodeRequirementTickets();
      sendJson(res, 200, {
        pipelineName: loadPipelineName(),
        user: toUserView(user),
        members: loadUsers().map(toUserView),
        nodes: nodesWithUrls.map((n) => toNodeView(user, n, tickets)),
        busy: [...busy],
      });
      return;
    }

    // 重命名管线
    if (path === "/api/pipeline/rename" && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      try {
        const body = JSON.parse(await readBody(req)) as { name?: string };
        const name = (body.name ?? "").trim();
        if (!name) {
          sendJson(res, 400, { error: "管线名称不能为空" });
          return;
        }
        savePipelineName(name);
        sendJson(res, 200, { name });
      } catch {
        sendJson(res, 400, { error: "请求格式错误" });
        return;
      }
      return;
    }

    // 节点 03 评审记录：平台历史 + 外部报告聚合，按视角过滤（主管全量 / 员工本部门）
    if (path === "/api/reviews" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      // 先扫描外部报告并补录到 db/reviews.json，再直接读 db 全量
      await collectExternalReviews(scanRoots, repo);
      const all = loadReviews();
      const refreshed = await refreshReviewUrls(all, repo);
      const sorted = refreshed.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
      sendJson(res, 200, { reviews: filterReviewsByUser(sorted, user) });
      return;
    }

    // 首页（未登录重定向到登录页）
    if (path === "/home" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        res.statusCode = 302;
        res.setHeader("Location", "/login");
        res.end();
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(homeHtml(user));
      return;
    }

    // 员工个人主页（路由用邮箱前缀，URL 编码）
    const profileMatch = path.match(/^\/profile\/([^/\\]+)$/);
    if (profileMatch && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        res.statusCode = 302;
        res.setHeader("Location", "/login");
        res.end();
        return;
      }
      const prefix = decodePathSegment(profileMatch[1]);
      if (!prefix) { sendJson(res, 404, { error: "用户不存在" }); return; }
      const target = loadUsers().find((u) => u.email.split("@")[0] === prefix);
      if (!target) { sendJson(res, 404, { error: "用户不存在" }); return; }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(profileHtml(user, target));
      return;
    }

    // 管线页（未登录重定向到登录页）
    if (path === "/pipeline" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        res.statusCode = 302;
        res.setHeader("Location", "/login");
        res.end();
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(await pipelineHtml(user, repo));
      return;
    }

    // 账号管理页（登录即可访问）
    if (path === "/account" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        res.statusCode = 302;
        res.setHeader("Location", "/login");
        res.end();
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(accountHtml(user));
      return;
    }

    // 团队管理页（仅主管可访问）
    if (path === "/team" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        res.statusCode = 302;
        res.setHeader("Location", "/login");
        res.end();
        return;
      }
      if (user.role !== "supervisor") {
        res.statusCode = 403;
        res.end("仅部门主管可访问团队管理");
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(teamHtml(user));
      return;
    }

    // GitHub 绑定管理页（登录即可访问：员工自助绑定 + 主管审核）
    if (path === "/github-audit" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        res.statusCode = 302;
        res.setHeader("Location", "/login");
        res.end();
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(githubAuditHtml(user));
      return;
    }

    // 头像文件读取：文件名严格校验 [a-f0-9]{12}.(png|jpg|jpeg|gif|webp)，天然免疫穿越
    const avm = path.match(/^\/api\/avatars\/([a-f0-9]{12}\.(?:png|jpg|jpeg|gif|webp))$/);
    if (avm && req.method === "GET") {
      const file = avm[1];
      const ext = file.split(".").pop() as string;
      const mime = TICKET_IMAGE_TYPES[ext] || "application/octet-stream";
      const fp = join(AVATARS_DIR, file);
      if (!existsSync(fp)) {
        res.statusCode = 404;
        res.end("头像不存在");
        return;
      }
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.end(readFileSync(fp));
      return;
    }

    // 上传头像：自己改自己，接收 base64 data URL，落 db/avatars/，返回文件名
    if (path === "/api/account/avatar" && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      let dataUrl = "";
      try {
        const body = JSON.parse(await readBody(req, AVATAR_BODY_MAX)) as { avatar?: unknown };
        if (typeof body.avatar === "string") dataUrl = body.avatar;
      } catch {
        sendJson(res, 400, { error: "头像数据读取失败（请求体过大或不是合法 JSON）" });
        return;
      }
      const match = dataUrl.match(/^data:image\/(png|jpg|jpeg|gif|webp);base64,(.+)$/);
      if (!match) {
        sendJson(res, 400, { error: "头像格式不合法（限 png/jpg/jpeg/gif/webp 的 base64）" });
        return;
      }
      const ext = match[1] === "jpeg" ? "jpg" : match[1];
      const buf = Buffer.from(match[2], "base64");
      if (buf.length > 2 * 1024 * 1024) {
        sendJson(res, 400, { error: "头像不能超过 2MB" });
        return;
      }
      mkdirSync(AVATARS_DIR, { recursive: true });
      const fileName = `${randomBytes(6).toString("hex")}.${ext}`;
      writeFileSync(join(AVATARS_DIR, fileName), buf);
      const updated = setUserProfile(user.email, { avatar: fileName });
      if (!updated) {
        sendJson(res, 404, { error: "账号不存在" });
        return;
      }
      sendJson(res, 200, { user: toUserView(updated) });
      return;
    }

    // 需求文本：PUT 保存（主管 + 本部门员工）。id 用 [^/\\]+ 限定防路径穿越
    const rm = path.match(/^\/api\/nodes\/([^/\\]+)\/requirement$/);
    if (rm && req.method === "PUT") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const nodes = loadNodes();
      const node = nodes.find((n) => n.id === rm[1]);
      if (!node) {
        sendJson(res, 404, { error: "节点不存在" });
        return;
      }
      if (!canEditRequirement(user, node)) {
        sendJson(res, 403, { error: "仅本部门员工或部门主管可编辑需求内容" });
        return;
      }
      let text = "";
      try {
        const body = JSON.parse(await readBody(req)) as { text?: unknown };
        if (typeof body.text === "string") text = body.text;
      } catch {
        sendJson(res, 400, { error: "请求体不是合法 JSON" });
        return;
      }
      if (text.length > REQUIREMENT_MAX) {
        sendJson(res, 400, { error: `需求内容过长（上限 ${REQUIREMENT_MAX} 字）` });
        return;
      }
      node.requirementText = text;
      saveNodes(nodes);
      sendJson(res, 200, { ok: true, node: toNodeView(user, node) });
      return;
    }

    // 附件上传：POST（body 为 base64，避免手写 multipart），落 .ai-flows-uploads/<节点id>/
    const um = path.match(/^\/api\/nodes\/([^/\\]+)\/upload$/);
    if (um && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const nodes = loadNodes();
      const node = nodes.find((n) => n.id === um[1]);
      if (!node) {
        sendJson(res, 404, { error: "节点不存在" });
        return;
      }
      if (!canEditRequirement(user, node)) {
        sendJson(res, 403, { error: "仅本部门员工或部门主管可上传附件" });
        return;
      }
      let filename = "";
      let contentBase64 = "";
      try {
        const body = JSON.parse(await readBody(req, 4 * 1024 * 1024)) as {
          filename?: unknown;
          contentBase64?: unknown;
        };
        if (typeof body.filename === "string") filename = body.filename;
        if (typeof body.contentBase64 === "string") contentBase64 = body.contentBase64;
      } catch {
        sendJson(res, 400, { error: "请求体过大或不是合法 JSON" });
        return;
      }
      if (!filename || !contentBase64) {
        sendJson(res, 400, { error: "缺少 filename 或 contentBase64" });
        return;
      }
      const safeName = sanitizeFilename(filename);
      const dir = join(repo, UPLOADS_DIR, node.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, safeName), Buffer.from(contentBase64, "base64"));
      const list = node.uploads ?? [];
      if (!list.includes(safeName)) list.push(safeName);
      node.uploads = list;
      saveNodes(nodes);
      sendJson(res, 200, { ok: true, node: toNodeView(user, node) });
      return;
    }

    // 节点动作：执行 / 提交 / 批准 / 驳回。id 用 [^/\\]+ 限定防路径穿越
    const am = path.match(/^\/api\/nodes\/([^/\\]+)\/(execute|submit|approve|reject)$/);
    if (am && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const nodes = loadNodes();
      const node = nodes.find((n) => n.id === am[1]);
      if (!node) {
        sendJson(res, 404, { error: "节点不存在" });
        return;
      }
      const action = am[2];

      if (action === "execute") {
        if (!canExecute(user, node)) {
          sendJson(res, 403, { error: "仅本部门员工或部门主管可执行该节点" });
          return;
        }
        // 每个节点必须先挂需求工单（缺则即时补齐），再允许执行
        ensureNodeRequirementTicket(node);
        if (!node.ready || !node.runner) {
          sendJson(res, 400, { error: "该环节能力待接入，暂不可执行" });
          return;
        }
        if (busy.has(node.id)) {
          sendJson(res, 400, { error: "该节点正在执行中，请稍候" });
          return;
        }
        if (node.status === "in_review") {
          sendJson(res, 409, { error: "节点待验收中，请等待主管审核" });
          return;
        }
        if (node.status === "done") {
          sendJson(res, 409, { error: "节点已执行完成（终态），不可重复执行" });
          return;
        }

        const sm = node.runner.match(/^skill:([\w-]+)$/);
        if (sm) {
          // skill 节点：解析输出目录 → 后台跑 runSkill，进度经 onProgress 回写。
          // body.skill 可覆盖 runner 默认 skill（节点 01「需求分析」用 product-analysis）
          let outputDirRel = node.outputDir ?? "";
          let skillOverride = "";
          try {
            const body = JSON.parse(await readBody(req)) as { outputDir?: unknown; skill?: unknown };
            if (typeof body.outputDir === "string") outputDirRel = body.outputDir;
            if (typeof body.skill === "string" && /^[\w-]+$/.test(body.skill)) {
              skillOverride = body.skill;
            }
          } catch {
            /* 未带 body 时沿用最近一次输出目录 */
          }
          const outputAbs = safeRepoPath(repo, outputDirRel);
          if (!outputAbs) {
            sendJson(res, 403, { error: "输出目录越权：只能选择目标仓库内的目录" });
            return;
          }
          if (!existsSync(outputAbs) || !statSync(outputAbs).isDirectory()) {
            sendJson(res, 400, { error: `输出目录不存在：${outputDirRel || "."}` });
            return;
          }
          const skill = skillOverride || sm[1];
          const uploadDir = join(repo, UPLOADS_DIR, node.id);
          const uploadFiles = (node.uploads ?? [])
            .map((f) => join(uploadDir, f))
            .filter((f) => existsSync(f));
          node.status = "running";
          node.progress = 0;
          node.progressLabel = "排队中";
          node.lastResult = undefined;
          node.reportUrl = undefined;
          node.outputDir = outputDirRel.replace(/\\/g, "/");
          busy.add(node.id);
          saveNodes(nodes);
          sendJson(res, 200, { ok: true, node: toNodeView(user, node) });
          runSkill(
            {
              skill,
              requirement: node.requirementText ?? "",
              uploads: uploadFiles,
              outputDir: outputAbs,
              onProgress: (pct, label) => {
                updateNode(node.id, (n) => {
                  n.progress = pct;
                  n.progressLabel = label;
                });
              },
            },
            loadSkillModelConfig(repo).model
          )
            .then((r) => {
              updateNode(node.id, (n) => {
                n.status = "running";
                n.progress = 100;
                n.progressLabel = "完成";
                n.artifacts = [
                  ...(n.artifacts ?? []),
                  {
                    name: r.artifactName,
                    path: relative(repo, r.artifactPath).replace(/\\/g, "/"),
                    skill,
                    at: new Date().toISOString(),
                  },
                ];
                n.lastResult = "执行完成：产物已生成，可提交验收";
              });
            })
            .catch((err: any) => {
              updateNode(node.id, (n) => {
                n.status = "running";
                n.progress = undefined;
                n.progressLabel = undefined;
                n.lastResult = `执行失败：${err?.message || String(err)}`;
              });
            })
            .finally(() => {
              busy.delete(node.id);
            });
          return;
        }

        if (node.runner === "research-crawler") {
          // 调研 agent 节点：需求文本直接作 prompt → 外部 agent 跑完 → 打包其 output 为 zip 产物
          const requirement = (node.requirementText ?? "").trim();
          if (!requirement) {
            sendJson(res, 400, { error: "请先填写调研需求内容再执行" });
            return;
          }
          const crawler = loadCrawlerConfig();
          if (!crawler.root) {
            sendJson(res, 400, { error: "未配置调研 agent 目录（ai-review.config.json 的 crawler.root）" });
            return;
          }
          if (!existsSync(crawler.root) || !statSync(crawler.root).isDirectory()) {
            sendJson(res, 400, { error: `调研 agent 目录不存在：${crawler.root}` });
            return;
          }
          const outputAbs = safeRepoPath(repo, node.outputDir ?? "");
          if (!outputAbs || !existsSync(outputAbs) || !statSync(outputAbs).isDirectory()) {
            sendJson(res, 400, { error: `产物输出目录不存在：${node.outputDir || "."}` });
            return;
          }
          const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
          const zipName = sanitizeFilename(`research-crawler-${stamp}.zip`);
          const zipPath = join(outputAbs, zipName);

          node.status = "running";
          node.progress = 0;
          node.progressLabel = "排队中";
          node.lastResult = undefined;
          node.reportUrl = undefined;
          busy.add(node.id);
          saveNodes(nodes);
          sendJson(res, 200, { ok: true, node: toNodeView(user, node) });
          runCrawler({
            root: crawler.root,
            command: crawler.command,
            args: crawler.args,
            requirement,
            outputDirName: crawler.outputDir,
            zipPath,
            timeoutMs: crawler.timeoutMs,
            onProgress: (pct, label) => {
              updateNode(node.id, (n) => {
                n.progress = pct;
                n.progressLabel = label;
              });
            },
          })
            .then((r) => {
              updateNode(node.id, (n) => {
                n.status = "running";
                n.progress = 100;
                n.progressLabel = "完成";
                n.artifacts = [
                  ...(n.artifacts ?? []),
                  {
                    name: r.artifactName,
                    path: relative(repo, r.artifactPath).replace(/\\/g, "/"),
                    skill: "research-crawler",
                    at: new Date().toISOString(),
                  },
                ];
                n.lastResult = `执行完成：调研产物已打包（${r.fileCount} 个文件），可提交验收`;
              });
            })
            .catch((err: any) => {
              updateNode(node.id, (n) => {
                n.status = "running";
                n.progress = undefined;
                n.progressLabel = undefined;
                n.lastResult = `执行失败：${err?.message || String(err)}`;
              });
            })
            .finally(() => {
              busy.delete(node.id);
            });
          return;
        }

        if (node.runner === "ai-review") {
          // 评审链节点：先落 running 态立即响应，评审在后台执行，完成后保持 running 等待提交
          node.status = "running";
          node.progress = undefined;
          node.progressLabel = undefined;
          node.lastResult = "AI 评审进行中…";
          node.reportUrl = undefined;
          busy.add(node.id);
          saveNodes(nodes);
          sendJson(res, 200, { ok: true, node: toNodeView(user, node) });
          runAiReviewNode(repo)
            .then((r) => {
              updateNode(node.id, (n) => {
                n.status = "running";
                n.reportUrl = r.reportUrl;
                n.lastResult = r.passed
                  ? r.issues > 0
                    ? `评审通过（共 ${r.issues} 个非阻塞提示），可提交验收`
                    : "评审通过（未发现问题），可提交验收"
                  : `评审未通过：${r.blockers} 个 blocker，已拦截`;
              });
              // 写入平台执行历史，供「评审记录」面板按角色/部门追溯
              appendReview({
                id: r.id,
                source: "platform",
                actor: user.title,
                email: user.email,
                department: user.department,
                role: user.role,
                generatedAt: new Date().toISOString(),
                passed: r.passed,
                blockers: r.blockers,
                issues: r.issues,
                reportUrl: r.reportUrl,
              });
            })
            .catch((err: any) => {
              updateNode(node.id, (n) => {
                n.status = "running";
                n.lastResult = `执行失败：${err?.message || String(err)}`;
              });
            })
            .finally(() => {
              busy.delete(node.id);
            });
          return;
        }
        sendJson(res, 400, { error: `未知执行器：${node.runner}` });
        return;
      }

      if (action === "submit") {
        // 执行人提交验收：running → in_review
        if (!canExecute(user, node)) {
          sendJson(res, 403, { error: "仅本部门员工或部门主管可提交验收" });
          return;
        }
        if (node.status !== "running") {
          sendJson(res, 409, { error: "仅「执行中」状态可提交验收" });
          return;
        }
        if (busy.has(node.id)) {
          sendJson(res, 400, { error: "该节点正在执行中，请等待执行完成" });
          return;
        }
        node.status = "in_review";
        node.rejection = undefined;
        saveNodes(nodes);
        sendJson(res, 200, { ok: true, node: toNodeView(user, node) });
        return;
      }

      if (action === "approve") {
        // 主管通过：非 done 状态均可审核 → done
        if (!canApprove(user)) {
          sendJson(res, 403, { error: "仅部门主管可批准节点" });
          return;
        }
        if (node.status === "done") {
          sendJson(res, 409, { error: "节点已验收通过，无需重复审核" });
          return;
        }
        if (!node.uploads || node.uploads.length === 0) {
          sendJson(res, 409, { error: "员工尚未提交文件，无法审核" });
          return;
        }
        // 审核前确保节点挂有需求工单
        ensureNodeRequirementTicket(node);
        node.status = "done";
        node.rejection = undefined;
        saveNodes(nodes);
        sendJson(res, 200, { ok: true, node: toNodeView(user, node) });
        return;
      }

      // reject：主管驳回，非 done → running（附驳回意见）
      if (!canApprove(user)) {
        sendJson(res, 403, { error: "仅部门主管可驳回节点" });
        return;
      }
      if (node.status === "done") {
        sendJson(res, 409, { error: "节点已验收通过，不可驳回" });
        return;
      }
      let reason = "验收不通过，请修改后重新提交";
      try {
        const body = JSON.parse(await readBody(req)) as { reason?: unknown };
        if (typeof body.reason === "string" && body.reason.trim()) {
          reason = body.reason.trim().slice(0, 500);
        }
      } catch {
        /* 未带 body 时用默认意见 */
      }
      node.status = "running";
      node.rejection = reason;
      saveNodes(nodes);
      sendJson(res, 200, { ok: true, node: toNodeView(user, node) });
      return;
    }

    // 主管把员工加入节点执行人：改其所属部门到该节点 + 自动在该账号下生成工单
    const exm = path.match(/^\/api\/nodes\/([^/\\]+)\/executors$/);
    if (exm && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      if (!canApprove(user)) {
        sendJson(res, 403, { error: "仅部门主管可添加执行人" });
        return;
      }
      const node = loadNodes().find((n) => n.id === exm[1]);
      if (!node) {
        sendJson(res, 404, { error: "节点不存在" });
        return;
      }
      let email = "";
      try {
        const body = JSON.parse(await readBody(req)) as { email?: unknown };
        if (typeof body.email === "string") email = body.email.trim();
      } catch {
        sendJson(res, 400, { error: "请求体不是合法 JSON" });
        return;
      }
      const target = loadUsers().find((u) => u.email === email);
      if (!target) {
        sendJson(res, 404, { error: "员工不存在" });
        return;
      }
      // 挂到节点执行角色（部门对齐 + 记录原部门，删除可回滚）
      addNodeExecutor(node, target.email);
      const reqTicket = ensureNodeRequirementTicket(node);
      // 同一员工同一节点只建一张指派工单（幂等）
      const existing = loadTickets().find(
        (t) => t.nodeId === node.id && t.assigneeEmail === target.email,
      );
      if (!existing) {
        const now = new Date().toISOString();
        const assignee = target.name?.trim() || target.email.split("@")[0];
        const ticketId = newTicketId();
        appendTicket({
          id: ticketId,
          kind: "requirement",
          title: `[执行] ${node.step}`,
          content:
            `<p>节点「${esc(node.step)}」（${esc(node.department)}）的执行工单，指派给 ${esc(assignee)}。</p>` +
            `<p>对应需求工单：${esc(reqTicket.id)}</p>`,
          status: "open",
          department: node.department,
          authorName: user.name?.trim() || user.email.split("@")[0],
          authorEmail: user.email,
          createdAt: now,
          updatedAt: now,
          images: [],
          comments: [],
          nodeId: node.id,
          assigneeEmail: target.email,
        });
        notify(target.email, "ticket_assign", `你被指派为「${node.step}」节点的执行人`, {
          body: "对应工单已创建，请到工单页查看需求与附件。",
          refType: "ticket",
          refId: ticketId,
        });
      }
      const fresh = loadNodes().find((n) => n.id === node.id) ?? node;
      sendJson(res, 200, { ok: true, node: toNodeView(user, fresh) });
      return;
    }

    // 移除节点执行角色（仅主管）：显式加入的回滚原部门，部门派生的记入排除名单
    const exd = path.match(/^\/api\/nodes\/([^/\\]+)\/executors\/([^/\\]+)$/);
    if (exd && req.method === "DELETE") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      if (!canApprove(user)) {
        sendJson(res, 403, { error: "仅部门主管可移除执行角色" });
        return;
      }
      const node = loadNodes().find((n) => n.id === exd[1]);
      if (!node) {
        sendJson(res, 404, { error: "节点不存在" });
        return;
      }
      const email = decodePathSegment(exd[2]);
      if (!email) {
        sendJson(res, 404, { error: "员工不存在" });
        return;
      }
      const target = loadUsers().find((u) => u.email === email);
      if (!target) {
        sendJson(res, 404, { error: "员工不存在" });
        return;
      }
      const next = removeNodeExecutor(node, email);
      if (!next) {
        sendJson(res, 404, { error: "节点不存在" });
        return;
      }
      const name = target.name?.trim() || target.email.split("@")[0];
      notify(email, "node", `你已被移出「${node.step}」节点的执行角色`, {
        body: `操作人：${user.name?.trim() || user.email}`,
        refType: "node",
        refId: node.id,
      });
      const fresh = loadNodes().find((n) => n.id === node.id) ?? next;
      sendJson(res, 200, { ok: true, removed: name, node: toNodeView(user, fresh) });
      return;
    }

    // 目录浏览：只列目标仓库白名单根下的子目录（供输出目录选择弹窗）
    if (path === "/api/fs" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const rel = u.searchParams.get("path") ?? "";
      const abs = safeRepoPath(repo, rel);
      if (!abs) {
        sendJson(res, 403, { error: "路径越权：只能浏览目标仓库内的目录" });
        return;
      }
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(abs);
      } catch {
        sendJson(res, 400, { error: "目录不存在" });
        return;
      }
      if (!stat.isDirectory()) {
        sendJson(res, 400, { error: "该路径不是目录" });
        return;
      }
      const dirs = readdirSync(abs, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
        .map((d) => ({ name: d.name, path: relative(repo, join(abs, d.name)).replace(/\\/g, "/") }))
        .sort((a, b) => a.name.localeCompare(b.name));
      sendJson(res, 200, { path: rel.replace(/\\/g, "/") || ".", dirs });
      return;
    }

    // 新建子目录（目录选择弹窗内「新建文件夹」）
    if (path === "/api/fs/mkdir" && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      let base = "";
      let name = "";
      try {
        const body = JSON.parse(await readBody(req)) as { path?: unknown; name?: unknown };
        if (typeof body.path === "string") base = body.path;
        if (typeof body.name === "string") name = body.name;
      } catch {
        /* fallthrough 按空处理 */
      }
      const safeName = sanitizeFilename(name);
      if (!safeName || safeName === "file") {
        sendJson(res, 400, { error: "目录名不合法" });
        return;
      }
      const abs = safeRepoPath(repo, join(base || ".", safeName));
      if (!abs) {
        sendJson(res, 403, { error: "路径越权：只能在目标仓库内新建目录" });
        return;
      }
      mkdirSync(abs, { recursive: true });
      sendJson(res, 200, { ok: true, path: relative(repo, abs).replace(/\\/g, "/") });
      return;
    }

    // 产物下载：按节点 id + 产物名精确匹配（禁止穿越）
    const dm = path.match(/^\/api\/artifacts\/([^/\\]+)\/([^/\\]+)$/);
    if (dm && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const node = loadNodes().find((n) => n.id === dm[1]);
      const artifact = node?.artifacts?.find((a) => a.name === dm[2]);
      if (!node || !artifact) {
        sendJson(res, 404, { error: "产物不存在" });
        return;
      }
      const abs = safeRepoPath(repo, artifact.path);
      if (!abs || !existsSync(abs)) {
        sendJson(res, 404, { error: "产物文件不存在" });
        return;
      }
      const isZip = /\.zip$/i.test(artifact.name);
      res.setHeader("Content-Type", isZip ? "application/zip" : "text/markdown; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(artifact.name)}"`
      );
      res.end(readFileSync(abs));
      return;
    }

    // 工单页（bug 单；未登录重定向到登录页）
    if (path === "/tickets" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        res.statusCode = 302;
        res.setHeader("Location", "/login");
        res.end();
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(ticketsHtml(user));
      return;
    }

    // AI 对话页（未登录重定向到登录页）
    if (path === "/chat" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        res.statusCode = 302;
        res.setHeader("Location", "/login");
        res.end();
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(chatHtml(user));
      return;
    }

    // 消息页（未登录重定向到登录页）
    if (path === "/messages" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        res.statusCode = 302;
        res.setHeader("Location", "/login");
        res.end();
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(messagesHtml(user));
      return;
    }

    // 未读数（顶栏铃铛红点轮询；只读本人）
    if (path === "/api/messages/unread" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      sendJson(res, 200, { unread: unreadMessageCount(user.email) });
      return;
    }

    // 消息列表（本人视角，时间倒序）
    if (path === "/api/messages" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const list = myMessages(user.email);
      sendJson(res, 200, { messages: list, unread: list.filter((m) => !m.read).length });
      return;
    }

    // 全部标记已读（只影响本人）
    if (path === "/api/messages/read-all" && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const n = markAllMessagesRead(user.email);
      sendJson(res, 200, { ok: true, marked: n });
      return;
    }

    // 标记单条已读（仅收件人本人）
    const mrm = path.match(/^\/api\/messages\/([^/\\]+)\/read$/);
    if (mrm && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const ok = markMessageRead(mrm[1], user.email);
      sendJson(res, 200, { ok, unread: unreadMessageCount(user.email) });
      return;
    }

    // 工单列表：按视角过滤（主管全量 / 员工本部门），按更新时间倒序
    if (path === "/api/tickets" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const names = userNameMap();
      const nameOf = (e: string) => names.get(e) ?? e;
      const list = filterTicketsByUser(loadTickets(), user)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((t) => toTicketListItem(t, nameOf));
      sendJson(res, 200, { tickets: list, user: toUserView(user) });
      return;
    }

    // 新建工单：正文净化后落库，归属提交人部门（可见范围 = 本部门 + 主管）
    if (path === "/api/tickets" && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      let title = "";
      let rawContent: unknown = "";
      try {
        const body = JSON.parse(await readBody(req, 64 * 1024)) as {
          title?: unknown;
          content?: unknown;
        };
        if (typeof body.title === "string") title = body.title.trim();
        rawContent = body.content;
      } catch {
        sendJson(res, 400, { error: "请求体过大或不是合法 JSON" });
        return;
      }
      if (!title || title.length > TICKET_TITLE_MAX) {
        sendJson(res, 400, { error: `标题不能为空且不超过 ${TICKET_TITLE_MAX} 字` });
        return;
      }
      const content = normalizeRichField(rawContent);
      if (content === null) {
        sendJson(res, 400, { error: `正文过长（上限 ${TICKET_CONTENT_MAX} 字）` });
        return;
      }
      if (isEmptyRichHtml(content)) {
        sendJson(res, 400, { error: "正文不能为空" });
        return;
      }
      const now = new Date().toISOString();
      const record: TicketRecord = {
        id: `t-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
        kind: "bug",
        title,
        content,
        status: "open",
        department: user.department,
        authorName: user.name?.trim() || user.email.split("@")[0],
        authorEmail: user.email,
        createdAt: now,
        updatedAt: now,
        images: collectTicketImages(content),
        comments: [],
      };
      appendTicket(record);
      sendJson(res, 201, { ticket: toTicketView(record, user) });
      return;
    }

    // 工单图片上传（body 为 base64，服务端生成文件名后落 db/ticket-uploads/）
    if (path === "/api/tickets/upload" && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      let filename = "";
      let contentBase64 = "";
      try {
        const body = JSON.parse(await readBody(req, 6 * 1024 * 1024)) as {
          filename?: unknown;
          contentBase64?: unknown;
        };
        if (typeof body.filename === "string") filename = body.filename;
        if (typeof body.contentBase64 === "string") contentBase64 = body.contentBase64;
      } catch {
        sendJson(res, 400, { error: "图片过大（上限 6MB）或不是合法 JSON" });
        return;
      }
      const ext = filename.toLowerCase().split(".").pop() ?? "";
      if (!contentBase64 || !TICKET_IMAGE_TYPES[ext]) {
        sendJson(res, 400, { error: "仅支持 png / jpg / gif / webp 图片" });
        return;
      }
      const name = `${randomBytes(6).toString("hex")}.${ext}`;
      mkdirSync(TICKET_IMAGES_DIR, { recursive: true });
      writeFileSync(join(TICKET_IMAGES_DIR, name), Buffer.from(contentBase64, "base64"));
      sendJson(res, 200, { url: `/api/tickets/images/${name}` });
      return;
    }

    // 工单图片读取（文件名严格校验，天然免疫路径穿越）
    const im = path.match(/^\/api\/tickets\/images\/([^/\\]+)$/);
    if (im && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const name = im[1];
      if (!TICKET_IMAGE_NAME_RE.test(name)) {
        sendJson(res, 404, { error: "图片不存在" });
        return;
      }
      const abs = join(TICKET_IMAGES_DIR, name);
      if (!existsSync(abs)) {
        sendJson(res, 404, { error: "图片不存在" });
        return;
      }
      const ext = name.split(".").pop() ?? "";
      res.setHeader("Content-Type", TICKET_IMAGE_TYPES[ext]);
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.end(readFileSync(abs));
      return;
    }

    // 改工单状态（本部门员工 / 主管）
    const tsm = path.match(/^\/api\/tickets\/([^/\\]+)\/status$/);
    if (tsm && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const ticket = loadTickets().find((t) => t.id === tsm[1]);
      if (!ticket) {
        sendJson(res, 404, { error: "工单不存在" });
        return;
      }
      if (!canAccessTicket(user, ticket)) {
        sendJson(res, 403, { error: "仅本部门员工或部门主管可查看该工单" });
        return;
      }
      // 状态流转仅主管可操作（员工只能查看 / 评论）
      if (!canApprove(user)) {
        sendJson(res, 403, { error: "仅部门主管可切换工单状态" });
        return;
      }
      let next: unknown = "";
      try {
        const body = JSON.parse(await readBody(req)) as { status?: unknown };
        next = body.status;
      } catch {
        sendJson(res, 400, { error: "请求体不是合法 JSON" });
        return;
      }
      if (!isTicketStatus(next)) {
        sendJson(res, 400, { error: "状态取值非法" });
        return;
      }
      const updated = updateTicket(ticket.id, (t) => {
        t.status = next as TicketStatus;
        t.updatedAt = new Date().toISOString();
      });
      sendJson(res, 200, { ticket: toTicketView(updated as TicketRecord, user) });
      return;
    }

    // 指派工单负责人（仅主管；被指派者收到消息，绑定节点的工单同时把人挂进节点执行角色）
    const tas = path.match(/^\/api\/tickets\/([^/\\]+)\/assignee$/);
    if (tas && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const ticket = loadTickets().find((t) => t.id === tas[1]);
      if (!ticket) {
        sendJson(res, 404, { error: "工单不存在" });
        return;
      }
      if (!canAccessTicket(user, ticket)) {
        sendJson(res, 403, { error: "仅本部门员工或部门主管可查看该工单" });
        return;
      }
      if (!canApprove(user)) {
        sendJson(res, 403, { error: "仅部门主管可指派负责人" });
        return;
      }
      let email = "";
      try {
        const body = JSON.parse(await readBody(req)) as { email?: unknown };
        if (typeof body.email === "string") email = body.email.trim();
      } catch {
        sendJson(res, 400, { error: "请求体不是合法 JSON" });
        return;
      }
      if (email && !loadUsers().some((u) => u.email === email)) {
        sendJson(res, 404, { error: "员工不存在" });
        return;
      }
      const now = new Date().toISOString();
      const updated = updateTicket(ticket.id, (t) => {
        t.assigneeEmail = email || undefined;
        t.updatedAt = now;
      });
      if (!updated) {
        sendJson(res, 404, { error: "工单不存在" });
        return;
      }
      if (email && email !== user.email) {
        notify(email, "ticket_assign", `你被指派为工单「${ticket.title}」的负责人`, {
          body: `指派：${user.name?.trim() || user.email}（${ticket.department}）`,
          refType: "ticket",
          refId: ticket.id,
        });
      }
      // 工单挂在管线上：负责人自动挂进该节点的执行角色
      if (email && ticket.nodeId) {
        const node = loadNodes().find((n) => n.id === ticket.nodeId);
        if (node) addNodeExecutor(node, email);
      }
      sendJson(res, 200, { ticket: toTicketView(updated, user) });
      return;
    }

    // 新增工单评论（本部门员工 / 主管）
    const tcm = path.match(/^\/api\/tickets\/([^/\\]+)\/comments$/);
    if (tcm && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const ticket = loadTickets().find((t) => t.id === tcm[1]);
      if (!ticket) {
        sendJson(res, 404, { error: "工单不存在" });
        return;
      }
      if (!canAccessTicket(user, ticket)) {
        sendJson(res, 403, { error: "仅本部门员工或部门主管可评论该工单" });
        return;
      }
      let rawContent: unknown = "";
      try {
        const body = JSON.parse(await readBody(req, 64 * 1024)) as { content?: unknown };
        rawContent = body.content;
      } catch {
        sendJson(res, 400, { error: "请求体过大或不是合法 JSON" });
        return;
      }
      const content = normalizeRichField(rawContent);
      if (content === null || isEmptyRichHtml(content)) {
        sendJson(res, 400, { error: "评论内容不能为空或过长" });
        return;
      }
      const comment: TicketComment = {
        id: `c-${randomBytes(4).toString("hex")}`,
        author: user.name?.trim() || user.email.split("@")[0],
        email: user.email,
        department: user.department,
        content,
        at: new Date().toISOString(),
      };
      const updated = updateTicket(ticket.id, (t) => {
        t.comments = [...(t.comments ?? []), comment];
        t.updatedAt = comment.at;
      });
      sendJson(res, 201, { ticket: toTicketView(updated as TicketRecord, user) });
      return;
    }

    // 编辑工单（仅提交人自己可编辑标题和正文，同步更新时间）
    const tem = path.match(/^\/api\/tickets\/([^/\\]+)$/);
    if (tem && req.method === "PUT") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const ticket = loadTickets().find((t) => t.id === tem[1]);
      if (!ticket) {
        sendJson(res, 404, { error: "工单不存在" });
        return;
      }
      if (!canAccessTicket(user, ticket)) {
        sendJson(res, 403, { error: "仅本部门员工或部门主管可查看该工单" });
        return;
      }
      if (ticket.authorEmail !== user.email) {
        sendJson(res, 403, { error: "仅提交人可编辑工单" });
        return;
      }
      let title = "";
      let rawContent: unknown = "";
      try {
        const body = JSON.parse(await readBody(req, 64 * 1024)) as {
          title?: unknown;
          content?: unknown;
        };
        if (typeof body.title === "string") title = body.title.trim();
        rawContent = body.content;
      } catch {
        sendJson(res, 400, { error: "请求体过大或不是合法 JSON" });
        return;
      }
      if (!title || title.length > TICKET_TITLE_MAX) {
        sendJson(res, 400, { error: `标题不能为空且不超过 ${TICKET_TITLE_MAX} 字` });
        return;
      }
      const content = normalizeRichField(rawContent);
      if (content === null) {
        sendJson(res, 400, { error: `正文过长（上限 ${TICKET_CONTENT_MAX} 字）` });
        return;
      }
      if (isEmptyRichHtml(content)) {
        sendJson(res, 400, { error: "正文不能为空" });
        return;
      }
      const now = new Date().toISOString();
      const updated = updateTicket(ticket.id, (t) => {
        t.title = title;
        t.content = content;
        t.images = collectTicketImages(content);
        t.updatedAt = now;
      });
      sendJson(res, 200, { ticket: toTicketView(updated as TicketRecord, user) });
      return;
    }

    // 工单详情（本部门员工 / 主管）
    const tdm = path.match(/^\/api\/tickets\/([^/\\]+)$/);
    if (tdm && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const ticket = loadTickets().find((t) => t.id === tdm[1]);
      if (!ticket) {
        sendJson(res, 404, { error: "工单不存在" });
        return;
      }
      if (!canAccessTicket(user, ticket)) {
        sendJson(res, 403, { error: "仅本部门员工或部门主管可查看该工单" });
        return;
      }
      sendJson(res, 200, { ticket: toTicketView(ticket, user) });
      return;
    }

    // ============ AI 对话 API ============

    // 会话列表：按 ownerEmail 私有过滤，按 updatedAt 倒序，只返列表项（不含 messages 全量）
    if (path === "/api/chat/sessions" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const list = loadChats().sessions
        .filter((s) => s.ownerEmail === user.email)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt, messageCount: s.messages.length }));
      sendJson(res, 200, { sessions: list });
      return;
    }

    // 新建会话（空消息，标题用「新对话」）
    if (path === "/api/chat/sessions" && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const now = new Date().toISOString();
      const session: ChatSession = {
        id: randomUUID(),
        ownerEmail: user.email,
        title: "新对话",
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      appendChat(session);
      sendJson(res, 201, { session });
      return;
    }

    // 会话详情（含 messages 全量；仅 owner 可访问）
    const csm = path.match(/^\/api\/chat\/sessions\/([^/\\]+)$/);
    if (csm && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const session = loadChats().sessions.find((s) => s.id === csm[1]);
      if (!session) {
        sendJson(res, 404, { error: "会话不存在" });
        return;
      }
      if (session.ownerEmail !== user.email) {
        sendJson(res, 403, { error: "无权访问该会话" });
        return;
      }
      sendJson(res, 200, { session: { ...session, messages: session.messages.map(toChatMessageView) } });
      return;
    }

    // 删除会话（仅 owner）
    if (csm && req.method === "DELETE") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const session = loadChats().sessions.find((s) => s.id === csm[1]);
      if (!session) {
        sendJson(res, 404, { error: "会话不存在" });
        return;
      }
      if (session.ownerEmail !== user.email) {
        sendJson(res, 403, { error: "无权删除该会话" });
        return;
      }
      deleteChat(csm[1]);
      sendJson(res, 200, { ok: true });
      return;
    }

    // 重命名会话标题（仅 owner；不刷新 updatedAt，避免改个名就跳到列表顶部）
    if (csm && req.method === "PATCH") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const session = loadChats().sessions.find((s) => s.id === csm[1]);
      if (!session) {
        sendJson(res, 404, { error: "会话不存在" });
        return;
      }
      if (session.ownerEmail !== user.email) {
        sendJson(res, 403, { error: "无权修改该会话" });
        return;
      }
      let title = "";
      try {
        const body = JSON.parse(await readBody(req, 4 * 1024)) as { title?: unknown };
        if (typeof body.title === "string") title = body.title.trim().slice(0, CHAT_TITLE_MAX);
      } catch {
        sendJson(res, 400, { error: "请求体不是合法 JSON" });
        return;
      }
      if (!title) {
        sendJson(res, 400, { error: "标题不能为空" });
        return;
      }
      updateChat(session.id, (s) => {
        s.title = title;
      });
      sendJson(res, 200, { ok: true, title });
      return;
    }

    // 对话附件上传（body 为 base64，服务端生成文件名后落 db/chat-uploads/）
    if (path === "/api/chat/upload" && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      let filename = "";
      let contentBase64 = "";
      try {
        const body = JSON.parse(await readBody(req, CHAT_UPLOAD_BODY_MAX)) as {
          filename?: unknown;
          contentBase64?: unknown;
        };
        if (typeof body.filename === "string") filename = body.filename;
        if (typeof body.contentBase64 === "string") contentBase64 = body.contentBase64;
      } catch {
        sendJson(res, 400, { error: "文件过大（上限 12MB）或不是合法 JSON" });
        return;
      }
      const ext = extOf(filename);
      const image = isImageName(filename);
      const text = isTextName(filename);
      if (!contentBase64 || (!image && !text)) {
        sendJson(res, 400, { error: "仅支持图片（png/jpg/gif/webp）与常见文本 / 代码类文件" });
        return;
      }
      const buf = Buffer.from(contentBase64, "base64");
      const name = `${randomBytes(6).toString("hex")}.${ext}`;
      mkdirSync(CHAT_UPLOADS_DIR, { recursive: true });
      writeFileSync(join(CHAT_UPLOADS_DIR, name), buf);
      const attachment: ChatAttachment = {
        kind: image ? "image" : "file",
        file: name,
        name: cleanAttachmentName(filename),
        mime: image ? CHAT_IMAGE_TYPES[ext] : "text/plain; charset=utf-8",
        size: buf.length,
      };
      sendJson(res, 200, { attachment });
      return;
    }

    // 对话附件 / skill 产物读取（文件名严格校验，天然免疫路径穿越）
    const cfm = path.match(/^\/api\/chat\/files\/([^/\\]+)$/);
    if (cfm && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const name = cfm[1];
      if (!CHAT_FILE_NAME_RE.test(name)) {
        sendJson(res, 404, { error: "文件不存在" });
        return;
      }
      const abs = join(CHAT_UPLOADS_DIR, name);
      if (!existsSync(abs)) {
        sendJson(res, 404, { error: "文件不存在" });
        return;
      }
      res.setHeader("Content-Type", chatMimeOf(name));
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.end(readFileSync(abs));
      return;
    }

    // 可用 skill 列表（对话页「调用 Skill」选择器；只暴露目录名 + 展示名 + 描述）
    if (path === "/api/chat/skills" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      sendJson(res, 200, { skills: listSkills() });
      return;
    }

    // 发送消息（SSE 流式入口）：写入 user message → 调模型流式生成 → 写入 assistant message
    const cmm = path.match(/^\/api\/chat\/sessions\/([^/\\]+)\/messages$/);
    if (cmm && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const session = loadChats().sessions.find((s) => s.id === cmm[1]);
      if (!session) {
        sendJson(res, 404, { error: "会话不存在" });
        return;
      }
      if (session.ownerEmail !== user.email) {
        sendJson(res, 403, { error: "无权访问该会话" });
        return;
      }

      let content = "";
      let modelId = "";
      let skillDir = "";
      let attachments: ChatAttachment[] = [];
      let refs: ChatRef[] = [];
      try {
        const body = JSON.parse(await readBody(req, 256 * 1024)) as {
          content?: unknown;
          modelId?: unknown;
          skill?: unknown;
          attachments?: unknown;
          refs?: unknown;
        };
        if (typeof body.content === "string") content = body.content.trim();
        if (typeof body.modelId === "string") modelId = body.modelId;
        if (typeof body.skill === "string") skillDir = body.skill;
        attachments = normalizeAttachments(body.attachments);
        refs = normalizeRefs(body.refs);
      } catch {
        sendJson(res, 400, { error: "请求体过大或不是合法 JSON" });
        return;
      }
      if (!content && !attachments.length && !skillDir) {
        sendJson(res, 400, { error: "消息内容不能为空" });
        return;
      }

      // 确定模型：优先用前端传的 modelId，否则用激活模型
      const { models } = loadChatModels();
      let chatModel = modelId ? models.find((m) => m.id === modelId) : models.find((m) => m.isActive);
      if (!chatModel) chatModel = models[0];
      if (!chatModel) {
        sendJson(res, 500, { error: "没有可用的模型配置" });
        return;
      }

      const now = new Date().toISOString();
      const userMsg: ChatMessage = { id: randomUUID(), role: "user", content, at: now };
      if (attachments.length) userMsg.attachments = attachments;
      if (refs.length) userMsg.refs = refs;

      // 写入 user message（首条消息时更新会话标题）
      const updated = updateChat(session.id, (s) => {
        s.messages.push(userMsg);
        s.updatedAt = now;
        if (s.messages.filter((m) => m.role === "user").length === 1) {
          s.title = truncateTitle(content || attachments[0]?.name || "");
        }
      });
      if (!updated) {
        sendJson(res, 500, { error: "写入消息失败" });
        return;
      }

      const chatCfg = loadChatConfig();
      const modelCfg = chatModelToModelConfig(chatModel);
      // 引用会话内容作为上下文附在 system 之后（仅取本人会话）
      const refContext = buildRefContext(user.email, refs);
      const systemPrompt = refContext
        ? `${chatCfg.systemPrompt}\n\n以下是用户引用的其他会话内容，仅作上下文参考：\n${refContext}`
        : chatCfg.systemPrompt;

      // 设置 SSE 响应头（先回，记忆压缩可能耗时，前端能立即看到 thinking）
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`event: thinking\ndata: ${JSON.stringify({ status: "thinking", message: "AI 思考中…" })}\n\n`);

      const ac = new AbortController();
      req.on("close", () => ac.abort());

      // 历史记忆压缩：未纳入摘要的原文累计字数超 compressChars 时，
      // 合并旧摘要 + 新增原文调模型压缩为一段新摘要落库（滚动更新，失败不阻断对话）
      const prior = updated.messages.slice(0, -1);
      let memoryUpto = updated.summaryUpto ?? 0;
      let memory = updated.summary ?? "";
      if (countChars(prior.slice(memoryUpto)) > chatCfg.compressChars) {
        try {
          res.write(
            `event: thinking\ndata: ${JSON.stringify({ status: "thinking", message: "正在压缩历史记忆…" })}\n\n`
          );
          const summaryText = await callModelOnce(
            chatModelToModelConfig(chatModel),
            buildSummaryMessages(memory, historyToText(prior.slice(memoryUpto))),
            { maxTokens: 600, signal: ac.signal }
          );
          if (summaryText.trim()) {
            memory = summaryText.trim();
            memoryUpto = prior.length;
            updateChat(session.id, (s) => {
              s.summary = memory;
              s.summaryUpto = memoryUpto;
            });
          }
        } catch {
          // 压缩失败时沿用现有记忆，继续正常对话
        }
      }

      // 可用 skill 工具（同时用于校验前端显式指定的 skill）
      const skillTool = buildSkillTool();

      // 摘要已覆盖的历史不再送原文，只送【摘要 + 未压缩的近期原文】+ 当前 user 内容
      // 当前消息与带附件的历史都还原成多模态内容（图片 data URL + 文本附件正文）
      // 显式指定 skill 时给模型一条调用指令（只进 prompt，不落库，避免污染消息与标题）
      const skillHint = skillDir && skillTool?.skills.has(skillDir) ? `【请调用 Skill：${skillDir}】` : "";
      const userText = skillHint ? `${skillHint}\n${content}` : content;
      const { imageUrls, fileSections } = attachmentParts(attachments);
      const userContent = buildUserContent(userText, imageUrls, fileSections);
      const promptMessages = buildChatMessages(
        systemPrompt,
        prior.slice(memoryUpto),
        userContent,
        chatCfg.maxHistory,
        memory,
        renderHistoryMessage
      );

      // 工具调用循环：模型请求 invoke_skill 时执行 skill 并把产物回灌后续轮次（最多 CHAT_SKILL_ROUNDS 轮）
      const working = [...promptMessages];
      let fullContent = "";
      let totalTokens = 0;
      // 本轮 AI 调用过的 skill（含产出文件），随 assistant 消息一起落库，供消息流里的灰字提示与文件卡片使用
      const skillCalls: ChatSkillCall[] = [];
      try {
        for (let round = 0; round <= CHAT_SKILL_ROUNDS; round++) {
          let roundText = "";
          let toolCalls: ToolCall[] = [];
          for await (const chunk of callModelStream(modelCfg, working, {
            maxTokens: chatCfg.maxTokens,
            temperature: chatCfg.temperature,
            signal: ac.signal,
            tools: skillTool ? [skillTool.tool] : undefined,
          })) {
            if (chunk.type === "delta" && chunk.delta) {
              roundText += chunk.delta;
              fullContent += chunk.delta;
              res.write(`event: delta\ndata: ${JSON.stringify({ content: chunk.delta })}\n\n`);
            } else if (chunk.type === "usage" && chunk.usage) {
              totalTokens = chunk.usage.totalTokens;
              res.write(`event: usage\ndata: ${JSON.stringify({ totalTokens })}\n\n`);
            } else if (chunk.type === "tool_call" && chunk.toolCalls) {
              toolCalls = chunk.toolCalls;
            }
          }
          if (!toolCalls.length || !skillTool || round === CHAT_SKILL_ROUNDS) break;

          working.push({ role: "assistant", content: roundText || null, tool_calls: toolCalls });
          for (const call of toolCalls) {
            let resultText = "";
            if (call.function.name !== "invoke_skill") {
              resultText = `未知工具：${call.function.name}`;
            } else {
              let callDir = "";
              try {
                const args = JSON.parse(call.function.arguments || "{}") as { skill?: unknown; requirement?: unknown };
                callDir = String(args.skill ?? "");
                const info = skillTool.skills.get(callDir);
                if (!info) throw new Error(`未知 skill：${callDir}`);
                const requirement = String(args.requirement ?? "").trim() || content || "请依据上下文完成任务";
                const out = await executeChatSkill(callDir, info, requirement, (payload) =>
                  res.write(`event: skill\ndata: ${JSON.stringify(payload)}\n\n`)
                );
                resultText = out.text.slice(0, CHAT_SKILL_TEXT_LIMIT);
                const rec: ChatSkillCall = { skill: callDir, status: "ok" };
                if (out.files.length) rec.files = out.files;
                skillCalls.push(rec);
              } catch (err: any) {
                const msg = String(err?.message ?? err);
                res.write(`event: skill\ndata: ${JSON.stringify({ status: "error", skill: callDir, error: msg })}\n\n`);
                resultText = `Skill 执行失败：${msg}`;
                skillCalls.push({ skill: callDir || "未知 skill", status: "error", error: msg });
              }
            }
            working.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: resultText });
          }
        }
      } catch (err: any) {
        const aborted = err?.name === "AbortError" || String(err?.message ?? "").includes("aborted");
        if (!aborted) {
          res.write(`event: error\ndata: ${JSON.stringify({ error: String(err?.message ?? err) })}\n\n`);
        }
        res.end();
        return;
      }

      // 写入 assistant message
      const asstMsg: ChatMessage = {
        id: randomUUID(),
        role: "assistant",
        content: fullContent,
        at: new Date().toISOString(),
        modelId: chatModel.id,
        tokens: totalTokens,
      };
      if (skillCalls.length) asstMsg.skillCalls = skillCalls;
      updateChat(session.id, (s) => {
        s.messages.push(asstMsg);
        s.updatedAt = asstMsg.at;
      });

      res.write(`event: message_end\ndata: ${JSON.stringify({ messageId: asstMsg.id, tokenUsage: totalTokens })}\n\n`);
      res.end();
      return;
    }

    // 模型列表（不暴露 apiKeyEnv）
    if (path === "/api/chat/models" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const { activeId, models } = loadChatModels();
      sendJson(res, 200, { models: models.map(toChatModelView), activeModelId: activeId });
      return;
    }

    // 新增模型配置（仅主管）
    if (path === "/api/chat/models" && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      if (!canApprove(user)) {
        sendJson(res, 403, { error: "仅主管可新增模型配置" });
        return;
      }
      let name = "", provider = "", model = "", baseUrl = "", apiKeyEnv = "", category = "text";
      try {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
        if (typeof body.name === "string") name = body.name.trim();
        if (typeof body.provider === "string") provider = body.provider.trim();
        if (typeof body.model === "string") model = body.model.trim();
        if (typeof body.baseUrl === "string") baseUrl = body.baseUrl.trim();
        if (typeof body.apiKeyEnv === "string") apiKeyEnv = body.apiKeyEnv.trim();
        if (typeof body.category === "string") category = body.category.trim() || "text";
      } catch {
        sendJson(res, 400, { error: "请求体不是合法 JSON" });
        return;
      }
      if (!name || !provider || !model || !apiKeyEnv) {
        sendJson(res, 400, { error: "name / provider / model / apiKeyEnv 必填" });
        return;
      }
      const m: ChatModel = {
        id: randomUUID(),
        name,
        provider,
        model,
        baseUrl: baseUrl || PROVIDER_DEFAULT_ENDPOINTS[provider] || "",
        apiKeyEnv,
        category,
      };
      appendChatModel(m);
      sendJson(res, 201, { model: toChatModelView(m) });
      return;
    }

    // 更新模型配置（仅主管）
    const cmod = path.match(/^\/api\/chat\/models\/([^/\\]+)$/);
    if (cmod && req.method === "PUT") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      if (!canApprove(user)) {
        sendJson(res, 403, { error: "仅主管可修改模型配置" });
        return;
      }
      try {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
        const updated = updateChatModel(cmod[1], (m) => {
          if (typeof body.name === "string") m.name = body.name.trim();
          if (typeof body.provider === "string") m.provider = body.provider.trim();
          if (typeof body.model === "string") m.model = body.model.trim();
          if (typeof body.baseUrl === "string") m.baseUrl = body.baseUrl.trim();
          if (typeof body.apiKeyEnv === "string") m.apiKeyEnv = body.apiKeyEnv.trim();
          if (typeof body.category === "string") m.category = body.category.trim() || "text";
        });
        if (!updated) {
          sendJson(res, 404, { error: "模型配置不存在" });
          return;
        }
        sendJson(res, 200, { model: toChatModelView(updated) });
      } catch {
        sendJson(res, 400, { error: "请求体不是合法 JSON" });
      }
      return;
    }

    // 删除模型配置（仅主管）
    if (cmod && req.method === "DELETE") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      if (!canApprove(user)) {
        sendJson(res, 403, { error: "仅主管可删除模型配置" });
        return;
      }
      const ok = deleteChatModel(cmod[1]);
      if (!ok) {
        sendJson(res, 404, { error: "模型配置不存在" });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    // 切换激活模型（任何登录用户可调）
    const cma = path.match(/^\/api\/chat\/models\/([^/\\]+)\/activate$/);
    if (cma && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const target = setActiveModel(cma[1]);
      if (!target) {
        sendJson(res, 404, { error: "模型配置不存在" });
        return;
      }
      sendJson(res, 200, { model: toChatModelView(target) });
      return;
    }

    // 首页全局搜索：type=user（姓名/邮箱/职位/部门）| ticket（标题/提交人/正文，按视角过滤）| kb（暂空）
    if (path === "/api/search" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const type = u.searchParams.get("type") ?? "all";
      const q = (u.searchParams.get("q") ?? "").trim().toLowerCase();
      if (type === "kb") {
        sendJson(res, 200, { results: [] });
        return;
      }
      const userResults = () =>
        loadUsers()
          .filter(
            (x) =>
              !q ||
              [x.name, x.email, x.title, x.department].some((v) =>
                (v ?? "").toLowerCase().includes(q),
              ),
          )
          .slice(0, 50)
          .map((x) => ({
            _type: "user",
            email: x.email,
            name: x.name,
            title: x.title,
            department: x.department,
            role: x.role,
            avatar: x.avatar,
          }));
      const ticketResults = () =>
        filterTicketsByUser(loadTickets(), user)
          .filter(
            (t) =>
              !q ||
              [t.title, t.authorName, t.authorEmail, htmlToPlainText(t.content)].some((v) =>
                (v ?? "").toLowerCase().includes(q),
              ),
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 50)
          .map((t) => ({ ...toTicketListItem(t), _type: "ticket" }));
      if (type === "user") {
        sendJson(res, 200, { results: userResults() });
        return;
      }
      if (type === "ticket") {
        sendJson(res, 200, { results: ticketResults() });
        return;
      }
      if (type === "all") {
        // 混合：各取 30 条后按相关度/时间合并，总上限 60
        const us = userResults().slice(0, 30);
        const ts = ticketResults().slice(0, 30);
        // 简单合并：有搜索词时用户优先（精准匹配），无搜索词时工单按时间排前面
        const merged = q ? [...us, ...ts] : [...ts, ...us];
        sendJson(res, 200, { results: merged.slice(0, 60) });
        return;
      }
      sendJson(res, 400, { error: "未知的搜索类型" });
      return;
    }

    // 根路径：按登录态分流（登录后进首页）
    if (path === "/" && req.method === "GET") {
      res.statusCode = 302;
      res.setHeader("Location", currentUser(req) ? "/home" : "/login");
      res.end();
      return;
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("not found");
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => {
      const a = server.address();
      resolve(typeof a === "object" && a ? a.port : 0);
    });
  });

  return {
    server,
    port,
    host,
    url: `http://${host}:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
