use super::constants::FAR_CELLS;
use super::field::{read_field, Field};
use crate::jsmath;

pub const FAR_THIRDS: i32 = 1 << 28;

pub fn distance_from<F: FnMut(usize) -> bool>(cols: usize, rows: usize, mut is_source: F, out: &mut [i32]) {
    let size = cols * rows;
    for cell in 0..size {
        out[cell] = if is_source(cell) { 0 } else { FAR_THIRDS };
    }
    if size == 0 {
        return;
    }
    let last = cols - 1;
    for cell in 1..cols {
        if out[cell - 1] + 3 < out[cell] {
            out[cell] = out[cell - 1] + 3;
        }
    }
    let mut start = cols;
    while start < size {
        let mut best = out[start];
        if out[start - cols] + 3 < best {
            best = out[start - cols] + 3;
        }
        if last > 0 && out[start - cols + 1] + 4 < best {
            best = out[start - cols + 1] + 4;
        }
        out[start] = best;
        let end = start + last;
        for cell in start + 1..end {
            best = out[cell];
            let west = out[cell - 1] + 3;
            if west < best {
                best = west;
            }
            let north = out[cell - cols] + 3;
            if north < best {
                best = north;
            }
            let north_west = out[cell - cols - 1] + 4;
            if north_west < best {
                best = north_west;
            }
            let north_east = out[cell - cols + 1] + 4;
            if north_east < best {
                best = north_east;
            }
            out[cell] = best;
        }
        if last > 0 {
            best = out[end];
            if out[end - 1] + 3 < best {
                best = out[end - 1] + 3;
            }
            if out[end - cols] + 3 < best {
                best = out[end - cols] + 3;
            }
            if out[end - cols - 1] + 4 < best {
                best = out[end - cols - 1] + 4;
            }
            out[end] = best;
        }
        start += cols;
    }
    let last_row = size - cols;
    let mut cell = size as i64 - 2;
    while cell >= last_row as i64 {
        let at = cell as usize;
        if out[at + 1] + 3 < out[at] {
            out[at] = out[at + 1] + 3;
        }
        cell -= 1;
    }
    let mut start = last_row as i64 - cols as i64;
    while start >= 0 {
        let start_at = start as usize;
        let end = start_at + last;
        let mut best = out[end];
        if out[end + cols] + 3 < best {
            best = out[end + cols] + 3;
        }
        if last > 0 && out[end + cols - 1] + 4 < best {
            best = out[end + cols - 1] + 4;
        }
        out[end] = best;
        let mut cell = end;
        while cell > start_at + 1 {
            cell -= 1;
            best = out[cell];
            let east = out[cell + 1] + 3;
            if east < best {
                best = east;
            }
            let south = out[cell + cols] + 3;
            if south < best {
                best = south;
            }
            let south_east = out[cell + cols + 1] + 4;
            if south_east < best {
                best = south_east;
            }
            let south_west = out[cell + cols - 1] + 4;
            if south_west < best {
                best = south_west;
            }
            out[cell] = best;
        }
        if last > 0 {
            best = out[start_at];
            if out[start_at + 1] + 3 < best {
                best = out[start_at + 1] + 3;
            }
            if out[start_at + cols] + 3 < best {
                best = out[start_at + cols] + 3;
            }
            if out[start_at + cols + 1] + 4 < best {
                best = out[start_at + cols + 1] + 4;
            }
            out[start_at] = best;
        }
        start -= cols as i64;
    }
}

