export interface NetInfoState {
  readonly isConnected: boolean
  readonly type: string
  readonly details: null
}

const state: NetInfoState = { isConnected: true, type: 'wifi', details: null }

const NetInfo = {
  fetch: (): Promise<NetInfoState> => Promise.resolve(state),
  addEventListener: (): (() => void) => () => undefined,
  configure: (): void => undefined,
}

export default NetInfo
