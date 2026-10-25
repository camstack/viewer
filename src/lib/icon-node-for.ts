/**
 * The drawing data for a stored icon value: the catalog's canonical key
 * (an old spelling such as `gauge2` resolves), then the generated node.
 * `undefined` for a value the catalog does not know — the caller draws nothing
 * rather than a placeholder that reads as an icon.
 */
import { canonicalIconKey } from '@camstack/types/client'

import type { IconNode } from './icon-nodes.generated.js'

export function iconNodeFor(
  value: unknown,
  nodes: Readonly<Record<string, IconNode>>,
): IconNode | undefined {
  const key = canonicalIconKey(value)
  return key === undefined ? undefined : nodes[key]
}
