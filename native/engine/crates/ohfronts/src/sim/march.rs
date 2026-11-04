use super::battle::{holder_of, Battle};
use super::engine::{Run, War};
use super::game_dates::compare_game_dates;
use super::ground::{cell_at, downhill, measure};
use super::js::{self, Val};
use super::troops::Troop;

pub const OWN_GROUND_PACE: f64 = 1.5;
pub const OWN_GROUND_CLEAR: f64 = 2.0;
pub const MARCH_DEPTH_AT_KM: f64 = 45.0;
pub const MARCH_DENSITY_AT: f64 = 100.0;
pub const MARCH_DEPTH_LEAST_KM: f64 = 20.0;
pub const MARCH_DEPTH_MOST_KM: f64 = 350.0;
pub const MARCH_DEPTH_UNKNOWN_KM: f64 = 80.0;
pub const CALL_UP_FULL_DAYS: f64 = 90.0;

pub fn kind_pick(list: &[f64; 3], kind: f64) -> f64 {
    if kind >= 0.0 && kind.fract() == 0.0 && (kind as usize) < list.len() {
        list[kind as usize]
    } else {
        f64::NAN
    }
}

fn plain_fold(value: &str) -> String {
    js::trim(&js::collapse_spaces(value)).to_lowercase()
}

pub fn marches_for(run: &Run, battle: &Battle, war: Option<&War>) -> bool {
    if !run.mech.marching() || run.input.get("authored").truthy() {
        return false;
    }
    if battle.home {
        return false;
    }
    if battle.status == "standing" {
        return true;
    }
    let Some(war) = war else { return true };
    let began = run.input.get("gameBegan");
    war.began.is_empty() || !began.truthy() || compare_game_dates(&war.began, &began.string_or_empty()) > 0.0
}

pub fn depth_of(battle: &mut Battle, run: &Run, side: usize, member: &str) -> f64 {
    let key = plain_fold(member);
    if let Some((_, known)) = battle.march_depths.iter().find(|(name, _)| *name == key) {
        return *known;
    }
    let arena = battle.arena.clone();
    let mut mine = vec![0u8; arena.ids.len()];
    for region in 1..arena.ids.len() {
        if plain_fold(&holder_of(battle, run, &arena.ids[region])) == key {
            mine[region] = 1;
        }
    }
    let field = battle.field.as_ref().unwrap();
    let mut cells = 0.0;
    for cell in 0..field.size {
        if field.holders[cell] as usize == side && mine[arena.region[cell] as usize] == 1 {
            cells += 1.0;
        }
    }
    let mut people = 0.0;
    for city in &arena.cities {
        if city.cell >= 0.0 {
            let cell = city.cell as usize;
            if field.holders[cell] as usize == side && mine[arena.region[cell] as usize] == 1 {
                people += city.population;
            }
        }
    }
    let area = cells * battle.frame.km * battle.frame.km;
    let mut depth = MARCH_DEPTH_UNKNOWN_KM;
    if people > 0.0 && area > 0.0 {
        depth = MARCH_DEPTH_AT_KM * (MARCH_DENSITY_AT / (people / area)).sqrt();
        depth = if depth < MARCH_DEPTH_LEAST_KM {
            MARCH_DEPTH_LEAST_KM
        } else if depth > MARCH_DEPTH_MOST_KM {
            MARCH_DEPTH_MOST_KM
        } else {
            depth
        };
    }
    battle.march_depths.push((key, depth));
    depth
}

fn inland_of(battle: &mut Battle, side: usize, x: f64, y: f64, depth_km: f64, heading: [f64; 2]) -> [f64; 2] {
    measure(battle.field.as_ref().unwrap(), &mut battle.to_side);
    let field = battle.field.as_ref().unwrap();
    let to_other = &battle.to_side.as_ref().unwrap().sides[1 - side];
    let wanted = (depth_km / battle.frame.km) * 3.0;
    let mut at_x = x;
    let mut at_y = y;
    let most = ((2.0 * depth_km) / battle.frame.km).ceil() + 4.0;
    let mut toward = [0.0, 0.0];
    let mut step = 0.0;
    while step < most {
        step += 1.0;
        let here = cell_at(field, at_x, at_y);
        if here >= 0 && to_other[here as usize] as f64 >= wanted {
            break;
        }
        let (back_x, back_y) = if downhill(field, to_other, at_x, at_y, &mut toward) { (-toward[0], -toward[1]) } else { (-heading[0], -heading[1]) };
        if back_x == 0.0 && back_y == 0.0 {
            break;
        }
        let next_x = at_x + back_x;
        let next_y = at_y + back_y;
        let cell = cell_at(field, next_x, next_y);
        if cell < 0 || field.holders[cell as usize] as usize != side || field.play[cell as usize] != 1 {
            break;
        }
        at_x = next_x;
        at_y = next_y;
    }
    [at_x, at_y]
}

pub fn send_inland(battle: &mut Battle, run: &Run, side: usize, indices: &[usize]) {
    for &index in indices {
        let Some(troop) = battle.troops[side].get(index) else { continue };
        if troop.strength <= 0.0 || troop.named {
            continue;
        }
        let (tx, ty, hx, hy, owner) = (troop.x, troop.y, troop.hx, troop.hy, troop.owner);
        let field = battle.field.as_ref().unwrap();
        let goal = cell_at(field, tx, ty);
        if goal < 0 || field.holders[goal as usize] as usize != side {
            continue;
        }
        let member = (if owner >= 0.0 && owner.fract() == 0.0 { battle.sides[side].get(owner as usize) } else { None }).or(battle.sides[side].first()).cloned().unwrap_or_default();
        let heading = [if hx != 0.0 && !hx.is_nan() { hx } else if side == 0 { 1.0 } else { -1.0 }, if hy != 0.0 && !hy.is_nan() { hy } else { 0.0 }];
        let depth = depth_of(battle, run, side, &member);
        let [x, y] = inland_of(battle, side, tx, ty, depth, heading);
        let start = cell_at(battle.field.as_ref().unwrap(), x, y);
        if start == goal {
            continue;
        }
        let troop = &mut battle.troops[side][index];
        troop.x = x;
        troop.y = y;
        troop.goal = goal as f64;
    }
}

