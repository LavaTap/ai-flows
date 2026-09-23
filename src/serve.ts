import { createServer, type Server } from "node:http";

const reports = new Map<string, string>();
const ORDER: string[] = [];

function indexHtml(): string {
  const items = ORDER.map(
    (id) => `<li><a href="/reports/${encodeURIComponent(id)}">${escapeHtml(id)}</a></li>`
  ).join("");
  const body = ORDER.length
    ? `<ul>${items}</ul>`
    : "<p class='muted'>暂无报告。运行 <code>ai-review run --page</code> 生成。</p>";
  return layout("AI 代码评审 · 报告列表", body);
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
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

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface ReportServer {
  server: Server;
  port: number;
  url: string;
  register(id: string, html: string): string;
  close(): Promise<void>;
}

/** 启动本地评审报告 HTTP 服务。调用 register() 注册报告后，进程会持续存活（可 Ctrl+C 停止）。 */
export async function startReportServer(
  opts: { host?: string; port?: number } = {}
): Promise<ReportServer> {
  const host = opts.host ?? "127.0.0.1";

  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const u = new URL(req.url ?? "/", `http://${host}`);
    const path = u.pathname;

    if (path === "/") {
      res.end(indexHtml());
      return;
    }
    const m = path.match(/^\/reports\/(.+)$/);
    if (m && reports.has(m[1])) {
      res.end(layout(m[1], reports.get(m[1])!));
      return;
    }
    if (path === "/health") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("ok");
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });

  const url = `http://${host}:${port}`;
  const register = (id: string, html: string): string => {
    reports.set(id, html);
    if (!ORDER.includes(id)) ORDER.push(id);
    return `${url}/reports/${encodeURIComponent(id)}`;
  };

  return {
    server,
    port,
    url,
    register,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}