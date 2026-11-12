use super::js::{self, fold, Val};
use std::collections::HashSet;

pub fn battlefield_held_claimants(battlefields: &Val, owners: &Val, sovereigns: &Val, claimants: &Val) -> Vec<(String, Vec<Val>)> {
    let mut changed = Vec::new();
    let fields: Vec<[HashSet<String>; 2]> = battlefields
        .array_or_empty()
        .iter()
        .filter(|record| {
            record.truthy() && !matches!(record.get("status"), Val::Str(status) if status == "standing") && matches!(record.get("sides"), Val::Arr(sides) if sides.len() == 2)
        })
        .map(|record| {
            let side = |at: usize| -> HashSet<String> { record.get("sides").at(at).array_or_empty().iter().map(fold).filter(|name| !name.is_empty()).collect() };
            [side(0), side(1)]
        })
        .collect();
    if fields.is_empty() || !sovereigns.truthy() || !sovereigns.is_object() || !claimants.truthy() || !claimants.is_object() {
        return changed;
    }
    for (region_id, sovereign) in js::entries(sovereigns) {
        let names = match claimants.get(&region_id) {
            Val::Arr(names) if !names.is_empty() => names,
            _ => continue,
        };
        let controller = fold(owners.get(&region_id));
        let lawful = fold(&sovereign);
        if controller.is_empty() || lawful.is_empty() {
            continue;
        }
        let field = fields.iter().find(|[a, b]| (a.contains(&controller) && b.contains(&lawful)) || (b.contains(&controller) && a.contains(&lawful)));
        let field = match field {
            Some(field) => field,
            None => continue,
        };
        let kept: Vec<Val> = names
            .iter()
            .filter(|name| {
                let name = fold(name);
                !field[0].contains(&name) && !field[1].contains(&name)
            })
            .cloned()
            .collect();
        if kept.len() != names.len() {
            changed.push((region_id, kept));
        }
    }
    changed
}
