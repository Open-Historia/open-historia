use crate::arena::arena_of;
use crate::chronicle::chronicle_of;
use crate::climate::{climate_run_hooked, set_climate};
use crate::frame::frame_of;
use crate::fronts::*;
use crate::orders::shallow;
use crate::support::*;
use ohfronts::sim::battle::*;
use ohfronts::sim::command::talk_val;
use ohfronts::sim::deploy::{line_val, read_deploy};
use ohfronts::sim::engine::{create_run, Hooks, ManEntry, Run, War};
use ohfronts::sim::js::{Obj, OrdMap, Typed, Val};
use ohfronts::sim::mechanics::read_mechanics;
use ohfronts::sim::record::chronicle_record;
use std::rc::Rc;

pub struct Called {
    calls: Vec<(String, Vec<(Vec<Val>, Val)>)>,
    at: String,
}

impl Called {
    fn find(&self, name: &str, key: &str) -> Val {
        let wanted = format!("{}.{}", self.at, name);
        self.calls
            .iter()
            .filter(|(own, _)| *own == wanted)
            .flat_map(|(_, calls)| calls.iter())
            .find(|(args, _)| matches!(args.first(), Some(Val::Str(text)) if text == key))
            .map(|(_, result)| result.clone())
            .unwrap_or(Val::Undef)
    }
}

impl Hooks for Called {
    fn controller_of(&self, id: &str) -> Val {
        self.find("controllerOf", id)
    }
    fn sovereign_of(&self, id: &str) -> Val {
        self.find("sovereignOf", id)
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
        self.find("input.peopleOf", name)
    }
    fn is_group(&self, name: &str) -> Val {
        self.find("isGroup", name)
    }
}

fn hooked(case: &Case, at: usize) -> Box<Called> {
    Box::new(Called { calls: case.callbacks.clone(), at: at.to_string() })
}

fn input_of(case: &Case, at: usize, given: &Val) -> Val {
    let mut input = match given.get("input").plain() {
        Val::Obj(obj) => obj,
        _ => Obj::new(),
    };
    let mut areas = Obj::new();
    if let Some(calls) = case.calls(&format!("{at}.groupOf")) {
        for (args, result) in calls {
            if let Some(Val::Str(id)) = args.first() {
                areas.set(id, result.clone());
            }
        }
    }
    input.set("groupAreas", Val::Obj(areas));
    Val::Obj(input)
}

pub fn run_at(case: &Case, at: usize) -> Run {
    let given = case.arg(at).plain();
    let mut run = create_run(input_of(case, at, &given), hooked(case, at));
    fill_run(&mut run, &given);
    run
}

fn fill_run(run: &mut Run, given: &Val) {
    run.mech = read_mechanics(given.get("mech"));
    if let Val::Str(seed) = given.get("seed") {
        run.seed = seed.clone();
    }
    if given.get("steer").is_object() {
        run.steer = given.get("steer").clone();
    }
    let set = |key: &str, slot: &mut f64| {
        if let Val::Num(n) = given.get(key) {
            *slot = *n;
        }
    };
    set("troops", &mut run.troops);
    set("day", &mut run.day);
    set("menEach", &mut run.men_each);
    set("manpowerShare", &mut run.manpower_share);
    if let Val::Num(era) = given.get("era") {
        run.era = *era as usize;
    }
    if let Val::Str(warfare) = given.get("warfare") {
        run.warfare = warfare.clone();
    }
    if let Val::Map(entries) = given.get("manpower") {
        let mut book = OrdMap::new();
        for (key, entry) in entries {
            book.set(key.string(), ManEntry { name: entry.get("name").string_or_empty(), drawn: entry.get("drawn").num(), returned: entry.get("returned").num() });
        }
        run.manpower = std::cell::RefCell::new(book);
    }
    if let Val::Map(entries) = given.get("wars") {
        for (key, war) in entries {
            let sides = |at: usize| war.get("sides").at(at).array_or_empty().iter().map(|m| m.string_or_empty()).collect::<Vec<String>>();
            run.wars.set(key.string(), War { id: war.get("id").string_or_empty(), title: war.get("title").string_or_empty(), status: war.get("status").string_or_empty(), sides: [sides(0), sides(1)], began: war.get("began").string_or_empty() });
        }
    }
}

fn book_val(run: &Run) -> Val {
    Val::Map(run.manpower.borrow().entries.iter().map(|(key, entry)| (text(key), Val::obj([("name", text(&entry.name)), ("drawn", num(entry.drawn)), ("returned", num(entry.returned))]))).collect())
}

