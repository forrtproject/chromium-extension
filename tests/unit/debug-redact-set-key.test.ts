import { describe, it, expect } from "vitest";
import { redactDebugText } from "../../src/shared/debug-redact";

const TOKEN = "d7dbaac1.hT9v1RkQ0s_bXm4pE7ZLn2yWgC8jUdA6oIvF3rKqNxM";
const KEY = TOKEN.split(".")[1];

describe("redacting DOI-set keys", () => {
  it("drops the key but keeps the id a set can be traced by", () => {
    expect(redactDebugText(`Created DOI set ${TOKEN} for 312 DOIs`)).toBe(
      "Created DOI set d7dbaac1.[redacted key] for 312 DOIs"
    );
  });

  it("catches a token riding inside an Atlas URL", () => {
    const out = redactDebugText(
      `Navigating to https://forrt.org/flora-replication-atlas/?set=${TOKEN}`
    );
    expect(out).not.toContain(KEY);
    expect(out).toContain("?set=d7dbaac1.[redacted key]");
  });

  it("leaves a bare row id alone", () => {
    expect(redactDebugText("Created DOI set d7dbaac1")).toBe("Created DOI set d7dbaac1");
  });

  it("does not mistake a DOI for a token", () => {
    const doi = "10.1037/xge0001132";
    expect(redactDebugText(`Looking up ${doi}`)).toContain(doi);
  });
});
