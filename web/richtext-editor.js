/* richtext-editor.js · 工单 / 知识库共用的富文本编辑器（零依赖）
   基于 contenteditable + execCommand，补几项 Word 常用能力：
   - 字号：下拉选择 → 落成 span[style=font-size:Npx]（修复此前选区不生效/样式被净化丢弃的问题）
   - 图片：点击选中 → 悬浮工具条设置尺寸（25/50/75/100% 或自定义 px）与文字环绕（左/右/居中/无）
   - 图片：右下角手柄拖拽直接缩放
   - @提及：输入 @ 弹出成员候选，插入带 data-email 的链接（渲染端升级为「头像 + 名字」）
   - 知识库：插入知识库卡片引用（由调用方通过 opts.onPickKnowledge 提供选择弹层）
   - Markdown 识别：行首 `# `~`#### ` 即时转标题（带字号）；整行图片链接 / `![alt](url)` 转图片；
     粘贴 Markdown 文本自动转 HTML（标题 / 图片 / 列表 / 引用 / 粗斜体 / 行内代码 / 链接）；
     保存前再兜底扫一遍。外链图片由服务端在落库时转存本地，前端只管插 <img>。
   用法：var ed = window.RichEditor.make(hostEl, { placeholder, onPickKnowledge }); */
window.RichEditor = (function () {
  "use strict";

  var SIZE_OPTIONS = [12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40];

  /* ────────────── Markdown 轻量识别 ────────────── */

  /** 标题层级 → 字号（px）：同时写进 style，读页面不依赖额外 CSS 也能看到大小 */
  var MD_HEAD_SIZE = { 1: 24, 2: 20, 3: 17, 4: 15 };
  /** 行首 1~4 个 # + 空格 = 标题 */
  var MD_HEAD_RE = /^(#{1,4})\s+(.+)$/;
  /** 整行就是一个 Markdown 图片 */
  var MD_IMG_RE = /^!\[([^\]]*)\]\(\s*([^\s()]+)\s*\)$/;
  /** 整行就是一个图片直链 */
  var MD_IMG_URL_RE = /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp)(?:\?\S*)?$/i;
  /** 行首标记（转标题时剥掉；快捷输入时行尾还没打空格，所以空格可有可无） */
  var MD_MARK_RE = /^\s*#{1,4}\s*/;

  function mdEsc(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  /** 原始值 → 属性值（转义 + 转义引号） */
  function mdAttr(t) {
    return mdEsc(t).replace(/"/g, "&quot;");
  }
  /** 已转义文本 → 属性值（只补引号转义，避免二次转义 &） */
  function mdQuote(t) {
    return String(t).replace(/"/g, "&quot;");
  }

  /** 行内 Markdown → HTML：先整体转义，再按规则替换，属性值单独转义防注入 */
  function mdInline(t) {
    var s = mdEsc(t);
    s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g, function (_, alt, src) {
      return '<img src="' + mdQuote(src) + '" alt="' + mdQuote(alt) + '" style="max-width: 100%;">';
    });
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g, function (_, txt, href) {
      return '<a href="' + mdQuote(href) + '">' + txt + "</a>";
    });
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
    s = s.replace(/__([^_\n]+)__/g, "<b>$1</b>");
    // 斜体要求开标记后紧跟非空白、闭标记后不接 *，避免把 "2 * 3 * 4" 这类算式吃掉
    s = s.replace(/\*([^\s*][^*\n]*?)\*(?!\*)/g, "<i>$1</i>");
    s = s.replace(/(^|[^\w_])_([^\s_][^_\n]*?)_(?![\w_])/g, "$1<i>$2</i>");
    s = s.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
    return s;
  }

  /** 把一行按 | 分割成单元格（去掉首尾空段） */
  function splitTableRow(line) {
    var s = line.replace(/^\s*\||\|\s*$/g, "").trim();
    if (!s) return [];
    return s.split("|").map(function (c) { return c.trim(); });
  }

  /** 判断某行是否是表格分隔行（| --- | --- | 形态，允许 : 对齐标记） */
  function isTableSep(line) {
    if (line.indexOf("|") === -1) return false;
    var cells = splitTableRow(line);
    if (!cells.length) return false;
    return cells.every(function (c) {
      return /^:?-{2,}:?$/.test(c);
    });
  }

  /** 渲染一个表格段（已含表头行 + 分隔行 + 若干数据行） */
  function renderTable(headerCells, bodyRows) {
    var head = "<tr>" + headerCells.map(function (c) {
      return "<th>" + mdInline(c) + "</th>";
    }).join("") + "</tr>";
    var body = bodyRows.map(function (row) {
      return "<tr>" + row.map(function (c) {
        return "<td>" + mdInline(c) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return '<table style="border-collapse: collapse; width: 100%; margin: 8px 0;">' +
      "<thead>" + head + "</thead><tbody>" + body + "</tbody></table>";
  }

  /** 整段文本按行做轻量 Markdown → HTML（用于粘贴） */
  function mdToHtml(text) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    var out = [];
    var listTag = null;
    var inQuote = false;
    var i = 0;
    function closeList() {
      if (listTag) { out.push("</" + listTag + ">"); listTag = null; }
    }
    function closeQuote() {
      if (inQuote) { out.push("</blockquote>"); inQuote = false; }
    }
    while (i < lines.length) {
      var raw = lines[i];
      var t = raw.replace(/\s+$/, "").trim();
      if (!t) { closeList(); closeQuote(); i++; continue; }

      // 代码块：``` 开头（可选语言），遇到下一个 ``` 结束
      var fm = t.match(/^```(\w*)\s*$/);
      if (fm) {
        closeList(); closeQuote();
        var lang = fm[1] || "";
        i++;
        var codeLines = [];
        while (i < lines.length) {
          var cl = lines[i].replace(/\s+$/, "");
          if (/^```\s*$/.test(cl.trim())) { i++; break; }
          codeLines.push(cl);
          i++;
        }
        var codeHtml = mdEsc(codeLines.join("\n"));
        var preClass = lang ? ' class="lang-' + lang + '"' : "";
        out.push('<pre' + preClass + '><code>' + codeHtml + "</code></pre>");
        continue;
      }

      // 表格：当前行含 | 且下一行是分隔行 → 连续收集数据行
      if (t.indexOf("|") !== -1 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        closeList(); closeQuote();
        var headerCells = splitTableRow(t);
        i += 2; // 跳过表头 + 分隔行
        var bodyRows = [];
        while (i < lines.length) {
          var nxt = lines[i].replace(/\s+$/, "").trim();
          if (!nxt || nxt.indexOf("|") === -1) break;
          bodyRows.push(splitTableRow(nxt));
          i++;
        }
        if (headerCells.length) out.push(renderTable(headerCells, bodyRows));
        continue;
      }

      var hm = t.match(MD_HEAD_RE);
      if (hm) {
        closeList(); closeQuote();
        var lv = hm[1].length;
        out.push('<h' + lv + ' style="font-size: ' + MD_HEAD_SIZE[lv] + 'px; font-weight: 700;">' +
          mdInline(hm[2]) + "</h" + lv + ">");
        i++; continue;
      }
      var um = t.match(/^[-*+]\s+(.+)$/);
      var om = t.match(/^\d+[.)]\s+(.+)$/);
      if (um || om) {
        closeQuote();
        var want = um ? "ul" : "ol";
        if (listTag !== want) { closeList(); out.push("<" + want + ">"); listTag = want; }
        out.push("<li>" + mdInline((um || om)[1]) + "</li>");
        i++; continue;
      }
      var qm = t.match(/^>\s?(.*)$/);
      if (qm) {
        closeList();
        if (!inQuote) { out.push("<blockquote>"); inQuote = true; }
        out.push("<div>" + mdInline(qm[1]) + "</div>");
        i++; continue;
      }
      closeList(); closeQuote();
      var im = t.match(MD_IMG_RE);
      if (im) {
        out.push('<img src="' + mdAttr(im[2]) + '" alt="' + mdAttr(im[1]) + '" style="max-width: 100%;">');
        i++; continue;
      }
      if (MD_IMG_URL_RE.test(t)) {
        out.push('<img src="' + mdAttr(t) + '" alt="" style="max-width: 100%;">');
        i++; continue;
      }
      out.push("<p>" + mdInline(t) + "</p>");
      i++;
    }
    closeList(); closeQuote();
    return out.join("");
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

  function profileUrl(email) {
    return "/profile/" + encodeURIComponent(email ? email.split("@")[0] : "");
  }

  /** style 串 → 对象 */
  function parseStyle(s) {
    var out = {};
    String(s || "").split(";").forEach(function (decl) {
      var i = decl.indexOf(":");
      if (i < 0) return;
      var k = decl.slice(0, i).trim().toLowerCase();
      var v = decl.slice(i + 1).trim();
      if (k && v) out[k] = v;
    });
    return out;
  }

  /** 对象 → style 串 */
  function buildStyle(o) {
    return Object.keys(o).map(function (k) { return k + ": " + o[k]; }).join("; ");
  }

  /** 改写元素上的单个样式属性（空值 = 删除该属性） */
  function setStyle(el, prop, val) {
    var st = parseStyle(el.getAttribute("style") || "");
    if (val) st[prop] = val;
    else delete st[prop];
    var out = buildStyle(st);
    if (out) el.setAttribute("style", out);
    else el.removeAttribute("style");
  }

  function toolbarHtml(opts) {
    var sizes = SIZE_OPTIONS.map(function (px) {
      return '<option value="' + px + '">' + px + "px</option>";
    }).join("");
    return (
      '<div class="rt-bar">' +
      '<select class="rt-size" title="字号"><option value="">字号</option>' + sizes + "</select>" +
      '<button type="button" class="rt-btn" data-cmd="bold" title="加粗"><b>B</b></button>' +
      '<button type="button" class="rt-btn" data-cmd="italic" title="斜体"><i>I</i></button>' +
      '<button type="button" class="rt-btn" data-cmd="underline" title="下划线"><u>U</u></button>' +
      '<button type="button" class="rt-btn" data-cmd="strikeThrough" title="删除线"><s>S</s></button>' +
      '<span class="rt-sep"></span>' +
      '<button type="button" class="rt-btn" data-align="left" title="左对齐">左</button>' +
      '<button type="button" class="rt-btn" data-align="center" title="居中">中</button>' +
      '<button type="button" class="rt-btn" data-align="right" title="右对齐">右</button>' +
      '<span class="rt-sep"></span>' +
      '<button type="button" class="rt-btn" data-cmd="insertUnorderedList" title="无序列表">• 列表</button>' +
      '<button type="button" class="rt-btn" data-cmd="insertOrderedList" title="有序列表">1. 列表</button>' +
      '<button type="button" class="rt-btn" data-block="blockquote" title="引用">引用</button>' +
      '<span class="rt-sep"></span>' +
      '<button type="button" class="rt-btn" data-action="image" title="插入图片">图片</button>' +
      '<button type="button" class="rt-btn" data-action="mention" title="提及成员">@提及</button>' +
      (opts.onPickKnowledge ? '<button type="button" class="rt-btn" data-action="kb" title="引用知识库">知识库</button>' : "") +
      '<button type="button" class="rt-btn" data-cmd="removeFormat" title="清除格式">清格式</button>' +
      "</div>" +
      '<div class="rt-body" contenteditable="true"></div>' +
      '<input type="file" class="rt-file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>' +
      '<div class="rt-imgbar" hidden>' +
      '<span class="rt-imgbar-label">图片</span>' +
      '<button type="button" class="rt-btn" data-size="25%">25%</button>' +
      '<button type="button" class="rt-btn" data-size="50%">50%</button>' +
      '<button type="button" class="rt-btn" data-size="75%">75%</button>' +
      '<button type="button" class="rt-btn" data-size="100%">100%</button>' +
      '<input type="number" class="rt-imgw" min="40" max="1200" step="10" placeholder="宽 px" title="自定义宽度（像素）">' +
      '<span class="rt-sep"></span>' +
      '<button type="button" class="rt-btn" data-wrap="left" title="文字在右侧环绕">左环绕</button>' +
      '<button type="button" class="rt-btn" data-wrap="right" title="文字在左侧环绕">右环绕</button>' +
      '<button type="button" class="rt-btn" data-wrap="center" title="独占一行居中">居中</button>' +
      '<button type="button" class="rt-btn" data-wrap="none">不环绕</button>' +
      '<span class="rt-sep"></span>' +
      '<button type="button" class="rt-btn rt-imgdel" title="删除图片">删除</button>' +
      "</div>" +
      '<div class="rt-imghandle" hidden title="拖动调整图片大小"></div>'
    );
  }

  /**
   * 在 host 内构建编辑器
   * @param host 容器元素
   * @param opts { placeholder, small, uploadImage, onPickKnowledge }
   */
  function make(host, opts) {
    opts = opts || {};
    host.innerHTML = "";
    var node = document.createElement("div");
    node.className = "rt" + (opts.small ? " small" : "");
    node.innerHTML = toolbarHtml(opts);
    host.appendChild(node);

    var body = node.querySelector(".rt-body");
    if (opts.placeholder) body.setAttribute("data-placeholder", opts.placeholder);
    var file = node.querySelector(".rt-file");
    var imgBar = node.querySelector(".rt-imgbar");
    var handle = node.querySelector(".rt-imghandle");
    var sizeSel = node.querySelector(".rt-size");

    /* ── 图片上传（由调用方提供接口；缺省用工单图片接口） ── */
    function uploadImage(f) {
      if (opts.uploadImage) return opts.uploadImage(f);
      return new Promise(function (resolve, reject) {
        if (f.size > 6 * 1024 * 1024) {
          reject(new Error("图片不能超过 6MB"));
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          var s = String(reader.result || "");
          var b64 = s.slice(s.indexOf(",") + 1);
          fetch("/api/tickets/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: f.name, contentBase64: b64 }),
          }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (d) {
              if (!r.ok) throw new Error(d.error || "图片上传失败");
              resolve(d.url);
            });
          }).catch(function () { reject(new Error("图片上传失败")); });
        };
        reader.onerror = function () { reject(new Error("图片读取失败")); };
        reader.readAsDataURL(f);
      });
    }

    /* ── Markdown 识别：标题 / 图片 / 粘贴转换 ── */

    /** 光标所在的最外层块（body 的直接子元素）；裸文本直接挂在 body 下时返回 null */
    function topBlock(node) {
      var el = node.nodeType === 3 ? node.parentElement : node;
      if (!el || el === body) return null;
      while (el.parentElement && el.parentElement !== body) el = el.parentElement;
      return el.parentElement === body ? el : null;
    }

    /** 把直接挂在 body 下的裸文本节点包进 div（首行没按回车时会出现） */
    function wrapBareText(node) {
      var div = document.createElement("div");
      node.parentNode.insertBefore(div, node);
      div.appendChild(node);
      return div;
    }

    function placeCaretEnd(el) {
      var r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }

    /** `# 标题` 块 → h1~h4（剥掉行首标记，保留块内其它内联格式） */
    function toHeading(block, level) {
      var h = document.createElement("h" + level);
      h.style.fontSize = MD_HEAD_SIZE[level] + "px";
      h.style.fontWeight = "700";
      var stripped = false;
      while (block.firstChild) {
        var c = block.firstChild;
        if (!stripped && c.nodeType === 3) {
          c.textContent = c.textContent.replace(MD_MARK_RE, "");
          stripped = true;
          if (!c.textContent) { block.removeChild(c); continue; }
        }
        h.appendChild(c);
      }
      return h;
    }

    /** 单块识别：标题行 → 标题；整块就是一个图片链接 → 图片 */
    function normalizeBlock(block) {
      if (!block || !block.parentNode) return;
      var text = block.textContent.trim();
      if (!text) return;
      var hm = text.match(MD_HEAD_RE);
      if (hm && !/^H[1-4]$/.test(block.tagName)) {
        block.parentNode.replaceChild(toHeading(block, hm[1].length), block);
        return;
      }
      var im = text.match(MD_IMG_RE);
      var url = im ? im[2] : MD_IMG_URL_RE.test(text) ? text : "";
      if (!url) return;
      var img = document.createElement("img");
      img.setAttribute("src", url);
      img.setAttribute("alt", im ? im[1] : "");
      img.setAttribute("style", "max-width: 100%;");
      block.parentNode.replaceChild(img, block);
    }

    /** 表格识别：扫描 body 的子节点，找到连续的「表头行 + 分隔行 + 数据行」
     *  序列，整体替换成 <table>。返回替换数量，供 normalizeBody 重扫。 */
    function normalizeTables() {
      var children = Array.prototype.slice.call(body.childNodes);
      var replaced = 0;
      var i = 0;
      while (i < children.length - 1) {
        var node0 = children[i];
        var node1 = children[i + 1];
        var t0 = node0.textContent ? node0.textContent.trim() : "";
        var t1 = node1.textContent ? node1.textContent.trim() : "";
        // 必须两行都含 | 且第二行是分隔行
        if (!t0 || t0.indexOf("|") === -1 || !t1 || !isTableSep(t1)) {
          i++;
          continue;
        }
        // 收集数据行
        var j = i + 2;
        var dataLines = [];
        while (j < children.length) {
          var nt = children[j].textContent ? children[j].textContent.trim() : "";
          if (!nt || nt.indexOf("|") === -1) break;
          dataLines.push(nt);
          j++;
        }
        // 构建 <table>
        var headerCells = splitTableRow(t0);
        if (!headerCells.length) { i++; continue; }
        var table = document.createElement("table");
        table.style.borderCollapse = "collapse";
        table.style.width = "100%";
        table.style.margin = "8px 0";
        var thead = document.createElement("thead");
        var trh = document.createElement("tr");
        headerCells.forEach(function (c) {
          var th = document.createElement("th");
          th.textContent = c;
          trh.appendChild(th);
        });
        thead.appendChild(trh);
        table.appendChild(thead);
        var tbody = document.createElement("tbody");
        dataLines.forEach(function (line) {
          var cells = splitTableRow(line);
          var tr = document.createElement("tr");
          cells.forEach(function (c) {
            var td = document.createElement("td");
            td.textContent = c;
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        // 用 table 替换表头行（后续行在其后依次移除）
        var firstBlock = node0.nodeType === 3 ? wrapBareText(node0) : node0;
        // 重新取 i 之后的子节点（wrapBareText 可能改变了顺序）
        var all = Array.prototype.slice.call(body.childNodes);
        var idx = all.indexOf(firstBlock);
        if (idx === -1) { i++; continue; }
        // 移除分隔行和数据行
        var removeCount = 1 + dataLines.length; // 分隔行 + 数据行
        for (var k = 0; k < removeCount; k++) {
          var next = all[idx + 1 + k];
          if (next && next.parentNode) next.parentNode.removeChild(next);
        }
        firstBlock.parentNode.replaceChild(table, firstBlock);
        replaced++;
        i = j;
      }
      return replaced;
    }

    /** 保存前 / 失焦时兜底扫描：编辑器仍有焦点时跳过选区所在的块，避免打乱光标 */
    function normalizeBody() {
      var focused = document.activeElement === body;
      var sel = window.getSelection();
      var anchor = focused && sel && sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null;
      // 先扫表格（多行块，不受单块跳过逻辑影响）
      normalizeTables();
      Array.prototype.slice.call(body.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var line = n.textContent.trim();
          if (!line) return;
          if (MD_HEAD_RE.test(line) || MD_IMG_RE.test(line) || MD_IMG_URL_RE.test(line)) {
            normalizeBlock(wrapBareText(n));
          }
          return;
        }
        if (n.nodeType !== 1) return;
        if (n.tagName === "TABLE") return;
        if (anchor && n.contains(anchor)) return;
        normalizeBlock(n);
      });
    }

    /** 行首 `# ` ~ `#### ` 即时转标题（空格键触发） */
    function tryHeadingShortcut() {
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return false;
      var r = sel.getRangeAt(0);
      if (!r.collapsed) return false;
      var node = r.startContainer;
      if (node.nodeType !== 3 || !body.contains(node)) return false;
      var m = node.textContent.slice(0, r.startOffset).match(/^\s*(#{1,4})$/);
      if (!m) return false;
      if (node.textContent.slice(r.startOffset).trim() !== "") return false;
      var block = topBlock(node);
      if (!block) {
        if (node.parentElement !== body) return false;
        block = wrapBareText(node);
      }
      if (block.textContent.trim() !== m[1]) return false;
      var h = toHeading(block, m[1].length);
      block.parentNode.replaceChild(h, block);
      placeCaretEnd(h);
      return true;
    }

    /* ── 字号：execCommand 打标后换成 px 字号（白名单只放行 style 里的字号） ── */
    function applyFontSize(px) {
      body.focus();
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (!body.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
      var before = Array.prototype.slice.call(body.querySelectorAll('font[size="7"]'));
      document.execCommand("fontSize", false, "7");
      var marks = Array.prototype.slice.call(body.querySelectorAll('font[size="7"]')).filter(function (f) {
        return before.indexOf(f) === -1;
      });
      marks.forEach(function (f) {
        var span = document.createElement("span");
        span.style.fontSize = px + "px";
        while (f.firstChild) span.appendChild(f.firstChild);
        f.parentNode.replaceChild(span, f);
      });
    }

    /* ── @提及 ── */
    var mentionPop = document.createElement("div");
    mentionPop.className = "mention-pop";
    mentionPop.hidden = true;
    node.appendChild(mentionPop);
    var mentionIdx = 0;
    var mentionList = [];
    var mentionActive = false;
    var mentionRange = null;

    function closeMention() {
      mentionActive = false;
      mentionPop.hidden = true;
      mentionPop.innerHTML = "";
      mentionList = [];
    }

    function searchMention(q) {
      /* 统一走 MemberSearch（同源同表 GET /api/search?type=user），缺省时回退本地请求 */
      var p = (window.MemberSearch && window.MemberSearch.search)
        ? window.MemberSearch.search(q)
        : fetch("/api/search?type=user&q=" + encodeURIComponent(q))
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (d) { return (d && d.results) || []; });
      p.then(function (list) {
        if (!mentionActive) return;
        mentionList = list || [];
        mentionIdx = 0;
        renderMentionList();
      }).catch(function () { /* 搜索失败时静默 */ });
    }

    /* 回退行：MemberSearch 缺失时也产出同款 .ms-row 结构，保证与管线面板一致 */
    function fallbackMentionRow(u) {
      var el = document.createElement("div");
      el.className = "ms-row";
      var av = document.createElement("span");
      av.className = "ms-avatar";
      av.style.background = colorOf(u.email);
      av.textContent = firstChar(u.name, u.email);
      var info = document.createElement("div");
      info.className = "ms-info";
      var nm = document.createElement("div");
      nm.className = "ms-name";
      nm.textContent = u.name || u.email;
      var mt = document.createElement("div");
      mt.className = "ms-meta";
      mt.textContent = [u.department, u.title].filter(Boolean).join(" · ") || "—";
      info.appendChild(nm);
      info.appendChild(mt);
      el.appendChild(av);
      el.appendChild(info);
      return el;
    }

    function renderMentionList() {
      mentionPop.innerHTML = "";
      if (!mentionList.length) {
        var empty = document.createElement("div");
        empty.className = "ms-empty";
        empty.textContent = "没有匹配的成员";
        mentionPop.appendChild(empty);
        mentionPop.hidden = false;
        return;
      }
      mentionList.forEach(function (u, i) {
        /* 复用统一员工搜索行（MemberSearch.row → .ms-row），与管线「指派执行人」面板同款 */
        var item = window.MemberSearch ? window.MemberSearch.row(u, {}) : fallbackMentionRow(u);
        item.classList.add("mention-row");
        if (i === mentionIdx) item.classList.add("on");
        item.addEventListener("mousedown", function (e) {
          e.preventDefault();
          insertMention(u);
        });
        mentionPop.appendChild(item);
      });
      mentionPop.hidden = false;
    }

    function insertMention(u) {
      if (!mentionRange) return;
      body.focus();
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(mentionRange);
      var range = sel.getRangeAt(0);
      range.deleteContents();
      var a = document.createElement("a");
      a.href = profileUrl(u.email);
      a.setAttribute("data-email", u.email);
      a.textContent = "@" + (u.name || u.email);
      a.contentEditable = "false";
      range.insertNode(a);
      // 在 @ 后面插入一个普通空格文本节点（不用 execCommand，避免被序列化为 &nbsp; 造成双重转义）
      var spaceNode = document.createTextNode("\u0020");
      a.parentNode.insertBefore(spaceNode, a.nextSibling);
      range.setStartAfter(spaceNode);
      range.setEndAfter(spaceNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      closeMention();
    }

    function checkMention() {
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return closeMention();
      var range = sel.getRangeAt(0);
      if (!body.contains(range.startContainer)) return closeMention();
      var textNode = range.startContainer;
      if (textNode.nodeType !== 3) return closeMention();
      var text = textNode.textContent.substring(0, range.startOffset);
      var atPos = text.lastIndexOf("@");
      if (atPos === -1) return closeMention();
      var prev = atPos > 0 ? text.charAt(atPos - 1) : "";
      if (prev && prev !== " " && prev !== "\n" && prev !== "\u3000") return closeMention();
      var query = text.substring(atPos + 1);
      if (query.indexOf(" ") !== -1 || query.length > 20) return closeMention();

      mentionActive = true;
      mentionRange = document.createRange();
      mentionRange.setStart(textNode, atPos);
      mentionRange.setEnd(textNode, range.startOffset);

      var rect = range.getBoundingClientRect();
      var nodeRect = node.getBoundingClientRect();
      mentionPop.style.left = rect.left - nodeRect.left + "px";
      mentionPop.style.top = rect.bottom - nodeRect.top + 4 + "px";
      searchMention(query);
    }

    /* ── 图片：选中 / 尺寸 / 环绕 / 拖拽缩放 ── */
    var activeImg = null;

    function positionImgTools() {
      if (!activeImg) return;
      var r = activeImg.getBoundingClientRect();
      imgBar.hidden = false;
      imgBar.style.visibility = "hidden";
      var w = imgBar.offsetWidth;
      var h = imgBar.offsetHeight;
      var top = r.top - h - 8;
      if (top < 8) top = r.bottom + 8;
      var left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8));
      imgBar.style.left = left + "px";
      imgBar.style.top = top + "px";
      imgBar.style.visibility = "";
      handle.hidden = false;
      handle.style.left = r.right - 7 + "px";
      handle.style.top = r.bottom - 7 + "px";
    }

    function hideImgTools() {
      activeImg = null;
      imgBar.hidden = true;
      handle.hidden = true;
      Array.prototype.forEach.call(body.querySelectorAll("img.rt-img-on"), function (im) {
        im.classList.remove("rt-img-on");
      });
    }

    function selectImage(img) {
      if (activeImg === img) { positionImgTools(); return; }
      hideImgTools();
      activeImg = img;
      img.classList.add("rt-img-on");
      positionImgTools();
    }

    function setImgWidth(v) {
      if (!activeImg) return;
      setStyle(activeImg, "width", v);
      setStyle(activeImg, "height", "");
      positionImgTools();
    }

    function setImgWrap(mode) {
      if (!activeImg) return;
      var st = parseStyle(activeImg.getAttribute("style") || "");
      delete st["float"];
      delete st["display"];
      delete st["margin"];
      if (mode === "left") { st["float"] = "left"; st.margin = "6px 14px 8px 0"; }
      else if (mode === "right") { st["float"] = "right"; st.margin = "6px 0 8px 14px"; }
      else if (mode === "center") { st.display = "block"; st.margin = "8px auto"; }
      if (Object.keys(st).length) activeImg.setAttribute("style", buildStyle(st));
      else activeImg.removeAttribute("style");
      positionImgTools();
    }

    handle.addEventListener("mousedown", function (e) {
      if (!activeImg) return;
      e.preventDefault();
      var startX = e.clientX;
      var startW = activeImg.getBoundingClientRect().width;
      var maxW = Math.max(120, body.clientWidth - 28);
      function onMove(ev) {
        var w = Math.round(Math.min(maxW, Math.max(40, startW + (ev.clientX - startX))));
        setImgWidth(w + "px");
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    body.addEventListener("click", function (e) {
      if (e.target && e.target.tagName === "IMG") selectImage(e.target);
      else if (!imgBar.contains(e.target)) hideImgTools();
    });
    body.addEventListener("scroll", positionImgTools);
    window.addEventListener("resize", positionImgTools);

    Array.prototype.forEach.call(node.querySelectorAll(".rt-imgbar .rt-btn"), function (btn) {
      btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
      btn.addEventListener("click", function () {
        var size = btn.getAttribute("data-size");
        var wrap = btn.getAttribute("data-wrap");
        if (size) setImgWidth(size);
        if (wrap) setImgWrap(wrap);
        if (btn.classList.contains("rt-imgdel")) {
          if (activeImg) activeImg.remove();
          hideImgTools();
        }
      });
    });
    var imgWInput = node.querySelector(".rt-imgw");
    imgWInput.addEventListener("mousedown", function (e) { e.preventDefault(); });
    imgWInput.addEventListener("change", function () {
      var n = parseInt(this.value, 10);
      this.value = "";
      if (n >= 40 && n <= 1200) setImgWidth(n + "px");
    });

    /* ── 工具栏 ── */
    Array.prototype.forEach.call(node.querySelectorAll(".rt-bar .rt-btn"), function (btn) {
      btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
      btn.addEventListener("click", function () {
        var cmd = btn.getAttribute("data-cmd");
        var block = btn.getAttribute("data-block");
        var align = btn.getAttribute("data-align");
        var action = btn.getAttribute("data-action");
        if (action === "image") { file.click(); return; }
        if (action === "kb") {
          if (typeof opts.onPickKnowledge === "function") opts.onPickKnowledge({ insertHtml: insertHtmlAtCaret });
          return;
        }
        if (action === "mention") {
          body.focus();
          document.execCommand("insertText", false, "@");
          checkMention();
          return;
        }
        body.focus();
        if (cmd) document.execCommand(cmd, false, null);
        if (block) document.execCommand("formatBlock", false, block);
        if (align) document.execCommand("justify" + align.charAt(0).toUpperCase() + align.slice(1), false, null);
      });
    });

    // 字号下拉：mousedown 时暂存选区（点 <select> 会让 contenteditable 失焦），
    // change 时先回焦 + 恢复选区再应用字号。不阻止 mousedown 默认行为，否则下拉打不开。
    var savedRange = null;
    sizeSel.addEventListener("mousedown", function () {
      var sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && body.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        savedRange = sel.getRangeAt(0).cloneRange();
      } else {
        savedRange = null;
      }
    });
    sizeSel.addEventListener("change", function () {
      var px = parseInt(this.value, 10);
      this.value = "";
      if (!px) return;
      body.focus();
      if (savedRange) {
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
      applyFontSize(px);
    });

    file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      file.value = "";
      if (!f) return;
      uploadImage(f).then(function (url) {
        body.focus();
        document.execCommand("insertImage", false, url);
        var imgs = body.querySelectorAll("img");
        var img = imgs[imgs.length - 1];
        if (img) {
          setStyle(img, "max-width", "100%");
          selectImage(img);
        }
      }).catch(function (err) {
        alert(err && err.message ? err.message : "图片上传失败");
      });
    });

    // 粘贴：把纯文本按 Markdown 转成 HTML 再插入（标题 / 图片 / 列表 / 引用 / 粗斜体 / 链接），
    // 仍不带入外部脚本与样式；execCommand 不支持时退回手工插入
    body.addEventListener("paste", function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData("text/plain");
      if (!text) return;
      var html = mdToHtml(text);
      var ok = false;
      try {
        ok = document.execCommand("insertHTML", false, html);
      } catch (err) {
        ok = false;
      }
      if (!ok) insertHtmlAtCaret(html);
    });

    // 失焦时兜底识别（离开编辑器才动 DOM，不影响输入过程）
    body.addEventListener("blur", function () {
      normalizeBody();
    });

    body.addEventListener("input", checkMention);
    body.addEventListener("keydown", function (e) {
      if (e.key === " " && !e.ctrlKey && !e.metaKey && !e.altKey && !mentionActive) {
        if (tryHeadingShortcut()) {
          e.preventDefault();
          return;
        }
      }
      if (!mentionActive) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeMention();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (mentionList.length) { mentionIdx = (mentionIdx + 1) % mentionList.length; renderMentionList(); }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (mentionList.length) { mentionIdx = (mentionIdx - 1 + mentionList.length) % mentionList.length; renderMentionList(); }
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (mentionList.length && mentionList[mentionIdx]) {
          e.preventDefault();
          insertMention(mentionList[mentionIdx]);
        }
      }
    });

    document.addEventListener("mousedown", function (e) {
      if (!node.contains(e.target)) { closeMention(); hideImgTools(); }
    });

    /** 在光标处插入一段 HTML（知识库卡片等），并选中其后位置 */
    function insertHtmlAtCaret(html) {
      body.focus();
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !body.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        body.insertAdjacentHTML("beforeend", html);
        return;
      }
      var range = sel.getRangeAt(0);
      range.deleteContents();
      var tpl = document.createElement("template");
      tpl.innerHTML = html;
      var frag = tpl.content;
      var last = frag.lastChild;
      range.insertNode(frag);
      if (last) {
        var after = document.createRange();
        after.setStartAfter(last);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
      }
    }

    return {
      getHtml: function () {
        normalizeBody();
        return body.innerHTML;
      },
      setHtml: function (html) { body.innerHTML = html || ""; hideImgTools(); },
      clear: function () { body.innerHTML = ""; hideImgTools(); },
      focus: function () { body.focus(); },
      insertHtml: insertHtmlAtCaret,
      bodyEl: function () { return body; },
    };
  }

  return { make: make };
})();