class_name BasemapOffers
extends Control

const PANEL_BG := Color(14 / 255.0, 17 / 255.0, 22 / 255.0, 0.86)
const CARD_BG := Color(14 / 255.0, 17 / 255.0, 22 / 255.0, 0.82)
const PANEL_BORDER := Color(1, 1, 1, 0.10)
const PANEL_INK := Color(239 / 255.0, 242 / 255.0, 246 / 255.0, 0.94)
const BUTTON_BG := Color(1, 1, 1, 0.10)
const BUTTON_BORDER := Color(1, 1, 1, 0.18)
const ACCEPT_BG := Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.28)
const ACCEPT_BORDER := Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.5)
const FAILED_INK := Color("#f3a8a8")
const TRACK := Color(1, 1, 1, 0.10)
const FILL := Color(226 / 255.0, 232 / 255.0, 240 / 255.0, 0.86)
const LOADING_TOAST_DELAY_MS := 700
const LOADING_TOAST_LIMIT_MS := 8000
const TRANSITION_WATCHDOG_MS := 20000
const COVER_TINT := Color(8 / 255.0, 11 / 255.0, 15 / 255.0, 0.24)
const BLUR_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform sampler2D screen_texture : hint_screen_texture, filter_linear, repeat_disable;
uniform vec2 direction = vec2(1.0, 0.0);
uniform float sigma = 7.0;
uniform vec4 tint = vec4(0.0);
void fragment() {
	vec3 sum = vec3(0.0);
	float total = 0.0;
	for (int i = -21; i <= 21; i++) {
		float w = exp(-float(i * i) / (2.0 * sigma * sigma));
		sum += texture(screen_texture, SCREEN_UV + direction * float(i) * SCREEN_PIXEL_SIZE).rgb * w;
		total += w;
	}
	COLOR = vec4(mix(sum / total, tint.rgb, tint.a), 1.0);
}
"""

var extras: Node
var engine: EngineLink
var _offer: Dictionary = {}
var _offer_kind := ""
var _offer_key := ""
var _dismissed := {}
var _phase := "offer"
var _error := ""
var _received := 0.0
var _total := 0.0
var _call := 0
var _more := 0
var _words: Dictionary = {}
var _panel: GlassPanel
var _panel_body: VBoxContainer
var _cover: Control
var _card_bar: ColorRect
var _card_track: Control
var _transition_progress := 0.0
var _transition_target := ""
var _transition_started := 0
var _transition_finishing := 0
var _toast: PanelContainer
var _loading := false
var _loading_since := 0


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func setup(owner_extras: Node) -> void:
	extras = owner_extras
	engine = extras.get("engine")
	_build_toast()
	_panel = GlassPanel.new(PANEL_BG, 12.0, Vector4(14, 12, 14, 12), PANEL_BORDER)
	_panel.anchor_left = 0.5
	_panel.anchor_right = 0.5
	_panel.offset_top = 14
	_panel.custom_minimum_size.x = 340
	_panel.visible = false
	add_child(_panel)
	_panel_body = VBoxContainer.new()
	_panel_body.add_theme_constant_override("separation", 0)
	_panel.add_child(_panel_body)
	_build_cover()


func _build_cover() -> void:
	_cover = Control.new()
	_cover.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_cover.mouse_filter = Control.MOUSE_FILTER_STOP
	_cover.visible = false
	add_child(_cover)
	var shader := Shader.new()
	shader.code = BLUR_SHADER
	for direction: Vector2 in [Vector2(1, 0), Vector2(0, 1)]:
		var copy := BackBufferCopy.new()
		copy.copy_mode = BackBufferCopy.COPY_MODE_VIEWPORT
		_cover.add_child(copy)
		var pass_rect := ColorRect.new()
		pass_rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		pass_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var material := ShaderMaterial.new()
		material.shader = shader
		material.set_shader_parameter("direction", direction)
		material.set_shader_parameter("tint", Vector4(COVER_TINT.r, COVER_TINT.g, COVER_TINT.b, COVER_TINT.a if direction.y > 0.0 else 0.0))
		pass_rect.material = material
		_cover.add_child(pass_rect)
	var centre := CenterContainer.new()
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_cover.add_child(centre)
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(CARD_BG, PANEL_BORDER, 12, 1, Vector4(17, 15, 17, 14)))
	card.custom_minimum_size.x = 238
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	centre.add_child(card)
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 10)
	card.add_child(stack)
	var title := UI.label("Changing basemap…", 13, PANEL_INK, 600)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(title)
	_card_track = Control.new()
	_card_track.custom_minimum_size = Vector2(204, 3)
	_card_track.mouse_filter = Control.MOUSE_FILTER_IGNORE
	stack.add_child(_card_track)
	var track := Panel.new()
	track.add_theme_stylebox_override("panel", UI.box(TRACK, Color(0, 0, 0, 0), 999, 0))
	track.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	track.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_card_track.add_child(track)
	_card_bar = ColorRect.new()
	_card_bar.color = FILL
	_card_bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_card_bar.position = Vector2.ZERO
	_card_bar.size = Vector2(8, 3)
	_card_track.add_child(_card_bar)


func _build_toast() -> void:
	_toast = PanelContainer.new()
	_toast.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.6), Color(0, 0, 0, 0), 20, 0, Vector4(14, 6, 14, 6)))
	_toast.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_toast.anchor_left = 0.5
	_toast.anchor_right = 0.5
	_toast.anchor_top = 1.0
	_toast.anchor_bottom = 1.0
	_toast.visible = false
	var text := UI.label("Loading tiles…", 13, Color("#aaaabb"))
	_toast.add_child(text)
	add_child(_toast)


func show_transition(target: String) -> void:
	_transition_target = target
	_transition_progress = 12.0 if target == "natgeo-dark" else 24.0
	_transition_started = Time.get_ticks_msec()
	_transition_finishing = 0
	_cover.visible = true
	_layout_transition()


func note_transition(progress: float) -> void:
	if not _cover.visible:
		return
	_transition_progress = maxf(_transition_progress, minf(96.0, progress))
	_layout_transition()


func finish_transition() -> void:
	if not _cover.visible or _transition_finishing > 0:
		return
	_transition_progress = 100.0
	_transition_finishing = Time.get_ticks_msec()
	_layout_transition()


func _layout_transition() -> void:
	var width := _card_track.size.x if _card_track.size.x > 0.0 else 204.0
	_card_bar.size = Vector2(width * maxf(4.0, _transition_progress) / 100.0, 3)


func _reference_busy() -> bool:
	var reference: Variant = extras.get("natgeo") if extras else null
	return reference is NatGeoReference and (reference as NatGeoReference).busy()


func set_loading(loading: bool) -> void:
	if loading and not _loading:
		_loading_since = Time.get_ticks_msec()
		note_transition(68.0)
	_loading = loading
	if not loading:
		_toast.visible = false
		note_transition(84.0)
		finish_transition()


func _process(_delta: float) -> void:
	var now := Time.get_ticks_msec()
	if _cover.visible:
		if _transition_finishing > 0 and now - _transition_finishing >= 180:
			_cover.visible = false
			_transition_finishing = 0
		elif now - _transition_started >= TRANSITION_WATCHDOG_MS:
			finish_transition()
		elif _transition_finishing == 0 and now - _transition_started >= 300 and not _loading and not _reference_busy():
			note_transition(84.0)
			finish_transition()
	var showing := _loading and not _cover.visible and now - _loading_since >= LOADING_TOAST_DELAY_MS and now - _loading_since < LOADING_TOAST_DELAY_MS + LOADING_TOAST_LIMIT_MS
	if showing != _toast.visible:
		_toast.visible = showing
	if _toast.visible:
		var width := _toast.get_combined_minimum_size().x
		_toast.offset_left = -width * 0.5
		_toast.offset_right = width * 0.5
		_toast.offset_top = -20 - _toast.get_combined_minimum_size().y
		_toast.offset_bottom = -20
	if _panel.visible:
		var width := minf(340.0, get_viewport_rect().size.x - 32.0)
		_panel.custom_minimum_size.x = width
		_panel.offset_left = -width * 0.5
		_panel.offset_right = width * 0.5


func set_background(background: Dictionary) -> void:
	var missing: Variant = background.get("missing")
	var update: Variant = background.get("update")
	var kind := ""
	var offer: Dictionary = {}
	if missing is Dictionary:
		kind = "missing"
		offer = missing
	elif update is Dictionary:
		kind = "update"
		offer = update
	var key := "%s:%s@%s" % [kind, str(offer.get("id", offer.get("hash", ""))), str(offer.get("version", ""))]
	if kind.is_empty() or _dismissed.has(key):
		_offer = {}
		_offer_kind = ""
		_offer_key = ""
		_panel.visible = false
		return
	_more = int(background.get("moreDetailedMaps", 0)) if kind == "missing" else 0
	if key == _offer_key:
		return
	_offer = offer
	_offer_kind = kind
	_offer_key = key
	_phase = "offer"
	_error = ""
	_received = 0.0
	_total = float(offer.get("bytes", 0))
	_words = {}
	if engine:
		var reply: Dictionary = await engine.request("mapextras.wording", {"offer": offer})
		if key != _offer_key:
			return
		if bool(reply.get("ok", false)) and reply.get("result") is Dictionary:
			_words = reply["result"]
	_render()


func _button(caption: String, accept := false) -> Button:
	var button := Button.new()
	button.text = caption
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var bg := ACCEPT_BG if accept else BUTTON_BG
	var border := ACCEPT_BORDER if accept else BUTTON_BORDER
	var normal := UI.box(bg, border, 8, 1, Vector4(12, 6, 12, 6))
	var hover := UI.box(Color(bg.r, bg.g, bg.b, minf(1.0, bg.a + 0.06)), border, 8, 1, Vector4(12, 6, 12, 6))
	for state in ["normal", "focus"]:
		button.add_theme_stylebox_override(state, normal)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, hover)
	button.add_theme_font_override("font", UI.font(400))
	button.add_theme_font_size_override("font_size", 12)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		button.add_theme_color_override(name, PANEL_INK)
	return button


func _line(text: String, size := 13, alpha := 1.0, weight := 400, colour := PANEL_INK) -> Label:
	var label := UI.wrapped(text, size, Color(colour.r, colour.g, colour.b, colour.a * alpha), weight)
	label.custom_minimum_size.x = 312
	return label


func _gap(height: float) -> Control:
	var gap := Control.new()
	gap.custom_minimum_size.y = height
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return gap


func _render() -> void:
	for child in _panel_body.get_children():
		child.queue_free()
	if _offer.is_empty() or _phase == "dismissed":
		_panel.visible = false
		return
	_panel.visible = true
	var name := str(_offer.get("name", ""))
	if name.is_empty():
		name = "its detailed map"
	if _phase == "downloading":
		_panel_body.add_child(_line("Downloading %s…" % name, 13, 1.0, 600))
		_panel_body.add_child(_gap(8))
		var track := Control.new()
		track.custom_minimum_size = Vector2(312, 4)
		track.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var back := Panel.new()
		back.add_theme_stylebox_override("panel", UI.box(TRACK, Color(0, 0, 0, 0), 999, 0))
		back.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		track.add_child(back)
		var bar := Panel.new()
		bar.add_theme_stylebox_override("panel", UI.box(FILL, Color(0, 0, 0, 0), 999, 0))
		var percent := 8.0 if _total <= 0.0 else minf(100.0, roundf(_received / _total * 100.0))
		bar.size = Vector2(312.0 * percent / 100.0, 4)
		track.add_child(bar)
		_panel_body.add_child(track)
		_panel_body.add_child(_gap(8))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var amount := _format_bytes(_received)
		if amount.is_empty():
			amount = "0 KB"
		if _total > 0.0:
			amount += " of " + _format_bytes(_total)
		var amount_label := UI.label(amount, 13, Color(PANEL_INK.r, PANEL_INK.g, PANEL_INK.b, PANEL_INK.a * 0.75))
		amount_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(amount_label)
		row.add_child(UI.spacer())
		var cancel := _button("Cancel")
		cancel.pressed.connect(func() -> void:
			if engine and _call > 0:
				engine.cancel(_call))
		row.add_child(cancel)
		_panel_body.add_child(row)
		return
	_panel_body.add_child(_line(str(_words.get("title", "")), 13, 1.0, 600))
	_panel_body.add_child(_gap(4))
	_panel_body.add_child(_line(str(_words.get("body", "")), 13, 0.8))
	_panel_body.add_child(_gap(10))
	if _more > 0:
		var more := "This scenario has 1 more detailed map; get it by picking it in Settings → Map." if _more == 1 else "This scenario has %d more detailed maps; get them by picking one in Settings → Map." % _more
		_panel_body.add_child(_line(more, 12, 0.65))
		_panel_body.add_child(_gap(10))
	if _phase == "failed":
		_panel_body.add_child(_line(_error, 13, 1.0, 400, FAILED_INK))
		_panel_body.add_child(_gap(8))
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 8)
	buttons.alignment = BoxContainer.ALIGNMENT_END
	var decline := _button(str(_words.get("decline", "Not now")))
	decline.pressed.connect(_dismiss)
	buttons.add_child(decline)
	var accept: Variant = _words.get("accept")
	var can_download := accept != null and not str(accept).is_empty() and not str(_offer.get("id", "")).is_empty() and int(_offer.get("version", 0)) > 0
	if can_download:
		var download := _button("Try again" if _phase == "failed" else str(accept), true)
		download.pressed.connect(_start)
		buttons.add_child(download)
	_panel_body.add_child(buttons)


func _dismiss() -> void:
	_dismissed[_offer_key] = true
	if _offer_kind == "update" and not bool(_offer.get("needed", false)) and engine:
		engine.request("mapextras.dismissUpdate", {"id": str(_offer.get("id", "")), "version": int(_offer.get("version", 0))})
	_phase = "dismissed"
	_render()


func _start() -> void:
	if not engine:
		return
	_phase = "downloading"
	_error = ""
	_render()
	_call = engine.last_request_id() + 1
	var reply: Dictionary = await engine.request("mapextras.installBasemap", {"id": str(_offer.get("id", "")), "version": int(_offer.get("version", 0))})
	_call = 0
	if bool(reply.get("ok", false)):
		_offer = {}
		_offer_key = ""
		_panel.visible = false
		if extras and extras.has_method("refresh_background"):
			extras.call("refresh_background")
		return
	if bool(reply.get("aborted", false)) or str(reply.get("error", "")) == "Cancelled.":
		_phase = "offer"
		_render()
		return
	_error = str(reply.get("error", ""))
	if _error.is_empty():
		_error = "The download failed."
	_phase = "failed"
	_render()


func on_install_progress(data: Dictionary) -> void:
	if int(data.get("call", -1)) != _call or _phase != "downloading":
		return
	_received = float(data.get("received", 0))
	var total := float(data.get("total", 0))
	if total > 0.0:
		_total = total
	_render()


static func _format_bytes(bytes: float) -> String:
	if not is_finite(bytes) or bytes <= 0.0:
		return ""
	if bytes >= pow(1024.0, 3):
		return "%.1f GB" % (bytes / pow(1024.0, 3))
	if bytes >= pow(1024.0, 2):
		return "%d MB" % int(roundf(bytes / pow(1024.0, 2)))
	return "%d KB" % int(maxf(1.0, roundf(bytes / 1024.0)))
