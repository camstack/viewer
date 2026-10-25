/**
 * feature-flags — the app's build-time switches, in ONE place.
 *
 * A flag here ships a feature that is wired but not yet offered: it is OFF in
 * every build until someone flips the constant. There is no remote or stored
 * flag mechanism in the viewer, and one flag does not justify building it.
 */
export interface FeatureFlags {
  /**
   * Library → Scenes. The section, route target and placeholder page exist; the
   * entry stays hidden until the page is real.
   */
  readonly scenesLibrary: boolean
}

export const FEATURE_FLAGS: FeatureFlags = {
  scenesLibrary: false,
}
