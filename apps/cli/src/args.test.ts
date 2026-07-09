import { describe, it, expect } from "vitest";
import { parseArgs } from "./args.js";

describe("parseArgs", () => {
    it("should read the leading sub-command", () => {
        expect(parseArgs(["tailor", "--company", "Acme"]).cmd).toBe("tailor");
    });
    it("should return an empty command when the first token is a flag", () => {
        expect(parseArgs(["--force"]).cmd).toBe("");
        expect(parseArgs([]).cmd).toBe("");
    });
    it("should detect boolean flags with has()", () => {
        const a = parseArgs(["sync", "--force"]);
        expect(a.has("--force")).toBe(true);
        expect(a.has("--nope")).toBe(false);
    });
    it("should read a flag value with opt(), falling back when absent", () => {
        const a = parseArgs(["tailor", "--company", "Acme AI", "--role", "AI Engineer"]);
        expect(a.opt("--company")).toBe("Acme AI");
        expect(a.opt("--role")).toBe("AI Engineer");
        expect(a.opt("--model", "gemini-2.5-flash")).toBe("gemini-2.5-flash");
    });
    it("should collect positionals, excluding flags and their values", () => {
        const a = parseArgs(["tailor", "jd.txt", "--company", "Acme", "--force"]);
        expect(a.positionals()).toEqual(["jd.txt"]);
    });
    it("should not treat a value-flag's argument as a positional", () => {
        // "Acme" follows --company (a VALUE_FLAG) so it is a value, not a positional.
        const a = parseArgs(["tailor", "--company", "Acme"]);
        expect(a.positionals()).toEqual([]);
    });
});
