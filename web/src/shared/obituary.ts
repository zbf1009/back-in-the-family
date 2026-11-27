import type { Quota } from '../../../worker-api/src/judge-contract.ts';
import { dateLabel } from '../main/calendar.ts';
import { decisionObject, isDecisionCount, PROJECT_REQUEST_BYTE_CAP } from './decision.ts';

export const OBITUARY_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;
export const OBITUARY_PROMPT_VERSION = 'obituary.author.v2' as const;
/** Exact Author-approved system instruction, with no trailing newline. */
export const OBITUARY_SYSTEM_PROMPT = 'You write obituaries for the local paper of a small American town where the dead are reborn into the same town. Write one obituary of 40 to 110 words from the facts given. Dry, affectionate, deadpan; the humor is in what you choose to mention and how plainly you say it. Use only the facts given. Never state or imply a cause of death, a job, a hobby, a place, a feeling, or a quote. Do not address the reader. Do not mention reincarnation except, at most, one closing line noting the deceased is not expected to stay away long. Plain text, one paragraph, no title.';
export const OBITUARY_PROMPT_SHA256 = 'bcfd04e1d158dafc7f8361c442cee0ab41f177c74e02f549e6f69b3518a491fb' as const;
export const OBITUARY_SERVER_TIMEOUT_MS = 8000;
export const OBITUARY_CLIENT_TIMEOUT_MS = 10000;
export const OBITUARY_REQUEST_BYTE_CAP = PROJECT_REQUEST_BYTE_CAP;
export const OBITUARY_RAW_RESPONSE_BYTE_CAP = 8192;
export const OBITUARY_TEXT_SCALAR_CAP = 1200;
export const OBITUARY_MIN_WORDS = 40;
export const OBITUARY_MAX_WORDS = 110;
export const OBITUARY_MAX_TOKENS = 256;
export const OBITUARY_TEMPERATURE = 0.3;

export type NativeSex = 'female' | 'male';
export interface NativeDeathKinPerson {
  person: number;
  name: string;
  sex: NativeSex;
  relation: 'spouse' | 'former_spouse' | 'parent' | 'child' | 'sibling' | 'grandchild';
}
export interface OwnDeathKinSummaryV1 {
  deathEvent: string;
  body: number;
  tick: string;
  spouse: NativeDeathKinPerson[];
  livingChildren: NativeDeathKinPerson[];
  livingGrandchildren: NativeDeathKinPerson[];
  deceasedSpouses: NativeDeathKinPerson[];
  deceasedParents: NativeDeathKinPerson[];
  deceasedChildren: NativeDeathKinPerson[];
  deceasedSiblings: NativeDeathKinPerson[];
}
export type Relation = 'husband' | 'wife' | 'spouse' | 'father' | 'mother' | 'parent'
  | 'son' | 'daughter' | 'child' | 'brother' | 'sister' | 'sibling'
  | 'grandfather' | 'grandmother' | 'grandparent'
  | 'grandson' | 'granddaughter' | 'grandchild';
export interface NamedRelative {
  fullName: string;
  firstName: string;
  sex: NativeSex;
  relation: Relation;
}
export interface ObituaryFactsV1 {
  version: 1;
  deceased: {
    fullName: string;
    sex: NativeSex;
    ageYears: number;
    deathDate: { year: string; day: number; label: string };
    origin: 'born in town' | 'borrowed body' | 'rebuilt body';
  };
  survivors: NamedRelative[];
  precededInDeath: NamedRelative[];
  debtActions: { forgivenDebts: string | null; demandsMade: string | null; peopleAskedForPayment: string | null };
  collections: { debtsPaidOn: string | null };
  estate: { valueDollars: string; heirs: { fullName: string; relation: Relation | null }[] } | null;
  jossBurnersOnDeathDay: string;
}
export type FallbackReason = 'public' | 'anonymous' | 'disabled'
  | 'capability_unavailable' | 'request_invalid' | 'request_too_large'
  | 'quota_exhausted' | 'duplicate' | 'admission_unavailable' | 'network'
  | 'timeout' | 'provider_error' | 'invalid_output' | 'unknown_name';
