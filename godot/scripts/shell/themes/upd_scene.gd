extends Control

const SUPERSAMPLE := 2.0
const KEYFRAMES := {
	"ohUpdRise": {"order": ["ty", "s"], "opacity": [[0.0, 0.0], [1.0, 1.0]], "ty": [[0.0, 16.0], [1.0, 0.0]], "s": [[0.0, 0.985], [1.0, 1.0]]},
	"ohUpdFade": {"order": [], "opacity": [[0.0, 0.0], [1.0, 1.0]]},
	"ohUpdTurn": {"order": ["rot", "s"], "opacity": [[0.0, 0.0], [1.0, 1.0]], "rot": [[0.0, -120.0], [1.0, 0.0]], "s": [[0.0, 0.6], [1.0, 1.0]]},
	"ohUpdDraw": {"order": [], "dash": [[0.0, "length"], [1.0, 0.0]]},
	"ohUpdPulse": {"order": [], "opacity": [[0.0, 0.55], [0.5, 1.0], [1.0, 0.55]]},
	"ohUpdDrift": {"order": ["tx"], "tx": [[0.0, "from"], [1.0, "to"]]},
	"ohUpdTwinkle": {"order": [], "opacity": [[0.0, 0.15], [0.5, 0.85], [1.0, 0.15]]},
	"ohUpdStamp": {"order": ["rot", "s"], "opacity": [[0.0, 0.0], [0.7, 1.0], [1.0, 1.0]], "rot": [[0.0, -8.0], [0.7, -8.0], [1.0, -8.0]], "s": [[0.0, 1.8], [0.7, 0.94], [1.0, 1.0]]},
	"ohUpdFall": {"order": ["ty"], "ty": [[0.0, -12.0], [1.0, "fall"]], "opacity": [[0.0, 0.0], [0.15, 1.0], [0.85, 1.0], [1.0, 0.0]]},
	"ohUpdSway": {"order": ["rot"], "rot": [[0.0, -3.0], [0.5, 3.0], [1.0, -3.0]]},
	"ohUpdSpin": {"order": ["rot"], "rot": [[0.0, 0.0], [1.0, 360.0]]},
	"ohUpdGrow": {"order": ["sx"], "sx": [[0.0, 0.0], [1.0, 1.0]]},
	"ohUpdShrink": {"order": ["sx"], "sx": [[0.0, 1.0], [1.0, 0.0]]},
	"ohUpdBob": {"order": ["ty", "rot"], "ty": [[0.0, 0.0], [0.5, -14.0], [1.0, 0.0]], "rot": [[0.0, "tilt"], [0.5, "-tilt"], [1.0, "tilt"]]},
	"ohUpdRing": {"order": ["s"], "opacity": [[0.0, 0.9], [1.0, 0.0]], "s": [[0.0, 0.4], [1.0, 2.2]]},
	"ohUpdStrike": {"order": ["s", "ty"], "s": [[0.0, 1.0], [0.35, 1.3], [1.0, 1.0]], "ty": [[0.0, 0.0], [0.35, -8.0], [1.0, 0.0]]},
}
const DEFAULT_VARS := {"fall": 160.0, "length": 1000.0, "tilt": -6.0, "from": 0.0, "to": 0.0}
const TRANSFORM_KEYS := ["tx", "ty", "rot", "s", "sx"]


class Shape extends RefCounted:
	var kind := "g"
	var parts: Array[PackedVector2Array] = []
	var closed: Array[bool] = []
	var fills: Array = []
	var fill := Color(0, 0, 0, 1)
	var has_fill := true
	var stroke := Color(0, 0, 0, 1)
	var has_stroke := false
	var width := 1.0
	var cap := "butt"
	var join := "miter"
	var dash := PackedFloat32Array()
	var dash_offset := 0.0
	var opacity := 1.0
	var fill_opacity := 1.0
	var stroke_opacity := 1.0
	var attr := Transform2D.IDENTITY
	var css: Array = []
	var offset := Vector2.ZERO
	var uses_css := false
	var origin_kind := "center"
	var origin := Vector2.ZERO
	var children: Array[Shape] = []
	var anims: Array[Dictionary] = []
	var clip := PackedVector2Array()
	var text := ""
	var font: Font
	var font_size := 16.0
	var anchor := "start"
	var started := 0.0
	var visible := true
	var box := Rect2()
	var box_ready := false
	var transitions := {}
	var transition_ms := 0.0
	var transition_delay := 0.0
	var transition_curve: CubicBezier


class Painter extends Control:
	var scene: Control

	func _draw() -> void:
		if scene:
			scene.call("_paint", self)


