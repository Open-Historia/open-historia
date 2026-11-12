use super::fortify_cost::fortify_cost_reckoner;
use super::fortify_ops::{apply_fortify_op, wall_line_of, Applied, Holds};
use super::frame::{Frame, Projector};
use super::js::{self, Obj, Val};
use super::record::{frame_from, Holders};
use super::walls::stands_on;
use super::war_geography::normalize_fortifications;
use crate::jsmath;

pub const ENGINEER_OUTMATCHED: f64 = 0.8;
pub const ENGINEER_BEHIND_KM: f64 = 25.0;
pub const ENGINEER_KM_MOST: f64 = 300.0;
pub const ENGINEER_DAYS_MOST: f64 = 60.0;
pub const ENGINEER_LEVEL_MOST: f64 = 7.0;
pub const ENGINEER_KM_LEAST: f64 = 30.0;
const READ_EVERY: f64 = 2.0;

fn clean(value: &Val) -> String {
    let text = if value.is_nullish() { String::new() } else { js::to_string(value) };
    js::trim(&js::collapse_spaces(&text)).to_string()
}

fn fold(value: &Val) -> String {
    js::lower(&clean(value))
}

fn km_apart(place: &Projector, a: [f64; 2], b: [f64; 2]) -> f64 {
    let [ax, ay] = place.to_cell(a[0], a[1]);
    let [bx, by] = place.to_cell(b[0], b[1]);
    let km = place.km_at((ay + by) / 2.0);
    let dx = (ax - bx) * km;
    let dy = (ay - by) * km;
    (dx * dx + dy * dy).sqrt()
}

fn strict(value: &Val, side: f64) -> bool {
    matches!(value, Val::Num(n) if *n == side)
}

pub fn front_line_for(record: &Val, side: f64, behind_km: f64, most_km: f64) -> Vec<[f64; 2]> {
    let frame = record.get("frame");
    if !frame.truthy() || !(frame.get("cols").num() > 0.0) || !(frame.get("rows").num() > 0.0) {
        return Vec::new();
    }
    let frame: Frame = frame_from(frame);
    let place = Projector::of(&frame);
    let other = if side == 0.0 { 1.0 } else { 0.0 };
    let holders = Holders::of(record);
    let holder = |x: f64, y: f64| {
        let [lng, lat] = place.to_lng_lat(x, y);
        holders.at(lng, lat)
    };
    let scan = |along_rows: bool| -> Vec<[f64; 2]> {
        let outer = if along_rows { frame.rows } else { frame.cols };
        let inner = if along_rows { frame.cols } else { frame.rows };
        let mut points = Vec::new();
        let mut a = 0.5;
        while a < outer {
            let mut was = -1.0;
            let mut crossing: Option<(f64, f64)> = None;
            let mut b = 0.5;
            while b < inner {
                let here = if along_rows { holder(b, a) } else { holder(a, b) };
                if !strict(&here, side) && !strict(&here, other) {
                    b += 1.0;
                    continue;
                }
                let here = here.num();
                if was >= 0.0 && here != was {
                    crossing = Some((b, if was == side { -1.0 } else { 1.0 }));
                    break;
                }
                was = here;
                b += 1.0;
            }
            if let Some((at, back)) = crossing {
                let cells = behind_km / place.km_at(if along_rows { a } else { at });
                let b = at + back * cells;
                let (x, y) = if along_rows { (b, a) } else { (a, b) };
                if !(x < 0.0 || y < 0.0 || x >= frame.cols || y >= frame.rows || !strict(&holder(x, y), side)) {
                    points.push(place.to_lng_lat(x, y));
                }
            }
            a += READ_EVERY;
        }
        points
    };
    let rows = scan(true);
    let cols = scan(false);
    let points = if rows.len() >= cols.len() { rows } else { cols };
    if points.len() < 2 {
        return Vec::new();
    }
    let gap = 4.0 * READ_EVERY * frame.km;
    let mut runs: Vec<Vec<[f64; 2]>> = vec![vec![points[0]]];
    for at in 1..points.len() {
        if km_apart(&place, points[at - 1], points[at]) > gap {
            runs.push(Vec::new());
        }
        runs.last_mut().unwrap().push(points[at]);
    }
    let mut longest = runs[0].clone();
    for run in &runs {
        if run.len() > longest.len() {
            longest = run.clone();
        }
    }
    if longest.len() < 2 {
        return Vec::new();
    }
    let length_of = |run: &[[f64; 2]]| run.windows(2).fold(0.0, |sum, pair| sum + km_apart(&place, pair[0], pair[1]));
    while longest.len() > 2 && length_of(&longest) > most_km {
        longest = longest[1..longest.len() - 1].to_vec();
    }
    longest.iter().map(|&[lng, lat]| [jsmath::round(lng * 10000.0) / 10000.0, jsmath::round(lat * 10000.0) / 10000.0]).collect()
}

