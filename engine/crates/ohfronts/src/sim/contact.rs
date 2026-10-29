use super::constants::{CONTACT_WITHIN_KM, FRAME_MARGIN_KM};
use super::frame::{create_frame, lat_to_y, y_to_lat, Bounds, Frame};
use super::js::{self, Val};
use crate::jsmath;

const TOUCH_DEGREES: f64 = 0.02;

pub fn box_of(region: &Val) -> [f64; 4] {
    let stated = region.get("bbox");
    if let Val::Arr(list) = stated {
        if list.len() >= 4 && list.iter().all(|value| value.num().is_finite()) {
            let mut found = [list[0].num(), list[1].num(), list[2].num(), list[3].num()];
            if found[2] < found[0] {
                found[2] += 360.0;
            }
            return found;
        }
    }
    let mut west = f64::INFINITY;
    let mut south = f64::INFINITY;
    let mut east = f64::NEG_INFINITY;
    let mut north = f64::NEG_INFINITY;
    let geometry = region.get("geometry");
    let polygons: Vec<Val> = match geometry.get("type").as_str() {
        Some("Polygon") => vec![geometry.get("coordinates").clone()],
        Some("MultiPolygon") => geometry.get("coordinates").array_or_empty().to_vec(),
        _ => Vec::new(),
    };
    for polygon in &polygons {
        let outer = polygon.element(0);
        for point in outer.array_or_empty() {
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
    if west <= east && south <= north {
        if east - west > 180.0 {
            [east, south, west + 360.0, north]
        } else {
            [west, south, east, north]
        }
    } else {
        [0.0, 0.0, 0.0, 0.0]
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
}

impl Area {
    pub fn bounds(&self) -> Bounds {
        Bounds { west: self.west, south: self.south, east: self.east, north: self.north }
    }
}

fn boxes_of_sides<F: FnMut(&str) -> Option<usize>>(regions: &[Val], side_of: &mut F, around: Option<f64>) -> [Vec<Area>; 2] {
    let mut held: [Vec<Area>; 2] = [Vec::new(), Vec::new()];
    let mut middle = around;
    for region in regions {
        let id = js::trim(&region.get("id").string_or_empty()).to_string();
        let side = match side_of(&id) {
            Some(side @ (0 | 1)) => side,
            _ => continue,
        };
        let [west, south, east, north] = box_of(region);
        if west == east && south == north {
            continue;
        }
        let centre = *middle.get_or_insert((west + east) / 2.0);
        let turn = jsmath::round(((west + east) / 2.0 - centre) / 360.0) * 360.0;
        held[side].push(Area { west: west - turn, south, east: east - turn, north });
    }
    held
}

fn map_flat(map: &Val) -> bool {
    map.get("flat").is_true()
}

fn map_scale(map: &Val) -> f64 {
    map.get("scale").num()
}

fn bounds_round(contact: Area, held: &[Vec<Area>; 2], map: &Val) -> Option<Area> {
    let probe = create_frame(contact.bounds(), map_flat(map), map_scale(map), 0.0)?;
    let reach = CONTACT_WITHIN_KM / (probe.km / probe.cell);
    let west = contact.west - reach;
    let east = contact.east + reach;
    let south = y_to_lat(jsmath::max(lat_to_y(-85.0), lat_to_y(contact.south) - reach));
    let north = y_to_lat(jsmath::min(lat_to_y(85.0), lat_to_y(contact.north) + reach));
    let mut bounds = Area { west: f64::INFINITY, south: f64::INFINITY, east: f64::NEG_INFINITY, north: f64::NEG_INFINITY };
    for side in held {
        for area in side {
            if area.west > east || area.east < west || area.south > north || area.north < south {
                continue;
            }
            bounds.west = jsmath::min(bounds.west, jsmath::max(west, area.west));
            bounds.east = jsmath::max(bounds.east, jsmath::min(east, area.east));
            bounds.south = jsmath::min(bounds.south, jsmath::max(south, area.south));
            bounds.north = jsmath::max(bounds.north, jsmath::min(north, area.north));
        }
    }
    if bounds.east > bounds.west && bounds.north > bounds.south {
        Some(bounds)
    } else {
        None
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Contact {
    pub bounds: Area,
    pub lng: f64,
    pub lat: f64,
}

pub fn contact_at<F: FnMut(&str) -> Option<usize>>(regions: &[Val], mut side_of: F, map: &Val, lng: f64, lat: f64) -> Option<Contact> {
    let held = boxes_of_sides(regions, &mut side_of, Some(lng));
    let bounds = bounds_round(Area { west: lng - 0.05, south: lat - 0.05, east: lng + 0.05, north: lat + 0.05 }, &held, map)?;
    Some(Contact { bounds, lng, lat })
}

pub fn middle_of(region: &Val) -> [f64; 2] {
    let [west, south, east, north] = box_of(region);
    [(west + east) / 2.0, (south + north) / 2.0]
}

fn find(parent: &mut [usize], start: usize) -> usize {
    let mut root = start;
    while parent[root] != root {
        root = parent[root];
    }
    let mut index = start;
    while parent[index] != root {
        let next = parent[index];
        parent[index] = root;
        index = next;
    }
    root
}

fn touching(a: &Area, b: &Area) -> bool {
    !(a.west > b.east + TOUCH_DEGREES || b.west > a.east + TOUCH_DEGREES || a.south > b.north + TOUCH_DEGREES || b.south > a.north + TOUCH_DEGREES)
}

fn meet(meeting: &mut Vec<((usize, usize), usize, Area)>, key: (usize, usize), a: usize, area: Area) {
    match meeting.iter_mut().find(|(known, _, _)| *known == key) {
        Some(entry) => {
            entry.1 = a;
            entry.2 = area;
        }
        None => meeting.push((key, a, area)),
    }
}

fn join(parent: &mut [usize], a: usize, b: usize) {
    let root_a = find(parent, a);
    let root_b = find(parent, b);
    if root_a != root_b {
        parent[root_a.max(root_b)] = root_a.min(root_b);
    }
}

pub fn find_contacts<F: FnMut(&str) -> Option<usize>>(regions: &[Val], mut side_of: F, map: &Val) -> Vec<Contact> {
    let held = boxes_of_sides(regions, &mut side_of, None);
    if held[0].is_empty() || held[1].is_empty() {
        return Vec::new();
    }
    let count_a = held[0].len();
    let mut parent: Vec<usize> = (0..count_a + held[1].len()).collect();
    let mut meeting: Vec<((usize, usize), usize, Area)> = Vec::new();
    let frozen: Option<&Vec<Val>> = match map.get("frozen") {
        Val::Arr(list) if !list.is_empty() => Some(list),
        _ => None,
    };
    if let Some(frozen) = frozen {
        let mut ice: Vec<Area> = Vec::new();
        for region in regions {
            let id = region.get("id");
            if !frozen.iter().any(|item| js::same_value_zero(item, id)) {
                continue;
            }
            let [west, south, east, north] = box_of(region);
            if east >= west && north >= south {
                ice.push(Area { west, south, east, north });
            }
        }
        let mut joined = true;
        while joined {
            joined = false;
            let mut one = 0;
            while one < ice.len() && !joined {
                let mut two = one + 1;
                while two < ice.len() && !joined {
                    let (p, q) = (ice[one], ice[two]);
                    if touching(&p, &q) {
                        ice[one] = Area { west: jsmath::min(p.west, q.west), south: jsmath::min(p.south, q.south), east: jsmath::max(p.east, q.east), north: jsmath::max(p.north, q.north) };
                        ice.remove(two);
                        joined = true;
                    }
                    two += 1;
                }
                one += 1;
            }
        }
        for sheet in &ice {
            let ours: Vec<usize> = (0..held[0].len()).filter(|&at| touching(&held[0][at], sheet)).collect();
            let theirs: Vec<usize> = (0..held[1].len()).filter(|&at| touching(&held[1][at], sheet)).collect();
            for &a in &ours {
                for &b in &theirs {
                    join(&mut parent, a, count_a + b);
                    meet(&mut meeting, (a, b), a, Area { west: sheet.west - TOUCH_DEGREES, south: sheet.south - TOUCH_DEGREES, east: sheet.east + TOUCH_DEGREES, north: sheet.north + TOUCH_DEGREES });
                }
            }
        }
    }
    for a in 0..held[0].len() {
        let one = held[0][a];
        for b in 0..held[1].len() {
            let other = held[1][b];
            if one.west > other.east + TOUCH_DEGREES || other.west > one.east + TOUCH_DEGREES {
                continue;
            }
            if one.south > other.north + TOUCH_DEGREES || other.south > one.north + TOUCH_DEGREES {
                continue;
            }
            join(&mut parent, a, count_a + b);
            meet(
                &mut meeting,
                (a, b),
                a,
                Area {
                    west: jsmath::max(one.west, other.west) - TOUCH_DEGREES,
                    south: jsmath::max(one.south, other.south) - TOUCH_DEGREES,
                    east: jsmath::min(one.east, other.east) + TOUCH_DEGREES,
                    north: jsmath::min(one.north, other.north) + TOUCH_DEGREES,
                },
            );
        }
    }
    let mut stretches: Vec<(usize, Area)> = Vec::new();
    for (_, a, area) in &meeting {
        let root = find(&mut parent, *a);
        match stretches.iter_mut().find(|(known, _)| *known == root) {
            None => stretches.push((root, *area)),
            Some((_, stretch)) => {
                stretch.west = jsmath::min(stretch.west, area.west);
                stretch.south = jsmath::min(stretch.south, area.south);
                stretch.east = jsmath::max(stretch.east, area.east);
                stretch.north = jsmath::max(stretch.north, area.north);
            }
        }
    }
    stretches.sort_by_key(|(root, _)| *root);
    let mut contacts = Vec::new();
    for (_, contact) in stretches {
        if let Some(bounds) = bounds_round(contact, &held, map) {
            contacts.push(Contact { bounds, lng: (contact.west + contact.east) / 2.0, lat: (contact.south + contact.north) / 2.0 });
        }
    }
    contacts
}

pub fn frame_for_contact(bounds: Area, map: &Val) -> Option<Frame> {
    create_frame(bounds.bounds(), map_flat(map), map_scale(map), FRAME_MARGIN_KM)
}
