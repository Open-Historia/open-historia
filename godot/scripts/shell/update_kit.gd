class_name UpdateKit
extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const ACCENT := Color("#2bc1f3")
const INK := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 1.0)
const SOFT := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.72)
const FAINT := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.5)
const BASE_FONT := "\"Segoe UI\", sans-serif"
const RISE := "cubic-bezier(0.2, 0.7, 0.2, 1)"
const REM := 16.0

const ICON_PATHS := {
	"chess": "<path d='M9 20h6M8 17h8l-1-4h-6zM10 13l-1-4 3-2 3 2-1 4M12 4v3M10.5 5.5h3'/>",
	"swords": "<path d='M4 4l9.5 9.5M20 4l-9.5 9.5M5.5 15.5l3 3M15.5 18.5l3-3M3 21l3.5-3.5M21 21l-3.5-3.5M4 4h3M4 4v3M20 4h-3M20 4v3'/>",
	"snow": "<path d='M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5'/>",
	"sun": "<circle cx='12' cy='12' r='4.2'/><path d='M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8'/>",
	"rain": "<path d='M7 15.5a4.5 4.5 0 0 1 .6-9 6 6 0 0 1 11.2 2.2A3.6 3.6 0 0 1 18 15.5zM8 18.5l-1 2.5M12.5 18.5l-1 2.5M17 18.5l-1 2.5'/>",
	"leaf": "<path d='M4.5 19.5C4 11 9 4.5 20 4.5c0 10-6 15.5-15.5 15M4.5 19.5L13 11'/>",
	"wall": "<path d='M3.5 20.5v-11h3v-3h3v3h5v-3h3v3h3v11zM10 20.5v-4.5h4v4.5'/>",
	"plane": "<path d='M2.5 13.5l8-1.5L14 4.5h2l-1.5 7.5 5.5-1 1.5-2h1.5l-1 3.5 1 3.5H21.5l-1.5-2-5.5-1L16 20.5h-2l-3.5-7.5-8 1.5z'/>",
	"ship": "<path d='M3 15.5h18l-2.8 4.5H5.8zM12 3.5v12M12 5.5l6.5 8H12'/>",
	"flag": "<path d='M5 21V4M5 4h11l-2 4 2 4H5'/>",
	"eye": "<path d='M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z'/><circle cx='12' cy='12' r='2.6'/>",
	"map": "<path d='M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14'/>",
	"gear": "<circle cx='12' cy='12' r='3.2'/><path d='M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1'/>",
	"star": "<path d='M12 3l2.6 5.6 6.1.7-4.5 4.1 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.1 6.1-.7z'/>",
	"book": "<path d='M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5'/>",
	"note": "<path d='M9 18V5l11-2v13'/><circle cx='6.5' cy='18' r='2.5'/><circle cx='17.5' cy='16' r='2.5'/>",
	"people": "<circle cx='9' cy='8' r='3'/><circle cx='17' cy='9' r='2.4'/><path d='M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5M14.5 15c2.8-.4 6 1.4 6 5'/>",
}

static var _icons := {}
static var _metal := {}


class Riser extends Container:
	var lift := 0.0
	var zoom := 1.0
	var turn := 0.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_PASS

	func _notification(what: int) -> void:
		if what == NOTIFICATION_SORT_CHILDREN:
			for child in get_children():
				if child is Control:
					var control := child as Control
					fit_child_in_rect(control, Rect2(Vector2(0.0, lift), size))
					control.pivot_offset = size * 0.5
					control.scale = Vector2(zoom, zoom)
					control.rotation = deg_to_rad(turn)

	func _get_minimum_size() -> Vector2:
		var result := Vector2.ZERO
		for child in get_children():
			if child is Control and (child as Control).visible:
				result = result.max((child as Control).get_combined_minimum_size())
		return result

	func play(name: String, duration: float, delay: float, timing := RISE) -> void:
		var apply := func(t: float) -> void:
			match name:
				"ohUpdRise":
					lift = 16.0 * (1.0 - t)
					zoom = 0.985 + 0.015 * t
					modulate.a = t
				"ohUpdFade":
					modulate.a = t
				"ohUpdTurn":
					turn = -120.0 * (1.0 - t)
					zoom = 0.6 + 0.4 * t
					modulate.a = t
			queue_sort()
		CubicBezier.animate(self, apply, duration, delay, timing)


