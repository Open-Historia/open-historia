use super::battle::Battle;
use super::closing::{draw_in, live_order};
use super::combat::{battle_squares, each_near, Squares};
use super::constants::*;
use super::engine::Run;
use super::ground::{away_of, cell_at, cells_of, distance_from, downhill, held_round, measure, nearest_of, outward_of};
use super::js::{self, Val};
use super::orders::unit_of;
use super::sectors::{describe_point, in_sector};
use super::troops::{control_radius, is_live, reach_cells, stand_off, stands, Troop, KIND_ARTILLERY, STATE_ADVANCING};
use super::unit_motion::hash_seed;
use super::way::{aim_out, left_on_leg, Leg};
use super::march::{kind_pick, march_km_of, march_on, OWN_GROUND_PACE};
use crate::jsmath;

#[derive(Clone, Debug, PartialEq)]
pub struct Retreat {
    pub size: usize,
    pub turns: i64,
    pub deep: [Vec<i32>; 2],
    pub taken: [Vec<i32>; 2],
    pub labels: Vec<i32>,
    pub far: Vec<i32>,
}

fn num(value: f64) -> Val {
    Val::Num(value)
}

fn kind_is(order: &Val, kind: &str) -> bool {
    matches!(order.get("kind"), Val::Str(text) if text == kind)
}

fn halted(battle: &Battle, side: usize, x: f64, y: f64) -> bool {
    battle.halts_today.iter().any(|halt| js::strict_equals(&halt.s, &num(side as f64)) && in_sector(&halt.sector, x, y, |y| battle.place.km_at(y)))
}

fn turn_to(troop: &mut Troop, x: f64, y: f64) {
    let length = (x * x + y * y).sqrt();
    if !(length > 0.0) {
        return;
    }
    troop.hx = x / length;
    troop.hy = y / length;
}

fn to_side(battle: &mut Battle) {
    measure(battle.field.as_ref().unwrap(), &mut battle.to_side);
}

pub fn place_behind(battle: &mut Battle, side: usize, troop: &Troop, depth: f64) -> Option<[f64; 2]> {
    to_side(battle);
    let field = battle.field.as_ref().unwrap();
    let to_other = &battle.to_side.as_ref().unwrap().sides[1 - side];
    let reach = (FALL_BACK_SEARCH_KM / battle.place.km_at(troop.y)).ceil();
    let col0 = troop.x.floor();
    let row0 = troop.y.floor();
    let mut best = f64::INFINITY;
    let mut found = None;
    let mut row = jsmath::max(0.0, row0 - reach);
    while row <= jsmath::min(field.rows as f64 - 1.0, row0 + reach) {
        let mut col = jsmath::max(0.0, col0 - reach);
        while col <= jsmath::min(field.cols as f64 - 1.0, col0 + reach) {
            let cell = (row * field.cols as f64 + col) as usize;
            if field.holders[cell] as usize == side && !((to_other[cell] as f64) / 3.0 < depth * HOLD_BACK_TO) {
                let distance = (col + 0.5 - troop.x) * (col + 0.5 - troop.x) + (row + 0.5 - troop.y) * (row + 0.5 - troop.y);
                if distance < best {
                    best = distance;
                    found = Some([col + 0.5, row + 0.5]);
                }
            }
            col += 1.0;
        }
        row += 1.0;
    }
    found
}

fn straight_back(battle: &Battle, side: usize, troop: &Troop, depth: f64, toward: &mut [f64; 2]) -> Option<[f64; 2]> {
    let field = battle.field.as_ref().unwrap();
    let km = battle.place.km_at(troop.y);
    if !outward_of(field, side as u8, troop.x, troop.y, FALL_BACK_FROM_KM / km, toward) {
        return None;
    }
    let to_other = &battle.to_side.as_ref().unwrap().sides[1 - side];
    let back_x = -toward[0];
    let back_y = -toward[1];
    let reach = FALL_BACK_SEARCH_KM / km;
    let mut gone = 0.5;
    while gone <= reach {
        let x = troop.x + back_x * gone;
        let y = troop.y + back_y * gone;
        let cell = cell_at(field, x, y);
        if cell < 0 || field.play[cell as usize] == 0 {
            return None;
        }
        if field.holders[cell as usize] as usize == side && (to_other[cell as usize] as f64) / 3.0 >= depth * HOLD_BACK_TO {
            return Some([x, y]);
        }
        gone += 0.5;
    }
    None
}

