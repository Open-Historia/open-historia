use godot::prelude::*;

const WORLD: f64 = 4096.0;
const LEVELS: usize = 6;
const EARTH_RADIUS_M: f64 = 6371008.8;
const HIDDEN: f32 = -100000.0;

struct Level {
    rect: [f64; 4],
    size: (i64, i64),
    data: PackedFloat32Array,
}

#[derive(Default, Clone, Copy)]
struct Frame {
    ready: bool,
    relief: bool,
    size: (f64, f64),
    cam_world: (f64, f64),
    px_per_world: f64,
    flat_right: (f64, f64),
    flat_up: (f64, f64),
    sin_p: f64,
    cos_p: f64,
    focal: f64,
    g: f64,
    pos: [f64; 3],
    right: [f64; 3],
    up: [f64; 3],
    fwd: [f64; 3],
    radius: f64,
    per_meter: f64,
    centre_h: f64,
    lift_low: f64,
    lift_high: f64,
    near: f64,
    far: f64,
}

#[derive(GodotClass)]
#[class(init, base = RefCounted)]
pub struct TerrainProjector {
    has_data: bool,
    lod_rect: [f64; 4],
    lod_cell: f64,
    lod_size: (i64, i64),
    lod_data: PackedByteArray,
    levels: Vec<Option<Level>>,
    step: f64,
    exaggeration: f64,
    frame: Frame,
}

fn vec2(value: Option<Variant>) -> (f64, f64) {
    match value.and_then(|v| v.try_to::<Vector2>().ok()) {
        Some(v) => (v.x as f64, v.y as f64),
        None => (0.0, 0.0),
    }
}

fn vec3(value: Option<Variant>) -> [f64; 3] {
    match value.and_then(|v| v.try_to::<Vector3>().ok()) {
        Some(v) => [v.x as f64, v.y as f64, v.z as f64],
        None => [0.0, 0.0, 0.0],
    }
}

fn number(value: Option<Variant>) -> f64 {
    match value {
        Some(v) => v.try_to::<f64>().or_else(|_| v.try_to::<i64>().map(|i| i as f64)).unwrap_or(0.0),
        None => 0.0,
    }
}

fn flag(value: Option<Variant>) -> bool {
    value.and_then(|v| v.try_to::<bool>().ok()).unwrap_or(false)
}

fn field(frame: &VarDictionary, key: &str) -> Option<Variant> {
    frame.get(&key.to_variant())
}

