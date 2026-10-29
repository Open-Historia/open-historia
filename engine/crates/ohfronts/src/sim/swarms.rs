use super::battle::Battle;
use super::constants::*;
use super::field::Field;
use super::ground::measure;
use super::js::{self, Val};
use super::troops::{is_live, stands, Troop};
use crate::jsmath;

pub const FRONT_FORM: &str = "front";
pub const SWARM_FORM: &str = "swarm";
pub const DEPLOY_FORMS: [&str; 2] = [FRONT_FORM, SWARM_FORM];

pub fn read_swarms(value: &Val) -> [Vec<usize>; 2] {
    let side = |side: usize| {
        let mut kept: Vec<f64> = Vec::new();
        let list = match value {
            Val::Arr(sides) => sides.get(side).map(|list| list.array_or_empty()).unwrap_or(&[]),
            _ => &[],
        };
        for raw in list {
            let command = raw.num();
            if command.is_finite() && command.trunc() == command && command >= 0.0 && command < MAX_COMMANDS && !kept.contains(&command) {
                kept.push(command);
            }
        }
        js::sort_numbers(&mut kept);
        kept.iter().map(|&command| command as usize).collect()
    };
    [side(0), side(1)]
}

pub fn swarms_of_record(record: &Val) -> [Vec<usize>; 2] {
    read_swarms(record.get("brief").get("carry").get("swarms"))
}

fn held(battle: &Battle, side: usize, command: f64) -> bool {
    battle.swarms[side].iter().any(|&held| held as f64 == command)
}

pub fn in_swarm(battle: &Battle, side: usize, troop: &Troop) -> bool {
    troop.command >= 0.0 && held(battle, side, troop.command)
}

