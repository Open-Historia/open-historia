class_name WarRoomTheme
extends RefCounted

const REM := 16.0
const PLATE := Color("#2c2f34")
const SEAM := Color("#0a0b0d")
const LIP := Color(1, 1, 1, 0.1)
const SUNK := Color(0, 0, 0, 0.34)
const SUNK_LINE := Color(0, 0, 0, 0.66)
const RAISED := Color("#3d4249")
const RAISED_TOP := Color("#5f666f")
const RAISED_SIDE := Color("#4a5058")
const BONE := Color("#ece7da")
const BONE_SOFT := Color(236 / 255.0, 231 / 255.0, 218 / 255.0, 0.64)
const BONE_FAINT := Color(236 / 255.0, 231 / 255.0, 218 / 255.0, 0.42)
const BRASS := Color("#c9a54c")
const AMBER := Color("#e9b949")
const RED := Color("#b3212a")
const RED_BRIGHT := Color("#d2353d")
const RED_DARK := Color("#641318")
const OLIVE := Color("#373e26")
const OLIVE_LINE := Color("#606a3f")
const RULE := Color(201 / 255.0, 165 / 255.0, 76 / 255.0, 0.3)
const ALERT := Color("#ffb4a8")
const DARK_INK := Color("#1c1608")
const PLAN_COLOURS := {
	"own": Color("#f4f7fb"),
	"project": Color("#2bc1f3"),
	"idle": Color("#93a1b5"),
	"decoy": Color("#ffd24a"),
	"known": Color("#ff6b6b"),
	"deploy": Color("#3ddc84"),
}
const STENCIL_NAMES := ["Bahnschrift Condensed", "Bahnschrift", "DIN Condensed", "DIN Alternate", "Oswald", "Arial Narrow", "sans-serif"]

static var _fonts := {}
static var _plate: ImageTexture
static var _plate_task := -1
static var _plate_image: Image
static var _rivets := {}
static var _disc: ImageTexture
static var _icons := {}


static func px(rem: float) -> float:
	return rem * REM


static func font_size(rem: float) -> int:
	return int(rem * REM + 0.35)


static func stencil_font(spacing := 0) -> Font:
	var key := "stencil:%d" % spacing
	if _fonts.has(key):
		return _fonts[key]
	var system := SystemFont.new()
	system.font_names = PackedStringArray(STENCIL_NAMES)
	system.font_weight = 700
	system.font_stretch = 87
	system.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	system.hinting = TextServer.HINTING_LIGHT
	system.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_AUTO
	var variation := FontVariation.new()
	variation.base_font = system
	variation.spacing_glyph = spacing
	_fonts[key] = variation
	return variation


static func body_font(weight := 400) -> Font:
	return UI.font(weight)


static func spacing_px(size_rem: float, em: float) -> int:
	return int(round(size_rem * REM * em))


static func stencil(text: String, size_rem := 0.78, color := BRASS, em := 0.16) -> Label:
	var node := Label.new()
	node.text = text.to_upper()
	node.add_theme_font_override("font", stencil_font(spacing_px(size_rem, em)))
	node.add_theme_font_size_override("font_size", font_size(size_rem))
	node.add_theme_color_override("font_color", color)
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func text(value: String, size_rem := 0.72, color := BONE_SOFT, weight := 400, line_height := 1.4) -> Label:
	var node := Label.new()
	node.text = value
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	node.add_theme_font_override("font", body_font(weight))
	var size := font_size(size_rem)
	node.add_theme_font_size_override("font_size", size)
	node.add_theme_color_override("font_color", color)
	node.add_theme_constant_override("line_spacing", maxi(0, int(round(size_rem * REM * line_height - size * 1.15))))
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func line(value: String, size_rem := 0.8, color := BONE, weight := 700) -> Label:
	var node := text(value, size_rem, color, weight, 1.25)
	return node


static func soft(value: String) -> Label:
	return text(value, 0.72, BONE_SOFT)


