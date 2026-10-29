use std::cell::{OnceCell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use crate::codec::{Sample, Troop, TROOP_KINDS, TROOP_STATES};
use crate::frame::{Frame, Projector};
use crate::jsmath::{self, hypot};

pub const TROOP_KIND_GLYPH: [(&str, &str); 3] = [("infantry", "I"), ("armor", "A"), ("artillery", "G")];

const ADVANCING: usize = 1;
const ROUND_CELLS: f64 = 0.75;
const ROUND_PART: f64 = 0.4;
const ROUND_STEPS: usize = 5;

pub const ARROW_FRESH_DAYS: f64 = 6.0;
const ARROW_DAYS_MOST: f64 = 20.0;
const ARROW_TAIL: f64 = 0.3;
const ARROW_HEAD_LENGTH: f64 = 3.2;
const ARROW_HEAD_HALF: f64 = 2.3;
const STEPS_PER_DAY: f64 = 2.0;
const STILL: f64 = 0.02;
pub const ARROW_GROUP_DAYS: f64 = 3.0;
const ARROW_FADE_DAYS: f64 = 1.0;
const REACH_KEYS: f64 = 6.0;
const MAX_GROUPINGS: usize = 240;
pub const ARROW_MERGE_REACH: f64 = 11.0;
const LINE_STEP: f64 = 0.25;
pub const ARROW_STILL_MIN_ZOOM: f64 = 7.5;

#[derive(Clone, Debug, Default)]
pub struct Way {
    pub xs: Vec<f64>,
    pub ys: Vec<f64>,
    pub days: Vec<f64>,
}

#[derive(Clone, Debug)]
pub struct Replay {
    pub start: f64,
    pub end: f64,
    pub days: f64,
    pub tracks: Vec<Vec<Vec<Sample>>>,
}

#[derive(Clone, Debug)]
pub struct View {
    pub name: String,
    pub status: String,
    pub sides: Vec<Vec<Option<String>>>,
    pub frame: Frame,
    pub troops: Vec<Vec<Troop>>,
    pub labels: HashMap<String, String>,
    pub commands: Vec<Vec<f64>>,
    pub replay: Option<Replay>,
}

impl View {
    pub fn member(&self, side: usize, at: usize) -> Option<&str> {
        self.sides.get(side).and_then(|list| list.get(at)).and_then(|entry| entry.as_deref())
    }
}

struct Curve {
    days: Vec<f64>,
    xs: Vec<f64>,
    ys: Vec<f64>,
}

pub struct StageTroop {
    track: Vec<Sample>,
    curve: Curve,
    set_off: usize,
    breaks: Vec<(f64, f64)>,
    pub command: f64,
    pub kind: usize,
    pub owner: String,
    pub named: bool,
    pub label: String,
    standing: Option<Troop>,
}

struct TableEntry {
    xs: Vec<f32>,
    ys: Vec<f32>,
    moved: Vec<u8>,
    sum: Vec<u16>,
    far: f64,
    first: usize,
}

struct Table {
    steps: usize,
    sides: Vec<Vec<Option<TableEntry>>>,
    order: Vec<Vec<usize>>,
}

struct Middle {
    xs: Vec<f32>,
    ys: Vec<f32>,
    first: usize,
}

pub struct Group {
    pub side: usize,
    pub members: Vec<usize>,
    pub key: String,
    middle: OnceCell<Middle>,
}

pub struct Stage {
    pub view: View,
    pub projector: Projector,
    pub troops: Vec<Vec<StageTroop>>,
    pub known: bool,
    pub start: f64,
    pub last: f64,
    pub end: f64,
    table: OnceCell<Table>,
    groups: RefCell<HashMap<(i64, i64, i64, i64), Rc<Vec<Group>>>>,
}

fn curve_of(track: &[Sample]) -> Curve {
    let mut days: Vec<f64> = Vec::new();
    let mut xs: Vec<f64> = Vec::new();
    let mut ys: Vec<f64> = Vec::new();
    let mut put = |day: f64, x: f64, y: f64| {
        if let Some(last) = days.len().checked_sub(1) {
            if days[last] == day && xs[last] == x && ys[last] == y {
                return;
            }
        }
        days.push(day);
        xs.push(x);
        ys.push(y);
    };
    if let Some(first) = track.first() {
        put(first.day, first.x, first.y);
    }
    for index in 1..track.len() {
        let here = &track[index];
        let before = &track[index - 1];
        let after = track.get(index + 1);
        let in_leg = ((here.x - before.x) * (here.x - before.x) + (here.y - before.y) * (here.y - before.y)).sqrt();
        let out_leg = match after {
            Some(after) => ((after.x - here.x) * (after.x - here.x) + (after.y - here.y) * (after.y - here.y)).sqrt(),
            None => 0.0,
        };
        let round = jsmath::min(jsmath::min(ROUND_CELLS, ROUND_PART * in_leg), ROUND_PART * out_leg);
        if !(round > 0.0) {
            put(here.day, here.x, here.y);
            continue;
        }
        let after = after.expect("a rounded corner has a leg after it");
        let in_part = round / in_leg;
        let out_part = round / out_leg;
        let enter_x = here.x - (here.x - before.x) * in_part;
        let enter_y = here.y - (here.y - before.y) * in_part;
        let enter_day = here.day - (here.day - before.day) * in_part;
        let leave_x = here.x + (after.x - here.x) * out_part;
        let leave_y = here.y + (after.y - here.y) * out_part;
        let leave_day = here.day + (after.day - here.day) * out_part;
        put(enter_day, enter_x, enter_y);
        for step in 1..=ROUND_STEPS {
            let u = step as f64 / ROUND_STEPS as f64;
            let a = (1.0 - u) * (1.0 - u);
            let b = 2.0 * u * (1.0 - u);
            let c = u * u;
            put(enter_day + (leave_day - enter_day) * u, a * enter_x + b * here.x + c * leave_x, a * enter_y + b * here.y + c * leave_y);
        }
    }
    Curve { days, xs, ys }
}

fn is_integer(value: f64) -> bool {
    value.is_finite() && value.trunc() == value
}

pub fn stage_of(view: View) -> Stage {
    let projector = Projector::of(&view.frame);
    let side_count = view.troops.len();
    let mut troops = Vec::with_capacity(side_count);
    for side in 0..side_count {
        let list = &view.troops[side];
        let empty: Vec<Vec<Sample>> = Vec::new();
        let tracks = view.replay.as_ref().and_then(|replay| replay.tracks.get(side)).unwrap_or(&empty);
        let count = list.len().max(tracks.len());
        let mut made = Vec::with_capacity(count);
        for index in 0..count {
            let standing = list.get(index).cloned();
            let track: Vec<Sample> = tracks.get(index).cloned().unwrap_or_default();
            let curve = curve_of(&track);
            let mut set_off = 0;
            while set_off + 1 < curve.days.len() && curve.xs[set_off + 1] == curve.xs[0] && curve.ys[set_off + 1] == curve.ys[0] {
                set_off += 1;
            }
            let mut breaks: Vec<(f64, f64)> = Vec::new();
            for point in 1..track.len() {
                let moved = (track[point].x - track[point - 1].x).abs() > 1.0 / 32.0 || (track[point].y - track[point - 1].y).abs() > 1.0 / 32.0;
                if !moved || track[point].state == ADVANCING {
                    continue;
                }
                match breaks.last_mut() {
                    Some(last) if last.1 == track[point - 1].day => last.1 = track[point].day,
                    _ => breaks.push((track[point - 1].day, track[point].day)),
                }
            }
            let command = view.commands.get(side).and_then(|list| list.get(index)).copied().filter(|value| is_integer(*value)).unwrap_or(-1.0);
            let kind = standing.as_ref().map(|troop| troop.kind).unwrap_or(0).min(TROOP_KINDS.len() - 1);
            let owner_at = standing.as_ref().map(|troop| troop.owner).unwrap_or(0);
            let owner = view.member(side, owner_at).or_else(|| view.member(side, 0)).unwrap_or("").to_string();
            let named = standing.as_ref().map(|troop| troop.named).unwrap_or(false);
            let label = if named { view.labels.get(&format!("{side}:{index}")).cloned().unwrap_or_default() } else { String::new() };
            made.push(StageTroop { track, curve, set_off, breaks, command, kind, owner, named, label, standing });
        }
        troops.push(made);
    }
    let (known, start, last, end) = match &view.replay {
        Some(replay) => (true, replay.start, replay.end, replay.days),
        None => (false, 0.0, 0.0, 0.0),
    };
    Stage { view, projector, troops, known, start, last, end, table: OnceCell::new(), groups: RefCell::new(HashMap::new()) }
}

pub struct Shown {
    pub x: f64,
    pub y: f64,
    pub strength: f64,
    pub state: usize,
    pub moving: bool,
    pub way: Option<Way>,
}

fn cut_way(way: &Way, since: f64) -> (Option<Way>, Option<Way>) {
    let count = way.days.len();
    if !(way.days[0] < since) {
        return (None, Some(way.clone()));
    }
    if way.days[count - 1] <= since {
        return (Some(way.clone()), None);
    }
    let mut first = 0;
    while first + 1 < count && way.days[first + 1] <= since {
        first += 1;
    }
    let span = way.days[first + 1] - way.days[first];
    let part = if span > 0.0 { (since - way.days[first]) / span } else { 0.0 };
    let cut_x = way.xs[first] + (way.xs[first + 1] - way.xs[first]) * part;
    let cut_y = way.ys[first] + (way.ys[first + 1] - way.ys[first]) * part;
    let mut past_xs = way.xs[..first + 1].to_vec();
    past_xs.push(cut_x);
    let mut past_ys = way.ys[..first + 1].to_vec();
    past_ys.push(cut_y);
    let mut recent_xs = vec![cut_x];
    recent_xs.extend_from_slice(&way.xs[first + 1..]);
    let mut recent_ys = vec![cut_y];
    recent_ys.extend_from_slice(&way.ys[first + 1..]);
    let mut recent_days = vec![since];
    recent_days.extend_from_slice(&way.days[first + 1..]);
    (Some(Way { xs: past_xs, ys: past_ys, days: Vec::new() }), Some(Way { xs: recent_xs, ys: recent_ys, days: recent_days }))
}

fn troop_at(troop: &StageTroop, day: f64) -> Option<Shown> {
    let track = &troop.track;
    let curve = &troop.curve;
    let set_off = troop.set_off;
    if track.is_empty() {
        let standing = troop.standing.as_ref()?;
        if !(standing.strength > 0.0) {
            return None;
        }
        return Some(Shown { x: standing.x, y: standing.y, strength: standing.strength, state: standing.state.min(TROOP_STATES.len() - 1), moving: false, way: None });
    }
    if day < track[0].day {
        return None;
    }
    let mut sample = 1;
    while sample < track.len() && track[sample].day < day {
        sample += 1;
    }
    let last = &track[track.len() - 1];
    let ended = day >= last.day;
    let to = if ended { last } else { &track[sample] };
    let from = if ended { last } else { &track[sample - 1] };
    let span = to.day - from.day;
    let part = if ended || !(span > 0.0) { 1.0 } else { (day - from.day) / span };
    let strength = from.strength + (to.strength - from.strength) * part;
    if !(strength > 0.0) {
        return None;
    }
    let mut point = 1;
    let count = curve.days.len();
    while point < count && curve.days[point] < day {
        point += 1;
    }
    let x;
    let y;
    let mut way: Option<Way> = None;
    if point >= count {
        x = curve.xs[count - 1];
        y = curve.ys[count - 1];
        if count - 1 > set_off {
            way = Some(Way { xs: curve.xs[set_off..].to_vec(), ys: curve.ys[set_off..].to_vec(), days: curve.days[set_off..].to_vec() });
        }
    } else {
        let leg = curve.days[point] - curve.days[point - 1];
        let along = if leg > 0.0 { (day - curve.days[point - 1]) / leg } else { 1.0 };
        x = curve.xs[point - 1] + (curve.xs[point] - curve.xs[point - 1]) * along;
        y = curve.ys[point - 1] + (curve.ys[point] - curve.ys[point - 1]) * along;
        if point - 1 > set_off || (point - 1 == set_off && along > 0.0) {
            let mut xs = curve.xs[set_off..point].to_vec();
            let mut ys = curve.ys[set_off..point].to_vec();
            let mut days = curve.days[set_off..point].to_vec();
            xs.push(x);
            ys.push(y);
            days.push(day);
            way = Some(Way { xs, ys, days });
        }
    }
    if way.is_some() {
        let mut since = f64::NEG_INFINITY;
        for &(leg_from, leg_to) in &troop.breaks {
            if leg_from >= day {
                break;
            }
            if day <= leg_to {
                way = None;
                break;
            }
            since = leg_to;
        }
        if let Some(current) = way.take() {
            if since > current.days[0] {
                way = cut_way(&current, since).1;
            } else {
                way = Some(current);
            }
        }
    }
    Some(Shown {
        x,
        y,
        strength,
        state: to.state.min(TROOP_STATES.len() - 1),
        moving: !ended && ((to.x - from.x).abs() > 1.0 / 32.0 || (to.y - from.y).abs() > 1.0 / 32.0),
        way,
    })
}

pub fn front_shown_on(stage: &Stage, day: f64) -> bool {
    stage.known && day >= stage.start && !(stage.view.status == "closed" && day >= stage.last)
}

pub struct Drawing<'a> {
    pub stage: &'a Stage,
    pub troops: Vec<Vec<Option<Shown>>>,
}

