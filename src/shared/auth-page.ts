// Login / SSO gateway detection. See bot-check.ts for the same shape of guard.

const AUTH_PATH =
    /(?:^|\/)(?:login|log-in|signin|sign-in|sso|saml|oauth2?|openid|authorize|authenticate|authenticator|gateway|sessions?\/new|accounts?\/login)(?:\/|$)/i;

const REDIRECT_PARAMS = [
    "redirect_uri",
    "redirecturi",
    "redirect_url",
    "redirect",
    "target_redirect_uri",
    "targeturl",
    "return_to",
    "returnto",
    "return_url",
    "returnurl",
    "continue",
    "next",
    "destination",
    "goto",
    "service",
    "samlrequest",
];

const OAUTH_PARAMS = ["response_type", "client_id", "code_challenge"];

function paramNames(url: URL): Set<string> {
    return new Set([...url.searchParams.keys()].map((key) => key.toLowerCase()));
}

export function isAuthGatewayUrl(href: string): boolean {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return false;
    }
    const params = paramNames(url);
    const hasRedirect = REDIRECT_PARAMS.some((name) => params.has(name));

    if (hasRedirect && OAUTH_PARAMS.some((name) => params.has(name))) return true;

    return hasRedirect && AUTH_PATH.test(url.pathname);
}

export function isAuthGatewayPage(doc: Document = document): boolean {
    const href = doc.location?.href ?? "";
    if (isAuthGatewayUrl(href)) return true;

    try {
        return AUTH_PATH.test(new URL(href).pathname)
            && doc.querySelector('input[type="password"]') !== null;
    } catch {
        return false;
    }
}
