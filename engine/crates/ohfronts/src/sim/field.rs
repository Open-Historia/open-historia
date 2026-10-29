use super::arena::{sample_regions, Arena, SampleBox};
use super::codec::{band_indices, decode_band, decode_mask, encode_band, encode_mask};
use super::constants::{BAND_CELLS, BAND_UNITS, EDIT_MARGIN_CELLS, FAR_CELLS, HOLDER_SIDE_A, HOLDER_SIDE_B, HOLDER_WALL, REDISTANCE_NEAR_CELLS, REDISTANCE_REACH_CELLS, SUPERSAMPLE};
use super::frame::Projector;
use super::js::{self, Val};
use super::line::Measured;
use crate::jsmath;
use std::cell::OnceCell;
use std::rc::Rc;

const LEAST: f64 = 1.0 / 1024.0;
const ROUGH: f64 = 0.5;
const A: u8 = HOLDER_SIDE_A as u8;
const B: u8 = HOLDER_SIDE_B as u8;
const WALL: u8 = HOLDER_WALL as u8;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StrandSpan {
    pub closed: bool,
    pub first: usize,
    pub count: usize,
}

#[derive(Debug, Default)]
pub struct Contour {
    pub strands: Vec<StrandSpan>,
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    pub cell_a: Vec<i32>,
    pub cell_b: Vec<i32>,
    pub segments: usize,
    pub from: Vec<i32>,
    pub to: Vec<i32>,
    pub square: Vec<i32>,
    pub buckets: OnceCell<(Vec<i32>, Vec<i32>)>,
    pub measured: OnceCell<Rc<Measured>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Bodies {
    pub turns: i64,
    pub label: Vec<i32>,
    pub sizes: Vec<usize>,
    pub count: usize,
}

#[derive(Clone, Debug)]
pub struct Field {
    pub arena: Rc<Arena>,
    pub cols: usize,
    pub rows: usize,
    pub size: usize,
    pub play: Vec<u8>,
    pub holders: Vec<u8>,
    pub phi: Vec<f64>,
    pub ghost: Vec<i32>,
    pub changed: Vec<usize>,
    pub marked: Vec<u8>,
    pub painter: Vec<u8>,
    pub when: Vec<f32>,
    pub edits: i64,
    pub turns: i64,
    pub contour: Option<Rc<Contour>>,
    pub contour_edits: i64,
    pub piece_from: Vec<i32>,
    pub piece_to: Vec<i32>,
    pub seen: Option<Vec<u8>>,
    pub bodies: [Option<Rc<Bodies>>; 2],
}

pub fn create_field(arena: Rc<Arena>) -> Field {
    let (cols, rows, size) = (arena.cols, arena.rows, arena.size);
    Field {
        arena,
        cols,
        rows,
        size,
        play: vec![0; size],
        holders: vec![WALL; size],
        phi: vec![0.0; size],
        ghost: vec![-1; size],
        changed: Vec::new(),
        marked: vec![0; size],
        painter: vec![0; size],
        when: vec![1.0; size],
        edits: 0,
        turns: 0,
        contour: None,
        contour_edits: -1,
        piece_from: vec![-1; size * 2],
        piece_to: vec![-1; size * 2],
        seen: None,
        bodies: [None, None],
    }
}

fn side_sign(holder: u8) -> f64 {
    if holder == A {
        -1.0
    } else {
        1.0
    }
}

fn refresh_ghosts(field: &mut Field) {
    let (cols, rows) = (field.cols, field.rows);
    let play = &field.play;
    for row in 0..rows {
        for col in 0..cols {
            let index = row * cols + col;
            if play[index] != 0 {
                field.ghost[index] = index as i32;
                continue;
            }
            let south = row > 0;
            let north = row + 1 < rows;
            let west = col > 0;
            let east = col + 1 < cols;
            let on = |at: usize| play[at] != 0;
            field.ghost[index] = if south && on(index - cols) {
                (index - cols) as i32
            } else if west && on(index - 1) {
                (index - 1) as i32
            } else if east && on(index + 1) {
                (index + 1) as i32
            } else if north && on(index + cols) {
                (index + cols) as i32
            } else if south && west && on(index - cols - 1) {
                (index - cols - 1) as i32
            } else if south && east && on(index - cols + 1) {
                (index - cols + 1) as i32
            } else if north && west && on(index + cols - 1) {
                (index + cols - 1) as i32
            } else if north && east && on(index + cols + 1) {
                (index + cols + 1) as i32
            } else {
                -1
            };
        }
    }
}

fn mark_changed(field: &mut Field, index: usize) {
    if field.marked[index] != 0 {
        return;
    }
    field.marked[index] = 1;
    field.changed.push(index);
}

fn write(field: &mut Field, index: usize, value: f64, painter: f64, when: f64) {
    field.phi[index] = value;
    field.edits += 1;
    mark_changed(field, index);
    let holder = if value < 0.0 { A } else { B };
    if field.holders[index] != holder {
        field.holders[index] = holder;
        field.painter[index] = js::to_int32(painter) as u8;
        field.when[index] = when as f32;
        field.turns += 1;
    }
}

fn side_at(list: &[i32], at: usize) -> i32 {
    list.get(at).copied().unwrap_or(-1)
}

pub fn set_ground(field: &mut Field, side_of_region: &[i32], ice_side: Option<&[i32]>) -> bool {
    let arena = field.arena.clone();
    let mut changed = false;
    for index in 0..field.size {
        let side = if arena.speed[index] > 0.0 {
            match (ice_side, &arena.iced) {
                (Some(ice), Some(iced)) if iced[index] == 1 => side_at(ice, index),
                _ => side_at(side_of_region, arena.region[index] as usize),
            }
        } else {
            -1
        };
        if side == 0 || side == 1 {
            if field.play[index] != 0 {
                continue;
            }
            field.play[index] = 1;
            field.holders[index] = side as u8;
            field.phi[index] = side_sign(side as u8) * ROUGH;
            mark_changed(field, index);
        } else {
            if field.play[index] == 0 && field.holders[index] == WALL {
                continue;
            }
            field.play[index] = 0;
            field.holders[index] = WALL;
            field.phi[index] = 0.0;
            mark_changed(field, index);
        }
        changed = true;
    }
    if changed {
        field.edits += 1;
        field.turns += 1;
        refresh_ghosts(field);
    }
    changed
}

const CASES: [Option<&[usize]>; 16] = [
    Some(&[]),
    Some(&[0, 3]),
    Some(&[1, 0]),
    Some(&[1, 3]),
    Some(&[2, 1]),
    None,
    Some(&[2, 0]),
    Some(&[2, 3]),
    Some(&[3, 2]),
    Some(&[0, 2]),
    None,
    Some(&[1, 2]),
    Some(&[3, 1]),
    Some(&[0, 1]),
    Some(&[3, 0]),
    Some(&[]),
];
const SADDLE_5: [[usize; 4]; 2] = [[0, 1, 2, 3], [0, 3, 2, 1]];
const SADDLE_10: [[usize; 4]; 2] = [[3, 0, 1, 2], [1, 0, 3, 2]];

struct Pieces {
    from_x: Vec<f64>,
    from_y: Vec<f64>,
    to_x: Vec<f64>,
    to_y: Vec<f64>,
    start_edge: Vec<i64>,
    end_edge: Vec<i64>,
    square: Vec<i32>,
    used: Vec<usize>,
}

impl Pieces {
    #[allow(clippy::too_many_arguments)]
    fn add(&mut self, piece_from: &mut [i32], piece_to: &mut [i32], x0: f64, y0: f64, x1: f64, y1: f64, from: i64, to: i64, square: usize) {
        let piece = self.from_x.len() as i32;
        self.from_x.push(x0);
        self.from_y.push(y0);
        self.to_x.push(x1);
        self.to_y.push(y1);
        self.start_edge.push(from);
        self.end_edge.push(to);
        self.square.push(square as i32);
        if from >= 0 {
            piece_from[from as usize] = piece;
            self.used.push(from as usize);
        }
        if to >= 0 {
            piece_to[to as usize] = piece;
            self.used.push(to as usize);
        }
    }
}

pub fn trace_contour(field: &mut Field) -> Rc<Contour> {
    if let Some(contour) = &field.contour {
        if field.contour_edits == field.edits {
            return contour.clone();
        }
    }
    let (cols, rows) = (field.cols, field.rows);
    let mut piece_from = std::mem::take(&mut field.piece_from);
    let mut piece_to = std::mem::take(&mut field.piece_to);
    let (phi, play, holders, ghost) = (&field.phi, &field.play, &field.holders, &field.ghost);
    let mut pieces = Pieces { from_x: Vec::new(), from_y: Vec::new(), to_x: Vec::new(), to_y: Vec::new(), start_edge: Vec::new(), end_edge: Vec::new(), square: Vec::new(), used: Vec::new() };
    let mut edge_x = [0.0f64; 4];
    let mut edge_y = [0.0f64; 4];
    let mut edge_id = [0i64; 4];
    let mut edge_real = [false; 4];
    let ghost_phi = |at: usize| -> f64 {
        let g = ghost[at];
        if g >= 0 {
            phi[g as usize]
        } else {
            f64::NAN
        }
    };
    for row in 0..rows.saturating_sub(1) {
        for col in 0..cols.saturating_sub(1) {
            let sw = row * cols + col;
            let se = sw + 1;
            let nw = sw + cols;
            let ne = nw + 1;
            let south_real = holders[sw] as u32 + holders[se] as u32 == 1;
            let east_real = holders[se] as u32 + holders[ne] as u32 == 1;
            let north_real = holders[nw] as u32 + holders[ne] as u32 == 1;
            let west_real = holders[sw] as u32 + holders[nw] as u32 == 1;
            if !south_real && !east_real && !north_real && !west_real {
                continue;
            }
            let value_sw = ghost_phi(sw);
            let value_se = ghost_phi(se);
            let value_ne = ghost_phi(ne);
            let value_nw = ghost_phi(nw);
            let shape = (if value_sw < 0.0 { 1 } else { 0 }) | (if value_se < 0.0 { 2 } else { 0 }) | (if value_ne < 0.0 { 4 } else { 0 }) | (if value_nw < 0.0 { 8 } else { 0 });
            let pairs: &[usize] = match CASES[shape] {
                Some(pairs) => pairs,
                None => {
                    let joined = if value_sw + value_se + value_ne + value_nw < 0.0 { 0 } else { 1 };
                    if shape == 5 {
                        &SADDLE_5[joined]
                    } else {
                        &SADDLE_10[joined]
                    }
                }
            };
            if pairs.is_empty() {
                continue;
            }
            let (colf, rowf) = (col as f64, row as f64);
            edge_x[0] = colf + 0.5 + value_sw / (value_sw - value_se);
            edge_y[0] = rowf + 0.5;
            edge_id[0] = (sw * 2) as i64;
            edge_real[0] = south_real;
            edge_x[1] = colf + 1.5;
            edge_y[1] = rowf + 0.5 + value_se / (value_se - value_ne);
            edge_id[1] = (se * 2 + 1) as i64;
            edge_real[1] = east_real;
            edge_x[2] = colf + 0.5 + value_nw / (value_nw - value_ne);
            edge_y[2] = rowf + 1.5;
            edge_id[2] = (nw * 2) as i64;
            edge_real[2] = north_real;
            edge_x[3] = colf + 0.5;
            edge_y[3] = rowf + 0.5 + value_sw / (value_sw - value_nw);
            edge_id[3] = (sw * 2 + 1) as i64;
            edge_real[3] = west_real;
            let whole = play[sw] != 0 && play[se] != 0 && play[ne] != 0 && play[nw] != 0;
            let mut pair = 0;
            while pair < pairs.len() {
                let from = pairs[pair];
                let to = pairs[pair + 1];
                pair += 2;
                if !edge_real[from] && !edge_real[to] {
                    continue;
                }
                let (x0, y0, x1, y1) = (edge_x[from], edge_y[from], edge_x[to], edge_y[to]);
                if whole {
                    pieces.add(&mut piece_from, &mut piece_to, x0, y0, x1, y1, edge_id[from], edge_id[to], sw);
                    continue;
                }
                let middle_x = colf + 1.0;
                let middle_y = rowf + 1.0;
                let mut first = (middle_x - x0) / (x1 - x0);
                let mut second = (middle_y - y0) / (y1 - y0);
                if !(first > 0.0 && first < 1.0) {
                    first = 1.0;
                }
                if !(second > 0.0 && second < 1.0) {
                    second = 1.0;
                }
                if second < first {
                    std::mem::swap(&mut first, &mut second);
                }
                let stops = [0.0, first, second, 1.0];
                let keep_run = |pieces: &mut Pieces, piece_from: &mut [i32], piece_to: &mut [i32], begin: f64, end: f64| {
                    let starts_real = begin == 0.0 && edge_real[from];
                    let ends_real = end == 1.0 && edge_real[to];
                    if !starts_real && !ends_real {
                        return;
                    }
                    pieces.add(
                        piece_from,
                        piece_to,
                        x0 + (x1 - x0) * begin,
                        y0 + (y1 - y0) * begin,
                        x0 + (x1 - x0) * end,
                        y0 + (y1 - y0) * end,
                        if starts_real { edge_id[from] } else { -1 },
                        if ends_real { edge_id[to] } else { -1 },
                        sw,
                    );
                };
                let mut run_start = -1.0f64;
                let mut run_end = 0.0f64;
                for part in 0..3 {
                    let begin = stops[part];
                    let end = stops[part + 1];
                    if !(end > begin) {
                        continue;
                    }
                    let middle = (begin + end) / 2.0;
                    let east = x0 + (x1 - x0) * middle >= middle_x;
                    let north = y0 + (y1 - y0) * middle >= middle_y;
                    let corner = if north {
                        if east {
                            ne
                        } else {
                            nw
                        }
                    } else if east {
                        se
                    } else {
                        sw
                    };
                    if play[corner] == 1 {
                        if run_start < 0.0 {
                            run_start = begin;
                        }
                        run_end = end;
                    } else if run_start >= 0.0 {
                        keep_run(&mut pieces, &mut piece_from, &mut piece_to, run_start, run_end);
                        run_start = -1.0;
                    }
                }
                if run_start >= 0.0 {
                    keep_run(&mut pieces, &mut piece_from, &mut piece_to, run_start, run_end);
                }
            }
        }
    }
    let count = pieces.from_x.len();
    let mut contour = Contour::default();
    let mut segment_square = Vec::new();
    let mut taken = vec![0u8; count];
    let push_vertex = |contour: &mut Contour, px: f64, py: f64, edge: i64| {
        contour.x.push(px);
        contour.y.push(py);
        if edge < 0 {
            contour.cell_a.push(-1);
            contour.cell_b.push(-1);
            return;
        }
        let low = (edge >> 1) as usize;
        let high = low + if (edge & 1) == 1 { cols } else { 1 };
        contour.cell_a.push(if holders[low] == A { low as i32 } else { high as i32 });
        contour.cell_b.push(if holders[low] == A { high as i32 } else { low as i32 });
    };
    let follow = |contour: &mut Contour, taken: &mut Vec<u8>, segment_square: &mut Vec<i32>, start: usize, closed: bool| {
        let first = contour.x.len();
        push_vertex(contour, pieces.from_x[start], pieces.from_y[start], pieces.start_edge[start]);
        let mut piece = start as i64;
        while piece >= 0 && taken[piece as usize] == 0 {
            let at = piece as usize;
            taken[at] = 1;
            let edge = pieces.end_edge[at];
            let next = if edge >= 0 { piece_from[edge as usize] as i64 } else { -1 };
            let last = closed && next == start as i64;
            contour.from.push((contour.x.len() - 1) as i32);
            segment_square.push(pieces.square[at]);
            if last {
                contour.to.push(first as i32);
                break;
            }
            contour.to.push(contour.x.len() as i32);
            push_vertex(contour, pieces.to_x[at], pieces.to_y[at], edge);
            piece = next;
        }
        contour.strands.push(StrandSpan { closed, first, count: contour.x.len() - first });
    };
    for piece in 0..count {
        if taken[piece] == 0 && (pieces.start_edge[piece] < 0 || piece_to[pieces.start_edge[piece] as usize] < 0) {
            follow(&mut contour, &mut taken, &mut segment_square, piece, false);
        }
    }
    for piece in 0..count {
        if taken[piece] == 0 {
            follow(&mut contour, &mut taken, &mut segment_square, piece, true);
        }
    }
    for &edge in &pieces.used {
        piece_from[edge] = -1;
        piece_to[edge] = -1;
    }
    contour.segments = contour.from.len();
    contour.square = segment_square;
    field.piece_from = piece_from;
    field.piece_to = piece_to;
    let contour = Rc::new(contour);
    field.contour = Some(contour.clone());
    field.contour_edits = field.edits;
    contour
}

fn buckets<'c>(field: &Field, contour: &'c Contour) -> &'c (Vec<i32>, Vec<i32>) {
    contour.buckets.get_or_init(|| {
        let mut heads = vec![-1i32; field.size];
        let mut nexts = vec![0i32; contour.segments];
        for segment in (0..contour.segments).rev() {
            let square = contour.square[segment] as usize;
            nexts[segment] = heads[square];
            heads[square] = segment as i32;
        }
        (heads, nexts)
    })
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Nearest {
    pub distance: f64,
    pub segment: i64,
    pub along: f64,
}

