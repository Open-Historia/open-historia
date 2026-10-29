use super::command::name_generals;
use super::constants::{BATTLEFIELD_NAME_MAX, GENERAL_NAME_MAX, MAX_COMMANDS, MAX_SIDE_MEMBERS, MAX_TROOPS_PER_SIDE, SCENARIO_MARK};
use super::engine::clean;
use super::js::{self, Obj, Val};
use super::swarms::DEPLOY_FORMS;
use crate::jsmath;

pub const MAX_SCENARIO_FRONTS: usize = 8;
pub const SCENARIO_STANCES: [&str; 3] = ["hold", "dig in", "advance"];
pub const SCENARIO_FRONTS_EVENT: &str = "scenario-fronts";

fn fold(value: &Val) -> String {
    clean(value, 200).to_lowercase()
}

fn fold_text(text: &str) -> String {
    fold(&Val::str(text))
}

fn list(value: &Val) -> &[Val] {
    value.array_or_empty()
}

fn members(value: &Val, taken: &[String]) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for raw in list(value) {
        let name = clean(raw, 120);
        if name.is_empty() || taken.contains(&fold_text(&name)) || names.iter().any(|other| fold_text(other) == fold_text(&name)) {
            continue;
        }
        names.push(name);
        if names.len() as f64 >= MAX_SIDE_MEMBERS {
            break;
        }
    }
    names
}

fn texts(names: &[String]) -> Val {
    Val::Arr(names.iter().map(|name| Val::str(name)).collect())
}

fn normalize_front(raw: &Val, draft: bool) -> Option<Val> {
    if !raw.truthy() || !raw.is_plain_object() {
        return None;
    }
    let war = !matches!(raw.get("war"), Val::Bool(false));
    let side_a = members(raw.get("sides").get("0"), &[]);
    let taken: Vec<String> = side_a.iter().map(|name| fold_text(name)).collect();
    let side_b = members(raw.get("sides").get("1"), &taken);
    let sides: [Vec<String>; 2] = if war { [side_a, side_b] } else { [side_a.into_iter().take(1).collect(), side_b.into_iter().take(1).collect()] };
    if !draft && (sides[0].is_empty() || sides[1].is_empty()) {
        return None;
    }
    let at = |key: &str, side: usize| raw.get(key).get(&side.to_string()).clone();
    let stance: Vec<Val> = (0..2)
        .map(|side| {
            let word = fold(&at("stance", side));
            if !SCENARIO_STANCES.contains(&word.as_str()) {
                Val::str("hold")
            } else if !war && word == "advance" {
                Val::str("hold")
            } else {
                Val::Str(word)
            }
        })
        .collect();
    let forms: Vec<String> = (0..2)
        .map(|side| {
            let word = fold(&at("forms", side));
            if DEPLOY_FORMS.contains(&word.as_str()) {
                word
            } else {
                String::new()
            }
        })
        .collect();
    let troops: Vec<Val> = (0..2).map(|side| Val::Num(jsmath::max(0.0, jsmath::min(MAX_TROOPS_PER_SIDE, jsmath::round(js::or_zero(at("troops", side).num())))))).collect();
    let generals: Vec<Val> = (0..2).map(|side| Val::Arr(list(&at("generals", side)).iter().take(MAX_COMMANDS as usize).map(|name| Val::Str(clean(name, GENERAL_NAME_MAX as usize))).collect())).collect();
    let mut out = Obj::new();
    out.set("name", Val::Str(clean(raw.get("name"), BATTLEFIELD_NAME_MAX as usize)));
    out.set("sides", Val::Arr(vec![texts(&sides[0]), texts(&sides[1])]));
    out.set("war", Val::Bool(war));
    out.set("troops", Val::Arr(troops));
    out.set("stance", Val::Arr(stance));
    out.set("generals", Val::Arr(generals));
    if forms.iter().any(|form| !form.is_empty()) {
        out.set("forms", texts(&forms));
    }
    Some(Val::Obj(out))
}

pub fn normalize_scenario_fronts(value: &Val, draft: bool) -> Val {
    let mut fronts = Vec::new();
    for raw in list(value) {
        if let Some(front) = normalize_front(raw, draft) {
            fronts.push(front);
        }
        if fronts.len() >= MAX_SCENARIO_FRONTS {
            break;
        }
    }
    Val::Arr(fronts)
}

pub fn blank_scenario_front() -> Val {
    Val::obj([
        ("name", Val::str("")),
        ("sides", Val::Arr(vec![Val::Arr(Vec::new()), Val::Arr(Vec::new())])),
        ("war", Val::Bool(true)),
        ("troops", Val::nums(&[0.0, 0.0])),
        ("stance", Val::Arr(vec![Val::str("hold"), Val::str("hold")])),
        ("generals", Val::Arr(vec![Val::Arr(Vec::new()), Val::Arr(Vec::new())])),
    ])
}

fn folds(value: &Val) -> Vec<String> {
    list(value).iter().map(fold).collect()
}

fn same(one: &[String], two: &[String]) -> bool {
    one.iter().any(|name| two.contains(name))
}

fn opposed(war: &Val, front: &Val) -> bool {
    let a = folds(war.get("sideA"));
    let b = folds(war.get("sideB"));
    let left = folds(front.get("sides").at(0));
    let right = folds(front.get("sides").at(1));
    let across = |one: &[String], two: &[String]| left.iter().any(|name| one.contains(name)) && right.iter().any(|name| two.contains(name));
    across(&a, &b) || across(&b, &a)
}

