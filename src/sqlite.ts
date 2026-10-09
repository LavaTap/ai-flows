import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 平台数据目录 db/（src 与 dist 均位于仓库根下一级，向上取根） */
export const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db");

/** 账号域主库 db/users.sqlite：账号 / 部门 / 两张投影表 / 站内消息 / Token 用量
 *  （原 db/ai-flows.sqlite 拆分而来，运行时生成，已 gitignore） */
export const USERS_DB_FILE = join(DB_DIR, "users.sqlite");

/** AI-Flows 域库 db/ai-flows.sqlite：配置 / 仓库 / 管线 / 节点（由主连接 ATTACH 为 ai_flows） */
export const AI_FLOWS_DB_FILE = join(DB_DIR, "ai-flows.sqlite");

/** 工单库 db/ai-tickets.sqlite（由主连接 ATTACH 为 tickets） */
export const TICKETS_DB_FILE = join(DB_DIR, "ai-tickets.sqlite");

/** 知识库 db/ai-kb.sqlite（由主连接 ATTACH 为 kb） */
export const KB_DB_FILE = join(DB_DIR, "ai-kb.sqlite");

/** AI 对话与评审库 db/ai-chat-reviews.sqlite（由主连接 ATTACH 为 chat_reviews） */
export const CHAT_REVIEWS_DB_FILE = join(DB_DIR, "ai-chat-reviews.sqlite");

/** 各子库在主连接中的 schema 名（SQL 里用它做表前缀跨库查询；主库 main 不加前缀） */
export const AI_FLOWS_SCHEMA = "ai_flows";
export const TICKETS_SCHEMA = "tickets";
export const KB_SCHEMA = "kb";
export const CHAT_REVIEWS_SCHEMA = "chat_reviews";

/** 内置种子部门（固定编号顺序：用户研究部→dept-01 / 程序中台→dept-02 / 平台运营部→dept-03） */
export const DEPARTMENT_SEED = ["用户研究部", "程序中台", "平台运营部"];

/** 账号域主库 DDL：部门 / 账号 / 投影表 / 站内消息 / Token 用量。
 *  ord 列保留数组原始顺序（JSON 时代靠数组下标，SQL 无序需显式列）。 */
const MAIN_SCHEMA_SQL = `
/* 部门表：全站唯一部门来源。所有含部门的表只存编号（id，形如 dept-01），
   展示时由 db.ts 统一解析成 name，从而部门改名无需改任何业务行。 */
CREATE TABLE IF NOT EXISTS departments (
  ord        INTEGER NOT NULL,
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
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

/* 账号投影表：以 users.email 为唯一来源同步（email 主键 + FK 级联），
   chat_accounts 供 AI 对话侧取姓名，review_accounts 额外带部门（存部门编号）供评审侧取归属。
   users 行被整体替换（DELETE FROM users）时这两张表随外键级联清空，再由 db.ts 重新同步。
   两张投影表留在主库；reviews 在 chat_reviews 子库，主外键关系无法跨库，只能靠 email 逻辑关联。 */
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

/** AI-Flows 域 DDL：配置 / 仓库 / 管线 / 节点（子库，表名须带 schema 前缀）。 */
const AI_FLOWS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ai_flows.settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

/* 仓库登记表：仓库管理页登记的本机目录（path 为绝对路径）+ 可选 GitHub 链接 + 登记人账号
   （owner_email，服务端从登录会话取）。管线通过 repo_id 引用，多个管线可复用同一仓库。 */
CREATE TABLE IF NOT EXISTS ai_flows.repos (
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
CREATE TABLE IF NOT EXISTS ai_flows.pipelines (
  ord        INTEGER NOT NULL,
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  repo_id    TEXT,
  created_at TEXT NOT NULL
);

/* 管线节点：pipeline_id 归属某条管线（老库升级时统一挂到默认管线）。
   department 存部门编号（departments.id）。 */
CREATE TABLE IF NOT EXISTS ai_flows.nodes (
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
`;

