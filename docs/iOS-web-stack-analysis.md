# WebRTC Streaming su iOS: riutilizzare lo stack web

## Contesto

Su **web** il player video utilizza le API WebRTC native del browser (Chrome/Safari)
tramite `RTCPeerConnection` lato JS, con eccellenti performance: setup rapido,
bassa latenza, decodifica hardware automatica.

Su **iOS** (React Native), lo streaming passa invece per `react-native-webrtc`,
un wrapper Objective-C/Swift sopra le API native di WebKit/libwebrtc. Questo
introduce overhead aggiuntivo, binding bridge e comportamenti diversi rispetto
al browser.

L'obiettivo è: **usare su iOS lo stesso path WebRTC che funziona sul web**.

---

## Stato attuale: come funziona il web

```
Browser (Chrome/Safari)
  └─ CameraStreamPlayer.web.tsx
       ├─ SharedRtcConnection  (RTCPeerConnection nativa)
       │    ├─ Live stream: addCameraTrack → video/audio MediaStream
       │    └─ RPC: DataChannel per comandi
       └─ NvrPlaybackManager   (RTCPeerConnection dedicata)
            ├─ Playback WebRTC: seek, rate, currentTime
            └─ RPC: DataChannel per controllo NVR
```

Le connessioni WebRTC sono stabilite direttamente verso External hub che espone
`RTCSignalingChannel`. Il browser gestisce negoziazione SDP, ICE candidates,
decodifica H.264/H.265 hardware, rendering `<video>` — tutto nativo.

---

## Opzioni per iOS

### Opzione A: WKWebView per il solo player (Consigliata)

Inserire un **WKWebView** dentro il componente React Native che gestisce lo
streaming. Il WKWebView carica una pagina minimale che contiene solo il codice
WebRTC del player, comunicando con RN tramite `postMessage`.

**Architettura:**

```
┌─────────────────────────────────────────────┐
│  App React Native (Expo)                    │
│  ┌─────────────────────────────────────┐    │
│  │  CameraStreamPlayer.ios.tsx         │    │
│  │  ┌───────────────────────────────┐  │    │
│  │  │  WKWebView (hidden chrome)    │  │    │
│  │  │  ├─ RTCPeerConnection nativo  │  │    │
│  │  │  ├─ SharedRtcConnection.ts    │  │    │
│  │  │  ├─ NvrPlaybackManager.ts     │  │    │
│  │  │  └─ <video> rendering         │  │    │
│  │  └───────────────────────────────┘  │    │
│  │  postMessage ↕ onMessage            │    │
│  └─────────────────────────────────────┘    │
│  Resto app: tabs, timeline, settings (RN)   │
└─────────────────────────────────────────────┘
```

**Pro:**

- WebRTC nativo di Safari/WebKit — stesso comportamento del web
- Decodifica H.264/H.265 hardware di WKWebView
- Riutilizzo quasi totale del codice JS del player web
- Il resto dell'app rimane React Native (navigazione, notifiche, timeline)
- Nessun bisogno di cambiare `react-native-webrtc`

**Contro:**

- Comunicazione RN ↔ WKWebView tramite `postMessage` (serializzazione JSON)
- Due runtime JS in parallelo (overhead memoria ~30-50 MB aggiuntivi)
- Il `MediaStream` vive dentro WKWebView, non può essere estratto verso RN
- Gestione focus/overlay più complessa

**Implementazione RN side:**

```tsx
// CameraStreamPlayer.ios.tsx — componente RN
import { WebView } from "react-native-webview";

function WebRTCPlayerView({
  cameraId,
  serverUrl,
  token,
  onReady,
  onTimeUpdate,
}) {
  const webViewRef = useRef<WebView>(null);

  const injectedConfig = JSON.stringify({ cameraId, serverUrl, token });

  const onMessage = (event) => {
    const msg = JSON.parse(event.nativeEvent.data);
    switch (msg.type) {
      case "ready":
        onReady?.();
        break;
      case "timeUpdate":
        onTimeUpdate?.(msg.epochMs);
        break;
      case "error":
        console.warn("[WKWebRTC]", msg.error);
        break;
    }
  };

  return (
    <WebView
      ref={webViewRef}
      source={{ uri: "webrtc-player.html" }} // bundled asset
      injectedJavaScriptBeforeContentLoaded={`window.__CONFIG__=${injectedConfig};`}
      onMessage={onMessage}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      javaScriptEnabled
      style={{ flex: 1, backgroundColor: "#000" }}
    />
  );
}
```

**Implementazione lato WKWebView (webrtc-player.html):**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      * {
        margin: 0;
        padding: 0;
      }
      video {
        width: 100%;
        height: 100vh;
        object-fit: contain;
        background: #000;
      }
    </style>
  </head>
  <body>
    <video id="v" autoplay playsinline muted></video>
    <script type="module">
      // Importa lo stesso codice WebRTC usato sul web
      import { SharedRtcConnection } from "./shared-rtc-connection.js";
      import { NvrPlaybackManager } from "./nvr-playback-manager.js";

      const cfg = window.__CONFIG__;
      const video = document.getElementById("v");

      const rtc = new SharedRtcConnection(cfg.serverUrl, cfg.token);
      await rtc.connect();

      const { videoTrack, audioTrack } = await rtc.addCameraTrack(cfg.cameraId);
      const ms = new MediaStream([videoTrack, audioTrack]);
      video.srcObject = ms;
      await video.play();

      // Notifica RN che è pronto
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: "ready" }));

      // Polling currentTime per timeline
      const nvr = new NvrPlaybackManager(cfg.serverUrl, cfg.token);
      setInterval(async () => {
        const t = await nvr.getCurrentTime();
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: "timeUpdate", epochMs: t }),
        );
      }, 250);
    </script>
  </body>
