pub fn hash_units(units: &[u16]) -> u32 {
    let mut h: u32 = 1779033703u32 ^ (units.len() as u32);
    for &unit in units {
        h = (h ^ unit as u32).wrapping_mul(3432918353);
        h = h.rotate_left(13);
    }
    h = (h ^ (h >> 16)).wrapping_mul(2246822507);
    h = (h ^ (h >> 13)).wrapping_mul(3266489909);
    h ^ (h >> 16)
}

pub fn hash_seed(text: &str) -> u32 {
    let units: Vec<u16> = text.encode_utf16().collect();
    hash_units(&units)
}

const ERA_STARTS: [f64; 3] = [1500.0, 1850.0, 1945.0];
const ERA_YEARS: [f64; 4] = [1400.0, 1700.0, 1900.0, 2000.0];
pub const ADVANCE_KM_PER_DAY: [[f64; 4]; 3] = [[18.0, 20.0, 20.0, 30.0], [30.0, 35.0, 35.0, 50.0], [12.0, 15.0, 18.0, 30.0]];
pub const OVERLAND_KM_PER_DAY: [[f64; 4]; 3] = [[25.0, 28.0, 300.0, 500.0], [40.0, 45.0, 300.0, 500.0], [18.0, 22.0, 300.0, 500.0]];

fn era_of_year(year: f64) -> usize {
    ERA_STARTS.iter().filter(|&&start| year >= start).count()
}

pub fn era_of(game_date: &str, era: Option<f64>) -> usize {
    if let Some(era) = era {
        if era.trunc() == era && (0.0..=3.0).contains(&era) {
            return era as usize;
        }
    }
    if let Some(parsed) = super::game_dates::parse_game_date(game_date) {
        return era_of_year(parsed.year);
    }
    let bytes: Vec<char> = game_date.chars().collect();
    let mut found: Option<f64> = None;
    let mut at = 0;
    while at < bytes.len() && found.is_none() {
        let start = at;
        let negative = bytes[at] == '-';
        let digits_from = if negative { at + 1 } else { at };
        let mut end = digits_from;
        while end < bytes.len() && bytes[end].is_ascii_digit() && end - digits_from < 4 {
            end += 1;
        }
        if end - digits_from >= 3 {
            let text: String = bytes[start..end].iter().collect();
            found = text.parse::<f64>().ok();
        }
        at += 1;
    }
    let upper = game_date.to_ascii_uppercase();
    let bce = upper.contains("BC");
    let year = match found {
        Some(value) => value * if bce { -1.0 } else { 1.0 },
        None => 2000.0,
    };
    era_of_year(year)
}

pub fn year_in_era(year: f64, era: Option<f64>) -> f64 {
    let era = match era {
        Some(era) if era.trunc() == era && (0.0..=3.0).contains(&era) => era as usize,
        _ => return year,
    };
    let least = if era == 0 { f64::NEG_INFINITY } else { ERA_STARTS[era - 1] };
    let most = if era == 3 { f64::INFINITY } else { ERA_STARTS[era] - 1.0 };
    let value = if year.is_finite() { year } else { ERA_YEARS[era] };
    if value < least {
        least
    } else if value > most {
        most
    } else {
        value
    }
}
