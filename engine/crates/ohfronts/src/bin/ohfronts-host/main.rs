mod wire;

use ohfronts::sim::engine::{Hooks, StaffHook};
use ohfronts::sim::front_run::{create_front_run_kept, FrontRun, Kept};
use ohfronts::sim::js::{self, Val};
use ohfronts::sim::mind::net::Shape;
use ohfronts::sim::mind::planner::{create_plainer_planner, create_planner, PlannerOptions};
use ohfronts::sim::mind::policy::{create_staff_policy, create_troop_policy};
use ohfronts::sim::mind::trained::{lab_staff_policy, trained_staff_policy};
use ohfronts::sim::world_grid::register_metric_table;
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Instant;

const READERS: [&str; 8] = ["controllerOf", "sovereignOf", "isGroup", "strengthOf", "shortageOf", "militaryOf", "musterOf", "peopleOf"];

#[derive(Default)]
struct Answers {
    got: HashMap<u64, String>,
    closed: bool,
}

struct Link {
    out: Mutex<()>,
    answers: Mutex<Answers>,
    ready: Condvar,
    asked: AtomicU64,
    cancels: Mutex<HashSet<u64>>,
}

impl Link {
    fn send(&self, text: &str) {
        let _held = self.out.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let stdout = std::io::stdout();
        let mut out = stdout.lock();
        let _ = out.write_all(text.as_bytes());
        let _ = out.write_all(b"\n");
        let _ = out.flush();
    }

    fn cancelled(&self, id: u64) -> bool {
        self.cancels.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).contains(&id)
    }

    fn ask(&self, run: u64, name: &str, key: &str) -> Val {
        let q = self.asked.fetch_add(1, Ordering::SeqCst) + 1;
        let mut text = format!("{{\"t\":\"ask\",\"id\":{run},\"q\":{q},\"name\":");
        wire::quote(name, &mut text);
        text.push_str(",\"key\":");
        wire::quote(key, &mut text);
        text.push('}');
        self.send(&text);
        let mut answers = self.answers.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let line = loop {
            if let Some(line) = answers.got.remove(&q) {
                break line;
            }
            if answers.closed {
                panic!("the sidecar went away while {name} was asked");
            }
            answers = self.ready.wait(answers).unwrap_or_else(|poisoned| poisoned.into_inner());
        };
        drop(answers);
        let message = wire::parse(&line).unwrap_or_else(|error| panic!("the answer to {name} could not be read: {error}"));
        if let Val::Str(error) = message.get("error") {
            panic!("{name} failed in the sidecar: {error}");
        }
        message.get("v").clone()
    }
}

struct Lookups {
    link: Arc<Link>,
    run: u64,
    present: HashSet<String>,
    tables: HashMap<String, HashMap<String, Val>>,
    memo: Mutex<HashMap<(usize, String), Val>>,
    collation: HashMap<String, f64>,
}

impl Lookups {
    fn look(&self, at: usize, key: &str) -> Val {
        let name = READERS[at];
        if !self.present.contains(name) {
            return Val::Undef;
        }
        if let Some(found) = self.tables.get(name).and_then(|table| table.get(key)) {
            return found.clone();
        }
        let wanted = (at, key.to_string());
        if let Some(found) = self.memo.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).get(&wanted) {
            return found.clone();
        }
        let answer = self.link.ask(self.run, name, key);
        self.memo.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).insert(wanted, answer.clone());
        answer
    }
}

impl Hooks for Lookups {
    fn controller_of(&self, id: &str) -> Val {
        self.look(0, id)
    }
    fn sovereign_of(&self, id: &str) -> Val {
        self.look(1, id)
    }
    fn is_group(&self, name: &str) -> Val {
        self.look(2, name)
    }
    fn strength_of(&self, name: &str) -> Val {
        self.look(3, name)
    }
    fn shortage_of(&self, name: &str) -> Val {
        self.look(4, name)
    }
    fn military_of(&self, name: &str) -> Val {
        self.look(5, name)
    }
    fn muster_of(&self, name: &str) -> Val {
        self.look(6, name)
    }
    fn people_of(&self, name: &str) -> Val {
        self.look(7, name)
    }
    fn collate(&self, a: &str, b: &str) -> Option<f64> {
        Some(self.collation.get(a)? - self.collation.get(b)?)
    }
}

fn numbers(value: &Val) -> Vec<f64> {
    match value {
        Val::Typed(typed) => typed.values(),
        other => other.array_or_empty().iter().map(js::to_number).collect(),
    }
}

