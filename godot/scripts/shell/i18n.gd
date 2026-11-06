class_name I18n
extends Node

signal language_applied(code: String)
signal translations_changed

const PROGRESS_LABEL := "Translating to {{language}}…"
const MODEL_TEXT := {
	"ask": "Playing in {{language}} needs a one-time download of its translation model ({{size}}).",
	"download": "Download",
	"keep_english": "Keep English",
	"cancel": "Cancel",
	"downloading": "Downloading the translation model… {{progress}}%",
	"failed": "The translation model could not be downloaded.",
	"retry": "Try again",
	"unavailable": "The translation model could not be loaded. What it translates stays in English.",
}
const MISSING_LIMIT := 3000
const MODEL_BATCH_STRINGS := 8
const MODEL_BATCH_CHARS := 1200
const NOTICE_SECONDS := 12.0
const SCAN_DEBOUNCE := 0.35
const REM := 16.0
const PILL_LAYER := 15
const CARD_LAYER := 125

signal language_switched(code: String)
signal _card_answer(choice: String)

static var current: I18n

var engine: EngineLink
var language := "en"
var packed := false
var rtl := false
var native_name := ""
var active := false
var book := PhraseBook.new()
var pending := {}
var content_queued := {}
var region_names := {}
var unusable := {}
var missing := {}
var offer: Dictionary = {}
var model_ready := false
var model_failed := false
var model_downloading := false
var prepared_model := ""
var _model_loading := false
var _translation: BookTranslation
var _serial := 0
var _in_flight := false
var _switching := false
var _layer: CanvasLayer
var _pill: PanelContainer
var _pill_label: Label
var _pill_up := false
var _notice_serial := 0
var _queue_timer: Timer
var _rtl_connected := false
var _card_layer: CanvasLayer
var _card_text: Label
var _card_fill: ColorRect
var _card_words: PhraseBook

class BookTranslation extends Translation:
	var owner_ref: WeakRef

	func _get_message(src_message: StringName, _context: StringName = &"") -> StringName:
		var owner := owner_ref.get_ref() as I18n
		if owner == null:
			return &""
		var shown := owner.lookup_value(String(src_message))
		return StringName(shown) if not shown.is_empty() else &""


func _init() -> void:
	name = "I18n"
	current = self
	_queue_timer = Timer.new()
	_queue_timer.one_shot = true
	_queue_timer.wait_time = SCAN_DEBOUNCE
	_queue_timer.timeout.connect(func() -> void: _process_queue())
	add_child(_queue_timer)
	_layer = CanvasLayer.new()
	_layer.layer = PILL_LAYER
	add_child(_layer)
	_pill = PanelContainer.new()
	_pill.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	_pill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_pill.anchor_left = 0.5
	_pill.anchor_right = 0.5
	_pill.anchor_top = 1.0
	_pill.anchor_bottom = 1.0
	_pill.offset_bottom = -5.2 * REM
	_pill.offset_top = -5.2 * REM
	_pill.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_pill.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_pill.add_theme_stylebox_override("panel", UI.box(Color(24 / 255.0, 24 / 255.0, 27 / 255.0, 0.96), Color(1, 1, 1, 0.25), 999, 1, Vector4(0.95 * REM, 0.45 * REM, 0.95 * REM, 0.45 * REM)))
	_pill_label = ShellFonts.label("", 0.8 * REM, Color(1, 1, 1), "sans-serif", 600)
	_pill_label.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	_pill.add_child(_pill_label)
	_pill.visible = false
	_layer.add_child(_pill)


func _exit_tree() -> void:
	if _translation:
		TranslationServer.remove_translation(_translation)
		_translation = null
	if current == self:
		current = null


func start(link: EngineLink) -> void:
	engine = link
	if not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)
	var code := "en"
	var synced: Dictionary = await engine.request("shell.language.sync")
	if synced.get("ok", false):
		code = str(synced["result"].get("code", "en"))
	else:
		var stored: Dictionary = await engine.request("shell.language.get")
		if stored.get("ok", false):
			code = str(stored["result"].get("code", "en"))
	if code != "en" and not await _can_show(code):
		code = "en"
		await engine.request("shell.language.set", {"code": code})
	await apply_language(code)