fn set_of(values: &[usize]) -> Val {
    Val::Set(values.iter().map(|&value| num(value as f64)).collect())
}

pub fn battle_from(run: &Run, value: &Val) -> Battle {
    let value = shallow(value).plain();
    let mut battle = pick_battle(run, &value);
    if !value.get("warId").is_undef() {
        battle.war_id = value.get("warId").clone();
    }
    battle.even = value.get("even").is_true();
    battle.swap = value.get("swap").is_true();
    battle.status = value.get("status").string_or_empty();
    if value.get("effort").is_object() {
        battle.effort = [value.get("effort").at(0).string_or_empty(), value.get("effort").at(1).string_or_empty()];
    }
    if value.get("base").is_object() {
        battle.base = [value.get("base").at(0).num(), value.get("base").at(1).num()];
    }
    if let Val::Num(km) = value.get("lineKm") {
        battle.line_km = *km;
    }
    if let Val::Str(key) = value.get("planKey") {
        battle.plan_key = key.clone();
    }
    battle.named = crate::troops::named_of(value.get("named"));
    if let Val::Map(entries) = value.get("shown") {
        for (key, item) in entries {
            battle.shown.set(key.string(), item.clone());
        }
    }
    if value.get("regionSide").is_object() {
        battle.region_side = Some(arg_numbers(value.get("regionSide")).iter().map(|&n| n as i8).collect());
    }
    battle
}

fn levy_val(battle: &Battle) -> Val {
    list(battle.levy.iter().map(|side| list(side.iter().map(|levy| Val::obj([("o", num(levy.o)), ("t", num(levy.t)), ("r", num(levy.r)), ("f", text(&levy.f))])).collect())).collect())
}

fn compare(got: &Val, want: &Val, keys: &[&str]) -> Result<(), String> {
    for key in keys {
        if !want.get(key).is_undef() {
            same(got.get(key), want.get(key)).map_err(|error| format!("{key}: {error}"))?;
        }
    }
    Ok(())
}

pub fn raise_troops_check(case: &Case) -> Option<Result<(), String>> {
    let run_value = case.arg(1);
    let mut run = run_at(case, 1);
    let me = run_value.get("battles").array_or_empty().iter().position(|front| front.same_ref(case.arg(0)));
    run.battles = run_value.get("battles").array_or_empty().iter().map(|front| battle_from(&run, front)).collect();
    let mut battle = battle_from(&run, case.arg(0));
    raise_troops(&mut battle, &run, me, case.arg(2).num() as i64);
    let want = shallow(&want_after(case, 0)).plain();
    let got = Val::obj([
        ("quality", nums(&battle.quality)),
        ("base", nums(&battle.base)),
        ("pool", nums(&battle.pool)),
        ("lineKm", num(battle.line_km)),
        ("planKey", text(&battle.plan_key)),
        ("levy", levy_val(&battle)),
        ("swarms", list(battle.swarms.iter().map(|side| set_of(side)).collect())),
    ]);
    if let Err(error) = compare(&got, &want, &["quality", "base", "pool", "lineKm", "planKey", "levy", "swarms"]) {
        return Some(Err(error));
    }
    if let Err(error) = troops_like(&battle, &want) {
        return Some(Err(error));
    }
    let run_want = want_after(case, 1).plain();
    Some(same(&book_val(&run), run_want.get("manpower")).map_err(|error| format!("manpower: {error}")))
}

fn changes_val(run: &Run, battle: &Battle) -> Val {
    list(
        run.unit_changes
            .iter()
            .map(|change| {
                let mut out = match change.plain() {
                    Val::Obj(obj) => obj,
                    _ => Obj::new(),
                };
                if out.get("committedTo").map(|to| to.get("battle").is_object() || matches!(to.get("battle"), Val::Num(_))).unwrap_or(false) {
                    out.set("committedTo", Val::obj([("name", text(&battle.name))]));
                }
                Val::Obj(out)
            })
            .collect(),
    )
}

fn named_val(battle: &Battle) -> Val {
    list(
        battle
            .named
            .iter()
            .map(|entry| {
                let mut out = Val::obj([("s", num(entry.s as f64)), ("i", num(entry.i as f64)), ("name", text(&entry.name)), ("unitId", entry.unit_id.clone())]);
                if entry.reported {
                    if let Val::Obj(obj) = &mut out {
                        obj.set("reported", Val::Bool(true));
                    }
                }
                out
            })
            .collect(),
    )
}

