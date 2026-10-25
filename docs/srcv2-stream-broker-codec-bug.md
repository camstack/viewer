# Backend note — stream broker doesn't honor the negotiated codec (H265 source + H264-only client → black / no answer)

**From:** camstack-viewer (srcV2 iOS app) · **To:** camstack-server backend agent
**Severity:** high — every H265 camera is unviewable on the native mobile client.

## TL;DR
The mobile WebRTC client can **only** decode H264 (its WebRTC stack has no HEVC — see proof below), so it offers `codecs=[H264]`. For an **H265 source camera** the broker must transcode H265→H264 and answer in H264. Instead, the session produces **no answer** and the client goes black. The broker is not delivering the codec the client negotiated.

## Client constraint (not fixable client-side)
react-native-webrtc 124.0.7 wraps Google libwebrtc, which omits HEVC. Proven on-device:
- `RTCRtpReceiver.getCapabilities('video')` → `H264, rtx, VP8, VP9, AV1, red, ulpfec, flexfec-03` — **no `video/H265`**.
- Every offer the client sends is `codecs=[H264] h264-profiles=[640c29 (High), 42e029 (Constrained Baseline)]`.

So the client will **never** advertise H265. WebRTC clients without HEVC (this app; also Chrome) can only be served H265 cameras via **server-side transcode to H264**. That's exactly what the broker's negotiation already intends to do.

## Observed behavior (on-device `[live]` logs)
**Working — H264 source camera:**
```
OFFER  codecs=[H264] h264-profiles=[640c29,42e029]
ANSWER codecs=[H264] h264-profiles=[640c29,42e029]
ontrack received → ICE connected → completed   ✅ plays
```
**Broken — H265 source camera ("Studio"):**
```
OFFER  codecs=[H264] h264-profiles=[640c29,42e029]
(no ANSWER line — handleOffer never returns a usable answer)
PeerConnection close ~16s later, ICE never connects   ❌ black
```

## Expected behavior
Per the broker's own logic in `packages/addon-pipeline/src/stream-broker/webrtc/session.ts`:
- `detectNegotiatedVideoCodec(answerSdp, preferred=this.sourceCodec)` — with an H264-only client SDP and `sourceCodec=H265`, H265 is absent from the SDP, so it correctly falls back to first-match → **negotiatedCodec = H264**.
- `needsTranscode` (~L175-177): `sourceCodec==='H265' && negotiatedCodec==='H264'` → **true**.

So the broker SHOULD spin up the H265→H264 transcode and return an H264 answer. It must **honor the negotiated codec**: send H264 RTP, never H265, to a client that negotiated H264.

## What to investigate (needs server-side broker logs for the Studio device's session)
Likely one of:
1. **handleOffer hangs/throws** for an H265 source + H264-only offer — the H265→H264 transcode (ffmpeg spawn / decoder setup) fails or blocks answer generation, so no answer is ever returned. (Matches "no ANSWER, close +16s" on the client.)
2. The broker **answers but forwards H265 RTP** on the H264-negotiated session, so the H264-only decoder gets undecodable bytes → black. (Less likely given no ANSWER was logged, but confirm.)

Please pull the broker session logs for the Studio device when the iOS client connects and confirm which, then fix so an H264-negotiated session against an H265 source transcodes and returns a prompt, valid H264 answer.

## Code references
- `packages/addon-pipeline/src/stream-broker/webrtc/session.ts`
  - `detectNegotiatedVideoCodec` (~L189), `needsTranscode` (~L175-177), `transcodeInputFormat` (~L270), `this.sourceCodec`
  - answer path: `const answerVideoCodec = detectNegotiatedVideoCodec(resolvedSdp, this.sourceCodec)` (~L1367) and the transcode/feed-loop that should follow when `needsTranscode`.

## Repro
1. Run camstack hub with at least one **H265** camera (the "Studio" cam) and one H264 camera.
2. From the srcV2 iOS viewer (native react-native-webrtc), open each camera.
3. H264 → plays; H265 → black, client log shows `OFFER codecs=[H264]`, no `ANSWER`, PC close ~16s.

## Note on profiles (secondary)
The client offers H264 **High** (`640c29`) AND Constrained Baseline (`42e029`), so when transcoding to H264 either profile is acceptable; no need to force Baseline for this client (it decodes High). Just ensure the transcoded H264 matches the answered profile.
