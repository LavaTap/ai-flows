/* profile.js · 员工个人主页
   数据源：window.__PROFILE__ = { user, target, isSupervisor } */
(function () {
  var boot = window.__PROFILE__ || {};
  var user = boot.user || {};
  var target = boot.target || {};

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
    if (user.role === "supervisor") {
      var tl = byId("teamLink");
      if (tl) tl.style.display = "inline-block";
    }
  }

  function renderProfile() {
    // 面包屑
    byId("crumbName").textContent = target.name || target.email || "员工";

    // 头像
    var av = byId("profileAvatar");
    if (target.avatar) {
      av.innerHTML = '<img src="/api/avatars/' + esc(target.avatar) + '" alt="">';
      av.style.background = "transparent";
    } else {
      av.style.background = colorOf(target.email);
      av.textContent = firstChar(target.name, target.email);
    }

    // 角色标签（头像下方）
    var roleTag = byId("roleTag");
    var roleCls = target.role === "supervisor" ? "supervisor" : "staff";
    roleTag.className = "role-tag " + roleCls;
    roleTag.textContent = ROLE_LABEL[target.role] || "员工";

    // 姓名（部门 / 职位统一在下方信息网格展示）
    byId("profileName").textContent = target.name || target.email;

    // 职位副标题
    byId("profileTitle").textContent = target.title || "";

    // 信息网格
    byId("profileEmail").textContent = target.email || "—";
    byId("infoDept").textContent = target.department || "—";
    byId("infoTitle").textContent = target.title || "—";

    // GitHub
    var ghEl = byId("infoGithub");
    if (target.github) {
      ghEl.innerHTML = '<a class="gh-link" href="https://github.com/' + esc(target.github) +
        '" target="_blank" rel="noopener">@' + esc(target.github) + "</a>";
    } else if (target.githubPending) {
      ghEl.innerHTML = '<span class="gh-pending">待审核 @' + esc(target.githubPending) + "</span>";
    } else {
      ghEl.textContent = "未绑定";
    }
  }

  function init() {
    initTopbar();
    renderProfile();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
