import { git, currentBranch } from "./git.js";
import type { TargetRemote } from "./config.js";

export interface PushResult {
  name: string;
  ok: boolean;
  message: string;
}

/** 为 https URL 注入 token：https://user:token@host/path */
function injectToken(remoteUrl: string, user: string | undefined, token: string): string {
  const m = remoteUrl.match(/^(https?:\/\/)(.+)$/);
  if (!m) return remoteUrl; // 非 https 地址（如 ssh）不做注入
  const scheme = m[1];
  const rest = m[2];
  const withoutCreds = rest.replace(/^([^/@]+@)/, "");
  return `${scheme}${encodeURIComponent(user ?? "git")}:${encodeURIComponent(token)}@${withoutCreds}`;
}

/** 单目标推送 */
async function pushOne(target: TargetRemote, cwd?: string): Promise<PushResult> {
  try {
    const branch = target.branch ?? (await currentBranch(cwd));
    let remote: string;

    if (target.remoteUrl) {
      remote = target.remoteUrl;
      if (target.auth === "token" && target.tokenEnv && process.env[target.tokenEnv]) {
        remote = injectToken(remote, target.user, process.env[target.tokenEnv]!);
      }
    } else if (target.remoteName) {
      remote = target.remoteName;
    } else {
      throw new Error(`target "${target.name}" 需要配置 remoteUrl 或 remoteName`);
    }

    await git(["push", remote, `HEAD:${branch}`], cwd);
    return { name: target.name, ok: true, message: `已推送到 ${remote} (${branch})` };
  } catch (err: any) {
    return { name: target.name, ok: false, message: err.message || String(err) };
  }
}

/** 向所有配置的目标远端推送当前 HEAD */
export async function pushToTargets(
  targets: TargetRemote[],
  cwd?: string
): Promise<PushResult[]> {
  if (targets.length === 0) {
    throw new Error("配置里没有 targets，无法推送。");
  }
  const results: PushResult[] = [];
  for (const t of targets) {
    results.push(await pushOne(t, cwd));
  }
  return results;
}