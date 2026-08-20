import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { isAuthGatewayPage, isAuthGatewayUrl } from "../../src/shared/auth-page";
import { extractPrimaryDOI } from "../../src/shared/doi-extractor";

const SPRINGER_GATEWAY =
    "https://idp-personal-authenticator.springernature.com/gateway?response_type=code"
    + "&redirect_uri=https%3A%2F%2Fidp.springernature.com%2Fauthed%2Fsso"
    + "&state=6471fef0-742f-45b2-84b5-57674a5947dc"
    + "&target_redirect_uri=https%3A%2F%2Flink.springer.com%2Farticle%2F10.1007%2Fs12144-024-05626-0";

function docAt(url: string, body = "<h1>Log in, or register a new account to continue</h1>"): Document {
    return new JSDOM(`<!DOCTYPE html><html><body>${body}</body></html>`, { url }).window.document;
}

describe("sign-in steps are not pages to annotate", () => {
    it("recognises the publisher SSO gateway the reader is passing through", () => {
        expect(isAuthGatewayUrl(SPRINGER_GATEWAY)).toBe(true);
        expect(isAuthGatewayPage(docAt(SPRINGER_GATEWAY))).toBe(true);
    });

    it.each([
        "https://idp.example.org/oauth/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fx.org%2Fa",
        "https://example.org/login?service=https%3A%2F%2Fjournal.org%2Farticle%2F10.1234%2Fx",
        "https://example.org/sso/saml?SAMLRequest=abc&RelayState=1&redirect_uri=https%3A%2F%2Fx.org",
        "https://example.org/accounts/login?next=%2Farticle%2F10.1234%2Fx",
    ])("recognises %s", (url) => {
        expect(isAuthGatewayUrl(url)).toBe(true);
    });

    it.each([
        "https://link.springer.com/article/10.1007/s12144-024-05626-0",
        "https://www.tandfonline.com/doi/full/10.1080/13678868.2017.1336692?scroll=top&needAccess=true",
        "https://example.org/articles/how-to-login-safely",
        "https://europepmc.org/search?query=%22reproducibility%22",
    ])("leaves the article page alone: %s", (url) => {
        expect(isAuthGatewayUrl(url)).toBe(false);
        expect(isAuthGatewayPage(docAt(url))).toBe(false);
    });

    it("counts a password form on a sign-in path", () => {
        const doc = docAt("https://example.org/signin", '<form><input type="password"></form>');

        expect(isAuthGatewayPage(doc)).toBe(true);
    });

    it("leaves an article carrying a login box alone", () => {
        const doc = docAt(
            "https://link.springer.com/article/10.1007/s12144-024-05626-0",
            '<form><input type="password"></form>'
        );

        expect(isAuthGatewayPage(doc)).toBe(false);
    });
});

describe("a DOI in a redirect parameter belongs to the page it points at", () => {
    it("does not read the gateway's redirect target as this page's DOI", () => {
        expect(extractPrimaryDOI(docAt(SPRINGER_GATEWAY))).toBeNull();
    });

    it("still reads a DOI out of the page's own path", () => {
        const doc = docAt("https://link.springer.com/article/10.1007/s12144-024-05626-0");

        expect(extractPrimaryDOI(doc)).toBe("10.1007/s12144-024-05626-0");
    });

    it("still reads a DOI out of a plain doi parameter", () => {
        const doc = docAt("https://example.org/reader?doi=10.1234%2Fabc.123&mode=full");

        expect(extractPrimaryDOI(doc)).toBe("10.1234/abc.123");
    });
});
