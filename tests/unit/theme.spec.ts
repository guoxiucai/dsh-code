import { afterEach, describe, expect, it } from 'vitest'
import type { TerminalColorScheme, TUI } from '@earendil-works/pi-tui'
import {
  THEME_PALETTES,
  bindAdaptiveTheme,
  colorSchemeForBackground,
  getThemeColorScheme,
  setThemeColorScheme,
  theme,
} from '../../src/tui/theme.ts'

describe('adaptive terminal theme', () => {
  afterEach(() => { setThemeColorScheme('dark') })

  it('uses the brighter DeepSeek blue and dark content blocks on dark terminals', () => {
    setThemeColorScheme('dark')

    expect(THEME_PALETTES.dark).toEqual({
      accent: '107;132;255',
      userBg: '52;53;65',
      toolBg: '40;50;40',
      diffAddedBg: '29;63;42',
      diffRemovedBg: '74;35;35',
    })
    if (process.env.NO_COLOR === undefined) {
      expect(theme.accent('brand')).toContain('\x1b[38;2;107;132;255m')
      expect(theme.userBg('block')).toContain('\x1b[48;2;52;53;65m')
      expect(theme.diffAddedBg('line')).toContain('\x1b[48;2;29;63;42m')
      expect(theme.diffRemovedBg('line')).toContain('\x1b[48;2;74;35;35m')
    } else {
      expect(theme.accent('brand')).toBe('brand')
      expect(theme.userBg('block')).toBe('block')
    }
  })

  it('uses the deeper DeepSeek blue and pale content blocks on light terminals', () => {
    expect(setThemeColorScheme('light')).toBe(true)
    expect(getThemeColorScheme()).toBe('light')
    expect(setThemeColorScheme('light')).toBe(false)
    expect(THEME_PALETTES.light).toEqual({
      accent: '64;91;216',
      userBg: '238;241;255',
      toolBg: '239;247;240',
      diffAddedBg: '218;242;225',
      diffRemovedBg: '250;218;218',
    })
    if (process.env.NO_COLOR === undefined) {
      expect(theme.accent('brand')).toContain('\x1b[38;2;64;91;216m')
      expect(theme.userBg('block')).toContain('\x1b[48;2;238;241;255m')
      expect(theme.toolBg('block')).toContain('\x1b[48;2;239;247;240m')
      expect(theme.diffAddedBg('line')).toContain('\x1b[48;2;218;242;225m')
      expect(theme.diffRemovedBg('line')).toContain('\x1b[48;2;250;218;218m')
    }
  })

  it('classifies actual terminal backgrounds when preference detection is unavailable', () => {
    expect(colorSchemeForBackground({ r: 20, g: 24, b: 32 })).toBe('dark')
    expect(colorSchemeForBackground({ r: 250, g: 250, b: 248 })).toBe('light')
  })

  it('applies detection, notifications, and disposal to a TUI binding', async () => {
    let listener: ((scheme: TerminalColorScheme) => void) | undefined
    const notifications: boolean[] = []
    let invalidations = 0
    let renders = 0
    let changes = 0
    const tui = {
      onTerminalColorSchemeChange: (next: (scheme: TerminalColorScheme) => void) => {
        listener = next
        return () => { listener = undefined }
      },
      setTerminalColorSchemeNotifications: (enabled: boolean) => { notifications.push(enabled) },
      queryTerminalColorScheme: async () => undefined,
      queryTerminalBackgroundColor: async () => ({ r: 255, g: 255, b: 255 }),
      invalidate: () => { invalidations += 1 },
      requestRender: () => { renders += 1 },
    } as unknown as TUI

    const binding = bindAdaptiveTheme(tui, () => { changes += 1 })
    await binding.detect()
    expect(getThemeColorScheme()).toBe('light')
    expect({ invalidations, renders, changes }).toEqual({ invalidations: 1, renders: 1, changes: 1 })

    listener?.('dark')
    expect(getThemeColorScheme()).toBe('dark')
    expect({ invalidations, renders, changes }).toEqual({ invalidations: 2, renders: 2, changes: 2 })

    binding.dispose()
    expect(notifications).toEqual([true, false])
    expect(listener).toBeUndefined()
  })
})
