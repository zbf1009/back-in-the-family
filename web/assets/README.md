# Life-view art assets

The four registered native PNG atlases below are public media inputs. Vite copies
`web/public/assets/` to the exact `assets/` paths; there is no art downloader,
inline image import, full source sheet or labeled evidence contact sheet.
`ASSETS.json` uses the exact **RPG Urban Pack** and **Roguelike RPG Pack** Names
in the root README's `## Third-party libraries and assets` tables. The original
atlas alone is registered as `project`; editing a pack crop does not change its
lineage. Existing release/media/asset-inventory policies are unchanged.
The portrait pool atlas is registered under the exact **Character portrait kit**
Name in that same README table; its source-derived cells retain CC-BY-4.0 and
its independently authored original cells retain Apache-2.0.

## Emitted native PNGs

| Public path | Native size | Selected tiles | Bytes | SHA-256 |
|---|---|---|---|---|
| `assets/life-view-urban.png` | 128×48 | 19 | 3424 | `0bd6b1bbe15a6f639fa371cbb850402c66798508ba3c8b1b7a52212e0662abca` |
| `assets/life-view-roguelike.png` | 128×16 | 7 | 577 | `772a585e0450e479675a886405589d421c61cff7c1e8cca7a7adbace5d5399df` |
| `assets/life-view-original.png` | 128×56 | 22 | 2167 | `6f4275bb052ca84ae29e860691de925399ea1f6eb628eb43cda1ac9fb885baa2` |
| `assets/life-portraits.png` | 1024×1472 | 360 portrait cells | 101651 | `767f3baf7237370403f5f5b18338bc0cde24200beb766fc0ff78ad7009935ef1` |

The 48 selected tiles comprise six real modern adult bases, four original
children, three Urban-derived elder variants, one original swaddled infant,
one newly authored wholly original neutral unknown-age figure, all required
static props/scenery/markers and five original compact relationship-status
pins. Selection is cosmetic, not an assertion of sex, hair, skin or unseen
simulation facts. Unknown age is distinct; arrival is not automatically infancy.

[`../src/art/life-view-atlas.ts`](../src/art/life-view-atlas.ts) is the static
consumer interface: `LIFE_ATLASES` supplies public paths and native dimensions,
`LIFE_TILES` supplies atlas destination rectangles, and `PERSON_TILES` supplies
six/four/three/one/one readonly adult/child/elder/baby/unknown tile IDs.
Native crops are copied without rotation, resampling, tinting or alpha-mask
blending. Per-lineage shelf packing uses 128px width, stable selection order,
left-to-right placement and each row's largest crop height; all unused pixels
are transparent. The original night-sky crop itself is deliberately opaque.

## Selected keys and destination rectangles

All rectangles are native destination pixels, `(x, y, width, height)`. Exact
source rectangles and hashes are in the detailed provenance registry below.

| ID | Atlas | Destination rectangle | Origin |
|---|---|---|---|
| `adult_1` | urban | `0, 0, 16, 16` | Selected source crop |
| `adult_2` | urban | `16, 0, 16, 16` | Selected source crop |
| `adult_3` | urban | `32, 0, 16, 16` | Selected source crop |
| `adult_4` | urban | `48, 0, 16, 16` | Selected source crop |
| `adult_5` | urban | `64, 0, 16, 16` | Selected source crop |
| `adult_6` | urban | `80, 0, 16, 16` | Selected source crop |
| `elder_1` | urban | `96, 0, 16, 16` | Attributed source modification |
| `elder_2` | urban | `112, 0, 16, 16` | Attributed source modification |
| `elder_3` | urban | `0, 16, 16, 16` | Attributed source modification |
| `grass` | urban | `16, 16, 16, 16` | Selected source crop |
| `sidewalk` | urban | `32, 16, 16, 16` | Selected source crop |
| `road` | urban | `48, 16, 16, 16` | Selected source crop |
| `house_roof` | urban | `64, 16, 16, 16` | Selected source crop |
| `house_window` | urban | `80, 16, 16, 16` | Selected source crop |
| `house_door` | urban | `96, 16, 16, 16` | Selected source crop |
| `tree` | urban | `112, 16, 16, 16` | Selected source crop |
| `fence` | urban | `0, 32, 16, 16` | Selected source crop |
| `streetlight_top` | urban | `16, 32, 16, 16` | Selected source crop |
| `streetlight_bottom` | urban | `32, 32, 16, 16` | Selected source crop |
| `house_wall` | roguelike | `0, 0, 16, 16` | Selected source crop |
| `grave` | roguelike | `16, 0, 16, 16` | Selected source crop |
| `will` | roguelike | `32, 0, 16, 16` | Selected source crop |
| `floor` | roguelike | `48, 0, 16, 16` | Selected source crop |
| `wall` | roguelike | `64, 0, 16, 16` | Selected source crop |
| `table` | roguelike | `80, 0, 16, 16` | Selected source crop |
| `candle` | roguelike | `96, 0, 16, 16` | Attributed source modification |
| `child_1` | original | `0, 0, 16, 16` | Original project drawing |
| `child_2` | original | `16, 0, 16, 16` | Original project drawing |
| `child_3` | original | `32, 0, 16, 16` | Original project drawing |
| `child_4` | original | `48, 0, 16, 16` | Original project drawing |
| `baby` | original | `64, 0, 16, 16` | Original project drawing |
| `unknown_age` | original | `80, 0, 16, 16` | Original project drawing |
| `coffin` | original | `96, 0, 32, 16` | Original project drawing |
| `cradle` | original | `0, 16, 16, 16` | Original project drawing |
| `cloud` | original | `16, 16, 32, 16` | Original project drawing |
| `joss_paper` | original | `48, 16, 16, 16` | Original project drawing |
| `register` | original | `64, 16, 16, 16` | Original project drawing |
| `seal` | original | `80, 16, 16, 16` | Original project drawing |
| `night_sky` | original | `96, 16, 16, 16` | Original project drawing |
| `soul_marker` | original | `0, 32, 24, 24` | Original project drawing |
| `soul_marker_small` | original | `24, 32, 12, 12` | Original project drawing |
| `affected_marker` | original | `36, 32, 24, 24` | Original project drawing |
| `affected_marker_small` | original | `60, 32, 12, 12` | Original project drawing |
| `map_pin_self` | original | `72, 32, 8, 8` | Original project drawing |
| `map_pin_kin` | original | `80, 32, 8, 8` | Original project drawing |
| `map_pin_rememberer` | original | `88, 32, 8, 8` | Original project drawing |
| `map_pin_affected` | original | `96, 32, 8, 8` | Original project drawing |
| `map_pin_neutral` | original | `104, 32, 8, 8` | Original project drawing |

