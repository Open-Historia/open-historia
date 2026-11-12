use crate::battle_life::{battle_from, run_at};
use crate::field::sector_val;
use crate::fronts::*;
use crate::orders::{battle_like, order_battle, shallow, view_val, wanted};
use crate::support::{self, *};
use ohfronts::sim::battle::Battle;
use ohfronts::sim::day::*;
use ohfronts::sim::js::{Obj, Typed, Val};
use ohfronts::sim::sectors::Sectors;

fn sectors_val(sectors: &Sectors) -> Val {
    Val::obj([
        ("axis", text(&sectors.axis)),
        ("names", list(sectors.names.iter().map(|name| text(name)).collect())),
        ("cuts", Val::Map(sectors.cuts.iter().map(|(key, cut)| (text(key), Val::obj([("x", num(cut.x)), ("y", num(cut.y)), ("from", num(cut.from)), ("to", num(cut.to))]))).collect())),
    ])
}

fn opt_i8s(values: &Option<Vec<i8>>) -> Val {
    values.as_ref().map(|values| Val::Typed(Typed::I8(values.clone()))).unwrap_or(Val::Null)
}

fn day_battle(run: &ohfronts::sim::engine::Run, value: &Val) -> Battle {
    let plain = shallow(value).plain();
    let mut battle = battle_from(run, &plain);
    day_extras(&mut battle, &plain);
    battle
}

fn day_extras(battle: &mut Battle, plain: &Val) {
    let i8s_of = |key: &str| if plain.get(key).is_object() { Some(arg_numbers(plain.get(key)).iter().map(|&n| n as i8).collect::<Vec<i8>>()) } else { None };
    battle.home_side = i8s_of("homeSide");
    battle.ice_side = i8s_of("iceSide");
    battle.city_holder = i8s_of("cityHolder");
    battle.homes = if plain.get("homes").is_object() { Some(bytes(plain.get("homes"))) } else { None };
    battle.drawn_homes = if plain.get("drawnHomes").is_object() { Some(bytes(plain.get("drawnHomes"))) } else { None };
    battle.said = plain.get("said").array_or_empty().to_vec();
    if let Val::Num(turns) = plain.get("settledTurns") {
        battle.settled_turns = *turns;
    }
    if plain.get("lastFlip").is_object() {
        battle.last_flip = arg_numbers(plain.get("lastFlip")).iter().map(|&n| n as i32).collect();
    }
    for side in 0..2 {
        battle.cities_taken[side] = plain.get("citiesTaken").at(side).array_or_empty().to_vec();
        battle.taken[side] = plain.get("taken").at(side).array_or_empty().to_vec();
    }
    if let Val::Num(recorded) = plain.get("recorded") {
        battle.recorded = *recorded;
    }
    if let Val::Num(grown) = plain.get("grown") {
        battle.grown = *grown;
    }
    if plain.get("startPhi").is_object() {
        battle.start_phi = Some(arg_numbers(plain.get("startPhi")));
    }
    if plain.get("startHolders").is_object() {
        battle.start_holders = Some(bytes(plain.get("startHolders")));
    }
    if let Some(field) = battle.field.as_mut() {
        if plain.get("field").get("painter").is_object() {
            field.painter = bytes(plain.get("field").get("painter"));
        }
        field.arena = battle.arena.clone();
    }
}

fn day_val(battle: &Battle) -> Val {
    let field = battle.field.as_ref();
    Val::obj([
        ("shown", Val::Map(battle.shown.entries.iter().map(|(key, item)| (text(key), item.clone())).collect())),
        ("regionSide", opt_i8s(&battle.region_side)),
        ("homeSide", opt_i8s(&battle.home_side)),
        ("homes", battle.homes.as_ref().map(|homes| u8s(homes.clone())).unwrap_or(Val::Null)),
        ("drawnHomes", battle.drawn_homes.as_ref().map(|homes| u8s(homes.clone())).unwrap_or(Val::Null)),
        ("said", list(battle.said.clone())),
        ("settledTurns", num(battle.settled_turns)),
        ("lastFlip", i32s(battle.last_flip.clone())),
        ("cityHolder", opt_i8s(&battle.city_holder)),
        ("citiesTaken", list(battle.cities_taken.iter().map(|side| list(side.clone())).collect())),
        ("taken", list(battle.taken.iter().map(|side| list(side.clone())).collect())),
        ("log", list(battle.log.clone())),
        ("planKey", text(&battle.plan_key)),
        ("recorded", num(battle.recorded)),
        ("grown", num(battle.grown)),
        (
            "field",
            field
                .map(|field| Val::obj([("holders", u8s(field.holders.clone())), ("painter", u8s(field.painter.clone())), ("phi", typed_f64(&field.phi)), ("play", u8s(field.play.clone())), ("cols", num(field.cols as f64)), ("rows", num(field.rows as f64)), ("size", num(field.size as f64)), ("turns", num(field.turns as f64))]))
                .unwrap_or(Val::Null),
        ),
    ])
}

