use crate::support::*;
use ohfronts::sim::engine::Hooks;
use ohfronts::sim::front_run::{create_front_run, run_fronts, FrontRun};
use ohfronts::sim::js::{self, Val};
use std::collections::HashMap;

pub struct Told {
    tables: HashMap<String, HashMap<String, Val>>,
}

impl Told {
    pub fn of(case: &Case) -> Told {
        let mut tables: HashMap<String, HashMap<String, Val>> = HashMap::new();
        for (name, calls) in &case.callbacks {
            let Some(reader) = name.strip_prefix("0.") else { continue };
            let table = tables.entry(reader.to_string()).or_default();
            for (args, result) in calls {
                let key = args.first().map(js::to_string).unwrap_or_default();
                table.entry(key).or_insert_with(|| result.clone());
            }
        }
        Told { tables }
    }

    fn find(&self, reader: &str, key: &str) -> Val {
        self.tables.get(reader).and_then(|table| table.get(key)).cloned().unwrap_or(Val::Undef)
    }
}

impl Hooks for Told {
    fn controller_of(&self, id: &str) -> Val {
        self.find("controllerOf", id)
    }
    fn sovereign_of(&self, id: &str) -> Val {
        self.find("sovereignOf", id)
    }
    fn is_group(&self, name: &str) -> Val {
        self.find("isGroup", name)
    }
    fn strength_of(&self, name: &str) -> Val {
        self.find("strengthOf", name)
    }
    fn shortage_of(&self, name: &str) -> Val {
        self.find("shortageOf", name)
    }
    fn military_of(&self, name: &str) -> Val {
        self.find("militaryOf", name)
    }
    fn muster_of(&self, name: &str) -> Val {
        self.find("musterOf", name)
    }
    fn people_of(&self, name: &str) -> Val {
        self.find("peopleOf", name)
    }
}

fn kept_shapes(input: &Val) -> bool {
    match input.get("arenas") {
        Val::Map(entries) => entries.iter().any(|(_, value)| !matches!(value, Val::Bool(true) | Val::Arr(_))),
        _ => false,
    }
}

pub fn replayable(input: &Val) -> bool {
    if matches!(input.get("staffPolicy"), Val::Fn) || !input.get("rehearsers").is_nullish() {
        return false;
    }
    !(kept_shapes(input) && input.get("map").get("regions").as_array().is_none())
}

fn input_of(case: &Case) -> Val {
    case.arg(0).plain()
}

fn run_fronts_check(case: &Case) -> Option<Result<(), String>> {
    let input = input_of(case);
    if !replayable(&input) {
        return None;
    }
    let want = case.result.as_ref()?;
    let got = run_fronts(input, Box::new(Told::of(case)));
    Some(same(&got, want))
}

fn method(run: &mut FrontRun, name: &str, args: &[Val]) -> Option<Val> {
    let days = |at: usize| match args.get(at) {
        Some(Val::Num(n)) => *n,
        _ => f64::INFINITY,
    };
    match name {
        "advance" => Some(Val::Bool(run.advance(days(0)))),
        "steps" => {
            run.advance(days(0));
            None
        }
        "finished" => Some(Val::Bool(run.finished())),
        "snapshot" => Some(run.snapshot()),
        "finish" => Some(run.finish()),
        _ => None,
    }
}

fn create_front_run_check(case: &Case) -> Option<Result<(), String>> {
    let input = input_of(case);
    if !replayable(&input) || case.method_log.is_empty() {
        return None;
    }
    let mut run = create_front_run(input, Box::new(Told::of(case)));
    for (index, (name, args, want)) in case.method_log.iter().enumerate() {
        if let Some(got) = method(&mut run, name, args) {
            if let Err(error) = same(&got, want) {
                return Some(Err(format!("call {index} {name}: {error}")));
            }
        }
    }
    Some(Ok(()))
}

#[test]
fn engine_matches_js() {
    run("engine", &[("runFronts", &run_fronts_check), ("createFrontRun", &create_front_run_check)]);
}


#[test]
#[ignore]
fn engine_timing() {
    let rounds: usize = std::env::var("ROUNDS").ok().and_then(|text| text.parse().ok()).unwrap_or(5);
    let fixture = load("engine");
    let mut rows: Vec<(usize, f64)> = Vec::new();
    for (name, cases) in &fixture.cases {
        if name != "runFronts" {
            continue;
        }
        for (index, case) in cases.iter().enumerate() {
            if !replayable(&input_of(case)) {
                continue;
            }
            let mut best = f64::INFINITY;
            for _ in 0..rounds {
                let input = input_of(case);
                let hooks = Box::new(Told::of(case));
                let started = std::time::Instant::now();
                let _ = run_fronts(input, hooks);
                best = best.min(started.elapsed().as_secs_f64() * 1000.0);
            }
            rows.push((index, best));
        }
    }
    rows.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    for (index, ms) in &rows {
        println!("rust runFronts#{index} {ms:.3} ms");
    }
    println!("rust total {:.3} ms over {} runs", rows.iter().map(|row| row.1).sum::<f64>(), rows.len());
}
