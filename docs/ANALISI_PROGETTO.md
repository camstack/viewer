# CamStack — General Project Analysis

> Generated on 2026-03-01

---

## 1. Purpose and Description

**CamStack** is a multi-platform application (iOS, Android, Web/PWA) built with Expo/React Native that acts as a **universal video feed aggregator** for surveillance cameras.

**Main goal:** Provide a unified interface to view, manage, and control cameras from different platforms (External hub, Separate NVR, ONVIF, RTSP) with support for WebRTC, MJPEG, and RTSP streaming.

**Current version:** `1.0.53` (OTA update)
**Runtime Version (OTA):** `1.0.48`

**Key features:**
- Multi-source: External hub, Separate NVR, ONVIF, RTSP
- Streaming: WebRTC, MJPEG, RTSP
- Detection timeline (motion, objects, persons)
- Videoclips and recordings
- PTZ (Pan-Tilt-Zoom) control
- Associated devices (switch, cover, button) via Home Assistant / External hub
- Picture-in-Picture (iOS)
- Configurable grid layout with drag-and-drop
- EN/IT internationalization
- Automatic OTA updates

---

## 2. Technology Stack

### Framework and Runtime

| Technology | Version | Role |
|------------|---------|------|
| Expo | ~54.0.33 | Main framework |
| React | 19.1.0 | UI library |
| React Native | 0.81.5 | Mobile runtime |
| React Native Web | ~0.21.0 | Web compilation |
| TypeScript | ~5.9.2 | Language |

### Routing and Navigation

| Technology | Version |
|------------|---------|
| expo-router | ~6.0.23 |
| @react-navigation/native | ^7.1.8 |
| @react-navigation/bottom-tabs | ^7.4.0 |

### State Management and Data Fetching

| Technology | Version | Role |
|------------|---------|------|
| Zustand | ^5.0.11 | Global state management |
| @tanstack/react-query | ^5.90.21 | Server state, caching, fetching |
| expo-sqlite | ~16.0.10 | Local persistence (mobile) |

### UI and Components

| Technology | Version | Role |
|------------|---------|------|
| @shopify/flash-list | ^2.0.2 | High-performance lists |
| @dnd-kit/core + sortable | ^6.3.1 / ^10.0.0 | Drag-and-drop (web) |
| react-native-draggable-flatlist | ^4.0.3 | Drag lists (mobile) |
| react-native-reanimated | ~4.1.1 | Native animations |
| react-grid-layout | ^2.2.2 | Grid layout (web) |
| react-native-video | ^6.19.0 | Video player |
| react-native-svg | 15.12.1 | SVG support |

### WebRTC and Streaming

| Technology | Version | Role |
|------------|---------|------|
| react-native-webrtc | ^124.0.7 | WebRTC for RN |
| @external-hub/client | ^1.3.26 | External hub SDK |
| socket.io-client | ^4.8.3 | Real-time WebSocket |
| camstack-webrtc-audio | local | Custom WebRTC audio management |

### Internationalization

| Technology | Version |
|------------|---------|
| i18next | ^25.8.7 |
| react-i18next | ^16.5.4 |
| expo-localization | ~17.0.8 |

---

## 3. Project Structure

```
camstack/
├── app/                          # Expo Router routes (file-based)
│   ├── _layout.tsx              # Root layout with providers
│   ├── index.tsx                # Home page (camera grid)
│   ├── grid-live.tsx            # Live grid (mobile)
│   ├── grid-live.web.tsx        # Live grid (web)
│   ├── (tabs)/                  # Tab group (events, videoclips)
│   ├── fullscreen/              # Fullscreen camera view
│   └── embed/                   # Embed player (External hub)
│
├── src/
│   ├── adapters/                # Camera source adapters (Factory Pattern)
│   ├── components/              # 53 React components (~22K LOC)
│   ├── hooks/                   # 38 custom hooks (~5.4K LOC)
│   ├── store/                   # 11 Zustand stores
│   ├── lib/                     # 26 utility/service libraries
│   ├── db/                      # Database layer (SQLite / IndexedDB)
│   │   ├── schema.ts
│   │   ├── client.ts            # Mobile (SQLite)
│   │   ├── client.web.ts        # Web (IndexedDB)
│   │   └── repositories/        # 8 repositories
│   ├── types/                   # TypeScript definitions
│   ├── contexts/                # React contexts
│   ├── constants/               # Feature flags, detection classes
│   ├── utils/                   # Utility functions
│   ├── theme/                   # Theme and colors
│   ├── polyfills/               # Polyfills for RN
│   └── i18n.ts                  # i18next setup
│
├── modules/
│   └── camstack-webrtc-audio/   # Local WebRTC audio module
│
├── plugins/                     # Native Expo config plugins
│   ├── withAudioSessionControl.js
│   └── withNativeLogCapture.js
│
├── scripts/                     # Build and utility scripts
├── locales/                     # en.json, it.json
├── docs/                        # Technical documentation
│
├── app.config.ts                # Expo config
├── eas.json                     # EAS Build config
├── Dockerfile                   # Docker PWA build
├── docker-compose.yml
├── nginx.conf
└── package.json
```