const DAY_KEYS: [&str; 16] = ["shown", "regionSide", "homeSide", "homes", "drawnHomes", "said", "settledTurns", "lastFlip", "cityHolder", "citiesTaken", "taken", "log", "planKey", "recorded", "grown", "field"];

fn day_like(battle: &Battle, want: &Val) -> Result<(), String> {
    let got = day_val(battle);
    for key in DAY_KEYS {
        if want.get(key).is_undef() {
            continue;
        }
        if key == "field" {
            for name in ["holders", "painter", "phi", "play", "cols", "rows", "size", "turns"] {
                let value = want.get("field").get(name);
                if !value.is_undef() {
                    same(got.get("field").get(name), value).map_err(|error| format!("field.{name}: {error}"))?;
                }
            }
            continue;
        }
        same(got.get(key), want.get(key)).map_err(|error| format!("{key}: {error}"))?;
    }
    Ok(())
}

fn flips_val(flips: &[Val], names: &[String]) -> Val {
    list(
        flips
            .iter()
            .map(|flip| {
                let mut out = match flip.plain() {
                    Val::Obj(obj) => obj,
                    _ => Obj::new(),
                };
                if let Some(field) = out.get("battlefield").cloned() {
                    let name = match field.get("battle") {
                        Val::Num(at) => text(names.get(*at as usize).map(|name| name.as_str()).unwrap_or("")),
                        _ => field.get("name").clone(),
                    };
                    out.set("battlefield", Val::obj([("name", name)]));
                }
                Val::Obj(out)
            })
            .collect(),
    )
}

fn grow_check<F: Fn(&mut Battle, &mut ohfronts::sim::engine::Run) -> Result<bool, RegionsNeeded>>(case: &Case, grow: F) -> Option<Result<(), String>> {
    let mut run = run_at(case, 1);
    let given = case.arg(1).plain();
    let speeds = arg_numbers(given.get("advanceKm"));
    for at in 0..3 {
        run.advance_km[at] = speeds.get(at).copied().unwrap_or(f64::NAN);
    }
    if let Val::Num(pace) = given.get("pace") {
        run.pace = *pace;
    }
    let mut battle = day_battle(&run, case.arg(0));
    let grew = match grow(&mut battle, &mut run) {
        Ok(grew) => grew,
        Err(_) => return Some(Err("regions needed".into())),
    };
    if let Some(Err(error)) = expect(case, Val::Bool(grew)) {
        return Some(Err(error));
    }
    let want = want_after(case, 0).plain();
    if let Err(error) = day_like(&battle, &want) {
        return Some(Err(error));
    }
    let got = Val::obj([
        ("frame", crate::frame::frame_val(&battle.frame)),
        ("anchors", list(battle.anchors.clone())),
        ("pockets", list(battle.pockets.iter().map(pocket_val).collect())),
        ("startPhi", battle.start_phi.as_ref().map(|phi| typed_f64(phi)).unwrap_or(Val::Null)),
        ("startHolders", battle.start_holders.as_ref().map(|holders| u8s(holders.clone())).unwrap_or(Val::Null)),
        ("sieges", list(battle.sieges.clone())),
        ("siegeKey", text(&battle.siege_key)),
        ("supplyTurns", num(battle.supply_turns)),
        ("pocketTurns", num(battle.pocket_turns)),
    ]);
    for key in ["frame", "anchors", "pockets", "startPhi", "startHolders", "sieges", "siegeKey", "supplyTurns", "pocketTurns"] {
        if !want.get(key).is_undef() {
            if let Err(error) = same(got.get(key), want.get(key)) {
                return Some(Err(format!("{key}: {error}")));
            }
        }
    }
    Some(troops_like(&battle, &want))
}


