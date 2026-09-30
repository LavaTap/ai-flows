import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DB_DIR, getDb } from "./sqlite.js";
import { localIso } from "./log.js";

export { DB_DIR };

/** 工单图片上传目录 db/ticket-uploads/（已 gitignore，二进制不入库） */
export const TICKET_IMAGES_DIR = join(DB_DIR, "ticket-uploads");

/** 头像上传目录 db/avatars/（已 gitignore，二进制不入库） */
export const AVATARS_DIR = join(DB_DIR, "avatars");

/** AI 对话附件上传目录 db/chat-uploads/（已 gitignore，二进制不入库，消息只存元数据） */
export const CHAT_UPLOADS_DIR = join(DB_DIR, "chat-uploads");

/** 身份：员工 / 部门主管（主管权限最高，可操控并批准所有节点） */
export type Role = "staff" | "supervisor";

/** 平台账号（种子数据见 db/users.json，不开放注册） */
export interface UserAccount {
  /** 登录邮箱：名字拼音 + @ai-flows.com（虚拟后缀） */
  email: string;
  /** 演示环境统一 123456，明文存库（上线前改加盐哈希） */
  password: string;
  /** 身份：员工 / 部门主管 */
  role: Role;
  /** 岗位名，如 用户调研实习生 */
  title: string;
  /** 归属部门：用户研究部 / 程序中台 / 平台运营部（主管不限部门、权限最高） */
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

/** AI 对话账号投影（表 chat_accounts，email 主键并外键指向 users.email）。
 *  users 是唯一主表，本表只同步 email + name，供对话侧取展示名，不自持密码等敏感字段。 */
export interface ChatAccount {
  /** 账号邮箱（与 users.email 一致，也是与 chat_sessions.owner_email 的联通键） */
  email: string;
  /** 展示姓名（users.name，缺省回退邮箱前缀） */
  name: string;
}

/** 评审账号投影（表 review_accounts，email 主键并外键指向 users.email）。
 *  users 是唯一主表，本表同步 email + name + department，供评审侧按部门归属取信息。 */
export interface ReviewAccount {
  /** 账号邮箱（与 users.email 一致） */
  email: string;
  /** 展示姓名（users.name，缺省回退邮箱前缀） */
  name: string;
  /** 归属部门（users.department，缺省空串） */
  department: string;
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

/** 显式挂到节点的执行角色：邮箱 + 加入前的原部门（删除时回滚部门用） */
export interface NodeExecutor {
  /** 员工邮箱 */
  email: string;
  /** 加入节点部门之前的部门（主管删除该执行角色时回滚；缺省不回滚） */
  from?: string;
}

/** 管线节点（db 表 nodes，执行/批准会写回） */
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
  /** 显式挂到本节点的执行角色（主管「+」添加 / 工单负责人自动挂载） */
  executors?: NodeExecutor[];
  /** 显式从本节点执行角色中排除的邮箱（删除部门派生成员时记入） */
  removedExecutors?: string[];
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

/** 管线数据（表 settings.pipeline_name + 表 nodes） */
export interface PipelineData {
  /** 管线名称 */
  name?: string;
  /** 管线节点列表 */
  nodes: NodeState[];
}

/** 工单状态：待处理 / 处理中 / 已解决（三态可互相流转） */
export type TicketStatus = "open" | "doing" | "resolved";

/** 工单类型：bug=手动新建；requirement=管线节点自动生成（节点需求工单 / 指派给执行人的工单） */
export type TicketKind = "bug" | "requirement";

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

/** 工单（表 tickets + 子表 ticket_comments）。department 决定可见范围：本部门员工 + 主管 */
export interface TicketRecord {
  /** 工单 id（t- 前缀 + 时间戳 + 随机串） */
  id: string;
  /** 类型：bug（手动新建）/ requirement（节点自动生成） */
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
  /** 关联的管线节点 id（节点需求工单 / 指派工单才有） */
  nodeId?: string;
  /** 指派给的员工邮箱（把员工加入节点执行人时自动生成的工单才有） */
  assigneeEmail?: string;
}

/** 站内消息类型：工单指派 / 工单评论 / 工单提及 / 节点提醒 / 知识库 / 知识库提及 / 系统 */
export type MessageType = "ticket_assign" | "ticket_comment" | "ticket_mention" | "node" | "kb" | "kb_mention" | "system";

/** 站内消息（表 messages，主库）。按收件人邮箱私有可见，顶栏铃铛只读本人未读数 */
export interface PlatformMessage {
  /** 消息 id（m- 前缀 + 时间戳 + 随机串） */
  id: string;
  /** 收件人邮箱（私有可见性判据） */
  email: string;
  /** 消息类型 */
  type: MessageType;
  /** 标题（列表主文案） */
  title: string;
  /** 正文补充说明（可空） */
  body?: string;
  /** 关联对象类型：ticket=工单；kb=知识库文章；node=管线节点 */
  refType?: string;
  /** 关联对象 id（点击消息跳转用） */
  refId?: string;
  /** 已读时间（ISO；未读为空） */
  readAt?: string;
  /** ISO 创建时间 */
  at: string;
}

/** 知识库可见范围：all=全体可见 / departments=指定部门可见 / private=仅撰写人可见 */
export type KbVisibility = "all" | "departments" | "private";

/** 知识库文章（表 kb_articles，主库）。像内部文章，独立于工单与管线节点，无状态流转 */
export interface KbArticle {
  /** 文章 id（k- 前缀 + 时间戳 + 随机串） */
  id: string;
  /** 标题 */
  title: string;
  /** 正文（净化后的富文本 HTML） */
  content: string;
  /** 撰写人姓名 */
  authorName: string;
  /** 撰写人邮箱 */
  authorEmail: string;
  /** 可见范围 */
  visibility: KbVisibility;
  /** 可见部门（visibility=departments 时生效） */
  departments: string[];
  /** ISO 创建时间 */
  createdAt: string;
  /** ISO 最近更新时间 */
  updatedAt: string;
  /** 最近更新人姓名（新建时同撰写人） */
  updatedByName: string;
  /** 最近更新人邮箱 */
  updatedByEmail: string;
}

/** Token 用量明细（表 token_usage，主库）。一次模型请求记一条，供 Token 面板按人/时段聚合。
 *  与 AI 日志解耦：日志会轮转只留 500 行，用量需要长期累积。 */
export interface TokenUsageRecord {
  /** 明细 id（u- 前缀 + 时间戳 + 随机串） */
  id: string;
  /** 归属人邮箱（外部触发 / 无账号时为空串） */
  email: string;
  /** 来源：review 评审 / chat AI 对话 / skill 技能执行 */
  source: string;
  /** 模型名 */
  model: string;
  /** 提示 token 数 */
  promptTokens: number;
  /** 回复 token 数 */
  completionTokens: number;
  /** 总 token 数 */
  totalTokens: number;
  /** ISO 时间（本地时区） */
  at: string;
}

/** 聊天消息角色 */
export type ChatRole = "user" | "assistant";

/** 对话附件元数据（二进制落 db/chat-uploads/，消息里只存引用信息） */
export interface ChatAttachment {
  /** 类型：image=图片（多模态送模型）；file=文本类文件（读内容拼进 prompt） */
  kind: "image" | "file";
  /** 落盘文件名（db/chat-uploads/<file>，服务端生成） */
  file: string;
  /** 原始文件名（展示用） */
  name: string;
  /** MIME 类型 */
  mime: string;
  /** 字节数 */
  size: number;
}

/** 一次 AI 调用 skill 的记录（随消息落库，刷新后消息流里仍能看到灰字提示与产物） */
export interface ChatSkillCall {
  /** skill 目录名 */
  skill: string;
  /** 执行结果：ok=成功；error=失败 */
  status: "ok" | "error";
  /** 失败原因（status=error 时有值） */
  error?: string;
  /** 本次 skill 产出的文件（已复制到 db/chat-uploads/，可直接下载） */
  files?: ChatAttachment[];
}

/** 被引用的其他会话（作为上下文拼进 prompt） */
export interface ChatRef {
  /** 被引用会话 id */
  id: string;
  /** 被引用会话标题（展示用，冗余存一份防会话被删后无从展示） */
  title: string;
}

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
  /** 用户消息携带的附件（图片 / 文本类文件） */
  attachments?: ChatAttachment[];
  /** 用户消息引用的其他会话（作为上下文） */
  refs?: ChatRef[];
  /** 本消息内 AI 调用过的 skill（含产出文件）；assistant 消息有值 */
  skillCalls?: ChatSkillCall[];
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
  /** 历史记忆摘要：早期对话累计文本超阈值时由模型压缩生成，拼进后续 prompt 顶部 */
  summary?: string;
  /** 摘要已覆盖的历史消息条数（前 summaryUpto 条已被压缩，后续只送原文） */
  summaryUpto?: number;
  /** 消息列表（按时间正序） */
  messages: ChatMessage[];
}

/** 聊天库（表 chat_sessions + 子表 chat_messages） */
export interface ChatStore {
  sessions: ChatSession[];
}

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

/** 模型配置库（表 chat_models + settings.active_model_id） */
export interface ChatModelStore {
  /** 当前激活模型 id */
  activeId: string;
  /** 全部模型配置 */
  models: ChatModel[];
}

/** 种子模型：DeepSeek 默认配置（库中无模型时首次落盘） */
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

// ============ 连接与迁移 ============

let ready = false;

/** 取连接；首次调用顺带跑一次旧 JSON 导入 */
function db(): Database.Database {
  const c = getDb();
  if (!ready) {
    ready = true;
    importLegacyJson(c);
    // 每次进程启动同步一次账号投影表：覆盖「旧库已迁移过、新表还是空」的升级场景
    syncUserAccounts();
  }
  return c;
}

/** 旧 JSON 库一次性导入：仅当 settings.migrated_from_json 未置位时执行。
 *  把 db/*.json 的存量数据搬进 SQLite，此后 JSON 文件不再被读写。 */
function importLegacyJson(c: Database.Database): void {
  const done = c
    .prepare("SELECT value FROM settings WHERE key = 'migrated_from_json'")
    .get() as { value?: string } | undefined;
  if (done) return;

  const readJson = <T>(file: string): T | null => {
    try {
      return JSON.parse(readFileSync(join(DB_DIR, file), "utf8")) as T;
    } catch {
      // 旧库文件不存在 / 非法时按无数据处理，不阻断启动
      return null;
    }
  };

  const users = readJson<{ users?: UserAccount[] }>("users.json")?.users ?? [];
  const pipeline = readJson<{ name?: string; nodes?: NodeState[] }>("pipeline.json");
  const reviews = readJson<{ reviews?: ReviewRecord[] }>("reviews.json")?.reviews ?? [];
  const tickets = readJson<{ tickets?: TicketRecord[] }>("tickets.json")?.tickets ?? [];
  const chats = readJson<{ sessions?: ChatSession[] }>("chats.json")?.sessions ?? [];
  const models = readJson<ChatModelStore>("models.json");

  c.transaction(() => {
    if (users.length) {
      const ins = c.prepare(
        "INSERT OR REPLACE INTO users (ord,email,password,role,name,title,department,github,github_pending,avatar) VALUES (@ord,@email,@password,@role,@name,@title,@department,@github,@githubPending,@avatar)"
      );
      users.forEach((u, i) => ins.run(userParams(u, i)));
    }
    if (pipeline) {
      if (pipeline.name) {
        c.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pipeline_name', ?)").run(
          pipeline.name
        );
      }
      const nodes = pipeline.nodes ?? [];
      if (nodes.length) {
        const ins = c.prepare(
          "INSERT OR REPLACE INTO nodes (ord,id,department,step,ready,status,runner,requirement_text,uploads,artifacts,progress,progress_label,rejection,last_result,report_url,output_dir) VALUES (@ord,@id,@department,@step,@ready,@status,@runner,@requirementText,@uploads,@artifacts,@progress,@progressLabel,@rejection,@lastResult,@reportUrl,@outputDir)"
        );
        nodes.forEach((n, i) => ins.run(nodeParams(n, i)));
      }
    }
    if (reviews.length) insertReviews(c, reviews, 0);
    if (tickets.length) insertTickets(c, tickets, 0);
    if (chats.length) insertChats(c, chats, 0);
    if (models && models.models.length) {
      insertModels(c, models.models, 0);
      setSettingWith(c, "active_model_id", models.activeId);
    }
    setSettingWith(c, "migrated_from_json", "1");
  })();
}

