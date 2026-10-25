import { describe, it, expect, vi } from 'vitest'

import { plateApplySuggestionsJob, plateAssignJob, plateDeleteJob, type PlateJobPorts } from '../plate-review-jobs.js'

const t = (key: string, opts?: Record<string, unknown>): string => `${key}${opts ? JSON.stringify(opts) : ''}`
const context = { progress: vi.fn() }

function ports(over: Partial<PlateJobPorts> = {}): PlateJobPorts {
  return {
    assign: vi.fn(async ({ plateIds }) => ({ assigned: plateIds.length, failed: [] })),
    createVehicle: vi.fn(async (name: string) => ({ id: 'new', name })),
    deletePlates: vi.fn(async (ids) => ({ deleted: ids.length })),
    flush: vi.fn(async () => undefined),
    ...over,
  }
}

describe('plate jobs run on the Activity queue', () => {
  it('assign: one write, the kind the queue knows', async () => {
    const p = ports()
    const job = plateAssignJob(p, t, { plateIds: ['a', 'b'], target: { vehicleId: 'v1', name: 'Panda' } })
    expect(job.jobKind).toBe('plate-assign')
    const out = await job.run(context)
    expect(p.assign).toHaveBeenCalledWith({ plateIds: ['a', 'b'], vehicleId: 'v1', defer: false })
    expect(out.summary).toContain('assignedManySuccess')
  })

  it('create + assign: the vehicle is minted first, then the plates go onto IT', async () => {
    const p = ports()
    await plateAssignJob(p, t, { plateIds: ['a'], target: { newName: 'Van' } }).run(context)
    expect(p.createVehicle).toHaveBeenCalledWith('Van')
    expect(p.assign).toHaveBeenCalledWith({ plateIds: ['a'], vehicleId: 'new', defer: false })
  })

  it('assign fails the job when the hub assigned nothing', async () => {
    const p = ports({ assign: vi.fn(async () => ({ assigned: 0, failed: ['a'] })) })
    await expect(plateAssignJob(p, t, { plateIds: ['a'], target: { vehicleId: 'v', name: 'n' } }).run(context)).rejects.toThrow(
      'assignFailed',
    )
  })

  it('apply suggestions: one deferred write per vehicle, ONE flush at the end', async () => {
    const p = ports()
    const plan = [
      { vehicleId: 'v1', name: 'A', plateIds: ['a', 'b'] },
      { vehicleId: 'v2', name: 'B', plateIds: ['c'] },
    ]
    const job = plateApplySuggestionsJob(p, t, plan)
    expect(job.jobKind).toBe('plate-apply-suggestions')
    await job.run(context)
    expect(p.assign).toHaveBeenCalledTimes(2)
    expect(p.assign).toHaveBeenNthCalledWith(1, { plateIds: ['a', 'b'], vehicleId: 'v1', defer: true })
    expect(p.flush).toHaveBeenCalledTimes(1)
  })

  it('delete reports "n of m"', async () => {
    const p = ports({ deletePlates: vi.fn(async () => ({ deleted: 1 })) })
    const job = plateDeleteJob(p, t, ['a', 'b'])
    expect(job.jobKind).toBe('plate-delete')
    expect((await job.run(context)).summary).toContain('"count":1,"total":2')
  })
})
