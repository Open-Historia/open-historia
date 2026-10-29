use super::battle::Battle;
use super::climate::{climate_at, odds_at, zone_neighbours, zone_weather_on, zone_weathers_on, zones_today, ZoneToday};
use super::constants::{ATTRITION_DUG, ATTRITION_SHORT, ATTRITION_TIRED, ATTRITION_WEATHER};
use super::engine::Run;
use super::game_dates::{diff_game_days, parse_game_date};
use super::ground::cell_at;
use super::js::{self, OrdMap, Val};
use super::troops::Troop;
use super::unit_motion::hash_seed;
use crate::jsmath;
use std::rc::Rc;

pub const WEATHER_STATES: [&str; 9] = ["clear", "rain", "storm", "mud", "snow", "blizzard", "frost", "heat", "fog"];
pub const SEASONS: [&str; 4] = ["winter", "spring", "summer", "autumn"];
pub const CLIMATES: [&str; 4] = ["polar", "continental", "arid", "tropical"];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Effect {
    pub pace: f64,
    pub attack: f64,
    pub wear: f64,
    pub rest: f64,
    pub air: f64,
    pub cold: f64,
    pub heat: f64,
}

const fn effect(pace: f64, attack: f64, wear: f64, rest: f64, air: f64, cold: f64, heat: f64) -> Effect {
    Effect { pace, attack, wear, rest, air, cold, heat }
}

pub const WEATHER: [Effect; 9] = [
    effect(1.0, 1.0, 0.0, 1.0, 1.0, 0.0, 0.0),
    effect(0.8, 0.95, 0.01, 0.9, 0.6, 0.0, 0.0),
    effect(0.6, 0.85, 0.02, 0.8, 0.0, 0.1, 0.0),
    effect(0.45, 0.85, 0.025, 0.85, 0.7, 0.0, 0.0),
    effect(0.65, 0.9, 0.015, 0.85, 0.5, 0.3, 0.0),
    effect(0.3, 0.7, 0.03, 0.6, 0.0, 1.0, 0.0),
    effect(0.9, 0.95, 0.01, 0.8, 0.9, 0.6, 0.0),
    effect(0.85, 0.9, 0.02, 0.8, 1.0, 0.0, 0.5),
    effect(0.9, 0.8, 0.0, 1.0, 0.0, 0.0, 0.0),
];

pub const WEATHER_LOSS: f64 = 1.2;
pub const SPELL_DAYS: f64 = 4.0;
pub const SPELL_EPOCH: &str = "2000-01-01";
pub const FORECAST_DAYS: f64 = 14.0;

pub type Odds = [f64; 9];

pub fn state_index(state: &str) -> Option<usize> {
    WEATHER_STATES.iter().position(|name| *name == state)
}

pub fn state_named(state: &str) -> Option<&'static str> {
    state_index(state).map(|at| WEATHER_STATES[at])
}

pub fn weather_of(state: &str) -> Effect {
    WEATHER[state_index(state).unwrap_or(0)]
}

const fn odds(clear: f64, rain: f64, storm: f64, mud: f64, snow: f64, blizzard: f64, frost: f64, heat: f64, fog: f64) -> Odds {
    [clear, rain, storm, mud, snow, blizzard, frost, heat, fog]
}

pub const WEATHER_ODDS: [[Odds; 4]; 4] = [
    [
        odds(0.45, 0.0, 0.0, 0.0, 0.2, 0.1, 0.25, 0.0, 0.0),
        odds(0.55, 0.0, 0.0, 0.0, 0.15, 0.0, 0.15, 0.0, 0.15),
        odds(0.65, 0.15, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.2),
        odds(0.5, 0.15, 0.0, 0.0, 0.2, 0.0, 0.15, 0.0, 0.0),
    ],
    [
        odds(0.5, 0.0, 0.0, 0.0, 0.2, 0.05, 0.15, 0.0, 0.1),
        odds(0.55, 0.2, 0.0, 0.2, 0.0, 0.0, 0.0, 0.0, 0.05),
        odds(0.7, 0.15, 0.08, 0.0, 0.0, 0.0, 0.0, 0.07, 0.0),
        odds(0.55, 0.2, 0.0, 0.15, 0.0, 0.0, 0.0, 0.0, 0.1),
    ],
    [
        odds(0.8, 0.12, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.08),
        odds(0.75, 0.0, 0.07, 0.0, 0.0, 0.0, 0.0, 0.18, 0.0),
        odds(0.6, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.4, 0.0),
        odds(0.82, 0.05, 0.0, 0.0, 0.0, 0.0, 0.0, 0.13, 0.0),
    ],
    [
        odds(0.7, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.22, 0.08),
        odds(0.6, 0.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.2, 0.0),
        odds(0.4, 0.35, 0.15, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0),
        odds(0.45, 0.3, 0.15, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0),
    ],
];

