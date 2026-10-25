# Library → Review — applicare i suggerimenti in blocco, e un modal gruppi che sa chi conosci

Data: 2026-09-01 · stato: approvato in brainstorming, non implementato

Tocca: `src/screens/faces/FaceReviewScreen.tsx`,
`src/components/faces/FaceReviewAnalyzeModal.tsx`,
`src/data/face-cluster-review.ts`.

## 1. "Applica suggerimento" su una selezione

### Cosa c'è oggi

La barra di selezione (`FaceReviewScreen.tsx:455-472`) ha **una sola** azione:
*Assegna*, che apre la sheet e fa scegliere **una** identità per tutta la
selezione. Confermare il suggerimento di un volto esiste
(`onConfirmSuggestion`, riga 264) ma è raggiungibile **solo dal modal di
dettaglio, un volto alla volta**.

Quindi su una selezione di volti incerti non c'è strada praticabile: o si
aprono uno per uno, o si forzano tutti sulla stessa persona — sbagliato, perché
ogni volto porta il **proprio** suggerimento (`suggestedIdentityId` è per-riga,
"THIS face's own recognizer suggestion, never a cluster's").

### Cosa cambia

Un secondo pulsante nella barra di selezione: **Applica suggerimento**. Assegna
ogni volto selezionato alla **propria** identità suggerita — N volti possono
finire su N persone diverse, in una sola azione.

**Il pulsante è disabilitato se la selezione è mista** (decisione operatore).
Abilitato solo quando **ogni** volto selezionato ha un `suggestedIdentityId`.
Quando è disabilitato dice perché — quanti dei selezionati non hanno un
suggerimento — così lo stato disabilitato non è muto.

Conseguenza voluta: nessun lavoro scartato in silenzio. O l'azione vale per
tutta la selezione, o non parte.

L'etichetta porta il conteggio (*Applica 7 suggerimenti*), e la certezza non è
un filtro: **anche le incerte si applicano** se selezionate — è esattamente il
caso d'uso richiesto. La certezza resta visibile per riga (`FaceConfidenceBar`),
perché è ciò su cui l'operatore decide *prima* di selezionare.

### Scrittura

Riusa `assignMany`, raggruppando i volti per `suggestedIdentityId`: una
chiamata di assegnazione per identità, non una per volto.

## 2. Il modal dei gruppi

### Cosa c'è oggi, e cosa non è vero

**"Non si possono rimuovere elementi dal gruppo"** — la funzione esiste
(`toggleExclusion`, righe 230-245, con `toggleGroupFaceExclusion` nel modello),
ma vive **dentro il `CarouselPager`**: un membro visibile alla volta, con una
✕ da 11 px in overlay. Per togliere 3 volti da un gruppo di 9 bisogna sfogliare
il carosello uno a uno. La funzione c'è; la strada per arrivarci no.

**"Non si può selezionare una known face"** — vero, e con un lato pericoloso.
Il modal risolve il nome digitato contro le identità esistenti
(`resolveIdentityByName`, case-insensitive sul trim), quindi scrivere "carol"
riusa Carol. Ma non esiste **nessun selettore**: bisogna ricordare e digitare
il nome esatto. Un refuso non riusa niente — **crea una seconda identità in
silenzio**.

### Cosa cambia

**Il campo di testo libero sparisce.** Decisione operatore: nel modal gruppi si
sceglie **soltanto** fra le persone note; una persona nuova si crea prima,
altrove. Il modal smette quindi di poter creare identità.

- ogni gruppo ha un **selettore di persona nota**, non un input;
- il `proposedName` del clustering resta, ma come **pre-selezione**: se combacia
  con una identità esistente il selettore parte già su quella, altrimenti il
  gruppo parte senza scelta e non viene scritto finché l'operatore non ne fa una;
- `createIdentity` esce da questo percorso, e con lui `resolveIdentityByName`
  se nessun altro lo usa — codice cancellato si porta via i suoi residui,
  altrimenti resta a descrivere un design che non esiste più;
- `buildAnalyzeAssignPlan` passa da "nome digitato" a `identityId`.

**La griglia dei membri sostituisce il carosello per l'esclusione.** I membri
del gruppo si vedono tutti insieme, ognuno con il suo stato incluso/escluso a
un tap. Il carosello resta accettabile per *guardare* un gruppo grande, ma non
può essere l'unica strada per *modificarlo*.

## Test

- **Applica suggerimento**: abilitato solo a selezione omogenea; disabilitato e
  con motivo su selezione mista; raggruppamento per identità (N volti → una
  chiamata per identità, non N).
- **Modal gruppi**: un gruppo senza persona scelta **non** viene scritto; la
  pre-selezione dal `proposedName` aggancia l'identità giusta; l'esclusione di
  un membro dalla griglia lo tiene fuori dalla scrittura e muove i conteggi di
  testata, dialogo di conferma e banner insieme (proprietà già garantita oggi,
  che non deve regredire cambiando il contenitore).
- Ogni gate verificato **per disarmo**: tolto il fix, la spec deve diventare
  rossa.