func activate() -> void:
	if active:
		return
	active = true
	if language == "en":
		return
	var serial := _serial
	if bool(offer.get("has", false)) and str(offer.get("choice", "")) != "yes":
		var kept := await ask_for_model(language)
		if serial != _serial:
			return
		if not kept:
			await switch_language("en")
			return
		model_ready = prepared_model == language
		await _reload_offer()
	_collect_and_translate()


func set_language(code: String) -> void:
	var wanted := code.strip_edges().to_lower()
	if wanted.is_empty():
		wanted = "en"
	if engine:
		await engine.request("shell.language.set", {"code": wanted})
	await apply_language(wanted)


func switch_language(code: String) -> String:
	if _switching or engine == null:
		return language
	_switching = true
	var wanted := code.strip_edges().to_lower()
	if wanted.is_empty():
		wanted = "en"
	if wanted != "en" and not await _can_show(wanted):
		wanted = "en"
	var wanted_offer := await _offer_for(wanted)
	if bool(wanted_offer.get("has", false)) and str(wanted_offer.get("choice", "")) != "yes" and not await ask_for_model(wanted):
		_switching = false
		language_switched.emit(language)
		return language
	if wanted != language:
		await set_language(wanted)
	else:
		await engine.request("shell.language.set", {"code": wanted})
		await _reload_offer()
	model_ready = prepared_model == wanted and wanted != "en"
	_switching = false
	language_switched.emit(language)
	if active and language != "en":
		_collect_and_translate()
	return language


func model_in_use() -> bool:
	return bool(offer.get("has", false)) and str(offer.get("choice", "")) == "yes" and not model_failed


func _can_show(code: String) -> bool:
	var reply: Dictionary = await engine.request("translation.canShow", {"code": code})
	return reply.get("ok", false) and bool(reply["result"].get("ok", false))


func _offer_for(code: String) -> Dictionary:
	if code == "en" or engine == null:
		return {}
	var reply: Dictionary = await engine.request("translation.offer", {"code": code})
	return reply.get("result", {}) if reply.get("ok", false) and reply.get("result") is Dictionary else {}


func _reload_offer() -> void:
	offer = await _offer_for(language)


func apply_language(code: String) -> void:
	_serial += 1
	var serial := _serial
	var wanted := code.strip_edges().to_lower()
	if wanted.is_empty():
		wanted = "en"
	_reset_queue()
	language = wanted
	model_ready = false
	model_failed = false
	model_downloading = false
	_model_loading = false
	if wanted == "en":
		packed = false
		native_name = "English"
		offer = {}
		book = PhraseBook.new()
		_uninstall_translation()
		TranslationServer.set_locale("en")
		_set_rtl(false)
		_refresh_controls()
		language_applied.emit("en")
		return
	var reply: Dictionary = await engine.request("shell.language.pack", {"code": wanted})
	if serial != _serial:
		return
	var fresh_offer := await _offer_for(wanted)
	if serial != _serial:
		return
	offer = fresh_offer
	var info: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {}
	packed = bool(info.get("packed", false))
	native_name = str(info.get("native", wanted))
	book = _book_from(info)
	_install_translation(wanted)
	_set_rtl(bool(info.get("rtl", wanted in ["ar", "he", "fa", "ur"])))
	_refresh_controls()
	language_applied.emit(wanted)


func _book_from(info: Dictionary) -> PhraseBook:
	var fresh := PhraseBook.new()
	var dates: Variant = info.get("dates")
	if dates is Dictionary:
		fresh.date_styles = (dates as Dictionary).get("styles", {})
	var file := str(info.get("file", ""))
	if not file.is_empty() and FileAccess.file_exists(file):
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(file))
		if parsed is Dictionary:
			fresh.set_all(parsed)
	return fresh


