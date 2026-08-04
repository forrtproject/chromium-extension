import {afterEach, describe, expect, it} from "vitest";
import {isBotCheckPage} from "../../src/shared/bot-check";

/** Build a document from a title and body markup. */
function page(title: string, body: string): Document {
  const doc = document.implementation.createHTMLDocument(title);
  doc.body.innerHTML = body;
  return doc;
}

const CHALLENGE_SCRIPT =
  `<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=8f0"></script>`;
// Cloudflare's Bot Fight Mode injects this into ordinary pages as well.
const DETECTION_SCRIPT = `<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>`;
const ARTICLE = `<h1>Emotion regulation</h1><p>doi:10.1177/0956797610383437</p>`;

describe("isBotCheckPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.title = "";
  });

  it("spots the interstitial by its challenge markup", () => {
    expect(isBotCheckPage(page("Just a moment...",
      `<div id="challenge-running">${CHALLENGE_SCRIPT}<form id="challenge-form"></form></div>`))).toBe(true);
    expect(isBotCheckPage(page("Please wait…",
      `<div class="cf-browser-verification"></div>`))).toBe(true);
  });

  it("spots block and rate-limit pages too", () => {
    // Error 1015/1020: not a challenge the reader can clear, but just as
    // certainly not the article that was asked for.
    expect(isBotCheckPage(page("Access denied",
      `<div id="cf-wrapper"><div id="cf-error-details">Error 1020</div></div>`))).toBe(true);
  });

  it("falls back to the title only when a challenge script is present", () => {
    expect(isBotCheckPage(page("Just a moment...", CHALLENGE_SCRIPT))).toBe(true);
    // A page that merely calls itself "Just a moment" is still a page.
    expect(isBotCheckPage(page("Just a moment...", ARTICLE))).toBe(false);
  });

  it("leaves ordinary pages behind Cloudflare alone", () => {
    // Bot Fight Mode puts a cdn-cgi script on every page it fronts; treating
    // that as a challenge would silence FLoRA across whole publishers.
    expect(isBotCheckPage(page("Emotion regulation | Journal", DETECTION_SCRIPT + ARTICLE))).toBe(false);
    expect(isBotCheckPage(page("Emotion regulation | Journal", ARTICLE))).toBe(false);
  });

  it("reads the live document by default", () => {
    expect(isBotCheckPage()).toBe(false);
    document.body.innerHTML = `<form id="challenge-form"></form>`;
    expect(isBotCheckPage()).toBe(true);
  });
});
