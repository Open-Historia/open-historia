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

vec4 paint_at(vec2 uv) {
	float u = uv.x * float(cols);
	float v = float(rows) - uv.y * float(rows);
	int own_row = int(floor(v));
	int own_col = int(floor(u));
	if (own_row < window.z || own_row > window.w || own_col < window.x || own_col > window.y) {
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
	float alpha = floor(255.0 * solid + 0.5) / 255.0;
	vec3 rgb = texelFetch(palette, ivec2(colour_state, 0), 0).rgb;
	return vec4(rgb * alpha, alpha);
}

void fragment() {
	COLOR = paint_at(UV);
}
"""

const PUT_SHADER := """
shader_type canvas_item;
render_mode unshaded, blend_premul_alpha;
uniform sampler2D picture : filter_linear, repeat_disable;
uniform sampler2D screen : hint_screen_texture, filter_nearest, repeat_disable;
uniform sampler2D members : filter_nearest, repeat_disable;
uniform int columns = 1024;
uniform bool use_members = true;
uniform vec4 rect = vec4(0.0, 0.0, 1.0, 1.0);
uniform float strength = 0.6;
uniform float world_width = 4096.0;
varying vec2 world;

void vertex() {
	world = VERTEX;
	if (use_members) {
		int region = int(UV.x + 0.5);
		float keep = texelFetch(members, ivec2(region % columns, region / columns), 0).r;
		if (keep < 0.5) {
			VERTEX = vec2(-1000000.0, -1000000.0);
			world = VERTEX;
		}
	}
}

void fragment() {
	vec2 uv = (world - rect.xy) / rect.zw;
	if (uv.x < 0.0) {
		uv.x += world_width / rect.z;
	} else if (uv.x > 1.0) {
		uv.x -= world_width / rect.z;
	}
	vec4 paint = vec4(0.0);
	if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
		paint = texture(picture, uv);
	}
	if (paint.a < 0.004) {
		discard;
	}
	vec3 base = texture(screen, SCREEN_UV).rgb;
	COLOR = vec4(base * (1.0 - strength) * paint.a + paint.rgb * strength, paint.a);
}
"""

const STRIPE_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D stripes : filter_nearest, repeat_disable;
uniform sampler2D colours : filter_nearest, repeat_disable;
uniform int columns = 1024;
uniform float zoom = 1.0;
uniform float opacity = 0.22;
varying vec2 world;
varying float offset;
varying float count;

void vertex() {
	int region = int(UV.x + 0.5);
	vec4 entry = texelFetch(stripes, ivec2(region % columns, region / columns), 0);
	count = floor(entry.b * 255.0 + 0.5);
	offset = floor(entry.r * 255.0 + 0.5) + floor(entry.g * 255.0 + 0.5) * 256.0;
	if (count < 2.0) {
		VERTEX = vec2(-1000000.0, -1000000.0);
	}
	world = VERTEX;
}

void fragment() {
	vec2 p = floor(world * zoom);
	float size = count * 8.0;
	float band = floor(mod(p.x + p.y, size) / 8.0);
	vec3 c = texelFetch(colours, ivec2(int(offset + band + 0.5), 0), 0).rgb;
	COLOR = vec4(c, opacity);
}
"""

const TINT_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D tints : filter_nearest, repeat_disable;
uniform int columns = 1024;
uniform float opacity = 0.2;
varying vec4 tint;

void vertex() {
	int region = int(UV.x + 0.5);
	tint = texelFetch(tints, ivec2(region % columns, region / columns), 0);
	if (tint.a < 0.5) {
		VERTEX = vec2(-1000000.0, -1000000.0);
	}
}

