use super::battle::Battle;
use super::constants::*;
use super::engine::Run;
use super::troops::is_live;

pub fn tire_day(run: &Run, battle: &mut Battle, wear: f64, rest: f64) {
    for side in 0..2 {
        for troop in battle.troops[side].iter_mut() {
            if !is_live(troop) {
                continue;
            }
            let advance = if troop.kind >= 0.0 && troop.kind.fract() == 0.0 { run.advance_km.get(troop.kind as usize).copied().unwrap_or(f64::NAN) } else { f64::NAN };
            let full = advance * run.pace;
            let marched = if full > 0.0 { troop.moved_km / full } else { 0.0 };
            let busy = troop.fought || troop.engaged || troop.moved_km >= FATIGUE_STILL_KM;
            if busy {
                let rise = FATIGUE_MARCH * (if marched > 1.0 { 1.0 } else { marched })
                    + (if troop.fought {
                        FATIGUE_ATTACK
                    } else if troop.engaged {
                        FATIGUE_DEFEND
                    } else {
                        0.0
                    })
                    + wear
                    + troop.climate.map(|climate| climate.wear()).unwrap_or(0.0);
                troop.fatigue = if troop.fatigue + rise > 1.0 { 1.0 } else { troop.fatigue + rise };
            } else {
                let fall = FATIGUE_REST * (if troop.dug { FATIGUE_REST_DUG } else { 1.0 }) * (if troop.pocket { FATIGUE_REST_POCKET } else { troop.supply }) * rest;
                troop.fatigue = if troop.fatigue - fall < 0.0 { 0.0 } else { troop.fatigue - fall };
            }
        }
    }
}

pub fn punch_left(fatigue: f64) -> f64 {
    1.0 - FATIGUE_PUNCH * fatigue
}

pub fn guard_left(fatigue: f64) -> f64 {
    1.0 - FATIGUE_GUARD * fatigue
}

pub fn legs_left(fatigue: f64) -> f64 {
    1.0 - FATIGUE_LEGS * fatigue
}
