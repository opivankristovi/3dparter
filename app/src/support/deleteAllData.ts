import { db } from '../data/db'

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
    setTimeout(resolve, 3000)
  })
}

/**
 * Removes everything 3DParter keeps on this device: the project database (and any other database of this origin),
 * localStorage and sessionStorage, the offline caches and the service worker. The caller reloads afterwards.
 */
export async function deleteAllLocalData(): Promise<void> {
  try {
    await db.delete()
  } catch {
    // fall through to the sweep below
  }
  try {
    const dbs = (await indexedDB.databases?.()) ?? []
    await Promise.all(dbs.map((d) => (d.name ? deleteDatabase(d.name) : Promise.resolve())))
  } catch {
    // indexedDB.databases() is not available everywhere
  }
  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    // storage blocked
  }
  try {
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
  } catch {
    // no Cache API
  }
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? []
    await Promise.all(regs.map((r) => r.unregister()))
  } catch {
    // no service worker
  }
}
