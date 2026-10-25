# Debug schermo nero / stream

## 1. Abilita log RTC (già attivo in dev)

In modalità sviluppo (`npm run start:dev`, `npm run web`) i log WebRTC sono attivi:
- **SharedRtc** (`[SharedRtc]`): connessione condivisa, addTrack, ontrack, ICE
- **EmbedPlayer** (`[EmbedPlayer]`): embed WebView, addCameraTrack/addNvrTrack, video.play()

Controlla la console (browser DevTools su web, Metro/Xcode/Android Studio su native).

## 2. Dove guardare

| Piattaforma | Come vedere i log |
|-------------|-------------------|
| **Web** | DevTools (F12) → Console. Per embed: apri la pagina embed in una tab e usa DevTools |
| **iOS** | Xcode → Console, oppure `npx react-native log-ios` |
| **Android** | `adb logcat` o Android Studio Logcat |
| **App** | Settings → Logs (se configurato) |

## 3. Cosa verificare

1. **`[SharedRtc] setting up shared RTC connection...`** → connessione avviata
2. **`[SharedRtc] shared connection READY`** → signaling OK
3. **`[SharedRtc] tracks received for <deviceId>`** → track video/audio ricevute
4. **`[EmbedPlayer] addCameraTrack OK, mediaStream tracks: 1`** (o 2 con audio) → stream pronto
5. **`[EmbedPlayer] video.play() OK`** → riproduzione avviata

Se manca uno di questi step, il problema è in quel punto.

## 4. Errori comuni

- **addCameraTrack failed** → External hub non raggiungibile, credenziali errate, o camera senza WebRTC
- **No video element** → bug nel render dell’embed
- **video.play() rejected** → autoplay bloccato (prova con `muted`)
- **tracks: 0** → nessun track ricevuto, possibile problema ICE/firewall

## 5. Forzare log in produzione

Aggiungi in `.env`:
```
EXPO_PUBLIC_DEBUG_RTC=true
```

Poi ricompila (`npm run web` o `npm run start:dev`).
