import type { DreamIntent } from './protocol.ts';
import type { Kinship, Origin, PlayerFamily, PlayerOption, SkipReason, Stakes, WorldSnapshot } from './world-snapshot.ts';

/** Read-only native history; decimal identities are not player-facing copy. */
export interface StoryActor {
  person: number;
  soulId: WorldSnapshot['player_soul'];
  name: string;
  sex: 'female' | 'male';
  origin: Origin | 'official';
  birthDay?: string;
  ageAtDeath?: string;
}
export type StoryBasis = 'opening-current' | 'observed-day-start' | 'observed-day-end';
export interface ActorContext {
  relativeTo: number;
  basis: StoryBasis;
  actors: { person: number; kinRole?: Kinship }[];
}
export type SocialKind = 'help' | 'gift' | 'quarrel' | 'insult' | 'theft' | 'apology';
export type StoryEventKind =
  | { type: 'birth' | 'death'; person: number }
  | { type: 'marriage'; a: number; b: number }
  | { type: 'loan'; lender: number; borrower: number; amount: string; due: string }
  | { type: 'repayment'; payer: number; payee: number; amount: string }
  | { type: 'debt_transfer'; from: number; to: number; amount: string }
  | { type: 'debt_forgiven'; creditor: number; debtor: number; amount: string }
  | { type: 'inheritance'; deceased: number; heir: number; amount: string }
  | { type: 'possession' | 'rebuild'; person: number; price: string }
  | { type: 'offering'; offerer: number; ghost: number; amount: string; credited: string }
  | { type: 'bribe_offering'; ghost: number; magistrate: number; amount: string }
  | { type: 'dream'; ghost: number; dreamer: number; price: string }
  | { type: 'haunting'; ghost: number; target: number; intensity: string; price: string }
  | { type: 'appeal'; ghost: number; magistrate: number }
  | { type: 'social'; kind: SocialKind; doer: number; target: number; intensity: number };
export interface StoryEvent {
  id: string;
  tick: string;
  kind: StoryEventKind;
  causedBy: string[];
  tags: number;
  relevance: 'self' | 'circle' | 'townlife' | 'background';
  relevanceBasis: 'opening-current' | 'observed-day-start-end';
  actorContext: ActorContext[];
}
export interface StoryChronicle {
  index: string;
  tick: string;
  family: PlayerFamily;
  node?: string;
  stakes: Stakes;
  applied: PlayerOption;
  source: 'external' | 'rules_default' | 'auto_resolved';
  chooserAbsent: boolean;
  skipped: { part: number; reason: SkipReason }[];
  appended: string[];
  actorContext: ActorContext[];
}
export interface DreamFact {
  eventId: string;
  inputSeq: string;
  tick: string;
  ghost: number;
  dreamer: number;
  intent: DreamIntent;
  price: string;
  node?: string;
  interpretation?: {
    node: string;
    tick?: string;
    applied: NonNullable<WorldSnapshot['last_dream']>['applied'];
    source: 'external' | 'rules_default';
    rulesDefault: NonNullable<WorldSnapshot['last_dream']>['applied'];
  };
}
export interface StoryCursor { start: string; end: string }
export interface StoryBatch {
  version: 1;
  opening: boolean;
  actors: StoryActor[];
  events: StoryEvent[];
  chronicle: StoryChronicle[];
  dreams: DreamFact[];
  cursors: { events: StoryCursor; chronicle: StoryCursor };
}
export interface StoryDelivery { worldId: number; batch: StoryBatch }
export type StoryIdentity = `e:${string}` | `c:${string}`;
