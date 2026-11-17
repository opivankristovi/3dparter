import { useEffect } from 'react'
import { create } from 'zustand'
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../data/projects'
import type { SettingsRow } from '../data/projects'

interface SettingsState {
  settings: SettingsRow
  ready: boolean
  init(): Promise<void>
  update(partial: Partial<Omit<SettingsRow, 'id'>>): Promise<void>
  /** Switches between light and dark. From "system" it picks the opposite of what is showing now. */
  toggleTheme(): void
}

/** "system" removes the attribute so the media query in tokens.css decides. */
export function applyTheme(theme: SettingsRow['theme']) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  ready: false,
  async init() {
    try {
      const settings = await getSettings()
      applyTheme(settings.theme)
      set({ settings, ready: true })
    } catch {
      set({ ready: true })
    }
  },
  async update(partial) {
    // Apply first so the UI answers at once; the write follows.
    const next = { ...get().settings, ...partial }
    if (partial.theme) applyTheme(next.theme)
    set({ settings: next })
    try {
      set({ settings: await updateSettings(partial) })
    } catch {
      // Storage unavailable: the choice still holds for this session.
    }
  },
  toggleTheme() {
    const { theme } = get().settings
    const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark())
    void get().update({ theme: dark ? 'light' : 'dark' })
  },
}))

/** True while the effective theme is dark (for picking an icon). */
export function useIsDark(): boolean {
  const theme = useSettings((s) => s.settings.theme)
  return theme === 'dark' || (theme === 'system' && systemPrefersDark())
}

/** Keeps `data-theme` in step with the setting when "system" changes underneath us. */
export function useThemeSync() {
  const theme = useSettings((s) => s.settings.theme)
  useEffect(() => applyTheme(theme), [theme])
}
