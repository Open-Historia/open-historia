use super::arena::Arena;
use super::battle::Battle;
use super::constants::MAX_SIDE_MEMBERS;
use super::frame::Bounds;
use super::js::{self, Val};
use super::swarms::block_steps;
use std::cmp::Ordering;

pub const HOME_MARGIN_KM: f64 = 150.0;
pub const HOME_JOIN_KM: f64 = 100.0;
pub const HOME_SUFFIX: &str = "home forces";

pub fn home_clean(value: &str) -> String {
    js::trim(&js::collapse_spaces(value)).to_string()
}

fn home_fold(value: &str) -> String {
    home_clean(value).to_lowercase()
}

pub fn home_name(country: &str) -> String {
    format!("{} {}", home_clean(country), HOME_SUFFIX)
}

pub fn home_bounds(regions: &[Val]) -> Option<Bounds> {
    let boxes: Vec<[f64; 4]> = regions
        .iter()
        .filter_map(|region| match region.get("bbox") {
            Val::Arr(list) if list.len() == 4 && list.iter().all(|item| matches!(item, Val::Num(n) if n.is_finite())) => Some([list[0].num(), list[1].num(), list[2].num(), list[3].num()]),
            _ => None,
        })
        .collect();
    if boxes.is_empty() {
        return None;
    }
    let mut middles: Vec<f64> = boxes.iter().map(|b| (b[0] + b[2]) / 2.0).collect();
    js::sort_numbers(&mut middles);
    let mut start = middles[0];
    let mut widest = middles[0] + 360.0 - middles[middles.len() - 1];
    for at in 1..middles.len() {
        if middles[at] - middles[at - 1] > widest {
            widest = middles[at] - middles[at - 1];
            start = middles[at];
        }
    }
    let mut west = f64::INFINITY;
    let mut east = f64::NEG_INFINITY;
    let mut south = f64::INFINITY;
    let mut north = f64::NEG_INFINITY;
    for b in &boxes {
        let shift = if (b[0] + b[2]) / 2.0 < start { 360.0 } else { 0.0 };
        if b[0] + shift < west {
            west = b[0] + shift;
        }
        if b[2] + shift > east {
            east = b[2] + shift;
        }
        if b[1] < south {
            south = b[1];
        }
        if b[3] > north {
            north = b[3];
        }
    }
    if west > 180.0 {
        west -= 360.0;
        east -= 360.0;
    }
    Some(Bounds { west, east: if east > 180.0 { east - 360.0 } else { east }, south, north })
}

pub fn home_neighbours(arena: &Arena, holder_of: impl Fn(&str) -> String, country: &str) -> Vec<String> {
    let mut cells: Vec<(String, f64)> = Vec::new();
    for region in 1..arena.ids.len() {
        let holder = home_clean(&holder_of(&arena.ids[region]));
        if holder.is_empty() || home_fold(&holder) == home_fold(country) || !(arena.cells[region] > 0) {
            continue;
        }
        match cells.iter_mut().find(|(name, _)| *name == holder) {
            Some((_, count)) => *count += arena.cells[region] as f64,
            None => cells.push((holder, arena.cells[region] as f64)),
        }
    }
    js::stable_sort_by(&mut cells, |a, b| {
        let by = b.1 - a.1;
        if by != 0.0 {
            by
        } else if js::compare_units(&a.0, &b.0) == Ordering::Less {
            -1.0
        } else {
            1.0
        }
    });
    cells.into_iter().take(MAX_SIDE_MEMBERS as usize).map(|(name, _)| name).collect()
}

struct Share {
    at: usize,
    whole: f64,
    part: f64,
}

