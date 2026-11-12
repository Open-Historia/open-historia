class_name WarPaint
extends Node

const PICTURE_SHADER := """
shader_type canvas_item;
render_mode unshaded, blend_disabled;
uniform sampler2D cells : filter_nearest, repeat_disable;
uniform sampler2D since : filter_nearest, repeat_disable;
uniform sampler2D palette : filter_nearest, repeat_disable;
uniform int cols = 2;
uniform int rows = 2;
uniform float day = 0.0;
uniform int first_of_b = 1;
uniform bool masked = true;
uniform sampler2D land : filter_linear, repeat_disable;
uniform bool use_land = false;
uniform vec2 picture_size = vec2(1.0, 1.0);
uniform ivec4 window = ivec4(0, 0, 0, 0);
uniform ivec4 near = ivec4(0, 0, 0, 0);
uniform ivec4 reads = ivec4(0, 0, 0, 0);
const int WALL = 31;
const int OWN_B = 30;
const float FILL_DAYS = 0.75;

int side_of(int value) {
	if (value == 0) {
		return 0;
	}
	if (value == OWN_B) {
		return 1;
	}
	return value < first_of_b ? 0 : 1;
}

bool is_paint(int value) {
	return value != 0 && value != OWN_B && value != WALL;
}

vec3 info(ivec2 c) {
	vec4 t = texelFetch(cells, c, 0);
	int now = int(t.r * 255.0 + 0.5);
	if (now == WALL) {
		return vec3(float(WALL), 0.0, 0.0);
	}
	int before = int(t.g * 255.0 + 0.5);
	float part = (day - texelFetch(since, c, 0).r) / FILL_DAYS;
	float turned = (before != WALL && side_of(before) != side_of(now) && part < 1.0) ? max(0.0, part) : 1.0;
	float share = side_of(now) == 0 ? turned : 1.0 - turned;
	if (is_paint(now)) {
		return vec3(float(now), turned, share);
	}
	if (is_paint(before) && turned < 1.0) {
		return vec3(float(before), 1.0 - turned, share);
	}
	return vec3(0.0, 0.0, share);
}

int tint_of(vec3 value) {
	return int(value.x + 0.5);
}

float even_at(ivec2 c) {
	vec3 own = info(c);
	if (tint_of(own) == WALL) {
		return 0.0;
	}
	float sum = own.z * 4.0;
	float weight = 4.0;
	for (int dy = -1; dy <= 1; dy++) {
		int r = c.y + dy;
		if (r < reads.z || r > reads.w) {
			continue;
		}
		for (int dx = -1; dx <= 1; dx++) {
			int cc = c.x + dx;
			if ((dx == 0 && dy == 0) || cc < reads.x || cc > reads.y) {
				continue;
			}
			vec3 other = info(ivec2(cc, r));
			if (tint_of(other) == WALL) {
				continue;
			}
			float part = (dx == 0 || dy == 0) ? 2.0 : 1.0;
			sum += other.z * part;
			weight += part;
		}
	}
	return sum / weight;
}

float land_at(vec2 uv) {
	vec2 px = floor(uv * picture_size);
	float sum = 0.0;
	for (int j = 0; j < 4; j++) {
		for (int i = 0; i < 4; i++) {
			sum += texture(land, (px + (vec2(float(i), float(j)) + 0.5) * 0.25) / picture_size).a;
		}
	}
	return floor(sum / 16.0 * 255.0 + 0.5) / 255.0;
}

vec4 paint_at(vec2 uv) {
	float u = uv.x * float(cols);
	float v = float(rows) - uv.y * float(rows);
	int own_row = int(floor(v));
	int own_col = int(floor(u));
	if (own_row < window.z || own_row > window.w || own_col < window.x || own_col > window.y) {
		return vec4(0.0);
	}
	float cover = use_land ? land_at(uv) : 1.0;
	if (cover <= 0.0) {
		return vec4(0.0);
	}
	int row_a = clamp(int(floor(v - 0.5)), near.z, near.w);
	int row_b = clamp(row_a + 1, near.z, near.w);
	float fv = clamp(v - 0.5 - float(row_a), 0.0, 1.0);
	ivec2 own = ivec2(own_col, own_row);
	vec3 own_info = info(own);
	if (tint_of(own_info) == WALL) {
		if (!masked) {
			return vec4(0.0);
		}
		int code = int(texelFetch(cells, own, 0).b * 255.0 + 0.5);
		if (code >= 9) {
			return vec4(0.0);
		}
		own = own + ivec2(code % 3 - 1, code / 3 - 1);
		own_info = info(own);
		if (tint_of(own_info) == WALL) {
			return vec4(0.0);
		}
	}
	int col_a = clamp(int(floor(u - 0.5)), near.x, near.y);
	int col_b = clamp(col_a + 1, near.x, near.y);
	float fu = clamp(u - 0.5 - float(col_a), 0.0, 1.0);
	ivec2 c00 = ivec2(col_a, row_a);
	ivec2 c10 = ivec2(col_b, row_a);
	ivec2 c01 = ivec2(col_a, row_b);
	ivec2 c11 = ivec2(col_b, row_b);
	vec3 i00 = info(c00);
	vec3 i10 = info(c10);
	vec3 i01 = info(c01);
	vec3 i11 = info(c11);
	int best = -1;
	float most = 0.0;
	if (own_info.y > 0.0) {
		best = 0;
		most = own_info.y;
	}
	if (i00.y > most) {
		best = 1;
		most = i00.y;
	}
	if (i10.y > most) {
		best = 2;
		most = i10.y;
	}
	if (i01.y > most) {
		best = 3;
		most = i01.y;
	}
	if (i11.y > most) {
		best = 4;
		most = i11.y;
	}
	if (best < 0) {
		return vec4(0.0);
	}
	float e_own = 0.0;
	bool any_wall = tint_of(i00) == WALL || tint_of(i10) == WALL || tint_of(i01) == WALL || tint_of(i11) == WALL;
	if (any_wall) {
		e_own = even_at(own);
	}
	float e00 = tint_of(i00) == WALL ? e_own : even_at(c00);
	float e10 = tint_of(i10) == WALL ? e_own : even_at(c10);
	float e01 = tint_of(i01) == WALL ? e_own : even_at(c01);
	float e11 = tint_of(i11) == WALL ? e_own : even_at(c11);
	float side_zero = (e00 * (1.0 - fu) + e10 * fu) * (1.0 - fv) + (e01 * (1.0 - fu) + e11 * fu) * fv;
	int colour_state = tint_of(best == 0 ? own_info : (best == 1 ? i00 : (best == 2 ? i10 : (best == 3 ? i01 : i11))));
	float value = side_of(colour_state) == 0 ? side_zero : 1.0 - side_zero;
	if (value <= 0.4) {
		return vec4(0.0);
	}
	float solid = min(1.0, (value - 0.4) / 0.2);
	solid = solid * solid * (3.0 - 2.0 * solid);
	float alpha = floor(255.0 * solid * cover + 0.5) / 255.0;
	vec3 rgb = texelFetch(palette, ivec2(colour_state, 0), 0).rgb;
	return vec4(rgb * alpha, alpha);
}

void fragment() {
	COLOR = paint_at(UV);
}
"""

