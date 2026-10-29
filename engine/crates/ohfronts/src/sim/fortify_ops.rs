use super::fortify_cost::{fortify_cost_for, fortify_level_of};
use super::game_dates::add_game_days;
use super::js::{self, Obj, OrdMap, Val};
use super::walls::{stands_on, WallLine};
use super::war_geography::{normalize_fortifications, FORTIFICATIONS_MOST};
use super::war_settings::war_settings_of;
use super::world_grid::{km_between, Surface};
use crate::jsmath;

pub const FORTIFY_OPS: [&str; 2] = ["fortify", "unfortify"];
pub const FORTIFY_KM_LEAST: f64 = 1.0;
pub const FORTIFY_KM_MOST: f64 = 6000.0;
pub const FORTIFY_POINTS_MOST: usize = 200;
pub const FORTIFY_BUILDING_MOST: usize = 12;
const GROUND_STEP_KM: f64 = 1.0;
const GROUND_SAMPLES_MOST: f64 = 6000.0;
const NAME_MOST: usize = 80;

pub const REFUSED_NOTHING: &str = "Nothing was asked.";
pub const REFUSED_NOBODY: &str = "You play no country to build it.";
pub const REFUSED_OFF: &str = "Fortified lines are no part of this scenario's wars.";
pub const REFUSED_OWNER: &str = "A line is built by your own country, for your own country.";
pub const REFUSED_LEVEL: &str = "Say how strong the line is to be.";
pub const REFUSED_LINE: &str = "Draw the line on the map.";
pub const REFUSED_SHORT: &str = "That line is too short to build.";
pub const REFUSED_LONG: &str = "That line is too long to build: draw a shorter one.";
pub const REFUSED_GROUND: &str = "A line is built on ground you hold: part of this one runs through land you do not.";
pub const REFUSED_WATER: &str = "A line is built on land: this one runs only over water.";
pub const REFUSED_CHART: &str = "The map could not be read to see whose ground that is: try again.";
pub const REFUSED_CALENDAR: &str = "The game's date cannot be counted in days, so no line can be built to time.";
pub const REFUSED_ROOM: &str = "There is no room on the map for another fortified line.";
pub const REFUSED_BUSY: &str = "You have as many lines being built as can be: wait for one to be finished.";
pub const REFUSED_GONE: &str = "That line is not one of yours being built.";

fn clean(value: &Val, most: usize) -> String {
    let text = if value.is_nullish() { String::new() } else { js::to_string(value) };
    js::trim(&js::slice_units(js::trim(&js::collapse_spaces(&text)), 0, most)).to_string()
}

fn fold(value: &Val) -> String {
    js::lower(&clean(value, 200))
}

fn point_of(value: &Val) -> Option<[f64; 2]> {
    let list = value.as_array()?;
    if list.len() < 2 {
        return None;
    }
    let lng = js::to_number(&list[0]);
    let lat = js::to_number(&list[1]);
    if !lng.is_finite() || !lat.is_finite() || !(-90.0..=90.0).contains(&lat) {
        return None;
    }
    Some([jsmath::round(lng * 100000.0) / 100000.0, jsmath::round(lat * 100000.0) / 100000.0])
}

pub fn fortify_line_of(value: &Val) -> Vec<[f64; 2]> {
    let mut points: Vec<[f64; 2]> = Vec::new();
    for raw in value.array_or_empty().iter().take(FORTIFY_POINTS_MOST * 25) {
        let point = match point_of(raw) {
            Some(point) => point,
            None => continue,
        };
        if let Some(last) = points.last() {
            if last[0] == point[0] && last[1] == point[1] {
                continue;
            }
        }
        points.push(point);
    }
    if points.len() <= FORTIFY_POINTS_MOST {
        return points;
    }
    let last = (points.len() - 1) as f64;
    (0..FORTIFY_POINTS_MOST).map(|index| points[jsmath::round((index as f64 * last) / (FORTIFY_POINTS_MOST - 1) as f64) as usize]).collect()
}

