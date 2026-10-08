/* tickets.js · 工单（bug 单）页脚本：富文本提交 + 部门视角列表 + 状态流转 + 评论 */
(function () {
  var boot = window.__TICKETS__ || {};
  var user = boot.user || {};
  var isSuper = !!boot.isSupervisor;

  /* ────────────── 常量与工具 ────────────── */

  var STATUS_LABEL = { open: "待处理", doing: "处理中", resolved: "已解决" };
  var STATUS_ORDER = ["open", "doing", "resolved"];

  /** 工单编辑器提示与占位文案（新建 / 编辑共用） */
  var EDITOR_HINT =
    "支持字号 / 对齐 / 列表 / 引用 / @提及成员；插入图片后可点选图片设置尺寸与文字环绕（也可拖右下角手柄缩放）；点工具条「知识库」可引用文章（插入后显示为知识卡片）；图片上限 6MB；" +
    "也认 Markdown：# 标题自动调字号、图片链接（含 ![说明](地址)）自动转图片、粘贴 Markdown 自动排版。";
  var EDITOR_PLACEHOLDER = "描述复现步骤、预期结果与实际结果…（支持 Markdown：# 标题、图片链接自动转图片）";

  function byId(id) {
    return document.getElementById(id);
  }

  /* 通用工具（esc / colorOf / firstChar / profileUrl / formatTime 等）见共享模块 /user-card.js，
     在下方「成员与用户卡片」段以别名接线 */

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

  /* ────────────── 成员与用户卡片（共享实现：/user-card.js） ────────────── */

  var members = boot.members || [];
  /** @提及选中过的成员缓存（姓名 → 用户对象），供 buildCommentHtml 把 @姓名 转成带 email 的链接 */
  var mentionUserCache = {};
  var UC = window.UserCard;
  UC.setMembers(members);

  var colorOf = UC.colorOf;
  var firstChar = UC.firstChar;
  var esc = UC.esc;
  var profileUrl = UC.profileUrl;
  var formatTime = UC.formatTime;
  var makeAvatar = UC.makeAvatar;
  var goProfile = UC.goProfile;
  var memberByEmail = UC.memberByEmail;
  var bindUserCard = UC.bind;

  /** 初始化悬停用户卡片（全局事件只挂一次） */
  function initUserCard() {
    UC.init();
  }

  /* ────────────── 知识库引用（编辑器「知识库」按钮 + 正文知识卡片） ────────────── */

  /** id → 卡片信息（平台注入的当前用户可见知识库索引） */
  var kbIndex = {};
  (boot.kb || []).forEach(function (k) { kbIndex[k.id] = k; });

  /** 把正文里的 a[data-kb-id] 渲染成知识卡片（名称 / 撰写人 / 最近更新） */
  function decorateKbCards(root) {
    var links = root.querySelectorAll("a[data-kb-id]");
    Array.prototype.forEach.call(links, function (a) {
      var id = a.getAttribute("data-kb-id") || "";
      var info = kbIndex[id];
      var fallbackTitle = a.textContent || id;
      a.classList.add("kb-card");
      a.href = "/kb?id=" + encodeURIComponent(id);
      a.target = "_blank";
      a.rel = "noopener";
      a.innerHTML = "";
      var ico = document.createElement("span");
      ico.className = "kb-ico";
      ico.innerHTML =
        '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">' +
        '<path d="M4 1.5h5.5L13 5v9.5H4z" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
        '<path d="M9.5 1.5V5H13" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
      a.appendChild(ico);
      var body = document.createElement("span");
      body.className = "kb-body";
      var nm = document.createElement("span");
      nm.className = "kb-name";
      nm.textContent = (info && info.title) || fallbackTitle;
      body.appendChild(nm);
      var meta = document.createElement("span");
      meta.className = "kb-meta";
      meta.textContent = info
        ? "撰写人 " + (info.authorName || "—") + " · 最近更新 " +
          (formatTime(info.updatedAt) || "—") + " · 更新人 " + (info.updatedByName || "—")
        : "知识库文章（已不可见）";
      body.appendChild(meta);
      a.appendChild(body);
    });
  }

  /** 引用选择浮层（编辑器工具条「知识库」）：选中后把带 data-kb-id 的链接插到光标处 */
  var kbPop = null;

  function closeKbPop() {
    if (!kbPop) return;
    kbPop.remove();
    kbPop = null;
    document.removeEventListener("mousedown", onKbDocDown, true);
  }

  function onKbDocDown(e) {
    if (kbPop && !kbPop.contains(e.target)) closeKbPop();
  }

  function openKbPicker(ctx) {
    closeKbPop();
    var list = boot.kb || [];
    var pop = document.createElement("div");
    pop.className = "assign-pop";
    var title = document.createElement("div");
    title.className = "ap-title";
    title.textContent = "引用知识库文章（插入后显示为知识卡片）";
    pop.appendChild(title);
    var search = document.createElement("input");
    search.className = "tk-input";
    search.type = "search";
    search.placeholder = "搜索标题 / 撰写人";
    search.maxLength = 40;
    pop.appendChild(search);
    var ul = document.createElement("ul");
    ul.className = "ap-list";
    pop.appendChild(ul);

    function render(q) {
      var ql = (q || "").trim().toLowerCase();
      var hit = list.filter(function (k) {
        if (!ql) return true;
        return ((k.title || "") + " " + (k.authorName || "")).toLowerCase().indexOf(ql) !== -1;
      }).slice(0, 30);
      ul.innerHTML = "";
      if (!hit.length) {
        var empty = document.createElement("li");
        empty.className = "tk-empty";
        empty.textContent = list.length ? "没有匹配的文章" : "暂无可见的知识库文章";
        ul.appendChild(empty);
        return;
      }
      hit.forEach(function (k) {
        var li = document.createElement("li");
        li.className = "ap-item";
        var meta = document.createElement("div");
        meta.className = "ap-meta";
        var nm = document.createElement("div");
        nm.className = "ap-name";
        nm.textContent = k.title || k.id;
        var sub = document.createElement("div");
        sub.className = "ap-sub";
        sub.textContent = "撰写人 " + (k.authorName || "—") + " · 更新 " + (formatTime(k.updatedAt) || "—");
        meta.appendChild(nm);
        meta.appendChild(sub);
        li.appendChild(meta);
        // 用 mousedown 保住编辑器选区（不夺焦），再在光标处插入链接
        li.addEventListener("mousedown", function (e) {
          e.preventDefault();
          closeKbPop();
          ctx.insertHtml(
            '<a href="/kb?id=' + encodeURIComponent(k.id) + '" data-kb-id="' + esc(k.id) + '">' +
            esc(k.title || k.id) + "</a>"
          );
        });
        ul.appendChild(li);
      });
    }

    pop.style.visibility = "hidden";
    document.body.appendChild(pop);
    kbPop = pop;
    render("");
    search.addEventListener("input", function () { render(search.value); });
    search.addEventListener("keydown", function (e) { if (e.key === "Escape") closeKbPop(); });

    // 定位在编辑器工具条正下方
    var host = byId("editorHost") || pop.parentNode;
    var r = host.getBoundingClientRect();
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    var top = r.top + 44;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
    pop.style.visibility = "";
    document.addEventListener("mousedown", onKbDocDown, true);
  }

  /* ────────────── 富文本编辑器（共享实现：/richtext-editor.js） ────────────── */

  /** 在 host 内构建富文本编辑器（字号 / 图片尺寸与环绕 / @提及 / 知识库引用） */
  function makeEditor(host, opts) {
    var o = opts || {};
    if (!o.onPickKnowledge) o.onPickKnowledge = openKbPicker;
    return window.RichEditor.make(host, o);
  }

  /* ────────────── 页面状态与渲染 ────────────── */

  var state = {
    tickets: [],
    current: null,
    filter: { status: "all", q: "", mine: false },
    editing: false
  };
  var createEditor = null;

  function filtered() {
    var q = state.filter.q.trim().toLowerCase();
    return state.tickets.filter(function (t) {
      if (state.filter.status !== "all" && t.status !== state.filter.status) return false;
      if (state.filter.mine && t.authorEmail !== user.email) return false;
      if (q) {
        var hay = (t.title + " " + t.authorName + " " + t.authorEmail + " " + (t.assigneeName || "")).toLowerCase();
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
      if (t.assigneeName) who.textContent += " → " + t.assigneeName;
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

  /**
   * 正文渲染：@ 提及胶囊（共享 /user-card.js）+ 知识库引用卡片
   */
  function decorateRich(root) {
    UC.decorateMentions(root);
    decorateKbCards(root);
  }

  /**
   * 纯文本评论 → 落库 HTML：转义 + 换行转 <br> + @姓名 转带 data-email 的提及链接
   * （评论输入为纯文本，这里只做最小转换，仍由服务端 sanitizeRichHtml 二次净化）
   */
  function buildCommentHtml(text) {
    var names = [];
    var byName = {};
    members.forEach(function (m) {
      var nm = (m.name || "").trim();
      if (!nm || byName[nm]) return;
      byName[nm] = m;
      names.push(nm);
    });
    // 把 @提及 候选里选过的人也加进来（搜索接口返回的可能不在 members 里）
    Object.keys(mentionUserCache || {}).forEach(function (nm) {
      if (!byName[nm]) {
        byName[nm] = mentionUserCache[nm];
        names.push(nm);
      }
    });
    names.sort(function (a, b) { return b.length - a.length; });

    function escText(s) {
      return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    var out = "";
    var plain = "";
    function flush() {
      if (plain) { out += escText(plain); plain = ""; }
    }
    var i = 0;
    while (i < text.length) {
      var ch = text.charAt(i);
      if (ch === "@" && (i === 0 || /[\s\u3000]/.test(text.charAt(i - 1)))) {
        var hit = null;
        for (var k = 0; k < names.length; k++) {
          if (text.substr(i + 1, names[k].length) === names[k]) { hit = names[k]; break; }
        }
        if (hit) {
          flush();
          var m = byName[hit];
          out += '<a href="' + esc(profileUrl(m.email)) + '" data-email="' + esc(m.email) + '">@' + escText(hit) + "</a>";
          i += hit.length + 1;
          continue;
        }
      }
      if (ch === "\n") { flush(); out += "<br>"; i++; continue; }
      plain += ch;
      i++;
    }
    flush();
    return out;
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

      var av = makeAvatar(memberByEmail(c.email), c.email, "tk-avatar");
      row.appendChild(av);

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
      decorateRich(body);
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

  /* ────────────── 负责人（指派 / 改派 / 清除） ────────────── */

  var assignPop = null;

  function onAssignDocDown(e) {
    if (assignPop && !assignPop.contains(e.target)) closeAssignPop();
  }

  function closeAssignPop() {
    if (!assignPop) return;
    assignPop.remove();
    assignPop = null;
    document.removeEventListener("mousedown", onAssignDocDown, true);
    window.removeEventListener("scroll", onAssignDocDown, true);
  }

  /** 负责人 meta 项：名字胶囊（悬停出用户卡片）+ 主管「指派 / 改派」按钮 */
  function renderAssignee(t) {
    var span = document.createElement("span");
    var b = document.createElement("b");
    b.textContent = "负责人 ";
    span.appendChild(b);
    if (t.assigneeEmail) {
      var m = memberByEmail(t.assigneeEmail);
      var chip = document.createElement("a");
      chip.className = "mention-chip";
      chip.href = profileUrl(t.assigneeEmail);
      chip.setAttribute("data-email", t.assigneeEmail);
      chip.appendChild(makeAvatar(m, t.assigneeEmail, "mc-av"));
      var nm = document.createElement("span");
      nm.textContent = (m && m.name) || t.assigneeName || t.assigneeEmail;
      chip.appendChild(nm);
      chip.addEventListener("click", function (e) {
        e.preventDefault();
        goProfile(t.assigneeEmail, (m && m.name) || t.assigneeName, m && m.department);
      });
      bindUserCard(chip, t.assigneeEmail);
      span.appendChild(chip);
    } else {
      var none = document.createElement("span");
      none.className = "tk-none";
      none.textContent = "未指派";
      span.appendChild(none);
    }
    if (isSuper) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tk-assign-btn";
      btn.textContent = t.assigneeEmail ? "改派" : "指派";
      btn.addEventListener("click", function () { openAssignPop(btn, t); });
      span.appendChild(btn);
    }
    return span;
  }

  /** 打开成员选择浮层（仅主管） */
  function openAssignPop(anchor, t) {
    closeAssignPop();
    var pop = document.createElement("div");
    pop.className = "assign-pop";
    var title = document.createElement("div");
    title.className = "ap-title";
    title.textContent = t.nodeId
      ? "指派负责人（该员工会加入关联节点的执行角色）"
      : "指派负责人（被指派者会收到消息提醒）";
    pop.appendChild(title);
    var search = document.createElement("input");
    search.className = "tk-input";
    search.type = "search";
    search.placeholder = "搜索姓名 / 邮箱 / 部门";
    search.maxLength = 40;
    pop.appendChild(search);
    var list = document.createElement("ul");
    list.className = "ap-list";
    pop.appendChild(list);

    function renderMemberList(q) {
      var ql = (q || "").trim().toLowerCase();
      var hit = members.filter(function (m) {
        if (!ql) return true;
        var hay = ((m.name || "") + " " + m.email + " " + (m.department || "") + " " + (m.title || "")).toLowerCase();
        return hay.indexOf(ql) !== -1;
      }).slice(0, 30);
      list.innerHTML = "";
      if (!hit.length) {
        var empty = document.createElement("li");
        empty.className = "tk-empty";
        empty.textContent = "没有匹配的成员";
        list.appendChild(empty);
        return;
      }
      hit.forEach(function (m) {
        var li = document.createElement("li");
        li.className = "ap-item";
        li.appendChild(makeAvatar(m, m.email, "tk-avatar"));
        var meta = document.createElement("div");
        meta.className = "ap-meta";
        var nm = document.createElement("div");
        nm.className = "ap-name";
        nm.textContent = (m.name || m.email) + (m.email === t.assigneeEmail ? "（当前负责人）" : "");
        var sub = document.createElement("div");
        sub.className = "ap-sub";
        sub.textContent = [m.department, m.title, m.email].filter(Boolean).join(" · ");
        meta.appendChild(nm);
        meta.appendChild(sub);
        li.appendChild(meta);
        li.addEventListener("click", function () {
          closeAssignPop();
          assignTicket(t.id, m.email);
        });
        list.appendChild(li);
      });
    }

    if (t.assigneeEmail) {
      var clear = document.createElement("button");
      clear.type = "button";
      clear.className = "ap-clear";
      clear.textContent = "清除负责人";
      clear.addEventListener("click", function () {
        closeAssignPop();
        assignTicket(t.id, "");
      });
      pop.appendChild(clear);
    }

    pop.style.visibility = "hidden";
    document.body.appendChild(pop);
    assignPop = pop;
    renderMemberList("");
    search.addEventListener("input", function () { renderMemberList(search.value); });
    search.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeAssignPop();
    });

    var r = anchor.getBoundingClientRect();
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    var top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
    pop.style.visibility = "";
    document.addEventListener("mousedown", onAssignDocDown, true);
    window.addEventListener("scroll", onAssignDocDown, true);
    search.focus();
  }

  function assignTicket(id, email) {
    return post("/api/tickets/" + encodeURIComponent(id) + "/assignee", { email: email })
      .then(function (r) {
        if (!r.ok) {
          alert((r.data && r.data.error) || "指派失败");
          return;
        }
        var ticket = r.data.ticket;
        state.current = ticket;
        state.tickets = state.tickets.map(function (x) {
          return x.id === ticket.id
            ? Object.assign({}, x, {
                assigneeEmail: ticket.assigneeEmail,
                assigneeName: ticket.assigneeName,
                updatedAt: ticket.updatedAt,
              })
            : x;
        });
        renderDetail(ticket);
      })
      .catch(function () { alert("指派失败，请稍后重试"); });
  }

  function renderDetail(t) {
    state.current = t;
    showPanel("detail");
    byId("dTitle").textContent = t.title;
    var badge = byId("dStatus");
    badge.className = "tk-badge " + t.status;
    badge.textContent = STATUS_LABEL[t.status] || t.status;

    // 编辑按钮：只有提交人可见
    var editBtn = byId("editBtn");
    if (t.authorEmail === user.email) {
      editBtn.style.display = "";
      editBtn.onclick = openEdit;
    } else {
      editBtn.style.display = "none";
    }

    // 删除按钮：提交人本人或主管可见
    var delBtn = byId("delBtn");
    if (t.authorEmail === user.email || isSuper) {
      delBtn.style.display = "";
      delBtn.onclick = function () { removeTicket(t); };
    } else {
      delBtn.style.display = "none";
    }

    var meta = byId("dMeta");
    meta.innerHTML = "";
    // 提交人：头像 + 名字胶囊（悬停出用户卡片、点击跳主页）
    var authorSpan = document.createElement("span");
    var authorB = document.createElement("b");
    authorB.textContent = "提交人 ";
    authorSpan.appendChild(authorB);
    var authorChip = document.createElement("a");
    authorChip.className = "mention-chip";
    authorChip.href = profileUrl(t.authorEmail);
    authorChip.setAttribute("data-email", t.authorEmail);
    var authorAv = makeAvatar(memberByEmail(t.authorEmail), t.authorEmail, "mc-av");
    authorChip.appendChild(authorAv);
    var authorNm = document.createElement("span");
    authorNm.textContent = t.authorName + (t.mine ? "（我）" : "");
    authorChip.appendChild(authorNm);
    authorChip.addEventListener("click", function (e) {
      e.preventDefault();
      goProfile(t.authorEmail, t.authorName, t.department);
    });
    bindUserCard(authorChip, t.authorEmail);
    authorSpan.appendChild(authorChip);
    meta.appendChild(authorSpan);
    meta.appendChild(renderAssignee(t));
    meta.appendChild(metaItem("部门 ", t.department));
    meta.appendChild(metaItem("创建 ", formatTime(t.createdAt)));
    meta.appendChild(metaItem("更新 ", formatTime(t.updatedAt)));

    renderStatusBar(t);
    var contentEl = byId("dContent");
    contentEl.innerHTML = t.content; // 服务端已净化
    decorateRich(contentEl);
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
    state.editing = false;
    showPanel("editor");
    byId("editorError").hidden = true;
    byId("eTitle").value = "";
    document.querySelector("#editorView h2").textContent = "新建工单";
    document.querySelector("#editorView .tk-hint").textContent = EDITOR_HINT;
    if (!createEditor) createEditor = makeEditor(byId("editorHost"), { placeholder: EDITOR_PLACEHOLDER });
    else createEditor.clear();
    byId("eTitle").focus();
  }

  function openEdit() {
    if (!state.current) return;
    state.editing = true;
    showPanel("editor");
    byId("editorError").hidden = true;
    document.querySelector("#editorView h2").textContent = "编辑工单";
    document.querySelector("#editorView .tk-hint").textContent =
      "修改标题或正文后提交，更新时间将自动刷新。";
    byId("eTitle").value = state.current.title;
    if (!createEditor) createEditor = makeEditor(byId("editorHost"), { placeholder: EDITOR_PLACEHOLDER });
    // 用落库原文填充（服务端已净化的 HTML，@提及链接保留 data-email 以便再次编辑）
    createEditor.setHtml(state.current.content);
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
    var isEdit = state.editing && state.current;
    var url = isEdit ? "/api/tickets/" + encodeURIComponent(state.current.id) : "/api/tickets";
    var method = isEdit ? "PUT" : "POST";
    request(method, url, { title: title, content: html }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) {
        err.textContent = (r.data && r.data.error) || "提交失败";
        err.hidden = false;
        return;
      }
      err.hidden = true;
      createEditor.clear();
      var ticket = r.data.ticket;
      state.editing = false;
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

  /** 删除工单（提交人本人或主管；服务端二次校验权限） */
  function removeTicket(t) {
    if (!t) return;
    if (!window.confirm("确定删除工单「" + t.title + "」？删除后不可恢复。")) return;
    request("DELETE", "/api/tickets/" + encodeURIComponent(t.id))
      .then(function (r) {
        if (!r.ok) {
          alert((r.data && r.data.error) || "删除失败");
          return;
        }
        state.tickets = state.tickets.filter(function (x) { return x.id !== t.id; });
        state.current = null;
        showPanel("empty");
        renderList();
      })
      .catch(function () { alert("删除失败，请稍后重试"); });
  }

  /* ────────────── 纯文本评论输入（@提及成员） ────────────── */

  var cm = { active: false, start: -1, query: "", list: [], idx: 0 };

  function cmClose() {
    cm.active = false;
    cm.query = "";
    cm.list = [];
    var pop = byId("commentPop");
    if (pop) { pop.hidden = true; pop.innerHTML = ""; }
  }

  /** 评论输入框：监听 @ 触发成员候选（纯文本输入，选中后插入 @姓名） */
  function initCommentInput() {
    var input = byId("commentInput");
    var box = input.parentNode;
    var pop = document.createElement("div");
    pop.className = "mention-pop";
    pop.id = "commentPop";
    pop.hidden = true;
    box.appendChild(pop);

    /** 调用全局搜索接口搜员工（姓名 / 邮箱 / 部门 / 职位都能命中） */
    var searchTimer = null;
    function searchUsers(q, cb) {
      if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
      var ql = (q || "").trim();
      if (!ql) {
        cb(members.slice(0, 8));
        return;
      }
      searchTimer = setTimeout(function () {
        fetch("/api/search?type=user&q=" + encodeURIComponent(ql),
          { headers: { Accept: "application/json" } })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (d) {
            var results = (d && d.results) ? d.results : [];
            cb(results);
          })
          .catch(function () { cb([]); });
      }, 200);
    }

    function cmRender() {
      if (!cm.active) return;
      pop.innerHTML = "";
      if (!cm.list.length) {
        var empty = document.createElement("div");
        empty.className = "mention-item";
        empty.style.cursor = "default";
        empty.style.color = "var(--muted)";
        empty.textContent = "没有匹配的成员";
        pop.appendChild(empty);
      }
      cm.list.forEach(function (u, i) {
        var item = document.createElement("div");
        item.className = "mention-item" + (i === cm.idx ? " on" : "");
        item.appendChild(makeAvatar(u, u.email, "tk-avatar"));
        var meta = document.createElement("div");
        meta.className = "mi-meta";
        var nm = document.createElement("div");
        nm.className = "mi-name";
        nm.textContent = u.name || u.email;
        var dp = document.createElement("div");
        dp.className = "mi-dept";
        dp.textContent = u.department || "";
        meta.appendChild(nm);
        meta.appendChild(dp);
        item.appendChild(meta);
        item.addEventListener("mousedown", function (e) { e.preventDefault(); cmInsert(u); });
        pop.appendChild(item);
      });
      var r = input.getBoundingClientRect();
      var br = box.getBoundingClientRect();
      pop.style.left = Math.max(0, r.left - br.left) + "px";
      pop.style.top = (r.bottom - br.top + 4) + "px";
      pop.style.minWidth = "220px";
      pop.hidden = false;
    }

    function cmCheck() {
      var pos = input.selectionStart;
      var before = input.value.slice(0, pos);
      var m = before.match(/(^|[\s\u3000])@([^\s@]{0,20})$/);
      if (!m) { cmClose(); return; }
      cm.active = true;
      cm.start = pos - m[2].length - 1;
      cm.query = m[2];
      cm.idx = 0;
      // 先本地快速渲染一版，接口返回后再替换
      cm.list = (m[2] ? members.filter(function (u) {
        return ((u.name || "") + " " + u.email).toLowerCase().indexOf(m[2].toLowerCase()) !== -1;
      }) : members).slice(0, 8);
      cmRender();
      searchUsers(m[2], function (results) {
        if (!cm.active) return;
        cm.list = results.slice(0, 8);
        cm.idx = 0;
        cmRender();
      });
    }

    function cmInsert(u) {
      var nm = u.name || u.email.split("@")[0];
      // 把选中的人缓存起来，buildCommentHtml 用它把 @姓名 转成带 email 的链接
      if (nm && u.email) mentionUserCache[nm] = u;
      var pos = input.selectionStart;
      var v = input.value;
      input.value = v.slice(0, cm.start) + "@" + nm + " " + v.slice(pos);
      var np = cm.start + nm.length + 2;
      input.setSelectionRange(np, np);
      cmClose();
      input.focus();
    }

    input.addEventListener("input", cmCheck);
    input.addEventListener("click", cmCheck);
    input.addEventListener("keydown", function (e) {
      if (!cm.active) return;
      if (e.key === "Escape") {
        e.preventDefault();
        cmClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (cm.list.length) { cm.idx = (cm.idx + 1) % cm.list.length; cmRender(); }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (cm.list.length) { cm.idx = (cm.idx - 1 + cm.list.length) % cm.list.length; cmRender(); }
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (cm.list.length && cm.list[cm.idx]) {
          e.preventDefault();
          cmInsert(cm.list[cm.idx]);
        }
      }
    });
    document.addEventListener("mousedown", function (e) {
      if (!box.contains(e.target)) cmClose();
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
    post("/api/tickets/" + encodeURIComponent(state.current.id) + "/comments", { content: buildCommentHtml(text) })
      .then(function (r) {
        btn.disabled = false;
        if (!r.ok) {
          err.textContent = (r.data && r.data.error) || "评论失败";
          err.hidden = false;
          return;
        }
        err.hidden = true;
        input.value = "";
        cmClose();
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

  function onCancelEdit() {
    if (state.editing && state.current) {
      // 编辑取消 → 返回详情
      showPanel("detail");
      state.editing = false;
    } else {
      // 新建取消 → 回到空态
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
    initUserCard();
    initFilters();
    initCommentInput();
    byId("newBtn").addEventListener("click", openCreate);
    byId("cancelBtn").addEventListener("click", onCancelEdit);
    byId("cancelBtn2").addEventListener("click", onCancelEdit);
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