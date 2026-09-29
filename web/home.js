/* home.js · 首页全局搜索（知识库 / 工单 / 员工）
   数据源：GET /api/search?type=user|ticket|kb&q=...（工单结果按当前用户视角过滤） */
(function () {
  var boot = window.__HOME__ || {};
  var user = boot.user || {};
  var state = { type: "user", q: "" };
  var timer = null;

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

  function avatarHtml(u) {
    if (u.avatar) {
      return '<span class="res-avatar"><img src="/api/avatars/' + esc(u.avatar) + '" alt=""></span>';
    }
    return '<span class="res-avatar" style="background:' + colorOf(u.email) + '">' +
      esc(firstChar(u.name, u.email)) + "</span>";
  }

  function renderHint(text) {
    byId("results").innerHTML = '<div class="home-hint">' + esc(text) + "</div>";
  }

  function renderUsers(list) {
    if (!list.length) { renderHint("未找到匹配的员工"); return; }
    var html = '<div class="res-count">共 ' + list.length + " 个员工</div>";
    html += list.map(function (u) {
      var meta = [u.department || "无部门", u.title || ""].filter(Boolean).join(" · ");
      return '<div class="res-row">' + avatarHtml(u) +
        '<span class="res-body">' +
        '<span class="res-title">' + esc(u.name || u.email) + "</span>" +
        '<span class="res-meta">' + esc(meta) + ' · <span class="mono">' + esc(u.email) + "</span></span>" +
        "</span>" +
        '<span class="res-badge role">' + esc(ROLE_LABEL[u.role] || "员工") + "</span></div>";
    }).join("");
    byId("results").innerHTML = html;
  }

  function renderTickets(list) {
    if (!list.length) { renderHint("未找到匹配的工单"); return; }
    var html = '<div class="res-count">共 ' + list.length + " 个工单</div>";
    html += list.map(function (t) {
      var meta = [t.department, t.authorName, t.assigneeEmail ? "指派 " + t.assigneeEmail : ""]
        .filter(Boolean).join(" · ");
      return '<a class="res-row" href="/tickets?id=' + encodeURIComponent(t.id) + '">' +
        '<span class="res-body">' +
        '<span class="res-title">' + esc(t.title) + "</span>" +
        '<span class="res-meta">' + esc(meta) + "</span>" +
        "</span>" +
        '<span class="res-badge ' + esc(t.status) + '">' + esc(STATUS_LABEL[t.status] || t.status) + "</span></a>";
    }).join("");
    byId("results").innerHTML = html;
  }

  function search() {
    var type = state.type;
    if (type === "kb") { renderHint("知识库暂未接入"); return; }
    fetch("/api/search?type=" + encodeURIComponent(type) + "&q=" + encodeURIComponent(state.q))
      .then(function (r) {
        if (r.status === 401) { location.href = "/login"; return null; }
        return r.json();
      })
      .then(function (d) {
        if (!d) return;
        var list = d.results || [];
        if (type === "user") renderUsers(list); else renderTickets(list);
      })
      .catch(function () { renderHint("搜索失败，请重试"); });
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
    if (user.role === "supervisor") byId("teamLink").style.display = "inline-block";
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