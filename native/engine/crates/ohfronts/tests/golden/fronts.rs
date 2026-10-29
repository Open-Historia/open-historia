use crate::arena::arena_of;
use crate::climate::{effects_from, sky_from};
use crate::frame::frame_of;
use crate::support::*;
use crate::troops::{troop_of, troop_val};
use crate::walls::line_of;
use ohfronts::sim::air::BattleWings;
use ohfronts::sim::battle::{create_battle, Battle, Opening};
use ohfronts::sim::closing::{Books, Pocket, Prey};
use ohfronts::sim::constants::Edge;
use ohfronts::sim::deploy::DeployLine;
use ohfronts::sim::engine::{create_run, NoHooks, Run};
use ohfronts::sim::field::{create_field, Field};
use ohfronts::sim::js::{Obj, Typed, Val};
use ohfronts::sim::muster::Levy;
use ohfronts::sim::troops::Troop;
use ohfronts::sim::walls::Walls;
use std::rc::Rc;

pub fn ints(value: &Val) -> Vec<i32> {
    arg_numbers(value).iter().map(|&n| n as i32).collect()
}

pub fn bytes(value: &Val) -> Vec<u8> {
    arg_numbers(value).iter().map(|&n| n as u8).collect()
}

fn pair<T, F: Fn(&Val) -> T>(value: &Val, each: F) -> Option<[T; 2]> {
    if value.is_object() {
        Some([each(value.at(0)), each(value.at(1))])
    } else {
        None
    }
}

fn maybe<T, F: Fn(&Val) -> T>(value: &Val, each: F) -> Option<T> {
    if value.is_object() {
        Some(each(value))
    } else {
        None
    }
}

pub fn field_lite(value: &Val, speed: &Val) -> Field {
    let (cols, rows) = (value.get("cols").num(), value.get("rows").num());
    let mut shape = Obj::new();
    shape.set("cols", num(cols));
    shape.set("rows", num(rows));
    shape.set("size", num(cols * rows));
    if !speed.is_undef() {
        shape.set("speed", speed.clone());
    }
    let mut field = create_field(Rc::new(arena_of(&Val::Obj(shape))));
    if value.get("holders").is_object() {
        field.holders = bytes(value.get("holders"));
    }
    if value.get("play").is_object() {
        field.play = bytes(value.get("play"));
    }
    if value.get("phi").is_object() {
        field.phi = arg_numbers(value.get("phi"));
    }
    if !value.get("turns").is_undef() {
        field.turns = value.get("turns").num() as i64;
    }
    field
}

pub fn troop_full(value: &Val) -> Troop {
    let mut troop = troop_of(value);
    let set = |key: &str, slot: &mut f64| {
        if !value.get(key).is_undef() {
            *slot = value.get(key).num();
        }
    };
    set("punch", &mut troop.punch);
    set("rested", &mut troop.rested);
    set("command", &mut troop.command);
    set("next", &mut troop.next);
    if !value.get("order").is_undef() {
        troop.order = value.get("order").clone();
    }
    if !value.get("fallback").is_undef() {
        troop.fallback = value.get("fallback").clone();
    }
    if !value.get("squeezed").is_undef() {
        troop.squeezed = value.get("squeezed").truthy();
    }
    if value.get("climate").truthy() {
        troop.climate = Some(effects_from(value.get("climate")));
    }
    troop
}

fn edge_of(value: &Val) -> Edge {
    let n = |key: &str| value.get(key).num();
    Edge { power: n("power"), pace: n("pace"), reserves: n("reserves"), mend: n("mend") }
}

fn pocket_of(value: &Val) -> Pocket {
    let opt = |key: &str| if value.get(key).is_undef() { None } else { Some(value.get(key).num()) };
    Pocket {
        s: value.get("s").num() as usize,
        cell: value.get("cell").num(),
        days: value.get("days").num(),
        km2: value.get("km2").num(),
        cells: opt("cells"),
        cx: opt("cx"),
        cy: opt("cy"),
        siege: value.get("siege").string_or_empty(),
        told: value.get("told").truthy(),
    }
}

fn prey_of(value: &Val) -> Prey {
    let n = |key: &str| value.get(key).num();
    Prey { id: n("id") as usize, km2: n("km2"), cx: n("cx"), cy: n("cy"), cells: n("cells"), inside: arg_numbers(value.get("inside")).iter().map(|&n| n as usize).collect(), held: n("held"), needed: n("needed") }
}

