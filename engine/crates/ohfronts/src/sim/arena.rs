use super::codec::hash_key;
use super::constants::{ICE_SPEED, TERRAIN_SPEED_MAX, TERRAIN_SPEED_MIN};
use super::frame::{cell_index_at, frame_to_cell, lat_to_y, Frame};
use super::js::{self, Val};
use super::region_types::is_water_type;
use crate::jsmath;
use std::collections::HashMap;

fn text(value: &Val) -> String {
    js::trim(&value.string_or_empty()).to_string()
}

fn polygons_of(geometry: &Val) -> Vec<Val> {
    let coordinates = geometry.get("coordinates");
    let list = match coordinates {
        Val::Arr(list) => list,
        _ => return Vec::new(),
    };
    match geometry.get("type").as_str() {
        Some("Polygon") => vec![coordinates.clone()],
        Some("MultiPolygon") => list.clone(),
        _ => Vec::new(),
    }
}

fn ring_longitudes(ring: &[Val], middle: f64) -> Vec<f64> {
    let count = ring.len();
    let mut longitudes = vec![0.0f64; count];
    let mut west = f64::INFINITY;
    let mut east = f64::NEG_INFINITY;
    for index in 0..count {
        let lng = js::or_zero(ring[index].element(0).num());
        longitudes[index] = lng;
        if lng < west {
            west = lng;
        }
        if lng > east {
            east = lng;
        }
    }
    if east - west > 180.0 {
        let mut run_west = longitudes[0];
        let mut run_east = longitudes[0];
        let mut run = vec![0.0f64; count];
        run[0] = longitudes[0];
        for index in 1..count {
            let step = longitudes[index] - longitudes[index - 1];
            run[index] = run[index - 1] + step - jsmath::round(step / 360.0) * 360.0;
            if run[index] < run_west {
                run_west = run[index];
            }
            if run[index] > run_east {
                run_east = run[index];
            }
        }
        if run_east - run_west < east - west {
            longitudes = run;
            west = run_west;
            east = run_east;
        }
    }
    let turn = jsmath::round(((west + east) / 2.0 - middle) / 360.0) * 360.0;
    if turn != 0.0 {
        for value in longitudes.iter_mut() {
            *value -= turn;
        }
    }
    longitudes
}

#[derive(Clone, Debug)]
pub struct Shape {
    pub polygons: Vec<Vec<Vec<f64>>>,
    pub west: f64,
    pub east: f64,
    pub south: f64,
    pub north: f64,
}

pub fn project_region(frame: &Frame, region: &Val) -> Shape {
    let (lng0, cell, cols) = (frame.lng0, frame.cell, frame.cols);
    let y0 = lat_to_y(frame.lat0);
    let middle = lng0 + (cols * cell) / 2.0;
    let mut shape = Shape { polygons: Vec::new(), west: f64::INFINITY, east: f64::NEG_INFINITY, south: f64::INFINITY, north: f64::NEG_INFINITY };
    for polygon in polygons_of(region.get("geometry")) {
        let mut rings = Vec::new();
        for ring in polygon.array_or_empty() {
            let ring = match ring {
                Val::Arr(ring) if ring.len() >= 3 => ring,
                _ => continue,
            };
            let longitudes = ring_longitudes(ring, middle);
            let mut flat = vec![0.0f64; ring.len() * 2];
            for index in 0..ring.len() {
                let x = (longitudes[index] - lng0) / cell;
                let y = (lat_to_y(ring[index].element(1).num()) - y0) / cell;
                flat[index * 2] = x;
                flat[index * 2 + 1] = y;
                if x < shape.west {
                    shape.west = x;
                }
                if x > shape.east {
                    shape.east = x;
                }
                if y < shape.south {
                    shape.south = y;
                }
                if y > shape.north {
                    shape.north = y;
                }
            }
            rings.push(flat);
        }
        if !rings.is_empty() {
            shape.polygons.push(rings);
        }
    }
    shape
}

