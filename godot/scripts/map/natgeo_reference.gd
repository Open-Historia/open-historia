class_name NatGeoReference
extends Node

const MAX_REQUESTS := 3
const MAX_TILE_ZOOM := 16
const RETRY_MS := 15000
const TILE_PX := 512.0
const ONE_EM := 24.0
const RECT_BUFFER := 4.0
const SHAPING_DEFAULT_OFFSET := -17.0
const ATLAS_SIZE := 2048
const BREAKABLE := [0x0a, 0x20, 0x26, 0x29, 0x2b, 0x2d, 0x2f, 0xad, 0xb7, 0x200b, 0x2010, 0x2013, 0x2027]
const WHITESPACE := [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20]
const SYMBOL_SHADER := """
shader_type canvas_item;
render_mode blend_mix;
varying vec4 data;
varying vec4 tint;

void vertex() {
	data = CUSTOM0;
	tint = COLOR;
}

void fragment() {
	vec4 sampled = texture(TEXTURE, UV);
	if (data.x < 0.5) {
		COLOR = sampled * tint;
	} else {
		float edge_gamma = 0.105;
		float font_scale = max(data.y, 0.0001);
		float gamma = edge_gamma / font_scale;
		float inner_edge = (256.0 - 64.0) / 256.0;
		bool halo = data.x > 1.5;
		if (halo) {
			gamma = (data.w * 1.19 / 8.0 + edge_gamma) / font_scale;
			inner_edge = inner_edge + gamma;
		}
		float dist = sampled.r;
		float alpha = smoothstep(inner_edge - gamma, inner_edge + gamma, dist);
		if (halo) {
			float halo_edge = (6.0 - data.z / font_scale) / 8.0;
			alpha = min(smoothstep(halo_edge - gamma, halo_edge + gamma, dist), 1.0 - alpha);
		}
		COLOR = vec4(tint.rgb, tint.a * alpha);
	}
}
"""

var extras: Node
var map_view: MapView
var enabled := false
var labels: NatGeoLabels
var _tiles := {}
var _label_sets := {}
var _queue: Array = []
var _active := 0
var _wanted: Array[String] = []
var _wanted_labels: Array[String] = []
var _label_keys_shown: Array[String] = []
var _shown := {}
var _generation := 0
var _glyphs := {}
var _ranges := {}
var _atlas: Image
var _atlas_texture: ImageTexture
var _shelf := Vector3i.ZERO
var _sprite_json := {}
var _sprite_texture: Texture2D
var _sprite_state := ""


func setup(owner_extras: Node, view: MapView) -> void:
	extras = owner_extras
	map_view = view
	_atlas = Image.create(ATLAS_SIZE, ATLAS_SIZE, false, Image.FORMAT_L8)
	_atlas_texture = ImageTexture.create_from_image(_atlas)
	labels = NatGeoLabels.new()
	labels.reference = self
	labels.map_view = view
	var shader := Shader.new()
	shader.code = SYMBOL_SHADER
	var material := ShaderMaterial.new()
	material.shader = shader
	labels.material = material
	var layer: Variant = view.get("_labels_layer")
	if layer is Control:
		(layer as Control).add_child(labels)
		(layer as Control).move_child(labels, 0)
	labels.visible = false


func set_enabled(on: bool) -> void:
	if on == enabled:
		return
	enabled = on
	labels.visible = on
	if not on:
		_clear_sprites()
		_queue.clear()
		_wanted.clear()
		_wanted_labels.clear()
		_label_keys_shown.clear()
		_generation += 1
	else:
		_load_sprite()
		update_view()


func busy() -> bool:
	return enabled and (_active > 0 or not _queue.is_empty())


func keep_labels_under() -> void:
	if labels and labels.get_parent() and labels.get_index() != 0:
		labels.get_parent().move_child(labels, 0)


func rebuild() -> void:
	_clear_sprites()
	if enabled:
		update_view()


func _clear_sprites() -> void:
	for key in _shown.keys():
		for sprite in _shown[key]:
			if is_instance_valid(sprite):
				(sprite as Node).queue_free()
	_shown.clear()


func _view_rect() -> Rect2:
	var globe: Variant = extras.get("globe")
	if globe is GlobeView and (globe as GlobeView).active:
		var flat: Dictionary = (globe as GlobeView).get("_flat")
		if flat.has("rect"):
			return flat["rect"]
	var size := map_view.get_viewport_rect().size
	var zoom := map_view.camera.zoom.x
	return Rect2(map_view.camera.position - size * 0.5 / zoom, size / zoom)


func _keys_for(tz: int, rect: Rect2) -> Array[String]:
	var count := 1 << tz
	var span := MapView.WORLD_WIDTH / count
	var x0 := floori(rect.position.x / span)
	var x1 := floori(rect.end.x / span)
	var y0 := clampi(floori(rect.position.y / span), 0, count - 1)
	var y1 := clampi(floori(rect.end.y / span), 0, count - 1)
	if x1 - x0 + 1 > count:
		x0 = 0
		x1 = count - 1
	var keys: Array[String] = []
	for y in range(y0, y1 + 1):
		for x in range(x0, x1 + 1):
			var key := "%d/%d/%d" % [tz, posmod(x, count), y]
			if not keys.has(key):
				keys.append(key)
	return keys


func update_view() -> void:
	if not enabled or map_view == null:
		return
	var level := map_view.zoom_level()
	var rect := _view_rect()
	_wanted = _keys_for(clampi(roundi(level), 0, MAX_TILE_ZOOM), rect)
	_wanted_labels = _keys_for(clampi(floori(level), 0, MAX_TILE_ZOOM), rect)
	for key in _wanted:
		_want(_tiles, key, false)
	for key in _wanted_labels:
		if _wanted.has(key) or str((_tiles.get(key, {}) as Dictionary).get("state", "")) == "ready":
			continue
		_want(_label_sets, key, true)
	_pump()
	_show()
	labels.queue_redraw()


