import { test } from "node:test";
import assert from "node:assert";
import { filterReviewsByUser, canEditRequirement, safeRepoPath, parseGithubRepo, canAccessTicket, filterTicketsByUser, isTicketStatus, collectTicketImages, decodePathSegment, summarizeTokenUsage } from "./platform.js";
import type { ReviewRecord, UserAccount, NodeState, TicketRecord } from "./db.js";

function user(role: "staff" | "supervisor", department: string): UserAccount {
  return {
    email: "t@ai-flows.com",
    password: "123456",
    role,
    title: "测试",
    department,
  };
}

function rec(department: string, source: "platform" | "external" = "platform"): ReviewRecord {
  return {
    id: "r",
    source,
    actor: "测试",
    email: "",
    department,
    role: "staff",
    generatedAt: "",
    passed: true,
    blockers: 0,
    issues: 0,
    reportUrl: "",
  };
}

test("should return all records when user is supervisor", () => {
  const records = [rec("产品调研"), rec("程序中台"), rec("AI产品")];
  const out = filterReviewsByUser(records, user("supervisor", "产品"));
  assert.strictEqual(out.length, 3);
});

test("should return only own-department records for staff", () => {
  const records = [rec("产品调研"), rec("程序中台"), rec("AI产品")];
  const out = filterReviewsByUser(records, user("staff", "程序中台"));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].department, "程序中台");
});

test("should keep external records assigned to 程序中台 visible to that department staff", () => {
  const records = [rec("程序中台", "external"), rec("产品调研")];
  const out = filterReviewsByUser(records, user("staff", "程序中台"));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].source, "external");
});

test("should return empty for staff of department with no records", () => {
  const out = filterReviewsByUser([rec("产品调研")], user("staff", "产品运营"));
  assert.strictEqual(out.length, 0);
});

function node(department: string): NodeState {
  return { id: "01", department, step: "测试", ready: true, status: "todo" };
}

test("should allow requirement edit for own-department staff and supervisor only", () => {
  const n = node("产品调研");
  assert.strictEqual(canEditRequirement(user("staff", "产品调研"), n), true);
  assert.strictEqual(canEditRequirement(user("staff", "程序中台"), n), false);
  assert.strictEqual(canEditRequirement(user("supervisor", "产品"), n), true);
});

