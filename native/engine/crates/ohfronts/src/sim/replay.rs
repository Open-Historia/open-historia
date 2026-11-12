use super::codec::{decode_paint, decode_states, decode_tracks, encode_paint, encode_states, encode_tracks, is_packed_text, Paint, PaintChange, Sample, SampleCode, PAINT_NAMES_MAX, PAINT_OWN_A, PAINT_OWN_B, PAINT_TICKS_PER_DAY, PAINT_WALL, TRACK_DAY_MAX};
use super::constants::{HOLDER_SIDE_A, HOLDER_SIDE_B, TROOP_STATES};
use super::game_dates::diff_game_days;
use super::js::{self, Obj, OrdMap, Val};
use crate::jsmath;

pub const MAX_TRACK_POINTS: usize = 32;
pub const TRACK_TOLERANCE: f64 = 0.2;
const TRACK_ALONG: f64 = 0.3;
const STRENGTH_PER_CELL: f64 = 40.0;
const SAME_PLACE: f64 = 1.0 / 32.0;
pub const MAX_REPLAY_CHARS: usize = 120000;
pub const MAX_SHOWN_REGIONS: usize = 600;
const MAX_SHOWN_TURNS: usize = 1200;
const TEXT_MAX: usize = 200000;
const DATE_MAX: usize = 40;
const NAME_MAX: usize = 120;

pub fn state_index(value: &Val) -> f64 {
    if let Val::Num(n) = value {
        return if *n >= 0.0 && *n < TROOP_STATES.len() as f64 { n.floor() } else { 0.0 };
    }
    let text = value.string_or_empty();
    TROOP_STATES.iter().position(|state| *state == text).map(|at| at as f64).unwrap_or(0.0)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Step {
    pub day: f64,
    pub x: f64,
    pub y: f64,
    pub strength: f64,
    pub state: f64,
}

fn thin_track(samples: &[Step], tolerance: f64) -> Vec<Step> {
    let count = samples.len();
    if count <= 2 {
        return samples.to_vec();
    }
    let mut keep = vec![0u8; count];
    keep[0] = 1;
    keep[count - 1] = 1;
    for index in 0..count - 1 {
        if samples[index].state != samples[index + 1].state {
            keep[index] = 1;
        }
    }
    let mut spans = Vec::new();
    let mut from = 0;
    for index in 1..count {
        if keep[index] == 0 {
            continue;
        }
        spans.push(from);
        spans.push(index);
        from = index;
    }
    while let (Some(b), Some(a)) = (spans.pop(), spans.pop()) {
        if b < a + 2 {
            continue;
        }
        let first = samples[a];
        let last = samples[b];
        let span = last.day - first.day;
        let reach = (jsmath::pow(last.x - first.x, 2.0) + jsmath::pow(last.y - first.y, 2.0)).sqrt();
        let way_x = if reach > 0.0 { (last.x - first.x) / reach } else { 0.0 };
        let way_y = if reach > 0.0 { (last.y - first.y) / reach } else { 0.0 };
        let mut worst = 0.0;
        let mut at: i64 = -1;
        for index in a + 1..b {
            let sample = samples[index];
            let part = if span > 0.0 { (sample.day - first.day) / span } else { 0.0 };
            let dx = sample.x - (first.x + (last.x - first.x) * part);
            let dy = sample.y - (first.y + (last.y - first.y) * part);
            let ds = (sample.strength - (first.strength + (last.strength - first.strength) * part)) / STRENGTH_PER_CELL;
            let ahead = (dx * way_x + dy * way_y) * TRACK_ALONG;
            let aside = if reach > 0.0 { dx * -way_y + dy * way_x } else { (dx * dx + dy * dy).sqrt() };
            let off = (ahead * ahead + aside * aside + ds * ds).sqrt();
            if off > worst {
                worst = off;
                at = index as i64;
            }
        }
        if worst > tolerance {
            let at = at as usize;
            keep[at] = 1;
            spans.extend_from_slice(&[a, at, at, b]);
        }
    }
    (0..count).filter(|&index| keep[index] != 0).map(|index| samples[index]).collect()
}

fn same_standing(a: &Step, b: &Step) -> bool {
    (a.x - b.x).abs() < SAME_PLACE && (a.y - b.y).abs() < SAME_PLACE && a.state == b.state && (a.strength - b.strength).abs() <= 2.0
}

fn pack_track(samples: &[Step], tolerance: f64) -> Vec<Step> {
    let mut slack = tolerance;
    let mut kept = thin_track(samples, slack);
    let mut pass = 0;
    while pass < 8 && kept.len() > MAX_TRACK_POINTS {
        slack *= 1.6;
        kept = thin_track(samples, slack);
        pass += 1;
    }
    if kept.len() > MAX_TRACK_POINTS {
        let last = kept[kept.len() - 1];
        kept.truncate(MAX_TRACK_POINTS - 1);
        kept.push(last);
    }
    while kept.len() >= 2 && same_standing(&kept[kept.len() - 1], &kept[kept.len() - 2]) {
        kept.pop();
    }
    kept
}

pub fn member_list(value: &Val) -> Vec<String> {
    value.array_or_empty().iter().map(|name| js::slice_units(&name.string_or_empty(), 0, NAME_MAX)).collect()
}

#[derive(Clone, Copy, Debug)]
pub struct TrackIn {
    pub strength: f64,
    pub x: f64,
    pub y: f64,
    pub state: f64,
}

pub struct Ground<'a> {
    pub holders: &'a [u8],
    pub homes: Option<&'a [u8]>,
    pub painters: Option<&'a [u8]>,
    pub when: Option<&'a [f64]>,
}

