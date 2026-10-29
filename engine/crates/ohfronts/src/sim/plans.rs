use super::accents::{is_letter, strip_accents};
use super::codec::{decode_troops, Troop as Coded};
use super::command::{chosen_orders_of, generals_of, order_troops, release_marked, route_ahead, thin_route, OrderAsk};
use super::constants::*;
use super::frame::{point_in_frame, Projector};
use super::js::{self, Obj, Val};
use super::record::{frame_from, holder_at};
use super::troops::or_else;
use crate::jsmath;
use std::cmp::Ordering;

pub const ATTACK_WORDS: [&str; 5] = ["advance", "blitz", "spearhead", "flank", "encircle"];
pub const PROJECT_MARK: &str = "plan:";
pub const WATCH_MARK: &str = "watch";
const OPEN_STATUSES: [&str; 4] = ["proposed", "active", "stalled", "paused"];
const FAR_FROM_TRUTH_KM: f64 = 150.0;
const NEAR_TRUTH_KM: f64 = 40.0;
const WORDS: [(&str, &str); 9] = [
    ("advance", "an advance"),
    ("blitz", "a fast attack after massing"),
    ("spearhead", "a spearhead"),
    ("flank", "a move round the flank"),
    ("encircle", "an encirclement"),
    ("hold", "holding its line"),
    ("dig in", "digging in"),
    ("fall back", "falling back"),
    ("withdraw", "withdrawing from the battlefield"),
];

fn num(value: f64) -> Val {
    Val::Num(value)
}

fn text(value: &str) -> Val {
    Val::Str(value.to_string())
}

fn clean_of(value: &Val, most: usize) -> String {
    let collapsed = js::trim(&js::collapse_spaces(&value.string_or_empty())).to_string();
    js::trim(&js::slice_units(&collapsed, 0, most)).to_string()
}

fn clean(value: &Val) -> String {
    clean_of(value, 200)
}

fn fold(value: &Val) -> String {
    clean(value).to_lowercase()
}

fn plain(value: &Val) -> String {
    strip_accents(&clean_of(value, 4000)).to_lowercase()
}

fn side_of(side: &Val) -> Option<usize> {
    js::side_index(side)
}

fn is_attack(word: &Val) -> bool {
    matches!(word, Val::Str(word) if ATTACK_WORDS.contains(&word.as_str()))
}

fn carry_of(record: &Val) -> Val {
    let carry = record.get("brief").get("carry");
    if record.get("brief").truthy() && carry.is_object() {
        carry.clone()
    } else {
        Val::Obj(Obj::new())
    }
}

fn starts_with(value: &Val, prefix: &str) -> bool {
    matches!(value, Val::Str(text) if text.starts_with(prefix))
}

fn after_mark(value: &Val) -> String {
    js::slice_units(&value.string_or_empty(), PROJECT_MARK.len(), usize::MAX)
}

