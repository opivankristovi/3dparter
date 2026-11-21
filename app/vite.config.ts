import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

/**
 * Writes dist/sw.js after the build: scripts/sw.template.js with the list of every emitted file (app shell, hashed
 * JS/CSS, the OpenCascade .wasm, fonts, icons) and a version hash of their contents. Source maps and
 * the social card are left out.
 */
function precache(): Plugin {
  let outDir = 'dist'
  return {
    name: 'precache-sw',
    apply: 'build',
    enforce: 'post',
    configResolved(c) {
      outDir = c.build.outDir
    },
    closeBundle() {
      const files: string[] = []
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name)
          if (statSync(full).isDirectory()) walk(full)
          else files.push(relative(outDir, full).split(sep).join('/'))
        }
      }
      walk(outDir)
      const list = files
        .filter((f) => f !== 'sw.js' && f !== 'social-card.png' && !f.endsWith('.map'))
        .sort()
      const hash = createHash('sha1')
      for (const f of list) hash.update(f).update(readFileSync(join(outDir, f)))
      const version = hash.digest('hex').slice(0, 12)
      const template = readFileSync(new URL('./scripts/sw.template.js', import.meta.url), 'utf8')
      const sw = template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(['', ...list], null, 2))
      writeFileSync(join(outDir, 'sw.js'), sw)
      console.log(`precache-sw: ${list.length + 1} entries, version ${version}`)
    },
  }
}

/** BASE_PATH env (default '/') as a Vite base: leading and trailing slash. '/3dparter' becomes '/3dparter/'. */
function normalizeBase(raw: string | undefined): string {
  const v = (raw ?? '').trim()
  if (!v || v === '/') return '/'
  return '/' + v.replace(/^\/+|\/+$/g, '') + '/'
}

/**
 * Fills the Open Graph tags that must be absolute. SITE_URL (e.g. https://opivankristovi.github.io/3dparter/) gives
 * og:url and an absolute og:image. Without it og:url is left out and og:image is relative to the base.
 */
function socialTags(base: string, siteUrl: string | undefined): Plugin {
  const site = siteUrl?.trim() ? siteUrl.trim().replace(/\/*$/, '/') : ''
  return {
    name: 'social-tags',
    transformIndexHtml(html) {
      const image = site ? `${site}social-card.png` : `${base}social-card.png`
      return html
        .replaceAll('__OG_IMAGE__', image)
        .replace('<!--og-url-->', site ? `<meta property="og:url" content="${site}" />` : '')
    },
  }
}

// https://vite.dev/config/
const base = normalizeBase(process.env.BASE_PATH)
export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), socialTags(base, process.env.SITE_URL), precache()],
  server: { port: 5173, strictPort: true },
  worker: { format: 'es' },
  // The OpenCascade build ships its own .wasm; pre-bundling it breaks the wasm URL lookup.
  optimizeDeps: { exclude: ['replicad-opencascadejs'] },
})
