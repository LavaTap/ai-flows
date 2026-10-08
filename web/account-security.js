/* account-security.js · 账号安全页脚本（修改本人密码 + 展示密码有效期） */
(function () {
  var boot = window.__ACCOUNT_SECURITY__ || {};
  var user = boot.user || {};
  var isSuper = !!boot.isSupervisor;
  var security = boot.security || {};
  var maxAgeDays = security.maxAgeDays || 10;
  var minLength = security.minLength || 6;

  /* ────────────── 工具函数 ────────────── */

  function byId(id) { return document.getElementById(id); }

  function colorOf(email) {
    var h = 0;
    for (var i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + ", 55%, 55%)";
  }

  function firstChar(u) {
    if (u.name && u.name.length) return u.name.charAt(0);
    return u.email ? u.email.charAt(0).toUpperCase() : "?";
  }

  function avatarUrl(u) { return u.avatar ? "/api/avatars/" + u.avatar : ""; }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function post(url, body) {
    var init = { method: "POST", headers: { "Content-Type": "application/json" } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(url, init).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
    });
  }

  /* ────────────── 顶栏 ────────────── */

  function renderUserChip() {
    var chip = document.querySelector(".user-chip");
    if (!chip) return;
    var av = chip.querySelector(".avatar");
    var nameEl = byId("userName");
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
    if (nameEl) nameEl.textContent = user.name || user.email || "未登录";
  }

  function initTopbar() {
    if (isSuper) {
      var teamLink = byId("teamLink");
      if (teamLink) teamLink.style.display = "inline-block";
    }
    renderUserChip();
  }

  /* ────────────── 密码有效期 ────────────── */

  function renderState() {
    var box = byId("pwState");
    var title = byId("pwStateTitle");
    var sub = byId("pwStateSub");
    var expired = !!security.expired;
    var daysLeft = security.daysLeft || 0;
    box.classList.toggle("warn", expired);
    if (expired) {
      title.textContent = "密码已到期，请立即更换";
      sub.textContent = "到期日 " + fmtDate(security.dueAt) + " · 平台要求每 " + maxAgeDays + " 天更换一次密码";
    } else {
      title.textContent = "密码有效，距下次更换还有 " + daysLeft + " 天";
      sub.textContent = "上次修改 " + fmtDate(security.since) + " · 到期日 " + fmtDate(security.dueAt);
    }
  }

  /* ────────────── 修改密码 ────────────── */

  function initForm() {
    byId("newHint").textContent = "至少 " + minLength + " 位，且不能与当前密码相同";

    byId("pwForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var oldPassword = byId("oldPassword").value;
      var newPassword = byId("newPassword").value;
      var confirm = byId("confirmPassword").value;
      var msg = byId("pwMsg");
      var btn = byId("pwSubmit");

      msg.className = "form-msg";
      msg.textContent = "";
      if (!oldPassword) {
        msg.className = "form-msg err";
        msg.textContent = "请输入当前密码";
        return;
      }
      if (newPassword.length < minLength) {
        msg.className = "form-msg err";
        msg.textContent = "新密码至少 " + minLength + " 位";
        return;
      }
      if (newPassword !== confirm) {
        msg.className = "form-msg err";
        msg.textContent = "两次输入的新密码不一致";
        return;
      }

      btn.disabled = true;
      post("/api/account/password", { oldPassword: oldPassword, newPassword: newPassword })
        .then(function (res) {
          if (!res.ok) {
            msg.className = "form-msg err";
            msg.textContent = (res.data && res.data.error) || "修改失败";
            return;
          }
          msg.className = "form-msg ok";
          msg.textContent = "密码已更新，有效期重新计算";
          security = res.data.security || security;
          user = res.data.user || user;
          renderState();
          byId("pwForm").reset();
        })
        .catch(function () {
          msg.className = "form-msg err";
          msg.textContent = "网络异常，请稍后重试";
        })
        .then(function () { btn.disabled = false; });
    });
  }

  function init() {
    initTopbar();
    renderState();
    initForm();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();