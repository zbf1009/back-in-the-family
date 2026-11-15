//! Seeded tooling policy for the Player_Soul; only submitted inputs change the World.

use sim_core::ids::{PersonId, Tick};
use sim_core::input::InputPayload;
use sim_core::rng::{StreamTag, below, draw};
use sim_core::tick::Sim;
use sim_core::underworld::carry_over::TraitName;
use sim_core::underworld::dreams::DreamIntent;
use sim_core::underworld::nodes::NodeRef;
use sim_core::underworld::slots::SlotRef;
use sim_core::values::{SocialKind, Traits};
use sim_core::world::{Life, SoulPlace};

#[derive(Clone, Copy, Eq, PartialEq, Debug)]
pub enum Strategy {
    ImportedVessel,
    Birth,
    RebuiltBody,
}

const STRATEGIES: [Strategy; 3] = [
    Strategy::ImportedVessel,
    Strategy::Birth,
    Strategy::RebuiltBody,
];

/// The slot strategy chosen for wait `k`, in documented rotation order.
pub fn strategy_for_wait(seed: u64, k: u64) -> Strategy {
    STRATEGIES[((seed % 3 + k % 3) % 3) as usize]
}

struct WaitPlan {
    since: Tick,
    strategy: Strategy,
    dreamed: bool,
    bribed: bool,
    haunted: bool,
}

/// Plans inputs for successive Player_Waits, without changing simulation state.
#[derive(Default)]
pub struct AutoPlayer {
    waits_seen: u64,
    per_wait: Option<WaitPlan>,
}

/// The 9.5 H4 living social-act budget, reset for each Player body.
#[derive(Default)]
pub struct DevotedLiving {
    body: Option<PersonId>,
    next_day: u64,
    next_kind: usize,
    kin_cursor: usize,
    applied_in_life: u64,
}

impl DevotedLiving {
    pub fn applied_in_life(&self) -> u64 {
        self.applied_in_life
    }

    pub fn applied(&mut self) {
        self.applied_in_life = self.applied_in_life.saturating_add(1);
    }

    /// Plans at most one act on the body's 30-day schedule, even if no target exists.
    pub fn plan(&mut self, sim: &Sim) -> Option<InputPayload> {
        let world = sim.world();
        let SoulPlace::Body(body) = world.souls().places[&world.souls().player] else {
            self.body = None;
            return None;
        };
        if self.body != Some(body) {
            self.body = Some(body);
            self.next_day = world.tick().0;
            self.next_kind = 0;
            self.kin_cursor = 0;
            self.applied_in_life = 0;
        }
        if world.tick().0 < self.next_day {
            return None;
        }
        self.next_day = self.next_day.saturating_add(30);
        // BTreeMap Person order is ID order. The cursor indexes the current kin set,
        // exactly as in the 9.5 diagnostic (it does not track an absolute ID).
        let kin_count = world
            .persons()
            .values()
            .filter(|p| {
                p.id != body
                    && matches!(p.life, Life::Alive { .. })
                    && world
                        .relations()
                        .get(&(p.id, body))
                        .is_some_and(|r| r.tags.has_kinship())
            })
            .count();
        let target = if kin_count == 0 {
            world
                .persons()
                .values()
                .filter(|p| p.id != body && matches!(p.life, Life::Alive { .. }))
                .max_by_key(|p| {
                    (
                        world
                            .relations()
                            .get(&(p.id, body))
                            .map_or(0, |r| r.affinity.get()),
                        std::cmp::Reverse(p.id),
                    )
                })
                .map(|p| p.id)?
        } else {
            let selected = self.kin_cursor % kin_count;
            let target = world
                .persons()
                .values()
                .filter(|p| {
                    p.id != body
                        && matches!(p.life, Life::Alive { .. })
                        && world
                            .relations()
                            .get(&(p.id, body))
                            .is_some_and(|r| r.tags.has_kinship())
                })
                .nth(selected)
                .expect("counted kin")
                .id;
            self.kin_cursor = self.kin_cursor.saturating_add(1);
            target
        };
        let kind = if self.next_kind.is_multiple_of(2) {
            SocialKind::Help
        } else {
            SocialKind::Gift
        };
        self.next_kind = self.next_kind.saturating_add(1);
        Some(InputPayload::Act {
            kind,
            actor: body,
            target,
            intensity: 100,
        })
    }
}

fn strongest_trait(traits: &Traits) -> TraitName {
    let values = [
        traits.greed,
        traits.loyalty,
        traits.pride,
        traits.warmth,
        traits.temper,
        traits.vindictiveness,
        traits.piety,
    ];
    let mut best = 0;
    for index in 1..values.len() {
        if values[index].get().unsigned_abs() > values[best].get().unsigned_abs() {
            best = index;
        }
    }
    TraitName::ALL[best]
}