fn retreat_books(battle: &mut Battle) {
    let turns = battle.field.as_ref().unwrap().turns;
    if battle.retreat.as_ref().is_some_and(|books| books.turns == turns) {
        return;
    }
    to_side(battle);
    let field = battle.field.as_ref().unwrap();
    let (cols, rows, size) = (field.cols, field.rows, field.size);
    let mut books = match battle.retreat.take() {
        Some(books) if books.size == size => books,
        _ => Retreat { size, turns, deep: [vec![0; size], vec![0; size]], taken: [vec![0; size], vec![0; size]], labels: vec![0; size], far: vec![0; size] },
    };
    let deep_thirds = (DEEP_KM / battle.frame.km) * 3.0;
    let sides = &battle.to_side.as_ref().unwrap().sides;
    for side in [HOLDER_SIDE_A as usize, HOLDER_SIDE_B as usize] {
        for cell in 0..size {
            books.labels[cell] = if field.holders[cell] as usize == side && sides[1 - side][cell] as f64 >= deep_thirds { cell as i32 } else { -1 };
        }
        let Retreat { labels, far, deep, taken, .. } = &mut books;
        nearest_of(cols, rows, labels, far, &mut deep[side]);
        let homes = battle.homes.as_deref();
        distance_from(cols, rows, |cell| field.holders[cell] as usize == side && homes.map(|homes| homes[cell] as usize != side).unwrap_or(true), &mut taken[side]);
    }
    books.turns = turns;
    battle.retreat = Some(books);
}

fn outflanked(battle: &mut Battle, side: usize, x: f64, y: f64, toward: &mut [f64; 2]) -> bool {
    retreat_books(battle);
    let field = battle.field.as_ref().unwrap();
    let books = battle.retreat.as_ref().unwrap();
    let here = cell_at(field, x, y);
    let target = if here >= 0 { books.deep[side][here as usize] } else { -1 };
    if target < 0 {
        return false;
    }
    let target = target as usize;
    let dx = (target % field.cols) as f64 + 0.5 - x;
    let dy = (target / field.cols) as f64 + 0.5 - y;
    let length = (dx * dx + dy * dy).sqrt();
    if !(length > 0.0) {
        return false;
    }
    toward[0] = dx / length;
    toward[1] = dy / length;
    let km = battle.place.km_at(y);
    let taken = &books.taken[1 - side];
    let least = OUTFLANKED_NECK_KM / km;
    let mut gone = OUTFLANKED_FROM_KM / km;
    while gone <= length {
        let cell = cell_at(field, x + toward[0] * gone, y + toward[1] * gone);
        if cell < 0 || field.holders[cell as usize] as usize != side {
            return false;
        }
        if (taken[cell as usize] as f64) / 3.0 < jsmath::max(least, gone * OUTFLANKED_NARROW) {
            return true;
        }
        gone += 1.0;
    }
    false
}

fn log_overrun(battle: &mut Battle, date: &str, side: usize, x: f64, y: f64) {
    let at = describe_point(&battle.arena, x, y);
    if !at.is_empty() {
        battle.log.push(Val::obj([("d", Val::str(date)), ("k", Val::str("overrun")), ("s", num(side as f64)), ("at", Val::Str(at))]));
    }
}

