use super::battle::Battle;
use super::constants::*;
use super::field::Contour;
use super::js::{self, Val};
use super::sectors::{in_sector, resolve_sector, Sector, Sectors};
use super::troops::{is_live, Troop};

pub fn fold_value(value: &Val) -> String {
    js::lower(js::trim(&js::collapse_spaces(&value.string_or_empty())))
}

pub fn chance_text(text: &str) -> f64 {
    let mut hash: u32 = 2166136261;
    for unit in text.encode_utf16() {
        hash ^= unit as u32;
        hash = hash.wrapping_mul(16777619);
    }
    (hash % 10000) as f64 / 10000.0
}

pub fn attack_of(kind: f64) -> f64 {
    if kind >= 0.0 && kind.fract() == 0.0 {
        TROOP_ATTACK.get(kind as usize).copied().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

pub fn troop_worth(troop: &Troop) -> f64 {
    troop.strength * attack_of(troop.kind) * troop.supply * troop.punch
}

pub struct Worth {
    pub worth: f64,
    pub count: usize,
}

fn worth_of(battle: &Battle, side: usize, within: Option<&dyn Fn(&Troop) -> bool>) -> Worth {
    let mut worth = 0.0;
    let mut count = 0;
    for troop in &battle.troops[side] {
        if !is_live(troop) || within.is_some_and(|within| !within(troop)) {
            continue;
        }
        worth += troop_worth(troop);
        count += 1;
    }
    Worth { worth: worth * battle.quality[side] * battle.edge[side].power, count }
}

pub fn side_is_played(battle: &Battle, side: usize, players: &Val) -> bool {
    let played: Vec<String> = players.array_or_empty().iter().map(fold_value).filter(|name| !name.is_empty()).collect();
    battle.sides[side].iter().enumerate().any(|(at, member)| !battle.gone[side].contains(&at) && played.contains(&fold_value(&Val::str(member))))
}

pub struct Today<'a> {
    pub contour: &'a Contour,
    pub count: usize,
    pub sectors: Option<&'a Sectors>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Decision {
    pub order: &'static str,
    pub sector: String,
    pub ratio: f64,
}

fn decided(order: &'static str, sector: &str, ratio: f64) -> Option<Decision> {
    Some(Decision { order, sector: sector.to_string(), ratio })
}

pub fn staff_decision(battle: &Battle, side: usize, began: bool, today: Option<&Today>, key: &str) -> Option<Decision> {
    let own = worth_of(battle, side, None);
    let theirs = worth_of(battle, 1 - side, None);
    if own.count == 0 {
        return None;
    }
    let ratio = if theirs.worth > 0.0 { own.worth / theirs.worth } else { 99.0 };
    let advances = if began { STAFF_ATTACKER_ADVANCES } else { STAFF_DEFENDER_ADVANCES };
    let probes = if began { STAFF_ATTACKER_PROBES } else { STAFF_DEFENDER_PROBES };
    if ratio >= advances {
        return decided("advance", "all", ratio);
    }
    if let Some(capital) = capital_of(battle, side) {
        if capital.held && ratio >= STAFF_RETAKE_ODDS {
            return decided("advance", &format!("city: {}", capital.name), ratio);
        }
    }
    if ratio < STAFF_DIGS_IN_UNDER {
        return decided("dig in", "all", ratio);
    }
    if ratio < probes {
        return decided("hold", "all", ratio);
    }
    if chance_text(&format!("{key}|tries")) >= (if began { STAFF_CHANCE_ATTACKER } else { STAFF_CHANCE_DEFENDER }) {
        return decided("hold", "all", ratio);
    }
    let mut best: Option<(String, f64)> = None;
    let names: &[String] = today.and_then(|today| today.sectors).map(|sectors| sectors.names.as_slice()).unwrap_or(&[]);
    for name in names {
        let sector = today.and_then(|today| resolve_sector(&battle.arena, today.contour, today.count, today.sectors.unwrap(), &Val::str(name)));
        let sector = match sector {
            Some(sector) if sector != Sector::All => sector,
            _ => continue,
        };
        let place = &battle.place;
        let inside = |troop: &Troop| in_sector(&sector, troop.x, troop.y, |y| place.km_at(y));
        let mine = worth_of(battle, side, Some(&inside));
        if (mine.count as f64) < STAFF_SECTOR_TROOPS_LEAST {
            continue;
        }
        let facing = worth_of(battle, 1 - side, Some(&inside));
        let there = if facing.worth > 0.0 { mine.worth / facing.worth } else { 99.0 };
        if best.as_ref().is_none_or(|(_, known)| there > *known) {
            best = Some((name.clone(), there));
        }
    }
    match best {
        None => {
            if ratio >= 1.0 {
                decided("advance", "all", ratio)
            } else {
                decided("hold", "all", ratio)
            }
        }
        Some((_, there)) if there < 1.0 => decided("hold", "all", ratio),
        Some((name, _)) => decided("advance", &name, ratio),
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Capital {
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub held: bool,
    pub near: bool,
}

pub fn capital_of(battle: &Battle, side: usize) -> Option<Capital> {
    let field = battle.field.as_ref()?;
    let arena = &battle.arena;
    let lawful = battle.home_side.as_deref()?;
    let mut best: Option<&super::arena::City> = None;
    for city in &arena.cities {
        if !city.capital || !(city.cell >= 0.0 && city.cell < field.size as f64) {
            continue;
        }
        if lawful.get(arena.region[city.cell as usize] as usize).map(|&owner| owner as i64) != Some(side as i64) {
            continue;
        }
        if best.is_none_or(|known| city.population > known.population) {
            best = Some(city);
        }
    }
    let best = best?;
    let held = field.holders[best.cell as usize] as i64 == 1 - side as i64;
    let near = held
        || battle.troops[1 - side].iter().any(|troop| {
            if !is_live(troop) {
                return false;
            }
            let km = battle.place.km_at((troop.y + best.y) / 2.0);
            let dx = (troop.x - best.x) * km;
            let dy = (troop.y - best.y) * km;
            dx * dx + dy * dy <= STAFF_CAPITAL_THREAT_KM * STAFF_CAPITAL_THREAT_KM
        });
    Some(Capital { name: best.name.clone(), x: best.x, y: best.y, held, near })
}

#[derive(Clone, Debug, PartialEq)]
pub struct Need {
    pub share: f64,
    pub why: &'static str,
}

pub fn call_up_need(battle: &Battle, side: usize, usual: f64) -> Need {
    let live = battle.troops[side].iter().filter(|troop| is_live(troop)).count() as f64;
    let mut home = 0.0;
    let mut lost = 0.0;
    let mut lost_before = 0.0;
    if let (Some(lawful), Some(field)) = (battle.home_side.as_deref(), battle.field.as_ref()) {
        let arena = &battle.arena;
        for cell in 0..field.size {
            if field.play[cell] == 0 || lawful.get(arena.region[cell] as usize).map(|&owner| owner as i64) != Some(side as i64) {
                continue;
            }
            home += 1.0;
            if field.holders[cell] as i64 == 1 - side as i64 {
                lost += 1.0;
            }
            if battle.start_holders.as_ref().and_then(|start| start.get(cell)).map(|&holder| holder as i64) == Some(1 - side as i64) {
                lost_before += 1.0;
            }
        }
    }
    let capital = capital_of(battle, side);
    if capital.as_ref().is_some_and(|capital| capital.held || capital.near) || (home > 0.0 && lost >= home * STAFF_HOMELAND_SHARE) {
        return Need { share: STAFF_CALL_UP_MOBILISE, why: "mobilise" };
    }
    if lost > lost_before {
        return Need { share: STAFF_CALL_UP_LOSING, why: "losing" };
    }
    let own = worth_of(battle, side, None);
    let theirs = worth_of(battle, 1 - side, None);
    if live < usual * STAFF_THIN_SHARE || own.worth < theirs.worth {
        return Need { share: STAFF_CALL_UP_THIN, why: "thin" };
    }
    Need { share: 0.0, why: "" }
}

const COMPASS: [[f64; 2]; 8] = [[1.0, 0.0], [0.7071, 0.7071], [0.0, 1.0], [-0.7071, 0.7071], [-1.0, 0.0], [-0.7071, -0.7071], [0.0, -1.0], [0.7071, -0.7071]];

fn km_apart(battle: &Battle, ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let km = battle.place.km_at((ay + by) / 2.0);
    let dx = (ax - bx) * km;
    let dy = (ay - by) * km;
    (dx * dx + dy * dy).sqrt()
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Head {
    pub x: f64,
    pub y: f64,
    pub ours: f64,
}

pub fn spearheads_of(battle: &Battle, side: usize) -> Vec<Head> {
    let lawful = match &battle.home_side {
        Some(lawful) => lawful,
        None => return Vec::new(),
    };
    let field = match &battle.field {
        Some(field) => field,
        None => return Vec::new(),
    };
    let region = &battle.arena.region;
    let mut found = Vec::new();
    for troop in &battle.troops[1 - side] {
        if !is_live(troop) || troop.pocket {
            continue;
        }
        let cell = troop.y.floor() * field.cols as f64 + troop.x.floor();
        if !(cell >= 0.0 && cell < field.size as f64) {
            continue;
        }
        let home = region.get(cell as usize).and_then(|&at| lawful.get(at as usize)).map(|&home| home as f64);
        if home != Some(side as f64) {
            continue;
        }
        let reach = BREAKTHROUGH_RING_KM / battle.place.km_at(troop.y);
        let mut ours = 0.0;
        for [cx, cy] in COMPASS {
            let x = (troop.x + cx * reach).floor();
            let y = (troop.y + cy * reach).floor();
            if x >= 0.0 && y >= 0.0 && x < field.cols as f64 && y < field.rows as f64 && field.holders[(y * field.cols as f64 + x) as usize] as usize == side {
                ours += 1.0;
            }
        }
        if ours >= BREAKTHROUGH_ENCLOSED {
            found.push(Head { x: troop.x, y: troop.y, ours });
        }
    }
    found
}

#[derive(Clone, Debug, PartialEq)]
pub struct Body {
    pub order: &'static str,
    pub picked: Vec<usize>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Answer {
    pub bodies: Vec<Body>,
    pub at: [f64; 2],
}

fn or_one(value: f64) -> f64 {
    if value.is_nan() || value == 0.0 {
        1.0
    } else {
        value
    }
}

pub fn breakthrough_answer(battle: &Battle, side: usize) -> Option<Answer> {
    let heads = spearheads_of(battle, side);
    if heads.is_empty() {
        return None;
    }
    let worth: Vec<Vec<f64>> = (0..2)
        .map(|who| {
            let factor = or_one(battle.quality[who]) * or_one(battle.edge[who].power);
            battle.troops[who].iter().map(|troop| if is_live(troop) { troop_worth(troop) * factor } else { 0.0 }).collect()
        })
        .collect();
    let near = |who: usize, x: f64, y: f64| -> f64 {
        let mut sum = 0.0;
        for (index, troop) in battle.troops[who].iter().enumerate() {
            if worth[who][index] > 0.0 && km_apart(battle, troop.x, troop.y, x, y) <= BREAKTHROUGH_ODDS_KM {
                sum += worth[who][index];
            }
        }
        sum
    };
    let mut counter = Vec::new();
    let mut hold = Vec::new();
    for (index, troop) in battle.troops[side].iter().enumerate() {
        if !is_live(troop) {
            continue;
        }
        if !troop.pocket && near(side, troop.x, troop.y) >= BREAKTHROUGH_COUNTER_ODDS * near(1 - side, troop.x, troop.y) {
            counter.push(index);
        } else {
            hold.push(index);
        }
    }
    let bodies: Vec<Body> = [Body { order: "advance", picked: counter }, Body { order: "hold", picked: hold }].into_iter().filter(|body| !body.picked.is_empty()).collect();
    let mut at = heads[0];
    for head in &heads {
        if head.ours > at.ours {
            at = *head;
        }
    }
    Some(Answer { bodies, at: [at.x, at.y] })
}

fn standing_of(battle: &Battle, side: usize) -> impl Iterator<Item = &Val> {
    battle.orders.iter().filter(move |order| matches!(order.read("s"), Val::Num(s) if s == side as f64) && !order.read("chosen").truthy())
}

pub fn staff_may_order(battle: &Battle, side: usize) -> bool {
    if standing_of(battle, side).any(|order| matches!(order.read("mark"), Val::Str(mark) if mark == SCENARIO_MARK)) {
        return false;
    }
    standing_of(battle, side).all(|order| matches!(order.read("mark"), Val::Str(mark) if mark == STAFF_MARK) || js::or_zero(order.read("age").num()) > STAFF_STORY_ORDER_DAYS)
}

pub fn staff_standing(battle: &Battle, side: usize) -> String {
    let mut words: Vec<Val> = standing_of(battle, side)
        .filter(|order| matches!(order.read("mark"), Val::Str(mark) if mark == STAFF_MARK))
        .map(|order| Val::Str(format!("{}|{}", js::to_string(&order.read("order")), fold_value(&order.read("sector")))))
        .collect();
    js::default_sort(&mut words);
    words.iter().map(|word| word.string()).collect::<Vec<_>>().join(";")
}

pub const STAFF_SIDES: [f64; 2] = [HOLDER_SIDE_A, HOLDER_SIDE_B];