func _want(store: Dictionary, key: String, labels_only: bool) -> void:
	var tile: Dictionary = store.get(key, {})
	var state := str(tile.get("state", ""))
	if state.is_empty() or (state == "failed" and Time.get_ticks_msec() - int(tile.get("at", 0)) > RETRY_MS):
		store[key] = {"state": "queued"}
		_queue.append([key, labels_only])


func _pump() -> void:
	while _active < MAX_REQUESTS and not _queue.is_empty():
		var entry: Array = _queue.pop_front()
		var key: String = entry[0]
		var labels_only: bool = entry[1]
		var store := _label_sets if labels_only else _tiles
		if not (_wanted_labels.has(key) if labels_only else _wanted.has(key)):
			store.erase(key)
			continue
		_active += 1
		_fetch(key, labels_only, _generation)


func _fetch(key: String, labels_only: bool, generation: int) -> void:
	var parts := key.split("/")
	var engine: EngineLink = extras.get("engine")
	var reply: Dictionary = await engine.request("mapextras.natgeoTile", {"z": int(parts[0]), "x": int(parts[1]), "y": int(parts[2]), "labelsOnly": labels_only})
	_active -= 1
	if generation != _generation:
		_pump()
		return
	var store := _label_sets if labels_only else _tiles
	if not bool(reply.get("ok", false)) or not (reply.get("result") is Dictionary):
		store[key] = {"state": "failed", "at": Time.get_ticks_msec()}
		_pump()
		return
	var result: Dictionary = reply["result"]
	var record := {"state": "ready", "labels": _prepare_labels(result.get("labels", []))}
	if not labels_only:
		record["fills"] = _texture(str(result.get("fills", "")))
		record["lines"] = _texture(str(result.get("lines", "")))
	store[key] = record
	_pump()
	_show()
	labels.queue_redraw()


func _texture(data: String) -> Texture2D:
	if data.is_empty():
		return null
	var image := Image.new()
	if image.load_png_from_buffer(Marshalls.base64_to_raw(data)) != OK:
		return null
	return ImageTexture.create_from_image(image)


func _prepare_labels(raw: Variant) -> Array:
	var out: Array = []
	if not (raw is Array):
		return out
	for item in raw:
		if not (item is Dictionary):
			continue
		var label: Dictionary = item
		var text := str(label.get("text", ""))
		match str(label.get("transform", "none")):
			"uppercase":
				text = text.to_upper()
			"lowercase":
				text = text.to_lower()
		label["shown_text"] = text
		if label.has("lines"):
			var tile: Array = label.get("tile", [0, 0, 0])
			var span := MapView.WORLD_WIDTH / float(1 << int(tile[0]))
			label["origin"] = Vector2(int(tile[1]) * span, int(tile[2]) * span)
			label["px_world"] = span / TILE_PX
			var paths: Array[PackedVector2Array] = []
			for flat in label["lines"]:
				var path := PackedVector2Array()
				var values: Array = flat
				for index in range(0, values.size() - 1, 2):
					path.append(Vector2(float(values[index]), float(values[index + 1])))
				if path.size() > 1:
					paths.append(path)
			label["paths"] = paths
		else:
			label["world"] = GlobeView.world_of_lonlat(float(label.get("lon", 0.0)), float(label.get("lat", 0.0)))
		_request_glyphs(str(label.get("font", "")), text)
		out.append(label)
	return out


func _load_sprite() -> void:
	if not _sprite_state.is_empty():
		return
	_sprite_state = "loading"
	var engine: EngineLink = extras.get("engine")
	var reply: Dictionary = await engine.request("mapextras.natgeoSprite")
	if not bool(reply.get("ok", false)) or not (reply.get("result") is Dictionary):
		_sprite_state = ""
		return
	var result: Dictionary = reply["result"]
	_sprite_json = result.get("json", {}) if result.get("json") is Dictionary else {}
	_sprite_texture = _texture(str(result.get("png", "")))
	_sprite_state = "ready"
	labels.queue_redraw()


func _request_glyphs(font: String, text: String) -> void:
	if font.is_empty():
		return
	for index in range(text.length()):
		var start := (text.unicode_at(index) >> 8) << 8
		var key := "%s|%d" % [font, start]
		if _ranges.has(key):
			continue
		_ranges[key] = "loading"
		_load_range(font, start, key)


func _glyphs_ready(font: String, text: String) -> bool:
	for index in range(text.length()):
		var key := "%s|%d" % [font, (text.unicode_at(index) >> 8) << 8]
		if str(_ranges.get(key, "")) == "loading" or not _ranges.has(key):
			return false
	return true


func _load_range(font: String, start: int, key: String) -> void:
	var engine: EngineLink = extras.get("engine")
	var reply: Dictionary = await engine.request("mapextras.natgeoGlyphs", {"font": font, "start": start})
	if not bool(reply.get("ok", false)) or not (reply.get("result") is Dictionary):
		_ranges[key] = "failed"
		labels.queue_redraw()
		return
	var table: Dictionary = _glyphs.get(font, {})
	var list: Variant = (reply["result"] as Dictionary).get("glyphs", [])
	if list is Array:
		for item in list:
			if item is Dictionary:
				_add_glyph(table, item as Dictionary)
	_glyphs[font] = table
	_atlas_texture.update(_atlas)
	_ranges[key] = "ready"
	labels.queue_redraw()


