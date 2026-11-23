import type { Rpc } from "@opencode/plugin/rpc"

export type FallbackSwitchedEvent = {
  sessionID: string
  from: string
  to: string
  reason: string
  status?: number
}

const switchedSchema = {
  type: "object",
  properties: {
    sessionID: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    reason: { type: "string" },
    status: { type: "number" },
  },
  required: ["sessionID", "from", "to", "reason"],
  additionalProperties: false,
} as const

export const DeepseekFallbackRpc = {
  id: "deepseek-fallback",
  methods: {},
  events: {
    switched: {
      schema: switchedSchema,
    },
  },
} satisfies Rpc.PortableDefinition