/** 工单库 DDL：工单 + 评论（评论同库内级联，REFERENCES 同样不带 schema 前缀）。
 *  department 存部门编号（departments.id）。 */
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

/** 知识库库 DDL：文章（类似工单但独立于管线节点）。
 *  可见范围 visibility：all=全体 / departments=指定部门（departments 存部门编号 JSON 数组）/ private=仅撰写人。
 *  故意不加外键：users 行整体替换（saveUsers 先 DELETE 再插）会级联清空文章，
 *  撰写人 / 更新人与账号的关联靠 email 逻辑匹配。 */
const KB_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS kb.kb_articles (
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

CREATE INDEX IF NOT EXISTS kb.idx_kb_updated ON kb_articles(updated_at);
`;

/** AI 对话与评审库 DDL：会话 / 消息 / 模型配置 / 评审记录。
 *  子表用 ON DELETE CASCADE，父行整体替换时子行随之清理。
 *  注意：REFERENCES 的父表名**不能**带 schema 前缀（SQLite 不允许 schema.table 作外键目标），
 *  省略后 SQLite 会自动绑定同库同名父表。
 *  reviews.department 存部门编号（departments.id）。 */
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

/** 账号域主库的表（改库布局时从旧主库搬进 users.sqlite） */
const MAIN_DOMAIN_TABLES = [
  "users",
  "chat_accounts",
  "review_accounts",
  "messages",
  "token_usage",
];

/** chat_reviews 子库的表（漏在别处的历史残留兜底搬运） */
const CHAT_REVIEWS_TABLES = ["chat_sessions", "chat_models", "reviews", "chat_messages"];

/** tickets 子库的表（漏在别处的历史残留兜底搬运） */
const TICKETS_TABLES = ["tickets", "ticket_comments"];

let conn: Database.Database | null = null;

/** 表是否存在 */
function hasTable(c: Database.Database, schema: string, table: string): boolean {
  return !!c
    .prepare(`SELECT 1 FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
}

/** 某 schema 下某表的列名 */
function tableCols(c: Database.Database, schema: string, table: string): string[] {
  return (
    c.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as { name: string }[]
  ).map((x) => x.name);
}

/** 把 fromSchema 下的整表搬到 toSchema（列取交集，OR REPLACE 幂等），成功后 DROP 源表。
 *  目标表须已由 DDL 建好；源表不存在时跳过。 */
function moveSchemaTable(
  c: Database.Database,
  fromSchema: string,
  toSchema: string,
  table: string
): void {
  if (!hasTable(c, fromSchema, table) || !hasTable(c, toSchema, table)) return;
  const target = tableCols(c, toSchema, table);
  const cols = tableCols(c, fromSchema, table).filter((n) => target.includes(n));
  if (!cols.length) return;
  const list = cols.join(",");
  c.exec(
    `INSERT OR REPLACE INTO ${toSchema}.${table} (${list}) SELECT ${list} FROM ${fromSchema}.${table}`
  );
  c.exec(`DROP TABLE IF EXISTS ${fromSchema}.${table}`);
}

/** 跨库布局迁移：老库 db/ai-flows.sqlite 作为「旧主库」时，把账号域表 / 知识库表 / 历史残留子库表
 *  搬去各自的库，只留 settings/repos/pipelines/nodes。以 ai_flows 里是否还有 users 表判定，幂等。 */
function migrateLegacyLayout(c: Database.Database): void {
  if (!hasTable(c, AI_FLOWS_SCHEMA, "users")) return;
  c.pragma("foreign_keys = OFF");
  try {
    for (const t of MAIN_DOMAIN_TABLES) moveSchemaTable(c, AI_FLOWS_SCHEMA, "main", t);
    moveSchemaTable(c, AI_FLOWS_SCHEMA, KB_SCHEMA, "kb_articles");
    for (const t of CHAT_REVIEWS_TABLES)
      if (hasTable(c, AI_FLOWS_SCHEMA, t)) moveSchemaTable(c, AI_FLOWS_SCHEMA, CHAT_REVIEWS_SCHEMA, t);
    for (const t of TICKETS_TABLES)
      if (hasTable(c, AI_FLOWS_SCHEMA, t)) moveSchemaTable(c, AI_FLOWS_SCHEMA, TICKETS_SCHEMA, t);
  } finally {
    c.pragma("foreign_keys = ON");
  }
}