pub fn nearest_on_contour(field: &Field, contour: &Contour, px: f64, py: f64, reach: f64) -> Nearest {
    let (heads, nexts) = buckets(field, contour);
    let (cols, rows) = (field.cols as i64, field.rows as i64);
    let col = (px - 0.5).floor() as i64;
    let row = (py - 0.5).floor() as i64;
    let mut best = f64::INFINITY;
    let mut best_segment = -1i64;
    let mut best_along = 0.0;
    let rings = reach.ceil() as i64;
    for ring in 0..=rings {
        if best < (ring - 1) as f64 {
            break;
        }
        for dy in -ring..=ring {
            let square_row = row + dy;
            if square_row < 0 || square_row >= rows {
                continue;
            }
            let edge = dy == -ring || dy == ring;
            let mut dx = -ring;
            while dx <= ring {
                let square_col = col + dx;
                dx += if edge { 1 } else { (ring * 2).max(1) };
                if square_col < 0 || square_col >= cols {
                    continue;
                }
                let mut segment = heads[(square_row * cols + square_col) as usize];
                while segment >= 0 {
                    let s = segment as usize;
                    let ax = contour.x[contour.from[s] as usize];
                    let ay = contour.y[contour.from[s] as usize];
                    let bx = contour.x[contour.to[s] as usize] - ax;
                    let by = contour.y[contour.to[s] as usize] - ay;
                    let length = bx * bx + by * by;
                    let mut along = if length > 0.0 { ((px - ax) * bx + (py - ay) * by) / length } else { 0.0 };
                    along = if along < 0.0 {
                        0.0
                    } else if along > 1.0 {
                        1.0
                    } else {
                        along
                    };
                    let ox = px - (ax + bx * along);
                    let oy = py - (ay + by * along);
                    let distance = (ox * ox + oy * oy).sqrt();
                    if distance < best || (distance == best && (segment as i64) < best_segment) {
                        best = distance;
                        best_segment = segment as i64;
                        best_along = along;
                    }
                    segment = nexts[s];
                }
            }
        }
    }
    if best > reach {
        return Nearest { distance: f64::INFINITY, segment: -1, along: 0.0 };
    }
    Nearest { distance: best, segment: best_segment, along: best_along }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Claims {
    pub stamp: Vec<i32>,
    pub power: Vec<f32>,
    pub moment: f64,
}

#[derive(Default)]
pub struct How<'a> {
    pub claims: Option<&'a mut Claims>,
    pub strength: f64,
    pub painter: f64,
    pub painter_q: Option<f64>,
    pub from: Option<f64>,
    pub span: f64,
    pub spare: Option<&'a [f64]>,
    pub keep: Option<&'a [u8]>,
}

