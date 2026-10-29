use crate::arena::arena_of;
use crate::frame::frame_of;
use crate::support::*;
use ohfronts::sim::constants::Edge;
use ohfronts::sim::frame::Projector;
use ohfronts::sim::handicap::*;
use ohfronts::sim::held_regions::battlefield_held_claimants;
use ohfronts::sim::invade::*;
use ohfronts::sim::js::{self, Val};
use ohfronts::sim::mechanics::*;
use ohfronts::sim::military::*;

fn mechanics_val(mech: &Mechanics) -> Val {
    let mut out = js::Obj::new();
    for (at, key) in MECHANICS.iter().enumerate() {
        out.set(key, Val::Bool(mech.on[at]));
    }
    Val::Obj(out)
}

fn opt(value: Option<f64>) -> Val {
    value.map(num).unwrap_or(Val::Null)
}

fn military_val(stats: &Military) -> Val {
    Val::obj([
        ("quality", num(stats.quality)),
        ("technology", num(stats.technology)),
        ("land", num(stats.land)),
        ("sea", num(stats.sea)),
        ("air", num(stats.air)),
        ("manpowerShare", opt(stats.manpower_share)),
        ("cavalryShare", opt(stats.cavalry_share)),
        ("siegeShare", opt(stats.siege_share)),
        ("menPerCounter", opt(stats.men_per_counter)),
    ])
}

fn military_of(value: &Val) -> Military {
    let maybe = |key: &str| if value.get(key).is_nullish() { None } else { Some(value.get(key).num()) };
    Military {
        quality: value.get("quality").num(),
        technology: value.get("technology").num(),
        land: value.get("land").num(),
        sea: value.get("sea").num(),
        air: value.get("air").num(),
        manpower_share: maybe("manpowerShare"),
        cavalry_share: maybe("cavalryShare"),
        siege_share: maybe("siegeShare"),
        men_per_counter: maybe("menPerCounter"),
    }
}

fn edge_val(edge: &Edge) -> Val {
    Val::obj([("power", num(edge.power)), ("pace", num(edge.pace)), ("reserves", num(edge.reserves)), ("mend", num(edge.mend))])
}

fn edge_from(value: &Val) -> Edge {
    Edge { power: value.get("power").num(), pace: value.get("pace").num(), reserves: value.get("reserves").num(), mend: value.get("mend").num() }
}

fn defaulted<'a>(value: &'a Val, fallback: &'a Val) -> &'a Val {
    if value.is_undef() {
        fallback
    } else {
        value
    }
}

#[test]
fn mechanics_match_js() {
    run(
        "mechanics",
        &[
            ("readMechanics", &|case| expect(case, mechanics_val(&read_mechanics(case.arg(0))))),
            ("anyMechanic", &|case| expect(case, Val::Bool(any_mechanic(case.arg(0))))),
        ],
    );
}

#[test]
fn military_matches_js() {
    run(
        "military",
        &[
            ("readMilitary", &|case| expect(case, military_val(&read_military(case.arg(0))))),
            ("statFactor", &|case| expect(case, num(stat_factor(case.arg(0).num(), case.arg(1).num(), case.arg(2).num())))),
            ("landWorth", &|case| expect(case, num(land_worth(&military_of(case.arg(0)))))),
            ("seaWorth", &|case| expect(case, num(sea_worth(&military_of(case.arg(0)))))),
            ("airWorth", &|case| expect(case, num(air_worth(&military_of(case.arg(0)))))),
            ("mixOf", &|case| {
                let got = match mix_of(&military_of(case.arg(0))) {
                    Some(mix) => Val::obj([("armour", opt(mix.armour)), ("artillery", opt(mix.artillery))]),
                    None => Val::Null,
                };
                expect(case, got)
            }),
        ],
    );
}

#[test]
fn held_regions_match_js() {
    run(
        "heldRegions",
        &[("battlefieldHeldClaimants", &|case| {
            let options = case.arg(0);
            let changed = battlefield_held_claimants(options.get("battlefields"), options.get("owners"), options.get("sovereigns"), options.get("claimants"));
            expect(case, Val::Map(changed.into_iter().map(|(key, kept)| (text(&key), list(kept))).collect()))
        })],
    );
}

#[test]
fn handicap_matches_js() {
    let empty_text = Val::str("");
    let empty_list = Val::Arr(Vec::new());
    run(
        "handicap",
        &[
            ("edgeOfDifficulty", &|case| expect(case, edge_val(&edge_of_difficulty(case.arg(0))))),
            ("weighedSide", &|case| expect(case, num(weighed_side(case.arg(0), case.arg(1))))),
            ("shortEdge", &|case| expect(case, edge_val(&short_edge(edge_from(case.arg(0)), case.arg(1).num())))),
            ("sideShortage", &|case| {
                let shortage = Script::new(case, "1");
                let strength = Script::new(case, "2");
                let has_shortage = matches!(case.arg(1), Val::Fn);
                let has_strength = matches!(case.arg(2), Val::Fn);
                let got = side_shortage(
                    case.arg(0).array_or_empty(),
                    if has_shortage { Some(|member: &Val| shortage.call(std::slice::from_ref(member)).num()) } else { None },
                    if has_strength { Some(|member: &Val| strength.call(std::slice::from_ref(member)).num()) } else { None },
                );
                Some(expect(case, num(got))?.and_then(|_| shortage.done()).and_then(|_| strength.done()))
            }),
            ("handicapOf", &|case| {
                let options = case.arg(0);
                let found = handicap_of(defaulted(options.get("difficulty"), &empty_text), defaulted(options.get("sides"), &empty_list), defaulted(options.get("players"), &empty_list));
                expect(case, Val::obj([("side", num(found.side)), ("edge", edge_val(&found.edge)), ("edges", list(found.edges.iter().map(edge_val).collect()))]))
            }),
        ],
    );
}

#[test]
fn invade_matches_js() {
    run(
        "invade",
        &[
            ("othersOnWay", &|case| {
                let options = case.arg(0);
                if !options.get("arena").truthy() || !options.get("place").truthy() || options.get("way").as_array().is_none() {
                    return expect(case, list(Vec::new()));
                }
                let arena = arena_of(options.get("arena"));
                let place = match options.get("place").get("$args") {
                    Val::Arr(args) if !args.is_empty() => Projector::of(&frame_of(&args[0])),
                    _ => return None,
                };
                let way: Vec<[f64; 2]> = options.get("way").array_or_empty().iter().map(|p| [p.element(0).num(), p.element(1).num()]).collect();
                let holder = Script::new(case, "0.holderOf");
                let war = Script::new(case, "0.inWar");
                let got = others_on_way(&arena, &place, &way, |id| holder.call(&[text(id)]), |name| war.call(&[text(name)]).truthy());
                Some(expect(case, list(got.iter().map(|name| text(name)).collect()))?.and_then(|_| holder.done()).and_then(|_| war.done()))
            }),
            ("readAttacks", &|case| expect(case, list(read_attacks(case.arg(0)).iter().map(|name| text(name)).collect()))),
            ("landWithin", &|case| {
                let arena = arena_of(case.arg(0));
                let held = case.arg(1).clone();
                let got = land_within(&arena, |index| held.element(index).truthy(), case.arg(2).num(), case.arg(3).num(), case.arg(4).num());
                expect(case, Val::Bool(got))
            }),
        ],
    );
}