pub fn front_at(stage: &Stage, day: f64) -> Option<Drawing<'_>> {
    if !front_shown_on(stage, day) {
        return None;
    }
    let troops = stage.troops.iter().map(|list| list.iter().map(|troop| troop_at(troop, day)).collect()).collect();
    Some(Drawing { stage, troops })
}

pub enum TroopFeature<'a> {
    Troop { at: [f64; 2], side: usize, index: usize, command: f64, owner: &'a str, glyph: &'static str, strength: f64, state: &'static str, named: bool, moving: bool, label: &'a str },
    Side { at: [f64; 2], side: usize, command: f64, owner: &'a str, count: usize, strength: f64 },
}

pub fn glyph_of(kind: &str) -> &'static str {
    TROOP_KIND_GLYPH.iter().find(|(name, _)| *name == kind).map(|(_, glyph)| *glyph).unwrap_or("I")
}

struct Body<'a> {
    count: usize,
    x: f64,
    y: f64,
    strength: f64,
    owners: Vec<(&'a str, usize)>,
}

pub fn front_troop_features<'a>(shown: &[Option<Drawing<'a>>], drawings: &mut Vec<(usize, TroopFeature<'a>)>) {
    for (at, drawing) in shown.iter().enumerate() {
        let Some(drawing) = drawing else { continue };
        let stage = drawing.stage;
        for (side, list) in drawing.troops.iter().enumerate() {
            let mut bodies: Vec<(f64, Body<'a>)> = Vec::new();
            for (index, troop) in list.iter().enumerate() {
                let Some(troop) = troop else { continue };
                let info: &'a StageTroop = &stage.troops[side][index];
                let command = info.command;
                let position = match bodies.iter().position(|(key, _)| *key == command) {
                    Some(position) => position,
                    None => {
                        bodies.push((command, Body { count: 0, x: 0.0, y: 0.0, strength: 0.0, owners: Vec::new() }));
                        bodies.len() - 1
                    }
                };
                let body = &mut bodies[position].1;
                body.count += 1;
                body.x += troop.x;
                body.y += troop.y;
                body.strength += troop.strength;
                match body.owners.iter_mut().find(|(name, _)| *name == info.owner.as_str()) {
                    Some(entry) => entry.1 += 1,
                    None => body.owners.push((info.owner.as_str(), 1)),
                }
                let kind = TROOP_KINDS[info.kind];
                drawings.push((
                    at,
                    TroopFeature::Troop {
                        at: stage.projector.to_lng_lat(troop.x, troop.y),
                        side,
                        index,
                        command,
                        owner: info.owner.as_str(),
                        glyph: glyph_of(kind),
                        strength: jsmath::round(troop.strength),
                        state: TROOP_STATES[troop.state],
                        named: info.named,
                        moving: troop.moving,
                        label: info.label.as_str(),
                    },
                ));
            }
            bodies.sort_by(|a, b| (a.0 - b.0).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
            for (command, body) in bodies {
                let mut owner: &'a str = stage.view.member(side, 0).unwrap_or("");
                let mut most = body.owners.iter().find(|(name, _)| *name == owner).map(|(_, count)| *count).unwrap_or(0);
                for (name, count) in &body.owners {
                    if *count > most {
                        most = *count;
                        owner = name;
                    }
                }
                drawings.push((
                    at,
                    TroopFeature::Side {
                        at: stage.projector.to_lng_lat(body.x / body.count as f64, body.y / body.count as f64),
                        side,
                        command,
                        owner,
                        count: body.count,
                        strength: jsmath::round(body.strength / body.count as f64),
                    },
                ));
            }
        }
    }
}

pub fn arrow_ring(way: &Way, day: f64, half_width: f64, over: f64) -> Option<Vec<[f64; 2]>> {
    let mut xs: Vec<f64> = Vec::new();
    let mut ys: Vec<f64> = Vec::new();
    let mut days: Vec<f64> = Vec::new();
    for index in 0..way.xs.len() {
        if let Some(last) = xs.len().checked_sub(1) {
            if (way.xs[index] - xs[last]).abs() < 1e-6 && (way.ys[index] - ys[last]).abs() < 1e-6 {
                days[last] = way.days[index];
                continue;
            }
        }
        xs.push(way.xs[index]);
        ys.push(way.ys[index]);
        days.push(way.days[index]);
    }
    let count = xs.len();
    if count < 2 || !(half_width > 0.0) {
        return None;
    }
    let mut along = vec![0.0f64];
    for index in 1..count {
        let next = along[index - 1] + hypot(xs[index] - xs[index - 1], ys[index] - ys[index - 1]);
        along.push(next);
    }
    let total = along[count - 1];
    if !(total > half_width * 0.6) {
        return None;
    }
    let fit = jsmath::min(1.0, (total * 0.7) / (ARROW_HEAD_LENGTH * half_width));
    let half = half_width * fit;
    let head_length = ARROW_HEAD_LENGTH * half;
    let head_half = ARROW_HEAD_HALF * half;
    let neck = total - head_length;
    let width_on = |when: f64| -> f64 {
        let mut fresh = (when - (day - over)) / over;
        if fresh < 0.0 {
            fresh = 0.0;
        } else if fresh > 1.0 {
            fresh = 1.0;
        }
        half * (ARROW_TAIL + (1.0 - ARROW_TAIL) * fresh * fresh * (3.0 - 2.0 * fresh))
    };
    let mut left: Vec<[f64; 2]> = Vec::new();
    let mut right: Vec<[f64; 2]> = Vec::new();
    let mut put = |x: f64, y: f64, tx: f64, ty: f64, width: f64| {
        let mut length = hypot(tx, ty);
        if length == 0.0 || length.is_nan() {
            length = 1.0;
        }
        let nx = -ty / length;
        let ny = tx / length;
        left.push([x + nx * width, y + ny * width]);
        right.push([x - nx * width, y - ny * width]);
    };
    let mut segment = 1;
    let mut index = 0;
    while index < count && along[index] < neck {
        let before = if index == 0 { 0 } else { index - 1 };
        let after = (index + 1).min(count - 1);
        put(xs[index], ys[index], xs[after] - xs[before], ys[after] - ys[before], width_on(days[index]));
        segment = index + 1;
        index += 1;
    }
    let leg = along[segment] - along[segment - 1];
    let part = if leg > 0.0 { jsmath::max(0.0, jsmath::min(1.0, (neck - along[segment - 1]) / leg)) } else { 0.0 };
    let neck_x = xs[segment - 1] + (xs[segment] - xs[segment - 1]) * part;
    let neck_y = ys[segment - 1] + (ys[segment] - ys[segment - 1]) * part;
    let tip_x = xs[count - 1];
    let tip_y = ys[count - 1];
    let mut head_x = tip_x - neck_x;
    let mut head_y = tip_y - neck_y;
    let head_span = hypot(head_x, head_y);
    if !(head_span > 1e-9) {
        return None;
    }
    head_x /= head_span;
    head_y /= head_span;
    put(neck_x, neck_y, head_x, head_y, jsmath::min(width_on(days[segment - 1] + (days[segment] - days[segment - 1]) * part), head_half * 0.6));
    let mut ring = left;
    ring.push([neck_x - head_y * head_half, neck_y + head_x * head_half]);
    ring.push([tip_x, tip_y]);
    ring.push([neck_x + head_y * head_half, neck_y - head_x * head_half]);
    right.reverse();
    ring.extend(right);
    let first = ring[0];
    ring.push(first);
    Some(ring)
}

impl Stage {
    fn table(&self) -> &Table {
        self.table.get_or_init(|| {
            let steps_f = jsmath::max(0.0, jsmath::round((self.end - self.start) * STEPS_PER_DAY));
            let steps = steps_f as usize;
            let sides: Vec<Vec<Option<TableEntry>>> = self
                .troops
                .iter()
                .map(|list| {
                    list.iter()
                        .map(|troop| {
                            let curve = &troop.curve;
                            let count = curve.days.len();
                            if count < 2 {
                                return None;
                            }
                            let mut xs = vec![0.0f32; steps + 1];
                            let mut ys = vec![0.0f32; steps + 1];
                            let mut moved = vec![0u8; steps + 1];
                            let mut sum = vec![0u16; steps + 1];
                            let mut point = 1;
                            let mut moves: u32 = 0;
                            let mut far = 0.0f64;
                            let mut first = steps;
                            for step in 0..=steps {
                                let day = self.start + step as f64 / STEPS_PER_DAY;
                                while point < count - 1 && curve.days[point] < day {
                                    point += 1;
                                }
                                if day <= curve.days[0] {
                                    xs[step] = curve.xs[0] as f32;
                                    ys[step] = curve.ys[0] as f32;
                                } else if day >= curve.days[count - 1] {
                                    xs[step] = curve.xs[count - 1] as f32;
                                    ys[step] = curve.ys[count - 1] as f32;
                                } else {
                                    let leg = curve.days[point] - curve.days[point - 1];
                                    let along = if leg > 0.0 { (day - curve.days[point - 1]) / leg } else { 1.0 };
                                    xs[step] = (curve.xs[point - 1] + (curve.xs[point] - curve.xs[point - 1]) * along) as f32;
                                    ys[step] = (curve.ys[point - 1] + (curve.ys[point] - curve.ys[point - 1]) * along) as f32;
                                }
                                if step > 0 {
                                    let gone = hypot(xs[step] as f64 - xs[step - 1] as f64, ys[step] as f64 - ys[step - 1] as f64);
                                    if gone > STILL {
                                        moved[step] = 1;
                                        if moves == 0 {
                                            first = step - 1;
                                        }
                                        moves += 1;
                                        far += gone;
                                    }
                                    sum[step] = moves as u16;
                                }
                            }
                            if moves > 0 {
                                Some(TableEntry { xs, ys, moved, sum, far, first })
                            } else {
                                None
                            }
                        })
                        .collect()
                })
                .collect();
            let order = sides
                .iter()
                .map(|list| {
                    let mut movers: Vec<usize> = list.iter().enumerate().filter(|(_, entry)| entry.is_some()).map(|(index, _)| index).collect();
                    movers.sort_by(|&a, &b| {
                        let far_a = list[a].as_ref().map(|entry| entry.far).unwrap_or(0.0);
                        let far_b = list[b].as_ref().map(|entry| entry.far).unwrap_or(0.0);
                        let difference = far_b - far_a;
                        if difference != 0.0 && !difference.is_nan() {
                            if difference < 0.0 {
                                std::cmp::Ordering::Less
                            } else {
                                std::cmp::Ordering::Greater
                            }
                        } else {
                            a.cmp(&b)
                        }
                    });
                    movers
                })
                .collect();
            Table { steps, sides, order }
        })
    }

    fn bucket_of(&self, day: f64, days: f64) -> f64 {
        let last = ((self.end - self.start + days) / ARROW_GROUP_DAYS).ceil();
        jsmath::max(0.0, jsmath::min(last, ((day - self.start) / ARROW_GROUP_DAYS + 1e-9).floor()))
    }

    fn grouping_of(&self, bucket: f64, reach: f64, least: f64, days: f64) -> Rc<Vec<Group>> {
        let table = self.table();
        let reach_key = jsmath::round(jsmath::log2(jsmath::max(reach, 1e-3)) * REACH_KEYS);
        let least_key = jsmath::round(jsmath::max(0.0, least) * 8.0);
        let key = (bucket as i64, reach_key as i64, least_key as i64, jsmath::round(days * 2.0) as i64);
        if let Some(known) = self.groups.borrow().get(&key) {
            return known.clone();
        }
        let within = jsmath::pow2(reach_key / REACH_KEYS);
        let at_least = jsmath::max(least_key / 8.0, STILL * 4.0);
        let steps = table.steps as f64;
        let from = jsmath::min(steps, jsmath::max(0.0, jsmath::round((bucket * ARROW_GROUP_DAYS - days) * STEPS_PER_DAY)));
        let to = jsmath::min(steps, (bucket + 1.0) * ARROW_GROUP_DAYS * STEPS_PER_DAY);
        let mut groups: Vec<Group> = Vec::new();
        if to > from {
            let (from, to) = (from as usize, to as usize);
            for (side, list) in table.sides.iter().enumerate() {
                struct Mover<'t> {
                    entry: &'t TableEntry,
                    hx: f64,
                    hy: f64,
                    gone: f64,
                }
                let mut leaders: Vec<(Mover, Vec<usize>)> = Vec::new();
                for &index in &table.order[side] {
                    let entry = list[index].as_ref().expect("an ordered troop moves");
                    if (entry.sum[to] as f64) - (entry.sum[from] as f64) < 2.0 {
                        continue;
                    }
                    let hx = entry.xs[to] as f64 - entry.xs[from] as f64;
                    let hy = entry.ys[to] as f64 - entry.ys[from] as f64;
                    let gone = hypot(hx, hy);
                    if !(gone > at_least) {
                        continue;
                    }
                    let mover = Mover { entry, hx, hy, gone };
                    let mut best: Option<usize> = None;
                    let mut nearest = f64::INFINITY;
                    for (at, (lead, _)) in leaders.iter().enumerate() {
                        let apart = apart_of(lead.entry, lead.hx, lead.hy, lead.gone, &mover.entry, mover.hx, mover.hy, mover.gone, from, to, within);
                        if apart < nearest {
                            nearest = apart;
                            best = Some(at);
                        }
                    }
                    match best {
                        Some(at) => leaders[at].1.push(index),
                        None => leaders.push((mover, vec![index])),
                    }
                }
                for (_, members) in leaders {
                    if members.len() < 2 {
                        continue;
                    }
                    let mut sorted = members.clone();
                    sorted.sort_unstable();
                    let key = format!("{side}:{}", sorted.iter().map(|member| member.to_string()).collect::<Vec<_>>().join(","));
                    groups.push(Group { side, members, key, middle: OnceCell::new() });
                }
            }
        }
        let groups = Rc::new(groups);
        let mut cache = self.groups.borrow_mut();
        if cache.len() >= MAX_GROUPINGS {
            cache.clear();
        }
        cache.insert(key, groups.clone());
        groups
    }

    fn middle_of<'g>(&self, group: &'g Group) -> &'g Middle {
        let table = self.table();
        group.middle.get_or_init(|| {
            let mut xs = vec![0.0f32; table.steps + 1];
            let mut ys = vec![0.0f32; table.steps + 1];
            let mut first = table.steps;
            for &member in &group.members {
                let entry = table.sides[group.side][member].as_ref().expect("a grouped troop moves");
                for step in 0..=table.steps {
                    xs[step] = (xs[step] as f64 + entry.xs[step] as f64) as f32;
                    ys[step] = (ys[step] as f64 + entry.ys[step] as f64) as f32;
                }
                if entry.first < first {
                    first = entry.first;
                }
            }
            let count = group.members.len() as f64;
            for step in 0..=table.steps {
                xs[step] = (xs[step] as f64 / count) as f32;
                ys[step] = (ys[step] as f64 / count) as f32;
            }
            Middle { xs, ys, first }
        })
    }

    fn group_way(&self, group: &Group, since: f64, day: f64) -> Option<Way> {
        let table = self.table();
        let middle = self.middle_of(group);
        let steps = table.steps as f64;
        let up_to = jsmath::min(steps, (day - self.start) * STEPS_PER_DAY);
        let begin = jsmath::max(middle.first as f64, (since - self.start) * STEPS_PER_DAY);
        if !(up_to > begin) {
            return None;
        }
        let mut way = Way::default();
        let mut put = |at: f64| {
            let step = jsmath::min(steps, at.floor());
            let next = jsmath::min(steps, step + 1.0);
            let part = at - step;
            let (s, n) = (step as usize, next as usize);
            way.xs.push(middle.xs[s] as f64 + (middle.xs[n] as f64 - middle.xs[s] as f64) * part);
            way.ys.push(middle.ys[s] as f64 + (middle.ys[n] as f64 - middle.ys[s] as f64) * part);
            way.days.push(self.start + at / STEPS_PER_DAY);
        };
        put(begin);
        let mut step = begin.floor() + 1.0;
        while step < up_to {
            put(step);
            step += 1.0;
        }
        put(up_to);
        Some(way)
    }
}

