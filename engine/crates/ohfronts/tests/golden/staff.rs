use crate::field::sectors_of;
use crate::fronts::*;
use crate::support::{self, *};
use ohfronts::sim::field::Contour;
use ohfronts::sim::staff::*;

fn decision_val(decision: &Option<Decision>) -> ohfronts::sim::js::Val {
    match decision {
        Some(decision) => ohfronts::sim::js::Val::obj([("order", text(decision.order)), ("sector", text(&decision.sector)), ("ratio", num(decision.ratio))]),
        None => ohfronts::sim::js::Val::Null,
    }
}

#[test]
fn staff_matches_js() {
    let run = bare_run();
    let run = &run;
    support::run(
        "staff",
        &[
            ("troopWorth", &|case| expect(case, num(troop_worth(&troop_full(case.arg(0)))))),
            ("sideIsPlayed", &|case| {
                let battle = pick_battle(run, case.arg(0));
                expect(case, ohfronts::sim::js::Val::Bool(side_is_played(&battle, case.arg(1).num() as usize, case.arg(2))))
            }),
            ("staffDecision", &|case| {
                let battle = pick_battle(run, case.arg(0));
                let options = case.arg(2);
                let today = options.get("today");
                let contour = Contour { x: arg_numbers(today.get("line").get("contour").get("x")), y: arg_numbers(today.get("line").get("contour").get("y")), ..Contour::default() };
                let sectors = if today.get("sectors").is_object() { Some(sectors_of(today.get("sectors"))) } else { None };
                let day = Today { contour: &contour, count: today.get("line").get("count").num() as usize, sectors: sectors.as_ref() };
                let given = if today.is_object() { Some(&day) } else { None };
                expect(case, decision_val(&staff_decision(&battle, case.arg(1).num() as usize, options.get("began").truthy(), given, &options.get("key").string_or_empty())))
            }),
            ("spearheadsOf", &|case| {
                let battle = pick_battle(run, case.arg(0));
                let heads = spearheads_of(&battle, case.arg(1).num() as usize);
                expect(case, list(heads.iter().map(|head| ohfronts::sim::js::Val::obj([("x", num(head.x)), ("y", num(head.y)), ("ours", num(head.ours))])).collect()))
            }),
            ("breakthroughAnswer", &|case| {
                let battle = pick_battle(run, case.arg(0));
                let answer = breakthrough_answer(&battle, case.arg(1).num() as usize);
                expect(
                    case,
                    match answer {
                        Some(answer) => ohfronts::sim::js::Val::obj([
                            ("bodies", list(answer.bodies.iter().map(|body| ohfronts::sim::js::Val::obj([("order", text(body.order)), ("picked", list(body.picked.iter().map(|&n| num(n as f64)).collect()))])).collect())),
                            ("at", ohfronts::sim::js::Val::obj([("x", num(answer.at[0])), ("y", num(answer.at[1]))])),
                        ]),
                        None => ohfronts::sim::js::Val::Null,
                    },
                )
            }),
            ("staffMayOrder", &|case| {
                let battle = pick_battle(run, case.arg(0));
                expect(case, ohfronts::sim::js::Val::Bool(staff_may_order(&battle, case.arg(1).num() as usize)))
            }),
            ("staffStanding", &|case| {
                let battle = pick_battle(run, case.arg(0));
                expect(case, text(&staff_standing(&battle, case.arg(1).num() as usize)))
            }),
        ],
    );
}
