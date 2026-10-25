export function createHash(): never {
  throw new Error('node:crypto is unavailable in the browser embed')
}
