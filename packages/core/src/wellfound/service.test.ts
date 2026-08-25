import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WellfoundService } from "./service.js";
import { silentPresenter } from "../ports/logger.js";
import { createFakeLlm } from '@resume/llm/testing';

const MESSAGE = { message: "I shipped RAG agents on FastAPI at AiRA.", rationale: "leads with proof" };
const PROFILE = {
    headline: "AI Engineer — Agent Infra",
    bio: "AI engineer with 12 merged PRs into Mastra's agent runtime; shipped production agents at AiRA.",
    looking_for: "remote AI eng at an early-stage startup",
    achievements: ["Merged 12 PRs into Mastra (25k+ stars)", "Fine-tuned Qwen to 75% accuracy"],
    skills: ["TypeScript", "RAG", "FastAPI"],
    experience: [{ label: "AiRA — AI Engineer", blurb: "Built the Daily Brief agent." }],
    rationale: "led with the Mastra OSS proof",
};

const roots: string[] = [];
async function makeRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "wf-"));
    roots.push(root);
    await mkdir(join(root, "profile"), { recursive: true });
    await writeFile(join(root, "profile", "facts.json"), JSON.stringify({
        identity: { name: "Sandeep Singh" }, allowed_keywords: ["RAG", "FastAPI"], skills: { AI: ["RAG", "FastAPI"] },
    }));
    await writeFile(join(root, "resume.tex"), "\\section{x} FastAPI RAG agents");
    return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });

const JD = "We are hiring an AI Engineer to build RAG agents with FastAPI. Remote, Kubernetes a plus.";

describe("WellfoundService.message", () => {
    it("writes the per-JD note under tailored/<slug> and grounds it in real keywords", async () => {
        const root = await makeRoot();
        const svc = new WellfoundService({ root, presenter: silentPresenter });
        const res = await svc.message({ jd: JD, company: "Acme AI" }, { llm: createFakeLlm({ responses: [MESSAGE] }) });

        expect(res.paths.slug).toBe("acme_ai");
        expect(res.paths.file).toContain(join("tailored", "acme_ai", "wellfound-message.txt"));
        expect(res.message).toContain("RAG");
        expect(res.wordCount).toBeGreaterThan(0);
        // Deterministic keyword read backs the note and flags the gap it must not claim.
        expect([...res.cls.matched, ...res.cls.addable]).toContain("RAG");
        expect(res.cls.missing).toContain("Kubernetes");

        expect(await readFile(res.paths.file, "utf8")).toContain("RAG agents");
    });

    it("rejects a too-short JD and a missing company", async () => {
        const root = await makeRoot();
        const svc = new WellfoundService({ root, presenter: silentPresenter });
        await expect(svc.message({ jd: "short", company: "Acme" }, { llm: createFakeLlm({ responses: [MESSAGE] }) }))
            .rejects.toThrow(/too short/i);
        await expect(svc.message({ jd: JD, company: "" }, { llm: createFakeLlm({ responses: [MESSAGE] }) }))
            .rejects.toThrow(/No company/i);
    });
});

describe("WellfoundService.profile", () => {
    it("writes ONE standing profile at the repo root (not per-company)", async () => {
        const root = await makeRoot();
        const svc = new WellfoundService({ root, presenter: silentPresenter });
        const res = await svc.profile({ target: "agent infrastructure" }, { llm: createFakeLlm({ responses: [PROFILE] }) });

        expect(res.relPath).toBe("wellfound-profile.md");
        expect(res.path).toBe(join(root, "wellfound-profile.md"));
        expect(res.profile.headline).toBe("AI Engineer — Agent Infra");
        expect(res.profile.bio.length).toBeLessThanOrEqual(160);
        expect(res.profile.lookingFor).toContain("remote");
        expect(res.profile.achievements).toHaveLength(2);
        expect(res.profile.experience).toHaveLength(1);

        const md = await readFile(res.path, "utf8");
        expect(md).toContain("# Wellfound profile — master draft");
        expect(md).toContain("AI Engineer — Agent Infra");
        expect(md).toContain("## Bio");
        expect(md).toContain("## Achievements");
        expect(md).toContain("- Merged 12 PRs into Mastra (25k+ stars)");
        expect(md).toContain("- TypeScript");
        expect(md).toContain("### AiRA — AI Engineer");
        expect(md).toContain("focus: _agent infrastructure_");
    });

    it("re-running overwrites the same file", async () => {
        const root = await makeRoot();
        const svc = new WellfoundService({ root, presenter: silentPresenter });
        const first = await svc.profile({}, { llm: createFakeLlm({ responses: [PROFILE] }) });
        const second = await svc.profile({}, { llm: createFakeLlm({ responses: [{ ...PROFILE, headline: "Backend Engineer" }] }) });
        expect(second.path).toBe(first.path);
        expect(await readFile(second.path, "utf8")).toContain("Backend Engineer");
        // exactly one file, overwritten
        await expect(stat(second.path)).resolves.toBeTruthy();
    });

    it("says what is wrong when the model returns an incomplete profile", async () => {
        const root = await makeRoot();
        const svc = new WellfoundService({ root, presenter: silentPresenter });
        await expect(svc.profile({}, { llm: createFakeLlm({ responses: [{ headline: "", bio: "", looking_for: "", skills: [] }] }) }))
            .rejects.toThrow(/incomplete profile/i);
    });

    it("surfaces the provider's own failure instead of a generic sentence", async () => {
        const root = await makeRoot();
        const svc = new WellfoundService({ root, presenter: silentPresenter });
        const llm = createFakeLlm({ responses: [PROFILE], failFirst: 1, failWith: "rate_limit" });
        await expect(svc.profile({}, { llm })).rejects.toThrow(/rate_limit/i);
    });
});
