import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {extractPubPeerComments, isPubPeerCommentsRequest, isPubPeerThreadUrl, pubPeerThreadUrl} from "../../src/shared/pubpeer-comments";
import {renderCommentMarkdown} from "../../src/content-general/pubpeer-comments-view";
import {removeSidePanel, renderSidePanel} from "../../src/content-general/injector";
import type {PubPeerFeedback} from "../../src/shared/pubpeer-api";
import type {DoiContext, DoiString, LookupState} from "../../src/shared/types";

const THREAD = "https://pubpeer.com/publications/69477CA2ACFC09B9239A8A256F143C";

function rawComment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 79578,
        number: 1,
        user: "Peer 1",
        createdAt: "2015-12-14",
        date: "10 years ago",
        contentMarkdown: "This ANOVA is miscalculated.",
        isAuthorResponse: false,
        isEditorResponse: false,
        status: "published",
        ...overrides,
    };
}

function threadPage(comments: unknown): string {
    const page = {component: "publication", props: {publication: {commentsCount: 1}, comments}, url: "/publications/X"};
    return `<!DOCTYPE html><html><head><script nonce="n">const Ziggy={};</script></head><body>` +
        `<script data-page="app" type="application/json">${JSON.stringify(page).replace(/\//g, "\\/")}</script>` +
        `<div id="app"></div></body></html>`;
}

describe("extractPubPeerComments", () => {
    it("reads the comments from the page's embedded data", () => {
        const comments = extractPubPeerComments(threadPage([
            rawComment(),
            rawComment({id: 2, number: 2, user: "Dana Carney", isAuthorResponse: true, contentMarkdown: "Reply"}),
        ]));

        expect(comments).toEqual([
            {id: 79578, number: 1, user: "Peer 1", createdAt: "2015-12-14", markdown: "This ANOVA is miscalculated.", isAuthorResponse: false, isEditorResponse: false},
            {id: 2, number: 2, user: "Dana Carney", createdAt: "2015-12-14", markdown: "Reply", isAuthorResponse: true, isEditorResponse: false},
        ]);
    });

    it("skips comments that are not published or have no body", () => {
        const comments = extractPubPeerComments(threadPage([
            rawComment({id: 1, status: "pending"}),
            rawComment({id: 2, contentMarkdown: null}),
            rawComment({id: 3}),
        ]));

        expect(comments?.map((c) => c.id)).toEqual([3]);
    });

    it("returns null when no published comment can be read, but [] for an all-unpublished thread", () => {
        expect(extractPubPeerComments(threadPage([{id: "x", status: "published"}, null]))).toBeNull();
        expect(extractPubPeerComments(threadPage([rawComment({status: "pending"})]))).toEqual([]);
        expect(extractPubPeerComments(threadPage([]))).toEqual([]);
    });

    it("returns null when the page carries no comment data", () => {
        expect(extractPubPeerComments("<html><body>Just a moment…</body></html>")).toBeNull();
        expect(extractPubPeerComments(`<script data-page="app" type="application/json">{not json</script>`)).toBeNull();
        expect(extractPubPeerComments(threadPage("nope"))).toBeNull();
    });
});

describe("PubPeer thread URLs", () => {
    it("fetches a www. thread from the host the extension may reach", () => {
        expect(pubPeerThreadUrl("https://www.pubpeer.com/publications/ABC123")).toBe("https://pubpeer.com/publications/ABC123");
        expect(isPubPeerCommentsRequest({type: "FLORA_PUBPEER_COMMENTS", url: "https://www.pubpeer.com/publications/ABC123"})).toBe(true);
    });

    it("accepts only https pubpeer.com publication pages", () => {
        expect(isPubPeerThreadUrl(THREAD)).toBe(true);
        expect(isPubPeerThreadUrl("http://pubpeer.com/publications/ABC")).toBe(false);
        expect(isPubPeerThreadUrl("https://evil.example/publications/ABC")).toBe(false);
        expect(isPubPeerThreadUrl("https://pubpeer.com.evil.example/publications/ABC")).toBe(false);
        expect(isPubPeerThreadUrl("https://pubpeer.com/settings")).toBe(false);
    });

    it("rejects comment requests for any other URL", () => {
        expect(isPubPeerCommentsRequest({type: "FLORA_PUBPEER_COMMENTS", url: THREAD})).toBe(true);
        expect(isPubPeerCommentsRequest({type: "FLORA_PUBPEER_COMMENTS", url: "https://example.com/"})).toBe(false);
        expect(isPubPeerCommentsRequest({type: "FLORA_PUBPEER_COMMENTS"})).toBe(false);
    });
});

