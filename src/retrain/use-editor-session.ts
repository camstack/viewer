/**
 * The editing session of ONE frame: the editor state, its undo history and the
 * baseline a "dirty" check compares against. All the rules are the pure modules
 * (`editor`, `history`, `dirty`); this hook only holds them in React state.
 *
 * A gesture (a drag, a run of typing) is ONE undo step: `beginGesture`, any
 * number of `transientApply`, `endGesture`. Selection is not an edit —
 * `select` changes the picture without a step and keeps the redo stack.
 */
import { useCallback, useMemo, useState } from 'react'
import { editorSignature } from './dirty.js'
import { seedEditor, selectBox, type EditorState } from './editor.js'
import {
  beginGesture,
  canRedo,
  canUndo,
  commit,
  endGesture,
  historyOf,
  redo,
  replacePresent,
  transient,
  undo,
  type History,
} from './history.js'

interface Session {
  readonly history: History<EditorState>
  readonly baseline: string
}

function fresh(seed: EditorState): Session {
  return { history: historyOf(seed), baseline: editorSignature(seed) }
}

export interface EditorSession {
  readonly editor: EditorState
  readonly dirty: boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
  /** Replace everything with a server-seeded state; the baseline moves with it. */
  readonly reset: (seed: EditorState) => void
  /** The current state becomes the baseline (after a successful save). */
  readonly markSaved: () => void
  readonly apply: (change: (state: EditorState) => EditorState) => void
  readonly select: (key: string | null) => void
  readonly beginGesture: () => void
  readonly transientApply: (change: (state: EditorState) => EditorState) => void
  readonly endGesture: () => void
  readonly undo: () => void
  readonly redo: () => void
}

export function useEditorSession(): EditorSession {
  const [session, setSession] = useState<Session>(() => fresh(seedEditor([], [])))
  const editor = session.history.present
  const signature = useMemo(() => editorSignature(editor), [editor])

  const reset = useCallback((seed: EditorState) => setSession(fresh(seed)), [])
  const markSaved = useCallback(
    () =>
      setSession((s) => ({ ...s, baseline: editorSignature(s.history.present) })),
    [],
  )
  const apply = useCallback(
    (change: (state: EditorState) => EditorState) =>
      setSession((s) => ({ ...s, history: commit(s.history, change(s.history.present)) })),
    [],
  )
  const select = useCallback(
    (key: string | null) =>
      setSession((s) => ({
        ...s,
        history: replacePresent(s.history, selectBox(s.history.present, key)),
      })),
    [],
  )
  const begin = useCallback(
    () => setSession((s) => ({ ...s, history: beginGesture(s.history) })),
    [],
  )
  const transientApply = useCallback(
    (change: (state: EditorState) => EditorState) =>
      setSession((s) => ({ ...s, history: transient(s.history, change(s.history.present)) })),
    [],
  )
  const end = useCallback(
    () => setSession((s) => ({ ...s, history: endGesture(s.history) })),
    [],
  )
  const doUndo = useCallback(() => setSession((s) => ({ ...s, history: undo(s.history) })), [])
  const doRedo = useCallback(() => setSession((s) => ({ ...s, history: redo(s.history) })), [])

  return {
    editor,
    dirty: signature !== session.baseline,
    canUndo: canUndo(session.history),
    canRedo: canRedo(session.history),
    reset,
    markSaved,
    apply,
    select,
    beginGesture: begin,
    transientApply,
    endGesture: end,
    undo: doUndo,
    redo: doRedo,
  }
}