impl AutoPlayer {
    /// Plans this tick's payloads in order; the caller submits every payload before stepping.
    pub fn plan(&mut self, sim: &Sim) -> Vec<InputPayload> {
        let world = sim.world();
        let Some(wait) = world.player_wait() else {
            self.per_wait = None;
            return Vec::new();
        };
        let SoulPlace::Waiting { since } = world.souls().places[&world.souls().player] else {
            return Vec::new();
        };
        let tick = world.tick();
        let seed = world.seed();
        let soul = world.souls().player;
        let d = |index| draw(seed, soul.rng_key(), StreamTag::AutoPlayer, tick, index);
        let first = self
            .per_wait
            .as_ref()
            .is_none_or(|plan| plan.since != since);
        if first {
            let strategy = strategy_for_wait(seed, self.waits_seen);
            self.waits_seen = self.waits_seen.saturating_add(1);
            self.per_wait = Some(WaitPlan {
                since,
                strategy,
                dreamed: false,
                bribed: false,
                haunted: false,
            });
        }
        let plan = self.per_wait.as_mut().expect("initialized above");
        let params = world.params();
        let account = world.joss()[&soul];
        let mut balance = account.balance;
        let mut capped = account.capped_spent_in(tick);
        let connected: Vec<_> = world
            .persons()
            .values()
            .filter(|person| matches!(person.life, sim_core::world::Life::Alive { .. }))
            .filter(|person| world.relations().contains_key(&(person.id, wait.ghost)))
            .map(|person| person.id)
            .collect();
        let mut payloads = Vec::new();
        if first {
            payloads.push(InputPayload::CarryOver {
                trait_name: strongest_trait(&world.persons()[&wait.ghost].traits),
            });
        }
        if !plan.dreamed && balance >= params.dream_price && !connected.is_empty() {
            let dreamer = connected[below(d(1), connected.len() as u64) as usize];
            let intent = DreamIntent::ALL[below(d(2), 6) as usize];
            let payload = InputPayload::Dream { dreamer, intent };
            if d(3) & 1 == 1 {
                let mut candidate = sim.clone();
                for &prior in &payloads {
                    candidate.submit(tick, prior).expect("current tick");
                }
                let spec = candidate.preview_node(payload).expect("valid dream");
                let option = spec.options[below(d(4), spec.options.len() as u64) as usize];
                payloads.push(payload);
                payloads.push(InputPayload::Choose {
                    node: NodeRef::Trigger { seq: spec.trigger },
                    option,
                });
            } else {
                payloads.push(payload);
            }
            balance -= params.dream_price;
            plan.dreamed = true;
        }
        if !plan.bribed && balance >= 1 {
            let amount = match plan.strategy {
                Strategy::Birth => (balance / 2).max(1),
                Strategy::ImportedVessel | Strategy::RebuiltBody => 1,
            };
            let payload = InputPayload::Bribe { amount };
            if d(5) & 1 == 1 {
                let mut candidate = sim.clone();
                for &prior in &payloads {
                    candidate.submit(tick, prior).expect("current tick");
                }
                let spec = candidate.preview_node(payload).expect("valid bribe");
                let option = spec.options[below(d(6), spec.options.len() as u64) as usize];
                payloads.push(payload);
                payloads.push(InputPayload::Choose {
                    node: NodeRef::Trigger { seq: spec.trigger },
                    option,
                });
            } else {
                payloads.push(payload);
            }
            balance -= amount;
            plan.bribed = true;
        }
        let reserve = match plan.strategy {
            Strategy::Birth => 0,
            Strategy::ImportedVessel => params.imported_price,
            Strategy::RebuiltBody => params.rebuilt_price,
        };
        let extra_cap = if matches!(plan.strategy, Strategy::RebuiltBody) {
            params.rebuilt_price
        } else {
            0
        };
        if !plan.haunted
            && !connected.is_empty()
            && balance >= params.haunt_price.saturating_add(reserve)
            && capped
                .saturating_add(params.haunt_price)
                .saturating_add(extra_cap)
                <= params.yearly_cap
        {
            let target = connected
                .into_iter()
                .min_by_key(|&id| (world.relations()[&(id, wait.ghost)].affinity.get(), id))
                .expect("nonempty");
            payloads.push(InputPayload::Haunt { target });
            balance -= params.haunt_price;
            capped += params.haunt_price;
            plan.haunted = true;
        }
        let elapsed = tick.0.saturating_sub(since.0);
        let slot = match plan.strategy {
            Strategy::Birth if tick >= wait.access_from && wait.claim.is_none() => world
                .slots()
                .values()
                .filter(|slot| slot.birth.0 <= since.0.saturating_add(params.player_max_wait))
                .min_by_key(|slot| (slot.birth, slot.id))
                .map(|slot| SlotRef::Birth(slot.id))
                .or_else(|| {
                    (elapsed >= 900 && balance >= params.imported_price)
                        .then_some(SlotRef::ImportedVessel)
                }),
            Strategy::Birth => {
                (elapsed >= 900 && wait.claim.is_none() && balance >= params.imported_price)
                    .then_some(SlotRef::ImportedVessel)
            }
            Strategy::ImportedVessel => (elapsed >= 180 && balance >= params.imported_price)
                .then_some(SlotRef::ImportedVessel),
            Strategy::RebuiltBody
                if elapsed >= 180
                    && balance >= params.rebuilt_price
                    && capped.saturating_add(params.rebuilt_price) <= params.yearly_cap =>
            {
                Some(SlotRef::RebuiltBody)
            }
            Strategy::RebuiltBody => (elapsed == params.player_max_wait
                && balance >= params.imported_price)
                .then_some(SlotRef::ImportedVessel),
        };
        if let Some(slot) = slot {
            payloads.push(InputPayload::ClaimSlot { slot });
        }
        payloads
    }
}
