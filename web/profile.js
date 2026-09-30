/* profile.js · 员工个人主页（banner + 骑跨头像 + 资料卡 + 知识库文章）
   数据源：window.__PROFILE__ = { user, target, articles, isSupervisor }
   articles：该员工撰写、且当前登录用户可见的知识库文章，按更新时间倒序 */
(function () {
  var boot = window.__PROFILE__ || {};
  var user = boot.user || {};
  var target = boot.target || {};
  var articles = boot.articles || [];

  var ROLE_LABEL = { supervisor: "主管", staff: "员工" };
  var VIS_LABEL = { all: "全体", departments: "部门", private: "仅自己" };

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
    if (isNaN(d.getTime())) return iso;
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  /* ---------- 顶栏 ---------- */
  function initTopbar() {
    byId("userName").textContent = user.name || user.email || "未登录";
    var chip = document.querySelector(".user-chip");
    if (chip) {
      var av = chip.querySelector(".avatar");
      if (av) {
        if (user.avatar) {
          av.style.background = "none";
          av.innerHTML = '<img src="/api/avatars/' + user.avatar +
            '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">';
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

  /* ---------- 资料渲染 ---------- */
  function renderProfile() {
    byId("crumbName").textContent = target.name || target.email || "员工";

    // banner 文案
    byId("bannerName").textContent = target.name || target.email;
    byId("bannerDept").textContent = target.department || "—";
    byId("bannerTitle").textContent = target.title || "—";

    // 骑跨头像
    var heroAv = byId("heroAvatar");
    if (heroAv) {
      var inner = heroAv.querySelector(".av-inner");
      if (target.avatar) {
        inner.innerHTML = '<img src="/api/avatars/' + esc(target.avatar) + '" alt="">';
        inner.style.background = "transparent";
      } else {
        inner.style.background = colorOf(target.email);
        inner.textContent = firstChar(target.name, target.email);
      }
    }

    // 资料卡头部
    byId("profileName").textContent = target.name || target.email;
    byId("profileEmailLine").textContent = target.email || "";

    // 角色标签
    var roleTag = byId("roleTag");
    var roleCls = target.role === "supervisor" ? "supervisor" : "staff";
    roleTag.className = "role-tag " + roleCls;
    roleTag.textContent = ROLE_LABEL[target.role] || "员工";

    // 信息网格
    byId("infoDept").textContent = target.department || "—";
    byId("infoTitle").textContent = target.title || "—";
    byId("infoEmail").textContent = target.email || "—";

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

  /* ---------- 知识库文章卡片网格 ---------- */
  function renderArticles() {
    var list = byId("kbList");
    var empty = byId("kbEmpty");
    var count = byId("kbCount");

    list.innerHTML = "";
    count.textContent = articles.length + " 篇";

    if (!articles.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    articles.forEach(function (a) {
      var li = document.createElement("li");
      li.className = "kb-card-item";

      // 点击跳转到知识库页并定位到该文章
      li.addEventListener("click", function () {
        window.location.href = "/kb?id=" + encodeURIComponent(a.id);
      });

      var top = document.createElement("div");
      top.className = "kb-card-top";
      var ico = document.createElement("span");
      ico.className = "kb-card-ico";
      ico.textContent = "📘";
      var badge = document.createElement("span");
      badge.className = "tk-badge " + (a.visibility || "all");
      badge.textContent = VIS_LABEL[a.visibility] || "全体";
      top.appendChild(ico);
      top.appendChild(badge);

      var title = document.createElement("h4");
      title.className = "kb-card-title";
      title.textContent = a.title;

      var meta = document.createElement("div");
      meta.className = "kb-card-meta";
      meta.textContent = "更新于 " + formatTime(a.updatedAt);

      li.appendChild(top);
      li.appendChild(title);
      li.appendChild(meta);
      list.appendChild(li);
    });
  }

  function init() {
    initTopbar();
    renderProfile();
    renderArticles();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();