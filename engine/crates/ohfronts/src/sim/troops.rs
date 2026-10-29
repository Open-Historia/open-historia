use super::battle::{Battle, Named};
use super::climate::Effects;
use super::constants::*;
use super::field::{bodies_of, nearest_on_contour, own_cell, read_field, Field};
use super::js::{self, OrdMap};
use super::line::Line;
use super::military::Mix;
use super::unit_motion::hash_seed;
use crate::jsmath;
use std::collections::HashMap;
use super::js::Val;

pub const KIND_INFANTRY: f64 = 0.0;
pub const KIND_ARMOUR: f64 = 1.0;
pub const KIND_ARTILLERY: f64 = 2.0;
pub const STATE_HOLDING: f64 = 0.0;
pub const STATE_ADVANCING: f64 = 1.0;
pub const STATE_ENCIRCLED: f64 = 2.0;
pub const STATE_SPENT: f64 = 3.0;
pub const STATE_DUG_IN: f64 = 4.0;

#[derive(Clone, Debug, PartialEq)]
pub struct Troop {
    pub x: f64,
    pub y: f64,
    pub strength: f64,
    pub kind: f64,
    pub owner: f64,
    pub named: bool,
    pub dig: f64,
    pub state: f64,
    pub radius_km: f64,
    pub drive: f64,
    pub depth: f64,
    pub lane: f64,
    pub lag: f64,
    pub drawn: bool,
    pub hx: f64,
    pub hy: f64,
    pub axis_x: f64,
    pub axis_y: f64,
    pub station: Option<Station>,
    pub stepping: bool,
    pub walked_today: bool,
    pub flank: f64,
    pub flank_moment: f64,
    pub face_x: f64,
    pub face_y: f64,
    pub moved_km: f64,
    pub loss: f64,
    pub engaged: bool,
    pub dug: bool,
    pub order: Val,
    pub serves: f64,
    pub next: f64,
    pub command: f64,
    pub gx: f64,
    pub gy: f64,
    pub pace_factor: f64,
    pub reducing: bool,
    pub plant: bool,
    pub fallback: Val,
    pub stranded: f64,
    pub adrift: f64,
    pub gave: f64,
    pub slid: bool,
    pub pinned: f64,
    pub rested: f64,
    pub spent: f64,
    pub body: f64,
    pub pocket: bool,
    pub sealed: bool,
    pub squeezed: bool,
    pub besieged: bool,
    pub supply: f64,
    pub fatigue: f64,
    pub punch: f64,
    pub guard: f64,
    pub legs: f64,
    pub fought: bool,
    pub walled: Val,
    pub entry: Val,
    pub still: Val,
    pub climate: Option<Effects>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Station {
    pub nx: f64,
    pub ny: f64,
    pub place: f64,
    pub ideal_x: f64,
    pub ideal_y: f64,
    pub ideal_nx: f64,
    pub ideal_ny: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct TroopSeed {
    pub x: f64,
    pub y: f64,
    pub strength: f64,
    pub kind: f64,
    pub owner: f64,
    pub named: bool,
    pub dig: f64,
    pub state: f64,
}

impl Default for TroopSeed {
    fn default() -> Self {
        TroopSeed { x: 0.0, y: 0.0, strength: 100.0, kind: KIND_INFANTRY, owner: 0.0, named: false, dig: 0.0, state: STATE_HOLDING }
    }
}

pub fn create_troop(seed: TroopSeed) -> Troop {
    let TroopSeed { x, y, strength, kind, owner, named, dig, state } = seed;
    Troop {
        x,
        y,
        strength,
        kind,
        owner,
        named,
        dig,
        state,
        radius_km: CONTROL_RADIUS_MAX_KM,
        drive: 1.0,
        depth: 1.0,
        lane: 0.0,
        lag: 0.0,
        drawn: false,
        hx: 0.0,
        hy: 0.0,
        axis_x: 0.0,
        axis_y: 0.0,
        station: None,
        stepping: false,
        walked_today: false,
        flank: 1.0,
        flank_moment: -1.0,
        face_x: 0.0,
        face_y: 0.0,
        moved_km: 0.0,
        loss: 0.0,
        engaged: false,
        dug: state == STATE_DUG_IN || (state == STATE_ENCIRCLED && dig >= 1.0),
        order: Val::Null,
        serves: -1.0,
        next: -1.0,
        command: -1.0,
        gx: 0.0,
        gy: 0.0,
        pace_factor: 1.0,
        reducing: false,
        plant: false,
        fallback: Val::Null,
        stranded: 0.0,
        adrift: 0.0,
        gave: -1000.0,
        slid: false,
        pinned: -9.0,
        rested: 0.0,
        spent: 0.0,
        body: -1.0,
        pocket: false,
        sealed: false,
        squeezed: false,
        besieged: false,
        supply: 1.0,
        fatigue: 0.0,
        punch: 1.0,
        guard: 1.0,
        legs: 1.0,
        fought: false,
        walled: Val::Undef,
        entry: Val::Undef,
        still: Val::Undef,
        climate: None,
    }
}

pub fn is_live(troop: &Troop) -> bool {
    troop.strength > 0.0
}

pub fn live_count(troops: &[Troop]) -> usize {
    troops.iter().filter(|troop| troop.strength > 0.0).count()
}

pub fn is_attack(word: &str) -> bool {
    ["advance", "blitz", "spearhead", "encircle", "flank"].contains(&word)
}

pub fn side_radius_km(line_km: f64, troops: f64) -> f64 {
    jsmath::min(CONTROL_RADIUS_MAX_KM, jsmath::max(CONTROL_RADIUS_MIN_KM, (CONTROL_RADIUS_OF_SPACING * line_km) / jsmath::max(1.0, troops)))
}

pub fn control_radius<K: Fn(f64) -> f64>(troop: &Troop, km_at: K) -> f64 {
    jsmath::max(CONTROL_RADIUS_MIN_CELLS, troop.radius_km / km_at(troop.y))
}

pub fn reach_cells<K: Fn(f64) -> f64>(km_at: K, y: f64) -> f64 {
    jsmath::max(REACH_MIN_CELLS, REACH_KM / km_at(y))
}

pub fn stand_off<K: Fn(f64) -> f64>(troop: &Troop, km_at: K) -> f64 {
    let kind = if troop.kind >= 0.0 && troop.kind.fract() == 0.0 { STAND_OFF_KM.get(troop.kind as usize).copied().unwrap_or(f64::NAN) } else { f64::NAN };
    (kind * troop.depth) / km_at(troop.y)
}

pub fn stands(field: &Field, side: u8, x: f64, y: f64) -> bool {
    if !(x >= 0.0) || !(y >= 0.0) || x >= field.cols as f64 || y >= field.rows as f64 {
        return false;
    }
    let cell = (y.floor() * field.cols as f64 + x.floor()) as usize;
    if field.play[cell] == 0 {
        return false;
    }
    if field.holders[cell] == side {
        return true;
    }
    let value = read_field(field, x, y);
    if side as f64 == HOLDER_SIDE_A {
        value < 0.0
    } else {
        value > 0.0
    }
}

pub fn draw_traits(troop: &mut Troop, seed: &str, name: &str, side: f64, index: f64, even: bool) {
    troop.drawn = true;
    if even {
        return;
    }
    let draw = |trait_name: &str| (hash_seed(&format!("{seed}|{name}|{}|{}|{trait_name}", js::number_to_string(side), js::number_to_string(index))) % 10000) as f64 / 10000.0;
    troop.drive = TRAIT_DRIVE[0] + (TRAIT_DRIVE[1] - TRAIT_DRIVE[0]) * draw("drive");
    troop.depth = TRAIT_DEPTH[0] + (TRAIT_DEPTH[1] - TRAIT_DEPTH[0]) * draw("depth");
    troop.lane = TRAIT_LANE[0] + (TRAIT_LANE[1] - TRAIT_LANE[0]) * draw("lane");
    let at = jsmath::min(TRAIT_LAG_DAYS.len() as f64 - 1.0, (TRAIT_LAG_DAYS.len() as f64 * draw("lag")).floor());
    troop.lag = TRAIT_LAG_DAYS[at as usize];
}

pub fn troops_least(factor: f64) -> f64 {
    jsmath::max(2.0, jsmath::round(TROOPS_MIN * factor))
}

pub fn troops_cap(line_km: f64, factor: f64) -> f64 {
    jsmath::max(troops_least(factor), jsmath::min(MAX_TROOPS_PER_SIDE, ((line_km * factor) / TROOPS_LINE_KM_EACH).floor()))
}

pub fn troops_factor(value: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        jsmath::max(TROOPS_FACTOR_LEAST, jsmath::min(TROOPS_FACTOR_MOST, value))
    } else {
        1.0
    }
}

pub fn effort_factor(effort: &str) -> f64 {
    EFFORT_FACTORS.iter().find(|(name, _)| *name == effort).map(|(_, factor)| *factor).unwrap_or(1.0)
}

pub fn troops_wanted(strength: f64, effort: &str, factor: f64) -> f64 {
    TROOPS_PER_STRENGTH * factor * jsmath::max(0.0, strength) * effort_factor(effort)
}

pub struct Sized {
    pub counts: [f64; 2],
    pub quality: [f64; 2],
}

pub fn size_sides(line_km: f64, strengths: [f64; 2], efforts: [&str; 2], factor: f64) -> Sized {
    let cap = troops_cap(line_km, factor);
    let wanted = [troops_wanted(strengths[0], efforts[0], factor), troops_wanted(strengths[1], efforts[1], factor)];
    let counts = wanted.map(|count| jsmath::max(troops_least(factor), jsmath::min(cap, jsmath::round(count))));
    let over = [wanted[0] / counts[0], wanted[1] / counts[1]];
    let both = jsmath::max(1.0, jsmath::min(over[0], over[1]));
    let quality = over.map(|share| jsmath::min(QUALITY_MAX, jsmath::max(QUALITY_MIN, share / both)));
    Sized { counts, quality }
}

fn spread(index: f64) -> f64 {
    let turned = (index + 1.0) * 0.6180339887498949;
    turned - turned.floor()
}

pub fn or_else<F: FnOnce() -> f64>(first: f64, then: F) -> f64 {
    if first != 0.0 && !first.is_nan() {
        first
    } else {
        then()
    }
}

pub fn kinds_for(count: usize, era: usize, mix: Option<Mix>) -> Vec<f64> {
    let armour_share = match mix.and_then(|mix| mix.armour) {
        Some(share) if share.is_finite() => share,
        _ => ARMOUR_SHARE_BY_ERA.get(era).copied().unwrap_or(f64::NAN),
    };
    let artillery_share = match mix.and_then(|mix| mix.artillery) {
        Some(share) if share.is_finite() => share,
        _ => ARTILLERY_SHARE_BY_ERA.get(era).copied().unwrap_or(f64::NAN),
    };
    let total = count as f64;
    let armour = jsmath::min(total, jsmath::round(total * armour_share));
    let artillery = jsmath::min(total - armour, jsmath::round(total * artillery_share));
    let mut ranked: Vec<usize> = (0..count).collect();
    js::stable_sort_by(&mut ranked, |&a, &b| or_else(spread(a as f64) - spread(b as f64), || a as f64 - b as f64));
    let mut kinds = vec![KIND_INFANTRY; count];
    for (turn, &rank) in ranked.iter().enumerate() {
        let turn = turn as f64;
        if turn < armour {
            kinds[rank] = KIND_ARMOUR;
        } else if turn < armour + artillery {
            kinds[rank] = KIND_ARTILLERY;
        }
    }
    kinds
}

pub fn share_out(count: f64, weights: &[f64]) -> Vec<f64> {
    let total = weights.iter().fold(0.0, |sum, &weight| sum + jsmath::max(0.0, weight));
    let parts: Vec<f64> = weights.iter().map(|&weight| if total > 0.0 { (count * jsmath::max(0.0, weight)) / total } else { count / weights.len() as f64 }).collect();
    let mut shares: Vec<f64> = parts.iter().map(|part| part.floor()).collect();
    let mut left = count - shares.iter().fold(0.0, |sum, share| sum + share);
    let mut order: Vec<usize> = (0..parts.len()).collect();
    js::stable_sort_by(&mut order, |&a, &b| or_else((parts[b] - shares[b]) - (parts[a] - shares[a]), || a as f64 - b as f64));
    if order.is_empty() {
        return shares;
    }
    let mut turn = 0;
    while left > 0.0 {
        shares[order[turn % order.len()]] += 1.0;
        turn += 1;
        left -= 1.0;
    }
    shares
}

#[derive(Clone, Copy)]
struct Piece {
    from: usize,
    to: usize,
    km: f64,
    start: f64,
}

struct Stretch {
    list: Vec<Piece>,
    length: f64,
}

fn at_or_nan(list: &[f64], index: i64) -> f64 {
    if index >= 0 && (index as usize) < list.len() {
        list[index as usize]
    } else {
        f64::NAN
    }
}

pub fn plan_lanes(battle: &mut Battle, side: usize, line: &Line) {
    let bodies = bodies_of(battle.field.as_mut().expect("a battle with a field"), side);
    let field = battle.field.as_ref().unwrap();
    let place = &battle.place;
    let contour = &line.contour;
    let measured = &line.measured;
    let count = measured.count;
    let own = if side as f64 == HOLDER_SIDE_A { &contour.cell_a } else { &contour.cell_b };
    let mut body = vec![-1i32; count];
    let mut starts = Vec::new();
    for strand in &contour.strands {
        let (first, length) = (strand.first, strand.count);
        starts.push(measured.km[first]);
        for step in 0..length {
            let vertex = first + step;
            if own[vertex] >= 0 {
                body[vertex] = bodies.label[own[vertex] as usize];
            } else if step > 0 {
                body[vertex] = body[vertex - 1];
            }
        }
        if length >= 2 {
            for step in (0..=length - 2).rev() {
                if body[first + step] < 0 {
                    body[first + step] = body[first + step + 1];
                }
            }
        }
    }
    starts.push(measured.total);
    let piece_km = |from: usize, to: usize| -> f64 { (if to > from { measured.km[to] } else { starts[(measured.strand[from] + 1) as usize] }) - measured.km[from] };
    let mut lane_at = vec![0.0f64; count];
    let mut stretches: HashMap<i32, Stretch> = HashMap::new();
    for strand in &contour.strands {
        let (first, length) = (strand.first, strand.count);
        let segments = if strand.closed { length } else { length.saturating_sub(1) };
        for step in 0..segments {
            let from = first + step;
            let to = first + ((step + 1) % length);
            if body[from] < 0 || body[from] != body[to] {
                continue;
            }
            let length_km = piece_km(from, to);
            if !(length_km > 0.0) {
                continue;
            }
            if !stretches.contains_key(&body[from]) {
                stretches.insert(body[from], Stretch { list: Vec::new(), length: 0.0 });
            }
            let stretch = stretches.get_mut(&body[from]).unwrap();
            lane_at[from] = stretch.length;
            stretch.list.push(Piece { from, to, km: length_km, start: stretch.length });
            stretch.length += length_km;
            if to > from {
                lane_at[to] = stretch.length;
            }
        }
    }
    let side_u8 = side as u8;
    let mut feet: Vec<Option<(f64, Option<Station>)>> = Vec::with_capacity(battle.troops[side].len());
    for troop in &battle.troops[side] {
        if !is_live(troop) {
            feet.push(None);
            continue;
        }
        let standing = own_cell(field, side_u8, troop.x, troop.y);
        let body_id = if standing >= 0 { bodies.label[standing as usize] } else { -1 };
        let stretch = match if body_id >= 0 { stretches.get(&body_id) } else { None } {
            Some(stretch) => stretch,
            None => {
                feet.push(Some((body_id as f64, None)));
                continue;
            }
        };
        let mut from: i64 = -1;
        let mut to: i64 = -1;
        let mut part = 0.0;
        let mut length_km = 0.0;
        let mut at = 0.0;
        let lead = control_radius(troop, |y| place.km_at(y)) * 0.5;
        let found = nearest_on_contour(field, contour, troop.x + troop.hx * lead, troop.y + troop.hy * lead, FOOT_REACH_CELLS);
        let near_own = found.distance != f64::INFINITY && found.segment >= 0 && {
            let segment = found.segment as usize;
            body[contour.from[segment] as usize] == body_id && body[contour.to[segment] as usize] == body_id
        };
        if near_own {
            let segment = found.segment as usize;
            from = contour.from[segment] as i64;
            to = contour.to[segment] as i64;
            part = found.along;
            length_km = piece_km(from as usize, to as usize);
            at = lane_at[from as usize];
        } else {
            let mut best = f64::INFINITY;
            for piece in &stretch.list {
                for end in 0..2 {
                    let vertex = if end == 0 { piece.from } else { piece.to };
                    let dx = contour.x[vertex] - troop.x;
                    let dy = contour.y[vertex] - troop.y;
                    if dx * dx + dy * dy >= best {
                        continue;
                    }
                    best = dx * dx + dy * dy;
                    from = piece.from as i64;
                    to = piece.to as i64;
                    part = end as f64;
                    length_km = piece.km;
                    at = piece.start;
                }
            }
        }
        let sx = at_or_nan(&contour.x, to) - at_or_nan(&contour.x, from);
        let sy = at_or_nan(&contour.y, to) - at_or_nan(&contour.y, from);
        let span = (sx * sx + sy * sy).sqrt();
        let fx = at_or_nan(&measured.nx, from) + (at_or_nan(&measured.nx, to) - at_or_nan(&measured.nx, from)) * part;
        let fy = at_or_nan(&measured.ny, from) + (at_or_nan(&measured.ny, to) - at_or_nan(&measured.ny, from)) * part;
        let length = (fx * fx + fy * fy).sqrt();
        let nx = if length > 0.0 { fx / length } else if span > 0.0 { sy / span } else { 0.0 };
        let ny = if length > 0.0 { fy / length } else if span > 0.0 { -sx / span } else { 0.0 };
        let station = Station { nx, ny, place: at + length_km * part, ideal_x: at_or_nan(&contour.x, from) + sx * part, ideal_y: at_or_nan(&contour.y, from) + sy * part, ideal_nx: nx, ideal_ny: ny };
        feet.push(Some((body_id as f64, Some(station))));
    }
    let troops = &mut battle.troops[side];
    for (troop, foot) in troops.iter_mut().zip(feet) {
        troop.station = None;
        if let Some((body_id, station)) = foot {
            troop.body = body_id;
            troop.station = station;
        }
    }
    let mut lanes: Vec<usize> = (0..troops.len()).filter(|&index| troops[index].station.is_some()).collect();
    js::stable_sort_by(&mut lanes, |&a, &b| {
        or_else(troops[a].body - troops[b].body, || or_else(troops[a].station.unwrap().place - troops[b].station.unwrap().place, || a as f64 - b as f64))
    });
    let mut members: HashMap<i32, Vec<usize>> = HashMap::new();
    for &index in &lanes {
        let id = troops[index].body as i32;
        if !members.contains_key(&id) {
            members.insert(id, Vec::new());
        }
        members.get_mut(&id).unwrap().push(index);
    }
    let mut ids: Vec<i32> = members.keys().copied().collect();
    js::stable_sort_by(&mut ids, |a, b| *a as f64 - *b as f64);
    for id in ids {
        let list = members.get(&id).unwrap();
        let stretch = stretches.get(&id).unwrap();
        let (segments, whole) = (&stretch.list, stretch.length);
        let total = list.len();
        let mut held = 0.0;
        for piece in segments {
            held += piece.km;
        }
        let mut ideal = vec![0.0f64; total];
        let mut passed = 0.0;
        let mut item = 0;
        for rank in 0..total {
            let wanted = ((rank as f64 + 0.5) / total as f64) * held;
            let mut piece = segments[item].km;
            while item + 1 < segments.len() && passed + piece < wanted {
                passed += piece;
                item += 1;
                piece = segments[item].km;
            }
            ideal[rank] = segments[item].start + segments[item].km * (if piece > 0.0 { jsmath::min(1.0, jsmath::max(0.0, (wanted - passed) / piece)) } else { 0.0 });
        }
        let gap = |rank: usize| -> f64 {
            let low = rank.saturating_sub(1);
            let high = (rank + 1).min(total - 1);
            if high > low {
                (ideal[high] - ideal[low]) / (high - low) as f64
            } else {
                whole
            }
        };
        let mut shifted = vec![0.0f64; total];
        for rank in 0..total {
            shifted[rank] = jsmath::min(whole, jsmath::max(0.0, ideal[rank] + troops[list[rank]].lane * gap(rank)));
            if rank > 0 {
                shifted[rank] = jsmath::max(shifted[rank], jsmath::min(whole, shifted[rank - 1] + LANE_GAP_MIN * jsmath::min(gap(rank), gap(rank - 1))));
            }
        }
        item = 0;
        for rank in 0..total {
            while item + 1 < segments.len() && segments[item].start + segments[item].km <= shifted[rank] {
                item += 1;
            }
            let Piece { from, to, km, start } = segments[item];
            let part = jsmath::min(1.0, jsmath::max(0.0, (shifted[rank] - start) / km));
            let station = troops[list[rank]].station.as_mut().unwrap();
            station.ideal_x = contour.x[from] + (contour.x[to] - contour.x[from]) * part;
            station.ideal_y = contour.y[from] + (contour.y[to] - contour.y[from]) * part;
            let nx = measured.nx[from] + (measured.nx[to] - measured.nx[from]) * part;
            let ny = measured.ny[from] + (measured.ny[to] - measured.ny[from]) * part;
            let length = (nx * nx + ny * ny).sqrt();
            station.ideal_nx = if length > 0.0 { nx / length } else { station.nx };
            station.ideal_ny = if length > 0.0 { ny / length } else { station.ny };
        }
    }
}

pub fn stand_at_places(battle: &mut Battle, side: usize) {
    let field = battle.field.as_ref().expect("a battle with a field");
    let back = if side as f64 == HOLDER_SIDE_A { -1.0 } else { 1.0 };
    let place = &battle.place;
    for troop in battle.troops[side].iter_mut() {
        let station = match troop.station {
            Some(station) => station,
            None => continue,
        };
        let depth = stand_off(troop, |y| place.km_at(y));
        for share in [1.0, 0.5, 0.25, 0.05] {
            let x = station.ideal_x + station.ideal_nx * back * depth * share;
            let y = station.ideal_y + station.ideal_ny * back * depth * share;
            if !stands(field, side as u8, x, y) {
                continue;
            }
            troop.x = x;
            troop.y = y;
            break;
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn step_along<F: FnMut(f64, f64) -> bool>(x: f64, y: f64, hx: f64, hy: f64, length: f64, mut allowed: F, out: &mut [f64; 2]) -> bool {
    for turn in -1..(TURNS.len() as i64 / 2) {
        let (cos, sin) = if turn < 0 { (1.0, 0.0) } else { (TURNS[turn as usize * 2], TURNS[turn as usize * 2 + 1]) };
        let tx = x + (hx * cos - hy * sin) * length;
        let ty = y + (hx * sin + hy * cos) * length;
        if !allowed(tx, ty) {
            continue;
        }
        out[0] = tx;
        out[1] = ty;
        return true;
    }
    false
}

pub fn drop_the_dead(troops: [Vec<Troop>; 2], named: &[Named]) -> ([Vec<Troop>; 2], Vec<Named>) {
    let mut kept: [Vec<Troop>; 2] = [Vec::new(), Vec::new()];
    let mut moved: [OrdMap<usize, usize>; 2] = [OrdMap::new(), OrdMap::new()];
    for (side, list) in troops.into_iter().enumerate() {
        for (index, troop) in list.into_iter().enumerate() {
            if !is_live(&troop) {
                continue;
            }
            moved[side].set(index, kept[side].len());
            kept[side].push(troop);
        }
    }
    let mut names: Vec<Named> = Vec::new();
    for entry in named {
        let index = match moved.get(entry.s).and_then(|moved| moved.get(&entry.i)) {
            Some(index) => *index,
            None => continue,
        };
        if !kept[entry.s][index].named {
            continue;
        }
        names.push(Named { i: index, ..entry.clone() });
    }
    for side in 0..2 {
        for (index, troop) in kept[side].iter_mut().enumerate() {
            if troop.named && !names.iter().any(|entry| entry.s == side && entry.i == index) {
                troop.named = false;
            }
        }
    }
    (kept, names)
}
