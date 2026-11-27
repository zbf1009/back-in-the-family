// Author-approved sex/age pools; source-derived and original cells retain separate licenses.
// Exact crops, pixel commands and stable palettes: web/assets/portrait-pool-provenance.json.
export const PORTRAIT_CELL = 64;
export const PORTRAIT_AGE_GROUPS = ['baby', 'child', 'adult', 'elder', 'unknown'] as const;
export type PortraitAgeGroup = (typeof PORTRAIT_AGE_GROUPS)[number];
export type PortraitId = number;
export type PortraitSubject = { person: number; sex?: 'female' | 'male' | null; age: number | null };
export const PORTRAIT_ATLAS = { path: 'assets/life-portraits.png', width: 1024, height: 1472, columns: 16 } as const;

export interface PortraitSet {
  draw(ctx: CanvasRenderingContext2D, id: PortraitId, x: number, y: number, scale?: number): void;
}

/** Stable decorative palette and shape only; recorded sex/age are never inferred. */
export function portraitId(subject: PortraitSubject): PortraitId {
  const sex = subject.sex === 'female' ? 0 : subject.sex === 'male' ? 1 : 2;
  const age = subject.age === null ? 4 : subject.age < 3 ? 0 : subject.age < 18 ? 1 : subject.age < 60 ? 2 : 3;
  const palette = subject.person % 12;
  const variant = Math.floor(subject.person / 12) % 2;
  return ((sex * 5 + age) * 2 + variant) * 12 + palette;
}

/** The selected cell's age pool, also exposed as factual rendering diagnostics. */
export function portraitAgeGroup(id: PortraitId): PortraitAgeGroup {
  return PORTRAIT_AGE_GROUPS[Math.floor(id / 24) % PORTRAIT_AGE_GROUPS.length]!;
}

let portraits: Promise<PortraitSet> | undefined;

/** One local decode; asset failures remain failures rather than substituted pictures. */
export function loadPortraits(): Promise<PortraitSet> {
  portraits ??= decodePortraits();
  return portraits;
}

async function decodePortraits(): Promise<PortraitSet> {
  const image = new Image();
  image.src = new URL(PORTRAIT_ATLAS.path, document.baseURI).href;
  await image.decode();
  if (image.naturalWidth !== PORTRAIT_ATLAS.width || image.naturalHeight !== PORTRAIT_ATLAS.height) {
    throw new Error(`Portrait atlas has unexpected dimensions: ${image.naturalWidth}×${image.naturalHeight}`);
  }
  return {
    draw(ctx, id, x, y, scale = 1) {
      if (!Number.isInteger(scale) || scale < 1 || !Number.isInteger(x) || !Number.isInteger(y)) {
        throw new RangeError('Portrait source pixels require positive integer scale and integer coordinates');
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, id % PORTRAIT_ATLAS.columns * PORTRAIT_CELL,
        Math.floor(id / PORTRAIT_ATLAS.columns) * PORTRAIT_CELL, PORTRAIT_CELL, PORTRAIT_CELL,
        x, y, PORTRAIT_CELL * scale, PORTRAIT_CELL * scale);
    },
  };
}
