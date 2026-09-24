import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** 平台数据目录 db/（src 与 dist 均位于仓库根下一级，向上取根） */
export const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db");

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
  /** 归属部门节点：产品调研 / AI产品 / 程序中台 / 产品运营；主管为 产品 */
  department: string;
}

/** 节点运行时状态 */
export type NodeStatus = "todo" | "running" | "done" | "approved";

/** 管线节点（db/pipeline.json，执行/批准会写回） */
export interface NodeState {
  /** 节点编号 01-04 */
  id: string;
  /** 负责部门名，与账号 department 对应 */
  department: string;
  /** 环节名：产品调研 / 产品策划案 / AI 代码评审 / 运营 */
  step: string;
  /** 能力是否已就绪（仅 03 AI 代码评审为 true，其余留空待接入） */
  ready: boolean;
  /** 待执行 / 执行中 / 已执行 / 已批准 */
  status: NodeStatus;
  /** 执行器标识：ai-review 表示执行时触发真实 AI 评审链（目前仅节点 03） */
  runner?: string;
  /** 最近一次执行结果摘要（评审通过 / 未通过 / 失败原因），展示在详情面板 */
  lastResult?: string;
  /** 最近一次评审报告页链接（runner=ai-review 执行成功后写入） */
  reportUrl?: string;
}

/** 读取全部账号 */
export function loadUsers(): UserAccount[] {
  const f = join(DB_DIR, "users.json");
  const data = JSON.parse(readFileSync(f, "utf8")) as { users?: UserAccount[] };
  return data.users ?? [];
}

/** 邮箱 + 密码校验，命中返回账号，否则 null */
export function authenticate(email: string, password: string): UserAccount | null {
  const target = email.trim().toLowerCase();
  const user = loadUsers().find((u) => u.email === target);
  if (!user || user.password !== password) return null;
  return user;
}

/** 读取全部管线节点 */
export function loadNodes(): NodeState[] {
  const f = join(DB_DIR, "pipeline.json");
  const data = JSON.parse(readFileSync(f, "utf8")) as { nodes?: NodeState[] };
  return data.nodes ?? [];
}

/** 写回管线节点（执行/批准后持久化状态） */
export function saveNodes(nodes: NodeState[]): void {
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(join(DB_DIR, "pipeline.json"), JSON.stringify({ nodes }, null, 2), "utf8");
}
