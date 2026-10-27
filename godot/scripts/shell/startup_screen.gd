class_name StartupScreen
extends Control

const IMAGES: Array[String] = ["loading_screen.jpg", "loading_screen_2.jpg", "loading_screen_3.jpg", "loading_screen_4.jpg", "loading_screen_5.webp"]
const ROTATE_SECONDS := 4.5
const FADE_MS := 1400.0
const TITLE := "Preparing the World"
const TIMED_OUT_TITLE := "Continuing…"
const STAGE := "Syncing games and scenarios"
const CREDIT := "Image © 2026 Nicholas Krol"
const GROUND := Color(5 / 255.0, 4 / 255.0, 3 / 255.0)
const REM := 16.0

static var _files := {}
static var _faces := {}
static var _grain_texture: ImageTexture

var steps: Array = [{"id": "library", "label": STAGE, "status": "active"}]
var stage := STAGE
var progress := 0.0
var loaded_bytes := 0
var timed_out := false
var _status := ""
var _art: Art
var _grain: Grain
var _credit: Label
var _hud: PanelContainer
var _hud_style: StyleBoxFlat
var _column: VBoxContainer
var _top: BoxContainer
var _identity: HBoxContainer
var _logo: TextureRect
var _game_name: Label
var _game_name_gap: Control
var _title: Label
var _step_box: VBoxContainer
var _step_name: Label
var _step_counter: Label
var _rule: ColorRect
var _track: Track
var _pct: Label
var _dots: HBoxContainer
var _cache: Label
var _shift := 0.0
var _intro: Tween
var _rotation: Timer
var _narrow := false
var _art_task := -1


func _exit_tree() -> void:
	if _art_task >= 0:
		WorkerThreadPool.wait_for_task_completion(_art_task)
		_art_task = -1


class Art extends Control:
	var layers: Array[Texture2D] = []
	var opacity: Array[float] = []
	var current := 0
	var tweens: Array = []

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	func add_layer(texture: Texture2D, shown: bool) -> void:
		layers.append(texture)
		opacity.append(1.0 if shown else 0.0)
		tweens.append(null)
		queue_redraw()

	func set_texture(index: int, texture: Texture2D) -> void:
		if index >= 0 and index < layers.size():
			layers[index] = texture
			queue_redraw()

	func show_layer(index: int) -> void:
		if layers.is_empty():
			return
		var target := index % layers.size()
		var tries := 0
		while layers[target] == null and tries < layers.size():
			target = (target + 1) % layers.size()
			tries += 1
		var previous := current
		current = target
		for at in range(layers.size()):
			var goal := 1.0 if at == target else 0.0
			if is_equal_approx(opacity[at], goal):
				continue
			if at != previous and at != target:
				opacity[at] = goal
				continue
			var old: Variant = tweens[at]
			if old is Tween and (old as Tween).is_valid():
				(old as Tween).kill()
			var from := opacity[at]
			var layer := at
			tweens[at] = CubicBezier.animate(self, func(t: float) -> void:
				opacity[layer] = lerpf(from, goal, t)
				queue_redraw(), FADE_MS, 0.0, "ease-in-out", false)
		queue_redraw()

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), StartupScreen.GROUND)
		for at in range(layers.size()):
			if opacity[at] <= 0.001 or layers[at] == null:
				continue
			var texture := layers[at]
			var source := Vector2(texture.get_width(), texture.get_height())
			if source.x <= 0 or source.y <= 0 or size.x <= 0 or size.y <= 0:
				continue
			var scale := maxf(size.x / source.x, size.y / source.y)
			var shown := size / scale
			var region := Rect2(Vector2((source.x - shown.x) * 0.5, 0.0), shown)
			draw_texture_rect_region(texture, Rect2(Vector2.ZERO, size), region, Color(1, 1, 1, opacity[at]))


class Grain extends Control:
	var texture: Texture2D

	func _init(tile: Texture2D) -> void:
		texture = tile
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		modulate = Color(1, 1, 1, 0.035)

	func _draw() -> void:
		if texture:
			draw_texture_rect(texture, Rect2(Vector2.ZERO, size), true)


