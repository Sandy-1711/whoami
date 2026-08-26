import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutreachService } from "./service.js";
import { silentPresenter } from "../ports/logger.js";
import { createFakeLlm } from '@resume/llm/testing';

const NOTE = { message: "I shipped RAG agents on FastAPI at AiRA.", rationale: "leads with proof" };
const MESSAGE = { subject: "AI Engineer — 12 merged PRs into Mastra", message: "Hi — I build agent infra.", rationale: "one hook" };

const roots: string[] = [];
async function makeRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "outreach-"));
    roots.push(root);
    await mkdir(join(root, "profile"), { recursive: true });
    await writeFile(join(root, "profile", "facts.json"), JSON.stringify({
        identity: { name: "Sandeep Singh" }, allowed_keywords: ["RAG", "FastAPI"], skills: { AI: ["RAG", "FastAPI"] },
    }));
    await writeFile(join(root, "profile", "resume.json"), JSON.stringify({
        name: "Sandeep Singh",
        subtitle: ["AI Engineer"],
        contacts: ["[mail](mailto:x@y.dev)"],
        summary: "Ships RAG agents on FastAPI.",
    }));
    return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });

const JD = "We are hiring an AI Engineer to build RAG agents with FastAPI. Remote, Kubernetes a plus.";

describe("OutreachService.note", () => {
    it("writes the per-JD note under tailored/<slug> and grounds it in real keywords", async () => {
        const root = await makeRoot();
        const svc = new OutreachService({ root, presenter: silentPresenter });
        const res = await svc.note({ jd: JD, company: "Acme AI" }, { llm: createFakeLlm({ responses: [NOTE] }) });

        expect(res.paths.slug).toBe("acme_ai");
        expect(res.paths.relPath).toBe("tailored/acme_ai/application-note.txt");
        expect(res.message).toContain("RAG");
        expect(res.wordCount).toBeGreaterThan(0);
        // Deterministic keyword read backs the note and flags the gap it must not claim.
        expect([...res.cls.matched, ...res.cls.addable]).toContain("RAG");
        expect(res.cls.missing).toContain("Kubernetes");

        expect(await readFile(res.paths.file, "utf8")).toContain("RAG agents");
    });

    it("files a note per platform, so two forms for one company do not overwrite", async () => {
        const root = await makeRoot();
        const svc = new OutreachService({ root, presenter: silentPresenter });
        const wf = await svc.note({ jd: JD, company: "Acme AI", platform: "Wellfound" }, { llm: createFakeLlm({ responses: [NOTE] }) });
        const yc = await svc.note({ jd: JD, company: "Acme AI", platform: "Work at a Startup" }, { llm: createFakeLlm({ responses: [NOTE] }) });

        expect(wf.paths.relPath).toBe("tailored/acme_ai/application-note-wellfound.txt");
        expect(yc.paths.relPath).toBe("tailored/acme_ai/application-note-work_at_a_startup.txt");
        expect(wf.platform).toBe("Wellfound");
    });

    it("names the platform in the prompt without branching on it", async () => {
        const root = await makeRoot();
        const svc = new OutreachService({ root, presenter: silentPresenter });
        const llm = createFakeLlm({ responses: [NOTE] });
        await svc.note({ jd: JD, company: "Acme AI", platform: "Lever" }, { llm });
        expect(llm.calls[0]?.prompt).toContain("Lever's application form");
    });

    it("carries the caller's tone and length into the prompt", async () => {
        const root = await makeRoot();
        const svc = new OutreachService({ root, presenter: silentPresenter });
        const llm = createFakeLlm({ responses: [NOTE] });
        await svc.note({ jd: JD, company: "Acme AI", tone: "formal", length: "shorter" }, { llm });

        const prompt = llm.calls[0]!.prompt;
        expect(prompt).toMatch(/TONE: Formal/);
        // 85 words scaled by the "shorter" factor.
        expect(prompt).toContain("about 60 words");
    });

    it("rejects a too-short JD and a missing company", async () => {
        const root = await makeRoot();
        const svc = new OutreachService({ root, presenter: silentPresenter });
        await expect(svc.note({ jd: "short", company: "Acme" }, { llm: createFakeLlm({ responses: [NOTE] }) }))
            .rejects.toThrow(/too short/i);
        await expect(svc.note({ jd: JD, company: "" }, { llm: createFakeLlm({ responses: [NOTE] }) }))
            .rejects.toThrow(/No company/i);
    });
});

describe("OutreachService.generate", () => {
    it("files a cold email under the company and counts its words", async () => {
        const root = await makeRoot();
        const svc = new OutreachService({ root, presenter: silentPresenter });
        const res = await svc.generate({ kind: "cold_email", company: "Acme AI", jd: JD }, { llm: createFakeLlm({ responses: [MESSAGE] }) });

        expect(res.relPath).toBe("tailored/acme_ai/outreach-cold_email.txt");
        expect(res.subject).toContain("Mastra");
        expect(res.wordCount).toBeGreaterThan(0);
        expect(await readFile(res.file!, "utf8")).toContain("Subject: ");
    });

    it("scales the kind's own word budget rather than replacing it", async () => {
        const root = await makeRoot();
        const svc = new OutreachService({ root, presenter: silentPresenter });
        const llm = createFakeLlm({ responses: [MESSAGE, MESSAGE] });
        await svc.generate({ kind: "linkedin_dm" }, { llm });
        await svc.generate({ kind: "linkedin_dm", length: "longer" }, { llm });

        // A DM's 60-word budget, then the same budget stretched — the ~300-char
        // platform cap in the brief still applies either way.
        expect(llm.calls[0]!.prompt).toContain("about 60 words");
        expect(llm.calls[1]!.prompt).toContain("about 84 words");
        expect(llm.calls[1]!.prompt).toContain("300 chars");
    });

    it("keeps an ad-hoc message in memory when no company is given", async () => {
        const root = await makeRoot();
        const svc = new OutreachService({ root, presenter: silentPresenter });
        const res = await svc.generate({ kind: "linkedin_dm" }, { llm: createFakeLlm({ responses: [MESSAGE] }) });
        expect(res.file).toBeNull();
        expect(res.relPath).toBeNull();
    });
});
