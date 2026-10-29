use super::codec::Strand;
use super::constants::LINE_SIMPLIFY_CELLS;
use super::field::{Contour, Field};
use std::rc::Rc;

#[derive(Clone, Debug, PartialEq)]
pub struct Measured {
    pub count: usize,
    pub km: Vec<f64>,
    pub nx: Vec<f64>,
    pub ny: Vec<f64>,
    pub strand: Vec<i32>,
    pub total: f64,
}

#[derive(Clone, Debug)]
pub struct Line {
    pub contour: Rc<Contour>,
    pub measured: Rc<Measured>,
}

impl Line {
    pub fn count(&self) -> usize {
        self.measured.count
    }
}

pub fn measure(field: &Field, contour: &Contour) -> Rc<Measured> {
    contour
        .measured
        .get_or_init(|| {
            let place = field.arena.projector();
            let count = contour.x.len();
            let mut km = vec![0.0f64; count];
            let mut nx = vec![0.0f64; count];
            let mut ny = vec![0.0f64; count];
            let mut strand = vec![0i32; count];
            let mut total = 0.0;
            for (index, span) in contour.strands.iter().enumerate() {
                let (first, length, closed) = (span.first, span.count, span.closed);
                let segments = if closed { length } else { length.saturating_sub(1) };
                for step in 0..length {
                    strand[first + step] = index as i32;
                }
                for step in 0..segments {
                    let from = first + step;
                    let to = first + ((step + 1) % length);
                    let dx = contour.x[to] - contour.x[from];
                    let dy = contour.y[to] - contour.y[from];
                    let cells = (dx * dx + dy * dy).sqrt();
                    km[from] = total;
                    total += cells * place.km_at((contour.y[from] + contour.y[to]) / 2.0);
                    if cells > 0.0 {
                        nx[from] += dy / cells;
                        ny[from] -= dx / cells;
                        nx[to] += dy / cells;
                        ny[to] -= dx / cells;
                    }
                }
                if !closed && length > 0 {
                    km[first + length - 1] = total;
                }
            }
            for vertex in 0..count {
                let length = (nx[vertex] * nx[vertex] + ny[vertex] * ny[vertex]).sqrt();
                if length > 0.0 {
                    nx[vertex] /= length;
                    ny[vertex] /= length;
                }
            }
            Rc::new(Measured { count, km, nx, ny, strand, total })
        })
        .clone()
}

pub fn measure_line(field: &Field, contour: &Rc<Contour>) -> Line {
    Line { contour: contour.clone(), measured: measure(field, contour) }
}

fn same_mark(a: f64, b: f64) -> bool {
    a == b || (a.is_nan() && b.is_nan())
}

fn cut_corners(points: Vec<f64>, flags: Vec<f64>, closed: bool) -> (Vec<f64>, Vec<f64>) {
    let count = points.len() / 2;
    if count < 3 {
        return (points, flags);
    }
    let mut next_points = Vec::with_capacity(points.len() * 2 + 4);
    let mut next_flags = Vec::with_capacity(flags.len() * 2 + 2);
    let segments = if closed { count } else { count - 1 };
    if !closed {
        next_points.push(points[0]);
        next_points.push(points[1]);
        next_flags.push(flags.first().copied().unwrap_or(f64::NAN));
    }
    let flag = |at: usize| flags.get(at).copied().unwrap_or(f64::NAN);
    for index in 0..segments {
        let other = (index + 1) % count;
        let ax = points[index * 2];
        let ay = points[index * 2 + 1];
        let bx = points[other * 2];
        let by = points[other * 2 + 1];
        next_points.extend_from_slice(&[ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25, ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
        next_flags.push(flag(index));
        next_flags.push(flag(other));
    }
    if !closed {
        next_points.push(points[count * 2 - 2]);
        next_points.push(points[count * 2 - 1]);
        next_flags.push(flag(count - 1));
    }
    (next_points, next_flags)
}

fn thin(points: &[f64], keep: &mut [u8], from: usize, to: usize) {
    let mut spans = vec![from, to];
    while let (Some(last), Some(first)) = (spans.pop(), spans.pop()) {
        if last < first + 2 {
            continue;
        }
        let ax = points[first * 2];
        let ay = points[first * 2 + 1];
        let bx = points[last * 2] - ax;
        let by = points[last * 2 + 1] - ay;
        let length = bx * bx + by * by;
        let mut worst = 0.0;
        let mut at: i64 = -1;
        for index in first + 1..last {
            let px = points[index * 2] - ax;
            let py = points[index * 2 + 1] - ay;
            let mut along = if length > 0.0 { (px * bx + py * by) / length } else { 0.0 };
            along = if along < 0.0 {
                0.0
            } else if along > 1.0 {
                1.0
            } else {
                along
            };
            let ox = px - bx * along;
            let oy = py - by * along;
            let off = ox * ox + oy * oy;
            if off > worst {
                worst = off;
                at = index as i64;
            }
        }
        if at < 0 || worst <= LINE_SIMPLIFY_CELLS * LINE_SIMPLIFY_CELLS {
            continue;
        }
        let at = at as usize;
        keep[at] = 1;
        spans.extend_from_slice(&[first, at, at, last]);
    }
}

pub fn draw_line(contour: &Contour, flags: &[f64]) -> Vec<Strand> {
    let mut drawn = Vec::new();
    for span in &contour.strands {
        let (first, count, closed) = (span.first, span.count, span.closed);
        let mut points = Vec::with_capacity(count * 2);
        let mut marks = Vec::with_capacity(count);
        for step in 0..count {
            points.push(contour.x[first + step]);
            points.push(contour.y[first + step]);
            marks.push(flags.get(first + step).copied().unwrap_or(f64::NAN));
        }
        for _ in 0..2 {
            let (next_points, next_marks) = cut_corners(points, marks, closed);
            points = next_points;
            marks = next_marks;
        }
        if closed {
            points.push(points[0]);
            points.push(points[1]);
            marks.push(marks[0]);
        }
        let length = marks.len();
        let mut keep = vec![0u8; length];
        keep[0] = 1;
        keep[length - 1] = 1;
        let mut from = 0;
        for index in 1..length {
            if index < length - 1 && same_mark(marks[index], marks[index + 1]) && same_mark(marks[index], marks[index - 1]) {
                continue;
            }
            keep[index] = 1;
            thin(&points, &mut keep, from, index);
            from = index;
        }
        let mut strand = Strand { closed, points: Vec::new(), flags: Vec::new() };
        let last = if closed { length - 1 } else { length };
        for index in 0..last {
            if keep[index] == 0 {
                continue;
            }
            strand.points.push([points[index * 2], points[index * 2 + 1]]);
            strand.flags.push(marks[index]);
        }
        if strand.points.len() >= if closed { 3 } else { 2 } {
            drawn.push(strand);
        }
    }
    drawn
}
