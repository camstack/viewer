/**
 * Native twin of `use-screen-wake-lock.web.ts`: a no-op. On iOS and Android
 * the video/audio session keeps the screen on while a picture plays
 * (`UIBackgroundModes: ['audio']`); only the web build needs to ask for it.
 */
export function useScreenWakeLock(): void {}