class CardGrid extends Container:
	var min_column := 248.0
	var gap := 12.0
	var _height := 0.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_PASS
		size_flags_horizontal = Control.SIZE_EXPAND_FILL

	func _notification(what: int) -> void:
		if what == NOTIFICATION_SORT_CHILDREN:
			_layout()

	func _get_minimum_size() -> Vector2:
		return Vector2(0.0, _height)

	func _layout() -> void:
		var items: Array[Control] = []
		for child in get_children():
			if child is Control and (child as Control).visible:
				items.append(child as Control)
		var total := 0.0
		if not items.is_empty():
			var columns := clampi(floori((size.x + gap) / (min_column + gap)), 1, items.size())
			var width := maxf(0.0, (size.x - gap * float(columns - 1)) / float(columns))
			var y := 0.0
			var start := 0
			while start < items.size():
				var row_height := 0.0
				var stop := mini(start + columns, items.size())
				for index in range(start, stop):
					var item := items[index]
					if absf(item.size.x - width) > 0.5:
						item.size = Vector2(width, item.size.y)
					row_height = maxf(row_height, item.get_combined_minimum_size().y)
				for index in range(start, stop):
					fit_child_in_rect(items[index], Rect2(Vector2(float(index - start) * (width + gap), y), Vector2(width, row_height)))
				y += row_height + gap
				start = stop
			total = maxf(0.0, y - gap)
		if absf(total - _height) > 0.5:
			_height = total
			update_minimum_size()


class Decor extends Control:
	var items: Array[Dictionary] = []

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	func _draw() -> void:
		for item in items:
			match str(item.get("kind", "")):
				"border":
					var box := StyleBoxFlat.new()
					box.draw_center = false
					box.border_color = item["colour"]
					box.set_border_width_all(int(item["width"]))
					box.set_corner_radius_all(int(item["radius"]))
					box.anti_aliasing = true
					draw_style_box(box, Rect2(Vector2.ZERO, size))
				"brackets":
					var colour: Color = item["colour"]
					var inset: float = item["inset"]
					var length: float = item["length"]
					var thick: float = item["thickness"]
					var left := inset
					var right := size.x - inset
					var top := inset
					var bottom := size.y - inset
					draw_rect(Rect2(left, top, length, thick), colour)
					draw_rect(Rect2(left, top, thick, length), colour)
					draw_rect(Rect2(right - length, top, length, thick), colour)
					draw_rect(Rect2(right - thick, top, thick, length), colour)
					draw_rect(Rect2(left, bottom - thick, length, thick), colour)
					draw_rect(Rect2(left, bottom - length, thick, length), colour)
					draw_rect(Rect2(right - length, bottom - thick, length, thick), colour)
					draw_rect(Rect2(right - thick, bottom - length, thick, length), colour)
				"rivets":
					var diameter: float = item["size"]
					var gap: float = item["inset"]
					var texture: Texture2D = item.get("texture")
					for corner in [Vector2(gap, gap), Vector2(size.x - gap - diameter, gap), Vector2(gap, size.y - gap - diameter), Vector2(size.x - gap - diameter, size.y - gap - diameter)]:
						var at: Vector2 = corner
						draw_circle(at + Vector2(diameter, diameter) * 0.5, diameter * 0.5, Color("#7b828b"), true, -1.0, true)
						if texture:
							draw_texture_rect(texture, Rect2(at, Vector2(diameter, diameter)), false)


