import { expect, type Locator } from '@playwright/test';
import type { Needed } from '../../src/shared/world-snapshot.ts';

/** 验证实际条件身份、可见数值和日期，不建立玩家句子的逆向字典。 */
export async function verifyApplicationRequirements(rows: Locator, expected: readonly Needed[]): Promise<void> {
  await expect(rows).toHaveCount(expected.length);
  for (const [index, requirement] of expected.entries()) {
    const row = rows.nth(index);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-needed-kind', requirement.kind);
    if (requirement.kind === 'named') {
      await expect(row).toHaveAttribute('data-needed-name', requirement.name);
      const text = (await row.innerText()).trim();
      expect(text, 'A named requirement must have a visible explanation').not.toBe('');
      expect(text, 'A named requirement must not expose its raw key or diagnostic').not.toContain(requirement.name);
    } else if (requirement.kind === 'wait_until') {
      await expect(row).toHaveAttribute('data-tick', requirement.tick);
      const date = /Year (-?\d+), Day (\d+)/.exec(await row.innerText());
      if (date === null) throw Error('The application requirement lost its visible date');
      const day = BigInt(date[2]!);
      expect(day).toBeGreaterThanOrEqual(1n);
      expect(day).toBeLessThanOrEqual(365n);
      expect(((BigInt(date[1]!) - 1n) * 365n + day - 1n).toString()).toBe(requirement.tick);
    } else {
      await expect(row).toHaveAttribute('data-amount', requirement.amount);
      const amounts = (await row.innerText()).match(/\d[\d,]*/g) ?? [];
      expect(amounts).toEqual([BigInt(requirement.amount).toLocaleString('en-US')]);
    }
  }
}
