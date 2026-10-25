/**
 * The wire parsers behind the node and package pickers (D637). An answer the
 * parser cannot read is `null`, and the hook THROWS on it — never an empty
 * list, which would be a claim of absence from a read that said nothing (D315).
 */
import { describe, expect, it } from 'vitest'
import { parseNodeDirectory } from '../use-node-directory.js'
import { parseInstalledPackages } from '../use-addon-packages.js'

describe('parseNodeDirectory', () => {
  it('reads a directory', () => {
    const value = { nodes: [{ id: 'hub', name: 'Hub', isHub: true, isOnline: true }], complete: true }
    expect(parseNodeDirectory(value)).toEqual(value)
  })

  it('is null for anything else', () => {
    expect(parseNodeDirectory({ nodes: 'x' })).toBeNull()
    expect(parseNodeDirectory(null)).toBeNull()
  })
})

describe('parseInstalledPackages', () => {
  it('keeps name and version, drops the rest', () => {
    expect(
      parseInstalledPackages([{ name: '@camstack/addon-x', version: '1.0.0', dir: '/data/x' }]),
    ).toEqual([{ name: '@camstack/addon-x', version: '1.0.0' }])
  })

  it('is null for anything else — never an empty list', () => {
    expect(parseInstalledPackages(null)).toBeNull()
    expect(parseInstalledPackages([{ name: 3 }])).toBeNull()
  })
})
