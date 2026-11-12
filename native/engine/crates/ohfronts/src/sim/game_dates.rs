use super::js;

const MAX_ABS_YEAR: f64 = 999999.0;
const MAX_TIME_DAYS: f64 = 100000000.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GameDate {
    pub year: f64,
    pub month: f64,
    pub day: f64,
}

pub fn astronomical_year(year: f64) -> f64 {
    if year < 0.0 {
        year + 1.0
    } else {
        year
    }
}

pub fn calendar_year(astronomical: f64) -> f64 {
    if astronomical <= 0.0 {
        astronomical - 1.0
    } else {
        astronomical
    }
}

pub fn shift_game_year(year: f64, delta: f64) -> f64 {
    calendar_year(astronomical_year(year) + delta)
}

fn is_leap(astronomical: f64) -> bool {
    astronomical % 4.0 == 0.0 && (astronomical % 100.0 != 0.0 || astronomical % 400.0 == 0.0)
}

pub fn game_date_days_in_month(year: f64, month: f64) -> f64 {
    let lengths = [31.0, if is_leap(astronomical_year(year)) { 29.0 } else { 28.0 }, 31.0, 30.0, 31.0, 30.0, 31.0, 31.0, 30.0, 31.0, 30.0, 31.0];
    if month >= 1.0 && month <= 12.0 && month.fract() == 0.0 {
        lengths[month as usize - 1]
    } else {
        0.0
    }
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn era_suffix(raw: &str) -> Option<(usize, bool)> {
    for (at, _) in raw.char_indices() {
        let rest = raw[at..].trim_start_matches(js::is_js_whitespace);
        let upper = rest.to_ascii_uppercase();
        if matches!(upper.as_str(), "BCE" | "BC" | "CE" | "AD") {
            return Some((at, upper.starts_with("BC")));
        }
    }
    None
}

fn digits(text: &str, least: usize, most: usize) -> Option<f64> {
    if text.len() < least || text.len() > most || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse::<f64>().ok()
}

pub fn parse_game_date(value: &str) -> Option<GameDate> {
    let mut raw = js::trim(value).to_string();
    if raw.is_empty() {
        return None;
    }
    let mut bc = false;
    if let Some((at, is_bc)) = era_suffix(&raw) {
        bc = is_bc;
        raw = js::trim(&raw[..at]).to_string();
    }
    let date_part = raw.split(['T', ' ']).next().unwrap_or("");
    let (sign, body) = match date_part.strip_prefix('+') {
        Some(rest) => ("+", rest),
        None => match date_part.strip_prefix('-') {
            Some(rest) => ("-", rest),
            None => ("", date_part),
        },
    };
    let pieces: Vec<&str> = body.split('-').collect();
    if pieces.len() != 3 {
        return None;
    }
    let mut year = digits(pieces[0], 1, 6)?;
    let month = digits(pieces[1], 1, 2)?;
    let day = digits(pieces[2], 1, 2)?;
    if sign == "-" || bc {
        year = -year;
    }
    if year == 0.0 || year.abs() > MAX_ABS_YEAR {
        return None;
    }
    if !(1.0..=12.0).contains(&month) {
        return None;
    }
    if day < 1.0 || day > game_date_days_in_month(year, month) {
        return None;
    }
    Some(GameDate { year, month, day })
}

pub fn is_game_date(value: &str) -> bool {
    parse_game_date(value).is_some()
}

fn pad(value: f64, width: usize) -> String {
    let text = js::number_to_string(value.abs());
    let length = js::utf16_len(&text);
    if length >= width {
        text
    } else {
        format!("{}{}", "0".repeat(width - length), text)
    }
}

pub fn format_game_date(parts: Option<GameDate>) -> String {
    match parts {
        None => String::new(),
        Some(GameDate { year, month, day }) => format!("{}{}-{}-{}", if year < 0.0 { "-" } else { "" }, pad(year, 4), pad(month, 2), pad(day, 2)),
    }
}

pub fn normalize_game_date(value: &str) -> String {
    format_game_date(parse_game_date(value))
}

pub fn is_canonical_game_date(value: &str) -> bool {
    let raw = js::trim(value);
    !raw.is_empty() && normalize_game_date(raw) == raw
}

pub fn game_date_day_number(value: &str) -> Option<f64> {
    let parts = parse_game_date(value)?;
    let days = days_from_civil(astronomical_year(parts.year) as i64, parts.month as i64, parts.day as i64) as f64;
    if days.abs() > MAX_TIME_DAYS {
        Some(f64::NAN)
    } else {
        Some(days)
    }
}

pub fn game_date_from_day_number(day_number: f64) -> GameDate {
    let days = js::round(day_number);
    if !days.is_finite() || days.abs() > MAX_TIME_DAYS {
        return GameDate { year: f64::NAN, month: f64::NAN, day: f64::NAN };
    }
    let (year, month, day) = civil_from_days(days as i64);
    GameDate { year: calendar_year(year as f64), month: month as f64, day: day as f64 }
}

pub fn add_game_days(value: &str, days: f64) -> String {
    let day_number = match game_date_day_number(value) {
        Some(number) => number,
        None => return String::new(),
    };
    if !days.is_finite() {
        return String::new();
    }
    let parts = game_date_from_day_number(day_number + days.trunc());
    if parts.year.abs() > MAX_ABS_YEAR {
        String::new()
    } else {
        format_game_date(Some(parts))
    }
}

pub fn add_game_months(value: &str, months: f64) -> String {
    let parts = match parse_game_date(value) {
        Some(parts) => parts,
        None => return String::new(),
    };
    if !months.is_finite() {
        return String::new();
    }
    let index = parts.month - 1.0 + months.trunc();
    let year = shift_game_year(parts.year, (index / 12.0).floor());
    let month = ((index % 12.0) + 12.0) % 12.0 + 1.0;
    format_game_date(Some(GameDate { year, month, day: js_min(parts.day, game_date_days_in_month(year, month)) }))
}

fn js_min(a: f64, b: f64) -> f64 {
    crate::jsmath::min(a, b)
}

pub fn diff_game_days(from: &str, to: &str) -> Option<f64> {
    let a = game_date_day_number(from)?;
    let b = game_date_day_number(to)?;
    Some(b - a)
}

fn compare_texts(a: &str, b: &str) -> f64 {
    match js::compare_units(js::trim(a), js::trim(b)) {
        std::cmp::Ordering::Less => -1.0,
        std::cmp::Ordering::Equal => 0.0,
        std::cmp::Ordering::Greater => 1.0,
    }
}

pub fn compare_game_dates(a: &str, b: &str) -> f64 {
    match (game_date_day_number(a), game_date_day_number(b)) {
        (Some(left), Some(right)) => {
            if left == right {
                0.0
            } else if left < right {
                -1.0
            } else {
                1.0
            }
        }
        (Some(_), None) => -1.0,
        (None, Some(_)) => 1.0,
        (None, None) => compare_texts(a, b),
    }
}

pub fn compare_game_dates_newest_first(a: &str, b: &str) -> f64 {
    match (game_date_day_number(a), game_date_day_number(b)) {
        (Some(left), Some(right)) => {
            if left == right {
                0.0
            } else if left > right {
                -1.0
            } else {
                1.0
            }
        }
        (Some(_), None) => -1.0,
        (None, Some(_)) => 1.0,
        (None, None) => compare_texts(b, a),
    }
}

pub fn game_date_year(value: &str) -> Option<f64> {
    parse_game_date(value).map(|parts| parts.year)
}
