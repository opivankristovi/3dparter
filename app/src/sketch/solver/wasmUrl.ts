// The only file that touches Vite's `?url` import, so node (vitest) never has to resolve it.
import wasmUrl from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url'

export default wasmUrl
