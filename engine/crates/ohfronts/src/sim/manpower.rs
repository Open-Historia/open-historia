use super::battle::Battle;
use super::constants::{MANPOWER_SHARE, MEN_PER_FORMATION_BY_ERA, PART_COUNTER_LEAST};
use super::engine::{ManEntry, Run};
use super::js::{self, fold_text, Val};
use crate::jsmath;

pub fn men_per_formation(era: &Val) -> Option<f64> {
    let at = jsmath::max(0.0, jsmath::min((MEN_PER_FORMATION_BY_ERA.len() - 1) as f64, js::or_zero(era.num())));
    if at.fract() == 0.0 {
        Some(MEN_PER_FORMATION_BY_ERA[at as usize])
    } else {
        None
    }
}

pub fn men_of(run: &Run, name: &str) -> f64 {
    let own = if run.mech.military() { run.military_of(name).men_per_counter } else { None };
    match own {
        Some(own) if own > 0.0 => own,
        _ => run.men_each,
    }
}

pub fn share_from(run_share: f64, own_share: Option<f64>) -> f64 {
    let base = if run_share > 0.0 { run_share } else { MANPOWER_SHARE };
    match own_share {
        Some(own) if own > 0.0 && own / 100.0 > base => own / 100.0,
        _ => base,
    }
}

pub fn share_of(run: &Run, name: &str) -> f64 {
    let own = if run.mech.military() { run.military_of(name).manpower_share } else { None };
    share_from(run.manpower_share, own)
}

pub fn people_of(run: &Run, name: &str) -> f64 {
    let people = run.hooks.people_of(name).num();
    if people.is_finite() && people > 0.0 {
        people
    } else {
        0.0
    }
}

pub fn levies(run: &Run) -> bool {
    !matches!(run.input.get("manpower"), Val::Bool(false)) && !run.input.get("authored").truthy()
}

fn add_men(run: &Run, name: &str, drawn: f64, returned: f64) {
    let key = fold_text(name);
    if key.is_empty() {
        return;
    }
    let mut book = run.manpower.borrow_mut();
    if !book.has(&key) {
        book.set(key.clone(), ManEntry { name: js::trim(&js::collapse_spaces(name)).to_string(), drawn: 0.0, returned: 0.0 });
    }
    let entry = book.get_mut(&key).unwrap();
    entry.drawn += drawn;
    entry.returned += returned;
}

pub fn draw(run: &Run, name: &str, men: f64) {
    if !levies(run) || !(men > 0.0) || people_of(run, name) == 0.0 {
        return;
    }
    let key = fold_text(name);
    if key.is_empty() {
        return;
    }
    add_men(run, name, men, 0.0);
}

pub fn give_back(run: &Run, name: &str, men: f64) {
    if !levies(run) || !(men > 0.0) || people_of(run, name) == 0.0 {
        return;
    }
    add_men(run, name, 0.0, men);
}

fn is_named(battle: &Battle, side: usize, at: usize) -> bool {
    battle.named.iter().any(|entry| entry.s == side && entry.i == at)
}

pub fn serving_of(run: &Run, name: &str) -> f64 {
    let wanted = fold_text(name);
    let mut strength = 0.0;
    for battle in &run.battles {
        if battle.status == "closed" {
            continue;
        }
        for side in 0..2 {
            let owner = match battle.sides[side].iter().position(|member| fold_text(member) == wanted) {
                Some(owner) => owner as f64,
                None => continue,
            };
            for (at, troop) in battle.troops[side].iter().enumerate() {
                if troop.owner != owner || !(troop.strength > 0.0) || is_named(battle, side, at) {
                    continue;
                }
                strength += troop.strength;
            }
        }
    }
    (strength / 100.0) * men_of(run, name)
}

pub fn formations_left(run: &Run, name: &str) -> f64 {
    if !levies(run) {
        return f64::INFINITY;
    }
    let people = people_of(run, name);
    if people == 0.0 {
        return f64::INFINITY;
    }
    jsmath::max(0.0, ((share_of(run, name) * people - serving_of(run, name)) / men_of(run, name)).floor())
}