fn dot3(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn direction_of_world(x: f64, y: f64) -> [f64; 3] {
    let lon = (x / WORLD * 360.0 - 180.0).to_radians();
    let lat = (std::f64::consts::PI * (1.0 - 2.0 * y / WORLD)).sinh().atan().to_degrees().to_radians();
    let scale = lat.cos();
    [(lon.sin() * scale) as f32 as f64, lat.sin() as f32 as f64, (lon.cos() * scale) as f32 as f64]
}

fn facing(direction: [f64; 3], pos: [f64; 3]) -> bool {
    let d = [direction[0] as f32, direction[1] as f32, direction[2] as f32];
    let p = [pos[0] as f32, pos[1] as f32, pos[2] as f32];
    d[0] * p[0] + d[1] * p[1] + d[2] * p[2] >= 1.0
}

fn round_half_away(value: f64) -> f64 {
    value.round()
}

impl TerrainProjector {
    fn sample_level(&self, level: usize, x: f64, y: f64) -> f64 {
        let Some(Some(spec)) = self.levels.get(level) else {
            return 0.0;
        };
        let data = spec.data.as_slice();
        let (width, height) = spec.size;
        if width <= 0 || height <= 0 || data.len() < (width * height) as usize {
            return 0.0;
        }
        let texel = spec.rect[2] / width as f64;
        let px = (x - spec.rect[0]) / texel;
        let py = (y - spec.rect[1]) / texel;
        let ix = px.floor();
        let iy = py.floor();
        let fx = px - ix;
        let fy = py - iy;
        let ix = ix as i64;
        let iy = iy as i64;
        let x0 = ix.clamp(0, width - 1);
        let x1 = (ix + 1).clamp(0, width - 1);
        let y0 = iy.clamp(0, height - 1);
        let y1 = (iy + 1).clamp(0, height - 1);
        let at = |cx: i64, cy: i64| data[(cy * width + cx) as usize] as f64;
        let top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * fx;
        let bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * fx;
        top + (bottom - top) * fy
    }

    fn elevation(&self, x: f64, y: f64) -> f64 {
        if !self.has_data || self.lod_size.0 <= 0 {
            return 0.0;
        }
        let [rx, ry, rw, _] = self.lod_rect;
        let mut px = x;
        let mut cell_x = ((px - rx) / self.lod_cell).floor() as i64;
        if cell_x < 0 || cell_x >= self.lod_size.0 {
            let turned = px + WORLD * round_half_away((rx + rw * 0.5 - px) / WORLD);
            cell_x = ((turned - rx) / self.lod_cell).floor() as i64;
            px = turned as f32 as f64;
        }
        let cell_y = ((y - ry) / self.lod_cell).floor() as i64;
        if cell_x < 0 || cell_y < 0 || cell_x >= self.lod_size.0 || cell_y >= self.lod_size.1 {
            return 0.0;
        }
        let lod = self.lod_data.as_slice();
        let index = (cell_y * self.lod_size.0 + cell_x) as usize;
        if index >= lod.len() {
            return 0.0;
        }
        let level = lod[index] as usize;
        if level >= LEVELS {
            return 0.0;
        }
        self.sample_level(level, px, y) * self.exaggeration
    }

    fn height(&self, x: f64, y: f64) -> f64 {
        if !self.frame.relief {
            return 0.0;
        }
        let near = x + WORLD * round_half_away((self.frame.cam_world.0 - x) / WORLD);
        self.elevation(near as f32 as f64, y)
    }

    fn lift(&self, height: f64) -> f64 {
        (height - self.frame.centre_h) * self.frame.per_meter
    }

    fn flat_clip(&self, x: f64, y: f64, lift: f64) -> [f64; 3] {
        let f = &self.frame;
        let mut dx = x - f.cam_world.0;
        let dy = y - f.cam_world.1;
        dx -= WORLD * round_half_away(dx / WORLD);
        let dx = dx * f.px_per_world;
        let dy = dy * f.px_per_world;
        let a = dx * f.flat_right.0 + dy * f.flat_right.1;
        let v = dx * f.flat_up.0 + dy * f.flat_up.1;
        [a, v * f.cos_p + lift * f.sin_p, f.focal + v * f.sin_p - lift * f.cos_p]
    }

    fn globe_clip(&self, x: f64, y: f64, height: f64) -> [f64; 3] {
        let f = &self.frame;
        let d = direction_of_world(x, y);
        let lifted = 1.0 + height / EARTH_RADIUS_M;
        let q = [d[0] * lifted - f.pos[0], d[1] * lifted - f.pos[1], d[2] * lifted - f.pos[2]];
        [dot3(q, f.right) * f.radius, dot3(q, f.up) * f.radius, dot3(q, f.fwd) * f.radius]
    }

    fn lifted_clip(&self, x: f64, y: f64, height: f64) -> [f64; 3] {
        let g = self.frame.g;
        let mut clip = self.flat_clip(x, y, self.lift(height));
        if g > 0.0 {
            let globe = self.globe_clip(x, y, height);
            for axis in 0..3 {
                clip[axis] += (globe[axis] - clip[axis]) * g;
            }
        }
        clip
    }

    fn world_clip(&self, x: f64, y: f64) -> [f64; 3] {
        let g = self.frame.g;
        let mut clip = self.flat_clip(x, y, 0.0);
        if g > 0.0 {
            let globe = self.globe_clip(x, y, 0.0);
            for axis in 0..3 {
                clip[axis] += (globe[axis] - clip[axis]) * g;
            }
        }
        clip
    }

    fn screen_of(&self, clip: [f64; 3]) -> Vector2 {
        if clip[2] <= 0.0 {
            return Vector2::new(HIDDEN, HIDDEN);
        }
        let f = &self.frame;
        Vector2::new((f.size.0 * 0.5 + f.focal * clip[0] / clip[2]) as f32, (f.size.1 * 0.5 - f.focal * clip[1] / clip[2]) as f32)
    }

    fn project(&self, x: f64, y: f64) -> Vector2 {
        let f = &self.frame;
        if f.g > 0.0 && !facing(direction_of_world(x, y), f.pos) {
            return Vector2::new(HIDDEN, HIDDEN);
        }
        if f.relief {
            return self.screen_of(self.lifted_clip(x, y, self.height(x, y)));
        }
        self.screen_of(self.world_clip(x, y))
    }

    fn depth(&self, x: f64, y: f64) -> f64 {
        let f = &self.frame;
        let clip = if f.relief { self.lifted_clip(x, y, self.height(x, y)) } else { self.world_clip(x, y) };
        clip[2].max(1e-3) / f.focal
    }

    fn ndc_depth(&self, depth: f64) -> f64 {
        let near = self.frame.near;
        let far = self.frame.far;
        (far + near) / (far - near) - 2.0 * far * near / ((far - near) * depth.max(0.000001))
    }

    fn ray_ground(&self, sx: f64, sy: f64, t: f64) -> (f64, f64) {
        let f = &self.frame;
        let a = t * sx;
        let v = t * (sy * f.cos_p + f.focal * f.sin_p) - f.focal * f.sin_p;
        (
            (f.cam_world.0 + (f.flat_right.0 * a + f.flat_up.0 * v) / f.px_per_world) as f32 as f64,
            (f.cam_world.1 + (f.flat_right.1 * a + f.flat_up.1 * v) / f.px_per_world) as f32 as f64,
        )
    }

    fn ground_gap(&self, sx: f64, sy: f64, t: f64) -> f64 {
        let f = &self.frame;
        let lift = t * (sy * f.sin_p - f.focal * f.cos_p) + f.focal * f.cos_p;
        let (gx, gy) = self.ray_ground(sx, sy, t);
        lift - self.lift(self.elevation(gx, gy))
    }

    fn depth_opacity(&self, screen: (f64, f64), depth: f64, distance: f64) -> f64 {
        let f = &self.frame;
        let sx = screen.0 - f.size.0 * 0.5;
        let sy = f.size.1 * 0.5 - screen.1;
        let denominator = f.focal * f.cos_p - sy * f.sin_p;
        if denominator <= 1e-3 {
            return 1.0;
        }
        let t0 = ((f.focal * f.cos_p - f.lift_high) / denominator).max(0.0);
        let t1 = ((f.focal * f.cos_p - f.lift_low) / denominator).min(distance / f.focal);
        if t1 <= t0 {
            return 1.0;
        }
        let a = self.ray_ground(sx, sy, t0);
        let b = self.ray_ground(sx, sy, t1);
        let span = ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt() / self.step.max(1e-6);
        let steps = (span.ceil() as i64).clamp(1, 64);
        let mut before_t = t0;
        let mut before_f = self.ground_gap(sx, sy, t0);
        let mut hit = -1.0;
        if before_f <= 0.0 {
            hit = t0;
        } else {
            for index in 1..=steps {
                let t = t0 + (t1 - t0) * (index as f64 / steps as f64);
                let gap = self.ground_gap(sx, sy, t);
                if gap <= 0.0 {
                    let mut lo = before_t;
                    let mut hi = t;
                    let mut f_lo = before_f;
                    let mut f_hi = gap;
                    for _ in 0..5 {
                        let mid = (lo + hi) * 0.5;
                        let f_mid = self.ground_gap(sx, sy, mid);
                        if f_mid > 0.0 {
                            lo = mid;
                            f_lo = f_mid;
                        } else {
                            hi = mid;
                            f_hi = f_mid;
                        }
                    }
                    hit = lo + (hi - lo) * (f_lo / (f_lo - f_hi).max(1e-6)).clamp(0.0, 1.0);
                    break;
                }
                before_t = t;
                before_f = gap;
            }
        }
        if hit < 0.0 {
            return 1.0;
        }
        let gap = self.ndc_depth(hit * f.focal) + 0.0001 - depth;
        1.0 - (-gap * 500.0).clamp(0.0, 1.0)
    }

    fn visibility(&self, x: f64, y: f64) -> f64 {
        let f = &self.frame;
        if !f.relief || f.g > 0.0 {
            return 1.0;
        }
        let clip = self.lifted_clip(x, y, self.height(x, y));
        if clip[2] <= 0.0 {
            return 1.0;
        }
        let screen = (f.size.0 * 0.5 + f.focal * clip[0] / clip[2], f.size.1 * 0.5 - f.focal * clip[1] / clip[2]);
        let screen = (screen.0 as f32 as f64, screen.1 as f32 as f64);
        let depth = self.ndc_depth(clip[2]);
        let seen = self.depth_opacity(screen, depth, clip[2]);
        if seen > 0.95 {
            return 1.0;
        }
        (seen + self.depth_opacity((screen.0, (screen.1 - 0.005 * f.size.1) as f32 as f64), depth, clip[2])) * 0.5
    }
}

#[godot_api]
impl TerrainProjector {
    #[func]
    #[allow(clippy::too_many_arguments)]
    fn set_relief(&mut self, has_data: bool, lod_rect: Rect2, lod_cell: f64, lod_size: Vector2i, lod_data: PackedByteArray, level_rects: Array<Rect2>, level_sizes: Array<Vector2i>, level_data: Array<PackedFloat32Array>, step: f64, exaggeration: f64) {
        self.has_data = has_data;
        self.lod_rect = [lod_rect.position.x as f64, lod_rect.position.y as f64, lod_rect.size.x as f64, lod_rect.size.y as f64];
        self.lod_cell = lod_cell;
        self.lod_size = (lod_size.x as i64, lod_size.y as i64);
        self.lod_data = lod_data;
        self.step = step;
        self.exaggeration = exaggeration;
        self.levels.clear();
        for level in 0..LEVELS {
            let rect = level_rects.get(level);
            let size = level_sizes.get(level);
            let data = level_data.get(level);
            match (rect, size, data) {
                (Some(rect), Some(size), Some(data)) => self.levels.push(Some(Level {
                    rect: [rect.position.x as f64, rect.position.y as f64, rect.size.x as f64, rect.size.y as f64],
                    size: (size.x as i64, size.y as i64),
                    data,
                })),
                _ => self.levels.push(None),
            }
        }
    }

    #[func]
    fn set_frame(&mut self, frame: VarDictionary, planes: Vector2) {
        let pitch = number(field(&frame, "pitch"));
        self.frame = Frame {
            ready: true,
            relief: flag(field(&frame, "relief")),
            size: vec2(field(&frame, "size")),
            cam_world: vec2(field(&frame, "cam_world")),
            px_per_world: number(field(&frame, "px_per_world")),
            flat_right: vec2(field(&frame, "flat_right")),
            flat_up: vec2(field(&frame, "flat_up")),
            sin_p: pitch.sin(),
            cos_p: pitch.cos(),
            focal: number(field(&frame, "focal")),
            g: number(field(&frame, "g")),
            pos: vec3(field(&frame, "pos")),
            right: vec3(field(&frame, "right")),
            up: vec3(field(&frame, "up")),
            fwd: vec3(field(&frame, "fwd")),
            radius: number(field(&frame, "radius")),
            per_meter: number(field(&frame, "ppm")),
            centre_h: number(field(&frame, "centre_h")),
            lift_low: number(field(&frame, "lift_low")),
            lift_high: number(field(&frame, "lift_high")),
            near: planes.x as f64,
            far: planes.y as f64,
        };
    }

    #[func]
    fn is_ready(&self) -> bool {
        self.frame.ready
    }

    #[func]
    fn elevation_at(&self, point: Vector2) -> f64 {
        self.elevation(point.x as f64, point.y as f64)
    }

    #[func]
    fn height_at(&self, point: Vector2) -> f64 {
        self.height(point.x as f64, point.y as f64)
    }

    #[func]
    fn world_to_screen(&self, point: Vector2) -> Vector2 {
        self.project(point.x as f64, point.y as f64)
    }

    #[func]
    fn world_to_screen_at(&self, point: Vector2, height: f64) -> Vector2 {
        self.screen_of(self.lifted_clip(point.x as f64, point.y as f64, height))
    }

    #[func]
    fn depth_at(&self, point: Vector2) -> f64 {
        self.depth(point.x as f64, point.y as f64)
    }

    #[func]
    fn anchor_visibility(&self, point: Vector2) -> f64 {
        self.visibility(point.x as f64, point.y as f64)
    }

    #[func]
    fn frame_at(&self, point: Vector2) -> Transform2D {
        let (x, y) = (point.x as f64, point.y as f64);
        let origin = self.project(x, y);
        let step = 1.0 / self.frame.px_per_world;
        let sx = (x + step) as f32 as f64;
        let sy = (y + step) as f32 as f64;
        if self.frame.relief {
            let height = self.height(x, y);
            let base = self.screen_of(self.lifted_clip(x, y, height));
            let along_x = self.screen_of(self.lifted_clip(sx, y, height)) - base;
            let along_y = self.screen_of(self.lifted_clip(x, sy, height)) - base;
            return Transform2D::from_cols(along_x, along_y, origin);
        }
        let base = self.screen_of(self.world_clip(x, y));
        let along_x = self.screen_of(self.world_clip(sx, y)) - base;
        let along_y = self.screen_of(self.world_clip(x, sy)) - base;
        Transform2D::from_cols(along_x, along_y, origin)
    }

    #[func]
    fn world_to_screen_many(&self, points: PackedVector2Array) -> PackedVector2Array {
        points.as_slice().iter().map(|p| self.project(p.x as f64, p.y as f64)).collect()
    }

    #[func]
    fn depth_many(&self, points: PackedVector2Array) -> PackedFloat64Array {
        points.as_slice().iter().map(|p| self.depth(p.x as f64, p.y as f64)).collect()
    }

    #[func]
    fn visible_directions(&self, directions: PackedVector3Array, distance: f64) -> PackedVector3Array {
        let f = &self.frame;
        let pos = [f.pos[0] as f32, f.pos[1] as f32, f.pos[2] as f32];
        let right = [f.right[0] as f32, f.right[1] as f32, f.right[2] as f32];
        let up = [f.up[0] as f32, f.up[1] as f32, f.up[2] as f32];
        let fwd = [f.fwd[0] as f32, f.fwd[1] as f32, f.fwd[2] as f32];
        let scale = distance as f32;
        let dot = |a: [f32; 3], b: [f32; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        let mut out = PackedVector3Array::new();
        for (index, d) in directions.as_slice().iter().enumerate() {
            let q = [d.x * scale - pos[0], d.y * scale - pos[1], d.z * scale - pos[2]];
            let z = dot(q, fwd) as f64;
            if z <= 0.0 {
                continue;
            }
            let x = (f.size.0 * 0.5 + f.focal * dot(q, right) as f64 / z) as f32 as f64;
            let y = (f.size.1 * 0.5 - f.focal * dot(q, up) as f64 / z) as f32 as f64;
            let ndc_x = x / f.size.0 * 2.0 - 1.0;
            let ndc_y = 1.0 - y / f.size.1 * 2.0;
            if ndc_x.abs() > 4.0 || ndc_y.abs() > 4.0 {
                continue;
            }
            if x < -4.0 || x > f.size.0 + 4.0 || y < -4.0 || y > f.size.1 + 4.0 {
                continue;
            }
            out.push(Vector3::new(x as f32, y as f32, index as f32));
        }
        out
    }

    #[func]
    fn visibility_many(&self, points: PackedVector2Array) -> PackedFloat64Array {
        points.as_slice().iter().map(|p| self.visibility(p.x as f64, p.y as f64)).collect()
    }
}
