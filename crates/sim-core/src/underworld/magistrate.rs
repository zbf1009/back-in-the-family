//! The Magistrate (R15, OP-U1 A).
//!
//! One fixed official Person in the World, held outside `World::persons`: every
//! iteration over `World::persons` therefore stays a Resident/dead-Person iteration, so
//! R15.3 to R15.7 hold by construction. It owns the next Person ID after the opening
//! Residents and never changes after Opening_World generation (R15.1).
//!
//! Name, sex, nominal age and the context Soul ID text are the constants of the
//! design's fixed-details table. "Orrin" is in neither first-name list, so the full
//! name differs from every Resident's by construction (R15.10).

use crate::canon::{Canon, CanonWriter};
use crate::events::{CausedBy, EventKind, EventTag, EventTags};
use crate::ids::{InputSeq, PersonId, Tick};
use crate::llm::{FrozenContext, OptionDef, OptionId};
use crate::params::{Params, draw_trait};
use crate::rng::{StreamTag, draw};
use crate::underworld::nodes::{self, NodeFamily, NodeOption, NodeParams, NodePlan, PendingNode};
use crate::underworld::{joss, player};
use crate::values::{Sex, Trait, Traits};
use crate::world::{ConfigError, Life, RejectReason, World};

/// The Magistrate's first name (R15.10).
pub const FIRST_NAME: &str = "Orrin";
/// The Magistrate's surname (R15.10).
pub const SURNAME: &str = "Vell";
/// The Magistrate's full name, one first name and one surname (R15.10).
pub const FULL_NAME: &str = "Orrin Vell";
/// The Magistrate's sex (OP-U1 table).
pub const SEX: Sex = Sex::Male;
/// The Magistrate's nominal age in years, in place of the life-sim lifespan (R15.2).
pub const NOMINAL_AGE: u16 = 600;
/// The card Soul ID text the Context_Builder renders for the Magistrate (R15.12).
pub const SOUL_ID_TEXT: &str = "S-0000";

/// Trait draw sites keyed by the Magistrate's Person ID, in card trait order (OP-U1).
const TRAIT_BASE: u64 = 0;

/// The one fixed official Person (design "Data Models").
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Magistrate {
    /// Its Person ID, `N + 1` for an opening town of `N` Residents (OP-U1 A).
    pub id: PersonId,
    /// The seven Traits, drawn once at tick 0 from `StreamTag::Traits` (R15.1).
    pub traits: Traits,
}

impl Magistrate {
    /// The value a fresh [`World`] literal starts with. Opening_World generation always
    /// replaces it through [`create`] before it returns, so no caller ever sees it.
    pub(crate) fn vacant() -> Self {
        Self {
            id: PersonId(0),
            traits: Traits {
                greed: Trait::clamped(0),
                loyalty: Trait::clamped(0),
                pride: Trait::clamped(0),
                warmth: Trait::clamped(0),
                temper: Trait::clamped(0),
                vindictiveness: Trait::clamped(0),
                piety: Trait::clamped(0),
            },
        }
    }

    /// The seven traits of `id` at tick 0 (R15.1): one shared weighted draw per trait,
    /// keyed by the Magistrate's Person ID, in card trait order.
    fn draw_traits(seed: u64, id: PersonId) -> Traits {
        let trait_at = |index: u64| {
            draw_trait(draw(
                seed,
                id.rng_key(),
                StreamTag::Traits,
                crate::ids::Tick(0),
                TRAIT_BASE.saturating_add(index),
            ))
        };
        Traits {
            greed: trait_at(0),
            loyalty: trait_at(1),
            pride: trait_at(2),
            warmth: trait_at(3),
            temper: trait_at(4),
            vindictiveness: trait_at(5),
            piety: trait_at(6),
        }
    }
}

/// Creates the Magistrate at the end of Opening_World generation with the next Person
/// ID (`N + 1`) and its fixed details (R15.1, OP-U1 A).
pub(crate) fn create(world: &mut World) -> Result<(), ConfigError> {
    let id = PersonId(
        world
            .person_ids
            .next()
            .map_err(|_| ConfigError::Generation("person id counter exhausted"))?,
    );
    world.magistrate = Magistrate {
        id,
        traits: Magistrate::draw_traits(world.seed, id),
    };
    Ok(())
}

