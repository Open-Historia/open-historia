use super::js::{self, Val};
use crate::jsmath;

pub const FIGURE_LEAST: f64 = 0.1;
pub const FIGURE_MOST: f64 = 10.0;
pub const SPEED_MOST: f64 = 5.0;
const UNIT_TYPE_REF_MOST: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Figures {
    pub attack: f64,
    pub toughness: f64,
    pub speed: f64,
}

pub fn unit_type_figure(value: &Val, most: f64) -> f64 {
    let number = match value {
        Val::Undef | Val::Null => return 1.0,
        Val::Str(text) if text.is_empty() => return 1.0,
        Val::Str(text) => js::number_of_text(&js::trim(text).replacen(',', ".", 1)),
        other => js::to_number(other),
    };
    if !number.is_finite() {
        return 1.0;
    }
    let held = if number < FIGURE_LEAST {
        FIGURE_LEAST
    } else if number > most {
        most
    } else {
        number
    };
    jsmath::round(held * 100.0) / 100.0
}

fn unit_type_ref(value: &Val) -> String {
    let text = if value.is_nullish() { String::new() } else { js::to_string(value) };
    let text = js::trim(&js::collapse_spaces(&text)).to_string();
    js::trim(&js::slice_units(&text, 0, UNIT_TYPE_REF_MOST)).to_string()
}

pub fn unit_type_of<'a>(types: &'a Val, unit: &Val) -> Option<&'a Val> {
    let id = unit_type_ref(unit.get("unitType"));
    if id.is_empty() {
        return None;
    }
    types.array_or_empty().iter().find(|kind| matches!(kind.get("id"), Val::Str(own) if *own == id))
}

pub fn unit_figures(types: &Val, unit: &Val) -> Option<Figures> {
    let kind = unit_type_of(types, unit)?;
    Some(Figures { attack: unit_type_figure(kind.get("attack"), FIGURE_MOST), toughness: unit_type_figure(kind.get("toughness"), FIGURE_MOST), speed: unit_type_figure(kind.get("speed"), SPEED_MOST) })
}
