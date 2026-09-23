import { createServer, type Server } from "node:http";
import { readdirSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** 存放评审 HTML 报告的目录名（在该 git 仓库根下） */
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
<title>${esc(title)}</title>
<style>
  :root{--bg:#0b0f1a;--panel:#111827;--border:#1e293b;--text:#e2e8f0;--muted:#94a3b8;--accent:#38bdf8;}
  *{box-sizing:border-box;} body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;}
  .wrap{max-width:1080px;margin:0 auto;padding:32px 24px;}
  h1{font-size:24px;margin:0 0 16px;} ul{line-height:2;}
  a{color:var(--accent);} code{font-family:ui-monospace,Menlo,monospace;font-size:12px;}
  .muted{color:var(--muted);}
</style></head>
<body class="wrap">${body}</body></html>`;
}

function indexHtml(dir: string): string {
  let files: string[] = [];
  if (existsSync(dir)) {
    files = readdirSync(dir).filter((f) => f.endsWith(".html")).sort().reverse();
  }
  const items = files
    .map((f) => {
      const id = f.slice(0, -5);
      return `<li><a href="/reports/${encodeURIComponent(id)}">${esc(id)}</a></li>`;
    })
    .join("");
  const body = items.length ? `<ul>${items}</ul>` : "<p class='muted'>暂无报告。</p>";
  return layout("AI 代码评审 · 报告列表", body);
}

export interface ReportServer {
  server: Server;
  port: number;
  host: string;
  url: string;
  close(): Promise<void>;
}

/** 以目录为数据源启动报告 HTTP 服务。GET /reports/<id> 读取 <dir>/<id>.html。 */
export async function startReportServer(
  opts: { host?: string; port?: number; dir?: string } = {}
): Promise<ReportServer> {
  const host = opts.host ?? "127.0.0.1";
  const dir = opts.dir ?? REPORTS_DIR;
  mkdirSync(dir, { recursive: true });

  const server = createServer((req, res) => {
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
    const m = path.match(/^\/reports\/([^/\\]+)$/);
    if (m) {
      const f = join(dir, m[1] + ".html");
      if (f.startsWith(dir + "") && existsSync(f)) {
        res.end(readFileSync(f, "utf8"));
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