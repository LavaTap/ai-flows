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
  var terminated = false;

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
    if (terminated) return;
    fetch("/api/logs?kind=" + kind + "&limit=200", { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        if (terminated) return;
        render(d.entries || []);
        byId("logUpdated").textContent = "更新于 " + new Date().toLocaleTimeString();
      })
      .catch(function () { if (!terminated) byId("logUpdated").textContent = "读取失败"; });
  }

  function setAuto(on) {
    if (timer) { clearInterval(timer); timer = null; }
    if (on) timer = setInterval(load, 3000);
    var live = byId("termLive");
    if (live) live.classList.toggle("off", !on);
    byId("termLiveText").textContent = on ? "实时" : "已暂停";
  }

  /** 终止平台服务（等价于启动脚本输入 quit）；成功后页面停更并提示重启 */
  function terminate() {
    if (!window.confirm(
      "确定终止平台服务？\n\n这会立即关闭评审服务、平台服务和日志跟随进程（等价于启动脚本输入 quit），" +
      "当前页面将无法再刷新。"
    )) return;
    var btn = byId("terminateBtn");
    btn.disabled = true;
    btn.textContent = "正在终止…";
    fetch("/api/system/terminate", { method: "POST", headers: { Accept: "application/json" } })
      .then(function (r) {
        if (r.status === 403) throw new Error("仅主管可终止服务");
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(onTerminated)
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = "终止服务";
        window.alert("终止失败：" + e.message);
      });
  }

  /** 终止成功后的收尾：停自动刷新、禁用交互、终端追加提示行 */
  function onTerminated() {
    terminated = true;
    if (timer) { clearInterval(timer); timer = null; }
    var autoBox = byId("autoRefresh");
    if (autoBox) { autoBox.checked = false; autoBox.disabled = true; }
    var refresh = byId("refreshBtn");
    if (refresh) refresh.disabled = true;
    var btn = byId("terminateBtn");
    btn.disabled = true;
    btn.textContent = "已终止";
    byId("logUpdated").textContent = "服务已终止";
    var live = byId("termLive");
    if (live) live.classList.add("off");
    byId("termLiveText").textContent = "已终止";
    var line = document.createElement("div");
    line.className = "term-line";
    line.innerHTML = '<span class="t-err">平台服务已终止（等价于启动脚本 quit）。重新运行 start-platform.bat 可再次启动。</span>';
    byId("termBody").appendChild(line);
  }

  function init() {
    if (isSuper) byId("teamLink").style.display = "inline-block";
    if (isSuper) {
      var tbtn = byId("terminateBtn");
      tbtn.hidden = false;
      tbtn.addEventListener("click", terminate);
    }

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
