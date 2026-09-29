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

export interface ReviewsConfig {
  /** 评审记录聚合扫描根目录列表（相对当前仓库根或绝对路径），递归查找 .ai-review-reports/ 下的报告 JSON */
  scanRoots?: string[];
  /** GitHub token 所在环境变量名（用于 Trees API 拉取仓库目录树，缺省 GH_TOKEN） */
  gitHubTokenEnv?: string;
}

/** AI 对话页（/chat）的配置 */
export interface ChatConfig {
  /** 系统提示词，缺省为平台默认助手设定 */
  systemPrompt?: string;
  /** 拼进 prompt 的最近历史消息条数上限，缺省 50 */
  maxHistory?: number;
  /** 单次回复最大 token 数，缺省 2000 */
  maxTokens?: number;
  /** 采样温度，缺省 0.7 */
  temperature?: number;
  /** 未压缩历史原文累计字数超过该值时触发记忆压缩（调模型生成摘要落库），缺省 400 */
  compressChars?: number;
}

/** 节点 01「产品调研」调用的外部调研 agent（Research-Crawler）配置 */
export interface CrawlerConfig {
  /** agent 项目根目录（绝对路径，或相对当前工作目录）；agent 在该目录内运行 */
  root?: string;
  /** agent CLI 可执行文件，缺省 claude */
  command?: string;
  /** 传给 agent CLI 的参数；需求文本经 stdin 传入，不拼进命令行 */
  args?: string[];
  /** agent 产出目录名（相对 root），打包成 zip 的对象，缺省 output */
  outputDir?: string;
  /** agent 执行超时毫秒，缺省 600000（10 分钟） */
  timeoutMs?: number;
}

export interface ReviewConfig {
  diff: DiffConfig;
  model: ModelConfig;
  /** 命中这些 severity 视为阻塞合并 */
  severityBlocked: string[];
  targets: TargetRemote[];
  /** 自定义评审规则（预留，后续可扩展） */
  rules?: Record<string, unknown>;
  /** 评审平台相关配置（聚合扫描、目录树数据源等） */
  reviews?: ReviewsConfig;
  /** 节点 01 产品调研的调研 agent 配置 */
  crawler?: CrawlerConfig;
  /** AI 对话页（/chat）配置 */
  chat?: ChatConfig;
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
  cfg.reviews = cfg.reviews ?? {};
  cfg.reviews.scanRoots = cfg.reviews.scanRoots ?? ["."];
  cfg.reviews.gitHubTokenEnv = cfg.reviews.gitHubTokenEnv ?? "GH_TOKEN";
  cfg.crawler = cfg.crawler ?? {};
  cfg.crawler.root = cfg.crawler.root ?? "";
  cfg.crawler.command = cfg.crawler.command ?? "claude";
  cfg.crawler.args = cfg.crawler.args ?? ["-p", "--permission-mode", "bypassPermissions"];
  cfg.crawler.outputDir = cfg.crawler.outputDir ?? "output";
  cfg.crawler.timeoutMs = cfg.crawler.timeoutMs ?? 600000;
  cfg.chat = cfg.chat ?? {};
  cfg.chat.systemPrompt =
    cfg.chat.systemPrompt ??
    "你是 ai-flows 平台的 AI 助手，擅长代码评审、产品规划与技术方案。回答简洁专业，必要时给出代码示例。";
  cfg.chat.maxHistory = cfg.chat.maxHistory ?? 50;
  cfg.chat.maxTokens = cfg.chat.maxTokens ?? 2000;
  cfg.chat.temperature = cfg.chat.temperature ?? 0.7;
  cfg.chat.compressChars = cfg.chat.compressChars ?? 400;
  return cfg;
}