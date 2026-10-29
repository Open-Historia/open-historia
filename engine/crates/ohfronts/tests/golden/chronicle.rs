use crate::arena::arena_of;
use crate::climate::effects_from;
use crate::frame::frame_of;
use crate::support::{self, *};
use crate::troops::troop_of;
use ohfronts::sim::battle::{create_battle, Battle, Opening};
use ohfronts::sim::chronicle::*;
use ohfronts::sim::engine::{create_run, NoHooks, Run};
use ohfronts::sim::fatigue::*;
use ohfronts::sim::js::{Obj, Val};
use std::rc::Rc;

fn bare_battle(run: &Run, arena: &Val) -> Battle {
    create_battle(run, Opening { name: String::new(), war_id: Val::Undef, sides: [Vec::new(), Vec::new()], frame: frame_of(&Val::Null), arena: Rc::new(arena_of(arena)), opened_date: Val::Undef, opened_day: Val::Undef })
}

fn told_val(told: &Told) -> Val {
    let mut out = Obj::new();
    out.set("d", text(&told.d));
    out.set("k", text(&told.k));
    if let Some(side) = told.s {
        out.set("s", num(side));
    }
    out.set("at", text(&told.at));
    if let Some(size) = told.size {
        out.set("size", num(size));
    }
    if told.capital {
        out.set("capital", Val::Bool(true));
    }
    Val::Obj(out)
}

fn chronicle_val(chronicle: &Chronicle) -> Val {
    Val::obj([
        ("moments", list(chronicle.moments.iter().map(told_val).collect())),
        ("strength", list(chronicle.strength.iter().map(|p| list(vec![text(&p.date), num(p.troops[0]), num(p.troops[1]), num(p.strength[0]), num(p.strength[1])])).collect())),
    ])
}

fn chronicle_of(value: &Val) -> Option<Chronicle> {
    if !value.is_object() {
        return None;
    }
    Some(Chronicle {
        moments: value
            .get("moments")
            .array_or_empty()
            .iter()
            .map(|m| Told { d: m.get("d").string_or_empty(), k: m.get("k").string_or_empty(), s: if m.get("s").is_undef() { None } else { Some(m.get("s").num()) }, at: m.get("at").string_or_empty(), size: if m.get("size").is_undef() { None } else { Some(m.get("size").num()) }, capital: m.get("capital").is_true() })
            .collect(),
        strength: value.get("strength").array_or_empty().iter().map(|p| StrengthPoint { date: p.at(0).string_or_empty(), troops: [p.at(1).num(), p.at(2).num()], strength: [p.at(3).num(), p.at(4).num()] }).collect(),
    })
}

#[test]
fn chronicle_matches_js() {
    let run = create_run(Val::Obj(Obj::new()), Box::new(NoHooks));
    let run = &run;
    support::run(
        "chronicle",
        &[
            ("readChronicle", &|case| expect(case, read_chronicle(case.arg(0)).map(|c| chronicle_val(&c)).unwrap_or(Val::Null))),
            ("chronicleAfter", &|case| {
                let value = case.arg(0);
                let mut battle = bare_battle(run, value.get("arena"));
                battle.chronicle = chronicle_of(value.get("chronicle"));
                battle.log = value.get("log").array_or_empty().to_vec();
                battle.log_from = if value.get("logFrom").is_nullish() { 0.0 } else { value.get("logFrom").num() };
                for side in 0..2 {
                    battle.troops[side] = value.get("troops").at(side).array_or_empty().iter().map(troop_of).collect();
                }
                expect(case, chronicle_val(&chronicle_after(&battle, case.arg(1))))
            }),
        ],
    );
}

#[test]
fn fatigue_matches_js() {
    let run = create_run(Val::Obj(Obj::new()), Box::new(NoHooks));
    let run = &run;
    support::run(
        "fatigue",
        &[
            ("punchLeft", &|case| expect(case, num(punch_left(case.arg(0).num())))),
            ("guardLeft", &|case| expect(case, num(guard_left(case.arg(0).num())))),
            ("legsLeft", &|case| expect(case, num(legs_left(case.arg(0).num())))),
            ("tireDay", &|case| {
                let mut run_here = create_run(Val::Obj(Obj::new()), Box::new(NoHooks));
                let speeds = arg_numbers(case.arg(0).get("advanceKm"));
                for at in 0..3 {
                    run_here.advance_km[at] = speeds.get(at).copied().unwrap_or(f64::NAN);
                }
                run_here.pace = case.arg(0).get("pace").num();
                let mut battle = bare_battle(run, &Val::Null);
                for side in 0..2 {
                    battle.troops[side] = case
                        .arg(1)
                        .get("troops")
                        .at(side)
                        .array_or_empty()
                        .iter()
                        .map(|entry| {
                            let mut troop = troop_of(entry);
                            troop.moved_km = entry.get("movedKm").num();
                            troop.fought = entry.get("fought").truthy();
                            troop.engaged = entry.get("engaged").truthy();
                            troop.climate = if entry.get("climate").truthy() { Some(effects_from(entry.get("climate"))) } else { None };
                            troop
                        })
                        .collect();
                }
                let options = case.arg(2);
                let wear = if options.get("wear").is_undef() { 0.0 } else { options.get("wear").num() };
                let rest = if options.get("rest").is_undef() { 1.0 } else { options.get("rest").num() };
                tire_day(&run_here, &mut battle, wear, rest);
                let want = case.after.as_ref().map(|after| after[1].clone()).unwrap_or_else(|| case.arg(1).clone());
                let check = || -> Result<(), String> {
                    for side in 0..2 {
                        for (index, (troop, want)) in battle.troops[side].iter().zip(want.get("troops").at(side).array_or_empty()).enumerate() {
                            same(&num(troop.fatigue), want.get("fatigue")).map_err(|error| format!("troop {side}/{index}: {error}"))?;
                        }
                    }
                    Ok(())
                };
                Some(expect(case, Val::Undef)?.and_then(|_| check()))
            }),
        ],
    );
}
