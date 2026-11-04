use super::chronicle::{read_chronicle, Chronicle};
use super::codec::{decode_mask, is_packed_text, TROOP_LETTERS};
use super::constants::*;
use super::engine::{clean, member_list};
use super::frame::{cell_index_at, normalize_frame, Frame, Projector};
use super::invade::read_attacks;
use super::js::{self, Obj, Val};
use super::letters::letter_or_number;
use super::replay::{normalize_replay, replay_between, replay_day_on, replay_of, replay_window_of, Read};
use crate::codec::{decode_troops, Troop as Code};
use crate::jsmath;

const NAME_MAX: usize = 120;
const DATE_MAX: usize = 40;
const PACKED_MAX: usize = 200000;

fn is_record(value: &Val) -> bool {
    matches!(value, Val::Obj(_) | Val::Map(_) | Val::Set(_) | Val::Typed(_))
}

pub fn fold_battlefield_name(value: &Val) -> String {
    js::lower(&clean(value, BATTLEFIELD_NAME_MAX as usize))
}

fn fold_name(value: &Val) -> String {
    js::lower(&clean(value, NAME_MAX))
}

fn item(value: &Val, at: usize) -> Val {
    match value {
        Val::Arr(list) => list.get(at).cloned().unwrap_or(Val::Undef),
        _ => Val::Undef,
    }
}

fn pair_of<F: Fn(&Val) -> Val>(value: &Val, read: F) -> Val {
    Val::Arr(vec![read(&item(value, 0)), read(&item(value, 1))])
}

fn amount(fallback: f64) -> impl Fn(&Val) -> Val {
    move |value: &Val| {
        let number = js::to_number(value);
        Val::Num(if number.is_finite() && number >= 0.0 { number } else { fallback })
    }
}

fn packed(value: &Val) -> String {
    match value {
        Val::Str(text) if js::utf16_len(text) <= PACKED_MAX && is_packed_text(text) => text.clone(),
        _ => String::new(),
    }
}

fn troop_text(value: &Val) -> Val {
    let text = packed(value);
    let count = (text.len() / TROOP_LETTERS).min(MAX_TROOPS_PER_SIDE as usize);
    Val::Str(text[..count * TROOP_LETTERS].to_string())
}

fn side_index(value: &Val) -> Option<f64> {
    match value {
        Val::Num(n) if *n == 0.0 || *n == 1.0 => Some(*n),
        _ => None,
    }
}

fn names_val(names: &[String]) -> Val {
    Val::Arr(names.iter().map(|name| Val::str(name)).collect())
}

fn normalize_order(raw: &Val) -> Option<(usize, Val)> {
    if !is_record(raw) {
        return None;
    }
    let s = side_index(raw.get("s"))?;
    let order = js::lower(&clean(raw.get("order"), 20));
    if !FRONT_ORDERS.contains(&order.as_str()) {
        return None;
    }
    let mut entry = Obj::new();
    entry.set("s", Val::Num(s));
    let sector = clean(raw.get("sector"), NAME_MAX);
    entry.set("sector", Val::Str(if sector.is_empty() { "all".to_string() } else { sector }));
    entry.set("order", Val::Str(order));
    entry.set("since", Val::Str(clean(raw.get("since"), DATE_MAX)));
    let objective = clean(raw.get("objective"), NAME_MAX);
    if !objective.is_empty() {
        entry.set("objective", Val::Str(objective));
    }
    let effort = js::lower(&clean(raw.get("effort"), 20));
    if FRONT_EFFORTS.contains(&effort.as_str()) {
        entry.set("effort", Val::Str(effort));
    }
    let by = clean(raw.get("by"), NAME_MAX);
    if !by.is_empty() {
        entry.set("by", Val::Str(by));
    }
    let chosen = raw.get("chosen").is_true();
    if chosen {
        entry.set("chosen", Val::Bool(true));
    }
    let lined = matches!(raw.get("mark"), Val::Str(mark) if LINE_MARKS.contains(&mark.as_str()));
    let mark = if chosen || lined { clean(raw.get("mark"), MARK_MAX as usize) } else { String::new() };
    if !mark.is_empty() {
        entry.set("mark", Val::Str(mark));
    }
    let mut way: Vec<Val> = Vec::new();
    for point in raw.get("way").array_or_empty() {
        let (lng, lat) = if point.as_array().is_some() { (js::to_number(point.at(0)), js::to_number(point.at(1))) } else { (f64::NAN, f64::NAN) };
        if !lng.is_finite() || !lat.is_finite() || lat.abs() > 90.0 {
            continue;
        }
        way.push(Val::nums(&[jsmath::round(lng * 10000.0) / 10000.0, jsmath::round(lat * 10000.0) / 10000.0]));
        if way.len() as f64 >= MAX_WAY_POINTS {
            break;
        }
    }
    if !way.is_empty() {
        entry.set("way", Val::Arr(way));
    }
    let attacks = if chosen { read_attacks(raw.get("attacks")) } else { Vec::new() };
    if !attacks.is_empty() {
        entry.set("attacks", names_val(&attacks));
    }
    Some((s as usize, Val::Obj(entry)))
}

