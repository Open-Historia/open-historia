#[derive(Clone)]
struct Node {
    i: usize,
    x: f64,
    y: f64,
    prev: usize,
    next: usize,
    z: i32,
    prev_z: Option<usize>,
    next_z: Option<usize>,
}

struct Cutter {
    nodes: Vec<Node>,
    triangles: Vec<usize>,
    filtered_out: bool,
}

fn to_int32(value: f64) -> i32 {
    if !value.is_finite() {
        return 0;
    }
    let truncated = value.trunc();
    let wrapped = truncated.rem_euclid(4_294_967_296.0);
    (wrapped as u64 as u32) as i32
}

fn z_order(x: f64, y: f64, min_x: f64, min_y: f64, inv_size: f64) -> i32 {
    let mut x = to_int32((x - min_x) * inv_size);
    let mut y = to_int32((y - min_y) * inv_size);
    x = (x | x.wrapping_shl(8)) & 0x00FF_00FF;
    x = (x | x.wrapping_shl(4)) & 0x0F0F_0F0F;
    x = (x | x.wrapping_shl(2)) & 0x3333_3333;
    x = (x | x.wrapping_shl(1)) & 0x5555_5555;
    y = (y | y.wrapping_shl(8)) & 0x00FF_00FF;
    y = (y | y.wrapping_shl(4)) & 0x0F0F_0F0F;
    y = (y | y.wrapping_shl(2)) & 0x3333_3333;
    y = (y | y.wrapping_shl(1)) & 0x5555_5555;
    x | y.wrapping_shl(1)
}

fn point_in_triangle(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64, px: f64, py: f64) -> bool {
    (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py)
}

fn signed_area(data: &[f64], start: usize, end: usize, dim: usize) -> f64 {
    let mut sum = 0.0;
    let mut j = end - dim;
    let mut i = start;
    while i < end {
        sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
        j = i;
        i += dim;
    }
    sum
}

fn min3(a: f64, b: f64, c: f64) -> f64 {
    crate::jsmath::min(crate::jsmath::min(a, b), c)
}

fn max3(a: f64, b: f64, c: f64) -> f64 {
    crate::jsmath::max(crate::jsmath::max(a, b), c)
}

impl Cutter {
    fn create(&mut self, i: usize, x: f64, y: f64) -> usize {
        let at = self.nodes.len();
        self.nodes.push(Node { i, x, y, prev: at, next: at, z: 0, prev_z: None, next_z: None });
        at
    }

    fn insert(&mut self, i: usize, x: f64, y: f64, last: Option<usize>) -> usize {
        let p = self.create(i, x, y);
        if let Some(last) = last {
            let after = self.nodes[last].next;
            self.nodes[p].next = after;
            self.nodes[p].prev = last;
            self.nodes[after].prev = p;
            self.nodes[last].next = p;
        }
        p
    }

    fn remove(&mut self, p: usize) {
        let (prev, next, prev_z, next_z) = {
            let node = &self.nodes[p];
            (node.prev, node.next, node.prev_z, node.next_z)
        };
        self.nodes[next].prev = prev;
        self.nodes[prev].next = next;
        if let Some(pz) = prev_z {
            self.nodes[pz].next_z = next_z;
        }
        if let Some(nz) = next_z {
            self.nodes[nz].prev_z = prev_z;
        }
    }

    fn equals(&self, a: usize, b: usize) -> bool {
        self.nodes[a].x == self.nodes[b].x && self.nodes[a].y == self.nodes[b].y
    }

    fn area(&self, p: usize, q: usize, r: usize) -> f64 {
        let (p, q, r) = (&self.nodes[p], &self.nodes[q], &self.nodes[r]);
        (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y)
    }

    fn linked_list(&mut self, data: &[f64], start: usize, end: usize, dim: usize, clockwise: bool) -> Option<usize> {
        let mut last: Option<usize> = None;
        if clockwise == (signed_area(data, start, end, dim) > 0.0) {
            let mut i = start;
            while i < end {
                last = Some(self.insert(i / dim, data[i], data[i + 1], last));
                i += dim;
            }
        } else {
            let mut i = end as isize - dim as isize;
            while i >= start as isize {
                let at = i as usize;
                last = Some(self.insert(at / dim, data[at], data[at + 1], last));
                i -= dim as isize;
            }
        }
        if let Some(node) = last {
            let next = self.nodes[node].next;
            if self.equals(node, next) {
                self.remove(node);
                last = Some(self.nodes[node].next);
            }
        }
        last
    }

