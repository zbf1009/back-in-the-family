//! Synthetic grading fixtures: `grading-outputs` and `grading-golden` (llm-probe task 5.3).
//!
//! * `grading-outputs` reads the Dev_Cards (`eval/cards/cards/dev.jsonl`) and writes
//!   `fixtures/grading/dev-outputs.json`: for every card, valid outputs built from its
//!   acceptable options and gold patterns, and Illegal outputs from a fixed list of
//!   mutations. Nothing comes from a model.
//! * `grading-golden` reads the same cards and that outputs file, runs every
//!   `sim_core::llm::api` export on every card x output, and writes
//!   `fixtures/grading/dev-golden.json` with the exact result bytes.
//!
//! Both are deterministic: no clock, no randomness, sorted object keys (`serde_json`
//! without `preserve_order`), stable list order, one trailing newline. The files are
//! regenerated only on purpose, with `scripts/regen-grading-golden.sh`; tests never write
//! them. Only the Dev_Cards are read here, never the locked split.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::Path;

use serde_json::{Map, Value, json};
use sim_core::llm::api;
use sim_core::llm::render::RENDERER_VERSION;

use crate::args;
use crate::commands::{EXIT_OK, EXIT_USAGE_OR_MALFORMED};

pub const OUTPUTS_FORMAT: &str = "llm-probe-grading-outputs-v1";
pub const GOLDEN_FORMAT: &str = "llm-probe-grading-golden-v1";

pub const OUTPUTS_USAGE: &str = "usage: sim-cli grading-outputs --cards FILE --out FILE";
pub const GOLDEN_USAGE: &str =
    "usage: sim-cli grading-golden --cards FILE --outputs FILE --out FILE";

/// Fixed templates used for the `render_prompt` golden entries (synthetic, not the real
/// prompt templates of the probe).
const TEMPLATE_DECISION: &str = "[system]\nYou decide.\n[user]\nToday is day {{tick}}.\n{{situation}}\nPeople:\n{{people}}\nRelations:\n{{relations}}\nEvents:\n{{events}}\nOptions:\n{{options}}\nInput: {{player_input}}\nSubject: {{subject}}\n";
const TEMPLATE_SYNTHESIS: &str = "[system]\nYou summarize.\n[user]\nToday is day {{tick}}.\n{{situation}}\nPeople:\n{{people}}\nRelations:\n{{relations}}\nEvents:\n{{events}}\nInput: {{player_input}}\nSubject: {{subject}}\nSchema:\n{{schema}}\n";
const SCHEMA_TEXT: &str = "(synthetic schema text for the grading fixtures)";

type Res<T> = Result<T, String>;

// ---------------------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------------------

struct CardLine {
    id: String,
    line: String,
    value: Value,
    /// `frozen_context` member of the `llm_parse_card` result.
    context: Value,
    pair_id: Option<String>,
    role: Option<String>,
}

fn call(f: fn(&str) -> String, input: &str) -> Res<Value> {
    let text = f(input);
    serde_json::from_str(&text).map_err(|e| format!("api result is not JSON: {e}"))
}

fn load_cards(path: &str) -> Res<Vec<CardLine>> {
    let text = fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))?;
    let mut cards = Vec::new();
    for (i, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let n = i + 1;
        let value: Value =
            serde_json::from_str(line).map_err(|e| format!("{path}:{n}: not JSON: {e}"))?;
        let parsed = call(api::llm_parse_card, line)?;
        if parsed["ok"] != Value::Bool(true) {
            return Err(format!("{path}:{n}: card rejected: {}", parsed["error"]));
        }
        let meta = &parsed["meta"];
        let id = str_of(&meta["id"], "meta.id")?.to_owned();
        if meta["split"] != "dev" {
            return Err(format!("{path}:{n}: card {id} is not a dev card"));
        }
        cards.push(CardLine {
            id,
            line: line.to_owned(),
            value,
            context: parsed["frozen_context"].clone(),
            pair_id: meta["pair_id"].as_str().map(str::to_owned),
            role: meta["role"].as_str().map(str::to_owned),
        });
    }
    if cards.is_empty() {
        return Err(format!("{path}: no cards"));
    }
    Ok(cards)
}

fn str_of<'a>(v: &'a Value, what: &str) -> Res<&'a str> {
    v.as_str().ok_or_else(|| format!("{what} is not a string"))
}

