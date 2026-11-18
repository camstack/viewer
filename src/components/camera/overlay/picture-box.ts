/**
 * picture-box — where a NORMALISED box (0..1 of the camera's frame) lands on
 * the screen.
 *
 * ## Why the box overlays cannot scale by the container
 *
 * The player's `<video>` renders `object-fit: contain` in every layout (the
 * embed's `CameraStreamPlayer`). The box it sits in is laid out for 16:9
 * before a frame decodes, so a camera that is not 16:9 gets bands: a 4256×1888
 * panoramic (≈2.25:1) in a 16:9 box leaves a band above and below the picture.
 * A detection box scaled by the WHOLE container (`y1 * container.height`) is
 * then drawn against the bands as well as the picture — it sits too high near
 * the top of the frame, too low near the bottom, and is stretched vertically.
 *
 * So every box overlay maps onto the PICTURE's rectangle: the largest
 * rectangle of the stream's aspect that fits the container, centred
 * ({@link videoRectIn} with `contain`), and offsets by that rectangle's origin.
 *
 * Pure module — no React. Safe for tests.
 */
import { videoRectIn, type Rect, type Size } from './overlay-size.js'

/** A box in normalised frame coordinates, 0..1 on both axes. */
export interface NormalizedBox {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

/** Where the picture sits in a `container` for a stream of `aspect`
 *  (width / height). The player letterboxes, so this is a `contain` fit. */
export function pictureRectIn(container: Size, aspect: number): Rect {
  return videoRectIn(container, 'contain', aspect)
}

/** The on-screen rectangle of a normalised box drawn over `picture`, in the
 *  container's coordinates. */
export function placeNormalizedBox(box: NormalizedBox, picture: Rect): Rect {
  return {
    x: picture.x + box.x1 * picture.width,
    y: picture.y + box.y1 * picture.height,
    width: (box.x2 - box.x1) * picture.width,
    height: (box.y2 - box.y1) * picture.height,
  }
}
