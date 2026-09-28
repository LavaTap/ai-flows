import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, basename, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadNodes, saveNodes, loadPipelineName, savePipelineName, authenticate, loadUsers, loadReviews, appendReview, appendReviews, normalizeGithub, setUserGithub, setUserGithubPending, clearUserGithubPending, approveUserGithub, setUserProfile, type ReviewRecord, type NodeState, type UserAccount } from "./db.js";
import { createSession, destroySession, currentUser, sessionCookie, clearCookie, SESSION_COOKIE, parseCookies } from "./auth.js";
import { loadConfig, type CrawlerConfig, type ReviewConfig } from "./config.js";
import { collectDiff } from "./collector.js";
import { reviewBatch } from "./reviewer.js";
import { decideGate } from "./gate.js";
import { writeReviewReport, buildReportView, fetchRepoTree } from "./reporter.js";
import { isRepo, currentBranch } from "./git.js";
import { ensureReportServer, REPORTS_DIR } from "./serve.js";
import { runSkill, sanitizeFilename } from "./skill.js";
import { runCrawler } from "./crawler.js";

/** 平台静态资源目录 web/（src 与 dist 均位于仓库根下一级，向上取根） */
export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "web");

/** 平台默认端口（与报告服务 4310 错开） */
export const DEFAULT_PLATFORM_PORT = 4311;

/** 节点附件上传目录名（位于目标仓库根下） */
const UPLOADS_DIR = ".ai-flows-uploads";

/** 需求文本长度上限 */
const REQUIREMENT_MAX = 4000;

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
}

/** 视图层节点模型（带当前用户权限标记，注入页面 bootstrap） */
interface NodeView extends NodeState {
  /** 当前用户能否执行该节点 */
  canExecute: boolean;
  /** 当前用户能否批准该节点 */
  canApprove: boolean;
  /** 当前用户能否编辑需求文本/上传附件（与执行权限一致） */
  canEdit: boolean;
}

/** 剥离密码，输出视图层用户 */
function toUserView(u: UserAccount): UserView {
  return { email: u.email, name: u.name, role: u.role, title: u.title, department: u.department, github: u.github, githubPending: u.githubPending };
}

/** 节点 + 权限 → 视图模型 */
function toNodeView(user: UserAccount, node: NodeState): NodeView {
  return {
    ...node,
    canExecute: canExecute(user, node),
    canApprove: canApprove(user),
    canEdit: canEditRequirement(user, node),
  };
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
  "/ai-review-report.css": { file: "ai-review-report.css", type: "text/css; charset=utf-8" },
  "/ai-review-report.js": { file: "ai-review-report.js", type: "text/javascript; charset=utf-8" },
  "/account.js": { file: "account.js", type: "text/javascript; charset=utf-8" },
  "/team.js": { file: "team.js", type: "text/javascript; charset=utf-8" },
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
  const boot = {
    pipelineName: loadPipelineName(),
    repoName: repoName.replace(/^.*[\\/]/, ""),
    repoPath: repo,
    user: toUserView(user),
    members: loadUsers().map(toUserView),
    nodes: nodesWithUrls.map((n) => toNodeView(user, n)),
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
    command: cfg.command || "claude",
    args: cfg.args ?? ["-p", "--permission-mode", "bypassPermissions"],
    outputDir: cfg.outputDir || "output",
    timeoutMs: cfg.timeoutMs ?? 600000,
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
      const updated =
        gam[2] === "approve"
          ? approveUserGithub(gam[1])
          : clearUserGithubPending(gam[1]);
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
      let patch: { name?: string; department?: string; title?: string } = {};
      try {
        const body = JSON.parse(await readBody(req)) as {
          name?: unknown;
          department?: unknown;
          title?: unknown;
        };
        if (typeof body.name === "string") patch.name = body.name.trim();
        if (typeof body.department === "string") patch.department = body.department.trim();
        if (typeof body.title === "string") patch.title = body.title.trim();
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
      const updated = setUserProfile(pm[1], patch);
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
      sendJson(res, 200, {
        pipelineName: loadPipelineName(),
        user: toUserView(user),
        members: loadUsers().map(toUserView),
        nodes: nodesWithUrls.map((n) => toNodeView(user, n)),
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
        // 主管通过：in_review → done
        if (!canApprove(user)) {
          sendJson(res, 403, { error: "仅部门主管可批准节点" });
          return;
        }
        if (node.status !== "in_review") {
          sendJson(res, 409, { error: "仅「待验收」状态可批准" });
          return;
        }
        node.status = "done";
        saveNodes(nodes);
        sendJson(res, 200, { ok: true, node: toNodeView(user, node) });
        return;
      }

      // reject：主管驳回，in_review → running（附驳回意见）
      if (!canApprove(user)) {
        sendJson(res, 403, { error: "仅部门主管可驳回节点" });
        return;
      }
      if (node.status !== "in_review") {
        sendJson(res, 409, { error: "仅「待验收」状态可驳回" });
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
