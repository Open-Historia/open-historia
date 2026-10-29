use crate::field::{contour_of, field_of, measured_of};
use crate::frame::frame_of;
use crate::support::*;
use ohfronts::sim::battle::{create_battle, Battle, Named, Opening};
use ohfronts::sim::engine::{create_run, NoHooks, Run};
use ohfronts::sim::js::{self, Obj, Val};
use ohfronts::sim::line::Line;
use ohfronts::sim::military::Mix;
use ohfronts::sim::troops::*;
use std::rc::Rc;

pub fn station_val(station: &Option<Station>) -> Val {
    match station {
        Some(s) => Val::obj([("nx", num(s.nx)), ("ny", num(s.ny)), ("place", num(s.place)), ("idealX", num(s.ideal_x)), ("idealY", num(s.ideal_y)), ("idealNx", num(s.ideal_nx)), ("idealNy", num(s.ideal_ny))]),
        None => Val::Null,
    }
}

pub fn station_of(value: &Val) -> Option<Station> {
    if !value.is_object() {
        return None;
    }
    let n = |key: &str| value.get(key).num();
    Some(Station { nx: n("nx"), ny: n("ny"), place: n("place"), ideal_x: n("idealX"), ideal_y: n("idealY"), ideal_nx: n("idealNx"), ideal_ny: n("idealNy") })
}

pub fn troop_val(t: &Troop) -> Val {
    let mut out = Obj::new();
    let b = Val::Bool;
    let fields: Vec<(&str, Val)> = vec![
        ("x", num(t.x)),
        ("y", num(t.y)),
        ("strength", num(t.strength)),
        ("kind", num(t.kind)),
        ("owner", num(t.owner)),
        ("named", b(t.named)),
        ("dig", num(t.dig)),
        ("state", num(t.state)),
        ("radiusKm", num(t.radius_km)),
        ("drive", num(t.drive)),
        ("depth", num(t.depth)),
        ("lane", num(t.lane)),
        ("lag", num(t.lag)),
        ("drawn", b(t.drawn)),
        ("hx", num(t.hx)),
        ("hy", num(t.hy)),
        ("axisX", num(t.axis_x)),
        ("axisY", num(t.axis_y)),
        ("station", station_val(&t.station)),
        ("stepping", b(t.stepping)),
        ("walkedToday", b(t.walked_today)),
        ("flank", num(t.flank)),
        ("flankMoment", num(t.flank_moment)),
        ("faceX", num(t.face_x)),
        ("faceY", num(t.face_y)),
        ("movedKm", num(t.moved_km)),
        ("loss", num(t.loss)),
        ("engaged", b(t.engaged)),
        ("dug", b(t.dug)),
        ("order", t.order.clone()),
        ("serves", num(t.serves)),
        ("next", num(t.next)),
        ("command", num(t.command)),
        ("gx", num(t.gx)),
        ("gy", num(t.gy)),
        ("paceFactor", num(t.pace_factor)),
        ("reducing", b(t.reducing)),
        ("plant", b(t.plant)),
        ("fallback", t.fallback.clone()),
        ("stranded", num(t.stranded)),
        ("adrift", num(t.adrift)),
        ("gave", num(t.gave)),
        ("slid", b(t.slid)),
        ("pinned", num(t.pinned)),
        ("rested", num(t.rested)),
        ("spent", num(t.spent)),
        ("body", num(t.body)),
        ("pocket", b(t.pocket)),
        ("sealed", b(t.sealed)),
        ("squeezed", b(t.squeezed)),
        ("besieged", b(t.besieged)),
        ("supply", num(t.supply)),
        ("fatigue", num(t.fatigue)),
        ("punch", num(t.punch)),
        ("guard", num(t.guard)),
        ("legs", num(t.legs)),
        ("fought", b(t.fought)),
    ];
    for (key, value) in fields {
        out.set(key, value);
    }
    Val::Obj(out)
}

pub fn troop_of(value: &Val) -> Troop {
    let n = |key: &str, or: f64| if value.get(key).is_undef() { or } else { value.get(key).num() };
    let mut t = create_troop(TroopSeed {
        x: n("x", 0.0),
        y: n("y", 0.0),
        strength: n("strength", 100.0),
        kind: n("kind", KIND_INFANTRY),
        owner: n("owner", 0.0),
        named: value.get("named").truthy(),
        dig: n("dig", 0.0),
        state: n("state", STATE_HOLDING),
    });
    let set = |field: &mut f64, key: &str| {
        if !value.get(key).is_undef() {
            *field = value.get(key).num();
        }
    };
    set(&mut t.radius_km, "radiusKm");
    set(&mut t.drive, "drive");
    set(&mut t.depth, "depth");
    set(&mut t.lane, "lane");
    set(&mut t.lag, "lag");
    set(&mut t.hx, "hx");
    set(&mut t.hy, "hy");
    set(&mut t.body, "body");
    set(&mut t.supply, "supply");
    set(&mut t.fatigue, "fatigue");
    if !value.get("drawn").is_undef() {
        t.drawn = value.get("drawn").truthy();
    }
    if !value.get("dug").is_undef() {
        t.dug = value.get("dug").truthy();
    }
    if !value.get("pocket").is_undef() {
        t.pocket = value.get("pocket").truthy();
    }
    t.station = station_of(value.get("station"));
    t
}

