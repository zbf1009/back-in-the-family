# Rebuilt body versus imported vessel: Devoted seed 2

Measured on 2026-11-20 at source revision `0ff8b2f`, using the production Devoted planner and default simulation parameters. This is a same-state comparison of **existing supply versus a body built to order**, not a balance ranking (first-playable R6.10).

## Shared run and claim boundary

- Seed: **2**; opening residents: **50**; generation horizon and production observer run: **29,200 daily ticks**.
- Generated inputs: exactly `generate_inputs(2, 60, 29200, 50)`. All **60** were submitted in returned order before the first step, including inputs after the claim tick. No shortened horizon, omitted future inputs, or reordered submissions were used.
- The public `sim_cli::batch::report_devoted_sim` observer captured a clone of the actual `Sim` **before planning at World/input tick 22,973**, then the actual settled state at World tick **22,974**. The original Devoted run continued through tick 29,200; its final checksum was `3be2645272d81e94`, matching the saved seed-2 gate result.
- **Shared pre-claim World checksum: `a539020fdb8e9743`.** Both branches cloned that same pre-planning `Sim`, including its complete input stream, next sequence number and checksum history. The shared state contains 22,973 completed ticks and 824 submitted inputs; nine already-submitted generated inputs are still in the future.
- At tick 22,973 there were **no pre-submitted same-tick inputs**. The production observer found exactly one newly planned input: `InputSeq(824)`, `ClaimSlot { slot: RebuiltBody, customization: Some(Set { trait_name: Piety, value: 3 }) }`. There was no additional same-tick CarryOver, dream, bribe, haunting, or Devoted living act to remove or reorder.
- The earlier, shared Carry_Over input was `InputSeq(820)` at input tick **22,794**: `CarryOver { trait_name: Greed }`. It remains in both branches' identical prefix.
- The two full input streams differ at **exactly one payload**, sequence 824. The imported branch replaces that payload with `ClaimSlot { slot: ImportedVessel, customization: None }`; the rebuilt branch keeps the observed Devoted payload unchanged. Every other input, tick and sequence is identical. The rebuilt branch's resulting World, full input stream and complete checksum history equal the production observation.

**Tick convention:** `Sim::step` executes input tick 22,973, records the arrival event at tick 22,973, advances World to 22,974, then checksums that resulting World. The checksum shared by the branches is the state **at the start of the claim/input tick**, not the two different post-claim states. The post-claim checksums must not be described as identical.

The common pre-claim joss balance was **439**, with **40** already counted toward the current year's capped spend. Snapshot Path_Status showed both standing paths announced, claimable and affordable, with no missing conditions. The two visible birth slots were not yet claimable (`wait_until = 23158`); this comparison does not turn them into executable alternatives.

## Observed claim results

| At the completed claim step | ImportedVessel | RebuiltBody |
|---|---|---|
| Claim input | `ImportedVessel`, no Customization | `RebuiltBody`, **Set piety 3** |
| Input outcome, sequence 824 | `Ok(())` | `Ok(())` |
| Arrival event | `EventId(11715)`, `Possession { person: PersonId(100), price: 100 }` | `EventId(11715)`, `Rebuild { person: PersonId(100), price: 400 }` |
| Event/input tick → post-step World tick | 22,973 → 22,974 | 22,973 → 22,974 |
| **Price paid**, from the actual arrival event | **100 joss paper** | **400 joss paper** |
| Joss balance after payment | **339** | **39** |
| Capped spend in the claim year | **40** (unchanged by this claim) | **440** (40 + 400) |
| Post-claim World checksum | `d83e905eaa5e0b0f` | `d428129414b7a96d` |
| New body / Soul | Edmund Sutton, Person 100 / `S-0027` | Edmund Sutton, Person 100 / `S-0027` |
| Origin | `possessed` | `rebuilt` |
| Age / Household | 21 / 46 | 21 / 46 |
| Wealth at the completed step | 1,446 | 1,446 |

The price is measured spend, not merely the advertised slot price: it is present in each branch's actual event, and the balance changes from 439 to 339 or 39 agree with it. Rebuilt costs **300 more** in this particular comparison and adds **400** to capped spend; imported does not add to capped spend.

## Traits, Base_Traits and Carry_Over

`Base_Traits` is the **rebuilt** preview value stored for this wait: the fixed Rebuilt_Draw with the selected Carry_Over applied. It is not a preview or configurable trait vector for an imported vessel. The table deliberately places each branch's actual Traits beside that common rebuilt reference; the imported column is its observed default supply after the same Carry_Over, not an assertion that imported uses the rebuilt Base_Traits.

