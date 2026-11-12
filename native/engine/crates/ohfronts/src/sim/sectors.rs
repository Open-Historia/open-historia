use super::arena::Arena;
use super::constants::{PLACE_SECTOR_KM, SECTOR_AXIS_SHARE};
use super::field::Contour;
use super::js::{self, fold, fold_text, Val};

const DIAGONAL: f64 = 0.7071067811865476;

pub struct Axis {
    pub x: f64,
    pub y: f64,
    pub high: &'static str,
    pub low: &'static str,
    pub name: &'static str,
    pub diagonal: bool,
}

pub const AXES: [Axis; 4] = [
    Axis { x: 0.0, y: 1.0, high: "north", low: "south", name: "north-south", diagonal: false },
    Axis { x: 1.0, y: 0.0, high: "east", low: "west", name: "east-west", diagonal: false },
    Axis { x: DIAGONAL, y: DIAGONAL, high: "northeast", low: "southwest", name: "northeast-southwest", diagonal: true },
    Axis { x: DIAGONAL, y: -DIAGONAL, high: "southeast", low: "northwest", name: "northwest-southeast", diagonal: true },
];

pub const COMPASS_WORDS: [&str; 8] = ["north", "south", "east", "west", "northeast", "southwest", "southeast", "northwest"];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cut {
    pub x: f64,
    pub y: f64,
    pub from: f64,
    pub to: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Sectors {
    pub axis: String,
    pub names: Vec<String>,
    pub cuts: Vec<(String, Cut)>,
}

impl Sectors {
    pub fn cut(&self, name: &str) -> Option<Cut> {
        self.cuts.iter().find(|(key, _)| key == name).map(|(_, cut)| *cut)
    }

    fn set(&mut self, name: &str, cut: Cut) {
        match self.cuts.iter_mut().find(|(key, _)| key == name) {
            Some(entry) => entry.1 = cut,
            None => self.cuts.push((name.to_string(), cut)),
        }
    }
}

pub fn read_sectors(contour: &Contour, count: usize) -> Sectors {
    let spans: Vec<(f64, f64, f64)> = AXES
        .iter()
        .map(|axis| {
            let mut low = f64::INFINITY;
            let mut high = f64::NEG_INFINITY;
            for vertex in 0..count {
                let along = contour.x[vertex] * axis.x + contour.y[vertex] * axis.y;
                if along < low {
                    low = along;
                }
                if along > high {
                    high = along;
                }
            }
            if count > 0 {
                (low, high, high - low)
            } else {
                (0.0, 0.0, 0.0)
            }
        })
        .collect();
    let mut widest = 0;
    for index in 1..AXES.len() {
        if spans[index].2 > spans[widest].2 {
            widest = index;
        }
    }
    let least = spans[widest].2 * SECTOR_AXIS_SHARE;
    let fits: Vec<bool> = spans.iter().map(|span| span.2 > 0.0 && span.2 >= least).collect();
    let longest = if AXES[widest].diagonal && fits[if widest == 2 { 3 } else { 2 }] {
        if spans[1].2 > spans[0].2 {
            1
        } else {
            0
        }
    } else {
        widest
    };
    let both = fits[0] && fits[1];
    let mut sectors = Sectors { axis: String::new(), names: vec!["all".to_string()], cuts: Vec::new() };
    let mut order = vec![longest];
    order.extend((0..AXES.len()).filter(|&index| index != longest));
    for index in order {
        if !fits[index] || (AXES[index].diagonal && !both) {
            continue;
        }
        let axis = &AXES[index];
        let (low, _, extent) = spans[index];
        sectors.set(axis.high, Cut { x: axis.x, y: axis.y, from: low + (extent * 2.0) / 3.0, to: f64::INFINITY });
        sectors.set(axis.low, Cut { x: axis.x, y: axis.y, from: f64::NEG_INFINITY, to: low + extent / 3.0 });
        if index != longest {
            sectors.names.push(axis.high.to_string());
            sectors.names.push(axis.low.to_string());
            continue;
        }
        sectors.names.push(axis.high.to_string());
        sectors.names.push("centre".to_string());
        sectors.names.push(axis.low.to_string());
        sectors.set("centre", Cut { x: axis.x, y: axis.y, from: low + extent / 3.0, to: low + (extent * 2.0) / 3.0 });
    }
    sectors.axis = if spans[longest].2 > 0.0 { AXES[longest].name.to_string() } else { String::new() };
    sectors
}

fn parse_place(value: &Val) -> (String, String) {
    let text = fold(value);
    for kind in ["city", "region"] {
        if let Some(rest) = text.strip_prefix(kind) {
            let rest = rest.trim_start_matches(js::is_js_whitespace);
            if let Some(rest) = rest.strip_prefix(':') {
                let rest = rest.trim_start_matches(js::is_js_whitespace);
                return (kind.to_string(), js::trim(rest).to_string());
            }
        }
    }
    (String::new(), text)
}

#[derive(Clone, Debug, PartialEq)]
pub struct Place {
    pub kind: &'static str,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub cell: Option<f64>,
    pub region: Option<usize>,
}

pub fn find_place(arena: &Arena, value: &Val) -> Option<Place> {
    let (kind, name) = parse_place(value);
    if name.is_empty() {
        return None;
    }
    if kind != "region" {
        if let Some(city) = arena.cities.iter().find(|entry| fold_text(&entry.name) == name) {
            return Some(Place { kind: "city", name: city.name.clone(), x: city.x, y: city.y, cell: Some(city.cell), region: None });
        }
    }
    if kind != "city" {
        for index in 1..arena.names.len() {
            if fold_text(&arena.names[index]) == name {
                return Some(Place { kind: "region", name: arena.names[index].clone(), x: arena.centre_x[index], y: arena.centre_y[index], cell: None, region: Some(index) });
            }
        }
    }
    None
}

pub fn place_text(kind: &str, name: &str) -> String {
    format!("{kind}: {name}")
}

pub fn describe_point(arena: &Arena, x: f64, y: f64) -> String {
    let place = arena.projector();
    let mut best = None;
    let mut best_km = f64::INFINITY;
    for city in &arena.cities {
        let dx = city.x - x;
        let dy = city.y - y;
        let km = (dx * dx + dy * dy).sqrt() * place.km_at((city.y + y) / 2.0);
        if km < best_km {
            best_km = km;
            best = Some(city);
        }
    }
    if let Some(city) = best {
        return format!("city: {}", city.name);
    }
    if x >= 0.0 && y >= 0.0 && x < arena.cols as f64 && y < arena.rows as f64 {
        let region = arena.region[(y.floor() * arena.cols as f64 + x.floor()) as usize] as usize;
        if region > 0 && arena.names[region] != arena.ids[region] {
            return format!("region: {}", arena.names[region]);
        }
    }
    String::new()
}

pub fn nearest_vertex(contour: &Contour, count: usize, x: f64, y: f64) -> i64 {
    let mut best = -1i64;
    let mut best_distance = f64::INFINITY;
    for vertex in 0..count {
        let dx = contour.x[vertex] - x;
        let dy = contour.y[vertex] - y;
        let distance = dx * dx + dy * dy;
        if distance < best_distance {
            best_distance = distance;
            best = vertex as i64;
        }
    }
    best
}

#[derive(Clone, Debug, PartialEq)]
pub enum Sector {
    All,
    Cut { word: String, cut: Cut },
    Place { word: String, px: f64, py: f64 },
}

pub fn resolve_sector(arena: &Arena, contour: &Contour, count: usize, sectors: &Sectors, value: &Val) -> Option<Sector> {
    let word = fold(value);
    if word.is_empty() || word == "all" {
        return Some(Sector::All);
    }
    let name = if word == "center" { "centre".to_string() } else { word };
    if let Some(cut) = sectors.cut(&name) {
        return Some(Sector::Cut { word: name, cut });
    }
    if name == "centre" || COMPASS_WORDS.contains(&name.as_str()) {
        return None;
    }
    let place = find_place(arena, value)?;
    let vertex = nearest_vertex(contour, count, place.x, place.y);
    if vertex < 0 {
        return None;
    }
    Some(Sector::Place { word: place_text(place.kind, &place.name), px: contour.x[vertex as usize], py: contour.y[vertex as usize] })
}

pub fn in_sector<K: Fn(f64) -> f64>(sector: &Sector, x: f64, y: f64, km_at: K) -> bool {
    match sector {
        Sector::All => true,
        Sector::Cut { cut, .. } => {
            let along = x * cut.x + y * cut.y;
            along >= cut.from && along <= cut.to
        }
        Sector::Place { px, py, .. } => {
            let dx = x - px;
            let dy = y - py;
            (dx * dx + dy * dy).sqrt() * km_at((y + py) / 2.0) <= PLACE_SECTOR_KM
        }
    }
}

pub fn sector_middle<K: Fn(f64) -> f64>(contour: &Contour, count: usize, sector: &Sector, km_at: K) -> [f64; 2] {
    let (mut sum_x, mut sum_y, mut inside, mut all_x, mut all_y) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for vertex in 0..count {
        all_x += contour.x[vertex];
        all_y += contour.y[vertex];
        if !in_sector(sector, contour.x[vertex], contour.y[vertex], &km_at) {
            continue;
        }
        sum_x += contour.x[vertex];
        sum_y += contour.y[vertex];
        inside += 1.0;
    }
    if inside > 0.0 {
        return [sum_x / inside, sum_y / inside];
    }
    if count > 0 {
        [all_x / count as f64, all_y / count as f64]
    } else {
        [0.0, 0.0]
    }
}
