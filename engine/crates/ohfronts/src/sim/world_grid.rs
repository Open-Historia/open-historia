use super::frame::{unwrap_lng, KM_PER_DEGREE};
use super::js::{self, Val};
use crate::jsmath;

pub const WORLD_STEP_DEG: f64 = 0.25;
pub const WORLD_CELLS_AIM: f64 = 700000.0;
const STEP_LEAST_DEG: f64 = 0.01;
const SUB: usize = 2;
const SOUTH_MOST: f64 = -78.0;
const NORTH_MOST: f64 = 86.0;
const PI: f64 = 3.141592653589793;
const HALF_PI: f64 = PI / 2.0;
const RAD: f64 = PI / 180.0;
const EARTH_KM: f64 = 6371.0088;

const SINE_TERMS: [f64; 9] = [1.0, -1.0 / 6.0, 1.0 / 120.0, -1.0 / 5040.0, 1.0 / 362880.0, -1.0 / 39916800.0, 1.0 / 6227020800.0, -1.0 / 1307674368000.0, 1.0 / 355687428096000.0];
const COSINE_TERMS: [f64; 9] = [1.0, -1.0 / 2.0, 1.0 / 24.0, -1.0 / 720.0, 1.0 / 40320.0, -1.0 / 3628800.0, 1.0 / 479001600.0, -1.0 / 87178291200.0, 1.0 / 20922789888000.0];

fn series_of(terms: &[f64; 9], square: f64) -> f64 {
    let mut sum = 0.0;
    for at in (0..terms.len()).rev() {
        sum = terms[at] + square * sum;
    }
    sum
}

fn sine_of_small(x: f64) -> f64 {
    x * series_of(&SINE_TERMS, x * x)
}

fn cosine_of_small(x: f64) -> f64 {
    series_of(&COSINE_TERMS, x * x)
}

pub fn sine(angle: f64) -> f64 {
    let quarter = jsmath::round(angle / HALF_PI);
    let rest = angle - quarter * HALF_PI;
    let turn = ((quarter % 4.0) + 4.0) % 4.0;
    if turn == 0.0 {
        sine_of_small(rest)
    } else if turn == 1.0 {
        cosine_of_small(rest)
    } else if turn == 2.0 {
        -sine_of_small(rest)
    } else {
        -cosine_of_small(rest)
    }
}

pub fn cosine(angle: f64) -> f64 {
    sine(angle + HALF_PI)
}

fn arc_tan_of_small(x: f64) -> f64 {
    let mut t = x;
    t /= 1.0 + (1.0 + t * t).sqrt();
    t /= 1.0 + (1.0 + t * t).sqrt();
    let s = t * t;
    let mut sum = 0.0;
    let mut odd = 27.0;
    while odd >= 1.0 {
        sum = 1.0 / odd - s * sum;
        odd -= 2.0;
    }
    4.0 * t * sum
}

