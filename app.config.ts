import type { ConfigContext, ExpoConfig } from "expo/config";

// Set APP_VARIANT in .env (development | preview | production)
const { name, bundleIdentifier } = require("./config-shared");
const { getWebMountPrefix } = require("./config-web-base.js");

const scheme = process.env.APP_VARIANT === "development" ? "camstack.dev" : "camstack";

// Web mount prefix: "/" = standalone (app at root); "<base>/camstack/" under
// EXPO_PUBLIC_WEB_BASE_PATH (External hub, HA ingress, the hub's /viewer). The SAME
// helper renders public/index.html and public/manifest.json, so what Expo
// serves under and what the manifest names cannot drift apart again.
const webMountPrefix: string = getWebMountPrefix();

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name,
  slug: "camstack",
  // ONE source of truth for the app version: package.json. It used to be
  // duplicated here, and on 2026-07-29 the two silently diverged — four OTA
  // bumps (v1.0.200 → v1.0.203) moved package.json and left this literal at
  // 1.0.199, so every published bundle reported a version four releases old
  // and the app looked stale when it was current. A second copy of a value is
  // a second thing that can be wrong; there is now only one.
  version: require("./package.json").version,
  // Deliberately NOT derived: `runtimeVersion` is the OTA compatibility pin and
  // must stay FIXED across OTA bumps (it moves only on a native release).
  runtimeVersion: "1.0.643",
  orientation: "default",
  icon: "./assets/images/icon.png",
  scheme,
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: true,
    bitcode: false,
    bundleIdentifier,
    appleTeamId: process.env.EXPO_APPLE_TEAM_ID ?? "C3F24V5NS5",
    buildNumber: "20",
    associatedDomains: ["applinks:camstack.zentik.app"],
    infoPlist: {
      UIBackgroundModes: ["audio"],
      ITSAppUsesNonExemptEncryption: false,
      // The grid embed runs in a WKWebView; talk-back captures the mic via
      // getUserMedia inside the WebView, which requires this usage string.
      NSMicrophoneUsageDescription:
        "CamStack uses the microphone for two-way talk to your cameras.",
      NSLocalNetworkUsageDescription:
        "CamStack uses the local network to reach your hub on Wi-Fi without going through the internet.",
      NSAppTransportSecurity: {
        // LAN HTTP sibling (Network → Local access). Remove when a
        // publicly-trusted LAN name ships (option D).
        NSAllowsLocalNetworking: true,
      },
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#e67e22",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    permissions: [
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.CAMERA",
      "android.permission.INTERNET",
      "android.permission.MODIFY_AUDIO_SETTINGS",
      "android.permission.RECORD_AUDIO",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.WAKE_LOCK",
      "android.permission.BLUETOOTH",
    ],
    package: bundleIdentifier,
    versionCode: 1,
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: "https",
            host: "camstack.zentik.app",
            pathPrefix: "/",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    // The browser/PWA name. Native keeps `name` (CamStack); the web shell and
    // manifest spell this literally too (public/*.template.*).
    name: "CamStack Viewer",
    shortName: "CamStack",
    output: "single",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    ["expo-router", { asyncRoutes: { web: true, default: false } }],
    "expo-dev-client",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#e67e22",
        dark: {
          backgroundColor: "#1c1917",
        },
      },
    ],
    "react-native-video",
    "@config-plugins/react-native-webrtc",
    "expo-pip",
    // SDK 56: modules with config plugins must be listed explicitly
    // (autolinking no longer auto-applies them during prebuild).
    "expo-font",
    "expo-image",
    "expo-localization",
    "expo-secure-store",
    // QR scanner for the device-enrollment code (D855); no microphone.
    [
      "expo-camera",
      {
        cameraPermission:
          "CamStack uses the camera to scan the QR code that links this device to your hub.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    "expo-sharing",
    "expo-sqlite",
    "expo-status-bar",
    "expo-web-browser",
    "./plugins/withAudioSessionControl",
    "./plugins/withNativeLogCapture",
    // LAN HTTP. Not `android.usesCleartextTraffic` — that key is not on
    // ExpoConfig.Android and fails `tsc --noEmit` (viewer CI typecheck).
    "./plugins/withCleartextTraffic",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
    // baseUrl: when set, app and assets are served under this path (e.g. External hub plugin or subfolder)
    ...(webMountPrefix !== "/"
      ? { baseUrl: webMountPrefix.replace(/\/$/, "") }
      : {}),
  },
  extra: {
    // Router root MUST stay pinned to ./app: expo prefers `src/app` when it
    // exists, and our src/ (ex-srcV2) ships a NON-route `src/app` module dir
    // (ServerProvider etc.) — without this pin the route tree silently becomes
    // src/app and every screen 404s to Unmatched Route (OTA 1.0.154/155 bug).
    router: { root: "app" },
    eas: {
      projectId: "8fb06894-6375-41ff-959f-1a22a03dbd73",
    },
  },
  updates: {
    url: "https://u.expo.dev/8fb06894-6375-41ff-959f-1a22a03dbd73",
  },
  owner: "zentik-notifier",
});
