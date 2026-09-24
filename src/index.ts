import { copyFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig, type ReviewConfig } from "./config.js";
import { collectDiff } from "./collector.js";
import { reviewBatch } from "./reviewer.js";
import { decideGate, type ReviewIssue } from "./gate.js";
import { pushToTargets, type PushResult } from "./publisher.js";
import { isRepo, currentBranch } from "./git.js";
import { writeReviewReport, buildReviewHtml } from "./reporter.js";
import { startReportServer, REPORTS_DIR } from "./serve.js";

const CWD = process.cwd();
const DEFAULT_PORT = Number(process.env.AI_REVIEW_PORT || 4310);
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
    if (it.suggestion) console.log(`${DIM}    建议: ${it.suggestion}${RESET}`);
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

  console.log(`${DIM}采集变更（scope=${cfg.diff.scope}）...${RESET}`);
  const files = await collectDiff(cfg.diff, CWD);
  console.log(`${DIM}待评审文件 ${files.length} 个（降级 ${files.filter((f) => f.degraded).length} 个）${RESET}`);

  console.log(`${DIM}AI 评审中...${RESET}`);
  const result = await reviewBatch(files, cfg.model);

  console.log(`\n${DIM}── 评审摘要 ──${RESET}`);
  console.log(result.summary);
  console.log(`\n${DIM}── 问题列表 (${result.issues.length}) ──${RESET}`);
  const blockedSet = new Set(cfg.severityBlocked);
  printIssues(result.issues, blockedSet);

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
    console.log(`${DIM}(未推送：如需评审通过后自动提交到目标服务器，请加 --push)${RESET}`);
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
    writeFileSync(
      join(dir, `${id}.html`),
      buildReviewHtml(result, gate, pushes, { ref }),
      "utf8"
    );
    const base = await ensureReportServer();
    console.log(`\n${GREEN}📄 评审结果页面：${base}/reports/${id}${RESET}`);
    console.log(`${DIM}（全部报告列表：${base}/）${RESET}`);
  }

  return exitCode;
}

/** 确保本地报告服务在跑，返回其 base URL（不阻塞本进程）。用 .server 握手文件取得真实（可用）端口。 */
async function ensureReportServer(): Promise<string> {
  const dir = join(CWD, REPORTS_DIR);
  const serverFile = join(dir, ".server");

  // 已有可用的服务？(校验 /health 返回体必须为 ok，防止被无关进程误判)
  if (existsSync(serverFile)) {
    try {
      const m = JSON.parse(readFileSync(serverFile, "utf8"));
      const r = await fetch(`${m.url}/health`, { signal: AbortSignal.timeout(700) });
      if (r.ok && (await r.text()).trim() === "ok") return m.url;
    } catch {
      /* 失效，重新拉起 */
    }
  }

  // 后台拉起 serve 守护进程（detached），落位改端口会自动写入 .server
  spawn(
    process.execPath,
    [THIS_FILE, "serve", "--port", String(DEFAULT_PORT)],
    { detached: true, stdio: "ignore", cwd: CWD }
  ).unref();

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (!existsSync(serverFile)) continue;
    try {
      const m = JSON.parse(readFileSync(serverFile, "utf8"));
      const r = await fetch(`${m.url}/health`, { signal: AbortSignal.timeout(600) });
      if (r.ok && (await r.text()).trim() === "ok") return m.url;
    } catch {
      /* keep waiting */
    }
  }
  return `http://127.0.0.1:${DEFAULT_PORT}`;
}

/** 安装 pre-push hook：每次 git push 前自动跑 AI 评审并出页面；有 blocker 则阻断推送 */
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
# ai-review pre-push hook：push 前自动 AI 评审并出页面；有 blocker 则阻断推送
repo="$(git rev-parse --show-toplevel)" || exit 0
[ -f "$repo/ai-review.config.json" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
cd "$repo" || exit 0
node "${cli}" run --config ai-review.config.json --no-push --page
rc=$?
echo "[ai-review] 评审退出码=$rc（非0：存在阻塞问题，已拦截推送）"
exit $rc
`;
  writeFileSync(hookPath, script, { encoding: "utf8", mode: 0o755 });
  console.log(`${GREEN}✔ 已安装 pre-push hook：${hookPath.replace(/\\/g, "/")}${RESET}`);
  console.log(`${DIM}现在每次 git push 都会先跑 AI 评审；要求仓库根目录存在 ai-review.config.json。${RESET}`);
  return 0;
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
  ai-review run  [--config <path>] [--report <path>] [--push|--no-push] [--page]
                                      采集 diff → AI 评审 → 写 md/HTML 报告 → (通过后)推送
                                      --page  后台拉起服务，打印可点开的评审结果链接
  ai-review serve [--port <n> [--dir]]  常驻评审报告服务（GET /reports/<id>）
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
    const dir = join(CWD, REPORTS_DIR);
    mkdirSync(dir, { recursive: true });
    const base = Number(args.port || process.env.AI_REVIEW_PORT || DEFAULT_PORT);
    let srv;
    for (let p = base; p < base + 10; p++) {
      try {
        srv = await startReportServer({ host: "127.0.0.1", port: p, dir });
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
      }
    }
    if (!srv) {
      console.error(`${RED}✖ 无法启动服务：端口 ${base}-${base + 9} 均被占用${RESET}`);
      return;
    }
    writeFileSync(join(dir, ".server"), JSON.stringify({ port: srv.port, url: srv.url }));
    console.log(`${GREEN}评审报告服务已启动：${srv.url}${RESET}`);
    console.log(`${DIM}（Ctrl+C 停止）${RESET}`);
    await new Promise<void>(() => {});
    return;
  }

  if (sub === "install-hook") {
    process.exitCode = installPrePushHook();
    return;
  }

  if (sub === "run") {
    const args = parseArgs(process.argv.slice(3));
    const cfg = loadConfig(args.config || undefined);
    // --push 裸参数或 --push=true 视为开启；--no-push 强制关闭；缺省开启
    const pushTrue = "push" in args && (args["push"] === "" || args["push"] === "true");
    const noPush = "no-push" in args && args["no-push"] !== "false";
    const push = !noPush && (pushTrue || !("push" in args));
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