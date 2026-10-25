# Piano di Refactoring: DetectionTimeline e Camera Details

## Obiettivi

1. **DetectionTimeline self-contained**: logica interna al componente, comunicazione via eventi
2. **NVR scrubbing isolato**: facile intervenire su stream con scrubbing/playback vs videoclips-only
3. **Manutenibilità**: ridurre complessità, separare responsabilità, evitare duplicazione
4. **Web e iOS**: mantenere compatibilità, isolare differenze dove necessario

---

## Stato attuale: problemi

### DetectionTimeline (~1700 righe)

- **Troppe responsabilità**: UI (clusters, motion bar, scroll, scrub cursor, playback cursor), layout (vertical/horizontal), gestione scroll, NVR scrubbing, zoom, pan
- **~50+ props**: interfaccia sovraccarica, difficile da capire e modificare
- **Logica NVR mescolata**: `scrubEnabled`, `onScrubTimeChange`, `onScrubEnd` intrecciati con scroll/visible range
- **Scroll complesso**: `programmaticScrollRef`, `scrollEndTimerRef`, `userScrollCooldownRef`, `SCRUB_AFTER_PROGRAMMATIC_MS` — difficile da debuggare
- **Duplicazione**: layout vertical vs horizontal con molto codice ripetuto

### CameraDetailScreen (~2100 righe)

- **Logica timeline sparsa**: `visibleRange`, `visibleStartMs`, `requestScrollToEndMs`, `timelineRange`, `clipsSectionDate`
- **NVR playback intricato**: `handleScrubTimeChange`, `handleScrubEnd`, `handlePlaybackSeek`, `startNvrPlaybackFromScrubRef`, debounce/throttle
- **Due istanze DetectionTimeline**: main panel + drawer con props quasi identici (duplicazione)
- **Videoclip vs NVR**: `handlePlayClip` deve gestire entrambi i casi, logica condizionale ovunque

### GridTimelinePanel

- Usa DetectionTimeline **senza** NVR (no scrubEnabled, no getVideoclipForCluster)
- Duplica logica: visibleRange, zoom, pan, date sync

---

## Architettura proposta

### 1. DetectionTimeline: contratto semplificato

**Input (props ridotte):**

```ts
interface DetectionTimelineProps {
  // Dati
  timeRange: TimeRangeMs;
  fullRange?: TimeRangeMs;
  events: TimelineDetectionEvent[];
  motionSegments: MotionSegment[];
  precomputedClusters?: TimelineCluster[];
  loading?: boolean;

  // Configurazione UI
  orientation?: "vertical" | "horizontal";
  compact?: boolean;
  fixedWidth?: number;
  fixedHeight?: number;

  // Asset/immagini
  assetsBaseUrl?: string;
  buildImageUrl?: (path: string) => string | null;
  buildImageUrlWithoutAuth?: (path: string) => string | null;
  imageHeaders?: Record<string, string>;
  eventsAppAuth?: EventsAppAuth | null;

  // Cluster detail (opzionale)
  deviceName?: string;
  clusterDetailDeviceId?: string;
  fetchClusterEvents?: (opts) => Promise<TimelineDetectionEvent[]>;
}
```

**Output (eventi unificati):**

```ts
interface DetectionTimelineEvents {
  /** Range visibile cambiato (scroll/pan) */
  onVisibleRangeChange?: (range: { start: number; end: number }) => void;

  /** BucketMs calcolato (per server clustering) */
  onBucketMsChange?: (bucketMs: number) => void;

  /** Jump to now premuto */
  onJumpToNow?: () => void;

  /** Cluster cliccato → apri detail */
  onClusterDetail?: (payload: ClusterDetailPayload) => void;

  /** Navigazione a timestamp (cluster tap, seek) */
  onSeek?: (epochMs: number, source: "cluster" | "playback-drag" | "scrub-end") => void;

  /** Durante scrub: timestamp sotto il cursore — REALTIME, nessun delay (ogni scroll) */
  onScrubTimeChange?: (epochMs: number) => void;
}
```

La pagina passa `onSeek` e opzionalmente `onScrubTimeChange`. La logica NVR vive **solo nella pagina**, non nel timeline.

