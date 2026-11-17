//! Player-facing Narrator state and its two fixed tick steps.
//!
//! Pattern production is introduced in task 2.1. Until then `run` updates the
//! player-life clock, while `resolve` handles a pending node from a constructed
//! World without changing the same-tick underworld node lifecycle.

pub mod chronicle;

use crate::canon::{Canon, CanonWriter};
use crate::events::{CausedBy, EventTags};
use crate::ids::{EventId, NodeId, PersonId, Tick};
use crate::input::RejectReason;
use crate::underworld::carry_over::TraitName;
use crate::values::{Intensity, SocialKind, Trait};
use crate::world::{Life, SoulPlace, World};

pub use chronicle::{Chronicle, ChronicleEntry, EntrySource, SkipReason};

macro_rules! closed_enum {
    ($name:ident { $($variant:ident => ($tag:literal, $label:literal)),+ $(,)? }) => {
        #[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd, Debug)]
        pub enum $name { $($variant),+ }
        impl $name {
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];
            pub const fn label(self) -> &'static str {
                match self { $(Self::$variant => $label),+ }
            }
        }
        impl Canon for $name {
            fn encode<W: CanonWriter>(&self, w: &mut W) {
                let tag: u8 = match self { $(Self::$variant => $tag),+ };
                tag.encode(w);
            }
        }
    };
}

closed_enum!(PlayerFamily {
    FamilyDeath => (0, "family_death"), Inheritance => (1, "inheritance"),
    DebtDue => (2, "debt_due"), Feud => (3, "feud"), LifeStage => (4, "life_stage"),
});
closed_enum!(PlayerOption {
    ComfortMourner => (0, "comfort_mourner"), SendFlowers => (1, "send_flowers"),
    StayAway => (2, "stay_away"), KeepIt => (3, "keep_it"),
    ThankFamily => (4, "thank_family"), PayDebts => (5, "pay_debts"),
    RepayNow => (6, "repay_now"), AskForTime => (7, "ask_for_time"),
    IgnoreIt => (8, "ignore_it"), DemandPayment => (9, "demand_payment"),
    ForgiveDebt => (10, "forgive_debt"), WaitItOut => (11, "wait_it_out"),
    Apologize => (12, "apologize"), Retaliate => (13, "retaliate"),
    LetItGo => (14, "let_it_go"), AskForAToy => (15, "ask_for_a_toy"),
    VisitGrandparents => (16, "visit_grandparents"), AskForNothing => (17, "ask_for_nothing"),
    StandUpToBully => (18, "stand_up_to_bully"), TellATeacher => (19, "tell_a_teacher"),
    KeepQuiet => (20, "keep_quiet"), GetAJob => (21, "get_a_job"),
    HelpAtHome => (22, "help_at_home"), TendTheShrine => (23, "tend_the_shrine"),
});
closed_enum!(StakeUnit {
    Money => (0, "money"), JossPaper => (1, "joss_paper"),
    Affinity => (2, "affinity"), TraitPoints => (3, "trait_points"),
});

#[derive(Clone, Eq, PartialEq, Debug)]
pub enum PreviewWhat {
    Money,
    Debt,
    Affinity,
    Trait(TraitName),
}
impl Canon for PreviewWhat {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        match self {
            Self::Money => 0u8.encode(w),
            Self::Debt => 1u8.encode(w),
            Self::Affinity => 2u8.encode(w),
            Self::Trait(name) => {
                3u8.encode(w);
                name.encode(w);
            }
        }
    }
}
impl PreviewWhat {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Money => "money",
            Self::Debt => "debt",
            Self::Affinity => "affinity",
            Self::Trait(TraitName::Greed) => "trait:greed",
            Self::Trait(TraitName::Loyalty) => "trait:loyalty",
            Self::Trait(TraitName::Pride) => "trait:pride",
            Self::Trait(TraitName::Warmth) => "trait:warmth",
            Self::Trait(TraitName::Temper) => "trait:temper",
            Self::Trait(TraitName::Vindictiveness) => "trait:vindictiveness",
            Self::Trait(TraitName::Piety) => "trait:piety",
        }
    }
}

#[derive(Clone, Eq, PartialEq, Debug)]
pub struct Stakes {
    pub who: Vec<PersonId>,
    pub amount: i64,
    pub unit: StakeUnit,
    pub by: Tick,
}
impl Canon for Stakes {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            who,
            amount,
            unit,
            by,
        } = self;
        who.encode(w);
        amount.encode(w);
        unit.encode(w);
        by.encode(w);
    }
}

#[derive(Clone, Eq, PartialEq, Debug)]
pub struct PreviewEntry {
    pub person: PersonId,
    pub what: PreviewWhat,
    pub delta: i64,
}
impl Canon for PreviewEntry {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            person,
            what,
            delta,
        } = self;
        person.encode(w);
        what.encode(w);
        delta.encode(w);
    }
}

