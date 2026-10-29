/**
 * What's new — the notes the operator reads once, at the first launch of a
 * version, and again from Settings → Info.
 *
 * FILL THIS IN BEFORE EVERY SHIP: `update:*` and `release:{ios,android}:*`
 * run `scripts/lib/check-whats-new.js` first and refuse to bump unless the
 * version they are about to write has an entry here; `whats-new.spec.ts`
 * holds the version in `package.json` to the same rule in CI. Newest first,
 * both languages.
 *
 * ONE LINE PER CHANGE. Name what is fixed or new — never why, never how,
 * never the trade-off, never the incident. If a line needs a subordinate
 * clause it is already too long. Under 90 characters; never over 140.
 *
 * "short lines" was already written here and it was not enough: by
 * 2026-09-22 the notes had drifted to 250–406 characters each, three
 * sentences apiece, arguing the design. The reasoning belongs in the ADR and
 * the commit — the operator reading this on a phone wants to know what
 * changed, not to be convinced. `whats-new.spec.ts` now holds the ceiling.
 */
export interface WhatsNewEntry {
  readonly version: string
  /** ISO date of the ship. */
  readonly date: string
  readonly notes: {
    readonly en: readonly string[]
    readonly it: readonly string[]
  }
}

export const WHATS_NEW: readonly WhatsNewEntry[] = [
  {
    version: '1.0.668',
    date: '2026-10-29',
    notes: {
      en: ['A track shows the name of the node it ran on.'],
      it: ['La traccia mostra il nome del nodo su cui è stata elaborata.'],
    },
  },
  {
    version: '1.0.667',
    date: '2026-10-29',
    notes: {
      en: ['The timeline hours line up with the playback position again.'],
      it: ['Gli orari della timeline tornano allineati alla posizione di riproduzione.'],
    },
  },
  {
    version: '1.0.666',
    date: '2026-10-29',
    notes: {
      en: ['Timeline cards sit at their real time again on busy hours.'],
      it: ['Le card della timeline tornano all\'orario reale nelle ore piene.'],
    },
  },
  {
    version: '1.0.665',
    date: '2026-10-28',
    notes: {
      en: ['A notification rule can ask you to confirm whether a detection was right'],
      it: ['Una regola di notifica può chiederti se una rilevazione era giusta'],
    },
  },
  {
    version: '1.0.664',
    date: '2026-10-28',
    notes: {
      en: ['Battery, power, signal and sensor values read the new field names from the hub'],
      it: ['Batteria, potenza, segnale e sensori leggono i nuovi nomi dei campi dall\'hub'],
    },
  },
  {
    version: '1.0.663',
    date: '2026-10-28',
    notes: {
      en: [
        'Events embed: no face marker, short tile age, text in your language',
        'Events embed: track detail and labels follow the language',
      ],
      it: [
        'Embed eventi: niente segno volto, età breve sulle tessere, testi nella tua lingua',
        'Embed eventi: dettaglio traccia ed etichette nella lingua scelta',
      ],
    },
  },
  {
    version: '1.0.662',
    date: '2026-10-28',
    notes: {
      en: [
        'Events embed: tighter grid, names fit the tile, time on the picture corner',
        'Events share link carries the same tile settings as the Events page',
        'Events embed: a track detail page Home Assistant opens on tap',
      ],
      it: [
        "Embed eventi: griglia più compatta, nomi adattati, orario nell'angolo dell'immagine",
        'Il link di condivisione eventi usa le stesse impostazioni delle tessere della pagina Eventi',
        'Embed eventi: pagina di dettaglio traccia che Home Assistant apre al tocco',
      ],
    },
  },
  {
    version: '1.0.661',
    date: '2026-10-26',
    notes: {
      en: [
        'Detection colours follow the palette chosen on your hub',
      ],
      it: [
        "I colori dei rilevamenti seguono la palette scelta sull'hub",
      ],
    },
  },
  {
    version: '1.0.660',
    date: '2026-10-25',
    notes: {
      en: [
        'Timeline places events at the right hour on daylight-saving days',
        'Tank alerts removed: consumables now arrive as one alert and summary',
      ],
      it: [
        "La timeline mette gli eventi all'ora giusta nei giorni del cambio d'ora",
        'Avvisi serbatoio rimossi: i consumabili arrivano in un avviso e nel riepilogo',
      ],
    },
  },
  {
    version: '1.0.659',
    date: '2026-10-24',
    notes: {
      en: [
        'Cameras open in your saved order, without reshuffling',
        'Camera snapshots start loading sooner',
        'Training data loads page by page, even with hundreds of frames',
      ],
      it: [
        "Le camere si aprono nell'ordine salvato, senza riordinarsi",
        'Gli snapshot delle camere iniziano a caricare prima',
        'I dati di training caricano a pagine, anche con centinaia di frame',
      ],
    },
  },
  {
    version: '1.0.658',
    date: '2026-10-24',
    notes: {
      en: [
        'Library sections follow the features your account was granted',
        'Track details show where a track was detected (admins)',
      ],
      it: [
        'Le sezioni della Libreria seguono le funzioni concesse al tuo account',
        'Il dettaglio traccia mostra dove è stata rilevata (admin)',
      ],
    },
  },
  {
    version: '1.0.657',
    date: '2026-10-23',
    notes: {
      en: [
        'Library filters are remembered on this device, per section',
        'People and Plates open sorted by confidence',
        'Face detail: the full picture with the face boxed, and a link to the event',
        'Face detail: delete an unassigned face',
      ],
      it: [
        'I filtri della Libreria restano salvati su questo dispositivo, per sezione',
        'Persone e Targhe si aprono ordinate per confidenza',
        'Dettaglio volto: immagine intera col volto evidenziato e link all\'evento',
        'Dettaglio volto: elimina un volto non assegnato',
      ],
    },
  },
  {
    version: '1.0.656',
    date: '2026-10-23',
    notes: {
      en: ['Fullscreen: a PTZ button opens pan, tilt, zoom and presets over the video'],
      it: ['Schermo intero: un pulsante PTZ apre movimento, zoom e preset sul video'],
    },
  },
  {
    version: '1.0.655',
    date: '2026-10-23',
    notes: {
      en: [
        'Live view: buttons on the video always keep their background',
        'Camera header icons follow the app theme',
      ],
      it: [
        'Live: i pulsanti sul video mantengono sempre lo sfondo',
        'Icone dell\'header camera seguono il tema dell\'app',
      ],
    },
  },
  {
    version: '1.0.654',
    date: '2026-10-23',
    notes: {
      en: [
        'One eye menu across the Library, with titled sections and smaller text',
        'Library sections pick a day with the timeline calendar',
        'Hub connection shown once, as a floating pill, only when it lasts',
      ],
      it: [
        'Un solo menu occhio in Libreria, con sezioni titolate e testo più piccolo',
        'Le sezioni della Libreria scelgono il giorno col calendario della timeline',
        'Connessione all\'hub mostrata una volta sola, in una pillola, se dura',
      ],
    },
  },
  {
    version: '1.0.653',
    date: '2026-10-23',
    notes: {
      en: ['Events Display menu: smaller labels, long ones wrap instead of being cut'],
      it: ['Menu Aspetto di Eventi: testi più piccoli, quelli lunghi vanno a capo'],
    },
  },
  {
    version: '1.0.652',
    date: '2026-10-23',
    notes: {
      en: [
        'Notifications: glass layout, Alarm is now its own section',
        'Faces and Plates: one tile style; the eye menu shows date and camera',
        'Floating window: the play button stops spinning once live plays',
        'Share links and Home Assistant cards carry every builder option',
        'No importance order anywhere: events are always newest first',
        'Events filters: no page title, rows at the Library\'s size',
      ],
      it: [
        'Notifiche: layout glass, Allarme è ora una sezione a sé',
        'Volti e Targhe: un solo stile di tile; l\'occhio mostra data e camera',
        'Finestra mobile: il tasto play smette di girare quando parte la live',
        'Link di condivisione e card Home Assistant portano ogni opzione',
        'Nessun ordine per importanza: eventi sempre dai più recenti',
        'Filtri Eventi: niente titolo, righe alla misura della Libreria',
      ],
    },
  },
  {
    version: '1.0.651',
    date: '2026-10-23',
    notes: {
      en: [
        'Landscape: the header compacts to fit, no menu, no rotation',
        'Faces: time in the corner like Events; shorter rows without info',
        'Events: always newest first, sort button removed',
      ],
      it: [
        'Landscape: l\'header si compatta, niente menu né rotazione',
        'Volti: orario nell\'angolo come in Eventi; righe più basse senza info',
        'Eventi: sempre dai più recenti, rimosso il pulsante ordina',
      ],
    },
  },
  {
    version: '1.0.650',
    date: '2026-10-23',
    notes: {
      en: [
        'Landscape: timeline over or beside the stream; controls stay 10 s',
        'Rules: motion without a subject and devices needing attention',
      ],
      it: [
        'Landscape: timeline sopra o accanto allo stream; controlli 10 s',
        'Regole: movimento senza soggetto e dispositivi da sistemare',
      ],
    },
  },
  {
    version: '1.0.649',
    date: '2026-10-22',
    notes: {
      en: [
        'Library tiles show camera and time on their own lines; long-press starts selection.',
        'Section selector slides a glass indicator; connection status floats as a glass overlay.',
      ],
      it: [
        'Libreria: camera e ora su righe separate; tieni premuto per selezionare.',
        'Il selettore di sezione scorre con un indicatore glass; la connessione è un overlay glass.',
      ],
    },
  },
  {
    version: '1.0.648',
    date: '2026-10-22',
    notes: {
      en: [
        'Notification rules: paired system events are one choice; a rule that breaks is announced.',
        'People: readable menus, two-row cards, Status filter fixed; pages refresh on return.',
      ],
      it: [
        'Regole: gli eventi di sistema in coppia sono una scelta; avviso se una regola si rompe.',
        'Persone: menu leggibili, schede su due righe, filtro Stato; pagine aggiornate al ritorno.',
      ],
    },
  },
  {
    version: '1.0.647',
    date: '2026-10-22',
    notes: {
      en: [
        'Double tap the player: fills the screen, double tap again to see it all.',
        "Notification rules can draw the subject's path on the picture.",
      ],
      it: [
        'Doppio tocco sul player: riempie lo schermo, di nuovo per vederlo tutto.',
        'Le regole di notifica possono disegnare il percorso del soggetto sull\'immagine.',
      ],
    },
  },
  {
    version: '1.0.646',
    date: '2026-10-22',
    notes: {
      en: ['Library: faces use square tiles, like Events.'],
      it: ['Libreria: i volti usano riquadri quadrati, come gli Eventi.'],
    },
  },
  {
    version: '1.0.645',
    date: '2026-10-22',
    notes: {
      en: [
        'Rule editor: one picture choice — scene with boxes, crop or clean scene.',
        'Rules triggered by a zone can draw that zone on the picture.',
        'Alarm status shows inputs bypassed until disarm.',
        'Events: the day count appears once, under the filters.',
      ],
      it: [
        'Editor regole: una sola scelta di immagine — scena con box, crop o scena pulita.',
        'Le regole che scattano su una zona possono disegnarla sull\'immagine.',
        'Lo stato dell\'allarme mostra gli ingressi esclusi fino al disinserimento.',
        'Eventi: il conteggio del giorno compare una volta sola, sotto i filtri.',
      ],
    },
  },
  {
    version: '1.0.644',
    date: '2026-10-22',
    notes: {
      en: [
        'Library: filters, sort, menu and add on one row above the grid.',
        'People, Plates, Media and Retrain share one 16:9 tile and grid.',
        'Menus, popovers and tooltips use the glass surface everywhere.',
        'Same side margins, empty states and section labels across the app.',
        'Logs and track detail open as sheets.',
      ],
      it: [
        'Libreria: filtri, ordinamento, menu e aggiungi su una riga sopra la griglia.',
        'Persone, Targhe, Media e Riaddestra usano la stessa card 16:9.',
        'Menu, popover e tooltip usano ovunque la superficie in vetro.',
        'Stessi margini, stati vuoti ed etichette di sezione in tutta l\'app.',
        'Log e dettaglio della traccia si aprono come sheet.',
      ],
    },
  },
  {
    version: '1.0.643',
    date: '2026-10-21',
    notes: {
      en: [
        'Settings split into This device and your Account on each server.',
        'Account settings sync on their own across your devices.',
        'Copy your account settings from another server in one tap.',
        'New Tokens section: create, extend and revoke your access tokens.',
        'Sharing a grid or events creates a token, or reuses one you have.',
      ],
      it: [
        'Impostazioni divise in Questo dispositivo e il tuo Account per server.',
        'Le impostazioni dell\'account si sincronizzano da sole tra i dispositivi.',
        'Copia le impostazioni dell\'account da un altro server con un tocco.',
        'Nuova sezione Token: crea, estendi e revoca i tuoi token di accesso.',
        'Condividere grid o eventi crea un token, o ne riusa uno esistente.',
      ],
    },
  },
  {
    version: '1.0.642',
    date: '2026-10-21',
    notes: {
      en: [
        'Dialogs and text fields stay above the keyboard, on iOS and Android.',
        'Grids, favourites and camera settings now belong to one server.',
        'One filter bar across Events, Media, People, Plates and Retrain.',
        'People and Plates: one labelled main action, the rest in the ⋯ menu.',
      ],
      it: [
        'Dialog e campi di testo restano sopra la tastiera, su iOS e Android.',
        'Grid, preferiti e impostazioni camera ora appartengono a un server.',
        'Una sola barra filtri in Eventi, Media, Persone, Targhe e Retrain.',
        'Persone e Targhe: un\'azione principale con etichetta, il resto nel menu ⋯.',
      ],
    },
  },
  {
    version: '1.0.641',
    date: '2026-10-21',
    notes: {
      en: [
        'Camera view header is taller; camera switch moved to the right.',
        'Timeline legend is now in the camera settings panel.',
        'Timeline audio bar shows the peak level continuously again.',
        'Dishwashers show as the main control of their device.',
      ],
      it: [
        'Intestazione della camera più alta; cambio camera spostato a destra.',
        'La legenda della timeline ora è nel pannello impostazioni camera.',
        'La barra audio della timeline mostra di nuovo il picco in continuo.',
        'Le lavastoviglie compaiono come controllo principale del dispositivo.',
      ],
    },
  },
  {
    version: '1.0.640',
    date: '2026-10-19',
    notes: {
      en: ['Cameras filter menu shows only the active set (Detections), not Recent events.'],
      it: ['Menu filtro Camere: solo lo stato attivo (Rilevamenti), senza Eventi recenti.'],
    },
  },
  {
    version: '1.0.639',
    date: '2026-10-19',
    notes: {
      en: [
        'Cameras reel filter label matches the strip; readout picker sheet with more sensors.',
      ],
      it: [
        'Etichetta filtro reel allineata al nastro; foglio valori overlay con più sensori.',
      ],
    },
  },
  {
    version: '1.0.638',
    date: '2026-10-19',
    notes: {
      en: ['Smaller Recent reel tiles, corner time, unified label modes.'],
      it: ['Sequenza Recent più compatta, ora in angolo, etichette unificate.'],
    },
  },
  {
    version: '1.0.637',
    date: '2026-10-19',
    notes: {
      en: ['Fix: the app no longer crashes on yesterday’s event times.'],
      it: ['Correzione: l’app non si chiude più sugli orari degli eventi di ieri.'],
    },
  },
  {
    version: '1.0.636',
    date: '2026-10-18',
    notes: {
      en: ['Player toolbar: smaller glass groups — nav, date, and actions.'],
      it: ['Toolbar player: gruppi glass più piccoli — nav, data e azioni.'],
    },
  },
  {
    version: '1.0.635',
    date: '2026-10-18',
    notes: {
      en: ['Player toolbar: one glass header size for back, date and actions.'],
      it: ['Toolbar player: un solo glass da 40 per indietro, data e azioni.'],
    },
  },
  {
    version: '1.0.634',
    date: '2026-10-18',
    notes: {
      en: ['Cameras menu: labels on the left, round icons on the right.'],
      it: ['Menu Camere: etichette a sinistra, icone tonde a destra.'],
    },
  },
  {
    version: '1.0.633',
    date: '2026-10-18',
    notes: {
      en: [
        'Timeline tools are one smaller bar, split between filters, zoom and clips.',
        'The Cameras button stays put when its menu opens, labels included.',
      ],
      it: [
        'I tool della timeline sono una barra più piccola, con spazi tra i gruppi.',
        'Il pulsante Camere resta fermo all’apertura, etichette comprese.',
      ],
    },
  },
  {
    version: '1.0.632',
    date: '2026-10-18',
    notes: {
      en: [
        'Timeline tools sit in one glass bar at the top of the card band.',
        'Cameras menu opens as a compact vertical glass bar.',
        'Clip mode shows one centred 16:9 preview, not a carousel.',
      ],
      it: [
        'I tool della timeline sono in una barra glass in alto sulla fascia card.',
        'Il menu Camere si apre come barra glass verticale compatta.',
        'In modalità clip una sola anteprima 16:9 centrata, non un carosello.',
      ],
    },
  },
  {
    version: '1.0.631',
    date: '2026-10-18',
    notes: {
      en: ['Fix: the app crashed right after launch.'],
      it: ["Correzione: l'app si chiudeva subito dopo l'avvio."],
    },
  },
  {
    version: '1.0.630',
    date: '2026-10-18',
    notes: {
      en: [
        'Event tile labels now read clearly, with the tab bar look.',
        'Tiles from another day say Yesterday, the weekday, or the date.',
        'Drag a sheet down to close it; the backdrop fades with it.',
        'Sheets: the dim backdrop fades in place, it no longer slides.',
      ],
      it: [
        'Le etichette delle tessere Eventi si leggono meglio, come la barra.',
        'Le tessere di altri giorni dicono Ieri, il giorno o la data.',
        'Trascina una scheda verso il basso per chiuderla.',
        'Schede: lo sfondo scuro sfuma sul posto, non scorre più.',
      ],
    },
  },
  {
    version: '1.0.629',
    date: '2026-10-18',
    notes: {
      en: [
        'Events scrolls smoothly: tile chips are light, no glass per tile.',
        'The tile corner shows the event time instead of the duration.',
        'The ? on a face opens the assign sheet directly.',
      ],
      it: [
        'Eventi scorre fluido: i chip delle tessere sono leggeri.',
        "L'angolo della tessera mostra l'ora dell'evento, non la durata.",
        'Il ? su un volto apre subito la scheda di assegnazione.',
      ],
    },
  },
  {
    version: '1.0.628',
    date: '2026-10-18',
    notes: {
      en: [
        'Events runs full page: the grid scrolls under the tab bar.',
        'The Retrain toolbar is glass, like the other bars.',
        'Grid wall: a back button that fades out and returns on touch.',
      ],
      it: [
        'Eventi a pagina intera: la griglia scorre sotto la barra.',
        'La barra di Retrain è in vetro, come le altre barre.',
        'Muro griglia: pulsante indietro che sfuma e torna al tocco.',
      ],
    },
  },
  {
    version: '1.0.627',
    date: '2026-10-18',
    notes: {
      en: [
        'Events: a native square-tile gallery with day headers, no web view.',
        'Events display menu: optional camera, time and zone under each tile.',
        'The Recent strip on Cameras is native too, with the same live updates.',
      ],
      it: [
        'Eventi: galleria nativa a tessere quadrate con intestazioni per giorno.',
        'Menu Visualizza: camera, ora e zona opzionali sotto ogni tessera.',
        'Anche Recenti in Telecamere è nativa, con gli stessi aggiornamenti.',
      ],
    },
  },
  {
    version: '1.0.626',
    date: '2026-10-18',
    notes: {
      en: [
        'Library: new Plates page to review, correct and assign plate reads.',
        'The app language now reaches the hub on every request.',
        'The Activity list is as tall as its rows.',
        'The account menu rows share one layout, with tighter spacing.',
      ],
      it: [
        'Libreria: nuova pagina Targhe per rivedere, correggere e assegnare le letture.',
        'La lingua dell\'app ora arriva all\'hub a ogni richiesta.',
        'La lista Attività è alta quanto le sue righe.',
        'Le righe del menu account hanno un solo layout, con spaziature ridotte.',
      ],
    },
  },
  {
    version: '1.0.625',
    date: '2026-10-18',
    notes: {
      en: [
        'Activity now queues long actions and shows their progress.',
        'The Activity icon appears only when it has something to show.',
        'The account menu fits its content.',
        'People: header actions, no more banners pushing the page.',
      ],
      it: [
        'Attività mette in coda le azioni lunghe e ne mostra l\'avanzamento.',
        'L\'icona Attività compare solo quando c\'è qualcosa da mostrare.',
        'Il menu account si adatta al contenuto.',
        'Persone: azioni nell\'header, niente più banner che spostano la pagina.',
      ],
    },
  },
  {
    version: '1.0.624',
    date: '2026-10-17',
    notes: {
      en: ['Smoother animations everywhere.', 'Glass buttons merge and menus open from their button.', 'Wall tiles get glass controls.'],
      it: ['Animazioni più fluide ovunque.', 'I tasti glass si fondono e i menu si aprono dal tasto.', 'I riquadri della parete hanno controlli glass.'],
    },
  },
  {
    version: '1.0.623',
    date: '2026-10-17',
    notes: {
      en: [
        'Settings opens again from the account menu.',
        'Every tab scrolls under the glass bar; the last item clears it.',
        'Glass buttons spring under your finger.',
        'The tab bar is darker and its highlight slides between tabs.',
        'One header on every screen: glass back and action buttons.',
      ],
      it: [
        'Le Impostazioni si aprono di nuovo dal menu account.',
        'Ogni scheda scorre sotto la barra di vetro; l\'ultimo elemento resta libero.',
        'I pulsanti di vetro rispondono con una molla al tocco.',
        'La barra delle schede è più scura e l\'evidenza scivola tra le schede.',
        'Un\'unica intestazione su ogni schermata: indietro e azioni di vetro.',
      ],
    },
  },
  {
    version: '1.0.622',
    date: '2026-10-17',
    notes: {
      en: ['Timeline photos are captioned with the name, plate or sound they carry.'],
      it: ['Le foto della timeline mostrano nome, targa o suono che riconoscono.'],
    },
  },
  {
    version: '1.0.621',
    date: '2026-10-17',
    notes: {
      en: ['Timeline: a group card now covers all its events, so a tap stays in it.'],
      it: ['Timeline: la scheda di un gruppo copre tutti i suoi eventi, il tocco resta lì.'],
    },
  },
  {
    version: '1.0.620',
    date: '2026-10-17',
    notes: {
      en: [
        'Zone button: tap it again to cancel drawing or clear the zone.',
        'Zone Cancel / Confirm are two separate pills over the video.',
        'The playing event no longer lights up or scrolls the photo row.',
        'Back and camera switch are one glass capsule in the top bar.',
        'Bottom timeline pills are 20% smaller.',
      ],
      it: [
        'Pulsante zona: tocca di nuovo per annullare il disegno o togliere la zona.',
        'Annulla / Conferma zona sono due pillole separate sul video.',
        'L\'evento in riproduzione non illumina né scorre più la riga foto.',
        'Indietro e cambio camera sono una capsula di vetro nella barra in alto.',
        'Le pillole in basso della timeline sono più piccole del 20%.',
      ],
    },
  },
  {
    version: '1.0.619',
    date: '2026-10-17',
    notes: {
      en: [
        'Timeline: each group is its gallery panel, photos 20% larger.',
        'Tapping a photo seeks 2 s before the event; the playing one lights up.',
        'At most 6 events per group.',
        'Liquid Glass: a floating tab bar and glass controls over the video.',
        'Timeline tools float as glass pills: filters, zone, range, clip mode.',
        'The camera switch moved to the top bar; pick the day by tapping the date.',
      ],
      it: [
        'Timeline: ogni gruppo è il suo pannello galleria, foto più grandi del 20%.',
        'Toccando una foto si va 2 s prima dell\'evento; quella in riproduzione si illumina.',
        'Al massimo 6 eventi per gruppo.',
        'Liquid Glass: barra delle schede flottante e controlli in vetro sul video.',
        'Gli strumenti della timeline sono pillole di vetro: filtri, zona, intervallo, clip.',
        'Il cambio camera passa nella barra in alto; il giorno si sceglie dalla data.',
      ],
    },
  },
  {
    version: '1.0.618',
    date: '2026-10-17',
    notes: {
      en: [
        'People: "Recompute suggestions" now covers the whole archive, with progress.',
        'Timeline: plain tool icons, the Zone icon lights up, a dot marks the time.',
        'Timeline: cluster arrows and "1/3" are clearer; paging keeps the image size.',
        'Zone drawing: hint and shape chips no longer overlap.',
      ],
      it: [
        'Persone: "Ricalcola i suggerimenti" copre tutto l\'archivio, con avanzamento.',
        'Timeline: icone semplici, Zona si accende, un punto segna l\'ora.',
        'Timeline: frecce e "1/3" dei gruppi piu chiare; la foto resta della stessa misura.',
        'Disegno zona: suggerimento e forme non si sovrappongono.',
      ],
    },
  },
  {
    version: '1.0.617',
    date: '2026-10-17',
    notes: {
      en: [
        'Timeline: event cards no longer overflow above the top line.',
        'Timeline tools are docked in a labelled bar under the list.',
        'New setting: show event clusters as a carousel. Bigger thumbnails.',
      ],
      it: [
        'Timeline: le card degli eventi non salgono più sopra la linea in alto.',
        'Gli strumenti della timeline sono in una barra con etichette sotto la lista.',
        'Nuova opzione: cluster di eventi come carosello. Miniature più grandi.',
      ],
    },
  },
  {
    version: '1.0.616',
    date: '2026-10-17',
    notes: {
      en: [
        'REC menu: Export, Snapshot and Delete now fit the selector.',
        'The Activity panel opens like the account menu, at half height.',
        'Library: the Review tab is now called People.',
        'Adding a device certificate: the password field has a show / hide eye.',
        'People: best suggestions first across all faces; grid steady.',
      ],
      it: [
        'Menu REC: Export, Snapshot ed Elimina ora stanno nel selettore.',
        'Il pannello Attività si apre come il menu account, a mezza altezza.',
        'Libreria: la scheda Revisione ora si chiama Persone.',
        'Certificato del dispositivo: il campo password ha l’occhio mostra / nascondi.',
        'Persone: prima i suggerimenti migliori su tutti i volti.',
      ],
    },
  },
  {
    version: '1.0.615',
    date: '2026-10-17',
    notes: {
      en: [
        'New Activity panel: exports and snapshots with progress, download and share.',
        'Account menu with your servers; the REC button opens snapshot, export and delete.',
        'Cleaner timeline lanes, smaller overlays, and the hub name instead of its address.',
        'Signing out elsewhere now returns this app to the sign-in screen.',
      ],
      it: [
        'Nuovo pannello Attività: export e snapshot con progresso, download e condivisione.',
        'Menu account con i tuoi server; il pulsante REC apre snapshot, export ed elimina.',
        "Timeline più pulita, overlay più piccoli e il nome dell'hub al posto dell'indirizzo.",
        "Uscire da un altro dispositivo ora riporta quest'app alla schermata di accesso.",
      ],
    },
  },
  {
    version: '1.0.614',
    date: '2026-10-16',
    notes: {
      en: [
        'At home the app uses the hub secure address when your phone trusts its certificate.',
        'Disconnecting this device now returns to sign-in, and re-linking says why it failed.',
      ],
      it: [
        "A casa l'app usa l'indirizzo sicuro dell'hub se il telefono si fida del certificato.",
        "Disconnettere il dispositivo riporta all'accesso e il ricollegamento ne spiega il motivo.",
      ],
    },
  },
  {
    version: '1.0.613',
    date: '2026-10-16',
    notes: {
      en: ['Single sign-on and passkey sign-in now open the hub flow made for the app.'],
      it: ["L'accesso con SSO e passkey ora apre il percorso dell'hub pensato per l'app."],
    },
  },
  {
    version: '1.0.612',
    date: '2026-10-16',
    notes: {
      en: ['The sign-in screen stays clear of the status bar with the keyboard open.'],
      it: ['La schermata di accesso non finisce sotto la barra di stato con la tastiera aperta.'],
    },
  },
  {
    version: '1.0.611',
    date: '2026-10-16',
    notes: {
      en: ["Certificate details now read the hub's certificates."],
      it: ['I dettagli del certificato ora leggono i certificati dell\'hub.'],
    },
  },
  {
    version: '1.0.610',
    date: '2026-10-16',
    notes: {
      en: ['Pairing a phone switches it to its certificate at once.'],
      it: ['Associare un telefono lo passa subito al suo certificato.'],
    },
  },
  {
    version: '1.0.609',
    date: '2026-10-16',
    notes: {
      en: ['Certificate details on the phone.'],
      it: ['Dettagli del certificato sul telefono.'],
    },
  },
  {
    version: '1.0.608',
    date: '2026-10-16',
    notes: {
      en: ['Fixed: the app closed right after opening in 1.0.607.'],
      it: ["Corretto: l'app si chiudeva appena aperta nella 1.0.607."],
    },
  },
  {
    version: '1.0.607',
    date: '2026-10-16',
    notes: {
      en: [
        'Stay signed in on this device with a certificate; revoke it any time.',
        'Sign in with every hub method: password, SSO and passkeys.',
      ],
      it: [
        'Resta collegato su questo dispositivo con un certificato, revocabile.',
        "Accedi con tutti i metodi dell'hub: password, SSO e passkey.",
      ],
    },
  },
  {
    version: '1.0.606',
    date: '2026-10-15',
    notes: {
      en: ['Icon picker: every icon, by category, searchable.'],
      it: ['Selettore icone: tutte le icone, per categoria, con ricerca.'],
    },
  },
  {
    version: '1.0.605',
    date: '2026-10-15',
    notes: {
      en: ['Training editor: drawing, moving and resizing boxes now work on phones.'],
      it: ['Editor addestramento: ora si disegnano, spostano e ridimensionano riquadri sul telefono.'],
    },
  },
  {
    version: '1.0.604',
    date: '2026-10-14',
    notes: {
      en: ['Training editor: class picker like the rest of the app, original class shown.'],
      it: ['Editor addestramento: selettore classi come nel resto dell\'app, classe originale visibile.'],
    },
  },
  {
    version: '1.0.603',
    date: '2026-10-14',
    notes: {
      en: ['Training frames can now be reviewed and corrected from the app.'],
      it: ['I frame di addestramento si possono rivedere e correggere dall\'app.'],
    },
  },
  {
    version: '1.0.602',
    date: '2026-10-14',
    notes: {
      en: ['Storage alert variables now have readable names in the notification editor.'],
      it: ['Le variabili degli avvisi di archiviazione hanno nomi leggibili nell\'editor notifiche.'],
    },
  },
  {
    version: '1.0.601',
    date: '2026-10-14',
    notes: {
      en: [
        'The small overlay size is now much smaller.',
        'The device information overlay is off by default on new installs.',
      ],
      it: [
        'La dimensione overlay piccola ora è molto più piccola.',
        'L\'overlay informazioni dispositivo è spento di default sulle nuove installazioni.',
      ],
    },
  },
  {
    version: '1.0.600',
    date: '2026-10-14',
    notes: {
      en: [
        'Stream stats now sit where you put them, on iPhone too.',
        'New overlay size setting (small, medium, large) for every read-out.',
        'New Live viewers overlay: how many people watch a camera now (needs a hub update).',
      ],
      it: [
        'Le statistiche stream stanno dove le metti, anche su iPhone.',
        'Nuova dimensione overlay (piccola, media, grande) per ogni informazione.',
        'Nuovo overlay Spettatori: quante persone guardano ora (serve aggiornare l\'hub).',
      ],
    },
  },
  {
    version: '1.0.599',
    date: '2026-10-13',
    notes: {
      en: [
        'Device information overlay: time, battery and signal, also on the grid.',
        'Retrain frames load again, with a skeleton while they load.',
      ],
      it: [
        'Overlay informazioni dispositivo: ora, batteria e segnale, anche in griglia.',
        'I frame di Retrain si caricano di nuovo, con uno scheletro durante il caricamento.',
      ],
    },
  },
  {
    version: '1.0.598',
    date: '2026-10-13',
    notes: {
      en: ['Recording and storage alerts now show their own names in notification rules.'],
      it: ['Gli avvisi di registrazione e archiviazione hanno i loro nomi nelle regole.'],
    },
  },
  {
    version: '1.0.597',
    date: '2026-10-13',
    notes: {
      en: ['Notification rules on recording and storage alerts now open on the phone.'],
      it: ['Le regole di notifica su registrazioni e archiviazione ora si aprono sul telefono.'],
    },
  },
  {
    version: '1.0.596',
    date: '2026-10-12',
    notes: {
      en: [
        'Phone battery overlay on live and the grid bar (Settings → Viewing).',
      ],
      it: [
        'Overlay batteria telefono su live e barra griglia (Impostazioni → Visione).',
      ],
    },
  },
  {
    version: '1.0.595',
    date: '2026-10-10',
    notes: {
      en: [
        'Library Retrain: browse corpus frames and manage collections (no labeling yet).',
      ],
      it: [
        'Library Retrain: sfoglia i frame del corpus e gestisci le collezioni (niente labeling ancora).',
      ],
    },
  },
  {
    version: '1.0.594',
    date: '2026-10-10',
    notes: {
      en: [
        'Library: admins can annotate staged retrain tracks (pick frames, boxes, save).',
      ],
      it: [
        'Library: gli admin possono annotare le tracce retrain in staging (frame, box, salva).',
      ],
    },
  },
  {
    version: '1.0.593',
    date: '2026-10-09',
    notes: {
      en: [
        'Theater: add-to-training sits next to Live on the playback bar when paused.',
      ],
      it: [
        'Theater: aggiungi-al-training è accanto a Live nella barra, in pausa.',
      ],
    },
  },
  {
    version: '1.0.592',
    date: '2026-10-09',
    notes: {
      en: [
        'Theater: admins can add the playhead frame to a training collection.',
        'Events mark tracks already used for training.',
      ],
      it: [
        'Theater: gli admin possono aggiungere il fotogramma a una collezione di training.',
        'Gli eventi segnano le tracce già usate per il training.',
      ],
    },
  },
  {
    version: '1.0.591',
    date: '2026-10-09',
    notes: {
      en: ['Live view no longer stops after two hours of watching.'],
      it: ['La live non si ferma più dopo due ore di visione.'],
    },
  },
  {
    version: '1.0.590',
    date: '2026-10-08',
    notes: {
      en: [
        'Settings is split into Account, Viewing, App and Advanced.',
        'Sign-in methods: password, authenticator app, passkeys and linked accounts.',
        'Your share links are listed under Account, with Revoke.',
        'Link sign-in accounts and add passkeys from the phone app.',
        'Sessions renew silently; signing out also ends the session on the hub.',
        'Active sessions in Sign-in methods: sign out one device, or all of them.',
        'Linking an account, turning off 2FA or removing a passkey asks for your password.',
      ],
      it: [
        'Impostazioni divise in Account, Visione, App e Avanzate.',
        'Metodi di accesso: password, app di autenticazione, passkey e account collegati.',
        'I tuoi link condivisi sono in Account, con Revoca.',
        "Collega account di accesso e aggiungi passkey dall'app sul telefono.",
        "Le sessioni si rinnovano da sole; uscire chiude la sessione anche sull'hub.",
        'Sessioni attive in Metodi di accesso: disconnetti un dispositivo o tutti.',
        'Collegare un account, disattivare la 2FA o rimuovere una passkey chiede la password.',
      ],
    },
  },
  {
    version: '1.0.589',
    date: '2026-10-07',
    notes: {
      en: [
        'The floating window starts live right away.',
        'Stream info and stats show live numbers in the web app.',
        'A multi-camera view in the player has the grid control bar.',
        'Settings profiles keep audio, quality, filters and favourites on each device.',
        'Dialogs open centred in the web app; track importance is off by default.',
      ],
      it: [
        'La finestra mobile parte subito in live.',
        "Info e statistiche dello stream mostrano i valori anche nell'app web.",
        'La vista multi-camera nel player ha la barra comandi della griglia.',
        'I profili lasciano audio, qualità, filtri e preferiti su ogni dispositivo.',
        "Finestre centrate nell'app web; importanza delle tracce spenta di default.",
      ],
    },
  },
  {
    version: '1.0.588',
    date: '2026-10-07',
    notes: {
      en: [
        'Recorded playback in the web app runs smoothly, without stalls.',
        'Playback controls fit on one row whenever there is room.',
      ],
      it: [
        "La riproduzione registrata nell'app web scorre senza scatti.",
        "I controlli di riproduzione stanno su una riga quando c'è spazio.",
      ],
    },
  },
  {
    version: '1.0.587',
    date: '2026-10-07',
    notes: {
      en: [
        'Full screen fills the screen in the web app.',
        'The web app connects over your local network when it can.',
        'Live view reaches full quality without reopening the stream.',
        'Stream statistics can sit in any corner.',
      ],
      it: [
        "Lo schermo intero riempie lo schermo anche nell'app web.",
        "L'app web si collega in rete locale quando può.",
        'Il live passa alla qualità piena senza riaprire lo stream.',
        'Le statistiche dello stream possono stare in qualsiasi angolo.',
      ],
    },
  },
  {
    version: '1.0.586',
    date: '2026-10-06',
    notes: {
      en: [
        'Playback controls no longer overlap; the speed menu opens on top.',
        'Sign-in names a wrong or non-CamStack address right away.',
      ],
      it: [
        'I controlli di riproduzione non si sovrappongono; il menu velocità si apre sopra.',
        "L'accesso segnala subito un indirizzo errato o non CamStack.",
      ],
    },
  },
  {
    version: '1.0.585',
    date: '2026-10-06',
    notes: {
      en: [
        'The Motion order now follows real motion on every camera.',
        'The motion border lights up again from live events.',
        'New system notifications: node restarting and node updating.',
      ],
      it: [
        "L'ordine Motion ora segue la motion reale di ogni telecamera.",
        'Il bordo motion torna ad accendersi con gli eventi live.',
        'Nuove notifiche di sistema: nodo in riavvio e nodo in aggiornamento.',
      ],
    },
  },
  {
    version: '1.0.584',
    date: '2026-10-06',
    notes: {
      en: [
        'The web app opens faster and loads camera tiles quicker.',
        'Enter signs you in; an unreachable server now says so.',
        'Addon updates have their own system-notification group.',
      ],
      it: [
        "L'app web si apre e carica le anteprime più in fretta.",
        'Invio fa il login; un server irraggiungibile ora lo dice.',
        'Gli aggiornamenti addon hanno un gruppo di notifiche tutto loro.',
      ],
    },
  },
  {
    version: '1.0.583',
    date: '2026-10-06',
    notes: {
      en: [
        'Cameras can be sorted by latest motion.',
        'Switch between saved servers in Settings, no sign-out needed.',
        'Alarm settings drop the recipients list: alarm rules decide who is told.',
      ],
      it: [
        'Le telecamere si possono ordinare per ultimo movimento.',
        'Passa da un server salvato all’altro in Impostazioni, senza uscire.',
        'Le impostazioni allarme perdono i destinatari: decidono le regole allarme.',
      ],
    },
  },
  {
    version: '1.0.582',
    date: '2026-10-04',
    notes: {
      en: [
        'Stream quality chip shows the tier you picked.',
        'Quality button no longer shows a down arrow.',
      ],
      it: [
        'Il chip qualità mostra il livello che hai scelto.',
        'Il pulsante qualità non ha più la freccia verso il basso.',
      ],
    },
  },
  {
    version: '1.0.580',
    date: '2026-10-04',
    notes: {
      en: [
        'Chosen stream quality sticks after a camera swap.',
        'Exiting fullscreen returns the phone to portrait.',
        'Timeline toolbar no longer wraps onto a second line.',
      ],
      it: [
        'La qualità stream scelta resta dopo un cambio camera.',
        'Uscendo dal fullscreen il telefono torna in verticale.',
        'La toolbar della timeline non va più a capo.',
      ],
    },
  },
  {
    version: '1.0.579',
    date: '2026-10-03',
    notes: {
      en: ['Away from home, playback always uses the lowest stream quality.'],
      it: ['Fuori rete locale, la riproduzione usa sempre la qualità più bassa.'],
    },
  },
  {
    version: '1.0.578',
    date: '2026-10-03',
    notes: {
      en: [
        'Event seek opens on the exact moment.',
        'Timeline duration menu stays above its chip.',
        'Date picker is shorter, with a Today row.',
      ],
      it: [
        'Il seek evento apre sull’istante esatto.',
        'Il menu durata resta sopra il chip.',
        'Il selettore data è più basso, con la riga Oggi.',
      ],
    },
  },
  {
    version: '1.0.577',
    date: '2026-10-02',
    notes: {
      en: [
        'Timeline Auto zoom follows scrub speed; slow tightens to 15 minutes.',
        'The time-range menu includes Auto and 15 minutes.',
      ],
      it: [
        'Zoom Auto della timeline segue la velocità di scrub; lento stringe a 15 minuti.',
        'Il menu durata include Auto e 15 minuti.',
      ],
    },
  },
  {
    version: '1.0.576',
    date: '2026-10-02',
    notes: {
      en: ['Filter menus open again after the timeline range fix.'],
      it: ['I menu filtro si riaprono dopo il fix della durata timeline.'],
    },
  },
  {
    version: '1.0.575',
    date: '2026-10-02',
    notes: {
      en: [
        'Timeline opens on 30 minutes.',
        'An event opens 10 seconds before it.',
        'The time-range menu opens above the chip.',
      ],
      it: [
        'La timeline si apre su 30 minuti.',
        'Un evento apre 10 secondi prima.',
        'Il menu della durata si apre sopra il chip.',
      ],
    },
  },
  {
    version: '1.0.574',
    date: '2026-10-02',
    notes: {
      en: ['Rules: Immediate, grouped waits for subjects and sends one mosaic.'],
      it: ['Regole: Immediata raggruppata attende i soggetti e invia un mosaico.'],
    },
  },
  {
    version: '1.0.573',
    date: '2026-10-02',
    notes: {
      en: ['Alarm: opens on the first mode that checks a sensor.'],
      it: ['Allarme: si apre sulla prima modalità che controlla dei sensori.'],
    },
  },
  {
    version: '1.0.572',
    date: '2026-10-02',
    notes: {
      en: ['Alarm: pick a mode at the top; each mode is one short summary, its delays and its sensors sorted by name.'],
      it: ['Allarme: scegli la modalità in alto; ogni modalità mostra un riepilogo breve, i suoi ritardi e i sensori in ordine di nome.'],
    },
  },
  {
    version: '1.0.571',
    date: '2026-10-02',
    notes: {
      en: [
        'Alarm: each mode lists only the sensors its rules cover, in the same table, rows and fields as the rest of the app.',
      ],
      it: [
        "Allarme: ogni modalità elenca solo i sensori coperti dalle sue regole, con la stessa tabella, righe e campi del resto dell'app.",
      ],
    },
  },
  {
    version: '1.0.570',
    date: '2026-10-02',
    notes: {
      en: [
        'Alarm: exit, entry and siren delays can be set per arm mode (unset modes keep the default).',
        'Alarm: each mode lists its sensors in a table with their state and a switch to stop a sensor from blocking the arm.',
        'Device picker: filter by device type, area and location, with a button to reset the filters.',
      ],
      it: [
        'Allarme: i ritardi di uscita, front door e sirena si impostano per modalità (senza valore vale il default).',
        'Allarme: ogni modalità elenca i sensori in una tabella con lo stato e uno switch per non bloccare l\'inserimento.',
        'Selezione dispositivi: filtri per tipo, area e posizione, con un pulsante per azzerarli.',
      ],
    },
  },
  {
    version: '1.0.569',
    date: '2026-10-01',
    notes: {
      en: [
        'A scheduled system summary can be sent as one notification per category (offline devices, batteries, consumables, ...).',
        'Testing a summary rule now sends the current summary.',
      ],
      it: [
        'Il riepilogo programmato di sistema può arrivare come una notifica per categoria (dispositivi offline, batterie, consumabili, ...).',
        'Il test di una regola di riepilogo ora invia il riepilogo attuale.',
      ],
    },
  },
  {
    version: '1.0.568',
    date: '2026-10-01',
    notes: {
      en: ['Deleting a rule asks for confirmation in the standard dialog.'],
      it: ["L'eliminazione di una regola chiede conferma con la finestra standard."],
    },
  },
  {
    version: '1.0.567',
    date: '2026-10-01',
    notes: {
      en: [
        'A person who steps out of frame for a few seconds stays the same track.',
        'A track fused into another still opens from its old link.',
        'Rule editor: the Advanced section is unified across rule kinds.',
        'Cooldown defaults to separate windows per class.',
        'Sensor rules attach one snapshot, not a choice of media.',
        'The device picker lists only devices the rule kind can target.',
      ],
      it: [
        "Una persona che esce dall'inquadratura per pochi secondi resta la stessa traccia.",
        "Una traccia fusa in un'altra si apre ancora dal suo vecchio collegamento.",
        'Editor regole: la sezione Avanzate è unificata per ogni tipo di regola.',
        'Il cooldown usa di default finestre separate per classe.',
        "Le regole sui sensori allegano un'unica foto, senza scelta del media.",
        'Il selettore dispositivi mostra solo quelli compatibili con la regola.',
      ],
    },
  },
  {
    version: '1.0.566',
    date: '2026-10-01',
    notes: {
      en: [
        'Rules are sorted by name, and tapping anywhere on a rule opens it.',
        'A Snooze switch on each rule silences it for 30 minutes.',
        'Deleting a rule asks for confirmation right on the button.',
        'Rule conditions are all shown; source and zone crossing moved to Advanced.',
        'Faces, zones and labels use the same Only / All except picker as classes.',
        'Zones are listed as "camera:zone", from every camera.',
        'Zone crossing: Entering, Leaving or Either — Entering by default.',
        'New detection rules watch the pipeline; sounds are no longer offered as classes.',
        'Device and scene states are shown as readable words.',
      ],
      it: [
        'Le regole sono ordinate per nome e un tocco ovunque sulla regola la apre.',
        'Un interruttore Silenzia su ogni regola la silenzia per 30 minuti.',
        'Eliminare una regola chiede conferma direttamente sul pulsante.',
        'Le condizioni sono tutte visibili; sorgente e attraversamento zona sono in Avanzate.',
        'Volti, zone ed etichette usano lo stesso selettore delle classi.',
        'Le zone sono elencate come "camera:zona", da tutte le camere.',
        'Attraversamento zona: In entrata, In uscita o Entrambe — In entrata di default.',
        'Le nuove regole di rilevamento usano la pipeline; i suoni non sono più tra le classi.',
        'Gli stati di dispositivi e scene sono mostrati in parole leggibili.',
      ],
    },
  },
  {
    version: '1.0.565',
    date: '2026-09-29',
    notes: {
      en: [
        'The "Groups" view is gone from the timeline, Events and the Recent reel: they always list subjects now.',
        'Summary rules no longer offer "one line is a group"; a rule that had it now lists subjects.',
      ],
      it: [
        'La vista «Gruppi» è stata rimossa da timeline, Eventi e striscia Recenti: ora mostrano sempre i soggetti.',
        'Le regole di riepilogo non offrono più «una riga è un gruppo»; una regola che lo usava ora elenca i soggetti.',
      ],
    },
  },
  {
    version: '1.0.564',
    date: '2026-09-26',
    notes: {
      en: [
        'Device and system rules can send a scheduled summary instead of one notification per event.',
        'Summary rules show their send times in the list, e.g. "Summary · daily 08:00".',
        'Semantic search in Events uses the server\'s own score threshold unless you set one.',
        'On a server that does not support summaries yet, the app says the rule stayed instant and keeps its active hours.',
      ],
      it: [
        'Le regole dei dispositivi e di sistema possono inviare un riepilogo pianificato invece di una notifica per evento.',
        'Le regole di riepilogo mostrano gli orari di invio nell\'elenco, ad es. "Riepilogo · ogni giorno 08:00".',
        'La ricerca semantica negli Eventi usa la soglia di punteggio del server, salvo che tu ne imposti una.',
        'Su un server che non supporta ancora i riepiloghi, l\'app avvisa che la regola è rimasta immediata e ne conserva le fasce orarie.',
      ],
    },
  },
  {
    version: '1.0.563',
    date: '2026-09-26',
    notes: {
      en: [
        'Sensor rules now pick from your sensors, not cameras.',
        "A rule's overview lists the devices it is active on.",
        'Selected devices are always all shown, with no "show more".',
        'The "off" note is gone where the switch already says it.',
      ],
      it: [
        'Le regole dei sensori ora scelgono tra i sensori, non tra le camere.',
        'La panoramica di una regola elenca i dispositivi su cui è attiva.',
        'I dispositivi selezionati sono sempre tutti visibili, senza "mostra altri".',
        'Niente più scritta "disattivata" dove c\'è già l\'interruttore.',
      ],
    },
  },
  {
    version: '1.0.562',
    date: '2026-09-26',
    notes: {
      en: [
        'Device rules can set their own consumable threshold (1–95 %).',
        'Robot vacuum tank alerts: tank low, tank full, back to normal.',
      ],
      it: [
        'Le regole dei dispositivi possono avere una propria soglia dei consumabili (1–95 %).',
        'Avvisi dei serbatoi del robot: serbatoio basso, pieno, tornato normale.',
      ],
    },
  },
  {
    version: '1.0.561',
    date: '2026-09-26',
    notes: {
      en: [
        'Rules: pick All, Only these or All except these for devices and classes, with a smarter class picker.',
        'Sensor rules can notify only when a sensor triggers, or only when it clears.',
        'Each rule shows its last run; tap it for the delivery history (admins).',
        'Rule cards keep the name readable, with the switch, Edit and Delete on one row.',
        'The device picker groups by zone, location or not at all.',
      ],
      it: [
        'Regole: scegli Tutti, Solo questi o Tutti tranne questi per dispositivi e classi, con un selettore classi migliore.',
        'Le regole dei sensori possono notificare solo quando il sensore scatta, o solo quando rientra.',
        "Ogni regola mostra l'ultima esecuzione; toccala per lo storico degli invii (admin).",
        'Le schede delle regole mostrano sempre il nome, con interruttore, Modifica ed Elimina su una riga.',
        'Il selettore dispositivi raggruppa per zona, posizione o nessuno.',
      ],
    },
  },
  {
    version: '1.0.560',
    date: '2026-09-26',
    notes: {
      en: [
        'System alerts are now three rule kinds: device events, system and alarm, each with its own settings.',
        'System rules pick nodes and packages from a list instead of typed names.',
        'A rule that mixes families is shown read-only, marked to recreate.',
      ],
      it: [
        'Gli avvisi di sistema sono ora tre tipi di regola: eventi dispositivi, sistema e allarme.',
        'Le regole di sistema scelgono nodi e pacchetti da un elenco, non più a testo libero.',
        'Una regola che mescola famiglie è in sola lettura, segnata da ricreare.',
      ],
    },
  },
  {
    version: '1.0.559',
    date: '2026-09-26',
    notes: {
      en: [
        'Sensor rules can send one mosaic of every linked camera, or one picture per camera.',
        'Clip thumbnails load one at a time per camera and no longer hammer it with retries.',
        'PTZ Home is greyed out when the camera has no home position set.',
      ],
      it: [
        'Le regole dei sensori inviano un mosaico di tutte le camere collegate, o una foto per camera.',
        'Le anteprime delle clip arrivano una alla volta per camera, senza raffiche di tentativi.',
        'Il tasto PTZ "posizione iniziale" è disattivato se la camera non ne ha una impostata.',
      ],
    },
  },
  {
    version: '1.0.558',
    date: '2026-09-25',
    notes: {
      en: [
        'Live quality now climbs on a good connection instead of staying stuck on low.',
        'Rules for batteries and consumables have their own section.',
        'System-event rules can exclude devices.',
        'A new compact device picker, with search and groups.',
        "The alarm's non-blocking list offers every door, window and lock.",
      ],
      it: [
        'La qualità live ora sale con una buona connessione invece di restare su bassa.',
        'Le regole per batterie e consumabili hanno una sezione dedicata.',
        'Le regole sugli eventi di sistema possono escludere dispositivi.',
        'Un nuovo selettore di dispositivi compatto, con ricerca e gruppi.',
        "La lista non bloccante dell'allarme propone ogni porta, finestra e serratura.",
      ],
    },
  },
  {
    version: '1.0.557',
    date: '2026-09-25',
    notes: {
      en: [
        'Rules are edited per kind, on their own screens, like the admin UI.',
        'Text fields offer the placeholders of that rule: tap to insert, with a live preview.',
        'Timelapse and summary rules expose every field; admins can test a rule from the phone.',
        'A device that no longer exists shows as "removed" and can be deselected.',
        'Alarm: every mode, what is open when arming is refused, and Arm anyway for admins.',
        'Disarm is always available, and admins can configure the alarm from the phone.',
      ],
      it: [
        'Le regole si modificano per tipo, su schermate dedicate, come nell\'admin UI.',
        'I campi di testo propongono i segnaposto della regola: tocca per inserire, con anteprima.',
        'Timelapse e riepiloghi hanno tutti i campi; gli admin possono provare una regola dal telefono.',
        'Un dispositivo che non esiste più appare come "rimosso" e si può togliere.',
        'Allarme: tutte le modalità, cosa è aperto quando è rifiutato, e Arma comunque per gli admin.',
        'Disarma è sempre disponibile, e gli admin configurano l\'allarme dal telefono.',
      ],
    },
  },
  {
    version: '1.0.556',
    date: '2026-09-24',
    notes: {
      en: ['A camera function with a warning now shows whether it is ON — the privacy mask could never look enabled.'],
      it: ['Una funzione con un avviso ora mostra se è ACCESA: la privacy mask non poteva mai sembrarlo.'],
    },
  },
  {
    version: '1.0.555',
    date: '2026-09-24',
    notes: {
      en: ['A shutter on its way up or down makes the button you pressed pulse.'],
      it: ['Una tapparella che sta salendo o scendendo fa pulsare il tasto che hai premuto.'],
    },
  },
  {
    version: '1.0.554',
    date: '2026-09-24',
    notes: {
      en: [
        'Closing clip mode returns to the recording at the moment the clip was at.',
        'The privacy-mask switch no longer looks locked when the camera has no zone drawn.',
      ],
      it: [
        'Chiudendo la modalità clip si torna alla registrazione nel punto in cui era la clip.',
        "L'interruttore della privacy mask non sembra più bloccato quando la camera non ha zone disegnate.",
      ],
    },
  },
  {
    version: '1.0.553',
    date: '2026-09-24',
    notes: {
      en: [
        'Recordings read the source each camera is set to, and you can pick it per camera.',
        'The camera reel says it is loading instead of looking like you own one camera.',
      ],
      it: [
        'Le registrazioni leggono la sorgente impostata per ogni camera, e la scegli tu camera per camera.',
        'La striscia delle camere dice che sta caricando, invece di sembrare che ne hai una sola.',
      ],
    },
  },
  {
    version: '1.0.552',
    date: '2026-09-24',
    notes: {
      en: ['A clip the camera cut short now says so, with how much arrived.'],
      it: ['Una clip che la camera ha troncato ora lo dice, e quanto ne \u00e8 arrivato.'],
    },
  },
  {
    version: '1.0.551',
    date: '2026-09-24',
    notes: {
      en: [
        'A clip silent because of the speed now says so, on the speaker.',
        'Recorded playback reaches 8\u00d7.',
      ],
      it: [
        'Una clip muta per via della velocit\u00e0 ora lo dice, sull\u2019altoparlante.',
        'La riproduzione delle registrazioni arriva a 8\u00d7.',
      ],
    },
  },
  {
    version: '1.0.550',
    date: '2026-09-23',
    notes: {
      en: ['Renaming a linked device is a field in the row now, and no longer hangs the app.'],
      it: ['Rinominare un dispositivo collegato si fa nella riga, e non blocca pi\u00f9 l\u2019app.'],
    },
  },
  {
    version: '1.0.549',
    date: '2026-09-23',
    notes: {
      en: ['Turning the sound back on now really turns it back on, clips included.'],
      it: ['Riaccendere l\u2019audio ora lo riaccende davvero, clip comprese.'],
    },
  },
  {
    version: '1.0.548',
    date: '2026-09-23',
    notes: {
      en: ['In a linked device\u2019s edit mode, the name now looks tappable \u2014 it always was.'],
      it: ['Nella modifica di un dispositivo collegato il nome ora si vede che si tocca.'],
    },
  },
  {
    version: '1.0.547',
    date: '2026-09-23',
    notes: {
      en: [
        'A clip now repeats when it ends. There is a loop switch beside the transport.',
        'A clip that simply finished no longer looks like a fault.',
      ],
      it: [
        'Una clip ora si ripete alla fine. L\u2019interruttore \u00e8 accanto ai comandi.',
        'Una clip che \u00e8 semplicemente finita non sembra pi\u00f9 un errore.',
      ],
    },
  },
  {
    version: '1.0.546',
    date: '2026-09-23',
    notes: {
      en: [
        'Tapping a clip brings it to the middle of the timeline.',
        'Reolink clips play again — the camera was being asked with the wrong handle.',
      ],
      it: [
        'Toccare una clip la porta al centro della linea del tempo.',
        'Le clip Reolink ripartono: chiedevamo alla camera con la maniglia sbagliata.',
      ],
    },
  },
  {
    version: '1.0.545',
    date: '2026-09-23',
    notes: {
      en: [
        'The cursor moves as you drag away from live, not when you let go.',
        'The speed menu lists only the speeds your camera has, with no note.',
        'A camera recorded on events opens on its clips.',
      ],
      it: [
        'Il cursore si sposta mentre trascini via dal live, non quando lasci.',
        'Il menu velocit\u00e0 elenca solo quelle che la camera ha, senza scritte.',
        'Una camera registrata a eventi si apre sulle sue clip.',
      ],
    },
  },
  {
    version: '1.0.544',
    date: '2026-09-23',
    notes: {
      en: ['Tapping a clip sends one command to the camera instead of two.'],
      it: ['Toccare una clip manda un comando solo alla camera invece di due.'],
    },
  },
  {
    version: '1.0.543',
    date: '2026-09-23',
    notes: {
      en: [
        'The cursor now slides between its two positions instead of jumping there.',
        'Hikvision clips no longer stop after a few seconds.',
      ],
      it: [
        'Il cursore ora scivola fra le sue due posizioni invece di saltarci.',
        'Le clip Hikvision non si fermano pi\u00f9 dopo qualche secondo.',
      ],
    },
  },
  {
    version: '1.0.542',
    date: '2026-09-23',
    notes: {
      en: [
        'Away from live the cursor sits mid-screen, so a cluster you tap fits on it.',
        'Previous updates are tucked behind one panel, leaving the newest room to breathe.',
      ],
      it: [
        'Lontano dal live il cursore sta a met\u00e0 schermo, cos\u00ec il cluster che tocchi ci sta tutto.',
        'Gli aggiornamenti precedenti stanno dietro un pannello, e il pi\u00f9 recente ha spazio.',
      ],
    },
  },
  {
    version: '1.0.541',
    date: '2026-09-23',
    notes: {
      en: [
        'While a clip plays the timeline stays put: no cursor, and scrolling does nothing.',
        'Scrolling to the top of a clip list no longer jumps you back to live.',
      ],
      it: [
        'Mentre una clip gira la linea del tempo sta ferma: niente cursore, e scorrere non fa nulla.',
        'Scorrere in cima a una lista di clip non ti riporta pi\u00f9 al live.',
      ],
    },
  },
  {
    version: '1.0.540',
    date: '2026-09-23',
    notes: {
      en: [
        'The oldest clips can be scrolled under the cursor again.',
        'The cursor reads the clip on the frame, not a time it is not at.',
        'The timeline follows the clip that is playing; drag it and it lets go.',
      ],
      it: [
        'Le clip pi\u00f9 vecchie si possono di nuovo portare sotto il cursore.',
        'Il cursore legge la clip nel riquadro, non un orario che non le appartiene.',
        'La linea del tempo segue la clip in riproduzione; se la trascini, si sgancia.',
      ],
    },
  },
  {
    version: '1.0.539',
    date: '2026-09-23',
    notes: {
      en: [
        'The timeline follows the clip that is playing, and stops when you drag it.',
        'Speeds a camera cannot really do are greyed out instead of pretending.',
        'Download now asks which quality, and the file lands in your exports.',
        'A clip you have not seen before gets a picture, taken from its middle.',
        'Clips that would not start on the studio and laundry cameras now do.',
      ],
      it: [
        'La linea del tempo segue la clip in riproduzione e si ferma se la trascini.',
        'Le velocit\u00e0 che una telecamera non sa fare sono spente invece di fingere.',
        'Il download ora chiede la qualit\u00e0, e il file finisce nelle esportazioni.',
        'Una clip mai vista prima ora ha una foto, presa dal suo centro.',
        'Le clip che non partivano su studio e laundry adesso partono.',
      ],
    },
  },
  {
    version: '1.0.538',
    date: '2026-09-23',
    notes: {
      en: [
        'A camera that just woke no longer shows its old sleeping snapshot.',
        'The speed menu opens upward, so it no longer covers the clip track.',
        'Clip controls now offer only what the camera can really do.',
        'Tapping anywhere outside a grid panel closes it.',
      ],
      it: [
        'Una telecamera appena sveglia non mostra pi\u00f9 la vecchia foto di quando dormiva.',
        'Il menu della velocit\u00e0 si apre verso l\u2019alto e non copre pi\u00f9 la barra della clip.',
        'I comandi delle clip offrono solo ci\u00f2 che la telecamera sa fare davvero.',
        'Toccando fuori da un pannello della griglia, il pannello si chiude.',
      ],
    },
  },
  {
    version: '1.0.537',
    date: '2026-09-22',
    notes: {
      en: ['A clip tapped while the player is starting now plays, instead of the live view.'],
      it: [
        'Una clip toccata mentre il player sta partendo adesso parte davvero, invece del live.',
      ],
    },
  },
  {
    version: '1.0.536',
    date: '2026-09-22',
    notes: {
      en: [
        'One devices panel everywhere, with the camera functions under it.',
        'Edit that panel: reorder, rename, re-icon, hide, and add your own devices.',
        'Linked devices are now edited in the admin UI, not here.',
        'The privacy-mask switch works with no zones drawn.',
        'A clip\u2019s progress bar no longer snaps forward when dragged back.',
        '157 icons to choose from, with search.',
      ],
      it: [
        'Un solo pannello dispositivi ovunque, con sotto le funzioni della telecamera.',
        'Modifica quel pannello: riordina, rinomina, cambia icona, nascondi e aggiungi dispositivi tuoi.',
        'I dispositivi collegati si modificano dall\u2019interfaccia admin, non pi\u00f9 da qui.',
        'L\u2019interruttore della maschera privacy funziona anche senza zone disegnate.',
        'La barra di una clip non scatta pi\u00f9 in avanti se la trascini indietro.',
        '157 icone fra cui scegliere, con ricerca.',
      ],
    },
  },
  {
    version: '1.0.535',
    date: '2026-09-22',
    notes: {
      en: [
        'Clips start faster. When a camera\u2019s list comes up, the hub now fetches its newest few clips in the background, so the first ones you open are already there \u2014 on a hub camera that was a 6\u20138 s wait per clip, now a fraction of a second. Never on a battery camera that would have to wake for it.',
        'Opening a clip now shows that it is loading: the ring around the play button turns while the file is being fetched and stops when it plays. Before, the frame just sat there until the clip appeared.',
        'The quality badge by the play button now works on the web too. It used to show only in the app.',
        'A live recording in progress stops when you open a clip, and asks whether to keep what it captured. It used to keep recording the clip as if it were the live picture.',
        'Tapping a clip plays the clip. It used to start the live view instead: the command was sent once, at the tap, and the player is created BY that tap \u2014 so it arrived before there was anything to receive it, and what came up was the live edge. Previous/next clip fell in the same hole, which is why they appeared to do nothing.',
      ],
      it: [
        'Le clip partono pi\u00f9 in fretta. Quando compare la lista di una telecamera, l\u2019hub scarica in sottofondo le sue clip pi\u00f9 recenti, cos\u00ec le prime che apri sono gi\u00e0 pronte \u2014 su una telecamera dell\u2019hub erano 6\u20138 s di attesa a clip, ora una frazione di secondo. Mai su una telecamera a batteria che dovrebbe svegliarsi per farlo.',
        'Aprire una clip adesso mostra che sta caricando: l\u2019anello attorno al tasto play gira mentre il file viene scaricato e si ferma quando parte. Prima il riquadro restava fermo finch\u00e9 la clip non compariva.',
        'Il badge della qualit\u00e0 accanto al tasto play adesso funziona anche sul web. Prima compariva solo nell\u2019app.',
        'Una registrazione live in corso si ferma quando apri una clip, e chiede se tenere quanto catturato. Prima continuava a registrare la clip come se fosse il live.',
        'Toccare una clip riproduce la clip. Prima partiva il live: il comando veniva inviato una volta sola, al tocco, e il player nasce PROPRIO da quel tocco \u2014 quindi arrivava prima che ci fosse qualcosa ad ascoltarlo, e a schermo veniva il live. Clip precedente/successiva cadevano nello stesso buco, ed \u00e8 per questo che sembravano non fare nulla.',
      ],
    },
  },
  {
    version: '1.0.534',
    date: '2026-09-22',
    notes: {
      en: [
        'A clip in the frame now shows where you are inside it: a position track under the transport, with the file\u2019s real length once the hub has measured it, and a drag along it that seeks inside the clip. While the length is not known yet the track says so instead of pretending the file is empty.',
        'Go live now really leaves the clip \u2014 the frame goes back to the live view (or the poster, on a battery camera). Previous/next still keep you in the list.',
        'Play/pause on a clip is the clip\u2019s own pause. Opened from the live edge, it used to run the live pause instead, which took the player down and the clip with it.',
        'Seeking inside a clip stays inside the clip. A release used to land on the recorder\u2019s footage at a nonsense moment and the file was gone.',
        'A clip in the frame now keeps its controls. Play/pause, speed, frame-step, previous/next clip and Go live are all there — before, opening a clip took the whole bar away, because the bar was asking whether the picture was live and a clip leaves the session exactly where it was.',
        'A camera whose current day is empty now looks back by itself, up to fourteen days, and says how far it has got. It used to show “No clips” straight away and only reveal the earlier ones once you dragged the list by hand.',
        'When a source cannot answer, the reason is now printed. The sentence used to arrive with the placeholder still in it.',
      ],
      it: [
        'Una clip nel riquadro adesso mostra a che punto sei: una traccia di posizione sotto i controlli, con la durata reale del file appena l\u2019hub l\u2019ha misurata, e un trascinamento lungo la traccia per cercare dentro la clip. Finch\u00e9 la durata non \u00e8 nota la traccia lo dice, invece di fingere che il file sia vuoto.',
        'Vai al live adesso esce davvero dalla clip \u2014 il riquadro torna al live (o al poster, su una telecamera a batteria). Precedente/successiva restano nella lista.',
        'Play/pausa su una clip \u00e8 la pausa della clip. Aperta dal live, prima eseguiva la pausa del live, che smontava il player e con lui la clip.',
        'Cercare dentro una clip resta dentro la clip. Prima il rilascio finiva sulle registrazioni in un istante senza senso e il file spariva.',
        'Una clip nel riquadro adesso mantiene i suoi controlli. Play/pausa, velocità, avanzamento a fotogramma, clip precedente/successiva e Vai al live ci sono tutti — prima aprire una clip faceva sparire l’intera barra, perché la barra chiedeva se l’immagine fosse il live e una clip lascia la sessione esattamente dov’era.',
        'Una telecamera il cui giorno corrente è vuoto adesso cerca da sola nei giorni precedenti, fino a quattordici, e dice a che punto è arrivata. Prima mostrava subito “Nessuna clip” e le più vecchie comparivano solo trascinando la lista a mano.',
        'Quando una sorgente non può rispondere, adesso il motivo viene scritto. Prima la frase arrivava con il segnaposto ancora dentro.',
      ],
    },
  },
  {
    version: '1.0.533',
    date: '2026-09-21',
    notes: {
      en: [
        'While a clip is playing, the time around the picture is the clip\u2019s own. It used to keep showing wherever the timeline had been left, which made a card from the afternoon sit under a frame claiming the evening \u2014 and made the list look wrong when it was not.',
      ],
      it: [
        'Mentre una clip \u00e8 in riproduzione, l\u2019ora attorno all\u2019immagine \u00e8 quella della clip. Prima continuava a mostrare il punto in cui era rimasta la timeline, cos\u00ec una scheda del pomeriggio finiva sotto un riquadro che dichiarava la sera \u2014 e faceva sembrare sbagliata la lista, che non lo era.',
      ],
    },
  },
  {
    version: '1.0.532',
    date: '2026-09-21',
    notes: {
      en: [
        'A camera that was asleep is no longer woken after a clip finishes. Playing a clip brings the player up, and until now nothing took that reason away again \u2014 so the player stayed up and the live stream started by itself.',
      ],
      it: [
        'Una camera che dormiva non viene pi\u00f9 svegliata quando una clip finisce. Riprodurre una clip accende il player, e finora nulla toglieva pi\u00f9 quel motivo \u2014 cos\u00ec il player restava acceso e la diretta partiva da sola.',
      ],
    },
  },
  {
    version: '1.0.531',
    date: '2026-09-21',
    notes: {
      en: [
        'Clips from a camera\u2019s own storage play, instead of flashing for an instant and stopping. The hub was asking the wrong source for the file \u2014 CamStack\u2019s own recorder, which has no file behind a clip the camera wrote \u2014 because nothing said which source the clip came from.',
      ],
      it: [
        'Le clip dall\u2019archivio della camera si riproducono, invece di lampeggiare un istante e fermarsi. L\u2019hub chiedeva il file alla sorgente sbagliata \u2014 il registratore di CamStack, che dietro una clip scritta dalla camera non ha alcun file \u2014 perché nessuno diceva da quale sorgente venisse la clip.',
      ],
    },
  },
  {
    version: '1.0.530',
    date: '2026-09-21',
    notes: {
      en: [
        'Clips from a camera\u2019s own storage play. On a camera that is asleep the player is deliberately kept down so nothing wakes it, and the command to play a clip was dropped into that gap without a word. A clip now brings the player up and opens straight on the file \u2014 the camera is never dialled.',
      ],
      it: [
        'Le clip dall\u2019archivio della camera si riproducono. Su una camera che dorme il player resta spento apposta perch\u00e9 nulla la svegli, e il comando per riprodurre una clip finiva in quel vuoto senza una parola. Ora una clip accende il player e apre direttamente sul file \u2014 la camera non viene mai contattata.',
      ],
    },
  },
  {
    version: '1.0.529',
    date: '2026-09-21',
    notes: {
      en: [
        'The download button on a clip says it is working. It fetches a file of several megabytes, and until now a press looked exactly like a press that did nothing.',
      ],
      it: [
        'Il pulsante di scaricamento su una clip dice che sta lavorando. Scarica un file di diversi megabyte, e finora premerlo era identico a premere qualcosa che non fa niente.',
      ],
    },
  },
  {
    version: '1.0.528',
    date: '2026-09-21',
    notes: {
      en: [
        'In the clips view the timeline no longer seeks while you scroll. Browsing the list moves the list and nothing else \u2014 the rule was written months ago and only one of its four parts was ever obeyed.',
      ],
      it: [
        'Nella vista clip la timeline non cerca pi\u00f9 mentre scorri. Sfogliare la lista muove la lista e nient\u2019altro \u2014 la regola era scritta da mesi e di quattro sue parti ne veniva rispettata una.',
      ],
    },
  },
  {
    version: '1.0.527',
    date: '2026-09-21',
    notes: {
      en: [
        'Clip thumbnails appear. They were being requested without the session\u2019s credentials, so the hub refused every one of them and the cards went black \u2014 a clip still now gets its credentials from the same single place as every other image on the timeline.',
      ],
      it: [
        'Le miniature delle clip compaiono. Venivano richieste senza le credenziali della sessione, quindi l\u2019hub le rifiutava tutte e le schede restavano nere \u2014 ora un\u2019immagine di clip prende le credenziali dallo stesso unico posto di ogni altra immagine della timeline.',
      ],
    },
  },
  {
    version: '1.0.526',
    date: '2026-09-21',
    notes: {
      en: [
        'Clip thumbnails render, and the second look at a clip is instant. A still the camera already holds now goes straight to the image cache with the session\u2019s credentials, so it is kept on the device instead of being downloaded and re-encoded every time \u2014 and it no longer trips the limit that printed an error across every card.',
      ],
      it: [
        'Le miniature delle clip si vedono, e riaprire una clip \u00e8 istantaneo. Un\u2019immagine che la camera ha gi\u00e0 va ora direttamente alla cache immagini con le credenziali della sessione, quindi resta sul dispositivo invece di essere riscaricata e ricodificata ogni volta \u2014 e non incappa pi\u00f9 nel limite che stampava un errore su ogni scheda.',
      ],
    },
  },
  {
    version: '1.0.525',
    date: '2026-09-21',
    notes: {
      en: [
        'Clips from a camera\u2019s own storage get their thumbnails back. Those rows carry a still the camera already holds, and the card was only ever passed the OTHER kind of address \u2014 so no thumbnail was ever requested, on any of them.',
      ],
      it: [
        'Le clip dall\u2019archivio della camera ritrovano le loro miniature. Quelle righe portano un\u2019immagine che la camera ha gi\u00e0, e alla scheda veniva passato solo l\u2019ALTRO tipo di indirizzo \u2014 quindi nessuna miniatura veniva mai richiesta, su nessuna di esse.',
      ],
    },
  },
  {
    version: '1.0.524',
    date: '2026-09-21',
    notes: {
      en: [
        'While a clip is playing in the camera\u2019s picture, the timeline no longer drives the player. Scrolling used to re-arm a seek into the live session behind the clip, which left the picture loading on cameras that record only on events.',
        'The clip surface now reports what it did \u2014 how many rows a list returned, how many stills were served, queued or refused, and what playback resolved to \u2014 so a camera whose clips do not appear can be diagnosed from the logs instead of guessed at.',
      ],
      it: [
        'Mentre una clip \u00e8 in riproduzione nell\u2019immagine della camera, la timeline non pilota pi\u00f9 il player. Prima lo scorrimento riarmava una ricerca sulla sessione dal vivo dietro la clip, e l\u2019immagine restava in caricamento sulle camere che registrano solo a eventi.',
        'La superficie clip ora riferisce quel che ha fatto \u2014 quante righe ha restituito un elenco, quante miniature sono state servite, messe in coda o rifiutate, e a cosa si \u00e8 risolta la riproduzione \u2014 cos\u00ec una camera le cui clip non compaiono si diagnostica dai log invece che a intuito.',
      ],
    },
  },
  {
    version: '1.0.523',
    date: '2026-09-21',
    notes: {
      en: [
        'The camera dot no longer claims a camera is not recording when it simply could not be asked. A recording state that failed to load now shows as unknown, in grey, instead of the green of a camera that is idle — and the timeline says the same about a footage band it could not read.',
        'A finger bouncing off the glass at the end of a pinch no longer advances the zoom a step.',
        'Zooming into a camera no longer follows you out of it: the zoom resets when you open a camera, instead of surviving until the app is killed.',
      ],
      it: [
        'Il pallino della camera non afferma più che una camera non registra quando semplicemente non è riuscito a chiederlo. Uno stato di registrazione che non si è caricato ora appare come sconosciuto, in grigio, invece del verde di una camera ferma — e la timeline dice lo stesso di una fascia di filmato che non ha potuto leggere.',
        'Un dito che rimbalza sul vetro alla fine di una pizzicata non fa più avanzare lo zoom di un gradino.',
        'Lo zoom su una camera non ti segue più fuori: si azzera all’apertura di una camera, invece di sopravvivere finché l’app non viene chiusa.',
      ],
    },
  },
  {
    version: '1.0.522',
    date: '2026-09-21',
    notes: {
      en: [
        'Previous and next clip are on the playback controls. While a clip is playing in the camera\u2019s picture, the two skip buttons step between clips instead of jumping ten seconds \u2014 inside a clip, what comes before and after is another clip.',
      ],
      it: [
        'Clip precedente e successiva sono nei comandi di riproduzione. Mentre una clip \u00e8 in riproduzione nell\u2019immagine della camera, i due pulsanti laterali passano da una clip all\u2019altra invece di saltare dieci secondi \u2014 dentro una clip, ci\u00f2 che viene prima e dopo \u00e8 un\u2019altra clip.',
      ],
    },
  },
  {
    version: '1.0.521',
    date: '2026-09-21',
    notes: {
      en: [
        'The side navigation is icons only. Beside the picture there was never room for the words, so they were being cut off mid-name; the bar along the bottom, which has the whole width, keeps its labels.',
        'The playback controls now fit the panel they are in. They were sized against the whole window rather than the box around them, so on a narrow panel the rightmost controls ran off the edge instead of stepping aside.',
      ],
      it: [
        'La navigazione laterale \u00e8 a sole icone. Di fianco all\u2019immagine lo spazio per le parole non c\u2019\u00e8 mai stato, e i nomi venivano tagliati a met\u00e0; la barra in basso, che ha tutta la larghezza, mantiene le sue etichette.',
        'I comandi di riproduzione ora stanno nel pannello che li contiene. Erano dimensionati sull\u2019intera finestra invece che sul riquadro attorno a loro, quindi su un pannello stretto quelli a destra uscivano dal bordo invece di farsi da parte.',
      ],
    },
  },
  {
    version: '1.0.520',
    date: '2026-09-21',
    notes: {
      en: [
        'Settings templates now keep themselves up to date. Save one from the device you set up the way you like, mark that device as the one that keeps it current, and any other device can follow it \u2014 it takes the newest version on its own, including a template someone else in the house made. A following device is read-only on the shared settings: the template wins.',
        'The rows that only mean something on a phone or tablet \u2014 build number, runtime, running bundle \u2014 are no longer shown in the desktop app, where there is no native build behind them.',
      ],
      it: [
        'I template delle impostazioni ora si mantengono aggiornati da soli. Salvane uno dal dispositivo che hai configurato come vuoi, segna quel dispositivo come quello che lo tiene aggiornato, e qualunque altro pu\u00f2 seguirlo \u2014 prende l\u2019ultima versione da solo, anche un template fatto da un\u2019altra persona di casa. Un dispositivo che segue \u00e8 in sola lettura sulle impostazioni condivise: vince il template.',
        'Le righe che hanno senso solo su telefono o tablet \u2014 numero di build, runtime, bundle in esecuzione \u2014 non compaiono pi\u00f9 nell\u2019app desktop, dove non c\u2019\u00e8 una build nativa dietro.',
      ],
    },
  },
  {
    version: '1.0.518',
    date: '2026-09-21',
    notes: {
      en: [
        'A camera that simply has no clips of a kind no longer looks broken. HomeKit clips were showing as a failure with a retry button on cameras HomeKit has never recorded \u2014 which retrying could never fix. The source already explains itself, and the app now shows that explanation instead of an error. A real fault still shows as a fault.',
      ],
      it: [
        'Una camera che semplicemente non ha clip di un certo tipo non sembra pi\u00f9 rotta. Le clip HomeKit comparivano come errore con un pulsante Riprova su camere che HomeKit non ha mai registrato \u2014 e riprovare non poteva cambiarlo. La sorgente si spiega gi\u00e0 da s\u00e9, e ora l\u2019app mostra quella spiegazione invece di un errore. Un guasto vero continua a comparire come guasto.',
      ],
    },
  },
  {
    version: '1.0.517',
    date: '2026-09-21',
    notes: {
      en: [
        'A clip from the camera now plays in the camera\u2019s own picture, not in a panel on top of it. It is the same player and the same connection the live view and the recorded timeline already use \u2014 so the controls under it are its controls, and going live leaves the clip. A clip that is only ever a link still opens in its own panel, because there is nothing for the player to fetch.',
      ],
      it: [
        'Una clip della camera ora si riproduce nell\u2019immagine della camera stessa, non in un pannello sopra. \u00c8 lo stesso player e la stessa connessione che gi\u00e0 usano la diretta e la timeline registrata \u2014 quindi i comandi sotto sono i suoi comandi, e tornare in diretta esce dalla clip. Una clip che \u00e8 solo un collegamento continua ad aprirsi nel suo pannello, perch\u00e9 non c\u2019\u00e8 nulla che il player possa scaricare.',
      ],
    },
  },
  {
    version: '1.0.516',
    date: '2026-09-21',
    notes: {
      en: [
        'The clip list no longer disappears while it is loading. Scrolling could take the list off the screen and leave a loading message in its place — the rows were being dropped whenever anything upstream flickered, not only when a new window was being read. What is on screen now stays on screen until there is an answer to replace it, and a list that is genuinely empty still says so.',
      ],
      it: [
        'L’elenco delle clip non sparisce più mentre carica. Scorrendo poteva togliere la lista dallo schermo lasciando al suo posto un messaggio di caricamento — le righe venivano buttate a ogni sfarfallio a monte, non solo quando si leggeva una finestra nuova. Ora ciò che è a schermo ci resta finché non arriva una risposta che lo sostituisca, e un elenco davvero vuoto continua a dirlo.',
      ],
    },
  },
  {
    version: '1.0.515',
    date: '2026-09-21',
    notes: {
      en: [
        'Clip thumbnails appear straight away. The hub already held a finished picture for almost every clip — 275 of 300 on one camera — and the app ignored it, asking the camera to cut a fresh one out of the video file instead, one at a time, in a queue. It now uses the picture that already exists and only asks for one to be made when there genuinely is none.',
      ],
      it: [
        'Le miniature delle clip compaiono subito. L’hub aveva già pronta l’immagine per quasi ogni clip — 275 su 300 di una camera — e l’app la ignorava, chiedendo invece alla camera di ritagliarne una nuova dal file video, una alla volta, in coda. Ora usa l’immagine che esiste già e ne fa produrre una solo quando davvero non c’è.',
      ],
    },
  },
  {
    version: '1.0.514',
    date: '2026-09-21',
    notes: {
      en: [
        'Scrolling the clip list no longer sticks on loading. Reaching the oldest end buys another day of history, and the list was buying one from a scroll it had caused itself: a wider window has no cards yet, an empty body collapses, and collapsing snaps the position \u2014 which counted as reaching the end again. Measured at twenty-nine days bought with no finger on the screen. A day of history is now bought by a touch.',
        'A clip\u2019s still stays once it has arrived. The list only keeps the tiles near what you are looking at, so an ordinary scroll was throwing away pictures the camera had already been asked for, and asking again put them back at the end of the queue \u2014 the camera makes one at a time. They are now kept across scrolling, leaving the list and coming back.',
      ],
      it: [
        'Scorrendo l\u2019elenco delle clip non resta pi\u00f9 bloccato sul caricamento. Arrivare in fondo compra un altro giorno di storia, e l\u2019elenco se lo comprava da uno scorrimento causato da s\u00e9: una finestra pi\u00f9 larga non ha ancora schede, un corpo vuoto si accorcia, e accorciandosi fa scattare la posizione \u2014 che contava come essere di nuovo in fondo. Misurati ventinove giorni comprati senza un dito sullo schermo. Ora un giorno di storia si compra con un tocco.',
        'La miniatura di una clip resta, una volta arrivata. L\u2019elenco tiene montate solo le schede vicine a ci\u00f2 che guardi, quindi un normale scorrimento buttava via immagini gi\u00e0 chieste alla camera, e richiederle le rimetteva in fondo alla coda \u2014 la camera ne produce una alla volta. Ora si conservano scorrendo, uscendo dall\u2019elenco e tornandoci.',
      ],
    },
  },
  {
    version: '1.0.513',
    date: '2026-09-20',
    notes: {
      en: [
        'Fixes a camera becoming unusable after opening a clip \u2014 continuous vibration and a frozen timeline. Two separate loops caused it. The timeline asks to return to live whenever its list sits at the newest end, and it stops asking once it gets there; the clip mode added yesterday could not be left that way, so the request repeated for ever and each repeat buzzed. It showed up on a sleeping battery camera with few clips, whose short list sits at that end permanently, and never on a mains camera with hundreds. The clip no longer takes over the camera\u2019s frame at all, which removes the cause rather than muting it.',
        'A clip tile\u2019s still now arrives instead of staying blank. The camera mints one still at a time, so on a page of sixty most requests are told to come back \u2014 and the app was treating that like a refusal. It now waits and asks again, spread out so the tiles do not collide, and gives up with a reason rather than silently.',
      ],
      it: [
        'Corregge una camera che diventava inutilizzabile dopo l\u2019apertura di una clip \u2014 vibrazione continua e timeline bloccata. Le cause erano due cicli distinti. La timeline chiede di tornare al live ogni volta che la sua lista \u00e8 sull\u2019estremo pi\u00f9 recente, e smette di chiederlo una volta arrivata; la modalit\u00e0 clip introdotta ieri non poteva essere abbandonata in quel modo, quindi la richiesta si ripeteva all\u2019infinito e ogni ripetizione vibrava. Si vedeva su una camera a batteria addormentata con poche clip, la cui lista corta sta sempre su quell\u2019estremo, e mai su una camera a rete con centinaia. La clip non occupa pi\u00f9 il riquadro della camera, il che elimina la causa invece di zittirla.',
        'La miniatura di una clip ora arriva invece di restare vuota. La camera ne produce una alla volta, quindi su una pagina da sessanta la maggior parte delle richieste riceve un \u201ctorna fra poco\u201d \u2014 e l\u2019app lo trattava come un rifiuto. Ora aspetta e richiede, distanziando i tentativi perch\u00e9 non si scontrino, e si arrende dicendo il motivo invece che in silenzio.',
      ],
    },
  },
  {
    version: '1.0.512',
    date: '2026-09-20',
    notes: {
      en: [
        'A camera\u2019s own clip now plays in the camera\u2019s own frame instead of a separate window, and repeats. While it does, the timeline\u2019s transport, heatmap and position line are gone \u2014 there is nothing for them to point at, and an empty scrubber still takes a drag that seeks the wrong footage. Arrows step to the previous and next clip, skipping any the camera cannot serve, and closing puts the frame back on exactly what it was showing rather than jumping to live \u2014 which on a battery camera would be a wake nobody asked for. A clip still being recorded plays once and says why it does not repeat: its end time is a guess the camera has not updated yet.',
        'Each clip tile has a save control where the cluster magnifier normally sits. It asks for the full-size copy, because that is the one worth keeping \u2014 the opposite of what the frame plays, which is deliberately the small one. A clip the camera cannot serve shows the control disabled with the camera\u2019s own reason rather than hiding it.',
      ],
      it: [
        'Una clip della camera ora si riproduce nel riquadro della camera stessa invece che in una finestra separata, e si ripete. Mentre gira, il trasporto della timeline, la mappa di densit\u00e0 e la linea di posizione spariscono: non hanno niente da indicare, e una barra vuota accetta comunque un trascinamento che cerca nel materiale sbagliato. Le frecce passano alla clip precedente e successiva saltando quelle che la camera non riesce a servire, e chiudendo il riquadro torna esattamente a ci\u00f2 che mostrava invece di saltare al live \u2014 che su una camera a batteria sarebbe un risveglio che nessuno ha chiesto. Una clip ancora in registrazione si riproduce una volta e dice perch\u00e9 non si ripete: la sua fine \u00e8 una stima che la camera non ha ancora aggiornato.',
        'Ogni riquadro di clip ha un comando di salvataggio dove di solito sta la lente del gruppo. Chiede la copia a piena dimensione, perch\u00e9 \u00e8 quella che vale la pena tenere \u2014 il contrario di quella che il riquadro riproduce, che \u00e8 deliberatamente la piccola. Una clip che la camera non riesce a servire mostra il comando disattivato con il motivo della camera, invece di nasconderlo.',
      ],
    },
  },
  {
    version: '1.0.511',
    date: '2026-09-20',
    notes: {
      en: [
        'Cameras that keep their own recordings \u2014 on an SD card, or on a Reolink hub \u2014 now show those clips in the app. Pick the source under Timeline \u2192 Clip source; the row only appears on a camera that actually has more than one. Tapping a clip plays the camera\u2019s own file, at the small copy rather than the one thirty times its size, in the same player a saved export opens in. Leaving the setting on CamStack recordings keeps the timeline exactly as it was.',
      ],
      it: [
        'Le camere che conservano registrazioni proprie \u2014 su scheda SD, o su un hub Reolink \u2014 ora mostrano quelle clip nell\u2019app. La sorgente si sceglie in Timeline \u2192 Sorgente clip, e la riga compare solo su una camera che ne ha davvero pi\u00f9 di una. Toccando una clip si riproduce il file della camera stessa, nella copia piccola invece di quella trenta volte pi\u00f9 pesante, nello stesso player con cui si apre un export salvato. Lasciando l\u2019impostazione su Registrazioni CamStack la timeline resta esattamente com\u2019era.',
      ],
    },
  },
  {
    version: '1.0.510',
    date: '2026-09-20',
    notes: {
      en: [
        'A single camera\u2019s live view now recovers from a freeze on its own. A stream whose picture stops is not an errored stream \u2014 the connection stays up and the player still reports that it is playing \u2014 so every recovery path in the app slept through it, and pressing pause and then play was the only way out. That gesture worked because the session could always be rebuilt; what was missing was anything that decided to. The grid already healed itself this way; the single-camera view never did.',
        'Animal, vehicle and audio labels on the Events page are translated. The translations were never missing: the app asked each camera which classes it advertises and printed the raw English id whenever that list did not carry one \u2014 which happens whenever a camera has its animal or vehicle group switched off while older events still mention a dog, whenever that per-camera list is still loading, and for every raw label the audio classifier produces. A label now falls back to its family and, in the last resort, shows the original word rather than a blank.',
      ],
      it: [
        'La vista dal vivo di una singola camera ora riparte da sola quando si blocca. Uno stream la cui immagine si ferma non \u00e8 uno stream in errore \u2014 la connessione resta su e il player continua a dire che sta riproducendo \u2014 quindi tutti i percorsi di recupero dell\u2019app ci dormivano sopra, e premere pausa e poi play era l\u2019unico modo per uscirne. Quel gesto funzionava perch\u00e9 la sessione si poteva sempre ricostruire; mancava solo qualcuno che decidesse di farlo. La griglia si curava gi\u00e0 cos\u00ec, la vista a camera singola no.',
        'Le etichette di animali, veicoli e audio nella pagina Eventi sono tradotte. Le traduzioni non erano mai mancate: l\u2019app chiedeva a ogni camera quali classi dichiara e stampava l\u2019identificativo inglese grezzo ogni volta che quella lista non ne conteneva una \u2014 cosa che succede quando una camera ha il gruppo animali o veicoli spento mentre lo storico parla ancora di un cane, quando quella lista sta ancora caricando, e per ogni etichetta grezza prodotta dal classificatore audio. Ora un\u2019etichetta ripiega sulla sua famiglia e, in ultima istanza, mostra la parola originale invece del vuoto.',
      ],
    },
  },
  {
    version: '1.0.509',
    date: '2026-09-19',
    notes: {
      en: [
        'The timeline column on a tablet is wider, because its toolbar had stopped fitting: the row had wrapped onto a second line and the menu that opens from it was clipped by the column\u2019s edge. The second line was eating the space the timeline itself needs.',
      ],
      it: [
        'La colonna della timeline su tablet \u00e8 pi\u00f9 larga, perch\u00e9 la sua barra non ci stava pi\u00f9: la riga era andata a capo su due righe e il menu che si apre da l\u00ec veniva tagliato dal bordo della colonna. La seconda riga si mangiava lo spazio che serve alla timeline stessa.',
      ],
    },
  },
  {
    version: '1.0.508',
    date: '2026-09-19',
    notes: {
      en: [
        'The stream numbers on the camera card now actually arrive. They were being measured once a second and thrown away on the way in: the app checks incoming messages for a stats reply, and it was matching any message that merely mentioned stats \u2014 which every sample does. So the card said "no measurement yet" on every camera, permanently, while the data was arriving the whole time.',
      ],
      it: [
        'I numeri dello stream sulla scheda della telecamera adesso arrivano davvero. Venivano misurati una volta al secondo e buttati via all\u2019front door: l\u2019app controlla nei messaggi in arrivo se \u00e8 una risposta di statistiche, e accettava qualunque messaggio che nominasse le statistiche \u2014 cosa che ogni campione fa. Cos\u00ec la scheda diceva \u201cnessuna misura ancora\u201d su ogni telecamera, per sempre, mentre i dati arrivavano da subito.',
      ],
    },
  },
  {
    version: '1.0.507',
    date: '2026-09-19',
    notes: {
      en: [
        'A camera that reports neither a battery nor a link now gets a chart glyph of its own, which opens the same card and its stream numbers. Those cameras had no badge at all, so the card could not be opened on them — the permanently-powered, wired ones, which are exactly the cameras you are most likely to be investigating.',
      ],
      it: [
        'Una telecamera che non riporta n\u00e9 batteria n\u00e9 collegamento adesso ha un\u2019icona a grafico tutta sua, che apre la stessa scheda e i suoi numeri dello stream. Su quelle telecamere non c\u2019era nessuna icona, quindi la scheda non si poteva aprire \u2014 e sono le telecamere fisse alimentate, cio\u00e8 proprio quelle su cui \u00e8 pi\u00f9 probabile che tu stia indagando.',
      ],
    },
  },
  {
    version: '1.0.506',
    date: '2026-09-19',
    notes: {
      en: [
        'The stream numbers moved to where you can reach them. Tap the battery or link glyph on a camera and the card now also carries the stream: the verdict first — is a frozen picture the network or the decoder? — then the evidence. Frames decoded and whether they are still advancing, freezes and how long they lasted, key-frame requests, loss, latency and the connection path; and from the hub, which profile you are actually being served, whether that stream is native or transcoded here, which node ingests it, and why the quality ladder last moved. The pill on the picture stays as it is: on a phone the panel behind it could never be opened, because the app owns the touches over the player.',
      ],
      it: [
        'I numeri dello stream si sono spostati dove puoi raggiungerli. Tocca l\u2019icona della batteria o del collegamento su una telecamera e la scheda adesso porta anche lo stream: prima il verdetto \u2014 un\u2019immagine bloccata \u00e8 la rete o il decoder? \u2014 e poi le prove. Fotogrammi decodificati e se stanno ancora avanzando, blocchi e quanto sono durati, richieste di key frame, perdita, latenza e il percorso della connessione; e dall\u2019hub, quale profilo ti sta servendo davvero, se quello stream \u00e8 nativo o transcodificato qui, quale nodo lo ingerisce e perch\u00e9 la scala di qualit\u00e0 si \u00e8 mossa l\u2019ultima volta. La pastiglia sull\u2019immagine resta com\u2019\u00e8: sul telefono il pannello dietro non si poteva aprire, perch\u00e9 i tocchi sopra il player appartengono all\u2019app.',
      ],
    },
  },
  {
    version: '1.0.505',
    date: '2026-09-19',
    notes: {
      en: [
        'The stream stats are a real debug tool now, and they stay out of your way. A small pill above the controls carries the verdict, the resolution, the frame rate and the bitrate; tap it for the full panel. The panel answers the question that mattered and could not be answered before: when a picture freezes, is it the network or the decoder? It shows frames decoded, freezes and their duration, key-frame requests, retransmissions, jitter, loss and the ICE path on the client side — and, from the hub, which rung you are actually being served, whether that stream is native or transcoded, which node is ingesting it, and why the quality ladder last moved.',
      ],
      it: [
        'Le statistiche dello stream sono diventate uno strumento di debug vero, e stanno fuori dai piedi. Una pastiglia sopra i controlli porta il verdetto, la risoluzione, i fotogrammi al secondo e il bitrate; toccala per il pannello completo. Il pannello risponde alla domanda che contava e a cui non si poteva rispondere: quando l\u2019immagine si blocca, \u00e8 la rete o il decoder? Mostra i fotogrammi decodificati, i blocchi e quanto sono durati, le richieste di key frame, le ritrasmissioni, jitter, perdita e il percorso ICE lato client \u2014 e, dall\u2019hub, quale profilo ti sta servendo davvero, se quello stream \u00e8 nativo o transcodificato, quale nodo lo sta ingerendo e perch\u00e9 la scala di qualit\u00e0 si \u00e8 mossa l\u2019ultima volta.',
      ],
    },
  },
  {
    version: '1.0.504',
    date: '2026-09-17',
    notes: {
      en: [
        'The Home button on a PTZ camera now tells you when it cannot do anything. It used to send the camera to whichever preset happened to sit in the first slot — on these cameras that was “stanza”, “Credenza” and “Preset1”, nobody\u2019s idea of home — and when that slot was empty it failed in silence. The hub now asks which preset you chose as home, refuses rather than guessing, and the app shows you the refusal instead of swallowing it. Pick one under PTZ settings.',
      ],
      it: [
        'Il pulsante Home su una telecamera PTZ ora ti dice quando non pu\u00f2 fare niente. Prima mandava la telecamera al preset che si trovava nel primo posto \u2014 su queste telecamere erano \u201cstanza\u201d, \u201cCredenza\u201d e \u201cPreset1\u201d, che home non sono \u2014 e quando quel posto era vuoto falliva in silenzio. Adesso l\u2019hub chiede quale preset hai scelto come home, rifiuta invece di indovinare, e l\u2019app ti mostra il rifiuto invece di ingoiarlo. Scegline uno nelle impostazioni PTZ.',
      ],
    },
  },
  {
    version: '1.0.503',
    date: '2026-09-16',
    notes: {
      en: [
        'Pages with camera tiles scroll again on a phone. A tile claimed every touch that landed on it — and on a phone a tile is most of the screen — then did nothing with it, because dragging only pans a tile you have already zoomed into. Now the gesture is yours until you zoom in; pinch and double-tap are unchanged.',
      ],
      it: [
        'Le pagine con i riquadri delle telecamere tornano a scorrere sul telefono. Un riquadro si prendeva ogni tocco che ci finiva sopra — e sul telefono un riquadro e\u2019 quasi tutto lo schermo — e poi non ne faceva niente, perche\u2019 trascinare sposta solo un riquadro in cui hai gia\u2019 zoomato. Ora il gesto resta tuo finche\u2019 non zoomi; pinch e doppio tocco invariati.',
      ],
    },
  },
  {
    version: '1.0.502',
    date: '2026-09-16',
    notes: {
      en: [
        'Zones, above the places: a part of the home that holds several rooms — “Night zone” for the bedrooms. They come first in the filter strip, with their own icon, because it is the coarser question: asking for upstairs should not mean pressing four rooms. Create them on the hub, under Locations.',
        'A camera still belongs to exactly one place, and a place to at most one zone. Nothing about your cameras changed to make this work.',
        'The drawn zones in the rule editor are now called detection zones, which is what they are — so the word is free for the rooms of your home.',
      ],
      it: [
        'Le zone, sopra i luoghi: una parte della casa che tiene più stanze — “Night zone” per le bedrooms. Vengono per prime nella striscia dei filtri, con la loro icona, perché sono la domanda più grossa: chiedere il piano di sopra non deve voler dire premere quattro stanze. Si creano sull’hub, sotto Locations.',
        'Una telecamera resta in un solo luogo, e un luogo in al massimo una zona. Non è cambiato nulla sulle tue telecamere perché questo funzionasse.',
        'Le zone disegnate nell’editor delle regole ora si chiamano zone di rilevamento, che è quello che sono — così la parola resta libera per le stanze di casa.',
      ],
    },
  },
  {
    version: '1.0.501',
    date: '2026-09-16',
    notes: {
      en: [
        'Choosing a place that has nothing in it no longer takes the page away. Pressing Favourites with nothing starred replaced the reel, the selector and the cameras with “no cameras configured” — and took away the control that would have undone it. The reel and the strip stay put; only the list below says it is empty.',
        'The location chips are the size of chips again, and Favourites is in your language.',
      ],
      it: [
        'Scegliere un luogo vuoto non porta più via la pagina. Premere Preferite senza averne sostituiva reel, selettore e camere con “nessuna camera configurata” — e toglieva proprio il comando per tornare indietro. Reel e striscia restano al loro posto; è la lista sotto a dire che è vuota.',
        'I chip dei luoghi sono tornati alti quanto un chip, e Preferite è nella tua lingua.',
      ],
    },
  },
  {
    version: '1.0.500',
    date: '2026-09-16',
    notes: {
      en: [
        'The camera list has a location strip, between the reel and the cameras. Favourites first — with a count, because an empty shortlist is worth knowing before you press into it — then “All”, then every place your cameras actually name. Pressing the place you are already in takes you back out, so a room whose cameras are all offline is never a dead end.',
        'A heart on each camera, top left. Favourites live in your profile and travel with it: share the profile and they go too. They are yours alone otherwise.',
        'A place can carry its own icon, chosen in the hub. A room nobody gave one to shows no icon at all rather than a default — “nobody chose” and “the pin was chosen” are different things.',
      ],
      it: [
        'La lista camere ha una striscia dei luoghi, fra il reel e le camere. Prima le Preferite — col conteggio, perché una lista corta vuota è meglio saperlo prima di entrarci — poi “Tutte”, poi ogni luogo che le tue camere hanno davvero. Premere il luogo in cui sei già ti riporta indietro, così una stanza con tutte le camere offline non è mai un vicolo cieco.',
        'Un cuore su ogni camera, in alto a sinistra. Le preferite stanno nel tuo profilo e viaggiano con lui: condividi il profilo e vanno con quello. Per il resto sono solo tue.',
        'Un luogo può avere la sua icona, scelta sull’hub. Una stanza a cui nessuno l’ha data non disegna nessuna icona invece di una di default — “nessuno ha scelto” e “ha scelto il pin” sono due cose diverse.',
      ],
    },
  },
  {
    version: '1.0.499',
    date: '2026-09-15',
    notes: {
      en: [
        'The debug reasons are the ones you actually use. Nine of them, in your order — the old list had been inferred from a reading of eleven real notes; this one was dictated by the person who reviews with it. “No crop” is gone: a crop that is WRONG and a crop that is ABSENT are two different findings, and one checkbox was blurring them.',
        'A track’s media strip can now show “Gate crop” — the pixels the confirmation gate judged, kept when it refused to confirm a birth. It exists to be argued with: it is the only thing that can say whether the detector was right to drop a sighting.',
      ],
      it: [
        'Le reason di debug sono quelle che usi davvero. Nove, nel tuo ordine — la lista precedente era stata dedotta da una lettura di undici note reali; questa l’ha dettata chi ci rivede. È sparito “nessun ritaglio”: un crop SBAGLIATO e un crop ASSENTE sono due reperti diversi, e una casella sola li confondeva.',
        'La striscia media di una traccia può ora mostrare “Gate crop” — i pixel su cui il confirmation gate ha deciso, tenuti quando ha rifiutato di confermare una nascita. Serve per poterlo contestare: è l’unica cosa che dice se il detector avesse ragione a scartare un avvistamento.',
      ],
    },
  },
  {
    version: '1.0.498',
    date: '2026-09-15',
    notes: {
      en: [
        'The “?” on an events card really does open the assignment now. It was made a button last time and still could not be tapped: it sits in the caption row, which is deliberately transparent to touches so the labels never swallow the card’s own open — and the button inherited that.',
        'Audio on open is no longer one answer for every camera. Alongside “always on” and “always off” there is now “as you left it”, which is the new default: each camera opens the way you last left it, and a camera you have never chosen on opens silent.',
      ],
      it: [
        'Il “?” su una card degli eventi ora apre davvero l’assegnazione. L’ultima volta era diventato un pulsante e restava comunque intoccabile: sta nella riga delle etichette, che è trasparente ai tocchi apposta perché le etichette non si mangino l’apertura della card — e il pulsante ereditava quella trasparenza.',
        'L’audio all’apertura non è più una risposta sola per tutte le camere. Accanto a “sempre acceso” e “sempre spento” c’è ora “come l’hai lasciato”, che è il nuovo default: ogni camera si apre com’era l’ultima volta, e una camera su cui non hai mai scelto si apre muta.',
      ],
    },
  },
  {
    version: '1.0.497',
    date: '2026-09-14',
    notes: {
      en: [
        'You can add a linked device from the camera’s own panel, not only from the cameras list. The panel showed you what was linked and gave you nowhere to add one, so the answer was to leave the camera you were looking at.',
        'The keyboard no longer covers the device picker while you search it. And tapping outside now closes the keyboard first, so a search you were half way through is not thrown away with it.',
      ],
      it: [
        'Puoi aggiungere un dispositivo collegato dal pannello della camera stessa, non solo dalla lista camere. Il pannello ti mostrava cosa era collegato e non ti dava dove aggiungerne uno, quindi la risposta era uscire dalla camera che stavi guardando.',
        'La tastiera non copre più il selettore dei dispositivi mentre lo cerchi. E il tocco fuori ora chiude prima la tastiera, così una ricerca lasciata a metà non se ne va con lei.',
      ],
    },
  },
  {
    version: '1.0.496',
    date: '2026-09-14',
    notes: {
      en: [
        'The “?” on an events card now opens the assignment. It was a label that said a face was waiting for a name and did nothing when you tapped it — so you opened the card and looked for the assignment again, answering a question you had already asked.',
        'A group now shows its PATH: what each of its subjects did, drawn on the picture they were in together, one colour each. Every member already had its own crop in the group; what was missing was where they went.',
      ],
      it: [
        'Il “?” su una card degli eventi ora apre l’assegnazione. Era un’etichetta che diceva che un volto aspettava un nome e non faceva niente al tocco — così aprivi la card e ricercavi l’assegnazione, rispondendo a una domanda che avevi già fatto.',
        'Un gruppo ora mostra il suo PERCORSO: cosa ha fatto ognuno dei suoi soggetti, disegnato sull’immagine in cui erano insieme, un colore per ciascuno. Ogni membro aveva già il suo ritaglio nel gruppo; mancava dove sono andati.',
      ],
    },
  },
  {
    version: '1.0.495',
    date: '2026-09-13',
    notes: {
      en: [
        'Groups with no camera filter now list every camera. Leaving the camera chip untouched means "all of them" here, and it meant "none of them" to the hub — so the gallery came back empty on a system full of groups.',
      ],
      it: [
        'I gruppi senza filtro camera ora elencano tutte le telecamere. Non toccare il chip delle camere qui significa “tutte”, e per l’hub significava “nessuna” — così la galleria tornava vuota su un sistema pieno di gruppi.',
      ],
    },
  },
  {
    version: '1.0.494',
    date: '2026-09-13',
    notes: {
      en: [
        'Administrators can link devices to a camera from the phone \u2014 a doorbell, a sensor, a light \u2014 in the same list the pencil arranges. The picker suggests the devices in that camera’s own room first, and nothing is linked until you pick it.',
      ],
      it: [
        'Gli amministratori possono collegare device a una telecamera dal telefono \u2014 un campanello, un sensore, una luce \u2014 nella stessa lista che la matita riordina. Il selettore suggerisce per primi i device della stanza di quella telecamera, e niente viene collegato finch\u00e9 non lo scegli tu.',
      ],
    },
  },
  {
    version: '1.0.493',
    date: '2026-09-13',
    notes: {
      en: [
        'You can arrange the camera list by hand. A small pencil in the corner turns the list into edit mode, you drag the rows, and a tick saves. Nothing is draggable until you ask \u2014 no more reordering a camera by accident \u2014 and cancelling puts back exactly the order you started with, not the last one saved.',
        'The arrangement is yours and stays on this device. A camera added on the hub appears at the end rather than somewhere unpredictable, and an order can move a camera but can never hide one.',
      ],
      it: [
        'Puoi sistemare la lista delle telecamere a mano. Una piccola matita nell’angolo mette la lista in modifica, trascini le righe, e la spunta salva. Niente \u00e8 trascinabile finch\u00e9 non lo chiedi \u2014 niente più riordini per sbaglio \u2014 e annullare rimette esattamente l’ordine da cui eri partito, non l’ultimo salvato.',
        'La disposizione \u00e8 tua e resta su questo dispositivo. Una telecamera aggiunta sull’hub compare in fondo invece che in un punto imprevedibile, e un ordine pu\u00f2 spostare una telecamera ma non pu\u00f2 mai nasconderla.',
      ],
    },
  },
  {
    version: '1.0.492',
    date: '2026-09-13',
    notes: {
      en: [
        'Three pages can now list GROUPS instead of subjects: the camera timeline, the reel on the cameras page, and the Events gallery. A family walking in together is one entry with several pictures, not four cards. Each page has its OWN switch and each one starts on subjects \u2014 nothing changes until you ask it to, and you can always switch back from the page itself.',
        'A group card shows what the group was made of \u2014 two people and a dog \u2014 and a Live chip while the session is still running. Opening it lists the members, each one linking to its own track.',
        'The reel draws groups as their own strip, with several images per entry and no clustering: two sessions seconds apart are two things that happened, and the old grouping used to swallow one of them.',
        'Filtering understands groups. Picking Dog now finds the arrivals that HAD a dog with them, including the group of four people \u2014 the filter asks about the members, and it runs on the hub rather than on your phone.',
      ],
      it: [
        'Tre pagine possono ora elencare i GRUPPI invece dei soggetti: la timeline della telecamera, il reel nella pagina telecamere e la galleria Eventi. Una famiglia che entra insieme \u00e8 una voce sola con più immagini, non quattro schede. Ogni pagina ha il SUO interruttore e parte dai soggetti \u2014 non cambia nulla finch\u00e9 non lo chiedi tu, e si torna indietro dalla pagina stessa.',
        'La scheda di un gruppo dice di cosa era fatto \u2014 due persone e un cane \u2014 e porta la pastiglia Live finch\u00e9 la sessione \u00e8 in corso. Aprendola trovi i membri, ognuno con il link alla sua traccia.',
        'Nel reel i gruppi hanno una striscia propria, con più immagini per voce e senza raggruppamento: due sessioni a pochi secondi di distanza sono due cose successe, e il vecchio accorpamento se ne mangiava una.',
        'Il filtro capisce i gruppi. Scegliere Cane ora trova gli arrivi che AVEVANO un cane con loro, compreso il gruppo di quattro persone \u2014 il filtro chiede dei membri, e gira sull’hub invece che sul telefono.',
      ],
    },
  },
  {
    version: '1.0.491',
    date: '2026-09-13',
    notes: {
      en: [
        'The movable window now carries the stream’s own controls: audio, talk-back, picture-in-picture, and a button that opens that camera full-screen. They are the same controls as the single-camera screen \u2014 the same code, so they cannot drift apart.',
        'The resize corner wore the FULLSCREEN icon, so the grip was signing the wrong action. It now looks like every other control in the app.',
        'The heatmap in that window only ever drew recordings. Motion and audio were never missing from the hub \u2014 the window was handing the bar an empty list. Both lanes are there now. Detections are deliberately still absent: loading them costs a few hundred kilobytes, which a floating panel over a live stream should not spend.',
        'Exports and the hub’s own files are ONE section, now called Media. An export finally has a detail view and plays in the app instead of only downloading, and the filter is the one from Events \u2014 a chip per facet that says what it is narrowing, instead of a pill that only counted.',
        'You can delete what the hub produced. Until now a timelapse could only be waited out. A video takes its preview still with it, so one card frees both files.',
        'The timeline can show GROUPS instead of subjects: a family arriving together is one card, not three. Off by default \u2014 turn it on in the timeline filters or in Settings. A session still in progress is listed with a Live chip rather than hidden.',
      ],
      it: [
        'La finestra mobile ora porta i comandi dello stream: audio, microfono, picture-in-picture e un pulsante che apre quella telecamera a schermo intero. Sono gli STESSI comandi della schermata singola \u2014 lo stesso codice, quindi non possono divergere.',
        'L’angolo di ridimensionamento portava l’icona dello SCHERMO INTERO: la presa firmava l’azione sbagliata. Ora ha l’aspetto di ogni altro comando dell’app.',
        'La heatmap in quella finestra disegnava solo le registrazioni. Movimento e audio non sono mai mancati dall’hub \u2014 era la finestra a passare alla barra una lista vuota. Ora ci sono entrambi. Le rilevazioni restano fuori di proposito: caricarle costa qualche centinaio di kilobyte, che un pannello sopra uno stream dal vivo non deve spendere.',
        'Gli export e i file prodotti dall’hub sono UNA sezione sola, che ora si chiama Media. Un export ha finalmente una scheda e si riproduce dentro l’app invece di poter solo essere scaricato, e il filtro \u00e8 quello di Eventi \u2014 una pastiglia per faceta che dice cosa sta restringendo, invece di una che contava e basta.',
        'Puoi cancellare quello che ha prodotto l’hub. Fino a ora un timelapse si poteva solo aspettare. Un video porta via anche la sua anteprima, quindi una card libera due file.',
        'La timeline pu\u00f2 mostrare i GRUPPI invece dei soggetti: una famiglia che arriva insieme \u00e8 una card, non tre. Spento di default \u2014 si accende dai filtri della timeline o dalle Impostazioni. Una sessione ancora in corso viene elencata con la pastiglia Live, non nascosta.',
      ],
    },
  },
  {
    version: '1.0.490',
    date: '2026-09-13',
    notes: {
      en: [
        'The movable window resizes properly now. The handle always worked \u2014 the sizes behind it did not: all three snaps came out the same box on a phone, so dragging changed nothing. The grip is finger-sized and no longer shares its corner with the playback controls.',
        'The playback bar inside that window fits the width it is given. It was drawing a full-width bar into a small window with nothing to wrap into, which is why LIVE broke onto two lines and buttons landed on top of each other.',
        'Event thumbnails stop failing to warm. The list was pre-fetching them with the wrong kind of id \u2014 an event’s, where a track’s was needed \u2014 so every pre-fetch missed and the picture had to be fetched again when the card appeared.',
        'Picture-in-picture on app close is gone. It was granted by the system and lost 176 ms later, every time: Apple only starts picture-in-picture in response to something you do, and an app closing is not that. The button on the player still works and survives closing the app.',
      ],
      it: [
        'La finestra mobile ora si ridimensiona davvero. La maniglia ha sempre funzionato \u2014 erano le misure dietro a non funzionare: su telefono tutte e tre le taglie davano la stessa identica finestra, quindi trascinare non cambiava nulla. L’angolo di presa \u00e8 dimensionato per un dito e non se lo contende più con i comandi di riproduzione.',
        'La barra di riproduzione dentro quella finestra si adatta alla larghezza che ha. Prima disegnava una barra intera dentro una finestra piccola senza spazio in cui andare a capo: per questo LIVE finiva su due righe e i pulsanti si sovrapponevano.',
        'Le miniature degli eventi smettono di fallire il precaricamento. La lista le chiedeva con il tipo di id sbagliato \u2014 quello dell’evento invece che quello della traccia \u2014 quindi ogni precaricamento mancava e l’immagine andava richiesta da capo quando la card compariva.',
        'Il picture-in-picture alla chiusura dell’app non c’\u00e8 più. Il sistema lo concedeva e lo perdeva 176 ms dopo, ogni volta: Apple avvia il picture-in-picture solo in risposta a qualcosa che fai tu, e chiudere l’app non lo \u00e8. Il pulsante sul player continua a funzionare e sopravvive alla chiusura.',
      ],
    },
  },
  {
    version: '1.0.489',
    date: '2026-09-13',
    notes: {
      en: [
        'Review: deleting a sample from a person now actually deletes it. The request was never leaving the app — it was looked up in a way that can never find it, so nothing happened and nothing said so.',
        'Review: you can delete parked faces you do not want to keep, and create a new person without leaving the page. Picking a person is a searchable list instead of a row of chips that grew with your gallery.',
        'Review: the similar-groups button kept going quiet after the first pass. It was comparing faces over a wide window and then only showing groups that fell inside a much narrower one, so the matches sitting just outside vanished. One window now — and the button no longer claims a number.',
        'The movable player lost its padlock: it came along with the shared playback bar and did nothing there but swallow your taps.',
        'Opening a camera full-screen now closes the movable window if it was showing that same camera, instead of leaving two pictures of it.',
      ],
      it: [
        'Review: cancellare un campione da una persona ora lo cancella davvero. La richiesta non usciva nemmeno dall’app \u2014 veniva cercata in un modo che non pu\u00f2 trovarla, quindi non succedeva nulla e nulla lo diceva.',
        'Review: puoi cancellare le facce parcheggiate che non vuoi tenere, e creare una nuova persona senza uscire dalla pagina. Scegliere una persona ora \u00e8 una lista con ricerca invece di una fila di pastiglie che cresceva con la tua galleria.',
        'Review: il pulsante dei gruppi simili ammutoliva dopo il primo giro. Confrontava le facce su una finestra ampia e poi mostrava solo i gruppi che cadevano dentro una molto più stretta, quindi le somiglianze appena fuori sparivano. Ora la finestra \u00e8 una sola \u2014 e il pulsante non promette più un numero.',
        'Il player mobile ha perso il lucchetto: arrivava insieme alla barra di riproduzione condivisa e lì non faceva altro che ingoiare i tuoi tocchi.',
        'Aprire una telecamera a schermo intero ora chiude la finestra mobile se mostrava quella stessa telecamera, invece di lasciarne due immagini.',
      ],
    },
  },
  {
    version: '1.0.488',
    date: '2026-09-13',
    notes: {
      en: [
        'The movable player works on the phone now, not only on tablets and wide windows. A button on each camera card summons it without leaving the list, and its title is the CAMERA’s name \u2014 it used to say "Playback", which cannot tell two open windows apart.',
        'The downward swipe on a camera changed hands: one finger goes back, two fingers hand the camera to the movable player and go back. Picture-in-picture is no longer a gesture at all \u2014 it now happens by itself when you close the app on a single camera, because that is the moment your hands are busy pressing Home. There is a switch for it under Stream.',
        'Audio is on when you open a camera. It used to open muted until you found the button.',
        'Settings were reorganised: General (theme, language, press feedback) sits right under Server, the event-vibration switches are gone, and on a tablet or a desktop window the sections lay out in two or three columns instead of one long scroll.',
      ],
      it: [
        'Il player mobile ora funziona anche sul telefono, non solo su tablet e finestre larghe. Un pulsante su ogni scheda telecamera lo apre senza uscire dalla lista, e il titolo \u00e8 il nome della TELECAMERA \u2014 prima diceva "Riproduzione", che non distingue due finestre aperte.',
        'Lo scorrimento verso il basso su una telecamera cambia mano: un dito torna indietro, due dita passano la telecamera al player mobile e tornano indietro. Il picture-in-picture non \u00e8 più un gesto \u2014 ora parte da solo quando chiudi l’app su una singola telecamera, perch\u00e9 quello \u00e8 il momento in cui le mani sono occupate a premere Home. C’\u00e8 un interruttore sotto Streaming.',
        'L’audio \u00e8 attivo quando apri una telecamera. Prima si apriva muta finch\u00e9 non trovavi il pulsante.',
        'Impostazioni riorganizzate: Generale (tema, lingua, vibrazione alla pressione) sta subito sotto Server, gli interruttori di vibrazione sugli eventi sono spariti, e su tablet o finestra desktop le sezioni si dispongono su due o tre colonne invece di una lista lunga.',
      ],
    },
  },
  {
    version: '1.0.487',
    date: '2026-09-13',
    notes: {
      en: [
        'Thumbnails and track media are back. A media file used to be addressed by a composite key that embedded a foreign id, and once every event table got its own numbering those keys started naming the wrong row — a night shot could answer for a different camera. The hub now addresses a media file by its own id, and asks for "the best picture of this track" as its own question. The app had been left on the old address, so every thumbnail it asked for came back missing: the track detail opened empty and the timeline drew nothing.',
        'Playback got a player you can move. Open a recording from anywhere and it keeps playing in a window you can drag and resize, and it survives you navigating elsewhere in the app.',
        'The camera reel lights up when something happens — motion and audio, on by default, with a settings panel to choose what counts. Tapping a camera in the reel now swaps it in place instead of reloading the page, and if you are in playback the new camera opens at the same instant you were watching, not at its own live edge.',
      ],
      it: [
        'Le miniature e i media delle tracce sono tornati. Un file media veniva indirizzato con una chiave composta che conteneva un id altrui, e da quando ogni tabella di eventi ha una sua numerazione quelle chiavi hanno cominciato a nominare la riga sbagliata — uno scatto notturno poteva rispondere per un’altra telecamera. L’hub ora indirizza un media con il suo id, e chiede “la foto migliore di questa traccia” come domanda a sé. L’app era rimasta all’indirizzo vecchio, quindi ogni miniatura che chiedeva tornava mancante: il dettaglio della traccia si apriva vuoto e la timeline non disegnava nulla.',
        'La riproduzione ha un player che puoi spostare. Apri una registrazione da qualsiasi punto e continua in una finestra che puoi trascinare e ridimensionare, e resta lì anche se navighi altrove nell’app.',
        'Il carosello delle telecamere si illumina quando succede qualcosa — movimento e audio, attivi di default, con un pannello per scegliere cosa conta. Toccare una telecamera nel carosello ora la scambia sul posto invece di ricaricare la pagina, e se sei in riproduzione la nuova telecamera si apre allo stesso istante che stavi guardando, non al suo live.',
      ],
    },
  },
  {
    version: '1.0.486',
    date: '2026-09-11',
    notes: {
      en: [
        'The camera timeline now opens on the last hour instead of the last three. Three hours was the density the timeline had always drawn, not a decision about what you want to see when you open a camera — it put whatever just happened in a third of the screen and made the rest yesterday’s scrolling.',
        'Event cards now sit ON the track they describe. The timeline runs newest at the top, so a track ends above and begins below — but the card was anchored by its top edge to the track’s beginning, which hung it under the event, over the minutes before anything happened. Now the card’s bottom edge is where the track starts, so the card covers the subject’s own passage and reading upward follows it.',
      ],
      it: [
        'La timeline della telecamera si apre sull’ultima ora invece che sulle ultime tre. Tre ore erano la densità che la timeline aveva sempre disegnato, non una scelta su cosa serve vedere aprendo una telecamera: mettevano quello appena successo in un terzo di schermo e rendevano il resto lo scroll di ieri.',
        'Le card degli eventi ora stanno SOPRA la traccia che descrivono. La timeline ha il più recente in alto, quindi una traccia finisce sopra e comincia sotto \u2014 ma la card era ancorata col bordo superiore all’inizio della traccia, il che la appendeva sotto l’evento, sui minuti in cui non era ancora successo nulla. Ora il bordo inferiore della card \u00e8 dove la traccia comincia, così la card copre il passaggio del soggetto e leggere verso l’alto lo segue.',
      ],
    },
  },
  {
    version: '1.0.485',
    date: '2026-09-11',
    notes: {
      en: [
        'The app now hangs up when you leave it, and calls back when you return. In the background the phone freezes the app and stops reading, but the connection stayed open — so the hub kept piling up messages for a listener that was asleep. One evening of that was 88 MB held on the hub for a phone nobody was holding. The app now closes the connection as it leaves and opens a new one as it comes back.',
        'Coming back is a normal thing, not a fault: no error, no "offline", nothing emptied. You see a brief "connecting" and the screen you left, and the app re-asks the hub for everything that can have changed while it was away — cameras, batteries, switches, who is in frame — so what you are looking at a second later is current rather than remembered.',
      ],
      it: [
        'L’app ora chiude la linea quando la lasci, e richiama quando torni. In background il telefono congela l’app e smette di leggere, ma la connessione restava aperta — così l’hub continuava ad accumulare messaggi per un ascoltatore che dormiva. Una sera così erano 88 MB tenuti sull’hub per un telefono che nessuno aveva in mano. Ora l’app chiude la connessione mentre esce e ne apre una nuova quando rientra.',
        'Il rientro è una cosa normale, non un guasto: nessun errore, nessun “offline”, niente che si svuota. Vedi un breve “connessione” e la schermata che avevi lasciato, e l’app richiede all’hub tutto quello che può essere cambiato mentre era via — telecamere, batterie, interruttori, chi è inquadrato — così quello che guardi un secondo dopo è attuale e non ricordato.',
      ],
    },
  },
  {
    version: '1.0.484',
    date: '2026-09-11',
    notes: {
      en: [
        'Pinch-to-zoom, the pan while zoomed and the PTZ joystick work again. The crash guard added in 1.0.479 wrapped every gesture handler, and the wrapped handlers were no longer compiled for the UI thread — so each gesture was caught and dropped on every frame instead of running. Nothing was lost on the hub: every dropped gesture was logged, which is how this was found.',
        'The camera timeline filter now lists every detection class that actually appears in the loaded window, even when the hub does not advertise it for that camera. A class you could see on the timeline but not tick in the filter was the hub describing the camera from a momentary status; the viewer no longer hides what it is showing.',
      ],
      it: [
        'Il pinch-to-zoom, lo spostamento da zoomato e il joystick PTZ funzionano di nuovo. La protezione anti-crash aggiunta nella 1.0.479 avvolgeva ogni gestore dei gesti, e i gestori avvolti non venivano più compilati per il thread UI — quindi ogni gesto veniva intercettato e scartato a ogni frame invece di eseguire. Sull’hub non è andato perso nulla: ogni gesto scartato è stato registrato, ed è così che è stato trovato.',
        'Il filtro della timeline della telecamera ora elenca ogni classe di rilevamento che compare davvero nella finestra caricata, anche quando l’hub non la dichiara per quella telecamera. Una classe che vedevi sulla timeline ma non potevi spuntare nel filtro era l’hub che descriveva la telecamera da uno stato momentaneo; il viewer non nasconde più ciò che sta mostrando.',
      ],
    },
  },
  {
    version: '1.0.483',
    date: '2026-09-10',
    notes: {
      en: [
        'On a tablet, turning from portrait to landscape puts the timeline back beside the picture. The app was reading its window size from a notification that sometimes arrived seconds late, or not at all, so it kept laying out for portrait inside a landscape screen until you killed it. It now reads the size of the view you are actually looking at.',
        'The camera reel under the player refreshes in turns instead of all at once. Every card used to ask the hub for a new frame in the same second, every fifteen seconds — thirty captures in a burst, and the slow cameras never made it in time. Now a quarter of the reel takes its turn on each poll, so each card refreshes about every twenty seconds and the hub is never asked for thirty frames at once.',
      ],
      it: [
        'Su tablet, ruotando da verticale a orizzontale la timeline torna accanto all’immagine. L’app leggeva la dimensione della finestra da una notifica che a volte arrivava con secondi di ritardo, o mai, e continuava a impaginare in verticale dentro uno schermo orizzontale finché non la chiudevi. Ora legge la dimensione della vista che stai davvero guardando.',
        'Il nastro delle telecamere sotto il player si aggiorna a turni invece che tutto insieme. Ogni scheda chiedeva all’hub un frame nuovo nello stesso secondo, ogni quindici secondi — trenta catture in raffica, e le telecamere lente non facevano mai in tempo. Ora a ogni giro tocca a un quarto del nastro, così ogni scheda si aggiorna circa ogni venti secondi e all’hub non vengono mai chiesti trenta frame in una volta.',
      ],
    },
  },
  {
    version: '1.0.482',
    date: '2026-09-10',
    notes: {
      en: [
        'When assigning a face fails, it now says why. The failure was caught and thrown away in eight different places \u2014 you saw "could not assign a face" and there was nothing, anywhere, to explain it. The reason is now recorded and reaches the hub, including the case where the server answers but assigns nothing.',
        'The app also stopped narrating itself. Four routine messages \u2014 one per camera tile, several times each \u2014 were more than half of everything it sent to the hub. They are still there in debug mode; what stays are the lines that report something going wrong.',
      ],
      it: [
        'Quando assegnare una faccia fallisce, ora dice perch\u00e9. L’errore veniva catturato e buttato via in otto punti diversi \u2014 tu vedevi \u201cimpossibile assegnare una faccia\u201d e non c’era nulla, da nessuna parte, che lo spiegasse. Ora il motivo viene registrato e arriva all’hub, compreso il caso in cui il server risponde ma non assegna niente.',
        'L’app ha anche smesso di raccontarsi. Quattro messaggi di routine \u2014 uno per riquadro di telecamera, più volte ciascuno \u2014 erano più della metà di tutto ci\u00f2 che spediva all’hub. Restano in modalità debug; quel che resta sempre sono le righe che segnalano qualcosa che non va.',
      ],
    },
  },
  {
    version: '1.0.481',
    date: '2026-09-10',
    notes: {
      en: [
        'Assigning faces no longer freezes the page. "Apply suggestions" writes one group per person, and each group used to wait for the whole gallery to be re-read before the next one started \u2014 six people meant dozens of round trips before you got the screen back. The gallery is now re-read once, when the last group is written. Assigning one face at a time waits only for the card you are looking at.',
        'Scrubbing the timeline had a pulse every 80 ms \u2014 twelve a second, which is a buzz and not detents. It is now paced to feel like clicks, and dragging is lighter for it.',
      ],
      it: [
        'Assegnare le facce non blocca più la pagina. "Applica suggerimenti" scrive un gruppo per persona, e ogni gruppo aspettava che l’intera galleria fosse riletta prima che partisse il successivo \u2014 sei persone significavano decine di andate e ritorni prima di riavere lo schermo. Ora la galleria si rilegge una volta sola, quando l’ultimo gruppo \u00e8 scritto. Assegnando una faccia per volta si aspetta soltanto la scheda che stai guardando.',
        'Lo scrub della timeline aveva una vibrazione ogni 80 ms \u2014 dodici al secondo, che \u00e8 un ronzio e non degli scatti. Ora \u00e8 cadenzata per sembrare clic, e trascinare \u00e8 più leggero.',
      ],
    },
  },
  {
    version: '1.0.480',
    date: '2026-09-10',
    notes: {
      en: [
        'The timeline’s audio bar shows the LEVEL now. It was showing how MANY audio events fell in each slot, painted on the same six-rung meter the live view uses for decibels \u2014 so fifty short clicks in a quiet hour lit every rung, whatever their volume. The hub now works out the average loudness of each slot and the bar draws that: a busy quiet hour reads quiet, one door slam reads loud. A slot with no audio at all draws nothing, because \u201cnothing was heard\u201d and \u201cnothing was measured\u201d are not the same thing.',
        'A gesture that fails no longer takes the app down with it. The joystick and the pinch-zoom ran code that, if it threw, closed the app outright \u2014 three crash reports came from exactly that. Now the gesture is simply dropped and the reason is sent back, so the next one can be fixed instead of guessed at.',
      ],
      it: [
        'La barra audio della timeline mostra finalmente il LIVELLO. Prima mostrava QUANTI eventi audio cadevano in ogni fascia, disegnati sullo stesso misuratore a sei tacche che la vista live usa per i decibel \u2014 così cinquanta clic brevi in un’ora tranquilla accendevano tutte le tacche, qualunque fosse il volume. Ora l’hub calcola la rumorosità media di ogni fascia e la barra disegna quella: un’ora tranquilla ma affollata resta bassa, una porta sbattuta si vede. Una fascia senza audio non disegna nulla, perch\u00e9 \u201cnon si \u00e8 sentito niente\u201d e \u201cnessuno ha misurato\u201d non sono la stessa cosa.',
        'Un gesto che va in errore non porta più giù l’app. Il joystick e lo zoom a pinch eseguivano codice che, se falliva, chiudeva l’app di netto \u2014 tre segnalazioni di crash venivano esattamente da lì. Ora il gesto viene semplicemente ignorato e il motivo viene rimandato indietro, così il prossimo si corregge invece di indovinarlo.',
      ],
    },
  },
  {
    version: '1.0.479',
    date: '2026-09-09',
    notes: {
      en: [
        'Pinch-zoom, second attempt. Yesterday’s fix stopped the box resizing under your fingers, and that turned out to be the wrong half: with the panel set to grow, the picture kept zooming and sliding for a third of a second AFTER you let go \u2014 worst at full zoom, where all of the growth was still pending. The panel now grows under your fingers again, but the player’s own frame never moves: the growth is folded into the zoom itself. Turn on debug mode and a pinch now writes one trace line you can send back.',
        'The app also says far less to the hub: two diagnostics were 72% of everything it shipped \u2014 one of them logged every camera tile twice more just for sitting still while its snapshot aged.',
      ],
      it: [
        'Zoom a pinch, secondo tentativo. La correzione di ieri ha tolto il riquadro che si ridimensionava sotto le dita, e si \u00e8 rivelata la metà sbagliata: col pannello impostato per crescere, l’immagine continuava a zoomare e scivolare per un terzo di secondo DOPO che avevi lasciato \u2014 peggio al massimo, dove restava pendente tutta la crescita. Ora il pannello cresce di nuovo sotto le dita, ma il frame del player non si muove mai: la crescita \u00e8 piegata dentro lo zoom stesso. Con la modalità debug accesa, una pinch scrive una riga di traccia da rimandare indietro.',
        'L’app dice anche molto meno all’hub: due diagnostiche facevano il 72% di tutto ci\u00f2 che spediva \u2014 una di queste rilogga ogni tessera due volte solo per essere rimasta ferma mentre lo snapshot invecchiava.',
      ],
    },
  },
  {
    version: '1.0.478',
    date: '2026-09-09',
    notes: {
      en: [
        'Pinch-zoom on the live view is smooth again. The picture box no longer resizes under your fingers frame by frame — it settles once, after you let go — the pan no longer springs back at the end of a gesture, and the double tap now runs on the UI thread instead of queueing behind the screen. The gesture feels slightly different on purpose: the panel grows after the pinch, not during it.',
      ],
      it: [
        'Lo zoom a pinch sulla vista live è di nuovo fluido. Il riquadro dell’immagine non si ridimensiona più sotto le dita frame per frame — si assesta una volta sola, dopo che hai lasciato — la panoramica non torna più indietro a fine gesto, e il doppio tap gira sul thread della UI invece di accodarsi dietro allo schermo. Il gesto si sente un po’ diverso di proposito: il pannello cresce dopo la pinch, non durante.',
      ],
    },
  },
  {
    version: '1.0.477',
    date: '2026-09-08',
    notes: {
      en: [
        'The debug note’s preset reasons now come from the notes actually written, not from guesswork: “track started late” leads, the thumbnail entry is reworded as “a better frame existed (face/plate)” — which is what gets typed by hand every time — and three reasons that were being typed out are now checkboxes: last frame before the first, two subjects in one track, and a two-wheeler whose rider is outside the keyframe.',
      ],
      it: [
        'Le ragioni preset della nota di debug ora vengono dalle note davvero scritte, non da supposizioni: “traccia partita in ritardo” è la prima, la voce sulla miniatura diventa “c’era un frame migliore (volto/targa)” — che è quello che viene digitato ogni volta — e tre ragioni che venivano scritte a mano sono ora caselle: ultimo frame prima del primo, due soggetti nella stessa traccia, e il conducente di un due ruote fuori dal keyframe.',
      ],
    },
  },
  {
    version: '1.0.476',
    date: '2026-09-08',
    notes: {
      en: [
        'Closing the keyboard in the note dialog is the keyboard’s own button now: on iOS a Done bar sits docked to it, drawn by the system above the keys, instead of a button crowding the card.',
      ],
      it: [
        'Chiudere la tastiera nel dialogo della nota ora è un pulsante della tastiera stessa: su iOS una barra Fatto le sta agganciata, disegnata dal sistema sopra i tasti, invece di un pulsante che toglie spazio alla scheda.',
      ],
    },
  },
  {
    version: '1.0.475',
    date: '2026-09-08',
    notes: {
      en: [
        'The note dialog was a trap with the keyboard up: its buttons sat behind it, a multiline field has no return key, and tapping outside threw the note away. The card now lifts above the keyboard, a tap outside closes the keyboard first, and there is a Close keyboard button while it is open.',
      ],
      it: [
        'Il dialogo della nota era una trappola con la tastiera aperta: i pulsanti restavano dietro, un campo multiriga non ha tasto invio, e toccare fuori buttava via la nota. Ora la scheda si solleva sopra la tastiera, un tocco fuori chiude prima la tastiera, e c’è un pulsante Chiudi tastiera finché è aperta.',
      ],
    },
  },
  {
    version: '1.0.474',
    date: '2026-09-08',
    notes: {
      en: [
        'On a Mac the player still opened the embed page in a browser: the WebView declines that load without reporting an error, so the previous fallback had nothing to react to. The player now watches for silence — if the bundled page has not spoken within six seconds, it loads the same page from the hub.',
      ],
      it: [
        'Su Mac il player apriva ancora la pagina dell’embed nel browser: la WebView rifiuta quel caricamento senza segnalare alcun errore, quindi il fallback precedente non aveva nulla a cui reagire. Ora il player sorveglia il silenzio — se la pagina inclusa non ha parlato entro sei secondi, carica la stessa pagina dall’hub.',
      ],
    },
  },
  {
    version: '1.0.473',
    date: '2026-09-08',
    notes: {
      en: [
        'A sample whose picture is gone now says so, instead of drawing an empty square. Most of the gallery is in that state today — the crops were lost before the panel existed — and the scores beside them are unaffected: they come from the stored vector, which is intact.',
      ],
      it: [
        'Un campione la cui immagine non c’è più ora lo dice, invece di disegnare un quadrato vuoto. Oggi gran parte della galleria è in quello stato — i ritagli erano già andati persi prima che il pannello esistesse — e i punteggi accanto non ne risentono: vengono dal vettore memorizzato, che è intatto.',
      ],
    },
  },
  {
    version: '1.0.472',
    date: '2026-09-08',
    notes: {
      en: [
        'Library → Review can re-analyse one person’s enrolled samples. Worst first, each with its crop and the reason — “looks like Dave (61%) more than like this person (12%)” — and a sample is flagged only when it could actually be auto-assigned to the other person. Remove is one tap, and nothing is removed for you.',
      ],
      it: [
        'Libreria → Revisione può rianalizzare i campioni di una persona. Peggiori in cima, ognuno col suo ritaglio e il motivo — “somiglia a Dave (61%) più che a questa persona (12%)” — e un campione è segnalato solo se potrebbe davvero essere auto-assegnato all’altra persona. Rimuovere è un tocco, e nessuno rimuove niente al posto tuo.',
      ],
    },
  },
  {
    version: '1.0.471',
    date: '2026-09-08',
    notes: {
      en: [
        'Opening the Cameras page now refreshes every camera’s thumbnail, two at a time, once — so the tiles below the fold are minutes old instead of hours. It stops when it has been round the list.',
        'What’s new is a panel now, not a one-line dialog: the build that just arrived is at the top, and every earlier update is listed under it by version and date, tap to open. Settings → Info opens the same panel.',
      ],
      it: [
        'Aprendo la pagina Telecamere ora si aggiorna la miniatura di ogni camera, due alla volta, una sola volta — così i riquadri sotto la piega sono vecchi di minuti e non di ore. Finito il giro, si ferma.',
        'Le novità sono un pannello, non più un avviso a una riga: in alto la build appena arrivata, sotto l’elenco di tutti gli aggiornamenti precedenti per versione e data, che si aprono al tocco. Impostazioni → Info apre lo stesso pannello.',
      ],
    },
  },
  {
    version: '1.0.470',
    date: '2026-09-08',
    notes: {
      en: [
        'The debug checkboxes changed with use: an edge crop that came back mirrored, and a box that does not match the path the track drew — which usually means two subjects ended up sharing one id. "Wrong class" and "audio-only" left; neither was what anyone was actually reporting.',
      ],
      it: [
        'Le caselle di debug sono cambiate con l’uso: un ritaglio sul bordo tornato specchiato, e un box che non coincide col percorso disegnato dalla traccia — che di solito significa due soggetti finiti sullo stesso id. Sono uscite "classe sbagliata" e "solo audio": non era quello che si segnalava davvero.',
      ],
    },
  },
  {
    version: '1.0.469',
    date: '2026-09-08',
    notes: {
      en: [
        'Marking an event for debug now offers the questions that keep coming back as checkboxes, so a mark carries a question without typing one. Ticking one writes its phrase into the note; the field below still takes anything the boxes cannot say.',
      ],
      it: [
        'Marcando un evento per il debug ora trovi come caselle le domande che ricorrono, così una marcatura porta con sé una domanda senza doverla scrivere. Spuntarne una scrive la sua frase nella nota; il campo sotto accetta ancora tutto ciò che le caselle non dicono.',
      ],
    },
  },
  {
    version: '1.0.468',
    date: '2026-09-08',
    notes: {
      en: [
        'The privacy-mask switch now says what is actually missing: no privacy zone is drawn on the camera. It used to give the same general "nothing is set up yet" sentence as every other control, which left no next step — and the next step is on the camera, not in this app.',
      ],
      it: [
        "L'interruttore della maschera privacy ora dice cosa manca davvero: sulla telecamera non è disegnata nessuna zona di privacy. Prima dava la stessa frase generica di ogni altro controllo, che non indicava alcun passo successivo — e il passo successivo è sulla telecamera, non in questa app.",
      ],
    },
  },
  {
    version: '1.0.467',
    date: '2026-09-08',
    notes: {
      en: [
        'Unticking every event kind used to leave invisible leftovers behind, so the list stayed empty and the counters disagreed with the boxes. The leftovers are cleared, and no ticks now means no constraint.',
        'Ticking only Faces or Plates therefore works on its own, across every kind, while narrowing them with a kind still works as before.',
        'A collapsed group now shows a partial mark when something inside it is ticked, so nothing can be on where you cannot see it.',
      ],
      it: [
        "Togliendo la spunta a tutti i tipi di evento restavano dietro dei residui invisibili, così la lista restava vuota e i contatori non coincidevano con le caselle. I residui vengono ripuliti, e nessuna spunta adesso vuol dire nessun vincolo.",
        "Spuntare solo Volti o Targhe funziona quindi da solo, su tutti i tipi, mentre restringerli a un tipo continua a funzionare come prima.",
        "Un gruppo chiuso mostra adesso un segno parziale quando qualcosa al suo interno è spuntato, così niente può essere attivo dove non lo vedi.",
      ],
    },
  },
  {
    version: '1.0.466',
    date: '2026-09-08',
    notes: {
      en: [
        'A filter that matched nothing on the first page used to stop the list from loading any further, so a narrow choice looked empty even when matches existed further back. The list now keeps reading until it finds them.',
        'Plates were the clearest case: they sat four pages deep and were never reached. Faces happened to match early, which is why the same defect looked intermittent.',
        'An empty list now says which kind of empty it is, and offers to load older events instead of ending the road.',
      ],
      it: [
        "Un filtro che non trovava nulla nella prima pagina impediva alla lista di caricare oltre, così una scelta stretta sembrava vuota anche quando i risultati c'erano più indietro. Adesso la lista continua a leggere finché li trova.",
        "Le targhe erano il caso più evidente: stavano quattro pagine più in là e non venivano mai raggiunte. I volti capitavano presto, ed è per questo che lo stesso difetto sembrava intermittente.",
        "Una lista vuota adesso dice di che vuoto si tratta, e propone di caricare gli eventi più vecchi invece di finire lì.",
      ],
    },
  },
  {
    version: '1.0.465',
    date: '2026-09-08',
    notes: {
      en: [
        'The event kinds you already had — Audio, Sensor, Control — now actually filter. Ticking one shows those events, unticking hides them; there is no second filter to find, because the tree you were already using is the one that works.',
        'Audio events start unticked, so the list opens on what you look at. A Default button puts the preset back without re-ticking everything by hand.',
        'The chip counts what you kept in the terms you picked it in, so a default that hides one thing reads as one thing hidden.',
      ],
      it: [
        "I tipi di evento che avevi già — Audio, Sensore, Controllo — adesso filtrano davvero. Spuntandone uno vedi quegli eventi, togliendo la spunta li nascondi, e non c'è un secondo filtro da cercare: quello che usavi è quello che funziona.",
        "Gli eventi audio partono senza spunta, così la lista si apre su quello che guardi. Un pulsante Predefinito rimette il preset senza dover rispuntare tutto a mano.",
        "Il contatore conta quello che hai tenuto nei termini in cui l'hai scelto, così un default che nasconde una cosa si legge come una cosa nascosta.",
      ],
    },
  },
  {
    version: '1.0.464',
    date: '2026-09-07',
    notes: {
      en: [
        'The events page can now filter by where an event came from, and audio-only events start hidden. The filter sits in More with the others, and the chip counts it, so a shorter list always says why it is shorter.',
        'Picking a class used to drag every sensor and audio event along with it, and picking a sensor selected nothing at all. Provenance is now its own axis, so both do what they say.',
        'The Recent strip on the Cameras screen has its own filter, in the same fan menu, showing detections by default and remembering what you choose.',
      ],
      it: [
        "La pagina eventi ora filtra anche per provenienza, e gli eventi di solo audio partono nascosti. Il filtro sta in Altro insieme agli altri e il contatore lo conta, così una lista più corta dice sempre perché lo è.",
        "Scegliere una classe si portava dietro ogni evento di sensore e di audio, e scegliere un sensore non selezionava nulla. La provenienza adesso è un asse suo, quindi entrambi fanno quello che dicono.",
        "La striscia Recenti nella schermata Camere ha un filtro suo, nello stesso menu a ventaglio, che di default mostra le rilevazioni e ricorda quello che scegli.",
      ],
    },
  },
  {
    version: '1.0.463',
    date: '2026-09-07',
    notes: {
      en: [
        'One record button, the same pair of buttons everywhere: press it, then Keep — with the duration on it — or Discard. On the live picture it records forward from now; on the recording it anchors a period you draw with the scrub, in either direction.',
        'Pressing it during playback no longer reports that the live view cannot be recorded, and the period you draw stops at the live edge instead of losing itself there.',
        'While you are drawing a period the timeline no longer buzzes at every step: the notch feedback belongs to looking for an event, not to choosing a moment.',
      ],
      it: [
        "Un solo pulsante di registrazione, e la stessa coppia di pulsanti ovunque: premi, poi Salva — con la durata sopra — oppure Scarta. Sull'immagine live registra da adesso in avanti; sul registrato fissa un periodo che disegni con lo scorrimento, in entrambe le direzioni.",
        "Premendolo durante la riproduzione non dice più che non può registrare la vista live, e il periodo che stai disegnando si ferma al bordo live invece di perdersi.",
        "Mentre disegni un periodo la timeline non vibra più a ogni passo: lo scatto delle tacche serve a cercare un evento, non a scegliere un momento.",
      ],
    },
  },
  {
    version: '1.0.462',
    date: '2026-09-07',
    notes: {
      en: [
        'Save a stretch of the recording from the timeline: press the record button during playback to anchor the period, scrub to the other end, then Save or Discard. The selected period is highlighted on the strip.',
        'While you are choosing, the recording does not play — you see the frame you scrubbed to. Nothing is created on the hub until you press Save, and a period that crosses a stretch with no recording says so before it is exported.',
      ],
      it: [
        "Salva un tratto di registrato dalla timeline: durante la riproduzione premi il pulsante di registrazione per fissare il periodo, scorri fino all'altro estremo, poi Salva o Scarta. Il periodo selezionato è evidenziato sulla striscia.",
        "Mentre scegli la registrazione non parte: vedi il fotogramma su cui ti sei fermato. Sull'hub non viene creato nulla finché non premi Salva, e un periodo che attraversa un tratto senza registrazione lo dice prima di esportare.",
      ],
    },
  },
  {
    version: '1.0.461',
    date: '2026-09-07',
    notes: {
      en: [
        'A host with nowhere to show a tile\'s linked-devices and view-options panels can now say so, and the embed stops drawing two buttons that would do nothing.',
      ],
      it: [
        "Un ospite che non ha dove mostrare i pannelli dispositivi collegati e opzioni di vista può dirlo, e l'embed smette di disegnare due pulsanti che non farebbero nulla.",
      ],
    },
  },
  {
    version: '1.0.460',
    date: '2026-09-06',
    notes: {
      en: [
        'Battery and signal icons are now buttons: tapping one opens the figures — charge, power source, sleeping, link type, signal and Wi-Fi network — on the stream and in the cameras list.',
        'What the camera does not report is said in words, never as a fabricated 0%.',
      ],
      it: [
        "Le icone di batteria e segnale sono diventate pulsanti: toccandone una si aprono i numeri — carica, alimentazione, sospensione, tipo di collegamento, segnale e rete Wi-Fi — sullo stream e nella lista camere.",
        "Ciò che la camera non riporta viene detto a parole, mai come uno 0% inventato.",
      ],
    },
  },
  {
    version: '1.0.459',
    date: '2026-09-06',
    notes: {
      en: ['Home Assistant cards: the embed no longer needs a viewing token in the page — Home Assistant carries it, and the events card URL stops carrying a credential.'],
      it: [
        "Card di Home Assistant: l'embed non ha più bisogno del token nella pagina, lo porta Home Assistant, e l'URL della card eventi smette di trasportare una credenziale.",
      ],
    },
  },
  {
    version: '1.0.458',
    date: '2026-09-06',
    notes: {
      en: ['Robot camera in landscape: with the timeline open the drive buttons move onto the visible picture and shrink to fit; the "…" is gone there, the timeline has its own.'],
      it: ['Camera del robot in landscape: con la timeline aperta i pulsanti di guida passano sul video visibile e si rimpiccioliscono; lì sparisce il "…", la timeline ha già il suo.'],
    },
  },
  {
    version: '1.0.457',
    date: '2026-09-06',
    notes: {
      en: ['A restart for an update waits for the snapshot downloads in flight — the crash right after an update on build 16.'],
      it: ['Il riavvio per un aggiornamento aspetta i download degli snapshot in corso: il crash subito dopo un aggiornamento sulla build 16.'],
    },
  },
  {
    version: '1.0.456',
    date: '2026-09-06',
    notes: {
      en: [
        'An OTA update asks before restarting the app.',
        'A newer TestFlight / store build is announced, with a button to open it.',
        "What's new: these notes, once per version and in Settings → Info.",
      ],
      it: [
        "Un aggiornamento OTA chiede conferma prima di riavviare l'app.",
        'Una build TestFlight / Store più recente viene segnalata, con il pulsante per aprirla.',
        'Novità: queste note, una volta per versione e in Impostazioni → Info.',
      ],
    },
  },
  {
    version: '1.0.455',
    date: '2026-09-06',
    notes: {
      en: [
        'Robot camera: a drive joystick in landscape, with Stop, light, Follow me and Return to dock.',
        'The controls button opens for robot cameras too.',
        'Battery and signal are glyphs in the toolbar; the day arrows fold on a narrow row.',
        'A sleeping camera shows the moon in its name chip.',
      ],
      it: [
        'Camera del robot: joystick di guida in landscape, con Stop, luce, Seguimi e Torna alla base.',
        'Il pulsante dei controlli si apre anche per le camere del robot.',
        'Batteria e segnale sono glifi nella toolbar; le frecce del giorno si ripiegano su riga stretta.',
        'Una camera dormiente mostra la luna nel chip del nome.',
      ],
    },
  },
]

