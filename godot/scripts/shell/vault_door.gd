class_name VaultDoor
extends Control

signal opening
signal opened

const SvgKit := preload("res://scripts/shell/vault/vault_svg.gd")
const DepthLayer := preload("res://scripts/shell/vault/vault_depth.gd")
const WheelLayer := preload("res://scripts/shell/vault/vault_wheel.gd")
const SeamsLayer := preload("res://scripts/shell/vault/vault_seams.gd")
const WALL := Color("#202327")
const JPEG_QUALITY := 0.86
const SHAKE_KEYS := [[0.0, 0.0, 0.0, 0.0], [0.15, -3.0, 1.0, -1.6], [0.3, 3.0, -1.0, 1.6], [0.45, -2.0, 1.0, -1.1], [0.6, 2.0, 0.0, 0.9], [0.8, -1.0, 0.0, -0.4], [1.0, 0.0, 0.0, 0.0]]
const SHAKE_EASE := "cubic-bezier(0.42, 0, 0.58, 1)"
const SPIN_EASE := "cubic-bezier(0.5, 0, 0.2, 1)"
const WHEEL_EASE := "cubic-bezier(0.42, 0, 1, 1)"
const FADE_EASE := "cubic-bezier(0.25, 0.1, 0.25, 1)"
const WHEEL_LEAVE_MS := 260.0
const SEAMS_LEAVE_MS := 120.0
const DEFAULT_TIMING := {"firstShake": 10000.0, "shakeEvery": 5000.0, "shake": 520.0, "spin": 1500.0, "bolts": 380.0, "open": 1800.0, "fade": 350.0}
const DEFAULT_DEPTH := {"back": 0.07, "thickness": 0.3, "door": 0.44, "sockets": [0.15, 0.26, 0.37], "socketRadius": 0.17}
const DEFAULT_LEAVES := [
	{"name": "top", "corners": [[0.0, 0.0], [1.0, 0.0], [1.0, 0.15], [0.5, 0.5], [0.0, 0.15]], "move": [0.0, -0.66], "seams": [[[0.5, 0.5], [1.0, 0.15]], [[0.5, 0.5], [0.0, 0.15]]]},
	{"name": "left", "corners": [[0.0, 0.15], [0.5, 0.5], [0.5, 1.0], [0.0, 1.0]], "move": [-0.72, 0.72], "seams": [[[0.5, 0.5], [0.0, 0.15]], [[0.5, 0.5], [0.5, 1.0]]]},
	{"name": "right", "corners": [[1.0, 0.15], [1.0, 1.0], [0.5, 1.0], [0.5, 0.5]], "move": [0.72, 0.72], "seams": [[[0.5, 0.5], [1.0, 0.15]], [[0.5, 0.5], [0.5, 1.0]]]},
]
const LEAF_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D face : filter_linear, repeat_disable;
uniform vec2 area = vec2(1.0, 1.0);
uniform vec2 offset = vec2(0.0, 0.0);
uniform vec2 corners[5];
uniform int count = 3;
void fragment() {
	vec2 p = UV * area - offset;
	float d = -1e9;
	for (int i = 0; i < 5; i++) {
		if (i < count) {
			vec2 a = corners[i];
			vec2 b = corners[(i + 1 < count) ? i + 1 : 0];
			vec2 e = b - a;
			float l = length(e);
			if (l > 0.0) {
				d = max(d, dot(p - a, vec2(e.y, -e.x) / l));
			}
		}
	}
	COLOR = COLOR * vec4(texture(face, p / area).rgb, clamp(0.5 - d, 0.0, 1.0));
}
"""

static var _leaf_shader: Shader

var stage := "closed"
var _engine: EngineLink
var _still := false
var _timing := DEFAULT_TIMING.duplicate()
var _leaves: Array = []
var _depth_plan := {}
var _brush: Array = []
var _sounds: VaultSounds
var _depth: DepthLayer
var _leaf_rects: Array[ColorRect] = []
var _seams: SeamsLayer
var _wheel: WheelLayer
var _knob: Button
var _face_texture: ImageTexture
var _disc_jpeg := PackedByteArray()
var _disc_image: Image
var _plate_image: Image
var _baked_size := Vector2i.ZERO
var _prepared := false
var _shake_epoch := 0
var _shaking_since := -1
var _turn_started := -1
var _opening_started := -1
var _leaving_started := -1
var _press_inside := false
var _key_seen := false
var _focus_visible := false
var _ease := CubicBezier.new(0.55, 0.05, 0.3, 1.0)


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	focus_mode = Control.FOCUS_NONE


func setup(engine: EngineLink, prefs: Dictionary) -> void:
	_engine = engine
	_still = bool(prefs.get("reduceMotion", false))
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_sounds = VaultSounds.new()
	_sounds.enabled = bool(prefs.get("soundEffects", true))
	add_child(_sounds)
	var metal := {}
	if engine:
		var reply: Dictionary = await engine.request("shell.metal")
		if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY:
			metal = reply["result"]
		if not engine.engine_event.is_connected(_on_engine_event):
			engine.engine_event.connect(_on_engine_event)
	_read_plan(metal)
	_sounds.prepare(float(_timing["spin"]) / 1000.0, float(_timing["open"]) / 1000.0)
	_make_metal(metal)
	_build_layers()
	_bake()
	_prepared = true
	_layout()
	_knob.grab_focus()
	_arm_shake()


func open() -> void:
	if stage != "closed" or not _prepared:
		return
	_shaking_since = -1
	_shake_epoch += 1
	_focus_visible = false
	var now := Time.get_ticks_msec()
	if _still:
		_sounds.unlock()
		_set_stage("opening")
		_leaving_started = now
		opening.emit()
		_later(float(_timing["fade"]), _finish)
		return
	_set_stage("spinning")
	_turn_started = now
	_sounds.spin()
	_later(float(_timing["spin"]), _unlock_heard)
	_later(float(_timing["spin"]) + float(_timing["bolts"]), _start_opening)
	_later(float(_timing["spin"]) + float(_timing["bolts"]) + float(_timing["open"]) + 120.0, _finish)


func is_prepared() -> bool:
	return _prepared


func sounds() -> VaultSounds:
	return _sounds


func _unlock_heard() -> void:
	_sounds.unlock()


func _start_opening() -> void:
	_set_stage("opening")
	_leaving_started = Time.get_ticks_msec()
	_opening_started = -1
	_sounds.open()
	opening.emit()


func _finish() -> void:
	_set_stage("gone")
	visible = false
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_process(false)
	set_process_input(false)
	_sounds.dispose()
	_face_texture = null
	for rect in _leaf_rects:
		(rect.material as ShaderMaterial).set_shader_parameter("face", null)
	if _wheel:
		_wheel.wheel_texture = null
		_wheel.shadow_texture = null
	opened.emit()


func _set_stage(next: String) -> void:
	stage = next
	if _knob:
		_knob.disabled = next != "closed"
	mouse_filter = Control.MOUSE_FILTER_IGNORE if next == "opening" or next == "gone" else Control.MOUSE_FILTER_STOP


func _later(ms: float, then: Callable) -> void:
	if not is_inside_tree():
		return
	get_tree().create_timer(ms / 1000.0).timeout.connect(then)


func _arm_shake() -> void:
	_shake_epoch += 1
	_shaking_since = -1
	if stage != "closed" or _still:
		return
	_later(float(_timing["firstShake"]), _shudder.bind(_shake_epoch))


func _shudder(epoch: int) -> void:
	if epoch != _shake_epoch or stage != "closed":
		return
	_shaking_since = Time.get_ticks_msec()
	_sounds.rattle()
	_later(float(_timing["shakeEvery"]), _shudder.bind(epoch))


func _on_engine_event(event_name: String, data: Variant) -> void:
	if event_name == "shell.prefs" and typeof(data) == TYPE_DICTIONARY and _sounds:
		_sounds.enabled = bool((data as Dictionary).get("soundEffects", _sounds.enabled))


func _read_plan(metal: Dictionary) -> void:
	var timing: Variant = metal.get("timing")
	if typeof(timing) == TYPE_DICTIONARY:
		for key in DEFAULT_TIMING.keys():
			_timing[key] = float((timing as Dictionary).get(key, DEFAULT_TIMING[key]))
	var given: Variant = metal.get("leaves")
	var source: Array = given if typeof(given) == TYPE_ARRAY and not (given as Array).is_empty() else DEFAULT_LEAVES
	_leaves.clear()
	for entry in source:
		var leaf: Dictionary = entry
		var corners: Array = []
		for corner in leaf.get("corners", []):
			corners.append(Vector2(float(corner[0]), float(corner[1])))
		var seams: Array = []
		for seam in leaf.get("seams", []):
			seams.append([Vector2(float(seam[0][0]), float(seam[0][1])), Vector2(float(seam[1][0]), float(seam[1][1]))])
		var move: Array = leaf.get("move", [0.0, 0.0])
		_leaves.append({"name": str(leaf.get("name", "")), "corners": corners, "seams": seams, "move": Vector2(float(move[0]), float(move[1]))})
	var depth: Dictionary = DEFAULT_DEPTH.duplicate(true)
	var given_depth: Variant = metal.get("depth")
	if typeof(given_depth) == TYPE_DICTIONARY:
		for key in DEFAULT_DEPTH.keys():
			if (given_depth as Dictionary).has(key):
				depth[key] = (given_depth as Dictionary)[key]
	_depth_plan = depth
	var brush: Variant = metal.get("sideBrush")
	_brush = brush if typeof(brush) == TYPE_ARRAY else []


func _make_metal(metal: Dictionary) -> void:
	_disc_jpeg = _picture(metal.get("disc"), metal.get("discScratches"))
	_disc_image = null
	if not _disc_jpeg.is_empty():
		var disc := Image.new()
		if disc.load_jpg_from_buffer(_disc_jpeg) == OK:
			_disc_image = disc
		else:
			_disc_jpeg = PackedByteArray()
	_plate_image = null
	var plate_jpeg := _picture(metal.get("plate"), metal.get("plateScratches"))
	if not plate_jpeg.is_empty():
		var plate := Image.new()
		if plate.load_jpg_from_buffer(plate_jpeg) == OK:
			plate.convert(Image.FORMAT_RGBA8)
			_plate_image = plate


static func _picture(entry: Variant, scratches: Variant) -> PackedByteArray:
	if typeof(entry) != TYPE_DICTIONARY:
		return PackedByteArray()
	var info: Dictionary = entry
	var length := int(info.get("size", 0))
	var bytes := FileAccess.get_file_as_bytes(str(info.get("file", "")))
	if length <= 0 or bytes.size() != length * length * 4:
		return PackedByteArray()
	var image := Image.create_from_data(length, length, false, Image.FORMAT_RGBA8, bytes)
	if typeof(scratches) == TYPE_ARRAY:
		_scratch(image, scratches)
	return image.save_jpg_to_buffer(JPEG_QUALITY)


static func _scratch(image: Image, lines: Array) -> void:
	var width := image.get_width()
	var height := image.get_height()
	for entry in lines:
		var line: Dictionary = entry
		var from: Array = line.get("from", [0.0, 0.0])
		var to: Array = line.get("to", [0.0, 0.0])
		var tint: Array = line.get("color", [0, 0, 0, 0])
		var a := Vector2(float(from[0]), float(from[1]))
		var b := Vector2(float(to[0]), float(to[1]))
		var ink := Color8(int(tint[0]), int(tint[1]), int(tint[2]))
		var opacity := float(tint[3])
		var half := float(line.get("width", 1.0)) / 2.0
		var direction := b - a
		var length := direction.length()
		if length <= 0.0:
			continue
		var unit := direction / length
		var normal := Vector2(-unit.y, unit.x)
		var flat := absf(direction.x) >= absf(direction.y)
		var reach := (half + 1.0) / maxf(0.2, absf(unit.x) if flat else absf(unit.y))
		var start := int(floor(minf(a.x, b.x) if flat else minf(a.y, b.y))) - 2
		var stop := int(ceil(maxf(a.x, b.x) if flat else maxf(a.y, b.y))) + 2
		start = maxi(start, 0)
		stop = mini(stop, (width if flat else height) - 1)
		for major in range(start, stop + 1):
			var centre := float(major) + 0.5
			var t := (centre - (a.x if flat else a.y)) / (direction.x if flat else direction.y)
			var minor_centre := (a.y + direction.y * t) if flat else (a.x + direction.x * t)
			var low := maxi(0, int(floor(minor_centre - reach)))
			var high := mini((height if flat else width) - 1, int(ceil(minor_centre + reach)))
			for minor in range(low, high + 1):
				var x := major if flat else minor
				var y := minor if flat else major
				var point := Vector2(x + 0.5, y + 0.5) - a
				var along := point.dot(unit)
				var cover_along := clampf(minf(along + 0.5, length) - maxf(along - 0.5, 0.0), 0.0, 1.0)
				if cover_along <= 0.0:
					continue
				var across := absf(point.dot(normal))
				var cover_across := clampf(minf(across + 0.5, half) - maxf(across - 0.5, -half), 0.0, 1.0)
				var alpha := opacity * cover_along * cover_across
				if alpha <= 0.0:
					continue
				var under := image.get_pixel(x, y)
				image.set_pixel(x, y, Color(under.r + (ink.r - under.r) * alpha, under.g + (ink.g - under.g) * alpha, under.b + (ink.b - under.b) * alpha, 1.0))


func _build_layers() -> void:
	if not _leaf_shader:
		_leaf_shader = Shader.new()
		_leaf_shader.code = LEAF_SHADER
	_depth = DepthLayer.new()
	add_child(_depth)
	_depth.leaves = _leaves
	_depth.back = float(_depth_plan["back"])
	_depth.thickness = float(_depth_plan["thickness"])
	_depth.door = float(_depth_plan["door"])
	_depth.sockets = _depth_plan["sockets"]
	_depth.socket_radius = float(_depth_plan["socketRadius"])
	_depth.brush = _brush
	for leaf in _leaves:
		var rect := ColorRect.new()
		rect.color = Color.WHITE
		rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var material := ShaderMaterial.new()
		material.shader = _leaf_shader
		rect.material = material
		add_child(rect)
		_leaf_rects.append(rect)
	_seams = SeamsLayer.new()
	add_child(_seams)
	_wheel = WheelLayer.new()
	add_child(_wheel)
	_knob = Button.new()
	_knob.flat = true
	_knob.focus_mode = Control.FOCUS_ALL
	_knob.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_knob.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
		_knob.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	if "accessibility_name" in _knob:
		_knob.set("accessibility_name", "Open")
	_knob.pressed.connect(open)
	_knob.focus_entered.connect(func() -> void: _focus_visible = _key_seen)
	_knob.focus_exited.connect(func() -> void: _focus_visible = false)
	add_child(_knob)


func _area() -> Vector2:
	var area := size
	if area.x < 1.0 or area.y < 1.0:
		area = get_viewport_rect().size
	return area


func _bake() -> void:
	var area := _area()
	var width := maxi(1, roundi(area.x))
	var height := maxi(1, roundi(area.y))
	var face := Image.create_empty(width, height, false, Image.FORMAT_RGBA8)
	face.fill(WALL)
	if _plate_image:
		var tile := _plate_image.get_size()
		for y in range(0, height, tile.y):
			for x in range(0, width, tile.x):
				face.blit_rect(_plate_image, Rect2i(Vector2i.ZERO, tile), Vector2i(x, y))
	var disc_uri := ""
	if not _disc_jpeg.is_empty():
		disc_uri = "data:image/jpeg;base64," + Marshalls.raw_to_base64(_disc_jpeg)
	var vector := Image.new()
	if vector.load_svg_from_string(SvgKit.face(width, height, disc_uri), 1.0) == OK:
		if vector.get_format() != Image.FORMAT_RGBA8:
			vector.convert(Image.FORMAT_RGBA8)
		face.blend_rect(vector, Rect2i(Vector2i.ZERO, vector.get_size()), Vector2i.ZERO)
	_face_texture = ImageTexture.create_from_image(face)
	var side := maxi(8, roundi(minf(area.x, area.y) * 0.56))
	var wheel_disc := ""
	if _disc_image:
		var small := _disc_image.duplicate() as Image
		var pixels := maxi(1, roundi(224.0 * side / 300.0))
		small.resize(pixels, pixels, Image.INTERPOLATE_LANCZOS)
		wheel_disc = "data:image/png;base64," + Marshalls.raw_to_base64(small.save_png_to_buffer())
	var logo_uri := ""
	var mark := UI.logo()
	if mark:
		var logo := mark.get_image().duplicate() as Image
		if logo.is_compressed():
			logo.decompress()
		var pixels := maxi(1, roundi(200.0 * side / 300.0))
		logo.resize(pixels, pixels, Image.INTERPOLATE_LANCZOS)
		logo_uri = "data:image/png;base64," + Marshalls.raw_to_base64(logo.save_png_to_buffer())
	var wheel := Image.new()
	if wheel.load_svg_from_string(SvgKit.wheel(side, wheel_disc, logo_uri), 1.0) == OK:
		_wheel.wheel_texture = ImageTexture.create_from_image(wheel)
	var shadow := Image.new()
	if shadow.load_svg_from_string(SvgKit.wheel_shadow(side), 1.0) == OK:
		_wheel.shadow_texture = ImageTexture.create_from_image(shadow)
	_baked_size = Vector2i(width, height)
	var area_pixels := Vector2(width, height)
	for index in range(_leaf_rects.size()):
		var material := _leaf_rects[index].material as ShaderMaterial
		var corners: Array = _leaves[index]["corners"]
		var points := PackedVector2Array()
		for corner in corners:
			var share: Vector2 = corner
			points.append(Vector2(share.x * area_pixels.x, share.y * area_pixels.y))
		var winding := 0.0
		for at in range(points.size()):
			var a := points[at]
			var b := points[(at + 1) % points.size()]
			winding += a.x * b.y - b.x * a.y
		if winding < 0.0:
			points.reverse()
		var padded := PackedVector2Array(points)
		while padded.size() < 5:
			padded.append(Vector2.ZERO)
		material.set_shader_parameter("face", _face_texture)
		material.set_shader_parameter("area", area_pixels)
		material.set_shader_parameter("corners", padded)
		material.set_shader_parameter("count", points.size())


func _layout() -> void:
	if not _prepared:
		return
	var area := _area()
	var side := minf(area.x, area.y) * 0.56
	_knob.position = area / 2.0 - Vector2(side, side) / 2.0
	_knob.size = Vector2(side, side)
	_wheel.area = area
	_wheel.position = Vector2.ZERO
	_wheel.size = area


func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED and _prepared and stage != "gone":
		_layout()


func _input(event: InputEvent) -> void:
	if event is InputEventKey and (event as InputEventKey).pressed:
		var key := (event as InputEventKey).keycode
		if key in [KEY_SHIFT, KEY_CTRL, KEY_ALT, KEY_META]:
			return
		_key_seen = true
		if _knob and _knob.has_focus() and stage == "closed":
			_focus_visible = true
	elif event is InputEventMouseButton and (event as InputEventMouseButton).pressed:
		_key_seen = false


func _gui_input(event: InputEvent) -> void:
	if stage != "closed":
		if stage == "spinning":
			accept_event()
		return
	if event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if button.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN, MOUSE_BUTTON_WHEEL_LEFT, MOUSE_BUTTON_WHEEL_RIGHT]:
			accept_event()
			return
		if button.pressed:
			_arm_shake()
			_press_inside = button.button_index == MOUSE_BUTTON_LEFT and _on_wheel(button.position)
		elif button.button_index == MOUSE_BUTTON_LEFT:
			var inside := _press_inside and _on_wheel(button.position)
			_press_inside = false
			if inside:
				open()
		accept_event()
	elif event is InputEventScreenTouch and (event as InputEventScreenTouch).pressed:
		_arm_shake()
		accept_event()


func _on_wheel(point: Vector2) -> bool:
	var area := _area()
	return point.distance_to(area / 2.0) <= minf(area.x, area.y) * 0.56 / 2.0


func _shake_at(share: float) -> Vector3:
	var curve := CubicBezier.named(SHAKE_EASE)
	for index in range(SHAKE_KEYS.size() - 1):
		var a: Array = SHAKE_KEYS[index]
		var b: Array = SHAKE_KEYS[index + 1]
		if share <= float(b[0]):
			var local := (share - float(a[0])) / (float(b[0]) - float(a[0]))
			var eased := curve.at(local)
			return Vector3(lerpf(float(a[1]), float(b[1]), eased), lerpf(float(a[2]), float(b[2]), eased), lerpf(float(a[3]), float(b[3]), eased))
	return Vector3.ZERO


func _process(_delta: float) -> void:
	if not _prepared or stage == "gone":
		return
	var now := Time.get_ticks_msec()
	var area := _area()
	if Vector2i(roundi(area.x), roundi(area.y)) != _baked_size:
		_bake()
		_layout()
	var shake := Vector3.ZERO
	if _shaking_since >= 0:
		var share := float(now - _shaking_since) / float(_timing["shake"])
		if share >= 1.0 or stage != "closed":
			_shaking_since = -1
		else:
			shake = _shake_at(share)
	var turn := 0.0
	if _turn_started >= 0 and not _still:
		turn = 540.0 * CubicBezier.named(SPIN_EASE).at(clampf(float(now - _turn_started) / float(_timing["spin"]), 0.0, 1.0))
	var zoom := 1.0
	var alpha := 1.0
	if stage == "opening":
		if _still:
			zoom = 0.6
			alpha = 0.0
			modulate.a = 1.0 - CubicBezier.named(FADE_EASE).at(clampf(float(now - _leaving_started) / float(_timing["fade"]), 0.0, 1.0))
		else:
			var eased := CubicBezier.named(WHEEL_EASE).at(clampf(float(now - _leaving_started) / WHEEL_LEAVE_MS, 0.0, 1.0))
			zoom = 1.0 - 0.4 * eased
			alpha = 1.0 - eased
		_seams.modulate.a = 1.0 - clampf(float(now - _leaving_started) / SEAMS_LEAVE_MS, 0.0, 1.0)
		if not _still:
			if _opening_started < 0:
				_opening_started = now
			var gone := minf(1.0, float(now - _opening_started) / float(_timing["open"]))
			var progress := _ease.at(gone)
			for index in range(_leaf_rects.size()):
				var move: Vector2 = _leaves[index]["move"]
				var offset := DepthLayer.leaf_offset(move, progress, area)
				offset = Vector2(snappedf(offset.x, 0.1), snappedf(offset.y, 0.1))
				(_leaf_rects[index].material as ShaderMaterial).set_shader_parameter("offset", offset)
			_depth.progress = progress
			_depth.queue_redraw()
	var ring := _focus_visible and stage == "closed" and _knob.has_focus()
	if alpha != _wheel.modulate.a:
		_wheel.modulate.a = alpha
	if area != _wheel.area or turn != _wheel.turn or shake != _wheel.shake or zoom != _wheel.zoom or ring != _wheel.ring:
		_wheel.area = area
		_wheel.size = area
		_wheel.turn = turn
		_wheel.shake = shake
		_wheel.zoom = zoom
		_wheel.ring = ring
		_wheel.queue_redraw()
