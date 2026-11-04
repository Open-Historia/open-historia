use super::battle::Battle;
use super::constants::*;
use super::engine::Run;
use super::field::{own_cell, take_capsule, How};
use super::ground::downhill;
use super::manpower::{mend_left_with, mend_spend};
use super::troops::{control_radius, is_live, reach_cells, step_along, Troop, KIND_ARTILLERY, STATE_ADVANCING, STATE_DUG_IN, STATE_ENCIRCLED, STATE_HOLDING, STATE_SPENT};
use super::walls::{wall_ahead, wear_wall, WALL_ASSAULT_COST, WALL_DEFENCE_PER_LEVEL, WALL_ODDS};
use super::weather::weather_loss;
use super::js::Val;
use crate::jsmath;
use super::march::OWN_GROUND_CLEAR;

fn clamp_ratio(value: f64) -> f64 {
    if value < ATTRITION_RATIO_MIN {
        ATTRITION_RATIO_MIN
    } else if value > ATTRITION_RATIO_MAX {
        ATTRITION_RATIO_MAX
    } else {
        value
    }
}

fn terrain_defence(speed: f64) -> f64 {
    1.0 + jsmath::min(0.8, jsmath::max(0.0, 1.0 - speed)) * TERRAIN_DEFENCE_GAIN
}