---

## 4. Database Architecture

**Mobile:** SQLite via `expo-sqlite`
**Web:** IndexedDB via `client.web.ts`

### Schema (12 main tables)

| Table | Responsibility |
|-------|---------------|
| `integration_instances` | External hub, Separate NVR, HA instances (multi-account) |
| `cameras` | Cameras and source configuration |
| `events` | Events cache (detections) |
| `settings` | User settings |
| `accessories` | Associated devices (switch, cover, button) |
| `camera_day_cache` | Timeline cache per camera/day |
| `events_app_cache` | EventsApp API cache |
| `camera_associated_devices` | Camera ↔ associated devices mapping |
| `camera_aspect_ratio` | Aspect ratio cache per camera |

### Repository Layer

- `cameraRepository` — Camera CRUD
- `integrationInstanceRepository` — Integration management
- `settingsRepository` — User settings
- `cameraDayCacheRepository` — Timeline cache
- `cameraAspectRatioRepository` — Aspect ratio
- `cameraAssociatedDevicesRepository` — Associated devices
- `eventsAppCacheRepository` — EventsApp cache

---

## 5. Adapters Layer

Implements the **Factory pattern** for a unified multi-source API.

```
src/adapters/
├── base.ts          # BaseCameraAdapter interface
├── separate-nvr.ts       # Separate NVR NVR (WebRTC external restreamer, MJPEG)
├── external-hub.ts      # External hub (WebRTC, PTZ, motion)
├── rtsp.ts          # RTSP/ONVIF (generic stream)
└── index.ts         # createCameraAdapter() factory
```

**BaseCameraAdapter contract:**
- `getLiveStream()` — WebRTC / MJPEG / RTSP handle
- `getResolutions()` — Available resolutions
- `getMotion()` — Observable<boolean> for motion detection
- `getObjectDetections()` — Observable<Detection[]>
- `getStatus()` — Observable<DeviceStatus>
- `getPTZ()` — Pan-tilt-zoom control

---

## 6. Streaming Architecture

### WebRTC Flow
```
Camera (IP camera)
    ↓
external restreamer (Separate NVR) or External hub RTC Server
    ↓
Signaling (HTTP/WebSocket)
    ↓
sharedRtcConnection.ts (single RTCPeerConnection, multi-track)
    ↓
CameraStreamPlayer.tsx
```

### MJPEG/RTSP Flow
```
Camera Stream (HTTP endpoint)
    ↓
buildNvrAssetUrl() / getVideoStreamUrl()
    ↓
<video> tag (web) / react-native-video (mobile)
```

**Note:** `sharedRtcConnection.ts` implements a shared, multi-track peer connection to minimize the overhead of multiple WebRTC connections.

---

## 7. State Management

### Zustand Stores (11 stores)

| Store | Responsibility |
|-------|---------------|
| `cameraStore` | Camera list and selection |
| `eventsStore` | Events and detections |
| `gridStore` | Grid config (layout, zoom) |
| `fullscreenStore` | Fullscreen state |
| `pipStore` | Picture-in-Picture (iOS) |
| `snapshotStore` | Snapshot cache |
| `updateStore` | OTA update state |
| `navigationStore` | Navigation stack |
| `headerStore` | Header visibility |
| `logStore` | In-memory logs |
| `webViewCameraStore` | WebView player state |

