# Workspace multi-camera su tablet — progettazione

Data: 2026-09-01 · stato: **progettazione, non implementato** · nessun codice di
produzione è stato scritto per questo documento.

Input obbligatorio: [`2026-09-01-persistent-player-host-design.md`](./2026-09-01-persistent-player-host-design.md)
(«host doc» d'ora in poi). Scritto stamattina senza conoscere questa richiesta;
§1 dice cosa ne resta in piedi.

Tocca (se approvato): `src/components/camera/theater/*`, `src/screens/GridViewScreen.tsx`,
`src/screens/CameraDetailScreen.tsx`, `src/grid/*`, `src/components/grid/*`,
`src/grid-embed/*`, `embed/src/embed/*`, e — per la Fase D — **il repo
`camstack-server`** (`packages/types/src/capabilities/{pipeline-analytics,recording}.cap.ts`).

---

## 0. Il fatto che riordina tutta la richiesta

L'operatore ha chiesto: *«analizza in fondo la griglia per capire come
riorganizzarla perché possa ospitare la timeline principale»*. La griglia va
riorganizzata molto meno di quanto sembra, perché **la timeline del theater
ospita già il video, non il contrario**.

`TheaterTimeline` renderizza `props.stream` — un `ReactNode` qualunque — nel
proprio slot di indice 1 (`TheaterTimeline.tsx:1593-1595`, geometria in
`stream-slot.ts:47-56`). `CameraDetailScreen` non disegna il video: costruisce
`streamBox` e lo passa come prop (`CameraDetailScreen.tsx:1628-1635`, *«The
screen no longer places the picture at all»*).

Quindi la domanda non è «come faccio entrare la timeline del theater nella
griglia», è: **cosa passo come `stream`**. Un box video → il player singolo di
oggi. Un muro di N celle → il workspace. Stessa timeline, stesso host, stesso
slot, zero riparenting.

Da qui discendono tre conseguenze che governano tutto il resto:

1. **P1 non è un lavoro di layout, è un lavoro di DATI.** La struttura per
   ospitare la timeline principale nella griglia esiste già. Ciò che manca è che
   la timeline sappia interrogare N camere invece di una.
2. **Il costo del layout si sposta tutto sul RESIZE** (§6), che su iPad non è
   nemmeno codice React Native: il muro su iOS è **una sola WebView**
   (`GridViewScreen.tsx:92`, `USE_EMBED = Platform.OS === 'ios' || 'web'`), e il
   suo protocollo oggi **non sa esprimere un rettangolo per cella**.
3. **Il workspace non è territorio dell'host persistente** — e questo è ciò che
   salva il tetto di 2 sessioni dell'host doc (§1.2).

Un secondo fatto verificato che conviene avere in testa: nel layout `wide` lo
spazio sotto lo stream **è già riservato e già vuoto**.
`wide-detail-sizes.ts:14-15`:

```ts
/** Il box stream non cresce oltre questa frazione dell'altezza viewport —
 *  ciò che resta sotto è l'info area (state strip + tabs, Phase 4). */
export const STREAM_MAX_HEIGHT_FRACTION = 0.62
```

Il ~38% inferiore della colonna sinistra è spazio deliberatamente lasciato
libero per una «Phase 4» mai spedita (lo spec citato,
`docs/2026-07-13-cam-view-web-wide-layout-spec.md`, **non esiste più nel repo**).
Le righe di snapshot chieste dall'operatore sono esattamente quella fase.

---

## 1. Cosa dell'host doc resta valido, punto per punto

| # | Affermazione dell'host doc | Stato |
| --- | --- | --- |
| 1.1 | §0/§2 — la «Fase 1 letterale» (host = solo video, la rotta si disegna sopra) è irrealizzabile per z-order, deep link a freddo e riparenting | **Valido, intatto.** Le tre ragioni non dipendono dal numero di video. |
| 1.2 | §3 — tetto di **2 sessioni** (una attached + una parked) | **Valido, ma solo grazie a una condizione che questa richiesta rende obbligatoria** (sotto). |
| 1.3 | §5 — «su iOS l'host serve **una sola superficie**: il player della camera singola; la griglia resta fuori» | **Valido e diventa portante.** È la regola che impedisce al workspace di moltiplicare le sessioni dell'host. Era una comodità, ora è un vincolo. |
| 1.4 | §2.5 — «la rotta pubblica **DIMENSIONI**, mai POSIZIONI» | **Valido e rafforzato.** Con celle ridimensionabili la tentazione di pubblicare rettangoli per cella all'host è precisamente il difetto di 1.0.265. |
| 1.5 | §2.5 — «il rettangolo video è già derivabile da quantità di finestra; l'unica misura è l'altezza della toolbar» | **Parzialmente invalidato.** In `wide` il box del muro non è più l'uscita di `computeWideDetailSizes`: è la colonna sinistra **meno l'altezza della reel di snapshot**. La regola tiene (è ancora una DIMENSIONE), la formula no: le misure da pubblicare diventano **due** (toolbar, reel). E il rettangolo della singola cella dentro il muro **non è derivabile da quantità di finestra**: viene dallo stato di layout. Non morde solo perché (1.3) l'host non vede mai le celle. |
| 1.6 | §1 — «`streamBox` è già una variabile passata per prop; il player ha già un solo genitore in ogni layout» | **Valido, ed è il fatto più prezioso del documento per questa richiesta.** È tutto il §0 qui sopra. |
| 1.7 | §7 D6 — «prima consegna: `stack` + `fill`; `wide` dopo» | **Invalidato come ordinamento.** Questa richiesta è **esclusivamente `wide`**. Non c'è conflitto tecnico (il workspace non usa l'host), ma c'è conflitto di attenzione: le due roadmap toccano lo stesso file `CameraDetailScreen.tsx`/`TheaterTimeline.tsx`. Vedi D8. |
| 1.8 | §7 D1(a) — «host = video + i 17 livelli sul video; la rotta pubblica i 7 che le appartengono» | **Valido per N=1.** Per N>1 i 17 livelli non si moltiplicano: nel muro sono le celle a disegnarli (`GridTile` su Android, la pagina embed su iOS), ed è un secondo inventario che non passa dall'host. |
| 1.9 | §6.1 — la domanda ★ (una WKWebView parcheggiata mantiene la PiP?) | **Intatta e ancora la prima da rispondere.** Nulla qui la tocca. |
| 1.10 | §5 — «`app/embed/` non esiste, il `CLAUDE.md` è obsoleto» | **Confermato** (l'albero `app/` è 18 file, nessuno sotto `embed/`). |

### La condizione che salva il tetto di 2 (1.2)

Il tetto di 2 sessioni regge **se e solo se la superficie video del workspace è
`GridLiveEmbed` (una WebView, N peer) e non N `LiveView`**. Verificato:

- su iOS/web il muro è già `GridLiveEmbed` — `GridViewScreen.tsx:92, 515-540`;
- `GridWall` → `GridTile` → `LiveView` è **solo Android**
  (`GridViewScreen.tsx:547-557`), dove il bug PiP non esiste.

Se invece il workspace montasse N `LiveView` su iOS per poterle posizionare
nativamente (§6, opzione scartata), il registro dell'host si troverebbe da 2 a
9 sessioni e il §3 dell'host doc andrebbe riscritto da capo. **Questo è il vero
punto di contatto fra i due progetti, ed è una decisione, non un dettaglio:
D9.**

---

## 2. P1 — la timeline della griglia deve diventare quella del theater

### 2.1 Cosa distingue oggi le due timeline

Non sono due versioni della stessa cosa: sono **due modelli diversi**.

| | A — theater (`src/components/camera/theater/`) | B — griglia (`GridTimeline.tsx` + `src/grid/timeline/`) |
| --- | --- | --- |
| Dimensione | ~17 200 righe, 66 file (+18 in `detail/`) | 552 righe + 550 in `src/grid/timeline/` |
| Asse | **verticale**, guidato dallo scroll | **orizzontale**, finestra fissa, guidato dal drag |
| Modello | tracce → **cluster** → schede | tracce → barre, **una corsia per camera** |
| Ancoraggio | qualunque giorno (`TimelineDatePanel`) | solo `now` (`makeGridTimelineWindow(nowMs, spanMs)`, `GridTimeline.tsx:140`) |

Diff di funzioni (A ha / B ha):

| Funzione | A | B |
| --- | --- | --- |
| Heatmap (`HeatmapBar.tsx`, 423 righe, bande di copertura + bin di densità + scrub proprio) | sì | **no** |
| Corsie attività (registrazione / movimento / audio, `ActivityLanes.tsx`) | sì | **no** (la «corsia» di B è una camera, non un tipo) |
| Cluster + schede (`event-cluster.ts`, `ClusterCard.tsx`, `ClusterFanOverlay.tsx`) | sì | **no** — il codice lo dice: *«the grid has lanes, not clusters»* (`GridTimeline.tsx:236`) |
| Filtro zona (`zone-filter.ts`, prefiltro server + client) | sì | **no** |
| Navigazione per data / calendario con pallini | sì | **no** |
| Barra di riproduzione completa (rate, jog, **step frame**, live-lock, cattura) | sì | **parziale**: play/pause + zoom ± |
| Scrub + seek | sì, due scrub indipendenti (`use-timeline-scrub.ts`, 583 righe; `heatmap-scrub.ts`) | sì, uno (`onResponderGrant/Move/Release`, `GridTimeline.tsx:213-277`) |
| Export (`TimelineExportPanel.tsx`) | sì | **no** |
| Pannelli (union di 12 `TimelinePanelKind`, `timeline-layout.ts:66-79`) incl. **PTZ**, devices, camera switcher, view options, capture | sì | **no** — sulla griglia PTZ e devices vivono in `GridCellPanelOverlay`, un modal centrato **non ancorato alla cella** (`GridCellPanelOverlay.tsx:197-215`) |
| Legenda, footer bar, clips mode, miniature evento | sì | **no** |
| Colorazione dei buchi di copertura **per corsia** | **no** | sì (`GridTimeline.tsx:435-452`) |

**Le tre voci che l'operatore ha nominato per la timebar** sono già tutte in A e
**tutte come pannelli del body**, non come barre separate:

- **PTZ** → `TimelinePanelKind = 'ptz'` (`timeline-layout.ts:72`), `TimelinePtzPanel.tsx`;
- **snapshot / recording** → `onSnapshot`/`snapshotBusy` (`TheaterTimeline.tsx:271-273`),
  `TimelineCapturePanel.tsx`, `capturing`/`onToggleCapture` (`:234-236`);
- **i devices** → `TimelineDevicesPanel` (`TimelineBodyPanel.tsx:238`).

Cioè: **l'adattamento della timebar chiesto dall'operatore non è "aggiungere
tre controlli a B", è "usare A", che li ha già.** Con una precisazione onesta:
tutti e tre sono **per-camera**, quindi in un workspace con N camere hanno
bisogno di sapere *su quale* agire — è la nozione di **camera primaria** (§4).

### 2.2 Il ponte che esiste già (e nessuno lo ha ancora attraversato)

Due seam sono già in repo, già testate, e **non usate**:

1. **`src/components/camera/theater/timeline-scope.ts`** — `initTimelineScope`,
   `toggleTimelineScope`, `reconcileTimelineScope`, `scopeQueryKey`,
   `unionDaySets`, `normalizeDeviceIds`. Il docblock dice testualmente:
   *«Camera-detail seeds `[deviceId]`. The grid seeds every wall camera.»*
   `grep -rn "timeline-scope" src/` trova **solo la sua spec** e un commento in
   `CameraSwitcherPanel.tsx:165`. `TimelineDeviceBinding.scopeIds`/`onToggleScope`
   esistono (`TimelineBodyPanel.tsx:97-98`) e `CameraDetailScreen.tsx:1558-1564`
   **non li passa**. Qualcuno ha già progettato questo e si è fermato.
2. **`src/grid/timeline/grid-playback-bus.ts`** — il fan-out fra UNA timeline e N
   superfici player. Il docblock: *«The sink shape is
   `recording/playback-machine.ts`'s `PlaybackControlSink` plus a transport rate,
   so … the seek path is the SAME one the single-camera timeline already
   drives — no second seeking implementation.»* È **l'adattatore che permette a
   `TheaterTimeline` di pilotare il muro senza sapere come è renderizzato** (embed
   iOS, iframe web, tile native Android).

Il lavoro di P1 lato transport è quindi: `TheaterTimeline` non parla più a
`liveRef`, parla al bus. Il bus esiste, la forma combacia per costruzione.

### 2.3 Quanto è accoppiata A a UN deviceId

`deviceId: number` è la prop #2 (`TheaterTimeline.tsx:159`) e appare in 13 punti.
Ma **il livello di rendering è già device-agnostico**:

- `HeatmapBar` (props `:45-61`), `ActivityLanes` (`:63-67`), `TimelineScroller`,
  `TimelinePlaybackBar`, `TimelineFooterBar`, `ClusterCard` (`:58-97`) — **nessuno
  riceve un `deviceId`**;
- `ObjectEvent` **porta già `deviceId`** (`event-cluster.ts:16`: *«the
  authorization subject of every media fetch»*), quindi un `PositionedCluster`
  con eventi di camere diverse è strutturalmente rappresentabile oggi;
- l'unico provider di A, `TimelineScaleProvider`, **non porta identità di
  device**: pubblica solo token di layout derivati dalla larghezza.

Il costo si concentra in due posti, e solo due:

**(a) quattro hook di dati** — `TheaterTimeline.tsx:574` (`useDaysWithRecordings`),
`:643` (`useDeviceTracks`), `:695` (`useTimelineActivity`), `:894`
(`useRecordingAvailability`).

**(b) l'union dei 12 pannelli** — `ptz`, `devices`, `cameraSwitcher`,
`captureActions`, `export`, `viewOptions` sono per costruzione mono-camera.
`TimelineExportPanel` chiama internamente `useRecordingAvailability(deviceId)` e
`useDeviceTracks(deviceId)` (`TimelineExportPanel.tsx:321-323`).

Per (b) la soluzione non è renderli multi-camera: è **legarli alla camera
primaria** (§4). Un export di N camere non è una funzione richiesta, e un PTZ di
N camere non ha senso.

### 2.4 «Batch» — cosa esiste davvero lato hub

Verificato leggendo gli schemi zod in
`camstack-server/packages/types/src/capabilities/`, non dedotto.

| Metodo | Input | Esiste il batch? |
| --- | --- | --- |
| `pipelineAnalytics.listTracks` (usato da A) | `{ deviceId: z.number(), since?, until?, limit?, zone?, projection? }` — `pipeline-analytics.cap.ts:1600-1613` | **no, singolare** |
| `pipelineAnalytics.listRecentTracks` (usato da B) | `{ deviceIds: z.array(z.number()), since?, until?, limit(max 1000), cursor?, projection?, includeStationary? }` — `:1104-1122` | **sì** — merge k-vie lato server su `(lastSeen DESC, trackId)`, paginato a cursore. **Nessun campo `zone`.** |
| `pipelineAnalytics.getKeyEventsBatch` | `{ deviceIds: z.array(z.number()).min(1).max(200), since, until, limit (PER CAMERA), minImportance?, classFilter? }` — `:1181-1191`, registrato `:1724`; risposta `[{ deviceId, events: KeyEvent[] }]` (`:1203-1206`) | **sì, e nessuna delle due timeline lo usa** |
| `pipelineAnalytics.listEventKindsBatch` | `{ deviceIds: …min(1).max(200) }` — `:1673` | **sì**, già usato da `useEventKinds` |
| **`pipelineAnalytics.getEventDensity`** — la sorgente dei bin della **heatmap** | `{ deviceId, since, until, bucketMs }` — `:1732-1738` | **NO.** `grep getEventDensityBatch` su tutti i `*.cap.ts`: zero. |
| **`recording.getAvailability`** — le **bande di copertura** della heatmap e la corsia registrazione | `{ deviceId, fromMs, toMs }` — `recording.cap.ts:345-349` | **NO.** `grep getAvailabilityBatch`: zero. |
| **`recording.getDaysWithRecordings`** — i pallini del calendario | `{ deviceId, fromMs, toMs, tzOffsetMinutes }` — `:353-362` | **NO** |
| `snapshot.getSnapshotOverview` | `{ deviceIds: …min(1).max(200) }` — `snapshot.cap.ts:107` | **sì**, già usato app-wide |

**Quindi «batch per heatmap e timeline» si spezza in due metà con costi
incomparabili:**

- **Timeline (tracce, cluster, schede): il batch esiste già.** Nessun lavoro
  hub. Si passa da `listTracks({deviceId})` a `listRecentTracks({deviceIds})` o
  `getKeyEventsBatch({deviceIds})`. Due perdite da mettere in conto:
  1. **il prefiltro zona lato server sparisce** (`listRecentTracks` non ha
     `zone`), quindi in modalità multi-camera il filtro zona resta solo
     client-side (`filterEventsByZone`, `TheaterTimeline.tsx:815`) o si disattiva;
  2. **la camminata storica infinita cambia forma** — A usa `useInfiniteQuery`
     con `collectTrackPages`/`TRACKS_MAX_ROWS` su `listTracks`;
     `listRecentTracks` è a cursore ma con una semantica di limite diversa
     («per camera» vs «totale»). Va riprogettata la paginazione, non solo
     sostituito il metodo.
- **Heatmap (densità + copertura + giorni): il batch NON esiste.** Tre metodi
  singolari. Due strade, ed è la decisione D2:
  - **fan-out N query** con la disciplina che B ha già: `useQueries`, tetto
    `COVERAGE_FANOUT_MAX = 12` (`use-grid-timeline-events.ts:75, 235`), e sopra
    il tetto **si rifiuta il livello e lo si dichiara** (`noCoverage`
    nell'header). Zero lavoro hub, degrado onesto, ma su 12 camere sono 36
    query per finestra temporale;
  - **tre nuovi metodi hub** (`getEventDensityBatch`,
    `recording.getAvailabilityBatch`, `recording.getDaysWithRecordingsBatch`).
    Poco codice, **molta catena**: `*.cap.ts` → `npm run codegen` → typecheck →
    build → `camstack deploy` di due addon → OTA viewer. È l'unica parte del
    progetto che vive **in un altro repo**.

> `use-grid-timeline-events.ts:26-35` documenta già questa esatta lacuna e chiede
> letteralmente `getAvailabilityBatch({ deviceIds })`. Non è una mia invenzione.

### 2.5 Come si riorganizza la griglia per ospitare la timeline principale

Molto meno di quanto la domanda suggerisce. Oggi:

```
GridViewScreen                                  # misura `content` con onLayout
├─ <View styles.content onLayout={setBox}>      # :467-475
│   └─ GridLiveEmbed | GridWall                 # :515 / :547
├─ <GridTimeline cameras placement/>            # :566  ← fratello, non figlio
└─ GridCellPanelOverlay, GridShareDialog
```

Domani:

```
GridViewScreen
└─ <TheaterTimeline
       layoutMode={'wide' | 'stack' | 'fill'}
       railWidth={…}
       scopeIds={wallCameras.map(c => c.id)}    # ← P1
       primaryId={…}                            # ← §4
       stream={<GridLiveEmbed|GridWall …/>}     # ← lo slot indice 1
       …binding di playback via grid-playback-bus
   />
```

Le tre cose che `GridViewScreen` deve **cedere**:

1. **La divisione dello spazio.** Oggi la fa lei (`box` da `onLayout`, meno
   `GRID_TIMELINE_HEIGHT`/`gridTimelineSideWidth`) e ricalcola
   `computeGridLayout` sul residuo (`:381-384`). Domani lo slot le consegna un
   box e lei ci mette dentro il muro. `streamSlotStyle('wide')` è
   `{flex:1, minWidth:0, alignItems:'center'}` — il muro deve solo misurarsi in
   quel box. **Attenzione**: `stream-slot.ts` documenta che uno slot senza box
   esplicito ha misurato `900×0`; un muro dentro `wide` ha bisogno di
   `alignSelf: 'stretch'` o di un box esplicito, non di ereditare
   `alignItems: 'center'`. È una modifica a `stream-slot.ts`, non al muro.
2. **La collocazione della timeline.** `gridTimelinePlacement` (`bottom`/`right`)
   e `gridTimelineSideWidth`/`gridTimelineBottomHeight` diventano ridondanti:
   `DetailLayoutMode` risponde già alla stessa domanda con tre forme invece di
   due, ed è **la stessa funzione pura che decide la forma del theater** —
   che è il punto: le due superfici smettono di rispondere in modo diverso alla
   stessa domanda. `grid-timeline-gate.ts` sopravvive solo per
   `GRID_TIMELINE_MIN_SIDE` (che comunque è già `TABLET_MIN_SIDE` riesportato).
3. **La chrome.** `GridViewScreen` oggi non ha `ScreenHeader` ed è full-bleed
   (`:14-15`). Adottando `TheaterTimeline` eredita `TimelineToolbarInline`.
   Quella è la barra che la promozione di `GridControlBar` (§3.2) deve
   **raggiungere**, non duplicare.

Le due cose che **non** cambiano e vanno protette:

- `computeAutoLayout` resta l'autorità sulla geometria del muro. Il muro non
  diventa figlio della timeline «logicamente», solo fisicamente: continua a
  ricevere un box e a risolvere da sé.
- `GridCellPanelOverlay` resta finché i pannelli per-cella non migrano nella
  union di `TimelinePanelKind`. Migrarli è desiderabile (unifica PTZ/devices/view
  options in un solo posto) ma **non è nel percorso critico** e va tenuto fuori
  dalla prima consegna.

---

## 3. P2 e P3 — le due cause trovate nel codice

### 3.1 P2 — il pulsante camere con 2+ selezionate

**Non apre un modal.** Verificato: il picker è il pannello `'cameraSwitcher'`,
che prende il *body* della timeline (`use-timeline-panels.ts:63-66`,
`resolveTimelineBody` in `timeline-layout.ts:128-130`, layer assoluto
`TheaterTimeline.tsx:1505-1506` + `styles.panelLayer` `:1652-1659`).
`TimelinePanelHost.tsx` non importa `Modal`. In `wide` sta nel rail destro.

Ciò che l'operatore percepisce come «modal» è **la destinazione**:

```ts
// CameraDetailScreen.tsx:708-716
const onOpenAdhocGrid = useCallback(
  (ids: readonly number[]) => {
    router.push(`/grid/adhoc?devices=${serializeAdhocDeviceIds(ids)}`)
  },
  [router],
)
```

`push` (non `replace`) verso una rotta il cui gruppo `(app)` è presentato
`containedTransparentModal` con `freezeOnBlur: false` (`app/(app)/_layout.tsx`):
il player resta montato sotto, e la griglia arriva **sopra** come una carta.
`app/(app)/grid/adhoc.tsx:17` disabilita pure il gesto (`gestureEnabled: false`).
Legge come un modal perché *si comporta* come un modal.

Per confronto, una camera sola:

```ts
// CameraDetailScreen.tsx:697-707
if (id !== deviceId) router.replace(`/camera/${id}`)
```

**Il fix di P2 non è cambiare `push` in `replace`.** È **non navigare affatto**:
con 2+ selezionate, il pannello scrive nello stato di workspace (§4) e la stessa
rotta `/camera/[id]` si ridisegna con il muro nello slot. La rotta `/grid/adhoc`
resta come **URL condivisibile / deep link** — parsing e serializzazione sono già
puri e già testati (`src/grid/adhoc-devices.ts`) — ma non è più il percorso di
interazione.

Effetto collaterale da notare: oggi `app/(app)/camera/[id].tsx:37` monta
`<CameraDetailScreen key={deviceId}>`. Aggiungere camere al workspace **non deve
toccare `deviceId`**, altrimenti ogni «add to view» rimonta la schermata. Ecco
perché lo stato del workspace non può essere un parametro di rotta (§4).

### 3.2 P3 — su tablet la timeline «comincia a stare sotto»

Causa trovata, ed è già stata affrontata una volta a metà.

`layoutMode` è puro e non può diventare stale:
`CameraDetailScreen.tsx:822-829` → `resolveDetailLayoutMode` →
`shouldUseWideDetail` (`sidebar-rules.ts:126-133`):

```ts
export function shouldUseWideDetail(input: ViewportInput): boolean {
  if (isTabletViewport(input) && isLandscapeViewport(input)) return true
  return input.isWeb && input.width >= DETAIL_WIDE_MIN_WIDTH
}
```

Escluse (verificate): nessun `Dimensions.get` a scope di modulo (l'unico è
dentro `use-responsive.ts:36`), nessun `useState(() => …)` che semini la
decisione, nessun `expo-device`/`Platform.isPad`, e `onLayout` non alimenta
`layoutMode`. **Quindi cade a `stack` solo quando la finestra riporta davvero
portrait.** E qualcosa gliela fa riportare portrait:

```ts
// GridViewScreen.tsx:218-227
useEffect(() => {
  void ScreenOrientation.unlockAsync()
  return () => {
    if (shouldRestorePortraitLock(screenMinSide)) {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
      return
    }
    void ScreenOrientation.unlockAsync()
  }
}, [screenMinSide])
```

`ScreenOrientation.lockAsync` è **app-wide**. Il commit `bdb2323` ha aggiunto la
guardia `shouldRestorePortraitLock`, e il suo docblock
(`sidebar-rules.ts:135-148`) descrive esattamente il sintomo dell'operatore. Ma
la guardia ha **due buchi residui**, entrambi verificati:

1. `shouldRestorePortraitLock(undefined) === true` (`:149-152`) e
   `useScreenMinSide()` ritorna `undefined` su web (`use-responsive.ts:34`).
   **Sul viewer web servito dall'hub la guardia non si applica affatto.**
2. **Nessuno ri-asserisce `unlockAsync()` quando il theater torna in primo
   piano.** L'unico unlock è `CameraDetailScreen.tsx:1103-1111` con dep array
   `[fullscreen]`. La schermata resta montata attraverso il push/pop
   (`freezeOnBlur: false`), quindi l'effetto non rigira: **un lock rimasto
   appeso resta appeso finché non si rientra nella rotta camera.** Che è
   letteralmente «comincia a stare sotto» e ci resta.

Due difetti minori trovati nello stesso giro, da riportare ma non da confondere
con la causa:

- **`containerWidth` è `null` sul primo frame** dopo ogni mount navigato
  (`CameraDetailScreen.tsx:838-853`): il fallback `winWidth` non sottrae la
  `SideNavRail` (72pt piena / 56pt compatta, `SideNavRail.tsx:89`), quindi su un
  iPad da 1194pt il primo frame calcola rail 380 e quello assestato 340
  (`RAIL_NARROW_BELOW = 1180`). **Salto di layout visibile subito dopo la
  navigazione, ma non ribalta `wide`→`stack`.**
- **Due sorgenti diverse per «c'è spazio»**: `layoutMode` chiede al *dispositivo*
  (`screenMinSide`), la rail che la stessa schermata disegna chiede alla
  *finestra* (`shouldShowSidebar`, `sidebar-rules.ts:108-113`). Su iPad landscape
  con tastiera aperta `layoutMode` resta `wide` ma la rail sparisce →
  `containerWidth` salta di 72pt → il rail della timeline oscilla 340↔380. Il
  docblock lo dichiara deliberato; resta il secondo posto dove un numero di
  finestra guida la geometria del dettaglio.

**Il fix di P3** (tre righe di intento, non di codice):
(1) ri-asserire `unlockAsync()` quando la rotta camera torna in focus, non solo
al mount — `useFocusEffect`, oppure spostare l'autorità dell'orientamento in un
solo posto app-wide; (2) far ritornare `false` a `shouldRestorePortraitLock` su
web, dove non c'è lock da ripristinare; (3) seminare `containerWidth` con
`winWidth − railWidth` invece che con `winWidth`.
**Nota**: se il workspace toglie la navigazione verso `/grid/adhoc` (P2), il
percorso che innesca il difetto sparisce — ma il difetto no: resta raggiungibile
da `/grid/[id]`. Va corretto comunque, e va corretto **per primo** (§7 Fase A),
perché l'intera funzione vive in `wide`.

---

## 4. Il modello di stato

### Cosa deve sopravvivere, e a cosa

| Dato | Chi lo possiede | Sopravvive a… |
| --- | --- | --- |
| `primaryId` — la camera «corrente» (PTZ, export, snapshot, capture agiscono su lei) | workspace store | tutto tranne la chiusura del workspace |
| `members` — l'ordine delle camere in vista | workspace store | navigazione, rotazione, cambio primaria |
| `cells` — i delta di geometria per cella (§6) | workspace store, chiave = `deviceId` | come sopra |
| `scopeIds` — le camere che la timeline aggrega | **derivato** da `members` via `reconcileTimelineScope` | — |

**Raccomandazione: uno store Zustand di sessione, `useWorkspaceStore`, NON
persistito su AsyncStorage.** Motivi, in ordine:

1. **Deve sopravvivere a `key={deviceId}`.** `app/(app)/camera/[id].tsx:37`
   rimonta l'intera schermata al cambio camera. Uno `useState` nella schermata
   morirebbe a ogni «goTo», che è precisamente l'interazione che l'operatore
   vuole senza attriti. Uno store fuori dall'albero no.
2. **Non deve essere un parametro di rotta.** Un `?devices=` che cambia a ogni
   «add to view» è churn di URL, e — peggio — invita a rimontare.
   `serializeAdhocDeviceIds` resta per la **condivisione** e per il deep link,
   in ingresso e in uscita, non come stato vivo.
3. **Non deve essere persistito.** Un workspace ritrovato al lancio successivo è
   un muro di 6 stream che nessuno ha chiesto in quel momento. `grid-store.ts`
   persiste le griglie *salvate*, ed è la cosa giusta per quelle; il workspace è
   effimero per natura (come `adhocGrid`, che oggi vive in `useState` locale —
   `GridViewScreen.tsx:123-127`). Se l'operatore vuole tenerlo, la strada è
   «Salva come griglia» → `grid-store`, riusando ciò che esiste.

### Cosa succede aprendo una camera singola mentre il workspace è popolato

Tre semantiche possibili per «goTo» su uno snapshot, e vanno decise (D5):

- **(a) goTo = cambia la primaria, il workspace resta.** Il muro non cambia
  membri; cambia solo su chi agiscono PTZ/export/capture e su chi è la cella
  «grande». Nessuna navigazione, nessun remount.
- **(b) goTo = esci dal workspace verso quella camera sola.** Il workspace viene
  svuotato. È la semantica di `onSwitchCamera` di oggi (`router.replace`).
- **(c) goTo naviga ma il workspace sopravvive nello store**, e tornare indietro
  lo ripristina.

**Raccomando (a) quando il workspace ha 2+ membri, (b) quando ne ha uno.** Con
2+ membri la camera è già a schermo: navigare via per vederla è un passo
indietro. Con un solo membro «goTo» è esattamente lo switch di oggi e non c'è
ragione di cambiarlo. La regola è esprimibile in una funzione pura e testabile
per valore.

### Il ciclo di vita, in una riga

Il workspace si **svuota** quando la rotta camera esce dallo stack (non quando
perde il focus — un push sopra deve poter tornare indietro), oppure su richiesta
esplicita («chiudi vista»). Un membro che sparisce dalle camere note viene
riconciliato via `reconcileTimelineScope`, che **non lascia mai lo scope vuoto** —
comportamento già scritto e già testato.

---

## 5. La barra dei controlli — estrarre, ristilizzare, promuovere

L'operatore ha già deciso: si estrae quella della griglia, non se ne inventa una.
Ecco cosa si estrae davvero.

**`GridControlBar.tsx` non è una barra.** È una lista di descrittori (~110
righe, **zero stato**, `:9-10`) che compone il vero componente,
`FloatingControlBar`. I suoi 11 controlli (`:123-231`): pause di massa, audio
(popover con riga «muta tutto» + una riga per camera), qualità, layout,
timeline, menu (`GridMenuPanel`), activeOnly, share, edit, più back e titolo dal
frame. 23 prop (`:36-73`), tutte fornite inline da `GridViewScreen`, che
splicia lo **stesso elemento** in tre rami (`:511`, `:541`, `:558`).

**Tutta la chrome che va cambiata sta in `FloatingControlBar`, non in
`GridControlBar`** — e `FloatingControlBar` è **condivisa con
`StreamControlBar`**. Questo è il vincolo che decide come si fa l'estrazione.

| | `FloatingControlBar` (ciò che la griglia indossa) | `ScreenHeader` | `TimelineToolbarInline` (il theater) |
| --- | --- | --- | --- |
| posizione | `absolute, bottom: SPACING.lg, alignSelf:'center'` (`:245-247`) | in-flow, in alto | in-flow, `borderBottomWidth:1` |
| forma | pillola `RADIUS.xl`, `maxWidth:'96%'` (`:253-255`) | full-bleed | full-bleed |
| sfondo | `colors.surface` opaco | **BlurView** `intensity=50` + tinta alfa | `colors.background` opaco |
| ombra | `shadowOpacity 0.4, radius 8, elevation 6` (`:256-260`) | nessuna | nessuna |
| safe area | **nessuna** | `insets.top + SPACING.sm` — *«the single place srcV2 applies the top inset»* | nessuna (superficie annidata) |
| dimensioni | costanti statiche `SPACING`/`RADIUS` | statiche | **scale-aware**, `useTimelineScale()` |
| comportamento | **si auto-collassa dopo `AUTO_HIDE_MS = 4500`** in una maniglia 56×28 | sempre visibile | sempre visibile |

**Promuoverla a top bar significa quindi quattro cose concrete:** adottare
`insets.top`, perdere l'auto-hide, perdere pillola+ombra, e passare ai token
scalati di `useTimelineScale()` — cioè **diventare `TimelineToolbarInline`**.

Da cui la forma dell'estrazione che raccomando, e che rispetta il vincolo
`FloatingControlBar` condivisa:

- si estrae **il descrittore**, non il frame: da `GridControlBar` esce un modulo
  puro `workspace-bar-items.ts` che, dati stato e callback, ritorna la lista di
  voci. Testabile per valore, ed è la parte che l'operatore vuole conservare;
- il frame diventa `TimelineToolbarInline`, che è già la top bar dell'app in
  `stack` e già in-flow in `wide`;
- `FloatingControlBar` **non si tocca**: `StreamControlBar` continua a usarla
  identica. Se in seguito la griglia non ne ha più bisogno, muore da sé.

⚠️ Trappola dei safe-area insets, già pagata in questo repo: `ScreenHeader` è
l'unico posto che applica l'inset superiore, e alcune liste lo montano **vuote e
senza titolo solo per quello**. Avvolgere una schermata che lo fa in una nuova
shell **raddoppia l'inset**. `GridViewScreen` **non** ha `ScreenHeader`
(`:14-15`), quindi qui il rischio non si presenta — ma va riverificato se la
promozione tocca altre schermate.

---

## 6. Il resize — e perché è la fase più cara

### 6.1 Cosa fa `auto-layout` oggi

`computeAutoLayout(n, contentW, contentH, aspect = 16/9)` cerca fra i soli
**split canonici** (`rows` da 1 a n, `cols = ceil(n/rows)`, scartando i non
canonici — `auto-layout.ts:90-97`) quello che massimizza l'area di cella:

```ts
const cellW = Math.min(w / cols, (h / rows) * aspect)
const cellH = cellW / aspect
```

Uscita: `{cols, rows, cellW, cellH, wallW, wallH}` — **una sola dimensione di
cella per tutte, nessun `x`/`y` da nessuna parte.** Lo spazio avanzato non
diventa mai gap fra celle: è un **bordo nero centrato** attorno al blocco
(`GridWall.tsx:110-117`, *«the ONLY place leftover space is allowed to live»*).
Il difetto storico — `flexWrap` che distribuiva l'avanzo *fra* due camere
verticali — è documentato e pinnato dalla spec (`auto-layout.spec.ts:91-102`).

Il rapporto 16:9 è un parametro con default, **ma nessun chiamante lo passa mai**
(`GridViewScreen.tsx:382` chiama con 4 argomenti) ed è **hardcoded nel mirror
dell'embed** (`embed/src/embed/grid-layout.ts:32`). È **per-muro, mai per-cella**.

Gesture esistenti sul muro vivo: **nessuna** oltre a un `Pressable` per rivelare
i controlli (`GridTile.tsx:290-295`). Il riordino esiste **solo nel builder**
(`DraggableFlatList` su righe leggere — `GridManageList.tsx:8-9`, e `@dnd-kit` sul
web), deliberatamente su righe che **non** sono tile vive, così nessun peer
WebRTC si rimonta durante il drag. `GridViewScreen.tsx:16-17` lo dichiara:
*«there is no separate reorder mode»*.

Geometria persistita per cella: **nessuna.** `Grid` è
`{id, name, cameraIds: readonly number[], hiddenCameraIds?, options?, highlight?, audioOnIds?}`
(`grid-store.ts:155-172`); **l'ordine nell'array È l'unica geometria**
(`:152-154`).

### 6.2 Il muro non è React Native, dove serve

Questo è il punto che riordina la fase.

- **iOS e web**: il muro è **una `GridLiveEmbed`**, una WebView, N peer
  (`GridViewScreen.tsx:92`). RN non può posizionare una cella dentro di essa.
- Il protocollo host→pagina è `{devices: number[], layout: 'auto' | number}`
  (`embed-config.ts:94-114`) più comandi caldi (`setQuality`, `setLayout`,
  `setShowName`, `setHighlight`, `setActiveOnly`, `setShowBoxes`, `setOverlays`,
  `setAudioOn`, `setPaused` — `GridLiveEmbed.tsx:187-224`).
- **Non esiste alcun comando host→pagina che porti un rettangolo.** I `TileRect`
  esistono ma viaggiano **pagina→host** (`embed-messages.ts:14-19, 25-32`), per
  ancorare overlay nativi, e il messaggio `'layout'` è **un no-op**
  (`GridLiveEmbed.tsx:307-310`).
- **Peggio: cambiare l'insieme dei device rimonta la WebView.**
  `GridLiveEmbed.tsx:117-133`: *«there is NO runtime "set devices" command in the
  grid protocol — so when the grid is EDITED … we must REMOUNT the WebView»*,
  via `key={devicesKey}` (`:349`).

**Conseguenza diretta sulla funzione richiesta:** su iPad, oggi, ogni «add to
view» **ricarica la pagina embed e rinegozia tutti i peer**. Non è un dettaglio
di performance: è la differenza fra «la camera scivola dentro» e «lo schermo
sbianca e riparte». Serve un comando `setDevices` a caldo, ed è **lavoro
sull'artefatto embed**, non sul viewer.

**Opzione scartata, con la ragione:** montare N `GridLiveEmbed` con
`devices=[id]` così che RN possieda i rettangoli nativamente. Scartata perché è
esattamente ciò che `USE_EMBED` esiste per evitare (N WebView, N boot SPA), e
perché farebbe passare il registro dell'host da 2 sessioni a N — invalidando §3
dell'host doc (§1.2, decisione D9).

### 6.3 Come estendere `auto-layout` senza romperlo

**Non toccare `computeAutoLayout`.** È una funzione pura, ottimale, pinnata da
una spec che riderivа gli split canonici dalla definizione. Va **stratificata**:

```
computeAutoLayout(n, w, h)        →  la geometria di default (nessuno ha toccato niente)
      ↓
applyWorkspaceSpans(auto, spans)  →  la geometria con i delta dell'operatore
```

Il modello di delta che raccomando è **a span discreti**, non a rettangoli
liberi:

- `computeAutoLayout` produce una griglia `cols × rows` di **track** di
  dimensione `cellW × cellH`;
- una cella può occupare `cw × ch` track (default `1 × 1`);
- il resize trascina il bordo e fa scattare `cw`/`ch` di un track alla volta;
- lo spostamento è un cambio di indice/posizione nella stessa griglia di track;
- l'insieme dei delta è `Record<deviceId, {cw, ch, at?}>` — piccolo,
  serializzabile, versionabile, e **vuoto significa esattamente il
  comportamento di oggi**, bit per bit. Nessuna regressione per le griglie
  esistenti, e la spec di `auto-layout` continua a passare senza modifiche.

Cosa succede alle altre celle quando una cresce — tre politiche, e la
raccomandazione:

| Politica | Comportamento | Giudizio |
| --- | --- | --- |
| **Compattazione** (stile `react-grid-layout`) | le celle rifluiscono attorno, la griglia si ricompatta verso l'alto | Familiare, ma **un drag può far ballare tutto il muro**: su superfici video vive è disorientante e ogni riflusso è un `fit()` per ogni tile |
| **A somma zero** | il vicino cede esattamente quanto la cella guadagna, entro riga/colonna | Prevedibile, nessuna cascata, ma esprime solo split — non «una cella grande e tre piccole attorno» |
| **Span + riflusso locale** | la cella occupa più track; le altre riempiono i track liberi nell'ordine dell'array, esattamente come oggi | **Raccomandata.** Riusa `splitIntoRows` e la regola del blocco centrato, l'effetto è locale e prevedibile, e il delta persistito è minuscolo |

**Il video dentro la cella.** L'operatore è stato esplicito: cella libera, video
adattato dentro con le proprie proporzioni, bande dove avanza, nessun taglio.
Questo **rompe l'invariante centrale di oggi**, `cellH = cellW / aspect`: la
cella era 16:9 e il video la riempiva. Con span `2×1` la cella è 32:9 e il video
va inscritto con bande laterali. Va cambiato:

- su Android, `GridTile.tsx:217` (`{width, height}`) più il fit del player;
- **sulla pagina embed**, `EmbedGridPage.tsx:356-369` più il mirror
  `embed/src/embed/grid-layout.ts` (che oggi non ha nemmeno un parametro
  `aspect`).

E questa parte serve **comunque**, con qualunque politica: anche gli span
producono celle non-16:9.

### 6.4 La catena di spedizione del resize

Perché sia chiaro dove sta il costo — questa fase **non è OTA-only**:

1. viewer: modello di span, gesture, `GridWall` con celle libere;
2. **artefatto embed**: nuovi campi/comandi (`setDevices`, `setSpans`),
   rendering della cella libera con letterbox;
3. `npm run sync:embed` (produce `assets/embed/camstack-embed.html` per l'OTA
   nativo e `public/embed/` per web/iframe);
4. `npm run update:patch` (OTA);
5. `npm run build:orchestrator` + `camstack deploy packages/addon-pipeline-orchestrator`
   dal repo server, per l'iframe ospitato;
6. pin del submodulo + push.

Quattro artefatti indipendenti che devono restare in fase. È la ragione
principale per cui il resize è **l'ultima** fase e non la prima.

---

## 7. La soglia «medi+»

**Raccomandazione: la soglia esiste già, ed è `layoutMode === 'wide'`.** Non
introdurre un quinto «tablet».

`shouldUseWideDetail` (`sidebar-rules.ts:126-133`) risponde: tablet in landscape
(chiesto al **dispositivo** via `screenMinSide >= TABLET_MIN_SIDE = 768`, con
l'**orientamento** letto dalla finestra), oppure finestra web `>= 1000pt`. È già
tarata dall'operatore: il 2026-08-08, dopo l'OTA 1.0.263, l'allargamento ai
telefoni landscape è stato **revocato su sua richiesta**, e il docblock dice di
non reintrodurlo senza di lui (`detail-layout.ts:36-45`).

**Cosa vede un telefono: esattamente quello che vede oggi.** In `stack` e in
`fill` il workspace non esiste: nessuna reel, nessun muro nello slot, il pulsante
camere continua a fare `push` su `/grid/adhoc` come adesso. Questo è
verificabile per valore, ed è la garanzia che la richiesta chiede
esplicitamente.

**Un tablet in portrait è `stack`, non `wide`** — quindi con questa soglia non
ha il workspace. È corretto? Lo spazio vuoto del 38% è dimostrabilmente in
`wide` (`STREAM_MAX_HEIGHT_FRACTION`); in `stack` quello spazio ce l'ha già la
timeline. Ma un iPad in portrait ha comunque molto spazio. È D6.

Inventario delle soglie esistenti, perché non se ne aggiungano di nuove:

| Costante | Valore | File | Domanda |
| --- | --- | --- | --- |
| `TABLET_MIN_SIDE` | 768 | `hooks/sidebar-rules.ts:34` | «è un tablet» (lato corto) |
| `WEB_SIDEBAR_MIN_WIDTH` | 900 | `:38` | sidebar persistente su web |
| `DETAIL_WIDE_MIN_WIDTH` | 1000 | `:43` | camera-detail `wide` su web |
| `GRID_TIMELINE_MIN_SIDE` | = 768 | `grid/timeline/grid-timeline-gate.ts:22` | riusa, non compete |
| `GRID_TIMELINE_MIN_HEIGHT` | 480 | `:78` | seconda metà dello stesso gate |
| `RAIL_NARROW_BELOW` | 1180 | `camera-detail/wide-detail-sizes.ts:19` | rail 340 vs 380 |
| `TABLET_WIDE_MIN` | **700** | `hooks/use-responsive.ts:86` | **famiglia concorrente** (colonne griglia camere) |
| `DESKTOP_MIN` | **1100** | `:87` | **famiglia concorrente** |
| `winW >= 900` | 900 | `components/camera/FloatingControlBar.tsx:64` | **letterale sciolto**, nessuna costante |

Non esiste `isTablet()`, né `expo-device`, né `Platform.isPad` da nessuna parte.
`sidebar-rules.ts` è l'autorità intesa; le altre due famiglie sono debito.

---

## 8. Le fasi

Ognuna spedibile da sola. **Non sono livellate, e la differenza è grossa** —
vedi il riquadro alla fine.

### Fase A — l'orientamento smette di sporcare il layout (P3)
Solo viewer, piccola. Ri-asserire `unlockAsync` al focus della rotta camera,
correggere `shouldRestorePortraitLock` su web, seminare `containerWidth` con
`winWidth − railWidth`. **Valore proprio:** il difetto che l'operatore vede oggi
sparisce, indipendentemente da tutto il resto. **Prerequisito di tutto**: l'intera
funzione vive in `wide`.

### Fase B — la barra promossa a top bar
Solo viewer, media. Estrarre `workspace-bar-items.ts` puro da `GridControlBar`,
montarlo dentro `TimelineToolbarInline`, non toccare `FloatingControlBar`.
**Valore proprio:** la griglia smette di avere chrome estranea allo stile
dell'app e smette di auto-nascondersi.

### Fase C — la timeline del theater aggrega N camere (P1, metà viewer)
Solo viewer, **grande**. Cablare `timeline-scope.ts` (esiste, è morta), passare
tracce/cluster a `listRecentTracks`/`getKeyEventsBatch`, legare i 12 pannelli
alla camera primaria, sostituire `GridTimeline` con `TheaterTimeline` in
`GridViewScreen` passando `stream={<muro>}` e cablando `grid-playback-bus`.
Heatmap/copertura/giorni con fan-out N e la disciplina del tetto 12 già scritta,
che **degrada dichiarandolo**. **Valore proprio:** la griglia guadagna cluster,
heatmap (per le camere che stanno nel tetto), calendario, export, PTZ, filtri —
una timeline sola in tutta l'app.

### Fase D — il batch vero per la heatmap ⚠️ **altro repo**
`camstack-server`, poco codice, **molta catena**: `getEventDensityBatch`,
`recording.getAvailabilityBatch`, `recording.getDaysWithRecordingsBatch` →
`npm run codegen` → typecheck → build → `camstack deploy` di due addon → OTA
viewer. **Valore proprio:** il tetto di 12 camere sparisce e la heatmap smette
di essere un fan-out. **Indipendente da C**: C funziona senza, con il degrado
dichiarato.

### Fase E — le righe di snapshot sotto lo stream
Viewer, media. Riempire il 38% riservato in `wide` con una reel scorrevole di
`CameraCard`, due pulsanti per snapshot (**goTo**, **add to view**). Riusa
`SnapshotOverviewProvider` (una sola poll per tutta l'app, montata in
`app/(app)/_layout.tsx`) e **deve dichiarare la propria domanda a
`snapshot-viewport.ts`**, la cui regola è sottrattiva: una superficie che non
riporta si comporta come prima, ma una che riporta male spegne frame altrui.
**Valore proprio:** navigazione fra camere senza lasciare il player. Con N=1
membri, «add to view» può restare disabilitato e la fase è comunque utile.

### Fase F — 2+ camere costruiscono il muro nello slot (P2)
Viewer + **artefatto embed**. `useWorkspaceStore`, il pannello camere scrive
invece di navigare, lo slot ospita il muro, la reel si riduce a una riga.
Richiede il comando embed `setDevices` a caldo, altrimenti ogni «add» ricarica
la pagina. **Valore proprio:** la funzione principale, senza resize.

### Fase G — resize e spostamento delle celle
Viewer + **artefatto embed**, **la più grande**. Modello a span, gesture sul
muro, celle libere con video inscritto e bande, nuovi campi di protocollo,
`sync:embed` + `build:orchestrator` + deploy. **Valore proprio:** solo se F è
spedita.

> **Dove sta il costo, detto senza livellare.** Le fasi non sono comparabili.
> **C è ~3–4 volte A+B+E messe insieme** (17 000 righe di superficie theater da
> aprire a N device, 12 pannelli da rilegare, la paginazione storica da
> riprogettare). **G è la seconda più grande e la sola che tocca quattro
> artefatti** che devono restare in fase. **D è minuscola in codice e grande in
> coordinamento**, ed è l'unica che non si spedisce con un OTA. Se ne va spedita
> una sola: **A**. Se se ne vanno spedite tre: **A, B, E** — tutta la parte
> visibile all'operatore, zero rischio sulla sessione video.

---

## 9. Cosa i test non possono dire

Il repo copre bene per valore (`npm run test:v2`, vitest; `npm run test:embed`
per la pagina; jsdom + `src/testing/mount.tsx` per montare le schermate;
`npx tsc --noEmit` con il gate su `^(src|app)/.*error TS` a zero):

- `applyWorkspaceSpans` e la politica di riflusso, per valore;
- lo store di workspace (aggiunta, rimozione, cambio primaria, riconciliazione
  con `reconcileTimelineScope`);
- la regola goTo/add-to-view come funzione pura;
- `scopeQueryKey`/`unionDaySets` (già coperti);
- la soglia «medi+»: che con input da telefono il workspace non esista mai —
  questa **va scritta come guardia**, perché è la garanzia esplicita della
  richiesta;
- una source-guard spec che assicuri che il pannello camere con 2+ selezionate
  **non** chiami `router.push`;
- il degrado dichiarato della heatmap oltre il tetto 12.

**Non verificabile lì, e va provato sul dispositivo:**

1. **★ Che un `TheaterTimeline` con `stream = <muro>` non collassi lo slot.**
   `stream-slot.ts` porta la cicatrice di uno slot misurato **900×0** perché il
   suo unico figlio era fuori flusso. Il muro dentro `wide` eredita
   `alignItems: 'center'`: da verificare a occhio, non per test.
2. **Il costo reale di N peer WebRTC su una sola WebView su iPad** con
   heatmap + fan-out di copertura in corso. Instruments, non vitest.
3. **Se `setDevices` a caldo evita davvero la rinegoziazione**, o se la pagina
   ricostruisce comunque il proprio stato. Solo sul dispositivo.
4. **Fedeltà geometrica sulle transizioni** — rotazione, apertura pannello,
   entrata/uscita `fill`, drag di una cella durante uno scrub. È dove 1.0.263 e
   1.0.265 si sono rotti.
5. **Che la gesture di resize non mangi lo scrub della timeline né il tap di
   rivelazione dei controlli** (`GridTile.tsx:290-295`). Conflitti di gesture non
   si deducono.
6. **Che la reel di snapshot non spenga frame di altre superfici** via
   `snapshot-viewport.ts` (regola sottrattiva: un report sbagliato è silenzioso).
7. **Che il fix di P3 tenga anche con Split View / Stage Manager**:
   `app.config.ts:31` ha `supportsTablet: true` e **nessun `requireFullScreen`**,
   quindi iPadOS può consegnare una finestra portrait su dispositivo landscape —
   e in quel caso `stack` è **corretto**, non un bug. Va distinto a mano.
8. **Il consumo di memoria del workspace con 6–9 camere + heatmap batch.**

Vincolo da rispettare scrivendo il codice: `no-in-app-pip.spec.ts` fallisce sul
primo simbolo `pipWindow`/`PipRect`/`inAppPip`/`enterInAppPip`. Il modello di
geometria del workspace non deve usare quei nomi.

---

## 10. Decisioni per l'operatore

### D1 — Su quale rotta vive il workspace
- **(a) Una sola shell, due rotte.** `TheaterTimeline` diventa la shell del
  workspace; `/camera/[id]` e `/grid/[id]` la montano entrambe, cambiando solo
  cosa passano come `stream` e come `scopeIds`.
- (b) Solo `/camera/[id]`; la griglia resta com'è con la sua timeline.
- (c) Solo `/grid/*`; dal player si continua a navigare.

→ **Raccomando (a).** È l'unica che soddisfa insieme P1 («la griglia ospiti la
timeline principale») e la funzione («dal player si costruisce la vista»), e
costa meno di (b)+(c) fatte separatamente perché le due timeline smettono di
esistere in doppia copia.

### D2 — La heatmap in modalità multi-camera · **la decisione che decide se si tocca l'altro repo**
- (a) **Fan-out N query** con il tetto 12 già scritto; sopra il tetto il livello
  copertura si rifiuta e lo dichiara. Zero lavoro hub.
- (b) **Tre nuovi metodi batch sull'hub** (`getEventDensityBatch`,
  `getAvailabilityBatch`, `getDaysWithRecordingsBatch`), poi la heatmap è un
  batch vero.
- (c) La heatmap in multi-camera mostra **solo la camera primaria**, e le altre
  compaiono solo nelle corsie eventi.

→ **Raccomando (a) per la Fase C e (b) come Fase D separata.** (a) spedisce
subito con un degrado onesto e già progettato altrove nel repo; (b) è poco
codice ma è **l'unica parte in un altro repo con una catena di deploy propria**,
e non deve bloccare il resto. (c) è più economica ma mente all'operatore: una
heatmap che dice «poco traffico» guardando una camera su sei è peggio di una che
dice «non lo so per queste sei».

### D3 — Il modello di geometria del resize
- (a) **Span discreti** su una griglia di track derivata da `computeAutoLayout`
  (`{cw, ch}` per cella, default `1×1`, vuoto = comportamento di oggi).
- (b) **Rettangoli liberi** in unità frazionarie, con compattazione.
- (c) **A somma zero** entro riga/colonna.

→ **Raccomando (a).** Riusa `splitIntoRows` e la regola del blocco centrato,
il delta persistito è minuscolo, il default è **bit-identico** a oggi (nessuna
regressione, la spec esistente non si tocca), e produce comunque celle
non-16:9 — quindi soddisfa «cella libera, video inscritto con bande» senza il
costo di (b). (b) è la vera libertà ma è anche il modello che rende ogni drag un
riflusso globale su superfici video vive.

### D4 — Il comando embed `setDevices` a caldo
- (a) **Aggiungerlo** al protocollo; «add to view» diventa istantaneo.
- (b) Non aggiungerlo; ogni aggiunta rimonta la WebView e rinegozia tutti i peer.

→ **Raccomando (a), ed è il prerequisito tecnico della Fase F.** Senza, la
funzione principale si presenta come un ricaricamento di pagina a ogni camera
aggiunta, che è esattamente il contrario di ciò che l'operatore ha chiesto.
Verificato: `GridLiveEmbed.tsx:117-133`, `key={devicesKey}`.

### D5 — Semantica di «goTo» con il workspace popolato
- (a) Cambia la **primaria**, il muro resta.
- (b) **Esce** dal workspace verso quella camera sola.
- (c) Naviga ma il workspace sopravvive nello store e tornare indietro lo
  ripristina.

→ **Raccomando la regola mista: (a) con 2+ membri, (b) con un membro solo.**
Con il muro popolato la camera è già visibile e navigare via è un passo
indietro; con un membro solo «goTo» è lo switch di oggi e non va cambiato.

### D6 — Tablet in **portrait**
- (a) **Niente workspace** in portrait: la soglia è `layoutMode === 'wide'`.
- (b) Workspace anche in portrait (`isTabletViewport`, entrambe le
  orientazioni), con la reel sotto la timeline invece che sotto lo stream.

→ **Raccomando (a) per la prima consegna.** Lo spazio vuoto è dimostrabile solo
in `wide` (`STREAM_MAX_HEIGHT_FRACTION = 0.62`); in `stack` quello spazio ce l'ha
già la timeline, e prenderglielo è una decisione di layout diversa che merita di
essere vista prima di essere presa. (b) resta apribile dopo, senza rilavorare
nulla: la soglia è una funzione pura in un solo posto.

### D7 — La persistenza del workspace
- (a) **Effimero**: store di sessione, non persistito. «Salva come griglia»
  esporta in `grid-store`.
- (b) Persistito su AsyncStorage e ripristinato al lancio.

→ **Raccomando (a).** (b) riapre l'app su 6 stream che nessuno ha chiesto in
quel momento, e duplica una funzione (le griglie salvate) che esiste già ed è
già esportabile/condivisibile.

### D8 — Sequenziamento rispetto all'host persistente
- (a) **Prima l'host** (`stack`+`fill`, la sua D6(c)), poi il workspace.
- (b) **Prima il workspace** (`wide`), poi l'host.
- (c) In parallelo, su rami separati.

→ **Raccomando (b).** L'host doc ha una domanda ★ ancora aperta (la PiP
sopravvive al parking?) che, se risponde male, ne riapre il progetto: le sue
fasi non sono ancora eseguibili. Il workspace non ha una domanda equivalente e
le sue fasi A/B/E sono spedibili subito. (c) è da escludere: entrambi toccano
`CameraDetailScreen.tsx` e `TheaterTimeline.tsx`, i due file più grandi e più
cicatrizzati del repo.

