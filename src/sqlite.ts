import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 平台数据目录 db/（src 与 dist 均位于仓库根下一级，向上取根） */
export const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db");

/** 主库文件 db/ai-flows.sqlite：账号 / 节点 / 配置（运行时生成，已 gitignore） */
export const DB_FILE = join(DB_DIR, "ai-flows.sqlite");

/** AI 对话与评审库 db/ai-chat-reviews.sqlite（由主连接 ATTACH 为 chat_reviews） */
export const CHAT_REVIEWS_DB_FILE = join(DB_DIR, "ai-chat-reviews.sqlite");

/** 工单库 db/ai-tickets.sqlite（由主连接 ATTACH 为 tickets） */
export const TICKETS_DB_FILE = join(DB_DIR, "ai-tickets.sqlite");

/** 子库在主连接中的 schema 名（SQL 里用它做表前缀跨库查询） */
export const CHAT_REVIEWS_SCHEMA = "chat_reviews";
export const TICKETS_SCHEMA = "tickets";

/** 主库 DDL：账号 / 管线节点 / 配置，以及两张账号投影表。
 *  ord 列保留数组原始顺序（JSON 时代靠数组下标，SQL 无序需显式列）。 */
const MAIN_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  ord            INTEGER NOT NULL,
  email          TEXT PRIMARY KEY,
  password       TEXT NOT NULL,
  role           TEXT NOT NULL,
  name           TEXT,
  title          TEXT,
  department     TEXT,
  github         TEXT,
  github_pending TEXT,
  avatar         TEXT,
  password_changed_at TEXT
);

/* 仓库登记表：仓库管理页登记的本机目录（path 为绝对路径）+ 可选 GitHub 链接。
   管线通过 repo_id 引用，多个管线可复用同一仓库。 */
CREATE TABLE IF NOT EXISTS repos (
  ord         INTEGER NOT NULL,
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL,
  github_url  TEXT,
  owner_email TEXT,
  created_at  TEXT NOT NULL
);

/* 管线表：每条管线独立（各自一套节点，节点通过 nodes.pipeline_id 归属）。
   repo_id 指向 repos.id，可空表示未绑定仓库。 */
CREATE TABLE IF NOT EXISTS pipelines (
  ord        INTEGER NOT NULL,
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  repo_id    TEXT,
  created_at TEXT NOT NULL
);

/* 管线节点：pipeline_id 归属某条管线（老库升级时统一挂到默认管线）。 */
CREATE TABLE IF NOT EXISTS nodes (
  ord              INTEGER NOT NULL,
  id               TEXT PRIMARY KEY,
  pipeline_id      TEXT,
  department       TEXT NOT NULL,
  step             TEXT NOT NULL,
  ready            INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL,
  runner           TEXT,
  requirement_text TEXT,
  uploads          TEXT,
  artifacts        TEXT,
  progress         INTEGER,
  progress_label   TEXT,
  rejection        TEXT,
  last_result      TEXT,
  report_url       TEXT,
  output_dir       TEXT,
  executors        TEXT,
  removed_executors TEXT
);

/* 节点按管线归属的索引放在 getDb() 里、补列之后建：
   老库的 nodes 表已存在（CREATE TABLE IF NOT EXISTS 不会加列），
   若在此处建索引会因缺 pipeline_id 列而报 no such column。 */

/* 账号投影表：以 users.email 为唯一来源同步（email 主键 + FK 级联），
   chat_accounts 供 AI 对话侧取姓名，review_accounts 额外带部门供评审侧取归属。
   users 行被整体替换（DELETE FROM users）时这两张表随外键级联清空，再由 db.ts 重新同步。
   两张投影表留在主库，子库（chat_reviews）与用户表的主外键关系无法跨库，只能靠 email 逻辑关联。 */