func _install_translation(code: String) -> void:
	_uninstall_translation()
	_translation = BookTranslation.new()
	_translation.owner_ref = weakref(self)
	_translation.locale = code
	TranslationServer.add_translation(_translation)
	if is_inside_tree():
		get_tree().root.set_layout_direction(Window.LAYOUT_DIRECTION_LTR)
	TranslationServer.set_locale(code)


func _uninstall_translation() -> void:
	if _translation:
		TranslationServer.remove_translation(_translation)
		_translation = null


func _refresh_controls() -> void:
	if is_inside_tree():
		get_tree().root.propagate_notification(NOTIFICATION_TRANSLATION_CHANGED)
	translations_changed.emit()


func _reset_queue() -> void:
	pending.clear()
	content_queued.clear()
	region_names.clear()
	unusable.clear()
	missing.clear()
	_in_flight = false
	_hide_pill()


func lookup_value(value: String) -> String:
	if language == "en":
		return ""
	var trimmed := value.strip_edges()
	var numeric := PhraseBook.is_numeric_date(trimmed)
	if not numeric and not PhraseBook.is_translatable(trimmed):
		return ""
	var translated: Variant = book.translate(trimmed)
	if translated == null:
		if not numeric:
			_note_unknown(trimmed)
		return ""
	var leading := value.substr(0, value.length() - value.strip_edges(true, false).length())
	var trailing := value.substr(value.strip_edges(false, true).length())
	return leading + str(translated) + trailing


func _note_unknown(trimmed: String) -> void:
	if unusable.has(trimmed):
		return
	if region_names.has(trimmed):
		_queue_content(trimmed)
	elif packed:
		if missing.size() < MISSING_LIMIT:
			missing[trimmed] = true
		return
	elif model_in_use():
		content_queued.erase(trimmed)
		pending[trimmed] = true
		_schedule.call_deferred()


func _queue_content(value: String) -> bool:
	if not model_in_use():
		return false
	var trimmed := value.strip_edges()
	if trimmed.is_empty() or not PhraseBook.is_translatable(trimmed) or book.has_entry(trimmed) or pending.has(trimmed) or unusable.has(trimmed):
		return false
	pending[trimmed] = true
	content_queued[trimmed] = true
	return true


func _schedule() -> void:
	if active and _queue_timer.is_inside_tree() and _queue_timer.is_stopped():
		_queue_timer.start()


func _settle(source: String) -> void:
	pending.erase(source)
	content_queued.erase(source)


func _plan(strings: Array) -> Array:
	var batch: Array = []
	var chars := 0
	for source in strings:
		var text := str(source)
		if batch.size() >= MODEL_BATCH_STRINGS:
			break
		if not batch.is_empty() and chars + text.length() > MODEL_BATCH_CHARS:
			break
		batch.append(text)
		chars += text.length()
	return batch


func _process_queue() -> void:
	if _in_flight or not active or pending.is_empty() or engine == null or not model_in_use():
		return
	_in_flight = true
	var serial := _serial
	while not pending.is_empty() and active and serial == _serial and model_in_use():
		if not model_ready:
			await _ensure_model()
			if not model_ready or serial != _serial:
				break
		var strings := _plan(pending.keys())
		var reply: Dictionary = await engine.request("shell.language.translate", {"code": language, "strings": strings})
		if serial != _serial:
			break
		var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false, "error": str(reply.get("error", "unknown"))}
		if not bool(result.get("ok", false)):
			model_failed = true
			push_warning("[i18n] the translation model stopped (%s); what it would translate stays in English." % str(result.get("error", "unknown")))
			break
		for pair in result.get("pairs", []):
			var entry: Array = pair
			book.set_entry(str(entry[0]), str(entry[1]))
			_settle(str(entry[0]))
		for source in result.get("unusable", []):
			unusable[str(source)] = true
			_settle(str(source))
		_update_progress()
		_refresh_controls()
	if serial == _serial:
		_in_flight = false
	_update_progress()


