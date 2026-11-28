/// <reference lib="dom" />
/// <reference types="vite/client" />
// Production App + SimClient + LifeSurface; only transport and World geometry are
// controlled. The complete native seed1205 story and kin are not invented here.
import { mount } from 'svelte';
import App from '../../src/App.svelte';
import { SimClient } from '../../src/main/sim-client.ts';
import { createBridge } from '../../src/main/bridge.ts';
import { DEFAULT_SPEED } from '../../src/shared/speeds.ts';
import { livingWorld } from './lifecycle-carriers.ts';
import witnessBytes from './obituary-native.json?raw';
import originalReplayBytes from './obituary-original-bytes.replay.json?raw';
import continuationReplayBytes from '../../../fixtures/parity/seedP-playthrough.replay.json?raw';
import type { Reply, Request as ProtocolRequest, RunUntilStopResult, Snapshot, WorkerMessage } from '../../src/shared/protocol.ts';
import type { StoryBatch } from '../../src/shared/story.ts';
import type { WorldSnapshot } from '../../src/shared/world-snapshot.ts';
import { OBITUARY_MODEL, OBITUARY_PROMPT_SHA256, OBITUARY_PROMPT_VERSION, type ObituaryRequestV1 } from '../../src/shared/obituary.ts';
import type { Quota } from '../../../worker-api/src/judge-contract.ts';
// Actual native Dream-only resource from target/life-unfolds/obituary-dream-continuation-witness.json.
// Only changed World fields are stored; unchanged fields come from the same native deathWorld.
const dreamContinuation = JSON.parse(String.raw`{"qualification":"Actual WasmSim run_until_stop reports, original seed1205 first four inputs; no Claim submitted","seed":"1205","inputs":[{"tick":"734","seq":"0","payload":{"ChoosePlayer":{"node":"1","option":"demand_payment"}}},{"tick":"2328","seq":"1","payload":{"ChoosePlayer":{"node":"2","option":"demand_payment"}}},{"tick":"3866","seq":"2","payload":{"ChoosePlayer":{"node":"3","option":"demand_payment"}}},{"tick":"5373","seq":"3","payload":{"Dream":{"dreamer":"39","intent":"reassure"}}}],"deathChecksum":"8a1b9da5de15bb91","reports":[{"ran":1,"checksum":"cc83e38a02491a7a","stops":["dream_resolved"],"actions":[],"player_lifecycle":[],"story":{"version":1,"opening":false,"actors":[{"person":10,"soulId":"S-0010","name":"Nadine Bradley","sex":"female","origin":"native","birthDay":"-16748","ageAtDeath":"60"},{"person":37,"soulId":"S-0037","name":"Flora Jenkins","sex":"female","origin":"native","birthDay":"-10196"},{"person":39,"soulId":"S-0039","name":"Marvin Jenkins","sex":"male","origin":"native","birthDay":"-2726"},{"person":48,"soulId":"S-0048","name":"Howard Fairbanks","sex":"male","origin":"native","birthDay":"-11782"}],"events":[{"id":"2374","tick":"5373","kind":{"type":"dream","ghost":10,"dreamer":39,"price":"20"},"causedBy":[],"tags":0,"relevance":"self","relevanceBasis":"observed-day-start-end","actorContext":[{"relativeTo":10,"basis":"observed-day-start","actors":[{"person":10},{"person":39,"kinRole":"spouse"}]},{"relativeTo":10,"basis":"observed-day-end","actors":[{"person":10},{"person":39,"kinRole":"spouse"}]}]},{"id":"2375","tick":"5373","kind":{"type":"social","kind":"help","doer":48,"target":37,"intensity":51},"causedBy":[],"tags":0,"relevance":"background","relevanceBasis":"observed-day-start-end","actorContext":[{"relativeTo":10,"basis":"observed-day-start","actors":[{"person":48},{"person":37}]},{"relativeTo":10,"basis":"observed-day-end","actors":[{"person":48},{"person":37}]}]}],"chronicle":[],"dreams":[{"eventId":"2374","inputSeq":"3","tick":"5373","ghost":10,"dreamer":39,"intent":"reassure","price":"20","node":"4","interpretation":{"node":"4","tick":"5373","applied":"take_comfort","source":"rules_default","rulesDefault":"take_comfort"}}],"cursors":{"events":{"start":"2373","end":"2375"},"chronicle":{"start":"7","end":"7"}}}},{"ran":1,"checksum":"30b8aa0830e9517e","stops":[],"actions":[],"player_lifecycle":[],"story":{"version":1,"opening":false,"actors":[{"person":10,"soulId":"S-0010","name":"Nadine Bradley","sex":"female","origin":"native","birthDay":"-16748","ageAtDeath":"60"}],"events":[],"chronicle":[],"dreams":[],"cursors":{"events":{"start":"2375","end":"2375"},"chronicle":{"start":"7","end":"7"}}}}],"worldPatch":{"tick":"5375","residents":[{"id":1,"name":"Gordon Abbott","age":65,"sex":"male","alive":true,"origin":"native","traits":{"greed":-3,"loyalty":3,"pride":-1,"warmth":-3,"temper":0,"vindictiveness":-3,"piety":1},"wealth":241566,"soul_id":"S-0001","household":"1"},{"id":2,"name":"Clara Abbott","age":64,"sex":"female","alive":true,"origin":"native","traits":{"greed":2,"loyalty":0,"pride":0,"warmth":-2,"temper":-1,"vindictiveness":2,"piety":3},"wealth":10222,"soul_id":"S-0002","household":"1"},{"id":3,"name":"Bernard Abbott","age":37,"sex":"male","alive":true,"origin":"native","traits":{"greed":-3,"loyalty":-3,"pride":3,"warmth":1,"temper":0,"vindictiveness":-3,"piety":-1},"wealth":85753,"soul_id":"S-0003","household":"22"},{"id":4,"name":"Alfred Norris","age":35,"sex":"male","alive":true,"origin":"native","traits":{"greed":2,"loyalty":1,"pride":-2,"warmth":-3,"temper":-1,"vindictiveness":-1,"piety":2},"wealth":103692,"soul_id":"S-0004","household":"26"},{"id":5,"name":"Helen Coleman","age":47,"sex":"female","alive":true,"origin":"native","traits":{"greed":1,"loyalty":-3,"pride":2,"warmth":-1,"temper":-3,"vindictiveness":-2,"piety":-3},"wealth":72223,"soul_id":"S-0005","household":"25"},{"id":6,"name":"Margaret Doyle","age":53,"sex":"female","alive":true,"origin":"native","traits":{"greed":-2,"loyalty":3,"pride":-3,"warmth":-3,"temper":-3,"vindictiveness":-2,"piety":2},"wealth":153538,"soul_id":"S-0006","household":"4"},{"id":7,"name":"Francis Doyle","age":58,"sex":"male","alive":true,"origin":"native","traits":{"greed":1,"loyalty":2,"pride":-2,"warmth":2,"temper":-3,"vindictiveness":-2,"piety":3},"wealth":0,"soul_id":"S-0007","household":"4"},{"id":8,"name":"Ivy Doyle","age":19,"sex":"female","alive":true,"origin":"native","traits":{"greed":0,"loyalty":2,"pride":3,"warmth":0,"temper":1,"vindictiveness":-1,"piety":2},"wealth":10179,"soul_id":"S-0008","household":"32"},{"id":9,"name":"Bernice Doyle","age":32,"sex":"female","alive":true,"origin":"native","traits":{"greed":-1,"loyalty":-1,"pride":-1,"warmth":-1,"temper":3,"vindictiveness":0,"piety":0},"wealth":136968,"soul_id":"S-0009","household":"22"},{"id":12,"name":"Marcus Bradley","age":29,"sex":"male","alive":true,"origin":"native","traits":{"greed":1,"loyalty":-3,"pride":-3,"warmth":-2,"temper":1,"vindictiveness":0,"piety":-3},"wealth":220133,"soul_id":"S-0012","household":"27"},{"id":13,"name":"Elise Boone","age":66,"sex":"female","alive":true,"origin":"native","traits":{"greed":2,"loyalty":-2,"pride":-2,"warmth":3,"temper":0,"vindictiveness":-1,"piety":3},"wealth":206153,"soul_id":"S-0013","household":"6"},{"id":14,"name":"Felix Boone","age":67,"sex":"male","alive":true,"origin":"native","traits":{"greed":3,"loyalty":-2,"pride":-3,"warmth":2,"temper":1,"vindictiveness":2,"piety":0},"wealth":149049,"soul_id":"S-0014","household":"6"},{"id":15,"name":"Marion Boone","age":55,"sex":"female","alive":true,"origin":"native","traits":{"greed":3,"loyalty":-2,"pride":3,"warmth":-2,"temper":-2,"vindictiveness":-1,"piety":2},"wealth":108203,"soul_id":"S-0015","household":"24"},{"id":16,"name":"Martha Cooper","age":58,"sex":"female","alive":true,"origin":"native","traits":{"greed":1,"loyalty":3,"pride":1,"warmth":-3,"temper":2,"vindictiveness":3,"piety":0},"wealth":205621,"soul_id":"S-0016","household":"8"},{"id":17,"name":"Frank Cooper","age":56,"sex":"male","alive":true,"origin":"native","traits":{"greed":0,"loyalty":0,"pride":3,"warmth":-2,"temper":1,"vindictiveness":-2,"piety":-1},"wealth":21445,"soul_id":"S-0017","household":"8"},{"id":18,"name":"Opal Cooper","age":27,"sex":"female","alive":true,"origin":"native","traits":{"greed":-3,"loyalty":3,"pride":-1,"warmth":-1,"temper":1,"vindictiveness":-3,"piety":-1},"wealth":48319,"soul_id":"S-0018","household":"29"},{"id":19,"name":"Jasper Ellis","age":80,"sex":"male","alive":true,"origin":"native","traits":{"greed":-3,"loyalty":-1,"pride":0,"warmth":1,"temper":1,"vindictiveness":-2,"piety":0},"wealth":85000,"soul_id":"S-0019","household":"9"},{"id":20,"name":"Mabel Pierce","age":37,"sex":"female","alive":true,"origin":"native","traits":{"greed":-2,"loyalty":3,"pride":-2,"warmth":2,"temper":-1,"vindictiveness":-2,"piety":-3},"wealth":199437,"soul_id":"S-0020","household":"23"},{"id":21,"name":"Olive Cooper","age":75,"sex":"female","alive":true,"origin":"native","traits":{"greed":-2,"loyalty":-2,"pride":2,"warmth":0,"temper":-1,"vindictiveness":-1,"piety":-2},"wealth":65893,"soul_id":"S-0021","household":"11"},{"id":22,"name":"Charles Cooper","age":78,"sex":"male","alive":true,"origin":"native","traits":{"greed":-3,"loyalty":2,"pride":1,"warmth":-2,"temper":0,"vindictiveness":-2,"piety":0},"wealth":0,"soul_id":"S-0022","household":"11"},{"id":23,"name":"Cora Cooper","age":31,"sex":"female","alive":true,"origin":"native","traits":{"greed":0,"loyalty":0,"pride":-3,"warmth":2,"temper":-3,"vindictiveness":-1,"piety":-3},"wealth":54147,"soul_id":"S-0023","household":"24"},{"id":24,"name":"Lucy Cooper","age":28,"sex":"female","alive":true,"origin":"native","traits":{"greed":2,"loyalty":-2,"pride":0,"warmth":-1,"temper":3,"vindictiveness":-2,"piety":-3},"wealth":70707,"soul_id":"S-0024","household":"26"},{"id":26,"name":"Lloyd Barrett","age":48,"sex":"male","alive":true,"origin":"native","traits":{"greed":-3,"loyalty":0,"pride":-3,"warmth":-1,"temper":2,"vindictiveness":3,"piety":-1},"wealth":85000,"soul_id":"S-0026","household":"31"},{"id":28,"name":"Faye Adler","age":70,"sex":"female","alive":true,"origin":"native","traits":{"greed":2,"loyalty":2,"pride":1,"warmth":-3,"temper":-1,"vindictiveness":0,"piety":-1},"wealth":177530,"soul_id":"S-0028","household":"23"},{"id":29,"name":"Chester Cooper","age":39,"sex":"male","alive":true,"origin":"native","traits":{"greed":-1,"loyalty":-1,"pride":2,"warmth":0,"temper":-3,"vindictiveness":0,"piety":0},"wealth":142425,"soul_id":"S-0029","household":"15"},{"id":30,"name":"Nancy Cooper","age":45,"sex":"female","alive":true,"origin":"native","traits":{"greed":0,"loyalty":2,"pride":3,"warmth":2,"temper":3,"vindictiveness":-1,"piety":1},"wealth":83493,"soul_id":"S-0030","household":"15"},{"id":31,"name":"Maude Cooper","age":15,"sex":"female","alive":true,"origin":"native","traits":{"greed":1,"loyalty":2,"pride":-1,"warmth":3,"temper":-2,"vindictiveness":2,"piety":-1},"wealth":0,"soul_id":"S-0031","household":"15"},{"id":32,"name":"Ella Cooper","age":21,"sex":"female","alive":true,"origin":"native","traits":{"greed":-3,"loyalty":2,"pride":-3,"warmth":3,"temper":-3,"vindictiveness":0,"piety":2},"wealth":26849,"soul_id":"S-0032","household":"31"},{"id":33,"name":"Lois Cooper","age":19,"sex":"female","alive":true,"origin":"native","traits":{"greed":3,"loyalty":0,"pride":-1,"warmth":1,"temper":-2,"vindictiveness":1,"piety":2},"wealth":3774,"soul_id":"S-0033","household":"32"},{"id":35,"name":"Bella Stanton","age":60,"sex":"female","alive":true,"origin":"native","traits":{"greed":-1,"loyalty":3,"pride":-2,"warmth":0,"temper":-3,"vindictiveness":-2,"piety":-1},"wealth":249630,"soul_id":"S-0035","household":"29"},{"id":36,"name":"Lucas Stanton","age":17,"sex":"male","alive":true,"origin":"native","traits":{"greed":3,"loyalty":-3,"pride":1,"warmth":0,"temper":-3,"vindictiveness":0,"piety":2},"wealth":34632,"soul_id":"S-0036","household":"29"},{"id":37,"name":"Flora Jenkins","age":42,"sex":"female","alive":true,"origin":"native","traits":{"greed":-2,"loyalty":3,"pride":1,"warmth":-2,"temper":-1,"vindictiveness":-3,"piety":2},"wealth":135894,"soul_id":"S-0037","household":"17"},{"id":38,"name":"Conrad Jenkins","age":41,"sex":"male","alive":true,"origin":"native","traits":{"greed":0,"loyalty":-1,"pride":3,"warmth":2,"temper":0,"vindictiveness":2,"piety":1},"wealth":44669,"soul_id":"S-0038","household":"17"},{"id":39,"name":"Marvin Jenkins","age":22,"sex":"male","alive":true,"origin":"native","traits":{"greed":1,"loyalty":0,"pride":-2,"warmth":3,"temper":-2,"vindictiveness":0,"piety":0},"wealth":125329,"soul_id":"S-0039","household":"30"},{"id":40,"name":"Lucas Harper","age":43,"sex":"male","alive":true,"origin":"native","traits":{"greed":0,"loyalty":-1,"pride":-3,"warmth":2,"temper":0,"vindictiveness":3,"piety":-2},"wealth":114511,"soul_id":"S-0040","household":"18"},{"id":41,"name":"Mabel Harper","age":48,"sex":"female","alive":true,"origin":"native","traits":{"greed":1,"loyalty":-1,"pride":3,"warmth":3,"temper":0,"vindictiveness":2,"piety":-1},"wealth":1494,"soul_id":"S-0041","household":"18"},{"id":42,"name":"Amelia Keller","age":60,"sex":"female","alive":true,"origin":"native","traits":{"greed":1,"loyalty":-2,"pride":-1,"warmth":-1,"temper":3,"vindictiveness":-3,"piety":-2},"wealth":186398,"soul_id":"S-0042","household":"25"},{"id":45,"name":"Bernice Rhodes","age":26,"sex":"female","alive":true,"origin":"native","traits":{"greed":0,"loyalty":0,"pride":3,"warmth":0,"temper":-1,"vindictiveness":-2,"piety":3},"wealth":60011,"soul_id":"S-0045","household":"28"},{"id":46,"name":"Kate Rhodes","age":26,"sex":"female","alive":true,"origin":"native","traits":{"greed":-2,"loyalty":-1,"pride":-3,"warmth":1,"temper":-1,"vindictiveness":2,"piety":2},"wealth":34401,"soul_id":"S-0046","household":"27"},{"id":47,"name":"Edith Fairbanks","age":42,"sex":"female","alive":true,"origin":"native","traits":{"greed":-3,"loyalty":2,"pride":-2,"warmth":-3,"temper":-2,"vindictiveness":2,"piety":-1},"wealth":159045,"soul_id":"S-0047","household":"21"},{"id":48,"name":"Howard Fairbanks","age":47,"sex":"male","alive":true,"origin":"native","traits":{"greed":0,"loyalty":2,"pride":2,"warmth":-1,"temper":-3,"vindictiveness":-3,"piety":-1},"wealth":81731,"soul_id":"S-0048","household":"21"},{"id":49,"name":"Holly Fairbanks","age":24,"sex":"female","alive":true,"origin":"native","traits":{"greed":3,"loyalty":1,"pride":3,"warmth":-2,"temper":2,"vindictiveness":-3,"piety":3},"wealth":47820,"soul_id":"S-0049","household":"28"},{"id":52,"name":"Olive Jenkins","age":13,"sex":"female","alive":true,"origin":"native","traits":{"greed":0,"loyalty":3,"pride":3,"warmth":-2,"temper":1,"vindictiveness":-3,"piety":1},"wealth":0,"soul_id":"S-0051","household":"17"},{"id":53,"name":"Opal Coleman","age":13,"sex":"female","alive":true,"origin":"native","traits":{"greed":1,"loyalty":-2,"pride":2,"warmth":-1,"temper":-3,"vindictiveness":-2,"piety":2},"wealth":0,"soul_id":"S-0052","household":"25"},{"id":54,"name":"Dana Fairbanks","age":10,"sex":"female","alive":true,"origin":"native","traits":{"greed":-3,"loyalty":-2,"pride":-2,"warmth":-3,"temper":-3,"vindictiveness":-2,"piety":2},"wealth":0,"soul_id":"S-0027","household":"21"},{"id":55,"name":"Julian Cooper","age":8,"sex":"male","alive":true,"origin":"native","traits":{"greed":0,"loyalty":2,"pride":-3,"warmth":-2,"temper":-2,"vindictiveness":2,"piety":0},"wealth":0,"soul_id":"S-0050","household":"24"},{"id":56,"name":"Mae Cooper","age":7,"sex":"female","alive":true,"origin":"native","traits":{"greed":2,"loyalty":1,"pride":-2,"warmth":-3,"temper":-1,"vindictiveness":-2,"piety":2},"wealth":0,"soul_id":"S-0044","household":"26"},{"id":57,"name":"Frances Jenkins","age":5,"sex":"female","alive":true,"origin":"native","traits":{"greed":0,"loyalty":-1,"pride":1,"warmth":2,"temper":0,"vindictiveness":-3,"piety":0},"wealth":0,"soul_id":"S-0034","household":"17"},{"id":58,"name":"Ben Rhodes","age":3,"sex":"male","alive":true,"origin":"native","traits":{"greed":-2,"loyalty":3,"pride":-3,"warmth":-2,"temper":1,"vindictiveness":-3,"piety":2},"wealth":0,"soul_id":"S-0043","household":"27"},{"id":59,"name":"Leo Rhodes","age":1,"sex":"male","alive":true,"origin":"native","traits":{"greed":1,"loyalty":-3,"pride":-3,"warmth":2,"temper":-1,"vindictiveness":0,"piety":-3},"wealth":0,"soul_id":"S-0011","household":"27"},{"id":60,"name":"Laura Coleman","age":1,"sex":"female","alive":true,"origin":"native","traits":{"greed":1,"loyalty":-3,"pride":-1,"warmth":-1,"temper":-3,"vindictiveness":2,"piety":-3},"wealth":0,"soul_id":"S-0025","household":"25"}],"joss":[{"soul_id":"S-0001","balance":"0"},{"soul_id":"S-0002","balance":"0"},{"soul_id":"S-0003","balance":"0"},{"soul_id":"S-0004","balance":"0"},{"soul_id":"S-0005","balance":"0"},{"soul_id":"S-0006","balance":"0"},{"soul_id":"S-0007","balance":"0"},{"soul_id":"S-0008","balance":"0"},{"soul_id":"S-0009","balance":"0"},{"soul_id":"S-0010","balance":"106"},{"soul_id":"S-0011","balance":"3"},{"soul_id":"S-0012","balance":"0"},{"soul_id":"S-0013","balance":"0"},{"soul_id":"S-0014","balance":"0"},{"soul_id":"S-0015","balance":"0"},{"soul_id":"S-0016","balance":"0"},{"soul_id":"S-0017","balance":"0"},{"soul_id":"S-0018","balance":"0"},{"soul_id":"S-0019","balance":"0"},{"soul_id":"S-0020","balance":"0"},{"soul_id":"S-0021","balance":"0"},{"soul_id":"S-0022","balance":"0"},{"soul_id":"S-0023","balance":"0"},{"soul_id":"S-0024","balance":"0"},{"soul_id":"S-0025","balance":"15"},{"soul_id":"S-0026","balance":"0"},{"soul_id":"S-0027","balance":"0"},{"soul_id":"S-0028","balance":"0"},{"soul_id":"S-0029","balance":"0"},{"soul_id":"S-0030","balance":"0"},{"soul_id":"S-0031","balance":"0"},{"soul_id":"S-0032","balance":"0"},{"soul_id":"S-0033","balance":"0"},{"soul_id":"S-0034","balance":"0"},{"soul_id":"S-0035","balance":"0"},{"soul_id":"S-0036","balance":"0"},{"soul_id":"S-0037","balance":"0"},{"soul_id":"S-0038","balance":"0"},{"soul_id":"S-0039","balance":"0"},{"soul_id":"S-0040","balance":"0"},{"soul_id":"S-0041","balance":"0"},{"soul_id":"S-0042","balance":"0"},{"soul_id":"S-0043","balance":"8"},{"soul_id":"S-0044","balance":"19"},{"soul_id":"S-0045","balance":"0"},{"soul_id":"S-0046","balance":"0"},{"soul_id":"S-0047","balance":"0"},{"soul_id":"S-0048","balance":"0"},{"soul_id":"S-0049","balance":"0"},{"soul_id":"S-0050","balance":"22"},{"soul_id":"S-0051","balance":"0"},{"soul_id":"S-0052","balance":"0"}],"player":{"place":"waiting","body":null,"earlier_bodies":[{"id":10,"name":"Nadine Bradley","origin":"native","death":"5372"}],"blood_ties":[],"relations":[],"past_life_ties":[{"rememberer":1,"earlier_body":10,"affinity":0},{"rememberer":2,"earlier_body":10,"affinity":0},{"rememberer":3,"earlier_body":10,"affinity":0},{"rememberer":4,"earlier_body":10,"affinity":0},{"rememberer":5,"earlier_body":10,"affinity":0},{"rememberer":7,"earlier_body":10,"affinity":0},{"rememberer":9,"earlier_body":10,"affinity":0},{"rememberer":12,"earlier_body":10,"affinity":0},{"rememberer":13,"earlier_body":10,"affinity":0},{"rememberer":19,"earlier_body":10,"affinity":0},{"rememberer":20,"earlier_body":10,"affinity":0},{"rememberer":21,"earlier_body":10,"affinity":0},{"rememberer":24,"earlier_body":10,"affinity":0},{"rememberer":29,"earlier_body":10,"affinity":0},{"rememberer":36,"earlier_body":10,"affinity":-4},{"rememberer":38,"earlier_body":10,"affinity":8},{"rememberer":39,"earlier_body":10,"affinity":46},{"rememberer":41,"earlier_body":10,"affinity":0},{"rememberer":42,"earlier_body":10,"affinity":0},{"rememberer":45,"earlier_body":10,"affinity":0},{"rememberer":52,"earlier_body":10,"affinity":0},{"rememberer":58,"earlier_body":10,"affinity":5},{"rememberer":59,"earlier_body":10,"affinity":21}]},"underworld_view":{"dream_price":"20","connected":[1,2,3,4,5,7,9,12,13,19,20,21,24,29,36,38,39,41,42,45,52,58,59],"ghost_traits":{"greed":3,"loyalty":3,"pride":-3,"warmth":1,"temper":3,"vindictiveness":-3,"piety":0},"slots":[{"slot":"imported_vessel","kind":"imported_vessel","price":"100","birth":null,"status":{"announced":true,"claimable":true,"affordable":true,"needed":[]}},{"slot":"rebuilt_body","kind":"rebuilt_body","price":"400","birth":null,"status":{"announced":true,"claimable":true,"affordable":false,"needed":[{"kind":"joss_short","amount":"294"}]}}],"base_traits":[{"carry_over":null,"traits":{"greed":1,"loyalty":1,"pride":2,"warmth":1,"temper":-2,"vindictiveness":1,"piety":3}},{"carry_over":"greed","traits":{"greed":3,"loyalty":1,"pride":2,"warmth":1,"temper":-2,"vindictiveness":1,"piety":3}},{"carry_over":"loyalty","traits":{"greed":1,"loyalty":3,"pride":2,"warmth":1,"temper":-2,"vindictiveness":1,"piety":3}},{"carry_over":"pride","traits":{"greed":1,"loyalty":1,"pride":-3,"warmth":1,"temper":-2,"vindictiveness":1,"piety":3}},{"carry_over":"warmth","traits":{"greed":1,"loyalty":1,"pride":2,"warmth":1,"temper":-2,"vindictiveness":1,"piety":3}},{"carry_over":"temper","traits":{"greed":1,"loyalty":1,"pride":2,"warmth":1,"temper":3,"vindictiveness":1,"piety":3}},{"carry_over":"vindictiveness","traits":{"greed":1,"loyalty":1,"pride":2,"warmth":1,"temper":-2,"vindictiveness":-3,"piety":3}},{"carry_over":"piety","traits":{"greed":1,"loyalty":1,"pride":2,"warmth":1,"temper":-2,"vindictiveness":1,"piety":0}}],"actions":{"version":1,"capped_spend":{"cap_year":"14","yearly_cap":"500","spent":"0","remaining":"500"},"bribe":{"min_amount":"1","max_amount":"106","availability":{"eligible":true,"reason":null}},"haunt":{"price":"40","targets":[{"target":1,"availability":{"eligible":true,"reason":null}},{"target":2,"availability":{"eligible":true,"reason":null}},{"target":3,"availability":{"eligible":true,"reason":null}},{"target":4,"availability":{"eligible":true,"reason":null}},{"target":5,"availability":{"eligible":true,"reason":null}},{"target":7,"availability":{"eligible":true,"reason":null}},{"target":9,"availability":{"eligible":true,"reason":null}},{"target":12,"availability":{"eligible":true,"reason":null}},{"target":13,"availability":{"eligible":true,"reason":null}},{"target":19,"availability":{"eligible":true,"reason":null}},{"target":20,"availability":{"eligible":true,"reason":null}},{"target":21,"availability":{"eligible":true,"reason":null}},{"target":24,"availability":{"eligible":true,"reason":null}},{"target":29,"availability":{"eligible":true,"reason":null}},{"target":36,"availability":{"eligible":true,"reason":null}},{"target":38,"availability":{"eligible":true,"reason":null}},{"target":39,"availability":{"eligible":true,"reason":null}},{"target":41,"availability":{"eligible":true,"reason":null}},{"target":42,"availability":{"eligible":true,"reason":null}},{"target":45,"availability":{"eligible":true,"reason":null}},{"target":52,"availability":{"eligible":true,"reason":null}},{"target":58,"availability":{"eligible":true,"reason":null}},{"target":59,"availability":{"eligible":true,"reason":null}}]}}},"last_dream":{"tick":"5373","dreamer":39,"applied":"take_comfort"}}}`) as {
  qualification: string; seed: string; inputs: unknown[]; deathChecksum: string;
  reports: RunUntilStopResult[]; worldPatch: Partial<WorldSnapshot>;
};

