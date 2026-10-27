class_name NatGeoReference
extends Node

const MAX_REQUESTS := 3
const MAX_TILE_ZOOM := 16
const RETRY_MS := 15000
const SERIF_FAMILIES := ["Playfair Display", "Merriweather", "Inknut Antiqua", "Libertinus Sans", "Timmana"]

var extras: Node
var map_view: MapView
var enabled := false
var labels: NatGeoLabels
var _tiles := {}
var _queue: Array[String] = []
var _active := 0
var _zoom := -1
var _wanted: Array[String] = []
var _shown := {}
var _generation := 0


func setup(owner_extras: Node, view: MapView) -> void:
	extras = owner_extras
	map_view = view
	labels = NatGeoLabels.new()
	labels.reference = self
	labels.map_view = view
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
		_zoom = -1
		_generation += 1
	else:
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


func update_view() -> void:
	if not enabled or map_view == null:
		return
	var tz := clampi(roundi(map_view.zoom_level()), 0, MAX_TILE_ZOOM)
	var count := 1 << tz
	var span := MapView.WORLD_WIDTH / count
	var rect := _view_rect()
	var x0 := floori(rect.position.x / span)
	var x1 := floori(rect.end.x / span)
	var y0 := clampi(floori(rect.position.y / span), 0, count - 1)
	var y1 := clampi(floori(rect.end.y / span), 0, count - 1)
	if x1 - x0 + 1 > count:
		x0 = 0
		x1 = count - 1
	var wanted: Array[String] = []
	for y in range(y0, y1 + 1):
		for x in range(x0, x1 + 1):
			var key := "%d/%d/%d" % [tz, posmod(x, count), y]
			if not wanted.has(key):
				wanted.append(key)
	_zoom = tz
	_wanted = wanted
	for key in wanted:
		var tile: Dictionary = _tiles.get(key, {})
		var state := str(tile.get("state", ""))
		if state.is_empty() or (state == "failed" and Time.get_ticks_msec() - int(tile.get("at", 0)) > RETRY_MS):
			_tiles[key] = {"state": "queued"}
			if not _queue.has(key):
				_queue.append(key)
	_pump()
	_show()
	labels.queue_redraw()


func _pump() -> void:
	while _active < MAX_REQUESTS and not _queue.is_empty():
		var key: String = _queue.pop_front()
		if not _wanted.has(key):
			_tiles.erase(key)
			continue
		_active += 1
		_fetch(key, _generation)


func _fetch(key: String, generation: int) -> void:
	var parts := key.split("/")
	var engine: EngineLink = extras.get("engine")
	var reply: Dictionary = await engine.request("mapextras.natgeoTile", {"z": int(parts[0]), "x": int(parts[1]), "y": int(parts[2])})
	_active -= 1
	if generation != _generation:
		_pump()
		return
	if not bool(reply.get("ok", false)) or not (reply.get("result") is Dictionary):
		_tiles[key] = {"state": "failed", "at": Time.get_ticks_msec()}
		_pump()
		return
	var result: Dictionary = reply["result"]
	_tiles[key] = {
		"state": "ready",
		"fills": _texture(str(result.get("fills", ""))),
		"lines": _texture(str(result.get("lines", ""))),
		"labels": _prepare_labels(result.get("labels", [])),
	}
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
		label["world"] = GlobeView.world_of_lonlat(float(label.get("lon", 0.0)), float(label.get("lat", 0.0)))
		label["font_ref"] = _font_for(str(label.get("font", "")))
		out.append(label)
	return out


static var _fonts := {}


static func _font_for(name: String) -> Font:
	if _fonts.has(name):
		return _fonts[name]
	var family := name
	var bold := false
	var italic := false
	for word in ["Bold Italic", "Italic", "Bold", "Regular", "Medium", "Light", "Semibold"]:
		if family.ends_with(" " + word):
			bold = word.begins_with("Bold") or word == "Semibold"
			italic = word.ends_with("Italic")
			family = family.substr(0, family.length() - word.length() - 1)
			break
	var font := SystemFont.new()
	var serif := false
	for candidate in SERIF_FAMILIES:
		if family.begins_with(candidate):
			serif = true
	font.font_names = PackedStringArray([family, "Georgia" if serif else "Segoe UI", "Times New Roman" if serif else "Arial"])
	font.font_weight = 700 if bold else 400
	font.font_italic = italic
	_fonts[name] = font
	return font


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


func visible_labels() -> Array:
	var out: Array = []
	for key in _wanted:
		var tile: Dictionary = _tiles.get(key, {})
		if str(tile.get("state", "")) == "ready":
			out.append_array(tile.get("labels", []))
	return out


