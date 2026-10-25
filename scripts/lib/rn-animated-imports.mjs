/**
 * Find the imports of React Native's own animation API in a source text.
 *
 * `Animated` and `Easing` from 'react-native' are banned from the app: every
 * motion runs on Reanimated and takes its numbers from `src/theme/motion.ts`.
 * Two animation engines in one bundle meant two spring configs for the same
 * press, and a value that one engine drives cannot be read by the other.
 *
 * A text scan rather than a parse: comments are stripped first (a docblock
 * explaining the ban must not read as a violation), then every
 * `import … from 'react-native'` / `require('react-native')` is looked at —
 * across line breaks, because the long import lists wrap.
 */

const BANNED = ['Animated', 'Easing', 'LayoutAnimation']

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

/** @returns {{ line: number, name: string }[]} */
export function findRnAnimatedImports(source) {
  const text = stripComments(source)
  const found = []
  const named = /import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]react-native['"]/g
  for (const match of text.matchAll(named)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
      if (BANNED.includes(name)) found.push({ line: lineOf(text, match.index), name })
    }
  }
  const namespace = /import\s+\*\s+as\s+([\w$]+)\s+from\s*['"]react-native['"]/g
  for (const match of text.matchAll(namespace)) {
    const use = new RegExp(`\\b${match[1].replace('$', '\\$')}\\.(${BANNED.join('|')})\\b`, 'g')
    for (const hit of text.matchAll(use)) found.push({ line: lineOf(text, hit.index), name: hit[1] })
  }
  const required = new RegExp(`require\\(\\s*['"]react-native['"]\\s*\\)\\s*\\.(${BANNED.join('|')})\\b`, 'g')
  for (const hit of text.matchAll(required)) found.push({ line: lineOf(text, hit.index), name: hit[1] })
  return found
}
