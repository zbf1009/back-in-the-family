import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderObituaryTemplate, OBITUARY_TEMPLATE_TEXT } from '../../src/main/obituary-template.ts';
import { parseObituaryFacts, validateObituaryText, type ObituaryFactsV1 } from '../../src/shared/obituary.ts';

// Closed consumer input for omission/slot boundaries, not a native kin witness.
const minimal: ObituaryFactsV1 = {
  version: 1,
  deceased: { fullName: 'Nadine Bradley', sex: 'female', ageYears: 60,
    deathDate: { year: '15', day: 263, label: 'Year 15, Day 263' }, origin: 'born in town' },
  survivors: [], precededInDeath: [],
  debtActions: { forgivenDebts: null, demandsMade: null, peopleAskedForPayment: null },
  collections: { debtsPaidOn: null }, estate: null, jossBurnersOnDeathDay: '0',
};

test('all origins always use the exact approved opening and unconditional final line', () => {
  const openings = [
    ['born in town', 'Nadine Bradley, 60, died Year 15, Day 263, having lived here the whole time. There was no alternative.'],
    ['borrowed body', 'Nadine Bradley, 60, died Year 15, Day 263, in a body that was borrowed to begin with.'],
    ['rebuilt body', 'Nadine Bradley, 60, died Year 15, Day 263, in a body that was built to order.'],
  ] as const;
  for (const [origin, opening] of openings) {
    const output = renderObituaryTemplate({ ...minimal, deceased: { ...minimal.deceased, origin } });
    assert.deepEqual(output.split('\n'), [opening, OBITUARY_TEMPLATE_TEXT.closing]);
    assert.doesNotMatch(output, /\b(?:you|your|source|model|template|recorded|actual)\b|[()]/iu);
  }
});

test('joint and one-sided positive counts never use demands as collections or turn null into zero', () => {
  const expected: Record<string, string> = {
    '2/3': 'Forgave 2 debts and collected on 3.',
    '2/0': 'Forgave 2 debts.', '2/null': 'Forgave 2 debts.',
    '0/3': 'Collected on 3 debts.', 'null/3': 'Collected on 3 debts.',
    '0/0': '', 'null/null': '', '0/null': '', 'null/0': '',
  };
  for (const [pair, line] of Object.entries(expected)) {
    const [x, y] = pair.split('/').map(value => value === 'null' ? null : value);
    const output = renderObituaryTemplate({ ...minimal,
      debtActions: { forgivenDebts: x!, demandsMade: '4', peopleAskedForPayment: '3' }, collections: { debtsPaidOn: y! } });
    const lines = output.split('\n');
    if (line) assert.equal(lines.at(-2), line);
    else assert.doesNotMatch(output, /Forgave|Collected|collected/u);
    assert.doesNotMatch(output, /asked|demands|collected on 4/u);
  }
  const large = renderObituaryTemplate({ ...minimal,
    debtActions: { ...minimal.debtActions, forgivenDebts: '9007199254740993' }, collections: { debtsPaidOn: '18446744073709551615' } });
  assert.match(large, /Forgave 9,007,199,254,740,993 debts and collected on 18,446,744,073,709,551,615\./u);
});

test('zero offering omits the line, one uses One person, and larger counts use the exact plural', () => {
  for (const [burners, line] of [['0', ''], ['1', 'One person burned joss paper.'], ['2', '2 people burned joss paper.'], ['1000', '1,000 people burned joss paper.']]) {
    const output = renderObituaryTemplate({ ...minimal, jossBurnersOnDeathDay: burners! });
    if (line) assert.equal(output.split('\n').at(-2), line);
    else assert.doesNotMatch(output, /burned joss paper/u);
    assert.doesNotMatch(output, /\b(?:0|1) people\b/u);
  }
});

test('unsupported estate omits its entire line and exact large asset value is mechanical', () => {
  assert.doesNotMatch(renderObituaryTemplate(minimal), /estate/u);
  const output = renderObituaryTemplate({ ...minimal, estate: { valueDollars: '9007199254740993', heirs: [{ fullName: 'Marcus Bradley', relation: 'son' }] } });
  assert.match(output, /Leaves an estate valued at \$9,007,199,254,740,993\./u);
  assert.doesNotMatch(output, /cash|Marcus|eligible|unavailable/u);
});

const positive: { sourceChecksum: string; facts: ObituaryFactsV1; paragraph: string } = JSON.parse(readFileSync(new URL('../fixtures/obituary-seed1205-positive.json', import.meta.url), 'utf8'));

test('actual complete native facts retain the Author paragraph exactly as the positive guard', () => {
  assert.notEqual(parseObituaryFacts(positive.facts), null);
  assert.deepEqual(validateObituaryText(positive.paragraph, positive.facts), { ok: true, text: positive.paragraph });
  for (const paragraph of [positive.paragraph.replace('Nadine Bradley', 'Zelda Bradley'), positive.paragraph.replace('her son Marcus', 'her son Zelda'), '', `${positive.paragraph} ${'word '.repeat(111)}`, positive.paragraph.replace('She leaves', 'She died of cancer and leaves'), positive.paragraph.replace('She leaves', 'You inherit')]) assert.equal(validateObituaryText(paragraph, positive.facts).ok, false);
});

test('native family lines group actual first names by relation with semicolons in the seven-line order', () => {
  const output = renderObituaryTemplate(positive.facts);
  assert.deepEqual(output.split('\n'), [
    'Nadine Bradley, 60, died Year 15, Day 263, having lived here the whole time. There was no alternative.',
    'Survived by husband Marvin; son Marcus; grandsons Ben and Leo.',
    'Preceded in death by husband Clifford.',
    'Collected on 4 debts.',
    'Leaves an estate valued at $229,012.',
    '2 people burned joss paper.',
    'In lieu of flowers, joss paper. The deceased is not going far.',
  ]);
  assert.doesNotMatch(output, /Bradley;|Jenkins|Rhodes|\b(?:you|your|source|model|template|recorded|actual)\b|[()]/iu);
  const joint = renderObituaryTemplate({ ...positive.facts, debtActions: { ...positive.facts.debtActions, forgivenDebts: '2' } });
  assert.equal(joint.split('\n')[3], 'Forgave 2 debts and collected on 4.');
});

test('mechanical neutral relation slots and English joins retain stable supplied person order', () => {
  const grandchildren = positive.facts.survivors.filter(person => person.relation === 'grandson');
  const neutral = renderObituaryTemplate({ ...minimal, survivors: grandchildren.map(person => ({ ...person, relation: 'grandchild' as const })) });
  assert.ok(neutral.includes('Survived by grandchildren Ben and Leo.'));
  // A three-name slot-boundary variation, not another native family assertion.
  const list = positive.facts.survivors.slice(1).map(person => ({ ...person, relation: 'child' as const }));
  const three = renderObituaryTemplate({ ...minimal, survivors: list });
  assert.ok(three.includes('Survived by children Marcus, Ben, and Leo.'));
});