export interface ObituaryResultV1 {
  text: string;
  source: 'model' | 'template';
  fallbackReason: FallbackReason | null;
  model: typeof OBITUARY_MODEL | null;
  promptVersion: string;
  promptSha256: string;
}
export type ObituaryRecordV1 = {
  runId: string;
  death: { eventId: string; personId: number; tick: string; lifeKey: string };
  operationKey: string;
  facts: ObituaryFactsV1;
} & (
  | { attempt: 'not-started' | 'pending'; result: null }
  | { attempt: 'terminal'; result: ObituaryResultV1 }
);
export interface ObituarySidecarV1 {
  format: 'back-in-the-family/obituaries';
  version: 1;
  replaySha256: string;
  records: Extract<ObituaryRecordV1, { attempt: 'terminal' }>[];
}
export interface ObituaryCapabilityV1 {
  version: 1;
  enabled: boolean;
  model: typeof OBITUARY_MODEL;
  disabledReason: 'disabled' | 'quota_exhausted' | null;
  timeout_ms: 10000;
  quota: Quota;
}
export interface ObituaryRequestV1 { version: 1; operationKey: string; facts: ObituaryFactsV1 }
export interface ObituaryReplyV1 { version: 1; operationKey: string; result: ObituaryResultV1; quota: Quota }
export interface ObituaryErrorV1 { version: 1; error: FallbackReason }
export type ObituaryReservation =
  | { kind: 'admitted' | 'duplicate' | 'rate_limited'; quota: Quota }
  | { kind: 'anonymous' };