    fn filter_points(&mut self, start: usize, end_at: Option<usize>) -> usize {
        let mut end = end_at.unwrap_or(start);
        let full = end == start;
        let mut p = start;
        loop {
            let mut again = false;
            let next = self.nodes[p].next;
            let prev = self.nodes[p].prev;
            if p != next && (self.equals(p, next) || self.area(prev, p, next) == 0.0) {
                if full || p == end {
                    end = prev;
                }
                self.filtered_out = true;
                self.remove(p);
                p = prev;
                again = true;
            } else if full || p != end {
                p = next;
                again = !full;
            }
            if !(again || p != end) {
                break;
            }
        }
        end
    }

    fn earcut_linked(&mut self, start: usize, min_x: f64, min_y: f64, inv_size: f64) {
        let hashed = inv_size != 0.0 && !inv_size.is_nan();
        if hashed {
            self.index_curve(start, min_x, min_y, inv_size);
        }
        let mut ear = start;
        let mut stop = ear;
        let mut cured = false;
        while self.nodes[ear].prev != self.nodes[ear].next {
            let prev = self.nodes[ear].prev;
            let next = self.nodes[ear].next;
            if self.area(prev, ear, next) < 0.0 && (if hashed { self.is_ear_hashed(ear, min_x, min_y, inv_size) } else { self.is_ear(ear) }) {
                let triangle = [self.nodes[prev].i, self.nodes[ear].i, self.nodes[next].i];
                self.triangles.extend_from_slice(&triangle);
                self.remove(ear);
                ear = next;
                stop = next;
                continue;
            }
            ear = next;
            if ear == stop {
                self.filtered_out = false;
                ear = self.filter_points(ear, None);
                if self.filtered_out {
                    stop = ear;
                    continue;
                }
                if !cured {
                    ear = self.cure_local_intersections(ear);
                    stop = ear;
                    cured = true;
                    continue;
                }
                self.split_earcut(ear, min_x, min_y, inv_size);
                break;
            }
        }
    }

    fn is_ear(&self, ear: usize) -> bool {
        let a = self.nodes[ear].prev;
        let c = self.nodes[ear].next;
        let (ax, ay) = (self.nodes[a].x, self.nodes[a].y);
        let (bx, by) = (self.nodes[ear].x, self.nodes[ear].y);
        let (cx, cy) = (self.nodes[c].x, self.nodes[c].y);
        let x0 = min3(ax, bx, cx);
        let y0 = min3(ay, by, cy);
        let x1 = max3(ax, bx, cx);
        let y1 = max3(ay, by, cy);
        let mut p = self.nodes[c].next;
        while p != a {
            let node = &self.nodes[p];
            if node.x >= x0
                && node.x <= x1
                && node.y >= y0
                && node.y <= y1
                && !(ax == node.x && ay == node.y)
                && point_in_triangle(ax, ay, bx, by, cx, cy, node.x, node.y)
                && self.area(node.prev, p, node.next) >= 0.0
            {
                return false;
            }
            p = node.next;
        }
        true
    }

    fn is_ear_hashed(&self, ear: usize, min_x: f64, min_y: f64, inv_size: f64) -> bool {
        let a = self.nodes[ear].prev;
        let c = self.nodes[ear].next;
        let (ax, ay) = (self.nodes[a].x, self.nodes[a].y);
        let (bx, by) = (self.nodes[ear].x, self.nodes[ear].y);
        let (cx, cy) = (self.nodes[c].x, self.nodes[c].y);
        let x0 = min3(ax, bx, cx);
        let y0 = min3(ay, by, cy);
        let x1 = max3(ax, bx, cx);
        let y1 = max3(ay, by, cy);
        let min_z = z_order(x0, y0, min_x, min_y, inv_size);
        let max_z = z_order(x1, y1, min_x, min_y, inv_size);
        let blocked = |p: usize| -> bool {
            let node = &self.nodes[p];
            node.x >= x0
                && node.x <= x1
                && node.y >= y0
                && node.y <= y1
                && p != c
                && !(ax == node.x && ay == node.y)
                && point_in_triangle(ax, ay, bx, by, cx, cy, node.x, node.y)
                && self.area(node.prev, p, node.next) >= 0.0
        };
        let mut p = self.nodes[ear].prev_z;
        while let Some(at) = p {
            if self.nodes[at].z < min_z {
                break;
            }
            if blocked(at) {
                return false;
            }
            p = self.nodes[at].prev_z;
        }
        let mut n = self.nodes[ear].next_z;
        while let Some(at) = n {
            if self.nodes[at].z > max_z {
                break;
            }
            if blocked(at) {
                return false;
            }
            n = self.nodes[at].next_z;
        }
        true
    }