pub fn same_val(a: &Val, b: &Val) -> bool {
    match (a, b) {
        (Val::Num(x), Val::Num(y)) => x.to_bits() == y.to_bits() || (x.is_nan() && y.is_nan()),
        (Val::Arr(x), Val::Arr(y)) | (Val::Set(x), Val::Set(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same_val(p, q)),
        (Val::Obj(x), Val::Obj(y)) => x.0.len() == y.0.len() && x.0.iter().zip(&y.0).all(|((ka, va), (kb, vb))| ka == kb && same_val(va, vb)),
        (Val::Map(x), Val::Map(y)) => x.len() == y.len() && x.iter().zip(y).all(|((ka, va), (kb, vb))| same_val(ka, kb) && same_val(va, vb)),
        _ => a == b,
    }
}

fn collate_rank(unit: char) -> (u32, u32) {
    const ORDER: &str = "\t\n\u{b}\u{c}\r _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789abcdefghijklmnopqrstuvwxyz";
    let lower = unit.to_ascii_lowercase();
    match ORDER.chars().position(|entry| entry == lower) {
        Some(at) => (at as u32, if unit.is_ascii_uppercase() { 1 } else { 0 }),
        None => (1000 + unit as u32, 0),
    }
}

pub fn locale_compare(a: &str, b: &str) -> f64 {
    let base = |text: &str| strip_accents(text).chars().map(collate_rank).collect::<Vec<_>>();
    let (left, right) = (base(a), base(b));
    let primary = left.iter().map(|rank| rank.0).cmp(right.iter().map(|rank| rank.0));
    let order = if primary != Ordering::Equal {
        primary
    } else {
        let accents = (strip_accents(a) != a).cmp(&(strip_accents(b) != b));
        if accents != Ordering::Equal {
            accents
        } else {
            left.iter().map(|rank| rank.1).cmp(right.iter().map(|rank| rank.1))
        }
    };
    match order {
        Ordering::Less => -1.0,
        Ordering::Greater => 1.0,
        Ordering::Equal => 0.0,
    }
}

fn read_way(value: &Val) -> Vec<[f64; 2]> {
    let mut way = Vec::new();
    for point in value.array_or_empty() {
        let arr = point.as_array().is_some();
        let lng = if arr { js::to_number(&point.element(0)) } else { f64::NAN };
        let lat = if arr { js::to_number(&point.element(1)) } else { f64::NAN };
        if !lng.is_finite() || !lat.is_finite() || lat.abs() > 90.0 {
            continue;
        }
        way.push([jsmath::round(lng * 10000.0) / 10000.0, jsmath::round(lat * 10000.0) / 10000.0]);
    }
    if way.len() as f64 > MAX_WAY_POINTS {
        thin_route(&way, MAX_WAY_POINTS as usize)
    } else {
        way
    }
}

fn way_val(way: &[[f64; 2]]) -> Val {
    Val::Arr(way.iter().map(|point| Val::nums(point)).collect())
}

pub fn read_plans(value: &Val) -> [Vec<Val>; 2] {
    [0, 1].map(|side| {
        let mut kept: Vec<Val> = Vec::new();
        let mut seen: Vec<String> = Vec::new();
        let list = if value.as_array().is_some() { value.at(side).array_or_empty() } else { &[] };
        for raw in list {
            if !raw.truthy() || !raw.is_object() {
                continue;
            }
            let way = read_way(raw.get("way"));
            let at = clean_of(raw.get("at"), 40);
            if matches!(raw.get("kind"), Val::Str(kind) if kind == "diversion") {
                let id = clean_of(raw.get("id"), 24);
                if id.is_empty() || seen.contains(&id) || way.len() < 2 {
                    continue;
                }
                seen.push(id.clone());
                let read = js::or_zero(js::to_number(raw.get("troops")));
                let rounded = js::or_zero(jsmath::round(read));
                let troops = jsmath::max(1.0, jsmath::min(MAX_TROOPS_PER_SIDE, if rounded == 0.0 { 1.0 } else { rounded }));
                kept.push(Val::obj([("id", text(&id)), ("kind", text("diversion")), ("way", way_val(&way)), ("troops", num(troops)), ("at", text(&at))]));
            } else if matches!(raw.get("kind"), Val::Str(kind) if kind == "project") {
                let project = clean_of(raw.get("project"), 160);
                let id = format!("project:{project}");
                if project.is_empty() || seen.contains(&id) {
                    continue;
                }
                seen.push(id.clone());
                let mut entry = Obj::new();
                entry.set("id", text(&id));
                entry.set("kind", text("project"));
                entry.set("project", text(&project));
                entry.set("at", text(&at));
                if way.len() >= 2 {
                    entry.set("way", way_val(&way));
                }
                if raw.get("off").is_true() {
                    entry.set("off", Val::Bool(true));
                }
                if raw.get("sent").is_true() {
                    entry.set("sent", Val::Bool(true));
                }
                if entry.has("way") || entry.has("off") || entry.has("sent") {
                    kept.push(Val::Obj(entry));
                }
            }
            if kept.len() as f64 >= MAX_PLANS_PER_SIDE {
                break;
            }
        }
        kept
    })
}

pub fn read_plans_val(value: &Val) -> Val {
    let [a, b] = read_plans(value);
    Val::Arr(vec![Val::Arr(a), Val::Arr(b)])
}

pub fn kept_plans_of(record: &Val, side: &Val) -> Vec<Val> {
    match side_of(side) {
        Some(side) => read_plans(carry_of(record).get("plans"))[side].clone(),
        None => Vec::new(),
    }
}

fn with_kept(record: &Val, side: usize, list: Vec<Val>) -> Val {
    let carry = carry_of(record);
    let mut plans = read_plans(carry.get("plans"));
    let given = if side == 0 { Val::Arr(vec![Val::Arr(list), Val::Arr(Vec::new())]) } else { Val::Arr(vec![Val::Arr(Vec::new()), Val::Arr(list)]) };
    plans[side] = read_plans(&given)[side].clone();
    let mut carried = js::spread(&carry);
    carried.set("plans", Val::Arr(plans.into_iter().map(Val::Arr).collect()));
    let mut brief = js::spread(record.get("brief"));
    brief.set("carry", Val::Obj(carried));
    let mut out = js::spread(record);
    out.set("brief", Val::Obj(brief));
    Val::Obj(out)
}

fn has_id(plan: &Val, id: &str) -> bool {
    matches!(plan.get("id"), Val::Str(own) if own == id)
}

pub fn with_diversion(record: &Val, side: &Val, way: &Val, troops: &Val, at: &Val) -> Val {
    let Some(at_side) = side_of(side).filter(|_| record.truthy()) else { return record.clone() };
    let route = read_way(way);
    if route.len() < 2 {
        return record.clone();
    }
    let mut kept = kept_plans_of(record, side);
    if kept.len() as f64 >= MAX_PLANS_PER_SIDE {
        return record.clone();
    }
    let mut serial = 1;
    while kept.iter().any(|plan| has_id(plan, &format!("d{serial}"))) {
        serial += 1;
    }
    let given = if troops.is_undef() { 0.0 } else { js::or_zero(js::to_number(troops)) };
    let rounded = js::or_zero(jsmath::round(given));
    let spearhead = THRUST_TROOPS.iter().find(|(name, _)| *name == "spearhead").unwrap().1;
    let count = if rounded == 0.0 { spearhead } else { rounded };
    let at = if at.is_undef() { String::new() } else { clean_of(at, 40) };
    kept.push(Val::obj([("id", Val::Str(format!("d{serial}"))), ("kind", text("diversion")), ("way", way_val(&route)), ("troops", num(count)), ("at", text(&at))]));
    with_kept(record, at_side, kept)
}

pub fn with_project_plan(record: &Val, side: &Val, project: &Val, way: &Val, off: &Val, sent: &Val, at: &Val) -> Val {
    let wanted = clean_of(project, 160);
    let Some(at_side) = side_of(side).filter(|_| record.truthy() && !wanted.is_empty()) else { return record.clone() };
    let kept = kept_plans_of(record, side);
    let id = format!("project:{wanted}");
    let before = kept.iter().find(|plan| has_id(plan, &id)).cloned().unwrap_or_else(|| Val::obj([("id", text(&id)), ("kind", text("project")), ("project", text(&wanted))]));
    let mut entry = js::spread(&before);
    let at = if at.is_undef() { String::new() } else { clean_of(at, 40) };
    let at = if !at.is_empty() { text(&at) } else if before.get("at").truthy() { before.get("at").clone() } else { text("") };
    entry.set("at", at);
    if way.as_array().is_some() {
        let route = read_way(way);
        if route.len() >= 2 {
            entry.set("way", way_val(&route));
        } else {
            entry.remove("way");
        }
        entry.remove("sent");
    }
    if off.is_true() {
        entry.set("off", Val::Bool(true));
    }
    if matches!(off, Val::Bool(false)) {
        entry.remove("off");
    }
    if sent.is_true() {
        entry.set("sent", Val::Bool(true));
    }
    if matches!(sent, Val::Bool(false)) {
        entry.remove("sent");
    }
    let mut others: Vec<Val> = kept.iter().filter(|plan| !has_id(plan, &id)).cloned().collect();
    let entry_way = entry.get("way").map(|way| way.truthy()).unwrap_or(false);
    let entry_off = entry.get("off").map(|off| off.truthy()).unwrap_or(false);
    let entry_sent = entry.get("sent").map(|sent| sent.truthy()).unwrap_or(false);
    if !entry_way && !entry_off && !entry_sent {
        return with_kept(record, at_side, others);
    }
    if !kept.iter().any(|plan| has_id(plan, &id)) && others.len() as f64 >= MAX_PLANS_PER_SIDE {
        return record.clone();
    }
    others.push(Val::Obj(entry));
    with_kept(record, at_side, others)
}

pub fn without_plan(record: &Val, side: &Val, id: &Val) -> Val {
    let Some(at_side) = side_of(side).filter(|_| record.truthy()) else { return record.clone() };
    let kept = kept_plans_of(record, side);
    let wanted = clean_of(id, 180);
    let left: Vec<Val> = kept.iter().filter(|plan| !has_id(plan, &wanted)).cloned().collect();
    if left.len() == kept.len() {
        record.clone()
    } else {
        with_kept(record, at_side, left)
    }
}

fn troops_of(record: &Val) -> [Vec<Coded>; 2] {
    [0, 1].map(|side| decode_troops(&record.get("troops").at(side).string_or_empty()))
}

fn live(troop: &Coded) -> bool {
    troop.strength > 0.0
}

fn middle_of(list: &[Coded], indexes: &[usize]) -> Option<[f64; 2]> {
    let (mut x, mut y, mut count) = (0.0, 0.0, 0.0);
    for &index in indexes {
        let Some(troop) = list.get(index) else { continue };
        if !live(troop) {
            continue;
        }
        x += troop.x;
        y += troop.y;
        count += 1.0;
    }
    if count > 0.0 {
        Some([x / count, y / count])
    } else {
        None
    }
}

fn nearest_to(list: &[Coded], x: f64, y: f64, count: f64, skip: Option<&[usize]>) -> Vec<usize> {
    let mut found: Vec<(f64, usize)> = Vec::new();
    for (index, troop) in list.iter().enumerate() {
        if !live(troop) || skip.is_some_and(|skip| skip.contains(&index)) {
            continue;
        }
        let dx = troop.x - x;
        let dy = troop.y - y;
        found.push((dx * dx + dy * dy, index));
    }
    js::stable_sort_by(&mut found, |a, b| or_else(a.0 - b.0, || a.1 as f64 - b.1 as f64));
    found.iter().take(jsmath::max(0.0, count) as usize).map(|entry| entry.1).collect()
}

fn thrust_count(word: &Val, have: f64) -> f64 {
    let most = match word {
        Val::Str(word) => THRUST_TROOPS.iter().find(|(name, _)| name == word).map(|entry| entry.1),
        _ => None,
    }
    .unwrap_or_else(|| THRUST_TROOPS.iter().find(|(name, _)| *name == "advance").unwrap().1);
    jsmath::max(jsmath::min(have, THRUST_LEAST), jsmath::min(most, (have * THRUST_SHARE).floor()))
}

fn parse_place(value: &Val) -> (String, String) {
    let whole = clean(value);
    for kind in ["city", "region"] {
        if whole.len() < kind.len() || !whole.is_char_boundary(kind.len()) || !whole[..kind.len()].eq_ignore_ascii_case(kind) {
            continue;
        }
        let rest = whole[kind.len()..].trim_start_matches(js::is_js_whitespace);
        let Some(rest) = rest.strip_prefix(':') else { continue };
        let rest = rest.trim_start_matches(js::is_js_whitespace);
        if rest.is_empty() {
            continue;
        }
        return (kind.to_string(), clean(&text(rest)));
    }
    (String::new(), whole)
}

fn frame_of(record: &Val) -> super::frame::Frame {
    frame_from(record.get("frame"))
}

fn place_of(record: &Val) -> Projector {
    Projector::of(&frame_of(record))
}

fn in_frame(record: &Val, lng: f64, lat: f64) -> bool {
    point_in_frame(&frame_of(record), lng, lat)
}

fn held_by(record: &Val, lng: f64, lat: f64, side: usize) -> bool {
    js::strict_equals(&holder_at(record, lng, lat), &num(side as f64))
}

fn city_named(record: &Val, cities: &Val, value: &Val) -> Option<Val> {
    let (kind, name) = parse_place(value);
    if name.is_empty() || kind == "region" {
        return None;
    }
    let wanted = fold(&text(&name));
    cities.array_or_empty().iter().find(|city| fold(city.get("name")) == wanted && in_frame(record, js::to_number(city.get("lng")), js::to_number(city.get("lat")))).cloned()
}

fn city_near(record: &Val, cities: &Val, lng: f64, lat: f64, within_km: f64) -> Option<Val> {
    let place = place_of(record);
    let [x, y] = place.to_cell(lng, lat);
    let mut best = None;
    let mut best_km = within_km;
    for city in cities.array_or_empty() {
        let (clng, clat) = (js::to_number(city.get("lng")), js::to_number(city.get("lat")));
        if clean(city.get("name")).is_empty() || !in_frame(record, clng, clat) {
            continue;
        }
        let [cx, cy] = place.to_cell(clng, clat);
        let km = ((cx - x) * (cx - x) + (cy - y) * (cy - y)).sqrt() * place.km_at((cy + y) / 2.0);
        if km <= best_km {
            best_km = km;
            best = Some(city.clone());
        }
    }
    best
}

fn suggested_ways(record: &Val, word: &Val, from: [f64; 2], to: [f64; 2]) -> Vec<Vec<[f64; 2]>> {
    let place = place_of(record);
    let dx = to[0] - from[0];
    let dy = to[1] - from[1];
    let length = (dx * dx + dy * dy).sqrt();
    if !(length > 0.0) {
        return vec![vec![from, to]];
    }
    let ux = dx / length;
    let uy = dy / length;
    let off = PLAN_STANDOFF_KM / jsmath::max(1e-6, place.km_at(to[1]));
    let round = |sign: f64| {
        vec![
            from,
            [to[0] - ux * off * 0.6 - uy * sign * off, to[1] - uy * off * 0.6 + ux * sign * off],
            [to[0] + ux * off * 0.9 - uy * sign * off * 0.55, to[1] + uy * off * 0.9 + ux * sign * off * 0.55],
            [to[0] + ux * off, to[1] + uy * off],
        ]
    };
    let word = word.as_str().unwrap_or("");
    if word == "encircle" && length > off * 1.2 {
        return vec![round(1.0), round(-1.0)];
    }
    if word == "flank" && length > off * 1.2 {
        return vec![round(1.0)[..3].to_vec()];
    }
    vec![vec![from, to]]
}

fn lng_lat_ways(record: &Val, ways: &[Vec<[f64; 2]>]) -> Val {
    let place = place_of(record);
    Val::Arr(
        ways.iter()
            .map(|way| {
                Val::Arr(
                    way.iter()
                        .map(|&[x, y]| {
                            let [lng, lat] = place.to_lng_lat(x, y);
                            Val::nums(&[jsmath::round(lng * 10000.0) / 10000.0, jsmath::round(lat * 10000.0) / 10000.0])
                        })
                        .collect(),
                )
            })
            .collect(),
    )
}

fn facing(record: &Val, decoded: &[Vec<Coded>; 2], side: usize, from: [f64; 2]) -> Option<[f64; 2]> {
    let place = place_of(record);
    let near = nearest_to(&decoded[1 - side], from[0], from[1], 12.0, None);
    let to = middle_of(&decoded[1 - side], &near)?;
    let dx = to[0] - from[0];
    let dy = to[1] - from[1];
    let length = (dx * dx + dy * dy).sqrt();
    if !(length > 0.0) {
        return None;
    }
    let reach = PLAN_REACH_KM / jsmath::max(1e-6, place.km_at(from[1]));
    Some([from[0] + (dx / length) * reach, from[1] + (dy / length) * reach])
}

fn picked_val(picked: &[usize]) -> Val {
    Val::Arr(picked.iter().map(|&index| num(index as f64)).collect())
}

fn order_plans(record: &Val, side: usize, cities: &Val, decoded: &[Vec<Coded>; 2]) -> Vec<Obj> {
    let place = place_of(record);
    let carry = carry_of(record);
    let under = carry.get("under").at(side).array_or_empty().to_vec();
    let ages = carry.get("ages").array_or_empty().to_vec();
    let have = decoded[side].iter().filter(|troop| live(troop)).count() as f64;
    let mut plans = Vec::new();
    for (index, order) in record.get("orders").array_or_empty().iter().enumerate() {
        if !js::strict_equals(order.get("s"), &num(side as f64)) || matches!(order.get("mark"), Val::Str(mark) if mark == WATCH_MARK) {
            continue;
        }
        let mut picked: Vec<usize> = Vec::new();
        for (troop, serves) in under.iter().enumerate() {
            if js::strict_equals(serves, &num(index as f64)) && decoded[side].get(troop).is_some_and(live) {
                picked.push(troop);
            }
        }
        if order.get("chosen").truthy() && picked.is_empty() {
            continue;
        }
        let word = order.get("order").clone();
        let routed = order.get("way").as_array().is_some_and(|way| !way.is_empty());
        let objective = clean(order.get("objective"));
        let mut plan = Obj::new();
        plan.set("id", Val::Str(format!("order:{index}")));
        plan.set("kind", text(if routed { "route" } else { "order" }));
        plan.set("side", num(side as f64));
        plan.set("order", word.clone());
        plan.set("objective", text(&objective));
        plan.set("name", text(""));
        plan.set("by", text(&clean(order.get("by"))));
        plan.set("sector", text(&if order.get("chosen").truthy() { String::new() } else { clean(order.get("sector")) }));
        plan.set("chosen", Val::Bool(order.get("chosen").is_true()));
        plan.set("mark", text(&clean(order.get("mark"))));
        let begun = js::to_number(ages.get(index).unwrap_or(&Val::Undef)) > 0.0;
        plan.set("begun", Val::Bool(begun));
        plan.set("attacks", match order.get("attacks") {
            Val::Arr(names) => Val::Arr(names.iter().map(clean).filter(|name| !name.is_empty()).map(|name| text(&name)).collect()),
            _ => Val::Arr(Vec::new()),
        });
        plan.set("ways", Val::Arr(Vec::new()));
        if routed {
            let from = middle_of(&decoded[side], &picked);
            let route: Vec<[f64; 2]> = order.get("way").array_or_empty().iter().map(|point| place.to_cell(js::to_number(&point.element(0)), js::to_number(&point.element(1)))).collect();
            let mut left = route.clone();
            if begun {
                if let Some(from) = from {
                    let mut making: Vec<f64> = picked.iter().map(|&troop| js::to_number(carry.get("next").at(side).at(troop))).filter(|&point| point.is_finite() && point.trunc() == point && point >= 0.0).collect();
                    js::sort_numbers(&mut making);
                    left = if !making.is_empty() {
                        let start = jsmath::min(route.len() as f64 - 1.0, making[making.len() / 2]);
                        route[(start.max(0.0) as usize).min(route.len())..].to_vec()
                    } else {
                        route_ahead(&route, from[0], from[1])
                    };
                }
            }
            let way = match from {
                Some(from) => {
                    let mut way = vec![from];
                    way.extend(left);
                    way
                }
                None => left,
            };
            plan.set("ways", lng_lat_ways(record, &[way]));
        } else if is_attack(&word) {
            let city = if !objective.is_empty() { city_named(record, cities, &text(&objective)) } else { None };
            if let Some(city) = &city {
                if held_by(record, js::to_number(city.get("lng")), js::to_number(city.get("lat")), side) {
                    continue;
                }
                let to = place.to_cell(js::to_number(city.get("lng")), js::to_number(city.get("lat")));
                if picked.is_empty() {
                    picked = nearest_to(&decoded[side], to[0], to[1], thrust_count(&word, have), None);
                }
                if let Some(from) = middle_of(&decoded[side], &picked) {
                    plan.set("ways", lng_lat_ways(record, &suggested_ways(record, &word, from, to)));
                }
            } else if objective.is_empty() {
                let serving = picked.clone();
                let commands: Vec<Vec<usize>> = generals_of(record, &num(side as f64), &Val::Undef)
                    .iter()
                    .map(|general| if !picked.is_empty() { general.troops.iter().copied().filter(|troop| serving.contains(troop)).collect() } else { general.troops.clone() })
                    .filter(|body: &Vec<usize>| !body.is_empty())
                    .collect();
                let bodies = if order.get("chosen").truthy() || commands.is_empty() { vec![picked.clone()] } else { commands };
                let mut ways = Vec::new();
                for body in &bodies {
                    let from = middle_of(&decoded[side], body);
                    let to = from.and_then(|from| facing(record, decoded, side, from));
                    if let (Some(from), Some(to)) = (from, to) {
                        ways.push(vec![from, to]);
                    }
                }
                if picked.is_empty() {
                    picked = bodies.concat();
                }
                plan.set("ways", lng_lat_ways(record, &ways));
            }
        }
        plan.set("picked", picked_val(&picked));
        plan.set("troops", num(picked.len() as f64));
        plans.push(plan);
    }
    plans
}

fn is_word(unit: char) -> bool {
    unit.is_ascii_alphanumeric() || unit == '_'
}

fn starts_word(units: &[char], at: usize) -> bool {
    at == 0 || !is_word(units[at - 1])
}

fn ends_word(units: &[char], end: usize) -> bool {
    end >= units.len() || !is_word(units[end])
}

fn found_at(units: &[char], word: &str, whole: bool) -> bool {
    let wanted: Vec<char> = word.chars().collect();
    if wanted.len() > units.len() {
        return false;
    }
    (0..=units.len() - wanted.len()).any(|at| starts_word(units, at) && units[at..at + wanted.len()] == wanted[..] && (!whole || ends_word(units, at + wanted.len())))
}

fn order_hint(sentence: &str) -> &'static str {
    let units: Vec<char> = sentence.chars().collect();
    let any = |starts: &[&str], wholes: &[&str]| starts.iter().any(|word| found_at(&units, word, false)) || wholes.iter().any(|word| found_at(&units, word, true));
    if any(&["encircl", "surround", "besieg", "envelop", "pincer"], &["cut off", "cutting off"]) {
        return "encircle";
    }
    if any(&["flank", "outflank"], &[]) {
        return "flank";
    }
    if any(&["blitz"], &["lightning war", "lightning attack", "lightning offensive", "lightning advance"]) {
        return "blitz";
    }
    if any(&["spearhead", "breakthrough", "break through", "thrust"], &["armored thrust", "armoured thrust"]) {
        return "spearhead";
    }
    "advance"
}

