class_name AdvisorMic
extends MarginContainer

signal heard(text: String)
signal send_requested(text: String)
signal phase_changed(phase: String)

const REM := 16.0
const PROBLEM_SECONDS := 8.0
const SAMPLE_RATE := 16000
const BLOCK_SAMPLES := 1600
const BUS_NAME := "OhAdvisorMic"
const IDLE_INK := Color("#8fa3b3")
const HOVER_INK := Color("#f0f6fa")
const HOVER_BG := Color(1, 1, 1, 0.07)
const ACCENT := Color("#2bc1f3")
const LISTEN_BG := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.14)
const DISABLED_INK := Color("#5d7080")
const NOTE_BG := Color("#14212e")
const NOTE_BORDER := Color(133 / 255.0, 183 / 255.0, 210 / 255.0, 0.3)
const NOTE_INK := Color("#dce7ef")
const PROBLEM_BORDER := Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.55)
const PROBLEM_INK := Color("#fca5a5")
const BUTTON_BORDER := Color(1, 1, 1, 0.25)
const BUTTON_INK := Color("#e4e4e7")
const BUTTON_HOVER_BORDER := Color("#82c8e5")
const PRIMARY_BG := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.16)
const PRIMARY_INK := Color("#e6f8fe")
const TRACK := Color("#192b3b")
const MIC_SVG := "<svg viewBox='0 0 24 24' fill='%s' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><rect x='9' y='3' width='6' height='11' rx='3'/><path d='M5 11a7 7 0 0 0 14 0M12 18v3' fill='none'/></svg>"
const FALLBACK_TEXT := {
	"privacy": "Windows' own speech recognition is off: it needs Online speech recognition turned on in Settings → Privacy & security → Speech.",
	"denied": "macOS has not allowed this app to use its speech recognition.",
	"language": "Your system's speech recognition does not have this language.",
	"failed": "Your system's speech recognition did not start.",
}
const PROBLEM_TEXT := {
	"permission": "The microphone was not allowed.",
	"browser": "This browser's speech recognition is not working. Press the microphone again to use one that runs on this device.",
	"model": "The speech model could not be downloaded or loaded.",
}

var engine: EngineLink
var anchor: Control
var capture_microphone := true
var phase := "idle"
var progress := 0
var problem := ""
var fallback := ""
var disabled := false
var hidden_by_typing := false
var language := ""
var speech_engine := ""
var on_device_engine := ""
var model: Dictionary = {}
var session := 0
var base_text := ""
var input_text := ""

var _turn := 0
var _button: Button
var _note: PanelContainer
var _note_serial := 0
var _hover := false
var _pulse := 0.0
var _player: AudioStreamPlayer
var _capture: AudioEffectCapture
var _mic_open := false
var _resample_position := 0.0
var _resample_previous := 0.0
var _pending := PackedFloat32Array()
var _thread_key := ""
var _probed := false


func _init() -> void:
	name = "AdvisorMic"
	size_flags_vertical = Control.SIZE_SHRINK_END
	add_theme_constant_override("margin_top", int(round(0.3 * REM)))
	add_theme_constant_override("margin_right", int(round(0.3 * REM)))
	add_theme_constant_override("margin_bottom", int(round(0.3 * REM)))
	add_theme_constant_override("margin_left", 0)
	_button = Button.new()
	_button.focus_mode = Control.FOCUS_NONE
	_button.custom_minimum_size = Vector2(2.0 * REM, 2.0 * REM)
	_button.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_button.expand_icon = false
	_button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_button.pressed.connect(press)
	_button.mouse_entered.connect(func() -> void:
		_hover = true
		_style_button())
	_button.mouse_exited.connect(func() -> void:
		_hover = false
		_style_button())
	_button.draw.connect(_draw_pulse)
	add_child(_button)
	visible = false
	_style_button()


func _ready() -> void:
	set_process(false)
	if engine and not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)


func _exit_tree() -> void:
	_end_turn()
	_close_microphone()
	if is_instance_valid(_note):
		_note.queue_free()


func setup(link: EngineLink, host: Control) -> void:
	engine = link
	anchor = host
	if is_inside_tree() and not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)
	if anchor and not anchor.resized.is_connected(_place_note):
		anchor.resized.connect(_place_note)


