use crate::arena::arena_of;
use crate::frame::frame_of;
use crate::support::*;
use ohfronts::sim::battle::{create_battle, Battle, Opening};
use ohfronts::sim::climate::*;
use ohfronts::sim::engine::{create_run, NoHooks, Run};
use ohfronts::sim::field::create_field;
use ohfronts::sim::js::{self, Obj, OrdMap, Typed, Val};
use ohfronts::sim::troops::{create_troop, Troop, TroopSeed};
use ohfronts::sim::weather::*;
use std::rc::Rc;

pub fn odds_val(odds: &Odds) -> Val {
    let mut out = Obj::new();
    for (at, state) in WEATHER_STATES.iter().enumerate() {
        out.set(state, num(odds[at]));
    }
    Val::Obj(out)
}

pub fn odds_from(value: &Val) -> Odds {
    let mut odds = [0.0; 9];
    for (at, state) in WEATHER_STATES.iter().enumerate() {
        let item = value.get(state);
        odds[at] = if item.is_nullish() { 0.0 } else { item.num() };
    }
    odds
}

pub fn effects_val(effects: &Effects) -> Val {
    let mut out = Obj::new();
    for (at, key) in EFFECT_KEYS.iter().enumerate() {
        out.set(key, num(effects.0[at]));
    }
    Val::Obj(out)
}

pub fn effects_from(value: &Val) -> Effects {
    let mut out = Effects([0.0; 7]);
    for (at, key) in EFFECT_KEYS.iter().enumerate() {
        out.0[at] = value.get(key).num();
    }
    out
}

pub fn effect_val(effect: &Effect) -> Val {
    Val::obj([
        ("pace", num(effect.pace)),
        ("attack", num(effect.attack)),
        ("wear", num(effect.wear)),
        ("rest", num(effect.rest)),
        ("air", num(effect.air)),
        ("cold", num(effect.cold)),
        ("heat", num(effect.heat)),
    ])
}

fn effect_from(value: &Val) -> Effect {
    Effect { pace: value.get("pace").num(), attack: value.get("attack").num(), wear: value.get("wear").num(), rest: value.get("rest").num(), air: value.get("air").num(), cold: value.get("cold").num(), heat: value.get("heat").num() }
}

fn mix_val(mix: &ZoneMix) -> Val {
    Val::obj([("odds", odds_val(&mix.odds)), ("effects", effects_val(&mix.effects)), ("season", mix.season.clone()), ("color", mix.color.clone())])
}

fn mix_from(value: &Val) -> ZoneMix {
    ZoneMix { odds: odds_from(value.get("odds")), effects: effects_from(value.get("effects")), season: value.get("season").clone(), color: value.get("color").clone() }
}

fn day_val(day: &Day) -> Val {
    Val::obj([("state", text(day.state)), ("season", day.season.clone()), ("climate", text(day.climate))])
}

pub fn sky_val(sky: &Sky) -> Val {
    Val::obj([("state", text(sky.state)), ("season", sky.season.clone()), ("climate", text(sky.climate)), ("effects", effect_val(&sky.effects))])
}

fn climate_named(value: &Val) -> &'static str {
    CLIMATES.iter().find(|name| value.as_str() == Some(**name)).copied().unwrap_or("")
}

pub fn sky_from(value: &Val) -> Option<Sky> {
    if !value.truthy() {
        return None;
    }
    Some(Sky { state: state_named(&value.get("state").string_or_empty()).unwrap_or("clear"), season: value.get("season").clone(), climate: climate_named(value.get("climate")), effects: effect_from(value.get("effects")) })
}

fn text_of(value: &Val) -> String {
    if value.is_nullish() {
        String::new()
    } else {
        js::to_string(value)
    }
}

fn seed_of(value: &Val) -> String {
    if value.is_undef() {
        String::new()
    } else {
        js::to_string(value)
    }
}

fn weights_of(value: &Val) -> Rc<Vec<f32>> {
    Rc::new(arg_numbers(value).iter().map(|&n| n as f32).collect())
}

fn weights_val(weights: &[f32]) -> Val {
    Val::Typed(Typed::F32(weights.to_vec()))
}

fn index_in(zones: &[Val], zone: &Val) -> usize {
    zones.iter().position(|item| same(item, zone).is_ok()).unwrap_or(0)
}

fn today_from(zones: &[Val], value: &Val) -> Vec<ZoneToday> {
    value.array_or_empty().iter().map(|entry| ZoneToday { zone: index_in(zones, entry.get("zone")), zone_val: entry.get("zone").clone(), weights: weights_of(entry.get("weights")), mix: mix_from(entry.get("mix")) }).collect()
}

