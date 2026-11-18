// Read-only JSON returned by WasmSim.snapshot(). Project integers are decimal
// strings; card Person IDs, ages, wealth and Trait values are JSON numbers.
export type TraitName = 'greed' | 'loyalty' | 'pride' | 'warmth' | 'temper' | 'vindictiveness' | 'piety';
export type Traits = Record<TraitName, number>;
export type Origin = 'native' | 'possessed' | 'rebuilt';
export type Kinship = 'parent' | 'child' | 'sibling' | 'spouse' | 'former_spouse' | 'grandparent' | 'grandchild' | 'cousin' | 'in_law';
export type PlayerFamily = 'family_death' | 'inheritance' | 'debt_due' | 'feud' | 'life_stage';
export type PlayerOption =
  | 'comfort_mourner' | 'send_flowers' | 'stay_away' | 'keep_it' | 'thank_family' | 'pay_debts'
  | 'repay_now' | 'ask_for_time' | 'ignore_it' | 'demand_payment' | 'forgive_debt' | 'wait_it_out'
  | 'apologize' | 'retaliate' | 'let_it_go' | 'ask_for_a_toy' | 'visit_grandparents' | 'ask_for_nothing'
  | 'stand_up_to_bully' | 'tell_a_teacher' | 'keep_quiet' | 'get_a_job' | 'help_at_home' | 'tend_the_shrine';
export type StakeUnit = 'money' | 'joss_paper' | 'affinity' | 'trait_points';
export interface Stakes { who: number[]; amount: string; unit: StakeUnit; by: string }
export interface Preview { person: number; what: 'money' | 'debt' | 'affinity' | `trait:${TraitName}`; delta: string }
export interface PlayerNode {
  id: string;
  family: PlayerFamily;
  fired: string;
  choice_tick: string;
  resolves: string;
  stakes: Stakes;
  options: { id: PlayerOption; preview: Preview[] }[];
  rules_default: PlayerOption;
}
export type SkipReason = 'missing_person' | 'missing_household' | 'missing_debt' | 'dead_person' | 'debt_not_open' | 'wrong_debtor' | 'insufficient_money' | 'already_applied' | 'out_of_bounds';
export interface ChronicleEntry {
  tick: string;
  family: PlayerFamily;
  stakes: Stakes;
  applied: PlayerOption;
  source: 'external' | 'rules_default' | 'auto_resolved';
  chooser_absent: boolean;
  skipped: { part: number; reason: SkipReason }[];
}
export type Slot = `birth:${string}` | 'imported_vessel' | 'rebuilt_body';
export type Needed =
  | { kind: 'wait_until'; tick: string }
  | { kind: 'joss_short' | 'cap_room_short'; amount: string }
  | { kind: 'named'; name: string };
export interface PathStatus { announced: boolean; claimable: boolean; affordable: boolean; needed: Needed[] }
export interface UnderworldView {
  connected: number[];
  ghost_traits: Traits;
  slots: { slot: Slot; kind: 'birth_slot' | 'imported_vessel' | 'rebuilt_body'; price: string; birth: string | null; status: PathStatus }[];
  base_traits: { carry_over: TraitName | null; traits: Traits }[];
}
export interface Person {
  id: number;
  name: string;
  age: number;
  sex: 'female' | 'male';
  alive: boolean;
  origin: Origin | 'official';
  traits: Traits;
  wealth: number;
  soul_id: string;
}
export type SoulPlace = { body: number; waiting?: never } | { waiting: { since: string }; body?: never };
export interface WorldSnapshot {
  tick: string;
  player_soul: string;
  residents: (Person & { origin: Origin; household: string })[];
  households: { id: string; members: number[] }[];
  souls: { soul_id: string; place: SoulPlace }[];
  magistrate: Person & { origin: 'official' };
  joss: { soul_id: string; balance: string }[];
  birth_slots: { id: string; household: string; birth: string; price: string; claimant: string | null }[];
  standing_slots: { kind: 'imported_vessel' | 'rebuilt_body'; price: string }[];
  player_wait: { ghost: number; access_from: string; claim: string | null; carry_over: TraitName | null } | null;
  pending_nodes: { id: string; family: 'dream_interpretation' | 'magistrate_ruling'; subject: number; options: string[]; rules_default: string; resolves: string }[];
  player: {
    place: 'body' | 'waiting';
    body: number | null;
    earlier_bodies: { id: number; name: string; origin: Origin; death: string }[];
    blood_ties: { person: number; affinity: number; kinship: Kinship[] }[];
    relations: { person: number; affinity: number; kinship: Kinship[] }[];
    past_life_ties: { rememberer: number; earlier_body: number; affinity: number }[];
  };
  player_node: PlayerNode | null;
  chronicle: ChronicleEntry[];
  underworld_view: UnderworldView | null;
  person_names: { id: number; name: string }[];
}
