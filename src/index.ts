import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, type ReviewConfig } from "./config.js";
import { collectDiff } from "./collector.js";
import { reviewBatch } from "./reviewer.js";
import { decideGate, type ReviewIssue } from "./gate.js";
import { pushToTargets, type PushResult } from "./publisher.js";
import { isRepo } from "./git.js";
import { writeReviewReport } from "./reporter.js";

const CWD = process.cwd();
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
  opts: { push: boolean; reportOut?: string }
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
  return exitCode;
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
  ai-review run  [--config <path>] [--report <path>] [--push|--no-push]
                                      采集 diff → AI 评审 → 写 md 报告 → (通过后)推送
  ai-review init                                         从 config.example.json 生成配置
  ai-review -h | --help                                  显示帮助

环境变量:
  DEEPSEEK_API_KEY         模型 API Key（或 config 里 model.apiKeyEnv 指定）
  AI_REVIEW_CONFIG         配置文件路径（默认 ./ai-review.config.json）
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