fn strength_of(record: &Val, side: usize) -> f64 {
    let told = match record.get("brief").get("strength") {
        Val::Arr(list) => list.get(side).cloned().unwrap_or(Val::Undef),
        _ => Val::Undef,
    };
    js::or_zero(js::to_number(told.get("n"))) * js::or_zero(js::to_number(told.get("pct")))
}

#[derive(Clone, Debug, PartialEq)]
pub struct Built {
    pub owner: String,
    pub battlefield: String,
    pub level: f64,
    pub km: f64,
    pub days: f64,
}

fn pairs(points: &[[f64; 2]]) -> Val {
    Val::Arr(points.iter().map(|point| Val::nums(point)).collect())
}

pub fn engineer_lines(world: &Val, players: &Val, date: &Val, holds: Option<Holds>) -> (Val, Vec<Built>) {
    let played: Vec<String> = players.array_or_empty().iter().map(fold).collect();
    let mut built = Vec::new();
    let mut next = world.clone();
    let day = if date.is_nullish() { String::new() } else { js::to_string(date) };
    let building = |next: &Val, owner: &Val| normalize_fortifications(next.get("fortifications")).iter().any(|line| fold(line.get("owner")) == fold(owner) && line.get("building").truthy() && !stands_on(&wall_line_of(line), &day));
    for record in world.get("battlefields").array_or_empty() {
        if !record.truthy() || !matches!(record.get("status"), Val::Str(status) if status == "active") {
            continue;
        }
        for side in 0..2 {
            let mine = strength_of(record, side);
            let theirs = strength_of(record, 1 - side);
            if !(theirs > 0.0) || mine >= ENGINEER_OUTMATCHED * theirs {
                continue;
            }
            let members = match record.get("sides") {
                Val::Arr(list) => list.get(side).cloned().unwrap_or(Val::Undef),
                _ => Val::Undef,
            };
            let members = members.array_or_empty();
            let owner = match members.iter().find(|name| !clean(name).is_empty() && !played.contains(&fold(name))) {
                Some(owner) => owner.clone(),
                None => continue,
            };
            if played.contains(&fold(members.first().unwrap_or(&Val::Undef))) || building(&next, &owner) {
                continue;
            }
            let mut points = front_line_for(record, side as f64, ENGINEER_BEHIND_KM, ENGINEER_KM_MOST);
            let mut placed = false;
            let cost_of = fortify_cost_reckoner(&next, &owner);
            while !placed && points.len() >= 2 {
                let mut fits = 0.0;
                let mut level = ENGINEER_LEVEL_MOST;
                while level >= 3.0 {
                    if cost_of.cost(&pairs(&points), &Val::Num(level)).days <= ENGINEER_DAYS_MOST {
                        fits = level;
                        break;
                    }
                    level -= 1.0;
                }
                if fits == 0.0 {
                    if points.len() <= 2 || cost_of.cost(&pairs(&points), &Val::Num(3.0)).km <= ENGINEER_KM_LEAST {
                        break;
                    }
                    points = points[1..points.len() - 1].to_vec();
                    continue;
                }
                let cost = cost_of.cost(&pairs(&points), &Val::Num(fits));
                let mut op = Obj::new();
                op.set("op", Val::str("fortify"));
                op.set("points", pairs(&points));
                op.set("level", Val::Num(fits));
                op.set("name", Val::Str(format!("{} line before {}", clean(&owner), clean(record.get("name")))));
                if let Applied::Built { world: made, days, .. } = apply_fortify_op(&next, &Val::Obj(op), &owner, date, holds) {
                    next = made;
                    built.push(Built { owner: clean(&owner), battlefield: clean(record.get("name")), level: fits, km: jsmath::round(cost.km), days });
                }
                placed = true;
            }
        }
    }
    (next, built)
}
