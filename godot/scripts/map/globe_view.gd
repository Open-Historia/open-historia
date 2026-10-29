class_name GlobeView
extends Node

const FOV := 0.6435011087932844
const TAN_HALF := 0.33333333333333337
const MAX_VALID_LATITUDE := 85.051129
const MERCATOR_LIMIT := 85.0511287798066
const MIN_ZOOM_LEVEL := 2.25
const ROTATION_DEG_PER_MS := 360.0 / (10.0 * 60.0 * 1000.0)
const INTERACTION_GRACE_MS := 3000
const IDLE_ROTATE_FRAME_MS := 1000.0 / 15.0
const LIVE_SUN_REFRESH_MS := 60000
const CELESTIAL_RADIUS := 64.0
const STAR_COUNT := 1800
const FLAT_TEXTURE_LIMIT := 2560
const FLAT_TEXTURE_STEP := 128
const REFINED_RENDER_PIXELS := 180000.0
const INTERACTIVE_RENDER_PIXELS := 48000.0
const EARTH_RADIUS_M := 6371008.8
const MAX_TERRAIN_ELEVATION_M := 8849.0
const TERRAIN_EXAGGERATION := 15.0
const MAP_LAYER_BIT := 2
const LIGHT_LAYER := 3
const FLAT_TEXTURE_SCALE := 1.75
const LAT_MARGIN := 0.03
const NEAR_PITCH_DEG := 20.0
const NEAR_SPLIT := 0.3
const FLAT_SPACE := Color(11 / 255.0, 16 / 255.0, 23 / 255.0)
const SKY_HORIZON_BLEND := 0.8
const MAX_MERCATOR_HORIZON_ANGLE := 89.25
const FLAT_TILT_DEG := 0.5
const FLAT_HEADROOM := 1.08
const FLAT_SHRINK_SLACK := 384
const FLAT_SHRINK_MS := 1500

const SPHERE_SHADER := """
shader_type canvas_item;
render_mode unshaded, blend_mix;
uniform sampler2D flat_map : filter_linear, repeat_disable;
uniform sampler2D near_map : filter_linear, repeat_disable;
uniform vec2 screen_size = vec2(1440.0, 900.0);
uniform vec3 cam_pos = vec3(0.0, 0.0, 4.0);
uniform vec3 cam_right = vec3(1.0, 0.0, 0.0);
uniform vec3 cam_up = vec3(0.0, 1.0, 0.0);
uniform vec3 cam_fwd = vec3(0.0, 0.0, -1.0);
uniform float focal = 1350.0;
uniform vec2 flat_right = vec2(1.0, 0.0);
uniform vec2 flat_up = vec2(0.0, -1.0);
uniform float pitch_sin = 0.0;
uniform float pitch_cos = 1.0;
uniform float globeness = 1.0;
uniform vec4 flat_rect = vec4(0.0, 0.0, 4096.0, 4096.0);
uniform vec4 near_rect = vec4(0.0, 0.0, 0.0, 0.0);
uniform bool use_near = false;
uniform vec2 cam_world = vec2(2048.0, 2048.0);
uniform float px_per_world = 1.0;
uniform float radius_px = 400.0;
uniform float texel_world = 1.0;
uniform float near_texel_world = 1.0;
uniform float world_width = 4096.0;
uniform bool clamp_poles = true;
uniform bool wrap_world = true;
uniform vec3 sky_color = vec3(0.533333, 0.776471, 0.988235);
uniform vec3 horizon_color = vec3(1.0, 1.0, 1.0);
uniform float horizon_y = -100000.0;
uniform float sky_horizon_px = 360.0;
uniform bool relief_on = false;
uniform sampler2D dem_0 : filter_linear, repeat_disable;
uniform sampler2D dem_1 : filter_linear, repeat_disable;
uniform sampler2D dem_2 : filter_linear, repeat_disable;
uniform sampler2D dem_3 : filter_linear, repeat_disable;
uniform sampler2D dem_4 : filter_linear, repeat_disable;
uniform sampler2D dem_5 : filter_linear, repeat_disable;
uniform vec4 dem_rect[6];
uniform sampler2D lod_map : filter_nearest, repeat_disable;
uniform vec4 lod_rect = vec4(0.0, 0.0, 1.0, 0.0);
uniform ivec2 lod_size = ivec2(0, 0);
uniform float relief_scale = 15.0;
uniform float relief_low = 0.0;
uniform float relief_high = 0.0;
uniform float relief_step = 1.0;
uniform float centre_elevation = 0.0;
uniform float px_per_meter = 0.0;

const float PI_F = 3.14159265358979;
const float MERC_LIMIT = 85.0511287798066;
const float EARTH_R = 6371008.8;

float dem_at(sampler2D dem, vec4 rect, vec2 w) {
	vec2 size = vec2(textureSize(dem, 0));
	return textureLod(dem, ((w - rect.xy) / rect.z + 0.5) / size, 0.0).r;
}

float relief_at(vec2 w) {
	vec2 local = (w - lod_rect.xy) / lod_rect.z;
	if (local.x < 0.0 || local.x >= float(lod_size.x)) {
		float middle = lod_rect.x + float(lod_size.x) * lod_rect.z * 0.5;
		w.x += world_width * floor((middle - w.x) / world_width + 0.5);
		local = (w - lod_rect.xy) / lod_rect.z;
	}
	if (local.x < 0.0 || local.y < 0.0 || local.x >= float(lod_size.x) || local.y >= float(lod_size.y)) {
		return 0.0;
	}
	int level = int(texelFetch(lod_map, ivec2(local), 0).r * 255.0 + 0.5);
	float e = 0.0;
	if (level == 0) {
		e = dem_at(dem_0, dem_rect[0], w);
	} else if (level == 1) {
		e = dem_at(dem_1, dem_rect[1], w);
	} else if (level == 2) {
		e = dem_at(dem_2, dem_rect[2], w);
	} else if (level == 3) {
		e = dem_at(dem_3, dem_rect[3], w);
	} else if (level == 4) {
		e = dem_at(dem_4, dem_rect[4], w);
	} else if (level == 5) {
		e = dem_at(dem_5, dem_rect[5], w);
	}
	return e * relief_scale;
}

vec2 world_of(vec3 p) {
	float lon = atan(p.x, p.z);
	float lat = asin(clamp(p.y, -1.0, 1.0));
	float clamped = clamp(lat, -MERC_LIMIT * PI_F / 180.0, MERC_LIMIT * PI_F / 180.0);
	float x = (lon / (2.0 * PI_F) + 0.5) * world_width;
	float y = (0.5 - log(tan(PI_F / 4.0 + clamped / 2.0)) / (2.0 * PI_F)) * world_width;
	return vec2(x, y);
}

vec3 dir_of_world(vec2 w) {
	float lon = (w.x / world_width - 0.5) * 2.0 * PI_F;
	float lat = atan(sinh(PI_F * (1.0 - 2.0 * w.y / world_width)));
	float c = cos(lat);
	return vec3(sin(lon) * c, sin(lat), cos(lon) * c);
}

vec2 rect_uv(vec2 w, vec4 rect, float texel) {
	float shift = world_width * floor((rect.x + rect.z * 0.5 - w.x) / world_width + 0.5);
	w.x += shift;
	float edge = texel * 1.5;
	float y = clamp_poles ? clamp(w.y, edge, world_width - edge) : w.y;
	return vec2((w.x - rect.x) / rect.z, (y - rect.y) / rect.w);
}

vec3 sample_map(vec2 w) {
	if (use_near) {
		vec2 near_uv = rect_uv(w, near_rect, near_texel_world);
		if (near_uv.x > 0.002 && near_uv.x < 0.998 && near_uv.y > 0.002 && near_uv.y < 0.998) {
			return texture(near_map, near_uv).rgb;
		}
	}
	return texture(flat_map, rect_uv(w, flat_rect, texel_world)).rgb;
}

vec2 wrapped_delta(vec2 w) {
	vec2 d = w - cam_world;
	d.x -= world_width * floor(d.x / world_width + 0.5);
	return d * px_per_world;
}

vec3 flat_camera(vec2 w) {
	vec2 d = wrapped_delta(w);
	float a = dot(d, flat_right);
	float v = dot(d, flat_up);
	return vec3(a, v * pitch_cos, focal + v * pitch_sin);
}

vec3 globe_camera(vec2 w) {
	vec3 q = dir_of_world(w) - cam_pos;
	return vec3(dot(q, cam_right), dot(q, cam_up), dot(q, cam_fwd)) * radius_px;
}

vec2 project_mix(vec2 w) {
	vec3 c = mix(flat_camera(w), globe_camera(w), globeness);
	return vec2(screen_size.x * 0.5 + focal * c.x / c.z, screen_size.y * 0.5 - focal * c.y / c.z);
}

vec2 flat_unproject(vec2 px) {
	float sx = px.x - screen_size.x * 0.5;
	float sy = screen_size.y * 0.5 - px.y;
	float denominator = max(focal * pitch_cos - sy * pitch_sin, 1e-3);
	float v = sy * focal / denominator;
	float a = sx * (focal + v * pitch_sin) / focal;
	return cam_world + (flat_right * a + flat_up * v) / px_per_world;
}

vec2 newton_step(vec2 w, vec2 error) {
	vec2 d = wrapped_delta(w);
	float a = dot(d, flat_right);
	float v = dot(d, flat_up);
	float z = focal + v * pitch_sin;
	float dv = -error.y * z * z / (focal * focal * max(pitch_cos, 1e-3));
	float da = (error.x + focal * a * pitch_sin / (z * z) * dv) * z / focal;
	return (flat_right * da + flat_up * dv) / px_per_world;
}

vec2 ray_ground(vec2 px, float t) {
	float sx = px.x - screen_size.x * 0.5;
	float sy = screen_size.y * 0.5 - px.y;
	float a = t * sx;
	float v = t * (sy * pitch_cos + focal * pitch_sin) - focal * pitch_sin;
	return cam_world + (flat_right * a + flat_up * v) / px_per_world;
}

float ray_lift(vec2 px, float t) {
	float sy = screen_size.y * 0.5 - px.y;
	return t * (sy * pitch_sin - focal * pitch_cos) + focal * pitch_cos;
}

float ground_gap(vec2 px, float t) {
	return ray_lift(px, t) - (relief_at(ray_ground(px, t)) - centre_elevation) * px_per_meter;
}

bool relief_flat(vec2 px, out vec2 hit) {
	hit = vec2(0.0);
	float sy = screen_size.y * 0.5 - px.y;
	float denominator = focal * pitch_cos - sy * pitch_sin;
	if (denominator <= 1e-3) {
		return false;
	}
	float top = (relief_high - centre_elevation) * px_per_meter;
	float bottom = (relief_low - centre_elevation) * px_per_meter;
	float t0 = max((focal * pitch_cos - top) / denominator, 0.0);
	float t1 = (focal * pitch_cos - bottom) / denominator;
	if (t1 <= t0) {
		hit = ray_ground(px, t1);
		return true;
	}
	float span = distance(ray_ground(px, t0), ray_ground(px, t1)) / max(relief_step, 1e-6);
	int steps = int(clamp(ceil(span), 1.0, 64.0));
	float before_t = t0;
	float before_f = ground_gap(px, t0);
	if (before_f <= 0.0) {
		hit = ray_ground(px, t0);
		return true;
	}
	for (int i = 1; i <= 64; i++) {
		if (i > steps) {
			break;
		}
		float t = mix(t0, t1, float(i) / float(steps));
		float f = ground_gap(px, t);
		if (f <= 0.0) {
			float lo = before_t;
			float hi = t;
			float f_lo = before_f;
			float f_hi = f;
			for (int k = 0; k < 5; k++) {
				float mid = (lo + hi) * 0.5;
				float f_mid = ground_gap(px, mid);
				if (f_mid > 0.0) {
					lo = mid;
					f_lo = f_mid;
				} else {
					hi = mid;
					f_hi = f_mid;
				}
			}
			hit = ray_ground(px, lo + (hi - lo) * clamp(f_lo / max(f_lo - f_hi, 1e-6), 0.0, 1.0));
			return true;
		}
		before_t = t;
		before_f = f;
	}
	hit = ray_ground(px, t1);
	return true;
}

vec2 near_world(vec2 w) {
	w.x += world_width * floor((cam_world.x - w.x) / world_width + 0.5);
	return w;
}

float shell_gap(vec3 p) {
	return length(p) - 1.0 - relief_at(near_world(world_of(normalize(p)))) / EARTH_R;
}

bool relief_globe(vec3 origin, vec3 dir, out vec3 point) {
	point = vec3(0.0);
	float outer = 1.0 + max(relief_high, 0.0) / EARTH_R;
	float inner = 1.0 + min(relief_low, 0.0) / EARTH_R;
	float b = dot(origin, dir);
	float c_out = dot(origin, origin) - outer * outer;
	float disc_out = b * b - c_out;
	if (disc_out < 0.0) {
		return false;
	}
	float root = sqrt(disc_out);
	float t0 = max(-b - root, 0.0);
	float t1 = -b + root;
	float c_in = dot(origin, origin) - inner * inner;
	float disc_in = b * b - c_in;
	if (disc_in >= 0.0 && -b - sqrt(disc_in) > t0) {
		t1 = -b - sqrt(disc_in);
	}
	if (t1 <= t0) {
		return false;
	}
	float angle = acos(clamp(dot(normalize(origin + dir * t0), normalize(origin + dir * t1)), -1.0, 1.0));
	float texel_angle = max(relief_step, 1e-6) / world_width * 2.0 * PI_F;
	int steps = int(clamp(ceil(angle / texel_angle), 1.0, 48.0));
	float before_t = t0;
	float before_f = shell_gap(origin + dir * t0);
	if (before_f <= 0.0) {
		point = origin + dir * t0;
		return true;
	}
	for (int i = 1; i <= 48; i++) {
		if (i > steps) {
			break;
		}
		float t = mix(t0, t1, float(i) / float(steps));
		float f = shell_gap(origin + dir * t);
		if (f <= 0.0) {
			float lo = before_t;
			float hi = t;
			float f_lo = before_f;
			float f_hi = f;
			for (int k = 0; k < 5; k++) {
				float mid = (lo + hi) * 0.5;
				float f_mid = shell_gap(origin + dir * mid);
				if (f_mid > 0.0) {
					lo = mid;
					f_lo = f_mid;
				} else {
					hi = mid;
					f_hi = f_mid;
				}
			}
			point = origin + dir * (lo + (hi - lo) * clamp(f_lo / max(f_lo - f_hi, 1e-9), 0.0, 1.0));
			return true;
		}
		before_t = t;
		before_f = f;
	}
	return false;
}

vec2 project_mix_relief(vec2 w) {
	float e = relief_at(w);
	float lift = (e - centre_elevation) * px_per_meter;
	vec2 d = wrapped_delta(w);
	float a = dot(d, flat_right);
	float v = dot(d, flat_up);
	vec3 flat_c = vec3(a, v * pitch_cos + lift * pitch_sin, focal + v * pitch_sin - lift * pitch_cos);
	vec3 q = dir_of_world(w) * (1.0 + e / EARTH_R) - cam_pos;
	vec3 globe_c = vec3(dot(q, cam_right), dot(q, cam_up), dot(q, cam_fwd)) * radius_px;
	vec3 c = mix(flat_c, globe_c, globeness);
	return vec2(screen_size.x * 0.5 + focal * c.x / c.z, screen_size.y * 0.5 - focal * c.y / c.z);
}

void fragment() {
	vec2 px = UV * screen_size;
	vec3 dir = normalize(cam_fwd * focal + cam_right * (px.x - screen_size.x * 0.5) + cam_up * (screen_size.y * 0.5 - px.y));
	vec3 origin = cam_pos;
	float b = dot(origin, dir);
	vec3 inner = origin - dir * b;
	float disc_rtg = 1.0 - dot(inner, inner);
	bool hit = disc_rtg >= 0.0 && b < 0.0;
	vec4 base = vec4(0.0);
	if (globeness >= 0.999) {
		if (relief_on) {
			vec3 lifted;
			if (relief_globe(origin, dir, lifted)) {
				base = vec4(sample_map(world_of(normalize(lifted))), 1.0);
			}
		} else if (hit) {
			float c_term = dot(origin, origin) - 1.0;
			float q = -b + sqrt(disc_rtg);
			float t = min(c_term / q, q);
			vec3 p = normalize(origin + dir * t);
			base = vec4(sample_map(world_of(p)), 1.0);
		}
	} else {
		vec2 w = flat_unproject(px);
		if (relief_on) {
			vec2 lifted;
			if (relief_flat(px, lifted)) {
				w = lifted;
			}
		}
		if (globeness > 0.001) {
			if (hit) {
				float c_term = dot(origin, origin) - 1.0;
				float q = -b + sqrt(disc_rtg);
				float t = min(c_term / q, q);
				vec2 g = world_of(normalize(origin + dir * t));
				g.x += world_width * floor((w.x - g.x) / world_width + 0.5);
				w = mix(w, g, globeness);
			}
			for (int i = 0; i < 4; i++) {
				vec2 s = relief_on ? project_mix_relief(w) : project_mix(w);
				w += newton_step(w, px - s);
			}
		}
		bool outside = !clamp_poles && (w.y < 0.0 || w.y > world_width || (!wrap_world && (w.x < 0.0 || w.x > world_width)));
		base = outside ? vec4(0.0) : vec4(sample_map(w), 1.0);
		float above = horizon_y - px.y;
		if (above > 0.0) {
			vec3 sky = above < sky_horizon_px ? mix(sky_color, horizon_color, pow(1.0 - above / sky_horizon_px, 2.0)) : sky_color;
			base = vec4(sky, 1.0 - globeness);
		}
	}
	COLOR = base;
}
"""