## Sources and full licenses

Approved source evidence is cached at
`/home/kaiki/.cache/back-in-the-family/first-playable/c4-direction/`.
Only `Tilemap/tilemap.png` from Urban and
`Spritesheet/roguelikeSheet_transparent.png` from Roguelike are source sheets.
Their selected crops and the approved `assets/drawn/*.png` originals/modifications
were repacked; audit/contact images, previews, samples, logos, full source sheets
and archives are not public art or committed runtime dependencies.

| Pack | Version evidence | Archive SHA-256 | Full package notice |
|---|---|---|---|
| [RPG Urban Pack](https://kenney.nl/assets/rpg-urban-pack) | Archive root License.txt: RPG Urban Pack 1.0 | `4541d89d639fc7d1e905dd925e55b1c4977a41d983516228db1d57173bb9afaf` | [rpg-urban-pack-License.txt](licenses/rpg-urban-pack-License.txt) |
| [Roguelike RPG Pack](https://kenney.nl/assets/roguelike-rpg-pack) | Official pack page; archive License.txt names Roguelike pack but gives no version | `8e7d2378f8f794245645f6d7dc7aeeb246791410a7e512293c594b46a5a9524b` | [roguelike-rpg-pack-License.txt](licenses/roguelike-rpg-pack-License.txt) |

The complete [CC0 1.0 Universal legal terms](licenses/CC0-1.0.txt) apply to
both selected Kenney packs. The Urban notice credits Kenney; the Roguelike
notice credits Kenney Vleugels and help by Lynn Evers. Package notices are
retained as the complete raw UTF-8 ZIP-root `License.txt` bytes, not summaries.
The existing [artifact NOTICE](../../worker-api/artifact-deploy/NOTICE) appends
both full package notices and the full CC0 text without replacing deployment,
quota, SDK or browser/Rust-runtime terms. Wholly original project art is under
the root [Apache-2.0 license](../../LICENSE). CC0 attribution is optional;
retention is this project's provenance policy and does not imply endorsement.
No font pack or license from an unselected pack is inherited.

## Exact crop and modification provenance

[`life-view-provenance.json`](life-view-provenance.json) records:

- Observed atlas bytes, dimensions, selected counts and SHA-256 hashes.
- Selected input manifests, ZIP hashes/byte sizes, exact member names, sheet
  hashes/dimensions, full package-license hashes and the complete CC0 source.
- Every stable tile ID, lineage, license path, source/input hash, native source
  crop and destination rectangle, plus a row-major unpremultiplied RGBA8 hash
  of the actual selected pixels.
- Each source-derived elder/candle input and exact source-relative replacement
  pixel coordinates with before/after RGBA values. Every unlisted source pixel
  in those crops is retained unchanged. Elders remain Urban and candle remains
  Roguelike, even though their cached files live under `assets/drawn/`.
- Original creation notes. `unknown_age` starts from a transparent 16×16 canvas
  and has its full authored row matrix/palette in the registry: neutral
  full-body silhouette, no face/hair/skin, age badge or copied source shape.
  Original cached artwork may sample colors but copies no pack imagery.

The registry's `evidence_path` fields are preparation provenance, not browser
URLs. Public lookup uses only `LIFE_ATLASES.path`. `will` is the selected blank
paper/document crop, not invented written terms; `road` retains the selected
road-corner pavement crop. Soul's original ring and affected's original diamond
are separate shape-distinct markers, never body identity inferred from color.

## Life Unfolds stage composition

All eight scene families use native 64px portrait cells with recorded sex and age,
with original notebook, memorial, inheritance, debt, quarrel, life-stage, rebirth
and Dream compositions. `src/art/stage-paint.ts` authors missing scenery and
prop gaps as integer pixel fills, including three distinct rebirth settings:
only actual Birth has a cradle/baby; Possession and Rebuild use the captured
adult/unknown-age subject and their own permit/receipt. Apache-2.0 project
geometry and the separate source-derived/original portrait lineage are recorded
in `runtime_art` and the pool manifest. No new pack, font or generated image is used.

Pictures use the canonical416×192 native pixel geometry in
`src/art/stage-geometry.ts`, shared by the office and stage painters without an
import cycle. The discrete source-pixel scale1/2 yields832×384 CSS pixels at2×,
fitting the actual848px content column. Native64 portrait cells, scenery and
props all share that scale. Views below416px retain1× pixels and an accessible
stage-local scroll viewport instead of fractional portrait/background scaling. Node
scenes perform for five seconds, Dream for 6.5 seconds, death/rebirth for seven.
Actors/documents move 40–80 logical pixels with transform/opacity and document
unfolding through clip-path. Paragraphs reveal at 35 characters per second;
full accessible paragraphs/document facts and legal controls are immediate.
Show all text affects words only. Skip settles decoration without submitting
input. Reduced motion and hidden views use the final picture/text. Ordinary
Run has gentle two-frame breathing and lamplight/cloth over cached art, with
an explicitly cosmetic fictional-calendar palette; no weather is asserted.

`KeyScene` retains `view`, `sprites`, `onClose`; optional `presentationVersion`
settles decoration after a validated current action, `onSettled` reports
settlement without closing/advancing, and `next` labels guarded Continue.
`ScenePicture` adds optional `running` and `worldKey`; `onLayers` additionally
provides the departure canvas, document element and split-actor counterpart.
Its composition key includes source identity, actual name/date/age/origin,
document/arrival facts, cosmetic palette and world identity, not animation time.

`sceneQueue` takes optional actors in argument five, fresh exact DreamFacts in
six and actual StoryEvents in seven. `lifecycleKeyScene` takes actors in four,
events in five. Arrival price joins only exact EventId/kind/person.
`dreamKeyScene` takes `(worldId, capturedWorld, actualFact, actors)`; it never
substitutes sent date for an absent interpretation date. The fallback
`dreamResolutionKeyScene` retains only actual resolution date/recipient/response
and the captured stop World; it invents no ghost/intent/price/EventId/input.
Every entry retains its own captured World, independently of an older active
bundle. Lifecycle and exact Dream entries sort by numeric native EventId.
Fallback admission remains fresh-stop T/T+1, with the integration owner keeping
only the last admitted fallback key. Original queue-date/exact-entry close
guards remain, ordinary ticks do not expire history, and only an admitted exact
node retires its decision entry.

Exact and fallback Dream use the same complete `KeyScene`/`ScenePicture`
performance; the old standalone Dream/template staging path is removed.


The life surface uses these atlases through one decoded `SpriteSet`; an asset
failure is explicit and never substitutes placeholder art. Factual text and
operations remain available independently of drawing. DOM text uses installed
system fonts, not a bundled or downloaded font pack. Local LV-C3 material,
native-page and isolated-component evidence is recorded at the checkpoint in
`.kiro/specs/life-in-view/tasks.md`; final selected art/recipe review and later
motion acceptance remain separate checkpoints.

## Primary portrait pools and office composition

The Author approved local expansion after the first real rendered samples,
with the sex/age, stable-palette, flat-edge, integer-scale and office corrections.
This is not publication approval or a second sample checkpoint. The historical
sample screenshots/native facts remain unchanged; `/art-sample.html` now uses
the same production pool and office modules for the parent's integrated review.
`/credits.html` is the accessible onsite attribution page.

The 360-cell atlas uses 15 pools: female/male/neutral for baby0–2, child3–17,
adult18–59, elder60+ and unknown age. These are illustration thresholds, not game
rules. Unknown sex selects neutral; unknown age selects a distinct faceless,
age-indeterminate original illustration, never an asserted adult. Each pool has
two shape variants and12 palettes: four skin families and three natural dark-hair
families. `person % 12` fixes the palette and `floor(person / 12) % 2` fixes the
variant across all age/sex pools. Elder contours/creases/spectacles change the
shape, not the base skin/hair family. Nadine10 uses female adult at45 and female
elder at60; Marvin39 at22 uses male adult and natural dark hair.

The 96 female/male adult/elder cells adapt
[Character portrait kit](https://opengameart.org/content/character-portrait-kit)
by [Dezra's Dragons](https://opengameart.org/users/dezrasdragons), under selected
[CC-BY4.0](https://creativecommons.org/licenses/by/4.0/). CC-BY3.0 and OGA-BY3.0
are offered by the source but not selected. The required creator/profile notice
is preserved in [character-portrait-kit-NOTICE.txt](licenses/character-portrait-kit-NOTICE.txt),
with the [complete selected license/disclaimer](licenses/CC-BY-4.0.txt); the same
notice and full legal text remain in the distribution NOTICE. Attribution implies
no endorsement, and the code license imposes no additional artwork restriction.

The independently inspected original is616×904 RGBA8,57,993 bytes, SHA-256
`6680b9144d9c2c7a60c123585064fab77715e5850f57b5e803a1c6faa7d9fd02`.
Exact gray ground is removed, female/male torso/head crops assembled, modern
cardigan/blouse/collared shirt/polo pixels painted, skin/hair and irises recolored,
and elder contours/creases/modern spectacles added. Original frame lower rails
cover ragged torso edges. The source supplies no embedded creator/license text;
its source-page notice is retained independently. Armor, hoods, fantasy accessories,
preview images and comment attachments are excluded.

The other264 baby/child/neutral/unknown-age cells and frame rails are hand-authored
original pixel work under Apache-2.0, not source-derived or CC0. Baby cells have
large heads and short swaddled bodies; child cells use independently drawn child
proportions, not shrunken adult source heads. A mixed atlas preserves each lineage.
No model, generated image, paid/fallback pack, new download or core RNG is used.

[`portrait-pool-provenance.json`](portrait-pool-provenance.json) retains exact
crops/source hashes, palette replacements, masked/unmasked manual drawing commands,
per-template lineage and every cell's destination/RGBA hash. The reproducible
[`compose-portrait-pool.py`](compose-portrait-pool.py) requires Pillow and the
existing cached exact original. Only the compressed selected atlas is public;
source sheets and the detailed manifest are not deployment media.

`src/art/portraits.ts` exposes `PortraitSubject`, `portraitId`, `PortraitSet.draw`
and native `PORTRAIT_CELL=64`. Selection/draw allocate no repeated arrays/records
and use no RNG. `SpriteSet.portraits` joins the existing cached loader with the
three original atlases; failures remain failures. `ui/Portrait.svelte` consumes
`portraits`, `person`, recorded `sex`, `age`, `label`, `pixelScale=2`; its canvas
is intrinsically64×scale, with one accessible label and no fractional CSS stretch.
Null resources have no drawable canvas or fabricated replacement. Actual selected
subject/cell/pool/scale metadata is exposed for factual render diagnostics.
`PeopleCard` reserves the full128×128 portrait content separately from its2px lower frame (`box-sizing: content-box`); the source cell is not cropped by a border-box height. Full-cell diagnostics use actual device-aligned screenshots rather than enclosing fractional DOM bounds.


The preserved fixture uses Death2368/day5372/Nadine/native age60. Its completed
Waiting World is day5373, never the death date. Exported actors and Death are
copied from `target/life-unfolds/default-play-facts.json` with its source hash,
and the immutable actor root is bound to the fixture notebook. Legal controls
record real callback/request shapes locally without sending simulation inputs
or claiming admission, spending, dreams or arrivals.

`src/art/office-interior.ts` replaces the preparation-only sample interior.
Original two-tone walls, indoor linoleum, unobscured wall objects, service hatch,
counter, ticket dispenser and queue rails are typed integer-pixel commands.
Its embedded native Roguelike wall/candle and original seal retain their existing
lineage. The complete hatch/ledge and its native props sit32px left of their
original positions to fit the416px room without clipping upper-wall pictures;
the document is232px wide and stays below them. Native64 portraits and scenery
remain under the same integer scale1/2, with original square memorial/cradle
rails giving flat lower edges. Scene controls explicitly retain legible ink on
light paper for hover and keyboard focus. Exact geometry and current source
hashes are retained in `life-view-provenance.json`.
No optional Roguelike Indoor or UI Pixel Adventure pack is acquired or used.

Cached original/source HTML/full-license evidence remains at
`/home/kaiki/.cache/back-in-the-family/life-unfolds/portrait-sample/`.
Preparation records are not current-browser proof or replay-gate results.

