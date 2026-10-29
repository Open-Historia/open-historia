use super::constants::{CELL_STEPS_KM, MAX_CELLS, MAX_GRID_SPAN};
use super::js::Val;
use crate::jsmath;

pub use crate::frame::{lat_to_y, number_or_zero, y_to_lat, Frame, KM_PER_DEGREE, RAD};

const MERCATOR_MAX_LAT: f64 = 85.0511287798066;

pub fn unwrap_lng(lng: f64, around: f64) -> f64 {
    let value = super::js::or_zero(lng);
    value - jsmath::round((value - around) / 360.0) * 360.0
}

fn round6(value: f64) -> f64 {
    jsmath::round(value * 1e6) / 1e6
}

pub fn home_lng0(lng0: f64, width: f64) -> f64 {
    let middle = lng0 + width / 2.0;
    let turn = ((middle + 180.0) / 360.0).floor();
    if turn == 0.0 {
        lng0
    } else {
        lng0 - turn * 360.0
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Bounds {
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
}

pub fn create_frame(bounds: Bounds, flat: bool, scale: f64, margin_km: f64) -> Option<Frame> {
    let west = bounds.west;
    let mut east = bounds.east;
    let south = bounds.south;
    let north = bounds.north;
    if ![west, east, south, north].iter().all(|value| value.is_finite()) || north <= south || east == west {
        return None;
    }
    if east < west {
        east += 360.0;
    }
    let bottom = lat_to_y(south);
    let top = lat_to_y(north);
    let km_per_degree = if flat {
        if scale > 0.0 {
            scale
        } else {
            KM_PER_DEGREE
        }
    } else {
        KM_PER_DEGREE * jsmath::cos(y_to_lat((bottom + top) / 2.0) * RAD)
    };
    let margin = jsmath::max(0.0, number_or_zero(margin_km)) / km_per_degree;
    let outer = round6(west - margin);
    let lat0 = round6(y_to_lat(jsmath::max(lat_to_y(-MERCATOR_MAX_LAT), bottom - margin)));
    let y0 = lat_to_y(lat0);
    let width = east + margin - outer;
    let lng0 = round6(home_lng0(outer, width));
    let height = jsmath::min(lat_to_y(MERCATOR_MAX_LAT), top + margin) - y0;
    let fits = |km: f64| -> bool {
        let cell = km / km_per_degree;
        let cols = (width / cell).ceil();
        let rows = (height / cell).ceil();
        cols <= MAX_GRID_SPAN && rows <= MAX_GRID_SPAN && cols * rows <= MAX_CELLS
    };
    let mut km = CELL_STEPS_KM.iter().copied().find(|&km| fits(km)).unwrap_or(0.0);
    if km == 0.0 {
        let needed = jsmath::max(jsmath::max(width / MAX_GRID_SPAN, height / MAX_GRID_SPAN), ((width * height) / MAX_CELLS).sqrt()) * km_per_degree;
        km = (needed / 8.0).ceil() * 8.0;
        while !fits(km) {
            km += 8.0;
        }
    }
    let cell = km / km_per_degree;
    Some(Frame {
        lng0,
        lat0,
        cell,
        cols: jsmath::max(2.0, (width / cell).ceil()),
        rows: jsmath::max(2.0, (height / cell).ceil()),
        km,
        flat,
        scale: if flat { km_per_degree } else { 0.0 },
    })
}

pub fn normalize_frame(value: &Val) -> Option<Frame> {
    if !value.truthy() || !value.is_plain_object() {
        return None;
    }
    let lng0 = value.get("lng0").num();
    let lat0 = value.get("lat0").num();
    let cell = value.get("cell").num();
    let cols = value.get("cols").num();
    let rows = value.get("rows").num();
    let km = value.get("km").num();
    if ![lng0, lat0, cell, km].iter().all(|item| item.is_finite()) || !(cell > 0.0) || !(km > 0.0) {
        return None;
    }
    let integer = |item: f64| item.is_finite() && item.trunc() == item;
    if !integer(cols) || !integer(rows) || cols < 2.0 || rows < 2.0 {
        return None;
    }
    if cols > MAX_GRID_SPAN || rows > MAX_GRID_SPAN || cols * rows > MAX_CELLS {
        return None;
    }
    if !(-MERCATOR_MAX_LAT..=MERCATOR_MAX_LAT).contains(&lat0) || !(-540.0..=540.0).contains(&lng0) {
        return None;
    }
    let mut frame = Frame { lng0: home_lng0(lng0, cols * cell), lat0, cell, cols, rows, km, flat: false, scale: 0.0 };
    if value.get("flat").is_true() {
        let scale = value.get("scale").num();
        frame.flat = true;
        frame.scale = if scale > 0.0 && scale.is_finite() { scale } else { KM_PER_DEGREE };
    }
    Some(frame)
}

#[derive(Clone, Debug)]
pub struct Projector {
    pub row_km: Vec<f64>,
    pub lng0: f64,
    pub cell: f64,
    pub cols: f64,
    pub rows: f64,
    pub y0: f64,
    pub middle: f64,
}

impl Projector {
    pub fn of(frame: &Frame) -> Self {
        let y0 = lat_to_y(frame.lat0);
        let middle = frame.lng0 + (frame.cols * frame.cell) / 2.0;
        let rows = if frame.rows > 0.0 { frame.rows as usize } else { 0 };
        let scale = if frame.scale != 0.0 && !frame.scale.is_nan() { frame.scale } else { KM_PER_DEGREE };
        let row_km = (0..rows)
            .map(|row| {
                if frame.flat {
                    frame.cell * scale
                } else {
                    frame.cell * KM_PER_DEGREE * jsmath::cos(y_to_lat(y0 + (row as f64 + 0.5) * frame.cell) * RAD)
                }
            })
            .collect();
        Self { row_km, lng0: frame.lng0, cell: frame.cell, cols: frame.cols, rows: frame.rows, y0, middle }
    }

    pub fn to_cell(&self, lng: f64, lat: f64) -> [f64; 2] {
        [(unwrap_lng(lng, self.middle) - self.lng0) / self.cell, (lat_to_y(lat) - self.y0) / self.cell]
    }

    pub fn to_lng_lat(&self, x: f64, y: f64) -> [f64; 2] {
        [self.lng0 + x * self.cell, y_to_lat(self.y0 + y * self.cell)]
    }

    pub fn km_at(&self, y: f64) -> f64 {
        let index = if y < 0.0 {
            0.0
        } else if y >= self.rows {
            self.rows - 1.0
        } else {
            y.floor()
        };
        if index >= 0.0 && (index as usize) < self.row_km.len() {
            self.row_km[index as usize]
        } else {
            f64::NAN
        }
    }
}

pub fn projector_of(frame: &Frame) -> Projector {
    Projector::of(frame)
}

pub fn frame_bounds(frame: &Frame) -> Bounds {
    let y0 = lat_to_y(frame.lat0);
    let [west, south] = [frame.lng0 + 0.0 * frame.cell, y_to_lat(y0 + 0.0 * frame.cell)];
    let [east, north] = [frame.lng0 + frame.cols * frame.cell, y_to_lat(y0 + frame.rows * frame.cell)];
    Bounds { west, south, east, north }
}

pub fn frame_to_cell(frame: &Frame, lng: f64, lat: f64) -> [f64; 2] {
    let middle = frame.lng0 + (frame.cols * frame.cell) / 2.0;
    [(unwrap_lng(lng, middle) - frame.lng0) / frame.cell, (lat_to_y(lat) - lat_to_y(frame.lat0)) / frame.cell]
}

pub fn point_in_frame(frame: &Frame, lng: f64, lat: f64) -> bool {
    let [x, y] = frame_to_cell(frame, lng, lat);
    x >= 0.0 && y >= 0.0 && x < frame.cols && y < frame.rows
}

pub fn cell_index_at(frame: &Frame, x: f64, y: f64) -> f64 {
    if !(x >= 0.0) || !(y >= 0.0) || x >= frame.cols || y >= frame.rows {
        return -1.0;
    }
    y.floor() * frame.cols + x.floor()
}
