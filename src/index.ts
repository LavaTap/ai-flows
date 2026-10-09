import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig, type ReviewConfig } from "./config.js";
import { collectDiff } from "./collector.js";
import { reviewBatch } from "./reviewer.js";
import { decideGate, type ReviewIssue } from "./gate.js";
import { pushToTargets, type PushResult } from "./publisher.js";
import { isRepo, currentBranch, repoRoot, headCommit } from "./git.js";
import { writeReviewReport, buildReportView, fetchRepoTree } from "./reporter.js";
import { startReportServer, ensureReportServer, findReusableReview, REPORTS_DIR, DEFAULT_REPORT_PORT } from "./serve.js";
import { startPlatformServer, DEFAULT_PLATFORM_PORT, matchRepoByPath } from "./platform.js";
import { loadRepos } from "./db.js";
import {
  readLogTail,
  readLogChunk,
  logFileSize,
  logFilePath,
  formatLogLine,
  parseLine,
  type LogKind,
} from "./log.js";

const CWD = process.cwd();
const THIS_FILE = fileURLToPath(import.meta.url);
const RED = "\u001b[31m";
const YELLOW = "\u001b[33m";
const GREEN = "\u001b[32m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

function severityColor(s: string): string {
  if (s === "blocker") return RED;
  if (s === "warning") return YELLOW;
  return GREEN;
}

function printIssues(issues: ReviewIssue[], blocked: Set<string>): void {
  if (issues.length === 0) {
    console.log(`${GREEN}✔ 未发现问题${RESET}`);
    return;
  }
  for (const it of issues) {
    const mark = blocked.has(it.severity) ? "✖" : "•";
    const loc = it.line ? `${it.file}:${it.line}` : it.file;
    console.log(
      `${severityColor(it.severity)}${mark} [${it.severity}] ${loc}${RESET}`
    );
    console.log(`    ${it.category}: ${it.message}`);
    if (it.suggestion) console.log(`${DIM}    INFO: ${it.suggestion}${RESET}`);
  }
}

async function run(
  cfg: ReviewConfig,
  opts: { push: boolean; reportOut?: string; page?: boolean }
): Promise<number> {
  if (!(await isRepo(CWD))) {
    console.error("当前目录不是 git 仓库。请在 git 仓库内运行。");
    return 1;
  }

  // 评审只对「已登记仓库」开放：未登记目录一律拒绝
  const root = (await repoRoot(CWD)) ?? CWD;
  if (!matchRepoByPath(loadRepos(), root)) {
    console.error(`${RED}当前仓库未登记，拒绝评审：${root}${RESET}`);
    console.error(`${DIM}请先在平台「仓库管理」页登记该仓库目录，再运行评审。${RESET}`);
    return 1;
  }

  // 无任何更改 + 已有评审结果：复用最近那份报告，不再调用模型重复评审
  // （range 模式看 HEAD 是否未变；staged/working 模式看 diff 是否为空）
  const head = await headCommit(CWD);
  const reusable = await findReusableReview(CWD, cfg.diff);
  if (reusable) {
    const base = await ensureReportServer(CWD);
    console.log(`${DIM}当前代码无任何更改（HEAD ${head?.short ?? ""} 未变），已存在评审结果，跳过评审。${RESET}`);
    console.log(`\n${GREEN}📄 评审结果页面：${base}/reports/${reusable.id}${RESET}`);
    console.log(`${DIM}（全部报告列表：${base}/）${RESET}`);
    return reusable.passed ? 0 : 1;
  }

  console.log(`${DIM}采集变更（scope=${cfg.diff.scope}）...${RESET}`);
  const files = await collectDiff(cfg.diff, CWD);
  console.log(`${DIM}待评审文件 ${files.length} 个（降级 ${files.filter((f) => f.degraded).length} 个）${RESET}`);

  console.log(`${DIM}AI 评审链接生成中...${RESET}`);
  const result = await reviewBatch(files, cfg.model);

  console.log(`\n${DIM}── 评审摘要 ──${RESET}`);
  // console.log(result.summary);
  // console.log(`\n${DIM}── 问题列表 (${result.issues.length}) ──${RESET}`);
  // const blockedSet = new Set(cfg.severityBlocked);
  // printIssues(result.issues, blockedSet);

  const gate = decideGate(result, cfg);
  console.log("");
  if (gate.passed) {
    console.log(`${GREEN}✔ 评审通过${RESET}`);
  } else {
    console.log(`${RED}✖ 评审未通过：存在 ${gate.blockers.length} 个阻塞级问题，已拦截。${RESET}`);
  }

  let pushes: PushResult[] | undefined;
  let exitCode = gate.passed ? 0 : 1;
  if (gate.passed && opts.push) {
    console.log(`\n${DIM}自动推送到目标远端...${RESET}`);
    pushes = await pushToTargets(cfg.targets, CWD);
    let allOk = true;
    for (const p of pushes) {
      if (p.ok) console.log(`${GREEN}✔ [${p.name}] ${p.message}${RESET}`);
      else {
        allOk = false;
        console.log(`${RED}✖ [${p.name}] ${p.message}${RESET}`);
      }
    }
    exitCode = allOk ? 0 : 2;
  } else if (gate.passed && !opts.push) {
    console.log(`${DIM}(未推送：评审通过后请在评审页面输入 commit 信息并点「确认提交」按钮提交，或加 --push 由命令行直接推送)${RESET}`);
  }

  const reportPath = writeReviewReport(result, gate, { pushes, outPath: opts.reportOut });
  console.log(`${DIM}已生成报告：${reportPath}${RESET}`);

  if (opts.page) {
    const id = `review-${Date.now().toString(36)}`;
    const dir = join(CWD, REPORTS_DIR);
    mkdirSync(dir, { recursive: true });
    let ref: string | undefined;
    try {
      ref = await currentBranch(CWD);
    } catch {
      /* detached HEAD 等场景忽略 */
    }
    const view = buildReportView(result, files, gate, pushes, {
      ref,
      repoCwd: CWD,
      targets: cfg.targets,
      reviewedCommit: head?.hash,
      repoTree: await fetchRepoTree(CWD, { tokenEnv: cfg.reviews?.gitHubTokenEnv }),
    });
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(view, null, 2), "utf8");
    const base = await ensureReportServer(CWD);
    console.log(`\n${GREEN}📄 评审结果页面：${base}/reports/${id}${RESET}`);
    console.log(`${DIM}（全部报告列表：${base}/）${RESET}`);
  }

  return exitCode;
}

