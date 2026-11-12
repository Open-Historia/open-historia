use crate::fronts::*;
use crate::orders::shallow;
use crate::support::{self, *};
use ohfronts::sim::battle::*;
use ohfronts::sim::engine::{create_run, Hooks, Run};
use ohfronts::sim::js::{Obj, Typed, Val};

struct Recorded {
    calls: Vec<(String, Vec<(Vec<Val>, Val)>)>,
}

impl Recorded {
    fn find(&self, name: &str, key: &str) -> Val {
        self.calls
            .iter()
            .filter(|(own, _)| own == name)
            .flat_map(|(_, calls)| calls.iter())
            .find(|(args, _)| matches!(args.first(), Some(Val::Str(text)) if text == key))
            .map(|(_, result)| result.clone())
            .unwrap_or(Val::Undef)
    }
}

impl Hooks for Recorded {
    fn controller_of(&self, id: &str) -> Val {
        self.find("1.controllerOf", id)
    }
    fn sovereign_of(&self, id: &str) -> Val {
        self.find("1.sovereignOf", id)
    }
    fn strength_of(&self, name: &str) -> Val {
        self.find("1.strengthOf", name)
    }
    fn shortage_of(&self, name: &str) -> Val {
        self.find("1.shortageOf", name)
    }
    fn military_of(&self, name: &str) -> Val {
        self.find("1.militaryOf", name)
    }
}

fn run_of(case: &Case) -> Run {
    let given = case.arg(1).plain();
    let mut areas = Obj::new();
    if let Some(calls) = case.calls("1.groupOf") {
        for (args, result) in calls {
            if let Some(Val::Str(id)) = args.first() {
                areas.set(id, result.clone());
            }
        }
    }
    let mut input = Obj::new();
    input.set("groupAreas", Val::Obj(areas));
    input.set("difficulty", given.get("input").get("difficulty").clone());
    input.set("players", given.get("input").get("players").clone());
    input.set("mechanics", given.get("mech").clone());
    let calls = case.callbacks.clone();
    create_run(Val::Obj(input), Box::new(Recorded { calls }))
}

fn region_battle(run: &Run, value: &Val) -> ohfronts::sim::battle::Battle {
    let value = shallow(value).plain();
    let mut battle = pick_battle(run, &value);
    if let Val::Map(entries) = value.get("shown") {
        for (key, item) in entries {
            battle.shown.set(key.string(), item.clone());
        }
    }
    let i8s_of = |key: &str| if value.get(key).is_object() { Some(arg_numbers(value.get(key)).iter().map(|&n| n as i8).collect::<Vec<i8>>()) } else { None };
    battle.region_side = i8s_of("regionSide");
    battle.home_side = i8s_of("homeSide");
    battle.ice_side = i8s_of("iceSide");
    if value.get("field").get("painter").is_object() {
        if let Some(field) = battle.field.as_mut() {
            field.painter = bytes(value.get("field").get("painter"));
        }
    }
    if let Val::Num(km) = value.get("lineKm") {
        battle.line_km = *km;
    }
    battle.status = value.get("status").string_or_empty();
    battle
}

fn opt_i8s(values: &Option<Vec<i8>>) -> Val {
    values.as_ref().map(|values| Val::Typed(Typed::I8(values.clone()))).unwrap_or(Val::Null)
}

fn region_val(battle: &ohfronts::sim::battle::Battle) -> Val {
    Val::obj([
        ("shown", Val::Map(battle.shown.entries.iter().map(|(key, item)| (text(key), item.clone())).collect())),
        ("regionSide", opt_i8s(&battle.region_side)),
        ("homeSide", opt_i8s(&battle.home_side)),
        ("iceSide", opt_i8s(&battle.ice_side)),
        ("homes", battle.homes.as_ref().map(|homes| u8s(homes.clone())).unwrap_or(Val::Null)),
    ])
}

fn region_like(battle: &ohfronts::sim::battle::Battle, case: &Case) -> Result<(), String> {
    let want = shallow(&want_after(case, 0)).plain();
    let got = region_val(battle);
    for key in ["shown", "regionSide", "homeSide", "iceSide", "homes"] {
        if !want.get(key).is_undef() {
            same(got.get(key), want.get(key)).map_err(|error| format!("{key}: {error}"))?;
        }
    }
    let field = want.get("field");
    if let Some(mine) = &battle.field {
        if field.get("holders").is_object() {
            same(&u8s(mine.holders.clone()), field.get("holders")).map_err(|error| format!("holders: {error}"))?;
        }
        if field.get("painter").is_object() {
            same(&u8s(mine.painter.clone()), field.get("painter")).map_err(|error| format!("painter: {error}"))?;
        }
        if field.get("phi").is_object() {
            same(&typed_f64(&mine.phi), field.get("phi")).map_err(|error| format!("phi: {error}"))?;
        }
    }
    Ok(())
}

