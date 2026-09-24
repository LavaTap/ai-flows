import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadNodes, saveNodes, authenticate, loadReviews, appendReview, type ReviewRecord, type NodeState, type UserAccount } from "./db.js";
import { createSession, destroySession, currentUser, sessionCookie, clearCookie, SESSION_COOKIE, parseCookies } from "./auth.js";
import { loadConfig } from "./config.js";
import { collectDiff } from "./collector.js";
import { reviewBatch } from "./reviewer.js";
import { decideGate } from "./gate.js";
import { writeReviewReport, buildReportView } from "./reporter.js";
import { isRepo, currentBranch } from "./git.js";
import { ensureReportServer, REPORTS_DIR } from "./serve.js";

/** 平台静态资源目录 web/（src 与 dist 均位于仓库根下一级，向上取根） */
export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "web");

/** 平台默认端口（与报告服务 4310 错开） */
export const DEFAULT_PLATFORM_PORT = 4311;

/** 员工只能执行本部门节点；部门主管不限部门（权限最高） */
export function canExecute(user: UserAccount, node: NodeState): boolean {
  return user.role === "supervisor" || user.department === node.department;
}

/** 仅部门主管可批准节点（操控并批准所有节点） */
export function canApprove(user: UserAccount): boolean {
  return user.role === "supervisor";
}

/** 节点 03（AI 代码评审）所属部门：外部触发（hook/手动 run）的报告无账号归属，统一归到该部门 */
const AI_REVIEW_DEPT = "程序中台";

/** 按视角过滤评审记录：主管看全部；员工只看本部门；外部触发记录已归到部门，可随部门可见 */
export function filterReviewsByUser(reviews: ReviewRecord[], user: UserAccount): ReviewRecord[] {
  if (user.role === "supervisor") return reviews;
  return reviews.filter((r) => r.department === user.department);
}

/** 视图层用户模型（不含密码） */
interface UserView {
  email: string;
  role: UserAccount["role"];
  title: string;
  department: string;
}

/** 视图层节点模型（带当前用户权限标记，注入页面 bootstrap） */
interface NodeView extends NodeState {
  /** 当前用户能否执行该节点 */
  canExecute: boolean;
  /** 当前用户能否批准该节点 */
  canApprove: boolean;
}

/** 剥离密码，输出视图层用户 */
function toUserView(u: UserAccount): UserView {
  return { email: u.email, role: u.role, title: u.title, department: u.department };
}

