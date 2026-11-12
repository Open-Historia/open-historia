use crate::air::{air_battle, battle_wings_of, battle_wings_val, set_wings, wings_val, Figures};
use crate::arena::arena_of;
use crate::climate::{climate_after, climate_run_hooked, set_climate, sky_from};
use crate::frame::frame_of;
use crate::fronts::*;
use crate::manpower::tally_of;
use crate::support::{self, *};
use crate::walls::{mask_val, set_lines, set_walls};
use ohfronts::sim::battle::{create_battle, Battle, Opening, Tally};
use ohfronts::sim::dawn::*;
use ohfronts::sim::engine::{Effort, Run};
use ohfronts::sim::field::create_field;
use ohfronts::sim::js::{Obj, OrdMap, Val};
use ohfronts::sim::mechanics::read_mechanics;
use std::sync::Arc as Rc;

fn masks_of(value: &Val) -> [Option<Vec<u8>>; 2] {
    [0, 1].map(|side| if value.at(side).is_object() { Some(bytes(value.at(side))) } else { None })
}

fn dawn_battle(run: &Run, value: &Val) -> Battle {
    let sides = |at: usize| -> Vec<String> { value.get("sides").at(at).array_or_empty().iter().map(|m| m.string_or_empty()).collect() };
    let field = value.get("field");
    let (cols, rows) = (field.get("cols").num(), field.get("rows").num());
    let arena = Rc::new(arena_of(&Val::obj([("frame", value.get("frame").clone()), ("cols", num(cols)), ("rows", num(rows)), ("size", num(cols * rows))])));
    let mut battle = create_battle(run, Opening { name: value.get("name").string_or_empty(), war_id: Val::Undef, sides: [sides(0), sides(1)], frame: frame_of(value.get("frame")), arena: arena.clone(), opened_date: Val::Undef, opened_day: Val::Undef });
    let mut made = create_field(arena);
    if field.get("play").is_object() {
        made.play = bytes(field.get("play"));
    }
    battle.field = Some(made);
    battle.status = value.get("status").string_or_empty();
    for side in 0..2 {
        if let Val::Set(items) = value.get("gone").at(side) {
            battle.gone[side] = items.iter().map(|item| item.num() as usize).collect();
        }
        battle.troops[side] = value.get("troops").at(side).array_or_empty().iter().map(troop_full).collect();
        if let Val::Str(mission) = value.get("airMission").at(side) {
            battle.air_mission[side] = mission.clone();
        }
    }
    battle.wings = battle_wings_of(value.get("wings"));
    set_climate(run, &mut battle, value);
    set_walls(run, &mut battle, value);
    if value.get("worth").is_object() {
        battle.worth = Some([0, 1].map(|side| arg_numbers(value.get("worth").at(side))));
    }
    if value.get("short").is_object() {
        battle.short = Some([value.get("short").at(0).num(), value.get("short").at(1).num()]);
    }
    if value.get("kept").is_object() {
        battle.kept = masks_of(value.get("kept"));
    }
    if value.get("siegeKept").is_object() {
        battle.siege_kept = masks_of(value.get("siegeKept"));
    }
    battle.out_by = tally_of(value.get("outBy"));
    battle.harsh_by = tally_of(value.get("harshBy"));
    battle.lost_by = tally_of(value.get("lostBy"));
    battle
}

fn tally_val(tally: &Option<[Tally; 2]>) -> Val {
    match tally {
        Some(both) => list(both.iter().map(|side| Val::Map(side.by_owner.entries.iter().map(|(owner, count)| (num(*owner as f64), num(*count))).collect())).collect()),
        None => Val::Undef,
    }
}

fn dawn_got(run: &Run, battle: &Battle, air: bool) -> Val {
    let mut out = Obj::new();
    out.set(
        "works",
        match battle.works {
            Some(works) => Val::obj([("defence", num(works.defence)), ("loss", num(works.loss)), ("perDay", num(works.per_day)), ("most", num(works.most)), ("assault", num(works.assault))]),
            None => Val::Null,
        },
    );
    out.set("corridors", Val::Bool(battle.corridors));
    out.set("exposure", match battle.exposure { Some(both) => list(both.iter().map(|&short| Val::obj([("short", num(short))])).collect()), None => Val::Null });
    out.set("outBy", tally_val(&battle.out_by));
    out.set("harshBy", tally_val(&battle.harsh_by));
    out.set("lostBy", tally_val(&battle.lost_by));
    out.set("kept", list(battle.kept.iter().map(mask_val).collect()));
    out.set("wallMask", list(battle.wall_mask.iter().map(mask_val).collect()));
    out.set("wallDate", battle.wall_date.as_ref().map(|date| text(date)).unwrap_or(Val::Undef));
    out.set("log", list(battle.log.clone()));
    if air {
        out.set("wings", battle_wings_val(run, &battle.wings));
    }
    Val::Obj(out)
}