### D9 — Chi possiede il video del workspace · **il punto di contatto coi due progetti**
- (a) **`GridLiveEmbed`**, una WebView e N peer, come già fa la griglia su
  iOS/web. Il registro dell'host resta a **2 sessioni** e non vede mai il muro.
- (b) N `LiveView` posizionate nativamente da RN, così il resize è puro React
  Native e non serve toccare l'embed.

→ **Raccomando (a), con forza.** (b) renderebbe il resize molto più facile e
sarebbe **la scelta sbagliata per tutto il resto**: N WebView, N boot SPA — che
è precisamente ciò che `USE_EMBED` esiste per evitare — e il registro dell'host
passerebbe da 2 a N sessioni, invalidando §3 dell'host doc appena approvato. La
facilità di (b) si paga su memoria, avvio e su un progetto già approvato.

---

## Riepilogo dei fatti verificati in questo documento

- `TheaterTimeline` ospita già il player come prop `stream` in uno slot esplicito
  (`TheaterTimeline.tsx:1593-1595`, `stream-slot.ts:47-56`); la schermata «non
  colloca più l'immagine» (`CameraDetailScreen.tsx:1628-1635`).
- Nel layout `wide` il ~38% sotto lo stream è **riservato e vuoto**
  (`STREAM_MAX_HEIGHT_FRACTION = 0.62`, `wide-detail-sizes.ts:14-15`); lo spec
  che lo prevedeva non esiste più nel repo.
