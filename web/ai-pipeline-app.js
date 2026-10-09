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
  /* 平台可选部门（来自服务端部门表注入；主管在成员管理中据此下拉分配） */
  var DEPARTMENTS = (boot.departments && boot.departments.length)
    ? boot.departments.slice()
    : ["用户研究部", "程序中台", "平台运营部"];
  /* 头像调色板：按邮箱哈希取色，前端保证同一账号颜色稳定 */
  var PALETTE = ["#ad314d", "#2aa198", "#b58900", "#6c71c4", "#cb4b16", "#859900"];

  /* 管线列表：来自服务端（每条管线相互独立、各自一套节点）；activePipelineId 为当前管线 */
  var pipelines = (boot.pipelines && boot.pipelines.length)
    ? boot.pipelines.slice()
    : [{ id: boot.pipelineId || "", name: boot.pipelineName || "text-flow" }];
  var activePipelineId = boot.pipelineId || (pipelines[0] && pipelines[0].id) || "";
  var pipelineName = boot.pipelineName || (pipelines[0] && pipelines[0].name) || "text-flow";
  var repoName = boot.repoName || "—";
  var repoGithub = boot.repoGithub || "";
  var repoPath = boot.repoPath || "";
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
    ".user-chip .rname{color:var(--ink-soft);font-weight:500;}",
    /* 执行角色：紧凑列表（小头像 + 名字），hover 弹出详情卡片 */
    ".d-roles{margin-top:12px;border-top:1px solid var(--glass-line);padding-top:10px;}",
    ".d-roles-head{font:600 12px/18px var(--font-sans);color:var(--ink-soft);margin-bottom:8px;display:flex;align-items:center;gap:6px;position:relative;}",
    ".d-roles-list{display:flex;gap:8px;flex-wrap:wrap;}",
    ".role-chip{position:relative;display:inline-flex;align-items:center;gap:6px;padding:4px 4px 4px 4px;",
    "border:1px solid var(--glass-line);border-radius:999px;background:var(--glass-fill);cursor:pointer;white-space:nowrap;}",
    ".role-chip:hover{background:var(--paper-2);}",
    ".rc-chip-avatar{width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;",
    "color:#fff;font:600 11px/1 var(--font-sans);flex:none;box-shadow:0 1px 3px rgba(20,20,20,.15);cursor:pointer;overflow:hidden;}",
    ".rc-chip-avatar img{width:100%;height:100%;object-fit:cover;border-radius:50%;}",
    ".rc-chip-name{font:500 12px/18px var(--font-sans);color:var(--ink-soft);cursor:pointer;padding-right:2px;}",
    /* 执行角色 chip 上的删除图标（主管可见） */
    ".rc-chip-del{flex:none;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;",
    "background:transparent;border:none;color:var(--muted);cursor:pointer;padding:0;font-size:12px;line-height:1;",
    "transition:background .12s ease,color .12s ease;margin-right:4px;}",
    ".rc-chip-del:hover{background:rgba(229,72,77,.14);color:#e5484d;}",
    ".rc-chip-del:disabled{opacity:.5;cursor:not-allowed;}",
    /* hover 弹出的完整长方形卡片（即时显示 + 淡入位移过渡，鼠标可移入卡片） */
    ".role-card{position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%) translateY(-4px);",
    "display:flex;flex-wrap:wrap;width:352px;padding:12px 14px;border:1px solid var(--glass-line-strong);",
    "border-radius:12px;background:var(--glass-fill);",
    "box-shadow:0 8px 24px rgba(15,23,42,.12),0 2px 6px rgba(15,23,42,.08);",
    "opacity:0;visibility:hidden;pointer-events:none;transition:opacity 120ms ease,transform 120ms ease,visibility 120ms;",
    "z-index:25;cursor:pointer;flex-direction:row;gap:0;align-items:center;}",
    ".role-card.show{opacity:1;visibility:visible;pointer-events:auto;transform:translateX(-50%) translateY(0);}",
    ".role-card.pinned{border-color:var(--led);box-shadow:0 10px 28px rgba(79,70,229,.18),0 2px 6px rgba(15,23,42,.08);}",
    ".role-card:hover{background:var(--paper-2);}",
    ".rc-del{flex:0 0 100%;margin-top:10px;padding:7px 12px;border-radius:8px;cursor:pointer;",
    "border:1px solid rgba(229,72,77,.4);background:rgba(229,72,77,.08);color:#c62a2f;",
    "font:500 12px/18px var(--font-sans);display:none;}",
    ".role-card.pinned .rc-del{display:block;}",
    ".rc-del:hover{background:rgba(229,72,77,.16);border-color:#e5484d;}",
    ".rc-del:disabled{opacity:.6;cursor:not-allowed;}",
    ".rc-avatar{width:42px;height:42px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;",
    "color:#fff;font:600 18px/1 var(--font-sans);flex:none;box-shadow:0 2px 6px rgba(15,23,42,.15);overflow:hidden;}",
    ".rc-avatar img{width:100%;height:100%;object-fit:cover;border-radius:50%;}",
    ".rc-body{display:flex;flex-direction:column;min-width:0;margin-left:12px;justify-content:center;flex:1;}",
    ".rc-name{font:700 15px/22px var(--font-sans);color:var(--ink-soft);white-space:nowrap;}",
    ".rc-sub{font:400 12px/18px var(--font-sans);color:var(--muted);white-space:nowrap;}",
    ".rc-email{font:400 11.5px/17px var(--font-mono);color:var(--led);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;}",
    ".d-roles-empty{font:400 12px/18px var(--font-sans);color:var(--muted);padding:4px 0;}",
    ".role-add-btn{margin-left:auto;width:22px;height:22px;border:1px solid var(--glass-line);border-radius:6px;",
    "background:var(--glass-fill);color:var(--ink-soft);font:600 14px/1 var(--font-sans);cursor:pointer;",
    "display:inline-flex;align-items:center;justify-content:center;transition:all 150ms ease;position:relative;}",
    ".role-add-btn:hover{background:var(--led);color:#fff;border-color:var(--led);}",
    ".role-add-btn.active{background:var(--led);color:#fff;border-color:var(--led);}",
    /* 悬浮搜索面板：浮在执行角色板块右上方 */
    ".role-search-panel{position:absolute;top:calc(100% + 6px);right:0;width:280px;",
    "border:1px solid var(--glass-line-strong);border-radius:10px;background:var(--glass-fill);",
    "padding:8px;display:none;z-index:30;box-shadow:0 8px 24px rgba(15,23,42,.14),0 2px 6px rgba(15,23,42,.08);}",
    ".role-search-panel.show{display:block;}",
    ".rsp-close{position:absolute;top:6px;right:6px;width:20px;height:20px;border:none;",
    "background:transparent;color:var(--muted);font:500 14px/1 var(--font-sans);cursor:pointer;",
    "display:inline-flex;align-items:center;justify-content:center;border-radius:4px;}",
    ".rsp-close:hover{background:var(--paper-2);color:var(--ink-soft);}",
    ".rsp-search{width:100%;padding:7px 10px;border:1px solid var(--glass-line);border-radius:8px;",
    "background:#fff;font:400 12px/18px var(--font-sans);color:var(--ink);box-sizing:border-box;margin-bottom:8px;}",
    ".rsp-search:focus{outline:none;border-color:var(--led);box-shadow:0 0 0 3px var(--led-soft);}",
    ".rsp-list{max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;}",
    ".rsp-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--glass-line);",
    "border-radius:8px;background:#fff;}",
    ".rsp-row:hover{border-color:var(--led);}",
    ".rsp-avatar{width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;",
    "color:#fff;font:600 12px/1 var(--font-sans);flex:none;box-shadow:0 1px 3px rgba(20,20,20,.15);}",
    ".rsp-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}",
    ".rsp-name{font:500 12px/18px var(--font-sans);color:var(--ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".rsp-meta{font:400 10.5px/15px var(--font-sans);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".rsp-add{padding:4px 12px;border-radius:6px;font:500 11px/18px var(--font-sans);cursor:pointer;",
    "border:1px solid var(--led-line);background:var(--led);color:#fff;white-space:nowrap;flex:none;transition:all 120ms ease;}",
    ".rsp-add:hover:not(:disabled){background:#4338ca;border-color:#4338ca;}",
    ".rsp-add:disabled{opacity:.45;cursor:not-allowed;}",
    ".rsp-empty{font:400 12px/18px var(--font-sans);color:var(--muted);text-align:center;padding:16px 0;}",
    ".rsp-error{margin-top:6px;padding:6px 10px;border-radius:6px;background:var(--block-soft);",
    "color:var(--block);font:400 11px/16px var(--font-sans);border:1px solid var(--block-line);}",
    /* 统一员工搜索面板落在悬浮框内：给关闭按钮留位 + 限制列表高度 */
    ".role-search-panel .ms-input{padding-right:26px;}",
    ".role-search-panel .ms-list{max-height:240px;}",
    /* 进度条 */
    ".d-progress{width:100%;}",
    ".d-progress .bar{height:8px;border-radius:999px;background:rgba(0,0,0,.08);overflow:hidden;}",
    ".d-progress .bar i{display:block;height:100%;border-radius:999px;background:var(--led);",
    "transition:width 600ms cubic-bezier(.22,1,.36,1);}",
    ".d-progress .lbl{font:400 11px/16px var(--font-sans);color:var(--muted);margin-top:4px;}",
    /* 提交文件区（青绿色块内） */
    ".d-files-head{font:600 12px/18px var(--font-sans);color:var(--teal);display:flex;align-items:center;gap:6px;}",
    ".d-files-head .sec-dot{width:6px;height:6px;border-radius:50%;background:var(--teal);flex:none;}",
    ".d-files .files{display:flex;flex-wrap:wrap;gap:6px;}",
    ".d-files .file{font:400 11px/16px var(--font-sans);color:var(--teal);padding:2px 10px;",
    "border:1px solid var(--teal-line);border-radius:999px;background:var(--teal-soft);}",
    /* 产物列表 */
    ".d-arts{width:100%;display:flex;flex-direction:column;gap:6px;}",
    ".d-arts-head{font:600 12px/18px var(--font-sans);color:var(--ink-soft);}",
    ".d-arts a{font:500 12px/18px var(--font-sans);color:var(--led);text-decoration:none;}",
    ".d-arts a:hover{text-decoration:underline;}",
    /* 工单引用 */
    ".d-ticket{width:100%;display:flex;align-items:center;gap:8px;padding:2px 0;}",
    ".d-ticket .lbl{font:500 12px/18px var(--font-sans);color:var(--muted);}",
    ".d-ticket a{display:inline-flex;align-items:center;padding:2px 10px;border-radius:999px;",
    "border:1px solid var(--glass-line);background:var(--glass-fill);",
    "font:500 12px/18px var(--font-mono);color:var(--led);text-decoration:none;}",
    ".d-ticket a:hover{border-color:var(--led);}",
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
    ".ai-modal .empty{font:400 12px/18px var(--font-sans);color:var(--muted);padding:8px 0 14px;}",
    /* 账号管理弹窗 */
    ".acc-panel{width:min(680px,92vw);}",
    ".acc-card{display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid var(--glass-line);border-radius:16px;background:var(--glass-fill);}",
    ".acc-avatar{width:52px;height:52px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;font:700 22px/1 var(--font-sans);flex:none;box-shadow:0 2px 8px rgba(20,20,20,.16);}",
    ".acc-id{min-width:0;}",
    ".acc-name{font:700 17px/24px var(--font-sans);color:var(--ink-soft);}",
    ".acc-meta{font:400 12px/18px var(--font-sans);color:var(--muted);margin-top:2px;}",
    ".acc-meta b{font-weight:600;color:var(--ink-soft);}",
    ".acc-sec{margin-top:18px;}",
    ".acc-sec-title{font:600 13px/20px var(--font-sans);color:var(--ink-soft);margin-bottom:10px;",
    "display:flex;align-items:center;gap:8px;}",
    ".acc-sec-title::before{content:'';width:8px;height:8px;border-radius:2px;background:var(--led);flex:none;}",
    ".acc-field{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;}",
    ".acc-input{flex:1 1 200px;padding:8px 12px;border-radius:10px;border:1px solid var(--glass-line);",
    "background:rgba(255,255,255,.7);font:400 13px/18px var(--font-sans);color:var(--copy);}",
    ".acc-select{padding:8px 10px;border-radius:10px;border:1px solid var(--glass-line);",
    "background:rgba(255,255,255,.7);font:400 13px/18px var(--font-sans);color:var(--copy);}",
    ".acc-status{font:500 12px/18px var(--font-sans);}",
    ".acc-status.ok{color:var(--teal);}",
    ".acc-status.wait{color:var(--amber);}",
    ".acc-status.off{color:var(--led);}",
    ".acc-note{font:400 11px/16px var(--font-sans);color:var(--muted-2);}",
    ".acc-member{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;",
    "border:1px solid var(--glass-line);border-radius:14px;background:var(--glass-fill);margin-bottom:10px;}",
    ".acc-member .acc-av{width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;",
    "justify-content:center;color:#fff;font:600 14px/1 var(--font-sans);flex:none;}",
    ".acc-member .acc-mid{min-width:0;flex:1 1 auto;}",
    ".acc-member .acc-mn{font:600 14px/20px var(--font-sans);color:var(--ink-soft);display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".acc-member .acc-me{font:400 11px/16px var(--font-sans);color:var(--muted);}",
    ".acc-badge{font:600 11px/16px var(--font-sans);padding:2px 10px;border-radius:999px;white-space:nowrap;}",
    ".acc-badge.staff{color:var(--copy);background:rgba(0,0,0,.06);}",
    ".acc-badge.super{color:var(--led);background:var(--led-soft);}",
    ".acc-gh{font:500 12px/18px var(--font-sans);color:var(--teal);}",
    ".acc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".acc-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;}",
    ".acc-empty{font:400 12px/18px var(--font-sans);color:var(--muted);padding:6px 0 10px;}",
    /* 账号管理内小按钮 */
    ".acc-btn{font:500 13px/18px var(--font-sans);padding:7px 14px;border:none;border-radius:10px;",
    "background:var(--teal);color:#fff;cursor:pointer;transition:opacity 150ms ease,background 150ms ease;}",
    ".acc-btn:hover:not(:disabled){opacity:.9;}",
    ".acc-btn.ghost{background:transparent;border:1px solid var(--glass-line);color:var(--copy);}",
    ".acc-btn.ghost:hover:not(:disabled){border-color:var(--teal);color:var(--teal);}",
    ".acc-btn.red{background:transparent;border:1px solid var(--led-line,rgba(173,49,77,.35));color:var(--led);}",
    ".acc-btn:disabled{opacity:.5;cursor:not-allowed;}",
    /* 需求工单：编辑按钮 + 管理弹窗 */
    ".d-ticket-edit{margin-left:auto;padding:2px 10px;border-radius:999px;cursor:pointer;",
    "border:1px solid var(--led-line);background:var(--led-soft);color:var(--led);",
    "font:500 12px/18px var(--font-sans);transition:all 120ms ease;}",
    ".d-ticket-edit:hover{background:var(--led);color:#fff;border-color:var(--led);}",
    ".tkm-panel{width:min(680px,94vw);}",
    ".tkm-tabs{display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid var(--glass-line);}",
    ".tkm-tab{appearance:none;border:none;background:transparent;cursor:pointer;padding:7px 4px;margin-bottom:-1px;",
    "border-bottom:2px solid transparent;color:var(--muted);font:500 13px/18px var(--font-sans);transition:all 120ms ease;}",
    ".tkm-tab:hover{color:var(--ink-soft);}",
    ".tkm-tab.on{color:var(--led);border-bottom-color:var(--led);}",
    ".tkm-input{width:100%;padding:8px 12px;border-radius:10px;border:1px solid var(--glass-line);",
    "background:var(--glass-fill);font:400 13px/18px var(--font-sans);color:var(--ink);box-sizing:border-box;margin-bottom:10px;}",
    ".tkm-input:focus{outline:none;border-color:var(--led);box-shadow:0 0 0 3px var(--led-soft);}",
    ".tkm-editor{margin-bottom:10px;}",
    ".tkm-textarea{width:100%;min-height:140px;padding:10px 12px;border-radius:10px;border:1px solid var(--glass-line);",
    "font:400 13px/20px var(--font-sans);box-sizing:border-box;resize:vertical;}",
    ".tkm-list{display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto;margin-bottom:10px;}",
    ".tkm-row{display:flex;flex-direction:column;gap:2px;text-align:left;padding:9px 12px;cursor:pointer;",
    "border:1px solid var(--glass-line);border-radius:10px;background:var(--glass-fill);}",
    ".tkm-row:hover:not(:disabled){border-color:var(--led);}",
    ".tkm-row:disabled{opacity:.55;cursor:not-allowed;}",
    ".tkm-row-title{font:600 13px/18px var(--font-sans);color:var(--ink-soft);}",
    ".tkm-row-meta{font:400 11px/16px var(--font-sans);color:var(--muted);}",
    ".tkm-empty{font:400 12px/18px var(--font-sans);color:var(--muted);padding:10px 0;}",
    ".tkm-status{font:400 12px/18px var(--font-sans);color:var(--muted);min-height:18px;margin-top:6px;}",
    ".tkm-status.ok{color:var(--teal);}",
    ".tkm-status.err{color:var(--block);}"
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

  /** 仓库展示名：优先用管线设置里配的 GitHub 链接（形如 /owner/repo），未配置回退本地目录名 */
  function repoLabel() {
    return repoGithub ? "/" + repoGithub : repoName;
  }

  /** 更新顶栏标题（管线名 / 仓库名 / report）与侧栏仓库名 */
  function updateTitle() {
    var ttPipeline = document.querySelector(".tt-pipeline");
    var ttRepo = document.querySelector(".tt-repo");
    var label = repoLabel();
    if (ttPipeline) ttPipeline.textContent = activePipeline;
    if (ttRepo) ttRepo.textContent = label;
    var sfRepo = document.getElementById("sidebarRepo");
    if (sfRepo) sfRepo.textContent = label;
    document.title = activePipeline + " / " + label + " · AI 管线";
  }

  /** 渲染左侧管线列表（每条管线独立，点击切换到对应管线页） */
  function renderSidebar() {
    var list = document.getElementById("pipelineList");
    if (!list) return;
    list.textContent = "";
    pipelines.forEach(function (p) {
      var isActive = p.id === activePipelineId;
      var li = document.createElement("li");
      li.className = "pipeline-item" + (isActive ? " active" : "");
      li.setAttribute("data-name", p.name);

      var span = document.createElement("span");
      span.className = "pi-name";
      span.textContent = p.name;
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
        handleRename(p);
      });
      li.appendChild(renameBtn);

      /* 点击切换到该管线（不同管线各自一套节点） */
      li.addEventListener("click", function () {
        if (isActive) return;
        location.href = "/pipeline?p=" + encodeURIComponent(p.id);
      });

      list.appendChild(li);
    });
  }

  /** 重命名管线：调用服务端 API，成功后更新本地列表 */
  function handleRename(p) {
    var newName = prompt("重命名管线：", p.name);
    if (newName === null) return;
    newName = newName.trim();
    if (!newName || newName === p.name) return;
    if (pipelines.some(function (x) { return x.name === newName; })) {
      alert("管线名已存在");
      return;
    }
    put("/api/pipelines/" + encodeURIComponent(p.id), { name: newName }).then(function (res) {
      if (!handleAuth(res)) return;
      if (res.ok) {
        p.name = newName;
        if (p.id === activePipelineId) {
          activePipeline = newName;
          pipelineName = newName;
          updateTitle();
        }
        renderSidebar();
      } else {
        alert((res.data && res.data.error) || "重命名失败");
      }
    }).catch(function () { alert("网络异常"); });
  }

  /** 新增管线：调用服务端 API（按默认模板补一套独立节点），成功后跳到新管线 */
  function handleAddPipeline() {
    var input = document.getElementById("newPipelineInput");
    if (!input) return;
    var name = input.value.trim();
    if (!name) return;
    if (pipelines.some(function (x) { return x.name === name; })) {
      alert("管线名已存在");
      return;
    }
    post("/api/pipelines", { name: name }).then(function (res) {
      if (!handleAuth(res)) return;
      if (res.ok && res.data && res.data.pipeline) {
        input.value = "";
        location.href = "/pipeline?p=" + encodeURIComponent(res.data.pipeline.id);
      } else {
        alert((res.data && res.data.error) || "新建失败");
      }
    }).catch(function () { alert("网络异常"); });
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
    /* 「管线列表」旁的齿轮：进入管线设置页（配置当前仓库的 GitHub 链接） */
    var gear = document.getElementById("pipelineSettingsBtn");
    if (gear) {
      gear.addEventListener("click", function () {
        location.href = "/account/repo";
      });
    }
  })();

  /* 顶栏：登录用户信息（头像 + 姓名/岗位）+ 退出 */
  (function renderTopbar() {
    var chip = document.querySelector(".user-chip");
    if (chip) {
      chip.textContent = "";
      var avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.setAttribute("aria-hidden", "true");
      if (user.avatar) {
        avatar.style.background = "none";
        avatar.innerHTML = '<img src="/api/avatars/' + user.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">';
      } else {
        avatar.style.background = colorOf(user.email);
        avatar.style.color = "#fff";
        avatar.style.fontWeight = "600";
        avatar.style.fontSize = "12px";
        avatar.style.display = "inline-flex";
        avatar.style.alignItems = "center";
        avatar.style.justifyContent = "center";
        avatar.textContent = (user.name || user.email).slice(0, 1);
      }
      var name = document.createElement("span");
      name.className = "rname";
      name.id = "userName";
      name.textContent = (user.name ? user.name + " · " : "") + user.title + " · " + ROLE_TEXT[user.role];
      chip.appendChild(avatar);
      chip.appendChild(name);
      chip.title = user.email;
    }
  })();

  /* ────────────────────────────── 角色卡片 ────────────────────────────── */

  /** 渲染本节点部门的执行角色：紧凑头像+名字列表，hover 弹出长方形详情卡 */
  function renderRoles(idx, panel) {
    var node = nodes[idx];
    if (!node) return;
    var old = panel.querySelector(".d-roles");
    if (old) old.remove();
    var isSuper = boot && boot.user && boot.user.role === "supervisor";
    /* 执行角色由服务端算好（部门成员 ∪ 显式添加 − 显式排除） */
    var team = (node.executorList || members.filter(function (m) { return m.department === node.department; })).slice();
    var box = document.createElement("div");
    box.className = "d-roles";
    var head = document.createElement("div");
    head.className = "d-roles-head";
    head.appendChild(document.createTextNode("执行角色"));
    if (isSuper) {
      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "role-add-btn";
      addBtn.title = "添加执行角色";
      addBtn.textContent = "+";
      addBtn.addEventListener("click", function (e) { e.stopPropagation(); toggleRoleSearcher(head, node, idx, addBtn); });
      head.appendChild(addBtn);
    }
    box.appendChild(head);
    if (!team.length) {
      var empty = document.createElement("div");
      empty.className = "d-roles-empty";
      empty.textContent = "暂无执行角色";
      box.appendChild(empty);
      panel.appendChild(box);
      return;
    }
    var list = document.createElement("div");
    list.className = "d-roles-list";
    team.forEach(function (m) {
      /* 紧凑 chip：小头像 + 名字 */
      var chip = document.createElement("span");
      chip.className = "role-chip";
      var chipAv = document.createElement("span");
      chipAv.className = "rc-chip-avatar";
      chipAv.style.background = colorOf(m.email);
      chipAv.textContent = firstChar(m);
      var chipNm = document.createElement("span");
      chipNm.className = "rc-chip-name";
      chipNm.textContent = displayName(m);
      chip.appendChild(chipAv);
      chip.appendChild(chipNm);

      /* chip 上的删除图标（主管直接可见，hover 变红，点了移除该执行角色） */
      if (isSuper) {
        var chipDel = document.createElement("button");
        chipDel.type = "button";
        chipDel.className = "rc-chip-del";
        chipDel.title = "移出执行角色：" + displayName(m);
        chipDel.textContent = "×";
        chipDel.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (!window.confirm("确定把 " + displayName(m) + " 移出本节点的执行角色？")) return;
          chipDel.disabled = true;
          fetch("/api/nodes/" + encodeURIComponent(node.id) + "/executors/" + encodeURIComponent(m.email), {
            method: "DELETE"
          }).then(function (res) {
            if (res.status === 401) { location.href = "/login"; return null; }
            return res.json().then(function (d) { return { ok: res.ok, data: d }; });
          }).then(function (r) {
            if (!r) return;
            if (!r.ok) {
              chipDel.disabled = false;
              window.alert((r.data && r.data.error) || "移除失败");
              return;
            }
            chip.remove();
            refreshNodes();
          }).catch(function () {
            chipDel.disabled = false;
            window.alert("网络异常");
          });
        });
        chip.appendChild(chipDel);
      }

      /* hover 弹出的完整长方形卡片：头像点击 → 展开移出按钮（仅主管） */
      var card = document.createElement("span");
      card.className = "role-card";
      var av = document.createElement("span");
      av.className = "rc-avatar";
      if (m.avatar) {
        av.innerHTML = '<img src="/api/avatars/' + encodeURIComponent(m.avatar) + '" alt="">';
      } else {
        av.style.background = colorOf(m.email);
        av.textContent = firstChar(m);
      }
      var body = document.createElement("span");
      body.className = "rc-body";
      var nm = document.createElement("span");
      nm.className = "rc-name";
      nm.textContent = displayName(m);
      var sub = document.createElement("span");
      sub.className = "rc-sub";
      sub.textContent = m.department + " / " + m.title;
      var em = document.createElement("span");
      em.className = "rc-email";
      em.textContent = m.email;
      body.appendChild(nm);
      body.appendChild(sub);
      body.appendChild(em);
      card.appendChild(av);
      card.appendChild(body);
      if (isSuper) {
        var del = document.createElement("button");
        del.type = "button";
        del.className = "rc-del";
        del.textContent = "移出执行角色";
        del.title = "移出后该员工不再出现在本节点的执行角色里";
        del.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (!window.confirm("确定把 " + displayName(m) + " 移出本节点的执行角色？")) return;
          del.disabled = true;
          del.textContent = "移除中…";
          fetch("/api/nodes/" + encodeURIComponent(node.id) + "/executors/" + encodeURIComponent(m.email), {
            method: "DELETE"
          }).then(function (res) {
            if (res.status === 401) { location.href = "/login"; return null; }
            return res.json().then(function (d) { return { ok: res.ok, data: d }; });
          }).then(function (r) {
            if (!r) return;
            if (!r.ok) {
              del.disabled = false;
              del.textContent = "移出执行角色";
              window.alert((r.data && r.data.error) || "移除失败");
              return;
            }
            card.classList.remove("show", "pinned");
            chip.remove();
            refreshNodes();
          }).catch(function () {
            del.disabled = false;
            del.textContent = "移出执行角色";
            window.alert("网络异常");
          });
        });
        card.appendChild(del);
      }
      chip.appendChild(card);

      /* hover 显隐：即时显示，离开 120ms 收起（鼠标可从 chip 移到 card 上不消失） */
      var hideTimer = null;
      var pinned = false;
      function showCard() {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        card.classList.add("show");
      }
      function hideCardSoon() {
        if (pinned) return;
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
          card.classList.remove("show");
          hideTimer = null;
        }, 120);
      }
      chip.addEventListener("mouseenter", showCard);
      chip.addEventListener("mouseleave", hideCardSoon);
      card.addEventListener("mouseenter", showCard);
      card.addEventListener("mouseleave", hideCardSoon);

      /* 点击头像 → 卡片侧边展开「移出执行角色」按钮（再点收起） */
      chipAv.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!isSuper) {
          goProfile(e);
          return;
        }
        pinned = !pinned;
        card.classList.toggle("pinned", pinned);
        showCard();
        if (!pinned) card.classList.remove("show");
      });

      /* 点击名字或卡片 → 跳转到个人主页 */
      function goProfile(e) {
        e.preventDefault();
        e.stopPropagation();
        var prefix = m.email.split("@")[0];
        // 记录浏览历史
        try {
          var recents = JSON.parse(localStorage.getItem("home_recent") || "[]");
          recents = recents.filter(function (r) { return r.id !== m.email; });
          recents.unshift({ _type: "user", email: m.email, name: displayName(m), department: m.department, id: m.email });
          localStorage.setItem("home_recent", JSON.stringify(recents.slice(0, 20)));
        } catch (e) {}
        window.open("/profile/" + encodeURIComponent(prefix), "_blank");
      }
      chipNm.addEventListener("click", goProfile);
      card.addEventListener("click", goProfile);
      /* 点击页面其他地方取消固定态 */
      document.addEventListener("click", function (e) {
        if (!pinned) return;
        if (chip.contains(e.target)) return;
        pinned = false;
        card.classList.remove("pinned", "show");
      });

      list.appendChild(chip);
    });
    box.appendChild(list);
    panel.appendChild(box);
  }

  /** 主管搜索员工加入节点部门（悬浮面板，依附在 + 按钮下方） */
  function toggleRoleSearcher(head, node, idx, addBtn) {
    var panel = head.querySelector(".role-search-panel");
    if (!panel) {
      panel = buildRoleSearchPanel(node, idx, addBtn);
      head.appendChild(panel);
    }
    var show = !panel.classList.contains("show");
    panel.classList.toggle("show", show);
    addBtn.classList.toggle("active", show);
    if (show) {
      var input = panel.querySelector(".ms-input");
      if (input) setTimeout(function () { input.focus(); }, 50);
    }
  }

  function buildRoleSearchPanel(node, idx, addBtn) {
    var panel = document.createElement("div");
    panel.className = "role-search-panel";

    /* 关闭按钮 */
    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "rsp-close";
    closeBtn.textContent = "×";
    closeBtn.title = "关闭";
    closeBtn.addEventListener("click", function () {
      panel.classList.remove("show");
      addBtn.classList.remove("active");
    });
    panel.appendChild(closeBtn);

    /* 错误提示 */
    var errorEl = document.createElement("div");
    errorEl.className = "rsp-error";
    errorEl.style.display = "none";
    panel.appendChild(errorEl);

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.style.display = "block";
    }
    function hideError() {
      errorEl.style.display = "none";
    }

    /* 统一员工搜索面板：与工单/知识库 @提及、团队管理同源（GET /api/search?type=user）同款 */
    var ms = window.MemberSearch.createPanel({
      placeholder: "搜索姓名 / 邮箱 / 部门 / 职位…",
      excludeDepartments: [node.department],
      actionLabel: "加入",
      emptyText: "暂无可添加的员工",
      onAction: function (mem, btn) {
        hideError();
        btn.disabled = true;
        btn.textContent = "添加中…";
        post("/api/nodes/" + encodeURIComponent(node.id) + "/executors", { email: mem.email }).then(function (res) {
          if (!handleAuth(res)) { btn.disabled = false; btn.textContent = "加入"; return; }
          if (res.ok) {
            refreshNodes();
          } else {
            btn.disabled = false;
            btn.textContent = "加入";
            showError((res.data && res.data.error) || "添加失败");
          }
        }).catch(function () {
          btn.disabled = false;
          btn.textContent = "加入";
          showError("网络异常");
        });
      }
    });
    panel.appendChild(ms.el);
    panel.ms = ms;
    return panel;
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
      fetch("/api/fs?p=" + encodeURIComponent(activePipelineId) + "&path=" + encodeURIComponent(path)).then(function (r) { return r.json(); })
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
      post("/api/fs/mkdir?p=" + encodeURIComponent(activePipelineId), { path: cur || ".", name: name }).then(function (res) {
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

  /* ────────────────────────────── 需求工单管理 ────────────────────────────── */

  /** HTML 富文本 → 纯文本（无富文本编辑器时的退化输入） */
  function htmlToPlain(html) {
    var d = document.createElement("div");
    d.innerHTML = html || "";
    return d.textContent || "";
  }

  /** 纯文本 → 转义后的 HTML（换行转 <br>），供无富文本编辑器时落库 */
  function plainToHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }

  /** 节点需求工单管理弹窗：编辑当前挂单 / 选择已有工单挂载 / 新建工单（主管 + 本部门员工） */
  function openTicketManager(node) {
    var m = openModal();
    m.panel.classList.add("tkm-panel");

    var h = document.createElement("h3");
    h.textContent = "需求工单";
    var sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = "节点「" + node.step + "」的需求工单：可编辑当前工单、选择已有工单挂载，或新建工单。";
    m.panel.appendChild(h);
    m.panel.appendChild(sub);

    var tabs = document.createElement("div");
    tabs.className = "tkm-tabs";
    var body = document.createElement("div");
    body.className = "tkm-body";
    m.panel.appendChild(tabs);
    m.panel.appendChild(body);

    var TABS = [
      { id: "edit", label: "编辑当前工单" },
      { id: "link", label: "选择已有工单" },
      { id: "create", label: "新建工单" }
    ];
    var active = "edit";

    function statusEl(host) {
      var s = document.createElement("div");
      s.className = "tkm-status";
      host.appendChild(s);
      return s;
    }

    function setStatus(el, text, cls) {
      el.textContent = text;
      el.className = "tkm-status" + (cls ? " " + cls : "");
    }

    /** 标题输入 + 富文本正文（优先 RichEditor，缺省退化 textarea） */
    function buildEditor(host, title, content) {
      var titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.className = "tkm-input";
      titleInput.placeholder = "工单标题";
      titleInput.value = title || "";
      host.appendChild(titleInput);

      var bodyHost = document.createElement("div");
      bodyHost.className = "tkm-editor";
      host.appendChild(bodyHost);

      var ed;
      if (window.RichEditor && window.RichEditor.make) {
        ed = window.RichEditor.make(bodyHost, { placeholder: "填写需求内容…支持 @提及成员 / 图片 / 标题" });
        ed.setHtml(content || "");
      } else {
        var ta = document.createElement("textarea");
        ta.className = "tkm-textarea";
        ta.placeholder = "填写需求内容…";
        ta.value = htmlToPlain(content);
        bodyHost.appendChild(ta);
        ed = { getHtml: function () { return plainToHtml(ta.value); } };
      }
      return { titleInput: titleInput, editor: ed };
    }

    function renderTabs() {
      tabs.textContent = "";
      TABS.forEach(function (t) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "tkm-tab" + (t.id === active ? " on" : "");
        b.textContent = t.label;
        b.addEventListener("click", function () { active = t.id; renderTabs(); renderBody(); });
        tabs.appendChild(b);
      });
    }

    function renderBody() {
      body.textContent = "";
      if (active === "edit") renderEdit();
      else if (active === "link") renderLink();
      else renderCreate();
    }

    /* 编辑当前工单：拉当前挂单 → 回填 → 保存 */
    function renderEdit() {
      var loading = document.createElement("div");
      loading.className = "tkm-empty";
      loading.textContent = "加载中…";
      body.appendChild(loading);
      request("GET", "/api/nodes/" + encodeURIComponent(node.id) + "/ticket").then(function (res) {
        if (!handleAuth(res)) return;
        if (!res.ok) { loading.textContent = (res.data && res.data.error) || "读取失败"; return; }
        var t = res.data && res.data.ticket;
        if (!t) { loading.textContent = "该节点尚未挂需求工单"; return; }
        body.textContent = "";
        var built = buildEditor(body, t.title, t.content);
        var st = statusEl(body);
        var foot = document.createElement("div");
        foot.className = "foot";
        var save = document.createElement("button");
        save.type = "button";
        save.className = "btn";
        save.textContent = "保存修改";
        save.addEventListener("click", function () {
          var title = (built.titleInput.value || "").trim();
          if (!title) { setStatus(st, "标题不能为空", "err"); return; }
          save.disabled = true;
          setStatus(st, "保存中…");
          put("/api/nodes/" + encodeURIComponent(node.id) + "/ticket", {
            title: title,
            content: built.editor.getHtml(),
          }).then(function (r) {
            save.disabled = false;
            if (!handleAuth(r)) return;
            if (r.ok) { setStatus(st, "已保存", "ok"); refreshNodes(); }
            else setStatus(st, (r.data && r.data.error) || "保存失败", "err");
          }).catch(function () { save.disabled = false; setStatus(st, "网络异常", "err"); });
        });
        foot.appendChild(save);
        body.appendChild(foot);
      }).catch(function () { loading.textContent = "网络异常"; });
    }

    /* 选择已有工单：搜索候选 → 点击挂载（替换式） */
    function renderLink() {
      var search = document.createElement("input");
      search.type = "text";
      search.className = "tkm-input";
      search.placeholder = "搜索工单标题 / 提交人…";
      body.appendChild(search);
      var list = document.createElement("div");
      list.className = "tkm-list";
      body.appendChild(list);
      var st = statusEl(body);

      function load(q) {
        list.textContent = "";
        var empty = document.createElement("div");
        empty.className = "tkm-empty";
        empty.textContent = "加载中…";
        list.appendChild(empty);
        request("GET", "/api/nodes/" + encodeURIComponent(node.id) + "/ticket/candidates?q=" + encodeURIComponent(q || "")).then(function (res) {
          if (!handleAuth(res)) return;
          list.textContent = "";
          if (!res.ok) { empty.textContent = (res.data && res.data.error) || "读取失败"; list.appendChild(empty); return; }
          var rows = (res.data && res.data.tickets) || [];
          if (!rows.length) {
            empty.textContent = q ? "未找到匹配的工单" : "暂无可挂载的工单";
            list.appendChild(empty);
            return;
          }
          rows.forEach(function (t) {
            var row = document.createElement("button");
            row.type = "button";
            row.className = "tkm-row";
            var title = document.createElement("span");
            title.className = "tkm-row-title";
            title.textContent = t.title;
            var meta = document.createElement("span");
            meta.className = "tkm-row-meta";
            meta.textContent = [t.authorName, t.department].filter(Boolean).join(" · ") || "—";
            row.appendChild(title);
            row.appendChild(meta);
            row.addEventListener("click", function () {
              row.disabled = true;
              setStatus(st, "挂载中…");
              post("/api/nodes/" + encodeURIComponent(node.id) + "/ticket/link", { ticketId: t.id }).then(function (r) {
                if (!handleAuth(r)) return;
                if (r.ok) {
                  setStatus(st, "已挂载：" + t.title, "ok");
                  refreshNodes();
                  load(search.value.trim());
                } else {
                  row.disabled = false;
                  setStatus(st, (r.data && r.data.error) || "挂载失败", "err");
                }
              }).catch(function () { row.disabled = false; setStatus(st, "网络异常", "err"); });
            });
            list.appendChild(row);
          });
        }).catch(function () { list.textContent = ""; empty.textContent = "网络异常"; list.appendChild(empty); });
      }

      var timer = null;
      search.addEventListener("input", function () {
        clearTimeout(timer);
        timer = setTimeout(function () { load(search.value.trim()); }, 250);
      });
      load("");
    }

    /* 新建工单：填标题 + 正文 → 新建并挂载 */
    function renderCreate() {
      var built = buildEditor(body, "", "");
      var st = statusEl(body);
      var foot = document.createElement("div");
      foot.className = "foot";
      var create = document.createElement("button");
      create.type = "button";
      create.className = "btn";
      create.textContent = "新建并挂载";
      create.addEventListener("click", function () {
        var title = (built.titleInput.value || "").trim();
        if (!title) { setStatus(st, "标题不能为空", "err"); return; }
        create.disabled = true;
        setStatus(st, "创建中…");
        post("/api/nodes/" + encodeURIComponent(node.id) + "/ticket", {
          title: title,
          content: built.editor.getHtml(),
        }).then(function (r) {
          create.disabled = false;
          if (!handleAuth(r)) return;
          if (r.ok) { setStatus(st, "已新建并挂载", "ok"); refreshNodes(); }
          else setStatus(st, (r.data && r.data.error) || "创建失败", "err");
        }).catch(function () { create.disabled = false; setStatus(st, "网络异常", "err"); });
      });
      foot.appendChild(create);
      body.appendChild(foot);
    }

    renderTabs();
    renderBody();
  }

  /* ────────────────────────────── 账号管理 ────────────────────────────── */

  /** 账号管理弹窗：我的资料 + GitHub 绑定（员工待主管审核）；主管额外提供成员管理 + 绑定审核 */
  function openAccountManager() {
    var m = openModal();
    m.panel.classList.add("acc-panel");
    var isSuper = user.role === "supervisor";

    var h = document.createElement("h3");
    h.textContent = "账号管理";
    m.panel.appendChild(h);
    var sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = isSuper
      ? "管理自己的 GitHub 绑定，并可设置成员的姓名 / 部门 / 职位、审核成员的 GitHub 绑定。"
      : "绑定自己的 GitHub 账号，或管理已绑定的信息。员工提交的绑定需主管审核后生效。";
    m.panel.appendChild(sub);
    var body = document.createElement("div");
    m.panel.appendChild(body);

    function sec(title) {
      var s = document.createElement("div");
      s.className = "acc-sec";
      var t = document.createElement("div");
      t.className = "acc-sec-title";
      t.textContent = title;
      s.appendChild(t);
      body.appendChild(s);
      return s;
    }

    function githubState(u) {
      if (u.github) return { txt: "已绑定 @" + u.github, cls: "ok" };
      if (u.githubPending) return { txt: "待主管审核 @" + u.githubPending, cls: "wait" };
      return { txt: "未绑定", cls: "off" };
    }

    /** 我的资料 + GitHub 绑定区 */
    function renderMine(u) {
      var s = sec("我的资料");
      var card = document.createElement("div");
      card.className = "acc-card";
      var av = document.createElement("span");
      av.className = "acc-avatar";
      av.style.background = colorOf(u.email);
      av.textContent = (u.name || u.email).slice(0, 1);
      card.appendChild(av);
      var id = document.createElement("div");
      id.className = "acc-id";
      var nm = document.createElement("div");
      nm.className = "acc-name";
      nm.textContent = (u.name || u.email.split("@")[0]) + (u.role === "supervisor" ? "（主管）" : "（员工）");
      var meta = document.createElement("div");
      meta.className = "acc-meta";
      var info = document.createElement("span");
      info.textContent = u.department + " / " + u.title + " · " + u.email;
      meta.appendChild(info);
      id.appendChild(nm);
      id.appendChild(meta);
      card.appendChild(id);
      s.appendChild(card);

      var gs = sec("GitHub 绑定");
      var st = githubState(u);
      var status = document.createElement("div");
      status.className = "acc-status " + st.cls;
      status.textContent = st.txt;
      gs.appendChild(status);
      var note = document.createElement("div");
      note.className = "acc-note";
      note.textContent = isSuper
        ? "主管绑定即刻生效；如需更换请先解绑。"
        : "员工绑定需主管审核：提交后进入「待审核」，被批准后才正式生效。";
      gs.appendChild(note);

      var field = document.createElement("div");
      field.className = "acc-field";
      var input = document.createElement("input");
      input.className = "acc-input";
      input.placeholder = "GitHub 用户名（如 octocat）";
      input.value = u.githubPending || u.github || "";
      field.appendChild(input);
      var bind = document.createElement("button");
      bind.type = "button";
      bind.className = "acc-btn";
      bind.textContent = isSuper ? "绑定" : "提交绑定";
      bind.addEventListener("click", function () {
        bind.disabled = true;
        post("/api/account/github/bind", { github: input.value }).then(function (res) {
          bind.disabled = false;
          if (!handleAuth(res)) return;
          if (res.ok) { alert(res.pending ? "已提交绑定，等待主管审核。" : "绑定成功。"); load(); }
          else alert((res.data && res.data.error) || "绑定失败");
        }).catch(function () { bind.disabled = false; alert("网络异常"); });
      });
      field.appendChild(bind);
      if (u.github) {
        var unbind = document.createElement("button");
        unbind.type = "button";
        unbind.className = "acc-btn red";
        unbind.textContent = "解绑";
        unbind.addEventListener("click", function () {
          post("/api/account/github/unbind").then(function (res) {
            if (!handleAuth(res)) return;
            if (res.ok) { alert("已解绑 @" + u.github); load(); }
            else alert((res.data && res.data.error) || "解绑失败");
          });
        });
        field.appendChild(unbind);
      }
      if (u.githubPending) {
        var cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "acc-btn red";
        cancel.textContent = "取消申请";
        cancel.addEventListener("click", function () {
          post("/api/account/github/cancel").then(function (res) {
            if (!handleAuth(res)) return;
            if (res.ok) { alert("已取消绑定申请。"); load(); }
            else alert((res.data && res.data.error) || "取消失败");
          });
        });
        field.appendChild(cancel);
      }
      gs.appendChild(field);
    }

    /** 主管专属：成员 GitHub 绑定审核区 */
    function renderPending(members) {
      var pend = members.filter(function (x) { return x.githubPending; });
      var s = sec("GitHub 绑定审核");
      if (!pend.length) {
        var e = document.createElement("div");
        e.className = "acc-empty";
        e.textContent = "暂无待审核的绑定申请。";
        s.appendChild(e);
        return;
      }
      pend.forEach(function (x) {
        var row = document.createElement("div");
        row.className = "acc-member";
        var av = document.createElement("span");
        av.className = "acc-av";
        av.style.background = colorOf(x.email);
        av.textContent = (x.name || x.email).slice(0, 1);
        row.appendChild(av);
        var mid = document.createElement("div");
        mid.className = "acc-mid";
        var mn = document.createElement("div");
        mn.className = "acc-mn";
        mn.textContent = (x.name || x.email.split("@")[0]) + " 申请绑定";
        var gh = document.createElement("div");
        gh.className = "acc-gh";
        gh.textContent = "@" + x.githubPending;
        mid.appendChild(mn);
        mid.appendChild(gh);
        row.appendChild(mid);
        var aBtn = document.createElement("button");
        aBtn.type = "button";
        aBtn.className = "acc-btn";
        aBtn.textContent = "批准";
        aBtn.addEventListener("click", function () {
          post("/api/account/" + x.email + "/github/approve").then(function (res) {
            if (!handleAuth(res)) return;
            if (res.ok) { alert("已批准 @" + x.githubPending + " 绑定。" + (x.name || x.email)); load(); }
            else alert((res.data && res.data.error) || "操作失败");
          });
        });
        row.appendChild(aBtn);
        var rBtn = document.createElement("button");
        rBtn.type = "button";
        rBtn.className = "acc-btn red";
        rBtn.textContent = "驳回";
        rBtn.addEventListener("click", function () {
          post("/api/account/" + x.email + "/github/reject").then(function (res) {
            if (!handleAuth(res)) return;
            if (res.ok) { alert("已驳回 @" + x.githubPending + " 的绑定申请。"); load(); }
            else alert((res.data && res.data.error) || "操作失败");
          });
        });
        row.appendChild(rBtn);
        s.appendChild(row);
      });
    }

    /** 主管专属：成员资料管理（姓名 / 部门 / 职位） */
    function renderManage(members) {
      var s = sec("成员管理（姓名 / 部门 / 职位）");
      members.forEach(function (x) {
        var row = document.createElement("div");
        row.className = "acc-member";
        var av = document.createElement("span");
        av.className = "acc-av";
        av.style.background = colorOf(x.email);
        av.textContent = (x.name || x.email).slice(0, 1);
        row.appendChild(av);
        var mid = document.createElement("div");
        mid.className = "acc-mid";
        var mn = document.createElement("div");
        mn.className = "acc-mn";
        mn.textContent = x.email + "　";
        if (x.role === "supervisor") {
          var bd = document.createElement("span");
          bd.className = "acc-badge super";
          bd.textContent = "主管";
          mn.appendChild(bd);
        } else {
          var bd2 = document.createElement("span");
          bd2.className = "acc-badge staff";
          bd2.textContent = "员工";
          mn.appendChild(bd2);
        }
        var edit = document.createElement("div");
        edit.className = "acc-row";
        edit.style.marginTop = "6px";
        var nIn = document.createElement("input");
        nIn.className = "acc-input";
        nIn.style.flex = "1 1 110px";
        nIn.value = x.name || x.email.split("@")[0];
        nIn.placeholder = "姓名";
        var dSel = document.createElement("select");
        dSel.className = "acc-select";
        DEPARTMENTS.forEach(function (d) {
          var o = document.createElement("option");
          o.value = d;
          o.textContent = d;
          if (d === x.department) o.selected = true;
          dSel.appendChild(o);
        });
        if (DEPARTMENTS.indexOf(x.department) < 0) {
          var extra = document.createElement("option");
          extra.value = x.department;
          extra.textContent = x.department;
          extra.selected = true;
          dSel.appendChild(extra);
        }
        var tIn = document.createElement("input");
        tIn.className = "acc-input";
        tIn.style.flex = "1 1 120px";
        tIn.value = x.title;
        tIn.placeholder = "职位";
        var save = document.createElement("button");
        save.type = "button";
        save.className = "acc-btn ghost";
        save.textContent = "保存";
        save.addEventListener("click", function () {
          save.disabled = true;
          post("/api/account/" + x.email + "/profile", {
            name: nIn.value,
            department: dSel.value,
            title: tIn.value,
          }).then(function (res) {
            save.disabled = false;
            if (!handleAuth(res)) return;
            if (res.ok) { alert("已保存 " + (x.name || x.email) + " 的资料。"); load(); refreshNodes(); }
            else alert((res.data && res.data.error) || "保存失败");
          }).catch(function () { save.disabled = false; alert("网络异常"); });
        });
        edit.appendChild(nIn);
        edit.appendChild(dSel);
        edit.appendChild(tIn);
        edit.appendChild(save);
        mid.appendChild(mn);
        mid.appendChild(edit);
        row.appendChild(mid);
        s.appendChild(row);
      });
    }

    function renderAll(data) {
      body.textContent = "";
      renderMine(data.user);
      if (isSuper) {
        var members = data.members || [];
        renderPending(members);
        renderManage(members);
      }
    }

    function load() {
      body.textContent = "";
      var loading = document.createElement("div");
      loading.className = "acc-empty";
      loading.textContent = "加载中…";
      body.appendChild(loading);
      fetch("/api/account").then(function (r) {
        if (r.status === 401) { location.href = "/login"; return null; }
        return r.json();
      }).then(function (d) {
        if (!d) return;
        renderAll(d);
      }).catch(function () {
        body.textContent = "";
        var e = document.createElement("div");
        e.className = "acc-empty";
        e.textContent = "加载失败，请重试";
        body.appendChild(e);
      });
    }

    load();
  }

  /* ────────────────────────────── 详情动作区 ────────────────────────────── */

  function isSkillNode(node) {
    return !!node.runner && node.runner.indexOf("skill:") === 0;
  }

  /* 节点 01 产品调研：调外部调研 agent，产物为其 output 目录打包的 zip */
  function isCrawlerNode(node) {
    return node.runner === "research-crawler";
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

    /* 需求工单：每个节点必挂一张，可跳转工单系统；有编辑权限时可编辑 / 换单 / 新建 */
    var tkRow = document.createElement("div");
    tkRow.className = "d-ticket";
    var tkLbl = document.createElement("span");
    tkLbl.className = "lbl";
    tkLbl.textContent = "需求工单";
    tkRow.appendChild(tkLbl);
    if (node.ticketId) {
      var tkLink = document.createElement("a");
      tkLink.href = "/tickets?id=" + encodeURIComponent(node.ticketId);
      tkLink.target = "_blank";
      tkLink.rel = "noopener";
      tkLink.textContent = node.ticketId;
      tkLink.title = "打开该节点的需求工单";
      tkRow.appendChild(tkLink);
    }
    if (node.canEdit) {
      var tkEdit = document.createElement("button");
      tkEdit.type = "button";
      tkEdit.className = "d-ticket-edit";
      tkEdit.textContent = "编辑";
      tkEdit.title = "编辑当前工单 / 选择已有工单 / 新建工单";
      tkEdit.addEventListener("click", function (e) {
        e.stopPropagation();
        openTicketManager(node);
      });
      tkRow.appendChild(tkEdit);
    }
    wrap.appendChild(tkRow);

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

    /* 评审记录入口（runner=ai-review）：跳转当前仓库的评审记录页，展示该仓库全部评审报告 */
    if (node.runner === "ai-review") {
      var link = document.createElement("a");
      link.className = "btn";
      link.href = "/reviews?p=" + encodeURIComponent(activePipelineId);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "查看评审记录";
      var rowR = document.createElement("div");
      rowR.className = "d-row";
      rowR.appendChild(link);
      wrap.appendChild(rowR);
    }

    /* 提交文件区（所有节点通用） */
    renderFileSection(node, idx, wrap);

    /* 动作按钮行 */
    var rowBtn = document.createElement("div");
    rowBtn.className = "d-row";
    renderButtons(node, idx, rowBtn);
    wrap.appendChild(rowBtn);

    panel.appendChild(wrap);
  }

  /** 提交文件区（青绿区，所有节点通用） */
  function renderFileSection(node, idx, wrap) {
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

    if (node.canExecute) {
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

    if (!node.ready || !node.runner) {
      var note = document.createElement("span");
      note.className = "note";
      note.textContent = "该环节能力待接入，暂不可操作";
      wrap.appendChild(note);
      return;
    }

    if (!node.canExecute) {
      var tipNote = document.createElement("span");
      tipNote.className = "note";
      tipNote.textContent = "仅本部门员工或部门主管可操作该节点";
      wrap.appendChild(tipNote);
      return;
    }

    /* 主管审核入口：在任意非 done 状态下均可审核 */
    if (node.canApprove) {
      var hasFiles = (node.uploads && node.uploads.length > 0);
      if (!hasFiles) {
        var noFileNote = document.createElement("span");
        noFileNote.className = "note";
        noFileNote.textContent = "员工尚未提交文件，无法审核";
        wrap.appendChild(noFileNote);
        return;
      }
      addBtn("审核通过", false, function () {
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
      return;
    }

    if (node.status === "done") {
      var doneNote = document.createElement("span");
      doneNote.className = "note";
      doneNote.textContent = "该节点已验收通过";
      wrap.appendChild(doneNote);
      return;
    }

    /* todo / running：提交验收 */
    var isRunning = node.status === "running";
    var inFlight = busyIds.indexOf(node.id) >= 0;

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

  /** 拉取 /api/nodes 刷新本地状态（含 busy 列表、成员、管线名与仓库信息） */
  function refreshNodes() {
    return fetch("/api/nodes?p=" + encodeURIComponent(activePipelineId)).then(function (r) {
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
        var cur = pipelines.filter(function (x) { return x.id === activePipelineId; })[0];
        if (cur) cur.name = pipelineName;
        activePipeline = pipelineName;
        updateTitle();
        renderSidebar();
      }
      /* 同步仓库信息（管线可能被改绑仓库） */
      var repoChanged = false;
      if (typeof d.repoName === "string" && d.repoName !== repoName) { repoName = d.repoName; repoChanged = true; }
      if (typeof d.repoGithub === "string" && d.repoGithub !== repoGithub) { repoGithub = d.repoGithub; repoChanged = true; }
      if (typeof d.repoPath === "string" && d.repoPath !== repoPath) { repoPath = d.repoPath; repoChanged = true; }
      if (repoChanged) updateTitle();
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
