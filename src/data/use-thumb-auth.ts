/**
 * useThumbAuth — where a track thumbnail is fetched from, and with what
 * credential: the hub's address and the Bearer token to send, or `null` when
 * the surface is authenticated another way.
 *
 * A thumbnail is a plain GET and needs nothing from the socket, so the hub
 * address falls back to the saved server when the system is momentarily gone
 * (see `use-snapshot`). The bearer rule is the snapshot one
 * (`shouldAttachSnapshotBearer`): the token is attached whenever one is held,
 * including on a web page on its OWN hub's origin — a token-signed-in viewer
 * has no session cookie, so a bare `<img>` there is a 401.
 */
import { Platform } from 'react-native'
import { useServer } from '../app/ServerProvider.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { shouldAttachSnapshotBearer } from './snapshot-image-auth.js'

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
    })
      ? token
      : null
  return { serverUrl, bearer }
}