fn box_may_reach(frame: &Frame, bbox: &Val) -> bool {
    let list = match bbox {
        Val::Arr(list) if list.len() >= 4 => list,
        _ => return true,
    };
    let west = list[0].num();
    let mut east = list[2].num();
    let south = list[1].num();
    let north = list[3].num();
    if ![west, east, south, north].iter().all(|value| value.is_finite()) {
        return true;
    }
    if east < west {
        east += 360.0;
    }
    let y0 = lat_to_y(frame.lat0);
    if (lat_to_y(north) - y0) / frame.cell < 0.0 || (lat_to_y(south) - y0) / frame.cell > frame.rows {
        return false;
    }
    let width = frame.cols * frame.cell;
    let middle = frame.lng0 + width / 2.0;
    let turn = jsmath::round(((west + east) / 2.0 - middle) / 360.0) * 360.0;
    east - turn >= frame.lng0 && west - turn <= frame.lng0 + width
}

fn area_of_rings(rings: &[Vec<f64>]) -> f64 {
    let mut total = 0.0;
    for (ring_index, flat) in rings.iter().enumerate() {
        let count = flat.len() / 2;
        let mut twice = 0.0;
        for index in 0..count {
            let next = if index + 1 == count { 0 } else { index + 1 };
            twice += flat[index * 2] * flat[next * 2 + 1] - flat[next * 2] * flat[index * 2 + 1];
        }
        total += (if ring_index == 0 { 1.0 } else { -1.0 }) * twice.abs() / 2.0;
    }
    jsmath::max(0.0, total)
}

pub trait GridCell: Copy + PartialEq {
    fn empty() -> Self;
}

impl GridCell for u8 {
    fn empty() -> Self {
        0
    }
}

impl GridCell for u16 {
    fn empty() -> Self {
        0
    }
}

#[allow(clippy::too_many_arguments)]
pub fn fill_polygon<T: GridCell>(rings: &[Vec<f64>], grid: &mut [T], width: usize, height: usize, origin_x: f64, origin_y: f64, scale: f64, value: T) -> usize {
    let mut lines: HashMap<i64, Vec<f64>> = HashMap::new();
    let mut lowest = height as i64;
    let mut highest = -1i64;
    for flat in rings {
        let count = flat.len() / 2;
        for index in 0..count {
            let next = if index + 1 == count { 0 } else { index + 1 };
            let from_x = (flat[index * 2] - origin_x) * scale;
            let from_y = (flat[index * 2 + 1] - origin_y) * scale;
            let to_x = (flat[next * 2] - origin_x) * scale;
            let to_y = (flat[next * 2 + 1] - origin_y) * scale;
            if from_y == to_y {
                continue;
            }
            let low = if from_y < to_y { from_y } else { to_y };
            let high = if from_y < to_y { to_y } else { from_y };
            let first = jsmath::max(0.0, (low - 0.5).ceil());
            let last = jsmath::min(height as f64 - 1.0, (high - 0.5).ceil() - 1.0);
            let slope = (to_x - from_x) / (to_y - from_y);
            let mut line = first;
            while line <= last {
                let key = line as i64;
                let crossings = lines.entry(key).or_insert_with(|| {
                    if key < lowest {
                        lowest = key;
                    }
                    if key > highest {
                        highest = key;
                    }
                    Vec::new()
                });
                crossings.push(from_x + (line + 0.5 - from_y) * slope);
                line += 1.0;
            }
        }
    }
    let mut filled = 0;
    let mut line = lowest;
    while line <= highest {
        if let Some(crossings) = lines.get_mut(&line) {
            if crossings.len() >= 2 {
                js::sort_numbers(crossings);
                let base = line as usize * width;
                let mut pair = 0;
                while pair + 1 < crossings.len() {
                    let first = jsmath::max(0.0, (crossings[pair] - 0.5).ceil());
                    let last = jsmath::min(width as f64 - 1.0, (crossings[pair + 1] - 0.5).ceil() - 1.0);
                    let mut sample = first;
                    while sample <= last {
                        let at = base + sample as usize;
                        if grid[at] == T::empty() {
                            grid[at] = value;
                            filled += 1;
                        }
                        sample += 1.0;
                    }
                    pair += 2;
                }
            }
        }
        line += 1;
    }
    filled
}

pub fn speed_of_type(kind: &Val) -> f64 {
    if !kind.truthy() {
        return 1.0;
    }
    let speed = kind.get("pathfindingSpeed").num();
    if matches!(kind.get("passable"), Val::Bool(false)) || speed == 0.0 || is_water_type(kind) {
        return 0.0;
    }
    if !speed.is_finite() {
        return 1.0;
    }
    jsmath::min(TERRAIN_SPEED_MAX, jsmath::max(TERRAIN_SPEED_MIN, speed))
}

