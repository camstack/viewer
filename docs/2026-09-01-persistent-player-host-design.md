# Player host persistente — progettazione

Data: 2026-09-01 · stato: **ARCHIVIATO — l'ipotesi centrale è stata misurata ed
è FALSA** (vedi «Verdetto» qui sotto) · nessun codice di produzione è stato
scritto per questo documento, e l'esperimento che lo ha smentito è stato
cancellato dopo aver risposto.

Tocca (se approvato): `src/screens/CameraDetailScreen.tsx`,
`src/components/camera/theater/TheaterTimeline.tsx`,
`src/components/camera/theater/stream-slot.ts`, `app/(app)/_layout.tsx`,
e un nuovo `src/live/host/`.

Diagnosi di partenza (chiusa, confermata sul dispositivo): lo swipe verso il
basso porta la sessione in PiP di sistema e poi naviga; la navigazione smonta
la rotta, la rotta smonta `LiveViewWebView`, la WKWebView viene rilasciata e la
finestra PiP muore con lei. L'esperimento di controllo — il pulsante PiP, stessa
richiesta senza navigazione — mantiene la finestra.

---

## Verdetto misurato sul dispositivo — 2026-09-01

**L'ipotesi di §6.1, quella su cui poggia tutto questo documento, è SMENTITA.**
Una WKWebView parcheggiata — montata, impaginata, fuori schermo — **non**
mantiene la finestra PiP.

L'esperimento (`resolveSwipeTerminalEffect` / `parkedStyle`, dietro un flag
spento) faceva lo stesso swipe cambiando solo l'ULTIMO effetto: parcheggiare
invece di navigare. Tre cicli identici, letti dalla traccia che viaggia già
(`live:pip`, `live:lifecycle`, entrambi in `ALWAYS_SHIP_SCOPES`):

```
.889  system PiP request answered   → active: true
.891  player PARKED off screen — probe armed
.902  swipe handoff settled          → terminal: park
+7,1s presentation mode changed      → INLINE
```

**Il fatto che decide la lettura** sta nel secondo ciclo: `inline` (584686)
precede `player torn down` (589304) di **4,6 secondi**. La PiP non muore per lo
smontaggio della WebView — muore **da sola, con la WebView ancora montata**. E i
sette secondi sono il profilo di un *throttling*, non di una deallocazione.

### La conseguenza, detta in una riga

**L'asse non è «montata o smontata»: è «visibile o no».** Una WebView
parcheggiata fuori schermo resta montata, ma iOS la considera non visibile,
WebKit la strozza, il `<video>` si ferma e la PiP esce. È coerente col controllo
già noto: dal PULSANTE la PiP funziona, perché lì l'operatore resta sulla
schermata e il video è visibile.

Quindi un host che tiene il player **fuori dalla rotta** non risolve niente: il
problema non era la rotta. Tutto ciò che segue in questo documento — le
posizioni P1–P4, i 17 livelli, il registro delle sessioni, il tetto, lo sfratto
— resta un'analisi corretta di un problema DIVERSO (la rinegoziazione della
sessione a ogni uscita dal player, §4), ma **non è una cura per la PiP**.

### Le strade che restano, e sono due

1. **PiP solo dal pulsante.** È ciò che funziona oggi, senza scrivere una riga.
   Lo swipe continua a tentare la PiP e poi a navigare — comportamento
   invariato, decisione dell'operatore — e semplicemente non sopravvive alla
   navigazione.
2. **Un player NATIVO con `AVPictureInPictureController`.** È l'unica strada che
   fa funzionare la PiP navigando via, perché la finestra PiP smette di essere
   una proprietà della visibilità di una WKWebView e diventa un oggetto di
   sistema che l'app possiede. Costo reale: il player singolo su iOS oggi è
   l'embed WebView (`useWebViewPlayer = Platform.OS === 'ios'`), quindi è un
   secondo percorso di riproduzione, non una modifica di questo.

Una terza strada che NON esiste: tenere la WebView montata e invisibile in
qualunque forma (opacity, offset, 1×1). Sono tutte lo stesso stato agli occhi di
WebKit, ed è quello appena misurato.

### Addendum 2026-09-06 — lo swipe è diventato il pulsante

Presa la strada 1, con una correzione: lo swipe verso il basso **non naviga
più**. Chiede la PiP di sistema esattamente come il disco e la schermata resta
montata (`src/screens/camera-detail/pip-handoff.ts`, `swipe-to-pip.ts`). La
richiesta dell'operatore — «PiP e app in background» — ha una seconda metà che
iOS non concede a un'app (nessuna API pubblica per mandarsi in background;
`canStartPictureInPictureAutomaticallyFromInline` è di un player nativo, non di
un `<video>` in WKWebView): la sequenza onesta è swipe → PiP → Home premuto
dall'operatore. Aperto, da misurare sul dispositivo con `live:pip` /
`live:lifecycle`: se WebKit tiene viva una PiP alimentata da MediaStream quando
l'app va in background (`UIBackgroundModes: ["audio"]` è presente).

