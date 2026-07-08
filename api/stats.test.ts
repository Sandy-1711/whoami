import { beforeEach, describe, it, expect, vi } from "vitest";
import { VercelRequest, VercelResponse } from "@vercel/node";

const { mockGet, mockMakeRedis } = vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockMakeRedis: vi.fn()
}))

vi.mock("../lib/redis.js", () => ({
    makeRedis: mockMakeRedis
}))

import handler from './stats';


describe("Stats API Test", () => {
    let mockReq: Partial<VercelRequest> = {}
    let mockRes: Partial<VercelResponse> = {}
    let headers: Record<string, string> = {}
    let responseStatus: number | null = null
    let responseData: any | null = null

    beforeEach(() => {
        vi.resetAllMocks();

        mockReq = {}
        headers = {}
        responseStatus = null
        responseData = null
        mockMakeRedis.mockReturnValue({
            get: mockGet,
        })
        mockRes = {
            setHeader: vi.fn().mockImplementation((key, value) => {
                headers[key] = value
                return mockRes
            }),
            status: vi.fn().mockImplementation((code: number) => {
                responseStatus = code
                return mockRes
            }),
            json: vi.fn().mockImplementation((data) => {
                responseData = data;
                return mockRes;
            }),
        }
    })
    it("should return 200 and the views count", async () => {
        mockGet.mockResolvedValueOnce("42")
        await handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(responseStatus).toBe(200)
        expect(headers['Cache-Control']).toBe('no-store')
        expect(responseData).toEqual({ views: 42 })
        expect(responseData.views).toBeTypeOf('number')
    })
    it("should return 0 views if redis is unreachable", async () => {
        mockMakeRedis.mockReturnValueOnce(null)
        await handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(responseStatus).toBe(200)
        expect(headers['Cache-Control']).toBe('no-store')
        expect(responseData).toEqual({ views: 0 })
        expect(responseData.views).toBeTypeOf('number')
    })
    it("should return 0 if redis.get throws", async () => {
        mockGet.mockRejectedValueOnce(new Error("Redis down"));

        await handler(mockReq as VercelRequest, mockRes as VercelResponse);

        expect(responseStatus).toBe(200);
        expect(responseData).toEqual({ views: 0 });
    });
    it("should return 0 when redis.get returns null", async () => {
        mockGet.mockResolvedValueOnce(null);

        await handler(mockReq as VercelRequest, mockRes as VercelResponse);

        expect(responseStatus).toBe(200);
        expect(responseData).toEqual({ views: 0 });
    });
})