fn list_of<'a>(v: &'a Value, what: &str) -> Res<&'a Vec<Value>> {
    v.as_array().ok_or_else(|| format!("{what} is not a list"))
}

// ---------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------

fn valid(label: &str, raw: String) -> Value {
    json!({"label": label, "kind": "valid", "raw": raw})
}

fn illegal(label: &str, raw: String) -> Value {
    json!({"label": label, "kind": "illegal", "raw": raw})
}

fn compact(v: &Value) -> Res<String> {
    serde_json::to_string(v).map_err(|e| format!("cannot serialize: {e}"))
}

fn fenced(body: &str) -> String {
    format!("```json\n{body}\n```")
}

/// First element of a list, or the value itself.
fn first_scalar(v: &Value) -> Value {
    match v {
        Value::Array(items) => items.first().cloned().unwrap_or(Value::Null),
        other => other.clone(),
    }
}

/// Field names of one answer family: (person fields, enum field, default enum value).
struct Family {
    person_fields: [&'static str; 2],
    enum_field: &'static str,
    enum_default: &'static str,
}

fn family_of(schema: &str) -> Res<Family> {
    Ok(match schema {
        "grudge_v1" => Family {
            person_fields: ["from", "to"],
            enum_field: "level",
            enum_default: "medium",
        },
        "debt_chain_v1" => Family {
            person_fields: ["debtor", "creditor"],
            enum_field: "status",
            enum_default: "open",
        },
        "broken_promise_v1" => Family {
            person_fields: ["promisor", "promisee"],
            enum_field: "status",
            enum_default: "pending",
        },
        "relationship_shift_v1" => Family {
            person_fields: ["a", "b"],
            enum_field: "direction",
            enum_default: "unchanged",
        },
        other => return Err(format!("unknown output_schema {other}")),
    })
}

/// Builds one answer item from a pattern, filling every field the pattern leaves open
/// with a fixed default taken from the context.
fn build_item(schema: &str, pattern: &Value, ctx: &Value) -> Res<Value> {
    let fam = family_of(schema)?;
    let persons: Vec<i64> = list_of(&ctx["people"], "people")?
        .iter()
        .filter_map(|p| p["id"].as_i64())
        .collect();
    let events: Vec<String> = list_of(&ctx["events"], "events")?
        .iter()
        .filter_map(|e| e["id"].as_str().map(str::to_owned))
        .collect();
    let first_event = events.first().cloned().unwrap_or_else(|| "e1".to_owned());
    let pat = pattern
        .as_object()
        .ok_or_else(|| "pattern is not an object".to_owned())?;
    let get = |k: &str| pat.get(k).map(first_scalar);

    let mut item = Map::new();
    let mut used: Vec<i64> = Vec::new();
    for field in fam.person_fields {
        let id = match get(field).and_then(|v| v.as_i64()) {
            Some(id) => id,
            None => persons
                .iter()
                .copied()
                .find(|p| !used.contains(p))
                .unwrap_or(1),
        };
        used.push(id);
        item.insert(field.to_owned(), json!(id));
    }
    item.insert(
        fam.enum_field.to_owned(),
        get(fam.enum_field).unwrap_or_else(|| json!(fam.enum_default)),
    );
    let evidence = pat
        .get("evidence_any")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first().cloned())
        .unwrap_or_else(|| json!(first_event));
    item.insert("evidence".to_owned(), json!([evidence]));
    item.insert("reason".to_owned(), json!("synthetic fixture item"));
    match schema {
        "debt_chain_v1" => {
            item.insert("amount".to_owned(), get("amount").unwrap_or(json!(0)));
            item.insert(
                "origin_event".to_owned(),
                get("origin_event").unwrap_or(json!(first_event)),
            );
            item.insert(
                "transferred_from".to_owned(),
                get("transferred_from").unwrap_or(Value::Null),
            );
        }
        "broken_promise_v1" => {
            item.insert(
                "promise_event".to_owned(),
                get("promise_event").unwrap_or(json!(first_event)),
            );
        }
        "relationship_shift_v1" => {
            item.insert(
                "turning_point".to_owned(),
                get("turning_point").unwrap_or(Value::Null),
            );
        }
        _ => {}
    }
    Ok(Value::Object(item))
}

fn answer(schema: &str, items: Vec<Value>) -> Value {
    json!({"schema": schema, "items": items})
}