fn moved(troop: &Troop) -> f64 {
    js::or_zero(troop.moved_km)
}

pub fn march_on(battle: &mut Battle, side: usize, index: usize, march_km: &[f64; 3]) -> bool {
    let field = battle.field.as_ref().unwrap();
    let troop = &mut battle.troops[side][index];
    if !(troop.goal >= 0.0) {
        return false;
    }
    let goal = troop.goal;
    if goal >= field.size as f64 || field.holders[goal as usize] as usize != side {
        troop.goal = -1.0;
        return false;
    }
    let cols = field.cols as f64;
    let goal_x = (goal % cols) + 0.5;
    let goal_y = (goal / cols).floor() + 0.5;
    let dx = goal_x - troop.x;
    let dy = goal_y - troop.y;
    let gap = (dx * dx + dy * dy).sqrt();
    let km = battle.place.km_at(troop.y);
    let legs = if troop.legs > 0.0 { troop.legs } else { 1.0 };
    let step = (kind_pick(march_km, troop.kind) * legs) / km;
    if !(step > 0.0) {
        return false;
    }
    if gap <= step {
        troop.x = goal_x;
        troop.y = goal_y;
        troop.moved_km = moved(troop) + gap * km;
        troop.goal = -1.0;
        return true;
    }
    for share in [1.0, 0.5, 0.25] {
        let x = troop.x + (dx / gap) * step * share;
        let y = troop.y + (dy / gap) * step * share;
        let cell = cell_at(field, x, y);
        if cell < 0 || field.holders[cell as usize] as usize != side || field.play[cell as usize] != 1 {
            continue;
        }
        troop.x = x;
        troop.y = y;
        troop.moved_km = moved(troop) + step * share * km;
        troop.hx = dx / gap;
        troop.hy = dy / gap;
        return true;
    }
    troop.goal = -1.0;
    false
}

pub fn walk_route(battle: &mut Battle, side: usize, index: usize, march_km: &[f64; 3], day: f64) -> bool {
    let field = battle.field.as_ref().unwrap();
    let troop = &mut battle.troops[side][index];
    let mut order = troop.order.clone();
    if !order.truthy() || order.read("done").truthy() || !matches!(order.read("kind"), Val::Str(kind) if kind == "way") || !matches!(order.read("legs"), Val::Arr(_)) || !(day >= js::to_number(&order.read("since"))) {
        return false;
    }
    let legs_list = order.read("legs");
    let legs_list = legs_list.array_or_empty();
    let km = battle.place.km_at(troop.y);
    let legs = if troop.legs > 0.0 { troop.legs } else { 1.0 };
    let mut left = (kind_pick(march_km, troop.kind) * legs) / km;
    let mut went = false;
    let mut leg_at = js::to_number(&order.read("leg"));
    while left > 0.0 && leg_at < legs_list.len() as f64 {
        let leg = if leg_at >= 0.0 && leg_at.fract() == 0.0 { legs_list[leg_at as usize].clone() } else { Val::Undef };
        let dx = js::to_number(&leg.read("ox")) - troop.x;
        let dy = js::to_number(&leg.read("oy")) - troop.y;
        let gap = (dx * dx + dy * dy).sqrt();
        let step = if gap < left { gap } else { left };
        let x = troop.x + if gap > 0.0 { (dx / gap) * step } else { 0.0 };
        let y = troop.y + if gap > 0.0 { (dy / gap) * step } else { 0.0 };
        let cell = cell_at(field, x, y);
        if cell < 0 || field.holders[cell as usize] as usize != side || field.play[cell as usize] != 1 {
            break;
        }
        troop.x = x;
        troop.y = y;
        troop.moved_km = moved(troop) + step * km;
        if gap > 0.0 {
            troop.hx = dx / gap;
            troop.hy = dy / gap;
        }
        went = went || step > 0.0;
        left -= step;
        if step >= gap {
            leg_at += 1.0;
            order.write("leg", Val::Num(leg_at));
        } else {
            break;
        }
    }
    if leg_at >= legs_list.len() as f64 {
        order.write("done", Val::Bool(true));
    }
    troop.order = order;
    went
}

pub fn march_km_of(run: &Run) -> [f64; 3] {
    run.advance_km.map(|km| km * run.pace * OWN_GROUND_PACE)
}

pub fn read_march(value: &Val, count: usize) -> Vec<f64> {
    (0..count)
        .map(|at| {
            let kept = match value {
                Val::Arr(list) => js::to_number(list.get(at).unwrap_or(&Val::Undef)),
                _ => 0.0,
            };
            if kept.is_finite() && kept.fract() == 0.0 && kept > 0.0 {
                kept - 1.0
            } else {
                -1.0
            }
        })
        .collect()
}

pub fn march_kept(troops: &[Troop]) -> Val {
    Val::Arr(troops.iter().map(|troop| Val::Num(if troop.strength > 0.0 && troop.goal >= 0.0 { troop.goal + 1.0 } else { 0.0 })).collect())
}
