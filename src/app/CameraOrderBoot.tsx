/**
 * Starts the camera-arrangement disk read as soon as the saved session is
 * known, before the server-scope bind. Renders nothing.
 */
import { useServer } from './ServerProvider.js'
import { ensureCameraOrderBoot } from '../data/camera-order-boot.js'

export function CameraOrderBoot(): null {
  const { server } = useServer()
  const serverId = server?.id ?? null
  if (serverId !== null) ensureCameraOrderBoot(serverId)
  return null
}