fn letter_unit(unit: u16) -> bool {
    if (0xd800..=0xdfff).contains(&unit) {
        return false;
    }
    char::from_u32(unit as u32).is_some_and(is_letter)
}

fn named_in(sentence: &[u16], name: &[u16]) -> bool {
    if name.len() < 3 || name.len() > sentence.len() {
        return false;
    }
    let mut from = 0;
    while from + name.len() <= sentence.len() {
        let Some(found) = (from..=sentence.len() - name.len()).find(|&at| sentence[at..at + name.len()] == name[..]) else { return false };
        let before = if found > 0 { sentence[found - 1] } else { b' ' as u16 };
        let after = if found + name.len() < sentence.len() { sentence[found + name.len()] } else { b' ' as u16 };
        if !letter_unit(before) && !letter_unit(after) {
            return true;
        }
        from = found + 1;
    }
    false
}

fn template(value: &Val) -> String {
    if value.is_nullish() {
        String::new()
    } else {
        js::to_string(value)
    }
}

pub struct Context<'a> {
    pub projects: &'a Val,
    pub cities: &'a Val,
    pub player: &'a Val,
    pub people: &'a Val,
}

pub fn operations_on(record: &Val, side: &Val, context: &Context) -> Vec<Obj> {
    let Some(side) = side_of(side).filter(|_| record.truthy()) else { return Vec::new() };
    let members: Vec<String> = record.get("sides").at(side).array_or_empty().iter().map(fold).collect();
    let mut own: Vec<String> = vec![fold(context.player)];
    own.extend(context.people.array_or_empty().iter().map(fold));
    own.retain(|name| !name.is_empty());
    let mut held: Vec<(Val, String)> = Vec::new();
    for city in context.cities.array_or_empty() {
        let name = clean(city.get("name"));
        let (lng, lat) = (js::to_number(city.get("lng")), js::to_number(city.get("lat")));
        if name.is_empty() || !in_frame(record, lng, lat) || !held_by(record, lng, lat, 1 - side) {
            continue;
        }
        held.push((city.clone(), plain(&text(&name))));
    }
    js::stable_sort_by(&mut held, |a, b| or_else(js::utf16_len(&b.1) as f64 - js::utf16_len(&a.1) as f64, || locale_compare(&a.1, &b.1)));
    let player = clean(context.player);
    let mut found = Vec::new();
    for entry in context.projects.array_or_empty() {
        if !entry.truthy() || !matches!(entry.get("kind"), Val::Str(kind) if kind == "operation") || !matches!(entry.get("status"), Val::Str(status) if OPEN_STATUSES.contains(&status.as_str())) {
            continue;
        }
        if entry.get("linkedSpyIds").as_array().is_some_and(|ids| !ids.is_empty()) {
            continue;
        }
        let owner = {
            let code = clean(entry.get("ownerCode"));
            if code.is_empty() { player.clone() } else { code }
        };
        if owner.is_empty() || !members.contains(&fold(&text(&owner))) {
            continue;
        }
        let mut place: Option<Val> = None;
        let focus = entry.get("focus");
        let lng = js::to_number(focus.get("lng"));
        let lat = js::to_number(focus.get("lat"));
        if focus.truthy() && lng.is_finite() && lat.is_finite() && in_frame(record, lng, lat) && held_by(record, lng, lat, 1 - side) {
            let near = city_near(record, context.cities, lng, lat, PLAN_PLACE_KM);
            place = Some(match near {
                Some(near) if held_by(record, js::to_number(near.get("lng")), js::to_number(near.get("lat")), 1 - side) => {
                    Val::obj([("name", text(&clean(near.get("name")))), ("lng", num(js::to_number(near.get("lng")))), ("lat", num(js::to_number(near.get("lat"))))])
                }
                _ => Val::obj([("name", text("")), ("lng", num(lng)), ("lat", num(lat))]),
            });
        }
        let sentence = plain(&Val::Str(format!("{}. {}. {}", template(entry.get("name")), template(entry.get("summary")), template(entry.get("nextMilestone").get("title")))));
        if place.is_none() {
            let units: Vec<u16> = sentence.encode_utf16().collect();
            if let Some((city, _)) = held.iter().find(|(_, key)| named_in(&units, &key.encode_utf16().collect::<Vec<u16>>())) {
                place = Some(Val::obj([("name", text(&clean(city.get("name")))), ("lng", num(js::to_number(city.get("lng")))), ("lat", num(js::to_number(city.get("lat"))))]));
            }
        }
        let Some(place) = place else { continue };
        let secrecy = clean_of(entry.get("secrecy"), 20);
        let mut operation = Obj::new();
        operation.set("project", text(&clean_of(entry.get("id"), 160)));
        operation.set("name", text(&clean_of(entry.get("name"), 160)));
        operation.set("by", text(&owner));
        operation.set("own", Val::Bool(own.contains(&fold(&text(&owner)))));
        operation.set("status", entry.get("status").clone());
        operation.set("due", text(&if entry.get("ongoing").truthy() { String::new() } else { clean_of(entry.get("targetDate"), 40) }));
        operation.set("order", text(order_hint(&sentence)));
        operation.set("place", place);
        operation.set("doubted", Val::Bool(matches!(entry.get("verification"), Val::Str(word) if word == "doubted")));
        operation.set("secrecy", text(if secrecy.is_empty() { "restricted" } else { &secrecy }));
        found.push(operation);
    }
    found.into_iter().filter(|operation| operation.get("project").map(|project| project.truthy()).unwrap_or(false)).collect()
}

