use std::collections::HashMap;
use std::time::Instant;

use serde_json::Value;

use crate::codec::{decode_tracks, decode_troops};
use crate::earcut::earcut;
use crate::frame::{Frame, KM_PER_DEGREE, RAD};
use crate::geometry::{arrow_detail_at, front_arrow_features, front_at, front_troop_features, stage_of, ArrowFeature, ArrowOptions, ArrowShape, Drawing, Replay, Stage, TroopFeature, View};
use crate::jsmath;

const WORLD: f64 = 4096.0;
const UNOWNED_RGB: [f64; 3] = [120.0, 120.0, 120.0];

pub struct Front {
    pub stage: Stage,
    pub until: f64,
}

#[derive(Clone)]
struct OwnerColours {
    colour: String,
    top: String,
    side: String,
}

pub struct FrontFrames {
    fronts: HashMap<String, Front>,
    owners: HashMap<String, OwnerColours>,
    rgb: HashMap<String, [f64; 3]>,
    none: OwnerColours,
    loaded: bool,
}

pub enum Arrow {
    Past { f: f64, rgb: usize, alpha: f64, line: Vec<f64> },
    Shape { f: f64, rgb: usize, dark: usize, alpha: f64, points: Vec<f64>, indices: Vec<usize> },
}

pub struct TroopRow {
    pub x: f64,
    pub y: f64,
    pub side: usize,
    pub index: usize,
    pub command: f64,
    pub rgb: usize,
    pub glyph: &'static str,
    pub strength: f64,
    pub state: &'static str,
    pub named: bool,
    pub moving: bool,
    pub label: String,
    pub f: f64,
}

pub struct SideRow {
    pub x: f64,
    pub y: f64,
    pub side: usize,
    pub command: f64,
    pub rgb: usize,
    pub count: usize,
    pub strength: f64,
    pub f: f64,
}

pub struct FrameOut {
    pub arrows: Vec<Arrow>,
    pub troops: Vec<TroopRow>,
    pub sides: Vec<SideRow>,
    pub colours: Vec<[f64; 3]>,
    pub zoom: Option<f64>,
    pub ms: Option<f64>,
}

fn round2(value: f64) -> f64 {
    jsmath::round(value * 100.0) / 100.0
}

fn project_lng(lng: f64) -> f64 {
    ((lng + 180.0) / 360.0) * WORLD
}

fn project_lat(lat: f64) -> f64 {
    let held = jsmath::max(-85.0511, jsmath::min(85.0511, crate::frame::number_or_zero(lat)));
    (0.5 - jsmath::log(jsmath::tan(std::f64::consts::PI / 4.0 + (held * RAD) / 2.0)) / (2.0 * std::f64::consts::PI)) * WORLD
}

pub fn point(lng: f64, lat: f64) -> [f64; 2] {
    [round2(project_lng(lng)), round2(project_lat(lat))]
}

fn unwrap_after(lng: f64, before: Option<f64>) -> f64 {
    match before {
        Some(before) => lng - jsmath::round((lng - before) / 360.0) * 360.0,
        None => lng,
    }
}

pub fn line_of(coordinates: &[[f64; 2]]) -> Vec<f64> {
    let mut out = Vec::with_capacity(coordinates.len() * 2);
    let mut before: Option<f64> = None;
    for entry in coordinates {
        let lng = entry[0];
        let lat = entry[1];
        if !lng.is_finite() || !lat.is_finite() {
            continue;
        }
        let lng = unwrap_after(lng, before);
        before = Some(lng);
        let [x, y] = point(lng, lat);
        out.push(x);
        out.push(y);
    }
    out
}

pub fn triangulate(ring: &[[f64; 2]]) -> Option<(Vec<f64>, Vec<usize>)> {
    let count = if ring.len() > 1 && ring[0][0] == ring[ring.len() - 1][0] && ring[0][1] == ring[ring.len() - 1][1] { ring.len() - 1 } else { ring.len() };
    if count < 3 {
        return None;
    }
    let mut flat = Vec::with_capacity(count * 2);
    let mut before: Option<f64> = None;
    for entry in &ring[..count] {
        let lng = unwrap_after(entry[0], before);
        before = Some(lng);
        flat.push(round2(project_lng(lng)));
        flat.push(round2(project_lat(entry[1])));
    }
    if flat.len() < 6 {
        return None;
    }
    let indices = earcut(&flat);
    if indices.is_empty() {
        return None;
    }
    Some((flat, indices))
}

