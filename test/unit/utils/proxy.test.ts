import { afterEach, describe, expect, it, vi } from "vitest"
import { installFetchProxy } from "../../../src/utils/proxy.js"

const mocks = vi.hoisted(() => ({ agent: vi.fn(), fetch: vi.fn() }))
vi.mock("undici", () => ({
  EnvHttpProxyAgent: mocks.agent,
  fetch: mocks.fetch,
}))

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  mocks.agent.mockReset()
  mocks.fetch.mockReset()
})

describe("proxy diagnostic privacy", () => {
  it("keeps credentials out of successful setup diagnostics and preserves dispatch", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://synthetic-user:synthetic-password@proxy.invalid:8080")
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const dispatcher = {}
    mocks.agent.mockImplementation(function () {
      return dispatcher
    })
    await installFetchProxy()
    await globalThis.fetch("https://example.invalid/", { method: "GET" })
    expect(mocks.fetch).toHaveBeenCalledWith("https://example.invalid/", {
      method: "GET",
      dispatcher,
    })
    expect(log.mock.calls).toEqual([["[mcp-picnic] outbound fetch routed through proxy"]])
  })

  it("does not log dependency error objects containing proxy credentials", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://synthetic-user:synthetic-password@proxy.invalid:8080")
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.agent.mockImplementation(function () {
      throw new Error(process.env.HTTPS_PROXY)
    })
    await installFetchProxy()
    expect(globalThis.fetch).toBe(originalFetch)
    expect(log.mock.calls).toEqual([
      ["[mcp-picnic] proxy env var is set but proxy setup failed; continuing with direct egress"],
    ])
  })
})
