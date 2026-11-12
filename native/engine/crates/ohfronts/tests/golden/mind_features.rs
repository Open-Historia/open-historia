use crate::field::sectors_of;
use crate::fronts::*;
use crate::support::{self, *};
use ohfronts::sim::battle::Battle;
use ohfronts::sim::engine::{create_run, Hooks, Run};
use ohfronts::sim::field::Contour;
use ohfronts::sim::js::{Obj, Typed, Val};
use ohfronts::sim::mind::features::*;
use ohfronts::sim::staff::Today;

struct Sovereigns(Vec<(Vec<Val>, Val)>);

impl Hooks for Sovereigns {
    fn sovereign_of(&self, id: &str) -> Val {
        self.0.iter().find(|(args, _)| matches!(args.first(), Some(Val::Str(text)) if text == id)).map(|(_, result)| result.clone()).unwrap_or(Val::Undef)
    }
}

pub fn feature_battle(run: &Run, value: &Val) -> Battle {
    let battle = pick_battle(run, value);
    if value.get("mindHomes").is_object() {
        *battle.mind_homes.borrow_mut() = Some(arg_numbers(value.get("mindHomes")).iter().map(|&n| n as i8).collect());
    }
    let mut battle = battle;
    battle.status = value.get("status").string_or_empty();
    battle.line_km = value.get("lineKm").num();
    battle.days_run = value.get("daysRun").num();
    if value.get("pool").is_object() {
        battle.pool = [value.get("pool").at(0).num(), value.get("pool").at(1).num()];
    }
    battle
}

fn run_of(case: &Case, at: usize) -> Option<Run> {
    let value = case.arg(at);
    if !value.is_object() {
        return None;
    }
    let calls = case.calls(&format!("{at}.sovereignOf")).cloned().unwrap_or_default();
    let mut run = create_run(Val::Obj(Obj::new()), Box::new(Sovereigns(calls)));
    let fronts: Vec<Battle> = value.get("battles").array_or_empty().iter().map(|front| feature_battle(&run, front)).collect();
    run.battles = fronts;
    Some(run)
}

fn ground_val(ground: Ground) -> Val {
    Val::obj([("lost", num(ground.lost)), ("taken", num(ground.taken))])
}

fn homes_val(homes: &Option<Vec<i32>>, battle: &Battle, value: &Val) -> Val {
    match homes {
        None => Val::Null,
        Some(table) => {
            let from_mind = battle.mind_homes.borrow().is_some();
            if from_mind || !value.get("homes").is_object() {
                Val::Typed(Typed::I8(table.iter().map(|&n| n as i8).collect()))
            } else {
                u8s(table.iter().map(|&n| n as u8).collect())
            }
        }
    }
}

#[test]
fn mind_features_match_js() {
    support::run(
        "mindFeatures",
        &[
            ("countGround", &|case| {
                let holders = if case.arg(0).is_object() { Some(bytes(case.arg(0))) } else { None };
                let homes = if case.arg(1).is_object() { Some(arg_numbers(case.arg(1)).iter().map(|&n| n as i32).collect::<Vec<i32>>()) } else { None };
                expect(case, ground_val(count_ground(holders.as_deref(), homes.as_deref(), case.arg(2).num() as usize)))
            }),
            ("homeTableOf", &|case| {
                let run = run_of(case, 1);
                let host = run.unwrap_or_else(bare_run);
                let battle = feature_battle(&host, case.arg(0));
                let table = home_table_of(&battle, if case.arg(1).is_object() { Some(&host) } else { None });
                expect(case, homes_val(&table, &battle, case.arg(0)))
            }),
            ("groundOf", &|case| {
                let run = run_of(case, 2);
                let host = run.unwrap_or_else(bare_run);
                let battle = feature_battle(&host, case.arg(0));
                expect(case, ground_val(ground_of(&battle, case.arg(1).num() as usize, if case.arg(2).is_object() { Some(&host) } else { None })))
            }),
            ("staffFeatures", &|case| {
                let run = run_of(case, 3);
                let host = run.unwrap_or_else(bare_run);
                let given = case.arg(3).is_object();
                let battle = feature_battle(&host, case.arg(0));
                let me = host.battles.iter().position(|front| front.name == battle.name && front.sides == battle.sides);
                let options = case.arg(2);
                let today = options.get("today");
                let contour = Contour { x: arg_numbers(today.get("line").get("contour").get("x")), y: arg_numbers(today.get("line").get("contour").get("y")), ..Contour::default() };
                let sectors = if today.get("sectors").is_object() { Some(sectors_of(today.get("sectors"))) } else { None };
                let day = Today { contour: &contour, count: today.get("line").get("count").num() as usize, sectors: sectors.as_ref() };
                let seen = if case.arg(4).as_array().is_some() { Some(arg_numbers(case.arg(4))) } else { None };
                let look = staff_features(&battle, case.arg(1).num() as usize, options.get("began").truthy(), if today.is_object() { Some(&day) } else { None }, &options.get("key").string_or_empty(), if given { Some(&host) } else { None }, me, seen.as_deref());
                expect(case, Val::obj([("x", typed_f64(&look.x)), ("best", text(&look.best)), ("staff", num(look.staff as f64)), ("seen", nums(&look.seen))]))
            }),
        ],
    );
}
