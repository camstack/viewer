# NVR timeline sync – analysis and design

## 1. Flusso attuale

### 1.1 Seek continui (scrub sulla timeline)

- **Fonte**: scroll verticale sulla `DetectionTimeline` → `processScroll` → `onScrubTimeChangeRef.current(epochMs)` (solo se `scrubEnabled`, non programmatic scroll, ecc.).
- **Hook**: `useNvrScrubController.onScrubTimeChange(epochMs)`:
  - Aggiorna `lastUserScrubAtRef.current = Date.now()`.
  - Throttle UI: `setPlaybackPositionEpochMs(epochMs)` solo se sono passati ≥100ms dall’ultimo update (per non bloccare lo scroll).
  - **Backend seek**:
    - Se c’è già stream NVR: `pendingBackendSeekEpochRef.current = epochMs`; se sono passati ≥100ms dall’ultimo seek → `seekRecordingStream(stream, epochMs)` subito e `lastBackendSeekAtRef = now`; altrimenti schedula `doBackendSeek` con delay `100 - elapsed` (un solo timer).
    - Se non c’è stream e sei “nel passato” (>5s da now): dopo 300ms di debounce parte `onStartNvrPlayback(epochMs)`.
- **Problemi**:
  - Non c’è **serializzazione**: `seekRecordingStream` è async e non si aspetta il termine prima di lanciare il prossimo; ogni 100ms può partire un nuovo seek mentre il precedente è ancora in corso → backend bombardato, rischio snapshot bloccato.
  - Un solo timer “pending”: quando scatta, esegue un seek con l’ultimo `pendingBackendSeekEpochRef`; i valori intermedi sono persi (accettabile), ma più seek possono sovrapporsi.

### 1.2 Scrub end

- **Fonte**: `handleScrollEnd` (timer 250ms dopo ultimo scroll o evento nativo) → `onScrubEndRef.current(clamped)` solo se `wasUserScroll` e `scrubEnabled` e non in debounce.
- **Hook**: `useNvrScrubController.onScrubEnd(epochMs)`:
  - Cancella debounce e timer di seek pending.
  - Se c’è stream: `seekRecordingStream(stream, epochMs)`, aggiorna clip startTime, dopo 150ms chiama `getCurrentTime()` e applica il risultato a `setPlaybackPositionEpochMs`.
  - Se non c’è stream: avvia NVR a `startEpoch` (usando `lastScrubEpochWhenNoStreamRef` se in live zone).

### 1.3 Go to live

- **Utente**: click “Jump to now” → `handleJumpToNow` (in `[id].tsx`).
- **Azioni**:
  1. `isScrollingToLiveRef.current = true` (blocca seek/scrub nel controller).
  2. `setJumpToLiveTick(t => t + 1)` (cancella timer pending nello scrub controller).
  3. `timelineHandlers.onJumpToNow()` → `setRequestScrollToEndMs(Date.now())` (timeline fa scroll programmatico a “now”).
  4. Clear thumbnail, `lastUserScrubAtRef` e `lastJumpToLiveAtRef` = now.
  5. `setNvrPlaybackCurrentTimeMs(now)`.
  6. `pauseNvrPlayback()`, clear delle mappe (playingVideoclip*, quindi si torna al live stream).
- **Sync completato**: quando la timeline esegue lo scroll-to-end, chiama `onSyncComplete` → in `[id].tsx` `handleSyncComplete` → `onSyncComplete()` (timeline state) + **`isScrollingToLiveRef.current = false`**.
- **Problema**: c’è un altro posto che imposta `isScrollingToLiveRef.current = true`: l’effect che reagisce a `nowIsVisible`. Quando l’utente scrolla a “now” e `nowIsVisible` diventa true, si fa clear NVR e si setta `isScrollingToLiveRef = true`, ma in quel percorso **non** si fa scroll programmatico quindi **onSyncComplete non viene mai chiamato** → `isScrollingToLiveRef` resta true e tutti i seek successivi restano bloccati.

### 1.4 Sincronizzazione timeline ↔ backend