fn troop_whole(value: &Val) -> ohfronts::sim::troops::Troop {
    let mut troop = troop_full(value);
    let set = |key: &str, slot: &mut f64| {
        if let Val::Num(n) = value.get(key) {
            *slot = *n;
        }
    };
    set("serves", &mut troop.serves);
    set("stranded", &mut troop.stranded);
    set("adrift", &mut troop.adrift);
    set("gave", &mut troop.gave);
    set("pinned", &mut troop.pinned);
    set("spent", &mut troop.spent);
    set("body", &mut troop.body);
    if !value.get("slid").is_undef() {
        troop.slid = value.get("slid").truthy();
    }
    if let Val::Obj(order) = &mut troop.order {
        if let Some(resume) = order.get("resume").cloned() {
            order.set("resume", shallow(&resume));
        }
    }
    troop
}

fn whole_battle(run: &ohfronts::sim::engine::Run, value: &Val) -> Battle {
    let value = &shallow(value);
    let mut battle = order_battle(run, value);
    let shaped = crate::orders::unshared(value);
    let plain = value.plain();
    for side in 0..2 {
        battle.troops[side] = shaped.get("troops").at(side).array_or_empty().iter().map(troop_whole).collect();
    }
    if !plain.get("warId").is_undef() {
        battle.war_id = plain.get("warId").clone();
    }
    battle.even = plain.get("even").is_true();
    battle.swap = plain.get("swap").is_true();
    battle.fresh = plain.get("fresh").is_true();
    if plain.get("base").is_object() {
        battle.base = [plain.get("base").at(0).num(), plain.get("base").at(1).num()];
    }
    if let Val::Num(km) = plain.get("lineKm") {
        battle.line_km = *km;
    }
    if let Val::Map(entries) = plain.get("shown") {
        for (key, item) in entries {
            battle.shown.set(key.string(), item.clone());
        }
    }
    if plain.get("regionSide").is_object() {
        battle.region_side = Some(arg_numbers(plain.get("regionSide")).iter().map(|&n| n as i8).collect());
    }
    day_extras(&mut battle, &plain);
    battle.plan_key = String::new();
    battle.days_run = plain.get("daysRun").num();
    battle.log_from = plain.get("logFrom").num();
    battle.quiet = plain.get("quiet").num();
    battle.away = [plain.get("away").at(0).is_true(), plain.get("away").at(1).is_true()];
    battle.leaving = [plain.get("leaving").at(0).is_true(), plain.get("leaving").at(1).is_true()];
    battle.out_by = crate::manpower::tally_of(plain.get("outBy"));
    battle.harsh_by = crate::manpower::tally_of(plain.get("harshBy"));
    battle.mend_of = false;
    if let Some(field) = battle.field.as_mut() {
        let given = plain.get("field");
        if given.get("ghost").is_object() {
            field.ghost = ints(given.get("ghost"));
        }
        if given.get("when").is_object() {
            field.when = arg_numbers(given.get("when")).iter().map(|&n| n as f32).collect();
        }
        if given.get("marked").is_object() {
            field.marked = bytes(given.get("marked"));
        }
        field.changed = arg_numbers(given.get("changed")).iter().map(|&n| n as usize).collect();
        if let Val::Num(edits) = given.get("edits") {
            field.edits = *edits as i64;
        }
    }
    battle.to_side = match (plain.get("toSide"), plain.get("measured")) {
        (Val::Arr(sides), Val::Num(turns)) if sides.len() == 2 => Some(ohfronts::sim::ground::ToSide { turns: *turns as i64, sides: [ints(&sides[0]), ints(&sides[1])] }),
        _ => None,
    };
    battle
}