#[derive(Clone, Eq, PartialEq, Debug)]
pub enum EffectPart {
    Social {
        kind: SocialKind,
        doer: PersonId,
        target: PersonId,
        intensity: Intensity,
    },
    Repay {
        loan: EventId,
        amount: u64,
    },
    Forgive {
        loan: EventId,
    },
    Trait {
        person: PersonId,
        name: TraitName,
        delta: i8,
    },
}
impl Canon for EffectPart {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        match self {
            Self::Social {
                kind,
                doer,
                target,
                intensity,
            } => {
                0u8.encode(w);
                kind.encode(w);
                doer.encode(w);
                target.encode(w);
                intensity.encode(w);
            }
            Self::Repay { loan, amount } => {
                1u8.encode(w);
                loan.encode(w);
                amount.encode(w);
            }
            Self::Forgive { loan } => {
                2u8.encode(w);
                loan.encode(w);
            }
            Self::Trait {
                person,
                name,
                delta,
            } => {
                3u8.encode(w);
                person.encode(w);
                name.encode(w);
                delta.encode(w);
            }
        }
    }
}

impl EffectPart {
    /// Check each target immediately before applying a part; no previous part is rolled back.
    pub fn check(&self, world: &World, chooser: PersonId) -> Result<(), SkipReason> {
        match *self {
            Self::Social { doer, target, .. } => {
                let a = world.persons.get(&doer).ok_or(SkipReason::MissingPerson)?;
                let b = world
                    .persons
                    .get(&target)
                    .ok_or(SkipReason::MissingPerson)?;
                if doer == target {
                    return Err(SkipReason::AlreadyApplied);
                }
                if !matches!(a.life, Life::Alive { .. }) || !matches!(b.life, Life::Alive { .. }) {
                    return Err(SkipReason::DeadPerson);
                }
            }
            Self::Repay { loan, amount } => {
                let debt = world.debts.get(&loan).ok_or(SkipReason::MissingDebt)?;
                if debt.open == 0 {
                    return Err(SkipReason::DebtNotOpen);
                }
                if debt.debtor != chooser {
                    return Err(SkipReason::WrongDebtor);
                }
                let person = world
                    .persons
                    .get(&chooser)
                    .ok_or(SkipReason::MissingPerson)?;
                let Life::Alive { money, .. } = person.life else {
                    return Err(SkipReason::DeadPerson);
                };
                if money < amount {
                    return Err(SkipReason::InsufficientMoney);
                }
                if amount == 0 || amount > debt.open {
                    return Err(SkipReason::OutOfBounds);
                }
            }
            Self::Forgive { loan } => {
                let debt = world.debts.get(&loan).ok_or(SkipReason::MissingDebt)?;
                if debt.open == 0 {
                    return Err(SkipReason::DebtNotOpen);
                }
                if debt.creditor != chooser {
                    return Err(SkipReason::WrongDebtor);
                }
            }
            Self::Trait { person, delta, .. } => {
                let person = world
                    .persons
                    .get(&person)
                    .ok_or(SkipReason::MissingPerson)?;
                if !matches!(person.life, Life::Alive { .. }) {
                    return Err(SkipReason::DeadPerson);
                }
                if !(-1..=1).contains(&delta) {
                    return Err(SkipReason::OutOfBounds);
                }
            }
        }
        Ok(())
    }

    fn names(&self, person: PersonId) -> bool {
        match self {
            Self::Social { doer, target, .. } => *doer == person || *target == person,
            Self::Trait { person: target, .. } => *target == person,
            // The debtor/creditor is read from the loan at application time.
            Self::Repay { .. } | Self::Forgive { .. } => true,
        }
    }