void fragment() {
	COLOR = vec4(tint.rgb, opacity);
}
"""

const COLUMNS := 1024


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
	var viewport: SubViewport
	var picture_material: ShaderMaterial
	var put_material: ShaderMaterial

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
		dirty = false


var map: MapView
var _fields: Dictionary = {}
var _order: Array[String] = []
var _backbuffer: BackBufferCopy
var _copy_nodes: Array[Node] = []
var _stripe_material: ShaderMaterial
var _stripe_index: Image
var _stripe_index_texture: ImageTexture
var _stripe_colours: Image
var _stripe_colours_texture: ImageTexture
var _stripes_on := false
var _tint_material: ShaderMaterial
var _tint_image: Image
var _tint_texture: ImageTexture
var _tints_on := false
var _strength := 0.6
var _zoom := 1.0


func setup(map_view: MapView) -> void:
	map = map_view
	_stripe_material = _material(STRIPE_SHADER)
	_tint_material = _material(TINT_SHADER)
	_backbuffer = BackBufferCopy.new()
	_backbuffer.copy_mode = BackBufferCopy.COPY_MODE_VIEWPORT
	_backbuffer.visible = false
	map.war_insert_before_fills(_backbuffer)
	var rows: int = maxi(1, int(ceil(float(maxi(map.war_region_count(), 1)) / COLUMNS)))
	_stripe_index = Image.create_empty(COLUMNS, rows, false, Image.FORMAT_RGBA8)
	_stripe_index_texture = ImageTexture.create_from_image(_stripe_index)
	_stripe_colours = Image.create_empty(4096, 1, false, Image.FORMAT_RGBA8)
	_stripe_colours_texture = ImageTexture.create_from_image(_stripe_colours)
	_tint_image = Image.create_empty(COLUMNS, rows, false, Image.FORMAT_RGBA8)
	_tint_texture = ImageTexture.create_from_image(_tint_image)
	_stripe_material.set_shader_parameter("stripes", _stripe_index_texture)
	_stripe_material.set_shader_parameter("colours", _stripe_colours_texture)
	_stripe_material.set_shader_parameter("columns", COLUMNS)
	_tint_material.set_shader_parameter("tints", _tint_texture)
	_tint_material.set_shader_parameter("columns", COLUMNS)


func _material(code: String) -> ShaderMaterial:
	var shader := Shader.new()
	shader.code = code
	var material := ShaderMaterial.new()
	material.shader = shader
	return material


func _region_rows() -> int:
	return maxi(1, int(ceil(float(maxi(map.war_region_count(), 1)) / COLUMNS)))


func _fit_region_images() -> void:
	var rows := _region_rows()
	if _stripe_index.get_height() != rows:
		_stripe_index = Image.create_empty(COLUMNS, rows, false, Image.FORMAT_RGBA8)
		_stripe_index_texture = ImageTexture.create_from_image(_stripe_index)
		_stripe_material.set_shader_parameter("stripes", _stripe_index_texture)
	if _tint_image.get_height() != rows:
		_tint_image = Image.create_empty(COLUMNS, rows, false, Image.FORMAT_RGBA8)
		_tint_texture = ImageTexture.create_from_image(_tint_image)
		_tint_material.set_shader_parameter("tints", _tint_texture)


func have_runs() -> Array:
	return _fields.keys()


func field(run: String) -> Field:
	return _fields.get(run, null)


func clear() -> void:
	for run in _fields.keys():
		_free_field(_fields[run])
	_fields.clear()
	_order.clear()
	_stripes_on = false
	_tints_on = false
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
	made.put_material.set_shader_parameter("members", made.members_texture)
	made.put_material.set_shader_parameter("columns", COLUMNS)
	made.put_material.set_shader_parameter("use_members", made.masked)
	made.put_material.set_shader_parameter("rect", Vector4(made.rect.position.x, made.rect.position.y, made.rect.size.x, made.rect.size.y))
	made.put_material.set_shader_parameter("strength", _strength)
	made.put_material.set_shader_parameter("world_width", MapView.WORLD_WIDTH)
	return made


func _free_field(made: Field) -> void:
	if made.viewport and is_instance_valid(made.viewport):
		made.viewport.queue_free()
	made.viewport = null


func _apply_palette(made: Field, palette: Array) -> void:
	made.palette_image.fill(Color(0, 0, 0, 0))
	for index in range(mini(palette.size(), 30)):
		var rgb: Variant = palette[index]
		made.palette_image.set_pixel(index + 1, 0, WarKit.color_of(rgb))
	made.palette_texture.update(made.palette_image)
	made.dirty = true


func _apply_members(made: Field, members: Array) -> void:
	var rows := _region_rows()
	if made.members_image.get_height() != rows:
		made.members_image = Image.create_empty(COLUMNS, rows, false, Image.FORMAT_R8)
		made.members_texture = ImageTexture.create_from_image(made.members_image)
		made.put_material.set_shader_parameter("members", made.members_texture)
	made.members_image.fill(Color(0, 0, 0, 1))
	for value in members:
		var index := int(value)
		made.members_image.set_pixel(index % COLUMNS, index / COLUMNS, Color(1, 1, 1, 1))
	made.members_texture.update(made.members_image)


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


func set_view(level: float, zoom: float, strength: float) -> void:
	_strength = strength
	_zoom = zoom
	for run in _fields.keys():
		var made: Field = _fields[run]
		made.put_material.set_shader_parameter("strength", strength)
	_stripe_material.set_shader_parameter("zoom", zoom)


func set_disputed(entries: Array, owner_rgb: Callable, opacity: float) -> void:
	_fit_region_images()
	_stripe_index.fill(Color(0, 0, 0, 0))
	_stripe_colours.fill(Color(0, 0, 0, 1))
	var offset := 0
	var count_on := 0
	for item in entries:
		var entry: Array = item
		var index := int(entry[0])
		var names: Array = entry[1]
		var seen := {}
		var colours: Array[Color] = []
		var owner: Array = owner_rgb.call(index)
		if not owner.is_empty():
			seen[str(owner[0])] = true
			colours.append(WarKit.color_of(owner[1]))
		for pair in names:
			var named: Array = pair
			var key := str(named[0]).strip_edges()
			if key.is_empty() or seen.has(key):
				continue
			seen[key] = true
			colours.append(WarKit.color_of(named[1]))
		if colours.size() < 2 or offset + colours.size() > 4096:
			continue
		for at in range(colours.size()):
			_stripe_colours.set_pixel(offset + at, 0, colours[at])
		_stripe_index.set_pixel(index % COLUMNS, index / COLUMNS, Color8(offset & 255, (offset >> 8) & 255, colours.size(), 255))
		offset += colours.size()
		count_on += 1
	_stripe_index_texture.update(_stripe_index)
	_stripe_colours_texture.update(_stripe_colours)
	_stripe_material.set_shader_parameter("opacity", opacity)
	var was := _stripes_on
	_stripes_on = count_on > 0
	if was != _stripes_on:
		rebuild_copies()


func set_groups(groups: Array, opacity: float) -> void:
	_fit_region_images()
	_tint_image.fill(Color(0, 0, 0, 0))
	var any := false
	for item in groups:
		var group: Dictionary = item
		var colour := WarKit.color_of(group.get("color", [225, 29, 72]))
		for value in group.get("regions", []):
			var index := int(value)
			_tint_image.set_pixel(index % COLUMNS, index / COLUMNS, Color(colour.r, colour.g, colour.b, 1.0))
			any = true
	_tint_texture.update(_tint_image)
	_tint_material.set_shader_parameter("opacity", opacity)
	var was := _tints_on
	_tints_on = any
	if was != _tints_on:
		rebuild_copies()


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
	for copy in map.war_copies():
		if _stripes_on:
			_insert(copy, fill, _stripe_material, "")
		for run in _order:
			var made: Field = _fields[run]
			if made.masked:
				_insert(copy, fill, made.put_material, run)
			else:
				var quad := MeshInstance2D.new()
				quad.mesh = _quad_of(made.rect)
				quad.material = made.put_material
				quad.set_meta("run", run)
				map.war_insert_under_borders(copy, quad)
				_copy_nodes.append(quad)
		if _tints_on:
			_insert(copy, fill, _tint_material, "")
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


func _insert(copy: Node2D, mesh: Mesh, material: Material, run: String) -> void:
	var node := MeshInstance2D.new()
	node.mesh = mesh
	node.material = material
	node.set_meta("run", run)
	map.war_insert_under_borders(copy, node)
	_copy_nodes.append(node)