fn simulate_check(case: &Case) -> Option<Result<(), String>> {
    let given = case.arg(1).plain();
    let mut run = run_at(case, 1);
    let speeds = arg_numbers(given.get("advanceKm"));
    for at in 0..3 {
        run.advance_km[at] = speeds.get(at).copied().unwrap_or(f64::NAN);
    }
    if let Val::Num(pace) = given.get("pace") {
        run.pace = *pace;
    }
    if let Val::Num(days) = given.get("days") {
        run.days = *days;
    }
    run.braked = given.get("braked").is_true();
    if let Val::Num(left) = given.get("flipsLeft") {
        run.flips_left = *left;
    }
    run.flips = case.arg(1).get("flips").array_or_empty().to_vec();
    run.notes = given.get("notes").array_or_empty().to_vec();
    let fronts = case.arg(1).get("battles").array_or_empty();
    let me = fronts.iter().position(|front| front.same_ref(case.arg(0)))?;
    run.battles = fronts.iter().enumerate().map(|(at, front)| if at == me { whole_battle(&run, case.arg(0)) } else { whole_battle(&run, front) }).collect();
    let steps = match simulate_day(&mut run, me, case.arg(2).num()) {
        Ok(steps) => steps,
        Err(_) => return Some(Err("regions needed".into())),
    };
    if let Some(Err(error)) = expect(case, num(steps)) {
        return Some(Err(error));
    }
    let battle = &run.battles[me];
    let want = wanted(case, 0);
    if let Err(error) = battle_like(battle, &want) {
        return Some(Err(error));
    }
    let mut plain_want = shallow(&want_after(case, 0)).plain();
    let was_grown = match case.arg(0).plain().get("grown") {
        Val::Num(grown) => *grown,
        _ => 0.0,
    };
    if battle.grown != was_grown {
        if let Val::Obj(fields) = &mut plain_want {
            fields.remove("drawnHomes");
        }
    }
    if let Err(error) = day_like(battle, &plain_want) {
        return Some(Err(error));
    }
    if let Err(error) = same_parts(&supply_val(battle), &plain_want, "supply") {
        return Some(Err(error));
    }
    for (key, got) in [("lineKm", num(battle.line_km)), ("closing", text(&battle.closing))] {
        if !plain_want.get(key).is_undef() {
            if let Err(error) = same(&got, plain_want.get(key)) {
                return Some(Err(format!("{key}: {error}")));
            }
        }
    }
    let names: Vec<String> = run.battles.iter().map(|battle| battle.name.clone()).collect();
    let run_want = want_after(case, 1).plain();
    let normal = |flips: &Val| {
        list(
            flips
                .array_or_empty()
                .iter()
                .map(|flip| {
                    let mut out = match flip.plain() {
                        Val::Obj(obj) => obj,
                        _ => Obj::new(),
                    };
                    if let Some(field) = out.get("battlefield").cloned() {
                        out.set("battlefield", Val::obj([("name", field.get("name").clone())]));
                    }
                    Val::Obj(out)
                })
                .collect(),
        )
    };
    if let Err(error) = same(&flips_val(&run.flips, &names), &normal(run_want.get("flips"))) {
        return Some(Err(format!("flips: {error}")));
    }
    if let Err(error) = same(&list(run.notes.clone()), run_want.get("notes")) {
        return Some(Err(format!("notes: {error}")));
    }
    Some(same(&Val::Bool(run.braked), run_want.get("braked")).map_err(|error| format!("braked: {error}")))
}