fn project_plans(record: &Val, side: usize, context: &Context, decoded: &[Vec<Coded>; 2]) -> Vec<Obj> {
    let place = place_of(record);
    let side_val = num(side as f64);
    let kept = kept_plans_of(record, &side_val);
    let have = decoded[side].iter().filter(|troop| live(troop)).count() as f64;
    let standing = chosen_orders_of(record, &side_val);
    operations_on(record, &side_val, context)
        .into_iter()
        .map(|operation| {
            let project = operation.get("project").cloned().unwrap_or(Val::Undef);
            let mine = kept.iter().find(|plan| matches!(plan.get("kind"), Val::Str(kind) if kind == "project") && js::strict_equals(plan.get("project"), &project)).cloned();
            let mark = format!("{PROJECT_MARK}{}", project.string_or_empty());
            let busy: Vec<usize> = standing.iter().filter(|order| !matches!(&order.mark, Val::Str(own) if *own == mark)).flat_map(|order| order.troops.clone()).collect();
            let at = operation.get("place").cloned().unwrap_or(Val::Undef);
            let to = place.to_cell(at.get("lng").num(), at.get("lat").num());
            let word = operation.get("order").cloned().unwrap_or(Val::Undef);
            let named = at.get("name").string_or_empty();
            let mine_way = mine.as_ref().map(|plan| plan.get("way").clone()).unwrap_or(Val::Undef);
            let off = mine.as_ref().is_some_and(|plan| plan.get("off").is_true());
            let sent = mine.as_ref().is_some_and(|plan| plan.get("sent").is_true());
            let status = operation.get("status").cloned().unwrap_or(Val::Undef);
            let own = operation.get("own").cloned().unwrap_or(Val::Undef);
            let mut plan = Obj::new();
            plan.set("id", Val::Str(format!("project:{}", project.string_or_empty())));
            plan.set("kind", text("project"));
            plan.set("side", side_val.clone());
            plan.set("project", project.clone());
            for key in ["name", "by"] {
                plan.set(key, operation.get(key).cloned().unwrap_or(Val::Undef));
            }
            plan.set("order", word.clone());
            plan.set("objective", text(&if named.is_empty() { String::new() } else { format!("city: {named}") }));
            for key in ["status", "due", "doubted", "secrecy", "own"] {
                plan.set(key, operation.get(key).cloned().unwrap_or(Val::Undef));
            }
            plan.set("edited", Val::Bool(mine_way.truthy()));
            plan.set("off", Val::Bool(off));
            plan.set("sent", Val::Bool(sent));
            plan.set("begun", Val::Bool(false));
            plan.set("live", Val::Bool(matches!(&status, Val::Str(status) if status == "active") && own.truthy() && !off));
            plan.set("ways", Val::Arr(Vec::new()));
            plan.set("picked", Val::Arr(Vec::new()));
            let picked;
            if mine_way.truthy() {
                let route: Vec<[f64; 2]> = mine_way.array_or_empty().iter().map(|point| place.to_cell(js::to_number(&point.element(0)), js::to_number(&point.element(1)))).collect();
                picked = nearest_to(&decoded[side], route[0][0], route[0][1], thrust_count(&text("advance"), have), Some(&busy));
                plan.set("ways", lng_lat_ways(record, &[route]));
            } else {
                picked = nearest_to(&decoded[side], to[0], to[1], thrust_count(&word, have), Some(&busy));
                if let Some(from) = middle_of(&decoded[side], &picked) {
                    plan.set("ways", lng_lat_ways(record, &suggested_ways(record, &word, from, to)));
                }
            }
            plan.set("picked", picked_val(&picked));
            plan.set("troops", num(picked.len() as f64));
            plan
        })
        .collect()
}