class Track extends Control:
	var value := 0.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		custom_minimum_size = Vector2(0, 5)
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		size_flags_vertical = Control.SIZE_SHRINK_CENTER

	func _draw() -> void:
		var bar := Rect2(Vector2.ZERO, Vector2(size.x, 5.0))
		draw_style_box(UI.box(Color(1, 1, 1, 0.055), Color(0, 0, 0, 0), 3), bar)
		var shown := clampf(value, 0.0, 100.0)
		if shown > 0.0:
			draw_style_box(UI.box(Color("#d4a820"), Color(0, 0, 0, 0), 3), Rect2(Vector2.ZERO, Vector2(size.x * shown / 100.0, 5.0)))
		if shown > 1.0 and shown < 100.0:
			draw_circle(Vector2(size.x * shown / 100.0, 2.5), 5.0, Color("#ffe880"), true, -1.0, true)


class Dot extends Control:
	var status := "pending"

	func _init(kind: String) -> void:
		status = kind
		mouse_filter = Control.MOUSE_FILTER_PASS
		var side := 7.0 if kind == "active" else 5.0
		custom_minimum_size = Vector2(side, side)
		size_flags_vertical = Control.SIZE_SHRINK_CENTER

	func _draw() -> void:
		var centre := size * 0.5
		var radius := minf(size.x, size.y) * 0.5
		match status:
			"done":
				draw_circle(centre, radius, Color(120 / 255.0, 160 / 255.0, 80 / 255.0, 0.65), true, -1.0, true)
			"active":
				draw_circle(centre, radius, Color(220 / 255.0, 175 / 255.0, 55 / 255.0, 0.95), true, -1.0, true)
			_:
				draw_circle(centre, radius, Color(90 / 255.0, 80 / 255.0, 60 / 255.0, 0.35), true, -1.0, true)
				draw_circle(centre, radius - 0.5, Color(130 / 255.0, 110 / 255.0, 60 / 255.0, 0.2), false, 1.0, true)


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	_art = Art.new()
	add_child(_art)
	_grain = Grain.new(_grain_tile())
	add_child(_grain)
	_credit = Label.new()
	_credit.text = CREDIT
	_credit.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_credit.add_theme_color_override("font_color", Color(232 / 255.0, 220 / 255.0, 196 / 255.0, 0.2))
	_credit.add_theme_font_size_override("font_size", 8)
	_credit.add_theme_font_override("font", _cinzel(400, 0.14 * 8.0))
	_credit.anchor_left = 1.0
	_credit.anchor_right = 1.0
	_credit.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	add_child(_credit)
	_build_hud()
	_load_artwork()
	_rotation = Timer.new()
	_rotation.wait_time = ROTATE_SECONDS
	_rotation.timeout.connect(func() -> void:
		if _art.layers.size() > 1:
			_art.show_layer(_art.current + 1))
	add_child(_rotation)


func _ready() -> void:
	resized.connect(_fit)
	_fit()
	_render()
	_play_intro()
	_rotation.start()


func _notification(what: int) -> void:
	if what == NOTIFICATION_TRANSLATION_CHANGED and _title:
		_render()
	elif what == NOTIFICATION_VISIBILITY_CHANGED and _rotation and _rotation.is_inside_tree():
		if visible:
			mouse_filter = Control.MOUSE_FILTER_STOP
			if _rotation.is_stopped():
				_rotation.start()
		else:
			mouse_filter = Control.MOUSE_FILTER_IGNORE
			_rotation.stop()


static func _font_file(file: String) -> FontFile:
	if _files.has(file):
		return _files[file]
	var font := FontFile.new()
	if font.load_dynamic_font(UI.repo_path("public/fonts/" + file)) != OK:
		font = null
	_files[file] = font
	return font


static func _face(main_file: String, extended_file: String, fallback_stack: String, weight: int, spacing: float, italic := false) -> Font:
	var key := "%s|%d|%.2f" % [main_file, weight, spacing]
	if _faces.has(key):
		return _faces[key]
	var main := _font_file(main_file)
	var extended := _font_file(extended_file)
	var system := ShellFonts.font(fallback_stack, weight, italic)
	if main == null:
		var plain := ShellFonts.font(fallback_stack, weight, italic, spacing)
		_faces[key] = plain
		return plain
	var variation := FontVariation.new()
	variation.base_font = main
	if not main.get_supported_variation_list().is_empty():
		variation.variation_opentype = {"wght": weight}
	variation.spacing_glyph = roundi(spacing)
	var fallbacks: Array[Font] = []
	if extended:
		var wide := FontVariation.new()
		wide.base_font = extended
		if not extended.get_supported_variation_list().is_empty():
			wide.variation_opentype = {"wght": weight}
		wide.spacing_glyph = roundi(spacing)
		fallbacks.append(wide)
	fallbacks.append(system)
	variation.fallbacks = fallbacks
	_faces[key] = variation
	return variation