#[allow(clippy::too_many_arguments)]
fn apart_of(a: &TableEntry, lead_hx: f64, lead_hy: f64, lead_gone: f64, b: &TableEntry, hx: f64, hy: f64, gone: f64, from: usize, to: usize, within: f64) -> f64 {
    if lead_hx * hx + lead_hy * hy < 0.5 * lead_gone * gone {
        return f64::INFINITY;
    }
    let worst = within * 1.7;
    let mut steps = 0u32;
    let mut sum = 0.0f64;
    for step in from + 1..=to {
        if a.moved[step] == 0 && b.moved[step] == 0 {
            continue;
        }
        let apart = hypot(a.xs[step] as f64 - b.xs[step] as f64, a.ys[step] as f64 - b.ys[step] as f64);
        if apart > worst {
            return f64::INFINITY;
        }
        steps += 1;
        sum += apart;
    }
    if steps == 0 {
        return f64::INFINITY;
    }
    let mean = sum / steps as f64;
    if mean <= within {
        mean
    } else {
        f64::INFINITY
    }
}

fn length_of(way: &Way) -> f64 {
    let mut total = 0.0;
    for index in 1..way.xs.len() {
        total += hypot(way.xs[index] - way.xs[index - 1], way.ys[index] - way.ys[index - 1]);
    }
    total
}