func _add_glyph(table: Dictionary, glyph: Dictionary) -> void:
	var width := int(glyph.get("width", 0))
	var height := int(glyph.get("height", 0))
	var entry := {
		"w": width,
		"h": height,
		"left": float(glyph.get("left", 0)),
		"top": float(glyph.get("top", 0)),
		"adv": float(glyph.get("advance", 0)),
	}
	var bytes := Marshalls.base64_to_raw(str(glyph.get("bitmap", "")))
	var bitmap_size := Vector2i(width + 6, height + 6)
	if width > 0 and height > 0 and bytes.size() == bitmap_size.x * bitmap_size.y:
		var packed := bitmap_size + Vector2i(2, 2)
		if _shelf.x + packed.x > ATLAS_SIZE:
			_shelf = Vector3i(0, _shelf.y + _shelf.z, 0)
		if _shelf.y + packed.y <= ATLAS_SIZE:
			var image := Image.create_from_data(bitmap_size.x, bitmap_size.y, false, Image.FORMAT_L8, bytes)
			_atlas.blit_rect(image, Rect2i(Vector2i.ZERO, bitmap_size), Vector2i(_shelf.x + 1, _shelf.y + 1))
			entry["rect"] = Rect2(_shelf.x, _shelf.y, packed.x, packed.y)
			_shelf.x += packed.x
			_shelf.z = maxi(_shelf.z, packed.y)
	table[int(glyph.get("id", 0))] = entry


func _show() -> void:
	var fills_slots: Array[Node2D] = extras.call("slots", "natgeo_fills")
	var lines_slots: Array[Node2D] = extras.call("slots", "natgeo_lines")
	var ready := true
	for key in _wanted:
		if str((_tiles.get(key, {}) as Dictionary).get("state", "")) != "ready":
			ready = false
	var keep := {}
	for key in _wanted:
		keep[key] = true
	if not ready:
		for key in _shown.keys():
			keep[key] = true
	for key in _shown.keys():
		if not keep.has(key):
			for sprite in _shown[key]:
				if is_instance_valid(sprite):
					(sprite as Node).queue_free()
			_shown.erase(key)
	for key in _wanted:
		if _shown.has(key):
			continue
		var tile: Dictionary = _tiles.get(key, {})
		if str(tile.get("state", "")) != "ready":
			continue
		var parts := key.split("/")
		var tz := int(parts[0])
		var span := MapView.WORLD_WIDTH / float(1 << tz)
		var origin := Vector2(int(parts[1]) * span, int(parts[2]) * span)
		var made: Array = []
		for pair in [["fills", fills_slots], ["lines", lines_slots]]:
			var texture: Texture2D = tile.get(pair[0])
			if texture == null:
				continue
			for slot in pair[1]:
				var sprite := Sprite2D.new()
				sprite.texture = texture
				sprite.centered = false
				sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
				sprite.position = origin
				sprite.scale = Vector2.ONE * (span / float(texture.get_width()))
				(slot as Node2D).add_child(sprite)
				made.append(sprite)
		_shown[key] = made
	var labels_ready := true
	for key in _wanted_labels:
		if _label_record(key).is_empty():
			labels_ready = false
	if labels_ready:
		_label_keys_shown = _wanted_labels.duplicate()


func _label_record(key: String) -> Dictionary:
	var full: Dictionary = _tiles.get(key, {})
	if str(full.get("state", "")) == "ready":
		return full
	var only: Dictionary = _label_sets.get(key, {})
	if str(only.get("state", "")) == "ready":
		return only
	return {}


func visible_labels() -> Array:
	var out: Array = []
	var keys: Array[String] = _wanted_labels.duplicate()
	for key in _label_keys_shown:
		if not keys.has(key):
			var all_ready := true
			for wanted in _wanted_labels:
				if _label_record(wanted).is_empty():
					all_ready = false
			if not all_ready:
				keys.append(key)
	for key in keys:
		var record := _label_record(key)
		if not record.is_empty():
			out.append_array(record.get("labels", []))
	return out


static func evaluate_stops(function: Dictionary, zoom: float, fallback: float) -> float:
	var stops: Array = function.get("stops", [])
	if stops.is_empty():
		return fallback
	var base := float(function.get("base", 1.0))
	var first: Array = stops[0]
	var last: Array = stops[stops.size() - 1]
	if str(function.get("type", "")) == "interval":
		var value := float(first[1])
		for stop in stops:
			if zoom >= float(stop[0]):
				value = float(stop[1])
		return value
	if zoom <= float(first[0]):
		return float(first[1])
	if zoom >= float(last[0]):
		return float(last[1])
	for index in range(stops.size() - 1):
		var a: Array = stops[index]
		var b: Array = stops[index + 1]
		if zoom >= float(a[0]) and zoom <= float(b[0]):
			var span := float(b[0]) - float(a[0])
			var progress := zoom - float(a[0])
			var t := 0.0
			if span > 0.0:
				t = progress / span if is_equal_approx(base, 1.0) else (pow(base, progress) - 1.0) / (pow(base, span) - 1.0)
			return lerpf(float(a[1]), float(b[1]), t)
	return float(last[1])


static func size_at(owner: Dictionary, zoom: float) -> float:
	var function: Variant = owner.get("sizeFn")
	if function is Dictionary:
		return evaluate_stops(function, zoom, float(owner.get("size", 16.0)))
	return float(owner.get("size", 16.0))


static func anchor_alignment(anchor: String) -> Vector2:
	var align := Vector2(0.5, 0.5)
	if anchor in ["right", "top-right", "bottom-right"]:
		align.x = 1.0
	elif anchor in ["left", "top-left", "bottom-left"]:
		align.x = 0.0
	if anchor in ["bottom", "bottom-right", "bottom-left"]:
		align.y = 1.0
	elif anchor in ["top", "top-right", "top-left"]:
		align.y = 0.0
	return align


static func _ideographic(code: int) -> bool:
	return (code >= 0x2E80 and code <= 0x2FDF) or (code >= 0x3000 and code <= 0x30FF) or (code >= 0x3190 and code <= 0x9FFF) or (code >= 0xF900 and code <= 0xFAFF) or (code >= 0xFF00 and code <= 0xFFEF)


static func _advance(table: Dictionary, code: int, spacing: float) -> float:
	var glyph: Variant = table.get(code)
	if glyph is Dictionary:
		return float((glyph as Dictionary)["adv"]) + spacing
	return 0.0