fn options_of(given: &Val) -> PlannerOptions {
    let number = |key: &str| match given.get(key) {
        Val::Num(n) => Some(*n),
        _ => None,
    };
    PlannerOptions {
        params: match given.get("params") {
            Val::Undef => None,
            other => Some(numbers(other)),
        },
        look: number("look"),
        ahead: number("ahead"),
        plans: match given.get("plans") {
            Val::Arr(list) => Some(list.iter().map(js::to_string).collect()),
            _ => None,
        },
        refine: number("refine"),
        replies: given.get("replies").truthy(),
        air_control: match given.get("airControl") {
            Val::Undef => None,
            other => Some(other.truthy()),
        },
        late: match given.get("late") {
            Val::Arr(list) => Some(list.iter().map(js::to_number).collect()),
            _ => None,
        },
    }
}

fn policy_of(value: &Val) -> Result<Option<Arc<dyn StaffHook>>, String> {
    if value.is_nullish() {
        return Ok(None);
    }
    let given = value.get("a").at(0);
    let made: Arc<dyn StaffHook> = match value.get("by").string_or_empty().as_str() {
        "mindPlanner.createPlanner" => Arc::new(create_planner(options_of(given))),
        "mindPlanner.createPlainerPlanner" => Arc::new(create_plainer_planner(options_of(given))),
        "mindTrained.labStaffPolicy" => Arc::new(lab_staff_policy(given)),
        "mindTrained.trainedStaffPolicy" => Arc::new(trained_staff_policy()),
        "mindPolicy.createStaffPolicy" => Arc::new(create_staff_policy(Shape::of(given.get("shape")), numbers(given.get("params")), if given.get("prior").is_undef() { 0.0 } else { given.get("prior").num() }, given.get("drafts").is_true())),
        "mindPolicy.createTroopPolicy" => Arc::new(create_troop_policy(Shape::of(given.get("shape")), numbers(given.get("params")))),
        other => return Err(format!("the staff {other} has no Rust port")),
    };
    Ok(Some(made))
}

struct Slot {
    run: FrontRun,
    key: String,
}

struct Host {
    link: Arc<Link>,
    runs: HashMap<u64, Slot>,
    kept: Option<(String, Kept)>,
}

fn reply(kind: &str, id: u64, rest: &str) -> String {
    format!("{{\"t\":\"{kind}\",\"id\":{id}{rest}}}")
}

impl Host {
    fn put_back(&mut self, mut slot: Slot) {
        if slot.key.is_empty() {
            return;
        }
        if let Some(kept) = slot.run.take_kept() {
            self.kept = Some((slot.key.clone(), kept));
        }
    }

    fn forget(&mut self, id: u64) {
        self.link.cancels.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(&id);
        if let Some(slot) = self.runs.remove(&id) {
            self.put_back(slot);
        }
    }

    fn open(&mut self, id: u64, mut message: Val) -> Result<String, String> {
        let policy = policy_of(message.get("policy"))?;
        for entry in message.get("metrics").array_or_empty() {
            register_metric_table(&entry.at(0).string_or_empty(), entry.at(1).num(), entry.at(2));
        }
        let present: HashSet<String> = message.get("readers").array_or_empty().iter().map(js::to_string).collect();
        let mut tables: HashMap<String, HashMap<String, Val>> = HashMap::new();
        if let Some(given) = message.get("tables").as_obj() {
            for (name, table) in given.entries() {
                if let Some(table) = table.as_obj() {
                    tables.insert(name.to_string(), table.entries().map(|(key, value)| (key.to_string(), value.clone())).collect());
                }
            }
        }
        let input = match &mut message {
            Val::Obj(obj) => obj.remove("input").unwrap_or(Val::Undef),
            _ => Val::Undef,
        };
        let cached = matches!(input.get("arenas"), Val::Map(_));
        let key = if cached { input.get("map").get("key").string_or_empty() } else { String::new() };
        let kept = match self.kept.take() {
            Some((held, kept)) if !key.is_empty() && held == key => kept,
            Some(other) if key.is_empty() => {
                self.kept = Some(other);
                Kept::default()
            }
            _ => Kept::default(),
        };
        let collation: HashMap<String, f64> = match message.get("collation").as_obj() {
            Some(given) => given.entries().map(|(name, rank)| (name.to_string(), rank.num())).collect(),
            None => HashMap::new(),
        };
        let hooks = Lookups { link: self.link.clone(), run: id, present, tables, memo: Mutex::new(HashMap::new()), collation };
        let run = create_front_run_kept(input, Box::new(hooks), policy, kept);
        let finished = run.finished();
        self.runs.insert(id, Slot { run, key });
        Ok(reply("opened", id, &format!(",\"finished\":{finished}")))
    }