#[derive(Clone, Debug, PartialEq)]
pub struct City {
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub cell: f64,
    pub population: f64,
    pub capital: bool,
}

pub fn cities_in_frame(frame: &Frame, cities: &Val) -> Vec<City> {
    let mut placed = Vec::new();
    for city in cities.array_or_empty() {
        let name = text(city.get("name"));
        let lng = city.get("lng").num();
        let lat = city.get("lat").num();
        if name.is_empty() || !lng.is_finite() || !lat.is_finite() {
            continue;
        }
        let [x, y] = frame_to_cell(frame, lng, lat);
        let cell = cell_index_at(frame, x, y);
        if cell < 0.0 {
            continue;
        }
        placed.push(City { name, x, y, cell, population: jsmath::max(0.0, js::or_zero(city.get("population").num())), capital: city.get("capital").is_true() });
    }
    placed
}

fn terrain_levels(frame: &Frame, terrain: &Val) -> Option<Vec<u8>> {
    let mut areas: Vec<&Val> = terrain.get("areas").array_or_empty().iter().filter(|area| area.get("level").num() > 0.0 && area.get("rings").as_array().is_some()).collect();
    js::stable_sort_by(&mut areas, |a, b| b.get("level").num() - a.get("level").num());
    if areas.is_empty() {
        return None;
    }
    let cols = frame.cols as usize;
    let rows = frame.rows as usize;
    let mut levels = vec![0u8; cols * rows];
    let mut filled = 0;
    for area in areas {
        let geometry = Val::obj([("geometry", Val::obj([("type", Val::str("Polygon")), ("coordinates", area.get("rings").clone())]))]);
        let shape = project_region(frame, &geometry);
        if shape.polygons.is_empty() || shape.east < 0.0 || shape.west > frame.cols || shape.north < 0.0 || shape.south > frame.rows {
            continue;
        }
        let level = jsmath::min(10.0, jsmath::round(area.get("level").num())) as u8;
        for rings in &shape.polygons {
            filled += fill_polygon(rings, &mut levels, cols, rows, 0.0, 0.0, 1.0, level);
        }
    }
    if filled > 0 {
        Some(levels)
    } else {
        None
    }
}

#[derive(Clone, Debug)]
pub struct Arena {
    pub key: String,
    pub iced: Option<Vec<u8>>,
    pub frame: Frame,
    pub cols: usize,
    pub rows: usize,
    pub size: usize,
    pub region: Vec<u16>,
    pub ids: Vec<String>,
    pub names: Vec<String>,
    pub index_of: HashMap<String, usize>,
    pub cells: Vec<i32>,
    pub area: Vec<f64>,
    pub outside: Vec<f64>,
    pub speed: Vec<f32>,
    pub region_speed: Vec<f64>,
    pub centre_x: Vec<f64>,
    pub centre_y: Vec<f64>,
    pub cities: Vec<City>,
}

#[derive(Clone, Debug, Default)]
pub struct ArenaOptions {
    pub region_types: Vec<Val>,
    pub cities: Val,
    pub terrain: Val,
    pub frozen: Option<Vec<String>>,
}