static func _badness(width: float, target: float, penalty: float, last: bool) -> float:
	var raggedness := pow(width - target, 2.0)
	if last:
		return raggedness / 2.0 if width < target else raggedness * 2.0
	return raggedness + absf(penalty) * penalty


static func _evaluate_break(index: int, x: float, target: float, potential: Array, penalty: float, last: bool) -> Dictionary:
	var best: Variant = null
	var best_badness := _badness(x, target, penalty, last)
	for candidate in potential:
		var prior: Dictionary = candidate
		var badness := _badness(x - float(prior["x"]), target, penalty, last) + float(prior["badness"])
		if badness <= best_badness:
			best = prior
			best_badness = badness
	return {"index": index, "x": x, "prior": best, "badness": best_badness}


static func line_breaks(codes: PackedInt32Array, table: Dictionary, spacing: float, max_width: float) -> Array[int]:
	var total := 0.0
	for code in codes:
		total += _advance(table, code, spacing)
	var line_count := 1
	if max_width > 0.0 and is_finite(max_width):
		line_count = maxi(1, ceili(total / max_width))
	var target := total / line_count
	var has_zero_width := codes.has(0x200b)
	var potential: Array = []
	var current_x := 0.0
	for index in range(codes.size()):
		var code := codes[index]
		if not WHITESPACE.has(code):
			current_x += _advance(table, code, spacing)
		if index < codes.size() - 1:
			var next_code := codes[index + 1]
			var ideographic := _ideographic(code)
			if BREAKABLE.has(code) or ideographic or (index < codes.size() - 2 and next_code == 0x28):
				var penalty := 0.0
				if code == 0x0a:
					penalty -= 10000.0
				if ideographic and has_zero_width:
					penalty += 150.0
				if code == 0x28 or code == 0xff08:
					penalty += 50.0
				if next_code == 0x29 or next_code == 0xff09:
					penalty += 50.0
				potential.append(_evaluate_break(index + 1, current_x, target, potential, penalty, false))
	var chain: Variant = _evaluate_break(codes.size(), current_x, target, potential, 0.0, true)
	var out: Array[int] = []
	while chain is Dictionary:
		out.push_front(int((chain as Dictionary)["index"]))
		chain = (chain as Dictionary)["prior"]
	return out


static func shape(label: Dictionary, table: Dictionary) -> Dictionary:
	var text := str(label.get("shown_text", ""))
	var codes := PackedInt32Array()
	for index in range(text.length()):
		codes.append(text.unicode_at(index))
	var spacing := float(label.get("spacing", 0.0)) * ONE_EM
	var placement := str(label.get("placement", "point"))
	var along := bool(label.get("alongLine", false))
	var max_width := float(label.get("maxWidth", 10.0)) * ONE_EM if placement == "point" else INF
	var line_height := float(label.get("lineHeight", 1.2)) * ONE_EM
	var anchor := str(label.get("anchor", "center"))
	var justify := "center" if along else str(label.get("justify", "center"))
	if justify == "auto":
		justify = "right" if anchor.ends_with("right") else ("left" if anchor.ends_with("left") else "center")
	var offset_value: Variant = label.get("offset", [0, 0])
	var offset := Vector2.ZERO
	if offset_value is Array and (offset_value as Array).size() >= 2:
		offset = Vector2(float(offset_value[0]), float(offset_value[1])) * ONE_EM
	var lines: Array[PackedInt32Array] = []
	var start := 0
	for stop in line_breaks(codes, table, spacing, max_width):
		lines.append(codes.slice(start, stop))
		start = stop
	if start < codes.size():
		lines.append(codes.slice(start))
	var justify_value := 1.0 if justify == "right" else (0.0 if justify == "left" else 0.5)
	var glyphs: Array = []
	var y := 0.0
	var max_line_length := 0.0
	for raw_line in lines:
		var line := raw_line
		var first := 0
		while first < line.size() and WHITESPACE.has(line[first]):
			first += 1
		var last := line.size() - 1
		while last >= first and WHITESPACE.has(line[last]):
			last -= 1
		line = line.slice(first, last + 1) if last >= first else PackedInt32Array()
		if line.is_empty():
			y += line_height
			continue
		var x := 0.0
		var placed: Array = []
		for code in line:
			var glyph: Variant = table.get(code)
			if not (glyph is Dictionary):
				continue
			placed.append({"code": code, "x": x, "y": y + SHAPING_DEFAULT_OFFSET, "g": glyph})
			x += float((glyph as Dictionary)["adv"]) + spacing
		if not placed.is_empty():
			max_line_length = maxf(max_line_length, x - spacing)
			var tail: Dictionary = placed[placed.size() - 1]
			var indent := (float(tail["x"]) + float((tail["g"] as Dictionary)["adv"])) * justify_value
			for item in placed:
				item["x"] = float(item["x"]) - indent
			glyphs.append_array(placed)
		y += line_height
	var align := anchor_alignment(anchor)
	var shift_x := (justify_value - align.x) * max_line_length
	var shift_y := -align.y * lines.size() * line_height + 0.5 * line_height
	for item in glyphs:
		item["x"] = float(item["x"]) + shift_x
		item["y"] = float(item["y"]) + shift_y
	var top := offset.y - align.y * y
	var left := offset.x - align.x * max_line_length
	return {"glyphs": glyphs, "box": Rect2(left, top, max_line_length, y), "offset": offset}


static func _max_angle_ok(path: PackedVector2Array, anchor: Vector2, segment: int, label_length: float, window: float, max_angle: float) -> bool:
	if label_length <= 0.0:
		return true
	var point := anchor
	var index := segment + 1
	var anchor_distance := 0.0
	while anchor_distance > -label_length / 2.0:
		index -= 1
		if index < 0:
			return false
		anchor_distance -= path[index].distance_to(point)
		point = path[index]
	anchor_distance += path[index].distance_to(path[index + 1])
	index += 1
	var corners: Array = []
	var delta_sum := 0.0
	while anchor_distance < label_length / 2.0:
		if index + 1 >= path.size():
			return false
		var previous := path[index - 1]
		var current := path[index]
		var next := path[index + 1]
		var delta := (current - previous).angle() - (next - current).angle()
		delta = absf(fposmod(delta + 3.0 * PI, TAU) - PI)
		corners.append([anchor_distance, delta])
		delta_sum += delta
		while anchor_distance - float(corners[0][0]) > window:
			delta_sum -= float(corners[0][1])
			corners.pop_front()
		if delta_sum > max_angle:
			return false
		index += 1
		anchor_distance += current.distance_to(next)
	return true


