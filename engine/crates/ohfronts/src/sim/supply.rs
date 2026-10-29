use super::battle::{Battle, HomePieces};
use super::closing::Pocket;
use super::constants::*;
use super::field::{bodies_of, own_cell, take_cells, Bodies, Painter};
use super::ground::distance_from;
use super::js::Val;
use super::sectors::describe_point;
use super::troops::{is_live, Troop};
use super::walls::kept_with;
use std::collections::HashMap;
use std::rc::Rc;

fn cell_of(cols: usize, rows: usize, x: f64, y: f64) -> i64 {
    if x >= 0.0 && y >= 0.0 && x < cols as f64 && y < rows as f64 {
        (y.floor() * cols as f64 + x.floor()) as i64
    } else {
        -1
    }
}

pub fn nearest_of(troops: &[Troop], cols: usize, cell: usize) -> f64 {
    let x = (cell % cols) as f64 + 0.5;
    let y = (cell / cols) as f64 + 0.5;
    let mut best = f64::INFINITY;
    let mut owner = 0.0;
    for troop in troops {
        if !is_live(troop) {
            continue;
        }
        let dx = troop.x - x;
        let dy = troop.y - y;
        if dx * dx + dy * dy < best {
            best = dx * dx + dy * dy;
            owner = troop.owner;
        }
    }
    owner
}

pub fn nearest_owner(battle: &Battle, side: usize, cell: usize) -> f64 {
    nearest_of(&battle.troops[side], battle.field.as_ref().unwrap().cols, cell)
}

fn home_pieces(battle: &mut Battle, side: usize) -> Rc<HomePieces> {
    let field = battle.field.as_ref().unwrap();
    if let Some(known) = &battle.home_pieces[side] {
        if known.size == field.size {
            return known.clone();
        }
    }
    let (cols, rows, size) = (field.cols, field.rows, field.size);
    let region = &battle.arena.region;
    let home_side = battle.home_side.as_deref().unwrap_or(&[]);
    let home = |index: usize| field.play[index] == 1 && home_side.get(region[index] as usize).map(|&owner| owner as i64 == side as i64).unwrap_or(false);
    let mut piece = vec![-1i32; size];
    let mut queue = vec![0usize; size];
    let mut count = 0i32;
    for seed in 0..size {
        if piece[seed] >= 0 || !home(seed) {
            continue;
        }
        let mut head = 0;
        let mut tail = 0;
        queue[tail] = seed;
        tail += 1;
        piece[seed] = count;
        while head < tail {
            let index = queue[head];
            head += 1;
            let col = index % cols;
            let row = index / cols;
            for step in 0..4 {
                let next: i64 = match step {
                    0 => if row > 0 { (index - cols) as i64 } else { -1 },
                    1 => if col > 0 { (index - 1) as i64 } else { -1 },
                    2 => if col + 1 < cols { (index + 1) as i64 } else { -1 },
                    _ => if row + 1 < rows { (index + cols) as i64 } else { -1 },
                };
                if next < 0 || piece[next as usize] >= 0 || !home(next as usize) {
                    continue;
                }
                piece[next as usize] = count;
                queue[tail] = next as usize;
                tail += 1;
            }
        }
        count += 1;
    }
    let made = Rc::new(HomePieces { size, piece, count: count as usize });
    battle.home_pieces[side] = Some(made.clone());
    made
}

struct Fed {
    bodies: Rc<Bodies>,
    supplied: Vec<u8>,
    touched: Vec<u8>,
}

