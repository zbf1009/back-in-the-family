import type { SpriteSet } from './sprites.ts';
import { STAGE_HEIGHT, STAGE_WIDTH } from './stage-geometry.ts';

/** Original bureau pixels; shared geometry keeps scenery and portraits at one scale. */
export function paintOfficeInterior(ctx: CanvasRenderingContext2D, sprites: SpriteSet): void {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  const rect = (color: string, x: number, y: number, width: number, height: number): void => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
  };
  rect('#c8d0ba', 0, 0, STAGE_WIDTH, 144);
  for (let y = 0; y < 144; y += 16) {
    for (let x = 0; x < STAGE_WIDTH; x += 16) sprites.prop(ctx, 'house_wall', x, y);
  }
  rect('#d0d3be', 0, 8, STAGE_WIDTH, 62);
  rect('#7b8e78', 0, 70, STAGE_WIDTH, 74);
  rect('#a6b59a', 0, 70, STAGE_WIDTH, 4);
  rect('#3d5149', 0, 140, STAGE_WIDTH, 6);
  // Indoor linoleum: straight grout, full rectangular tiles, no grass or paving.
  rect('#b3ad94', 0, 146, STAGE_WIDTH, 46);
  for (let y = 146; y < 192; y += 16) {
    rect('#8f917d', 0, y, STAGE_WIDTH, 1);
    for (let x = (y === 162 ? 16 : 0); x < STAGE_WIDTH; x += 32) rect('#8f917d', x, y, 1, 16);
  }
  // Entire window and wall pictures sit above the document's top edge.
  rect('#5d695a', 24, 14, 68, 48);
  rect('#eee4bc', 28, 18, 60, 40);
  rect('#839f9b', 32, 22, 52, 32);
  rect('#bdccc0', 36, 26, 18, 10);
  rect('#eee4bc', 56, 22, 4, 32);
  rect('#eee4bc', 32, 38, 52, 4);
  rect('#687057', 114, 16, 34, 42);
  rect('#e7dbb7', 118, 20, 26, 34);
  rect('#9aaa8b', 122, 24, 18, 20);
  rect('#687e6c', 122, 40, 18, 4);
  rect('#9d916d', 122, 48, 18, 2);
  rect('#687057', 170, 18, 64, 36);
  rect('#e7dbb7', 174, 22, 56, 28);
  for (let y = 28; y < 46; y += 6) rect('#899478', 182, y, 40, 2);
  // Service hatch: dark opening, sliding glass and an unmistakable counter ledge.
  rect('#536856', 272, 10, 124, 56);
  rect('#e0d0a5', 278, 16, 112, 44);
  rect('#304440', 284, 22, 100, 32);
  rect('#7f9991', 334, 22, 50, 32);
  rect('#b8c9b9', 340, 26, 36, 2);
  rect('#d6c59c', 332, 22, 4, 32);
  rect('#8a6b4b', 268, 58, 132, 10);
  rect('#e6cd99', 268, 58, 132, 3);
  sprites.prop(ctx, 'candle', 284, 42);
  sprites.prop(ctx, 'seal', 362, 42);
  // Ticket dispenser, paper roll, tear slot and ticket. Its stand is not a stray square.
  rect('#48594e', 122, 84, 28, 40);
  rect('#a66546', 124, 80, 24, 38);
  rect('#c38659', 128, 82, 16, 4);
  rect('#eadcb8', 129, 90, 14, 10);
  rect('#374b42', 128, 104, 16, 4);
  rect('#f5eacb', 130, 108, 12, 22);
  rect('#526255', 133, 114, 6, 2);
  rect('#526255', 137, 116, 2, 6);
  rect('#526255', 133, 122, 6, 2);
  rect('#637568', 132, 130, 8, 20);
  rect('#384e44', 122, 150, 28, 4);
  // Queue posts, weighted feet and two rails remain visible below the portrait file.
  for (const x of [18, 100, 148]) {
    rect('#455d51', x, 154, 4, 28);
    rect('#d1cba6', x - 2, 150, 8, 6);
    rect('#455d51', x - 6, 180, 16, 4);
  }
  rect('#82724f', 22, 158, 126, 4);
  rect('#b4a17a', 22, 158, 126, 1);
  rect('#82724f', 22, 170, 126, 3);
}