impl Canon for Magistrate {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self { id, traits } = self;
        id.encode(w);
        traits.encode(w);
    }
}

/// The `magistrate_ruling` option set: exactly these three, in this order (R6.3).
pub const RULING_OPTIONS: [NodeOption; 3] = [
    NodeOption::GrantNextSlot,
    NodeOption::GrantLaterSlot,
    NodeOption::Deny,
];

/// Applies one `Bribe` input in step 2a (design "Inputs", rejection table order).
///
/// `no_ghost`, `not_waiting`, `bad_amount`, `insufficient_joss` and `node_pending` are
/// checked in that order (R6.2). A valid Bribe appends the `offering` Event to the
/// Magistrate (tagged `joss_paper` and `private`), spends the amount attributed to it,
/// appends the `appeal` Event and fires the ruling node (R6.1). No money comes back on
/// a `deny` (R6.7).
pub(crate) fn apply(world: &mut World, trigger: InputSeq, amount: u64) -> Result<(), RejectReason> {
    player::require_waiting(world)?;
    let Some(ghost) = world.player_wait.as_ref().map(|wait| wait.ghost) else {
        return Err(RejectReason::NotWaiting);
    };
    if amount == 0 {
        return Err(RejectReason::BadAmount);
    }
    let player_soul = world.souls.player;
    let account = world.joss.get(&player_soul).copied().unwrap_or_default();
    if amount > account.balance {
        return Err(RejectReason::InsufficientJoss);
    }
    if ruling_pending(world) {
        return Err(RejectReason::NodePending);
    }
    let magistrate = world.magistrate.id;
    let mut tags = EventTags::empty();
    tags.insert(EventTag::JossPaper);
    tags.insert(EventTag::Private);
    if world
        .append(
            EventKind::BribeOffering {
                ghost,
                magistrate,
                amount,
            },
            CausedBy::default(),
            tags,
        )
        .is_err()
    {
        return Err(RejectReason::IdExhausted);
    }
    if let Some(account) = world.joss.get_mut(&player_soul) {
        let spent = joss::spend(account, amount);
        debug_assert!(spent, "the balance was checked against the amount");
    }
    if world
        .append(
            EventKind::Appeal { ghost, magistrate },
            CausedBy::default(),
            EventTags::empty(),
        )
        .is_err()
    {
        return Err(RejectReason::IdExhausted);
    }
    let plan = plan(world, ghost, amount);
    nodes::fire(world, trigger, plan);
    Ok(())
}

/// Whether a `magistrate_ruling` node for the Player_Soul is pending in this tick
/// (R6.2). Pending nodes live only inside their firing tick (OP-U11 A).
fn ruling_pending(world: &World) -> bool {
    let magistrate = world.magistrate.id;
    world.nodes.pending.values().any(|pending| {
        pending.family == NodeFamily::MagistrateRuling && pending.subject == magistrate
    })
}

/// The `magistrate_ruling` Rules_Default (design "Rules_Default formulas", R6.4).
///
/// `amount` is the `magnitude` of the Bribe's `offering` Event and the traits are the
/// Magistrate's. `v = amount * (4 + greed)` never decreases in `amount`, and both
/// thresholds ignore `amount`, so a larger Bribe is never ruled on worse than a smaller
/// one (R6.5).
pub fn magistrate_default(
    amount: u64,
    traits: &Traits,
    noise_next: i64,
    noise_later: i64,
    params: &Params,
) -> NodeOption {
    let greed = i64::from(traits.greed.get());
    let loyalty = i64::from(traits.loyalty.get());
    let value = i64::try_from(amount)
        .unwrap_or(i64::MAX)
        .saturating_mul(4i64.saturating_add(greed));
    let next_at = threshold(
        params.next_base,
        params.next_per_loyalty,
        loyalty,
        noise_next,
    );
    let later_at = threshold(
        params.later_base,
        params.later_per_loyalty,
        loyalty,
        noise_later,
    );
    if value >= next_at {
        NodeOption::GrantNextSlot
    } else if value >= later_at {
        NodeOption::GrantLaterSlot
    } else {
        NodeOption::Deny
    }
}

