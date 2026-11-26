import type { KeySceneView, PicturePerson } from '../main/key-scene.ts';
import type { SpriteSet } from './sprites.ts';

// Original Apache-2.0 pixel scenery, recorded in life-view-provenance.json.
// These are theatrical notebook/bureau materials, not a recorded place or event.
export const STAGE_WIDTH = 448;
export const STAGE_HEIGHT = 192;

function block(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

export function paintUnderworldDesk(ctx: CanvasRenderingContext2D, art: SpriteSet): void {
  block(ctx, '#242d38', 0, 0, 448, 192);
  block(ctx, '#35434b', 0, 0, 448, 108);
  block(ctx, '#263139', 0, 100, 448, 12);
  for (let shelf = 0; shelf < 2; shelf++) {
    const y = 16 + shelf * 44;
    block(ctx, '#18262e', 16, y, 416, 30);
    for (let file = 0; file < 22; file++) {
      const x = 24 + file * 18;
      block(ctx, file % 3 === 0 ? '#6a5a55' : file % 3 === 1 ? '#6d7466' : '#827961', x, y + 5, 12, 22);
      block(ctx, '#c4b48a', x + 3, y + 10, 6, 2);
    }
    block(ctx, '#ba945d', 12, y + 30, 424, 4);
  }
  block(ctx, '#aa7a50', 0, 116, 448, 76);
  block(ctx, '#d0a974', 0, 112, 448, 8);
  block(ctx, '#795638', 0, 180, 448, 12);
  for (let y = 130; y < 180; y += 16) block(ctx, '#9b704a', 0, y, 448, 2);
  block(ctx, '#273e3e', 376, 94, 48, 10);
  block(ctx, '#5c7270', 392, 42, 8, 54);
  block(ctx, '#d0b36b', 372, 26, 48, 20);
  block(ctx, '#f0d78a', 378, 44, 36, 4);
  block(ctx, '#263f3c', 350, 142, 56, 26);
  block(ctx, '#d4c59d', 354, 138, 52, 4);
  block(ctx, '#a7b294', 356, 148, 20, 3);
  ctx.save();
  ctx.translate(416, 144);
  ctx.scale(1.5, 1.5);
  art.prop(ctx, 'seal', 0, 0);
  ctx.restore();
}

export function paintLifeDeparture(ctx: CanvasRenderingContext2D, art: SpriteSet): void {
  block(ctx, '#d8d7bf', 0, 0, 448, 192);
  block(ctx, '#87998a', 0, 118, 448, 74);
  block(ctx, '#4f665e', 0, 118, 448, 6);
  block(ctx, '#ab9877', 14, 18, 420, 144);
  block(ctx, '#f0e9d2', 20, 12, 202, 142);
  block(ctx, '#e8dfc4', 226, 12, 202, 142);
  block(ctx, '#9a876b', 222, 12, 4, 150);
  for (let y = 34; y < 136; y += 18) {
    block(ctx, '#d4ccb3', 34, y, 164, 1);
    block(ctx, '#cec3a7', 244, y, 162, 1);
  }
  ctx.save();
  ctx.translate(368, 92);
  ctx.scale(3, 3);
  art.prop(ctx, 'candle', 0, 0);
  ctx.restore();
}

export function paintMemorialPortrait(ctx: CanvasRenderingContext2D, art: SpriteSet, person: PicturePerson): void {
  block(ctx, '#151e25', 28, 26, 112, 130);
  block(ctx, '#c8b17b', 32, 22, 104, 130);
  block(ctx, '#675c48', 36, 26, 96, 122);
  block(ctx, '#ebe3c9', 40, 30, 88, 114);
  block(ctx, '#acb7a6', 48, 38, 72, 82);
  block(ctx, '#56695f', 48, 112, 72, 8);
  ctx.save();
  ctx.translate(84, 111);
  ctx.scale(3, 3);
  art.resident(ctx, 0, 0, 'neutral', person.visual);
  ctx.restore();
  block(ctx, '#314445', 58, 130, 52, 3);
  block(ctx, '#8b7855', 68, 138, 32, 2);
}

export type StageKind = KeySceneView['category'] | 'living' | 'waiting';

/** Cosmetic palette follows the fictional calendar; it asserts no weather. */
export function stageSeason(tick: string): number {
  const day = ((BigInt(tick) % 365n) + 365n) % 365n;
  return Number(day * 4n / 365n);
}

export function paintStageBackdrop(ctx: CanvasRenderingContext2D, art: SpriteSet, kind: StageKind,
  season: number, arrival?: 'birth' | 'death' | 'possession' | 'rebuild', chapter?: string): void {
  if (kind === 'death' || kind === 'waiting') {
    paintUnderworldDesk(ctx, art);
    return;
  }
  if (kind === 'dream') {
    block(ctx, '#293546', 0, 0, 448, 192);
    block(ctx, '#59647a', 0, 130, 448, 62);
    block(ctx, '#d1c8ac', 14, 26, 116, 140);
    block(ctx, '#8b93a1', 20, 32, 104, 128);
    block(ctx, '#3b475d', 26, 38, 92, 92);
    for (const [x, y] of [[42, 52], [102, 74], [69, 94], [334, 32], [400, 82]]) block(ctx, '#d0bd88', x!, y!, 3, 3);
    ctx.save();
    ctx.translate(320, 126);
    ctx.scale(3, 3);
    art.prop(ctx, 'cloud', 0, 0);
    ctx.restore();
    return;
  }
  if (kind === 'family_death') {
    block(ctx, '#7e7b83', 0, 0, 448, 192);
    block(ctx, '#3f4b53', 0, 116, 448, 76);
    block(ctx, '#ddd1b1', 22, 18, 404, 86);
    block(ctx, '#b7aa93', 30, 26, 388, 70);
    block(ctx, '#29383d', 0, 150, 448, 42);
    for (const x of [126, 306]) {
      ctx.save(); ctx.translate(x, 108); ctx.scale(2.5, 2.5); art.prop(ctx, 'candle', 0, 0); ctx.restore();
    }
    return;
  }
  if (kind === 'inheritance' || kind === 'debt_due') {
    const debt = kind === 'debt_due';
    block(ctx, debt ? '#bcc5bc' : '#d4c3a0', 0, 0, 448, 192);
    block(ctx, debt ? '#58746d' : '#807153', 0, 112, 448, 80);
    block(ctx, '#decda4', 0, 108, 448, 8);
    for (let y = 128; y < 192; y += 20) block(ctx, debt ? '#4e6862' : '#726344', 0, y, 448, 2);
    block(ctx, debt ? '#445d59' : '#596b51', 152, 146, 144, 30);
    block(ctx, '#e5ddbf', 156, 140, 136, 8);
    block(ctx, '#b9ac85', 166, 152, 112, 3);
    if (!debt) {
      block(ctx, '#745646', 322, 30, 88, 62);
      block(ctx, '#bfa27a', 328, 36, 76, 50);
      block(ctx, '#584b40', 338, 50, 56, 4);
    }
    return;
  }
  if (kind === 'feud') {
    block(ctx, '#c9beb4', 0, 0, 448, 192);
    block(ctx, '#516b65', 0, 126, 448, 66);
    block(ctx, '#e5dbbf', 0, 108, 448, 18);
    block(ctx, '#ac9b7f', 220, 0, 8, 108);
    block(ctx, '#857b66', 0, 146, 448, 6);
    return;
  }
  if (kind === 'life_stage') {
    paintLifeDeparture(ctx, art);
    block(ctx, '#5a725c', 312, 30, 100, 76);
    block(ctx, '#c2ba8c', 318, 36, 88, 64);
    if (chapter === 'A childhood page') {
      block(ctx, '#a9694e', 342, 64, 24, 24);
      block(ctx, '#65897b', 366, 52, 24, 36);
      block(ctx, '#e1c46d', 344, 58, 18, 6);
    } else if (chapter === 'A school-age page') {
      block(ctx, '#415c58', 326, 44, 72, 40);
      for (let y = 52; y < 80; y += 10) block(ctx, '#ddd9b7', 336, y, 48, 2);
    } else {
      block(ctx, '#725842', 330, 62, 64, 28);
      block(ctx, '#725842', 350, 50, 24, 12);
      block(ctx, '#d1b77a', 356, 74, 12, 4);
    }
    return;
  }
  if (kind === 'rebirth') {
    if (arrival === 'birth') {
      block(ctx, '#cfd9c1', 0, 0, 448, 192);
      block(ctx, '#ece8ce', 0, 114, 448, 78);
      block(ctx, '#b0b998', 16, 20, 132, 84);
      block(ctx, '#f4efd9', 24, 28, 116, 68);
    } else {
      paintLifeDeparture(ctx, art);
      block(ctx, arrival === 'possession' ? '#5b7770' : '#75657a', 16, 16, 120, 146);
      block(ctx, '#e8dfc4', 24, 24, 104, 130);
      block(ctx, '#cab89a', 30, 30, 92, 118);
    }
    return;
  }
  const palettes = ['#b3c1ae', '#d8c6a0', '#c8d0d1', '#c3c6a6'];
  block(ctx, palettes[season]!, 0, 0, 448, 192);
  block(ctx, '#667e69', 0, 126, 448, 66);
  block(ctx, '#ebe3c8', 0, 112, 448, 20);
  ctx.save();
  ctx.translate(282, 26);
  ctx.scale(2.5, 2.5);
  art.house(ctx, 0, 0, 56, 48);
  ctx.restore();
  block(ctx, '#bb9a6c', 32, 150, 150, 8);
  block(ctx, '#76583f', 42, 158, 10, 28);
  block(ctx, '#76583f', 162, 158, 10, 28);
}

export function paintStagePerson(ctx: CanvasRenderingContext2D, art: SpriteSet, person: PicturePerson,
  x: number, y: number, portrait = false): void {
  if (person.lifeStatus === 'unknown') return;
  ctx.save();
  if (portrait || person.lifeStatus === 'deceased') {
    ctx.translate(x - 84, y - 111);
    paintMemorialPortrait(ctx, art, person);
  } else {
    block(ctx, '#b7c5af', x - 32, y - 66, 64, 72);
    block(ctx, '#304d44', x - 32, y + 4, 64, 4);
    ctx.translate(x, y);
    ctx.scale(3, 3);
    art.resident(ctx, 0, 0, 'neutral', person.visual);
  }
  ctx.restore();
}

export function paintCradle(ctx: CanvasRenderingContext2D, art: SpriteSet, person: PicturePerson): void {
  block(ctx, '#a17b51', 30, 100, 112, 64);
  block(ctx, '#d8c098', 36, 94, 100, 54);
  block(ctx, '#f1e7ca', 42, 100, 88, 42);
  block(ctx, '#6c5641', 40, 164, 10, 18);
  block(ctx, '#6c5641', 122, 164, 10, 18);
  ctx.save(); ctx.translate(84, 137); ctx.scale(3, 3); art.resident(ctx, 0, 0, 'neutral', person.visual); ctx.restore();
}
