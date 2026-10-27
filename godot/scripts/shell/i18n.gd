class_name I18n
extends Node

signal language_applied(code: String)
signal translations_changed

const PROGRESS_LABEL := "Translating to {{language}}…"
const PAUSED_TEXT := "Translation paused — check your AI model in Settings → AI"
const MISSING_LIMIT := 3000
const BATCH_MAX_STRINGS := 240
const BATCH_MAX_CHARS := 6000
const BATCH_MIN_STRINGS := 30
const MAX_CONSECUTIVE_FAILURES := 3
const MAX_COOLDOWNS := 2
const COOLDOWN_MS := 60000
const AI_SETTINGS_SETTLE := 4.0
const NOTICE_SECONDS := 12.0
const SCAN_DEBOUNCE := 0.35
const REM := 16.0
const PILL_LAYER := 15

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
var _translation: BookTranslation
var _serial := 0
var _in_flight := false
var _halted := false
var _cooldown_until := 0
var _failure_count := 0
var _cooldown_count := 0
var _waiting := false
var _waiting_until := 0.0
var _last_wait_reason := ""
var _wait_notice_shown := false
var _held_back := false
var _batch_strings := BATCH_MAX_STRINGS
var _layer: CanvasLayer
var _pill: PanelContainer
var _pill_label: Label
var _pill_up := false
var _notice_serial := 0
var _queue_timer: Timer
var _settle_timer: Timer
var _rtl_connected := false


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
	_settle_timer = Timer.new()
	_settle_timer.one_shot = true
	_settle_timer.wait_time = AI_SETTINGS_SETTLE
	_settle_timer.timeout.connect(_on_settings_settled)
	add_child(_settle_timer)
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
	await apply_language(code)


func activate() -> void:
	if active:
		return
	active = true
	if language != "en":
		_collect_and_translate()


func set_language(code: String) -> void:
	var wanted := code.strip_edges().to_lower()
	if wanted.is_empty():
		wanted = "en"
	if engine:
		await engine.request("shell.language.set", {"code": wanted})
	await apply_language(wanted)


func apply_language(code: String) -> void:
	_serial += 1
	var serial := _serial
	var wanted := code.strip_edges().to_lower()
	if wanted.is_empty():
		wanted = "en"
	_reset_queue()
	language = wanted
	if wanted == "en":
		packed = false
		native_name = "English"
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
	var info: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {}
	packed = bool(info.get("packed", false))
	native_name = str(info.get("native", wanted))
	var fresh := PhraseBook.new()
	var dates: Variant = info.get("dates")
	if dates is Dictionary:
		fresh.date_styles = (dates as Dictionary).get("styles", {})
	var file := str(info.get("file", ""))
	if not file.is_empty() and FileAccess.file_exists(file):
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(file))
		if parsed is Dictionary:
			fresh.set_all(parsed)
	if serial != _serial:
		return
	book = fresh
	_install_translation(wanted)
	_set_rtl(bool(info.get("rtl", wanted in ["ar", "he", "fa", "ur"])))
	_refresh_controls()
	language_applied.emit(wanted)
	if active:
		_collect_and_translate()


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
	_halted = false
	_cooldown_until = 0
	_failure_count = 0
	_cooldown_count = 0
	_waiting = false
	_waiting_until = 0.0
	_last_wait_reason = ""
	_wait_notice_shown = false
	_held_back = false
	_batch_strings = BATCH_MAX_STRINGS
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
	else:
		content_queued.erase(trimmed)
		pending[trimmed] = true
	_schedule.call_deferred()


func _queue_content(value: String) -> bool:
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
	var limit := maxi(1, _batch_strings)
	var batch: Array = []
	var chars := 0
	for source in strings:
		var text := str(source)
		if batch.size() >= limit:
			break
		if not batch.is_empty() and chars + text.length() > BATCH_MAX_CHARS:
			break
		batch.append(text)
		chars += text.length()
	return batch


func _now_ms() -> float:
	return Time.get_unix_time_from_system() * 1000.0