func _ensure_model() -> void:
	if _model_loading:
		while _model_loading and is_inside_tree():
			await get_tree().process_frame
		return
	_model_loading = true
	var serial := _serial
	var code := language
	model_downloading = not bool(offer.get("cached", false))
	var reply: Dictionary = await engine.request("translation.prepare", {"code": code})
	model_downloading = false
	_model_loading = false
	if serial != _serial:
		return
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false}
	if bool(result.get("ok", false)):
		model_ready = true
		offer["cached"] = true
		_update_progress()
		return
	model_failed = true
	push_warning("[i18n] the translation model is not available (%s); what it would translate stays in English." % str(result.get("error", "unknown")))
	_show_notice(MODEL_TEXT["unavailable"])


func _on_engine_event(event_name: String, data: Variant) -> void:
	match event_name:
		"translation.progress":
			_on_model_progress(data)
		"shell.activeGameChanged":
			if active and language != "en":
				_collect_and_translate()


func _on_model_progress(data: Variant) -> void:
	if not (data is Dictionary):
		return
	var info: Dictionary = data
	var percent := int(info.get("percent", 0))
	if is_instance_valid(_card_text) and is_instance_valid(_card_fill):
		_card_text.text = _say(MODEL_TEXT["downloading"], {"progress": percent}, _card_words)
		_card_fill.anchor_right = clampf(percent / 100.0, 0.0, 1.0)
		return
	if model_downloading and str(info.get("code", "")) == language:
		_show_pill()
		_pill_label.text = _say(MODEL_TEXT["downloading"], {"progress": percent})


func _collect_and_translate() -> void:
	if engine == null:
		return
	var serial := _serial
	var reply: Dictionary = await engine.request("shell.language.content")
	if serial != _serial or not reply.get("ok", false):
		return
	var result: Dictionary = reply["result"]
	for value in result.get("strings", []):
		_queue_content(str(value))
	for value in result.get("regions", []):
		region_names[str(value)] = true
	if pending.size() > 10 and model_in_use():
		_show_pill()
		_update_progress()
	_process_queue()


func _show_pill() -> void:
	_pill_up = true
	_pill.visible = true


func _hide_pill() -> void:
	_pill_up = false
	if _pill:
		_pill.visible = false


func _update_progress() -> void:
	if not _pill_up or model_downloading:
		return
	if pending.is_empty() or is_instance_valid(_card_layer) or not model_in_use():
		_hide_pill()
		return
	var english := PROGRESS_LABEL.replace("{{language}}", native_name)
	var translated: Variant = book.translate(english)
	_pill_label.text = str(translated) if translated != null else english


func _show_notice(english: String) -> void:
	_show_pill()
	var translated: Variant = book.translate(english)
	_pill_label.text = str(translated) if translated != null else english
	_notice_serial += 1
	var serial := _notice_serial
	get_tree().create_timer(NOTICE_SECONDS).timeout.connect(func() -> void:
		if serial == _notice_serial:
			_hide_pill())


func _set_rtl(enabled: bool) -> void:
	rtl = enabled
	if not is_inside_tree():
		return
	var tree := get_tree()
	tree.root.set_layout_direction(Window.LAYOUT_DIRECTION_LTR)
	if enabled and not _rtl_connected:
		tree.node_added.connect(_on_node_added)
		_rtl_connected = true
	elif not enabled and _rtl_connected:
		tree.node_added.disconnect(_on_node_added)
		_rtl_connected = false
	var stack: Array[Node] = [tree.root]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		if node is Control:
			_direct(node as Control)
		for child in node.get_children():
			stack.append(child)


func _on_node_added(node: Node) -> void:
	if node is Control:
		_direct.call_deferred(node)


