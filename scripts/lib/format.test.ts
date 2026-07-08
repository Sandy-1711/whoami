import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { timeAgo } from "./format.js";

describe("timeAgo", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
    const MIN = 60_000;
    const HOUR = 60 * MIN;
    const DAY = 24 * HOUR;

    it("should return 'never' for a missing timestamp", () => {
        expect(timeAgo(null)).toBe("never");
        expect(timeAgo(undefined)).toBe("never");
    });
    it("should return 'just now' for under half a minute", () => {
        expect(timeAgo(ago(20_000))).toBe("just now");
    });
    it("should render minutes, hours and days", () => {
        expect(timeAgo(ago(5 * MIN))).toBe("5m ago");
        expect(timeAgo(ago(3 * HOUR))).toBe("3h ago");
        expect(timeAgo(ago(2 * DAY))).toBe("2d ago");
    });
});
