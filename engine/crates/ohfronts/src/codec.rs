pub const TROOP_UNITS: f64 = 16.0;
pub const TROOP_LETTERS: usize = 7;
pub const TRACK_LETTERS: usize = 8;
pub const TROOP_KINDS: [&str; 3] = ["infantry", "armor", "artillery"];
pub const TROOP_STATES: [&str; 5] = ["holding", "advancing", "encircled", "spent", "dug in"];

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

pub struct BitReader<'a> {
    source: &'a [u16],
    index: usize,
    pending: i32,
    bits: i32,
}

impl<'a> BitReader<'a> {
    pub fn new(source: &'a [u16]) -> Self {
        Self { source, index: 0, pending: 0, bits: 0 }
    }

    pub fn read(&mut self, width: u32) -> f64 {
        let mut value = 0.0f64;
        for _ in 0..width {
            if self.bits == 0 {
                let letter = if self.index < self.source.len() { value_of(self.source[self.index]) } else { -1 };
                self.index += 1;
                self.pending = if letter < 0 { 0 } else { letter };
                self.bits = 6;
            }
            self.bits -= 1;
            value = value * 2.0 + ((self.pending >> self.bits) & 1) as f64;
        }
        value
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Troop {
    pub x: f64,
    pub y: f64,
    pub strength: f64,
    pub kind: usize,
    pub owner: usize,
    pub named: bool,
    pub dig: f64,
    pub state: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Sample {
    pub day: f64,
    pub x: f64,
    pub y: f64,
    pub strength: f64,
    pub state: usize,
}

pub fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

pub fn decode_troops(text: &str) -> Vec<Troop> {
    let source = units(text);
    let mut reader = BitReader::new(&source);
    let count = source.len() / TROOP_LETTERS;
    let mut troops = Vec::with_capacity(count);
    for _ in 0..count {
        let x = reader.read(12) / TROOP_UNITS;
        let y = reader.read(12) / TROOP_UNITS;
        let strength = (reader.read(6) * 100.0) / 63.0;
        let kind = (reader.read(2) as usize).min(TROOP_KINDS.len() - 1);
        let owner = reader.read(3) as usize;
        let named = reader.read(1) == 1.0;
        let dig = reader.read(3) / 7.0;
        let state = (reader.read(3) as usize).min(TROOP_STATES.len() - 1);
        troops.push(Troop { x, y, strength, kind, owner, named, dig, state });
    }
    troops
}

fn decode_track(source: &[u16]) -> Vec<Sample> {
    let mut reader = BitReader::new(source);
    let count = source.len() / TRACK_LETTERS;
    let mut samples = Vec::with_capacity(count);
    for _ in 0..count {
        let day = reader.read(12);
        let x = reader.read(12) / TROOP_UNITS;
        let y = reader.read(12) / TROOP_UNITS;
        let strength = reader.read(7).min(100.0);
        let state = (reader.read(3) as usize).min(TROOP_STATES.len() - 1);
        reader.read(2);
        samples.push(Sample { day, x, y, strength, state });
    }
    samples
}

pub fn decode_tracks(text: &str) -> Vec<Vec<Sample>> {
    if text.is_empty() {
        return Vec::new();
    }
    let source = units(text);
    source.split(|&unit| unit == ';' as u16).map(decode_track).collect()
}