/// Mutations that apply to every card, as (label, raw text).
fn common_illegal(valid_text: &str) -> Vec<Value> {
    vec![
        illegal("empty", String::new()),
        illegal(
            "prose",
            "I think the answer is probably the first one.".to_owned(),
        ),
        illegal(
            "truncated",
            valid_text[..valid_text.len().saturating_sub(2).max(1)].to_owned(),
        ),
        illegal("array_root", "[]".to_owned()),
        illegal("trailing_text", format!("{valid_text} Hope that helps.")),
        illegal("unclosed_fence", format!("```json\n{valid_text}")),
        json!({"label": "timeout", "kind": "illegal", "outcome": {"kind": "timeout"}}),
        json!({"label": "runtime_error", "kind": "illegal",
               "outcome": {"kind": "error", "code": "runtime_error", "detail": "synthetic"}}),
    ]
}

fn decision_outputs(card: &CardLine) -> Res<Vec<Value>> {
    let acceptable: Vec<&str> = list_of(&card.value["acceptable"], "acceptable")?
        .iter()
        .filter_map(Value::as_str)
        .collect();
    let severe: Vec<&str> = list_of(&card.value["severe"], "severe")?
        .iter()
        .filter_map(Value::as_str)
        .collect();
    let mut out = Vec::new();
    let mut first_valid = String::new();
    for opt in list_of(&card.value["options"], "options")? {
        let id = str_of(&opt["id"], "option id")?;
        let class = if acceptable.contains(&id) {
            "acceptable"
        } else if severe.contains(&id) {
            "severe"
        } else {
            "other"
        };
        let raw = compact(&json!({"option": id}))?;
        if first_valid.is_empty() && class == "acceptable" {
            first_valid.clone_from(&raw);
            out.push(valid(&format!("fenced:{id}"), fenced(&raw)));
        }
        out.push(valid(&format!("{class}:{id}"), raw));
    }
    if first_valid.is_empty() {
        return Err(format!("card {} has no acceptable option", card.id));
    }
    out.extend(common_illegal(&first_valid));
    out.push(illegal(
        "out_of_set",
        r#"{"option":"zz_not_an_option"}"#.to_owned(),
    ));
    let id = str_of(&card.value["options"][0]["id"], "option id")?;
    out.push(illegal(
        "extra_member",
        compact(&json!({"option": id, "why": "because"}))?,
    ));
    out.push(illegal("missing_option", "{}".to_owned()));
    out.push(illegal("wrong_type", r#"{"option":1}"#.to_owned()));
    Ok(out)
}

fn synthesis_outputs(card: &CardLine) -> Res<Vec<Value>> {
    let schema = str_of(&card.value["output_schema"], "output_schema")?;
    let fam = family_of(schema)?;
    let ctx = &card.context;
    let gold = list_of(&card.value["gold"]["must_include"], "gold.must_include")?;
    let gold_items: Vec<Value> = gold
        .iter()
        .map(|p| build_item(schema, p, ctx))
        .collect::<Res<_>>()?;
    let gold_text = compact(&answer(schema, gold_items.clone()))?;

    let mut out = vec![
        valid("gold", gold_text.clone()),
        valid("fenced_gold", fenced(&gold_text)),
        valid("empty_items", compact(&answer(schema, vec![]))?),
    ];
    for (i, p) in list_of(&card.value["gold"]["must_not_include"], "must_not_include")?
        .iter()
        .enumerate()
    {
        let item = build_item(schema, p, ctx)?;
        out.push(valid(
            &format!("must_not:{i}"),
            compact(&answer(schema, vec![item]))?,
        ));
    }
    if let Some(patterns) = card.value.get("severe_patterns") {
        for (i, sp) in list_of(patterns, "severe_patterns")?.iter().enumerate() {
            let item = build_item(schema, &sp["pattern"], ctx)?;
            out.push(valid(
                &format!("severe_pattern:{i}"),
                compact(&answer(schema, vec![item]))?,
            ));
        }
    }

    out.extend(common_illegal(&gold_text));
    out.push(illegal(
        "wrong_schema_const",
        compact(&json!({"schema": "not_a_schema_v1", "items": []}))?,
    ));
    out.push(illegal(
        "missing_items",
        compact(&json!({"schema": schema}))?,
    ));
    out.push(illegal(
        "unknown_top_field",
        compact(&json!({"schema": schema, "items": [], "extra": 1}))?,
    ));
    out.push(illegal(
        "items_not_array",
        compact(&json!({"schema": schema, "items": {}}))?,
    ));

    // Item-level mutations of the first gold item (or of a default item).
    let base = match gold_items.first() {
        Some(i) => i.clone(),
        None => build_item(schema, &json!({}), ctx)?,
    };
    let with = |f: &dyn Fn(&mut Map<String, Value>)| -> Res<String> {
        let mut m = base.as_object().cloned().unwrap_or_default();
        f(&mut m);
        compact(&answer(schema, vec![Value::Object(m)]))
    };
    out.push(illegal(
        "missing_reason",
        with(&|m| {
            m.remove("reason");
        })?,
    ));
    out.push(illegal(
        "unknown_item_field",
        with(&|m| {
            m.insert("extra".to_owned(), json!(1));
        })?,
    ));
    out.push(illegal(
        "empty_evidence",
        with(&|m| {
            m.insert("evidence".to_owned(), json!([]));
        })?,
    ));
    out.push(illegal(
        "duplicate_evidence",
        with(&|m| {
            let e = m["evidence"][0].clone();
            m.insert("evidence".to_owned(), json!([e.clone(), e]));
        })?,
    ));
    out.push(illegal(
        "malformed_event_id",
        with(&|m| {
            m.insert("evidence".to_owned(), json!(["E1"]));
        })?,
    ));
    out.push(illegal(
        "illegal_enum_value",
        with(&|m| {
            m.insert(fam.enum_field.to_owned(), json!("bogus"));
        })?,
    ));
    out.push(illegal(
        "wrong_type_person",
        with(&|m| {
            m.insert(fam.person_fields[0].to_owned(), json!("one"));
        })?,
    ));
    // Non-integer: patch the text, because the typed value cannot hold a fraction.
    let person_field = fam.person_fields[0];
    let n = base[person_field]
        .as_i64()
        .ok_or_else(|| format!("card {}: person field is not an integer", card.id))?;
    let plain = with(&|_| {})?;
    let needle = format!("\"{person_field}\":{n}");
    if !plain.contains(&needle) {
        return Err(format!("card {}: cannot find {needle}", card.id));
    }
    out.push(illegal(
        "non_integer",
        plain.replacen(&needle, &format!("{needle}.5"), 1),
    ));
    Ok(out)
}

fn outputs_for(card: &CardLine) -> Res<Vec<Value>> {
    let outs = match card.value["task"].as_str() {
        Some("decision") => decision_outputs(card)?,
        Some("synthesis") => synthesis_outputs(card)?,
        _ => return Err(format!("card {}: unknown task", card.id)),
    };
    let has = |k: &str| outs.iter().any(|o| o["kind"] == k);
    if !has("valid") || !has("illegal") {
        return Err(format!(
            "card {}: needs one valid and one illegal output",
            card.id
        ));
    }
    Ok(outs)
}

fn build_outputs(cards: &[CardLine]) -> Res<Value> {
    let mut entries = Vec::new();
    for c in cards {
        entries.push(json!({"card": c.id, "outputs": outputs_for(c)?}));
    }
    Ok(json!({
        "format": OUTPUTS_FORMAT,
        "note": "Synthetic. Built from the Dev_Cards' own answer keys and a fixed list of mutations. No model output.",
        "cards": entries,
    }))
}

// ---------------------------------------------------------------------------------------
// Golden
// ---------------------------------------------------------------------------------------

/// One fixture output of one card, ready to feed to the exports.
struct Output {
    label: String,
    kind: String,
    /// `"raw"` or `"outcome"` member of the `llm_validate` input.
    source: (&'static str, Value),
}

fn read_outputs(outputs: &Value) -> Res<BTreeMap<String, Vec<Output>>> {
    if outputs["format"] != OUTPUTS_FORMAT {
        return Err(format!("outputs file format is not {OUTPUTS_FORMAT}"));
    }
    let mut map = BTreeMap::new();
    for entry in list_of(&outputs["cards"], "cards")? {
        let id = str_of(&entry["card"], "card")?.to_owned();
        let mut list = Vec::new();
        for o in list_of(&entry["outputs"], "outputs")? {
            let source = match (o.get("raw"), o.get("outcome")) {
                (Some(r), None) => ("raw", r.clone()),
                (None, Some(oc)) => ("outcome", oc.clone()),
                _ => {
                    return Err(format!(
                        "card {id}: output needs exactly one of raw/outcome"
                    ));
                }
            };
            list.push(Output {
                label: str_of(&o["label"], "label")?.to_owned(),
                kind: str_of(&o["kind"], "kind")?.to_owned(),
                source,
            });
        }
        map.insert(id, list);
    }
    Ok(map)
}

fn ok_result<'a>(r: &'a Value, what: &str) -> Res<&'a Value> {
    if r["ok"] == Value::Bool(true) {
        Ok(r)
    } else {
        Err(format!("{what} failed: {}", r["error"]))
    }
}

/// Runs an export and returns (result text, result value).
fn run(f: fn(&str) -> String, input: &Value) -> Res<(String, Value)> {
    let text = f(&compact(input)?);
    let value: Value = serde_json::from_str(&text).map_err(|e| format!("not JSON: {e}"))?;
    Ok((text, value))
}

fn build_golden(cards: &[CardLine], outputs: &Value) -> Res<Value> {
    let outs = read_outputs(outputs)?;
    if outs.len() != cards.len() || cards.iter().any(|c| !outs.contains_key(&c.id)) {
        return Err("outputs file and cards file hold different cards".to_owned());
    }
    // Verdicts per card and output, for the contrast entries.
    let mut verdicts: BTreeMap<(String, String), Value> = BTreeMap::new();
    let mut card_entries = Vec::new();
    for card in cards {
        let ctx = &card.context;
        let parse_text = api::llm_parse_card(&card.line);
        let (perm_text, perm_value) = run(api::llm_permutations, &json!({"frozen_context": ctx}))?;
        let perms = list_of(
            &ok_result(&perm_value, "permutations")?["permutations"],
            "perms",
        )?
        .clone();
        let (template, schema_text) = if card.value["task"] == "decision" {
            (TEMPLATE_DECISION, Value::Null)
        } else {
            (TEMPLATE_SYNTHESIS, json!(SCHEMA_TEXT))
        };
        let mut renders = Vec::new();
        for p in &perms {
            let input = json!({"frozen_context": ctx, "template": template,
                               "schema_text": schema_text, "permutation": p});
            let (text, _) = run(api::llm_render_prompt, &input)?;
            renders.push(json!({"permutation": p, "result": text}));
        }
        let mut output_entries = Vec::new();
        for o in outs.get(&card.id).map(Vec::as_slice).unwrap_or_default() {
            let mut input = Map::new();
            input.insert("frozen_context".to_owned(), ctx.clone());
            input.insert(o.source.0.to_owned(), o.source.1.clone());
            let (vtext, vvalue) = run(api::llm_validate, &Value::Object(input))?;
            let verdict =
                ok_result(&vvalue, &format!("validate {} {}", card.id, o.label))?["verdict"]
                    .clone();
            let gi = json!({"card": card.line, "verdict": verdict});
            let (gtext, gvalue) = run(api::llm_grade, &gi)?;
            ok_result(&gvalue, &format!("grade {} {}", card.id, o.label))?;
            let (itext, ivalue) = run(api::llm_identity, &gi)?;
            ok_result(&ivalue, &format!("identity {} {}", card.id, o.label))?;
            verdicts.insert((card.id.clone(), o.label.clone()), verdict);
            output_entries.push(json!({"output": o.label, "kind": o.kind,
                "validate": vtext, "grade": gtext, "identity": itext}));
        }
        card_entries.push(json!({"card": card.id, "parse_card": parse_text,
            "permutations": perm_text, "render_prompt": renders, "outputs": output_entries}));
    }

    let mut contrast = Vec::new();
    let mut pairs: BTreeMap<&str, (Option<&CardLine>, Option<&CardLine>)> = BTreeMap::new();
    for c in cards {
        if let (Some(p), Some(r)) = (&c.pair_id, &c.role) {
            let slot = pairs.entry(p.as_str()).or_default();
            if r == "a" {
                slot.0 = Some(c)
            } else {
                slot.1 = Some(c)
            }
        }
    }
    for (pair, (a, b)) in pairs {
        let (Some(a), Some(b)) = (a, b) else {
            return Err(format!("pair {pair} lacks a card"));
        };
        let la = outs.get(&a.id).map(Vec::as_slice).unwrap_or_default();
        let lb = outs.get(&b.id).map(Vec::as_slice).unwrap_or_default();
        let first_valid = |l: &[Output]| {
            l.iter()
                .find(|o| o.kind == "valid")
                .map(|o| o.label.clone())
        };
        let (Some(va), Some(vb)) = (first_valid(la), first_valid(lb)) else {
            return Err(format!("pair {pair}: no valid output"));
        };
        // valid x valid, plus each illegal output against the first valid one, both ways.
        let mut combos: Vec<(String, String)> = Vec::new();
        for x in la.iter().filter(|o| o.kind == "valid") {
            for y in lb.iter().filter(|o| o.kind == "valid") {
                combos.push((x.label.clone(), y.label.clone()));
            }
        }
        for x in la.iter().filter(|o| o.kind == "illegal") {
            combos.push((x.label.clone(), vb.clone()));
        }
        for y in lb.iter().filter(|o| o.kind == "illegal") {
            combos.push((va.clone(), y.label.clone()));
        }
        for (xa, yb) in combos {
            let va_v = verdicts
                .get(&(a.id.clone(), xa.clone()))
                .cloned()
                .ok_or("verdict a")?;
            let vb_v = verdicts
                .get(&(b.id.clone(), yb.clone()))
                .cloned()
                .ok_or("verdict b")?;
            let input = json!({"card_a": a.line, "verdict_a": va_v,
                               "card_b": b.line, "verdict_b": vb_v});
            let (text, value) = run(api::llm_contrast, &input)?;
            ok_result(&value, &format!("contrast {pair}"))?;
            contrast.push(json!({"pair": pair, "card_a": a.id, "output_a": xa,
                "card_b": b.id, "output_b": yb, "result": text}));
        }
    }

    Ok(json!({
        "format": GOLDEN_FORMAT,
        "note": "Expected bytes of every llm export on every Dev_Card x fixture output. Regenerated on purpose only, by scripts/regen-grading-golden.sh.",
        "renderer_version": RENDERER_VERSION,
        "templates": {"decision": TEMPLATE_DECISION, "synthesis": TEMPLATE_SYNTHESIS},
        "schema_text": SCHEMA_TEXT,
        "cards": card_entries,
        "contrast": contrast,
    }))
}

// ---------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------

fn write_json(path: &str, value: &Value) -> Res<()> {
    let mut text =
        serde_json::to_string_pretty(value).map_err(|e| format!("cannot serialize: {e}"))?;
    text.push('\n');
    if let Some(parent) = Path::new(path).parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create directory for {path}: {e}"))?;
    }
    fs::write(path, text).map_err(|e| format!("cannot write {path}: {e}"))
}

