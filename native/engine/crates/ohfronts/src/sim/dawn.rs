use super::air::{air_strikes, sky_of_wings, wear_wings};
use super::battle::{Battle, Tally};
use super::climate::climate_at;
use super::constants::{ATTRITION_HARSH_FROM, STILL_EDGE, STRONG_WORKS};
use super::engine::{Effort, Run};
use super::fatigue::{guard_left, legs_left, punch_left, tire_day};
use super::ground::cell_at;
use super::js::{self, Val};
use super::manpower::mend_budget;
use super::mechanics::any_of;
use super::troops::is_live;
use super::walls::{kept_with, raise_walls};
use super::weather::{harshness_of, sky_over};

fn steered(run: &Run, key: &str, side: usize) -> f64 {
    let list = run.steer.get("readiness").get(key);
    let value = if list.as_array().is_some() { js::to_number(list.at(side)) } else { f64::NAN };
    if value.is_finite() && value >= 0.0 {
        value
    } else {
        1.0
    }
}

pub fn dawns_on(run: &Run) -> bool {
    any_of(&run.mech) || run.steer.get("readiness").truthy()
}

pub fn dawn(run: &mut Run, index: usize, day: f64) {
    if !dawns_on(run) {
        return;
    }
    let mut battles = std::mem::take(&mut run.battles);
    let sky = {
        let battle = &mut battles[index];
        if run.mech.walls() {
            raise_walls(run, battle, &run.date_of(day));
            battle.kept = kept_with(battle);
        }
        let sky = if run.mech.weather() { Some(sky_over(run, battle, day)) } else { None };
        if sky.is_none() {
            battle.sky = None;
        }
        sky
    };
    run.battles = battles;
    let pace = sky.as_ref().map(|sky| sky.effects.pace).unwrap_or(1.0);
    let blows = sky.as_ref().map(|sky| sky.effects.attack).unwrap_or(1.0);
    let air = if run.mech.air() {
        let (wings, edge) = sky_of_wings(run, index, day);
        run.battles[index].wings = wings;
        edge
    } else {
        None
    };
    let mut battles = std::mem::take(&mut run.battles);
    let battle = &mut battles[index];
    battle.works = if run.mech.fatigue() { Some(STRONG_WORKS) } else { None };
    battle.corridors = run.mech.supply();
    let counting = run.mech.attrition();
    if counting && battle.out_by.is_none() {
        battle.out_by = Some([Tally::default(), Tally::default()]);
        battle.harsh_by = Some([Tally::default(), Tally::default()]);
        battle.lost_by = Some([Tally::default(), Tally::default()]);
    }
    battle.exposure = if counting { Some([0, 1].map(|side| battle.short.map(|short| short[side]).unwrap_or(0.0))) } else { None };
    let Battle { troops, worth, climate_today, field, out_by, harsh_by, .. } = battle;
    for side in 0..2 {
        let punch = steered(run, "punch", side);
        let guard = steered(run, "guard", side);
        let legs = steered(run, "legs", side);
        for troop in troops[side].iter_mut() {
            if !is_live(troop) {
                continue;
            }
            let worth = match worth {
                Some(worth) => worth[side].get(troop.owner as usize).copied().unwrap_or(1.0),
                None => 1.0,
            };
            let tired = run.mech.fatigue() && troop.fatigue > 0.0;
            troop.climate = match (&sky, climate_today.as_ref()) {
                (Some(_), Some(today)) => Some(climate_at(today, cell_at(field.as_ref().unwrap(), troop.x, troop.y))),
                _ => None,
            };
            let local = troop.climate;
            if counting {
                out_by.as_mut().unwrap()[side].add(troop.owner as usize, 1.0);
                if sky.is_some() && harshness_of(sky.as_ref(), troop) >= ATTRITION_HARSH_FROM {
                    harsh_by.as_mut().unwrap()[side].add(troop.owner as usize, 1.0);
                }
            }
            let still = if run.mech.fatigue() && troop.still.is_true() { 1.0 + STILL_EDGE } else { 1.0 };
            troop.punch = (if tired { punch * punch_left(troop.fatigue) } else { punch })
                * worth
                * blows
                * air.map(|air| air.punch[side]).unwrap_or(1.0)
                * local.map(|local| local.attack()).unwrap_or(1.0)
                * still;
            troop.guard = (if tired { guard * guard_left(troop.fatigue) } else { guard }) * worth * air.map(|air| air.guard[side]).unwrap_or(1.0) * still;
            troop.legs = (if tired { legs * legs_left(troop.fatigue) } else { legs }) * pace * air.map(|air| air.legs[side]).unwrap_or(1.0) * local.map(|local| local.pace()).unwrap_or(1.0);
        }
    }
    run.battles = battles;
}

fn mark_advance(run: &mut Run, battle: &mut Battle, day: f64) {
    for side in 0..2 {
        for troop in battle.troops[side].iter_mut() {
            if !is_live(troop) {
                continue;
            }
            let advanced = troop.walked_today || troop.fought;
            troop.still = Val::Bool(!advanced);
            if !run.mech.supply() {
                continue;
            }
            let name = match battle.sides[side].get(troop.owner as usize) {
                Some(name) if !name.is_empty() => name.clone(),
                _ => continue,
            };
            let key = js::lower(&name);
            if !run.effort.has(&key) {
                run.effort.set(key.clone(), Effort { name: name.clone(), advanced: 0.0, troop_days: 0.0, war_days: 0.0, last_day: -1.0 });
            }
            let entry = run.effort.get_mut(&key).unwrap();
            entry.troop_days += 1.0;
            if advanced {
                entry.advanced += 1.0;
            }
            if entry.last_day != day {
                entry.last_day = day;
                entry.war_days += 1.0;
            }
        }
    }
}

pub fn dusk(run: &mut Run, index: usize, day: f64) {
    if !any_of(&run.mech) {
        return;
    }
    if run.mech.air() {
        air_strikes(&mut run.battles[index]);
        wear_wings(run, &run.battles[index]);
    }
    let mut battles = std::mem::take(&mut run.battles);
    let battle = &mut battles[index];
    if run.mech.fatigue() {
        let (wear, rest) = battle.sky.as_ref().map(|sky| (sky.effects.wear, sky.effects.rest)).unwrap_or((0.0, 1.0));
        tire_day(run, battle, wear, rest);
    }
    if run.mech.fatigue() || run.mech.supply() {
        mark_advance(run, battle, day);
    }
    if run.mech.military() {
        mend_budget(run, day);
        battle.mend_of = true;
    } else {
        battle.mend_of = false;
    }
    run.battles = battles;
}
