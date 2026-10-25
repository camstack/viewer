# Development Build Setup - Camstack

The app uses **expo-dev-client** because it includes native modules (WebRTC, react-native-video) that do not work with Expo Go.

## Prerequisites

- **macOS**: Xcode (for iOS), Android Studio (for Android)
- **Node.js** 18+
- **CocoaPods** (iOS): `sudo gem install cocoapods`

## Available commands

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Start Metro with dev client (after installing the app) |
| `npm run run:ios` | Build and run on iOS simulator |
| `npm run run:android` | Build and run on Android emulator/device |
| `npm run prebuild` | Generate `ios/` and `android/` directories |
| `npm run prebuild:clean` | Regenerate from scratch (delete and recreate) |

## First run (iOS)

```bash
# 1. Prebuild already done - ios/ and android/ directories exist

# 2. Build and run on simulator
npm run run:ios
```

## First run (Android)

```bash
# 1. Start an Android emulator or connect a device

# 2. Build and run
npm run run:android
```

## Build with EAS (cloud)

To build with EAS Build (Expo Application Services):

```bash
# Install EAS CLI if needed
npm install -g eas-cli

# Login
eas login

# Development build (iOS simulator / Android APK)
eas build --profile development --platform ios
eas build --profile development --platform android
```

Profiles are defined in `eas.json`:
- **development**: for development (simulator: true on iOS)
- **preview**: internal APK for testing
- **production**: production build

## TODO

- **Separate NVR real-time events**: MQTT config is saved but not used. Consider a proxy server (similar to an external hub SDK) that connects to the MQTT broker, subscribes to the NVR event topic, and exposes events via WebSocket/SSE to the mobile client.

## Notes

- Use **camstack.xcworkspace** (not .xcodeproj) to open the project in Xcode
- After changes to `app.json` or plugins, run `npm run prebuild:clean` and rebuild
