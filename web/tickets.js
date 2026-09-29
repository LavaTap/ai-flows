/* tickets.js · 工单（bug 单）页脚本：富文本提交 + 部门视角列表 + 状态流转 + 评论 */
(function () {
  var boot = window.__TICKETS__ || {};
  var user = boot.user || {};
  var isSuper = !!boot.isSupervisor;

  /* ────────────── 常量与工具 ────────────── */

  var STATUS_LABEL = { open: "待处理", doing: "处理中", resolved: "已解决" };
  var STATUS_ORDER = ["open", "doing", "resolved"];

  function byId(id) {
    return document.getElementById(id);
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

  function formatTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /** 判定净化前 HTML 是否为空（与服务端 isEmptyRichHtml 同规则） */
  function isEmptyHtml(html) {
    return !String(html || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
  }

  function request(method, url, body) {
    var init = { method: method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(url, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { ok: r.ok, status: r.status, data: d };
      });
    });
  }

  function post(url, body) { return request("POST", url, body); }
  function get(url) { return request("GET", url); }

  /* ────────────── 富文本编辑器（工具栏 + contenteditable） ────────────── */

  /** 图片上传：读为 base64 交给服务端落盘，返回可引用的图片地址 */
  function uploadImage(file) {
    return new Promise(function (resolve, reject) {
      if (file.size > 6 * 1024 * 1024) {
        reject(new Error("图片不能超过 6MB"));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || "");
        var b64 = s.slice(s.indexOf(",") + 1);
        post("/api/tickets/upload", { filename: file.name, contentBase64: b64 })
          .then(function (r) {
            if (!r.ok) {
              reject(new Error((r.data && r.data.error) || "图片上传失败"));
              return;
            }
            resolve(r.data.url);
          })
          .catch(function () { reject(new Error("图片上传失败")); });
      };
      reader.onerror = function () { reject(new Error("图片读取失败")); };
      reader.readAsDataURL(file);
    });
  }

  /** 在 host 内构建一个富文本编辑器，返回读写接口 */
  function makeEditor(host, opts) {
    opts = opts || {};
    host.innerHTML = "";
    var tpl = byId("editorTpl");
    var node = tpl.content.firstElementChild.cloneNode(true);
    if (opts.small) node.classList.add("small");
    var body = node.querySelector(".rt-body");
    if (opts.placeholder) body.setAttribute("data-placeholder", opts.placeholder);
    host.appendChild(node);

    var file = node.querySelector(".rt-file");

    Array.prototype.forEach.call(node.querySelectorAll(".rt-btn"), function (btn) {
      // 用 mousedown 阻止默认行为，保住编辑区内的选区
      btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
      btn.addEventListener("click", function () {
        var cmd = btn.getAttribute("data-cmd");
        var block = btn.getAttribute("data-block");
        var action = btn.getAttribute("data-action");
        if (action === "image") {
          file.click();
          return;
        }
        body.focus();
        if (cmd) document.execCommand(cmd, false, null);
        if (block) document.execCommand("formatBlock", false, block);
      });
    });

    node.querySelector(".rt-size").addEventListener("change", function () {
      body.focus();
      document.execCommand("fontSize", false, this.value);
    });

    file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      file.value = "";
      if (!f) return;
      uploadImage(f).then(function (url) {
        body.focus();
        document.execCommand("insertImage", false, url);
      }).catch(function (err) {
        alert(err.message);
      });
    });

    // 粘贴统一转纯文本，避免带入外部脚本与样式
    body.addEventListener("paste", function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });

    return {
      getHtml: function () { return body.innerHTML; },
      clear: function () { body.innerHTML = ""; },
      focus: function () { body.focus(); }
    };
  }

  /* ────────────── 页面状态与渲染 ────────────── */

  var state = {
    tickets: [],
    current: null,
    filter: { status: "all", q: "", mine: false }
  };
  var createEditor = null;
  var commentEditor = null;

  function filtered() {
    var q = state.filter.q.trim().toLowerCase();
    return state.tickets.filter(function (t) {
      if (state.filter.status !== "all" && t.status !== state.filter.status) return false;
      if (state.filter.mine && t.authorEmail !== user.email) return false;
      if (q) {
        var hay = (t.title + " " + t.authorName + " " + t.authorEmail).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderList() {
    var list = byId("ticketList");
    var items = filtered();
    list.innerHTML = "";
    if (!items.length) {
      var empty = document.createElement("li");
      empty.className = "tk-empty";
      empty.textContent = "暂无工单";
      list.appendChild(empty);
      return;
    }
    items.forEach(function (t) {
      var li = document.createElement("li");
      li.className = "tk-item" + (state.current && state.current.id === t.id ? " on" : "");
      li.addEventListener("click", function () { openDetail(t.id); });

      var title = document.createElement("div");
      title.className = "tk-item-title";
      title.textContent = t.title;

      var meta = document.createElement("div");
      meta.className = "tk-item-meta";
      if (t.kind === "requirement") {
        var kindBadge = document.createElement("span");
        kindBadge.className = "tk-badge req";
        kindBadge.textContent = t.assigneeEmail ? "指派" : "需求";
        meta.appendChild(kindBadge);
      }
      var badge = document.createElement("span");
      badge.className = "tk-badge " + t.status;
      badge.textContent = STATUS_LABEL[t.status] || t.status;
      meta.appendChild(badge);

      var who = document.createElement("span");
      who.className = "grow";
      who.textContent = t.authorName + (t.authorEmail === user.email ? "（我）" : "");
      meta.appendChild(who);

      var time = document.createElement("span");
      time.textContent = formatTime(t.updatedAt) + (t.commentCount ? " · " + t.commentCount + " 评论" : "");
      meta.appendChild(time);

      li.appendChild(title);
      li.appendChild(meta);
      list.appendChild(li);
    });
  }

  function metaItem(label, value) {
    var span = document.createElement("span");
    var b = document.createElement("b");
    b.textContent = label;
    span.appendChild(b);
    span.appendChild(document.createTextNode(value));
    return span;
  }

  function renderStatusBar(t) {
    var bar = byId("dStatusBar");
    bar.innerHTML = "";
    var label = document.createElement("span");
    label.className = "label";
    label.textContent = "状态";
    bar.appendChild(label);
    // 状态流转仅主管可操作：员工只看只读状态
    if (!isSuper) {
      var ro = document.createElement("span");
      ro.className = "tk-badge " + t.status;
      ro.textContent = STATUS_LABEL[t.status] || t.status;
      bar.appendChild(ro);
      var hint = document.createElement("span");
      hint.className = "label";
      hint.textContent = "（仅主管可切换）";
      bar.appendChild(hint);
      return;
    }
    STATUS_ORDER.forEach(function (s) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = STATUS_LABEL[s];
      btn.className = t.status === s ? "on " + s : "";
      btn.addEventListener("click", function () { changeStatus(s); });
      bar.appendChild(btn);
    });
  }

  function renderComments(t) {
    var host = byId("dComments");
    host.innerHTML = "";
    var list = t.commentList || [];
    byId("dCommentTitle").textContent = "评论（" + list.length + "）";
    list.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "tk-comment";

      var av = document.createElement("div");
      av.className = "tk-avatar";
      av.style.background = colorOf(c.email);
      av.textContent = firstChar(c.author, c.email);
      row.appendChild(av);

      var main = document.createElement("div");
      main.className = "tk-comment-main";

      var who = document.createElement("div");
      who.className = "tk-comment-who";
      who.textContent = c.author;
      var sub = document.createElement("span");
      sub.textContent = (c.department ? c.department + " · " : "") + formatTime(c.at);
      who.appendChild(sub);
      main.appendChild(who);

      var body = document.createElement("div");
      body.className = "tk-comment-body";
      body.innerHTML = c.content; // 服务端已白名单净化
      main.appendChild(body);

      row.appendChild(main);
      host.appendChild(row);
    });
  }

  function showPanel(which) {
    byId("emptyState").hidden = which !== "empty";
    byId("detailView").hidden = which !== "detail";
    byId("editorView").hidden = which !== "editor";
  }

  function renderDetail(t) {
    state.current = t;
    showPanel("detail");
    byId("dTitle").textContent = t.title;
    var badge = byId("dStatus");
    badge.className = "tk-badge " + t.status;
    badge.textContent = STATUS_LABEL[t.status] || t.status;

    var meta = byId("dMeta");
    meta.innerHTML = "";
    meta.appendChild(metaItem("提交人 ", t.authorName + (t.mine ? "（我）" : "")));
    meta.appendChild(metaItem("部门 ", t.department));
    meta.appendChild(metaItem("创建 ", formatTime(t.createdAt)));
    meta.appendChild(metaItem("更新 ", formatTime(t.updatedAt)));

    renderStatusBar(t);
    byId("dContent").innerHTML = t.content; // 服务端已白名单净化
    renderComments(t);
    byId("commentError").hidden = true;
    renderList();
  }

  /* ────────────── 交互动作 ────────────── */

  function loadTickets() {
    return get("/api/tickets").then(function (r) {
      if (!r.ok) return;
      state.tickets = (r.data && r.data.tickets) || [];
      renderList();
    });
  }

  function openDetail(id) {
    get("/api/tickets/" + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) {
        alert((r.data && r.data.error) || "工单加载失败");
        return;
      }
      renderDetail(r.data.ticket);
    });
  }

  function openCreate() {
    showPanel("editor");
    byId("editorError").hidden = true;
    byId("eTitle").value = "";
    if (!createEditor) createEditor = makeEditor(byId("editorHost"));
    else createEditor.clear();
    byId("eTitle").focus();
  }

  function saveTicket() {
    var title = byId("eTitle").value.trim();
    var html = createEditor ? createEditor.getHtml() : "";
    var err = byId("editorError");
    if (!title) {
      err.textContent = "请填写标题";
      err.hidden = false;
      return;
    }
    if (isEmptyHtml(html)) {
      err.textContent = "请填写问题描述";
      err.hidden = false;
      return;
    }
    var btn = byId("saveBtn");
    btn.disabled = true;
    post("/api/tickets", { title: title, content: html }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) {
        err.textContent = (r.data && r.data.error) || "提交失败";
        err.hidden = false;
        return;
      }
      err.hidden = true;
      createEditor.clear();
      var ticket = r.data.ticket;
      return loadTickets().then(function () { renderDetail(ticket); });
    }).catch(function () {
      btn.disabled = false;
      err.textContent = "提交失败，请稍后重试";
      err.hidden = false;
    });
  }

  function changeStatus(next) {
    if (!state.current || state.current.status === next) return;
    post("/api/tickets/" + encodeURIComponent(state.current.id) + "/status", { status: next })
      .then(function (r) {
        if (!r.ok) {
          alert((r.data && r.data.error) || "状态更新失败");
          return;
        }
        var ticket = r.data.ticket;
        state.tickets = state.tickets.map(function (t) {
          return t.id === ticket.id ? Object.assign({}, t, { status: ticket.status, updatedAt: ticket.updatedAt }) : t;
        });
        renderDetail(ticket);
      });
  }

  function addComment() {
    if (!state.current) return;
    var err = byId("commentError");
    var html = commentEditor ? commentEditor.getHtml() : "";
    if (isEmptyHtml(html)) {
      err.textContent = "评论内容不能为空";
      err.hidden = false;
      return;
    }
    var btn = byId("commentSubmit");
    btn.disabled = true;
    post("/api/tickets/" + encodeURIComponent(state.current.id) + "/comments", { content: html })
      .then(function (r) {
        btn.disabled = false;
        if (!r.ok) {
          err.textContent = (r.data && r.data.error) || "评论失败";
          err.hidden = false;
          return;
        }
        err.hidden = true;
        commentEditor.clear();
        var ticket = r.data.ticket;
        state.current = ticket;
        renderComments(ticket);
        renderStatusBar(ticket);
        loadTickets();
      })
      .catch(function () {
        btn.disabled = false;
        err.textContent = "评论失败，请稍后重试";
        err.hidden = false;
      });
  }

  /* ────────────── 初始化 ────────────── */

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
    if (isSuper) byId("teamLink").style.display = "inline-block";
  }

  function initFilters() {
    byId("statusSeg").addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      Array.prototype.forEach.call(this.querySelectorAll("button"), function (b) {
        b.classList.toggle("on", b === btn);
      });
      state.filter.status = btn.getAttribute("data-status");
      renderList();
    });
    byId("searchInput").addEventListener("input", function () {
      state.filter.q = this.value;
      renderList();
    });
    byId("mineOnly").addEventListener("change", function () {
      state.filter.mine = this.checked;
      renderList();
    });
  }

  function init() {
    initTopbar();
    initFilters();
    commentEditor = makeEditor(byId("commentEditorHost"), {
      small: true,
      placeholder: "补充说明…"
    });
    byId("newBtn").addEventListener("click", openCreate);
    byId("cancelBtn").addEventListener("click", function () { showPanel("empty"); });
    byId("cancelBtn2").addEventListener("click", function () { showPanel("empty"); });
    byId("saveBtn").addEventListener("click", saveTicket);
    byId("commentSubmit").addEventListener("click", addComment);
    loadTickets().then(function () {
      // 支持从节点面板 / 首页搜索带 ?id= 直接打开某张工单
      var deepId = new URLSearchParams(location.search).get("id");
      if (deepId) openDetail(deepId);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();