    fn apply_non_repay(
        &self,
        world: &mut World,
        trigger: Option<EventId>,
    ) -> Result<Vec<EventId>, SkipReason> {
        let cause = CausedBy::new(trigger.into_iter().collect());
        match self {
            Self::Social {
                kind,
                doer,
                target,
                intensity,
            } => crate::social::apply_social(world, *kind, *doer, *target, *intensity, cause)
                .map(|id| vec![id])
                .map_err(|_| SkipReason::OutOfBounds),
            Self::Forgive { loan } => {
                let debt = world
                    .debts
                    .get(loan)
                    .ok_or(SkipReason::MissingDebt)?
                    .clone();
                let id = world
                    .append(
                        crate::events::EventKind::DebtForgiven {
                            creditor: debt.creditor,
                            debtor: debt.debtor,
                            amount: debt.open,
                        },
                        CausedBy::new(vec![*loan].into_iter().chain(trigger).collect()),
                        EventTags::empty(),
                    )
                    .map_err(|_| SkipReason::OutOfBounds)?;
                world.debts.remove(loan);
                Ok(vec![id])
            }
            Self::Trait {
                person,
                name,
                delta,
            } => {
                let traits = &mut world
                    .persons
                    .get_mut(person)
                    .ok_or(SkipReason::MissingPerson)?
                    .traits;
                let field = match name {
                    TraitName::Greed => &mut traits.greed,
                    TraitName::Loyalty => &mut traits.loyalty,
                    TraitName::Pride => &mut traits.pride,
                    TraitName::Warmth => &mut traits.warmth,
                    TraitName::Temper => &mut traits.temper,
                    TraitName::Vindictiveness => &mut traits.vindictiveness,
                    TraitName::Piety => &mut traits.piety,
                };
                *field = Trait::clamped(i64::from(field.get()).saturating_add(i64::from(*delta)));
                Ok(Vec::new())
            }
            Self::Repay { .. } => unreachable!("Repay effects are wired by task 2.1"),
        }
    }
}
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct PlannedOption {
    pub id: PlayerOption,
    pub parts: Vec<EffectPart>,
    pub preview: Vec<PreviewEntry>,
}
impl Canon for PlannedOption {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self { id, parts, preview } = self;
        id.encode(w);
        parts.encode(w);
        preview.encode(w);
    }
}

#[derive(Clone, Eq, PartialEq, Debug)]
pub struct PlayerNode {
    pub id: NodeId,
    pub family: PlayerFamily,
    pub chooser: PersonId,
    pub fired: Tick,
    pub stakes: Stakes,
    pub options: Vec<PlannedOption>,
    pub rules_default: PlayerOption,
    pub external: Option<PlayerOption>,
    pub trigger: Option<EventId>,
}
impl Canon for PlayerNode {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            id,
            family,
            chooser,
            fired,
            stakes,
            options,
            rules_default,
            external,
            trigger,
        } = self;
        id.encode(w);
        family.encode(w);
        chooser.encode(w);
        fired.encode(w);
        stakes.encode(w);
        options.encode(w);
        rules_default.encode(w);
        external.encode(w);
        trigger.encode(w);
    }
}

#[derive(Clone, Eq, PartialEq, Debug)]
pub struct PlayerLife {
    pub body: PersonId,
    pub start: Tick,
    pub first_fire: Option<Tick>,
    pub last_fire: Option<Tick>,
}
impl Canon for PlayerLife {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            body,
            start,
            first_fire,
            last_fire,
        } = self;
        body.encode(w);
        start.encode(w);
        first_fire.encode(w);
        last_fire.encode(w);
    }
}

#[derive(Clone, Eq, PartialEq, Debug, Default)]
pub struct Narrator {
    pub pending: Option<PlayerNode>,
    pub chronicle: Chronicle,
    pub life: Option<PlayerLife>,
}
impl Canon for Narrator {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            pending,
            chronicle,
            life,
        } = self;
        pending.encode(w);
        chronicle.encode(w);
        life.encode(w);
    }
}

pub(crate) fn attach_choice(
    world: &mut World,
    node: NodeId,
    option: PlayerOption,
) -> Result<(), RejectReason> {
    let pending = world
        .narrator
        .pending
        .as_mut()
        .filter(|pending| {
            pending.id == node && pending.fired.0.checked_add(1) == Some(world.tick.0)
        })
        .ok_or(RejectReason::UnknownNode)?;
    if !pending.options.iter().any(|planned| planned.id == option) {
        return Err(RejectReason::OptionNotInSet);
    }
    if pending.external.is_some() {
        return Err(RejectReason::AlreadyChosen);
    }
    pending.external = Some(option);
    Ok(())
}

pub(crate) fn resolve(world: &mut World) {
    let Some(node) = world.narrator.pending.take() else {
        return;
    };
    if node.fired.0.checked_add(1) != Some(world.tick.0) {
        world.narrator.pending = Some(node);
        return;
    }
    let chooser_absent = !world
        .persons
        .get(&node.chooser)
        .is_some_and(|person| matches!(person.life, Life::Alive { .. }));
    let (applied, source) = if chooser_absent || node.external.is_none() {
        (node.rules_default, EntrySource::RulesDefault)
    } else {
        (
            node.external.unwrap_or(node.rules_default),
            EntrySource::External,
        )
    };
    let mut skipped = Vec::new();
    let mut appended = Vec::new();
    if let Some(option) = node.options.iter().find(|option| option.id == applied) {
        for (index, part) in option.parts.iter().enumerate() {
            let result = if chooser_absent && part.names(node.chooser) {
                Err(SkipReason::DeadPerson)
            } else {
                part.check(world, node.chooser).and_then(|()| {
                    if matches!(part, EffectPart::Repay { .. }) {
                        unreachable!("Repay effects are wired by task 2.1")
                    }
                    part.apply_non_repay(world, node.trigger)
                })
            };
            match result {
                Ok(events) => appended.extend(events),
                Err(reason) => skipped.push((
                    u8::try_from(index).expect("node has at most five effect parts"),
                    reason,
                )),
            }
        }
    }
    world.narrator.chronicle.push(ChronicleEntry {
        tick: world.tick,
        family: node.family,
        node: Some(node.id),
        stakes: node.stakes,
        applied,
        source,
        chooser_absent,
        skipped,
        appended,
    });
}