func probe() -> void:
	if engine == null:
		return
	var reply: Dictionary = await engine.request("speech.engine", {"microphone": capture_microphone_available()})
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {}
	language = str(result.get("language", "en"))
	speech_engine = str(result.get("engine", ""))
	on_device_engine = str(result.get("onDevice", ""))
	model = result.get("model", {}) if result.get("model") is Dictionary else {}
	_probed = true
	_refresh()


func capture_microphone_available() -> bool:
	if not capture_microphone:
		return true
	return bool(ProjectSettings.get_setting("audio/driver/enable_input", false)) and not AudioServer.get_input_device_list().is_empty()


func set_thread(key: String) -> void:
	if key == _thread_key:
		return
	_thread_key = key
	_end_turn()


func set_disabled(value: bool) -> void:
	disabled = value
	_refresh()


func set_hidden_by_typing(value: bool) -> void:
	hidden_by_typing = value
	_refresh()


func set_input_text(text: String) -> void:
	input_text = text


func is_active() -> bool:
	return phase in ["listening", "loading", "finishing"]


func button() -> Button:
	return _button


func note() -> PanelContainer:
	return _note


func press() -> void:
	if is_active():
		if session > 0:
			engine.request("speech.stop", {"session": session})
		return
	if phase == "asking":
		_set_phase("idle")
		return
	if phase != "idle" or disabled:
		return
	fallback = ""
	if speech_engine == "system":
		_listen(speech_engine)
		return
	_press_on_device()


func download() -> void:
	_set_phase("downloading")
	progress = 0
	_render_note()
	var reply: Dictionary = await engine.request("speech.download")
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false}
	if phase != "downloading":
		return
	if bool(result.get("ok", false)):
		_listen(on_device_engine)
	else:
		_set_phase("idle")
		_show_problem(str(result.get("code", "model")))


func cancel_download_prompt() -> void:
	_set_phase("idle")


func feed(samples: PackedFloat32Array) -> void:
	_take(samples)


func _press_on_device() -> void:
	if on_device_engine.is_empty():
		_show_problem("failed")
		return
	if not model.is_empty():
		var reply: Dictionary = await engine.request("speech.ready", {"engine": on_device_engine})
		var ready: bool = reply.get("ok", false) and bool(reply["result"].get("ready", false))
		if not ready:
			problem = ""
			_set_phase("asking")
			return
	_listen(on_device_engine)


func _listen(chosen: String) -> void:
	_turn += 1
	var turn := _turn
	base_text = input_text
	problem = ""
	_set_phase("listening")
	session = -1
	var reply: Dictionary = await engine.request("speech.start", {"engine": chosen, "language": language})
	if turn != _turn:
		var stale := int(reply.get("result", {}).get("session", 0)) if reply.get("ok", false) else 0
		if stale > 0:
			engine.request("speech.stop", {"session": stale})
		return
	if not reply.get("ok", false):
		_set_phase("idle")
		_show_problem("failed")
		return
	session = int(reply["result"].get("session", 0))


func _end_turn() -> void:
	_turn += 1
	if session > 0 and engine:
		engine.request("speech.stop", {"session": session})
	session = 0
	_close_microphone()
	if phase != "idle":
		_set_phase("idle")


func _on_engine_event(event_name: String, data: Variant) -> void:
	if event_name == "speech.progress":
		if phase == "downloading" and data is Dictionary:
			progress = int((data as Dictionary).get("percent", 0))
			_render_note()
		return
	if event_name != "speech.event" or not (data is Dictionary):
		return
	var event: Dictionary = data
	if session <= 0 or int(event.get("session", 0)) != session:
		return
	match str(event.get("type", "")):
		"state":
			_set_phase(str(event.get("state", phase)))
		"microphone":
			if bool(event.get("open", false)):
				_open_microphone()
			else:
				_close_microphone()
		"partial":
			heard.emit(_join(base_text, str(event.get("text", ""))))
		"final":
			var text := str(event.get("text", ""))
			var full := _join(base_text, text)
			_close_microphone()
			_set_phase("idle")
			if not text.is_empty():
				heard.emit(full)
			if bool(event.get("send", false)):
				send_requested.emit(full)
		"error":
			session = 0
			var code := str(event.get("code", "failed"))
			if code == "system":
				fallback = str(event.get("fallback", "")) if event.get("fallback") != null else ""
				if fallback == "absent":
					speech_engine = on_device_engine
				_press_on_device()
				return
			_show_problem(code)