var view_box := Rect2(0, 0, 800, 180)
var aspect := "slice"
var still := false
var root := Shape.new()
var _viewport: SubViewport
var _painter: Painter
var _display: TextureRect
var _now := 0.0
var _born := 0.0
var _path_tokens: RegEx


func _init(box := Rect2(0, 0, 800, 180), fit := "slice", motionless := false) -> void:
	view_box = box
	aspect = fit
	still = motionless
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	clip_contents = true
	_born = float(Time.get_ticks_msec())
	_now = _born
	root.started = _born
	_viewport = SubViewport.new()
	_viewport.transparent_bg = true
	_viewport.disable_3d = true
	_viewport.size = Vector2i(2, 2)
	_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_viewport.gui_disable_input = true
	_painter = Painter.new()
	_painter.scene = self
	_painter.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_viewport.add_child(_painter)
	add_child(_viewport)
	_display = TextureRect.new()
	_display.texture = _viewport.get_texture()
	_display.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_display.stretch_mode = TextureRect.STRETCH_SCALE
	_display.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	_display.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_display.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(_display)
	resized.connect(_fit_viewport)


func _ready() -> void:
	_fit_viewport()


func _fit_viewport() -> void:
	var pixels := Vector2i(maxi(1, ceili(size.x * SUPERSAMPLE)), maxi(1, ceili(size.y * SUPERSAMPLE)))
	if _viewport.size != pixels:
		_viewport.size = pixels
	_painter.size = Vector2(pixels)
	_painter.queue_redraw()


func _process(_delta: float) -> void:
	if is_visible_in_tree():
		_painter.queue_redraw()


func now_ms() -> float:
	return float(Time.get_ticks_msec())


func redraw() -> void:
	_painter.queue_redraw()


func view_matrix() -> Transform2D:
	var w := maxf(1.0, size.x)
	var h := maxf(1.0, size.y)
	match aspect:
		"none":
			return Transform2D(0.0, Vector2(w / view_box.size.x, h / view_box.size.y), 0.0, -view_box.position * Vector2(w / view_box.size.x, h / view_box.size.y))
		"pixels":
			return Transform2D(0.0, Vector2.ONE, 0.0, -view_box.position)
	var scale_value := maxf(w / view_box.size.x, h / view_box.size.y) if aspect == "slice" else minf(w / view_box.size.x, h / view_box.size.y)
	var offset_value := (Vector2(w, h) - view_box.size * scale_value) * 0.5 - view_box.position * scale_value
	return Transform2D(0.0, Vector2(scale_value, scale_value), 0.0, offset_value)


func to_view(point: Vector2) -> Vector2:
	return view_matrix().affine_inverse() * point


static func color(value: Variant) -> Color:
	if value is Color:
		return value
	var text := str(value).strip_edges()
	if text.begins_with("#"):
		var hex := text.substr(1)
		if hex.length() == 3:
			hex = "%s%s%s%s%s%s" % [hex[0], hex[0], hex[1], hex[1], hex[2], hex[2]]
		return Color.html(hex)
	if text.begins_with("rgb"):
		var inner := text.substr(text.find("(") + 1, text.rfind(")") - text.find("(") - 1)
		var parts := inner.split(",")
		var alpha := 1.0
		if parts.size() >= 4:
			alpha = float(parts[3])
		return Color(float(parts[0]) / 255.0, float(parts[1]) / 255.0, float(parts[2]) / 255.0, alpha)
	return Color.from_string(text, Color(0, 0, 0, 1))


static func faded(value: Color, alpha: float) -> Color:
	return Color(value.r, value.g, value.b, value.a * alpha)


static func motion(name: String, duration: float, delay := 0.0, timing := "cubic-bezier(0.2, 0.7, 0.2, 1)", vars := {}) -> Dictionary:
	return {"name": name, "duration": duration, "delay": delay, "timing": timing, "infinite": false, "vars": vars}


static func forever(name: String, duration: float, delay := 0.0, timing := "linear", vars := {}) -> Dictionary:
	return {"name": name, "duration": duration, "delay": delay, "timing": timing, "infinite": true, "vars": vars}


