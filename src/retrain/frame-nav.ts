/** Where a frame sits in the list the operator opened it from, and its neighbours. */
export interface FrameNav {
  readonly index: number
  readonly total: number
  readonly prevId: string | null
  readonly nextId: string | null
}

export function frameNav(frameIds: readonly string[], frameId: string): FrameNav {
  const index = frameIds.indexOf(frameId)
  return {
    index,
    total: frameIds.length,
    prevId: index > 0 ? (frameIds[index - 1] ?? null) : null,
    nextId: index >= 0 && index < frameIds.length - 1 ? (frameIds[index + 1] ?? null) : null,
  }
}
