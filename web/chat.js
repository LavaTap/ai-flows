/* chat.js · AI 对话页脚本 */
(function () {
  var boot = window.__CHAT__ || {};
  var user = boot.user || {};
  var isSuper = !!boot.isSupervisor;
  var models = boot.models || [];
  var activeModelId = boot.activeModelId || "";

  var state = {
    sessions: [],
    currentId: null,
    currentMessages: [],
    abortCtrl: null,
    streaming: false,
    pendingAttachments: [],
    pendingRefs: [],
    pendingSkill: null,
  };

  /* ────────────── 工具 ────────────── */

  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function colorOf(email) {
    var h = 0;
    for (var i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + ", 55%, 55%)";
  }
  function firstChar(u) { return (u.name && u.name.charAt(0)) || (u.email && u.email.charAt(0).toUpperCase()) || "?"; }
  function displayName(u) { return u.name || u.email; }
  function avatarUrl(u) { return u.avatar ? "/api/avatars/" + u.avatar : ""; }

  function api(url, init) {
    init = init || {};
    init.headers = init.headers || {};
    if (init.body && typeof init.body === "object" && !(init.body instanceof FormData)) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(init.body);
    }
    return fetch(url, init).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
    });
  }

  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString("zh-CN", { hour12: false }); } catch { return iso; }
  }
  function fileUrl(name) { return "/api/chat/files/" + encodeURIComponent(name); }

  /* ────────────── skill 调用提示 / 产出文件卡片 ────────────── */

  var FILE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
  var DL_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';

  /** 字节数 → 人类可读体积 */
  function humanSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  /** skill 调用灰字行文案（成功 / 失败统一一行灰色小字） */
  function skillLineText(c) {
    if (c.status === "error") {
      return "调用 Skill 失败：" + (c.skill || "未知 skill") + (c.error ? "（" + c.error + "）" : "");
    }
    return "调用了 Skill：" + c.skill;
  }

  /** 产出文件卡片列表：点整张卡或右侧下载图标都直接下载 */
  function fileCards(files) {
    var box = document.createElement("div");
    box.className = "file-cards";
    (files || []).forEach(function (f) {
      var a = document.createElement("a");
      a.className = "file-card";
      a.href = fileUrl(f.file);
      a.setAttribute("download", f.name || f.file);
      a.title = "下载 " + (f.name || f.file);
      a.innerHTML = '<span class="fc-ico">' + FILE_ICON + '</span>' +
        '<span class="fc-name">' + esc(f.name || f.file) + '</span>' +
        '<span class="fc-size">' + humanSize(f.size) + '</span>' +
        '<span class="fc-dl">' + DL_ICON + '</span>';
      box.appendChild(a);
    });
    return box;
  }

  /* ────────────── Markdown 渲染（marked + highlight.js + mermaid） ────────────── */

  var mdReady = false;
  function initMarkdown() {
    if (mdReady) return;
    if (window.marked) {
      marked.setOptions({ gfm: true, breaks: true });
    }
    if (window.mermaid) {
      // loose 级别最大化兼容 AI 生成的图表语法；SVG 最终由浏览器内核渲染
      mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "loose" });
    }
    mdReady = true;
  }

  /**
   * DOMPurify 净化配置。
   * 必须放行 <style> 与 style 属性：模型常手写内联 SVG 并用 <style> 定义节点配色，
   * 一旦被剥掉，SVG 会回落到默认的黑色填充（黑底黑字）。脚本 / 事件处理器仍被拦截。
   * 放行的样式之所以安全：渲染时会连同 SVG 一起隔离进 shadow root（见 isolateSvg），
   * 样式只在图表内部生效，不会外泄污染页面。
   */
  var PURIFY_OPTS = {
    ADD_TAGS: ["style"],
    ADD_ATTR: ["style", "target", "rel"],
    FORBID_TAGS: ["script"],
  };

  /**
   * 把 SVG 元素放进 shadow root 渲染：既让 SVG 自带的 <style> 生效（配色正常），
   * 又把样式与页面彻底隔离，避免污染页面或受页面 CSS 影响。
   * @param {SVGElement} svgEl
   * @returns {HTMLElement}
   */
  function isolateSvg(svgEl) {
    var host = document.createElement("div");
    host.className = "svg-figure";
    var root = null;
    try { root = host.attachShadow({ mode: "open" }); } catch (e) { root = null; }
    if (!root) { host.appendChild(svgEl); return host; }
    var style = document.createElement("style");
    style.textContent = ":host{display:block}svg{display:block;max-width:100%;height:auto;margin:0 auto}";
    root.appendChild(style);
    root.appendChild(svgEl);
    return host;
  }

  /**
   * 把 SVG 源码字符串解析并净化成 SVG 元素；解析失败返回 null（由调用方回退展示源码）。
   * @param {string} source
   * @returns {SVGElement|null}
   */
  function sourceToSvgElement(source) {
    if (!source || !/<svg[\s>]/i.test(source)) return null;
    var raw = source;
    if (window.DOMPurify) {
      raw = DOMPurify.sanitize(source, PURIFY_OPTS);
    }
    var tmp = document.createElement("div");
    tmp.innerHTML = raw;
    var svg = tmp.querySelector("svg");
    return (svg && svg.nodeName.toLowerCase() === "svg") ? svg : null;
  }

  /**
   * 处理容器内两种形态的 SVG，统一渲染为真实图形并做样式隔离：
   *  1) ```svg / ```xml 围栏代码块 —— 解析源码为 SVG 元素替换代码块；
   *  2) 模型直接内联的裸 <svg> —— marked 已透传为 DOM 元素，就地隔离。
   * 解析失败的代码块保留源码展示，不影响其余内容。
   * @param {HTMLElement} container
   */
  function renderInlineSvg(container) {
    if (!container) return;

    var blocks = container.querySelectorAll("pre > code.language-svg, pre > code.language-xml");
    Array.prototype.forEach.call(blocks, function (code) {
      var svg = sourceToSvgElement(code.textContent);
      if (!svg) return;
      code.parentElement.replaceWith(isolateSvg(svg));
    });

    // 裸 <svg>：先用注释占位记住位置，再把它移进 shadow root，最后把 host 放回原位
    var raws = container.querySelectorAll("svg");
    Array.prototype.forEach.call(raws, function (svg) {
      var placeholder = document.createComment("svg");
      svg.replaceWith(placeholder);
      placeholder.replaceWith(isolateSvg(svg));
    });
  }

  /**
   * 把 markdown 文本渲染成 DOM 容器（已用 DOMPurify 净化 + highlight.js 高亮）。
   * 若 marked 未加载（离线/CDN 失败）则回退为转义后的纯文本。
   * @param {string} text
   * @returns {HTMLElement}
   */
  function renderMarkdown(text) {
    var container = document.createElement("div");
    container.className = "md-body";
    if (text == null) return container;
    if (!window.marked) {
      var pre = document.createElement("pre");
      pre.style.whiteSpace = "pre-wrap";
      pre.style.margin = "0";
      pre.textContent = String(text);
      container.appendChild(pre);
      return container;
    }
    var html = marked.parse(String(text));
    if (window.DOMPurify) {
      html = DOMPurify.sanitize(html, PURIFY_OPTS);
    }
    container.innerHTML = html;
    if (window.hljs) {
      var codes = container.querySelectorAll("pre code");
      codes.forEach(function (block) {
        // mermaid / svg / xml 随后会被转成真实图形，不做源码高亮
        if (block.classList.contains("language-mermaid")) return;
        if (block.classList.contains("language-svg")) return;
        if (block.classList.contains("language-xml")) return;
        try { hljs.highlightElement(block); } catch (e) { /* 忽略高亮失败 */ }
      });
    }
    return container;
  }

  /**
   * 清洗 AI 生成的 Mermaid 代码，修复常见语法问题，提升解析成功率。
   * 策略：只做"安全的标准化"，不叠加复杂正则；解析失败交给降级逻辑展示源码。
   * @param {string} code
   * @returns {string}
   */
  function cleanMermaidCode(code) {
    if (!code) return "";
    // 统一换行
    var text = code.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var lines = text.split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // 去行尾空白
      line = line.replace(/[ \t]+$/g, "");
      // 把 Tab 缩进统一为 2 空格（mermaid 对缩进不敏感，但标准化更稳）
      line = line.replace(/^\t+/g, function (m) { return new Array(m.length * 2 + 1).join(" "); });
      out.push(line);
    }
    text = out.join("\n");
    // 去首尾空行
    text = text.replace(/^\n+|\n+$/g, "");
    return text;
  }

  /**
   * mermaid 渲染失败时，把节点替换为带源码的错误提示框（保留可读性）。
   * @param {HTMLElement} node
   * @param {string} text
   */
  function showMermaidError(node, text) {
    var box = document.createElement("div");
    box.className = "mermaid-error";
    box.innerHTML = '<div class="mermaid-error-title">图表解析失败，已保留源码</div>' +
      '<pre class="mermaid-error-src"></pre>';
    box.querySelector(".mermaid-error-src").textContent = text;
    node.replaceWith(box);
  }

  /**
   * 把容器内 language-mermaid 代码块替换为 .mermaid 容器并渲染为 SVG。
   * 关键点：mermaid.run() 是异步 Promise，必须用 .then/.catch 处理；
   * 每个节点独立渲染，单个失败不影响其他；失败降级为源码展示。
   * 调用前需确保 container 已插入文档 DOM（mermaid 依赖布局尺寸）。
   * @param {HTMLElement} container
   */
  function renderMermaid(container) {
    if (!window.mermaid || !container) return;
    var blocks = container.querySelectorAll("pre code.language-mermaid");
    if (!blocks.length) return;
    blocks.forEach(function (code) {
      var pre = code.parentElement;
      var div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = cleanMermaidCode(code.textContent);
      pre.replaceWith(div);
    });
    var nodes = container.querySelectorAll(".mermaid");
    if (!nodes.length) return;

    // 逐个节点异步渲染，互不影响
    Array.prototype.forEach.call(nodes, function (node) {
      var text = node.textContent;
      // 先给个加载态占位
      node.innerHTML = '<div class="mermaid-loading">正在渲染图表…</div>';
      Promise.resolve()
        .then(function () {
          // 恢复 mermaid 源码供解析（mermaid.run 读取节点 textContent）
          node.textContent = text;
          return mermaid.run({ nodes: [node] });
        })
        .then(function () {
          // 渲染后检查是否真的产出了 svg
          if (!node.querySelector("svg")) {
            showMermaidError(node, text);
          }
        })
        .catch(function () {
          showMermaidError(node, text);
        });
    });
  }

  /* ────────────── 顶栏 ────────────── */

  function initTopbar() {
    if (isSuper) {
      var teamLink = document.getElementById("teamLink");
      if (teamLink) teamLink.style.display = "inline-block";
    }
    var chip = document.querySelector(".user-chip");
    if (chip) {
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
  }

  /* ────────────── 模型下拉 ────────────── */

  function renderModelSelect() {
    var sel = document.getElementById("modelSelect");
    if (!sel) return;
    sel.innerHTML = "";
    models.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name + " · " + m.model;
      if (m.id === activeModelId) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", function () {
      var id = sel.value;
      if (!id) return;
      api("/api/chat/models/" + id + "/activate", { method: "POST" }).then(function (r) {
        if (r.ok) {
          activeModelId = id;
          var cur = models.find(function (x) { return x.id === id; });
          if (cur) cur.isActive = true;
          models.forEach(function (x) { if (x.id !== id) x.isActive = false; });
        } else {
          alert("切换模型失败：" + (r.data && r.data.error || "未知错误"));
        }
      });
    });
  }

  /* ────────────── 会话列表 ────────────── */

  function loadSessions() {
    api("/api/chat/sessions", { method: "GET" }).then(function (r) {
      if (!r.ok) return;
      state.sessions = r.data.sessions || [];
      renderSessionList();
      // 若无选中，选第一个
      if (!state.currentId && state.sessions.length) {
        selectSession(state.sessions[0].id);
      } else if (state.currentId) {
        // 保留选中，刷新标题
        renderSessionList();
      }
    });
  }

  function renderSessionList() {
    var list = document.getElementById("sessionList");
    if (!list) return;
    list.innerHTML = "";
    if (!state.sessions.length) {
      list.innerHTML = '<div style="padding:16px;color:var(--muted-2);font-size:12px;text-align:center;">暂无会话</div>';
      return;
    }
    state.sessions.forEach(function (s) {
      var item = document.createElement("div");
      item.className = "session-item" + (s.id === state.currentId ? " active" : "");
      item.innerHTML = '<span class="si-title">' + esc(s.title) + '</span>' +
        '<button type="button" class="si-rename" title="重命名">✎</button>' +
        '<button type="button" class="si-del" title="删除">×</button>';
      item.addEventListener("click", function (e) {
        if (e.target.classList.contains("si-del")) return;
        if (e.target.classList.contains("si-rename")) return;
        if (e.target.classList.contains("si-input")) return;
        selectSession(s.id);
      });
      // 双击标题或点 ✎ 都进入就地编辑
      item.querySelector(".si-title").addEventListener("dblclick", function (e) {
        e.stopPropagation();
        beginRename(item, s);
      });
      item.querySelector(".si-rename").addEventListener("click", function (e) {
        e.stopPropagation();
        beginRename(item, s);
      });
      var del = item.querySelector(".si-del");
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!confirm("删除会话「" + s.title + "」？")) return;
        api("/api/chat/sessions/" + s.id, { method: "DELETE" }).then(function (r) {
          if (r.ok) {
            if (state.currentId === s.id) {
              state.currentId = null;
              state.currentMessages = [];
              renderMessages();
            }
            state.pendingRefs = state.pendingRefs.filter(function (x) { return x.id !== s.id; });
            renderChips();
            loadSessions();
          }
        });
      });
      list.appendChild(item);
    });
  }

  /** 会话标题就地编辑：Enter 保存 / Esc 取消 / 失焦保存 */
  function beginRename(item, s) {
    if (item.querySelector(".si-input")) return;
    var titleEl = item.querySelector(".si-title");
    if (!titleEl) return;
    var input = document.createElement("input");
    input.className = "si-input";
    input.type = "text";
    input.maxLength = 60;
    input.value = s.title;
    item.replaceChild(input, titleEl);
    input.focus();
    input.select();

    var settled = false;
    function cancel() {
      if (settled) return;
      settled = true;
      renderSessionList();
    }
    function save() {
      if (settled) return;
      var next = input.value.trim();
      if (!next || next === s.title) return cancel();
      settled = true;
      api("/api/chat/sessions/" + s.id, { method: "PATCH", body: { title: next } }).then(function (r) {
        if (!r.ok) alert("重命名失败：" + ((r.data && r.data.error) || "未知错误"));
        loadSessions();
      });
    }
    input.addEventListener("click", function (e) { e.stopPropagation(); });
    input.addEventListener("dblclick", function (e) { e.stopPropagation(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
    input.addEventListener("blur", save);
  }

  function selectSession(id) {
    state.currentId = id;
    renderSessionList();
    api("/api/chat/sessions/" + id, { method: "GET" }).then(function (r) {
      if (!r.ok) return;
      state.currentMessages = (r.data.session && r.data.session.messages) || [];
      renderMessages();
    });
  }

  document.getElementById("newChatBtn").addEventListener("click", function () {
    api("/api/chat/sessions", { method: "POST" }).then(function (r) {
      if (r.ok && r.data.session) {
        state.currentId = r.data.session.id;
        state.currentMessages = [];
        renderMessages();
        loadSessions();
      }
    });
  });

  /* ────────────── 消息渲染 ────────────── */

  function renderMessages() {
    var box = document.getElementById("messages");
    if (!box) return;
    if (!state.currentId) {
      box.innerHTML = '<div class="empty-hint">选择或新建一个会话开始对话</div>';
      return;
    }
    if (!state.currentMessages.length) {
      box.innerHTML = '<div class="empty-hint">开始和 AI 对话吧</div>';
      return;
    }
    box.innerHTML = "";
    state.currentMessages.forEach(function (m) {
      // AI 调用过 skill 时，在消息流中间插一行灰色小字（落库数据，刷新后仍在）
      if (m.role === "assistant" && m.skillCalls && m.skillCalls.length) {
        m.skillCalls.forEach(function (c) {
          var line = document.createElement("div");
          line.className = "skill-line";
          line.textContent = skillLineText(c);
          box.appendChild(line);
        });
      }
      box.appendChild(renderMsg(m));
    });
    // 所有消息已进 DOM，再统一把 SVG / mermaid 转成真实图形
    var mdBodies = box.querySelectorAll(".msg.assistant .md-body");
    Array.prototype.forEach.call(mdBodies, function (md) {
      renderInlineSvg(md);   // 手写 SVG（裸 <svg> 或 ```svg 围栏）
      renderMermaid(md);     // mermaid 代码块
    });
    box.scrollTop = box.scrollHeight;
  }

  /** 附件 / 引用 chip 行（消息内只读展示） */
  function attachmentsRow(m) {
    var has = (m.attachments && m.attachments.length) || (m.refs && m.refs.length);
    if (!has) return null;
    var row = document.createElement("div");
    row.className = "chip-row";
    (m.attachments || []).forEach(function (a) {
      var el = document.createElement("div");
      el.className = "chip";
      el.innerHTML = (a.kind === "image" ? '<img src="' + esc(fileUrl(a.file)) + '" alt="">' : "") +
        '<span class="chip-name">' + esc(a.name) + '</span>' +
        '<span class="chip-tag">' + (a.kind === "image" ? "图片" : "文件") + '</span>';
      row.appendChild(el);
    });
    (m.refs || []).forEach(function (rf) {
      var el = document.createElement("div");
      el.className = "chip";
      el.innerHTML = '<span class="chip-tag">引用</span><span class="chip-name">' + esc(rf.title || rf.id) + '</span>';
      row.appendChild(el);
    });
    return row;
  }

  function renderMsg(m) {
    var wrap = document.createElement("div");
    wrap.className = "msg " + (m.role === "user" ? "user" : "assistant");
    var inner = document.createElement("div");
    inner.style.minWidth = "0";
    inner.style.maxWidth = "100%";
    var tag = document.createElement("div");
    tag.className = "role-tag";
    tag.textContent = m.role === "user" ? (displayName(user)) : "AI";
    inner.appendChild(tag);
    var atts = attachmentsRow(m);
    if (atts) inner.appendChild(atts);
    if (m.content) {
      var bubble = document.createElement("div");
      bubble.className = "bubble";
      if (m.role === "assistant") {
        bubble.appendChild(renderMarkdown(m.content));
        // mermaid 渲染延后到 renderMessages（需 DOM 就位）
      } else {
        bubble.textContent = m.content;
      }
      inner.appendChild(bubble);
    }
    // AI 产出文件：可点击的文件卡片，点一下直接下载
    if (m.role === "assistant" && m.skillCalls) {
      var outFiles = [];
      m.skillCalls.forEach(function (c) {
        (c.files || []).forEach(function (f) { outFiles.push(f); });
      });
      if (outFiles.length) inner.appendChild(fileCards(outFiles));
    }
    if (m.tokens) {
      var ti = document.createElement("div");
      ti.className = "token-info";
      ti.textContent = m.tokens + " tokens";
      inner.appendChild(ti);
    }
    wrap.appendChild(inner);
    return wrap;
  }

  function appendStreamingMsg(role) {
    var box = document.getElementById("messages");
    var wrap = document.createElement("div");
    wrap.className = "msg " + (role === "user" ? "user" : "assistant") + (role === "assistant" ? " msg-thinking" : "");
    var inner = document.createElement("div");
    inner.style.minWidth = "0";
    inner.style.maxWidth = "100%";
    var tag = document.createElement("div");
    tag.className = "role-tag";
    tag.textContent = role === "user" ? displayName(user) : "AI";
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = role === "assistant" ? "思考中…" : "";
    inner.appendChild(tag);
    inner.appendChild(bubble);
    wrap.appendChild(inner);
    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
    return wrap;
  }

  /* ────────────── 加号菜单：添加文件 / 调用 Skill / 引用对话 ────────────── */

  var addBtn = document.getElementById("addBtn");
  var addMenu = document.getElementById("addMenu");
  var fileInput = document.getElementById("fileInput");

  function closeAddMenu() {
    if (addMenu) { addMenu.hidden = true; addBtn.setAttribute("aria-expanded", "false"); }
  }
  function openAddMenu() {
    if (addMenu) { addMenu.hidden = false; addBtn.setAttribute("aria-expanded", "true"); }
  }
  function toggleAddMenu() {
    if (!addMenu) return;
    if (addMenu.hidden) openAddMenu(); else closeAddMenu();
  }
  if (addBtn) {
    addBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleAddMenu();
    });
    document.addEventListener("click", function (e) {
      if (addMenu.hidden) return;
      if (addMenu.contains(e.target) || addBtn.contains(e.target)) return;
      closeAddMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !addMenu.hidden) closeAddMenu();
    });
  }
  if (addMenu) {
    addMenu.addEventListener("click", function (e) {
      var btn = e.target.closest(".add-item");
      if (!btn) return;
      closeAddMenu();
      var act = btn.getAttribute("data-act");
      if (act === "file") fileInput.click();
      else if (act === "skill") openSkillPicker();
      else if (act === "ref") openRefPicker();
    });
  }

  function readFileBase64(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || "");
        var i = s.indexOf(",");
        resolve(i >= 0 ? s.slice(i + 1) : "");
      };
      fr.onerror = function () { reject(new Error("读取文件失败")); };
      fr.readAsDataURL(file);
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(fileInput.files || []);
      fileInput.value = "";
      var chain = Promise.resolve();
      files.forEach(function (f) {
        chain = chain
          .then(function () { return readFileBase64(f); })
          .then(function (b64) {
            return api("/api/chat/upload", { method: "POST", body: { filename: f.name, contentBase64: b64 } });
          })
          .then(function (r) {
            if (!r.ok || !r.data.attachment) {
              alert("上传失败：" + ((r.data && r.data.error) || f.name));
              return;
            }
            state.pendingAttachments.push(r.data.attachment);
            renderChips();
          });
      });
    });
  }

  function renderChips() {
    var row = document.getElementById("chipRow");
    if (!row) return;
    row.innerHTML = "";
    state.pendingAttachments.forEach(function (a, i) {
      var el = document.createElement("div");
      el.className = "chip";
      el.innerHTML = (a.kind === "image" ? '<img src="' + esc(fileUrl(a.file)) + '" alt="">' : "") +
        '<span class="chip-name">' + esc(a.name) + '</span>' +
        '<span class="chip-tag">' + (a.kind === "image" ? "图片" : "文件") + '</span>' +
        '<button type="button" class="chip-x" title="移除">×</button>';
      el.querySelector(".chip-x").addEventListener("click", function () {
        state.pendingAttachments.splice(i, 1);
        renderChips();
      });
      row.appendChild(el);
    });
    state.pendingRefs.forEach(function (rf, i) {
      var el = document.createElement("div");
      el.className = "chip";
      el.innerHTML = '<span class="chip-tag">引用</span><span class="chip-name">' + esc(rf.title || rf.id) + '</span>' +
        '<button type="button" class="chip-x" title="移除">×</button>';
      el.querySelector(".chip-x").addEventListener("click", function () {
        state.pendingRefs.splice(i, 1);
        renderChips();
      });
      row.appendChild(el);
    });
    if (state.pendingSkill) {
      var el2 = document.createElement("div");
      el2.className = "chip";
      el2.innerHTML = '<span class="chip-tag">Skill</span><span class="chip-name">' + esc(state.pendingSkill.name) + '</span>' +
        '<button type="button" class="chip-x" title="移除">×</button>';
      el2.querySelector(".chip-x").addEventListener("click", function () {
        state.pendingSkill = null;
        renderChips();
      });
      row.appendChild(el2);
    }
  }

  /* ────────────── 选择器弹窗（Skill / 引用对话共用） ────────────── */

  var picker = document.getElementById("picker");
  var pickerTitle = document.getElementById("pickerTitle");
  var pickerBody = document.getElementById("pickerBody");

  function closePicker() { if (picker) picker.hidden = true; }
  function openPicker(title, items) {
    if (!picker) return;
    pickerTitle.textContent = title;
    pickerBody.innerHTML = "";
    if (!items.length) {
      pickerBody.innerHTML = '<div class="picker-empty">暂无可选项</div>';
    }
    items.forEach(function (it) {
      var el = document.createElement("div");
      el.className = "pick-item";
      el.innerHTML = '<div class="pi-main"><div class="pi-name">' + esc(it.name) + '</div>' +
        (it.desc ? '<div class="pi-desc">' + esc(it.desc) + '</div>' : '') +
        (it.meta ? '<div class="pi-meta">' + esc(it.meta) + '</div>' : '') + '</div>';
      el.addEventListener("click", function () {
        closePicker();
        it.onPick();
      });
      pickerBody.appendChild(el);
    });
    picker.hidden = false;
  }

  function openSkillPicker() {
    api("/api/chat/skills", { method: "GET" }).then(function (r) {
      var skills = (r.ok && r.data.skills) || [];
      openPicker(
        "调用 Skill",
        skills.map(function (s) {
          return {
            name: s.name,
            desc: s.description,
            meta: s.dir + (s.executable ? " · 含脚本可执行" : " · 纯文档"),
            onPick: function () { state.pendingSkill = s; renderChips(); },
          };
        })
      );
    });
  }

  function openRefPicker() {
    var items = state.sessions
      .filter(function (s) { return s.id !== state.currentId; })
      .map(function (s) {
        return {
          name: s.title || "未命名会话",
          desc: s.messageCount + " 条消息",
          meta: fmtTime(s.updatedAt),
          onPick: function () {
            var exists = state.pendingRefs.some(function (x) { return x.id === s.id; });
            if (!exists) state.pendingRefs.push({ id: s.id, title: s.title || "未命名会话" });
            renderChips();
          },
        };
      });
    openPicker("引用对话（读取其内容作为上下文）", items);
  }

  if (picker) {
    document.getElementById("pickerClose").addEventListener("click", closePicker);
    picker.addEventListener("click", function (e) { if (e.target === picker) closePicker(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePicker(); });
  }

  /* ────────────── 发送消息（SSE） ────────────── */

  var sendBtn = document.getElementById("sendBtn");
  var stopBtn = document.getElementById("stopBtn");
  var input = document.getElementById("msgInput");

  function setStreaming(on) {
    state.streaming = on;
    sendBtn.style.display = on ? "none" : "";
    stopBtn.style.display = on ? "" : "none";
    input.disabled = on;
  }

  /** 流式期间展示 skill 调用：消息流中间一行状态（转圈动画 + 动态文案：调用/启动脚本/运行中/打包），
   *  结束后转为静态灰字「调用了 Skill：xxx」，产出文件以卡片落在气泡内 */
  function onSkillEvent(wrap, p) {
    var inner = wrap.firstChild;
    var box = document.getElementById("messages");
    var line = wrap.previousElementSibling;
    var lineOk = line && line.classList && line.classList.contains("skill-line") &&
      line.getAttribute("data-skill") === String(p.skill);

    function setLine(text, running) {
      if (!lineOk) {
        line = document.createElement("div");
        line.className = "skill-line";
        line.setAttribute("data-skill", String(p.skill));
        line.innerHTML = '<span class="sl-spin" aria-hidden="true"></span><span class="sl-text"></span>';
        box.insertBefore(line, wrap);
        lineOk = true;
      }
      line.querySelector(".sl-text").textContent = text;
      line.classList.toggle("is-running", !!running);
    }

    if (p.status === "start") {
      setLine("正在调用 Skill：" + p.skill, true);
    } else if (p.status === "progress") {
      setLine(p.label ? String(p.label) : "正在执行 Skill：" + p.skill, true);
    } else if (p.status === "done") {
      setLine("调用了 Skill：" + p.skill, false);
      if (p.files && p.files.length) {
        var old = wrap.querySelector(".file-cards");
        if (old) old.remove();
        inner.appendChild(fileCards(p.files));
      }
    } else if (p.status === "error") {
      setLine("调用 Skill 失败：" + (p.skill || "未知 skill") + (p.error ? "（" + p.error + "）" : ""), false);
    }
  }

  function sendMessage() {
    var content = input.value.trim();
    if (state.streaming || !state.currentId) return;
    if (!content && !state.pendingAttachments.length && !state.pendingSkill) return;

    var attachments = state.pendingAttachments.slice();
    var refs = state.pendingRefs.slice();
    var skill = state.pendingSkill;

    var box = document.getElementById("messages");
    var hint = box.querySelector(".empty-hint");
    if (hint) hint.remove();

    var userWrap = renderMsg({ id: "", role: "user", content: content, at: "", attachments: attachments, refs: refs });
    if (skill) {
      var innerEl = userWrap.firstChild;
      var rowEl = userWrap.querySelector(".chip-row");
      if (!rowEl) {
        rowEl = document.createElement("div");
        rowEl.className = "chip-row";
        innerEl.insertBefore(rowEl, innerEl.children[1] || null);
      }
      var sc = document.createElement("div");
      sc.className = "chip";
      sc.innerHTML = '<span class="chip-tag">Skill</span><span class="chip-name">' + esc(skill.name) + '</span>';
      rowEl.insertBefore(sc, rowEl.firstChild);
    }
    box.appendChild(userWrap);
    box.scrollTop = box.scrollHeight;

    // 清空待发送项
    input.value = "";
    state.pendingAttachments = [];
    state.pendingRefs = [];
    state.pendingSkill = null;
    renderChips();
    setStreaming(true);

    // assistant 占位
    var asstWrap = appendStreamingMsg("assistant");
    var asstBubble = asstWrap.querySelector(".bubble");
    asstBubble.textContent = "";

    state.abortCtrl = new AbortController();
    var modelId = activeModelId;

    fetch("/api/chat/sessions/" + state.currentId + "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content, modelId: modelId, skill: skill ? skill.dir : "", attachments: attachments, refs: refs }),
      signal: state.abortCtrl.signal,
    }).then(function (res) {
      if (!res.ok || !res.body) {
        throw new Error("请求失败：" + res.status);
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var pending = "";
      var fullContent = "";

      function pump() {
        return reader.read().then(function (result) {
          if (result.done) return;
          pending += decoder.decode(result.value, { stream: true });

          var idx;
          while ((idx = pending.indexOf("\n\n")) !== -1) {
            var block = pending.slice(0, idx);
            pending = pending.slice(idx + 2);
            var event = "";
            var data = "";
            block.split("\n").forEach(function (line) {
              if (line.indexOf("event:") === 0) event = line.slice(6).trim();
              else if (line.indexOf("data:") === 0) data = line.slice(5).trim();
            });
            if (!data) continue;
            try {
              var payload = JSON.parse(data);
              if (event === "delta" && payload.content) {
                fullContent += payload.content;
                // 流式期间只渲染 markdown + 手写 SVG，不跑 mermaid（incomplete 图表无法解析）
                asstBubble.innerHTML = "";
                var streamMd = renderMarkdown(fullContent);
                asstBubble.appendChild(streamMd);
                renderInlineSvg(streamMd);
                asstWrap.classList.remove("msg-thinking");
                box.scrollTop = box.scrollHeight;
              } else if (event === "skill") {
                onSkillEvent(asstWrap, payload);
                box.scrollTop = box.scrollHeight;
              } else if (event === "error") {
                asstWrap.classList.add("msg-error");
                asstBubble.innerHTML = "";
                asstBubble.textContent = "出错：" + (payload.error || "未知错误");
              } else if (event === "message_end") {
                // 完成后补跑 mermaid 图表渲染，再从服务端拉取最终消息刷新
                var mdEl = asstBubble.querySelector(".md-body");
                if (mdEl) renderMermaid(mdEl);
                setStreaming(false);
                selectSession(state.currentId);
              }
            } catch (e) { /* 忽略非法 JSON */ }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      if (err.name === "AbortError") {
        if (!fullContent) { asstBubble.innerHTML = ""; asstBubble.textContent = "（已停止）"; }
        // 否则保留已渲染的 markdown 内容
      } else {
        asstWrap.classList.add("msg-error");
        asstBubble.innerHTML = "";
        asstBubble.textContent = "网络错误：" + (err.message || err);
      }
      setStreaming(false);
    });
  }

  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  stopBtn.addEventListener("click", function () {
    if (state.abortCtrl) state.abortCtrl.abort();
    setStreaming(false);
  });

  /* ────────────── 初始化 ────────────── */

  initMarkdown();
  initTopbar();
  renderModelSelect();
  renderChips();
  loadSessions();
})();