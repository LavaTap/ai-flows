/* home.js · 首页全局搜索（全部 / 员工 / 工单 / 知识库）
   数据源：GET /api/search?type=all|user|ticket|kb&q=...（工单结果按当前用户视角过滤）
   浏览记录：localStorage 存最近 20 条，默认空搜索时展示 */
(function () {
  var boot = window.__HOME__ || {};
  var user = boot.user || {};
  var state = { type: "all", q: "" };
  var timer = null;
  var HIST_KEY = "home_recent";
  var HIST_MAX = 20;

  var STATUS_LABEL = { open: "待处理", doing: "处理中", resolved: "已解决" };
  var ROLE_LABEL = { supervisor: "主管", staff: "员工" };

  function byId(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function colorOf(email) {
    var s = String(email || ""); var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + ", 55%, 55%)";
  }

  function firstChar(name, email) {
    if (name && name.length) return name.charAt(0);
    return email ? email.charAt(0).toUpperCase() : "?";
  }

  function formatTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function avatarHtml(u) {
    if (u.avatar) {
      return '<span class="res-avatar"><img src="/api/avatars/' + esc(u.avatar) + '" alt=""></span>';
    }
    return '<span class="res-avatar" style="background:' + colorOf(u.email) + '">' +
      esc(firstChar(u.name, u.email)) + "</span>";
  }

  /* ─── 浏览记录 ─── */

  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    } catch (e) { return []; }
  }

  function saveHistory(list) {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, HIST_MAX))); } catch (e) {}
  }

  function addHistory(item) {
    var list = getHistory().filter(function (x) {
      if (x._type !== item._type) return true;
      return x._type === "user" ? x.email !== item.email : x.id !== item.id;
    });
    list.unshift(item);
    saveHistory(list);
  }

  function clearHistory() {
    saveHistory([]);
    renderHistory(state.type);
  }

  /* ─── 渲染：单条结果 ─── */

  function renderUserRow(u) {
    var meta = [u.department || "无部门", u.title || ""].filter(Boolean).join(" · ");
    var prefix = (u.email || "").split("@")[0] || u.email;
    var href = "/profile/" + encodeURIComponent(prefix);
    return '<a class="res-row" href="' + href + '" data-type="user" data-email="' + esc(u.email) + '">' +
      avatarHtml(u) +
      '<span class="res-body">' +
      '<span class="res-title">' + esc(u.name || u.email) + "</span>" +
      '<span class="res-meta">' + esc(meta) + ' · <span class="mono">' + esc(u.email) + "</span></span>" +
      "</span>" +
      '<span class="res-badge role">' + esc(ROLE_LABEL[u.role] || "员工") + "</span></a>";
  }

  function renderTicketRow(t) {
    var meta = [t.department, t.authorName, t.assigneeEmail ? "指派 " + t.assigneeEmail : ""]
      .filter(Boolean).join(" · ");
    return '<a class="res-row" href="/tickets?id=' + encodeURIComponent(t.id) +
      '" data-type="ticket" data-id="' + esc(t.id) + '">' +
      '<span class="res-body">' +
      '<span class="res-title">' + esc(t.title) + "</span>" +
      '<span class="res-meta">' + esc(meta) + "</span>" +
      "</span>" +
      '<span class="res-badge ' + esc(t.status) + '">' + esc(STATUS_LABEL[t.status] || t.status) + "</span></a>";
  }

  function renderKbRow(k) {
    var meta = ["撰写人 " + (k.authorName || "—"), "最近更新 " + (formatTime(k.updatedAt) || "—")]
      .filter(Boolean).join(" · ");
    return '<a class="res-row" href="/kb?id=' + encodeURIComponent(k.id) +
      '" data-type="kb" data-id="' + esc(k.id) + '" data-title="' + esc(k.title || k.id) +
      '" data-author="' + esc(k.authorName || "") + '" data-updated="' + esc(k.updatedAt || "") +
      '" data-updater="' + esc(k.updatedByName || "") + '">' +
      '<span class="res-body">' +
      '<span class="res-title">' + esc(k.title || k.id) + "</span>" +
      '<span class="res-meta">' + esc(meta) + "</span>" +
      "</span>" +
      '<span class="res-badge kb">知识库</span></a>';
  }

  function bindRowClicks(container) {
    var rows = container.querySelectorAll(".res-row");
    for (var i = 0; i < rows.length; i++) {
      rows[i].addEventListener("click", function (e) {
        var row = e.currentTarget;
        var type = row.getAttribute("data-type");
        if (type === "ticket") {
          var id = row.getAttribute("data-id");
          var title = row.querySelector(".res-title");
          addHistory({ _type: "ticket", id: id, title: title ? title.textContent : id });
        } else if (type === "user") {
          // 员工点击记浏览历史，正常跳转个人主页
          var email = row.getAttribute("data-email");
          var name = row.querySelector(".res-title");
          var deptEl = row.querySelector(".res-meta");
          var dept = deptEl ? deptEl.textContent.split(" · ")[0] : "";
          addHistory({
            _type: "user", email: email,
            name: name ? name.textContent : email,
            department: dept,
          });
        } else if (type === "kb") {
          // 知识库文章记浏览历史，正常跳转 /kb?id=
          addHistory({
            _type: "kb",
            id: row.getAttribute("data-id"),
            title: row.getAttribute("data-title"),
            authorName: row.getAttribute("data-author"),
            updatedAt: row.getAttribute("data-updated"),
            updatedByName: row.getAttribute("data-updater"),
          });
        }
      });
    }
  }

  /* ─── 渲染：混合结果 ─── */

  function renderMixed(list, countLabel) {
    if (!list.length) {
      byId("results").innerHTML = '<div class="home-hint">未找到匹配的结果</div>';
      return;
    }
    var html = '<div class="res-count">' + (countLabel || ("共 " + list.length + " 条结果")) + "</div>";
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (item._type === "user") html += renderUserRow(item);
      else if (item._type === "ticket") html += renderTicketRow(item);
      else if (item._type === "kb") html += renderKbRow(item);
    }
    byId("results").innerHTML = html;
    bindRowClicks(byId("results"));
  }

  function renderHistory(filterType) {
    var all = getHistory();
    var list = filterType && filterType !== "all"
      ? all.filter(function (x) { return x._type === filterType; })
      : all;
    if (!list.length) {
      var emptyTip = "暂无浏览记录";
      if (filterType === "user") emptyTip = "暂无浏览过的员工";
      else if (filterType === "ticket") emptyTip = "暂无浏览过的工单";
      else if (filterType === "kb") emptyTip = "暂无浏览过的文章";
      byId("results").innerHTML = '<div class="home-hint">' + emptyTip + "</div>";
      return;
    }
    var title = "最近浏览";
    if (filterType === "user") title = "最近浏览的员工";
    else if (filterType === "ticket") title = "最近浏览的工单";
    else if (filterType === "kb") title = "最近浏览的文章";
    var html = '<div class="res-section-title">' + title +
      '<button class="clear-hist" type="button" id="clearHist">清空</button>' +
      "</div>";
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (item._type === "user") {
        html += renderUserRow({ email: item.email, name: item.name, avatar: item.avatar, role: item.role, department: item.department, title: item.title });
      } else if (item._type === "ticket") {
        html += renderTicketRow({ id: item.id, title: item.title, status: item.status, department: item.department, authorName: item.authorName, assigneeEmail: item.assigneeEmail });
      } else if (item._type === "kb") {
        html += renderKbRow(item);
      }
    }
    byId("results").innerHTML = html;
    var btn = byId("clearHist");
    if (btn) btn.addEventListener("click", function (e) { e.preventDefault(); clearHistory(); });
    bindRowClicks(byId("results"));
  }

  function search() {
    var type = state.type;
    // 无搜索词时，展示浏览记录（按类型过滤）
    if (!state.q) {
      renderHistory(type);
      return;
    }
    fetch("/api/search?type=" + encodeURIComponent(type) + "&q=" + encodeURIComponent(state.q))
      .then(function (r) {
        if (r.status === 401) { location.href = "/login"; return null; }
        return r.json();
      })
      .then(function (d) {
        if (!d) return;
        var list = d.results || [];
        if (type === "all") {
          renderMixed(list, "共 " + list.length + " 条结果");
        } else if (type === "user") {
          renderMixed(list, "共 " + list.length + " 个员工");
        } else if (type === "kb") {
          renderMixed(list, "共 " + list.length + " 篇知识库文章");
        } else {
          renderMixed(list, "共 " + list.length + " 个工单");
        }
      })
      .catch(function () {
        byId("results").innerHTML = '<div class="home-hint">搜索失败，请重试</div>';
      });
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(search, 220);
  }

  function initTopbar() {
    byId("userName").textContent = user.name || user.email || "未登录";
    var chip = document.querySelector(".user-chip");
    if (chip) {
      var av = chip.querySelector(".avatar");
      if (av) {
        if (user.avatar) {
          av.style.background = "none";
          av.innerHTML = '<img src="/api/avatars/' + user.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">';
        } else {
          av.style.background = colorOf(user.email);
          av.textContent = firstChar(user.name, user.email);
        }
      }
    }
  }

  function init() {
    initTopbar();

    var seg = byId("typeSeg");
    if (seg) {
      seg.addEventListener("click", function (e) {
        var btn = e.target.closest ? e.target.closest("button[data-type]") : null;
        if (!btn) return;
        state.type = btn.getAttribute("data-type");
        Array.prototype.forEach.call(seg.querySelectorAll("button"), function (b) {
          b.classList.toggle("on", b === btn);
        });
        search();
      });
    }

    var input = byId("q");
    if (input) {
      input.addEventListener("input", function () { state.q = input.value.trim(); schedule(); });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { state.q = input.value.trim(); search(); }
      });
    }
    var go = byId("go");
    if (go) {
      go.addEventListener("click", function () {
        state.q = input ? input.value.trim() : "";
        search();
      });
    }

    search();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
