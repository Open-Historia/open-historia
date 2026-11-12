use std::collections::HashMap;
use std::f64::consts::PI;

use serde::de::{self, Deserializer, SeqAccess, Visitor};
use serde::Deserialize;

pub const MAX_LATITUDE: f64 = 85.051_128_779_806_59;
const QUANTUM: f64 = 2e5;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Position {
    pub lon: f64,
    pub lat: f64,
}

impl<'de> Deserialize<'de> for Position {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct PositionVisitor;
        impl<'de> Visitor<'de> for PositionVisitor {
            type Value = Position;
            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a GeoJSON position")
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Position, A::Error> {
                let lon: f64 = seq.next_element()?.ok_or_else(|| de::Error::invalid_length(0, &self))?;
                let lat: f64 = seq.next_element()?.ok_or_else(|| de::Error::invalid_length(1, &self))?;
                while seq.next_element::<de::IgnoredAny>()?.is_some() {}
                Ok(Position { lon, lat })
            }
        }
        deserializer.deserialize_seq(PositionVisitor)
    }
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum Geometry {
    Polygon { coordinates: Vec<Vec<Position>> },
    MultiPolygon { coordinates: Vec<Vec<Vec<Position>>> },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Identifier {
    Text(String),
    Number(serde_json::Number),
}

impl Identifier {
    fn text(&self) -> String {
        match self {
            Identifier::Text(text) => text.trim().to_string(),
            Identifier::Number(number) => number.to_string(),
        }
    }
}

#[derive(Deserialize, Default)]
struct Properties {
    id: Option<Identifier>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct Feature {
    id: Option<Identifier>,
    properties: Option<Properties>,
    geometry: Option<Geometry>,
}

#[derive(Deserialize)]
struct FeatureCollection {
    #[serde(default)]
    features: Vec<Feature>,
}

#[derive(Clone, Debug, Default)]
pub struct BakedMap {
    pub width: f32,
    pub ids: Vec<String>,
    pub names: Vec<String>,
    pub vertices: Vec<[f32; 2]>,
    pub vertex_region: Vec<u32>,
    pub indices: Vec<u32>,
    pub border_vertices: Vec<[f32; 2]>,
    pub border_regions: Vec<[i32; 2]>,
    pub adjacency: Vec<[u32; 2]>,
    pub centroids: Vec<[f32; 2]>,
    pub areas: Vec<f32>,
    pub bounds: [f32; 4],
}

pub fn project(position: Position, width: f64) -> [f64; 2] {
    let lat = position.lat.clamp(-MAX_LATITUDE, MAX_LATITUDE).to_radians();
    let x = (position.lon + 180.0) / 360.0 * width;
    let y = (0.5 - (PI / 4.0 + lat / 2.0).tan().ln() / (2.0 * PI)) * width;
    [x, y]
}

pub fn unproject(point: [f64; 2], width: f64) -> Position {
    let lon = point[0] / width * 360.0 - 180.0;
    let n = PI - 2.0 * PI * point[1] / width;
    let lat = n.sinh().atan().to_degrees();
    Position { lon, lat }
}

fn quantize(position: Position) -> (i64, i64) {
    ((position.lon * QUANTUM).round() as i64, (position.lat * QUANTUM).round() as i64)
}

fn open_ring(ring: &[Position]) -> &[Position] {
    if ring.len() > 1 && ring.first() == ring.last() {
        &ring[..ring.len() - 1]
    } else {
        ring
    }
}

struct EdgeRecord {
    first: Position,
    second: Position,
    regions: [i32; 2],
}

pub fn bake_geojson(text: &str, width: f32) -> Result<BakedMap, String> {
    let collection: FeatureCollection = serde_json::from_str(text).map_err(|error| format!("The regions file is not valid GeoJSON: {error}"))?;
    let width_f64 = f64::from(width);
    let count = collection.features.len();
    let mut map = BakedMap {
        width,
        ids: Vec::with_capacity(count),
        names: Vec::with_capacity(count),
        centroids: vec![[0.0, 0.0]; count],
        areas: vec![0.0; count],
        bounds: [f32::MAX, f32::MAX, f32::MIN, f32::MIN],
        ..BakedMap::default()
    };
    let mut edges: HashMap<((i64, i64), (i64, i64)), EdgeRecord> = HashMap::new();

    for (index, feature) in collection.features.iter().enumerate() {
        let region = index as u32;
        let properties = feature.properties.as_ref();
        let id = feature
            .id
            .as_ref()
            .map(Identifier::text)
            .filter(|text| !text.is_empty())
            .or_else(|| properties.and_then(|p| p.id.as_ref()).map(Identifier::text))
            .unwrap_or_default();
        map.ids.push(id);
        map.names.push(properties.and_then(|p| p.name.clone()).unwrap_or_default());

        let polygons: Vec<&Vec<Vec<Position>>> = match &feature.geometry {
            Some(Geometry::Polygon { coordinates }) => vec![coordinates],
            Some(Geometry::MultiPolygon { coordinates }) => coordinates.iter().collect(),
            _ => Vec::new(),
        };

        let mut weighted = [0.0f64, 0.0f64];
        let mut total_area = 0.0f64;
        for polygon in polygons {
            let mut flat: Vec<f64> = Vec::new();
            let mut holes: Vec<usize> = Vec::new();
            for (ring_index, ring) in polygon.iter().enumerate() {
                let ring = open_ring(ring);
                if ring.len() < 3 {
                    continue;
                }
                if ring_index > 0 {
                    holes.push(flat.len() / 2);
                }
                for position in ring {
                    let [x, y] = project(*position, width_f64);
                    flat.push(x);
                    flat.push(y);
                }
                for pair in 0..ring.len() {
                    let a = ring[pair];
                    let b = ring[(pair + 1) % ring.len()];
                    let (qa, qb) = (quantize(a), quantize(b));
                    if qa == qb {
                        continue;
                    }
                    let key = if qa < qb { (qa, qb) } else { (qb, qa) };
                    let entry = edges.entry(key).or_insert(EdgeRecord { first: a, second: b, regions: [region as i32, -1] });
                    if entry.regions[0] != region as i32 && entry.regions[1] == -1 {
                        entry.regions[1] = region as i32;
                    }
                }
            }
            if flat.len() < 6 {
                continue;
            }
            let triangles = earcutr::earcut(&flat, &holes, 2).map_err(|error| format!("A region could not be triangulated: {error:?}"))?;
            let base = map.vertices.len() as u32;
            for point in flat.chunks_exact(2) {
                map.vertices.push([point[0] as f32, point[1] as f32]);
                map.vertex_region.push(region);
                map.bounds[0] = map.bounds[0].min(point[0] as f32);
                map.bounds[1] = map.bounds[1].min(point[1] as f32);
                map.bounds[2] = map.bounds[2].max(point[0] as f32);
                map.bounds[3] = map.bounds[3].max(point[1] as f32);
            }
            for triangle in triangles.chunks_exact(3) {
                let (a, b, c) = (triangle[0], triangle[1], triangle[2]);
                map.indices.push(base + a as u32);
                map.indices.push(base + b as u32);
                map.indices.push(base + c as u32);
                let (ax, ay) = (flat[a * 2], flat[a * 2 + 1]);
                let (bx, by) = (flat[b * 2], flat[b * 2 + 1]);
                let (cx, cy) = (flat[c * 2], flat[c * 2 + 1]);
                let area = ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)).abs() / 2.0;
                total_area += area;
                weighted[0] += area * (ax + bx + cx) / 3.0;
                weighted[1] += area * (ay + by + cy) / 3.0;
            }
        }
        if total_area > 0.0 {
            map.centroids[index] = [(weighted[0] / total_area) as f32, (weighted[1] / total_area) as f32];
            map.areas[index] = total_area as f32;
        }
    }

    let mut ordered: Vec<_> = edges.into_values().collect();
    let mut neighbours: Vec<[u32; 2]> = ordered.iter().filter(|edge| edge.regions[1] >= 0).map(|edge| {
        let (a, b) = (edge.regions[0] as u32, edge.regions[1] as u32);
        if a < b { [a, b] } else { [b, a] }
    }).collect();
    neighbours.sort_unstable();
    neighbours.dedup();
    map.adjacency = neighbours;
    ordered.sort_by(|a, b| a.regions.cmp(&b.regions));
    map.border_vertices.reserve(ordered.len() * 2);
    map.border_regions.reserve(ordered.len());
    for edge in ordered {
        let [ax, ay] = project(edge.first, width_f64);
        let [bx, by] = project(edge.second, width_f64);
        map.border_vertices.push([ax as f32, ay as f32]);
        map.border_vertices.push([bx as f32, by as f32]);
        map.border_regions.push(edge.regions);
    }
    if map.vertices.is_empty() {
        map.bounds = [0.0, 0.0, width, width];
    }
    Ok(map)
}

