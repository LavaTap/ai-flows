/* kb.js · 知识库页脚本：文章列表 + 详情 + 富文本撰写
   可见范围三选一（全体 / 指定部门 / 仅自己），无工单的待处理等状态流转 */
(function () {
  var boot = window.__KB__ || {};
  var user = boot.user || {};
  var isSuper = !!boot.isSupervisor;

  var UC = window.UserCard;
  UC.setMembers(boot.members || []);

  var esc = UC.esc;
  var colorOf = UC.colorOf;
  var firstChar = UC.firstChar;
  var profileUrl = UC.profileUrl;
  var formatTime = UC.formatTime;
  var makeAvatar = UC.makeAvatar;
  var goProfile = UC.goProfile;
  var memberByEmail = UC.memberByEmail;
  var bindUserCard = UC.bind;

  var PLACEHOLDER = "写正文…支持字号 / 对齐 / 列表 / 引用 / @提及成员 / 插入图片后可设置尺寸与文字环绕；" +
    "也认 Markdown：# 标题自动调字号、图片链接自动转图片、粘贴 Markdown 自动排版";

  function byId(id) {
    return document.getElementById(id);
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

  function stripTags(html) {
    return String(html || "").replace(/<[^>]*>/g, " ");
  }

  function visText(a) {
    if (a.visibility === "departments") {
      var deps = a.departments || [];
      return "指定部门可见（" + (deps.length ? deps.join("、") : "未设置") + "）";
    }
    if (a.visibility === "private") return "仅自己可见";
    return "全体可见";
  }

  var state = { articles: [], current: null, q: "", editing: false, commentInput: null };
  var createEditor = null;

  function sortArticles() {
    state.articles.sort(function (a, b) { return (b.updatedAt || "").localeCompare(a.updatedAt || ""); });
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    if (!q) return state.articles;
    return state.articles.filter(function (a) {
      var hay = ((a.title || "") + " " + (a.authorName || "") + " " + (a.updatedByName || "") +
        " " + stripTags(a.content)).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function renderList() {
    var list = byId("kbList");
    var items = filtered();
    list.innerHTML = "";
    if (!items.length) {
      var empty = document.createElement("li");
      empty.className = "tk-empty";
      empty.textContent = state.articles.length ? "没有匹配的文章" : "暂无文章，点「撰写」新建";
      list.appendChild(empty);
      return;
    }
    items.forEach(function (a) {
      var li = document.createElement("li");
      li.className = "tk-item" + (state.current && state.current.id === a.id ? " on" : "");
      li.addEventListener("click", function () { openDetail(a.id); });

      var title = document.createElement("div");
      title.className = "tk-item-title";
      title.textContent = a.title;

      var meta = document.createElement("div");
      meta.className = "tk-item-meta";
      var badge = document.createElement("span");
      badge.className = "tk-badge " + a.visibility;
      badge.textContent = a.visibility === "all" ? "全体" : a.visibility === "private" ? "仅自己" : "部门";
      meta.appendChild(badge);
      var who = document.createElement("span");
      who.className = "grow";
      who.textContent = a.authorName + (a.mine ? "（我）" : "");
      meta.appendChild(who);
      var time = document.createElement("span");
      time.textContent = formatTime(a.updatedAt);
      meta.appendChild(time);
      if (a.likes) {
        var like = document.createElement("span");
        like.textContent = "♥ " + a.likes;
        meta.appendChild(like);
      }

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

  /** 头像 + 名字胶囊：可点跳个人主页 + 悬停出用户卡片（与工单页样式一致） */
  function personLink(email, name) {
    var m = memberByEmail(email);
    var link = document.createElement("a");
    link.className = "mention-chip";
    link.href = profileUrl(email);
    link.setAttribute("data-email", email);
    link.appendChild(makeAvatar(m, email, "mc-av"));
    var nm = document.createElement("span");
    nm.textContent = name || email;
    link.appendChild(nm);
    link.addEventListener("click", function (e) {
      e.preventDefault();
      goProfile(email, (m && m.name) || name, m && m.department);
    });
    bindUserCard(link, email);
    return link;
  }

  function showPanel(which) {
    byId("emptyState").hidden = which !== "empty";
    byId("detailView").hidden = which !== "detail";
    byId("editorView").hidden = which !== "editor";
  }

  function renderDetail(a) {
    state.current = a;
    showPanel("detail");
    byId("dTitle").textContent = a.title;

    // 编辑按钮：撰写人本人或主管可见
    var editBtn = byId("editBtn");
    if (a.canEdit) {
      editBtn.style.display = "";
      editBtn.onclick = openEdit;
    } else {
      editBtn.style.display = "none";
    }

    // 删除按钮：撰写人本人或主管可见
    var delBtn = byId("delBtn");
    if (a.canEdit) {
      delBtn.style.display = "";
      delBtn.onclick = function () { removeArticle(a); };
    } else {
      delBtn.style.display = "none";
    }

    var meta = byId("dMeta");
    meta.innerHTML = "";
    var authorSpan = document.createElement("span");
    var ab = document.createElement("b");
    ab.textContent = "撰写人 ";
    authorSpan.appendChild(ab);
    authorSpan.appendChild(personLink(a.authorEmail, a.authorName + (a.mine ? "（我）" : "")));
    meta.appendChild(authorSpan);
    meta.appendChild(metaItem("可见范围 ", visText(a)));
    meta.appendChild(metaItem("创建 ", formatTime(a.createdAt)));
    var upSpan = document.createElement("span");
    var ub = document.createElement("b");
    ub.textContent = "最近更新 ";
    upSpan.appendChild(ub);
    upSpan.appendChild(document.createTextNode(formatTime(a.updatedAt) + " · "));
    upSpan.appendChild(personLink(a.updatedByEmail, a.updatedByName));
    meta.appendChild(upSpan);

    var contentEl = byId("dContent");
    contentEl.innerHTML = a.content; // 服务端已净化
    UC.decorateMentions(contentEl);
    renderLikeBar(a);
    renderComments(a);
    renderList();
  }

  /* ────────────── 点赞 ────────────── */

  /** 文章底部点赞条：点一次点赞，再点一次取消；点赞人名单作悬停提示 */
  function renderLikeBar(a) {
    var btn = byId("likeBtn");
    btn.classList.toggle("on", !!a.liked);
    byId("likeText").textContent = a.liked ? "已点赞" : "点赞";
    byId("likeCount").textContent = a.likes || 0;
    var names = a.likeNames || [];
    var namesEl = byId("likeNames");
    namesEl.textContent = names.length ? names.join("、") + " 赞了这篇" : "";
    namesEl.title = names.length ? names.join("、") : "";
    btn.onclick = function () { toggleArticleLike(a); };
  }

  /** 点赞后同步内存里的文章对象（列表卡片上的点赞数跟着变） */
  function applyLikeState(a, liked, likes) {
    a.liked = liked;
    a.likes = likes;
    var nm = user.name || user.email || "";
    var rest = (a.likeNames || []).filter(function (x) { return x !== nm; });
    a.likeNames = liked ? rest.concat([nm]) : rest;
    state.articles = state.articles.map(function (x) {
      if (x.id !== a.id) return x;
      x.likes = a.likes;
      x.liked = a.liked;
      return x;
    });
    renderLikeBar(a);
    renderList();
  }

  function toggleArticleLike(a) {
    var btn = byId("likeBtn");
    btn.disabled = true;
    post("/api/kb/" + encodeURIComponent(a.id) + "/like", {})
      .then(function (r) {
        btn.disabled = false;
        if (!r.ok) {
          alert((r.data && r.data.error) || "点赞失败");
          return;
        }
        applyLikeState(a, !!r.data.liked, r.data.likes || 0);
      })
      .catch(function () {
        btn.disabled = false;
        alert("点赞失败，请稍后重试");
      });
  }

  /** 评论点赞（与文章点赞同一套接口，target 换成 comment） */
  function toggleCommentLike(c, btn, countEl) {
    btn.disabled = true;
    post("/api/kb/comments/" + encodeURIComponent(c.id) + "/like", {})
      .then(function (r) {
        btn.disabled = false;
        if (!r.ok) {
          alert((r.data && r.data.error) || "点赞失败");
          return;
        }
        c.liked = !!r.data.liked;
        c.likes = r.data.likes || 0;
        btn.classList.toggle("on", c.liked);
        countEl.textContent = c.likes;
      })
      .catch(function () {
        btn.disabled = false;
        alert("点赞失败，请稍后重试");
      });
  }

  /* ────────────── 评论区（与工单页同款：纯文本 + @提及成员） ────────────── */

  function renderComments(a) {
    var host = byId("dComments");
    host.innerHTML = "";
    var list = a.commentList || [];
    byId("dCommentTitle").textContent = "评论（" + list.length + "）";
    list.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "tk-comment";
      row.appendChild(makeAvatar(memberByEmail(c.email), c.email, "tk-avatar"));

      var main = document.createElement("div");
      main.className = "tk-comment-main";

      var who = document.createElement("div");
      who.className = "tk-comment-who";
      var whoLink = document.createElement("a");
      whoLink.href = profileUrl(c.email);
      whoLink.className = "author-link";
      whoLink.textContent = c.author;
      whoLink.addEventListener("click", function (e) {
        e.preventDefault();
        goProfile(c.email, c.author, c.department);
      });
      bindUserCard(whoLink, c.email);
      who.appendChild(whoLink);
      var sub = document.createElement("span");
      sub.textContent = (c.department ? c.department + " · " : "") + formatTime(c.at);
      who.appendChild(sub);
      main.appendChild(who);

      var body = document.createElement("div");
      body.className = "tk-comment-body";
      body.innerHTML = c.content; // 服务端已净化
      UC.decorateMentions(body);
      main.appendChild(body);

      /* 评论底部：点赞 + 删除（本人或主管可见删除） */
      var foot = document.createElement("div");
      foot.className = "tk-comment-foot";
      var likeBtn = document.createElement("button");
      likeBtn.type = "button";
      likeBtn.className = "kb-like-mini" + (c.liked ? " on" : "");
      var ico = document.createElement("span");
      ico.setAttribute("aria-hidden", "true");
      ico.textContent = "♥";
      var countEl = document.createElement("span");
      countEl.textContent = c.likes || 0;
      likeBtn.appendChild(ico);
      likeBtn.appendChild(countEl);
      likeBtn.addEventListener("click", function () { toggleCommentLike(c, likeBtn, countEl); });
      foot.appendChild(likeBtn);
      if (c.canDelete) {
        var del = document.createElement("button");
        del.type = "button";
        del.className = "tk-comment-del";
        del.textContent = "删除";
        del.addEventListener("click", function () { removeComment(c); });
        foot.appendChild(del);
      }
      main.appendChild(foot);

      row.appendChild(main);
      host.appendChild(row);
    });
  }

  function addComment() {
    if (!state.current) return;
    var err = byId("commentError");
    var input = byId("commentInput");
    var text = input.value.replace(/\r\n?/g, "\n").trim();
    if (!text) {
      err.textContent = "评论内容不能为空";
      err.hidden = false;
      return;
    }
    var btn = byId("commentSubmit");
    btn.disabled = true;
    post("/api/kb/" + encodeURIComponent(state.current.id) + "/comments", {
      content: window.CommentInput.buildHtml(text, boot.members || []),
    })
      .then(function (r) {
        btn.disabled = false;
        if (!r.ok) {
          err.textContent = (r.data && r.data.error) || "评论失败";
          err.hidden = false;
          return;
        }
        err.hidden = true;
        input.value = "";
        if (state.commentInput) state.commentInput.close();
        // 服务端回的是带评论列表的完整文章视图，直接重渲染
        renderDetail(r.data.article);
      })
      .catch(function () {
        btn.disabled = false;
        err.textContent = "评论失败，请稍后重试";
        err.hidden = false;
      });
  }

  /** 删除评论（评论人本人或主管；服务端二次校验） */
  function removeComment(c) {
    if (!state.current) return;
    if (!window.confirm("确定删除这条评论？")) return;
    request(
      "DELETE",
      "/api/kb/" + encodeURIComponent(state.current.id) + "/comments/" + encodeURIComponent(c.id)
    )
      .then(function (r) {
        if (!r.ok) {
          alert((r.data && r.data.error) || "删除失败");
          return;
        }
        openDetail(state.current.id); // 重新拉详情刷新评论区
      })
      .catch(function () { alert("删除失败，请稍后重试"); });
  }

  /* ────────────── 可见范围控件 ────────────── */

  /** 构建部门多选项（只在撰写人切换到「指定部门」时展示） */
  function buildDeptBox() {
    var box = byId("deptBox");
    box.innerHTML = "";
    (boot.departments || []).forEach(function (d) {
      var label = document.createElement("label");
      label.className = "kb-dept";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = d;
      cb.addEventListener("change", function () {
        label.classList.toggle("on", cb.checked);
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(d));
      box.appendChild(label);
    });
  }

  function setVis(vis, deps) {
    var box = byId("deptBox");
    Array.prototype.forEach.call(byId("visSeg").querySelectorAll("button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-vis") === vis);
    });
    Array.prototype.forEach.call(box.querySelectorAll("input"), function (cb) {
      var on = (deps || []).indexOf(cb.value) !== -1;
      cb.checked = on;
      cb.parentNode.classList.toggle("on", on);
    });
    box.hidden = vis !== "departments";
  }

  function currentVis() {
    var on = byId("visSeg").querySelector("button.on");
    return on ? on.getAttribute("data-vis") : "all";
  }

  function currentDeps() {
    var out = [];
    Array.prototype.forEach.call(byId("deptBox").querySelectorAll("input"), function (cb) {
      if (cb.checked) out.push(cb.value);
    });
    return out;
  }

  function initVis() {
    buildDeptBox();
    byId("visSeg").addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      setVis(btn.getAttribute("data-vis"), currentDeps());
    });
    setVis("all", []);
  }

  /* ────────────── 交互动作 ────────────── */

  function loadArticles() {
    return get("/api/kb").then(function (r) {
      if (!r.ok) return;
      state.articles = (r.data && r.data.articles) || [];
      sortArticles();
      renderList();
    });
  }

  function openDetail(id) {
    get("/api/kb/" + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) {
        alert((r.data && r.data.error) || "文章加载失败");
        return;
      }
      renderDetail(r.data.article);
    });
  }

  function openCreate() {
    state.editing = false;
    showPanel("editor");
    byId("editorError").hidden = true;
    byId("eTitle").value = "";
    document.querySelector("#editorView h2").textContent = "撰写文章";
    setVis("all", []);
    if (!createEditor) createEditor = window.RichEditor.make(byId("editorHost"), { placeholder: PLACEHOLDER });
    else createEditor.clear();
    byId("eTitle").focus();
  }

  function openEdit() {
    if (!state.current) return;
    state.editing = true;
    showPanel("editor");
    byId("editorError").hidden = true;
    document.querySelector("#editorView h2").textContent = "编辑文章";
    byId("eTitle").value = state.current.title;
    setVis(state.current.visibility, state.current.departments);
    if (!createEditor) createEditor = window.RichEditor.make(byId("editorHost"), { placeholder: PLACEHOLDER });
    // 用落库原文填充（服务端已净化的 HTML，@提及链接保留 data-email 以便再次编辑）
    createEditor.setHtml(state.current.content);
    byId("eTitle").focus();
  }

  function saveArticle() {
    var title = byId("eTitle").value.trim();
    var html = createEditor ? createEditor.getHtml() : "";
    var vis = currentVis();
    var deps = currentDeps();
    var err = byId("editorError");
    if (!title) {
      err.textContent = "请填写标题";
      err.hidden = false;
      return;
    }
    if (!html || !stripTags(html).trim()) {
      err.textContent = "请填写正文";
      err.hidden = false;
      return;
    }
    if (vis === "departments" && !deps.length) {
      err.textContent = "请至少选择一个可见部门";
      err.hidden = false;
      return;
    }
    var btn = byId("saveBtn");
    btn.disabled = true;
    var isEdit = state.editing && state.current;
    var url = isEdit ? "/api/kb/" + encodeURIComponent(state.current.id) : "/api/kb";
    var method = isEdit ? "PUT" : "POST";
    request(method, url, { title: title, content: html, visibility: vis, departments: deps }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) {
        err.textContent = (r.data && r.data.error) || "保存失败";
        err.hidden = false;
        return;
      }
      err.hidden = true;
      createEditor.clear();
      var article = r.data.article;
      state.editing = false;
      var hit = false;
      state.articles = state.articles.map(function (a) {
        if (a.id === article.id) { hit = true; return article; }
        return a;
      });
      if (!hit) state.articles.unshift(article);
      sortArticles();
      renderDetail(article);
    }).catch(function () {
      btn.disabled = false;
      err.textContent = "保存失败，请稍后重试";
      err.hidden = false;
    });
  }

  /** 删除文章（撰写人本人或主管；服务端二次校验权限） */
  function removeArticle(a) {
    if (!a) return;
    if (!window.confirm("确定删除文章「" + a.title + "」？删除后不可恢复。")) return;
    request("DELETE", "/api/kb/" + encodeURIComponent(a.id))
      .then(function (r) {
        if (!r.ok) {
          alert((r.data && r.data.error) || "删除失败");
          return;
        }
        state.articles = state.articles.filter(function (x) { return x.id !== a.id; });
        state.current = null;
        showPanel("empty");
        renderList();
      })
      .catch(function () { alert("删除失败，请稍后重试"); });
  }

  function onCancelEdit() {
    if (state.editing && state.current) {
      showPanel("detail");
      state.editing = false;
    } else {
      showPanel("empty");
    }
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
  }

  function init() {
    initTopbar();
    UC.init();
    initVis();
    state.articles = boot.articles || [];
    sortArticles();
    renderList();
    byId("newBtn").addEventListener("click", openCreate);
    byId("cancelBtn").addEventListener("click", onCancelEdit);
    byId("cancelBtn2").addEventListener("click", onCancelEdit);
    byId("saveBtn").addEventListener("click", saveArticle);
    byId("commentSubmit").addEventListener("click", addComment);
    // 评论框的 @提及下拉（与工单页共用 /comment-input.js）
    state.commentInput = window.CommentInput.attach(byId("commentInput"), function () {
      return boot.members || [];
    });
    byId("searchInput").addEventListener("input", function () {
      state.q = this.value;
      renderList();
    });
    loadArticles().then(function () {
      // 支持从首页搜索 / 知识卡片带 ?id= 直接打开某篇文章
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