pub fn scenario_front_wars(fronts: &Val, wars: &Val, date: &Val) -> Val {
    let mut added: Vec<Val> = Vec::new();
    let ledger: Vec<&Val> = list(wars).iter().filter(|war| clean(war.get("status"), 200).to_lowercase() != "ended").collect();
    for (index, front) in list(fronts).iter().enumerate() {
        if !front.get("war").truthy() || ledger.iter().any(|war| opposed(war, front)) || added.iter().any(|war| opposed(war, front)) {
            continue;
        }
        let when = Val::Str(clean(date, 40));
        let mut war = Obj::new();
        war.set("id", Val::Str(format!("war-scenario-front-{}", index + 1)));
        war.set("title", front.get("name").clone());
        war.set("status", Val::str("active"));
        war.set("sideA", front.get("sides").at(0).clone());
        war.set("sideB", front.get("sides").at(1).clone());
        war.set("startedDate", when.clone());
        war.set("endedDate", Val::str(""));
        war.set("lastUpdatedDate", when);
        war.set("cause", Val::str(""));
        war.set("note", Val::str(""));
        war.set("sourceEventIds", Val::Arr(Vec::new()));
        war.set("storylineIds", Val::Arr(Vec::new()));
        war.set("createdRound", Val::Num(1.0));
        war.set("updatedRound", Val::Num(1.0));
        added.push(Val::Obj(war));
    }
    Val::Arr(added)
}

pub fn scenario_front_orders(fronts: &Val) -> Val {
    let mut orders = Vec::new();
    for (index, front) in list(fronts).iter().enumerate() {
        let sides = front.get("sides");
        let border = format!("border: {} / {}", js::to_string(sides.at(0).at(0)), js::to_string(sides.at(1).at(0)));
        for side in 0..2 {
            let mut order = Obj::new();
            order.set("mark", Val::str(SCENARIO_MARK));
            order.set("id", Val::Str(format!("scenario-front-{index}-{side}")));
            order.set("battlefield", Val::Str(border.clone()));
            order.set("side", sides.at(side).at(0).clone());
            order.set("order", front.get("stance").at(side).clone());
            order.set("sector", Val::str("all"));
            order.set("objective", Val::str(""));
            order.set("result", Val::str(""));
            order.set("effort", Val::str(""));
            order.set("eventIds", Val::Arr(vec![Val::str(SCENARIO_FRONTS_EVENT)]));
            order.set("eventIndexes", Val::Arr(Vec::new()));
            orders.push(Val::Obj(order));
        }
    }
    Val::Arr(orders)
}

fn facing(front: &Val, left: &[String], right: &[String]) -> Option<bool> {
    let a = folds(front.get("sides").at(0));
    let b = folds(front.get("sides").at(1));
    if same(&a, left) && same(&b, right) {
        Some(true)
    } else if same(&a, right) && same(&b, left) {
        Some(false)
    } else {
        None
    }
}

fn swapped(pair: &Val, straight: bool) -> Val {
    if straight {
        pair.clone()
    } else {
        Val::Arr(vec![pair.element(1), pair.element(0)])
    }
}

pub fn authored_troops(fronts: &Val, sides: &Val) -> Val {
    let left = folds(sides.get("0"));
    let right = folds(sides.get("1"));
    for front in list(fronts) {
        if let Some(straight) = facing(front, &left, &right) {
            return swapped(front.get("troops"), straight);
        }
    }
    Val::Null
}

pub fn authored_forms(fronts: &Val, sides: &Val) -> Val {
    let left = folds(sides.get("0"));
    let right = folds(sides.get("1"));
    for front in list(fronts) {
        if let Some(straight) = facing(front, &left, &right) {
            let forms = if front.get("forms").as_array().is_some() { front.get("forms").clone() } else { Val::Arr(vec![Val::str(""), Val::str("")]) };
            return swapped(&forms, straight);
        }
    }
    Val::Null
}

pub fn authored_name(fronts: &Val, sides: &Val) -> Val {
    let left = folds(sides.get("0"));
    let right = folds(sides.get("1"));
    for front in list(fronts) {
        if !front.get("war").truthy() || !front.get("name").truthy() {
            continue;
        }
        if facing(front, &left, &right).is_some() {
            return front.get("name").clone();
        }
    }
    Val::str("")
}

pub fn with_scenario_generals(battlefields: &Val, fronts: &Val) -> Val {
    Val::Arr(
        list(battlefields)
            .iter()
            .map(|record| {
                if !record.truthy() || record.get("sides").as_array().is_none() || matches!(record.get("status"), Val::Str(status) if status == "closed") {
                    return record.clone();
                }
                let left = folds(record.get("sides").at(0));
                let right = folds(record.get("sides").at(1));
                let mut next = record.clone();
                for front in list(fronts) {
                    let straight = match facing(front, &left, &right) {
                        Some(straight) => straight,
                        None => continue,
                    };
                    for side in 0..2 {
                        let names = front.get("generals").at(if straight { side } else { 1 - side });
                        if list(names).iter().any(|name| name.truthy()) {
                            next = name_generals(&next, &Val::Num(side as f64), names, false);
                        }
                    }
                }
                next
            })
            .collect(),
    )
}