pub fn part_left(run: &Run, name: &str) -> f64 {
    if !run.mech.military() || !levies(run) {
        return 0.0;
    }
    let people = people_of(run, name);
    if people == 0.0 {
        return 0.0;
    }
    let men = share_of(run, name) * people - serving_of(run, name);
    if !(men > 0.0) {
        return 0.0;
    }
    let counters = men / men_of(run, name);
    let part = counters - counters.floor();
    if part >= PART_COUNTER_LEAST {
        part
    } else {
        0.0
    }
}

pub fn side_formations_left(run: &Run, battle: &Battle, side: usize) -> f64 {
    let mut left = 0.0;
    for (at, member) in battle.sides[side].iter().enumerate() {
        if !battle.gone[side].contains(&at) {
            left += formations_left(run, member);
        }
    }
    left
}

pub fn mend_budget(run: &Run, day: f64) {
    let mut mend = run.mend.borrow_mut();
    if mend.day != Some(day) {
        mend.day = Some(day);
        mend.left = js::OrdMap::new();
    }
}

fn mend_key(run: &Run, name: &str) -> String {
    let key = fold_text(name);
    if !run.mend.borrow().left.has(&key) {
        let people = if levies(run) { people_of(run, name) } else { 0.0 };
        let left = if people == 0.0 { f64::INFINITY } else { jsmath::max(0.0, ((share_of(run, name) * people - serving_of(run, name)) / men_of(run, name)) * 100.0) };
        run.mend.borrow_mut().left.set(key.clone(), left);
    }
    key
}

pub fn mend_left(run: &Run, name: &str) -> f64 {
    let key = mend_key(run, name);
    let left = run.mend.borrow().left.get(&key).copied().unwrap_or(f64::NAN);
    left
}

pub fn mend_spend(run: &Run, name: &str, points: f64) {
    let key = mend_key(run, name);
    let mut mend = run.mend.borrow_mut();
    let left = mend.left.get(&key).copied().unwrap_or(f64::NAN);
    mend.left.set(key, left - points);
}

pub fn send_home(run: &Run, battle: &Battle, side: usize, indexes: Option<&[usize]>) {
    if !levies(run) {
        return;
    }
    for (at, troop) in battle.troops[side].iter().enumerate() {
        if !(troop.strength > 0.0) || indexes.is_some_and(|list| !list.contains(&at)) || is_named(battle, side, at) {
            continue;
        }
        let member = match battle.sides[side].get(troop.owner as usize).filter(|_| troop.owner >= 0.0 && troop.owner.fract() == 0.0) {
            Some(member) => member,
            None => continue,
        };
        give_back(run, member, (troop.strength / 100.0) * men_of(run, member));
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ManReport {
    pub name: String,
    pub drawn: f64,
    pub returned: f64,
}

pub fn manpower_report(run: &Run) -> Vec<ManReport> {
    let mut totals: js::OrdMap<String, ManEntry> = js::OrdMap::new();
    let mut add = |name: &str, drawn: bool, men: f64| {
        let key = fold_text(name);
        if key.is_empty() || !(men > 0.0) {
            return;
        }
        if !totals.has(&key) {
            totals.set(key.clone(), ManEntry { name: js::trim(&js::collapse_spaces(name)).to_string(), drawn: 0.0, returned: 0.0 });
        }
        let entry = totals.get_mut(&key).unwrap();
        if drawn {
            entry.drawn += men;
        } else {
            entry.returned += men;
        }
    };
    for entry in run.manpower.borrow().values() {
        add(&entry.name, true, entry.drawn);
        add(&entry.name, false, entry.returned);
    }
    if levies(run) {
        for battle in &run.battles {
            for side in 0..2 {
                for (owner, points) in battle.mended_by[side].iter().enumerate() {
                    let points = match points {
                        Some(points) => *points,
                        None => continue,
                    };
                    let member = match battle.sides[side].get(owner) {
                        Some(member) if !member.is_empty() => member,
                        _ => continue,
                    };
                    if points > 0.0 && people_of(run, member) > 0.0 {
                        add(member, true, (points / 100.0) * men_of(run, member));
                    }
                }
            }
        }
    }
    totals
        .values()
        .map(|entry| ManReport { name: entry.name.clone(), drawn: jsmath::round(entry.drawn), returned: jsmath::round(entry.returned) })
        .filter(|entry| entry.drawn > 0.0 || entry.returned > 0.0)
        .collect()
}
