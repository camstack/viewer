export const BLOCK_BEGIN: string
export const BLOCK_END: string
export const MDC_PATH: string
export const AGENTS_PATH: string
export const VIEWER_UI_GLOBS: readonly string[]
export function pointerLines(): string[]
export function renderBlock(): string
export function extractBlock(text: string): string | null
export function spliceBlock(text: string, block: string): string
export function renderMdc(): string
