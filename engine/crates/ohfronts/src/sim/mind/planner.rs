use super::troops::{troop_view, Row, View, BREACH, DIG_IN, HOLD, PUSH, REST, TAKE_CAPITAL, TAKE_CITY, TROOP_ACTIONS, TROOP_FEATURE_COUNT};
use crate::jsmath;
use crate::sim::air::{air_mission_of, AIR_MISSIONS};
use crate::sim::battle::Battle;
use crate::sim::engine::{Asked, Body, Own, Run, Said, StaffHook};
use crate::sim::front_run::{rehearsal, rehearse_day, rehearse_orders};
use crate::sim::js::{self, Val};
use crate::sim::troops::{is_live, Troop};
use std::collections::HashMap;

pub const EVAL_NAMES: [&str; 8] = ["ground", "towns", "capitals", "strength", "cut off", "wear", "supply", "in its works"];
pub const DEFAULT_EVAL: [f64; 8] = [0.25, 4.0, 15.0, 1.0, 1.5, -1.0, 1.0, 0.3];
pub const EXTRA_NAMES: [&str; 6] = ["nearest enemy: how far", "nearest enemy: dug in", "nearest enemy: strength", "nearest enemy: under way", "nearest enemy: cut off", "how nearly it is surrounded"];
pub const NET_FEATURES: usize = TROOP_FEATURE_COUNT + EXTRA_NAMES.len();
pub const PLAN_NAMES: [&str; 13] = ["keep", "net", "net, digging in", "net, resting the worn", "push", "dig in", "the weakest place", "the second weakest place", "the third weakest place", "a pincer", "the towns", "everyone on the weakest place", "the walls"];
pub const LATE_EVAL_NAMES: [&str; 1] = ["nearly cut off"];
pub const LATE_EVAL: [f64; 1] = [0.0];
pub const NET_AT: usize = EVAL_NAMES.len();
pub const LATE_AT: usize = NET_AT + TROOP_ACTIONS.len() * (NET_FEATURES + 1);
pub const PLAN_PARAMS: usize = LATE_AT + LATE_EVAL_NAMES.len();
pub const LOOK_DAYS: f64 = 5.0;
pub const AHEAD_DAYS: f64 = 6.0;
pub const BODIES_MOST: usize = 12;
pub const REFINE_BODIES: usize = 4;
pub const PLAINER_PLANS: [usize; 3] = [0, 4, 5];
pub const REPLIES: [&str; 3] = ["carry on", "push", "dig in"];
const WORN: f64 = 0.5;
const SURROUND_KM: f64 = 30.0;
const FAR_KM: f64 = 150.0;
const COMPASS: [[f64; 2]; 8] = [[1.0, 0.0], [0.7071, 0.7071], [0.0, 1.0], [-0.7071, 0.7071], [-1.0, 0.0], [-0.7071, -0.7071], [0.0, -1.0], [0.7071, -0.7071]];

pub fn with_late_eval(given: &[f64]) -> Vec<f64> {
    let mut params = vec![0.0; PLAN_PARAMS];
    for (at, value) in LATE_EVAL.iter().enumerate() {
        params[LATE_AT + at] = *value;
    }
    for at in 0..given.len().min(PLAN_PARAMS) {
        params[at] = js::or_zero(given[at]);
    }
    params
}

pub fn plain_planner() -> Vec<f64> {
    let mut params = vec![0.0; PLAN_PARAMS];
    params[..DEFAULT_EVAL.len()].copy_from_slice(&DEFAULT_EVAL);
    for (at, value) in LATE_EVAL.iter().enumerate() {
        params[LATE_AT + at] = *value;
    }
    params[NET_AT + HOLD * (NET_FEATURES + 1) + NET_FEATURES] = 0.1;
    params
}

fn within(value: f64, least: f64, most: f64) -> f64 {
    if value < least {
        least
    } else if value > most {
        most
    } else {
        value
    }
}

