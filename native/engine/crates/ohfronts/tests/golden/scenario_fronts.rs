use crate::support::{self, *};
use ohfronts::sim::scenario_fronts::*;

#[test]
fn scenario_fronts_match_js() {
    support::run(
        "scenarioFronts",
        &[
            ("normalizeScenarioFronts", &|case| expect(case, normalize_scenario_fronts(case.arg(0), case.arg(1).get("draft").truthy()))),
            ("blankScenarioFront", &|case| expect(case, blank_scenario_front())),
            ("scenarioFrontWars", &|case| expect(case, scenario_front_wars(case.arg(0), case.arg(1), case.arg(2)))),
            ("scenarioFrontOrders", &|case| expect(case, scenario_front_orders(case.arg(0)))),
            ("authoredTroops", &|case| expect(case, authored_troops(case.arg(0), case.arg(1)))),
            ("authoredForms", &|case| expect(case, authored_forms(case.arg(0), case.arg(1)))),
            ("authoredName", &|case| expect(case, authored_name(case.arg(0), case.arg(1)))),
            ("withScenarioGenerals", &|case| expect(case, with_scenario_generals(case.arg(0), case.arg(1)))),
        ],
    );
}