/** 安装 pre-push hook：git push 前自动 AI 评审并出页面；始终拦截本次 push，
 * 引导用户去评审页面点「确认提交」按钮，由评审服务代为推送。ai-review 内部推送会跳过本 hook。 */
function installPrePushHook(): number {
  const repo = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: CWD,
    encoding: "utf8",
  });
  const root = (repo.stdout || "").trim();
  if (repo.status !== 0 || !root) {
    console.error("当前目录不是 git 仓库，无法安装 hook。");
    return 1;
  }
  const hookDir = join(root, ".git", "hooks");
  const hookPath = join(hookDir, "pre-push");
  mkdirSync(hookDir, { recursive: true });

  if (existsSync(hookPath)) {
    const bak = `${hookPath}.bak-${Date.now()}`;
    copyFileSync(hookPath, bak);
    console.log(`${DIM}已有 pre-push hook，已备份：${bak}${RESET}`);
  }

  const cli = THIS_FILE.replace(/\\/g, "/");
  const script = `#!/bin/sh
# ai-review pre-push hook：push 前自动 AI 评审并出页面；始终拦截本次 git push，
# 引导用户到评审页面点「确认提交」按钮，由评审服务代为推送到远端。
# ai-review 内部推送（页面按钮触发）会设 AI_REVIEW_INTERNAL_PUSH=1 跳过本 hook。
[ "$AI_REVIEW_INTERNAL_PUSH" = "1" ] && exit 0

repo="$(git rev-parse --show-toplevel)" || exit 0
[ -f "$repo/ai-review.config.json" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
cd "$repo" || exit 0
node "${cli}" run --config ai-review.config.json --no-push --page
rc=$?
if [ "$rc" = "0" ]; then
  echo "[ai-review] 评审通过（退出码=$rc）。请打开上述评审页面，点击「确认提交」按钮推送到远端。"
else
  echo "[ai-review] 评审未通过（退出码=$rc），已拦截，未进入提交环节。请打开上述评审页面查看阻塞问题。"
fi
echo "[ai-review] 本次 git push 已被拦截：评审通过后需在页面确认提交，由评审服务推送。"
exit 1
`;
  writeFileSync(hookPath, script, { encoding: "utf8", mode: 0o755 });
  console.log(`${GREEN}✔ 已安装 pre-push hook：${hookPath.replace(/\\/g, "/")}${RESET}`);
  console.log(`${DIM}现在每次 git push 都会被拦截：先跑 AI 评审，再到评审页面点「确认提交」由服务代为推送。${RESET}`);
  console.log(`${DIM}要求仓库根目录存在 ai-review.config.json。${RESET}`);
  return 0;
}

