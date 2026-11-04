import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { brotliCompressSync } from "node:zlib"
import { describe, expect, it } from "vitest"

const root = new URL("../../../", import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), "utf8")

describe("Node security release contract", () => {
  it("keeps native and Docker runtime floors aligned with the Brotli security release", () => {
    const manifest = JSON.parse(read("package.json"))
    const lock = JSON.parse(read("package-lock.json"))
    expect(manifest.engines.node).toBe("^22.23.4 || ^24.22.1 || >=26.12.1")
    expect(lock.packages[""].engines).toEqual(manifest.engines)
    expect(read(".node-version").trim()).toBe("22.23.4")
    const images = [...read("Dockerfile").matchAll(/^FROM (node:\S+)/gm)].map(
      (match) => match[1],
    )
    expect(images).toEqual(["node:22.23.4-alpine", "node:22.23.4-alpine"])
  })

  it("decodes a Brotli-compressed response with the real Node fetch consumer", async () => {
    const payload = JSON.stringify({ items: [{ name: "local fixture" }] })
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "application/json",
        "content-encoding": "br",
      })
      response.end(brotliCompressSync(Buffer.from(payload)))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Missing test port")
      const response = await fetch(`http://127.0.0.1:${address.port}`)
      expect(await response.json()).toEqual(JSON.parse(payload))
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })
})
