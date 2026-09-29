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

  /* ────────────── 顶栏 ────────────── */

  function initTopbar() {
    if (isSuper) {
      var teamLink = document.getElementById("teamLink");
      if (teamLink) teamLink.style.display = "inline-block";
      var teamSide = document.getElementById("teamSide");
      if (teamSide) teamSide.style.display = "flex";
    }
    var logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        post("/api/logout").then(function () { location.href = "/login"; });
      });
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

  /* ────────────── 个人资料 ────────────── */

  function renderProfile() {
    var av = document.getElementById("avatar");
    var url = avatarUrl(user);
    if (url) {
      av.style.background = "none";
      av.innerHTML = '<img src="' + url + '" alt=""><span class="cam">更换</span>';
    } else {
      av.style.background = colorOf(user.email);
      av.textContent = firstChar(user);
      var cam = document.createElement("span");
      cam.className = "cam";
      cam.textContent = "更换";
      av.appendChild(cam);
    }

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

  /* ────────────── GitHub 只读展示 ────────────── */

  function renderGithub() {
    var label = document.getElementById("ghLabel");
    var value = document.getElementById("ghValue");
    if (user.github) {
      label.textContent = "已绑定";
      value.textContent = "@" + user.github;
    } else if (user.githubPending) {
      label.textContent = "待审核";
      value.textContent = "@" + user.githubPending + "（等待主管批准）";
    } else {
      label.textContent = "未绑定";
      value.textContent = "尚未绑定 GitHub 账号";
    }
  }

  /* ────────────── 头像上传 + 裁剪 ────────────── */

  var cropState = { img: null, scale: 1, size: 300 };

  function initAvatarUpload() {
    var avatar = document.getElementById("avatar");
    var fileInput = document.getElementById("avatarFile");
    avatar.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          cropState.img = img;
          cropState.scale = 1;
          document.getElementById("cropScale").value = 1;
          openCrop();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(f);
      fileInput.value = "";
    });

    document.getElementById("cropCancel").addEventListener("click", closeCrop);
    document.getElementById("cropConfirm").addEventListener("click", confirmCrop);
    document.getElementById("cropScale").addEventListener("input", function (e) {
      cropState.scale = parseFloat(e.target.value);
      drawCrop();
    });
    document.getElementById("cropMask").addEventListener("click", function (e) {
      if (e.target.id === "cropMask") closeCrop();
    });
  }

  function openCrop() {
    document.getElementById("cropMask").classList.add("show");
    drawCrop();
  }

  function closeCrop() {
    document.getElementById("cropMask").classList.remove("show");
  }

  function drawCrop() {
    var canvas = document.getElementById("cropCanvas");
    var ctx = canvas.getContext("2d");
    var img = cropState.img;
    if (!img) return;
    var size = cropState.size;
    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, size, size);
    // 以图片中心为中心，按 scale 缩放后绘制
    var side = Math.min(img.width, img.height);
    var sx = (img.width - side) / 2;
    var sy = (img.height - side) / 2;
    var drawSize = size * cropState.scale;
    var dx = (size - drawSize) / 2;
    var dy = (size - drawSize) / 2;
    ctx.drawImage(img, sx, sy, side, side, dx, dy, drawSize, drawSize);
    // 圆形预览
    document.getElementById("cropPreview").src = canvas.toDataURL("image/png");
  }

  function confirmCrop() {
    var canvas = document.getElementById("cropCanvas");
    var dataUrl = canvas.toDataURL("image/png");
    var btn = document.getElementById("cropConfirm");
    btn.disabled = true;
    post("/api/account/avatar", { avatar: dataUrl }).then(function (res) {
      if (res.ok && res.data && res.data.user) {
        user.avatar = res.data.user.avatar;
        renderProfile();
        closeCrop();
      } else {
        alert((res.data && res.data.error) || "上传失败");
      }
      btn.disabled = false;
    });
  }

  /* ────────────── 启动 ────────────── */

  initTopbar();
  renderProfile();
  renderGithub();
  initAvatarUpload();
})();
