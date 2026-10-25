/**
 * Expo config plugin: withAudioSessionControl
 *
 * Injects native audio session control into the app:
 *   - iOS: ObjC category on WebRTCModule (uses RTCAudioSession)
 *   - Android: Kotlin native module + ReactPackage registration
 */

const {
  withXcodeProject,
  withDangerousMod,
  withMainApplication,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// iOS: inject ObjC category file and add to Xcode project
// ---------------------------------------------------------------------------

function withAudioSessionIOS(config) {
  // Step 1: Copy the .m file into the iOS project folder
  config = withDangerousMod(config, [
    "ios",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const appName = cfg.modRequest.projectName;
      const srcFile = path.join(
        projectRoot,
        "plugins",
        "audioSessionControl.ios.m"
      );
      const destDir = path.join(projectRoot, "ios", appName);
      const destFile = path.join(destDir, "WebRTCModule+AudioSessionControl.m");

      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, destFile);
      }
      return cfg;
    },
  ]);

  // Step 2: Add the .m file to the Xcode project Sources build phase
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const appName = cfg.modRequest.projectName;
    const fileName = "WebRTCModule+AudioSessionControl.m";
    const filePath = `${appName}/${fileName}`;

    // Get the main group (app target group)
    const mainGroup = project.getFirstProject().firstProject.mainGroup;
    const appGroupKey = Object.keys(project.hash.project.objects.PBXGroup).find(
      (key) => {
        const group = project.hash.project.objects.PBXGroup[key];
        return (
          typeof group === "object" &&
          group.name === appName &&
          Array.isArray(group.children)
        );
      }
    );

    // Check if already added
    if (appGroupKey) {
      const appGroup = project.hash.project.objects.PBXGroup[appGroupKey];
      const alreadyAdded = appGroup.children.some(
        (child) => child.comment === fileName
      );
      if (!alreadyAdded) {
        project.addSourceFile(filePath, null, appGroupKey);
      }
    } else {
      // Fallback: add to the project root
      project.addSourceFile(filePath);
    }

    return cfg;
  });

  return config;
}

// ---------------------------------------------------------------------------
// Android: inject Kotlin module and register package
// ---------------------------------------------------------------------------

function withAudioSessionAndroid(config) {
  // Step 1: Copy Kotlin files into the Android source directory
  config = withDangerousMod(config, [
    "android",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const androidPackage =
        cfg.android?.package || "com.apocaliss92.camstack.dev";
      const packagePath = androidPackage.replace(/\./g, "/");
      const destDir = path.join(
        projectRoot,
        "android",
        "app",
        "src",
        "main",
        "java",
        ...packagePath.split("/")
      );

      // Read templates and replace package placeholder
      const moduleTemplate = fs.readFileSync(
        path.join(projectRoot, "plugins", "AudioSessionControlModule.kt"),
        "utf8"
      );
      const packageTemplate = fs.readFileSync(
        path.join(projectRoot, "plugins", "AudioSessionControlPackage.kt"),
        "utf8"
      );

      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(
        path.join(destDir, "AudioSessionControlModule.kt"),
        moduleTemplate.replace(/\{\{PACKAGE_NAME\}\}/g, androidPackage)
      );
      fs.writeFileSync(
        path.join(destDir, "AudioSessionControlPackage.kt"),
        packageTemplate.replace(/\{\{PACKAGE_NAME\}\}/g, androidPackage)
      );

      return cfg;
    },
  ]);

  // Step 2: Register the package in MainApplication.kt
  config = withMainApplication(config, (cfg) => {
    const contents = cfg.modResults.contents;
    const packageImport = "AudioSessionControlPackage";

    // Only add if not already present
    if (!contents.includes(packageImport)) {
      // Add the package to getPackages()
      cfg.modResults.contents = contents.replace(
        /PackageList\(this\)\.packages\.apply\s*\{/,
        `PackageList(this).packages.apply {\n              add(${packageImport}())`
      );
    }

    return cfg;
  });

  return config;
}

// ---------------------------------------------------------------------------
// iOS: Set WebRTC audio config to Playback before React Native starts
// (starts without mic, no orange dot; mic only when user activates it)
// ---------------------------------------------------------------------------

function withWebRTCEarlySetup(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const appName = cfg.modRequest.projectName || "CamStackDev";
      const appDelegatePath = path.join(
        projectRoot,
        "ios",
        appName,
        "AppDelegate.swift"
      );

      if (fs.existsSync(appDelegatePath)) {
        let contents = fs.readFileSync(appDelegatePath, "utf8");

        if (!contents.includes("camstack_webrtc_audio")) {
          // Swift 6 (Expo SDK 57) emits `internal import Expo` and requires a
          // consistent access level across imports of the same module — a bare
          // `import camstack_webrtc_audio` fails with "ambiguous implicit access
          // level ... imported as 'internal' elsewhere". Match the access level.
          contents = contents.replace(
            /import Expo\s/,
            "import Expo\ninternal import camstack_webrtc_audio\n"
          );
        }

        const configureCall = "    WebRTCAudioDeviceSetup.configure()\n\n";
        const methodStart =
          "  public override func application(\n    _ application: UIApplication,\n    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil\n  ) -> Bool {";

        if (!contents.includes("WebRTCAudioDeviceSetup.configure()")) {
          contents = contents.replace(
            methodStart,
            methodStart + "\n" + configureCall
          );
        }

        fs.writeFileSync(appDelegatePath, contents);
      }

      return cfg;
    },
  ]);
}

// ---------------------------------------------------------------------------
// Main plugin
// ---------------------------------------------------------------------------

function withAudioSessionControl(config) {
  config = withWebRTCEarlySetup(config);
  config = withAudioSessionIOS(config);
  config = withAudioSessionAndroid(config);
  return config;
}

module.exports = withAudioSessionControl;