pub fn absorb_unit_check(case: &Case) -> Option<Result<(), String>> {
    let mut run = run_at(case, 1);
    run.unit_changes = case.arg(1).get("unitChanges").array_or_empty().to_vec();
    let mut battle = battle_from(&run, case.arg(0));
    let any = case.arg(3).get("anyDistance").truthy();
    let taken = absorb_unit(&mut battle, &mut run, 0, case.arg(2), any);
    if let Some(Err(error)) = expect(case, Val::Bool(taken)) {
        return Some(Err(error));
    }
    let want = want_after(case, 0).plain();
    let got = Val::obj([("named", named_val(&battle)), ("planKey", text(&battle.plan_key))]);
    if let Err(error) = compare(&got, &want, &["named", "planKey"]) {
        return Some(Err(error));
    }
    if let Err(error) = troops_like(&battle, &want) {
        return Some(Err(error));
    }
    Some(same(&changes_val(&run, &battle), want_after(case, 1).get("unitChanges")).map_err(|error| format!("unitChanges: {error}")))
}

pub fn release_named_check(case: &Case) -> Option<Result<(), String>> {
    let mut run = run_at(case, 1);
    run.unit_changes = case.arg(1).get("unitChanges").array_or_empty().to_vec();
    let mut battle = battle_from(&run, case.arg(0));
    release_named(&mut battle, &mut run);
    let want = want_after(case, 0).plain();
    if let Err(error) = same(&named_val(&battle), want.get("named")) {
        return Some(Err(format!("named: {error}")));
    }
    Some(same(&changes_val(&run, &battle), want_after(case, 1).get("unitChanges")).map_err(|error| format!("unitChanges: {error}")))
}

fn i8s_or_null(values: &Option<Vec<i8>>) -> Val {
    values.as_ref().map(|values| Val::Typed(Typed::I8(values.clone()))).unwrap_or(Val::Null)
}

fn edge_val(edge: &ohfronts::sim::constants::Edge) -> Val {
    Val::obj([("power", num(edge.power)), ("pace", num(edge.pace)), ("reserves", num(edge.reserves)), ("mend", num(edge.mend))])
}

fn battle_val(battle: &Battle) -> Val {
    let field = battle.field.as_ref().unwrap();
    Val::obj([
        ("name", text(&battle.name)),
        ("warId", battle.war_id.clone()),
        ("status", text(&battle.status)),
        ("sides", list(battle.sides.iter().map(|members| list(members.iter().map(|m| text(m)).collect())).collect())),
        ("gone", list(battle.gone.iter().map(|side| set_of(side)).collect())),
        ("openedDate", battle.opened_date.clone()),
        ("openedDay", battle.opened_day.clone()),
        ("fresh", Val::Bool(battle.fresh)),
        ("served", Val::Bool(battle.served)),
        ("shown", Val::Map(battle.shown.entries.iter().map(|(key, item)| (text(key), item.clone())).collect())),
        ("regionSide", i8s_or_null(&battle.region_side)),
        ("homeSide", i8s_or_null(&battle.home_side)),
        ("homes", battle.homes.as_ref().map(|homes| u8s(homes.clone())).unwrap_or(Val::Null)),
        ("iceSide", i8s_or_null(&battle.ice_side)),
        ("edge", list(battle.edge.iter().map(edge_val).collect())),
        ("short", battle.short.map(|short| nums(&short)).unwrap_or(Val::Undef)),
        ("worth", battle.worth.as_ref().map(|worth| list(worth.iter().map(|side| nums(side)).collect())).unwrap_or(Val::Null)),
        ("named", named_val(battle)),
        ("pool", nums(&battle.pool)),
        ("base", nums(&battle.base)),
        ("quality", nums(&battle.quality)),
        ("effort", list(battle.effort.iter().map(|e| text(e)).collect())),
        ("mind", battle.mind.clone()),
        ("orders", list(battle.orders.clone())),
        ("halts", list(battle.halts.clone())),
        ("anchors", list(battle.anchors.clone())),
        ("pockets", list(battle.pockets.iter().map(pocket_val).collect())),
        ("log", list(battle.log.clone())),
        ("logFrom", num(battle.log_from)),
        ("quiet", num(battle.quiet)),
        ("away", list(battle.away.iter().map(|&flag| Val::Bool(flag)).collect())),
        ("sentHome", Val::Map(battle.sent_home.entries.iter().map(|(key, side)| (text(key), side.clone())).collect())),
        ("generals", list(battle.generals.iter().map(|names| list(names.iter().map(|n| text(n)).collect())).collect())),
        ("talk", list(battle.talk.iter().map(|lines| list(lines.iter().map(talk_val).collect())).collect())),
        ("swarms", list(battle.swarms.iter().map(|side| set_of(side)).collect())),
        ("plans", battle.plans.clone()),
        ("deploy", battle.deploy.as_ref().map(|deploy| list(deploy.iter().map(|lines| list(lines.iter().map(line_val).collect())).collect())).unwrap_or(Val::Null)),
        ("staffPlans", battle.staff_plans.clone()),
        ("chronicle", battle.chronicle.as_ref().map(chronicle_record).unwrap_or(Val::Null)),
        ("levy", levy_val(battle)),
        ("seed", text(&battle.seed)),
        ("even", Val::Bool(battle.even)),
        ("lineKm", num(battle.line_km)),
        ("field", Val::obj([("holders", u8s(field.holders.clone())), ("phi", typed_f64(&field.phi)), ("play", u8s(field.play.clone())), ("cols", num(field.cols as f64)), ("rows", num(field.rows as f64))])),
    ])
}