pub fn prey_val(prey: &Prey) -> Val {
    Val::obj([
        ("id", num(prey.id as f64)),
        ("km2", num(prey.km2)),
        ("cx", num(prey.cx)),
        ("cy", num(prey.cy)),
        ("cells", num(prey.cells)),
        ("inside", list(prey.inside.iter().map(|&n| num(n as f64)).collect())),
        ("held", num(prey.held)),
        ("needed", num(prey.needed)),
    ])
}

fn books_of(value: &Val) -> Books {
    let size = value.get("size").num() as usize;
    let mut books = Books::new(size);
    books.key = value.get("key").string_or_empty();
    let u8s_of = |key: &str, slot: &mut [Vec<u8>; 2]| {
        if let Some(found) = pair(value.get(key), bytes) {
            *slot = found;
        }
    };
    u8s_of("squeezed", &mut books.squeezed);
    u8s_of("was", &mut books.was);
    u8s_of("prey", &mut books.prey);
    let i32s_of = |key: &str, slot: &mut [Vec<i32>; 2]| {
        if let Some(found) = pair(value.get(key), ints) {
            *slot = found;
        }
    };
    i32s_of("toPrey", &mut books.to_prey);
    i32s_of("preyNear", &mut books.prey_near);
    i32s_of("toSupplied", &mut books.to_supplied);
    if let Some(found) = pair(value.get("pockets"), |side| side.array_or_empty().iter().map(prey_of).collect()) {
        books.pockets = found;
    }
    if let Some(found) = pair(value.get("cut"), |flag| flag.truthy()) {
        books.cut = found;
    }
    books
}

pub fn books_val(books: &Books) -> Val {
    let u8s_pair = |slot: &[Vec<u8>; 2]| list(vec![u8s(slot[0].clone()), u8s(slot[1].clone())]);
    let i32s_pair = |slot: &[Vec<i32>; 2]| list(vec![i32s(slot[0].clone()), i32s(slot[1].clone())]);
    Val::obj([
        ("size", num(books.size as f64)),
        ("key", text(&books.key)),
        ("squeezed", u8s_pair(&books.squeezed)),
        ("was", u8s_pair(&books.was)),
        ("prey", u8s_pair(&books.prey)),
        ("toPrey", i32s_pair(&books.to_prey)),
        ("preyNear", i32s_pair(&books.prey_near)),
        ("toSupplied", i32s_pair(&books.to_supplied)),
        ("pockets", list(books.pockets.iter().map(|side| list(side.iter().map(prey_val).collect())).collect())),
        ("cut", list(books.cut.iter().map(|&flag| Val::Bool(flag)).collect())),
    ])
}

fn deploy_line_of(value: &Val) -> DeployLine {
    DeployLine {
        country: value.get("country").string_or_empty(),
        way: value.get("way").array_or_empty().iter().map(|point| [point.element(0).num(), point.element(1).num()]).collect(),
        swarm: matches!(value.get("form"), Val::Str(form) if form == "swarm"),
        call: None,
        last: None,
    }
}

pub fn bare_run() -> Run {
    create_run(Val::Obj(Obj::new()), Box::new(NoHooks))
}

pub fn run_lite(value: &Val) -> Run {
    let mut run = bare_run();
    let speeds = arg_numbers(value.get("advanceKm"));
    for at in 0..3 {
        run.advance_km[at] = speeds.get(at).copied().unwrap_or(f64::NAN);
    }
    if !value.get("pace").is_undef() {
        run.pace = value.get("pace").num();
    }
    run
}

