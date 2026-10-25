# Analisi NVR: Scrubbing e Playback

Analisi del plugin External hub NVR (v0.12.42) per comprendere i meccanismi di scrubbing sulla timeline e playback delle registrazioni.

> **Nota**: Il codice NVR analizzato e' minificato (build di produzione). I nomi delle variabili sono stati ricostruiti dal contesto.

---

## Indice

1. [Architettura Generale](#architettura-generale)
2. [Scrubbing (Timeline Scroll)](#scrubbing-timeline-scroll)
3. [Playback (Riproduzione Registrazioni)](#playback-riproduzione-registrazioni)
4. [WebCodec Pipeline](#webcodec-pipeline)
5. [RtspSplicer (Stream Stitching)](#rtspsplicer-stream-stitching)
6. [Implicazioni per Camstack](#implicazioni-per-camstack)

---

## Architettura Generale

```
┌──────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Vue.js)                        │
│                                                                  │
│  Timeline UI ──> scrub(time, destination)                        │
│       │                                                          │
│       ▼                                                          │
│  WebCodec Client                                                 │
│  - VideoDecoder (browser API)                                    │
│  - Callback: onKeyFrame / onPredictedFrame / onScrubFrame        │
│  - Frame queue con backpressure                                  │
│  - Canvas rendering con frame pacing                             │
└────────────────────────┬─────────────────────────────────────────┘
                         │ RPC (dedicatedTransport)
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                      BACKEND (Node.js)                           │
│                                                                  │
│  WebCodecGenerator (classe Fu)                                   │
│  ├── getWebCodecGenerator(callback) → async generator            │
│  ├── scrub(time, destination) → smooth keyframe animation        │
│  ├── changeTime(time, destination) → hard seek                   │
│  └── changeStream(time) → switch recording segment              │
│       │                                                          │
│       ▼                                                          │
│  RtspSplicer (classe Eu)                                         │
│  - Gestisce lo stream stitching tra segmenti                     │
│  - Aggiusta RTP timestamps e sequence numbers                    │
│  - Applica playbackRate ai timestamp RTP                         │
│       │                                                          │
│       ▼                                                          │
│  Recording Storage (file su disco)                               │
│  - Segmenti video in formato RTSP/RTP                            │
│  - SDP metadata per codec info                                   │
│  - Indicizzazione per timestamp                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Scrubbing (Timeline Scroll)

Lo scrubbing e' il meccanismo che mostra frame di anteprima rapida quando l'utente trascina la timeline. E' estremamente veloce perche' usa un approccio basato su **keyframe singoli** anziche' stream completi.

### Flusso completo

```
User trascina timeline
        │
        ▼
Frontend: scrub(targetTime, destination)
        │
        ├─ Se il delta e' < 4s → changeTime (hard seek, riprendi stream)
        ├─ Se il delta e' < 30s e in avanti → fast-forward (imposta target, flush audio)
        └─ Altrimenti → scrub animato (keyframe interpolati)
                │
                ▼
Backend: scrub(time, destination)
        │
        ▼
scrubInternal()
  1. stopStream() - ferma lo stream corrente
  2. flush() + onKeyFrame(null) - pulisce il decoder
  3. Loop di interpolazione:
     - Calcola N frame intermedi (Pu/Ou ≈ 30 frame)
     - Per ogni frame:
       a. getKeyFrame(interpolatedTime, "low-resolution")
       b. Invia via callback.onScrubFrame(buffer)
       c. Sleep per mantenere il pacing (~33ms tra frame)
  4. changeStream(targetTime) - avvia playback dal target
```

### Backend: `scrub()` e `scrubInternal()`

```javascript
// Costanti chiave
const Pu = 1000;           // Durata animazione scrub: 1 secondo
const ku = 33;             // ~33ms per frame (≈30fps)
const Ou = Math.floor(Pu / ku);  // ≈30 frame totali di animazione

async scrub(targetTime, destination) {
    this.smoothChangeFrames = Math.round(Pu / Ou);  // ~30 frame
    this.smoothChangeTargetTime = targetTime;
    this.smoothChangeEnd = Date.now() + Pu;  // scadenza a 1s
    this.destination = destination;

    // Singleton: una sola animazione alla volta
    if (!this.scrubbing) {
        this.scrubbing = this.scrubInternal().finally(() => {
            this.scrubbing = undefined;
        });
    }
    return this.scrubbing;
}
```

L'animazione di scrub:

```javascript
async scrubInternal() {
    this.splicer.stopStream();       // Ferma stream corrente
    await this.callback.flush();     // Segnala flush al client
    await this.callback.onKeyFrame(null);  // Reset decoder

    let currentTime = this.splicer.lastPlaybackTime;
    const startWall = Date.now();
    let nextFrameTime = startWall;

    while (this.smoothChangeFrames > 0 && currentTime) {
        const delta = this.smoothChangeTargetTime - currentTime;

        // Se siamo gia' vicini (<4s), esci dal loop
        if (Math.abs(delta) < 4000) break;

        // Step size: equidistribuito, minimo 4s
        let step = delta / this.smoothChangeFrames;
        if (step > 0 && step < 4000) step = 4000;
        if (step < 0 && step > -4000) step = -4000;

        this.smoothChangeFrames--;
        if (this.smoothChangeFrames <= 0) break;

        currentTime = Math.floor(currentTime + step);
        nextFrameTime += Ou;  // ≈33ms

        // Salta frame se siamo in ritardo
        if (nextFrameTime - Date.now() <= 0) continue;

        try {
            // Estrai UN singolo keyframe dalla registrazione
            const frameBuffer = await getKeyFrame(currentTime);

            // Imposta timestamp per il decoder
            const pts = (Date.now() - startWall) / 1000 * 90000;
            frameBuffer.writeUInt32BE(pts, 0);

            // Invia al client
            await this.callback.onScrubFrame(frameBuffer);
        } catch (e) {
            if (e instanceof TimeoutError) break;
            continue;  // Salta frame non disponibili
        }

        // Pacing: aspetta il prossimo slot
        const sleepMs = nextFrameTime - Date.now();
        if (sleepMs > 0) await sleep(sleepMs);
    }

    // Fine animazione: riprendi lo stream dal punto target
    this.splicer.lastPlaybackTime = this.smoothChangeTargetTime;
    this.changeStream(this.smoothChangeTargetTime);
}
```

### Backend: `getKeyFrame()` - Estrazione Keyframe Singolo

Questa e' la funzione chiave per le prestazioni dello scrubbing. Estrae **un singolo keyframe** (I-frame) dalla registrazione ad un dato timestamp.

```javascript
async getKeyFrame(time, destination = "low-resolution") {
    // 1. Trova il segmento di registrazione che contiene il timestamp
    const { destination: resolvedDest } = await resolveDestination(this.id, time, destination);

    // 2. Apri uno stream di pacchetti RTP dal segmento, con timeout 8s
    const packets = withTimeout(
        readRecordingPackets(this.console, this.id, resolvedDest, time, false),
        8000,
        true  // keyframeOnly
    );

    // 3. Cerca il primo keyframe H264/H265
    let repacketizer;
    const rtpPackets = [];
    for await (const packet of packets) {
        if (packet.rtcp) continue;
        if (packet.type !== "h264" && packet.type !== "h265") continue;

        repacketizer ??= packet.type === "h264"
            ? new H264Repacketizer(packet.videoSection)
            : new H265Repacketizer(packet.videoSection);

        const repacked = repacketizer.repacketize(RtpPacket.deSerialize(packet.packet));
        rtpPackets.push(...repacked);
    }

    // 4. Assembla: codec info (SPS/PPS/VPS) + keyframe NALUs
    const nalus = [...repacketizer.getCodecInfo()];
    for (const pkt of rtpPackets) {
        const naluTypes = repacketizer.getNaluTypesInNalu(pkt.payload);
        if (repacketizer.getNaluTypesHasKeyFrame(naluTypes)) {
            nalus.push(pkt.payload);
        }
    }

    // 5. Pacchettizza con header di 10 byte:
    //    [4B timestamp][1B payloadType][1B isKeyFrame][4B wallTime]
    const header = Buffer.alloc(10);
    header.writeUInt32BE(0, 0);                    // timestamp (verra' sovrascritto)
    header.writeUInt8(repacketizer.payloadType, 4); // 97=h264, 99=h265
    header.writeUInt8(1, 5);                        // isKeyFrame = true
    header.writeUInt32BE(Math.floor(time / 1000), 6);

    const startCodeSeparator = Buffer.alloc(4);
    startCodeSeparator.writeUInt32BE(1, 0);  // NAL start code: 00 00 00 01

    const payload = Buffer.concat(nalus.map(n => Buffer.concat([startCodeSeparator, n])));
    return Buffer.concat([header, payload]);
}
```

**Perche' e' veloce:**
- Usa `"low-resolution"` come destinazione → legge dal sub-stream (bassa risoluzione)
- Cerca solo il keyframe piu' vicino → non deve decodificare un GOP intero
- Timeout di 8 secondi → non si blocca su segmenti corrotti
- Singleton pattern → una sola animazione alla volta, le nuove sovrascrivono le vecchie

### Frontend: Ricezione e Rendering dei Scrub Frame

```javascript
// Callback dal backend
async onScrubFrame(buffer) {
    // Risolve la promise di attesa (se presente)
    pendingScrubPromise?.resolve();

    if (buffer) {
        // Flush della coda video
        videoQueue.submit(undefined);  // Segnale di flush
        // Invia il frame decodificato
        videoQueue.submit(parseWebCodecPacket(buffer));
    }
}
```

Il frontend usa l'API `VideoDecoder` del browser per decodificare i keyframe:

```javascript
const decoder = new VideoDecoder({
    output: (frame) => {
        // frame e' un VideoFrame → vai alla coda di rendering
        if (!finished && !flushing) {
            videoFrameQueue.submit(frame);
        } else {
            frame.close();
        }
    },
    error: (err) => console.error("Error decoding:", err)
});

decoder.configure({
    codec: codecString,  // es. "avc1.42E01E" o "hev1.1.6.L93.B0"
    hardwareAcceleration: "prefer-hardware",
    optimizeForLatency: true
});
```

### Frontend: Logica di decisione nello `scrub()`

```javascript
async scrub(targetTime, destination) {
    if (!webcodecGenerator) throw new Error("webcodec generator closed");

    const prevStartTime = startTime;
    startTime = targetTime;
    const prevDest = currentDestination;

    // Cambio destinazione (es. qualita') → hard seek
    if (destination !== prevDest) {
        await webcodecGenerator.changeTime(targetTime, destination);
        return;
    }

    // Stesso timestamp → ignora
    if (startTime === prevStartTime) return;

    // Primo seek o da null → hard seek
    if (!prevStartTime || !startTime) {
        await webcodecGenerator.changeTime(targetTime, destination);
        return;
    }

    const currentTime = getCurrentTime();
    const delta = targetTime - currentTime;

    // Se non stiamo gia' facendo scrub E il delta e' in avanti E < 30s
    if (!scrubPromise && delta > 0 && delta < 30000) {
        // Delta piccolo (<4s) → hard seek (il decoder raggiunge da solo)
        if (delta < 4000) {
            await webcodecGenerator.changeTime(targetTime, destination);
            return;
        }
        // Fast-forward: imposta un target e lascia che il playback acceleri
        scrubTarget = undefined;
        ffTarget = targetTime;
        audioManager.flush();
        return;
    }

    // Scrub classico con animazione keyframe
    const promise = webcodecGenerator.scrub(targetTime, destination);
    if (!scrubPromise) {
        scrubPromise = promise.finally(() => { scrubPromise = undefined; });
    }
    return promise;
}
```

### Impostazione "Smooth Scrubbing"

L'utente puo' attivare/disattivare lo smooth scrubbing:

```javascript
const smoothScrubbing = ref(localStorage.getItem("smoothScrubbing") !== "false");

function setSmoothScrubbing(value) {
    smoothScrubbing.value = value;
    localStorage.setItem("smoothScrubbing", value.toString());
}
```

---

## Playback (Riproduzione Registrazioni)

L'NVR ha **due path alternativi** per il playback delle registrazioni:

| | RTSP/WebRTC (default) | WebCodec (opzionale) |
|---|---|---|
| **Attivazione** | Sempre disponibile | Flag utente + browser support |
| **Container** | `"rtsp"` | `"webcodec"` |
| **Decodifica** | Browser `<video>` via WebRTC | `VideoDecoder` API su canvas |
| **Seek** | Chiama `getRecordingStream(newOpts, existingStream)` | `scrub()` / `changeTime()` interni |
| **PlaybackRate** | `getRecordingStream({ playbackRate }, stream)` | `setPlaybackRate()` locale |
| **Scrubbing animato** | Non supportato | Supportato (keyframe interpolati) |
| **CurrentTime** | RPC: `device.getRecordingStreamCurrentTime(stream)` | Locale: calcolo da RTP timestamps |

### Scelta del path: WebCodec e' opzionale

```javascript
// 1. Il browser supporta VideoDecoder?
function checkWebCodecSupport() {
    try {
        return !(!window.VideoDecoder
            || !isConfigSupported("avc1.640034")    // H264 High Profile
            || !isConfigSupported("hev1.1.6.L153.B0")); // H265
    } catch {
        return false;
    }
}

// 2. L'utente ha abilitato il flag?
const webcodecUserFlag = ref(localStorage.getItem("webcodec") === "true");

// 3. Computed: entrambe le condizioni devono essere vere
const useWebCodec = computed(() => browserSupportsWebCodec && webcodecUserFlag.value);
```

La decisione nel player component:

```javascript
// Variabili di stato per i tre "slot" di stream:
let O;  // Live stream (sempre WebRTC)
let x;  // Recording stream via RTSP/WebRTC (path non-WebCodec)
let A;  // Recording stream via WebCodec

// Nel getter reattivo (watcher):
if (!useWebCodec.value || !device.interfaces?.includes("VideoRecorder")) {
    // === PATH RTSP/WebRTC ===
    if (!playbackTime) {
        // Stream LIVE → usa WebRTC
        O = startLiveStream();   // → pW() → rD("live", ...)
    } else {
        // Recording playback → usa RTSP su WebRTC
        x = startRecordingRtsp(x);  // → G() → gW() → rD("recording", ...)
    }
} else {
    // === PATH WebCodec ===
    A = startRecordingWebCodec(A); // → ne() → bW()
}
```

### PATH 1: RTSP/WebRTC (Non-WebCodec)

Questo e' il path "classico" e quello piu' rilevante per Camstack.

#### Flusso di Avvio

```
User clicca sulla timeline a un certo timestamp
        │
        ▼
Frontend: G(previousStream, overrides?)
        │
        ▼
gW(scryptedClient, device, options, previousStream)
  │
  ├─ Se c'e' uno stream precedente:
  │    await device.getRecordingStream({
  │        startTime: playbackTime,
  │        playbackRate: 1,
  │        container: "rtsp"
  │    }, existingMediaStream)
  │    → Il server cambia il segmento SENZA rinegoziare WebRTC
  │    → Se ritorna null: lo stream e' stato aggiornato in-place ✓
  │
  └─ Se non c'e' stream precedente:
       rD("recording", scryptedClient, device.id, requestFn, options)
       │
       ├─ Crea RequestMediaStream con container: "rtsp"
       ├─ Supporta adaptive bitrate: { resize: true, codecSwitch: true }
       ├─ Negozia WebRTC: addTrack(mediaObject, { videoMid, audioMid })
       ├─ Attende track video e audio sulla PeerConnection
       └─ Ritorna { mediaStream, stream, feedback, finished, ... }
              │
              ▼
       Browser <video> element
       video.srcObject = mediaStream
```

#### Seek (Cambio Timestamp)

```javascript
// Il seek nel path RTSP/WebRTC riusa la connessione esistente:
async function gW(scryptedClient, device, options, previousResult) {
    let existingStream;

    if (previousResult) {
        existingStream = await previousResult.stream;

        // Chiedi al server di cambiare punto di riproduzione
        // passando lo stream esistente come secondo parametro
        const newStream = await device.getRecordingStream({
            ...options,
            container: "rtsp"
        }, existingStream);

        // Se ritorna null/undefined → lo stream e' stato aggiornato in-place
        if (!newStream) return; // Nessun cambio necessario lato WebRTC

        // Se ritorna un oggetto diverso → warn (implementazione incorretta)
        if (newStream !== existingStream) {
            console.warn("Implementation should return null/undefined");
        }
    }

    // Se non c'era stream o serve un nuovo setup WebRTC
    const requestFn = (opts) => device.getRecordingStream(opts, existingStream);
    const result = await rD("recording", scryptedClient, device.id, requestFn, options);
    return result;
}
```

**Punto chiave**: il secondo parametro di `getRecordingStream(options, existingStream)` permette al server di **riutilizzare la stessa sessione RTSP/WebRTC** e cambiare solo il segmento di registrazione che sta streamando. Non serve rinegoziare WebRTC.

#### Playback Rate (Velocita')

```javascript
// Per il path RTSP/WebRTC, il playbackRate viene comunicato al server:
if (watchedProperty === "playbackRate") {
    // Invia il nuovo rate al server tramite lo stream esistente
    x?.then(async (result) => {
        if (!cancelled()) {
            await device.getRecordingStream({
                startTime: 0,
                playbackRate: newRate || 1
            }, await result?.stream);
        }
    });
}
```

#### Current Time

```javascript
// Il current time e' calcolato dal SERVER (RPC):
currentTimeInterval = setInterval(1000, async () => {
    const currentTime = await device.getRecordingStreamCurrentTime(await result.stream);
    emit("update:currentTime", currentTime);
});
```

#### Struttura dati ritornata da `rD()` (WebRTC setup)

```javascript
// rD() ritorna un oggetto con:
{
    mediaStream: MediaStream,        // Per <video>.srcObject
    stream: Promise<MediaObject>,    // Handle allo stream server-side
    finished: Promise<void>,         // Risolve quando lo stream finisce
    videoTransceiver: Promise<RTCRtpTransceiver>,
    audioTransceiver: Promise<RTCRtpTransceiver>,
    feedback: Promise<{              // Per adaptive bitrate
        resizeStream(size): void
    }>,
    setPlayback({ audio, video }): void,
    setMicrophone(enabled): void,
    close(): void
}
```

### PATH 2: WebCodec (Opzionale)

##### Flusso di Avvio Playback

```
User clicca su un punto della timeline (con WebCodec abilitato)
        │
        ▼
Frontend: ne(previousStream, overrides?) → bW(muted, renderCb, client, device, options, prev)
        │
        ├─ Se c'e' uno stream precedente con recordingStream:
        │    scrub(startTime, destination) + setPlaybackRate(rate)
        │    → Cambia punto e velocita' senza ricreare nulla ✓
        │
        └─ Se non c'e' stream precedente:
             getRecordingStream({
                 startTime: clickedTimestamp,
                 container: "webcodec",
                 adaptive: { resize: true, codecSwitch: true }
             })
                │
                ▼
             Backend:
               1. Trova il segmento di registrazione per startTime
               2. Crea WebCodecGenerator (Fu)
               3. Avvia RtspSplicer per lo stitching dei segmenti
               4. Invia pacchetti H264/H265 via RPC callback
                │
                ▼
             Frontend:
               1. Riceve pacchetti via onKeyFrame / onPredictedFrame
               2. Decodifica con VideoDecoder (browser, HW accelerato)
               3. Rendering su canvas con frame pacing
```

### Backend: Classe WebCodecGenerator (`Fu`)

```javascript
class WebCodecGenerator {
    id;           // Camera ID
    console;      // Logger
    splicer;      // RtspSplicer per stream stitching
    destination;  // Qualita': "local-recorder", "low-resolution", "remote", etc.
    callback;     // Callback RPC verso il frontend

    async getWebCodecGenerator(callback) {
        this.callback = callback;
        return async function*() {
            for await (const segment of this.generateSegments()) {
                await callback.onPredictedFrame();
                yield;
            }
        }();
    }
}
```

### Backend: `generateSegments()` - Produzione Frame

Questa funzione trasforma i pacchetti RTP grezzi in frame decodificabili dal browser:

```javascript
async *generateSegments() {
    let h264Repacker, h265Repacker;
    let pendingNalus = [];

    for await (const packet of this.splicer.generator()) {
        if (packet.rtcp) continue;

        const rtpPacket = RtpPacket.deSerialize(packet.packet);
        const isVideo = packet.type === "h264" || packet.type === "h265";

        // Audio: AAC, Opus, PCM → invia direttamente
        if (!isVideo) {
            await sendAudioFrame(rtpPacket, packet.time, packet.audioSection);
            continue;
        }

        // Video: repacketize NALUs
        const repacker = packet.type === "h264" ? h264Repacker : h265Repacker;
        for (const nal of repacker.repacketize(rtpPacket)) {
            const naluTypes = repacker.getNaluTypesInNalu(nal.payload);

            if (repacker.getNaluTypesHasKeyFrame(naluTypes)) {
                // Keyframe: emetti il segmento precedente e inizia nuovo
                yield* flushPending();  // Invia accumulati

                // Prependi SPS/PPS (o VPS/SPS/PPS per H265)
                const codecInfo = repacker.getCodecInfo();
                pendingNalus = [
                    ...codecInfo.flatMap(ci => [startCode, ci]),
                    startCode, nal.payload
                ];
            } else {
                // Non-keyframe: accumula
                pendingNalus.push(startCode, nal.payload);
            }

            // Assembla in buffer con header di 10 byte e invia
            // Header: [4B rtp_ts][1B payload_type][1B is_key][4B wall_time_s]
            await sendVideoFrame(nal, isKeyFrame, packet.time);
        }
    }
}
```

### Frontend: Pipeline di Decodifica e Rendering

```
Backend (RPC)
    │
    ▼
Packet Queue (con backpressure: max 120 elementi)
    │
    ▼
parseWebCodecPacket() → { codec, data, timestamp, isKeyFrame, time }
    │
    ▼
VideoDecoder.decode(EncodedVideoChunk)
    │   - hardwareAcceleration: "prefer-hardware"
    │   - optimizeForLatency: true
    │
    ▼
VideoFrame Queue (max 1 frame, fast consume)
    │
    ▼
Frame Pacing Loop:
    - Calcola delta dal frame precedente
    - Applica playbackRate
    - Limita a 60fps (salta frame piu' veloci)
    - Sleep per mantenere sincronizzazione
    │
    ▼
Canvas/MediaStreamTrackGenerator rendering
```

Il frame pacing e' gestito cosi':

```javascript
// Nel loop di rendering
for await (const videoFrame of videoFrameQueue) {
    const { timestamp } = videoFrame;  // In microsecondi

    if (timestamp) {
        const now = performance.now();
        let rate = playbackRate;

        // Se c'e' un fast-forward target, accelera progressivamente
        if (ffTarget) {
            const current = getCurrentTime();
            if (ffTarget <= current || ffTarget > current + 30000) {
                ffTarget = undefined;
            } else {
                rate = (ffTarget - current) / 1000;
                if (rate < 2) { rate = 1; ffTarget = undefined; }
            }
        }

        let frameDelta = (timestamp - lastTimestamp) / rate / 1000;

        // Frame con timestamp negativo → anomalia, scarta
        if (frameDelta < 0) {
            videoFrame.close();
            continue;
        }

        const expectedWall = lastWallTime + frameDelta;
        const sleepMs = Math.floor(expectedWall - now);

        // Troppo vecchio → salta avanti
        if (!lastTimestamp || sleepMs < 0) {
            lastWallTime = now;
        }
        // Troppo in futuro (>300ms) → resetta, scarta frame
        else if (sleepMs > 300) {
            lastWallTime = now;
            lastTimestamp = timestamp;
            videoFrame.close();
            continue;
        } else {
            lastWallTime = expectedWall;
            if (startTime) await sleep(sleepMs);
        }

        // Rate limit a 60fps
        if (lastWallTime && expectedWall - lastWallTime < 1000/60) {
            videoFrame.close();
            continue;
        }
    }

    lastTimestamp = timestamp;

    // Rendering (canvas draw o MediaStreamTrackGenerator)
    renderCallback(videoFrame);
}
```

### Calcolo del Current Playback Time

```javascript
function getRecordingStreamCurrentTime() {
    if (scrubPromise && scrubTarget) return scrubTarget;

    // Calcolo basato su: offset iniziale + timestamp RTP relativo
    const baseTimestamp = firstTimestamp + lastRenderedTimestamp * 90000 / 1000 / 1000;
    const rtp_delta_ms = (lastPacketTimestamp - baseTimestamp) / 90000 * 1000;
    const wallTime_ms = lastPacketWallTime - rtp_delta_ms;

    // Sanity check: se la stima differisce troppo, usa il wall time
    if (!wallTime_ms || Math.abs(lastPacketWallTime - wallTime_ms) > 8000) {
        return lastPacketWallTime;
    }
    return wallTime_ms;
}
```

---

## WebCodec Pipeline

### Formato Pacchetto WebCodec (10 byte header + payload)

```
Offset  Size  Campo
0       4B    RTP Timestamp (per sincronizzazione)
4       1B    Payload Type (97=H264, 99=H265, 96=AAC, 111=Opus, 0=PCM-ulaw)
5       1B    Is Keyframe (1=si, 0=no)
6       4B    Wall Clock Time (secondi, epoch/1000)
[10+]   nB    Payload: NALUs concatenati con start code 00 00 00 01
```

Per i pacchetti audio, c'e' un header esteso di 13 byte:

```
Offset  Size  Campo
0-9     10B   Come sopra
10      2B    Sample Rate (es. 48000)
12      1B    Channels (es. 1 o 2)
```

### Codec Support

| Codec | PayloadType | Codec Info (prepeso a ogni keyframe) |
|-------|-------------|--------------------------------------|
| H264  | 97          | SPS + PPS (+ SEI se presente)        |
| H265  | 99          | VPS + SPS + PPS                      |
| AAC   | 96          | -                                    |
| Opus  | 111         | -                                    |
| PCM μ-law | 0      | -                                    |

### Repacketizer H264 / H265

I pacchetti RTP originali possono essere frammentati (FU-A per H264, FU per H265). Il repacketizer:

1. Riassembla i frammenti in NALUs completi
2. Analizza i tipi NALU per identificare:
   - **H264**: tipo 5 = IDR (keyframe), tipo 7 = SPS, tipo 8 = PPS, tipo 6 = SEI
   - **H265**: tipi 16-21 = keyframe (IRAP), tipo 32 = VPS, tipo 33 = SPS, tipo 34 = PPS
3. Prepone codec info (SPS/PPS/VPS) prima di ogni keyframe
4. Concatena con NAL start code (00 00 00 01)

---

## RtspSplicer (Stream Stitching)

L'`RtspSplicer` (`Eu`) e' il componente che permette di passare senza soluzione di continuita' da un segmento di registrazione all'altro.

### Problema

Le registrazioni sono salvate in segmenti (tipicamente per ora). Quando il playback attraversa il confine tra due segmenti, i timestamp RTP e i sequence number saltano. Senza stitching, il decoder vedrebbe una discontinuita'.

### Soluzione

```javascript
class RtspSplicer {
    queue;              // Coda di output
    streams;            // Map<codec, StreamState>
    streamQueue;        // Coda di input per richieste di cambio stream
    playbackRate;       // Velocita' di riproduzione (1 = normale)
    lastPlaybackTime;   // Ultimo timestamp di playback (wall clock)
    discontinuityTimeMs;

    async changeStream(newStreamGenerator) {
        const request = { stream: newStreamGenerator, deferred: new Deferred() };
        this.streamQueue.submit(request);
        return request.deferred.promise;
    }

    async *generator() {
        for await (const request of this.streamQueue.queue) {
            const { stream, deferred } = request;

            if (!stream) {
                deferred.resolve();
                continue;
            }

            // Se c'e' gia' una nuova richiesta in coda, salta questa
            if (this.streamQueue.queued.length) {
                deferred.reject("cancelled");
                continue;
            }

            // Reset first-packet flag per tutti i codec
            for (const state of this.streams.values()) {
                state.firstPacket = true;
                state.lastRtpTimestamp = undefined;
            }

            let sentFirstKeyframe = true;

            for (;;) {
                const { value: packet, done } = await stream.next();

                // Se c'e' un nuovo stream in coda E abbiamo gia' inviato un keyframe, esci
                if (this.streamQueue.queued.length && sentFirstKeyframe) break;

                if (done) {
                    deferred.resolve(packet);  // packet = return value (prossimo startTime)
                    break;
                }

                if (packet.rtcp) continue;

                const rtp = RtpPacket.deSerialize(packet.packet);
                const { timestamp, sequenceNumber } = rtp.header;
                const isVideo = packet.type === "h264" || packet.type === "h265";

                let state = this.streams.get(packet.type);

                if (state) {
                    if (state.firstPacket) {
                        // STITCHING: calcola l'offset per rendere continui i timestamp
                        if (this.discontinuityTimeMs) {
                            const clock = isVideo ? 90000 : 8000;
                            const expectedTs = (Date.now() - state.lastSentWallClockTime)
                                / 1000 * clock + state.lastSentRtpTimestamp;
                            state.rtpTimestampAdjust = Math.round(expectedTs - timestamp);
                            state.rtpTimestampAdjust++;
                        } else {
                            state.rtpTimestampAdjust =
                                state.lastSentRtpTimestamp - timestamp + 1;
                        }
                        state.firstPacket = false;
                        state.lastRtpTimestamp = timestamp;
                        state.sequenceNumberAdjust =
                            state.lastSentSequenceNumber - sequenceNumber + 1;
                    }
                } else {
                    // Primo pacchetto di questo tipo: nessun adjust necessario
                    state = {
                        firstPacket: false,
                        lastRtpTimestamp: timestamp,
                        lastSentRtpTimestamp: timestamp,
                        lastSentSequenceNumber: sequenceNumber,
                        sequenceNumberAdjust: 0,
                        rtpTimestampAdjust: 0,
                        lastSentWallClockTime: Date.now()
                    };
                    this.streams.set(packet.type, state);
                }

                // Applica playbackRate ai delta dei timestamp
                const rate = this.playbackRate || 1;
                let tsDelta = timestamp - state.lastRtpTimestamp;
                if (!isVideo) {
                    tsDelta = Math.ceil(tsDelta / rate);
                }
                const adjustedTs = state.lastRtpTimestamp + tsDelta;

                // Applica gli offset di stitching
                rtp.header.timestamp = wrapU32(adjustedTs, state.rtpTimestampAdjust);
                rtp.header.sequenceNumber = wrapU16(sequenceNumber, state.sequenceNumberAdjust);

                packet.packet = rtp.serialize();
                this.lastPlaybackTime = packet.time;

                // Aggiorna stato
                state.lastRtpTimestamp = timestamp;
                state.lastSentSequenceNumber = rtp.header.sequenceNumber;
                state.lastSentRtpTimestamp = rtp.header.timestamp;
                state.lastSentWallClockTime = Date.now();

                yield packet;

                // Se c'e' marker bit (fine frame) E c'e' un nuovo stream in coda, esci
                if (isVideo) {
                    sentFirstKeyframe = !!rtp.header.marker;
                }
                if (this.streamQueue.queued.length && sentFirstKeyframe) break;
            }
        }
    }
}
```

### Risoluzione Destinazione

Il backend seleziona automaticamente la qualita' migliore disponibile per un dato timestamp:

```javascript
async function resolveDestination(cameraId, time, requestedDestination) {
    // Prova prima la destinazione richiesta
    let segment = await findSegment(time, cameraId, requestedDestination);

    // Fallback chain:
    // "low-resolution" → "remote" → "local-recorder"
    // "remote"/"medium-resolution" → "low-resolution"
    if (!segment) {
        const fallback = getFallback(requestedDestination);
        segment = await findSegment(time, cameraId, fallback);
    }

    return { destination: segment.destination };
}
```

---

## Implicazioni per Camstack

### API External hub per il Playback delle Registrazioni

```typescript
interface VideoRecorder {
    // Avvia o modifica uno stream di registrazione
    // options.container: "rtsp" | "webcodec"
    // options.startTime: timestamp epoch ms
    // options.playbackRate: 1 = normale, 0 = pausa, 2 = 2x, etc.
    // options.destination: "local-recorder" | "low-resolution" | "remote"
    // options.adaptive: false | { resize: true, codecSwitch: true }
    // options.duration: durata in ms (opzionale)
    // options.loop: boolean (opzionale)
    //
    // existingStream: se passato, il server riusa la sessione esistente
    //   e cambia solo il punto di riproduzione (seek in-place)
    //   Ritorna null se lo stream e' stato aggiornato con successo.
    getRecordingStream(options, existingStream?): Promise<MediaObject>;

    // Ritorna il timestamp corrente dello stream (epoch ms)
    // stream: lo stream ottenuto da getRecordingStream
    getRecordingStreamCurrentTime(stream): Promise<number>;

    // Ritorna un MediaObject con un'immagine thumbnail per il timestamp
    getRecordingStreamThumbnail(time: number): Promise<MediaObject>;

    // Ritorna le opzioni disponibili (qualita', codec, etc.)
    getRecordingStreamOptions(): Promise<RecordingStreamOptions[]>;
}
```

### Per implementare il Playback in Camstack

**Approccio raccomandato: RTSP/WebRTC** (come il path non-WebCodec di NVR)

Camstack gia' usa WebRTC per il live. Il playback delle registrazioni puo' seguire lo stesso pattern:

```
1. PRIMO AVVIO:
   const stream = await device.getRecordingStream({
       startTime: playbackTime,
       container: "rtsp",
       playbackRate: 1,
       video: { clientWidth, clientHeight },
       adaptive: { resize: true, codecSwitch: true }
   });
   // stream e' un MediaObject RTSP
   // Passalo alla connessione WebRTC condivisa come si fa per il live

2. SEEK (cambio timestamp):
   await device.getRecordingStream({
       startTime: newTime,
       container: "rtsp"
   }, existingStream);
   // Il server cambia il segmento, il WebRTC continua senza rinegoziare

3. CAMBIO VELOCITA':
   await device.getRecordingStream({
       startTime: 0,  // 0 = non cambiare posizione
       playbackRate: 2  // o 0.5, 4, 8, etc.
   }, existingStream);

4. PAUSA:
   await device.getRecordingStream({
       startTime: 0,
       playbackRate: 0
   }, existingStream);

5. CURRENT TIME (polling ogni 1s):
   const currentTime = await device.getRecordingStreamCurrentTime(existingStream);
```

**Punto cruciale scoperto nell'analisi**: il secondo parametro `existingStream` di `getRecordingStream()` e' la chiave per il seek efficiente. Il server NVR cambia il segmento di registrazione che sta streamando **senza toccare la connessione WebRTC**. Questo significa che in Camstack si puo':

- Usare la stessa `sharedRtcConnection` gia' esistente
- Non serve rinegoziare quando l'utente fa seek
- Il server gestisce lo stitching dei segmenti (RtspSplicer)

### Per implementare lo Scrubbing in Camstack

L'NVR usa `getKeyFrame()` a bassa risoluzione per lo scrubbing WebCodec. Per Camstack (React Native, no VideoDecoder):

1. **Opzione A - Thumbnail JPEG** (piu' semplice):
   ```
   // Durante il drag della timeline, richiedere thumbnail:
   const thumbnail = await device.getRecordingStreamThumbnail(time);
   const url = await mediaManager.convertMediaObjectToLocalUrl(thumbnail, thumbnail.mimeType);
   // Mostra l'immagine nell'UI
   ```
   Pro: semplice, compatibile. Contro: latenza per ogni thumbnail (~100-500ms).

2. **Opzione B - Seek rapido sullo stream RTSP** (piu' fluido):
   ```
   // Debounce il drag e fai seek sullo stream esistente:
   await device.getRecordingStream({ startTime: dragTime }, existingStream);
   // Il video WebRTC si aggiorna al keyframe piu' vicino
   ```
   Pro: usa l'infrastruttura esistente. Contro: non rapido come i keyframe animati di NVR.

3. **Opzione C - WebView con WebCodec** (massime prestazioni, complesso):
   Usare un componente WebView con VideoDecoder per lo scrubbing, come fa NVR.

### Confronto Approcci

| Aspetto | RTSP/WebRTC (path NVR classico) | WebCodec (path NVR avanzato) |
|---------|-------------------------------|-------------------------------|
| Seek | `getRecordingStream(opts, stream)` - riusa sessione | `scrub()` / `changeTime()` interni |
| Latenza seek | Media (~500ms, attende keyframe) | Bassa (~100ms, keyframe diretto) |
| Scrubbing animato | Non supportato | 30fps keyframe interpolati |
| Playback rate | Server-side via RPC | Client-side + server-side |
| Current time | RPC polling (1s) | Calcolo locale da RTP timestamps |
| Compatibilita' | Universale (WebRTC) | Solo browser con VideoDecoder |
| Complessita' | Media | Alta |
| HW Decode | Si (via WebRTC) | Si (VideoDecoder prefer-hardware) |
| Audio | Gestito da WebRTC | Gestito separatamente (AudioDecoder) |

### Raccomandazione per Camstack

1. **Playback**: Usare il path RTSP/WebRTC con `getRecordingStream({ container: "rtsp", startTime }, existingStream)` tramite la connessione WebRTC condivisa. Il pattern di seek in-place (secondo parametro) e' la chiave per un'esperienza fluida.

2. **Scrubbing**: Iniziare con thumbnail JPEG via `getRecordingStreamThumbnail(time)` durante il drag. Se la latenza e' insufficiente, usare seek rapido sullo stream RTSP come fallback.

3. **Futuro**: Se necessario, il path WebCodec puo' essere implementato in una WebView dedicata per ottenere le stesse prestazioni di scrubbing dell'NVR.
