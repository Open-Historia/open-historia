use super::js::{self, Val};
use super::record::battlefield_side_of;
use super::war_settings::is_record;

fn pair(value: &Val) -> Vec<Val> {
    value.array_or_empty().to_vec()
}

fn item(value: &Val, at: usize) -> Val {
    match value {
        Val::Arr(list) => list.get(at).cloned().unwrap_or(Val::Undef),
        _ => Val::Undef,
    }
}

fn on_side(entry: &Val, side: f64) -> bool {
    matches!(entry.get("s"), Val::Num(s) if *s == side)
}

fn carry_for(carry: &Val, orders: &[Val], side: f64) -> Val {
    if !carry.truthy() || !is_record(carry) {
        return carry.clone();
    }
    let mut kept: Vec<(usize, usize)> = Vec::new();
    for (index, order) in orders.iter().enumerate() {
        if on_side(order, side) {
            let at = kept.len();
            kept.push((index, at));
        }
    }
    let kept_at = |serves: &Val| -> Option<usize> {
        match serves {
            Val::Num(n) if *n >= 0.0 && n.fract() == 0.0 => kept.iter().find(|(index, _)| *index as f64 == *n).map(|(_, at)| *at),
            _ => None,
        }
    };
    let mine = |index: usize| index as f64 == side;
    let mut seen = js::spread(carry);
    if let Val::Arr(_) = carry.get("under") {
        seen.set("under", Val::Arr((0..2).map(|index| Val::Arr(pair(&item(carry.get("under"), index)).iter().map(|serves| Val::Num(if mine(index) { kept_at(serves).map(|at| at as f64).unwrap_or(-1.0) } else { -1.0 })).collect())).collect()));
    }
    if let Val::Arr(ages) = carry.get("ages") {
        seen.set("ages", Val::Arr(ages.iter().enumerate().filter(|(index, _)| kept.iter().any(|(known, _)| known == index)).map(|(_, age)| age.clone()).collect()));
    }
    if let Val::Arr(_) = carry.get("next") {
        seen.set("next", Val::Arr((0..2).map(|index| Val::Arr(pair(&item(carry.get("next"), index)).iter().map(|point| if mine(index) { point.clone() } else { Val::Num(-1.0) }).collect())).collect()));
    }
    for key in ["generals", "talk", "plans", "levy", "deploy", "staff"] {
        if let Val::Arr(_) = carry.get(key) {
            seen.set(key, Val::Arr((0..2).map(|index| Val::Arr(if mine(index) { pair(&item(carry.get(key), index)) } else { Vec::new() })).collect()));
        }
    }
    if let Val::Arr(halts) = carry.get("halts") {
        seen.set("halts", Val::Arr(halts.iter().filter(|halt| on_side(halt, side)).cloned().collect()));
    }
    Val::Obj(seen)
}

pub fn battlefield_for_viewer(battlefield: &Val, viewer: &Val) -> Val {
    if !battlefield.truthy() || !battlefield.is_object() {
        return battlefield.clone();
    }
    let side = battlefield_side_of(battlefield, viewer);
    let mut view = js::spread(battlefield);
    view.remove("field");
    let orders = battlefield.get("orders").array_or_empty().to_vec();
    view.set("orders", Val::Arr(orders.iter().filter(|order| on_side(order, side)).cloned().collect()));
    view.set(
        "pool",
        Val::Arr(
            (0..2)
                .map(|index| {
                    Val::Num(if index as f64 == side {
                        let number = js::to_number(&item(battlefield.get("pool"), index));
                        if number.is_nan() || number == 0.0 {
                            0.0
                        } else {
                            number
                        }
                    } else {
                        0.0
                    })
                })
                .collect(),
        ),
    );
    let brief_of = battlefield.get("brief");
    if brief_of.truthy() && is_record(brief_of) {
        let mut brief = js::spread(brief_of);
        brief.set("carry", carry_for(brief_of.get("carry"), &orders, side));
        if let Val::Arr(_) = brief_of.get("commands") {
            brief.set("commands", Val::Arr((0..2).map(|index| Val::Arr(if index as f64 == side { pair(&item(brief_of.get("commands"), index)) } else { Vec::new() })).collect()));
        }
        if let Val::Arr(strength) = brief_of.get("strength") {
            brief.set(
                "strength",
                Val::Arr(
                    strength
                        .iter()
                        .enumerate()
                        .map(|(index, entry)| {
                            if index as f64 == side || !entry.truthy() || !is_record(entry) {
                                entry.clone()
                            } else {
                                let mut out = js::spread(entry);
                                out.set("reserves", Val::Num(0.0));
                                Val::Obj(out)
                            }
                        })
                        .collect(),
                ),
            );
        }
        view.set("brief", Val::Obj(brief));
    }
    Val::Obj(view)
}

pub fn battlefields_for_viewer(battlefields: &Val, viewer: &Val) -> Vec<Val> {
    battlefields.array_or_empty().iter().map(|battlefield| battlefield_for_viewer(battlefield, viewer)).collect()
}