pub fn pick_battle(run: &Run, value: &Val) -> Battle {
    let sides = |at: usize| -> Vec<String> { value.get("sides").at(at).array_or_empty().iter().map(|m| m.string_or_empty()).collect() };
    let arena = Rc::new(arena_of(value.get("arena")));
    let mut battle = create_battle(run, Opening { name: value.get("name").string_or_empty(), war_id: Val::Undef, sides: [sides(0), sides(1)], frame: frame_of(value.get("frame")), arena: arena.clone(), opened_date: Val::Undef, opened_day: Val::Undef });
    if !value.get("seed").is_undef() {
        battle.seed = value.get("seed").string_or_empty();
    }
    if value.get("field").is_object() {
        let mut field = field_lite(value.get("field"), &Val::Undef);
        if !value.get("arena").get("speed").is_undef() {
            field.arena = arena.clone();
        }
        battle.field = Some(field);
    }
    for side in 0..2 {
        if let Val::Set(items) = value.get("gone").at(side) {
            battle.gone[side] = items.iter().map(|item| item.num() as usize).collect();
        }
        if let Val::Set(items) = value.get("swarms").at(side) {
            battle.swarms[side] = items.iter().map(|item| item.num() as usize).collect();
        }
        battle.troops[side] = value.get("troops").at(side).array_or_empty().iter().map(troop_full).collect();
        if value.get("quality").is_object() {
            battle.quality[side] = value.get("quality").at(side).num();
        }
        if value.get("edge").is_object() {
            battle.edge[side] = edge_of(value.get("edge").at(side));
        }
        if value.get("radiusKm").is_object() {
            battle.radius_km[side] = value.get("radiusKm").at(side).num();
        }
        if value.get("kept").is_object() {
            battle.kept[side] = maybe(value.get("kept").at(side), bytes);
        }
        if value.get("spared").is_object() {
            battle.spared[side] = arg_numbers(value.get("spared").at(side));
        }
        if value.get("wallMask").is_object() {
            battle.wall_mask[side] = maybe(value.get("wallMask").at(side), bytes);
        }
        if value.get("levy").is_object() {
            battle.levy[side] = value.get("levy").at(side).array_or_empty().iter().map(|entry| Levy { o: entry.get("o").num(), t: entry.get("t").num(), r: entry.get("r").num(), f: entry.get("f").string_or_empty() }).collect();
        }
    }
    battle.orders = value.get("orders").array_or_empty().to_vec();
    battle.home_side = maybe(value.get("homeSide"), |v| arg_numbers(v).iter().map(|&n| n as i8).collect());
    battle.homes = maybe(value.get("homes"), bytes);
    battle.fed = pair(value.get("fed"), bytes);
    battle.body_of = pair(value.get("bodyOf"), ints);
    battle.pocket_of = pair(value.get("pocketOf"), ints);
    battle.pockets = value.get("pockets").array_or_empty().iter().map(pocket_of).collect();
    battle.close = maybe(value.get("close"), books_of);
    battle.sieges = value.get("sieges").array_or_empty().to_vec();
    if value.get("takenFor").is_object() && value.get("field").is_object() {
        let (field, taken) = (value.get("field"), value.get("takenFor"));
        battle.taken_for = ["cols", "rows", "size"].iter().all(|key| same(taken.get(key), field.get(key)).is_ok());
    }
    if !value.get("takenTurns").is_undef() {
        battle.taken_turns = Some(value.get("takenTurns").num() as i64);
    }
    if !value.get("takenCells").is_undef() {
        battle.taken_cells = value.get("takenCells").num();
    }
    if value.get("deploy").is_object() {
        battle.deploy = pair(value.get("deploy"), |side| side.array_or_empty().iter().map(deploy_line_of).collect());
    }
    if value.get("walls").is_object() {
        battle.walls = Some(Rc::new(Walls { cell_line: arg_numbers(value.get("walls").get("cellLine")).iter().map(|&n| n as i16).collect(), cell_km: Vec::new(), sides: Vec::new() }));
    }
    if value.get("wallRun").is_object() {
        battle.wall_run = true;
        if let Some(lines) = value.get("wallRun").get("lines").as_array() {
            *run.lines.borrow_mut() = Some(lines.iter().map(line_of).collect());
        }
    }
    let wings = value.get("wings");
    if wings.is_object() {
        battle.wings = Some(BattleWings { holds: wings.get("holds").num() as usize, weight: [0.0, 0.0], superiority: wings.get("superiority").num(), flying: [Vec::new(), Vec::new()], strike: None });
    }
    battle.sky = sky_from(value.get("sky"));
    battle
}

pub fn want_after(case: &Case, at: usize) -> Val {
    case.after.as_ref().map(|after| after[at].clone()).unwrap_or_else(|| case.arg(at).clone())
}

pub fn troops_like(battle: &Battle, want: &Val) -> Result<(), String> {
    for side in 0..2 {
        let wanted = want.get("troops").at(side).array_or_empty();
        if wanted.len() != battle.troops[side].len() {
            return Err(format!("side {side}: {} troops want {}", battle.troops[side].len(), wanted.len()));
        }
        for (index, (troop, want)) in battle.troops[side].iter().zip(wanted).enumerate() {
            let got = troop_val(troop);
            if let Val::Obj(keys) = want {
                for (key, value) in keys.entries() {
                    same(got.get(key), value).map_err(|error| format!("troop {side}/{index}.{key}: {error}"))?;
                }
            }
        }
    }
    Ok(())
}

pub fn indexes(value: &Val) -> Vec<usize> {
    arg_numbers(value).iter().map(|&n| n as usize).collect()
}

pub fn points(value: &Val) -> Vec<[f64; 2]> {
    value.array_or_empty().iter().map(|point| [point.element(0).num(), point.element(1).num()]).collect()
}

pub fn point_val(point: [f64; 2]) -> Val {
    nums(&point)
}

pub fn typed_f64(values: &[f64]) -> Val {
    Val::Typed(Typed::F64(values.to_vec()))
}
