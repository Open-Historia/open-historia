use crate::field::sector_of;
use crate::fronts::*;
use crate::orders::{order_battle, wanted};
use crate::support::{self, *};
use ohfronts::sim::battle::Battle;
use ohfronts::sim::engine::{create_run, NoHooks, Run};
use ohfronts::sim::js::{Obj, Val};
use ohfronts::sim::movement::*;
use ohfronts::sim::orders::{HaltToday, OrderView};
use ohfronts::sim::sectors::Place;

fn place_of(value: &Val) -> Option<Place> {
    if !value.is_object() {
        return None;
    }
    let kind = if value.get("kind").as_str() == Some("city") { "city" } else { "region" };
    let opt = |key: &str| if value.get(key).is_undef() { None } else { Some(value.get(key).num()) };
    Some(Place { kind, name: value.get("name").string_or_empty(), x: value.get("x").num(), y: value.get("y").num(), cell: opt("cell"), region: opt("region").map(|n| n as usize) })
}

fn move_run(value: &Val) -> Run {
    let value = value.plain();
    let input = value.get("input");
    let mut given = Obj::new();
    for key in ["fromDate", "toDate", "days"] {
        given.set(key, input.get(key).clone());
    }
    let mut run = create_run(Val::Obj(given), Box::new(NoHooks));
    let speeds = arg_numbers(value.get("advanceKm"));
    for at in 0..3 {
        run.advance_km[at] = speeds.get(at).copied().unwrap_or(f64::NAN);
    }
    run.pace = value.get("pace").num();
    run.braked = value.get("braked").truthy();
    run.steer = value.get("steer").clone();
    run
}

fn extra_fields(battle: &mut Battle, value: &Val) {
    for side in 0..2 {
        for (index, troop) in battle.troops[side].iter_mut().enumerate() {
            let given = value.get("troops").at(side).at(index);
            let given = match given {
                Val::Ref(cell) => Val::Obj(cell.borrow().clone()),
                other => other.clone(),
            };
            let set = |key: &str, slot: &mut f64| {
                if !given.get(key).is_undef() {
                    *slot = given.get(key).num();
                }
            };
            set("spent", &mut troop.spent);
            set("pinned", &mut troop.pinned);
            set("adrift", &mut troop.adrift);
            set("stranded", &mut troop.stranded);
            set("gave", &mut troop.gave);
            if !given.get("slid").is_undef() {
                troop.slid = given.get("slid").truthy();
            }
        }
    }
}

fn move_battle(run: &Run, value: &Val) -> Battle {
    let mut battle = order_battle(run, value);
    extra_fields(&mut battle, value);
    for side in 0..2 {
        battle.views[side] = value
            .get("views")
            .at(side)
            .array_or_empty()
            .iter()
            .map(|view| {
                let view = match view {
                    Val::Ref(cell) => Val::Obj(cell.borrow().clone()),
                    other => other.clone(),
                };
                let order = view.get("order");
                let order = battle.orders.iter().find(|standing| standing.same_ref(order)).cloned().unwrap_or_else(|| order.clone());
                let middle = view.get("middle").plain();
                OrderView {
                    order,
                    word: view.get("word").clone(),
                    sector: sector_of(&view.get("sector").plain()),
                    target: place_of(&view.get("target").plain()),
                    age: view.get("age").clone(),
                    middle: if middle.is_object() { Some([middle.element(0).num(), middle.element(1).num()]) } else { None },
                }
            })
            .collect();
    }
    battle.halts_today = value.get("haltsToday").array_or_empty().iter().map(|halt| {
        let halt = halt.plain();
        HaltToday { s: halt.get("s").clone(), sector: sector_of(halt.get("sector")) }
    }).collect();
    battle
}

fn extra_like(battle: &Battle, want: &Val) -> Result<(), String> {
    for side in 0..2 {
        for (index, troop) in battle.troops[side].iter().enumerate() {
            let given = want.get("troops").at(side).at(index);
            let got = Val::obj([
                ("spent", num(troop.spent)),
                ("pinned", num(troop.pinned)),
                ("adrift", num(troop.adrift)),
                ("stranded", num(troop.stranded)),
                ("gave", num(troop.gave)),
                ("slid", Val::Bool(troop.slid)),
            ]);
            for key in ["spent", "pinned", "adrift", "stranded", "gave", "slid"] {
                if !given.get(key).is_undef() {
                    same(got.get(key), given.get(key)).map_err(|error| format!("troop {side}/{index}.{key}: {error}"))?;
                }
            }
        }
    }
    Ok(())
}

#[test]
fn movement_matches_js() {
    support::run(
        "move",
        &[
            ("placeBehind", &|case| {
                let run = bare_run();
                let mut battle = pick_battle(&run, case.arg(0));
                let troop = troop_full(case.arg(2));
                let found = place_behind(&mut battle, case.arg(1).num() as usize, &troop, case.arg(3).num());
                expect(case, found.map(point_val).unwrap_or(Val::Null))
            }),
            ("moveDay", &|case| {
                let run = move_run(case.arg(1));
                let mut battle = move_battle(&run, case.arg(0));
                move_day(&mut battle, &run, case.arg(2).num());
                let want = wanted(case, 0);
                let checks = [troops_like(&battle, &want), extra_like(&battle, &want), same(&list(battle.log.clone()), want.get("log")).map_err(|error| format!("log: {error}"))];
                for check in checks {
                    if check.is_err() {
                        return Some(check);
                    }
                }
                Some(Ok(()))
            }),
        ],
    );
}