| Trait | Stored Rebuilt_Draw, before Carry_Over | Rebuilt Base_Traits, Carry_Over = greed | Imported actual Traits | Rebuilt actual Traits |
|---|---:|---:|---:|---:|
| greed | 1 | **3** | **3** | **3** |
| loyalty | -3 | -3 | 2 | -3 |
| pride | -3 | -3 | -1 | -3 |
| warmth | 1 | 1 | 2 | 1 |
| temper | 1 | 1 | 1 | 1 |
| vindictiveness | -1 | -1 | -2 | -1 |
| piety | 1 | **1** | **-2** | **3** |

- **Shared player choice:** Carry_Over **greed**, taking the previous body's greed value **3**. In the rebuilt preview it overrides the stored draw's greed **1 → 3**. Both resulting bodies have greed 3. The imported body's pre-Carry_Over draw was not separately measured, so no numerical imported override is inferred.
- **Imported chosen Traits:** no Customization; only the shared greed Carry_Over. In particular, the claim does not choose piety; the resulting imported vessel has **piety -2**.
- **Rebuilt chosen Traits:** the actual Devoted claim chooses **Set piety 3**, a legal one-Trait Set within -3..=3. The measured result changes Base_Traits piety **1 → 3** and leaves all six other Traits equal to Base_Traits.
- **Customization overriding Carry_Over:** **none in this observed claim**. Carry_Over names greed and Customization names piety; they do not overlap. This example does not claim to demonstrate the overlap case.

## Local ties, inheritance and identity

At World tick 22,974, both new bodies have:

- **Local ties: none.** Snapshot `player.blood_ties` and `player.relations` are both empty. A scan of the actual World relation map also finds **zero incoming or outgoing edges** involving Person 100, so this conclusion is not limited to one direction of the Snapshot view.
- **Inheritance claims: none observed.** Neither body has a kinship relation that could make it an heir under the current inheritance rules. The event-log scan finds **no Inheritance event with Person 100 as heir**, and the body owns **no property items**. The model/Snapshot has no separate `inheritance_claims` field; this statement describes the observed relations, events and property, not an invented claim ledger or a guarantee about future inheritances.
- A new Household, ID **46**, and a living adult body, rather than local parentage or an inherited household identity. Their measured post-step age and wealth are the same; wealth is not presented as inherited property.
- **36 past-life ties** in Snapshot, all pointing to the earlier body, Jerome Palmer (Person 27, native, died at tick 22,793). These rememberers remain ties to that earlier body, **not local ties to Edmund Sutton's new body**. The persistent Soul is the same `S-0027`; the new body's Origin differs as shown above.

## What this comparison establishes

For the specific intent **“my next body's piety should be 3”**, the available imported vessel does not fit: its measured piety is -2 and its claim cannot specify Traits. The rebuilt claim pays 400 and directly controls that named Trait, producing piety 3 from Base_Traits piety 1. It does **not** give control over the other six Traits beyond the shared Carry_Over, nor does it supply local family ties or inheritance claims in this state.

The imported path costs 100 and retains 339 joss paper; the rebuilt path retains 39 and consumes more capped spend. These are situational costs and capabilities, **not evidence that either path is globally superior**, richer over a lifetime, less feud-prone, or better balanced. Whether the 300-paper premium is reasonable remains a later experience evaluation. The comparison ends after the claim step; no equal-horizon post-claim life outcomes were measured for the imported branch.

## Evidence and reproduction

Temporary helper: `crates/sim-cli/tests/comparison_evidence.rs` (removed after capture; its exact source is retained outside the repository as `comparison-evidence-driver.rs`). Only the narrow integration test was run, serially:

```sh
cargo test --release -p sim-cli --test comparison_evidence devoted_seed_two_same_preclaim_branches -- --exact --nocapture
```

**Result:** exit **0**, wall time **13.249 s**, one test passed. No broad Cargo suite, Web checks or gates were run for this evidence capture.

Local evidence directory: `/home/kaiki/.cache/back-in-the-family/first-playable/15.1/`:

- `comparison-run-1.log`, `.exit`, `.seconds`: full command output, exit code and measured wall time.
- `comparison-evidence.json`: complete pre-claim Snapshot, actual claim inputs, wait draw, joss accounts, branch body records, local relation scans, inheritance-event/property scans and checksums.
- `comparison-input-prefix.txt`: complete pre-claim input stream, including already-submitted future inputs.
- `comparison-evidence-driver.rs`: exact temporary integration-test source needed to recreate the capture.

The saved prior gate log `/home/kaiki/.cache/back-in-the-family/first-playable/14.1/gates-hardening.log`, lines 1032–1068, supplies the seed-2 reachability context: rebuilt life begins at tick 22,973, rebuilt affordable/customized are true, and the 29,200-tick final checksum is `3be2645272d81e94`. It does not itself contain the comparison; all branch values above come from the new capture.