#[test]
fn day_matches_js() {
    support::run(
        "day",
        &[
            ("startRecorder", &|case| {
                if !case.arg(3).is_nullish() {
                    return None;
                }
                let run = run_at(case, 1);
                let mut battle = day_battle(&run, case.arg(0));
                start_recorder(&mut battle, &run, case.arg(2).num(), None);
                Some(day_like(&battle, &want_after(case, 0).plain()))
            }),
            ("prepare", &|case| {
                let run = bare_run();
                let mut battle = order_battle(&run, case.arg(0));
                battle.even = case.arg(0).plain().get("even").is_true();
                if let (Some(field), Val::Num(edits)) = (battle.field.as_mut(), case.arg(0).plain().get("field").get("edits")) {
                    field.edits = *edits as i64;
                }
                let today = prepare(&mut battle, case.arg(1).num());
                let got = Val::obj([
                    ("day", num(today.day)),
                    ("line", Val::obj([("contour", Val::obj([("x", typed_f64(&today.line.contour.x)), ("y", typed_f64(&today.line.contour.y))])), ("count", num(today.line.count() as f64)), ("total", num(today.line.measured.total))])),
                    ("sectors", sectors_val(&today.sectors)),
                ]);
                if let Some(Err(error)) = expect(case, got) {
                    return Some(Err(error));
                }
                let want = wanted(case, 0);
                let views = list(battle.views.iter().map(|side| list(side.iter().map(view_val).collect())).collect());
                let halts = list(battle.halts_today.iter().map(|halt| Val::obj([("s", halt.s.clone()), ("sector", sector_val(&halt.sector))])).collect());
                if let Err(error) = battle_like(&battle, &want) {
                    return Some(Err(error));
                }
                if !want.get("views").is_undef() {
                    if let Err(error) = same(&views, want.get("views")) {
                        return Some(Err(format!("views: {error}")));
                    }
                }
                if !want.get("haltsToday").is_undef() {
                    if let Err(error) = same(&halts, want.get("haltsToday")) {
                        return Some(Err(format!("haltsToday: {error}")));
                    }
                }
                if !want.get("lineKm").is_undef() {
                    if let Err(error) = same(&num(battle.line_km), want.get("lineKm")) {
                        return Some(Err(format!("lineKm: {error}")));
                    }
                }
                Some(Ok(()))
            }),
            ("mopUp", &|case| {
                let mut run = run_at(case, 1);
                run.braked = case.arg(1).get("braked").is_true();
                let mut battle = day_battle(&run, case.arg(0));
                let taken = mop_up(&mut battle, &run);
                if let Some(Err(error)) = expect(case, Val::Bool(taken)) {
                    return Some(Err(error));
                }
                Some(day_like(&battle, &want_after(case, 0).plain()))
            }),
            ("settleRegions", &|case| {
                let mut run = run_at(case, 1);
                let given = case.arg(1).plain();
                run.braked = given.get("braked").is_true();
                if let Val::Num(left) = given.get("flipsLeft") {
                    run.flips_left = *left;
                }
                run.flips = case.arg(1).get("flips").array_or_empty().to_vec();
                run.notes = given.get("notes").array_or_empty().to_vec();
                let list_of = case.arg(1).get("battles").array_or_empty();
                let me = list_of.iter().position(|front| front.same_ref(case.arg(0)))?;
                let mut battles: Vec<Battle> = list_of.iter().enumerate().map(|(at, front)| if at == me { day_battle(&run, case.arg(0)) } else { day_battle(&run, front) }).collect();
                settle_regions(&mut run, &mut battles, me, case.arg(2).num());
                if let Err(error) = day_like(&battles[me], &shallow(&want_after(case, 0)).plain()) {
                    return Some(Err(error));
                }
                let names: Vec<String> = battles.iter().map(|battle| battle.name.clone()).collect();
                let run_want = want_after(case, 1).plain();
                let want_flips = list(
                    run_want
                        .get("flips")
                        .array_or_empty()
                        .iter()
                        .map(|flip| {
                            let mut out = match flip.plain() {
                                Val::Obj(obj) => obj,
                                _ => Obj::new(),
                            };
                            if let Some(field) = out.get("battlefield").cloned() {
                                out.set("battlefield", Val::obj([("name", field.get("name").clone())]));
                            }
                            Val::Obj(out)
                        })
                        .collect(),
                );
                if let Err(error) = same(&flips_val(&run.flips, &names), &want_flips) {
                    return Some(Err(format!("flips: {error}")));
                }
                if let Err(error) = same(&list(run.notes.clone()), run_want.get("notes")) {
                    return Some(Err(format!("notes: {error}")));
                }
                if let Err(error) = same(&Val::Bool(run.braked), run_want.get("braked")) {
                    return Some(Err(format!("braked: {error}")));
                }
                for (at, front) in run_want.get("battles").array_or_empty().iter().enumerate() {
                    if at == me {
                        continue;
                    }
                    if let Err(error) = day_like(&battles[at], front) {
                        return Some(Err(format!("battle {at}: {error}")));
                    }
                }
                Some(Ok(()))
            }),
            ("growIfNeeded", &|case| grow_check(case, |battle, run| grow_if_needed(battle, run, case.arg(2).num()))),
            ("growToHold", &|case| grow_check(case, |battle, run| grow_to_hold(battle, run, case.arg(2).num(), case.arg(3).num(), case.arg(4).num()))),
            ("simulateDay", &simulate_check),
            ("recordDay", &|case| {
                let run = bare_run();
                let mut battle = day_battle(&run, case.arg(0));
                record_day(&mut battle, case.arg(1).num(), case.arg(2).is_true());
                Some(day_like(&battle, &want_after(case, 0).plain()))
            }),
        ],
    );
}
