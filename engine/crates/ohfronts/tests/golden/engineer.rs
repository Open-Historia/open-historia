use crate::support::{self, *};
use ohfronts::sim::engineer::*;
use ohfronts::sim::js::Val;
use ohfronts::sim::view::*;

fn opt(value: &Val, fallback: f64) -> f64 {
    if value.is_undef() {
        fallback
    } else {
        value.num()
    }
}

#[test]
fn engineer_matches_js() {
    support::run(
        "engineer",
        &[
            ("frontLineFor", &|case| {
                let options = case.arg(2);
                let points = front_line_for(case.arg(0), case.arg(1).num(), opt(options.get("behindKm"), ENGINEER_BEHIND_KM), opt(options.get("mostKm"), ENGINEER_KM_MOST));
                expect(case, list(points.iter().map(|point| nums(point)).collect()))
            }),
            ("engineerLines", &|case| {
                let options = case.arg(1);
                let players = if options.get("players").is_undef() { list(Vec::new()) } else { options.get("players").clone() };
                let date = if options.get("date").is_undef() { text("") } else { options.get("date").clone() };
                let script = Script::new(case, "1.chart.holds");
                let chart = options.get("chart");
                let holds = |owner: &str, lng: f64, lat: f64| script.call(&[text(owner), num(lng), num(lat)]);
                let given: Option<&dyn Fn(&str, f64, f64) -> Val> = if chart.truthy() && matches!(chart.get("holds"), Val::Fn) { Some(&holds) } else { None };
                let (world, built) = engineer_lines(case.arg(0), &players, &date, given);
                let built = list(built.iter().map(|entry| Val::obj([("owner", text(&entry.owner)), ("battlefield", text(&entry.battlefield)), ("level", num(entry.level)), ("km", num(entry.km)), ("days", num(entry.days))])).collect());
                Some(expect(case, Val::obj([("world", world), ("built", built)]))?.and_then(|_| script.done()))
            }),
        ],
    );
    support::run(
        "view",
        &[
            ("battlefieldForViewer", &|case| expect(case, battlefield_for_viewer(case.arg(0), case.arg(1)))),
            ("battlefieldsForViewer", &|case| expect(case, list(battlefields_for_viewer(case.arg(0), case.arg(1))))),
        ],
    );
}
