use super::constants::MUSTER_STANDING_SHARE;
use super::game_dates::compare_game_dates;
use super::js::Val;
use crate::jsmath;

pub fn musters_for(muster_on: bool, authored: bool, war_began: &Val, game_began: &Val) -> bool {
    muster_on && !authored && war_began.truthy() && game_began.truthy() && compare_game_dates(&war_began.string_or_empty(), &game_began.string_or_empty()) > 0.0
}

pub fn muster_share(table: Option<&[Val]>, days: f64) -> f64 {
    let table = match table {
        Some(table) if !table.is_empty() && days >= 0.0 => table,
        _ => return 1.0,
    };
    let at = days.floor();
    let called = if at >= table.len() as f64 { 1.0 } else { table[at as usize].num() };
    MUSTER_STANDING_SHARE + (1.0 - MUSTER_STANDING_SHARE) * called
}

pub fn head_start_of(head: &Val, starter: bool) -> f64 {
    if starter {
        jsmath::max(0.0, jsmath::round(super::js::or_zero(head.num())))
    } else {
        0.0
    }
}

pub fn spread_pick(count: f64, keep: f64) -> Vec<usize> {
    let mut picked = Vec::new();
    if keep <= 0.0 {
        return picked;
    }
    let mut at = 0.0;
    while at < count {
        if (((at + 1.0) * keep) / count).floor() > ((at * keep) / count).floor() {
            picked.push(at as usize);
        }
        at += 1.0;
    }
    picked
}

#[derive(Clone, Debug, PartialEq)]
pub struct Levy {
    pub o: f64,
    pub t: f64,
    pub r: f64,
    pub f: String,
}

pub fn read_levy(value: &Val) -> [Vec<Levy>; 2] {
    let side = |at: usize| -> Vec<Levy> {
        value
            .get(&at.to_string())
            .array_or_empty()
            .iter()
            .filter_map(|entry| {
                entry.as_array()?;
                let o = match entry.at(0) {
                    Val::Num(n) if n.is_finite() && n.trunc() == *n && *n >= 0.0 => *n,
                    _ => return None,
                };
                let f = match entry.at(3) {
                    Val::Str(text) if !text.is_empty() => text.clone(),
                    _ => return None,
                };
                if !(entry.at(1).num() > 0.0) || !(entry.at(2).num() >= 0.0) {
                    return None;
                }
                let t = entry.at(1).num().floor();
                Some(Levy { o, t, r: jsmath::min(t, entry.at(2).num().floor()), f })
            })
            .collect()
    };
    [side(0), side(1)]
}

pub fn levy_pending(levy: &[Levy]) -> f64 {
    levy.iter().fold(0.0, |sum, entry| sum + jsmath::max(0.0, entry.t - entry.r))
}

pub fn levy_owed(levy: &[Vec<Levy>; 2]) -> bool {
    levy_pending(&levy[0]) + levy_pending(&levy[1]) > 0.0
}