func _join(before: String, text: String) -> String:
	var parts: PackedStringArray = []
	var head := before.rstrip(" \t\n\r")
	if not head.is_empty():
		parts.append(head)
	var tail := text.strip_edges()
	if not tail.is_empty():
		parts.append(tail)
	return " ".join(parts)


func _set_phase(next: String) -> void:
	if phase == next:
		_refresh()
		return
	phase = next
	_refresh()
	phase_changed.emit(phase)


func _show_problem(code: String) -> void:
	problem = code if not code.is_empty() else "failed"
	_note_serial += 1
	var serial := _note_serial
	_refresh()
	if is_inside_tree():
		get_tree().create_timer(PROBLEM_SECONDS).timeout.connect(func() -> void:
			if serial == _note_serial:
				problem = ""
				_refresh())


func _refresh() -> void:
	var shown := _probed and not speech_engine.is_empty()
	visible = shown and not (hidden_by_typing and phase == "idle")
	var active := is_active()
	_button.disabled = not active and phase != "asking" and (disabled or phase == "downloading")
	_button.tooltip_text = "Stop listening" if active else "Speak to the advisor"
	set_process(active or _mic_open)
	_style_button()
	_render_note()


func _style_button() -> void:
	var active := is_active()
	var ink := IDLE_INK
	var bg := Color(0, 0, 0, 0)
	if active:
		ink = UiTheme.pick("accent", ACCENT)
		bg = LISTEN_BG
	elif _button.disabled:
		ink = Color(DISABLED_INK, 0.6)
	elif _hover:
		ink = HOVER_INK
		bg = HOVER_BG
	var style := UI.box(bg, Color(0, 0, 0, 0), 999, 0)
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed", "disabled"]:
		_button.add_theme_stylebox_override(state, style)
	var fill := "#" + ink.to_html(false) if active else "none"
	_button.icon = UI.svg_texture((MIC_SVG % fill).replace("currentColor", "#" + ink.to_html(false)), 18.0 / 24.0, ink.a)
	for key in ["icon_normal_color", "icon_hover_color", "icon_pressed_color", "icon_focus_color", "icon_hover_pressed_color", "icon_disabled_color"]:
		_button.add_theme_color_override(key, Color(1, 1, 1))
	_button.queue_redraw()


func _process(delta: float) -> void:
	if is_active() and not _reduced_motion():
		_pulse = fmod(_pulse + delta / 1.6, 1.0)
		_button.queue_redraw()
	if _mic_open and _capture:
		var frames := _capture.get_frames_available()
		if frames > 0:
			var buffer := _capture.get_buffer(frames)
			var mono := PackedFloat32Array()
			mono.resize(buffer.size())
			for index in range(buffer.size()):
				mono[index] = (buffer[index].x + buffer[index].y) * 0.5
			_take(_resample(mono, AudioServer.get_mix_rate()))


func _reduced_motion() -> bool:
	var tree := get_tree() if is_inside_tree() else null
	var main := tree.root.get_node_or_null("Main") if tree else null
	if main and main.get("map_extras") and main.map_extras.has_method("reduce_motion"):
		return bool(main.map_extras.reduce_motion())
	return false


func _draw_pulse() -> void:
	if not is_active() or _reduced_motion():
		return
	var t := 1.0 - absf(2.0 * _pulse - 1.0)
	var eased := t * t * (3.0 - 2.0 * t)
	var spread := 4.0 * eased
	var alpha := 0.35 * (1.0 - eased)
	if spread < 0.05 or alpha <= 0.0:
		return
	var center := _button.size * 0.5
	var radius := minf(_button.size.x, _button.size.y) * 0.5
	_button.draw_arc(center, radius + spread * 0.5, 0.0, TAU, 64, Color(43 / 255.0, 193 / 255.0, 243 / 255.0, alpha), spread, true)


