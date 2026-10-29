use super::battle::Battle;
use super::constants::*;
use super::ground::{cell_at, distance_from, downhill, nearest_of, FAR_THIRDS};
use super::js::{OrdMap, Val};
use super::troops::{is_live, or_else, Troop, KIND_ARTILLERY};
use crate::jsmath;

#[derive(Clone, Debug, PartialEq)]
pub struct Pocket {
    pub s: usize,
    pub cell: f64,
    pub days: f64,
    pub km2: f64,
    pub cells: Option<f64>,
    pub cx: Option<f64>,
    pub cy: Option<f64>,
    pub siege: String,
    pub told: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Prey {
    pub id: usize,
    pub km2: f64,
    pub cx: f64,
    pub cy: f64,
    pub cells: f64,
    pub inside: Vec<usize>,
    pub held: f64,
    pub needed: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Books {
    pub size: usize,
    pub key: String,
    pub squeezed: [Vec<u8>; 2],
    pub was: [Vec<u8>; 2],
    pub prey: [Vec<u8>; 2],
    pub to_prey: [Vec<i32>; 2],
    pub prey_near: [Vec<i32>; 2],
    pub to_supplied: [Vec<i32>; 2],
    pub pockets: [Vec<Prey>; 2],
    pub cut: [bool; 2],
    pub grip: Vec<i32>,
    pub to_taken: Vec<i32>,
    pub part: Vec<i32>,
    pub steps: Vec<i32>,
    pub label: Vec<i32>,
}

impl Books {
    pub fn new(size: usize) -> Self {
        Books {
            size,
            key: String::new(),
            squeezed: [vec![0; size], vec![0; size]],
            was: [vec![0; size], vec![0; size]],
            prey: [vec![0; size], vec![0; size]],
            to_prey: [vec![0; size], vec![0; size]],
            prey_near: [vec![-1; size], vec![-1; size]],
            to_supplied: [vec![0; size], vec![0; size]],
            pockets: [Vec::new(), Vec::new()],
            cut: [false, false],
            grip: vec![0; size],
            to_taken: vec![0; size],
            part: vec![0; size],
            steps: vec![0; size],
            label: vec![0; size],
        }
    }
}

pub fn live_order(troop: &Troop) -> Option<&Val> {
    if troop.order.truthy() && !troop.order.get("done").truthy() {
        Some(&troop.order)
    } else {
        None
    }
}

fn kind_is(order: Option<&Val>, kinds: &[&str]) -> bool {
    matches!(order.map(|order| order.get("kind")), Some(Val::Str(kind)) if kinds.contains(&kind.as_str()))
}

fn spared_cell(battle: &Battle, side: usize, cell: usize) -> bool {
    if let Some(kept) = &battle.kept[side] {
        if kept.get(cell) == Some(&1) {
            return true;
        }
    }
    let discs = &battle.spared[side];
    let cols = battle.field.as_ref().unwrap().cols;
    let x = (cell % cols) as f64 + 0.5;
    let y = (cell / cols) as f64 + 0.5;
    let disc = |at: usize| discs.get(at).copied().unwrap_or(f64::NAN);
    let mut at = 0;
    while at < discs.len() {
        if (x - disc(at)) * (x - disc(at)) + (y - disc(at + 1)) * (y - disc(at + 1)) <= disc(at + 2) * disc(at + 2) {
            return true;
        }
        at += 3;
    }
    false
}

fn books_of(battle: &mut Battle) -> &mut Books {
    let size = battle.field.as_ref().unwrap().size;
    if !battle.close.as_ref().is_some_and(|books| books.size == size) {
        battle.close = Some(Books::new(size));
    }
    battle.close.as_mut().unwrap()
}

fn squeeze(battle: &Battle, books: &mut Books, side: usize) {
    let field = battle.field.as_ref().unwrap();
    let place = &battle.place;
    let (cols, rows, size) = (field.cols, field.rows, field.size);
    let holders = &field.holders;
    let other = 1 - side;
    let cell_km = battle.frame.km;
    let neck = (GRIP_KM * 3.0) / cell_km;
    let fed = battle.fed.as_ref().unwrap();
    let homes = battle.homes.as_ref().unwrap();
    let home = |cell: usize| homes.get(cell).map(|&home| home as f64).unwrap_or(f64::NAN);
    let body_of = battle.body_of.as_ref().unwrap();
    let squeezed_now = books.squeezed[side].clone();
    books.was[side].copy_from_slice(&squeezed_now);
    books.squeezed[side].fill(0);
    {
        let was_other = &books.was[other];
        distance_from(cols, rows, |cell| holders[cell] as usize == other && fed[other][cell] == 1 && was_other[cell] == 0, &mut books.grip);
    }
    distance_from(cols, rows, |cell| holders[cell] as usize == other && home(cell) != other as f64, &mut books.to_taken);
    let fed_mine = &fed[side];
    let grip = &books.grip;
    let to_taken = &books.to_taken;
    let part = &mut books.part;
    let steps = &mut books.steps;
    let neighbours = |cell: usize| -> [i64; 4] {
        let col = cell % cols;
        [
            if col > 0 { cell as i64 - 1 } else { -1 },
            if col < cols - 1 { cell as i64 + 1 } else { -1 },
            if cell >= cols { (cell - cols) as i64 } else { -1 },
            if cell + cols < size { (cell + cols) as i64 } else { -1 },
        ]
    };
    part.fill(-1);
    let mut parts: Vec<(usize, i32, usize)> = Vec::new();
    let mut queue: Vec<usize> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    for start in 0..size {
        if holders[start] as usize != side || fed_mine[start] != 1 || grip[start] as f64 <= neck || part[start] >= 0 {
            continue;
        }
        let id = parts.len();
        let mut count = 0;
        part[start] = id as i32;
        stack.push(start);
        while let Some(cell) = stack.pop() {
            count += 1;
            steps[cell] = 0;
            queue.push(cell);
            for next in neighbours(cell) {
                if next < 0 {
                    continue;
                }
                let next = next as usize;
                if part[next] >= 0 || holders[next] as usize != side || fed_mine[next] != 1 || grip[next] as f64 <= neck {
                    continue;
                }
                part[next] = id as i32;
                stack.push(next);
            }
        }
        parts.push((id, body_of[side][start], count));
    }
    let mut body: OrdMap<i32, usize> = OrdMap::new();
    for &(id, piece, count) in &parts {
        let larger = match body.get(&piece) {
            Some(&known) => count > parts[known].2,
            None => true,
        };
        if larger {
            body.set(piece, id);
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let cell = queue[head];
        head += 1;
        for next in neighbours(cell) {
            if next < 0 {
                continue;
            }
            let next = next as usize;
            if part[next] >= 0 || holders[next] as usize != side || fed_mine[next] != 1 {
                continue;
            }
            part[next] = part[cell];
            steps[next] = steps[cell] + 1;
            queue.push(next);
        }
    }
    let strand = STRAND_KM / cell_km;
    let hanging = &mut books.label;
    hanging.fill(0);
    let mut any = false;
    for &cell in &queue {
        let (id, piece, _) = parts[part[cell] as usize];
        if body.get(&piece) != Some(&id) || (grip[cell] as f64 <= neck && steps[cell] as f64 > strand) {
            hanging[cell] = 1;
            any = true;
        }
    }
    if !any {
        return;
    }
    let mut standing: OrdMap<i64, [f64; 2]> = OrdMap::new();
    for troop in &battle.troops[side] {
        if !is_live(troop) {
            continue;
        }
        let here = cell_at(field, troop.x, troop.y);
        if here < 0 || hanging[here as usize] != 1 {
            continue;
        }
        let order = live_order(troop);
        let mut entry = standing.get(&here).copied().unwrap_or([0.0, 0.0]);
        entry[if order.is_some() && !kind_is(order, &["breakout", "fallback", "withdraw"]) { 1 } else { 0 }] += 1.0;
        standing.set(here, entry);
    }
    let near = (SQUEEZED_NEAR_KM * 3.0) / cell_km;
    let mut squeezed_cells: Vec<usize> = Vec::new();
    for &start in &queue {
        if hanging[start] != 1 {
            continue;
        }
        let mut cells: Vec<usize> = Vec::new();
        let (mut taken, mut gripped, mut holding, mut attacking, mut km2) = (0.0, 0.0, 0.0, 0.0, 0.0);
        hanging[start] = 2;
        stack.push(start);
        while let Some(cell) = stack.pop() {
            cells.push(cell);
            let row_km = place.row_km.get(cell / cols).copied().unwrap_or(f64::NAN);
            km2 += row_km * row_km;
            if home(cell) != side as f64 {
                taken += 1.0;
            }
            if to_taken[cell] as f64 <= near {
                gripped += 1.0;
            }
            if let Some(there) = standing.get(&(cell as i64)) {
                holding += there[0];
                attacking += there[1];
            }
            for next in neighbours(cell) {
                if next < 0 || hanging[next as usize] != 1 {
                    continue;
                }
                hanging[next as usize] = 2;
                stack.push(next as usize);
            }
        }
        let length = cells.len() as f64;
        if km2 < SQUEEZED_MIN_KM2 || (taken < length * SQUEEZED_TAKEN && gripped < length * SQUEEZED_NEAR) {
            continue;
        }
        if attacking > 0.0 && attacking >= holding {
            continue;
        }
        for cell in cells {
            if !spared_cell(battle, other, cell) {
                squeezed_cells.push(cell);
            }
        }
    }
    for cell in squeezed_cells {
        books.squeezed[side][cell] = 1;
    }
}

pub fn find_prey(battle: &mut Battle) {
    let (cols, rows, size, turns) = {
        let field = battle.field.as_ref().unwrap();
        (field.cols, field.rows, field.size, field.turns)
    };
    books_of(battle);
    if !battle.taken_for || battle.taken_turns != Some(turns) {
        let field = battle.field.as_ref().unwrap();
        let homes = battle.homes.as_ref().unwrap();
        let mut taken = 0.0;
        for cell in 0..size {
            let holder = field.holders[cell] as f64;
            let home = homes.get(cell).map(|&home| home as f64).unwrap_or(f64::NAN);
            if holder <= HOLDER_SIDE_B && home != holder && home <= HOLDER_SIDE_B {
                taken += 1.0;
            }
        }
        battle.taken_cells = taken;
        battle.taken_for = true;
        battle.taken_turns = Some(turns);
    }
    let quiet = battle.taken_cells == 0.0 && battle.pockets.is_empty();
    let mut books = battle.close.take().unwrap();
    for side in 0..2 {
        if quiet {
            if books.key != "quiet" {
                books.squeezed[side].fill(0);
                books.was[side].fill(0);
            }
        } else {
            squeeze(battle, &mut books, side);
        }
    }
    {
        let field = battle.field.as_ref().unwrap();
        for side in 0..2 {
            for troop in battle.troops[side].iter_mut() {
                let here = if is_live(troop) { cell_at(field, troop.x, troop.y) } else { -1 };
                troop.squeezed = here >= 0 && books.squeezed[side][here as usize] == 1;
                if troop.squeezed {
                    troop.pocket = true;
                }
            }
        }
    }
    if quiet && books.key == "quiet" {
        battle.close = Some(books);
        return;
    }
    books.key = if quiet { "quiet".to_string() } else { String::new() };
    let field = battle.field.as_ref().unwrap();
    let holders = &field.holders;
    let place = &battle.place;
    for side in 0..2 {
        let other = 1 - side;
        let mut prey = std::mem::take(&mut books.prey[side]);
        prey.fill(0);
        let mut any = false;
        if !quiet {
            for cell in 0..size {
                if holders[cell] as usize != other {
                    continue;
                }
                let pocket = battle.pocket_of.as_ref().map(|pocket_of| pocket_of[other][cell]).unwrap_or(-1);
                if (pocket >= 0 && battle.pockets[pocket as usize].siege.is_empty()) || (books.squeezed[other][cell] == 1 && !spared_cell(battle, side, cell)) {
                    prey[cell] = 1;
                    any = true;
                }
            }
        }
        let label = &mut books.label;
        label.fill(-1);
        let mut pockets: Vec<Prey> = Vec::new();
        let mut stack: Vec<usize> = Vec::new();
        if any {
            for start in 0..size {
                if prey[start] != 1 || label[start] >= 0 {
                    continue;
                }
                let mut pocket = Prey { id: pockets.len(), km2: 0.0, cx: 0.0, cy: 0.0, cells: 0.0, inside: Vec::new(), held: 0.0, needed: 0.0 };
                label[start] = pocket.id as i32;
                stack.push(start);
                while let Some(cell) = stack.pop() {
                    let col = cell % cols;
                    let row = (cell - col) / cols;
                    pocket.cells += 1.0;
                    let row_km = place.row_km.get(row).copied().unwrap_or(f64::NAN);
                    pocket.km2 += row_km * row_km;
                    pocket.cx += col as f64 + 0.5;
                    pocket.cy += row as f64 + 0.5;
                    let around = [if col > 0 { cell as i64 - 1 } else { -1 }, if col < cols - 1 { cell as i64 + 1 } else { -1 }, cell as i64 - cols as i64, (cell + cols) as i64];
                    for next in around {
                        if next < 0 || next >= size as i64 || prey[next as usize] != 1 || label[next as usize] >= 0 {
                            continue;
                        }
                        label[next as usize] = pocket.id as i32;
                        stack.push(next as usize);
                    }
                }
                pocket.cx /= pocket.cells;
                pocket.cy /= pocket.cells;
                pockets.push(pocket);
            }
        }
        for (index, troop) in battle.troops[other].iter().enumerate() {
            let at = if is_live(troop) { cell_at(field, troop.x, troop.y) } else { -1 };
            if at < 0 || label[at as usize] < 0 {
                continue;
            }
            let pocket = &mut pockets[label[at as usize] as usize];
            pocket.inside.push(index);
            pocket.held += troop.strength;
        }
        for pocket in pockets.iter_mut() {
            let rim = 2.0 * (std::f64::consts::PI * pocket.km2).sqrt();
            pocket.needed = jsmath::max(CLOSE_LEAST, jsmath::min(CLOSE_MOST, (rim / CLOSE_RIM_KM).ceil() + (pocket.held / CLOSE_STRENGTH).ceil()));
        }
        let found = !pockets.is_empty();
        books.pockets[side] = pockets;
        if found {
            nearest_of(cols, rows, &books.label, &mut books.to_prey[side], &mut books.prey_near[side]);
        } else {
            books.to_prey[side].fill(FAR_THIRDS);
            books.prey_near[side].fill(-1);
        }
        books.prey[side] = prey;
    }
    for side in 0..2 {
        books.cut[side] = battle.troops[side].iter().any(|troop| is_live(troop) && troop.pocket);
        if books.cut[side] {
            let fed = battle.fed.as_ref().unwrap();
            let squeezed = &books.squeezed[side];
            distance_from(cols, rows, |cell| holders[cell] as usize == side && fed[side][cell] == 1 && squeezed[cell] == 0, &mut books.to_supplied[side]);
        }
    }
    battle.close = Some(books);
}

fn on_siege_ring(battle: &Battle, side: usize, troop: &Troop) -> bool {
    for siege in &battle.sieges {
        if !matches!(siege.get("by"), Val::Num(by) if *by == side as f64) {
            continue;
        }
        let (x, y) = (siege.get("x").num(), siege.get("y").num());
        let reach = (SIEGE_SPARE_KM + 3.0 * battle.radius_km[side]) / battle.place.km_at(y);
        if (troop.x - x) * (troop.x - x) + (troop.y - y) * (troop.y - y) <= reach * reach {
            return true;
        }
    }
    false
}

struct Near {
    index: usize,
    toward: [f64; 2],
    turn: u8,
    order: Val,
    bearing: [f64; 2],
    key: f64,
}

pub fn draw_in(battle: &mut Battle, side: usize, day: f64) {
    let books = battle.close.take().unwrap();
    let cell_km = battle.frame.km;
    let mut heading = [0.0, 0.0];
    for pocket in &books.pockets[side] {
        let mut near: Vec<Near> = Vec::new();
        let mut already = 0.0;
        let mut bearings: Vec<[f64; 2]> = Vec::new();
        let bearing_of = |troop: &Troop| {
            let dx = troop.x - pocket.cx;
            let dy = troop.y - pocket.cy;
            let length = (dx * dx + dy * dy).sqrt();
            if length > 0.0 {
                [dx / length, dy / length]
            } else {
                [0.0, 0.0]
            }
        };
        {
            let field = battle.field.as_ref().unwrap();
            for (index, troop) in battle.troops[side].iter().enumerate() {
                if !is_live(troop) || troop.kind == KIND_ARTILLERY || troop.pocket {
                    continue;
                }
                let cell = cell_at(field, troop.x, troop.y);
                if cell < 0 || books.prey_near[side][cell as usize] != pocket.id as i32 {
                    continue;
                }
                let left = (books.to_prey[side][cell as usize] as f64 / 3.0) * cell_km;
                let order = live_order(troop);
                if kind_is(order, &["reduce"]) {
                    already += 1.0;
                    bearings.push(bearing_of(troop));
                    continue;
                }
                if troop.dug || troop.strength < CLOSE_UNDER_STRENGTH || troop.rested > day {
                    continue;
                }
                if kind_is(order, &["assault", "fallback", "withdraw"]) {
                    continue;
                }
                if on_siege_ring(battle, side, troop) {
                    continue;
                }
                let live = if order.is_some() { 1 } else { 0 };
                let beside = left <= CLOSE_NEAR_KM[live];
                if !beside && left > CLOSE_FAR_KM[live] {
                    continue;
                }
                let toward = if left > 0.5 * cell_km && downhill(field, &books.to_prey[side], troop.x, troop.y, &mut heading) { heading } else { [troop.hx, troop.hy] };
                let facing = toward[0] * troop.hx + toward[1] * troop.hy;
                let turn = if order.is_none() {
                    0
                } else if facing >= -0.3 {
                    1
                } else {
                    2
                };
                if order.is_some() && facing < 0.5 && pocket.inside.is_empty() {
                    continue;
                }
                let weight = if turn == 0 {
                    0.8
                } else if turn == 1 {
                    1.0
                } else {
                    1.6
                };
                near.push(Near { index, toward, turn, order: order.cloned().unwrap_or(Val::Null), bearing: bearing_of(troop), key: (if beside { 0.0 } else { 1e6 }) + left * weight });
            }
        }
        let mut order_of: Vec<usize> = (0..near.len()).collect();
        crate::sim::js::stable_sort_by(&mut order_of, |&a, &b| or_else(near[a].key - near[b].key, || near[a].index as f64 - near[b].index as f64));
        let apart = CLOSE_APART_COS[(jsmath::max(CLOSE_LEAST, jsmath::min(CLOSE_MOST, pocket.needed)) - CLOSE_LEAST) as usize];
        let mut fresh: Vec<usize> = Vec::new();
        let mut crowding: Vec<usize> = Vec::new();
        for &at in &order_of {
            let entry = &near[at];
            let crowded = bearings.iter().any(|taken| taken[0] * entry.bearing[0] + taken[1] * entry.bearing[1] > apart)
                || fresh.iter().any(|&taken| near[taken].bearing[0] * entry.bearing[0] + near[taken].bearing[1] * entry.bearing[1] > apart);
            if crowded {
                crowding.push(at);
            } else {
                fresh.push(at);
            }
        }
        for at in fresh.into_iter().chain(crowding) {
            if already >= pocket.needed {
                break;
            }
            let entry = &near[at];
            let troop = &mut battle.troops[side][entry.index];
            troop.order = Val::obj([("kind", Val::str("reduce")), ("since", Val::Num(day)), ("day", Val::Num(day)), ("resume", entry.order.clone()), ("entered", Val::Bool(false))]);
            let mut hx = if entry.turn == 1 { troop.hx + 2.0 * entry.toward[0] } else { entry.toward[0] };
            let mut hy = if entry.turn == 1 { troop.hy + 2.0 * entry.toward[1] } else { entry.toward[1] };
            let length = (hx * hx + hy * hy).sqrt();
            if length > 0.0 {
                hx /= length;
                hy /= length;
                troop.hx = hx;
                troop.hy = hy;
            }
            troop.fallback = Val::Null;
            already += 1.0;
        }
    }
    battle.close = Some(books);
}