    fn advance(&mut self, id: u64, message: &Val) -> Result<String, String> {
        let days = match message.get("days") {
            Val::Num(n) if *n >= 0.0 => *n,
            _ => f64::INFINITY,
        };
        let ms = match message.get("ms") {
            Val::Num(n) if *n > 0.0 => *n,
            _ => 100.0,
        };
        let began = Instant::now();
        let mut ran = 0.0;
        loop {
            if self.link.cancelled(id) {
                self.forget(id);
                return Ok(reply("cancelled", id, ""));
            }
            let slot = self.runs.get_mut(&id).ok_or("no such run")?;
            if slot.run.finished() || ran >= days {
                break;
            }
            slot.run.advance(1.0);
            ran += 1.0;
            if began.elapsed().as_secs_f64() * 1000.0 >= ms {
                break;
            }
        }
        let finished = self.runs.get(&id).map_or(true, |slot| slot.run.finished());
        Ok(reply("advanced", id, &format!(",\"ran\":{ran},\"finished\":{finished}")))
    }

    fn finish(&mut self, id: u64) -> Result<String, String> {
        let slot = self.runs.get_mut(&id).ok_or("no such run")?;
        let value = slot.run.finish();
        let mut text = reply("result", id, ",\"v\":");
        text.pop();
        wire::write(&value, &mut text);
        text.push('}');
        self.forget(id);
        Ok(text)
    }

    fn handle(&mut self, line: &str) -> Option<String> {
        let message = match wire::parse(line) {
            Ok(message) => message,
            Err(error) => return Some(format!("{{\"t\":\"error\",\"id\":0,\"message\":{}}}", wire::text_of(&Val::Str(error)))),
        };
        let id = message.get("id").num();
        let id = if id.is_finite() && id >= 0.0 { id as u64 } else { 0 };
        let kind = message.get("t").string_or_empty();
        let done = catch_unwind(AssertUnwindSafe(|| match kind.as_str() {
            "open" => self.open(id, message.clone()).map(Some),
            "advance" => self.advance(id, &message).map(Some),
            "finish" => self.finish(id).map(Some),
            "drop" => {
                self.forget(id);
                Ok(None)
            }
            "ping" => Ok(Some(reply("pong", id, ""))),
            other => Err(format!("unknown message {other}")),
        }));
        match done {
            Ok(Ok(answer)) => answer,
            Ok(Err(error)) => {
                self.runs.remove(&id);
                Some(reply("error", id, &format!(",\"message\":{}", wire::text_of(&Val::Str(error)))))
            }
            Err(panic) => {
                self.runs.remove(&id);
                self.link.cancels.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(&id);
                let error = panic.downcast_ref::<String>().cloned().or_else(|| panic.downcast_ref::<&str>().map(|text| text.to_string())).unwrap_or_else(|| "the Rust engine panicked".to_string());
                Some(reply("error", id, &format!(",\"message\":{}", wire::text_of(&Val::Str(error)))))
            }
        }
    }
}

fn number_after(line: &str, field: &str) -> Option<u64> {
    let at = line.find(field)? + field.len();
    let digits: String = line[at..].chars().take_while(|unit| unit.is_ascii_digit()).collect();
    digits.parse().ok()
}

fn main() {
    std::panic::set_hook(Box::new(|info| {
        eprintln!("[ohfronts-host] {info}");
    }));
    let link = Arc::new(Link { out: Mutex::new(()), answers: Mutex::new(Answers::default()), ready: Condvar::new(), asked: AtomicU64::new(0), cancels: Mutex::new(HashSet::new()) });
    let (sender, commands) = mpsc::channel::<String>();
    let reading = link.clone();
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        let mut input = stdin.lock();
        let mut line = String::new();
        loop {
            line.clear();
            match input.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let text = line.trim_end_matches(['\r', '\n']);
            if text.is_empty() {
                continue;
            }
            if text.starts_with("{\"t\":\"answer\"") {
                if let Some(q) = number_after(text, "\"q\":") {
                    let mut answers = reading.answers.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                    answers.got.insert(q, text.to_string());
                    reading.ready.notify_all();
                }
                continue;
            }
            if text.starts_with("{\"t\":\"cancel\"") {
                if let Some(id) = number_after(text, "\"id\":") {
                    reading.cancels.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).insert(id);
                }
                continue;
            }
            if sender.send(text.to_string()).is_err() {
                break;
            }
        }
        let mut answers = reading.answers.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        answers.closed = true;
        reading.ready.notify_all();
    });
    let mut host = Host { link: link.clone(), runs: HashMap::new(), kept: None };
    link.send("{\"t\":\"ready\",\"id\":0}");
    for line in commands {
        if let Some(answer) = host.handle(&line) {
            link.send(&answer);
        }
    }
}