pub struct PickIndex {
    width: f32,
    cells: usize,
    grid: Vec<Vec<u32>>,
    vertices: Vec<[f32; 2]>,
    vertex_region: Vec<u32>,
    indices: Vec<u32>,
}

impl PickIndex {
    pub fn new(map: &BakedMap, cells: usize) -> PickIndex {
        let cells = cells.max(1);
        let mut grid = vec![Vec::new(); cells * cells];
        let size = map.width.max(1.0);
        let cell_of = |value: f32| (((value / size) * cells as f32).floor().max(0.0) as usize).min(cells - 1);
        for (triangle, corners) in map.indices.chunks_exact(3).enumerate() {
            let points = [map.vertices[corners[0] as usize], map.vertices[corners[1] as usize], map.vertices[corners[2] as usize]];
            let min_x = points.iter().map(|p| p[0]).fold(f32::MAX, f32::min);
            let max_x = points.iter().map(|p| p[0]).fold(f32::MIN, f32::max);
            let min_y = points.iter().map(|p| p[1]).fold(f32::MAX, f32::min);
            let max_y = points.iter().map(|p| p[1]).fold(f32::MIN, f32::max);
            for gy in cell_of(min_y)..=cell_of(max_y) {
                for gx in cell_of(min_x)..=cell_of(max_x) {
                    grid[gy * cells + gx].push(triangle as u32);
                }
            }
        }
        PickIndex {
            width: size,
            cells,
            grid,
            vertices: map.vertices.clone(),
            vertex_region: map.vertex_region.clone(),
            indices: map.indices.clone(),
        }
    }

