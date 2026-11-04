---
inclusion: always
---

# Product

## What we are building

**Back in the Family** — *Born here. Die here. Repeat.*

A small American town suffers a clerical error at the local branch of the underworld one Halloween: the souls of everyone who dies in town are locked to the town and can only be reborn into the town's own newborns. The player is one such soul. Alive, they live a life and make friends and enemies. Dead, they spend joss paper offered by the living on dreams, hauntings and bribes. Then they pick their next birth from a short list of open slots, even if the best slot is in their worst enemy's house.

Hackathon: Kiroween 2026, **Frankenstein** category. The stitch: a non-deterministic generative LLM makes decisions inside a bit-for-bit reproducible deterministic simulation. Rules compute the closed set of legal options; the LLM only picks from that set; the pick is recorded as an authoritative input, so replays never call the model.

Audience: players who like emergent story sims (life sims, colony sims, dynasty games) and want a short, funny session with real consequences.

## Principles (resolve conflicts in this order)

1. **The base is a simulation, not a script.** The town runs on a deterministic emergent simulation. No fixed opening script, no branching cutscenes. Players and the LLM are layers on top.
2. **Learn from others, build for our own goals.** Borrow ideas that fit; drop what doesn't. Never copy other projects' code.
3. **Rules define the legal space; the LLM makes slow choices inside it.** Facts (kinship, debts, causes of death, births, inheritance), which options are legal, effect bounds and survival guarantees are all computed by rules. The LLM, at sparse nodes, picks from rule-generated closed sets for key NPCs, or summarizes recorded facts into structured conclusions. Outputs are validated, clamped and recorded into the input stream. It also writes dialogue, dreams and obituaries as a side job.
4. **Fully playable without an LLM.** When the model is slow or unavailable, rules (utility scoring + personality facets) choose the default and templates supply the text. Every mechanic still works.
5. **Interrupt the player only for real choices.** If there are not at least two defensible options with different costs, resolve automatically and write it into the chronicle.

## Core loop

1. **Life.** The simulation fast-forwards. The narrator stops at nodes that matter to the player's soul: major life decisions at each life stage (e.g. "at six, your parents ask what you want for your birthday"), deaths in the family, inheritance, debts falling due, feuds crossing a threshold. Life-stage choices **bias** traits and interests; the simulation decides what follows. They never open scripted branches.
2. **Death.** The player loses control of property, actions and unfinished promises.
3. **Underworld.** Joss paper received reflects how the player treated the living. Spend it on dreams (influence someone you are connected to; the dreamer decides how to read it), hauntings, or bribing the magistrate.
4. **Rebirth.** Choose a slot: a local newborn, an **imported vessel** from out of town ("Local bodies running low? We've brought in fresh ones!"), or a **rebuilt body** at a much higher cost. Then live again, with last life's promises colliding with this life's family.

## Identity and balance rules

- Permanent Soul ID, temporary body identity. The player keeps what they know; mechanically only a small carry-over (one promise, one small tendency, or limited memory).
- Residents know the current body, not past lives. The UI always shows the same soul marker; blood ties and past-life ties are shown separately.
- One soul, one place: once reborn, the soul leaves the underworld and cannot collect offerings as an ancestor.
- Death has a cost; dying early must never be the best strategy.
- Ghost power is bounded: dreams only reach connected people and never control actions directly. Exorcism can cut a connection but must not leave the player with nothing to do.
- Joss paper income is capped; it cannot be converted into unlimited control.
- Birth windows are visible and have a maximum wait. At death the player should see at least two slots worth comparing.
- Imported vessels and rebuilt bodies skip childhood, so they must cost something (price, no local ties, no inheritance claims, or similar). Rebuilt bodies count against the joss paper cap. Imported vessels are blank shells allocated by the underworld office, not someone else's soul.

## Experience targets

- One life lasts **5–10 minutes** of play. The first life starts as a young or middle-aged adult with an existing family, debts and grudges. Later lives start at birth with childhood compressed to two or three nodes.
- First interruption within about 30 seconds. Initial narrator budget: roughly one interruption every 30–40 seconds.
- Town of **40–60 residents**, every one named and recognizable. Outsiders may move in.
- A judge must understand within seconds: who I am now, who remembers me, and who this choice hurts.

## Demo

- Default: **live play**. NPC decisions use the fallback chain in-browser LLM → server LLM → rules default.
- An in-app **replay gallery** of curated seeds and input streams, showing the checksum as it plays.
- The best seeds and input streams are also recorded for the demo video.

## Tone and culture

- The underworld office is a fictional bureaucracy inspired by Chinese underworld imagery (magistrates, the register of life and death, ancestor offerings). It does not claim any real religion works this way.
- Jokes target bureaucracy, control freaks and family hypocrisy, never people who honor their ancestors.
- Say *joss paper* or *spirit money*, never *hell money*.
- No third-party trademarks or unlicensed music anywhere, including the video.

## Out of scope for the first version

Cross-life romance; open-world free movement and pathfinding; job and skill trees; unlimited generation depth; a separate LLM call per resident; per-hour needs simulation.

## Build strategy

Get one thin vertical slice working end to end first (start of life → a few interruptions → death → one dream with one LLM call → rebirth → second life). Then thicken each part.
