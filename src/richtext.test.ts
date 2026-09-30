import { test } from "node:test";
import assert from "node:assert";
import { sanitizeRichHtml, isEmptyRichHtml } from "./richtext.js";

test("should keep allowed formatting tags produced by the editor", () => {
  const html = '<p>你好 <b>世界</b> <u>下划线</u> <s>删除线</s> <font size="5">大</font></p>';
  assert.strictEqual(sanitizeRichHtml(html), html);
});

test("should keep only whitelisted attributes on img from platform upload", () => {
  const html = '<img src="/api/tickets/images/abc123.png" alt="截图" width="300">';
  assert.strictEqual(sanitizeRichHtml(html), html);
});

test("should drop external image sources", () => {
  assert.strictEqual(sanitizeRichHtml('<img src="https://evil.com/x.png">'), "<img>");
  assert.strictEqual(sanitizeRichHtml('<img src="/etc/passwd">'), "<img>");
});

test("should strip script blocks and javascript: urls", () => {
  assert.strictEqual(sanitizeRichHtml("<script>alert(1)</script>hello"), "hello");
  assert.strictEqual(sanitizeRichHtml('<a href="javascript:alert(1)">x</a>'), "<a>x</a>");
});

test("should strip inline event handlers", () => {
  assert.strictEqual(sanitizeRichHtml('<div onclick="evil()">hi</div>'), "<div>hi</div>");
  assert.strictEqual(sanitizeRichHtml('<img src="/api/tickets/images/a1b2c3.png" onerror="evil()">'),
    '<img src="/api/tickets/images/a1b2c3.png">');
});

test("should drop dangerous block elements with their content", () => {
  assert.strictEqual(sanitizeRichHtml('<iframe src="x">inner</iframe>tail'), "tail");
  assert.strictEqual(sanitizeRichHtml('<style>body{}</style>ok'), "ok");
});

test("should drop unknown tags but keep inner text", () => {
  assert.strictEqual(sanitizeRichHtml("<marquee>hi</marquee>"), "hi");
});

test("should escape stray angle brackets and ampersands in text", () => {
  assert.strictEqual(sanitizeRichHtml("a < b & c"), "a &lt; b &amp; c");
  assert.strictEqual(sanitizeRichHtml("1 < 2 > 3"), "1 &lt; 2 &gt; 3");
});

test("should detect empty rich text", () => {
  assert.strictEqual(isEmptyRichHtml("<p><br></p>"), true);
  assert.strictEqual(isEmptyRichHtml("<p>&nbsp;</p>"), true);
  assert.strictEqual(isEmptyRichHtml("<p>hi</p>"), false);
});

test("should keep data-email on mention links", () => {
  assert.strictEqual(
    sanitizeRichHtml('<a href="/profile/zhangli" data-email="zhangli@ai-flows.com">@张莉</a>'),
    '<a href="/profile/zhangli" data-email="zhangli@ai-flows.com">@张莉</a>'
  );
});

test("should drop invalid data-email values on links", () => {
  assert.strictEqual(
    sanitizeRichHtml('<a href="/x" data-email="not-an-email">@x</a>'),
    '<a href="/x">@x</a>'
  );
  assert.strictEqual(
    sanitizeRichHtml('<a href="/x" data-email="a" onerror="x">@x</a>'),
    '<a href="/x">@x</a>'
  );
});

test("should keep data-kb-id on knowledge links", () => {
  assert.strictEqual(
    sanitizeRichHtml('<a href="/kb?id=k-m3x1-ab12cd" data-kb-id="k-m3x1-ab12cd">部署手册</a>'),
    '<a href="/kb?id=k-m3x1-ab12cd" data-kb-id="k-m3x1-ab12cd">部署手册</a>'
  );
});

test("should drop invalid data-kb-id values on links", () => {
  assert.strictEqual(
    sanitizeRichHtml('<a href="/kb?id=x" data-kb-id="../etc/passwd">x</a>'),
    '<a href="/kb?id=x">x</a>'
  );
  assert.strictEqual(
    sanitizeRichHtml('<a href="/kb?id=x" data-kb-id="k-1" style="color:red">x</a>'),
    '<a href="/kb?id=x" data-kb-id="k-1">x</a>'
  );
});

test("should keep editor layout styles on text and images", () => {
  assert.strictEqual(
    sanitizeRichHtml('<span style="font-size:16px">大一点</span>'),
    '<span style="font-size: 16px">大一点</span>'
  );
  assert.strictEqual(
    sanitizeRichHtml('<p style="text-align:center">居中</p>'),
    '<p style="text-align: center">居中</p>'
  );
  assert.strictEqual(
    sanitizeRichHtml('<img src="/api/tickets/images/ab12cd34ef56.png" style="float:left;width:40%;margin:6px 14px 8px 0">'),
    '<img src="/api/tickets/images/ab12cd34ef56.png" style="float: left; width: 40%; margin: 6px 14px 8px 0">'
  );
});

test("should keep markdown heading size and weight", () => {
  assert.strictEqual(
    sanitizeRichHtml('<h1 style="font-size: 24px; font-weight: 700;">标题</h1>'),
    '<h1 style="font-size: 24px; font-weight: 700">标题</h1>'
  );
  assert.strictEqual(
    sanitizeRichHtml('<h2 style="font-size:20px;font-weight:bold">标题</h2>'),
    '<h2 style="font-size: 20px; font-weight: bold">标题</h2>'
  );
  // 非法字重取值丢掉，合法字号保留
  assert.strictEqual(
    sanitizeRichHtml('<h3 style="font-size:17px;font-weight:9000">x</h3>'),
    '<h3 style="font-size: 17px">x</h3>'
  );
});

test("should keep markdown table structure and styles", () => {
  const html =
    '<table style="border-collapse: collapse; width: 100%;">' +
    "<thead><tr><th>姓名</th><th>部门</th></tr></thead>" +
    "<tbody>" +
    '<tr><td style="text-align: center">张三</td><td>研发部</td></tr>' +
    "</tbody></table>";
  const out = sanitizeRichHtml(html);
  assert.ok(out.includes("<table"));
  assert.ok(out.includes("<thead>"));
  assert.ok(out.includes("<tbody>"));
  assert.ok(out.includes("<th>姓名</th>"));
  assert.ok(out.includes("张三"));
  assert.ok(out.includes("<td>研发部</td>"));
  assert.ok(out.includes("border-collapse: collapse"));
  assert.ok(out.includes("text-align: center"));
  // 危险属性被剥
  assert.strictEqual(
    sanitizeRichHtml('<table onclick="alert(1)"><tr><td>x</td></tr></table>').indexOf("onclick"),
    -1
  );
});

test("should drop non-layout style declarations", () => {
  assert.strictEqual(
    sanitizeRichHtml('<span style="position:fixed;font-size:14px">x</span>'),
    '<span style="font-size: 14px">x</span>'
  );
  assert.strictEqual(
    sanitizeRichHtml('<div style="background:url(javascript:alert(1))">x</div>'),
    "<div>x</div>"
  );
  assert.strictEqual(
    sanitizeRichHtml('<p style="width:expression(alert(1))">x</p>'),
    "<p>x</p>"
  );
  // 不允许 style 的标签即使样式合法也要丢掉
  assert.strictEqual(
    sanitizeRichHtml('<a href="/x" style="font-size:16px">x</a>'),
    '<a href="/x">x</a>'
  );
});