#[derive(Clone, Debug)]
pub struct ReplayRecorder {
    pub members: [Vec<String>; 2],
    pub names: Vec<String>,
    pub cells: usize,
    pub painted: Vec<u8>,
    pub began_states: Option<Vec<u8>>,
    pub began: Option<String>,
    pub changes: Vec<PaintChange>,
    pub start: f64,
    pub last_day: f64,
    pub tracks: [Vec<Option<Vec<Step>>>; 2],
    pub shown_first: OrdMap<String, String>,
    pub shown_now: OrdMap<String, String>,
    pub turns: Vec<(f64, String, String)>,
}

fn day_of(value: f64) -> f64 {
    jsmath::max(0.0, jsmath::min(TRACK_DAY_MAX, js::or_zero(value).floor()))
}

fn spaced(value: &Val, most: usize) -> String {
    js::slice_units(js::trim(&js::collapse_spaces(&value.string_or_empty())), 0, most)
}

#[derive(Clone, Debug, PartialEq)]
pub struct Finished {
    pub d: String,
    pub n: f64,
    pub s: f64,
    pub e: f64,
    pub t: [String; 2],
    pub names: Vec<String>,
    pub m: String,
    pub p: String,
    pub shown: Option<(Vec<(String, String)>, Vec<(f64, String, String)>)>,
}

pub fn create_replay_recorder(sides: &Val, cols: f64, rows: f64) -> ReplayRecorder {
    let members = [member_list(sides.at(0)), member_list(sides.at(1))];
    let mut names: Vec<String> = members[0].iter().chain(members[1].iter()).cloned().collect();
    names.truncate(PAINT_NAMES_MAX as usize);
    let cells = jsmath::max(0.0, cols.floor() * rows.floor());
    let cells = if cells.is_finite() { cells as usize } else { 0 };
    ReplayRecorder {
        members,
        names,
        cells,
        painted: vec![0; cells],
        began_states: None,
        began: None,
        changes: Vec::new(),
        start: -1.0,
        last_day: -1.0,
        tracks: [Vec::new(), Vec::new()],
        shown_first: OrdMap::new(),
        shown_now: OrdMap::new(),
        turns: Vec::new(),
    }
}

impl ReplayRecorder {
    fn state_of(&self, ground: &Ground, cell: usize) -> u8 {
        let holder = ground.holders.get(cell).copied().unwrap_or(255);
        if holder as f64 != HOLDER_SIDE_A && holder as f64 != HOLDER_SIDE_B {
            return PAINT_WALL as u8;
        }
        let side = if holder as f64 == HOLDER_SIDE_A { 0 } else { 1 };
        let own = if side == 0 { PAINT_OWN_A } else { PAINT_OWN_B } as u8;
        if ground.homes.is_some_and(|homes| homes.get(cell) == Some(&holder)) || self.members[side].is_empty() {
            return own;
        }
        let painter = jsmath::min(ground.painters.map(|painters| painters.get(cell).copied().unwrap_or(0) as f64).unwrap_or(0.0), (self.members[side].len() - 1) as f64);
        let state = 1.0 + if side == 0 { painter } else { self.members[0].len() as f64 + painter };
        if state <= self.names.len() as f64 {
            state as u8
        } else {
            own
        }
    }

