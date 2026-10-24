/* user-card.js · 共享前端模块：头像 / 悬停用户卡片 / @提及渲染
   工单页（tickets.js）与知识库页（kb.js）共用；页面需自带
   <div class="user-card" id="userCard" hidden></div> 容器。
   用法：UserCard.setMembers(boot.members); UserCard.init(); UserCard.decorateMentions(root); */
window.UserCard = (function () {
  var members = [];
  var cardId = "userCard";
  var cardTimer = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function colorOf(email) {
    var h = 0;
    var s = String(email || "?");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + ", 55%, 55%)";
  }

  function firstChar(name, email) {
    if (name && name.length) return name.charAt(0);
    return email ? email.charAt(0).toUpperCase() : "?";
  }

  function emailPrefix(email) {
    return email ? email.split("@")[0] : "";
  }

  function profileUrl(email) {
    return "/profile/" + encodeURIComponent(emailPrefix(email));
  }

  function formatTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /** 注入成员列表（用户卡片查询用）；opts.cardId 可覆盖卡片容器 id */
  function setMembers(list, opts) {
    members = list || [];
    if (opts && opts.cardId) cardId = opts.cardId;
  }

  function memberByEmail(email) {
    if (!email) return null;
    for (var i = 0; i < members.length; i++) {
      if (members[i].email === email) return members[i];
    }
    return null;
  }

  function memberByName(name) {
    if (!name) return null;
    for (var i = 0; i < members.length; i++) {
      if ((members[i].name || "").trim() === name) return members[i];
    }
    return null;
  }

  /** 生成「首字 / 头像图」圆形头像元素 */
  function makeAvatar(user, email, cls) {
    var av = document.createElement("span");
    av.className = cls;
    if (user && user.avatar) {
      av.innerHTML = '<img src="/api/avatars/' + esc(user.avatar) + '" alt="">';
    } else {
      av.style.background = colorOf(email);
      av.textContent = firstChar(user && user.name, email);
    }
    return av;
  }

  /** 记录浏览历史并跳转个人主页 */
  function goProfile(email, name, department) {
    try {
      var recents = JSON.parse(localStorage.getItem("home_recent") || "[]");
      recents = recents.filter(function (r) { return r.id !== email; });
      recents.unshift({ _type: "user", email: email, name: name, department: department, id: email });
      localStorage.setItem("home_recent", JSON.stringify(recents.slice(0, 20)));
    } catch (e) {}
    location.href = profileUrl(email);
  }

  function show(email, anchor) {
    var card = byId(cardId);
    var m = memberByEmail(email);
    if (!card || !m) return;
    if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; }
    card.innerHTML = "";
    var head = document.createElement("div");
    head.className = "uc-head";
    head.appendChild(makeAvatar(m, email, "uc-av"));
    var box = document.createElement("div");
    box.style.minWidth = "0";
    var nm = document.createElement("div");
    nm.className = "uc-name";
    nm.textContent = m.name || m.email;
    var sub = document.createElement("div");
    sub.className = "uc-sub";
    sub.textContent = [m.department, m.title].filter(Boolean).join(" · ");
    box.appendChild(nm);
    box.appendChild(sub);
    head.appendChild(box);
    card.appendChild(head);

    var row = document.createElement("div");
    row.className = "uc-row";
    var lb = document.createElement("b");
    lb.textContent = "邮箱";
    row.appendChild(lb);
    var val = document.createElement("span");
    val.className = "mono";
    val.textContent = m.email;
    row.appendChild(val);
    card.appendChild(row);

    card.hidden = false;
    // 定位：优先锚点右下方，超出视口时收敛
    var r = anchor.getBoundingClientRect();
    var w = card.offsetWidth, h = card.offsetHeight;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    var top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    card.style.left = left + "px";
    card.style.top = top + "px";
  }

  function hide(now) {
    var card = byId(cardId);
    if (!card) return;
    if (now) {
      if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; }
      card.hidden = true;
      return;
    }
    cardTimer = setTimeout(function () { card.hidden = true; }, 140);
  }

  /** 给元素绑定「悬停弹用户卡片」行为 */
  function bind(el, email) {
    if (!email) return;
    el.addEventListener("mouseenter", function () { show(email, el); });
    el.addEventListener("mouseleave", function () { hide(false); });
  }

  /** 在容器内挂一次的事件代理：鼠标移出卡片本身也隐藏 */
  function init() {
    var card = byId(cardId);
    if (!card) return;
    card.addEventListener("mouseenter", function () {
      if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; }
    });
    card.addEventListener("mouseleave", function () { hide(false); });
    document.addEventListener("mousedown", function () { hide(true); });
    window.addEventListener("scroll", function () { if (!card.hidden) hide(true); }, true);
  }

  /**
   * 升级富文本里的 @提及：把服务端存下的 a[data-email]（或旧数据的 a.mention-link）
   * 渲染成「头像 + 名字」胶囊，并挂上悬停用户卡片与个人主页跳转
   */
  function decorateMentions(root) {
    var links = root.querySelectorAll("a.mention-link, a[data-email]");
    Array.prototype.forEach.call(links, function (a) {
      var email = a.getAttribute("data-email") || "";
      var name = a.textContent.replace(/^@/, "").trim();
      if (!email) {
        var hit = memberByName(name);
        if (hit) email = hit.email;
      }
      var m = memberByEmail(email);
      a.classList.remove("mention-link");
      a.classList.add("mention-chip");
      a.setAttribute("data-email", email);
      a.href = email ? profileUrl(email) : "#";
      a.innerHTML = "";
      a.appendChild(makeAvatar(m, email, "mc-av"));
      var nm = document.createElement("span");
      nm.textContent = "@" + ((m && m.name) || name);
      a.appendChild(nm);
      if (email) {
        bind(a, email);
        a.addEventListener("click", function (e) {
          e.preventDefault();
          goProfile(email, (m && m.name) || name, m && m.department);
        });
      }
    });
  }

  return {
    setMembers: setMembers,
    esc: esc,
    colorOf: colorOf,
    firstChar: firstChar,
    emailPrefix: emailPrefix,
    profileUrl: profileUrl,
    formatTime: formatTime,
    memberByEmail: memberByEmail,
    memberByName: memberByName,
    makeAvatar: makeAvatar,
    goProfile: goProfile,
    show: show,
    hide: hide,
    bind: bind,
    init: init,
    decorateMentions: decorateMentions,
  };
})();