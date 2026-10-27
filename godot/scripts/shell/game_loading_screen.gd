class_name GameLoadingScreen
extends Control

signal finished

const PHASES := {
	"world": "Reading the world…",
	"polities": "Drawing borders and labels…",
	"settling": "Settling the map…",
	"done": "",
}
const LOADING_CEILING_MS := 60000.0
const POLITIES_AFTER_MS := 1200.0
const DEFAULT_COVER := "/scenario-placeholder.webp"
const REM := 16.0

var phase := "done"
var loader: ImageLoader
var _cover: Cover
var _strip: PanelContainer
var _strip_style: StyleBoxFlat
var _name: Label
var _subtitle: Label
var _status: Label
var _logo: Spinning
var _info := {}
var _cover_url := ""
var _timers: Array[SceneTreeTimer] = []
var _fade: Tween
var _open := false
var _serial := 0


class Cover extends Control:
	var texture: Texture2D
	var fallback: Texture2D

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), Color("#0c0c0e"))
		for picture in [fallback, texture]:
			var shown: Texture2D = picture
			if shown == null:
				continue
			var source := Vector2(shown.get_width(), shown.get_height())
			if source.x <= 0 or source.y <= 0 or size.x <= 0 or size.y <= 0:
				continue
			var scale := maxf(size.x / source.x, size.y / source.y)
			var seen := size / scale
			draw_texture_rect_region(shown, Rect2(Vector2.ZERO, size), Rect2((source - seen) * 0.5, seen))


class Spinning extends Control:
	var texture: Texture2D
	var angle := 0.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		custom_minimum_size = Vector2(64, 64)
		size_flags_vertical = Control.SIZE_SHRINK_END

	func _process(delta: float) -> void:
		if not is_visible_in_tree():
			return
		angle = fposmod(angle + delta * TAU / 4.0, TAU)
		queue_redraw()

	func _draw() -> void:
		if texture == null:
			return
		var side := minf(size.x, size.y)
		var centre := size * 0.5
		draw_set_transform(centre, angle, Vector2.ONE)
		draw_texture_rect(texture, Rect2(Vector2(-side, -side) * 0.5, Vector2(side, side)), false)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	visible = false
	_cover = Cover.new()
	_cover.fallback = _public_texture(DEFAULT_COVER)
	add_child(_cover)
	_strip = PanelContainer.new()
	_strip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_strip.anchor_left = 0.0
	_strip.anchor_right = 1.0
	_strip.anchor_top = 1.0
	_strip.anchor_bottom = 1.0
	_strip.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_strip_style = StyleBoxFlat.new()
	_strip_style.bg_color = Color(8 / 255.0, 8 / 255.0, 10 / 255.0, 0.8)
	_strip_style.content_margin_top = 1.25 * REM
	_strip_style.content_margin_bottom = 1.5 * REM
	_strip_style.content_margin_left = 2.0 * REM
	_strip_style.content_margin_right = 2.0 * REM
	_strip.add_theme_stylebox_override("panel", _strip_style)
	add_child(_strip)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", roundi(1.5 * REM))
	_strip.add_child(row)
	var words := VBoxContainer.new()
	words.add_theme_constant_override("separation", 0)
	words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	words.size_flags_vertical = Control.SIZE_SHRINK_END
	row.add_child(words)
	_name = ShellFonts.label("", 1.35 * REM, Color(1, 1, 1), "sans-serif", 900, false, 0.02)
	_name.clip_text = true
	_name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	words.add_child(_name)
	var gap := Control.new()
	gap.custom_minimum_size.y = 0.3 * REM
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	words.add_child(gap)
	_subtitle = ShellFonts.label("", 0.85 * REM, Color(1, 1, 1, 0.72), "sans-serif", 400)
	_subtitle.clip_text = true
	_subtitle.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	words.add_child(_subtitle)
	var gap_status := Control.new()
	gap_status.custom_minimum_size.y = 0.9 * REM
	gap_status.mouse_filter = Control.MOUSE_FILTER_IGNORE
	words.add_child(gap_status)
	_status = ShellFonts.label("", 0.7 * REM, Color(1, 1, 1, 0.58), "sans-serif", 400, false, 0.1, true)
	words.add_child(_status)
	_logo = Spinning.new()
	_logo.texture = UI.logo()
	row.add_child(_logo)
	_subtitle.set_meta("gap", gap)


