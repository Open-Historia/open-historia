class_name WarKit
extends RefCounted

const WORLD := 4096.0
const EDGE := Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.92)
const TONES := {"own": Color("#e9b949"), "enemy": Color("#e0454d"), "other": Color("#ece7da")}

static var _sprites: Dictionary = {}
static var _flags: Dictionary = {}


static func stops(level: float, table: Array) -> float:
	if table.is_empty():
		return 0.0
	var first: Array = table[0]
	if level <= float(first[0]):
		return float(first[1])
	for index in range(1, table.size()):
		var stop: Array = table[index]
		if level <= float(stop[0]):
			var before: Array = table[index - 1]
			var span := float(stop[0]) - float(before[0])
			var part := (level - float(before[0])) / span if span > 0.0 else 1.0
			return lerpf(float(before[1]), float(stop[1]), part)
	var last: Array = table[table.size() - 1]
	return float(last[1])


static func color_of(value: Variant, alpha := 1.0) -> Color:
	if value is Array and (value as Array).size() >= 3:
		var rgb: Array = value
		return Color(float(rgb[0]) / 255.0, float(rgb[1]) / 255.0, float(rgb[2]) / 255.0, alpha)
	return Color(120 / 255.0, 120 / 255.0, 120 / 255.0, alpha)


static func faded(color: Color, alpha: float) -> Color:
	return Color(color.r, color.g, color.b, color.a * alpha)


static func project(lon: float, lat: float) -> Vector2:
	return MapView.CityLayer.ohproject(lon, lat)


static func points_of(flat: Variant) -> PackedVector2Array:
	var out := PackedVector2Array()
	if not (flat is Array):
		return out
	var values: Array = flat
	var count := values.size() / 2
	out.resize(count)
	for index in range(count):
		out[index] = Vector2(float(values[index * 2]), float(values[index * 2 + 1]))
	return out


static func ints_of(values: Variant) -> PackedInt32Array:
	var out := PackedInt32Array()
	if values is Array:
		for value in values:
			out.append(int(value))
	return out


static func dashes(points: PackedVector2Array, dash: float, gap: float, start := 0.0) -> Array[PackedVector2Array]:
	var out: Array[PackedVector2Array] = []
	if points.size() < 2 or dash <= 0.0:
		return out
	var period: float = dash + maxf(gap, 0.0)
	var along := fposmod(start, period)
	var current := PackedVector2Array()
	var drawing := along < dash
	if drawing:
		current.append(points[0])
	for index in range(1, points.size()):
		var from := points[index - 1]
		var to := points[index]
		var length := from.distance_to(to)
		var walked := 0.0
		while walked < length:
			var left: float = (dash - along) if drawing else (period - along)
			var step := minf(left, length - walked)
			walked += step
			along += step
			var at: Vector2 = from.lerp(to, walked / length) if length > 0.0 else to
			if drawing:
				current.append(at)
			if along >= (dash if drawing else period) - 0.00001:
				if drawing:
					if current.size() >= 2:
						out.append(current)
					current = PackedVector2Array()
					drawing = false
				else:
					along = 0.0
					drawing = true
					current = PackedVector2Array([at])
	if drawing and current.size() >= 2:
		out.append(current)
	return out


static func offset_line(points: PackedVector2Array, distance: float) -> PackedVector2Array:
	var out := PackedVector2Array()
	var count := points.size()
	if count < 2:
		return points
	out.resize(count)
	for index in range(count):
		var before := points[maxi(0, index - 1)]
		var after := points[mini(count - 1, index + 1)]
		var normal := Vector2.ZERO
		if index > 0:
			var incoming := (points[index] - before).normalized()
			normal += Vector2(-incoming.y, incoming.x)
		if index < count - 1:
			var outgoing := (after - points[index]).normalized()
			normal += Vector2(-outgoing.y, outgoing.x)
		normal = normal.normalized()
		var scale := 1.0
		if index > 0 and index < count - 1:
			var incoming_normal := (points[index] - before).normalized()
			var cosine := normal.dot(Vector2(-incoming_normal.y, incoming_normal.x))
			scale = 1.0 / maxf(cosine, 0.35)
		out[index] = points[index] - normal * distance * scale
	return out


