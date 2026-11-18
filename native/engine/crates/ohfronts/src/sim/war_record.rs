use super::js::{self, Val};
use std::collections::HashSet;

pub const MAX_WAR_SIDE_MEMBERS: f64 = 64.0;

fn clean(value: &str) -> String {
    js::trim(&js::collapse_spaces(value)).to_string()
}

pub fn clean_war_id(value: &Val) -> String {
    let text = clean(&value.string_or_empty());
    let mut out = String::with_capacity(text.len());
    let mut run = false;
    for unit in text.chars() {
        if unit == '~' || unit == '|' {
            if !run {
                out.push('-');
            }
            run = true;
        } else {
            run = false;
            out.push(unit);
        }
    }
    out
}

pub fn war_id_stem(id: &Val) -> String {
    let text = clean_war_id(id);
    let digits = text.bytes().rev().take_while(|unit| unit.is_ascii_digit()).count();
    if digits > 0 && text[..text.len() - digits].ends_with("-r") {
        text[..text.len() - digits - 2].to_string()
    } else {
        text
    }
}

pub fn mint_war_id(base: &Val, taken: &HashSet<String>) -> String {
    let root = clean_war_id(base);
    let root = if root.is_empty() { "war".to_string() } else { root };
    if !taken.contains(&root) {
        return root;
    }
    let stem = war_id_stem(&Val::Str(root));
    for number in 2..10000 {
        let candidate = format!("{stem}-r{number}");
        if !taken.contains(&candidate) {
            return candidate;
        }
    }
    format!("{stem}-r{}", taken.len() + 2)
}
