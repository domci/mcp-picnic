import { ToolError, ErrorCode } from "../types/errors.js"

// Enough for normal meal-planning batches; split larger ingredient lists.
export const MAX_TOOL_INPUT_ELEMENTS = 10_000
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024

/** Bound work before Zod parses input in the custom (non-SDK) tool registry. */
export function assertToolInputLimits(input: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }]
  let elements = 0
  while (pending.length > 0) {
    const { value, depth } = pending.pop()!
    if (value === null || typeof value !== "object") continue
    if (depth > 64) {
      throw new ToolError(ErrorCode.TOOL_VALIDATION_FAILED, "Tool input exceeds depth limit")
    }
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue
      if (++elements > MAX_TOOL_INPUT_ELEMENTS) {
        throw new ToolError(ErrorCode.TOOL_VALIDATION_FAILED, "Tool input exceeds element limit")
      }
      pending.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 })
    }
  }
}