pub fn world_odds(climate: &str, season: &str) -> &'static Odds {
    let row = CLIMATES.iter().position(|name| *name == climate).unwrap_or(0);
    let column = SEASONS.iter().position(|name| *name == season).unwrap_or(0);
    &WEATHER_ODDS[row][column]
}

pub fn climate_of(lat: f64) -> &'static str {
    let away = if lat < 0.0 { -lat } else { lat };
    if away >= 60.0 {
        "polar"
    } else if away >= 40.0 {
        "continental"
    } else if away >= 20.0 {
        "arid"
    } else {
        "tropical"
    }
}

pub fn season_of(month: f64, lat: f64) -> &'static str {
    let turned = if lat < 0.0 { ((month + 5.0) % 12.0) + 1.0 } else { month };
    if turned == 12.0 || turned <= 2.0 {
        "winter"
    } else if turned <= 5.0 {
        "spring"
    } else if turned <= 8.0 {
        "summer"
    } else {
        "autumn"
    }
}

pub fn pick_weather(table: &Odds, draw: f64) -> &'static str {
    let mut sum = 0.0;
    for (at, state) in WEATHER_STATES.iter().enumerate() {
        sum += table[at];
        if draw < sum {
            return state;
        }
    }
    "clear"
}

#[derive(Clone, Debug, PartialEq)]
pub struct Day {
    pub state: &'static str,
    pub season: Val,
    pub climate: &'static str,
}

pub fn weather_on(seed: &str, place: &str, lat: f64, date: &str, odds: Option<&Odds>) -> Day {
    let climate = climate_of(lat);
    let parsed = match parse_game_date(date) {
        Some(parsed) => parsed,
        None => return Day { state: "clear", season: Val::str(""), climate },
    };
    let season = season_of(parsed.month, lat);
    let table = odds.unwrap_or_else(|| world_odds(climate, season));
    Day { state: pick_weather(table, weather_draw(seed, place, date)), season: Val::str(season), climate }
}

pub fn weather_draw(seed: &str, place: &str, date: &str) -> f64 {
    let days = match diff_game_days(SPELL_EPOCH, date) {
        Some(days) if days.is_finite() => days,
        _ => 0.0,
    };
    let spell = (days / SPELL_DAYS).floor();
    (hash_seed(&format!("{seed}|{place}|{}|weather", js::number_to_string(spell))) % 10000) as f64 / 10000.0
}

fn zone_sky_on(run: &Run, zone: usize, zone_val: &Val, date: &str, seed: &str) -> Day {
    let fresh = !matches!(&*run.zone_skies.borrow(), Some((when, _)) if when == date);
    if fresh {
        let zones = run.input.get("climateZones").as_array().cloned().unwrap_or_default();
        if run.zone_neighbours.borrow().is_none() {
            *run.zone_neighbours.borrow_mut() = Some(zone_neighbours(&zones));
        }
        let skies = zone_weathers_on(seed, &zones, date, run.zone_neighbours.borrow().as_ref());
        *run.zone_skies.borrow_mut() = Some((date.to_string(), skies));
    }
    let skies = run.zone_skies.borrow();
    let list = &skies.as_ref().unwrap().1;
    let found = list.iter().find(|entry| entry.zone == zone).or_else(|| list.iter().find(|entry| js::strict_equals(entry.zone_val.get("id"), zone_val.get("id"))));
    match found {
        Some(entry) => Day { state: entry.state, season: entry.season.clone(), climate: entry.climate },
        None => zone_weather_on(seed, zone_val, date),
    }
}

pub struct SkyAt {
    pub sky: Day,
    pub today: Option<Rc<Vec<ZoneToday>>>,
    pub middle: i64,
    pub state: &'static str,
}