/** 日志子命令：打印 AI 请求日志 / 网页访问日志末尾若干行；--follow 每秒轮询新增行 */
async function printLogs(kindArg: string, lines: number, follow: boolean): Promise<void> {
  const kinds: LogKind[] = kindArg === "ai" ? ["ai"] : kindArg === "web" ? ["web"] : ["ai", "web"];

  // 初始回看：单一类型直接打印；all 时按时间合并（新的在后）
  if (kinds.length === 1) {
    for (const e of readLogTail(kinds[0], lines)) console.log(formatLogLine(kinds[0], e));
  } else {
    const merged = kinds
      .flatMap((k) => readLogTail(k, lines).map((e) => ({ k, e })))
      .sort((a, b) => a.e.at.localeCompare(b.e.at));
    for (const { k, e } of merged) console.log(formatLogLine(k, e));
  }
  for (const k of kinds) console.log(`${DIM}日志文件：${logFilePath(k)}${RESET}`);

  if (!follow) return;
  console.log(`${DIM}（--follow 已开启：每秒打印新增日志，Ctrl+C 退出）${RESET}`);

  const offsets = new Map<LogKind, number>();
  const pending = new Map<LogKind, string>();
  for (const k of kinds) {
    offsets.set(k, logFileSize(k));
    pending.set(k, "");
  }
  setInterval(() => {
    for (const k of kinds) {
      const { text, offset } = readLogChunk(k, offsets.get(k) ?? 0);
      offsets.set(k, offset);
      if (!text) continue;
      const parts = ((pending.get(k) ?? "") + text).split("\n");
      pending.set(k, parts.pop() ?? ""); // 末尾半行留到下一轮，避免截断
      for (const line of parts) {
        const entry = parseLine(line);
        if (entry) console.log(formatLogLine(k, entry));
      }
    }
  }, 1000);
  await new Promise<void>(() => {});
}

function initConfig(): number {
  const from = resolve(CWD, "config.example.json");
  const to = resolve(CWD, "ai-review.config.json");
  if (existsSync(to)) {
    console.error("ai-review.config.json 已存在，跳过。");
    return 1;
  }
  copyFileSync(from, to);
  console.log("已生成 ai-review.config.json，请按需修改模型与 targets 配置。");
  return 0;
}

function usage(): void {
  console.log(`ai-review — 平台无关的 AI 代码评审链

用法:
  ai-review run  [--config <path>] [--report <path>] [--push] [--no-push] [--page]
                                      采集 diff → AI 评审 → 写 md 报告 + 评审数据(JSON)
                                      缺省不推送（--push 才由命令行直接推送）；
                                      --page 后台拉起服务，打印可点开的评审结果链接
                                      评审页面需输入 commit 信息并点「确认提交」才会提交+推送
  ai-review serve [--port <n> [--dir]]  常驻评审报告服务（GET /reports/<id>）
  ai-review platform [--port <n>] [--repo <path>]
                                       启动 AI 管线平台（登录 + 管线页 + 节点执行/批准）
                                       节点 03 执行时在 --repo 仓库（缺省当前目录）触发真实 AI 评审
                                       账号见 db/users.json（演示密码统一 123456）
  ai-review logs [--kind ai|web|all] [--lines <n>] [--follow]
                                        打印日志：ai=模型请求（评审/AI 对话/skill）
                                        web=网页与 API 访问；--lines 回看行数（默认 50）
                                        --follow 随日志追加实时打印（Ctrl+C 退出）
  ai-review install-hook                装 pre-push hook：git push 自动评审，有 blocker 则拦截
  ai-review init                         从 config.example.json 生成配置
  ai-review -h | --help                  显示帮助

环境变量:
  DEEPSEEK_API_KEY         模型 API Key（或 config 里 model.apiKeyEnv 指定）
  AI_REVIEW_CONFIG         配置文件路径（默认 ./ai-review.config.json）
  AI_REVIEW_PORT           报告服务端口（默认 4310）
  AI_REVIEW_GITHUB_TOKEN   https 目标远端 token 认证`);
}