const LIGHT_SHADER := """
shader_type canvas_item;
render_mode unshaded, blend_mix;
uniform vec2 screen_size = vec2(1440.0, 900.0);
uniform vec3 cam_pos = vec3(0.0, 0.0, 4.0);
uniform vec3 cam_right = vec3(1.0, 0.0, 0.0);
uniform vec3 cam_up = vec3(0.0, 1.0, 0.0);
uniform vec3 cam_fwd = vec3(0.0, 0.0, -1.0);
uniform float focal = 1350.0;
uniform float overlay = 1.0;
uniform vec3 sun_dir = vec3(0.0, 0.0, 1.0);
uniform float render_pixel = 1.0;
uniform float terrain_radii = 0.0;

void fragment() {
	vec2 px = UV * screen_size;
	vec3 dir = normalize(cam_fwd * focal + cam_right * (px.x - screen_size.x * 0.5) + cam_up * (screen_size.y * 0.5 - px.y));
	vec3 origin = cam_pos;
	vec4 light = vec4(0.0);
	if (overlay > 0.0) {
		float camera_term = dot(origin, origin) - 1.0;
		float pixel_angle = render_pixel / focal;
		float gap_per_pixel = 2.0 * sqrt(max(0.0, camera_term)) * pixel_angle;
		float terrain_gap = (gap_per_pixel > 0.0 && terrain_radii > 0.0) ? min(terrain_radii * (2.0 + terrain_radii), camera_term * 0.5) : 0.0;
		float tint_fade_gap = gap_per_pixel * 0.75;
		float plateau_gap = terrain_gap + gap_per_pixel * 1.1;
		float fade_gap = plateau_gap + gap_per_pixel * 0.6;
		float cam_dot = dot(origin, dir);
		float discriminant = cam_dot * cam_dot - camera_term;
		vec3 normal = vec3(0.0);
		float coverage = 0.0;
		float tint_coverage = 0.0;
		bool lit = false;
		if (discriminant >= 0.0) {
			float distance = -cam_dot - sqrt(discriminant);
			if (distance > 0.0) {
				normal = origin + dir * distance;
				coverage = 1.0;
				tint_coverage = 1.0;
				lit = true;
			}
		} else {
			float gap = discriminant;
			float approach = -cam_dot;
			if (gap > -fade_gap && approach > 0.0) {
				vec3 near_point = origin + dir * approach;
				float near_length = length(near_point);
				if (near_length > 0.0) {
					normal = near_point / near_length;
					coverage = smoothstep(-fade_gap, -plateau_gap, gap);
					tint_coverage = smoothstep(-tint_fade_gap, 0.0, gap);
					lit = coverage > 0.0;
				}
			}
		}
		if (lit) {
			float sun_dot = dot(normal, sun_dir);
			float night = 1.0 - smoothstep(-0.1, 0.08, sun_dot);
			float dusk = smoothstep(-0.18, -0.02, sun_dot) * (1.0 - smoothstep(0.03, 0.2, sun_dot));
			float daylight = smoothstep(0.05, 0.9, sun_dot);
			float night_alpha = night * 0.72;
			float dusk_alpha = dusk * 0.12;
			float day_alpha = daylight * 0.045;
			float weight = night_alpha + dusk_alpha + day_alpha;
			if (weight >= 0.002) {
				float alpha = min(0.76, weight) * overlay * coverage;
				float tint = tint_coverage / weight;
				vec3 rgb = vec3(
					3.0 * night_alpha + 240.0 * dusk_alpha + 255.0 * day_alpha,
					7.0 * night_alpha + 83.0 * dusk_alpha + 178.0 * day_alpha,
					24.0 * night_alpha + 35.0 * dusk_alpha + 95.0 * day_alpha) * tint / 255.0;
				light = vec4(clamp(rgb, 0.0, 1.0), alpha);
			}
		}
	}
	COLOR = light;
}
"""

var extras: Node
var map_view: MapView
var labels: GlobeLabels
var enabled := false
var active := false
var idle_rotation_disabled := false
var rotation_paused := false
var terrain_on := false:
	set(value):
		if terrain_on == value:
			return
		terrain_on = value
		_terrain_changed()
var relief: TerrainRelief
var _relief_dirty := false
var _elevation := 0.0
var _elevation_frozen := false
var _terrain_movement := false
var _ease_centre: Variant = null
var _ease_start := 0.0
var _ease_target := 0.0
var _ease_freeze := false
var _flat_viewport: SubViewport
var _flat_camera: Camera2D
var _layer: CanvasLayer
var _light_layer: CanvasLayer
var _space: ColorRect
var _stars: StarField
var _sun: TextureRect
var _sphere: ColorRect
var _light: ColorRect
var _material: ShaderMaterial
var _light_material: ShaderMaterial
var _last_interaction := -100000
var _last_rotate := 0
var _sun_lonlat := Vector2.ZERO
var _sun_dir := Vector3(0, 0, 1)
var _sun_refreshed := -100000
var _frame := {}
var _flat := {}
var _flat_size := Vector2i.ZERO
var held := false
var _saved_cull_mask := -1
var _moving_until := 0
var _near_viewport: SubViewport
var _near_camera: Camera2D
var _near_size := Vector2i.ZERO
var _near := {}
var _shown := false
var _fast = null
var _fast_relief := -1
var _fast_frame: Dictionary = {}
var _flat_shrink_at := 0


func setup(owner_extras: Node, view: MapView) -> void:
	extras = owner_extras
	map_view = view
	process_priority = -100
	if ClassDB.class_exists("TerrainProjector"):
		_fast = ClassDB.instantiate("TerrainProjector")
	_layer = CanvasLayer.new()
	_layer.layer = -1
	_layer.visible = false
	add_child(_layer)
	_space = ColorRect.new()
	_space.color = Color(0, 0, 0, 1)
	_space.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_space.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_layer.add_child(_space)
	_stars = StarField.new()
	_stars.globe = self
	_layer.add_child(_stars)
	_sun = TextureRect.new()
	_sun.texture = ImageTexture.create_from_image(sun_image())
	_sun.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_sun.size = Vector2(176, 176)
	_sun.modulate.a = 0.0
	_layer.add_child(_sun)
	_sphere = ColorRect.new()
	_sphere.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_sphere.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_material = _shader_material(SPHERE_SHADER)
	_sphere.material = _material
	_layer.add_child(_sphere)
	_light_layer = CanvasLayer.new()
	_light_layer.layer = LIGHT_LAYER
	_light_layer.visible = false
	add_child(_light_layer)
	_light = ColorRect.new()
	_light.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_light.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_light_material = _shader_material(LIGHT_SHADER)
	_light.material = _light_material
	_light_layer.add_child(_light)
	labels = GlobeLabels.new()
	labels.setup(view)
	relief = TerrainRelief.new()
	add_child(relief)
	relief.setup(view, self)
	relief.changed.connect(_on_relief_changed)
	_refresh_sun(true)


func _relief_wanted() -> bool:
	if not terrain_on or map_view == null:
		return false
	if map_view.basemap and bool(map_view.basemap.get("_offline")):
		return false
	return true


func relief_shown() -> bool:
	return relief != null and relief.enabled


func relief_revision() -> int:
	return relief.revision if relief else 0


func _terrain_changed() -> void:
	if map_view == null or relief == null:
		return
	_sync_active()
	if map_view.extras_ready():
		map_view.call("_after_camera_move")


func relief_tile_arrived() -> void:
	_relief_dirty = true


func terrain_movement_begin() -> bool:
	if _terrain_movement:
		return false
	if not relief_shown():
		return true
	_compute_frame()
	_terrain_movement = true
	_elevation_frozen = true
	return true


func terrain_movement_end() -> void:
	if not _terrain_movement:
		return
	_terrain_movement = false
	_recalculate_zoom_and_centre()
	_elevation_frozen = false
	if map_view and map_view.extras_ready():
		map_view.call("_after_camera_move")