func _resolve_anim(spec: Dictionary) -> Dictionary:
	var frames: Dictionary = KEYFRAMES.get(str(spec.get("name", "")), {})
	var vars: Dictionary = spec.get("vars", {})
	var tracks := {}
	for key in frames.keys():
		if key == "order":
			continue
		var stops: Array = []
		for stop in frames[key]:
			var at: float = float(stop[0])
			var raw: Variant = stop[1]
			var value := 0.0
			if raw is String:
				var name := str(raw)
				var negative := name.begins_with("-")
				name = name.trim_prefix("-")
				value = float(vars.get(name, DEFAULT_VARS.get(name, 0.0)))
				if negative:
					value = -value
			else:
				value = float(raw)
			stops.append([at, value])
		tracks[key] = stops
	return {
		"order": frames.get("order", []),
		"tracks": tracks,
		"duration": maxf(1.0, float(spec.get("duration", 1000.0))),
		"delay": float(spec.get("delay", 0.0)),
		"curve": CubicBezier.named(str(spec.get("timing", "linear"))),
		"infinite": bool(spec.get("infinite", false)),
	}


func apply(shape: Shape, props: Dictionary) -> Shape:
	if props.has("fill"):
		var fill_value: Variant = props["fill"]
		if fill_value == null:
			shape.has_fill = false
		else:
			shape.has_fill = true
			shape.fill = color(fill_value)
	if props.has("stroke"):
		var stroke_value: Variant = props["stroke"]
		shape.has_stroke = stroke_value != null
		if stroke_value != null:
			shape.stroke = color(stroke_value)
	if props.has("width"):
		shape.width = float(props["width"])
	if props.has("cap"):
		shape.cap = str(props["cap"])
	if props.has("join"):
		shape.join = str(props["join"])
	if props.has("dash"):
		var pattern := PackedFloat32Array()
		for entry in props["dash"]:
			pattern.append(float(entry))
		shape.dash = pattern
	if props.has("dash_offset"):
		shape.dash_offset = float(props["dash_offset"])
	if props.has("opacity"):
		shape.opacity = float(props["opacity"])
	if props.has("fill_opacity"):
		shape.fill_opacity = float(props["fill_opacity"])
	if props.has("stroke_opacity"):
		shape.stroke_opacity = float(props["stroke_opacity"])
	if props.has("transform"):
		shape.attr = props["transform"]
	if props.has("css"):
		shape.css = props["css"]
		shape.uses_css = true
	if props.has("offset"):
		shape.offset = props["offset"]
		shape.uses_css = true
	if props.has("origin"):
		var spec: Variant = props["origin"]
		if spec is Vector2:
			shape.origin_kind = "box"
			shape.origin = spec
		elif spec is Dictionary:
			shape.origin_kind = str((spec as Dictionary).get("kind", "box"))
			shape.origin = (spec as Dictionary).get("at", Vector2.ZERO)
		else:
			shape.origin_kind = str(spec)
	if props.has("anims") and not still:
		for spec in props["anims"]:
			shape.anims.append(_resolve_anim(spec))
	if props.has("transition") and not still:
		var transition: Dictionary = props["transition"]
		shape.transition_ms = float(transition.get("ms", 0.0))
		shape.transition_delay = float(transition.get("delay", 0.0))
		shape.transition_curve = CubicBezier.named(str(transition.get("timing", "ease")))
	if props.has("visible"):
		shape.visible = bool(props["visible"])
	shape.started = _now
	return shape


func _attach(parent: Shape, shape: Shape, props: Dictionary) -> Shape:
	apply(shape, props)
	if parent:
		parent.children.append(shape)
	return shape


func group(parent: Shape, props := {}) -> Shape:
	var shape := Shape.new()
	shape.kind = "g"
	return _attach(parent, shape, props)


func rect(parent: Shape, x: float, y: float, w: float, h: float, props := {}) -> Shape:
	var shape := Shape.new()
	shape.kind = "rect"
	var radius := minf(float(props.get("rx", 0.0)), minf(w, h) * 0.5)
	var points := PackedVector2Array()
	if radius <= 0.0:
		points = PackedVector2Array([Vector2(x, y), Vector2(x + w, y), Vector2(x + w, y + h), Vector2(x, y + h)])
	else:
		var corners := [[Vector2(x + w - radius, y + radius), -PI * 0.5], [Vector2(x + w - radius, y + h - radius), 0.0], [Vector2(x + radius, y + h - radius), PI * 0.5], [Vector2(x + radius, y + radius), PI]]
		points.append(Vector2(x + radius, y))
		for corner in corners:
			var centre: Vector2 = corner[0]
			var start: float = corner[1]
			for step in range(9):
				var angle := start + PI * 0.5 * float(step) / 8.0
				points.append(centre + Vector2(cos(angle), sin(angle)) * radius)
	_set_parts(shape, [points], [true])
	return _attach(parent, shape, props)