class PlateBox extends Container:
	var background := Color("#15181d")
	var radius := 10.0
	var texture: Texture2D
	var padding := Vector4.ZERO
	var decor: Decor

	func _init() -> void:
		clip_children = CanvasItem.CLIP_CHILDREN_AND_DRAW
		texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
		mouse_filter = Control.MOUSE_FILTER_PASS
		decor = Decor.new()

	func _ready() -> void:
		if decor.get_parent() == null:
			add_child(decor)
		move_child(decor, get_child_count() - 1)

	func _outline(area: Rect2, corner: float) -> PackedVector2Array:
		var points := PackedVector2Array()
		var r := minf(corner, minf(area.size.x, area.size.y) * 0.5)
		var corners := [[Vector2(area.end.x - r, area.position.y + r), -PI * 0.5], [Vector2(area.end.x - r, area.end.y - r), 0.0], [Vector2(area.position.x + r, area.end.y - r), PI * 0.5], [Vector2(area.position.x + r, area.position.y + r), PI]]
		for entry in corners:
			var centre: Vector2 = entry[0]
			var start: float = entry[1]
			for step in range(9):
				var angle := start + PI * 0.5 * float(step) / 8.0
				points.append(centre + Vector2(cos(angle), sin(angle)) * r)
		return points

	func _draw() -> void:
		if texture:
			var points := _outline(Rect2(Vector2.ZERO, size), radius)
			var uvs := PackedVector2Array()
			var tile := Vector2(texture.get_width(), texture.get_height())
			for point in points:
				uvs.append(point / tile)
			draw_colored_polygon(points, background)
			draw_polygon(points, PackedColorArray([Color.WHITE]), uvs, texture)
		else:
			var box := StyleBoxFlat.new()
			box.bg_color = background
			box.set_corner_radius_all(int(radius))
			box.anti_aliasing = true
			draw_style_box(box, Rect2(Vector2.ZERO, size))

	func _notification(what: int) -> void:
		if what == NOTIFICATION_SORT_CHILDREN:
			for child in get_children():
				if child == decor:
					fit_child_in_rect(decor, Rect2(Vector2.ZERO, size))
				elif child is Control:
					fit_child_in_rect(child as Control, Rect2(Vector2(padding.x, padding.y), size - Vector2(padding.x + padding.z, padding.y + padding.w)))
		elif what == NOTIFICATION_RESIZED:
			queue_redraw()
			decor.queue_redraw()

	func _get_minimum_size() -> Vector2:
		var result := Vector2.ZERO
		for child in get_children():
			if child is Control and child != decor and (child as Control).visible:
				result = result.max((child as Control).get_combined_minimum_size())
		return result + Vector2(padding.x + padding.z, padding.y + padding.w)


class RunLabel extends RichTextLabel:
	var runs: Array[Dictionary] = []
	var line_height := 0.0

	func _init() -> void:
		bbcode_enabled = false
		fit_content = true
		scroll_active = false
		autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		selection_enabled = false
		size_flags_horizontal = Control.SIZE_EXPAND_FILL

	func _notification(what: int) -> void:
		if what == NOTIFICATION_TRANSLATION_CHANGED:
			rebuild()

	func rebuild() -> void:
		clear()
		for run in runs:
			var shown := str(run.get("text", ""))
			if bool(run.get("translate", true)):
				shown = TranslationServer.translate(shown)
			var size_px := int(run.get("size", 16))
			var font: Font = run.get("font")
			var colour: Color = run.get("colour", Color.WHITE)
			var server := TextServerManager.get_primary_interface()
			if bool(run.get("upper", false)):
				shown = server.string_to_upper(shown, TranslationServer.get_locale())
			if bool(run.get("smallcaps", false)):
				var small := maxi(1, roundi(float(size_px) * 0.7))
				var chunk := ""
				var chunk_small := false
				for index in range(shown.length()):
					var character := shown.substr(index, 1)
					var raised := server.string_to_upper(character, TranslationServer.get_locale())
					var is_small := character != raised
					if index > 0 and is_small != chunk_small:
						_push(chunk, font, small if chunk_small else size_px, colour)
						chunk = ""
					chunk_small = is_small
					chunk += raised if is_small else character
				if not chunk.is_empty():
					_push(chunk, font, small if chunk_small else size_px, colour)
			else:
				_push(shown, font, size_px, colour)

	func _push(content: String, font: Font, size_px: int, colour: Color) -> void:
		push_font(font, size_px)
		push_color(colour)
		add_text(content)
		pop()
		pop()


static func px(value_rem: float) -> float:
	return value_rem * REM


static func major_line(update: Dictionary) -> String:
	if str(update.get("date", "")).is_empty():
		return "Major update"
	return "Major update" + " · " + str(update.get("dateText", ""))


static func font(stack: String, weight := 400, italic := false, spacing_px := 0.0) -> Font:
	return ShellFonts.font(stack, weight, italic, spacing_px)


static func text(content: String, size_px: float, colour: Color, stack := BASE_FONT, weight := 400, italic := false, spacing_em := 0.0, upper := false, line_height := 0.0) -> Label:
	var node := Label.new()
	node.text = content
	var face := font(stack, weight, italic, spacing_em * size_px)
	node.add_theme_font_override("font", face)
	node.add_theme_font_size_override("font_size", roundi(size_px))
	node.add_theme_color_override("font_color", colour)
	node.uppercase = upper
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if line_height > 0.0:
		node.add_theme_constant_override("line_spacing", roundi(size_px * line_height - face.get_height(roundi(size_px))))
	return node