pub fn rasterize_arena(frame: &Frame, regions: &[Val], options: &ArenaOptions) -> Arena {
    let cols = frame.cols as usize;
    let rows = frame.rows as usize;
    let size = cols * rows;
    let mut speed_by_type: HashMap<String, f64> = HashMap::new();
    for kind in &options.region_types {
        let id = text(kind.get("id"));
        if !id.is_empty() && !speed_by_type.contains_key(&id) {
            speed_by_type.insert(id, speed_of_type(kind));
        }
    }
    let mut region = vec![0u16; size];
    let mut ids = vec![String::new()];
    let mut names = vec![String::new()];
    let mut index_of: HashMap<String, usize> = HashMap::new();
    let mut cells = vec![0i32];
    let mut area = vec![0.0f64];
    let mut outside = vec![0.0f64];
    let mut region_speed = vec![0.0f64];
    for source in regions {
        let id = text(source.get("id"));
        if id.is_empty() || index_of.contains_key(&id) || ids.len() > 65535 || !box_may_reach(frame, source.get("bbox")) {
            continue;
        }
        let shape = project_region(frame, source);
        if shape.polygons.is_empty() || shape.east < 0.0 || shape.west > frame.cols || shape.north < 0.0 || shape.south > frame.rows {
            continue;
        }
        let value = ids.len() as u16;
        let mut filled = 0;
        let mut whole = 0.0;
        for rings in &shape.polygons {
            filled += fill_polygon(rings, &mut region, cols, rows, 0.0, 0.0, 1.0, value);
            whole += area_of_rings(rings);
        }
        if filled == 0 {
            continue;
        }
        let filled = filled as f64;
        let cut = shape.west < 0.0 || shape.south < 0.0 || shape.east > frame.cols || shape.north > frame.rows;
        index_of.insert(id.clone(), value as usize);
        ids.push(id.clone());
        let name = text(source.get("name"));
        names.push(if name.is_empty() { id } else { name });
        cells.push(filled as i32);
        area.push(if cut { jsmath::max(whole, filled) } else { filled });
        outside.push(if cut { jsmath::max(0.0, whole - filled) } else { 0.0 });
        let type_id = text(source.get("typeId"));
        region_speed.push(speed_by_type.get(&type_id).copied().unwrap_or(1.0));
    }
    let count = ids.len();
    let mut speed = vec![0.0f32; size];
    let mut sum_x = vec![0.0f64; count];
    let mut sum_y = vec![0.0f64; count];
    let levels = terrain_levels(frame, &options.terrain);
    let placed = cities_in_frame(frame, &options.cities);
    let city_cells: Option<Vec<f64>> = levels.as_ref().map(|_| placed.iter().map(|city| city.cell).collect());
    let frozen_ids = options.frozen.as_ref().filter(|frozen| !frozen.is_empty());
    let mut iced = frozen_ids.map(|_| vec![0u8; size]);
    let mut icy: i32 = 0;
    let mut rough: i32 = 0;
    let mut fingerprint: i32 = 0;
    for index in 0..size {
        let mut value = region[index] as usize;
        let mut level = match &levels {
            Some(levels) if value != 0 => levels[index],
            _ => 0,
        };
        if level >= 10 && city_cells.as_ref().is_some_and(|cells| cells.contains(&(index as f64))) {
            level = 9;
        }
        if level >= 10 && region_speed[value] > 0.0 {
            cells[value] -= 1;
            area[value] -= 1.0;
            region[index] = 0;
            value = 0;
        }
        if level > 0 {
            rough = (rough ^ ((index as i32).wrapping_mul(16).wrapping_add(level as i32))).wrapping_mul(2246822507u32 as i32).wrapping_add(1);
        }
        fingerprint = (fingerprint ^ value as i32).wrapping_mul(2246822507u32 as i32).wrapping_add(index as i32);
        fingerprint = ((fingerprint as u32) << 13 | (fingerprint as u32) >> 19) as i32;
        if value == 0 {
            continue;
        }
        if let (Some(iced), Some(frozen)) = (&mut iced, frozen_ids) {
            if region_speed[value] == 0.0 && frozen.contains(&ids[value]) {
                iced[index] = 1;
                icy = (icy ^ index as i32).wrapping_mul(2246822507u32 as i32).wrapping_add(7);
                speed[index] = ICE_SPEED as f32;
                sum_x[value] += (index % cols) as f64 + 0.5;
                sum_y[value] += (index / cols) as f64 + 0.5;
                continue;
            }
        }
        speed[index] = (if level > 0 { (region_speed[value] * (10.0 - level as f64)) / 10.0 } else { region_speed[value] }) as f32;
        sum_x[value] += (index % cols) as f64 + 0.5;
        sum_y[value] += (index / cols) as f64 + 0.5;
    }
    let mut centre_x = vec![0.0f64; count];
    let mut centre_y = vec![0.0f64; count];
    for value in 1..count {
        centre_x[value] = if cells[value] > 0 { sum_x[value] / cells[value] as f64 } else { 0.0 };
        centre_y[value] = if cells[value] > 0 { sum_y[value] / cells[value] as f64 } else { 0.0 };
    }
    let mut parts = vec![
        js::number_to_string(frame.cols),
        js::number_to_string(frame.rows),
        js::number_to_string(fingerprint as u32 as f64),
        ids.join("\u{0002}"),
        region_speed.iter().map(|&speed| js::number_to_string(speed)).collect::<Vec<_>>().join(","),
    ];
    if levels.is_some() {
        parts.push(js::number_to_string(rough as u32 as f64));
    }
    if icy != 0 {
        parts.push(format!("ice{}", icy as u32));
    }
    let refs: Vec<&str> = parts.iter().map(|part| part.as_str()).collect();
    Arena {
        key: hash_key(&refs),
        iced: if icy != 0 { iced } else { None },
        frame: frame.clone(),
        cols,
        rows,
        size,
        region,
        ids,
        names,
        index_of,
        cells,
        area,
        outside,
        speed,
        region_speed,
        centre_x,
        centre_y,
        cities: placed,
    }
}

