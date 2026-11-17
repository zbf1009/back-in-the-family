//! Pattern option tables, frozen defaults and firing-time previews.

use crate::ids::{EntityId, EventId, PersonId};
use crate::rng::{StreamTag, draw, in_range};
use crate::underworld::carry_over::TraitName;
use crate::values::{Intensity, SocialKind, Trait};
use crate::world::World;

use super::{
    Candidate, EffectPart, PlannedOption, PlayerFamily, PlayerOption, PreviewEntry, PreviewWhat,
    Stakes,
};

/// Extra, family-specific values needed while constructing a candidate.
#[derive(Clone, Debug)]
pub(crate) enum PatternContext {
    FamilyDeath {
        mourner: PersonId,
        no_mourner: bool,
    },
    Inheritance {
        co_heirs: Vec<PersonId>,
        pay_loan: Option<(EventId, u64)>,
    },
    DebtDue {
        loan: EventId,
        other: PersonId,
        debtor: bool,
    },
    Feud {
        other: PersonId,
    },
    LifeStage {
        age: u64,
    },
}

fn intensity(value: u8) -> Intensity {
    Intensity::new(value).expect("narrator intensities are in the card range")
}

fn social(
    id: PlayerOption,
    kind: SocialKind,
    doer: PersonId,
    target: PersonId,
    amount: u8,
) -> (PlayerOption, Vec<EffectPart>) {
    (
        id,
        vec![EffectPart::Social {
            kind,
            doer,
            target,
            intensity: intensity(amount),
        }],
    )
}

fn trait_part(body: PersonId, name: TraitName, delta: i8) -> EffectPart {
    EffectPart::Trait {
        person: body,
        name,
        delta,
    }
}

fn life_stage_parts(body: PersonId, age: u64) -> Vec<(PlayerOption, Vec<EffectPart>)> {
    match age {
        2_190 => vec![
            (
                PlayerOption::AskForAToy,
                vec![trait_part(body, TraitName::Greed, 1)],
            ),
            (
                PlayerOption::VisitGrandparents,
                vec![
                    trait_part(body, TraitName::Loyalty, 1),
                    trait_part(body, TraitName::Warmth, 1),
                ],
            ),
            (
                PlayerOption::AskForNothing,
                vec![trait_part(body, TraitName::Pride, -1)],
            ),
        ],
        4_380 => vec![
            (
                PlayerOption::StandUpToBully,
                vec![
                    trait_part(body, TraitName::Pride, 1),
                    trait_part(body, TraitName::Temper, 1),
                ],
            ),
            (
                PlayerOption::TellATeacher,
                vec![
                    trait_part(body, TraitName::Loyalty, 1),
                    trait_part(body, TraitName::Vindictiveness, -1),
                ],
            ),
            (
                PlayerOption::KeepQuiet,
                vec![trait_part(body, TraitName::Temper, -1)],
            ),
        ],
        5_840 => vec![
            (
                PlayerOption::GetAJob,
                vec![
                    trait_part(body, TraitName::Greed, 1),
                    trait_part(body, TraitName::Pride, 1),
                ],
            ),
            (
                PlayerOption::HelpAtHome,
                vec![
                    trait_part(body, TraitName::Warmth, 1),
                    trait_part(body, TraitName::Loyalty, 1),
                ],
            ),
            (
                PlayerOption::TendTheShrine,
                vec![trait_part(body, TraitName::Piety, 1)],
            ),
        ],
        _ => Vec::new(),
    }
}

