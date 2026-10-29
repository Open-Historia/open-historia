use super::js::OrdMap;
use super::world_grid::{distance_to, great_point, nearest_cell, seas_of, way_km, WorldGrid};
use crate::jsmath;

pub const MEDIA: [&str; 3] = ["sea", "land", "air"];
pub const COAST_REACH_KM: f64 = 420.0;
pub const COAST_NEAR_KM: f64 = 60.0;
pub const SEARCH_CELLS_MOST: usize = 1000000;
pub const WAY_POINTS_MOST: usize = 48;
const GUESS_WEIGHT: f64 = 1.15;
pub const HOSTILE_KM: f64 = 55.0;
const HOSTILE_RINGS_MOST: f64 = 6.0;
const SHORE_COST: f64 = 1.25;
const ICE_LAT: f64 = 70.0;
const ICE_COST: f64 = 14.0;
const WAY_LEG_KM: f64 = 450.0;

pub struct Canal {
    pub name: &'static str,
    pub since: f64,
    pub a: [f64; 2],
    pub b: [f64; 2],
    pub sea: &'static [[f64; 2]],
    pub land: &'static [[f64; 2]],
}

pub const CANALS: [Canal; 2] = [
    Canal { name: "Suez", since: 1869.0, a: [32.35, 31.55], b: [32.6, 29.6], sea: &[[32.3, 32.2], [33.5, 32.6], [35.0, 26.5]], land: &[[31.2, 30.1], [33.9, 29.6], [34.9, 30.9], [32.5, 27.5]] },
    Canal { name: "Panama", since: 1914.0, a: [-79.95, 9.55], b: [-79.5, 8.75], sea: &[[-80.0, 10.2], [-78.0, 11.0], [-79.3, 8.0], [-82.0, 6.5]], land: &[[-81.0, 8.5], [-78.0, 8.5], [-84.0, 10.0], [-76.5, 7.0]] },
];

fn hostile_cost(medium: &str) -> f64 {
    match medium {
        "sea" => 3.2,
        "air" => 2.4,
        _ => 1.0,
    }
}

struct Heap {
    cost: Vec<f64>,
    cell: Vec<usize>,
}

impl Heap {
    fn push(&mut self, cost: f64, cell: usize) {
        let mut at = self.cost.len();
        self.cost.push(cost);
        self.cell.push(cell);
        while at > 0 {
            let up = (at - 1) >> 1;
            if self.cost[up] <= cost {
                break;
            }
            self.cost[at] = self.cost[up];
            self.cell[at] = self.cell[up];
            at = up;
        }
        self.cost[at] = cost;
        self.cell[at] = cell;
    }