fn by_kind(table: &[f64; 3], kind: f64) -> f64 {
    if kind >= 0.0 && kind.fract() == 0.0 {
        table.get(kind as usize).copied().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

fn defensive_power(battle: &Battle, side: usize, troop: &Troop, front: bool) -> f64 {
    troop.strength
        * by_kind(&TROOP_DEFENCE, troop.kind)
        * (if !front {
            1.0
        } else if troop.dug {
            battle.works.map(|works| works.defence).unwrap_or(DUG_IN_DEFENCE)
        } else {
            1.0 + troop.dig
        })
        * battle.quality[side]
        * battle.edge[side].power
        * troop.supply
        * (if troop.pocket { POCKET_DEFENCE } else { 1.0 })
        * troop.guard
}

fn offensive_power(battle: &Battle, side: usize, troop: &Troop) -> f64 {
    troop.strength * by_kind(&TROOP_ATTACK, troop.kind) * battle.quality[side] * battle.edge[side].power * troop.supply * (if troop.pocket { POCKET_ATTACK } else { 1.0 }) * troop.punch
}

pub fn look_of(battle: &mut Battle) -> f64 {
    if let Some(look) = battle.look {
        return look;
    }
    let mut least = f64::INFINITY;
    for &km in &battle.place.row_km {
        if km < least {
            least = km;
        }
    }
    let look = jsmath::max(jsmath::max(jsmath::max(REACH_MIN_CELLS, REACH_KM / least), STEER_PRESS_KM / least), 2.0 * jsmath::max(CONTROL_RADIUS_MIN_CELLS, CONTROL_RADIUS_MAX_KM / least)).ceil();
    battle.look = Some(look);
    look
}

#[derive(Clone, Debug, PartialEq)]
pub struct Squares {
    pub heads: Vec<i32>,
    pub nexts: Vec<i32>,
    pub across: f64,
    pub down: f64,
    pub span: f64,
}

pub fn squares_of<F: FnMut(&Troop) -> bool>(span: f64, cols: usize, rows: usize, troops: &[Troop], mut wanted: F) -> Squares {
    let across = (cols as f64 / span).floor() + 1.0;
    let down = (rows as f64 / span).floor() + 1.0;
    let mut heads = vec![-1i32; (across * down) as usize];
    let mut nexts = vec![0i32; troops.len()];
    for index in (0..troops.len()).rev() {
        let troop = &troops[index];
        if !wanted(troop) {
            continue;
        }
        let square = jsmath::min(down - 1.0, jsmath::max(0.0, (troop.y / span).floor())) * across + jsmath::min(across - 1.0, jsmath::max(0.0, (troop.x / span).floor()));
        let at = if square >= 0.0 && square.fract() == 0.0 && (square as usize) < heads.len() { Some(square as usize) } else { None };
        nexts[index] = at.map(|at| heads[at]).unwrap_or(0);
        if let Some(at) = at {
            heads[at] = index as i32;
        }
    }
    Squares { heads, nexts, across, down, span }
}

pub fn battle_squares<F: FnMut(&Troop) -> bool>(battle: &mut Battle, side: usize, wanted: F) -> Squares {
    let span = look_of(battle);
    let field = battle.field.as_ref().unwrap();
    squares_of(span, field.cols, field.rows, &battle.troops[side], wanted)
}

pub fn each_near<F: FnMut(usize)>(squares: &Squares, x: f64, y: f64, mut visit: F) {
    let col = jsmath::min(squares.across - 1.0, jsmath::max(0.0, (x / squares.span).floor()));
    let row = jsmath::min(squares.down - 1.0, jsmath::max(0.0, (y / squares.span).floor()));
    if col.is_nan() || row.is_nan() {
        return;
    }
    for dy in -1i64..=1 {
        let r = row + dy as f64;
        if r < 0.0 || r >= squares.down {
            continue;
        }
        for dx in -1i64..=1 {
            let c = col + dx as f64;
            if c < 0.0 || c >= squares.across {
                continue;
            }
            let mut at = squares.heads[(r * squares.across + c) as usize];
            while at >= 0 {
                visit(at as usize);
                at = squares.nexts[at as usize];
            }
        }
    }
}

fn near(squares: &Squares, x: f64, y: f64) -> Vec<usize> {
    let mut out = Vec::new();
    each_near(squares, x, y, |at| out.push(at));
    out
}

fn spared(spare: &[f64], x: f64, y: f64) -> bool {
    let mut at = 0;
    while at < spare.len() {
        let dx = x - spare[at];
        let dy = y - spare.get(at + 1).copied().unwrap_or(f64::NAN);
        let radius = spare.get(at + 2).copied().unwrap_or(f64::NAN);
        if dx * dx + dy * dy <= radius * radius {
            return true;
        }
        at += 3;
    }
    false
}

fn kernel(distance: f64, reach: f64) -> f64 {
    let left = 1.0 - distance / reach;
    if left > 0.0 {
        left * left
    } else {
        0.0
    }
}

fn steps_today(troop: &Troop) -> bool {
    troop.stepping && is_live(troop)
}

struct Entry {
    side: usize,
    index: usize,
    radius: f64,
    day_cells: f64,
    power: f64,
    from_x: f64,
    from_y: f64,
    length: f64,
    to_x: f64,
    to_y: f64,
}

fn read_defender(battle: &mut Battle, side: usize, index: usize, attackers: &Squares, moment: f64) {
    if battle.troops[side][index].flank_moment == moment {
        return;
    }
    battle.troops[side][index].flank_moment = moment;
    let (x, y) = (battle.troops[side][index].x, battle.troops[side][index].y);
    let reach = reach_cells(|y| battle.place.km_at(y), y);
    let mut face = [0.0; 2];
    let grid = &battle.to_side.as_ref().unwrap().sides[1 - side];
    if !downhill(battle.field.as_ref().unwrap(), grid, x, y, &mut face) {
        let troop = &mut battle.troops[side][index];
        troop.face_x = 0.0;
        troop.face_y = 0.0;
        troop.flank = 1.0;
        return;
    }
    let [face_x, face_y] = face;
    let mut round = 1.0;
    for at in near(attackers, x, y) {
        let attacker = &battle.troops[1 - side][at];
        let dx = attacker.x - x;
        let dy = attacker.y - y;
        let apart = (dx * dx + dy * dy).sqrt();
        if !(apart > 0.0) || apart > reach {
            continue;
        }
        let before = (dx * face_x + dy * face_y) / apart;
        if before < round {
            round = before;
        }
    }
    let troop = &mut battle.troops[side][index];
    troop.face_x = face_x;
    troop.face_y = face_y;
    troop.flank = if round < FLANK_OPPOSITE_COS {
        SURROUNDED_DEFENCE
    } else if round < FLANK_BEHIND_COS {
        FLANKED_DEFENCE
    } else {
        1.0
    };
}

fn defence_against(battle: &Battle, side: usize, defender: &Troop, x: f64, y: f64) -> f64 {
    let front = (x - defender.x) * defender.face_x + (y - defender.y) * defender.face_y >= 0.0;
    defensive_power(battle, side, defender, front) * defender.flank * (match defender.walled {
        Some(walled) if walled > 0.0 => 1.0 + WALL_DEFENCE_PER_LEVEL * walled,
        _ => 1.0,
    })
}

fn in_play(battle: &Battle, x: f64, y: f64) -> bool {
    let field = battle.field.as_ref().unwrap();
    x >= 0.0 && y >= 0.0 && x < field.cols as f64 && y < field.rows as f64 && field.play[(y.floor() * field.cols as f64 + x.floor()) as usize] == 1
}

fn cell_index(battle: &Battle, x: f64, y: f64) -> usize {
    (y.floor() * battle.field.as_ref().unwrap().cols as f64 + x.floor()) as usize
}

pub fn step_forward(run: &Run, battle: &mut Battle, pace_km: &[f64], pace: f64) -> f64 {
    let mut active: Vec<Entry> = Vec::new();
    for side in 0..2 {
        for index in 0..battle.troops[side].len() {
            if !steps_today(&battle.troops[side][index]) {
                continue;
            }
            battle.troops[side][index].entry = Val::Bool(true);
            active.push(Entry { side, index, radius: 0.0, day_cells: 0.0, power: 0.0, from_x: 0.0, from_y: 0.0, length: 0.0, to_x: 0.0, to_y: 0.0 });
        }
    }
    let mut parts = 1.0;
    for entry in active.iter_mut() {
        let troop = &battle.troops[entry.side][entry.index];
        let field = battle.field.as_ref().unwrap();
        let cell = jsmath::max(0.0, own_cell(field, entry.side as u8, troop.x, troop.y) as f64) as usize;
        entry.radius = control_radius(troop, |y| battle.place.km_at(y));
        let pace_of = if troop.kind >= 0.0 && troop.kind.fract() == 0.0 { pace_km.get(troop.kind as usize).copied().unwrap_or(f64::NAN) } else { f64::NAN };
        entry.day_cells = (pace_of * battle.arena.speed[cell] as f64 * troop.supply * pace * troop.drive * troop.pace_factor * battle.edge[entry.side].pace * troop.legs) / battle.place.km_at(troop.y);
        if battle.own_pace > 1.0 {
            let clear = battle.to_side.as_ref().map_or(f64::NAN, |to_side| to_side.sides[1 - entry.side][cell] as f64 / 3.0);
            if clear > entry.radius * OWN_GROUND_CLEAR {
                entry.day_cells *= battle.own_pace;
            }
        }
        parts = jsmath::max(parts, (entry.day_cells / (entry.radius * 0.5)).ceil());
    }
    parts = jsmath::min(SUBSTEPS_MAX, parts);
    let share = (ATTRITION / 100.0) / parts;
    let mut part = 0.0;
    while part < parts && !active.is_empty() {
        battle.claims.moment += 1.0;
        let stepping = [battle_squares(battle, 0, steps_today), battle_squares(battle, 1, steps_today)];
        let standing = [battle_squares(battle, 0, is_live), battle_squares(battle, 1, is_live)];
        for entry in active.iter_mut() {
            let side = entry.side;
            let (x, y, gx, gy) = {
                let troop = &battle.troops[side][entry.index];
                (troop.x, troop.y, troop.gx, troop.gy)
            };
            let reach = reach_cells(|y| battle.place.km_at(y), y);
            let mut attack = 0.0;
            for at in near(&stepping[side], x, y) {
                let other = &battle.troops[side][at];
                let dx = other.x - x;
                let dy = other.y - y;
                let weight = kernel((dx * dx + dy * dy).sqrt(), reach);
                if weight > 0.0 {
                    attack += offensive_power(battle, side, other) * weight;
                }
            }
            let ahead_x = x + gx * entry.radius;
            let ahead_y = y + gy * entry.radius;
            let mut defence = 0.0;
            let mut entrenched = 0.0;
            let moment = battle.claims.moment;
            for at in near(&standing[1 - side], ahead_x, ahead_y) {
                let (ex, ey, besieged) = {
                    let enemy = &battle.troops[1 - side][at];
                    (enemy.x, enemy.y, enemy.besieged)
                };
                if besieged || spared(&battle.spared[side], ex, ey) {
                    continue;
                }
                let dx = ex - ahead_x;
                let dy = ey - ahead_y;
                let weight = kernel((dx * dx + dy * dy).sqrt(), reach);
                if !(weight > 0.0) {
                    continue;
                }
                read_defender(battle, 1 - side, at, &stepping[side], moment);
                let enemy = &battle.troops[1 - side][at];
                let piece = defence_against(battle, 1 - side, enemy, x, y) * weight;
                defence += piece;
                if let Some(works) = battle.works {
                    if enemy.dug || enemy.dig > 0.0 {
                        entrenched += piece * (if enemy.dug { 1.0 } else if enemy.dig < works.most { enemy.dig / works.most } else { 1.0 });
                    }
                }
            }
            let raw = defence;
            if in_play(battle, ahead_x, ahead_y) {
                defence *= terrain_defence(battle.arena.speed[cell_index(battle, ahead_x, ahead_y)] as f64);
            }
            let ratio = if defence > 0.0 { attack / defence } else { f64::INFINITY };
            let theirs = in_play(battle, ahead_x, ahead_y) && battle.field.as_ref().unwrap().holders[cell_index(battle, ahead_x, ahead_y)] as usize == 1 - side;
            let open = if theirs { jsmath::min(1.0, 1.0 / battle.edge[1 - side].power) } else { 1.0 };
            let gain = jsmath::min(open, if defence > 0.0 { jsmath::min(1.0, jsmath::max(0.0, (GAIN * (ratio - RATIO_NEEDED)) / (ratio + RATIO_SOFTNESS))) } else { 1.0 });
            entry.power = attack;
            entry.from_x = x;
            entry.from_y = y;
            let length = jsmath::min((entry.day_cells * gain) / parts, entry.radius * 0.5);
            let ahead = if length > 0.5 { length } else { 0.5 };
            let wall = if battle.walls.is_some() { wall_ahead(run, battle, side, x + gx * ahead, y + gy * ahead) } else { None };
            let mut ended = [0.0; 2];
            let stepped = wall.is_none() && length > 0.0 && {
                let troop = &battle.troops[side][entry.index];
                let field = battle.field.as_ref().unwrap();
                let spare = &battle.spared[side];
                let kept = battle.kept[side].as_deref();
                let (axis_x, axis_y) = (troop.axis_x, troop.axis_y);
                step_along(
                    x,
                    y,
                    gx,
                    gy,
                    length,
                    |tx, ty| {
                        tx >= 0.0
                            && ty >= 0.0
                            && tx < field.cols as f64
                            && ty < field.rows as f64
                            && field.play[(ty.floor() * field.cols as f64 + tx.floor()) as usize] == 1
                            && !spared(spare, tx, ty)
                            && !kept.map(|kept| kept[(ty.floor() * field.cols as f64 + tx.floor()) as usize] != 0).unwrap_or(false)
                            && (tx - x) * axis_x + (ty - y) * axis_y >= 0.0
                    },
                    &mut ended,
                )
            };
            entry.length = if stepped { length } else { 0.0 };
            entry.to_x = if entry.length > 0.0 { ended[0] } else { x };
            entry.to_y = if entry.length > 0.0 { ended[1] } else { y };
            if let Some(wall) = wall {
                if attack > 0.0 {
                    let artillery = battle.troops[side][entry.index].kind == KIND_ARTILLERY;
                    wear_wall(run, battle, wall, if raw > 0.0 { attack / defence } else { WALL_ODDS }, artillery, 1.0 / parts);
                    let troop = &mut battle.troops[side][entry.index];
                    troop.loss += troop.strength * share * ATTACK_COST * (WALL_ASSAULT_COST - 1.0);
                    troop.fought = true;
                }
            }
            if raw > 0.0 && attack > 0.0 {
                let works = match battle.works {
                    Some(works) if raw > 0.0 => 1.0 + (works.assault - 1.0) * (if entrenched < raw { entrenched / raw } else { 1.0 }),
                    _ => 1.0,
                };
                let reducing = {
                    let troop = &mut battle.troops[side][entry.index];
                    troop.loss += troop.strength * share * ATTACK_COST * clamp_ratio((defence / attack).sqrt()) * works;
                    troop.fought = true;
                    troop.reducing
                };
                let theirs = share * clamp_ratio((attack / defence).sqrt());
                for at in near(&standing[1 - side], ahead_x, ahead_y) {
                    let enemy = &battle.troops[1 - side][at];
                    if enemy.besieged || spared(&battle.spared[side], enemy.x, enemy.y) {
                        continue;
                    }
                    let dx = enemy.x - ahead_x;
                    let dy = enemy.y - ahead_y;
                    let weight = kernel((dx * dx + dy * dy).sqrt(), reach);
                    if !(weight > 0.0) {
                        continue;
                    }
                    let lost = enemy.strength * theirs * ((defence_against(battle, 1 - side, enemy, x, y) * weight) / raw) * (if reducing && enemy.pocket { CLOSE_WEAR } else { 1.0 });
                    let enemy = &mut battle.troops[1 - side][at];
                    enemy.loss += lost;
                    enemy.engaged = true;
                }
            }
        }
        for side in 0..2 {
            let Battle { field, troops, spared, kept, claims, place, .. } = &mut *battle;
            let field = field.as_mut().unwrap();
            let spare = if spared[side].is_empty() { None } else { Some(spared[side].as_slice()) };
            let keep = kept[side].as_deref();
            for entry in active.iter() {
                if entry.side != side || !(entry.length > 0.0) {
                    continue;
                }
                let troop = &mut troops[side][entry.index];
                take_capsule(
                    field,
                    side as u8,
                    entry.from_x,
                    entry.from_y,
                    entry.to_x,
                    entry.to_y,
                    entry.radius,
                    entry.radius,
                    How { claims: Some(&mut *claims), strength: entry.power, painter: troop.owner, painter_q: None, from: Some(part / parts), span: 1.0 / parts, spare, keep },
                );
                troop.x = entry.to_x;
                troop.y = entry.to_y;
                troop.moved_km += entry.length * place.km_at(troop.y);
                troop.walked_today = true;
            }
        }
        part += 1.0;
    }
    for entry in &active {
        battle.troops[entry.side][entry.index].entry = Val::Null;
    }
    for side in 0..2 {
        let Battle { field, troops, spared, kept, place, .. } = &mut *battle;
        let field = field.as_mut().unwrap();
        let spare = if spared[side].is_empty() { None } else { Some(spared[side].as_slice()) };
        let keep = kept[side].as_deref();
        for troop in troops[side].iter_mut() {
            if !troop.plant || !is_live(troop) {
                continue;
            }
            let radius = control_radius(troop, |y| place.km_at(y));
            take_capsule(field, side as u8, troop.x, troop.y, troop.x, troop.y, radius, radius, How { painter: troop.owner, spare, keep, ..How::default() });
            troop.walked_today = true;
        }
    }
    if !active.is_empty() {
        parts
    } else {
        0.0
    }
}

pub fn close_day(run: &Run, battle: &mut Battle) {
    let standing = [battle_squares(battle, 0, is_live), battle_squares(battle, 1, is_live)];
    for side in 0..2 {
        for index in 0..battle.troops[side].len() {
            let troop = &battle.troops[side][index];
            if !is_live(troop) {
                continue;
            }
            if !troop.besieged && !troop.engaged && !troop.walked_today && troop.loss == 0.0 {
                let (x, y) = (troop.x, troop.y);
                let reach = reach_cells(|y| battle.place.km_at(y), y);
                let mut theirs = 0.0;
                let mut ours = 0.0;
                for at in near(&standing[1 - side], x, y) {
                    let enemy = &battle.troops[1 - side][at];
                    let dx = enemy.x - x;
                    let dy = enemy.y - y;
                    theirs += enemy.strength * kernel((dx * dx + dy * dy).sqrt(), reach);
                }
                if theirs > 0.0 {
                    for at in near(&standing[side], x, y) {
                        let friend = &battle.troops[side][at];
                        let dx = friend.x - x;
                        let dy = friend.y - y;
                        ours += friend.strength * kernel((dx * dx + dy * dy).sqrt(), reach);
                    }
                    let troop = &mut battle.troops[side][index];
                    troop.loss += troop.strength * (ATTRITION / 100.0) * QUIET_ATTRITION * clamp_ratio(theirs / ours);
                }
            }
        }
    }
    for side in 0..2 {
        let Battle { troops, sky, exposure, lost_by, works, .. } = &mut *battle;
        for troop in troops[side].iter_mut() {
            if !is_live(troop) {
                continue;
            }
            let wasting = if troop.besieged {
                SIEGE_LOSS
            } else if troop.sealed {
                POCKET_LOSS
            } else if troop.squeezed {
                SQUEEZED_LOSS
            } else {
                0.0
            };
            let weathered = if sky.is_some() { weather_loss(sky.as_ref(), troop, exposure.map(|both| both[side])) } else { 0.0 };
            let wasted = wasting + weathered;
            if let Some(lost) = lost_by.as_mut() {
                if wasted > 0.0 {
                    lost[side].add(troop.owner as usize, if wasted < troop.strength { wasted } else { troop.strength });
                }
            }
            troop.strength -= troop.loss * (if troop.dug { works.map(|works| works.loss).unwrap_or(DUG_IN_LOSS) } else { 1.0 }) + wasted;
            if troop.pocket && !troop.besieged && troop.engaged && troop.strength < GIVES_UP_UNDER {
                troop.strength = 0.0;
            }
        }
    }
    for side in 0..2 {
        for index in 0..battle.troops[side].len() {
            let mend = battle.edge[side].mend;
            let works = battle.works;
            let name = battle.sides[side].get(battle.troops[side][index].owner as usize).cloned().unwrap_or_default();
            let left = {
                let troop = &battle.troops[side][index];
                if battle.mend_of && troop.strength > 0.0 && !troop.pocket && troop.strength < 100.0 && battle.pool[side] > 0.0 {
                    mend_left_with(run, &name, Some(&*battle))
                } else {
                    f64::NAN
                }
            };
            let troop = &mut battle.troops[side][index];
            if troop.strength > 0.0 {
                let busy = !matches!(troop.order, Val::Null) && !troop.order.get("done").truthy();
                if troop.dug {
                    troop.dig = 1.0;
                } else if troop.moved_km > DIG_LOST_KM {
                    troop.dig = 0.0;
                } else if !busy && troop.dig < works.map(|works| works.most).unwrap_or(DIG_MAX_HOLD) {
                    let most = works.map(|works| works.most).unwrap_or(DIG_MAX_HOLD);
                    troop.dig = jsmath::min(most, troop.dig + works.map(|works| works.per_day).unwrap_or(DIG_PER_DAY_HOLD));
                }
                if !troop.pocket && troop.strength < 100.0 && battle.pool[side] > 0.0 {
                    let sent = if battle.mend_of {
                        jsmath::min(jsmath::min(jsmath::min(REINFORCE_PER_DAY * mend, 100.0 - troop.strength), battle.pool[side]), left)
                    } else {
                        jsmath::min(jsmath::min(REINFORCE_PER_DAY * mend, 100.0 - troop.strength), battle.pool[side])
                    };
                    if battle.mend_of {
                        mend_spend(run, &name, sent);
                    }
                    troop.strength += sent;
                    battle.pool[side] -= sent;
                    let owner = troop.owner as usize;
                    let mended = &mut battle.mended_by[side];
                    if mended.len() <= owner {
                        mended.resize(owner + 1, None);
                    }
                    mended[owner] = Some(mended[owner].unwrap_or(0.0) + sent);
                }
            } else {
                troop.strength = 0.0;
                troop.dig = 0.0;
                troop.dug = false;
                troop.order = Val::Null;
                troop.fallback = Val::Null;
            }
            troop.state = if troop.strength <= 0.0 {
                STATE_SPENT
            } else if troop.pocket {
                STATE_ENCIRCLED
            } else if troop.walked_today {
                STATE_ADVANCING
            } else if troop.dug {
                STATE_DUG_IN
            } else {
                STATE_HOLDING
            };
            troop.stepping = false;
            troop.walked_today = false;
            troop.moved_km = 0.0;
            troop.loss = 0.0;
            troop.engaged = false;
            troop.fought = false;
        }
    }
}
