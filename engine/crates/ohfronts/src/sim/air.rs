use super::battle::Battle;
use super::engine::Run;
use super::frame::KM_PER_DEGREE;
use super::js::{self, OrdMap, Val};
use super::military::air_worth;
use super::troops::is_live;
use super::world_grid::{km_between, Surface};
use crate::jsmath;

pub const AIR_REACH_KM: [f64; 4] = [0.0, 0.0, 500.0, 900.0];
pub const AIR_SUPPORT: f64 = 0.25;
pub const AIR_INTERDICT: f64 = 0.2;
pub const AIR_PER_TROOP: f64 = 8.0;
pub const AIR_LOSS: f64 = 2.0;
pub const AIR_MISSIONS: [&str; 3] = ["support", "strike", "grounded"];
pub const AIR_STRIKE: f64 = 1.5;
pub const AIR_STRIKE_WEAR: f64 = 1.5;
pub const AIR_ARM_TROOPS: f64 = 6.0;
const AIR_ARM_MARK: &str = "air arm|";

#[derive(Clone, Debug, PartialEq)]
pub struct Wing {
    pub id: String,
    pub owner: String,
    pub strength: f64,
    pub began: f64,
    pub lng: Option<f64>,
    pub lat: Option<f64>,
    pub arm: bool,
    pub changed: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BattleWings {
    pub holds: usize,
    pub weight: [f64; 2],
    pub superiority: f64,
    pub flying: [Vec<String>; 2],
    pub strike: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AirEdge {
    pub punch: [f64; 2],
    pub guard: [f64; 2],
    pub legs: [f64; 2],
}

pub fn air_mission_of(battle: &Battle, side: usize) -> &'static str {
    AIR_MISSIONS.iter().find(|mission| **mission == battle.air_mission[side]).copied().unwrap_or("support")
}

fn fold(value: &Val) -> String {
    let text = if value.is_nullish() { String::new() } else { js::to_string(value) };
    js::trim(&js::collapse_spaces(&text)).to_lowercase()
}

fn fold_text(text: &str) -> String {
    fold(&Val::str(text))
}

fn worth_of(run: &Run, name: &str) -> f64 {
    air_worth(&run.military_of(name))
}

pub fn assign_wings(run: &Run, day: f64) {
    if run.air_day.get() == Some(day) {
        return;
    }
    run.air_day.set(Some(day));
    run.air_over.borrow_mut().clear();
    let reach = AIR_REACH_KM.get(run.era).copied().unwrap_or(0.0);
    if !(reach > 0.0) {
        return;
    }
    if run.wings.borrow().is_none() {
        *run.wings.borrow_mut() = Some(OrdMap::new());
    }
    let map = run.input.get("map");
    let surface = Surface { flat: map.get("flat").is_true(), scale: if map.get("scale").is_undef() { KM_PER_DEGREE } else { map.get("scale").num() } };
    let mut units: Vec<&Val> = run
        .input
        .get("units")
        .array_or_empty()
        .iter()
        .filter(|unit| fold(unit.get("type")) == "air" && js::to_number(unit.get("strength")) > 0.0 && js::to_number(unit.get("lng")).is_finite() && js::to_number(unit.get("lat")).is_finite())
        .collect();
    js::stable_sort_by(&mut units, |a, b| match js::compare_units(&js::to_string(a.get("id")), &js::to_string(b.get("id"))) {
        std::cmp::Ordering::Less => -1.0,
        std::cmp::Ordering::Greater => 1.0,
        std::cmp::Ordering::Equal => 0.0,
    });
    let owner_of = |unit: &Val| -> Val {
        let code = unit.get("ownerCode");
        if !code.is_nullish() {
            return code.clone();
        }
        unit.get("owner").clone()
    };
    for unit in &units {
        let id = js::to_string(unit.get("id"));
        let wing = {
            let mut wings = run.wings.borrow_mut();
            let wings = wings.as_mut().unwrap();
            if !wings.has(&id) {
                let owner = owner_of(unit);
                let strength = jsmath::min(100.0, js::to_number(unit.get("strength")));
                wings.set(
                    id.clone(),
                    Wing { id: id.clone(), owner: if owner.is_nullish() { String::new() } else { js::to_string(&owner) }, strength, began: strength, lng: Some(js::to_number(unit.get("lng"))), lat: Some(js::to_number(unit.get("lat"))), arm: false, changed: false },
                );
            }
            wings.get(&id).unwrap().clone()
        };
        if !(wing.strength > 0.0) || worth_of(run, &wing.owner) == 0.0 {
            continue;
        }
        let mut best: Option<(usize, usize, f64)> = None;
        for (index, battle) in run.battles.iter().enumerate() {
            if battle.status != "active" {
                continue;
            }
            let side = (0..2).find(|&side| battle.sides[side].iter().enumerate().any(|(at, member)| !battle.gone[side].contains(&at) && fold_text(member) == fold_text(&wing.owner)));
            let side = match side {
                Some(side) => side,
                None => continue,
            };
            let field = battle.field.as_ref().expect("an active battle with a field");
            let [lng, lat] = battle.place.to_lng_lat(field.cols as f64 / 2.0, field.rows as f64 / 2.0);
            let km = km_between(wing.lng.unwrap_or(f64::NAN), wing.lat.unwrap_or(f64::NAN), lng, lat, surface);
            if km <= reach && best.map(|best| km < best.2).unwrap_or(true) {
                best = Some((index, side, km));
            }
        }
        if let Some((index, side, _)) = best {
            push_over(run, index, side, &id);
        }
    }
    if !run.input.get("airArms").is_true() {
        return;
    }
    let winged: Vec<String> = units.iter().map(|unit| fold(&owner_of(unit))).collect();
    for (index, battle) in run.battles.iter().enumerate() {
        if battle.status != "active" {
            continue;
        }
        for side in 0..2 {
            for (at, member) in battle.sides[side].iter().enumerate() {
                if battle.gone[side].contains(&at) || winged.contains(&fold_text(member)) || worth_of(run, member) == 0.0 {
                    continue;
                }
                let troops = battle.troops[side].iter().filter(|troop| is_live(troop) && troop.owner == at as f64).count() as f64;
                let count = (troops / AIR_ARM_TROOPS).ceil() as usize;
                for serial in 0..count {
                    let id = format!("{AIR_ARM_MARK}{}|{member}|{serial}", battle.name);
                    let strength = {
                        let mut wings = run.wings.borrow_mut();
                        let wings = wings.as_mut().unwrap();
                        if !wings.has(&id) {
                            wings.set(id.clone(), Wing { id: id.clone(), owner: member.clone(), strength: 100.0, began: 100.0, lng: None, lat: None, arm: true, changed: false });
                        }
                        wings.get(&id).unwrap().strength
                    };
                    if !(strength > 0.0) {
                        continue;
                    }
                    push_over(run, index, side, &id);
                }
            }
        }
    }
}

fn push_over(run: &Run, index: usize, side: usize, id: &str) {
    let mut over = run.air_over.borrow_mut();
    match over.iter_mut().find(|(battle, _)| *battle == index) {
        Some((_, lists)) => lists[side].push(id.to_string()),
        None => {
            let mut lists = [Vec::new(), Vec::new()];
            lists[side].push(id.to_string());
            over.push((index, lists));
        }
    }
}

pub fn sky_of_wings(run: &Run, index: usize, day: f64) -> (Option<BattleWings>, Option<AirEdge>) {
    assign_wings(run, day);
    let lists = match run.air_over.borrow().iter().find(|(battle, _)| *battle == index) {
        Some((_, lists)) => lists.clone(),
        None => return (None, None),
    };
    let battle = &run.battles[index];
    let flies = battle.sky.as_ref().map(|sky| sky.effects.air).unwrap_or(1.0);
    if !(flies > 0.0) {
        return (None, None);
    }
    let wings = run.wings.borrow();
    let wings = wings.as_ref().unwrap();
    let mut weight = [0.0; 2];
    for side in 0..2 {
        weight[side] = if air_mission_of(battle, side) == "grounded" {
            0.0
        } else {
            let mut sum = 0.0;
            for id in &lists[side] {
                let wing = wings.get(id).unwrap();
                sum += if wing.strength > 0.0 { wing.strength * worth_of(run, &wing.owner) } else { 0.0 };
            }
            sum * flies
        };
    }
    let total = weight[0] + weight[1];
    if !(total > 0.0) {
        return (None, None);
    }
    let holds = if weight[0] >= weight[1] { 0 } else { 1 };
    let superiority = (weight[holds] - weight[1 - holds]) / total;
    let troops = battle.troops[holds].iter().filter(|troop| is_live(troop)).count() as f64;
    let density = if troops > 0.0 { jsmath::min(1.0, weight[holds] / (AIR_PER_TROOP * troops)) } else { 1.0 };
    let edge = superiority * density;
    let mut out = AirEdge { punch: [1.0, 1.0], guard: [1.0, 1.0], legs: [1.0, 1.0] };
    let striking = air_mission_of(battle, holds) == "strike";
    if !striking {
        out.punch[holds] = 1.0 + AIR_SUPPORT * edge;
        out.guard[holds] = 1.0 + AIR_SUPPORT * edge;
    }
    out.legs[1 - holds] = 1.0 - AIR_INTERDICT * edge;
    let flying = [0, 1].map(|side| if air_mission_of(battle, side) == "grounded" { Vec::new() } else { lists[side].clone() });
    (Some(BattleWings { holds, weight, superiority, flying, strike: if striking { Some(edge) } else { None } }), Some(out))
}

pub fn air_strikes(battle: &mut Battle) {
    let (strike, holds) = match &battle.wings {
        Some(wings) => (wings.strike.unwrap_or(f64::NAN), wings.holds),
        None => return,
    };
    if !(strike > 0.0) {
        return;
    }
    for troop in battle.troops[1 - holds].iter_mut() {
        if !is_live(troop) {
            continue;
        }
        troop.loss += (troop.strength / 100.0) * AIR_STRIKE * strike;
    }
}

pub fn wear_wings(run: &Run, battle: &Battle) {
    let sky = match &battle.wings {
        Some(sky) => sky,
        None => return,
    };
    let total = sky.weight[0] + sky.weight[1];
    let mut wings = run.wings.borrow_mut();
    let wings = match wings.as_mut() {
        Some(wings) => wings,
        None => return,
    };
    for side in 0..2 {
        let lost = if total > 0.0 { sky.weight[1 - side] / total } else { 0.0 };
        let wear = if sky.strike.map(|strike| strike > 0.0).unwrap_or(false) && sky.holds == side { AIR_STRIKE_WEAR } else { 1.0 };
        for id in &sky.flying[side] {
            let wing = match wings.get_mut(id) {
                Some(wing) => wing,
                None => continue,
            };
            if !(wing.strength > 0.0) {
                continue;
            }
            wing.strength = jsmath::max(0.0, wing.strength - AIR_LOSS * (0.25 + lost) * wear);
            wing.changed = true;
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct WingChange {
    pub unit_id: String,
    pub strength: Option<f64>,
}

pub fn wing_changes(run: &Run) -> Vec<WingChange> {
    match &*run.wings.borrow() {
        Some(wings) => wings
            .values()
            .filter(|wing| wing.changed && !wing.arm)
            .map(|wing| WingChange { unit_id: wing.id.clone(), strength: if wing.strength >= 1.0 { Some(jsmath::round(wing.strength)) } else { None } })
            .collect(),
        None => Vec::new(),
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SkyHeld {
    pub holds: usize,
    pub wings: [usize; 2],
    pub superiority: f64,
    pub missions: [&'static str; 2],
    pub strike: bool,
}

pub fn sky_held(battle: &Battle) -> Option<SkyHeld> {
    let wings = battle.wings.as_ref()?;
    Some(SkyHeld {
        holds: wings.holds,
        wings: [wings.flying[0].len(), wings.flying[1].len()],
        superiority: jsmath::round(wings.superiority * 100.0) / 100.0,
        missions: [air_mission_of(battle, 0), air_mission_of(battle, 1)],
        strike: wings.strike.map(|strike| strike > 0.0).unwrap_or(false),
    })
}
