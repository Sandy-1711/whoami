import { describe, it, expect } from "vitest";
import {
    buildProfileDigest,
    renderProfileDigest,
    DIGEST_REPO_CAP,
    DIGEST_CONTRIBUTION_CAP,
    DIGEST_PR_TITLE_CAP,
} from "./digest.js";
import { EMPTY_CURATION } from "./curation.js";
import type { GithubData, GithubRepo, GithubContribution, LinkedinData } from "../types.js";

const NOW = Date.parse("2026-07-01T00:00:00Z");

function repo(name: string, over: Partial<GithubRepo> = {}): GithubRepo {
    return {
        name,
        description: "",
        url: `https://github.com/sandy/${name}`,
        homepage: "",
        stars: 0,
        language: "TypeScript",
        topics: [],
        archived: false,
        pushedAt: "2024-01-01T00:00:00Z", // old — no recency bonus by default
        fork: false,
        readmeSize: 0,
        ...over,
    };
}

function contribution(repoName: string, over: Partial<GithubContribution> = {}): GithubContribution {
    return {
        repo: repoName,
        url: `https://github.com/${repoName}`,
        merged: 1,
        open: 0,
        closedUnmerged: 0,
        samplePRs: [],
        ...over,
    };
}

function github(over: Partial<GithubData> = {}): GithubData {
    return {
        _comment: "",
        scrapedAt: "2026-06-01T00:00:00Z",
        username: "sandy",
        profileUrl: "https://github.com/sandy",
        totals: { publicRepos: 3, totalStars: 15, mergedPRs: 13, externalRepos: 2 },
        repos: [
            repo("starter", { stars: 9, description: "A starter kit" }),
            repo("portfolio", { stars: 6 }),
            repo("rag-engine", { stars: 1 }),
            repo("some-fork", { stars: 20, fork: true }),
        ],
        contributions: [
            contribution("mastra-ai/mastra", {
                merged: 12,
                stars: 26187,
                samplePRs: [
                    { number: 1, title: "fix: resolve memory leak in agent stream", state: "merged", url: "u" },
                    { number: 2, title: "feat: add tool timeout option", state: "open", url: "u" },
                    { number: 3, title: "fix: correct thread ordering", state: "merged", url: "u" },
                ],
            }),
            contribution("acme/erp", { merged: 6 }),
        ],
        ...over,
    };
}

function linkedin(): LinkedinData {
    return {
        _comment: "",
        scrapedAt: "2026-06-01T00:00:00Z",
        via: "pdf",
        profileUrl: "https://linkedin.com/in/sandy",
        profile: {
            name: "Sandeep Singh",
            headline: "AI Engineer · Mastra contributor",
            experience: [
                {
                    company: "Indigle",
                    title: "Founding Software Engineer",
                    dates: "2025 – present",
                    description: "Built the agent platform from scratch. Also did many other things over time.",
                },
                { company: "AiRA", title: "SWE Intern" },
            ],
            education: [],
            skills: [],
        },
    };
}

describe("buildProfileDigest — repo selection", () => {
    it("excludes forks and archived repos", () => {
        const d = buildProfileDigest(
            github({ repos: [repo("keep", { stars: 1 }), repo("fork", { fork: true, stars: 50 }), repo("old", { archived: true, stars: 50 })] }),
            null, EMPTY_CURATION, NOW,
        );
        expect(d.github!.repos.map((r) => r.name)).toEqual(["keep"]);
    });

    it("ranks by stars, with recency and description bonuses breaking ties", () => {
        const d = buildProfileDigest(
            github({
                repos: [
                    repo("stale-nodesc", { stars: 2 }),
                    repo("recent", { stars: 2, pushedAt: "2026-06-20T00:00:00Z" }), // +4 recency
                    repo("described", { stars: 2, description: "has one" }),        // +2 description
                    repo("big", { stars: 5 }),
                ],
            }),
            null, EMPTY_CURATION, NOW,
        );
        expect(d.github!.repos.map((r) => r.name)).toEqual(["big", "recent", "described", "stale-nodesc"]);
    });

    it("pinned repos come first in pin order, even with zero stars", () => {
        const d = buildProfileDigest(
            github(),
            null,
            { pin: ["rag-engine", "portfolio"], ban: [] },
            NOW,
        );
        expect(d.github!.repos.map((r) => r.name).slice(0, 2)).toEqual(["rag-engine", "portfolio"]);
        expect(d.github!.repos[0].pinned).toBe(true);
    });

    it("banned repos never appear and totals shrink", () => {
        const d = buildProfileDigest(github(), null, { pin: [], ban: ["starter"] }, NOW);
        expect(d.github!.repos.map((r) => r.name)).not.toContain("starter");
        expect(d.github!.totals.totalStars).toBe(7); // 6 (portfolio) + 1 (rag-engine)
    });

    it("caps at DIGEST_REPO_CAP repos", () => {
        const many = Array.from({ length: 20 }, (_, i) => repo(`r${i}`, { stars: i }));
        const d = buildProfileDigest(github({ repos: many }), null, EMPTY_CURATION, NOW);
        expect(d.github!.repos).toHaveLength(DIGEST_REPO_CAP);
    });

    it("never drops a pinned repo, even past the cap", () => {
        const many = Array.from({ length: 12 }, (_, i) => repo(`r${i}`, { stars: i }));
        const pin = many.map((r) => r.name);
        const d = buildProfileDigest(github({ repos: many }), null, { pin, ban: [] }, NOW);
        expect(d.github!.repos).toHaveLength(12);
        expect(d.github!.repos.every((r) => r.pinned)).toBe(true);
        // Pins fill the cap first; unpinned repos only get the leftover slots.
        const some = buildProfileDigest(github({ repos: many }), null, { pin: pin.slice(0, 3), ban: [] }, NOW);
        expect(some.github!.repos).toHaveLength(DIGEST_REPO_CAP);
        expect(some.github!.repos.slice(0, 3).map((r) => r.name)).toEqual(pin.slice(0, 3));
    });

    it("clamps long descriptions", () => {
        const d = buildProfileDigest(
            github({ repos: [repo("wordy", { stars: 1, description: "x".repeat(300) })] }),
            null, EMPTY_CURATION, NOW,
        );
        expect(d.github!.repos[0].description.length).toBeLessThanOrEqual(111);
        expect(d.github!.repos[0].description.endsWith("…")).toBe(true);
    });
});