func ellipse(parent: Shape, cx: float, cy: float, rx: float, ry: float, props := {}) -> Shape:
	var shape := Shape.new()
	shape.kind = "ellipse"
	var segments := clampi(roundi(maxf(rx, ry) * 1.4), 24, 160)
	var points := PackedVector2Array()
	for step in range(segments):
		var angle := TAU * float(step) / float(segments)
		points.append(Vector2(cx + cos(angle) * rx, cy + sin(angle) * ry))
	_set_parts(shape, [points], [true])
	return _attach(parent, shape, props)


func circle(parent: Shape, cx: float, cy: float, r: float, props := {}) -> Shape:
	return ellipse(parent, cx, cy, r, r, props)


func line(parent: Shape, x1: float, y1: float, x2: float, y2: float, props := {}) -> Shape:
	var shape := Shape.new()
	shape.kind = "line"
	_set_parts(shape, [PackedVector2Array([Vector2(x1, y1), Vector2(x2, y2)])], [false])
	var merged := {"fill": null}
	merged.merge(props, true)
	return _attach(parent, shape, merged)


func path(parent: Shape, data: String, props := {}) -> Shape:
	var shape := Shape.new()
	shape.kind = "path"
	var parsed := parse_path(data)
	_set_parts(shape, parsed[0], parsed[1])
	return _attach(parent, shape, props)


func text(parent: Shape, x: float, y: float, content: String, props := {}) -> Shape:
	var shape := Shape.new()
	shape.kind = "text"
	shape.text = content
	shape.font = ShellFonts.font(str(props.get("family", "serif")), int(props.get("weight", 400)))
	shape.font_size = float(props.get("size", 16.0))
	shape.anchor = str(props.get("anchor", "start"))
	shape.origin = Vector2(x, y)
	shape.parts = [PackedVector2Array([Vector2(x, y)])]
	shape.closed = [false]
	return _attach(parent, shape, props)


func _set_parts(shape: Shape, parts: Array, closed: Array) -> void:
	shape.parts.clear()
	shape.closed.clear()
	shape.fills.clear()
	for index in range(parts.size()):
		var is_closed := bool(closed[index])
		var points := _clean(parts[index], is_closed)
		if points.size() < 1:
			continue
		shape.parts.append(points)
		shape.closed.append(is_closed)
		for entry in _fillable(points):
			shape.fills.append(entry)


func _clean(raw: PackedVector2Array, is_closed: bool) -> PackedVector2Array:
	var clean := PackedVector2Array()
	for point in raw:
		if clean.is_empty() or clean[clean.size() - 1].distance_squared_to(point) > 1e-8:
			clean.append(point)
	if is_closed and clean.size() > 2 and clean[0].distance_squared_to(clean[clean.size() - 1]) <= 1e-8:
		clean.remove_at(clean.size() - 1)
	return clean


func _fillable(points: PackedVector2Array) -> Array:
	var out: Array = []
	if points.size() < 3:
		return out
	var indices := Geometry2D.triangulate_polygon(points)
	if indices.size() >= 3:
		out.append([points, indices])
		return out
	var fixed := Geometry2D.merge_polygons(points, PackedVector2Array())
	for polygon in fixed:
		var poly: PackedVector2Array = polygon
		if fixed.size() > 1 and Geometry2D.is_polygon_clockwise(poly):
			continue
		var tri := Geometry2D.triangulate_polygon(poly)
		if tri.size() >= 3:
			out.append([poly, tri])
	return out


