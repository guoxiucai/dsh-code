import { describe, expect, it } from 'vitest'
import {
  agentModeForPreset,
  parseAgentMode,
  presetForAgentMode,
  sessionCanSwitchMode,
  supportedAgentPreset,
} from '../../src/agent-mode.ts'

describe('agent mode policy', () => {
  it('maps only Standard and PTC onto the supported upstream presets', () => {
    expect(parseAgentMode('standard')).toBe('standard')
    expect(parseAgentMode('ptc')).toBe('ptc')
    expect(parseAgentMode('minimal')).toBeUndefined()
    expect(presetForAgentMode('ptc')).toBe('ptc')
    expect(agentModeForPreset('ptc')).toBe('ptc')
    expect(agentModeForPreset('code')).toBe('ptc')
    expect(supportedAgentPreset('code')).toBe('ptc')
    expect(supportedAgentPreset('unknown')).toBeUndefined()
  })

  it('locks switching at the first turn boundary, not at slash-command audit events', () => {
    expect(sessionCanSwitchMode([{ type: 'command/run' }, { type: 'command/done' }])).toBe(true)
    expect(sessionCanSwitchMode([{ type: 'agent-preset/selected' }, { type: 'turn/start' }])).toBe(false)
  })
})
