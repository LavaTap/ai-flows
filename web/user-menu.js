/* user-menu.js · 顶栏用户菜单（点开显示放大资料 + 设置入口）
   共享逻辑：各页只放同名 DOM（#userChip / #userPanel），本脚本负责开合与资料填充。
   资料源：从各页注入的 boot 全局里取 user（__ACCOUNT__ / __PIPELINE__ / __TICKETS__ / __GHAUDIT__ / __CHAT__ / __TEAM__ / __HOME__）。 */
(function () {
  var BOOT_KEYS = ["__ACCOUNT__", "__PIPELINE__", "__TICKETS__", "__GHAUDIT__", "__CHAT__", "__TEAM__", "__HOME__"];

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

  function fillPanel(user) {
    if (!user) return;
    var av = document.querySelector("#userPanel .avatar");
    var nameEl = document.getElementById("userPanelName");
    var emailEl = document.getElementById("userPanelEmail");
    var url = avatarUrl(user);
    if (av) {
      if (url) {
        av.style.background = "none";
        av.innerHTML =
          '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">';
      } else {
        av.style.background = colorOf(user.email);
        av.textContent = firstChar(user);
      }
    }
    if (nameEl) nameEl.textContent = displayName(user);
    if (emailEl) emailEl.textContent = user.email || "";
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

    fillPanel(bootUser());

    /* 退出登录 */
    var logoutItem = panel.querySelector(".user-panel-logout");
    if (logoutItem) {
      logoutItem.addEventListener("click", function () {
        fetch("/api/logout", { method: "POST" }).finally(function () {
          location.href = "/login";
        });
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();