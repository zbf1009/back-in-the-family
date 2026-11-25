import { currentDecision, type UiAction, type UiState } from './ui-state.ts';
import type { Needed, Preview, Stakes, WorldSnapshot } from '../shared/world-snapshot.ts';
import { customizationInput } from './customization.ts';

export function namesById(world: WorldSnapshot): ReadonlyMap<number, string> {
  return new Map([...world.person_names, ...world.player.earlier_bodies, ...world.residents]
    .map(person => [person.id, person.name]));
}

export function neededText(needed: Needed): string {
  switch (needed.kind) {
    case 'wait_until': return `wait until tick ${needed.tick}`;
    case 'joss_short': return `short by ${needed.amount} joss paper`;
    case 'cap_room_short': return `Yearly_Cap room short by ${needed.amount}`;
    case 'named': return needed.name;
  }
}

export function stakesView(stakes: Stakes, world: WorldSnapshot) {
  const names = namesById(world);
  return {
    who: stakes.who.map(id => names.get(id)!),
    amount: stakes.amount,
    unit: stakes.unit,
    by: stakes.by,
    days: (BigInt(stakes.by) - BigInt(world.tick)).toString(),
  };
}

export function previewView(preview: Preview, world: WorldSnapshot) {
  return {
    person: namesById(world).get(preview.person)!,
    personId: preview.person,
    delta: preview.delta.startsWith('-') ? preview.delta : `+${preview.delta}`,
    what: preview.what,
    unit: preview.what.startsWith('trait:') ? 'trait_points'
      : preview.what === 'debt' ? 'money' : preview.what,
  };
}

export function identitySummary(ui: UiState) {
  const world = ui.world;
  if (world === null) return null;
  const body = world.player.place === 'waiting'
    ? null : world.residents.find(person => person.id === world.player.body)!;
  return {
    soul: world.player_soul,
    body: body?.id ?? null,
    name: body === null ? `Soul ${world.player_soul} · Waiting between lives` : body.name,
    status: world.player.place === 'waiting' ? 'waiting' as const : 'living' as const,
    age: body?.age ?? null,
    origin: body?.origin ?? null,
  };
}

// Presentation only: Snapshot age is already whole years; only days are subtracted.
export function viewModel(ui: UiState) {
  const world = ui.world;
  if (world === null) return null;
  const names = namesById(world);
  const node = currentDecision(ui);
  const body = world.residents.find(person => person.id === world.player.body);
  return {
    body: body === undefined ? null : {
      id: body.id, name: body.name, age: body.age, origin: body.origin,
    },
    earlierBodies: world.player.earlier_bodies,
    rememberers: new Set(world.player.past_life_ties.map(tie => tie.rememberer)).size,
    bloodTies: world.player.blood_ties.map(tie => ({ ...tie, name: names.get(tie.person)! })),
    relations: world.player.relations.map(tie => ({ ...tie, name: names.get(tie.person)! })),
    pastLifeTies: world.player.past_life_ties.map(tie => ({
      ...tie, name: names.get(tie.rememberer)!, earlierName: names.get(tie.earlier_body)!,
    })),
    choice: node === null ? null : {
      worldId: ui.worldId,
      id: node.id,
      family: node.family,
      fired: node.fired, choiceTick: node.choice_tick, resolves: node.resolves,
      rulesDefault: node.rules_default,
      stakes: stakesView(node.stakes, world),
      options: node.options.map(option => ({
        id: option.id, preview: option.preview.map(entry => previewView(entry, world)),
      })),
    },
    needed: world.underworld_view?.slots.map(slot => ({
      slot: slot.slot, lines: slot.status.needed.map(neededText),
    })) ?? [],
  };
}

/** Receipt and observation feedback does not depend on a World Snapshot. */
export function feedbackView(ui: UiState) {
  return {
    actions: ui.actions.map(action => ({ ...action, text: actionText(action, ui.tick) })),
    settledOmitted: ui.settledOmitted,
    playerLifecycle: ui.playerLifecycle,
  };
}