static func leading(size_px: float, stack: String, weight: int, italic: bool, line_height: float) -> float:
	if line_height <= 0.0:
		return 0.0
	var face := font(stack, weight, italic)
	return maxf(0.0, (size_px * line_height - face.get_height(roundi(size_px))) * 0.5)


static func para(content: String, size_px: float, colour: Color, stack := BASE_FONT, weight := 400, italic := false, line_height := 0.0, spacing_em := 0.0, upper := false) -> Control:
	var label := text(content, size_px, colour, stack, weight, italic, spacing_em, upper, line_height)
	if line_height <= 0.0:
		return label
	var holder := LineBox.new()
	holder.label = label
	holder.size_px = size_px
	holder.line_height = line_height
	holder.add_child(label)
	return holder


class LineBox extends Container:
	var label: Label
	var size_px := 16.0
	var line_height := 1.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_horizontal = Control.SIZE_EXPAND_FILL

	func _notification(what: int) -> void:
		if what == NOTIFICATION_SORT_CHILDREN and label:
			var face := label.get_theme_font("font")
			var natural := face.get_height(label.get_theme_font_size("font_size"))
			var half := (size_px * line_height - natural) * 0.5
			fit_child_in_rect(label, Rect2(Vector2(0.0, half), Vector2(size.x, label.get_combined_minimum_size().y)))
			update_minimum_size()

	func _get_minimum_size() -> Vector2:
		if not label:
			return Vector2.ZERO
		var lines := maxi(1, label.get_line_count())
		return Vector2(0.0, float(lines) * size_px * line_height)


static func runs(parts: Array[Dictionary], line_height := 0.0) -> RunLabel:
	var node := RunLabel.new()
	node.runs = parts
	if line_height > 0.0 and not parts.is_empty():
		var first: Dictionary = parts[0]
		var face: Font = first.get("font")
		var size_px := int(first.get("size", 16))
		node.add_theme_constant_override("line_separation", roundi(float(size_px) * line_height - face.get_height(size_px)))
	node.rebuild()
	return node


static func run(content: String, size_px: float, colour: Color, stack := BASE_FONT, weight := 400, italic := false, spacing_em := 0.0, upper := false, smallcaps := false) -> Dictionary:
	return {"text": content, "size": roundi(size_px), "colour": colour, "font": font(stack, weight, italic, spacing_em * size_px), "upper": upper, "smallcaps": smallcaps}


static func spacer_control() -> Control:
	var node := Control.new()
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func gap(height: float) -> Control:
	var node := Control.new()
	node.custom_minimum_size = Vector2(0.0, height)
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func vbox(separation := 0) -> VBoxContainer:
	var node := VBoxContainer.new()
	node.add_theme_constant_override("separation", separation)
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func hbox(separation := 0) -> HBoxContainer:
	var node := HBoxContainer.new()
	node.add_theme_constant_override("separation", separation)
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func margins(child: Control, left: float, top: float, right: float, bottom: float) -> MarginContainer:
	var holder := MarginContainer.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.add_theme_constant_override("margin_left", roundi(left))
	holder.add_theme_constant_override("margin_top", roundi(top))
	holder.add_theme_constant_override("margin_right", roundi(right))
	holder.add_theme_constant_override("margin_bottom", roundi(bottom))
	holder.add_child(child)
	return holder


static func rounded(area: Rect2, radius: float, steps := 8) -> PackedVector2Array:
	var points := PackedVector2Array()
	var r := minf(radius, minf(area.size.x, area.size.y) * 0.5)
	if r <= 0.0:
		return PackedVector2Array([area.position, Vector2(area.end.x, area.position.y), area.end, Vector2(area.position.x, area.end.y)])
	var corners := [[Vector2(area.end.x - r, area.position.y + r), -PI * 0.5], [Vector2(area.end.x - r, area.end.y - r), 0.0], [Vector2(area.position.x + r, area.end.y - r), PI * 0.5], [Vector2(area.position.x + r, area.position.y + r), PI]]
	for corner in corners:
		var centre: Vector2 = corner[0]
		var start: float = corner[1]
		for step in range(steps + 1):
			var angle := start + PI * 0.5 * float(step) / float(steps)
			points.append(centre + Vector2(cos(angle), sin(angle)) * r)
	return points


