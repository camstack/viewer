/**
 * LAN HTTP sibling (Network → Local access). ExpoConfig.android has no
 * `usesCleartextTraffic` field — putting it there fails `tsc --noEmit`.
 * This plugin writes `android:usesCleartextTraffic="true"` on <application>.
 */
const { withAndroidManifest } = require('expo/config-plugins')

function withCleartextTraffic(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0]
    if (application?.$) {
      application.$['android:usesCleartextTraffic'] = 'true'
    }
    return cfg
  })
}

module.exports = withCleartextTraffic
