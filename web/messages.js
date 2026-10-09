/* messages.js · 消息中心（顶栏铃铛进入）
   数据源：GET /api/messages（本人视角）；点击消息标记已读并按 refType 跳转关联对象 */
(function () {
  var boot = window.__MESSAGES__ || {};
  var user = boot.user || {};
  var state = { filter: "all", list: boot.messages || [] };

  var ICON = {
    ticket_assign:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 13h6M9 17h4"/></svg>',
    ticket_comment:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    ticket_mention:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>',
    kb:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    kb_mention:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>',
    node:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
    system:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>',
  };

  var TYPE_LABEL = {
    ticket_assign: "工单指派",
    ticket_comment: "工单评论",
    ticket_mention: "工单 @提及",
    kb: "知识库",
    kb_mention: "知识库 @提及",
    node: "管线节点",
    system: "系统",
  };

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

  function fmtTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
      p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function linkOf(m) {
    if (m.link) return m.link;
    if (!m.refId) return "";
    if (m.refType === "ticket") return "/tickets?id=" + encodeURIComponent(m.refId);
    if (m.refType === "kb") return "/kb?id=" + encodeURIComponent(m.refId);
    return "";
  }

  function renderList() {
    var list = state.list.filter(function (m) {
      return state.filter === "unread" ? !m.read : true;
    });
    var ul = byId("msgList");
    var empty = byId("msgEmpty");
    ul.innerHTML = list.map(function (m) {
      var link = linkOf(m);
      return (
        '<li class="msg-item' + (m.read ? "" : " unread") + '" data-id="' + esc(m.id) + '"' +
        (link ? ' data-link="' + esc(link) + '"' : "") + ' tabindex="0">' +
        '<span class="msg-ico">' + (ICON[m.type] || ICON.system) + "</span>" +
        '<div class="msg-body">' +
        '<div class="msg-title">' + (m.read ? "" : '<span class="dot"></span>') + esc(m.title) + "</div>" +
        (m.body ? '<div class="msg-text">' + esc(m.body) + "</div>" : "") +
        '<div class="msg-meta">' + esc(TYPE_LABEL[m.type] || "消息") + " · " + esc(fmtTime(m.at)) +
        (link ? " · 点击查看" : "") + "</div>" +
        "</div></li>"
      );
    }).join("");
    empty.hidden = list.length > 0;

    var unread = state.list.filter(function (m) { return !m.read; }).length;
    byId("nAll").textContent = String(state.list.length);
    byId("nUnread").textContent = String(unread);
    byId("msgSub").textContent = unread > 0 ? "共 " + state.list.length + " 条，未读 " + unread + " 条" : "共 " + state.list.length + " 条，已全部读完";
    byId("readAllBtn").disabled = unread === 0;
    if (window.__refreshMsgDot) window.__refreshMsgDot();
  }

  function markRead(id) {
    var m = state.list.filter(function (x) { return x.id === id; })[0];
    if (!m || m.read) return Promise.resolve();
    m.read = true;
    return fetch("/api/messages/" + encodeURIComponent(id) + "/read", { method: "POST" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function openMessage(id) {
    var m = state.list.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    markRead(id).then(function () {
      renderList();
      var link = linkOf(m);
      if (link) location.href = link;
    });
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

  function initFilters() {
    var items = document.querySelectorAll(".side-item");
    for (var i = 0; i < items.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          state.filter = btn.getAttribute("data-filter");
          for (var j = 0; j < items.length; j++) items[j].classList.remove("on");
          btn.classList.add("on");
          renderList();
        });
      })(items[i]);
    }
  }

  function init() {
    initTopbar();
    initFilters();
    renderList();

    byId("msgList").addEventListener("click", function (e) {
      var li = e.target.closest ? e.target.closest(".msg-item") : null;
      if (li) openMessage(li.getAttribute("data-id"));
    });
    byId("msgList").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var li = e.target.closest ? e.target.closest(".msg-item") : null;
      if (li) { e.preventDefault(); openMessage(li.getAttribute("data-id")); }
    });

    byId("readAllBtn").addEventListener("click", function () {
      var btn = byId("readAllBtn");
      btn.disabled = true;
      fetch("/api/messages/read-all", { method: "POST" })
        .then(function () {
          state.list.forEach(function (m) { m.read = true; });
          renderList();
        })
        .catch(function () { btn.disabled = false; });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();