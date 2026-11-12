use godot::prelude::*;

#[derive(GodotClass)]
#[class(init, base = RefCounted)]
pub struct MapMath {}

fn find(parent: &mut [usize], start: usize) -> usize {
    let mut at = start;
    while parent[at] != at {
        parent[at] = parent[parent[at]];
        at = parent[at];
    }
    at
}

fn fposmod(x: f64, y: f64) -> f64 {
    let mut value = x % y;
    if (value < 0.0 && y > 0.0) || (value > 0.0 && y < 0.0) {
        value += y;
    }
    value + 0.0
}

#[godot_api]
impl MapMath {
    #[func]
    fn owner_anchors(&self, owners: PackedInt32Array, adjacency: PackedInt32Array, areas: PackedFloat32Array, centroids: PackedVector2Array, owner_count: i64, world_width: f64) -> VarArray {
        let owners = owners.as_slice();
        let adjacency = adjacency.as_slice();
        let areas = areas.as_slice();
        let centroids = centroids.as_slice();
        let n = owners.len().min(areas.len()).min(centroids.len());
        let mut parent: Vec<usize> = (0..n).collect();
        let mut pair = 0;
        while pair + 1 < adjacency.len() {
            let (a, b) = (adjacency[pair], adjacency[pair + 1]);
            pair += 2;
            if a < 0 || b < 0 {
                continue;
            }
            let (a, b) = (a as usize, b as usize);
            if a >= n || b >= n || owners[a] < 0 || owners[a] != owners[b] {
                continue;
            }
            let root_a = find(&mut parent, a);
            let root_b = find(&mut parent, b);
            if root_a != root_b {
                parent[root_b] = root_a;
            }
        }
        let mut largest = vec![-1.0f64; n];
        let mut reference = vec![Vector2::ZERO; n];
        for index in 0..n {
            if owners[index] < 0 {
                continue;
            }
            let root = find(&mut parent, index);
            if (areas[index] as f64) > largest[root] {
                largest[root] = areas[index] as f64;
                reference[root] = centroids[index];
            }
        }
        let mut total = vec![0.0f64; n];
        let mut weighted = vec![Vector2::ZERO; n];
        let mut seen = vec![false; n];
        let mut order: Vec<usize> = Vec::new();
        for index in 0..n {
            if owners[index] < 0 || (areas[index] as f64) <= 0.0 {
                continue;
            }
            let root = find(&mut parent, index);
            let mut point = centroids[index];
            let anchor = reference[root];
            point.x = (point.x as f64 + world_width * ((anchor.x as f64 - point.x as f64) / world_width).round()) as f32;
            if !seen[root] {
                seen[root] = true;
                order.push(root);
            }
            total[root] += areas[index] as f64;
            let area = areas[index];
            let sum = weighted[root];
            weighted[root] = Vector2::new(sum.x + point.x * area, sum.y + point.y * area);
        }
        let count = owner_count.max(0) as usize;
        let mut anchors = VarArray::new();
        anchors.resize(count, &Vector2::ZERO.to_variant());
        let mut owner_area = vec![0.0f32; count];
        for root in order {
            let owner = owners[root];
            if owner < 0 || owner as usize >= count {
                continue;
            }
            let owner = owner as usize;
            let area = total[root];
            if area > owner_area[owner] as f64 {
                owner_area[owner] = area as f32;
                let scale = area as f32;
                let sum = weighted[root];
                let mut centre = Vector2::new(sum.x / scale, sum.y / scale);
                centre.x = fposmod(centre.x as f64, world_width) as f32;
                anchors.set(owner, &centre.to_variant());
            }
        }
        let mut out = VarArray::new();
        out.push(&anchors.to_variant());
        out.push(&PackedFloat32Array::from(owner_area.as_slice()).to_variant());
        out
    }
}