/// Build one candidate from the exact table in the design document.
pub(crate) fn build(
    world: &World,
    family: PlayerFamily,
    chooser: PersonId,
    trigger: Option<EventId>,
    key: u64,
    mut stakes: Stakes,
    context: PatternContext,
) -> Option<Candidate> {
    let rows: Vec<(PlayerOption, Vec<EffectPart>)> = match (family, &context) {
        (
            PlayerFamily::FamilyDeath,
            PatternContext::FamilyDeath {
                mourner,
                no_mourner,
            },
        ) => {
            let mut values = Vec::with_capacity(3);
            if !no_mourner {
                values.push((
                    PlayerOption::ComfortMourner,
                    vec![EffectPart::Social {
                        kind: SocialKind::Help,
                        doer: chooser,
                        target: *mourner,
                        intensity: intensity(60),
                    }],
                ));
            }
            values.push((
                PlayerOption::SendFlowers,
                vec![EffectPart::Social {
                    kind: SocialKind::Gift,
                    doer: chooser,
                    target: *mourner,
                    intensity: intensity(40),
                }],
            ));
            values.push((PlayerOption::StayAway, Vec::new()));
            values
        }
        (PlayerFamily::Inheritance, PatternContext::Inheritance { co_heirs, pay_loan }) => {
            let mut values = vec![(PlayerOption::KeepIt, Vec::new())];
            if !co_heirs.is_empty() {
                values.push((
                    PlayerOption::ThankFamily,
                    co_heirs
                        .iter()
                        .map(|&target| EffectPart::Social {
                            kind: SocialKind::Gift,
                            doer: chooser,
                            target,
                            intensity: intensity(50),
                        })
                        .collect(),
                ));
            }
            if let Some((loan, amount)) = pay_loan {
                values.push((
                    PlayerOption::PayDebts,
                    vec![EffectPart::Repay {
                        loan: *loan,
                        amount: *amount,
                    }],
                ));
            }
            values
        }
        (
            PlayerFamily::DebtDue,
            PatternContext::DebtDue {
                loan,
                other,
                debtor,
            },
        ) => {
            if *debtor {
                vec![
                    (
                        PlayerOption::RepayNow,
                        vec![EffectPart::Repay {
                            loan: *loan,
                            amount: world.debts.get(loan).map_or(0, |d| {
                                let money = world
                                    .persons
                                    .get(&chooser)
                                    .and_then(|p| match p.life {
                                        crate::world::Life::Alive { money, .. } => Some(money),
                                        crate::world::Life::Dead { .. } => None,
                                    })
                                    .unwrap_or(0);
                                d.open.min(money)
                            }),
                        }],
                    ),
                    social(
                        PlayerOption::AskForTime,
                        SocialKind::Apology,
                        chooser,
                        *other,
                        50,
                    ),
                    (PlayerOption::IgnoreIt, Vec::new()),
                ]
            } else {
                vec![
                    social(
                        PlayerOption::DemandPayment,
                        SocialKind::Quarrel,
                        chooser,
                        *other,
                        40,
                    ),
                    (
                        PlayerOption::ForgiveDebt,
                        vec![
                            EffectPart::Forgive { loan: *loan },
                            EffectPart::Social {
                                kind: SocialKind::Help,
                                doer: chooser,
                                target: *other,
                                intensity: intensity(60),
                            },
                        ],
                    ),
                    (PlayerOption::WaitItOut, Vec::new()),
                ]
            }
        }
        (PlayerFamily::Feud, PatternContext::Feud { other }) => vec![
            social(
                PlayerOption::Apologize,
                SocialKind::Apology,
                chooser,
                *other,
                60,
            ),
            social(
                PlayerOption::Retaliate,
                SocialKind::Insult,
                chooser,
                *other,
                50,
            ),
            (PlayerOption::LetItGo, Vec::new()),
        ],
        (PlayerFamily::LifeStage, PatternContext::LifeStage { age }) => {
            life_stage_parts(chooser, *age)
        }
        _ => return None,
    };
    if rows.len() < 2 || rows.len() > 5 {
        return None;
    }

    let options: Vec<PlannedOption> = rows
        .into_iter()
        .map(|(id, parts)| PlannedOption {
            id,
            preview: preview(world, &parts),
            parts,
        })
        .collect();
    if matches!(family, PlayerFamily::FamilyDeath | PlayerFamily::LifeStage) {
        let amount = options
            .iter()
            .flat_map(|option| option.preview.iter())
            .map(|entry| entry.delta.unsigned_abs())
            .max()
            .unwrap_or(0);
        stakes.amount = i64::try_from(amount).unwrap_or(i64::MAX);
    }
    let salience = super::salience::score(world, family, chooser, &stakes);
    let family_rank = family_rank(family);
    let mut best = None;
    for (index, option) in options.iter().enumerate() {
        let prior = prior(world, chooser, option.id, &option.parts);
        let noise = in_range(
            draw(
                world.seed,
                EntityId(key),
                StreamTag::Narrator,
                world.tick,
                family_rank
                    .saturating_mul(8)
                    .saturating_add(u64::try_from(index).unwrap_or(0)),
            ),
            -5,
            5,
        );
        let score = 10i64.saturating_mul(prior).saturating_add(noise);
        if best.is_none_or(|(_, old_score, old_index)| {
            score > old_score || (score == old_score && index < old_index)
        }) {
            best = Some((option.id, score, index));
        }
    }
    Some(Candidate {
        family,
        chooser,
        trigger,
        key,
        stakes,
        options,
        rules_default: best.expect("at least two options").0,
        salience,
    })
}

fn family_rank(family: PlayerFamily) -> u64 {
    match family {
        PlayerFamily::FamilyDeath => 0,
        PlayerFamily::Inheritance => 1,
        PlayerFamily::DebtDue => 2,
        PlayerFamily::Feud => 3,
        PlayerFamily::LifeStage => 4,
    }
}