fn today_val(today: &[ZoneToday]) -> Val {
    list(today.iter().map(|entry| Val::obj([("zone", entry.zone_val.clone()), ("weights", weights_val(&entry.weights)), ("mix", mix_val(&entry.mix))])).collect())
}

fn zones_val(zones: &[ZoneWeights]) -> Val {
    list(zones.iter().map(|entry| Val::obj([("zone", entry.zone_val.clone()), ("weights", weights_val(&entry.weights))])).collect())
}

fn neighbours_of(value: &Val) -> Option<Vec<Vec<usize>>> {
    match value {
        Val::Map(entries) => {
            let mut out = vec![Vec::new(); entries.len()];
            for (key, others) in entries {
                let at = key.num() as usize;
                if at >= out.len() {
                    out.resize(at + 1, Vec::new());
                }
                out[at] = others.array_or_empty().iter().map(|n| n.num() as usize).collect();
            }
            Some(out)
        }
        _ => None,
    }
}

fn neighbours_val(beside: &[Vec<usize>]) -> Val {
    Val::Map(beside.iter().enumerate().map(|(at, others)| (num(at as f64), list(others.iter().map(|&n| num(n as f64)).collect()))).collect())
}

fn zone_sky_val(entry: &ZoneSky) -> Val {
    Val::obj([("zone", entry.zone_val.clone()), ("state", text(entry.state)), ("season", entry.season.clone()), ("climate", text(entry.climate))])
}

fn zone_skies_of(zones: &[Val], value: &Val) -> Vec<ZoneSky> {
    value
        .array_or_empty()
        .iter()
        .map(|entry| ZoneSky { zone: index_in(zones, entry.get("zone")), zone_val: entry.get("zone").clone(), state: state_named(&entry.get("state").string_or_empty()).unwrap_or("clear"), season: entry.get("season").clone(), climate: climate_named(entry.get("climate")) })
        .collect()
}

fn climate_run(value: &Val) -> Run {
    let mut run = create_run(value.get("input").clone(), Box::new(NoHooks));
    run.seed = value.get("seed").string_or_empty();
    run.steer = value.get("steer").clone();
    let zones = run.input.get("climateZones").array_or_empty().to_vec();
    if let Val::Str(date) = value.get("zoneSkiesDate") {
        *run.zone_skies.borrow_mut() = Some((date.clone(), zone_skies_of(&zones, value.get("zoneSkies"))));
    }
    *run.zone_neighbours.borrow_mut() = neighbours_of(value.get("zoneNeighbours"));
    run
}

fn climate_battle(run: &Run, value: &Val) -> Battle {
    let field = value.get("field");
    let (cols, rows) = (field.get("cols").num(), field.get("rows").num());
    let arena = Rc::new(arena_of(&Val::obj([("frame", value.get("arena").get("frame").clone()), ("cols", num(cols)), ("rows", num(rows)), ("size", num(cols * rows))])));
    let mut battle = create_battle(
        run,
        Opening { name: value.get("name").string_or_empty(), war_id: Val::Undef, sides: [Vec::new(), Vec::new()], frame: frame_of(value.get("frame")), arena: arena.clone(), opened_date: Val::Undef, opened_day: Val::Undef },
    );
    battle.field = Some(create_field(arena));
    let zones = run.input.get("climateZones").array_or_empty().to_vec();
    let place = value.get("place");
    if value.get("climateFor").is_object() && same(value.get("climateFor"), place).is_ok() {
        battle.climate_lat = Some(value.get("climateLat").num());
    }
    if value.get("zonesFor").is_object() && same(value.get("zonesFor"), place).is_ok() {
        battle.zones_for = true;
        battle.zones = value.get("zones").as_array().map(|list| Rc::new(list.iter().map(|entry| ZoneWeights { zone: index_in(&zones, entry.get("zone")), zone_val: entry.get("zone").clone(), weights: weights_of(entry.get("weights")) }).collect()));
    }
    if !value.get("zonesDate").is_undef() {
        battle.zones_day = Some((value.get("zonesDate").string_or_empty(), value.get("zonesLat").num()));
    }
    if value.get("zonesMix").is_object() {
        battle.zones_mix = Some(Rc::new(today_from(&zones, value.get("zonesMix"))));
    }
    if value.get("climateToday").is_object() {
        battle.climate_today = Some(Rc::new(today_from(&zones, value.get("climateToday"))));
    }
    battle.sky = sky_from(value.get("sky"));
    if let Val::Obj(skies) = value.get("skies") {
        let mut book = OrdMap::new();
        for (state, count) in skies.entries() {
            book.set(state.to_string(), count.num());
        }
        battle.skies = Some(book);
    }
    battle
}

fn absent(want: &Val) -> Val {
    if want.is_undef() {
        Val::Undef
    } else {
        Val::Null
    }
}