static func _cinzel(weight: int, spacing: float) -> Font:
	return _face("cinzel-latin-normal.woff2", "cinzel-latin-ext-normal.woff2", "Georgia, serif", weight, spacing)


static func _garamond(italic: bool, spacing: float) -> Font:
	if italic:
		return _face("eb-garamond-latin-italic.woff2", "eb-garamond-latin-ext-italic.woff2", "Georgia, serif", 400, spacing, true)
	return _face("eb-garamond-latin-normal.woff2", "eb-garamond-latin-ext-normal.woff2", "Georgia, serif", 400, spacing)


static func _grain_tile() -> ImageTexture:
	if _grain_texture:
		return _grain_texture
	var noise := FastNoiseLite.new()
	noise.noise_type = FastNoiseLite.TYPE_VALUE
	noise.seed = 1931
	noise.frequency = 0.9 * 256.0 / 200.0
	noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	noise.fractal_octaves = 4
	var image := noise.get_seamless_image(200, 200, false, false, 0.1, true)
	image.convert(Image.FORMAT_RGBA8)
	_grain_texture = ImageTexture.create_from_image(image)
	return _grain_texture


func _load_artwork() -> void:
	var start := randi() % IMAGES.size()
	var paths: Array[String] = []
	for name in IMAGES:
		var path := UI.repo_path("public/" + name)
		if FileAccess.file_exists(path):
			paths.append(path)
	if paths.is_empty():
		return
	var first_index := start % paths.size()
	for at in range(paths.size()):
		_art.add_layer(null, at == first_index)
	_art.current = first_index
	var first := Image.load_from_file(paths[first_index])
	if first and not first.is_empty():
		_art.set_texture(first_index, ImageTexture.create_from_image(first))
	var rest: Array[int] = []
	for at in range(paths.size()):
		if at != first_index:
			rest.append(at)
	if rest.is_empty():
		return
	_art_task = WorkerThreadPool.add_task(func() -> void:
		for at in rest:
			var image := Image.load_from_file(paths[at])
			if image and not image.is_empty():
				_deliver.call_deferred(at, image))


func _deliver(index: int, image: Image) -> void:
	if is_instance_valid(_art):
		_art.set_texture(index, ImageTexture.create_from_image(image))


