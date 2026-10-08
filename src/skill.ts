import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { callModel } from "./reviewer.js";
import type { ModelConfig } from "./config.js";

/** .agents 目录（src 与 dist 均位于仓库根下一级，向上取根） */
const AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".agents");

/** 仓库根（.agents 的上级）：仓库内 skill 自带脚本以仓库相对路径调用，故作为缺省执行根 */
export const REPO_ROOT = join(AGENTS_DIR, "..");

/** 平台自带 skill 根目录 .agents/skills/（每个 skill 一个子目录，内含 SKILL.md） */
const SKILLS_ROOT = join(AGENTS_DIR, "skills");

/** skill 名 → .agents 下目录名（平台节点 runner 的 skill:<name> 与此对应） */
export const SKILL_DIRS: Record<string, string> = {
  "research-crawler": "research-crawler-skill",
  "product-analysis": "product-analysis-skill",
  "product-manager": "product-manager-skill",
};

/** 附件文本注入 prompt 的单文件长度上限（超出截断，防上下文溢出） */
const UPLOAD_TEXT_LIMIT = 8000;

/** skill 执行输入 */
export interface SkillRunInput {
  /** skill 名，见 SKILL_DIRS */
  skill: string;
  /** 需求文字描述 */
  requirement: string;
  /** 附件绝对路径列表（可为空） */
  uploads: string[];
  /** 输出目录绝对路径（调用方已校验在白名单根内） */
  outputDir: string;
  /** 进度回调：pct 0-100 + 阶段文案 */
  onProgress: (pct: number, label: string) => void;
  /** 产物文件名主干（不含扩展名）；缺省用 <skill>-<时间戳> */
  filenameBase?: string;
  /** 触发人邮箱，仅用于把本次 token 用量归到本人（缺省不归属） */
  email?: string;
}

/** skill 执行结果 */
export interface SkillRunResult {
  /** 产物文件名（不含路径） */
  artifactName: string;
  /** 产物绝对路径 */
  artifactPath: string;
}

/** 读取 SKILL.md 并剥离 frontmatter；skill 未安装时抛错 */
export function resolveSkillDoc(skill: string): string {
  const dir = SKILL_DIRS[skill];
  if (!dir) throw new Error(`未知 skill：${skill}`);
  return resolveSkillDocByName(dir);
}

/** 按目录名读取 .agents/skills/<dir>/SKILL.md 并剥离 frontmatter；不存在时回退旧布局 */
export function resolveSkillDocByName(dir: string): string {
  const candidates = [join(SKILLS_ROOT, dir, "SKILL.md"), join(AGENTS_DIR, dir, "SKILL.md")];
  const file = candidates.find((p) => existsSync(p));
  if (!file) throw new Error(`skill 未安装：${candidates[0]}`);
  const raw = readFileSync(file, "utf8");
  // 剥离 YAML frontmatter（--- 包围的首段）
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

/** skill 元信息（用于对话页列出可调用的 skill） */
export interface SkillInfo {
  /** 目录名（调用时作为 skill 标识） */
  dir: string;
  /** 展示名（frontmatter name，缺省取目录名） */
  name: string;
  /** 一句话描述（frontmatter description，缺省取正文首行） */
  description: string;
  /** 是否含脚本等非 Markdown 文件：true 需真执行环境（agent），false 为纯文档 skill */
  executable: boolean;
}

/** 扫描 skill 目录时跳过的噪音目录（依赖、缓存、编辑器元数据） */
const SKILL_SCAN_SKIP = new Set(["node_modules", "venv", "__pycache__"]);

/** 判定 skill 目录是否含非 Markdown 文件（脚本/资源）：纯文档目录只需把 SKILL.md 注入上下文 */
export function skillHasExecutables(dir: string): boolean {
  const walk = (cur: string): boolean => {
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKILL_SCAN_SKIP.has(e.name)) continue;
      if (e.isDirectory()) {
        if (walk(join(cur, e.name))) return true;
        continue;
      }
      if (e.isFile() && !e.name.toLowerCase().endsWith(".md")) return true;
    }
    return false;
  };
  return walk(join(SKILLS_ROOT, dir));
}