const LOAD_KEYS: [&str; 44] = [
    "name", "warId", "status", "sides", "gone", "openedDate", "openedDay", "fresh", "served", "shown", "regionSide", "homeSide", "homes", "iceSide", "edge", "short", "worth", "named", "pool", "base", "quality", "effort", "mind", "orders", "halts", "anchors", "pockets", "log", "logFrom", "quiet",
    "away", "sentHome", "generals", "talk", "swarms", "plans", "deploy", "staffPlans", "chronicle", "levy", "seed", "even", "lineKm", "field",
];

fn battle_like(battle: &Battle, want: &Val) -> Result<(), String> {
    compare(&battle_val(battle), want, &LOAD_KEYS)?;
    troops_like(battle, want)
}

pub fn load_battle_check(case: &Case) -> Option<Result<(), String>> {
    let run = run_at(case, 0);
    let arena = Rc::new(arena_of(case.arg(2)));
    let battle = load_battle(&run, case.arg(1), arena);
    let want = case.result.as_ref()?.plain();
    Some(battle_like(&battle, &want))
}

pub fn open_battle_check(case: &Case) -> Option<Result<(), String>> {
    let run = run_at(case, 0);
    let given = case.arg(1);
    let sides = |at: usize| given.get("sides").at(at).array_or_empty().iter().map(|m| m.string_or_empty()).collect::<Vec<String>>();
    let opened = Opened { name: given.get("name").string_or_empty(), war_id: given.get("warId").clone(), sides: [sides(0), sides(1)], frame: frame_of(given.get("frame")), arena: Rc::new(arena_of(given.get("arena"))), day: given.get("day").num() };
    let battle = open_battle(&run, opened);
    let want = case.result.as_ref()?.plain();
    match battle {
        None => Some(same(&Val::Null, &want)),
        Some(battle) => {
            if want.is_nullish() {
                return Some(Err("opened a battle JS did not".into()));
            }
            Some(battle_like(&battle, &want))
        }
    }
}

fn troop_order(value: &Val) -> Val {
    let mut order = shallow(value);
    if let Val::Obj(obj) = &mut order {
        if let Some(resume) = obj.get("resume").cloned() {
            obj.set("resume", shallow(&resume));
        }
    }
    order
}