static func rule_line(color := RULE) -> ColorRect:
	var node := ColorRect.new()
	node.color = color
	node.custom_minimum_size = Vector2(0, 1)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func heading(value: String, action: Control = null, top := 0.0) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", int(round(px(0.55))))
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var label := stencil(value)
	label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(label)
	row.add_child(rule_line())
	if action:
		row.add_child(action)
	if top <= 0.0:
		return row
	return pad(row, Vector4(0, top, 0, 0))


static func pad(child: Control, margins: Vector4) -> MarginContainer:
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_left", int(round(margins.x)))
	holder.add_theme_constant_override("margin_top", int(round(margins.y)))
	holder.add_theme_constant_override("margin_right", int(round(margins.z)))
	holder.add_theme_constant_override("margin_bottom", int(round(margins.w)))
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(child)
	return holder


static func bevel(bg: Color, edges: Array, widths := Vector4(1, 1, 1, 1), margins := Vector4(0, 0, 0, 0), radius := 0.0) -> Bevel:
	var style := Bevel.new()
	style.bg = bg
	style.edges = edges
	style.widths = widths
	style.radius = radius
	style.content_margin_left = margins.x
	style.content_margin_top = margins.y
	style.content_margin_right = margins.z
	style.content_margin_bottom = margins.w
	return style


static func plate_style(edges := [Color(0, 0, 0, 0), Color(0, 0, 0, 0), Color(0, 0, 0, 0), Color(0, 0, 0, 0)], widths := Vector4(0, 0, 0, 0), margins := Vector4(0, 0, 0, 0)) -> Bevel:
	var style := bevel(PLATE, edges, widths, margins)
	style.texture = plate_texture()
	return style


static func tray_style(lit := false, margins := Vector4(px(0.5), px(0.4), px(0.5), px(0.4))) -> Bevel:
	var edge := BRASS if lit else LIP
	return bevel(SUNK, [SUNK_LINE, SUNK_LINE, edge, edge], Vector4(1, 1, 1, 1), margins, 3.0)


static func tray(lit := false, margins := Vector4(px(0.5), px(0.4), px(0.5), px(0.4))) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", tray_style(lit, margins))
	holder.mouse_filter = Control.MOUSE_FILTER_PASS
	return holder


static func key_style(on: bool, margins := Vector4(px(0.62), px(0.42), px(0.62), px(0.42))) -> Bevel:
	if on:
		return bevel(RED, [RED_BRIGHT, RED_BRIGHT, SEAM, SEAM], Vector4(1, 1, 1, 1), margins, 3.0)
	return bevel(RAISED, [RAISED_SIDE, RAISED_TOP, SEAM, SEAM], Vector4(1, 1, 1, 1), margins, 3.0)


static func key(label_text: String, on := false, disabled := false, size_rem := 0.8, margins := Vector4(px(0.62), px(0.42), px(0.62), px(0.42))) -> Button:
	var button := Button.new()
	button.text = label_text.to_upper()
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_override("font", stencil_font(spacing_px(size_rem, 0.07)))
	button.add_theme_font_size_override("font_size", font_size(size_rem))
	style_key(button, on, disabled, margins)
	return button


static func style_key(button: Button, on: bool, disabled: bool, margins := Vector4(px(0.62), px(0.42), px(0.62), px(0.42))) -> void:
	var style := key_style(on, margins)
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, style)
	var ink := BONE_FAINT if disabled else BONE
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		button.add_theme_color_override(name, ink)
	for name in ["icon_normal_color", "icon_hover_color", "icon_pressed_color", "icon_focus_color", "icon_hover_pressed_color", "icon_disabled_color"]:
		button.add_theme_color_override(name, ink)
	button.disabled = disabled
	button.modulate.a = 0.55 if disabled else 1.0
	button.mouse_default_cursor_shape = Control.CURSOR_ARROW if disabled else Control.CURSOR_POINTING_HAND


static func link(label_text: String, disabled := false, size_rem := 0.76, color := AMBER) -> Button:
	var button := Button.new()
	button.text = label_text.to_upper()
	button.flat = true
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_override("font", stencil_font(spacing_px(size_rem, 0.06)))
	button.add_theme_font_size_override("font_size", font_size(size_rem))
	var empty := StyleBoxEmpty.new()
	empty.content_margin_top = px(0.1)
	empty.content_margin_bottom = px(0.1)
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
		button.add_theme_stylebox_override(state, empty)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		button.add_theme_color_override(name, color)
	button.disabled = disabled
	button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	return button


