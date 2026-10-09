/* member-search.js · 统一的员工搜索（节点加执行人 / 工单·知识库 @提及 / 团队管理 共用）
   数据源统一走 GET /api/search?type=user&q=...（服务端读 users 主表），保证三处员工列表同源同款。
   用法：
     var panel = MemberSearch.createPanel({ placeholder, excludeDepartments, excludeEmails,
                                           actionLabel, onAction, onPick, emptyText });
     host.appendChild(panel.el); panel.focus();
   低层：MemberSearch.search(q) → Promise<User[]>；MemberSearch.row(user, opts) → DOM。 */
window.MemberSearch = (function () {
  "use strict";

  var PALETTE = ["#ad314d", "#2aa198", "#b58900", "#6c71c4", "#cb4b16", "#859900"];
  var cache = {};

  function colorOf(email) {
    var s = String(email || "");
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  function displayName(u) {
    if (!u) return "";
    return u.name || String(u.email || "").split("@")[0];
  }

  function firstChar(u) {
    var n = displayName(u);
    return n ? n.charAt(0) : "?";
  }

  /** 头像元素：有自定义头像用图片，否则首字配色 */
  function avatarEl(u, cls) {
    var av = document.createElement("span");
    av.className = cls || "ms-avatar";
    if (u && u.avatar) {
      var img = document.createElement("img");
      img.src = "/api/avatars/" + encodeURIComponent(u.avatar);
      img.alt = "";
      av.appendChild(img);
    } else {
      av.style.background = colorOf(u && u.email);
      av.textContent = firstChar(u);
    }
    return av;
  }

  /** 搜索员工（同一接口、同一表；结果按 query 缓存） */
  function search(q) {
    q = (q || "").trim();
    if (Object.prototype.hasOwnProperty.call(cache, q)) {
      return Promise.resolve(cache[q]);
    }
    return fetch("/api/search?type=user&q=" + encodeURIComponent(q), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : { results: [] }; })
      .then(function (d) {
        var list = (d && d.results) || [];
        cache[q] = list;
        return list;
      })
      .catch(function () { return []; });
  }

  /** 单行：头像 + 姓名 + 部门·职位（可选右侧操作按钮） */
  function row(u, opts) {
    opts = opts || {};
    var el = document.createElement("div");
    el.className = "ms-row" + (opts.className ? " " + opts.className : "");
    el.appendChild(avatarEl(u, "ms-avatar"));
    var info = document.createElement("div");
    info.className = "ms-info";
    var nm = document.createElement("div");
    nm.className = "ms-name";
    nm.textContent = displayName(u);
    var meta = document.createElement("div");
    meta.className = "ms-meta";
    meta.textContent = [u.department, u.title].filter(Boolean).join(" · ") || "—";
    info.appendChild(nm);
    info.appendChild(meta);
    el.appendChild(info);
    if (opts.action) {
      opts.action.addEventListener("click", function (e) { e.stopPropagation(); });
      el.appendChild(opts.action);
    }
    if (opts.onPick) {
      el.addEventListener("click", function () { opts.onPick(u); });
    }
    return el;
  }

  /** 搜索面板：输入框 + 结果列表（同源同款） */
  function createPanel(opts) {
    opts = opts || {};
    var wrap = document.createElement("div");
    wrap.className = "ms-panel";

    var input = document.createElement("input");
    input.type = "text";
    input.className = "ms-input";
    input.placeholder = opts.placeholder || "搜索姓名 / 邮箱 / 部门 / 职位…";
    wrap.appendChild(input);

    var list = document.createElement("div");
    list.className = "ms-list";
    wrap.appendChild(list);

    function empty(text) {
      list.textContent = "";
      var e = document.createElement("div");
      e.className = "ms-empty";
      e.textContent = text;
      list.appendChild(e);
    }

    function render(q) {
      empty("搜索中…");
      search(q).then(function (users) {
        var pool = users.filter(function (u) {
          if (opts.excludeEmails && opts.excludeEmails.indexOf(u.email) >= 0) return false;
          if (opts.excludeDepartments && opts.excludeDepartments.indexOf(u.department) >= 0) return false;
          return true;
        });
        if (!pool.length) {
          empty(opts.emptyText || "未找到匹配的员工");
          return;
        }
        list.textContent = "";
        pool.forEach(function (u) {
          var action = null;
          if (opts.actionLabel) {
            action = document.createElement("button");
            action.type = "button";
            action.className = "ms-action";
            action.textContent = opts.actionLabel;
            action.addEventListener("click", function () {
              if (opts.onAction) opts.onAction(u, action);
            });
          }
          list.appendChild(row(u, {
            action: action,
            onPick: opts.onPick ? function (user) { opts.onPick(user); } : null
          }));
        });
      });
    }

    var timer = null;
    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { render(input.value.trim()); }, 200);
    });
    render("");

    return {
      el: wrap,
      input: input,
      refresh: function () { render(input.value.trim()); },
      focus: function () { input.focus(); }
    };
  }

  return {
    search: search,
    row: row,
    avatarEl: avatarEl,
    displayName: displayName,
    createPanel: createPanel
  };
})();
