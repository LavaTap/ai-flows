import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 平台数据目录 db/（src 与 dist 均位于仓库根下一级，向上取根） */
export const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db");

/** SQLite 单库文件 db/ai-flows.sqlite（运行时生成，已 gitignore） */
export const DB_FILE = join(DB_DIR, "ai-flows.sqlite");

/** 建表 DDL：幂等（IF NOT EXISTS），每次进程启动执行一次。
 *  ord 列保留数组原始顺序（JSON 时代靠数组下标，SQL 无序需显式列）。
 *  子表用 ON DELETE CASCADE，父行整体替换时子行随之清理。 */
const SCHEMA_SQL = `
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
  avatar         TEXT
);

CREATE TABLE IF NOT EXISTS nodes (
  ord              INTEGER NOT NULL,
  id               TEXT PRIMARY KEY,
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
  output_dir       TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
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

CREATE TABLE IF NOT EXISTS tickets (
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

CREATE TABLE IF NOT EXISTS ticket_comments (
  ord        INTEGER NOT NULL,
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  email      TEXT NOT NULL,
  department TEXT NOT NULL,
  content    TEXT NOT NULL,
  at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  ord         INTEGER NOT NULL,
  id          TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  summary     TEXT,
  summary_upto INTEGER
);

CREATE TABLE IF NOT EXISTS chat_messages (
  ord        INTEGER NOT NULL,
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  at         TEXT NOT NULL,
  model_id   TEXT,
  tokens     INTEGER
);

CREATE TABLE IF NOT EXISTS chat_models (
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

/* 账号投影表：以 users.email 为唯一来源同步（email 主键 + FK 级联），
   chat_accounts 供 AI 对话侧取姓名，review_accounts 额外带部门供评审侧取归属。
   users 行被整体替换（DELETE FROM users）时这两张表随外键级联清空，再由 db.ts 重新同步。 */
CREATE TABLE IF NOT EXISTS chat_accounts (
  email TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_accounts (
  email      TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  department TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reviews_department ON reviews(department);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
`;

let conn: Database.Database | null = null;

/** 幂等补列：CREATE TABLE IF NOT EXISTS 不会给已存在的表加列，老库升级靠这里补 */
function ensureColumn(c: Database.Database, table: string, column: string, ddl: string): void {
  const cols = c.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((x) => x.name === column)) c.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/** 取全局唯一 SQLite 连接（首次调用建目录、开库、开 WAL、建表） */
export function getDb(): Database.Database {
  if (conn) return conn;
  mkdirSync(DB_DIR, { recursive: true });
  const c = new Database(DB_FILE);
  // WAL：读写并发更友好；外键：让子表级联删除生效
  c.pragma("journal_mode = WAL");
  c.pragma("foreign_keys = ON");
  c.exec(SCHEMA_SQL);
  // 老库补列（工单关联管线节点 / 指派给员工）
  ensureColumn(c, "tickets", "node_id", "node_id TEXT");
  ensureColumn(c, "tickets", "assignee_email", "assignee_email TEXT");
  conn = c;
  return conn;
}

/** 关闭连接（进程收尾 / 测试用） */
export function closeDb(): void {
  if (conn) {
    conn.close();
    conn = null;
  }
}