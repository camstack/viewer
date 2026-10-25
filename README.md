# Camstack

A multi-source camera app for React Native (Expo) supporting External hub, Separate NVR, ONVIF, and RTSP streams.

## Features

- Multiple camera sources: External hub, Separate NVR, ONVIF, RTSP
- WebRTC, MJPEG, and RTSP streaming
- Accessory hooks: Home Assistant, External hub
- SQLite local storage
- PWA support with responsive layout
- Internationalization (i18n)

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

   For development builds (required for WebRTC), see [DEVELOPMENT.md](./DEVELOPMENT.md).

## Platforms

- **Web/PWA**: `npx expo start --web`
- **iOS/Android**: Requires a development build (see [DEVELOPMENT.md](./DEVELOPMENT.md))

### PWA shell

`public/index.html` and `public/manifest.json` are RENDERED from
`public/index.template.html` / `public/manifest.template.json` by
`scripts/write-manifest-for-build.js` (every `build:web` target runs it; the
committed outputs are the root render for `npm run web`). Edit the templates.
The shell declares `viewport-fit=cover` and the iOS status-bar meta — that is
what makes `useSafeAreaInsets()` non-zero in an installed web app — and links
the manifest absolutely under the mount prefix, so "Add to Home Screen" works
from any route, not only from the mount root. An icon added before this
(a Safari bookmark, not an app) does not upgrade itself: remove it and add the
app again once.

## Docker (PWA)

The hosted PWA (https://camstack.zentik.app) is the web export at base path `/`,
served by `web-server/server.ts` (Node 24, no dependencies): static files, the
SPA fallback, `/health`, and the Universal/App Link pair
(`/.well-known/apple-app-site-association`, `/apple-app-site-association`,
`/.well-known/assetlinks.json`). The hub-embedded build (`npm run build:orchestrator`,
base `/viewer`) is a different artifact and is not affected.

```bash
docker build -t camstack-pwa .
docker run -p 8080:8080 -e CAMSTACK_ANDROID_CERT_SHA256=<sha256,...> camstack-pwa
# or, after npm run build:web:
PORT=8080 node web-server/server.ts
```

## Deployment (Railway)

Deploys are done by Railway's native GitHub integration: the Railway service (project
"Camstack", service `viewer-pwa`) has this repository (branch `main`, root `/`) as its source and
builds the `Dockerfile` on every push (`railway.json`: healthcheck `/health`). No workflow deploys
it — two mechanisms deploying one service is how you end up debugging which of them shipped.

**Setup:** on the Railway service, `APP_VARIANT` + `EXPO_PUBLIC_APP_VARIANT` (`production`),
`CAMSTACK_ANDROID_CERT_SHA256` (comma-separated SHA-256 signing-cert fingerprints; empty is a valid
file that simply fails Android auto-verification) and the custom domain `camstack.zentik.app`
(Cloudflare record DNS-only, so Railway can issue the certificate).

## Learn more

- [Expo documentation](https://docs.expo.dev/)
- [Separate NVR docs](https://docs.frigate.video/)
- [External hub developer](https://developer.scrypted.app/)