    fn pop(&mut self) -> usize {
        let top = self.cell[0];
        let cost = self.cost.pop().unwrap();
        let cell = self.cell.pop().unwrap();
        let size = self.cost.len();
        if size > 0 {
            let mut at = 0;
            loop {
                let mut child = at * 2 + 1;
                if child >= size {
                    break;
                }
                if child + 1 < size && self.cost[child + 1] < self.cost[child] {
                    child += 1;
                }
                if self.cost[child] >= cost {
                    break;
                }
                self.cost[at] = self.cost[child];
                self.cell[at] = self.cell[child];
                at = child;
            }
            self.cost[at] = cost;
            self.cell[at] = cell;
        }
        top
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Way {
    Error(&'static str),
    Found { way: Vec<[f64; 2]>, km: f64, start: [f64; 2], start_km: f64, end: [f64; 2], landing: [f64; 2], arrived: bool },
}

pub struct Ask<'a> {
    pub medium: &'a str,
    pub from: Option<[f64; 2]>,
    pub to: Option<[f64; 2]>,
    pub holder_of: &'a dyn Fn(&str) -> String,
    pub friendly: &'a dyn Fn(&str) -> bool,
    pub hostile: &'a dyn Fn(&str) -> bool,
    pub year: Option<f64>,
}

fn round3(value: f64) -> f64 {
    jsmath::round(value * 1000.0) / 1000.0
}

pub fn find_way(grid: &mut WorldGrid, ask: &Ask) -> Way {
    let medium = ask.medium;
    let (from, to) = match (ask.from, ask.to) {
        (Some(from), Some(to)) if MEDIA.contains(&medium) => (from, to),
        _ => return Way::Error("off-map"),
    };
    let from_cell = grid.cell_of(from[0], from[1]);
    let to_cell = grid.cell_of(to[0], to[1]);
    if from_cell < 0.0 || to_cell < 0.0 {
        return Way::Error("off-map");
    }
    let (from_cell, to_cell) = (from_cell as usize, to_cell as usize);
    if medium == "sea" {
        seas_of(grid);
    }
    let grid: &WorldGrid = grid;
    let (cols, rows, land, region, ids, full, wrap, step) = (grid.cols, grid.rows, &grid.land, &grid.region, &grid.ids, grid.full, grid.wrap, grid.step);
    let km = |a: usize, b: usize| {
        let a = grid.centre_of(a as f64);
        let b = grid.centre_of(b as f64);
        grid.km(a[0], a[1], b[0], b[1])
    };
    let step_near = jsmath::max(1.0, grid.km(to[0], to[1], to[0], to[1] + step));
    let reach_cells = |wanted: f64| jsmath::max(2.0, (wanted / step_near).ceil());
    let sides = std::cell::RefCell::new(vec![0i8; ids.len()]);
    let side_of_cell = |cell: usize| -> i8 {
        let mark = region[cell] as usize;
        if mark == 0 {
            return 0;
        }
        let known = sides.borrow()[mark];
        if known != 0 {
            return known;
        }
        let name = (ask.holder_of)(&ids[mark]);
        let side = if !name.is_empty() && (ask.friendly)(&name) {
            1
        } else if !name.is_empty() && (ask.hostile)(&name) {
            2
        } else {
            3
        };
        sides.borrow_mut()[mark] = side;
        side
    };
    let hostile_rings = jsmath::max(1.0, jsmath::min(HOSTILE_RINGS_MOST, jsmath::round(HOSTILE_KM / step_near))) as i64;
    let threat = std::cell::RefCell::new(vec![0i8; cols * rows]);
    let near_hostile = |cell: usize| -> bool {
        let known = threat.borrow()[cell];
        if known != 0 {
            return known == 2;
        }
        let row = (cell / cols) as i64;
        let col = (cell % cols) as i64;
        let mut found = false;
        let mut dy = -hostile_rings;
        while dy <= hostile_rings && !found {
            let y = row + dy;
            dy += 1;
            if y < 0 || y >= rows as i64 {
                continue;
            }
            for dx in -hostile_rings..=hostile_rings {
                let mut x = col + dx;
                if wrap {
                    x = (x + cols as i64) % cols as i64;
                } else if x < 0 || x >= cols as i64 {
                    continue;
                }
                if side_of_cell((y * cols as i64 + x) as usize) == 2 {
                    found = true;
                    break;
                }
            }
        }
        threat.borrow_mut()[cell] = if found { 2 } else { 1 };
        found
    };
    let mut start = from_cell;
    let mut goal = to_cell;
    let mine = |cell: usize| land[cell] > 0 && side_of_cell(cell) == 1;
    let passable = |cell: usize| -> bool {
        match medium {
            "sea" => land[cell] < full,
            "land" => mine(cell),
            _ => true,
        }
    };
    if medium == "sea" {
        let seas = grid.seas.as_ref().unwrap();
        let reach = reach_cells(COAST_REACH_KM);
        let waters = |cell: usize| -> OrdMap<i32, (usize, i64)> {
            let mut found: OrdMap<i32, (usize, i64)> = OrdMap::new();
            nearest_cell(grid, cell as i64, reach, |next, ring| {
                let sea = seas[next as usize];
                if sea != 0 && !found.has(&sea) {
                    found.set(sea, (next as usize, ring));
                }
                false
            });
            found
        };
        let near = waters(from_cell);
        let far = waters(to_cell);
        if near.is_empty() {
            return Way::Error("no-coast");
        }
        if far.is_empty() {
            return Way::Error("no-shore");
        }
        let mut best: Option<(i64, usize, usize)> = None;
        for (sea, out) in &near.entries {
            let home = match far.get(sea) {
                Some(home) => home,
                None => continue,
            };
            let cost = out.1 + home.1;
            if best.is_none_or(|known| cost < known.0) {
                best = Some((cost, out.0, home.0));
            }
        }
        let best = match best {
            Some(best) => best,
            None => return Way::Error("no-sea-way"),
        };
        start = best.1;
        goal = best.2;
    } else if medium == "land" {
        if !mine(from_cell) {
            let found = nearest_cell(grid, from_cell as i64, reach_cells(160.0), |next, _| mine(next as usize));
            if found < 0 {
                return Way::Error("no-ground");
            }
            start = found as usize;
        }
    }
    let mut cuts: OrdMap<usize, usize> = OrdMap::new();
    if let (true, false, Some(year)) = (medium == "sea", grid.flat, ask.year.filter(|year| year.is_finite())) {
        for canal in &CANALS {
            if year < canal.since {
                continue;
            }
            let ends: Vec<i64> = [canal.a, canal.b].iter().map(|[lng, lat]| nearest_cell(grid, grid.cell_of(*lng, *lat) as i64, 2.0, |next, _| land[next as usize] < full)).collect();
            let middle = grid.cell_of((canal.a[0] + canal.b[0]) / 2.0, (canal.a[1] + canal.b[1]) / 2.0);
            if ends[0] < 0 || ends[1] < 0 || middle < 0.0 || land[middle as usize] == 0 {
                continue;
            }
            let here = |[lng, lat]: [f64; 2], wanted: bool| nearest_cell(grid, grid.cell_of(lng, lat) as i64, 1.0, |next, _| if wanted { land[next as usize] > 0 } else { land[next as usize] < full }) >= 0;
            if !canal.sea.iter().all(|point| here(*point, false)) || !canal.land.iter().all(|point| here(*point, true)) {
                continue;
            }
            cuts.set(ends[0] as usize, ends[1] as usize);
            cuts.set(ends[1] as usize, ends[0] as usize);
        }
    }
    let cost_of = |cell: usize| -> f64 {
        let mut cost = 1.0;
        if medium != "land" && near_hostile(cell) {
            cost *= hostile_cost(medium);
        }
        if medium == "sea" {
            if land[cell] > 0 {
                cost *= SHORE_COST;
            }
            if !grid.flat && grid.centre_of(cell as f64)[1].abs() > ICE_LAT {
                cost *= ICE_COST;
            }
        }
        cost
    };
    let size = cols * rows;
    let mut reached = vec![0.0f64; size];
    let mut before = vec![0i64; size];
    let mut mark = vec![false; size];
    let mut shut = vec![false; size];
    let mut heap = Heap { cost: Vec::new(), cell: Vec::new() };
    let goal_at = grid.centre_of(goal as f64);
    let guess = distance_to(grid, goal as f64);
    let leaning = |cell: usize| guess.km(cell as f64) * GUESS_WEIGHT;
    reached[start] = 0.0;
    before[start] = -1;
    mark[start] = true;
    heap.push(leaning(start), start);
    let mut opened = 0usize;
    let mut nearest = start;
    let mut nearest_km = guess.km(start as f64);
    let mut found = start == goal;
    while !found && !heap.cell.is_empty() {
        let cell = heap.pop();
        if shut[cell] {
            continue;
        }
        shut[cell] = true;
        if cell == goal {
            found = true;
            break;
        }
        opened += 1;
        if opened > SEARCH_CELLS_MOST {
            break;
        }
        let left = guess.km(cell as f64);
        if left < nearest_km {
            nearest_km = left;
            nearest = cell;
        }
        let row = cell / cols;
        let col = (cell % cols) as i64;
        let visit = |next: usize, length: f64, reached: &mut Vec<f64>, before: &mut Vec<i64>, mark: &mut Vec<bool>, heap: &mut Heap| {
            if shut[next] || !passable(next) {
                return;
            }
            let total = reached[cell] + length * cost_of(next);
            if mark[next] && reached[next] <= total {
                return;
            }
            reached[next] = total;
            before[next] = cell as i64;
            mark[next] = true;
            heap.push(total + leaning(next), next);
        };
        for dy in -1i64..=1 {
            let y = row as i64 + dy;
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
                let length = if dy == 0 {
                    grid.step_km.along[row]
                } else if dx == 0 {
                    grid.step_km.down
                } else {
                    grid.step_km.aslant[if dy < 0 { y as usize } else { row }]
                };
                visit(next, length, &mut reached, &mut before, &mut mark, &mut heap);
            }
        }
        if let Some(&cut) = cuts.get(&cell) {
            visit(cut, km(cell, cut), &mut reached, &mut before, &mut mark, &mut heap);
        }
    }
    let mut end = goal;
    if !found {
        if medium != "land" {
            return Way::Error(if opened > SEARCH_CELLS_MOST { "too-far" } else { "no-sea-way" });
        }
        end = nearest;
    }
    let mut cells: Vec<usize> = Vec::new();
    let mut cell = end as i64;
    while cell >= 0 && cells.len() <= cols * rows {
        cells.push(cell as usize);
        cell = before[cell as usize];
    }
    cells.reverse();
    let worst: Vec<f64> = cells.iter().map(|&cell| cost_of(cell)).collect();
    let step_km = jsmath::max(0.5, grid.km(goal_at[0], goal_at[1], goal_at[0], goal_at[1] + step));
    let between = |a: [f64; 2], b: [f64; 2], share: f64| -> [f64; 2] {
        if grid.flat {
            [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share]
        } else {
            great_point(a[0], a[1], b[0], b[1], share)
        }
    };
    let clear_line = |a: [f64; 2], b: [f64; 2], most: f64| -> bool {
        let steps = jsmath::max(1.0, (grid.km(a[0], a[1], b[0], b[1]) / (step_km / 2.0)).ceil()) as usize;
        for at in 1..steps {
            let [lng, lat] = between(a, b, at as f64 / steps as f64);
            let cell = grid.cell_of(lng, lat);
            if cell < 0.0 || !passable(cell as usize) || cost_of(cell as usize) > most + 1e-9 {
                return false;
            }
        }
        true
    };
    let worst_of = |a: usize, b: usize| -> f64 {
        let mut most = 0.0;
        for index in a..=b {
            if let Some(&value) = worst.get(index) {
                if value > most {
                    most = value;
                }
            }
        }
        most
    };
    let clear = |a: usize, b: usize| clear_line(grid.centre_of(cells[a] as f64), grid.centre_of(cells[b] as f64), worst_of(a + 1, b));
    let mut gates: Vec<usize> = Vec::new();
    for index in 0..cells.len().saturating_sub(1) {
        if cuts.get(&cells[index]) == Some(&cells[index + 1]) {
            gates.push(index);
        }
    }
    let mut kept = vec![0usize];
    let mut at = 0usize;
    while at + 1 < cells.len() {
        let mut next = at + 1;
        if !gates.contains(&at) {
            let far = gates.iter().copied().find(|&index| index > at).unwrap_or(cells.len() - 1);
            let mut span = far - at;
            while span > 1 {
                if clear(at, at + span) {
                    next = at + span;
                    break;
                }
                span = (span as f64 * 0.62).floor() as usize;
            }
        }
        kept.push(next);
        at = next;
    }
    let mut corners: Vec<[f64; 2]> = kept.iter().map(|&index| grid.centre_of(cells[index] as f64)).collect();
    let first = grid.centre_of(start as f64);
    let start_km = grid.km(from[0], from[1], first[0], first[1]);
    if medium != "sea" && from_cell == start {
        let origin = [from[0], from[1]];
        if corners.len() > 1 && clear_line(origin, corners[1], worst_of(0, kept[1])) {
            corners[0] = origin;
        } else {
            corners.insert(0, origin);
        }
    }
    if medium == "air" || (medium == "land" && end == to_cell) {
        let place = [to[0], to[1]];
        let ahead = corners.len() as i64 - 2;
        let from_index = if kept.len() >= 2 { kept[kept.len() - 2] } else { 0 };
        if ahead >= 0 && clear_line(corners[ahead as usize], place, worst_of(from_index, cells.len() - 1)) {
            let last = corners.len() - 1;
            corners[last] = place;
        } else {
            corners.push(place);
        }
    }
    while corners.len() > WAY_POINTS_MOST {
        let length = corners.len();
        corners = corners.iter().enumerate().filter(|(index, _)| *index == 0 || *index == length - 1 || index % 2 == 0).map(|(_, point)| *point).collect();
    }
    let laid = |leg_km: f64| -> Vec<[f64; 2]> {
        let mut points = vec![corners[0]];
        for index in 0..corners.len() - 1 {
            let a = corners[index];
            let b = corners[index + 1];
            let parts = if grid.flat { 1 } else { jsmath::max(1.0, (grid.km(a[0], a[1], b[0], b[1]) / leg_km).ceil()) as usize };
            for part in 1..parts {
                points.push(between(a, b, part as f64 / parts as f64));
            }
            points.push(b);
        }
        points
    };
    let mut points = laid(WAY_LEG_KM);
    let mut leg_km = WAY_LEG_KM * 1.5;
    while points.len() > WAY_POINTS_MOST && leg_km < 40000.0 {
        points = laid(leg_km);
        leg_km *= 1.5;
    }
    let way: Vec<[f64; 2]> = points.iter().map(|[lng, lat]| [round3(*lng), round3(*lat)]).collect();
    let last = grid.centre_of(end as f64);
    let mut landing = [to[0], to[1]];
    if medium == "sea" {
        let shore = nearest_cell(grid, end as i64, 3.0, |next, _| land[next as usize] > 0);
        let to_km = grid.km(to[0], to[1], last[0], last[1]);
        let step_km = jsmath::max(1.0, grid.km(last[0], last[1], last[0], last[1] + step));
        if to_km > jsmath::max(step_km * 2.5, COAST_NEAR_KM) || land[to_cell] == 0 {
            if shore < 0 {
                return Way::Error("no-shore");
            }
            let mut best = shore;
            let mut least = f64::INFINITY;
            nearest_cell(grid, end as i64, 3.0, |next, _| {
                if land[next as usize] == 0 {
                    return false;
                }
                let centre = grid.centre_of(next as f64);
                let far = grid.km(centre[0], centre[1], to[0], to[1]);
                if far < least {
                    least = far;
                    best = next;
                }
                false
            });
            landing = grid.centre_of(best as f64);
        }
    } else if medium == "land" && end != to_cell {
        landing = last;
    }
    Way::Found {
        km: jsmath::round(way_km(&way, grid.surface())),
        way,
        start: [round3(first[0]), round3(first[1])],
        start_km: jsmath::round(start_km),
        end: [round3(last[0]), round3(last[1])],
        landing: [round3(landing[0]), round3(landing[1])],
        arrived: medium != "land" || end == to_cell,
    }
}
