use super::battle::Battle;
use super::codec::{decode_troops, Troop as Coded};
use super::constants::{COMMAND_TROOPS, FRONT_COMMANDS_MOST, FRONT_ORDERS, GENERAL_NAME_MAX, MARK_MAX, MAX_COMMANDS, MAX_ORDERS_PER_SIDE, MAX_TALK_LINES, MAX_WAY_POINTS, TALK_TEXT_MAX};
use super::js::{self, is_integer, side_index, spread, Obj, OrdMap, Val};
use super::troops::Troop;
use crate::jsmath;

const DIAGONAL: f64 = 0.7071067811865476;
const AXES: [[f64; 2]; 4] = [[0.0, -1.0], [1.0, 0.0], [DIAGONAL, -DIAGONAL], [DIAGONAL, DIAGONAL]];
const MOST: usize = MAX_COMMANDS as usize;
const FRONT_MOST: usize = FRONT_COMMANDS_MOST as usize;

fn clean(value: &Val, most: usize) -> String {
    let text = js::trim(&js::collapse_spaces(&value.string_or_empty())).to_string();
    js::trim(&js::slice_units(&text, 0, most)).to_string()
}

pub trait Commanded {
    fn x(&self) -> f64;
    fn y(&self) -> f64;
    fn strength(&self) -> f64;
    fn owner(&self) -> f64;
    fn command(&self) -> f64;
    fn set_command(&mut self, command: f64);
}

impl Commanded for Troop {
    fn x(&self) -> f64 {
        self.x
    }
    fn y(&self) -> f64 {
        self.y
    }
    fn strength(&self) -> f64 {
        self.strength
    }
    fn owner(&self) -> f64 {
        self.owner
    }
    fn command(&self) -> f64 {
        self.command
    }
    fn set_command(&mut self, command: f64) {
        self.command = command;
    }
}

#[derive(Clone, Debug)]
pub struct Fresh {
    pub x: f64,
    pub y: f64,
    pub strength: f64,
    pub owner: f64,
    pub command: f64,
}

impl Commanded for Fresh {
    fn x(&self) -> f64 {
        self.x
    }
    fn y(&self) -> f64 {
        self.y
    }
    fn strength(&self) -> f64 {
        self.strength
    }
    fn owner(&self) -> f64 {
        self.owner
    }
    fn command(&self) -> f64 {
        self.command
    }
    fn set_command(&mut self, command: f64) {
        self.command = command;
    }
}

fn live<T: Commanded>(troop: &T) -> bool {
    troop.strength() > 0.0
}

pub fn command_count(troops: f64) -> f64 {
    let mut count = 1.0;
    for limit in COMMAND_TROOPS {
        if troops >= limit {
            count += 1.0;
        }
    }
    jsmath::min(FRONT_COMMANDS_MOST, count)
}