fn sky_at(run: &Run, battle: &mut Battle, date: &str) -> SkyAt {
    let (cols, rows) = {
        let field = battle.field.as_ref().expect("a battle with a field");
        (field.cols as f64, field.rows as f64)
    };
    if battle.climate_lat.is_none() {
        let [_, lat] = battle.place.to_lng_lat(cols / 2.0, rows / 2.0);
        battle.climate_lat = Some(jsmath::round(lat * 100.0) / 100.0);
    }
    let lat = battle.climate_lat.unwrap();
    let seed = match run.input.get("climateSeed") {
        value if value.is_nullish() => run.seed.clone(),
        value => js::to_string(value),
    };
    let today = zones_today(run, battle, date, lat);
    let parsed = parse_game_date(date);
    let world = parsed.map(|parsed| world_odds(climate_of(lat), season_of(parsed.month, lat)));
    let middle = cell_at(battle.field.as_ref().unwrap(), cols / 2.0, rows / 2.0);
    let there = match (&today, world) {
        (Some(today), Some(world)) => Some(odds_at(today, middle, world)),
        _ => None,
    };
    let zoned = there.as_ref().and_then(|there| there.zone.map(|(_, at)| at));
    let sky = match zoned {
        Some(at) => {
            let entry = &today.as_ref().unwrap()[at];
            let mut sky = zone_sky_on(run, entry.zone, &entry.zone_val, date, &seed);
            let name = entry.zone_val.get("name");
            let head = if name.truthy() { format!("{}, ", js::to_string(name)) } else { String::new() };
            sky.season = Val::Str(format!("{head}{}", js::to_string(&sky.season)));
            sky
        }
        None => weather_on(&seed, &battle.name, lat, date, there.as_ref().map(|there| &there.odds)),
    };
    let forced = match run.steer.get("weather") {
        Val::Str(forced) => state_named(forced),
        _ => None,
    };
    let state = forced.unwrap_or(sky.state);
    SkyAt { sky, today, middle, state }
}

pub fn skies_ahead(run: &Run, battle: &mut Battle, day: f64, days: f64) -> Vec<(String, &'static str)> {
    let mut ahead = Vec::new();
    let mut step = 1.0;
    while step <= days {
        let date = run.date_of(day + step);
        if parse_game_date(&date).is_none() {
            break;
        }
        let state = sky_at(run, battle, &date).state;
        ahead.push((date, state));
        step += 1.0;
    }
    ahead
}

#[derive(Clone, Debug, PartialEq)]
pub struct Sky {
    pub state: &'static str,
    pub season: Val,
    pub climate: &'static str,
    pub effects: Effect,
}

pub fn sky_over(run: &Run, battle: &mut Battle, day: f64) -> Sky {
    let SkyAt { sky, today, middle, state } = sky_at(run, battle, &run.date_of(day));
    let local = today.as_ref().map(|today| climate_at(today, middle));
    battle.climate_today = today;
    let mut effects = weather_of(state);
    if let Some(local) = local {
        if local.air() != 1.0 {
            effects.air *= local.air();
        }
    }
    let out = Sky { state, season: sky.season, climate: sky.climate, effects };
    battle.sky = Some(out.clone());
    let skies = battle.skies.get_or_insert_with(OrdMap::new);
    let known = skies.get(&state.to_string()).copied().unwrap_or(0.0);
    skies.set(state.to_string(), known + 1.0);
    out
}

pub fn harshness_of(sky: Option<&Sky>, troop: &Troop) -> f64 {
    match sky {
        Some(sky) => sky.effects.cold + sky.effects.heat + troop.climate.map(|climate| climate.cold() + climate.heat()).unwrap_or(0.0),
        None => 0.0,
    }
}

pub fn weather_loss(sky: Option<&Sky>, troop: &Troop, exposure: Option<f64>) -> f64 {
    if sky.is_none() {
        return 0.0;
    }
    let harsh = harshness_of(sky, troop);
    if !(harsh > 0.0) {
        return 0.0;
    }
    let short = if troop.pocket { 1.0 } else { 1.0 - troop.supply };
    let unsupplied = if short > 0.0 { harsh * WEATHER_LOSS * short } else { 0.0 };
    let exposure_short = match exposure {
        Some(short) => short,
        None => return unsupplied,
    };
    let tired = if troop.fatigue > 0.0 {
        if troop.fatigue < 1.0 {
            troop.fatigue
        } else {
            1.0
        }
    } else {
        0.0
    };
    let lacking = if exposure_short > 0.0 {
        if exposure_short < 1.0 {
            exposure_short
        } else {
            1.0
        }
    } else {
        0.0
    };
    let exposed = harsh * ATTRITION_WEATHER * (1.0 + ATTRITION_TIRED * tired) * (if troop.dug { ATTRITION_DUG } else { 1.0 });
    (unsupplied + exposed) * (1.0 + ATTRITION_SHORT * lacking)
}