func elevation_ease_begin(centre_world: Vector2, freeze := false) -> void:
	if not relief_shown() or map_view == null:
		return
	_compute_frame()
	_ease_centre = centre_world
	_ease_start = _elevation
	_ease_target = _ease_height()
	_ease_freeze = freeze
	_elevation_frozen = true


func elevation_ease_step(k: float) -> void:
	if not (_ease_centre is Vector2) or _ease_freeze or not relief_shown():
		return
	var now := _ease_height()
	if k < 1.0 and now != _ease_target:
		var pitch1 := _ease_target - _ease_start
		var pitch2 := (now - (pitch1 * k + _ease_start)) / (1.0 - k)
		_ease_start += k * (pitch1 - pitch2)
		_ease_target = now
	_elevation = lerpf(_ease_start, _ease_target, k)


func elevation_ease_end() -> void:
	if not (_ease_centre is Vector2):
		return
	var freeze := _ease_freeze
	_ease_centre = null
	_ease_freeze = false
	if freeze and relief_shown():
		_recalculate_zoom_and_centre()
		_elevation_frozen = false
		if map_view and map_view.extras_ready():
			map_view.call("_after_camera_move")


func _ease_height() -> float:
	if relief == null or not relief.has_data or not (_ease_centre is Vector2):
		return 0.0
	var centre: Vector2 = _ease_centre
	centre.x += MapView.WORLD_WIDTH * roundf((map_view.camera.position.x - centre.x) / MapView.WORLD_WIDTH)
	return relief.elevation_at(centre)


func _recalculate_zoom_and_centre() -> void:
	if map_view == null or not active or enabled:
		return
	var frame := _compute_frame()
	if not bool(frame["relief"]):
		return
	var size: Vector2 = frame["size"]
	var found: Variant = _relief_pick(frame, size * 0.5)
	var centre: Vector2 = found if found is Vector2 else map_view.camera.position
	var height := relief.elevation_at(centre)
	var elevation: float = frame["centre_h"]
	if elevation - height == 0.0:
		return
	var pitch: float = frame["pitch"]
	var focal: float = frame["focal"]
	var per_meter: float = frame["ppm"]
	var px_per_world: float = frame["px_per_world"]
	var ahead: Vector2 = frame["flat_up"]
	var camera_px := map_view.camera.position * px_per_world - ahead * (focal * sin(pitch))
	var camera_z := elevation * per_meter + focal * cos(pitch)
	var down := -cos(pitch)
	var above := camera_z / per_meter - height
	var distance := 0.0
	var clamped := height
	if down * above >= 0.0 or absf(down) < 0.1:
		distance = 10000.0
		clamped = camera_z / per_meter + distance * down
	else:
		distance = -above / down
	var centre_px := camera_px + ahead * (sin(pitch) * distance * per_meter)
	var world := centre_px / px_per_world
	var lat := deg_to_rad(clampf(lonlat_of_world(world).y, -MAX_VALID_LATITUDE, MAX_VALID_LATITUDE))
	var limits := zoom_limits()
	var level := clampf(log(focal * TAU * EARTH_RADIUS_M * cos(lat) / (distance * 512.0)) / log(2.0), limits.x, limits.y)
	_elevation = clamped
	map_view.camera.position = world
	map_view.camera.zoom = Vector2.ONE * pow(2.0, level) / 8.0


func _on_relief_changed() -> void:
	if map_view and map_view.extras_ready():
		map_view.call("_after_camera_move")


static func _shader_material(code: String) -> ShaderMaterial:
	var shader := Shader.new()
	shader.code = code
	var material := ShaderMaterial.new()
	material.shader = shader
	return material


func _texture_size() -> Vector2i:
	var size := map_view.get_viewport_rect().size
	var step := float(FLAT_TEXTURE_STEP)
	return Vector2i(
		int(clampf(ceilf(size.x * FLAT_TEXTURE_SCALE / step) * step, step * 4.0, float(FLAT_TEXTURE_LIMIT))),
		int(clampf(ceilf(size.y * FLAT_TEXTURE_SCALE / step) * step, step * 4.0, float(FLAT_TEXTURE_LIMIT))))


func _ensure_viewport(wanted := Vector2i.ZERO) -> void:
	var size := wanted if wanted != Vector2i.ZERO else _texture_size()
	if _flat_viewport and _flat_size == size:
		return
	if _flat_viewport:
		_flat_size = size
		_flat_viewport.size = size
		return
	_flat_size = size
	_flat_viewport = SubViewport.new()
	_flat_viewport.disable_3d = true
	_flat_viewport.transparent_bg = false
	_flat_viewport.handle_input_locally = false
	_flat_viewport.gui_disable_input = true
	_flat_viewport.size = size
	_flat_viewport.canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_LINEAR
	_flat_viewport.world_2d = map_view.get_viewport().world_2d
	_flat_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS if active else SubViewport.UPDATE_DISABLED
	add_child(_flat_viewport)
	_flat_camera = Camera2D.new()
	_flat_camera.process_mode = Node.PROCESS_MODE_DISABLED
	_flat_viewport.add_child(_flat_camera)
	_flat_viewport.size_changed.connect(_flat_camera.force_update_scroll)
	_material.set_shader_parameter("flat_map", _flat_viewport.get_texture())


func _ensure_near_viewport() -> void:
	if _near_viewport and _near_size == _flat_size:
		return
	if _near_viewport:
		_near_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
		remove_child(_near_viewport)
		_near_viewport.queue_free()
	_near_size = _flat_size
	_near_viewport = SubViewport.new()
	_near_viewport.disable_3d = true
	_near_viewport.transparent_bg = false
	_near_viewport.handle_input_locally = false
	_near_viewport.gui_disable_input = true
	_near_viewport.size = _flat_size
	_near_viewport.canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_LINEAR
	_near_viewport.world_2d = map_view.get_viewport().world_2d
	_near_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(_near_viewport)
	_near_camera = Camera2D.new()
	_near_camera.process_mode = Node.PROCESS_MODE_DISABLED
	_near_viewport.add_child(_near_camera)
	_near_viewport.size_changed.connect(_near_camera.force_update_scroll)
	_material.set_shader_parameter("near_map", _near_viewport.get_texture())


func set_enabled(value: bool) -> void:
	if enabled == value:
		return
	enabled = value
	_sync_active()
	if map_view and map_view.extras_ready():
		map_view.call("_after_camera_move")


func set_rotation_paused(paused: bool) -> void:
	rotation_paused = paused
	mark_interaction()


func mark_interaction() -> void:
	_last_interaction = Time.get_ticks_msec()


func _sync_active() -> void:
	if relief:
		relief.set_enabled(_relief_wanted())
	var want := (enabled or tilted() or relief_shown()) and map_view != null and map_view.visible and map_view.extras_ready()
	if want != active:
		active = want
		map_view.globe_on = active
		var root := map_view.get_viewport()
		if active:
			_ensure_viewport()
			_flat_viewport.world_2d = root.world_2d
			_flat_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
			map_view.visibility_layer = MAP_LAYER_BIT
			if _saved_cull_mask < 0:
				_saved_cull_mask = root.canvas_cull_mask
			root.canvas_cull_mask = _saved_cull_mask & ~MAP_LAYER_BIT
			_layer.visible = true
			labels.set_active(true)
			_last_interaction = Time.get_ticks_msec()
			_last_rotate = Time.get_ticks_msec()
		else:
			if _flat_viewport:
				_flat_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
			if _near_viewport:
				_near_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
			_near = {}
			map_view.visibility_layer = 1
			if _saved_cull_mask >= 0:
				root.canvas_cull_mask = _saved_cull_mask
				_saved_cull_mask = -1
			_layer.visible = false
			labels.set_active(false)
	var shown := active and enabled
	_light_layer.visible = shown
	if shown == _shown:
		return
	_shown = shown
	if not shown:
		_sun.modulate.a = 0.0
	if extras and extras.has_signal("globe_changed"):
		extras.emit_signal("globe_changed", shown)


func sync_active() -> void:
	_sync_active()


func _process(_delta: float) -> void:
	if not map_view:
		return
	_sync_active()
	if _relief_dirty and active and relief_shown() and not _frame.is_empty():
		_relief_dirty = false
		relief.update(_frame, _flat.get("rect", Rect2()))
	if active and _flat_shrink_at != 0 and Time.get_ticks_msec() >= _flat_shrink_at and not _is_moving():
		map_view.call("_after_camera_move")
	if not active or not enabled:
		return
	var now := Time.get_ticks_msec()
	if now - _sun_refreshed >= LIVE_SUN_REFRESH_MS:
		_refresh_sun(false)
		map_view.call("_after_camera_move")
	if idle_rotation_disabled or rotation_paused:
		_last_rotate = now
		return
	var idle := now - _last_interaction > INTERACTION_GRACE_MS and not _is_moving()
	if not idle:
		_last_rotate = now
		return
	var elapsed := float(now - _last_rotate)
	if elapsed < IDLE_ROTATE_FRAME_MS:
		return
	_last_rotate = now
	var camera := map_view.camera
	camera.position.x -= ROTATION_DEG_PER_MS * elapsed / 360.0 * MapView.WORLD_WIDTH
	map_view.call("_after_camera_move")


func _is_moving() -> bool:
	if held:
		return true
	var fly: Variant = map_view.get("_fly")
	if fly is Tween and (fly as Tween).is_valid() and (fly as Tween).is_running():
		return true
	return Time.get_ticks_msec() < _moving_until


func _refresh_sun(_force: bool) -> void:
	_sun_refreshed = Time.get_ticks_msec()
	_sun_lonlat = subsolar_point(Time.get_unix_time_from_system())
	_sun_dir = direction_of(_sun_lonlat.x, _sun_lonlat.y)


static func subsolar_point(unix_seconds: float) -> Vector2:
	var julian := unix_seconds / 86400.0 + 2440587.5
	var n := julian - 2451545.0
	var mean_longitude := 280.46 + 0.9856474 * n
	var mean_anomaly := deg_to_rad(357.528 + 0.9856003 * n)
	var ecliptic := deg_to_rad(mean_longitude + 1.915 * sin(mean_anomaly) + 0.02 * sin(2.0 * mean_anomaly))
	var obliquity := deg_to_rad(23.439 - 0.0000004 * n)
	var declination := asin(sin(obliquity) * sin(ecliptic))
	var right_ascension := atan2(cos(obliquity) * sin(ecliptic), cos(ecliptic))
	var sidereal := 280.46061837 + 360.98564736629 * n
	return Vector2(normalize_longitude(rad_to_deg(right_ascension) - sidereal), rad_to_deg(declination))


static func normalize_longitude(lng: float) -> float:
	return fposmod(fposmod(lng + 180.0, 360.0) + 360.0, 360.0) - 180.0


static func direction_of(lng: float, lat: float) -> Vector3:
	var lng_rad := deg_to_rad(lng)
	var lat_rad := deg_to_rad(lat)
	var scale := cos(lat_rad)
	return Vector3(sin(lng_rad) * scale, sin(lat_rad), cos(lng_rad) * scale)


static func lonlat_of_world(point: Vector2) -> Vector2:
	var lon := point.x / MapView.WORLD_WIDTH * 360.0 - 180.0
	var lat := rad_to_deg(atan(sinh(PI * (1.0 - 2.0 * point.y / MapView.WORLD_WIDTH))))
	return Vector2(lon, lat)


static func world_of_lonlat(lon: float, lat: float) -> Vector2:
	var clamped: float = clampf(lat, -MERCATOR_LIMIT, MERCATOR_LIMIT)
	var x := (lon + 180.0) / 360.0 * MapView.WORLD_WIDTH
	var y := (0.5 - log(tan(PI / 4.0 + deg_to_rad(clamped) / 2.0)) / (2.0 * PI)) * MapView.WORLD_WIDTH
	return Vector2(x, y)


static func lonlat_of_dir(p: Vector3) -> Vector2:
	var lat := rad_to_deg(asin(clampf(p.y, -1.0, 1.0)))
	var horizontal := sqrt(p.x * p.x + p.z * p.z)
	if horizontal <= 1e-6:
		return Vector2(0.0, lat)
	var lng := rad_to_deg(acos(clampf(p.z / horizontal, -1.0, 1.0)))
	if p.x / horizontal <= 0.0:
		lng = -lng
	return Vector2(wrap_longitude(lng), lat)


static func wrap_longitude(lng: float) -> float:
	var span := 360.0
	var w := fposmod(lng + 180.0, span) - 180.0
	return 180.0 if is_equal_approx(w, -180.0) else w


static func difference_of_angles(a_deg: float, b_deg: float) -> float:
	var a := fposmod(a_deg, 360.0)
	var b := fposmod(b_deg, 360.0)
	var diff1 := b - a
	var diff2 := (diff1 - 360.0) if b > a else (diff1 + 360.0)
	return diff1 if absf(diff1) < absf(diff2) else diff2