fn share_out<T: Commanded>(troops: &mut [T], swarms: Option<&[usize]>) {
    let held = swarms.filter(|held| !held.is_empty());
    let holds = |command: f64| held.is_some_and(|held| command >= 0.0 && held.contains(&(command as usize)));
    let lined: Vec<usize> = (0..troops.len()).filter(|&index| !(held.is_some() && troops[index].command() >= 0.0 && holds(troops[index].command()))).collect();
    let mut numbers: Vec<f64> = Vec::new();
    for command in 0..MOST {
        if numbers.len() >= FRONT_MOST {
            break;
        }
        if !held.is_some_and(|held| held.contains(&command)) {
            numbers.push(command as f64);
        }
    }
    let mut owners: Vec<f64> = Vec::new();
    for &index in &lined {
        if live(&troops[index]) && !owners.contains(&troops[index].owner()) {
            owners.push(troops[index].owner());
        }
    }
    if owners.len() <= 1 {
        share_among(troops, &lined, 0.0, FRONT_COMMANDS_MOST, None, Some(&numbers));
        return;
    }
    js::sort_numbers(&mut owners);
    let mut taken: OrdMap<u64, Vec<f64>> = OrdMap::new();
    for owner in &owners {
        taken.set(owner.to_bits(), Vec::new());
    }
    for &index in &lined {
        let troop = &troops[index];
        if live(troop) && troop.command() >= 0.0 {
            let set = taken.get_mut(&troop.owner().to_bits()).unwrap();
            if !set.contains(&troop.command()) {
                set.push(troop.command());
            }
        }
    }
    let used: Vec<f64> = taken.values().flatten().copied().collect();
    let mut free: Vec<f64> = numbers.iter().copied().filter(|command| !used.contains(command)).collect();
    let count = |owner: f64| lined.iter().filter(|&&index| live(&troops[index]) && troops[index].owner() == owner).count() as f64;
    let mut waiting: Vec<f64> = owners.iter().copied().filter(|owner| taken.get(&owner.to_bits()).unwrap().is_empty()).collect();
    js::stable_sort_by(&mut waiting, |a, b| {
        let order = count(*b) - count(*a);
        if order != 0.0 {
            order
        } else {
            a - b
        }
    });
    let waiting_count = waiting.len();
    for (at, owner) in waiting.iter().enumerate() {
        let left = (waiting_count - at - 1) as f64;
        let wanted = jsmath::max(1.0, jsmath::min(command_count(count(*owner)), free.len() as f64 - left));
        let mut given = 0.0;
        while given < wanted && !free.is_empty() {
            let command = free.remove(0);
            let set = taken.get_mut(&owner.to_bits()).unwrap();
            if !set.contains(&command) {
                set.push(command);
            }
            given += 1.0;
        }
    }
    for owner in &owners {
        let mine: Vec<usize> = lined.iter().copied().filter(|&index| troops[index].owner() == *owner).collect();
        let mut commands = taken.get(&owner.to_bits()).unwrap().clone();
        js::sort_numbers(&mut commands);
        if commands.is_empty() {
            share_among(troops, &lined, 0.0, FRONT_COMMANDS_MOST, Some(&mine), Some(&numbers));
        } else {
            share_among(troops, &mine, commands[0], commands.len() as f64, None, Some(&commands));
        }
    }
}

fn share_among<T: Commanded>(troops: &mut [T], indexes: &[usize], first: f64, most: f64, only: Option<&[usize]>, listed: Option<&[f64]>) {
    let mut led = Vec::new();
    let mut loose = Vec::new();
    for &index in indexes {
        let troop = &troops[index];
        if !live(troop) {
            continue;
        }
        if troop.command() >= 0.0 {
            led.push(index);
        } else if only.is_none_or(|only| only.contains(&index)) {
            loose.push(index);
        }
    }
    if loose.is_empty() {
        return;
    }
    if led.is_empty() {
        let mut axis = 0;
        let mut widest = -1.0;
        for (at, [ax, ay]) in AXES.iter().enumerate() {
            let mut low = f64::INFINITY;
            let mut high = f64::NEG_INFINITY;
            for &index in &loose {
                let along = troops[index].x() * ax + troops[index].y() * ay;
                if along < low {
                    low = along;
                }
                if along > high {
                    high = along;
                }
            }
            if high - low > widest {
                widest = high - low;
                axis = at;
            }
        }
        let [ax, ay] = AXES[axis];
        let along = |index: usize| troops[index].x() * ax + troops[index].y() * ay;
        let count = jsmath::max(1.0, jsmath::min(most, command_count(loose.len() as f64)));
        let mut order = loose.clone();
        js::stable_sort_by(&mut order, |a, b| {
            let by = along(*a) - along(*b);
            if by != 0.0 && !by.is_nan() {
                by
            } else {
                *a as f64 - *b as f64
            }
        });
        let total = loose.len() as f64;
        for (rank, index) in order.into_iter().enumerate() {
            let place = jsmath::min(count - 1.0, ((rank as f64 * count) / total).floor());
            let command = match listed {
                Some(listed) => listed.get(place as usize).copied().unwrap_or(f64::NAN),
                None => first + place,
            };
            troops[index].set_command(command);
        }
        return;
    }
    for index in loose {
        let mut best = f64::INFINITY;
        let mut command = troops[led[0]].command();
        for &other in &led {
            let dx = troops[other].x() - troops[index].x();
            let dy = troops[other].y() - troops[index].y();
            if dx * dx + dy * dy < best {
                best = dx * dx + dy * dy;
                command = troops[other].command();
            }
        }
        troops[index].set_command(command);
    }
}