describe("renderCommentMarkdown", () => {
    function render(markdown: string): HTMLDivElement {
        const div = document.createElement("div");
        div.appendChild(renderCommentMarkdown(markdown));
        return div;
    }

    it("turns titled Markdown links into links showing their label", () => {
        const div = render('see [http://statpages.org/anova1sm.html](http://statpages.org/anova1sm.html "http://statpages.org/anova1sm.html")');
        const a = div.querySelector("a")!;

        expect(a.href).toBe("http://statpages.org/anova1sm.html");
        expect(a.textContent).toBe("http://statpages.org/anova1sm.html");
        expect(a.target).toBe("_blank");
        expect(a.rel).toBe("noopener noreferrer");
    });

    it("unescapes underscores in link labels and targets", () => {
        const a = render("[http://x.org/dana\\_carney/pdf](http://x.org/dana_carney/pdf)").querySelector("a")!;

        expect(a.textContent).toBe("http://x.org/dana_carney/pdf");
        expect(a.getAttribute("href")).toBe("http://x.org/dana_carney/pdf");
    });

    it("links bare URLs without their trailing punctuation", () => {
        const div = render("Read https://retractionwatch.com/2016/03/07/a-b/. Then reply.");

        expect(div.querySelector("a")!.getAttribute("href")).toBe("https://retractionwatch.com/2016/03/07/a-b/");
        expect(div.textContent).toBe("Read https://retractionwatch.com/2016/03/07/a-b/. Then reply.");
    });

    it("keeps comment references like #2 as text, not headings", () => {
        const div = render("#2\n\nUnfortunately, I doubt it.");

        expect([...div.children].map((el) => [el.tagName, el.textContent])).toEqual([
            ["P", "#2"],
            ["P", "Unfortunately, I doubt it."],
        ]);
    });

    it("decodes HTML entities as text", () => {
        expect(render("p &lt; .01 &amp; r = .44").textContent).toBe("p < .01 & r = .44");
    });

    it("keeps balanced parentheses in a link target", () => {
        const a = render("see [the article](https://en.wikipedia.org/wiki/Power_(physics)) for more").querySelector("a")!;
        expect(a.getAttribute("href")).toBe("https://en.wikipedia.org/wiki/Power_(physics)");
        expect(a.textContent).toBe("the article");
    });

    it("shows an autolink's text decoded, as its href is", () => {
        const a = render("<https://example.org/a?x=1&amp;y=2>").querySelector("a")!;
        expect(a.textContent).toBe("https://example.org/a?x=1&y=2");
        expect(a.getAttribute("href")).toBe("https://example.org/a?x=1&y=2");
    });

    it("closes a code fence only on a bare fence line", () => {
        const pre = render(["```", "code line", "```not-a-fence", "more code", "```", "after"].join("\n")).querySelector("pre")!;
        expect(pre.textContent).toBe(["code line", "```not-a-fence", "more code"].join("\n"));
    });

    it("renders a long comment full of unmatched markers quickly", () => {
        const hostile = "*_`[ ".repeat(20_000);
        const started = performance.now();
        const div = render(hostile);
        expect(performance.now() - started).toBeLessThan(2000);
        expect(div.textContent!.length).toBeGreaterThan(50_000);
    });

    it("leaves unknown entity names, including inherited object keys, as written", () => {
        expect(render("&constructor; &toString; &bogus;").textContent).toBe("&constructor; &toString; &bogus;");
    });

    it("never creates elements from HTML in the comment", () => {
        const div = render('<img src=x onerror="alert(1)"> &lt;script&gt;alert(1)&lt;/script&gt;');

        expect(div.querySelector("img, script")).toBeNull();
        expect(div.textContent).toContain('<img src=x onerror="alert(1)">');
    });

    it("leaves non-web link targets unlinked", () => {
        const div = render("[click](javascript:alert(1)) and [mail](mailto:a@b.c)");

        expect(div.querySelector("a")).toBeNull();
    });

    it("renders bullet lists, emphasis and line breaks", () => {
        const div = render("* **Formal** response\n\n* *Informal* response\n\nLine one\nLine two");

        expect(div.querySelectorAll("ul > li")).toHaveLength(2);
        expect(div.querySelector("li strong")?.textContent).toBe("Formal");
        expect(div.querySelector("li em")?.textContent).toBe("Informal");
        expect(div.querySelector("p br")).not.toBeNull();
    });
});