/// The World-side Traits of a context Person's card Traits (R6.4).
fn base_traits(card: &crate::llm::Traits) -> Traits {
    Traits {
        greed: Trait::clamped(card.greed),
        loyalty: Trait::clamped(card.loyalty),
        pride: Trait::clamped(card.pride),
        warmth: Trait::clamped(card.warmth),
        temper: Trait::clamped(card.temper),
        vindictiveness: Trait::clamped(card.vindictiveness),
        piety: Trait::clamped(card.piety),
    }
}

/// The seven neutral Traits, for a context that does not list its own subject.
fn zero_traits() -> Traits {
    Traits {
        greed: Trait::clamped(0),
        loyalty: Trait::clamped(0),
        pride: Trait::clamped(0),
        warmth: Trait::clamped(0),
        temper: Trait::clamped(0),
        vindictiveness: Trait::clamped(0),
        piety: Trait::clamped(0),
    }
}

/// One `base + per_loyalty * loyalty + noise` threshold.
fn threshold(base: u64, per_loyalty: u64, loyalty: i64, noise: i64) -> i64 {
    let base = i64::try_from(base).unwrap_or(i64::MAX);
    let per_loyalty = i64::try_from(per_loyalty).unwrap_or(i64::MAX);
    base.saturating_add(per_loyalty.saturating_mul(loyalty))
        .saturating_add(noise)
}

/// The `magistrate_ruling` Rules_Default from the Frozen_Context alone (R3.7): the
/// `magnitude` of the context's `offering` Event that lists the Magistrate, and the
/// Magistrate's traits from the context's people.
pub fn ruling_default(
    context: &FrozenContext,
    noise_next: i64,
    noise_later: i64,
    params: &Params,
) -> NodeOption {
    let subject = context.subject;
    let traits = subject
        .and_then(|id| context.people.iter().find(|person| person.id == id))
        .map_or_else(zero_traits, |person| base_traits(&person.traits));
    let amount = context
        .events
        .iter()
        .rev()
        .find(|event| {
            event.kind == "offering" && subject.is_some_and(|id| event.actors.contains(&id))
        })
        .map_or(0, |event| event.magnitude.max(0).unsigned_abs());
    magistrate_default(amount, &traits, noise_next, noise_later, params)
}

/// Everything `nodes::fire` needs for a ruling node.
fn plan(world: &World, ghost: PersonId, amount: u64) -> NodePlan {
    let magistrate = world.magistrate.id;
    let options = RULING_OPTIONS.to_vec();
    let option_defs = options
        .iter()
        .map(|&option| option_def(option, world, ghost))
        .collect();
    let ghost_name = person_name(world, ghost);
    let death = match world.persons.get(&ghost).map(|person| &person.life) {
        Some(Life::Dead { death }) => death.0,
        _ => world.tick.0,
    };
    let access_from = world
        .player_wait
        .as_ref()
        .map_or(world.tick.0, |wait| wait.access_from.0);
    let later_day = world.tick.0.saturating_add(world.params.grant_later_delay);
    let situation = format!(
        "{ghost_name} died on day {death}. The register lets {ghost_name} claim a newborn \
slot from day {access_from}. {ghost_name} burned {amount} joss paper for the magistrate and \
appeals for an earlier slot. The rules let the magistrate open the register now, open it on \
day {later_day}, or deny."
    );
    NodePlan {
        family: NodeFamily::MagistrateRuling,
        subject: magistrate,
        ghost,
        focus: vec![magistrate, ghost],
        options,
        option_defs,
        situation,
        player_input: None,
        params: NodeParams::Ruling { amount },
    }
}

/// The card definition of one ruling option (fixed English labels, design "Contexts and
/// LS-R15").
fn option_def(option: NodeOption, world: &World, ghost: PersonId) -> OptionDef {
    OptionDef {
        id: OptionId::new(option.id()).expect("a node option id matches the card pattern"),
        label: label(option, world, ghost),
    }
}

