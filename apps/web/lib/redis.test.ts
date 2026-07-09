import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { MockRedis } = vi.hoisted(() => ({
    MockRedis: vi.fn()
}))

vi.mock("@upstash/redis", () => ({
    Redis: MockRedis
}))

import { makeRedis } from "../lib/redis.js";

describe("redis tests", () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        vi.resetAllMocks()
        process.env = { ...OLD_ENV };
        delete process.env.UPSTASH_REDIS_REST_URL
        delete process.env.UPSTASH_REDIS_REST_TOKEN
        delete process.env.KV_REST_API_URL
        delete process.env.KV_REST_API_TOKEN
    })
    afterEach(() => {
        delete process.env.UPSTASH_REDIS_REST_URL
        delete process.env.UPSTASH_REDIS_REST_TOKEN
        delete process.env.KV_REST_API_URL
        delete process.env.KV_REST_API_TOKEN

        process.env = OLD_ENV;
    })
    it("should return null if there is no url or token", () => {
        expect(makeRedis()).toBeNull();
        expect(MockRedis).not.toHaveBeenCalled()
    })
    it("should create Redis instance with upstash creds", () => {
        process.env.UPSTASH_REDIS_REST_URL = "https://example.com"
        process.env.UPSTASH_REDIS_REST_TOKEN = "token"
        const instance = {}
        MockRedis.mockImplementation(function () {
            return instance;
        });
        expect(makeRedis()).toBe(instance)
        expect(MockRedis).toHaveBeenCalledWith({
            url: "https://example.com",
            token: "token"
        })
    })
    it(("should create Redis instance with vercel kv creds"), () => {
        process.env.KV_REST_API_URL = "https://example.com"
        process.env.KV_REST_API_TOKEN = "token"

        const instance = {}
        MockRedis.mockImplementation(function () {
            return instance;
        });
        expect(makeRedis()).toBe(instance)
        expect(MockRedis).toHaveBeenCalledWith({
            url: "https://example.com",
            token: "token"
        })
    })
    it("should prefer upstash creds over vercel kv creds", () => {
        process.env.UPSTASH_REDIS_REST_URL = "https://upstash.com"
        process.env.UPSTASH_REDIS_REST_TOKEN = "upstash_token"
        process.env.KV_REST_API_URL = "https://vercel.com"
        process.env.KV_REST_API_TOKEN = "kv_token"
        const instance = {}
        MockRedis.mockImplementation(function () {
            return instance
        })
        expect(makeRedis()).toBe(instance)
        expect(MockRedis).toHaveBeenCalledWith({
            url: "https://upstash.com",
            token: "upstash_token"
        })
    })

});