fn effort_val(run: &Run) -> Val {
    Val::Map(
        run.effort
            .entries
            .iter()
            .map(|(key, entry)| (text(key), Val::obj([("name", text(&entry.name)), ("advanced", num(entry.advanced)), ("troopDays", num(entry.troop_days)), ("warDays", num(entry.war_days)), ("lastDay", num(entry.last_day))])))
            .collect(),
    )
}

#[test]
fn dawn_matches_js() {
    support::run(
        "dawn",
        &[
            ("dawnsOn", &|case| {
                let mut run = bare_run();
                run.mech = read_mechanics(case.arg(0).get("mech"));
                run.steer = case.arg(0).get("steer").clone();
                expect(case, Val::Bool(dawns_on(&run)))
            }),
            ("dawn", &|case| {
                let value = case.arg(0);
                let day = case.arg(2).num();
                let mech = read_mechanics(value.get("mech"));
                if mech.air() && matches!(value.get("airDay"), Val::Num(at) if *at == day) {
                    return None;
                }
                let figures = case.calls("0.militaryOf").cloned().unwrap_or_default();
                let mut run = climate_run_hooked(value, Box::new(Figures(figures)));
                run.mech = mech;
                run.era = value.get("era").num() as usize;
                set_lines(&run, value.get("lines"));
                set_wings(&run, value.get("wings"));
                let mut battles: Vec<Battle> = value.get("battles").array_or_empty().iter().map(|battle| air_battle(&run, battle)).collect();
                let name = case.arg(1).get("name").string_or_empty();
                let index = battles.iter().position(|battle| battle.name == name)?;
                battles[index] = dawn_battle(&run, case.arg(1));
                run.battles = battles;
                dawn(&mut run, index, day);
                let want = want_after(case, 1);
                let battle = &run.battles[index];
                let check = || -> Result<(), String> {
                    same_parts(&dawn_got(&run, battle, mech.air()), &want, "battle")?;
                    climate_after(&want, battle)?;
                    if mech.air() {
                        same(&wings_val(&run), want_after(case, 0).get("wings")).map_err(|error| format!("run wings: {error}"))?;
                    }
                    troops_like(battle, &want)
                };
                Some(expect(case, Val::Undef)?.and_then(|_| check()))
            }),
            ("dusk", &|case| {
                let value = case.arg(0);
                let mut run = bare_run();
                run.mech = read_mechanics(value.get("mech"));
                let speeds = arg_numbers(value.get("advanceKm"));
                for at in 0..3 {
                    run.advance_km[at] = speeds.get(at).copied().unwrap_or(f64::NAN);
                }
                run.pace = value.get("pace").num();
                if let Val::Map(entries) = value.get("effort") {
                    let mut book = OrdMap::new();
                    for (key, entry) in entries {
                        book.set(key.string(), Effort { name: entry.get("name").string_or_empty(), advanced: entry.get("advanced").num(), troop_days: entry.get("troopDays").num(), war_days: entry.get("warDays").num(), last_day: entry.get("lastDay").num() });
                    }
                    run.effort = book;
                }
                set_wings(&run, value.get("wings"));
                {
                    let mut mend = run.mend.borrow_mut();
                    mend.day = if value.get("mendDay").is_undef() { None } else { Some(value.get("mendDay").num()) };
                    if let Val::Map(entries) = value.get("mendLeft") {
                        for (key, left) in entries {
                            mend.left.set(key.string(), left.num());
                        }
                    }
                }
                let picked = case.arg(1);
                let mut battle = pick_battle(&run, picked);
                battle.sky = sky_from(picked.get("sky"));
                battle.wings = battle_wings_of(picked.get("wings"));
                let worn_apart = picked.get("wings").is_object() && same(want_after(case, 0).get("wings"), value.get("wings")).is_ok() && same(want_after(case, 1).get("wings"), picked.get("wings")).is_err();
                if let Some(wings) = battle.wings.as_mut() {
                    wings.detached = worn_apart;
                }
                run.battles = vec![battle];
                dusk(&mut run, 0, case.arg(2).num());
                let battle = &run.battles[0];
                let want = want_after(case, 1);
                let run_want = want_after(case, 0);
                let check = || -> Result<(), String> {
                    troops_like(battle, &want)?;
                    same(&if battle.mend_of { Val::Fn } else if want.get("mendOf").is_undef() { Val::Undef } else { Val::Null }, want.get("mendOf")).map_err(|error| format!("mendOf: {error}"))?;
                    let mend = run.mend.borrow();
                    let got = Val::obj([
                        ("effort", effort_val(&run)),
                        ("wings", wings_val(&run)),
                        ("mendDay", mend.day.map(num).unwrap_or(Val::Undef)),
                        ("mendLeft", if mend.day.is_none() && mend.left.is_empty() { Val::Undef } else { Val::Map(mend.left.entries.iter().map(|(key, left)| (text(key), num(*left))).collect()) }),
                    ]);
                    same_parts(&got, &run_want, "run")
                };
                Some(expect(case, Val::Undef)?.and_then(|_| check()))
            }),
        ],
    );
}
