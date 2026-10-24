/* tokens.js · Token 面板
   数据源：window.__TOKENS__ = { user, isSupervisor }
   接口：GET /api/tokens → { scope: "self"|"team", me, team }
   展示本人「今天 / 近 7 天 / 近 30 天 / 累计」token 消耗；主管额外展示团队每名成员的消耗量。 */
(function () {
  var boot = window.__TOKENS__ || {};
  var isSuper = !!boot.isSupervisor;

  function byId(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** 千分位分隔（完整数字，用于 title 提示） */
  function full(n) {
    return (Number(n) || 0).toLocaleString("en-US");
  }

  /** 紧凑展示：1234 → 1.23K；1234567 → 1.23M（表格窄列用） */
  function compact(n) {
    var v = Number(n) || 0;
    if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(2) + "K";
    return String(v);
  }

  /** 一张统计卡 */
  function statCard(label, value, accent) {
    return '<div class="stat' + (accent ? " accent" : "") + '">' +
      '<div class="stat-label">' + esc(label) + "</div>" +
      '<div class="stat-num" title="' + full(value) + ' 个 token">' + compact(value) +
      '<span class="stat-unit">tokens</span></div></div>';
  }

  function renderMine(me) {
    var t = (me && me.tokens) || { today: 0, week: 0, month: 0, total: 0 };
    byId("myStats").innerHTML =
      statCard("今天", t.today, false) +
      statCard("近 7 天", t.week, true) +
      statCard("近 30 天", t.month, false) +
      statCard("累计", t.total, false);
    var who = (me && (me.name || me.email)) || "我";
    byId("myNote").textContent = "「" + who + "」累计消耗 " + full(t.total) + " 个 token" +
      "（今天 " + full(t.today) + " · 近 7 天 " + full(t.week) + " · 近 30 天 " + full(t.month) + "）";
  }

  function renderTeam(team) {
    var list = (team || []).slice().sort(function (a, b) {
      var x = (a.tokens && a.tokens.total) || 0;
      var y = (b.tokens && b.tokens.total) || 0;
      return y - x;
    });
    var max = list.reduce(function (m, r) { return Math.max(m, (r.tokens && r.tokens.total) || 0); }, 0);
    byId("teamSection").hidden = false;
    var box = byId("teamList");
    if (!list.length) {
      box.innerHTML = '<div class="team-empty">暂无成员</div>';
      return;
    }
    box.innerHTML = list.map(function (r) {
      var t = r.tokens || { today: 0, week: 0, month: 0, total: 0 };
      var pct = max > 0 ? Math.max((t.total / max) * 100, t.total > 0 ? 2 : 0) : 0;
      var initial = esc((r.name || r.email || "?").slice(0, 1).toUpperCase());
      return '<div class="team-row">' +
        '<div class="team-who">' +
          '<span class="team-avatar" aria-hidden="true">' + initial + "</span>" +
          '<div class="team-meta">' +
            '<div class="team-name">' + esc(r.name || r.email || "外部触发") + "</div>" +
            '<div class="team-dept">' + esc(r.department || "") + "</div>" +
          "</div>" +
        "</div>" +
        '<div class="team-bar" title="' + full(t.total) + '"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
        '<div class="team-num" title="' + full(t.today) + '">' + compact(t.today) + "</div>" +
        '<div class="team-num" title="' + full(t.week) + '">' + compact(t.week) + "</div>" +
        '<div class="team-num" title="' + full(t.month) + '">' + compact(t.month) + "</div>" +
        '<div class="team-num total" title="' + full(t.total) + '">' + compact(t.total) + "</div>" +
        "</div>";
    }).join("");
  }

  function load() {
    fetch("/api/tokens", { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        renderMine(d.me);
        if (d.scope === "team") renderTeam(d.team);
      })
      .catch(function () { byId("myNote").textContent = "读取失败，请刷新重试"; });
  }

  function init() {
    if (isSuper) byId("teamLink").style.display = "inline-block";
    load();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();