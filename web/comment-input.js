/**
 * 评论区共享模块：工单页与知识库页的评论输入完全一致（纯文本 textarea + @提及成员），
 * 把「纯文本 → 落库 HTML」与「@提及下拉」抽到一处，两处页面共用，避免复制两份实现。
 *
 * 依赖（页面需先引入）：window.UserCard（esc / profileUrl / makeAvatar）、可选 window.MemberSearch。
 *
 * 用法：
 *   var input = document.getElementById("commentInput");
 *   var ci = CommentInput.attach(input, function () { return members; });
 *   fetch(url, { method: "POST", body: JSON.stringify({ content: CommentInput.buildHtml(text, members) }) });
 *   ci.close();   // 提交成功后收起下拉
 */
window.CommentInput = (function () {
  /** @提及候选里选过的人（搜索接口返回的可能不在页面 members 里）：姓名 → 成员 */
  var cache = {};

  /**
   * 纯文本评论 → 落库 HTML：转义 + 换行转 <br> + @姓名 转带 data-email 的提及链接
   * （评论输入为纯文本，这里只做最小转换，仍由服务端 sanitizeRichHtml 二次净化）
   */
  function buildHtml(text, members) {
    var UC = window.UserCard;
    var esc = UC.esc;
    var profileUrl = UC.profileUrl;
    var names = [];
    var byName = {};
    (members || []).forEach(function (m) {
      var nm = (m.name || "").trim();
      if (!nm || byName[nm]) return;
      byName[nm] = m;
      names.push(nm);
    });
    Object.keys(cache).forEach(function (nm) {
      if (!byName[nm]) {
        byName[nm] = cache[nm];
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
          out +=
            '<a href="' + esc(profileUrl(m.email)) + '" data-email="' + esc(m.email) + '">@' +
            escText(hit) + "</a>";
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

  /**
   * 给纯文本评论框挂 @提及下拉。
   * @param {HTMLTextAreaElement} input 评论输入框
   * @param {function():Array} getMembers 取当前成员列表（页面成员可能异步刷新，故传函数）
   * @returns {{close: function()}} 提交成功后调 close() 收起下拉
   */
  function attach(input, getMembers) {
    var UC = window.UserCard;
    var makeAvatar = UC.makeAvatar;
    var st = { active: false, start: -1, query: "", list: [], idx: 0 };
    var box = input.parentNode;
    var pop = document.createElement("div");
    pop.className = "mention-pop";
    pop.id = (input.id || "comment") + "Pop";
    pop.hidden = true;
    box.appendChild(pop);

    function close() {
      st.active = false;
      st.query = "";
      st.list = [];
      pop.hidden = true;
      pop.innerHTML = "";
    }

    /** 调用全局搜索接口搜员工（姓名 / 邮箱 / 部门 / 职位都能命中） */
    var searchTimer = null;
    function searchUsers(q, cb) {
      if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
      var ql = (q || "").trim();
      if (!ql) {
        cb(getMembers().slice(0, 8));
        return;
      }
      searchTimer = setTimeout(function () {
        fetch("/api/search?type=user&q=" + encodeURIComponent(ql), {
          headers: { Accept: "application/json" },
        })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (d) { cb((d && d.results) ? d.results : []); })
          .catch(function () { cb([]); });
      }, 200);
    }

    /* 回退行：MemberSearch 缺失时也产出同款 .ms-row 结构，保证与管线「指派执行人」面板一致 */
    function fallbackMentionRow(u) {
      var el = document.createElement("div");
      el.className = "ms-row";
      el.appendChild(makeAvatar(u, u.email, "ms-avatar"));
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
      el.appendChild(info);
      return el;
    }

    function render() {
      if (!st.active) return;
      pop.innerHTML = "";
      if (!st.list.length) {
        var empty = document.createElement("div");
        empty.className = "ms-empty";
        empty.textContent = "没有匹配的成员";
        pop.appendChild(empty);
      }
      st.list.forEach(function (u, i) {
        /* 复用统一员工搜索行（MemberSearch.row → .ms-row），与管线「指派执行人」面板同款 */
        var item = window.MemberSearch ? window.MemberSearch.row(u, {}) : fallbackMentionRow(u);
        item.classList.add("mention-row");
        if (i === st.idx) item.classList.add("on");
        item.addEventListener("mousedown", function (e) { e.preventDefault(); insert(u); });
        pop.appendChild(item);
      });
      var r = input.getBoundingClientRect();
      var br = box.getBoundingClientRect();
      pop.style.left = Math.max(0, r.left - br.left) + "px";
      pop.style.top = (r.bottom - br.top + 4) + "px";
      pop.hidden = false;
    }

    function check() {
      var pos = input.selectionStart;
      var before = input.value.slice(0, pos);
      var m = before.match(/(^|[\s\u3000])@([^\s@]{0,20})$/);
      if (!m) { close(); return; }
      st.active = true;
      st.start = pos - m[2].length - 1;
      st.query = m[2];
      st.idx = 0;
      var members = getMembers();
      // 先本地快速渲染一版，接口返回后再替换
      st.list = (m[2]
        ? members.filter(function (u) {
            return ((u.name || "") + " " + u.email).toLowerCase().indexOf(m[2].toLowerCase()) !== -1;
          })
        : members
      ).slice(0, 8);
      render();
      searchUsers(m[2], function (results) {
        if (!st.active) return;
        st.list = results.slice(0, 8);
        st.idx = 0;
        render();
      });
    }

    function insert(u) {
      var nm = u.name || u.email.split("@")[0];
      // 把选中的人缓存起来，buildHtml 用它把 @姓名 转成带 email 的链接
      if (nm && u.email) cache[nm] = u;
      var pos = input.selectionStart;
      var v = input.value;
      input.value = v.slice(0, st.start) + "@" + nm + " " + v.slice(pos);
      var np = st.start + nm.length + 2;
      input.setSelectionRange(np, np);
      close();
      input.focus();
    }

    input.addEventListener("input", check);
    input.addEventListener("click", check);
    input.addEventListener("keydown", function (e) {
      if (!st.active) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (st.list.length) { st.idx = (st.idx + 1) % st.list.length; render(); }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (st.list.length) { st.idx = (st.idx - 1 + st.list.length) % st.list.length; render(); }
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (st.list.length && st.list[st.idx]) {
          e.preventDefault();
          insert(st.list[st.idx]);
        }
      }
    });
    document.addEventListener("mousedown", function (e) {
      if (!box.contains(e.target)) close();
    });

    return { close: close };
  }

  return { buildHtml: buildHtml, attach: attach };
})();