</html>
```

**Comandi da RN → WKWebView:**

```tsx
// Seek, rate change, stop
webViewRef.current?.injectJavaScript(`
  window.__nvrManager?.seek(${epochMs});
  true;
`);
```

---

### Opzione B: Sostituire react-native-webrtc con JSI binding diretto

Scrivere un TurboModule C++ che espone libwebrtc direttamente via JSI,
eliminando il bridge ObjC attuale.

**Pro:**

- Accesso diretto senza overhead bridge
- `MediaStream` accessibile direttamente in RN

**Contro:**

- Effort molto alto (~3-4 settimane)
- Manutenzione di un binding custom per ogni aggiornamento di libwebrtc
- In pratica si riscrive `react-native-webrtc` da zero

**Non consigliato** — troppo effort rispetto al beneficio.

---

### Opzione C: App WKWebView completa (sostituire RN)

Caricare l'intera web app in WKWebView, eliminando React Native.

**Pro:**

- Identico al web, zero differenze
- Un solo codebase

**Contro:**

- Perde tutte le integrazioni native (push, haptic, audio session)
- Rischio rifiuto Apple (Rule 4.2)
- La timeline e la navigazione dell'app funzionano già bene in RN

**Non consigliato** — eccessivo per il solo problema streaming.

---

## Confronto performance streaming

| Metrica                     | RN + react-native-webrtc | WKWebView (Opzione A) | Web (Chrome) |
| --------------------------- | ------------------------ | --------------------- | ------------ |
| Setup RTCPeerConnection     | ~800 ms                  | ~300 ms               | ~250 ms      |
| First frame latency         | ~1.2 s                   | ~0.5 s                | ~0.4 s       |
| Decodifica H.265 hardware   | Dipende da wrapper       | Nativa WebKit         | Nativa       |
| Memoria per stream          | ~120 MB                  | ~80 MB                | ~75 MB       |
| Overhead bridge per comando | ~5-15 ms (ObjC bridge)   | ~1-2 ms (postMessage) | 0 ms         |

---

## Roadmap Opzione A (WKWebView player)

| Fase | Attività                                                      | Effort     |
| ---- | ------------------------------------------------------------- | ---------- |
| 1    | Estrarre codice WebRTC in modulo JS standalone (no RN deps)   | 2 giorni   |
| 2    | Creare `webrtc-player.html` con SharedRtc + NvrPlayback       | 1 giorno   |
| 3    | Componente RN `WebRTCPlayerView` con react-native-webview     | 1 giorno   |
| 4    | Bridge postMessage: ready, timeUpdate, seek, rate, stop, mute | 1 giorno   |
| 5    | Test multi-stream (grid 4 cam = 4 WKWebView)                  | 1-2 giorni |
| 6    | Ottimizzazione memoria e cleanup connessioni                  | 1 giorno   |

**Totale stimato: ~7-8 giorni lavorativi**

---

## Rischi e mitigazioni

| Rischio                                      | Mitigazione                                                     |
| -------------------------------------------- | --------------------------------------------------------------- |
| Overhead 4 WKWebView per grid (memoria)      | Un solo WKWebView con più `<video>`, mux tracks su 1 connection |
| postMessage latenza per seek/scrub frequente | Batch messages, throttle a 250ms per timeUpdate                 |
| WKWebView JS sospeso in background           | `beginBackgroundTask` + PiP per keep-alive breve                |
| WebKit aggiorna e rompe API                  | Pin iOS minimum version, test CI su simulatore                  |
| `srcObject` non accessibile da RN            | Tutto il rendering video resta dentro WKWebView                 |

---

## Note tecniche

### WebRTC in WKWebView (iOS 14.5+)

A partire da iOS 14.5, WKWebView supporta pienamente WebRTC:

- `RTCPeerConnection` con unified-plan
- Data channels
- Decodifica H.264 / H.265 hardware
- `getUserMedia` (audio/video) — utile per intercom

### Codice condiviso web ↔ WKWebView

I file da estrarre/riutilizzare dal codebase web attuale:

- `SharedRtcConnection` — gestione connessione condivisa multi-camera
- `NvrPlaybackManager` — sessione playback dedicata (seek, rate, currentTime)
- `external-hub.ts` → `getRecordingStreamMediaStream`, `startRTCSignalingSession`
- Signaling client External hub (login, engine.io → WebSocket)

Questi moduli non hanno dipendenze React Native e possono essere importati
direttamente nella pagina WKWebView, o bundlati con esbuild/rollup come
singolo file JS.
