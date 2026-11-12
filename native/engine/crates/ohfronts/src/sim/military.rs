use super::js::Val;

pub const QUALITY_FACTORS: [f64; 2] = [0.5, 1.5];
pub const TECHNOLOGY_FACTORS: [f64; 2] = [0.7, 1.3];
pub const ARM_FACTORS: [f64; 2] = [0.5, 1.5];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Military {
    pub quality: f64,
    pub technology: f64,
    pub land: f64,
    pub sea: f64,
    pub air: f64,
    pub manpower_share: Option<f64>,
    pub cavalry_share: Option<f64>,
    pub siege_share: Option<f64>,
    pub men_per_counter: Option<f64>,
}

pub const MILITARY_NEUTRAL: Military = Military {
    quality: 50.0,
    technology: 50.0,
    land: 50.0,
    sea: 50.0,
    air: 50.0,
    manpower_share: None,
    cavalry_share: None,
    siege_share: None,
    men_per_counter: None,
};

fn given(value: &Val) -> bool {
    !matches!(value, Val::Null | Val::Undef) && !matches!(value, Val::Str(text) if text.is_empty()) && value.num().is_finite()
}

fn stat(value: &Val) -> f64 {
    if !given(value) {
        return 50.0;
    }
    let number = value.num();
    if number < 0.0 {
        0.0
    } else if number > 100.0 {
        100.0
    } else {
        number
    }
}

fn between(value: &Val, least: f64, most: f64) -> Option<f64> {
    if !given(value) {
        return None;
    }
    let number = value.num();
    if number >= least && number <= most {
        Some(number)
    } else {
        None
    }
}

pub fn read_military(value: &Val) -> Military {
    Military {
        quality: stat(value.get("quality")),
        technology: stat(value.get("technology")),
        land: stat(value.get("land")),
        sea: stat(value.get("sea")),
        air: stat(value.get("air")),
        manpower_share: between(value.get("manpowerShare"), 0.1, 100.0),
        cavalry_share: between(value.get("cavalryShare"), 0.0, 1.0),
        siege_share: between(value.get("siegeShare"), 0.0, 1.0),
        men_per_counter: between(value.get("menPerCounter"), 1.0, 1000000.0),
    }
}

pub fn stat_factor(value: f64, least: f64, most: f64) -> f64 {
    if value == 50.0 {
        1.0
    } else if value < 50.0 {
        least + ((1.0 - least) * value) / 50.0
    } else {
        1.0 + ((most - 1.0) * (value - 50.0)) / 50.0
    }
}

fn arm_worth(stats: &Military, arm: f64) -> f64 {
    if arm <= 0.0 {
        return 0.0;
    }
    stat_factor(stats.quality, QUALITY_FACTORS[0], QUALITY_FACTORS[1]) * stat_factor(stats.technology, TECHNOLOGY_FACTORS[0], TECHNOLOGY_FACTORS[1]) * stat_factor(arm, ARM_FACTORS[0], ARM_FACTORS[1])
}

pub fn land_worth(stats: &Military) -> f64 {
    arm_worth(stats, stats.land)
}

pub fn sea_worth(stats: &Military) -> f64 {
    arm_worth(stats, stats.sea)
}

pub fn air_worth(stats: &Military) -> f64 {
    arm_worth(stats, stats.air)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mix {
    pub armour: Option<f64>,
    pub artillery: Option<f64>,
}

pub fn mix_of(stats: &Military) -> Option<Mix> {
    if stats.cavalry_share.is_none() && stats.siege_share.is_none() {
        None
    } else {
        Some(Mix { armour: stats.cavalry_share, artillery: stats.siege_share })
    }
}
