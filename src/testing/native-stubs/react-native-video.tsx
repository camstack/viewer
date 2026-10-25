import { makeStubView } from './passthrough.js'
const Video = makeStubView('Video')
export default Video
export type VideoRef = { seek: (t: number) => void; pause: () => void; resume: () => void }
export type OnLoadData = { duration: number; currentTime: number }
export type OnProgressData = { currentTime: number }
