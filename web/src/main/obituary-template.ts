import type { NamedRelative, ObituaryFactsV1, Relation } from '../shared/obituary.ts';
import { formatAmount, formatMoney } from './calendar.ts';

/** Verbatim Author copy-deck §14; slot filling never introduces new prose. */
export const OBITUARY_TEMPLATE_TEXT = {
  openings: {
    'born in town': '{Full Name}, {n}, died {date}, having lived here the whole time. There was no alternative.',
    'borrowed body': '{Full Name}, {n}, died {date}, in a body that was borrowed to begin with.',
    'rebuilt body': '{Full Name}, {n}, died {date}, in a body that was built to order.',
  },
  survivors: 'Survived by {list}.',
  precededInDeath: 'Preceded in death by {list}.',
  jointDebts: 'Forgave {x} debts and collected on {y}.',
  forgivenDebts: 'Forgave {x} debts.',
  collections: 'Collected on {y} debts.',
  estate: 'Leaves an estate valued at {$}.',
  burners: '{k} people burned joss paper.',
  oneBurner: 'One person burned joss paper.',
  closing: 'In lieu of flowers, joss paper. The deceased is not going far.',
} as const;
const pluralRelations: Record<Relation, string> = {
  husband: 'husbands', wife: 'wives', spouse: 'spouses', father: 'fathers', mother: 'mothers', parent: 'parents',
  son: 'sons', daughter: 'daughters', child: 'children', brother: 'brothers', sister: 'sisters', sibling: 'siblings',
  grandfather: 'grandfathers', grandmother: 'grandmothers', grandparent: 'grandparents',
  grandson: 'grandsons', granddaughter: 'granddaughters', grandchild: 'grandchildren',
};
function fill(template: string, slots: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/gu, (_, key: string) => slots[key]!);
}
function familyList(people: readonly NamedRelative[]): string {
  const groups = new Map<Relation, string[]>();
  for (const person of people) {
    const group = groups.get(person.relation);
    if (group) group.push(person.firstName);
    else groups.set(person.relation, [person.firstName]);
  }
  return [...groups].map(([role, names]) => {
    const joined = names.length < 2 ? names[0]! : names.length === 2 ? names.join(' and ')
      : `${names.slice(0, -1).join(', ')}, and ${names.at(-1)!}`;
    return `${names.length === 1 ? role : pluralRelations[role]} ${joined}`;
  }).join('; ');
}

/** One shared pure renderer for the local card and judge's terminal fallback. */
export function renderObituaryTemplate(facts: ObituaryFactsV1): string {
  const text = OBITUARY_TEMPLATE_TEXT;
  const lines = [fill(text.openings[facts.deceased.origin], {
    'Full Name': facts.deceased.fullName, n: String(facts.deceased.ageYears), date: facts.deceased.deathDate.label,
  })];
  if (facts.survivors.length) lines.push(fill(text.survivors, { list: familyList(facts.survivors) }));
  if (facts.precededInDeath.length) lines.push(fill(text.precededInDeath, { list: familyList(facts.precededInDeath) }));
  const x = facts.debtActions.forgivenDebts, y = facts.collections.debtsPaidOn;
  const forgave = x !== null && BigInt(x) > 0n, collected = y !== null && BigInt(y) > 0n;
  if (forgave && collected) lines.push(fill(text.jointDebts, { x: formatAmount(x), y: formatAmount(y) }));
  else if (forgave) lines.push(fill(text.forgivenDebts, { x: formatAmount(x) }));
  else if (collected) lines.push(fill(text.collections, { y: formatAmount(y) }));
  if (facts.estate !== null) lines.push(fill(text.estate, { $: formatMoney(facts.estate.valueDollars) }));
  const burners = BigInt(facts.jossBurnersOnDeathDay);
  if (burners === 1n) lines.push(text.oneBurner);
  else if (burners > 1n) lines.push(fill(text.burners, { k: formatAmount(facts.jossBurnersOnDeathDay) }));
  lines.push(text.closing);
  return lines.join('\n');
}