static func sprite(kind: String) -> Texture2D:
	if _sprites.has(kind):
		return _sprites[kind]
	var size := 64
	var image := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	for y in range(size):
		for x in range(size):
			var p := Vector2((x + 0.5) / size * 2.0 - 1.0, -((y + 0.5) / size * 2.0 - 1.0))
			var far := p.length()
			var seen := 0.0
			var tint := Color(1, 1, 1)
			match kind:
				"glow":
					seen = smoothstep(1.0, 0.0, far)
					seen *= seen
				"flash":
					seen = smoothstep(1.0, 0.22, far)
				"ring":
					seen = smoothstep(0.6, 0.78, far) * smoothstep(1.0, 0.86, far)
				"plane":
					seen = _aircraft(Vector2(p.y, -p.x), 0.0)
				"plane_edge":
					var inner := _aircraft(Vector2(p.y, -p.x), 0.0)
					seen = _aircraft(Vector2(p.y, -p.x), 0.08) * (1.0 - inner)
					tint = Color(0.03, 0.05, 0.08)
			image.set_pixel(x, y, Color(tint.r, tint.g, tint.b, seen))
	var texture := ImageTexture.create_from_image(image)
	_sprites[kind] = texture
	return texture


static func _aircraft(q: Vector2, grow: float) -> float:
	var side := absf(q.y)
	var body := _step(side, 0.11 + grow) * _step(-0.86 - grow, q.x) * _step(q.x, 0.92 + grow)
	var wing := _step(side, 0.9 + grow) * _step(q.x, 0.26 - 0.55 * side + grow) * _step(-0.06 - 0.36 * side - grow, q.x)
	var tail := _step(side, 0.36 + grow) * _step(-0.9 - grow, q.x) * _step(q.x, -0.62 + grow)
	return maxf(body, maxf(wing, tail))


static func _step(edge: float, value: float) -> float:
	return 1.0 if value >= edge else 0.0


static func flag(path: String) -> Texture2D:
	if path.is_empty():
		return null
	if _flags.has(path):
		return _flags[path]
	var image := Image.new()
	var loaded := false
	if path.to_lower().ends_with(".svg"):
		var file := FileAccess.open(path, FileAccess.READ)
		if file:
			var svg := file.get_as_text()
			var probe := Image.new()
			if probe.load_svg_from_string(svg, 1.0) == OK and probe.get_width() > 0 and probe.get_height() > 0:
				var fit := 64.0 / minf(probe.get_width(), probe.get_height())
				loaded = image.load_svg_from_string(svg, maxf(fit, 0.05)) == OK
	else:
		loaded = image.load(path) == OK
	if not loaded or image.get_width() == 0:
		_flags[path] = null
		return null
	image.convert(Image.FORMAT_RGBA8)
	var width := image.get_width()
	var height := image.get_height()
	var cover := maxf(64.0 / width, 64.0 / height)
	var scaled_w := maxi(64, int(ceil(width * cover)))
	var scaled_h := maxi(64, int(ceil(height * cover)))
	image.resize(scaled_w, scaled_h, Image.INTERPOLATE_BILINEAR)
	var round_image := Image.create_empty(64, 64, false, Image.FORMAT_RGBA8)
	var left := (scaled_w - 64) / 2
	var top := (scaled_h - 64) / 2
	for y in range(64):
		for x in range(64):
			var d := Vector2(x + 0.5 - 32.0, y + 0.5 - 32.0).length()
			var cover_alpha := clampf(32.0 - d + 0.5, 0.0, 1.0)
			if cover_alpha <= 0.0:
				continue
			var c := image.get_pixel(x + left, y + top)
			round_image.set_pixel(x, y, Color(c.r, c.g, c.b, c.a * cover_alpha))
	var texture := ImageTexture.create_from_image(round_image)
	_flags[path] = texture
	return texture
