import type { ErrorKind, PauseReason, Request, RunState, DreamIntent } from '../shared/protocol.ts';
import { LIFE_SPEED, PLAY_RATE, READ_SPEED, type Speed } from '../shared/speeds.ts';
import type { OperationState } from '../shared/operation-state.ts';
import type {
  BribeBlocked, ChronicleEntry, HauntBlocked, Kinship, Needed, Person, PlayerFamily,
  PlayerOption, Preview, RulingOption, Slot, StakeUnit, SkipReason, TraitName, WorldSnapshot,
} from '../shared/world-snapshot.ts';
import { dateLabel, formatAmount } from './calendar.ts';

export const LANDING_PREMISE = 'Welcome to a small American town, where Halloween starts every year. The Underworld’s paperwork has gone spectacularly wrong. Souls can reincarnate only here—death is a change of address, not an exit.';

export const PLAYER_OPTIONS = {
  comfort_mourner: 'Comfort them', send_flowers: 'Send flowers', stay_away: 'Stay away',
  keep_it: 'Keep the inheritance', thank_family: 'Thank the family', pay_debts: 'Pay debts',
  repay_now: 'Repay now', ask_for_time: 'Ask for more time', ignore_it: 'Ignore the debt',
  demand_payment: 'Ask for repayment', forgive_debt: 'Forgive the debt', wait_it_out: 'Wait a little longer',
  apologize: 'Apologize', retaliate: 'Retaliate', let_it_go: 'Let it go',
  ask_for_a_toy: 'Ask for a toy', visit_grandparents: 'Visit your grandparents', ask_for_nothing: 'Ask for nothing',
  stand_up_to_bully: 'Stand up to the bully', tell_a_teacher: 'Tell a teacher', keep_quiet: 'Keep quiet',
  get_a_job: 'Get a job', help_at_home: 'Help at home', tend_the_shrine: 'Tend the shrine',
} as const satisfies Record<PlayerOption, string>;

export const PLAYER_FAMILIES = {
  family_death: 'A death in the family', inheritance: 'An inheritance', debt_due: 'A debt comes due',
  feud: 'A quarrel', life_stage: 'Growing up',
} as const satisfies Record<PlayerFamily, string>;

export const TRAIT_LABELS = {
  greed: 'Greedy', loyalty: 'Loyal', pride: 'Proud', warmth: 'Warm', temper: 'Hot-tempered',
  vindictiveness: 'Vindictive', piety: 'Pious',
} as const satisfies Record<TraitName, string>;

export const DREAM_INTENT_LABELS = {
  warn: 'Warn them', reassure: 'Reassure them', urge: 'Urge them on', reveal: 'Reveal something',
  request_offering: 'Ask for an offering', forbid: 'Tell them not to',
} as const satisfies Record<DreamIntent, string>;

export type DreamResponse = NonNullable<WorldSnapshot['last_dream']>['applied'];
export const DREAM_RESPONSE_LABELS = {
  heed_warning: 'Take the warning seriously', take_comfort: 'Take comfort', follow_urging: 'Follow the urging',
  believe_revelation: 'Believe the revelation', obey_ban: 'Respect the warning not to act',
  burn_offering: 'Offer spirit money', burn_small: 'Offer a little spirit money', dismiss_dream: 'Dismiss the dream',
} as const satisfies Record<DreamResponse, string>;

export type OriginLabelKey = Person['origin'] | Slot | 'birth_slot';
export const ORIGIN_LABELS = {
  native: 'Born in town', possessed: 'Arrived in a borrowed body', rebuilt: 'Arrived in a rebuilt body',
  official: 'Underworld official', birth_slot: 'Be born into a family',
  imported_vessel: 'Borrow a body', rebuilt_body: 'Build a new body',
} as const satisfies Record<Exclude<OriginLabelKey, `birth:${string}`>, string>;

export const KINSHIP_LABELS = {
  parent: 'Parent', child: 'Child', sibling: 'Sibling', spouse: 'Spouse', former_spouse: 'Former spouse',
  grandparent: 'Grandparent', grandchild: 'Grandchild', cousin: 'Cousin', in_law: 'In-law',
} as const satisfies Record<Kinship, string>;