// ============ 内部工具 ============

function getSettingWith(c: Database.Database, key: string): string | undefined {
  const row = c.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value?: string }
    | undefined;
  return row?.value;
}

function setSettingWith(c: Database.Database, key: string, value: string): void {
  c.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

/** 取某表下一个 ord（追加用；跨 schema 表需带前缀） */
function nextOrd(c: Database.Database, table: string): number {
  const row = c.prepare(`SELECT COALESCE(MAX(ord), -1) + 1 AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

/** 安全解析 JSON 数组列（空 / 非法一律按缺省处理） */
function parseJsonArray<T>(raw: string | null): T[] | undefined {
  if (raw == null) return undefined;
  try {
    const v = JSON.parse(raw) as T[];
    return Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

// ---- 行 → 对象映射（NULL 还原为「字段缺省」，与 JSON 时代语义一致） ----

interface UserRow {
  email: string;
  password: string;
  role: string;
  name: string | null;
  title: string | null;
  department: string | null;
  github: string | null;
  github_pending: string | null;
  avatar: string | null;
}

function rowToUser(r: UserRow): UserAccount {
  const u: UserAccount = {
    email: r.email,
    password: r.password,
    role: r.role as Role,
    title: r.title ?? "",
    department: r.department ?? "",
  };
  if (r.name != null) u.name = r.name;
  if (r.github != null) u.github = r.github;
  if (r.github_pending != null) u.githubPending = r.github_pending;
  if (r.avatar != null) u.avatar = r.avatar;
  return u;
}

interface NodeRow {
  id: string;
  department: string;
  step: string;
  ready: number;
  status: string;
  runner: string | null;
  requirement_text: string | null;
  uploads: string | null;
  artifacts: string | null;
  progress: number | null;
  progress_label: string | null;
  rejection: string | null;
  last_result: string | null;
  report_url: string | null;
  output_dir: string | null;
  executors: string | null;
  removed_executors: string | null;
}

function rowToNode(r: NodeRow): NodeState {
  const n: NodeState = {
    id: r.id,
    department: r.department,
    step: r.step,
    ready: r.ready === 1,
    status: r.status as NodeStatus,
  };
  if (r.runner != null) n.runner = r.runner;
  if (r.requirement_text != null) n.requirementText = r.requirement_text;
  const uploads = parseJsonArray<string>(r.uploads);
  if (uploads) n.uploads = uploads;
  const artifacts = parseJsonArray<NodeArtifact>(r.artifacts);
  if (artifacts) n.artifacts = artifacts;
  if (r.progress != null) n.progress = r.progress;
  if (r.progress_label != null) n.progressLabel = r.progress_label;
  if (r.rejection != null) n.rejection = r.rejection;
  if (r.last_result != null) n.lastResult = r.last_result;
  if (r.report_url != null) n.reportUrl = r.report_url;
  if (r.output_dir != null) n.outputDir = r.output_dir;
  const executors = parseJsonArray<NodeExecutor>(r.executors);
  if (executors) n.executors = executors;
  const removedExecutors = parseJsonArray<string>(r.removed_executors);
  if (removedExecutors) n.removedExecutors = removedExecutors;
  return n;
}

interface ReviewRow {
  id: string;
  source: string;
  actor: string;
  email: string;
  department: string;
  role: string;
  generated_at: string;
  passed: number;
  blockers: number;
  issues: number;
  report_url: string;
  repo: string | null;
}

function rowToReview(r: ReviewRow): ReviewRecord {
  const rec: ReviewRecord = {
    id: r.id,
    source: r.source as ReviewRecord["source"],
    actor: r.actor,
    email: r.email,
    department: r.department,
    role: r.role as Role,
    generatedAt: r.generated_at,
    passed: r.passed === 1,
    blockers: r.blockers,
    issues: r.issues,
    reportUrl: r.report_url,
  };
  if (r.repo != null) rec.repo = r.repo;
  return rec;
}

interface TicketRow {
  id: string;
  kind: string;
  title: string;
  content: string;
  status: string;
  department: string;
  author_name: string;
  author_email: string;
  created_at: string;
  updated_at: string;
  images: string | null;
  node_id: string | null;
  assignee_email: string | null;
}

interface CommentRow {
  id: string;
  ticket_id: string;
  author: string;
  email: string;
  department: string;
  content: string;
  at: string;
}

interface SysMessageRow {
  id: string;
  email: string;
  type: string;
  title: string;
  body: string | null;
  ref_type: string | null;
  ref_id: string | null;
  read_at: string | null;
  at: string;
}

function rowToSysMessage(r: SysMessageRow): PlatformMessage {
  const m: PlatformMessage = {
    id: r.id,
    email: r.email,
    type: r.type as MessageType,
    title: r.title,
    at: r.at,
  };
  if (r.body != null) m.body = r.body;
  if (r.ref_type != null) m.refType = r.ref_type;
  if (r.ref_id != null) m.refId = r.ref_id;
  if (r.read_at != null) m.readAt = r.read_at;
  return m;
}

function rowToComment(r: CommentRow): TicketComment {
  return {
    id: r.id,
    author: r.author,
    email: r.email,
    department: r.department,
    content: r.content,
    at: r.at,
  };
}

interface SessionRow {
  id: string;
  owner_email: string;
  title: string;
  created_at: string;
  updated_at: string;
  summary: string | null;
  summary_upto: number | null;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  at: string;
  model_id: string | null;
  tokens: number | null;
  attachments: string | null;
  refs: string | null;
  skill_calls: string | null;
}

function rowToMessage(r: MessageRow): ChatMessage {
  const m: ChatMessage = {
    id: r.id,
    role: r.role as ChatRole,
    content: r.content,
    at: r.at,
  };
  if (r.model_id != null) m.modelId = r.model_id;
  if (r.tokens != null) m.tokens = r.tokens;
  if (r.attachments) {
    try {
      m.attachments = JSON.parse(r.attachments) as ChatAttachment[];
    } catch {
      // 旧数据 / 非法 JSON 按无附件处理，不阻断读取
    }
  }
  if (r.refs) {
    try {
      m.refs = JSON.parse(r.refs) as ChatRef[];
    } catch {
      // 同上
    }
  }
  if (r.skill_calls) {
    try {
      m.skillCalls = JSON.parse(r.skill_calls) as ChatSkillCall[];
    } catch {
      // 同上
    }
  }
  return m;
}

interface ModelRow {
  id: string;
  name: string;
  provider: string;
  model: string;
  base_url: string;
  api_key_env: string;
  is_active: number | null;
  category: string | null;
}

function rowToModel(r: ModelRow): ChatModel {
  const m: ChatModel = {
    id: r.id,
    name: r.name,
    provider: r.provider,
    model: r.model,
    baseUrl: r.base_url,
    apiKeyEnv: r.api_key_env,
  };
  if (r.is_active != null) m.isActive = r.is_active === 1;
  if (r.category != null) m.category = r.category;
  return m;
}

// ---- 参数构造（undefined → null；boolean → 0/1，better-sqlite3 不接受 boolean） ----

function userParams(u: UserAccount, ord: number): Record<string, unknown> {
  return {
    ord,
    email: u.email,
    password: u.password,
    role: u.role,
    name: u.name ?? null,
    title: u.title,
    department: u.department,
    github: u.github ?? null,
    githubPending: u.githubPending ?? null,
    avatar: u.avatar ?? null,
  };
}

function nodeParams(n: NodeState, ord: number): Record<string, unknown> {
  return {
    ord,
    id: n.id,
    department: n.department,
    step: n.step,
    ready: n.ready ? 1 : 0,
    status: n.status,
    runner: n.runner ?? null,
    requirementText: n.requirementText ?? null,
    uploads: n.uploads ? JSON.stringify(n.uploads) : null,
    artifacts: n.artifacts ? JSON.stringify(n.artifacts) : null,
    progress: n.progress ?? null,
    progressLabel: n.progressLabel ?? null,
    rejection: n.rejection ?? null,
    lastResult: n.lastResult ?? null,
    reportUrl: n.reportUrl ?? null,
    outputDir: n.outputDir ?? null,
    executors: n.executors ? JSON.stringify(n.executors) : null,
    removedExecutors: n.removedExecutors ? JSON.stringify(n.removedExecutors) : null,
  };
}

function reviewParams(r: ReviewRecord, ord: number): Record<string, unknown> {
  return {
    ord,
    id: r.id,
    source: r.source,
    actor: r.actor,
    email: r.email,
    department: r.department,
    role: r.role,
    generatedAt: r.generatedAt,
    passed: r.passed ? 1 : 0,
    blockers: r.blockers,
    issues: r.issues,
    reportUrl: r.reportUrl,
    repo: r.repo ?? null,
  };
}

function ticketParams(t: TicketRecord, ord: number): Record<string, unknown> {
  return {
    ord,
    id: t.id,
    kind: t.kind,
    title: t.title,
    content: t.content,
    status: t.status,
    department: t.department,
    authorName: t.authorName,
    authorEmail: t.authorEmail,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    images: JSON.stringify(t.images ?? []),
    nodeId: t.nodeId ?? null,
    assigneeEmail: t.assigneeEmail ?? null,
  };
}

function commentParams(c: TicketComment, ticketId: string, ord: number): Record<string, unknown> {
  return {
    ord,
    id: c.id,
    ticketId,
    author: c.author,
    email: c.email,
    department: c.department,
    content: c.content,
    at: c.at,
  };
}

function sessionParams(s: ChatSession, ord: number): Record<string, unknown> {
  return {
    ord,
    id: s.id,
    ownerEmail: s.ownerEmail,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    summary: s.summary ?? null,
    summaryUpto: s.summaryUpto ?? 0,
  };
}

function messageParams(m: ChatMessage, sessionId: string, ord: number): Record<string, unknown> {
  return {
    ord,
    id: m.id,
    sessionId,
    role: m.role,
    content: m.content,
    at: m.at,
    modelId: m.modelId ?? null,
    tokens: m.tokens ?? null,
    attachments: m.attachments ? JSON.stringify(m.attachments) : null,
    refs: m.refs ? JSON.stringify(m.refs) : null,
    skillCalls: m.skillCalls ? JSON.stringify(m.skillCalls) : null,
  };
}

function modelParams(m: ChatModel, ord: number): Record<string, unknown> {
  return {
    ord,
    id: m.id,
    name: m.name,
    provider: m.provider,
    model: m.model,
    baseUrl: m.baseUrl,
    apiKeyEnv: m.apiKeyEnv,
    isActive: m.isActive === undefined ? null : m.isActive ? 1 : 0,
    category: m.category ?? null,
  };
}

// ---- 批量写入（父行整体替换，子行随级联清理后重建） ----

function insertReviews(c: Database.Database, records: ReviewRecord[], startOrd: number): void {
  const ins = c.prepare(
    "INSERT OR REPLACE INTO chat_reviews.reviews (ord,id,source,actor,email,department,role,generated_at,passed,blockers,issues,report_url,repo) VALUES (@ord,@id,@source,@actor,@email,@department,@role,@generatedAt,@passed,@blockers,@issues,@reportUrl,@repo)"
  );
  records.forEach((r, i) => ins.run(reviewParams(r, startOrd + i)));
}

function insertTickets(c: Database.Database, tickets: TicketRecord[], startOrd: number): void {
  const insT = c.prepare(
    "INSERT OR REPLACE INTO tickets.tickets (ord,id,kind,title,content,status,department,author_name,author_email,created_at,updated_at,images,node_id,assignee_email) VALUES (@ord,@id,@kind,@title,@content,@status,@department,@authorName,@authorEmail,@createdAt,@updatedAt,@images,@nodeId,@assigneeEmail)"
  );
  const insC = c.prepare(
    "INSERT OR REPLACE INTO tickets.ticket_comments (ord,id,ticket_id,author,email,department,content,at) VALUES (@ord,@id,@ticketId,@author,@email,@department,@content,@at)"
  );
  tickets.forEach((t, i) => {
    insT.run(ticketParams(t, startOrd + i));
    (t.comments ?? []).forEach((cm, j) => insC.run(commentParams(cm, t.id, j)));
  });
}

function insertChats(c: Database.Database, sessions: ChatSession[], startOrd: number): void {
  const insS = c.prepare(
    "INSERT OR REPLACE INTO chat_reviews.chat_sessions (ord,id,owner_email,title,created_at,updated_at,summary,summary_upto) VALUES (@ord,@id,@ownerEmail,@title,@createdAt,@updatedAt,@summary,@summaryUpto)"
  );
  const insM = c.prepare(
    "INSERT OR REPLACE INTO chat_reviews.chat_messages (ord,id,session_id,role,content,at,model_id,tokens,attachments,refs,skill_calls) VALUES (@ord,@id,@sessionId,@role,@content,@at,@modelId,@tokens,@attachments,@refs,@skillCalls)"
  );
  sessions.forEach((s, i) => {
    insS.run(sessionParams(s, startOrd + i));
    (s.messages ?? []).forEach((m, j) => insM.run(messageParams(m, s.id, j)));
  });
}

function insertModels(c: Database.Database, models: ChatModel[], startOrd: number): void {
  const ins = c.prepare(
    "INSERT OR REPLACE INTO chat_reviews.chat_models (ord,id,name,provider,model,base_url,api_key_env,is_active,category) VALUES (@ord,@id,@name,@provider,@model,@baseUrl,@apiKeyEnv,@isActive,@category)"
  );
  models.forEach((m, i) => ins.run(modelParams(m, startOrd + i)));
}

// ============ 账号 ============

/** 读取全部账号 */
export function loadUsers(): UserAccount[] {
  const rows = db().prepare("SELECT * FROM users ORDER BY ord").all() as UserRow[];
  return rows.map(rowToUser);
}

/** 保存全部账号（账号管理自助变更 GitHub 绑定后写回） */
export function saveUsers(users: UserAccount[]): void {
  const c = db();
  const del = c.prepare("DELETE FROM users");
  const ins = c.prepare(
    "INSERT INTO users (ord,email,password,role,name,title,department,github,github_pending,avatar) VALUES (@ord,@email,@password,@role,@name,@title,@department,@github,@githubPending,@avatar)"
  );
  c.transaction(() => {
    del.run();
    users.forEach((u, i) => ins.run(userParams(u, i)));
  })();
  // users 变更后立刻把账号信息同步到两张投影表，保证「其他表统一同步 users」
  syncUserAccounts();
}

/** 账号展示名：优先 users.name，缺省回退邮箱前缀（与角色卡片一致） */
function accountName(u: UserAccount): string {
  const name = (u.name ?? "").trim();
  return name || u.email.split("@")[0];
}

/** 从 users 主表重建两张账号投影表（chat_accounts / review_accounts）。
 *  整体清空后重写，保证与 users 完全一致；users 行被删时已由外键级联清理。 */
export function syncUserAccounts(): void {
  const c = db();
  const users = loadUsers();
  const delChat = c.prepare("DELETE FROM chat_accounts");
  const delReview = c.prepare("DELETE FROM review_accounts");
  const insChat = c.prepare("INSERT INTO chat_accounts (email,name) VALUES (@email,@name)");
  const insReview = c.prepare(
    "INSERT INTO review_accounts (email,name,department) VALUES (@email,@name,@department)"
  );
  c.transaction(() => {
    delChat.run();
    delReview.run();
    for (const u of users) {
      const name = accountName(u);
      insChat.run({ email: u.email, name });
      insReview.run({ email: u.email, name, department: u.department ?? "" });
    }
  })();
}

/** 读取 AI 对话账号投影表（按姓名排序） */
export function loadChatAccounts(): ChatAccount[] {
  const rows = db().prepare("SELECT email,name FROM chat_accounts ORDER BY name").all() as ChatAccount[];
  return rows;
}

/** 读取评审账号投影表（按邮箱排序） */
export function loadReviewAccounts(): ReviewAccount[] {
  const rows = db()
    .prepare("SELECT email,name,department FROM review_accounts ORDER BY email")
    .all() as ReviewAccount[];
  return rows;
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
  const c = db();
  const row = c.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  if (!row) return null;
  c.prepare("UPDATE users SET github = ? WHERE email = ?").run(github || null, email);
  return { ...rowToUser(row), github: github || undefined };
}

/** 员工提交 GitHub 绑定：写入待审核字段（覆盖旧的待审核值）；账号不存在返回 null */
export function setUserGithubPending(email: string, github: string): UserAccount | null {
  const c = db();
  const row = c.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  if (!row) return null;
  c.prepare("UPDATE users SET github_pending = ? WHERE email = ?").run(github, email);
  return { ...rowToUser(row), githubPending: github };
}

/** 清空某账号的待审核 GitHub 绑定（员工取消 / 主管驳回）；账号不存在返回 null */
export function clearUserGithubPending(email: string): UserAccount | null {
  const c = db();
  const row = c.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  if (!row) return null;
  c.prepare("UPDATE users SET github_pending = NULL WHERE email = ?").run(email);
  return rowToUser(row);
}

/** 主管批准：把待审核的 GitHub 转为已生效（无待审核绑定视为无效）；账号不存在返回 null */
export function approveUserGithub(email: string): UserAccount | null {
  const c = db();
  const row = c.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  if (!row || !row.github_pending) return null;
  c.prepare("UPDATE users SET github = ?, github_pending = NULL WHERE email = ?").run(
    row.github_pending,
    email
  );
  return { ...rowToUser(row), github: row.github_pending, githubPending: undefined };
}

/** 修改账号的姓名/部门/职位/头像（主管管理他人时调用）；只写传入的字段；账号不存在返回 null */
export function setUserProfile(
  email: string,
  patch: { name?: string; department?: string; title?: string; avatar?: string }
): UserAccount | null {
  const c = db();
  const row = c.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  if (!row) return null;
  const sets: string[] = [];
  const args: (string | null)[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    args.push(patch.name);
  }
  if (patch.department !== undefined) {
    sets.push("department = ?");
    args.push(patch.department);
  }
  if (patch.title !== undefined) {
    sets.push("title = ?");
    args.push(patch.title);
  }
  if (patch.avatar !== undefined) {
    sets.push("avatar = ?");
    args.push(patch.avatar || null);
  }
  if (sets.length) {
    args.push(email);
    c.prepare(`UPDATE users SET ${sets.join(", ")} WHERE email = ?`).run(...args);
    // 姓名 / 部门变更后同步投影表（saveUsers 之外的第二条 users 写入路径）
    syncUserAccounts();
  }
  return loadUsers().find((u) => u.email === email) ?? null;
}

/** 邮箱 + 密码校验，命中返回账号，否则 null */
export function authenticate(email: string, password: string): UserAccount | null {
  const target = email.trim().toLowerCase();
  const user = loadUsers().find((u) => u.email === target);
  if (!user || user.password !== password) return null;
  return user;
}

// ============ 管线 ============

/** 读取管线名称（缺省 "text-flow"） */
export function loadPipelineName(): string {
  return getSettingWith(db(), "pipeline_name") ?? "text-flow";
}

/** 写回管线名称 */
export function savePipelineName(name: string): void {
  setSettingWith(db(), "pipeline_name", name);
}

/** 读取全部管线节点（旧状态 approved 自动迁移为 done 并回写） */
export function loadNodes(): NodeState[] {
  const rows = db().prepare("SELECT * FROM nodes ORDER BY ord").all() as NodeRow[];
  const nodes = rows.map(rowToNode);
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
  const c = db();
  const del = c.prepare("DELETE FROM nodes");
  const ins = c.prepare(
    "INSERT INTO nodes (ord,id,department,step,ready,status,runner,requirement_text,uploads,artifacts,progress,progress_label,rejection,last_result,report_url,output_dir,executors,removed_executors) VALUES (@ord,@id,@department,@step,@ready,@status,@runner,@requirementText,@uploads,@artifacts,@progress,@progressLabel,@rejection,@lastResult,@reportUrl,@outputDir,@executors,@removedExecutors)"
  );
  c.transaction(() => {
    del.run();
    nodes.forEach((n, i) => ins.run(nodeParams(n, i)));
  })();
}

// ============ 评审记录 ============

/** 读取平台执行历史 */
export function loadReviews(): ReviewRecord[] {
  const rows = db().prepare("SELECT * FROM chat_reviews.reviews ORDER BY ord").all() as ReviewRow[];
  return rows.map(rowToReview);
}

/** 写回平台执行历史（追加一条并持久化） */
export function appendReview(record: ReviewRecord): void {
  const c = db();
  insertReviews(c, [record], nextOrd(c, "chat_reviews.reviews"));
}

/** 批量追加评审历史（单事务写入） */
export function appendReviews(newRecords: ReviewRecord[]): void {
  if (!newRecords.length) return;
  const c = db();
  const start = nextOrd(c, "chat_reviews.reviews");
  c.transaction(() => insertReviews(c, newRecords, start))();
}

// ============ 工单 ============

/** 读取全部工单（含评论，按原顺序） */
export function loadTickets(): TicketRecord[] {
  const c = db();
  const rows = c.prepare("SELECT * FROM tickets.tickets ORDER BY ord").all() as TicketRow[];
  const comments = c
    .prepare("SELECT * FROM tickets.ticket_comments ORDER BY ord")
    .all() as CommentRow[];
  const byTicket = new Map<string, TicketComment[]>();
  for (const cm of comments) {
    const list = byTicket.get(cm.ticket_id) ?? [];
    list.push(rowToComment(cm));
    byTicket.set(cm.ticket_id, list);
  }
  return rows.map((r) => {
    const images = parseJsonArray<string>(r.images) ?? [];
    return {
      id: r.id,
      kind: r.kind as TicketKind,
      title: r.title,
      content: r.content,
      status: r.status as TicketStatus,
      department: r.department,
      authorName: r.author_name,
      authorEmail: r.author_email,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      images,
      comments: byTicket.get(r.id) ?? [],
      nodeId: r.node_id ?? undefined,
      assigneeEmail: r.assignee_email ?? undefined,
    };
  });
}

/** 写回全部工单（父行整体替换，评论随级联清理后重建） */
export function saveTickets(tickets: TicketRecord[]): void {
  const c = db();
  c.transaction(() => {
    c.prepare("DELETE FROM tickets.tickets").run();
    insertTickets(c, tickets, 0);
  })();
}

/** 追加一条工单 */
export function appendTicket(record: TicketRecord): void {
  const c = db();
  insertTickets(c, [record], nextOrd(c, "tickets.tickets"));
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

/** 按 id 删除工单（评论随同库外键级联清理）；返回是否命中 */
export function deleteTicket(id: string): boolean {
  return db().prepare("DELETE FROM tickets.tickets WHERE id = ?").run(id).changes > 0;
}

// ============ 知识库文章 ============

interface KbRow {
  id: string;
  title: string;
  content: string;
  author_name: string;
  author_email: string;
  visibility: string;
  departments: string | null;
  created_at: string;
  updated_at: string;
  updated_by_name: string | null;
  updated_by_email: string | null;
}

function rowToKb(r: KbRow): KbArticle {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    authorName: r.author_name,
    authorEmail: r.author_email,
    visibility: r.visibility as KbVisibility,
    departments: parseJsonArray<string>(r.departments) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    updatedByName: r.updated_by_name ?? r.author_name,
    updatedByEmail: r.updated_by_email ?? r.author_email,
  };
}

function kbParams(a: KbArticle, ord: number): Record<string, unknown> {
  return {
    ord,
    id: a.id,
    title: a.title,
    content: a.content,
    authorName: a.authorName,
    authorEmail: a.authorEmail,
    visibility: a.visibility,
    departments: JSON.stringify(a.departments ?? []),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    updatedByName: a.updatedByName,
    updatedByEmail: a.updatedByEmail,
  };
}

const KB_INSERT_SQL =
  "INSERT OR REPLACE INTO kb_articles (ord,id,title,content,author_name,author_email,visibility,departments,created_at,updated_at,updated_by_name,updated_by_email) VALUES (@ord,@id,@title,@content,@authorName,@authorEmail,@visibility,@departments,@createdAt,@updatedAt,@updatedByName,@updatedByEmail)";

/** 读取全部知识库文章（按原顺序；调用方按可见范围过滤） */
export function loadKbArticles(): KbArticle[] {
  return (db().prepare("SELECT * FROM kb_articles ORDER BY ord").all() as KbRow[]).map(rowToKb);
}

/** 写回全部知识库文章（整体替换：先清后插） */
export function saveKbArticles(articles: KbArticle[]): void {
  const c = db();
  const ins = c.prepare(KB_INSERT_SQL);
  c.transaction(() => {
    c.prepare("DELETE FROM kb_articles").run();
    articles.forEach((a, i) => ins.run(kbParams(a, i)));
  })();
}

/** 追加一条知识库文章 */
export function appendKbArticle(article: KbArticle): void {
  const c = db();
  c.prepare(KB_INSERT_SQL).run(kbParams(article, nextOrd(c, "kb_articles")));
}

/** 按 id 更新知识库文章（mutate 回调内改字段，含最近更新人）；文章不存在返回 null */
export function updateKbArticle(id: string, mutate: (a: KbArticle) => void): KbArticle | null {
  const articles = loadKbArticles();
  const article = articles.find((a) => a.id === id);
  if (!article) return null;
  mutate(article);
  saveKbArticles(articles);
  return article;
}

/** 按 id 删除知识库文章；返回是否命中 */
export function deleteKbArticle(id: string): boolean {
  return db().prepare("DELETE FROM kb_articles WHERE id = ?").run(id).changes > 0;
}

// ============ 站内消息 ============

/** 读取全部站内消息（按原顺序；调用方按 email 过滤本人视角） */
export function loadPlatformMessages(): PlatformMessage[] {
  const c = db();
  return (c.prepare("SELECT * FROM messages ORDER BY ord").all() as SysMessageRow[]).map(
    rowToSysMessage
  );
}

/** 追加一条站内消息 */
export function appendPlatformMessage(msg: PlatformMessage): void {
  const c = db();
  c.prepare(
    "INSERT OR REPLACE INTO messages (ord,id,email,type,title,body,ref_type,ref_id,read_at,at) VALUES (@ord,@id,@email,@type,@title,@body,@refType,@refId,@readAt,@at)"
  ).run({
    ord: nextOrd(c, "messages"),
    id: msg.id,
    email: msg.email,
    type: msg.type,
    title: msg.title,
    body: msg.body ?? null,
    refType: msg.refType ?? null,
    refId: msg.refId ?? null,
    readAt: msg.readAt ?? null,
    at: msg.at,
  });
}

/** 标记一条消息已读（仅收件人本人可标记）；返回是否命中 */
export function markMessageRead(id: string, email: string): boolean {
  const c = db();
  const info = c
    .prepare("UPDATE messages SET read_at = ? WHERE id = ? AND email = ? AND read_at IS NULL")
    .run(new Date().toISOString(), id, email);
  return info.changes > 0;
}

/** 把本人全部未读消息标记已读；返回标记条数 */
export function markAllMessagesRead(email: string): number {
  const c = db();
  const info = c
    .prepare("UPDATE messages SET read_at = ? WHERE email = ? AND read_at IS NULL")
    .run(new Date().toISOString(), email);
  return info.changes;
}

// ============ AI 对话：会话 + 消息 ============

/** 读取全部聊天会话（含消息，按原顺序） */
export function loadChats(): ChatStore {
  const c = db();
  const rows = c.prepare("SELECT * FROM chat_reviews.chat_sessions ORDER BY ord").all() as SessionRow[];
  const messages = c.prepare("SELECT * FROM chat_reviews.chat_messages ORDER BY ord").all() as MessageRow[];
  const bySession = new Map<string, ChatMessage[]>();
  for (const m of messages) {
    const list = bySession.get(m.session_id) ?? [];
    list.push(rowToMessage(m));
    bySession.set(m.session_id, list);
  }
  return {
    sessions: rows.map((s) => {
      const session: ChatSession = {
        id: s.id,
        ownerEmail: s.owner_email,
        title: s.title,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        messages: bySession.get(s.id) ?? [],
      };
      if (s.summary != null) session.summary = s.summary;
      if (s.summary_upto != null) session.summaryUpto = s.summary_upto;
      return session;
    }),
  };
}

/** 写回全部聊天会话（父行整体替换，消息随级联清理后重建） */
export function saveChats(store: ChatStore): void {
  const c = db();
  c.transaction(() => {
    c.prepare("DELETE FROM chat_reviews.chat_sessions").run();
    insertChats(c, store.sessions, 0);
  })();
}

/** 追加一条会话 */
export function appendChat(session: ChatSession): void {
  const c = db();
  insertChats(c, [session], nextOrd(c, "chat_reviews.chat_sessions"));
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
  const c = db();
  const info = c.prepare("DELETE FROM chat_reviews.chat_sessions WHERE id = ?").run(id);
  return info.changes > 0;
}

// ============ AI 对话：模型配置 ============

/** 读取全部模型配置（库中无模型时返回种子 DeepSeek 配置并落库一次） */
export function loadChatModels(): ChatModelStore {
  const c = db();
  const rows = c.prepare("SELECT * FROM chat_reviews.chat_models ORDER BY ord").all() as ModelRow[];
  const models = rows.map(rowToModel);
  if (models.length === 0) {
    const store: ChatModelStore = { activeId: CHAT_MODEL_SEED.id, models: [CHAT_MODEL_SEED] };
    saveChatModels(store);
    return store;
  }
  const activeId =
    getSettingWith(c, "active_model_id") ?? models.find((m) => m.isActive)?.id ?? models[0].id;
  return { activeId, models };
}

/** 写回全部模型配置（父行整体替换 + 激活 id 落 settings） */
export function saveChatModels(store: ChatModelStore): void {
  const c = db();
  c.transaction(() => {
    c.prepare("DELETE FROM chat_reviews.chat_models").run();
    insertModels(c, store.models, 0);
    setSettingWith(c, "active_model_id", store.activeId);
  })();
}

/** 追加一条模型配置 */
export function appendChatModel(model: ChatModel): void {
  const c = db();
  insertModels(c, [model], nextOrd(c, "chat_reviews.chat_models"));
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
  const c = db();
  const info = c.prepare("DELETE FROM chat_reviews.chat_models WHERE id = ?").run(id);
  return info.changes > 0;
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

// ============ Token 用量 ============

interface TokenRow {
  id: string;
  email: string | null;
  source: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  at: string;
}

function rowToToken(r: TokenRow): TokenUsageRecord {
  return {
    id: r.id,
    email: r.email ?? "",
    source: r.source,
    model: r.model,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    totalTokens: r.total_tokens,
    at: r.at,
  };
}

/** 追加一条 token 用量明细 */
export function appendTokenUsage(rec: TokenUsageRecord): void {
  const c = db();
  c.prepare(
    "INSERT OR REPLACE INTO token_usage (ord,id,at,email,source,model,prompt_tokens,completion_tokens,total_tokens) VALUES (@ord,@id,@at,@email,@source,@model,@promptTokens,@completionTokens,@totalTokens)"
  ).run({
    ord: nextOrd(c, "token_usage"),
    id: rec.id,
    at: rec.at,
    email: rec.email || null,
    source: rec.source,
    model: rec.model,
    promptTokens: rec.promptTokens,
    completionTokens: rec.completionTokens,
    totalTokens: rec.totalTokens,
  });
}

/** 记一条 token 用量（自动补 id 与本地时间戳）；失败静默——用量统计不得影响主流程 */
export function recordTokenUsage(rec: Omit<TokenUsageRecord, "id" | "at">): void {
  try {
    appendTokenUsage({
      id: `u-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
      at: localIso(),
      ...rec,
    });
  } catch {
    /* 用量统计失败不影响业务 */
  }
}

/** 读取全部 token 用量明细（按写入顺序） */
export function loadTokenUsage(): TokenUsageRecord[] {
  const rows = db().prepare("SELECT * FROM token_usage ORDER BY ord").all() as TokenRow[];
  return rows.map(rowToToken);
}