fn edge_val(edge: &ohfronts::sim::constants::Edge) -> Val {
    Val::obj([("power", num(edge.power)), ("pace", num(edge.pace)), ("reserves", num(edge.reserves)), ("mend", num(edge.mend))])
}

#[test]
fn battle_matches_js() {
    support::run(
        "battle",
        &[
            ("sideOfName", &|case| {
                let run = bare_run();
                let battle = region_battle(&run, case.arg(0));
                expect(case, num(side_of_name(&battle, &case.arg(1).string_or_empty()) as f64))
            }),
            ("memberIndex", &|case| {
                let run = bare_run();
                let battle = region_battle(&run, case.arg(0));
                expect(case, num(member_index(&battle, case.arg(1).num() as usize, &case.arg(2).string_or_empty()) as f64))
            }),
            ("holderOf", &|case| {
                let run = run_of(case);
                let battle = region_battle(&run, case.arg(0));
                expect(case, text(&holder_of(&battle, &run, &case.arg(2).string_or_empty())))
            }),
            ("readRegions", &|case| {
                let run = run_of(case);
                let mut battle = region_battle(&run, case.arg(0));
                read_regions(&mut battle, &run);
                Some(region_like(&battle, case))
            }),
            ("readRegion", &|case| {
                let run = run_of(case);
                let mut battle = region_battle(&run, case.arg(0));
                read_region(&mut battle, &run, &case.arg(2).string_or_empty());
                Some(region_like(&battle, case))
            }),
            ("paintGround", &|case| {
                let run = run_of(case);
                let mut battle = region_battle(&run, case.arg(0));
                paint_ground(&mut battle, &run);
                Some(region_like(&battle, case))
            }),
            ("reconcile", &|case| {
                let run = run_of(case);
                let mut battle = region_battle(&run, case.arg(0));
                let changed = reconcile(&mut battle, &run);
                if let Some(Err(error)) = expect(case, Val::Bool(changed)) {
                    return Some(Err(error));
                }
                Some(region_like(&battle, case))
            }),
            ("setHandicap", &|case| {
                let run = run_of(case);
                let mut battle = region_battle(&run, case.arg(0));
                set_handicap(&mut battle, &run);
                let want = want_after(case, 0).plain();
                let got = Val::obj([
                    ("edge", list(battle.edge.iter().map(edge_val).collect())),
                    ("short", battle.short.map(|short| nums(&short)).unwrap_or(Val::Undef)),
                    ("worth", battle.worth.as_ref().map(|worth| list(worth.iter().map(|side| nums(side)).collect())).unwrap_or(Val::Null)),
                ]);
                for key in ["edge", "short", "worth"] {
                    if let Err(error) = same(got.get(key), want.get(key)) {
                        return Some(Err(format!("{key}: {error}")));
                    }
                }
                Some(Ok(()))
            }),
            ("lineLength", &|case| {
                let run = bare_run();
                let mut battle = region_battle(&run, case.arg(0));
                expect(case, num(line_length(&mut battle)))
            }),
            ("setRadii", &|case| {
                let run = bare_run();
                let mut battle = region_battle(&run, case.arg(0));
                set_radii(&mut battle);
                let want = want_after(case, 0).plain();
                if let Err(error) = same(&nums(&battle.radius_km), want.get("radiusKm")) {
                    return Some(Err(format!("radiusKm: {error}")));
                }
                if let Err(error) = same(&num(battle.line_km), want.get("lineKm")) {
                    return Some(Err(format!("lineKm: {error}")));
                }
                Some(troops_like(&battle, &want))
            }),
            ("memberWeights", &|case| {
                let run_value = case.arg(1);
                let mut run = run_of(case);
                let me = run_value.get("battles").array_or_empty().iter().position(|front| front.same_ref(case.arg(0)));
                run.battles = run_value.get("battles").array_or_empty().iter().map(|front| region_battle(&run, front)).collect();
                let battle = region_battle(&run, case.arg(0));
                expect(case, nums(&member_weights(&battle, &run, me, case.arg(2).num() as usize)))
            }),
            ("keepStart", &crate::battle_life::keep_start_check),
            ("raiseTroops", &crate::battle_life::raise_troops_check),
            ("isLandFormation", &crate::battle_life::is_land_formation_check),
            ("absorbUnit", &crate::battle_life::absorb_unit_check),
            ("releaseNamed", &crate::battle_life::release_named_check),
            ("loadBattle", &crate::battle_life::load_battle_check),
            ("openBattle", &crate::battle_life::open_battle_check),
            ("saveBattle", &crate::battle_life::save_battle_check),
        ],
    );
}