- `timeline-scope.ts` esiste, è completo, è testato e **non è usato da nessuno**
  (`grep -rn "timeline-scope" src/` → solo la sua spec).
- `grid-playback-bus.ts` è **già** la stessa forma di `PlaybackControlSink` che
  la timeline del theater pilota.
- Batch che **esistono**: `listRecentTracks`, `getKeyEventsBatch`,
  `listEventKindsBatch`, `snapshot.getSnapshotOverview`.
- Batch che **non esistono**: `getEventDensity`, `recording.getAvailability`,
  `recording.getDaysWithRecordings` — le tre sorgenti della heatmap.
- Il pannello camere **non è un modal** (`timeline-layout.ts:128-130`); ciò che
  legge come modal è `router.push('/grid/adhoc?devices=…')`
  (`CameraDetailScreen.tsx:708-716`) su un gruppo `containedTransparentModal`.
- P3: `ScreenOrientation.lockAsync` è app-wide; `shouldRestorePortraitLock`
  ritorna `true` su web (`screenMinSide === undefined`) e **nessuno ri-asserisce
  `unlockAsync` al ritorno del theater** (dep array `[fullscreen]`,
  `CameraDetailScreen.tsx:1103-1111`).
- `computeAutoLayout` produce **una sola dimensione di cella**, nessun `x`/`y`;
  l'avanzo è sempre un bordo nero centrato (`GridWall.tsx:110-117`).
