export interface ViewerUiFinding {
  readonly file: string
  readonly line: number
  readonly rule: string
  readonly match: string
  readonly message: string
}
export function isCheckedFile(file: string): boolean
export function isEmbed(file: string): boolean
export function hexMessage(hex: string, tokens: ReadonlyMap<string, string>): string
export function reactNativeImports(text: string): { name: string; line: number }[]
export function checkViewerSource(
  file: string,
  source: string,
  tokens?: ReadonlyMap<string, string>,
): ViewerUiFinding[]
export function summarize(findings: readonly ViewerUiFinding[]): {
  byRule: Record<string, number>
  filesByRule: Record<string, number>
  files: number
}
