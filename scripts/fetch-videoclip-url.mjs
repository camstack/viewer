#!/usr/bin/env node
/**
 * Test fetch of a Reolink/external hub videoclip URL to see response headers and behavior.
 * Usage:
 *   node scripts/fetch-videoclip-url.mjs [URL]
 *   node scripts/fetch-videoclip-url.mjs [URL] --save   # download to ./out-clip.mp4
 *
 * Finding: server returns Transfer-Encoding: chunked and no Content-Length.
 * AVFoundation on iOS (-11850) often fails with chunked responses.
 * Workaround: fetch full response and play from a local file (file://) or blob.
 */

import { writeFileSync } from "fs";

const URL_TO_FETCH =
  process.argv[2] ||
  "https://hub.example.com/endpoint/@example/external-hub-reolink/public/webhook/video/2028/mnt%2Fsda%2FU109527000HXOHJ142G-Camera%20laundry%2FMp4Record%2F2026-02-25%2FRecM04_20260225_193417_193521_0_900_510_033C8200000000_1138910.mp4";
const SAVE = process.argv.includes("--save");

const UA_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

async function main() {
  console.log("Fetching:", URL_TO_FETCH.slice(0, 80) + "...");

  const res = await fetch(URL_TO_FETCH, {
    method: "GET",
    headers: { accept: "*/*", "user-agent": UA_DESKTOP },
    redirect: "follow",
  });

  console.log("Status:", res.status, res.statusText);
  console.log("Headers:");
  for (const [k, v] of res.headers.entries()) {
    console.log("  ", k + ":", v);
  }

  const contentLength = res.headers.get("content-length");
  const transferEncoding = res.headers.get("transfer-encoding");
  const acceptRanges = res.headers.get("accept-ranges");

  console.log("\n>>> Why iOS AVFoundation can fail (-11850):");
  console.log("  transfer-encoding:", transferEncoding ?? "(none)");
  console.log("  content-length:", contentLength ?? "(missing)");
  console.log("  accept-ranges:", acceptRanges ?? "(missing)");
  if (transferEncoding === "chunked" && !contentLength) {
    console.log("  => Chunked response without Content-Length is often rejected by AVPlayer on iOS.");
    console.log("  => Workaround: fetch full body and play from local file (file://) or blob.");
  }

  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  console.log("\nBody length:", size, "bytes");

  const first = Buffer.from(buf.slice(0, 8));
  const isMp4 = first[4] === 0x66 && first[5] === 0x74 && first[6] === 0x79 && first[7] === 0x70; // ftyp
  console.log("Looks like MP4 (ftyp):", isMp4);

  if (SAVE && size > 0) {
    const outPath = "./out-clip.mp4";
    writeFileSync(outPath, Buffer.from(buf));
    console.log("Written to", outPath);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
