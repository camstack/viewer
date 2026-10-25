/**
 * Stub for react-native-webrtc when bundling for web (embed player).
 * Uses browser's native WebRTC APIs. Values resolved at runtime in browser.
 */
module.exports = {
  get RTCPeerConnection() {
    return typeof globalThis !== "undefined" ? globalThis.RTCPeerConnection : undefined;
  },
  get MediaStream() {
    return typeof globalThis !== "undefined" ? globalThis.MediaStream : undefined;
  },
  get MediaStreamTrack() {
    return typeof globalThis !== "undefined" ? globalThis.MediaStreamTrack : undefined;
  },
  get RTCSessionDescription() {
    return typeof globalThis !== "undefined" ? globalThis.RTCSessionDescription : undefined;
  },
  get RTCIceCandidate() {
    return typeof globalThis !== "undefined" ? globalThis.RTCIceCandidate : undefined;
  },
  get mediaDevices() {
    return typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  },
};
