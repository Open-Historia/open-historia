use super::battle::Battle;
use super::js::{self, Val};
use super::troops::Troop;
use crate::jsmath;

pub const CHRONICLE_KINDS: [&str; 13] = ["offensive", "counter", "city", "pocket", "siege", "breached", "destroyed", "invaded", "attacked", "landed", "withdrew", "returned", "assault"];
pub const CHRONICLE_MOST: usize = 120;
const OPENING_KEPT: usize = 20;
pub const CHRONICLE_RUN_MOST: usize = 16;
pub const STRENGTH_MOST: usize = 60;

fn clean(value: &Val, most: usize) -> String {
    let text = if value.is_nullish() { String::new() } else { js::to_string(value) };
    js::slice_units(js::trim(&js::collapse_spaces(&text)), 0, most)
}

fn count(value: &Val) -> f64 {
    let number = js::to_number(value);
    if number > 0.0 {
        number.floor()
    } else {
        0.0
    }
}

fn percent(value: &Val) -> f64 {
    let number = js::to_number(value);
    if number > 0.0 {
        if number > 100.0 {
            100.0
        } else {
            jsmath::round(number)
        }
    } else {
        0.0
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Told {
    pub d: String,
    pub k: String,
    pub s: Option<f64>,
    pub at: String,
    pub size: Option<f64>,
    pub capital: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StrengthPoint {
    pub date: String,
    pub troops: [f64; 2],
    pub strength: [f64; 2],
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Chronicle {
    pub moments: Vec<Told>,
    pub strength: Vec<StrengthPoint>,
}

fn side_of(value: &Val) -> Option<f64> {
    match value {
        Val::Num(side) if *side == 0.0 || *side == 1.0 => Some(*side),
        _ => None,
    }
}

fn last_of<T: Clone>(list: Vec<T>, most: usize) -> Vec<T> {
    let from = list.len().saturating_sub(most);
    list[from..].to_vec()
}

pub fn read_chronicle(value: &Val) -> Option<Chronicle> {
    if !matches!(value, Val::Obj(_)) {
        return None;
    }
    let mut moments = Vec::new();
    for entry in value.get("moments").array_or_empty() {
        let k = clean(entry.get("k"), 24).to_lowercase();
        if !CHRONICLE_KINDS.contains(&k.as_str()) {
            continue;
        }
        let size = count(entry.get("size"));
        moments.push(Told { d: clean(entry.get("d"), 40), k, s: side_of(entry.get("s")), at: clean(entry.get("at"), 160), size: if size > 0.0 { Some(size) } else { None }, capital: entry.get("capital").is_true() });
    }
    let mut strength = Vec::new();
    for row in value.get("strength").array_or_empty() {
        let list = match row {
            Val::Arr(list) if list.len() >= 3 => list,
            _ => continue,
        };
        let at = |index: usize| list.get(index).cloned().unwrap_or(Val::Undef);
        strength.push(StrengthPoint { date: clean(&at(0), 40), troops: [count(&at(1)), count(&at(2))], strength: [percent(&at(3)), percent(&at(4))] });
    }
    if moments.is_empty() && strength.is_empty() {
        return None;
    }
    Some(Chronicle { moments: last_of(moments, CHRONICLE_MOST), strength: last_of(strength, STRENGTH_MOST) })
}

fn strength_of(troops: &[&Troop]) -> f64 {
    let mut sum = 0.0;
    for troop in troops {
        sum += troop.strength;
    }
    if troops.is_empty() {
        0.0
    } else {
        jsmath::round(sum / troops.len() as f64)
    }
}

pub fn chronicle_after(battle: &Battle, date: &Val) -> Chronicle {
    let empty = Chronicle::default();
    let before = battle.chronicle.as_ref().unwrap_or(&empty);
    let mut fresh: Vec<Told> = Vec::new();
    let from = if battle.log_from.is_nan() { 0 } else { (battle.log_from.max(0.0) as usize).min(battle.log.len()) };
    for entry in &battle.log[from..] {
        let kind = match entry.get("k") {
            Val::Str(kind) if CHRONICLE_KINDS.contains(&kind.as_str()) => kind.clone(),
            _ => continue,
        };
        if fresh.len() >= CHRONICLE_RUN_MOST {
            continue;
        }
        let mut told = Told { d: clean(entry.get("d"), 40), k: kind.clone(), s: side_of(entry.get("s")), at: clean(entry.get("at"), 160), size: None, capital: false };
        if kind == "city" {
            let at = entry.get("at");
            let city = battle.arena.cities.iter().find(|candidate| matches!(at, Val::Str(at) if *at == format!("city: {}", candidate.name)));
            if let Some(city) = city {
                let size = count(&Val::Num(city.population));
                if size > 0.0 {
                    told.size = Some(size);
                }
                if city.capital {
                    told.capital = true;
                }
            }
        }
        fresh.push(told);
    }
    let mut moments: Vec<Told> = before.moments.iter().cloned().chain(fresh).collect();
    if moments.len() > CHRONICLE_MOST {
        let tail = moments.len() - (CHRONICLE_MOST - OPENING_KEPT);
        moments = moments[..OPENING_KEPT].iter().chain(moments[tail..].iter()).cloned().collect();
    }
    let live: Vec<Vec<&Troop>> = (0..2).map(|side| battle.troops[side].iter().filter(|troop| troop.strength > 0.0).collect()).collect();
    let point = StrengthPoint { date: clean(date, 40), troops: [live[0].len() as f64, live[1].len() as f64], strength: [strength_of(&live[0]), strength_of(&live[1])] };
    let mut strength: Vec<StrengthPoint> = before.strength.clone();
    if strength.last().map(|last| last.date == point.date).unwrap_or(false) {
        strength.pop();
    }
    strength.push(point);
    if strength.len() > STRENGTH_MOST {
        let half = STRENGTH_MOST / 2;
        let cut = strength.len() - half;
        strength = strength[..cut].iter().enumerate().filter(|(at, _)| at % 2 == 0).map(|(_, point)| point.clone()).chain(strength[cut..].iter().cloned()).collect();
    }
    Chronicle { moments, strength }
}
