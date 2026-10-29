use super::arena::{fill_polygon, project_region};
use super::battle::Battle;
use super::engine::Run;
use super::game_dates::parse_game_date;
use super::js::{self, Val};
use super::weather::{climate_of, season_of, weather_draw, weather_on, world_odds, Day, Odds, WEATHER_STATES};
use crate::jsmath;
use std::rc::Rc;

const MONTH_START: [f64; 12] = [0.0, 31.0, 59.0, 90.0, 120.0, 151.0, 181.0, 212.0, 243.0, 273.0, 304.0, 334.0];
const YEAR: f64 = 365.0;

pub fn day_of_year(month: f64, day: f64) -> f64 {
    let start = if (1.0..=12.0).contains(&month) && month.fract() == 0.0 { MONTH_START[(month - 1.0) as usize] } else { f64::NAN };
    start + if day > 28.0 && month == 2.0 { 28.0 } else { day }
}

fn day_of_month_day(text: &Val) -> f64 {
    let text = js::to_string(text);
    let mut parts = text.split('-');
    let month = parts.next().map(js::number_of_text).unwrap_or(f64::NAN);
    let day = parts.next().map(js::number_of_text).unwrap_or(f64::NAN);
    if (1.0..=12.0).contains(&month) && day >= 1.0 {
        day_of_year(month, if day > 31.0 { 31.0 } else { day })
    } else {
        1.0
    }
}

fn ahead(from: f64, to: f64) -> f64 {
    ((to - from) % YEAR + YEAR) % YEAR
}

fn within(value: f64, least: f64, most: f64) -> f64 {
    if value < least {
        least
    } else if value > most {
        most
    } else {
        value
    }
}

pub const EFFECT_KEYS: [&str; 7] = ["pace", "attack", "wear", "cold", "heat", "air", "freezes"];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Effects(pub [f64; 7]);

impl Effects {
    pub fn pace(&self) -> f64 {
        self.0[0]
    }
    pub fn attack(&self) -> f64 {
        self.0[1]
    }
    pub fn wear(&self) -> f64 {
        self.0[2]
    }
    pub fn cold(&self) -> f64 {
        self.0[3]
    }
    pub fn heat(&self) -> f64 {
        self.0[4]
    }
    pub fn air(&self) -> f64 {
        self.0[5]
    }
    pub fn freezes(&self) -> f64 {
        self.0[6]
    }
}

pub const NEUTRAL_EFFECTS: Effects = Effects([1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]);

fn finite_or(value: &Val, or: f64) -> f64 {
    match value {
        Val::Num(n) if n.is_finite() => *n,
        _ => or,
    }
}

fn effects_of(raw: &Val) -> Effects {
    let mut out = NEUTRAL_EFFECTS;
    for at in 0..6 {
        out.0[at] = finite_or(raw.get(EFFECT_KEYS[at]), NEUTRAL_EFFECTS.0[at]);
    }
    out.0[6] = if raw.get("freezes").is_true() { 1.0 } else { 0.0 };
    out
}

fn positive(value: &Val) -> Option<f64> {
    let number = js::to_number(value);
    if number > 0.0 {
        Some(number)
    } else {
        None
    }
}

fn odds_of(mix: &Val) -> Option<Odds> {
    let mut total = 0.0;
    for state in WEATHER_STATES {
        total += positive(mix.get(state)).unwrap_or(0.0);
    }
    if !(total > 0.0) {
        return None;
    }
    let mut odds = [0.0; 9];
    for (at, state) in WEATHER_STATES.iter().enumerate() {
        odds[at] = positive(mix.get(state)).map(|value| value / total).unwrap_or(0.0);
    }
    Some(odds)
}

fn season_at(zone: &Val, day: f64) -> i64 {
    let seasons = zone.get("seasons").array_or_empty();
    for (at, season) in seasons.iter().enumerate() {
        let start = day_of_month_day(season.get("start"));
        let end = day_of_month_day(season.get("end"));
        let inside = if start <= end { day >= start && day <= end } else { day >= start || day <= end };
        if inside {
            return at as i64;
        }
    }
    -1
}

