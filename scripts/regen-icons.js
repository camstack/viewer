/*
 * Regenerate app icons from a single square source image.
 * Based on zentik-notifier/scripts/regen-icons.js
 *
 * Source: assets/logos/logoV2/Icon-iOS-Default-1024x1024@1x.png
 * Run: npm run regen:icons
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const projectRoot = path.resolve(__dirname, "..");
const srcImagePath = path.join(
  projectRoot,
  "assets",
  "logos",
  "logoV2",
  "Icon-iOS-Default-1024x1024@1x.png"
);

// Targets for app.config.ts (icon, favicon, splash, android adaptive)
const targets = [
  { path: "assets/images/icon.png", width: 1024, height: 1024 },
  { path: "assets/images/favicon.png", width: 192, height: 192 },
  { path: "assets/images/splash-icon.png", width: 1024, height: 1024 },
  { path: "assets/images/android-icon-foreground.png", width: 1024, height: 1024 },
];

// PWA icons for web manifest (public/ is copied to dist on export)
const pwaSizes = [72, 96, 128, 144, 152, 192, 384, 512];

// Android adaptive icon background: solid color #E6F4FE (from app.config)
const ANDROID_BG_COLOR = "#E6F4FE";

async function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
}

async function fileExists(p) {
  try {
    await fs.promises.access(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function createSolidColorPng(width, height, hexColor, outputPath) {
  await ensureDirFor(outputPath);
  const [r, g, b] = hexColor
    .replace("#", "")
    .match(/.{2}/g)
    .map((x) => parseInt(x, 16));
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r, g, b, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  await fs.promises.writeFile(outputPath, buffer);
  console.log(`Generated ${outputPath} (solid ${hexColor})`);
}

async function createMonochromeIcon(srcImagePath, outputPath, size = 1024) {
  await ensureDirFor(outputPath);
  const buffer = await sharp(srcImagePath)
    .resize(size, size, { fit: "cover" })
    .grayscale()
    .png()
    .toBuffer();
  await fs.promises.writeFile(outputPath, buffer);
  console.log(`Generated ${outputPath} (grayscale)`);
}

async function main() {
  if (!(await fileExists(srcImagePath))) {
    console.error(`Source image not found: ${srcImagePath}`);
    process.exit(1);
  }

  const srcMeta = await sharp(srcImagePath).metadata();
  if (!srcMeta.width || srcMeta.width !== srcMeta.height) {
    console.warn(
      `Warning: source image is not square (${srcMeta.width}x${srcMeta.height}). Resizes may crop.`
    );
  }

  console.log("🔄 Generating app icons from", path.relative(projectRoot, srcImagePath));

  let count = 0;
  for (const t of targets) {
    const outPath = path.join(projectRoot, t.path);
    await ensureDirFor(outPath);
    try {
      const buffer = await sharp(srcImagePath)
        .resize(t.width, t.height, { fit: "cover" })
        .png()
        .toBuffer();
      await fs.promises.writeFile(outPath, buffer);
      count++;
      console.log(`  ✓ ${t.path} -> ${t.width}x${t.height}`);
    } catch (err) {
      console.warn(`  ✗ ${t.path}: ${err.message}`);
    }
  }

  // Android adaptive icon background (solid color)
  const bgPath = path.join(projectRoot, "assets/images/android-icon-background.png");
  await createSolidColorPng(1024, 1024, ANDROID_BG_COLOR, bgPath);
  count++;

  // Android monochrome icon (themed icons)
  const monoPath = path.join(projectRoot, "assets/images/android-icon-monochrome.png");
  await createMonochromeIcon(srcImagePath, monoPath);
  count++;

  // PWA icons for web manifest (public/ is copied to dist on expo export --platform web)
  const publicDir = path.join(projectRoot, "public");
  await fs.promises.mkdir(publicDir, { recursive: true });
  for (const size of pwaSizes) {
    const pwaPath = path.join(publicDir, `icon-${size}.png`);
    const buffer = await sharp(srcImagePath)
      .resize(size, size, { fit: "cover" })
      .png()
      .toBuffer();
    await fs.promises.writeFile(pwaPath, buffer);
    count++;
    console.log(`  ✓ public/icon-${size}.png -> ${size}x${size} (PWA)`);
  }

  // Favicon for browser tab (Expo uses web.favicon from assets; public/favicon.png as fallback)
  const faviconPublicPath = path.join(publicDir, "favicon.png");
  const faviconBuffer = await sharp(srcImagePath)
    .resize(32, 32, { fit: "cover" })
    .png()
    .toBuffer();
  await fs.promises.writeFile(faviconPublicPath, faviconBuffer);
  count++;
  console.log(`  ✓ public/favicon.png -> 32x32 (browser tab)`);

  // PWA maskable icon (512x512 with safe zone for adaptive icons)
  const maskablePath = path.join(publicDir, "icon-512-maskable.png");
  const maskableBuffer = await sharp(srcImagePath)
    .resize(512, 512, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  await fs.promises.writeFile(maskablePath, maskableBuffer);
  count++;
  console.log(`  ✓ public/icon-512-maskable.png -> 512x512 (PWA maskable)`);

  console.log(`\n✅ Done! Generated ${count} files.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