#[allow(clippy::too_many_arguments)]
pub fn take_capsule(field: &mut Field, side: u8, px: f64, py: f64, qx: f64, qy: f64, radius_p: f64, radius_q: f64, how: How) {
    let How { mut claims, strength, painter: painter_p, painter_q, from, span, spare, keep } = how;
    let painter_q = painter_q.unwrap_or(painter_p);
    let from = from.unwrap_or(1.0);
    let (cols, rows) = (field.cols as f64, field.rows as f64);
    let reach = jsmath::max(radius_p, radius_q) + EDIT_MARGIN_CELLS;
    let col0 = jsmath::max(0.0, (jsmath::min(px, qx) - reach).floor());
    let col1 = jsmath::min(cols - 1.0, (jsmath::max(px, qx) + reach).floor());
    let row0 = jsmath::max(0.0, (jsmath::min(py, qy) - reach).floor());
    let row1 = jsmath::min(rows - 1.0, (jsmath::max(py, qy) + reach).floor());
    let sx = qx - px;
    let sy = qy - py;
    let length = sx * sx + sy * sy;
    let mut row = row0;
    while row <= row1 {
        let cy = row + 0.5;
        let mut col = col0;
        while col <= col1 {
            let index = (row * cols + col) as usize;
            let cx = col + 0.5;
            col += 1.0;
            if field.play[index] == 0 || keep.is_some_and(|keep| keep.get(index).is_some_and(|&k| k != 0)) {
                continue;
            }
            let mut along = if length > 0.0 { ((cx - px) * sx + (cy - py) * sy) / length } else { 0.0 };
            along = if along < 0.0 {
                0.0
            } else if along > 1.0 {
                1.0
            } else {
                along
            };
            let ox = cx - (px + sx * along);
            let oy = cy - (py + sy * along);
            let mut distance = (ox * ox + oy * oy).sqrt() - (radius_p + (radius_q - radius_p) * along);
            if let Some(spare) = spare {
                let mut at = 0;
                while at < spare.len() {
                    let dx = cx - spare[at];
                    let dy = cy - spare.get(at + 1).copied().unwrap_or(f64::NAN);
                    let within = spare.get(at + 2).copied().unwrap_or(f64::NAN) - (dx * dx + dy * dy).sqrt();
                    if within > distance {
                        distance = within;
                    }
                    if within >= 0.0 && distance < LEAST {
                        distance = LEAST;
                    }
                    at += 3;
                }
            }
            if distance > EDIT_MARGIN_CELLS {
                continue;
            }
            let painter = if along < 0.5 { painter_p } else { painter_q };
            if side == A {
                if let Some(claims) = claims.as_deref_mut() {
                    if distance < 0.0 && !(claims.stamp[index] as f64 == claims.moment && claims.power[index] as f64 >= strength) {
                        claims.stamp[index] = js::to_int32(claims.moment);
                        claims.power[index] = strength as f32;
                    }
                }
                if distance < field.phi[index] {
                    write(field, index, distance, painter, from + span * along);
                }
            } else if -distance > field.phi[index] {
                if let Some(claims) = claims.as_deref() {
                    if claims.stamp[index] as f64 == claims.moment && claims.power[index] as f64 >= strength {
                        continue;
                    }
                }
                write(field, index, -distance, painter, from + span * along);
            }
        }
        row += 1.0;
    }
}