const witness = JSON.parse(witnessBytes) as {
  seed: string; completedTicks: string; checksum: string; config: unknown;
  inputs: unknown[]; openingBatch: StoryBatch; observedBatches: RunUntilStopResult[];
  continuation: { seed: string; deathChecksum: string; checksum: string; completedTicks: string;
    openingWorld: WorldSnapshot; deathWorld: WorldSnapshot; finalWorld: WorldSnapshot; afterDeath: RunUntilStopResult[] };
};
const final = witness.observedBatches.find(value => value.story.ownDeathSummaries?.length)!;
const death = final.player_lifecycle.find(value => value.kind === 'death')!;
if (witness.seed !== '1205' || witness.checksum !== '8a1b9da5de15bb91' || death.event !== '2368') throw Error('Missing complete native obituary authority');
if (witness.continuation.seed !== witness.seed || witness.continuation.deathChecksum !== witness.checksum
  || witness.continuation.checksum !== '7bd7c1b9b007eb0f') throw Error('Native continuation does not bind the same run');
if (dreamContinuation.seed !== witness.seed || dreamContinuation.deathChecksum !== witness.checksum
  || dreamContinuation.inputs.length !== 4 || dreamContinuation.worldPatch.tick !== '5375'
  || dreamContinuation.worldPatch.player?.place !== 'waiting'
  || dreamContinuation.reports.some(value => value.player_lifecycle.length !== 0)) throw Error('Dream continuation must preserve the original waiting ghost');
