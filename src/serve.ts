import { createServer, type Server, type IncomingMessage } from "node:http";
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderTemplate, type ReportView } from "./reporter.js";
import { pushToTargets } from "./publisher.js";
import { stagedFiles, commitStaged, headCommit, amendCommitMessage } from "./git.js";

/** 存放评审报告数据（JSON）的目录名（在该 git 仓库根下） */
export const REPORTS_DIR = ".ai-review-reports";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="theme-color" content="#0b0f1a"/>
<title>${esc(title)}</title>
<style>
  :root{--bg:#0b0f1a;--panel:#111827;--border:#1e293b;--text:#e2e8f0;--muted:#94a3b8;--accent:#38bdf8;
        --ok:#7adcc0;--ok-soft:rgba(122,220,192,.12);--block:#f05545;--block-soft:rgba(240,85,69,.12);}
  /* 日间主题变量覆盖（与报告页主题保持一致的浅底配色） */
  [data-theme="light"]{--bg:#f6f2ea;--panel:#ffffff;--border:rgba(60,40,20,.14);--text:#2a2018;--muted:#52483f;--accent:#2760b8;
        --ok:#167d55;--ok-soft:rgba(22,125,85,.10);--block:#bf3222;--block-soft:rgba(191,50,34,.10);}
  *{box-sizing:border-box;} body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;}
  .wrap{max-width:1080px;margin:0 auto;padding:32px 24px;}
  .page-head{display:flex;justify-content:flex-end;margin:0 0 12px;}
  h1{font-size:24px;margin:0 0 16px;} ul{line-height:2;}
  a{color:var(--accent);} code{font-family:ui-monospace,Menlo,monospace;font-size:12px;}
  .muted{color:var(--muted);}
  .reports{list-style:none;padding:0;margin:0;}
  .reports li{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--border);}
  .pill{font-size:11px;font-weight:700;letter-spacing:1px;padding:2px 9px;border-radius:999px;}
  .pill.pass{color:var(--ok);background:var(--ok-soft);}
  .pill.block{color:var(--block);background:var(--block-soft);}
  .theme-toggle{appearance:none;background:var(--panel);border:1px solid var(--border);color:var(--muted);width:34px;height:34px;border-radius:8px;display:inline-grid;place-items:center;cursor:pointer;transition:all 150ms ease;padding:0;}
  .theme-toggle:hover{color:var(--text);}
  .theme-toggle:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
  .theme-toggle svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
  .theme-toggle .icon-sun{display:none;}
  [data-theme="light"] .theme-toggle .icon-sun{display:block;}
  [data-theme="light"] .theme-toggle .icon-moon{display:none;}
</style>
<script>
  (function(){
    try {
      var t = localStorage.getItem('ai-review-theme');
      if (t !== 'light' && t !== 'dark') t = 'dark';
      document.documentElement.setAttribute('data-theme', t);
    } catch (e) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  })();
</script>
</head>
<body class="wrap">
<div class="page-head">
  <button type="button" class="theme-toggle" id="themeToggle" title="切换日间/夜间主题" aria-label="切换日间/夜间主题">
    <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>
    <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><line x1="12" y1="2" x2="12" y2="5"></line><line x1="12" y1="19" x2="12" y2="22"></line><line x1="2" y1="12" x2="5" y2="12"></line><line x1="19" y1="12" x2="22" y2="12"></line><line x1="4.6" y1="4.6" x2="6.7" y2="6.7"></line><line x1="17.3" y1="17.3" x2="19.4" y2="19.4"></line><line x1="4.6" y1="19.4" x2="6.7" y2="17.3"></line><line x1="17.3" y1="6.7" x2="19.4" y2="4.6"></line></svg>
  </button>