fn normalize_orders(value: &Val) -> Val {
    let mut kept = Vec::new();
    let mut count = [0.0; 2];
    for raw in value.array_or_empty() {
        let (side, order) = match normalize_order(raw) {
            Some(found) => found,
            None => continue,
        };
        if count[side] >= MAX_ORDERS_PER_SIDE {
            continue;
        }
        count[side] += 1.0;
        kept.push(order);
    }
    Val::Arr(kept)
}

fn normalize_named(value: &Val) -> Val {
    let mut kept = Vec::new();
    for raw in value.array_or_empty() {
        if !is_record(raw) {
            continue;
        }
        let s = side_index(raw.get("s"));
        let i = js::to_number(raw.get("i"));
        let unit_id = clean(raw.get("unitId"), NAME_MAX);
        let s = match s {
            Some(s) if i.is_finite() && i.trunc() == i && i >= 0.0 && i < MAX_TROOPS_PER_SIDE && !unit_id.is_empty() => s,
            _ => continue,
        };
        kept.push(Val::obj([("s", Val::Num(s)), ("i", Val::Num(i)), ("name", Val::Str(clean(raw.get("name"), NAME_MAX))), ("unitId", Val::Str(unit_id))]));
        if kept.len() as f64 >= MAX_NAMED_TROOPS {
            break;
        }
    }
    Val::Arr(kept)
}

fn normalize_contested(value: &Val) -> Val {
    let mut kept = Vec::new();
    let mut known: Vec<String> = Vec::new();
    for raw in value.array_or_empty() {
        let listed = raw.as_array().is_some();
        let region_id = clean(&if listed { item(raw, 0) } else { Val::str("") }, NAME_MAX);
        let shown = match item(raw, 1) {
            Val::Str(text) if listed => clean(&Val::Str(text), NAME_MAX),
            _ => String::new(),
        };
        if region_id.is_empty() || shown.is_empty() || known.contains(&region_id) {
            continue;
        }
        known.push(region_id.clone());
        kept.push(Val::Arr(vec![Val::Str(region_id), Val::Str(shown)]));
        if kept.len() as f64 >= MAX_CONTESTED_REGIONS {
            break;
        }
    }
    Val::Arr(kept)
}

fn normalize_log(value: &Val) -> Val {
    let mut kept = Vec::new();
    for raw in value.array_or_empty() {
        if !is_record(raw) {
            continue;
        }
        let at = clean(raw.get("at"), LOG_TEXT_MAX as usize);
        let k = js::lower(&clean(raw.get("k"), 24));
        if at.is_empty() || k.is_empty() {
            continue;
        }
        let mut entry = Obj::new();
        entry.set("d", Val::Str(clean(raw.get("d"), DATE_MAX)));
        entry.set("k", Val::Str(k));
        entry.set("at", Val::Str(at));
        if side_index(raw.get("s")).is_some() {
            entry.set("s", raw.get("s").clone());
        }
        kept.push(Val::Obj(entry));
    }
    let from = kept.len().saturating_sub(MAX_LOG_ENTRIES as usize);
    Val::Arr(kept.split_off(from))
}

pub fn frame_record(frame: &Frame) -> Val {
    let mut out = Obj::new();
    for (key, value) in [("lng0", frame.lng0), ("lat0", frame.lat0), ("cell", frame.cell), ("cols", frame.cols), ("rows", frame.rows), ("km", frame.km)] {
        out.set(key, Val::Num(value));
    }
    if frame.flat {
        out.set("flat", Val::Bool(true));
        out.set("scale", Val::Num(frame.scale));
    } else {
        if let Some(proj) = &frame.proj {
            out.set("proj", Val::str(proj));
        }
        if let Some(factor) = frame.factor {
            out.set("factor", Val::Num(factor));
        }
    }
    Val::Obj(out)
}