fn hold(battle: &mut Battle, side: usize, index: usize, day: f64, date: &str, attackers: &[usize], toward: &mut [f64; 2]) {
    if battle.troops[side][index].pinned >= day - 1.0 {
        return;
    }
    to_side(battle);
    let other = 1 - side;
    let troop = battle.troops[side][index].clone();
    let km = battle.place.km_at(troop.y);
    let depth = stand_off(&troop, |y| battle.place.km_at(y));
    let (on_own, away, near_own) = {
        let field = battle.field.as_ref().unwrap();
        let sides = battle.to_side.as_ref().unwrap();
        let on_own = stands(field, side as u8, troop.x, troop.y);
        let away = if on_own { away_of(field, sides, side, troop.x, troop.y) } else { 0.0 };
        (on_own, away, cells_of(field, &sides.sides[side], troop.x, troop.y) * battle.frame.km <= CONTROL_RADIUS_MAX_KM)
    };
    let order = live_order(&troop).cloned();
    {
        let live = &mut battle.troops[side][index];
        live.adrift = if on_own || near_own { 0.0 } else { live.adrift + 1.0 };
        if live.adrift >= ADRIFT_DAYS && !live.pocket {
            let (x, y) = (live.x, live.y);
            log_overrun(battle, date, side, x, y);
            battle.troops[side][index].strength = 0.0;
            return;
        }
    }
    if let Some(order) = &order {
        let leaving = kind_is(order, "withdraw");
        if (kind_is(order, "fallback") || leaving) && on_own {
            if !leaving && order.get("gone").num() >= FALL_BACK_MAX_KM {
                return;
            }
            let field = battle.field.as_ref().unwrap();
            let to_other = &battle.to_side.as_ref().unwrap().sides[other];
            let target = order.get("target");
            let (mut dx, mut dy) = (0.0, 0.0);
            if target.truthy() {
                dx = target.read("x").num() - troop.x;
                dy = target.read("y").num() - troop.y;
            } else if downhill(field, to_other, troop.x, troop.y, toward) {
                dx = -toward[0];
                dy = -toward[1];
            }
            let gap = (dx * dx + dy * dy).sqrt();
            let live = &mut battle.troops[side][index];
            if !(gap > 0.05) {
                if leaving {
                    live.order.write("home", Val::Bool(true));
                }
                return;
            }
            let step = jsmath::min(if target.truthy() { gap } else { f64::INFINITY }, FALL_BACK_KM_PER_DAY / km);
            for share in [1.0, 0.5, 0.25] {
                let x = troop.x + (dx / gap) * step * share;
                let y = troop.y + (dy / gap) * step * share;
                if !stands(field, side as u8, x, y) {
                    continue;
                }
                live.x = x;
                live.y = y;
                live.moved_km += step * share * km;
                let gone = live.order.get("gone").num() + step * share * km;
                live.order.write("gone", num(gone));
                turn_to(live, dx, dy);
                return;
            }
            if leaving {
                live.order.write("home", Val::Bool(true));
            }
            return;
        }
    }
    {
        let field = battle.field.as_ref().unwrap();
        let live = &mut battle.troops[side][index];
        if live.fallback.truthy() {
            let (fx, fy) = (live.fallback.element(0).num(), live.fallback.element(1).num());
            let cell = cell_at(field, fx, fy);
            let held = if cell >= 0 { field.holders[cell as usize] as usize == side } else { false };
            if ((fx - live.x).abs() < 0.3 && (fy - live.y).abs() < 0.3) || !held {
                live.fallback = Val::Null;
            }
        }
    }
    if !battle.troops[side][index].fallback.truthy() && (!on_own || away < depth * HOLD_TOO_NEAR) {
        let nearest = place_behind(battle, side, &troop, depth);
        let back = straight_back(battle, side, &troop, depth, toward);
        let reach = |place: [f64; 2]| ((place[0] - troop.x) * (place[0] - troop.x) + (place[1] - troop.y) * (place[1] - troop.y)).sqrt();
        let chosen = match back {
            Some(back) if nearest.map(|nearest| reach(back) <= reach(nearest) * STRAIGHT_BACK_FURTHER + 1.0).unwrap_or(true) => Some(back),
            _ => nearest,
        };
        battle.troops[side][index].fallback = chosen.map(|[x, y]| Val::Arr(vec![num(x), num(y)])).unwrap_or(Val::Null);
    }
    {
        let live = &mut battle.troops[side][index];
        if !on_own && !live.fallback.truthy() && !live.pocket {
            live.stranded += 1.0;
            if live.stranded >= STRANDED_DAYS {
                let (x, y) = (live.x, live.y);
                log_overrun(battle, date, side, x, y);
                battle.troops[side][index].strength = 0.0;
                return;
            }
        } else {
            live.stranded = 0.0;
        }
    }
    if battle.troops[side][index].fallback.truthy() {
        let field = battle.field.as_ref().unwrap();
        let live = &mut battle.troops[side][index];
        let dx = live.fallback.element(0).num() - live.x;
        let dy = live.fallback.element(1).num() - live.y;
        let distance = (dx * dx + dy * dy).sqrt();
        let step = jsmath::min(distance, FALL_BACK_PACE_KM / km);
        if !(distance > 0.0) {
            return;
        }
        for share in [1.0, 0.75, 0.5, 0.25] {
            let x = live.x + (dx / distance) * step * share;
            let y = live.y + (dy / distance) * step * share;
            let landing = cell_at(field, x, y);
            if landing < 0 || field.play[landing as usize] == 0 {
                continue;
            }
            live.x = x;
            live.y = y;
            live.moved_km += step * share * km;
            turn_to(live, dx, dy);
            return;
        }
        live.fallback = Val::Null;
        return;
    }
    if troop.pocket || !on_own {
        return;
    }
    if order.is_none() && outflanked(battle, side, troop.x, troop.y, toward) {
        let back_x = toward[0];
        let back_y = toward[1];
        let step = (FALL_BACK_PACE_KM * jsmath::max(1.0, battle.pace / FRONT_PACE_SHARE)) / km;
        let mut gone = 0.0;
        for share in [0.25, 0.5, 0.75, 1.0] {
            let x = troop.x + back_x * step * share;
            let y = troop.y + back_y * step * share;
            if !stands(battle.field.as_ref().unwrap(), side as u8, x, y) {
                continue;
            }
            gone = share;
            if !outflanked(battle, side, x, y, toward) {
                break;
            }
        }
        let live = &mut battle.troops[side][index];
        live.gave = day;
        if !(gone > 0.0) {
            return;
        }
        live.x += back_x * step * gone;
        live.y += back_y * step * gone;
        live.moved_km += step * gone * km;
        turn_to(live, back_x, back_y);
        return;
    }
    if away >= depth * SLIDE_BAND[0] && away <= depth * SLIDE_BAND[1] {
        if order.is_some() || attackers.is_empty() {
            return;
        }
        let hears = SLIDE_HEARS_KM / km;
        let (mut call_x, mut call_y) = (0.0, 0.0);
        let mut closest = f64::INFINITY;
        for &at in attackers {
            let enemy = &battle.troops[other][at];
            let dx = enemy.x - troop.x;
            let dy = enemy.y - troop.y;
            if dx.abs() > hears || dy.abs() > hears {
                continue;
            }
            let distance = (dx * dx + dy * dy).sqrt();
            if distance > hears || !(distance > 0.0) {
                continue;
            }
            if distance < closest {
                closest = distance;
            }
            call_x += dx / (distance * distance);
            call_y += dy / (distance * distance);
        }
        if !(closest * km > SLIDE_NEAR_KM && closest * km < SLIDE_FAR_KM) {
            return;
        }
        let field = battle.field.as_ref().unwrap();
        let to_other = &battle.to_side.as_ref().unwrap().sides[other];
        if !downhill(field, to_other, troop.x, troop.y, toward) {
            return;
        }
        let into = call_x * toward[0] + call_y * toward[1];
        let mut slide_x = call_x - toward[0] * into;
        let mut slide_y = call_y - toward[1] * into;
        let length = (slide_x * slide_x + slide_y * slide_y).sqrt();
        if !(length > 0.0) {
            return;
        }
        slide_x /= length;
        slide_y /= length;
        if troop.slid && slide_x * troop.hx + slide_y * troop.hy <= 0.25 {
            return;
        }
        let mut go_x = if troop.slid { 0.6 * troop.hx + 0.4 * slide_x } else { slide_x };
        let mut go_y = if troop.slid { 0.6 * troop.hy + 0.4 * slide_y } else { slide_y };
        let going = (go_x * go_x + go_y * go_y).sqrt();
        go_x /= going;
        go_y /= going;
        let step = (SLIDE_KM / km) * troop.drive;
        let landing = cell_at(field, troop.x + go_x * step, troop.y + go_y * step);
        if landing < 0 || field.holders[landing as usize] as usize != side || (to_other[landing as usize] as f64) / 3.0 < depth * SLIDE_LEAST_DEPTH {
            return;
        }
        let live = &mut battle.troops[side][index];
        live.x += go_x * step;
        live.y += go_y * step;
        live.moved_km += step * km;
        live.hx = go_x;
        live.hy = go_y;
        live.slid = true;
    } else if !troop.order.truthy() && away > depth * COME_UP_FROM && day - troop.gave >= GAVE_GROUND_REST_DAYS {
        let (up_x, up_y, step) = {
            let field = battle.field.as_ref().unwrap();
            let to_other = &battle.to_side.as_ref().unwrap().sides[other];
            if !downhill(field, to_other, troop.x, troop.y, toward) {
                return;
            }
            let come_up = match &battle.march_km {
                Some(march) => jsmath::max(COME_UP_KM, kind_pick(march, troop.kind)),
                None => COME_UP_KM,
            };
            let step = jsmath::min(come_up / km, away - depth * COME_UP_TO);
            let landing = cell_at(field, troop.x + toward[0] * step, troop.y + toward[1] * step);
            if landing < 0 || field.holders[landing as usize] as usize != side {
                return;
            }
            (toward[0], toward[1], step)
        };
        if outflanked(battle, side, troop.x + up_x * step, troop.y + up_y * step, toward) {
            return;
        }
        let live = &mut battle.troops[side][index];
        live.x += up_x * step;
        live.y += up_y * step;
        live.moved_km += step * km;
        live.hx = up_x;
        live.hy = up_y;
    }
}

