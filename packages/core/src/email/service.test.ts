import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EmailService, findApplyEmail } from "./service.js";
import { silentPresenter } from "../ports/logger.js";
import { nullMailer, type Mailer, type EmailMessage } from "../ports/mailer.js";
import type { LlmProvider, LlmRequest } from "../ports/llm.js";

// A fake provider returning canned JSON regardless of prompt.
function fakeProvider(payload: unknown): LlmProvider {
    return {
        id: "fake", label: "Fake", model: "test",
        async generateJson<T>(_req: LlmRequest): Promise<T> { return payload as T; },
    };
}

// A Mailer that records the message it was asked to send instead of hitting SMTP.
function recordingMailer(): Mailer & { sent: EmailMessage[] } {
    const sent: EmailMessage[] = [];
    return {
        sent,
        available: true,
        async send(msg) { sent.push(msg); return { messageId: "<test@id>", accepted: [msg.to], rejected: [] }; },
    };
}

const EMAIL = {
    to: "",
    subject: "AI Engineer Application — Sandeep Singh",
    body: "Hi Acme team,\n\nI ship RAG agents on FastAPI.\n\nBest regards,\nSandeep Singh",
    rationale: "leads with proof",
};

const roots: string[] = [];
async function makeRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "email-"));
    roots.push(root);
    await mkdir(join(root, "profile"), { recursive: true });
    await writeFile(join(root, "profile", "facts.json"), JSON.stringify({
        identity: { name: "Sandeep Singh", github: "https://github.com/Sandy-1711", portfolio: "https://devsandy.vercel.app/" },
        allowed_keywords: ["RAG", "FastAPI"], skills: { AI: ["RAG", "FastAPI"] },
    }));
    await writeFile(join(root, "resume.tex"), "\\section{x} FastAPI RAG agents");
    return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });

const JD = "We are hiring an AI Engineer to build RAG agents with FastAPI. Remote, Kubernetes a plus. Apply to jobs@acme.ai.";

describe("EmailService.draft", () => {
    it("drafts an email, appends a contact signature, and writes application-email.txt", async () => {
        const root = await makeRoot();
        const svc = new EmailService({ root, presenter: silentPresenter });
        const d = await svc.draft({ jd: JD, company: "Acme AI" }, { provider: fakeProvider(EMAIL), from: "me@gmail.com" });

        expect(d.paths.slug).toBe("acme_ai");
        expect(d.subject).toContain("AI Engineer Application");
        // Signature links from facts.identity are appended deterministically.
        expect(d.body).toContain("https://devsandy.vercel.app/");
        expect(d.body).toContain("https://github.com/Sandy-1711");
        // Recipient falls back to the address parsed from the JD.
        expect(d.to).toBe("jobs@acme.ai");
        // Grounding: real matches surfaced, the gap flagged as never-claim.
        expect([...d.cls.matched, ...d.cls.addable]).toContain("RAG");
        expect(d.cls.missing).toContain("Kubernetes");

        const written = await readFile(d.paths.file, "utf8");
        expect(written).toContain("To: jobs@acme.ai");
        expect(written).toContain("Subject: AI Engineer Application");
        expect(written).toContain("From: me@gmail.com");
    });

    it("auto-attaches the tailored résumé PDF when one exists for the company", async () => {
        const root = await makeRoot();
        await mkdir(join(root, "tailored", "acme_ai"), { recursive: true });
        await writeFile(join(root, "tailored", "acme_ai", "Sandeep Singh - AI Engineer.pdf"), "%PDF-1.4 fake");
        const svc = new EmailService({ root, presenter: silentPresenter });
        const d = await svc.draft(
            { jd: JD, company: "Acme AI", role: "AI Engineer" },
            { provider: fakeProvider(EMAIL) },
        );
        expect(d.attachments).toHaveLength(1);
        expect(d.attachments[0]!.filename).toBe("Sandeep Singh - AI Engineer.pdf");
        expect(d.resumeRelPath).toBe("tailored/acme_ai/Sandeep Singh - AI Engineer.pdf");
    });

    it("does NOT write the draft file when persist:false (dry-run preview)", async () => {
        const root = await makeRoot();
        // A pre-existing hand-edited draft must survive a preview.
        await mkdir(join(root, "tailored", "acme_ai"), { recursive: true });
        const existing = join(root, "tailored", "acme_ai", "application-email.txt");
        await writeFile(existing, "MY HAND-WRITTEN DRAFT");
        const svc = new EmailService({ root, presenter: silentPresenter });
        const d = await svc.draft({ jd: JD, company: "Acme AI" }, { provider: fakeProvider(EMAIL), persist: false });

        expect(d.written).toBe(false);
        expect(await readFile(existing, "utf8")).toBe("MY HAND-WRITTEN DRAFT");
    });

    it("attaches nothing when attach:false, even if a PDF exists", async () => {
        const root = await makeRoot();
        await mkdir(join(root, "tailored", "acme_ai"), { recursive: true });
        await writeFile(join(root, "tailored", "acme_ai", "resume.pdf"), "%PDF fake");
        const svc = new EmailService({ root, presenter: silentPresenter });
        const d = await svc.draft({ jd: JD, company: "Acme AI", attach: false }, { provider: fakeProvider(EMAIL) });
        expect(d.attachments).toHaveLength(0);
        expect(d.resumeRelPath).toBeNull();
    });

    it("rejects a too-short JD and a missing company", async () => {
        const root = await makeRoot();
        const svc = new EmailService({ root, presenter: silentPresenter });
        await expect(svc.draft({ jd: "short", company: "Acme" }, { provider: fakeProvider(EMAIL) }))
            .rejects.toThrow(/too short/i);
        await expect(svc.draft({ jd: JD, company: "" }, { provider: fakeProvider(EMAIL) }))
            .rejects.toThrow(/No company/i);
    });
});