fn require<'a>(p: &'a args::Parsed, name: &str) -> Res<&'a str> {
    p.get(name)
        .ok_or_else(|| format!("missing required flag --{name}"))
}

fn finish(result: Res<String>, usage: &str, out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    match result {
        Ok(summary) => {
            let _ = writeln!(out, "{summary}");
            EXIT_OK
        }
        Err(e) => {
            let _ = writeln!(err, "error: {e}\n{usage}");
            EXIT_USAGE_OR_MALFORMED
        }
    }
}

pub fn grading_outputs(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let run = || -> Res<String> {
        let p = args::parse(args, &["cards", "out"])?;
        let cards = load_cards(require(&p, "cards")?)?;
        let value = build_outputs(&cards)?;
        let path = require(&p, "out")?;
        write_json(path, &value)?;
        Ok(format!("wrote {} cards -> {path}", cards.len()))
    };
    finish(run(), OUTPUTS_USAGE, out, err)
}

pub fn grading_golden(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let run = || -> Res<String> {
        let p = args::parse(args, &["cards", "outputs", "out"])?;
        let cards = load_cards(require(&p, "cards")?)?;
        let opath = require(&p, "outputs")?;
        let text = fs::read_to_string(opath).map_err(|e| format!("cannot read {opath}: {e}"))?;
        let outputs: Value =
            serde_json::from_str(&text).map_err(|e| format!("{opath}: not JSON: {e}"))?;
        let value = build_golden(&cards, &outputs)?;
        let path = require(&p, "out")?;
        write_json(path, &value)?;
        Ok(format!("wrote golden for {} cards -> {path}", cards.len()))
    };
    finish(run(), GOLDEN_USAGE, out, err)
}
