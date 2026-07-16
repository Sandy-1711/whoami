import { describe, it, expect } from "vitest";
import { slugCompany, sanitizeRole, safeStem, outputPaths, extractRoleFromJd } from "./naming.js";

describe("slugCompany", () => {
    it("should lowercase and collapse non-alphanumerics into single underscores", () => {
        expect(slugCompany("Acme-AI")).toBe("acme_ai");
        expect(slugCompany("Acme  AI, Inc.")).toBe("acme_ai_inc");
    });
    it("should trim leading and trailing underscores", () => {
        expect(slugCompany("  --Foo--  ")).toBe("foo");
    });
    it("should fall back to 'company' for empty or symbol-only input", () => {
        expect(slugCompany("")).toBe("company");
        expect(slugCompany("!!!")).toBe("company");
    });
});

describe("sanitizeRole", () => {
    it("should strip path-illegal characters and collapse whitespace", () => {
        expect(sanitizeRole("AI/ML  Engineer")).toBe("AI ML Engineer");
        expect(sanitizeRole("Backend: Engineer?")).toBe("Backend Engineer");
    });
    it("should fall back to 'Software Engineer' when empty", () => {
        expect(sanitizeRole("")).toBe("Software Engineer");
        expect(sanitizeRole("   ")).toBe("Software Engineer");
    });
});

describe("safeStem", () => {
    it("should join slug and role into a plain lowercase jobname", () => {
        expect(safeStem("acme_ai", "AI Dev Engineer")).toBe("acme_ai__ai_dev_engineer");
    });
    it("should cap the length at 80 characters", () => {
        expect(safeStem("x".repeat(60), "y".repeat(60)).length).toBe(80);
    });
});

describe("outputPaths", () => {
    it("should build the pretty and build paths from company, name and role", () => {
        const p = outputPaths("/root", { company: "Acme-AI", fullName: "Sandeep Singh", role: "AI Dev Engineer" });
        expect(p.slug).toBe("acme_ai");
        expect(p.role).toBe("AI Dev Engineer");
        expect(p.base).toBe("Sandeep Singh - AI Dev Engineer");
        expect(p.relDir).toBe("tailored/acme_ai");
        expect(p.tex.replace(/\\/g, "/")).toContain("tailored/acme_ai/Sandeep Singh - AI Dev Engineer.tex");
        expect(p.buildTexRel).toBe("build/acme_ai__ai_dev_engineer.tex");
    });
});

describe("extractRoleFromJd", () => {
    it("should read an explicit labeled role line", () => {
        expect(extractRoleFromJd("Role: Senior Backend Engineer\nWe want...")).toBe("Senior Backend Engineer");
    });
    it("should read a 'hiring a <Title>' phrase", () => {
        expect(extractRoleFromJd("We are hiring a Machine Learning Engineer to join us.")).toBe("Machine Learning Engineer");
    });
    it("should drop parentheticals and employment-type noise", () => {
        expect(extractRoleFromJd("Position: AI Engineer (Remote, Full-time)")).toBe("AI Engineer");
    });
    it("should return null when nothing convincing is found", () => {
        expect(extractRoleFromJd("We build great products for great people.")).toBeNull();
    });
});
