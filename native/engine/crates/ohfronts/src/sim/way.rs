use super::battle::Battle;
use super::command::nearest_on_route;
use super::constants::*;
use super::engine::Run;
use super::field::Field;
use super::ground::{cell_at, cheapest_way, clear_between, downhill, measure, outward_of};
use super::js::{self, Val};
use super::sectors::Place;
use super::troops::{is_live, or_else, Troop, KIND_ARMOUR, KIND_ARTILLERY};
use super::unit_motion::hash_seed;
use crate::jsmath;

pub fn take_order(troop: &mut Troop, next: Val) {
    let busy = troop.order.truthy() && !troop.order.get("done").truthy() && matches!(troop.order.get("kind"), Val::Str(kind) if kind == "reduce" || kind == "assault");
    if busy && next.truthy() {
        if let Val::Obj(order) = &mut troop.order {
            order.set("resume", next);
        }
    } else {
        troop.order = next;
    }
}

pub fn chance_of(battle: &Battle, parts: &[Val]) -> f64 {
    let mut words = vec![battle.seed.clone(), battle.name.clone()];
    words.extend(parts.iter().map(|part| part.string_or_empty()));
    (hash_seed(&words.join("|")) % 10000) as f64 / 10000.0
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Leg {
    pub ax: f64,
    pub ay: f64,
    pub ox: f64,
    pub oy: f64,
    pub length: f64,
}

impl Leg {
    pub fn of(value: &Val) -> Leg {
        let n = |key: &str| value.get(key).num();
        Leg { ax: n("ax"), ay: n("ay"), ox: n("ox"), oy: n("oy"), length: n("length") }
    }

    pub fn val(&self) -> Val {
        Val::obj([("ax", Val::Num(self.ax)), ("ay", Val::Num(self.ay)), ("ox", Val::Num(self.ox)), ("oy", Val::Num(self.oy)), ("length", Val::Num(self.length))])
    }
}

pub fn legs_val(legs: &[Leg]) -> Val {
    Val::Arr(legs.iter().map(Leg::val).collect())
}

pub fn legs_of(from: [f64; 2], points: &[[f64; 2]]) -> Vec<Leg> {
    let mut legs = Vec::new();
    let [mut x, mut y] = from;
    for &[ox, oy] in points {
        let dx = ox - x;
        let dy = oy - y;
        let length = (dx * dx + dy * dy).sqrt();
        if length > 0.01 {
            legs.push(Leg { ax: dx / length, ay: dy / length, ox, oy, length });
        }
        x = ox;
        y = oy;
    }
    legs
}

fn bends_of(field: &Field, cells: &[usize]) -> Vec<[f64; 2]> {
    let point = |index: usize| [(cells[index] % field.cols) as f64 + 0.5, (cells[index] / field.cols) as f64 + 0.5];
    let mut pulled = vec![0usize];
    let mut at = 0;
    while at + 1 < cells.len() {
        let mut next = at + 1;
        let [ax, ay] = point(at);
        let mut far = cells.len() - 1;
        while far > at + 1 {
            let [bx, by] = point(far);
            if clear_between(field, ax, ay, bx, by) {
                next = far;
                break;
            }
            far -= 1;
        }
        pulled.push(next);
        at = next;
    }
    if (pulled.len() - 1) as f64 <= WAY_LEGS_MAX {
        return pulled[1..].iter().map(|&index| point(index)).collect();
    }
    let mut kept = vec![0usize, cells.len() - 1];
    while ((kept.len() - 1) as f64) < WAY_LEGS_MAX {
        let mut worst = WAY_BEND_CELLS;
        let mut at: i64 = -1;
        for span in 0..kept.len() - 1 {
            let [ax, ay] = point(kept[span]);
            let [bx, by] = point(kept[span + 1]);
            let length = ((bx - ax) * (bx - ax) + (by - ay) * (by - ay)).sqrt();
            if !(length > 0.0) {
                continue;
            }
            for index in kept[span] + 1..kept[span + 1] {
                let [px, py] = point(index);
                let off = ((px - ax) * (by - ay) - (py - ay) * (bx - ax)).abs() / length;
                if off > worst {
                    worst = off;
                    at = index as i64;
                }
            }
        }
        if at < 0 {
            break;
        }
        kept.push(at as usize);
        kept.sort();
    }
    kept[1..].iter().map(|&index| point(index)).collect()
}

fn to_other(battle: &mut Battle, side: usize) -> Vec<i32> {
    measure(battle.field.as_ref().unwrap(), &mut battle.to_side);
    battle.to_side.as_ref().unwrap().sides[1 - side].clone()
}

struct Standing {
    mid_x: f64,
    mid_y: f64,
    out_x: f64,
    out_y: f64,
}

fn standing_of(battle: &mut Battle, side: usize, picked: &[usize]) -> Standing {
    let grid = to_other(battle, side);
    let field = battle.field.as_ref().unwrap();
    let troops = &battle.troops[side];
    let count = picked.len() as f64;
    let (mut mid_x, mut mid_y, mut out_x, mut out_y) = (0.0, 0.0, 0.0, 0.0);
    let mut aim = [0.0, 0.0];
    for &index in picked {
        mid_x += troops[index].x / count;
        mid_y += troops[index].y / count;
        if downhill(field, &grid, troops[index].x, troops[index].y, &mut aim) {
            out_x += aim[0];
            out_y += aim[1];
        }
    }
    if outward_of(field, side as u8, mid_x, mid_y, OUTWARD_KM / battle.place.km_at(mid_y), &mut aim) {
        return Standing { mid_x, mid_y, out_x: aim[0], out_y: aim[1] };
    }
    let length = (out_x * out_x + out_y * out_y).sqrt();
    Standing { mid_x, mid_y, out_x: if length > 0.0 { out_x / length } else if side == 0 { 1.0 } else { -1.0 }, out_y: if length > 0.0 { out_y / length } else { 0.0 } }
}

pub struct Telling<'a> {
    pub day: f64,
    pub word: &'a str,
    pub way: &'a [[f64; 2]],
    pub standing: &'a Val,
    pub breadth_km: f64,
    pub lagless: bool,
}

