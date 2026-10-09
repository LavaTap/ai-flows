/* reviews.js · 代码评审记录
   数据源：window.__REVIEWS__ = { user, isSupervisor, pipelines, pipelineId, pipelineName, repoName, repoPath, repoGithub }
   接口：GET /api/reviews?p=<pipelineId> → { reviews, repo }
   只展示「当前管线绑定仓库」的评审记录（已登记仓库），不再展示所有仓库的报告。 */
(function () {
  var boot = window.__REVIEWS__ || {};
  var pipelines = boot.pipelines || [];
  var activeId = boot.pipelineId || "";

  function byId(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** ISO 时间戳 → 本地 YYYY-MM-DD HH:mm（非法/空返回原串） */
  function fmtTime(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function renderPipelinePicker() {
    var sel = byId("pipelineSel");
    sel.innerHTML = pipelines.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === activeId ? " selected" : "") + ">" +
        esc(p.name) + "</option>";
    }).join("");
    sel.addEventListener("change", function () {
      var id = sel.value;
      var url = "/reviews" + (id ? "?p=" + encodeURIComponent(id) : "");
      window.location.href = url;
    });
  }

  function renderRepoLabel() {
    byId("repoName").textContent = boot.repoGithub || boot.repoName || "—";
  }

  function rowHtml(r) {
    var cls = r.passed ? "pass" : "block";
    var label = r.passed ? "PASS" : "BLOCK";
    var who = [r.actor, r.email].filter(Boolean).map(esc).join(" · ") || "外部触发";
    var idCell = r.reportUrl
      ? '<a class="rev-id" href="' + esc(r.reportUrl) + '" target="_blank" rel="noopener">' + esc(r.id) + "</a>"
      : '<span class="rev-id plain">' + esc(r.id || "—") + "</span>";
    var blockers = Number(r.blockers) || 0;
    var issues = Number(r.issues) || 0;
    return '<div class="review-row">' +
      '<span class="pill ' + cls + '">' + label + "</span>" +
      '<div class="rev-main">' +
        idCell +
        '<div class="rev-meta">' + who + "</div>" +
      "</div>" +
      '<div class="rev-repo">' + esc(r.repo || boot.repoName || "—") + "</div>" +
      '<div class="rev-time">' + esc(fmtTime(r.generatedAt)) + "</div>" +
      '<div class="rev-counts"><span class="' + (blockers > 0 ? "blk" : "") + '"><b>' + blockers + "</b> blocker</span> · " +
        "<b>" + issues + "</b> 问题</div>" +
      "</div>";
  }

  function load() {
    var box = byId("reviewList");
    var url = "/api/reviews" + (activeId ? "?p=" + encodeURIComponent(activeId) : "");
    fetch(url, { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        var list = (d && d.reviews) || [];
        if (!list.length) {
          box.innerHTML = '<div class="reviews-empty">当前仓库暂无评审记录</div>';
          return;
        }
        box.innerHTML = list.map(rowHtml).join("");
      })
      .catch(function () {
        box.innerHTML = '<div class="reviews-empty">读取失败，请刷新重试</div>';
      });
  }

  function init() {
    renderRepoLabel();
    renderPipelinePicker();
    load();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
