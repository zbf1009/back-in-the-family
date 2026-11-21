//! JSON transport for a read-only Decision_Node preview.

use sim_core::llm::api::frozen_context_to_json;
use sim_core::llm::card::family_name;
use sim_core::llm::json::{Json, write};
use sim_core::replay::ReplayPayload;
use sim_core::tick::Sim;
use sim_core::underworld::nodes::{NodeSpec, PreviewError};

pub(super) fn preview_json(sim: &Sim, payload_json: &str) -> String {
    // ReplayPayload checks the fields, but serde accepts positional arrays for struct
    // variants too. Require an object body. For every known variant name the delimiter
    // is the first colon (even if the caller escapes a letter in the name).
    if !payload_json
        .split_once(':')
        .is_some_and(|(_, body)| body.trim_start().starts_with('{'))
    {
        return error("malformed", None);
    }
    let Ok(payload) = serde_json::from_str::<ReplayPayload>(payload_json) else {
        return error("malformed", None);
    };
    match sim.preview_node(payload.into()) {
        Ok(spec) => node_json(spec),
        Err(PreviewError::Rejected(reason)) => error("rejected", Some(reason.label())),
        Err(PreviewError::NoNode) => error("no_node", None),
    }
}

fn node_json(spec: NodeSpec) -> String {
    let context = frozen_context_to_json(&spec.context);
    let Json::Object(context_fields) = &context else {
        unreachable!("the frozen-context codec writes an object");
    };
    let option_defs = context_fields["options"].clone();
    write(&object([
        ("ok", Json::Bool(true)),
        (
            "family",
            Json::Str(family_name(spec.family.family()).into()),
        ),
        ("trigger", Json::Str(spec.trigger.0.to_string())),
        ("frozen_context", context),
        (
            "option_ids",
            Json::Array(
                spec.options
                    .into_iter()
                    .map(|o| Json::Str(o.id().into()))
                    .collect(),
            ),
        ),
        ("option_defs", option_defs),
        ("rules_default", Json::Str(spec.rules_default.id().into())),
    ]))
}

fn error(kind: &str, reason: Option<&str>) -> String {
    let fields = [("kind", Json::Str(kind.into()))]
        .into_iter()
        .chain(reason.map(|label| ("reason", Json::Str(label.into()))));
    write(&object([
        ("ok", Json::Bool(false)),
        ("error", object(fields)),
    ]))
}

fn object(fields: impl IntoIterator<Item = (&'static str, Json)>) -> Json {
    Json::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.into(), value))
            .collect(),
    )
}
