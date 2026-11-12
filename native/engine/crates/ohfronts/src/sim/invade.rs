use super::arena::Arena;
use super::constants::{MAX_ORDER_ATTACKS, ROUTE_INTO_KM};
use super::frame::Projector;
use super::js::{self, fold_text, Val};
use std::collections::HashMap;

fn clean(value: &Val) -> String {
    js::trim(&js::collapse_spaces(&value.string_or_empty())).to_string()
}

pub fn others_on_way<H, W>(arena: &Arena, place: &Projector, way: &[[f64; 2]], mut holder_of: H, mut in_war: W) -> Vec<String>
where
    H: FnMut(&str) -> Val,
    W: FnMut(&str) -> bool,
{
    if way.len() < 2 {
        return Vec::new();
    }
    let (cols, rows) = (arena.cols as f64, arena.rows as f64);
    let mut holders: HashMap<usize, String> = HashMap::new();
    let mut inside: Vec<(String, String, f64)> = Vec::new();
    for leg in 0..way.len() - 1 {
        let [ax, ay] = way[leg];
        let [bx, by] = way[leg + 1];
        let length = ((bx - ax) * (bx - ax) + (by - ay) * (by - ay)).sqrt();
        if !(length > 0.0) {
            continue;
        }
        let steps = crate::jsmath::max(1.0, (length * 2.0).ceil());
        let mut step = 0.0;
        while step < steps {
            let x = ax + ((bx - ax) * (step + 0.5)) / steps;
            let y = ay + ((by - ay) * (step + 0.5)) / steps;
            step += 1.0;
            if !(x >= 0.0) || !(y >= 0.0) || x >= cols || y >= rows {
                continue;
            }
            let index = arena.region[(y.floor() * cols + x.floor()) as usize] as usize;
            if index == 0 {
                continue;
            }
            if !arena.region_speed.is_empty() && !(arena.region_speed.get(index).copied().unwrap_or(f64::NAN) > 0.0) {
                continue;
            }
            let name = holders
                .entry(index)
                .or_insert_with(|| {
                    let held = holder_of(arena.ids.get(index).map(|id| id.as_str()).unwrap_or(""));
                    clean(&held)
                })
                .clone();
            if name.is_empty() || in_war(&name) {
                continue;
            }
            let key = fold_text(&name);
            let gained = (length / steps) * place.km_at(y);
            match inside.iter_mut().find(|(known, _, _)| *known == key) {
                Some(entry) => entry.2 += gained,
                None => inside.push((key, name, gained)),
            }
        }
    }
    inside.into_iter().filter(|(_, _, km)| *km >= ROUTE_INTO_KM).take(MAX_ORDER_ATTACKS as usize).map(|(_, name, _)| name).collect()
}

pub fn read_attacks(value: &Val) -> Vec<String> {
    let mut kept: Vec<String> = Vec::new();
    for raw in value.array_or_empty() {
        let name = js::trim(&js::slice_units(&clean(raw), 0, 120)).to_string();
        if name.is_empty() || kept.iter().any(|entry| fold_text(entry) == fold_text(&name)) {
            continue;
        }
        kept.push(name);
        if kept.len() as f64 >= MAX_ORDER_ATTACKS {
            break;
        }
    }
    kept
}

pub fn land_within<F: Fn(usize) -> bool>(arena: &Arena, held: F, x: f64, y: f64, reach: f64) -> bool {
    let (cols, rows) = (arena.cols as i64, arena.rows as i64);
    let span = reach.ceil() as i64;
    let col = x.floor() as i64;
    let row = y.floor() as i64;
    for dy in -span..=span {
        let at = row + dy;
        if at < 0 || at >= rows {
            continue;
        }
        for dx in -span..=span {
            let across = col + dx;
            if across < 0 || across >= cols || ((dx * dx + dy * dy) as f64) > reach * reach {
                continue;
            }
            if held(arena.region[(at * cols + across) as usize] as usize) {
                return true;
            }
        }
    }
    false
}