fn rank_in(order: &[usize], index: usize) -> f64 {
    order.iter().rposition(|&at| at == index).map(|rank| rank as f64).unwrap_or(f64::NAN)
}

pub fn give(battle: &mut Battle, side: usize, picked: &[usize], how: &Telling) {
    if picked.is_empty() || how.way.is_empty() {
        return;
    }
    let count = picked.len() as f64;
    let (mut mid_x, mut mid_y) = (0.0, 0.0);
    for &index in picked {
        mid_x += battle.troops[side][index].x / count;
        mid_y += battle.troops[side][index].y / count;
    }
    let legs = legs_of([mid_x, mid_y], how.way);
    if legs.is_empty() {
        return;
    }
    let first = legs[0];
    let km = battle.place.km_at(mid_y);
    let word = how.word;
    let troops = &battle.troops[side];
    let across = |index: usize| (troops[index].x - mid_x) * -first.ay + (troops[index].y - mid_y) * first.ax;
    let ahead = |index: usize| (troops[index].x - mid_x) * first.ax + (troops[index].y - mid_y) * first.ay;
    let armour = |index: usize| if troops[index].kind == KIND_ARMOUR { 1.0 } else { 0.0 };
    let mut abreast = picked.to_vec();
    js::stable_sort_by(&mut abreast, |&a, &b| or_else(across(a) - across(b), || a as f64 - b as f64));
    let mut forward = picked.to_vec();
    js::stable_sort_by(&mut forward, |&a, &b| or_else(if word == "spearhead" { armour(b) - armour(a) } else { 0.0 }, || or_else(ahead(b) - ahead(a), || a as f64 - b as f64)));
    let extent = (across(abreast[abreast.len() - 1]) - across(abreast[0])) * km;
    let brush = battle.radius_km[side];
    let mut breadth = if how.breadth_km > 0.0 {
        how.breadth_km
    } else if word == "spearhead" {
        SPEARHEAD_BREADTH_KM
    } else if word == "flank" || word == "encircle" {
        COLUMN_BREADTH_KM
    } else {
        jsmath::max(GROUP_BREADTH_MIN_KM, jsmath::min(count * brush * GROUP_BREADTH_BRUSHES, extent * GROUP_BREADTH_OF_EXTENT))
    };
    if word == "blitz" {
        breadth = jsmath::max(GROUP_BREADTH_MIN_KM, breadth * BLITZ_BREADTH);
    }
    let point = jsmath::max(2.0, (count / 3.0).ceil());
    let legs_value = legs_val(&legs);
    for &index in picked {
        let share = (rank_in(&abreast, index) + 0.5) / count - 0.5;
        let rank = rank_in(&forward, index);
        let kind = battle.troops[side][index].kind;
        let mut slot = share * breadth;
        let mut stop = 1.0;
        if word == "spearhead" {
            let at = [Val::Num(side as f64), Val::Num(index as f64)];
            if rank < point && kind != KIND_ARTILLERY {
                slot = share * breadth * POINT_BREADTH;
                stop = 1.0 - POINT_STOPS_SHORT * chance_of(battle, &[Val::str("point"), at[0].clone(), at[1].clone()]);
            } else {
                let back = jsmath::max(0.0, rank - point) / jsmath::max(1.0, count - point);
                stop = SHOULDER_STOPS[0] + (SHOULDER_STOPS[1] - SHOULDER_STOPS[0]) * (1.0 - back);
                slot = (if share >= 0.0 { 1.0 } else { -1.0 }) * (breadth * SHOULDER_OUT + SHOULDER_OUT_KM[0] + (SHOULDER_OUT_KM[1] - SHOULDER_OUT_KM[0]) * chance_of(battle, &[Val::str("shoulder"), at[0].clone(), at[1].clone()]));
            }
        }
        let troop = &mut battle.troops[side][index];
        let lag = if how.lagless { 0.0 } else { troop.lag + (if troop.dug { 1.0 } else { 0.0 }) + (if word == "blitz" { BLITZ_MASS_DAYS } else { 0.0 }) };
        troop.dug = false;
        let order = Val::obj([
            ("kind", Val::str("way")),
            ("standing", how.standing.clone()),
            ("word", Val::str(word)),
            ("legs", legs_value.clone()),
            ("leg", Val::Num(0.0)),
            ("slot", Val::Num(slot / km)),
            ("stop", Val::Num(stop)),
            ("since", Val::Num(how.day + lag)),
            ("day", Val::Num(how.day)),
        ]);
        take_order(troop, order);
        troop.fallback = Val::Null;
    }
}

