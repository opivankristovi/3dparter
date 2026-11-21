// Main-thread side: one kernel worker for the whole app.
import * as Comlink from 'comlink'
import { recordError } from '../support/errorLog'
import type { KernelApi } from './api'

let worker: Worker | null = null
let remote: Comlink.Remote<KernelApi> | null = null

function create(): Comlink.Remote<KernelApi> {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  // Uncaught errors inside the worker never reach window.onerror; log them locally.
  worker.addEventListener('error', (e) => recordError('kernel', e.error ?? e.message))
  worker.addEventListener('messageerror', () => recordError('kernel', 'Kernel message could not be read'))
  remote = Comlink.wrap<KernelApi>(worker)
  return remote
}

export function getKernel(): Comlink.Remote<KernelApi> {
  return remote ?? create()
}

/** Kills a stuck worker (and its WebAssembly memory) and starts a fresh one. Callers must init() again. */
export function restartKernel(): Comlink.Remote<KernelApi> {
  if (remote) remote[Comlink.releaseProxy]()
  worker?.terminate()
  worker = null
  remote = null
  return create()
}
