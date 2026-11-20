//! Player-facing Narrator state, five pattern families and the fixed tick steps.

pub mod chronicle;
pub(crate) mod options;
pub(crate) mod patterns;
pub(crate) mod salience;

use crate::canon::{Canon, CanonWriter};
use crate::events::{CausedBy, Event};
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

    fn apply(
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
            Self::Forgive { loan } => crate::death::forgive_debt(
                world,
                *loan,
                CausedBy::new(vec![*loan].into_iter().chain(trigger).collect()),
            )
            .map(|id| vec![id])
            .map_err(|_| SkipReason::OutOfBounds),
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
            Self::Repay { loan, amount } => crate::economy::repay(world, *loan, *amount, trigger)
                .map(|id| vec![id])
                .ok_or(SkipReason::OutOfBounds),
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

/// A social Event crossing the feud threshold during this tick, never encoded.
#[derive(Clone, Eq, PartialEq, Debug)]
pub(crate) struct Crossing {
    pub event: EventId,
    pub from: PersonId,
    pub to: PersonId,
}

/// Candidate assembled at step 13a before the interrupt budget selects one.
pub(crate) struct Candidate {
    pub family: PlayerFamily,
    pub chooser: PersonId,
    pub trigger: Option<EventId>,
    pub key: u64,
    pub stakes: Stakes,
    pub options: Vec<PlannedOption>,
    pub rules_default: PlayerOption,
    pub salience: i64,
}

#[derive(Clone, Eq, PartialEq, Debug, Default)]
pub struct Narrator {
    pub pending: Option<PlayerNode>,
    pub chronicle: Chronicle,
    pub life: Option<PlayerLife>,
    pub(crate) crossings: Vec<Crossing>,
}
impl Canon for Narrator {
    fn encode<W: CanonWriter>(&self, w: &mut W) {
        let Self {
            pending,
            chronicle,
            life,
            crossings: _,
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

/// Apply each part independently against the live World and record invalid parts.
fn apply_parts(
    world: &mut World,
    option: &PlannedOption,
    chooser: PersonId,
    trigger: Option<EventId>,
    chooser_absent: bool,
) -> (Vec<(u8, SkipReason)>, Vec<EventId>) {
    let mut skipped = Vec::new();
    let mut appended = Vec::new();
    for (index, part) in option.parts.iter().enumerate() {
        let result = if chooser_absent && part.names(chooser) {
            Err(SkipReason::DeadPerson)
        } else {
            part.check(world, chooser)
                .and_then(|()| part.apply(world, trigger))
        };
        match result {
            Ok(events) => appended.extend(events),
            Err(reason) => skipped.push((
                u8::try_from(index).expect("node has at most five effect parts"),
                reason,
            )),
        }
    }
    (skipped, appended)
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
    let (skipped, appended) = node
        .options
        .iter()
        .find(|option| option.id == applied)
        .map(|option| apply_parts(world, option, node.chooser, node.trigger, chooser_absent))
        .unwrap_or_default();
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

/// Put the eligible designated Intro_Debt ahead of ordinary candidates during Grace.
fn order_candidates(candidates: &mut Vec<Candidate>, intro_loan: Option<EventId>) {
    candidates.sort_by_key(|candidate| {
        (
            std::cmp::Reverse(candidate.salience),
            (
                u8::from(candidate.trigger.is_none()),
                candidate.trigger.map_or(0, |id| id.0),
            ),
            candidate.family as u8,
            candidate.key,
        )
    });
    if let Some(loan) = intro_loan
        && let Some(index) = candidates.iter().position(|candidate| {
            candidate.family == PlayerFamily::DebtDue && candidate.key == loan.0
        })
    {
        let designated = candidates.remove(index);
        candidates.insert(0, designated);
    }
}

#[cfg(test)]
mod ordering_tests {
    use super::*;
    use crate::world::WorldConfig;
    use proptest::prelude::*;

    fn candidate(
        family: PlayerFamily,
        key: u64,
        trigger: Option<EventId>,
        salience: i64,
    ) -> Candidate {
        Candidate {
            family,
            chooser: PersonId(1),
            trigger,
            key,
            salience,
            stakes: Stakes {
                who: vec![PersonId(1)],
                amount: 1,
                unit: StakeUnit::Money,
                by: Tick(1),
            },
            options: vec![
                PlannedOption {
                    id: PlayerOption::KeepIt,
                    parts: vec![],
                    preview: vec![],
                },
                PlannedOption {
                    id: PlayerOption::ThankFamily,
                    parts: vec![],
                    preview: vec![PreviewEntry {
                        person: PersonId(1),
                        what: PreviewWhat::Affinity,
                        delta: 1,
                    }],
                },
            ],
            rules_default: PlayerOption::KeepIt,
        }
    }

    #[test]
    fn ordinary_sort_puts_defensible_competitor_before_intro_debt() {
        let loan = EventId(2);
        let intro = candidate(PlayerFamily::DebtDue, loan.0, None, 40);
        let competitor = candidate(PlayerFamily::Inheritance, 3, Some(EventId(3)), 80);
        assert_ne!(intro.options[0].preview, intro.options[1].preview);
        assert_ne!(competitor.options[0].preview, competitor.options[1].preview);

        let mut ordinary = vec![intro, competitor];
        order_candidates(&mut ordinary, None);
        assert_eq!(ordinary[0].family, PlayerFamily::Inheritance);

        let mut prioritized = vec![
            candidate(PlayerFamily::DebtDue, loan.0, None, 40),
            candidate(PlayerFamily::Inheritance, 3, Some(EventId(3)), 80),
        ];
        order_candidates(&mut prioritized, Some(loan));
        assert_eq!(prioritized[0].family, PlayerFamily::DebtDue);
        assert_eq!(prioritized[0].key, loan.0);
    }

    // Feature: first-playable, Property 6: Ordering and selection follow the budget rule
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn ordered_salience_events_clocks_and_intro_priority(
            a in 30i64..200, b in 30i64..200, c in 30i64..200,
            id in 1u64..10_000,
        ) {
            let event_a = candidate(PlayerFamily::Inheritance, id, Some(EventId(id)), a);
            let event_b = candidate(PlayerFamily::FamilyDeath, id.saturating_add(1), Some(EventId(id.saturating_add(1))), b);
            let clock = candidate(PlayerFamily::DebtDue, id.saturating_add(2), None, c);
            let mut list = vec![clock, event_b, event_a];
            order_candidates(&mut list, None);
            let expected = |candidate: &Candidate| (
                std::cmp::Reverse(candidate.salience),
                (u8::from(candidate.trigger.is_none()), candidate.trigger.map_or(0, |event| event.0)),
                candidate.family as u8, candidate.key,
            );
            prop_assert!(list.windows(2).all(|pair| expected(&pair[0]) <= expected(&pair[1])));
            order_candidates(&mut list, Some(EventId(id.saturating_add(2))));
            prop_assert_eq!(list[0].family, PlayerFamily::DebtDue);
            prop_assert_eq!(list[0].key, id.saturating_add(2));
            prop_assert!(list[1..].windows(2).all(|pair| expected(&pair[0]) <= expected(&pair[1])));
        }

        #[test]
        fn first_fire_is_a_lower_bound(first_min in 1u64..900) {
            let mut world = World::new(17, WorldConfig::default()).unwrap();
            let body = match world.souls.places[&world.souls.player] {
                SoulPlace::Body(body) => body,
                _ => unreachable!(),
            };
            let other = world.persons.keys().copied().find(|id| *id != body).unwrap();
            let due = Tick(first_min.saturating_add(world.params.debt_due_lead));
            let loan = world.append(crate::events::EventKind::Loan {
                lender: other, borrower: body, amount: 100, due,
            }, CausedBy::default(), crate::events::EventTags::empty()).unwrap();
            world.debts.insert(loan, crate::world::Debt { creditor: other, debtor: body,
                principal: 100, open: 100, due });
            world.params.first_interrupt_min = first_min;
            world.tick = Tick(first_min.saturating_sub(1));
            world.narrator.life = Some(PlayerLife { body, start: Tick(0), first_fire: None, last_fire: None });
            run(&mut world);
            prop_assert!(world.narrator.pending.is_none());
            world.tick = Tick(first_min);
            run(&mut world);
            prop_assert_eq!(world.narrator.pending.as_ref().map(|node| node.family), Some(PlayerFamily::DebtDue));
            prop_assert_eq!(world.narrator.life.as_ref().unwrap().last_fire, Some(Tick(first_min)));
        }

        #[test]
        fn gap_blocks_then_allows_an_open_debt(gap in 2u64..900) {
            let mut world = World::new(17, WorldConfig::default()).unwrap();
            let SoulPlace::Body(body) = world.souls.places[&world.souls.player] else { unreachable!() };
            let other = world.persons.keys().copied().find(|id| *id != body).unwrap();
            let due = Tick(gap.saturating_add(world.params.debt_due_lead).saturating_sub(1));
            let loan = world.append(crate::events::EventKind::Loan {
                lender: other, borrower: body, amount: 100, due,
            }, CausedBy::default(), crate::events::EventTags::empty()).unwrap();
            world.debts.insert(loan, crate::world::Debt { creditor: other, debtor: body,
                principal: 100, open: 100, due });
            world.params.interrupt_gap_min = gap;
            world.tick = Tick(gap.saturating_sub(1));
            world.narrator.life = Some(PlayerLife { body, start: Tick(0), first_fire: Some(Tick(0)), last_fire: Some(Tick(0)) });
            run(&mut world);
            prop_assert!(world.narrator.pending.is_none());
            prop_assert!(world.narrator.chronicle.entries().iter().any(|entry|
                entry.family == PlayerFamily::DebtDue && entry.source == EntrySource::AutoResolved));
            world.debts.insert(loan, crate::world::Debt { creditor: other, debtor: body,
                principal: 100, open: 100, due: Tick(gap.saturating_add(world.params.debt_due_lead)) });
            world.tick = Tick(gap);
            run(&mut world);
            prop_assert_eq!(world.narrator.pending.as_ref().map(|node| node.family), Some(PlayerFamily::DebtDue));
        }
    }
}

pub(crate) fn run(world: &mut World) {
    let Some(SoulPlace::Body(body)) = world.souls.places.get(&world.souls.player).copied() else {
        world.narrator.crossings.clear();
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

    let appended: std::collections::BTreeSet<EventId> = world
        .narrator
        .chronicle
        .entries()
        .iter()
        .rev()
        .take_while(|entry| entry.tick == world.tick)
        .flat_map(|entry| entry.appended.iter().copied())
        .collect();
    let events: Vec<&Event> = world
        .log
        .events()
        .iter()
        .rev()
        .take_while(|event| event.tick == world.tick)
        .filter(|event| !appended.contains(&event.id))
        .collect();
    let life_start = world.narrator.life.as_ref().expect("embodied life").start;
    let mut candidates =
        patterns::collect(world, body, life_start, &events, &world.narrator.crossings);
    candidates.retain(|candidate| candidate.salience >= world.params.min_salience);
    let intro_loan = match world.intro_debt {
        crate::intro::IntroDebt::Grace {
            loan,
            body: first_body,
        } if first_body == body
            && world.narrator.life.as_ref().is_some_and(|life| {
                life.start == Tick(0)
                    && life.first_fire.is_none()
                    && world.tick.0.saturating_sub(life.start.0) >= world.params.first_interrupt_min
            }) =>
        {
            Some(loan)
        }
        _ => None,
    };
    order_candidates(&mut candidates, intro_loan);
    let can_fire = {
        let life = world.narrator.life.as_ref().expect("embodied life");
        (life.first_fire.is_none()
            && world.tick.0.saturating_sub(life.start.0) >= world.params.first_interrupt_min)
            || life.last_fire.is_some_and(|last| {
                world.tick.0.saturating_sub(last.0) >= world.params.interrupt_gap_min
            })
    };
    let mut fired = false;
    for candidate in candidates {
        let defensible = candidate.options.iter().enumerate().any(|(index, option)| {
            candidate
                .options
                .iter()
                .skip(index.saturating_add(1))
                .any(|other| option.preview != other.preview)
        });
        if !fired
            && can_fire
            && defensible
            && world.narrator.pending.is_none()
            && let Ok(id) = world.nodes.ids.next()
        {
            world.narrator.pending = Some(PlayerNode {
                id: NodeId(id),
                family: candidate.family,
                chooser: candidate.chooser,
                fired: world.tick,
                stakes: candidate.stakes,
                options: candidate.options,
                rules_default: candidate.rules_default,
                external: None,
                trigger: candidate.trigger,
            });
            let life = world.narrator.life.as_mut().expect("embodied life");
            life.first_fire.get_or_insert(world.tick);
            life.last_fire = Some(world.tick);
            fired = true;
            continue;
        }
        let (skipped, appended) = candidate
            .options
            .iter()
            .find(|option| option.id == candidate.rules_default)
            .map(|option| apply_parts(world, option, candidate.chooser, candidate.trigger, false))
            .unwrap_or_default();
        world.narrator.chronicle.push(ChronicleEntry {
            tick: world.tick,
            family: candidate.family,
            node: None,
            stakes: candidate.stakes,
            applied: candidate.rules_default,
            source: EntrySource::AutoResolved,
            chooser_absent: false,
            skipped,
            appended,
        });
    }
    world.narrator.crossings.clear();
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