/// The fixed label of one ruling option.
fn label(option: NodeOption, world: &World, ghost: PersonId) -> String {
    let ghost_name = person_name(world, ghost);
    let later_day = world.tick.0.saturating_add(world.params.grant_later_delay);
    match option {
        NodeOption::GrantNextSlot => {
            format!("Open the register now and let {ghost_name} claim a newborn slot")
        }
        NodeOption::GrantLaterSlot => {
            format!("Open the register to {ghost_name} on day {later_day}")
        }
        NodeOption::Deny => String::from("Deny the appeal and leave the queue as it stands"),
        _ => String::from(option.id()),
    }
}

/// Applies the ruling at resolution (step 2b) with the R3.11 partial effects: a grant
/// moves `access_from` no later than it was and never earlier than this tick (OP-U6 A);
/// `deny`, or a ruling after the Player_Soul left the queue, changes nothing (R6.6,
/// R6.7).
pub(crate) fn apply_effect(world: &mut World, _node: &PendingNode, applied: NodeOption) {
    let now = world.tick;
    let later = world.params.grant_later_delay;
    let proposed = match applied {
        NodeOption::GrantNextSlot => now,
        NodeOption::GrantLaterSlot => Tick(now.0.saturating_add(later)),
        _ => return,
    };
    let Some(wait) = world.player_wait.as_mut() else {
        return;
    };
    wait.access_from = nodes::clamp_access(now, proposed, wait.access_from);
}