fn supplied_bodies(battle: &mut Battle, side: usize) -> Fed {
    let bodies = bodies_of(battle.field.as_mut().unwrap(), side);
    let pieces = home_pieces(battle, side);
    let field = battle.field.as_ref().unwrap();
    let (cols, rows, size) = (field.cols, field.rows, field.size);
    let holders = &field.holders;
    let mut held: HashMap<usize, i32> = HashMap::new();
    let mut touched = vec![0u8; bodies.count];
    let other = (1 - side) as u8;
    for index in 0..size {
        let body = bodies.label[index];
        if body < 0 {
            continue;
        }
        let body = body as usize;
        if pieces.piece[index] >= 0 {
            *held.entry(body * pieces.count + pieces.piece[index] as usize).or_insert(0) += 1;
        }
        if touched[body] != 0 {
            continue;
        }
        let col = index % cols;
        let row = index / cols;
        if (row > 0 && holders[index - cols] == other) || (col > 0 && holders[index - 1] == other) || (col + 1 < cols && holders[index + 1] == other) || (row + 1 < rows && holders[index + cols] == other) {
            touched[body] = 1;
        }
    }
    let mut most_of = vec![-1i32; bodies.count];
    let mut most_held = vec![0i32; bodies.count];
    let mut holder_of = vec![-1i32; pieces.count];
    let mut held_by = vec![0i32; pieces.count];
    for body in 0..bodies.count {
        for piece in 0..pieces.count {
            let cells = held.get(&(body * pieces.count + piece)).copied().unwrap_or(0);
            if cells > most_held[body] {
                most_held[body] = cells;
                most_of[body] = piece as i32;
            }
        }
    }
    for body in 0..bodies.count {
        let piece = most_of[body];
        if piece >= 0 && most_held[body] > held_by[piece as usize] {
            held_by[piece as usize] = most_held[body];
            holder_of[piece as usize] = body as i32;
        }
    }
    let mut supplied = vec![0u8; bodies.count];
    for piece in 0..pieces.count {
        if holder_of[piece] >= 0 {
            supplied[holder_of[piece] as usize] = 1;
        }
    }
    for anchor in &battle.anchors {
        if anchor.get("s").num() != side as f64 || !matches!(anchor.get("s"), Val::Num(_)) {
            continue;
        }
        let cell = cell_of(cols, rows, anchor.get("x").num(), anchor.get("y").num());
        if cell >= 0 && bodies.label[cell as usize] >= 0 {
            supplied[bodies.label[cell as usize] as usize] = 1;
        }
    }
    if pieces.count == 0 && !supplied.iter().any(|&value| value == 1) && bodies.count > 0 {
        let mut largest = 0;
        for body in 1..bodies.count {
            if bodies.sizes[body] > bodies.sizes[largest] {
                largest = body;
            }
        }
        supplied[largest] = 1;
    }
    Fed { bodies, supplied, touched }
}

