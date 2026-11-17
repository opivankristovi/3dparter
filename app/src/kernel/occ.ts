// Initialises OpenCascade exactly once and hands it to replicad.
// Environment-neutral: the browser worker passes the bundled wasm URL (see occ.browser.ts),
// Node tests pass a file path (see nodeWasmPath in test helpers).
import opencascade from 'replicad-opencascadejs'
import { setOC } from 'replicad'

export type OpenCascade = Awaited<ReturnType<typeof opencascade>>

export interface LoadOCOptions {
  /** URL (browser) or absolute file path (Node) of replicad_single.wasm. */
  wasmPath?: string
}

let loading: Promise<OpenCascade> | null = null

export const KERNEL_VERSION = 'replicad 1.2.1 / OpenCascade (single-threaded wasm)'

/** Safe to call repeatedly: the wasm is instantiated once per realm. */
export function loadOC(opts: LoadOCOptions = {}): Promise<OpenCascade> {
  if (!loading) {
    const { wasmPath } = opts
    loading = opencascade(wasmPath ? { locateFile: (p: string) => (p.endsWith('.wasm') ? wasmPath : p) } : undefined)
      .then((oc) => {
        setOC(oc)
        return oc
      })
      .catch((err) => {
        loading = null // allow a retry after a failed load
        throw err
      })
  }
  return loading
}
