use super::constants::MANPOWER_SHARE;
use super::js::{self, Obj, Val};
use super::war_geography::WALL_LEVEL_LEAST;
use super::war_settings::{is_record, normalize_muster_points, war_settings_of};
use super::world_grid::{km_between, Surface};
use crate::jsmath;

pub const DAYS_PER_KM: f64 = 0.08;
pub const REFERENCE_MEN: f64 = 1000000.0;
pub const BUILD_DAYS_LEAST: f64 = 1.0;
pub const BUILD_DAYS_MOST: f64 = 36500.0;
pub const FORTIFY_LEVEL_USUAL: f64 = 5.0;
pub const FORTIFY_LEVEL_MOST: f64 = 9.0;
pub const POPULATION_FIGURE_MOST: f64 = 2e10;
pub const MILITARY_GDP_SHARE: f64 = 0.03;
pub const BALANCE_PER_POINT: f64 = 0.02;
pub const DEBT_EASY: f64 = 60.0;
pub const DEBT_PER_POINT: f64 = 0.0015;
pub const TREASURY_LEAST: f64 = 0.6;
pub const TREASURY_MOST: f64 = 1.25;
pub const FUNDING_POWER: f64 = 0.25;
pub const FUNDING_COMPARED_LEAST: usize = 3;
pub const FUNDING_FACTOR_LEAST: f64 = 0.6;
pub const FUNDING_FACTOR_MOST: f64 = 1.5;

fn clean(value: &Val) -> String {
    let text = if value.is_nullish() { String::new() } else { js::to_string(value) };
    js::trim(&js::collapse_spaces(&text)).to_string()
}

fn fold(value: &Val) -> String {
    js::lower(&clean(value))
}

fn records(value: &Val) -> Val {
    if value.truthy() && is_record(value) {
        value.clone()
    } else {
        Val::Obj(Obj::new())
    }
}

pub fn read_population_figure(value: &Val) -> f64 {
    if let Val::Num(number) = value {
        return if number.is_finite() && *number >= 1.0 { jsmath::min(POPULATION_FIGURE_MOST, jsmath::round(*number)) } else { 0.0 };
    }
    let text = if value.is_nullish() { String::new() } else { js::to_string(value) };
    let text: String = js::lower(js::trim(&text)).chars().filter(|&unit| !(unit == ',' || unit == '_' || unit == '\'' || unit == '\u{2019}' || js::is_js_whitespace(unit))).collect();
    let digits_end = text.find(|unit: char| !unit.is_ascii_digit()).unwrap_or(text.len());
    if digits_end == 0 {
        return 0.0;
    }
    let mut end = digits_end;
    let rest = &text[digits_end..];
    if let Some(after) = rest.strip_prefix('.') {
        let fraction = after.find(|unit: char| !unit.is_ascii_digit()).unwrap_or(after.len());
        if fraction > 0 {
            end = digits_end + 1 + fraction;
        }
    }
    let (number, word) = text.split_at(end);
    if !word.chars().all(|unit| unit.is_ascii_lowercase()) {
        return 0.0;
    }
    let scale = match word {
        "" => 1.0,
        "k" | "thousand" => 1e3,
        "m" | "mn" | "million" => 1e6,
        "b" | "bn" | "billion" => 1e9,
        _ => return 0.0,
    };
    let people = js::number_of_text(number) * scale;
    if people.is_finite() && people >= 1.0 {
        jsmath::min(POPULATION_FIGURE_MOST, jsmath::round(people))
    } else {
        0.0
    }
}

pub fn population_figure_of(record: &Val) -> f64 {
    read_population_figure(&if record.truthy() && record.is_object() { record.get("population").clone() } else { Val::Num(0.0) })
}

fn number(value: &Val) -> f64 {
    let read = js::to_number(value);
    if read.is_finite() {
        read
    } else {
        0.0
    }
}

fn within(value: f64, least: f64, most: f64) -> f64 {
    jsmath::min(most, jsmath::max(least, value))
}

pub fn treasury_factor(sheet: &Val) -> f64 {
    let economy = sheet.get("economy");
    let balance = within(number(economy.get("budgetBalance")), -25.0, 25.0);
    let debt = within(number(economy.get("publicDebt")), 0.0, 400.0);
    within(1.0 + balance * BALANCE_PER_POINT - jsmath::max(0.0, debt - DEBT_EASY) * DEBT_PER_POINT, TREASURY_LEAST, TREASURY_MOST)
}

pub fn military_funding(sheet: &Val) -> f64 {
    let gdp = number(sheet.get("economy").get("gdp"));
    if gdp > 0.0 {
        gdp * MILITARY_GDP_SHARE * treasury_factor(sheet)
    } else {
        0.0
    }
}