/** 节点 + 权限 → 视图模型 */
function toNodeView(user: UserAccount, node: NodeState): NodeView {
  return { ...node, canExecute: canExecute(user, node), canApprove: canApprove(user) };
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

/** 渲染管线页：读静态 ai-pipeline.html，注入登录用户 + 节点状态 + 权限 bootstrap，再挂平台脚本 */
function pipelineHtml(user: UserAccount): string {
  const raw = readFileSync(join(WEB_DIR, "ai-pipeline.html"), "utf8");
  const boot = {
    user: toUserView(user),
    nodes: loadNodes().map((n) => toNodeView(user, n)),
  };
  const inject = `<script>window.__PIPELINE__ = ${jsonForScript(boot)};</script>\n<script src="/ai-pipeline-app.js" defer></script>`;
  return raw.replace("</body>", `${inject}\n</body>`);
}

/** 重新读库更新单个节点（后台评审任务完成后回写，避免覆盖期间其他节点的状态变更） */
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

/** 读取目标仓库 .ai-review-reports/ 下由外部触发（hook / 手动 run）落盘的全量报告，
 *  归为「外部触发」执行角色，嫁接到节点 03 所属部门，供「评审记录」面板聚合展示 */
async function collectExternalReviews(repo: string): Promise<ReviewRecord[]> {
  const dir = join(repo, REPORTS_DIR);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("."));
  } catch {
    return [];
  }
  const records: ReviewRecord[] = [];
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
          (view.counts?.blocker ?? 0) + (view.counts?.warning ?? 0) + (view.counts?.info ?? 0),
        reportUrl: "",
      });
    } catch {
      /* 单个损坏报告跳过，不影响整体列表 */
    }
  }
  // 报告页地址依赖报告服务，取一次实例
  if (records.length) {
    const base = await ensureReportServer(repo);
    for (const r of records) r.reportUrl = `${base}/reports/${r.id}`;
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

/** 启动 AI 管线平台 HTTP 服务：登录会话 + 管线页角色渲染 + 节点执行/批准 API。
 *  opts.repo 为节点 03 AI 代码评审的目标仓库（缺省取当前工作目录）。 */
export async function startPlatformServer(
  opts: { host?: string; port?: number; repo?: string } = {}
): Promise<PlatformServer> {
  const host = opts.host ?? "127.0.0.1";
  const repo = opts.repo ?? process.cwd();

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

    // 节点列表 + 当前用户权限（登录即可查看全流程）
    if (path === "/api/nodes" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      sendJson(res, 200, {
        user: toUserView(user),
        nodes: loadNodes().map((n) => toNodeView(user, n)),
      });
      return;
    }

    // 节点 03 评审记录：平台历史 + 外部报告聚合，按视角过滤（主管全量 / 员工本部门）
    if (path === "/api/reviews" && req.method === "GET") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "未登录" });
        return;
      }
      const all = [...loadReviews(), ...(await collectExternalReviews(repo))].sort(
        (a, b) => b.generatedAt.localeCompare(a.generatedAt)
      );
      sendJson(res, 200, { reviews: filterReviewsByUser(all, user) });
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
      res.end(pipelineHtml(user));
      return;
    }

    // 节点动作：执行（本部门员工或主管）/ 批准（仅主管）。id 用 [^/\\]+ 限定防路径穿越
    const am = path.match(/^\/api\/nodes\/([^/\\]+)\/(execute|approve)$/);
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
      if (am[2] === "execute") {
        if (!canExecute(user, node)) {
          sendJson(res, 403, { error: "仅本部门员工或部门主管可执行该节点" });
          return;
        }
        if (!node.ready) {
          sendJson(res, 400, { error: "该环节能力待接入，暂不可执行" });
          return;
        }
        if (node.status === "approved") {
          sendJson(res, 400, { error: "节点已批准，无需重复执行" });
          return;
        }
        if (node.status === "running") {
          sendJson(res, 400, { error: "该节点正在执行中，请稍候" });
          return;
        }
        // 带 runner 的节点：先落 running 态立即响应，评审链在后台执行，完成后回写结果
        if (node.runner === "ai-review") {
          node.status = "running";
          node.lastResult = "AI 评审进行中…";
          node.reportUrl = undefined;
          saveNodes(nodes);
          sendJson(res, 200, { ok: true, node: toNodeView(user, node) });
          runAiReviewNode(repo)
            .then((r) => {
              updateNode(node.id, (n) => {
                n.status = "done";
                n.reportUrl = r.reportUrl;
                n.lastResult = r.passed
                  ? r.issues > 0
                    ? `评审通过（共 ${r.issues} 个非阻塞提示）`
                    : "评审通过（未发现问题）"
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
                n.status = "todo";
                n.lastResult = `执行失败：${err?.message || String(err)}`;
              });
            });
          return;
        }
        node.status = "done";
      } else {
        if (!canApprove(user)) {
          sendJson(res, 403, { error: "仅部门主管可批准节点" });
          return;
        }
        if (node.status === "approved") {
          sendJson(res, 400, { error: "节点已批准" });
          return;
        }
        if (node.status === "running") {
          sendJson(res, 400, { error: "节点执行中，待执行完成后再批准" });
          return;
        }
        node.status = "approved";
      }
      saveNodes(nodes);
      sendJson(res, 200, { ok: true, node: toNodeView(user, node) });
      return;
    }

    // 根路径：按登录态分流
    if (path === "/" && req.method === "GET") {
      res.statusCode = 302;
      res.setHeader("Location", currentUser(req) ? "/pipeline" : "/login");
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