export type WhatsNewLanguage = 'en' | 'it'

/**
 * The running version's notes, and everything that came before it.
 *
 * The whole list is kept — this file has never dropped an entry — and until now
 * only one of them was reachable: the launch dialog showed the current version
 * and Settings showed the same one again. An operator who skipped three updates
 * (or read the dialog while walking away from it) had no way back to what
 * changed. `past` is that way back.
 *
 * `latest` is null on a version with no entry — a dev client, or a build that
 * predates this file. That is not an error and it does not hide the history:
 * `past` still carries everything, so the screen has something true to show
 * rather than an empty panel.
 */
export function whatsNewHistory(version: string | null | undefined): WhatsNewHistory {
  const latest = whatsNewFor(version)
  return { latest, past: WHATS_NEW.filter((entry) => entry !== latest) }
}

export interface WhatsNewHistory {
  /** The entry for the version that is RUNNING — the one to highlight. */
  readonly latest: WhatsNewEntry | null
  /** Every other entry, newest first, exactly as the list is authored. */
  readonly past: readonly WhatsNewEntry[]
}

export function whatsNewFor(version: string | null | undefined): WhatsNewEntry | null {
  if (!version) return null
  return WHATS_NEW.find((e) => e.version === version) ?? null
}

/** The notes in the operator's language, English when a language has none. */
export function whatsNewLines(entry: WhatsNewEntry, language: string): readonly string[] {
  const lang: WhatsNewLanguage = language.toLowerCase().startsWith('it') ? 'it' : 'en'
  const lines = entry.notes[lang]
  return lines.length > 0 ? lines : entry.notes.en
}

/**
 * Show the notes at launch only ONCE per version, and only when there are
 * notes: a version without an entry announces nothing (the spec forbids that
 * for shipped versions; it stays possible on a dev client).
 */
export function shouldShowWhatsNew(lastSeenVersion: string | null, current: string | null | undefined): boolean {
  if (!current) return false
  if (lastSeenVersion === current) return false
  return whatsNewFor(current) !== null
}
