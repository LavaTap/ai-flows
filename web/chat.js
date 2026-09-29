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
        '<button type="button" class="si-del" title="删除">×</button>';
      item.addEventListener("click", function (e) {
        if (e.target.classList.contains("si-del")) return;
        selectSession(s.id);
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
            loadSessions();
          }
        });
      });
      list.appendChild(item);
    });
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
      box.appendChild(renderMsg(m));
    });
    box.scrollTop = box.scrollHeight;
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
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = m.content;
    inner.appendChild(tag);
    inner.appendChild(bubble);
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

  function sendMessage() {
    var content = input.value.trim();
    if (!content || state.streaming || !state.currentId) return;

    // 先渲染 user 消息到 DOM（不写入 state，等 SSE 完成后从后端刷新）
    var box = document.getElementById("messages");
    // 清空空提示
    var hint = box.querySelector(".empty-hint");
    if (hint) hint.remove();

    var userWrap = document.createElement("div");
    userWrap.className = "msg user";
    var uInner = document.createElement("div");
    uInner.style.minWidth = "0";
    uInner.style.maxWidth = "100%";
    var uTag = document.createElement("div");
    uTag.className = "role-tag";
    uTag.textContent = displayName(user);
    var uBubble = document.createElement("div");
    uBubble.className = "bubble";
    uBubble.textContent = content;
    uInner.appendChild(uTag);
    uInner.appendChild(uBubble);
    userWrap.appendChild(uInner);
    box.appendChild(userWrap);
    box.scrollTop = box.scrollHeight;

    input.value = "";
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
      body: JSON.stringify({ content: content, modelId: modelId }),
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
                asstBubble.textContent = fullContent;
                asstWrap.classList.remove("msg-thinking");
                box.scrollTop = box.scrollHeight;
              } else if (event === "error") {
                asstWrap.classList.add("msg-error");
                asstBubble.textContent = "出错：" + (payload.error || "未知错误");
              } else if (event === "message_end") {
                // 完成，刷新会话消息
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
        asstBubble.textContent = fullContent || "（已停止）";
      } else {
        asstWrap.classList.add("msg-error");
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

  initTopbar();
  renderModelSelect();
  loadSessions();
})();
