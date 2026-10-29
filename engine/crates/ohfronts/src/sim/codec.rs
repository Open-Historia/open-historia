use super::constants::{BAND_CELLS, HOLDER_SIDE_A, HOLDER_SIDE_B, HOLDER_WALL, LINE_UNITS, TROOP_KINDS, TROOP_STATES, TROOP_UNITS};
use super::js::{self, or_zero, Val};
use super::unit_motion::hash_seed;
use crate::jsmath;

pub use crate::codec::{decode_tracks, decode_troops, BitReader, Sample, Troop};

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

fn value_of(code: u16) -> i32 {
    if code >= 128 {
        return -1;
    }
    match ALPHABET.iter().position(|&letter| letter as u16 == code) {
        Some(at) => at as i32,
        None => -1,
    }
}

pub fn is_packed_text(text: &str) -> bool {
    text.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b';' || b == b'-')
}

pub fn clamp_int(value: f64, min: f64, max: f64) -> f64 {
    let number = jsmath::round(if value.is_nan() { 0.0 } else { value });
    let number = if number == 0.0 { 0.0 } else { number };
    if number < min {
        min
    } else if number > max {
        max
    } else {
        number
    }
}


pub struct BitWriter {
    letters: Vec<u8>,
    pending: u32,
    bits: u32,
}

impl Default for BitWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl BitWriter {
    pub fn new() -> Self {
        Self { letters: Vec::new(), pending: 0, bits: 0 }
    }

    pub fn write(&mut self, value: f64, width: u32) {
        let value = js::to_uint32(value);
        for shift in (0..width).rev() {
            self.pending = (self.pending << 1) | ((value.checked_shr(shift).unwrap_or(0)) & 1);
            self.bits += 1;
            if self.bits == 6 {
                self.letters.push(ALPHABET[self.pending as usize]);
                self.pending = 0;
                self.bits = 0;
            }
        }
    }

    pub fn end(&mut self) -> String {
        if self.bits > 0 {
            self.letters.push(ALPHABET[(self.pending << (6 - self.bits)) as usize]);
        }
        self.pending = 0;
        self.bits = 0;
        String::from_utf8(std::mem::take(&mut self.letters)).unwrap()
    }
}

const RUN_BITS: u32 = 10;
const RUN_MAX: usize = 1 << RUN_BITS;

pub fn encode_mask(holders: &[u8]) -> String {
    let mut writer = BitWriter::new();
    let length = holders.len();
    let mut index = 0;
    while index < length {
        let holder = holders[index] & 3;
        let mut run = 1;
        while index + run < length && run < RUN_MAX && (holders[index + run] & 3) == holder {
            run += 1;
        }
        writer.write(holder as f64, 2);
        writer.write((run - 1) as f64, RUN_BITS);
        index += run;
    }
    writer.end()
}

pub fn length_of(length: f64) -> usize {
    let value = or_zero(length).floor();
    if value > 0.0 {
        value as usize
    } else {
        0
    }
}

fn read_runs(text: &str, values: &mut [u8], letters: usize, value_bits: u32, run_bits: u32, wall: Option<u8>) {
    let source = js::units(text);
    let mut reader = BitReader::new(&source);
    let runs = source.len() / letters;
    let mut index = 0;
    let mut run = 0;
    while run < runs && index < values.len() {
        let value = reader.read(value_bits) as u8;
        let end = values.len().min(index + reader.read(run_bits) as usize + 1);
        let value = match wall {
            Some(wall) if value > wall => wall,
            _ => value,
        };
        values[index..end].fill(value);
        index = end;
        run += 1;
    }
}

pub fn decode_mask(text: &str, length: f64) -> Vec<u8> {
    let mut holders = vec![HOLDER_WALL as u8; length_of(length)];
    read_runs(text, &mut holders, 2, 2, RUN_BITS, Some(HOLDER_WALL as u8));
    holders
}

pub fn decode_four_mask(text: &str, length: f64) -> Vec<u8> {
    let mut values = vec![0u8; length_of(length)];
    read_runs(text, &mut values, 2, 2, RUN_BITS, None);
    values
}

