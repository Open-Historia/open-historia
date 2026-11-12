use super::battle::{Battle, Tally};
use super::engine::Run;
use super::js::OrdMap;
use super::manpower::men_of;
use crate::jsmath;

#[derive(Clone, Debug, PartialEq)]
pub struct AttritionEntry {
    pub name: String,
    pub lost: f64,
    pub men: f64,
    pub troop_days: f64,
    pub harsh_days: f64,
    pub days: f64,
}

pub fn attrition_report(run: &Run, days: f64) -> Vec<AttritionEntry> {
    let mut totals: OrdMap<String, (String, [f64; 3])> = OrdMap::new();
    for battle in &run.battles {
        let out_by = match &battle.out_by {
            Some(out_by) => out_by,
            None => continue,
        };
        for side in 0..2 {
            let mut add = |counts: Option<&Tally>, field: usize| {
                let counts = match counts {
                    Some(counts) => counts,
                    None => return,
                };
                for (owner, value) in &counts.by_owner.entries {
                    let name = match battle.sides[side].get(*owner) {
                        Some(name) if !name.is_empty() => name,
                        _ => continue,
                    };
                    let key = name.to_lowercase();
                    if !totals.has(&key) {
                        totals.set(key.clone(), (name.clone(), [0.0; 3]));
                    }
                    totals.get_mut(&key).unwrap().1[field] += value;
                }
            };
            add(battle.lost_by.as_ref().map(|by| &by[side]), 0);
            add(Some(&out_by[side]), 1);
            add(battle.harsh_by.as_ref().map(|by| &by[side]), 2);
        }
    }
    totals
        .values()
        .map(|(name, [lost, troop_days, harsh_days])| AttritionEntry {
            name: name.clone(),
            lost: jsmath::round(lost * 10.0) / 10.0,
            men: jsmath::round((lost / 100.0) * men_of(run, name)),
            troop_days: *troop_days,
            harsh_days: *harsh_days,
            days,
        })
        .collect()
}

pub fn battle_attrition(battle: &Battle) -> Option<[f64; 2]> {
    let lost_by = battle.lost_by.as_ref()?;
    let lost = [0, 1].map(|side| {
        let mut sum = 0.0;
        for value in lost_by[side].by_owner.values() {
            sum += value;
        }
        jsmath::round(sum / 10.0) / 10.0
    });
    if lost[0] > 0.0 || lost[1] > 0.0 {
        Some(lost)
    } else {
        None
    }
}
