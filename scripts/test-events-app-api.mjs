#!/usr/bin/env node
/**
 * Benchmark EventsApp API: getClusteredDayData + getCameraDayData
 * Compares per-day (N parallel calls) vs batched (1 call with days[]) response times.
 *
 * Usage:
 *   node scripts/test-events-app-api.mjs
 *   # Loads from .env if present (EXPO_PUBLIC_SEED_SCRYPTED_* or SCRYPTED_*)
 *
 *   NVR_DEVICE_ID=269 node scripts/test-events-app-api.mjs
 */

import { connectExternalHubClient } from "@external-hub/client";
import { ExternalHubInterfaceDescriptors, TYPES_VERSION } from "@external-hub/types";
import { readFileSync } from "fs";
import { resolve } from "path";
import { performance } from "perf_hooks";

// ---------------------------------------------------------------------------
// Load .env
// ---------------------------------------------------------------------------
try {
  const envPath = resolve(process.cwd(), ".env");
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      const mapped = key.startsWith("EXPO_PUBLIC_SEED_SCRYPTED_")
        ? key.replace("EXPO_PUBLIC_SEED_SCRYPTED_", "SCRYPTED_")
        : key;
      if (
        (key.startsWith("SCRYPTED_") || key.startsWith("EXPO_PUBLIC_SEED_SCRYPTED_")) &&
        !(mapped in process.env)
      ) {
        process.env[mapped] = val;
      }
    }
  }
} catch {
  /* .env optional */
}

const BASE_URL = (process.env.SCRYPTED_BASE_URL || "https://localhost:10443").trim().replace(/\/+$/, "");
const USERNAME = process.env.SCRYPTED_USERNAME || "";
const PASSWORD = process.env.SCRYPTED_PASSWORD || "";
const DEVICE_ID = process.env.NVR_DEVICE_ID || "";
const BUCKET_MS = parseInt(process.env.BUCKET_MS || "300000", 10); // 5 min default
const DAYS_COUNT = parseInt(process.env.DAYS_COUNT || "3", 10);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDayStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function generateDays(count) {
  const days = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(toDayStr(d));
  }
  return days;
}

function payloadKB(obj) {
  return (JSON.stringify(obj).length / 1024).toFixed(1);
}