- **Poll backend**: in `NvrOverlay` (CameraStreamPlayer.web), effect con loop che ogni 1000ms chiama `getCurrentTime()` (o adapter) e poi `onCurrentTimeChange(epoch)` → `handleNvrPlaybackCurrentTime` → `onNvrPollTime(epoch)`.
- **onNvrPollTime** (useNvrScrubController): come NVR — applica ogni poll, nessun filtro. `setPlaybackPositionEpochMs(epoch)`.
- **Timeline**: `playbackPositionEpochMs` è la posizione del cursore di playback. C’è un **auto-follow** (effect in DetectionTimeline): ogni 200ms, se c’è playback position e non è open il detail, si fa scroll programmatico per tenere il cursore in vista (`scrollTo`, `onVisibleRangeChange`). Durante questo scroll, `programmaticScrollRef` e `lastProgrammaticScrollAtRef` sono settati così che `processScroll` (onScroll) non emetta scrub.
- Comportamento allineato a NVR: nessun ignore/tolleranza sul poll (NVR doc non ne descrive).

## 2. Modifiche proposte

### 2.1 Seek continui: coda serializzata

- **Obiettivo**: al più un seek in volo verso il backend; i seek successivi si accodano (solo l’ultimo valore) e partono quando il seek precedente è finito.
- **Implementazione** (in `useNvrScrubController`):
  - Aggiungere ref `seekInFlightRef = false` e `pendingSeekEpochRef = null`.
  - In `doBackendSeek` / ramo “stream presente” di `onScrubTimeChange`: prima di chiamare `seekRecordingStream`, settare `seekInFlightRef = true`; alla fine (then/finally) settare `seekInFlightRef = false` e, se `pendingSeekEpochRef != null`, rieseguire un seek con quel valore (e azzerare pending).
  - Quando arriva un nuovo epoch durante seek in volo: non lanciare un altro seek, ma aggiornare `pendingBackendSeekEpochRef` (già fatto) e assicurarsi che il “drain” alla fine del seek in volo usi l’ultimo pending.

### 2.2 Go to live: non bloccare con isScrollingToLiveRef nel path “nowIsVisible”

- **Problema**: in `[id].tsx`, l’effect che reagisce a `nowIsVisible` (user ha scrollato a “now”) setta `isScrollingToLiveRef.current = true` ma non c’è scroll programmatico → onSyncComplete non viene chiamato → isScrollingToLiveRef resta true.
- **Fix**: in quell’effect **non** impostare `isScrollingToLiveRef.current = true`. Impostare solo `lastJumpToLiveAtRef.current = Date.now()` così il poll continua a scartare posizioni “troppo indietro” per LIVE_SETTLE_MS. Lasciare `isScrollingToLiveRef` solo per il path del pulsante “Jump to now” (scroll programmatico).

Implementando le aree 2.1 e 2.2 si ottiene:
- Seek continui che non si sovrappongono e non bloccano il backend.
- Go-to-live che non lascia mai `isScrollingToLiveRef` bloccato a true.

---

## 3. Gestione sessione (shared RTC)

### 3.1 È sempre la stessa shared?

**Sì.** C'è una sola sessione RTC condivisa: `sharedRtcConnection.ts` mantiene una variabile globale `shared` (una `BrowserSignalingSession` → un solo `RTCPeerConnection` + `connectionManagement`). `getOrCreateSharedRtc(client)` crea o riusa quella connessione. Tutte le camere e sia live che NVR usano questa stessa PC.

### 3.2 Si apre una parallela per NVR?

**No.** NVR è un **altro track** sulla stessa PC: `addNvrTrack(...)` usa la stessa `getOrCreateSharedRtc(client)`. Live = track da getVideoStream (es. mid 1,2). NVR = track da getRecordingStream (es. mid 3,4). Due `MediaStream` diversi, stessa `RTCPeerConnection`.

### 3.3 In live si jumpa tra sessioni o si riusa con cambio parametri?

**Né l'uno né l'altro.** Si **cambia quale MediaStream** si attacca al video: in NVR il `<video>` ha `srcObject = NVR MediaStream`; a go-to-live si chiama `pauseNvrPlayback()` (solo `setPlaybackRate(0)`, non `stopSharedNvrTrack`) e si azzerano le mappe, quindi il player usa `stream.mediaStream` (live). Stessa sessione, due stream: il passaggio è solo cambio di `srcObject`. Il track NVR resta in pausa sulla connessione per "instant next scrub".

**Riepilogo:** Stessa shared sempre. Nessuna sessione parallela per NVR (stesso PC, altro track). Go-to-live = cambio di MediaStream mostrato (da NVR a live), non jump tra sessioni né cambio parametri di un unico stream. Track NVR resta attivo in pausa.