pub fn assign_commands(battle: &mut Battle) {
    for side in 0..2 {
        let swarms = battle.swarms[side].clone();
        share_out(&mut battle.troops[side], Some(&swarms));
    }
}

pub fn read_generals(value: &Val) -> [Vec<String>; 2] {
    [0, 1].map(|side| {
        let names = match value {
            Val::Arr(sides) => sides.get(side).and_then(|names| names.as_array()).cloned().unwrap_or_default(),
            _ => Vec::new(),
        };
        names.iter().take(MOST).map(|name| clean(name, GENERAL_NAME_MAX as usize)).collect()
    })
}

#[derive(Clone, Debug, PartialEq)]
pub struct Talk {
    pub who: Val,
    pub text: String,
    pub at: String,
}

fn collapse_blanks(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut gap = false;
    for unit in text.chars() {
        if unit == ' ' || unit == '\t' {
            gap = true;
            continue;
        }
        if gap {
            out.push(' ');
            gap = false;
        }
        out.push(unit);
    }
    if gap {
        out.push(' ');
    }
    out
}

pub fn talk_val(line: &Talk) -> Val {
    Val::obj([("who", line.who.clone()), ("text", Val::str(&line.text)), ("at", Val::str(&line.at))])
}

pub fn read_talk(value: &Val) -> [Vec<Talk>; 2] {
    [0, 1].map(|side| {
        let lines = match value {
            Val::Arr(sides) => sides.get(side).and_then(|lines| lines.as_array()).cloned().unwrap_or_default(),
            _ => Vec::new(),
        };
        let mut kept: Vec<Talk> = Vec::new();
        for line in &lines {
            let text = js::slice_units(js::trim(&collapse_blanks(&line.get("text").string_or_empty())), 0, TALK_TEXT_MAX as usize);
            if text.is_empty() {
                continue;
            }
            let who = line.get("who");
            let command = who.num();
            let blank = matches!(who, Val::Str(text) if text.is_empty()) || !(command.is_finite() && command.trunc() == command) || command < 0.0 || command >= MAX_COMMANDS;
            kept.push(Talk { who: if blank { Val::str("") } else { Val::Num(command) }, text, at: clean(line.get("at"), 40) });
        }
        let most = MAX_TALK_LINES as usize;
        if kept.len() > most {
            kept.split_off(kept.len() - most)
        } else {
            kept
        }
    })
}

const ORDINALS: [&str; 8] = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

pub fn command_title(command: &Val) -> String {
    let key = js::to_string(command);
    match js::array_index(&key) {
        Some(at) if (at as usize) < ORDINALS.len() => format!("{} Army", ORDINALS[at as usize]),
        _ => format!("{}th Army", js::number_to_string(command.num() + 1.0)),
    }
}

fn carry_of(record: &Val) -> Val {
    let carry = record.get("brief").get("carry");
    if carry.truthy() && carry.is_object() {
        carry.clone()
    } else {
        Val::Obj(Obj::new())
    }
}

fn swarm_commands_of(record: &Val, side: usize) -> Vec<usize> {
    let saved = carry_of(record).get("swarms").clone();
    let list = match &saved {
        Val::Arr(sides) => sides.get(side).and_then(|list| list.as_array()).cloned().unwrap_or_default(),
        _ => Vec::new(),
    };
    let mut out = Vec::new();
    for item in list {
        let command = item.num();
        if command.is_finite() && command.trunc() == command && command >= 0.0 && command < MAX_COMMANDS && !out.contains(&(command as usize)) {
            out.push(command as usize);
        }
    }
    out
}

fn saved_at(saved: &Val, side: usize, index: usize) -> Val {
    match saved.get(&side.to_string()) {
        Val::Arr(list) => list.get(index).cloned().unwrap_or(Val::Undef),
        _ => Val::Num(-1.0),
    }
}

fn decoded(record: &Val) -> [Vec<Coded>; 2] {
    [decode_troops(&record.get("troops").at(0).string_or_empty()), decode_troops(&record.get("troops").at(1).string_or_empty())]
}