pub fn funding_per_head(sheet: &Val) -> f64 {
    let people = number(sheet.get("population").get("total"));
    let funding = military_funding(sheet);
    if people > 0.0 && funding > 0.0 {
        funding / people
    } else {
        0.0
    }
}

pub fn middle_funding_per_head(country_stats: &Val) -> f64 {
    let stats = if country_stats.truthy() && country_stats.is_object() { country_stats.clone() } else { Val::Obj(Obj::new()) };
    let mut known: Vec<f64> = js::entries(&stats).iter().map(|(_, sheet)| funding_per_head(sheet)).filter(|&value| value > 0.0).collect();
    js::sort_numbers(&mut known);
    if known.len() < FUNDING_COMPARED_LEAST {
        return 0.0;
    }
    let half = known.len() / 2;
    if known.len() % 2 == 1 {
        known[half]
    } else {
        (known[half - 1] + known[half]) / 2.0
    }
}

pub fn funding_factor(sheet: &Val, middle: f64) -> f64 {
    if !(number(sheet.get("economy").get("gdp")) > 0.0) {
        return 1.0;
    }
    let head = funding_per_head(sheet);
    let against = if middle > 0.0 && head > 0.0 { jsmath::pow(head / middle, FUNDING_POWER) } else { treasury_factor(sheet) };
    within(against, FUNDING_FACTOR_LEAST, FUNDING_FACTOR_MOST)
}

const RANGES: [(&str, f64, f64, f64); 11] = [
    ("quality", 0.0, 100.0, 1.0),
    ("technology", 0.0, 100.0, 1.0),
    ("land", 0.0, 100.0, 1.0),
    ("sea", 0.0, 100.0, 1.0),
    ("air", 0.0, 100.0, 1.0),
    ("spending", 0.0, 100.0, 1.0),
    ("weariness", 0.0, 100.0, 1.0),
    ("manpowerShare", 0.1, 100.0, 10.0),
    ("cavalryShare", 0.0, 1.0, 1000.0),
    ("siegeShare", 0.0, 1.0, 1000.0),
    ("menPerCounter", 1.0, 1000000.0, 1.0),
];

pub fn normalize_military_stats(value: &Val) -> Option<Obj> {
    if !value.truthy() || !is_record(value) {
        return None;
    }
    let mut out = Obj::new();
    for (key, least, most, places) in RANGES {
        let raw = value.get(key);
        if raw.is_nullish() || matches!(raw, Val::Str(text) if text.is_empty()) {
            continue;
        }
        let number = js::to_number(raw);
        if !number.is_finite() {
            continue;
        }
        let kept = if number < least {
            least
        } else if number > most {
            most
        } else {
            number
        };
        out.set(key, Val::Num(jsmath::round(kept * places) / places));
    }
    if let Some(muster) = normalize_muster_points(value.get("muster")) {
        out.set("muster", muster);
    }
    if out.0.is_empty() {
        None
    } else {
        Some(out)
    }
}

pub struct MilitaryLookup {
    found: Vec<(String, Obj)>,
}

impl MilitaryLookup {
    pub fn of(&self, name: &Val) -> Option<&Obj> {
        let key = fold(name);
        self.found.iter().find(|(known, _)| *known == key).map(|(_, figures)| figures)
    }
}

pub fn military_lookup(world: &Val) -> MilitaryLookup {
    let mut found: Vec<(String, Obj)> = Vec::new();
    let mut add = |name: &Val, figures: &Option<Obj>| {
        let key = fold(name);
        let figures = match figures {
            Some(figures) if !key.is_empty() => figures,
            _ => return,
        };
        match found.iter_mut().find(|(known, _)| *known == key) {
            Some((_, merged)) => {
                for (field, value) in figures.entries() {
                    merged.set(field, value.clone());
                }
            }
            None => found.push((key, figures.clone())),
        }
    };
    let part = |key: &str| {
        let value = world.get(key);
        if value.truthy() && is_record(value) {
            js::entries(value)
        } else {
            Vec::new()
        }
    };
    for (key, record) in part("polityOverrides") {
        let figures = normalize_military_stats(record.get("military"));
        add(&Val::Str(key), &figures);
        if record.get("name").truthy() {
            add(record.get("name"), &figures);
        }
    }
    for (key, record) in part("groups") {
        add(&Val::Str(key), &normalize_military_stats(record.get("military")));
    }
    for (key, sheet) in part("countryStats") {
        add(&Val::Str(key), &normalize_military_stats(sheet.get("military")));
    }
    MilitaryLookup { found }
}

pub fn fortify_level_of(value: &Val) -> f64 {
    let level = jsmath::round(js::to_number(value));
    if !level.is_finite() {
        return FORTIFY_LEVEL_USUAL;
    }
    jsmath::max(WALL_LEVEL_LEAST, jsmath::min(FORTIFY_LEVEL_MOST, level))
}