fn trait_value(world: &World, person: PersonId, name: TraitName) -> i8 {
    let Some(p) = world.persons.get(&person) else {
        return 0;
    };
    match name {
        TraitName::Greed => p.traits.greed.get(),
        TraitName::Loyalty => p.traits.loyalty.get(),
        TraitName::Pride => p.traits.pride.get(),
        TraitName::Warmth => p.traits.warmth.get(),
        TraitName::Temper => p.traits.temper.get(),
        TraitName::Vindictiveness => p.traits.vindictiveness.get(),
        TraitName::Piety => p.traits.piety.get(),
    }
}

fn prior(world: &World, body: PersonId, option: PlayerOption, parts: &[EffectPart]) -> i64 {
    let value = |name| i64::from(trait_value(world, body, name));
    match option {
        PlayerOption::ComfortMourner => {
            value(TraitName::Warmth).saturating_add(value(TraitName::Loyalty))
        }
        PlayerOption::SendFlowers | PlayerOption::WaitItOut | PlayerOption::LetItGo => 0,
        PlayerOption::StayAway => value(TraitName::Warmth).saturating_neg(),
        PlayerOption::KeepIt | PlayerOption::IgnoreIt => value(TraitName::Greed),
        PlayerOption::ThankFamily | PlayerOption::ForgiveDebt => value(TraitName::Warmth),
        PlayerOption::PayDebts | PlayerOption::RepayNow => {
            value(TraitName::Loyalty).saturating_sub(value(TraitName::Greed))
        }
        PlayerOption::AskForTime => value(TraitName::Pride).saturating_neg(),
        PlayerOption::DemandPayment => {
            value(TraitName::Temper).saturating_add(value(TraitName::Greed))
        }
        PlayerOption::Apologize => value(TraitName::Warmth).saturating_sub(value(TraitName::Pride)),
        PlayerOption::Retaliate => {
            value(TraitName::Vindictiveness).saturating_add(value(TraitName::Temper))
        }
        _ => parts
            .iter()
            .filter_map(|part| match part {
                EffectPart::Trait { name, delta, .. } if *delta > 0 => Some(value(*name)),
                _ => None,
            })
            .fold(0i64, i64::saturating_add),
    }
}