fn commands_in(record: &Val, troops: &[Vec<Coded>; 2]) -> [Vec<f64>; 2] {
    let saved = carry_of(record).get("command").clone();
    [0, 1].map(|side| {
        let list = &troops[side];
        let commands: Vec<f64> = list
            .iter()
            .enumerate()
            .map(|(index, troop)| {
                let command = saved_at(&saved, side, index);
                if troop.strength > 0.0 && is_integer(&command) && command.num() >= 0.0 && command.num() < MAX_COMMANDS {
                    command.num()
                } else {
                    -1.0
                }
            })
            .collect();
        if commands.iter().any(|&command| command >= 0.0) || !list.iter().any(|troop| troop.strength > 0.0) {
            return commands;
        }
        let mut fresh: Vec<Fresh> = list.iter().map(|troop| Fresh { x: troop.x, y: troop.y, strength: troop.strength, owner: troop.owner as f64, command: -1.0 }).collect();
        let swarms = swarm_commands_of(record, side);
        share_out(&mut fresh, Some(&swarms));
        fresh.iter().map(|troop| if troop.strength > 0.0 { troop.command } else { -1.0 }).collect()
    })
}

fn under_in(record: &Val, troops: &[Vec<Coded>; 2]) -> [Vec<f64>; 2] {
    let saved = carry_of(record).get("under").clone();
    let orders = record.get("orders").length().unwrap_or(0) as f64;
    [0, 1].map(|side| {
        (0..troops[side].len())
            .map(|index| {
                let order = saved_at(&saved, side, index);
                if is_integer(&order) && order.num() >= 0.0 && order.num() < orders {
                    order.num()
                } else {
                    -1.0
                }
            })
            .collect()
    })
}

fn owner_named(record: &Val, side: usize, wanted: &str) -> f64 {
    record.get("sides").get(&side.to_string()).array_or_empty().iter().position(|name| clean(name, 120).to_lowercase() == wanted).map(|at| at as f64).unwrap_or(-1.0)
}

#[derive(Clone, Debug, PartialEq)]
pub struct General {
    pub command: f64,
    pub name: String,
    pub troops: Vec<usize>,
    pub n: f64,
    pub pct: f64,
    pub at: String,
    pub doing: String,
    pub cut: f64,
    pub dug: f64,
}

pub fn generals_of(record: &Val, side: &Val, member: &Val) -> Vec<General> {
    let side = match side_index(side) {
        Some(side) if record.truthy() && record.get("troops").as_array().is_some() => side,
        _ => return Vec::new(),
    };
    let troops = decoded(record);
    let wanted = clean(member, 120).to_lowercase();
    let owner = if wanted.is_empty() { -1.0 } else { owner_named(record, side, &wanted) };
    let commands: Vec<f64> = commands_in(record, &troops)[side].iter().enumerate().map(|(index, &command)| if owner >= 0.0 && troops[side][index].owner as f64 != owner { -1.0 } else { command }).collect();
    let names = read_generals(carry_of(record).get("generals")).clone();
    let told = record.get("brief").get("commands").get(&side.to_string()).clone();
    let mut generals: Vec<Option<General>> = Vec::new();
    for (index, &command) in commands.iter().enumerate() {
        if command < 0.0 {
            continue;
        }
        let at = command as usize;
        if generals.len() <= at {
            generals.resize(at + 1, None);
        }
        let general = generals[at].get_or_insert_with(|| General { command, name: names[side].get(at).cloned().unwrap_or_default(), troops: Vec::new(), n: 0.0, pct: 0.0, at: String::new(), doing: String::new(), cut: 0.0, dug: 0.0 });
        general.troops.push(index);
        general.n += 1.0;
        general.pct += troops[side][index].strength;
    }
    generals
        .into_iter()
        .flatten()
        .map(|mut general| {
            let brief = if told.as_array().is_some() { told.at(general.command as usize).clone() } else { Val::Undef };
            general.pct = jsmath::round(general.pct / jsmath::max(1.0, general.n));
            general.at = clean(brief.get("at"), 120);
            general.doing = clean(brief.get("doing"), 40);
            general.cut = jsmath::max(0.0, js::or_zero(brief.get("cut").num()).floor());
            general.dug = jsmath::max(0.0, js::or_zero(brief.get("dug").num()).floor());
            general
        })
        .collect()
}