static func links_row() -> HFlowContainer:
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", int(round(px(0.75))))
	row.add_theme_constant_override("v_separation", 0)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return row


static func svg_icon(key_name: String, svg: String, size: int, color: Color, view_size := 24.0) -> Texture2D:
	var cache_key := "%s:%d:%s" % [key_name, size, color.to_html()]
	if _icons.has(cache_key):
		return _icons[cache_key]
	var painted := svg.replace("currentColor", "#" + color.to_html(false))
	var image := Image.new()
	if image.load_svg_from_string(painted, float(size) / view_size) != OK:
		return null
	if color.a < 1.0:
		image.convert(Image.FORMAT_RGBA8)
		for y in range(image.get_height()):
			for x in range(image.get_width()):
				var pixel := image.get_pixel(x, y)
				pixel.a *= color.a
				image.set_pixel(x, y, pixel)
	var texture := ImageTexture.create_from_image(image)
	_icons[cache_key] = texture
	return texture


static func icon_rect(key_name: String, svg: String, size: int, color: Color) -> TextureRect:
	var rect := TextureRect.new()
	rect.texture = svg_icon(key_name, svg, size, color)
	rect.custom_minimum_size = Vector2(size, size)
	rect.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rect


static func add_rivet(style: Bevel, corner: String, inset_x: float, inset_y: float, size_rem := 0.62) -> void:
	var anchor := Vector2(0.0 if corner.ends_with("left") else 1.0, 0.0 if corner.begins_with("top") else 1.0)
	style.rivets.append([anchor, Vector2(inset_x, inset_y), px(size_rem)])


static func _hash(x: int, y: int, seed: int) -> float:
	var value := ((x * 374761393) & 0xFFFFFFFF) ^ ((y * 668265263) & 0xFFFFFFFF) ^ ((seed * 1274126177) & 0xFFFFFFFF)
	value = ((value ^ (value >> 13)) * 1274126177) & 0xFFFFFFFF
	value ^= value >> 16
	return float(value) / 4294967296.0


static func _ease(t: float) -> float:
	return t * t * (3.0 - 2.0 * t)


static func _drift(u: float, v: float, cols: int, rows: int, seed: int) -> float:
	var x := u * cols
	var y := v * rows
	var x0 := int(floor(x))
	var y0 := int(floor(y))
	var tx := _ease(x - x0)
	var ty := _ease(y - y0)
	var a := _hash(posmod(x0, cols), posmod(y0, rows), seed)
	var b := _hash(posmod(x0 + 1, cols), posmod(y0, rows), seed)
	var c := _hash(posmod(x0, cols), posmod(y0 + 1, rows), seed)
	var d := _hash(posmod(x0 + 1, cols), posmod(y0 + 1, rows), seed)
	var top := a * (1.0 - tx) + b * tx
	var bottom := c * (1.0 - tx) + d * tx
	return top * (1.0 - ty) + bottom * ty