fn ground_ahead(field: &Field, side: usize, x: f64, y: f64, ax: f64, ay: f64, reach: f64) -> bool {
    let mut gone = 0.0;
    while gone <= reach {
        let cell = cell_at(field, x + ax * gone, y + ay * gone);
        if cell < 0 || field.play[cell as usize] == 0 {
            return false;
        }
        if field.holders[cell as usize] as usize == 1 - side {
            return true;
        }
        gone += 0.5;
    }
    false
}

fn out_from(battle: &mut Battle, side: usize, x: f64, y: f64, hx: f64, hy: f64) -> [f64; 2] {
    let mut aim = [0.0, 0.0];
    let reach = OUTWARD_KM / battle.place.km_at(y);
    {
        let field = battle.field.as_ref().unwrap();
        if outward_of(field, side as u8, x, y, reach, &mut aim) && ground_ahead(field, side, x, y, aim[0], aim[1], reach) {
            return aim;
        }
    }
    let grid = to_other(battle, side);
    let field = battle.field.as_ref().unwrap();
    if downhill(field, &grid, x, y, &mut aim) {
        return aim;
    }
    if outward_of(field, side as u8, x, y, reach, &mut aim) {
        return aim;
    }
    let facing = hx != 0.0 || hy != 0.0;
    [if facing { hx } else if side == 0 { 1.0 } else { -1.0 }, if facing { hy } else { 0.0 }]
}

fn far_out(battle: &Battle, run: &Run, y: f64) -> f64 {
    (WAY_DAYS_MIN * jsmath::max(jsmath::max(run.advance_km[0], run.advance_km[1]), run.advance_km[2]) * run.pace) / battle.place.km_at(y)
}

fn leg_out(battle: &Battle, run: &Run, x: f64, y: f64, aim: [f64; 2]) -> Vec<Leg> {
    let far = far_out(battle, run, y);
    legs_of([x, y], &[[x + aim[0] * far, y + aim[1] * far]])
}

pub fn give_out(battle: &mut Battle, run: &Run, side: usize, picked: &[usize], day: f64, word: &str, standing: &Val, lagless: bool) {
    for &index in picked {
        let (x, y, hx, hy) = {
            let troop = &battle.troops[side][index];
            (troop.x, troop.y, troop.hx, troop.hy)
        };
        let aim = out_from(battle, side, x, y, hx, hy);
        let legs = leg_out(battle, run, x, y, aim);
        if legs.is_empty() {
            continue;
        }
        let troop = &mut battle.troops[side][index];
        let lag = if lagless { 0.0 } else { troop.lag + (if troop.dug { 1.0 } else { 0.0 }) + (if word == "blitz" { BLITZ_MASS_DAYS } else { 0.0 }) };
        troop.dug = false;
        let order = Val::obj([
            ("kind", Val::str("way")),
            ("standing", standing.clone()),
            ("word", Val::str(word)),
            ("legs", legs_val(&legs)),
            ("leg", Val::Num(0.0)),
            ("slot", Val::Num(0.0)),
            ("stop", Val::Num(1.0)),
            ("since", Val::Num(day + lag)),
            ("day", Val::Num(day)),
            ("own", Val::Bool(true)),
        ]);
        take_order(troop, order);
        troop.fallback = Val::Null;
    }
}