pub fn command_of_troops(record: &Val, side: &Val) -> Vec<f64> {
    if !record.truthy() || record.get("troops").as_array().is_none() {
        return Vec::new();
    }
    match side_index(side) {
        Some(side) => commands_in(record, &decoded(record))[side].clone(),
        None => Vec::new(),
    }
}

fn with_carry(record: &Val, carry: Obj) -> Val {
    let mut brief = spread(record.get("brief"));
    brief.set("carry", Val::Obj(carry));
    let mut out = spread(record);
    out.set("brief", Val::Obj(brief));
    Val::Obj(out)
}

pub fn name_generals(record: &Val, side: &Val, names: &Val, replace: bool) -> Val {
    let side = match side_index(side) {
        Some(side) if record.truthy() => side,
        _ => return record.clone(),
    };
    let mut generals = read_generals(carry_of(record).get("generals"));
    let mut changed = false;
    for (command, name) in names.array_or_empty().iter().take(MOST).enumerate() {
        let next = clean(name, GENERAL_NAME_MAX as usize);
        let current = generals[side].get(command).cloned();
        if next.is_empty() || (current.as_ref().is_some_and(|known| !known.is_empty()) && !replace) || current.as_ref() == Some(&next) {
            continue;
        }
        while generals[side].len() < command {
            generals[side].push(String::new());
        }
        if command < generals[side].len() {
            generals[side][command] = next;
        } else {
            generals[side].push(next);
        }
        changed = true;
    }
    if !changed {
        return record.clone();
    }
    let mut carry = spread(&carry_of(record));
    carry.set("generals", Val::Arr(generals.iter().map(|list| Val::Arr(list.iter().map(|name| Val::str(name)).collect())).collect()));
    with_carry(record, carry)
}

fn tidy(record: &Val, orders: &[Val], under: &[Vec<f64>; 2], ages: &[Val]) -> Val {
    let mut served: Vec<f64> = Vec::new();
    for list in under {
        for &order in list {
            if order >= 0.0 && !served.contains(&order) {
                served.push(order);
            }
        }
    }
    let mut moved: Vec<Option<usize>> = vec![None; orders.len()];
    let mut kept = Vec::new();
    let mut kept_ages = Vec::new();
    for (index, order) in orders.iter().enumerate() {
        if order.get("chosen").truthy() && !served.contains(&(index as f64)) {
            continue;
        }
        moved[index] = Some(kept.len());
        kept.push(order.clone());
        kept_ages.push(match ages.get(index) {
            Some(age) if !age.is_nullish() => age.clone(),
            _ => Val::Num(0.0),
        });
    }
    let remap = |order: f64| -> Val {
        if order >= 0.0 && order.fract() == 0.0 {
            if let Some(Some(at)) = moved.get(order as usize) {
                return Val::Num(*at as f64);
            }
        }
        Val::Num(-1.0)
    };
    let mut carry = spread(&carry_of(record));
    carry.set("under", Val::Arr(under.iter().map(|list| Val::Arr(list.iter().map(|&order| remap(order)).collect())).collect()));
    carry.set("ages", Val::Arr(kept_ages));
    let mut brief = spread(record.get("brief"));
    brief.set("carry", Val::Obj(carry));
    let mut out = spread(record);
    out.set("orders", Val::Arr(kept));
    out.set("brief", Val::Obj(brief));
    Val::Obj(out)
}

fn ages_of(record: &Val, finite_only: bool) -> Vec<Val> {
    let ages = carry_of(record).get("ages").clone();
    (0..record.get("orders").length().unwrap_or(0))
        .map(|index| {
            let age = ages.element(index);
            if finite_only {
                if js::is_finite(&age) {
                    age
                } else {
                    Val::Num(0.0)
                }
            } else if age.is_nullish() {
                Val::Num(0.0)
            } else {
                age
            }
        })
        .collect()
}