func _build_hud() -> void:
	_hud = PanelContainer.new()
	_hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_hud.anchor_left = 0.0
	_hud.anchor_right = 1.0
	_hud.anchor_top = 1.0
	_hud.anchor_bottom = 1.0
	_hud.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_hud_style = StyleBoxFlat.new()
	_hud_style.bg_color = Color(6 / 255.0, 6 / 255.0, 7 / 255.0, 0.84)
	_hud_style.border_color = Color(1, 1, 1, 0.08)
	_hud_style.border_width_top = 1
	_hud.add_theme_stylebox_override("panel", _hud_style)
	add_child(_hud)
	_column = VBoxContainer.new()
	_column.add_theme_constant_override("separation", roundi(1.1 * REM))
	_hud.add_child(_column)
	_top = HBoxContainer.new()
	_column.add_child(_top)
	_identity = HBoxContainer.new()
	_identity.add_theme_constant_override("separation", roundi(REM))
	_identity.alignment = BoxContainer.ALIGNMENT_BEGIN
	_identity.size_flags_vertical = Control.SIZE_SHRINK_END
	_logo = TextureRect.new()
	_logo.texture = UI.logo()
	_logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_logo.custom_minimum_size = Vector2(3.6 * REM, 3.6 * REM)
	_logo.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_logo.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_identity.add_child(_logo)
	var block := VBoxContainer.new()
	block.add_theme_constant_override("separation", 0)
	block.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_game_name = _text_label(Color(200 / 255.0, 158 / 255.0, 50 / 255.0, 0.6))
	_game_name.text = "Open Historia"
	_game_name.uppercase = true
	block.add_child(_game_name)
	_game_name_gap = Control.new()
	_game_name_gap.custom_minimum_size.y = 0.2 * REM
	_game_name_gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	block.add_child(_game_name_gap)
	_title = _text_label(Color("#f2e8cc"))
	block.add_child(_title)
	_identity.add_child(block)
	_step_box = VBoxContainer.new()
	_step_box.add_theme_constant_override("separation", roundi(0.2 * REM))
	_step_box.size_flags_vertical = Control.SIZE_SHRINK_END
	_step_name = _text_label(Color(215 / 255.0, 190 / 255.0, 140 / 255.0, 0.75))
	_step_box.add_child(_step_name)
	_step_counter = _text_label(Color(180 / 255.0, 140 / 255.0, 50 / 255.0, 0.45))
	_step_counter.uppercase = true
	_step_box.add_child(_step_counter)
	_rule = ColorRect.new()
	_rule.color = Color(210 / 255.0, 165 / 255.0, 55 / 255.0, 0.45)
	_rule.custom_minimum_size.y = 1
	_rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_column.add_child(_rule)
	var progress_row := HBoxContainer.new()
	progress_row.add_theme_constant_override("separation", roundi(1.2 * REM))
	_track = Track.new()
	progress_row.add_child(_track)
	_pct = _text_label(Color(230 / 255.0, 185 / 255.0, 60 / 255.0, 0.9))
	_pct.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_pct.custom_minimum_size.x = 3.2 * REM
	_pct.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	progress_row.add_child(_pct)
	_column.add_child(progress_row)
	var meta_row := HBoxContainer.new()
	meta_row.add_theme_constant_override("separation", roundi(REM))
	_dots = HBoxContainer.new()
	_dots.add_theme_constant_override("separation", 5)
	_dots.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	meta_row.add_child(_dots)
	meta_row.add_child(UI.spacer())
	_cache = _text_label(Color(160 / 255.0, 140 / 255.0, 100 / 255.0, 0.4))
	_cache.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	meta_row.add_child(_cache)
	_column.add_child(meta_row)


func _text_label(color: Color) -> Label:
	var label := Label.new()
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	label.add_theme_color_override("font_color", color)
	return label


func _width() -> float:
	return size.x if size.x > 0 else get_viewport_rect().size.x


func _fit() -> void:
	var width := _width()
	var narrow := width <= 700.0
	if narrow != _narrow or _top.get_child_count() == 0:
		_narrow = narrow
		_arrange_top()
	var side := width * 0.05
	_hud_style.content_margin_left = side
	_hud_style.content_margin_right = side
	_hud_style.content_margin_top = 1.6 * REM
	_hud_style.content_margin_bottom = 2.2 * REM
	_credit.offset_top = 0.85 * REM
	_credit.offset_right = -1.1 * REM
	var game_size := clampf(width * 0.01, 0.55 * REM, 0.65 * REM)
	_game_name.add_theme_font_size_override("font_size", roundi(game_size))
	_game_name.add_theme_font_override("font", _cinzel(500, 0.32 * game_size))
	var title_size := clampf(width * 0.026, 1.4 * REM, 2.0 * REM)
	_title.add_theme_font_size_override("font_size", roundi(title_size))
	_title.add_theme_font_override("font", _cinzel(700, 0.05 * title_size))
	var step_size := clampf(width * 0.012, 0.78 * REM, 0.9 * REM)
	_step_name.add_theme_font_size_override("font_size", roundi(step_size))
	_step_name.add_theme_font_override("font", _garamond(true, 0.01 * step_size))
	_step_counter.add_theme_font_size_override("font_size", roundi(0.6 * REM))
	_step_counter.add_theme_font_override("font", _cinzel(400, 0.2 * 0.6 * REM))
	var pct_size := clampf(width * 0.011, 0.75 * REM, 0.85 * REM)
	_pct.add_theme_font_size_override("font_size", roundi(pct_size))
	_pct.add_theme_font_override("font", _cinzel(700, 0.1 * pct_size))
	var cache_size := clampf(width * 0.009, 0.65 * REM, 0.75 * REM)
	_cache.add_theme_font_size_override("font_size", roundi(cache_size))
	_cache.add_theme_font_override("font", _garamond(true, 0.02 * cache_size))
	_step_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT if narrow else HORIZONTAL_ALIGNMENT_RIGHT
	_step_counter.horizontal_alignment = _step_name.horizontal_alignment
	_place_hud()


