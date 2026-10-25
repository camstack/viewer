/**
 * Let a Node process exit while a timer is pending; a no-op on every other
 * runtime.
 *
 * `setTimeout` returns a `Timeout` object under Node's typings and a `number`
 * under the DOM's, and WHICH one TypeScript picks depends on the `@types/node`
 * that happens to be nearest — the trap `CLAUDE.md` names: the working copy
 * inside `camstack-server` borrowed one version and type-checked
 * `timer.unref?.()` green, CI resolved another and went red on
 * `Property 'unref' does not exist on type 'number'` (four runs on 2026-09-10,
 * from 1516f16). Narrowing structurally from `unknown` is right under both
 * typings and on Hermes, where there is no `unref` at all.
 */
export function unrefTimer(handle: unknown): void {
  if (typeof handle !== 'object' || handle === null || !('unref' in handle)) return
  const { unref } = handle
  if (typeof unref === 'function') unref.call(handle)
}