pub enum Painter<'a> {
    Value(f64),
    By(&'a mut dyn FnMut(usize) -> f64),
}

pub fn take_cells(field: &mut Field, side: u8, cells: &[usize], mut painter: Painter) {
    let (cols, rows) = (field.cols, field.rows);
    let inside = side_sign(side) * ROUGH;
    for &index in cells {
        if field.play[index] == 0 {
            continue;
        }
        let wanted = if side == A { field.phi[index] > inside } else { field.phi[index] < inside };
        if wanted {
            let paint = if field.holders[index] == side {
                0.0
            } else {
                match &mut painter {
                    Painter::Value(value) => *value,
                    Painter::By(by) => by(index),
                }
            };
            write(field, index, inside, paint, 1.0);
        }
    }
    for &index in cells {
        if field.play[index] == 0 {
            continue;
        }
        let col = index % cols;
        let row = index / cols;
        for step in 0..4 {
            let neighbour: i64 = match step {
                0 => if row > 0 { (index - cols) as i64 } else { -1 },
                1 => if col > 0 { (index - 1) as i64 } else { -1 },
                2 => if col + 1 < cols { (index + 1) as i64 } else { -1 },
                _ => if row + 1 < rows { (index + cols) as i64 } else { -1 },
            };
            if neighbour < 0 {
                continue;
            }
            let neighbour = neighbour as usize;
            if field.play[neighbour] == 0 || field.holders[neighbour] == side {
                continue;
            }
            let wanted = if side == A { field.phi[neighbour] > ROUGH } else { field.phi[neighbour] < -ROUGH };
            if wanted {
                write(field, neighbour, -inside, 0.0, 1.0);
            }
        }
    }
}

