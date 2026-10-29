use super::constants::{MANPOWER_SHARE, MEN_PER_FORMATION_BY_ERA, PART_COUNTER_LEAST};
use super::js::{self, Val};
use crate::jsmath;

pub fn men_per_formation(era: &Val) -> Option<f64> {
    let at = jsmath::max(0.0, jsmath::min((MEN_PER_FORMATION_BY_ERA.len() - 1) as f64, js::or_zero(era.num())));
    if at.fract() == 0.0 {
        Some(MEN_PER_FORMATION_BY_ERA[at as usize])
    } else {
        None
    }
}

pub fn men_of(own_per_counter: Option<f64>, men_each: f64) -> f64 {
    match own_per_counter {
        Some(own) if own > 0.0 => own,
        _ => men_each,
    }
}

pub fn share_of(run_share: f64, own_share: Option<f64>) -> f64 {
    let base = if run_share > 0.0 { run_share } else { MANPOWER_SHARE };
    match own_share {
        Some(own) if own > 0.0 && own / 100.0 > base => own / 100.0,
        _ => base,
    }
}

pub fn people_value(people: f64) -> f64 {
    if people.is_finite() && people > 0.0 {
        people
    } else {
        0.0
    }
}

pub fn formations_left(levies: bool, people: f64, share: f64, serving: f64, men: f64) -> f64 {
    if !levies || people == 0.0 {
        return f64::INFINITY;
    }
    jsmath::max(0.0, ((share * people - serving) / men).floor())
}

pub fn part_left(military_on: bool, levies: bool, people: f64, share: f64, serving: f64, men: f64) -> f64 {
    if !military_on || !levies || people == 0.0 {
        return 0.0;
    }
    let left = share * people - serving;
    if !(left > 0.0) {
        return 0.0;
    }
    let counters = left / men;
    let part = counters - counters.floor();
    if part >= PART_COUNTER_LEAST {
        part
    } else {
        0.0
    }
}
