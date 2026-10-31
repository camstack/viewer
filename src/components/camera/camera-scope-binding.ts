/** Scope mode: the ticked cameras are the surface's data scope. */
export interface CameraScopeBinding {
  /** The cameras currently read. */
  readonly selectedIds: ReadonlySet<number>
  /** The new scope, in LIST order, after a tick or "all cameras". */
  readonly onChange: (ids: readonly number[]) => void
}
