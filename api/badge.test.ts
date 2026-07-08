import { describe, it, expect, vi, beforeEach } from "vitest";
import { VercelRequest, VercelResponse } from "@vercel/node";


const { mockGet, mockMakeRedis } = vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockMakeRedis: vi.fn(),
}));

vi.mock("../lib/redis.js", () => ({
    makeRedis: mockMakeRedis,
}));;

import handler from './badge';

describe("Badge API Test", () => {
    let mockReq: Partial<VercelRequest> = {}
    let mockRes: Partial<VercelResponse> = {}
    let headers: Record<string, string> = {}
    let responseStatus: number | null = null
    let responseData: any | null = null
    beforeEach(async () => {
        vi.resetAllMocks()
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
    it("should call redis.get with the correct key", async () => {
        await handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(mockGet).toHaveBeenCalledWith("resume:views")
    })
    it("should set proper headers and status code", async () => {
        await handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(headers['Cache-Control']).toBe('no-store')
        expect(responseStatus).toBe(200)
    })
    it("should return a badge for a valid request", async () => {
        mockGet.mockResolvedValueOnce("42")
        await handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(responseData).toEqual({
            schemaVersion: 1,
            label: 'resume views',
            message: '42',
            color: 'blue',
        })
    })
    it("should default to 0 views if redis is unreachable", async () => {
        mockGet.mockRejectedValueOnce(new Error("Redis unreachable"))
        await handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(responseStatus).toBe(200)
        expect(responseData.message).toBe('0')
    })
    it("should default to 0 views if redis returns null", async () => {
        mockMakeRedis.mockReturnValueOnce(null)
        await handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(responseStatus).toBe(200)
        expect(responseData.message).toBe('0')
    })
})