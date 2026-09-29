/* account.js · 账号管理页脚本 */
(function () {
  var boot = window.__ACCOUNT__ || {};
  var user = boot.user || {};
  var isSuper = !!boot.isSupervisor;

  /* ────────────── 工具函数 ────────────── */

  function colorOf(email) {
    var h = 0;
    for (var i = 0; i < email.length; i++) {
      h = (h * 31 + email.charCodeAt(i)) >>> 0;
    }
    var hue = h % 360;
    return "hsl(" + hue + ", 55%, 55%)";
  }

  function firstChar(u) {
    if (u.name && u.name.length) return u.name.charAt(0);
    return u.email ? u.email.charAt(0).toUpperCase() : "?";
  }

  function displayName(u) {
    return u.name || u.email;
  }

  function post(url, body) {
    var init = { method: "POST", headers: { "Content-Type": "application/json" } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(url, init).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
    });
  }

  /* ────────────── 顶栏 ────────────── */

  function initTopbar() {
    if (isSuper) {
      var teamLink = document.getElementById("teamLink");
      if (teamLink) teamLink.style.display = "inline-block";
      var sideTeamLink = document.getElementById("sideTeamLink");
      if (sideTeamLink) sideTeamLink.style.display = "flex";
    }
    var logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        post("/api/logout").then(function () { location.href = "/login"; });
      });
    }
  }

  /* ────────────── 个人资料 ────────────── */

  function renderProfile() {
    var av = document.getElementById("avatar");
    av.style.background = colorOf(user.email);
    av.textContent = firstChar(user);

    document.getElementById("nameEl").textContent = displayName(user);
    document.getElementById("emailEl").textContent = user.email;
    document.getElementById("deptEl").textContent = user.department || "-";
    document.getElementById("titleEl").textContent = user.title || "-";

    var badge = document.getElementById("roleBadge");
    if (user.role === "supervisor") {
      badge.textContent = "主管";
      badge.className = "badge supervisor";
    } else {
      badge.textContent = "员工";
      badge.className = "badge staff";
    }
  }

  /* ────────────── GitHub 绑定 ────────────── */

  function renderGithub() {
    var section = document.getElementById("ghSection");
    section.innerHTML = "";

    var row = document.createElement("div");
    row.className = "gh-row";

    var icon = document.createElement("div");
    icon.className = "gh-icon";
    icon.textContent = "GH";

    var info = document.createElement("div");
    info.className = "gh-info";

    var label = document.createElement("div");
    label.className = "gh-label";
    label.textContent = user.github ? "已绑定" : "未绑定";

    var val = document.createElement("div");
    val.className = "gh-value";
    val.textContent = user.github ? "@" + user.github : "尚未绑定 GitHub 账号";

    info.appendChild(label);
    info.appendChild(val);

    row.appendChild(icon);
    row.appendChild(info);
    section.appendChild(row);

    /* 待审核状态 */
    if (user.githubPending) {
      var pending = document.createElement("div");
      pending.className = "gh-pending";
      pending.innerHTML = "待审核绑定：<b>@" + user.githubPending + "</b>（等待主管批准）";
      var cancelBtn = document.createElement("button");
      cancelBtn.className = "btn danger";
      cancelBtn.style.marginLeft = "12px";
      cancelBtn.style.verticalAlign = "middle";
      cancelBtn.textContent = "取消申请";
      cancelBtn.addEventListener("click", function () {
        cancelBtn.disabled = true;
        post("/api/account/github/cancel").then(function (res) {
          if (res.ok) {
            user.githubPending = undefined;
            renderGithub();
          } else {
            alert((res.data && res.data.error) || "取消失败");
            cancelBtn.disabled = false;
          }
        });
      });
      pending.appendChild(cancelBtn);
      section.appendChild(pending);
    }

    /* 操作区：绑定输入框 / 解绑按钮 */
    if (!user.github && !user.githubPending) {
      var inputRow = document.createElement("div");
      inputRow.className = "gh-input-row";
      var input = document.createElement("input");
      input.type = "text";
      input.placeholder = "输入 GitHub 用户名，如 LavaTap";
      var bindBtn = document.createElement("button");
      bindBtn.className = "btn primary";
      bindBtn.textContent = isSuper ? "立即绑定" : "提交申请";
      bindBtn.addEventListener("click", function () {
        var v = input.value.trim();
        if (!v) { input.focus(); return; }
        bindBtn.disabled = true;
        post("/api/account/github/bind", { github: v }).then(function (res) {
          if (res.ok) {
            if (isSuper) {
              user.github = v;
            } else {
              user.githubPending = v;
            }
            renderGithub();
          } else {
            alert((res.data && res.data.error) || "绑定失败");
            bindBtn.disabled = false;
          }
        });
      });
      inputRow.appendChild(input);
      inputRow.appendChild(bindBtn);
      section.appendChild(inputRow);
    } else if (user.github) {
      var unbindRow = document.createElement("div");
      unbindRow.style.display = "flex";
      unbindRow.style.justifyContent = "flex-end";
      var unbindBtn = document.createElement("button");
      unbindBtn.className = "btn danger";
      unbindBtn.textContent = "解绑 GitHub";
      unbindBtn.addEventListener("click", function () {
        if (!confirm("确定要解绑 GitHub 账号 @" + user.github + " 吗？")) return;
        unbindBtn.disabled = true;
        post("/api/account/github/unbind").then(function (res) {
          if (res.ok) {
            user.github = undefined;
            renderGithub();
          } else {
            alert((res.data && res.data.error) || "解绑失败");
            unbindBtn.disabled = false;
          }
        });
      });
      unbindRow.appendChild(unbindBtn);
      section.appendChild(unbindRow);
    }
  }

  /* ────────────── 启动 ────────────── */

  initTopbar();
  renderProfile();
  renderGithub();
})();
