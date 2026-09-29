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