fn battle_after(case: &Case, battle: &Battle) -> Result<(), String> {
    let want = case.after.as_ref().map(|after| after[1].clone()).unwrap_or_else(|| case.arg(1).clone());
    let got = Val::obj([
        ("climateLat", battle.climate_lat.map(num).unwrap_or(Val::Undef)),
        ("zones", if battle.zones_for { battle.zones.as_ref().map(|zones| zones_val(zones)).unwrap_or(Val::Null) } else { Val::Undef }),
        ("zonesDate", battle.zones_day.as_ref().map(|(date, _)| text(date)).unwrap_or(Val::Undef)),
        ("zonesLat", battle.zones_day.as_ref().map(|(_, lat)| num(*lat)).unwrap_or(Val::Undef)),
        ("zonesMix", battle.zones_mix.as_ref().map(|today| today_val(today)).unwrap_or(Val::Undef)),
        ("climateToday", battle.climate_today.as_ref().map(|today| today_val(today)).unwrap_or_else(|| absent(want.get("climateToday")))),
        ("sky", battle.sky.as_ref().map(sky_val).unwrap_or_else(|| absent(want.get("sky")))),
        ("skies", battle.skies.as_ref().map(|skies| { let mut out = Obj::new(); for (state, count) in &skies.entries { out.set(state, num(*count)); } Val::Obj(out) }).unwrap_or(Val::Undef)),
    ]);
    same_keys(&got, &want, &["climateLat", "zones", "zonesDate", "zonesLat", "zonesMix", "climateToday", "sky", "skies"]).map_err(|error| format!("battle after: {error}"))
}

fn run_after(case: &Case, run: &Run) -> Result<(), String> {
    let want = case.after.as_ref().map(|after| after[0].clone()).unwrap_or_else(|| case.arg(0).clone());
    let skies = run.zone_skies.borrow();
    let got = Val::obj([
        ("zoneSkiesDate", skies.as_ref().map(|(date, _)| text(date)).unwrap_or(Val::Undef)),
        ("zoneSkies", skies.as_ref().map(|(_, list)| self::list(list.iter().map(zone_sky_val).collect())).unwrap_or(Val::Undef)),
        ("zoneNeighbours", run.zone_neighbours.borrow().as_ref().map(|beside| neighbours_val(beside)).unwrap_or(Val::Undef)),
    ]);
    same_keys(&got, &want, &["zoneSkiesDate", "zoneSkies", "zoneNeighbours"]).map_err(|error| format!("run after: {error}"))
}

fn with_battle<F: Fn(&Run, &mut Battle) -> Val>(case: &Case, call: F) -> Option<Result<(), String>> {
    let run = climate_run(case.arg(0));
    let mut battle = climate_battle(&run, case.arg(1));
    let got = call(&run, &mut battle);
    Some(expect(case, got)?.and_then(|_| battle_after(case, &battle)).and_then(|_| run_after(case, &run)))
}

fn troop_from(value: &Val) -> Troop {
    let mut troop = create_troop(TroopSeed::default());
    troop.pocket = value.get("pocket").truthy();
    troop.supply = value.get("supply").num();
    troop.fatigue = value.get("fatigue").num();
    troop.dug = value.get("dug").truthy();
    troop.climate = if value.get("climate").truthy() { Some(effects_from(value.get("climate"))) } else { None };
    troop
}

fn today_arg(value: &Val) -> Vec<ZoneToday> {
    today_from(&[], value)
}

fn rings_val(rings: &[Vec<[f64; 2]>]) -> Val {
    list(rings.iter().map(|ring| list(ring.iter().map(|point| nums(point)).collect())).collect())
}

