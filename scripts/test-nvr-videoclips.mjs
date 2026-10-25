#!/usr/bin/env node
/**
 * Test script for NVR videoclips (deviceId 269).
 * Usage:
 *   node scripts/test-nvr-videoclips.mjs
 *   # Loads from .env if present (EXPO_PUBLIC_SEED_SCRYPTED_* or SCRYPTED_*)
 *
 *   SCRYPTED_BASE_URL=https://... SCRYPTED_USERNAME=... SCRYPTED_PASSWORD=xxx node scripts/test-nvr-videoclips.mjs
 *
 * Analyzes getVideoclips response and tests stream URLs (NVR direct vs prebuffer).
 */

import { connectExternalHubClient } from "@external-hub/client";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env from project root if present (supports EXPO_PUBLIC_SEED_SCRYPTED_* or SCRYPTED_*)
try {
  const envPath = resolve(process.cwd(), ".env");
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      const mapped =
        key.startsWith("EXPO_PUBLIC_SEED_SCRYPTED_") ? key.replace("EXPO_PUBLIC_SEED_SCRYPTED_", "SCRYPTED_") : key;
      if ((key.startsWith("SCRYPTED_") || key.startsWith("EXPO_PUBLIC_SEED_SCRYPTED_")) && !(mapped in process.env)) {
        process.env[mapped] = val;
      }
    }
  }
} catch {
  /* .env optional */
}

const DEVICE_ID = process.env.NVR_DEVICE_ID || "269";
const BASE_URL = (process.env.SCRYPTED_BASE_URL || "https://localhost:10443").trim().replace(/\/+$/, "");
const USERNAME = process.env.SCRYPTED_USERNAME || "";
const PASSWORD = process.env.SCRYPTED_PASSWORD || "";
const LIMIT = parseInt(process.env.LIMIT || "5", 10);

function parseNvrVideoId(videoId) {
  if (!videoId?.trim()) return null;
  try {
    const parsed = JSON.parse(videoId);
    const startTime = parsed?.startTime;
    const duration = parsed?.duration;
    if (typeof startTime === "number" && typeof duration === "number" && duration > 0) {
      return { startTime, duration, filename: `${startTime}-${duration}-1.mp4` };
    }
  } catch {
    /* try filename format */
  }
  const match = String(videoId).match(/^(\d+)-(\d+)(?:-\d+)?(?:\.mp4)?$/);
  if (match) {
    const startTime = parseInt(match[1], 10);
    const duration = parseInt(match[2], 10);
    if (duration > 0) {
      const filename = String(videoId).includes(".mp4") ? videoId : `${match[1]}-${match[2]}-1.mp4`;
      return { startTime, duration, filename };
    }
  }
  return null;
}

function buildNvrClipUrl(deviceId, videoId, clip) {
  const parsed =
    parseNvrVideoId(videoId) ??
    (clip?.startTime != null && clip?.duration != null
      ? { startTime: clip.startTime, duration: clip.duration, filename: `${clip.startTime}-${clip.duration}-1.mp4` }
      : null);
  if (!parsed) return null;
  let origin = BASE_URL;
  try {
    origin = new URL(BASE_URL).origin;
  } catch {
    /* keep base */
  }
  const path = `/endpoint/@external-hub/nvr/clip/${deviceId}/${parsed.filename}`;
  let url = `${origin}${path}`;
  if (USERNAME || PASSWORD) {
    try {
      const u = new URL(url);
      const cred = `${encodeURIComponent(USERNAME)}:${encodeURIComponent(PASSWORD)}`;
      url = `${u.protocol}//${cred}@${u.host}${u.pathname}${u.search}`;
    } catch {
      /* keep url */
    }
  }
  return url;
}

function buildEventsAppPrebufferUrl(href) {
  if (!href?.trim()) return null;
  const pathWithQuery = href.includes("?") ? href : `${href}?prebuffer=1`;
  if (pathWithQuery.startsWith("http")) return pathWithQuery;
  let origin = BASE_URL;
  try {
    origin = new URL(BASE_URL).origin;
  } catch {
    /* keep base */
  }
  return pathWithQuery.startsWith("/")
    ? `${origin}${pathWithQuery}`
    : `${BASE_URL}/${pathWithQuery}`;
}

