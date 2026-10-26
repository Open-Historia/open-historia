class_name CommunityKit
extends RefCounted

const CARD_BG := Color("#12141a")
const CARD_BORDER := Color(1, 1, 1, 0.09)
const PILL_BG := Color(1, 1, 1, 0.06)
const PILL_BORDER := Color(1, 1, 1, 0.12)
const PILL_INK := Color(246 / 255.0, 246 / 255.0, 248 / 255.0, 0.92)
const GREY_SELECTED := Color("#0e0e10")
const GREY_BORDER_STRONG := Color(1, 1, 1, 0.22)
const GREY_TEXT := Color("#e7e7ea")
const ZINC := Color("#e4e4e7")
const DISCORD_BLURPLE := Color("#5865f2")
const DISCORD_EDGE := Color("#6d78f5")
const NOTICE_BG := Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.12)
const NOTICE_BORDER := Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.35)
const NOTICE_INK := Color("#bbf7d0")
const ERROR_BG := Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.12)
const ERROR_BORDER := Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.34)
const ERROR_INK := Color("#fecaca")
const NATURAL_LEADING := 1.12
const PLACEHOLDER_COVER := "public/scenario-placeholder.webp"

const MARKS := {
	"discord": "<svg viewBox='0 0 24 24' fill='#fff'><path d='M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z'/></svg>",
	"host": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><circle cx='9' cy='8' r='3.2'/><path d='M3.5 19c.6-3.1 2.8-5 5.5-5s4.9 1.9 5.5 5'/><path d='M16 5.2a3 3 0 0 1 0 5.6'/><path d='M17.5 14.3c1.7.6 2.8 2.3 3 4.7'/></svg>",
	"update": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><path d='M12 4v11'/><path d='m7.5 10.5 4.5 4.5 4.5-4.5'/><path d='M5 19.5h14'/></svg>",
	"working": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='8' opacity='0.3'/><path d='M12 4a8 8 0 0 1 8 8'/></svg>",
	"play": "<svg viewBox='0 0 24 24'><path d='m9 7 8 5-8 5z' fill='#fff'/></svg>",
}

const COVER_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D picture : filter_linear_mipmap;
uniform bool has_picture = false;
uniform vec4 fallback : source_color = vec4(0.16, 0.17, 0.2, 1.0);
uniform vec2 rect_size = vec2(100.0, 56.0);
uniform vec2 cover_scale = vec2(1.0, 1.0);
uniform float radius = 10.0;
float rounded_box(vec2 p, vec2 half_size, float r) {
	vec2 q = abs(p) - half_size + vec2(r);
	return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}