### TanStack React Query

- HTTP API call caching (Separate NVR, External hub, EventsApp)
- Background refetching
- Stale-while-revalidate
- `queryClient.ts` as a configured singleton

---

## 8. Custom Hooks (38 hooks)

### Streaming and Camera
- `use-camera-snapshot` — Periodic snapshot refresh
- `use-camera-day-data` — Timeline fetch (motion, events)
- `use-camera-aspect-ratio` — Aspect ratio cache
- `use-stream-health-check` — Stream health monitoring
- `use-stream-zoom-native` — Native RN zoom

### Timeline and Videoclips
- `use-timeline-v2` — Timeline clustering and scrubbing
- `use-nvr-scrub-controller` — NVR timeline scrubbing
- `use-separate-nvr-clips` — Separate NVR videoclips API
- `use-clustered-day-data` — Detection clustering

### Integration
- `use-integration-instances` — Load integration instances
- `use-external-hub-connection-monitor` — Connection monitoring
- `use-prewarm-external-hub-rtc` — External hub RTC pre-warming
- `use-events-app-auth` — EventsApp authentication
- `use-eligible-associated-devices` — Available associated devices

### Controls
- `use-ptz-controller` — Pan-tilt-zoom
- `use-device-status` — Device state (battery, motion)
- `use-device-detection-classes` — Detection classes

### Settings and UI
- `use-general-settings` — User settings
- `use-grid-settings` — Grid layout
- `use-container-size` — Responsive dimensions
- `use-mobile` — Platform detection

### Audio
- `use-audio-volumes` — Streaming volume
- `use-motion-audio` — Audio highlight on motion

---

## 9. Architectural Patterns

| Pattern | Location | Purpose |
|---------|----------|---------|
| **Adapter + Factory** | `src/adapters/` | Unified multi-source API |
| **Repository** | `src/db/repositories/` | Isolated data access layer |
| **Custom Hooks** | `src/hooks/` | Reusable business logic |
| **Zustand Stores** | `src/store/` | Immutable global state |
| **Provider Pattern** | `app/_layout.tsx` | Dependency injection |
| **Observer / Observable** | Adapters | Reactive streams (motion, detection) |
| **Shared Connection** | `lib/sharedRtcConnection.ts` | Multi-track RTCPeerConnection |
| **Service Locator** | `lib/scryptedClientManager.ts` | Shared client per baseUrl |
| **Multi-layer Cache** | SQLite + Memory + React Query | Performant data access |
| **Config Plugin** | `plugins/` | Extend native iOS/Android capabilities |
| **File-based Routing** | `app/` | Declarative navigation |

---

## 10. Supported Platforms

### iOS
- Target: iOS 13+
- Build: EAS Build (cloud)
- Audio: ObjC AudioSession category (custom plugin)
- Background audio: supported
- PiP: expo-pip

### Android
- Target: Android 11+
- Build: EAS Build (cloud)
- Audio: Kotlin native module
- Permissions: CAMERA, INTERNET, RECORD_AUDIO, BLUETOOTH, WAKE_LOCK

### Web / PWA
- Runtime: React Native Web
- Layout: react-grid-layout (desktop)
- Storage: IndexedDB (vs SQLite on mobile)
- Deployment: Docker + nginx
- Embedding: Dedicated build for the external hub notifier plugin

---

## 11. Configuration and Deployment

### Build Variants

| Variant | Bundle ID | OTA Channel |
|---------|-----------|------------|
| `development` | `...camstack.dev` | development |
| `preview` | `...camstack` | preview |
| `production` | `...camstack` | production |

### Expo Configuration (`app.config.ts`)

- New Architecture enabled (`newArchEnabled: true`)
- React Compiler enabled (`reactCompiler: true`)
- Typed routes (`typedRoutes: true`)
- Runtime Version: `1.0.48` (OTA management)
- Configurable base URL (for external hub embedding)

### Docker Web PWA

```dockerfile
# Multi-stage build
Stage 1: node:22-alpine → npm run build:web
Stage 2: nginx:alpine → serve /dist
Port: 3000 → 80
```

### OTA Updates (Expo Updates EAS)