const FIELD_SHADER := """
shader_type canvas_item;
render_mode unshaded, blend_disabled;
uniform sampler2D cells : filter_nearest, repeat_disable;
uniform sampler2D since : filter_nearest, repeat_disable;
uniform sampler2D touched : filter_nearest, repeat_disable;
uniform int cols = 2;
uniform int rows = 2;
uniform float day = 0.0;
uniform int first_of_b = 1;
uniform ivec4 near = ivec4(1, 0, 1, 0);
const int WALL = 31;
const int OWN_B = 30;
const float FILL_DAYS = 0.75;
const int SEEK = 24;

int side_of(int value) {
	if (value == 0) {
		return 0;
	}
	if (value == OWN_B) {
		return 1;
	}
	return value < first_of_b ? 0 : 1;
}

float share_at(ivec2 c) {
	vec4 t = texelFetch(cells, c, 0);
	int now = int(t.r * 255.0 + 0.5);
	if (now == WALL) {
		return -1.0;
	}
	int before = int(t.g * 255.0 + 0.5);
	float part = (day - texelFetch(since, c, 0).r) / FILL_DAYS;
	float turned = (before != WALL && side_of(before) != side_of(now) && part < 1.0) ? max(0.0, part) : 1.0;
	return side_of(now) == 1 ? turned : 1.0 - turned;
}

float even_at(ivec2 c) {
	float own = share_at(c);
	float sum = own < 0.0 ? 0.0 : own * 4.0;
	float weight = own < 0.0 ? 0.0 : 4.0;
	for (int dy = -1; dy <= 1; dy++) {
		int r = c.y + dy;
		if (r < 0 || r >= rows) {
			continue;
		}
		for (int dx = -1; dx <= 1; dx++) {
			int cc = c.x + dx;
			if ((dx == 0 && dy == 0) || cc < 0 || cc >= cols) {
				continue;
			}
			float value = share_at(ivec2(cc, r));
			if (value < 0.0) {
				continue;
			}
			float part = (dx == 0 || dy == 0) ? 2.0 : 1.0;
			sum += value * part;
			weight += part;
		}
	}
	return weight > 0.0 ? sum / weight : -1.0;
}

void fragment() {
	ivec2 c = ivec2(int(floor(UV.x * float(cols))), rows - 1 - int(floor(UV.y * float(rows))));
	c = clamp(c, ivec2(0, 0), ivec2(cols - 1, rows - 1));
	float land = share_at(c) >= 0.0 ? 1.0 : 0.0;
	if (c.x < near.x || c.x > near.y || c.y < near.z || c.y > near.w) {
		COLOR = vec4(0.5, 0.0, land, 1.0);
	} else {
		float value = even_at(c);
		for (int step = 1; step <= SEEK && value < 0.0; step++) {
			if (c.x - step < 0) {
				break;
			}
			value = even_at(ivec2(c.x - step, c.y));
		}
		for (int step = 1; step <= SEEK && value < 0.0; step++) {
			if (c.x + step >= cols) {
				break;
			}
			value = even_at(ivec2(c.x + step, c.y));
		}
		if (value < 0.0) {
			value = 0.5;
		}
		COLOR = vec4(clamp(value, 0.0, 1.0), texelFetch(touched, c, 0).r, land, 1.0);
	}
}
"""

