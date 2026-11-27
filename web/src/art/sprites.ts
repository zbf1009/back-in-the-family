import type { Tint } from '../main/town-layout.ts';
import { LIFE_ATLASES, LIFE_TILES, PERSON_TILES } from './life-view-atlas.ts';
import { loadPortraits, type PortraitSet } from './portraits.ts';

export type { Tint } from '../main/town-layout.ts';
export type LifeTile = keyof typeof LIFE_TILES;
export type VisualKey = (typeof PERSON_TILES)[keyof typeof PERSON_TILES][number];

export const SOUL_GLYPH = '○';
export const SOUL_COLOR = '#8a620b';

export interface SpriteSet {
  portraits: PortraitSet;
  resident(ctx: CanvasRenderingContext2D, x: number, y: number, tint: Tint, visual: VisualKey): void;
  soulMarker(ctx: CanvasRenderingContext2D, x: number, y: number): void;
  house(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void;
  grave(ctx: CanvasRenderingContext2D, x: number, y: number): void;
  prop(ctx: CanvasRenderingContext2D, kind: LifeTile, x: number, y: number): void;
}

export const TINTS: Readonly<Record<Tint, string>> = {
  self: '#24383c', kin: '#285258', rememberer: '#675283', affected: '#8b3038', neutral: '#4e6263',
};

/** Cosmetic selection uses only a stable ID and the Snapshot's whole-year age. */
export function resolveVisualKey(id: number, age: number | null): VisualKey {
  const group = age === null ? PERSON_TILES.unknown : age < 3 ? PERSON_TILES.baby
    : age < 13 ? PERSON_TILES.child : age < 65 ? PERSON_TILES.adult : PERSON_TILES.elder;
  return group[id % group.length]!;
}

let lifeSprites: Promise<SpriteSet> | undefined;

/** One decode per registered atlas, including a retained rejection on asset failure. */
export function loadLifeSprites(): Promise<SpriteSet> {
  lifeSprites ??= decodeLifeSprites();
  return lifeSprites;
}

async function decodeLifeSprites(): Promise<SpriteSet> {
  const atlasNames = Object.keys(LIFE_ATLASES) as (keyof typeof LIFE_ATLASES)[];
  const [decoded, portraits] = await Promise.all([Promise.all(atlasNames.map(async name => {
    const atlas = LIFE_ATLASES[name];
    const image = new Image();
    image.src = new URL(atlas.path, document.baseURI).href;
    try {
      await image.decode();
    } catch (error) {
      throw new Error(`Could not decode visual atlas ${atlas.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (image.naturalWidth !== atlas.width || image.naturalHeight !== atlas.height) {
      throw new Error(`Visual atlas ${atlas.path} has unexpected dimensions: ${image.naturalWidth}×${image.naturalHeight}; expected ${atlas.width}×${atlas.height}.`);
    }
    return [name, image] as const;
  })), loadPortraits()]);
  const images = Object.fromEntries(decoded) as Record<keyof typeof LIFE_ATLASES, HTMLImageElement>;

  function tile(ctx: CanvasRenderingContext2D, kind: LifeTile, x: number, y: number, w?: number, h?: number) {
    const rect = LIFE_TILES[kind];
    const width = w ?? rect.w;
    const height = h ?? rect.h;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(images[rect.atlas], rect.x, rect.y, width, height, Math.round(x), Math.round(y), width, height);
  }

  function tiled(ctx: CanvasRenderingContext2D, kind: LifeTile, x: number, y: number, w: number, h: number) {
    const rect = LIFE_TILES[kind];
    for (let row = 0; row < h; row += rect.h) {
      for (let col = 0; col < w; col += rect.w) {
        tile(ctx, kind, x + col, y + row, Math.min(rect.w, w - col), Math.min(rect.h, h - row));
      }
    }
  }

  return {
    portraits,
    resident(ctx, x, y, tint, visual) {
      const rect = LIFE_TILES[visual];
      tile(ctx, visual, x - Math.floor(rect.w / 2), y - rect.h);
      if (tint === 'affected') {
        const marker = LIFE_TILES.affected_marker_small;
        tile(ctx, 'affected_marker_small', x + Math.floor(rect.w / 2), y - marker.h);
      } else if (tint === 'kin' || tint === 'rememberer') {
        const kind = tint === 'kin' ? 'map_pin_kin' : 'map_pin_rememberer';
        tile(ctx, kind, x + Math.floor(rect.w / 2), y - LIFE_TILES[kind].h);
      }
    },
    soulMarker(ctx, x, y) {
      const rect = LIFE_TILES.soul_marker_small;
      tile(ctx, 'soul_marker_small', x - Math.floor(rect.w / 2), y - rect.h);
    },
    house(ctx, x, y, w, h) {
      x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
      const roof = LIFE_TILES.house_roof;
      tiled(ctx, 'house_wall', x, y + roof.h, w, Math.max(0, h - roof.h));
      tiled(ctx, 'house_roof', x, y, w, Math.min(roof.h, h));
      const door = LIFE_TILES.house_door;
      tile(ctx, 'house_door', x + Math.floor((w - door.w) / 2), y + h - door.h);
      if (w >= 48 && h >= roof.h + LIFE_TILES.house_window.h) {
        tile(ctx, 'house_window', x + 8, y + roof.h);
        tile(ctx, 'house_window', x + w - LIFE_TILES.house_window.w - 8, y + roof.h);
      }
    },
    grave(ctx, x, y) {
      const rect = LIFE_TILES.grave;
      tile(ctx, 'grave', x - Math.floor(rect.w / 2), y - rect.h);
    },
    prop(ctx, kind, x, y) { tile(ctx, kind, x, y); },
  };
}
