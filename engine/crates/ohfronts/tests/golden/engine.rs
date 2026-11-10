use crate::support::*;
use ohfronts::sim::engine::{Hooks, StaffHook};
use ohfronts::sim::front_run::{create_front_run_led, FrontRun};
use ohfronts::sim::mind::net::Shape;
use ohfronts::sim::mind::planner::{create_plainer_planner, create_planner, PlannerOptions};
use ohfronts::sim::mind::policy::{create_staff_policy, create_troop_policy};
use ohfronts::sim::mind::trained::{lab_staff_policy, trained_staff_policy};
use std::sync::Arc as Rc;
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
    fn group_owner_of(&self, name: &str) -> Val {
        self.find("groupOwnerOf", name)
    }
}

fn kept_shapes(input: &Val) -> bool {
    match input.get("arenas") {
        Val::Map(entries) => entries.iter().any(|(_, value)| !matches!(value, Val::Bool(true) | Val::Arr(_))),
        _ => false,
    }
}

fn options_of(given: &Val) -> PlannerOptions {
    let number = |key: &str| match given.get(key) {
        Val::Num(n) => Some(*n),
        _ => None,
    };
    let params = match given.get("params") {
        Val::Undef => None,
        other => Some(arg_numbers(other)),
    };
    let plans = match given.get("plans") {
        Val::Arr(list) => Some(list.iter().map(js::to_string).collect()),
        _ => None,
    };
    let late = match given.get("late") {
        Val::Arr(list) => Some(list.iter().map(js::to_number).collect()),
        _ => None,
    };
    PlannerOptions {
        params,
        look: number("look"),
        ahead: number("ahead"),
        plans,
        refine: number("refine"),
        replies: given.get("replies").truthy(),
        air_control: match given.get("airControl") {
            Val::Undef => None,
            other => Some(other.truthy()),
        },
        late,
    }
}

pub fn policy_of(value: &Val) -> Result<Option<Rc<dyn StaffHook>>, ()> {
    match value {
        Val::Fn => Err(()),
        Val::Obj(obj) if obj.has("$fn") => {
            let args = value.get("$args");
            let given = args.at(0);
            let made: Rc<dyn StaffHook> = match value.get("$fn").string_or_empty().as_str() {
                "mindPlanner.createPlanner" => Rc::new(create_planner(options_of(given))),
                "mindPlanner.createPlainerPlanner" => Rc::new(create_plainer_planner(options_of(given))),
                "mindTrained.labStaffPolicy" => Rc::new(lab_staff_policy(given)),
                "mindTrained.trainedStaffPolicy" => Rc::new(trained_staff_policy()),
                "mindPolicy.createStaffPolicy" => Rc::new(create_staff_policy(Shape::of(given.get("shape")), arg_numbers(given.get("params")), if given.get("prior").is_undef() { 0.0 } else { given.get("prior").num() }, given.get("drafts").is_true())),
                "mindPolicy.createTroopPolicy" => Rc::new(create_troop_policy(Shape::of(given.get("shape")), arg_numbers(given.get("params")))),
                _ => return Err(()),
            };
            Ok(Some(made))
        }
        _ => Ok(None),
    }
}

pub fn replayable(input: &Val) -> bool {
    if policy_of(input.get("staffPolicy")).is_err() {
        return false;
    }
    !(kept_shapes(input) && input.get("map").get("regions").as_array().is_none())
}

fn input_of(case: &Case) -> Val {
    case.arg(0).plain()
}

pub fn led(input: Val) -> (Val, Option<Rc<dyn StaffHook>>) {
    let policy = policy_of(input.get("staffPolicy")).ok().flatten();
    let mut input = input;
    if let Val::Obj(obj) = &mut input {
        obj.remove("staffPolicy");
        obj.remove("rehearsers");
    }
    (input, policy)
}

pub fn run_led(input: Val, hooks: Box<dyn Hooks>) -> Val {
    let (input, policy) = led(input);
    create_front_run_led(input, hooks, policy).finish()
}

fn run_fronts_check(case: &Case) -> Option<Result<(), String>> {
    let input = input_of(case);
    if !replayable(&input) {
        return None;
    }
    let want = case.result.as_ref()?;
    let got = run_led(input, Box::new(Told::of(case)));
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
    let (input, policy) = led(input);
    let mut run = create_front_run_led(input, Box::new(Told::of(case)), policy);
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
    let only_led = std::env::var("PLANNER").is_ok();
    metric_tables();
    let fixture = load("engine");
    let mut rows: Vec<(usize, f64)> = Vec::new();
    for (name, cases) in &fixture.cases {
        if name != "runFronts" {
            continue;
        }
        for (index, case) in cases.iter().enumerate() {
            if !replayable(&input_of(case)) || (only_led && policy_of(input_of(case).get("staffPolicy")).ok().flatten().is_none()) {
                continue;
            }
            let mut best = f64::INFINITY;
            for _ in 0..rounds {
                let input = input_of(case);
                let hooks = Box::new(Told::of(case));
                let started = std::time::Instant::now();
                let _ = run_led(input, hooks);
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
