/* ai-pipeline 平台增强脚本：由 platform 服务在 /pipeline 注入 window.__PIPELINE__ 后加载。
   静态预览（无 bootstrap）时完全不生效，不影响纯静态打开。
   平台态能力：顶栏登录用户 + 退出、节点状态展示、详情面板「执行 / 批准」动作。 */
(function () {
  var boot = window.__PIPELINE__;
  if (!boot) return;

  var user = boot.user;
  var nodes = boot.nodes; /* 顺序与页面 data-idx 0..3 对应 */
  var ROLE_TEXT = { staff: "员工", supervisor: "主管" };
  var STATUS_TEXT = { todo: "待执行", running: "执行中", done: "已执行", approved: "已批准" };

  /* 平台态附加样式（不动静态 ai-pipeline.css） */
  var style = document.createElement("style");
  style.textContent = [
    ".n-status{font:400 11px/16px var(--font-sans);color:var(--muted);}",
    ".node.on .n-status.approved,.n-status.approved{color:var(--led);font-weight:500;}",
    ".d-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;position:relative;margin-top:4px;}",
    ".d-status{font:400 12px/18px var(--font-sans);color:var(--muted);}",
    ".d-status b{color:var(--ink-soft);font-weight:500;}",
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
    ".d-reviews{margin-top:14px;border-top:1px solid var(--glass-line);padding-top:12px;}",
    ".d-reviews-head{font:600 13px/20px var(--font-sans);color:var(--ink-soft);margin-bottom:10px;}",
    ".d-reviews-empty{font:400 12px/18px var(--font-sans);color:var(--muted);}",
    ".d-reviews-list{list-style:none;margin:0;padding:0;display:grid;gap:8px;}",
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
    ".dr-actions a:hover{background:var(--led);color:#fff;}"
  ].join("");
  document.head.appendChild(style);

  var cells = Array.prototype.slice.call(document.querySelectorAll(".cell"));

  /* 当前 tooltip：取选中（on）节点所在 cell 的 .tip */
  function currentTip(idx) {
    var el = idx != null && idx >= 0 ? cells[idx] : document.querySelector(".cell.on");
    return el ? el.querySelector(".tip") : null;
  }

  /* 当前打开 tooltip（detailIdx 由 pipeline-show 维护，-1 时为 null） */
  function tipEl() {
    return currentTip(detailIdx);
  }

  function post(url) {
    return fetch(url, { method: "POST" }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, data: d }; });
    });
  }

  /* 顶栏：登录用户信息 + 退出 */
  (function renderTopbar() {
    var chip = document.querySelector(".user-chip");
    if (chip) {
      chip.textContent = "";
      var avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.setAttribute("aria-hidden", "true");
      var name = document.createElement("span");
      name.className = "rname";
      name.textContent = user.title + " · " + ROLE_TEXT[user.role];
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

  /* 平台态内的工具语义：代码评审节点可展开评审记录；详情动作区随 tooltip 重建 */

  /* 评审记录面板：渲染 /api/reviews 返回的列表（含角色/部门/结果/时间/报告入口） */
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

  /* 节点 03「评审记录」按钮：点击拉取并按视角展示所有执行角色的评审历史 */
  function addReviewsButton(node, wrap) {
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
      var origin = btn.textContent;
      btn.textContent = "加载中…";
      fetch("/api/reviews").then(function (r) {
        if (r.status === 401) { location.href = "/login"; return null; }
        return r.json();
      }).then(function (d) {
        btn.disabled = false;
        if (!d || !d.reviews) { alert((d && d.error) || "加载失败"); return; }
        renderReviews(d.reviews);
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = origin;
        alert("网络异常");
      });
    });
    wrap.appendChild(btn);
  }

  /* 详情面板动作区（每次 pipeline-show / 轮询刷新后重建） */
  var detailIdx = -1;
  function renderActions(idx) {
    var node = nodes[idx];
    var panel = currentTip(idx);
    if (!node || !panel) return;
    var old = panel.querySelector(".d-actions");
    if (old) old.remove();

    var wrap = document.createElement("div");
    wrap.className = "d-actions";

    var status = document.createElement("span");
    status.className = "d-status";
    status.innerHTML = "";
    var b = document.createElement("b");
    b.textContent = "状态";
    status.appendChild(b);
    status.appendChild(document.createTextNode(" " + STATUS_TEXT[node.status]));
    wrap.appendChild(status);

    /* 最近一次执行结果（评审通过 / 未通过 / 失败原因） */
    if (node.lastResult) {
      var result = document.createElement("span");
      result.className = "result";
      if (node.lastResult.indexOf("失败") >= 0 || node.lastResult.indexOf("未通过") >= 0) {
        result.classList.add("fail");
      }
      result.textContent = node.lastResult;
      wrap.appendChild(result);
    }

    /* 评审报告页链接（runner=ai-review 执行成功后写入） */
    if (node.reportUrl) {
      var link = document.createElement("a");
      link.className = "btn";
      link.href = node.reportUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "查看评审报告";
      wrap.appendChild(link);
    }

    /* 节点 03（AI 代码评审）：提供「评审记录」入口，查看所有执行角色的评审历史 */
    if (node.runner === "ai-review") {
      addReviewsButton(node, wrap);
    }

    function addBtn(label, url, ghost, disabled) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn" + (ghost ? " ghost" : "");
      btn.textContent = label;
      btn.disabled = !!disabled;
      btn.addEventListener("click", function () {
        btn.disabled = true;
        var origin = btn.textContent;
        btn.textContent = "处理中…";
        post("/api/nodes/" + node.id + "/" + url).then(function (res) {
          if (res.ok && res.data.node) {
            nodes[idx] = res.data.node;
            renderActions(idx);
            if (res.data.node.status === "running") startPolling();
          } else {
            btn.disabled = false;
            btn.textContent = origin;
            alert((res.data && res.data.error) || "操作失败");
          }
        }).catch(function () {
          btn.disabled = false;
          btn.textContent = origin;
          alert("网络异常");
        });
      });
      wrap.appendChild(btn);
    }

    if (!node.ready) {
      var note = document.createElement("span");
      note.className = "note";
      note.textContent = "该环节能力待接入，暂不可执行";
      wrap.appendChild(note);
    } else if (node.status === "running") {
      var run = document.createElement("span");
      run.className = "note";
      run.textContent = "AI 评审进行中，完成后自动刷新…";
      wrap.appendChild(run);
    } else if (node.status === "approved") {
      var ok = document.createElement("span");
      ok.className = "note";
      ok.textContent = "该节点已由部门主管批准";
      wrap.appendChild(ok);
    } else {
      /* 执行：本部门员工或主管 */
      if (node.canExecute) {
        addBtn(node.status === "done" ? "重新执行" : "执行", "execute", false, false);
      } else {
        var tip = document.createElement("span");
        tip.className = "note";
        tip.textContent = "仅本部门员工或部门主管可执行该节点";
        wrap.appendChild(tip);
      }
      /* 批准：仅主管 */
      if (node.canApprove) {
        addBtn("批准", "approve", true, false);
      }
    }

    panel.appendChild(wrap);
  }

  /* 有节点执行中时轮询 /api/nodes，完成后停表并刷新视图 */
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
      fetch("/api/nodes").then(function (r) {
        if (r.status === 401) {
          stopPolling();
          location.href = "/login";
          return null;
        }
        return r.json();
      }).then(function (d) {
        if (!d || !d.nodes) return;
        nodes = d.nodes;
        if (detailIdx >= 0) renderActions(detailIdx);
        var running = nodes.some(function (n) { return n && n.status === "running"; });
        if (!running) stopPolling();
      }).catch(function () {
        /* 网络抖动继续等下一轮 */
      });
    }, 2000);
  }

  /* 每次悬停切换详情后重建动作区 */
  window.addEventListener("pipeline-show", function (e) {
    detailIdx = Number(e.detail);
    renderActions(detailIdx);
  });

  /* 首屏：若已有选中的节点（如刷新返回），补动作区 */
  var firstOn = cells.findIndex(function (c) { return c.classList.contains("on"); });
  if (firstOn >= 0) { detailIdx = firstOn; renderActions(firstOn); }

  /* 首屏即有执行中的节点（如刷新页面）直接开始轮询 */
  if (nodes.some(function (n) { return n && n.status === "running"; })) startPolling();
})();