fn stretch_of(zone: &Val, day: f64) -> (i64, f64, f64) {
    let here = season_at(zone, day);
    let mut first = day;
    let mut last = day;
    let mut step = 1.0;
    while step < YEAR && season_at(zone, ((day - step - 1.0 + YEAR) % YEAR) + 1.0) == here {
        first = ((day - step - 1.0 + YEAR) % YEAR) + 1.0;
        step += 1.0;
    }
    step = 1.0;
    while step < YEAR && season_at(zone, ((day + step - 1.0) % YEAR) + 1.0) == here {
        last = ((day + step - 1.0) % YEAR) + 1.0;
        step += 1.0;
    }
    (here, first, last)
}

fn date_text(value: &Val) -> String {
    if value.is_nullish() {
        String::new()
    } else {
        js::to_string(value)
    }
}

fn half_of(zone: &Val) -> f64 {
    js::or_zero(js::to_number(zone.get("transitionDays"))) / 2.0
}

pub fn season_mix_on(zone: &Val, date: &str) -> Vec<(i64, f64)> {
    let parsed = match parse_game_date(date) {
        Some(parsed) => parsed,
        None => return vec![(-1, 1.0)],
    };
    let day = day_of_year(parsed.month, parsed.day);
    let (here, first, last) = stretch_of(zone, day);
    let half = half_of(zone);
    if !(half > 0.0) || ahead(first, last) >= YEAR - 1.0 {
        return vec![(here, 1.0)];
    }
    let since_start = ahead(first, day) + 0.5;
    let to_end = ahead(day, last) + 0.5;
    if since_start < half && since_start <= to_end {
        let before = season_at(zone, ((first - 2.0 + YEAR) % YEAR) + 1.0);
        let weight = 0.5 + since_start / (2.0 * half);
        return if before == here { vec![(here, 1.0)] } else { vec![(here, weight), (before, 1.0 - weight)] };
    }
    if to_end < half {
        let after = season_at(zone, (last % YEAR) + 1.0);
        let weight = 0.5 + to_end / (2.0 * half);
        return if after == here { vec![(here, 1.0)] } else { vec![(here, weight), (after, 1.0 - weight)] };
    }
    vec![(here, 1.0)]
}

fn events_on<'a>(zone: &'a Val, date: &str) -> Vec<(&'a Val, f64)> {
    let mut out = Vec::new();
    let parsed = match parse_game_date(date) {
        Some(parsed) => parsed,
        None => return out,
    };
    let half = half_of(zone);
    let at = |when: &super::game_dates::GameDate| when.year * YEAR + day_of_year(when.month, when.day);
    for event in zone.get("events").array_or_empty() {
        let (from, to) = match (parse_game_date(&date_text(event.get("from"))), parse_game_date(&date_text(event.get("to")))) {
            (Some(from), Some(to)) => (from, to),
            _ => continue,
        };
        let now = at(&parsed);
        let outside = if now < at(&from) {
            at(&from) - now
        } else if now > at(&to) {
            now - at(&to)
        } else {
            0.0
        };
        let weight = if outside == 0.0 {
            1.0
        } else if half > 0.0 {
            within(1.0 - outside / (half + 1.0), 0.0, 1.0)
        } else {
            0.0
        };
        if weight > 0.0 {
            out.push((event, weight));
        }
    }
    out
}

#[derive(Clone, Debug, PartialEq)]
pub struct ZoneMix {
    pub odds: Odds,
    pub effects: Effects,
    pub season: Val,
    pub color: Val,
}

