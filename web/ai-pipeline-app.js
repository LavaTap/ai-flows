/* ai-pipeline 平台增强脚本：由 platform 服务在 /pipeline 注入 window.__PIPELINE__ 后加载。
   静态预览（无 bootstrap）时完全不生效，不影响纯静态打开。
   平台态能力：顶栏登录用户 + 退出、角色卡片、四态状态徽章、需求编辑/附件上传、
   skill 执行（输出目录选择 + 进度条）、提交验收 / 主管通过 / 驳回。 */
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
    ".d-actions{display:flex;flex-direction:column;gap:10px;position:relative;margin-top:4px;}",
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
    "transition:transform 200ms cubic-bezier(.22,1,.36,1),box-shadow 200ms ease;}",
    ".d-actions .btn:hover:not(:disabled),.d-actions .btn:focus-visible:not(:disabled){",
    "transform:translateY(-1px);box-shadow:0 6px 16px var(--led-glow);}",
    ".d-actions .btn.ghost{background:transparent;border:1px solid var(--glass-line);color:var(--copy);}",
    ".d-actions a.btn{display:inline-flex;align-items:center;text-decoration:none;background:transparent;",
    "border:1px solid rgba(173,49,77,.35);color:var(--led);}",
    ".d-actions a.btn:hover,.d-actions a.btn:focus-visible{transform:translateY(-1px);box-shadow:0 6px 16px var(--led-glow);}",
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
    /* 需求编辑器 */
    ".d-req{width:100%;display:flex;flex-direction:column;gap:8px;}",
    ".d-req-head{font:600 12px/18px var(--font-sans);color:var(--ink-soft);}",
    ".d-req textarea{width:100%;min-height:72px;resize:vertical;padding:10px 12px;border-radius:12px;",
    "border:1px solid var(--glass-line);background:rgba(255,255,255,.7);font:400 13px/20px var(--font-sans);",
    "color:var(--copy);box-sizing:border-box;}",
    ".d-req textarea:disabled{opacity:.6;cursor:not-allowed;}",
    ".d-req .files{display:flex;flex-wrap:wrap;gap:6px;}",
    ".d-req .file{font:400 11px/16px var(--font-sans);color:var(--muted);padding:2px 10px;",
    "border:1px solid var(--glass-line);border-radius:999px;background:var(--glass-fill);}",
    /* 产物列表 */
    ".d-arts{width:100%;display:flex;flex-direction:column;gap:6px;}",
    ".d-arts-head{font:600 12px/18px var(--font-sans);color:var(--ink-soft);}",
    ".d-arts a{font:500 12px/18px var(--font-sans);color:var(--led);text-decoration:none;}",
    ".d-arts a:hover{text-decoration:underline;}",
    /* 评审记录（沿用） */
    ".d-reviews{margin-top:14px;border-top:1px solid var(--glass-line);padding-top:12px;width:100%;}",
    ".d-reviews-head{font:600 13px/20px var(--font-sans);color:var(--ink-soft);margin-bottom:10px;}",
    ".d-reviews-empty{font:400 12px/18px var(--font-sans);color:var(--muted);}",
    ".d-reviews-list{list-style:none;margin:0;padding:0;display:grid;gap:8px;max-height:220px;overflow-y:auto;}",
    ".d-reviews-list li{display:flex;align-items:center;gap:12px;padding:10px 12px;",
    "border:1px solid var(--glass-line);border-radius:12px;background:var(--glass-fill);}",
    ".dr-main{flex:1;min-width:0;}",
    ".dr-who{font:500 12px/18px var(--font-sans);color:var(--copy);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".dr-time{font:400 11px/16px var(--font-sans);color:var(--muted);}",
    ".dr-badge{font:600 11px/16px var(--font-sans);padding:2px 8px;border-radius:999px;white-space:nowrap;}",
    ".dr-badge.pass{color:var(--ok,#2aa198);background:rgba(42,161,152,.12);}",
    ".dr-badge.block{color:var(--led);background:rgba(173,49,77,.12);}",
    ".dr-num{font:600 12px/18px var(--font-sans);color:var(--muted);white-space:nowrap;}",
    ".dr-actions{min-width:44px;text-align:right;}",
    ".dr-actions a{font:500 12px/18px var(--font-sans);color:var(--led);text-decoration:none;border:1px solid rgba(173,49,77,.3);border-radius:999px;padding:3px 10px;}",
    ".dr-actions a:hover{background:var(--led);color:#fff;}",
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

  /* ────────────────────────────── 评审记录面板 ────────────────────────────── */

  function renderReviews(list) {
    var tip = tipEl();
    if (!tip) return;
    var old = tip.querySelector(".d-reviews");
    if (old) old.remove();
    var box = document.createElement("div");
    box.className = "d-reviews";
    var head = document.createElement("div");
    head.className = "d-reviews-head";
    head.textContent = "评审记录（" + list.length + "）";
    box.appendChild(head);
    if (!list.length) {
      var empty = document.createElement("p");
      empty.className = "d-reviews-empty";
      empty.textContent = "暂无评审记录";
      box.appendChild(empty);
    } else {
      var ul = document.createElement("ul");
      ul.className = "d-reviews-list";
      list.forEach(function (re) {
        var li = document.createElement("li");
        var main = document.createElement("div");
        main.className = "dr-main";
        var who = document.createElement("div");
        who.className = "dr-who";
        who.textContent = re.actor + " · " + (re.email ? re.department + " · " + re.email : re.department);
        var time = document.createElement("div");
        time.className = "dr-time";
        var d = new Date(re.generatedAt);
        time.textContent = isNaN(d.getTime()) ? re.generatedAt : d.toLocaleString();
        main.appendChild(who);
        main.appendChild(time);
        var badge = document.createElement("span");
        badge.className = "dr-badge " + (re.passed ? "pass" : "block");
        badge.textContent = re.passed ? "PASS · " + re.blockers + " 拦" : "BLOCK · " + re.blockers;
        var num = document.createElement("span");
        num.className = "dr-num";
        num.textContent = re.issues > 0 ? re.issues + " 条" : "—";
        li.appendChild(main);
        li.appendChild(badge);
        li.appendChild(num);
        var acts = document.createElement("span");
        acts.className = "dr-actions";
        if (re.reportUrl) {
          var a = document.createElement("a");
          a.href = re.reportUrl;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = "报告";
          acts.appendChild(a);
        }
        li.appendChild(acts);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    tip.appendChild(box);
  }

  function addReviewsButton(wrap) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn ghost";
    btn.textContent = "评审记录";
    btn.addEventListener("click", function () {
      var tip = tipEl();
      if (!tip) return;
      if (tip.querySelector(".d-reviews")) {
        tip.querySelector(".d-reviews").remove();
        return;
      }
      btn.disabled = true;
      fetch("/api/reviews").then(function (r) {
        if (r.status === 401) { location.href = "/login"; return null; }
        return r.json();
      }).then(function (d) {
        btn.disabled = false;
        if (!d || !d.reviews) { alert((d && d.error) || "加载失败"); return; }
        renderReviews(d.reviews);
      }).catch(function () {
        btn.disabled = false;
        alert("网络异常");
      });
    });
    wrap.appendChild(btn);
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

    /* 需求编辑器 + 附件（skill 节点） */
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

  /** 需求文本编辑 + 附件上传（节点 01/02；主管与本部门员工可编辑） */
  function renderRequirementEditor(node, idx, wrap) {
    var box = document.createElement("div");
    box.className = "d-req";
    var head = document.createElement("div");
    head.className = "d-req-head";
    head.textContent = node.id === "01" ? "调研需求内容" : "需求描述";
    box.appendChild(head);

    var editable = !!node.canEdit;
    var ta = document.createElement("textarea");
    ta.placeholder = editable ? "填写需求文字描述…" : "（只读：仅本部门员工或主管可编辑）";
    ta.value = node.requirementText || "";
    ta.disabled = !editable;
    box.appendChild(ta);

    /* 附件区：已上传文件名 + 提交文件按钮 */
    var files = document.createElement("div");
    files.className = "files";
    (node.uploads || []).forEach(function (f) {
      var chip = document.createElement("span");
      chip.className = "file";
      chip.textContent = "📎 " + f;
      files.appendChild(chip);
    });
    box.appendChild(files);

    if (editable) {
      var row = document.createElement("div");
      row.className = "d-row";
      var save = document.createElement("button");
      save.type = "button";
      save.className = "btn ghost";
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
            row.appendChild(okChip);
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
      row.appendChild(save);

      var uploadBtn = document.createElement("button");
      uploadBtn.type = "button";
      uploadBtn.className = "btn ghost";
      uploadBtn.textContent = "提交文件";
      uploadBtn.addEventListener("click", function () {
        openUploadDialog(node, function () {
          renderActions(idx);
        });
      });
      row.appendChild(uploadBtn);
      box.appendChild(row);
    }
    wrap.appendChild(box);
  }

  /** 状态驱动的动作按钮 */
  function renderButtons(node, idx, wrap) {
    function addBtn(label, ghost, onClick) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn" + (ghost ? " ghost" : "");
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
      /* 节点 01 专属：需求分析（product-analysis skill，先提交材料） */
      if (node.id === "01") {
        addBtn("需求分析", true, function () {
          openUploadDialog(node, function () {
            runSkillFlow("product-analysis");
          });
          return Promise.resolve();
        });
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

  /** 拉取 /api/nodes 刷新本地状态（含 busy 列表与成员） */
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