    pub fn record(&mut self, day: f64, troops: &[Vec<TrackIn>], ground: Option<&Ground>) {
        let at = day_of(day);
        if self.start < 0.0 {
            self.start = at;
        }
        if let Some(ground) = ground.filter(|_| self.cells > 0) {
            if self.began.is_none() {
                for cell in 0..self.cells {
                    self.painted[cell] = self.state_of(ground, cell);
                }
                self.began_states = Some(self.painted.clone());
                self.began = Some(encode_states(&self.painted));
            } else {
                let first = (at - 1.0) * PAINT_TICKS_PER_DAY;
                let mut today = Vec::new();
                for cell in 0..self.cells {
                    let state = self.state_of(ground, cell);
                    if state == self.painted[cell] {
                        continue;
                    }
                    self.painted[cell] = state;
                    let part = ground.when.map(|when| when.get(cell).copied().unwrap_or(f64::NAN)).unwrap_or(1.0);
                    let within = if part.is_finite() { jsmath::max(0.0, jsmath::min(1.0, part)) } else { 1.0 };
                    today.push(PaintChange { tick: first + jsmath::round(within * PAINT_TICKS_PER_DAY), cell: cell as f64, state: state as f64 });
                }
                js::stable_sort_by(&mut today, |a, b| {
                    let by = a.tick - b.tick;
                    if by != 0.0 {
                        by
                    } else {
                        a.cell - b.cell
                    }
                });
                self.changes.extend(today);
            }
        }
        self.last_day = at;
        for side in 0..2 {
            let list: &[TrackIn] = troops.get(side).map(|list| list.as_slice()).unwrap_or(&[]);
            let kept = &mut self.tracks[side];
            for (index, troop) in list.iter().enumerate() {
                if kept.len() <= index {
                    kept.resize(index + 1, None);
                }
                let samples = kept[index].get_or_insert_with(Vec::new);
                let strength = if troop.strength > 0.0 { jsmath::min(100.0, troop.strength) } else { 0.0 };
                let dead = match samples.last() {
                    Some(before) => before.strength <= 0.0,
                    None => strength <= 0.0,
                };
                if dead {
                    continue;
                }
                samples.push(Step { day: at, x: js::or_zero(troop.x), y: js::or_zero(troop.y), strength, state: troop.state });
            }
        }
    }

