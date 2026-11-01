// Side-effect entry: begins the boot stall probe at module evaluation, so the
// window opens as early as the layout can ask. See boot-stall-probe.ts.
import { startBootStallProbe } from './boot-stall-probe.js'

startBootStallProbe()
