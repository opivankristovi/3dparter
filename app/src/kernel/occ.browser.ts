// Browser-only entry: Vite turns the `?url` import into an emitted asset URL for the wasm.
// Only worker.ts imports this file, so Node (tests) never sees the `?url` import.
import wasmUrl from 'replicad-opencascadejs/wasm?url'
import { loadOC } from './occ'

export const loadOCBrowser = () => loadOC({ wasmPath: wasmUrl })
