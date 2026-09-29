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

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
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

  /* ────────────── 成员与用户卡片 ────────────── */

  var members = boot.members || [];

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

  var cardTimer = null;

  function showUserCard(email, anchor) {
    var card = byId("userCard");
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

  function hideUserCard(now) {
    var card = byId("userCard");
    if (!card) return;
    if (now) {
      if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; }
      card.hidden = true;
      return;
    }
    cardTimer = setTimeout(function () { card.hidden = true; }, 140);
  }

  /** 给元素绑定「悬停弹用户卡片」行为 */
  function bindUserCard(el, email) {
    if (!email) return;
    el.addEventListener("mouseenter", function () { showUserCard(email, el); });
    el.addEventListener("mouseleave", function () { hideUserCard(false); });
  }

  /** 在容器内挂一次的事件代理：鼠标移出卡片本身也隐藏 */
  function initUserCard() {
    var card = byId("userCard");
    if (!card) return;
    card.addEventListener("mouseenter", function () {
      if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; }
    });
    card.addEventListener("mouseleave", function () { hideUserCard(false); });
    document.addEventListener("mousedown", function () { hideUserCard(true); });
    window.addEventListener("scroll", function () { if (!byId("userCard").hidden) hideUserCard(true); }, true);
  }

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

    // @ 提及弹出层
    var mentionPop = document.createElement("div");
    mentionPop.className = "mention-pop";
    mentionPop.style.display = "none";
    node.appendChild(mentionPop);
    var mentionIdx = 0;
    var mentionList = [];
    var mentionActive = false;
    var mentionQuery = "";
    var mentionRange = null; // 保存 @ 起始位置，用于替换

    function closeMention() {
      mentionActive = false;
      mentionPop.style.display = "none";
      mentionQuery = "";
      mentionList = [];
    }

    function searchMention(q) {
      get("/api/search?type=user&q=" + encodeURIComponent(q)).then(function (r) {
        if (!r.ok || !mentionActive) return;
        mentionList = (r.data && r.data.results) || [];
        mentionIdx = 0;
        renderMentionList();
      });
    }

    function renderMentionList() {
      if (!mentionList.length) {
        mentionPop.innerHTML = '<div class="mention-item" style="cursor:default;color:var(--muted);">没有匹配的成员</div>';
        mentionPop.style.display = "block";
        return;
      }
      mentionPop.innerHTML = "";
      mentionList.forEach(function (u, i) {
        var item = document.createElement("div");
        item.className = "mention-item" + (i === mentionIdx ? " on" : "");
        var av = document.createElement("div");
        av.className = "tk-avatar";
        av.style.background = colorOf(u.email);
        av.textContent = firstChar(u.name, u.email);
        item.appendChild(av);
        var meta = document.createElement("div");
        meta.className = "mi-meta";
        var name = document.createElement("div");
        name.className = "mi-name";
        name.textContent = u.name;
        meta.appendChild(name);
        var dept = document.createElement("div");
        dept.className = "mi-dept";
        dept.textContent = u.department || "";
        meta.appendChild(dept);
        item.appendChild(meta);
        item.addEventListener("mousedown", function (e) {
          e.preventDefault();
          insertMention(u);
        });
        mentionPop.appendChild(item);
      });
      mentionPop.style.display = "block";
    }

    function insertMention(u) {
      if (!mentionRange) return;
      body.focus();
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(mentionRange);
      // 删除 @ 到当前位置的文字
      var range = sel.getRangeAt(0);
      range.deleteContents();
      // 插入 mention 链接
      var a = document.createElement("a");
      a.href = profileUrl(u.email);
      a.className = "mention-link";
      a.setAttribute("data-email", u.email);
      a.textContent = "@" + u.name;
      a.contentEditable = "false";
      range.insertNode(a);
      // 光标移到链接后面
      range.setStartAfter(a);
      range.setEndAfter(a);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      // 加个空格
      document.execCommand("insertText", false, " ");
      closeMention();
    }

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
        if (action === "mention") {
          body.focus();
          document.execCommand("insertText", false, "@");
          // 手动触发 @ 提及检测
          triggerMentionCheck();
          return;
        }
        body.focus();
        if (cmd) document.execCommand(cmd, false, null);
        if (block) document.execCommand("formatBlock", false, block);
      });
    });

    node.querySelector(".rt-size").addEventListener("mousedown", function (e) { e.preventDefault(); });
    node.querySelector(".rt-size").addEventListener("change", function () {
      var px = this.value;
      body.focus();
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      var range = sel.getRangeAt(0);
      // 确保选区在编辑器内
      if (!body.contains(range.commonAncestorContainer)) return;
      if (range.collapsed) return;
      var span = document.createElement("span");
      span.style.fontSize = px;
      try {
        range.surroundContents(span);
      } catch (e) {
        // 选区跨节点时 surroundContents 会失败，回退到 extractContents
        var frag = range.extractContents();
        span.appendChild(frag);
        range.insertNode(span);
      }
      // 恢复选区到新 span 内
      sel.removeAllRanges();
      var newRange = document.createRange();
      newRange.selectNodeContents(span);
      sel.addRange(newRange);
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

    // @ 提及：监听输入
    function triggerMentionCheck() {
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return closeMention();
      var range = sel.getRangeAt(0);
      if (!body.contains(range.startContainer)) return closeMention();

      // 从光标位置向前找最近的 @
      var textNode = range.startContainer;
      var offset = range.startOffset;
      var text = "";
      if (textNode.nodeType === 3) {
        text = textNode.textContent.substring(0, offset);
      }
      var atPos = text.lastIndexOf("@");
      if (atPos === -1) return closeMention();

      // @ 前面必须是行首或空格
      var prevChar = atPos > 0 ? text.charAt(atPos - 1) : "";
      if (prevChar && prevChar !== " " && prevChar !== "\n") return closeMention();

      var query = text.substring(atPos + 1);
      // 查询词里不能有空格（空格表示结束）
      if (query.indexOf(" ") !== -1) return closeMention();
      if (query.length > 20) return closeMention();

      mentionActive = true;
      mentionQuery = query;

      // 保存 @ 位置的 range，用于替换
      mentionRange = document.createRange();
      mentionRange.setStart(textNode, atPos);
      mentionRange.setEnd(textNode, offset);

      // 定位弹出层
      var rect = range.getBoundingClientRect();
      var bodyRect = node.getBoundingClientRect();
      mentionPop.style.left = (rect.left - bodyRect.left) + "px";
      mentionPop.style.top = (rect.bottom - bodyRect.top + 4) + "px";

      searchMention(query);
    }

    body.addEventListener("input", function () {
      triggerMentionCheck();
    });

    body.addEventListener("keydown", function (e) {
      if (!mentionActive) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeMention();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (mentionList.length) {
          mentionIdx = (mentionIdx + 1) % mentionList.length;
          renderMentionList();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (mentionList.length) {
          mentionIdx = (mentionIdx - 1 + mentionList.length) % mentionList.length;
          renderMentionList();
        }
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (mentionList.length && mentionList[mentionIdx]) {
          e.preventDefault();
          insertMention(mentionList[mentionIdx]);
        }
      }
    });

    // 点击编辑器外关闭提及
    document.addEventListener("mousedown", function (e) {
      if (!node.contains(e.target)) closeMention();
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
   * 升级富文本里的 @提及：把服务端存下的 a[data-email]（或旧数据的 a.mention-link）
   * 渲染成「头像 + 名字」胶囊，并挂上悬停用户卡片与个人主页跳转
   */
  function decorateRich(root) {
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
        bindUserCard(a, email);
        a.addEventListener("click", function (e) {
          e.preventDefault();
          goProfile(email, (m && m.name) || name, m && m.department);
        });
      }
    });
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

      var av = document.createElement("div");
      av.className = "tk-avatar";
      av.style.background = colorOf(c.email);
      av.textContent = firstChar(c.author, c.email);
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

    var meta = byId("dMeta");
    meta.innerHTML = "";
    // 提交人：可点击跳转到个人主页，悬停出用户卡片
    var authorSpan = document.createElement("span");
    var authorB = document.createElement("b");
    authorB.textContent = "提交人 ";
    authorSpan.appendChild(authorB);
    var authorLink = document.createElement("a");
    authorLink.href = profileUrl(t.authorEmail);
    authorLink.className = "author-link";
    authorLink.textContent = t.authorName + (t.mine ? "（我）" : "");
    authorLink.addEventListener("click", function (e) {
      e.preventDefault();
      goProfile(t.authorEmail, t.authorName, t.department);
    });
    bindUserCard(authorLink, t.authorEmail);
    authorSpan.appendChild(authorLink);
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
    document.querySelector("#editorView .tk-hint").textContent =
      "支持加粗 / 斜体 / 下划线 / 删除线 / 字号 / 列表 / 引用 / 插入图片 / @提及成员；图片上限 6MB。";
    if (!createEditor) createEditor = makeEditor(byId("editorHost"));
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
    if (!createEditor) createEditor = makeEditor(byId("editorHost"));
    // 用落库原文填充（服务端已净化的 HTML，@提及链接保留 data-email 以便再次编辑）
    byId("editorHost").querySelector(".rt-body").innerHTML = state.current.content;
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

    function filterMembers(q) {
      var ql = (q || "").trim().toLowerCase();
      var hit = !ql ? members : members.filter(function (u) {
        return ((u.name || "") + " " + u.email).toLowerCase().indexOf(ql) !== -1;
      });
      return hit.slice(0, 8);
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
      cm.list = filterMembers(m[2]);
      cm.idx = 0;
      cmRender();
    }

    function cmInsert(u) {
      var nm = u.name || u.email.split("@")[0];
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