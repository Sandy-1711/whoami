import { describe, it, expect } from "vitest";
import { parseArgs } from "./args.js";

describe("parseArgs", () => {
    it("should read the leading sub-command", () => {
        expect(parseArgs(["send", "--company", "Acme"]).cmd).toBe("send");
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
        const a = parseArgs(["send", "--company", "Acme AI", "--to", "jobs@acme.ai"]);
        expect(a.opt("--company")).toBe("Acme AI");
        expect(a.opt("--to")).toBe("jobs@acme.ai");
        expect(a.opt("--attach", "resume.pdf")).toBe("resume.pdf");
    });
    it("should reject a flag-shaped value instead of consuming the next flag", () => {
        const a = parseArgs(["send", "--company", "--to", "jobs@acme.ai"]);
        expect(() => a.opt("--company")).toThrow(/--company needs a value/);
    });
    it("should reject a flag left dangling at the end of argv", () => {
        expect(() => parseArgs(["send", "--company"]).opt("--company")).toThrow(/needs a value/);
    });
    it("should accept a value that merely starts with dashes", () => {
        const a = parseArgs(["score", "--jd", "--- Senior Engineer ---"]);
        expect(a.opt("--jd")).toBe("--- Senior Engineer ---");
    });
    it("should collect positionals, excluding flags and their values", () => {
        const a = parseArgs(["score", "jd.txt", "--company", "Acme", "--force"]);
        expect(a.positionals()).toEqual(["jd.txt"]);
    });
    it("should not treat a value-flag's argument as a positional", () => {
        // "Acme" follows --company (a VALUE_FLAG) so it is a value, not a positional.
        const a = parseArgs(["send", "--company", "Acme"]);
        expect(a.positionals()).toEqual([]);
    });
});