fn places_along(points: &[[f64; 2]], km: f64) -> Vec<[f64; 2]> {
    let step = jsmath::max(GROUND_STEP_KM, km / GROUND_SAMPLES_MOST);
    let mut places = vec![points[0]];
    for index in 1..points.len() {
        let [lng_a, lat_a] = points[index - 1];
        let [lng_b, lat_b] = points[index];
        let parts = jsmath::max(1.0, (km_between(lng_a, lat_a, lng_b, lat_b, Surface::default()) / step).ceil());
        let mut part = 1.0;
        while part <= parts {
            places.push([lng_a + ((lng_b - lng_a) * part) / parts, lat_a + ((lat_b - lat_a) * part) / parts]);
            part += 1.0;
        }
    }
    places
}

pub type Holds<'a> = &'a dyn Fn(&str, f64, f64) -> Val;

fn ground_refusal(holds: Holds, owner: &str, points: &[[f64; 2]], km: f64) -> &'static str {
    let mut land = 0;
    for [lng, lat] in places_along(points, km) {
        let held = holds(owner, lng, lat);
        if held.is_nullish() {
            continue;
        }
        if !held.truthy() {
            return REFUSED_GROUND;
        }
        land += 1;
    }
    if land > 0 {
        ""
    } else {
        REFUSED_WATER
    }
}

fn next_line_id(lines: &[Val]) -> String {
    let mut serial = 1.0;
    loop {
        let id = format!("built-{}", js::number_to_string(serial));
        if !lines.iter().any(|line| matches!(line.get("id"), Val::Str(known) if *known == id)) {
            return id;
        }
        serial += 1.0;
    }
}

pub fn wall_line_of(line: &Val) -> WallLine {
    WallLine {
        id: String::new(),
        name: String::new(),
        owner: String::new(),
        level: js::to_number(line.get("level")),
        points: Vec::new(),
        at: Vec::new(),
        breaches: Vec::new(),
        wear: OrdMap::new(),
        building: line.get("building").clone(),
        changed: false,
    }
}

fn building_of(line: &Val, owner: &str, date: &str) -> bool {
    line.get("building").truthy() && fold(line.get("owner")) == fold(&Val::str(owner)) && !stands_on(&wall_line_of(line), date)
}

