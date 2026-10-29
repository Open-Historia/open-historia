use crate::fronts::*;
use crate::support::{self, *};
use ohfronts::sim::arena::City;
use ohfronts::sim::js::Val;
use ohfronts::sim::mind::troops::*;

#[test]
fn mind_troops_match_js() {
    support::run(
        "mindTroops",
        &[
            ("cityWorth", &|case| {
                let city = case.arg(0);
                let city = City { name: String::new(), x: 0.0, y: 0.0, cell: 0.0, population: city.get("population").num(), capital: city.get("capital").truthy() };
                expect(case, num(city_worth(&city)))
            }),
            ("troopView", &|case| {
                let run = bare_run();
                let battle = pick_battle(&run, case.arg(0));
                let view = troop_view(&run, &battle, case.arg(1).num() as usize);
                let rows = list(
                    view.rows
                        .iter()
                        .map(|row| {
                            Val::obj([
                                ("index", num(row.index as f64)),
                                ("t", typed_f64(&row.t)),
                                ("valid", list(row.valid.iter().map(|&flag| Val::Bool(flag)).collect())),
                                ("goal", list(row.goal.iter().map(|goal| text(goal)).collect())),
                            ])
                        })
                        .collect(),
                );
                let places = Val::Map(view.places.entries.iter().map(|(key, way)| (text(key), Val::obj([("way", list(way.iter().map(|&point| point_val(point)).collect()))]))).collect());
                expect(case, Val::obj([("rows", rows), ("places", places)]))
            }),
        ],
    );
}
