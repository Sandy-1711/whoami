import { describe, it, expect } from "vitest";
import { applyCuration, EMPTY_CURATION } from "./curation.js";
import type { GithubData, GithubRepo } from "../types.js";

function repo(name: string, over: Partial<GithubRepo> = {}): GithubRepo {
    return {
        name,
        description: "",
        url: `https://github.com/sandy/${name}`,
        homepage: "",
        stars: 0,
        language: "",
        topics: [],
        archived: false,
        pushedAt: "2026-01-01T00:00:00Z",
        fork: false,
        readmeSize: 0,
        ...over,
    };
}

function data(): GithubData {
    return {
        _comment: "",
        scrapedAt: "2026-01-01T00:00:00Z",
        username: "sandy",
        profileUrl: "https://github.com/sandy",
        totals: { publicRepos: 3, totalStars: 15, mergedPRs: 13, externalRepos: 2 },
        repos: [
            repo("starter", { stars: 9 }),
            repo("portfolio", { stars: 6 }),
            repo("rag-engine", { stars: 1 }),
            repo("mastra", { stars: 1, fork: true }),
        ],
        contributions: [
            { repo: "mastra-ai/mastra", url: "u", merged: 12, open: 1, closedUnmerged: 0, samplePRs: [] },
            { repo: "acme/erp", url: "u", merged: 1, open: 0, closedUnmerged: 2, samplePRs: [] },
        ],
    };
}

describe("applyCuration", () => {
    it("returns the data untouched when curation is empty", () => {
        const d = data();
        expect(applyCuration(d, EMPTY_CURATION)).toBe(d);
    });

    it("drops banned own repos (bare name, case-insensitive) and recomputes totals", () => {
        const r = applyCuration(data(), { pin: [], ban: ["Starter", "sandy/portfolio"] });
        expect(r.repos.map((x) => x.name)).toEqual(["rag-engine", "mastra"]);
        expect(r.totals.publicRepos).toBe(1);       // only rag-engine (mastra is a fork)
        expect(r.totals.totalStars).toBe(1);
    });

    it("drops banned contributions by owner/name and recomputes PR totals", () => {
        const r = applyCuration(data(), { pin: [], ban: ["acme/erp"] });
        expect(r.contributions.map((c) => c.repo)).toEqual(["mastra-ai/mastra"]);
        expect(r.totals.mergedPRs).toBe(12);
        expect(r.totals.externalRepos).toBe(1);
    });

    it("floats pinned repos first in pin-list order and flags them", () => {
        const r = applyCuration(data(), { pin: ["rag-engine", "mastra"], ban: [] });
        expect(r.repos.map((x) => x.name)).toEqual(["rag-engine", "mastra", "starter", "portfolio"]);
        expect(r.repos[0]!.pinned).toBe(true);
        expect(r.repos[1]!.pinned).toBe(true);      // a pinned fork still surfaces
        expect(r.repos[2]!.pinned).toBeUndefined();
    });

    it("pins contributions by full owner/name", () => {
        const r = applyCuration(data(), { pin: ["acme/erp"], ban: [] });
        expect(r.contributions.map((c) => c.repo)).toEqual(["acme/erp", "mastra-ai/mastra"]);
        expect(r.contributions[0]!.pinned).toBe(true);
    });

    it("does not let a bare contribution name ban an unrelated own repo's twin", () => {
        // "mastra" bans the OWN fork, not the external mastra-ai/mastra contribution.
        const r = applyCuration(data(), { pin: [], ban: ["mastra"] });
        expect(r.repos.some((x) => x.name === "mastra")).toBe(false);
        expect(r.contributions.some((c) => c.repo === "mastra-ai/mastra")).toBe(true);
    });
});