pub fn find_pockets(battle: &mut Battle) {
    let turns = battle.field.as_ref().unwrap().turns;
    if battle.pocket_turns == turns as f64 && battle.pocket_sieges.as_deref() == Some(battle.siege_key.as_str()) && battle.pocket_of.is_some() {
        return;
    }
    let before = battle.pocket_of.take();
    let known = std::mem::take(&mut battle.pockets);
    let (cols, size) = {
        let field = battle.field.as_ref().unwrap();
        (field.cols, field.size)
    };
    let mut pockets: Vec<Pocket> = Vec::new();
    let mut pocket_of = [vec![-1i32; size], vec![-1i32; size]];
    let mut supplied_now: [Option<Vec<u8>>; 2] = [None, None];
    let mut body_of: [Vec<i32>; 2] = [Vec::new(), Vec::new()];
    let mut fed = [vec![0u8; size], vec![0u8; size]];
    for side in 0..2 {
        let Fed { bodies, supplied, touched } = supplied_bodies(battle, side);
        let mut pocket_of_body = vec![-1i32; bodies.count];
        for index in 0..size {
            let body = bodies.label[index];
            if body < 0 {
                continue;
            }
            let body = body as usize;
            if supplied[body] != 0 {
                fed[side][index] = 1;
            }
            if supplied[body] != 0 || touched[body] == 0 {
                continue;
            }
            if pocket_of_body[body] < 0 {
                pocket_of_body[body] = pockets.len() as i32;
                pockets.push(Pocket { s: side, cell: index as f64, days: 0.0, km2: 0.0, cells: Some(0.0), cx: Some(0.0), cy: Some(0.0), siege: String::new(), told: false });
            }
            let pocket = &mut pockets[pocket_of_body[body] as usize];
            let km = battle.place.row_km[index / cols];
            pocket.km2 += km * km;
            pocket.cells = Some(pocket.cells.unwrap() + 1.0);
            pocket.cx = Some(pocket.cx.unwrap() + ((index % cols) as f64 + 0.5));
            pocket.cy = Some(pocket.cy.unwrap() + ((index / cols) as f64 + 0.5));
            pocket_of[side][index] = pocket_of_body[body];
            let was: i64 = match &before {
                Some(before) => before[side][index] as i64,
                None => known.iter().position(|entry| entry.s == side && entry.cell == index as f64).map(|at| at as i64).unwrap_or(-1),
            };
            if was < 0 {
                continue;
            }
            let old = match known.get(was as usize) {
                Some(old) => old,
                None => continue,
            };
            if old.days > pocket.days {
                pocket.days = old.days;
            }
            if old.told {
                pocket.told = true;
            }
        }
        supplied_now[side] = Some(supplied);
        body_of[side] = bodies.label.clone();
    }
    for pocket in pockets.iter_mut() {
        pocket.cx = Some(pocket.cx.unwrap() / pocket.cells.unwrap());
        pocket.cy = Some(pocket.cy.unwrap() / pocket.cells.unwrap());
    }
    for siege in &battle.sieges {
        let by = siege.get("by").num();
        let cell = siege.get("cell").num();
        if !(by == 0.0 || by == 1.0) || !(cell >= 0.0 && (cell as usize) < size && cell.fract() == 0.0) {
            continue;
        }
        let index = pocket_of[1 - by as usize][cell as usize];
        if index >= 0 && pockets[index as usize].siege.is_empty() {
            pockets[index as usize].siege = siege.get("at").string_or_empty();
        }
    }
    for pocket in pockets.iter_mut() {
        if pocket.siege.is_empty() {
            pocket.told = false;
        }
    }
    battle.siege_kept = [None, None];
    if pockets.iter().any(|pocket| !pocket.siege.is_empty()) {
        for side in 0..2 {
            for index in 0..size {
                let pocket = pocket_of[side][index];
                if pocket < 0 || pockets[pocket as usize].siege.is_empty() {
                    continue;
                }
                battle.siege_kept[1 - side].get_or_insert_with(|| vec![0u8; size])[index] = 1;
            }
        }
    }
    battle.supplied = supplied_now;
    battle.body_of = Some(body_of);
    battle.fed = Some(fed);
    battle.kept = kept_with(battle);
    battle.pockets = pockets;
    battle.pocket_of = Some(pocket_of);
    battle.pocket_turns = turns as f64;
    battle.pocket_sieges = Some(battle.siege_key.clone());
}

fn garrisons(battle: &Battle) -> Vec<Vec<(usize, usize)>> {
    let mut inside: Vec<Vec<(usize, usize)>> = battle.pockets.iter().map(|_| Vec::new()).collect();
    let field = battle.field.as_ref().unwrap();
    let pocket_of = battle.pocket_of.as_ref().unwrap();
    for side in 0..2 {
        for (at, troop) in battle.troops[side].iter().enumerate() {
            let cell = own_cell(field, side as u8, troop.x, troop.y);
            if is_live(troop) && cell >= 0 && pocket_of[side][cell as usize] >= 0 {
                inside[pocket_of[side][cell as usize] as usize].push((side, at));
            }
        }
    }
    inside
}

pub fn mark_pockets(battle: &mut Battle) {
    find_pockets(battle);
    let Battle { troops, field, pocket_of, pockets, .. } = battle;
    let field = field.as_ref().unwrap();
    let pocket_of = pocket_of.as_ref().unwrap();
    for side in 0..2 {
        for troop in troops[side].iter_mut() {
            let cell = own_cell(field, side as u8, troop.x, troop.y);
            let pocket = if is_live(troop) && cell >= 0 { pocket_of[side][cell as usize] } else { -1 };
            troop.pocket = pocket >= 0;
            troop.sealed = pocket >= 0;
            troop.besieged = pocket >= 0 && !pockets[pocket as usize].siege.is_empty();
        }
    }
}