fn group_breadth(count: usize) -> f64 {
    jsmath::min(2.8, 1.0 + 0.36 * ((count - 1) as f64).sqrt())
}

pub struct ArrowDetail {
    pub half_width: f64,
    pub reach: f64,
    pub least: f64,
    pub share: f64,
    pub days: f64,
    pub still: bool,
}

fn stops_at(stops: &[(f64, f64)], zoom: f64) -> f64 {
    if zoom <= stops[0].0 {
        return stops[0].1;
    }
    for index in 1..stops.len() {
        if zoom <= stops[index].0 {
            let (z0, v0) = stops[index - 1];
            let (z1, v1) = stops[index];
            return v0 + ((v1 - v0) * (zoom - z0)) / (z1 - z0);
        }
    }
    stops[stops.len() - 1].1
}

pub fn arrow_detail_at(zoom: f64) -> ArrowDetail {
    const HALF_WIDTH: [(f64, f64); 5] = [(4.0, 1.6), (5.5, 2.6), (7.0, 4.2), (9.0, 6.0), (11.0, 8.0)];
    const REACH: [(f64, f64); 5] = [(4.5, 90.0), (6.0, 76.0), (7.5, 62.0), (9.0, 56.0), (11.0, 88.0)];
    const LEAST: [(f64, f64); 4] = [(5.0, 10.0), (7.0, 7.0), (9.0, 3.0), (10.0, 0.0)];
    const SHARE: [(f64, f64); 4] = [(5.0, 0.012), (6.0, 0.008), (7.0, 0.004), (7.5, 0.0)];
    ArrowDetail {
        half_width: stops_at(&HALF_WIDTH, zoom),
        reach: stops_at(&REACH, zoom),
        least: stops_at(&LEAST, zoom),
        share: stops_at(&SHARE, zoom),
        days: jsmath::round(jsmath::max(ARROW_FRESH_DAYS, jsmath::min(ARROW_DAYS_MOST, ARROW_FRESH_DAYS * jsmath::pow2(7.0 - zoom))) * 2.0) / 2.0,
        still: zoom >= ARROW_STILL_MIN_ZOOM,
    }
}