static func rough_metal_image(size := 256, base := Color8(50, 53, 58), wear := 1.0, seed := 5) -> Image:
	var light := PackedFloat32Array()
	light.resize(size * size)
	light.fill(1.0)
	for row in range(size):
		for col in range(size):
			var u := float(col) / size
			var v := float(row) / size
			var grain := (_hash(col, row, seed) - 0.5) * 0.11
			var patches := (_drift(u, v, 3, 3, seed + 1) - 0.5) * 0.27 + (_drift(u, v, 9, 9, seed + 2) - 0.5) * 0.14
			var streaks := (_drift(u, v, 2, 72, seed + 3) - 0.5) * 0.13
			light[row * size + col] += (grain + patches + streaks) * wear
	var pits := int(round(float(size * size) / 1500.0 * wear))
	for pit in range(pits):
		var cx := _hash(pit, 1, seed + 11) * size
		var cy := _hash(pit, 2, seed + 11) * size
		var radius := 0.8 + _hash(pit, 3, seed + 11) * 1.9
		var depth := 0.16 + _hash(pit, 4, seed + 11) * 0.22
		for dy in range(-4, 5):
			for dx in range(-4, 5):
				var out := sqrt(float(dx * dx + dy * dy))
				var at := posmod(int(round(cy + dy)), size) * size + posmod(int(round(cx + dx)), size)
				if out <= radius:
					light[at] -= depth * (1.0 - out / (radius + 0.5))
				elif out <= radius + 1.1 and dx + dy > 0:
					light[at] += 0.07
	var scratches := int(round(17.0 * wear))
	for scratch in range(scratches):
		var x := _hash(scratch, 1, seed + 23) * size
		var y := _hash(scratch, 2, seed + 23) * size
		var steep := _hash(scratch, 3, seed + 23) > 0.75
		var turn := (_hash(scratch, 4, seed + 23) - 0.5) * (2.4 if steep else 0.5)
		var length := size * (0.12 + _hash(scratch, 5, seed + 23) * (0.3 if steep else 0.75))
		var bright := 0.14 + _hash(scratch, 6, seed + 23) * 0.2
		var step_x := cos(turn) * 0.5
		var step_y := sin(turn) * 0.5
		var walked := 0.0
		while walked < length:
			var fade := minf(1.0, minf(walked / 6.0, (length - walked) / 6.0))
			var waver := 0.7 + _hash(int(floor(walked / 3.0)), scratch, seed + 29) * 0.3
			light[posmod(int(round(y)), size) * size + posmod(int(round(x)), size)] += bright * fade * waver * 0.5
			light[posmod(int(round(y + 1.0)), size) * size + posmod(int(round(x)), size)] -= bright * fade * 0.28
			x += step_x
			y += step_y
			walked += 0.5
	var bytes := PackedByteArray()
	bytes.resize(size * size * 4)
	var channels := [base.r8, base.g8, base.b8]
	for index in range(size * size):
		for channel in range(3):
			bytes[index * 4 + channel] = int(round(clampf(float(channels[channel]) * light[index] / 255.0, 0.0, 1.0) * 255.0))
		bytes[index * 4 + 3] = 255
	return Image.create_from_data(size, size, false, Image.FORMAT_RGBA8, bytes)


static func plate_texture() -> ImageTexture:
	if _plate:
		_poll_plate()
		return _plate
	var flat := Image.create_empty(256, 256, false, Image.FORMAT_RGBA8)
	flat.fill(PLATE)
	_plate = ImageTexture.create_from_image(flat)
	_plate_task = WorkerThreadPool.add_task(func() -> void: _plate_image = rough_metal_image(256))
	var tree := Engine.get_main_loop() as SceneTree
	if tree:
		_wait_for_plate(tree)
	return _plate


static func _wait_for_plate(tree: SceneTree) -> void:
	while _plate_task >= 0 and not WorkerThreadPool.is_task_completed(_plate_task):
		await tree.process_frame
	_poll_plate()


static func _poll_plate() -> void:
	if _plate_task < 0 or not WorkerThreadPool.is_task_completed(_plate_task):
		return
	WorkerThreadPool.wait_for_task_completion(_plate_task)
	_plate_task = -1
	if _plate_image:
		_plate.update(_plate_image)
		_plate_image = null