pub fn zone_mix_on(zone: &Val, date: &str, lat: f64) -> ZoneMix {
    let parsed = parse_game_date(date);
    let world_season = match &parsed {
        Some(parsed) => season_of(parsed.month, lat),
        None => "summer",
    };
    let world = world_odds(climate_of(lat), world_season);
    let mut odds = [0.0; 9];
    let mut effects = Effects([0.0; 7]);
    let mut top: Option<(f64, Val, Val)> = None;
    for (season, weight) in season_mix_on(zone, date) {
        let own = if season >= 0 { zone.get("seasons").at(season as usize) } else { &js::UNDEF };
        let own_odds = if own.truthy() { odds_of(own.get("weather")) } else { None };
        let season_odds = own_odds.as_ref().unwrap_or(world);
        let season_effects = if own.truthy() { effects_of(own.get("effects")) } else { NEUTRAL_EFFECTS };
        for at in 0..9 {
            odds[at] += weight * season_odds[at];
        }
        for at in 0..7 {
            effects.0[at] += weight * season_effects.0[at];
        }
        if top.as_ref().map(|top| weight > top.0).unwrap_or(true) {
            let name = if own.truthy() { own.get("name").clone() } else { Val::str(world_season) };
            let color = if own.get("color").truthy() { own.get("color").clone() } else { zone.get("color").clone() };
            top = Some((weight, name, color));
        }
    }
    for (event, weight) in events_on(zone, date) {
        let given = event.get("effects").as_obj();
        let mut said = NEUTRAL_EFFECTS;
        for at in 0..6 {
            let key = EFFECT_KEYS[at];
            said.0[at] = match given.filter(|given| given.has(key)) {
                Some(given) => finite_or(given.get(key).unwrap(), NEUTRAL_EFFECTS.0[at]),
                None => finite_or(&Val::Num(effects.0[at]), NEUTRAL_EFFECTS.0[at]),
            };
        }
        said.0[6] = match given.filter(|given| given.has("freezes")) {
            Some(given) => {
                if given.get("freezes").unwrap().is_true() {
                    1.0
                } else {
                    0.0
                }
            }
            None => {
                if effects.0[6] >= 0.5 {
                    1.0
                } else {
                    0.0
                }
            }
        };
        for at in 0..7 {
            effects.0[at] = effects.0[at] * (1.0 - weight) + said.0[at] * weight;
        }
        if let Val::Str(weather) = event.get("weather") {
            if WEATHER_STATES.contains(&weather.as_str()) {
                for (at, state) in WEATHER_STATES.iter().enumerate() {
                    odds[at] = odds[at] * (1.0 - weight) + if state == weather { weight } else { 0.0 };
                }
            }
        }
        if weight >= 0.5 {
            let color = match &top {
                Some((_, _, color)) if !color.is_nullish() => color.clone(),
                _ => zone.get("color").clone(),
            };
            top = Some((1.0, event.get("name").clone(), color));
        }
    }
    let season = match &top {
        Some((_, name, _)) if !name.is_nullish() => name.clone(),
        _ => Val::str(world_season),
    };
    let color = match &top {
        Some((_, _, color)) if !color.is_nullish() => color.clone(),
        _ => zone.get("color").clone(),
    };
    ZoneMix { odds, effects, season, color }
}

pub fn zone_lat_of(zone: &Val) -> f64 {
    let mut south = f64::INFINITY;
    let mut north = f64::NEG_INFINITY;
    for point in zone.get("rings").element(0).array_or_empty() {
        let lat = js::to_number(&point.element(1));
        if !(lat >= -90.0 && lat <= 90.0) {
            continue;
        }
        if lat < south {
            south = lat;
        }
        if lat > north {
            north = lat;
        }
    }
    if south <= north {
        (south + north) / 2.0
    } else {
        45.0
    }
}

fn zone_place(zone: &Val) -> String {
    format!("zone:{}", date_text(zone.get("id")))
}

pub fn zone_weather_on(seed: &str, zone: &Val, date: &str) -> Day {
    let lat = zone_lat_of(zone);
    let mix = zone_mix_on(zone, date, lat);
    let sky = weather_on(seed, &zone_place(zone), lat, date, Some(&mix.odds));
    Day { season: mix.season, ..sky }
}

