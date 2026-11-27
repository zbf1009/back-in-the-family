import type { KeySceneView, PicturePerson } from '../main/key-scene.ts';
import type { SpriteSet } from './sprites.ts';
import { portraitId } from './portraits.ts';
import { paintOfficeInterior } from './office-interior.ts';
import { STAGE_HEIGHT, STAGE_WIDTH } from './stage-geometry.ts';

// Original Apache-2.0 pixel scenery, recorded in life-view-provenance.json.
// These are theatrical notebook/bureau materials, not a recorded place or event.

function block(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

export function paintUnderworldDesk(ctx: CanvasRenderingContext2D, art: SpriteSet): void {
  block(ctx, '#242d38', 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  block(ctx, '#35434b', 0, 0, STAGE_WIDTH, 108);
  block(ctx, '#263139', 0, 100, STAGE_WIDTH, 12);
  for (let shelf = 0; shelf < 2; shelf++) {
    const y = 16 + shelf * 44;
    block(ctx, '#18262e', 16, y, STAGE_WIDTH - 32, 30);
    for (let file = 0; file < 20; file++) {
      const x = 24 + file * 18;
      block(ctx, file % 3 === 0 ? '#6a5a55' : file % 3 === 1 ? '#6d7466' : '#827961', x, y + 5, 12, 22);
      block(ctx, '#c4b48a', x + 3, y + 10, 6, 2);
    }
    block(ctx, '#ba945d', 12, y + 30, STAGE_WIDTH - 24, 4);
  }
  block(ctx, '#aa7a50', 0, 116, STAGE_WIDTH, 76);
  block(ctx, '#d0a974', 0, 112, STAGE_WIDTH, 8);
  block(ctx, '#795638', 0, 180, STAGE_WIDTH, 12);
  for (let y = 130; y < 180; y += 16) block(ctx, '#9b704a', 0, y, STAGE_WIDTH, 2);
  block(ctx, '#273e3e', 344, 94, 48, 10);
  block(ctx, '#5c7270', 360, 42, 8, 54);
  block(ctx, '#d0b36b', 340, 26, 48, 20);
  block(ctx, '#f0d78a', 346, 44, 36, 4);
  block(ctx, '#263f3c', 318, 142, 56, 26);
  block(ctx, '#d4c59d', 322, 138, 52, 4);
  block(ctx, '#a7b294', 324, 148, 20, 3);
  art.prop(ctx, 'seal', 384, 144);
}

export function paintLifeDeparture(ctx: CanvasRenderingContext2D, art: SpriteSet): void {
  block(ctx, '#d8d7bf', 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  block(ctx, '#87998a', 0, 118, STAGE_WIDTH, 74);
  block(ctx, '#4f665e', 0, 118, STAGE_WIDTH, 6);
  block(ctx, '#ab9877', 14, 18, STAGE_WIDTH - 28, 144);
  block(ctx, '#f0e9d2', 20, 12, 186, 142);
  block(ctx, '#e8dfc4', 210, 12, 186, 142);
  block(ctx, '#9a876b', 206, 12, 4, 150);
  for (let y = 34; y < 136; y += 18) {
    block(ctx, '#d4ccb3', 34, y, 148, 1);
    block(ctx, '#cec3a7', 228, y, 146, 1);
  }
  art.prop(ctx, 'candle', 336, 92);
}

export function paintMemorialPortrait(ctx: CanvasRenderingContext2D, art: SpriteSet, person: PicturePerson): void {
  block(ctx, '#675c48', 44, 77, 80, 74);
  block(ctx, '#c8b17b', 48, 79, 72, 70);
  art.portraits.draw(ctx, portraitId({ person: person.id, sex: person.sex, age: person.age }), 52, 81);
  // A real lower frame rail covers the torso at one straight pixel edge.
  block(ctx, '#675c48', 48, 143, 72, 6);
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
    paintOfficeInterior(ctx, art);
    return;
  }
  if (kind === 'dream') {
    block(ctx, '#293546', 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    block(ctx, '#59647a', 0, 130, STAGE_WIDTH, 62);
    block(ctx, '#d1c8ac', 14, 26, 116, 140);
    block(ctx, '#8b93a1', 20, 32, 104, 128);
    block(ctx, '#3b475d', 26, 38, 92, 92);
    for (const [x, y] of [[42, 52], [102, 74], [69, 94], [334, 32], [400, 82]]) block(ctx, '#d0bd88', x!, y!, 3, 3);
    art.prop(ctx, 'cloud', 320, 126);
    return;
  }
  if (kind === 'family_death') {
    block(ctx, '#7e7b83', 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    block(ctx, '#3f4b53', 0, 116, STAGE_WIDTH, 76);
    block(ctx, '#ddd1b1', 22, 18, STAGE_WIDTH - 44, 86);
    block(ctx, '#b7aa93', 30, 26, STAGE_WIDTH - 60, 70);
    block(ctx, '#29383d', 0, 150, STAGE_WIDTH, 42);
    for (const x of [126, 306]) art.prop(ctx, 'candle', x, 108);
    return;
  }
  if (kind === 'inheritance' || kind === 'debt_due') {
    const debt = kind === 'debt_due';
    block(ctx, debt ? '#bcc5bc' : '#d4c3a0', 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    block(ctx, debt ? '#58746d' : '#807153', 0, 112, STAGE_WIDTH, 80);
    block(ctx, '#decda4', 0, 108, STAGE_WIDTH, 8);
    for (let y = 128; y < 192; y += 20) block(ctx, debt ? '#4e6862' : '#726344', 0, y, STAGE_WIDTH, 2);
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
    block(ctx, '#c9beb4', 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    block(ctx, '#516b65', 0, 126, STAGE_WIDTH, 66);
    block(ctx, '#e5dbbf', 0, 108, STAGE_WIDTH, 18);
    block(ctx, '#ac9b7f', 204, 0, 8, 108);
    block(ctx, '#857b66', 0, 146, STAGE_WIDTH, 6);
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
      block(ctx, '#cfd9c1', 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
      block(ctx, '#ece8ce', 0, 114, STAGE_WIDTH, 78);
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
  block(ctx, palettes[season]!, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  block(ctx, '#667e69', 0, 126, STAGE_WIDTH, 66);
  block(ctx, '#ebe3c8', 0, 112, STAGE_WIDTH, 20);
  art.house(ctx, 250, 26, 140, 120);
  block(ctx, '#bb9a6c', 32, 150, 150, 8);
  block(ctx, '#76583f', 42, 158, 10, 28);
  block(ctx, '#76583f', 162, 158, 10, 28);
}

export function paintStagePerson(ctx: CanvasRenderingContext2D, art: SpriteSet, person: PicturePerson,
  x: number, y: number, portrait = false): void {
  ctx.save();
  if (portrait || person.lifeStatus === 'deceased') {
    ctx.translate(x - 84, y - 145);
    paintMemorialPortrait(ctx, art, person);
  } else {
    block(ctx, '#b7c5af', x - 36, y - 68, 72, 72);
    art.portraits.draw(ctx, portraitId({ person: person.id, sex: person.sex, age: person.age }), x - 32, y - 64);
    block(ctx, '#304d44', x - 36, y - 2, 72, 6);
  }
  ctx.restore();
}

export function paintCradle(ctx: CanvasRenderingContext2D, art: SpriteSet, person: PicturePerson): void {
  block(ctx, '#a17b51', 30, 76, 112, 88);
  block(ctx, '#d8c098', 36, 78, 100, 76);
  block(ctx, '#f1e7ca', 42, 82, 88, 66);
  art.portraits.draw(ctx, portraitId({ person: person.id, sex: person.sex, age: person.age }), 52, 82);
  block(ctx, '#a17b51', 36, 146, 100, 8);
  block(ctx, '#6c5641', 40, 164, 10, 18);
  block(ctx, '#6c5641', 122, 164, 10, 18);
}
