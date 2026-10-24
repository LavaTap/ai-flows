/* team.js · 团队部门管理页脚本（仅主管） */
(function () {
  var boot = window.__TEAM__ || {};
  var user = boot.user || {};
  var members = boot.members || [];
  var departments = boot.departments || [];

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

  function avatarUrl(u) {
    return u.avatar ? "/api/avatars/" + u.avatar : "";
  }

  function post(url, body) {
    var init = { method: "POST", headers: { "Content-Type": "application/json" } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(url, init).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
    });
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ────────────── 顶栏 ────────────── */

  function initTopbar() {
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

  /* ────────────── 待审核列表 ────────────── */

  function renderPending() {
    var list = document.getElementById("pendingList");
    if (!list) return;
    var pending = members.filter(function (m) { return m.githubPending; });
    var countEl = document.getElementById("pendingCount");
    countEl.textContent = pending.length + " 条待审核";

    if (!pending.length) {
      list.innerHTML = '<div class="empty-tip">暂无待审核的 GitHub 绑定申请</div>';
      return;
    }

    list.innerHTML = "";
    pending.forEach(function (m) {
      var item = document.createElement("div");
      item.className = "pending-item";

      var av = document.createElement("div");
      av.className = "pending-avatar";
      var avUrl = avatarUrl(m);
      if (avUrl) {
        av.innerHTML = '<img src="' + avUrl + '" alt="">';
      } else {
        av.style.background = colorOf(m.email);
        av.textContent = firstChar(m);
      }

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

      var actions = document.createElement("div");
      actions.className = "pending-actions";

      var approveBtn = document.createElement("button");
      approveBtn.className = "btn primary";
      approveBtn.textContent = "批准";
      approveBtn.addEventListener("click", function () {
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        post("/api/account/" + encodeURIComponent(m.email) + "/github/approve").then(function (res) {
          if (res.ok) {
            // 更新本地数据
            var target = members.find(function (x) { return x.email === m.email; });
            if (target) {
              target.github = target.githubPending;
              target.githubPending = undefined;
            }
            renderPending();
            renderMembers();
          } else {
            alert((res.data && res.data.error) || "操作失败");
            approveBtn.disabled = false;
            rejectBtn.disabled = false;
          }
        });
      });

      var rejectBtn = document.createElement("button");
      rejectBtn.className = "btn danger";
      rejectBtn.textContent = "驳回";
      rejectBtn.addEventListener("click", function () {
        if (!confirm("确定要驳回 @" + m.githubPending + " 的绑定申请吗？")) return;
        approveBtn.disabled = true;
        rejectBtn.disabled = true;
        post("/api/account/" + encodeURIComponent(m.email) + "/github/reject").then(function (res) {
          if (res.ok) {
            var target = members.find(function (x) { return x.email === m.email; });
            if (target) target.githubPending = undefined;
            renderPending();
            renderMembers();
          } else {
            alert((res.data && res.data.error) || "操作失败");
            approveBtn.disabled = false;
            rejectBtn.disabled = false;
          }
        });
      });

      actions.appendChild(approveBtn);
      actions.appendChild(rejectBtn);

      item.appendChild(av);
      item.appendChild(info);
      item.appendChild(actions);
      list.appendChild(item);
    });
  }

  /* ────────────── 成员列表 ────────────── */

  function renderMembers() {
    var tbody = document.getElementById("memberTbody");
    var countEl = document.getElementById("memberCount");
    countEl.textContent = members.length + " 人";

    tbody.innerHTML = "";
    members.forEach(function (m) {
      var tr = document.createElement("tr");
      tr.className = "member-row";
      tr.dataset.email = m.email;

      /* 成员列 */
      var tdName = document.createElement("td");
      var cell = document.createElement("a");
      cell.className = "m-cell-avatar";
      var prefix = (m.email || "").split("@")[0] || m.email;
      cell.href = "/profile/" + encodeURIComponent(prefix);
      cell.style.textDecoration = "none";
      cell.style.color = "inherit";
      var av = document.createElement("span");
      av.className = "m-avatar-sm";
      var avUrl2 = avatarUrl(m);
      if (avUrl2) {
        av.innerHTML = '<img src="' + avUrl2 + '" alt="">';
      } else {
        av.style.background = colorOf(m.email);
        av.textContent = firstChar(m);
      }
      var txt = document.createElement("span");
      txt.innerHTML = '<div class="m-name">' + escapeHtml(displayName(m)) + '</div>' +
        '<div class="m-email">' + escapeHtml(m.email) + '</div>';
      cell.appendChild(av);
      cell.appendChild(txt);
      tdName.appendChild(cell);
      tr.appendChild(tdName);

      /* 部门列（可编辑，select） */
      var tdDept = document.createElement("td");
      var deptSel = document.createElement("select");
      deptSel.className = "edit-select";
      deptSel.dataset.field = "department";
      departments.forEach(function (d) {
        var opt = document.createElement("option");
        opt.value = d;
        opt.textContent = d;
        if (d === m.department) opt.selected = true;
        deptSel.appendChild(opt);
      });
      deptSel.addEventListener("change", function () {
        saveProfile(m.email, { department: deptSel.value });
      });
      tdDept.appendChild(deptSel);
      tr.appendChild(tdDept);

      /* 职位列（可编辑，input） */
      var tdTitle = document.createElement("td");
      var titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.className = "edit-input";
      titleInput.value = m.title || "";
      titleInput.dataset.field = "title";
      titleInput.addEventListener("blur", function () {
        if (titleInput.value.trim() !== (m.title || "")) {
          saveProfile(m.email, { title: titleInput.value.trim() });
        }
      });
      titleInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") titleInput.blur();
      });
      tdTitle.appendChild(titleInput);
      tr.appendChild(tdTitle);

      /* GitHub 列 */
      var tdGh = document.createElement("td");
      if (m.github) {
        var ghLink = document.createElement("a");
        ghLink.className = "gh-link";
        ghLink.href = "https://github.com/" + m.github;
        ghLink.target = "_blank";
        ghLink.textContent = "@" + m.github;
        tdGh.appendChild(ghLink);
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

      /* 操作列 */
      var tdAct = document.createElement("td");
      tdAct.style.textAlign = "right";
      var actWrap = document.createElement("div");
      actWrap.className = "row-actions";
      actWrap.style.justifyContent = "flex-end";

      var editBtn = document.createElement("button");
      editBtn.className = "btn";
      editBtn.textContent = "改姓名";
      editBtn.title = "修改姓名";
      editBtn.addEventListener("click", function () {
        var newName = prompt("修改 " + displayName(m) + " 的姓名：", m.name || "");
        if (newName == null) return;
        newName = newName.trim();
        if (!newName) { alert("姓名不能为空"); return; }
        saveProfile(m.email, { name: newName });
      });
      actWrap.appendChild(editBtn);

      var removeBtn = document.createElement("button");
      removeBtn.className = "btn danger";
      removeBtn.textContent = "移除";
      removeBtn.title = "将该成员移出团队（不删除账号）";
      removeBtn.addEventListener("click", function () {
        if (!confirm("确定将 " + displayName(m) + " 移出「" + m.department + "」？\n移出后该账号仍保留，但不再属于任何团队。")) return;
        removeBtn.disabled = true;
        saveProfile(m.email, { department: "" }).then(function () {
          removeBtn.disabled = false;
        });
      });
      actWrap.appendChild(removeBtn);

      tdAct.appendChild(actWrap);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    });
  }

  function saveProfile(email, patch) {
    return post("/api/account/" + encodeURIComponent(email) + "/profile", patch).then(function (res) {
      if (res.ok) {
        var target = members.find(function (x) { return x.email === email; });
        if (target) {
          if (patch.name !== undefined) target.name = patch.name;
          if (patch.department !== undefined) target.department = patch.department;
          if (patch.title !== undefined) target.title = patch.title;
        }
        // 如果改了自己的名字，也更新 user
        if (user.email === email) {
          if (patch.name !== undefined) user.name = patch.name;
          if (patch.department !== undefined) user.department = patch.department;
          if (patch.title !== undefined) user.title = patch.title;
        }
        renderPending();
        renderMembers();
      } else {
        alert((res.data && res.data.error) || "保存失败");
        renderMembers(); // 回滚显示
      }
    });
  }

  /* ────────────── 启动 ────────────── */

  initTopbar();
  renderPending();
  renderMembers();
})();