/** 单库拆多库的历史残留兜底：main 里若还有子库表，整表搬到对应子库后 DROP。
 *  幂等：main 里没有该表时直接跳过。 */
function migrateLegacyTables(c: Database.Database): void {
  c.pragma("foreign_keys = OFF");
  try {
    for (const t of CHAT_REVIEWS_TABLES) moveSchemaTable(c, "main", CHAT_REVIEWS_SCHEMA, t);
    for (const t of TICKETS_TABLES) moveSchemaTable(c, "main", TICKETS_SCHEMA, t);
  } finally {
    c.pragma("foreign_keys = ON");
  }
}

/** 是否为「部门名」（非空、且不是 dept-NN 编号形态） */
function isDepartmentName(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && !/^dept-\d+$/.test(v);
}

/** 解析 JSON 字符串数组（坏数据返回空数组） */
function parseJsonArraySafe(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** 部门编号（dept-01 形态，>99 自然进位为三位） */
function departmentId(no: number): string {
  return `dept-${String(no).padStart(2, "0")}`;
}

/** 部门表中已用最大编号 */
function maxDepartmentNo(rows: { id: string }[]): number {
  return rows.reduce((m, r) => {
    const n = Number(String(r.id).replace(/^dept-/, ""));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
}

/** 收集所有含部门字段的表里出现过的部门名（编号形态忽略） */
function collectDepartmentNames(c: Database.Database): string[] {
  const out = new Set<string>();
  const scanCol = (schema: string, table: string, col: string): void => {
    if (!hasTable(c, schema, table) || !tableCols(c, schema, table).includes(col)) return;
    const rows = c
      .prepare(`SELECT DISTINCT ${col} AS v FROM ${schema}.${table}`)
      .all() as { v: unknown }[];
    for (const r of rows) if (isDepartmentName(r.v)) out.add(r.v.trim());
  };
  scanCol("main", "users", "department");
  scanCol("main", "review_accounts", "department");
  scanCol(AI_FLOWS_SCHEMA, "nodes", "department");
  scanCol(TICKETS_SCHEMA, "tickets", "department");
  scanCol(TICKETS_SCHEMA, "ticket_comments", "department");
  scanCol(CHAT_REVIEWS_SCHEMA, "reviews", "department");

  // JSON 列：kb_articles.departments（数组）、nodes.executors/removed_executors（元素 .from）
  if (hasTable(c, KB_SCHEMA, "kb_articles")) {
    const rows = c
      .prepare(`SELECT departments FROM ${KB_SCHEMA}.kb_articles`)
      .all() as { departments: string | null }[];
    for (const r of rows)
      for (const x of parseJsonArraySafe(r.departments)) if (isDepartmentName(x)) out.add(x.trim());
  }
  if (hasTable(c, AI_FLOWS_SCHEMA, "nodes")) {
    const cols = tableCols(c, AI_FLOWS_SCHEMA, "nodes");
    const sel = ["executors", "removed_executors"].filter((x) => cols.includes(x));
    if (sel.length) {
      const rows = c
        .prepare(`SELECT ${sel.join(",")} FROM ${AI_FLOWS_SCHEMA}.nodes`)
        .all() as Record<string, string | null>[];
      for (const r of rows)
        for (const k of sel)
          for (const e of parseJsonArraySafe(r[k])) {
            const from = (e as { from?: unknown }).from;
            if (isDepartmentName(from)) out.add(from.trim());
          }
    }
  }
  return [...out];
}

/** 保证部门表存在存量部门名（已存在的按名去重，新部门续号）。
 *  内置种子仅在部门表为空（首次初始化）时写入——否则改名后的种子部门会被重新建出来。 */
function ensureDepartments(c: Database.Database): void {
  const rows = c.prepare("SELECT id, name FROM departments").all() as {
    id: string;
    name: string;
  }[];
  const byName = new Map(rows.map((r) => [r.name, r.id]));
  let nextNo = maxDepartmentNo(rows);
  const ordRow = c.prepare("SELECT COALESCE(MAX(ord), -1) + 1 AS n FROM departments").get() as {
    n: number;
  };
  let nextOrd = ordRow.n;
  const insert = c.prepare(
    "INSERT INTO departments (ord, id, name, created_at) VALUES (?,?,?,?)"
  );
  const add = (name: string): void => {
    if (!name || byName.has(name)) return;
    nextNo += 1;
    insert.run(nextOrd++, departmentId(nextNo), name, new Date().toISOString());
    byName.set(name, departmentId(nextNo));
  };
  if (rows.length === 0) for (const s of DEPARTMENT_SEED) add(s);
  for (const name of collectDepartmentNames(c)) add(name);
}

/** 把各表里仍是部门名的值就地改成编号（只按名称精确匹配，已是编号的行不动；幂等） */
function normalizeDepartmentColumns(c: Database.Database): void {
  const rows = c.prepare("SELECT id, name FROM departments").all() as {
    id: string;
    name: string;
  }[];
  const pairs = rows.filter((r) => isDepartmentName(r.name));
  if (!pairs.length) return;

  const upd = (schema: string, table: string, col: string): void => {
    if (!hasTable(c, schema, table) || !tableCols(c, schema, table).includes(col)) return;
    const stmt = c.prepare(`UPDATE ${schema}.${table} SET ${col} = ? WHERE ${col} = ?`);
    for (const p of pairs) stmt.run(p.id, p.name);
  };
  upd("main", "users", "department");
  upd("main", "review_accounts", "department");
  upd(AI_FLOWS_SCHEMA, "nodes", "department");
  upd(TICKETS_SCHEMA, "tickets", "department");
  upd(TICKETS_SCHEMA, "ticket_comments", "department");
  upd(CHAT_REVIEWS_SCHEMA, "reviews", "department");

  const idOf = new Map(pairs.map((p) => [p.name, p.id]));

  // kb.kb_articles.departments：JSON 数组，逐元素 name → id
  if (hasTable(c, KB_SCHEMA, "kb_articles")) {
    const sel = c.prepare(`SELECT ord, departments FROM ${KB_SCHEMA}.kb_articles`).all() as {
      ord: number;
      departments: string | null;
    }[];
    const set = c.prepare(`UPDATE ${KB_SCHEMA}.kb_articles SET departments = ? WHERE ord = ?`);
    for (const r of sel) {
      const arr = parseJsonArraySafe(r.departments);
      if (!arr.length) continue;
      let changed = false;
      const next = arr.map((x) => {
        if (isDepartmentName(x) && idOf.has(x.trim())) {
          changed = true;
          return idOf.get(x.trim()) as string;
        }
        return x;
      });
      if (changed) set.run(JSON.stringify(next), r.ord);
    }
  }

  // ai_flows.nodes.executors / removed_executors：元素 .from name → id
  if (hasTable(c, AI_FLOWS_SCHEMA, "nodes")) {
    const cols = tableCols(c, AI_FLOWS_SCHEMA, "nodes");
    const sel = ["executors", "removed_executors"].filter((x) => cols.includes(x));
    if (sel.length) {
      const rows2 = c
        .prepare(`SELECT ord, ${sel.join(",")} FROM ${AI_FLOWS_SCHEMA}.nodes`)
        .all() as Record<string, unknown>[];
      const set = c.prepare(`UPDATE ${AI_FLOWS_SCHEMA}.nodes SET ${sel.join(" = ?, ")} = ? WHERE ord = ?`);
      for (const r of rows2) {
        const args: unknown[] = [];
        let changed = false;
        for (const k of sel) {
          const arr = parseJsonArraySafe(r[k] as string | null);
          const next = arr.map((e) => {
            const from = (e as { from?: unknown }).from;
            if (isDepartmentName(from) && idOf.has(from.trim())) {
              changed = true;
              return { ...(e as object), from: idOf.get(from.trim()) as string };
            }
            return e;
          });
          args.push(changed ? JSON.stringify(next) : (r[k] as string | null));
        }
        if (changed) set.run(...args, r.ord);
      }
    }
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

/** 取全局唯一 SQLite 连接（首次调用建目录、开账号域主库、ATTACH 四个子库、开 WAL、建表）
 *  五库布局：main=users.sqlite；ai_flows=ai-flows.sqlite；tickets=ai-tickets.sqlite；
 *  kb=ai-kb.sqlite；chat_reviews=ai-chat-reviews.sqlite。 */
export function getDb(): Database.Database {
  if (conn) return conn;
  mkdirSync(DB_DIR, { recursive: true });
  const c = new Database(USERS_DB_FILE);
  // WAL：读写并发更友好；外键：让子表级联删除生效（同一库内的 FK 才有效）
  c.pragma("journal_mode = WAL");
  c.pragma("foreign_keys = ON");
  attach(c, AI_FLOWS_DB_FILE, AI_FLOWS_SCHEMA);
  attach(c, TICKETS_DB_FILE, TICKETS_SCHEMA);
  attach(c, KB_DB_FILE, KB_SCHEMA);
  attach(c, CHAT_REVIEWS_DB_FILE, CHAT_REVIEWS_SCHEMA);
  c.exec(MAIN_SCHEMA_SQL);
  c.exec(AI_FLOWS_SCHEMA_SQL);
  c.exec(TICKETS_SCHEMA_SQL);
  c.exec(KB_SCHEMA_SQL);
  c.exec(CHAT_REVIEWS_SCHEMA_SQL);
  // 老库补列（账号域主库：密码上次修改时间，用于 10 天有效期提醒）
  ensureColumn(c, "main", "users", "password_changed_at", "password_changed_at TEXT");
  // 老库补列（AI-Flows 域：仓库登记人账号）
  ensureColumn(c, AI_FLOWS_SCHEMA, "repos", "owner_email", "owner_email TEXT");
  // 老库补列（节点执行角色：显式添加名单 / 显式排除名单）
  ensureColumn(c, AI_FLOWS_SCHEMA, "nodes", "executors", "executors TEXT");
  ensureColumn(c, AI_FLOWS_SCHEMA, "nodes", "removed_executors", "removed_executors TEXT");
  // 老库补列（节点归属管线；老节点留空，由 db.ts 启动时挂到默认管线）
  ensureColumn(c, AI_FLOWS_SCHEMA, "nodes", "pipeline_id", "pipeline_id TEXT");
  // 补列之后再建索引（见 AI_FLOWS_SCHEMA_SQL 注释：老库缺列时不能先建）
  c.exec(
    `CREATE INDEX IF NOT EXISTS ${AI_FLOWS_SCHEMA}.idx_nodes_pipeline ON nodes(pipeline_id)`
  );
  // 老库补列（工单关联管线节点 / 指派给员工）
  ensureColumn(c, TICKETS_SCHEMA, "tickets", "node_id", "node_id TEXT");
  ensureColumn(c, TICKETS_SCHEMA, "tickets", "assignee_email", "assignee_email TEXT");
  // 老库补列（对话消息的附件元数据 / 引用会话）
  ensureColumn(c, CHAT_REVIEWS_SCHEMA, "chat_messages", "attachments", "attachments TEXT");
  ensureColumn(c, CHAT_REVIEWS_SCHEMA, "chat_messages", "refs", "refs TEXT");
  // 老库补列（消息内 AI 调用 skill 的记录：灰字提示与产出文件）
  ensureColumn(c, CHAT_REVIEWS_SCHEMA, "chat_messages", "skill_calls", "skill_calls TEXT");
  // 跨库布局迁移：旧主库（ai-flows.sqlite）里的账号域表 / 知识库表搬去各自的库
  migrateLegacyLayout(c);
  // 单库拆多库的历史残留兜底
  migrateLegacyTables(c);
  // 部门表：种子 + 存量部门名，并把各表里的部门名就地编号化
  ensureDepartments(c);
  normalizeDepartmentColumns(c);
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