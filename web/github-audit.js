/* github-audit.js · GitHub 绑定管理页脚本（员工自助 + 主管审核） */
(function () {
  var boot = window.__GHAUDIT__ || {};
  var user = boot.user || {};
  var members = boot.members || [];
  var isSuper = !!boot.isSupervisor;

  /* ────────────── 工具函数 ────────────── */

  function colorOf(email) {
    var h = 0;
    for (var i = 0; i < email.length; i++) {
      h = (h * 31 + email.charCodeAt(i)) >>> 0;
    }
    return "hsl(" + (h % 360) + ", 55%, 55%)";
  }

  function firstChar(u) {
    if (u.name && u.name.length) return u.name.charAt(0);
    return u.email ? u.email.charAt(0).toUpperCase() : "?";
  }

  function displayName(u) { return u.name || u.email; }

  function avatarUrl(u) { return u.avatar ? "/api/avatars/" + u.avatar : ""; }

  function avatarEl(u, size) {
    var url = avatarUrl(u);
    var el = document.createElement("div");
    el.className = size === "sm" ? "m-avatar-sm" : "pending-avatar";
    if (url) {
      el.innerHTML = '<img src="' + url + '" alt="">';
    } else {
      el.style.background = colorOf(u.email);
      el.textContent = firstChar(u);
    }
    return el;
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
    }
    renderUserChip();
  }

  function renderUserChip() {
    var chip = document.querySelector(".user-chip");
    if (!chip) return;
    var av = chip.querySelector(".avatar");
    var nameEl = document.getElementById("userName");
    var url = avatarUrl(user);
    if (av) {
      if (url) {
        av.style.background = "none";
        av.innerHTML = '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">';
      } else {
        av.style.background = colorOf(user.email);
        av.textContent = firstChar(user);
      }
    }
    if (nameEl) nameEl.textContent = displayName(user);
  }

  /* ────────────── 我的 GitHub 绑定 ────────────── */

  function renderMyGh() {
    var box = document.getElementById("myGh");
    box.innerHTML = "";

    var row = document.createElement("div");
    row.className = "gh-row";
    var icon = document.createElement("div");
    icon.className = "gh-icon";
    icon.textContent = "GH";
    var info = document.createElement("div");
    info.className = "gh-info";
    var label = document.createElement("div");
    label.className = "gh-label";
    label.textContent = user.github ? "已绑定" : (user.githubPending ? "待审核" : "未绑定");
    var val = document.createElement("div");
    val.className = "gh-value";
    val.textContent = user.github ? "@" + user.github :
      (user.githubPending ? "@" + user.githubPending + "（等待主管批准）" : "尚未绑定 GitHub 账号");
    info.appendChild(label);
    info.appendChild(val);
    row.appendChild(icon);
    row.appendChild(info);
    box.appendChild(row);

    if (user.githubPending) {
      var pending = document.createElement("div");
      pending.className = "gh-pending";
      pending.innerHTML = "待审核绑定：<b>@" + escapeHtml(user.githubPending) + "</b>";
      var cancelBtn = document.createElement("button");
      cancelBtn.className = "btn danger";
      cancelBtn.style.marginLeft = "12px";
      cancelBtn.style.verticalAlign = "middle";
      cancelBtn.textContent = "取消申请";
      cancelBtn.addEventListener("click", function () {
        cancelBtn.disabled = true;
        post("/api/account/github/cancel").then(function (res) {
          if (res.ok) { user.githubPending = undefined; renderMyGh(); }
          else { alert((res.data && res.data.error) || "取消失败"); cancelBtn.disabled = false; }
        });
      });
      pending.appendChild(cancelBtn);
      box.appendChild(pending);
    }

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
            if (isSuper) user.github = v;
            else user.githubPending = v;
            renderMyGh();
          } else {
            alert((res.data && res.data.error) || "绑定失败");
            bindBtn.disabled = false;
          }
        });
      });
      inputRow.appendChild(input);
      inputRow.appendChild(bindBtn);
      box.appendChild(inputRow);
    } else if (user.github) {
      var unbindRow = document.createElement("div");
      unbindRow.className = "gh-unbind-row";
      var unbindBtn = document.createElement("button");
      unbindBtn.className = "btn danger";
      unbindBtn.textContent = "解绑 GitHub";
      unbindBtn.addEventListener("click", function () {
        if (!confirm("确定要解绑 GitHub 账号 @" + user.github + " 吗？")) return;
        unbindBtn.disabled = true;
        post("/api/account/github/unbind").then(function (res) {
          if (res.ok) { user.github = undefined; renderMyGh(); }
          else { alert((res.data && res.data.error) || "解绑失败"); unbindBtn.disabled = false; }
        });
      });
      unbindRow.appendChild(unbindBtn);
      box.appendChild(unbindRow);
    }
  }

  /* ────────────── 主管：待审核列表 ────────────── */

  function renderPending() {
    if (!isSuper) return;
    document.getElementById("pendingCard").style.display = "block";
    var list = document.getElementById("pendingList");
    var pending = members.filter(function (m) { return m.githubPending; });
    document.getElementById("pendingCount").textContent = pending.length + " 条待审核";

    if (!pending.length) {
      list.innerHTML = '<div class="empty-tip">暂无待审核的 GitHub 绑定申请</div>';
      return;
    }
    list.innerHTML = "";
    pending.forEach(function (m) {
      var item = document.createElement("div");
      item.className = "pending-item";
      item.appendChild(avatarEl(m));

      var info = document.createElement("div");
      info.className = "pending-info";
      var name = document.createElement("div");
      name.className = "pending-name";
      name.textContent = displayName(m);
      var meta = document.createElement("div");
      meta.className = "pending-meta";
      meta.innerHTML = escapeHtml(m.department) + " · " + escapeHtml(m.title) +
        ' &nbsp;→&nbsp; 申请绑定 <span class="pending-gh">@' + escapeHtml(m.githubPending) + "</span>";
      info.appendChild(name);
      info.appendChild(meta);
      item.appendChild(info);

      var actions = document.createElement("div");
      actions.className = "pending-actions";
      var approveBtn = document.createElement("button");
      approveBtn.className = "btn primary";
      approveBtn.textContent = "批准";
      var rejectBtn = document.createElement("button");
      rejectBtn.className = "btn danger";
      rejectBtn.textContent = "驳回";
      approveBtn.addEventListener("click", function () {
        approveBtn.disabled = rejectBtn.disabled = true;
        post("/api/account/" + encodeURIComponent(m.email) + "/github/approve").then(function (res) {
          if (res.ok) {
            var t = members.find(function (x) { return x.email === m.email; });
            if (t) { t.github = t.githubPending; t.githubPending = undefined; }
            renderPending(); renderMembers();
          } else { alert((res.data && res.data.error) || "操作失败"); approveBtn.disabled = rejectBtn.disabled = false; }
        });
      });
      rejectBtn.addEventListener("click", function () {
        if (!confirm("确定要驳回 @" + m.githubPending + " 的绑定申请吗？")) return;
        approveBtn.disabled = rejectBtn.disabled = true;
        post("/api/account/" + encodeURIComponent(m.email) + "/github/reject").then(function (res) {
          if (res.ok) {
            var t = members.find(function (x) { return x.email === m.email; });
            if (t) t.githubPending = undefined;
            renderPending(); renderMembers();
          } else { alert((res.data && res.data.error) || "操作失败"); approveBtn.disabled = rejectBtn.disabled = false; }
        });
      });
      actions.appendChild(approveBtn);
      actions.appendChild(rejectBtn);
      item.appendChild(actions);
      list.appendChild(item);
    });
  }

  /* ────────────── 主管：成员 GitHub 一览 ────────────── */

  function renderMembers() {
    if (!isSuper) return;
    document.getElementById("membersCard").style.display = "block";
    var tbody = document.getElementById("memberTbody");
    document.getElementById("memberCount").textContent = members.length + " 人";
    tbody.innerHTML = "";
    members.forEach(function (m) {
      var tr = document.createElement("tr");
      var tdName = document.createElement("td");
      var cell = document.createElement("div");
      cell.className = "m-cell-avatar";
      cell.appendChild(avatarEl(m, "sm"));
      var txt = document.createElement("span");
      txt.innerHTML = '<div class="m-name">' + escapeHtml(displayName(m)) + '</div>' +
        '<div class="m-email">' + escapeHtml(m.email) + '</div>';
      cell.appendChild(txt);
      tdName.appendChild(cell);
      tr.appendChild(tdName);

      var tdDept = document.createElement("td");
      tdDept.textContent = m.department || "-";
      tr.appendChild(tdDept);

      var tdGh = document.createElement("td");
      if (m.github) {
        var a = document.createElement("a");
        a.className = "gh-link";
        a.href = "https://github.com/" + m.github;
        a.target = "_blank";
        a.textContent = "@" + m.github;
        tdGh.appendChild(a);
      } else if (m.githubPending) {
        var tag = document.createElement("span");
        tag.className = "gh-pending-tag";
        tag.textContent = "待审核: @" + m.githubPending;
        tdGh.appendChild(tag);
      } else {
        tdGh.textContent = "未绑定";
        tdGh.style.color = "var(--muted)";
        tdGh.style.fontSize = "12px";
      }
      tr.appendChild(tdGh);
      tbody.appendChild(tr);
    });
  }

  /* ────────────── 启动 ────────────── */

  initTopbar();
  renderMyGh();
  renderPending();
  renderMembers();
})();