pub fn chronicle_record(chronicle: &Chronicle) -> Val {
    let moments = chronicle
        .moments
        .iter()
        .map(|told| {
            let mut out = Obj::new();
            out.set("d", Val::str(&told.d));
            out.set("k", Val::str(&told.k));
            if let Some(side) = told.s {
                out.set("s", Val::Num(side));
            }
            out.set("at", Val::str(&told.at));
            if let Some(size) = told.size {
                out.set("size", Val::Num(size));
            }
            if told.capital {
                out.set("capital", Val::Bool(true));
            }
            Val::Obj(out)
        })
        .collect();
    let strength = chronicle.strength.iter().map(|p| Val::Arr(vec![Val::str(&p.date), Val::Num(p.troops[0]), Val::Num(p.troops[1]), Val::Num(p.strength[0]), Val::Num(p.strength[1])])).collect();
    Val::obj([("moments", Val::Arr(moments)), ("strength", Val::Arr(strength))])
}

pub fn normalize_battlefield(raw: &Val) -> Option<Val> {
    if !is_record(raw) {
        return None;
    }
    let name = clean(raw.get("name"), BATTLEFIELD_NAME_MAX as usize);
    let sides = [member_list(&item(raw.get("sides"), 0)), member_list(&item(raw.get("sides"), 1))];
    let frame = normalize_frame(raw.get("frame"));
    let frame = match frame {
        Some(frame) if !name.is_empty() && !sides[0].is_empty() && !sides[1].is_empty() => frame,
        _ => return None,
    };
    let status = match raw.get("status") {
        Val::Str(status) if BATTLEFIELD_STATUSES.contains(&status.as_str()) => status.clone(),
        _ => "active".to_string(),
    };
    let mut record = Obj::new();
    record.set("v", Val::Num(BATTLEFIELD_VERSION));
    record.set("name", Val::Str(name));
    record.set("warId", Val::Str(clean(raw.get("warId"), NAME_MAX)));
    record.set("status", Val::Str(status.clone()));
    record.set("sides", Val::Arr(vec![names_val(&sides[0]), names_val(&sides[1])]));
    record.set("openedDate", Val::Str(clean(raw.get("openedDate"), DATE_MAX)));
    record.set("asOf", Val::Str(clean(raw.get("asOf"), DATE_MAX)));
    record.set("frame", frame_record(&frame));
    record.set("troops", pair_of(raw.get("troops"), troop_text));
    record.set("named", normalize_named(raw.get("named")));
    record.set("pool", pair_of(raw.get("pool"), amount(0.0)));
    record.set("base", pair_of(raw.get("base"), amount(0.0)));
    record.set("quality", pair_of(raw.get("quality"), amount(1.0)));
    record.set("effort", pair_of(raw.get("effort"), |value| match value {
        Val::Str(effort) if FRONT_EFFORTS.contains(&effort.as_str()) => value.clone(),
        _ => Val::str(DEFAULT_EFFORT),
    }));
    if let Val::Arr(mind) = raw.get("mind") {
        let side = |at: usize| match mind.get(at) {
            Some(Val::Arr(values)) => Val::Arr(values.iter().take(64).map(|value| { let number = js::to_number(value); Val::Num(if number.is_finite() { number } else { 0.0 }) }).collect()),
            _ => Val::Arr(Vec::new()),
        };
        record.set("mind", Val::Arr(vec![side(0), side(1)]));
    }
    record.set("orders", normalize_orders(raw.get("orders")));
    record.set("replay", normalize_replay(raw.get("replay")).unwrap_or(Val::Null));
    record.set("held", Val::Str(packed(raw.get("held"))));
    record.set("contested", normalize_contested(raw.get("contested")));
    record.set("brief", if is_record(raw.get("brief")) { raw.get("brief").clone() } else { Val::Obj(Obj::new()) });
    record.set("log", normalize_log(raw.get("log")));
    if let Some(chronicle) = read_chronicle(raw.get("chronicle")) {
        record.set("chronicle", chronicle_record(&chronicle));
    }
    if raw.get("home").is_true() {
        record.set("home", Val::Bool(true));
    }
    if status == "closed" {
        record.set("closedDate", Val::Str(clean(raw.get("closedDate"), DATE_MAX)));
    } else if is_record(raw.get("field")) {
        let field = raw.get("field");
        record.set("field", Val::obj([("mask", Val::Str(packed(field.get("mask")))), ("band", Val::Str(packed(field.get("band")))), ("key", Val::Str(clean(field.get("key"), 40)))]));
    }
    Some(Val::Obj(record))
}