void fragment() {
	vec2 p = UV * rect_size - rect_size * 0.5;
	float d = rounded_box(p, rect_size * 0.5, min(radius, min(rect_size.x, rect_size.y) * 0.5));
	float inside = clamp(0.5 - d, 0.0, 1.0);
	vec4 colour = fallback;
	if (has_picture) {
		colour = texture(picture, (UV - 0.5) * cover_scale + 0.5);
	}
	COLOR = vec4(colour.rgb, colour.a * inside);
}
"""

static var _marks := {}
static var _cover_shader: Shader
static var _placeholder: Texture2D


static func mark(name: String, size := 16, color := Color(1, 1, 1)) -> Texture2D:
	var key := "%s:%d:%s" % [name, size, color.to_html()]
	if _marks.has(key):
		return _marks[key]
	var svg: String = MARKS.get(name, "")
	if svg.is_empty():
		return null
	if color != Color(1, 1, 1):
		svg = svg.replace("#fff", "#" + color.to_html(false))
	var image := Image.new()
	if image.load_svg_from_string(svg, float(size) / 24.0) != OK:
		return null
	if color.a < 1.0:
		image.convert(Image.FORMAT_RGBA8)
		for y in range(image.get_height()):
			for x in range(image.get_width()):
				var pixel := image.get_pixel(x, y)
				pixel.a *= color.a
				image.set_pixel(x, y, pixel)
	var texture := ImageTexture.create_from_image(image)
	_marks[key] = texture
	return texture


static func mark_rect(name: String, size := 16, color := Color(1, 1, 1)) -> TextureRect:
	var rect := TextureRect.new()
	rect.texture = mark(name, size, color)
	rect.custom_minimum_size = Vector2(size, size)
	rect.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rect.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return rect


static func leading(label: Label, size: float, factor: float, floor_height := 0.0) -> Label:
	var spacing := maxi(0, int(round(size * factor - size * NATURAL_LEADING)))
	label.add_theme_constant_override("line_spacing", spacing)
	var box := StyleBoxEmpty.new()
	box.content_margin_top = floorf(spacing * 0.5)
	box.content_margin_bottom = spacing - floorf(spacing * 0.5)
	label.add_theme_stylebox_override("normal", box)
	if floor_height > 0.0:
		label.custom_minimum_size.y = floor_height
	return label


static func text(value: String, size := 13, color := UI.INK, weight := 400, spacing := 0) -> Label:
	return UI.label(value, size, color, weight, "Arial", spacing)


static func para(value: String, size := 13, color := UI.MUTED, weight := 400, line := 1.5) -> Label:
	var node := UI.label(value, size, color, weight)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return leading(node, size, line)


static func style(bg: Color, border: Color, radius: int, pad := Vector4(0, 0, 0, 0)) -> StyleBoxFlat:
	return UI.box(bg, border, radius, 1, pad)


static func panel(bg: Color, border: Color, radius: int, pad: Vector4) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", style(bg, border, radius, pad))
	return holder


static func pill_button(caption: String, options := {}) -> Button:
	var bg: Color = options.get("bg", PILL_BG)
	var border: Color = options.get("border", PILL_BORDER)
	var ink: Color = options.get("ink", PILL_INK)
	var size: int = options.get("size", 13)
	var weight: int = options.get("weight", 600)
	var height: float = options.get("height", 32.0)
	var pad: float = options.get("pad", 14.0)
	var radius: int = options.get("radius", 9)
	var node := Button.new()
	node.text = caption
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var normal := style(bg, border, radius, Vector4(pad, 0, pad, 0))
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed", "disabled"]:
		node.add_theme_stylebox_override(state, normal)
	node.add_theme_font_override("font", UI.font(weight))
	node.add_theme_font_size_override("font_size", size)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		node.add_theme_color_override(name, ink)
	node.custom_minimum_size.y = height
	node.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return node


static func restyle(node: Button, bg: Color, border: Color, ink: Color, radius := 9, pad := 14.0) -> void:
	var normal := style(bg, border, radius, Vector4(pad, 0, pad, 0))
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed", "disabled"]:
		node.add_theme_stylebox_override(state, normal)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		node.add_theme_color_override(name, ink)


static func link_button(caption: String, url: String, options := {}) -> Button:
	var node := pill_button(caption, options)
	node.pressed.connect(func() -> void: open_url(url))
	return node


static func set_idle(node: Button, idle: bool) -> void:
	node.disabled = idle
	node.mouse_default_cursor_shape = Control.CURSOR_ARROW if idle else Control.CURSOR_POINTING_HAND


static func open_url(url: String) -> void:
	if url.begins_with("https://"):
		OS.shell_open(url)


static func input(placeholder: String, width: float, size := 13, height := 32.0, pad := 14.0) -> LineEdit:
	var field := LineEdit.new()
	field.placeholder_text = placeholder
	field.custom_minimum_size = Vector2(width, height)
	field.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var normal := style(PILL_BG, PILL_BORDER, 9, Vector4(pad, 0, pad, 0))
	field.add_theme_stylebox_override("normal", normal)
	field.add_theme_stylebox_override("focus", normal)
	field.add_theme_stylebox_override("read_only", normal)
	field.add_theme_font_override("font", UI.font(400))
	field.add_theme_font_size_override("font_size", size)
	field.add_theme_color_override("font_color", Color(1, 1, 1))
	field.add_theme_color_override("font_placeholder_color", Color(1, 1, 1, 0.42))
	field.add_theme_color_override("caret_color", Color(1, 1, 1))
	field.add_theme_color_override("selection_color", Color(1, 1, 1, 0.22))
	return field


static func set_field_border(field: LineEdit, border: Color, pad := 14.0) -> void:
	var normal := style(PILL_BG, border, 9, Vector4(pad, 0, pad, 0))
	field.add_theme_stylebox_override("normal", normal)
	field.add_theme_stylebox_override("focus", normal)


static func banner(message: String, problem: bool) -> PanelContainer:
	var holder := panel(ERROR_BG if problem else NOTICE_BG, ERROR_BORDER if problem else NOTICE_BORDER, 12, Vector4(14, 11, 14, 11))
	var words := para(message, 13, ERROR_INK if problem else NOTICE_INK, 400, 1.5)
	holder.add_child(words)
	return holder


static func margin_below(node: Control, bottom: float) -> MarginContainer:
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_bottom", int(round(bottom)))
	holder.add_child(node)
	return holder


static func gap(height: float) -> Control:
	var node := Control.new()
	node.custom_minimum_size.y = height
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return node


static func flow(h_gap: float, v_gap: float) -> HFlowContainer:
	var node := HFlowContainer.new()
	node.add_theme_constant_override("h_separation", int(round(h_gap)))
	node.add_theme_constant_override("v_separation", int(round(v_gap)))
	return node


static func row(gap_px: float) -> HBoxContainer:
	var node := HBoxContainer.new()
	node.add_theme_constant_override("separation", int(round(gap_px)))
	return node


static func column(gap_px: float) -> VBoxContainer:
	var node := VBoxContainer.new()
	node.add_theme_constant_override("separation", int(round(gap_px)))
	return node


static func local_date(iso: String) -> String:
	if iso.is_empty():
		return ""
	var stamp := iso.strip_edges().replace("Z", "")
	var dot := stamp.find(".")
	if dot >= 0:
		stamp = stamp.substr(0, dot)
	var unix := Time.get_unix_time_from_datetime_string(stamp)
	if unix == 0 and not stamp.begins_with("1970"):
		return iso
	if iso.contains("T"):
		unix += int(Time.get_time_zone_from_system().get("bias", 0)) * 60
	var date := Time.get_datetime_dict_from_unix_time(unix)
	return "%d/%d/%d" % [date["month"], date["day"], date["year"]]


static func format_bytes(bytes: float) -> String:
	if bytes <= 0.0:
		return ""
	if bytes >= pow(1024.0, 3):
		return "%.1f GB" % (bytes / pow(1024.0, 3))
	if bytes >= pow(1024.0, 2):
		return "%d MB" % int(round(bytes / pow(1024.0, 2)))
	return "%d KB" % maxi(1, int(round(bytes / 1024.0)))


static func placeholder_cover() -> Texture2D:
	if _placeholder:
		return _placeholder
	var image := Image.load_from_file(UI.repo_path(PLACEHOLDER_COVER))
	if image:
		image.generate_mipmaps()
		_placeholder = ImageTexture.create_from_image(image)
	return _placeholder


static func cover_material(radius: float) -> ShaderMaterial:
	if not _cover_shader:
		_cover_shader = Shader.new()
		_cover_shader.code = COVER_SHADER
	var material := ShaderMaterial.new()
	material.shader = _cover_shader
	material.set_shader_parameter("radius", radius)
	return material


static func confirm(host: Node, question: String) -> bool:
	var dialog := ConfirmationDialog.new()
	dialog.dialog_text = question
	dialog.dialog_autowrap = true
	dialog.min_size = Vector2i(460, 0)
	host.add_child(dialog)
	var answer := [false]
	var finished := [false]
	dialog.confirmed.connect(func() -> void:
		answer[0] = true
		finished[0] = true)
	dialog.canceled.connect(func() -> void: finished[0] = true)
	dialog.popup_centered()
	while not finished[0] and is_instance_valid(dialog):
		await host.get_tree().process_frame
	if is_instance_valid(dialog):
		dialog.queue_free()
	return bool(answer[0])


static func pick_file(host: Node, save: bool, default_name: String, filters: PackedStringArray) -> String:
	var dialog := FileDialog.new()
	dialog.use_native_dialog = true
	dialog.access = FileDialog.ACCESS_FILESYSTEM
	dialog.file_mode = FileDialog.FILE_MODE_SAVE_FILE if save else FileDialog.FILE_MODE_OPEN_FILE
	dialog.filters = filters
	dialog.current_dir = OS.get_system_dir(OS.SYSTEM_DIR_DOWNLOADS)
	if save:
		dialog.current_file = default_name
	host.add_child(dialog)
	var picked := [""]
	var finished := [false]
	dialog.file_selected.connect(func(path: String) -> void:
		picked[0] = path
		finished[0] = true)
	dialog.canceled.connect(func() -> void: finished[0] = true)
	dialog.popup_centered()
	while not finished[0] and is_instance_valid(dialog):
		await host.get_tree().process_frame
	if is_instance_valid(dialog):
		dialog.queue_free()
	return str(picked[0])


class Cover extends Control:
	var aspect := 9.0 / 16.0
	var _material: ShaderMaterial
	var _texture: Texture2D
	var _url := ""

	func _init(corner := 10.0, ratio := 9.0 / 16.0) -> void:
		aspect = ratio
		_material = CommunityKit.cover_material(corner)
		material = _material
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		resized.connect(_fit)

	func show_url(url: String, fallback_to_placeholder := true) -> void:
		_url = url
		if url.is_empty():
			set_texture(CommunityKit.placeholder_cover() if fallback_to_placeholder else null)
			return
		HubImages.fetch(self, url, func(texture: Texture2D) -> void:
			if not is_instance_valid(self) or _url != url:
				return
			if texture:
				set_texture(texture)
			elif fallback_to_placeholder:
				set_texture(CommunityKit.placeholder_cover()))

	func set_texture(texture: Texture2D) -> void:
		_texture = texture
		_material.set_shader_parameter("has_picture", texture != null)
		if texture:
			_material.set_shader_parameter("picture", texture)
		_fit()
		queue_redraw()

	func _fit() -> void:
		if aspect > 0.0 and size.x > 0.0:
			var wanted := roundf(size.x * aspect)
			if absf(custom_minimum_size.y - wanted) >= 1.0:
				custom_minimum_size.y = wanted
		_material.set_shader_parameter("rect_size", size)
		if _texture and size.x > 0.0 and size.y > 0.0:
			var texture_aspect := float(_texture.get_width()) / maxf(1.0, float(_texture.get_height()))
			var rect_aspect := size.x / size.y
			if texture_aspect > rect_aspect:
				_material.set_shader_parameter("cover_scale", Vector2(rect_aspect / texture_aspect, 1.0))
			else:
				_material.set_shader_parameter("cover_scale", Vector2(1.0, texture_aspect / rect_aspect))

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), Color(1, 1, 1))


class Avatar extends Control:
	var _cover: Cover

	func _init(diameter: float) -> void:
		custom_minimum_size = Vector2(diameter, diameter)
		size_flags_vertical = Control.SIZE_SHRINK_CENTER
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		_cover = Cover.new(diameter * 0.5, 0.0)
		_cover.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_cover.size_flags_horizontal = Control.SIZE_FILL
		add_child(_cover)
		_cover.set_texture(null)
		_cover.visible = false

	func show_url(url: String) -> void:
		if url.is_empty():
			return
		HubImages.fetch(self, url, func(texture: Texture2D) -> void:
			if not is_instance_valid(self) or not texture:
				return
			_cover.visible = true
			_cover.set_texture(texture))


class Skeleton extends Control:
	const GROUND := Color(1, 1, 1, 0.03)
	const EDGE := Color(1, 1, 1, 0.08)
	const INK := Color(1, 1, 1, 0.07)
	const BAND := Color(1, 1, 1, 0.06)
	var radius := 16.0
	var shapes: Array = []
	var _phase := 0.0

	func _init(corner := 16.0) -> void:
		radius = corner
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		clip_contents = true

	func _process(delta: float) -> void:
		_phase = fmod(_phase + delta / 1.9, 1.0)
		queue_redraw()

	func _draw() -> void:
		var frame := UI.box(GROUND, EDGE, int(radius), 1)
		draw_style_box(frame, Rect2(Vector2.ZERO, size))
		for entry in shapes:
			var shape: Dictionary = entry
			var rect: Rect2 = shape["rect"]
			var corner: float = shape.get("radius", 999.0)
			var box := UI.box(INK, Color(0, 0, 0, 0), int(minf(corner, minf(rect.size.x, rect.size.y) * 0.5)), 0)
			draw_style_box(box, rect)
		var t := clampf(_phase / 0.65, 0.0, 1.0)
		var eased := t * t * (3.0 - 2.0 * t)
		var band_width := size.x * 0.4
		var x := lerpf(-band_width, size.x * 0.4 * 2.5, eased)
		var left := maxf(1.0, x)
		var right := minf(size.x - 1.0, x + band_width)
		if right > left:
			var band := UI.box(BAND, Color(0, 0, 0, 0), 0, 0)
			var corner := int(maxf(0.0, radius - 1.0))
			if left <= 1.0:
				band.corner_radius_top_left = corner
				band.corner_radius_bottom_left = corner
			if right >= size.x - 1.0:
				band.corner_radius_top_right = corner
				band.corner_radius_bottom_right = corner
			draw_style_box(band, Rect2(Vector2(left, 1), Vector2(right - left, size.y - 2)))
