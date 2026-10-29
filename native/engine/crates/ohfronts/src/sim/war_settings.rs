use super::engine::clean;
use super::js::{self, Obj, Val};
use super::mechanics::MECHANICS;
use crate::jsmath;

pub const WAR_OUTCOMES_MOST: usize = 24;
pub const MEN_PER_COUNTER_MOST: f64 = 1000000.0;
pub const MUSTER_DAYS_MOST: f64 = 3650.0;
pub const WARFARE_FORMS: [&str; 2] = ["front", "swarm"];

pub fn is_record(value: &Val) -> bool {
    matches!(value, Val::Obj(_) | Val::Map(_) | Val::Set(_) | Val::Typed(_))
}

pub fn normalize_war_outcomes(value: &Val) -> Vec<Val> {
    let mut kept = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for raw in value.array_or_empty() {
        let winner = clean(raw.get("winner"), 120);
        let loser = clean(raw.get("loser"), 120);
        let fold = |text: &str| js::lower(&clean(&Val::str(text), 120));
        if winner.is_empty() || loser.is_empty() || fold(&winner) == fold(&loser) {
            continue;
        }
        let key = format!("{}\u{1}{}", fold(&winner), fold(&loser));
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        kept.push(Val::obj([("winner", Val::Str(winner)), ("loser", Val::Str(loser))]));
        if kept.len() >= WAR_OUTCOMES_MOST {
            break;
        }
    }
    kept
}

pub fn number_in(value: &Val, least: f64, most: f64) -> Option<f64> {
    if value.is_nullish() || matches!(value, Val::Str(text) if text.is_empty()) {
        return None;
    }
    let number = js::to_number(value);
    if number.is_finite() && number >= least && number <= most {
        Some(number)
    } else {
        None
    }
}

pub fn normalize_era(value: &Val) -> Option<f64> {
    number_in(value, 0.0, 3.0).filter(|era| era.trunc() == *era)
}

pub fn normalize_muster_points(value: &Val) -> Option<Val> {
    let list = value.as_array()?;
    if list.len() < 2 {
        return None;
    }
    let mut points: Vec<(f64, f64)> = Vec::new();
    for point in list.iter().take(2) {
        let listed = point.as_array().is_some();
        let share = number_in(&if listed { point.at(0).clone() } else { Val::Num(f64::NAN) }, 0.001, 1.0);
        let days = number_in(&if listed { point.at(1).clone() } else { Val::Num(f64::NAN) }, 0.1, MUSTER_DAYS_MOST);
        points.push((share?, days?));
    }
    js::stable_sort_by(&mut points, |a, b| a.0 - b.0);
    if points[1].0 - points[0].0 < 0.001 || points[1].1 <= points[0].1 {
        return None;
    }
    Some(Val::Arr(points.iter().map(|&(share, days)| Val::nums(&[jsmath::round(share * 1000.0) / 1000.0, jsmath::round(days * 10.0) / 10.0])).collect()))
}

pub fn normalize_warfare(value: &Val) -> Option<&'static str> {
    match value {
        Val::Str(form) => WARFARE_FORMS.iter().copied().find(|known| known == form),
        _ => None,
    }
}

fn or_null(value: Option<f64>) -> Val {
    value.map(Val::Num).unwrap_or(Val::Null)
}

pub fn normalize_war_settings(value: &Val) -> Option<Val> {
    if !value.truthy() || !is_record(value) {
        return None;
    }
    let mut mechanics = Obj::new();
    for key in MECHANICS {
        if let Val::Bool(on) = value.get("mechanics").get(key) {
            mechanics.set(key, Val::Bool(*on));
        }
    }
    let men = number_in(value.get("menPerCounter"), 1.0, MEN_PER_COUNTER_MOST);
    let share = number_in(value.get("manpowerShare"), 1.0, 100.0);
    let outcomes = normalize_war_outcomes(value.get("outcomes"));
    let mut out = Obj::new();
    out.set("mechanics", Val::Obj(mechanics));
    out.set("era", or_null(normalize_era(value.get("era"))));
    out.set("menPerCounter", or_null(men.map(jsmath::round)));
    out.set("manpowerShare", or_null(share.map(|share| jsmath::round(share * 10.0) / 10.0)));
    out.set("muster", normalize_muster_points(value.get("muster")).unwrap_or(Val::Null));
    if !outcomes.is_empty() {
        out.set("outcomes", Val::Arr(outcomes));
    }
    if let Some(form) = normalize_warfare(value.get("warfare")) {
        out.set("warfare", Val::str(form));
    }
    Some(Val::Obj(out))
}

pub fn war_settings_of(world: &Val) -> Val {
    let kept = normalize_war_settings(world.get("warSettings")).unwrap_or_else(|| Val::obj([("mechanics", Val::Obj(Obj::new())), ("era", Val::Null), ("menPerCounter", Val::Null), ("manpowerShare", Val::Null), ("muster", Val::Null)]));
    let mut mechanics = Obj::new();
    for key in MECHANICS {
        mechanics.set(key, Val::Bool(!matches!(kept.get("mechanics").get(key), Val::Bool(false))));
    }
    let mut out = js::spread(&kept);
    out.set("mechanics", Val::Obj(mechanics));
    Val::Obj(out)
}