---

## 0. Verdetto sulla Fase 1, in testa

**La Fase 1 nella forma letterale in cui è stata posta — "l'host possiede SOLO
la superficie video, la rotta continua a possedere tutta la sua chrome e si
disegna sopra" — non è realizzabile.** Non per una difficoltà, per tre fatti
del codice che si sommano (§2 li dimostra uno per uno):

1. **Ordine di impilamento.** Perché la rotta si disegni *sopra* l'host, l'host
   deve stare *sotto* la rotta. Le uniche due posizioni possibili nell'albero
   sono sopra `<Stack>` (e allora è l'host a coprire la chrome) o sotto
   `<Stack>` (e allora è invisibile: la schermata dei tab dipinge
   `backgroundColor: colors.background`, `src/navigation/TabsNavigator.tsx:55`).
2. **La terza posizione — dentro la schermata dei tab, fra il contenuto dei tab
   e il modal contenuto della camera — è l'unica geometricamente giusta, ed è
   esclusa da un fatto già registrato**: su deep link a freddo verso
   `/camera/<id>` la rotta `(tabs)` **non è nello stack**
   (`src/navigation/back-to-cameras.ts`, il fallback di `POP_TO`). Un host
   ospitato lì non esiste sul tap di una notifica: nessun player.
3. **Il riparenting resta il muro.** Qualunque schema in cui il video "passa"
   dalla rotta all'host quando serve è un cambio di posizione nell'albero
   riconciliato, cioè un remount, cioè esattamente ciò che uccide la sessione.

**Quello che invece è realizzabile, ed è la Fase 1 che raccomando**, conserva la
*proprietà* che l'operatore vuole preservare e sposta solo la *posizione di
render*:

> L'host è l'**unico** che monta `LiveView`, dal primo istante, e monta anche i
> livelli disegnati SUL video. La rotta continua a possedere lo stato, a scrivere
> i gestori e a comporre gli elementi; li **pubblica** all'host invece di
> renderizzarli in loco. Fuori dal rettangolo video non cambia nulla: timeline,
> toolbar, pannelli, tab restano dove sono, di proprietà della rotta.

Questa Fase 1 risolve entrambe le cose che interessano: la PiP sopravvive (§3) e
la sessione non si rinegozia più a ogni uscita dal player (§4).

Il costo reale rispetto alla Fase 1 immaginata è **17 elementi di chrome
sul video** che cambiano posizione di render (§1). Non sono 17 riscritture: 9 su
17 non hanno alcuna dipendenza dalla rotta e si spostano invariati.

---

## 1. Inventario di cosa sta attorno al video, oggi

Tutto vive dentro `streamBox` in `CameraDetailScreen.tsx:1290-1540`. `streamBox`
**non è renderizzato dalla schermata**: è una variabile passata come prop
`stream` a `TheaterTimeline`, che lo mette nel proprio slot
(`TheaterTimeline.tsx:1593`, `stream-slot.ts`). Questo è già oggi il motivo per
cui il player ha **un solo genitore in ogni layout** — è il risultato di due
fallimenti registrati (1.0.263 e 1.0.265) ed è il fatto più importante di questa
sezione: **la struttura da spostare è già isolata e già passata per prop.**

### Contenitore e trasformata

| Livello | File / riga | Cosa fa |
| --- | --- | --- |
| `Animated.View` esterno (la SCATOLA) | `CameraDetailScreen.tsx:1290` | altezza animata `boxAnimStyle` = `liveBoxHeight` (shared value derivato da `fill`, `pinchExpandsHeight`, `zoom.scale`) |
| `View styles.videoContent` | `:1301` | il FRAME: origine dei livelli assoluti |
| `Animated.View` interno (lo ZOOM) | `:1314` | `videoCoverStyle` (posizione+dimensione assolute) **+** `zoom.videoStyle` (transform pinch/pan) |

`videoCoverStyle` e `liveBoxHeight` sono già calcolati **da quantità di
finestra** (`winWidth`, `winHeight`, `fill`, `isWideDetail`, `wideSizes`), non da
una misura di layout. Torna utile in §2.

### I 17 elementi, per dipendenza

**A — dentro la trasformata di zoom** (scalano e traslano in blocco col video;
devono stare nello stesso albero del video, non sono negoziabili):

| # | Elemento | Stato che consuma | Origine dello stato |
| --- | --- | --- | --- |
| 1 | `LiveView` | `deviceId`, `target`, `muted`, `showStats`, `highlight`, `initialSeekMs` + 5 callback + `ref` | rotta |
| 2 | `MotionRegionsOverlay` | `deviceId`, `enabled` | **hook proprio** (`useMotionRegions`) |
| 3 | `MotionBoxesOverlay` | `deviceId`, `enabled` | **hook proprio** (`useDetections`) |
| 4 | `StationaryBoxesOverlay` | `deviceId`, `enabled` | **hook proprio** |
| 5 | `DiscardedBoxesOverlay` | `deviceId`, `enabled` | **hook proprio** |

I quattro overlay 2-5 si auto-misurano con il proprio `onLayout` e si
auto-alimentano per `deviceId`: l'unico input dalla rotta è un booleano derivato
da `overlay.*` + `liveOverlaysVisible`.

**B — fratelli sopra la trasformata**, assoluti rispetto al FRAME (dipendono dal
rettangolo video ma non dallo zoom):

| # | Elemento | Dipende dalla geometria? | Stato che consuma | Origine |
| --- | --- | --- | --- | --- |
| 6 | `GestureDetector` + catcher `absoluteFill` (`zoom.onLayout`) | **sì, critica** — è la superficie di misura del clamp di pan | `videoGesture` (tap/doppio-tap/pinch/pan/swipe-back) | rotta |
| 7 | `AudioLevelMeter` | ancorato al frame | `position` + `onSetPosition` | store overlay |
| 8 | `ZoneActiveOverlay` | **sì** — proietta 0..1 sul box mostrato | `timelineZone` | **rotta** (condiviso con la timeline) |
| 9 | scheda gap "nessuna registrazione" | riempie il frame | `playback.state.mode` | **rotta** (playback machine) |
| 10 | bordo highlight nativo | riempie il frame | `highlightType`, `settings.highlight` | store — **mai su iOS** (`!useWebViewPlayer`) |
| 11 | `nameTag` | angolo | `controlsVisible`, `name`, `online` | rotta + query |
| 12 | `DoorbellBadge` | angolo | `deviceId`, `enabled` | **hook proprio** |
| 13 | `OccupancyBadge` | angolo | `deviceId`, `enabled`, `corner` | **hook proprio** |
| 14 | `OverlayReadouts` | angoli | `deviceId`, `config`, `enabled` | **hook proprio** + store overlay |
| 15 | `StreamStatsOverlay` | angolo | `getStats` (via `liveRef`) | rotta — **mai su iOS** |
| 16 | `StreamOverlayControls` | riempie il frame, `box-none` | `visible`, `paused`, `muted`, `talking`, `fullscreen`, `edgePad`, `timelineToggle` + 6 handler | **rotta**, densamente |
| 17 | `ZoneDrawOverlay` | **sì** — deriva geometria dal box | `timelineZone`, `onConfirm`, `onCancel` | **rotta** |

**Conteggio che decide il costo della Fase 1:** si spostano senza toccarli
2, 3, 4, 5, 7, 12, 13, 14 e — su iOS — 10 e 15 non esistono. Hanno bisogno di un
canale dalla rotta: 1, 6, 8, 9, 11, 16, 17. **Sette.**

### Il riquadro ridimensionabile legato alla timeline

Non è un overlay: è l'altezza della scatola (`liveBoxHeight`), pilotata dal
drag handle **e** dal pinch (`zoom.scale`), con tetto `maxHeight`. La timeline
occupa ciò che resta. Quindi la scatola è un valore **condiviso** fra il video
(che la usa come dimensione) e la timeline (che la usa come spazio residuo). È
la ragione per cui le shared value non possono restare private della rotta —
vedi §2.4.

### Una incoerenza trovata strada facendo (non parte del fix)

`useWebViewPlayer = Platform.OS === 'ios'` (`CameraDetailScreen.tsx:192`), ma
`src/live/LiveView.tsx` renderizza `LiveViewWebView` **su ogni piattaforma
nativa**. Su Android il player singolo è quindi una WebView mentre la schermata
crede sia il player nativo: disegna il bordo highlight nativo (#10) e
`StreamStatsOverlay` (#15) sopra una WebView, e non passa `highlight` all'embed.
Da decidere a parte; qui conta solo perché l'inventario su Android ha 17 voci
attive invece di 15.

---

## 2. Verifica della Fase 1 — perché non nella forma letterale

### 2.1 Le posizioni possibili per l'host, e cosa copre ciascuna

L'host deve stare dentro `ConnectionProvider` (il player usa `useLiveHubUrl`,
che legge `useConnection` — `src/connection/use-live-hub-url.ts`), montato una
volta sola, fuori da qualunque rotta.

| Posizione | Sopra/sotto | Esito |
| --- | --- | --- |
| **P1** `RootProviders`, prima di `{children}` | sotto tutto | **Invisibile.** È esattamente dove vive `EmbedWarmup` (1×1, opacity 0, off-screen). Coperto dalla schermata tab opaca. |
| **P2** `RootProviders`, dopo `{children}` | sopra tutto | Fuori da `ConnectionProvider` (che sta in `app/(app)/_layout.tsx`). Servirebbe alzare il provider. |
| **P3** `app/(app)/_layout.tsx`, fratello dopo `<Stack>` | sopra tutte le rotte `(app)` | **Praticabile.** Dentro `ConnectionProvider`, `SnapshotOverviewProvider`, tema, i18n, query client, safe-area. |
| **P4** dentro la schermata `(tabs)`, assoluto | fra contenuto tab e modal camera | Geometricamente **l'unica** che permetterebbe la Fase 1 letterale. **Esclusa** — vedi 2.3. |

### 2.2 Perché P3 (l'unica praticabile) esclude "la rotta si disegna sopra"

Con l'host fratello **dopo** `<Stack>`, l'host è sopra ogni rotta. Tutto ciò che
la rotta disegna nel rettangolo video finisce **sotto** il video. Non è
recuperabile con `zIndex`: `zIndex` ordina solo fratelli dello stesso genitore, e
qui i genitori sono alberi diversi. Non è recuperabile con `elevation` (Android)
né con una `UIWindow` separata (iOS): una finestra a livello inferiore è coperta
dalla finestra chiave opaca dell'app, una superiore ricrea lo stesso problema più
un modulo nativo.

Risultato: con P3, **i 17 elementi devono stare nell'host**. Ipotesi non
verificata che vale la pena scrivere: non ho provato su dispositivo che una
`View` assoluta fratello dello `<Stack>` componga sopra un `RNSScreen`; lo dò
per certo dal modello di composizione RN, ma è nella lista §6.

### 2.3 Perché P4 — il "buco trasparente" — è esclusa

L'idea: host dentro la schermata tab, assoluto sopra il contenuto dei tab; la
schermata camera lascia un buco trasparente sul rettangolo video; il video
traspare, la chrome della rotta resta sopra. Ordine corretto, Fase 1 letterale.
La rotta camera è già `presentation: "containedTransparentModal"` con
`contentStyle: { backgroundColor: "transparent" }` (`app/(app)/camera/[id].tsx`)
e i tab sotto restano montati (`freezeOnBlur: false`). Sulla carta funziona.

Tre motivi per cui non regge:

1. **Deep link a freddo.** `back-to-cameras.ts` documenta che su un tap di
   notifica verso `/camera/<id>` la rotta `(tabs)` **non è nello stack**. L'host
   non esisterebbe. Servirebbe un secondo host di riserva, cioè due proprietari
   della sessione, cioè nessun proprietario.
2. **Il buco va scavato.** Oggi dipingono opaco sia la root della schermata
   (`backgroundColor: colors.background`, `:1619`) sia il container di
   `TheaterTimeline` (`transparent ? 'transparent' : colors.background`,
   `:1574`). Renderli trasparenti sulla verticale dello slot espone la lista
   camere sotto in ogni stato transitorio (rotazione, apertura pannello,
   modalità `fill`).
3. **Non elimina il problema, lo sposta.** L'host vive nella schermata tab; un
   `POP_TO` che rimonta o sostituisce quella schermata riporta la stessa morte
   della PiP, in modo intermittente.

### 2.4 Il muro del riparenting, detto con precisione

L'affermazione "RN non può riparentare una view video montata senza rimontarla"
(docblock di `CameraDetailScreen`) è vera e non aggirabile. **Il design la evita
non riparentando mai:** l'host è l'unico a montare `LiveView`, dalla prima
apertura camera fino allo sfratto. La rotta non ne monta mai una. Quando la
rotta si smonta, per la WebView non succede niente — non era sua.

Corollario obbligatorio: **le shared value dell'immagine** (`scale`, `tx`, `ty`,
`liveBoxHeight`) devono essere create dove le vedono entrambi gli alberi. Oggi
`useStreamZoom` è chiamato nella rotta (`:902`) e la rotta ne deriva l'altezza
scatola che la timeline consuma come spazio residuo. Nel design vivono
nell'host store (oggetti stabili: nessun re-render aggiuntivo), e la rotta le
legge per il proprio spaziatore.

### 2.5 La lezione di 1.0.265, e come non ripeterla

1.0.265 fallì perché pubblicava una **posizione** letta da `onLayout`, che è
relativa al genitore: l'host atterrò un'altezza di header troppo in alto. La
regola che ne esce è netta e la adotto come vincolo di progetto:

> **La rotta pubblica DIMENSIONI, mai POSIZIONI.** Una dimensione da `onLayout`
> è indipendente dal genitore; una posizione no.

E infatti il rettangolo video è già derivabile quasi tutto da quantità di
finestra:

- `fill` → `{0, 0, winWidth, winHeight}`. Nessuna misura.
- `wide` → `streamWidth`/`streamHeight` da `computeWideDetailSizes` (funzione
  pura di `containerWidth`, `viewportHeight`); origine x = `winWidth −
  containerWidth` (larghezza della `SideNavRail`, una **dimensione**).
- `stack` → larghezza `winWidth`, altezza `liveBoxHeight` (shared value, già
  esiste); l'unica incognita è `top = insets.top + altezzaToolbar`.
  `insets.top` l'host ce l'ha da sé (`SafeAreaProvider` è alla root).
  **L'altezza della toolbar è l'unico numero da pubblicare**, ed è una
  dimensione: `TimelineToolbarInline` la compone da token scalati
  (`ui.space`, `rowPadV`), quindi non è una costante esportabile oggi ma il suo
  `onLayout` è sicuro.

Un solo numero attraversa il confine. È l'argomento più forte a favore di questo
design rispetto a 1.0.265.

### 2.6 Precedente già in repo

`src/app/EmbedWarmup.tsx` monta già una `WebView` fuori dal router, a 1×1 con
`opacity: 0`, e la pagina embed carica fino in fondo (log `live:warmup`). Prova
che una WebView può vivere fuori dall'albero delle rotte e che la pagina gira.
**Non** prova che la PiP sopravviva in quello stato — vedi §6.

---

## 3. Chi possiede la sessione, e il suo ciclo di vita

### Oggi

La rotta crea e distrugge. `key={liveReloadKey}` la rimonta su Go-Live
(`:376`, `:416`), e `key={deviceId}` sulla rotta rimonta l'intera schermata al
cambio camera. Fuori dalla rotta, sessione zero.

### Nel design

L'host possiede un registro `deviceId → sessione`. Ogni sessione ha:

- lo stato di attacco: **attached** (una rotta la sta mostrando, l'host la
  disegna al rettangolo pubblicato) o **parked** (nessuna rotta; la WebView resta
  montata e non visibile);
- un motivo per cui è parcheggiata: `pip` (PiP di sistema attiva) oppure `warm`
  (l'operatore è uscito, la teniamo calda);
- l'istante dell'ultimo distacco.

**Chi decide che non serve più.** Quattro regole, in quest'ordine:

1. **PiP chiusa dall'utente.** Il segnale esiste già ed è affidabile:
   `PIP_MODE_WATCH_SCRIPT` posta `{type:'pipmode',mode:'inline'}`
   (`src/live/pip-request.ts`). Una sessione `parked:pip` che riceve `inline` e
   non ha una rotta attaccata → sfratto immediato.
2. **Tetto di sessioni.** Vedi sotto.
3. **Scadenza del `warm`.** Una sessione `parked:warm` oltre N secondi → sfratto.
   Una sessione `parked:pip` **non** scade mai a tempo: è visibile all'utente.
4. **Background dell'app.** Da decidere — D4 in §7.

**Quante sessioni insieme, e serve un tetto.** Sì, serve, ed è la decisione che
raccomando di prendere per prima. Il consumo non è teorico: ogni sessione è una
WKWebView con un `RTCPeerConnection` che decodifica H.265. Su iOS la WKWebView è
già la ragione per cui esiste `EmbedWarmup`, perché avviarla costa.

**Raccomandazione: tetto = 2, con politica esplicita.** Una attached + al più
una parked. All'apertura di una camera diversa mentre la prima è in PiP:

- se la parked è `pip` → **la si tiene** e non si apre una seconda parked; la
  nuova camera diventa la attached. Due sessioni vive, che è il massimo.
- se la parked è `warm` e non è la camera che si sta aprendo → sfratto, si
  riparte pulita.
- se la parked è **la stessa camera** che si sta aprendo → riattacco (§4). È il
  caso comune ed è il guadagno vero.

Perché non 1: con tetto 1, aprire una seconda camera ucciderebbe la PiP della
prima — cioè romperebbe la funzione appena riparata. Perché non 3+: nessuno
scenario lo chiede e il costo è reale.

**Chi crea.** La rotta *dichiara un bisogno* (`deviceId` + configurazione), non
crea. L'host risolve la dichiarazione: riattacco se esiste, altrimenti crea
rispettando il tetto. Questo mantiene la semantica di `key={deviceId}` sulla
rotta (schermata pulita) **senza** che comporti una sessione pulita — che è
esattamente il punto.

**Cosa resta invariato.** `liveReloadKey` continua a esistere e continua a
rimontare la WebView su Go-Live: quel remount è **voluto** (uccide il feeder
registrato). Si sposta nell'host, indicizzato per sessione.

**Cosa NON si sposta nell'host** e resta alla rotta: `useIntercom`
(la sessione audio è dell'operatore, non del video), il lock di
`ScreenOrientation`, la playback machine, la cattura clip. Nota: la
`AVAudioSession` è già configurata a livello di processo
(`src/live/audio-session.ts`), non per rotta, quindi non cambia.

---

## 4. Cosa cambia per chi naviga

Oggi ogni uscita dal player distrugge la sessione e ogni rientro ne negozia una
nuova. Col design, un rientro entro la finestra `warm` **riattacca**.

**Onestà sul guadagno.** La pagina embed è un asset OTA locale
(`src/live/use-native-embed-source.ts` → `assets/embed/camstack-embed.html`),
quindi il costo evitato **non** è un download: è l'avvio della WKWebView, il
parse dell'SPA e la negoziazione WebRTC. Che l'avvio della WKWebView pesi è
documentato e misurato (`EmbedWarmup`: *"Measured cold-start breakdowns put the
FIRST camera open behind later ones"*). **Non ho un numero per il rientro
caldo**; i marker esistono già (`markBoot('embedLoaded')`, `markBoot('firstFrame')`,
`LiveViewWebView.tsx:724,828`) e vanno letti prima e dopo per poterlo affermare.

**Dove vive lo stato del riattacco.** Nell'host, mai nella rotta: lo stato deve
sopravvivere a chi lo ha creato. Per sessione l'host conserva `deviceId`, la
configurazione embed corrente, l'ultimo `PlayerStatus`, l'handle imperativo, le
shared value dello zoom.

**L'handle imperativo attraversa il confine.** `liveRef` è usato in 15 punti
della rotta (scrub, seek, rate, stepFrame, goLive, startPip, getStats,
capture…). Il sink della playback machine legge `liveRef.current` **in modo
pigro** dentro handler creati con `useMemo(..., [])`
(`CameraDetailScreen.tsx:390-427`): quindi l'host può pubblicare l'handle in un
ref stabile del registro e il sink continua a funzionare **senza modifiche alla
sua forma**. È un dettaglio fortunato e va verificato riga per riga in fase di
implementazione, non dato per scontato.

**Rientro su una sessione in stato registrato.** Una sessione parcheggiata
mentre era su footage registrato riattacca lì. La playback machine della rotta
riparte invece da zero. Vanno riconciliate: la posizione della sessione va
riletta dal `onPosition` dell'embed al riattacco, non ricostruita. Se questo
risulta complicato, la scorciatoia onesta è **parcheggiare solo sessioni live**
(una sessione in registrato viene sfrattata all'uscita) — decisione D3.

---

## 5. Rotte embed e griglia — chi usa cosa, coi file

**`app/embed/` non esiste.** Il `CLAUDE.md` del viewer lo cita ancora
(«`app/embed/` — embedded player routes»): è obsoleto. L'albero `app/` completo
è 18 file e nessuno sta sotto `embed/`. Da correggere a parte.

Le superfici WebView nell'app sono **quattro**, e sono indipendenti:

| Superficie | File | Chi la monta | La serve l'host? |
| --- | --- | --- | --- |
| Player singola camera | `src/live/LiveViewWebView.tsx` (via `src/live/LiveView.tsx`) | `CameraDetailScreen` (`:1341`), `GridTile` (`:231`) | **sì** per la camera; per `GridTile` vedi sotto |
| Muro griglia | `src/grid-embed/GridLiveEmbed.tsx` | `GridViewScreen:515` | **no** |
| Pagina Eventi embed | `src/events/EventsLiveEmbed.tsx` | `EventsEmbedScreen` (rotta `app/(app)/events-embed.tsx`) | **no** |
| Pre-riscaldamento | `src/app/EmbedWarmup.tsx` | `RootProviders:59` | **no** (ma vedi sotto) |

**La griglia resta fuori, e la ragione è nel codice, non a intuito.** In
`GridViewScreen.tsx:92`, `USE_EMBED = Platform.OS === 'ios' || Platform.OS === 'web'`:
su iOS e web il muro è **una sola** `GridLiveEmbed` (una WebView, N peer, un boot
SPA), che non è un `LiveView` e non passa dal registro. `GridWall` → `GridTile` →
`LiveView` è il percorso **solo Android**. Quindi:

- su iOS l'host serve **una sola superficie**: il player della camera singola.
  L'ambito della Fase 1 è quello, ed è il minimo indispensabile;
- su Android `GridTile` monterebbe N `LiveView` fuori dal registro. Il registro
  deve avere una nozione di **sessioni non gestite** (montate dal chiamante) e
  ignorarle, oppure il tetto va reso per-ambito. Decisione D5.

**Nota sul warm-up.** Se l'host esiste ed è sempre montato, `EmbedWarmup`
diventa un candidato alla fusione: la stessa WebView pre-riscaldata potrebbe
essere la prima sessione. **Non** parte della Fase 1 — `EmbedWarmup` è fuori da
`ConnectionProvider` di proposito (parte durante l'handshake, non dopo) e
unificarli significa perdere quella proprietà.

---

## 6. Cosa i test non possono dire, e va provato sul dispositivo

Il repo può coprire per valore: la macchina a stati del registro, la politica di
sfratto e il tetto, il calcolo del rettangolo per le tre forme, l'ordine
handoff/navigazione (già coperto da `pip-handoff.spec.ts`), e con
`src/testing/mount.tsx` il montaggio della rotta senza player. Tutto ciò che
segue **non** è verificabile lì:

1. **★ RISPOSTA (2026-09-01): NO.** La domanda che decideva il progetto — una
   WKWebView parcheggiata mantiene la finestra PiP? — è stata misurata sul
   dispositivo e la risposta è negativa: `presentation mode changed → inline`
   arriva ~7,1 s dopo il parking, e in un ciclo **4,6 s PRIMA** del
   `player torn down`. Lo strumento previsto qui ha funzionato esattamente come
   descritto: `PIP_MODE_WATCH_SCRIPT` ha distinto l'uscita *lato pagina* (posta
   `inline`) dal teardown *lato host*, e ha attribuito la morte alla pagina. Il
   dettaglio completo e la conseguenza sono nel «Verdetto» in testa.
2. ~~**Quale forma di parking sopravvive**: `opacity: 0` a dimensione piena,
   1×1, o traslata fuori schermo.~~ **Domanda ritirata.** Non è una scelta fra
   tre comportamenti: sono tre modi di essere NON VISIBILE, e il verdetto dice
   che è la non-visibilità a strozzare la pagina. Provare le altre due forme
   costerebbe due misure per riottenere lo stesso `inline`.
3. **Che una `View` assoluta fratello di `<Stack>` componga sopra un
   `RNSScreen`** e non venga clippata da `react-native-screens`.
4. **Che una shared value creata fuori dalla rotta piloti una `useAnimatedStyle`
   dentro l'host senza scatti**, e che il pinch resti sul thread UI.
5. **Fedeltà geometrica sulle transizioni**: rotazione, entrata/uscita `fill`,
   apertura del drawer landscape, drag del riquadro. È qui che 1.0.263 e 1.0.265
   si sono rotti, e si vede solo a occhio.
6. **Che l'host non renda intoccabile niente.** Mitigazione strutturale: la root
   dell'host **non** deve essere un `absoluteFill` con `pointerEvents="box-none"`
   — quella catena ha già mangiato i tap dei tab
   (`git show f11345c^:src/components/camera/StreamOverlayControls.tsx`).
   Deve essere una `View` assoluta **dimensionata esattamente al rettangolo
   video**, così non può fisicamente coprire i tab. Da confermare a mano.
7. **Il costo reale del riattacco** (§4), da `markBoot`.
8. **Consumo di memoria con due sessioni vive** — Instruments.

Vincolo da rispettare scrivendo il codice: `no-in-app-pip.spec.ts` fallisce sul
primo simbolo `pipWindow`, `PipRect`, `inAppPip`, `enterInAppPip`… Il registro
non deve usare quei nomi.

---

## 7. Decisioni per l'operatore

### D1 — La forma della Fase 1 · **la decisione principale**

- **(a) Host = video + i 17 livelli sul video; la rotta pubblica i 7 che le
  appartengono.** Fuori dal rettangolo non cambia niente.
- (b) Fase 1 letterale (host = solo video, chrome nella rotta). **Non
  realizzabile**, §2.
- (c) Rimandare: prima solo la strumentazione, poi si decide.

→ **Raccomando (a).** È il minimo che soddisfa la fasatura chiesta — la sessione
resta viva per prima — e (b) non esiste. Se (a) sembra troppo per un solo passo,
il taglio giusto **non** è ridurre cosa possiede l'host (§2 dice che non si
può): è ridurre **quante forme di layout** l'host serve nel primo giro. Vedi D6.

### D2 — Lo stato parcheggiato · **DECADUTA**

La misura raccomandata qui è stata fatta ed è tornata negativa (§6.1, e il
«Verdetto» in testa): nessuna delle tre forme di parking mantiene la PiP,
perché la variabile non era la forma ma la visibilità. Non c'è più una scelta
da fare — c'è un progetto da non costruire.

### D3 — Cosa si parcheggia

- (a) Solo sessioni **live**; una in registrato viene sfrattata all'uscita.
- (b) Qualunque sessione, riconciliando la posizione al riattacco.

→ **Raccomando (a) per la Fase 1.** Copre il caso PiP (lo swipe va già live
prima della PiP — `shouldGoLiveBeforePip`) e copre il rientro comune. (b)
aggiunge la riconciliazione playhead a un cambio già ampio.

### D4 — Background dell'app

- (a) Le sessioni parcheggiate sopravvivono al background; al ritorno si
  riconnettono (il `reconnect()` su foreground esiste già,
  `LiveViewWebView.tsx:547-557`).
- (b) Il background sfratta tutte le `warm`, tiene solo le `pip`.

→ **Raccomando (b).** iOS sospende comunque la WKWebView e uccide il peer (già
documentato lì); tenere viva una `warm` in background paga memoria per una
sessione che al ritorno va ricostruita. Una `pip` invece è visibile e va tenuta.

### D5 — Il muro Android (`GridTile`)

- (a) Il registro ignora le `LiveView` montate dai chiamanti; `GridTile` resta
  com'è, il tetto vale solo per le sessioni gestite.
- (b) Anche la griglia Android passa dal registro.

→ **Raccomando (a).** Su iOS la griglia non usa `LiveView` affatto (§5); (b)
allarga l'ambito a una piattaforma che non ha il bug PiP.

### D6 — Ampiezza della prima consegna

- (a) Tutte e tre le forme (`stack`, `fill`, `wide`) subito.
- (b) Solo `stack` (il ritratto del telefono, dove vive lo swipe-back); `fill` e
  `wide` continuano a montare il player nella rotta, con una sessione che non
  sopravvive.
- (c) `stack` + `fill`; `wide` (tablet/web) dopo.

→ **Raccomando (c).** (b) reintrodurrebbe due proprietari e un riparenting alla
rotazione, cioè il difetto di 1.0.263: `stack` e `fill` sono la stessa sessione
che ruota e devono viaggiare insieme. `wide` è una forma separata, su
dispositivi dove lo swipe-back non è il gesto principale, e si può fare dopo.

### D7 — Cosa attraversa il confine rotta → host

- (a) Un **elemento React** (`ReactNode`) per la chrome, come già si fa con
  `streamBox` → prop `stream`.
- (b) Uno **stato serializzabile** (booleani/numeri) e l'host compone la chrome.

→ **Raccomando (b) per i 7 elementi che dipendono dalla rotta.** (a) sembra più
economico perché somiglia a ciò che già c'è, ma un `ReactNode` pubblicato in uno
store viene renderizzato nella posizione dell'**host**: i context che riceve sono
quelli dell'host, non quelli della rotta. Oggi funzionerebbe (lo slot stream non
è dentro `TimelineScaleProvider`), ma è una proprietà accidentale che nessuno sta
guardando e che si rompe in silenzio al primo provider aggiunto. (b) rende il
confine esplicito e testabile per valore.

---

## Riepilogo dei fatti verificati in questo documento

- `streamBox` è già una variabile passata per prop; il player ha già **un solo
  genitore** in ogni layout (`stream-slot.ts`, `TheaterTimeline.tsx:1593`).
- La schermata tab dipinge opaco (`TabsNavigator.tsx:55`) → niente vive sotto lo `<Stack>`.
- `(tabs)` **non è nello stack** su deep link a freddo (`back-to-cameras.ts`).
- Il rettangolo video è già calcolato da quantità di finestra; l'unica misura
  necessaria è l'**altezza** della toolbar in `stack`.
- 9 overlay su 17 sono auto-alimentati per `deviceId` e si spostano invariati.
- Su iOS il muro griglia non usa `LiveView` (`GridViewScreen.tsx:92`).
- Una WebView fuori dal router funziona già in produzione (`EmbedWarmup.tsx`).
- Il segnale che distingue uscita-pagina da teardown-host esiste
  (`PIP_MODE_WATCH_SCRIPT`).

Affermazione **verificata e FALSA**: la sopravvivenza della PiP in stato
parcheggiato (§6.1, la più importante — misurata il 2026-09-01, vedi il
«Verdetto» in testa). È quella che archivia il documento.

Affermazioni ancora **non** verificate, e ormai senza un progetto che le
consumi: la composizione di una `View` sopra un `RNSScreen` (§2.2), le shared
value cross-albero (§6.4), e il costo del riattacco (§4).