static func remap_saturate(value: float, from_min: float, from_max: float, to_min: float, to_max: float) -> float:
	var t := clampf((value - from_min) / (from_max - from_min), 0.0, 1.0)
	return to_min * (1.0 - t) + to_max * t


static func angle_between_2d(ax: float, ay: float, bx: float, by: float) -> float:
	var la := sqrt(ax * ax + ay * ay)
	var lb := sqrt(bx * bx + by * by)
	ax /= la
	ay /= la
	bx /= lb
	by /= lb
	var angle := acos(clampf(ax * bx + ay * by, -1.0, 1.0))
	return angle if (-ay * bx + ax * by) > 0.0 else -angle


static func distance_of_angles(a: float, b: float) -> float:
	var x := fposmod(a, TAU)
	var y := fposmod(b, TAU)
	return minf(absf(x - y), minf(absf(x - y + TAU), absf(x - y - TAU)))


static func mercator_horizon(focal: float, pitch_deg: float) -> float:
	return focal * minf(tan(deg_to_rad(90.0 - pitch_deg)) * 0.85, tan(deg_to_rad(MAX_MERCATOR_HORIZON_ANGLE - pitch_deg)))


static func globe_radius(zoom: float, lat: float) -> float:
	return 512.0 * pow(2.0, zoom) / TAU / cos(deg_to_rad(lat))


static func zoom_adjustment(old_lat: float, new_lat: float) -> float:
	return log(cos(deg_to_rad(new_lat)) / cos(deg_to_rad(old_lat))) / log(2.0)


func globeness() -> float:
	return clampf(12.0 - map_view.zoom_level(), 0.0, 1.0) if enabled else 0.0


static func transition_opacity(transition: float) -> float:
	var progress := clampf((transition - 0.9) / 0.1, 0.0, 1.0)
	return progress * progress * (3.0 - 2.0 * progress)


func tilted() -> bool:
	return map_view != null and (not is_zero_approx(map_view.bearing) or not is_zero_approx(map_view.pitch))


func globe_shown() -> bool:
	return active and enabled


func _compute_frame() -> Dictionary:
	var size := map_view.get_viewport_rect().size
	var camera := map_view.camera
	var lonlat := lonlat_of_world(camera.position)
	var lat_c: float = clampf(lonlat.y, -MAX_VALID_LATITUDE, MAX_VALID_LATITUDE)
	var lon_c := lonlat.x
	var zoom := map_view.zoom_level()
	var radius := globe_radius(zoom, lat_c)
	var focal := 0.5 / TAN_HALF * size.y
	var bearing := deg_to_rad(map_view.bearing)
	var pitch := deg_to_rad(map_view.pitch)
	var lon_r := deg_to_rad(lon_c)
	var lat_r := deg_to_rad(lat_c)
	var center := direction_of(lon_c, lat_c)
	var east := Vector3(cos(lon_r), 0.0, -sin(lon_r))
	var north := Vector3(-sin(lat_r) * sin(lon_r), cos(lat_r), -sin(lat_r) * cos(lon_r))
	var ahead := north * cos(bearing) + east * sin(bearing)
	var right := east * cos(bearing) - north * sin(bearing)
	var fwd := ahead * sin(pitch) - center * cos(pitch)
	var up := ahead * cos(pitch) + center * sin(pitch)
	var pos := center * (1.0 + cos(pitch) * focal / radius) - ahead * (sin(pitch) * focal / radius)
	var g := clampf(12.0 - zoom, 0.0, 1.0) if enabled else 0.0
	var lifted := relief != null and relief.enabled and relief.has_data
	var per_meter := MapView.WORLD_WIDTH * camera.zoom.x / (TAU * EARTH_RADIUS_M * cos(lat_r)) if lifted else 0.0
	if lifted and not _elevation_frozen:
		_elevation = relief.elevation_at(camera.position)
	var centre_h := _elevation if lifted else 0.0
	var relief_low := minf(relief.low, 0.0) if lifted else 0.0
	var relief_high := maxf(relief.high, 0.0) if lifted else 0.0
	return {
		"relief": lifted,
		"ppm": per_meter,
		"centre_h": centre_h,
		"relief_low": relief_low,
		"relief_high": relief_high,
		"lift_low": (relief_low - centre_h) * per_meter,
		"lift_high": (relief_high - centre_h) * per_meter,
		"size": size,
		"lon": lon_c,
		"lat": lat_c,
		"zoom": zoom,
		"radius": radius,
		"cam_dist": focal,
		"focal": focal,
		"center": center,
		"east": east,
		"north": north,
		"right": right,
		"up": up,
		"fwd": fwd,
		"pos": pos,
		"d": pos.length(),
		"bearing": bearing,
		"pitch": pitch,
		"flat_right": Vector2(cos(bearing), sin(bearing)),
		"flat_up": Vector2(sin(bearing), -cos(bearing)),
		"g": g,
		"opacity": transition_opacity(g) if enabled else 0.0,
		"px_per_world": camera.zoom.x,
		"cam_world": camera.position,
	}


func _ray(frame: Dictionary, screen: Vector2) -> Vector3:
	var size: Vector2 = frame["size"]
	var focal: float = frame["focal"]
	var sx := screen.x - size.x * 0.5
	var sy := size.y * 0.5 - screen.y
	return ((frame["fwd"] as Vector3) * focal + (frame["right"] as Vector3) * sx + (frame["up"] as Vector3) * sy).normalized()


func _hit(frame: Dictionary, screen: Vector2) -> Dictionary:
	var origin: Vector3 = frame["pos"]
	var dir := _ray(frame, screen)
	var b := origin.dot(dir)
	var inner := origin - dir * b
	var disc := 1.0 - inner.dot(inner)
	if disc < 0.0 or b >= 0.0:
		return {"hit": false, "dir": dir, "origin": origin}
	var c := origin.dot(origin) - 1.0
	var q := -b + sqrt(disc)
	var t := minf(c / q, q)
	return {"hit": true, "point": (origin + dir * t).normalized(), "dir": dir, "origin": origin}


func _project_dir(frame: Dictionary, p: Vector3) -> Vector3:
	var size: Vector2 = frame["size"]
	var focal: float = frame["focal"]
	var q := p - (frame["pos"] as Vector3)
	var z := q.dot(frame["fwd"])
	if z <= 0.0:
		return Vector3(0, 0, -1)
	return Vector3(size.x * 0.5 + focal * q.dot(frame["right"]) / z, size.y * 0.5 - focal * q.dot(frame["up"]) / z, z)


func _wrapped_delta(frame: Dictionary, point: Vector2) -> Vector2:
	var delta := point - (frame["cam_world"] as Vector2)
	delta.x -= MapView.WORLD_WIDTH * roundf(delta.x / MapView.WORLD_WIDTH)
	return delta * float(frame["px_per_world"])


func _flat_clip(frame: Dictionary, point: Vector2, lift := 0.0) -> Vector3:
	var delta := _wrapped_delta(frame, point)
	var a := delta.dot(frame["flat_right"])
	var v := delta.dot(frame["flat_up"])
	var pitch: float = frame["pitch"]
	return Vector3(a, v * cos(pitch) + lift * sin(pitch), float(frame["focal"]) + v * sin(pitch) - lift * cos(pitch))


func _globe_clip(frame: Dictionary, point: Vector2, height := 0.0) -> Vector3:
	var lonlat := lonlat_of_world(point)
	var q := direction_of(lonlat.x, lonlat.y) * (1.0 + height / EARTH_RADIUS_M) - (frame["pos"] as Vector3)
	return Vector3(q.dot(frame["right"]), q.dot(frame["up"]), q.dot(frame["fwd"])) * float(frame["radius"])


func _height(frame: Dictionary, point: Vector2) -> float:
	if not bool(frame.get("relief", false)):
		return 0.0
	var near := point
	near.x += MapView.WORLD_WIDTH * roundf(((frame["cam_world"] as Vector2).x - point.x) / MapView.WORLD_WIDTH)
	return relief.elevation_at(near)


func _lift(frame: Dictionary, height: float) -> float:
	return (height - float(frame.get("centre_h", 0.0))) * float(frame.get("ppm", 0.0))


func _lifted_clip(frame: Dictionary, point: Vector2, height: float) -> Vector3:
	var g: float = frame["g"]
	var clip := _flat_clip(frame, point, _lift(frame, height))
	if g > 0.0:
		clip = clip.lerp(_globe_clip(frame, point, height), g)
	return clip


func _project_lifted(frame: Dictionary, point: Vector2, height: float) -> Vector2:
	var clip := _lifted_clip(frame, point, height)
	if clip.z <= 0.0:
		return Vector2(-100000, -100000)
	var size: Vector2 = frame["size"]
	var focal: float = frame["focal"]
	return Vector2(size.x * 0.5 + focal * clip.x / clip.z, size.y * 0.5 - focal * clip.y / clip.z)


func unproject_lifted(frame: Dictionary, screen: Vector2, lift: float) -> Vector2:
	var size: Vector2 = frame["size"]
	var focal: float = frame["focal"]
	var pitch: float = frame["pitch"]
	var sx := screen.x - size.x * 0.5
	var sy := size.y * 0.5 - screen.y
	var denominator := maxf(focal * cos(pitch) - sy * sin(pitch), 1e-3)
	var t := maxf((focal * cos(pitch) - lift) / denominator, 0.0)
	var a := t * sx
	var v := t * (sy * cos(pitch) + focal * sin(pitch)) - focal * sin(pitch)
	return (frame["cam_world"] as Vector2) + ((frame["flat_right"] as Vector2) * a + (frame["flat_up"] as Vector2) * v) / float(frame["px_per_world"])


func _ray_ground(frame: Dictionary, sx: float, sy: float, t: float) -> Vector2:
	var focal: float = frame["focal"]
	var pitch: float = frame["pitch"]
	var a := t * sx
	var v := t * (sy * cos(pitch) + focal * sin(pitch)) - focal * sin(pitch)
	return (frame["cam_world"] as Vector2) + ((frame["flat_right"] as Vector2) * a + (frame["flat_up"] as Vector2) * v) / float(frame["px_per_world"])


func _ground_gap(frame: Dictionary, sx: float, sy: float, t: float) -> float:
	var focal: float = frame["focal"]
	var pitch: float = frame["pitch"]
	var lift := t * (sy * sin(pitch) - focal * cos(pitch)) + focal * cos(pitch)
	return lift - _lift(frame, relief.elevation_at(_ray_ground(frame, sx, sy, t)))


func _relief_flat(frame: Dictionary, screen: Vector2) -> Variant:
	var size: Vector2 = frame["size"]
	var focal: float = frame["focal"]
	var pitch: float = frame["pitch"]
	var sx := screen.x - size.x * 0.5
	var sy := size.y * 0.5 - screen.y
	var denominator := focal * cos(pitch) - sy * sin(pitch)
	if denominator <= 1e-3:
		return null
	var t0 := maxf((focal * cos(pitch) - float(frame["lift_high"])) / denominator, 0.0)
	var t1 := (focal * cos(pitch) - float(frame["lift_low"])) / denominator
	if t1 <= t0:
		return _ray_ground(frame, sx, sy, t1)
	var span := _ray_ground(frame, sx, sy, t0).distance_to(_ray_ground(frame, sx, sy, t1)) / maxf(relief.step, 1e-6)
	var steps := clampi(ceili(span), 1, 64)
	var before_t := t0
	var before_f := _ground_gap(frame, sx, sy, t0)
	if before_f <= 0.0:
		return _ray_ground(frame, sx, sy, t0)
	for index in range(1, steps + 1):
		var t := lerpf(t0, t1, float(index) / float(steps))
		var f := _ground_gap(frame, sx, sy, t)
		if f <= 0.0:
			var lo := before_t
			var hi := t
			var f_lo := before_f
			var f_hi := f
			for _k in range(5):
				var mid := (lo + hi) * 0.5
				var f_mid := _ground_gap(frame, sx, sy, mid)
				if f_mid > 0.0:
					lo = mid
					f_lo = f_mid
				else:
					hi = mid
					f_hi = f_mid
			return _ray_ground(frame, sx, sy, lo + (hi - lo) * clampf(f_lo / maxf(f_lo - f_hi, 1e-6), 0.0, 1.0))
		before_t = t
		before_f = f
	return _ray_ground(frame, sx, sy, t1)


func _shell_gap(frame: Dictionary, p: Vector3) -> float:
	var lonlat := lonlat_of_dir(p.normalized())
	var world := world_of_lonlat(lonlat.x, lonlat.y)
	return p.length() - 1.0 - _height(frame, world) / EARTH_RADIUS_M


