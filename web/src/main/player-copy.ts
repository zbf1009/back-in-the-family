import type { ErrorKind, PauseReason, Request, RunState, DreamIntent } from '../shared/protocol.ts';
import { LIFE_SPEED, READ_SPEED, type Speed } from '../shared/speeds.ts';
import type { OperationState } from '../shared/operation-state.ts';
import type {
  BribeBlocked, ChronicleEntry, HauntBlocked, Kinship, Needed, Person, PlayerFamily,
  PlayerOption, Preview, RulingOption, Slot, StakeUnit, SkipReason, TraitName, WorldSnapshot,
} from '../shared/world-snapshot.ts';
import { dateLabel, formatAmount } from './calendar.ts';
import { CHOICE_SOURCE_TEXT, TECHNICAL_TEXT, supportedText } from './technical-text.ts';

export const LANDING_PREMISE = TECHNICAL_TEXT.premise;

export const PLAYER_OPTIONS = {
  comfort_mourner: 'Comfort {m}', send_flowers: 'Send {m} flowers', stay_away: 'Stay away',
  keep_it: 'Keep it', thank_family: 'Thank the family', pay_debts: 'Put it toward your debts',
  repay_now: 'Pay up', ask_for_time: 'Ask for more time', ignore_it: 'Ignore it',
  demand_payment: 'Ask for your money', forgive_debt: 'Forgive the debt', wait_it_out: 'Let it ride',
  apologize: 'Apologize', retaliate: 'Give as good as you got', let_it_go: 'Let it go',
  ask_for_a_toy: 'Ask for a toy', visit_grandparents: 'Visit your grandparents', ask_for_nothing: 'Ask for nothing',
  stand_up_to_bully: 'Stand up to the bully', tell_a_teacher: 'Tell a teacher', keep_quiet: 'Keep quiet',
  get_a_job: 'Look for work', help_at_home: 'Help out at home', tend_the_shrine: 'Tend the family shrine',
} as const satisfies Record<PlayerOption, string>;

export const PLAYER_FAMILIES = {
  family_death: 'A death in the family', inheritance: 'An inheritance', debt_due: 'A debt comes due',
  feud: 'A falling-out', life_stage: 'Growing up',
} as const satisfies Record<PlayerFamily, string>;

export const TRAIT_LABELS = {
  greed: 'Greedy', loyalty: 'Loyal', pride: 'Proud', warmth: 'Warm', temper: 'Hot-tempered',
  vindictiveness: 'Vindictive', piety: 'Pious',
} as const satisfies Record<TraitName, string>;

export const DREAM_INTENT_LABELS = {
  warn: 'Warn them', reassure: 'Reassure them', urge: 'Give them a push', reveal: 'Tell them something',
  request_offering: 'Ask for an offering', forbid: 'Tell them no',
} as const satisfies Record<DreamIntent, string>;

export const DREAM_INTENT_TEXT = {
  warn: 'with a warning', reassure: "to say it's all right", urge: 'with a push',
  reveal: 'with something they should know', request_offering: 'asking for an offering', forbid: 'with a firm no',
} as const satisfies Record<DreamIntent, string>;

export type DreamResponse = NonNullable<WorldSnapshot['last_dream']>['applied'];
export const DREAM_RESPONSE_LABELS = {
  heed_warning: '{B} took it as a warning.', take_comfort: '{B} took comfort in it.', follow_urging: '{B} took the hint.',
  believe_revelation: '{B} believed it.', obey_ban: '{B} took the no seriously.',
  burn_offering: '{B} resolved to burn an offering.', burn_small: '{B} resolved to burn a small offering.',
  dismiss_dream: '{B} decided it was something they ate.',
} as const satisfies Record<DreamResponse, string>;

export type OriginLabelKey = Person['origin'] | Slot | 'birth_slot';
export const ORIGIN_LABELS = {
  native: 'Born here, like everybody.', possessed: 'Arrived in a borrowed body.', rebuilt: 'Arrived built to order.',
  official: 'Underworld staff', birth_slot: 'Be born',
  imported_vessel: 'Borrow a body', rebuilt_body: 'Build a body',
} as const satisfies Record<Exclude<OriginLabelKey, `birth:${string}`>, string>;

export const KINSHIP_LABELS = {
  parent: 'parent', child: 'child', sibling: 'sibling', spouse: 'spouse', former_spouse: 'ex',
  grandparent: 'grandparent', grandchild: 'grandchild', cousin: 'cousin', in_law: 'in-law',
} as const satisfies Record<Kinship, string>;

const SEXED_KINSHIP_LABELS = {
  parent: { female: 'mother', male: 'father' }, child: { female: 'daughter', male: 'son' },
  sibling: { female: 'sister', male: 'brother' }, spouse: { female: 'wife', male: 'husband' },
  former_spouse: { female: 'ex-wife', male: 'ex-husband' },
  grandparent: { female: 'grandmother', male: 'grandfather' },
  grandchild: { female: 'granddaughter', male: 'grandson' },
} as const satisfies Record<Exclude<Kinship, 'cousin' | 'in_law'>, Record<'female' | 'male', string>>;

