import pkg from '../../package.json'

/** App version shown in error reports. */
export const APP_VERSION: string = pkg.version

/** GitHub issues URL (https://github.com/<owner>/<repo>/issues), or null when not set up. */
export function getSupportUrl(): string | null {
  const raw = (import.meta.env.VITE_SUPPORT_URL as string | undefined)?.trim()
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}