pub fn normalize_battlefields(value: &Val) -> Vec<Val> {
    let list = match value {
        Val::Arr(list) => list,
        _ => return Vec::new(),
    };
    let mut seen: Vec<String> = Vec::new();
    let mut open: Vec<Val> = Vec::new();
    let mut closed: Vec<Val> = Vec::new();
    for raw in list {
        let record = match normalize_battlefield(raw) {
            Some(record) => record,
            None => continue,
        };
        let key = fold_battlefield_name(record.get("name"));
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        if matches!(record.get("status"), Val::Str(status) if status == "closed") {
            closed.push(record);
        } else {
            open.push(record);
        }
    }
    let is_home = |record: &Val| record.get("home").is_true();
    let homes: Vec<Val> = open.iter().filter(|record| is_home(record)).take(MAX_HOME_FORCES as usize).cloned().collect();
    let mut list: Vec<Val> = open.into_iter().filter(|record| !is_home(record)).take(MAX_BATTLEFIELDS as usize).collect();
    list.extend(homes);
    let from = closed.len().saturating_sub(MAX_CLOSED_BATTLEFIELDS as usize);
    list.extend(closed.split_off(from));
    list
}

fn war_id_shape(text: &str) -> bool {
    let rest = match text.strip_prefix("war-") {
        Some(rest) => rest,
        None => return false,
    };
    !rest.is_empty() && rest.split('-').all(|part| !part.is_empty() && part.chars().all(letter_or_number))
}

pub fn is_war_id_name(name: &Val, war_ids: &[Val]) -> bool {
    let folded = fold_battlefield_name(name);
    if folded.is_empty() {
        return false;
    }
    war_id_shape(&folded) || war_ids.iter().any(|id| fold_battlefield_name(id) == folded)
}

fn ids_of(value: &Val) -> Vec<Val> {
    match value {
        Val::Arr(list) | Val::Set(list) => list.clone(),
        Val::Str(text) => text.chars().map(|unit| Val::Str(unit.to_string())).collect(),
        Val::Undef => Vec::new(),
        _ => Vec::new(),
    }
}

pub fn is_war_id_name_of(name: &Val, war_ids: &Val) -> bool {
    is_war_id_name(name, &ids_of(war_ids))
}

pub fn plain_front_name(sides: &Val) -> String {
    clean(&Val::Str(format!("{} - {} front", js::to_string(&item(&item(sides, 0), 0)), js::to_string(&item(&item(sides, 1), 0)))), BATTLEFIELD_NAME_MAX as usize)
}

fn named_war_id(raw: &Val) -> bool {
    is_record(raw) && is_war_id_name(raw.get("name"), &[raw.get("warId").clone()])
}