const PUT_SHADER := """
shader_type canvas_item;
render_mode unshaded, blend_premul_alpha;
uniform sampler2D picture : filter_linear, repeat_disable;
uniform sampler2D screen : hint_screen_texture, filter_nearest, repeat_disable;
uniform sampler2D field : filter_linear, repeat_disable;
uniform bool use_field = false;
uniform vec3 line = vec3(0.0, 0.0, 0.0);
uniform vec4 core = vec4(0.0);
uniform vec4 casing = vec4(0.0);
uniform vec4 rect = vec4(0.0, 0.0, 1.0, 1.0);
uniform float strength = 0.6;
uniform float world_width = 4096.0;
varying vec2 world;

void vertex() {
	world = VERTEX;
}

float coverage(float far, float width, float blur) {
	return clamp((0.5 * width + 0.5 - far) / (blur + 1.0), 0.0, 1.0);
}

vec4 over(vec3 rgb, float alpha, vec4 under) {
	return vec4(rgb * alpha, alpha) + under * (1.0 - alpha);
}

void fragment() {
	vec2 uv = (world - rect.xy) / rect.zw;
	if (uv.x < 0.0) {
		uv.x += world_width / rect.z;
	} else if (uv.x > 1.0) {
		uv.x -= world_width / rect.z;
	}
	bool inside = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
	vec4 front = texture(field, clamp(uv, vec2(0.0), vec2(1.0)));
	float side = front.r - 0.5;
	float steep = length(vec2(dFdx(side), dFdy(side)));
	vec4 paint = inside ? texture(picture, uv) : vec4(0.0);
	vec3 base = texture(screen, SCREEN_UV).rgb;
	vec4 result = vec4(base * (1.0 - strength) * paint.a + paint.rgb * strength, paint.a);
	if (use_field && inside && line.x > 0.0 && front.g > 0.0 && steep > 0.0) {
		float far = abs(side) / steep;
		float here = smoothstep(0.25, 0.75, front.g);
		result = over(casing.rgb, casing.a * here * coverage(far, line.y, line.z), result);
		result = over(core.rgb, core.a * here * coverage(far, line.x, 0.0), result);
	}
	if (result.a < 0.004) {
		discard;
	}
	COLOR = result;
}
"""

const MASK_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D members : filter_nearest, repeat_disable;
uniform int columns = 1024;

void vertex() {
	int region = int(UV.x + 0.5);
	float keep = texelFetch(members, ivec2(region % columns, region / columns), 0).r;
	if (keep < 0.5) {
		VERTEX = vec2(-1000000.0, -1000000.0);
	}
}