pub fn arc_tan2(y: f64, x: f64) -> f64 {
    if x == 0.0 && y == 0.0 {
        return 0.0;
    }
    let ay = if y < 0.0 { -y } else { y };
    let ax = if x < 0.0 { -x } else { x };
    let angle = if ax >= ay { arc_tan_of_small(ay / ax) } else { HALF_PI - arc_tan_of_small(ax / ay) };
    let turned = if x < 0.0 { PI - angle } else { angle };
    if y < 0.0 {
        -turned
    } else {
        turned
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Surface {
    pub flat: bool,
    pub scale: f64,
}

impl Default for Surface {
    fn default() -> Self {
        Surface { flat: false, scale: KM_PER_DEGREE }
    }
}

pub fn km_between(lng_a: f64, lat_a: f64, lng_b: f64, lat_b: f64, surface: Surface) -> f64 {
    if surface.flat {
        return ((lng_b - lng_a) * (lng_b - lng_a) + (lat_b - lat_a) * (lat_b - lat_a)).sqrt() * surface.scale;
    }
    let a = lat_a * RAD;
    let b = lat_b * RAD;
    let down = sine((b - a) / 2.0);
    let across = sine(((lng_b - lng_a) * RAD) / 2.0);
    let h = jsmath::min(1.0, jsmath::max(0.0, down * down + cosine(a) * cosine(b) * across * across));
    2.0 * EARTH_KM * arc_tan2(h.sqrt(), (1.0 - h).sqrt())
}

pub fn great_point(lng_a: f64, lat_a: f64, lng_b: f64, lat_b: f64, share: f64) -> [f64; 2] {
    let a = [cosine(lat_a * RAD) * cosine(lng_a * RAD), cosine(lat_a * RAD) * sine(lng_a * RAD), sine(lat_a * RAD)];
    let b = [cosine(lat_b * RAD) * cosine(lng_b * RAD), cosine(lat_b * RAD) * sine(lng_b * RAD), sine(lat_b * RAD)];
    let dot = jsmath::max(-1.0, jsmath::min(1.0, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    let sine_of_angle = jsmath::max(0.0, 1.0 - dot * dot).sqrt();
    let angle = arc_tan2(sine_of_angle, dot);
    if !(angle > 1e-9) {
        return [lng_a, lat_a];
    }
    if !(sine_of_angle > 1e-9) {
        return [lng_a + (unwrap_lng(lng_b, lng_a) - lng_a) * share, lat_a + (lat_b - lat_a) * share];
    }
    let ka = sine((1.0 - share) * angle) / sine_of_angle;
    let kb = sine(share * angle) / sine_of_angle;
    let x = ka * a[0] + kb * b[0];
    let y = ka * a[1] + kb * b[1];
    let z = ka * a[2] + kb * b[2];
    [arc_tan2(y, x) / RAD, arc_tan2(z, (x * x + y * y).sqrt()) / RAD]
}

fn rings_of(geometry: &Val) -> Vec<Val> {
    if !geometry.truthy() {
        return Vec::new();
    }
    match geometry.get("type").as_str() {
        Some("Polygon") => vec![geometry.get("coordinates").clone()],
        Some("MultiPolygon") => match geometry.get("coordinates") {
            Val::Arr(list) => list.clone(),
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}

fn bounds_of(regions: &[Val]) -> Option<[f64; 4]> {
    let mut west = f64::INFINITY;
    let mut south = f64::INFINITY;
    let mut east = f64::NEG_INFINITY;
    let mut north = f64::NEG_INFINITY;
    for region in regions {
        for polygon in rings_of(region.get("geometry")) {
            let outer = polygon.element(0);
            if let Val::Arr(points) = &outer {
                for point in points {
                    let lng = point.element(0).num();
                    let lat = point.element(1).num();
                    if !lng.is_finite() || !lat.is_finite() {
                        continue;
                    }
                    if lng < west {
                        west = lng;
                    }
                    if lng > east {
                        east = lng;
                    }
                    if lat < south {
                        south = lat;
                    }
                    if lat > north {
                        north = lat;
                    }
                }
            }
        }
    }
    if west.is_finite() {
        Some([west, south, east, north])
    } else {
        None
    }
}

pub fn world_sheet_key(map_key: &str, water: Option<&[String]>) -> String {
    let mut types: Vec<String> = water.map(|list| list.to_vec()).unwrap_or_default();
    types.sort_by(|a, b| js::compare_units(a, b));
    if types.is_empty() {
        format!("world|{map_key}")
    } else {
        format!("world|{map_key}|water:{}", types.join("\u{0002}"))
    }
}

#[derive(Clone, Debug)]
pub struct StepKm {
    pub along: Vec<f64>,
    pub aslant: Vec<f64>,
    pub down: f64,
}

#[derive(Clone, Debug)]
pub struct WorldGrid {
    pub cols: usize,
    pub rows: usize,
    pub west: f64,
    pub north: f64,
    pub step: f64,
    pub wrap: bool,
    pub flat: bool,
    pub scale: f64,
    pub land: Vec<u8>,
    pub region: Vec<i32>,
    pub ids: Vec<String>,
    pub full: u8,
    pub step_km: StepKm,
    pub row_cosine: Vec<f64>,
    pub seas: Option<Vec<i32>>,
    pub sea_count: usize,
}

#[derive(Clone, Debug, Default)]
pub struct GridOptions {
    pub flat: bool,
    pub scale: Option<f64>,
    pub step: f64,
    pub water: Option<Vec<String>>,
}

pub fn build_world_grid(list: &[Val], options: &GridOptions) -> Option<WorldGrid> {
    let flat = options.flat;
    let scale = options.scale.unwrap_or(KM_PER_DEGREE);
    let [box_west, box_south, box_east, box_north] = bounds_of(list)?;
    let wrap = !flat && box_east - box_west > 300.0;
    let pad = jsmath::max(1.0, jsmath::max(box_east - box_west, box_north - box_south) * 0.2);
    let west = if wrap { -180.0 } else { box_west - pad };
    let east = if wrap { 180.0 } else { box_east + pad };
    let south = if flat { box_south - pad } else { jsmath::max(SOUTH_MOST, box_south - pad) };
    let north = if flat { box_north + pad } else { jsmath::min(NORTH_MOST, box_north + pad) };
    if !(east > west) || !(north > south) {
        return None;
    }
    let aimed = (((east - west) * (north - south)) / WORLD_CELLS_AIM).sqrt();
    let step = if options.step > 0.0 { jsmath::max(STEP_LEAST_DEG, options.step) } else { jsmath::min(WORLD_STEP_DEG, jsmath::max(STEP_LEAST_DEG, aimed)) };
    let cols = jsmath::max(1.0, if wrap { jsmath::round(360.0 / step) } else { ((east - west) / step).ceil() }) as usize;
    let rows = jsmath::max(1.0, ((north - south) / step).ceil()) as usize;
    let sub = step / SUB as f64;
    let sub_cols = cols * SUB;
    let sub_rows = rows * SUB;
    let mut samples = vec![0i32; sub_cols * sub_rows];
    let mut ids = vec![String::new()];
    let wet = options.water.as_ref().filter(|water| !water.is_empty());
    for region in list {
        let id = js::trim(&region.get("id").string_or_empty()).to_string();
        if id.is_empty() {
            continue;
        }
        if let Some(wet) = wet {
            let kind = js::trim(&region.get("typeId").string_or_empty()).to_string();
            if wet.contains(&kind) {
                continue;
            }
        }
        ids.push(id);
        let mark = (ids.len() - 1) as i32;
        for polygon in rings_of(region.get("geometry")) {
            let outer = match (&polygon, polygon.element(0)) {
                (Val::Arr(_), Val::Arr(outer)) if outer.len() >= 3 => outer,
                _ => continue,
            };
            let around = js::or_zero(outer[0].element(0).num());
            let mut top = f64::NEG_INFINITY;
            let mut bottom = f64::INFINITY;
            for point in &outer {
                let lat = point.element(1).num();
                if lat > top {
                    top = lat;
                }
                if lat < bottom {
                    bottom = lat;
                }
            }
            let first = jsmath::max(0.0, ((north - top) / sub - 0.5).ceil());
            let last = jsmath::min((sub_rows - 1) as f64, ((north - bottom) / sub - 0.5).floor());
            if !(last >= first) {
                continue;
            }
            let first_row = first as usize;
            let last_row = last as usize;
            let mut crossings: Vec<Vec<f64>> = vec![Vec::new(); last_row - first_row + 1];
            for ring in polygon.array_or_empty() {
                let ring = match ring {
                    Val::Arr(ring) if ring.len() >= 3 => ring,
                    _ => continue,
                };
                let mut x2 = unwrap_lng(ring[0].element(0).num(), around);
                let mut y2 = ring[0].element(1).num();
                for at in 0..ring.len() - 1 {
                    let x1 = x2;
                    let y1 = y2;
                    x2 = unwrap_lng(ring[at + 1].element(0).num(), x1);
                    y2 = ring[at + 1].element(1).num();
                    if y1 == y2 || !(x1 + x2 + y1 + y2).is_finite() {
                        continue;
                    }
                    let high = jsmath::max(y1, y2);
                    let low = jsmath::min(y1, y2);
                    let from = jsmath::max(first, ((north - high) / sub - 0.5).ceil());
                    let to = jsmath::min(last, ((north - low) / sub - 0.5).floor());
                    let mut row = from;
                    while row <= to {
                        let lat = north - (row + 0.5) * sub;
                        if !(lat < low || lat >= high) {
                            crossings[(row - first) as usize].push(x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1));
                        }
                        row += 1.0;
                    }
                }
            }
            for row in first_row..=last_row {
                let hits = &mut crossings[row - first_row];
                if hits.len() < 2 {
                    continue;
                }
                js::sort_numbers(hits);
                let mut pair = 0;
                while pair + 1 < hits.len() {
                    let begin = ((hits[pair] - west) / sub - 0.5).ceil();
                    let end = ((hits[pair + 1] - west) / sub - 0.5).floor();
                    let mut col = begin;
                    while col <= end {
                        let across = if wrap { ((col % sub_cols as f64) + sub_cols as f64) % sub_cols as f64 } else { col };
                        if across >= 0.0 && across < sub_cols as f64 {
                            samples[row * sub_cols + across as usize] = mark;
                        }
                        col += 1.0;
                    }
                    pair += 2;
                }
            }
        }
    }
    let mut land = vec![0u8; cols * rows];
    let mut region = vec![0i32; cols * rows];
    let mut any = false;
    for row in 0..rows {
        for col in 0..cols {
            let mut count = 0u8;
            let mut found = 0i32;
            for dy in 0..SUB {
                for dx in 0..SUB {
                    let mark = samples[(row * SUB + dy) * sub_cols + col * SUB + dx];
                    if mark == 0 {
                        continue;
                    }
                    count += 1;
                    if found == 0 {
                        found = mark;
                    }
                }
            }
            if count == 0 {
                continue;
            }
            any = true;
            land[row * cols + col] = count;
            region[row * cols + col] = found;
        }
    }
    if !any {
        return None;
    }
    let surface = Surface { flat, scale };
    let mut along = vec![0.0; rows];
    let mut aslant = vec![0.0; rows];
    for row in 0..rows {
        let lat = north - (row as f64 + 0.5) * step;
        along[row] = km_between(0.0, lat, step, lat, surface);
        aslant[row] = km_between(0.0, lat, step, lat - step, surface);
    }
    let down = km_between(0.0, north - step * 0.5, 0.0, north - step * 1.5, surface);
    let row_cosine = (0..rows).map(|row| cosine((north - (row as f64 + 0.5) * step) * RAD)).collect();
    Some(WorldGrid {
        cols,
        rows,
        west,
        north,
        step,
        wrap,
        flat,
        scale,
        land,
        region,
        ids,
        full: (SUB * SUB) as u8,
        step_km: StepKm { along, aslant, down },
        row_cosine,
        seas: None,
        sea_count: 0,
    })
}

impl WorldGrid {
    pub fn surface(&self) -> Surface {
        Surface { flat: self.flat, scale: self.scale }
    }

    pub fn cell_of(&self, lng: f64, lat: f64) -> f64 {
        let cols = self.cols as f64;
        let row = ((self.north - lat) / self.step).floor();
        let mut col = (((if self.wrap { unwrap_lng(lng, 0.0) } else { lng }) - self.west) / self.step).floor();
        if self.wrap {
            col = ((col % cols) + cols) % cols;
        }
        if row < 0.0 || row >= self.rows as f64 || col < 0.0 || col >= cols {
            -1.0
        } else {
            row * cols + col
        }
    }

    pub fn centre_of(&self, cell: f64) -> [f64; 2] {
        let cols = self.cols as f64;
        [self.west + ((cell % cols) + 0.5) * self.step, self.north - ((cell / cols).floor() + 0.5) * self.step]
    }

    pub fn km(&self, lng_a: f64, lat_a: f64, lng_b: f64, lat_b: f64) -> f64 {
        km_between(lng_a, lat_a, lng_b, lat_b, self.surface())
    }
}

pub enum DistanceTo {
    Flat { cols: usize, goal_row: f64, goal_col: f64, step: f64, scale: f64 },
    Round { cols: usize, goal_col: f64, wrap: bool, down: Vec<f64>, across: Vec<f64>, row_cosine: Vec<f64>, goal_cosine: f64 },
}

impl DistanceTo {
    pub fn km(&self, cell: f64) -> f64 {
        match self {
            DistanceTo::Flat { cols, goal_row, goal_col, step, scale } => {
                let cols = *cols as f64;
                let dx = (cell % cols) - goal_col;
                let dy = (cell / cols).floor() - goal_row;
                (dx * dx + dy * dy).sqrt() * step * scale
            }
            DistanceTo::Round { cols, goal_col, wrap, down, across, row_cosine, goal_cosine } => {
                let cols = *cols as f64;
                let row = (cell / cols).floor();
                let mut apart = (cell % cols) - goal_col;
                if apart < 0.0 {
                    apart = -apart;
                }
                if *wrap && apart > cols - apart {
                    apart = cols - apart;
                }
                let pick = |list: &Vec<f64>, at: f64| if at >= 0.0 && (at as usize) < list.len() && at.fract() == 0.0 { list[at as usize] } else { f64::NAN };
                let h = jsmath::min(1.0, pick(down, row) + pick(row_cosine, row) * goal_cosine * pick(across, apart));
                2.0 * EARTH_KM * arc_tan2(h.sqrt(), (1.0 - h).sqrt())
            }
        }
    }
}

pub fn distance_to(grid: &WorldGrid, goal: f64) -> DistanceTo {
    let cols = grid.cols as f64;
    let goal_row = (goal / cols).floor();
    let goal_col = goal % cols;
    if grid.flat {
        return DistanceTo::Flat { cols: grid.cols, goal_row, goal_col, step: grid.step, scale: grid.scale };
    }
    let down = (0..grid.rows)
        .map(|row| {
            let half = sine(((row as f64 - goal_row) * grid.step * RAD) / 2.0);
            half * half
        })
        .collect();
    let across = (0..grid.cols)
        .map(|apart| {
            let half = sine((apart as f64 * grid.step * RAD) / 2.0);
            half * half
        })
        .collect();
    let goal_cosine = if goal_row >= 0.0 && (goal_row as usize) < grid.row_cosine.len() { grid.row_cosine[goal_row as usize] } else { f64::NAN };
    DistanceTo::Round { cols: grid.cols, goal_col, wrap: grid.wrap, down, across, row_cosine: grid.row_cosine.clone(), goal_cosine }
}

pub fn seas_of(grid: &mut WorldGrid) -> &Vec<i32> {
    if grid.seas.is_none() {
        let (cols, rows, full, wrap) = (grid.cols, grid.rows, grid.full, grid.wrap);
        let land = &grid.land;
        let mut seas = vec![0i32; cols * rows];
        let mut stack: Vec<usize> = Vec::new();
        let mut count = 0i32;
        for start in 0..seas.len() {
            if seas[start] != 0 || land[start] >= full {
                continue;
            }
            count += 1;
            seas[start] = count;
            stack.push(start);
            while let Some(cell) = stack.pop() {
                let row = (cell / cols) as i64;
                let col = (cell % cols) as i64;
                for dy in -1i64..=1 {
                    let y = row + dy;
                    if y < 0 || y >= rows as i64 {
                        continue;
                    }
                    for dx in -1i64..=1 {
                        if dx == 0 && dy == 0 {
                            continue;
                        }
                        let mut x = col + dx;
                        if wrap {
                            x = (x + cols as i64) % cols as i64;
                        } else if x < 0 || x >= cols as i64 {
                            continue;
                        }
                        let next = (y * cols as i64 + x) as usize;
                        if seas[next] != 0 || land[next] >= full {
                            continue;
                        }
                        seas[next] = count;
                        stack.push(next);
                    }
                }
            }
        }
        grid.seas = Some(seas);
        grid.sea_count = count as usize;
    }
    grid.seas.as_ref().unwrap()
}

pub fn nearest_cell<F: FnMut(i64, i64) -> bool>(grid: &WorldGrid, cell: i64, reach: f64, mut visit: F) -> i64 {
    if cell < 0 {
        return -1;
    }
    let cols = grid.cols as i64;
    let rows = grid.rows as i64;
    let row = cell / cols;
    let col = cell % cols;
    if visit(cell, 0) {
        return cell;
    }
    let mut ring = 1i64;
    while ring as f64 <= reach {
        let mut best = -1i64;
        let mut least = f64::INFINITY;
        for dy in -ring..=ring {
            let y = row + dy;
            if y < 0 || y >= rows {
                continue;
            }
            let edge = dy.abs() == ring;
            let mut dx = -ring;
            while dx <= ring {
                let mut x = col + dx;
                let mut skip = false;
                if grid.wrap {
                    x = ((x % cols) + cols) % cols;
                } else if x < 0 || x >= cols {
                    skip = true;
                }
                if !skip {
                    let next = y * cols + x;
                    let far = (dx * dx + dy * dy) as f64;
                    if far < least && visit(next, ring) {
                        least = far;
                        best = next;
                    }
                }
                dx += if edge { 1 } else { 2 * ring };
            }
        }
        if best >= 0 {
            return best;
        }
        ring += 1;
    }
    -1
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placed {
    pub lng: f64,
    pub lat: f64,
    pub leg: usize,
    pub bearing: f64,
}

pub fn place_along(points: &[[f64; 2]], km: f64, surface: Surface) -> Option<Placed> {
    if points.is_empty() {
        return None;
    }
    let mut left = jsmath::max(0.0, js::or_zero(km));
    for leg in 0..points.len().saturating_sub(1) {
        let [lng_a, lat_a] = points[leg];
        let [lng_b, lat_b] = points[leg + 1];
        let length = km_between(lng_a, lat_a, lng_b, lat_b, surface);
        if left <= length || leg + 2 == points.len() {
            let share = if length > 0.0 { jsmath::min(1.0, left / length) } else { 1.0 };
            let across = unwrap_lng(lng_b, lng_a) - lng_a;
            let bearing = (arc_tan2(if surface.flat { across } else { across * cosine(((lat_a + lat_b) / 2.0) * RAD) }, lat_b - lat_a) / RAD + 360.0) % 360.0;
            return Some(Placed { lng: unwrap_lng(lng_a + across * share, 0.0), lat: lat_a + (lat_b - lat_a) * share, leg, bearing });
        }
        left -= length;
    }
    Some(Placed { lng: points[0][0], lat: points[0][1], leg: 0, bearing: 0.0 })
}

pub fn way_km(points: &[[f64; 2]], surface: Surface) -> f64 {
    let mut total = 0.0;
    for leg in 0..points.len().saturating_sub(1) {
        total += km_between(points[leg][0], points[leg][1], points[leg + 1][0], points[leg + 1][1], surface);
    }
    total
}
