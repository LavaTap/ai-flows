import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** 执行 git 命令并返回 stdout（去掉尾部换行） */
export async function git(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await exec("git", args, {
      cwd,
      maxBuffer: 128 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (err: any) {
    const detail = err?.stderr?.trim() || err?.message || String(err);
    throw new Error(`git ${args.join(" ")} 失败：${detail}`);
  }
}

export async function currentBranch(cwd?: string): Promise<string> {
  const out = await git(["branch", "--show-current"], cwd);
  if (!out) throw new Error("无法获取当前分支，请确认在 git 仓库内.");
  return out;
}

/** 根据 diff 配置拼出 git diff 的额外参数 */
function scopeArgs(scope: string, base?: string): string[] {
  if (scope === "staged") return ["--cached"];
  if (scope === "range") return [`${base ?? "HEAD~1"}...HEAD`];
  return []; // working 树（未暂存）
}

/** 抓取 diff 原始文本 */
export async function diffRaw(
  scope: string,
  base?: string,
  cwd?: string
): Promise<string> {
  return git(["diff", ...scopeArgs(scope, base)], cwd);
}

/** 抓取变更文件清单（相对路径） */
export async function diffFiles(
  scope: string,
  base?: string,
  cwd?: string
): Promise<string[]> {
  const out = await git(
    ["diff", "--name-only", "--relative", ...scopeArgs(scope, base)],
    cwd
  );
  return out ? out.split("\n") : [];
}

/** 当前工作目录是否是 git 仓库 */
export async function isRepo(cwd?: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--is-inside-work-tree"], cwd);
    return true;
  } catch {
    return false;
  }
}