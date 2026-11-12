use crate::support::{self, *};
use ohfronts::sim::js::Val;
use ohfronts::sim::plans::*;

fn context_of(value: &Val) -> (Val, Val, Val, Val) {
    let or = |key: &str, otherwise: Val| match value.get(key) {
        Val::Undef => otherwise,
        other => other.clone(),
    };
    (or("projects", Val::Undef), or("cities", Val::Undef), or("player", text("")), or("people", Val::Arr(Vec::new())))
}

fn nulled(value: &Val) -> Val {
    if value.is_undef() {
        Val::Null
    } else {
        value.clone()
    }
}

#[test]
fn plans_match_js() {
    support::run(
        "plans",
        &[
            ("readPlans", &|case| expect(case, read_plans_val(case.arg(0)))),
            ("keptPlansOf", &|case| expect(case, list(kept_plans_of(case.arg(0), case.arg(1))))),
            ("withDiversion", &|case| {
                let options = case.arg(2);
                expect(case, with_diversion(case.arg(0), case.arg(1), options.get("way"), options.get("troops"), options.get("at")))
            }),
            ("withProjectPlan", &|case| {
                let options = case.arg(2);
                expect(case, with_project_plan(case.arg(0), case.arg(1), options.get("project"), &nulled(options.get("way")), &nulled(options.get("off")), &nulled(options.get("sent")), options.get("at")))
            }),
            ("withoutPlan", &|case| expect(case, without_plan(case.arg(0), case.arg(1), case.arg(2)))),
            ("operationsOn", &|case| {
                let given = case.arg(0);
                let (projects, cities, player, people) = context_of(given);
                let context = Context { projects: &projects, cities: &cities, player: &player, people: &people };
                expect(case, list(operations_on(given.get("record"), given.get("side"), &context).into_iter().map(Val::Obj).collect()))
            }),
            ("plansOf", &|case| {
                let (projects, cities, player, people) = context_of(case.arg(2));
                let context = Context { projects: &projects, cities: &cities, player: &player, people: &people };
                expect(case, list(plans_of(case.arg(0), case.arg(1), &context)))
            }),
            ("withOperationOrders", &|case| {
                let options = case.arg(1);
                let (projects, cities, player, people) = context_of(options);
                let context = Context { projects: &projects, cities: &cities, player: &player, people: &people };
                let sides = match options.get("sides") {
                    Val::Undef => Val::Arr(Vec::new()),
                    other => other.clone(),
                };
                expect(case, with_operation_orders(case.arg(0), &sides, &context, options.get("since")))
            }),
            ("knownPlans", &|case| {
                let given = case.arg(0);
                let (projects, cities, player, people) = context_of(given);
                let context = Context { projects: &projects, cities: &cities, player: &player, people: &people };
                let played = match given.get("played") {
                    Val::Undef => Val::Arr(Vec::new()),
                    other => other.clone(),
                };
                let known = known_plans(given.get("record"), given.get("side"), given.get("spies"), &context, &played);
                expect(case, Val::obj([("plans", list(known.plans)), ("sources", list(known.sources))]))
            }),
            ("hasDoubleAgent", &|case| {
                let given = case.arg(0);
                expect(case, Val::Bool(has_double_agent(given.get("record"), given.get("side"), given.get("spies"))))
            }),
            ("describePlans", &|case| {
                let options = case.arg(2);
                let cities = match options.get("cities") {
                    Val::Undef => Val::Arr(Vec::new()),
                    other => other.clone(),
                };
                let most = if options.get("most").is_undef() { 6.0 } else { options.get("most").num() };
                expect(case, list(describe_plans(case.arg(0), case.arg(1), &cities, most).iter().map(|line| text(line)).collect()))
            }),
            ("withWatch", &|case| expect(case, with_watch(case.arg(0), case.arg(1), case.arg(2), case.arg(3).get("since")))),
        ],
    );
}
