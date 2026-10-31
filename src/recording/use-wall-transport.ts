/**
 * use-wall-transport — the transport a timeline shows when it has no player of
 * its own to ask: the rate, the pause and the ±10 s jog.
 *
 * Two hosts mount the theater timeline over "a wall of N" — the grid page and
 * the Library timeline — and both need the same three things the playback bar
 * draws: a rate and a pause the machine does not own, and a jog that is a seek
 * through the machine so the cursor and whatever the host draws move together.
 * The rate and the pause are pushed through `setRate` (the grid's bus, or
 * nothing where there is no player), and `setRate(0)` IS the pause — which is why
 * resuming has to know the rate to return to, held in state, read from a
 * callback that depends on it.
 */
import { useCallback, useState } from 'react'

import { jogTarget, resolveJogBase } from './playback-status.js'
import { selectActiveEpoch, type PlaybackMachine } from './playback-machine.js'

export interface WallTransport {
  readonly rate: number
  readonly paused: boolean
  readonly onSelectRate: (rate: number) => void
  readonly onTogglePlayPause: () => void
  readonly onJogBack: () => void
  readonly onJogForward: () => void
}

export function useWallTransport(
  playback: PlaybackMachine,
  setRate: (rate: number) => void,
): WallTransport {
  const [rate, setRateState] = useState(1)
  const [paused, setPaused] = useState(false)

  const onSelectRate = useCallback(
    (next: number): void => {
      setRateState(next)
      setPaused(false)
      setRate(next)
    },
    [setRate],
  )
  const onTogglePlayPause = useCallback((): void => {
    const next = !paused
    setPaused(next)
    setRate(next ? 0 : rate)
  }, [paused, rate, setRate])

  // ±10 s. A jog IS a seek, and it goes through the machine's own `seek`.
  const machineSeek = playback.seek
  const playhead = playback.state.playhead
  const activeEpoch = selectActiveEpoch(playback.state)
  const jog = useCallback(
    (dir: 1 | -1): void => {
      const target = jogTarget(resolveJogBase(playhead, activeEpoch), dir)
      if (target != null) machineSeek(target, 'timeline')
    },
    [playhead, activeEpoch, machineSeek],
  )
  const onJogBack = useCallback(() => jog(-1), [jog])
  const onJogForward = useCallback(() => jog(1), [jog])

  return { rate, paused, onSelectRate, onTogglePlayPause, onJogBack, onJogForward }
}