void fragment() {
	COLOR = vec4(1.0);
}
"""

const COLUMNS := 1024
const TOUCH_REACH := 2
const BORDER_CORE := Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.94 * 0.96)
const BORDER_CASING := Color(1 / 255.0, 4 / 255.0, 8 / 255.0, 0.52 * 0.72)


class Field extends RefCounted:
	var run := ""
	var name := ""
	var cols := 2
	var rows := 2
	var scale := 2
	var masked := true
	var first_of_b := 1
	var has_bounds := false
	var bounds := Vector4i(0, 0, 0, 0)
	var began := PackedByteArray()
	var ticks := PackedInt32Array()
	var cells := PackedInt32Array()
	var states := PackedByteArray()
	var beside := PackedByteArray()
	var rgba := PackedByteArray()
	var since := PackedFloat32Array()
	var applied := 0
	var day := -INF
	var rect := Rect2(0, 0, 1, 1)
	var shown := false
	var dirty := true
	var data_image: Image
	var data_texture: ImageTexture
	var since_image: Image
	var since_texture: ImageTexture
	var palette_image: Image
	var palette_texture: ImageTexture
	var members_image: Image
	var members_texture: ImageTexture
	var members_key := 0
	var members_set := false
	var mask_viewport: SubViewport
	var mask_root: Node2D
	var mask_material: ShaderMaterial
	var mask_mesh: Mesh
	var viewport: SubViewport
	var picture_material: ShaderMaterial
	var put_material: ShaderMaterial
	var touched := PackedByteArray()
	var touched_texture: ImageTexture
	var field_viewport: SubViewport
	var field_material: ShaderMaterial
	var members := PackedInt32Array()
	var side_names: Array = [[], []]

	func reset() -> void:
		var size := cols * rows
		rgba.resize(size * 4)
		for cell in range(size):
			var value := began[cell] if cell < began.size() else 31
			var at := cell * 4
			rgba[at] = value
			rgba[at + 1] = value
			rgba[at + 2] = beside[cell] if cell < beside.size() else 255
			rgba[at + 3] = 255
		since.resize(size)
		since.fill(-1000000.0)
		applied = 0
		dirty = true

	func seek(to: float) -> void:
		if to < day:
			reset()
		if to != day:
			dirty = true
		day = to
		var tick := to * 16.0
		var size := cols * rows
		while applied < cells.size() and float(ticks[applied]) <= tick:
			var cell := cells[applied]
			if cell < size:
				var at := cell * 4
				rgba[at + 1] = rgba[at]
				rgba[at] = states[applied]
				since[cell] = float(ticks[applied]) / 16.0
			applied += 1

	func upload() -> void:
		data_image.set_data(cols, rows, false, Image.FORMAT_RGBA8, rgba)
		data_texture.update(data_image)
		since_image.set_data(cols, rows, false, Image.FORMAT_RF, since.to_byte_array())
		since_texture.update(since_image)
		picture_material.set_shader_parameter("day", day)
		viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
		if field_viewport:
			field_material.set_shader_parameter("day", day)
			field_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
		dirty = false


var map: MapView
var _fields: Dictionary = {}
var _order: Array[String] = []
var _backbuffer: BackBufferCopy
var _copy_nodes: Array[Node] = []
var _strength := 0.6
var _zoom := 1.0
var _line := Vector3.ZERO
var _cut_key := ""
var _cut_state: Dictionary = {}
var _sides_image: Image
var _sides_texture: ImageTexture
var cut_slots := 0


func setup(map_view: MapView) -> void:
	map = map_view
	_backbuffer = BackBufferCopy.new()
	_backbuffer.copy_mode = BackBufferCopy.COPY_MODE_VIEWPORT
	_backbuffer.visible = false
	map.war_insert_before_fills(_backbuffer)


func _material(code: String) -> ShaderMaterial:
	var shader := Shader.new()
	shader.code = code
	var material := ShaderMaterial.new()
	material.shader = shader
	return material


func _region_rows() -> int:
	return maxi(1, int(ceil(float(maxi(map.war_region_count(), 1)) / COLUMNS)))


func have_runs() -> Array:
	return _fields.keys()


func field(run: String) -> Field:
	return _fields.get(run, null)


func clear() -> void:
	for run in _fields.keys():
		_free_field(_fields[run])
	_fields.clear()
	_order.clear()
	_cut_state = {}
	rebuild_copies()


func set_fronts(fronts: Array) -> void:
	var wanted: Array[String] = []
	for front in fronts:
		var entry: Dictionary = front
		var run := str(entry.get("run", ""))
		wanted.append(run)
		var known: Field = _fields.get(run, null)
		var paint: Variant = entry.get("paint", null)
		if known == null:
			if not (paint is Dictionary):
				continue
			known = _make_field(entry, paint)
			_fields[run] = known
		_apply_palette(known, entry.get("palette", []))
		_apply_members(known, entry.get("members", []))
		_apply_sides(known, entry.get("sides", []))
	for run in _fields.keys():
		if not wanted.has(run):
			_free_field(_fields[run])
			_fields.erase(run)
	_order = []
	for run in wanted:
		if _fields.has(run):
			_order.append(run)
	rebuild_copies()


func _make_field(entry: Dictionary, paint: Dictionary) -> Field:
	var made := Field.new()
	var frame: Dictionary = entry.get("frame", {})
	made.run = str(entry.get("run", ""))
	made.name = str(entry.get("name", ""))
	made.cols = int(frame.get("cols", 2))
	made.rows = int(frame.get("rows", 2))
	made.masked = not bool(frame.get("flat", false))
	made.scale = int(entry.get("scale", 2))
	made.first_of_b = int(entry.get("firstOfB", 1))
	var bounds: Variant = paint.get("bounds", null)
	if bounds is Dictionary:
		made.has_bounds = true
		made.bounds = Vector4i(int(bounds["minCol"]), int(bounds["maxCol"]), int(bounds["minRow"]), int(bounds["maxRow"]))
	made.began = Marshalls.base64_to_raw(str(paint.get("began", "")))
	made.ticks = Marshalls.base64_to_raw(str(paint.get("ticks", ""))).to_int32_array()
	made.cells = Marshalls.base64_to_raw(str(paint.get("cells", ""))).to_int32_array()
	made.states = Marshalls.base64_to_raw(str(paint.get("states", "")))
	var beside := str(paint.get("beside", ""))
	made.beside = Marshalls.base64_to_raw(beside) if not beside.is_empty() else PackedByteArray()
	var x := float(frame.get("x", 0.0))
	var y := float(frame.get("y", 0.0))
	var cx := float(frame.get("cx", 1.0))
	var cy := float(frame.get("cy", -1.0))
	made.rect = Rect2(x, y + made.rows * cy, made.cols * cx, -made.rows * cy)
	made.reset()
	made.data_image = Image.create_from_data(made.cols, made.rows, false, Image.FORMAT_RGBA8, made.rgba)
	made.data_texture = ImageTexture.create_from_image(made.data_image)
	made.since_image = Image.create_from_data(made.cols, made.rows, false, Image.FORMAT_RF, made.since.to_byte_array())
	made.since_texture = ImageTexture.create_from_image(made.since_image)
	made.palette_image = Image.create_empty(32, 1, false, Image.FORMAT_RGBA8)
	made.palette_texture = ImageTexture.create_from_image(made.palette_image)
	made.members_image = Image.create_empty(COLUMNS, _region_rows(), false, Image.FORMAT_R8)
	made.members_texture = ImageTexture.create_from_image(made.members_image)
	made.viewport = SubViewport.new()
	made.viewport.size = Vector2i(made.cols * made.scale, made.rows * made.scale)
	made.viewport.transparent_bg = true
	made.viewport.disable_3d = true
	made.viewport.render_target_clear_mode = SubViewport.CLEAR_MODE_ALWAYS
	made.viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	var canvas := ColorRect.new()
	canvas.color = Color(1, 1, 1, 1)
	canvas.size = Vector2(made.viewport.size)
	canvas.position = Vector2.ZERO
	made.picture_material = _material(PICTURE_SHADER)
	canvas.material = made.picture_material
	made.viewport.add_child(canvas)
	add_child(made.viewport)
	var material := made.picture_material
	material.set_shader_parameter("cells", made.data_texture)
	material.set_shader_parameter("since", made.since_texture)
	material.set_shader_parameter("palette", made.palette_texture)
	material.set_shader_parameter("cols", made.cols)
	material.set_shader_parameter("rows", made.rows)
	material.set_shader_parameter("first_of_b", made.first_of_b)
	material.set_shader_parameter("masked", made.masked)
	var min_col := maxi(0, made.bounds.x - 1)
	var max_col := mini(made.cols - 1, made.bounds.y + 1)
	var min_row := maxi(0, made.bounds.z - 1)
	var max_row := mini(made.rows - 1, made.bounds.w + 1)
	if not made.has_bounds:
		min_col = 1
		max_col = 0
		min_row = 1
		max_row = 0
	material.set_shader_parameter("window", Vector4i(min_col, max_col, min_row, max_row))
	material.set_shader_parameter("near", Vector4i(maxi(0, min_col - 1), mini(made.cols - 1, max_col + 1), maxi(0, min_row - 1), mini(made.rows - 1, max_row + 1)))
	material.set_shader_parameter("reads", Vector4i(maxi(0, min_col - 2), mini(made.cols - 1, max_col + 2), maxi(0, min_row - 2), mini(made.rows - 1, max_row + 2)))
	made.put_material = _material(PUT_SHADER)
	made.put_material.set_shader_parameter("picture", made.viewport.get_texture())
	made.put_material.set_shader_parameter("rect", Vector4(made.rect.position.x, made.rect.position.y, made.rect.size.x, made.rect.size.y))
	made.put_material.set_shader_parameter("strength", _strength)
	made.put_material.set_shader_parameter("world_width", MapView.WORLD_WIDTH)
	_make_front(made, min_col, max_col, min_row, max_row)
	if made.masked:
		_make_mask(made)
	return made


func _make_front(made: Field, min_col: int, max_col: int, min_row: int, max_row: int) -> void:
	if not made.has_bounds:
		return
	made.touched = touched_cells(made)
	var image := Image.create_from_data(made.cols, made.rows, false, Image.FORMAT_R8, made.touched)
	made.touched_texture = ImageTexture.create_from_image(image)
	made.field_viewport = SubViewport.new()
	made.field_viewport.size = Vector2i(made.cols, made.rows)
	made.field_viewport.transparent_bg = false
	made.field_viewport.disable_3d = true
	made.field_viewport.render_target_clear_mode = SubViewport.CLEAR_MODE_ALWAYS
	made.field_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	var canvas := ColorRect.new()
	canvas.color = Color(1, 1, 1, 1)
	canvas.size = Vector2(made.field_viewport.size)
	made.field_material = _material(FIELD_SHADER)
	canvas.material = made.field_material
	made.field_viewport.add_child(canvas)
	add_child(made.field_viewport)
	var material := made.field_material
	material.set_shader_parameter("cells", made.data_texture)
	material.set_shader_parameter("since", made.since_texture)
	material.set_shader_parameter("touched", made.touched_texture)
	material.set_shader_parameter("cols", made.cols)
	material.set_shader_parameter("rows", made.rows)
	material.set_shader_parameter("first_of_b", made.first_of_b)
	material.set_shader_parameter("near", Vector4i(maxi(0, min_col - 2), mini(made.cols - 1, max_col + 2), maxi(0, min_row - 2), mini(made.rows - 1, max_row + 2)))
	made.put_material.set_shader_parameter("field", made.field_viewport.get_texture())
	made.put_material.set_shader_parameter("use_field", true)
	made.put_material.set_shader_parameter("core", BORDER_CORE)
	made.put_material.set_shader_parameter("casing", BORDER_CASING)
	made.put_material.set_shader_parameter("line", _line)


static func touched_cells(made: Field) -> PackedByteArray:
	var cols := made.cols
	var rows := made.rows
	var size := cols * rows
	var out := PackedByteArray()
	out.resize(size)
	var seeds := PackedByteArray()
	seeds.resize(size)
	var first := mini(size, made.began.size())
	for row in range(maxi(0, made.bounds.z), mini(rows - 1, made.bounds.w) + 1):
		var base := row * cols
		for col in range(maxi(0, made.bounds.x), mini(cols - 1, made.bounds.y) + 1):
			var cell := base + col
			if cell >= first:
				continue
			var value := made.began[cell]
			if value != 0 and value != 30 and value != 31:
				seeds[cell] = 1
	for cell in made.cells:
		if cell >= 0 and cell < size:
			seeds[cell] = 1
	for cell in range(size):
		if seeds[cell] == 0:
			continue
		var col := cell % cols
		var row := cell / cols
		for r in range(maxi(0, row - TOUCH_REACH), mini(rows - 1, row + TOUCH_REACH) + 1):
			var base := r * cols
			for c in range(maxi(0, col - TOUCH_REACH), mini(cols - 1, col + TOUCH_REACH) + 1):
				out[base + c] = 255
	return out


func _make_mask(made: Field) -> void:
	var picture := Vector2(made.viewport.size)
	var factor := minf(2.0, 2048.0 / maxf(maxf(picture.x, picture.y), 1.0))
	var size := Vector2i(maxi(1, ceili(picture.x * factor)), maxi(1, ceili(picture.y * factor)))
	made.mask_viewport = SubViewport.new()
	made.mask_viewport.size = size
	made.mask_viewport.transparent_bg = true
	made.mask_viewport.disable_3d = true
	made.mask_viewport.render_target_clear_mode = SubViewport.CLEAR_MODE_ALWAYS
	made.mask_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	made.mask_root = Node2D.new()
	var stretch := Vector2(float(size.x) / maxf(made.rect.size.x, 0.000001), float(size.y) / maxf(made.rect.size.y, 0.000001))
	made.mask_root.transform = Transform2D(0.0, stretch, 0.0, -made.rect.position * stretch)
	made.mask_viewport.add_child(made.mask_root)
	made.mask_material = _material(MASK_SHADER)
	made.mask_material.set_shader_parameter("members", made.members_texture)
	made.mask_material.set_shader_parameter("columns", COLUMNS)
	made.viewport.add_child(made.mask_viewport)
	made.picture_material.set_shader_parameter("land", made.mask_viewport.get_texture())
	made.picture_material.set_shader_parameter("use_land", true)
	made.picture_material.set_shader_parameter("picture_size", picture)
	_fit_mask(made)


func _fit_mask(made: Field) -> void:
	if made.mask_root == null:
		return
	var fill := map.war_fill_mesh() if map else null
	if fill == made.mask_mesh:
		return
	made.mask_mesh = fill
	for child in made.mask_root.get_children():
		made.mask_root.remove_child(child)
		child.queue_free()
	if fill == null:
		return
	for k in [-1, 0, 1]:
		var node := MeshInstance2D.new()
		node.mesh = fill
		node.material = made.mask_material
		node.position = Vector2(MapView.WORLD_WIDTH * k, 0.0)
		made.mask_root.add_child(node)
	_remask(made)


func _remask(made: Field) -> void:
	if made.mask_viewport:
		made.mask_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	if made.viewport:
		made.viewport.render_target_update_mode = SubViewport.UPDATE_ONCE


func _free_field(made: Field) -> void:
	if made.viewport and is_instance_valid(made.viewport):
		made.viewport.queue_free()
	made.viewport = null
	if made.field_viewport and is_instance_valid(made.field_viewport):
		made.field_viewport.queue_free()
	made.field_viewport = null


func _apply_palette(made: Field, palette: Array) -> void:
	made.palette_image.fill(Color(0, 0, 0, 0))
	for index in range(mini(palette.size(), 30)):
		var rgb: Variant = palette[index]
		made.palette_image.set_pixel(index + 1, 0, WarKit.color_of(rgb))
	made.palette_texture.update(made.palette_image)
	made.dirty = true


func _apply_sides(made: Field, sides: Variant) -> void:
	var names: Array = [[], []]
	if sides is Array:
		for index in range(mini(2, (sides as Array).size())):
			var members: Variant = (sides as Array)[index]
			if members is Array:
				for member in members:
					names[index].append(str(member).strip_edges().to_lower())
	if names != made.side_names:
		made.side_names = names
		_cut_key = ""


func _apply_members(made: Field, members: Array) -> void:
	if made.members.size() != members.size() or Array(made.members) != members:
		made.members = PackedInt32Array(members)
		_cut_key = ""
	var rows := _region_rows()
	if made.members_image.get_height() != rows:
		made.members_image = Image.create_empty(COLUMNS, rows, false, Image.FORMAT_R8)
		made.members_texture = ImageTexture.create_from_image(made.members_image)
		if made.mask_material:
			made.mask_material.set_shader_parameter("members", made.members_texture)
		made.members_set = false
	var key := members.hash()
	if made.members_set and key == made.members_key:
		return
	made.members_set = true
	made.members_key = key
	made.members_image.fill(Color(0, 0, 0, 1))
	for value in members:
		var index := int(value)
		made.members_image.set_pixel(index % COLUMNS, index / COLUMNS, Color(1, 1, 1, 1))
	made.members_texture.update(made.members_image)
	_remask(made)


func show_day(run: String, day: float, shown: bool) -> void:
	var made: Field = _fields.get(run, null)
	if made == null:
		return
	if shown and made.has_bounds:
		made.seek(day)
		if made.dirty:
			made.upload()
		made.shown = true
	else:
		made.shown = false
	_sync_visibility()


func refresh_palette(run: String, palette: Array) -> void:
	var made: Field = _fields.get(run, null)
	if made == null:
		return
	_apply_palette(made, palette)
	if made.shown:
		made.upload()


func _sync_visibility() -> void:
	var any := false
	for node in _copy_nodes:
		if not is_instance_valid(node):
			continue
		var run := str(node.get_meta("run", ""))
		if run.is_empty():
			continue
		var made: Field = _fields.get(run, null)
		var on := made != null and made.shown
		(node as CanvasItem).visible = on
		any = any or on
	if _backbuffer:
		_backbuffer.visible = any
	_refresh_cut()


func cut_borders(state: Dictionary) -> void:
	_cut_state = state
	_cut_key = ""
	_refresh_cut()


func _refresh_cut() -> void:
	if map == null:
		return
	var slots: Array[Field] = []
	var runs: PackedStringArray = []
	for run in _order:
		var made: Field = _fields.get(run, null)
		if made != null and made.shown and made.touched_texture != null and slots.size() < 4:
			slots.append(made)
			runs.append(run)
	var key := "|".join(runs)
	if key == _cut_key:
		return
	_cut_key = key
	var materials: Array[ShaderMaterial] = map.extras_border_materials()
	cut_slots = 0
	var owners: Array = _cut_state.get("owners", [])
	if slots.is_empty() or owners.is_empty():
		for material in materials:
			material.set_shader_parameter("war_cuts", 0)
		return
	var rows := _region_rows()
	if _sides_image == null or _sides_image.get_height() != rows:
		_sides_image = Image.create_empty(COLUMNS, rows, false, Image.FORMAT_RGBA8)
		_sides_texture = ImageTexture.create_from_image(_sides_image)
	_sides_image.fill(Color(0, 0, 0, 0))
	var names: Array = _cut_state.get("ownerNames", [])
	for slot in range(slots.size()):
		var made := slots[slot]
		var code_of := {}
		for index in range(names.size()):
			var folded := str(names[index]).strip_edges().to_lower()
			if folded in made.side_names[0]:
				code_of[index] = 0.5
			elif folded in made.side_names[1]:
				code_of[index] = 1.0
		for region in made.members:
			if region < 0 or region >= owners.size():
				continue
			var code: float = code_of.get(int(owners[region]), 0.0)
			if code <= 0.0:
				continue
			var at := Vector2i(region % COLUMNS, region / COLUMNS)
			var pixel := _sides_image.get_pixelv(at)
			pixel[slot] = code
			_sides_image.set_pixelv(at, pixel)
	_sides_texture.update(_sides_image)
	cut_slots = slots.size()
	for material in materials:
		material.set_shader_parameter("war_cuts", slots.size())
		material.set_shader_parameter("war_sides", _sides_texture)
		material.set_shader_parameter("war_world", MapView.WORLD_WIDTH)
		for slot in range(slots.size()):
			var made := slots[slot]
			material.set_shader_parameter("war_rect_%d" % slot, Vector4(made.rect.position.x, made.rect.position.y, made.rect.size.x, made.rect.size.y))
			material.set_shader_parameter("war_touched_%d" % slot, made.touched_texture)


func set_view(level: float, zoom: float, strength: float) -> void:
	_strength = strength
	_zoom = zoom
	_line = Vector3(_stops5(level, 0.58, 0.92, 1.34, 1.72, 2.08), _stops5(level, 1.8, 2.5, 3.6, 4.7, 5.8), _shadow_blur(level))
	for run in _fields.keys():
		var made: Field = _fields[run]
		made.put_material.set_shader_parameter("strength", strength)
		made.put_material.set_shader_parameter("line", _line)


static func _stops5(z: float, a: float, b: float, c: float, d: float, e: float) -> float:
	if z <= 1.0:
		return a
	if z <= 3.0:
		return lerpf(a, b, (z - 1.0) / 2.0)
	if z <= 6.0:
		return lerpf(b, c, (z - 3.0) / 3.0)
	if z <= 9.0:
		return lerpf(c, d, (z - 6.0) / 3.0)
	if z <= 12.0:
		return lerpf(d, e, (z - 9.0) / 3.0)
	return e


static func _shadow_blur(z: float) -> float:
	if z <= 1.0:
		return 0.7
	if z <= 6.0:
		return lerpf(0.7, 1.15, (z - 1.0) / 5.0)
	if z <= 12.0:
		return lerpf(1.15, 1.5, (z - 6.0) / 6.0)
	return 1.5


func rebuild_copies() -> void:
	for node in _copy_nodes:
		if is_instance_valid(node):
			node.queue_free()
	_copy_nodes.clear()
	if map == null:
		return
	var fill := map.war_fill_mesh()
	if fill == null:
		return
	for run in _order:
		_fit_mask(_fields[run])
	for copy in map.war_copies():
		for run in _order:
			var made: Field = _fields[run]
			var quad := MeshInstance2D.new()
			quad.mesh = _quad_of(made.rect)
			quad.material = made.put_material
			quad.set_meta("run", run)
			map.war_insert_under_borders(copy, quad)
			_copy_nodes.append(quad)
	_sync_visibility()


func _quad_of(rect: Rect2) -> ArrayMesh:
	var mesh := ArrayMesh.new()
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = PackedVector2Array([rect.position, Vector2(rect.end.x, rect.position.y), rect.end, Vector2(rect.position.x, rect.end.y)])
	arrays[Mesh.ARRAY_TEX_UV] = PackedVector2Array([Vector2.ZERO, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO])
	arrays[Mesh.ARRAY_INDEX] = PackedInt32Array([0, 1, 2, 0, 2, 3])
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh
