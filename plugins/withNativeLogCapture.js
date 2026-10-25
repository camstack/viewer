/**
 * Expo config plugin: withNativeLogCapture
 *
 * Injects native log capture:
 *   - iOS: NativeLogModule.m uses RCTAddLogFunction to write logs to a JSON file
 *   - Android: NativeLogModule.kt provides readLogs/clearLogs (file-based)
 */

const { withXcodeProject, withDangerousMod, withMainApplication } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// iOS: inject NativeLogModule.m and add to Xcode project
// ---------------------------------------------------------------------------

function withNativeLogIOS(config) {
  config = withDangerousMod(config, [
    "ios",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const appName = cfg.modRequest.projectName;
      const srcFile = path.join(projectRoot, "plugins", "NativeLogModule.ios.m");
      const destDir = path.join(projectRoot, "ios", appName);
      const destFile = path.join(destDir, "NativeLogModule.ios.m");

      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, destFile);
      }
      return cfg;
    },
  ]);

  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const appName = cfg.modRequest.projectName;
    const fileName = "NativeLogModule.ios.m";
    const filePath = `${appName}/${fileName}`;

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

    if (appGroupKey) {
      const appGroup = project.hash.project.objects.PBXGroup[appGroupKey];
      const alreadyAdded = appGroup.children.some((child) => child.comment === fileName);
      if (!alreadyAdded) {
        project.addSourceFile(filePath, null, appGroupKey);
      }
    } else {
      project.addSourceFile(filePath);
    }

    return cfg;
  });

  return config;
}

// ---------------------------------------------------------------------------
// Android: inject Kotlin module and register package
// ---------------------------------------------------------------------------

function withNativeLogAndroid(config) {
  config = withDangerousMod(config, [
    "android",
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const androidPackage = cfg.android?.package || "com.apocaliss92.camstack.dev";
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

      const moduleTemplate = fs.readFileSync(
        path.join(projectRoot, "plugins", "NativeLogModule.kt"),
        "utf8"
      );
      const packageTemplate = fs.readFileSync(
        path.join(projectRoot, "plugins", "NativeLogPackage.kt"),
        "utf8"
      );

      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(
        path.join(destDir, "NativeLogModule.kt"),
        moduleTemplate.replace(/\{\{PACKAGE_NAME\}\}/g, androidPackage)
      );
      fs.writeFileSync(
        path.join(destDir, "NativeLogPackage.kt"),
        packageTemplate.replace(/\{\{PACKAGE_NAME\}\}/g, androidPackage)
      );

      return cfg;
    },
  ]);

  config = withMainApplication(config, (cfg) => {
    const contents = cfg.modResults.contents;
    const packageImport = "NativeLogPackage";

    if (!contents.includes(packageImport)) {
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
// Main plugin
// ---------------------------------------------------------------------------

function withNativeLogCapture(config) {
  config = withNativeLogIOS(config);
  config = withNativeLogAndroid(config);
  return config;
}

module.exports = withNativeLogCapture;