</div>
${body}
<script>
(function(){
  var toggle = document.getElementById('themeToggle');
  var meta = document.querySelector('meta[name="theme-color"]');
  function applyTheme(t){
    document.documentElement.setAttribute('data-theme', t);
    if(meta) meta.setAttribute('content', t === 'light' ? '#f6f2ea' : '#0b0f1a');
    try { localStorage.setItem('ai-review-theme', t); } catch(e){}
  }
  if(meta) meta.setAttribute('content', document.documentElement.getAttribute('data-theme') === 'light' ? '#f6f2ea' : '#0b0f1a');
  if(toggle){
    toggle.addEventListener('click', function(){
      applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    });
  }
})();
</script>
</body></html>`;
}

interface ReportSummary {
  id: string;
  passed: boolean;
  generatedAt: string;
  total: number;
  blocker: number;
  warning: number;
  info: number;
  ref?: string;
}

/** 读取请求体并按给定上限截断，防止恶意大 body 耗尽内存 */
function readBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** 读取目录下全部报告 JSON 的摘要（按 id 倒序，即新的在前） */
function readSummaries(dir: string): ReportSummary[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .map((f) => {
      const id = f.slice(0, -5);
      const base: ReportSummary = {
        id,
        passed: false,
        generatedAt: "",
        total: 0,
        blocker: 0,
        warning: 0,
        info: 0,
      };
      try {
        const v = JSON.parse(readFileSync(join(dir, f), "utf8")) as ReportView;
        return {
          ...base,
          passed: !!v.passed,
          generatedAt: v.generatedAt ?? "",
          total: v.total ?? 0,
          blocker: v.counts?.blocker ?? 0,
          warning: v.counts?.warning ?? 0,
          info: v.counts?.info ?? 0,
          ref: v.ref,
        };
      } catch {
        return base;
      }
    });
}

function indexHtml(dir: string): string {
  const items = readSummaries(dir);
  const rows = items
    .map((s) => {
      const meta = [s.generatedAt, s.ref].filter(Boolean).map((x) => esc(String(x))).join(" · ");
      return `<li>
      <a href="/reports/${encodeURIComponent(s.id)}">${esc(s.id)}</a>
      <span class="pill ${s.passed ? "pass" : "block"}">${s.passed ? "PASS" : "BLOCK"}</span>
      <span class="muted">${meta}</span>
      <span class="muted">blocker ${s.blocker} · warning ${s.warning} · info ${s.info}</span>
    </li>`;
    })
    .join("");
  const body = items.length ? `<ul class="reports">${rows}</ul>` : "<p class='muted'>暂无报告。</p>";
  return layout("AI 代码评审 · 报告列表", body);
}

export interface ReportServer {
  server: Server;
  port: number;
  host: string;
  url: string;
  close(): Promise<void>;
}

/** 以目录为数据源启动报告 HTTP 服务。GET /reports/<id> 读取 <dir>/<id>.json 并动态渲染。 */
export async function startReportServer(
  opts: { host?: string; port?: number; dir?: string } = {}
): Promise<ReportServer> {
  const host = opts.host ?? "127.0.0.1";
  const dir = opts.dir ?? REPORTS_DIR;
  mkdirSync(dir, { recursive: true });

  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const u = new URL(req.url ?? "/", `http://${host}`);
    const path = u.pathname;

    if (path === "/") {
      res.end(indexHtml(dir));
      return;
    }
    if (path === "/health") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("ok");
      return;
    }
    // 确认提交：页面按钮 POST 触发。必须带非空 commit message 才允许提交，
    // 避免误触导致「自动提交」到远端。有暂存变更时先 commit 再 push。
    const pm = path.match(/^\/reports\/([^/\\]+)\/push$/);
    if (pm && req.method === "POST") {
      const f = join(dir, pm[1] + ".json");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      if (!f.startsWith(dir + "") || !existsSync(f)) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "报告不存在" }));
        return;
      }
      try {
        const view = JSON.parse(readFileSync(f, "utf8")) as ReportView;
        if (!view.passed) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "评审未通过，禁止推送" }));
          return;
        }
        if (!view.targets || !view.targets.length || !view.repoCwd) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "未配置推送目标或仓库路径" }));
          return;
        }
        // 解析 commit message：必须非空，作为提交确认门禁
        let message = "";
        try {
          const parsed = JSON.parse(await readBody(req)) as { message?: unknown };
          if (typeof parsed.message === "string") message = parsed.message.trim();
        } catch {
          /* body 解析失败视为空 message，下面拦截 */
        }
        if (!message) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "请输入 commit 提交信息后再提交" }));
          return;
        }
        // 有暂存变更：先用该信息提交；无暂存但信息与 HEAD 不同：amend 改写最近一次提交；否则直接推送
        const staged = await stagedFiles(view.repoCwd);
        let amended = false;
        if (staged.length) {
          await commitStaged(message, view.repoCwd);
        } else {
          const head = await headCommit(view.repoCwd);
          if (head && head.message !== message) {
            await amendCommitMessage(message, view.repoCwd);
            amended = true;
          }
        }
        const pushes = await pushToTargets(view.targets, view.repoCwd);
        const headAfter = await headCommit(view.repoCwd);
        const commitInfo = {
          committed: staged.length > 0,
          files: staged.length,
          amended,
          hash: headAfter?.short ?? "",
          subject: headAfter?.subject ?? "",
          message,
        };
        writeFileSync(f, JSON.stringify({ ...view, pushes, commit: commitInfo }, null, 2), "utf8");
        res.end(JSON.stringify({ pushes, commit: commitInfo }));
      } catch (err: any) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
      return;
    }
    const m = path.match(/^\/reports\/([^/\\]+)$/);
    if (m) {
      const f = join(dir, m[1] + ".json");
      if (f.startsWith(dir + "") && existsSync(f)) {
        try {
          const view = JSON.parse(readFileSync(f, "utf8")) as ReportView;
          // 实时注入 HEAD 提交信息：提交栏展示 commit 描述，改写信息后确认走 amend
          if (view.repoCwd) view.head = (await headCommit(view.repoCwd)) ?? undefined;
          res.end(renderTemplate(view));
        } catch {
          res.statusCode = 500;
          res.end("报告数据无法解析");
        }
        return;
      }
    }
    res.statusCode = 404;
    res.end("not found");
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => {
      const a = server.address();
      resolve(typeof a === "object" && a ? a.port : 0);
    });
  });

  return {
    server,
    port,
    host,
    url: `http://${host}:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}