pub fn restore_cells<F: FnMut(usize) -> f64>(field: &mut Field, cells: &[usize], earlier_phi: &[f64], mut painter: F) {
    for &index in cells {
        let earlier = earlier_phi.get(index).copied().unwrap_or(f64::NAN);
        if field.play[index] == 0 || earlier == 0.0 || field.phi[index] == earlier {
            continue;
        }
        let returns = (earlier < 0.0) != (field.phi[index] < 0.0);
        let paint = if returns { painter(index) } else { 0.0 };
        write(field, index, earlier, paint, 1.0);
    }
}

fn touches_other_side(field: &Field, index: usize) -> bool {
    let (cols, rows, holders) = (field.cols, field.rows, &field.holders);
    let want = 1i32 - holders[index] as i32;
    let col = index % cols;
    let row = index / cols;
    let is = |at: usize| holders[at] as i32 == want;
    (row > 0 && is(index - cols)) || (col > 0 && is(index - 1)) || (col + 1 < cols && is(index + 1)) || (row + 1 < rows && is(index + cols))
}

fn distance_for(field: &Field, contour: &Contour, index: usize) -> f64 {
    let col = index % field.cols;
    let found = nearest_on_contour(field, contour, col as f64 + 0.5, ((index - col) / field.cols) as f64 + 0.5, REDISTANCE_REACH_CELLS).distance;
    let distance = if found == f64::INFINITY {
        FAR_CELLS
    } else if found < LEAST {
        LEAST
    } else {
        found
    };
    side_sign(field.holders[index]) * distance
}