test("should resolve paths inside repo root and reject traversal outside", () => {
  const repo = "D:/code/demo";
  assert.strictEqual(safeRepoPath(repo, ""), "D:\\code\\demo".replace(/\//g, "\\"));
  assert.strictEqual(safeRepoPath(repo, "output/调研"), "D:\\code\\demo\\output\\调研");
  assert.strictEqual(safeRepoPath(repo, "output/../web"), "D:\\code\\demo\\web");
  // 越权：逃出仓库根
  assert.strictEqual(safeRepoPath(repo, "../other"), null);
  assert.strictEqual(safeRepoPath(repo, "D:/other/abs"), null);
});

test("should reject sibling-prefix paths that do not live inside repo root", () => {
  // D:/code/demo-evil 与 D:/code/demo 前缀相似但不在根内
  assert.strictEqual(safeRepoPath("D:/code/demo", "D:/code/demo-evil/x"), null);
});

test("should parse owner and repo from github links", () => {
  assert.deepStrictEqual(parseGithubRepo("https://github.com/LavaTap/Lightbulb-AI"), {
    owner: "LavaTap",
    repo: "Lightbulb-AI",
  });
  // 省略协议 / 带 www / 末尾斜杠 / .git 后缀
  assert.deepStrictEqual(parseGithubRepo("github.com/LavaTap/Lightbulb-AI"), {
    owner: "LavaTap",
    repo: "Lightbulb-AI",
  });
  assert.deepStrictEqual(parseGithubRepo("http://www.github.com/owner/repo/"), {
    owner: "owner",
    repo: "repo",
  });
  assert.deepStrictEqual(parseGithubRepo("https://github.com/owner/repo.git"), {
    owner: "owner",
    repo: "repo",
  });
  // 前后空白容错
  assert.deepStrictEqual(parseGithubRepo("  https://github.com/owner/repo  "), {
    owner: "owner",
    repo: "repo",
  });
});

test("should return null when github link is empty or not a repo url", () => {
  assert.strictEqual(parseGithubRepo(""), null);
  assert.strictEqual(parseGithubRepo("   "), null);
  assert.strictEqual(parseGithubRepo("https://gitlab.com/owner/repo"), null);
  assert.strictEqual(parseGithubRepo("https://github.com/owner"), null);
  assert.strictEqual(parseGithubRepo("https://github.com/"), null);
  assert.strictEqual(parseGithubRepo("owner/repo"), null);
});

function ticket(department: string): TicketRecord {
  return {
    id: "t-1",
    kind: "bug",
    title: "标题",
    content: "<p>正文</p>",
    status: "open",
    department,
    authorName: "测试",
    authorEmail: "t@ai-flows.com",
    createdAt: "",
    updatedAt: "",
    images: [],
    comments: [],
  };
}

test("should let own-department staff and supervisor access a ticket", () => {
  assert.strictEqual(canAccessTicket(user("staff", "程序中台"), ticket("程序中台")), true);
  assert.strictEqual(canAccessTicket(user("staff", "平台运营部"), ticket("程序中台")), false);
  assert.strictEqual(canAccessTicket(user("supervisor", "产品"), ticket("程序中台")), true);
});

test("should filter tickets by department for staff and keep all for supervisor", () => {
  const list = [ticket("程序中台"), ticket("平台运营部")];
  assert.strictEqual(filterTicketsByUser(list, user("staff", "平台运营部")).length, 1);
  assert.strictEqual(filterTicketsByUser(list, user("staff", "用户研究部")).length, 0);
  assert.strictEqual(filterTicketsByUser(list, user("supervisor", "平台运营部")).length, 2);
});

test("should accept only known ticket statuses", () => {
  assert.strictEqual(isTicketStatus("open"), true);
  assert.strictEqual(isTicketStatus("resolved"), true);
  assert.strictEqual(isTicketStatus("closed"), false);
  assert.strictEqual(isTicketStatus(1), false);
  assert.strictEqual(isTicketStatus(undefined), false);
});

test("should collect platform image names referenced by sanitized html", () => {
  const html = '<p><img src="/api/tickets/images/a1b2c3d4e5f6.png"><img src="/api/tickets/images/a1b2c3d4e5f6.png"><img src="https://x/y.png"></p>';
  assert.deepStrictEqual(collectTicketImages(html), ["a1b2c3d4e5f6.png"]);
  assert.deepStrictEqual(collectTicketImages("<p>无图</p>"), []);
});

test("should decode url-encoded email path segment and reject malformed or unsafe ones", () => {
  assert.strictEqual(decodePathSegment("wangxinyi%40ai-flows.com"), "wangxinyi@ai-flows.com");
  assert.strictEqual(decodePathSegment("wangxinyi@ai-flows.com"), "wangxinyi@ai-flows.com");
  assert.strictEqual(decodePathSegment("%E6%9D%8E%E4%BA%91"), "李云");
  assert.strictEqual(decodePathSegment("a%2Fb"), null);
  assert.strictEqual(decodePathSegment("a%5Cb"), null);
  assert.strictEqual(decodePathSegment("%"), null);
  assert.strictEqual(decodePathSegment(""), null);
});

test("should summarize token usage into today / week / month / total windows", () => {
  const now = new Date(2026, 8, 30, 12, 0, 0); // 2026-09-30 12:00 本地时间
  const at = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  const DAY = 86400000;
  const s = summarizeTokenUsage(
    [
      { at: at(0), totalTokens: 100 }, // 今天
      { at: at(2 * DAY), totalTokens: 200 }, // 2 天前（7 天内）
      { at: at(10 * DAY), totalTokens: 400 }, // 10 天前（7 天外、30 天内）
      { at: at(40 * DAY), totalTokens: 800 }, // 40 天前（仅累计）
    ],
    now
  );
  assert.strictEqual(s.today, 100);
  assert.strictEqual(s.week, 300);
  assert.strictEqual(s.month, 700);
  assert.strictEqual(s.total, 1500);
});

test("should count invalid timestamps into total only", () => {
  const s = summarizeTokenUsage([{ at: "not-a-date", totalTokens: 5 }, { at: "", totalTokens: 7 }]);
  assert.strictEqual(s.total, 12);
  assert.strictEqual(s.today + s.week + s.month, 0);
});