fn km_from(battle: &Battle, ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let km = battle.place.km_at((ay + by) / 2.0);
    let dx = (ax - bx) * km;
    let dy = (ay - by) * km;
    (dx * dx + dy * dy).sqrt()
}

fn theirs_round(battle: &Battle, side: usize, troop: &Troop) -> usize {
    let field = battle.field.as_ref().unwrap();
    let reach = SURROUND_KM / battle.place.km_at(troop.y);
    let mut theirs = 0;
    for [cx, cy] in COMPASS {
        let x = (troop.x + cx * reach).floor();
        let y = (troop.y + cy * reach).floor();
        if x < 0.0 || y < 0.0 || x >= field.cols as f64 || y >= field.rows as f64 {
            continue;
        }
        if field.holders[y as usize * field.cols + x as usize] as usize == 1 - side {
            theirs += 1;
        }
    }
    theirs
}

fn extra_of(battle: &Battle, side: usize, troop: &Troop) -> [f64; 6] {
    let mut nearest: Option<&Troop> = None;
    let mut best = f64::INFINITY;
    for enemy in &battle.troops[1 - side] {
        if !is_live(enemy) {
            continue;
        }
        let far = km_from(battle, enemy.x, enemy.y, troop.x, troop.y);
        if far < best {
            best = far;
            nearest = Some(enemy);
        }
    }
    let mut out = [0.0; 6];
    out[0] = if nearest.is_some() { within(best / FAR_KM, 0.0, 1.0) } else { 1.0 };
    out[1] = if nearest.is_some_and(|enemy| enemy.dug) { 1.0 } else { 0.0 };
    out[2] = nearest.map_or(0.0, |enemy| within(enemy.strength / 100.0, 0.0, 1.5));
    out[3] = if nearest.is_some_and(|enemy| enemy.order.truthy() && !enemy.order.read("done").truthy()) { 1.0 } else { 0.0 };
    out[4] = if nearest.is_some_and(|enemy| enemy.pocket) { 1.0 } else { 0.0 };
    out[5] = theirs_round(battle, side, troop) as f64 / COMPASS.len() as f64;
    out
}

pub fn planner_features(battle: &Battle, side: usize, view: &View) -> Vec<Vec<f64>> {
    view.rows
        .iter()
        .map(|row| {
            let mut out = vec![0.0; NET_FEATURES];
            out[..row.t.len()].copy_from_slice(&row.t);
            out[TROOP_FEATURE_COUNT..].copy_from_slice(&extra_of(battle, side, &battle.troops[side][row.index]));
            out
        })
        .collect()
}

fn net_choice(params: &[f64], features: &[f64], valid: &[bool]) -> usize {
    let width = NET_FEATURES + 1;
    let mut chosen = HOLD;
    let mut most = f64::NEG_INFINITY;
    for action in 0..TROOP_ACTIONS.len() {
        if !valid[action] {
            continue;
        }
        let at = NET_AT + action * width;
        let mut sum = params[at + NET_FEATURES];
        for feature in 0..NET_FEATURES {
            sum += params[at + feature] * features[feature];
        }
        if sum > most {
            most = sum;
            chosen = action;
        }
    }
    chosen
}

fn key_of(row: &Row, action: usize) -> String {
    match action {
        HOLD => "hold".to_string(),
        DIG_IN => "dig in".to_string(),
        PUSH => "push".to_string(),
        REST => "rest".to_string(),
        _ if row.goal[action].is_empty() => "hold".to_string(),
        _ => row.goal[action].clone(),
    }
}

