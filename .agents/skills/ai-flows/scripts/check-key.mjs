#!/usr/bin/env node
/**
 * 模型密钥有效性检查
 *
 * 用法：
 *   node check-key.mjs [config-path]
 *   node check-key.mjs                       # 默认读取当前目录 ai-review.config.json
 *
 * 读 config 的 model 段，按 model.apiKey > model.apiKeyEnv 指向的环境变量解析密钥，
 * 向 model.baseUrl 发一个最小 chat/completions 请求验证密钥是否可用。
 *   退出码 0 = 密钥有效
 *   退出码 1 = 配置缺失 / 密钥缺失或无效（并打印重新配置指引）
 *
 * 仅用 node 内置模块，零依赖（Node >= 18，用全局 fetch）。
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const RED = "\u001b[31m";
const YELLOW = "\u001b[33m";
const GREEN = "\u001b[32m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

/** 打印重新配置密钥与模型的指引 */
function guidance(reason) {
  console.error(`${RED}✖ 密钥检查未通过：${reason}${RESET}`);
  console.error(`${YELLOW}请重新配置密钥与模型：${RESET}`);
  console.error(`${DIM}  1. 取得模型 API Key（DeepSeek / OpenAI 兼容接口）${RESET}`);
  console.error(`${DIM}  2. 设置环境变量（推荐）：${RESET}`);
  console.error(`${DIM}       PowerShell 当前会话：$env:DEEPSEEK_API_KEY="sk-xxxx"${RESET}`);
  console.error(`${DIM}       PowerShell 永久：    setx DEEPSEEK_API_KEY "sk-xxxx"  # 需重开终端${RESET}`);
  console.error(`${DIM}       bash/zsh：          export DEEPSEEK_API_KEY=sk-xxxx${RESET}`);
  console.error(`${DIM}  3. 或修改 ai-review.config.json 的 model 段（baseUrl / apiKeyEnv / model / apiKey）${RESET}`);
  console.error(`${DIM}  4. 重新运行本脚本确认通过${RESET}`);
}

function truncate(s, n = 300) {
  const t = (s || "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

async function main() {
  const cfgPath = resolve(process.argv[2] || "ai-review.config.json");
  if (!existsSync(cfgPath)) {
    guidance(`找不到配置文件 ${cfgPath}（用参数指定路径，或先 ai-review init 生成）`);
    process.exitCode = 1;
    return;
  }

  let cfg;
  try {
    cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch (err) {
    guidance(`配置文件不是合法 JSON：${cfgPath}`);
    process.exitCode = 1;
    return;
  }

  const model = cfg.model || {};
  const baseUrl = (model.baseUrl || "").trim();
  const keyName = (model.apiKeyEnv || "").trim();
  const inlineKey = (model.apiKey || "").trim();
  const key = inlineKey || (keyName ? (process.env[keyName] || "").trim() : "");
  const modelName = (model.model || "").trim();

  if (!key) {
    guidance(
      inlineKey
        ? "配置里的 model.apiKey 为空"
        : keyName
          ? `环境变量 ${keyName} 未设置或为空`
          : "配置未指定 model.apiKeyEnv，且 model.apiKey 为空"
    );
    process.exitCode = 1;
    return;
  }
  if (!baseUrl) {
    guidance("配置缺少 model.baseUrl");
    process.exitCode = 1;
    return;
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  console.log(`${DIM}校验密钥（模型 ${modelName || "<未指定>"}）→ ${url}${RESET}`);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20000);
  let res;
  let body = "";
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: modelName || "deepseek-chat",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
      signal: ac.signal,
    });
    body = await res.text();
  } catch (err) {
    clearTimeout(timer);
    guidance(`无法连接模型服务（网络不通或超时）：${err && err.message ? err.message : err}`);
    process.exitCode = 1;
    return;
  }
  clearTimeout(timer);

  if (res.ok) {
    console.log(`${GREEN}✔ 密钥有效，模型服务可用（${modelName || "<未指定>"}）${RESET}`);
    process.exitCode = 0;
    return;
  }
  if (res.status === 401 || res.status === 403) {
    guidance(`模型服务返回 ${res.status}，密钥无效或无权限：${truncate(body)}`);
  } else if (res.status === 404) {
    guidance(`模型服务返回 404，model.baseUrl 可能不对：${url}`);
  } else {
    guidance(`模型服务返回 ${res.status}：${truncate(body)}`);
  }
  process.exitCode = 1;
}

main();