- Separate channels: development, preview, production
- Automatic version bumping via scripts
- `npm run update:patch` → bump + push OTA

---

## 12. Internationalization

- **Supported languages:** EN (English), IT (Italian)
- **Setup:** i18next + react-i18next + expo-localization
- **Fallback:** EN if device language is not supported
- **Files:** `/locales/en.json`, `/locales/it.json` (~200 keys)
- **Usage:** `const { t } = useTranslation()` → `t('key.name')`

---

## 13. Available Scripts

### Development

| Script | Description |
|--------|-------------|
| `npm start` | Expo Go (without dev client) |
| `npm run start:dev` | Metro with dev client (required for WebRTC) |
| `npm run run:ios` | Build + run iOS simulator |
| `npm run run:android` | Build + run Android |
| `npm run web` | Web dev server |
| `npm run lint` | ESLint |
| `npm run ts-check` | TypeScript check |

### Cloud Builds (EAS)

| Script | Description |
|--------|-------------|
| `npm run build:ios` | EAS Build iOS production |
| `npm run build:android` | EAS Build Android production |
| `npm run submit:ios` | Submit to App Store |
| `npm run submit:android` | Submit to Google Play |
| `npm run release:ios:patch` | Bump + build + submit iOS |
| `npm run release:android:patch` | Bump + build + submit Android |

### OTA Updates

| Script | Description |
|--------|-------------|
| `npm run update` | Push OTA to production |
| `npm run update:patch` | Bump patch + OTA |
| `npm run update:minor` | Bump minor + OTA |
| `npm run update:major` | Bump major + OTA |

### Web PWA

| Script | Description |
|--------|-------------|
| `npm run build:web` | Export standalone PWA |
| `npm run build:web:embedded` | Export PWA for an external hub |

---

## 14. Project Statistics

| Metric | Value |
|--------|-------|
| Version | 1.0.53 |
| Language | TypeScript + JavaScript |
| React Components | 53 |
| Custom Hooks | 38 |
| Zustand Stores | 11 |
| Database Repositories | 8 |
| Database Tables | 12 |
| Source Adapters | 3 (Separate NVR, External hub, RTSP) |
| Locales | 2 (EN, IT) |
| LOC src/components | ~22,000 |
| LOC src/hooks | ~5,400 |
| npm Dependencies | 60+ |
| Total Commits | 222+ |

---

## 15. Main Usage Flow

```
1. INTEGRATION SETUP
   User adds an instance (Separate NVR/External hub/ONVIF)
   → Saves credentials in integration_instances
   → Tests connection with adapter

2. ADD CAMERA
   User selects integration → Adapter lists cameras
   → User configures → Saves to cameras table

3. LIVE VIEW
   Load cameras from DB → createCameraAdapter()
   → getLiveStream() → WebRTC setup (sharedRtcConnection)
   → Render CameraStreamPlayer

4. TIMELINE & EVENTS
   use-camera-day-data fetches timeline
   → Cache from camera_day_cache (past days)
   → Fresh from API (today)
   → Clustering → Render DetectionTimelineV2

5. VIDEOCLIPS
   Load clips from Separate NVR/EventsApp
   → Cache in events_app_cache
   → Filter → Play WebRTC/MJPEG
```

---

## 16. Internal Documentation

In the `/docs/` folder:

| File | Topic |
|------|-------|
| `NVR_API_CORS.md` | CORS configuration for Separate NVR API |
| `CREDENTIALS_AUDIT.md` | Credentials security audit |
| `NVR-scrubbing-playback-analysis.md` | NVR scrubbing analysis |
| `NVR_SYNC_ANALYSIS.md` | NVR synchronization analysis |
| `REFACTOR-DetectionTimeline-CameraDetails.md` | Timeline refactor |
| `iOS-web-stack-analysis.md` | iOS/Web stack analysis |

---

## 17. Improvement Areas / TODO

- **ONVIF adapter** — Dedicated ONVIF adapter implementation
- **Separate NVR MQTT** — Real-time events via WebSocket proxy
- **Test coverage** — No automated tests found
- **Error boundary** — More structured error handling at the UI level
- **Internal API documentation** — Public adapter interfaces not documented

---

*Document generated by Claude Code — 2026-03-01*