fn end_reduce(troop: &mut Troop, day: f64, passed: bool) {
    if passed {
        troop.rested = day + CLOSE_REST_DAYS;
    }
    let resume = troop.order.get("resume").clone();
    if resume.truthy() && !resume.get("done").truthy() {
        troop.order = resume;
    } else {
        troop.order.write("done", Val::Bool(true));
    }
}

fn weight(weights: &Val, key: &str, otherwise: f64) -> f64 {
    match weights.get(key) {
        Val::Undef | Val::Null => otherwise,
        other => js::to_number(other),
    }
}

#[allow(clippy::too_many_arguments)]
fn steer(battle: &mut Battle, run: &Run, side: usize, index: usize, day: f64, date: &str, squares: &[Squares; 2], weights: &Val, toward: &mut [f64; 2]) {
    to_side(battle);
    let other = 1 - side;
    let troop = battle.troops[side][index].clone();
    let km = battle.place.km_at(troop.y);
    let cell_km = battle.frame.km;
    let order = troop.order.clone();
    let (mut ax, mut ay) = (troop.hx, troop.hy);
    let mut slide = 0.0;
    let mut closing = false;
    let mut ranked = false;
    if kind_is(&order, "breakout") {
        if !troop.pocket {
            battle.troops[side][index].order.write("done", Val::Bool(true));
            return;
        }
        let field = battle.field.as_ref().unwrap();
        if downhill(field, &battle.close.as_ref().unwrap().to_supplied[side], troop.x, troop.y, toward) {
            ax = toward[0];
            ay = toward[1];
        }
    } else if kind_is(&order, "assault") {
        let entry = order.get("entry").clone();
        let unit = unit_of(&entry);
        if let Some((s, i)) = unit {
            let (ux, uy) = (battle.troops[s][i].x, battle.troops[s][i].y);
            entry.put("x", num(ux));
            entry.put("y", num(uy));
        }
        let (ex, ey) = (entry.read("x").num(), entry.read("y").num());
        let field = battle.field.as_ref().unwrap();
        let there = cell_at(field, ex, ey);
        let done = match unit {
            Some((s, i)) => !is_live(&battle.troops[s][i]),
            None => there >= 0 && field.holders[there as usize] as usize == side,
        };
        if done || day - entry.read("day").num() > ASSAULT_DAYS {
            if done && !entry.read("taken").truthy() {
                entry.put("taken", num(day));
                if !matches!(entry.read("kind"), Val::Str(kind) if kind == "city") {
                    let kind = if unit.is_some() { "destroyed" } else { "taken" };
                    battle.log.push(Val::obj([("d", Val::str(date)), ("k", Val::str(kind)), ("s", num(side as f64)), ("at", entry.read("name"))]));
                }
            }
            entry.put("over", Val::Bool(true));
            let live = &mut battle.troops[side][index];
            let resume = live.order.get("resume").clone();
            if resume.truthy() && !resume.get("done").truthy() {
                live.order = resume;
            } else {
                live.order.write("done", Val::Bool(true));
            }
            return;
        }
        let gap_x = ex - troop.x;
        let gap_y = ey - troop.y;
        let gap = (gap_x * gap_x + gap_y * gap_y).sqrt();
        if gap <= order.get("ring").num() / km {
            if let Some((s, i)) = unit {
                if gap < reach_cells(|y| battle.place.km_at(y), troop.y) {
                    let target = &mut battle.troops[s][i];
                    target.strength = jsmath::max(0.0, target.strength - ASSAULT_WEAR);
                    target.pinned = day;
                }
            }
            battle.troops[side][index].plant = true;
            return;
        }
        ax = gap_x / gap;
        ay = gap_y / gap;
    } else if kind_is(&order, "reduce") {
        let field = battle.field.as_ref().unwrap();
        let books = battle.close.as_ref().unwrap();
        let here = cell_at(field, troop.x, troop.y);
        let left = if here >= 0 { (books.to_prey[side][here as usize] as f64 / 3.0) * cell_km } else { f64::INFINITY };
        let near = if here >= 0 { books.prey_near[side][here as usize] } else { -1 };
        let pocket = here >= 0 && near >= 0 && (near as usize) < books.pockets[side].len();
        let leaves = CLOSE_LEAVES_KM[if order.get("resume").truthy() { 1 } else { 0 }];
        if !pocket || left > leaves {
            end_reduce(&mut battle.troops[side][index], day, false);
            return;
        }
        if day - order.get("day").num() >= CLOSE_DAYS_MOST {
            end_reduce(&mut battle.troops[side][index], day, true);
            return;
        }
        let lies = left > 0.5 * cell_km && downhill(field, &books.to_prey[side], troop.x, troop.y, toward);
        if order.get("entered").truthy() && lies && toward[0] * troop.hx + toward[1] * troop.hy < 0.1 {
            end_reduce(&mut battle.troops[side][index], day, true);
            return;
        }
        if left <= 0.5 * cell_km {
            battle.troops[side][index].order.write("entered", Val::Bool(true));
        }
        if lies {
            ax = toward[0];
            ay = toward[1];
        }
        closing = true;
    } else if kind_is(&order, "pursue") {
        let field = battle.field.as_ref().unwrap();
        if downhill(field, &battle.to_side.as_ref().unwrap().sides[other], troop.x, troop.y, toward) {
            ax = toward[0];
            ay = toward[1];
        }
        ranked = true;
    } else {
        let legs = order.get("legs").array_or_empty();
        let mut at = order.get("leg").num() as usize;
        let mut leg = Leg::of(&legs[at]);
        let last = at as f64 == legs.len() as f64 - 1.0;
        if left_on_leg(&leg, troop.x, troop.y) <= if last { (1.0 - order.get("stop").num()) * leg.length } else { 0.0 } {
            if last {
                battle.troops[side][index].order.write("done", Val::Bool(true));
                return;
            }
            at += 1;
            battle.troops[side][index].order.write("leg", num(at as f64));
            leg = Leg::of(&legs[at]);
        }
        ax = leg.ax;
        ay = leg.ay;
        let across = (troop.x - leg.ox) * -leg.ay + (troop.y - leg.oy) * leg.ax;
        slide = jsmath::max(-SLOT_SLIDE_MOST, jsmath::min(SLOT_SLIDE_MOST, (order.get("slot").num() - across) / (SLOT_SLIDE_KM / km)));
        let word = order.get("word");
        if matches!(word, Val::Str(word) if word == "blitz") {
            battle.troops[side][index].pace_factor = BLITZ_PACE;
        }
        ranked = matches!(word, Val::Str(word) if word == "advance" || word == "blitz");
    }
    let rank = weight(weights, "rank", 1.0);
    if ranked && rank > 0.0 {
        let free = ANCHOR_FREE_KM / km;
        let ashore = battle.anchors.iter().any(|anchor| {
            js::strict_equals(anchor.get("s"), &num(side as f64)) && {
                let (dx, dy) = (anchor.get("x").num() - troop.x, anchor.get("y").num() - troop.y);
                dx * dx + dy * dy <= free * free
            }
        });
        if !ashore {
            let held = held_round(battle.field.as_ref().unwrap(), side as u8, troop.x, troop.y, SUPPORT_KM / km);
            battle.troops[side][index].pace_factor *= jsmath::max(0.0, jsmath::min(1.0, (held - SUPPORT_NONE) / (SUPPORT_FULL - SUPPORT_NONE)));
        }
    }
    if battle.troops[side][index].order.get("own").truthy() && rank > 0.0 {
        let within = RANK_KM / km;
        let room = SPREAD_KM / km;
        let (mut weight_sum, mut forward, mut crowd) = (0.0, 0.0, 0.0);
        for (at, mate) in battle.troops[side].iter().enumerate() {
            if at == index || !is_live(mate) {
                continue;
            }
            let dx = mate.x - troop.x;
            let dy = mate.y - troop.y;
            if dx.abs() >= within || dy.abs() >= within {
                continue;
            }
            let theirs = live_order(mate);
            if !theirs.is_some_and(|theirs| theirs.get("own").truthy()) {
                continue;
            }
            let apart = (dx * dx + dy * dy).sqrt();
            if apart >= within {
                continue;
            }
            weight_sum += 1.0 - apart / within;
            forward += (1.0 - apart / within) * (dx * ax + dy * ay);
            if apart < room {
                crowd += (if dx * -ay + dy * ax >= 0.0 { 1.0 } else { -1.0 }) * (1.0 - apart / room);
            }
        }
        let lead = if weight_sum > 0.0 { (-forward / weight_sum) * km } else { 0.0 };
        let live = &mut battle.troops[side][index];
        if lead > RANK_SLACK_KM {
            live.pace_factor *= jsmath::max(RANK_LEAST, 1.0 - (lead - RANK_SLACK_KM) / RANK_BAND_KM);
        }
        if crowd != 0.0 {
            let at = live.order.get("leg").num() as usize;
            let leg = Leg::of(&live.order.get("legs").array_or_empty()[at]);
            let across = (troop.x - leg.ox) * -leg.ay + (troop.y - leg.oy) * leg.ax;
            let most = SLOT_SLIDE_KM / km;
            let slot = live.order.get("slot").num();
            let moved = jsmath::max(across - most, jsmath::min(across + most, slot - jsmath::max(-1.0, jsmath::min(1.0, crowd)) * (SPREAD_KM_PER_DAY / km)));
            live.order.write("slot", num(moved));
        }
    }
    let (hx, hy) = (battle.troops[side][index].hx, battle.troops[side][index].hy);
    let (mut press_x, mut press_y) = (0.0, 0.0);
    let pressing = if closing { 0.0 } else { weight(weights, "resistance", STEER_PRESS) };
    if pressing > 0.0 {
        let within = STEER_PRESS_KM / km;
        let enemies = &battle.troops[other];
        each_near(&squares[other], troop.x, troop.y, |at| {
            let enemy = &enemies[at];
            let dx = enemy.x - troop.x;
            let dy = enemy.y - troop.y;
            let apart = dx * dx + dy * dy;
            if !(apart > 0.0) || apart > within * within || dx * hx + dy * hy <= 0.0 {
                return;
            }
            press_x -= (enemy.strength * dx) / apart;
            press_y -= (enemy.strength * dy) / apart;
        });
        let length = (press_x * press_x + press_y * press_y).sqrt();
        press_x = if length > 0.0 { press_x / length } else { 0.0 };
        press_y = if length > 0.0 { press_y / length } else { 0.0 };
    }
    let drifting = weight(weights, "wander", STEER_DRIFT);
    let (mut drift_x, mut drift_y) = (0.0, 0.0);
    if drifting > 0.0 {
        let block = (day / DRIFT_DAYS).floor();
        let key = |block: f64| [battle.seed.clone(), battle.name.clone(), "drift".to_string(), js::number_to_string(side as f64), js::number_to_string(index as f64), js::number_to_string(block)].join("|");
        let from = (hash_seed(&key(block)) % 16) as usize;
        let to = (hash_seed(&key(block + 1.0)) % 16) as usize;
        let part = (day - block * DRIFT_DAYS) / DRIFT_DAYS;
        drift_x = COMPASS_16[from * 2] + (COMPASS_16[to * 2] - COMPASS_16[from * 2]) * part;
        drift_y = COMPASS_16[from * 2 + 1] + (COMPASS_16[to * 2 + 1] - COMPASS_16[from * 2 + 1]) * part;
    }
    let mut want_x = ax - ay * slide + pressing * press_x + drifting * drift_x;
    let mut want_y = ay + ax * slide + pressing * press_y + drifting * drift_y;
    let wanting = (want_x * want_x + want_y * want_y).sqrt();
    want_x = if wanting > 0.0 { want_x / wanting } else { ax };
    want_y = if wanting > 0.0 { want_y / wanting } else { ay };
    let keep = if closing { HEADING_KEPT_CLOSING } else { HEADING_KEPT };
    let most = if closing { TURN_CLOSING } else { TURN_COS };
    let most_sin = if closing { TURN_CLOSING } else { TURN_SIN };
    let (from_x, from_y) = (hx, hy);
    let mut head_x = keep * from_x + (1.0 - keep) * want_x;
    let mut head_y = keep * from_y + (1.0 - keep) * want_y;
    let mut length = (head_x * head_x + head_y * head_y).sqrt();
    head_x = if length > 0.0 { head_x / length } else { want_x };
    head_y = if length > 0.0 { head_y / length } else { want_y };
    let kept = head_x * from_x + head_y * from_y;
    if kept < most {
        let mut across_x = head_x - from_x * kept;
        let mut across_y = head_y - from_y * kept;
        length = (across_x * across_x + across_y * across_y).sqrt();
        across_x = if length > 0.0 { across_x / length } else { -from_y };
        across_y = if length > 0.0 { across_y / length } else { from_x };
        head_x = most * from_x + most_sin * across_x;
        head_y = most * from_y + most_sin * across_y;
    }
    let onward = head_x * ax + head_y * ay;
    if onward < WAY_LEAST {
        head_x += ax * (WAY_LEAST - onward) * 2.0;
        head_y += ay * (WAY_LEAST - onward) * 2.0;
        length = (head_x * head_x + head_y * head_y).sqrt();
        head_x = if length > 0.0 { head_x / length } else { ax };
        head_y = if length > 0.0 { head_y / length } else { ay };
    }
    {
        let live = &mut battle.troops[side][index];
        live.hx = head_x;
        live.hy = head_y;
        live.axis_x = ax;
        live.axis_y = ay;
    }
    let room = control_radius(&battle.troops[side][index], |y| battle.place.km_at(y)) * ROOM_BRUSHES;
    let (mut apart_x, mut apart_y) = (0.0, 0.0);
    {
        let mates = &battle.troops[side];
        each_near(&squares[side], troop.x, troop.y, |at| {
            if at == index {
                return;
            }
            let mate = &mates[at];
            let dx = troop.x - mate.x;
            let dy = troop.y - mate.y;
            if dx.abs() > room || dy.abs() > room {
                return;
            }
            let distance = (dx * dx + dy * dy).sqrt();
            if !(distance > 0.0) || distance >= room {
                return;
            }
            apart_x += (dx / distance) * (1.0 - distance / room);
            apart_y += (dy / distance) * (1.0 - distance / room);
        });
    }
    let live = &mut battle.troops[side][index];
    let kind_km = if live.kind >= 0.0 && live.kind.fract() == 0.0 { run.advance_km.get(live.kind as usize).copied().unwrap_or(f64::NAN) } else { f64::NAN };
    let pace_km = kind_km * run.pace * live.drive * live.pace_factor;
    let ease = jsmath::max(-1.0, jsmath::min(1.0, apart_x * -head_y + apart_y * head_x)) * jsmath::min(EASE_KM / jsmath::max(1.0, pace_km), EASE_SHARE);
    let go_x = head_x - head_y * ease;
    let go_y = head_y + head_x * ease;
    length = (go_x * go_x + go_y * go_y).sqrt();
    live.gx = go_x / length;
    live.gy = go_y / length;
    live.stepping = true;
    live.reducing = closing;
    if closing && live.strength < CLOSE_WORN {
        live.order.write("done", Val::Bool(true));
        live.rested = day + CLOSE_GIVEN_UP_DAYS;
        live.stepping = false;
    }
}