pub fn redistance(field: &mut Field) {
    if field.changed.is_empty() {
        return;
    }
    let contour = trace_contour(field);
    let (cols, rows) = (field.cols, field.rows);
    let mut seen = field.seen.take().unwrap_or_else(|| vec![0u8; field.size]);
    seen.fill(0);
    let near = REDISTANCE_NEAR_CELLS as usize;
    let changed = std::mem::take(&mut field.changed);
    for &centre in &changed {
        let col = centre % cols;
        let row = centre / cols;
        let row1 = (rows - 1).min(row + near);
        let col1 = (cols - 1).min(col + near);
        for at_row in row.saturating_sub(near)..=row1 {
            for index in at_row * cols + col.saturating_sub(near)..=at_row * cols + col1 {
                if seen[index] != 0 {
                    continue;
                }
                seen[index] = 1;
                if field.play[index] == 0 || touches_other_side(field, index) {
                    continue;
                }
                field.phi[index] = distance_for(field, &contour, index);
            }
        }
    }
    for &index in &changed {
        field.marked[index] = 0;
    }
    field.changed = changed;
    field.changed.clear();
    field.seen = Some(seen);
    field.edits += 1;
    field.contour_edits = field.edits;
}

pub fn rebuild_distances(field: &mut Field, keep_line: bool) {
    let contour = trace_contour(field);
    let (cols, rows, size) = (field.cols, field.rows, field.size);
    let mut near = vec![0u8; size];
    let reach = REDISTANCE_REACH_CELLS as usize;
    for segment in 0..contour.segments {
        let square = contour.square[segment] as usize;
        let col = square % cols;
        let row = square / cols;
        let row1 = (rows - 1).min(row + reach + 1);
        let col1 = (cols - 1).min(col + reach + 1);
        for at in row.saturating_sub(reach)..=row1 {
            near[at * cols + col.saturating_sub(reach)..at * cols + col1 + 1].fill(1);
        }
    }
    let mut next = vec![0.0f64; size];
    for index in 0..size {
        if field.play[index] == 0 {
            continue;
        }
        next[index] = if near[index] == 0 {
            side_sign(field.holders[index]) * FAR_CELLS
        } else if keep_line && touches_other_side(field, index) {
            field.phi[index]
        } else {
            distance_for(field, &contour, index)
        };
    }
    field.phi = next;
    for &index in &field.changed {
        field.marked[index] = 0;
    }
    field.changed.clear();
    field.edits += 1;
}

pub fn open_field(arena: Rc<Arena>, regions: &[Val], side_of_region: &[i32], ice_side: Option<&[i32]>) -> Option<Field> {
    let mut field = create_field(arena.clone());
    set_ground(&mut field, side_of_region, ice_side);
    let (cols, rows, size) = (field.cols, field.rows, field.size);
    let mut border = Vec::new();
    let (mut col0, mut col1, mut row0, mut row1) = (cols as i64, -1i64, rows as i64, -1i64);
    for index in 0..size {
        if field.play[index] == 0 {
            continue;
        }
        field.phi[index] = side_sign(field.holders[index]) * ROUGH;
        let col = (index % cols) as i64;
        let row = (index / cols) as i64;
        let want = 1i32 - field.holders[index] as i32;
        let mut beside = false;
        let mut dy = -1;
        while dy <= 1 && !beside {
            let mut dx = -1;
            while dx <= 1 && !beside {
                let nx = col + dx;
                let ny = row + dy;
                beside = nx >= 0 && ny >= 0 && nx < cols as i64 && ny < rows as i64 && field.holders[(ny * cols as i64 + nx) as usize] as i32 == want;
                dx += 1;
            }
            dy += 1;
        }
        if !beside {
            continue;
        }
        border.push(index);
        col0 = col0.min(col);
        col1 = col1.max(col);
        row0 = row0.min(row);
        row1 = row1.max(row);
    }
    if border.is_empty() {
        return None;
    }
    let scale = SUPERSAMPLE as usize;
    let fine = sample_regions(&arena, regions, SampleBox { col0: col0 as f64, row0: row0 as f64, col1: col1 as f64, row1: row1 as f64 }, SUPERSAMPLE, |value| side_at(side_of_region, value) >= 0 && arena.region_speed[value] > 0.0);
    let width = fine.width as usize;
    for &index in &border {
        let col = index % cols;
        let row = index / cols;
        let mut count_a = 0;
        let mut count_b = 0;
        for dy in 0..scale {
            let base = ((row - row0 as usize) * scale + dy) * width + (col - col0 as usize) * scale;
            for dx in 0..scale {
                let side = side_at(side_of_region, fine.grid[base + dx] as usize);
                if side == 0 {
                    count_a += 1;
                } else if side == 1 {
                    count_b += 1;
                }
            }
        }
        let share = if count_a + count_b == 0 {
            if field.holders[index] == B {
                1.0
            } else {
                0.0
            }
        } else {
            count_b as f64 / (count_a + count_b) as f64
        };
        let least = 1.0 / 64.0;
        field.phi[index] = if field.holders[index] == A { jsmath::min(-least, share - 0.5) } else { jsmath::max(least, share - 0.5) };
    }
    field.edits += 1;
    rebuild_distances(&mut field, false);
    Some(field)
}