static func box(background: Color, border := Color(0, 0, 0, 0), radius := 0.0, border_width := 1, pad := Vector4.ZERO) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = background
	style.border_color = border
	if border.a > 0.0:
		style.set_border_width_all(border_width)
	style.set_corner_radius_all(roundi(radius))
	style.content_margin_left = pad.x
	style.content_margin_top = pad.y
	style.content_margin_right = pad.z
	style.content_margin_bottom = pad.w
	style.anti_aliasing = true
	return style


static func frame(height: float, bottom: float, bottom_colour: Color, background := Color(0, 0, 0, 0), sides := {}) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.mouse_filter = Control.MOUSE_FILTER_PASS
	holder.clip_contents = true
	holder.custom_minimum_size = Vector2(0.0, height)
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var style: StyleBox
	if sides.is_empty():
		var flat := StyleBoxFlat.new()
		flat.bg_color = background
		flat.border_color = bottom_colour
		flat.border_width_bottom = roundi(bottom)
		flat.content_margin_bottom = roundf(bottom)
		style = flat
	else:
		style = bevel_style(background, sides, float(sides.get("radius", 0.0)), Vector4(1, 1, 1, 1))
	holder.add_theme_stylebox_override("panel", style)
	return holder


static func reveal(content: Control, delay: float, still: bool, name := "ohUpdRise", duration := 600.0) -> Riser:
	var holder := Riser.new()
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.add_child(content)
	if not still:
		holder.play(name, duration, delay)
	return holder


static func plate(surface: Dictionary, still: bool) -> PlateBox:
	var box_node := PlateBox.new()
	box_node.background = surface.get("background", Color("#15181d"))
	box_node.radius = float(surface.get("radius", 10.0))
	box_node.padding = surface.get("padding", Vector4.ZERO)
	box_node.texture = surface.get("texture")
	box_node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box_node.decor.items.append({"kind": "border", "colour": surface.get("border", Color(1, 1, 1, 0.1)), "width": int(surface.get("border_width", 1)), "radius": box_node.radius})
	return box_node


static func plate_reveal(plate_box: PlateBox, still: bool) -> Riser:
	var holder := Riser.new()
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.add_child(plate_box)
	if not still:
		holder.play("ohUpdRise", 650.0, 80.0)
	return holder


static func brackets(plate_box: PlateBox, colour: Color, inset := 14.4, length := 35.2, thickness := 2.0) -> void:
	plate_box.decor.items.append({"kind": "brackets", "colour": colour, "inset": inset, "length": length, "thickness": thickness})


static func rule(colour: Color, middle: Control = null, margin := Vector2(14.4, 14.4)) -> Control:
	var row := hbox(roundi(px(0.8)))
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	var left := Rule.new()
	left.colour = colour
	var right := Rule.new()
	right.colour = colour
	row.add_child(left)
	if middle:
		middle.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(middle)
	else:
		var diamond := Diamond.new()
		diamond.colour = colour
		diamond.side = px(0.55)
		row.add_child(diamond)
	row.add_child(right)
	return margins(row, 0.0, margin.x, 0.0, margin.y)


class Rule extends Control:
	var colour := Color.WHITE

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		size_flags_vertical = Control.SIZE_SHRINK_CENTER
		custom_minimum_size = Vector2(0.0, 3.0)

	func _draw() -> void:
		var tint := Color(colour.r, colour.g, colour.b, colour.a * 0.7)
		draw_rect(Rect2(0.0, 0.0, size.x, 1.0), tint)
		draw_rect(Rect2(0.0, 2.0, size.x, 1.0), tint)


class Diamond extends Control:
	var colour := Color.WHITE
	var side := 8.8

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_vertical = Control.SIZE_SHRINK_CENTER

	func _ready() -> void:
		custom_minimum_size = Vector2(side, side)

	func _draw() -> void:
		var centre := size * 0.5
		var half := side * 0.5 * sqrt(2.0)
		draw_colored_polygon(PackedVector2Array([centre + Vector2(0, -half), centre + Vector2(half, 0), centre + Vector2(0, half), centre + Vector2(-half, 0)]), colour)


