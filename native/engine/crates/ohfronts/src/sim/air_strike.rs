use super::constants::DUG_IN_LOSS;
use super::engine::{clean, Run};
use super::js::{self, Obj, Val};
use super::troops::is_live;
use super::world_grid::{km_between, measure_of};
use crate::jsmath;

pub const AIR_BLAST_FALLOFF: f64 = 0.5;

fn strike_fold(value: &Val) -> String {
    clean(value, 120).to_lowercase()
}

struct Hit {
    key: String,
    country: String,
    n: f64,
    lost: f64,
    own: bool,
}

pub fn bomb_troops(run: &mut Run, moment: &Val, day: f64) {
    let lng = js::to_number(moment.get("lng"));
    let lat = js::to_number(moment.get("lat"));
    let km = js::to_number(moment.get("km"));
    let hit = js::to_number(moment.get("hit"));
    if !lng.is_finite() || !lat.is_finite() || !(km > 0.0) || !(hit > 0.0) {
        return;
    }
    let measure = measure_of(run.input.get("map"));
    let owner = strike_fold(moment.get("owner"));
    let date = run.date_of(day);
    let told = clean(moment.get("at"), 120);
    let at_text = clean(moment.get("at"), 160);
    let reference = clean(moment.get("ref"), 120);
    let mut notes: Vec<Val> = Vec::new();
    for battle in run.battles.iter_mut() {
        if battle.status != "active" || battle.field.is_none() {
            continue;
        }
        let [x, y] = battle.place.to_cell(lng, lat);
        let (cols, rows) = {
            let field = battle.field.as_ref().unwrap();
            (field.cols as f64, field.rows as f64)
        };
        if !(x >= 0.0 && y >= 0.0 && x < cols && y < rows) {
            continue;
        }
        let own_side: i64 = (0..2).find(|&side| battle.sides[side].iter().any(|member| strike_fold(&Val::str(member)) == owner)).map_or(-1, |side| side as i64);
        let mut hits: Vec<Hit> = Vec::new();
        for side in 0..2 {
            for index in 0..battle.troops[side].len() {
                let troop = &battle.troops[side][index];
                if !is_live(troop) {
                    continue;
                }
                let [t_lng, t_lat] = battle.place.to_lng_lat(troop.x, troop.y);
                let distance = km_between(lng, lat, t_lng, t_lat, measure);
                if distance > km {
                    continue;
                }
                let sheltered = if troop.dug {
                    match &battle.works {
                        Some(works) => works.loss,
                        None => DUG_IN_LOSS,
                    }
                } else {
                    1.0
                };
                let cut = jsmath::min(troop.strength, hit * (1.0 - (AIR_BLAST_FALLOFF * distance) / km) * sheltered);
                if !(cut > 0.0) {
                    continue;
                }
                let owner_at = troop.owner;
                battle.troops[side][index].strength -= cut;
                let country = (if owner_at >= 0.0 && owner_at.fract() == 0.0 { battle.sides[side].get(owner_at as usize) } else { None }).or(battle.sides[side].first()).cloned().unwrap_or_default();
                let key = format!("{}|{}", side, strike_fold(&Val::str(&country)));
                match hits.iter_mut().find(|entry| entry.key == key) {
                    Some(entry) => {
                        entry.n += 1.0;
                        entry.lost += cut;
                    }
                    None => hits.push(Hit { key, country, n: 1.0, lost: cut, own: side as i64 == own_side }),
                }
            }
        }
        battle.touched = true;
        if !told.is_empty() {
            let mut entry = Obj::new();
            entry.set("d", Val::str(&date));
            entry.set("k", Val::str("bombed"));
            if own_side >= 0 {
                entry.set("s", Val::Num(own_side as f64));
            }
            entry.set("at", Val::str(&at_text));
            battle.log.push(Val::Obj(entry));
        }
        let listed: Vec<Val> = hits
            .iter()
            .map(|entry| {
                let mut out = Obj::new();
                out.set("country", Val::str(&entry.country));
                out.set("n", Val::Num(entry.n));
                out.set("lost", Val::Num(jsmath::round(entry.lost)));
                if entry.own {
                    out.set("own", Val::Bool(true));
                }
                Val::Obj(out)
            })
            .collect();
        notes.push(Val::obj([("kind", Val::str("airstrike")), ("ref", Val::str(&reference)), ("battlefield", Val::str(&battle.name)), ("hits", Val::Arr(listed))]));
    }
    run.notes.extend(notes);
}