func _arrange_top() -> void:
	for child in _top.get_children():
		_top.remove_child(child)
	var holder := _top.get_parent()
	var index := _top.get_index()
	holder.remove_child(_top)
	_top.queue_free()
	if _narrow:
		var stack := VBoxContainer.new()
		stack.add_theme_constant_override("separation", roundi(REM))
		_top = stack
		_step_box.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	else:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", roundi(REM))
		_top = row
		_step_box.size_flags_horizontal = Control.SIZE_SHRINK_END | Control.SIZE_EXPAND
	holder.add_child(_top)
	holder.move_child(_top, index)
	_top.add_child(_identity)
	_top.add_child(_step_box)


func _place_hud() -> void:
	_hud.offset_left = 0.0
	_hud.offset_right = 0.0
	_hud.offset_top = _shift
	_hud.offset_bottom = _shift


func _play_intro() -> void:
	if _intro and _intro.is_valid():
		_intro.kill()
	_intro = CubicBezier.animate(self, func(t: float) -> void:
		_hud.modulate.a = t
		_shift = 14.0 * (1.0 - t)
		_place_hud(), 800.0, 150.0, "cubic-bezier(0.16, 1, 0.3, 1)")


static func format_bytes(bytes: int) -> String:
	if bytes <= 0:
		return "0 B"
	var units := ["B", "KB", "MB", "GB"]
	var value := float(bytes)
	var unit := 0
	while value >= 1024.0 and unit < units.size() - 1:
		value /= 1024.0
		unit += 1
	var digits := 0 if value >= 100.0 or unit == 0 else 1
	return ("%." + str(digits) + "f %s") % [value, units[unit]]


func _active_step() -> Dictionary:
	for step in steps:
		if str((step as Dictionary).get("status", "")) == "active":
			return step
	return {}


func _render() -> void:
	var active := _active_step()
	var done := 0
	for step in steps:
		if str((step as Dictionary).get("status", "")) == "done":
			done += 1
	_title.text = tr(TIMED_OUT_TITLE if timed_out else TITLE)
	var step_label := str(active.get("label", stage)) if not active.is_empty() else stage
	_step_name.text = _status if not _status.is_empty() else tr(step_label)
	_step_box.visible = steps.size() > 0 or not _status.is_empty()
	_step_counter.visible = steps.size() > 1
	_step_counter.text = tr("%d of %d complete" % [done, steps.size()])
	_cache.text = tr("%s cached so far" % format_bytes(loaded_bytes)) if loaded_bytes > 0 else ""
	var shown := clampf(progress, 0.0, 100.0)
	_track.value = shown
	_track.queue_redraw()
	_pct.text = "%d%%" % roundi(shown) if is_equal_approx(shown, roundf(shown)) else "%s%%" % str(shown)
	for child in _dots.get_children():
		_dots.remove_child(child)
		child.queue_free()
	for step in steps:
		var dot := Dot.new(str((step as Dictionary).get("status", "pending")))
		dot.tooltip_text = tr(str((step as Dictionary).get("label", "")))
		_dots.add_child(dot)


func show_startup() -> void:
	_status = ""
	visible = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	_render()
	_play_intro()
	if _rotation.is_stopped():
		_rotation.start()


func set_status(text: String) -> void:
	_status = text
	if not _title:
		return
	_render()


func set_progress(state: Dictionary) -> void:
	if state.has("steps"):
		steps = state["steps"]
	if state.has("stage"):
		stage = str(state["stage"])
	if state.has("progress"):
		progress = float(state["progress"])
	if state.has("loadedBytes"):
		loaded_bytes = int(state["loadedBytes"])
	if state.has("timedOut"):
		timed_out = bool(state["timedOut"])
	_render()


func finish() -> void:
	visible = false
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_rotation.stop()
	if _intro and _intro.is_valid():
		_intro.kill()
