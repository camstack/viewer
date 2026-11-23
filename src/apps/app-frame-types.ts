/** Props of {@link AppFrame}, shared by its native and web implementations. */
export interface AppFrameProps {
  /** The page to load. */
  readonly uri: string
  /** Script run before the page's own (native only; a web iframe cannot be injected into). */
  readonly injectedBefore?: string
  /** Changing it reloads the frame from scratch. */
  readonly reloadKey: number
  readonly testID?: string
  /** The page asked for something a frame cannot do (a download, an upload): the caller says so. */
  readonly onUnhandled?: (what: 'download' | 'external') => void
}

/** Where the frame sends a link it must not load itself: http(s) only stays inside. */
export function staysInFrame(url: string): boolean {
  return /^https?:\/\//i.test(url) || url === 'about:blank'
}