CREATE TABLE IF NOT EXISTS chat_accounts (
  email TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_accounts (
  email      TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  department TEXT NOT NULL
);

/* 站内消息（顶栏消息铃铛 + 消息页）。按收件人邮箱私有可见；
   故意不加外键：users 行整体替换（saveUsers 先 DELETE 再插）会级联清空消息，
   收件人与账号的关联靠 email 逻辑匹配。 */
CREATE TABLE IF NOT EXISTS messages (
  ord      INTEGER NOT NULL,
  id       TEXT PRIMARY KEY,
  email    TEXT NOT NULL,
  type     TEXT NOT NULL,
  title    TEXT NOT NULL,
  body     TEXT,
  ref_type TEXT,
  ref_id   TEXT,
  read_at  TEXT,
  at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_email ON messages(email);

/* 知识库文章（类似工单但独立于管线节点，像内部文章）。
   可见范围 visibility：all=全体 / departments=指定部门（departments 存 JSON 数组）/ private=仅撰写人。
   故意不加外键：users 行整体替换（saveUsers 先 DELETE 再插）会级联清空文章，
   撰写人 / 更新人与账号的关联靠 email 逻辑匹配。 */
CREATE TABLE IF NOT EXISTS kb_articles (
  ord              INTEGER NOT NULL,
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  content          TEXT NOT NULL,
  author_email     TEXT NOT NULL,
  author_name      TEXT NOT NULL,
  visibility       TEXT NOT NULL,
  departments      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  updated_by_email TEXT,
  updated_by_name  TEXT
);

CREATE INDEX IF NOT EXISTS idx_kb_updated ON kb_articles(updated_at);

/* Token 用量明细（模型请求一次一条）。AI 日志会轮转（只留 500 行）不适合长期统计，
   故单独存表供 Token 面板按人/时段聚合。
   故意不加外键：users 行整体替换（saveUsers 先 DELETE 再插）会级联清空用量，
   归属人靠 email 逻辑匹配（外部触发无账号时 email 为空串）。 */
CREATE TABLE IF NOT EXISTS token_usage (
  ord               INTEGER NOT NULL,
  id                TEXT PRIMARY KEY,
  at                TEXT NOT NULL,
  email             TEXT,
  source            TEXT NOT NULL,
  model             TEXT NOT NULL,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_token_usage_at ON token_usage(at);
CREATE INDEX IF NOT EXISTS idx_token_usage_email ON token_usage(email);
`;

/** AI 对话与评审库 DDL：会话 / 消息 / 模型配置 / 评审记录。
 *  子表用 ON DELETE CASCADE，父行整体替换时子行随之清理。
 *  注意：REFERENCES 的父表名**不能**带 schema 前缀（SQLite 不允许 schema.table 作外键目标），
 *  省略后 SQLite 会自动绑定同库同名父表。 */
const CHAT_REVIEWS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS chat_reviews.chat_sessions (
  ord         INTEGER NOT NULL,
  id          TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  summary     TEXT,
  summary_upto INTEGER
);

CREATE TABLE IF NOT EXISTS chat_reviews.chat_messages (
  ord        INTEGER NOT NULL,
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  at         TEXT NOT NULL,
  model_id   TEXT,
  tokens     INTEGER,
  attachments TEXT,
  refs        TEXT,
  skill_calls TEXT
);

CREATE TABLE IF NOT EXISTS chat_reviews.chat_models (
  ord         INTEGER NOT NULL,
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  api_key_env TEXT NOT NULL,
  is_active   INTEGER,
  category    TEXT
);

CREATE TABLE IF NOT EXISTS chat_reviews.reviews (
  ord          INTEGER NOT NULL,
  id           TEXT PRIMARY KEY,
  source       TEXT NOT NULL,
  actor        TEXT NOT NULL,
  email        TEXT NOT NULL,
  department   TEXT NOT NULL,
  role         TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  passed       INTEGER NOT NULL DEFAULT 0,
  blockers     INTEGER NOT NULL DEFAULT 0,
  issues       INTEGER NOT NULL DEFAULT 0,
  report_url   TEXT NOT NULL DEFAULT '',
  repo         TEXT
);

CREATE INDEX IF NOT EXISTS chat_reviews.idx_reviews_department ON reviews(department);
CREATE INDEX IF NOT EXISTS chat_reviews.idx_chat_messages_session ON chat_messages(session_id);
`;

/** 工单库 DDL：工单 + 评论（评论同库内级联，REFERENCES 同样不带 schema 前缀）。 */
const TICKETS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tickets.tickets (
  ord            INTEGER NOT NULL,
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  status         TEXT NOT NULL,
  department     TEXT NOT NULL,
  author_name    TEXT NOT NULL,
  author_email   TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  images         TEXT,
  node_id        TEXT,
  assignee_email TEXT
);

CREATE TABLE IF NOT EXISTS tickets.ticket_comments (
  ord        INTEGER NOT NULL,
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  email      TEXT NOT NULL,
  department TEXT NOT NULL,
  content    TEXT NOT NULL,
  at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tickets.idx_ticket_comments_ticket ON ticket_comments(ticket_id);
`;

/** 拆库前遗留表（原先都在主库）：迁移时按此表搬到对应子库，随后从主库删除 */
const LEGACY_MOVES: { schema: string; table: string }[] = [
  { schema: CHAT_REVIEWS_SCHEMA, table: "chat_sessions" },
  { schema: CHAT_REVIEWS_SCHEMA, table: "chat_models" },
  { schema: CHAT_REVIEWS_SCHEMA, table: "reviews" },
  { schema: CHAT_REVIEWS_SCHEMA, table: "chat_messages" },
  { schema: TICKETS_SCHEMA, table: "tickets" },
  { schema: TICKETS_SCHEMA, table: "ticket_comments" },
];

let conn: Database.Database | null = null;

/** 单库拆多库的一次性迁移：把主库里遗留的子库表整表搬到 ATTACH 的子库，再删掉遗留表。
 *  幂等：主库里没有该表时直接跳过；搬运用 OR REPLACE 兜底重复执行。 */
function migrateLegacyTables(c: Database.Database): void {
  const colsOf = (schema: string, table: string): string[] =>
    (c.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as { name: string }[]).map(
      (x) => x.name
    );
  const hasLegacy = (table: string): boolean =>
    !!c.prepare("SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = ?").get(table);

  const pending = LEGACY_MOVES.filter((m) => hasLegacy(m.table));
  if (!pending.length) return;

  // 迁移期间关外键：旧库可能有孤儿子行，且搬运顺序不保证父子先后
  c.pragma("foreign_keys = OFF");
  try {
    for (const m of pending) {
      const target = colsOf(m.schema, m.table);
      // 旧表可能缺列（如老版 tickets 无 node_id），取两边交集按显式列名搬运
      const cols = colsOf("main", m.table).filter((n) => target.includes(n));
      if (!cols.length) continue;
      const list = cols.join(",");
      c.exec(
        `INSERT OR REPLACE INTO ${m.schema}.${m.table} (${list}) SELECT ${list} FROM main.${m.table}`
      );
    }
    // 子表在前，逐张删掉遗留表（随表索引一并清除）
    for (const m of [...pending].reverse()) c.exec(`DROP TABLE IF EXISTS main.${m.table}`);
  } finally {
    c.pragma("foreign_keys = ON");
  }
}

/** 挂载子库（幂等：已挂载则跳过）。路径里的单引号转义成 SQL 字面量。 */
function attach(c: Database.Database, file: string, schema: string): void {
  const loaded = c.prepare("PRAGMA database_list").all() as { name: string }[];
  if (loaded.some((d) => d.name === schema)) return;
  c.exec(`ATTACH DATABASE '${file.replace(/'/g, "''")}' AS ${schema}`);
  // 每个库单独开 WAL：读写并发更友好
  c.pragma(`${schema}.journal_mode = WAL`);
}

/** 幂等补列：CREATE TABLE IF NOT EXISTS 不会给已存在的表加列，老库升级靠这里补 */
function ensureColumn(
  c: Database.Database,
  schema: string,
  table: string,
  column: string,
  ddl: string
): void {
  const cols = c.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as { name: string }[];
  if (!cols.some((x) => x.name === column)) {
    c.exec(`ALTER TABLE ${schema}.${table} ADD COLUMN ${ddl}`);
  }
}

/** 取全局唯一 SQLite 连接（首次调用建目录、开主库、ATTACH 两个子库、开 WAL、建表） */
export function getDb(): Database.Database {
  if (conn) return conn;
  mkdirSync(DB_DIR, { recursive: true });
  const c = new Database(DB_FILE);
  // WAL：读写并发更友好；外键：让子表级联删除生效（同一库内的 FK 才有效）
  c.pragma("journal_mode = WAL");
  c.pragma("foreign_keys = ON");
  attach(c, CHAT_REVIEWS_DB_FILE, CHAT_REVIEWS_SCHEMA);
  attach(c, TICKETS_DB_FILE, TICKETS_SCHEMA);
  c.exec(MAIN_SCHEMA_SQL);
  c.exec(CHAT_REVIEWS_SCHEMA_SQL);
  c.exec(TICKETS_SCHEMA_SQL);
  // 老库补列（工单关联管线节点 / 指派给员工）
  ensureColumn(c, TICKETS_SCHEMA, "tickets", "node_id", "node_id TEXT");
  ensureColumn(c, TICKETS_SCHEMA, "tickets", "assignee_email", "assignee_email TEXT");
  // 老库补列（账号密码上次修改时间，用于 10 天有效期提醒）
  ensureColumn(c, "main", "users", "password_changed_at", "password_changed_at TEXT");
  // 老库补列（节点执行角色：显式添加名单 / 显式排除名单）
  ensureColumn(c, "main", "nodes", "executors", "executors TEXT");
  ensureColumn(c, "main", "nodes", "removed_executors", "removed_executors TEXT");
  // 老库补列（节点归属管线；老节点留空，由 db.ts 启动时挂到默认管线）
  ensureColumn(c, "main", "nodes", "pipeline_id", "pipeline_id TEXT");
  // 补列之后再建索引（见上方注释：老库缺列时不能先建）
  c.exec("CREATE INDEX IF NOT EXISTS idx_nodes_pipeline ON nodes(pipeline_id)");
  // 老库补列（对话消息的附件元数据 / 引用会话）
  ensureColumn(c, CHAT_REVIEWS_SCHEMA, "chat_messages", "attachments", "attachments TEXT");
  ensureColumn(c, CHAT_REVIEWS_SCHEMA, "chat_messages", "refs", "refs TEXT");
  // 老库补列（消息内 AI 调用 skill 的记录：灰字提示与产出文件）
  ensureColumn(c, CHAT_REVIEWS_SCHEMA, "chat_messages", "skill_calls", "skill_calls TEXT");
  // 单库升级为多库：把主库里遗留的子库表搬到 ATTACH 的子库
  migrateLegacyTables(c);
  conn = c;
  return conn;
}

/** 关闭连接（进程收尾 / 测试用）；ATTACH 的子库随主连接一起关闭 */
export function closeDb(): void {
  if (conn) {
    conn.close();
    conn = null;
  }
}