export interface KitProp {
  readonly name: string
  readonly type: string
  readonly optional: boolean
  readonly doc: string
}
export interface KitEntry {
  readonly name: string
  readonly kind: 'component' | 'hook' | 'function' | 'constant'
  readonly file: string
  readonly summary: string
  readonly props?: readonly KitProp[]
}
export interface ViewerColorToken {
  readonly key: string
  readonly dark: string
  readonly light: string | null
}
export interface ViewerCatalogue {
  readonly generatedBy: string
  readonly colors: readonly ViewerColorToken[]
  readonly entries: readonly KitEntry[]
}
export const CATALOGUE_PATH: string
export const KIT_DIR: string
export const EXTRA_FILES: readonly string[]
export const TOKENS_FILE: string
export function summarize(doc: string): string
export function fileEntries(root: string, rel: string): KitEntry[]
export function parseColorBlock(src: string, label: string): Map<string, string>
export function parseTokens(src: string): ViewerColorToken[]
export function buildCatalogue(root: string): ViewerCatalogue
export function renderCatalogue(catalogue: ViewerCatalogue): string
