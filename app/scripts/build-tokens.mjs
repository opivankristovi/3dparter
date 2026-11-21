// Reads app/design/tokens*.json (moved from replica/design so the app builds on its own) and writes src/styles/tokens.css.
// Rerun after a rebrand: `npm run tokens` (also runs in predev / prebuild).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const designDir = resolve(here, '../design')
const outFile = resolve(here, '../src/styles/tokens.css')

const light = JSON.parse(readFileSync(resolve(designDir, 'tokens.json'), 'utf8'))
const dark = JSON.parse(readFileSync(resolve(designDir, 'tokens.dark.json'), 'utf8'))

const colorLines = (colors, indent) =>
  Object.entries(colors).map(([name, value]) => `${indent}--t-color-${name}: ${value};`)

const lines = []

// fonts
lines.push(`  --t-font-sans: ${light.font.sans};`)
lines.push(`  --t-font-mono: ${light.font.mono};`)

// type scale
for (const [step, t] of Object.entries(light.type)) {
  lines.push(`  --t-text-${step}: ${t.size}px;`)
  lines.push(`  --t-text-${step}--line-height: ${t.line}px;`)
  lines.push(`  --t-text-${step}--font-weight: ${t.weight};`)
}

// space
light.space.forEach((v, i) => lines.push(`  --space-${i}: ${v}px;`))

// radius, shadow, motion
for (const [k, v] of Object.entries(light.radius)) lines.push(`  --t-radius-${k}: ${v}px;`)
for (const [k, v] of Object.entries(light.shadow)) lines.push(`  --t-shadow-${k}: ${v};`)
for (const [k, v] of Object.entries(light.motion)) lines.push(`  --motion-${k}: ${v};`)

// layout (numbers -> px, breakpoints nested)
for (const [k, v] of Object.entries(light.layout)) {
  if (typeof v === 'object') {
    for (const [bk, bv] of Object.entries(v)) lines.push(`  --layout-breakpoint-${bk}: ${bv}px;`)
  } else {
    lines.push(`  --layout-${k}: ${v}px;`)
  }
}

const css = `/* GENERATED from app/design/tokens*.json — do not edit. Run \`npm run tokens\`. */

:root,
[data-theme="light"] {
${colorLines(light.color, '  ').join('\n')}
${lines.join('\n')}
  color-scheme: light;
}

[data-theme="dark"] {
${colorLines(dark.color, '  ').join('\n')}
  color-scheme: dark;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${colorLines(dark.color, '    ').join('\n')}
    color-scheme: dark;
  }
}
`

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, css)
console.log(`tokens.css written (${Object.keys(light.color).length} colours)`)