function summarizeResponse(label, data, elapsedMs) {
  const clusters = data?.clusters?.length ?? 0;
  const motion = data?.motion?.length ?? 0;
  const motionSegments = data?.motionSegments?.length ?? 0;
  const audioLevelSegments = data?.audioLevelSegments?.length ?? 0;
  const artifacts = data?.artifacts?.length ?? 0;
  const recordings = data?.recordings?.length ?? 0;
  const events = data?.events?.length ?? 0;
  const kb = payloadKB(data);
  const segInfo = motionSegments ? ` motionSegs=${motionSegments} audioSegs=${audioLevelSegments}` : "";
  console.log(
    `  ${label}: ${elapsedMs.toFixed(0)}ms | ${kb} KB | clusters=${clusters} motion=${motion}${segInfo} artifacts=${artifacts} recordings=${recordings}${events ? ` events=${events}` : ""}`
  );
  return { elapsedMs, kb: parseFloat(kb), clusters, motion, motionSegments, audioLevelSegments, artifacts, recordings, events };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== EventsApp API Benchmark ===\n");
  console.log("Config:", { baseUrl: BASE_URL, deviceId: DEVICE_ID || "(auto)", bucketMs: BUCKET_MS, daysCount: DAYS_COUNT });
  console.log();

  // Connect
  const t0 = performance.now();
  const client = await connectExternalHubClient({
    pluginId: "@external-hub/core",
    baseUrl: BASE_URL,
    username: USERNAME,
    password: PASSWORD,
  });
  console.log(`Connected in ${(performance.now() - t0).toFixed(0)}ms (type: ${client.connectionType})\n`);

  // Register EventsAppApi interface descriptors (required for RPC proxy to recognize methods)
  const descriptors = {
    ...ExternalHubInterfaceDescriptors,
    EventsAppApi: {
      name: "EventsAppApi",
      methods: [
        "getConfigs", "getCamerasStatus", "getEvents", "getVideoclips",
        "getCameraDayData", "getClusteredDayData", "getClusterEvents",
        "getArtifacts", "getLatestRuleArtifacts", "remoteLog", "getAsset", "getVideoClipData",
      ],
      properties: [],
    },
  };
  await client.systemManager.setExternalHubInterfaceDescriptors(TYPES_VERSION, descriptors);

  // Get EventsApp device
  const device = client.systemManager.getDeviceByName("Advanced notifier");
  if (!device) {
    console.error("ERROR: 'Advanced notifier' device not found");
    client.disconnect();
    process.exit(1);
  }

  // Discover cameras
  let deviceId = DEVICE_ID;
  if (!deviceId) {
    try {
      const configs = await device.getConfigs();
      const cameras = configs?.cameras ?? [];
      console.log(`Found ${cameras.length} cameras:`);
      for (const cam of cameras) {
        console.log(`  - ${cam.name} (id: ${cam.id})`);
      }
      if (cameras.length > 0) {
        deviceId = cameras[0].id;
        console.log(`\nUsing first camera: ${cameras[0].name} (${deviceId})`);
      } else {
        console.error("No cameras found");
        client.disconnect();
        process.exit(1);
      }
    } catch (e) {
      console.error("getConfigs failed:", e.message);
      client.disconnect();
      process.exit(1);
    }
  }

  const days = generateDays(DAYS_COUNT);
  console.log(`\nDays: ${days.join(", ")} (bucketMs: ${BUCKET_MS})\n`);

  const results = {};

  // =========================================================================
  // Test 1: getClusteredDayData per-day (N parallel calls) — current pattern
  // =========================================================================
  console.log(`--- Test 1: getClusteredDayData per-day (${days.length} parallel calls) ---`);
  {
    const t1 = performance.now();
    const responses = await Promise.all(
      days.map((day) =>
        device.getClusteredDayData({ deviceId, days: [day], bucketMs: BUCKET_MS })
      )
    );
    const elapsed = performance.now() - t1;
    console.log(`  Total wall time: ${elapsed.toFixed(0)}ms`);
    let totalKB = 0;
    for (let i = 0; i < days.length; i++) {
      const r = summarizeResponse(`  Day ${days[i]}`, responses[i], elapsed);
      totalKB += r.kb;
    }
    console.log(`  Total payload: ${totalKB.toFixed(1)} KB`);
    results.perDay = { elapsed, totalKB };
    console.log();
  }

  // =========================================================================
  // Test 2: getClusteredDayData batched (1 call with all days)
  // =========================================================================
  console.log(`--- Test 2: getClusteredDayData batch (1 call, ${days.length} days) ---`);
  {
    const t1 = performance.now();
    const response = await device.getClusteredDayData({
      deviceId,
      days,
      bucketMs: BUCKET_MS,
    });
    const elapsed = performance.now() - t1;
    const r = summarizeResponse("Batch", response, elapsed);
    results.batch = { elapsed, totalKB: r.kb };
    console.log();
  }

  // =========================================================================
  // Test 3: getCameraDayData per-day (N parallel calls) — raw events baseline
  // =========================================================================
  console.log(`--- Test 3: getCameraDayData per-day (${days.length} parallel calls) ---`);
  {
    const t1 = performance.now();
    const responses = await Promise.all(
      days.map((day) => device.getCameraDayData({ deviceId, day }))
    );
    const elapsed = performance.now() - t1;
    console.log(`  Total wall time: ${elapsed.toFixed(0)}ms`);
    let totalKB = 0;
    for (let i = 0; i < days.length; i++) {
      const r = summarizeResponse(`  Day ${days[i]}`, responses[i], elapsed);
      totalKB += r.kb;
    }
    console.log(`  Total payload: ${totalKB.toFixed(1)} KB`);
    results.rawPerDay = { elapsed, totalKB };
    console.log();
  }

  // =========================================================================
  // Test: Audio segment merge (client-side optimization)
  // =========================================================================
  console.log("--- Audio Segment Merge (client-side) ---");
  {
    // Re-fetch batch for audio analysis
    const batchResp = await device.getClusteredDayData({ deviceId, days, bucketMs: BUCKET_MS });
    const rawSegs = batchResp.audioLevelSegments ?? [];
    console.log(`  Raw audio segments: ${rawSegs.length}`);
    console.log(`  Raw payload: ${payloadKB(rawSegs)} KB`);

    // Merge: extend each segment to next start, then merge same-level consecutive
    const sorted = [...rawSegs].sort((a, b) => a.start - b.start);
    const merged = [];
    if (sorted.length > 0) {
      merged.push({ ...sorted[0] });
      for (let i = 1; i < sorted.length; i++) {
        const prev = merged[merged.length - 1];
        const curr = sorted[i];
        prev.end = Math.max(prev.end, curr.start);
        if (curr.level === prev.level) {
          prev.end = Math.max(prev.end, curr.end);
        } else {
          merged.push({ ...curr, start: prev.end });
        }
      }
    }
    console.log(`  Merged audio segments: ${merged.length}`);
    console.log(`  Merged payload: ${payloadKB(merged)} KB`);
    console.log(`  Reduction: ${rawSegs.length} → ${merged.length} (${((1 - merged.length / rawSegs.length) * 100).toFixed(1)}% fewer elements)`);

    // Level distribution after merge
    const levelCounts = {};
    for (const s of merged) {
      levelCounts[s.level] = (levelCounts[s.level] || 0) + 1;
    }
    console.log(`  Level distribution: ${JSON.stringify(levelCounts)}`);
    console.log();
  }

  // =========================================================================
  // Test 4: getClusteredDayData per-day — sequential (worst case)
  // =========================================================================
  console.log(`--- Test 4: getClusteredDayData per-day sequential (${days.length} calls) ---`);
  {
    const t1 = performance.now();
    for (const day of days) {
      await device.getClusteredDayData({ deviceId, days: [day], bucketMs: BUCKET_MS });
    }
    const elapsed = performance.now() - t1;
    console.log(`  Total wall time: ${elapsed.toFixed(0)}ms`);
    results.perDaySeq = { elapsed };
    console.log();
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log("=== Summary ===");
  console.log("┌─────────────────────────────────────┬───────────┬───────────┬───────────┐");
  console.log("│ Method                              │ Wall Time │  Payload  │ RPC Calls │");
  console.log("├─────────────────────────────────────┼───────────┼───────────┼───────────┤");
  console.log(
    `│ getClusteredDayData x${days.length} parallel    │ ${String(results.perDay.elapsed.toFixed(0) + "ms").padStart(9)} │ ${String(results.perDay.totalKB.toFixed(1) + " KB").padStart(9)} │ ${String(days.length).padStart(9)} │`
  );
  console.log(
    `│ getClusteredDayData x${days.length} sequential  │ ${String(results.perDaySeq.elapsed.toFixed(0) + "ms").padStart(9)} │         - │ ${String(days.length).padStart(9)} │`
  );
  console.log(
    `│ getClusteredDayData batch           │ ${String(results.batch.elapsed.toFixed(0) + "ms").padStart(9)} │ ${String(results.batch.totalKB.toFixed(1) + " KB").padStart(9)} │ ${String(1).padStart(9)} │`
  );
  console.log(
    `│ getCameraDayData x${days.length} parallel      │ ${String(results.rawPerDay.elapsed.toFixed(0) + "ms").padStart(9)} │ ${String(results.rawPerDay.totalKB.toFixed(1) + " KB").padStart(9)} │ ${String(days.length).padStart(9)} │`
  );
  console.log("└─────────────────────────────────────┴───────────┴───────────┴───────────┘");

  if (results.perDay.elapsed > 0 && results.batch.elapsed > 0) {
    const speedup = results.perDay.elapsed / results.batch.elapsed;
    console.log(`\nSpeedup (batch vs parallel): ${speedup.toFixed(2)}x`);
  }
  if (results.perDaySeq.elapsed > 0 && results.batch.elapsed > 0) {
    const speedup = results.perDaySeq.elapsed / results.batch.elapsed;
    console.log(`Speedup (batch vs sequential): ${speedup.toFixed(2)}x`);
  }

  console.log("\nDone.");
  client.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