/** 读取 SKILL.md 的 frontmatter 中某个字段（简单行匹配，取不到返回空串） */
function frontmatterField(raw: string, key: string): string {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return "";
  const line = m[1].split(/\r?\n/).find((l) => l.trim().toLowerCase().startsWith(`${key.toLowerCase()}:`));
  if (!line) return "";
  return line.slice(line.indexOf(":") + 1).trim().replace(/^["']|["']$/g, "");
}

/** 列出 .agents/skills 下所有已安装 skill（含 SKILL.md 的目录，按目录名排序） */
export function listSkills(): SkillInfo[] {
  let dirs: string[];
  try {
    dirs = readdirSync(SKILLS_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const out: SkillInfo[] = [];
  for (const dir of dirs.sort()) {
    let raw: string;
    try {
      raw = readFileSync(join(SKILLS_ROOT, dir, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    const description =
      frontmatterField(raw, "description") ||
      raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").split(/\r?\n/).find((l) => l.trim())?.trim() ||
      "";
    out.push({ dir, name: frontmatterField(raw, "name") || dir, description, executable: skillHasExecutables(dir) });
  }
  return out;
}

/** 净化上传文件名：只取 basename，白名单字符外的替换为 _，空名兜底 */
export function sanitizeFilename(name: string): string {
  const base = basename(name || "").replace(/[\\/:*?"<>|\s]+/g, "_").replace(/[^-\w.\u4e00-\u9fa5]/g, "");
  return base || "file";
}

/** 读取文本附件内容（二进制或读取失败时返回 null，只列名不注入正文） */
function readTextUpload(file: string): string | null {
  const buf = readFileSync(file);
  // 简单二进制探测：含 \0 视为二进制
  if (buf.includes(0)) return null;
  const text = buf.toString("utf8");
  if (/\uFFFD/.test(text.slice(0, 2000))) return null;
  return text.length > UPLOAD_TEXT_LIMIT ? text.slice(0, UPLOAD_TEXT_LIMIT) + "\n…（内容过长已截断）" : text;
}

/** 组装用户 prompt：需求 + 附件内容 + 交付要求 */
export function buildSkillPrompt(requirement: string, uploads: { name: string; content: string | null }[]): string {
  const lines: string[] = [
    `请按你的技能流程处理以下任务，产出完整的中文 Markdown 文档。`,
    ``,
    `## 需求描述`,
    requirement.trim() || "（未填写需求文字，请依据附件自行定界；无附件时给出标准框架产出）",
  ];
  if (uploads.length) {
    lines.push(``, `## 附件（${uploads.length} 个）`);
    for (const u of uploads) {
      lines.push(``, `### ${u.name}`, u.content ?? "（二进制附件，仅提供文件名，不做内容分析）");
    }
  }
  lines.push(
    ``,
    `## 交付要求`,
    `- 直接输出 Markdown 正文（不要包裹在代码块里，不要解释你做了什么）。`,
    `- 遵循你的技能文档中的流程与质量门禁，产出物需可独立阅读。`,
    `- 文首用一级标题给出文档类型与主题，文末列出依据与未验证假设。`
  );
  return lines.join("\n");
}

/** 带指数退避的重试模型调用（429 / 5xx 重试，最多 3 次）。target 为 skill 名，仅用于模型请求日志 */
async function callWithRetry(model: ModelConfig, prompt: string, system: string, target?: string, email?: string): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await callModel(model, prompt, { json: false, system, source: "skill", target, email });
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message ?? "");
      const retryable = /模型接口 (429|5\d\d)/.test(msg);
      if (!retryable || i === 2) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}

/** 执行一个 skill：SKILL.md 作系统提示 → LLM 生成 → 写产物文件。
 *  不感知节点/权限，进度经 onProgress 回调上报。 */
export async function runSkill(input: SkillRunInput, model: ModelConfig): Promise<SkillRunResult> {
  input.onProgress(10, "准备 skill 上下文");
  const doc = SKILL_DIRS[input.skill]
    ? resolveSkillDoc(input.skill)
    : resolveSkillDocByName(input.skill);

  input.onProgress(35, "读取需求与附件");
  const uploads = input.uploads.map((p) => ({
    name: basename(p),
    content: (() => {
      try {
        return readTextUpload(p);
      } catch {
        return null;
      }
    })(),
  }));
  const prompt = buildSkillPrompt(input.requirement, uploads);

  input.onProgress(70, "模型生成中");
  const content = await callWithRetry(model, prompt, doc, input.skill, input.email);

  input.onProgress(95, "写产物文件");
  mkdirSync(input.outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const base = input.filenameBase ?? `${input.skill}-${stamp}`;
  const artifactName = sanitizeFilename(`${base}.md`);
  const artifactPath = join(input.outputDir, artifactName);
  writeFileSync(artifactPath, content, "utf8");

  input.onProgress(100, "完成");
  return { artifactName, artifactPath };
}