static func rivet_texture(side := 28) -> ImageTexture:
	if _rivets.has(side):
		return _rivets[side]
	var size := 28
	var bytes := PackedByteArray()
	bytes.resize(size * size * 4)
	bytes.fill(0)
	var middle := size / 2.0
	var radius := size / 2.0 - 1.0
	var dome := radius * 0.78
	var lx := -0.5
	var ly := -0.62
	var lz := 0.6
	var base := [132.0, 138.0, 146.0]
	for row in range(size):
		for col in range(size):
			var dx := col + 0.5 - middle
			var dy := row + 0.5 - middle
			var out := sqrt(dx * dx + dy * dy)
			if out > radius:
				continue
			var at := (row * size + col) * 4
			var lightness := 0.0
			if out > dome:
				lightness = 0.2 + ((-dx * lx - dy * ly) / radius) * -0.08
			else:
				var nx := dx / dome
				var ny := dy / dome
				var nz := sqrt(maxf(0.0, 1.0 - nx * nx - ny * ny))
				var lit := maxf(0.0, nx * lx + ny * ly + nz * lz)
				lightness = 0.34 + lit * 0.72 + ((lit - 0.93) * 4.5 if lit > 0.93 else 0.0)
			for channel in range(3):
				bytes[at + channel] = int(round(clampf(base[channel] * lightness / 255.0, 0.0, 1.0) * 255.0))
			bytes[at + 3] = int(round(clampf(radius - out, 0.0, 1.0) * 255.0))
	var image := Image.create_from_data(size, size, false, Image.FORMAT_RGBA8, bytes)
	image.premultiply_alpha()
	if side != size:
		image.resize(side, side, Image.INTERPOLATE_LANCZOS)
	image.convert(Image.FORMAT_RGBA8)
	var data := image.get_data()
	for index in range(0, data.size(), 4):
		var alpha := data[index + 3]
		if alpha > 0:
			for channel in range(3):
				data[index + channel] = mini(255, int(round(float(data[index + channel]) * 255.0 / alpha)))
	image = Image.create_from_data(side, side, false, Image.FORMAT_RGBA8, data)
	var texture := ImageTexture.create_from_image(image)
	_rivets[side] = texture
	return texture


static func _to_int32(value: float) -> int:
	var whole := int(value) & 0xFFFFFFFF
	return whole - 0x100000000 if whole >= 0x80000000 else whole


static func _noise(value: int) -> float:
	var h := _to_int32(float(value) * 374761393.0 + 668265263.0)
	var unsigned := h & 0xFFFFFFFF
	h = _to_int32(float(h ^ (unsigned >> 13)) * 1274126177.0)
	unsigned = h & 0xFFFFFFFF
	h = h ^ (unsigned >> 16)
	return float(h & 0xFFFFFFFF) / 4294967296.0


static func disc_texture() -> ImageTexture:
	if _disc:
		return _disc
	var size := 160
	var base := [168.0, 24.0, 30.0]
	var light := 0.105
	var grooves := 2.2
	var seed := 7
	var bytes := PackedByteArray()
	bytes.resize(size * size * 4)
	bytes.fill(0)
	var middle := size / 2.0
	var radius := size / 2.0
	var turn := light * PI * 2.0
	for row in range(size):
		for col in range(size):
			var dx := col + 0.5 - middle
			var dy := row + 0.5 - middle
			var out := sqrt(dx * dx + dy * dy)
			if out > radius:
				continue
			var at := (row * size + col) * 4
			var far := out / radius
			var ring := int(floor(out * grooves))
			var scratch := _noise(ring * 31 + seed)
			var groove := (_noise(ring + seed * 977) - 0.5) * 0.17 + ((scratch - 0.82) * -0.7 if scratch > 0.82 else 0.0)
			var angle := atan2(dy, dx) - turn
			var across := cos(angle * 2.0)
			var wedge := pow(clampf(across, 0.0, 1.0), 3.0) * 0.62 + pow(clampf(-across, 0.0, 1.0), 6.0) * 0.2
			var shine := wedge * (0.35 + 0.65 * clampf(far * 1.4, 0.0, 1.0))
			var lip := exp(-pow((far - 0.9) / 0.022, 2.0)) * 0.34
			var edge := (far - 0.93) / 0.07 if far > 0.93 else 0.0
			var boss := exp(-pow(far / 0.16, 2.0)) * 0.14
			var lightness := 0.62 + groove + lip - edge * 0.5 - boss
			for channel in range(3):
				var lit: float = base[channel] * lightness + (255.0 - base[channel] * lightness) * clampf(shine * (1.0 + groove * 2.5), 0.0, 1.0)
				bytes[at + channel] = int(round(clampf(lit / 255.0, 0.0, 1.0) * 255.0))
			bytes[at + 3] = int(round(clampf(radius - out, 0.0, 1.0) * 255.0))
	var image := Image.create_from_data(size, size, false, Image.FORMAT_RGBA8, bytes)
	image.generate_mipmaps()
	_disc = ImageTexture.create_from_image(image)
	return _disc