func _resample(block: PackedFloat32Array, from_rate: float) -> PackedFloat32Array:
	if is_equal_approx(from_rate, SAMPLE_RATE):
		return block
	var step := from_rate / SAMPLE_RATE
	var out := PackedFloat32Array()
	var position := _resample_position
	while position < block.size():
		var index := int(floor(position))
		var fraction := position - index
		var a := _resample_previous if index == 0 else block[index - 1]
		var b := block[index] if index < block.size() else a
		out.append(a + (b - a) * fraction)
		position += step
	_resample_position = position - block.size()
	if block.size() > 0:
		_resample_previous = block[block.size() - 1]
	return out


func _take(samples: PackedFloat32Array) -> void:
	_pending.append_array(samples)
	while _pending.size() >= BLOCK_SAMPLES:
		var block := _pending.slice(0, BLOCK_SAMPLES)
		_pending = _pending.slice(BLOCK_SAMPLES)
		_send_block(block)


func _send_block(block: PackedFloat32Array) -> void:
	if session <= 0 or engine == null:
		return
	var bytes := PackedByteArray()
	bytes.resize(block.size() * 2)
	for index in range(block.size()):
		bytes.encode_s16(index * 2, int(clampf(block[index], -1.0, 1.0) * 32767.0))
	engine.request("speech.audio", {"session": session, "pcm": Marshalls.raw_to_base64(bytes)})


func _open_microphone() -> void:
	_pending = PackedFloat32Array()
	_resample_position = 0.0
	_resample_previous = 0.0
	_mic_open = true
	set_process(true)
	if not capture_microphone:
		return
	if not bool(ProjectSettings.get_setting("audio/driver/enable_input", false)) or AudioServer.get_input_device_list().is_empty():
		if session > 0:
			engine.request("speech.fail", {"session": session, "code": "failed"})
		return
	var bus := AudioServer.get_bus_index(BUS_NAME)
	if bus == -1:
		AudioServer.add_bus()
		bus = AudioServer.bus_count - 1
		AudioServer.set_bus_name(bus, BUS_NAME)
		AudioServer.set_bus_mute(bus, true)
		AudioServer.add_bus_effect(bus, AudioEffectCapture.new())
	_capture = AudioServer.get_bus_effect(bus, 0) as AudioEffectCapture
	_capture.clear_buffer()
	if _player == null:
		_player = AudioStreamPlayer.new()
		_player.stream = AudioStreamMicrophone.new()
		_player.bus = BUS_NAME
		add_child(_player)
	_player.play()


func _close_microphone() -> void:
	_mic_open = false
	_pending = PackedFloat32Array()
	if _player and _player.playing:
		_player.stop()
	if _capture:
		_capture.clear_buffer()
	set_process(is_active())


func _note_style(problem_note: bool) -> StyleBoxFlat:
	var style := UI.box(UiTheme.pick("surface", NOTE_BG), PROBLEM_BORDER if problem_note else UiTheme.pick("line", NOTE_BORDER), 6, 1, Vector4(0.7 * REM, 0.55 * REM, 0.7 * REM, 0.55 * REM))
	style.shadow_color = Color(0, 0, 0, 0.35)
	style.shadow_size = 9
	style.shadow_offset = Vector2(0, 6)
	return style


func _text(text: String, ink: Color) -> Label:
	var label := UI.label(text, int(round(0.8 * REM)), ink)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.custom_minimum_size.x = 1
	var font := UI.font(400)
	label.add_theme_constant_override("line_spacing", int(round(0.8 * REM * 1.45 - font.get_height(int(round(0.8 * REM))))))
	return label