pub fn with_war_id_fronts_renamed(world: &Val) -> Val {
    let list = match world.get("battlefields") {
        Val::Arr(list) => list,
        _ => return world.clone(),
    };
    if !list.iter().any(named_war_id) {
        return world.clone();
    }
    let mut taken: Vec<String> = list.iter().filter(|raw| is_record(raw)).map(|raw| fold_battlefield_name(raw.get("name"))).collect();
    let mut renamed: Vec<(String, String)> = Vec::new();
    let battlefields: Vec<Val> = list
        .iter()
        .map(|raw| {
            if !named_war_id(raw) {
                return raw.clone();
            }
            let sides = [member_list(&item(raw.get("sides"), 0)), member_list(&item(raw.get("sides"), 1))];
            if sides[0].is_empty() || sides[1].is_empty() {
                return raw.clone();
            }
            let plain = plain_front_name(&Val::Arr(vec![names_val(&sides[0]), names_val(&sides[1])]));
            let mut name = plain.clone();
            let mut count = 2.0;
            while taken.contains(&fold_battlefield_name(&Val::str(&name))) {
                name = clean(&Val::Str(format!("{plain} {}", js::number_to_string(count))), BATTLEFIELD_NAME_MAX as usize);
                count += 1.0;
            }
            taken.push(fold_battlefield_name(&Val::str(&name)));
            let key = fold_battlefield_name(raw.get("name"));
            if !renamed.iter().any(|(known, _)| *known == key) {
                renamed.push((key, name.clone()));
            }
            let mut out = js::spread(raw);
            out.set("name", Val::Str(name));
            Val::Obj(out)
        })
        .collect();
    let renamed_to = |value: &Val| renamed.iter().find(|(key, _)| *key == fold_battlefield_name(value)).map(|(_, name)| name.clone());
    let follow = |value: &Val| match value {
        Val::Str(_) => renamed_to(value).map(Val::Str).unwrap_or_else(|| value.clone()),
        _ => value.clone(),
    };
    let mut next = js::spread(world);
    next.set("battlefields", Val::Arr(battlefields));
    if let Val::Arr(units) = world.get("units") {
        next.set(
            "units",
            Val::Arr(
                units
                    .iter()
                    .map(|unit| {
                        if is_record(unit) && renamed_to(unit.get("committedTo")).is_some() {
                            let mut out = js::spread(unit);
                            out.set("committedTo", follow(unit.get("committedTo")));
                            Val::Obj(out)
                        } else {
                            unit.clone()
                        }
                    })
                    .collect(),
            ),
        );
    }
    if let Val::Arr(rows) = world.get("transports") {
        next.set(
            "transports",
            Val::Arr(
                rows.iter()
                    .map(|row| {
                        if !is_record(row) {
                            return row.clone();
                        }
                        let mut out = js::spread(row);
                        if let Val::Str(_) = row.get("battlefield") {
                            out.set("battlefield", follow(row.get("battlefield")));
                        }
                        if is_record(row.get("embark")) {
                            let mut embark = js::spread(row.get("embark"));
                            embark.set("battlefield", follow(row.get("embark").get("battlefield")));
                            out.set("embark", Val::Obj(embark));
                        }
                        Val::Obj(out)
                    })
                    .collect(),
            ),
        );
    }
    Val::Obj(next)
}

pub fn find_battlefield(battlefields: &Val, name: &Val) -> Option<Val> {
    let wanted = fold_battlefield_name(name);
    if wanted.is_empty() {
        return None;
    }
    normalize_battlefields(battlefields).into_iter().find(|battlefield| fold_battlefield_name(battlefield.get("name")) == wanted)
}

pub fn battlefield_side_of(battlefield: &Val, name: &Val) -> f64 {
    let wanted = fold_name(name);
    if wanted.is_empty() || !battlefield.truthy() {
        return -1.0;
    }
    battlefield.get("sides").array_or_empty().iter().position(|members| members.array_or_empty().iter().any(|member| fold_name(member) == wanted)).map(|at| at as f64).unwrap_or(-1.0)
}

pub fn is_open_battlefield(battlefield: &Val) -> bool {
    matches!(battlefield.get("status"), Val::Str(status) if status == "active" || status == "frozen")
}

pub struct FrontView {
    pub name: Val,
    pub war_id: Val,
    pub status: Val,
    pub sides: Val,
    pub frame: Val,
    pub named: Val,
    pub troops: [Vec<Code>; 2],
    pub commands: [Val; 2],
    pub replay: Option<Read>,
    pub window: Option<(Val, Val)>,
}

pub fn front_view_of(battlefield: &Val) -> Option<FrontView> {
    if !battlefield.truthy() {
        return None;
    }
    let troops = battlefield.get("troops");
    let command = battlefield.get("brief").get("carry").get("command");
    Some(FrontView {
        name: battlefield.get("name").clone(),
        war_id: battlefield.get("warId").clone(),
        status: battlefield.get("status").clone(),
        sides: battlefield.get("sides").clone(),
        frame: battlefield.get("frame").clone(),
        named: battlefield.get("named").clone(),
        troops: [decode_troops(&item(troops, 0).string_or_empty()), decode_troops(&item(troops, 1).string_or_empty())],
        commands: [0, 1].map(|side| match item(command, side) {
            Val::Arr(list) => Val::Arr(list),
            _ => Val::Arr(Vec::new()),
        }),
        replay: replay_of(battlefield),
        window: replay_window_of(battlefield),
    })
}

