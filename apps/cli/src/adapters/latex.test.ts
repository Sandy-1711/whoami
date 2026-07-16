import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: mockSpawnSync }));

import { haveCmd, dockerDaemonUp, compileLatex, renderEngineReason, resetEngineProbeCache } from "./latex.js";

// A spawnSync return where only the exit status matters here.
const exit = (status: number) => ({ status, stdout: "", stderr: "" });

describe("latex helpers", () => {
    beforeEach(() => { vi.resetAllMocks(); resetEngineProbeCache(); });
    afterEach(() => vi.resetAllMocks());

    describe("haveCmd", () => {
        it("should be true when the command exits 0", () => {
            mockSpawnSync.mockReturnValue(exit(0));
            expect(haveCmd("latexmk")).toBe(true);
        });
        it("should be false when the command is missing (non-zero exit)", () => {
            mockSpawnSync.mockReturnValue(exit(1));
            expect(haveCmd("latexmk")).toBe(false);
        });
    });

    describe("dockerDaemonUp", () => {
        it("should be true when `docker version` succeeds", () => {
            mockSpawnSync.mockReturnValue(exit(0));
            expect(dockerDaemonUp()).toBe(true);
        });
    });

    describe("compileLatex", () => {
        it("should use latexmk when it is on PATH", () => {
            // First call: haveCmd('latexmk') -> 0; second: the compile itself.
            mockSpawnSync.mockReturnValue(exit(0));
            const res = compileLatex("/root", "resume.tex", { outDir: "build" });
            expect(res.engine).toBe("latexmk");
            expect(res.status).toBe(0);
        });

        it("should report docker-daemon-down when latexmk is absent and the daemon is unreachable", () => {
            // haveCmd('latexmk') -> 1, haveCmd('docker') -> 0, dockerDaemonUp() -> 1.
            mockSpawnSync
                .mockReturnValueOnce(exit(1)) // latexmk --version
                .mockReturnValueOnce(exit(0)) // docker --version
                .mockReturnValueOnce(exit(1)); // docker version (daemon check)
            const res = compileLatex("/root", "resume.tex");
            expect(res.engine).toBe("docker");
            expect(res.reason).toBe("docker-daemon-down");
        });

        it("should report no-engine when neither latexmk nor docker exist", () => {
            mockSpawnSync.mockReturnValue(exit(1));
            const res = compileLatex("/root", "resume.tex");
            expect(res.engine).toBeNull();
            expect(res.reason).toBe("no-engine");
        });
    });

    describe("renderEngineReason", () => {
        it("memoizes the probe — repeat calls spawn nothing new until reset", () => {
            mockSpawnSync.mockReturnValue(exit(0)); // latexmk present
            expect(renderEngineReason()).toBeNull();
            const spawnsAfterFirst = mockSpawnSync.mock.calls.length;
            expect(renderEngineReason()).toBeNull();
            expect(renderEngineReason()).toBeNull();
            expect(mockSpawnSync.mock.calls.length).toBe(spawnsAfterFirst);

            resetEngineProbeCache();
            renderEngineReason();
            expect(mockSpawnSync.mock.calls.length).toBeGreaterThan(spawnsAfterFirst);
        });

        it("caches a negative probe too (no-engine)", () => {
            mockSpawnSync.mockReturnValue(exit(1));
            expect(renderEngineReason()).toBe("no-engine");
            const spawnsAfterFirst = mockSpawnSync.mock.calls.length;
            expect(renderEngineReason()).toBe("no-engine");
            expect(mockSpawnSync.mock.calls.length).toBe(spawnsAfterFirst);
        });
    });
});
