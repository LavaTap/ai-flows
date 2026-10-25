/* departments.js · 部门详情页：渲染部门树状图 + 统计卡 */
(function () {
  var boot = window.__DEPARTMENTS__ || {};
  var departments = boot.departments || [];
  var usersByDept = boot.usersByDept || {};

  function colorOf(email) {
    var s = String(email || "");
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + ", 55%, 55%)";
  }

  function firstChar(u) {
    if (u.name && u.name.length) return u.name.charAt(0);
    return u.email ? u.email.charAt(0).toUpperCase() : "?";
  }

  function avatarUrl(u) {
    return u.avatar ? "/api/avatars/" + u.avatar : "";
  }

  function avatarHtml(u, size) {
    var url = avatarUrl(u);
    if (url) {
      return '<div class="avatar" style="background:none;width:' + size + 'px;height:' + size + 'px;">' +
        '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">' +
        '</div>';
    }
    return '<div class="avatar" style="background:' + colorOf(u.email) + ';width:' + size + 'px;height:' + size + 'px;">' +
      escapeHtml(firstChar(u)) + '</div>';
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function profileHref(u) {
    return "/profile/" + encodeURIComponent(String(u.email).split("@")[0]);
  }

  /** 渲染单个部门卡片：主管置顶 + 成员网格 */
  function renderDeptCard(dept, members) {
    var supervisors = members.filter(function (u) { return u.role === 3; });
    var staffs = members.filter(function (u) { return u.role !== 3; });
    var total = members.length;
    var supCount = supervisors.length;

    var html = '<div class="dept-card">' +
      '<div class="dept-card-head">' +
        '<div class="dept-icon">🏢</div>' +
        '<div class="dept-info">' +
          '<div class="dept-name">' +
            escapeHtml(dept.name) +
            '<span class="dept-badge">' + total + ' 人</span>' +
          '</div>' +
          '<div class="dept-meta">' +
            (supCount ? supCount + ' 位主管 · ' : '') + (total - supCount) + ' 位员工' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="dept-body">';

    // 主管行
    if (supervisors.length) {
      supervisors.forEach(function (sup) {
        html +=
          '<a class="supervisor-row" href="' + profileHref(sup) + '" style="text-decoration:none;">' +
            avatarHtml(sup, 40) +
            '<div class="info">' +
              '<div class="name">' + escapeHtml(sup.name || sup.email) + '</div>' +
              '<div class="title">' + escapeHtml(sup.title || "部门主管") + '</div>' +
            '</div>' +
            '<span class="role">主管</span>' +
          '</a>';
      });
    }

    // 成员网格
    if (staffs.length) {
      html += '<div class="members-label">成员</div>';
      html += '<div class="member-grid">';
      staffs.forEach(function (u) {
        html +=
          '<a class="member-item" href="' + profileHref(u) + '">' +
            avatarHtml(u, 32) +
            '<div class="m-info">' +
              '<div class="m-name">' + escapeHtml(u.name || u.email) + '</div>' +
              '<div class="m-title">' + escapeHtml(u.title || "员工") + '</div>' +
            '</div>' +
          '</a>';
      });
      html += '</div>';
    } else if (!supervisors.length) {
      html += '<div style="padding:8px 4px;font:400 12px/18px var(--font-sans);color:var(--muted);">暂无成员</div>';
    }

    html += '</div></div>';
    return html;
  }

  function renderStats() {
    var totalUsers = 0;
    var totalSup = 0;
    departments.forEach(function (d) {
      var list = usersByDept[d.id] || [];
      totalUsers += list.length;
      totalSup += list.filter(function (u) { return u.role === 3; }).length;
    });
    document.getElementById("statDepts").textContent = departments.length;
    document.getElementById("statUsers").textContent = totalUsers;
    document.getElementById("statSupervisors").textContent = totalSup;
    document.getElementById("statAvg").textContent = departments.length ? (totalUsers / departments.length).toFixed(1) : "0";
    document.getElementById("deptCount").textContent = departments.length + " 个部门";
  }

  function render() {
    var tree = document.getElementById("deptTree");
    if (!departments.length) {
      tree.innerHTML = '<div style="padding:40px 0;text-align:center;color:var(--muted);">暂无部门数据</div>';
      return;
    }
    tree.innerHTML = departments.map(function (d) {
      return renderDeptCard(d, usersByDept[d.id] || []);
    }).join("");
    renderStats();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