describe("buildProfileDigest — contributions", () => {
    it("drops merged:0 contributions and sorts by merged desc", () => {
        const d = buildProfileDigest(
            github({
                contributions: [
                    contribution("a/low", { merged: 2 }),
                    contribution("b/none", { merged: 0, open: 3 }),
                    contribution("c/high", { merged: 9 }),
                ],
            }),
            null, EMPTY_CURATION, NOW,
        );
        expect(d.github!.contributions.map((c) => c.repo)).toEqual(["c/high", "a/low"]);
    });

    it("caps contributions and PR titles, preferring merged PRs", () => {
        const many = Array.from({ length: 9 }, (_, i) => contribution(`o/c${i}`, { merged: i + 1 }));
        const d = buildProfileDigest(github({ contributions: many }), null, EMPTY_CURATION, NOW);
        expect(d.github!.contributions).toHaveLength(DIGEST_CONTRIBUTION_CAP);

        const withPrs = buildProfileDigest(github(), null, EMPTY_CURATION, NOW);
        const titles = withPrs.github!.contributions[0].topPrTitles;
        // Every sample PR surfaces (the scrape keeps ≤ DIGEST_PR_TITLE_CAP),
        // merged first, non-merged states flagged.
        expect(titles.length).toBeLessThanOrEqual(DIGEST_PR_TITLE_CAP);
        expect(titles).toHaveLength(3);
        expect(titles[0]).toContain("memory leak");
        expect(titles[1]).toContain("thread ordering");
        expect(titles[2]).toBe("feat: add tool timeout option [open]");
    });
});

describe("buildProfileDigest — linkedin", () => {
    it("takes the headline and the first sentence of each role description", () => {
        const d = buildProfileDigest(null, linkedin(), EMPTY_CURATION, NOW);
        expect(d.linkedin!.headline).toContain("Mastra");
        expect(d.linkedin!.roles[0].oneLiner).toBe("Built the agent platform from scratch.");
        expect(d.linkedin!.roles[1].oneLiner).toBe("");
    });
});

describe("buildProfileDigest — null inputs", () => {
    it("returns null sections and renders to empty string", () => {
        const d = buildProfileDigest(null, null);
        expect(d.github).toBeNull();
        expect(d.linkedin).toBeNull();
        expect(renderProfileDigest(d)).toBe("");
    });
});

describe("renderProfileDigest", () => {
    it("renders repos, contributions, and roles compactly", () => {
        const text = renderProfileDigest(buildProfileDigest(github(), linkedin(), EMPTY_CURATION, NOW));
        expect(text).toContain("GitHub (sandy):");
        expect(text).toContain("- starter ★9");
        expect(text).toContain("mastra-ai/mastra — 12 merged");
        expect(text).toContain('"fix: resolve memory leak in agent stream"');
        expect(text).toContain("LinkedIn: AI Engineer · Mastra contributor");
        expect(text).toContain("- Founding Software Engineer, Indigle (2025 – present)");
    });

    it("stays under ~4 KB even for a large profile", () => {
        const many = Array.from({ length: 64 }, (_, i) =>
            repo(`repo-${i}`, { stars: i, description: "A realistic description of the project ".repeat(4) }),
        );
        const contribs = Array.from({ length: 16 }, (_, i) =>
            contribution(`org/c${i}`, {
                merged: i + 1,
                samplePRs: Array.from({ length: 6 }, (_, j) => ({
                    number: j, title: `feat: a reasonably long pull-request title number ${j}`, state: "merged", url: "u",
                })),
            }),
        );
        const text = renderProfileDigest(
            buildProfileDigest(github({ repos: many, contributions: contribs }), linkedin(), EMPTY_CURATION, NOW),
        );
        expect(text.length).toBeLessThanOrEqual(4096);
    });
});