pub fn rebuild_from_holders(field: &mut Field) {
    for index in 0..field.size {
        if field.play[index] != 0 {
            field.phi[index] = side_sign(field.holders[index]) * ROUGH;
        }
    }
    field.edits += 1;
    rebuild_distances(field, false);
}

#[derive(Clone, Debug, PartialEq)]
pub struct Packed {
    pub mask: String,
    pub band: String,
    pub key: String,
}

pub fn pack_field(field: &Field) -> Packed {
    let cells = band_indices(&field.holders, field.cols, field.rows, BAND_CELLS);
    let mut values = Vec::with_capacity(cells.len());
    for &index in &cells {
        let index = index as usize;
        let value = jsmath::round(field.phi[index] * BAND_UNITS);
        let value = if field.holders[index] == A { jsmath::min(-1.0, value) } else { jsmath::max(1.0, value) };
        values.push(js::to_int32(value) as i16 as f64);
    }
    Packed { mask: encode_mask(&field.holders), band: encode_band(&values), key: field.arena.key.clone() }
}

pub fn unpack_field(arena: Rc<Arena>, mask_text: &str, band_text: &str, key: Option<&str>, side_of_region: &[i32], ice_side: Option<&[i32]>) -> Field {
    let mut field = create_field(arena.clone());
    set_ground(&mut field, side_of_region, ice_side);
    let (cols, rows, size) = (field.cols, field.rows, field.size);
    let mask = decode_mask(mask_text, size as f64);
    let cells = band_indices(&mask, cols, rows, BAND_CELLS);
    let mut trusted = key == Some(arena.key.as_str()) && js::utf16_len(band_text) * 6 >= cells.len() * 8;
    for index in 0..size {
        if field.play[index] == 0 {
            continue;
        }
        if mask[index] == WALL {
            trusted = false;
        } else {
            field.holders[index] = mask[index];
        }
        field.phi[index] = side_sign(field.holders[index]) * FAR_CELLS;
    }
    if trusted {
        let values = decode_band(band_text, cells.len() as f64);
        let mut position = 0;
        while position < cells.len() && trusted {
            let index = cells[position] as usize;
            if field.play[index] != 0 {
                let value = values[position];
                if value == 0 || (value < 0) != (field.holders[index] == A) {
                    trusted = false;
                } else {
                    field.phi[index] = value as f64 / BAND_UNITS;
                }
            }
            position += 1;
        }
    }
    field.changed.clear();
    field.marked.fill(0);
    field.edits += 1;
    field.turns += 1;
    if !trusted {
        rebuild_from_holders(&mut field);
    }
    field
}

pub fn resample_field(old: &Field, arena: Rc<Arena>, side_of_region: &[i32], ice_side: Option<&[i32]>) -> Field {
    let mut field = create_field(arena.clone());
    set_ground(&mut field, side_of_region, ice_side);
    let cols = field.cols;
    let to_lng_lat = Projector::of(&arena.frame);
    let to_cell = Projector::of(&old.arena.frame);
    let scale = old.arena.frame.cell / arena.frame.cell;
    for index in 0..field.size {
        if field.play[index] == 0 {
            continue;
        }
        let col = index % cols;
        let [lng, lat] = to_lng_lat.to_lng_lat(col as f64 + 0.5, ((index - col) / cols) as f64 + 0.5);
        let [x, y] = to_cell.to_cell(lng, lat);
        let value = read_field(old, x, y);
        if value != 0.0 {
            field.holders[index] = if value < 0.0 { A } else { B };
        }
        field.phi[index] = if value != 0.0 { value * scale } else { side_sign(field.holders[index]) * ROUGH };
    }
    field.changed.clear();
    field.marked.fill(0);
    field.edits += 1;
    field.turns += 1;
    rebuild_distances(&mut field, true);
    field
}

