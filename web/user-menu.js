/* user-menu.js · 顶栏用户菜单（点开显示放大资料 + 设置入口 + 个人主页跳转）
   共享逻辑：各页只放同名 DOM（#userChip / #userPanel），本脚本负责开合、资料填充与跳转。
   资料源：先取各页注入的 boot 全局里的 user（__ACCOUNT__ / __PIPELINE__ / ...），
   随后一律再向 /api/me 拉一次真实登录态兜底——页面只要放了 user-chip，就必须反映登录状态。 */
(function () {
  var BOOT_KEYS = ["__ACCOUNT__", "__PIPELINE__", "__REVIEWS__", "__TICKETS__", "__GHAUDIT__", "__CHAT__", "__TEAM__", "__HOME__", "__PROFILE__", "__MESSAGES__", "__KB__", "__LOGS__", "__DEPARTMENTS__"];

  /* 身份编码：0 实习生 / 1 员工 / 2 组长 / 3 主管（组长仅身份标签，权限同员工） */
  var ROLE_TEXT = { 0: "实习生", 1: "员工", 2: "组长", 3: "主管" };
  var ROLE_CLS = { 0: "intern", 1: "staff", 2: "lead", 3: "supervisor" };

  function bootUser() {
    for (var i = 0; i < BOOT_KEYS.length; i++) {
      var boot = window[BOOT_KEYS[i]];
      if (boot && boot.user) return boot.user;
    }
    return null;
  }

  function colorOf(email) {
    var s = String(email || "");
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return "hsl(" + (h % 360) + ", 55%, 55%)";
  }

  function firstChar(u) {
    if (u.name && u.name.length) return u.name.charAt(0);
    return u.email ? u.email.charAt(0).toUpperCase() : "?";
  }

  function displayName(u) {
    return u.name || u.email || "";
  }

  function avatarUrl(u) {
    return u.avatar ? "/api/avatars/" + u.avatar : "";
  }

  /** 个人主页地址：邮箱前缀（与各页 /profile/<前缀> 约定一致） */
  function profileHref(u) {
    if (!u || !u.email) return "";
    return "/profile/" + encodeURIComponent(String(u.email).split("@")[0]);
  }

  /** 画头像：有自定义头像用图片，否则首字配色 */
  function paintAvatar(el, u) {
    if (!el) return;
    var url = avatarUrl(u);
    if (url) {
      el.style.background = "none";
      el.style.color = "";
      el.innerHTML =
        '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">';
    } else {
      el.style.background = colorOf(u.email);
      el.style.color = "#fff";
      el.textContent = firstChar(u);
    }
  }

  /** 顶栏 chip：仅当页面自己没填（空 / 「未登录」）时接管，保证登录态一致 */
  function fillChip(u) {
    var chip = document.getElementById("userChip");
    if (!chip) return;
    chip.title = u.email || "";
    var nameEl = document.getElementById("userName");
    if (nameEl) {
      var cur = (nameEl.textContent || "").trim();
      if (!cur || cur === "未登录") nameEl.textContent = displayName(u);
    }
    var av = chip.querySelector(".avatar");
    if (av && !av.innerHTML && !(av.textContent || "").trim()) paintAvatar(av, u);
  }

  /** 重绘整个下拉面板：资料卡 + 分组菜单项
   *  结构：资料卡 → 账号分组（个人主页 / 设置 / 部门详情[仅主管]） → 退出登录分组 */
  function buildPanel(u) {
    var panel = document.getElementById("userPanel");
    if (!panel) return;

    var roleText = ROLE_TEXT[u.role] || "";
    var roleCls = ROLE_CLS[u.role] || "staff";
    var deptName = u.department || "";
    var isSupervisor = u.role === 3;

    var html =
      // 资料卡
      '<div class="user-panel-head" data-href="' + profileHref(u) + '" role="link" tabindex="0" title="查看个人主页">' +
        '<span class="avatar" aria-hidden="true"></span>' +
        '<div class="user-panel-meta">' +
          '<strong>' + escapeHtml(displayName(u)) + '</strong>' +
          '<span class="user-panel-email">' + escapeHtml(u.email || "") + '</span>' +
          (deptName || roleText
            ? '<div class="user-panel-sub">' +
                (deptName ? '<span class="dept-name">' + escapeHtml(deptName) + '</span>' : '') +
                (roleText ? '<span class="role-badge ' + roleCls + '">' + roleText + '</span>' : '') +
              '</div>'
            : '') +
        '</div>' +
      '</div>' +

      // 账号分组
      '<div class="user-panel-group">' +
        '<a class="user-panel-item" href="' + profileHref(u) + '">' +
          '<span class="user-panel-ico" aria-hidden="true">👤</span><span>个人主页</span>' +
          '<span class="item-arrow">›</span>' +
        '</a>' +
        '<a class="user-panel-item" href="/account">' +
          '<span class="user-panel-ico" aria-hidden="true">⚙</span><span>设置</span>' +
          '<span class="item-arrow">›</span>' +
        '</a>' +
        (isSupervisor
          ? '<a class="user-panel-item" href="/team">' +
              '<span class="user-panel-ico" aria-hidden="true">👥</span><span>团队管理</span>' +
              '<span class="item-arrow">›</span>' +
            '</a>' +
            '<a class="user-panel-item" href="/departments">' +
              '<span class="user-panel-ico" aria-hidden="true">🏢</span><span>部门详情</span>' +
              '<span class="item-arrow">›</span>' +
            '</a>'
          : '') +
        '<a class="user-panel-item" href="/tokens">' +
          '<span class="user-panel-ico" aria-hidden="true">📊</span><span>Token 面板</span>' +
          '<span class="item-arrow">›</span>' +
        '</a>' +
      '</div>' +

      // 退出分组
      '<div class="user-panel-group">' +
        '<button class="user-panel-item user-panel-logout" type="button">' +
          '<span class="user-panel-ico" aria-hidden="true">⏻</span><span>退出登录</span>' +
        '</button>' +
      '</div>';

    panel.innerHTML = html;

    // 头像着色
    var headAv = panel.querySelector(".user-panel-head .avatar");
    if (headAv) paintAvatar(headAv, u);

    // 资料卡点击 → 个人主页
    var head = panel.querySelector(".user-panel-head");
    if (head) {
      head.addEventListener("click", function (e) {
        e.stopPropagation();
        var href = head.getAttribute("data-href");
        if (href) location.href = href;
      });
      head.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          var href = head.getAttribute("data-href");
          if (href) location.href = href;
        }
      });
    }

    // 退出登录
    var logoutBtn = panel.querySelector(".user-panel-logout");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        fetch("/api/logout", { method: "POST" }).finally(function () {
          location.href = "/login";
        });
      });
    }
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function applyUser(u) {
    if (!u) return;
    fillChip(u);
    buildPanel(u);
  }

  /** 拉一次真实登录态：页面注入缺失或过期时也能把 chip 校准成登录用户 */
  function syncMe() {
    fetch("/api/me", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.user) applyUser(d.user); })
      .catch(function () {});
  }

  function init() {
    var chip = document.getElementById("userChip");
    var panel = document.getElementById("userPanel");
    if (!chip || !panel) return;

    function setOpen(open) {
      panel.hidden = !open;
      chip.setAttribute("aria-expanded", open ? "true" : "false");
    }

    chip.addEventListener("click", function (e) {
      e.stopPropagation();
      setOpen(panel.hidden);
    });
    chip.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(panel.hidden);
      }
    });
    document.addEventListener("click", function (e) {
      if (panel.hidden) return;
      if (chip.contains(e.target) || panel.contains(e.target)) return;
      setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setOpen(false);
    });

    applyUser(bootUser());
    syncMe();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* ---- 顶栏消息铃铛（头像左侧）：点击展开下拉面板，底部浏览所有消息 ---- */
  var BELL_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>' +
    '<path d="M13.7 21a2 2 0 0 1-3.4 0"/>' +
    "</svg>";

  var TYPE_ICON = {
    ticket_assign: "📌",
    ticket_comment: "💬",
    ticket_mention: "👋",
    node: "🔗",
    kb: "📘",
    kb_mention: "👋",
    system: "🔔",
  };

  function fmtTimeShort(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var diff = (new Date() - d) / 1000;
    if (diff < 60) return "刚刚";
    if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
    if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + " 天前";
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return m + "-" + day;
  }

  function initBell() {
    if (document.getElementById("msgBell")) return;
    var chip = document.getElementById("userChip");
    if (!chip) return;
    var anchor = chip.closest(".user-menu") || chip;

    // 外层容器（定位下拉面板用）
    var wrap = document.createElement("div");
    wrap.style.position = "relative";
    wrap.style.display = "inline-flex";

    // 铃铛按钮
    var bell = document.createElement("button");
    bell.type = "button";
    bell.className = "msg-bell";
    bell.id = "msgBell";
    bell.title = "消息";
    bell.setAttribute("aria-label", "消息");
    bell.setAttribute("aria-expanded", "false");
    bell.setAttribute("aria-haspopup", "true");
    bell.innerHTML = BELL_SVG + '<span class="msg-dot" id="msgDot" hidden></span>';

    // 下拉面板
    var pop = document.createElement("div");
    pop.className = "msg-pop";
    pop.id = "msgPop";
    pop.hidden = true;
    pop.innerHTML =
      '<div class="msg-pop-head">' +
        '<span>消息</span>' +
        '<span class="mp-count" id="msgPopCount">0 条未读</span>' +
      '</div>' +
      '<ul class="msg-pop-list" id="msgPopList"></ul>' +
      '<div class="msg-pop-foot"><a href="/messages">浏览所有消息 →</a></div>';

    wrap.appendChild(bell);
    wrap.appendChild(pop);
    if (anchor.parentNode) anchor.parentNode.insertBefore(wrap, anchor);

    var dot = bell.querySelector(".msg-dot");
    var listEl = pop.querySelector("#msgPopList");
    var countEl = pop.querySelector("#msgPopCount");

    function paintUnread(n) {
      if (!dot) return;
      dot.hidden = !(n > 0);
      bell.title = n > 0 ? "消息（" + n + " 条未读）" : "消息";
      if (countEl) countEl.textContent = n > 0 ? n + " 条未读" : "全部已读";
    }

    function renderList(items) {
      listEl.innerHTML = "";
      if (!items || !items.length) {
        var empty = document.createElement("li");
        empty.className = "msg-pop-empty";
        empty.textContent = "暂无消息";
        listEl.appendChild(empty);
        return;
      }
      items.slice(0, 5).forEach(function (m) {
        var li = document.createElement("li");
        li.className = "msg-pop-item";

        var ico = document.createElement("span");
        ico.className = "mpi-ico";
        ico.textContent = TYPE_ICON[m.type] || TYPE_ICON.system;

        var body = document.createElement("div");
        body.className = "mpi-body";

        var titleRow = document.createElement("div");
        titleRow.className = "mpi-title";
        if (!m.read) {
          var rd = document.createElement("span");
          rd.className = "mpi-dot";
          titleRow.appendChild(rd);
        }
        var titleText = document.createElement("span");
        titleText.textContent = m.title || "新消息";
        titleRow.appendChild(titleText);

        var textRow = document.createElement("div");
        textRow.className = "mpi-text";
        textRow.textContent = m.body || "";

        var timeRow = document.createElement("div");
        timeRow.className = "mpi-time";
        timeRow.textContent = fmtTimeShort(m.at);

        body.appendChild(titleRow);
        body.appendChild(textRow);
        body.appendChild(timeRow);

        li.appendChild(ico);
        li.appendChild(body);

        li.addEventListener("click", function () {
          if (!m.read && m.id) {
            fetch("/api/messages/" + encodeURIComponent(m.id) + "/read", { method: "POST" })
              .catch(function () {});
          }
          if (m.link) {
            window.location.href = m.link;
          } else {
            window.location.href = "/messages";
          }
        });

        listEl.appendChild(li);
      });
    }

    var loaded = false;
    function loadPop() {
      if (loaded) return;
      loaded = true;
      fetch("/api/messages", { headers: { Accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && d.messages) {
            renderList(d.messages);
            paintUnread(d.unread != null ? d.unread : (d.messages || []).filter(function (x) { return !x.read; }).length);
          }
        })
        .catch(function () {
          renderList([]);
        });
    }

    function openPop() {
      pop.hidden = false;
      bell.setAttribute("aria-expanded", "true");
      loadPop();
    }
    function closePop() {
      pop.hidden = true;
      bell.setAttribute("aria-expanded", "false");
    }
    function togglePop() {
      if (pop.hidden) openPop(); else closePop();
    }

    bell.addEventListener("click", function (e) {
      e.stopPropagation();
      togglePop();
    });

    // 点击面板外关闭
    document.addEventListener("click", function (e) {
      if (pop.hidden) return;
      if (!wrap.contains(e.target)) closePop();
    });

    // Esc 关闭
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !pop.hidden) closePop();
    });

    function refresh() {
      fetch("/api/messages/unread", { headers: { Accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d) paintUnread(d.unread || 0); })
        .catch(function () {});
    }
    refresh();
    // 30s 轮询 + 窗口重新聚焦时刷新
    setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refresh();
    });
    window.__refreshMsgDot = refresh;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBell);
  } else {
    initBell();
  }
})();
