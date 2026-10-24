import { afterEach, describe, expect, it } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { StreamableHttpServer } from "../../../src/transports/streamable-http.js"
import { toolRegistry } from "../../../src/tools/index.js"
import { z } from "zod"

describe("HTTP resource limits with the real SDK", () => {
  let server: StreamableHttpServer
  let client: Client
  afterEach(async () => {
    await client?.close()
    await server?.stop()
  })

  it("caps parsed HTTP bodies before dispatch", async () => {
    server = new StreamableHttpServer({ port: 0, enableRequestLogging: false })
    await server.start()
    const address = server["server"].address() as import("net").AddressInfo
    const url = `http://127.0.0.1:${address.port}/mcp`
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(1024 * 1024) }),
    })
    expect(response.status).toBe(413)
  })

  it("discovers Zod 4 schemas, rejects oversized calls and batches, then stays usable", async () => {
    toolRegistry.register({ name: "limit_probe", description: "local test only",
      inputSchema: z.object({ items: z.array(z.string()) }), handler: async () => "ok" })
    server = new StreamableHttpServer({ port: 0, enableRequestLogging: false })
    await server.start()
    const address = server["server"].address() as import("net").AddressInfo
    const url = new URL(`http://127.0.0.1:${address.port}/mcp`)
    client = new Client({ name: "limits-test", version: "1" })
    const transport = new StreamableHTTPClientTransport(url)
    await client.connect(transport)
    const tools = (await client.listTools()).tools
    const search = tools.find((tool) => tool.name === "picnic_search")!
    expect(search.inputSchema.properties).toHaveProperty("query", { type: "string", description: "Search query for products" })
    expect(search.inputSchema.required).toEqual(["query"])
    const result = await client.callTool({ name: "limit_probe", arguments: { items: Array(10_000).fill("x") } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toMatch(/input.*limit/i)
    const batch = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": transport.sessionId! },
      body: JSON.stringify(Array.from({ length: 101 }, () => ({ jsonrpc: "2.0", method: "notifications/initialized" }))),
    })
    expect(batch.status).toBe(400)
    expect((await client.callTool({ name: "limit_probe", arguments: { items: ["safe"] } })).isError).not.toBe(true)
  })
})
