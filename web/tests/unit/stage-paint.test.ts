import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portraitId } from '../../src/art/portraits.ts';
import type { SpriteSet } from '../../src/art/sprites.ts';
import type { PicturePerson } from '../../src/main/key-scene.ts';
import { paintOfficeInterior } from '../../src/art/office-interior.ts';
import { paintCradle, paintStageBackdrop, paintStagePerson, type StageKind } from '../../src/art/stage-paint.ts';
import { STAGE_HEIGHT, STAGE_WIDTH, stagePixelScale } from '../../src/art/stage-geometry.ts';

function recording() {
  const rectangles: { color: string; x: number; y: number; w: number; h: number }[] = [];
  const tiles: { kind: string; x: number; y: number }[] = [];
  const portraits: { id: number; x: number; y: number; scale: number }[] = [];
  const translations: number[][] = [];
  const ctx = {
    fillStyle: '', imageSmoothingEnabled: true,
    fillRect(this: Pick<CanvasRenderingContext2D, 'fillStyle'>, x: number, y: number, w: number, h: number) { rectangles.push({ color: String(this.fillStyle), x, y, w, h }); },
    clearRect(x: number, y: number, w: number, h: number) { assert.deepEqual([x, y, w, h], [0, 0, STAGE_WIDTH, STAGE_HEIGHT]); },
    save() { translations.push([]); },
    restore() { assert.ok(translations.pop()); },
    translate(x: number, y: number) { assert.ok(Number.isInteger(x) && Number.isInteger(y)); },
    scale() { assert.fail('Stage source pixels must not receive an independent scale'); },
  } as unknown as CanvasRenderingContext2D;
  const sprites = {
    portraits: { draw(_ctx: CanvasRenderingContext2D, id: number, x: number, y: number, scale = 1) { portraits.push({ id, x, y, scale }); } },
    prop(_ctx: CanvasRenderingContext2D, kind: string, x: number, y: number) { tiles.push({ kind, x, y }); },
    house(_ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) { assert.deepEqual([x, y, w, h], [250, 26, 140, 120]); },
    resident() { assert.fail('A scene protagonist must use the 64-source portrait pool'); },
    grave() { assert.fail('A missing portrait must not become a grave'); },
    soulMarker() { assert.fail('A portrait must not be replaced by a marker'); },
  } as SpriteSet;
  return { ctx, sprites, rectangles, tiles, portraits };
}

const subject: PicturePerson = { id: 10, name: 'Nadine Bradley', sex: 'female', age: 60,
  origin: 'native', lifeStatus: 'deceased', visual: 'elder_1', tint: 'neutral', soul: false };

test('Integer stage fit never shrinks or stretches a source pixel fractionally', () => {
  assert.equal(STAGE_WIDTH, 416);
  assert.equal(STAGE_HEIGHT, 192);
  for (const [width, expected] of [[0, 1], [320, 1], [415.9, 1], [416, 1], [831.9, 1], [832, 2], [848, 2], [1200, 2]]) {
    assert.equal(stagePixelScale(width!), expected);
    assert.ok(Number.isInteger(stagePixelScale(width!)));
  }
});

test('Every stage person, including unknown references and a known newborn, uses its exact captured portrait subject', () => {
  const art = recording();
  for (const person of [subject, { ...subject, sex: 'male' as const, age: 22, lifeStatus: 'alive' as const },
    { ...subject, sex: undefined, age: null, lifeStatus: 'unknown' as const }]) {
    paintStagePerson(art.ctx, art.sprites, person, 84, 145, true);
    assert.deepEqual(art.portraits.at(-1), { id: portraitId({ person: person.id, sex: person.sex, age: person.age }), x: 52, y: 81, scale: 1 });
    assert.deepEqual(art.rectangles.at(-1), { color: '#675c48', x: 48, y: 143, w: 72, h: 6 });
  }
  const baby = { ...subject, age: 0, lifeStatus: 'alive' as const };
  paintCradle(art.ctx, art.sprites, baby);
  assert.deepEqual(art.portraits.at(-1), { id: portraitId({ person: baby.id, sex: baby.sex, age: 0 }), x: 52, y: 82, scale: 1 });
  assert.ok(art.rectangles.some(rect => rect.x === 36 && rect.y === 146 && rect.w === 100 && rect.h === 8));
});

test('All production stage recipes keep existing tiles at their native source size', () => {
  const art = recording();
  const kinds: StageKind[] = ['living', 'waiting', 'death', 'rebirth', 'dream', 'family_death', 'inheritance', 'debt_due', 'feud', 'life_stage'];
  for (const kind of kinds) paintStageBackdrop(art.ctx, art.sprites, kind, 0, 'birth');
  paintStageBackdrop(art.ctx, art.sprites, 'rebirth', 0, 'possession');
  paintStageBackdrop(art.ctx, art.sprites, 'rebirth', 0, 'rebuild');
  assert.ok(art.tiles.length > 0);
  for (const tile of art.tiles) assert.ok(Number.isInteger(tile.x) && Number.isInteger(tile.y));
  for (const rect of art.rectangles) {
    assert.ok([rect.x, rect.y, rect.w, rect.h].every(Number.isInteger));
    assert.ok(rect.x >= 0 && rect.x + rect.w <= STAGE_WIDTH, 'A narrowed recipe must not clip its authored scenery');
  }
});

test('Death office has complete upper-wall fixtures, an indoor floor, ticket dispenser, service hatch and queue rails', () => {
  const art = recording();
  paintOfficeInterior(art.ctx, art.sprites);
  const shape = (x: number, y: number, w: number, h: number) => art.rectangles.find(rect => rect.x === x && rect.y === y && rect.w === w && rect.h === h);
  assert.ok(shape(24, 14, 68, 48), 'Window ends above the certificate top at 78');
  assert.ok(shape(114, 16, 34, 42));
  assert.ok(shape(170, 18, 64, 36));
  assert.ok(shape(272, 10, 124, 56), 'Service hatch is wholly visible');
  assert.ok(shape(268, 58, 132, 10), 'Counter ledge is wholly visible');
  assert.ok(shape(0, 146, STAGE_WIDTH, 46), 'Linoleum floor, not grass or exterior paving');
  assert.ok(shape(124, 80, 24, 38), 'Dispenser body left of the certificate');
  assert.ok(shape(128, 104, 16, 4), 'Ticket slot');
  assert.ok(shape(130, 108, 12, 22), 'Ticket');
  assert.ok(shape(22, 158, 126, 4), 'Queue rail left of the certificate');
  assert.ok(shape(22, 170, 126, 3));
  assert.ok(!art.tiles.some(tile => tile.kind === 'grass' || tile.kind === 'sidewalk' || tile.kind === 'floor'));
  assert.equal(art.ctx.imageSmoothingEnabled, false);
});