pub fn read_field(field: &Field, x: f64, y: f64) -> f64 {
    let (cols, rows) = (field.cols as f64, field.rows as f64);
    if !(x >= 0.0) || !(y >= 0.0) || x >= cols || y >= rows {
        return 0.0;
    }
    let own = (y.floor() * cols + x.floor()) as usize;
    if field.play[own] == 0 {
        return 0.0;
    }
    let col = (x - 0.5).floor();
    let row = (y - 0.5).floor();
    if col < 0.0 || row < 0.0 || col >= cols - 1.0 || row >= rows - 1.0 {
        return field.phi[own];
    }
    let c = field.cols;
    let sw = (row * cols + col) as usize;
    if field.play[sw] == 0 || field.play[sw + 1] == 0 || field.play[sw + c] == 0 || field.play[sw + c + 1] == 0 {
        return field.phi[own];
    }
    let fx = x - 0.5 - col;
    let fy = y - 0.5 - row;
    let phi = &field.phi;
    let value = (phi[sw] * (1.0 - fx) + phi[sw + 1] * fx) * (1.0 - fy) + (phi[sw + c] * (1.0 - fx) + phi[sw + c + 1] * fx) * fy;
    if value != 0.0 {
        value
    } else {
        phi[own]
    }
}

pub fn holder_at_point(field: &Field, x: f64, y: f64) -> u8 {
    if !(x >= 0.0) || !(y >= 0.0) || x >= field.cols as f64 || y >= field.rows as f64 {
        return WALL;
    }
    field.holders[(y.floor() * field.cols as f64 + x.floor()) as usize]
}

pub fn nearest_held(field: &Field, side: u8, x: f64, y: f64, reach: f64) -> i64 {
    let (cols, rows) = (field.cols as i64, field.rows as i64);
    let col = x.floor() as i64;
    let row = y.floor() as i64;
    let mut best = -1i64;
    let mut best_distance = f64::INFINITY;
    let mut ring = 0i64;
    while ring as f64 <= reach {
        if ring > 1 && best_distance < ((ring - 1) * (ring - 1)) as f64 {
            break;
        }
        for dy in -ring..=ring {
            let at = row + dy;
            if at < 0 || at >= rows {
                continue;
            }
            let edge = dy == -ring || dy == ring;
            let mut dx = -ring;
            while dx <= ring {
                let across = col + dx;
                dx += if edge { 1 } else { (ring * 2).max(1) };
                if across < 0 || across >= cols || field.holders[(at * cols + across) as usize] != side {
                    continue;
                }
                let ox = across as f64 + 0.5 - x;
                let oy = at as f64 + 0.5 - y;
                let distance = ox * ox + oy * oy;
                let index = at * cols + across;
                if distance < best_distance || (distance == best_distance && index < best) {
                    best_distance = distance;
                    best = index;
                }
            }
        }
        ring += 1;
    }
    best
}

pub fn own_cell(field: &Field, side: u8, x: f64, y: f64) -> i64 {
    if !(x >= 0.0) || !(y >= 0.0) || x >= field.cols as f64 || y >= field.rows as f64 {
        return -1;
    }
    let cell = (y.floor() * field.cols as f64 + x.floor()) as usize;
    if field.holders[cell] == side {
        cell as i64
    } else {
        nearest_held(field, side, x, y, 1.0)
    }
}

pub fn bodies_of(field: &mut Field, side: usize) -> Rc<Bodies> {
    if let Some(known) = &field.bodies[side] {
        if known.turns == field.turns {
            return known.clone();
        }
    }
    let (cols, rows, size) = (field.cols, field.rows, field.size);
    let holders = &field.holders;
    let want = side as u8;
    let mut label = vec![-1i32; size];
    let mut sizes = Vec::new();
    let mut queue = vec![0usize; size];
    for seed in 0..size {
        if holders[seed] != want || label[seed] >= 0 {
            continue;
        }
        let body = sizes.len() as i32;
        let mut head = 0;
        let mut tail = 0;
        queue[tail] = seed;
        tail += 1;
        label[seed] = body;
        while head < tail {
            let index = queue[head];
            head += 1;
            let col = index % cols;
            let row = index / cols;
            let visit = |next: usize, label: &mut Vec<i32>, queue: &mut Vec<usize>, tail: &mut usize| {
                if holders[next] == want && label[next] < 0 {
                    label[next] = body;
                    queue[*tail] = next;
                    *tail += 1;
                }
            };
            if row > 0 {
                visit(index - cols, &mut label, &mut queue, &mut tail);
            }
            if col > 0 {
                visit(index - 1, &mut label, &mut queue, &mut tail);
            }
            if col + 1 < cols {
                visit(index + 1, &mut label, &mut queue, &mut tail);
            }
            if row + 1 < rows {
                visit(index + cols, &mut label, &mut queue, &mut tail);
            }
        }
        sizes.push(tail);
    }
    let count = sizes.len();
    let bodies = Rc::new(Bodies { turns: field.turns, label, sizes, count });
    field.bodies[side] = Some(bodies.clone());
    bodies
}

pub fn count_holders(field: &Field) -> [f64; 2] {
    let mut held = [0.0, 0.0];
    for &holder in &field.holders {
        if holder == A || holder == B {
            held[holder as usize] += 1.0;
        }
    }
    held
}