    pub fn pick(&self, x: f32, y: f32) -> i32 {
        let x = x.rem_euclid(self.width);
        if y < 0.0 || y >= self.width {
            return -1;
        }
        let gx = ((x / self.width * self.cells as f32) as usize).min(self.cells - 1);
        let gy = ((y / self.width * self.cells as f32) as usize).min(self.cells - 1);
        for &triangle in &self.grid[gy * self.cells + gx] {
            let base = triangle as usize * 3;
            let a = self.vertices[self.indices[base] as usize];
            let b = self.vertices[self.indices[base + 1] as usize];
            let c = self.vertices[self.indices[base + 2] as usize];
            let d1 = (x - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (y - b[1]);
            let d2 = (x - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (y - c[1]);
            let d3 = (x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1]);
            let negative = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
            let positive = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
            if !(negative && positive) {
                return self.vertex_region[self.indices[base] as usize] as i32;
            }
        }
        -1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TWO_SQUARES: &str = r#"{"type":"FeatureCollection","features":[
        {"type":"Feature","id":"A","properties":{"name":"West"},"geometry":{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]]]}},
        {"type":"Feature","properties":{"id":"B","name":"East"},"geometry":{"type":"Polygon","coordinates":[[[10,0],[20,0],[20,10],[10,10],[10,0]]]}},
        {"type":"Feature","id":7,"properties":{},"geometry":null}
    ]}"#;

    #[test]
    fn keeps_feature_order_and_ids() {
        let map = bake_geojson(TWO_SQUARES, 4096.0).unwrap();
        assert_eq!(map.ids, vec!["A", "B", "7"]);
        assert_eq!(map.names, vec!["West", "East", ""]);
        assert_eq!(map.indices.len(), 12);
        assert_eq!(map.areas[2], 0.0);
    }

    #[test]
    fn finds_the_shared_edge_between_neighbours() {
        let map = bake_geojson(TWO_SQUARES, 4096.0).unwrap();
        let shared: Vec<_> = map.border_regions.iter().filter(|pair| pair[1] >= 0).collect();
        assert_eq!(shared.len(), 1);
        assert_eq!(*shared[0], [0, 1]);
        assert_eq!(map.border_regions.len(), 7);
        assert_eq!(map.adjacency, vec![[0, 1]]);
    }

    #[test]
    fn picks_the_region_under_a_point() {
        let map = bake_geojson(TWO_SQUARES, 4096.0).unwrap();
        let index = PickIndex::new(&map, 64);
        let west = project(Position { lon: 5.0, lat: 5.0 }, 4096.0);
        let east = project(Position { lon: 15.0, lat: 5.0 }, 4096.0);
        let sea = project(Position { lon: 50.0, lat: 5.0 }, 4096.0);
        assert_eq!(index.pick(west[0] as f32, west[1] as f32), 0);
        assert_eq!(index.pick(east[0] as f32, east[1] as f32), 1);
        assert_eq!(index.pick(sea[0] as f32, sea[1] as f32), -1);
        assert_eq!(index.pick(west[0] as f32 + 4096.0, west[1] as f32), 0);
    }

    #[test]
    fn projection_round_trips() {
        let point = project(Position { lon: 37.6, lat: 55.75 }, 4096.0);
        let back = unproject(point, 4096.0);
        assert!((back.lon - 37.6).abs() < 1e-9 && (back.lat - 55.75).abs() < 1e-9);
    }

    #[test]
    fn reads_three_dimensional_positions_and_rejects_garbage() {
        let text = r#"{"type":"FeatureCollection","features":[{"type":"Feature","id":"Z","properties":{},"geometry":{"type":"Polygon","coordinates":[[[0,0,5],[1,0,5],[1,1,5],[0,0,5]]]}}]}"#;
        assert_eq!(bake_geojson(text, 1024.0).unwrap().indices.len(), 3);
        assert!(bake_geojson("not json", 1024.0).is_err());
    }
}