#[test]
fn climate_matches_js() {
    run(
        "climate",
        &[
            ("climateAt", &|case| expect(case, effects_val(&climate_at(&today_arg(case.arg(0)), case.arg(1).num() as i64)))),
            ("oddsAt", &|case| {
                let today = today_arg(case.arg(0));
                let got = odds_at(&today, case.arg(1).num() as i64, &odds_from(case.arg(2)));
                let zone = match got.zone {
                    Some((weight, at)) => Val::obj([("weight", num(weight)), ("zone", today[at].zone_val.clone()), ("mix", mix_val(&today[at].mix))]),
                    None => Val::Null,
                };
                expect(case, Val::obj([("odds", odds_val(&got.odds)), ("zone", zone)]))
            }),
            ("curvedRings", &|case| expect(case, rings_val(&curved_rings(case.arg(0))))),
            ("freezesAt", &|case| {
                let entries = case.arg(0).array_or_empty();
                if entries.iter().any(|entry| !entry.get("box").is_object()) {
                    return None;
                }
                let boxes: Vec<Vec<f64>> = entries.iter().map(|entry| arg_numbers(entry.get("box"))).collect();
                let insides: Vec<Box<dyn Fn(f64, f64) -> f64>> = boxes
                    .iter()
                    .map(|b| {
                        let b = b.clone();
                        Box::new(move |lng: f64, lat: f64| if lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3] { 0.75 } else { 0.25 }) as Box<dyn Fn(f64, f64) -> f64>
                    })
                    .collect();
                let zones: Vec<(&Val, &dyn Fn(f64, f64) -> f64)> = entries.iter().zip(&insides).map(|(entry, inside)| (entry.get("zone"), inside.as_ref())).collect();
                expect(case, Val::Bool(freezes_at(&zones, case.arg(1).num(), case.arg(2).num(), &text_of(case.arg(3)))))
            }),
            ("seasonMixOn", &|case| expect(case, list(season_mix_on(case.arg(0), &text_of(case.arg(1))).iter().map(|(season, weight)| Val::obj([("season", num(*season as f64)), ("weight", num(*weight))])).collect()))),
            ("weathersFit", &|case| expect(case, Val::Bool(weathers_fit(&js::to_string(case.arg(0)), &js::to_string(case.arg(1)))))),
            ("zoneLatOf", &|case| expect(case, num(zone_lat_of(case.arg(0))))),
            ("zoneMixOn", &|case| expect(case, mix_val(&zone_mix_on(case.arg(0), &text_of(case.arg(1)), case.arg(2).num())))),
            ("zoneNeighbours", &|case| expect(case, neighbours_val(&zone_neighbours(case.arg(0).array_or_empty())))),
            ("zoneWeatherOn", &|case| {
                let ask = case.arg(0);
                expect(case, day_val(&zone_weather_on(&seed_of(ask.get("seed")), ask.get("zone"), &text_of(ask.get("date")))))
            }),
            ("zoneWeathersOn", &|case| {
                let ask = case.arg(0);
                let zones = ask.get("zones").as_array().cloned().unwrap_or_default();
                let beside = neighbours_of(ask.get("neighbours"));
                expect(case, list(zone_weathers_on(&seed_of(ask.get("seed")), &zones, &text_of(ask.get("date")), beside.as_ref()).iter().map(zone_sky_val).collect()))
            }),
            ("zonesMeet", &|case| expect(case, Val::Bool(zones_meet(case.arg(0), case.arg(1))))),
            ("zonesOver", &|case| with_battle(case, |run, battle| zones_over(run, battle).map(|zones| zones_val(&zones)).unwrap_or(Val::Null))),
            ("zonesToday", &|case| with_battle(case, |run, battle| zones_today(run, battle, &text_of(case.arg(2)), case.arg(3).num()).map(|today| today_val(&today)).unwrap_or(Val::Null))),
        ],
    );
}

#[test]
fn weather_matches_js() {
    run(
        "weather",
        &[
            ("climateOf", &|case| expect(case, text(climate_of(case.arg(0).num())))),
            ("seasonOf", &|case| expect(case, text(season_of(case.arg(0).num(), case.arg(1).num())))),
            ("pickWeather", &|case| expect(case, text(pick_weather(&odds_from(case.arg(0)), case.arg(1).num())))),
            ("weatherDraw", &|case| expect(case, num(weather_draw(&js::to_string(case.arg(0)), &js::to_string(case.arg(1)), &text_of(case.arg(2)))))),
            ("weatherOn", &|case| {
                let ask = case.arg(0);
                let lat = if ask.get("lat").is_undef() { 45.0 } else { ask.get("lat").num() };
                let odds = if ask.get("odds").is_nullish() { None } else { Some(odds_from(ask.get("odds"))) };
                expect(case, day_val(&weather_on(&seed_of(ask.get("seed")), &seed_of(ask.get("place")), lat, &text_of(ask.get("date")), odds.as_ref())))
            }),
            ("harshnessOf", &|case| expect(case, num(harshness_of(sky_from(case.arg(0)).as_ref(), &troop_from(case.arg(1)))))),
            ("weatherLoss", &|case| {
                let exposure = if case.arg(2).truthy() { Some(case.arg(2).get("short").num()) } else { None };
                expect(case, num(weather_loss(sky_from(case.arg(0)).as_ref(), &troop_from(case.arg(1)), exposure)))
            }),
            ("skyOver", &|case| with_battle(case, |run, battle| sky_val(&sky_over(run, battle, case.arg(2).num())))),
            ("skiesAhead", &|case| {
                with_battle(case, |run, battle| {
                    let days = if case.arg(3).is_undef() { FORECAST_DAYS } else { case.arg(3).num() };
                    list(skies_ahead(run, battle, case.arg(2).num(), days).iter().map(|(date, state)| Val::obj([("d", text(date)), ("w", text(state))])).collect())
                })
            }),
        ],
    );
}