pub fn move_day(battle: &mut Battle, run: &Run, day: f64) {
    battle.pace = run.pace;
    battle.march_km = if run.mech.marching() { Some(march_km_of(run)) } else { None };
    battle.own_pace = if run.mech.marching() { OWN_GROUND_PACE } else { 1.0 };
    let date = run.date_of(day);
    to_side(battle);
    let cell_km = battle.frame.km;
    let weights = run.steer.clone();
    let squares = [battle_squares(battle, 0, is_live), battle_squares(battle, 1, is_live)];
    let walked: [Vec<usize>; 2] = [0, 1].map(|side| battle.troops[side].iter().enumerate().filter(|(_, troop)| is_live(troop) && troop.state == STATE_ADVANCING).map(|(at, _)| at).collect());
    let mut toward = [0.0, 0.0];
    for side in [HOLDER_SIDE_A as usize, HOLDER_SIDE_B as usize] {
        let other = 1 - side;
        if !run.braked {
            draw_in(battle, side, day);
        }
        let falling: Vec<_> = battle.views[other].iter().filter(|view| matches!(&view.word, Val::Str(word) if word == "fall back")).cloned().collect();
        for index in 0..battle.troops[side].len() {
            {
                let troop = &mut battle.troops[side][index];
                troop.stepping = false;
                troop.reducing = false;
                troop.plant = false;
                troop.pace_factor = 1.0;
                if !is_live(troop) {
                    continue;
                }
            }
            to_side(battle);
            {
                let field = battle.field.as_ref().unwrap();
                let sides = &battle.to_side.as_ref().unwrap().sides;
                let troop = &mut battle.troops[side][index];
                if troop.hx == 0.0 && troop.hy == 0.0 && !downhill(field, &sides[other], troop.x, troop.y, &mut toward) {
                    toward[0] = if side == HOLDER_SIDE_A as usize { 1.0 } else { -1.0 };
                }
                if troop.hx == 0.0 && troop.hy == 0.0 {
                    troop.hx = toward[0];
                    troop.hy = toward[1];
                }
            }
            let mut order = live_order(&battle.troops[side][index]).is_some();
            if order {
                let held = &battle.troops[side][index].order;
                let standing = held.get("standing");
                if standing.truthy() && (!battle.orders.iter().any(|entry| entry.same_ref(standing)) || (kind_is(held, "way") && standing.read("age").num() >= ATTACK_LAPSE_DAYS)) {
                    battle.troops[side][index].order = Val::Null;
                    order = false;
                }
            }
            {
                let field = battle.field.as_ref().unwrap();
                let books = battle.close.as_ref();
                let troop = &battle.troops[side][index];
                let busy = order && (kind_is(&troop.order, "breakout") || kind_is(&troop.order, "withdraw"));
                if troop.pocket && !troop.besieged && !troop.dug && troop.kind != KIND_ARTILLERY && !busy && troop.spent <= day && books.is_some_and(|books| books.cut[side] && cells_of(field, &books.to_supplied[side], troop.x, troop.y) * cell_km < BREAK_OUT_KM) {
                    battle.troops[side][index].order = Val::obj([("kind", Val::str("breakout")), ("since", num(day)), ("day", num(day))]);
                    order = true;
                }
            }
            {
                let troop = &mut battle.troops[side][index];
                if order && kind_is(&troop.order, "breakout") && day - troop.order.get("day").num() >= BREAK_OUT_DAYS && troop.pocket {
                    troop.order.write("done", Val::Bool(true));
                    troop.spent = day + BREAK_OUT_REST_DAYS;
                    order = false;
                }
                if order && kind_is(&troop.order, "breakout") && (!troop.pocket || troop.besieged) {
                    troop.order.write("done", Val::Bool(true));
                    order = false;
                }
            }
            if battle.troops[side][index].dug {
                let field = battle.field.as_ref().unwrap();
                let troop = &mut battle.troops[side][index];
                if stands(field, side as u8, troop.x, troop.y) {
                    continue;
                }
                troop.dug = false;
                troop.dig = 0.0;
                troop.strength = jsmath::max(0.0, troop.strength - THROWN_OUT_LOSS);
                if !is_live(troop) {
                    continue;
                }
            }
            if battle.troops[side][index].goal >= 0.0 {
                if let Some(march) = battle.march_km {
                    let held = &battle.troops[side][index].order;
                    let standing = held.read("standing");
                    if order && standing.truthy() && standing.read("chosen").truthy() {
                        battle.troops[side][index].goal = -1.0;
                    } else if march_on(battle, side, index, &march) {
                        continue;
                    }
                }
            }
            if !order && !battle.troops[side][index].pocket && !falling.is_empty() {
                let (x, y) = (battle.troops[side][index].x, battle.troops[side][index].y);
                if let Some(view) = falling.iter().find(|entry| in_sector(&entry.sector, x, y, |y| battle.place.km_at(y))) {
                    battle.troops[side][index].order = Val::obj([("kind", Val::str("pursue")), ("standing", view.order.clone()), ("since", num(day)), ("day", num(day))]);
                    order = true;
                }
            }
            let acts = {
                let troop = &battle.troops[side][index];
                let held = &troop.order;
                order && day >= held.get("since").num() && !kind_is(held, "fallback") && !kind_is(held, "withdraw") && (!troop.pocket || kind_is(held, "breakout"))
            };
            let acts = acts && {
                let field = battle.field.as_ref().unwrap();
                let sides = &battle.to_side.as_ref().unwrap().sides;
                let troop = &battle.troops[side][index];
                !(!kind_is(&troop.order, "breakout") && (troop.fallback.truthy() || (!stands(field, side as u8, troop.x, troop.y) && cells_of(field, &sides[side], troop.x, troop.y) * cell_km > troop.radius_km)))
            };
            if !acts {
                hold(battle, side, index, day, &date, &walked[other], &mut toward);
                continue;
            }
            let (x, y) = (battle.troops[side][index].x, battle.troops[side][index].y);
            if run.braked || halted(battle, side, x, y) {
                continue;
            }
            if kind_is(&battle.troops[side][index].order, "way") && battle.troops[side][index].order.get("own").truthy() {
                let troop = battle.troops[side][index].clone();
                let mut held = std::mem::take(&mut battle.troops[side][index].order);
                aim_out(battle, run, side, &troop, &mut held);
                battle.troops[side][index].order = held;
            }
            {
                let km = battle.place.km_at(y);
                let troop = &mut battle.troops[side][index];
                if kind_is(&troop.order, "way") && troop.order.get("standing").truthy() && troop.order.get("standing").read("chosen").truthy() {
                    let held = &troop.order;
                    let apart = if held.get("markDay").is_undef() {
                        f64::INFINITY
                    } else {
                        let (mx, my) = (held.get("markX").num(), held.get("markY").num());
                        ((troop.x - mx) * (troop.x - mx) + (troop.y - my) * (troop.y - my)).sqrt() * km
                    };
                    if apart > HAND_STALL_KM {
                        let (tx, ty) = (troop.x, troop.y);
                        troop.order.write("markX", num(tx));
                        troop.order.write("markY", num(ty));
                        troop.order.write("markDay", num(day));
                    }
                }
            }
            steer(battle, run, side, index, day, &date, &squares, &weights, &mut toward);
        }
    }
}