    fn intersects(&self, p1: usize, q1: usize, p2: usize, q2: usize, include_boundary: bool) -> bool {
        let o1 = self.area(p1, q1, p2);
        let o2 = self.area(p1, q1, q2);
        let o3 = self.area(p2, q2, p1);
        let o4 = self.area(p2, q2, q1);
        if ((o1 > 0.0 && o2 < 0.0) || (o1 < 0.0 && o2 > 0.0)) && ((o3 > 0.0 && o4 < 0.0) || (o3 < 0.0 && o4 > 0.0)) {
            return true;
        }
        if !include_boundary {
            return false;
        }
        if o1 == 0.0 && self.on_segment(p1, p2, q1) {
            return true;
        }
        if o2 == 0.0 && self.on_segment(p1, q2, q1) {
            return true;
        }
        if o3 == 0.0 && self.on_segment(p2, p1, q2) {
            return true;
        }
        if o4 == 0.0 && self.on_segment(p2, q1, q2) {
            return true;
        }
        false
    }

    fn on_segment(&self, p: usize, q: usize, r: usize) -> bool {
        let (p, q, r) = (&self.nodes[p], &self.nodes[q], &self.nodes[r]);
        q.x <= crate::jsmath::max(p.x, r.x) && q.x >= crate::jsmath::min(p.x, r.x) && q.y <= crate::jsmath::max(p.y, r.y) && q.y >= crate::jsmath::min(p.y, r.y)
    }

    fn locally_inside(&self, a: usize, b: usize) -> bool {
        let prev = self.nodes[a].prev;
        let next = self.nodes[a].next;
        if self.area(prev, a, next) < 0.0 {
            self.area(a, b, next) >= 0.0 && self.area(a, prev, b) >= 0.0
        } else {
            self.area(a, b, prev) < 0.0 || self.area(a, next, b) < 0.0
        }
    }

    fn middle_inside(&self, a: usize, b: usize) -> bool {
        let mut p = a;
        let mut inside = false;
        let px = (self.nodes[a].x + self.nodes[b].x) / 2.0;
        let py = (self.nodes[a].y + self.nodes[b].y) / 2.0;
        loop {
            let n = self.nodes[p].next;
            let (pn, nn) = (&self.nodes[p], &self.nodes[n]);
            if (pn.y > py) != (nn.y > py) && px < (nn.x - pn.x) * (py - pn.y) / (nn.y - pn.y) + pn.x {
                inside = !inside;
            }
            p = n;
            if p == a {
                break;
            }
        }
        inside
    }

    fn intersects_polygon(&self, a: usize, b: usize) -> bool {
        let (na, nb) = (&self.nodes[a], &self.nodes[b]);
        let min_x = crate::jsmath::min(na.x, nb.x);
        let max_x = crate::jsmath::max(na.x, nb.x);
        let min_y = crate::jsmath::min(na.y, nb.y);
        let max_y = crate::jsmath::max(na.y, nb.y);
        let (ai, bi) = (na.i, nb.i);
        let mut p = a;
        loop {
            let n = self.nodes[p].next;
            let (pn, nn) = (&self.nodes[p], &self.nodes[n]);
            let outside = (pn.x > max_x && nn.x > max_x) || (pn.x < min_x && nn.x < min_x) || (pn.y > max_y && nn.y > max_y) || (pn.y < min_y && nn.y < min_y);
            if !outside && pn.i != ai && nn.i != ai && pn.i != bi && nn.i != bi && self.intersects(p, n, a, b, true) {
                return true;
            }
            p = n;
            if p == a {
                break;
            }
        }
        false
    }

    fn is_valid_diagonal(&self, a: usize, b: usize) -> bool {
        let (na, nb) = (&self.nodes[a], &self.nodes[b]);
        let zero_length = self.equals(a, b) && self.area(na.prev, a, na.next) > 0.0 && self.area(nb.prev, b, nb.next) > 0.0;
        self.nodes[na.next].i != nb.i
            && (zero_length || (self.locally_inside(a, b) && self.locally_inside(b, a) && (self.area(na.prev, a, nb.prev) != 0.0 || self.area(a, nb.prev, b) != 0.0)))
            && !self.intersects_polygon(a, b)
            && (zero_length || self.middle_inside(a, b))
    }

    fn split_polygon(&mut self, a: usize, b: usize) -> usize {
        let (ai, ax, ay) = (self.nodes[a].i, self.nodes[a].x, self.nodes[a].y);
        let (bi, bx, by) = (self.nodes[b].i, self.nodes[b].x, self.nodes[b].y);
        let a2 = self.create(ai, ax, ay);
        let b2 = self.create(bi, bx, by);
        let an = self.nodes[a].next;
        let bp = self.nodes[b].prev;
        self.nodes[a].next = b;
        self.nodes[b].prev = a;
        self.nodes[a2].next = an;
        self.nodes[an].prev = a2;
        self.nodes[b2].next = a2;
        self.nodes[a2].prev = b2;
        self.nodes[bp].next = b2;
        self.nodes[b2].prev = bp;
        b2
    }

