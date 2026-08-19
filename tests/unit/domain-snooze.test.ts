import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

// Temporary per-site pauses live in chrome.storage.local as
// hostname → expiry epoch; the permanent blocked list stays in storage.sync.

const SNOOZE_KEY = "flora_snoozed_domains";
const BLACKLIST_KEY = "flora_blocked_domains";

let localStore: Record<string, unknown> = {};
let syncStore: Record<string, unknown> = {};

function backStorage(area: "local" | "sync", store: Record<string, unknown>): void {
  chrome.storage[area].get = vi.fn((keys: string | string[]) => {
    const names = typeof keys === "string" ? [keys] : keys;
    const out: Record<string, unknown> = {};
    for (const name of names) {
      if (name in store) out[name] = store[name];
    }
    return Promise.resolve(out);
  }) as unknown as typeof chrome.storage.local.get;
  chrome.storage[area].set = vi.fn((items: Record<string, unknown>) => {
    Object.assign(store, items);
    return Promise.resolve();
  }) as unknown as typeof chrome.storage.local.set;
}

async function loadDomains() {
  return import("../../src/shared/domains");
}

beforeEach(() => {
  localStore = {};
  syncStore = {};
  backStorage("local", localStore);
  backStorage("sync", syncStore);
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("domain snooze", () => {
  it("pauses a host for the requested duration", async () => {
    const {snoozeDomain, isDomainSnoozed, getSnooze} = await loadDomains();

    const until = await snoozeDomain("example.com", 60_000);

    expect(until).toBeGreaterThan(Date.now());
    await expect(isDomainSnoozed("example.com")).resolves.toBe(true);
    await expect(getSnooze("example.com")).resolves.toBe(until);
    expect(localStore[SNOOZE_KEY]).toEqual({"example.com": until});
  });

  it("covers subdomains of a paused domain", async () => {
    const {snoozeDomain, isDomainSnoozed} = await loadDomains();

    await snoozeDomain("example.com", 60_000);

    await expect(isDomainSnoozed("journals.example.com")).resolves.toBe(true);
    await expect(isDomainSnoozed("notexample.com")).resolves.toBe(false);
  });

  it("treats an expired pause as over and prunes it", async () => {
    const {snoozeDomain, isDomainSnoozed} = await loadDomains();

    await snoozeDomain("example.com", -1_000);

    await expect(isDomainSnoozed("example.com")).resolves.toBe(false);
    expect(localStore[SNOOZE_KEY]).toEqual({});
  });

  it("clears a pause on request", async () => {
    const {snoozeDomain, clearSnooze, isDomainSnoozed} = await loadDomains();

    await snoozeDomain("example.com", 60_000);
    await clearSnooze("example.com");

    await expect(isDomainSnoozed("example.com")).resolves.toBe(false);
    expect(localStore[SNOOZE_KEY]).toEqual({});
  });

  it("clears a parent-domain pause when resuming on a subdomain", async () => {
    const {snoozeDomain, clearSnooze, isDomainSnoozed} = await loadDomains();

    await snoozeDomain("example.com", 60_000);
    await clearSnooze("journals.example.com");

    await expect(isDomainSnoozed("journals.example.com")).resolves.toBe(false);
    await expect(isDomainSnoozed("example.com")).resolves.toBe(false);
  });

  it("adds a blocked domain once", async () => {
    const {blockDomain, getBlockedDomains} = await loadDomains();

    await blockDomain("example.com");
    await blockDomain("example.com");

    await expect(getBlockedDomains()).resolves.toEqual(["example.com"]);
    expect(syncStore[BLACKLIST_KEY]).toEqual(["example.com"]);
  });
});