pub fn left_on_leg(leg: &Leg, x: f64, y: f64) -> f64 {
    (leg.ox - x) * leg.ax + (leg.oy - y) * leg.ay
}

fn leg_index(order: &Val) -> usize {
    let leg = order.get("leg").num();
    if leg >= 0.0 && leg.fract() == 0.0 {
        leg as usize
    } else {
        usize::MAX
    }
}

pub fn aim_out(battle: &mut Battle, run: &Run, side: usize, troop: &Troop, order: &mut Val) {
    let at = leg_index(order);
    let leg = Leg::of(order.get("legs").at(at));
    let ahead = ground_ahead(battle.field.as_ref().unwrap(), side, troop.x, troop.y, leg.ax, leg.ay, OUT_AHEAD_KM / battle.place.km_at(troop.y));
    if ahead {
        let short = far_out(battle, run, troop.y) - left_on_leg(&leg, troop.x, troop.y);
        if short > 0.0 {
            if let Val::Obj(obj) = order {
                if let Some(Val::Arr(list)) = obj.get_mut("legs") {
                    if let Some(Val::Obj(entry)) = list.get_mut(at) {
                        entry.set("ox", Val::Num(leg.ox + leg.ax * short));
                        entry.set("oy", Val::Num(leg.oy + leg.ay * short));
                        entry.set("length", Val::Num(leg.length + short));
                    }
                }
            }
        }
        return;
    }
    let aim = out_from(battle, side, troop.x, troop.y, troop.hx, troop.hy);
    let legs = leg_out(battle, run, troop.x, troop.y, aim);
    if legs.is_empty() {
        return;
    }
    if let Val::Obj(entry) = order {
        entry.set("legs", legs_val(&legs));
        entry.set("leg", Val::Num(0.0));
        entry.set("slot", Val::Num(0.0));
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Ways {
    pub ways: Vec<Vec<[f64; 2]>>,
    pub mid_x: f64,
    pub mid_y: f64,
    pub fx: f64,
    pub fy: f64,
}

pub fn ways_for(battle: &mut Battle, run: &Run, side: usize, picked: &[usize], word: &str, target: Option<&Place>, days: f64) -> Ways {
    let Standing { mid_x, mid_y, out_x, out_y } = standing_of(battle, side, picked);
    let km = battle.place.km_at(mid_y);
    let pace_km = jsmath::max(jsmath::max(run.advance_km[0], run.advance_km[1]), run.advance_km[2]) * run.pace;
    let far = (jsmath::max(WAY_DAYS_MIN, days) * pace_km) / km;
    let straight = vec![[mid_x + out_x * far, mid_y + out_y * far]];
    if word == "flank" || word == "encircle" {
        let round = ROUND_KM / km;
        let tx = target.map(|target| target.x).unwrap_or(mid_x + out_x * round * 2.0);
        let ty = target.map(|target| target.y).unwrap_or(mid_y + out_y * round * 2.0);
        let gap = ((tx - mid_x) * (tx - mid_x) + (ty - mid_y) * (ty - mid_y)).sqrt();
        let fx = if gap > 0.0 { (tx - mid_x) / gap } else { out_x };
        let fy = if gap > 0.0 { (ty - mid_y) / gap } else { out_y };
        let arm = |turn: f64| {
            let lx = -fy * turn;
            let ly = fx * turn;
            let mut points = vec![[tx + (lx + fx) * round, ty + (ly + fy) * round], [tx + fx * round, ty + fy * round]];
            if gap > round * 1.5 {
                points.insert(0, [tx + (lx - fx) * round, ty + (ly - fy) * round]);
            }
            points
        };
        if word == "encircle" {
            return Ways { ways: vec![arm(1.0), arm(-1.0)], mid_x, mid_y, fx, fy };
        }
        let beside: Vec<f64> = [1.0, -1.0]
            .iter()
            .map(|&turn| {
                let px = tx + -fy * turn * round;
                let py = ty + fx * turn * round;
                battle.troops[1 - side].iter().filter(|enemy| is_live(enemy) && (enemy.x - px) * (enemy.x - px) + (enemy.y - py) * (enemy.y - py) <= round * round).count() as f64
            })
            .collect();
        return Ways { ways: vec![arm(if beside[1] < beside[0] { -1.0 } else { 1.0 })], mid_x, mid_y, fx, fy };
    }
    let target = match target {
        Some(target) => target,
        None => return Ways { ways: vec![straight], mid_x, mid_y, fx: out_x, fy: out_y },
    };
    let field = battle.field.as_ref().unwrap();
    let playable = |cell: i64| cell >= 0 && field.play.get(cell as usize).is_some_and(|&play| play != 0);
    let mut from = cell_at(field, mid_x, mid_y);
    if !playable(from) {
        let first = &battle.troops[side][picked[0]];
        from = cell_at(field, first.x, first.y);
    }
    let mut goal = if target.kind == "city" {
        match target.cell {
            Some(cell) if cell.fract() == 0.0 && cell >= 0.0 => cell as i64,
            _ => -1,
        }
    } else {
        cell_at(field, target.x, target.y)
    };
    if !playable(goal) {
        goal = -1;
    }
    let cells = if from >= 0 && goal >= 0 { cheapest_way(field, from, goal) } else { None };
    let way = match cells {
        Some(cells) if cells.len() > 1 => bends_of(field, &cells),
        _ => vec![[target.x, target.y]],
    };
    Ways { ways: vec![way], mid_x, mid_y, fx: out_x, fy: out_y }
}

fn route_chance(battle: &Battle, side: usize, index: usize, standing: &Val, what: &str) -> f64 {
    let since = standing.read("since").string_or_empty();
    let text = [battle.name.clone(), "route".to_string(), since, js::number_to_string(side as f64), js::number_to_string(index as f64), what.to_string()].join("|");
    (hash_seed(&text) % 10000) as f64 / 10000.0
}

pub fn give_route(battle: &mut Battle, side: usize, picked: &[usize], day: f64, way: &[[f64; 2]], standing: &Val, lagless: bool) {
    if picked.is_empty() || way.is_empty() {
        return;
    }
    let breadth = jsmath::max(ROUTE_BREADTH_MIN_KM, (picked.len() as f64).sqrt() * battle.radius_km[side] * ROUTE_BREADTH_BRUSHES);
    for &index in picked {
        let (x, y, next) = {
            let troop = &battle.troops[side][index];
            (troop.x, troop.y, troop.next)
        };
        let mut skip = 0usize;
        if way.len() > 1 && lagless && next.is_finite() && next.fract() == 0.0 && next >= 0.0 {
            skip = jsmath::min(next, (way.len() - 1) as f64) as usize;
        } else if way.len() > 1 && lagless {
            let (at, part) = nearest_on_route(way, x, y);
            skip = if at == 0 && part == 0.0 { 0 } else { at + 1 };
        } else if way.len() > 1 {
            let dx = way[1][0] - way[0][0];
            let dy = way[1][1] - way[0][1];
            let from_x = x - way[0][0];
            let from_y = y - way[0][1];
            skip = if from_x * dx + from_y * dy > 0.0 || (from_x * from_x + from_y * from_y).sqrt() * battle.place.km_at(y) <= ROUTE_JOIN_KM { 1 } else { 0 };
        }
        let ahead = if skip > 0 { &way[skip.min(way.len())..] } else { way };
        let legs = legs_of([x, y], ahead);
        if legs.is_empty() {
            continue;
        }
        let km = battle.place.km_at(y);
        let slot = (route_chance(battle, side, index, standing, "place") - 0.5) * breadth;
        let last = legs[legs.len() - 1];
        let short = ROUTE_STOPS_SHORT_KM * route_chance(battle, side, index, standing, "stop");
        let stop = 1.0 - jsmath::min(ROUTE_STOPS_SHORT_MOST, short / jsmath::max(1e-6, last.length * km));
        let wait = (ROUTE_SET_OFF_DAYS * route_chance(battle, side, index, standing, "wait")).floor();
        let troop = &mut battle.troops[side][index];
        let lag = if lagless { 0.0 } else { troop.lag + (if troop.dug { 1.0 } else { 0.0 }) + wait };
        troop.dug = false;
        let order = Val::obj([
            ("kind", Val::str("way")),
            ("standing", standing.clone()),
            ("word", Val::str("path")),
            ("legs", legs_val(&legs)),
            ("leg", Val::Num(0.0)),
            ("skip", Val::Num((skip + ahead.len() - legs.len()) as f64)),
            ("slot", Val::Num(slot / km)),
            ("stop", Val::Num(stop)),
            ("since", Val::Num(day + lag)),
            ("day", Val::Num(day)),
        ]);
        take_order(troop, order);
        troop.fallback = Val::Null;
    }
}