export const RULING_LABELS = {
  grant_next_slot: 'Birth-register access approved for now',
  grant_later_slot: 'Birth-register access approved for a later date', deny: 'Access request declined',
} as const satisfies Record<RulingOption, string>;
export const RULING_ACCESS_NOTE = 'Approval opens the birth register; it does not reserve or guarantee an opening.';

export const SOURCE_LABELS = {
  external: 'Choice on file', rules_default: 'Default answer filed', auto_resolved: 'Answer filed automatically',
} as const satisfies Record<ChronicleEntry['source'], string>;

export const SKIP_LABELS = {
  missing_person: 'No person was available on file', missing_household: 'No household was available on file',
  missing_debt: 'No debt was available on file', dead_person: 'The person was already listed as deceased',
  debt_not_open: 'The debt was already closed', wrong_debtor: "The debt was filed under someone else's name",
  insufficient_money: 'The available funds did not cover this part', already_applied: 'This part was already completed',
  out_of_bounds: 'This amendment exceeded the allowed range',
} as const satisfies Record<SkipReason, string>;

// Native input::RejectReason labels, plus the birth-register's named Needed condition.
export type RejectionLabel = BribeBlocked | HauntBlocked
  | 'self_target' | 'intensity_out_of_range' | 'slot_closed' | 'slot_claimed' | 'claim_held'
  | 'register_wait' | 'unknown_node' | 'option_not_in_set' | 'already_chosen'
  | 'bad_customization' | 'customization_not_allowed' | 'claimed_by_you';
export const REJECTION_LABELS = {
  unknown_person: 'No available person on file.', dead_person: 'This person is listed as deceased.',
  self_target: 'A different recipient is required.', intensity_out_of_range: 'Social-action intensity must be from 1 to 100.',
  id_exhausted: "The town's record book is full.", official_person: 'Underworld officials are exempt from this action.',
  no_ghost: 'No ghost is available to file this request.', not_waiting: 'Rebirth-waiting status is required.',
  not_connected: 'A connection to your former life is required.',
  rate_limited: "This request's daily allowance is used. Please return tomorrow.",
  insufficient_joss: 'Not enough joss paper for this payment.', yearly_cap: "This year's spending allowance is exhausted.",
  bad_amount: 'Payment must be a whole amount above zero.',
  node_pending: 'Your earlier bribe awaits a ruling. No answer is needed from you.',
  slot_closed: 'This birth opening has closed.', slot_claimed: "This birth opening is reserved in someone else's name.",
  claim_held: 'Another birth opening is already reserved in your name.', register_wait: 'Birth-register access is not open yet.',
  unknown_node: 'This choice is no longer on file.', option_not_in_set: 'An answer from the listed options is required.',
  already_chosen: 'An answer to this choice is already on file.',
  bad_customization: 'The personality selection does not meet the requirements.',
  customization_not_allowed: 'Personality amendments are unavailable on this rebirth path.',
  claimed_by_you: 'This birth opening is already reserved in your name.',
} as const satisfies Record<RejectionLabel, string>;

export const UNIT_LABELS = {
  money: 'Dollars', joss_paper: 'Joss paper', affinity: 'Relationship', trait_points: 'Personality points', debt: 'Debt',
} as const satisfies Record<StakeUnit | 'debt', string>;

export const NEEDED_LABELS = {
  wait_until: 'Opens on', joss_short: 'Payment needs', cap_room_short: "This year's allowance needs", named: 'Requirement',
} as const satisfies Record<Needed['kind'], string>;

export const TRANSPORT_LABELS = {
  'sim-error': 'The game could not continue.', 'invalid-seed': 'A valid seed is required.',
  'invalid-speed': 'Please select an available pace.', 'invalid-tick': 'A valid date range is required.',
  'no-world': 'A game must be started first.', 'invalid-state': 'Pause is required before taking one day.',
  'load-failed': 'The game could not be opened.', rejected: 'This request could not be accepted.',
  node_unanswered: 'The current choice needs an answer first.',
  decision_pending: 'A decision is still being processed; please wait.',
  'invalid-wait': 'A valid waiting time is required.', 'preview-error': 'No preview is available for this request.',
  cancelled: 'Request cancelled.', fatal: 'The game could not continue.',
} as const satisfies Record<ErrorKind | 'fatal', string>;

