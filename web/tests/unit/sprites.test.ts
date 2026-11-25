import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { LIFE_ATLASES } from '../../src/art/life-view-atlas.ts';
import { resolveVisualKey } from '../../src/art/sprites.ts';
import type * as SpriteRuntime from '../../src/art/sprites.ts';

function browserGlobals(t: TestContext, image: unknown) {
  for (const [key, value] of [['Image', image], ['document', { baseURI: 'http://localhost/game/' }]] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, key);
      else Object.defineProperty(globalThis, key, descriptor);
    });
  }
}

function dimensions(src: string) {
  return Object.values(LIFE_ATLASES).find(atlas => src.endsWith(atlas.path))!;
}

async function freshRuntime(key: string): Promise<typeof SpriteRuntime> {
  return import(new URL(`../../src/art/sprites.ts?${key}`, import.meta.url).href);
}

test('Unknown age is distinct from a known newborn; selection is stable within whole-year age bands', () => {
  for (const id of [0, 1, 6, 41, 4_294_967_295]) {
    const unknown = resolveVisualKey(id, null);
    for (const age of [0, 2, 3, 12, 13, 64, 65, 10_000]) assert.notEqual(unknown, resolveVisualKey(id, age));
    assert.equal(resolveVisualKey(id, 0), resolveVisualKey(id, 2));
    assert.equal(resolveVisualKey(id, 3), resolveVisualKey(id, 12));
    assert.equal(resolveVisualKey(id, 13), resolveVisualKey(id, 64));
    assert.equal(resolveVisualKey(id, 65), resolveVisualKey(id, 10_000));
    assert.notEqual(resolveVisualKey(id, 2), resolveVisualKey(id, 3));
    assert.notEqual(resolveVisualKey(id, 12), resolveVisualKey(id, 13));
    assert.notEqual(resolveVisualKey(id, 64), resolveVisualKey(id, 65));
  }
  assert.equal(new Set(Array.from({ length: 6 }, (_, id) => resolveVisualKey(id, 30))).size, 6);
  assert.equal(resolveVisualKey(41, 30), resolveVisualKey(41 + 6, 30));
});

test('Concurrent loads decode each local atlas once; all drawing uses native integer atlas pixels', async t => {
  const images: ImageBoundary[] = [];
  let decodes = 0;
  class ImageBoundary {
    src = '';
    constructor() { images.push(this); }
    get naturalWidth() { return dimensions(this.src).width; }
    get naturalHeight() { return dimensions(this.src).height; }
    async decode() { decodes++; }
  }
  browserGlobals(t, ImageBoundary);
  const runtime = await freshRuntime('decoded-art');
  const first = runtime.loadLifeSprites();
  assert.equal(runtime.loadLifeSprites(), first);
  const sprites = await first;
  assert.equal(await runtime.loadLifeSprites(), sprites);
  assert.equal(images.length, 3);
  assert.equal(decodes, 3);
  assert.deepEqual(images.map(image => image.src).sort(), [
    'http://localhost/game/assets/life-view-original.png',
    'http://localhost/game/assets/life-view-roguelike.png',
    'http://localhost/game/assets/life-view-urban.png',
  ]);

  const calls: unknown[][] = [];
  const ctx = {
    imageSmoothingEnabled: true,
    drawImage(...args: unknown[]) { calls.push(args); },
  } as unknown as CanvasRenderingContext2D;
  sprites.resident(ctx, 10.75, 20.25, 'neutral', resolveVisualKey(41, null));
  sprites.resident(ctx, 10.75, 20.25, 'neutral', resolveVisualKey(41, 0));
  assert.equal(calls.length, 2);
  assert.notDeepEqual(calls[0]!.slice(1, 5), calls[1]!.slice(1, 5));
  assert.equal(calls[0]![0], calls[1]![0]);
  sprites.resident(ctx, 30, 64, 'kin', resolveVisualKey(41, 30));
  sprites.resident(ctx, 60, 64, 'affected', resolveVisualKey(42, 70));
  sprites.soulMarker(ctx, 60, 44);
  sprites.grave(ctx, 96, 64);
  sprites.prop(ctx, 'coffin', 136, 40);
  sprites.prop(ctx, 'will', 176, 40);
  sprites.house(ctx, 1, 1, 93, 57);
  assert.equal(ctx.imageSmoothingEnabled, false);
  assert.ok(calls.length > 10);
  for (const call of calls) {
    assert.equal(call.length, 9);
    assert.ok(images.includes(call[0] as ImageBoundary));
    const [sx, sy, sw, sh, dx, dy, dw, dh] = call.slice(1) as number[];
    assert.ok([sx, sy, sw, sh, dx, dy, dw, dh].every(Number.isInteger));
    assert.equal(sw, dw);
    assert.equal(sh, dh);
    const image = call[0] as ImageBoundary;
    assert.ok(sx! >= 0 && sy! >= 0 && sx! + sw! <= image.naturalWidth && sy! + sh! <= image.naturalHeight);
  }
});

test('A failed atlas decode is an explicit retained rejection, with no reload or fallback', async t => {
  let created = 0;
  class ImageBoundary {
    src = '';
    constructor() { created++; }
    get naturalWidth() { return dimensions(this.src).width; }
    get naturalHeight() { return dimensions(this.src).height; }
    async decode() {
      if (this.src.endsWith('life-view-urban.png')) throw new Error('404 image');
    }
  }
  browserGlobals(t, ImageBoundary);
  const runtime = await freshRuntime('rejected-art');
  const first = runtime.loadLifeSprites();
  await assert.rejects(first, /Could not decode visual atlas assets\/life-view-urban\.png: 404 image/);
  assert.equal(runtime.loadLifeSprites(), first);
  await assert.rejects(runtime.loadLifeSprites(), /404 image/);
  assert.equal(created, 3);
});

test('Decoded bytes with wrong dimensions are rejected before a SpriteSet is exposed', async t => {
  class ImageBoundary {
    src = '';
    get naturalWidth() { return dimensions(this.src).width + 1; }
    get naturalHeight() { return dimensions(this.src).height; }
    async decode() {}
  }
  browserGlobals(t, ImageBoundary);
  const runtime = await freshRuntime('wrong-dimensions');
  await assert.rejects(runtime.loadLifeSprites(), /Visual atlas assets\/life-view-urban\.png has unexpected dimensions/);
});