pub fn home_cells(battle: &Battle, side: usize, mine: &dyn Fn(usize) -> bool, count: f64) -> Vec<i32> {
    let field = battle.field.as_ref().unwrap();
    let arena = &battle.arena;
    if count <= 0.0 {
        return Vec::new();
    }
    let _ = side;
    let cities: Vec<&super::arena::City> = arena.cities.iter().filter(|city| city.cell >= 0.0 && city.population > 0.0 && mine(city.cell as usize)).collect();
    let mut cells: Vec<i32> = Vec::new();
    if cities.is_empty() {
        let ground: Vec<i32> = (0..field.size).filter(|&cell| mine(cell)).map(|cell| cell as i32).collect();
        let mut at = 0.0;
        while at < count && !ground.is_empty() {
            cells.push(ground[(((at + 0.5) * ground.len() as f64) / count).floor() as usize]);
            at += 1.0;
        }
        return cells;
    }
    let people = cities.iter().fold(0.0, |sum, city| sum + city.population);
    let mut shares: Vec<Share> = cities.iter().enumerate().map(|(at, city)| Share { at, whole: ((count * city.population) / people).floor(), part: (count * city.population) / people }).collect();
    let mut left = count - shares.iter().fold(0.0, |sum, share| sum + share.whole);
    let mut order: Vec<usize> = (0..shares.len()).collect();
    js::stable_sort_by(&mut order, |&a, &b| {
        let by = (shares[b].part - shares[b].whole) - (shares[a].part - shares[a].whole);
        if by != 0.0 && !by.is_nan() {
            by
        } else {
            shares[a].at as f64 - shares[b].at as f64
        }
    });
    for index in order {
        if left <= 0.0 {
            break;
        }
        shares[index].whole += 1.0;
        left -= 1.0;
    }
    let cols = field.cols as i64;
    let rows = field.rows as i64;
    for share in &shares {
        if share.whole == 0.0 {
            continue;
        }
        let city = cities[share.at];
        let home = city.cell as i64;
        let col = home % cols;
        let row = home / cols;
        let mut placed = 0.0;
        for [dx, dy] in block_steps(share.whole * 4.0) {
            if placed >= share.whole {
                break;
            }
            let x = col + dx as i64;
            let y = row + dy as i64;
            if x < 0 || y < 0 || x >= cols || y >= rows {
                continue;
            }
            let cell = y * cols + x;
            if !mine(cell as usize) {
                continue;
            }
            cells.push(cell as i32);
            placed += 1.0;
        }
        while placed < share.whole {
            cells.push(home as i32);
            placed += 1.0;
        }
    }
    cells
}

pub fn border_cells(battle: &Battle, side: usize, theirs: &dyn Fn(usize) -> bool) -> Vec<i32> {
    let field = battle.field.as_ref().unwrap();
    let cols = field.cols as i64;
    let rows = field.rows as i64;
    let mut found = Vec::new();
    for cell in 0..field.size {
        if field.holders[cell] as usize != side || field.play[cell] != 1 {
            continue;
        }
        let col = cell as i64 % cols;
        let row = cell as i64 / cols;
        let mut beside = false;
        let mut dy = -1;
        while dy <= 1 && !beside {
            let mut dx = -1;
            while dx <= 1 && !beside {
                let x = col + dx;
                let y = row + dy;
                if (dx != 0 || dy != 0) && x >= 0 && y >= 0 && x < cols && y < rows && theirs((y * cols + x) as usize) {
                    beside = true;
                }
                dx += 1;
            }
            dy += 1;
        }
        if beside {
            found.push(cell as i32);
        }
    }
    found
}

pub fn way_into(battle: &Battle, side: usize, way: &[[f64; 2]], holder_at: &dyn Fn(usize) -> String) -> String {
    let field = battle.field.as_ref().unwrap();
    let (cols, rows) = (field.cols as f64, field.rows as f64);
    for leg in 1..way.len() {
        let [ax, ay] = way[leg - 1];
        let [bx, by] = way[leg];
        let length = ((bx - ax) * (bx - ax) + (by - ay) * (by - ay)).sqrt();
        let steps = crate::jsmath::max(1.0, (length * 2.0).ceil());
        let mut step = 0.0;
        while step <= steps {
            let x = ax + ((bx - ax) * step) / steps;
            let y = ay + ((by - ay) * step) / steps;
            step += 1.0;
            if !(x >= 0.0) || !(y >= 0.0) || x >= cols || y >= rows {
                continue;
            }
            let cell = (y.floor() * cols + x.floor()) as usize;
            if field.holders[cell] as usize == side {
                continue;
            }
            let holder = home_clean(&holder_at(cell));
            if !holder.is_empty() {
                return holder;
            }
        }
    }
    String::new()
}
