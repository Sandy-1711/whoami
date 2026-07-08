import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentHash, hashSources, writeLock, drift, isStale, recordScrape } from "./sources.js";

describe("contentHash", () => {
    it("should ignore the volatile _comment and scrapedAt fields", () => {
        const a = { _comment: "note", scrapedAt: "2026-01-01T00:00:00Z", data: [1, 2, 3] };
        const b = { _comment: "different note", scrapedAt: "2026-07-08T00:00:00Z", data: [1, 2, 3] };
        expect(contentHash(a)).toBe(contentHash(b));
    });
    it("should change when the meaningful content changes", () => {
        expect(contentHash({ data: [1] })).not.toBe(contentHash({ data: [2] }));
    });
    it("should tolerate null/undefined input", () => {
        expect(contentHash(null)).toBe(contentHash(undefined));
    });
});

describe("filesystem-backed source state", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "sources-test-"));
        await mkdir(join(root, "profile"), { recursive: true });
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    describe("drift", () => {
        it("should report unsynced with no baseline lock", async () => {
            const d = await drift(root);
            expect(d.synced).toBe(false);
            expect(d.lock).toBeNull();
        });
        it("should be in sync right after baselining, then flag a changed file", async () => {
            await writeLock(root, await hashSources(root)); // baseline: all sources absent
            expect((await drift(root)).synced).toBe(true);

            await writeFile(join(root, "profile", "facts.json"), '{"identity":{}}');
            const d = await drift(root);
            expect(d.synced).toBe(false);
            expect(d.changed).toContain("facts.json");
        });
    });

    describe("isStale", () => {
        it("should be stale when the source was never scraped", async () => {
            expect(await isStale(root, "github", 60_000)).toBe(true);
        });
        it("should not be stale immediately after recording a scrape", async () => {
            await recordScrape(root, "github", "hash");
            expect(await isStale(root, "github", 60 * 60_000)).toBe(false);
        });
        it("should be stale once the TTL has elapsed", async () => {
            const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
            await writeFile(
                join(root, "profile", "sources.lock.json"),
                JSON.stringify({ scrape: { github: { at: twoDaysAgo, hash: "h" } } }),
            );
            expect(await isStale(root, "github", 60 * 60_000)).toBe(true);
        });
    });
});
