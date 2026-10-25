/** WebRTC never negotiates under test; the constructors exist so a module that
 *  builds a peer connection in an effect does not explode on import. */
export class MediaStream {
  getTracks(): readonly never[] {
    return []
  }
  getVideoTracks(): readonly never[] {
    return []
  }
  getAudioTracks(): readonly never[] {
    return []
  }
}
export class RTCPeerConnection {
  close(): void {}
  addTransceiver(): void {}
  createOffer(): Promise<{ sdp: string; type: string }> {
    return Promise.resolve({ sdp: '', type: 'offer' })
  }
  setLocalDescription(): Promise<void> {
    return Promise.resolve()
  }
  setRemoteDescription(): Promise<void> {
    return Promise.resolve()
  }
  addIceCandidate(): Promise<void> {
    return Promise.resolve()
  }
}
export class RTCSessionDescription {
  constructor(readonly init: { sdp?: string; type?: string }) {}
}
export class RTCIceCandidate {
  constructor(readonly init: Record<string, unknown>) {}
}
export type MediaStreamTrack = { readonly kind: string; enabled: boolean }
export const mediaDevices = {
  getUserMedia: (): Promise<MediaStream> => Promise.resolve(new MediaStream()),
  enumerateDevices: (): Promise<readonly never[]> => Promise.resolve([]),
}
export const registerGlobals = (): void => undefined
export const RTCView = (): null => null