fn at_day(battlefield: &Val, from: f64, until: f64) -> Option<Val> {
    let replay = battlefield.get("replay");
    if !replay.truthy() {
        return Some(battlefield.clone());
    }
    let start = js::to_number(replay.get("s"));
    if until < start {
        return None;
    }
    let mut then = js::spread(battlefield);
    then.set("replay", replay_between(replay, jsmath::max(from, start), until));
    then.set("held", Val::str(""));
    then.set("contested", Val::Arr(Vec::new()));
    if matches!(battlefield.get("status"), Val::Str(status) if status == "closed") && until < js::to_number(replay.get("e")) {
        then.set("status", Val::str("active"));
        then.remove("closedDate");
    }
    Some(Val::Obj(then))
}

pub fn battlefields_at_day(battlefields: &Val, until: &Val, from: &Val) -> Vec<Val> {
    let list = normalize_battlefields(battlefields);
    if !js::is_finite(until) {
        return list;
    }
    let until = until.num();
    let from = if from.is_undef() { until } else if js::is_finite(from) { from.num() } else { until };
    list.iter().filter_map(|battlefield| at_day(battlefield, from, until)).collect()
}

pub fn battlefields_as_seen(battlefields: &Val, date: &Val, from_date: &Val) -> Vec<Val> {
    let list = normalize_battlefields(battlefields);
    if date.is_nullish() || matches!(date, Val::Str(text) if text.is_empty()) {
        return list;
    }
    let from_date = if from_date.is_undef() { date } else { from_date };
    let mut seen = Vec::new();
    for battlefield in &list {
        let day = replay_day_on(battlefield.get("replay"), date);
        let then = match day {
            None => Some(battlefield.clone()),
            Some(day) => {
                let since = replay_day_on(battlefield.get("replay"), from_date);
                at_day(battlefield, since.map(|since| jsmath::min(since, day)).unwrap_or(day), day)
            }
        };
        if let Some(then) = then {
            seen.push(then);
        }
    }
    seen
}

pub fn frame_from(value: &Val) -> Frame {
    let n = |key: &str| value.get(key).num();
    Frame {
        lng0: n("lng0"),
        lat0: n("lat0"),
        cell: n("cell"),
        cols: n("cols"),
        rows: n("rows"),
        km: n("km"),
        flat: value.get("flat").truthy(),
        scale: if value.get("scale").is_undef() { 0.0 } else { n("scale") },
        proj: match value.get("proj") {
            Val::Str(proj) if !proj.is_empty() => Some(proj.clone()),
            _ => None,
        },
        factor: match value.get("factor") {
            Val::Undef => None,
            other => Some(super::js::to_number(other)),
        },
    }
}

pub fn holder_at(battlefield: &Val, lng: f64, lat: f64) -> Val {
    let frame = battlefield.get("frame");
    let mask = battlefield.get("field").get("mask");
    if !frame.truthy() || !mask.truthy() {
        return Val::Num(HOLDER_WALL);
    }
    let frame = frame_from(frame);
    let [x, y] = Projector::of(&frame).to_cell(lng, lat);
    let index = cell_index_at(&frame, x, y);
    if index < 0.0 {
        return Val::Num(HOLDER_WALL);
    }
    let cells = decode_mask(&mask.string_or_empty(), frame.cols * frame.rows);
    cells.get(index as usize).map(|&holder| Val::Num(holder as f64)).unwrap_or(Val::Undef)
}

pub struct Holders {
    frame: Option<Frame>,
    place: Option<Projector>,
    cells: Vec<u8>,
}

impl Holders {
    pub fn of(battlefield: &Val) -> Holders {
        let frame = battlefield.get("frame");
        let mask = battlefield.get("field").get("mask");
        if !frame.truthy() || !mask.truthy() {
            return Holders { frame: None, place: None, cells: Vec::new() };
        }
        let frame = frame_from(frame);
        let cells = decode_mask(&mask.string_or_empty(), frame.cols * frame.rows);
        Holders { place: Some(Projector::of(&frame)), frame: Some(frame), cells }
    }

    pub fn at(&self, lng: f64, lat: f64) -> Val {
        let (frame, place) = match (&self.frame, &self.place) {
            (Some(frame), Some(place)) => (frame, place),
            _ => return Val::Num(HOLDER_WALL),
        };
        let [x, y] = place.to_cell(lng, lat);
        let index = cell_index_at(frame, x, y);
        if index < 0.0 {
            return Val::Num(HOLDER_WALL);
        }
        self.cells.get(index as usize).map(|&holder| Val::Num(holder as f64)).unwrap_or(Val::Undef)
    }
}