    pub fn shown(&mut self, day: f64, region_id: &Val, name: &Val, was: Option<&Val>) {
        let id = js::slice_units(js::trim(&region_id.string_or_empty()), 0, NAME_MAX);
        let to = spaced(name, NAME_MAX);
        if id.is_empty() || to.is_empty() {
            return;
        }
        if !self.shown_first.has(&id) {
            if self.shown_first.len() >= MAX_SHOWN_REGIONS {
                return;
            }
            let earlier = spaced(was.unwrap_or(name), NAME_MAX);
            let from = if earlier.is_empty() { to.clone() } else { earlier };
            self.shown_first.set(id.clone(), from.clone());
            self.shown_now.set(id.clone(), from);
        }
        if self.shown_now.get(&id) == Some(&to) || self.turns.len() >= MAX_SHOWN_TURNS {
            return;
        }
        self.turns.push((day_of(day), id.clone(), to.clone()));
        self.shown_now.set(id, to);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn carry_onto<C: Fn(usize) -> f64, P: Fn(f64, f64) -> [f64; 2]>(&self, now: &Val, to_cols: f64, to_rows: f64, cell_of: C, point_of: P, ground: &Ground, day: f64) -> Option<ReplayRecorder> {
        let began_states = self.began_states.as_ref()?;
        if self.members[0] != member_list(now.at(0)) || self.members[1] != member_list(now.at(1)) {
            return None;
        }
        let mut next = create_replay_recorder(now, to_cols, to_rows);
        let size = next.cells;
        let now_states: Vec<u8> = (0..size).map(|cell| next.state_of(ground, cell)).collect();
        let mut began_there = now_states.clone();
        let mut was_there = now_states.clone();
        for cell in 0..self.cells {
            let there = cell_of(cell);
            if !(there >= 0.0) || there >= size as f64 {
                continue;
            }
            began_there[there as usize] = began_states[cell];
            was_there[there as usize] = self.painted[cell];
        }
        let mut carried = Vec::new();
        for change in &self.changes {
            let there = cell_of(change.cell as usize);
            if there >= 0.0 && there < size as f64 {
                carried.push(PaintChange { tick: change.tick, cell: there, state: change.state });
            }
        }
        let tick = jsmath::max(0.0, (jsmath::max(1.0, js::or_zero(day).floor()) - 1.0) * PAINT_TICKS_PER_DAY);
        for cell in 0..size {
            if was_there[cell] != now_states[cell] {
                carried.push(PaintChange { tick, cell: cell as f64, state: now_states[cell] as f64 });
            }
        }
        js::stable_sort_by(&mut carried, |a, b| {
            let by = a.tick - b.tick;
            if by != 0.0 {
                by
            } else {
                a.cell - b.cell
            }
        });
        next.painted = now_states;
        next.began = Some(encode_states(&began_there));
        next.began_states = Some(began_there);
        next.changes = carried;
        next.start = self.start;
        next.last_day = self.last_day;
        next.tracks = [0, 1].map(|side| {
            self.tracks[side]
                .iter()
                .map(|samples| {
                    samples.as_ref().map(|samples| {
                        samples
                            .iter()
                            .map(|sample| {
                                let [x, y] = point_of(sample.x, sample.y);
                                Step { x, y, ..*sample }
                            })
                            .collect()
                    })
                })
                .collect()
        });
        next.shown_first = self.shown_first.clone();
        next.shown_now = self.shown_now.clone();
        next.turns = self.turns.clone();
        Some(next)
    }

    pub fn finish(&self, date: &Val, days: &Val) -> Finished {
        let wanted = days.num();
        let total = jsmath::max(0.0, jsmath::min(TRACK_DAY_MAX, (if wanted.is_finite() { wanted } else { self.last_day }).floor()));
        let pack = |tolerance: f64| -> [String; 2] {
            [0, 1].map(|side| {
                let paths: Vec<Vec<SampleCode>> = self.tracks[side]
                    .iter()
                    .map(|samples| match samples {
                        Some(samples) => pack_track(samples, tolerance).iter().map(|s| SampleCode { day: s.day, x: s.x, y: s.y, strength: s.strength, state: s.state }).collect(),
                        None => Vec::new(),
                    })
                    .collect();
                encode_tracks(&paths)
            })
        };
        let mut tolerance = TRACK_TOLERANCE;
        let mut texts = pack(tolerance);
        let mut ground = self.began.clone().unwrap_or_default();
        let mut log = encode_paint(&self.changes);
        let size = |ground: &str, log: &str, texts: &[String; 2]| ground.len() + log.len() + texts[0].len() + texts[1].len();
        let mut pass = 0;
        while pass < 3 && size(&ground, &log, &texts) > MAX_REPLAY_CHARS {
            tolerance *= 2.0;
            texts = pack(tolerance);
            pass += 1;
        }
        if size(&ground, &log, &texts) > MAX_REPLAY_CHARS {
            ground = encode_states(&self.painted);
            log = String::new();
        }
        let end = if self.last_day < 0.0 { 0.0 } else { self.last_day };
        Finished {
            d: js::slice_units(&date.string_or_empty(), 0, DATE_MAX),
            n: jsmath::max(total, end),
            s: jsmath::max(0.0, self.start),
            e: end,
            t: texts,
            names: self.names.clone(),
            m: ground,
            p: log,
            shown: if self.shown_first.is_empty() { None } else { Some((self.shown_first.entries.clone(), self.turns.clone())) },
        }
    }
}

fn whole_day(value: &Val, most: f64) -> f64 {
    let number = value.num().floor();
    if !number.is_finite() || number < 0.0 {
        return 0.0;
    }
    if number > most {
        most
    } else {
        number
    }
}

fn packed(value: &Val) -> String {
    match value {
        Val::Str(text) if js::utf16_len(text) <= TEXT_MAX && is_packed_text(text) => text.clone(),
        _ => String::new(),
    }
}

fn shown_text(value: &Val) -> String {
    match value {
        Val::Str(_) => spaced(value, NAME_MAX),
        _ => String::new(),
    }
}

pub fn normalize_replay(raw: &Val) -> Option<Val> {
    if !raw.truthy() || !matches!(raw, Val::Obj(_)) || raw.get("t").as_array().is_none() {
        return None;
    }
    let n = whole_day(raw.get("n"), TRACK_DAY_MAX);
    let s = whole_day(raw.get("s"), n);
    let mut replay = Obj::new();
    replay.set("d", Val::str(&spaced(raw.get("d"), DATE_MAX)));
    replay.set("n", Val::Num(n));
    replay.set("s", Val::Num(s));
    replay.set("e", Val::Num(jsmath::max(s, if raw.get("e").is_undef() { n } else { whole_day(raw.get("e"), n) })));
    replay.set("t", Val::Arr(vec![Val::str(&packed(raw.get("t").at(0))), Val::str(&packed(raw.get("t").at(1)))]));
    let mut names: Vec<Val> = member_list(raw.get("names")).iter().map(|name| Val::str(js::trim(&js::collapse_spaces(name)))).collect();
    names.truncate(PAINT_NAMES_MAX as usize);
    replay.set("names", Val::Arr(names));
    replay.set("m", Val::str(&packed(raw.get("m"))));
    replay.set("p", Val::str(&packed(raw.get("p"))));
    if let Val::Arr(entries) = raw.get("o") {
        let mut first: Vec<(String, String)> = Vec::new();
        for entry in entries {
            if first.len() >= MAX_SHOWN_REGIONS {
                break;
            }
            let (id, name) = if entry.as_array().is_some() { (shown_text(entry.at(0)), shown_text(entry.at(1))) } else { (String::new(), String::new()) };
            if id.is_empty() || name.is_empty() || first.iter().any(|(known, _)| *known == id) {
                continue;
            }
            first.push((id, name));
        }
        if !first.is_empty() {
            let mut turns: Vec<(f64, String, String)> = Vec::new();
            for entry in raw.get("f").array_or_empty() {
                if turns.len() >= MAX_SHOWN_TURNS {
                    break;
                }
                let (id, name) = if entry.as_array().is_some() { (shown_text(entry.at(1)), shown_text(entry.at(2))) } else { (String::new(), String::new()) };
                if id.is_empty() || name.is_empty() || !first.iter().any(|(known, _)| *known == id) {
                    continue;
                }
                turns.push((whole_day(entry.at(0), n), id, name));
            }
            js::stable_sort_by(&mut turns, |a, b| a.0 - b.0);
            replay.set("o", Val::Arr(first.iter().map(|(id, name)| Val::Arr(vec![Val::str(id), Val::str(name)])).collect()));
            replay.set("f", Val::Arr(turns.iter().map(|(day, id, name)| Val::Arr(vec![Val::Num(*day), Val::str(id), Val::str(name)])).collect()));
        }
    }
    if js::is_finite(raw.get("until")) {
        let until = jsmath::max(0.0, jsmath::min(n, raw.get("until").num()));
        replay.set("until", Val::Num(until));
        let from = if js::is_finite(raw.get("from")) { jsmath::max(0.0, jsmath::min(until, raw.get("from").num())) } else { until };
        replay.set("from", Val::Num(from));
    }
    Some(Val::Obj(replay))
}

pub fn replay_between(replay: &Val, from: f64, until: f64) -> Val {
    if !replay.truthy() {
        return replay.clone();
    }
    let end = jsmath::max(0.0, jsmath::min(replay.get("n").num(), js::or_zero(until)));
    let mut marked = js::spread(replay);
    marked.set("from", Val::Num(jsmath::max(0.0, jsmath::min(end, js::or_zero(from)))));
    marked.set("until", Val::Num(end));
    Val::Obj(marked)
}

pub fn shown_owners_at(replay: &Val, day: f64) -> Option<Obj> {
    let first = match replay.get("o") {
        Val::Arr(list) if replay.truthy() && !list.is_empty() => list,
        _ => return None,
    };
    let turns = replay.get("f").array_or_empty();
    let mut up_to = 0;
    while up_to < turns.len() && turns[up_to].at(0).num() <= day {
        up_to += 1;
    }
    let mut owners = Obj::new();
    for entry in first {
        owners.set(&js::to_string(entry.at(0)), entry.at(1).clone());
    }
    for turn in &turns[..up_to] {
        owners.set(&js::to_string(turn.at(1)), turn.at(2).clone());
    }
    Some(owners)
}

pub fn replay_day_on(replay: &Val, date: &Val) -> Option<f64> {
    if !replay.truthy() || date.is_nullish() || matches!(date, Val::Str(text) if text.is_empty()) {
        return None;
    }
    let days = diff_game_days(&replay.get("d").string_or_empty(), &date.string_or_empty())?;
    let most = replay.get("n").num();
    Some(if days < 0.0 {
        0.0
    } else if days > most {
        most
    } else {
        days
    })
}

#[derive(Clone, Debug, PartialEq)]
pub struct Read {
    pub date: Val,
    pub days: Val,
    pub start: Val,
    pub end: Val,
    pub tracks: [Vec<Vec<Sample>>; 2],
    pub names: Val,
    pub began: Vec<u8>,
    pub paint: Paint,
}

fn read_replay(replay: &Val, cells: f64) -> Read {
    Read {
        date: replay.get("d").clone(),
        days: replay.get("n").clone(),
        start: replay.get("s").clone(),
        end: replay.get("e").clone(),
        tracks: [decode_tracks(&replay.get("t").at(0).string_or_empty()), decode_tracks(&replay.get("t").at(1).string_or_empty())],
        names: replay.get("names").clone(),
        began: decode_states(&replay.get("m").string_or_empty(), cells),
        paint: decode_paint(&replay.get("p").string_or_empty()),
    }
}

pub fn replay_of(battlefield: &Val) -> Option<Read> {
    let replay = battlefield.get("replay");
    if !replay.truthy() || replay.get("t").as_array().is_none() {
        return None;
    }
    let frame = battlefield.get("frame");
    let side = |key: &str| if frame.get(key).is_nullish() { 0.0 } else { frame.get(key).num() };
    Some(read_replay(replay, side("cols") * side("rows")))
}

pub fn replay_window_of(battlefield: &Val) -> Option<(Val, Val)> {
    let replay = battlefield.get("replay");
    if replay.truthy() && js::is_finite(replay.get("until")) {
        Some((replay.get("from").clone(), replay.get("until").clone()))
    } else {
        None
    }
}

pub fn still_replay_of(battlefield: &Val) -> Val {
    let replay = battlefield.get("replay");
    if !replay.truthy() || replay.get("t").as_array().is_none() {
        return if replay.is_nullish() { Val::Null } else { replay.clone() };
    }
    let read = replay_of(battlefield).unwrap();
    let mut ground = read.began.clone();
    for index in 0..read.paint.cells.len() {
        let cell = read.paint.cells[index] as usize;
        if cell < ground.len() {
            ground[cell] = read.paint.states[index];
        }
    }
    let ends = |text: &Val| -> String {
        let tracks: Vec<Vec<SampleCode>> = decode_tracks(&text.string_or_empty())
            .iter()
            .map(|samples| match samples.last() {
                Some(last) => vec![SampleCode { day: 0.0, x: last.x, y: last.y, strength: last.strength, state: last.state as f64 }],
                None => Vec::new(),
            })
            .collect();
        encode_tracks(&tracks)
    };
    Val::obj([
        ("d", Val::str("")),
        ("n", Val::Num(0.0)),
        ("s", Val::Num(0.0)),
        ("e", Val::Num(0.0)),
        ("t", Val::Arr(vec![Val::str(&ends(replay.get("t").at(0))), Val::str(&ends(replay.get("t").at(1)))])),
        ("names", replay.get("names").clone()),
        ("m", Val::str(&encode_states(&ground))),
        ("p", Val::str("")),
    ])
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct At {
    pub x: f64,
    pub y: f64,
    pub strength: f64,
    pub state: f64,
    pub moving: bool,
}

pub fn track_at(track: &[Step], day: f64) -> Option<At> {
    if track.is_empty() || day < track[0].day {
        return None;
    }
    let last = track[track.len() - 1];
    if day >= last.day {
        return Some(At { x: last.x, y: last.y, strength: last.strength, state: last.state, moving: false });
    }
    let mut index = 1;
    while track[index].day < day {
        index += 1;
    }
    let from = track[index - 1];
    let to = track[index];
    let span = to.day - from.day;
    let part = if span > 0.0 { (day - from.day) / span } else { 1.0 };
    Some(At {
        x: from.x + (to.x - from.x) * part,
        y: from.y + (to.y - from.y) * part,
        strength: from.strength + (to.strength - from.strength) * part,
        state: to.state,
        moving: (to.x - from.x).abs() >= SAME_PLACE || (to.y - from.y).abs() >= SAME_PLACE,
    })
}