func parse_path(data: String) -> Array:
	if not _path_tokens:
		_path_tokens = RegEx.create_from_string("[MmLlHhVvCcSsQqTtZz]|[-+]?(?:\\d*\\.\\d+|\\d+\\.?)(?:[eE][-+]?\\d+)?")
	var tokens: PackedStringArray = []
	for found in _path_tokens.search_all(data):
		tokens.append(found.get_string())
	var parts: Array = []
	var closed: Array = []
	var current := PackedVector2Array()
	var pen := Vector2.ZERO
	var start := Vector2.ZERO
	var last_control := Vector2.ZERO
	var last_command := ""
	var command := ""
	var index := 0
	while index < tokens.size():
		var token := tokens[index]
		if token.length() == 1 and "MmLlHhVvCcSsQqTtZz".contains(token):
			command = token
			index += 1
			if command == "Z" or command == "z":
				if current.size() > 0:
					parts.append(current)
					closed.append(true)
					current = PackedVector2Array()
				pen = start
				last_command = command
				continue
		elif command.is_empty():
			index += 1
			continue
		var relative := command == command.to_lower()
		var base := pen if relative else Vector2.ZERO
		match command.to_upper():
			"M":
				if current.size() >= 2:
					parts.append(current)
					closed.append(false)
				current = PackedVector2Array()
				pen = base + Vector2(float(tokens[index]), float(tokens[index + 1]))
				index += 2
				start = pen
				current.append(pen)
				command = "l" if relative else "L"
				last_control = pen
			"L":
				pen = base + Vector2(float(tokens[index]), float(tokens[index + 1]))
				index += 2
				if current.is_empty():
					current.append(start)
				current.append(pen)
				last_control = pen
			"H":
				pen = Vector2((pen.x if relative else 0.0) + float(tokens[index]), pen.y)
				index += 1
				if current.is_empty():
					current.append(start)
				current.append(pen)
				last_control = pen
			"V":
				pen = Vector2(pen.x, (pen.y if relative else 0.0) + float(tokens[index]))
				index += 1
				if current.is_empty():
					current.append(start)
				current.append(pen)
				last_control = pen
			"C", "S":
				var c1: Vector2
				var c2: Vector2
				var end: Vector2
				if command.to_upper() == "C":
					c1 = base + Vector2(float(tokens[index]), float(tokens[index + 1]))
					c2 = base + Vector2(float(tokens[index + 2]), float(tokens[index + 3]))
					end = base + Vector2(float(tokens[index + 4]), float(tokens[index + 5]))
					index += 6
				else:
					c1 = pen * 2.0 - last_control if last_command.to_upper() in ["C", "S"] else pen
					c2 = base + Vector2(float(tokens[index]), float(tokens[index + 1]))
					end = base + Vector2(float(tokens[index + 2]), float(tokens[index + 3]))
					index += 4
				if current.is_empty():
					current.append(start)
				var span := pen.distance_to(c1) + c1.distance_to(c2) + c2.distance_to(end)
				var steps := clampi(ceili(span / 3.0), 8, 64)
				for step in range(1, steps + 1):
					var t := float(step) / float(steps)
					var u := 1.0 - t
					current.append(pen * u * u * u + c1 * 3.0 * u * u * t + c2 * 3.0 * u * t * t + end * t * t * t)
				last_control = c2
				pen = end
			"Q", "T":
				var q: Vector2
				var end_q: Vector2
				if command.to_upper() == "Q":
					q = base + Vector2(float(tokens[index]), float(tokens[index + 1]))
					end_q = base + Vector2(float(tokens[index + 2]), float(tokens[index + 3]))
					index += 4
				else:
					q = pen * 2.0 - last_control if last_command.to_upper() in ["Q", "T"] else pen
					end_q = base + Vector2(float(tokens[index]), float(tokens[index + 1]))
					index += 2
				if current.is_empty():
					current.append(start)
				var span_q := pen.distance_to(q) + q.distance_to(end_q)
				var steps_q := clampi(ceili(span_q / 3.0), 6, 48)
				for step in range(1, steps_q + 1):
					var t := float(step) / float(steps_q)
					var u := 1.0 - t
					current.append(pen * u * u + q * 2.0 * u * t + end_q * t * t)
				last_control = q
				pen = end_q
			_:
				index += 1
		last_command = command
	if current.size() >= 2:
		parts.append(current)
		closed.append(false)
	return [parts, closed]


func set_fill(shape: Shape, value: Variant) -> void:
	var target := color(value)
	_transition(shape, "fill", shape.fill, target)
	shape.fill = target
	shape.has_fill = true
	redraw()


func set_opacity(shape: Shape, value: float) -> void:
	_transition(shape, "opacity", shape.opacity, value)
	shape.opacity = value
	redraw()


func shift_to(shape: Shape, value: Vector2) -> void:
	_transition(shape, "offset", shape.offset, value)
	shape.offset = value
	shape.uses_css = true
	redraw()


func _transition(shape: Shape, property: String, previous: Variant, target: Variant) -> void:
	if still or shape.transition_ms <= 0.0:
		shape.transitions.erase(property)
		return
	var now := now_ms()
	var current: Variant = _current(shape, property, previous, now)
	if typeof(current) == typeof(target) and current == target:
		shape.transitions.erase(property)
		return
	shape.transitions[property] = {"from": current, "to": target, "at": now, "duration": shape.transition_ms, "delay": shape.transition_delay, "curve": shape.transition_curve}


