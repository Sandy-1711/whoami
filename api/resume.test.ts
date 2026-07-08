import { describe, it, expect, vi, beforeEach } from "vitest";
import { VercelRequest, VercelRequestQuery, VercelResponse } from "@vercel/node";

const { mockMakeRedis, mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
    mockMakeRedis: vi.fn(),
    mockExistsSync: vi.fn(),
    mockReadFileSync: vi.fn(),
}));
vi.mock("../lib/redis.js", () => ({
    makeRedis: mockMakeRedis,
}));

vi.mock("node:fs", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");

    return {
        ...actual,
        existsSync: mockExistsSync,
        readFileSync: mockReadFileSync,
    };
});


const getContentDispositionHeader = (download: boolean) => {
    const encoded = encodeURIComponent(DOWNLOAD_FILENAME);
    return `${download ? 'attachment' : 'inline'}; filename="${DOWNLOAD_FILENAME}"; filename*=UTF-8''${encoded}`;
}

import handler from "./resume"
import { DOWNLOAD_FILENAME } from "../constants/constants.js";
import { originFrom } from "../lib/origin-from.js";

describe("Resume API Tests", () => {

    let mockReq: Partial<VercelRequest> = {}
    let mockRes: Partial<VercelResponse> = {}
    let responseHeaders: Record<string, string> = {}
    let responseStatus: number | null = null
    let responseData: any | null = null


    beforeEach(() => {
        vi.resetAllMocks()
        mockReq = {
            headers: {}
        }
        mockRes = {}
        responseHeaders = {}
        responseStatus = null
        responseData = null
        mockRes = {
            setHeader: vi.fn().mockImplementation((key, value) => {
                responseHeaders[key] = value
                return mockRes
            }),
            end: vi.fn().mockImplementation((data) => {
                responseData = data
                return mockRes
            })
        }
        Object.defineProperty(mockRes, "statusCode", {
            set(value) {
                responseStatus = value;
            },
            get() {
                return responseStatus;
            },
        });
    })
    it("should return previewHTML to crawlers", async () => {
        mockReq.headers = {
            "user-agent": "Twitterbot",
            "host": "example.com",
        }
        await handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(responseStatus).toBe(200)
        expect(responseHeaders['Content-Type']).toBe('text/html; charset=utf-8')
        expect(responseHeaders['Cache-Control']).toBe('public, max-age=3600, s-maxage=3600')
        expect(responseData).toContain("<!DOCTYPE html>");
        expect(responseData).toContain("og:title");
    })
    it("should return 503 if file does not exist", async () => {
        mockExistsSync.mockReturnValueOnce(false)
        await handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(responseStatus).toBe(503)
        expect(responseHeaders['Content-Type']).toBe('text/plain')
        expect(responseData).toContain("Resume PDF has not been built yet");
    })
    it("should return 503 if read throws error", async () => {
        mockReadFileSync.mockImplementationOnce(() => {
            throw new Error("Could not read file");
        });
        await handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(responseStatus).toBe(503)
        expect(responseHeaders['Content-Type']).toBe('text/plain')
        expect(responseData).toContain("Resume PDF has not been built yet");
    })
    it("should increment views if redis is available", async () => {
        const mockIncr = vi.fn().mockResolvedValue(1);
        mockMakeRedis.mockReturnValue({
            incr: mockIncr
        })
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(Buffer.from("pdf"));
        await handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(mockIncr).toHaveBeenCalledWith("resume:views");
        expect(responseStatus).toBe(200);
        expect(responseHeaders["Content-Type"]).toBe("application/pdf");
        expect(responseData).toEqual(Buffer.from("pdf"));
    })
    it("should not increment views if redis is not available", async () => {
        mockMakeRedis.mockReturnValue(null)
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(Buffer.from("pdf"));
        await handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(responseStatus).toBe(200);
        expect(responseHeaders["Content-Type"]).toBe("application/pdf");
        expect(responseData).toEqual(Buffer.from("pdf"));
    })
    it("should set download headers if download query parameter is present and return pdf", async () => {
        mockReq = {
            query: {
                download: "true"
            } as VercelRequestQuery
            , ...mockReq
        } as VercelRequest
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(Buffer.from("pdf"));
        await handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(responseStatus).toBe(200);
        expect(responseData).toEqual(Buffer.from("pdf"));
        expect(responseHeaders["Content-Disposition"]).toContain(getContentDispositionHeader(true));
        expect(responseHeaders["Cache-Control"]).toBe("no-store, max-age=0");
    })
    it("should set inline headers if download query parameter is not present and return pdf", async () => {
        const download = false;
        mockReq = {
            query: {} as VercelRequestQuery,
            ...mockReq
        } as VercelRequest
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(Buffer.from("pdf"));
        await handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(responseStatus).toBe(200);
        expect(responseData).toEqual(Buffer.from("pdf"));
        expect(responseHeaders["Content-Disposition"]).toContain(getContentDispositionHeader(false));
        expect(responseHeaders["Cache-Control"]).toBe("no-store, max-age=0");
    })
    it("should use forwarded host and proto", async () => {
        mockReq.headers = {
            "user-agent": "Twitterbot",
            "x-forwarded-host": "portfolio.example.com",
            "x-forwarded-proto": "http",
        };

        await handler(mockReq as VercelRequest, mockRes as VercelResponse);

        expect(originFrom(mockReq as VercelRequest)).toBe("http://portfolio.example.com");
        expect(responseData).toContain("http://portfolio.example.com/og.jpg");
    });
    it("should use host when forwarded host is absent", async () => {
        mockReq.headers = {
            "user-agent": "Twitterbot",
            host: "localhost:3000",
        };

        await handler(mockReq as VercelRequest, mockRes as VercelResponse);
        expect(originFrom(mockReq as VercelRequest)).toBe("https://localhost:3000");
        expect(responseData).toContain("https://localhost:3000");
    });
    it("should use default origin when no headers are present", async () => {
        mockReq.headers = {
            "user-agent": "Twitterbot",
        };

        await handler(mockReq as VercelRequest, mockRes as VercelResponse);
        expect(originFrom(mockReq as VercelRequest)).toBe("https://iamsandeep.vercel.app");
        expect(responseData).toContain("https://iamsandeep.vercel.app");
    });
})