// Representation-only normalization matches the existing life-view fixture.
const canonical = (value: string) => /^S-\d+$/.test(value) ? BigInt(value.slice(2)).toString() : value;
function batch(value: StoryBatch): StoryBatch {
  return { ...structuredClone(value), actors: value.actors.map(actor => ({ ...actor, soulId: canonical(actor.soulId) })) };
}
const opening = livingWorld(witness.continuation.openingWorld);
const past = witness.observedBatches.filter(value => value !== final).map(value => batch(value.story));
const beforeDeath: StoryBatch = {
  ...batch(final.story), ownDeathSummaries: undefined,
  // Age-at-death is admitted with the complete death day, not in setup.
  actors: batch(final.story).actors.map(actor => {
    if (actor.person !== death.body) return actor;
    const { ageAtDeath: _age, ...living } = actor; return living;
  }),
  events: final.story.events.filter(event => BigInt(event.tick) < BigInt(death.tick)),
  chronicle: final.story.chronicle.filter(record => BigInt(record.tick) < BigInt(death.tick)),
  cursors: { events: { start: final.story.cursors.events.start, end: String(BigInt(death.event) - 1n) }, chronicle: final.story.cursors.chronicle },
};
const completeDay: StoryBatch = {
  ...batch(final.story),
  events: final.story.events.filter(event => BigInt(event.tick) >= BigInt(death.tick)),
  chronicle: final.story.chronicle.filter(record => BigInt(record.tick) >= BigInt(death.tick)),
};
const initialWorld = { ...opening, tick: death.tick, player_node: null };
const deadWorld = livingWorld(witness.continuation.deathWorld);
const search = new URLSearchParams(location.search);
const capabilityMode = search.get('capability');
const publicMode = capabilityMode === 'public';
const mode = search.get('reply') ?? 'pending';
let holdExportReplies = search.get('hold-export-replies') === '1';
// Deferred-GET cases wait for the real operation digest before advancing the
// controlled clock. The ledger need not rerender its technical DOM on key setup.
const operationDigests: Promise<ArrayBuffer>[] = [];
if (capabilityMode === 'deferred') {
  const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
  crypto.subtle.digest = (algorithm, data) => {
    const promise = nativeDigest(algorithm, data);
    operationDigests.push(promise);
    return promise;
  };
}
// Quota days follow the controlled browser wall clock, never a stale fixture day.
const quota = (dailyRemaining = 40): Quota => {
  const today = new Date(Date.now());
  const reset = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1);
  return { utc_day: today.toISOString().slice(0, 10), reset_at_ms: reset, daily_limit: 40,
    daily_remaining: dailyRemaining, session_limit: 10, session_remaining: capabilityMode === 'quota-reset' ? 8 : 10 };
};
const nativeFetch = window.fetch.bind(window);
const http: { method: string; path: string; body: ObituaryRequestV1 | null }[] = [];
const responses: { resolve(response: Response): void; request: ObituaryRequestV1 }[] = [];
const capabilityResponses: { resolve(response: Response): void }[] = [];
const capabilityReplies: { status: number; quota: Quota | null }[] = [];
function capabilityResponse(kind = 'enabled', dailyRemaining = 40): Response {
  const value = kind === 'enabled' ? quota(dailyRemaining) : null;
  const status = kind === 'enabled' ? 200 : kind === 'public' ? 404 : 503;
  capabilityReplies.push({ status, quota: value });
  return value === null ? new Response(null, { status })
    : Response.json({ version: 1, enabled: dailyRemaining > 0, model: OBITUARY_MODEL,
      disabledReason: dailyRemaining > 0 ? null : 'quota_exhausted', timeout_ms: 10000, quota: value });
}
const acceptedText = 'Nadine Bradley, 60, died on Year 15, Day 263. She is survived by her husband, Marvin Jenkins, her son, Marcus Bradley, and her grandsons, Ben Rhodes and Leo Rhodes. She was preceded in death by her husband, Clifford Bradley. Her estate was 229,012 dollars. Two people burned joss on the day she died.';
function providerResponse(request: ObituaryRequestV1, kind: string): Response {
  if (kind === 'provider-error') return Response.json({ version: 1, error: 'provider_error' }, { status: 503 });
  const text = kind === 'invalid' ? '<p>Not an obituary.</p>' : acceptedText;
  return Response.json({ version: 1, operationKey: request.operationKey, quota: quota(),
    result: { text, source: 'model', fallbackReason: null, model: OBITUARY_MODEL, promptVersion: OBITUARY_PROMPT_VERSION, promptSha256: OBITUARY_PROMPT_SHA256 } });
}
// All simulated API calls stay in-page. The original fetch is used only for
// same-origin non-API assets; no credentials, provider or external origin exists.
const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const method = init?.method ?? 'GET';
  if (url.origin !== location.origin) throw Error('External request refused by obituary fixture');
  if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) as ObituaryRequestV1 : null;
  http.push({ method, path: url.pathname, body });
  if (url.pathname === '/api/judge/obituary/config' && method === 'GET') {
    if (capabilityMode === 'deferred') {
      const { promise, resolve } = Promise.withResolvers<Response>();
      capabilityResponses.push({ resolve });
      return promise;
    }
    return capabilityResponse(publicMode ? 'public' : 'enabled',
      capabilityMode === 'quota-reset' && http.filter(value => value.path === url.pathname).length === 1 ? 0 : 40);
  }
  if (url.pathname !== '/api/obituary' || method !== 'POST' || body === null) throw Error('Unexpected local obituary route');
  if (mode !== 'pending') return providerResponse(body, mode);
  const { promise, resolve } = Promise.withResolvers<Response>();
  responses.push({ resolve, request: body });
  return promise;
};
window.fetch = fakeFetch;
const bridge = createBridge();
const wire = new EventTarget() as EventTarget & { postMessage(request: ProtocolRequest): void; terminate(): void };
const sent: ProtocolRequest[] = [];
const pending = new Map<number, ProtocolRequest>();
const exportReplies: { id: number; replay: string; tick: string | null }[] = [];
let world: WorldSnapshot = initialWorld;
let snapshot: Snapshot = { worldId: 0, runState: 'no-world', tick: null, checksum: null, tps: null,
  speed: DEFAULT_SPEED, playerNode: { pending: false }, actions: [], playerLifecycle: [] };