static func num(value: Variant) -> String:
	var number := float(value)
	if is_equal_approx(number, roundf(number)):
		return str(int(roundf(number)))
	return str(snappedf(number, 0.000001))


static func grouped(value: float) -> String:
	var whole := int(round(absf(value)))
	var digits := str(whole)
	var out := ""
	var count := 0
	for index in range(digits.length() - 1, -1, -1):
		out = digits[index] + out
		count += 1
		if count % 3 == 0 and index > 0:
			out = "," + out
	return ("-" if value < 0 and whole != 0 else "") + out


class Bevel extends StyleBox:
	var bg := Color(0, 0, 0, 0)
	var texture: Texture2D
	var edges: Array = [Color(0, 0, 0, 0), Color(0, 0, 0, 0), Color(0, 0, 0, 0), Color(0, 0, 0, 0)]
	var widths := Vector4(0, 0, 0, 0)
	var radius := 0.0
	var inner_left := Color(0, 0, 0, 0)
	var inner_top := Color(0, 0, 0, 0)
	var rivets: Array = []
	var _flat: StyleBoxFlat

	func _draw(to_canvas_item: RID, rect: Rect2) -> void:
		if texture:
			RenderingServer.canvas_item_add_texture_rect(to_canvas_item, rect, texture.get_rid(), true)
		elif bg.a > 0.0:
			if radius > 0.0:
				if not _flat:
					_flat = StyleBoxFlat.new()
					_flat.anti_aliasing = true
				_flat.bg_color = bg
				_flat.set_corner_radius_all(int(round(radius)))
				_flat.draw(to_canvas_item, rect)
			else:
				RenderingServer.canvas_item_add_rect(to_canvas_item, rect, bg)
		var left: Color = edges[0]
		var top: Color = edges[1]
		var right: Color = edges[2]
		var bottom: Color = edges[3]
		if widths.y > 0.0 and top.a > 0.0:
			RenderingServer.canvas_item_add_rect(to_canvas_item, Rect2(rect.position, Vector2(rect.size.x, widths.y)), top)
		if widths.w > 0.0 and bottom.a > 0.0:
			RenderingServer.canvas_item_add_rect(to_canvas_item, Rect2(Vector2(rect.position.x, rect.end.y - widths.w), Vector2(rect.size.x, widths.w)), bottom)
		if widths.x > 0.0 and left.a > 0.0:
			RenderingServer.canvas_item_add_rect(to_canvas_item, Rect2(Vector2(rect.position.x, rect.position.y + widths.y), Vector2(widths.x, rect.size.y - widths.y - widths.w)), left)
		if widths.z > 0.0 and right.a > 0.0:
			RenderingServer.canvas_item_add_rect(to_canvas_item, Rect2(Vector2(rect.end.x - widths.z, rect.position.y), Vector2(widths.z, rect.size.y)), right)
		if inner_left.a > 0.0:
			RenderingServer.canvas_item_add_rect(to_canvas_item, Rect2(Vector2(rect.position.x + widths.x, rect.position.y + widths.y), Vector2(1, rect.size.y - widths.y - widths.w)), inner_left)
		if inner_top.a > 0.0:
			RenderingServer.canvas_item_add_rect(to_canvas_item, Rect2(Vector2(rect.position.x + widths.x, rect.position.y + widths.y), Vector2(rect.size.x - widths.x - widths.z, 1)), inner_top)
		for entry in rivets:
			var anchor: Vector2 = entry[0]
			var inset: Vector2 = entry[1]
			var side: float = entry[2]
			var pixels := int(roundf(side))
			var x := rect.position.x + widths.x + inset.x if anchor.x == 0.0 else rect.end.x - widths.z - inset.x - side
			var y := rect.position.y + widths.y + inset.y if anchor.y == 0.0 else rect.end.y - widths.w - inset.y - side
			RenderingServer.canvas_item_add_texture_rect(to_canvas_item, Rect2(Vector2(roundf(x), roundf(y)), Vector2(pixels, pixels)), WarRoomTheme.rivet_texture(pixels).get_rid())
