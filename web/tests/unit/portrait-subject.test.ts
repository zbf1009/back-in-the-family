import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { portraitId } from '../../src/art/portraits.ts';

interface Cell { id: number; template: number; palette: number; rgba_sha256: string }
interface Template { sex: 'female' | 'male' | 'neutral'; age: 'baby' | 'child' | 'adult' | 'elder' | 'unknown' }
const catalog: { cells: Cell[]; templates: Template[] } = JSON.parse(readFileSync(
  new URL('../../assets/portrait-pool-provenance.json', import.meta.url), 'utf8'));

function selected(person: number, sex: 'female' | 'male' | null, age: number | null): { cell: Cell; template: Template } {
  const cell = catalog.cells[portraitId({ person, sex, age })]!;
  return { cell, template: catalog.templates[cell.template]! };
}

test('recorded sex and event-time age select the actual catalog pool, including neutral unknown subjects', () => {
  for (const person of [10, 11, 39]) {
    for (const sex of ['female', 'male', null] as const) {
      for (const [age, group] of [[0, 'baby'], [2, 'baby'], [3, 'child'], [17, 'child'],
        [18, 'adult'], [59, 'adult'], [60, 'elder'], [100, 'elder'], [null, 'unknown']] as const) {
        const { template } = selected(person, sex, age);
        assert.equal(template.sex, sex ?? 'neutral');
        assert.equal(template.age, group);
      }
    }
  }
});

test('Nadine ages into a female elder with the same palette; Marvin remains a male adult', () => {
  const nadineAdult = selected(10, 'female', 45);
  const nadineElder = selected(10, 'female', 60);
  assert.equal(nadineAdult.template.sex, 'female');
  assert.equal(nadineAdult.template.age, 'adult');
  assert.equal(nadineElder.template.sex, 'female');
  assert.equal(nadineElder.template.age, 'elder');
  assert.equal(nadineElder.cell.palette, nadineAdult.cell.palette);
  assert.notEqual(nadineElder.cell.rgba_sha256, nadineAdult.cell.rgba_sha256);
  const marvin = selected(39, 'male', 22);
  assert.equal(marvin.template.sex, 'male');
  assert.equal(marvin.template.age, 'adult');
});

test('person-bound skin and hair palettes survive age transitions and newly known sex', () => {
  for (let person = 0; person < 24; person++) {
    const initial = selected(person, null, null).cell.palette;
    for (const sex of ['female', 'male', null] as const) {
      for (const age of [0, 5, 25, 75, null]) assert.equal(selected(person, sex, age).cell.palette, initial);
    }
    const adult = selected(person, 'female', 25).cell;
    const infant = selected(person, 'female', 0).cell;
    assert.notEqual(adult.rgba_sha256, infant.rgba_sha256);
  }
});