pub enum ArrowShape {
    Line(Vec<[f64; 2]>),
    Ring(Vec<[f64; 2]>),
}

pub struct ArrowFeature {
    pub drawing: usize,
    pub owner: String,
    pub alpha: f64,
    pub shape: ArrowShape,
}

pub struct ArrowOptions<'a> {
    pub day: &'a [f64],
    pub half_width_of: &'a dyn Fn(&Stage) -> f64,
    pub reach_of: &'a dyn Fn(&Stage) -> f64,
    pub least_of: &'a dyn Fn(&Stage) -> f64,
    pub still: bool,
    pub share: f64,
    pub days: f64,
}

pub fn front_arrow_features(shown: &[Option<Drawing<'_>>], options: &ArrowOptions<'_>, features: &mut Vec<ArrowFeature>) {
    let days = options.days;
    let still = options.still;
    for (at, drawing) in shown.iter().enumerate() {
        let Some(drawing) = drawing else { continue };
        let stage = drawing.stage;
        let projector = &stage.projector;
        let half_width = (options.half_width_of)(stage);
        let least = (options.least_of)(stage);
        let now = options.day[at];
        let fewest: Vec<f64> = drawing
            .troops
            .iter()
            .map(|list| {
                let count = list.iter().filter(|troop| troop.is_some()).count() as f64;
                jsmath::max(1.0, (options.share * count).ceil())
            })
            .collect();
        let mut write = |past: Option<&Way>, recent: Option<&Way>, when: f64, breadth: f64, owner: &str, alpha: f64, features: &mut Vec<ArrowFeature>| {
            if !(alpha > 0.02) {
                return;
            }
            let ring = match recent {
                Some(recent) if !(least > 0.0) || length_of(recent) >= least => arrow_ring(recent, when, half_width * breadth, days),
                _ => None,
            };
            if let Some(past) = past {
                if ring.is_some() || still {
                    let mut line: Vec<[f64; 2]> = Vec::new();
                    let mut last_x = 0.0;
                    let mut last_y = 0.0;
                    let end = past.xs.len() as isize - 1;
                    for index in 0..past.xs.len() {
                        let x = past.xs[index];
                        let y = past.ys[index];
                        if !line.is_empty() && (index as isize) < end && hypot(x - last_x, y - last_y) < LINE_STEP {
                            continue;
                        }
                        if !line.is_empty() && (x - last_x).abs() < 1e-6 && (y - last_y).abs() < 1e-6 {
                            continue;
                        }
                        line.push(projector.to_lng_lat(x, y));
                        last_x = x;
                        last_y = y;
                    }
                    if line.len() >= 2 {
                        features.push(ArrowFeature { drawing: at, owner: owner.to_string(), alpha, shape: ArrowShape::Line(line) });
                    }
                }
            }
            if let Some(ring) = ring {
                let ring = ring.iter().map(|point| projector.to_lng_lat(point[0], point[1])).collect();
                features.push(ArrowFeature { drawing: at, owner: owner.to_string(), alpha, shape: ArrowShape::Ring(ring) });
            }
        };
        let single = |troop: &Shown, side: usize, index: usize, alpha: f64, features: &mut Vec<ArrowFeature>, write: &mut dyn FnMut(Option<&Way>, Option<&Way>, f64, f64, &str, f64, &mut Vec<ArrowFeature>)| {
            let info = &stage.troops[side][index];
            if fewest[side] > 1.0 && !info.named {
                return;
            }
            let when = now;
            let way = troop.way.as_ref().expect("a troop drawn alone has a way");
            let (past, recent) = cut_way(way, when - days);
            write(past.as_ref(), recent.as_ref(), when, 1.0, &info.owner, alpha, features);
        };
        let standing = |group: &Group| -> Vec<usize> { group.members.iter().copied().filter(|&member| drawing.troops[group.side][member].is_some()).collect() };
        let shared = |group: &Group, present: &[usize], alpha: f64, features: &mut Vec<ArrowFeature>, write: &mut dyn FnMut(Option<&Way>, Option<&Way>, f64, f64, &str, f64, &mut Vec<ArrowFeature>)| {
            let side = group.side;
            if (present.len() as f64) < fewest[side] && !present.iter().any(|&member| stage.troops[side][member].named) {
                return;
            }
            let since = now - days;
            let recent = stage.group_way(group, since, now);
            let past = if recent.is_some() || still { stage.group_way(group, stage.start, jsmath::min(now, since)) } else { None };
            let lead = &stage.troops[side][present[0]];
            write(past.as_ref(), recent.as_ref(), now, group_breadth(present.len()), &lead.owner, alpha, features);
        };
        let side_count = drawing.troops.len();
        let mut together: Vec<Vec<bool>> = drawing.troops.iter().map(|list| vec![false; list.len()]).collect();
        let mut was_together: Vec<Vec<bool>> = together.clone();
        let mut fading = false;
        let mut shows = 1.0;
        let reach = (options.reach_of)(stage);
        let bucket = stage.bucket_of(now, days);
        let current = stage.grouping_of(bucket, reach, least, days);
        let into = (now - stage.start - bucket * ARROW_GROUP_DAYS) / ARROW_FADE_DAYS;
        let before = if bucket > 0.0 && into >= 0.0 && into < 1.0 { Some(stage.grouping_of(bucket - 1.0, reach, least, days)) } else { None };
        if before.is_some() {
            fading = true;
            shows = into * into * (3.0 - 2.0 * into);
        }
        let keys: Vec<&str> = current.iter().map(|group| group.key.as_str()).collect();
        let keys_before: Vec<&str> = before.as_ref().map(|list| list.iter().map(|group| group.key.as_str()).collect()).unwrap_or_default();
        for group in current.iter() {
            let present = standing(group);
            if present.len() < 2 {
                continue;
            }
            for &member in &group.members {
                together[group.side][member] = true;
            }
            let alpha = if fading && !keys_before.contains(&group.key.as_str()) { shows } else { 1.0 };
            shared(group, &present, alpha, features, &mut write);
        }
        if let Some(before) = before.as_ref() {
            for group in before.iter() {
                let present = standing(group);
                if present.len() < 2 {
                    continue;
                }
                for &member in &group.members {
                    was_together[group.side][member] = true;
                }
                if !keys.contains(&group.key.as_str()) {
                    shared(group, &present, 1.0 - shows, features, &mut write);
                }
            }
        }
        for side in 0..side_count {
            for (index, troop) in drawing.troops[side].iter().enumerate() {
                let Some(troop) = troop else { continue };
                if troop.way.is_none() {
                    continue;
                }
                let grouped = together[side][index];
                let was_grouped = if fading { was_together[side][index] } else { grouped };
                if !grouped {
                    single(troop, side, index, if was_grouped { shows } else { 1.0 }, features, &mut write);
                } else if !was_grouped {
                    single(troop, side, index, 1.0 - shows, features, &mut write);
                }
            }
        }
    }
}