### 2. Modulo NVR Scrubbing (isolato)

Nuovo hook/context: `useNvrScrubController` o `NvrScrubBridge`

**Responsabilità:**
- Riceve `onScrubTimeChange` (realtime, ogni scroll) e `onScrubEnd` (tempo finale) dal timeline
- **Throttle 100 ms** sul seek backend durante scroll — max 1 seek ogni 100 ms
- Debounce avvio NVR (300 ms) quando non c’è ancora stream attivo
- Gestisce `seekRecordingStream` vs `getRecordingStreamMediaStream`
- Espone `playbackPositionEpochMs` **solo** per il cursore playback (linea cyan draggable), mai per l’etichetta del cursore scrub

**Posizione:** `src/hooks/use-nvr-scrub-controller.ts` o `src/components/CameraDetails/NvrScrubBridge.tsx`

La pagina camera details:
- Se `hasScrubSupport`: monta `NvrScrubBridge`, passa callbacks al timeline
- Se solo videoclips: nessun bridge, `onSeek` apre direttamente il clip

### 3. Modulo Videoclip-only (isolato)

Per camere senza NVR (solo `getVideoClips`):

- Timeline: `onSeek` → pagina apre VideoclipsListSection o gioca il clip
- Nessun scrub cursor, nessun `onScrubTimeChange`
- Cluster tap → ClusterDetailModal con "Play clip" se c’è videoclip URL

### 4. CameraDetailsPage: struttura semplificata

```
CameraDetailScreen
├── StreamBlock (CameraStreamPlayer + overlay)
├── TimelinePanel
│   ├── TimelineToolbar
│   ├── [VideoclipsListSection | DetectionTimeline]
│   └── NvrScrubBridge (solo se hasScrubSupport)
│       └── DetectionTimeline
```

**Stato timeline centralizzato in un hook:**

```ts
// useTimelineState.ts
function useTimelineState(options: {
  timelineRange: TimeRangeMs;
  minSpanMs: number;
  maxSpanMs: number;
  initialSpanMs?: number;
}) {
  const [visibleSpanMs, setVisibleSpanMs] = useState(...);
  const [visibleStartMs, setVisibleStartMs] = useState<number | null>(null);
  const [requestScrollToEndMs, setRequestScrollToEndMs] = useState<number | undefined>();
  const visibleRange = useMemo(...);
  const handleVisibleRangeChange = useCallback(...);
  const handleJumpToNow = useCallback(...);
  const handleZoomIn = useCallback(...);
  const handleZoomOut = useCallback(...);
  const handlePan = useCallback(...);
  return {
    visibleRange,
    fullRange: timelineRange,
    requestScrollToEndMs,
    onSyncComplete,
    handlers: { ... },
    showJumpToNow,
  };
}
```

La pagina usa `useTimelineState` e passa i valori al DetectionTimeline. Niente più `visibleStartMs`/`visibleSpanMs` sparsi.

### 5. DetectionTimeline interno: scomposizione

**Sottocomponenti:**

| Modulo | Responsabilità |
|--------|----------------|
| `TimelineScrollView` | Scroll verticale, calcolo visible range da scrollY, emit `onVisibleRangeChange` |
| `TimelineMotionBar` | Barra blu motion segments |
| `TimelineClusters` | Layout clusters (vertical/horizontal), ClusterCard, virtualizzazione |
| `TimelinePlayhead` | Cursore "now" (rosso) |
| `TimelineScrubCursor` | Cursore scrub (cyan) + label timestamp — **solo se scrubEnabled**. Label sempre da scrollY, mai da playbackPositionEpochMs |
| `TimelinePlaybackCursor` | Cursore playback (cyan) draggable — **solo se playbackPositionEpochMs** |
| `TimelineZoomOverlay` | Pulsanti zoom + jump to now |
| `ClusterDetailModal` | Già separato, resta invariato |

**Flusso scroll → eventi:**

```
ScrollView onScroll
  → calcola visibleEndMs da scrollY
  → onVisibleRangeChange({ start, end })
  → se scrubEnabled: onScrubTimeChange(scrubTimeMs)

ScrollView onScrollEnd (debounced 250ms)
  → se scrubEnabled: onSeek(scrubTimeMs, "scrub-end")
```