func _relief_globe(frame: Dictionary, screen: Vector2) -> Variant:
	var origin: Vector3 = frame["pos"]
	var dir := _ray(frame, screen)
	var outer := 1.0 + float(frame["relief_high"]) / EARTH_RADIUS_M
	var inner := 1.0 + float(frame["relief_low"]) / EARTH_RADIUS_M
	var b := origin.dot(dir)
	var disc_out := b * b - (origin.dot(origin) - outer * outer)
	if disc_out < 0.0:
		return null
	var root := sqrt(disc_out)
	var t0 := maxf(-b - root, 0.0)
	var t1 := -b + root
	var disc_in := b * b - (origin.dot(origin) - inner * inner)
	if disc_in >= 0.0 and -b - sqrt(disc_in) > t0:
		t1 = -b - sqrt(disc_in)
	if t1 <= t0:
		return null
	var angle := acos(clampf((origin + dir * t0).normalized().dot((origin + dir * t1).normalized()), -1.0, 1.0))
	var texel_angle := maxf(relief.step, 1e-6) / MapView.WORLD_WIDTH * TAU
	var steps := clampi(ceili(angle / texel_angle), 1, 48)
	var before_t := t0
	var before_f := _shell_gap(frame, origin + dir * t0)
	if before_f <= 0.0:
		return origin + dir * t0
	for index in range(1, steps + 1):
		var t := lerpf(t0, t1, float(index) / float(steps))
		var f := _shell_gap(frame, origin + dir * t)
		if f <= 0.0:
			var lo := before_t
			var hi := t
			var f_lo := before_f
			var f_hi := f
			for _k in range(5):
				var mid := (lo + hi) * 0.5
				var f_mid := _shell_gap(frame, origin + dir * mid)
				if f_mid > 0.0:
					lo = mid
					f_lo = f_mid
				else:
					hi = mid
					f_hi = f_mid
			return origin + dir * (lo + (hi - lo) * clampf(f_lo / maxf(f_lo - f_hi, 1e-9), 0.0, 1.0))
		before_t = t
		before_f = f
	return null


func _relief_pick(frame: Dictionary, screen: Vector2) -> Variant:
	var g: float = frame["g"]
	if g >= 0.999:
		var lifted: Variant = _relief_globe(frame, screen)
		if lifted == null:
			return null
		var lonlat := lonlat_of_dir((lifted as Vector3).normalized())
		var on_globe := world_of_lonlat(lonlat.x, lonlat.y)
		on_globe.x += MapView.WORLD_WIDTH * roundf(((frame["cam_world"] as Vector2).x - on_globe.x) / MapView.WORLD_WIDTH)
		return on_globe
	var found: Variant = _relief_flat(frame, screen)
	if found == null:
		return null
	var world: Vector2 = found
	if g > 0.0:
		var hit := _hit(frame, screen)
		if bool(hit["hit"]):
			var lonlat := lonlat_of_dir(hit["point"])
			var on_globe := world_of_lonlat(lonlat.x, lonlat.y)
			on_globe.x += MapView.WORLD_WIDTH * roundf((world.x - on_globe.x) / MapView.WORLD_WIDTH)
			world = world.lerp(on_globe, g)
		for _step in range(4):
			var s := _project_lifted(frame, world, _height(frame, world))
			world += _newton_step(frame, world, screen - s)
	return world


func pick_world(screen: Vector2) -> Vector2:
	var frame := _compute_frame()
	if bool(frame["relief"]):
		var found: Variant = _relief_pick(frame, screen)
		if found is Vector2:
			return found
	return _flat_unproject(frame, screen)


func _project_world(frame: Dictionary, point: Vector2) -> Vector2:
	var size: Vector2 = frame["size"]
	var g: float = frame["g"]
	var clip := _flat_clip(frame, point)
	if g > 0.0:
		clip = clip.lerp(_globe_clip(frame, point), g)
	if clip.z <= 0.0:
		return Vector2(-100000, -100000)
	var focal: float = frame["focal"]
	return Vector2(size.x * 0.5 + focal * clip.x / clip.z, size.y * 0.5 - focal * clip.y / clip.z)


func _flat_unproject(frame: Dictionary, screen: Vector2) -> Vector2:
	var size: Vector2 = frame["size"]
	var focal: float = frame["focal"]
	var pitch: float = frame["pitch"]
	var sx := screen.x - size.x * 0.5
	var sy := size.y * 0.5 - screen.y
	var denominator := maxf(focal * cos(pitch) - sy * sin(pitch), 1e-3)
	var v := sy * focal / denominator
	var a := sx * (focal + v * sin(pitch)) / focal
	return (frame["cam_world"] as Vector2) + ((frame["flat_right"] as Vector2) * a + (frame["flat_up"] as Vector2) * v) / float(frame["px_per_world"])


func _newton_step(frame: Dictionary, point: Vector2, error: Vector2) -> Vector2:
	var delta := _wrapped_delta(frame, point)
	var a := delta.dot(frame["flat_right"])
	var v := delta.dot(frame["flat_up"])
	var pitch: float = frame["pitch"]
	var focal: float = frame["focal"]
	var z := focal + v * sin(pitch)
	var dv := -error.y * z * z / (focal * focal * maxf(cos(pitch), 1e-3))
	var da := (error.x + focal * a * sin(pitch) / (z * z) * dv) * z / focal
	return ((frame["flat_right"] as Vector2) * da + (frame["flat_up"] as Vector2) * dv) / float(frame["px_per_world"])


func _visible_on_sphere(frame: Dictionary, p: Vector3) -> bool:
	return p.dot(frame["pos"]) >= 1.0


func current_frame() -> Dictionary:
	if _frame.is_empty():
		_frame = _compute_frame()
	return _frame


func _fast_ready() -> bool:
	if _fast == null:
		return false
	var frame := current_frame()
	if relief and relief.revision != _fast_relief:
		_fast_relief = relief.revision
		_fast.set_relief(relief.has_data, relief.lod_rect, relief.lod_cell, relief.lod_size, relief.lod_data, relief.level_rects, relief.level_sizes, relief.level_data, relief.step, TerrainRelief.EXAGGERATION)
		_fast_frame = {}
	if not is_same(frame, _fast_frame):
		_fast_frame = frame
		var planes := Vector2(1.0, 2.0)
		if bool(frame.get("relief", false)) and float(frame["g"]) <= 0.0:
			planes = _depth_planes(frame)
		_fast.set_frame(frame, planes)
	return true


func world_to_screen_many(points: PackedVector2Array) -> PackedVector2Array:
	if _fast_ready():
		return _fast.world_to_screen_many(points)
	var out := PackedVector2Array()
	out.resize(points.size())
	for index in range(points.size()):
		out[index] = world_to_screen(points[index])
	return out


func depth_many(points: PackedVector2Array) -> PackedFloat64Array:
	if active and _fast_ready():
		return _fast.depth_many(points)
	var out := PackedFloat64Array()
	out.resize(points.size())
	for index in range(points.size()):
		out[index] = depth_at(points[index])
	return out


func visibility_many(points: PackedVector2Array) -> PackedFloat64Array:
	if _fast_ready():
		return _fast.visibility_many(points)
	var out := PackedFloat64Array()
	out.resize(points.size())
	for index in range(points.size()):
		out[index] = anchor_visibility(points[index])
	return out


func cull_rect(pad: Vector2) -> Variant:
	var frame := current_frame()
	if float(frame["g"]) > 0.0:
		return null
	var size: Vector2 = frame["size"]
	var focal: float = frame["focal"]
	var pitch: float = frame["pitch"]
	var lifts: Array[float] = [0.0]
	if bool(frame.get("relief", false)):
		lifts = [float(frame["lift_low"]), float(frame["lift_high"])]
	var low := Vector2(INF, INF)
	var high := Vector2(-INF, -INF)
	for corner: Vector2 in [-pad, Vector2(size.x + pad.x, -pad.y), size + pad, Vector2(-pad.x, size.y + pad.y)]:
		var sy := size.y * 0.5 - corner.y
		if focal * cos(pitch) - sy * sin(pitch) <= 1e-3:
			return null
		for lift in lifts:
			if focal * cos(pitch) - lift <= 1e-3:
				return null
			var world := unproject_lifted(frame, corner, lift)
			low = low.min(world)
			high = high.max(world)
	return Rect2(low, high - low).grow(1.0)


func world_to_screen(point: Vector2) -> Vector2:
	if _fast_ready():
		return _fast.world_to_screen(point)
	var frame := current_frame()
	if float(frame["g"]) > 0.0:
		var lonlat := lonlat_of_world(point)
		if not _visible_on_sphere(frame, direction_of(lonlat.x, lonlat.y)):
			return Vector2(-100000, -100000)
	if bool(frame.get("relief", false)):
		return _project_lifted(frame, point, _height(frame, point))
	return _project_world(frame, point)


func world_to_screen_flat(point: Vector2) -> Vector2:
	var frame := current_frame()
	if float(frame["g"]) > 0.0:
		var lonlat := lonlat_of_world(point)
		if not _visible_on_sphere(frame, direction_of(lonlat.x, lonlat.y)):
			return Vector2(-100000, -100000)
	return _project_world(frame, point)


func height_at(point: Vector2) -> float:
	if _fast_ready():
		return _fast.height_at(point)
	return _height(current_frame(), point)


func centre_height() -> float:
	return float(current_frame().get("centre_h", 0.0))


func world_to_screen_at(point: Vector2, height: float) -> Vector2:
	if _fast_ready():
		return _fast.world_to_screen_at(point, height)
	return _project_lifted(current_frame(), point, height)


func anchor_visibility(point: Vector2) -> float:
	if _fast_ready():
		return _fast.anchor_visibility(point)
	var frame := current_frame()
	if not bool(frame.get("relief", false)) or float(frame["g"]) > 0.0:
		return 1.0
	var clip := _lifted_clip(frame, point, _height(frame, point))
	if clip.z <= 0.0:
		return 1.0
	var size: Vector2 = frame["size"]
	var focal: float = frame["focal"]
	var screen := Vector2(size.x * 0.5 + focal * clip.x / clip.z, size.y * 0.5 - focal * clip.y / clip.z)
	var planes := _depth_planes(frame)
	var depth := _ndc_depth(planes, clip.z)
	var seen := _depth_opacity(frame, planes, screen, depth, clip.z)
	if seen > 0.95:
		return 1.0
	return (seen + _depth_opacity(frame, planes, screen - Vector2(0.0, 0.005 * size.y), depth, clip.z)) * 0.5


func _depth_planes(frame: Dictionary) -> Vector2:
	var focal: float = frame["focal"]
	var pitch: float = frame["pitch"]
	var per_meter: float = frame["ppm"]
	var elevation: float = frame["centre_h"]
	var limited := deg_to_rad(minf(rad_to_deg(pitch), MAX_MERCATOR_HORIZON_ANGLE))
	var sea_level := maxf(focal * 0.5, focal + elevation * per_meter / cos(limited))
	var altitude := elevation + cos(pitch) * focal / per_meter
	var lowest := minf(elevation, minf(relief.tile_min_at(frame["cam_world"], float(frame["zoom"])), altitude - 100.0))
	var plane := sea_level - lowest * per_meter / cos(limited) if lowest < 0.0 else sea_level
	return _planes_from(frame, plane)


func _planes_from(frame: Dictionary, plane: float) -> Vector2:
	var size: Vector2 = frame["size"]
	var focal: float = frame["focal"]
	var pitch: float = frame["pitch"]
	var limited := deg_to_rad(minf(rad_to_deg(pitch), MAX_MERCATOR_HORIZON_ANGLE))
	var ground_angle := PI * 0.5 + pitch
	var above := FOV * 0.5
	var half_surface := sin(above) * plane / sin(clampf(PI - ground_angle - above, 0.01, PI - 0.01))
	var horizon_angle := atan(mercator_horizon(focal, rad_to_deg(pitch)) / focal)
	var least := deg_to_rad(90.0 - MAX_MERCATOR_HORIZON_ANGLE)
	var to_horizon := horizon_angle if horizon_angle > least else least
	var half_horizon := sin(to_horizon) * plane / sin(clampf(PI - ground_angle - to_horizon, 0.01, PI - 0.01))
	var far := (cos(PI * 0.5 - limited) * minf(half_surface, half_horizon) + plane) * 1.01
	return Vector2(size.y / 50.0, far)


func label_uniforms(frame: Dictionary) -> Dictionary:
	var pitch: float = frame["pitch"]
	var lifted := bool(frame.get("relief", false))
	var planes := _depth_planes(frame) if lifted else _planes_from(frame, float(frame["focal"]))
	return {
		"screen_size": frame["size"],
		"cam_world": frame["cam_world"],
		"px_per_world": frame["px_per_world"],
		"flat_right": frame["flat_right"],
		"flat_up": frame["flat_up"],
		"pitch_sin": sin(pitch),
		"pitch_cos": cos(pitch),
		"focal": frame["focal"],
		"sea_lift": _lift(frame, 0.0),
		"globeness": frame["g"],
		"cam_pos": frame["pos"],
		"cam_right": frame["right"],
		"cam_up": frame["up"],
		"cam_fwd": frame["fwd"],
		"radius_px": frame["radius"],
		"world_width": MapView.WORLD_WIDTH,
		"near_depth": planes.x,
		"far_depth": planes.y,
		"depth_clip": not enabled,
	}