pub fn save_battle_check(case: &Case) -> Option<Result<(), String>> {
    let given = case.arg(1).plain();
    let mut value = match given.clone() {
        Val::Obj(obj) => obj,
        _ => Obj::new(),
    };
    value.set("input", input_of(case, 1, &given));
    let mut run = climate_run_hooked(&Val::Obj(value), hooked(case, 1));
    run.mech = read_mechanics(given.get("mech"));
    let raw = shallow(case.arg(0));
    let plain = raw.plain();
    let mut battle = battle_from(&run, &plain);
    battle.orders = raw.get("orders").array_or_empty().iter().map(|order| order.clone().share()).collect();
    for side in 0..2 {
        let troops = raw.get("troops").at(side).array_or_empty();
        for (index, troop) in battle.troops[side].iter_mut().enumerate() {
            let order = troops.get(index).map(|troop| shallow(troop).get("order").clone()).unwrap_or(Val::Undef);
            troop.order = if order.is_undef() { Val::Null } else { troop_order(&order) };
        }
    }
    if let Val::Str(date) = plain.get("openedDate") {
        battle.opened_date = Val::Str(date.clone());
    }
    battle.closed_date = plain.get("closedDate").string_or_empty();
    battle.homes = if plain.get("homes").is_object() { Some(bytes(plain.get("homes"))) } else { None };
    battle.pool = [plain.get("pool").at(0).num(), plain.get("pool").at(1).num()];
    battle.quality = [plain.get("quality").at(0).num(), plain.get("quality").at(1).num()];
    battle.mind = plain.get("mind").clone();
    battle.levy = [0, 1].map(|side| plain.get("levy").at(side).array_or_empty().iter().map(|entry| ohfronts::sim::muster::Levy { o: entry.get("o").num(), t: entry.get("t").num(), r: entry.get("r").num(), f: entry.get("f").string_or_empty() }).collect());
    battle.generals = [0, 1].map(|side| plain.get("generals").at(side).array_or_empty().iter().map(|name| name.string_or_empty()).collect());
    battle.talk = ohfronts::sim::command::read_talk(plain.get("talk"));
    battle.plans = plain.get("plans").clone();
    battle.days_run = plain.get("daysRun").num();
    battle.deploy = if plain.get("deploy").as_array().is_some() { Some(read_deploy(plain.get("deploy"))) } else { None };
    battle.staff_plans = if plain.get("staffPlans").is_undef() { Val::Null } else { plain.get("staffPlans").clone() };
    battle.quiet = plain.get("quiet").num();
    battle.away = [plain.get("away").at(0).is_true(), plain.get("away").at(1).is_true()];
    if let Val::Map(entries) = plain.get("sentHome") {
        for (key, side) in entries {
            battle.sent_home.set(key.string(), side.clone());
        }
    }
    battle.halts = plain.get("halts").array_or_empty().to_vec();
    battle.pockets = plain
        .get("pockets")
        .array_or_empty()
        .iter()
        .map(|pocket| ohfronts::sim::closing::Pocket { s: pocket.get("s").num() as usize, cell: pocket.get("cell").num(), days: pocket.get("days").num(), km2: pocket.get("km2").num(), cells: None, cx: None, cy: None, siege: pocket.get("siege").string_or_empty(), told: pocket.get("told").truthy() })
        .collect();
    battle.log_from = if plain.get("logFrom").is_nullish() { 0.0 } else { plain.get("logFrom").num() };
    battle.chronicle = chronicle_of(plain.get("chronicle"));
    set_climate(&run, &mut battle, &plain);
    if let Some(field) = battle.field.as_mut() {
        field.arena = battle.arena.clone();
    }
    let finish = case.calls("0.recorder.finish");
    battle.replay = if plain.get("replay").is_nullish() { finish.and_then(|calls| calls.first()).map(|(_, result)| result.clone()) } else { Some(plain.get("replay").clone()) };
    if let Some(calls) = finish {
        if let Some((args, _)) = calls.first() {
            let asked = Val::obj([("date", run.input.get("fromDate").clone()), ("days", case.arg(2).clone())]);
            if let Err(error) = same(&asked, &args[0]) {
                return Some(Err(format!("finish asked: {error}")));
            }
        }
    }
    let mut changes = case.arg(3).array_or_empty().to_vec();
    let record = save_battle(&mut battle, &run, case.arg(2).num(), &mut changes, case.arg(4));
    if let Some(Err(error)) = expect(case, record) {
        return Some(Err(error));
    }
    if let Err(error) = expect_after(case, 3, &list(changes)) {
        return Some(Err(error));
    }
    let want = shallow(&want_after(case, 0)).plain();
    Some(compare(&Val::obj([("swarms", list(battle.swarms.iter().map(|side| set_of(side)).collect()))]), &want, &["swarms"]))
}

pub fn keep_start_check(case: &Case) -> Option<Result<(), String>> {
    let run = bare_run();
    let value = case.arg(0).plain();
    let mut battle = pick_battle(&run, &value);
    keep_start(&mut battle);
    let want = want_after(case, 0).plain();
    let got = Val::obj([
        ("startPhi", battle.start_phi.as_ref().map(|phi| typed_f64(phi)).unwrap_or(Val::Null)),
        ("startHolders", battle.start_holders.as_ref().map(|holders| u8s(holders.clone())).unwrap_or(Val::Null)),
        ("cityHolder", battle.city_holder.as_ref().map(|cities| Val::Typed(Typed::I8(cities.clone()))).unwrap_or(Val::Null)),
    ]);
    Some(compare(&got, &want, &["startPhi", "startHolders", "cityHolder"]))
}

pub fn is_land_formation_check(case: &Case) -> Option<Result<(), String>> {
    expect(case, Val::Bool(is_land_formation(case.arg(0))))
}
