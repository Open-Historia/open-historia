use std::io::Read;
use std::time::Instant;

use ohfronts::frames::js_trim;
use ohfronts::FrontFrames;
use serde_json::{json, Value};

fn number(value: &Value) -> f64 {
    match value {
        Value::Number(number) => number.as_f64().unwrap_or(f64::NAN),
        Value::Null => 0.0,
        Value::Bool(flag) => f64::from(u8::from(*flag)),
        Value::String(text) => ohfronts::frames::js_number_of_text(text),
        _ => f64::NAN,
    }
}

fn main() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).expect("the fixture reads");
    let fixture: Value = serde_json::from_str(&input).expect("the fixture is JSON");
    let repeat = fixture.get("repeat").and_then(Value::as_u64).unwrap_or(1).max(1);
    let mut stages_out = Vec::new();
    for stage in fixture.get("stages").and_then(Value::as_array).cloned().unwrap_or_default() {
        let mut frames = FrontFrames::new();
        let load_began = Instant::now();
        let payload = stage.get("frames").cloned().unwrap_or(Value::Null);
        match &payload {
            Value::String(text) => frames.load_json(text).expect("the stage data is JSON"),
            other => frames.load(other),
        }
        let load_ms = load_began.elapsed().as_secs_f64() * 1000.0;
        let mut results = Vec::new();
        let mut times = Vec::new();
        for request in stage.get("requests").and_then(Value::as_array).cloned().unwrap_or_default() {
            let days: Vec<(String, f64)> = request
                .get("days")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .map(|entry| {
                            let name = match entry.get(0) {
                                Some(Value::String(text)) => js_trim(text).to_string(),
                                Some(Value::Null) | None => String::new(),
                                Some(other) => other.to_string(),
                            };
                            let day = entry.get(1).map(number).unwrap_or(f64::NAN);
                            (name, day)
                        })
                        .collect()
                })
                .unwrap_or_default();
            let zoom = request.get("zoom").map(number).unwrap_or(5.0);
            let began = Instant::now();
            let mut out = frames.frame(&days, zoom);
            for _ in 1..repeat {
                out = frames.frame(&days, zoom);
            }
            times.push(began.elapsed().as_secs_f64() * 1000.0 / repeat as f64);
            results.push(out.to_json());
        }
        stages_out.push(json!({ "loadMs": load_ms, "results": results, "ms": times }));
    }
    println!("{}", json!({ "stages": stages_out }));
}