- Una griglia salvata memorizza **solo `cameraIds`**: l'ordine è l'unica
  geometria (`grid-store.ts:152-172`).
- Sul muro vivo **non esiste alcuna gesture** di drag/resize; il riordino è solo
  nel builder, su righe non-vive, di proposito.
- Il protocollo embed **non sa esprimere un rettangolo per cella**, e cambiare
  l'insieme dei device **rimonta la WebView** (`GridLiveEmbed.tsx:117-133`).
- `GridControlBar` è una lista di descrittori senza stato; tutta la chrome da
  cambiare è in `FloatingControlBar`, **condivisa con `StreamControlBar`**.
- La soglia «medi+» esiste già ed è `shouldUseWideDetail`
  (`sidebar-rules.ts:126-133`), tarata dall'operatore il 2026-08-08.

Affermazioni **non** verificate, marcate come ipotesi: che il muro dentro lo slot
`wide` si misuri correttamente senza modificare `stream-slot.ts` (§9.1); che un
`setDevices` a caldo eviti davvero la rinegoziazione dei peer (§9.3, D4); che
`listRecentTracks` accetti un `zone` non dichiarato nello schema (§2.4); che
`getKeyEventsBatch` sia una sorgente migliore di `listRecentTracks` per i cluster
— ho letto entrambi gli schemi ma non ho confrontato `KeyEventSchema` campo per
campo con `ObjectEvent`; e i costi relativi delle fasi in §8, che sono una stima
da conteggio di righe e di superficie, non una misura.