func _direct(control: Control) -> void:
	if not is_instance_valid(control):
		return
	if rtl:
		var parent := control.get_parent()
		var managed := parent is Container
		var spans := control.anchor_left <= 0.0 and control.anchor_right >= 1.0 and is_equal_approx(control.offset_left, -control.offset_right)
		control.layout_direction = Control.LAYOUT_DIRECTION_RTL if managed or spans else Control.LAYOUT_DIRECTION_LTR
		control.set_meta("oh_rtl", true)
	elif control.has_meta("oh_rtl"):
		control.layout_direction = Control.LAYOUT_DIRECTION_INHERITED
		control.remove_meta("oh_rtl")


func ask_for_model(code: String) -> bool:
	var wanted_offer := await _offer_for(code)
	if not bool(wanted_offer.get("has", false)):
		return true
	var words := await _words_for(code)
	var native := str(wanted_offer.get("native", code))
	var size := str(wanted_offer.get("size", ""))
	var decline_label: String = MODEL_TEXT["keep_english"] if language == "en" or language == code else MODEL_TEXT["cancel"]
	_card_words = words
	_build_card(code, _say(MODEL_TEXT["ask"], {"language": native, "size": size}, words), [[_say(decline_label, {}, words), "decline", false], [_say(MODEL_TEXT["download"], {}, words), "download", true]])
	while true:
		var choice: String = await _card_answer
		if choice == "decline":
			await engine.request("translation.choose", {"code": code, "choice": "no"})
			_remove_card()
			return false
		await engine.request("translation.choose", {"code": code, "choice": "yes"})
		_build_card(code, _say(MODEL_TEXT["downloading"], {"progress": 0}, words), [], true)
		var reply: Dictionary = await engine.request("translation.prepare", {"code": code})
		var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false}
		if bool(result.get("ok", false)):
			prepared_model = code
			_remove_card()
			return true
		push_warning("[i18n] the translation model did not download (%s)." % str(result.get("error", "unknown")))
		_build_card(code, _say(MODEL_TEXT["failed"], {}, words), [[_say(decline_label, {}, words), "decline", false], [_say(MODEL_TEXT["retry"], {}, words), "download", true]])
	return false


func card_shown() -> bool:
	return is_instance_valid(_card_layer)


func card_text() -> String:
	return _card_text.text if is_instance_valid(_card_text) else ""


func answer_card(choice: String) -> void:
	_card_answer.emit(choice)


func _words_for(code: String) -> PhraseBook:
	if code == language:
		return book
	var reply: Dictionary = await engine.request("shell.language.pack", {"code": code})
	var info: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {}
	if not bool(info.get("packed", false)):
		return PhraseBook.new()
	return _book_from(info)


func _say(english: String, slots: Dictionary = {}, words: PhraseBook = null) -> String:
	var filled := english
	for key in slots.keys():
		filled = filled.replace("{{%s}}" % str(key), str(slots[key]))
	var from := words if words != null else book
	var translated: Variant = from.translate(filled)
	return str(translated) if translated != null else filled


func _remove_card() -> void:
	if is_instance_valid(_card_layer):
		_card_layer.queue_free()
	_card_layer = null
	_card_text = null
	_card_fill = null
	_update_progress()


func _card_button(text: String, primary: bool, choice: String) -> Button:
	var button := Button.new()
	button.text = text
	button.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_override("font", ShellFonts.font("sans-serif", 600))
	button.add_theme_font_size_override("font_size", int(round(0.88 * REM)))
	var ink := UiTheme.pick("text", Color("#f4f4f5"))
	var margin := Vector4(0.95 * REM, 0.45 * REM, 0.95 * REM, 0.45 * REM)
	var style := UI.box(ink, ink, 7, 1, margin) if primary else UI.box(Color(0, 0, 0, 0), UiTheme.pick("line", Color(1, 1, 1, 0.25)), 7, 1, margin)
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		button.add_theme_stylebox_override(state, style)
	var label_ink := UiTheme.pick("bg", Color("#0b0b0d")) if primary else UiTheme.pick("text", Color(1, 1, 1, 0.85))
	for key in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		button.add_theme_color_override(key, label_ink)
	button.pressed.connect(func() -> void: _card_answer.emit(choice))
	return button