/** 手工解析子命令参数：--k v 或 --k=v；无值的布尔 flag 置空字符串 */
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    let k: string;
    let v: string;
    if (eq !== -1) {
      k = a.slice(2, eq);
      v = a.slice(eq + 1);
    } else {
      k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        v = next;
        i++; // 消费掉被当作值的那一项
      } else {
        v = ""; // 布尔 flag（如 --push / --no-push）
      }
    }
    out[k] = v;
  }
  return out;
}

async function main(): Promise<void> {
  const [sub] = process.argv.slice(2);
  if (!sub || sub === "-h" || sub === "--help" || sub === "help") {
    usage();
    return;
  }

  if (sub === "init") {
    process.exitCode = initConfig();
    return;
  }

  if (sub === "serve") {
    const args = parseArgs(process.argv.slice(3));
    // 单例报告服务：固定端口。初始 root 取 --repo / 当前目录；其余仓库评审时经 POST /roots 自行登记。
    const port = Number(args.port || process.env.AI_REVIEW_PORT || DEFAULT_REPORT_PORT);
    const repo = args.repo ? resolve(args.repo) : CWD;
    const dir = join(repo, REPORTS_DIR);
    mkdirSync(dir, { recursive: true });
    try {
      const srv = await startReportServer({ host: "127.0.0.1", port, roots: [dir] });
      console.log(`${GREEN}评审报告服务已启动：${srv.url}${RESET}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
      console.log(`${DIM}端口 ${port} 上已有报告服务在运行（单例），本进程空闲驻留。${RESET}`);
    }
    console.log(`${DIM}（Ctrl+C 停止）${RESET}`);
    await new Promise<void>(() => {});
    return;
  }

  if (sub === "platform") {
    const args = parseArgs(process.argv.slice(3));
    const base = Number(args.port || process.env.AI_FLOWS_PORT || DEFAULT_PLATFORM_PORT);
    // 节点 03 AI 代码评审的目标仓库：--repo 指定，缺省当前目录
    const repo = args.repo ? resolve(args.repo) : CWD;
    let srv;
    for (let p = base; p < base + 10; p++) {
      try {
        srv = await startPlatformServer({ host: "127.0.0.1", port: p, repo });
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
      }
    }
    if (!srv) {
      console.error(`${RED}✖ 无法启动平台服务：端口 ${base}-${base + 9} 均被占用${RESET}`);
      process.exitCode = 1;
      return;
    }
    console.log(`${GREEN}AI 管线平台已启动：${srv.url}${RESET}`);
    console.log(`${DIM}登录页：${srv.url}/login（账号见 db/users.json，演示密码统一 123456）${RESET}`);
    console.log(`${DIM}节点 03 执行触发真实 AI 评审，目标仓库：${repo}${RESET}`);
    console.log(`${DIM}（Ctrl+C 停止）${RESET}`);
    await new Promise<void>(() => {});
    return;
  }

  if (sub === "logs") {
    const args = parseArgs(process.argv.slice(3));
    const kind = (args.kind || "all").toLowerCase();
    if (kind !== "ai" && kind !== "web" && kind !== "all") {
      console.error(`${RED}✖ --kind 只支持 ai / web / all${RESET}`);
      process.exitCode = 1;
      return;
    }
    const linesRaw = Number(args.lines || 50);
    const lines = Math.min(Math.max(Number.isFinite(linesRaw) ? Math.floor(linesRaw) : 50, 1), 1000);
    await printLogs(kind, lines, "follow" in args && args.follow !== "false");
    return;
  }

  if (sub === "install-hook") {
    process.exitCode = installPrePushHook();
    return;
  }

  if (sub === "run") {
    const args = parseArgs(process.argv.slice(3));
    const cfg = loadConfig(args.config || undefined);
    // --push 裸参数或 --push=true 视为开启；--no-push ERROR关闭；缺省关闭（避免误触发自动提交）
    const pushTrue = "push" in args && (args["push"] === "" || args["push"] === "true");
    const noPush = "no-push" in args && args["no-push"] !== "false";
    const push = pushTrue && !noPush;
    process.exitCode = await run(cfg, {
      push,
      reportOut: args["report"] || undefined,
      page: "page" in args && (args["page"] === "" || args["page"] === "true"),
    });
    return;
  }

  console.error(`未知子命令：${sub}`);
  usage();
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(`${RED}✖ ${err?.message || err}${RESET}`);
  process.exitCode = 1;
});