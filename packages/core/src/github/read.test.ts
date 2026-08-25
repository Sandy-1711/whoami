import { describe, it, expect, vi, afterEach } from "vitest";
import { GithubReader } from "./read.js";

const repo = (over: Record<string, unknown> = {}) => ({
    full_name: "acme-ai/agent-core", description: "Agent runtime", html_url: "https://github.com/acme-ai/agent-core",
    stargazers_count: 1200, language: "TypeScript", topics: ["agents"], pushed_at: "2026-08-01T00:00:00Z",
    archived: false, fork: false, ...over,
});

function reply(body: unknown, init: ResponseInit = {}): void {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200, ...init })));
}

afterEach(() => vi.unstubAllGlobals());

describe("GithubReader", () => {
    it("summarizes a repository down to what a draft can use", async () => {
        reply(repo());
        const r = await new GithubReader().repo("acme-ai", "agent-core");
        expect(r).toEqual({
            fullName: "acme-ai/agent-core", description: "Agent runtime", url: "https://github.com/acme-ai/agent-core",
            stars: 1200, language: "TypeScript", topics: ["agents"], pushedAt: "2026-08-01T00:00:00Z",
            archived: false, fork: false,
        });
    });

    it("lists an account's repositories by most recent activity", async () => {
        reply([repo(), repo({ full_name: "acme-ai/docs" })]);
        const repos = await new GithubReader().repos("acme-ai", 5);
        expect(repos.map((r) => r.fullName)).toEqual(["acme-ai/agent-core", "acme-ai/docs"]);
        const url = (globalThis.fetch as any).mock.calls[0][0] as string;
        expect(url).toContain("sort=pushed");
        expect(url).toContain("per_page=5");
    });

    it("decodes a README and truncates a runaway one", async () => {
        const long = "x".repeat(9000);
        reply({ content: Buffer.from(long, "utf8").toString("base64"), encoding: "base64" });
        const text = await new GithubReader().readme("acme-ai", "agent-core");
        expect(text!.length).toBeLessThan(long.length);
        expect(text!.endsWith("…(truncated)")).toBe(true);
    });

    it("returns null for a repository with no README rather than throwing", async () => {
        reply({}, { status: 404 });
        expect(await new GithubReader().readme("acme-ai", "agent-core")).toBeNull();
    });

    it("unwraps search results", async () => {
        reply({ items: [repo()] });
        const found = await new GithubReader().searchRepos("agent orchestration", 3);
        expect(found[0].fullName).toBe("acme-ai/agent-core");
    });

    it("says the rate limit is the problem, not a missing scope", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
            status: 403,
            headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 600) },
        })));
        await expect(new GithubReader().repo("acme-ai", "agent-core")).rejects.toThrow(/rate limit.*GITHUB_TOKEN/s);
    });

    it("sends the token only when there is one", async () => {
        reply(repo());
        await new GithubReader().repo("acme-ai", "agent-core");
        expect((globalThis.fetch as any).mock.calls[0][1].headers.Authorization).toBeUndefined();

        reply(repo());
        await new GithubReader("tok").repo("acme-ai", "agent-core");
        expect((globalThis.fetch as any).mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
    });
});