fn bodies_of(battle: &Battle, view: &View, keys: &[String]) -> Vec<Body> {
    let mut bodies: Vec<(String, Vec<usize>)> = Vec::new();
    for (at, row) in view.rows.iter().enumerate() {
        let key = &keys[at];
        match bodies.iter_mut().find(|(name, _)| name == key) {
            Some((_, picked)) => picked.push(row.index),
            None => bodies.push((key.clone(), vec![row.index])),
        }
    }
    let mut sent: Vec<(String, usize)> = bodies.iter().filter(|(key, _)| key != "hold" && key != "dig in").map(|(key, picked)| (key.clone(), picked.len())).collect();
    js::stable_sort_by(&mut sent, |a, b| {
        let by = b.1 as f64 - a.1 as f64;
        if by != 0.0 {
            by
        } else {
            match js::compare_units(&a.0, &b.0) {
                std::cmp::Ordering::Less => -1.0,
                std::cmp::Ordering::Greater => 1.0,
                std::cmp::Ordering::Equal => 0.0,
            }
        }
    });
    for (key, _) in sent.iter().skip(BODIES_MOST) {
        if !bodies.iter().any(|(name, _)| name == "hold") {
            bodies.push(("hold".to_string(), Vec::new()));
        }
        let moved = bodies.iter().find(|(name, _)| name == key).map(|(_, picked)| picked.clone()).unwrap_or_default();
        bodies.iter_mut().find(|(name, _)| name == "hold").unwrap().1.extend(moved);
        bodies.retain(|(name, _)| name != key);
    }
    let mut out = Vec::new();
    for (key, picked) in bodies {
        let mut sorted = picked;
        sorted.sort();
        if key == "hold" || key == "dig in" {
            out.push(Body { order: key, picked: sorted, way: None });
        } else if key == "push" {
            out.push(Body { order: "advance".to_string(), picked: sorted, way: None });
        } else if key == "rest" {
            out.push(Body { order: "rest".to_string(), picked: sorted, way: None });
        } else {
            let way: Vec<[f64; 2]> = view
                .places
                .get(&key)
                .map(|way| {
                    way.iter()
                        .map(|&[x, y]| {
                            let [lng, lat] = battle.place.to_lng_lat(x, y);
                            [jsmath::round(lng * 10000.0) / 10000.0, jsmath::round(lat * 10000.0) / 10000.0]
                        })
                        .collect()
                })
                .unwrap_or_default();
            if !way.is_empty() {
                out.push(Body { order: "advance".to_string(), picked: sorted, way: Some(way) });
            }
        }
    }
    out
}

fn aim_of(bodies: &[Body]) -> Option<[f64; 2]> {
    let mut best: Option<&Body> = None;
    for body in bodies {
        if body.order == "advance" && body.way.as_ref().is_some_and(|way| !way.is_empty()) && best.is_none_or(|best| body.picked.len() > best.picked.len()) {
            best = Some(body);
        }
    }
    best.map(|body| *body.way.as_ref().unwrap().last().unwrap())
}