pub fn build_days(km: &Val, level: &Val, funding: &Val, men: &Val) -> f64 {
    let length = jsmath::max(0.0, js::or_zero(js::to_number(km)));
    let height = fortify_level_of(level);
    let purse = if js::to_number(funding) > 0.0 { js::to_number(funding) } else { 1.0 };
    let hands = if js::to_number(men) > 0.0 { js::to_number(men) } else { REFERENCE_MEN };
    let days = (length * height * height * DAYS_PER_KM) / (purse * (hands / REFERENCE_MEN).sqrt());
    jsmath::max(BUILD_DAYS_LEAST, jsmath::min(BUILD_DAYS_MOST, jsmath::round(days)))
}

pub fn line_km(points: &Val) -> f64 {
    let line = points.array_or_empty();
    let mut total = 0.0;
    for index in 1..line.len() {
        let (a, b) = (&line[index - 1], &line[index]);
        let parts = [a.at(0), a.at(1), b.at(0), b.at(1)];
        if parts.iter().all(|part| js::is_finite(part)) {
            total += km_between(parts[0].num(), parts[1].num(), parts[2].num(), parts[3].num(), Surface::default());
        }
    }
    total
}

pub fn people_of(world: &Val, country: &Val) -> f64 {
    let wanted = fold(country);
    if wanted.is_empty() {
        return 0.0;
    }
    for (key, sheet) in js::entries(&records(world.get("countryStats"))) {
        let total = js::to_number(sheet.get("population").get("total"));
        if fold(&Val::Str(key)) == wanted && total.is_finite() && total > 0.0 {
            return total;
        }
    }
    for (key, record) in js::entries(&records(world.get("polityOverrides"))) {
        let figure = population_figure_of(&record);
        if (fold(&Val::Str(key)) == wanted || fold(record.get("name")) == wanted) && figure > 0.0 {
            return figure;
        }
    }
    for (key, record) in js::entries(&records(world.get("groups"))) {
        let figure = population_figure_of(&record);
        if fold(&Val::Str(key)) == wanted && figure > 0.0 {
            return figure;
        }
    }
    0.0
}

pub fn manpower_share_of(world: &Val, country: &Val) -> f64 {
    let settings = war_settings_of(world);
    let own = if settings.get("mechanics").get("military").is_true() { military_lookup(world).of(country).map(|figures| js::to_number(figures.get("manpowerShare").unwrap_or(&Val::Undef))).unwrap_or(f64::NAN) } else { 0.0 };
    if own > 0.0 {
        return own / 100.0;
    }
    let share = js::to_number(settings.get("manpowerShare"));
    if share > 0.0 {
        share / 100.0
    } else {
        MANPOWER_SHARE
    }
}

pub fn funding_of(world: &Val, country: &Val) -> f64 {
    let sheets = records(world.get("countryStats"));
    let wanted = fold(country);
    match js::entries(&sheets).into_iter().find(|(name, _)| fold(&Val::Str(name.clone())) == wanted) {
        Some((_, sheet)) => funding_factor(&sheet, middle_funding_per_head(&sheets)),
        None => 1.0,
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FortifyCost {
    pub km: f64,
    pub level: f64,
    pub funding: f64,
    pub people: f64,
    pub men: f64,
    pub days: f64,
}

pub struct Reckoner {
    funding: f64,
    people: f64,
    men: f64,
}

impl Reckoner {
    pub fn cost(&self, points: &Val, level: &Val) -> FortifyCost {
        let km = line_km(points);
        let height = fortify_level_of(level);
        FortifyCost {
            km: jsmath::round(km * 10.0) / 10.0,
            level: height,
            funding: jsmath::round(self.funding * 100.0) / 100.0,
            people: self.people,
            men: self.men,
            days: build_days(&Val::Num(km), &Val::Num(height), &Val::Num(self.funding), &Val::Num(self.men)),
        }
    }
}

pub fn fortify_cost_reckoner(world: &Val, country: &Val) -> Reckoner {
    let funding = funding_of(world, country);
    let people = people_of(world, country);
    let men = if people > 0.0 { jsmath::round(people * manpower_share_of(world, country)) } else { 0.0 };
    Reckoner { funding, people, men }
}

pub fn fortify_cost_for(world: &Val, country: &Val, points: &Val, level: &Val) -> FortifyCost {
    fortify_cost_reckoner(world, country).cost(points, level)
}

pub fn build_time_parts(days: &Val) -> (f64, &'static str) {
    let value = jsmath::max(1.0, jsmath::round({
        let number = js::to_number(days);
        if number.is_nan() || number == 0.0 {
            1.0
        } else {
            number
        }
    }));
    if value < 14.0 {
        (value, "day")
    } else if value < 61.0 {
        (jsmath::round(value / 7.0), "week")
    } else if value < 730.0 {
        (jsmath::round(value / 30.44), "month")
    } else {
        (jsmath::round(value / 365.25), "year")
    }
}