func _current(shape: Shape, property: String, base: Variant, now: float) -> Variant:
	if not shape.transitions.has(property):
		return base
	var state: Dictionary = shape.transitions[property]
	var t := (now - float(state["at"]) - float(state["delay"])) / maxf(1.0, float(state["duration"]))
	if t <= 0.0:
		return state["from"]
	if t >= 1.0:
		shape.transitions.erase(property)
		return state["to"]
	var eased := (state["curve"] as CubicBezier).at(t)
	var from: Variant = state["from"]
	var to: Variant = state["to"]
	if from is Color:
		return (from as Color).lerp(to as Color, eased)
	if from is Vector2:
		return (from as Vector2).lerp(to as Vector2, eased)
	return lerpf(float(from), float(to), eased)


func restart(shape: Shape) -> void:
	shape.started = now_ms()
	for child in shape.children:
		restart(child)


func _sample(anim: Dictionary, shape: Shape) -> Dictionary:
	var elapsed := _now - shape.started - float(anim["delay"])
	var duration := float(anim["duration"])
	var progress := 0.0
	if elapsed < 0.0:
		progress = 0.0
	elif bool(anim["infinite"]):
		progress = fmod(elapsed, duration) / duration
	else:
		progress = minf(1.0, elapsed / duration)
	var curve: CubicBezier = anim["curve"]
	var values := {}
	var tracks: Dictionary = anim["tracks"]
	for key in tracks.keys():
		var stops: Array = tracks[key]
		var value: float = float(stops[0][1])
		if progress >= float(stops[stops.size() - 1][0]):
			value = float(stops[stops.size() - 1][1])
		elif progress > float(stops[0][0]):
			for index in range(stops.size() - 1):
				var a: Array = stops[index]
				var b: Array = stops[index + 1]
				if progress <= float(b[0]):
					var span := maxf(1e-6, float(b[0]) - float(a[0]))
					value = lerpf(float(a[1]), float(b[1]), curve.at((progress - float(a[0])) / span))
					break
		values[key] = value
	return values


func box_of(shape: Shape) -> Rect2:
	if shape.box_ready:
		return shape.box
	var found := false
	var result := Rect2()
	if shape.kind == "g":
		for child in shape.children:
			if child.kind == "g" and child.children.is_empty():
				continue
			if child.kind != "g" and child.kind != "text" and child.parts.is_empty():
				continue
			var child_box := box_of(child)
			var placed := _static_local(child) * child_box
			result = placed if not found else result.merge(placed)
			found = true
	elif shape.kind == "text":
		var width := shape.font.get_string_size(shape.text, HORIZONTAL_ALIGNMENT_LEFT, -1, int(shape.font_size)).x if shape.font else shape.font_size * 0.6
		var left := shape.origin.x - (width * 0.5 if shape.anchor == "middle" else (width if shape.anchor == "end" else 0.0))
		result = Rect2(left, shape.origin.y - shape.font_size * 0.8, width, shape.font_size)
		found = true
	else:
		for points in shape.parts:
			for point in points:
				if not found:
					result = Rect2(point, Vector2.ZERO)
					found = true
				else:
					result = result.expand(point)
	shape.box = result
	shape.box_ready = true
	return result


func _origin_point(shape: Shape) -> Vector2:
	match shape.origin_kind:
		"view":
			return shape.origin
		"box":
			return box_of(shape).position + shape.origin
		"left":
			var left_box := box_of(shape)
			return Vector2(left_box.position.x, left_box.get_center().y)
		"right":
			var right_box := box_of(shape)
			return Vector2(right_box.end.x, right_box.get_center().y)
	return box_of(shape).get_center()


func _ops_matrix(ops: Array) -> Transform2D:
	var matrix := Transform2D.IDENTITY
	for op in ops:
		var name: String = op[0]
		match name:
			"translate":
				matrix = matrix * Transform2D(0.0, Vector2(float(op[1]), float(op[2])))
			"rotate":
				matrix = matrix * Transform2D(deg_to_rad(float(op[1])), Vector2.ZERO)
			"scale":
				var sx := float(op[1])
				var sy := float(op[2]) if op.size() > 2 else sx
				matrix = matrix * Transform2D(0.0, Vector2(sx, sy), 0.0, Vector2.ZERO)
	return matrix


func _around(shape: Shape, matrix: Transform2D) -> Transform2D:
	var pivot := _origin_point(shape)
	return Transform2D(0.0, pivot) * matrix * Transform2D(0.0, -pivot)


func _static_local(shape: Shape) -> Transform2D:
	if shape.uses_css:
		return _around(shape, Transform2D(0.0, shape.offset) * _ops_matrix(shape.css))
	return shape.attr


