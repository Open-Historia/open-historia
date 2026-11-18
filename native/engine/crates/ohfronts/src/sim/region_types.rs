use super::js::{self, Val};

pub fn is_water_type(kind: &Val) -> bool {
    if !kind.truthy() || !kind.is_object() {
        return false;
    }
    kind.get("water").is_true()
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