pub const ZONE_CURVE_ROUNDS: usize = 3;
pub const CURVE_KEPT_LAT: f64 = 85.0511287798066;

fn finite_point(point: &Val) -> Option<[f64; 2]> {
    match (point.element(0), point.element(1)) {
        (Val::Num(x), Val::Num(y)) if x.is_finite() && y.is_finite() => Some([x, y]),
        _ => None,
    }
}

pub fn curve_ring(ring: &Val, rounds: usize) -> Vec<[f64; 2]> {
    let mut points: Vec<[f64; 2]> = ring.as_array().map(|ring| ring.iter().filter_map(finite_point).collect()).unwrap_or_default();
    if points.len() > 1 {
        let last = points[points.len() - 1];
        if points[0][0] == last[0] && points[0][1] == last[1] {
            points.pop();
        }
    }
    if points.len() < 3 {
        return points;
    }
    points = points.iter().flat_map(|&point| if point[1].abs() > CURVE_KEPT_LAT { vec![point, point] } else { vec![point] }).collect();
    for _ in 0..rounds {
        let mut next = Vec::with_capacity(points.len() * 2);
        for at in 0..points.len() {
            let [ax, ay] = points[at];
            let [bx, by] = points[(at + 1) % points.len()];
            next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
            next.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
        }
        points = next;
    }
    let first = points[0];
    points.push(first);
    points
}

pub fn curved_rings(zone: &Val) -> Vec<Vec<[f64; 2]>> {
    zone.get("rings").as_array().map(|rings| rings.iter().map(|ring| curve_ring(ring, ZONE_CURVE_ROUNDS)).filter(|ring| ring.len() >= 4).collect()).unwrap_or_default()
}

pub const WEATHER_NEIGHBOURS: [(&str, &[&str]); 9] = [
    ("clear", &["clear", "frost", "fog", "heat", "rain", "snow", "mud"]),
    ("frost", &["frost", "clear", "snow", "fog", "blizzard"]),
    ("snow", &["snow", "frost", "blizzard", "clear", "rain", "fog"]),
    ("blizzard", &["blizzard", "snow", "frost"]),
    ("fog", &["fog", "clear", "frost", "rain", "mud", "snow"]),
    ("rain", &["rain", "storm", "fog", "mud", "clear", "snow"]),
    ("storm", &["storm", "rain", "mud"]),
    ("mud", &["mud", "rain", "storm", "fog", "clear"]),
    ("heat", &["heat", "clear"]),
];

pub fn weathers_fit(a: &str, b: &str) -> bool {
    WEATHER_NEIGHBOURS.iter().find(|(name, _)| *name == a).map(|(_, list)| list.contains(&b)).unwrap_or(false)
}

const PI: f64 = 3.141592653589793;
const KM_A_DEGREE: f64 = 111.2;

fn cosine_of(lat: f64) -> f64 {
    let x = (if lat < 0.0 { -lat } else { lat }) * (PI / 180.0);
    (PI * PI - 4.0 * x * x) / (PI * PI + x * x)
}

pub struct Outline {
    pub points: Vec<[f64; 2]>,
    pub west: f64,
    pub east: f64,
    pub south: f64,
    pub north: f64,
    pub blend: f64,
}

pub fn outline_of(zone: &Val) -> Option<Outline> {
    let points = curved_rings(zone).into_iter().next().unwrap_or_default();
    if points.len() < 3 {
        return None;
    }
    let mut outline = Outline { west: f64::INFINITY, east: f64::NEG_INFINITY, south: f64::INFINITY, north: f64::NEG_INFINITY, blend: js::or_zero(js::to_number(zone.get("blendKm"))), points: Vec::new() };
    for &[lng, lat] in &points {
        if lng < outline.west {
            outline.west = lng;
        }
        if lng > outline.east {
            outline.east = lng;
        }
        if lat < outline.south {
            outline.south = lat;
        }
        if lat > outline.north {
            outline.north = lat;
        }
    }
    outline.points = points;
    Some(outline)
}