func _local(shape: Shape) -> Array:
	var matrix := shape.attr
	var opacity := float(_current(shape, "opacity", shape.opacity, _now))
	var dash_offset := shape.dash_offset
	var dash_override := false
	if shape.uses_css:
		var offset_now: Vector2 = _current(shape, "offset", shape.offset, _now)
		matrix = _around(shape, Transform2D(0.0, offset_now) * _ops_matrix(shape.css))
	for anim in shape.anims:
		var values := _sample(anim, shape)
		var order: Array = anim["order"]
		if not order.is_empty():
			var animated := Transform2D.IDENTITY
			for key in order:
				match str(key):
					"tx":
						animated = animated * Transform2D(0.0, Vector2(float(values.get("tx", 0.0)), 0.0))
					"ty":
						animated = animated * Transform2D(0.0, Vector2(0.0, float(values.get("ty", 0.0))))
					"rot":
						animated = animated * Transform2D(deg_to_rad(float(values.get("rot", 0.0))), Vector2.ZERO)
					"s":
						var s := float(values.get("s", 1.0))
						animated = animated * Transform2D(0.0, Vector2(s, s), 0.0, Vector2.ZERO)
					"sx":
						animated = animated * Transform2D(0.0, Vector2(float(values.get("sx", 1.0)), 1.0), 0.0, Vector2.ZERO)
			matrix = _around(shape, animated)
		if values.has("opacity"):
			opacity = float(values["opacity"])
		if values.has("dash"):
			dash_offset = float(values["dash"])
			dash_override = true
	return [matrix, opacity, dash_offset, dash_override]


func _paint(canvas: Control) -> void:
	_now = now_ms()
	var base := Transform2D(0.0, Vector2(SUPERSAMPLE, SUPERSAMPLE), 0.0, Vector2.ZERO) * view_matrix()
	_draw_shape(canvas, root, base, 1.0, {})
	canvas.draw_set_transform_matrix(Transform2D.IDENTITY)


func _draw_shape(canvas: Control, shape: Shape, parent: Transform2D, parent_opacity: float, clipping: Dictionary) -> void:
	if not shape.visible:
		return
	var local := _local(shape)
	var matrix: Transform2D = parent * (local[0] as Transform2D)
	var opacity: float = parent_opacity * float(local[1])
	if opacity <= 0.002:
		return
	if shape.kind == "g":
		var next_clip := clipping
		if shape.clip.size() >= 3:
			next_clip = {"poly": shape.clip, "matrix": matrix, "from": matrix.affine_inverse()}
		for child in shape.children:
			_draw_shape(canvas, child, matrix, opacity, next_clip)
		return
	if shape.kind == "text":
		_draw_text(canvas, shape, matrix, opacity)
		return
	var fill_color := _current(shape, "fill", shape.fill, _now) as Color
	if shape.has_fill:
		var tint := faded(fill_color, opacity * shape.fill_opacity)
		if tint.a > 0.002:
			if clipping.is_empty():
				canvas.draw_set_transform_matrix(matrix)
				for entry in shape.fills:
					RenderingServer.canvas_item_add_triangle_array(canvas.get_canvas_item(), entry[1], entry[0], PackedColorArray([tint]))
			else:
				var into: Transform2D = (clipping["from"] as Transform2D) * matrix
				canvas.draw_set_transform_matrix(clipping["matrix"])
				for entry in shape.fills:
					var moved: PackedVector2Array = into * (entry[0] as PackedVector2Array)
					for piece in Geometry2D.intersect_polygons(moved, clipping["poly"]):
						var polygon: PackedVector2Array = piece
						if Geometry2D.is_polygon_clockwise(polygon) and Geometry2D.is_polygon_clockwise(moved) != Geometry2D.is_polygon_clockwise(polygon):
							continue
						var tri := Geometry2D.triangulate_polygon(polygon)
						if tri.size() >= 3:
							RenderingServer.canvas_item_add_triangle_array(canvas.get_canvas_item(), tri, polygon, PackedColorArray([tint]))
	if shape.has_stroke and shape.width > 0.0:
		var ink := faded(shape.stroke, opacity * shape.stroke_opacity)
		if ink.a > 0.002:
			canvas.draw_set_transform_matrix(matrix)
			var pattern := shape.dash
			var dash_offset := float(local[2])
			if bool(local[3]) and pattern.is_empty():
				pattern = PackedFloat32Array([float(_anim_length(shape))])
			for index in range(shape.parts.size()):
				var points: PackedVector2Array = shape.parts[index]
				var is_closed: bool = shape.closed[index]
				if pattern.is_empty():
					_stroke_line(canvas, points, is_closed, ink, shape)
				else:
					for piece in _dashes(points, is_closed, pattern, dash_offset):
						_stroke_line(canvas, piece, false, ink, shape)


