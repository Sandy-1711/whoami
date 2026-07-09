import { describe, it, expect, vi, afterEach } from "vitest";
import { githubUsername, scrapeGithub } from "./github.js";

describe("githubUsername", () => {
    it("should return a plain handle unchanged", () => {
        expect(githubUsername("Sandy-1711")).toBe("Sandy-1711");
    });
    it("should extract the handle from a profile URL", () => {
        expect(githubUsername("https://github.com/Sandy-1711")).toBe("Sandy-1711");
        expect(githubUsername("https://github.com/Sandy-1711/whoami")).toBe("Sandy-1711");
        expect(githubUsername("github.com/Sandy-1711?tab=repos")).toBe("Sandy-1711");
    });
    it("should strip a leading @ from a handle", () => {
        expect(githubUsername("@Sandy-1711")).toBe("Sandy-1711");
    });
    it("should return an empty string for empty input", () => {
        expect(githubUsername("")).toBe("");
        expect(githubUsername(undefined)).toBe("");
    });
});

// A fetch stub that answers by URL shape, so scrapeGithub can run offline.
function stubGithubApi(): void {
    const json = (data: unknown) => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => data,
        text: async () => "",
    });

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        if (url.includes("/search/issues")) {
            return json({
                items: [
                    { repository_url: "https://api.github.com/repos/mastra-ai/mastra", pull_request: { merged_at: "2026-01-01" }, state: "closed", number: 1, title: "feat", html_url: "pr1" },
                    { repository_url: "https://api.github.com/repos/mastra-ai/mastra", pull_request: {}, state: "open", number: 2, title: "wip", html_url: "pr2" },
                    { repository_url: "https://api.github.com/repos/Sandy-1711/whoami", pull_request: { merged_at: "2026-01-01" }, state: "closed", number: 3, title: "self", html_url: "pr3" },
                ],
            });
        }
        if (url.includes("/users/")) {
            return json([
                { name: "whoami", fork: false, description: "d", html_url: "u1", homepage: "", stargazers_count: 10, language: "TS", topics: [], archived: false, pushed_at: "2026-01-02" },
                { name: "forked", fork: true, stargazers_count: 99, pushed_at: "2026-01-03" },
                { name: "older", fork: false, description: "", html_url: "u2", homepage: "", stargazers_count: 5, language: "JS", topics: [], archived: false, pushed_at: "2026-01-01" },
            ]);
        }
        // /repos/<owner>/<name> — star enrichment for an external repo.
        return json({ stargazers_count: 25000 });
    }));
}

describe("scrapeGithub", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("should aggregate own repos and external PR contributions", async () => {
        stubGithubApi();
        const data = await scrapeGithub({ username: "Sandy-1711" });

        // Forks excluded; own repos sorted by stars desc.
        expect(data.repos.map((r) => r.name)).toEqual(["whoami", "older"]);
        expect(data.totals.publicRepos).toBe(2);
        expect(data.totals.totalStars).toBe(15);

        // The self-authored PR on an own repo is skipped; only the external repo counts.
        expect(data.totals.externalRepos).toBe(1);
        expect(data.totals.mergedPRs).toBe(1);
        const mastra = data.contributions[0];
        expect(mastra.repo).toBe("mastra-ai/mastra");
        expect(mastra.merged).toBe(1);
        expect(mastra.open).toBe(1);
        expect(mastra.stars).toBe(25000); // enriched from /repos/<repo>
    });

    it("should throw when no username can be resolved", async () => {
        await expect(scrapeGithub({ username: "" })).rejects.toThrow(/No GitHub username/);
    });
});
