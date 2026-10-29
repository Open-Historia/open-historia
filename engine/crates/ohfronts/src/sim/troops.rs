use super::constants::CONTROL_RADIUS_MAX_KM;
use super::js::Val;

pub const KIND_INFANTRY: f64 = 0.0;
pub const KIND_ARMOUR: f64 = 1.0;
pub const KIND_ARTILLERY: f64 = 2.0;
pub const STATE_HOLDING: f64 = 0.0;
pub const STATE_ADVANCING: f64 = 1.0;
pub const STATE_ENCIRCLED: f64 = 2.0;
pub const STATE_SPENT: f64 = 3.0;
pub const STATE_DUG_IN: f64 = 4.0;

#[derive(Clone, Debug, PartialEq)]
pub struct Troop {
    pub x: f64,
    pub y: f64,
    pub strength: f64,
    pub kind: f64,
    pub owner: f64,
    pub named: bool,
    pub dig: f64,
    pub state: f64,
    pub radius_km: f64,
    pub drive: f64,
    pub depth: f64,
    pub lane: f64,
    pub lag: f64,
    pub drawn: bool,
    pub hx: f64,
    pub hy: f64,
    pub axis_x: f64,
    pub axis_y: f64,
    pub station: Val,
    pub stepping: bool,
    pub walked_today: bool,
    pub flank: f64,
    pub flank_moment: f64,
    pub face_x: f64,
    pub face_y: f64,
    pub moved_km: f64,
    pub loss: f64,
    pub engaged: bool,
    pub dug: bool,
    pub order: Val,
    pub serves: f64,
    pub next: f64,
    pub command: f64,
    pub gx: f64,
    pub gy: f64,
    pub pace_factor: f64,
    pub reducing: bool,
    pub plant: bool,
    pub fallback: Val,
    pub stranded: f64,
    pub adrift: f64,
    pub gave: f64,
    pub slid: bool,
    pub pinned: f64,
    pub rested: f64,
    pub spent: f64,
    pub body: f64,
    pub pocket: bool,
    pub sealed: bool,
    pub squeezed: bool,
    pub besieged: bool,
    pub supply: f64,
    pub fatigue: f64,
    pub punch: f64,
    pub guard: f64,
    pub legs: f64,
    pub fought: bool,
    pub walled: Val,
    pub entry: Val,
    pub still: Val,
    pub climate: Val,
}

#[derive(Clone, Copy, Debug)]
pub struct TroopSeed {
    pub x: f64,
    pub y: f64,
    pub strength: f64,
    pub kind: f64,
    pub owner: f64,
    pub named: bool,
    pub dig: f64,
    pub state: f64,
}

impl Default for TroopSeed {
    fn default() -> Self {
        TroopSeed { x: 0.0, y: 0.0, strength: 100.0, kind: KIND_INFANTRY, owner: 0.0, named: false, dig: 0.0, state: STATE_HOLDING }
    }
}

pub fn create_troop(seed: TroopSeed) -> Troop {
    let TroopSeed { x, y, strength, kind, owner, named, dig, state } = seed;
    Troop {
        x,
        y,
        strength,
        kind,
        owner,
        named,
        dig,
        state,
        radius_km: CONTROL_RADIUS_MAX_KM,
        drive: 1.0,
        depth: 1.0,
        lane: 0.0,
        lag: 0.0,
        drawn: false,
        hx: 0.0,
        hy: 0.0,
        axis_x: 0.0,
        axis_y: 0.0,
        station: Val::Null,
        stepping: false,
        walked_today: false,
        flank: 1.0,
        flank_moment: -1.0,
        face_x: 0.0,
        face_y: 0.0,
        moved_km: 0.0,
        loss: 0.0,
        engaged: false,
        dug: state == STATE_DUG_IN || (state == STATE_ENCIRCLED && dig >= 1.0),
        order: Val::Null,
        serves: -1.0,
        next: -1.0,
        command: -1.0,
        gx: 0.0,
        gy: 0.0,
        pace_factor: 1.0,
        reducing: false,
        plant: false,
        fallback: Val::Null,
        stranded: 0.0,
        adrift: 0.0,
        gave: -1000.0,
        slid: false,
        pinned: -9.0,
        rested: 0.0,
        spent: 0.0,
        body: -1.0,
        pocket: false,
        sealed: false,
        squeezed: false,
        besieged: false,
        supply: 1.0,
        fatigue: 0.0,
        punch: 1.0,
        guard: 1.0,
        legs: 1.0,
        fought: false,
        walled: Val::Undef,
        entry: Val::Undef,
        still: Val::Undef,
        climate: Val::Undef,
    }
}

pub fn is_live(troop: &Troop) -> bool {
    troop.strength > 0.0
}

pub fn live_count(troops: &[Troop]) -> usize {
    troops.iter().filter(|troop| troop.strength > 0.0).count()
}

pub fn troops_factor(value: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        crate::jsmath::max(super::constants::TROOPS_FACTOR_LEAST, crate::jsmath::min(super::constants::TROOPS_FACTOR_MOST, value))
    } else {
        1.0
    }
}
