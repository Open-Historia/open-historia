use crate::fronts::*;
use crate::support::{self, *};
use ohfronts::sim::js::{self, Obj, Val};
use ohfronts::sim::mind::planner::*;
use ohfronts::sim::mind::trained::{commander_of, shipped_planner_params};
use ohfronts::sim::war_settings::normalize_war_outcomes;

fn planner_battle(value: &Val) -> ohfronts::sim::battle::Battle {
    let run = bare_run();
    let mut battle = pick_battle(&run, value);
    battle.days_run = value.get("daysRun").num();
    battle
}

fn print_battle(value: &Val) -> ohfronts::sim::battle::Battle {
    let mut bare = Obj::new();
    bare.set("troops", value.get("troops").clone());
    bare.set("orders", value.get("orders").clone());
    let mut battle = planner_battle(&Val::Obj(bare));
    battle.days_run = value.get("daysRun").num();
    let holders = arg_numbers(value.get("field").get("holders"));
    let mut shape = Obj::new();
    shape.set("cols", num(holders.len() as f64));
    shape.set("rows", num(1.0));
    shape.set("holders", value.get("field").get("holders").clone());
    battle.field = Some(field_lite(&Val::Obj(shape), &Val::Undef));
    battle
}

fn side_of(case: &Case) -> usize {
    case.arg(1).num() as usize
}

fn names(value: &Val) -> Vec<String> {
    value.array_or_empty().iter().map(js::to_string).collect()
}

#[test]
fn mind_planner_matches_js() {
    support::run(
        "mindPlanner",
        &[
            ("withLateEval", &|case| {
                let given: Vec<f64> = match case.arg(0) {
                    Val::Arr(list) => list.iter().map(js::to_number).collect(),
                    other => arg_numbers(other),
                };
                expect(case, typed_f64(&with_late_eval(&given)))
            }),
            ("plainPlanner", &|case| expect(case, typed_f64(&plain_planner()))),
            ("standing", &|case| expect(case, typed_f64(&standing(&planner_battle(case.arg(0)), side_of(case))))),
            ("valueFeatures", &|case| expect(case, typed_f64(&value_features(&planner_battle(case.arg(0)), side_of(case))))),
            ("battlePrint", &|case| expect(case, text(&battle_print(&print_battle(case.arg(0)))))),
        ],
    );
}

#[test]
fn mind_trained_matches_js() {
    support::run("mindTrained", &[("shippedPlannerParams", &|case| expect(case, typed_f64(&shipped_planner_params())))]);
}

#[test]
fn mind_commanders_matches_js() {
    support::run(
        "mindCommanders",
        &[("commanderOf", &|case| {
            let given = case.arg(0);
            let sides = [names(given.get("sides").at(0)), names(given.get("sides").at(1))];
            let difficulty = match given.get("difficulty") {
                Val::Undef => "medium".to_string(),
                other => js::to_string(other),
            };
            expect(case, text(commander_of(&sides, given.get("side").num() as usize, &normalize_war_outcomes(given.get("outcomes")), &difficulty, &names(given.get("players")))))
        })],
    );
}
