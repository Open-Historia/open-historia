use crate::field::field_of;
use crate::frame::frame_of;
use crate::support::*;
use crate::troops::troop_of;
use ohfronts::sim::battle::{create_battle, Battle, Opening};
use ohfronts::sim::engine::{create_run, NoHooks, Run};
use ohfronts::sim::js::{Obj, OrdMap, Typed, Val};
use ohfronts::sim::mechanics::read_mechanics;
use ohfronts::sim::walls::*;
use std::rc::Rc;

fn pairs_of(value: &Val) -> Vec<[f64; 2]> {
    value.array_or_empty().iter().map(|pair| [pair.element(0).num(), pair.element(1).num()]).collect()
}

fn pairs_val(pairs: &[[f64; 2]]) -> Val {
    list(pairs.iter().map(|pair| nums(pair)).collect())
}

pub fn line_of(value: &Val) -> WallLine {
    let mut wear = OrdMap::new();
    if let Val::Map(entries) = value.get("wear") {
        for (piece, worn) in entries {
            wear.set(piece.num(), worn.num());
        }
    }
    WallLine {
        id: value.get("id").string_or_empty(),
        name: value.get("name").string_or_empty(),
        owner: value.get("owner").string_or_empty(),
        level: value.get("level").num(),
        points: pairs_of(value.get("points")),
        at: arg_numbers(value.get("at")),
        breaches: pairs_of(value.get("breaches")),
        wear,
        building: value.get("building").clone(),
        changed: value.get("changed").truthy(),
    }
}

pub fn line_val(line: &WallLine) -> Val {
    Val::obj([
        ("id", text(&line.id)),
        ("name", text(&line.name)),
        ("owner", text(&line.owner)),
        ("level", num(line.level)),
        ("points", pairs_val(&line.points)),
        ("at", nums(&line.at)),
        ("breaches", pairs_val(&line.breaches)),
        ("wear", Val::Map(line.wear.entries.iter().map(|(piece, worn)| (num(*piece), num(*worn))).collect())),
        ("building", line.building.clone()),
        ("changed", Val::Bool(line.changed)),
    ])
}

fn lines_val(run: &Run) -> Val {
    match &*run.lines.borrow() {
        Some(lines) => list(lines.iter().map(line_val).collect()),
        None => Val::Undef,
    }
}

fn set_lines(run: &Run, value: &Val) {
    if let Some(list) = value.as_array() {
        *run.lines.borrow_mut() = Some(list.iter().map(line_of).collect());
    }
}

fn wall_run(value: &Val) -> Run {
    let mut run = create_run(Val::Obj(Obj::new()), Box::new(NoHooks));
    run.input = value.get("input").clone();
    run.mech = read_mechanics(value.get("mech"));
    set_lines(&run, value.get("lines"));
    run
}

fn walls_val(walls: &Walls) -> Val {
    Val::obj([("cellLine", Val::Typed(Typed::I16(walls.cell_line.clone()))), ("cellKm", Val::Typed(Typed::F32(walls.cell_km.clone()))), ("sides", list(walls.sides.iter().map(|&side| num(side as f64)).collect()))])
}

fn mask_val(mask: &Option<Vec<u8>>) -> Val {
    mask.as_ref().map(|mask| u8s(mask.clone())).unwrap_or(Val::Null)
}

fn mask_of(value: &Val) -> Option<Vec<u8>> {
    if value.is_object() {
        Some(arg_numbers(value).iter().map(|&n| n as u8).collect())
    } else {
        None
    }
}

fn wall_battle(run: &Run, value: &Val) -> Battle {
    let sides = |at: usize| -> Vec<String> { value.get("sides").at(at).array_or_empty().iter().map(|m| m.string_or_empty()).collect() };
    let field = field_of(value.get("field"));
    let mut battle = create_battle(
        run,
        Opening { name: String::new(), war_id: Val::Undef, sides: [sides(0), sides(1)], frame: frame_of(value.get("frame")), arena: field.arena.clone(), opened_date: Val::Undef, opened_day: Val::Undef },
    );
    battle.field = Some(field);
    for side in 0..2 {
        battle.gone[side] = match value.get("gone").at(side) {
            Val::Set(items) => items.iter().map(|item| item.num() as usize).collect(),
            _ => Vec::new(),
        };
        battle.troops[side] = value
            .get("troops")
            .at(side)
            .array_or_empty()
            .iter()
            .map(|entry| {
                let mut troop = troop_of(entry);
                troop.walled = match entry.get("walled") {
                    Val::Num(level) => Some(*level),
                    _ => None,
                };
                troop
            })
            .collect();
        battle.wall_mask[side] = mask_of(value.get("wallMask").at(side));
    }
    if value.get("wallsFor").is_object() && same(value.get("wallsFor"), value.get("place")).is_ok() {
        battle.walls_for = true;
        battle.wall_sides = value.get("wallSides").string_or_empty();
    }
    let walls = value.get("walls");
    if walls.is_object() {
        battle.walls = Some(Rc::new(Walls {
            cell_line: arg_numbers(walls.get("cellLine")).iter().map(|&n| n as i16).collect(),
            cell_km: arg_numbers(walls.get("cellKm")).iter().map(|&n| n as f32).collect(),
            sides: arg_numbers(walls.get("sides")).iter().map(|&n| n as i32).collect(),
        }));
    }
    if !value.get("wallDate").is_undef() {
        battle.wall_date = Some(value.get("wallDate").string_or_empty());
    }
    if value.get("wallRun").is_object() {
        battle.wall_run = true;
        set_lines(run, value.get("wallRun").get("lines"));
    }
    battle.log = value.get("log").array_or_empty().to_vec();
    battle
}