pub struct OrderAsk<'a> {
    pub side: &'a Val,
    pub troops: &'a Val,
    pub order: &'a Val,
    pub objective: &'a Val,
    pub way: &'a Val,
    pub by: &'a Val,
    pub since: &'a Val,
    pub mark: &'a Val,
}

pub fn order_troops(record: &Val, ask: &OrderAsk) -> Val {
    let side = match side_index(ask.side) {
        Some(side) if record.truthy() && record.get("orders").as_array().is_some() => side,
        _ => return record.clone(),
    };
    let routed = matches!(ask.way, Val::Arr(list) if !list.is_empty());
    let word = if routed { "advance".to_string() } else { clean(ask.order, 20).to_lowercase() };
    if !FRONT_ORDERS.contains(&word.as_str()) || word == "land" || word == "assault" {
        return record.clone();
    }
    let troops = decoded(record);
    let mut wanted: Vec<usize> = Vec::new();
    for index in ask.troops.array_or_empty() {
        if let Val::Num(n) = index {
            if n.is_finite() && n.trunc() == *n && *n >= 0.0 && (*n as usize) < troops[side].len() && troops[side][*n as usize].strength > 0.0 && !wanted.contains(&(*n as usize)) {
                wanted.push(*n as usize);
            }
        }
    }
    if wanted.is_empty() {
        return record.clone();
    }
    let mut route: Vec<[f64; 2]> = Vec::new();
    for point in ask.way.array_or_empty() {
        let lng = point.element(0).num();
        let lat = point.element(1).num();
        if lng.is_finite() && lat.is_finite() {
            route.push([lng, lat]);
        }
    }
    let mut under = under_in(record, &troops);
    let mut ages = ages_of(record, true);
    let orders = record.get("orders").array_or_empty().to_vec();
    let index = orders.len() as f64;
    for &troop in &wanted {
        under[side][troop] = index;
    }
    let mut entry = Obj::new();
    entry.set("s", Val::Num(side as f64));
    entry.set("sector", Val::str("all"));
    entry.set("order", Val::str(if route.is_empty() { &word } else { "advance" }));
    entry.set("since", Val::str(&clean(ask.since, 40)));
    entry.set("chosen", Val::Bool(true));
    let named = clean(ask.objective, 120);
    if !named.is_empty() && route.is_empty() {
        entry.set("objective", Val::str(&named));
    }
    let giver = clean(ask.by, 120);
    if !giver.is_empty() {
        entry.set("by", Val::str(&giver));
    }
    let written = clean(ask.mark, MARK_MAX as usize);
    if !written.is_empty() {
        entry.set("mark", Val::str(&written));
    }
    if !route.is_empty() {
        entry.set("way", Val::Arr(thin_route(&route, MAX_WAY_POINTS as usize).iter().map(|point| Val::nums(point)).collect()));
    }
    let mut all = orders;
    all.push(Val::Obj(entry));
    ages.push(Val::Num(0.0));
    let next = tidy(record, &all, &under, &ages);
    let count = next.get("orders").array_or_empty().iter().filter(|standing| js::strict_equals(standing.get("s"), &Val::Num(side as f64))).count();
    if count as f64 > MAX_ORDERS_PER_SIDE {
        return record.clone();
    }
    next
}

pub fn release_troops(record: &Val, side: &Val, troops_asked: &Val) -> Val {
    let side = match side_index(side) {
        Some(side) if record.truthy() && record.get("orders").as_array().is_some() => side,
        _ => return record.clone(),
    };
    let troops = decoded(record);
    let mut under = under_in(record, &troops);
    let orders = record.get("orders").array_or_empty().to_vec();
    let mut changed = false;
    for troop in troops_asked.array_or_empty() {
        let at = match troop {
            Val::Num(n) if n.is_finite() && n.trunc() == *n && *n >= 0.0 && (*n as usize) < under[side].len() => *n as usize,
            _ => continue,
        };
        let order = under[side][at];
        if order < 0.0 || !orders[order as usize].get("chosen").truthy() {
            continue;
        }
        under[side][at] = -1.0;
        changed = true;
    }
    if !changed {
        return record.clone();
    }
    tidy(record, &orders, &under, &ages_of(record, false))
}

