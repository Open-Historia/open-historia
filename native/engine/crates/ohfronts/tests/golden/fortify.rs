use crate::support::{self, *};
use ohfronts::sim::fortify_cost::*;
use ohfronts::sim::fortify_ops::*;
use ohfronts::sim::js::Val;
use ohfronts::sim::war_geography::normalize_fortifications;
use ohfronts::sim::war_settings::*;

fn or_null(value: Option<f64>) -> Val {
    value.map(num).unwrap_or(Val::Null)
}

fn cost_val(cost: &FortifyCost) -> Val {
    Val::obj([("km", num(cost.km)), ("level", num(cost.level)), ("funding", num(cost.funding)), ("people", num(cost.people)), ("men", num(cost.men)), ("days", num(cost.days))])
}

fn defaulted(value: &Val, fallback: f64) -> Val {
    if value.is_undef() {
        num(fallback)
    } else {
        value.clone()
    }
}

fn points_val(points: &[[f64; 2]]) -> Val {
    list(points.iter().map(|point| nums(point)).collect())
}

#[test]
fn war_settings_match_js() {
    support::run("warOutcomes", &[("normalizeWarOutcomes", &|case| expect(case, list(normalize_war_outcomes(case.arg(0)))))]);
    support::run(
        "warSettings",
        &[
            ("normalizeEra", &|case| expect(case, or_null(normalize_era(case.arg(0))))),
            ("normalizeMusterPoints", &|case| expect(case, normalize_muster_points(case.arg(0)).unwrap_or(Val::Null))),
            ("normalizeWarfare", &|case| expect(case, normalize_warfare(case.arg(0)).map(text).unwrap_or(Val::Null))),
            ("normalizeWarSettings", &|case| expect(case, normalize_war_settings(case.arg(0)).unwrap_or(Val::Null))),
            ("warSettingsOf", &|case| expect(case, war_settings_of(case.arg(0)))),
        ],
    );
    support::run("warGeography", &[("normalizeFortifications", &|case| expect(case, list(normalize_fortifications(case.arg(0)))))]);
}

#[test]
fn fortify_costs_match_js() {
    support::run(
        "populationFigure",
        &[
            ("readPopulationFigure", &|case| expect(case, num(read_population_figure(case.arg(0))))),
            ("populationFigureOf", &|case| expect(case, num(population_figure_of(case.arg(0))))),
        ],
    );
    support::run(
        "militaryFunding",
        &[
            ("treasuryFactor", &|case| expect(case, num(treasury_factor(case.arg(0))))),
            ("militaryFunding", &|case| expect(case, num(military_funding(case.arg(0))))),
            ("fundingPerHead", &|case| expect(case, num(funding_per_head(case.arg(0))))),
            ("middleFundingPerHead", &|case| expect(case, num(middle_funding_per_head(case.arg(0))))),
            ("fundingFactor", &|case| expect(case, num(funding_factor(case.arg(0), if case.arg(1).is_undef() { 0.0 } else { case.arg(1).num() })))),
        ],
    );
    support::run(
        "militaryStats",
        &[
            ("normalizeMilitaryStats", &|case| expect(case, normalize_military_stats(case.arg(0)).map(Val::Obj).unwrap_or(Val::Null))),
            ("militaryLookup", &|case| {
                let lookup = military_lookup(case.arg(0));
                Some(Case::replay(&case.result_calls, |args| lookup.of(args.first().unwrap_or(&Val::Undef)).cloned().map(Val::Obj).unwrap_or(Val::Null)))
            }),
        ],
    );
    support::run(
        "fortifyCost",
        &[
            ("fortifyLevelOf", &|case| expect(case, num(fortify_level_of(case.arg(0))))),
            ("buildDays", &|case| {
                let options = case.arg(0);
                expect(case, num(build_days(&defaulted(options.get("km"), 0.0), &defaulted(options.get("level"), FORTIFY_LEVEL_USUAL), &defaulted(options.get("funding"), 1.0), &defaulted(options.get("men"), REFERENCE_MEN))))
            }),
            ("lineKm", &|case| expect(case, num(line_km(case.arg(0))))),
            ("peopleOf", &|case| expect(case, num(people_of(case.arg(0), case.arg(1))))),
            ("manpowerShareOf", &|case| expect(case, num(manpower_share_of(case.arg(0), case.arg(1))))),
            ("fundingOf", &|case| expect(case, num(funding_of(case.arg(0), case.arg(1))))),
            ("fortifyCostReckoner", &|case| {
                let reckoner = fortify_cost_reckoner(case.arg(0), case.arg(1));
                Some(Case::replay(&case.result_calls, |args| cost_val(&reckoner.cost(args.first().unwrap_or(&Val::Undef), args.get(1).unwrap_or(&Val::Undef)))))
            }),
            ("fortifyCostFor", &|case| expect(case, cost_val(&fortify_cost_for(case.arg(0), case.arg(1), case.arg(2), case.arg(3))))),
            ("buildTimeParts", &|case| {
                let (count, unit) = build_time_parts(case.arg(0));
                expect(case, Val::obj([("count", num(count)), ("unit", text(unit))]))
            }),
        ],
    );
}

#[test]
fn fortify_ops_match_js() {
    support::run(
        "fortifyOps",
        &[
            ("fortifyLineOf", &|case| expect(case, points_val(&fortify_line_of(case.arg(0))))),
            ("cleanFortifyOp", &|case| expect(case, clean_fortify_op(case.arg(0)).unwrap_or(Val::Null))),
            ("applyFortifyOp", &|case| {
                let options = case.arg(2);
                let player = if options.get("player").is_undef() { text("") } else { options.get("player").clone() };
                let date = if options.get("date").is_undef() { text("") } else { options.get("date").clone() };
                let script = Script::new(case, "2.chart.holds");
                let chart = options.get("chart");
                let holds = |owner: &str, lng: f64, lat: f64| script.call(&[text(owner), num(lng), num(lat)]);
                let given: Option<&dyn Fn(&str, f64, f64) -> Val> = if chart.truthy() && matches!(chart.get("holds"), Val::Fn) { Some(&holds) } else { None };
                let got = match apply_fortify_op(case.arg(0), case.arg(1), &player, &date, given) {
                    Applied::Refused(error) => Val::obj([("error", text(error))]),
                    Applied::Given { world, line } => Val::obj([("world", world), ("line", line)]),
                    Applied::Built { world, line, days } => Val::obj([("world", world), ("line", line), ("days", num(days))]),
                };
                Some(expect(case, got)?.and_then(|_| script.done()))
            }),
        ],
    );
}
