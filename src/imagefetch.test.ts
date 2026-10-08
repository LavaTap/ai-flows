import test from "node:test";
import assert from "node:assert/strict";
import { isBlockedHost, pickExt, localizeExternalImages } from "./imagefetch.js";

test("should 拦截内网与回环地址 when 校验外链主机", () => {
  const blocked = [
    "localhost",
    "sub.localhost",
    "printer.local",
    "0.0.0.0",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "169.254.169.254",
    "224.0.0.1",
    "::1",
    "[fe80::1]",
    "",
  ];
  for (const h of blocked) {
    assert.equal(isBlockedHost(h), true, `${h} 应被拦截`);
  }
});

test("should 放行公网主机 when 校验外链主机", () => {
  for (const h of ["example.com", "cdn.example.org", "8.8.8.8", "172.32.0.1", "192.169.0.1"]) {
    assert.equal(isBlockedHost(h), false, `${h} 应放行`);
  }
});

test("should 优先按 MIME 推断扩展名 when 解析图片类型", () => {
  assert.equal(pickExt("/a/b", "image/webp"), "webp");
  assert.equal(pickExt("/a/b.PNG", ""), "png");
  assert.equal(pickExt("/a/b.jpeg", ""), "jpeg");
  assert.equal(pickExt("/a/b.txt", "text/plain"), null);
  assert.equal(pickExt("/a/b", ""), null);
});

test("should 原样返回 when 正文没有外链图片", async () => {
  const html = '<p>说明</p><img src="/api/tickets/images/aaaaaaaaaaaa.png">';
  assert.equal(await localizeExternalImages(html), html);
  assert.equal(await localizeExternalImages(""), "");
});

test("should 降级为链接 when 外链图片指向内网被拦截", async () => {
  const html = '<p>x</p><img src="http://127.0.0.1:9/a.png">';
  assert.equal(
    await localizeExternalImages(html),
    '<p>x</p><a href="http://127.0.0.1:9/a.png">http://127.0.0.1:9/a.png</a>'
  );
});