---

## 4. Confronto con l'app NVR (External hub NVR)

Riferimento: `docs/NVR-scrubbing-playback-analysis.md` (plugin External hub NVR v0.12.42 + frontend Vue/NVR app).

### 4.1 Seek continui / scrubbing

| Aspetto | App NVR | Camstack (noi) |
|--------|---------|-----------------|
| **Path** | NVR ha due path: **WebCodec** (scrub animato a keyframe) e **RTSP/WebRTC** (seek su stream esistente). | Solo RTSP/WebRTC via shared connection (no WebCodec). |
| **Serializzazione** | **WebCodec**: `scrub()` è in singleton — `if (!scrubPromise) { scrubPromise = promise.finally(() => { scrubPromise = undefined; }); }`. Una sola animazione alla volta; le chiamate successive riusano la stessa promise. **Backend**: `scrubInternal()` fa un loop di keyframe poi `changeStream(targetTime)`. | **Noi**: throttle 100ms + coda (seekInFlightRef + drain in finally). Più seek possono essere schedulati ma solo uno in volo; dopo il seek si drena il pending. |
| **Logica per chiamata** | Stesso timestamp → ignora. Delta &lt; 4s → `changeTime` (hard seek). Delta in avanti &lt; 30s → fast-forward (target + flush audio). Altrimenti → animazione keyframe. | Stesso timestamp (ε 1s) → ignora. Throttle 100ms + coda serializzata; seek in-place (path RTSP). |
| **Seek in-place (RTSP)** | Come noi: `getRecordingStream({ startTime, playbackRate: 1, container: "rtsp" }, existingStream)`. Il server aggiorna il segmento senza rinegoziare WebRTC. | Stesso: `nvr.seekTo(epochMs)` → `device.getRecordingStream(seekOpts, stream)`. |

**Allineamento:** path RTSP: stesso timestamp → ignora; throttle 100ms + un seek in volo + drain. NVR path WebCodec ha in più animazione keyframe e fast-forward; noi solo changeTime (seek) in-place.

### 4.2 Go to live / ritorno al live

| Aspetto | App NVR | Camstack (noi) |
|--------|---------|-----------------|
| **Modello** | Tre “slot”: live (O), recording RTSP (x), recording WebCodec (A). Se `!playbackTime` → live. | Un solo &lt;video&gt;; si cambia `srcObject` tra live MediaStream e NVR MediaStream. |
| **Azione** | Impostare `playbackTime = null` (o equivalente) → il watcher avvia `startLiveStream()` (slot O). | Clear delle mappe `playingVideoclip*` + `pauseNvrPlayback()` (rate 0). Il player mostra di nuovo `stream.mediaStream` (live). |
| **Track NVR** | Non documentato esplicitamente; probabilmente lo stream recording viene sostituito o rilasciato quando si torna a live. | **Non** si chiama `stopSharedNvrTrack`: il track NVR resta in pausa (rate 0) per “instant next scrub”. |

Sostanza: entrambi tornano al live commutando quale stream è attivo. Noi teniamo il track NVR in pausa per riuso; NVR (dal doc) non specifica se fa lo stesso.

### 4.3 Sincronizzazione timeline ↔ backend

| Aspetto | App NVR | Camstack (noi) |
|--------|---------|-----------------|
| **Current time** | **RTSP/WebRTC**: RPC `getRecordingStreamCurrentTime(stream)` (polling ~1s). **WebCodec**: calcolo locale da RTP. | Polling ~1s → `onNvrPollTime` → `setPlaybackPositionEpochMs`. Nessun filtro (come NVR doc). |
| **Auto-follow timeline** | Non descritto. | Effect in DetectionTimeline: scroll programmatico ogni 200ms per tenere il cursore di playback in vista. |


### 4.4 Riepilogo confronto

- **Seek**: NVR (WebCodec) serializza scrub; noi (RTSP) serializziamo seek (un seek in volo + drain), throttle 100ms, stesso timestamp → ignora (ε 1s). Seek in-place come NVR (`getRecordingStream(opts, existingStream)`).
- **Go to live**: concetto analogo; noi teniamo il track NVR in pausa (pause only) per riuso.
- **Sync**: come NVR — polling current time ~1s, applicare ogni risultato senza filtri (NVR doc non descrive ignore/tolleranza).
