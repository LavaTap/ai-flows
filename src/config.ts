import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** 目标远端：评审通过后要推送到的任意 Git 服务器 */
export interface TargetRemote {
  /** 给这个目标起个名字，便于日志识别 */
  name: string;
  /** 远端地址，如 git@xxx:group/repo.git 或 https://... 或 ssh://... */
  remoteUrl?: string;
  /** 复用本仓库已存在的 git remote 名称（如 origin）；与 remoteUrl 二选一 */
  remoteName?: string;
  /** 推送目标分支，缺省用当前分支 */
  branch?: string;
  auth?: "ssh" | "token" | "default" | "package";
  /** https token 认证时用于 URL 的用户名，默认 git */
  user?: string;
  /** https token 所在的环境变量名 */
  tokenEnv?: string;
}

export interface ModelConfig {
  /** OpenAI / DeepSeek 兼容的 base url，如 https://api.deepseek.com */
  baseUrl: string;
  /** 从指定环境变量读取 api key */
  apiKeyEnv?: string;
  /** 直接写 api key（不推荐！优先用 apiKeyEnv 走环境变量） */
  apiKey?: string;
  model: string;
  timeoutMs?: number;
}

export interface DiffConfig {
  /** 采集范围：working(未暂存) / staged(暂存) / range(比较区间) */
  scope: "working" | "staged" | "range";
  /** range 模式下的基准，如 HEAD~1 或 main */
  base?: string;
  /** 排除文件 glob，如 *.lock、dist/**  */
  exclude?: string[];
  /** 单文件变更行数超过该值则降级为摘要评审，避免上下文溢出 */
  maxFileLines?: number;
}

export interface ReviewConfig {
  diff: DiffConfig;
  model: ModelConfig;
  /** 命中这些 severity 视为阻塞合并 */
  severityBlocked: string[];
  targets: TargetRemote[];
  /** 自定义评审规则（预留，后续可扩展） */
  rules?: Record<string, unknown>;
}

const DEFAULT_CONFIG_PATH = "ai-review.config.json";

/** 解析出模型真正使用的 api key：优先 config 内显式值，其次走环境变量 */
export function resolveApiKey(model: ModelConfig): string | undefined {
  if (model.apiKey) return model.apiKey;
  if (model.apiKeyEnv) return process.env[model.apiKeyEnv];
  return undefined;
}

/** 加载配置文件（JSON）。缺省文件名 ai-review.config.json / AI_REVIEW_CONFIG */
export function loadConfig(configPath?: string): ReviewConfig {
  const path = resolve(configPath || process.env.AI_REVIEW_CONFIG || DEFAULT_CONFIG_PATH);
  if (!existsSync(path)) {
    throw new Error(
      `未找到配置文件：${path}\n请复制 config.example.json 为 ai-review.config.json 并按需修改。`
    );
  }
  const raw = readFileSync(path, "utf-8");
  const cfg = JSON.parse(raw) as ReviewConfig;

  cfg.severityBlocked = cfg.severityBlocked ?? ["blocker"];
  cfg.targets = cfg.targets ?? [];
  cfg.diff = cfg.diff ?? { scope: "staged", exclude: [] };
  cfg.diff.scope = cfg.diff.scope ?? "staged";
  cfg.diff.exclude = cfg.diff.exclude ?? [];
  cfg.diff.maxFileLines = cfg.diff.maxFileLines ?? 500;
  return cfg;
}