#[derive(Clone, Copy, Debug)]
pub struct SampleBox {
    pub col0: f64,
    pub row0: f64,
    pub col1: f64,
    pub row1: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Sampled {
    pub grid: Vec<u16>,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

pub fn sample_regions<F: FnMut(usize) -> bool>(arena: &Arena, regions: &[Val], area: SampleBox, scale: f64, mut wanted: F) -> Sampled {
    let width = (area.col1 - area.col0 + 1.0) * scale;
    let height = (area.row1 - area.row0 + 1.0) * scale;
    let mut grid = vec![0u16; jsmath::max(0.0, width * height) as usize];
    let mut drawn = vec![0u8; arena.ids.len()];
    for source in regions {
        let value = arena.index_of.get(&text(source.get("id"))).copied().unwrap_or(0);
        if value == 0 || drawn[value] != 0 || !wanted(value) {
            continue;
        }
        drawn[value] = 1;
        let shape = project_region(&arena.frame, source);
        if shape.east < area.col0 || shape.west > area.col1 + 1.0 || shape.north < area.row0 || shape.south > area.row1 + 1.0 {
            continue;
        }
        for rings in &shape.polygons {
            fill_polygon(rings, &mut grid, width as usize, height as usize, area.col0, area.row0, scale, value as u16);
        }
    }
    Sampled { grid, width, height, scale }
}

pub fn cache_key(map: &Val, frame: &Frame, region_types: &Val) -> String {
    let kinds: Vec<String> = region_types.array_or_empty().iter().map(|kind| format!("{}:{}", text(kind.get("id")), js::number_to_string(speed_of_type(kind)))).collect();
    let kind_refs: Vec<&str> = kinds.iter().map(|kind| kind.as_str()).collect();
    let frozen = match map.get("frozen") {
        Val::Arr(list) if !list.is_empty() => {
            let mut sorted = list.clone();
            js::default_sort(&mut sorted);
            let texts: Vec<String> = sorted.iter().map(|item| if item.is_nullish() { String::new() } else { js::to_string(item) }).collect();
            let refs: Vec<&str> = texts.iter().map(|item| item.as_str()).collect();
            hash_key(&refs)
        }
        _ => String::new(),
    };
    [
        text(map.get("key")),
        js::number_to_string(frame.lng0),
        js::number_to_string(frame.lat0),
        js::number_to_string(frame.cell),
        js::number_to_string(frame.cols),
        js::number_to_string(frame.rows),
        if frame.flat { js::number_to_string(frame.scale) } else { String::new() },
        hash_key(&kind_refs),
        text(map.get("terrain").get("key")),
        frozen,
    ]
    .join("|")
}

pub fn options_of(map: &Val, region_types: &Val) -> ArenaOptions {
    ArenaOptions {
        region_types: region_types.array_or_empty().to_vec(),
        cities: map.get("cities").clone(),
        terrain: if map.get("terrain").is_undef() { Val::Null } else { map.get("terrain").clone() },
        frozen: match map.get("frozen") {
            Val::Arr(list) => Some(list.iter().filter_map(|item| item.as_str().map(|s| s.to_string())).collect()),
            _ => None,
        },
    }
}

pub fn arena_for<'a>(cache: &'a mut HashMap<String, Arena>, map: &Val, frame: &Frame, region_types: &Val) -> Option<std::borrow::Cow<'a, Arena>> {
    let key = if text(map.get("key")).is_empty() { String::new() } else { cache_key(map, frame, region_types) };
    if !key.is_empty() && cache.contains_key(&key) {
        return cache.get(&key).map(std::borrow::Cow::Borrowed);
    }
    let regions = map.get("regions").as_array()?;
    let arena = rasterize_arena(frame, regions, &options_of(map, region_types));
    if key.is_empty() {
        return Some(std::borrow::Cow::Owned(arena));
    }
    cache.insert(key.clone(), arena);
    cache.get(&key).map(std::borrow::Cow::Borrowed)
}