pub fn named_of(value: &Val) -> Vec<Named> {
    value.array_or_empty().iter().map(|entry| Named { s: entry.get("s").num() as usize, i: entry.get("i").num() as usize, name: entry.get("name").string_or_empty(), unit_id: entry.get("unitId").clone() }).collect()
}

pub fn named_val(named: &[Named]) -> Val {
    list(named.iter().map(|entry| Val::obj([("s", num(entry.s as f64)), ("i", num(entry.i as f64)), ("name", text(&entry.name)), ("unitId", entry.unit_id.clone())])).collect())
}

fn sides_of(value: &Val) -> [Vec<Troop>; 2] {
    [value.at(0).array_or_empty().iter().map(troop_of).collect(), value.at(1).array_or_empty().iter().map(troop_of).collect()]
}

fn lane_battle(run: &Run, value: &Val) -> Battle {
    let field = field_of(value.get("field"));
    let mut battle = create_battle(
        run,
        Opening { name: String::new(), war_id: Val::Undef, sides: [Vec::new(), Vec::new()], frame: frame_of(value.get("frame")), arena: field.arena.clone(), opened_date: Val::Undef, opened_day: Val::Undef },
    );
    battle.field = Some(field);
    battle.troops = sides_of(value.get("troops"));
    battle
}

fn troops_after(case: &Case, battle: &Battle, keys: &[&str]) -> Result<(), String> {
    let want = case.after.as_ref().map(|after| after[0].clone()).unwrap_or_else(|| case.arg(0).clone());
    for side in 0..2 {
        let wanted = want.get("troops").at(side).array_or_empty();
        if wanted.len() != battle.troops[side].len() {
            return Err(format!("side {side}: {} troops want {}", battle.troops[side].len(), wanted.len()));
        }
        for (index, (troop, want)) in battle.troops[side].iter().zip(wanted).enumerate() {
            same_keys(&troop_val(troop), want, keys).map_err(|error| format!("troop {side}/{index}{error}"))?;
        }
    }
    Ok(())
}

fn join_text(value: &Val) -> String {
    if value.is_nullish() {
        String::new()
    } else {
        js::to_string(value)
    }
}

fn factor_arg(value: &Val) -> f64 {
    if value.is_undef() {
        1.0
    } else {
        value.num()
    }
}

fn mix_arg(value: &Val) -> Option<Mix> {
    if !value.truthy() {
        return None;
    }
    let finite = |key: &str| match value.get(key) {
        Val::Num(n) => Some(*n),
        _ => None,
    };
    Some(Mix { armour: finite("armour"), artillery: finite("artillery") })
}

#[test]
fn troops_matches_js() {
    let run = create_run(Val::Obj(Obj::new()), Box::new(NoHooks));
    run_cases(&run);
}

