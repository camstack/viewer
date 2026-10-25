import type { NativeEmbedMode } from './use-native-embed-source.js'

export function useNativeEmbedSource(
  _serverUrl: string | null,
  _mode: NativeEmbedMode,
): {
  readonly source: null
  readonly readAccessUri: null
  readonly reportLoadFailure: () => void
  readonly reportEmbedAlive: () => void
} {
  return {
    source: null,
    readAccessUri: null,
    reportLoadFailure: () => undefined,
    reportEmbedAlive: () => undefined,
  }
}
