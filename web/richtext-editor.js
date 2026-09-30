/* richtext-editor.js · 工单 / 知识库共用的富文本编辑器（零依赖）
   基于 contenteditable + execCommand，补几项 Word 常用能力：
   - 字号：下拉选择 → 落成 span[style=font-size:Npx]（修复此前选区不生效/样式被净化丢弃的问题）
   - 图片：点击选中 → 悬浮工具条设置尺寸（25/50/75/100% 或自定义 px）与文字环绕（左/右/居中/无）
   - 图片：右下角手柄拖拽直接缩放
   - @提及：输入 @ 弹出成员候选，插入带 data-email 的链接（渲染端升级为「头像 + 名字」）
   - 知识库：插入知识库卡片引用（由调用方通过 opts.onPickKnowledge 提供选择弹层）
   用法：var ed = window.RichEditor.make(hostEl, { placeholder, onPickKnowledge }); */
window.RichEditor = (function () {
  "use strict";

  var SIZE_OPTIONS = [12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40];

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
      fetch("/api/search?type=user&q=" + encodeURIComponent(q))
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          if (!mentionActive) return;
          mentionList = d.results || [];
          mentionIdx = 0;
          renderMentionList();
        })
        .catch(function () { /* 搜索失败时静默 */ });
    }

    function renderMentionList() {
      mentionPop.innerHTML = "";
      if (!mentionList.length) {
        var empty = document.createElement("div");
        empty.className = "mention-item";
        empty.style.cursor = "default";
        empty.style.color = "var(--muted)";
        empty.textContent = "没有匹配的成员";
        mentionPop.appendChild(empty);
        mentionPop.hidden = false;
        return;
      }
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
        name.textContent = u.name || u.email;
        var dept = document.createElement("div");
        dept.className = "mi-dept";
        dept.textContent = u.department || "";
        meta.appendChild(name);
        meta.appendChild(dept);
        item.appendChild(meta);
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
      range.setStartAfter(a);
      range.setEndAfter(a);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("insertText", false, " ");
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

    sizeSel.addEventListener("mousedown", function (e) { e.preventDefault(); });
    sizeSel.addEventListener("change", function () {
      var px = parseInt(this.value, 10);
      this.value = "";
      if (px) applyFontSize(px);
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

    // 粘贴统一转纯文本，避免带入外部脚本与样式
    body.addEventListener("paste", function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });

    body.addEventListener("input", checkMention);
    body.addEventListener("keydown", function (e) {
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
      getHtml: function () { return body.innerHTML; },
      setHtml: function (html) { body.innerHTML = html || ""; hideImgTools(); },
      clear: function () { body.innerHTML = ""; hideImgTools(); },
      focus: function () { body.focus(); },
      insertHtml: insertHtmlAtCaret,
      bodyEl: function () { return body; },
    };
  }

  return { make: make };
})();