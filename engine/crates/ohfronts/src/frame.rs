use crate::jsmath;

pub const KM_PER_DEGREE: f64 = 111.32;
pub const RAD: f64 = std::f64::consts::PI / 180.0;
const MERCATOR_MAX_LAT: f64 = 85.0511287798066;

pub fn number_or_zero(value: f64) -> f64 {
    if value.is_nan() {
        0.0
    } else {
        value
    }
}

pub fn lat_to_y(lat: f64) -> f64 {
    let clamped = jsmath::max(-MERCATOR_MAX_LAT, jsmath::min(MERCATOR_MAX_LAT, number_or_zero(lat)));
    jsmath::log(jsmath::tan(std::f64::consts::PI / 4.0 + (clamped * RAD) / 2.0)) / RAD
}

pub fn y_to_lat(y: f64) -> f64 {
    (2.0 * jsmath::atan(jsmath::exp(number_or_zero(y) * RAD)) - std::f64::consts::PI / 2.0) / RAD
}

#[derive(Clone, Debug)]
pub struct Frame {
    pub lng0: f64,
    pub lat0: f64,
    pub cell: f64,
    pub cols: f64,
    pub rows: f64,
    pub km: f64,
    pub flat: bool,
    pub scale: f64,
}

#[derive(Clone, Debug)]
pub struct Projector {
    lng0: f64,
    cell: f64,
    y0: f64,
}

impl Projector {
    pub fn of(frame: &Frame) -> Self {
        Self { lng0: frame.lng0, cell: frame.cell, y0: lat_to_y(frame.lat0) }
    }

    pub fn to_lng_lat(&self, x: f64, y: f64) -> [f64; 2] {
        [self.lng0 + x * self.cell, y_to_lat(self.y0 + y * self.cell)]
    }
}