func project_label_point(point: Vector2) -> Vector2:
	var frame := current_frame()
	var clip := _lifted_clip(frame, point, 0.0)
	if clip.z <= 0.0:
		return Vector2(-100000, -100000)
	var size: Vector2 = frame["size"]
	var focal: float = frame["focal"]
	return Vector2(size.x * 0.5 + focal * clip.x / clip.z, size.y * 0.5 - focal * clip.y / clip.z)


static func _ndc_depth(planes: Vector2, depth: float) -> float:
	var near := planes.x
	var far := planes.y
	return (far + near) / (far - near) - 2.0 * far * near / ((far - near) * maxf(depth, 0.000001))


func _depth_opacity(frame: Dictionary, planes: Vector2, screen: Vector2, depth: float, distance: float) -> float:
	var size: Vector2 = frame["size"]
	var focal: float = frame["focal"]
	var pitch: float = frame["pitch"]
	var sx := screen.x - size.x * 0.5
	var sy := size.y * 0.5 - screen.y
	var denominator := focal * cos(pitch) - sy * sin(pitch)
	if denominator <= 1e-3:
		return 1.0
	var t0 := maxf((focal * cos(pitch) - float(frame["lift_high"])) / denominator, 0.0)
	var t1 := minf((focal * cos(pitch) - float(frame["lift_low"])) / denominator, distance / focal)
	if t1 <= t0:
		return 1.0
	var span := _ray_ground(frame, sx, sy, t0).distance_to(_ray_ground(frame, sx, sy, t1)) / maxf(relief.step, 1e-6)
	var steps := clampi(ceili(span), 1, 64)
	var before_t := t0
	var before_f := _ground_gap(frame, sx, sy, t0)
	var hit := -1.0
	if before_f <= 0.0:
		hit = t0
	else:
		for index in range(1, steps + 1):
			var t := lerpf(t0, t1, float(index) / float(steps))
			var f := _ground_gap(frame, sx, sy, t)
			if f <= 0.0:
				var lo := before_t
				var hi := t
				var f_lo := before_f
				var f_hi := f
				for _k in range(5):
					var mid := (lo + hi) * 0.5
					var f_mid := _ground_gap(frame, sx, sy, mid)
					if f_mid > 0.0:
						lo = mid
						f_lo = f_mid
					else:
						hi = mid
						f_hi = f_mid
				hit = lo + (hi - lo) * clampf(f_lo / maxf(f_lo - f_hi, 1e-6), 0.0, 1.0)
				break
			before_t = t
			before_f = f
	if hit < 0.0:
		return 1.0
	var gap := _ndc_depth(planes, hit * focal) + 0.0001 - depth
	return 1.0 - clampf(-gap * 500.0, 0.0, 1.0)


func screen_hits_globe(screen: Vector2) -> bool:
	var frame := current_frame()
	if float(frame["g"]) < 0.999:
		return true
	return bool(_hit(frame, screen)["hit"])


func screen_to_world(screen: Vector2) -> Vector2:
	var frame := current_frame()
	if bool(frame.get("relief", false)):
		var found: Variant = _relief_pick(frame, screen)
		if found is Vector2:
			var world: Vector2 = found
			return Vector2(fposmod(world.x, MapView.WORLD_WIDTH), clampf(world.y, 0.0, MapView.WORLD_WIDTH))
	return screen_to_world_flat(screen)


func screen_to_world_flat(screen: Vector2) -> Vector2:
	var frame := current_frame()
	var g: float = frame["g"]
	var world := _flat_unproject(frame, screen)
	if g <= 0.0:
		return Vector2(fposmod(world.x, MapView.WORLD_WIDTH), world.y)
	var hit := _hit(frame, screen)
	if bool(hit["hit"]):
		var lonlat := lonlat_of_dir(hit["point"])
		var on_globe := world_of_lonlat(lonlat.x, lonlat.y)
		on_globe.x += MapView.WORLD_WIDTH * roundf((world.x - on_globe.x) / MapView.WORLD_WIDTH)
		if g >= 0.999:
			return Vector2(fposmod(on_globe.x, MapView.WORLD_WIDTH), on_globe.y)
		world = world.lerp(on_globe, g)
	elif g >= 0.999:
		var horizon := _unproject_location(frame, screen)
		return world_of_lonlat(horizon.x, horizon.y)
	for _step in range(4):
		var s := _project_world(frame, world)
		world += _newton_step(frame, world, screen - s)
	return Vector2(fposmod(world.x, MapView.WORLD_WIDTH), clampf(world.y, 0.0, MapView.WORLD_WIDTH))


func frame_at(point: Vector2) -> Transform2D:
	if _fast_ready():
		return _fast.frame_at(point)
	var frame := current_frame()
	var scale: float = frame["px_per_world"]
	var origin := world_to_screen(point)
	var step := 1.0 / scale
	if bool(frame.get("relief", false)):
		var height := _height(frame, point)
		var base := _project_lifted(frame, point, height)
		return Transform2D(_project_lifted(frame, point + Vector2(step, 0), height) - base, _project_lifted(frame, point + Vector2(0, step), height) - base, origin)
	var along_x := _project_world(frame, point + Vector2(step, 0)) - _project_world(frame, point)
	var along_y := _project_world(frame, point + Vector2(0, step)) - _project_world(frame, point)
	return Transform2D(along_x, along_y, origin)


func _unproject_location(frame: Dictionary, screen: Vector2) -> Vector2:
	var hit := _hit(frame, screen)
	if bool(hit["hit"]):
		return lonlat_of_dir(hit["point"])
	var d: float = frame["d"]
	var axis: Vector3 = (frame["pos"] as Vector3) / d
	var plane_d := -1.0 / d
	var origin: Vector3 = hit["origin"]
	var dir: Vector3 = hit["dir"]
	var direction_dot := axis.dot(dir)
	var origin_distance := axis.dot(origin) + plane_d
	var distance := -origin_distance / direction_dot if absf(direction_dot) > 1e-12 else -1.0
	var plane_point := Vector3.ZERO
	if distance > 0.0:
		plane_point = origin + dir * distance
	else:
		var distant := origin + dir * 2.0
		var from_plane := axis.dot(distant) + plane_d
		plane_point = distant - axis * from_plane
	var disk_center := axis * (-plane_d)
	var disk_radius := sqrt(maxf(0.0, 1.0 - plane_d * plane_d))
	var relative := plane_point - disk_center
	var clamped := disk_center + relative * (disk_radius / maxf(relative.length(), 1e-12))
	return lonlat_of_dir(clamped.normalized())


func render_view() -> Array:
	if not active:
		return []
	_frame = _compute_frame()
	_ensure_viewport(_wanted_texture(_frame))
	if float(_frame["g"]) <= 0.0:
		_flat = _plane_view(_frame, Rect2(Vector2.ZERO, _frame["size"]), Vector2(_flat_size), float(_frame["px_per_world"]))
	else:
		_flat = _flat_view(_frame, Vector2(_flat_size))
	_flat_camera.position = _flat["center"]
	_flat_camera.zoom = Vector2.ONE * float(_flat["density"])
	_update_near()
	return [_flat["center"], float(_flat["density"]), Vector2(_flat_size), float(_frame["px_per_world"])]


func _wanted_texture(frame: Dictionary) -> Vector2i:
	var full := _texture_size()
	if float(frame["g"]) > 0.0 or rad_to_deg(float(frame["pitch"])) >= FLAT_TILT_DEG:
		_flat_shrink_at = 0
		return full
	var span: Vector2 = _plane_span(frame, Rect2(Vector2.ZERO, frame["size"]))[0]
	var needed := span * float(frame["px_per_world"])
	var step := float(FLAT_TEXTURE_STEP)
	var snug := Vector2i(
		int(clampf(ceilf(needed.x * FLAT_HEADROOM / step) * step, step * 4.0, float(full.x))),
		int(clampf(ceilf(needed.y * FLAT_HEADROOM / step) * step, step * 4.0, float(full.y))))
	if _flat_viewport == null:
		return snug
	var current := _flat_size
	if needed.x > current.x or needed.y > current.y:
		_flat_shrink_at = 0
		return snug
	if current.x - snug.x < FLAT_SHRINK_SLACK and current.y - snug.y < FLAT_SHRINK_SLACK:
		_flat_shrink_at = 0
		return current
	var now := Time.get_ticks_msec()
	if _flat_shrink_at == 0:
		_flat_shrink_at = now + FLAT_SHRINK_MS
	if now < _flat_shrink_at:
		return current
	_flat_shrink_at = 0
	return snug


func _plane_span(frame: Dictionary, area: Rect2) -> Array:
	var low := Vector2(INF, INF)
	var high := Vector2(-INF, -INF)
	var lifted := bool(frame.get("relief", false))
	for corner in [area.position, Vector2(area.end.x, area.position.y), area.end, Vector2(area.position.x, area.end.y)]:
		var world := _flat_unproject(frame, corner)
		low = low.min(world)
		high = high.max(world)
		if lifted:
			for lift: float in [float(frame["lift_low"]), float(frame["lift_high"])]:
				var raised := unproject_lifted(frame, corner, lift)
				low = low.min(raised)
				high = high.max(raised)
	return [(high - low) * (1.0 + LAT_MARGIN * 2.0) + Vector2(0.001, 0.001), (low + high) * 0.5]


func _plane_view(frame: Dictionary, area: Rect2, texture: Vector2, cap: float) -> Dictionary:
	var measured := _plane_span(frame, area)
	var span: Vector2 = measured[0]
	var center: Vector2 = measured[1]
	var density := minf(cap, minf(texture.x / span.x, texture.y / span.y))
	var covered := texture / density
	return {
		"center": center,
		"density": density,
		"texture": Vector2i(texture),
		"rect": Rect2(center - covered * 0.5, covered),
	}


func _update_near() -> void:
	var pitch: float = _frame["pitch"]
	if pitch > deg_to_rad(NEAR_PITCH_DEG) and float(_frame["g"]) <= 0.0:
		_ensure_near_viewport()
		var size: Vector2 = _frame["size"]
		var top := size.y * NEAR_SPLIT
		_near = _plane_view(_frame, Rect2(Vector2(0.0, top), Vector2(size.x, size.y - top)), Vector2(_flat_size), float(_frame["px_per_world"]) * 2.0)
		_near_camera.position = _near["center"]
		_near_camera.zoom = Vector2.ONE * float(_near["density"])
		_near_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	else:
		_near = {}
		if _near_viewport:
			_near_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED


