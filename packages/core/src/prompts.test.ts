import { describe, it, expect } from "vitest";
import {
    tailorPrompt, mapTailorResponse, linkedinPrompt, TAILOR_SCHEMA, type TailorResponse,
    wellfoundMessagePrompt, wellfoundProfilePrompt, mapWellfoundProfile,
    WELLFOUND_MESSAGE_SCHEMA, WELLFOUND_PROFILE_SCHEMA, type WellfoundProfileResponse,
} from "./prompts.js";
import type { Facts, Classification } from "./types.js";

const facts: Facts = { identity: { name: "Sandeep Singh" }, allowed_keywords: ["RAG"] };
const classification: Classification = { matched: ["FastAPI"], addable: ["RAG"], missing: ["Kubernetes"] };

describe("tailorPrompt", () => {
    it("should embed the JD, fact base and each keyword bucket", () => {
        const prompt = tailorPrompt({ jd: "Build AI agents", facts, classification });
        expect(prompt).toContain("Build AI agents");
        expect(prompt).toContain("Sandeep Singh");
        expect(prompt).toContain("FastAPI");   // matched
        expect(prompt).toContain("RAG");        // addable
        expect(prompt).toContain("Kubernetes"); // missing (do not claim)
    });
    it("should render '(none)' for an empty keyword bucket", () => {
        const prompt = tailorPrompt({ jd: "x", facts, classification: { matched: [], addable: [], missing: [] } });
        expect(prompt).toContain("(none)");
    });
});

describe("mapTailorResponse", () => {
    it("should map raw snake_case fields onto the pipeline shape", () => {
        const raw: TailorResponse = {
            role_title: "AI Engineer",
            tailored_summary_text: "Ships agents.",
            tailored_subtitle: "AI | Backend | RAG",
            bold_terms: ["agents"],
            rationale: "because",
        };
        expect(mapTailorResponse(raw)).toEqual({
            roleTitle: "AI Engineer",
            summaryText: "Ships agents.",
            subtitle: "AI | Backend | RAG",
            boldTerms: ["agents"],
            rationale: "because",
        });
    });
    it("should default the optional fields when absent", () => {
        const mapped = mapTailorResponse({ tailored_summary_text: "s", tailored_subtitle: "t" } as TailorResponse);
        expect(mapped.roleTitle).toBe("");
        expect(mapped.boldTerms).toEqual([]);
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
    it("should require every field the mapper reads", () => {
        expect(TAILOR_SCHEMA.required).toEqual(
            expect.arrayContaining(["role_title", "tailored_summary_text", "tailored_subtitle", "bold_terms", "rationale"]),
        );
    });
});

describe("wellfoundMessagePrompt", () => {
    it("should embed the company, role, JD, fact base and keyword buckets", () => {
        const prompt = wellfoundMessagePrompt({
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
        const prompt = wellfoundMessagePrompt({ jd: "x".repeat(30), company: "Acme", role: "", facts, classification });
        expect(prompt).toMatch(/NO greeting/i);
        expect(prompt).toMatch(/NOT parsed by an ATS/i);
    });
});

describe("wellfoundProfilePrompt", () => {
    it("should embed the fact base and optional target context", () => {
        const prompt = wellfoundProfilePrompt({ facts, target: "agent infrastructure role" });
        expect(prompt).toContain("Sandeep Singh");
        expect(prompt).toContain("agent infrastructure role");
        expect(prompt).toMatch(/headline/);
        expect(prompt).toMatch(/skills/);
    });
    it("should default target to empty when omitted", () => {
        const prompt = wellfoundProfilePrompt({ facts });
        expect(prompt).toContain("TARGET CONTEXT");
    });
});

describe("mapWellfoundProfile", () => {
    it("should map snake_case looking_for onto lookingFor and default skills", () => {
        const raw: WellfoundProfileResponse = {
            headline: "AI Engineer", about: "Ships agents.", looking_for: "remote AI work", skills: ["RAG"],
        };
        expect(mapWellfoundProfile(raw)).toEqual({
            headline: "AI Engineer", about: "Ships agents.", lookingFor: "remote AI work", skills: ["RAG"],
        });
        expect(mapWellfoundProfile({ headline: "x", about: "y", looking_for: "z" } as WellfoundProfileResponse).skills).toEqual([]);
    });
});

describe("Wellfound schemas", () => {
    it("message schema requires the fields the service reads", () => {
        expect(WELLFOUND_MESSAGE_SCHEMA.required).toEqual(expect.arrayContaining(["message", "rationale"]));
    });
    it("profile schema requires headline, about, looking_for, skills", () => {
        expect(WELLFOUND_PROFILE_SCHEMA.required).toEqual(
            expect.arrayContaining(["headline", "about", "looking_for", "skills"]),
        );
    });
});