pub fn band_indices(holders: &[u8], cols: usize, rows: usize, reach: f64) -> Vec<i32> {
    let size = cols * rows;
    let near = |side: u8| -> Vec<u8> {
        let mut along = vec![0u8; size];
        for row in 0..rows {
            let base = row * cols;
            let mut last = f64::NEG_INFINITY;
            for col in 0..cols {
                if holders.get(base + col) == Some(&side) {
                    last = col as f64;
                }
                if col as f64 - last <= reach {
                    along[base + col] = 1;
                }
            }
            let mut next = f64::INFINITY;
            for col in (0..cols).rev() {
                if holders.get(base + col) == Some(&side) {
                    next = col as f64;
                }
                if next - col as f64 <= reach {
                    along[base + col] = 1;
                }
            }
        }
        let mut hit = vec![0u8; size];
        for col in 0..cols {
            let mut last = f64::NEG_INFINITY;
            for row in 0..rows {
                if along[row * cols + col] != 0 {
                    last = row as f64;
                }
                if row as f64 - last <= reach {
                    hit[row * cols + col] = 1;
                }
            }
            let mut next = f64::INFINITY;
            for row in (0..rows).rev() {
                if along[row * cols + col] != 0 {
                    next = row as f64;
                }
                if next - row as f64 <= reach {
                    hit[row * cols + col] = 1;
                }
            }
        }
        hit
    };
    let near_a = near(HOLDER_SIDE_A as u8);
    let near_b = near(HOLDER_SIDE_B as u8);
    let mut cells = Vec::new();
    for index in 0..size {
        let holder = holders.get(index).copied();
        if (holder == Some(HOLDER_SIDE_A as u8) && near_b[index] != 0) || (holder == Some(HOLDER_SIDE_B as u8) && near_a[index] != 0) {
            cells.push(index as i32);
        }
    }
    cells
}

pub fn band_indices_default(holders: &[u8], cols: usize, rows: usize) -> Vec<i32> {
    band_indices(holders, cols, rows, BAND_CELLS)
}

pub fn encode_band(values: &[f64]) -> String {
    let mut writer = BitWriter::new();
    for &value in values {
        writer.write(clamp_int(value, -127.0, 127.0) + 128.0, 8);
    }
    writer.end()
}

pub fn decode_band(text: &str, count: f64) -> Vec<i8> {
    let size = length_of(count);
    let mut values = vec![0i8; size];
    let source = js::units(text);
    let mut reader = BitReader::new(&source);
    let stored = size.min((source.len() * 6) / 8);
    for value in values.iter_mut().take(stored) {
        *value = clamp_int(reader.read(8) - 128.0, -127.0, 127.0) as i8;
    }
    values
}

pub const TROOP_LETTERS: usize = 7;

pub fn index_in(list: &[&str], value: &Val) -> f64 {
    if let Val::Num(number) = value {
        return *number;
    }
    let text = value.string_or_empty();
    match list.iter().position(|item| *item == text) {
        Some(at) => at as f64,
        None => 0.0,
    }
}

#[derive(Clone, Debug, Default)]
pub struct TroopCode {
    pub x: f64,
    pub y: f64,
    pub strength: f64,
    pub kind: f64,
    pub owner: f64,
    pub named: bool,
    pub dig: f64,
    pub state: f64,
}

pub fn encode_troops(troops: &[TroopCode]) -> String {
    let mut writer = BitWriter::new();
    for troop in troops {
        writer.write(clamp_int(or_zero(troop.x) * TROOP_UNITS, 0.0, 4095.0), 12);
        writer.write(clamp_int(or_zero(troop.y) * TROOP_UNITS, 0.0, 4095.0), 12);
        writer.write(clamp_int((or_zero(troop.strength) * 63.0) / 100.0, 0.0, 63.0), 6);
        writer.write(clamp_int(troop.kind, 0.0, (TROOP_KINDS.len() - 1) as f64), 2);
        writer.write(clamp_int(troop.owner, 0.0, 7.0), 3);
        writer.write(if troop.named { 1.0 } else { 0.0 }, 1);
        writer.write(clamp_int(or_zero(troop.dig) * 7.0, 0.0, 7.0), 3);
        writer.write(clamp_int(troop.state, 0.0, (TROOP_STATES.len() - 1) as f64), 3);
    }
    writer.end()
}

pub fn encode_levels(values: &[f64]) -> String {
    let mut text = String::with_capacity(values.len());
    for &value in values {
        text.push(ALPHABET[clamp_int(or_zero(value) * 63.0, 0.0, 63.0) as usize] as char);
    }
    text
}

pub fn decode_levels(text: &str) -> Vec<f64> {
    text.encode_utf16()
        .map(|code| {
            let value = value_of(code);
            if value > 0 {
                value as f64 / 63.0
            } else {
                0.0
            }
        })
        .collect()
}