fn diversion_plans(record: &Val, side: usize) -> Vec<Obj> {
    kept_plans_of(record, &num(side as f64))
        .iter()
        .filter(|plan| matches!(plan.get("kind"), Val::Str(kind) if kind == "diversion"))
        .map(|plan| {
            let mut out = Obj::new();
            out.set("id", plan.get("id").clone());
            out.set("kind", text("diversion"));
            out.set("side", num(side as f64));
            out.set("order", text("advance"));
            out.set("objective", text(""));
            out.set("name", text(""));
            out.set("by", text(""));
            out.set("ways", Val::Arr(vec![plan.get("way").clone()]));
            out.set("picked", Val::Arr(Vec::new()));
            out.set("troops", plan.get("troops").clone());
            out.set("at", plan.get("at").clone());
            out.set("begun", Val::Bool(false));
            out
        })
        .collect()
}

pub fn plans_of(record: &Val, side: &Val, context: &Context) -> Vec<Val> {
    let Some(at) = side_of(side).filter(|_| record.truthy() && record.get("frame").truthy()) else { return Vec::new() };
    let decoded = troops_of(record);
    let mut orders = order_plans(record, at, context.cities, &decoded);
    let projects = project_plans(record, at, context, &decoded);
    let sent: Vec<String> = orders.iter().filter(|plan| starts_with(plan.get("mark").unwrap_or(&Val::Undef), PROJECT_MARK)).map(|plan| after_mark(plan.get("mark").unwrap())).collect();
    for plan in orders.iter_mut() {
        let mark = plan.get("mark").cloned().unwrap_or(Val::Undef);
        if !starts_with(&mark, PROJECT_MARK) {
            continue;
        }
        let wanted = after_mark(&mark);
        if let Some(of) = projects.iter().find(|project| project.get("project").map(|project| project.string_or_empty() == wanted && matches!(project, Val::Str(_))).unwrap_or(false)) {
            plan.set("name", of.get("name").cloned().unwrap_or(Val::Undef));
            plan.set("project", of.get("project").cloned().unwrap_or(Val::Undef));
        }
    }
    let mut out: Vec<Val> = orders.into_iter().map(Val::Obj).collect();
    for plan in projects {
        let project = plan.get("project").map(|project| project.string_or_empty()).unwrap_or_default();
        if sent.contains(&project) {
            continue;
        }
        if plan.get("sent").is_some_and(|sent| sent.truthy()) {
            let mut done = plan.clone();
            done.set("done", Val::Bool(true));
            done.set("ways", Val::Arr(Vec::new()));
            done.set("picked", Val::Arr(Vec::new()));
            done.set("troops", num(0.0));
            out.push(Val::Obj(done));
        } else {
            out.push(Val::Obj(plan));
        }
    }
    out.extend(diversion_plans(record, at).into_iter().map(Val::Obj));
    out
}

