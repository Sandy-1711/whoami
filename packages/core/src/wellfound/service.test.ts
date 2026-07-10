import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WellfoundService } from "./service.js";
import { silentPresenter } from "../ports/logger.js";
import type { LlmProvider, LlmRequest } from "../ports/llm.js";

// A fake provider that returns canned JSON, routed by a phrase unique to each
// prompt (the profile prompt says "optimizing a candidate's Wellfound…").
function fakeProvider(message: unknown, profile: unknown, spy?: (isProfile: boolean) => void): LlmProvider {
    return {
        id: "fake", label: "Fake", model: "test",
        async generateJson<T>(req: LlmRequest): Promise<T> {
            const isProfile = /optimizing a candidate/i.test(req.prompt);
            spy?.(isProfile);
            return (isProfile ? profile : message) as T;
        },
    };
}

const MESSAGE = { message: "I shipped RAG agents on FastAPI at AiRA.", rationale: "leads with proof" };
const PROFILE = { headline: "AI Engineer — Agent Infra", about: "I build agents.", looking_for: "remote AI eng", skills: ["RAG", "FastAPI"], rationale: "tightened" };

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

describe("WellfoundService.run", () => {
    it("writes the note + profile draft and returns a structured result", async () => {
        const root = await makeRoot();
        const svc = new WellfoundService({ root, presenter: silentPresenter });
        const res = await svc.run({ jd: JD, company: "Acme AI" }, { provider: fakeProvider(MESSAGE, PROFILE) });

        expect(res.paths.slug).toBe("acme_ai");
        expect(res.message).toContain("RAG");
        expect(res.wordCount).toBeGreaterThan(0);
        expect(res.wroteProfile).toBe(true);
        expect(res.profile?.headline).toBe("AI Engineer — Agent Infra");
        expect(res.profile?.lookingFor).toBe("remote AI eng");

        // The deterministic keyword read backs the note with real matches, and
        // never smuggles a gap the résumé can't support.
        expect([...res.cls.matched, ...res.cls.addable]).toContain("RAG");
        expect(res.cls.missing).toContain("Kubernetes");

        const noteFile = await readFile(res.paths.message, "utf8");
        expect(noteFile).toContain("RAG agents");
        const profileFile = await readFile(res.paths.profile, "utf8");
        expect(profileFile).toContain("AI Engineer — Agent Infra");
        expect(profileFile).toContain("- RAG");
    });

    it("skips the profile pass under messageOnly", async () => {
        const root = await makeRoot();
        const calls: boolean[] = [];
        const svc = new WellfoundService({ root, presenter: silentPresenter });
        const res = await svc.run(
            { jd: JD, company: "Acme", messageOnly: true },
            { provider: fakeProvider(MESSAGE, PROFILE, (isProfile) => calls.push(isProfile)) },
        );
        expect(res.wroteProfile).toBe(false);
        expect(res.profile).toBeNull();
        expect(calls).toEqual([false]); // only the message call happened
    });

    it("does not fail the run when the profile pass errors — note still ships", async () => {
        const root = await makeRoot();
        const provider: LlmProvider = {
            id: "fake", label: "Fake", model: "test",
            async generateJson<T>(req: LlmRequest): Promise<T> {
                if (/optimizing a candidate/i.test(req.prompt)) throw new Error("boom");
                return MESSAGE as T;
            },
        };
        const svc = new WellfoundService({ root, presenter: silentPresenter });
        const res = await svc.run({ jd: JD, company: "Acme" }, { provider });
        expect(res.message).toContain("RAG");
        expect(res.wroteProfile).toBe(false);
    });

    it("rejects a too-short JD and a missing company", async () => {
        const root = await makeRoot();
        const svc = new WellfoundService({ root, presenter: silentPresenter });
        await expect(svc.run({ jd: "short", company: "Acme" }, { provider: fakeProvider(MESSAGE, PROFILE) }))
            .rejects.toThrow(/too short/i);
        await expect(svc.run({ jd: JD, company: "" }, { provider: fakeProvider(MESSAGE, PROFILE) }))
            .rejects.toThrow(/No company/i);
    });
});