export const RULING_LABELS = {
  grant_next_slot: 'Granted. The birth register is open to you.',
  grant_later_slot: 'Granted, eventually. The birth register opens to you later.',
  deny: 'Denied. Contributions are non-refundable.',
} as const satisfies Record<RulingOption, string>;

export const SKIP_LABELS = {
  missing_person: 'that person was gone', missing_household: 'that household was gone',
  missing_debt: 'the debt no longer existed', dead_person: 'that person had died',
  debt_not_open: 'the debt was already settled', wrong_debtor: "the debt was someone else's",
  insufficient_money: "there wasn't enough money", already_applied: 'it had already been done',
  out_of_bounds: 'it was more than is allowed',
} as const satisfies Record<SkipReason, string>;

// Native input::RejectReason labels, plus the birth-register's named Needed condition.
export type RejectionLabel = BribeBlocked | HauntBlocked
  | 'self_target' | 'intensity_out_of_range' | 'slot_closed' | 'slot_claimed' | 'claim_held'
  | 'register_wait' | 'unknown_node' | 'option_not_in_set' | 'already_chosen'
  | 'bad_customization' | 'customization_not_allowed' | 'claimed_by_you';
export const REJECTION_LABELS = {
  unknown_person: 'Nobody by that description.', dead_person: "They've died. Try the other office.",
  self_target: "Pick someone who isn't you.", intensity_out_of_range: "That's outside the range.",
  id_exhausted: "The town's books are full.", official_person: 'Staff are not eligible.',
  no_ghost: "You'd need to be dead for that.", not_waiting: "That's for souls between lives.",
  not_connected: "You didn't know them in life.",
  rate_limited: 'One a day. Come back tomorrow.',
  insufficient_joss: "You can't afford that.", yearly_cap: "You've used up this year's allowance.",
  bad_amount: 'A whole amount, more than zero.',
  node_pending: 'The Magistrate is still considering your last one.',
  slot_closed: 'That opening has closed.', slot_claimed: 'Someone got there first.',
  claim_held: "One opening per soul. You're holding one.", register_wait: "The birth register isn't open to you yet.",
  unknown_node: 'That question has been withdrawn.', option_not_in_set: 'Pick one of the answers offered.',
  already_chosen: "You've already answered that.",
  bad_customization: "That isn't a personality we can build.",
  customization_not_allowed: 'Adjustments are for rebuilt bodies only.',
  claimed_by_you: 'That one is already yours.',
} as const satisfies Record<RejectionLabel, string>;

export const UNIT_LABELS = {
  money: 'dollars', joss_paper: 'joss paper', affinity: 'relationship', debt: 'debt',
} as const satisfies Record<Exclude<StakeUnit, 'trait_points'> | 'debt', string>;

export const NEEDED_LABELS = {
  wait_until: 'Opens {date}.', joss_short: 'You are {n} joss paper short.',
  cap_room_short: 'Your yearly allowance is {n} short.', named: TECHNICAL_TEXT.genericRefusal,
} as const satisfies Record<Needed['kind'], string>;

export const TRANSPORT_LABELS = {
  'sim-error': TECHNICAL_TEXT.requestProblem, 'invalid-seed': TECHNICAL_TEXT.seedInvalid,
  'invalid-speed': TECHNICAL_TEXT.paceInvalid, 'invalid-tick': TECHNICAL_TEXT.dateInvalid,
  'no-world': TECHNICAL_TEXT.startGameFirst, 'invalid-state': TECHNICAL_TEXT.pauseFirst,
  'load-failed': TECHNICAL_TEXT.gameStartFailed, rejected: TECHNICAL_TEXT.genericRefusal,
  node_unanswered: TECHNICAL_TEXT.answerFirst,
  decision_pending: TECHNICAL_TEXT.requestPending,
  'invalid-wait': TECHNICAL_TEXT.waitInvalid, 'preview-error': TECHNICAL_TEXT.previewUnavailable,
  cancelled: TECHNICAL_TEXT.cancelled, fatal: TECHNICAL_TEXT.gameStopped,
} as const satisfies Record<ErrorKind | 'fatal', string>;

export const RUN_LABELS = {
  'no-world': TECHNICAL_TEXT.startGameFirst, paused: 'Paused', running: 'Playing', failed: 'Stuck',
} as const satisfies Record<RunState, string>;
export const PAUSE_LABELS = {
  player_node: 'A choice is waiting', player_died: 'You died', dream_resolved: 'Your dream was answered',
  player_reborn: "You're back", user: 'Paused',
} as const satisfies Record<PauseReason, string>;
export const CUSTOMIZATION_LABELS = { Set: 'Set one trait', Adjust: 'Nudge two traits' } as const;

