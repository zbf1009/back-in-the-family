# Back in the Family

*Born here. Die here. Repeat.*

A reincarnation life-sim set in a small American town where, after a Halloween clerical error at the local branch of the underworld, everyone who dies in town can only be reborn into the town's own newborns.

Built for Kiroween 2026 (Frankenstein category). Development is done with Kiro CLI; the `.kiro/` directory (steering, specs, hooks, agents) is part of this repository.

Status: early development. Build and run instructions will be added as the project takes shape.

## Prior work disclosure

- **Design notes.** The game concept was sketched in private notes before the
  submission period began. No code, assets, or text from those notes are in
  this repository.
- **Research consulted for ideas only, no code used:** *Talk of the Town*
  (James Ryan, *Curating Simulated Storyworlds*, 2018), *Neighborly*
  (Johnson-Bey et al., IEEE CoG 2022), and *Felt* (Kreminski et al.).
- **Verifiable history.** This repository started empty; its first commit
  contains only the license, this README, and `.gitignore`. All code was
  written during the Kiroween 2026 submission period and can be traced
  through the commit history.

## Third-party libraries and assets

| Name | Version | License | Used for |
|---|---|---|---|
| [`blake3`](https://crates.io/crates/blake3) (feature `pure`, default features off) | 1.8.7 | CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception | Per-tick state checksum in `sim-core` (first 8 bytes of the BLAKE3 hash of the canonical encoding) |

More entries are added here as libraries and assets arrive.

## License

Code is licensed under the [Apache License 2.0](LICENSE). The license does not grant rights to the project name (see section 6 of the license).
