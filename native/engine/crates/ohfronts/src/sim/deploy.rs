use super::constants::{HOLDER_SIDE_A, HOLDER_SIDE_B, MAX_WAY_POINTS, REINFORCE_MOST};
use super::frame::Projector;
use super::js::{self, Obj, Val};
use crate::jsmath;
use std::collections::HashSet;

const SWARM: &str = "swarm";
pub const DEPLOY_REACH_KM: f64 = 40.0;
pub const DEPLOY_WAY_MOST: usize = (MAX_WAY_POINTS as usize) * 4;
pub const DEPLOY_USUAL: &str = "usual";
pub const DEPLOY_WHY: [(&str, &str); 5] = [
    ("reinforce-no-men", "men"),
    ("reinforce-full", "full"),
    ("reinforce-no-ground", "ground"),
    ("reinforce-halted", "halted"),
    ("side-not-fighting", "side"),
];

#[derive(Clone, Debug, PartialEq)]
pub enum Call {
    Usual,
    Count(f64),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Last {
    pub n: f64,
    pub why: String,
    pub d: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DeployLine {
    pub country: String,
    pub way: Vec<[f64; 2]>,
    pub swarm: bool,
    pub call: Option<Call>,
    pub last: Option<Last>,
}

fn clean(value: &Val, most: usize) -> String {
    let text = js::trim(&js::collapse_spaces(&value.string_or_empty())).to_string();
    js::trim(&js::slice_units(&text, 0, most)).to_string()
}

fn fold_name(text: &str) -> String {
    clean(&Val::str(text), 200).to_lowercase()
}

pub fn read_call(value: &Val) -> Option<Call> {
    if matches!(value, Val::Str(text) if text == DEPLOY_USUAL) {
        return Some(Call::Usual);
    }
    let count = jsmath::round(value.num());
    if !count.is_finite() || count < 1.0 {
        return None;
    }
    Some(Call::Count(if count > REINFORCE_MOST { REINFORCE_MOST } else { count }))
}

fn read_last(value: &Val) -> Option<Last> {
    if !value.truthy() || !value.is_object() {
        return None;
    }
    let n = jsmath::round(value.get("n").num());
    if !n.is_finite() || n < 0.0 {
        return None;
    }
    let why = match value.get("why") {
        Val::Str(text) if DEPLOY_WHY.iter().any(|(_, word)| word == text) => text.clone(),
        _ => String::new(),
    };
    Some(Last { n, why, d: clean(value.get("d"), 40) })
}

pub fn read_way(value: &Val) -> Vec<[f64; 2]> {
    let mut way = Vec::new();
    for point in value.array_or_empty() {
        let (lng, lat) = match point {
            Val::Arr(_) => (point.at(0).num(), point.at(1).num()),
            _ => (f64::NAN, f64::NAN),
        };
        if !lng.is_finite() || !lat.is_finite() || lat > 90.0 || lat < -90.0 {
            continue;
        }
        way.push([jsmath::round(lng * 10000.0) / 10000.0, jsmath::round(lat * 10000.0) / 10000.0]);
    }
    if way.len() <= DEPLOY_WAY_MOST {
        return way;
    }
    let mut kept = Vec::with_capacity(DEPLOY_WAY_MOST);
    for index in 0..DEPLOY_WAY_MOST {
        let at = jsmath::round((index as f64 * (way.len() - 1) as f64) / (DEPLOY_WAY_MOST - 1) as f64) as usize;
        kept.push(way[at]);
    }
    kept
}

pub fn read_deploy(value: &Val) -> [Vec<DeployLine>; 2] {
    let side = |side: usize| -> Vec<DeployLine> {
        let mut kept = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let list = match value {
            Val::Arr(sides) => sides.get(side).and_then(|entry| entry.as_array()).map(|list| list.as_slice()).unwrap_or(&[]),
            _ => &[],
        };
        for raw in list {
            let country = clean(raw.get("country"), 120);
            let swarm = matches!(raw.get("form"), Val::Str(form) if form == SWARM);
            let mut way = read_way(raw.get("way"));
            if swarm {
                way.truncate(1);
            }
            if country.is_empty() || seen.contains(&fold_name(&country)) || way.len() < if swarm { 1 } else { 2 } {
                continue;
            }
            seen.insert(fold_name(&country));
            kept.push(DeployLine { country, way, swarm, call: read_call(raw.get("call")), last: read_last(raw.get("last")) });
        }
        kept
    };
    [side(0), side(1)]
}

pub fn has_deploy(deploy: &Val) -> bool {
    match deploy {
        Val::Arr(lists) => lists.iter().any(|list| matches!(list, Val::Arr(items) if !items.is_empty())),
        _ => false,
    }
}

pub fn has_lines(deploy: &[Vec<DeployLine>; 2]) -> bool {
    deploy.iter().any(|list| !list.is_empty())
}

fn carry_of(record: &Val) -> Val {
    let carry = record.get("brief").get("carry");
    if carry.is_object() && carry.truthy() {
        carry.clone()
    } else {
        Val::Obj(Obj::new())
    }
}

fn is_side(side: &Val) -> Option<usize> {
    match side {
        Val::Num(n) if *n == HOLDER_SIDE_A => Some(0),
        Val::Num(n) if *n == HOLDER_SIDE_B => Some(1),
        _ => None,
    }
}

pub fn deploy_lines_of(record: &Val, side: &Val) -> Vec<DeployLine> {
    match is_side(side) {
        Some(side) => read_deploy(carry_of(record).get("deploy"))[side].clone(),
        None => Vec::new(),
    }
}

pub fn call_val(call: &Call) -> Val {
    match call {
        Call::Usual => Val::str(DEPLOY_USUAL),
        Call::Count(n) => Val::Num(*n),
    }
}

pub fn line_val(line: &DeployLine) -> Val {
    let mut out = Obj::new();
    out.set("country", Val::str(&line.country));
    out.set("way", Val::Arr(line.way.iter().map(|point| Val::nums(point)).collect()));
    if line.swarm {
        out.set("form", Val::str(SWARM));
    }
    if let Some(call) = &line.call {
        out.set("call", call_val(call));
    }
    if let Some(last) = &line.last {
        out.set("last", Val::obj([("n", Val::Num(last.n)), ("why", Val::str(&last.why)), ("d", Val::str(&last.d))]));
    }
    Val::Obj(out)
}

fn copy_of(value: &Val) -> Obj {
    let mut out = Obj::new();
    for (key, item) in js::entries(value) {
        out.set(&key, item);
    }
    out
}

pub fn with_deploy_line(record: &Val, side: &Val, country: &Val, way: &Val, form: &Val, call: &Val) -> Val {
    let name = clean(country, 120);
    let side = match is_side(side) {
        Some(side) if record.truthy() && !name.is_empty() => side,
        _ => return record.clone(),
    };
    let mut deploy = read_deploy(carry_of(record).get("deploy"));
    let swarm = matches!(form, Val::Str(form) if form == SWARM);
    let mut line = read_way(way);
    if swarm {
        line.truncate(1);
    }
    let others: Vec<DeployLine> = deploy[side].iter().filter(|entry| fold_name(&entry.country) != fold_name(&name)).cloned().collect();
    deploy[side] = if line.len() >= if swarm { 1 } else { 2 } {
        let mut kept = others;
        kept.push(DeployLine { country: name, way: line, swarm, call: read_call(call), last: None });
        kept
    } else {
        others
    };
    let mut carry = copy_of(&carry_of(record));
    if has_lines(&deploy) {
        carry.set("deploy", Val::Arr(deploy.iter().map(|lines| Val::Arr(lines.iter().map(line_val).collect())).collect()));
    } else {
        carry.remove("deploy");
    }
    let mut brief = copy_of(record.get("brief"));
    brief.set("carry", Val::Obj(carry));
    let mut out = copy_of(record);
    out.set("brief", Val::Obj(brief));
    Val::Obj(out)
}

#[allow(clippy::too_many_arguments)]
pub fn deploy_cells(lines: &[DeployLine], member: &str, holders: &[u8], cols: usize, rows: usize, frame_km: f64, place: &Projector, side: u8, cells: Vec<i32>) -> Vec<i32> {
    let wanted = fold_name(member);
    let line = match lines.iter().find(|entry| fold_name(&entry.country) == wanted && !entry.swarm) {
        Some(line) => line,
        None => return cells,
    };
    let reach = jsmath::max(1.0, jsmath::round(DEPLOY_REACH_KM / frame_km)) as i64;
    let mut out: Vec<i32> = Vec::new();
    let mut seen: HashSet<i32> = HashSet::new();
    let mut take = |x: f64, y: f64| {
        let cx = x.floor() as i64;
        let cy = y.floor() as i64;
        let mut best = -1i64;
        let mut best_at = reach * reach + 1;
        for dy in -reach..=reach {
            for dx in -reach..=reach {
                let gx = cx + dx;
                let gy = cy + dy;
                let far = dx * dx + dy * dy;
                if gx < 0 || gy < 0 || gx >= cols as i64 || gy >= rows as i64 || far >= best_at {
                    continue;
                }
                let cell = gy * cols as i64 + gx;
                if holders[cell as usize] != side {
                    continue;
                }
                best = cell;
                best_at = far;
            }
        }
        if best >= 0 && seen.insert(best as i32) {
            out.push(best as i32);
        }
    };
    let points: Vec<[f64; 2]> = line.way.iter().map(|[lng, lat]| place.to_cell(*lng, *lat)).collect();
    for at in 1..points.len() {
        let [ax, ay] = points[at - 1];
        let [bx, by] = points[at];
        let steps = jsmath::max(1.0, ((bx - ax) * (bx - ax) + (by - ay) * (by - ay)).sqrt().floor() + 1.0);
        let mut step = if at == 1 { 0.0 } else { 1.0 };
        while step <= steps {
            take(ax + ((bx - ax) * step) / steps, ay + ((by - ay) * step) / steps);
            step += 1.0;
        }
    }
    if out.is_empty() {
        cells
    } else {
        out
    }
}
