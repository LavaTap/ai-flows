#!/usr/bin/env node
/**
 * 私有仓库推送前置检查
 *
 * 检查一个仓库「能不能安全推送到远端」，三件事：
 *   1. 远端可达性：remote URL 是 ssh 还是 https，ssh 是否已认证（自动走 ~/.ssh/config）
 *   2. 凭据就绪：ssh 免密可用 / https 是否有 credential helper 或 token 环境变量
 *   3. 泄露风险：已被 git 跟踪、但文件名像凭据的文件（cookie / pkl / secret / .env …）
 *
 * 用法：
 *   node check-remote-auth.mjs [repo-path]     # 默认当前工作目录
 *
 * 退出码：0 未发现问题；1 存在阻塞项（认证不通 或 有疑似凭据被跟踪）
 *
 * 只检查、只提示，绝不修改 remote、配置或任何文件。
 * 仅用 node 内置模块，零依赖。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

/** 文件名像凭据的正则（只看路径名，不读内容） */
const SECRET_PATTERN =
  /(^|\/)(\.env|\.env\..*|.*cookie.*|.*credential.*|.*secret.*|.*\.pkl|.*\.pem|.*\.key|.*token.*|accounts?\.json|passwords?.*)$/i;

/** git 命令封装（本脚本只读，不做任何写操作） */
function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim() };
}

/** 解析 remote URL → { scheme, host } */
function parseRemote(url) {
  let m = url.match(/^https?:\/\/([^/]+)\//i);
  if (m) return { scheme: "https", host: m[1] };
  m = url.match(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)/i);
  if (m) return { scheme: "ssh", host: m[1] };
  m = url.match(/^(?:[^@/]+@)?([^:/]+):/);
  if (m) return { scheme: "ssh", host: m[1] };
  return { scheme: "unknown", host: url };
}

/** ssh 认证测试：GitHub/GitLab 成功时也返回非 0，故只看输出文本 */
function testSsh(host) {
  const r = spawnSync(
    "ssh",
    ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", `git@${host}`],
    { encoding: "utf8" }
  );
  const text = `${r.stdout || ""}${r.stderr || ""}`.trim();
  const ok = /successfully authenticated|welcome to|hi [^!]+!/i.test(text);
  return { ok, text: text.split("\n")[0] || "(无输出)" };
}

