/* ai-pipeline 平台增强脚本：由 platform 服务在 /pipeline 注入 window.__PIPELINE__ 后加载。
   静态预览（无 bootstrap）时完全不生效，不影响纯静态打开。
   平台态能力：左侧管线列表侧栏（新增/重命名）、顶栏标题（管线名/仓库名/report）+ 登录用户 + 退出、
   角色卡片、四态状态徽章、需求编辑/附件上传（色块分区）、skill 执行（输出目录选择 + 进度条）、
   提交验收 / 主管通过 / 驳回、评审记录宽面板（≥60vw）。 */
(function () {
  var boot = window.__PIPELINE__;
  if (!boot) return;

  var user = boot.user;
  var members = boot.members || [];
  var nodes = boot.nodes; /* 顺序与页面 data-idx 0..3 对应 */
  var busyIds = []; /* 后台执行中的节点 id（来自 /api/nodes） */
  var ROLE_TEXT = { staff: "员工", supervisor: "主管" };
  var STATUS_TEXT = { todo: "待执行", running: "执行中", in_review: "待验收", done: "已执行" };
  var STATUS_CLS = { todo: "st-todo", running: "st-running", in_review: "st-review", done: "st-done" };
  /* 头像调色板：按邮箱哈希取色，前端保证同一账号颜色稳定 */
  var PALETTE = ["#ad314d", "#2aa198", "#b58900", "#6c71c4", "#cb4b16", "#859900"];

  /* 管线列表：首项为服务端真实管线，其余为前端虚拟管线 */
  var pipelineName = boot.pipelineName || "text-flow";
  var repoName = boot.repoName || "—";
  var repoPath = boot.repoPath || "";
  var pipelines = [pipelineName];
  var activePipeline = pipelineName;

  function colorOf(email) {
    var h = 0;
    for (var i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  function displayName(m) { return m.name || m.email.split("@")[0]; }
  function firstChar(m) { return displayName(m).slice(0, 1); }

  /* 平台态附加样式（不动静态 ai-pipeline.css） */
  var style = document.createElement("style");
  style.textContent = [
    ".n-status{font:400 11px/16px var(--font-sans);color:var(--muted);}",
    ".d-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".d-status{font:400 12px/18px var(--font-sans);color:var(--muted);}",
    ".d-status b{color:var(--ink-soft);font-weight:500;}",
    ".badge{display:inline-block;font:600 11px/16px var(--font-sans);padding:2px 10px;border-radius:999px;white-space:nowrap;}",
    ".badge.st-todo{color:var(--muted);background:rgba(0,0,0,.06);}",
    ".badge.st-running{color:#b58900;background:rgba(181,137,0,.14);}",
    ".badge.st-review{color:#6c71c4;background:rgba(108,113,196,.14);}",
    ".badge.st-done{color:var(--led);background:rgba(173,49,77,.12);}",
    ".d-actions .note{font:400 12px/18px var(--font-sans);color:var(--muted-2);}",
    ".d-actions .btn{font:500 13px/18px var(--font-sans);min-height:36px;padding:7px 18px;",
    "border:none;border-radius:999px;background:var(--led);color:#fff;cursor:pointer;",
    "transition:transform 200ms cubic-bezier(.22,1,.36,1),box-shadow 200ms ease,background 150ms ease,color 150ms ease;}",
    ".d-actions .btn:hover:not(:disabled),.d-actions .btn:focus-visible:not(:disabled){",
    "transform:translateY(-1px);box-shadow:0 6px 16px var(--led-glow);}",
    ".d-actions .btn.ghost{background:transparent;border:1px solid var(--glass-line);color:var(--copy);}",
    ".d-actions a.btn{display:inline-flex;align-items:center;text-decoration:none;background:transparent;",
    "border:1px solid rgba(173,49,77,.35);color:var(--led);}",
    ".d-actions a.btn:hover,.d-actions a.btn:focus-visible{transform:translateY(-1px);box-shadow:0 6px 16px var(--led-glow);}",
    /* 色块按钮修饰：ghost 按钮按区域着色 */
    ".d-actions .btn.ghost.amber{border-color:var(--amber-line);color:var(--amber);}",
    ".d-actions .btn.ghost.amber:hover:not(:disabled){background:var(--amber-soft);border-color:var(--amber);box-shadow:0 6px 16px rgba(181,137,0,.2);}",
    ".d-actions .btn.ghost.teal{border-color:var(--teal-line);color:var(--teal);}",
    ".d-actions .btn.ghost.teal:hover:not(:disabled){background:var(--teal-soft);border-color:var(--teal);box-shadow:0 6px 16px rgba(42,161,152,.2);}",
    ".d-actions .btn.ghost.purple{border-color:var(--purple-line);color:var(--purple);}",
    ".d-actions .btn.ghost.purple:hover:not(:disabled){background:var(--purple-soft);border-color:var(--purple);box-shadow:0 6px 16px rgba(108,113,196,.2);}",
    ".d-actions .result{font:400 12px/18px var(--font-sans);color:var(--muted);}",
    ".d-actions .result.fail{color:var(--led);}",
    ".d-actions .btn:disabled{opacity:.45;cursor:not-allowed;box-shadow:none;transform:none;}",
    ".top-right .logout{font:500 12px/18px var(--font-sans);color:var(--copy);background:var(--glass-fill);",
    "border:1px solid var(--glass-line);border-radius:999px;padding:4px 12px;cursor:pointer;white-space:nowrap;}",
    ".top-right .logout:hover{color:var(--led);border-color:rgba(173,49,77,.3);}",
    ".user-chip .rname{color:var(--ink-soft);font-weight:500;}",
    /* 角色卡片 */
    ".d-roles{margin-top:12px;border-top:1px solid var(--glass-line);padding-top:10px;}",
    ".d-roles-head{font:600 12px/18px var(--font-sans);color:var(--ink-soft);margin-bottom:8px;}",
    ".d-roles-list{display:flex;gap:8px;flex-wrap:wrap;}",
    ".role-card{position:relative;display:inline-flex;align-items:center;gap:8px;padding:6px 12px 6px 6px;",
    "border:1px solid var(--glass-line);border-radius:999px;background:var(--glass-fill);cursor:default;}",
    ".rc-avatar{width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;",
    "color:#fff;font:600 12px/1 var(--font-sans);flex:none;}",
    ".rc-name{font:500 12px/18px var(--font-sans);color:var(--copy);}",
    ".rc-pop{display:none;position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);",
    "background:rgba(255,255,255,.92);backdrop-filter:blur(12px);border:1px solid var(--glass-line);",
    "border-radius:14px;box-shadow:0 10px 30px rgba(20,20,20,.12);padding:12px 16px;min-width:150px;",
    "text-align:center;z-index:30;}",
    ".role-card:hover .rc-pop{display:block;}",
    ".rc-pop .pa{width:44px;height:44px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;",
    "color:#fff;font:600 18px/1 var(--font-sans);margin-bottom:6px;}",
    ".rc-pop .pn{font:600 13px/20px var(--font-sans);color:var(--ink-soft);}",
    ".rc-pop .pt{font:400 11px/16px var(--font-sans);color:var(--muted);}",
    /* 进度条 */
    ".d-progress{width:100%;}",
    ".d-progress .bar{height:8px;border-radius:999px;background:rgba(0,0,0,.08);overflow:hidden;}",
    ".d-progress .bar i{display:block;height:100%;border-radius:999px;background:var(--led);",
    "transition:width 600ms cubic-bezier(.22,1,.36,1);}",
    ".d-progress .lbl{font:400 11px/16px var(--font-sans);color:var(--muted);margin-top:4px;}",
    /* 需求编辑器（琥珀色块内） */
    ".d-req-head{font:600 12px/18px var(--font-sans);color:var(--amber);display:flex;align-items:center;gap:6px;}",
    ".d-req-head .sec-dot{width:6px;height:6px;border-radius:50%;background:var(--amber);flex:none;}",
    ".d-req textarea{width:100%;min-height:72px;resize:vertical;padding:10px 12px;border-radius:12px;",
    "border:1px solid var(--glass-line);background:rgba(255,255,255,.7);font:400 13px/20px var(--font-sans);",
    "color:var(--copy);box-sizing:border-box;}",
    ".d-req textarea:disabled{opacity:.6;cursor:not-allowed;}",
    /* 提交文件区（青绿色块内） */
    ".d-files-head{font:600 12px/18px var(--font-sans);color:var(--teal);display:flex;align-items:center;gap:6px;}",
    ".d-files-head .sec-dot{width:6px;height:6px;border-radius:50%;background:var(--teal);flex:none;}",
    ".d-files .files{display:flex;flex-wrap:wrap;gap:6px;}",
    ".d-files .file{font:400 11px/16px var(--font-sans);color:var(--teal);padding:2px 10px;",
    "border:1px solid var(--teal-line);border-radius:999px;background:var(--teal-soft);}",
    /* 评审记录触发区（紫色色块内） */
    ".d-reviews-trigger .btn{white-space:nowrap;}",
    /* 产物列表 */
    ".d-arts{width:100%;display:flex;flex-direction:column;gap:6px;}",
    ".d-arts-head{font:600 12px/18px var(--font-sans);color:var(--ink-soft);}",
    ".d-arts a{font:500 12px/18px var(--font-sans);color:var(--led);text-decoration:none;}",
    ".d-arts a:hover{text-decoration:underline;}",
    /* 弹窗（挂在 body，脱离缩放容器） */
    ".ai-modal{position:fixed;inset:0;background:rgba(20,20,20,.35);backdrop-filter:blur(3px);z-index:900;",
    "display:flex;align-items:center;justify-content:center;}",
    ".ai-modal .panel{width:min(520px,92vw);max-height:80vh;overflow-y:auto;background:rgba(255,255,255,.94);",
    "backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.8);border-radius:18px;",
    "box-shadow:0 24px 60px rgba(20,20,20,.25);padding:20px 22px;}",
    ".ai-modal h3{margin:0 0 6px;font:700 16px/24px var(--font-sans);color:var(--ink-soft);}",
    ".ai-modal .sub{font:400 12px/18px var(--font-sans);color:var(--muted);margin-bottom:14px;}",
    ".ai-modal .crumb{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:10px;",
    "font:500 12px/18px var(--font-sans);color:var(--muted);}",
    ".ai-modal .crumb a{color:var(--led);text-decoration:none;cursor:pointer;}",
    ".ai-modal .dirs{display:grid;gap:6px;margin-bottom:14px;}",
    ".ai-modal .dirs button{display:flex;align-items:center;gap:8px;text-align:left;padding:9px 12px;",
    "border:1px solid var(--glass-line);border-radius:12px;background:var(--glass-fill);cursor:pointer;",
    "font:500 13px/18px var(--font-sans);color:var(--copy);}",
    ".ai-modal .dirs button:hover{border-color:rgba(173,49,77,.35);color:var(--led);}",
    ".ai-modal .mkrow{display:flex;gap:8px;margin-bottom:14px;}",
    ".ai-modal .mkrow input{flex:1;padding:8px 12px;border-radius:10px;border:1px solid var(--glass-line);",
    "font:400 13px/18px var(--font-sans);}",
    ".ai-modal .foot{display:flex;gap:8px;justify-content:flex-end;}",
    ".ai-modal .foot .btn{font:500 13px/18px var(--font-sans);padding:8px 18px;border:none;border-radius:999px;",
    "background:var(--led);color:#fff;cursor:pointer;}",
    ".ai-modal .foot .btn.ghost{background:transparent;border:1px solid var(--glass-line);color:var(--copy);}",
    ".ai-modal .empty{font:400 12px/18px var(--font-sans);color:var(--muted);padding:8px 0 14px;}"
  ].join("");
  document.head.appendChild(style);

  var cells = Array.prototype.slice.call(document.querySelectorAll(".cell"));

  /* 当前 tooltip：取选中（on）节点所在 cell 的 .tip */
  function currentTip(idx) {
    var el = idx != null && idx >= 0 ? cells[idx] : document.querySelector(".cell.on");
    return el ? el.querySelector(".tip") : null;
  }

  /* 当前打开 tooltip（detailIdx 由 pipeline-show 维护，-1 时为 null） */
  var detailIdx = -1;
  function tipEl() {
    return currentTip(detailIdx);
  }

  function request(method, url, body) {
    var init = { method: method };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    return fetch(url, init).then(function (r) {
      return r.json().then(function (d) {
        return { ok: r.ok, status: r.status, data: d };
      });
    });
  }
  function post(url, body) { return request("POST", url, body); }
  function put(url, body) { return request("PUT", url, body); }

  /* 登录失效统一跳登录页 */
  function handleAuth(res) {
    if (res.status === 401) {
      location.href = "/login";
      return false;
    }
    return true;
  }

  /* ────────────────────────────── 顶栏标题 + 侧栏 ────────────────────────────── */

  /** 更新顶栏标题（管线名 / 仓库名 / report）与侧栏仓库名 */
  function updateTitle() {
    var ttPipeline = document.querySelector(".tt-pipeline");
    var ttRepo = document.querySelector(".tt-repo");
    if (ttPipeline) ttPipeline.textContent = activePipeline;
    if (ttRepo) ttRepo.textContent = repoName;
    var sfRepo = document.getElementById("sidebarRepo");
    if (sfRepo) sfRepo.textContent = repoName;
    document.title = activePipeline + " / " + repoName + " · AI 管线";
  }

  /** 渲染左侧管线列表 */
  function renderSidebar() {
    var list = document.getElementById("pipelineList");
    if (!list) return;
    list.textContent = "";
    pipelines.forEach(function (name) {
      var li = document.createElement("li");
      li.className = "pipeline-item" + (name === activePipeline ? " active" : "");
      li.setAttribute("data-name", name);

      var span = document.createElement("span");
      span.className = "pi-name";
      span.textContent = name;
      li.appendChild(span);

      /* 重命名按钮 */
      var renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "pi-rename";
      renameBtn.title = "重命名";
      renameBtn.setAttribute("aria-label", "重命名管线");
      renameBtn.textContent = "✎";
      renameBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        handleRename(name);
      });
      li.appendChild(renameBtn);

      /* 点击选中管线 */
      li.addEventListener("click", function () {
        if (name === activePipeline) return;
        activePipeline = name;
        renderSidebar();
      });

      list.appendChild(li);
    });
  }

  /** 重命名管线：活动管线调 API，非活动管线仅前端更新 */
  function handleRename(oldName) {
    var newName = prompt("重命名管线：", oldName);
    if (newName === null) return;
    newName = newName.trim();
    if (!newName || newName === oldName) return;
    if (pipelines.indexOf(newName) >= 0) {
      alert("管线名已存在");
      return;
    }
    /* 活动管线（服务端真实管线）调用重命名 API */
    if (oldName === activePipeline) {
      post("/api/pipeline/rename", { name: newName }).then(function (res) {
        if (!handleAuth(res)) return;
        if (res.ok) {
          var idx = pipelines.indexOf(oldName);
          if (idx >= 0) pipelines[idx] = newName;
          activePipeline = newName;
          pipelineName = newName;
          updateTitle();
          renderSidebar();
        } else {
          alert((res.data && res.data.error) || "重命名失败");
        }
      }).catch(function () { alert("网络异常"); });
    } else {
      /* 非活动管线：仅前端虚拟更新 */
      var idx = pipelines.indexOf(oldName);
      if (idx >= 0) pipelines[idx] = newName;
      renderSidebar();
    }
  }

  /** 添加新管线（前端虚拟） */
  function handleAddPipeline() {
    var input = document.getElementById("newPipelineInput");
    if (!input) return;
    var name = input.value.trim();
    if (!name) return;
    if (pipelines.indexOf(name) >= 0) {
      alert("管线名已存在");
      return;
    }
    pipelines.push(name);
    activePipeline = name;
    input.value = "";
    renderSidebar();
  }

  /* 初始化侧栏 */
  (function initSidebar() {
    renderSidebar();
    updateTitle();
    var addBtn = document.getElementById("addPipelineBtn");
    var input = document.getElementById("newPipelineInput");
    if (addBtn) addBtn.addEventListener("click", handleAddPipeline);
    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") handleAddPipeline();
      });
    }
  })();

  /* 顶栏：登录用户信息（头像配色 + 姓名/岗位）+ 退出 */
  (function renderTopbar() {
    var chip = document.querySelector(".user-chip");
    if (chip) {
      chip.textContent = "";
      var avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.style.background = colorOf(user.email);
      avatar.style.color = "#fff";
      avatar.style.fontWeight = "600";
      avatar.style.fontSize = "12px";
      avatar.style.display = "inline-flex";
      avatar.style.alignItems = "center";
      avatar.style.justifyContent = "center";
      avatar.textContent = (user.name || user.email).slice(0, 1);
      var name = document.createElement("span");
      name.className = "rname";
      name.textContent = (user.name ? user.name + " · " : "") + user.title + " · " + ROLE_TEXT[user.role];
      chip.appendChild(avatar);
      chip.appendChild(name);
      chip.title = user.email;
    }
    var topRight = document.querySelector(".top-right");
    if (topRight) {
      var out = document.createElement("button");
      out.type = "button";
      out.className = "logout";
      out.textContent = "退出";
      out.addEventListener("click", function () {
        post("/api/logout").then(function () { location.href = "/login"; });
      });
      topRight.appendChild(out);
    }
  })();

  /* ────────────────────────────── 角色卡片 ────────────────────────────── */

  /** 渲染本节点部门的执行角色卡片：头像（哈希配色）+ 姓名，悬停浮层显示 姓名/岗位/头像 */
  function renderRoles(idx, panel) {
    var node = nodes[idx];
    if (!node) return;
    var old = panel.querySelector(".d-roles");
    if (old) old.remove();
    var team = members.filter(function (m) { return m.department === node.department; });
    if (!team.length) return;
    var box = document.createElement("div");
    box.className = "d-roles";
    var head = document.createElement("div");
    head.className = "d-roles-head";
    head.textContent = "执行角色";
    var list = document.createElement("div");
    list.className = "d-roles-list";
    team.forEach(function (m) {
      var card = document.createElement("span");
      card.className = "role-card";
      var av = document.createElement("span");
      av.className = "rc-avatar";
      av.style.background = colorOf(m.email);
      av.textContent = firstChar(m);
      var nm = document.createElement("span");
      nm.className = "rc-name";
      nm.textContent = displayName(m);
      /* 悬停浮层：大头像 + 姓名 + 岗位 */
      var pop = document.createElement("span");
      pop.className = "rc-pop";
      var pa = document.createElement("span");
      pa.className = "pa";
      pa.style.background = colorOf(m.email);
      pa.textContent = firstChar(m);
      var pn = document.createElement("span");
      pn.className = "pn";
      pn.style.display = "block";
      pn.textContent = displayName(m);
      var pt = document.createElement("span");
      pt.className = "pt";
      pt.style.display = "block";
      pt.textContent = m.title;
      pop.appendChild(pa);
      pop.appendChild(pn);
      pop.appendChild(pt);
      card.appendChild(av);
      card.appendChild(nm);
      card.appendChild(pop);
      list.appendChild(card);
    });
    box.appendChild(head);
    box.appendChild(list);
    panel.appendChild(box);
  }

  /* ────────────────────────────── 弹窗 ────────────────────────────── */

  /** 通用弹窗骨架：返回 { panel, close }，点击遮罩不关闭（防误触丢选择） */
  function openModal() {
    var mask = document.createElement("div");
    mask.className = "ai-modal";
    var panel = document.createElement("div");
    panel.className = "panel";
    mask.appendChild(panel);
    document.body.appendChild(mask);
    return {
      panel: panel,
      close: function () { mask.remove(); },
    };
  }

  /** 输出目录选择弹窗：面包屑 + 子目录列表 + 新建文件夹 + 选定，确认后 cb(相对路径) */
  function openDirPicker(cb) {
    var m = openModal();
    var cur = "";
    var h = document.createElement("h3");
    h.textContent = "选择输出目录";
    var sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = "只能选择目标仓库内的目录，产物将写入所选目录";
    m.panel.appendChild(h);
    m.panel.appendChild(sub);
    var crumb = document.createElement("div");
    crumb.className = "crumb";
    var dirsBox = document.createElement("div");
    dirsBox.className = "dirs";
    var mkrow = document.createElement("div");
    mkrow.className = "mkrow";
    var mkInput = document.createElement("input");
    mkInput.placeholder = "新建文件夹名…";
    var mkBtn = document.createElement("button");
    mkBtn.type = "button";
    mkBtn.className = "btn ghost";
    mkBtn.textContent = "新建";
    mkrow.appendChild(mkInput);
    mkrow.appendChild(mkBtn);
    var foot = document.createElement("div");
    foot.className = "foot";
    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn ghost";
    cancel.textContent = "取消";
    var ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn";
    ok.textContent = "选定此目录";
    foot.appendChild(cancel);
    foot.appendChild(ok);
    m.panel.appendChild(crumb);
    m.panel.appendChild(dirsBox);
    m.panel.appendChild(mkrow);
    m.panel.appendChild(foot);

    function renderCrumb() {
      crumb.textContent = "";
      var root = document.createElement("a");
      root.textContent = "仓库根";
      root.addEventListener("click", function () { load("."); });
      crumb.appendChild(root);
      if (cur && cur !== ".") {
        var segs = cur.split("/");
        var acc = "";
        segs.forEach(function (s, i) {
          acc = acc ? acc + "/" + s : s;
          var path = acc;
          crumb.appendChild(document.createTextNode(" / "));
          var a = document.createElement(i === segs.length - 1 ? "span" : "a");
          a.textContent = s;
          if (i < segs.length - 1) a.addEventListener("click", function () { load(path); });
          crumb.appendChild(a);
        });
      }
    }

    function load(path) {
      cur = path;
      dirsBox.textContent = "";
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "加载中…";
      dirsBox.appendChild(empty);
      fetch("/api/fs?path=" + encodeURIComponent(path)).then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.error) { alert(d.error); return; }
          renderCrumb();
          dirsBox.textContent = "";
          var up = document.createElement("button");
          up.type = "button";
          up.textContent = "← 返回上级";
          up.disabled = !cur || cur === ".";
          if (cur && cur !== ".") {
            up.addEventListener("click", function () {
              var p = cur.split("/");
              p.pop();
              load(p.length ? p.join("/") : ".");
            });
          }
          dirsBox.appendChild(up);
          if (!d.dirs || !d.dirs.length) {
            var e2 = document.createElement("div");
            e2.className = "empty";
            e2.textContent = "（无子目录）";
            dirsBox.appendChild(e2);
          }
          (d.dirs || []).forEach(function (dir) {
            var b = document.createElement("button");
            b.type = "button";
            b.textContent = "📁 " + dir.name;
            b.addEventListener("click", function () { load(dir.path); });
            dirsBox.appendChild(b);
          });
        })
        .catch(function () { alert("目录加载失败"); });
    }

    mkBtn.addEventListener("click", function () {
      var name = (mkInput.value || "").trim();
      if (!name) return;
      mkBtn.disabled = true;
      post("/api/fs/mkdir", { path: cur || ".", name: name }).then(function (res) {
        mkBtn.disabled = false;
        if (res.ok) { mkInput.value = ""; load(res.data.path); }
        else alert((res.data && res.data.error) || "新建失败");
      });
    });
    cancel.addEventListener("click", m.close);
    ok.addEventListener("click", function () {
      m.close();
      cb(cur || ".");
    });
    load(".");
  }

  /** 附件上传弹窗：选文件（可多个）→ base64 逐个上传；「不上传，继续」直接走 done 回调 */
  function openUploadDialog(node, done) {
    var m = openModal();
    var h = document.createElement("h3");
    h.textContent = "提交文件";
    var sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = "选择材料文件上传到节点「" + node.step + "」，作为 skill 执行的附件输入";
    m.panel.appendChild(h);
    m.panel.appendChild(sub);
    var input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.marginBottom = "14px";
    m.panel.appendChild(input);
    var status = document.createElement("div");
    status.className = "empty";
    status.textContent = "";
    m.panel.appendChild(status);
    var foot = document.createElement("div");
    foot.className = "foot";
    var skip = document.createElement("button");
    skip.type = "button";
    skip.className = "btn ghost";
    skip.textContent = "不上传，继续";
    var up = document.createElement("button");
    up.type = "button";
    up.className = "btn";
    up.textContent = "上传";
    foot.appendChild(skip);
    foot.appendChild(up);
    m.panel.appendChild(foot);

    function readFileAsBase64(file) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () {
          var s = String(fr.result);
          resolve(s.slice(s.indexOf(",") + 1));
        };
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
    }

    up.addEventListener("click", function () {
      var files = input.files && input.files.length ? Array.prototype.slice.call(input.files) : [];
      if (!files.length) { alert("请先选择文件"); return; }
      up.disabled = true;
      var chain = Promise.resolve();
      var i = 0;
      files.forEach(function (f) {
        chain = chain.then(function () {
          status.textContent = "上传中（" + ++i + "/" + files.length + "）：" + f.name;
          return readFileAsBase64(f).then(function (b64) {
            return post("/api/nodes/" + node.id + "/upload", {
              filename: f.name,
              contentBase64: b64,
            });
          });
        });
      });
      chain.then(function () {
        status.textContent = "上传完成";
        return refreshNodes();
      }).then(function () {
        m.close();
        if (done) done();
      }).catch(function () {
        up.disabled = false;
        alert("上传失败，请重试");
      });
    });
    skip.addEventListener("click", function () {
      m.close();
      if (done) done();
    });
  }

  /* ────────────────────────────── 评审记录宽面板（≥60vw） ────────────────────────────── */

  /** 打开评审记录宽面板：独立模态，脱离 tooltip 缩放容器，展示完整评审记录 */
  function openReviewPanel() {
    var overlay = document.createElement("div");
    overlay.className = "review-overlay";
    var panel = document.createElement("div");
    panel.className = "review-panel";
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    /* 头部 */
    var head = document.createElement("div");
    head.className = "review-panel-head";
    var h3 = document.createElement("h3");
    h3.textContent = "评审记录";
    var countSpan = document.createElement("span");
    countSpan.className = "rp-count";
    head.appendChild(h3);
    head.appendChild(countSpan);
    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "review-panel-close";
    closeBtn.textContent = "关闭";
    head.appendChild(closeBtn);
    panel.appendChild(head);

    /* 主体 */
    var body = document.createElement("div");
    body.className = "review-panel-body";
    var loading = document.createElement("div");
    loading.className = "review-panel-loading";
    loading.textContent = "加载中…";
    body.appendChild(loading);
    panel.appendChild(body);

    /* 关闭交互：按钮 + 点击遮罩 + Esc */
    function close() { overlay.remove(); }
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    function onEsc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); } }
    document.addEventListener("keydown", onEsc);

    /* 拉取评审记录 */
    fetch("/api/reviews").then(function (r) {
      if (r.status === 401) { location.href = "/login"; return null; }
      return r.json();
    }).then(function (d) {
      body.textContent = "";
      if (!d || !d.reviews) {
        var err = document.createElement("div");
        err.className = "review-panel-empty";
        err.textContent = (d && d.error) || "加载失败";
        body.appendChild(err);
        return;
      }
      countSpan.textContent = "（" + d.reviews.length + " 条）";
      if (!d.reviews.length) {
        var empty = document.createElement("div");
        empty.className = "review-panel-empty";
        empty.textContent = "暂无评审记录";
        body.appendChild(empty);
        return;
      }
      d.reviews.forEach(function (re) {
        var rec = document.createElement("div");
        rec.className = "review-record";

        var main = document.createElement("div");
        main.className = "rr-main";
        var who = document.createElement("div");
        who.className = "rr-who";
        who.textContent = re.actor + " · " + (re.email ? re.department + " · " + re.email : re.department);
        var time = document.createElement("div");
        time.className = "rr-time";
        var dt = new Date(re.generatedAt);
        time.textContent = isNaN(dt.getTime()) ? re.generatedAt : dt.toLocaleString();
        main.appendChild(who);
        main.appendChild(time);
        rec.appendChild(main);

        var badge = document.createElement("span");
        badge.className = "rr-badge " + (re.passed ? "pass" : "block");
        badge.textContent = re.passed ? "PASS · " + re.blockers + " 拦" : "BLOCK · " + re.blockers;
        rec.appendChild(badge);

        var num = document.createElement("span");
        num.className = "rr-num";
        num.textContent = re.issues > 0 ? re.issues + " 条" : "—";
        rec.appendChild(num);

        var acts = document.createElement("span");
        acts.className = "rr-actions";
        if (re.reportUrl) {
          var a = document.createElement("a");
          a.href = re.reportUrl;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = "查看报告";
          acts.appendChild(a);
        }
        rec.appendChild(acts);
        body.appendChild(rec);
      });
    }).catch(function () {
      body.textContent = "";
      var err = document.createElement("div");
      err.className = "review-panel-empty";
      err.textContent = "网络异常，请重试";
      body.appendChild(err);
    });
  }

  /** 在动作区添加「评审记录」按钮（紫色色块触发区），点击打开宽面板 */
  function addReviewsButton(wrap) {
    var trigger = document.createElement("div");
    trigger.className = "d-reviews-trigger";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn ghost purple";
    btn.textContent = "评审记录";
    btn.addEventListener("click", openReviewPanel);
    trigger.appendChild(btn);
    wrap.appendChild(trigger);
  }

  /* ────────────────────────────── 详情动作区 ────────────────────────────── */

  function isSkillNode(node) {
    return !!node.runner && node.runner.indexOf("skill:") === 0;
  }

  function renderActions(idx) {
    var node = nodes[idx];
    var panel = currentTip(idx);
    if (!node || !panel) return;

    /* 头部状态徽章同步（模板里的 .tag 由平台态接管） */
    var tag = panel.querySelector(".d-head .tag");
    if (tag) {
      tag.textContent = STATUS_TEXT[node.status] || node.status;
      tag.className = "tag " + (STATUS_CLS[node.status] || "st-todo");
    }

    /* 角色卡片（先于动作区渲染） */
    renderRoles(idx, panel);

    var old = panel.querySelector(".d-actions");
    if (old) old.remove();

    var wrap = document.createElement("div");
    wrap.className = "d-actions";

    /* 状态行 */
    var row1 = document.createElement("div");
    row1.className = "d-row";
    var badge = document.createElement("span");
    badge.className = "badge " + (STATUS_CLS[node.status] || "st-todo");
    badge.textContent = STATUS_TEXT[node.status] || node.status;
    row1.appendChild(badge);
    if (node.rejection) {
      var rej = document.createElement("span");
      rej.className = "result fail";
      rej.textContent = "驳回意见：" + node.rejection;
      row1.appendChild(rej);
    }
    wrap.appendChild(row1);

    /* 进度条（执行中且服务端已回报进度） */
    if (node.status === "running" && node.progress != null) {
      var pg = document.createElement("div");
      pg.className = "d-progress";
      var bar = document.createElement("div");
      bar.className = "bar";
      var fill = document.createElement("i");
      fill.style.width = Math.max(2, Math.min(100, node.progress)) + "%";
      bar.appendChild(fill);
      var lbl = document.createElement("div");
      lbl.className = "lbl";
      lbl.textContent = (node.progressLabel || "执行中") + " · " + node.progress + "%";
      pg.appendChild(bar);
      pg.appendChild(lbl);
      wrap.appendChild(pg);
    }

    /* 最近一次执行结果 */
    if (node.lastResult) {
      var result = document.createElement("span");
      result.className = "result";
      if (node.lastResult.indexOf("失败") >= 0 || node.lastResult.indexOf("未通过") >= 0) {
        result.classList.add("fail");
      }
      result.textContent = node.lastResult;
      var row2 = document.createElement("div");
      row2.className = "d-row";
      row2.appendChild(result);
      wrap.appendChild(row2);
    }

    /* 产物列表（skill 节点，可下载） */
    if (node.artifacts && node.artifacts.length) {
      var arts = document.createElement("div");
      arts.className = "d-arts";
      var ah = document.createElement("div");
      ah.className = "d-arts-head";
      ah.textContent = "产出文件（" + node.artifacts.length + "）";
      arts.appendChild(ah);
      node.artifacts.forEach(function (a) {
        var link = document.createElement("a");
        link.href = "/api/artifacts/" + node.id + "/" + encodeURIComponent(a.name);
        link.textContent = a.name + "（" + a.skill + "）";
        arts.appendChild(link);
      });
      wrap.appendChild(arts);
    }

    /* 评审报告页链接（runner=ai-review） */
    if (node.reportUrl) {
      var link = document.createElement("a");
      link.className = "btn";
      link.href = node.reportUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "查看评审报告";
      var rowR = document.createElement("div");
      rowR.className = "d-row";
      rowR.appendChild(link);
      wrap.appendChild(rowR);
    }

    /* 需求编辑器 + 附件（skill 节点）：拆为 琥珀色需求区 + 青绿附件区 */
    if (isSkillNode(node)) {
      renderRequirementEditor(node, idx, wrap);
    }

    /* 动作按钮行 */
    var rowBtn = document.createElement("div");
    rowBtn.className = "d-row";
    renderButtons(node, idx, rowBtn);
    wrap.appendChild(rowBtn);

    panel.appendChild(wrap);
  }

  /** 需求文本编辑（琥珀区）+ 附件上传（青绿区）：拆为两个色块分区 */
  function renderRequirementEditor(node, idx, wrap) {
    /* —— 琥珀区：需求文本编辑 —— */
    var reqBox = document.createElement("div");
    reqBox.className = "d-req";
    var reqHead = document.createElement("div");
    reqHead.className = "d-req-head";
    var reqDot = document.createElement("span");
    reqDot.className = "sec-dot";
    reqHead.appendChild(reqDot);
    reqHead.appendChild(document.createTextNode(node.id === "01" ? "调研需求内容" : "需求描述"));
    reqBox.appendChild(reqHead);

    var editable = !!node.canEdit;
    var ta = document.createElement("textarea");
    ta.placeholder = editable ? "填写需求文字描述…" : "（只读：仅本部门员工或主管可编辑）";
    ta.value = node.requirementText || "";
    ta.disabled = !editable;
    reqBox.appendChild(ta);

    if (editable) {
      var reqRow = document.createElement("div");
      reqRow.className = "d-row";
      var save = document.createElement("button");
      save.type = "button";
      save.className = "btn ghost amber";
      save.textContent = "保存需求";
      save.addEventListener("click", function () {
        save.disabled = true;
        var origin = save.textContent;
        save.textContent = "保存中…";
        put("/api/nodes/" + node.id + "/requirement", { text: ta.value }).then(function (res) {
          save.disabled = false;
          save.textContent = origin;
          if (!handleAuth(res)) return;
          if (res.ok && res.data.node) {
            nodes[idx] = res.data.node;
            var okChip = document.createElement("span");
            okChip.className = "note";
            okChip.textContent = "已保存 ✓";
            reqRow.appendChild(okChip);
            setTimeout(function () { okChip.remove(); }, 1600);
          } else {
            alert((res.data && res.data.error) || "保存失败");
          }
        }).catch(function () {
          save.disabled = false;
          save.textContent = origin;
          alert("网络异常");
        });
      });
      reqRow.appendChild(save);
      reqBox.appendChild(reqRow);
    }
    wrap.appendChild(reqBox);

    /* —— 青绿区：附件文件 —— */
    var fileBox = document.createElement("div");
    fileBox.className = "d-files";
    var fileHead = document.createElement("div");
    fileHead.className = "d-files-head";
    var fileDot = document.createElement("span");
    fileDot.className = "sec-dot";
    fileHead.appendChild(fileDot);
    fileHead.appendChild(document.createTextNode("提交文件 / 附件"));
    fileBox.appendChild(fileHead);

    var files = document.createElement("div");
    files.className = "files";
    (node.uploads || []).forEach(function (f) {
      var chip = document.createElement("span");
      chip.className = "file";
      chip.textContent = "📎 " + f;
      files.appendChild(chip);
    });
    fileBox.appendChild(files);

    if (editable) {
      var fileRow = document.createElement("div");
      fileRow.className = "d-row";
      var uploadBtn = document.createElement("button");
      uploadBtn.type = "button";
      uploadBtn.className = "btn ghost teal";
      uploadBtn.textContent = "提交文件";
      uploadBtn.addEventListener("click", function () {
        openUploadDialog(node, function () {
          renderActions(idx);
        });
      });
      fileRow.appendChild(uploadBtn);
      fileBox.appendChild(fileRow);
    }
    wrap.appendChild(fileBox);
  }

  /** 状态驱动的动作按钮 */
  function renderButtons(node, idx, wrap) {
    function addBtn(label, ghost, onClick, colorCls) {
      var btn = document.createElement("button");
      btn.type = "button";
      var cls = "btn" + (ghost ? " ghost" : "") + (colorCls ? " " + colorCls : "");
      btn.className = cls;
      btn.textContent = label;
      btn.addEventListener("click", function () {
        btn.disabled = true;
        var origin = btn.textContent;
        btn.textContent = "处理中…";
        Promise.resolve(onClick(btn)).catch(function () {
          btn.disabled = false;
          btn.textContent = origin;
          alert("网络异常");
        });
      });
      wrap.appendChild(btn);
    }

    function doExecute(body) {
      return post("/api/nodes/" + node.id + "/execute", body).then(function (res) {
        if (!handleAuth(res)) return;
        if (res.ok && res.data.node) {
          nodes[idx] = res.data.node;
          busyIds.push(node.id);
          renderActions(idx);
          startPolling();
        } else {
          alert((res.data && res.data.error) || "执行失败");
          renderActions(idx);
        }
      });
    }

    /* skill 执行：先选输出目录再执行 */
    function runSkillFlow(skillOverride) {
      openDirPicker(function (dir) {
        renderActions(idx);
        doExecute(skillOverride ? { outputDir: dir, skill: skillOverride } : { outputDir: dir });
      });
    }

    if (!node.ready || !node.runner) {
      var note = document.createElement("span");
      note.className = "note";
      note.textContent = "该环节能力待接入，暂不可执行";
      wrap.appendChild(note);
      return;
    }

    if (!node.canExecute) {
      var tipNote = document.createElement("span");
      tipNote.className = "note";
      tipNote.textContent = "仅本部门员工或部门主管可操作该节点";
      wrap.appendChild(tipNote);
      if (node.runner === "ai-review") addReviewsButton(wrap);
      return;
    }

    if (node.status === "in_review") {
      if (node.canApprove) {
        addBtn("通过验收", false, function () {
          return post("/api/nodes/" + node.id + "/approve").then(function (res) {
            if (!handleAuth(res)) return;
            if (res.ok && res.data.node) {
              nodes[idx] = res.data.node;
              renderActions(idx);
            } else { alert((res.data && res.data.error) || "操作失败"); renderActions(idx); }
          });
        });
        addBtn("驳回", true, function () {
          var reason = prompt("驳回意见（将退回「执行中」）：", "验收不通过，请修改后重新提交");
          if (reason === null) return Promise.resolve();
          return post("/api/nodes/" + node.id + "/reject", { reason: reason }).then(function (res) {
            if (!handleAuth(res)) return;
            if (res.ok && res.data.node) {
              nodes[idx] = res.data.node;
              renderActions(idx);
            } else { alert((res.data && res.data.error) || "操作失败"); renderActions(idx); }
          });
        });
      } else {
        var wait = document.createElement("span");
        wait.className = "note";
        wait.textContent = "已提交验收，等待主管审核…";
        wrap.appendChild(wait);
      }
      if (node.runner === "ai-review") addReviewsButton(wrap);
      return;
    }

    if (node.status === "done") {
      var doneNote = document.createElement("span");
      doneNote.className = "note";
      doneNote.textContent = "该节点已验收通过（已执行）";
      wrap.appendChild(doneNote);
      if (node.runner === "ai-review") addReviewsButton(wrap);
      return;
    }

    /* todo / running：执行 + 提交验收 */
    var isRunning = node.status === "running";
    var inFlight = busyIds.indexOf(node.id) >= 0;

    if (isSkillNode(node)) {
      addBtn(node.id === "01" ? (isRunning ? "重新执行" : "直接执行") : (isRunning ? "重新执行" : "执行"),
        false, function () { runSkillFlow(); });
      /* 节点 01 专属：需求分析（product-analysis skill，先提交材料）—— 琥珀色 */
      if (node.id === "01") {
        addBtn("需求分析", true, function () {
          openUploadDialog(node, function () {
            runSkillFlow("product-analysis");
          });
          return Promise.resolve();
        }, "amber");
      }
    } else if (node.runner === "ai-review") {
      addBtn(isRunning ? "重新执行" : "执行", false, function () {
        return doExecute({});
      });
      addReviewsButton(wrap);
    }

    if (isRunning && !inFlight) {
      addBtn("提交验收", false, function () {
        return post("/api/nodes/" + node.id + "/submit").then(function (res) {
          if (!handleAuth(res)) return;
          if (res.ok && res.data.node) {
            nodes[idx] = res.data.node;
            renderActions(idx);
          } else { alert((res.data && res.data.error) || "提交失败"); renderActions(idx); }
        });
      });
    } else if (isRunning && inFlight) {
      var rn = document.createElement("span");
      rn.className = "note";
      rn.textContent = "后台执行中，完成后可提交验收…";
      wrap.appendChild(rn);
    }
  }

  /* ────────────────────────────── 轮询 ────────────────────────────── */

  /** 拉取 /api/nodes 刷新本地状态（含 busy 列表、成员与管线名） */
  function refreshNodes() {
    return fetch("/api/nodes").then(function (r) {
      if (r.status === 401) {
        stopPolling();
        location.href = "/login";
        return null;
      }
      return r.json();
    }).then(function (d) {
      if (!d || !d.nodes) return;
      nodes = d.nodes;
      if (d.members) members = d.members;
      if (d.busy) busyIds = d.busy;
      /* 同步管线名（可能被其他端重命名） */
      if (d.pipelineName && d.pipelineName !== pipelineName) {
        pipelineName = d.pipelineName;
        var idx = pipelines.indexOf(activePipeline);
        if (idx >= 0) {
          pipelines[idx] = pipelineName;
          activePipeline = pipelineName;
        }
        updateTitle();
        renderSidebar();
      }
      if (detailIdx >= 0) renderActions(detailIdx);
    });
  }

  var pollTimer = null;
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      refreshNodes().then(function () {
        /* 停表条件：无在途任务，且无「执行中且进度未满」的节点 */
        var inFlight = busyIds.length > 0 || nodes.some(function (n) {
          return n && n.status === "running" && n.progress != null && n.progress < 100;
        });
        if (!inFlight) stopPolling();
      }).catch(function () {
        /* 网络抖动继续等下一轮 */
      });
    }, 2000);
  }

  /* 每次悬停切换详情后重建动作区 */
  window.addEventListener("pipeline-show", function (e) {
    detailIdx = Number(e.detail);
    if (detailIdx >= 0) renderActions(detailIdx);
  });

  /* 首屏：若已有选中的节点（如刷新返回），补动作区 */
  var firstOn = cells.findIndex(function (c) { return c.classList.contains("on"); });
  if (firstOn >= 0) {
    detailIdx = firstOn;
    renderActions(firstOn);
  }

  /* 首屏即有执行中的节点（如刷新页面）：先拉一次状态再决定是否轮询 */
  if (nodes.some(function (n) { return n && n.status === "running"; })) {
    refreshNodes().then(function () {
      var inFlight = busyIds.length > 0 || nodes.some(function (n) {
        return n && n.status === "running" && n.progress != null && n.progress < 100;
      });
      if (inFlight) startPolling();
    });
  }
})();