Tutta la logica `programmaticScrollRef`, `scrollToEndMs`, `onSyncComplete` resta **dentro** DetectionTimeline. La pagina passa solo `scrollToEndMs` e `onSyncComplete`; il timeline gestisce internamente quando fare scroll programmatico.

### 6. Specifiche esatte per lo scrubbing

**Requisiti obbligatori:**

| # | Requisito | Implementazione |
|---|-----------|-----------------|
| 1 | L’utente può scrollare sulla timeline | ScrollView verticale con `onScroll` / pan gesture orizzontale |
| 2 | L’orario mostrato si aggiorna in real-time senza alcun delay | `onScrubTimeChange(epochMs)` emesso **sincrono** a ogni evento scroll — nessun debounce/throttle sul timestamp |
| 3 | Durante lo scrubbing lo stream si aggiorna ogni 100 ms | Throttle del seek backend a 100 ms — al massimo un seek ogni 100 ms durante lo scroll |
| 4 | Mai aggiornare l’orario dall’esterno | Il tempo mostrato è **sempre** derivato dalla posizione di scroll. Mai usare `playbackPositionEpochMs` o polling NVR per l’etichetta del cursore scrub |
| 5 | Il tempo finale è quello su cui l’utente smette di scrollare | Alla fine dello scroll (`onScrubEnd`): tempo = posizione al rilascio. Quel valore resta fisso finché l’utente non scrolla di nuovo o non fa seek esplicito |

**Flusso dati:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│ DURANTE SCROLL (utente sta scrollando)                                   │
├─────────────────────────────────────────────────────────────────────────┤
│ • scrollY → timeFromScrollY(scrollY) → visibleEndMs                      │
│ • scrubTimeMs = visibleEndMs - scrubCursorPct * spanMs                   │
│                                                                          │
│ Display orario:  scrubTimeMs (ogni frame, zero delay)                     │
│ onScrubTimeChange(scrubTimeMs): chiamato ogni scroll (no throttle)       │
│                                                                          │
│ Backend seek:   THROTTLED 100ms — max 1 seek ogni 100ms                  │
│                 (NvrScrubBridge / useNvrScrubController)                   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ FINE SCROLL (onScrollEnd, debounced ~250ms)                               │
├─────────────────────────────────────────────────────────────────────────┤
│ • onScrubEnd(scrubTimeMs) → tempo finale = scrubTimeMs                    │
│ • Display orario: resta su scrubTimeMs (NON aggiornato da playback)       │
│ • Backend: seek definitivo a scrubTimeMs, avvio stream se non attivo     │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ DOPO SCRUB-END (utente ha smesso)                                        │
├─────────────────────────────────────────────────────────────────────────┤
│ • Display orario: FISSO al valore di scrub-end                           │
│ • playbackPositionEpochMs (polling NVR): usato SOLO per cursore playback  │
│   (linea cyan draggable), MAI per l’etichetta del cursore scrub          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Correzioni rispetto al codice attuale:**

1. **DetectionTimeline**: l’etichetta del cursore scrub deve usare **solo** `scrubTimeAtCursor` (derivato da scrollY). Rimuovere l’uso di `playbackPositionEpochMs` per `scrubCursorLabelEpoch`.
2. **NvrScrubBridge**: `onScrubTimeChange` → aggiorna display (se necessario) + throttle 100 ms per seek backend. `onScrubEnd` → seek definitivo.
3. **playbackPositionEpochMs**: usato solo per il cursore playback (linea cyan draggable), non per l’etichetta del cursore scrub.
4. **Scroll forzato**: solo il pulsante "Go to live" può chiamare setRequestScrollToEndMs. Nessun altro path (date picker, stop clip, return to now) deve forzare lo scroll.

### 7. Web vs iOS

- **DetectionTimeline**: unico componente RN, usa `Platform.OS === "web"` per:
  - `wheel` invece di pan gesture (horizontal)
  - `pointerEvents`
  - `onDragStart` prevent default su thumbnails