fn log_entry(date: &str, kind: &str, side: usize, at: &str) -> Val {
    Val::obj([("d", Val::str(date)), ("k", Val::str(kind)), ("s", Val::Num(side as f64)), ("at", Val::str(at))])
}

fn cells_in(battle: &Battle, side: usize, index: usize) -> Vec<usize> {
    let pocket_of = battle.pocket_of.as_ref().unwrap();
    (0..battle.field.as_ref().unwrap().size).filter(|&cell| pocket_of[side][cell] == index as i32).collect()
}

fn hand_over(battle: &mut Battle, side: usize, cells: &[usize]) {
    let Battle { field, troops, .. } = battle;
    let field = field.as_mut().unwrap();
    let cols = field.cols;
    let taker = &troops[1 - side];
    let mut painter = |cell: usize| nearest_of(taker, cols, cell);
    take_cells(field, (1 - side) as u8, cells, Painter::By(&mut painter));
}

fn give_up(battle: &mut Battle, index: usize, date: &str, kind: &str) {
    let pocket = battle.pockets[index].clone();
    let cells = cells_in(battle, pocket.s, index);
    {
        let Battle { field, troops, pocket_of, .. } = &mut *battle;
        let field = field.as_ref().unwrap();
        let pocket_of = pocket_of.as_ref().unwrap();
        for troop in troops[pocket.s].iter_mut() {
            let cell = own_cell(field, pocket.s as u8, troop.x, troop.y);
            if is_live(troop) && cell >= 0 && pocket_of[pocket.s][cell as usize] == index as i32 {
                troop.strength = 0.0;
            }
        }
    }
    if cells.is_empty() {
        return;
    }
    hand_over(battle, pocket.s, &cells);
    let at = if kind.is_empty() { String::new() } else { describe_point(&battle.arena, pocket.cx.unwrap_or(f64::NAN), pocket.cy.unwrap_or(f64::NAN)) };
    if !at.is_empty() {
        battle.log.push(log_entry(date, kind, pocket.s, &at));
    }
}

pub fn surrender_pocket(battle: &mut Battle, index: usize, date: &str) {
    give_up(battle, index, date, "pocket");
}

fn can_escape(battle: &Battle, side: usize, troop: &Troop) -> bool {
    let field = battle.field.as_ref().unwrap();
    let pocket_of = battle.pocket_of.as_ref().unwrap();
    let reach = (OVERRUN_ESCAPE_KM / battle.place.km_at(troop.y)).ceil();
    let col0 = troop.x.floor();
    let row0 = troop.y.floor();
    let (cols, rows) = (field.cols as f64, field.rows as f64);
    let mut row = (row0 - reach).max(0.0);
    while row <= (rows - 1.0).min(row0 + reach) {
        let mut col = (col0 - reach).max(0.0);
        while col <= (cols - 1.0).min(col0 + reach) {
            let cell = (row * cols + col) as usize;
            if field.holders[cell] as usize == side && pocket_of[side][cell] < 0 && (col + 0.5 - troop.x) * (col + 0.5 - troop.x) + (row + 0.5 - troop.y) * (row + 0.5 - troop.y) <= reach * reach {
                return true;
            }
            col += 1.0;
        }
        row += 1.0;
    }
    false
}