describe("side panel comments", () => {
    const DOI = "10.1177/0956797610383437" as DoiString;
    const sendMessage = vi.mocked(chrome.runtime.sendMessage);

    function feedback(url: string): PubPeerFeedback {
        return {
            id: DOI,
            title: "Power Posing",
            total_comments: 2,
            total_peeriodical_comments: 0,
            last_commented_at: "2017-06-15",
            users: "Peer 1, FORRT",
            url,
        };
    }

    function render(url = THREAD): void {
        renderSidePanel([feedback(url)], [], new Map<DoiString, LookupState>(), new Map<DoiString, DoiContext>([[DOI, "article"]]), new Map(), []);
    }

    const openPanel = (): void => document.querySelector<HTMLElement>('[aria-label="Open the FORRT ORE panel"]')!.click();
    const commentsSection = (): HTMLElement => document.querySelector<HTMLElement>("[data-flora-pubpeer-comments]")!;
    const commentRequests = () => sendMessage.mock.calls.filter(([m]) => (m as {type?: string}).type === "FLORA_PUBPEER_COMMENTS");

    beforeEach(() => {
        document.body.innerHTML = "";
        sendMessage.mockReset();
    });

    afterEach(() => {
        removeSidePanel();
        sendMessage.mockReset();
        sendMessage.mockResolvedValue({type: "FLORA_LOOKUP_RESULT", results: {}, errors: {}});
    });

    it("waits for the panel to open before fetching the thread", async () => {
        sendMessage.mockResolvedValue({
            type: "FLORA_PUBPEER_COMMENTS_RESULT",
            comments: [
                {id: 1, number: 1, user: "Peer 1", createdAt: "2015-12-14", markdown: "First point.", isAuthorResponse: false, isEditorResponse: false},
                {id: 2, number: 2, user: "FORRT", createdAt: "2016-01-01", markdown: "Muted.", isAuthorResponse: false, isEditorResponse: false},
            ],
            error: null,
        });
        render();
        expect(commentRequests()).toHaveLength(0);

        openPanel();

        expect(commentRequests()).toEqual([[{type: "FLORA_PUBPEER_COMMENTS", url: THREAD}]]);
        await vi.waitFor(() => expect(commentsSection().querySelectorAll("li[data-flora-comment-id]")).toHaveLength(1));
        expect(commentsSection().textContent).toContain("First point.");
        expect(commentsSection().textContent).not.toContain("Muted.");
        expect(commentsSection().querySelector<HTMLAnchorElement>(`a[href="${THREAD}"]`)).not.toBeNull();
    });

    it("links to PubPeer when the comments cannot be fetched", async () => {
        const unreachable = "https://pubpeer.com/publications/UNREACHABLE";
        sendMessage.mockResolvedValue({type: "FLORA_PUBPEER_COMMENTS_RESULT", comments: null, error: "HTTP 503"});
        render(unreachable);

        openPanel();

        await vi.waitFor(() => expect(commentsSection().textContent).toContain("couldn't be loaded"));
        expect(commentsSection().querySelector<HTMLAnchorElement>("a")?.href).toBe(unreachable);
    });

    it("links straight to PubPeer, without a request or Retry, for a thread the worker can't fetch", async () => {
        sendMessage.mockResolvedValue({type: "FLORA_PUBPEER_COMMENTS_RESULT", comments: [], error: null});
        render("https://pubpeer.com/search?q=10.1177");

        openPanel();

        expect(commentRequests()).toHaveLength(0);
        expect(commentsSection().textContent).toContain("can only be read on PubPeer");
        expect(commentsSection().querySelector("button")).toBeNull();
    });

    it("retries a failed fetch from the panel", async () => {
        const flaky = "https://pubpeer.com/publications/FLAKY";
        sendMessage.mockResolvedValueOnce({type: "FLORA_PUBPEER_COMMENTS_RESULT", comments: null, error: "HTTP 503"});
        render(flaky);
        openPanel();
        await vi.waitFor(() => expect(commentsSection().textContent).toContain("couldn't be loaded"));

        sendMessage.mockResolvedValueOnce({
            type: "FLORA_PUBPEER_COMMENTS_RESULT",
            comments: [{id: 7, number: 1, user: "Peer 1", createdAt: "2020-01-01", markdown: "Back.", isAuthorResponse: false, isEditorResponse: false}],
            error: null,
        });
        [...commentsSection().querySelectorAll("button")].find((b) => b.textContent === "Retry")!.click();

        await vi.waitFor(() => expect(commentsSection().textContent).toContain("Back."));
        expect(commentRequests()).toHaveLength(2);
    });
});
