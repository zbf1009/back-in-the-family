// One source-pixel coordinate space for scenery, portraits and their shared fit.
export const STAGE_WIDTH = 416;
export const STAGE_HEIGHT = 192;

/** Below the native width, keep source pixels intact in the local scroll viewport. */
export function stagePixelScale(availableWidth: number): number {
  return Math.max(1, Math.min(2, Math.floor(availableWidth / STAGE_WIDTH)));
}