func _process_queue() -> void:
	if _in_flight or not active or _halted or pending.is_empty() or Time.get_ticks_msec() < _cooldown_until or engine == null:
		return
	if _waiting:
		if not (_waiting_until > 0.0 and _now_ms() >= _waiting_until):
			return
		_waiting = false
	_in_flight = true
	var serial := _serial
	while not pending.is_empty() and active and not _halted and not _waiting and Time.get_ticks_msec() >= _cooldown_until and serial == _serial:
		var interface: Array = []
		for text in pending.keys():
			if not content_queued.has(text):
				interface.append(text)
		var kind := "interface"
		var strings: Array = []
		if not interface.is_empty():
			strings = _plan(interface)
		else:
			var allowance: Dictionary = await engine.request("shell.language.allowance")
			if serial != _serial:
				break
			var allowed: bool = allowance.get("ok", false) and bool(allowance["result"].get("allowed", false))
			_held_back = not allowed
			if not allowed:
				break
			kind = "content"
			strings = _plan(pending.keys())
		_held_back = false
		var reply: Dictionary = await engine.request("shell.language.translate", {"code": language, "strings": strings, "kind": kind})
		if serial != _serial:
			break
		var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {"ok": false, "error": str(reply.get("error", "unknown")), "failure": {"kind": "transient"}}
		if bool(result.get("ok", false)):
			if _batch_strings < BATCH_MAX_STRINGS:
				_batch_strings = BATCH_MAX_STRINGS
			_failure_count = 0
			_last_wait_reason = ""
			for pair in result.get("pairs", []):
				var entry: Array = pair
				book.set_entry(str(entry[0]), str(entry[1]))
				_settle(str(entry[0]))
			for source in result.get("unusable", []):
				unusable[str(source)] = true
				_settle(str(source))
		else:
			var failure: Dictionary = result.get("failure", {}) if result.get("failure") is Dictionary else {}
			var reason := str(result.get("error", "unknown"))
			if str(failure.get("kind", "")) == "unavailable":
				_wait_for_ai(reason, failure)
			else:
				if bool(result.get("misaligned", false)):
					if strings.size() == 1:
						unusable[str(strings[0])] = true
						_settle(str(strings[0]))
					_batch_strings = maxi(1, int(floor(mini(_batch_strings, strings.size()) / 2.0)))
				else:
					_batch_strings = maxi(BATCH_MIN_STRINGS, int(floor(_batch_strings / 2.0)))
				_note_failure(reason)
		_update_progress()
		_refresh_controls()
	_in_flight = false
	_update_progress()


func _note_failure(reason: String) -> void:
	_failure_count += 1
	if _failure_count < MAX_CONSECUTIVE_FAILURES:
		return
	_failure_count = 0
	_cooldown_count += 1
	if _cooldown_count >= MAX_COOLDOWNS:
		_halted = true
		push_warning("[i18n] translation stopped for this session after repeated failures (%s). Untranslated text stays in English; check the AI provider settings and reload to try again." % reason)
		_show_notice(PAUSED_TEXT)
		return
	_cooldown_until = Time.get_ticks_msec() + COOLDOWN_MS
	push_warning("[i18n] translation paused for 60s after repeated failures (%s). Check the AI provider settings; untranslated text stays in English meanwhile." % reason)
	_hide_pill()
	get_tree().create_timer(COOLDOWN_MS / 1000.0 + 0.05).timeout.connect(func() -> void: _schedule())


func _wait_for_ai(reason: String, failure: Dictionary) -> void:
	_waiting = true
	var until: Variant = failure.get("until")
	_waiting_until = float(until) if until != null else 0.0
	_failure_count = 0
	if reason != _last_wait_reason:
		_last_wait_reason = reason
		push_warning("[i18n] translation is waiting for an AI model that can answer (%s). Untranslated text stays in English; it goes on by itself once a model in Settings → AI can answer." % reason)
	if not _wait_notice_shown:
		_wait_notice_shown = true
		_show_notice(PAUSED_TEXT)
	else:
		_hide_pill()
	if _waiting_until > 0.0:
		var seconds := maxf(0.05, (_waiting_until - _now_ms()) / 1000.0)
		get_tree().create_timer(seconds).timeout.connect(func() -> void: _process_queue())


func _on_settings_settled() -> void:
	if not _waiting or engine == null:
		return
	var reply: Dictionary = await engine.request("shell.language.canAnswer")
	var can_answer: bool = reply.get("ok", false) and bool(reply["result"].get("canAnswer", false))
	if not _waiting:
		return
	if not can_answer and not (_waiting_until > 0.0 and _now_ms() >= _waiting_until):
		return
	_waiting = false
	_process_queue()


func _on_engine_event(event_name: String, _data: Variant) -> void:
	match event_name:
		"shell.fallbackChanged":
			if _waiting:
				_settle_timer.start()
		"shell.activeGameChanged":
			if active and language != "en":
				_collect_and_translate()


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
	if pending.size() > 10 and not _halted:
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
	if not _pill_up or _halted or _waiting:
		return
	if pending.is_empty() or _held_back:
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
