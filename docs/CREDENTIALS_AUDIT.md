# Audit Credenziali - CamStack

## Riepilogo

**Stato attuale: CREDENZIALI IN CHIARO NEL DATABASE**

Le credenziali (password, token) sono salvate in chiaro nelle tabelle SQLite/IndexedDB. Non viene usato `expo-secure-store` nonostante sia presente nel progetto.

---

## 1. Dove sono memorizzate le credenziali

### 1.1 Tabella `integration_instances` (colonna `config`)

JSON con credenziali in chiaro per tipo:

| Tipo      | Campi sensibili                    |
|-----------|------------------------------------|
| external hub  | `username`, `password`             |
| separate NVR   | `username`, `password`, `token`    |
| ha        | `token`                            |
| separate NVR   | `mqttUsername`, `mqttPassword`     |

**File:** `src/db/repositories/integrationInstanceRepository.ts`  
**Storage:** SQLite (native) / IndexedDB (web) — **non cifrato**

### 1.2 Tabella `cameras` (colonna `source_config`)

JSON con override credenziali per camera:
- `username`, `password`, `token` (External hub/Separate NVR/HA)

**File:** `src/db/repositories/cameraRepository.ts`  
**Storage:** SQLite (native) / IndexedDB (web) — **non cifrato**

### 1.3 Tabella `settings`

Non contiene credenziali. Solo preferenze UI (tema, lingua, ecc.).

### 1.4 Cache `events_app_cache`

Non contiene credenziali. Solo risposte API (eventi, videoclip). La `cache_key` include `baseUrl` ma non password/token.

---

## 2. Backup / Export

**File:** `src/lib/exportBackup.ts`

Il backup esporta:
- `integrationInstances` con `config` completo (password, token)
- `cameras` con `source_config` completo (password, token)

Il file di backup è JSON in chiaro. Chi ha accesso al file ha accesso a tutte le credenziali.

---

## 3. Seed da variabili d'ambiente

**File:** `src/db/seed.ts`

Usa `EXPO_PUBLIC_SEED_*` per inserire credenziali nel DB al primo avvio:
- `EXPO_PUBLIC_SEED_SCRYPTED_PASSWORD`
- `EXPO_PUBLIC_SEED_NVR_PASSWORD`
- `EXPO_PUBLIC_SEED_NVR_TOKEN`
- `EXPO_PUBLIC_SEED_HA_TOKEN`
- `EXPO_PUBLIC_SEED_*_USERNAME`

Le variabili `EXPO_PUBLIC_*` sono incluse nel bundle e visibili nel codice sorgente dell’app.

---

## 4. expo-secure-store

- Presente in `package.json` ma **non usato** nel codice.
- Disponibile solo su iOS e Android (Keychain / Keystore).
- Su web non esiste un equivalente sicuro; `localStorage` non è adatto per credenziali.

---

## 5. Flusso attuale delle credenziali

```
[Form integrazione] → createIntegrationInstance / updateIntegrationInstance
                     → config JSON con password/token
                     → INSERT/UPDATE integration_instances (config in chiaro)

[Form camera]        → insertCamera / updateCamera
                     → source_config JSON con password/token
                     → INSERT/UPDATE cameras (source_config in chiaro)

[Lettura]            → getAllIntegrationInstances / getCameraById
                     → JSON.parse(config) → password/token in memoria
                     → ExternalHubClientManager, eventsAppApi, ecc.
```

---

## 6. Raccomandazioni

### Priorità alta

1. **Migrare credenziali su SecureStore (iOS/Android)**
   - Salvare `password`, `token`, `mqttPassword` in SecureStore con chiavi tipo `cred_inst_{id}`, `cred_cam_{id}`.
   - Nel DB mantenere solo metadati (baseUrl, username senza password).
   - Creare un layer `credentialStore` che legge da SecureStore quando disponibile.

2. **Escludere credenziali dal backup**
   - In export: non includere `password`, `token`, `mqttPassword` in `config` e `source_config`.
   - In import: richiedere all’utente di reinserire le credenziali, oppure gestire un formato backup cifrato (più complesso).

3. **Rimuovere password dal seed**
   - Non usare `EXPO_PUBLIC_*` per password/token.
   - Usare solo variabili non pubbliche (es. da build-time) o eliminare il seed con credenziali.

### Priorità media

4. **Web**
   - Su web SecureStore non è disponibile.
   - Opzioni: avvisare che le credenziali non sono protette, oppure non salvarle e chiedere login a ogni sessione.

5. **Migrazione dati esistenti**
   - Script di migrazione che legge credenziali dal DB e le sposta in SecureStore, poi le rimuove dal DB.

### Priorità bassa

6. **Cifratura del DB**
   - expo-sqlite supporta SQLCipher per cifrare l’intero DB; richiede modifiche più invasive.

---

## 7. File da modificare per la migrazione

| File | Modifica |
|------|----------|
| `src/db/repositories/integrationInstanceRepository.ts` | Non salvare password/token in config; usare credentialStore |
| `src/db/repositories/cameraRepository.ts` | Non salvare password/token in source_config; usare credentialStore |
| `src/lib/credentialStore.ts` (nuovo) | Layer SecureStore + fallback DB per web |
| `src/lib/exportBackup.ts` | Escludere credenziali dall’export |
| `src/db/seed.ts` | Rimuovere password da EXPO_PUBLIC_* |
| Tutti i consumer di config | Leggere credenziali da credentialStore invece che da config |

---

## 8. Riferimenti

- [expo-secure-store](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [OWASP Mobile Security - Secure Storage](https://owasp.org/www-project-mobile-top-10/)