pub fn return_troops(record: &Val, side: &Val, by: &Val, since: &Val) -> Val {
    let side = match side_index(side) {
        Some(side) if record.truthy() && record.get("orders").as_array().is_some() => side,
        _ => return record.clone(),
    };
    let leaving = |order: &Val| js::strict_equals(order.get("s"), &Val::Num(side as f64)) && !order.get("chosen").truthy() && matches!(order.get("order"), Val::Str(word) if word == "withdraw");
    let all = record.get("orders").array_or_empty().to_vec();
    if !carry_of(record).get("away").get(&side.to_string()).is_true() && !all.iter().any(&leaving) {
        return record.clone();
    }
    let troops = decoded(record);
    let under = under_in(record, &troops);
    let ages = ages_of(record, false);
    let mut moved: Vec<Option<usize>> = vec![None; all.len()];
    let mut orders = Vec::new();
    let mut kept_ages = Vec::new();
    for (index, order) in all.iter().enumerate() {
        if leaving(order) {
            continue;
        }
        moved[index] = Some(orders.len());
        orders.push(order.clone());
        kept_ages.push(ages[index].clone());
    }
    let mut entry = Obj::new();
    entry.set("s", Val::Num(side as f64));
    entry.set("sector", Val::str("all"));
    entry.set("order", Val::str("hold"));
    entry.set("since", Val::str(&clean(since, 40)));
    let giver = clean(by, 120);
    if !giver.is_empty() {
        entry.set("by", Val::str(&giver));
    }
    orders.push(Val::Obj(entry));
    kept_ages.push(Val::Num(0.0));
    let remapped = [0, 1].map(|side| under[side].iter().map(|&order| if order >= 0.0 { moved.get(order as usize).copied().flatten().map(|at| at as f64).unwrap_or(-1.0) } else { -1.0 }).collect());
    tidy(record, &orders, &remapped, &kept_ages)
}

pub fn own_troops_of(record: &Val, side: &Val, member: &Val) -> Vec<usize> {
    let side = match side_index(side) {
        Some(side) if record.truthy() && record.get("troops").as_array().is_some() => side,
        _ => return Vec::new(),
    };
    let wanted = clean(member, 120).to_lowercase();
    let owner = owner_named(record, side, &wanted);
    decode_troops(&record.get("troops").at(side).string_or_empty())
        .iter()
        .enumerate()
        .filter(|(_, troop)| troop.strength > 0.0 && (owner < 0.0 || troop.owner as f64 == owner))
        .map(|(index, _)| index)
        .collect()
}

#[derive(Clone, Debug, PartialEq)]
pub struct Chosen {
    pub index: usize,
    pub order: Val,
    pub objective: Val,
    pub way: Val,
    pub troops: Vec<usize>,
    pub by: Val,
    pub mark: Val,
}

fn or_default(value: &Val, fallback: Val) -> Val {
    if value.is_nullish() {
        fallback
    } else {
        value.clone()
    }
}

pub fn chosen_orders_of(record: &Val, side: &Val) -> Vec<Chosen> {
    if !record.truthy() || record.get("orders").as_array().is_none() {
        return Vec::new();
    }
    let at = match side_index(side) {
        Some(at) => at,
        None => return Vec::new(),
    };
    let troops = decoded(record);
    let under = under_in(record, &troops)[at].clone();
    let mut found = Vec::new();
    for (index, order) in record.get("orders").array_or_empty().iter().enumerate() {
        if !order.get("chosen").truthy() || !js::strict_equals(order.get("s"), side) {
            continue;
        }
        let serving: Vec<usize> = under.iter().enumerate().filter(|(troop, &serves)| serves == index as f64 && troops[at][*troop].strength > 0.0).map(|(troop, _)| troop).collect();
        if !serving.is_empty() {
            found.push(Chosen {
                index,
                order: order.get("order").clone(),
                objective: or_default(order.get("objective"), Val::str("")),
                way: or_default(order.get("way"), Val::Null),
                troops: serving,
                by: or_default(order.get("by"), Val::str("")),
                mark: or_default(order.get("mark"), Val::str("")),
            });
        }
    }
    found
}