describe("EmailService.send", () => {
    it("sends the drafted email + attachments through the Mailer port", async () => {
        const root = await makeRoot();
        const svc = new EmailService({ root, presenter: silentPresenter });
        const d = await svc.draft({ jd: JD, company: "Acme AI" }, { provider: fakeProvider(EMAIL), from: "me@gmail.com" });
        const mailer = recordingMailer();
        const res = await svc.send(d, { mailer });

        expect(res.accepted).toEqual(["jobs@acme.ai"]);
        expect(mailer.sent).toHaveLength(1);
        expect(mailer.sent[0]!.to).toBe("jobs@acme.ai");
        expect(mailer.sent[0]!.subject).toContain("AI Engineer Application");
        expect(mailer.sent[0]!.from).toBe("me@gmail.com");
    });

    it("honours a recipient override from the CLI's approval step", async () => {
        const root = await makeRoot();
        const svc = new EmailService({ root, presenter: silentPresenter });
        const d = await svc.draft({ jd: JD, company: "Acme AI" }, { provider: fakeProvider(EMAIL) });
        const mailer = recordingMailer();
        await svc.send(d, { mailer, to: "override@acme.ai" });
        expect(mailer.sent[0]!.to).toBe("override@acme.ai");
    });

    it("refuses to send with no recipient or a malformed address", async () => {
        const root = await makeRoot();
        const svc = new EmailService({ root, presenter: silentPresenter });
        // JD without any apply-to address → draft.to is empty.
        const d = await svc.draft({ jd: JD.replace("Apply to jobs@acme.ai.", ""), company: "Acme AI" }, { provider: fakeProvider(EMAIL) });
        expect(d.to).toBe("");
        await expect(svc.send(d, { mailer: recordingMailer() })).rejects.toThrow(/No recipient/i);
        await expect(svc.send(d, { mailer: recordingMailer(), to: "not-an-email" })).rejects.toThrow(/valid email/i);
    });

    it("refuses to send when the mailer is unconfigured", async () => {
        const root = await makeRoot();
        const svc = new EmailService({ root, presenter: silentPresenter });
        const d = await svc.draft({ jd: JD, company: "Acme AI" }, { provider: fakeProvider(EMAIL) });
        await expect(svc.send(d, { mailer: nullMailer })).rejects.toThrow(/not configured|GMAIL/i);
    });
});

describe("findApplyEmail", () => {
    it("prefers an address near an application cue", () => {
        expect(findApplyEmail("Questions? ping ceo@acme.ai. To apply, email jobs@acme.ai today."))
            .toBe("jobs@acme.ai");
    });
    it("returns '' when the JD has no address", () => {
        expect(findApplyEmail("No email here, apply on our website.")).toBe("");
    });
});