static func diamond(colour: Color, side: float) -> Control:
	var node := Diamond.new()
	node.colour = colour
	node.side = side
	node.custom_minimum_size = Vector2(side, side)
	return node


static func emblem(colour: Color, delay: float, size_px: float, still: bool, ink := Color("#0b0d10")) -> Control:
	var scene := Scene.new(Rect2(0, 0, 100, 100), "meet", true)
	scene.custom_minimum_size = Vector2(size_px, size_px)
	scene.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var root: Scene.Shape = scene.root
	scene.circle(root, 50, 50, 46, {"fill": ink, "stroke": colour, "width": 3.0})
	scene.circle(root, 50, 50, 38, {"fill": null, "stroke": colour, "width": 2.0, "dash": [2, 4]})
	for at in range(16):
		var turn := float(at) * PI / 8.0
		var long := at % 4 == 0
		scene.line(root, 50.0 + sin(turn) * 40.0, 50.0 - cos(turn) * 40.0, 50.0 + sin(turn) * (46.0 if long else 43.0), 50.0 - cos(turn) * (46.0 if long else 43.0), {"stroke": colour, "width": 2.4 if long else 1.2})
	scene.path(root, "M50 14 L57 43 L86 50 L57 57 L50 86 L43 57 L14 50 L43 43 Z", {"fill": colour})
	scene.path(root, "M50 14 L57 43 L50 50 Z M86 50 L57 57 L50 50 Z M50 86 L43 57 L50 50 Z M14 50 L43 43 L50 50 Z", {"fill": ink, "opacity": 0.35})
	scene.circle(root, 50, 50, 4, {"fill": ink, "stroke": colour, "width": 2.0})
	var holder := Riser.new()
	holder.custom_minimum_size = Vector2(size_px, size_px)
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	holder.add_child(scene)
	if not still:
		holder.play("ohUpdTurn", 900.0, delay)
	return holder


static func icon(name: String, size_px: int, tint: Color) -> Texture2D:
	var key := "%s|%d|%s" % [name, size_px, tint.to_html()]
	if _icons.has(key):
		return _icons[key]
	var body: String = ICON_PATHS.get(name, ICON_PATHS["star"])
	var svg := "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='24' height='24' fill='none' stroke='#%s' stroke-opacity='%.3f' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'>%s</svg>" % [tint.to_html(false), tint.a, body]
	var image := Image.new()
	if image.load_svg_from_string(svg, float(size_px) / 24.0) != OK:
		return null
	var texture := ImageTexture.create_from_image(image)
	_icons[key] = texture
	return texture


static func icon_rect(name: String, size_px: int, tint: Color) -> TextureRect:
	var node := TextureRect.new()
	node.texture = icon(name, size_px, tint)
	node.custom_minimum_size = Vector2(size_px, size_px)
	node.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return node


static func feature_cards(sections: Array, accent: Color, soft: Color, card: Dictionary, stack: String, caps: bool, delay: float, still: bool, step := 110.0) -> CardGrid:
	var grid := CardGrid.new()
	grid.min_column = px(15.5)
	grid.gap = px(0.75)
	var index := 0
	for raw in sections:
		var section: Dictionary = raw
		var panel := PanelContainer.new()
		panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var pad := Vector4(px(0.85), px(0.75), px(0.85), px(0.8))
		if card.has("bevel"):
			panel.add_theme_stylebox_override("panel", bevel_style(card.get("background", Color(1, 1, 1, 0.04)), card["bevel"], float(card.get("radius", 8.0)), pad))
		else:
			panel.add_theme_stylebox_override("panel", box(card.get("background", Color(1, 1, 1, 0.04)), card.get("border", Color(1, 1, 1, 0.08)), float(card.get("radius", 8.0)), int(card.get("border_width", 1)), pad))
		var column := vbox(0)
		var head := hbox(roundi(px(0.5)))
		head.add_child(icon_rect(str(section.get("icon", "star")), 20, accent))
		var heading := text(str(section.get("heading", "")), px(0.86), accent, stack, 700, false, 0.12 if caps else 0.01, caps)
		heading.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		head.add_child(heading)
		column.add_child(head)
		column.add_child(gap(px(0.5) - px(0.32)))
		for item in section.get("items", []):
			column.add_child(gap(px(0.32)))
			var row := hbox(roundi(px(0.5)))
			var bullet := Bullet.new()
			bullet.colour = accent
			bullet.side = px(0.36)
			bullet.top = px(0.42)
			row.add_child(bullet)
			row.add_child(para(str(item), px(0.8), soft, BASE_FONT, 400, false, 1.45))
			column.add_child(row)
		panel.add_child(column)
		grid.add_child(reveal(panel, delay + float(index) * step, still))
		index += 1
	return grid


