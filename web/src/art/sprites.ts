import type { Tint } from '../main/town-layout.ts';

export const SOUL_GLYPH = '○';
export const SOUL_COLOR = '#b8860b';

export interface SpriteSet {
  readonly id: 'placeholder' | string;
  resident(ctx: CanvasRenderingContext2D, x: number, y: number, tint: Tint): void;
  soulMarker(ctx: CanvasRenderingContext2D, x: number, y: number): void;
  house(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void;
  grave(ctx: CanvasRenderingContext2D, x: number, y: number): void;
  prop(ctx: CanvasRenderingContext2D, kind: 'coffin' | 'candle' | 'cradle' | 'cloud' | 'will', x: number, y: number): void;
}

const TINTS: Record<Tint, string> = {
  self: '#252525', kin: '#454545', rememberer: '#656565', affected: '#111111', neutral: '#757575',
};

export const placeholderSprites: SpriteSet = {
  id: 'placeholder',
  resident(ctx, x, y, tint) {
    ctx.fillStyle = TINTS[tint];
    ctx.fillRect(x - 3, y - 3, 6, 6);
  },
  soulMarker(ctx, x, y) {
    ctx.strokeStyle = SOUL_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.stroke();
  },
  house(ctx, x, y, w, h) {
    ctx.fillStyle = '#e2e0d9';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#858585';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  },
  grave(ctx, x, y) {
    ctx.fillStyle = '#656565';
    ctx.fillRect(x - 4, y - 6, 8, 12);
  },
  prop(ctx, kind, x, y) {
    const glyph = { coffin: '▮', candle: 'i', cradle: 'U', cloud: 'o', will: 'W' }[kind];
    ctx.fillStyle = '#252525';
    ctx.font = '12px sans-serif';
    ctx.fillText(glyph, x, y);
  },
};