static func _resample(path: PackedVector2Array, offset: float, spacing: float, window: float, max_angle: float, label_length: float, continued: bool, middle: bool) -> Array:
	var half := label_length / 2.0
	var line_length := 0.0
	for index in range(path.size() - 1):
		line_length += path[index].distance_to(path[index + 1])
	var distance := 0.0
	var marked := offset - spacing
	var anchors: Array = []
	for index in range(path.size() - 1):
		var a := path[index]
		var b := path[index + 1]
		var segment := a.distance_to(b)
		while marked + spacing < distance + segment:
			marked += spacing
			var t := (marked - distance) / segment
			var point := a.lerp(b, t)
			if point.x >= 0.0 and point.x < TILE_PX and point.y >= 0.0 and point.y < TILE_PX and marked - half >= 0.0 and marked + half <= line_length:
				if window <= 0.0 or _max_angle_ok(path, point, index, label_length, window, max_angle):
					anchors.append({"point": point, "segment": index})
		distance += segment
	if not middle and anchors.is_empty() and not continued:
		anchors = _resample(path, distance / 2.0, spacing, window, max_angle, label_length, continued, true)
	return anchors


static func line_anchors(path: PackedVector2Array, spacing: float, max_angle: float, text_length: float, icon_length: float, layout_size: float, has_text: bool) -> Array:
	var box_scale := layout_size / ONE_EM
	var window := 3.0 / 5.0 * ONE_EM * box_scale if has_text else 0.0
	var shaped_length := maxf(text_length, icon_length)
	var label_length := shaped_length * box_scale
	var first := path[0]
	var continued := first.x == 0.0 or first.x == TILE_PX or first.y == 0.0 or first.y == TILE_PX
	if spacing - label_length < spacing / 4.0:
		spacing = label_length + spacing / 4.0
	var extra := ONE_EM * 2.0
	var offset := fmod((shaped_length / 2.0 + extra) * box_scale, spacing) if not continued else fmod(spacing / 2.0, spacing)
	return _resample(path, offset, spacing, window, max_angle, label_length, continued, false)