const U64_MAX = 18446744073709551615n;
const encoder = new TextEncoder();
const fallbackReasons: Readonly<Record<FallbackReason, true>> = {
  public: true, anonymous: true, disabled: true, capability_unavailable: true, request_invalid: true,
  request_too_large: true, quota_exhausted: true, duplicate: true, admission_unavailable: true,
  network: true, timeout: true, provider_error: true, invalid_output: true, unknown_name: true,
};
const relations: Readonly<Record<Relation, true>> = {
  husband: true, wife: true, spouse: true, father: true, mother: true, parent: true,
  son: true, daughter: true, child: true, brother: true, sister: true, sibling: true,
  grandfather: true, grandmother: true, grandparent: true, grandson: true, granddaughter: true, grandchild: true,
};
const maleRelations: Readonly<Partial<Record<Relation, true>>> = { husband: true, father: true, son: true, brother: true, grandfather: true, grandson: true };
const femaleRelations: Readonly<Partial<Record<Relation, true>>> = { wife: true, mother: true, daughter: true, sister: true, grandmother: true, granddaughter: true };
const survivingRelations: Readonly<Partial<Record<Relation, true>>> = { husband: true, wife: true, spouse: true, son: true, daughter: true, child: true, grandson: true, granddaughter: true, grandchild: true };
const precedingRelations: Readonly<Partial<Record<Relation, true>>> = { husband: true, wife: true, spouse: true, father: true, mother: true, parent: true, son: true, daughter: true, child: true, brother: true, sister: true, sibling: true };

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return decisionObject(value) && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}
function u64(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 20 && /^(?:0|[1-9][0-9]*)$/.test(value)
    && BigInt(value) <= U64_MAX;
}
function nullableU64(value: unknown): value is string | null { return value === null || u64(value); }
function sex(value: unknown): value is NativeSex { return value === 'female' || value === 'male'; }
function name(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(value);
}
function digest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function relation(value: unknown): value is Relation { return typeof value === 'string' && Object.hasOwn(relations, value); }
function fallback(value: unknown): value is FallbackReason {
  return typeof value === 'string' && Object.hasOwn(fallbackReasons, value);
}
function boundedJson(value: unknown): boolean {
  return encoder.encode(JSON.stringify(value)).byteLength <= OBITUARY_REQUEST_BYTE_CAP;
}
function deathDate(value: unknown): boolean {
  if (!exact(value, ['year', 'day', 'label']) || !u64(value.year) || value.year === '0'
    || !isDecisionCount(value.day) || value.day < 1 || value.day > 365) return false;
  const tick = (BigInt(value.year) - 1n) * 365n + BigInt(value.day - 1);
  return tick <= U64_MAX && value.label === dateLabel(tick.toString());
}
function relative(value: unknown, allowed: Readonly<Partial<Record<Relation, true>>>): value is NamedRelative {
  return exact(value, ['fullName', 'firstName', 'sex', 'relation']) && name(value.fullName)
    && value.firstName === value.fullName.split(' ')[0] && sex(value.sex) && relation(value.relation)
    && Object.hasOwn(allowed, value.relation) && !(value.sex === 'female' && Object.hasOwn(maleRelations, value.relation))
    && !(value.sex === 'male' && Object.hasOwn(femaleRelations, value.relation));
}
function relatives(value: unknown, allowed: Readonly<Partial<Record<Relation, true>>>): boolean {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const person of value) {
    if (!relative(person, allowed)) return false;
    const key = person.relation + '/' + person.fullName;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
function estate(value: unknown): boolean {
  if (value === null) return true;
  if (!exact(value, ['valueDollars', 'heirs']) || !u64(value.valueDollars)
    || !Array.isArray(value.heirs) || value.heirs.length === 0) return false;
  const seen = new Set<string>();
  for (const heir of value.heirs) {
    if (!exact(heir, ['fullName', 'relation']) || !name(heir.fullName)
      || !(heir.relation === null || relation(heir.relation))) return false;
    const key = `${heir.relation}/${heir.fullName}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** Closed model facts; callers keep native correlation outside this object. */
export function parseObituaryFacts(value: unknown): ObituaryFactsV1 | null {
  if (!exact(value, ['version', 'deceased', 'survivors', 'precededInDeath', 'debtActions', 'collections', 'estate', 'jossBurnersOnDeathDay'])
    || value.version !== 1 || !exact(value.deceased, ['fullName', 'sex', 'ageYears', 'deathDate', 'origin'])
    || !name(value.deceased.fullName) || !sex(value.deceased.sex) || !isDecisionCount(value.deceased.ageYears)
    || value.deceased.ageYears > 120 || !deathDate(value.deceased.deathDate)
    || !['born in town', 'borrowed body', 'rebuilt body'].includes(value.deceased.origin as string)
    || !relatives(value.survivors, survivingRelations) || !relatives(value.precededInDeath, precedingRelations)
    || !exact(value.debtActions, ['forgivenDebts', 'demandsMade', 'peopleAskedForPayment'])
    || !nullableU64(value.debtActions.forgivenDebts) || !nullableU64(value.debtActions.demandsMade)
    || !nullableU64(value.debtActions.peopleAskedForPayment) || !exact(value.collections, ['debtsPaidOn'])
    || !nullableU64(value.collections.debtsPaidOn) || !estate(value.estate) || !u64(value.jossBurnersOnDeathDay)) return null;
  if (value.debtActions.demandsMade !== null && value.debtActions.peopleAskedForPayment !== null
    && BigInt(value.debtActions.peopleAskedForPayment) > BigInt(value.debtActions.demandsMade)) return null;
  return value as unknown as ObituaryFactsV1;
}

const nativeCategories: Readonly<Record<string, readonly NativeDeathKinPerson['relation'][]>> = {
  spouse: ['spouse'], livingChildren: ['child'], livingGrandchildren: ['grandchild'],
  deceasedSpouses: ['spouse', 'former_spouse'], deceasedParents: ['parent'],
  deceasedChildren: ['child'], deceasedSiblings: ['sibling'],
};
/** Every kin array is complete; repeated people are legal across distinct roles. */
export function parseOwnDeathKinSummary(value: unknown): OwnDeathKinSummaryV1 | null {
  if (!exact(value, ['deathEvent', 'body', 'tick', ...Object.keys(nativeCategories)])
    || !u64(value.deathEvent) || !isDecisionCount(value.body) || !u64(value.tick)) return null;
  for (const [category, roles] of Object.entries(nativeCategories)) {
    const people = value[category];
    if (!Array.isArray(people)) return null;
    const seen = new Set<number>();
    for (const person of people) {
      if (!exact(person, ['person', 'name', 'sex', 'relation']) || !isDecisionCount(person.person)
        || person.person === value.body || !name(person.name) || !sex(person.sex)
        || !roles.includes(person.relation as NativeDeathKinPerson['relation']) || seen.has(person.person)) return null;
      seen.add(person.person);
    }
  }
  return value as unknown as OwnDeathKinSummaryV1;
}

function quota(value: unknown): value is Quota {
  if (!exact(value, ['utc_day', 'reset_at_ms', 'daily_limit', 'daily_remaining', 'session_limit', 'session_remaining'])
    || typeof value.utc_day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.utc_day)
    || !isDecisionCount(value.reset_at_ms) || value.daily_limit !== 40 || value.session_limit !== 10
    || !isDecisionCount(value.daily_remaining) || value.daily_remaining > 40
    || !isDecisionCount(value.session_remaining) || value.session_remaining > 10) return false;
  const start = Date.parse(value.utc_day + 'T00:00:00.000Z');
  return Number.isFinite(start) && new Date(start).toISOString().slice(0, 10) === value.utc_day
    && value.reset_at_ms === start + 86400000;
}
export function parseObituaryCapability(value: unknown): ObituaryCapabilityV1 | null {
  if (!exact(value, ['version', 'enabled', 'model', 'disabledReason', 'timeout_ms', 'quota'])
    || value.version !== 1 || typeof value.enabled !== 'boolean' || value.model !== OBITUARY_MODEL
    || value.timeout_ms !== OBITUARY_CLIENT_TIMEOUT_MS || !quota(value.quota)) return null;
  const exhausted = value.quota.daily_remaining === 0 || value.quota.session_remaining === 0;
  if (value.enabled ? value.disabledReason !== null || exhausted
    : value.disabledReason !== 'disabled' && !(value.disabledReason === 'quota_exhausted' && exhausted)) return null;
  return value as unknown as ObituaryCapabilityV1;
}
export function parseObituaryRequest(value: unknown): ObituaryRequestV1 | null {
  return exact(value, ['version', 'operationKey', 'facts']) && value.version === 1
    && digest(value.operationKey) && parseObituaryFacts(value.facts) !== null && boundedJson(value)
    ? value as unknown as ObituaryRequestV1 : null;
}
function result(value: unknown): value is ObituaryResultV1 {
  if (!exact(value, ['text', 'source', 'fallbackReason', 'model', 'promptVersion', 'promptSha256'])
    || typeof value.text !== 'string' || value.text.trim().length === 0
    || typeof value.promptVersion !== 'string' || !/^obituary\.author\.v[1-9][0-9]*$/.test(value.promptVersion)
    || value.promptVersion.length > 128 || !digest(value.promptSha256)) return false;
  if (value.source === 'model') return value.model === OBITUARY_MODEL && value.fallbackReason === null;
  return value.source === 'template' && fallback(value.fallbackReason)
    && (value.model === null || value.model === OBITUARY_MODEL);
}
/** The consumer additionally joins operationKey and validates text against its frozen facts/template. */
export function parseObituaryReply(value: unknown): ObituaryReplyV1 | null {
  return exact(value, ['version', 'operationKey', 'result', 'quota']) && value.version === 1
    && digest(value.operationKey) && result(value.result) && quota(value.quota)
    ? value as unknown as ObituaryReplyV1 : null;
}
export function parseObituaryError(value: unknown): ObituaryErrorV1 | null {
  return exact(value, ['version', 'error']) && value.version === 1 && fallback(value.error)
    ? value as unknown as ObituaryErrorV1 : null;
}
export function parseObituaryReservation(value: unknown): ObituaryReservation | null {
  if (exact(value, ['kind']) && value.kind === 'anonymous') return value as ObituaryReservation;
  if (!exact(value, ['kind', 'quota']) || !quota(value.quota)) return null;
  if (value.kind === 'admitted' && value.quota.daily_remaining < 40 && value.quota.session_remaining < 10
    || value.kind === 'duplicate'
    || value.kind === 'rate_limited' && (value.quota.daily_remaining === 0 || value.quota.session_remaining === 0)) {
    return value as ObituaryReservation;
  }
  return null;
}
function terminalRecord(value: unknown): value is Extract<ObituaryRecordV1, { attempt: 'terminal' }> {
  if (!exact(value, ['runId', 'death', 'operationKey', 'facts', 'attempt', 'result'])
    || typeof value.runId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.runId)
    || !exact(value.death, ['eventId', 'personId', 'tick', 'lifeKey']) || !u64(value.death.eventId)
    || !isDecisionCount(value.death.personId) || !u64(value.death.tick) || typeof value.death.lifeKey !== 'string'
    || !/^[1-9][0-9]*\/life\/(?:0|[1-9][0-9]*)$/.test(value.death.lifeKey)
    || value.death.lifeKey.split('/')[2] !== String(value.death.personId)
    || !isDecisionCount(Number(value.death.lifeKey.split('/')[0])) || !digest(value.operationKey)
    || value.attempt !== 'terminal' || !result(value.result)) return false;
  const facts = parseObituaryFacts(value.facts);
  if (!facts || facts.deceased.deathDate.label !== dateLabel(value.death.tick)) return false;
  if (value.result.source !== 'model') return true;
  const validated = validateObituaryText(value.result.text, facts);
  return validated.ok && validated.text === value.result.text;
}
/** Digest binding is checked against the caller's exact replay bytes when supplied. */
export function parseObituarySidecar(value: unknown, expectedReplaySha256?: string): ObituarySidecarV1 | null {
  if (!exact(value, ['format', 'version', 'replaySha256', 'records']) || value.format !== 'back-in-the-family/obituaries'
    || value.version !== 1 || !digest(value.replaySha256) || !Array.isArray(value.records)
    || expectedReplaySha256 !== undefined && value.replaySha256 !== expectedReplaySha256) return null;
  const deaths = new Set<string>();
  const operations = new Set<string>();
  for (const record of value.records) {
    if (!terminalRecord(record)) return null;
    const identity = record.runId + '/' + record.death.eventId;
    if (deaths.has(identity) || operations.has(record.operationKey)) return null;
    deaths.add(identity);
    operations.add(record.operationKey);
  }
  return value as unknown as ObituarySidecarV1;
}

// Author-approved capitalization bank, normalized once. It is not a prose dictionary or NER model.
const ordinaryWords = new Set(`A An About Above Across After Afterwards Again Against All Almost Already Also
Although Always Among And Another Any Anyone Anything Apparently Around As At
Back Because Before Behind Below Besides Between Beyond Both Briefly But By
Certainly Despite Down During Each Either Else Even Eventually Ever Every
Everyone Everything Except Finally First For Formerly From Further Given Had
Has Have Having He Her Here Hers His However If In Indeed Instead Into Is It
Its Just Last Later Less Many Meanwhile More Most Much Neither Nevertheless
Next No Nobody None Nor Not Nothing Now Of Off Often On Once One Only Or Other
Otherwise Our Out Over Perhaps Possibly Probably Quite Rather Remarkably Same
Second Several She Since So Some Somehow Someone Something Sometimes Still
Such Than That The Their Theirs Them Then There Therefore These They This Those
Though Through Thus To Today Together Tomorrow Too Toward Two Under Until Up
Upon Usually Was We Well Were What When Whenever Where Whereas Whether Which
While Who Whoever Whom Whose Why Will With Within Without Would Yesterday Yet
You Your Yours Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen
Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen Twenty Thirty Forty Fifty
Sixty Seventy Eighty Ninety Hundred Thousand Million Billion Both Neither Either
Born Raised Lived Died Survived Preceded Married Leaves Left Kept Spent Asked
Forgave Collected Paid Lent Borrowed Burned Returned Surviving Remembered
Year Years Day Days Halloween Underworld Bureau Magistrate Joss Spirit
Husband Wife Spouse Father Mother Parent Parents Son Sons Daughter Daughters
Child Children Brother Brothers Sister Sisters Sibling Siblings Grandson
Grandsons Granddaughter Granddaughters Grandchild Grandchildren Family Estate
Inheritances Debts Dollars Money Paper In Lieu Flowers Unusually Unsurprisingly`.toLowerCase().split(/\s+/u));

function comparisonWord(word: string): string {
  const folded = word.toLowerCase().replaceAll('’', "'");
  // Contractions and possessives affect comparison only, never the recorded paragraph.
  if (["can't", "don't", "doesn't", "didn't", "couldn't", "shouldn't", "mustn't", "won't", "shan't"].includes(folded)) return 'not';
  return folded.replace(/(?:n't|'s|'re|'ve|'ll|'d|'m)$/u, '');
}
const prohibitedClaims = [
  /\b(?:cause of death|died\s+(?:of|from|because|due)|died\s+in\s+(?:an?\s+)?(?:fire|crash)|(?:burned|burnt)\s+to\s+death|death\s+(?:was\s+)?(?:caused|due)|succumbed|killed|murdered|suicide|drowned|cancer|disease|illness|accident|heart attack|natural causes|old age)\b/iu,
  /\b(?:worked|employed|job|occupation|career|profession|retired|doctor|nurse|teacher|engineer|farmer|lawyer|merchant|mechanic|carpenter|accountant|tailor|baker|chef|clerk|librarian|priest|professionally)\b/iu,
  /\b(?:hobby|hobbies|enjoyed|gardening|fishing|knitting|painting|collecting stamps|playing (?:cards|golf|music)|avid)\b/iu,
  /\b(?:felt|feels?|feelings?|happy|happily|sad|sadly|grief|grieved|grieving|joy|beloved|love|loved|loving|cherished|missed|mourned|devoted|proud|grateful|heartbroken|wept|cried|regret|regretted|peacefully)\b/iu,
  /\b(?:you|your|yours|yourself|yourselves|reader|readers)\b/iu,
  /\b(?:born|raised|lived|resided|moved|travelled|traveled|visited|came)\s+(?:in|to|from|at)\s+(?!(?:(?:this|the|same)\s+)?town\b|here\b|(?:a\s+)?(?:borrowed|rebuilt)\s+body\b)/iu,
];
export type ObituaryTextValidation = { ok: true; text: string } | { ok: false; reason: 'invalid_output' | 'unknown_name' };
/** Accept/reject without rewriting; lexical guards supplement the closed facts and exact prompt. */
export function validateObituaryText(value: unknown, facts: ObituaryFactsV1): ObituaryTextValidation {
  const invalid: ObituaryTextValidation = { ok: false, reason: 'invalid_output' };
  if (typeof value !== 'string') return invalid;
  const text = value.trim();
  if (!text || text.length > OBITUARY_TEXT_SCALAR_CAP * 2
    || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(text)
    || /[<>{}\[\]()`*_#\\|"“”«»„‟]/u.test(text) || /~~|^\d+[.)]\s|^obituary\s*:/iu.test(text)
    || /(?:^|[\s:;,])['‘’][A-Za-z]/u.test(text)) return invalid;
  const words = text.split(/\s+/u).length;
  if (words < OBITUARY_MIN_WORDS || words > OBITUARY_MAX_WORDS || [...text].length > OBITUARY_TEXT_SCALAR_CAP) return invalid;
  const fullNames = [facts.deceased.fullName, ...facts.survivors.map(person => person.fullName),
    ...facts.precededInDeath.map(person => person.fullName), ...(facts.estate?.heirs.map(person => person.fullName) ?? [])];
  const names = new Set(fullNames.flatMap(fullName => fullName.toLowerCase().split(' ')));
  for (const match of text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/gu)) {
    const token = match[0];
    if (!/^[A-Z]/u.test(token)) continue;
    const word = comparisonWord(token);
    if (!names.has(word) && !ordinaryWords.has(word)) return { ok: false, reason: 'unknown_name' };
  }
  // Mask actual name tokens before checking claims: a native name such as Joy is not a feeling claim.
  const prose = text.replace(/[A-Za-z]+(?:['’][A-Za-z]+)*/gu,
    token => /^[A-Z]/u.test(token) && names.has(comparisonWord(token)) ? 'person' : token);
  return prohibitedClaims.some(pattern => pattern.test(prose)) ? invalid : { ok: true, text };
}
