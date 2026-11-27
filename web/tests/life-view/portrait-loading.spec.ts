/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { portraitId } from '../../src/art/portraits.ts';

const ORIGIN = 'http://localhost:5174';
const native = JSON.parse(readFileSync(new URL('../fixtures/art-sample-seed1205.json', import.meta.url), 'utf8'));
const actor = native.facts.actors.find((actor: { person: number }) => actor.person === native.facts.death.kind.person);
const id = portraitId({ person: actor.person, sex: actor.sex, age: Number(actor.ageAtDeath) });
const catalog = JSON.parse(readFileSync(new URL('../../assets/portrait-pool-provenance.json', import.meta.url), 'utf8'));

// Native facts, controlled local asset latency. This is not gameplay-input proof.
test('an already mounted Bureau paints recorded portraits when the real atlas arrives later', async ({ page }) => {
  let release!: () => void;
  const atlasGate = new Promise<void>(resolve => { release = resolve; });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['data:', 'blob:'].includes(url.protocol) && (url.origin !== ORIGIN || url.pathname.startsWith('/api/'))) {
      throw new Error(`Unexpected portrait fixture request: ${url}`);
    }
    if (url.pathname === '/assets/life-portraits.png') await atlasGate;
    await route.continue();
  });
  try {
    await page.goto(`${ORIGIN}/art-sample.html`, { waitUntil: 'domcontentloaded' });
    const desk = page.getByTestId('underworld-panel');
    await expect(desk).toBeVisible();
    await expect(page.getByTestId('art-sample')).toHaveAttribute('data-assets', 'loading');
    const portrait = desk.locator(`[data-testid="portrait"][data-person="${actor.person}"]`).first();
    await expect(portrait).toHaveAttribute('data-sex', actor.sex);
    await expect(portrait).toHaveAttribute('data-age', actor.ageAtDeath);
    release();
    await expect(page.getByTestId('art-sample')).toHaveAttribute('data-assets', 'ready');
    const canvas = portrait.getByTestId('portrait-canvas');
    await expect.poll(() => canvas.evaluate(async element => {
      const canvas = element as HTMLCanvasElement;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const scale = canvas.width / 64;
      const native = new Uint8Array(64 * 64 * 4);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const offset = (y * scale * canvas.width + x * scale) * 4;
        for (let channel = 0; channel < 4; channel++) native[(y * 64 + x) * 4 + channel] = pixels[offset + channel]!;
      }
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', native))]
        .map(byte => byte.toString(16).padStart(2, '0')).join('');
    })).toBe(catalog.cells[id].rgba_sha256);
    expect(errors).toEqual([]);
  } finally { release(); }
});

test.describe('touch certificate controls', () => {
  test.use({ hasTouch: true });
  test('Skip remains readable after a real touch press and retains the certificate', async ({ page }) => {
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!['data:', 'blob:'].includes(url.protocol) && (url.origin !== ORIGIN || url.pathname.startsWith('/api/'))) {
        throw new Error(`Unexpected touch fixture request: ${url}`);
      }
      await route.continue();
    });
    await page.goto(`${ORIGIN}/art-sample.html`);
    await expect(page.getByTestId('art-sample')).toHaveAttribute('data-assets', 'ready');
    const certificate = page.getByTestId('portrait-certificate');
    const skip = certificate.getByRole('button', { name: 'Skip', exact: true });
    await skip.tap();
    await expect(certificate).toBeVisible();
    const contrast = await skip.evaluate(element => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => {
        const values = color.match(/[\d.]+/g)!.slice(0, 3).map(value => {
          const channel = Number(value) / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
      };
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });
});