export const PACE_LABELS = {
  [READ_SPEED]: 'Read', [LIFE_SPEED]: 'Life', 1: 'Fast', 7: 'Rush', 30: 'Years', 90: 'Generations', 365: 'Long view',
} as const satisfies Record<Speed, string>;
export const PACE_RATE_LABELS = {
  [READ_SPEED]: '1 day a second', [LIFE_SPEED]: '5 days a second', 1: '30 days a second',
  7: '7 months a second', 30: '2½ years a second', 90: '7 years a second', 365: '30 years a second',
} as const satisfies Record<Speed, string>;
export const FAST_FORWARD_LABEL = TECHNICAL_TEXT.skipAhead;
export const FAST_FORWARD_HELP = TECHNICAL_TEXT.skipAheadHint;

export function optionLabel(option: PlayerOption): string { return PLAYER_OPTIONS[option]; }
export function familyDeathOptionLabel(option: 'comfort_mourner' | 'send_flowers' | 'stay_away', mourner: string): string {
  return PLAYER_OPTIONS[option].replace('{m}', () => mourner);
}
export function familyLabel(family: PlayerFamily): string { return PLAYER_FAMILIES[family]; }
export function traitLabel(trait: TraitName): string { return TRAIT_LABELS[trait]; }
export function dreamIntentLabel(intent: DreamIntent): string { return DREAM_INTENT_LABELS[intent]; }
export function dreamResponseLabel(response: DreamResponse): string { return DREAM_RESPONSE_LABELS[response]; }
export function originLabel(origin: OriginLabelKey): string {
  return origin.startsWith('birth:') ? ORIGIN_LABELS.birth_slot : ORIGIN_LABELS[origin as keyof typeof ORIGIN_LABELS];
}
export function kinshipNoun(kinship: Kinship, sex?: 'male' | 'female'): string {
  if (sex === undefined || kinship === 'cousin' || kinship === 'in_law') return KINSHIP_LABELS[kinship];
  return SEXED_KINSHIP_LABELS[kinship][sex];
}
export function kinshipLabel(kinship: Kinship): string { return kinshipNoun(kinship); }
export function rulingLabel(ruling: RulingOption): string { return RULING_LABELS[ruling]; }
/** Choice-Chronicle prefix only; model decisions and rulings do not use source prose. */
export function sourceLabel(source: ChronicleEntry['source'], index: number | bigint = 0): string {
  const text = CHOICE_SOURCE_TEXT[source];
  return typeof text === 'string' ? text : text[Number(BigInt(index) % BigInt(text.length))]!;
}
export function unitLabel(unit: Exclude<StakeUnit, 'trait_points'> | 'debt'): string { return UNIT_LABELS[unit]; }
export function previewLabel(what: Preview['what']): string {
  return what.startsWith('trait:') ? traitLabel(what.slice(6) as TraitName) : unitLabel(what as Exclude<StakeUnit, 'trait_points'> | 'debt');
}
export function nameLabel(name: string | null | undefined): string {
  return name?.trim() ? name : 'Name unavailable';
}
export function refusalText(reason: string): string {
  return Object.hasOwn(REJECTION_LABELS, reason)
    ? REJECTION_LABELS[reason as RejectionLabel] : TRANSPORT_LABELS.rejected;
}
export function neededText(needed: Needed): string {
  switch (needed.kind) {
    case 'wait_until': return supportedText(NEEDED_LABELS.wait_until, { date: dateLabel(needed.tick) })!;
    case 'joss_short': return supportedText(NEEDED_LABELS.joss_short, { n: formatAmount(needed.amount) })!;
    case 'cap_room_short': return supportedText(NEEDED_LABELS.cap_room_short, { n: formatAmount(needed.amount) })!;
    case 'named': return refusalText(needed.name);
  }
}
/** Diagnostics never become player prose; only an exact native refusal label is reused. */
export function transportText(kind: ErrorKind | 'fatal', runState: RunState, diagnostic?: string, operation?: Request['type']): string {
  if (kind === 'fatal' || runState === 'failed') return TRANSPORT_LABELS.fatal;
  if (kind === 'rejected') return refusalText(diagnostic ?? '');
  if (kind === 'sim-error' && operation === 'create-world') return TRANSPORT_LABELS['load-failed'];
  return TRANSPORT_LABELS[kind];
}
export function paceLabel(speed: Speed): string {
  return `${PACE_LABELS[speed]} — ${PACE_RATE_LABELS[speed]}`;
}

export function runStateLabel(state: RunState): string { return RUN_LABELS[state]; }
export function pauseReasonLabel(reason: PauseReason): string { return PAUSE_LABELS[reason]; }

export const OPERATION_LABELS = {
  choose: 'Your answer', dream: 'Dream', bribe: 'Contribution', haunt: 'Haunting',
  'carry-over': 'Trait to carry', claim: 'Application',
} as const satisfies Record<OperationState['kind'], string>;
export const OPERATION_PHASE_LABELS = {
  sending: 'On its way', considering: 'Under consideration', received: 'Filed',
  unknown: "We can't tell if this went through. Nothing was sent twice.", processed: 'Done',
  refused: 'Refused', cancelled: 'Withdrawn',
} as const satisfies Record<OperationState['phase'], string>;