fn battle_after(case: &Case, at: usize, battle: &Battle) -> Result<(), String> {
    let want = case.after.as_ref().map(|after| after[at].clone()).unwrap_or_else(|| case.arg(at).clone());
    let mut got = Obj::new();
    if !want.get("walls").is_undef() {
        let walls = battle.walls.as_ref().map(|walls| walls_val(walls)).unwrap_or(Val::Null);
        let walls = match (&walls, want.get("walls")) {
            (Val::Obj(all), Val::Obj(wanted)) => Val::Obj(Obj(all.0.iter().filter(|(key, _)| wanted.has(key)).cloned().collect())),
            _ => walls,
        };
        got.set("walls", walls);
    }
    if !want.get("wallMask").is_undef() {
        got.set("wallMask", list(vec![mask_val(&battle.wall_mask[0]), mask_val(&battle.wall_mask[1])]));
    }
    got.set("wallDate", battle.wall_date.as_ref().map(|date| text(date)).unwrap_or(Val::Undef));
    got.set("log", list(battle.log.clone()));
    if !want.get("wallSides").is_undef() {
        got.set("wallSides", text(&battle.wall_sides));
    }
    let got = Val::Obj(got);
    same_keys(&got, &want, &["walls", "wallMask", "wallDate", "log", "wallSides"]).map_err(|error| format!("battle after{error}"))?;
    for side in 0..2 {
        let wanted = want.get("troops").at(side).array_or_empty();
        for (index, (troop, want)) in battle.troops[side].iter().zip(wanted).enumerate() {
            let walled = troop.walled.map(num).unwrap_or(Val::Undef);
            same(&walled, want.get("walled")).map_err(|error| format!("troop {side}/{index} walled: {error}"))?;
        }
    }
    Ok(())
}

fn run_after(case: &Case, run: &Run, at: usize, key: Option<&str>) -> Result<(), String> {
    let want = case.after.as_ref().map(|after| after[at].clone()).unwrap_or_else(|| case.arg(at).clone());
    let want = match key {
        Some(key) => want.get(key).clone(),
        None => want,
    };
    same(&lines_val(run), want.get("lines")).map_err(|error| format!("lines after: {error}"))
}

fn piece_val(piece: Option<WallPiece>) -> Val {
    piece.map(|piece| Val::obj([("line", num(piece.line as f64)), ("piece", num(piece.piece))])).unwrap_or(Val::Null)
}

#[test]
fn walls_matches_js() {
    run(
        "walls",
        &[
            ("readLines", &|case| {
                let run = wall_run(case.arg(0));
                let got = list(read_lines(&run).iter().map(line_val).collect());
                Some(expect(case, got)?.and_then(|_| run_after(case, &run, 0, None)))
            }),
            ("standsOn", &|case| expect(case, Val::Bool(stands_on(&line_of(case.arg(0)), &case.arg(1).string_or_empty())))),
            ("brokenAt", &|case| expect(case, Val::Bool(broken_at(&line_of(case.arg(0)), case.arg(1).num())))),
            ("wallsOf", &|case| {
                let run = wall_run(case.arg(0));
                let mut battle = wall_battle(&run, case.arg(1));
                let got = walls_of(&run, &mut battle).map(|walls| walls_val(&walls)).unwrap_or(Val::Null);
                Some(expect(case, got)?.and_then(|_| battle_after(case, 1, &battle)).and_then(|_| run_after(case, &run, 0, None)))
            }),
            ("raiseWalls", &|case| {
                let run = wall_run(case.arg(0));
                let mut battle = wall_battle(&run, case.arg(1));
                raise_walls(&run, &mut battle, &case.arg(2).string_or_empty());
                Some(expect(case, Val::Undef)?.and_then(|_| battle_after(case, 1, &battle)).and_then(|_| run_after(case, &run, 0, None)))
            }),
            ("wallAhead", &|case| {
                let run = wall_run(&Val::Null);
                let battle = wall_battle(&run, case.arg(0));
                expect(case, piece_val(wall_ahead(&run, &battle, case.arg(1).num() as usize, case.arg(2).num(), case.arg(3).num())))
            }),
            ("wearWall", &|case| {
                let run = wall_run(&Val::Null);
                let mut battle = wall_battle(&run, case.arg(0));
                let piece = WallPiece { line: case.arg(1).get("line").num() as usize, piece: case.arg(1).get("piece").num() };
                let got = wear_wall(&run, &mut battle, piece, case.arg(2).num(), case.arg(3).truthy(), case.arg(4).num());
                Some(expect(case, Val::Bool(got))?.and_then(|_| battle_after(case, 0, &battle)).and_then(|_| run_after(case, &run, 0, Some("wallRun"))))
            }),
            ("keptWith", &|case| {
                let run = wall_run(&Val::Null);
                let mut battle = create_battle(&run, Opening { name: String::new(), war_id: Val::Undef, sides: [Vec::new(), Vec::new()], frame: frame_of(&Val::Null), arena: Rc::new(crate::arena::arena_of(&Val::Null)), opened_date: Val::Undef, opened_day: Val::Undef });
                for side in 0..2 {
                    battle.siege_kept[side] = mask_of(case.arg(0).get("siegeKept").at(side));
                    battle.wall_mask[side] = mask_of(case.arg(0).get("wallMask").at(side));
                }
                let got = kept_with(&battle);
                expect(case, list(vec![mask_val(&got[0]), mask_val(&got[1])]))
            }),
            ("linesChanged", &|case| {
                let run = wall_run(&Val::Null);
                set_lines(&run, case.arg(0).get("lines"));
                expect(case, list(lines_changed(&run).iter().map(|change| Val::obj([("id", text(&change.id)), ("breaches", pairs_val(&change.breaches)), ("wear", pairs_val(&change.wear))])).collect()))
            }),
        ],
    );
}
