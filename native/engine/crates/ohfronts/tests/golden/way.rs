use crate::fronts::*;
use crate::support::{self, *};
use ohfronts::sim::js::Val;
use ohfronts::sim::sectors::Place;
use ohfronts::sim::way::*;

fn place_of(value: &Val) -> Option<Place> {
    if !value.is_object() {
        return None;
    }
    let kind = if value.get("kind").as_str() == Some("city") { "city" } else { "region" };
    let opt = |key: &str| if value.get(key).is_undef() { None } else { Some(value.get(key).num()) };
    Some(Place { kind, name: value.get("name").string_or_empty(), x: value.get("x").num(), y: value.get("y").num(), cell: opt("cell"), region: opt("region").map(|n| n as usize) })
}

fn lagless(options: &Val) -> bool {
    options.get("lagless").truthy()
}

#[test]
fn way_matches_js() {
    let run = bare_run();
    let run = &run;
    support::run(
        "way",
        &[
            ("takeOrder", &|case| {
                let mut troop = troop_full(case.arg(0));
                take_order(&mut troop, case.arg(1).clone());
                let want = want_after(case, 0);
                Some(expect(case, Val::Undef)?.and_then(|_| same(&troop.order, want.get("order"))))
            }),
            ("chanceOf", &|case| {
                let battle = pick_battle(run, case.arg(0));
                expect(case, num(chance_of(&battle, &case.args[1..])))
            }),
            ("leftOnLeg", &|case| {
                let leg = Leg::of(case.arg(0));
                expect(case, num(left_on_leg(&leg, case.arg(1).get("x").num(), case.arg(1).get("y").num())))
            }),
            ("legsOf", &|case| {
                let from = case.arg(0);
                expect(case, legs_val(&legs_of([from.element(0).num(), from.element(1).num()], &points(case.arg(1)))))
            }),
            ("give", &|case| {
                let mut battle = pick_battle(run, case.arg(0));
                let options = case.arg(3);
                let way = points(options.get("way"));
                let word = options.get("word").string_or_empty();
                let breadth = if options.get("breadthKm").is_undef() { 0.0 } else { options.get("breadthKm").num() };
                let how = Telling { day: options.get("day").num(), word: &word, way: &way, standing: options.get("standing"), breadth_km: breadth, lagless: lagless(options) };
                give(&mut battle, case.arg(1).num() as usize, &indexes(case.arg(2)), &how);
                Some(expect(case, Val::Undef)?.and_then(|_| troops_like(&battle, &want_after(case, 0))))
            }),
            ("giveOut", &|case| {
                let mut battle = pick_battle(run, case.arg(0));
                let here = run_lite(case.arg(1));
                let options = case.arg(4);
                give_out(&mut battle, &here, case.arg(2).num() as usize, &indexes(case.arg(3)), options.get("day").num(), &options.get("word").string_or_empty(), options.get("standing"), lagless(options));
                Some(expect(case, Val::Undef)?.and_then(|_| troops_like(&battle, &want_after(case, 0))))
            }),
            ("aimOut", &|case| {
                let mut battle = pick_battle(run, case.arg(0));
                let here = run_lite(case.arg(1));
                let troop = troop_full(case.arg(3));
                let mut order = case.arg(4).clone();
                aim_out(&mut battle, &here, case.arg(2).num() as usize, &troop, &mut order);
                Some(expect(case, Val::Undef)?.and_then(|_| same(&order, &want_after(case, 4))))
            }),
            ("waysFor", &|case| {
                let mut battle = pick_battle(run, case.arg(0));
                let here = run_lite(case.arg(1));
                let target = place_of(case.arg(5));
                let ways = ways_for(&mut battle, &here, case.arg(2).num() as usize, &indexes(case.arg(3)), &case.arg(4).string_or_empty(), target.as_ref(), case.arg(6).num());
                expect(
                    case,
                    Val::obj([
                        ("ways", list(ways.ways.iter().map(|way| list(way.iter().map(|&point| point_val(point)).collect())).collect())),
                        ("midX", num(ways.mid_x)),
                        ("midY", num(ways.mid_y)),
                        ("fx", num(ways.fx)),
                        ("fy", num(ways.fy)),
                    ]),
                )
            }),
            ("giveRoute", &|case| {
                let mut battle = pick_battle(run, case.arg(0));
                let options = case.arg(3);
                give_route(&mut battle, case.arg(1).num() as usize, &indexes(case.arg(2)), options.get("day").num(), &points(options.get("way")), options.get("standing"), lagless(options));
                Some(expect(case, Val::Undef)?.and_then(|_| troops_like(&battle, &want_after(case, 0))))
            }),
        ],
    );
}