    fn cure_local_intersections(&mut self, first: usize) -> usize {
        let mut start = first;
        let mut p = start;
        let mut cured = false;
        loop {
            let a = self.nodes[p].prev;
            let pn = self.nodes[p].next;
            let b = self.nodes[pn].next;
            if self.intersects(a, p, pn, b, false) && self.locally_inside(a, b) && self.locally_inside(b, a) {
                let triangle = [self.nodes[a].i, self.nodes[p].i, self.nodes[b].i];
                self.triangles.extend_from_slice(&triangle);
                self.remove(p);
                let next = self.nodes[p].next;
                self.remove(next);
                p = b;
                start = b;
                cured = true;
            }
            p = self.nodes[p].next;
            if p == start {
                break;
            }
        }
        if cured {
            self.filter_points(p, None)
        } else {
            p
        }
    }

    fn split_earcut(&mut self, start: usize, min_x: f64, min_y: f64, inv_size: f64) {
        let mut a = start;
        loop {
            let mut b = self.nodes[self.nodes[a].next].next;
            while b != self.nodes[a].prev {
                if self.nodes[a].i != self.nodes[b].i && self.is_valid_diagonal(a, b) {
                    let mut c = self.split_polygon(a, b);
                    let a_next = self.nodes[a].next;
                    a = self.filter_points(a, Some(a_next));
                    let c_next = self.nodes[c].next;
                    c = self.filter_points(c, Some(c_next));
                    self.earcut_linked(a, min_x, min_y, inv_size);
                    self.earcut_linked(c, min_x, min_y, inv_size);
                    return;
                }
                b = self.nodes[b].next;
            }
            a = self.nodes[a].next;
            if a == start {
                break;
            }
        }
    }

    fn index_curve(&mut self, start: usize, min_x: f64, min_y: f64, inv_size: f64) {
        let mut order: Vec<usize> = Vec::new();
        let mut p = start;
        loop {
            let z = z_order(self.nodes[p].x, self.nodes[p].y, min_x, min_y, inv_size);
            self.nodes[p].z = z;
            order.push(p);
            p = self.nodes[p].next;
            if p == start {
                break;
            }
        }
        if order.len() <= 32 {
            let nodes = &self.nodes;
            for i in 1..order.len() {
                let node = order[i];
                let z = nodes[node].z;
                let mut j = i as isize - 1;
                while j >= 0 && nodes[order[j as usize]].z > z {
                    order[(j + 1) as usize] = order[j as usize];
                    j -= 1;
                }
                order[(j + 1) as usize] = node;
            }
        } else {
            let nodes = &self.nodes;
            order.sort_by_key(|&node| nodes[node].z as u32);
        }
        let mut prev: Option<usize> = None;
        for &node in &order {
            self.nodes[node].prev_z = prev;
            if let Some(before) = prev {
                self.nodes[before].next_z = Some(node);
            }
            prev = Some(node);
        }
    }
}

pub fn earcut(data: &[f64]) -> Vec<usize> {
    let dim = 2;
    let mut cutter = Cutter { nodes: Vec::with_capacity(data.len()), triangles: Vec::new(), filtered_out: false };
    let outer_len = data.len();
    let Some(outer) = cutter.linked_list(data, 0, outer_len, dim, true) else {
        return Vec::new();
    };
    if cutter.nodes[outer].next == cutter.nodes[outer].prev {
        return Vec::new();
    }
    let mut min_x = 0.0;
    let mut min_y = 0.0;
    let mut inv_size = 0.0;
    if data.len() > 80 * dim {
        min_x = data[0];
        min_y = data[1];
        let mut max_x = min_x;
        let mut max_y = min_y;
        let mut i = dim;
        while i < outer_len {
            let x = data[i];
            let y = data[i + 1];
            if x < min_x {
                min_x = x;
            }
            if y < min_y {
                min_y = y;
            }
            if x > max_x {
                max_x = x;
            }
            if y > max_y {
                max_y = y;
            }
            i += dim;
        }
        inv_size = crate::jsmath::max(max_x - min_x, max_y - min_y);
        inv_size = if inv_size != 0.0 { 32767.0 / inv_size } else { 0.0 };
    }
    cutter.earcut_linked(outer, min_x, min_y, inv_size);
    cutter.triangles
}
