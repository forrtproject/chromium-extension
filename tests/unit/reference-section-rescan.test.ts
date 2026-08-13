import { describe, it, expect, beforeEach } from "vitest";
import { touchesReferenceSection } from "../../src/shared/doi-extractor";
import { scanAddedNodes } from "../../src/content-general/dom-listener";

describe("touchesReferenceSection", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("matches an element that is itself a reference container", () => {
    const el = document.createElement("ol");
    el.className = "references";
    document.body.appendChild(el);
    expect(touchesReferenceSection(el)).toBe(true);
  });

  it("matches an entry added inside an existing reference container", () => {
    document.body.innerHTML = '<section id="ref-list"><ul></ul></section>';
    const li = document.createElement("li");
    li.textContent = "Smith, J. (2020). A paper without a DOI. Journal of Things.";
    document.querySelector("ul")!.appendChild(li);
    expect(touchesReferenceSection(li)).toBe(true);
  });

  it("matches a subtree that contains a reference container", () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = '<div class="article-references"><li>Entry</li></div>';
    document.body.appendChild(wrapper);
    expect(touchesReferenceSection(wrapper)).toBe(true);
  });

  it("does not match unrelated content", () => {
    const el = document.createElement("div");
    el.className = "article-body";
    el.innerHTML = "<p>Plain text</p>";
    document.body.appendChild(el);
    expect(touchesReferenceSection(el)).toBe(false);
  });
});

describe("scanAddedNodes with DOI-less reference entries", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("requests a scan for lazy-loaded citations that carry no DOI text", () => {
    document.body.innerHTML = '<section class="references"><ul></ul></section>';
    const li = document.createElement("li");
    li.textContent = "Doe, A. (2019). No identifier here. Some Conference.";
    document.querySelector("ul")!.appendChild(li);
    expect(scanAddedNodes([li])).toBe(true);
  });

  it("still skips additions with neither DOIs nor reference context", () => {
    const div = document.createElement("div");
    div.textContent = "A banner advert";
    document.body.appendChild(div);
    expect(scanAddedNodes([div])).toBe(false);
  });
});