pub fn swarms_kept(battle: &mut Battle) -> [Vec<usize>; 2] {
    let side = |battle: &mut Battle, side: usize| {
        if battle.swarms[side].is_empty() {
            return Vec::new();
        }
        let mut manned: Vec<f64> = Vec::new();
        for troop in &battle.troops[side] {
            if is_live(troop) && held(battle, side, troop.command) && !manned.contains(&troop.command) {
                manned.push(troop.command);
            }
        }
        battle.swarms[side].retain(|&command| manned.contains(&(command as f64)));
        let mut out = battle.swarms[side].clone();
        out.sort();
        out
    };
    let a = side(battle, 0);
    let b = side(battle, 1);
    [a, b]
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Middle {
    pub x: f64,
    pub y: f64,
    pub n: f64,
    pub o: f64,
}

pub fn swarm_middles(battle: &Battle, side: usize) -> Vec<(f64, Middle)> {
    let mut middles: Vec<(f64, Middle)> = Vec::new();
    if battle.swarms[side].is_empty() {
        return middles;
    }
    for troop in &battle.troops[side] {
        if !is_live(troop) || !in_swarm(battle, side, troop) {
            continue;
        }
        let at = match middles.iter().position(|(command, _)| *command == troop.command) {
            Some(at) => at,
            None => {
                middles.push((troop.command, Middle { x: 0.0, y: 0.0, n: 0.0, o: troop.owner }));
                middles.len() - 1
            }
        };
        let middle = &mut middles[at].1;
        middle.x += troop.x;
        middle.y += troop.y;
        middle.n += 1.0;
    }
    for (_, middle) in middles.iter_mut() {
        middle.x /= middle.n;
        middle.y /= middle.n;
    }
    middles
}

pub fn free_command(battle: &Battle, side: usize) -> f64 {
    let mut used: Vec<f64> = battle.swarms[side].iter().map(|&command| command as f64).collect();
    let mut lined = false;
    for troop in &battle.troops[side] {
        if !is_live(troop) {
            continue;
        }
        if troop.command >= 0.0 && !used.contains(&troop.command) {
            used.push(troop.command);
        }
        if !in_swarm(battle, side, troop) {
            lined = true;
        }
    }
    let start = if lined { FRONT_COMMANDS_MOST } else { 0.0 };
    let mut step = 0.0;
    while step < MAX_COMMANDS {
        let command = (start + step) % MAX_COMMANDS;
        if !used.contains(&command) {
            return command;
        }
        step += 1.0;
    }
    -1.0
}

fn spacing_km(battle: &Battle, side: usize) -> f64 {
    (if battle.radius_km[side] > 0.0 { battle.radius_km[side] } else { CONTROL_RADIUS_MAX_KM }) * SWARM_SPACING_BRUSHES
}

pub fn half_block_km(battle: &Battle, side: usize, count: f64) -> f64 {
    (spacing_km(battle, side) * (jsmath::max(1.0, count).sqrt().ceil() - 1.0)) / 2.0
}

pub fn block_steps(count: f64) -> Vec<[f64; 2]> {
    let mut steps: Vec<[f64; 2]> = vec![[0.0, 0.0]];
    let mut ring = 1.0;
    while (steps.len() as f64) < count {
        let along = |sign: f64| {
            let mut out = vec![0.0];
            let mut step = 1.0;
            while step < ring {
                out.push(sign * step);
                out.push(-sign * step);
                step += 1.0;
            }
            out.push(sign * ring);
            out
        };
        let up = along(1.0);
        let down = along(-1.0);
        let mut at = 0;
        while (at as f64) < 2.0 * ring && (steps.len() as f64) < count {
            steps.push([ring, up[at]]);
            if (steps.len() as f64) < count {
                steps.push([down[at], ring]);
            }
            if (steps.len() as f64) < count {
                steps.push([-ring, down[at]]);
            }
            if (steps.len() as f64) < count {
                steps.push([up[at], -ring]);
            }
            at += 1;
        }
        ring += 1.0;
    }
    let length = steps.len() as f64;
    let end = if count.is_nan() {
        0.0
    } else if count < 0.0 {
        jsmath::max(0.0, length + count.trunc())
    } else {
        jsmath::min(length, count.trunc())
    };
    steps.truncate(end as usize);
    steps
}

fn nearest_own(field: &Field, side: usize, x: f64, y: f64, reach: f64) -> i64 {
    let mut best = -1i64;
    let mut least = f64::INFINITY;
    let col0 = x.floor();
    let row0 = y.floor();
    let mut row = jsmath::max(0.0, row0 - reach);
    while row <= jsmath::min(field.rows as f64 - 1.0, row0 + reach) {
        let mut col = jsmath::max(0.0, col0 - reach);
        while col <= jsmath::min(field.cols as f64 - 1.0, col0 + reach) {
            let cell = (row * field.cols as f64 + col) as usize;
            if field.holders[cell] as usize == side && field.play[cell] != 0 {
                let dx = col + 0.5 - x;
                let dy = row + 0.5 - y;
                let far = dx * dx + dy * dy;
                if far < least {
                    least = far;
                    best = cell as i64;
                }
            }
            col += 1.0;
        }
        row += 1.0;
    }
    best
}

pub fn place_block(battle: &mut Battle, side: usize, indexes: &[usize], x: f64, y: f64) {
    let step = spacing_km(battle, side) / battle.place.km_at(y);
    let reach = jsmath::max(2.0, (SWARM_PLACE_KM / battle.frame.km).ceil());
    let others: Vec<(f64, f64)> = battle.troops[side].iter().enumerate().filter(|(index, troop)| is_live(troop) && !indexes.contains(index)).map(|(_, troop)| (troop.x, troop.y)).collect();
    let stands_there = |tx: f64, ty: f64| others.iter().any(|&(ox, oy)| ox > tx - step / 2.0 && ox < tx + step / 2.0 && oy > ty - step / 2.0 && oy < ty + step / 2.0);
    let mut steps = block_steps(indexes.len() as f64 * 2.0 + 8.0);
    let mut next = 0;
    let field = battle.field.as_ref().unwrap();
    for &index in indexes {
        let mut tx;
        let mut ty;
        loop {
            if next >= steps.len() {
                steps = block_steps(steps.len() as f64 * 2.0);
            }
            let [across, down] = steps[next];
            next += 1;
            tx = x + across * step;
            ty = y + down * step;
            if !stands_there(tx, ty) || next > indexes.len() * 8 + 64 {
                break;
            }
        }
        let troop = &mut battle.troops[side][index];
        if stands(field, side as u8, tx, ty) {
            troop.x = tx;
            troop.y = ty;
            continue;
        }
        let cell = nearest_own(field, side, tx, ty, reach);
        if cell >= 0 {
            troop.x = (cell as usize % field.cols) as f64 + 0.5;
            troop.y = (cell as usize / field.cols) as f64 + 0.5;
        } else if stands(field, side as u8, x, y) {
            troop.x = x;
            troop.y = y;
        }
    }
}

pub fn rear_of(battle: &mut Battle, side: usize, x: f64, y: f64, rear_km: f64) -> [f64; 2] {
    measure(battle.field.as_ref().unwrap(), &mut battle.to_side);
    let field = battle.field.as_ref().unwrap();
    let to_other = &battle.to_side.as_ref().unwrap().sides[1 - side];
    let cell_km = battle.frame.km;
    let reach = jsmath::max(2.0, ((SWARM_PLACE_KM + rear_km) / cell_km).ceil());
    let wanted = (rear_km / cell_km) * 3.0;
    let col0 = x.floor();
    let row0 = y.floor();
    let mut best = -1i64;
    let mut least = f64::INFINITY;
    let mut deepest = -1i64;
    let mut deep = -1.0;
    let mut row = jsmath::max(0.0, row0 - reach);
    while row <= jsmath::min(field.rows as f64 - 1.0, row0 + reach) {
        let mut col = jsmath::max(0.0, col0 - reach);
        while col <= jsmath::min(field.cols as f64 - 1.0, col0 + reach) {
            let cell = (row * field.cols as f64 + col) as usize;
            col += 1.0;
            if field.holders[cell] as usize != side || field.play[cell] == 0 {
                continue;
            }
            let distance = to_other[cell] as f64;
            if distance > deep {
                deep = distance;
                deepest = cell as i64;
            }
            if distance < wanted {
                continue;
            }
            let dx = col - 1.0 + 0.5 - x;
            let dy = row + 0.5 - y;
            let far = dx * dx + dy * dy;
            if far < least {
                least = far;
                best = cell as i64;
            }
        }
        row += 1.0;
    }
    let cell = if best >= 0 { best } else { deepest };
    if cell >= 0 {
        [(cell as usize % field.cols) as f64 + 0.5, (cell as usize / field.cols) as f64 + 0.5]
    } else {
        [x, y]
    }
}

fn wanted_name(member: &Val) -> String {
    js::trim(&member.string_or_empty()).to_lowercase()
}

pub fn swarm_place_of(battle: &Battle, side: usize, member: &Val) -> Option<[f64; 2]> {
    let lines = battle.deploy.as_ref().map(|deploy| deploy[side].as_slice()).unwrap_or(&[]);
    let wanted = wanted_name(member);
    let entry = lines.iter().find(|line| line.swarm && line.country.to_lowercase() == wanted)?;
    if entry.way.is_empty() {
        return None;
    }
    let [x, y] = battle.place.to_cell(entry.way[0][0], entry.way[0][1]);
    let field = battle.field.as_ref().unwrap();
    let cell = nearest_own(field, side, x, y, jsmath::max(2.0, (SWARM_PLACE_KM / battle.frame.km).ceil()));
    if cell >= 0 {
        Some([(cell as usize % field.cols) as f64 + 0.5, (cell as usize / field.cols) as f64 + 0.5])
    } else {
        None
    }
}

pub fn gathers_in_swarms(battle: &Battle, side: usize, member: &Val, warfare: &Val) -> bool {
    let lines = battle.deploy.as_ref().map(|deploy| deploy[side].as_slice()).unwrap_or(&[]);
    let wanted = wanted_name(member);
    match lines.iter().find(|line| line.country.to_lowercase() == wanted) {
        Some(entry) => entry.swarm,
        None => matches!(warfare, Val::Str(form) if form == SWARM_FORM),
    }
}

fn member_of(battle: &Battle, side: usize, owner: f64) -> Val {
    if owner >= 0.0 && owner.fract() == 0.0 {
        battle.sides[side].get(owner as usize).map(|name| Val::str(name)).unwrap_or(Val::Undef)
    } else {
        Val::Undef
    }
}

pub fn gather_newcomers(battle: &mut Battle, side: usize, owner: f64, first: usize, warfare: &Val) -> usize {
    let newcomers: Vec<usize> = (first..battle.troops[side].len()).filter(|&at| {
        let troop = &battle.troops[side][at];
        is_live(troop) && troop.owner == owner && !(troop.command >= 0.0)
    }).collect();
    let member = member_of(battle, side, owner);
    if newcomers.is_empty() || !gathers_in_swarms(battle, side, &member, warfare) {
        return 0;
    }
    let place = match swarm_place_of(battle, side, &member) {
        Some(place) => place,
        None => {
            let (mut x, mut y) = (0.0, 0.0);
            let count = newcomers.len() as f64;
            for &index in &newcomers {
                x += battle.troops[side][index].x / count;
                y += battle.troops[side][index].y / count;
            }
            let rear = SWARM_REAR_KM + half_block_km(battle, side, count);
            rear_of(battle, side, x, y, rear)
        }
    };
    let [px, py] = place;
    let km = battle.place.km_at(py);
    let mut join = -1.0;
    let mut nearest = f64::INFINITY;
    let mut anywhere = -1.0;
    let mut anywhere_far = f64::INFINITY;
    for (command, middle) in swarm_middles(battle, side) {
        if middle.o != owner {
            continue;
        }
        let far = ((middle.x - px) * (middle.x - px) + (middle.y - py) * (middle.y - py)).sqrt() * km;
        if far <= SWARM_JOIN_KM && far < nearest {
            nearest = far;
            join = command;
        }
        if far < anywhere_far {
            anywhere_far = far;
            anywhere = command;
        }
    }
    let mut command = join;
    if command < 0.0 {
        command = free_command(battle, side);
        if command >= 0.0 {
            if !held(battle, side, command) {
                battle.swarms[side].push(command as usize);
            }
        } else {
            command = anywhere;
        }
    }
    if command < 0.0 {
        return 0;
    }
    place_block(battle, side, &newcomers, px, py);
    for &index in &newcomers {
        battle.troops[side][index].command = command;
    }
    newcomers.len()
}

pub fn raise_swarms(battle: &mut Battle, side: usize, raised: &[usize]) {
    let mut owners: Vec<f64> = Vec::new();
    for &index in raised {
        let troop = &battle.troops[side][index];
        if is_live(troop) && !owners.contains(&troop.owner) {
            owners.push(troop.owner);
        }
    }
    js::sort_numbers(&mut owners);
    let mine: Vec<Vec<usize>> = owners.iter().map(|&owner| raised.iter().copied().filter(|&index| is_live(&battle.troops[side][index]) && battle.troops[side][index].owner == owner).collect()).collect();
    let mut used: Vec<f64> = battle.swarms[side].iter().map(|&command| command as f64).collect();
    for troop in &battle.troops[side] {
        if is_live(troop) && troop.command >= 0.0 && !used.contains(&troop.command) {
            used.push(troop.command);
        }
    }
    let free = MAX_COMMANDS - used.len() as f64;
    let mut wanted: Vec<f64> = mine.iter().map(|list| jsmath::max(1.0, jsmath::round(list.len() as f64 / SWARM_TROOPS_EACH))).collect();
    while wanted.iter().sum::<f64>() > free {
        let mut largest: i64 = -1;
        for at in 0..wanted.len() {
            if wanted[at] > 1.0 && (largest < 0 || wanted[at] > wanted[largest as usize]) {
                largest = at as i64;
            }
        }
        if largest < 0 {
            break;
        }
        wanted[largest as usize] -= 1.0;
    }
    for at in 0..owners.len() {
        let list = &mine[at];
        let length = list.len() as f64;
        let count = jsmath::min(wanted[at], length);
        let mut part = 0.0;
        while part < count {
            let chunk: Vec<usize> = list[((part * length) / count).floor() as usize..(((part + 1.0) * length) / count).floor() as usize].to_vec();
            part += 1.0;
            if chunk.is_empty() {
                continue;
            }
            let command = free_command(battle, side);
            if command < 0.0 {
                break;
            }
            if !held(battle, side, command) {
                battle.swarms[side].push(command as usize);
            }
            let (mut x, mut y) = (0.0, 0.0);
            let size = chunk.len() as f64;
            for &index in &chunk {
                x += battle.troops[side][index].x / size;
                y += battle.troops[side][index].y / size;
            }
            let rear = SWARM_REAR_KM + half_block_km(battle, side, size);
            let [px, py] = rear_of(battle, side, x, y, rear);
            for &index in &chunk {
                battle.troops[side][index].command = command;
            }
            place_block(battle, side, &chunk, px, py);
        }
    }
}
