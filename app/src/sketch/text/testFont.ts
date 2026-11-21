// Test helper (node only, never imported by the app): loads the bundled font from disk.
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { getLoadedFont, setFontForTests, type Font } from './font'

export function loadTestFont(): Font {
  const existing = getLoadedFont()
  if (existing) return existing
  const path = createRequire(import.meta.url).resolve('@fontsource/inter/files/inter-latin-700-normal.woff')
  setFontForTests(readFileSync(path))
  return getLoadedFont()!
}