fn inside_outline(points: &[[f64; 2]], [x, y]: [f64; 2]) -> bool {
    let mut odd = false;
    let mut back = points.len() - 1;
    for at in 0..points.len() {
        let [ax, ay] = points[back];
        let [bx, by] = points[at];
        if (ay > y) != (by > y) && x < ax + ((y - ay) * (bx - ax)) / (by - ay) {
            odd = !odd;
        }
        back = at;
    }
    odd
}

#[allow(clippy::too_many_arguments)]
fn from_stretch(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64, squeeze: f64) -> f64 {
    let x = px * squeeze;
    let x1 = ax * squeeze;
    let x2 = bx * squeeze;
    let dx = x2 - x1;
    let dy = by - ay;
    let length = dx * dx + dy * dy;
    let mut share = if length > 0.0 { ((x - x1) * dx + (py - ay) * dy) / length } else { 0.0 };
    share = if share < 0.0 {
        0.0
    } else if share > 1.0 {
        1.0
    } else {
        share
    };
    let ex = x1 + share * dx - x;
    let ey = ay + share * dy - py;
    (ex * ex + ey * ey).sqrt()
}

fn outlines_meet(a: &Outline, b: &Outline) -> bool {
    let reach = (a.blend + b.blend) / 2.0 / KM_A_DEGREE;
    let cosine = cosine_of((a.south + a.north + b.south + b.north) / 4.0);
    let squeeze = if cosine > 0.05 { cosine } else { 0.05 };
    let reach_across = reach / squeeze;
    if a.east + reach_across < b.west || b.east + reach_across < a.west || a.north + reach < b.south || b.north + reach < a.south {
        return false;
    }
    if inside_outline(&b.points, a.points[0]) || inside_outline(&a.points, b.points[0]) {
        return true;
    }
    let near = |from: &Outline, to: &Outline| -> bool {
        for &[px, py] in &from.points {
            let mut back = to.points.len() - 1;
            for at in 0..to.points.len() {
                if from_stretch(px, py, to.points[back][0], to.points[back][1], to.points[at][0], to.points[at][1], squeeze) <= reach {
                    return true;
                }
                back = at;
            }
        }
        false
    };
    near(a, b) || near(b, a)
}

pub fn zones_meet(a: &Val, b: &Val) -> bool {
    match (outline_of(a), outline_of(b)) {
        (Some(a), Some(b)) => outlines_meet(&a, &b),
        _ => false,
    }
}

pub fn zone_neighbours(zones: &[Val]) -> Vec<Vec<usize>> {
    let outlines: Vec<Option<Outline>> = zones.iter().map(outline_of).collect();
    let mut beside = vec![Vec::new(); zones.len()];
    for a in 0..zones.len() {
        for b in a + 1..zones.len() {
            let meet = match (&outlines[a], &outlines[b]) {
                (Some(x), Some(y)) => outlines_meet(x, y),
                _ => false,
            };
            if !meet {
                continue;
            }
            beside[a].push(b);
            beside[b].push(a);
        }
    }
    beside
}

