/**
 * `expo-file-system/legacy` under vitest — a real in-memory file system.
 *
 * It used to be a set of no-ops that answered "no file, wrote nothing". That was
 * enough while nothing in `src/` READ what it had written, and stopped being
 * enough the moment snapshots started persisting their last good frame
 * (`src/data/snapshot-file-cache.ts`): the mount harness runs as
 * `Platform.OS = 'ios'` on purpose, so a stub that cannot store a byte makes
 * every native tile render blank in tests for a reason no device would have.
 *
 * `downloadAsync` synthesises the ONE response header the cache depends on —
 * the ETag — from the requested URL, exactly as `snapshot-media-handler.ts`
 * builds it (`"<deviceId>-<capturedAt>[-w<width>]"`). Derived from the request
 * rather than hard-coded: a fake that hands back a value the client never asked
 * for is how this repo has twice shipped a bug behind a green suite.
 */
export const documentDirectory = 'file:///test/'
export const cacheDirectory = 'file:///test-cache/'
export const EncodingType = { UTF8: 'utf8', Base64: 'base64' } as const

/** Absolute file URI → contents. */
const files = new Map<string, string>()
/** Directories created so far — `readDirectoryAsync` refuses an unknown one. */
const directories = new Set<string>([documentDirectory, cacheDirectory])

/** Every URL `downloadAsync` was asked for, in order. */
export const downloadedUrls: string[] = []

/** Reset between specs. */
export function resetTestFileSystem(): void {
  files.clear()
  directories.clear()
  directories.add(documentDirectory)
  directories.add(cacheDirectory)
  downloadedUrls.length = 0
}

function directoryOf(fileUri: string): string {
  return fileUri.slice(0, fileUri.lastIndexOf('/') + 1)
}

export function getInfoAsync(fileUri: string): Promise<{ exists: boolean; uri: string }> {
  return Promise.resolve({ exists: files.has(fileUri), uri: fileUri })
}

export function readAsStringAsync(fileUri: string): Promise<string> {
  return Promise.resolve(files.get(fileUri) ?? '')
}

export function writeAsStringAsync(fileUri: string, contents: string): Promise<void> {
  files.set(fileUri, contents)
  return Promise.resolve()
}

export function deleteAsync(fileUri: string): Promise<void> {
  files.delete(fileUri)
  return Promise.resolve()
}

export function makeDirectoryAsync(fileUri: string): Promise<void> {
  directories.add(fileUri.endsWith('/') ? fileUri : `${fileUri}/`)
  return Promise.resolve()
}

export function readDirectoryAsync(fileUri: string): Promise<string[]> {
  const dir = fileUri.endsWith('/') ? fileUri : `${fileUri}/`
  if (!directories.has(dir)) return Promise.reject(new Error(`ENOENT: ${dir}`))
  const names: string[] = []
  for (const uri of files.keys()) {
    if (directoryOf(uri) === dir) names.push(uri.slice(dir.length))
  }
  return Promise.resolve(names)
}

export function copyAsync(options: { from: string; to: string }): Promise<void> {
  files.set(options.to, files.get(options.from) ?? '')
  return Promise.resolve()
}

export function moveAsync(options: { from: string; to: string }): Promise<void> {
  files.set(options.to, files.get(options.from) ?? '')
  files.delete(options.from)
  return Promise.resolve()
}

/** The `v` query parameter's leading digits — the capture identity the client
 *  versioned the URL on. */
function capturedAtFrom(url: string): string | null {
  const version = /[?&]v=(\d+)/.exec(url)
  return version?.[1] ?? null
}

export function downloadAsync(
  url: string,
  fileUri: string,
  _options?: unknown,
): Promise<{ uri: string; status: number; headers: Record<string, string> }> {
  downloadedUrls.push(url)
  const device = /\/(\d+)\.jpg/.exec(url)?.[1] ?? null
  const capturedAt = capturedAtFrom(url)
  if (device === null || capturedAt === null) {
    // No identity in the request → the real server would still answer, but with
    // an ETag the client cannot use. Answering 404 keeps the stub honest about
    // what it cannot construct.
    return Promise.resolve({ uri: fileUri, status: 404, headers: {} })
  }
  const width = /[?&]w=(\d+)/.exec(url)?.[1]
  const etag = `"${device}-${capturedAt}${width === undefined ? '' : `-w${width}`}"`
  files.set(fileUri, `jpeg:${etag}`)
  return Promise.resolve({ uri: fileUri, status: 200, headers: { etag } })
}
