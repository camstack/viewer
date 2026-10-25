/**
 * useThumbAuth — where a track thumbnail is fetched from, and with what
 * credential: the hub's address and the Bearer token to send, or `null` when
 * the surface is authenticated another way.
 *
 * A thumbnail is a plain GET and needs nothing from the socket, so the hub
 * address falls back to the saved server when the system is momentarily gone
 * (see `use-snapshot`). The bearer rule is the snapshot one
 * (`shouldAttachSnapshotBearer`): a web page on its OWN hub's origin is
 * authenticated by the session cookie and the header would only push
 * `expo-image` onto its slow blob path.
 */
import { Platform } from 'react-native'
import { useServer } from '../app/ServerProvider.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { shouldAttachSnapshotBearer, snapshotPageOrigin } from './snapshot-image-auth.js'

export interface ThumbAuth {
  readonly serverUrl: string | null
  readonly bearer: string | null
}

export function useThumbAuth(): ThumbAuth {
  const { server, token } = useServer()
  const { controller } = useConnection()
  const serverUrl = controller.getSystem()?.serverUrl ?? server?.serverUrl ?? null
  const bearer =
    serverUrl !== null &&
    shouldAttachSnapshotBearer({
      platform: Platform.OS,
      uri: serverUrl,
      token,
      pageOrigin: snapshotPageOrigin(),
    })
      ? token
      : null
  return { serverUrl, bearer }
}
