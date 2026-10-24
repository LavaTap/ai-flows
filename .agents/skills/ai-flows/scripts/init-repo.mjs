#!/usr/bin/env node
/**
 * ai-flows 仓库初始化脚本
 *
 * 用法：
 *   node init-repo.mjs <target-repo-path>
 *   node init-repo.mjs            # 默认当前工作目录
 *
 * 做三件事：
 *   1. 校验目标是 git 仓库
 *   2. 从 ai-flows 项目拷贝 config.example.json → <target>/ai-review.config.json（已存在跳过）
 *   3. 在 <target>/.git/hooks/pre-push 安装 hook（已有则备份）
 *
 * 仅用 node 内置模块，零依赖。
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// 脚本位置：…/ai-flows/.agents/skills/ai-flows/scripts/init-repo.mjs
// 向上 4 级到 ai-flows 项目根：
//   scripts/ → ai-flows(skill) → skills → .agents → ai-flows(root)
const AI_FLOWS_ROOT = resolve(SCRIPT_DIR, "..", "..", "..", "..");
const CONFIG_TEMPLATE = join(AI_FLOWS_ROOT, "config.example.json");
const CLI_ENTRY = join(AI_FLOWS_ROOT, "src", "index.ts");

function fail(msg) {
  console.error(`${RED}${msg}${RESET}`);
  process.exit(1);
}

function main() {
  const target = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
  console.log(`${DIM}目标仓库：${target}${RESET}`);

  // 1. 校验 git 仓库
  const repo = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: target,
    encoding: "utf8",
  });
  const root = (repo.stdout || "").trim();
  if (repo.status !== 0 || !root) {
    fail(`不是 git 仓库：${target}（请先 git init 或检查路径）`);
  }
  console.log(`${DIM}git 仓库根：${root}${RESET}`);

  // 2. 拷贝配置
  const dest = join(root, "ai-review.config.json");
  if (existsSync(dest)) {
    console.log(`${DIM}ai-review.config.json 已存在，跳过拷贝${RESET}`);
  } else {
    if (!existsSync(CONFIG_TEMPLATE)) {
      fail(`找不到配置模板：${CONFIG_TEMPLATE}`);
    }
    copyFileSync(CONFIG_TEMPLATE, dest);
    console.log(`${GREEN}✔ 已生成 ${dest.replace(/\\/g, "/")}${RESET}`);
  }

  // 3. 安装 pre-push hook
  const hookDir = join(root, ".git", "hooks");
  const hookPath = join(hookDir, "pre-push");
  mkdirSync(hookDir, { recursive: true });

  if (existsSync(hookPath)) {
    const bak = `${hookPath}.bak-${Date.now()}`;
    copyFileSync(hookPath, bak);
    console.log(`${DIM}已有 pre-push hook，已备份：${bak.replace(/\\/g, "/")}${RESET}`);
  }

  if (!existsSync(CLI_ENTRY)) {
    fail(`找不到 ai-review CLI 入口：${CLI_ENTRY}`);
  }
  const cli = CLI_ENTRY.replace(/\\/g, "/");
  // hook 用 npx tsx 跑 TS 源码，免依赖预构建；ai-review 内部推送置
  // AI_REVIEW_INTERNAL_PUSH=1 跳过本 hook，避免循环拦截。
  const hook = `#!/bin/sh
# ai-review pre-push hook：push 前自动 AI 评审并出页面；始终拦截本次 git push，
# 引导用户到评审页面点「确认提交」按钮，由评审服务代为推送到远端。
# ai-review 内部推送（页面按钮触发）会设 AI_REVIEW_INTERNAL_PUSH=1 跳过本 hook。
[ "$AI_REVIEW_INTERNAL_PUSH" = "1" ] && exit 0

repo="$(git rev-parse --show-toplevel)" || exit 0
[ -f "$repo/ai-review.config.json" ] || exit 0
command -v npx >/dev/null 2>&1 || exit 0
cd "$repo" || exit 0
npx tsx "${cli}" run --config ai-review.config.json --no-push --page
rc=$?
if [ "$rc" = "0" ]; then
  echo "[ai-review] 评审通过（退出码=$rc）。请打开上述评审页面，点击「确认提交」按钮推送到远端。"
else
  echo "[ai-review] 评审未通过（退出码=$rc），已拦截，未进入提交环节。请打开上述评审页面查看阻塞问题。"
fi
echo "[ai-review] 本次 git push 已被拦截：评审通过后需在页面确认提交，由评审服务推送。"
exit 1
`;

  writeFileSync(hookPath, hook, { encoding: "utf8", mode: 0o755 });
  console.log(`${GREEN}✔ 已安装 pre-push hook：${hookPath.replace(/\\/g, "/")}${RESET}`);

  console.log(`\n${DIM}── 下一步 ──${RESET}`);
  console.log(`${DIM}1. 设置模型 API Key：export DEEPSEEK_API_KEY=...${RESET}`);
  console.log(`${DIM}2. 按需修改 ${dest.replace(/\\/g, "/")}（model / targets）${RESET}`);
  console.log(`${DIM}3. 之后 git push 会先被拦截跑评审，再到页面点「确认提交」推送${RESET}`);
}

main();
