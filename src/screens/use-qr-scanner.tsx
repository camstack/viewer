/**
 * The QR scanner, loaded only if this app build has the camera module.
 *
 * `expo-camera` is native: a binary built before it was added would throw at
 * import and take the app down at launch. It is therefore required lazily and
 * the scan entry simply reports `available: false` when it is not there.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { optionalModule } from '../device-cert/optional-module.js'

type CameraModule = typeof import('expo-camera')

export interface QrScanner {
  readonly available: boolean
  readonly granted: boolean
  readonly request: () => void
  readonly render: (onScanned: (data: string) => void) => React.ReactNode
}

export function useQrScanner(): QrScanner {
  // Native-backed and possibly absent from the installed binary: loaded on demand (see optional-module.ts).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const camera = useMemo(() => optionalModule<CameraModule>(() => require('expo-camera')), [])
  const [granted, setGranted] = useState(false)

  useEffect(() => {
    if (camera === null) return undefined
    let cancelled = false
    void camera.Camera.getCameraPermissionsAsync().then((p) => {
      if (!cancelled) setGranted(p.granted)
    })
    return () => {
      cancelled = true
    }
  }, [camera])

  return {
    available: camera !== null,
    granted,
    request: () => {
      if (camera === null) return
      void camera.Camera.requestCameraPermissionsAsync().then((p) => setGranted(p.granted))
    },
    render: (onScanned) =>
      camera === null ? null : (
        <camera.CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(result) => onScanned(result.data)}
        />
      ),
  }
}
