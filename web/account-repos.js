/* account-repos.js · 仓库管理页脚本（登记本机目录 + 绑定 GitHub 链接） */
(function () {
  var boot = window.__ACCOUNT_REPOS__ || {};
  var user = boot.user || {};
  var isSuper = !!boot.isSupervisor;
  var repos = Array.isArray(boot.repos) ? boot.repos.slice() : [];
  var pipelines = Array.isArray(boot.pipelines) ? boot.pipelines : [];
  var editingId = null;

  function byId(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function colorOf(email) {
    var s = String(email || ""); var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + ", 55%, 55%)";
  }

  function firstChar(u) {
    if (u.name && u.name.length) return u.name.charAt(0);
    return u.email ? u.email.charAt(0).toUpperCase() : "?";
  }

  function req(method, url, body) {
    var init = { method: method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(url, init).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; })
        .catch(function () { return { ok: r.ok, status: r.status, data: {} }; });
    });
  }

  function post(url, body) { return req("POST", url, body); }
  function put(url, body) { return req("PUT", url, body); }
  function del(url) { return req("DELETE", url); }

  /* ────────────── 顶栏 ────────────── */
  function initTopbar() {
    if (isSuper) {
      var teamLink = byId("teamLink");
      if (teamLink) teamLink.style.display = "inline-block";
    }
    var chip = document.querySelector(".user-chip");
    if (chip) {
      var av = chip.querySelector(".avatar");
      if (av) {
        if (user.avatar) {
          av.style.background = "none";
          av.innerHTML = '<img src="/api/avatars/' + esc(user.avatar) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">';
        } else {
          av.style.background = colorOf(user.email);
          av.textContent = firstChar(user);
        }
      }
    }
    var nameEl = byId("userName");
    if (nameEl) nameEl.textContent = user.name || user.email || "";
  }

  /* ────────────── 仓库列表 ────────────── */

  function pipelinesOf(repoId) {
    return pipelines.filter(function (p) { return p.repoId === repoId; });
  }

  function cardHtml(r) {
    var used = pipelinesOf(r.id);
    var tags = used.length
      ? used.map(function (p) { return '<span class="repo-tag">' + esc(p.name) + '</span>'; }).join("")
      : '<span class="repo-tag muted">未被管线使用</span>';
    var github = r.githubUrl
      ? '<a class="v link" href="' + esc(r.githubUrl) + '" target="_blank" rel="noopener">' + esc(r.githubUrl) + '</a>'
      : '<span class="v empty">未绑定</span>';

    if (editingId === r.id) {
      return ''
        + '<div class="repo-card" data-id="' + esc(r.id) + '">'
        +   '<div class="repo-card-head">'
        +     '<span class="repo-card-name">编辑仓库</span>'
        +   '</div>'
        +   '<div class="repo-edit">'
        +     '<div><label>仓库名称</label><input type="text" data-f="name" value="' + esc(r.name) + '"></div>'
        +     '<div><label>GitHub 链接</label><input type="text" data-f="githubUrl" value="' + esc(r.githubUrl || "") + '" placeholder="https://github.com/owner/repo"></div>'
        +     '<div class="full"><label>本机目录</label><input type="text" data-f="path" value="' + esc(r.path) + '"></div>'
        +   '</div>'
        +   '<div class="form-actions" style="margin-top:12px;">'
        +     '<button class="btn primary sm" data-act="save">保存</button>'
        +     '<button class="btn sm" data-act="cancel">取消</button>'
        +     '<span class="form-msg" data-msg></span>'
        +   '</div>'
        + '</div>';
    }

    return ''
      + '<div class="repo-card" data-id="' + esc(r.id) + '">'
      +   '<div class="repo-card-head">'
      +     '<span class="repo-card-name">' + esc(r.name) + '</span>'
      +     '<div class="repo-card-actions">'
      +       '<button class="btn sm" data-act="edit">编辑</button>'
      +       '<button class="btn sm danger" data-act="delete">删除</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="repo-meta">'
      +     '<div class="row"><span class="k">本机目录</span><span class="v">' + esc(r.path) + '</span></div>'
      +     '<div class="row"><span class="k">GitHub</span>' + github + '</div>'
      +     '<div class="row"><span class="k">被管线使用</span><div class="repo-tags">' + tags + '</div></div>'
      +   '</div>'
      + '</div>';
  }

  function render() {
    var list = byId("repoList");
    list.innerHTML = repos.map(cardHtml).join("");
    byId("repoCount").textContent = repos.length ? "（" + repos.length + "）" : "";
    byId("repoEmpty").style.display = repos.length ? "none" : "block";
  }

  function findRepo(id) {
    for (var i = 0; i < repos.length; i++) if (repos[i].id === id) return repos[i];
    return null;
  }

  function reload() {
    return req("GET", "/api/repos").then(function (res) {
      if (res.ok && res.data && Array.isArray(res.data.repos)) {
        repos = res.data.repos;
        render();
      }
    });
  }

  function handleListClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var card = e.target.closest(".repo-card");
    if (!card) return;
    var id = card.getAttribute("data-id");
    var r = findRepo(id);
    if (!r) return;
    var act = btn.getAttribute("data-act");

    if (act === "edit") {
      editingId = id;
      render();
      return;
    }
    if (act === "cancel") {
      editingId = null;
      render();
      return;
    }
    if (act === "delete") {
      if (!window.confirm('确定删除仓库「' + r.name + '」？已绑定该仓库的管线会自动解绑。')) return;
      btn.disabled = true;
      del("/api/repos/" + encodeURIComponent(id)).then(function (res) {
        if (res.ok) { reload(); }
        else { btn.disabled = false; window.alert((res.data && res.data.error) || "删除失败"); }
      }).catch(function () { btn.disabled = false; window.alert("删除失败，请稍后重试"); });
      return;
    }
    if (act === "save") {
      var msg = card.querySelector("[data-msg]");
      var name = card.querySelector('[data-f="name"]').value.trim();
      var githubUrl = card.querySelector('[data-f="githubUrl"]').value.trim();
      var path = card.querySelector('[data-f="path"]').value.trim();
      msg.textContent = "";
      msg.className = "form-msg";
      btn.disabled = true;
      put("/api/repos/" + encodeURIComponent(id), { name: name, githubUrl: githubUrl, path: path })
        .then(function (res) {
          btn.disabled = false;
          if (res.ok) { editingId = null; reload(); }
          else { msg.textContent = (res.data && res.data.error) || "保存失败"; msg.className = "form-msg err"; }
        })
        .catch(function () { btn.disabled = false; msg.textContent = "保存失败，请稍后重试"; msg.className = "form-msg err"; });
      return;
    }
  }

  /* ────────────── 新增仓库 ────────────── */

  function initAdd() {
    byId("repoForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = byId("addBtn");
      var msg = byId("addMsg");
      var body = {
        path: byId("newPath").value.trim(),
        name: byId("newName").value.trim(),
        githubUrl: byId("newGithub").value.trim(),
      };
      msg.textContent = "";
      msg.className = "form-msg";
      btn.disabled = true;
      post("/api/repos", body).then(function (res) {
        btn.disabled = false;
        if (res.ok) {
          byId("newPath").value = "";
          byId("newName").value = "";
          byId("newGithub").value = "";
          msg.textContent = "已登记";
          msg.className = "form-msg ok";
          reload();
        } else {
          msg.textContent = (res.data && res.data.error) || "登记失败";
          msg.className = "form-msg err";
        }
      }).catch(function () {
        btn.disabled = false;
        msg.textContent = "登记失败，请稍后重试";
        msg.className = "form-msg err";
      });
    });
  }

  /* ────────────── 启动 ────────────── */
  initTopbar();
  render();
  byId("repoList").addEventListener("click", handleListClick);
  initAdd();
})();