export function underworldView(ui: UiState) {
  const world = ui.world;
  if (world === null || world.underworld_view === null) return null;
  const view = world.underworld_view;
  const names = namesById(world);
  const balance = world.joss.find(account => account.soul_id === world.player_soul)!.balance;
  const low = BigInt(balance) < BigInt(view.dream_price);
  const nobody = view.connected.length === 0;
  const live = ui.worldId !== 0 && ui.runState !== 'failed' && !ui.createPending && world.player.place === 'waiting';
  const ghost = world.player_wait?.ghost;
  const affinities = new Map(world.player.past_life_ties
    .filter(tie => tie.earlier_body === ghost).map(tie => [tie.rememberer, tie.affinity]));
  return {
    worldId: ui.worldId,
    observedTick: world.tick,
    controlsAvailable: live,
    actionsVersion: view.actions.version,
    cappedSpend: view.actions.capped_spend,
    bribe: {
      minAmount: view.actions.bribe.min_amount,
      maxAmount: view.actions.bribe.max_amount,
      availability: view.actions.bribe.availability,
      enabled: live && view.actions.bribe.availability.eligible,
    },
    haunt: {
      price: view.actions.haunt.price,
      targets: view.actions.haunt.targets.map(target => ({
        id: target.target,
        name: names.get(target.target)!,
        affinity: affinities.get(target.target) ?? null,
        availability: target.availability,
        enabled: live && target.availability.eligible,
      })),
    },
    register: world.player_wait === null ? null : {
      ghost: world.player_wait.ghost,
      name: names.get(world.player_wait.ghost)!,
      accessFrom: world.player_wait.access_from,
      claim: world.player_wait.claim,
      carryOver: world.player_wait.carry_over,
    },
    balance, dreamPrice: view.dream_price,
    connected: view.connected.map(id => ({ id, name: names.get(id)! })),
    ghostTraits: view.ghost_traits,
    dreamEnabled: live && !low && !nobody,
    dreamReasons: [...(!live ? ['World controls are unavailable.'] : []),
      ...(low ? ['Not enough joss paper for a dream.'] : []), ...(nobody ? ['No connected people.'] : [])],
    slots: view.slots.map(slot => ({
      ...slot, needed: slot.status.needed.map(neededText),
      claimEnabled: live && slot.status.claimable && slot.status.affordable
        && (slot.slot !== 'rebuilt_body' || customizationInput(ui.underworldForm.customization) !== null),
    })),
  };
}

function actionText(action: UiAction, tick: string | null): string {
  const name = action.request?.type ?? action.result?.kind ?? 'Input';
  const identity = `Request ${action.requestId ?? 'untracked'}${action.inputSeq === null ? '' : ` · input ${action.inputSeq}`}`;
  if (action.phase === 'sending' || action.phase === 'deciding') return `${name}: ${action.phase}. ${identity}`;
  if (action.phase === 'unknown') return `${name}: completion unknown. No retry was sent. ${identity}`;
  if (action.phase === 'queued') {
    if (action.request?.type !== 'bribe' && action.request?.type !== 'haunt' && action.submission !== null
      && tick !== null && BigInt(tick) > BigInt(action.submission.tick)) {
      return `${name}: admission queued at tick ${action.submission.tick}; consult Chronicle for completed outcomes. ${identity}`;
    }
    return `${name}: queued, not applied yet${action.submission === null ? '' : ` at tick ${action.submission.tick}`}. Use Run or Step to continue. ${identity}`;
  }
  const result = action.result;
  if (result === null) return `${name}: ${action.phase}${action.error === null ? '' : ` (${action.error})`}. ${identity}`;
  if (result.state === 'rejected') {
    const subject = result.kind === 'bribe' ? `amount ${result.amount} joss paper` : `target ${result.target}`;
    return `${result.kind}: rejected at tick ${result.tick} (${result.reason}); ${subject}. ${identity}`;
  }
  if (result.kind === 'haunt') return `haunt: applied at tick ${result.tick}, target ${result.target}, charged ${result.price} joss paper; intensity ${result.intensity}, pre-clamp Mood effect ${result.mood_delta}, event ${result.event}, ghost ${result.ghost}. ${identity}`;
  const ruling = result.ruling === null ? 'No ruling was emitted.'
    : `Ruling ${result.ruling.applied}, source ${result.ruling.source}, node ${result.ruling.node}. Magistrate ${result.ruling.magistrate}; rules default ${result.ruling.rules_default}.`;
  return `bribe: applied at tick ${result.tick}, spent ${result.amount} joss paper, offering ${result.offering_event}, appeal ${result.appeal_event}, ghost ${result.ghost}. ${ruling} ${identity}`;
}
