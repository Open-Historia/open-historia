use super::battle::Battle;
use super::constants::*;
use super::engine::Run;
use super::field::{nearest_held, redistance, restore_cells, take_capsule, take_cells, Contour, How, Painter};
use super::frame::Projector;
use super::ground::{cell_at, cheapest_way};
use super::js::{self, Obj, Val};
use super::sectors::{describe_point, find_place, in_sector, place_text, resolve_sector, sector_middle, Place, Sector, Sectors};
use super::supply::{find_pockets, nearest_of, surrender_pocket};
use super::troops::{or_else, control_radius, create_troop, is_attack, is_live, live_count, stands, Troop, TroopSeed, KIND_ARTILLERY, KIND_INFANTRY, STATE_ADVANCING, STATE_DUG_IN, STATE_HOLDING};
use super::way::{chance_of, give, give_out, give_route, take_order, ways_for, Telling};
use crate::jsmath;

pub const FLANK_WORDS: [&str; 3] = ["flank", "outflank", "envelop"];

#[derive(Clone, Debug)]
pub struct OrderView {
    pub order: Val,
    pub word: Val,
    pub sector: Sector,
    pub target: Option<Place>,
    pub age: Val,
    pub middle: Option<[f64; 2]>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HaltToday {
    pub s: Val,
    pub sector: Sector,
}

pub struct OrderDay<'a> {
    pub day: f64,
    pub date: &'a str,
    pub contour: &'a Contour,
    pub count: usize,
    pub sectors: &'a Sectors,
}

fn fold(value: &Val) -> String {
    js::fold(value)
}

fn num(value: f64) -> Val {
    Val::Num(value)
}

fn is_side(value: &Val, side: usize) -> bool {
    js::strict_equals(value, &Val::Num(side as f64))
}

fn side_of(order: &Val) -> usize {
    order.read("s").num() as usize
}

fn word_is(value: &Val, word: &str) -> bool {
    matches!(value, Val::Str(text) if text == word)
}

fn word_of(value: &Val) -> String {
    match value {
        Val::Str(text) => text.clone(),
        _ => String::new(),
    }
}

fn attack_word(value: &Val) -> bool {
    matches!(value, Val::Str(text) if is_attack(text))
}

fn includes(list: &[Val], order: &Val) -> bool {
    list.iter().any(|standing| standing.same_ref(order))
}

pub fn place_val(place: &Place) -> Val {
    let mut out = Obj::new();
    out.set("kind", Val::str(place.kind));
    out.set("name", Val::str(&place.name));
    out.set("x", num(place.x));
    out.set("y", num(place.y));
    if let Some(cell) = place.cell {
        out.set("cell", num(cell));
    }
    if let Some(region) = place.region {
        out.set("region", num(region as f64));
    }
    Val::Obj(out)
}

fn sector_text(sector: &Sector) -> String {
    match sector {
        Sector::All => "all".to_string(),
        Sector::Cut { word, .. } | Sector::Place { word, .. } => word.clone(),
    }
}

fn log(battle: &mut Battle, date: &str, kind: &str, side: usize, at: &str) {
    battle.log.push(Val::obj([("d", Val::str(date)), ("k", Val::str(kind)), ("s", num(side as f64)), ("at", Val::str(at))]));
}

pub fn member_of(battle: &Battle, name: &Val) -> [i64; 2] {
    let wanted = fold(name);
    if !wanted.is_empty() {
        for side in [HOLDER_SIDE_A, HOLDER_SIDE_B] {
            let side = side as usize;
            if let Some(index) = battle.sides[side].iter().enumerate().position(|(at, member)| js::fold_text(member) == wanted && !battle.gone[side].contains(&at)) {
                return [side as i64, index as i64];
            }
        }
    }
    [-1, -1]
}

pub fn read_sieges(battle: &mut Battle) {
    let mut sieges = Vec::new();
    let mut spared: [Vec<f64>; 2] = [Vec::new(), Vec::new()];
    {
        let field = battle.field.as_ref().unwrap();
        for order in &battle.orders {
            if !word_is(&order.read("order"), "encircle") || !order.read("objective").truthy() || order.read("age").num() >= ATTACK_LAPSE_DAYS {
                continue;
            }
            let target = find_place(&battle.arena, &order.read("objective"));
            let cell = target.as_ref().map(|target| cell_at(field, target.x, target.y)).unwrap_or(-1);
            let by = order.read("s");
            if cell < 0 || js::strict_equals(&num(field.holders[cell as usize] as f64), &by) {
                continue;
            }
            let target = target.unwrap();
            let s = by.num() as usize;
            spared[s].push(target.x);
            spared[s].push(target.y);
            spared[s].push(SIEGE_SPARE_KM / battle.place.km_at(target.y));
            sieges.push(Val::obj([("by", by), ("x", num(target.x)), ("y", num(target.y)), ("cell", num(cell as f64)), ("at", Val::Str(place_text(target.kind, &target.name)))]));
        }
    }
    battle.siege_key = sieges.iter().map(|siege| format!("{}:{}", js::to_string(siege.get("by")), js::to_string(siege.get("cell")))).collect::<Vec<_>>().join(",");
    battle.sieges = sieges;
    battle.spared = spared;
}

pub fn read_orders(battle: &mut Battle, contour: &Contour, count: usize, sectors: &Sectors) {
    let mut views: [Vec<OrderView>; 2] = [Vec::new(), Vec::new()];
    let km_at = |y: f64| battle.place.km_at(y);
    for order in &battle.orders {
        if order.read("chosen").truthy() {
            continue;
        }
        let sector = resolve_sector(&battle.arena, contour, count, sectors, &order.read("sector")).unwrap_or(Sector::All);
        let objective = order.read("objective");
        let target = if objective.truthy() { find_place(&battle.arena, &objective) } else { None };
        let told = order.read("order");
        let age = order.read("age");
        let word = if attack_word(&told) && age.num() >= ATTACK_LAPSE_DAYS { Val::str("hold") } else { told };
        let middle = if target.is_some() && (word_is(&word, "advance") || word_is(&word, "blitz")) { Some(sector_middle(contour, count, &sector, km_at)) } else { None };
        let s = side_of(order);
        views[s].push(OrderView { order: order.clone(), word, sector, target, age, middle });
    }
    battle.views = views;
    battle.halts_today = battle.halts.iter().map(|halt| HaltToday { s: halt.get("s").clone(), sector: resolve_sector(&battle.arena, contour, count, sectors, halt.get("sector")).unwrap_or(Sector::All) }).collect();
    read_sieges(battle);
}

pub fn age_orders(battle: &mut Battle) {
    for order in battle.orders.iter_mut() {
        let age = order.read("age").num() + 1.0;
        order.write("age", num(age));
        if attack_word(&order.read("order")) && age >= ATTACK_LAPSE_DAYS {
            order.write("order", Val::str("hold"));
            order.unset("objective");
            order.unset("way");
            if order.read("chosen").truthy() {
                order.write("lapsed", Val::Bool(true));
            }
            battle.orders_changed += 1.0;
        }
    }
    let standing = battle.orders.len();
    battle.orders.retain(|order| {
        !order.read("lapsed").truthy() && (!word_is(&order.read("order"), "assault") || (!{ let entry = order.read("entry"); entry.truthy() && entry.read("over").truthy() } && order.read("age").num() <= ASSAULT_DAYS))
    });
    if battle.orders.len() != standing {
        battle.orders_changed += 1.0;
    }
    let before = battle.halts.len();
    for halt in battle.halts.iter_mut() {
        let days = halt.get("days").num() - 1.0;
        halt.write("days", num(days));
    }
    battle.halts.retain(|halt| halt.get("days").num() > 0.0);
    if battle.halts.len() != before {
        battle.orders_changed += 1.0;
    }
}

fn members_in(battle: &Battle, side: usize) -> Vec<String> {
    battle.sides[side].iter().enumerate().map(|(at, member)| if battle.gone[side].contains(&at) { String::new() } else { js::fold_text(member) }).collect()
}

fn giver_of(battle: &Battle, side: usize, order: &Val) -> i64 {
    let members = members_in(battle, side);
    if members.iter().filter(|member| !member.is_empty()).count() <= 1 {
        return -1;
    }
    let by = fold(&order.read("by"));
    if by.is_empty() {
        -1
    } else {
        members.iter().position(|member| *member == by).map(|at| at as i64).unwrap_or(-1)
    }
}

pub enum Takes {
    All,
    Owner(f64),
    Lead { giver: f64, members: Vec<String>, played: Vec<String>, own: Vec<Option<Vec<Sector>>> },
}

impl Takes {
    pub fn takes(&self, troop: &Troop, place: &Projector) -> bool {
        match self {
            Takes::All => true,
            Takes::Owner(giver) => troop.owner == *giver,
            Takes::Lead { giver, members, played, own } => {
                if troop.owner == *giver {
                    return true;
                }
                let at = troop.owner;
                let member = if at >= 0.0 && at.trunc() == at { members.get(at as usize).cloned().unwrap_or_default() } else { String::new() };
                if member.is_empty() || played.contains(&member) {
                    return false;
                }
                let theirs = own.get(at as usize).and_then(|entry| entry.as_ref());
                !theirs.map(|sectors| sectors.iter().any(|sector| in_sector(sector, troop.x, troop.y, |y| place.km_at(y)))).unwrap_or(false)
            }
        }
    }
}

pub fn takes_order(battle: &Battle, run: Option<&Run>, order: &Val, today: &OrderDay) -> Takes {
    let side = side_of(order);
    let giver = giver_of(battle, side, order);
    if giver < 0 {
        return Takes::All;
    }
    let members = members_in(battle, side);
    let lead = members.iter().position(|member| !member.is_empty()).map(|at| at as i64).unwrap_or(-1);
    if giver != lead {
        return Takes::Owner(giver as f64);
    }
    let played: Vec<String> = run.map(|run| run.input.get("players").array_or_empty().iter().map(fold).collect()).unwrap_or_default();
    let own = members
        .iter()
        .enumerate()
        .map(|(at, member)| {
            if member.is_empty() || at as i64 == giver {
                return None;
            }
            Some(
                battle
                    .orders
                    .iter()
                    .filter(|standing| is_side(&standing.read("s"), side) && !standing.read("chosen").truthy() && !standing.same_ref(order) && !word_is(&standing.read("order"), "assault") && fold(&standing.read("by")) == *member)
                    .map(|standing| resolve_sector(&battle.arena, today.contour, today.count, today.sectors, &standing.read("sector")).unwrap_or(Sector::All))
                    .collect(),
            )
        })
        .collect();
    Takes::Lead { giver: giver as f64, members, played, own }
}

pub fn set_standing_order(battle: &mut Battle, side: usize, order: &Val) -> Val {
    let sector = fold(&order.read("sector"));
    let besides = word_is(&order.read("order"), "assault");
    let giver = giver_of(battle, side, order);
    let objective = fold(&order.read("objective"));
    let kept: Vec<bool> = battle
        .orders
        .iter()
        .map(|standing| {
            let another = {
                let theirs = giver_of(battle, side, standing);
                giver >= 0 && theirs >= 0 && theirs != giver
            };
            !is_side(&standing.read("s"), side)
                || standing.read("chosen").truthy()
                || another
                || word_is(&standing.read("order"), "assault") != besides
                || if besides { fold(&standing.read("objective")) != objective } else { sector != "all" && fold(&standing.read("sector")) != sector }
        })
        .collect();
    let mut at = 0;
    battle.orders.retain(|_| {
        at += 1;
        kept[at - 1]
    });
    let mut set = match order {
        Val::Ref(cell) => cell.borrow().clone(),
        other => js::spread(other),
    };
    set.set("s", num(side as f64));
    let set = Val::shared(set);
    battle.orders.push(set.clone());
    let mine: Vec<Val> = battle.orders.iter().filter(|standing| is_side(&standing.read("s"), side)).cloned().collect();
    if mine.len() as f64 > MAX_ORDERS_PER_SIDE {
        let dropped = mine.iter().find(|standing| !standing.read("chosen").truthy()).unwrap_or(&mine[0]).clone();
        battle.orders.retain(|standing| !standing.same_ref(&dropped));
    }
    battle.orders_changed += 1.0;
    set
}

pub struct Target {
    pub kind: &'static str,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub unit: Option<(usize, usize)>,
}

fn line_break(unit: char) -> bool {
    matches!(unit, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

fn named_objective(text: &str) -> Option<(String, String)> {
    let rest = text.trim_start_matches(js::is_js_whitespace);
    for kind in ["city", "structure", "unit"] {
        if rest.len() < kind.len() || !rest.is_char_boundary(kind.len()) || !rest[..kind.len()].eq_ignore_ascii_case(kind) {
            continue;
        }
        let after = rest[kind.len()..].trim_start_matches(js::is_js_whitespace);
        let Some(after) = after.strip_prefix(':') else { continue };
        let body = after.trim_start_matches(js::is_js_whitespace);
        if body.contains(line_break) {
            return None;
        }
        return Some((kind.to_string(), body.to_string()));
    }
    None
}

pub fn assault_target(battle: &Battle, run: Option<&Run>, side: usize, objective: &Val) -> Option<Target> {
    let text = objective.string_or_empty();
    let named = named_objective(&text);
    let kind = named.as_ref().map(|(kind, _)| kind.clone()).unwrap_or_default();
    let wanted = match &named {
        Some((_, rest)) => js::fold_text(rest),
        None => fold(objective),
    };
    if wanted.is_empty() {
        return None;
    }
    if kind != "structure" && kind != "unit" {
        if let Some(city) = find_place(&battle.arena, &Val::Str(format!("city: {wanted}"))) {
            return Some(Target { kind: "city", name: place_text(city.kind, &city.name), x: city.x, y: city.y, unit: None });
        }
    }
    if kind != "city" && kind != "unit" {
        let structures = run.map(|run| run.input.get("map").get("structures").array_or_empty().to_vec()).unwrap_or_default();
        if let Some(found) = structures.iter().find(|entry| fold(entry.get("name")) == wanted) {
            let [x, y] = battle.place.to_cell(js::to_number(found.get("lng")), js::to_number(found.get("lat")));
            if cell_at(battle.field.as_ref().unwrap(), x, y) >= 0 {
                return Some(Target { kind: "structure", name: format!("structure: {}", js::trim(&js::to_string(found.get("name")))), x, y, unit: None });
            }
        }
    }
    if kind != "city" && kind != "structure" {
        if let Some(entry) = battle.named.iter().find(|formation| formation.s == 1 - side && js::fold_text(&formation.name) == wanted) {
            if let Some(unit) = battle.troops[entry.s].get(entry.i) {
                if is_live(unit) {
                    return Some(Target { kind: "unit", name: format!("unit: {}", entry.name), x: unit.x, y: unit.y, unit: Some((entry.s, entry.i)) });
                }
            }
        }
    }
    None
}

pub fn unit_val(unit: Option<(usize, usize)>) -> Val {
    match unit {
        Some((s, i)) => Val::Arr(vec![num(s as f64), num(i as f64)]),
        None => Val::Null,
    }
}

pub fn unit_of(entry: &Val) -> Option<(usize, usize)> {
    match entry.read("unit") {
        Val::Arr(pair) if pair.len() == 2 => Some((pair[0].num() as usize, pair[1].num() as usize)),
        _ => None,
    }
}

fn assault(battle: &mut Battle, run: Option<&Run>, order: &mut Val, today: &OrderDay) -> bool {
    let side = side_of(order);
    let Some(target) = assault_target(battle, run, side, &order.read("objective")) else { return false };
    let km = battle.place.km_at(target.y);
    let mut held = 0.0;
    for enemy in &battle.troops[1 - side] {
        let dx = enemy.x - target.x;
        let dy = enemy.y - target.y;
        if is_live(enemy) && (dx * dx + dy * dy).sqrt() * km < ASSAULT_DEFENDERS_KM {
            held += enemy.strength;
        }
    }
    let needed = jsmath::max(ASSAULT_LEAST, jsmath::min(ASSAULT_MOST, ASSAULT_BASE + ((2.0 * held) / ASSAULT_PER_STRENGTH).ceil()));
    let mine = takes_order(battle, run, order, today);
    let mut near: Vec<(usize, f64)> = Vec::new();
    for (index, troop) in battle.troops[side].iter().enumerate() {
        if !is_live(troop) || troop.dug || troop.pocket || troop.kind == KIND_ARTILLERY || troop.strength < CLOSE_UNDER_STRENGTH || !mine.takes(troop, &battle.place) {
            continue;
        }
        let distance = ((troop.x - target.x) * (troop.x - target.x) + (troop.y - target.y) * (troop.y - target.y)).sqrt() * km;
        if distance < ASSAULT_FROM_KM {
            near.push((index, distance));
        }
    }
    sorted_by(&mut near);
    let mut entry = Obj::new();
    entry.set("kind", Val::str(target.kind));
    entry.set("name", Val::Str(target.name.clone()));
    entry.set("x", num(target.x));
    entry.set("y", num(target.y));
    entry.set("unit", unit_val(target.unit));
    entry.set("side", num(side as f64));
    entry.set("day", num(today.day - order.read("age").num()));
    entry.set("taken", num(0.0));
    entry.set("over", Val::Bool(false));
    let entry = Val::shared(entry);
    order.write("entry", entry.clone());
    for &(index, _) in near.iter().take(needed.max(0.0) as usize) {
        let ring = ASSAULT_RING_KM[0] + (ASSAULT_RING_KM[1] - ASSAULT_RING_KM[0]) * chance_of(battle, &[Val::str("ring"), num(side as f64), num(index as f64)]);
        let troop = &mut battle.troops[side][index];
        let busy = troop.order.truthy() && !troop.order.get("done").truthy();
        let resume = if !busy {
            Val::Null
        } else if matches!(troop.order.get("kind"), Val::Str(kind) if kind == "reduce" || kind == "assault") {
            match troop.order.get("resume") {
                Val::Undef | Val::Null => Val::Null,
                other => other.clone(),
            }
        } else {
            troop.order.clone()
        };
        troop.order = Val::obj([
            ("kind", Val::str("assault")),
            ("standing", order.clone()),
            ("since", num(today.day)),
            ("day", num(today.day)),
            ("entry", entry.clone()),
            ("resume", resume),
            ("ring", num(ring)),
        ]);
        troop.fallback = Val::Null;
    }
    true
}

fn sorted_by(list: &mut [(usize, f64)]) {
    js::stable_sort_by(list, |a, b| or_else(a.1 - b.1, || a.0 as f64 - b.0 as f64));
}

pub fn assign_order(battle: &mut Battle, run: &Run, order: &mut Val, today: &OrderDay, picked: Option<&[usize]>, lagless: bool) -> bool {
    let side = side_of(order);
    let word = order.read("order");
    if word_is(&word, "assault") {
        return assault(battle, Some(run), order, today);
    }
    let word = word_of(&word);
    let sector = resolve_sector(&battle.arena, today.contour, today.count, today.sectors, &order.read("sector")).unwrap_or(Sector::All);
    let mine = if picked.is_some() { Takes::All } else { takes_order(battle, Some(run), order, today) };
    let mut group: Vec<usize> = Vec::new();
    for (index, troop) in battle.troops[side].iter().enumerate() {
        let wanted = match picked {
            Some(picked) => picked.contains(&index),
            None => in_sector(&sector, troop.x, troop.y, |y| battle.place.km_at(y)) && mine.takes(troop, &battle.place),
        };
        if is_live(troop) && wanted {
            group.push(index);
        }
    }
    let troops = &mut battle.troops[side];
    if word == "dig in" {
        for &index in &group {
            let troop = &mut troops[index];
            troop.order = Val::Null;
            troop.fallback = Val::Null;
            troop.dug = true;
            troop.dig = 1.0;
            troop.state = STATE_DUG_IN;
        }
    } else if word == "hold" || word == "land" {
        for &index in &group {
            let troop = &mut troops[index];
            take_order(troop, Val::Null);
            if troop.order.truthy() && troop.order.get("resume").truthy() {
                troop.order.write("resume", Val::Null);
            }
            if troop.dug {
                troop.state = STATE_HOLDING;
            }
            troop.dug = false;
        }
    } else if word == "withdraw" {
        for &index in &group {
            let troop = &mut troops[index];
            if troop.dug {
                troop.state = STATE_HOLDING;
            }
            troop.dug = false;
            troop.order = Val::obj([("kind", Val::str("withdraw")), ("standing", order.clone()), ("since", num(today.day)), ("day", num(today.day)), ("gone", num(0.0))]);
            troop.fallback = Val::Null;
        }
    } else if word == "fall back" {
        let objective = order.read("objective");
        let target = if objective.truthy() { find_place(&battle.arena, &objective).map(|place| place_val(&place)).unwrap_or(Val::Null) } else { Val::Null };
        let troops = &mut battle.troops[side];
        for &index in &group {
            let troop = &mut troops[index];
            if troop.dug {
                troop.state = STATE_HOLDING;
            }
            troop.dug = false;
            troop.order = Val::obj([("kind", Val::str("fallback")), ("standing", order.clone()), ("target", target.clone()), ("since", num(today.day)), ("day", num(today.day)), ("gone", num(0.0))]);
            troop.fallback = Val::Null;
        }
    } else if is_attack(&word) && !group.is_empty() && order.read("way").as_array().is_some_and(|way| !way.is_empty()) {
        let way: Vec<[f64; 2]> = order.read("way").array_or_empty().iter().map(|point| battle.place.to_cell(point.element(0).num(), point.element(1).num())).collect();
        give_route(battle, side, &group, today.day, &way, order, lagless);
        for &index in &group {
            if battle.troops[side][index].state == STATE_DUG_IN {
                battle.troops[side][index].state = STATE_HOLDING;
            }
        }
    } else if is_attack(&word) && !group.is_empty() {
        let objective = order.read("objective");
        let target = if objective.truthy() { find_place(&battle.arena, &objective) } else { None };
        let days = jsmath::max(1.0, run.days - today.day);
        let ranked = word == "advance" || word == "blitz";
        let mut sent: Vec<usize> = Vec::new();
        let mut rest: Vec<usize> = group.clone();
        if target.is_some() || !ranked {
            let [near_x, near_y] = match &target {
                Some(target) => [target.x, target.y],
                None => sector_middle(today.contour, today.count, &sector, |y| battle.place.km_at(y)),
            };
            let most = THRUST_TROOPS.iter().find(|(name, _)| *name == word).or_else(|| THRUST_TROOPS.iter().find(|(name, _)| *name == "advance")).unwrap().1;
            let length = group.len() as f64;
            let count = if picked.is_some() || matches!(sector, Sector::Place { .. }) { jsmath::min(most, length) } else { jsmath::min(jsmath::min(most, length), jsmath::max(THRUST_LEAST, (length * THRUST_SHARE).ceil())) };
            let troops = &battle.troops[side];
            let mut nearest: Vec<(usize, f64)> = group
                .iter()
                .filter(|&&index| !troops[index].pocket)
                .map(|&index| {
                    let dx = troops[index].x - near_x;
                    let dy = troops[index].y - near_y;
                    (index, dx * dx + dy * dy)
                })
                .collect();
            sorted_by(&mut nearest);
            let mut taken = vec![false; nearest.len()];
            let link = THRUST_LINK_KM / battle.place.km_at(near_y);
            let mut body: Vec<usize> = if picked.is_some() { nearest.iter().take(count as usize).map(|entry| entry.0).collect() } else { Vec::new() };
            let mut grew = picked.is_none();
            while grew && (body.len() as f64) < count {
                grew = false;
                for (at, entry) in nearest.iter().enumerate() {
                    if body.len() as f64 >= count {
                        break;
                    }
                    if taken[at] {
                        continue;
                    }
                    let mine = &troops[entry.0];
                    if !body.is_empty() && !body.iter().any(|&other| (troops[other].x - mine.x) * (troops[other].x - mine.x) + (troops[other].y - mine.y) * (troops[other].y - mine.y) <= link * link) {
                        continue;
                    }
                    taken[at] = true;
                    body.push(entry.0);
                    grew = true;
                }
            }
            sent = group.iter().copied().filter(|index| body.contains(index)).collect();
            rest = group.iter().copied().filter(|index| !body.contains(index)).collect();
        }
        if !sent.is_empty() {
            let ways = ways_for(battle, run, side, &sent, &word, target.as_ref(), days);
            let tell = |battle: &mut Battle, picked: &[usize], way: &[[f64; 2]]| {
                give(battle, side, picked, &Telling { day: today.day, word: &word, way, standing: order, breadth_km: 0.0, lagless });
            };
            if ways.ways.len() == 2 {
                let troops = &battle.troops[side];
                let across = |index: usize| (troops[index].x - ways.mid_x) * -ways.fy + (troops[index].y - ways.mid_y) * ways.fx;
                let mut abreast = sent.clone();
                js::stable_sort_by(&mut abreast, |&a, &b| or_else(across(b) - across(a), || a as f64 - b as f64));
                let half = (abreast.len() as f64 / 2.0).ceil() as usize;
                tell(battle, &abreast[..half], &ways.ways[0]);
                tell(battle, &abreast[half..], &ways.ways[1]);
            } else {
                let way: &[[f64; 2]] = ways.ways.first().map(|way| way.as_slice()).unwrap_or(&[]);
                tell(battle, &sent, way);
            }
        }
        if ranked && !rest.is_empty() {
            give_out(battle, run, side, &rest, today.day, &word, order, lagless);
        }
        for &index in if ranked { &group } else { &sent } {
            if battle.troops[side][index].state == STATE_DUG_IN {
                battle.troops[side][index].state = STATE_HOLDING;
            }
        }
    }
    true
}

pub fn standing_of(battle: &Battle, troop: &Troop) -> Option<Val> {
    let mut order = if troop.order.truthy() && !troop.order.get("done").truthy() { Some(troop.order.clone()) } else { None };
    if let Some(held) = &order {
        let kind = held.get("kind");
        if word_is(kind, "reduce") || (word_is(kind, "assault") && !includes(&battle.orders, held.get("standing"))) {
            let resume = held.get("resume");
            order = if resume.truthy() && !resume.get("done").truthy() { Some(resume.clone()) } else { None };
        }
    }
    let order = order?;
    let standing = order.get("standing");
    if standing.truthy() && includes(&battle.orders, standing) {
        Some(standing.clone())
    } else {
        None
    }
}

pub fn serving_of(battle: &Battle, troop: &Troop) -> i64 {
    match standing_of(battle, troop) {
        Some(standing) => battle.orders.iter().position(|order| order.same_ref(&standing)).map(|at| at as i64).unwrap_or(-1),
        None => -1,
    }
}

pub fn give_way(battle: &mut Battle, side: usize, loss_share: f64, date: &str, reach: f64) {
    for index in 0..battle.troops[side].len() {
        let field = battle.field.as_ref().unwrap();
        let troop = &battle.troops[side][index];
        if !is_live(troop) || stands(field, side as u8, troop.x, troop.y) {
            continue;
        }
        let cell = nearest_held(field, side as u8, troop.x, troop.y, reach);
        let cols = field.cols;
        if cell < 0 {
            let at = describe_point(&battle.arena, troop.x, troop.y);
            if !at.is_empty() {
                log(battle, date, "overrun", side, &at);
            }
            battle.troops[side][index].strength = 0.0;
            continue;
        }
        let troop = &mut battle.troops[side][index];
        troop.x = (cell as usize % cols) as f64 + 0.5;
        troop.y = (cell as usize / cols) as f64 + 0.5;
        troop.strength *= 1.0 - loss_share;
        troop.dig = 0.0;
    }
}

fn capture(battle: &mut Battle, side: usize, target: &Place, date: &str) -> bool {
    let mut leader: i64 = -1;
    let mut best = f64::INFINITY;
    {
        let field = battle.field.as_ref().unwrap();
        for (index, troop) in battle.troops[side].iter().enumerate() {
            if !is_live(troop) || !stands(field, side as u8, troop.x, troop.y) {
                continue;
            }
            let dx = troop.x - target.x;
            let dy = troop.y - target.y;
            let away = (dx * dx + dy * dy).sqrt() - troop.strength / 1000.0;
            if away < best {
                best = away;
                leader = index as i64;
            }
        }
    }
    if leader < 0 {
        return false;
    }
    let leader = leader as usize;
    let way = {
        let field = battle.field.as_ref().unwrap();
        let mut goal = if target.kind == "city" { target.cell.map(|cell| cell as i64).unwrap_or(-1) } else { cell_at(field, target.x, target.y) };
        if goal < 0 || field.play[goal as usize] == 0 {
            goal = -1;
            let mut nearest = f64::INFINITY;
            for index in 0..field.size {
                if field.play[index] == 0 || (target.kind == "region" && Some(battle.arena.region[index] as usize) != target.region) {
                    continue;
                }
                let dx = (index % field.cols) as f64 + 0.5 - target.x;
                let dy = (index / field.cols) as f64 + 0.5 - target.y;
                if dx * dx + dy * dy < nearest {
                    nearest = dx * dx + dy * dy;
                    goal = index as i64;
                }
            }
        }
        let lead = &battle.troops[side][leader];
        cheapest_way(field, cell_at(field, lead.x, lead.y), goal)
    };
    let Some(way) = way else { return false };
    let troops = &battle.troops[side];
    let mut beside: Vec<(usize, f64)> = Vec::new();
    for (index, troop) in troops.iter().enumerate() {
        if index == leader || !is_live(troop) {
            continue;
        }
        beside.push((index, (troop.x - troops[leader].x) * (troop.x - troops[leader].x) + (troop.y - troops[leader].y) * (troop.y - troops[leader].y)));
    }
    sorted_by(&mut beside);
    let mut column = vec![leader];
    column.extend(beside.iter().take(CAPTURED_COLUMN as usize).map(|entry| entry.0));
    let mut radius: f64 = 0.0;
    for &index in &column {
        radius = jsmath::max(radius, control_radius(&troops[index], |y| battle.place.km_at(y)));
    }
    let painter = troops[leader].owner;
    let (mut from_x, mut from_y) = (troops[leader].x, troops[leader].y);
    let field = battle.field.as_mut().unwrap();
    let cols = field.cols;
    for &cell in &way {
        let x = (cell % cols) as f64 + 0.5;
        let y = (cell / cols) as f64 + 0.5;
        take_capsule(field, side as u8, from_x, from_y, x, y, radius, radius, How { painter, ..How::default() });
        from_x = x;
        from_y = y;
    }
    if target.kind == "city" {
        take_capsule(field, side as u8, target.x, target.y, target.x, target.y, CAPTURED_CITY_CELLS, CAPTURED_CITY_CELLS, How { painter, ..How::default() });
    } else {
        let cells: Vec<usize> = (0..field.size).filter(|&index| field.play[index] != 0 && Some(battle.arena.region[index] as usize) == target.region).collect();
        take_cells(field, side as u8, &cells, Painter::Value(painter));
    }
    for (rank, &index) in column.iter().enumerate() {
        let back = jsmath::round(rank as f64 * radius * 1.5);
        let at = jsmath::max(0.0, way.len() as f64 - 1.0 - back) as usize;
        let cell = way[at];
        let troop = &mut battle.troops[side][index];
        troop.x = (cell % cols) as f64 + 0.5;
        troop.y = (cell / cols) as f64 + 0.5;
        troop.dig = 0.0;
        troop.state = STATE_ADVANCING;
    }
    give_way(battle, 1 - side, CAPTURED_LOSS, date, OVERRUN_CELLS);
    redistance(battle.field.as_mut().unwrap());
    true
}

fn repulse(battle: &mut Battle, side: usize, sector: &Sector, date: &str) {
    let place = battle.place.clone();
    let km_at = |y: f64| place.km_at(y);
    let start = battle.start_phi.clone().unwrap_or_default();
    let other = 1 - side;
    let mut cells = Vec::new();
    {
        let field = battle.field.as_ref().unwrap();
        for index in 0..field.size {
            let begun = start.get(index).copied().unwrap_or(f64::NAN);
            if field.play[index] == 0 || begun == 0.0 {
                continue;
            }
            let gained = if side == HOLDER_SIDE_A as usize { field.phi[index] < begun } else { field.phi[index] > begun };
            if gained && in_sector(sector, (index % field.cols) as f64 + 0.5, (index / field.cols) as f64 + 0.5, km_at) {
                cells.push(index);
            }
        }
    }
    let troops = battle.troops[other].clone();
    let cols = battle.field.as_ref().unwrap().cols;
    restore_cells(battle.field.as_mut().unwrap(), &cells, &start, |cell| nearest_of(&troops, cols, cell));
    let field = battle.field.as_ref().unwrap();
    let behind: Vec<usize> = (0..field.size).filter(|&index| field.holders[index] as usize == side && in_sector(sector, (index % field.cols) as f64 + 0.5, (index / field.cols) as f64 + 0.5, km_at)).collect();
    let field = battle.field.as_ref().unwrap();
    for troop in battle.troops[side].iter_mut() {
        if !is_live(troop) || !in_sector(sector, troop.x, troop.y, km_at) {
            continue;
        }
        troop.strength *= 1.0 - REPULSED_LOSS;
        troop.dig = 0.0;
        troop.hx = 0.0;
        troop.hy = 0.0;
        if stands(field, side as u8, troop.x, troop.y) {
            continue;
        }
        let mut nearest = f64::INFINITY;
        let mut home: i64 = -1;
        for &index in &behind {
            let dx = (index % field.cols) as f64 + 0.5 - troop.x;
            let dy = (index / field.cols) as f64 + 0.5 - troop.y;
            if dx * dx + dy * dy >= nearest {
                continue;
            }
            nearest = dx * dx + dy * dy;
            home = index as i64;
        }
        if home < 0 {
            continue;
        }
        troop.x = (home as usize % field.cols) as f64 + 0.5;
        troop.y = (home as usize / field.cols) as f64 + 0.5;
    }
    let reach = (field.cols + field.rows) as f64;
    give_way(battle, side, 0.0, date, reach);
    redistance(battle.field.as_mut().unwrap());
    lift_sieges(battle, side, sector, date);
    battle.halts.push(Val::obj([("s", num(side as f64)), ("sector", Val::Str(sector_text(sector))), ("days", num(HALT_DAYS))]));
    battle.orders_changed += 1.0;
}

fn lift_sieges(battle: &mut Battle, side: usize, sector: &Sector, date: &str) {
    let other = 1 - side;
    read_sieges(battle);
    let sieges = battle.sieges.clone();
    for siege in &sieges {
        let (sx, sy, scell) = (siege.get("x").num(), siege.get("y").num(), siege.get("cell").num() as usize);
        if !is_side(siege.get("by"), side) || !in_sector(sector, sx, sy, |y| battle.place.km_at(y)) {
            continue;
        }
        find_pockets(battle);
        if battle.pocket_of.as_ref().unwrap()[other][scell] < 0 {
            continue;
        }
        let field = battle.field.as_ref().unwrap();
        let pocket_of = battle.pocket_of.as_ref().unwrap();
        let mut goal: i64 = -1;
        let mut nearest = f64::INFINITY;
        for index in 0..field.size {
            if field.holders[index] as usize != other || pocket_of[other][index] >= 0 {
                continue;
            }
            let dx = (index % field.cols) as f64 + 0.5 - sx;
            let dy = (index / field.cols) as f64 + 0.5 - sy;
            if dx * dx + dy * dy < nearest {
                nearest = dx * dx + dy * dy;
                goal = index as i64;
            }
        }
        let Some(way) = cheapest_way(field, goal, scell as i64) else { continue };
        let radius = jsmath::max(CONTROL_RADIUS_MIN_CELLS, battle.radius_km[other] / battle.place.km_at(sy));
        let cols = field.cols;
        let painter = nearest_of(&battle.troops[other], cols, goal as usize);
        let (mut from_x, mut from_y) = ((goal as usize % cols) as f64 + 0.5, (goal as usize / cols) as f64 + 0.5);
        let field = battle.field.as_mut().unwrap();
        for &cell in &way {
            let x = (cell % cols) as f64 + 0.5;
            let y = (cell / cols) as f64 + 0.5;
            take_capsule(field, other as u8, from_x, from_y, x, y, radius, radius, How { painter, ..How::default() });
            from_x = x;
            from_y = y;
        }
        give_way(battle, side, 0.0, date, OVERRUN_CELLS);
        redistance(battle.field.as_mut().unwrap());
    }
}

fn note_of(note: &Obj, kind: &str, detail: Option<String>) -> Val {
    let mut out = note.clone();
    out.set("kind", Val::str(kind));
    if let Some(detail) = detail {
        out.set("detail", Val::Str(detail));
    }
    Val::Obj(out)
}

fn land(battle: &mut Battle, side: usize, target: &Place, date: &str, notes: &mut Vec<Val>, note: &Obj) {
    let cell = cell_at(battle.field.as_ref().unwrap(), target.x, target.y);
    if cell < 0 || battle.field.as_ref().unwrap().holders[cell as usize] as usize != 1 - side {
        notes.push(note_of(note, "landing-refused", Some(place_text(target.kind, &target.name))));
        return;
    }
    let room = MAX_TROOPS_PER_SIDE - battle.troops[side].len() as f64;
    let strength = jsmath::min(100.0, battle.pool[side]);
    if room <= 0.0 || strength < 10.0 {
        notes.push(note_of(note, "landing-refused", Some("no-reserves".to_string())));
        return;
    }
    let cols = battle.field.as_ref().unwrap().cols;
    let x = (cell as usize % cols) as f64 + 0.5;
    let y = (cell as usize / cols) as f64 + 0.5;
    let [_, owner] = member_of(battle, note.get("side").unwrap_or(&Val::Undef));
    let owner = jsmath::max(0.0, owner as f64);
    take_capsule(battle.field.as_mut().unwrap(), side as u8, x, y, x, y, LANDING_CELLS, LANDING_CELLS, How { painter: owner, ..How::default() });
    battle.anchors.push(Val::obj([("s", num(side as f64)), ("x", num(x)), ("y", num(y))]));
    let mut landed = 0.0;
    while landed < jsmath::min(LANDING_TROOPS, room) && battle.pool[side] >= 10.0 {
        let sent = jsmath::min(100.0, battle.pool[side]);
        battle.pool[side] -= sent;
        let at = landed as usize;
        battle.troops[side].push(create_troop(TroopSeed { x: x + if at % 2 == 0 { 0.3 } else { -0.3 }, y: y + if at < 2 { 0.3 } else { -0.3 }, strength: sent, kind: KIND_INFANTRY, owner, ..TroopSeed::default() }));
        landed += 1.0;
    }
    give_way(battle, 1 - side, 0.0, date, OVERRUN_CELLS);
    redistance(battle.field.as_mut().unwrap());
}

const ROUND: [[f64; 2]; 8] = [[1.0, 0.0], [0.7071, 0.7071], [0.0, 1.0], [-0.7071, 0.7071], [-1.0, 0.0], [-0.7071, -0.7071], [0.0, -1.0], [0.7071, -0.7071]];

pub fn put_ashore(battle: &mut Battle, side: usize, x: f64, y: f64, load: &Val, owner: f64) -> usize {
    let room = jsmath::max(0.0, MAX_TROOPS_PER_SIDE - battle.troops[side].len() as f64);
    let given = load.as_array().map(|list| list.len()).unwrap_or(0) as f64;
    let count = jsmath::min(room, given) as usize;
    for index in 0..count {
        let item = &load.array_or_empty()[index];
        let strength = item.element(0);
        let kind = item.element(1);
        let [across, down] = ROUND[(index * 3) % ROUND.len()];
        let out = 0.22 + 0.11 * (index as f64 / 5.0).floor();
        let mut px = x + across * out;
        let mut py = y + down * out;
        if !stands(battle.field.as_ref().unwrap(), side as u8, px, py) {
            px = x;
            py = y;
        }
        let read = js::to_number(&strength);
        let read = if read.is_nan() || read == 0.0 { 100.0 } else { read };
        let kind = match kind {
            Val::Num(n) if n == 1.0 || n == 2.0 => n,
            _ => KIND_INFANTRY,
        };
        battle.troops[side].push(create_troop(TroopSeed { x: px, y: py, strength: jsmath::min(100.0, jsmath::max(1.0, read)), kind, owner: jsmath::max(0.0, owner), ..TroopSeed::default() }));
    }
    battle.pool[side] += count as f64 * POOL_PER_TROOP * 0.5 * battle.edge[side].reserves;
    battle.plan_key = String::new();
    count
}

pub struct Carried {
    pub landed: usize,
    pub x: f64,
    pub y: f64,
    pub hostile: bool,
}

pub fn land_carried(battle: &mut Battle, side: usize, x: f64, y: f64, load: &Val, owner: f64, date: &str) -> Carried {
    let field = battle.field.as_ref().unwrap();
    let mut cell = cell_at(field, x, y);
    if cell < 0 || field.holders[cell as usize] > 1 {
        cell = nearest_held(field, (1 - side) as u8, x, y, 3.0);
        if cell < 0 {
            cell = nearest_held(field, side as u8, x, y, 3.0);
        }
    }
    if cell < 0 || field.holders[cell as usize] > 1 || battle.troops[side].len() as f64 >= MAX_TROOPS_PER_SIDE {
        return Carried { landed: 0, x, y, hostile: false };
    }
    let px = (cell as usize % field.cols) as f64 + 0.5;
    let py = (cell as usize / field.cols) as f64 + 0.5;
    let hostile = field.holders[cell as usize] as usize == 1 - side;
    if hostile {
        take_capsule(battle.field.as_mut().unwrap(), side as u8, px, py, px, py, LANDING_CELLS, LANDING_CELLS, How { painter: jsmath::max(0.0, owner), ..How::default() });
        battle.anchors.push(Val::obj([("s", num(side as f64)), ("x", num(px)), ("y", num(py))]));
    }
    let landed = put_ashore(battle, side, px, py, load, owner);
    if hostile {
        give_way(battle, 1 - side, 0.0, date, OVERRUN_CELLS);
        redistance(battle.field.as_mut().unwrap());
    }
    Carried { landed, x: px, y: py, hostile }
}

fn effort_factor(name: &str) -> f64 {
    EFFORT_FACTORS.iter().find(|(key, _)| *key == name).map(|(_, value)| *value).unwrap_or(f64::NAN)
}

pub fn apply_order(battle: &mut Battle, run: &Run, moment: &Val, today: &OrderDay, notes: &mut Vec<Val>) {
    let mut note = Obj::new();
    note.set("battlefield", Val::Str(battle.name.clone()));
    note.set("side", Val::Str(moment.get("side").string_or_empty()));
    if !moment.get("ref").is_undef() {
        note.set("ref", moment.get("ref").clone());
    }
    let [side, member] = member_of(battle, moment.get("side"));
    if side < 0 {
        notes.push(note_of(&note, "side-not-fighting", None));
        return;
    }
    let side = side as usize;
    let by = Val::Str(battle.sides[side][member as usize].clone());
    let told = if FLANK_WORDS.contains(&fold(moment.get("order")).as_str()) { Val::str("flank") } else { moment.get("order").clone() };
    let mut word = match &told {
        Val::Str(text) if FRONT_ORDERS.contains(&text.as_str()) => text.clone(),
        _ => String::new(),
    };
    let result = match moment.get("result") {
        Val::Str(text) if FRONT_RESULTS.contains(&text.as_str()) => text.clone(),
        _ => String::new(),
    };
    if !word.is_empty() && moment.get("unbound").is_true() && (is_attack(&word) || word == "assault" || word == "land") {
        if let Some(posture) = battle.orders.iter().find(|order| is_side(&order.read("s"), side) && !order.read("chosen").truthy() && word_is(&order.read("mark"), SCENARIO_MARK)) {
            notes.push(note_of(&note, "posture-stands", Some(js::to_string(&posture.read("order")))));
            word = String::new();
        }
    }
    if word.is_empty() && result.is_empty() {
        return;
    }
    let sector = match resolve_sector(&battle.arena, today.contour, today.count, today.sectors, moment.get("sector")) {
        Some(sector) => sector,
        None => {
            notes.push(note_of(&note, "sector-read-as-all", Some(today.sectors.names.join(", "))));
            Sector::All
        }
    };
    let objective = moment.get("objective");
    let mut target = if objective.truthy() && word != "assault" { find_place(&battle.arena, objective) } else { None };
    if objective.truthy() && target.is_none() && word != "assault" {
        notes.push(note_of(&note, "objective-not-found", Some(js::to_string(objective))));
        if word == "land" {
            return;
        }
    }
    if battle.status == "standing" && (is_attack(&word) || word == "assault" || word == "land" || !result.is_empty()) {
        notes.push(note_of(&note, "not-at-war", None));
        return;
    }
    if let Val::Str(effort) = moment.get("effort") {
        if FRONT_EFFORTS.contains(&effort.as_str()) && *effort != battle.effort[side] {
            let rise = effort_factor(effort) / effort_factor(&battle.effort[side]) - 1.0;
            if rise > 0.0 {
                battle.pool[side] += rise * POOL_PER_TROOP * live_count(&battle.troops[side]) as f64 * battle.edge[side].reserves;
            }
            battle.effort[side] = effort.clone();
        }
    }
    if word == "land" {
        match &target {
            None => notes.push(note_of(&note, "objective-not-found", Some(String::new()))),
            Some(target) => land(battle, side, target, today.date, notes, &note),
        }
    } else if word == "assault" {
        let mut order = Obj::new();
        order.set("sector", Val::str("all"));
        order.set("order", Val::Str(word.clone()));
        order.set("objective", Val::Str(js::trim(&js::collapse_spaces(&objective.string_or_empty())).to_string()));
        order.set("since", Val::str(today.date));
        order.set("by", by.clone());
        order.set("age", num(0.0));
        order.set("s", num(side as f64));
        let mut order = Val::shared(order);
        if !assault(battle, Some(run), &mut order, today) {
            notes.push(note_of(&note, "objective-not-found", Some(order.read("objective").string_or_empty())));
        } else {
            let entry = order.read("entry");
            order.write("objective", entry.read("name"));
            let mut set = set_standing_order(battle, side, &order);
            set.write("entry", entry.clone());
            for troop in battle.troops[side].iter_mut() {
                if troop.order.truthy() && troop.order.get("standing").same_ref(&order) {
                    troop.order.write("standing", set.clone());
                }
            }
            let at = entry.read("name").string_or_empty();
            log(battle, today.date, "assault", side, &at);
        }
    } else if !word.is_empty() {
        let mut order = Obj::new();
        order.set("sector", Val::Str(sector_text(&sector)));
        order.set("order", Val::Str(word.clone()));
        order.set("since", Val::str(today.date));
        order.set("by", by.clone());
        order.set("age", num(0.0));
        if word_is(moment.get("mark"), SCENARIO_MARK) {
            order.set("mark", Val::str(SCENARIO_MARK));
        }
        if let Some(target) = &target {
            order.set("objective", Val::Str(place_text(target.kind, &target.name)));
        }
        if let Val::Str(effort) = moment.get("effort") {
            if FRONT_EFFORTS.contains(&effort.as_str()) {
                order.set("effort", Val::Str(effort.clone()));
            }
        }
        let mut set = set_standing_order(battle, side, &Val::Obj(order));
        assign_order(battle, run, &mut set, today, None, false);
    }
    if result.is_empty() {
        return;
    }
    if result == "captured" {
        if target.is_none() {
            let wanted = js::fold_text(&sector_text(&sector));
            let standing = battle.orders.iter().filter(|order| is_side(&order.read("s"), side) && order.read("objective").truthy() && (matches!(sector, Sector::All) || fold(&order.read("sector")) == wanted)).last().cloned();
            target = standing.and_then(|standing| find_place(&battle.arena, &standing.read("objective")));
        }
        match &target {
            None => notes.push(note_of(&note, "objective-not-found", Some("captured".to_string()))),
            Some(target) => {
                if !capture(battle, side, target, today.date) {
                    notes.push(note_of(&note, "objective-unreachable", Some(place_text(target.kind, &target.name))));
                }
            }
        }
    } else if result == "breakthrough" {
        let [x, y] = sector_middle(today.contour, today.count, &sector, |y| battle.place.km_at(y));
        let km = battle.place.km_at(y);
        for troop in battle.troops[1 - side].iter_mut() {
            let dx = troop.x - x;
            let dy = troop.y - y;
            if !is_live(troop) || (dx * dx + dy * dy).sqrt() * km > BREAKTHROUGH_KM / 2.0 {
                continue;
            }
            troop.strength *= 1.0 - BREAKTHROUGH_LOSS;
            troop.dig = 0.0;
        }
    } else if result == "repulsed" {
        repulse(battle, side, &sector, today.date);
    } else if result == "stalemate" {
        for each in [HOLDER_SIDE_A as usize, HOLDER_SIDE_B as usize] {
            if each == side && word.is_empty() {
                battle.halts.push(Val::obj([("s", num(each as f64)), ("sector", Val::Str(sector_text(&sector))), ("days", num(HALT_DAYS))]));
            } else {
                let mut order = Obj::new();
                order.set("sector", Val::Str(sector_text(&sector)));
                order.set("order", Val::str("hold"));
                order.set("since", Val::str(today.date));
                order.set("age", num(0.0));
                if each == side {
                    order.set("by", by.clone());
                }
                let mut set = set_standing_order(battle, each, &Val::Obj(order));
                assign_order(battle, run, &mut set, today, None, false);
            }
        }
        battle.orders_changed += 1.0;
    } else if result == "collapse" {
        for troop in battle.troops[side].iter_mut() {
            troop.strength *= COLLAPSE_LEFT;
            troop.dig = 0.0;
        }
        battle.pool[side] = 0.0;
        let order = Val::obj([("sector", Val::str("all")), ("order", Val::str("advance")), ("since", Val::str(today.date)), ("age", num(0.0))]);
        let mut set = set_standing_order(battle, 1 - side, &order);
        assign_order(battle, run, &mut set, today, None, false);
    } else if result == "surrender" {
        if matches!(sector, Sector::All) {
            for troop in battle.troops[side].iter_mut() {
                troop.strength = 0.0;
            }
            battle.closing = "surrender".to_string();
            return;
        }
        find_pockets(battle);
        let place_word = if matches!(sector, Sector::Place { .. }) { find_place(&battle.arena, moment.get("sector")) } else { None };
        let cell = place_word.map(|place| cell_at(battle.field.as_ref().unwrap(), place.x, place.y)).unwrap_or(-1);
        let pocket = if cell >= 0 { battle.pocket_of.as_ref().unwrap()[side][cell as usize] } else { -1 };
        if pocket < 0 {
            notes.push(note_of(&note, "no-pocket-there", Some(sector_text(&sector))));
        } else {
            surrender_pocket(battle, pocket as usize, today.date);
            redistance(battle.field.as_mut().unwrap());
            find_pockets(battle);
        }
    }
}