class NatGeoLabels extends Control:
	var reference: NatGeoReference
	var map_view: MapView
	var placed_count := 0
	var along_count := 0
	var icon_count := 0
	var glyph_count := 0
	var _runs: Array = []
	var _taken: Array[Rect2] = []
	var _grid := {}

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	func _draw() -> void:
		placed_count = 0
		along_count = 0
		icon_count = 0
		glyph_count = 0
		_runs = []
		if reference == null or not reference.enabled or map_view == null:
			return
		var level := map_view.zoom_level()
		var view := get_viewport_rect().size
		var items := reference.visible_labels()
		items.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return int(a.get("layer", 0)) > int(b.get("layer", 0)))
		_taken = []
		_grid = {}
		for list_name in ["war_label_rects", "city_label_rects", "room_label_rects", "war_marker_rects"]:
			var rects: Variant = map_view.get(list_name)
			if rects is Array:
				for rect: Variant in rects:
					if rect is Rect2:
						_take(rect as Rect2)
		var by_layer := {}
		var seen := {}
		var globe: Variant = reference.extras.get("globe")
		var projector: GlobeView = globe if globe is GlobeView and (globe as GlobeView).active else null
		var bearing := deg_to_rad(map_view.bearing)
		for label in items:
			if level < float(label.get("minzoom", 0.0)) or level >= float(label.get("maxzoom", 24.0)):
				continue
			var text := str(label.get("shown_text", ""))
			var font := str(label.get("font", ""))
			var table: Dictionary = reference._glyphs.get(font, {})
			var has_text := not text.is_empty()
			if has_text and not label.has("shape"):
				if not reference._glyphs_ready(font, text):
					continue
				label["shape"] = NatGeoReference.shape(label, table)
			var icon_entry: Dictionary = {}
			var icon: Variant = label.get("icon")
			if icon is Dictionary and reference._sprite_state == "ready":
				var found: Variant = reference._sprite_json.get(str((icon as Dictionary).get("name", "")))
				if found is Dictionary:
					icon_entry = found
			if label.has("paths"):
				_place_line_label(label, table, icon_entry, level, view, projector, bearing, by_layer)
			else:
				var screen := map_view.world_to_screen(label["world"])
				if screen.x < -200.0 or screen.y < -100.0 or screen.x > view.x + 200.0 or screen.y > view.y + 100.0:
					continue
				var identity := "%s|%d|%d" % [text, roundi(screen.x / 24.0), roundi(screen.y / 24.0)]
				if seen.has(identity):
					continue
				seen[identity] = true
				var depth := projector.depth_at(label["world"]) if projector else 1.0
				_place_point(label, table, icon_entry, screen, NAN, level, depth, bearing, by_layer)
		_emit(by_layer)

	func _perspective(depth: float, pitched: bool) -> float:
		if pitched:
			return clampf(0.5 + 0.5 * depth, 0.0, 4.0) / depth
		return clampf(0.5 + 0.5 / depth, 0.0, 4.0)

	func _icon_box(icon: Dictionary, entry: Dictionary, size: float) -> Rect2:
		var ratio := float(entry.get("pixelRatio", 1.0))
		var shown := Vector2(float(entry.get("width", 0)), float(entry.get("height", 0))) / ratio
		var align := NatGeoReference.anchor_alignment(str(icon.get("anchor", "center")))
		var offset_value: Variant = icon.get("offset", [0, 0])
		var offset := Vector2.ZERO
		if offset_value is Array and (offset_value as Array).size() >= 2:
			offset = Vector2(float(offset_value[0]), float(offset_value[1]))
		var corner := offset - shown * align
		return Rect2(corner * size, shown * size)

	func _cells(box: Rect2) -> Array[Vector2i]:
		var out: Array[Vector2i] = []
		var low := Vector2i(floori(box.position.x / 64.0), floori(box.position.y / 64.0))
		var high := Vector2i(floori(box.end.x / 64.0), floori(box.end.y / 64.0))
		if (high.x - low.x + 1) * (high.y - low.y + 1) > 400:
			out.append(Vector2i(1 << 20, 1 << 20))
			return out
		for y in range(low.y, high.y + 1):
			for x in range(low.x, high.x + 1):
				out.append(Vector2i(x, y))
		return out

	func _take(box: Rect2) -> void:
		_taken.append(box)
		for cell in _cells(box):
			if not _grid.has(cell):
				_grid[cell] = [] as Array[Rect2]
			(_grid[cell] as Array[Rect2]).append(box)

	func _fits(boxes: Array[Rect2]) -> bool:
		var huge: Variant = _grid.get(Vector2i(1 << 20, 1 << 20))
		for box in boxes:
			if huge is Array:
				for other: Rect2 in huge:
					if other.intersects(box):
						return false
			for cell in _cells(box):
				var bucket: Variant = _grid.get(cell)
				if bucket is Array:
					for other: Rect2 in bucket:
						if other.intersects(box):
							return false
		return true

	func _place_point(label: Dictionary, table: Dictionary, icon_entry: Dictionary, screen: Vector2, line_angle: float, level: float, depth: float, bearing: float, by_layer: Dictionary) -> void:
		var has_text := label.has("shape") and not ((label["shape"] as Dictionary)["glyphs"] as Array).is_empty()
		var icon: Dictionary = label.get("icon") if label.get("icon") is Dictionary else {}
		var has_icon := not icon_entry.is_empty()
		if not has_text and not has_icon:
			return
		var ratio := _perspective(depth, false)
		var text_size := NatGeoReference.size_at(label, level) * ratio
		var layout_scale := float(label.get("layoutSize", 16.0)) / ONE_EM * ratio
		var text_boxes: Array[Rect2] = []
		var text_rotation := deg_to_rad(float(label.get("rotate", 0.0))) - (bearing if bool(label.get("alongLine", false)) else 0.0)
		if has_text:
			var box: Rect2 = (label["shape"] as Dictionary)["box"]
			var scaled := Rect2(screen + box.position * layout_scale, box.size * layout_scale).grow(float(label.get("padding", 2.0)) * ratio)
			text_boxes.append(_rotated_bounds(scaled, screen, text_rotation))
		var icon_boxes: Array[Rect2] = []
		var icon_size := 1.0
		var icon_rotation := 0.0
		if has_icon:
			icon_size = NatGeoReference.size_at(icon, level) * ratio
			icon_rotation = deg_to_rad(float(icon.get("rotate", 0.0)))
			if bool(icon.get("alongLine", false)):
				icon_rotation += line_angle if is_finite(line_angle) else -bearing
			var layout_box := _icon_box(icon, icon_entry, float(icon.get("layoutSize", 1.0)) * ratio)
			icon_boxes.append(_rotated_bounds(Rect2(screen + layout_box.position, layout_box.size).grow(float(icon.get("padding", 2.0)) * ratio), screen, icon_rotation))
		var place_text := has_text and (bool(label.get("overlap", false)) or _fits(text_boxes))
		var place_icon := has_icon and (bool(icon.get("overlap", false)) or _fits(icon_boxes))
		var icon_without_text := bool(label.get("optional", false)) or not has_text
		var text_without_icon := bool(icon.get("optional", false)) or not has_icon
		if not icon_without_text and not text_without_icon:
			place_icon = place_icon and place_text
			place_text = place_icon
		elif not text_without_icon:
			place_text = place_icon and place_text
		elif not icon_without_text:
			place_icon = place_icon and place_text
		if place_text and not bool(label.get("ignore", false)):
			for box in text_boxes:
				_take(box)
		if place_icon and not bool(icon.get("ignore", false)):
			for box in icon_boxes:
				_take(box)
		var layer := int(label.get("layer", 0))
		var bucket: Dictionary = by_layer.get(layer, {"icons": [], "halos": [], "fills": []})
		by_layer[layer] = bucket
		if place_icon:
			var drawn := _icon_box(icon, icon_entry, icon_size)
			var uv := Rect2(float(icon_entry.get("x", 0)), float(icon_entry.get("y", 0)), float(icon_entry.get("width", 0)), float(icon_entry.get("height", 0)))
			var tint := Color(1, 1, 1, clampf(float(icon.get("opacity", 1.0)), 0.0, 1.0))
			(bucket["icons"] as Array).append([_quad(screen, drawn, icon_rotation), uv, tint, Vector4.ZERO])
			placed_count += 1
			icon_count += 1
		if place_text:
			var shape_data: Dictionary = label["shape"]
			var offset: Vector2 = shape_data["offset"]
			var font_scale := text_size / ONE_EM
			for item in shape_data["glyphs"]:
				var glyph: Dictionary = item["g"]
				if not glyph.has("rect"):
					continue
				var rect: Rect2 = glyph["rect"]
				var half := float(glyph["adv"]) / 2.0
				var corner := Vector2(float(item["x"]) + half + offset.x + float(glyph["left"]) - RECT_BUFFER - half, float(item["y"]) + offset.y - float(glyph["top"]) - RECT_BUFFER)
				var local := Rect2(corner * font_scale, rect.size * font_scale)
				_add_glyph(bucket, label, _quad(screen, local, text_rotation), rect, font_scale)
			placed_count += 1

	func _add_glyph(bucket: Dictionary, label: Dictionary, quad: PackedVector2Array, rect: Rect2, font_scale: float) -> void:
		var opacity := clampf(float(label.get("opacity", 1.0)), 0.0, 1.0)
		var halo := _color(label.get("halo"), Color(0, 0, 0, 0))
		halo.a *= opacity
		var colour := _color(label.get("color"), Color(0, 0, 0))
		colour.a *= opacity
		var halo_width := float(label.get("haloWidth", 0.0))
		if halo.a > 0.0 and halo_width > 0.0:
			(bucket["halos"] as Array).append([quad, rect, halo, Vector4(2.0, font_scale, halo_width, float(label.get("haloBlur", 0.0)))])
		(bucket["fills"] as Array).append([quad, rect, colour, Vector4(1.0, font_scale, 0.0, 0.0)])
		glyph_count += 1

	func _rotated_bounds(box: Rect2, pivot: Vector2, angle: float) -> Rect2:
		if absf(angle) < 0.0001:
			return box
		var out := Rect2(pivot + (box.position - pivot).rotated(angle), Vector2.ZERO)
		for corner in [Vector2(box.end.x, box.position.y), box.end, Vector2(box.position.x, box.end.y)]:
			out = out.expand(pivot + ((corner as Vector2) - pivot).rotated(angle))
		return out

	func _quad(origin: Vector2, local: Rect2, angle: float) -> PackedVector2Array:
		var corners := PackedVector2Array([local.position, Vector2(local.end.x, local.position.y), local.end, Vector2(local.position.x, local.end.y)])
		var out := PackedVector2Array()
		for corner in corners:
			out.append(origin + (corner.rotated(angle) if absf(angle) > 0.0001 else corner))
		return out

	func _place_line_label(label: Dictionary, table: Dictionary, icon_entry: Dictionary, level: float, view: Vector2, projector: GlobeView, bearing: float, by_layer: Dictionary) -> void:
		var has_text := label.has("shape") and not ((label["shape"] as Dictionary)["glyphs"] as Array).is_empty()
		var icon: Dictionary = label.get("icon") if label.get("icon") is Dictionary else {}
		if not has_text and icon_entry.is_empty():
			return
		if not label.has("anchors"):
			var anchors: Array = []
			var text_length := ((label["shape"] as Dictionary)["box"] as Rect2).size.x if has_text else 0.0
			var icon_length := 0.0
			if not icon_entry.is_empty():
				icon_length = float(icon_entry.get("width", 0)) / float(icon_entry.get("pixelRatio", 1.0))
			var paths: Array[PackedVector2Array] = label["paths"]
			for path_index in range(paths.size()):
				var path := paths[path_index]
				if str(label.get("placement", "line")) == "line-center":
					var center := _center_anchor(path)
					if not center.is_empty():
						center["path"] = path_index
						anchors.append(center)
					continue
				for found in NatGeoReference.line_anchors(path, float(label.get("symbolSpacing", 250.0)), deg_to_rad(float(label.get("maxAngle", 45.0))), text_length, icon_length, float(label.get("layoutSize", 16.0)), has_text):
					found["path"] = path_index
					anchors.append(found)
			label["anchors"] = anchors
		var origin: Vector2 = label["origin"]
		var px_world: float = label["px_world"]
		var paths_all: Array[PackedVector2Array] = label["paths"]
		var projected := {}
		for anchor in label["anchors"]:
			var path_index := int(anchor["path"])
			var world: Vector2 = origin + (anchor["point"] as Vector2) * px_world
			var screen := map_view.world_to_screen(world)
			if screen.x < -300.0 or screen.y < -300.0 or screen.x > view.x + 300.0 or screen.y > view.y + 300.0:
				continue
			var depth := projector.depth_at(world) if projector else 1.0
			if not projected.has(path_index):
				var points := PackedVector2Array()
				for point in paths_all[path_index]:
					points.append(map_view.world_to_screen(origin + point * px_world))
				projected[path_index] = points
			var points_now: PackedVector2Array = projected[path_index]
			if not bool(label.get("alongLine", false)) or not has_text:
				var segment := int(anchor["segment"])
				var angle := NAN
				if segment + 1 < points_now.size():
					var step := points_now[segment + 1] - points_now[segment]
					angle = atan2(step.y, step.x)
				_place_point(label, table, icon_entry, screen, angle, level, depth, bearing, by_layer)
				continue
			_place_along(label, points_now, screen, int(anchor["segment"]), level, depth, by_layer)

	func _center_anchor(path: PackedVector2Array) -> Dictionary:
		var total := 0.0
		for index in range(path.size() - 1):
			total += path[index].distance_to(path[index + 1])
		var walked := 0.0
		for index in range(path.size() - 1):
			var step := path[index].distance_to(path[index + 1])
			if walked + step > total / 2.0:
				return {"point": path[index].lerp(path[index + 1], (total / 2.0 - walked) / step), "segment": index}
			walked += step
		return {}

	func _along(points: PackedVector2Array, anchor: Vector2, segment: int, offset_x: float, line_offset_x: float, line_offset_y: float, flip: bool) -> Array:
		var combined := offset_x - line_offset_x if flip else offset_x + line_offset_x
		var direction := 1 if combined > 0.0 else -1
		var angle := 0.0
		if flip:
			direction *= -1
			angle = PI
		if direction < 0:
			angle += PI
		var index := segment if direction > 0 else segment + 1
		var current := anchor
		var previous := anchor
		var distance := 0.0
		var segment_distance := 0.0
		var target := absf(combined)
		while distance + segment_distance <= target:
			index += direction
			if index < 0 or index >= points.size():
				return []
			distance += segment_distance
			previous = current
			current = points[index]
			if current.x < -50000.0:
				return []
			segment_distance = previous.distance_to(current)
		var t := (target - distance) / segment_distance if segment_distance > 0.0 else 0.0
		var step := current - previous
		var point := previous + step * t
		if line_offset_y != 0.0 and step.length() > 0.0:
			var unit := step.normalized()
			point += Vector2(-unit.y, unit.x) * (line_offset_y * direction)
		return [point, angle + atan2(step.y, step.x)]

	func _place_along(label: Dictionary, points: PackedVector2Array, anchor: Vector2, segment: int, level: float, depth: float, by_layer: Dictionary) -> void:
		var shape_data: Dictionary = label["shape"]
		var glyphs: Array = shape_data["glyphs"]
		var ratio := _perspective(depth, true)
		var font_scale := NatGeoReference.size_at(label, level) / ONE_EM * ratio
		var layout_scale := float(label.get("layoutSize", 16.0)) / ONE_EM * ratio
		var offset_value: Variant = label.get("offset", [0, 0])
		var line_offset := Vector2.ZERO
		if offset_value is Array and (offset_value as Array).size() >= 2:
			line_offset = Vector2(float(offset_value[0]), float(offset_value[1])) * ONE_EM * font_scale
		var offsets: Array[float] = []
		for item in glyphs:
			offsets.append((float(item["x"]) + float((item["g"] as Dictionary)["adv"]) / 2.0) * font_scale)
		var flip := false
		var keep_upright := bool(label.get("keepUpright", true))
		if keep_upright:
			if glyphs.size() > 1:
				var first := _along(points, anchor, segment, offsets[0], line_offset.x, line_offset.y, false)
				var last := _along(points, anchor, segment, offsets[offsets.size() - 1], line_offset.x, line_offset.y, false)
				if first.is_empty() or last.is_empty():
					return
				flip = (first[0] as Vector2).x > (last[0] as Vector2).x
			elif segment + 1 < points.size():
				flip = anchor.x > points[segment + 1].x
		var placements: Array = []
		for index in range(glyphs.size()):
			var placed := _along(points, anchor, segment, offsets[index], line_offset.x, line_offset.y, flip)
			if placed.is_empty():
				return
			placements.append(placed)
		var shape_box: Rect2 = shape_data["box"]
		var radius := shape_box.size.y / 2.0 * layout_scale + float(label.get("padding", 2.0)) * ratio
		var boxes: Array[Rect2] = []
		for placed in placements:
			boxes.append(Rect2((placed[0] as Vector2) - Vector2(radius, radius), Vector2(radius, radius) * 2.0))
		if not bool(label.get("overlap", false)) and not _fits(boxes):
			return
		if not bool(label.get("ignore", false)):
			for box in boxes:
				_take(box)
		var layer := int(label.get("layer", 0))
		var bucket: Dictionary = by_layer.get(layer, {"icons": [], "halos": [], "fills": []})
		by_layer[layer] = bucket
		for index in range(glyphs.size()):
			var item: Dictionary = glyphs[index]
			var glyph: Dictionary = item["g"]
			if not glyph.has("rect"):
				continue
			var rect: Rect2 = glyph["rect"]
			var half := float(glyph["adv"]) / 2.0
			var corner := Vector2(float(glyph["left"]) - RECT_BUFFER - half, float(item["y"]) - float(glyph["top"]) - RECT_BUFFER)
			var local := Rect2(corner * font_scale, rect.size * font_scale)
			var placed: Array = placements[index]
			_add_glyph(bucket, label, _quad(placed[0], local, float(placed[1])), rect, font_scale)
		placed_count += 1
		along_count += 1

	func _emit(by_layer: Dictionary) -> void:
		var keys := by_layer.keys()
		keys.sort()
		var atlas_size := Vector2(NatGeoReference.ATLAS_SIZE, NatGeoReference.ATLAS_SIZE)
		var sprite_size := Vector2.ONE
		if reference._sprite_texture:
			sprite_size = Vector2(reference._sprite_texture.get_size())
		for key in keys:
			var bucket: Dictionary = by_layer[key]
			if not (bucket["icons"] as Array).is_empty() and reference._sprite_texture:
				_draw_run(bucket["icons"], reference._sprite_texture, sprite_size)
			var text: Array = []
			text.append_array(bucket["halos"])
			text.append_array(bucket["fills"])
			if not text.is_empty():
				_draw_run(text, reference._atlas_texture, atlas_size)

	func _draw_run(quads: Array, texture: Texture2D, texture_size: Vector2) -> void:
		var vertices := PackedVector2Array()
		var uvs := PackedVector2Array()
		var colours := PackedColorArray()
		var custom := PackedFloat32Array()
		for entry in quads:
			var quad: PackedVector2Array = entry[0]
			var rect: Rect2 = entry[1]
			var colour: Color = entry[2]
			var data: Vector4 = entry[3]
			var uv0 := rect.position / texture_size
			var uv1 := rect.end / texture_size
			var corners_uv := [uv0, Vector2(uv1.x, uv0.y), uv1, Vector2(uv0.x, uv1.y)]
			for index in [0, 1, 2, 0, 2, 3]:
				vertices.append(quad[index])
				uvs.append(corners_uv[index])
				colours.append(colour)
				custom.append(data.x)
				custom.append(data.y)
				custom.append(data.z)
				custom.append(data.w)
		if vertices.is_empty():
			return
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = vertices
		arrays[Mesh.ARRAY_TEX_UV] = uvs
		arrays[Mesh.ARRAY_COLOR] = colours
		arrays[Mesh.ARRAY_CUSTOM0] = custom
		var mesh := ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays, [], {}, Mesh.ARRAY_CUSTOM_RGBA_FLOAT << Mesh.ARRAY_FORMAT_CUSTOM0_SHIFT)
		_runs.append(mesh)
		draw_mesh(mesh, texture)

	func _color(value: Variant, fallback: Color) -> Color:
		if value is Array and (value as Array).size() >= 3:
			var parts: Array = value
			return Color(float(parts[0]) / 255.0, float(parts[1]) / 255.0, float(parts[2]) / 255.0, float(parts[3]) if parts.size() > 3 else 1.0)
		return fallback