pub fn nearest_of(cols: usize, rows: usize, labels: &[i32], out: &mut [i32], out_label: &mut [i32]) {
    let size = cols * rows;
    for cell in 0..size {
        out[cell] = if labels[cell] >= 0 { 0 } else { FAR_THIRDS };
        out_label[cell] = labels[cell];
    }
    let take = |out: &mut [i32], out_label: &mut [i32], cell: usize, from: usize, cost: i32| {
        if out[from] + cost < out[cell] {
            out[cell] = out[from] + cost;
            out_label[cell] = out_label[from];
        }
    };
    for row in 0..rows {
        for col in 0..cols {
            let cell = row * cols + col;
            if col > 0 {
                take(out, out_label, cell, cell - 1, 3);
            }
            if row > 0 {
                take(out, out_label, cell, cell - cols, 3);
                if col > 0 {
                    take(out, out_label, cell, cell - cols - 1, 4);
                }
                if col + 1 < cols {
                    take(out, out_label, cell, cell - cols + 1, 4);
                }
            }
        }
    }
    for row in (0..rows).rev() {
        for col in (0..cols).rev() {
            let cell = row * cols + col;
            if col + 1 < cols {
                take(out, out_label, cell, cell + 1, 3);
            }
            if row + 1 < rows {
                take(out, out_label, cell, cell + cols, 3);
                if col + 1 < cols {
                    take(out, out_label, cell, cell + cols + 1, 4);
                }
                if col > 0 {
                    take(out, out_label, cell, cell + cols - 1, 4);
                }
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToSide {
    pub turns: i64,
    pub sides: [Vec<i32>; 2],
}

pub fn measure(field: &Field, state: &mut Option<ToSide>) {
    if let Some(known) = state {
        if known.turns == field.turns && known.sides[0].len() == field.size {
            return;
        }
    }
    let mut sides = match state.take() {
        Some(known) if known.sides[0].len() == field.size => known.sides,
        _ => [vec![0; field.size], vec![0; field.size]],
    };
    for (side, out) in sides.iter_mut().enumerate() {
        distance_from(field.cols, field.rows, |cell| field.holders[cell] as usize == side, out);
    }
    *state = Some(ToSide { turns: field.turns, sides });
}

pub fn cell_at(field: &Field, x: f64, y: f64) -> i64 {
    if x >= 0.0 && y >= 0.0 && x < field.cols as f64 && y < field.rows as f64 {
        (y.floor() * field.cols as f64 + x.floor()) as i64
    } else {
        -1
    }
}

pub fn cells_of(field: &Field, grid: &[i32], x: f64, y: f64) -> f64 {
    let col = if x < 0.0 {
        0.0
    } else if x >= field.cols as f64 {
        field.cols as f64 - 1.0
    } else {
        x.floor()
    };
    let row = if y < 0.0 {
        0.0
    } else if y >= field.rows as f64 {
        field.rows as f64 - 1.0
    } else {
        y.floor()
    };
    let at = row * field.cols as f64 + col;
    if at >= 0.0 && (at as usize) < grid.len() {
        grid[at as usize] as f64 / 3.0
    } else {
        f64::NAN
    }
}

pub fn downhill(field: &Field, grid: &[i32], x: f64, y: f64, out: &mut [f64; 2]) -> bool {
    let dx = cells_of(field, grid, x - 1.5, y) - cells_of(field, grid, x + 1.5, y);
    let dy = cells_of(field, grid, x, y - 1.5) - cells_of(field, grid, x, y + 1.5);
    let length = (dx * dx + dy * dy).sqrt();
    out[0] = if length > 0.0 { dx / length } else { 0.0 };
    out[1] = if length > 0.0 { dy / length } else { 0.0 };
    length > 0.0
}

pub fn away_of(field: &Field, to_side: &ToSide, side: usize, x: f64, y: f64) -> f64 {
    let cell = cell_at(field, x, y);
    if cell < 0 || field.holders[cell as usize] as usize != side {
        return 0.0;
    }
    let near = read_field(field, x, y).abs();
    if near < FAR_CELLS - 1.0 {
        near
    } else {
        to_side.sides[1 - side][cell as usize] as f64 / 3.0
    }
}

pub fn outward_of(field: &Field, side: u8, x: f64, y: f64, reach: f64, out: &mut [f64; 2]) -> bool {
    let other = 1 - side;
    let (cols, rows, holders) = (field.cols as i64, field.rows as i64, &field.holders);
    let col0 = x.floor() as i64;
    let row0 = y.floor() as i64;
    let span = reach.ceil() as i64;
    let within = reach * reach;
    let mut sum_x = 0.0;
    let mut sum_y = 0.0;
    for row in (row0 - span).max(0)..=(rows - 1).min(row0 + span) {
        for col in (col0 - span).max(0)..=(cols - 1).min(col0 + span) {
            let holder = holders[(row * cols + col) as usize];
            if holder != side && holder != other {
                continue;
            }
            if col + 1 < cols {
                let beside = holders[(row * cols + col + 1) as usize];
                if beside != holder && (beside == side || beside == other) {
                    let dx = (col + 1) as f64 - x;
                    let dy = row as f64 + 0.5 - y;
                    let apart = dx * dx + dy * dy;
                    if apart <= within {
                        sum_x += (if holder == side { 1.0 } else { -1.0 }) * (1.0 - apart / within);
                    }
                }
            }
            if row + 1 < rows {
                let below = holders[((row + 1) * cols + col) as usize];
                if below != holder && (below == side || below == other) {
                    let dx = col as f64 + 0.5 - x;
                    let dy = (row + 1) as f64 - y;
                    let apart = dx * dx + dy * dy;
                    if apart <= within {
                        sum_y += (if holder == side { 1.0 } else { -1.0 }) * (1.0 - apart / within);
                    }
                }
            }
        }
    }
    let length = (sum_x * sum_x + sum_y * sum_y).sqrt();
    out[0] = if length > 0.0 { sum_x / length } else { 0.0 };
    out[1] = if length > 0.0 { sum_y / length } else { 0.0 };
    length > 0.0
}

pub fn clear_between(field: &Field, ax: f64, ay: f64, bx: f64, by: f64) -> bool {
    let dx = bx - ax;
    let dy = by - ay;
    let steps = jsmath::max(1.0, ((dx * dx + dy * dy).sqrt() * 2.0).ceil());
    let mut step = 0.0;
    while step <= steps {
        let cell = cell_at(field, ax + (dx * step) / steps, ay + (dy * step) / steps);
        if cell < 0 || field.play[cell as usize] == 0 {
            return false;
        }
        step += 1.0;
    }
    true
}

pub fn held_round(field: &Field, side: u8, x: f64, y: f64, reach: f64) -> f64 {
    let col0 = x.floor() as i64;
    let row0 = y.floor() as i64;
    let span = reach.ceil() as i64;
    let within = reach * reach;
    let (mut own, mut theirs) = (0.0, 0.0);
    let (cols, rows) = (field.cols as i64, field.rows as i64);
    for row in (row0 - span).max(0)..=(rows - 1).min(row0 + span) {
        let dy = row as f64 + 0.5 - y;
        for col in (col0 - span).max(0)..=(cols - 1).min(col0 + span) {
            let dx = col as f64 + 0.5 - x;
            if dx * dx + dy * dy > within {
                continue;
            }
            let holder = field.holders[(row * cols + col) as usize];
            if holder == side {
                own += 1.0;
            } else if holder as i32 == 1 - side as i32 {
                theirs += 1.0;
            }
        }
    }
    if own + theirs > 0.0 {
        own / (own + theirs)
    } else {
        1.0
    }
}

pub fn cheapest_way(field: &Field, from: i64, to: i64) -> Option<Vec<usize>> {
    let (cols, rows, size) = (field.cols, field.rows, field.size);
    let play = &field.play;
    let speed = &field.arena.speed;
    if from < 0 || to < 0 || play[from as usize] == 0 || play[to as usize] == 0 {
        return None;
    }
    let (from, to) = (from as usize, to as usize);
    let mut cost = vec![f64::INFINITY; size];
    let mut parent = vec![-1i64; size];
    let mut heap: Vec<usize> = vec![from];
    cost[from] = 0.0;
    let before = |cost: &[f64], a: usize, b: usize| cost[a] < cost[b] || (cost[a] == cost[b] && a < b);
    let mut settled = vec![0u8; size];
    while !heap.is_empty() {
        let index = heap[0];
        let last = heap.pop().unwrap();
        if !heap.is_empty() {
            heap[0] = last;
            let mut at = 0;
            loop {
                let left = at * 2 + 1;
                let right = left + 1;
                let mut least = at;
                if left < heap.len() && before(&cost, heap[left], heap[least]) {
                    least = left;
                }
                if right < heap.len() && before(&cost, heap[right], heap[least]) {
                    least = right;
                }
                if least == at {
                    break;
                }
                heap.swap(at, least);
                at = least;
            }
        }
        if settled[index] != 0 {
            continue;
        }
        settled[index] = 1;
        if index == to {
            break;
        }
        let col = (index % cols) as i64;
        let row = (index / cols) as i64;
        for dy in -1i64..=1 {
            let y = row + dy;
            if y < 0 || y >= rows as i64 {
                continue;
            }
            for dx in -1i64..=1 {
                let x = col + dx;
                if (dx == 0 && dy == 0) || x < 0 || x >= cols as i64 {
                    continue;
                }
                let next = (y * cols as i64 + x) as usize;
                if play[next] == 0 || settled[next] != 0 {
                    continue;
                }
                let step = (if dx != 0 && dy != 0 { 1.4142135623730951 } else { 1.0 }) * (0.5 / speed[index] as f64 + 0.5 / speed[next] as f64);
                if !(cost[index] + step < cost[next]) {
                    continue;
                }
                cost[next] = cost[index] + step;
                parent[next] = index as i64;
                heap.push(next);
                let mut at = heap.len() - 1;
                while at > 0 {
                    let up = (at - 1) >> 1;
                    if !before(&cost, heap[at], heap[up]) {
                        break;
                    }
                    heap.swap(at, up);
                    at = up;
                }
            }
        }
    }
    if settled[to] == 0 {
        return None;
    }
    let mut way = Vec::new();
    let mut index = to as i64;
    while index >= 0 {
        way.push(index as usize);
        index = parent[index as usize];
    }
    way.reverse();
    Some(way)
}
