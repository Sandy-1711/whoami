import { describe, it, expect } from "vitest";
import { tailorPrompt, mapTailorResponse, linkedinPrompt, TAILOR_SCHEMA, type TailorResponse } from "./prompts.js";
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
