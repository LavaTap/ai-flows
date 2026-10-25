/* reviews.js · 代码评审记录
   数据源：window.__REVIEWS__ = { user, isSupervisor, pipelines, pipelineId, pipelineName, repoName, repoPath, repoGithub }
   接口：GET /api/reviews?p=<pipelineId|all> → { reviews, repo }
   默认展示「当前管线绑定仓库」的评审记录；选「全部」(?p=all) 则聚合全部已登记仓库。 */
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
    // 首项「全部」= 不限管线，聚合全部已登记仓库的评审记录
    var allOption = '<option value="all"' + (activeId === "all" ? " selected" : "") + ">全部</option>";
    sel.innerHTML = allOption + pipelines.map(function (p) {
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
    // 「全部」视图下没有单一当前仓库，缺 repo 的老记录显示 —，不冒充全部仓库
    var repoText = r.repo || (activeId === "all" ? "" : boot.repoName) || "—";
    var idCell = r.reportUrl
      ? '<a class="rev-id" href="' + esc(r.reportUrl) + '" target="_blank" rel="noopener">' + esc(r.id) + "</a>"
      : '<span class="rev-id plain">' + esc(r.id || "—") + "</span>";
    var blockers = Number(r.blockers) || 0;
    var issues = Number(r.issues) || 0;
    // 主管可指定触发者 / 删除记录（服务端同样只放行主管，按钮只是展示）
    var acts = boot.isSupervisor && r.id
      ? '<div class="rev-acts">' +
          '<button type="button" class="rev-act" data-act="owner" data-id="' + esc(r.id) + '">归属</button>' +
          '<button type="button" class="rev-act del" data-act="del" data-id="' + esc(r.id) + '">删除</button>' +
        "</div>"
      : "";
    return '<div class="review-row">' +
      '<span class="pill ' + cls + '">' + label + "</span>" +
      '<div class="rev-main">' +
        idCell +
        '<div class="rev-meta">' + who + "</div>" +
      "</div>" +
      '<div class="rev-repo">' + esc(repoText) + "</div>" +
      '<div class="rev-time">' + esc(fmtTime(r.generatedAt)) + "</div>" +
      '<div class="rev-counts"><span class="' + (blockers > 0 ? "blk" : "") + '"><b>' + blockers + "</b> blocker</span> · " +
        "<b>" + issues + "</b> 问题</div>" +
      acts +
      "</div>";
  }

  /* ---------------- 主管操作：删除记录 / 指定触发者 ---------------- */

  var ownerPop = null;

  function closeOwnerPop() {
    if (!ownerPop) return;
    ownerPop.remove();
    ownerPop = null;
  }

  /** 指定触发者：浮层里放统一的员工搜索面板，选中即 PATCH 归属 */
  function openOwnerPicker(anchor, id) {
    closeOwnerPop();
    if (!window.MemberSearch) return;
    var pop = document.createElement("div");
    pop.className = "rev-owner-pop";
    var rect = anchor.getBoundingClientRect();
    pop.style.left = Math.min(rect.left, window.innerWidth - 320) + "px";
    pop.style.top = rect.bottom + 6 + "px";
    var panel = window.MemberSearch.createPanel({
      placeholder: "搜索姓名 / 邮箱 / 部门 / 职位…",
      emptyText: "未找到匹配的员工",
      onPick: function (u) {
        patchOwner(id, u.email);
      },
    });
    pop.appendChild(panel.el);
    document.body.appendChild(pop);
    ownerPop = pop;
    panel.focus();
  }

  function patchOwner(id, email) {
    fetch("/api/reviews/" + encodeURIComponent(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: email }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        closeOwnerPop();
        load();
      })
      .catch(function () { alert("指定失败，请稍后重试"); });
  }

  function removeReview(id, btn) {
    if (!window.confirm("确定删除这条评审记录？删除后不可恢复。")) return;
    btn.disabled = true;
    fetch("/api/reviews/" + encodeURIComponent(id), {
      method: "DELETE",
      headers: { Accept: "application/json" },
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        load();
      })
      .catch(function () {
        btn.disabled = false;
        alert("删除失败，请稍后重试");
      });
  }

  function bindActions(box) {
    box.addEventListener("click", function (e) {
      var btn = e.target.closest(".rev-act");
      if (!btn) return;
      var id = btn.getAttribute("data-id");
      if (!id) return;
      if (btn.getAttribute("data-act") === "del") removeReview(id, btn);
      else openOwnerPicker(btn, id);
      e.stopPropagation();
    });
  }

  function load() {
    var box = byId("reviewList");
    var url = "/api/reviews" + (activeId ? "?p=" + encodeURIComponent(activeId) : "");
    fetch(url, { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        var list = (d && d.reviews) || [];
        if (!list.length) {
          box.innerHTML = '<div class="reviews-empty">' +
            (activeId === "all" ? "暂无评审记录" : "当前仓库暂无评审记录") + "</div>";
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
    var box = byId("reviewList");
    if (boot.isSupervisor) box.classList.add("has-acts");
    bindActions(box);
    // 点空白处收起「指定触发者」浮层
    document.addEventListener("click", function (e) {
      if (ownerPop && !ownerPop.contains(e.target)) closeOwnerPop();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeOwnerPop();
    });
    load();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