/// The full name of a Person, or `Unknown` for an ID that is not one.
fn person_name(world: &World, id: PersonId) -> String {
    world
        .persons
        .get(&id)
        .map(|person| person.name.text(person.sex))
        .unwrap_or_else(|| String::from("Unknown"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{CausedBy, EventKind, EventTags};
    use crate::ids::{HouseholdId, InputSeq, Tick};
    use crate::input::{InputPayload, TickInput};
    use crate::llm::card::parse_card;
    use crate::names::{FEMALE_FIRST, MALE_FIRST};
    use crate::underworld::slots::SlotRef;
    use crate::world::{AppendRefused, Life, SoulPlace, WorldConfig};

    fn world(seed: u64) -> World {
        World::new(seed, WorldConfig::try_new(40).unwrap()).unwrap()
    }

    fn residents(world: &World) -> Vec<PersonId> {
        world
            .persons()
            .values()
            .filter(|person| matches!(person.life, Life::Alive { .. }))
            .map(|person| person.id)
            .collect()
    }

    #[test]
    fn magistrate_is_created_once_with_fixed_fields() {
        for seed in [0u64, 1, 7, 42, 999] {
            for n in [40u16, 50, 60] {
                let world = World::new(seed, WorldConfig::try_new(n).unwrap()).unwrap();
                let magistrate = world.magistrate();
                let expected_id = PersonId(u64::from(n) + 1);
                assert_eq!(magistrate.id, expected_id, "seed {seed} n {n}");
                assert!(!world.persons().contains_key(&expected_id));
                assert_eq!(
                    magistrate.traits,
                    Magistrate::draw_traits(seed, expected_id),
                    "seed {seed} n {n}"
                );
                for value in [
                    magistrate.traits.greed,
                    magistrate.traits.loyalty,
                    magistrate.traits.pride,
                    magistrate.traits.warmth,
                    magistrate.traits.temper,
                    magistrate.traits.vindictiveness,
                    magistrate.traits.piety,
                ] {
                    assert!((-3..=3).contains(&value.get()));
                }
                assert_eq!(magistrate.id.0, world.person_ids.peek().saturating_sub(1));
            }
        }
        // The fixed details of the design table.
        assert_eq!(FULL_NAME, "Orrin Vell");
        assert_eq!(SEX, Sex::Male);
        assert_eq!(NOMINAL_AGE, 600);
        assert_eq!(SOUL_ID_TEXT, "S-0000");
    }

    #[test]
    fn residents_keep_ids_one_to_n() {
        for n in [40u16, 50, 60] {
            let world = World::new(3, WorldConfig::try_new(n).unwrap()).unwrap();
            let ids: Vec<u64> = residents(&world).iter().map(|id| id.0).collect();
            let expected: Vec<u64> = (1..=u64::from(n)).collect();
            assert_eq!(ids, expected, "n {n}");
            assert_eq!(world.persons().len(), usize::from(n));
        }
    }

    #[test]
    fn the_magistrate_is_in_no_resident_household_or_soul_list() {
        let world = world(5);
        let id = world.magistrate().id;
        assert!(!world.persons().contains_key(&id));
        assert!(!world.households().contains_key(&HouseholdId(id.0)));
        assert!(
            world
                .relations()
                .keys()
                .all(|(from, to)| *from != id && *to != id)
        );
        assert!(
            world
                .debts()
                .values()
                .all(|debt| debt.creditor != id && debt.debtor != id)
        );
        assert!(
            world
                .properties()
                .values()
                .all(|property| property.owner != id)
        );
        // Every Soul still belongs to one Resident body or the queue (R15.6).
        assert_eq!(
            world.souls().places.len(),
            world.persons().len() + usize::try_from(world.params().initial_waiting).unwrap_or(0)
        );
    }

    #[test]
    fn the_magistrate_never_changes_during_a_run() {
        let mut world = world(11);
        let opening = world.magistrate().clone();
        for _ in 0..50 {
            world.step(&[]);
            assert_eq!(world.magistrate(), &opening);
        }
    }

    #[test]
    fn the_magistrates_full_name_differs_from_every_residents() {
        assert!(!MALE_FIRST.contains(&FIRST_NAME));
        assert!(!FEMALE_FIRST.contains(&FIRST_NAME));
        for seed in 0..20u64 {
            let world = world(seed);
            for person in world.persons().values() {
                assert_ne!(person.name.text(person.sex), FULL_NAME, "seed {seed}");
            }
        }
    }

    #[test]
    fn the_magistrate_id_is_accepted_only_as_second_actor_of_appeal_and_bribe() {
        let mut world = world(7);
        let magistrate = world.magistrate().id;
        let ids = residents(&world);
        let resident = ids[0];
        let ghost = ids[1];
        if let Some(person) = world.persons.get_mut(&ghost) {
            person.life = Life::Dead { death: Tick(0) };
        }
        assert!(
            world
                .append(
                    EventKind::Appeal { ghost, magistrate },
                    CausedBy::default(),
                    EventTags::empty()
                )
                .is_ok()
        );
        assert!(
            world
                .append(
                    EventKind::BribeOffering {
                        ghost,
                        magistrate,
                        amount: 1
                    },
                    CausedBy::default(),
                    EventTags::empty()
                )
                .is_ok()
        );
        // First actor: refused.
        assert_eq!(
            world.append(
                EventKind::Appeal {
                    ghost: magistrate,
                    magistrate: resident
                },
                CausedBy::default(),
                EventTags::empty()
            ),
            Err(AppendRefused::UnknownActor)
        );
        assert_eq!(
            world.append(
                EventKind::BribeOffering {
                    ghost: magistrate,
                    magistrate: resident,
                    amount: 1
                },
                CausedBy::default(),
                EventTags::empty()
            ),
            Err(AppendRefused::UnknownActor)
        );
        // Second actor of another kind: refused.
        assert_eq!(
            world.append(
                EventKind::Offering {
                    offerer: resident,
                    ghost: magistrate,
                    amount: 1,
                    credited: 0
                },
                CausedBy::default(),
                EventTags::empty()
            ),
            Err(AppendRefused::UnknownActor)
        );
        assert_eq!(
            world.append(
                EventKind::Dream {
                    ghost: resident,
                    dreamer: magistrate,
                    price: 1
                },
                CausedBy::default(),
                EventTags::empty()
            ),
            Err(AppendRefused::UnknownActor)
        );
        // Only actor of a one-actor kind: refused.
        assert_eq!(
            world.append(
                EventKind::Birth { person: magistrate },
                CausedBy::default(),
                EventTags::empty()
            ),
            Err(AppendRefused::UnknownActor)
        );
    }

    /// A World whose Player_Soul died today and waits with `balance` joss paper.
    fn waiting_world(params: Params, balance: u64) -> (World, PersonId) {
        let mut w = World::new_with_params(3, WorldConfig::try_new(40).unwrap(), params).unwrap();
        let player = w.souls.player;
        let SoulPlace::Body(body) = w.souls.places[&player] else {
            panic!("the Player_Soul starts in a body");
        };
        let tick = w.tick;
        if let Some(person) = w.persons.get_mut(&body) {
            person.life = Life::Dead { death: tick };
        }
        w.souls
            .places
            .insert(player, SoulPlace::Waiting { since: tick });
        player::start_wait(&mut w, player, tick);
        if let Some(account) = w.joss.get_mut(&player) {
            account.balance = balance;
        }
        (w, body)
    }

    fn step(world: &mut World, payloads: &[InputPayload]) {
        let inputs: Vec<TickInput> = payloads
            .iter()
            .enumerate()
            .map(|(index, payload)| TickInput {
                tick: world.tick,
                seq: InputSeq(u64::try_from(index).unwrap()),
                payload: *payload,
            })
            .collect();
        world.step(&inputs);
    }

    /// The last rejection reason of the world, if any.
    fn last_reason(world: &World) -> Option<RejectReason> {
        world.rejections().last.map(|(_, _, reason)| reason)
    }

    /// Whether the log holds an Event of a Bribe: an `offering` to the Magistrate or an
    /// `appeal`.
    fn bribe_events(world: &World) -> usize {
        world
            .log()
            .events()
            .iter()
            .filter(|event| {
                matches!(
                    event.kind,
                    EventKind::BribeOffering { .. } | EventKind::Appeal { .. }
                )
            })
            .count()
    }

    #[test]
    fn magistrate_default_agrees_with_dev_pair_p006() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../eval/cards/cards/dev.jsonl");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        // The pair's two roles and the option each one's default must give.
        let expected: [(&str, NodeOption); 2] = [
            ("D-magistrate_ruling-001", NodeOption::GrantNextSlot),
            ("D-magistrate_ruling-002", NodeOption::Deny),
        ];
        let params = Params::DEFAULT;
        let mut seen: Vec<String> = Vec::new();
        for (line_no, line) in text.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let (meta, context, key, _) =
                parse_card(line, line_no.saturating_add(1)).expect("the card parses");
            let Some((_, want)) = expected.iter().find(|(id, _)| *id == meta.id) else {
                continue;
            };
            seen.push(meta.id.clone());
            for noise_next in -100..=100 {
                for noise_later in -40..=40 {
                    assert_eq!(
                        ruling_default(&context, noise_next, noise_later, &params),
                        *want,
                        "{} at noise {noise_next}/{noise_later}",
                        meta.id
                    );
                }
            }
            // The card grades the default acceptable, and a card-only option has no role.
            let crate::llm::key::AnswerKey::Decision { acceptable, .. } = &key else {
                panic!("{} is a decision card", meta.id);
            };
            assert!(
                acceptable.iter().any(|option| option.as_str() == want.id()),
                "{}: {} is not acceptable",
                meta.id,
                want.id()
            );
            assert!(NodeOption::from_id("strike_from_register").is_none());
        }
        assert_eq!(
            seen.len(),
            expected.len(),
            "both P006 cards were read: {seen:?}"
        );
        // The pair: card a burned 300 joss paper for a greedy magistrate, card b did not.
        assert_eq!(
            magistrate_default(
                300,
                &Traits {
                    greed: Trait::clamped(3),
                    ..zero_traits()
                },
                0,
                0,
                &params
            ),
            NodeOption::GrantNextSlot
        );
        assert_eq!(
            magistrate_default(0, &zero_traits(), 0, 0, &params),
            NodeOption::Deny
        );
    }

    #[test]
    fn a_bribe_appends_the_offering_and_the_appeal_and_fires_the_node() {
        let mut params = Params::DEFAULT;
        params.offer_min_affinity = 101;
        let (mut w, ghost) = waiting_world(params, 500);
        let magistrate = w.magistrate().id;
        step(&mut w, &[InputPayload::Bribe { amount: 120 }]);
        assert!(
            w.nodes().pending.is_empty(),
            "the node resolved in the tick"
        );
        let record = *w.nodes().resolved.last().expect("one record");
        assert_eq!(record.family, NodeFamily::MagistrateRuling);
        assert_eq!(record.subject, magistrate);
        assert_eq!(record.source, nodes::ChoiceSource::RulesDefault);
        assert_eq!(record.applied, record.rules_default);
        assert!(RULING_OPTIONS.contains(&record.applied));
        assert_eq!(bribe_events(&w), 2);
        let player = w.souls.player;
        assert_eq!(w.joss()[&player].balance, 500 - 120);
        assert_eq!(w.player_wait().map(|wait| wait.ghost), Some(ghost));
    }

    #[test]
    fn each_grant_moves_access_as_documented_and_never_later() {
        for (option, want) in [
            (NodeOption::GrantNextSlot, Tick(0)),
            (NodeOption::GrantLaterSlot, Tick(120)),
        ] {
            let (mut w, _ghost) = waiting_world(Params::DEFAULT, 500);
            assert_eq!(w.player_wait().expect("waiting").access_from, Tick(365));
            step(
                &mut w,
                &[
                    InputPayload::Bribe { amount: 100 },
                    InputPayload::Choose {
                        node: nodes::NodeRef::Trigger { seq: InputSeq(0) },
                        option,
                    },
                ],
            );
            assert_eq!(
                w.player_wait().expect("still waiting").access_from,
                want,
                "{option:?}"
            );
            let record = *w.nodes().resolved.last().expect("one record");
            assert_eq!(record.applied, option);
            assert_eq!(record.source, nodes::ChoiceSource::External);
        }
        // A grant never moves access later than it already is.
        let mut params = Params::DEFAULT;
        params.register_wait = 1;
        let (mut w, _ghost) = waiting_world(params, 500);
        assert_eq!(w.player_wait().expect("waiting").access_from, Tick(1));
        step(
            &mut w,
            &[
                InputPayload::Bribe { amount: 100 },
                InputPayload::Choose {
                    node: nodes::NodeRef::Trigger { seq: InputSeq(0) },
                    option: NodeOption::GrantLaterSlot,
                },
            ],
        );
        assert_eq!(
            w.player_wait().expect("still waiting").access_from,
            Tick(1),
            "access_from never moves later"
        );
    }

    #[test]
    fn a_standing_claim_after_a_bribe_skips_the_effect_and_keeps_the_record() {
        let mut params = Params::DEFAULT;
        params.offer_min_affinity = 101;
        let (mut w, _ghost) = waiting_world(params, 500);
        step(
            &mut w,
            &[
                InputPayload::Bribe { amount: 100 },
                InputPayload::ClaimSlot {
                    slot: SlotRef::ImportedVessel,
                },
            ],
        );
        assert!(w.player_wait().is_none(), "the claim left the queue");
        assert!(w.nodes().pending.is_empty());
        let record = *w.nodes().resolved.last().expect("one record");
        assert_eq!(record.family, NodeFamily::MagistrateRuling);
        assert_eq!(record.tick, Tick(0));
        assert!(record.applied == record.rules_default);
        let player = w.souls.player;
        assert_eq!(w.joss()[&player].balance, 500 - 100 - 100);
        assert!(w.log().events().iter().any(
            |event| matches!(event.kind, EventKind::Possession { price, .. } if price == 100)
        ));
    }

    #[test]
    fn a_bribe_with_bad_amount_or_too_little_joss_appends_nothing() {
        let mut params = Params::DEFAULT;
        params.offer_min_affinity = 101;
        let (mut w, _ghost) = waiting_world(params, 50);
        step(&mut w, &[InputPayload::Bribe { amount: 0 }]);
        assert_eq!(last_reason(&w), Some(RejectReason::BadAmount));
        assert_eq!(bribe_events(&w), 0);
        step(&mut w, &[InputPayload::Bribe { amount: 51 }]);
        assert_eq!(last_reason(&w), Some(RejectReason::InsufficientJoss));
        assert_eq!(bribe_events(&w), 0);
        assert_eq!(w.joss()[&w.souls.player].balance, 50);
        assert!(w.nodes().resolved.is_empty());
    }

    #[test]
    fn a_bribe_without_a_ghost_is_rejected_no_ghost() {
        let mut w = world(3);
        step(&mut w, &[InputPayload::Bribe { amount: 10 }]);
        assert_eq!(last_reason(&w), Some(RejectReason::NoGhost));
        assert_eq!(bribe_events(&w), 0);
    }
}