fn box_area(outline: &Option<Outline>) -> f64 {
    match outline {
        Some(outline) => (outline.east - outline.west) * (outline.north - outline.south),
        None => 0.0,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ZoneSky {
    pub zone: usize,
    pub zone_val: Val,
    pub state: &'static str,
    pub season: Val,
    pub climate: &'static str,
}

pub fn zone_weathers_on(seed: &str, zones: &[Val], date: &str, neighbours: Option<&Vec<Vec<usize>>>) -> Vec<ZoneSky> {
    let own;
    let beside = match neighbours {
        Some(beside) => beside,
        None => {
            own = zone_neighbours(zones);
            &own
        }
    };
    let mut drawn: Vec<(ZoneSky, Odds, f64)> = zones
        .iter()
        .enumerate()
        .map(|(index, zone)| {
            let lat = zone_lat_of(zone);
            let mix = zone_mix_on(zone, date, lat);
            let place = zone_place(zone);
            let sky = weather_on(seed, &place, lat, date, Some(&mix.odds));
            (ZoneSky { zone: index, zone_val: zone.clone(), state: sky.state, season: mix.season, climate: sky.climate }, mix.odds, weather_draw(seed, &place, date))
        })
        .collect();
    let areas: Vec<f64> = zones.iter().map(|zone| box_area(&outline_of(zone))).collect();
    let mut order: Vec<usize> = (0..zones.len()).collect();
    js::stable_sort_by(&mut order, |&a, &b| {
        let by_area = areas[b] - areas[a];
        if by_area != 0.0 && !by_area.is_nan() {
            by_area
        } else {
            a as f64 - b as f64
        }
    });
    let mut settled = vec![false; zones.len()];
    for index in order {
        let around: Vec<&'static str> = beside.get(index).map(|list| list.iter().filter(|&&other| settled[other]).map(|&other| drawn[other].0.state).collect()).unwrap_or_default();
        settled[index] = true;
        let (entry, odds, draw) = &drawn[index];
        if around.iter().all(|state| weathers_fit(entry.state, state)) {
            continue;
        }
        let fitting: Vec<usize> = WEATHER_STATES.iter().map(|state| around.iter().filter(|other| weathers_fit(state, other)).count()).collect();
        let most = fitting.iter().copied().max().unwrap_or(0);
        let candidates: Vec<usize> = (0..9).filter(|&at| fitting[at] == most).collect();
        let mut total = 0.0;
        for &at in &candidates {
            total += if odds[at] > 0.0 { odds[at] } else { 0.0 };
        }
        let mut chosen = candidates[0];
        if total > 0.0 {
            let mut sum = 0.0;
            for &at in &candidates {
                let share = if odds[at] > 0.0 { odds[at] / total } else { 0.0 };
                if !(share > 0.0) {
                    continue;
                }
                chosen = at;
                sum += share;
                if *draw < sum {
                    break;
                }
            }
        }
        drawn[index].0.state = WEATHER_STATES[chosen];
    }
    drawn.into_iter().map(|(entry, _, _)| entry).collect()
}

fn chamfer(mask: &[u8], width: usize, height: usize, target: u8) -> Vec<i32> {
    let far = 1_000_000_000;
    let mut distance: Vec<i32> = mask.iter().map(|&cell| if cell == target { 0 } else { far }).collect();
    for y in 0..height {
        for x in 0..width {
            let at = y * width + x;
            let mut best = distance[at];
            if x > 0 && distance[at - 1] + 3 < best {
                best = distance[at - 1] + 3;
            }
            if y > 0 {
                if distance[at - width] + 3 < best {
                    best = distance[at - width] + 3;
                }
                if x > 0 && distance[at - width - 1] + 4 < best {
                    best = distance[at - width - 1] + 4;
                }
                if x < width - 1 && distance[at - width + 1] + 4 < best {
                    best = distance[at - width + 1] + 4;
                }
            }
            distance[at] = best;
        }
    }
    for y in (0..height).rev() {
        for x in (0..width).rev() {
            let at = y * width + x;
            let mut best = distance[at];
            if x < width - 1 && distance[at + 1] + 3 < best {
                best = distance[at + 1] + 3;
            }
            if y < height - 1 {
                if distance[at + width] + 3 < best {
                    best = distance[at + width] + 3;
                }
                if x < width - 1 && distance[at + width + 1] + 4 < best {
                    best = distance[at + width + 1] + 4;
                }
                if x > 0 && distance[at + width - 1] + 4 < best {
                    best = distance[at + width - 1] + 4;
                }
            }
            distance[at] = best;
        }
    }
    distance
}

const PAD_MOST: f64 = 80.0;

#[derive(Clone, Debug, PartialEq)]
pub struct ZoneWeights {
    pub zone: usize,
    pub zone_val: Val,
    pub weights: Rc<Vec<f32>>,
}

fn rings_val(rings: &[Vec<[f64; 2]>]) -> Val {
    Val::Arr(rings.iter().map(|ring| Val::Arr(ring.iter().map(|point| Val::nums(point)).collect())).collect())
}

pub fn zones_over(run: &Run, battle: &mut Battle) -> Option<Rc<Vec<ZoneWeights>>> {
    let zones = run.input.get("climateZones").array_or_empty();
    if battle.zones_for {
        return battle.zones.clone();
    }
    battle.zones_for = true;
    battle.zones = None;
    if zones.is_empty() {
        return None;
    }
    let frame = battle.arena.frame.clone();
    let (cols, rows) = {
        let field = battle.field.as_ref().expect("a battle with a field");
        (field.cols, field.rows)
    };
    let place = &battle.place;
    let mut found: Vec<(usize, Val, Vec<f32>)> = Vec::new();
    for (index, zone) in zones.iter().enumerate() {
        let mut least = f64::INFINITY;
        for row in 0..rows {
            if place.km_at(row as f64) < least {
                least = place.km_at(row as f64);
            }
        }
        let blend = js::or_zero(js::to_number(zone.get("blendKm")));
        let pad_f = jsmath::min(PAD_MOST, ((blend / 2.0) / least).ceil() + 1.0);
        if !(pad_f >= 0.0) {
            continue;
        }
        let pad = pad_f as usize;
        let width = cols + 2 * pad;
        let height = rows + 2 * pad;
        let mut mask = vec![0u8; width * height];
        let region = Val::obj([("geometry", Val::obj([("type", Val::str("Polygon")), ("coordinates", rings_val(&curved_rings(zone)))]))]);
        let shape = project_region(&frame, &region);
        if shape.polygons.is_empty() || shape.east < -pad_f || shape.west > cols as f64 + pad_f || shape.north < -pad_f || shape.south > rows as f64 + pad_f {
            continue;
        }
        let mut filled = 0;
        for rings in &shape.polygons {
            filled += fill_polygon(rings, &mut mask, width, height, -pad_f, -pad_f, 1.0, 1u8);
        }
        if filled == 0 {
            continue;
        }
        let inside = chamfer(&mask, width, height, 0);
        let outside = chamfer(&mask, width, height, 1);
        let mut weights = vec![0f32; cols * rows];
        let mut any = false;
        for row in 0..rows {
            let km = place.km_at(row as f64 + 0.5);
            for col in 0..cols {
                let at = (row + pad) * width + col + pad;
                let into = if mask[at] == 1 { inside[at] as f64 / 3.0 } else { -(outside[at] as f64) / 3.0 };
                let weight = if blend > 0.0 {
                    within(0.5 + (into * km) / blend, 0.0, 1.0)
                } else if mask[at] == 1 {
                    1.0
                } else {
                    0.0
                };
                weights[row * cols + col] = weight as f32;
                if weight > 0.0 {
                    any = true;
                }
            }
        }
        if any {
            found.push((index, zone.clone(), weights));
        }
    }
    if found.is_empty() {
        return None;
    }
    for cell in 0..cols * rows {
        let mut total = 0.0;
        for entry in &found {
            total += entry.2[cell] as f64;
        }
        if total > 1.0 {
            for entry in found.iter_mut() {
                entry.2[cell] = (entry.2[cell] as f64 / total) as f32;
            }
        }
    }
    let list = Rc::new(found.into_iter().map(|(zone, zone_val, weights)| ZoneWeights { zone, zone_val, weights: Rc::new(weights) }).collect::<Vec<_>>());
    battle.zones = Some(list.clone());
    Some(list)
}

#[derive(Clone, Debug, PartialEq)]
pub struct ZoneToday {
    pub zone: usize,
    pub zone_val: Val,
    pub weights: Rc<Vec<f32>>,
    pub mix: ZoneMix,
}

pub fn zones_today(run: &Run, battle: &mut Battle, date: &str, lat: f64) -> Option<Rc<Vec<ZoneToday>>> {
    let zones = zones_over(run, battle)?;
    if let Some((when, at)) = &battle.zones_day {
        if when == date && *at == lat {
            return battle.zones_mix.clone();
        }
    }
    battle.zones_day = Some((date.to_string(), lat));
    let mixes = Rc::new(zones.iter().map(|entry| ZoneToday { zone: entry.zone, zone_val: entry.zone_val.clone(), weights: entry.weights.clone(), mix: zone_mix_on(&entry.zone_val, date, lat) }).collect::<Vec<_>>());
    battle.zones_mix = Some(mixes.clone());
    Some(mixes)
}

fn weight_at(weights: &[f32], cell: i64) -> f64 {
    if cell >= 0 && (cell as usize) < weights.len() {
        weights[cell as usize] as f64
    } else {
        f64::NAN
    }
}

pub fn climate_at(today: &[ZoneToday], cell: i64) -> Effects {
    let mut out = NEUTRAL_EFFECTS;
    if cell < 0 {
        return out;
    }
    let mut rest = 1.0;
    let mut sum = [0.0; 7];
    for entry in today {
        let weight = weight_at(&entry.weights, cell);
        if !(weight > 0.0) {
            continue;
        }
        rest -= weight;
        for at in 0..7 {
            sum[at] += weight * entry.mix.effects.0[at];
        }
    }
    if rest >= 1.0 {
        return out;
    }
    for at in 0..7 {
        out.0[at] = sum[at] + if rest > 0.0 { rest * NEUTRAL_EFFECTS.0[at] } else { 0.0 };
    }
    out
}

#[derive(Clone, Debug, PartialEq)]
pub struct OddsAt {
    pub odds: Odds,
    pub zone: Option<(f64, usize)>,
}

pub fn odds_at(today: &[ZoneToday], cell: i64, world: &Odds) -> OddsAt {
    if cell < 0 {
        return OddsAt { odds: *world, zone: None };
    }
    let mut odds = [0.0; 9];
    let mut rest = 1.0;
    let mut top: Option<(f64, usize)> = None;
    for (index, entry) in today.iter().enumerate() {
        let weight = weight_at(&entry.weights, cell);
        if !(weight > 0.0) {
            continue;
        }
        rest -= weight;
        for at in 0..9 {
            odds[at] += weight * entry.mix.odds[at];
        }
        if top.map(|top| weight > top.0).unwrap_or(true) {
            top = Some((weight, index));
        }
    }
    if rest >= 1.0 {
        return OddsAt { odds: *world, zone: None };
    }
    if rest > 0.0 {
        for at in 0..9 {
            odds[at] += rest * world[at];
        }
    }
    OddsAt { odds, zone: top.filter(|top| top.0 >= 0.5) }
}

pub fn freezes_at(zones: &[(&Val, &dyn Fn(f64, f64) -> f64)], lng: f64, lat: f64, date: &str) -> bool {
    let parsed = match parse_game_date(date) {
        Some(parsed) => parsed,
        None => return false,
    };
    let mut weight = 0.0;
    let mut rest = 1.0;
    for (zone, inside) in zones {
        let share = inside(lng, lat);
        if !(share > 0.0) {
            continue;
        }
        rest -= share;
        weight += share * zone_mix_on(zone, date, lat).effects.freezes();
    }
    if rest > 0.0 {
        let climate = climate_of(lat);
        let winter = season_of(parsed.month, lat) == "winter";
        weight += rest * if winter && (climate == "polar" || climate == "continental") { 1.0 } else { 0.0 };
    }
    weight >= 0.5
}