export const RUN_LABELS = {
  'no-world': 'No game yet', paused: 'Paused', running: 'Playing', failed: 'Unable to continue',
} as const satisfies Record<RunState, string>;
export const PAUSE_LABELS = {
  player_node: 'Choice waiting', player_died: 'Your life ended', dream_resolved: 'Dream answered',
  player_reborn: 'A new life began', user: 'Paused by you',
} as const satisfies Record<PauseReason, string>;
export const CUSTOMIZATION_LABELS = { Set: 'Set one trait', Adjust: 'Adjust two traits' } as const;

export const PACE_LABELS = {
  [READ_SPEED]: 'Read', [LIFE_SPEED]: 'Life', 1: 'Fast', 7: 'Rush', 30: 'Years', 90: 'Generations', 365: 'Long view',
} as const satisfies Record<Speed, string>;
export const FAST_FORWARD_LABEL = 'Fast-forward to next choice';
export const FAST_FORWARD_HELP = 'Run faster to the next choice or any existing life or decision stop.';

export function optionLabel(option: PlayerOption): string { return PLAYER_OPTIONS[option]; }
export function familyLabel(family: PlayerFamily): string { return PLAYER_FAMILIES[family]; }
export function traitLabel(trait: TraitName): string { return TRAIT_LABELS[trait]; }
export function dreamIntentLabel(intent: DreamIntent): string { return DREAM_INTENT_LABELS[intent]; }
export function dreamResponseLabel(response: DreamResponse): string { return DREAM_RESPONSE_LABELS[response]; }
export function originLabel(origin: OriginLabelKey): string {
  return origin.startsWith('birth:') ? ORIGIN_LABELS.birth_slot : ORIGIN_LABELS[origin as keyof typeof ORIGIN_LABELS];
}
export function kinshipLabel(kinship: Kinship): string { return KINSHIP_LABELS[kinship]; }
export function rulingLabel(ruling: RulingOption): string { return RULING_LABELS[ruling]; }
export function sourceLabel(source: ChronicleEntry['source']): string { return SOURCE_LABELS[source]; }
export function unitLabel(unit: StakeUnit | 'debt'): string { return UNIT_LABELS[unit]; }
export function previewLabel(what: Preview['what']): string {
  return what.startsWith('trait:') ? traitLabel(what.slice(6) as TraitName) : unitLabel(what as StakeUnit | 'debt');
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
    case 'wait_until': return `${NEEDED_LABELS.wait_until} ${dateLabel(needed.tick)}`;
    case 'joss_short': return `${NEEDED_LABELS.joss_short} ${formatAmount(needed.amount)} more joss paper`;
    case 'cap_room_short': return `${NEEDED_LABELS.cap_room_short} ${formatAmount(needed.amount)} more room`;
    case 'named': return refusalText(needed.name);
  }
}
/** Diagnostics never become player prose; only an exact native refusal label is reused. */
export function transportText(kind: ErrorKind | 'fatal', diagnostic?: string, operation?: Request['type']): string {
  if (kind === 'rejected') return refusalText(diagnostic ?? '');
  if (kind === 'sim-error' && operation === 'create-world') return TRANSPORT_LABELS['load-failed'];
  return TRANSPORT_LABELS[kind];
}
export function paceLabel(speed: Speed): string {
  return `${PACE_LABELS[speed]} — ${formatAmount(String(speed * PLAY_RATE))} ${speed * PLAY_RATE === 1 ? 'day' : 'days'}/second`;
}

export function runStateLabel(state: RunState): string { return RUN_LABELS[state]; }
export function pauseReasonLabel(reason: PauseReason): string { return PAUSE_LABELS[reason]; }

export const OPERATION_LABELS = {
  choose: 'Choice', dream: 'Dream message', bribe: 'Bribe', haunt: 'Haunt petition',
  'carry-over': 'Personality carry', claim: 'Rebirth application',
} as const satisfies Record<OperationState['kind'], string>;
export const OPERATION_PHASE_LABELS = {
  sending: 'Sending', considering: 'Considering', received: 'Received',
  unknown: 'Completion unknown. No retry was sent', processed: 'Processed',
  refused: 'Declined', cancelled: 'Decision cancelled',
} as const satisfies Record<OperationState['phase'], string>;
