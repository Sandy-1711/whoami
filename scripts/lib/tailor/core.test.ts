import { describe, it, expect } from "vitest";
import {
    termInText, extractJdKeywords, classify, scoreResume,
    latexEscape, boldify, replaceBlock, latexToPlainText,
} from "./core.js";
import type { Facts } from "../types.js";

describe("termInText", () => {
    it("should match whole tokens and not fragments", () => {
        expect(termInText("React", "We use React heavily")).toBe(true);
        expect(termInText("Java", "We write JavaScript")).toBe(false);
    });
    it("should handle dotted, slash and plus terms that \\b mishandles", () => {
        expect(termInText("Node.js", "built on Node.js today")).toBe(true);
        expect(termInText("CI/CD", "a CI/CD pipeline")).toBe(true);
        expect(termInText("C++", "strong C++ skills")).toBe(true);
    });
});

describe("latexToPlainText", () => {
    it("should drop comment lines, macros, braces and inline math", () => {
        const tex = [
            "% a comment line",
            "\\section{Experience}",
            "\\href{mailto:x@y.com}{email} built $O(n)$ systems",
        ].join("\n");
        const out = latexToPlainText(tex);
        expect(out).not.toContain("%");
        expect(out).not.toContain("\\section");
        expect(out).not.toContain("{");
        expect(out).not.toContain("$");
        expect(out).toContain("Experience");
        expect(out).toContain("built");
    });
});

describe("extractJdKeywords", () => {
    it("should fold aliases onto canonical spellings and dedupe", () => {
        const kw = extractJdKeywords("Looking for a nextjs + postgres engineer who knows k8s clusters.");
        expect(kw).toContain("Next.js");
        expect(kw).toContain("PostgreSQL");
        expect(kw).toContain("Kubernetes");
    });
    it("should find canonical lexicon terms directly", () => {
        expect(extractJdKeywords("experience with FastAPI and Redis")).toEqual(
            expect.arrayContaining(["FastAPI", "Redis"]),
        );
    });
});

const facts: Facts = {
    allowed_keywords: ["FastAPI", "Redis", "RAG"],
    skills: { Backend: ["PostgreSQL"] },
    experience: [{ org: "X", keywords: ["LangChain"] }],
    projects: [{ name: "Y", keywords: ["Pinecone"] }],
};

describe("classify", () => {
    it("should split JD keywords into matched, addable and missing", () => {
        const jdKeywords = ["FastAPI", "RAG", "Kubernetes"];
        const resumeText = "I built things with FastAPI in production.";
        const { matched, addable, missing } = classify(jdKeywords, resumeText, facts);
        expect(matched).toEqual(["FastAPI"]);    // present in résumé text
        expect(addable).toEqual(["RAG"]);         // truthful (in facts) but not surfaced
        expect(missing).toEqual(["Kubernetes"]);  // not in facts — do not fake
    });
});

describe("scoreResume", () => {
    it("should be 20 structure points plus 80 * matched coverage", () => {
        // 1 matched of 4 total -> 20 + 80*0.25 = 40 before; +1 addable -> 20 + 80*0.5 = 60 after.
        const s = scoreResume({ matched: ["a"], addable: ["b"], missing: ["c", "d"] });
        expect(s.before).toBe(40);
        expect(s.after).toBe(60);
        expect(s.total).toBe(4);
    });
    it("should return full marks when there are no keywords", () => {
        const s = scoreResume({ matched: [], addable: [], missing: [] });
        expect(s.before).toBe(100);
        expect(s.after).toBe(100);
    });
});

describe("latexEscape", () => {
    it("should escape LaTeX-special characters", () => {
        expect(latexEscape("a & b_c 50% #1")).toBe("a \\& b\\_c 50\\% \\#1");
        expect(latexEscape("~x^y")).toBe("\\textasciitilde{}x\\textasciicircum{}y");
    });
});

describe("boldify", () => {
    it("should escape then bold the first occurrence of each term", () => {
        expect(boldify("cut cost by 82%", ["82%"])).toBe("cut cost by \\textbf{82\\%}");
    });
    it("should match the term case-insensitively", () => {
        expect(boldify("Built RAG systems", ["rag"])).toBe("Built \\textbf{RAG} systems");
    });
});

describe("replaceBlock", () => {
    const tex = [
        "before",
        "%% >>>TAILOR:summary",
        "OLD CONTENT",
        "%% <<<TAILOR:summary",
        "after",
    ].join("\n");

    it("should replace content between the anchors and keep the anchors", () => {
        const out = replaceBlock(tex, "summary", "NEW");
        expect(out).toContain("%% >>>TAILOR:summary\nNEW\n%% <<<TAILOR:summary");
        expect(out).not.toContain("OLD CONTENT");
    });
    it("should throw when the anchor is missing", () => {
        expect(() => replaceBlock(tex, "subtitle", "x")).toThrow(/anchor "subtitle" not found/);
    });
});
