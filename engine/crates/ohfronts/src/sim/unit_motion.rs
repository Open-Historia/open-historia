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