func _note_button(text: String, primary: bool, action: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.custom_minimum_size.y = 2.0 * REM
	button.add_theme_font_override("font", UI.font(400))
	button.add_theme_font_size_override("font_size", int(round(0.8 * REM)))
	var bg := UiTheme.pick("active", PRIMARY_BG) if primary else Color(0, 0, 0, 0)
	var border := UiTheme.pick("accent", ACCENT) if primary else BUTTON_BORDER
	var ink := PRIMARY_INK if primary else BUTTON_INK
	var margin := Vector4(0.7 * REM, 0.25 * REM, 0.7 * REM, 0.25 * REM)
	var rest := UI.box(bg, border, 6, 1, margin)
	var hover := UI.box(bg, BUTTON_HOVER_BORDER, 6, 1, margin)
	for state in ["normal", "focus"]:
		button.add_theme_stylebox_override(state, rest)
	for state in ["hover", "pressed", "hover_pressed"]:
		button.add_theme_stylebox_override(state, hover)
	for key in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		button.add_theme_color_override(key, ink)
	button.pressed.connect(action)
	return button


func _raw(text: String) -> Dictionary:
	return {"text": text}


func note_text() -> String:
	var parts: PackedStringArray = []
	for line in _note_lines():
		parts.append(str((line as Dictionary).get("text", "")) if line is Dictionary else str(line))
	return "
".join(parts)


func _note_lines() -> Array:
	match phase:
		"asking":
			if model.is_empty():
				return []
			var lines: Array = []
			if FALLBACK_TEXT.has(fallback):
				lines.append(FALLBACK_TEXT[fallback])
			lines.append(_raw(I18n.ui("Speech is recognised on this device. It needs a one-time download of the {{modelName}} model ({{size}}).", {"modelName": str(model.get("name", "")), "size": str(model.get("size", ""))})))
			return lines
		"downloading":
			return [_raw(I18n.ui("Downloading the speech model… {{progress}}%", {"progress": progress}))]
		"loading":
			return ["Loading the speech model…"]
		"listening":
			return ["Listening. It sends after 3 seconds of silence."]
		"finishing":
			return ["Writing down what you said…"]
		"idle":
			if problem.is_empty():
				return []
			return [PROBLEM_TEXT.get(problem, "Speech recognition stopped working.")]
	return []


func _render_note() -> void:
	var lines := _note_lines()
	if lines.is_empty():
		if is_instance_valid(_note):
			_note.queue_free()
		_note = null
		return
	if not is_instance_valid(_note):
		_note = PanelContainer.new()
		_note.name = "AdvisorMicNote"
		_note.top_level = true
		_note.z_index = 2
		_note.mouse_filter = Control.MOUSE_FILTER_STOP
		_note.resized.connect(_place_note)
		add_child(_note)
	for child in _note.get_children():
		_note.remove_child(child)
		child.queue_free()
	var problem_note := phase == "idle" and not problem.is_empty()
	_note.add_theme_stylebox_override("panel", _note_style(problem_note))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	_note.add_child(column)
	for line in lines:
		var raw := line is Dictionary
		var label := _text(str((line as Dictionary).get("text", "")) if raw else str(line), PROBLEM_INK if problem_note else NOTE_INK)
		if raw:
			label.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		column.add_child(label)
	if phase == "asking":
		var actions := HBoxContainer.new()
		actions.alignment = BoxContainer.ALIGNMENT_END
		actions.add_theme_constant_override("separation", int(round(0.45 * REM)))
		var gap := Control.new()
		gap.custom_minimum_size.y = 0.5 * REM
		column.add_child(gap)
		actions.add_child(_note_button("Cancel", false, cancel_download_prompt))
		actions.add_child(_note_button("Download", true, download))
		column.add_child(actions)
	elif phase == "downloading":
		var gap := Control.new()
		gap.custom_minimum_size.y = 0.45 * REM
		column.add_child(gap)
		var track := Panel.new()
		track.custom_minimum_size.y = 4
		track.add_theme_stylebox_override("panel", UI.box(TRACK, Color(0, 0, 0, 0), 3, 0))
		track.clip_contents = true
		var fill := ColorRect.new()
		fill.color = UiTheme.pick("accent", ACCENT)
		fill.anchor_bottom = 1.0
		fill.anchor_right = clampf(progress / 100.0, 0.0, 1.0)
		track.add_child(fill)
		column.add_child(track)
	_place_note.call_deferred()


func _place_note() -> void:
	if not is_instance_valid(_note) or anchor == null or not anchor.is_inside_tree():
		return
	var host := anchor.get_global_rect()
	var width := minf(19.0 * REM, host.size.x - 1.4 * REM)
	_note.custom_minimum_size.x = width
	_note.size = Vector2(width, 0)
	_note.reset_size()
	var height := _note.get_combined_minimum_size().y
	_note.size = Vector2(width, height)
	_note.global_position = Vector2(host.position.x + host.size.x - 0.82 * REM - width, host.position.y - 0.35 * REM - height)