class Bullet extends Control:
	var colour := Color.WHITE
	var side := 5.76
	var top := 6.72

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_vertical = Control.SIZE_SHRINK_BEGIN

	func _ready() -> void:
		custom_minimum_size = Vector2(side, top + side)

	func _draw() -> void:
		var centre := Vector2(side * 0.5, top + side * 0.5)
		var half := side * 0.5 * sqrt(2.0)
		draw_colored_polygon(PackedVector2Array([centre + Vector2(0, -half), centre + Vector2(half, 0), centre + Vector2(0, half), centre + Vector2(-half, 0)]), colour)


class BevelStyle extends StyleBox:
	var background := Color(0, 0, 0, 0)
	var sides := {}
	var radius := 3.0
	var _flat: StyleBoxFlat

	func _draw(to_canvas_item: RID, area: Rect2) -> void:
		if not _flat:
			_flat = StyleBoxFlat.new()
			_flat.bg_color = background
			_flat.set_corner_radius_all(roundi(radius))
			_flat.anti_aliasing = true
		_flat.draw(to_canvas_item, area)
		var inset := minf(radius, 2.0)
		if sides.has("top"):
			RenderingServer.canvas_item_add_rect(to_canvas_item, Rect2(area.position.x + inset, area.position.y, area.size.x - inset * 2.0, 1.0), sides["top"])
		if sides.has("bottom"):
			RenderingServer.canvas_item_add_rect(to_canvas_item, Rect2(area.position.x + inset, area.end.y - 1.0, area.size.x - inset * 2.0, 1.0), sides["bottom"])
		if sides.has("left"):
			RenderingServer.canvas_item_add_rect(to_canvas_item, Rect2(area.position.x, area.position.y + inset, 1.0, area.size.y - inset * 2.0), sides["left"])
		if sides.has("right"):
			RenderingServer.canvas_item_add_rect(to_canvas_item, Rect2(area.end.x - 1.0, area.position.y + inset, 1.0, area.size.y - inset * 2.0), sides["right"])


static func bevel_style(background: Color, sides: Dictionary, radius: float, pad := Vector4.ZERO) -> BevelStyle:
	var style := BevelStyle.new()
	style.background = background
	style.sides = sides
	style.radius = radius
	style.content_margin_left = pad.x
	style.content_margin_top = pad.y
	style.content_margin_right = pad.z
	style.content_margin_bottom = pad.w
	return style


static func stamp(node: Control, duration: float, delay: float, still: bool, timing := RISE, tilt := -8.0) -> void:
	node.rotation = deg_to_rad(tilt)
	var fit := func() -> void: node.pivot_offset = node.size * 0.5
	node.resized.connect(fit)
	fit.call()
	if still:
		node.scale = Vector2.ONE
		node.modulate.a = 1.0
		return
	var curve := CubicBezier.named(timing)
	var apply := func(t: float) -> void:
		if not is_instance_valid(node):
			return
		var scale_value := 1.0
		var alpha := 1.0
		if t < 0.7:
			var u := curve.at(t / 0.7)
			scale_value = lerpf(1.8, 0.94, u)
			alpha = u
		else:
			scale_value = lerpf(0.94, 1.0, curve.at((t - 0.7) / 0.3))
		node.scale = Vector2(scale_value, scale_value)
		node.modulate.a = alpha
	apply.call(0.0)
	var tween := node.create_tween()
	if delay > 0.0:
		tween.tween_interval(delay / 1000.0)
	tween.tween_method(apply, 0.0, 1.0, duration / 1000.0)


static func metal(engine: EngineLink) -> Dictionary:
	if not _metal.is_empty():
		return _metal
	if not engine:
		return {}
	var reply: Dictionary = await engine.request("shell.metal")
	if not reply.get("ok", false):
		return {}
	var result: Dictionary = reply.get("result", {})
	var loaded := {}
	for key in ["rough", "rivet"]:
		var entry: Dictionary = result.get(key, {})
		var file := str(entry.get("file", ""))
		var side := int(entry.get("size", 0))
		if file.is_empty() or side <= 0 or not FileAccess.file_exists(file):
			continue
		var bytes := FileAccess.get_file_as_bytes(file)
		if bytes.size() != side * side * 4:
			continue
		var image := Image.create_from_data(side, side, false, Image.FORMAT_RGBA8, bytes)
		loaded[key] = ImageTexture.create_from_image(image)
	_metal = loaded
	return _metal


