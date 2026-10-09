/* account-repo.js · 管线设置页脚本（管线列表 + 为每条管线选绑仓库） */
(function () {
  var boot = window.__ACCOUNT_REPO__ || {};
  var user = boot.user || {};
  var isSuper = !!boot.isSupervisor;
  var pipelines = Array.isArray(boot.pipelines) ? boot.pipelines.slice() : [];
  var repos = Array.isArray(boot.repos) ? boot.repos.slice() : [];
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
      if (teamLink) teamLink.style.display = "";
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

  /* ────────────── 仓库下拉 ────────────── */

  function ownerRepo(url) {
    var m = String(url || "").match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i);
    return m ? m[1] + "/" + m[2] : "";
  }

  function repoOptionLabel(r) {
    var gh = ownerRepo(r.githubUrl);
    return r.name + (gh ? "（/" + gh + "）" : "");
  }

  function repoOptions(selectedId) {
    var html = '<option value="">不绑定仓库</option>';
    html += repos.map(function (r) {
      var sel = r.id === selectedId ? " selected" : "";
      return '<option value="' + esc(r.id) + '"' + sel + '>' + esc(repoOptionLabel(r)) + '</option>';
    }).join("");
    return html;
  }

  function repoById(id) {
    for (var i = 0; i < repos.length; i++) if (repos[i].id === id) return repos[i];
    return null;
  }

  /* ────────────── 管线列表 ────────────── */

  function cardHtml(p) {
    var r = p.repoId ? repoById(p.repoId) : null;
    var github = r && r.githubUrl
      ? '<a class="v link" href="' + esc(r.githubUrl) + '" target="_blank" rel="noopener">/' + esc(ownerRepo(r.githubUrl)) + '</a>'
      : '<span class="v empty">' + (r ? "该仓库未绑定 GitHub 链接" : "未绑定仓库") + '</span>';
    var repoPath = r
      ? '<span class="v">' + esc(r.path) + '</span>'
      : '<span class="v empty">—</span>';

    if (editingId === p.id) {
      return ''
        + '<div class="pl-card" data-id="' + esc(p.id) + '">'
        +   '<div class="pl-card-head"><span class="pl-name">编辑管线</span></div>'
        +   '<div class="pl-edit">'
        +     '<div class="full"><label>管线名称</label><input type="text" data-f="name" value="' + esc(p.name) + '"></div>'
        +     '<div class="full"><label>绑定仓库</label><span class="select-wrap"><select data-f="repoId">' + repoOptions(p.repoId || "") + '</select></span></div>'
        +   '</div>'
        +   '<div class="form-actions" style="margin-top:12px;">'
        +     '<button class="btn primary sm" data-act="save">保存</button>'
        +     '<button class="btn sm" data-act="cancel">取消</button>'
        +     '<span class="form-msg" data-msg></span>'
        +   '</div>'
        + '</div>';
    }

    return ''
      + '<div class="pl-card" data-id="' + esc(p.id) + '">'
      +   '<div class="pl-card-head">'
      +     '<span class="pl-name">' + esc(p.name) + '</span>'
      +     '<div class="pl-actions">'
      +       '<button class="btn sm" data-act="edit">编辑</button>'
      +       '<button class="btn sm danger" data-act="delete">删除</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="pl-meta">'
      +     '<div class="row"><span class="k">绑定仓库</span><span class="select-wrap"><select data-act="repo">' + repoOptions(p.repoId || "") + '</select></span></div>'
      +     '<div class="row"><span class="k">本机目录</span>' + repoPath + '</div>'
      +     '<div class="row"><span class="k">GitHub</span>' + github + '</div>'
      +   '</div>'
      + '</div>';
  }

  function render() {
    var list = byId("plList");
    list.innerHTML = pipelines.map(cardHtml).join("");
    byId("plCount").textContent = pipelines.length ? "（" + pipelines.length + "）" : "";
    byId("plEmpty").style.display = pipelines.length ? "none" : "block";
    var sel = byId("newRepo");
    if (sel) sel.innerHTML = repoOptions("");
  }

  function findPipeline(id) {
    for (var i = 0; i < pipelines.length; i++) if (pipelines[i].id === id) return pipelines[i];
    return null;
  }

  function reload() {
    return req("GET", "/api/pipelines").then(function (res) {
      if (res.ok && res.data && Array.isArray(res.data.pipelines)) {
        pipelines = res.data.pipelines.map(function (p) {
          return { id: p.id, name: p.name, repoId: p.repoId || "" };
        });
        render();
      }
    });
  }

  function handleListChange(e) {
    var sel = e.target.closest('select[data-act="repo"]');
    if (!sel) return;
    var card = e.target.closest(".pl-card");
    var p = findPipeline(card.getAttribute("data-id"));
    if (!p) return;
    sel.disabled = true;
    put("/api/pipelines/" + encodeURIComponent(p.id), { repoId: sel.value })
      .then(function (res) {
        sel.disabled = false;
        if (res.ok) { reload(); }
        else { window.alert((res.data && res.data.error) || "保存失败"); reload(); }
      })
      .catch(function () { sel.disabled = false; window.alert("保存失败，请稍后重试"); reload(); });
  }

  function handleListClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var card = e.target.closest(".pl-card");
    if (!card) return;
    var id = card.getAttribute("data-id");
    var p = findPipeline(id);
    if (!p) return;
    var act = btn.getAttribute("data-act");

    if (act === "edit") { editingId = id; render(); return; }
    if (act === "cancel") { editingId = null; render(); return; }

    if (act === "delete") {
      if (!confirm('确定删除管线「' + p.name + '」？该管线的全部节点会一并删除。')) return;
      btn.disabled = true;
      del("/api/pipelines/" + encodeURIComponent(id)).then(function (res) {
        if (res.ok) { reload(); }
        else { btn.disabled = false; window.alert((res.data && res.data.error) || "删除失败"); }
      }).catch(function () { btn.disabled = false; window.alert("删除失败，请稍后重试"); });
      return;
    }

    if (act === "save") {
      var msg = card.querySelector("[data-msg]");
      var name = card.querySelector('[data-f="name"]').value.trim();
      var repoId = card.querySelector('[data-f="repoId"]').value;
      msg.textContent = "";
      msg.className = "form-msg";
      btn.disabled = true;
      put("/api/pipelines/" + encodeURIComponent(id), { name: name, repoId: repoId })
        .then(function (res) {
          btn.disabled = false;
          if (res.ok) { editingId = null; reload(); }
          else { msg.textContent = (res.data && res.data.error) || "保存失败"; msg.className = "form-msg err"; }
        })
        .catch(function () { btn.disabled = false; msg.textContent = "保存失败，请稍后重试"; msg.className = "form-msg err"; });
      return;
    }
  }

  /* ────────────── 新增管线 ────────────── */

  function initAdd() {
    byId("plForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = byId("addBtn");
      var msg = byId("addMsg");
      var body = {
        name: byId("newName").value.trim(),
        repoId: byId("newRepo").value,
      };
      msg.textContent = "";
      msg.className = "form-msg";
      btn.disabled = true;
      post("/api/pipelines", body).then(function (res) {
        btn.disabled = false;
        if (res.ok) {
          byId("newName").value = "";
          msg.textContent = "已创建，可到「AI 管线」页查看";
          msg.className = "form-msg ok";
          reload();
        } else {
          msg.textContent = (res.data && res.data.error) || "创建失败";
          msg.className = "form-msg err";
        }
      }).catch(function () {
        btn.disabled = false;
        msg.textContent = "创建失败，请稍后重试";
        msg.className = "form-msg err";
      });
    });
  }

  /* ────────────── 启动 ────────────── */
  initTopbar();
  render();
  byId("plList").addEventListener("click", handleListClick);
  byId("plList").addEventListener("change", handleListChange);
  initAdd();
})();
