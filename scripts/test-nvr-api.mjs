#!/usr/bin/env node
/**
 * Test Separate NVR API fetching for:
 * - Reel (events last 24h)
 * - Camera events (events for a day, optional camera filter)
 * - Videoclips (events with has_clip)
 *
 * Usage:
 *   node scripts/test-nvr-api.mjs
 *   # Loads from .env (EXPO_PUBLIC_SEED_NVR_* or NVR_*)
 *
 *   NVR_BASE_URL=http://192.168.1.10:5000 node scripts/test-nvr-api.mjs
 *   NVR_BASE_URL=... NVR_USERNAME=... NVR_PASSWORD=... node scripts/test-nvr-api.mjs
 *
 *   CAMERA=porch node scripts/test-nvr-api.mjs  # filter camera events
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env from project root (EXPO_PUBLIC_SEED_NVR_* → NVR_*)
try {
  const envPath = resolve(process.cwd(), ".env");
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      const mapped = key.startsWith("EXPO_PUBLIC_SEED_NVR_")
        ? key.replace("EXPO_PUBLIC_SEED_NVR_", "NVR_")
        : key;
      if (
        (key.startsWith("NVR_") || key.startsWith("EXPO_PUBLIC_SEED_NVR_")) &&
        !(mapped in process.env)
      ) {
        process.env[mapped] = val;
      }
    }
  }
} catch {
  /* .env optional */
}

// Prefer local URL (faster on LAN)
const BASE_URL = (
  process.env.NVR_BASE_URL ||
  process.env.NVR_BASE_URL_LOCAL ||
  process.env.NVR_BASE_URL_PUBLIC ||
  "http://localhost:5000"
)
  .trim()
  .replace(/\/+$/, "");
const USERNAME = (process.env.NVR_USERNAME || "").trim();
const PASSWORD = (process.env.NVR_PASSWORD || "").trim();
const CAMERA = (process.env.CAMERA || "").trim();
const LIMIT = parseInt(process.env.LIMIT || "50", 10);

/** Separate NVR uses JWT from login (Set-Cookie), not Basic auth. Login and return Bearer token. */
async function frigateLogin() {
  if (!USERNAME || !PASSWORD) return null;
  const body = JSON.stringify({ user: USERNAME, password: PASSWORD });
  for (const path of ["/api/login", "/login"]) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        credentials: "include",
      });
      if (res.ok) {
        const setCookie = res.headers.get("set-cookie") ?? res.headers.get("Set-Cookie");
        if (setCookie) {
          const match = setCookie.match(/frigate_token=([^;]+)/);
          if (match) return match[1];
        }
      }
    } catch {
      /* try next path */
    }
  }
  return null;
}

let cachedToken = null;