pub fn with_operation_orders(record: &Val, sides: &Val, context: &Context, since: &Val) -> Val {
    let since = &if since.is_undef() { text("") } else { since.clone() };
    let mut next = record.clone();
    for side in sides.array_or_empty() {
        let Some(at) = side_of(side) else { continue };
        let decoded = troops_of(&next);
        let plans = project_plans(&next, at, context, &decoded);
        let mut wanted: Vec<(String, Obj)> = Vec::new();
        for plan in plans.into_iter().filter(|plan| plan.get("live").is_some_and(|live| live.truthy())) {
            let project = plan.get("project").map(|project| project.string_or_empty()).unwrap_or_default();
            match wanted.iter_mut().find(|(key, _)| *key == project) {
                Some(entry) => entry.1 = plan,
                None => wanted.push((project, plan)),
            }
        }
        next = release_marked(&next, side, |mark| starts_with(mark, PROJECT_MARK) && !wanted.iter().any(|(key, _)| *key == after_mark(mark)));
        let standing: Vec<String> = chosen_orders_of(&next, side).iter().filter(|order| starts_with(&order.mark, PROJECT_MARK)).map(|order| after_mark(&order.mark)).collect();
        for (project, plan) in &wanted {
            let picked = plan.get("picked").cloned().unwrap_or(Val::Undef);
            if standing.contains(project) || plan.get("sent").is_some_and(|sent| sent.truthy()) || picked.array_or_empty().is_empty() {
                continue;
            }
            let kept = kept_plans_of(&next, side).into_iter().find(|entry| matches!(entry.get("kind"), Val::Str(kind) if kind == "project") && entry.get("project").string_or_empty() == *project && matches!(entry.get("project"), Val::Str(_)));
            let kept_way = kept.as_ref().map(|entry| entry.get("way").clone()).unwrap_or(Val::Undef);
            let objective = if kept_way.truthy() { text("") } else { plan.get("objective").cloned().unwrap_or(Val::Undef) };
            let way = if kept_way.is_nullish() { Val::Null } else { kept_way.clone() };
            let mark = Val::Str(format!("{PROJECT_MARK}{project}"));
            let before = next.clone();
            next = order_troops(&next, &OrderAsk {
                side,
                troops: &picked,
                order: plan.get("order").unwrap_or(&Val::Undef),
                objective: &objective,
                way: &way,
                by: plan.get("by").unwrap_or(&Val::Undef),
                since,
                mark: &mark,
            });
            if !same_val(&next, &before) {
                next = with_project_plan(&next, side, &text(project), &Val::Null, &Val::Null, &Val::Bool(true), since);
            }
        }
    }
    next
}