static func notice_button(content: String, colour := ACCENT, edge := Color(0, 0, 0, 0), ink := Color("#06121a"), stack := BASE_FONT, caps := false) -> Button:
	return chrome_button(content, {"bg": colour, "border": edge if edge.a > 0.0 else colour, "ink": ink, "radius": 6.0, "size": px(0.9), "weight": 800, "pad": Vector2(px(1.3), px(0.5)), "min_height": px(2.5), "font": stack, "spacing": 0.14 if caps else 0.02, "caps": caps}, {})


static func chrome_button(content: String, base: Dictionary, chrome: Dictionary) -> Button:
	var spec := base.duplicate()
	for key in chrome.keys():
		spec[key] = chrome[key]
	var node := Button.new()
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.text = ""
	var radius := float(spec.get("radius", 8.0))
	var background: Color = spec.get("bg", Color(0, 0, 0, 0))
	var border: Color = spec.get("border", Color(0, 0, 0, 0))
	var pad: Vector2 = spec.get("pad", Vector2(px(1.25), px(0.45)))
	var normal: StyleBox = box(background, border, radius, 1, Vector4(pad.x, pad.y, pad.x, pad.y))
	if spec.has("bevel"):
		normal = bevel_style(background, spec["bevel"], radius, Vector4(pad.x, pad.y, pad.x, pad.y))
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
		node.add_theme_stylebox_override(state, normal)
	var size_px := float(spec.get("size", px(0.88)))
	var caption := text(content, size_px, spec.get("ink", INK), str(spec.get("font", BASE_FONT)), int(spec.get("weight", 800)), bool(spec.get("italic", false)), float(spec.get("spacing", 0.0)), bool(spec.get("caps", false)))
	caption.autowrap_mode = TextServer.AUTOWRAP_OFF
	caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	caption.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	caption.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	caption.name = "Caption"
	node.add_child(caption)
	var fit := func() -> void:
		var inner := caption.get_minimum_size()
		node.custom_minimum_size = Vector2(maxf(float(spec.get("min_width", 0.0)), inner.x + pad.x * 2.0 + 2.0), maxf(float(spec.get("min_height", 0.0)), inner.y + pad.y * 2.0 + 2.0))
	caption.minimum_size_changed.connect(fit)
	fit.call()
	node.button_down.connect(func() -> void: _press(node, 0.97))
	node.button_up.connect(func() -> void: _press(node, 1.0))
	node.resized.connect(func() -> void: node.pivot_offset = node.size * 0.5)
	return node


static func _press(node: Control, target: float) -> void:
	if not is_instance_valid(node):
		return
	var from := node.scale.x
	CubicBezier.animate(node, func(t: float) -> void: node.scale = Vector2.ONE * lerpf(from, target, t), 160.0, 0.0, "ease", false)


static func caption_of(button: Button) -> Label:
	return button.get_node_or_null("Caption") as Label


static func list_item(content: String, size_px: float, colour: Color, stack: String, line_height: float, indent: float) -> Control:
	var row := hbox(0)
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var marker := Disc.new()
	marker.colour = colour
	marker.font_size = size_px
	marker.indent = indent
	marker.top = leading(size_px, stack, 400, false, line_height) + font(stack).get_ascent(roundi(size_px))
	row.add_child(marker)
	row.add_child(para(content, size_px, colour, stack, 400, false, line_height))
	return row


class Disc extends Control:
	var colour := Color.WHITE
	var font_size := 13.0
	var indent := 17.6
	var top := 14.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_vertical = Control.SIZE_SHRINK_BEGIN

	func _ready() -> void:
		custom_minimum_size = Vector2(indent, top + 2.0)

	func _draw() -> void:
		var radius := maxf(1.5, roundf(font_size * 0.36) * 0.5)
		var centre := Vector2(indent - font_size * 0.62 - radius, top - font_size * 0.31)
		draw_circle(centre, radius, colour, true, -1.0, true)