pub fn settle_pockets(battle: &mut Battle, date: &str) -> bool {
    find_pockets(battle);
    let inside = garrisons(battle);
    let mut any = false;
    for index in 0..battle.pockets.len() {
        let held = &inside[index];
        if !battle.pockets[index].siege.is_empty() {
            let pocket = &mut battle.pockets[index];
            if !pocket.told {
                let entry = log_entry(date, "siege", pocket.s, &pocket.siege);
                pocket.told = true;
                pocket.days += 1.0;
                battle.log.push(entry);
            } else {
                pocket.days += 1.0;
            }
            if !held.is_empty() && battle.pockets[index].days < SIEGE_DAYS {
                continue;
            }
            give_up(battle, index, date, "pocket");
            any = true;
            continue;
        }
        let pocket = battle.pockets[index].clone();
        let mut overrun = !held.is_empty() && pocket.km2 < SCRAP_KM2;
        if !held.is_empty() && !overrun && pocket.km2 < PATCH_MAX_KM2 {
            let (cx, cy) = (pocket.cx.unwrap_or(f64::NAN), pocket.cy.unwrap_or(f64::NAN));
            let within = (pocket.cells.unwrap_or(f64::NAN) / std::f64::consts::PI).sqrt() + OVERRUN_WITHIN_KM / battle.place.km_at(cy);
            let mut at = 0.0;
            for troop in &battle.troops[1 - pocket.s] {
                if !is_live(troop) || !troop.order.truthy() || troop.order.get("done").truthy() || !matches!(troop.order.get("kind"), Val::Str(kind) if kind == "reduce") {
                    continue;
                }
                if (troop.x - cx) * (troop.x - cx) + (troop.y - cy) * (troop.y - cy) <= within * within {
                    at += troop.strength;
                }
            }
            let mut sum = 0.0;
            for &(side, at) in held {
                sum += battle.troops[side][at].strength;
            }
            overrun = at >= OVERRUN_ODDS * sum;
        }
        if overrun {
            for &(side, at) in held {
                let escape = can_escape(battle, pocket.s, &battle.troops[side][at]);
                let troop = &mut battle.troops[side][at];
                troop.strength = if escape { (troop.strength - OVERRUN_LOSS).max(0.0) } else { 0.0 };
                if troop.order.truthy() {
                    troop.order = Val::Null;
                }
                troop.fallback = Val::Null;
            }
            let cells = cells_in(battle, pocket.s, index);
            hand_over(battle, pocket.s, &cells);
            let at = describe_point(&battle.arena, pocket.cx.unwrap_or(f64::NAN), pocket.cy.unwrap_or(f64::NAN));
            if !at.is_empty() {
                battle.log.push(log_entry(date, "overrun", pocket.s, &at));
            }
            any = true;
            continue;
        }
        if held.is_empty() {
            if pocket.km2 >= EMPTY_POCKET_KM2 {
                continue;
            }
            give_up(battle, index, date, if pocket.km2 < PATCH_MAX_KM2 { "" } else { "pocket" });
            any = true;
            continue;
        }
        battle.pockets[index].days += 1.0;
        if battle.pockets[index].days < POCKET_DAYS {
            continue;
        }
        give_up(battle, index, date, "pocket");
        any = true;
    }
    if any {
        find_pockets(battle);
    }
    any
}