func _anim_length(shape: Shape) -> float:
	for anim in shape.anims:
		var tracks: Dictionary = anim["tracks"]
		if tracks.has("dash"):
			return float((tracks["dash"] as Array)[0][1])
	return 1000.0


func _stroke_line(canvas: Control, points: PackedVector2Array, closed: bool, ink: Color, shape: Shape) -> void:
	if points.size() < 2:
		return
	var line_points := points
	if closed:
		line_points = points.duplicate()
		line_points.append(points[0])
		if points.size() > 2:
			line_points.append(points[1])
	canvas.draw_polyline(line_points, ink, shape.width, true)
	var half := shape.width * 0.5
	if shape.cap == "round" and not closed:
		canvas.draw_circle(points[0], half, ink, true, -1.0, true)
		canvas.draw_circle(points[points.size() - 1], half, ink, true, -1.0, true)
	elif shape.cap == "square" and not closed:
		for end in [[points[0], points[1]], [points[points.size() - 1], points[points.size() - 2]]]:
			var tip: Vector2 = end[0]
			var away: Vector2 = (tip - (end[1] as Vector2)).normalized() * half
			canvas.draw_line(tip, tip + away, ink, shape.width, true)
	if shape.join == "round" and points.size() > 2:
		for index in range(1, points.size() - 1):
			var before := (points[index] - points[index - 1]).normalized()
			var after := (points[index + 1] - points[index]).normalized()
			if before.dot(after) < 0.94:
				canvas.draw_circle(points[index], half, ink, true, -1.0, true)


func _dashes(points: PackedVector2Array, closed: bool, pattern: PackedFloat32Array, offset_value: float) -> Array:
	var full := pattern
	if full.size() % 2 == 1:
		full = pattern.duplicate()
		full.append_array(pattern)
	var total := 0.0
	for entry in full:
		total += maxf(0.0, entry)
	var line_points := points
	if closed:
		line_points = points.duplicate()
		line_points.append(points[0])
	if total <= 0.0001:
		return [line_points]
	var phase := fposmod(offset_value, total)
	var slot := 0
	while phase >= full[slot] and full[slot] >= 0.0:
		phase -= full[slot]
		slot = (slot + 1) % full.size()
	var remaining := full[slot] - phase
	var on := slot % 2 == 0
	var pieces: Array = []
	var current := PackedVector2Array()
	if on:
		current.append(line_points[0])
	var guard := 0
	for index in range(line_points.size() - 1):
		var a := line_points[index]
		var b := line_points[index + 1]
		var length := a.distance_to(b)
		var used := 0.0
		while length - used > remaining and guard < 20000:
			guard += 1
			used += remaining
			var cut := a.lerp(b, used / maxf(1e-6, length))
			if on:
				current.append(cut)
				if current.size() >= 2:
					pieces.append(current)
				current = PackedVector2Array()
			else:
				current = PackedVector2Array([cut])
			on = not on
			slot = (slot + 1) % full.size()
			remaining = maxf(0.0001, full[slot])
		remaining -= length - used
		if on:
			current.append(b)
	if on and current.size() >= 2:
		pieces.append(current)
	return pieces


func _draw_text(canvas: Control, shape: Shape, matrix: Transform2D, opacity: float) -> void:
	if not shape.font or shape.text.is_empty():
		return
	var tint := faded(_current(shape, "fill", shape.fill, _now) as Color, opacity * shape.fill_opacity)
	if tint.a <= 0.002:
		return
	var scale_value := matrix.x.length()
	var size_px := maxi(1, roundi(shape.font_size * scale_value))
	var at := matrix * shape.origin
	var width := shape.font.get_string_size(shape.text, HORIZONTAL_ALIGNMENT_LEFT, -1, size_px).x
	if shape.anchor == "middle":
		at.x -= width * 0.5
	elif shape.anchor == "end":
		at.x -= width
	canvas.draw_set_transform_matrix(Transform2D.IDENTITY)
	canvas.draw_string(shape.font, at, shape.text, HORIZONTAL_ALIGNMENT_LEFT, -1, size_px, tint)


func hit(point: Vector2, shape: Shape, parent := Transform2D.IDENTITY) -> bool:
	var local := _local(shape)
	var matrix: Transform2D = parent * (local[0] as Transform2D)
	if shape.kind == "g":
		for child in shape.children:
			if hit(point, child, matrix):
				return true
		return false
	var inside := matrix.affine_inverse() * point
	for points in shape.parts:
		if points.size() >= 3 and Geometry2D.is_point_in_polygon(inside, points):
			return true
	return false