enum Going<'a> {
    To(&'a str),
    By(&'a dyn Fn(&Troop) -> String),
}

fn nearest_half(battle: &Battle, view: &View, troops: &[&Troop], key: Going, target: [f64; 2], share: f64, may: &dyn Fn(&Row) -> bool) -> Option<Vec<String>> {
    let rows = &view.rows;
    let mut ranked: Vec<(usize, f64)> = rows.iter().enumerate().map(|(at, row)| (at, if may(row) { km_from(battle, troops[at].x, troops[at].y, target[0], target[1]) } else { f64::INFINITY })).filter(|entry| entry.1 < f64::INFINITY).collect();
    js::stable_sort_by(&mut ranked, |a, b| {
        let by = a.1 - b.1;
        if by != 0.0 {
            by
        } else {
            a.0 as f64 - b.0 as f64
        }
    });
    if ranked.is_empty() {
        return None;
    }
    let most = jsmath::max(1.0, (rows.len() as f64 * share).ceil()) as usize;
    let going: Vec<usize> = ranked.iter().take(most).map(|entry| entry.0).collect();
    Some(
        rows.iter()
            .enumerate()
            .map(|(at, _)| {
                if going.contains(&at) {
                    match &key {
                        Going::To(key) => key.to_string(),
                        Going::By(key) => key(troops[at]),
                    }
                } else {
                    "dig in".to_string()
                }
            })
            .collect(),
    )
}

fn draw_plans(battle: &Battle, side: usize, params: &[f64], view: &View, features: &[Vec<f64>]) -> Vec<Option<Vec<String>>> {
    let rows = &view.rows;
    let troops: Vec<&Troop> = rows.iter().map(|row| &battle.troops[side][row.index]).collect();
    let net: Vec<usize> = rows.iter().enumerate().map(|(at, row)| net_choice(params, &features[at], &row.valid)).collect();
    let free = |row: &Row| row.valid[PUSH];
    let first = |key: &str| view.places.get(&key.to_string()).and_then(|way| way.first().copied());
    let strike = |at: usize| {
        let key = format!("strike {at}");
        first(&key).and_then(|target| nearest_half(battle, view, &troops, Going::To(&key), target, 0.5, &free))
    };
    let left = view.places.get(&"round 0 1".to_string());
    let right = view.places.get(&"round 0 -1".to_string());
    let pincer = match (left, right) {
        (Some(left), Some(right)) => {
            let a = left[0];
            let b = right[0];
            let arm = move |troop: &Troop| if km_from(battle, troop.x, troop.y, a[0], a[1]) <= km_from(battle, troop.x, troop.y, b[0], b[1]) { "round 0 1".to_string() } else { "round 0 -1".to_string() };
            nearest_half(battle, view, &troops, Going::By(&arm), left[left.len() - 1], 0.5, &free)
        }
        _ => None,
    };
    let everyone = first("strike 0").and_then(|target| nearest_half(battle, view, &troops, Going::To("strike 0"), target, 1.0, &free));
    vec![
        Some(net.iter().enumerate().map(|(at, &action)| key_of(&rows[at], action)).collect()),
        Some(net.iter().enumerate().map(|(at, &action)| key_of(&rows[at], if action == HOLD { DIG_IN } else { action })).collect()),
        Some(net.iter().enumerate().map(|(at, &action)| key_of(&rows[at], if rows[at].t[28] > WORN && rows[at].valid[REST] { REST } else { action })).collect()),
        Some(rows.iter().map(|row| if free(row) { "push".to_string() } else { "dig in".to_string() }).collect()),
        Some(rows.iter().map(|_| "dig in".to_string()).collect()),
        strike(0),
        strike(1),
        strike(2),
        pincer,
        Some(rows.iter().map(|row| if row.valid[TAKE_CAPITAL] && row.t[18] < 0.5 { row.goal[TAKE_CAPITAL].clone() } else if row.valid[TAKE_CITY] && row.t[15] < 0.5 { row.goal[TAKE_CITY].clone() } else { "dig in".to_string() }).collect()),
        everyone,
        if rows.iter().any(|row| row.valid[BREACH]) { Some(rows.iter().map(|row| if row.valid[BREACH] { row.goal[BREACH].clone() } else { "dig in".to_string() }).collect()) } else { None },
    ]
}

fn turned(bodies: &[Body], at: usize) -> Option<Vec<Body>> {
    let body = &bodies[at];
    let other = if body.order == "advance" {
        Body { order: "dig in".to_string(), picked: body.picked.clone(), way: None }
    } else if body.order == "dig in" || body.order == "hold" {
        Body { order: "advance".to_string(), picked: body.picked.clone(), way: None }
    } else {
        return None;
    };
    Some(bodies.iter().enumerate().map(|(index, each)| if index == at { other.clone() } else { each.clone() }).collect())
}

pub fn standing(battle: &Battle, side: usize) -> [f64; 8] {
    let field = battle.field.as_ref().unwrap();
    let mut out = [0.0; 8];
    if let Some(lawful) = &battle.home_side {
        let region = &battle.arena.region;
        let home_at = |cell: usize| lawful[region[cell] as usize] as i32;
        let mut areas = vec![0.0; field.rows];
        for (row, area) in areas.iter_mut().enumerate() {
            let km = battle.place.km_at(row as f64 + 0.5);
            *area = km * km;
        }
        let mut ground = 0.0;
        for cell in 0..field.size {
            let home = home_at(cell);
            if home != 0 && home != 1 {
                continue;
            }
            let holder = field.holders[cell] as i32;
            if holder == home {
                continue;
            }
            let area = areas[cell / field.cols];
            ground += if holder == side as i32 { area } else if home == side as i32 { -area } else { 0.0 };
        }
        out[0] = ground / 1000.0;
        for city in &battle.arena.cities {
            let cell = city.y.floor() * field.cols as f64 + city.x.floor();
            if !(cell >= 0.0 && cell < field.size as f64) {
                continue;
            }
            let cell = cell as usize;
            let home = home_at(cell);
            let holder = field.holders[cell] as i32;
            if (home != 0 && home != 1) || holder == home {
                continue;
            }
            let sign = if holder == side as i32 { 1.0 } else if home == side as i32 { -1.0 } else { 0.0 };
            if city.capital {
                out[2] += sign;
            } else {
                out[1] += sign * if js::or_zero(city.population) >= 100000.0 { 1.5 } else { 1.0 };
            }
        }
    }
    for (who, sign) in [(side, 1.0), (1 - side, -1.0)] {
        let mut live = 0.0;
        let mut strength = 0.0;
        let mut cut = 0.0;
        let mut worn = 0.0;
        let mut fed = 0.0;
        let mut dug = 0.0;
        for troop in &battle.troops[who] {
            if !is_live(troop) {
                continue;
            }
            live += 1.0;
            strength += troop.strength / 100.0;
            if troop.pocket {
                cut += troop.strength / 100.0;
            }
            worn += js::or_zero(troop.fatigue);
            fed += troop.supply;
            if troop.dug {
                dug += 1.0;
            }
        }
        out[3] += sign * strength;
        out[4] -= sign * cut;
        if live > 0.0 {
            out[5] += sign * (worn / live);
            out[6] += sign * (fed / live);
            out[7] += sign * (dug / live);
        }
    }
    out
}

fn nearly_surrounded(battle: &Battle, side: usize) -> f64 {
    let mut sum = 0.0;
    for troop in &battle.troops[side] {
        if !is_live(troop) || troop.pocket {
            continue;
        }
        let theirs = theirs_round(battle, side, troop);
        if theirs > 4 {
            sum += (troop.strength / 100.0) * ((theirs as f64 - 4.0) / 4.0);
        }
    }
    sum
}

pub fn value_features(battle: &Battle, side: usize) -> Vec<f64> {
    let mut out = standing(battle, side).to_vec();
    out.push(nearly_surrounded(battle, 1 - side) - nearly_surrounded(battle, side));
    out
}

pub fn value_of(params: &[f64], battle: &Battle, side: usize) -> f64 {
    let seen = standing(battle, side);
    let mut value = 0.0;
    for at in 0..EVAL_NAMES.len() {
        value += params[at] * seen[at];
    }
    let late = if params.len() > LATE_AT { params[LATE_AT] } else { LATE_EVAL[0] };
    if late != 0.0 {
        value += late * (nearly_surrounded(battle, 1 - side) - nearly_surrounded(battle, side));
    }
    value
}

#[derive(Clone)]
pub struct Look {
    pub side: usize,
    pub day: f64,
    pub ahead: f64,
    pub params: Vec<f64>,
    pub answers: Vec<Option<Vec<Body>>>,
}

#[derive(Clone)]
pub struct Job {
    pub bodies: Option<Vec<Body>>,
    pub air: Option<String>,
}

pub fn weigh_steps(run: &Run, battle: &mut Battle, look: &Look, job: &Job) -> f64 {
    let mut worst = f64::INFINITY;
    for answer in &look.answers {
        let mut stub = rehearsal(run, battle);
        if job.bodies.is_some() || job.air.is_some() {
            rehearse_orders(&mut stub, look.side, job.bodies.as_deref().unwrap_or(&[]), look.day, job.air.as_deref());
        }
        if let Some(answer) = answer {
            rehearse_orders(&mut stub, 1 - look.side, answer, look.day, None);
        }
        let mut days = 0.0;
        while days < look.ahead {
            if !rehearse_day(&mut stub, look.day + days, days > 0.0) {
                break;
            }
            days += 1.0;
        }
        let value = value_of(&look.params, &stub.battles[0], look.side);
        if value < worst {
            worst = value;
        }
    }
    worst
}

fn stir(hash: u32, value: f64) -> u32 {
    let value = if value.is_nan() { 0.0 } else { value };
    ((hash as i32) ^ js::to_int32(jsmath::round(value * 4096.0))).wrapping_mul(16777619) as u32
}

fn stir_val(hash: u32, value: &Val) -> u32 {
    stir(hash, js::to_number(value))
}

fn stir_word(hash: u32, word: &Val) -> u32 {
    let mut out = hash;
    if let Val::Str(text) = word {
        for unit in text.encode_utf16() {
            out = ((out as i32) ^ unit as i32).wrapping_mul(16777619) as u32;
        }
    }
    ((out as i32) ^ 255).wrapping_mul(16777619) as u32
}

pub fn battle_print(battle: &Battle) -> String {
    let mut hash = stir(stir(2166136261, battle.days_run), battle.orders.len() as f64);
    for list in &battle.troops {
        hash = stir(hash, list.len() as f64);
        for troop in list {
            hash = stir(stir(stir(stir(hash, troop.x), troop.y), troop.strength), troop.dig);
            hash = stir(stir(stir(stir(hash, troop.state), troop.hx), troop.hy), troop.fatigue);
            hash = stir(stir(hash, if troop.dug { 1.0 } else { 0.0 }), troop.serves);
            let order = &troop.order;
            hash = if order.truthy() && !order.read("done").truthy() { stir_val(stir_val(stir_word(stir_word(hash, &order.read("kind")), &order.read("word")), &order.read("leg")), &order.read("since")) } else { stir(hash, -1.0) };
        }
    }
    if let Some(field) = &battle.field {
        for &holder in &field.holders {
            hash = ((hash as i32) ^ holder as i32).wrapping_mul(16777619) as u32;
        }
    }
    js::integer_radix(hash as f64, 36)
}

pub fn said_of(job: &Job) -> String {
    let mut out = job.air.clone().unwrap_or_default();
    out.push('|');
    match &job.bodies {
        None => out.push_str("carry on"),
        Some(bodies) => {
            for body in bodies {
                out.push_str(&body.order);
                out.push(':');
                for index in &body.picked {
                    out.push_str(&index.to_string());
                    out.push(',');
                }
                if let Some(way) = &body.way {
                    out.push('@');
                    for [lng, lat] in way {
                        out.push_str(&js::number_to_string(*lng));
                        out.push(' ');
                        out.push_str(&js::number_to_string(*lat));
                        out.push(';');
                    }
                }
                out.push('/');
            }
        }
    }
    out
}

pub type Weigher = dyn Fn(&Run, &mut Battle, &Look, &[Job]) -> Vec<f64>;

pub fn weigh_one_by_one(run: &Run, battle: &mut Battle, look: &Look, jobs: &[Job]) -> Vec<f64> {
    jobs.iter().map(|job| weigh_steps(run, battle, look, job)).collect()
}

pub struct Planner {
    pub params: Vec<f64>,
    pub look: f64,
    pub ahead: f64,
    pub allowed: Option<Vec<String>>,
    pub refine: usize,
    pub replies: bool,
    pub air_control: bool,
    pub together: Option<Box<Weigher>>,
}

#[derive(Default)]
pub struct PlannerOptions {
    pub params: Option<Vec<f64>>,
    pub look: Option<f64>,
    pub ahead: Option<f64>,
    pub plans: Option<Vec<String>>,
    pub refine: Option<f64>,
    pub replies: bool,
    pub air_control: Option<bool>,
    pub late: Option<Vec<f64>>,
}

pub fn create_planner(options: PlannerOptions) -> Planner {
    let mut params = with_late_eval(&options.params.unwrap_or_else(plain_planner));
    if let Some(late) = &options.late {
        for (at, value) in late.iter().enumerate() {
            if LATE_AT + at < params.len() {
                params[LATE_AT + at] = js::or_zero(*value);
            }
        }
    }
    Planner {
        params,
        look: options.look.unwrap_or(LOOK_DAYS),
        ahead: options.ahead.unwrap_or(AHEAD_DAYS),
        allowed: options.plans,
        refine: options.refine.map_or(REFINE_BODIES, |refine| if refine > 0.0 { refine.trunc() as usize } else { 0 }),
        replies: options.replies,
        air_control: options.air_control.unwrap_or(true),
        together: None,
    }
}

pub fn create_plainer_planner(mut extra: PlannerOptions) -> Planner {
    extra.params = extra.params.or_else(|| Some(plain_planner()));
    extra.look = extra.look.or(Some(12.0));
    extra.ahead = extra.ahead.or(Some(2.0));
    extra.refine = extra.refine.or(Some(0.0));
    extra.air_control = extra.air_control.or(Some(false));
    extra.plans = extra.plans.or_else(|| Some(PLAINER_PLANS.iter().map(|&at| PLAN_NAMES[at].to_string()).collect()));
    create_planner(extra)
}

struct Weighed {
    values: HashMap<String, f64>,
}

impl Planner {
    fn weigh_together(&self, run: &Run, battle: &mut Battle, look: &Look, weighed: &mut Weighed, list: Vec<Job>) {
        let Some(together) = &self.together else { return };
        let mut jobs = Vec::new();
        let mut saids: Vec<String> = Vec::new();
        for job in list {
            let said = said_of(&job);
            if weighed.values.contains_key(&said) || saids.contains(&said) {
                continue;
            }
            saids.push(said);
            jobs.push(job);
        }
        if jobs.len() < 2 {
            return;
        }
        let values = together(run, battle, look, &jobs);
        for (said, value) in saids.into_iter().zip(values) {
            weighed.values.insert(said, value);
        }
    }

    fn weigh(&self, run: &Run, battle: &mut Battle, look: &Look, weighed: &mut Weighed, job: Job) -> f64 {
        let said = said_of(&job);
        if let Some(value) = weighed.values.get(&said) {
            return *value;
        }
        let worst = weigh_steps(run, battle, look, &job);
        weighed.values.insert(said, worst);
        worst
    }

    pub fn think(&self, run: &Run, battle: &mut Battle, side: usize, at: usize) -> Own {
        if battle.days_run > 0.0 && battle.days_run % self.look != 0.0 {
            return Own { keep: true, ..Own::default() };
        }
        let view = troop_view(run, battle, side);
        if view.rows.is_empty() {
            return Own { keep: true, ..Own::default() };
        }
        let features = planner_features(battle, side, &view);
        let drawn = draw_plans(battle, side, &self.params, &view, &features);
        let day = run.day + 1.0;
        let theirs: Vec<usize> = battle.troops[1 - side].iter().enumerate().filter(|(_, troop)| is_live(troop)).map(|(index, _)| index).collect();
        let answers: Vec<Option<Vec<Body>>> = if self.replies && !theirs.is_empty() {
            REPLIES
                .iter()
                .map(|word| match *word {
                    "push" => Some(vec![Body { order: "advance".to_string(), picked: theirs.clone(), way: None }]),
                    "dig in" => Some(vec![Body { order: "dig in".to_string(), picked: theirs.clone(), way: None }]),
                    _ => None,
                })
                .collect()
        } else {
            vec![None]
        };
        let look = Look { side, day, ahead: self.ahead, params: self.params.clone(), answers };
        let mut weighed = Weighed { values: HashMap::new() };
        let mut chosen: i64 = -1;
        let mut best = f64::NEG_INFINITY;
        let mut orders: Option<Vec<Body>> = None;
        let mut plans: Vec<(usize, Option<Vec<Body>>)> = Vec::new();
        for plan in 0..PLAN_NAMES.len() {
            if self.allowed.as_ref().is_some_and(|allowed| !allowed.iter().any(|name| name == PLAN_NAMES[plan])) {
                continue;
            }
            let keys = if plan == 0 { None } else { drawn[plan - 1].as_ref() };
            if plan > 0 && keys.is_none() {
                continue;
            }
            plans.push((plan, keys.map(|keys| bodies_of(battle, &view, keys))));
        }
        self.weigh_together(run, battle, &look, &mut weighed, plans.iter().map(|(_, bodies)| Job { bodies: bodies.clone(), air: None }).collect());
        for (plan, bodies) in plans {
            let value = self.weigh(run, battle, &look, &mut weighed, Job { bodies: bodies.clone(), air: None });
            if value > best {
                best = value;
                chosen = plan as i64;
                orders = bodies;
            }
        }
        if let Some(chosen_orders) = orders.clone() {
            if self.refine > 0 {
                let mut current = chosen_orders;
                let mut largest: Vec<(usize, usize)> = current.iter().enumerate().map(|(at, body)| (at, body.picked.len())).collect();
                js::stable_sort_by(&mut largest, |a, b| {
                    let by = b.1 as f64 - a.1 as f64;
                    if by != 0.0 {
                        by
                    } else {
                        a.0 as f64 - b.0 as f64
                    }
                });
                largest.truncate(self.refine);
                for index in 0..largest.len() {
                    let Some(other) = turned(&current, largest[index].0) else { continue };
                    if !weighed.values.contains_key(&said_of(&Job { bodies: Some(other.clone()), air: None })) {
                        let list: Vec<Job> = largest[index..].iter().filter_map(|&(at, _)| turned(&current, at)).map(|bodies| Job { bodies: Some(bodies), air: None }).collect();
                        self.weigh_together(run, battle, &look, &mut weighed, list);
                    }
                    let value = self.weigh(run, battle, &look, &mut weighed, Job { bodies: Some(other.clone()), air: None });
                    if value > best {
                        best = value;
                        current = other;
                    }
                }
                orders = Some(current);
            }
        }
        let mut air: Option<String> = None;
        let flying = run.air_over.borrow().iter().find(|(battle, _)| *battle == at).map_or(0, |(_, lists)| lists[side].len());
        if self.air_control && flying > 0 {
            let missions: Vec<&str> = AIR_MISSIONS.iter().copied().filter(|mission| *mission != air_mission_of(battle, side)).collect();
            self.weigh_together(run, battle, &look, &mut weighed, missions.iter().map(|mission| Job { bodies: orders.clone(), air: Some(mission.to_string()) }).collect());
            for mission in missions {
                let value = self.weigh(run, battle, &look, &mut weighed, Job { bodies: orders.clone(), air: Some(mission.to_string()) });
                if value > best {
                    best = value;
                    air = Some(mission.to_string());
                }
            }
        }
        if chosen <= 0 || orders.is_none() {
            return Own { keep: true, air, ..Own::default() };
        }
        let orders = orders.unwrap();
        let aim = aim_of(&orders);
        Own { troops: Some(orders), plan: Some(PLAN_NAMES[chosen as usize].to_string()), aim: aim.map(|aim| aim.to_vec()), air, ..Own::default() }
    }
}

impl StaffHook for Planner {
    fn often(&self) -> bool {
        true
    }

    fn decide(&self, run: &Run, battle: &mut Battle, side: usize, asked: &Asked) -> Said {
        Said::Own(self.think(run, battle, side, asked.at))
    }
}