const LINE_MAX: f64 = ((1 << 13) - 1) as f64;
const STEP_MAX: f64 = 127.0;

fn line_unit(value: f64) -> f64 {
    clamp_int(or_zero(value) * LINE_UNITS, 0.0, LINE_MAX)
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Strand {
    pub closed: bool,
    pub points: Vec<[f64; 2]>,
    pub flags: Vec<f64>,
}

fn encode_strand(strand: &Strand) -> String {
    let points = &strand.points;
    if points.is_empty() {
        return String::new();
    }
    let flag_at = |index: usize| -> f64 { (js::to_int32(strand.flags.get(index).copied().unwrap_or(0.0)) & 3) as f64 };
    let mut writer = BitWriter::new();
    let mut x = line_unit(points[0][0]);
    let mut y = line_unit(points[0][1]);
    writer.write(if strand.closed { 1.0 } else { 0.0 }, 1);
    writer.write(0.0, 5);
    writer.write(x, 13);
    writer.write(y, 13);
    writer.write(flag_at(0), 2);
    writer.write(0.0, 2);
    for (index, point) in points.iter().enumerate().skip(1) {
        let to_x = line_unit(point[0]);
        let to_y = line_unit(point[1]);
        if to_x == x && to_y == y {
            continue;
        }
        let flag = flag_at(index);
        let from_x = x;
        let from_y = y;
        let parts = (jsmath::max((to_x - from_x).abs(), (to_y - from_y).abs()) / STEP_MAX).ceil();
        let mut part = 1.0;
        while part <= parts {
            let next_x = if part == parts { to_x } else { jsmath::round(from_x + ((to_x - from_x) * part) / parts) };
            let next_y = if part == parts { to_y } else { jsmath::round(from_y + ((to_y - from_y) * part) / parts) };
            writer.write(next_x - x + 128.0, 8);
            writer.write(next_y - y + 128.0, 8);
            writer.write(flag, 2);
            x = next_x;
            y = next_y;
            part += 1.0;
        }
    }
    writer.end()
}

fn decode_strand(source: &[u16]) -> Option<Strand> {
    if source.len() < 6 {
        return None;
    }
    let mut reader = BitReader::new(source);
    let closed = reader.read(1) == 1.0;
    reader.read(5);
    let mut x = reader.read(13);
    let mut y = reader.read(13);
    let mut points = vec![[x / LINE_UNITS, y / LINE_UNITS]];
    let mut flags = vec![reader.read(2)];
    reader.read(2);
    let more = (source.len() - 6) / 3;
    for _ in 0..more {
        x += reader.read(8) - 128.0;
        y += reader.read(8) - 128.0;
        points.push([x / LINE_UNITS, y / LINE_UNITS]);
        flags.push(reader.read(2));
    }
    Some(Strand { closed, points, flags })
}

pub fn encode_lines(strands: &[Strand]) -> String {
    strands.iter().map(encode_strand).filter(|text| !text.is_empty()).collect::<Vec<_>>().join(";")
}

pub fn decode_lines(text: &str) -> Vec<Strand> {
    let source = js::units(text);
    source.split(|&unit| unit == b';' as u16).filter_map(decode_strand).collect()
}

pub const TRACK_LETTERS: usize = 8;
pub const TRACK_DAY_MAX: f64 = 4095.0;

#[derive(Clone, Debug, Default)]
pub struct SampleCode {
    pub day: f64,
    pub x: f64,
    pub y: f64,
    pub strength: f64,
    pub state: f64,
}

fn encode_track(samples: &[SampleCode]) -> String {
    let mut writer = BitWriter::new();
    for sample in samples {
        writer.write(clamp_int(sample.day, 0.0, TRACK_DAY_MAX), 12);
        writer.write(clamp_int(or_zero(sample.x) * TROOP_UNITS, 0.0, 4095.0), 12);
        writer.write(clamp_int(or_zero(sample.y) * TROOP_UNITS, 0.0, 4095.0), 12);
        writer.write(clamp_int(sample.strength, 0.0, 100.0), 7);
        writer.write(clamp_int(sample.state, 0.0, (TROOP_STATES.len() - 1) as f64), 3);
        writer.write(0.0, 2);
    }
    writer.end()
}

pub fn encode_tracks(tracks: &[Vec<SampleCode>]) -> String {
    tracks.iter().map(|track| encode_track(track)).collect::<Vec<_>>().join(";")
}

const STATE_BITS: u32 = 5;
const STATE_RUN_BITS: u32 = 13;
const STATE_RUN_MAX: usize = 1 << STATE_RUN_BITS;
pub const PAINT_OWN_A: f64 = 0.0;
pub const PAINT_WALL: f64 = ((1 << STATE_BITS) - 1) as f64;
pub const PAINT_OWN_B: f64 = PAINT_WALL - 1.0;
pub const PAINT_NAMES_MAX: f64 = PAINT_OWN_B - 1.0;

pub fn encode_states(states: &[u8]) -> String {
    let mut writer = BitWriter::new();
    let wall = PAINT_WALL as u8;
    let length = states.len();
    let mut index = 0;
    while index < length {
        let state = states[index] & wall;
        let mut run = 1;
        while index + run < length && run < STATE_RUN_MAX && (states[index + run] & wall) == state {
            run += 1;
        }
        writer.write(state as f64, STATE_BITS);
        writer.write((run - 1) as f64, STATE_RUN_BITS);
        index += run;
    }
    writer.end()
}

pub fn decode_states(text: &str, length: f64) -> Vec<u8> {
    let mut states = vec![PAINT_WALL as u8; length_of(length)];
    read_runs(text, &mut states, 3, STATE_BITS, STATE_RUN_BITS, None);
    states
}

pub const PAINT_TICKS_PER_DAY: f64 = 16.0;
pub const PAINT_LETTERS: usize = 6;
const PAINT_WAIT: f64 = 63.0;
const PAINT_NO_CELL: f64 = 65535.0;
const PAINT_RUN_BITS: u32 = 6;
const PAINT_RUN_MAX: usize = 1 << PAINT_RUN_BITS;

#[derive(Clone, Debug, Default)]
pub struct PaintChange {
    pub tick: f64,
    pub cell: f64,
    pub state: f64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Paint {
    pub ticks: Vec<u32>,
    pub cells: Vec<u16>,
    pub states: Vec<u8>,
}

pub fn encode_paint(changes: &[PaintChange]) -> String {
    let mut writer = BitWriter::new();
    let tick_of = |change: &PaintChange| clamp_int(change.tick, 0.0, 2147483647.0);
    let cell_of = |change: &PaintChange| clamp_int(change.cell, 0.0, PAINT_NO_CELL - 1.0);
    let state_of = |change: &PaintChange| clamp_int(change.state, 0.0, PAINT_WALL);
    let mut at = 0.0f64;
    let mut index = 0;
    while index < changes.len() {
        let tick = jsmath::max(at, tick_of(&changes[index]));
        let cell = cell_of(&changes[index]);
        let state = state_of(&changes[index]);
        let mut run = 1;
        while index + run < changes.len()
            && run < PAINT_RUN_MAX
            && cell_of(&changes[index + run]) == cell + run as f64
            && state_of(&changes[index + run]) == state
            && jsmath::max(tick, tick_of(&changes[index + run])) == tick
        {
            run += 1;
        }
        while tick - at >= PAINT_WAIT {
            writer.write(PAINT_WAIT, 6);
            writer.write(PAINT_NO_CELL, 16);
            writer.write(0.0, 14);
            at += PAINT_WAIT;
        }
        writer.write(tick - at, 6);
        writer.write(cell, 16);
        writer.write(state, STATE_BITS);
        writer.write((run - 1) as f64, PAINT_RUN_BITS);
        writer.write(0.0, 3);
        at = tick;
        index += run;
    }
    writer.end()
}

pub fn decode_paint(text: &str) -> Paint {
    let source = js::units(text);
    let mut reader = BitReader::new(&source);
    let entries = source.len() / PAINT_LETTERS;
    let mut paint = Paint::default();
    let mut at = 0.0f64;
    for _ in 0..entries {
        let wait = reader.read(6);
        let cell = reader.read(16);
        let state = reader.read(STATE_BITS);
        let run = reader.read(PAINT_RUN_BITS) + 1.0;
        reader.read(3);
        at += wait;
        if wait == PAINT_WAIT && cell == PAINT_NO_CELL {
            continue;
        }
        let mut step = 0.0;
        while step < run && cell + step < PAINT_NO_CELL {
            paint.ticks.push(at as u32);
            paint.cells.push((cell + step) as u16);
            paint.states.push(state as u8);
            step += 1.0;
        }
    }
    paint
}

pub fn hash_key(parts: &[&str]) -> String {
    js::integer_radix(hash_seed(&parts.join("\u{0001}")) as f64, 36)
}