fn hash_of(sentence: &str) -> u32 {
    let mut hash: u32 = 2166136261;
    for unit in sentence.encode_utf16() {
        hash ^= unit as u32;
        hash = hash.wrapping_mul(16777619);
    }
    hash
}

fn made_up_plans(record: &Val, side: usize, cities: &Val, truth: &[Val], seed: &Val) -> Vec<Val> {
    let place = place_of(record);
    let decoded = troops_of(record);
    let have = decoded[side].iter().filter(|troop| live(troop)).count() as f64;
    if have == 0.0 {
        return Vec::new();
    }
    let ends: Vec<[f64; 2]> = truth
        .iter()
        .filter(|plan| is_attack(plan.get("order")))
        .flat_map(|plan| plan.get("ways").array_or_empty().iter().map(|way| {
            let last = way.array_or_empty().last().cloned().unwrap_or(Val::Undef);
            [js::to_number(&last.element(0)), js::to_number(&last.element(1))]
        }).collect::<Vec<_>>())
        .collect();
    struct Spot {
        city: Val,
        x: f64,
        y: f64,
        away: f64,
        weight: f64,
    }
    let mut places: Vec<Spot> = Vec::new();
    for city in cities.array_or_empty() {
        let (lng, lat) = (js::to_number(city.get("lng")), js::to_number(city.get("lat")));
        if clean(city.get("name")).is_empty() || !in_frame(record, lng, lat) || !held_by(record, lng, lat, 1 - side) {
            continue;
        }
        let [x, y] = place.to_cell(lng, lat);
        let mut away = f64::INFINITY;
        for &[elng, elat] in &ends {
            let [ex, ey] = place.to_cell(elng, elat);
            away = jsmath::min(away, ((ex - x) * (ex - x) + (ey - y) * (ey - y)).sqrt() * place.km_at((ey + y) / 2.0));
        }
        let weight = js::or_zero(js::to_number(city.get("population"))) + if city.get("capital").truthy() { 1e9 } else { 0.0 };
        places.push(Spot { city: city.clone(), x, y, away, weight });
    }
    let by_weight = |a: &Spot, b: &Spot| or_else(b.weight - a.weight, || locale_compare(&clean(a.city.get("name")), &clean(b.city.get("name"))));
    let mut choice: Vec<&Spot> = places.iter().filter(|spot| spot.away >= FAR_FROM_TRUTH_KM).collect();
    js::stable_sort_by(&mut choice, |a, b| by_weight(a, b));
    choice.truncate(5);
    if choice.is_empty() {
        choice = places.iter().filter(|spot| spot.away >= NEAR_TRUTH_KM).collect();
        js::stable_sort_by(&mut choice, |a, b| or_else(b.away - a.away, || by_weight(a, b)));
        choice.truncate(1);
    }
    if choice.is_empty() {
        return Vec::new();
    }
    let key = format!("{}|{}|{}", js::to_string(record.get("name")), js::to_string(record.get("asOf")), js::to_string(seed));
    let spot = choice[(hash_of(&key) as usize) % choice.len()];
    let picked = nearest_to(&decoded[side], spot.x, spot.y, thrust_count(&text("spearhead"), have), None);
    let Some(from) = middle_of(&decoded[side], &picked) else { return Vec::new() };
    let by = match record.get("sides").at(side).at(0) {
        Val::Undef | Val::Null => text(""),
        other => other.clone(),
    };
    let mut plan = Obj::new();
    plan.set("id", text("report:0"));
    plan.set("kind", text("order"));
    plan.set("side", num(side as f64));
    plan.set("order", text("spearhead"));
    plan.set("objective", Val::Str(format!("city: {}", clean(spot.city.get("name")))));
    plan.set("name", text(""));
    plan.set("by", by);
    plan.set("ways", lng_lat_ways(record, &suggested_ways(record, &text("spearhead"), from, [spot.x, spot.y])));
    plan.set("picked", Val::Arr(Vec::new()));
    plan.set("troops", num(picked.len() as f64));
    vec![Val::Obj(plan)]
}

fn reportable(plan: &Val) -> Obj {
    let mut out = Obj::new();
    out.set("id", plan.get("id").clone());
    out.set("kind", if matches!(plan.get("kind"), Val::Str(kind) if kind == "diversion") { text("order") } else { plan.get("kind").clone() });
    for key in ["side", "order", "objective"] {
        out.set(key, plan.get(key).clone());
    }
    for key in ["name", "by"] {
        out.set(key, match plan.get(key) {
            Val::Undef | Val::Null => text(""),
            other => other.clone(),
        });
    }
    out.set("ways", plan.get("ways").clone());
    out.set("picked", Val::Arr(Vec::new()));
    out.set("troops", plan.get("troops").clone());
    if plan.get("doubted").truthy() {
        out.set("doubted", Val::Bool(true));
    }
    out
}

fn json_of(value: &Val) -> String {
    match value {
        Val::Num(n) => if n.is_finite() { js::number_to_string(*n) } else { "null".to_string() },
        Val::Arr(list) => format!("[{}]", list.iter().map(|item| if item.is_undef() { "null".to_string() } else { json_of(item) }).collect::<Vec<_>>().join(",")),
        Val::Null | Val::Undef => "null".to_string(),
        Val::Bool(flag) => flag.to_string(),
        Val::Str(text) => format!("{text:?}"),
        _ => "{}".to_string(),
    }
}

pub struct Known {
    pub plans: Vec<Val>,
    pub sources: Vec<Val>,
}