func _flat_view(frame: Dictionary, texture: Vector2) -> Dictionary:
	var size: Vector2 = frame["size"]
	var lon_c: float = frame["lon"]
	var lat_c: float = frame["lat"]
	var min_dlon := 0.0
	var max_dlon := 0.0
	var min_lat := lat_c
	var max_lat := lat_c
	var missed := false
	var g: float = frame["g"]
	var columns := 16
	var rows := 10
	for row in range(rows + 1):
		for column in range(columns + 1):
			var screen := Vector2(size.x * column / columns, size.y * row / rows)
			var lonlat := Vector2.ZERO
			if g >= 0.999:
				var hit := _hit(frame, screen)
				if not bool(hit["hit"]):
					missed = true
					continue
				lonlat = lonlat_of_dir(hit["point"])
			else:
				lonlat = lonlat_of_world(screen_to_world_flat(screen))
			var dlon := difference_of_angles(lon_c, lonlat.x)
			min_dlon = minf(min_dlon, dlon)
			max_dlon = maxf(max_dlon, dlon)
			min_lat = minf(min_lat, lonlat.y)
			max_lat = maxf(max_lat, lonlat.y)
	var pos: Vector3 = frame["pos"]
	var cap_d := pos.length()
	var axis := pos / cap_d
	if missed:
		var side := axis.cross(Vector3.UP)
		if side.length() < 1e-6:
			side = axis.cross(Vector3.RIGHT)
		side = side.normalized()
		var other := axis.cross(side)
		var ring := sqrt(maxf(0.0, 1.0 - 1.0 / (cap_d * cap_d)))
		for step in range(96):
			var angle := TAU * step / 96.0
			var p := (axis / cap_d + (side * cos(angle) + other * sin(angle)) * ring).normalized()
			var screen := _project_dir(frame, p)
			if screen.z <= 0.0 or screen.x < -64.0 or screen.y < -64.0 or screen.x > size.x + 64.0 or screen.y > size.y + 64.0:
				continue
			var lonlat := lonlat_of_dir(p)
			var dlon := difference_of_angles(lon_c, lonlat.x)
			min_dlon = minf(min_dlon, dlon)
			max_dlon = maxf(max_dlon, dlon)
			min_lat = minf(min_lat, lonlat.y)
			max_lat = maxf(max_lat, lonlat.y)
	for pole in [Vector3(0, 1, 0), Vector3(0, -1, 0)]:
		var pole_dir: Vector3 = pole
		if g > 0.0 and _visible_on_sphere(frame, pole_dir):
			var screen := _project_dir(frame, pole_dir)
			if screen.z > 0.0 and screen.x > -32.0 and screen.y > -32.0 and screen.x < size.x + 32.0 and screen.y < size.y + 32.0:
				min_dlon = -180.0
				max_dlon = 180.0
				if pole_dir.y > 0.0:
					max_lat = 90.0
				else:
					min_lat = -90.0
	var nadir := lonlat_of_dir(axis)
	var cap := rad_to_deg(acos(clampf(1.0 / cap_d, -1.0, 1.0)))
	for side_sign: float in [1.0, -1.0]:
		var edge_lat := nadir.y + cap * side_sign
		if g <= 0.0 or absf(edge_lat) >= 90.0:
			continue
		var edge_screen := _project_dir(frame, direction_of(nadir.x, edge_lat))
		if edge_screen.z > 0.0 and edge_screen.x > -32.0 and edge_screen.y > -32.0 and edge_screen.x < size.x + 32.0 and edge_screen.y < size.y + 32.0:
			min_lat = minf(min_lat, edge_lat)
			max_lat = maxf(max_lat, edge_lat)
	var west := lon_c + min_dlon
	var east_lon := lon_c + max_dlon
	var span := east_lon - west
	var margin := maxf(span * LAT_MARGIN, 0.0005)
	west -= margin
	east_lon += margin
	if east_lon - west > 360.0:
		var mid := (west + east_lon) * 0.5
		west = mid - 180.0
		east_lon = mid + 180.0
	var lat_margin := maxf((max_lat - min_lat) * LAT_MARGIN, 0.0005)
	var top := world_of_lonlat(0.0, minf(max_lat + lat_margin, MERCATOR_LIMIT)).y
	var bottom := world_of_lonlat(0.0, maxf(min_lat - lat_margin, -MERCATOR_LIMIT)).y
	var x0 := (west + 180.0) / 360.0 * MapView.WORLD_WIDTH
	var x1 := (east_lon + 180.0) / 360.0 * MapView.WORLD_WIDTH
	var width := maxf(x1 - x0, 0.001)
	var height := maxf(bottom - top, 0.001)
	var equator_lat := 0.0
	if min_lat > 0.0:
		equator_lat = min_lat
	elif max_lat < 0.0:
		equator_lat = -max_lat
	var factor := clampf(cos(deg_to_rad(equator_lat)) / cos(deg_to_rad(lat_c)), 1.0, 3.0)
	var density := minf(float(frame["px_per_world"]) * factor, minf(texture.x / width, texture.y / height))
	var center := Vector2(x0 + width * 0.5, top + height * 0.5)
	var covered := texture / density
	return {
		"center": center,
		"density": density,
		"texture": Vector2i(texture),
		"rect": Rect2(center - covered * 0.5, covered),
	}


func after_camera_move() -> void:
	if not active or _flat.is_empty():
		return
	var frame := _frame
	var size: Vector2 = frame["size"]
	var rect: Rect2 = _flat["rect"]
	var moving := _is_moving() or Time.get_ticks_msec() - _last_interaction < 200
	var interactive := moving or (enabled and not idle_rotation_disabled and not rotation_paused)
	var budget := INTERACTIVE_RENDER_PIXELS if interactive else REFINED_RENDER_PIXELS
	var scale := minf(1.0, sqrt(budget / maxf(size.x * size.y, 1.0)))
	var pitch: float = frame["pitch"]
	for material: ShaderMaterial in [_material, _light_material]:
		material.set_shader_parameter("screen_size", size)
		material.set_shader_parameter("cam_pos", frame["pos"])
		material.set_shader_parameter("cam_right", frame["right"])
		material.set_shader_parameter("cam_up", frame["up"])
		material.set_shader_parameter("cam_fwd", frame["fwd"])
		material.set_shader_parameter("focal", frame["focal"])
	_material.set_shader_parameter("flat_right", frame["flat_right"])
	_material.set_shader_parameter("flat_up", frame["flat_up"])
	_material.set_shader_parameter("pitch_sin", sin(pitch))
	_material.set_shader_parameter("pitch_cos", cos(pitch))
	_material.set_shader_parameter("globeness", frame["g"])
	_material.set_shader_parameter("clamp_poles", float(frame["g"]) > 0.0)
	_material.set_shader_parameter("flat_rect", Vector4(rect.position.x, rect.position.y, rect.size.x, rect.size.y))
	_material.set_shader_parameter("cam_world", frame["cam_world"])
	_material.set_shader_parameter("px_per_world", frame["px_per_world"])
	_material.set_shader_parameter("radius_px", frame["radius"])
	_material.set_shader_parameter("texel_world", 1.0 / float(_flat["density"]))
	_material.set_shader_parameter("world_width", MapView.WORLD_WIDTH)
	_material.set_shader_parameter("use_near", not _near.is_empty())
	if not _near.is_empty():
		var near_rect: Rect2 = _near["rect"]
		_material.set_shader_parameter("near_rect", Vector4(near_rect.position.x, near_rect.position.y, near_rect.size.x, near_rect.size.y))
		_material.set_shader_parameter("near_texel_world", 1.0 / float(_near["density"]))
	_light_material.set_shader_parameter("overlay", frame["opacity"])
	_light_material.set_shader_parameter("sun_dir", _sun_dir)
	_light_material.set_shader_parameter("render_pixel", 1.0 / scale)
	_light_material.set_shader_parameter("terrain_radii", TERRAIN_EXAGGERATION * MAX_TERRAIN_ELEVATION_M / EARTH_RADIUS_M if terrain_on else 0.0)
	var wrapped := true
	if map_view.basemap and map_view.basemap.has_method("wrap_enabled"):
		wrapped = bool(map_view.basemap.call("wrap_enabled"))
	_material.set_shader_parameter("wrap_world", wrapped)
	_material.set_shader_parameter("horizon_y", size.y * 0.5 - mercator_horizon(float(frame["focal"]), rad_to_deg(pitch)))
	_material.set_shader_parameter("sky_horizon_px", SKY_HORIZON_BLEND * size.y * 0.5)
	_apply_relief(frame)
	_space.color = Color.BLACK if enabled else FLAT_SPACE
	labels.sync(rect, label_uniforms(frame))
	_stars.queue_redraw()
	_place_sun(frame)


func _apply_relief(frame: Dictionary) -> void:
	if relief == null:
		return
	if relief.enabled:
		relief.update(frame, _flat.get("rect", Rect2()))
	var lifted := bool(frame.get("relief", false)) and relief.lod_texture != null
	_material.set_shader_parameter("relief_on", lifted)
	if not lifted:
		return
	var rects := PackedVector4Array()
	for level in range(TerrainRelief.LEVELS):
		var rect := relief.level_rects[level]
		var size := relief.level_sizes[level]
		rects.append(Vector4(rect.position.x, rect.position.y, rect.size.x / float(size.x), 0.0))
		_material.set_shader_parameter("dem_%d" % level, relief.texture_for(level))
	_material.set_shader_parameter("dem_rect", rects)
	_material.set_shader_parameter("lod_map", relief.lod_texture)
	_material.set_shader_parameter("lod_rect", Vector4(relief.lod_rect.position.x, relief.lod_rect.position.y, relief.lod_cell, 0.0))
	_material.set_shader_parameter("lod_size", relief.lod_size)
	_material.set_shader_parameter("relief_scale", TerrainRelief.EXAGGERATION)
	_material.set_shader_parameter("relief_low", frame["relief_low"])
	_material.set_shader_parameter("relief_high", frame["relief_high"])
	_material.set_shader_parameter("relief_step", relief.step)
	_material.set_shader_parameter("centre_elevation", frame["centre_h"])
	_material.set_shader_parameter("px_per_meter", frame["ppm"])


func _place_sun(frame: Dictionary) -> void:
	var opacity: float = frame["opacity"]
	var size: Vector2 = frame["size"]
	var projected := _project_dir(frame, _sun_dir * CELESTIAL_RADIUS)
	if opacity <= 0.0 or projected.z <= 0.0:
		_sun.modulate.a = 0.0
		return
	var ndc := Vector2(projected.x / size.x * 2.0 - 1.0, 1.0 - projected.y / size.y * 2.0)
	if absf(ndc.x) > 4.0 or absf(ndc.y) > 4.0 or projected.x <= -180.0 or projected.x >= size.x + 180.0 or projected.y <= -180.0 or projected.y >= size.y + 180.0:
		_sun.modulate.a = 0.0
		return
	_sun.position = Vector2(projected.x, projected.y) - _sun.size * 0.5
	_sun.modulate.a = opacity


func constrain() -> void:
	var camera := map_view.camera
	var lonlat := lonlat_of_world(camera.position)
	var lat: float = clampf(lonlat.y, -MAX_VALID_LATITUDE, MAX_VALID_LATITUDE)
	if not is_equal_approx(lat, lonlat.y):
		camera.position.y = world_of_lonlat(lonlat.x, lat).y
	var min_level := MIN_ZOOM_LEVEL + zoom_adjustment(0.0, lat)
	var level := map_view.zoom_level()
	if level < min_level:
		camera.zoom = Vector2.ONE * pow(2.0, min_level) / 8.0


func _set_center(lon: float, lat: float) -> void:
	var camera := map_view.camera
	var world := world_of_lonlat(wrap_longitude(lon), clampf(lat, -MAX_VALID_LATITUDE, MAX_VALID_LATITUDE))
	camera.position = world


func _set_zoom(level: float) -> void:
	var lat := lonlat_of_world(map_view.camera.position).y
	var low := MIN_ZOOM_LEVEL + zoom_adjustment(0.0, lat)
	var high := log(8.0 * MapView.MAX_ZOOM) / log(2.0)
	map_view.camera.zoom = Vector2.ONE * pow(2.0, clampf(level, low, high)) / 8.0


func _pan(delta: Vector2) -> void:
	var camera := map_view.camera
	var lonlat := lonlat_of_world(camera.position)
	var lat := lonlat.y
	var zoom := map_view.zoom_level()
	var turned := delta.rotated(deg_to_rad(map_view.bearing))
	var normalized_zoom := zoom + zoom_adjustment(lat, 0.0)
	var lng_speed := lerpf(1.0 / cos(deg_to_rad(lat)), 1.0 / cos(deg_to_rad(minf(absf(lat), 60.0))), remap_saturate(normalized_zoom, 7.0, 3.0, 0.0, 1.0))
	var degrees_per_pixel := 360.0 / (TAU * globe_radius(zoom, lat))
	var new_lon := lonlat.x - turned.x * degrees_per_pixel * lng_speed
	var new_lat := clampf(lat + turned.y * degrees_per_pixel, -MAX_VALID_LATITUDE, MAX_VALID_LATITUDE)
	_set_center(new_lon, new_lat)
	_set_zoom(zoom + zoom_adjustment(lat, new_lat))


func _set_location_at_point(target: Vector2, screen: Vector2) -> void:
	var frame := _compute_frame()
	var pixel_lonlat := _unproject_location(frame, screen)
	var current := direction_of(pixel_lonlat.x, pixel_lonlat.y)
	var wanted := direction_of(target.x, target.y)
	var lon_c: float = frame["lon"]
	var lat_c: float = frame["lat"]
	var rotated := current.rotated(Vector3.UP, -deg_to_rad(lon_c))
	rotated = rotated.rotated(Vector3.RIGHT, deg_to_rad(lat_c))
	var xz_squared := wanted.x * wanted.x + wanted.z * wanted.z
	var target_x_squared := rotated.x * rotated.x
	if xz_squared < target_x_squared:
		return
	var intersection_a := sqrt(xz_squared - target_x_squared)
	var intersection_b := -intersection_a
	var lng_a := angle_between_2d(wanted.x, wanted.z, rotated.x, intersection_a)
	var lng_b := angle_between_2d(wanted.x, wanted.z, rotated.x, intersection_b)
	var wanted_a := wanted.rotated(Vector3.UP, -lng_a)
	var lat_a := angle_between_2d(wanted_a.y, wanted_a.z, rotated.y, rotated.z)
	var wanted_b := wanted.rotated(Vector3.UP, -lng_b)
	var lat_b := angle_between_2d(wanted_b.y, wanted_b.z, rotated.y, rotated.z)
	var limit := PI * 0.5
	var valid_a := lat_a >= -limit and lat_a <= limit
	var valid_b := lat_b >= -limit and lat_b <= limit
	var lng := 0.0
	var lat := 0.0
	if valid_a and valid_b:
		var center_lng := deg_to_rad(lon_c)
		var center_lat := deg_to_rad(lat_c)
		if distance_of_angles(lng_a, center_lng) + distance_of_angles(lat_a, center_lat) < distance_of_angles(lng_b, center_lng) + distance_of_angles(lat_b, center_lat):
			lng = lng_a
			lat = lat_a
		else:
			lng = lng_b
			lat = lat_b
	elif valid_a:
		lng = lng_a
		lat = lat_a
	elif valid_b:
		lng = lng_b
		lat = lat_b
	else:
		return
	var old_lat := lat_c
	var zoom := map_view.zoom_level()
	_set_center(rad_to_deg(lng), clampf(rad_to_deg(lat), -90.0, 90.0))
	_set_zoom(zoom + zoom_adjustment(old_lat, lonlat_of_world(map_view.camera.position).y))


