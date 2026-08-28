/** Public dsh-code execution modes and their upstream Agent Preset mapping. */

/** Product-facing mode names accepted by the CLI and `/mode`. */
export type AgentMode = 'standard' | 'ptc'

/** Preset ids shipped by DSH for the two supported dsh-code modes. */
export type SupportedAgentPreset = 'standard' | 'ptc'

export const DEFAULT_AGENT_MODE: AgentMode = 'standard'
export const DEFAULT_AGENT_PRESET: SupportedAgentPreset = 'standard'

/** Private launcher-to-TUI handoff. Cleared before every delegated launch. */
export const AGENT_MODE_ENV = 'DSH_CODE_AGENT_MODE'

export const AGENT_MODE_OPTIONS: readonly {
  mode: AgentMode
  preset: SupportedAgentPreset
  label: string
  description: string
}[] = [
  {
    mode: 'standard',
    preset: 'standard',
    label: 'Standard',
    description: 'Direct tool calls with the full coding-agent toolset.',
  },
  {
    mode: 'ptc',
    preset: 'ptc',
    label: 'PTC',
    description: 'Compose multiple tool operations in one TypeScript program.',
  },
]

/** Map a product-facing mode to the pinned upstream preset id. */
export function presetForAgentMode(mode: AgentMode): SupportedAgentPreset {
  return mode === 'ptc' ? 'ptc' : 'standard'
}

/** Map a recorded upstream preset id back to the supported product mode. */
export function agentModeForPreset(preset: string | undefined): AgentMode {
  return preset === 'ptc' || preset === 'code' ? 'ptc' : 'standard'
}

/** Resolve current and legacy persisted ids to a preset shipped by pinned DSH. */
export function supportedAgentPreset(preset: string | undefined): SupportedAgentPreset | undefined {
  if (preset === 'standard') return 'standard'
  if (preset === 'ptc' || preset === 'code') return 'ptc'
  return undefined
}

/** Parse an exact public mode name. */
export function parseAgentMode(value: string): AgentMode | undefined {
  return value === 'standard' || value === 'ptc' ? value : undefined
}

/** A preset may be recomposed only before the first model turn starts. */
export function sessionCanSwitchMode(events: readonly { type: string }[]): boolean {
  return !events.some(event => event.type === 'turn/start')
}
