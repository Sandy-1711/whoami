import { describe, it, expect } from "vitest";
import { styleInline, styleLine, createStreamRenderer } from "./markdown.js";

// picocolors may run color-less in the test env; the transforms still STRIP
// the markdown markers, which is what these assertions check.

describe("styleInline", () => {
    it("strips bold, italic, and code markers", () => {
        const out = styleInline("a **bold** and *ital* and `code` end");
        expect(out).not.toContain("**");
        expect(out).not.toContain("`");
        expect(out).toContain("bold");
        expect(out).toContain("ital");
        expect(out).toContain("code");
    });

    it("never rewrites bold/italic markers inside a code span", () => {
        const out = styleInline("run `pnpm tailor -- --company *X*` now");
        expect(out).toContain("pnpm tailor -- --company *X*");
    });

    it("leaves multiplication-style asterisks alone", () => {
        expect(styleInline("3 * 4 * 5")).toBe("3 * 4 * 5");
    });
});

describe("styleLine", () => {
    it("strips header hashes", () => {
        const out = styleLine("## Next steps", { inFence: false });
        expect(out).toContain("Next steps");
        expect(out).not.toContain("##");
    });

    it("turns dash bullets into • and styles inline within them", () => {
        const out = styleLine("- a **strong** point", { inFence: false });
        expect(out).toContain("•");
        expect(out).not.toContain("**");
    });

    it("fences toggle raw mode — no inline transforms inside", () => {
        const state = { inFence: false };
        styleLine("```ts", state);
        expect(state.inFence).toBe(true);
        const inside = styleLine("const x = **not bold**;", state);
        expect(inside).toContain("**not bold**");
        styleLine("```", state);
        expect(state.inFence).toBe(false);
    });
});

describe("createStreamRenderer", () => {
    function collect() {
        const chunks: string[] = [];
        const renderer = createStreamRenderer((s) => chunks.push(s), { plain: false });
        return { chunks, renderer, text: () => chunks.join("") };
    }

    it("styles a bold marker split across two pushes (line buffering)", () => {
        const { renderer, text } = collect();
        renderer.push("here is **bo");
        renderer.push("ld** text\n");
        expect(text()).toContain("bold");
        expect(text()).not.toContain("**");
    });

    it("only emits on newline; flush emits the partial tail", () => {
        const { chunks, renderer, text } = collect();
        renderer.push("no newline yet");
        expect(chunks).toHaveLength(0);
        renderer.flush();
        expect(text()).toBe("no newline yet");
    });

    it("keeps fenced content verbatim across pushes", () => {
        const { renderer, text } = collect();
        renderer.push("```\n**raw**\n```\n");
        expect(text()).toContain("**raw**");
    });

    it("passes through unstyled in plain mode", () => {
        const chunks: string[] = [];
        const renderer = createStreamRenderer((s) => chunks.push(s), { plain: true });
        renderer.push("## raw **stays**\n");
        expect(chunks.join("")).toBe("## raw **stays**\n");
    });

    it("flushes a runaway line raw once it exceeds the buffer cap", () => {
        const { chunks, renderer } = collect();
        renderer.push("x".repeat(2100));
        expect(chunks.join("").length).toBe(2100);
    });
});