fn run_cases(lane_run: &Run) {
    run(
        "troops",
        &[
            ("createTroop", &|case| expect(case, troop_val(&troop_of(case.arg(0))))),
            ("isAttack", &|case| expect(case, Val::Bool(is_attack(&case.arg(0).string_or_empty()) && case.arg(0).as_str().is_some()))),
            ("sideRadiusKm", &|case| expect(case, num(side_radius_km(case.arg(0).num(), case.arg(1).num())))),
            ("controlRadius", &|case| {
                let script = Script::new(case, "1");
                let got = control_radius(&troop_of(case.arg(0)), |y| script.call(&[num(y)]).num());
                Some(expect(case, num(got))?.and_then(|_| script.done()))
            }),
            ("reachCells", &|case| {
                let script = Script::new(case, "0");
                let got = reach_cells(|y| script.call(&[num(y)]).num(), case.arg(1).num());
                Some(expect(case, num(got))?.and_then(|_| script.done()))
            }),
            ("standOff", &|case| {
                let script = Script::new(case, "1");
                let got = stand_off(&troop_of(case.arg(0)), |y| script.call(&[num(y)]).num());
                Some(expect(case, num(got))?.and_then(|_| script.done()))
            }),
            ("stands", &|case| expect(case, Val::Bool(stands(&field_of(case.arg(0)), case.arg(1).num() as u8, case.arg(2).num(), case.arg(3).num())))),
            ("drawTraits", &|case| {
                if !arg_is_number(case.arg(3)) || !arg_is_number(case.arg(4)) {
                    return None;
                }
                let mut troop = troop_of(case.arg(0));
                draw_traits(&mut troop, &join_text(case.arg(1)), &join_text(case.arg(2)), case.arg(3).num(), case.arg(4).num(), case.arg(5).truthy());
                let want = case.after.as_ref().map(|after| after[0].clone()).unwrap_or_else(|| case.arg(0).clone());
                Some(expect(case, Val::Undef)?.and_then(|_| same_keys(&troop_val(&troop), &want, &["drive", "depth", "lane", "lag", "drawn"])))
            }),
            ("troopsCap", &|case| expect(case, num(troops_cap(case.arg(0).num(), factor_arg(case.arg(1)))))),
            ("troopsLeast", &|case| expect(case, num(troops_least(factor_arg(case.arg(0)))))),
            ("troopsFactor", &|case| expect(case, num(troops_factor(case.arg(0).num())))),
            ("troopsWanted", &|case| expect(case, num(troops_wanted(case.arg(0).num(), &js::to_string(case.arg(1)), factor_arg(case.arg(2)))))),
            ("sizeSides", &|case| {
                let strengths = [case.arg(1).at(0).num(), case.arg(1).at(1).num()];
                let efforts_val = if case.arg(2).is_undef() { list(vec![text("major"), text("major")]) } else { case.arg(2).clone() };
                let efforts = [js::to_string(efforts_val.at(0)), js::to_string(efforts_val.at(1))];
                let got = size_sides(case.arg(0).num(), strengths, [&efforts[0], &efforts[1]], factor_arg(case.arg(3)));
                expect(case, Val::obj([("counts", nums(&got.counts)), ("quality", nums(&got.quality))]))
            }),
            ("kindsFor", &|case| expect(case, nums(&kinds_for(case.arg(0).num() as usize, case.arg(1).num() as usize, mix_arg(case.arg(2)))))),
            ("shareOut", &|case| expect(case, nums(&share_out(case.arg(0).num(), &arg_numbers(case.arg(1)))))),
            ("planLanes", &|case| {
                let mut battle = lane_battle(lane_run, case.arg(0));
                let value = case.arg(2);
                let line = Line { contour: Rc::new(contour_of(value.get("contour"))), measured: Rc::new(measured_of(value)) };
                plan_lanes(&mut battle, case.arg(1).num() as usize, &line);
                Some(expect(case, Val::Undef)?.and_then(|_| troops_after(case, &battle, &["station", "body"])))
            }),
            ("standAtPlaces", &|case| {
                let mut battle = lane_battle(lane_run, case.arg(0));
                stand_at_places(&mut battle, case.arg(1).num() as usize);
                Some(expect(case, Val::Undef)?.and_then(|_| troops_after(case, &battle, &["x", "y"])))
            }),
            ("stepAlong", &|case| {
                let script = Script::new(case, "5");
                let mut out = [case.arg(6).element(0).num(), case.arg(6).element(1).num()];
                let got = step_along(case.arg(0).num(), case.arg(1).num(), case.arg(2).num(), case.arg(3).num(), case.arg(4).num(), |x, y| script.call(&[num(x), num(y)]).truthy(), &mut out);
                let out_val = match case.arg(6) {
                    Val::Typed(_) => f64s(out.to_vec()),
                    _ => nums(&out),
                };
                Some(expect(case, Val::Bool(got))?.and_then(|_| script.done()).and_then(|_| expect_after(case, 6, &out_val)))
            }),
            ("dropTheDead", &|case| {
                let (troops, named) = drop_the_dead(sides_of(case.arg(0)), &named_of(case.arg(1)));
                let want = case.result.as_ref()?;
                let check = || -> Result<(), String> {
                    same(&named_val(&named), want.get("named")).map_err(|error| format!("named: {error}"))?;
                    for side in 0..2 {
                        let wanted = want.get("troops").at(side).array_or_empty();
                        if wanted.len() != troops[side].len() {
                            return Err(format!("side {side}: {} want {}", troops[side].len(), wanted.len()));
                        }
                        for (troop, want) in troops[side].iter().zip(wanted) {
                            same_keys(&troop_val(troop), want, &["x", "y", "strength", "owner", "kind", "named"])?;
                        }
                    }
                    Ok(())
                };
                Some(check())
            }),
        ],
    );
}
