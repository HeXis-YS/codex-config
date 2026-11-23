import { Plugin } from "@opencode/plugin"
import type { SessionRetry } from "@opencode/plugin/promise/session"
import { DeepseekFallbackRpc, type FallbackSwitchedEvent } from "./rpc"

export const PRIMARY_MODEL = {
  providerID: "opencode",
  id: "deepseek-v4.1-flash-free",
} as const

export const FALLBACK_MODEL = {
  providerID: "openrouter",
  id: "deepseek/deepseek-v4.1-flash-1017",
} as const

const QUOTA_ERROR_TYPES =
  /(?:^|\.)(?:quota(?:[-_]?exceeded)?|rate[-_]?limit|billing|credits?|insufficient[-_]?(?:credits?|quota)|free[-_]?usage[-_]?limit|usage[-_]?limit)$/i
const QUOTA_MESSAGE_PATTERN =
  /(?:quota|usage[-_\s]+limit|usage_not_included|(?:free|go|budget)usagelimiterror|creditlimitexceeded|free\s+(?:tier\s+|daily\s+)?limit|daily\s+limit|limit\s+exhausted|budget\s+exceeded|rate[\s_-]?limit|too\s+many\s+requests|insufficient[\s_-]*(?:credits?|quota|funds?|balance)|credit\s+balance)/i
const RESET_KEYS = ["reset", "resetAt", "reset_at", "resetsAt", "resets_at", "retryAfter", "retry_after"] as const

function parseErrorBody(raw?: string): Record<string, unknown> | undefined {
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export function isQuotaOrRateLimitError(error: SessionRetry["error"]): boolean {
  if (error.type.toLowerCase().includes("context")) return false
  if (QUOTA_ERROR_TYPES.test(error.type)) return true
  if (error.status === 402 || error.status === 429) return true
  const combined = `${error.message}\n${error.response?.body ?? ""}`
  return QUOTA_MESSAGE_PATTERN.test(combined)
}

export function formatQuotaReason(error: SessionRetry["error"]): string {
  let text = error.message.trim()
  const rawBody = error.response?.body?.trim()
  const body = parseErrorBody(rawBody)
  const nested =
    body?.error && typeof body.error === "object" && !Array.isArray(body.error)
      ? (body.error as Record<string, unknown>)
      : undefined

  // 优先采用上游原始响应体中的错误描述（保留上游附带的额度重置时间说明），避免被宿主通用文案覆盖。
  let upstreamMessage: string | undefined
  for (const candidate of [
    nested?.message,
    body?.message,
    body?.detail,
    typeof body?.error === "string" ? body.error : undefined,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      upstreamMessage = candidate.trim()
      break
    }
  }
  if (upstreamMessage) {
    text = upstreamMessage
  } else if (rawBody && !body && !/^<!doctype\s+html|^<html/i.test(rawBody)) {
    text = rawBody
  }

  const extras: string[] = []
  for (const source of [nested, body]) {
    if (!source) continue
    for (const key of RESET_KEYS) {
      const val = source[key]
      if ((typeof val === "string" || typeof val === "number") && String(val).trim()) {
        const str = String(val).trim()
        if (!text.includes(str)) extras.push(`${key}: ${str}`)
      }
    }
  }

  if (extras.length === 0 && typeof error.retryAfterMs === "number" && error.retryAfterMs > 0) {
    extras.push(`retryAfterMs: ${error.retryAfterMs}`)
  }

  const merged = [text, ...extras].filter(Boolean).join(" | ").replace(/\s+/g, " ").trim()
  return merged.length > 240 ? `${merged.slice(0, 237)}...` : merged
}

export default Plugin.define({
  id: "deepseek-fallback",
  async setup(ctx) {
    const rpc = await ctx.rpc.register(DeepseekFallbackRpc, {})

    await ctx.session.hook("retry", async (event) => {
      if (event.model.providerID !== PRIMARY_MODEL.providerID || event.model.id !== PRIMARY_MODEL.id) {
        return
      }
      if (event.agent === "title" || event.agent === "compaction" || event.agent === "summary") {
        return
      }
      if (!isQuotaOrRateLimitError(event.error)) return

      try {
        const session = await ctx.session.get({ sessionID: event.sessionID })
        if (
          session.model?.providerID === FALLBACK_MODEL.providerID &&
          session.model.id === FALLBACK_MODEL.id
        ) {
          // 会话已切到备用模型但宿主重试仍沿用旧模型引用时，立即终止重试以避免死循环。
          event.decision = { retry: false }
          return
        }
        if (
          session.model &&
          (session.model.providerID !== PRIMARY_MODEL.providerID || session.model.id !== PRIMARY_MODEL.id)
        ) {
          return
        }

        const { data: models } = await ctx.model.list({ location: session.location })
        const target = models.find(
          (item) =>
            item.enabled &&
            item.providerID === FALLBACK_MODEL.providerID &&
            (item.id === FALLBACK_MODEL.id || item.modelID === FALLBACK_MODEL.id),
        )
        if (!target) return

        const variant =
          event.model.variant &&
          event.model.variant !== "default" &&
          target.variants.some((item) => item.id === event.model.variant)
            ? event.model.variant
            : undefined

        await ctx.session.switchModel({
          sessionID: event.sessionID,
          model: {
            providerID: FALLBACK_MODEL.providerID,
            id: FALLBACK_MODEL.id,
            ...(variant ? { variant } : {}),
          },
        })

        event.decision = { retry: true, delay: 0 }

        const payload: FallbackSwitchedEvent = {
          sessionID: event.sessionID,
          from: `${PRIMARY_MODEL.providerID}/${PRIMARY_MODEL.id}`,
          to: `${FALLBACK_MODEL.providerID}/${FALLBACK_MODEL.id}`,
          reason: formatQuotaReason(event.error),
          ...(event.error.status !== undefined ? { status: event.error.status } : {}),
        }
        await rpc.events.emit("switched", payload).catch(() => {})
      } catch (err) {
        console.error("[deepseek-fallback] failed to switch model during retry:", err)
      }
    })
  },
})
