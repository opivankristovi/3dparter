// Draws the 3DParter mark and renders every icon and the social card. Re-runnable: `node scripts/render-assets.mjs`.
// The mark is hand-drawn here (a faceted hexagonal prism with a recessed pocket); nothing is traced from another logo.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'public')
const launchAssets = join(root, '..', 'replica', 'launch', 'assets')
mkdirSync(launchAssets, { recursive: true })

// Deep Teal palette (app/design/tokens*.json).
const C = { deep: '#0b6e69', deeper: '#085552', mint: '#2dd4bf', pale: '#e2f5f3', white: '#ffffff', ink: '#071f1e' }

/** The prism, drawn on a 512 grid around (256,256). `s` scales the mark about the centre. */
function mark(s = 1) {
  const R = 170
  const dx = R * Math.cos(Math.PI / 6) // 147.2
  const cx = 256
  const cy = 256
  const top = [cx, cy - R]
  const ur = [cx + dx, cy - R / 2]
  const lr = [cx + dx, cy + R / 2]
  const bot = [cx, cy + R]
  const ll = [cx - dx, cy + R / 2]
  const ul = [cx - dx, cy - R / 2]
  const c = [cx, cy]
  const p = (pts) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  // Pocket: half-size rhombus in the middle of the top face, floor sunk by d.
  const fc = [cx, cy - R / 2]
  const h = 0.5
  const pt = [fc[0], fc[1] - (R / 2) * h]
  const pr = [fc[0] + dx * h, fc[1]]
  const pb = [fc[0], fc[1] + (R / 2) * h]
  const pl = [fc[0] - dx * h, fc[1]]
  const d = 26
  const dn = ([x, y]) => [x, y + d]
  return `<g transform="translate(256 256) scale(${s}) translate(-256 -256)">
    <polygon points="${p([top, ur, c, ul])}" fill="${C.white}"/>
    <polygon points="${p([ul, c, bot, ll])}" fill="${C.pale}"/>
    <polygon points="${p([c, ur, lr, bot])}" fill="${C.mint}"/>
    <clipPath id="pocket"><polygon points="${p([pt, pr, pb, pl])}"/></clipPath>
    <g clip-path="url(#pocket)">
      <polygon points="${p([pl, pt, dn(pt), dn(pl)])}" fill="#0e8780"/>
      <polygon points="${p([pt, pr, dn(pr), dn(pt)])}" fill="#0a625d"/>
      <polygon points="${p([dn(pt), dn(pr), dn(pb), dn(pl)])}" fill="${C.deeper}"/>
    </g>
  </g>`
}

/** An icon: `rx` rounds the background (0 = full bleed, for stores and the OS mask), `s` scales the mark. */
function icon({ rx = 0, s = 1 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <rect width="512" height="512" rx="${rx}" fill="${C.deep}"/>
  ${mark(s)}
</svg>
`
}

const masterSvg = icon({ rx: 112 })
writeFileSync(join(pub, 'icon.svg'), masterSvg)
// The old favicon.svg stays as the same mark, so existing links keep working.
writeFileSync(join(pub, 'favicon.svg'), icon({ rx: 112, s: 1.08 }))

const fontB64 = (w) => readFileSync(join(root, 'node_modules/@fontsource/inter/files', `inter-latin-${w}-normal.woff2`)).toString('base64')

function socialCard() {
  const markSvg = icon({ rx: 112 }).replace('<svg ', '<svg width="120" height="120" ')
  const bigMark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="420" height="420" fill="none">${mark(1)}</svg>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Inter;font-weight:400;src:url(data:font/woff2;base64,${fontB64(400)}) format('woff2')}
@font-face{font-family:Inter;font-weight:600;src:url(data:font/woff2;base64,${fontB64(600)}) format('woff2')}
@font-face{font-family:Inter;font-weight:700;src:url(data:font/woff2;base64,${fontB64(700)}) format('woff2')}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;background:${C.deep};font-family:Inter,sans-serif;color:${C.white};position:relative;overflow:hidden}
.glow{position:absolute;right:-120px;top:-60px;width:700px;height:700px;border-radius:50%;background:${C.deeper}}
.big{position:absolute;right:70px;top:105px}
.col{position:absolute;left:72px;top:64px;width:640px}
.brand{display:flex;align-items:center;gap:20px}
.brand span{font-size:60px;font-weight:700;letter-spacing:-0.02em}
h1{margin-top:40px;font-size:60px;line-height:1.1;font-weight:700;letter-spacing:-0.025em}
h1 em{font-style:normal;color:${C.pale}}
p{margin-top:32px;font-size:28px;line-height:1.4;font-weight:400;color:${C.pale}}
.chips{margin-top:32px;display:flex;gap:14px}
.chips b{font-size:24px;font-weight:600;background:${C.pale};color:${C.deeper};padding:8px 20px;border-radius:999px}
</style></head><body>
<div class="glow"></div><div class="big">${bigMark}</div>
<div class="col">
  <div class="brand">${markSvg}<span>3DParter</span></div>
  <h1>Parametric 3D CAD for makers. <em>Free to start, free to export.</em></h1>
  <p>Runs in your browser. No account, no install.</p>
  <div class="chips"><b>STL</b><b>3MF</b><b>STEP</b></div>
</div>
</body></html>`
}

const browser = await chromium.launch()
async function shot(html, width, height, out, { transparent = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  const buf = await page.screenshot({ type: 'png', omitBackground: transparent })
  await page.close()
  writeFileSync(out, buf)
  console.log('wrote', out.replace(root, '.'), `${width}x${height}`)
}
function svgPage(svg, size) {
  return `<!doctype html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `)}</body>`
}

// Rounded, transparent corners for browser tabs and "any"-purpose icons; full bleed + opaque where the OS or store masks it.
await shot(svgPage(icon({ rx: 112, s: 1.2 }), 16), 16, 16, join(pub, 'favicon-16.png'), { transparent: true })
await shot(svgPage(icon({ rx: 112, s: 1.15 }), 32), 32, 32, join(pub, 'favicon-32.png'), { transparent: true })
await shot(svgPage(icon({ s: 1 }), 180), 180, 180, join(pub, 'apple-touch-icon.png'))
await shot(svgPage(icon({ rx: 112 }), 192), 192, 192, join(pub, 'icon-192.png'), { transparent: true })
await shot(svgPage(icon({ rx: 112 }), 512), 512, 512, join(pub, 'icon-512.png'), { transparent: true })
await shot(svgPage(icon({ s: 0.9 }), 512), 512, 512, join(pub, 'maskable-512.png'))
await shot(svgPage(icon({ s: 1 }), 1024), 1024, 1024, join(launchAssets, 'app-icon-1024.png'))
await shot(socialCard(), 1200, 630, join(pub, 'social-card.png'))
await browser.close()
