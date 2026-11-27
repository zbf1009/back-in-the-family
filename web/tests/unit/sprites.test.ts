import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LIFE_ATLASES } from '../../src/art/life-view-atlas.ts';
import { loadPortraits, PORTRAIT_ATLAS } from '../../src/art/portraits.ts';
import { loadLifeSprites, resolveVisualKey } from '../../src/art/sprites.ts';
import type * as SpriteRuntime from '../../src/art/sprites.ts';

const LOCAL_ATLASES = [...Object.values(LIFE_ATLASES), PORTRAIT_ATLAS];

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
  const atlas = LOCAL_ATLASES.find(atlas => src.endsWith(atlas.path));
  assert.ok(atlas, `Unexpected local image resource: ${src}`);
  return atlas;
}

async function freshRuntime(key: string): Promise<typeof SpriteRuntime> {
  // Separate sprite-module lifetimes must share the real portrait module; a static import cannot create both.
  return import(new URL(`../../src/art/sprites.ts?${key}`, import.meta.url).href);
}

function runInFreshRealm(t: TestContext): boolean {
  if (process.env.LIFE_SPRITE_FAILURE_CASE === t.name) return false;
  // Replacing a document stub does not replace the ESM realm or its retained asset promises.
  const result = spawnSync(process.execPath, [
    '--test', '--test-name-pattern', `^${t.name}$`, fileURLToPath(import.meta.url),
  ], {
    encoding: 'utf8',
    // Keep offline settings, but let the child start its own test runner rather than inherit ours.
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, LIFE_SPRITE_FAILURE_CASE: t.name },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return true;
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

test('Concurrent loads retain decoded resources; drawing uses native integer atlas pixels', async t => {
  const images: ImageBoundary[] = [];
  class ImageBoundary {
    src = '';
    decodes = 0;
    constructor() { images.push(this); }
    get naturalWidth() { return dimensions(this.src).width; }
    get naturalHeight() { return dimensions(this.src).height; }
    async decode() { this.decodes++; }
  }
  browserGlobals(t, ImageBoundary);
  const runtime = await freshRuntime('decoded-art');
  const first = runtime.loadLifeSprites();
  assert.equal(runtime.loadLifeSprites(), first);
  const sprites = await first;
  assert.equal(await runtime.loadLifeSprites(), sprites);
  assert.deepEqual(new Set(images.map(image => image.src)), new Set(LOCAL_ATLASES.map(atlas =>
    new URL(atlas.path, document.baseURI).href)));
  for (const atlas of LOCAL_ATLASES) {
    const loaded = images.filter(image => image.src.endsWith(atlas.path));
    assert.equal(loaded.length, 1, atlas.path);
    assert.equal(loaded[0]!.decodes, 1, atlas.path);
  }
  const sharedRuntime = await freshRuntime('shared-portrait-art');
  const sharedSprites = await sharedRuntime.loadLifeSprites();
  assert.equal(sharedSprites.portraits, sprites.portraits);
  const portraitLoad = loadPortraits();
  assert.equal(loadPortraits(), portraitLoad);
  assert.equal(await portraitLoad, sprites.portraits);
  for (const atlas of LOCAL_ATLASES) {
    const loaded = images.filter(image => image.src.endsWith(atlas.path));
    assert.equal(loaded.length, atlas === PORTRAIT_ATLAS ? 1 : 2, atlas.path);
    assert.ok(loaded.every(image => image.decodes === 1), atlas.path);
  }

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
  if (runInFreshRealm(t)) return;
  const atlas = LIFE_ATLASES.urban;
  const images: ImageBoundary[] = [];
  class ImageBoundary {
    src = '';
    decodes = 0;
    constructor() { images.push(this); }
    get naturalWidth() { return dimensions(this.src).width; }
    get naturalHeight() { return dimensions(this.src).height; }
    async decode() {
      this.decodes++;
      if (this.src.endsWith(atlas.path)) throw new Error('404 image');
    }
  }
  browserGlobals(t, ImageBoundary);
  const first = loadLifeSprites();
  let failure: Error | undefined;
  await assert.rejects(first, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(atlas.path));
    assert.ok(error.message.includes('404 image'));
    failure = error;
    return true;
  });
  assert.equal(loadLifeSprites(), first);
  await assert.rejects(loadLifeSprites(), (error: unknown) => {
    assert.equal(error, failure);
    return true;
  });
  const attempted = images.filter(image => image.src.endsWith(atlas.path));
  assert.equal(attempted.length, 1);
  assert.equal(attempted[0]!.decodes, 1);
  await loadPortraits();
  const portrait = images.filter(image => image.src.endsWith(PORTRAIT_ATLAS.path));
  assert.equal(portrait.length, 1);
  assert.equal(portrait[0]!.decodes, 1);
});

test('Decoded bytes with wrong dimensions are rejected before a SpriteSet is exposed', async t => {
  if (runInFreshRealm(t)) return;
  const atlas = LIFE_ATLASES.urban;
  const images: ImageBoundary[] = [];
  class ImageBoundary {
    src = '';
    decodes = 0;
    constructor() { images.push(this); }
    get naturalWidth() { return dimensions(this.src).width + (this.src.endsWith(atlas.path) ? 1 : 0); }
    get naturalHeight() { return dimensions(this.src).height; }
    async decode() { this.decodes++; }
  }
  browserGlobals(t, ImageBoundary);
  const first = loadLifeSprites();
  let failure: Error | undefined;
  await assert.rejects(first, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(atlas.path));
    assert.ok(error.message.includes('dimensions'));
    failure = error;
    return true;
  });
  assert.equal(loadLifeSprites(), first);
  await assert.rejects(loadLifeSprites(), (error: unknown) => {
    assert.equal(error, failure);
    return true;
  });
  const attempted = images.filter(image => image.src.endsWith(atlas.path));
  assert.equal(attempted.length, 1);
  assert.equal(attempted[0]!.decodes, 1);
  await loadPortraits();
  const portrait = images.filter(image => image.src.endsWith(PORTRAIT_ATLAS.path));
  assert.equal(portrait.length, 1);
  assert.equal(portrait[0]!.decodes, 1);
});
