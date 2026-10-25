import { useConnection } from './ConnectionProvider.js'
import { useServer } from '../app/ServerProvider.js'
import { pickLiveHubUrl } from './live-hub-url.js'

/** Raced hub origin for native embeds. Re-renders when the connection state
 *  moves so a LAN switch is visible to the WebView injection. */
export function useLiveHubUrl(): string | null {
  const { controller, state } = useConnection()
  const { server } = useServer()
  const live = state === 'connecting' && controller.getSystem() === null
    ? null
    : controller.getSystem()?.serverUrl
  return pickLiveHubUrl(live, server?.serverUrl ?? null)
}