func _zoom_around(screen: Vector2, delta_zoom: float) -> void:
	var frame := _compute_frame()
	var zoom_location := _unproject_location(frame, screen)
	var old_zoom_pre := map_view.zoom_level()
	_set_zoom(old_zoom_pre + delta_zoom)
	var actual := map_view.zoom_level() - old_zoom_pre
	if absf(actual) < 1e-9:
		return
	frame = _compute_frame()
	var lon_c: float = frame["lon"]
	var lat_c: float = frame["lat"]
	var d_lng_raw := difference_of_angles(lon_c, zoom_location.x)
	var d_lng := d_lng_raw / (absf(d_lng_raw / 180.0) + 1.0)
	var d_lat := difference_of_angles(lat_c, zoom_location.y)
	var origin: Vector3 = frame["pos"]
	var ray := _ray(frame, screen)
	var closest_distance := -origin.dot(ray)
	var closest := origin + ray * closest_distance
	var surface_distance := closest.length() - 1.0
	var distance_factor := exp(-maxf(surface_distance - 0.3, 0.0) * 0.5)
	var size: Vector2 = frame["size"]
	var radius: float = float(frame["radius"]) / minf(size.x, size.y)
	var radius_factor := remap_saturate(radius, 0.9, 0.5, 1.0, 0.25)
	var factor := (1.0 - pow(2.0, -actual)) * minf(distance_factor, radius_factor)
	var old_center_lat := lat_c
	var old_zoom := map_view.zoom_level()
	var heuristic := Vector2(lon_c + d_lng * factor, clampf(lat_c + d_lat * factor, -MAX_VALID_LATITUDE, MAX_VALID_LATITUDE))
	_set_location_at_point(zoom_location, screen)
	var exact := lonlat_of_world(map_view.camera.position)
	var by_longitude := remap_saturate(absf(d_lng_raw), 45.0, 85.0, 0.0, 1.0)
	var by_radius := remap_saturate(radius, 0.75, 0.35, 0.0, 1.0)
	var heuristic_factor := pow(maxf(by_longitude, by_radius), 0.25)
	var lng_shift := difference_of_angles(exact.x, heuristic.x)
	var lat_shift := difference_of_angles(exact.y, heuristic.y)
	_set_center(exact.x + lng_shift * heuristic_factor, exact.y + lat_shift * heuristic_factor)
	_set_zoom(old_zoom + zoom_adjustment(old_center_lat, lonlat_of_world(map_view.camera.position).y))


func _globe_controls() -> bool:
	return enabled and globeness() > 0.0


func pan_by(delta: Vector2, around := Vector2(-1.0, -1.0), dragging := false) -> void:
	if not active:
		return
	if _globe_controls():
		if dragging:
			terrain_movement_begin()
		_pan(delta)
	else:
		var size := map_view.get_viewport_rect().size
		var at := around if around.x >= 0.0 else size * 0.5
		var first := terrain_movement_begin() if dragging else true
		var frame := _compute_frame()
		if first:
			var grabbed := _flat_unproject(frame, at - delta)
			map_view.camera.position = grabbed - (_flat_unproject(frame, at) - map_view.camera.position)
		else:
			map_view.camera.position = _flat_unproject(frame, size * 0.5 - delta)
	_moved()


func zoom_around(screen: Vector2, delta_zoom: float, gesture := false) -> void:
	if not active or absf(delta_zoom) < 1e-9:
		return
	if gesture:
		terrain_movement_begin()
	if _globe_controls():
		_zoom_around(screen, delta_zoom)
	else:
		var frame := _compute_frame()
		var location := _flat_unproject(frame, screen)
		var limits := zoom_limits()
		map_view.camera.zoom = Vector2.ONE * pow(2.0, clampf(map_view.zoom_level() + delta_zoom, limits.x, limits.y)) / 8.0
		frame = _compute_frame()
		map_view.camera.position = location - (_flat_unproject(frame, screen) - map_view.camera.position)
	_moved()


func zoom_limits() -> Vector2:
	if not enabled:
		return Vector2(log(8.0 * MapView.MIN_ZOOM) / log(2.0), log(8.0 * MapView.MAX_ZOOM) / log(2.0))
	var lat := lonlat_of_world(map_view.camera.position).y
	return Vector2(MIN_ZOOM_LEVEL + zoom_adjustment(0.0, lat), log(8.0 * MapView.MAX_ZOOM) / log(2.0))


func centre_lonlat() -> Vector2:
	return lonlat_of_world(map_view.camera.position)


func set_centre_zoom(lonlat: Vector2, zoom: float) -> void:
	if not active:
		return
	_set_center(lonlat.x, lonlat.y)
	_set_zoom(zoom)
	_moved()


func _moved() -> void:
	_moving_until = Time.get_ticks_msec() + 120
	map_view.call("_after_camera_move")


func depth_at(point: Vector2) -> float:
	if not active:
		return 1.0
	if _fast_ready():
		return _fast.depth_at(point)
	var frame := current_frame()
	if bool(frame.get("relief", false)):
		return maxf(_lifted_clip(frame, point, _height(frame, point)).z, 1e-3) / float(frame["focal"])
	var clip := _flat_clip(frame, point)
	var g: float = frame["g"]
	if g > 0.0:
		clip = clip.lerp(_globe_clip(frame, point), g)
	return maxf(clip.z, 1e-3) / float(frame["focal"])


static func sun_image() -> Image:
	var size := 176
	var half := size * 0.5
	var ray := 44.0 * sqrt(2.0)
	var stops: Array = [
		[0.0, Color(1, 1, 1, 1)],
		[0.07, Color(1, 1, 1, 1)],
		[0.08, Color8(255, 246, 207, 255)],
		[0.12, Color8(255, 246, 207, 255)],
		[0.15, Color(1.0, 219.0 / 255.0, 142.0 / 255.0, 0.8)],
		[0.31, Color(1.0, 185.0 / 255.0, 93.0 / 255.0, 0.26)],
		[0.52, Color(1.0, 154.0 / 255.0, 65.0 / 255.0, 0.07)],
		[0.72, Color(0, 0, 0, 0)],
	]
	var element := PackedFloat32Array()
	element.resize(size * size * 4)
	var alpha := PackedFloat32Array()
	alpha.resize(size * size)
	for y in range(size):
		for x in range(size):
			var r := Vector2(x + 0.5 - half, y + 0.5 - half).length()
			var premultiplied := Vector4.ZERO
			if r <= 44.0:
				var t := r / ray
				var low: Array = stops[stops.size() - 1]
				var high: Array = stops[stops.size() - 1]
				for index in range(stops.size() - 1):
					var a: Array = stops[index]
					var b: Array = stops[index + 1]
					if t <= float(b[0]):
						low = a
						high = b
						break
				var span := float(high[0]) - float(low[0])
				var mix_amount := 0.0 if span <= 0.0 else clampf((t - float(low[0])) / span, 0.0, 1.0)
				var ca: Color = low[1]
				var cb: Color = high[1]
				var pa := Vector4(ca.r * ca.a, ca.g * ca.a, ca.b * ca.a, ca.a)
				var pb := Vector4(cb.r * cb.a, cb.g * cb.a, cb.b * cb.a, cb.a)
				premultiplied = pa.lerp(pb, mix_amount)
			var at := (y * size + x) * 4
			element[at] = premultiplied.x
			element[at + 1] = premultiplied.y
			element[at + 2] = premultiplied.z
			element[at + 3] = premultiplied.w
			alpha[y * size + x] = premultiplied.w
	var sigma := 6.0
	var radius := 18
	var kernel := PackedFloat32Array()
	var total := 0.0
	for offset in range(-radius, radius + 1):
		var value := exp(-float(offset * offset) / (2.0 * sigma * sigma))
		kernel.append(value)
		total += value
	for index in range(kernel.size()):
		kernel[index] /= total
	var pass_x := PackedFloat32Array()
	pass_x.resize(size * size)
	for y in range(size):
		for x in range(size):
			var sum := 0.0
			for offset in range(-radius, radius + 1):
				var sx := x + offset
				if sx >= 0 and sx < size:
					sum += alpha[y * size + sx] * kernel[offset + radius]
			pass_x[y * size + x] = sum
	var image := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var glow := Color(1.0, 218.0 / 255.0, 145.0 / 255.0)
	for y in range(size):
		for x in range(size):
			var sum := 0.0
			for offset in range(-radius, radius + 1):
				var sy := y + offset
				if sy >= 0 and sy < size:
					sum += pass_x[sy * size + x] * kernel[offset + radius]
			var shadow_alpha := sum * 0.75
			var at := (y * size + x) * 4
			var element_alpha := element[at + 3]
			var out_alpha := element_alpha + shadow_alpha * (1.0 - element_alpha)
			var out_r := element[at] + glow.r * shadow_alpha * (1.0 - element_alpha)
			var out_g := element[at + 1] + glow.g * shadow_alpha * (1.0 - element_alpha)
			var out_b := element[at + 2] + glow.b * shadow_alpha * (1.0 - element_alpha)
			if out_alpha > 0.0:
				image.set_pixel(x, y, Color(out_r / out_alpha, out_g / out_alpha, out_b / out_alpha, out_alpha))
			else:
				image.set_pixel(x, y, Color(0, 0, 0, 0))
	return image


static func star_catalogue() -> Array:
	var state := 0x51f15e
	var stars: Array = []
	for index in range(STAR_COUNT):
		var values := PackedFloat64Array()
		var count := 6 if index >= 1100 else 4
		for _draw in range(count):
			state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
			values.append(float(state) / 4294967296.0)
		var in_milky_way := index >= 1100
		var longitude := values[0] * PI * 2.0
		var latitude := 0.0
		var cursor := 1
		if in_milky_way:
			latitude = (values[1] + values[2] + values[3] - 1.5) * 0.16
			cursor = 4
		else:
			latitude = asin(values[1] * 2.0 - 1.0)
			cursor = 2
		var brightness := pow(values[cursor], 4.0)
		var warmth := values[cursor + 1]
		var scale := cos(latitude)
		var colour := Color8(238, 244, 255)
		if warmth > 0.92:
			colour = Color8(255, 224, 190)
		elif warmth < 0.08:
			colour = Color8(190, 218, 255)
		stars.append({
			"direction": Vector3(sin(longitude) * scale, sin(latitude), cos(longitude) * scale),
			"alpha": (0.2 if in_milky_way else 0.3) + brightness * 0.7,
			"radius": 0.35 + brightness * 1.45,
			"color": colour,
		})
	return stars


class StarField extends Control:
	var globe: GlobeView
	var _stars: Array = []
	var _directions := PackedVector3Array()

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_stars = GlobeView.star_catalogue()
		for star: Dictionary in _stars:
			_directions.append(star["direction"])

	func _draw() -> void:
		if not globe or not globe.active:
			return
		var frame := globe.current_frame()
		var opacity: float = frame["opacity"]
		if opacity <= 0.0:
			return
		if globe._fast_ready():
			for seen: Vector3 in globe._fast.visible_directions(_directions, GlobeView.CELESTIAL_RADIUS):
				_draw_star(_stars[int(seen.z)], Vector2(seen.x, seen.y), opacity)
			return
		var size: Vector2 = frame["size"]
		for star in _stars:
			var direction: Vector3 = star["direction"]
			var projected := globe._project_dir(frame, direction * GlobeView.CELESTIAL_RADIUS)
			if projected.z <= 0.0:
				continue
			var ndc := Vector2(projected.x / size.x * 2.0 - 1.0, 1.0 - projected.y / size.y * 2.0)
			if absf(ndc.x) > 4.0 or absf(ndc.y) > 4.0:
				continue
			if projected.x < -4.0 or projected.x > size.x + 4.0 or projected.y < -4.0 or projected.y > size.y + 4.0:
				continue
			_draw_star(star, Vector2(projected.x, projected.y), opacity)

	func _draw_star(star: Dictionary, at: Vector2, opacity: float) -> void:
		var colour: Color = star["color"]
		colour.a = float(star["alpha"]) * opacity
		var radius: float = star["radius"]
		if radius < 0.75:
			draw_rect(Rect2(at.x, at.y, 0.8, 0.8), colour)
		else:
			draw_circle(at, radius, colour)
