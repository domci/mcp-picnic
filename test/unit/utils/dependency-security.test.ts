import { describe, expect, it } from "vitest"
import { Headers, setCookie } from "undici"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { z } from "zod"

// GHSA-v3r7-h72x-cjcm: exercise the dependency, without any network requests.
describe("HTTP dependency security", () => {
  it("rejects cookie attribute injection through a domain", () => {
    const headers = new Headers()

    expect(() =>
      setCookie(headers, {
        name: "session",
        value: "test",
        domain: "example.com; SameSite=None",
      }),
    ).toThrow()
    expect(headers.has("set-cookie")).toBe(false)
  })

  it("preserves SDK tool discovery and validation over an in-memory connection", async () => {
    const server = new McpServer({ name: "dependency-test", version: "1.0.0" })
    const client = new Client({ name: "test-client", version: "1.0.0" })
    server.registerTool("echo", { inputSchema: { value: z.string() } }, async ({ value }) => ({
      content: [{ type: "text", text: value }],
    }))
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["echo"])
      expect(await client.callTool({ name: "echo", arguments: { value: "test" } })).toEqual({
        content: [{ type: "text", text: "test" }],
      })
      expect(await client.callTool({ name: "echo", arguments: { value: 123 } })).toMatchObject({
        isError: true,
      })
    } finally {
      await client.close()
      await server.close()
    }
  })
})