const emit = (message: WorkerMessage) => wire.dispatchEvent(new MessageEvent('message', { data: structuredClone(message) }));
function currentSnapshot(patch: Partial<Snapshot> = {}): Snapshot {
  return { ...snapshot, actions: [], playerLifecycle: [], story: undefined, stop: undefined, ...patch };
}
function replyExport(request: ProtocolRequest): void {
  if (request.type !== 'export-replay') throw Error('Missing export ticket');
  exportReplies.push({ id: request.id, replay: replayBytes, tick: snapshot.tick });
  emit({ type: 'reply', id: request.id, ok: true, snapshot: currentSnapshot(), replay: replayBytes });
}
wire.postMessage = request => {
  sent.push(request);
  if (request.type === 'export-replay') {
    if (holdExportReplies) pending.set(request.id, request);
    else queueMicrotask(() => replyExport(request));
  } else if (request.type === 'decision-status' || request.type === 'world-snapshot') {
    queueMicrotask(() => emit({ type: 'reply', id: request.id, ok: true, snapshot: currentSnapshot(),
      ...(request.type === 'world-snapshot' ? { world } : {}) }));
  } else pending.set(request.id, request);
};
wire.terminate = () => {};
let replayBytes = originalReplayBytes;
const dreamReplay = JSON.parse(originalReplayBytes) as { ticks: string; inputs: unknown[]; checksums: string[] };
dreamReplay.ticks = dreamContinuation.worldPatch.tick!;
dreamReplay.inputs = dreamContinuation.inputs;
dreamReplay.checksums.push(...dreamContinuation.reports.map(value => value.checksum));
const harness = {
  read() { return structuredClone({ source: {
    mode: 'PRODUCTION-APP / DETERMINISTIC-TRANSPORT / ACTUAL-NATIVE-FACTS',
    witness: 'web/tests/fixtures/obituary-native.json', checksum: witness.checksum,
    qualification: 'Complete native story/kin and same-run actual WASM death/rebirth Worlds preserved; Dream-only native reports and changed World fields bind the original death checksum. Soul IDs normalized, opening clock carrier, quota wall clock and API/delivery timing controlled. No live Worker/provider run.',
    dream: { qualification: dreamContinuation.qualification, inputs: dreamContinuation.inputs, deathChecksum: dreamContinuation.deathChecksum },
  }, sent, http, snapshot, world, death, acceptedText, replayBytes, exportReplies, capabilityReplies }); },
  create(id: number, success = true) {
    const request = pending.get(id);
    if (request?.type !== 'create-world') throw Error('Missing Create ticket');
    pending.delete(id);
    if (!success) { emit({ type: 'reply', id, ok: false, kind: 'sim-error', error: 'Controlled Create rejection', snapshot: currentSnapshot() }); return; }
    world = structuredClone(initialWorld);
    replayBytes = originalReplayBytes;
    snapshot = currentSnapshot({ worldId: snapshot.worldId + 1, tick: world.tick, checksum: witness.checksum, runState: 'paused' });
    emit({ type: 'reply', id, ok: true, world, snapshot: { ...snapshot,
      story: [witness.openingBatch, ...past, beforeDeath].map(value => ({ worldId: snapshot.worldId, batch: batch(value) })) } });
  },
  death(withSummary = true) {
    world = structuredClone(deadWorld);
    snapshot = currentSnapshot({ tick: world.tick, runState: 'paused' });
    const value = structuredClone(completeDay);
    if (!withSummary) delete value.ownDeathSummaries;
    emit({ type: 'status', snapshot: { ...snapshot, stop: { reasons: ['player_died'], world },
      playerLifecycle: [death], story: [{ worldId: snapshot.worldId, batch: value }] } });
  },
  summaryFirst() {
    world = structuredClone(deadWorld);
    snapshot = currentSnapshot({ tick: world.tick, runState: 'paused' });
    emit({ type: 'status', snapshot: { ...snapshot, story: [{ worldId: snapshot.worldId, batch: completeDay }] } });
  },
  lifecycleAfterSummary() {
    emit({ type: 'status', snapshot: { ...currentSnapshot(), stop: { reasons: ['player_died'], world }, playerLifecycle: [death] } });
  },
  redeliver() { this.death(); },
  rebirth() {
    world = livingWorld(witness.continuation.finalWorld);
    snapshot = currentSnapshot({ tick: world.tick, checksum: witness.continuation.checksum, runState: 'paused' });
    replayBytes = continuationReplayBytes;
    emit({ type: 'status', snapshot: { ...snapshot, stop: { reasons: ['dream_resolved', 'player_reborn'], world },
      playerLifecycle: witness.continuation.afterDeath.flatMap(value => value.player_lifecycle),
      story: witness.continuation.afterDeath.map(value => ({ worldId: snapshot.worldId, batch: batch(value.story) })) } });
  },
  resolveCapability(kind = 'enabled', index = 0) {
    const response = capabilityResponses[index];
    if (!response) throw Error('Missing deferred initial capability GET');
    response.resolve(capabilityResponse(kind));
  },
  async waitForOperationDigest() {
    const digest = operationDigests.at(-1);
    if (digest === undefined) throw Error('Missing actual obituary operation digest');
    await digest;
  },
  releaseExport(id: number) {
    const request = pending.get(id);
    if (request?.type !== 'export-replay') throw Error('Missing held export request');
    pending.delete(id);
    holdExportReplies = false;
    replyExport(request);
  },
  resolve(kind = 'accepted', index = 0) {
    const response = responses[index];
    if (!response) throw Error('Missing pending obituary response');
    response.resolve(providerResponse(response.request, kind));
  },
  dream(id: number) {
    const request = pending.get(id);
    const receipt = dreamContinuation.reports[0]!.story.dreams[0]!;
    if (request?.type !== 'dream' || request.dreamer !== receipt.dreamer || request.intent !== receipt.intent) {
      throw Error('Dream ticket does not match the actual native input');
    }
    pending.delete(id);
    world = livingWorld({ ...witness.continuation.deathWorld, ...dreamContinuation.worldPatch });
    if (world.player_wait?.ghost !== death.body) throw Error('Native Dream changed the waiting ghost');
    replayBytes = JSON.stringify(dreamReplay);
    snapshot = currentSnapshot({ tick: world.tick, checksum: dreamContinuation.reports.at(-1)!.checksum, runState: 'paused' });
    emit({ type: 'reply', id, ok: true, submission: { tick: receipt.tick, seqs: [receipt.inputSeq] }, snapshot: {
      ...snapshot, stop: { reasons: ['dream_resolved'], world },
      playerLifecycle: dreamContinuation.reports.flatMap(value => value.player_lifecycle),
      story: dreamContinuation.reports.map(value => ({ worldId: snapshot.worldId, batch: batch(value.story) })),
    } });
  },
  reply(id: number) {
    const request = pending.get(id);
    if (!request) throw Error('Missing gameplay ticket');
    pending.delete(id);
    snapshot = currentSnapshot({ ...(request.type === 'run' ? { runState: 'running' } : {}),
      ...(request.type === 'set-speed' ? { speed: request.speed } : {}) });
    const message: Reply = { type: 'reply', id, ok: true, snapshot,
      ...(['bribe', 'haunt', 'dream', 'claim'].includes(request.type) ? { submission: { tick: snapshot.tick!, seqs: ['3'] } } : {}) };
    emit(message);
  },
  oldStatus(worldId: number) { emit({ type: 'status', snapshot: { ...currentSnapshot(), worldId, stop: { reasons: ['player_died'], world: deadWorld }, playerLifecycle: [death], story: [{ worldId, batch: completeDay }] } }); },
};
declare global { interface Window { __obituaryFixture: typeof harness } }
window.__obituaryFixture = harness;
const client = new SimClient({ onStatus: value => bridge.dispatch?.({ type: 'status', snapshot: value }),
  onFatal: error => bridge.dispatch?.({ type: 'fatal', error }), onError: error => bridge.dispatch?.({ type: 'worker-error', error }) }, wire as unknown as Worker);
mount(App, { target: document.getElementById('fixture')!, props: { client, bridge } });
