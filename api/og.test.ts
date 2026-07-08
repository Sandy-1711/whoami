import { expect, it, vi, describe, beforeEach } from "vitest"
import { VercelRequest, VercelResponse } from '@vercel/node';

const { mockLoadImage } = vi.hoisted(() => ({
    mockLoadImage: vi.fn(),
}))

vi.mock("../lib/load-image", () => ({
    loadImage: mockLoadImage,
}));

import handler from "./og.js"
describe("OG API Test", () => {
    let headers: Record<string, string> = {}
    let responseStatus: number | null = null
    let mockReq: Partial<VercelRequest> = {}
    let mockRes: Partial<VercelResponse> = {}
    let responseData: any = {}

    beforeEach(() => {
        responseStatus = null;
        headers = {}
        mockReq = {}
        mockRes = {}
        responseData = {}

        mockRes = {
            setHeader: vi.fn().mockImplementation((key, value) => {
                headers[key] = value
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
    it("should return 404 if image is not found", () => {
        mockLoadImage.mockReturnValueOnce(null)
        handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(responseStatus).toBe(404)
        expect(headers['Content-Type']).toBe('text/plain')
        expect(responseData).toBe('OG image not found.')
    })
    it("should return 200 and the image if found", () => {

        mockLoadImage.mockReturnValue(Buffer.from("fake image data"))
        handler(mockReq as VercelRequest, mockRes as VercelResponse)
        expect(responseStatus).toBe(200)
        expect(headers['Cache-Control']).toBe("public, max-age=86400, s-maxage=86400, immutable")
        expect(responseData).not.toBe(null)
    })
})