pub enum Applied {
    Refused(&'static str),
    Given { world: Val, line: Val },
    Built { world: Val, line: Val, days: f64 },
}

fn with_lines(world: &Val, lines: Vec<Val>) -> Val {
    let mut out = if world.is_nullish() { Obj::new() } else { js::spread(world) };
    out.set("fortifications", Val::Arr(lines));
    Val::Obj(out)
}

fn pairs(points: &[[f64; 2]]) -> Val {
    Val::Arr(points.iter().map(|point| Val::nums(point)).collect())
}

pub fn apply_fortify_op(world: &Val, op: &Val, player: &Val, date: &Val, holds: Option<Holds>) -> Applied {
    let kind = match op.get("op") {
        Val::Str(kind) if op.truthy() && FORTIFY_OPS.contains(&kind.as_str()) => kind.clone(),
        _ => return Applied::Refused(REFUSED_NOTHING),
    };
    let owner = clean(player, 120);
    if owner.is_empty() {
        return Applied::Refused(REFUSED_NOBODY);
    }
    let mut lines = normalize_fortifications(world.get("fortifications"));
    let today = clean(date, 40);
    if kind == "unfortify" {
        let id = clean(op.get("id"), 64);
        let at = match lines.iter().position(|entry| matches!(entry.get("id"), Val::Str(known) if *known == id) && building_of(entry, &owner, &today)) {
            Some(at) => at,
            None => return Applied::Refused(REFUSED_GONE),
        };
        let line = lines.remove(at);
        return Applied::Given { world: with_lines(world, lines), line };
    }
    if !war_settings_of(world).get("mechanics").get("walls").is_true() {
        return Applied::Refused(REFUSED_OFF);
    }
    if !op.get("owner").is_undef() && !clean(op.get("owner"), 200).is_empty() && fold(op.get("owner")) != fold(&Val::str(&owner)) {
        return Applied::Refused(REFUSED_OWNER);
    }
    let asked = js::to_number(op.get("level"));
    if op.get("level").is_nullish() || matches!(op.get("level"), Val::Str(text) if text.is_empty()) || !asked.is_finite() {
        return Applied::Refused(REFUSED_LEVEL);
    }
    let level = fortify_level_of(&Val::Num(asked));
    let points = fortify_line_of(op.get("points"));
    if points.len() < 2 {
        return Applied::Refused(REFUSED_LINE);
    }
    let cost = fortify_cost_for(world, &Val::str(&owner), &pairs(&points), &Val::Num(level));
    if !(cost.km >= FORTIFY_KM_LEAST) {
        return Applied::Refused(REFUSED_SHORT);
    }
    if cost.km > FORTIFY_KM_MOST {
        return Applied::Refused(REFUSED_LONG);
    }
    if add_game_days(&today, 1.0).is_empty() {
        return Applied::Refused(REFUSED_CALENDAR);
    }
    if lines.len() >= FORTIFICATIONS_MOST {
        return Applied::Refused(REFUSED_ROOM);
    }
    if lines.iter().filter(|entry| building_of(entry, &owner, &today)).count() >= FORTIFY_BUILDING_MOST {
        return Applied::Refused(REFUSED_BUSY);
    }
    let holds = match holds {
        Some(holds) => holds,
        None => return Applied::Refused(REFUSED_CHART),
    };
    let ground = ground_refusal(holds, &owner, &points, cost.km);
    if !ground.is_empty() {
        return Applied::Refused(ground);
    }
    let days = cost.days;
    let mut line = Obj::new();
    line.set("id", Val::Str(next_line_id(&lines)));
    line.set("name", Val::Str(clean(op.get("name"), NAME_MOST)));
    line.set("owner", Val::Str(owner));
    line.set("level", Val::Num(level));
    line.set("points", pairs(&points));
    line.set("breaches", Val::Arr(Vec::new()));
    line.set("wear", Val::Arr(Vec::new()));
    line.set("building", Val::obj([("since", Val::Str(today)), ("days", Val::Num(days))]));
    lines.push(Val::Obj(line));
    let fortifications = normalize_fortifications(&Val::Arr(lines));
    let line = fortifications.last().cloned().unwrap_or(Val::Undef);
    Applied::Built { world: with_lines(world, fortifications), line, days }
}

pub fn clean_fortify_op(op: &Val) -> Option<Val> {
    let kind = match op.get("op") {
        Val::Str(kind) if op.truthy() && FORTIFY_OPS.contains(&kind.as_str()) => kind.clone(),
        _ => return None,
    };
    if kind == "unfortify" {
        return Some(Val::obj([("op", Val::str("unfortify")), ("id", Val::Str(clean(op.get("id"), 64)))]));
    }
    let mut sent = Obj::new();
    sent.set("op", Val::str("fortify"));
    sent.set("points", pairs(&fortify_line_of(op.get("points"))));
    let level = js::to_number(op.get("level"));
    if !op.get("level").is_nullish() && !matches!(op.get("level"), Val::Str(text) if text.is_empty()) && level.is_finite() {
        sent.set("level", Val::Num(jsmath::round(level)));
    }
    if !op.get("name").is_undef() {
        sent.set("name", Val::Str(clean(op.get("name"), NAME_MOST)));
    }
    if !op.get("owner").is_undef() {
        sent.set("owner", Val::Str(clean(op.get("owner"), 120)));
    }
    Some(Val::Obj(sent))
}
