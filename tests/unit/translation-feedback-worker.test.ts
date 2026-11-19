// @vitest-environment node
import { generateKeyPairSync, createVerify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { CONTACT_TTL_SECONDS, appJwt, commentBody, neutralize, sectionLanguage, tickItems, validate, type Env } from "../../site/translation-feedback-worker/src/index";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const env: Env = {
  ALLOWED_ORIGINS: "https://forrt.org",
  GITHUB_REPO: "forrtproject/chromium-extension",
  GITHUB_ISSUE: "295",
  REVIEW_PAGE_URL: "https://forrt.org/chromium-extension/translate/feedback/",
  GITHUB_APP_ID: "123",
  GITHUB_APP_PRIVATE_KEY: pkcs1,
  TURNSTILE_SECRET: "secret",
  CONTACTS: { put: vi.fn(async () => {}) },
};

const valid = { language: "pt-PT", name: "Maria Silva", email: "maria@uni.example", message: "Definições está certo.", turnstileToken: "tok" };

function post(body: unknown, origin = "https://forrt.org"): Request {
  return new Request("https://worker.example/feedback", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.5" },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("translation feedback worker", () => {
  it("validates submissions and rejects the honeypot", () => {
    expect(validate(valid).ok).toBe(true);
    expect(validate({ ...valid, website: "spam.example" }).ok).toBe(false);
    expect(validate({ ...valid, language: "xx" }).ok).toBe(false);
    expect(validate({ ...valid, name: " " }).ok).toBe(false);
    expect(validate({ ...valid, email: "" }).ok).toBe(false);
    expect(validate({ ...valid, email: "not an email" }).ok).toBe(false);
    expect(validate({ ...valid, message: "x".repeat(4001) }).ok).toBe(false);
    expect(validate({ ...valid, turnstileToken: "" }).ok).toBe(false);
  });

  it("stops mentions, issue links, images and HTML from taking effect", () => {
    const out = neutralize("@someone see #12 and GH-3 ![x](http://t.example/p.png) <img src=x>");
    expect(out).not.toMatch(/@someone|#12|GH-3|!\[|<img/);
    expect(out).toContain("&lt;img");
  });

  it("formats the comment with the language and a quoted message", () => {
    const body = commentBody({ ...valid, name: "**Maria** @x", message: "line one\nline two" }, env.REVIEW_PAGE_URL);
    expect(body).toContain("<!-- ore-feedback:pt-PT -->");
    expect(body).toContain("Portuguese (Portugal) (`pt-PT`)");
    expect(body).toContain("\\*\\*Maria\\*\\* @​x");
    expect(body).toContain("> line one\n> line two");
    expect(body).toContain("https://forrt.org/chromium-extension/translate/feedback/#pt-PT");
  });

  it("signs a GitHub App JWT from PKCS#1 and PKCS#8 keys", async () => {
    for (const pem of [pkcs1, pkcs8]) {
      const jwt = await appJwt("123", pem, 1_700_000_000_000);
      const [head, claims, sig] = jwt.split(".");
      expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({ iss: "123", iat: 1_699_999_940 });
      const verify = createVerify("RSA-SHA256");
      verify.update(`${head}.${claims}`);
      expect(verify.verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
    }
  });

  it("rejects other origins and answers preflight for the review page", async () => {
    expect((await worker.fetch(post(valid, "https://evil.example"), env)).status).toBe(403);
    const pre = await worker.fetch(new Request("https://worker.example/feedback", {
      method: "OPTIONS", headers: { Origin: "https://forrt.org" },
    }), env);
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("https://forrt.org");
  });

  it("verifies Turnstile, then posts the comment as the app installation", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("turnstile")) return Response.json({ success: true });
      if (url.endsWith("/installation")) return Response.json({ id: 42 });
      if (url.includes("/access_tokens")) return Response.json({ token: "ghs_x", expires_at: new Date(Date.now() + 3600e3).toISOString() });
      if (url.endsWith("/issues/295/comments")) return Response.json({ id: 777, html_url: "https://github.com/c/1" }, { status: 201 });
      return new Response("", { status: 404 });
    }));
    const res = await worker.fetch(post(valid), env);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, url: "https://github.com/c/1" });
    const comment = calls.find((c) => c.url.endsWith("/comments"))!;
    expect((comment.init!.headers as Record<string, string>).Authorization).toBe("Bearer ghs_x");
    const posted = JSON.parse(comment.init!.body as string).body as string;
    expect(posted).toContain("Feedback from Maria Silva");
    expect(posted).not.toContain("maria@uni.example");
    expect(env.CONTACTS.put).toHaveBeenCalledWith(
      "comment:777",
      expect.stringContaining("maria@uni.example"),
      expect.objectContaining({ expirationTtl: CONTACT_TTL_SECONDS, metadata: expect.objectContaining({ email: "maria@uni.example", language: "pt-PT" }) }),
    );
  });

  it("serves the issue thread with only the fields the page needs", async () => {
    const comment = { id: 1, html_url: "h", body: "b", body_html: "<p>b</p>", created_at: "c", updated_at: "u", user: { login: "l", html_url: "lu", email: "x" }, reactions: {} };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/installation")) return Response.json({ id: 42 });
      if (url.includes("/access_tokens")) return Response.json({ token: "ghs_y", expires_at: new Date(Date.now() + 3600e3).toISOString() });
      if (url.endsWith("/issues/295")) return Response.json({ body_html: "<p>intro</p>", html_url: "i" });
      if (url.includes("/comments?")) return Response.json([comment]);
      return new Response("", { status: 404 });
    }));
    const res = await worker.fetch(new Request("https://worker.example/comments", { headers: { Origin: "https://forrt.org" } }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://forrt.org");
    const data = await res.json();
    expect(data.issue.body_html).toBe("<p>intro</p>");
    expect(data.comments[0]).toEqual({ id: 1, html_url: "h", body: "b", body_html: "<p>b</p>", created_at: "c", updated_at: "u", user: { login: "l", html_url: "lu" } });
  });

  it("ticks only existing, unticked checklist items", () => {
    const body = "## French (`fr`)\n\nPlease check:\n\n- [ ] One\n- [x] Two\n- [ ] Three\n";
    expect(sectionLanguage(body)).toBe("fr");
    expect(tickItems(body, [0, 1])).toEqual({ body: body.replace("- [ ] One", "- [x] One"), ticked: ["One"] });
    expect(tickItems(body, [5])).toBeNull();
    expect(validate({ ...valid, message: "", confirm: { commentId: 9, items: [0] } }).ok).toBe(true);
    expect(validate({ ...valid, message: "" }).ok).toBe(false);
    expect(validate({ ...valid, language: "general", confirm: { commentId: 9, items: [0] } }).ok).toBe(false);
    expect(validate({ ...valid, confirm: { commentId: 9, items: ["0"] } }).ok).toBe(false);
  });

  it("confirms checks on the language comment and credits the reviewer", async () => {
    const section = "## European Portuguese (`pt-PT`)\n\n- [ ] Examples mean the same\n- [ ] Terms are right\n";
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("turnstile")) return Response.json({ success: true });
      if (url.endsWith("/installation")) return Response.json({ id: 42 });
      if (url.includes("/access_tokens")) return Response.json({ token: "ghs_z", expires_at: new Date(Date.now() + 3600e3).toISOString() });
      if (url.endsWith("/issues/comments/55") && !init?.method) {
        return Response.json({ body: section, issue_url: "https://api.github.com/repos/forrtproject/chromium-extension/issues/295" });
      }
      if (url.endsWith("/issues/comments/55")) return Response.json({});
      if (url.endsWith("/issues/295/comments")) return Response.json({ id: 778, html_url: "https://github.com/c/2" }, { status: 201 });
      return new Response("", { status: 404 });
    }));
    const res = await worker.fetch(post({ ...valid, message: "", confirm: { commentId: 55, items: [1] } }), env);
    expect(res.status).toBe(201);
    const patch = calls.find((c) => c.init?.method === "PATCH")!;
    expect(JSON.parse(patch.init!.body as string).body).toBe(section.replace("- [ ] Terms", "- [x] Terms"));
    const posted = JSON.parse(calls.find((c) => c.url.endsWith("/295/comments"))!.init!.body as string).body;
    expect(posted).toContain("Checks confirmed by Maria Silva");
    expect(posted).toContain("- ✅ Terms are right");
  });

  it("refuses to tick a comment on another issue or for another language", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("turnstile")) return Response.json({ success: true });
      if (url.endsWith("/installation")) return Response.json({ id: 42 });
      if (url.includes("/access_tokens")) return Response.json({ token: "ghs_w", expires_at: new Date(Date.now() + 3600e3).toISOString() });
      if (url.endsWith("/issues/comments/56")) return Response.json({ body: "## French (`fr`)\n- [ ] A", issue_url: "https://api.github.com/repos/forrtproject/chromium-extension/issues/295" });
      return new Response("", { status: 500 });
    }));
    const res = await worker.fetch(post({ ...valid, confirm: { commentId: 56, items: [0] } }), env);
    expect(res.status).toBe(400);
  });

  it("does not post when Turnstile fails", async () => {
    const fetchMock = vi.fn(async (url: string) => (url.includes("turnstile") ? Response.json({ success: false }) : new Response("", { status: 500 })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await worker.fetch(post(valid), env)).status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