func _build_card(code: String, text: String, buttons: Array, with_progress := false) -> void:
	if is_instance_valid(_card_layer):
		_card_layer.queue_free()
	_card_layer = CanvasLayer.new()
	_card_layer.layer = CARD_LAYER
	add_child(_card_layer)
	_hide_pill()
	var shade := ColorRect.new()
	shade.color = Color(0, 0, 0, 0.55)
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_STOP
	_card_layer.add_child(shade)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_card_layer.add_child(center)
	var card := PanelContainer.new()
	card.name = "TranslationModelCard"
	card.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	card.layout_direction = Control.LAYOUT_DIRECTION_RTL if code in ["ar", "he", "fa", "ur"] else Control.LAYOUT_DIRECTION_LTR
	var viewport_width := get_viewport().get_visible_rect().size.x if is_inside_tree() else 1440.0
	card.custom_minimum_size.x = minf(26.0 * REM, viewport_width - 2.0 * REM)
	var style := UI.box(UiTheme.pick("surface", Color("#1b1b1e")), UiTheme.pick("line", Color(1, 1, 1, 0.14)), 12, 1, Vector4(1.1 * REM, 1.0 * REM, 1.1 * REM, 1.0 * REM))
	style.shadow_color = Color(0, 0, 0, 0.55)
	style.shadow_size = 24
	style.shadow_offset = Vector2(0, 18)
	card.add_theme_stylebox_override("panel", style)
	center.add_child(card)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", int(round(0.8 * REM)))
	card.add_child(column)
	var size_px := int(round(0.88 * REM))
	_card_text = ShellFonts.label(text, size_px, UiTheme.pick("text", Color("#f4f4f5")), "sans-serif", 400)
	_card_text.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	_card_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_card_text.custom_minimum_size.x = 1
	_card_text.add_theme_constant_override("line_spacing", int(round(size_px * 1.45 - ShellFonts.font("sans-serif", 400).get_height(size_px))))
	column.add_child(_card_text)
	_card_fill = null
	if with_progress:
		var track := Panel.new()
		track.custom_minimum_size.y = 4
		track.clip_contents = true
		track.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.12), Color(0, 0, 0, 0), 2, 0))
		_card_fill = ColorRect.new()
		_card_fill.color = UiTheme.pick("text", Color("#f4f4f5"))
		_card_fill.anchor_bottom = 1.0
		_card_fill.anchor_right = 0.0
		track.add_child(_card_fill)
		column.add_child(track)
	if not buttons.is_empty():
		var actions := HFlowContainer.new()
		actions.alignment = FlowContainer.ALIGNMENT_END
		actions.add_theme_constant_override("h_separation", int(round(0.5 * REM)))
		actions.add_theme_constant_override("v_separation", int(round(0.5 * REM)))
		for entry in buttons:
			actions.add_child(_card_button(str(entry[0]), bool(entry[2]), str(entry[1])))
		column.add_child(actions)


func missing_strings() -> PackedStringArray:
	return PackedStringArray(missing.keys())


static func is_rtl() -> bool:
	return current != null and current.rtl


static func code() -> String:
	return current.language if current else "en"


static func now(text: String) -> String:
	if current == null or current.language == "en" or text.is_empty():
		return text
	var translated: Variant = current.book.translate(text)
	return str(translated) if translated != null else text


static func ui(text: String, params: Dictionary = {}) -> String:
	if current != null and current.language != "en":
		var formatted: Variant = current.book.format(text, params)
		if formatted != null:
			return str(formatted)
	return PhraseBook.fill_slots(text, params)


static func label_name(text: String) -> String:
	if current == null or not current.active or current.language == "en":
		return text
	var known: Variant = current.book.get_exact(text)
	if known != null:
		return str(known)
	if current._queue_content(text):
		current._schedule()
	return text


static func lookup(text: String) -> String:
	if current == null or not current.active or current.language == "en":
		return ""
	var known: Variant = current.book.get_exact(text)
	return str(known) if known != null else ""
