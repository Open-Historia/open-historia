use std::time::Instant;

use godot::prelude::*;
use ohfronts::frames::{js_number_of_text, js_trim};
use ohfronts::{Arrow, FrameOut};

#[derive(GodotClass)]
#[class(init, base = RefCounted)]
pub struct FrontFrames {
    frames: ohfronts::FrontFrames,
    last_us: i64,
}

fn number_of(value: &Variant) -> f64 {
    match value.get_type() {
        VariantType::NIL => 0.0,
        VariantType::FLOAT => value.try_to::<f64>().unwrap_or(f64::NAN),
        VariantType::INT => value.try_to::<i64>().map(|whole| whole as f64).unwrap_or(f64::NAN),
        VariantType::BOOL => {
            if value.try_to::<bool>().unwrap_or(false) {
                1.0
            } else {
                0.0
            }
        }
        VariantType::STRING | VariantType::STRING_NAME => js_number_of_text(&value.to_string()),
        _ => f64::NAN,
    }
}

fn name_of(value: &Variant) -> String {
    match value.get_type() {
        VariantType::NIL => String::new(),
        _ => js_trim(&value.to_string()).to_string(),
    }
}

fn floats(values: &[f64]) -> VarArray {
    let mut out = VarArray::new();
    for value in values {
        out.push(&value.to_variant());
    }
    out
}

fn to_dictionary(out: &FrameOut) -> VarDictionary {
    let mut result = VarDictionary::new();
    let mut arrows = VarArray::new();
    for arrow in &out.arrows {
        let mut entry = VarDictionary::new();
        match arrow {
            Arrow::Past { f, rgb, alpha, line } => {
                entry.set("past", true);
                entry.set("f", *f);
                entry.set("rgb", *rgb as f64);
                entry.set("alpha", *alpha);
                entry.set("line", &floats(line));
            }
            Arrow::Shape { f, rgb, dark, alpha, points, indices } => {
                entry.set("past", false);
                entry.set("f", *f);
                entry.set("rgb", *rgb as f64);
                entry.set("dark", *dark as f64);
                entry.set("alpha", *alpha);
                entry.set("points", &floats(points));
                let mut list = VarArray::new();
                for index in indices {
                    list.push(&(*index as f64).to_variant());
                }
                entry.set("indices", &list);
            }
        }
        arrows.push(&entry.to_variant());
    }
    let mut troops = VarArray::new();
    for row in &out.troops {
        let mut entry = VarArray::new();
        entry.push(&row.x.to_variant());
        entry.push(&row.y.to_variant());
        entry.push(&(row.side as f64).to_variant());
        entry.push(&(row.index as f64).to_variant());
        entry.push(&row.command.to_variant());
        entry.push(&(row.rgb as f64).to_variant());
        entry.push(&GString::from(row.glyph).to_variant());
        entry.push(&row.strength.to_variant());
        entry.push(&GString::from(row.state).to_variant());
        entry.push(&(if row.named { 1.0f64 } else { 0.0 }).to_variant());
        entry.push(&(if row.moving { 1.0f64 } else { 0.0 }).to_variant());
        entry.push(&GString::from(row.label.as_str()).to_variant());
        entry.push(&row.f.to_variant());
        troops.push(&entry.to_variant());
    }
    let mut sides = VarArray::new();
    for row in &out.sides {
        let mut entry = VarArray::new();
        entry.push(&row.x.to_variant());
        entry.push(&row.y.to_variant());
        entry.push(&(row.side as f64).to_variant());
        entry.push(&row.command.to_variant());
        entry.push(&(row.rgb as f64).to_variant());
        entry.push(&(row.count as f64).to_variant());
        entry.push(&row.strength.to_variant());
        entry.push(&row.f.to_variant());
        sides.push(&entry.to_variant());
    }
    let mut colours = VarArray::new();
    for rgb in &out.colours {
        colours.push(&floats(rgb).to_variant());
    }
    result.set("arrows", &arrows);
    result.set("troops", &troops);
    result.set("sides", &sides);
    result.set("colours", &colours);
    if let Some(zoom) = out.zoom {
        result.set("zoom", zoom);
    }
    if let Some(ms) = out.ms {
        result.set("ms", ms);
    }
    result
}

#[godot_api]
impl FrontFrames {
    #[func]
    fn load(&mut self, json: GString) -> bool {
        match self.frames.load_json(&json.to_string()) {
            Ok(()) => true,
            Err(error) => {
                godot_warn!("Front frames: the stage data did not read: {error}");
                self.frames.clear();
                false
            }
        }
    }

    #[func]
    fn clear(&mut self) {
        self.frames.clear();
    }

    #[func]
    fn is_loaded(&self) -> bool {
        self.frames.loaded()
    }

    #[func]
    fn front_count(&self) -> i64 {
        self.frames.front_count() as i64
    }

    #[func]
    fn last_usec(&self) -> i64 {
        self.last_us
    }

    #[func]
    fn frame(&mut self, days: VarArray, zoom: f64) -> VarDictionary {
        let began = Instant::now();
        let mut list: Vec<(String, f64)> = Vec::with_capacity(days.len());
        for entry in days.iter_shared() {
            let pair = entry.try_to::<VarArray>().unwrap_or_default();
            let name = pair.get(0).map(|value| name_of(&value)).unwrap_or_default();
            let day = pair.get(1).map(|value| number_of(&value)).unwrap_or(f64::NAN);
            list.push((name, day));
        }
        let out = self.frames.frame(&list, zoom);
        let result = to_dictionary(&out);
        self.last_us = began.elapsed().as_micros() as i64;
        result
    }
}
