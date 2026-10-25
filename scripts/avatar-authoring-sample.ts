/** Original technical sample art, drawn from geometry rather than a private reference image.
 * Every pose is rasterized independently; the walk articulates feet, knees and arms.
 * No model, image download, resident mutation or server is involved.
 */
import { PNG } from 'pngjs';

const WIDTH = 96, HEIGHT = 64;
type Color = readonly [number, number, number, number];
const colors = {
  outline: [36, 57, 56, 255], mint: [95, 158, 137, 255], light: [170, 214, 178, 255],
  shade: [58, 110, 100, 255], gold: [229, 174, 80, 255], boot: [57, 75, 80, 255],
  eye: [250, 241, 205, 255],
} satisfies Record<string, Color>;

function frame(kind: 'idle' | 'walk', index: number): Buffer {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  const dot = (x: number, y: number, color: Color) => {
    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) pixels.set(color, (y * WIDTH + x) * 4);
  };
  const rect = (x: number, y: number, width: number, height: number, color: Color) => {
    for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++) dot(px, py, color);
  };
  const line = (x0: number, y0: number, x1: number, y1: number, color: Color, thickness = 2) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let at = 0; at <= steps; at++) rect(Math.round(x0 + (x1 - x0) * at / steps), Math.round(y0 + (y1 - y0) * at / steps), thickness, thickness, color);
  };
  const walk = kind === 'walk';
  const gait = walk ? [0, 3, 5, 3, 0, -3, -5, -3][index]! : 0;
  const bob = walk && [1, 2, 5, 6].includes(index) ? -1 : 0;
  const blink = !walk && index === 4;
  const breath = !walk && [2, 3, 5, 6].includes(index) ? 1 : 0;
  // The two legs articulate in opposite phases, with a raised trailing foot.
  const leftLift = walk && index >= 1 && index <= 3 ? 2 : 0;
  const rightLift = walk && index >= 5 && index <= 7 ? 2 : 0;
  line(43, 29 + bob, 42 + gait, 33 - leftLift, colors.outline, 3);
  line(42 + gait, 33 - leftLift, 41 + gait, 36 - leftLift, colors.outline, 3);
  rect(40 + gait, 36 - leftLift, 7, 3, colors.boot);
  line(51, 29 + bob, 52 - gait, 33 - rightLift, colors.outline, 3);
  line(52 - gait, 33 - rightLift, 51 - gait, 36 - rightLift, colors.outline, 3);
  rect(50 - gait, 36 - rightLift, 7, 3, colors.boot);
  // Rear arm, torso, then front arm. Arm swing counters the stepping legs.
  line(39, 21 + bob, 37 - gait, 28 + bob, colors.outline, 3);
  line(40, 21 + bob, 38 - gait, 27 + bob, colors.shade, 2);
  rect(39 - breath, 18 + bob, 19 + breath, 13, colors.outline);
  rect(41 - breath, 20 + bob, 15 + breath, 9, colors.mint);
  rect(43, 22 + bob, 9, 5, colors.light);
  rect(50, 23 + bob, 3, 3, colors.gold);
  line(55, 21 + bob, 57 + gait, 27 + bob, colors.outline, 3);
  line(55, 22 + bob, 57 + gait, 26 + bob, colors.mint, 2);
  // A right-facing rounded helmet and small antenna identify this original courier bot.
  rect(40, 7 + bob, 15, 14, colors.outline);
  rect(38, 10 + bob, 19, 8, colors.outline);
  rect(41, 8 + bob, 13, 12, colors.light);
  rect(39, 11 + bob, 17, 5, colors.light);
  rect(42, 9 + bob, 4, 9, colors.mint);
  rect(47, 11 + bob, 9, 6, colors.outline);
  if (blink) rect(49, 14 + bob, 5, 1, colors.eye);
  else { rect(49, 12 + bob, 2, 3, colors.eye); rect(53, 12 + bob, 2, 3, colors.eye); }
  rect(55, 17 + bob, 3, 2, colors.gold);
  rect(44, 4 + bob, 2, 4, colors.outline);
  rect(43 + (!walk && index === 7 ? 1 : 0), 3 + bob, 4, 2, colors.gold);
  return pixels;
}

function strip(kind: 'idle' | 'walk', frames: number): Buffer {
  const png = new PNG({ width: WIDTH * frames, height: HEIGHT });
  for (let index = 0; index < frames; index++) {
    const pixels = frame(kind, index);
    for (let y = 0; y < HEIGHT; y++) pixels.copy(png.data, (y * png.width + index * WIDTH) * 4, y * WIDTH * 4, (y + 1) * WIDTH * 4);
  }
  return PNG.sync.write(png, { colorType: 6, bitDepth: 8, inputColorType: 6, inputHasAlpha: true });
}

export function createOriginalAvatarSample(): { idle: Buffer; walk: Buffer } {
  return { idle: strip('idle', 9), walk: strip('walk', 8) };
}
