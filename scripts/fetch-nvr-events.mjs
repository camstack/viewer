#!/usr/bin/env node
/**
 * Separate NVR API - Events fetch script
 *
 * Documenta come effettuare il fetch degli eventi da GET /api/events.
 * Basato su: https://docs.frigate.video/integrations/api/events-events-get/
 *
 * Parametri supportati dall'API Separate NVR:
 *   - cameras    : filtro camera (es. frontDoor, porch)
 *   - limit      : numero massimo eventi (default 100)
 *   - after      : timestamp Unix (secondi) - inizio range
 *   - before     : timestamp Unix (secondi) - fine range
 *   - timezone   : timezone (es. Europe/Rome)
 *   - include_thumbnails : 0|1 - esclude thumbnail dal JSON (payload più leggero)
 *
 * Auth: Bearer JWT (Header), Basic auth, oppure cookie frigate_token (browser)
 *
 * Usage:
 *   node scripts/fetch-nvr-events.mjs
 *   BASE_URL=https://nvr.example.com CAMERA=frontDoor node scripts/fetch-nvr-events.mjs
 *   TOKEN=eyJ... node scripts/fetch-nvr-events.mjs  # usa JWT direttamente
 *
 * Env:
 *   BASE_URL, NVR_BASE_URL  - URL Separate NVR (es. https://frigate.example.com)
 *   USERNAME, NVR_USERNAME  - per login
 *   PASSWORD, NVR_PASSWORD  - per login
 *   TOKEN, NVR_TOKEN        - JWT (opzionale, se non presente fa login)
 *   CAMERA                      - filtro camera (es. frontDoor)
 *   LIMIT                       - limit eventi (default 25)
 *   AFTER, BEFORE               - range in secondi Unix (opzionale)
 *   TIMEZONE                    - es. Europe/Rome
 *   INCLUDE_THUMBNAILS          - 0 o 1 (default 1)
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env
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

const BASE_URL = (
  process.env.BASE_URL ||
  process.env.NVR_BASE_URL ||
  process.env.NVR_BASE_URL_LOCAL ||
  process.env.NVR_BASE_URL_PUBLIC ||
  "https://nvr.example.com"
)
  .trim()
  .replace(/\/+$/, "");
const USERNAME = (process.env.USERNAME || process.env.NVR_USERNAME || "").trim();
const PASSWORD = (process.env.PASSWORD || process.env.NVR_PASSWORD || "").trim();
const TOKEN = (process.env.TOKEN || process.env.NVR_TOKEN || "").trim();
const CAMERA = (process.env.CAMERA || "front door").trim();
const LIMIT = parseInt(process.env.LIMIT || "25", 10);
const TIMEZONE = (process.env.TIMEZONE || "Europe/Rome").trim();
const INCLUDE_THUMBNAILS = process.env.INCLUDE_THUMBNAILS ?? "0";

async function login() {
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
      /* try next */
    }
  }
  return null;
}

let cachedToken = null;

async function fetchEvents(options = {}) {
  const {
    cameras = CAMERA ? [CAMERA] : [],
    limit = LIMIT,
    after,
    before,
    timezone = TIMEZONE,
    includeThumbnails = INCLUDE_THUMBNAILS,
  } = options;

  const params = new URLSearchParams();
  if (cameras.length) params.set("cameras", cameras.join(","));
  params.set("limit", String(limit));
  if (timezone) params.set("timezone", timezone);
  params.set("include_thumbnails", String(includeThumbnails));
  if (after != null) params.set("after", String(after));
  if (before != null) params.set("before", String(before));

  const path = `/api/events?${params.toString()}`;
  const url = `${BASE_URL}${path}`;

  const headers = {
    "accept": "*/*",
    "accept-language": "it-IT,it;q=0.9,en;q=0.8",
    "cache-control": "no-cache",
    "pragma": "no-cache",
  };

  if (!cachedToken && TOKEN) {
    cachedToken = TOKEN;
  }
  if (!cachedToken && USERNAME && PASSWORD) {
    cachedToken = await login();
  }
  if (cachedToken) {
    headers["Authorization"] = `Bearer ${cachedToken}`;
  } else if (USERNAME && PASSWORD) {
    const cred = Buffer.from(`${USERNAME}:${PASSWORD}`, "utf8").toString("base64");
    headers["Authorization"] = `Basic ${cred}`;
  }

  // Headers opzionali usati dal frontend Separate NVR
  headers["x-cache-bypass"] = "1";
  headers["x-csrf-token"] = "1";

  const res = await fetch(url, {
    method: "GET",
    headers,
    credentials: "omit",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Separate NVR API: ${res.status} ${res.statusText}\n${text.slice(0, 200)}`);
  }

  return res.json();
}

async function main() {
  console.log("=== Separate NVR Events Fetch ===\n");
  console.log("Config:");
  console.log("  BASE_URL:", BASE_URL);
  console.log("  CAMERA:", CAMERA || "(all)");
  console.log("  LIMIT:", LIMIT);
  console.log("  TIMEZONE:", TIMEZONE);
  console.log("  INCLUDE_THUMBNAILS:", INCLUDE_THUMBNAILS);
  console.log("  Auth:", TOKEN ? "TOKEN (env)" : USERNAME ? "login" : "(none)");
  console.log();

  const now = Math.floor(Date.now() / 1000);
  const oneDayAgo = now - 24 * 3600;

  try {
    // Fetch senza after/before = ultimi eventi (ordine dipende da API)
    console.log("--- Fetch events (no after/before) ---");
    const events1 = await fetchEvents({ cameras: CAMERA ? [CAMERA] : [] });
    console.log(`  Count: ${events1.length}`);
    if (events1.length > 0) {
      const e = events1[0];
      console.log(`  Sample: id=${e.id} camera=${e.camera} label=${e.label} start_time=${e.start_time} has_clip=${e.has_clip}`);
    }
    console.log();

    // Fetch con range temporale (oggi)
    console.log("--- Fetch events (last 24h, after/before) ---");
    const events2 = await fetchEvents({
      cameras: CAMERA ? [CAMERA] : [],
      after: oneDayAgo,
      before: now,
    });
    console.log(`  Count: ${events2.length}`);
    if (events2.length > 0) {
      const e = events2[0];
      console.log(`  Sample: id=${e.id} camera=${e.camera}`);
    }
    console.log();

    // Curl equivalente per copia/incolla
    console.log("--- Curl equivalente ---");
    const qs = new URLSearchParams();
    if (CAMERA) qs.set("cameras", CAMERA);
    qs.set("limit", String(LIMIT));
    qs.set("timezone", TIMEZONE);
    qs.set("include_thumbnails", INCLUDE_THUMBNAILS);
    const authHeader = cachedToken ? `-H 'Authorization: Bearer ${cachedToken.slice(0, 20)}...'` : "";
    console.log(`curl '${BASE_URL}/api/events?${qs.toString()}' \\`);
    console.log(`  -H 'accept: */*' ${authHeader}`);
    console.log();

    console.log("Done.");
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  }
}

main();
