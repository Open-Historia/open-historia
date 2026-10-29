use super::js::{self, Val};

const WATER_WORDS: [&str; 4] = ["ocean", "sea", "water", "lake"];

fn letter(unit: char) -> bool {
    unit.is_alphabetic()
}

fn fold(unit: char) -> char {
    if unit == '\u{017F}' {
        return 's';
    }
    let mut lower = unit.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(single), None) => single,
        _ => unit,
    }
}

fn boundary_at(chars: &[char], at: usize) -> bool {
    at >= chars.len() || !letter(chars[at])
}

pub fn names_water(name: &str) -> bool {
    let chars: Vec<char> = name.chars().collect();
    for start in 0..=chars.len() {
        if start > 0 && letter(chars[start - 1]) {
            continue;
        }
        for word in WATER_WORDS {
            let length = word.chars().count();
            if start + length > chars.len() {
                continue;
            }
            if !word.chars().zip(&chars[start..start + length]).all(|(want, &got)| fold(got) == want) {
                continue;
            }
            let after = start + length;
            if after < chars.len() && fold(chars[after]) == 's' && boundary_at(&chars, after + 1) {
                return true;
            }
            if boundary_at(&chars, after) {
                return true;
            }
        }
    }
    false
}

pub fn is_water_type(kind: &Val) -> bool {
    if !kind.truthy() || !kind.is_object() {
        return false;
    }
    if let Val::Bool(water) = kind.get("water") {
        return *water;
    }
    names_water(js::trim(&kind.get("name").string_or_empty()))
}

pub fn water_type_ids(types: &Val) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for kind in types.array_or_empty() {
        if !is_water_type(kind) {
            continue;
        }
        let id = js::trim(&kind.get("id").string_or_empty()).to_string();
        if !id.is_empty() && !out.contains(&id) {
            out.push(id);
        }
    }
    out
}