class NatGeoLabels extends Control:
	var reference: NatGeoReference
	var map_view: MapView

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	func _draw() -> void:
		if reference == null or not reference.enabled or map_view == null:
			return
		var level := map_view.zoom_level()
		var view := get_viewport_rect().size
		var items := reference.visible_labels()
		items.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return int(a.get("priority", 0)) > int(b.get("priority", 0)))
		var taken: Array[Rect2] = []
		for list_name in ["war_label_rects", "city_label_rects", "room_label_rects", "war_marker_rects"]:
			var rects: Variant = map_view.get(list_name)
			if rects is Array:
				for rect: Variant in rects:
					if rect is Rect2:
						taken.append(rect)
		var seen := {}
		for label in items:
			if level < float(label.get("minzoom", 0.0)) or level >= float(label.get("maxzoom", 24.0)):
				continue
			var screen := map_view.world_to_screen(label["world"])
			if screen.x < -200.0 or screen.y < -100.0 or screen.x > view.x + 200.0 or screen.y > view.y + 100.0:
				continue
			var text := str(label.get("text", ""))
			match str(label.get("transform", "none")):
				"uppercase":
					text = text.to_upper()
				"lowercase":
					text = text.to_lower()
			var identity := "%s|%d|%d" % [text, roundi(screen.x / 24.0), roundi(screen.y / 24.0)]
			if seen.has(identity):
				continue
			seen[identity] = true
			var size := maxi(1, roundi(float(label.get("size", 12.0))))
			var font: Font = label.get("font_ref")
			var spacing := float(label.get("spacing", 0.0)) * size
			var lines := _wrap(text, font, size, spacing, float(label.get("maxWidth", 10.0)) * size, bool(label.get("line", false)))
			var line_height := float(label.get("lineHeight", 1.2)) * size
			var widest := 0.0
			var widths: Array[float] = []
			for line in lines:
				var width := _measure(line, font, size, spacing)
				widths.append(width)
				widest = maxf(widest, width)
			var box_size := Vector2(widest, line_height * lines.size())
			var offset_value: Variant = label.get("offset", [0, 0])
			var offset := Vector2.ZERO
			if offset_value is Array and (offset_value as Array).size() >= 2:
				offset = Vector2(float(offset_value[0]), float(offset_value[1])) * size
			var corner := _anchored(screen + offset, box_size, str(label.get("anchor", "center")))
			var angle := deg_to_rad(float(label.get("angle", 0.0))) if bool(label.get("line", false)) else 0.0
			var box := Rect2(corner, box_size)
			if absf(angle) > 0.01:
				var center := box.get_center()
				var half := box_size * 0.5
				var extent := Vector2(absf(cos(angle)) * half.x + absf(sin(angle)) * half.y, absf(sin(angle)) * half.x + absf(cos(angle)) * half.y)
				box = Rect2(center - extent, extent * 2.0)
			var padded := box.grow(float(label.get("padding", 2.0)))
			if not bool(label.get("overlap", false)):
				var clash := false
				for other in taken:
					if other.intersects(padded):
						clash = true
						break
				if clash:
					continue
				taken.append(padded)
			var colour := _color(label.get("color"), Color(0, 0, 0))
			var halo := _color(label.get("halo"), Color(0, 0, 0, 0))
			var opacity := clampf(float(label.get("opacity", 1.0)), 0.0, 1.0)
			colour.a *= opacity
			halo.a *= opacity
			var halo_size := roundi(float(label.get("haloWidth", 0.0)) * 2.0)
			var centre := corner + box_size * 0.5
			draw_set_transform(centre, angle, Vector2.ONE)
			for row in range(lines.size()):
				var left := -widths[row] * 0.5
				var top := -box_size.y * 0.5 + line_height * row
				var baseline := top + (line_height - (font.get_ascent(size) + font.get_descent(size))) * 0.5 + font.get_ascent(size)
				_draw_line_text(lines[row], Vector2(left, baseline), font, size, spacing, colour, halo, halo_size)
			draw_set_transform_matrix(Transform2D.IDENTITY)

	func _color(value: Variant, fallback: Color) -> Color:
		if value is Array and (value as Array).size() >= 3:
			var parts: Array = value
			return Color(float(parts[0]) / 255.0, float(parts[1]) / 255.0, float(parts[2]) / 255.0, float(parts[3]) if parts.size() > 3 else 1.0)
		return fallback

	func _anchored(point: Vector2, size: Vector2, anchor: String) -> Vector2:
		var corner := point - size * 0.5
		if anchor.contains("left"):
			corner.x = point.x
		elif anchor.contains("right"):
			corner.x = point.x - size.x
		if anchor.begins_with("top"):
			corner.y = point.y
		elif anchor.begins_with("bottom"):
			corner.y = point.y - size.y
		return corner

	func _measure(text: String, font: Font, size: int, spacing: float) -> float:
		var width := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
		return width + spacing * maxi(0, text.length() - 1)

	func _wrap(text: String, font: Font, size: int, spacing: float, limit: float, single: bool) -> PackedStringArray:
		if single:
			return PackedStringArray([text])
		var out := PackedStringArray()
		var line := ""
		for word in text.split(" ", false):
			var trial := word if line.is_empty() else line + " " + word
			if not line.is_empty() and _measure(trial, font, size, spacing) > limit:
				out.append(line)
				line = word
			else:
				line = trial
		if not line.is_empty():
			out.append(line)
		return out

	func _draw_line_text(text: String, at: Vector2, font: Font, size: int, spacing: float, colour: Color, halo: Color, halo_size: int) -> void:
		if spacing <= 0.0:
			if halo_size > 0 and halo.a > 0.0:
				draw_string_outline(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, halo_size, halo)
			draw_string(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, colour)
			return
		var pen := at
		for index in range(text.length()):
			var character := text.substr(index, 1)
			if halo_size > 0 and halo.a > 0.0:
				draw_string_outline(font, pen, character, HORIZONTAL_ALIGNMENT_LEFT, -1, size, halo_size, halo)
			draw_string(font, pen, character, HORIZONTAL_ALIGNMENT_LEFT, -1, size, colour)
			pen.x += font.get_string_size(character, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x + spacing