fn preview(world: &World, parts: &[EffectPart]) -> Vec<PreviewEntry> {
    let mut entries = Vec::new();
    for part in parts {
        match *part {
            EffectPart::Social {
                kind,
                doer,
                target,
                intensity,
            } => {
                let (target_to_actor, actor_to_target) = crate::social::effects(kind, intensity);
                let before_target = world
                    .relations
                    .get(&(target, doer))
                    .map_or(0, |r| r.affinity.get());
                let before_actor = world
                    .relations
                    .get(&(doer, target))
                    .map_or(0, |r| r.affinity.get());
                let target_delta = i64::from(
                    crate::values::Score::clamped(
                        i64::from(before_target).saturating_add(target_to_actor.affinity),
                    )
                    .get(),
                )
                .saturating_sub(i64::from(before_target));
                let actor_delta = i64::from(
                    crate::values::Score::clamped(
                        i64::from(before_actor).saturating_add(actor_to_target.affinity),
                    )
                    .get(),
                )
                .saturating_sub(i64::from(before_actor));
                if target_delta != 0 {
                    entries.push(PreviewEntry {
                        person: target,
                        what: PreviewWhat::Affinity,
                        delta: target_delta,
                    });
                }
                if actor_delta != 0 {
                    entries.push(PreviewEntry {
                        person: doer,
                        what: PreviewWhat::Affinity,
                        delta: actor_delta,
                    });
                }
            }
            EffectPart::Repay { loan, amount } => {
                if let Some(debt) = world.debts.get(&loan) {
                    entries.push(PreviewEntry {
                        person: debt.debtor,
                        what: PreviewWhat::Money,
                        delta: i64::try_from(amount).unwrap_or(i64::MAX).saturating_neg(),
                    });
                    entries.push(PreviewEntry {
                        person: debt.creditor,
                        what: PreviewWhat::Money,
                        delta: i64::try_from(amount).unwrap_or(i64::MAX),
                    });
                }
            }
            EffectPart::Forgive { loan } => {
                if let Some(debt) = world.debts.get(&loan) {
                    entries.push(PreviewEntry {
                        person: debt.debtor,
                        what: PreviewWhat::Debt,
                        delta: i64::try_from(debt.open)
                            .unwrap_or(i64::MAX)
                            .saturating_neg(),
                    });
                }
            }
            EffectPart::Trait {
                person,
                name,
                delta,
            } => {
                let old = trait_value(world, person, name);
                let new = Trait::clamped(i64::from(old).saturating_add(i64::from(delta))).get();
                let delta = i64::from(new).saturating_sub(i64::from(old));
                if delta != 0 {
                    entries.push(PreviewEntry {
                        person,
                        what: PreviewWhat::Trait(name),
                        delta,
                    });
                }
            }
        }
    }
    entries.sort_by(|a, b| {
        (a.person, a.what.label(), a.delta).cmp(&(b.person, b.what.label(), b.delta))
    });
    entries
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::Tick;
    use crate::narrator::{StakeUnit, Stakes};
    use crate::world::{SoulPlace, WorldConfig};
    use proptest::prelude::*;

    // Feature: first-playable, Property 5: Every Narrator_Candidate is well formed
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn every_family_has_unique_options_and_matching_part_previews(seed in any::<u64>()) {
            let world = World::new(seed, WorldConfig::default()).unwrap();
            let SoulPlace::Body(body) = world.souls.places[&world.souls.player] else {
                unreachable!("opening body");
            };
            let other = world.persons.keys().copied().find(|person| *person != body).unwrap();
            let stakes = |who: Vec<PersonId>, unit| Stakes {
                who, amount: 1, unit, by: Tick(world.tick.0.saturating_add(1)),
            };
            let contexts = [
                (PlayerFamily::FamilyDeath, stakes(vec![body, other], StakeUnit::Affinity), PatternContext::FamilyDeath { mourner: other, no_mourner: false }),
                (PlayerFamily::Inheritance, stakes(vec![other], StakeUnit::Money), PatternContext::Inheritance { co_heirs: vec![other], pay_loan: None }),
                (PlayerFamily::DebtDue, stakes(vec![other], StakeUnit::Money), PatternContext::DebtDue { loan: EventId(1), other, debtor: false }),
                (PlayerFamily::Feud, stakes(vec![other], StakeUnit::Affinity), PatternContext::Feud { other }),
                (PlayerFamily::LifeStage, stakes(vec![body], StakeUnit::TraitPoints), PatternContext::LifeStage { age: 2_190 }),
            ];
            for (family, stakes, context) in contexts {
                let candidate = build(&world, family, body, None, body.0, stakes, context).unwrap();
                let option_ids: std::collections::BTreeSet<_> = candidate.options.iter().map(|o| o.id).collect();
                prop_assert!((2..=5).contains(&candidate.options.len()));
                prop_assert_eq!(option_ids.len(), candidate.options.len());
                prop_assert!(option_ids.contains(&candidate.rules_default));
                prop_assert!(!candidate.stakes.who.is_empty());
                prop_assert!(candidate.stakes.who.iter().all(|person| world.persons.contains_key(person)));
                prop_assert!(candidate.stakes.by >= world.tick);
                for option in &candidate.options {
                    prop_assert!(option.preview.iter().all(|entry| entry.delta != 0));
                    let mut applied = world.clone();
                    let mut expected = Vec::new();
                    for part in &option.parts {
                        match *part {
                            EffectPart::Social { kind, doer, target, intensity } => {
                                let before = [(target, doer), (doer, target)].map(|(from, to)|
                                    world.relations.get(&(from, to)).map_or(0, |r| r.affinity.get()));
                                crate::social::apply_social(&mut applied, kind, doer, target,
                                    intensity, crate::events::CausedBy::default()).unwrap();
                                for ((from, to), old) in [(target, doer), (doer, target)].into_iter().zip(before) {
                                    let now = applied.relations.get(&(from, to)).map_or(0, |r| r.affinity.get());
                                    if now != old { expected.push(PreviewEntry { person: from, what: PreviewWhat::Affinity, delta: i64::from(now).saturating_sub(i64::from(old)) }); }
                                }
                            }
                            EffectPart::Trait { person, name, delta } => {
                                let old = trait_value(&world, person, name);
                                let now = Trait::clamped(i64::from(old).saturating_add(i64::from(delta))).get();
                                if now != old { expected.push(PreviewEntry { person, what: PreviewWhat::Trait(name), delta: i64::from(now).saturating_sub(i64::from(old)) }); }
                            }
                            EffectPart::Repay { loan, amount } => {
                                if let Some(debt) = world.debts.get(&loan) {
                                    expected.push(PreviewEntry { person: debt.debtor, what: PreviewWhat::Money, delta: i64::try_from(amount).unwrap().saturating_neg() });
                                    expected.push(PreviewEntry { person: debt.creditor, what: PreviewWhat::Money, delta: i64::try_from(amount).unwrap() });
                                }
                            }
                            EffectPart::Forgive { loan } => {
                                if let Some(debt) = world.debts.get(&loan) {
                                    expected.push(PreviewEntry { person: debt.debtor, what: PreviewWhat::Debt, delta: i64::try_from(debt.open).unwrap().saturating_neg() });
                                }
                            }
                        }
                    }
                    expected.sort_by_key(|entry| (entry.person, entry.what.label(), entry.delta));
                    prop_assert_eq!(&option.preview, &expected);
                }
            }
        }
    }
}