static func _public_texture(url: String) -> Texture2D:
	var path := UI.repo_path("public/" + url.trim_prefix("/"))
	if not FileAccess.file_exists(path):
		return null
	var image := Image.load_from_file(path)
	if image == null or image.is_empty():
		return null
	return ImageTexture.create_from_image(image)


func setup(image_loader: ImageLoader) -> void:
	loader = image_loader


func open(info: Dictionary = {}) -> void:
	_serial += 1
	var serial := _serial
	_clear_timers()
	if _fade and _fade.is_valid():
		_fade.kill()
	set_info(info)
	_open = true
	phase = "world"
	_render()
	var was_shown := visible and modulate.a > 0.99
	visible = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	move_to_front()
	if not was_shown:
		modulate.a = 0.0
		_fade = CubicBezier.animate(self, func(t: float) -> void: modulate.a = t, 160.0, 0.0, "ease-out")
	_later(POLITIES_AFTER_MS, func() -> void:
		if serial == _serial and phase == "world":
			set_phase("polities"))
	_later(LOADING_CEILING_MS, func() -> void:
		if serial == _serial:
			finish())


func set_info(info: Dictionary) -> void:
	for key in info.keys():
		_info[key] = info[key]
	var game_name := str(_info.get("gameName", ""))
	var scenario_name := str(_info.get("scenarioName", ""))
	var country_name := str(_info.get("countryName", ""))
	_name.text = game_name if not game_name.is_empty() else (scenario_name if not scenario_name.is_empty() else "Open Historia")
	var parts: PackedStringArray = []
	for part in [scenario_name, country_name]:
		if not str(part).is_empty():
			parts.append(str(part))
	_subtitle.text = " · ".join(parts)
	_subtitle.visible = not parts.is_empty()
	(_subtitle.get_meta("gap") as Control).visible = not parts.is_empty()
	var url := str(_info.get("coverUrl", ""))
	if url != _cover_url:
		_cover_url = url
		_cover.texture = null
		_cover.queue_redraw()
		_load_cover(url)


func _load_cover(url: String) -> void:
	if url.is_empty():
		return
	if url.begins_with("/") and not url.begins_with("/api/"):
		var local := _public_texture(url)
		if local:
			_cover.texture = local
			_cover.queue_redraw()
			return
	if loader == null:
		return
	loader.fetch(url, func(texture: Texture2D) -> void:
		if url == _cover_url and texture:
			_cover.texture = texture
			_cover.queue_redraw())


func set_phase(next: String) -> void:
	if not _open or not PHASES.has(next):
		return
	if next == "done":
		finish()
		return
	if phase == "done":
		return
	phase = next
	_render()


func is_open() -> bool:
	return _open


func finish() -> void:
	if not _open:
		return
	_open = false
	phase = "done"
	_clear_timers()
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	if _fade and _fade.is_valid():
		_fade.kill()
	var serial := _serial
	var from := modulate.a
	_fade = CubicBezier.animate(self, func(t: float) -> void: modulate.a = from * (1.0 - t), 450.0, 0.0, "ease", false)
	_fade.finished.connect(func() -> void:
		if serial == _serial and not _open:
			visible = false
			finished.emit())


func close_now() -> void:
	_open = false
	phase = "done"
	_clear_timers()
	if _fade and _fade.is_valid():
		_fade.kill()
	visible = false
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _render() -> void:
	_status.text = str(PHASES.get(phase, PHASES["world"]))


func _later(ms: float, fn: Callable) -> void:
	var timer := get_tree().create_timer(ms / 1000.0)
	timer.timeout.connect(fn)
	_timers.append(timer)


func _clear_timers() -> void:
	for timer in _timers:
		for connection in timer.timeout.get_connections():
			timer.timeout.disconnect(connection["callable"])
	_timers.clear()