async function fetchHead(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    const headers = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("content-type"),
      contentLength: res.headers.get("content-length"),
      acceptRanges: res.headers.get("accept-ranges"),
      headers,
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function main() {
  console.log("=== NVR Videoclips Test ===\n");
  console.log("Config:", {
    baseUrl: BASE_URL,
    deviceId: DEVICE_ID,
    limit: LIMIT,
    hasAuth: !!(USERNAME || PASSWORD),
  });
  console.log();

  const now = Date.now();
  const fromDate = now - 24 * 60 * 60 * 1000; // last 24h
  const tillDate = now;

  let client;
  try {
    console.log("Connecting to External hub...");
    client = await connectExternalHubClient({
      pluginId: "@external-hub/core",
      baseUrl: BASE_URL,
      username: USERNAME,
      password: PASSWORD,
    });
    console.log("Connected.\n");
  } catch (e) {
    console.error("Connection failed:", e.message);
    process.exit(1);
  }

  const device = client.systemManager.getDeviceByName("Advanced notifier");
  if (!device) {
    console.error("Advanced notifier device not found");
    process.exit(1);
  }

  let data;
  const getVideoclips = device.getVideoclips ?? device.getVideoClips;
  if (typeof getVideoclips === "function") {
    console.log("Calling Advanced notifier getVideoclips({ fromDate, tillDate, limit:", LIMIT, ", cameras: ['" + DEVICE_ID + "'] })");
    data = await getVideoclips.call(device, {
      fromDate,
      tillDate,
      limit: LIMIT,
      offset: 0,
      cameras: [DEVICE_ID],
    });
  } else {
    const nvrDevice = client.systemManager.getDeviceById(DEVICE_ID);
    const fn = nvrDevice?.getVideoClips ?? nvrDevice?.getVideoclips;
    if (typeof fn === "function") {
      console.log("Using NVR device", DEVICE_ID, "getVideoClips({ startTime, endTime })");
      const clips = await fn.call(nvrDevice, { startTime: fromDate, endTime: tillDate });
      data = { videoclips: clips ?? [], total: (clips ?? []).length };
    } else {
      console.error("Neither Advanced notifier nor NVR device has getVideoclips/getVideoClips.");
      process.exit(1);
    }
  }

  const clips = data?.videoclips ?? [];
  const total = data?.total ?? clips.length;
  console.log("Result: ", clips.length, "clips, total:", total, "\n");

  if (clips.length === 0) {
    console.log("No videoclips found. Try a different deviceId or date range.");
    process.exit(0);
  }

  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    console.log(`--- Clip ${i + 1}/${clips.length} ---`);
    console.log("  id:", c.id);
    console.log("  videoId:", c.videoId ?? "(none)");
    console.log("  deviceId:", c.deviceId);
    console.log("  deviceName:", c.deviceName ?? "(none)");
    console.log("  startTime:", c.startTime, new Date(c.startTime).toISOString());
    console.log("  duration:", c.duration, "ms");
    console.log("  eventTime:", c.eventTime ?? "(none)");
    console.log("  videoclipHref:", (c.videoclipHref ?? "").slice(0, 120) + (c.videoclipHref?.length > 120 ? "..." : ""));
    console.log("  thumbnailUrl:", (c.thumbnailUrl ?? "").slice(0, 80) + (c.thumbnailUrl?.length > 80 ? "..." : "") || "(none)");
    console.log("  detectionClasses:", c.detectionClasses ?? []);
    const parsed = parseNvrVideoId(c.videoId ?? c.id);
    console.log("  parseNvrVideoId:", parsed ?? "(null)");
    const nvrUrl = buildNvrClipUrl(c.deviceId ?? DEVICE_ID, c.videoId ?? c.id, c);
    const prebufferUrl = buildEventsAppPrebufferUrl(c.videoclipHref);
    console.log("  NVR direct URL (stream):", nvrUrl ? nvrUrl.slice(0, 90) + "..." : "(null)");
    console.log("  EventsApp prebuffer URL:", prebufferUrl ? prebufferUrl.slice(0, 90) + "..." : "(null)");
    console.log();
  }

  // Test first clip stream URLs
  const first = clips[0];
  const nvrUrl = buildNvrClipUrl(first.deviceId ?? DEVICE_ID, first.videoId ?? first.id, first);
  const prebufferUrl = buildEventsAppPrebufferUrl(first.videoclipHref);

  console.log("=== Stream URL tests (first clip) ===\n");

  if (nvrUrl) {
    console.log("1. NVR direct (no prebuffer):");
    const head = await fetchHead(nvrUrl);
    if (head.error) {
      console.log("   HEAD error:", head.error);
    } else {
      console.log("   Status:", head.status, head.ok ? "OK" : "");
      console.log("   Content-Type:", head.contentType);
      console.log("   Content-Length:", head.contentLength);
      console.log("   Accept-Ranges:", head.acceptRanges ?? "(not set - may not support seek)");
    }
    console.log();
  }

  if (prebufferUrl && prebufferUrl !== nvrUrl) {
    console.log("2. EventsApp prebuffer (?prebuffer=1):");
    const head = await fetchHead(prebufferUrl);
    if (head.error) {
      console.log("   HEAD error:", head.error);
    } else {
      console.log("   Status:", head.status, head.ok ? "OK" : "");
      console.log("   Content-Type:", head.contentType);
      console.log("   Content-Length:", head.contentLength);
      console.log("   Accept-Ranges:", head.acceptRanges ?? "(not set)");
    }
    console.log();
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