pub fn release_marked<F: FnMut(&Val) -> bool>(record: &Val, side: &Val, mut gone: F) -> Val {
    let mut troops = Vec::new();
    for order in chosen_orders_of(record, side) {
        if order.mark.truthy() && gone(&order.mark) {
            troops.extend(order.troops.iter().map(|&troop| Val::Num(troop as f64)));
        }
    }
    if troops.is_empty() {
        record.clone()
    } else {
        release_troops(record, side, &Val::Arr(troops))
    }
}

pub fn talk_of(record: &Val, side: &Val) -> Vec<Talk> {
    match side_index(side) {
        Some(side) => read_talk(carry_of(record).get("talk"))[side].clone(),
        None => Vec::new(),
    }
}

pub fn with_talk(record: &Val, side: &Val, lines: &Val) -> Val {
    let side = match (side_index(side), lines) {
        (Some(side), Val::Arr(list)) if record.truthy() && !list.is_empty() => side,
        _ => return record.clone(),
    };
    let mut talk = read_talk(carry_of(record).get("talk"));
    let mut joined: Vec<Val> = talk[side].iter().map(talk_val).collect();
    joined.extend(lines.array_or_empty().iter().cloned());
    let both = if side == 0 { Val::Arr(vec![Val::Arr(joined), Val::Arr(Vec::new())]) } else { Val::Arr(vec![Val::Arr(Vec::new()), Val::Arr(joined)]) };
    talk[side] = read_talk(&both)[side].clone();
    let mut carry = spread(&carry_of(record));
    carry.set("talk", Val::Arr(talk.iter().map(|lines| Val::Arr(lines.iter().map(talk_val).collect())).collect()));
    with_carry(record, carry)
}

pub fn nearest_on_route(points: &[[f64; 2]], x: f64, y: f64) -> (usize, f64) {
    let mut best = f64::INFINITY;
    let mut at = 0;
    let mut part = 0.0;
    for index in 0..points.len().saturating_sub(1) {
        let [ax, ay] = points[index];
        let dx = points[index + 1][0] - ax;
        let dy = points[index + 1][1] - ay;
        let length = dx * dx + dy * dy;
        let along = if length > 0.0 { jsmath::max(0.0, jsmath::min(1.0, ((x - ax) * dx + (y - ay) * dy) / length)) } else { 0.0 };
        let off = (x - ax - dx * along) * (x - ax - dx * along) + (y - ay - dy * along) * (y - ay - dy * along);
        if off < best {
            best = off;
            at = index;
            part = along;
        }
    }
    (at, part)
}

pub fn route_ahead(points: &[[f64; 2]], x: f64, y: f64) -> Vec<[f64; 2]> {
    if points.len() <= 1 {
        return points.to_vec();
    }
    let (at, part) = nearest_on_route(points, x, y);
    if at == 0 && part == 0.0 {
        points.to_vec()
    } else {
        points[at + 1..].to_vec()
    }
}

pub fn thin_route(points: &[[f64; 2]], most: usize) -> Vec<[f64; 2]> {
    if points.len() <= 2 {
        return points.to_vec();
    }
    let mut kept = vec![0usize, points.len() - 1];
    while kept.len() < most {
        let mut worst = 0.0;
        let mut at: i64 = -1;
        for span in 0..kept.len() - 1 {
            let [ax, ay] = points[kept[span]];
            let [bx, by] = points[kept[span + 1]];
            let length = ((bx - ax) * (bx - ax) + (by - ay) * (by - ay)).sqrt();
            for index in kept[span] + 1..kept[span + 1] {
                let [px, py] = points[index];
                let off = if length > 0.0 { ((px - ax) * (by - ay) - (py - ay) * (bx - ax)).abs() / length } else { ((px - ax) * (px - ax) + (py - ay) * (py - ay)).sqrt() };
                if off > worst {
                    worst = off;
                    at = index as i64;
                }
            }
        }
        if at < 0 || worst < 0.01 {
            break;
        }
        kept.push(at as usize);
        kept.sort();
    }
    kept.iter().map(|&index| points[index]).collect()
}
