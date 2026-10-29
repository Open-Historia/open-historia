use crate::arena::arena_of;
use crate::climate::sky_from;
use crate::frame::frame_of;
use crate::support::*;
use crate::troops::troop_of;
use ohfronts::sim::air::*;
use ohfronts::sim::battle::{create_battle, Battle, Opening};
use ohfronts::sim::engine::{create_run, Hooks, NoHooks, Run};
use ohfronts::sim::field::create_field;
use ohfronts::sim::js::{Obj, OrdMap, Val};
use ohfronts::sim::mechanics::read_mechanics;
use std::rc::Rc;

struct Figures(Vec<(Vec<Val>, Val)>);

impl Hooks for Figures {
    fn military_of(&self, name: &str) -> Val {
        self.0.iter().find(|(args, _)| matches!(args.first(), Some(Val::Str(text)) if text == name)).map(|(_, result)| result.clone()).unwrap_or(Val::Undef)
    }
}

fn wing_of(value: &Val) -> Wing {
    let at = |key: &str| match value.get(key) {
        Val::Num(n) => Some(*n),
        _ => None,
    };
    Wing { id: value.get("id").string_or_empty(), owner: value.get("owner").string_or_empty(), strength: value.get("strength").num(), began: value.get("began").num(), lng: at("lng"), lat: at("lat"), arm: value.get("arm").is_true(), changed: value.get("changed").is_true() }
}

fn wing_val(wing: &Wing) -> Val {
    let mut out = Obj::new();
    out.set("id", text(&wing.id));
    out.set("owner", text(&wing.owner));
    out.set("strength", num(wing.strength));
    out.set("began", num(wing.began));
    if let Some(lng) = wing.lng {
        out.set("lng", num(lng));
    }
    if let Some(lat) = wing.lat {
        out.set("lat", num(lat));
    }
    if wing.arm {
        out.set("arm", Val::Bool(true));
    }
    if wing.changed {
        out.set("changed", Val::Bool(true));
    }
    Val::Obj(out)
}

fn set_wings(run: &Run, value: &Val) {
    if let Val::Map(entries) = value {
        let mut book = OrdMap::new();
        for (id, wing) in entries {
            book.set(id.string_or_empty(), wing_of(wing));
        }
        *run.wings.borrow_mut() = Some(book);
    }
}

fn wings_val(run: &Run) -> Val {
    match &*run.wings.borrow() {
        Some(book) => Val::Map(book.entries.iter().map(|(id, wing)| (text(id), wing_val(wing))).collect()),
        None => Val::Undef,
    }
}

fn battle_wings_of(value: &Val) -> Option<BattleWings> {
    if !value.is_object() {
        return None;
    }
    let ids = |side: usize| value.get("flying").at(side).array_or_empty().iter().map(|wing| wing.get("id").string_or_empty()).collect();
    Some(BattleWings {
        holds: value.get("holds").num() as usize,
        weight: [value.get("weight").at(0).num(), value.get("weight").at(1).num()],
        superiority: value.get("superiority").num(),
        flying: [ids(0), ids(1)],
        strike: match value.get("strike") {
            Val::Num(n) => Some(*n),
            _ => None,
        },
    })
}

fn battle_wings_val(run: &Run, wings: &Option<BattleWings>) -> Val {
    let wings = match wings {
        Some(wings) => wings,
        None => return Val::Null,
    };
    let book = run.wings.borrow();
    let flying = |side: usize| list(wings.flying[side].iter().map(|id| book.as_ref().and_then(|book| book.get(id)).map(wing_val).unwrap_or(Val::Null)).collect());
    let mut out = Obj::new();
    out.set("holds", num(wings.holds as f64));
    out.set("weight", nums(&wings.weight));
    out.set("superiority", num(wings.superiority));
    out.set("flying", list(vec![flying(0), flying(1)]));
    if let Some(strike) = wings.strike {
        out.set("strike", num(strike));
    }
    Val::Obj(out)
}

fn air_battle(run: &Run, value: &Val) -> Battle {
    let sides = |at: usize| -> Vec<String> { value.get("sides").at(at).array_or_empty().iter().map(|m| m.string_or_empty()).collect() };
    let field = value.get("field");
    let (cols, rows) = (field.get("cols").num(), field.get("rows").num());
    let arena = Rc::new(arena_of(&Val::obj([("frame", value.get("frame").clone()), ("cols", num(cols)), ("rows", num(rows)), ("size", num(cols * rows))])));
    let mut battle = create_battle(run, Opening { name: value.get("name").string_or_empty(), war_id: Val::Undef, sides: [sides(0), sides(1)], frame: frame_of(value.get("frame")), arena: arena.clone(), opened_date: Val::Undef, opened_day: Val::Undef });
    if field.is_object() {
        battle.field = Some(create_field(arena));
    }
    battle.status = value.get("status").string_or_empty();
    for side in 0..2 {
        battle.gone[side] = match value.get("gone").at(side) {
            Val::Set(items) => items.iter().map(|item| item.num() as usize).collect(),
            _ => Vec::new(),
        };
        battle.troops[side] = value.get("troops").at(side).array_or_empty().iter().map(troop_of).collect();
        battle.air_mission[side] = match value.get("airMission").at(side) {
            Val::Str(mission) => mission.clone(),
            _ => String::new(),
        };
    }
    battle.sky = sky_from(value.get("sky"));
    battle.wings = battle_wings_of(value.get("wings"));
    battle
}

