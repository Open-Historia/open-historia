use super::js::{self, Obj, Val};
use super::war_settings::is_record;
use crate::jsmath;

pub const WALL_LEVEL_LEAST: f64 = 3.0;
pub const WALL_LEVEL_MOST: f64 = 10.0;
pub const FORTIFICATIONS_MOST: usize = 200;
const POINTS_MOST: usize = 2000;
const NAME_MOST: usize = 80;

fn clean(value: &Val, most: usize) -> String {
    let text = if value.is_nullish() { String::new() } else { js::to_string(value) };
    js::slice_units(js::trim(&js::collapse_spaces(&text)), 0, most)
}

fn round(value: f64, places: f64) -> f64 {
    jsmath::round(value * places) / places
}

fn number_in(value: &Val, least: f64, most: f64) -> Option<f64> {
    if value.is_nullish() || matches!(value, Val::Str(text) if text.is_empty()) {
        return None;
    }
    let number = js::to_number(value);
    if number.is_finite() {
        Some(if number < least {
            least
        } else if number > most {
            most
        } else {
            number
        })
    } else {
        None
    }
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
    Some([round(lng, 1e5), round(lat, 1e5)])
}

fn line_of(value: &Val, least: usize) -> Option<Vec<[f64; 2]>> {
    let points: Vec<[f64; 2]> = value.array_or_empty().iter().filter_map(point_of).take(POINTS_MOST).collect();
    if points.len() >= least {
        Some(points)
    } else {
        None
    }
}

fn id_of(value: &Val, fallback: String) -> String {
    let id = clean(value, 64);
    if id.is_empty() {
        fallback
    } else {
        id
    }
}

fn stretches_of(value: &Val) -> Vec<[f64; 2]> {
    let mut stretches: Vec<[f64; 2]> = value
        .array_or_empty()
        .iter()
        .filter_map(|entry| entry.as_array().map(|_| [js::to_number(entry.at(0)), js::to_number(entry.at(1))]))
        .filter(|entry| entry[0].is_finite() && entry[1].is_finite() && entry[1] > entry[0] && entry[0] >= 0.0)
        .collect();
    js::stable_sort_by(&mut stretches, |a, b| a[0] - b[0]);
    let mut merged: Vec<[f64; 2]> = Vec::new();
    for [from, to] in stretches {
        match merged.last_mut() {
            Some(last) if from <= last[1] => last[1] = jsmath::max(last[1], to),
            _ => merged.push([from, to]),
        }
    }
    merged.into_iter().take(200).map(|[from, to]| [round(from, 100.0), round(to, 100.0)]).collect()
}

fn pairs(list: &[[f64; 2]]) -> Val {
    Val::Arr(list.iter().map(|pair| Val::nums(pair)).collect())
}

pub fn normalize_fortifications(value: &Val) -> Vec<Val> {
    value
        .array_or_empty()
        .iter()
        .enumerate()
        .filter_map(|(at, wall)| {
            if !wall.truthy() || !is_record(wall) {
                return None;
            }
            let points = line_of(wall.get("points"), 2)?;
            let since = clean(wall.get("building").get("since"), 40);
            let days = number_in(wall.get("building").get("days"), 0.0, 36500.0);
            let wear: Vec<[f64; 2]> = wall
                .get("wear")
                .array_or_empty()
                .iter()
                .filter_map(|entry| entry.as_array().map(|_| (js::to_number(entry.at(0)).floor(), number_in(entry.at(1), 0.0, 1.0))))
                .filter(|(piece, worn)| *piece >= 0.0 && worn.map(|worn| worn > 0.0).unwrap_or(false))
                .take(2000)
                .map(|(piece, worn)| [piece, round(worn.unwrap(), 1000.0)])
                .collect();
            let mut out = Obj::new();
            out.set("id", Val::Str(id_of(wall.get("id"), format!("wall-{}", at + 1))));
            out.set("name", Val::Str(clean(wall.get("name"), NAME_MOST)));
            out.set("owner", Val::Str(clean(wall.get("owner"), NAME_MOST)));
            out.set("level", Val::Num(jsmath::round(number_in(wall.get("level"), WALL_LEVEL_LEAST, WALL_LEVEL_MOST).unwrap_or(5.0))));
            out.set("points", pairs(&points));
            out.set("breaches", pairs(&stretches_of(wall.get("breaches"))));
            out.set("wear", pairs(&wear));
            if let (false, Some(days)) = (since.is_empty(), days) {
                out.set("building", Val::obj([("since", Val::Str(since)), ("days", Val::Num(jsmath::round(days)))]));
            }
            Some(Val::Obj(out))
        })
        .take(FORTIFICATIONS_MOST)
        .collect()
}
