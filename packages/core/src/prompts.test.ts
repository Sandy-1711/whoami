import { describe, it, expect } from "vitest";
import {
    tailorPrompt, mapTailorResponse, linkedinPrompt, TAILOR_SCHEMA, type TailorResponse,
    applicationNotePrompt, APPLICATION_NOTE_SCHEMA,
    emailPrompt, outreachPrompt,
} from "./prompts.js";
import { parseResume } from "./resume/schema.js";
import type { Facts, Classification } from "./types.js";

const facts: Facts = { identity: { name: "Sandeep Singh" }, allowed_keywords: ["RAG"] };
const classification: Classification = { matched: ["FastAPI"], addable: ["RAG"], missing: ["Kubernetes"] };

const resume = parseResume({
    name: "Sandeep Singh",
    subtitle: ["AI Engineer"],
    contacts: ["[mail](mailto:x@y.dev)"],
    summary: "Builds agentic LLM systems.",
    experience: [{ id: "aira", org: "AiRA", role: "AI Engineer", bullets: [{ id: "aira-1", text: "Shipped agents." }] }],
});

describe("tailorPrompt", () => {
    it("should embed the JD, fact base and each keyword bucket", () => {
        const prompt = tailorPrompt({ jd: "Build AI agents", resume, facts, classification });
        expect(prompt).toContain("Build AI agents");
        expect(prompt).toContain("Sandeep Singh");
        expect(prompt).toContain("FastAPI");   // matched
        expect(prompt).toContain("RAG");        // addable
        expect(prompt).toContain("Kubernetes"); // missing (do not claim)
    });
    it("should render '(none)' for an empty keyword bucket", () => {
        const prompt = tailorPrompt({ jd: "x", resume, facts, classification: { matched: [], addable: [], missing: [] } });
        expect(prompt).toContain("(none)");
    });
    it("should show each bullet with the id and length an edit has to respect", () => {
        const prompt = tailorPrompt({ jd: "x", resume, facts, classification });
        expect(prompt).toContain("[aira-1] (15 chars) Shipped agents.");
    });
});

describe("mapTailorResponse", () => {
    it("should map raw snake_case fields onto the pipeline shape", () => {
        const raw: TailorResponse = {
            role_title: "AI Engineer",
            summary: "Ships agents.",
            subtitle: ["AI", "Backend", "RAG"],
            bullets: [{ id: "aira-1", text: "Ships RAG agents." }],
            rationale: "because",
        };
        expect(mapTailorResponse(raw)).toEqual({
            roleTitle: "AI Engineer",
            summary: "Ships agents.",
            subtitle: ["AI", "Backend", "RAG"],
            bullets: [{ id: "aira-1", text: "Ships RAG agents." }],
            rationale: "because",
        });
    });
    it("should default the optional fields when the model omits them", () => {
        const parsed = TAILOR_SCHEMA.parse({ summary: "s" });
        const mapped = mapTailorResponse(parsed);
        expect(mapped.roleTitle).toBe("");
        expect(mapped.subtitle).toEqual([]);
        expect(mapped.bullets).toEqual([]);
        expect(mapped.rationale).toBe("");
    });
});

describe("linkedinPrompt", () => {
    it("should embed the profile text and instruct JSON-only extraction", () => {
        const prompt = linkedinPrompt("Sandeep — AI Engineer at AiRA");
        expect(prompt).toContain("Sandeep — AI Engineer at AiRA");
        expect(prompt).toMatch(/only what appears/i);
    });
});

describe("TAILOR_SCHEMA", () => {
    it("rejects a response missing the copy the résumé depends on", () => {
        expect(TAILOR_SCHEMA.safeParse({ subtitle: ["t"] }).success).toBe(false);
    });

    it("accepts a response carrying only the required copy", () => {
        expect(TAILOR_SCHEMA.safeParse({ summary: "s" }).success).toBe(true);
    });
});

describe("applicationNotePrompt", () => {
    it("should embed the company, role, JD, fact base and keyword buckets", () => {
        const prompt = applicationNotePrompt({
            jd: "Build RAG agents", company: "Acme AI", role: "AI Engineer", facts, classification,
        });
        expect(prompt).toContain("Acme AI");
        expect(prompt).toContain("AI Engineer");
        expect(prompt).toContain("Build RAG agents");
        expect(prompt).toContain("Sandeep Singh");
        expect(prompt).toContain("FastAPI");   // matched
        expect(prompt).toContain("RAG");        // addable
        expect(prompt).toContain("Kubernetes"); // missing (never claim)
    });
    it("should tell the model to skip greeting/signature and avoid ATS framing", () => {
        const prompt = applicationNotePrompt({ jd: "x".repeat(30), company: "Acme", role: "", facts, classification });
        expect(prompt).toMatch(/NO greeting/i);
        expect(prompt).toMatch(/NOT parsed by an ATS/i);
    });
});

describe("evidence digest injection", () => {
    const digest = "GitHub (sandy): 24 repos · 56★\n- mastra-ai/mastra — 12 merged";

    it("appears in every copy prompt when passed", () => {
        expect(tailorPrompt({ jd: "x", resume, facts, classification, digest })).toContain("VERIFIED PUBLIC EVIDENCE");
        expect(tailorPrompt({ jd: "x", resume, facts, classification, digest })).toContain("12 merged");
        expect(applicationNotePrompt({ jd: "x", company: "A", role: "", facts, classification, digest })).toContain("VERIFIED PUBLIC EVIDENCE");
        expect(emailPrompt({ jd: "x", company: "A", role: "", facts, classification, candidateName: "S", hasResume: false, digest })).toContain("VERIFIED PUBLIC EVIDENCE");
        expect(outreachPrompt({ kind: "cold_email", facts, company: "A", role: "", jd: "", context: "", digest })).toContain("VERIFIED PUBLIC EVIDENCE");
    });

    it("is absent when the digest is omitted or empty", () => {
        expect(tailorPrompt({ jd: "x", resume, facts, classification })).not.toContain("VERIFIED PUBLIC EVIDENCE");
        expect(tailorPrompt({ jd: "x", resume, facts, classification, digest: "  " })).not.toContain("VERIFIED PUBLIC EVIDENCE");
    });

    it("slices a runaway digest to 6000 chars", () => {
        const long = "y".repeat(8000);
        const prompt = tailorPrompt({ jd: "x", resume, facts, classification, digest: long });
        expect(prompt).toContain("y".repeat(6000));
        expect(prompt).not.toContain("y".repeat(6001));
    });
});

describe("application-note schema", () => {
    it("requires a message and defaults the rationale", () => {
        expect(APPLICATION_NOTE_SCHEMA.safeParse({ rationale: "r" }).success).toBe(false);
        expect(APPLICATION_NOTE_SCHEMA.parse({ message: "m" }).rationale).toBe("");
    });
});