fn bare_run() -> Run {
    create_run(Val::Obj(Obj::new()), Box::new(NoHooks))
}

fn after_of(case: &Case, at: usize) -> Val {
    case.after.as_ref().map(|after| after[at].clone()).unwrap_or_else(|| case.arg(at).clone())
}

#[test]
fn air_matches_js() {
    run(
        "air",
        &[
            ("airMissionOf", &|case| {
                let run = bare_run();
                let battle = air_battle(&run, case.arg(0));
                expect(case, text(air_mission_of(&battle, case.arg(1).num() as usize)))
            }),
            ("skyOfWings", &|case| {
                let value = case.arg(0);
                if matches!(value.get("airDay"), Val::Num(day) if *day == case.arg(2).num()) {
                    return None;
                }
                let figures = case.calls("0.militaryOf").cloned().unwrap_or_default();
                let mut run = create_run(Val::Obj(Obj::new()), Box::new(Figures(figures)));
                run.input = value.get("input").clone();
                run.mech = read_mechanics(value.get("mech"));
                run.era = value.get("era").num() as usize;
                set_wings(&run, value.get("wings"));
                let battles: Vec<Battle> = value.get("battles").array_or_empty().iter().map(|battle| air_battle(&run, battle)).collect();
                run.battles = battles;
                let name = case.arg(1).get("name").string_or_empty();
                let index = run.battles.iter().position(|battle| battle.name == name)?;
                let (wings, edge) = sky_of_wings(&run, index, case.arg(2).num());
                let got = edge.map(|edge| Val::obj([("punch", nums(&edge.punch)), ("guard", nums(&edge.guard)), ("legs", nums(&edge.legs))])).unwrap_or(Val::Null);
                let check = || -> Result<(), String> {
                    same(&battle_wings_val(&run, &wings), after_of(case, 1).get("wings")).map_err(|error| format!("battle wings: {error}"))?;
                    same(&wings_val(&run), after_of(case, 0).get("wings")).map_err(|error| format!("run wings: {error}"))
                };
                Some(expect(case, got)?.and_then(|_| check()))
            }),
            ("airStrikes", &|case| {
                let run = bare_run();
                let mut battle = air_battle(&run, case.arg(0));
                for side in 0..2 {
                    for (troop, value) in battle.troops[side].iter_mut().zip(case.arg(0).get("troops").at(side).array_or_empty()) {
                        troop.loss = value.get("loss").num();
                    }
                }
                let ids: Vec<Val> = case.arg(0).get("wings").get("flying").array_or_empty().iter().flat_map(|side| side.array_or_empty().to_vec()).collect();
                let mut book = OrdMap::new();
                for wing in &ids {
                    book.set(wing.get("id").string_or_empty(), wing_of(wing));
                }
                *run.wings.borrow_mut() = Some(book);
                air_strikes(&mut battle);
                let want = after_of(case, 0);
                let check = || -> Result<(), String> {
                    for side in 0..2 {
                        for (index, (troop, want)) in battle.troops[side].iter().zip(want.get("troops").at(side).array_or_empty()).enumerate() {
                            same(&num(troop.loss), want.get("loss")).map_err(|error| format!("troop {side}/{index}: {error}"))?;
                        }
                    }
                    Ok(())
                };
                Some(expect(case, Val::Undef)?.and_then(|_| check()))
            }),
            ("wearWings", &|case| {
                let run = bare_run();
                set_wings(&run, case.arg(0).get("wings"));
                let battle = air_battle(&run, case.arg(1));
                wear_wings(&run, &battle);
                Some(expect(case, Val::Undef)?.and_then(|_| same(&wings_val(&run), after_of(case, 0).get("wings"))))
            }),
            ("wingChanges", &|case| {
                let run = bare_run();
                set_wings(&run, case.arg(0).get("wings"));
                let got = list(
                    wing_changes(&run)
                        .iter()
                        .map(|change| match change.strength {
                            Some(strength) => Val::obj([("unitId", text(&change.unit_id)), ("committedTo", text("")), ("strength", num(strength))]),
                            None => Val::obj([("unitId", text(&change.unit_id)), ("committedTo", text("")), ("remove", Val::Bool(true))]),
                        })
                        .collect(),
                );
                expect(case, got)
            }),
            ("skyHeld", &|case| {
                let run = bare_run();
                let battle = air_battle(&run, case.arg(0));
                let got = match sky_held(&battle) {
                    Some(held) => {
                        let mut out = Obj::new();
                        out.set("holds", num(held.holds as f64));
                        out.set("wings", nums(&[held.wings[0] as f64, held.wings[1] as f64]));
                        out.set("superiority", num(held.superiority));
                        out.set("missions", list(vec![text(held.missions[0]), text(held.missions[1])]));
                        if held.strike {
                            out.set("strike", Val::Bool(true));
                        }
                        Val::Obj(out)
                    }
                    None => Val::Null,
                };
                expect(case, got)
            }),
        ],
    );
}