pub(crate) fn run(world: &mut World) {
    let Some(SoulPlace::Body(body)) = world.souls.places.get(&world.souls.player).copied() else {
        return;
    };
    if world
        .narrator
        .life
        .as_ref()
        .is_none_or(|life| life.body != body)
    {
        world.narrator.life = Some(PlayerLife {
            body,
            start: world.tick,
            first_fire: None,
            last_fire: None,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::WorldConfig;

    #[test]
    fn repay_check_only_validates_the_open_debt_and_never_applies_a_payment() {
        let mut world = World::new(1, WorldConfig::default()).unwrap();
        let (&loan, debt) = world.debts.iter().next().expect("opening loan");
        let debtor = debt.debtor;
        let creditor = debt.creditor;
        let open = debt.open;
        let money = match world.persons[&debtor].life {
            Life::Alive { money, .. } => money,
            Life::Dead { .. } => panic!("opening debtor must be alive"),
        };
        let amount = open.min(money);
        assert!(amount > 0, "opening debtor must afford at least one dollar");
        let before = world.clone();
        assert_eq!(
            (EffectPart::Repay { loan, amount }).check(&world, debtor),
            Ok(())
        );
        assert_eq!(world, before, "checking cannot transfer or append");
        assert_eq!(
            (EffectPart::Repay { loan, amount }).check(&world, creditor),
            Err(SkipReason::WrongDebtor)
        );
        assert_eq!(
            (EffectPart::Repay { loan, amount: 0 }).check(&world, debtor),
            Err(SkipReason::OutOfBounds)
        );
        assert_eq!(
            (EffectPart::Repay {
                loan,
                amount: open + 1,
            })
            .check(&world, debtor),
            Err(if money <= open {
                SkipReason::InsufficientMoney
            } else {
                SkipReason::OutOfBounds
            })
        );
        world.debts.remove(&loan);
        assert_eq!(
            (EffectPart::Repay { loan, amount }).check(&world, debtor),
            Err(SkipReason::MissingDebt)
        );
    }

    #[test]
    fn constructed_player_node_resolves_once_after_choice_tick_input() {
        use crate::ids::InputSeq;
        use crate::input::{InputPayload, TickInput};

        let mut world = World::new(1, WorldConfig::default()).unwrap();
        let SoulPlace::Body(chooser) = world.souls.places[&world.souls.player] else {
            panic!("opening player has a body");
        };
        let option = |id| PlannedOption {
            id,
            parts: Vec::new(),
            preview: Vec::new(),
        };
        world.narrator.pending = Some(PlayerNode {
            id: NodeId(1_000),
            family: PlayerFamily::DebtDue,
            chooser,
            fired: Tick(0),
            stakes: Stakes {
                who: vec![chooser],
                amount: 1,
                unit: StakeUnit::Money,
                by: Tick(1),
            },
            options: vec![
                option(PlayerOption::AskForTime),
                option(PlayerOption::IgnoreIt),
            ],
            rules_default: PlayerOption::IgnoreIt,
            external: None,
            trigger: None,
        });
        assert_eq!(
            attach_choice(&mut world, NodeId(1_000), PlayerOption::AskForTime),
            Err(RejectReason::UnknownNode),
            "the firing tick is not the Choice_Tick"
        );
        world.tick = Tick(1);
        let chosen = PlayerOption::AskForTime;
        let (checksum, outcomes) = world.step_with_outcomes(&[TickInput {
            tick: Tick(1),
            seq: InputSeq(0),
            payload: InputPayload::ChoosePlayer {
                node: NodeId(1_000),
                option: chosen,
            },
        }]);
        assert_ne!(checksum.0, 0);
        assert_eq!(outcomes[0].result, Ok(()));
        assert!(world.narrator.pending.is_none());
        assert_eq!(world.narrator.chronicle.entries().len(), 1);
        let entry = &world.narrator.chronicle.entries()[0];
        assert_eq!(
            (entry.tick, entry.applied, entry.source),
            (Tick(1), chosen, EntrySource::External)
        );
        assert!(entry.skipped.is_empty());
        assert_eq!(
            world.narrator.chronicle.digest(),
            world.narrator.chronicle.recompute_digest()
        );
    }
}