async function frigateFetch(path, options = {}) {
  const url = `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (!cachedToken && USERNAME && PASSWORD) {
    cachedToken = await frigateLogin();
  }
  if (cachedToken) {
    headers["Authorization"] = `Bearer ${cachedToken}`;
  } else if (USERNAME && PASSWORD) {
    const cred = Buffer.from(`${USERNAME}:${PASSWORD}`, "utf8").toString("base64");
    headers["Authorization"] = `Basic ${cred}`;
  }
  const res = await fetch(url, {
    ...options,
    headers,
    credentials: "omit",
  });
  if (!res.ok) {
    throw new Error(`Separate NVR API error: ${res.status} ${res.statusText}`);
  }
  return res;
}

async function fetchEvents(after, before, cameras = [], limit = LIMIT) {
  const params = new URLSearchParams();
  params.set("after", String(after));
  params.set("before", String(before));
  if (cameras.length) params.set("cameras", cameras.join(","));
  params.set("limit", String(limit));
  const res = await frigateFetch(`/api/events?${params.toString()}`);
  return res.json();
}

/** Test CORS: simulate browser cross-origin request. Returns { ok, allowOrigin, allowMethods, allowHeaders, error }. */
async function testCors(origin = "http://localhost:8081") {
  const url = `${BASE_URL}/api/config`;
  try {
    const res = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization, Content-Type",
      },
    });
    const allowOrigin = res.headers.get("access-control-allow-origin");
    const allowMethods = res.headers.get("access-control-allow-methods");
    const allowHeaders = res.headers.get("access-control-allow-headers");
    const ok = res.status === 204 || res.status === 200;
    return {
      ok,
      status: res.status,
      allowOrigin: allowOrigin ?? "(missing)",
      allowMethods: allowMethods ?? "(missing)",
      allowHeaders: allowHeaders ?? "(missing)",
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function main() {
  console.log("=== Separate NVR API Test ===\n");
  console.log("Config:", {
    baseUrl: BASE_URL,
    hasAuth: !!(USERNAME || PASSWORD),
    camera: CAMERA || "(all)",
    limit: LIMIT,
  });
  console.log();

  const now = Math.floor(Date.now() / 1000);
  const nowMs = Date.now();
  const dayStart = new Date(nowMs);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartSec = Math.floor(dayStart.getTime() / 1000);
  const dayEndSec = dayStartSec + 24 * 3600 - 1;

  try {
    // 0. CORS check (simulates browser from localhost:8081)
    console.log("--- 0. CORS (Origin: http://localhost:8081) ---");
    const cors = await testCors();
    if (cors.error) {
      console.log(`  Error: ${cors.error}`);
    } else {
      console.log(`  Status: ${cors.status}`);
      console.log(`  Access-Control-Allow-Origin: ${cors.allowOrigin}`);
      console.log(`  Access-Control-Allow-Methods: ${cors.allowMethods}`);
      console.log(`  Access-Control-Allow-Headers: ${cors.allowHeaders}`);
      if (!cors.ok || !cors.allowOrigin || cors.allowOrigin === "(missing)") {
        console.log(`  ⚠ CORS not configured — web app will be blocked. See docs/NVR_API_CORS.md`);
      } else {
        console.log(`  ✓ CORS OK`);
      }
    }
    console.log();

    // 1. Reel: events last 24h
    console.log("--- 1. Reel (events last 24h) ---");
    const reelAfter = now - 24 * 3600;
    const reelEvents = await fetchEvents(reelAfter, now);
    console.log(`  Fetched: ${reelEvents.length} events`);
    if (reelEvents.length > 0) {
      const sample = reelEvents[0];
      console.log(`  Sample: id=${sample.id} camera=${sample.camera} label=${sample.label} start=${sample.start_time}`);
    }
    console.log();

    // 2. Camera events: today (optionally filtered by camera)
    console.log("--- 2. Camera events (today" + (CAMERA ? `, camera=${CAMERA}` : "") + ") ---");
    const cameras = CAMERA ? [CAMERA] : [];
    const cameraEvents = await fetchEvents(dayStartSec, dayEndSec, cameras);
    console.log(`  Fetched: ${cameraEvents.length} events`);
    if (cameraEvents.length > 0) {
      const sample = cameraEvents[0];
      console.log(`  Sample: id=${sample.id} camera=${sample.camera} label=${sample.label} has_clip=${sample.has_clip}`);
    }
    console.log();

    // 3. Videoclips: events with has_clip
    console.log("--- 3. Videoclips (events with has_clip) ---");
    const fromDate = dayStart.getTime();
    const tillDate = fromDate + 24 * 60 * 60 * 1000 - 1;
    const clipEvents = await fetchEvents(
      Math.floor(fromDate / 1000),
      Math.ceil(tillDate / 1000),
      cameras,
      5000
    );
    const withClip = clipEvents.filter((e) => e.has_clip === true);
    console.log(`  Total events: ${clipEvents.length}, with clip: ${withClip.length}`);
    if (withClip.length > 0) {
      const sample = withClip[0];
      console.log(`  Sample: id=${sample.id} camera=${sample.camera} clip=/api/events/${sample.id}/clip.mp4`);
    }
    console.log();

    // Summary
    console.log("=== Summary ===");
    console.log(`  CORS: ${cors.ok && cors.allowOrigin !== "(missing)" ? "OK" : "NOT configured (web app will be blocked)"}`);
    console.log(`  Reel: ${reelEvents.length} events`);
    console.log(`  Camera events: ${cameraEvents.length} events`);
    console.log(`  Videoclips: ${withClip.length} clips`);
    console.log("\nDone.");
  } catch (e) {
    console.error("Error:", e.message);
    if (e.cause) console.error("  Cause:", e.cause);
    process.exit(1);
  }
}

main();
