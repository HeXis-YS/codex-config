import type { Rpc } from "@opencode/plugin/rpc"

export type CommanderStatus = {
  sessionID: string
  enabled: boolean
}

const statusSchema = {
  type: "object",
  properties: {
    sessionID: { type: "string" },
    enabled: { type: "boolean" },
  },
  required: ["sessionID", "enabled"],
  additionalProperties: false,
} as const

export const CommanderRpc = {
  id: "commander",
  methods: {
    status: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: statusSchema,
    },
    set: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          enabled: { type: "boolean" },
        },
        required: ["sessionID", "enabled"],
        additionalProperties: false,
      },
      output: statusSchema,
    },
    toggle: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: statusSchema,
    },
  },
  events: {
    updated: {
      schema: statusSchema,
    },
  },
} satisfies Rpc.PortableDefinition
