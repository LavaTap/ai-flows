/* logs.js · 系统日志页（终端视图）
   数据源：window.__LOGS__ = { user, isSupervisor }
   两个视角：AI 请求日志（评审 / AI 对话 / skill 的模型请求）、网页访问日志（页面与 API 请求）
   以等宽终端逐行输出（旧的在上、新的在下，像 `tail -f`），自动刷新 3 秒（可暂停）。
   自动刷新时若用户已滚到底部则继续跟随，向上翻阅历史时保持当前位置不跳动。 */
(function () {
  var boot = window.__LOGS__ || {};
  var isSuper = !!boot.isSupervisor;

  var kind = "ai";
  var timer = null;
  var mounted = false;

  function byId(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** 时间按浏览器本地时区展示（旧数据是 UTC 的 Z 结尾，也能正确换算成本地时间） */
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || "").replace("T", " ").slice(0, 19);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
      p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function token(cls, text) {
    return '<span class="' + cls + '">' + esc(text) + "</span>";
  }

  /** AI 请求日志一行 */
  function aiLine(e) {
    var src = e.source || "";
    var parts = [
      token("t-at", fmtTime(e.at)),
      token("t-tag " + (src === "chat" || src === "skill" ? src : "review"), "[ai " + (src || "?") + "]"),
      token("t-model", e.model || ""),
    ];
    if (e.target) parts.push(token("t-target", e.target));
    parts.push(e.ok ? token("t-ok", "ok") : token("t-err", "失败"));
    parts.push(token("t-ms", e.ms + "ms"));
    parts.push(token("t-meta", "提示 " + e.promptChars + "字 · 回复 " + e.replyChars + "字"));
    if (!e.ok && e.error) parts.push(token("t-err", e.error));
    return '<div class="term-line">' + parts.join("") + "</div>";
  }

  /** 网页访问日志一行（状态码按 2xx/3xx/4xx/5xx 着色） */
  function webLine(e) {
    var s = Number(e.status) || 0;
    var cls = s >= 500 ? "s5" : s >= 400 ? "s4" : s >= 300 ? "s3" : "s2";
    var parts = [
      token("t-at", fmtTime(e.at)),
      token("t-tag web", "[web]"),
      token("t-model", e.method || ""),
      token("t-target", e.path || ""),
      token("t-status " + cls, s),
      token("t-ms", e.ms + "ms"),
    ];
    if (e.email) parts.push(token("t-user", e.email));
    return '<div class="term-line">' + parts.join("") + "</div>";
  }

  /** 终端末尾的空闲提示符（闪烁光标） */
  function promptLine() {
    return '<div class="term-line"><span class="t-ok">$</span><span class="term-cursor"></span></div>';
  }

  function nearBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  function render(entries) {
    var scroll = byId("termScroll");
    var stick = !mounted || nearBottom(scroll);
    // 接口按文件顺序返回（旧的在前）；只保留最近 300 行，末尾接提示符
    var rows = entries.slice(-300).map(kind === "ai" ? aiLine : webLine);
    byId("termBody").innerHTML = rows.join("") + promptLine();
    byId("logEmpty").hidden = rows.length > 0;
    byId("termPath").textContent = "logs/" + kind + ".log";
    mounted = true;
    if (stick) scroll.scrollTop = scroll.scrollHeight;
  }

  function load() {
    fetch("/api/logs?kind=" + kind + "&limit=200", { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        render(d.entries || []);
        byId("logUpdated").textContent = "更新于 " + new Date().toLocaleTimeString();
      })
      .catch(function () { byId("logUpdated").textContent = "读取失败"; });
  }

  function setAuto(on) {
    if (timer) { clearInterval(timer); timer = null; }
    if (on) timer = setInterval(load, 3000);
    var live = byId("termLive");
    if (live) live.classList.toggle("off", !on);
    byId("termLiveText").textContent = on ? "实时" : "已暂停";
  }

  function init() {
    if (isSuper) byId("teamLink").style.display = "inline-block";

    var seg = byId("kindSeg");
    seg.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-kind]");
      if (!btn) return;
      kind = btn.getAttribute("data-kind");
      Array.prototype.forEach.call(seg.querySelectorAll("button"), function (b) {
        b.classList.toggle("on", b === btn);
      });
      mounted = false; // 切换视角后重新贴底
      load();
    });

    var autoBox = byId("autoRefresh");
    autoBox.addEventListener("change", function () {
      setAuto(autoBox.checked);
      if (autoBox.checked) load();
    });
    byId("refreshBtn").addEventListener("click", load);

    load();
    setAuto(autoBox.checked);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