pub fn known_plans(record: &Val, side: &Val, spies: &Val, context: &Context, played: &Val) -> Known {
    let Some(at) = side_of(side).filter(|_| record.truthy() && record.get("frame").truthy()) else { return Known { plans: Vec::new(), sources: Vec::new() } };
    let other = 1 - at;
    let mine: Vec<String> = record.get("sides").at(at).array_or_empty().iter().map(fold).collect();
    let theirs: Vec<String> = record.get("sides").at(other).array_or_empty().iter().map(fold).collect();
    let agents: Vec<&Val> = spies
        .array_or_empty()
        .iter()
        .filter(|spy| mine.contains(&fold(spy.get("owner"))) && theirs.contains(&fold(spy.get("target"))) && matches!(spy.get("status"), Val::Str(status) if status == "active" || status == "turned"))
        .collect();
    let truth = plans_of(record, &num(other as f64), context);
    let mut known: Vec<(String, Obj)> = Vec::new();
    let mut add = |plan: &Val| {
        let key = format!("{}|{}|{}", js::to_string(plan.get("order")), js::to_string(plan.get("objective")), json_of(plan.get("ways")));
        if !known.iter().any(|(own, _)| *own == key) {
            known.push((key, reportable(plan)));
        }
    };
    let kind_is = |plan: &Val, kind: &str| matches!(plan.get("kind"), Val::Str(own) if own == kind);
    for plan in &truth {
        if kind_is(plan, "project") && !plan.get("own").truthy() {
            add(plan);
        }
    }
    if agents.iter().any(|spy| matches!(spy.get("status"), Val::Str(status) if status == "active")) {
        for plan in &truth {
            if !kind_is(plan, "diversion") && (!plan.get("ways").array_or_empty().is_empty() || !is_attack(plan.get("order"))) {
                add(plan);
            }
        }
    }
    let turned: Vec<&&Val> = agents.iter().filter(|spy| matches!(spy.get("status"), Val::Str(status) if status == "turned")).collect();
    if !turned.is_empty() {
        let drawn: Vec<Val> = truth.iter().filter(|plan| kind_is(plan, "diversion")).cloned().collect();
        let people: Vec<String> = played.array_or_empty().iter().map(fold).collect();
        let fed = if !drawn.is_empty() || theirs.iter().any(|name| people.contains(name)) {
            drawn
        } else {
            let seed = match turned[0].get("id") {
                Val::Undef | Val::Null => text(""),
                other => other.clone(),
            };
            made_up_plans(record, other, context.cities, &truth, &seed)
        };
        for plan in &fed {
            add(plan);
        }
    }
    let plans = known
        .into_iter()
        .enumerate()
        .map(|(index, (_, mut plan))| {
            plan.set("id", Val::Str(format!("known:{index}")));
            Val::Obj(plan)
        })
        .collect();
    let sources = agents.iter().map(|spy| Val::obj([("agent", text(&clean(spy.get("owner")))), ("inside", text(&clean(spy.get("target"))))])).collect();
    Known { plans, sources }
}

pub fn has_double_agent(record: &Val, side: &Val, spies: &Val) -> bool {
    let Some(at) = side_of(side).filter(|_| record.truthy()) else { return false };
    let mine: Vec<String> = record.get("sides").at(at).array_or_empty().iter().map(fold).collect();
    let theirs: Vec<String> = record.get("sides").at(1 - at).array_or_empty().iter().map(fold).collect();
    spies.array_or_empty().iter().any(|spy| matches!(spy.get("status"), Val::Str(status) if status == "turned") && theirs.contains(&fold(spy.get("owner"))) && mine.contains(&fold(spy.get("target"))))
}

pub fn describe_plans(record: &Val, plans: &Val, cities: &Val, most: f64) -> Vec<String> {
    let mut lines = Vec::new();
    for plan in plans.array_or_empty() {
        let word = match plan.get("order") {
            Val::Str(order) => WORDS.iter().find(|(key, _)| key == order).map(|(_, words)| *words),
            _ => None,
        }
        .unwrap_or("a movement");
        let objective = plan.get("objective");
        let mut place = if objective.truthy() { format!(" toward {}", js::to_string(objective)) } else { String::new() };
        let ways = plan.get("ways").array_or_empty();
        if place.is_empty() && !ways.is_empty() {
            let way = ways[0].array_or_empty();
            let last = way.last().cloned().unwrap_or(Val::Undef);
            if let Some(near) = city_near(record, cities, js::to_number(&last.element(0)), js::to_number(&last.element(1)), PLAN_PLACE_KM) {
                place = format!(" toward the country round city: {}", clean(near.get("name")));
            }
        }
        let size = if plan.get("troops").num() > 0.0 { format!(", about {} formations", js::to_string(plan.get("troops"))) } else { String::new() };
        let named = if plan.get("name").truthy() { format!(" ({} \"{}\")", if matches!(plan.get("kind"), Val::Str(kind) if kind == "project") { "operation" } else { "plan" }, js::to_string(plan.get("name"))) } else { String::new() };
        lines.push(format!("{word}{place}{size}{named}{}", if plan.get("doubted").truthy() { ", doubted" } else { "" }));
        if lines.len() as f64 >= most {
            break;
        }
    }
    lines
}

fn off_way(way: &[[f64; 2]], x: f64, y: f64) -> f64 {
    let mut best = f64::INFINITY;
    for index in 0..way.len().saturating_sub(1) {
        let [ax, ay] = way[index];
        let dx = way[index + 1][0] - ax;
        let dy = way[index + 1][1] - ay;
        let length = dx * dx + dy * dy;
        let along = if length > 0.0 { jsmath::max(0.0, jsmath::min(1.0, ((x - ax) * dx + (y - ay) * dy) / length)) } else { 0.0 };
        let ox = x - ax - dx * along;
        let oy = y - ay - dy * along;
        best = jsmath::min(best, ox * ox + oy * oy);
    }
    best.sqrt()
}

pub fn with_watch(record: &Val, side: &Val, plans: &Val, since: &Val) -> Val {
    let since = &if since.is_undef() { text("") } else { since.clone() };
    let Some(at) = side_of(side).filter(|_| record.truthy() && record.get("frame").truthy()) else { return record.clone() };
    let next = release_marked(record, side, |mark| matches!(mark, Val::Str(mark) if mark == WATCH_MARK));
    let place = place_of(&next);
    let mut ways: Vec<Vec<[f64; 2]>> = Vec::new();
    for plan in plans.array_or_empty() {
        if !is_attack(plan.get("order")) {
            continue;
        }
        for way in plan.get("ways").array_or_empty() {
            let points = way.array_or_empty();
            if points.len() >= 2 {
                ways.push(points.iter().map(|point| place.to_cell(js::to_number(&point.element(0)), js::to_number(&point.element(1)))).collect());
            }
        }
    }
    if ways.is_empty() {
        return next;
    }
    let decoded = troops_of(&next);
    let busy: Vec<usize> = chosen_orders_of(&next, side).iter().flat_map(|order| order.troops.clone()).collect();
    let mut near: Vec<(f64, usize)> = Vec::new();
    for (index, troop) in decoded[at].iter().enumerate() {
        if !live(troop) || busy.contains(&index) {
            continue;
        }
        let mut best = f64::INFINITY;
        for way in &ways {
            best = jsmath::min(best, off_way(way, troop.x, troop.y) * place.km_at(troop.y));
        }
        if best <= WATCH_KM {
            near.push((best, index));
        }
    }
    js::stable_sort_by(&mut near, |a, b| or_else(a.0 - b.0, || a.1 as f64 - b.1 as f64));
    let most = jsmath::min(WATCH_TROOPS_MOST, (decoded[at].iter().filter(|troop| live(troop)).count() as f64 * WATCH_SHARE).floor());
    let picked: Vec<usize> = near.iter().take(most.max(0.0) as usize).map(|entry| entry.1).collect();
    if picked.is_empty() {
        return next;
    }
    let by = match next.get("sides").at(at).at(0) {
        Val::Undef | Val::Null => text(""),
        other => other.clone(),
    };
    order_troops(&next, &OrderAsk { side, troops: &picked_val(&picked), order: &text("dig in"), objective: &Val::Undef, way: &Val::Undef, by: &by, since, mark: &text(WATCH_MARK) })
}