pub fn refresh_supply(battle: &mut Battle, day: f64, era: usize) {
    let turns = battle.field.as_ref().unwrap().turns;
    if battle.supply.is_some() && (day % SUPPLY_EVERY_DAYS != 0.0 || battle.supply_turns == turns as f64) {
        return;
    }
    find_pockets(battle);
    let (cols, rows, size) = {
        let field = battle.field.as_ref().unwrap();
        (field.cols, field.rows, field.size)
    };
    let full_km = SUPPLY_FULL_KM[era];
    let far_km = full_km * SUPPLY_FAR_FACTOR;
    let km_each = battle.arena.frame.km / 5.0;
    let corridors = battle.corridors;
    let ring_size = if corridors { 32 } else { 8 };
    let mut near = if corridors { vec![0i32; size] } else { Vec::new() };
    let near_thirds = (CORRIDOR_KM * 3.0) / battle.arena.frame.km;
    let mut out: [Vec<f32>; 2] = [Vec::new(), Vec::new()];
    for side in 0..2 {
        let bodies = bodies_of(battle.field.as_mut().unwrap(), side);
        let field = battle.field.as_ref().unwrap();
        let holders = &field.holders;
        let want = side as u8;
        let supplied = battle.supplied[side].as_deref().unwrap_or(&[]);
        let fed = |index: usize| bodies.label[index] >= 0 && supplied.get(bodies.label[index] as usize).map(|&value| value != 0).unwrap_or(false);
        let mut cost = vec![-1i32; size];
        let mut rounds: Vec<Vec<usize>> = vec![Vec::new(); ring_size];
        let mask = (ring_size - 1) as i32;
        let mut waiting = 0usize;
        let reach = |index: usize, value: i32, cost: &mut Vec<i32>, rounds: &mut Vec<Vec<usize>>, waiting: &mut usize| {
            if cost[index] >= 0 && cost[index] <= value {
                return;
            }
            cost[index] = value;
            rounds[(value & mask) as usize].push(index);
            *waiting += 1;
        };
        if corridors {
            distance_from(cols, rows, |cell| holders[cell] == (1 - side) as u8, &mut near);
        }
        let exposed = |cell: usize| corridors && (near[cell] as f64) < near_thirds;
        let home_side = battle.home_side.as_deref().unwrap_or(&[]);
        let region = &battle.arena.region;
        let mut homeless = true;
        for index in 0..size {
            if holders[index] != want || !fed(index) || !home_side.get(region[index] as usize).map(|&owner| owner as i64 == side as i64).unwrap_or(false) {
                continue;
            }
            reach(index, 0, &mut cost, &mut rounds, &mut waiting);
            homeless = false;
        }
        for anchor in &battle.anchors {
            let cell = cell_of(cols, rows, anchor.get("x").num(), anchor.get("y").num());
            if matches!(anchor.get("s"), Val::Num(s) if *s == side as f64) && cell >= 0 && holders[cell as usize] == want {
                reach(cell as usize, 0, &mut cost, &mut rounds, &mut waiting);
                homeless = false;
            }
        }
        if homeless {
            for index in 0..size {
                if holders[index] == want && fed(index) {
                    reach(index, 0, &mut cost, &mut rounds, &mut waiting);
                }
            }
        }
        let mut value: i32 = 0;
        while waiting > 0 {
            let round = std::mem::take(&mut rounds[(value & mask) as usize]);
            for &index in &round {
                waiting -= 1;
                if cost[index] != value {
                    continue;
                }
                let col = (index % cols) as i64;
                let row = (index / cols) as i64;
                for dy in -1i64..=1 {
                    let y = row + dy;
                    if y < 0 || y >= rows as i64 {
                        continue;
                    }
                    for dx in -1i64..=1 {
                        let x = col + dx;
                        if (dx == 0 && dy == 0) || x < 0 || x >= cols as i64 || holders[(y * cols as i64 + x) as usize] != want {
                            continue;
                        }
                        let step = if dx != 0 && dy != 0 { 7 } else { 5 };
                        let next = (y * cols as i64 + x) as usize;
                        let add = if exposed(next) { step * CORRIDOR_COST as i32 } else { step };
                        reach(next, value + add, &mut cost, &mut rounds, &mut waiting);
                    }
                }
            }
            value += 1;
        }
        let mut supply = vec![0f32; size];
        for index in 0..size {
            if holders[index] != want {
                continue;
            }
            let km = if cost[index] < 0 { f64::INFINITY } else { cost[index] as f64 * km_each };
            supply[index] = (if km <= full_km {
                1.0
            } else if km >= far_km {
                SUPPLY_LEAST
            } else {
                1.0 - ((1.0 - SUPPLY_LEAST) * (km - full_km)) / (far_km - full_km)
            }) as f32;
        }
        out[side] = supply;
    }
    battle.supply = Some(out);
    battle.supply_turns = turns as f64;
}

pub fn mark_supply(battle: &mut Battle) {
    let Battle { troops, field, supply, .. } = battle;
    let field = field.as_ref().unwrap();
    for side in 0..2 {
        let supply = supply.as_ref().map(|supply| &supply[side]);
        for troop in troops[side].iter_mut() {
            if troop.pocket {
                troop.supply = 1.0;
                continue;
            }
            let cell = own_cell(field, side as u8, troop.x, troop.y);
            let value = match supply {
                Some(supply) if cell >= 0 => supply[cell as usize] as f64,
                _ => 0.0,
            };
            if value > 0.0 {
                troop.supply = value;
            }
        }
    }
}