function main() {
  const target = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
  console.log(`${DIM}检查仓库：${target}${RESET}`);

  const top = git(["rev-parse", "--show-toplevel"], target);
  if (!top.ok) {
    console.error(`${RED}不是 git 仓库：${target}${RESET}`);
    process.exitCode = 1;
    return;
  }
  const repo = top.out;
  let blocking = 0;

  // 1. 远端与认证
  const remotesRaw = git(["remote", "-v"], repo).out;
  const remotes = new Map();
  for (const line of remotesRaw.split("\n")) {
    const [name, url] = line.split(/\s+/);
    if (name && url && !remotes.has(name)) remotes.set(name, url);
  }
  console.log(`\n${DIM}── 远端与认证 ──${RESET}`);
  if (remotes.size === 0) {
    console.log(`${YELLOW}⚠ 未配置任何 remote${RESET}`);
  }
  for (const [name, url] of remotes) {
    const { scheme, host } = parseRemote(url);
    if (scheme === "ssh") {
      const r = testSsh(host);
      if (r.ok) console.log(`${GREEN}✔ [${name}] ssh ${host} 已认证${RESET} ${DIM}${r.text}${RESET}`);
      else {
        blocking++;
        console.log(`${RED}✖ [${name}] ssh ${host} 认证失败${RESET} ${DIM}${r.text}${RESET}`);
        console.log(`${DIM}    → 生成密钥：ssh-keygen -t ed25519 -N "" -C "<邮箱>"${RESET}`);
        console.log(`${DIM}    → 把 ~/.ssh/id_ed25519.pub 加到平台（GitHub: Settings → SSH keys；或用 gh ssh-key add）${RESET}`);
        console.log(`${DIM}    → 22 端口被墙时，在 ~/.ssh/config 加：Host github.com / HostName ssh.github.com / Port 443 / User git${RESET}`);
      }
    } else if (scheme === "https") {
      const helper = git(["config", "--get", "credential.helper"], repo).out;
      const tokenEnv = ["AI_REVIEW_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"].find(
        (k) => process.env[k]
      );
      if (helper || tokenEnv) {
        console.log(
          `${GREEN}✔ [${name}] https ${host} 有凭据来源${RESET} ${DIM}${helper ? `helper=${helper}` : ""}${tokenEnv ? ` ${tokenEnv} 已设置` : ""}${RESET}`
        );
      } else {
        blocking++;
        console.log(`${YELLOW}⚠ [${name}] https ${host} 未见 credential helper / token 环境变量${RESET}`);
        console.log(`${DIM}    → 私有仓库匿名拉取会失败：配 token 环境变量，或改用 ssh remote${RESET}`);
      }
    } else {
      console.log(`${YELLOW}⚠ [${name}] 无法识别 remote 形式：${url}${RESET}`);
    }
  }

  // 2. ai-review.config.json 的推送目标（若存在）
  const cfgPath = join(repo, "ai-review.config.json");
  if (existsSync(cfgPath)) {
    console.log(`\n${DIM}── config 推送目标 ──${RESET}`);
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      const targets = Array.isArray(cfg.targets) ? cfg.targets : [];
      if (!targets.length) console.log(`${DIM}(未配置 targets)${RESET}`);
      for (const t of targets) {
        if (t.auth === "token") {
          const envName = t.tokenEnv || "（未指定 tokenEnv）";
          const ready = t.tokenEnv && process.env[t.tokenEnv];
          if (ready) console.log(`${GREEN}✔ [${t.name}] token 环境变量 ${envName} 已设置${RESET}`);
          else {
            blocking++;
            console.log(`${RED}✖ [${t.name}] token 环境变量 ${envName} 未设置${RESET}`);
            console.log(`${DIM}    → 设置后重跑；token 只放环境变量，禁止写进 config${RESET}`);
          }
        } else {
          console.log(`${DIM}· [${t.name}] auth=${t.auth ?? "ssh"}（依赖本机 ssh 配置）${RESET}`);
        }
      }
    } catch {
      console.log(`${YELLOW}⚠ ai-review.config.json 不是合法 JSON${RESET}`);
    }
  }

  // 3. 已跟踪的可疑凭据文件
  console.log(`\n${DIM}── 泄露风险扫描（已跟踪文件）──${RESET}`);
  const tracked = git(["ls-files"], repo).out.split("\n").filter(Boolean);
  const suspects = tracked.filter((p) => SECRET_PATTERN.test(p));
  if (suspects.length === 0) {
    console.log(`${GREEN}✔ 未发现文件名像凭据的已跟踪文件${RESET}`);
  } else {
    blocking++;
    console.log(`${RED}✖ 有 ${suspects.length} 个疑似凭据文件已被 git 跟踪，推送会一并上传：${RESET}`);
    for (const p of suspects) console.log(`   ${RED}${p}${RESET}`);
    console.log(`${DIM}    → 仅停止跟踪（保留本地文件）：git rm --cached "<file>"${RESET}`);
    console.log(`${DIM}    → 同时把规则写进 .gitignore，避免再次误加${RESET}`);
    console.log(`${DIM}    → 若已推过远端，凭据需视为已泄露，直接轮换${RESET}`);
  }

  console.log("");
  if (blocking) {
    console.error(`${RED}结论：存在 ${blocking} 项阻塞，先处理后才能安全推送。${RESET}`);
    process.exitCode = 1;
  } else {
    console.log(`${GREEN}结论：认证与凭据就绪，未发现可疑跟踪文件，可以推送。${RESET}`);
  }
}

main();