fn js_whitespace(unit: char) -> bool {
    matches!(unit, '\u{0009}' | '\u{000A}' | '\u{000B}' | '\u{000C}' | '\u{000D}' | '\u{0020}' | '\u{00A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}')
}

pub fn js_trim(text: &str) -> &str {
    text.trim_matches(js_whitespace)
}

fn number_of(value: &Value) -> f64 {
    match value {
        Value::Number(number) => number.as_f64().unwrap_or(f64::NAN),
        Value::Null => 0.0,
        Value::Bool(flag) => {
            if *flag {
                1.0
            } else {
                0.0
            }
        }
        Value::String(text) => js_number_of_text(text),
        _ => f64::NAN,
    }
}

pub fn js_number_of_text(text: &str) -> f64 {
    let trimmed = js_trim(text);
    if trimmed.is_empty() {
        return 0.0;
    }
    match trimmed {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    let lower = trimmed.to_ascii_lowercase();
    for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] {
        if let Some(digits) = lower.strip_prefix(prefix) {
            return u128::from_str_radix(digits, radix).map(|value| value as f64).unwrap_or(f64::NAN);
        }
    }
    if trimmed.chars().all(|unit| unit.is_ascii_digit() || matches!(unit, '.' | 'e' | 'E' | '+' | '-')) {
        trimmed.parse::<f64>().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

fn string_of(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn number_field(value: &Value, key: &str) -> f64 {
    value.get(key).map(number_of).unwrap_or(f64::NAN)
}

fn optional_number(value: &Value, key: &str) -> f64 {
    match value.get(key) {
        None | Some(Value::Null) => 0.0,
        Some(other) => number_of(other),
    }
}

fn frame_of(value: &Value) -> Frame {
    Frame {
        lng0: number_field(value, "lng0"),
        lat0: number_field(value, "lat0"),
        cell: number_field(value, "cell"),
        cols: number_field(value, "cols"),
        rows: number_field(value, "rows"),
        km: number_field(value, "km"),
        flat: value.get("flat") == Some(&Value::Bool(true)),
        scale: value.get("scale").map(number_of).filter(|scale| *scale > 0.0).unwrap_or(KM_PER_DEGREE),
    }
}

fn view_of(value: &Value) -> View {
    let sides = match value.get("sides") {
        Some(Value::Array(list)) => list
            .iter()
            .map(|side| match side {
                Value::Array(members) => members.iter().map(|member| member.as_str().map(str::to_string)).collect(),
                _ => Vec::new(),
            })
            .collect(),
        _ => Vec::new(),
    };
    let troops_text = |side: usize| -> String { value.get("troops").and_then(|list| list.get(side)).map(string_of).unwrap_or_default() };
    let mut labels = HashMap::new();
    if let Some(Value::Array(list)) = value.get("named") {
        for entry in list {
            if let (Some(key), Some(label)) = (entry.get(0), entry.get(1)) {
                labels.insert(string_of(key), string_of(label));
            }
        }
    }
    let commands = (0..2)
        .map(|side| match value.get("commands").and_then(|list| list.get(side)) {
            Some(Value::Array(list)) => list.iter().map(|entry| if let Value::Number(number) = entry { number.as_f64().unwrap_or(f64::NAN) } else { f64::NAN }).collect(),
            _ => Vec::new(),
        })
        .collect();
    let replay = match value.get("replay") {
        Some(replay @ Value::Object(_)) => {
            let tracks_text = |side: usize| -> String { replay.get("t").and_then(|list| list.get(side)).map(string_of).unwrap_or_default() };
            Some(Replay {
                start: optional_number(replay, "s"),
                end: optional_number(replay, "e"),
                days: optional_number(replay, "n"),
                tracks: vec![decode_tracks(&tracks_text(0)), decode_tracks(&tracks_text(1))],
            })
        }
        _ => None,
    };
    View {
        name: value.get("name").map(string_of).unwrap_or_default(),
        status: value.get("status").map(string_of).unwrap_or_default(),
        sides,
        frame: frame_of(value.get("frame").unwrap_or(&Value::Null)),
        troops: vec![decode_troops(&troops_text(0)), decode_troops(&troops_text(1))],
        labels,
        commands,
        replay,
    }
}

struct Palette {
    list: Vec<[f64; 3]>,
    known: HashMap<String, usize>,
}

impl Palette {
    fn of(&mut self, css: &str, rgb: &HashMap<String, [f64; 3]>) -> usize {
        if let Some(&at) = self.known.get(css) {
            return at;
        }
        self.list.push(rgb.get(css).copied().unwrap_or(UNOWNED_RGB));
        self.known.insert(css.to_string(), self.list.len() - 1);
        self.list.len() - 1
    }
}

impl Default for FrontFrames {
    fn default() -> Self {
        Self::new()
    }
}

impl FrontFrames {
    pub fn new() -> Self {
        Self { fronts: HashMap::new(), owners: HashMap::new(), rgb: HashMap::new(), none: OwnerColours { colour: String::new(), top: String::new(), side: String::new() }, loaded: false }
    }

    pub fn clear(&mut self) {
        self.fronts.clear();
        self.owners.clear();
        self.rgb.clear();
        self.loaded = false;
    }

    pub fn loaded(&self) -> bool {
        self.loaded
    }

    pub fn front_count(&self) -> usize {
        self.fronts.len()
    }

    pub fn load_json(&mut self, text: &str) -> Result<(), String> {
        let value: Value = serde_json::from_str(text).map_err(|error| error.to_string())?;
        self.load(&value);
        Ok(())
    }

    pub fn load(&mut self, value: &Value) {
        self.clear();
        if let Some(Value::Array(list)) = value.get("fronts") {
            for entry in list {
                let view = view_of(entry);
                let key = view.name.clone();
                let until = entry.get("until").map(number_of).unwrap_or(f64::NAN);
                self.fronts.insert(key, Front { stage: stage_of(view), until });
            }
        }
        if let Some(Value::Array(list)) = value.get("owners") {
            for entry in list {
                let text = |at: usize| entry.get(at).map(string_of).unwrap_or_default();
                self.owners.insert(text(0), OwnerColours { colour: text(1), top: text(2), side: text(3) });
            }
        }
        if let Some(Value::Array(list)) = value.get("rgb") {
            for entry in list {
                let key = entry.get(0).map(string_of).unwrap_or_default();
                let parts = entry.get(1).and_then(Value::as_array).cloned().unwrap_or_default();
                let part = |at: usize| parts.get(at).map(number_of).unwrap_or(f64::NAN);
                self.rgb.insert(key, [part(0), part(1), part(2)]);
            }
        }
        self.loaded = true;
    }

    fn colours_of(&self, owner: &str) -> &OwnerColours {
        self.owners.get(owner).unwrap_or(&self.none)
    }

    pub fn frame(&self, days: &[(String, f64)], zoom: f64) -> FrameOut {
        let began = Instant::now();
        if !self.loaded {
            return FrameOut { arrows: Vec::new(), troops: Vec::new(), sides: Vec::new(), colours: Vec::new(), zoom: None, ms: None };
        }
        let mut drawn: Vec<Option<Drawing<'_>>> = Vec::new();
        let mut day_list: Vec<f64> = Vec::new();
        let mut names: Vec<&str> = Vec::new();
        for (name, day) in days {
            let name = js_trim(name);
            let Some(front) = self.fronts.get(name) else { continue };
            let day = if day.is_finite() { *day } else { front.until };
            drawn.push(front_at(&front.stage, day));
            day_list.push(day);
            names.push(name);
        }
        let level = if zoom.is_nan() || zoom == 0.0 { 5.0 } else { zoom };
        let detail = arrow_detail_at(level);
        let scale = jsmath::pow2(level);
        let cells_of = |px: f64| move |stage: &Stage| (px * 360.0) / (stage.view.frame.cell * 512.0 * scale);
        let half_width_of = cells_of(detail.half_width);
        let reach_of = cells_of(detail.reach);
        let least_of = cells_of(detail.least);
        let options = ArrowOptions { day: &day_list, half_width_of: &half_width_of, reach_of: &reach_of, least_of: &least_of, still: detail.still, share: detail.share, days: detail.days };
        let mut arrows: Vec<ArrowFeature> = Vec::new();
        front_arrow_features(&drawn, &options, &mut arrows);
        let mut troops: Vec<(usize, TroopFeature)> = Vec::new();
        front_troop_features(&drawn, &mut troops);
        let mut palette = Palette { list: Vec::new(), known: HashMap::new() };
        let mut name_index: HashMap<&str, usize> = HashMap::new();
        for (index, name) in names.iter().enumerate() {
            name_index.insert(name, index);
        }
        let field_of = |at: usize| -> f64 {
            let name = names[at];
            name_index.get(name).map(|&index| index as f64).unwrap_or(-1.0)
        };
        let mut out_arrows = Vec::new();
        for feature in &arrows {
            let colours = self.colours_of(&feature.owner);
            let f = field_of(feature.drawing);
            let alpha = if feature.alpha.is_nan() { 0.0 } else { feature.alpha };
            match &feature.shape {
                ArrowShape::Line(line) => {
                    let rgb = palette.of(&colours.top, &self.rgb);
                    out_arrows.push(Arrow::Past { f, rgb, alpha, line: line_of(line) });
                }
                ArrowShape::Ring(ring) => {
                    let Some((points, indices)) = triangulate(ring) else { continue };
                    let rgb = palette.of(&colours.top, &self.rgb);
                    let dark = palette.of(&colours.side, &self.rgb);
                    out_arrows.push(Arrow::Shape { f, rgb, dark, alpha, points, indices });
                }
            }
        }
        let mut out_troops = Vec::new();
        let mut out_sides = Vec::new();
        for (at, feature) in troops {
            let f = field_of(at);
            match feature {
                TroopFeature::Side { at: [lng, lat], side, command, owner, count, strength } => {
                    let [x, y] = point(lng, lat);
                    let rgb = palette.of(&self.colours_of(owner).colour, &self.rgb);
                    out_sides.push(SideRow { x, y, side, command, rgb, count, strength, f });
                }
                TroopFeature::Troop { at: [lng, lat], side, index, command, owner, glyph, strength, state, named, moving, label } => {
                    let [x, y] = point(lng, lat);
                    let rgb = palette.of(&self.colours_of(owner).colour, &self.rgb);
                    out_troops.push(TroopRow { x, y, side, index, command, rgb, glyph, strength, state, named, moving, label: label.to_string(), f });
                }
            }
        }
        let ms = jsmath::round(began.elapsed().as_secs_f64() * 1000.0 * 10.0) / 10.0;
        FrameOut { arrows: out_arrows, troops: out_troops, sides: out_sides, colours: palette.list, zoom: Some(level), ms: Some(ms) }
    }
}

impl FrameOut {
    pub fn to_json(&self) -> Value {
        use serde_json::json;
        if self.zoom.is_none() {
            return json!({ "arrows": [], "troops": [], "sides": [], "colours": [] });
        }
        let arrows: Vec<Value> = self
            .arrows
            .iter()
            .map(|arrow| match arrow {
                Arrow::Past { f, rgb, alpha, line } => json!({ "past": true, "f": f, "rgb": rgb, "alpha": alpha, "line": line }),
                Arrow::Shape { f, rgb, dark, alpha, points, indices } => json!({ "past": false, "f": f, "rgb": rgb, "dark": dark, "alpha": alpha, "points": points, "indices": indices }),
            })
            .collect();
        let troops: Vec<Value> = self
            .troops
            .iter()
            .map(|row| json!([row.x, row.y, row.side, row.index, row.command, row.rgb, row.glyph, row.strength, row.state, if row.named { 1 } else { 0 }, if row.moving { 1 } else { 0 }, row.label, row.f]))
            .collect();
        let sides: Vec<Value> = self.sides.iter().map(|row| json!([row.x, row.y, row.side, row.command, row.rgb, row.count, row.strength, row.f])).collect();
        json!({ "arrows": arrows, "troops": troops, "sides": sides, "colours": self.colours, "zoom": self.zoom, "ms": self.ms })
    }
}