- **CameraDetailScreen**: layout già differenziato con `useIsDesktop`, `useIsMobileLandscape`, ecc. Nessun cambio architetturale.

- **NvrScrubBridge**: stesso comportamento web/iOS; eventuali differenze (es. WebRTC) restano nell’adapter.

---

## Piano di implementazione (fasi)

### Fase 1: Hook useTimelineState
- Creare `useTimelineState` con tutta la logica visibleRange/zoom/pan/jump
- Estrarre da CameraDetailScreen e GridTimelinePanel
- Test: comportamento invariato

### Fase 2: NvrScrubBridge
- Creare `NvrScrubBridge` (o hook `useNvrScrubController`)
- Spostare `handleScrubTimeChange`, `handleScrubEnd`, `handlePlaybackSeek`, `startNvrPlaybackFromScrubRef`
- La pagina passa solo `hasScrubSupport` e riceve `playbackPositionEpochMs` + callbacks per il timeline

### Fase 3: Semplificare props DetectionTimeline
- Introdurre `DetectionTimelineEvents` e ridurre props
- Unificare `onSeek` (cluster, playback-drag, scrub-end)
- Deprecare `onScrubTimeChange`/`onScrubEnd`/`onPlaybackSeek` in favore di `onSeek` + `onScrubTimeChange` (solo per cursor live)

### Fase 4: Scomposizione interna DetectionTimeline
- Estrarre `TimelineScrollView`, `TimelineMotionBar`, `TimelineClusters`, ecc.
- Ogni modulo in file separato
- DetectionTimeline diventa orchestratore sottile

### Fase 5: Unificare le due istanze in CameraDetailScreen
- Una sola definizione di props DetectionTimeline
- Parametri `compact` e `orientation` per main vs drawer
- Eliminare duplicazione

### Fase 6: Videoclips-only path
- Documentare il flusso: `!hasScrubSupport && hasVideoclips`
- Assicurarsi che `onSeek` con source `cluster` apra il clip senza toccare NVR

---

## File da creare/modificare

| Azione | File |
|--------|------|
| Crea | `src/hooks/use-timeline-state.ts` |
| Crea | `src/hooks/use-nvr-scrub-controller.ts` (o `NvrScrubBridge.tsx`) |
| Modifica | `src/components/DetectionTimeline/DetectionTimeline.tsx` — scomposizione |
| Crea | `src/components/DetectionTimeline/TimelineScrollView.tsx` |
| Crea | `src/components/DetectionTimeline/TimelineMotionBar.tsx` |
| Crea | `src/components/DetectionTimeline/TimelineClusters.tsx` |
| Crea | `src/components/DetectionTimeline/TimelineCursors.tsx` (playhead + scrub + playback) |
| Modifica | `app/(tabs)/cameras/[id].tsx` — usa hook, NvrScrubBridge, props semplificate |
| Modifica | `src/components/GridTimelinePanel.tsx` — usa useTimelineState |

---

## Casi d’uso: come intervenire

### Stream con scrubbing/playback (NVR)

1. **Abilitare scrub**: `scrubEnabled={hasScrubSupport}` (derivato da `adapter?.getRecordingStreamMediaStream`)
2. **Eventi**: `onScrubTimeChange`, `onSeek` → `NvrScrubBridge` → adapter
3. **Modifiche**: toccare solo `useNvrScrubController` e adapter, DetectionTimeline resta invariato

### Stream con videoclips solamente

1. **Disabilitare scrub**: `scrubEnabled={false}` (default)
2. **Eventi**: `onSeek` con source `cluster` → pagina apre clip via `getVideoClipUrl` / `videoclipHref`
3. **Modifiche**: toccare solo `handlePlayClip` e `getVideoclipForCluster`, nessun NvrScrubBridge

---

## Riepilogo benefici

- **DetectionTimeline**: ~50 props → ~25, logica scroll/scrub interna, eventi chiari
- **NVR isolato**: un solo modulo da modificare per scrubbing/playback
- **Videoclips-only**: path lineare, nessuna logica NVR
- **Pagina camera**: usa hook + bridge, meno stato e meno complessità
- **Manutenibilità**: responsabilità ben separate, facile test e debug
