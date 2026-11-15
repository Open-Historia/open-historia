class_name EngineLink
extends Node

signal engine_event(name: String, data: Variant)
signal engine_ready(info: Dictionary)
signal engine_stopped(message: String)
signal unpacking(fraction: float)

class PendingCall extends RefCounted:
	signal done(reply: Dictionary)
	var size := 0
	var method := ""


class StallWatch extends Node:
	const LIMIT_MS := 700
	const LONG_MS := 2500
	const QUIET_MS := 10000
	var link: EngineLink
	var _last := 0
	var _away := false
	var _back_at := 0
	var _slow := 0
	var _slow_ms := 0
	var _noted_at := 0

	func _init(owner_link: EngineLink) -> void:
		link = owner_link
		name = "StallWatch"
		process_mode = Node.PROCESS_MODE_ALWAYS

	func _process(_delta: float) -> void:
		var now := Time.get_ticks_msec()
		if _last == 0:
			_last = now
			return
		if _away:
			_away = false
			if _back_at > 0 and now - _back_at >= LIMIT_MS:
				link.note_stall(now - _back_at, "the first picture after returning to the app took")
			_last = now
			return
		var gap := now - _last
		_last = now
		if gap < LIMIT_MS:
			return
		if gap >= LONG_MS or now - _noted_at >= QUIET_MS:
			link.note_stall(gap, "the screen froze for", _slow, _slow_ms)
			_slow = 0
			_slow_ms = 0
			_noted_at = now
		else:
			_slow += 1
			_slow_ms += gap

	func _notification(what: int) -> void:
		if what == NOTIFICATION_APPLICATION_PAUSED:
			_away = true
			_back_at = 0
			link._on_diagnostic("[android] the app went to the background")
		elif what == NOTIFICATION_APPLICATION_RESUMED:
			_away = true
			_back_at = Time.get_ticks_msec()
			link._on_diagnostic("[android] the app came back to the front")
		elif what == NOTIFICATION_OS_MEMORY_WARNING:
			link._on_diagnostic("[android] Android warned that memory is low (%s)" % link.memory_text())

var devtools: Object
var _sidecar: Sidecar
var _next_id := 0
var _pending := {}
var _diagnostics: PackedStringArray = []
var _started := false
var _inbox: Array[Dictionary] = []

const BACKGROUND_PARSE_CHARS := 262144
const LONG_WORK := ["turn.skip", "turn.retry", "turn.rerun", "turn.applyParked", "turn.intervene"]
const SKIP_TITLE := "Open Historia Native"
const SKIP_RUNNING := "Simulating…"
const SKIP_DONE := "The time skip has finished."
const SKIP_CHANNEL := "Time skips"
const SKIP_DONE_CHANNEL := "Finished time skips"

var _long_calls := {}
var _android: Object
var _trace := false
var _asked_notifications := false
var _speech_relay := 0
var _speech_wired := false


func _ready() -> void:
	_trace = OS.get_name() == "Android" and OS.is_debug_build() and FileAccess.file_exists(OS.get_user_data_dir().path_join("standin-model"))
	set_process(false)
	_sidecar = Sidecar.new()
	add_child(_sidecar)
	_sidecar.message.connect(_on_message)
	_sidecar.diagnostic.connect(_on_diagnostic)
	_sidecar.exited.connect(_on_exited)
	if OS.get_name() == "Android":
		add_child(StallWatch.new(self))


func start() -> bool:
	if OS.get_name() == "Android":
		return _start_android()
	var node := OS.get_environment("OH_NODE")
	if node.is_empty():
		var bundled := UI.repo_path("runtime/node.exe")
		if OS.get_name() != "Windows":
			bundled = UI.repo_path("runtime/node")
		node = bundled if FileAccess.file_exists(bundled) else "node"
	var script := UI.repo_path("native/sidecar/main.mjs")
	var override := OS.get_environment("OH_SIDECAR")
	if not override.is_empty():
		script = override
	return _sidecar.start(node, PackedStringArray([script]), script.get_base_dir(), {})


func _start_android() -> bool:
	var library := str(ClassDB.class_call_static(&"Sidecar", &"library_dir"))
	if library.is_empty():
		_on_diagnostic("[android] the app's native library folder was not found")
		return false
	if AndroidPayload.is_current():
		return _spawn_android(library)
	var payload := AndroidPayload.new()
	add_child(payload)
	payload.progressed.connect(func(fraction: float) -> void: unpacking.emit(fraction))
	payload.finished.connect(func(error: String) -> void:
		if payload.extracted:
			_on_diagnostic("[android] engine files unpacked in %d ms (%s)" % [payload.elapsed_ms, payload.phases])
			unpacking.emit(1.0)
		payload.queue_free()
		if not error.is_empty():
			_on_diagnostic("[android] " + error)
			engine_stopped.emit(error)
			return
		_spawn_android(library))
	payload.begin()
	return true


func _spawn_android(library: String) -> bool:
	var data_root := OS.get_user_data_dir().path_join("data")
	DirAccess.make_dir_recursive_absolute(data_root)
	var environment := {
		"LD_LIBRARY_PATH": library,
		"HOME": OS.get_user_data_dir(),
		"TMPDIR": OS.get_cache_dir(),
		"OH_NATIVE_ROOT": data_root,
		"OH_RUST_FRONTS_HOST": library.path_join("libohfronts.so"),
		"OH_DISCORD_PRESENCE": "0",
		"OH_BUSY_FILE": busy_file(),
	}
	var plugin := android_plugin()
	if plugin and bool(plugin.call("speechAvailable")):
		environment["OH_ANDROID_SPEECH"] = "1"
	if OS.is_debug_build() and FileAccess.file_exists(OS.get_user_data_dir().path_join("standin-model")):
		environment["OH_STANDIN_MODEL"] = "1"
		if FileAccess.file_exists(OS.get_user_data_dir().path_join("ondevice-real")):
			environment["OH_ONDEVICE_REAL"] = "1"
		var delay_file := OS.get_user_data_dir().path_join("standin-delay")
		if FileAccess.file_exists(delay_file) and FileAccess.get_file_as_string(delay_file).strip_edges().is_valid_int():
			environment["OH_STANDIN_DELAY_MS"] = FileAccess.get_file_as_string(delay_file).strip_edges()
	var script := UI.repo_path("native/sidecar/main.mjs")
	_on_diagnostic("[android] starting the engine: %s %s" % [library.path_join("libohnode.so"), script])
	if not _sidecar.start(library.path_join("libohnode.so"), PackedStringArray(["--network-family-autoselection-attempt-timeout=2500", script]), script.get_base_dir(), environment):
		engine_stopped.emit("The game engine could not be started.")
		return false
	return true


func is_ready() -> bool:
	return _started


static func busy_file() -> String:
	return OS.get_cache_dir().path_join("skip-busy.json")


func android_plugin() -> Object:
	if _android == null and OS.get_name() == "Android" and Engine.has_singleton("OpenHistoria"):
		_android = Engine.get_singleton("OpenHistoria")
	return _android


func _skip_started() -> void:
	var plugin := android_plugin()
	if plugin == null:
		return
	plugin.call("skipStart", SKIP_TITLE, tr(SKIP_RUNNING), tr(SKIP_DONE), tr(SKIP_CHANNEL), tr(SKIP_DONE_CHANNEL), busy_file())
	if not _asked_notifications and not bool(plugin.call("notificationsAllowed")):
		_asked_notifications = true
		OS.request_permission("android.permission.POST_NOTIFICATIONS")


func _skip_progress(data: Variant) -> void:
	var plugin := android_plugin()
	if plugin == null or not (data is Dictionary) or not _long_calls.has(int((data as Dictionary).get("call", 0))):
		return
	var progress: Variant = (data as Dictionary).get("progress")
	var text := tr(SKIP_RUNNING)
	if progress is Dictionary and not str((progress as Dictionary).get("label", "")).is_empty():
		var detail := str((progress as Dictionary).get("detail", ""))
		text = "%s…%s" % [tr(str((progress as Dictionary)["label"])), (" (%s)" % detail) if not detail.is_empty() else ""]
	plugin.call("skipUpdate", text)


func _on_speech_system(data: Variant) -> void:
	var plugin := android_plugin()
	if plugin == null or not (data is Dictionary):
		return
	var relay := int((data as Dictionary).get("relay", 0))
	if not _speech_wired:
		_speech_wired = true
		plugin.connect("speech_ready", func() -> void: _speech_event({"type": "ready"}))
		plugin.connect("speech_partial", func(text: String) -> void: _speech_event({"type": "partial", "text": text}))
		plugin.connect("speech_final", func(text: String) -> void: _speech_event({"type": "final", "text": text}))
		plugin.connect("speech_error", func(code: String) -> void: _speech_event({"type": "error", "code": code}))
		plugin.connect("speech_end", func() -> void: _speech_event({"type": "end"}))
	if str((data as Dictionary).get("action", "")) == "start":
		_speech_relay = relay
		plugin.call("speechStart", str((data as Dictionary).get("language", "")))
	elif relay == _speech_relay:
		_speech_relay = 0
		plugin.call("speechStop")


func _speech_event(event: Dictionary) -> void:
	if _speech_relay <= 0:
		return
	var relay := _speech_relay
	if str(event.get("type", "")) in ["error", "end"]:
		_speech_relay = 0
	request("speech.systemEvent", {"relay": relay, "event": event})


func _skip_ended(id: int) -> void:
	_long_calls.erase(id)
	var plugin := android_plugin()
	if plugin and _long_calls.is_empty():
		plugin.call("skipStop")


func recent_diagnostics(count := 12) -> String:
	var start_at: int = max(0, _diagnostics.size() - count)
	return "\n".join(_diagnostics.slice(start_at))


func request(method: String, args: Dictionary = {}) -> Dictionary:
	if method.begins_with("devtools."):
		return {"ok": false, "error": "Only the developer tools window can call %s." % method}
	return await _send(method, args)


func devtools_request(caller: Object, method: String, args: Dictionary = {}) -> Dictionary:
	if not method.begins_with("devtools.") or (method != "devtools.close" and (caller == null or caller != devtools)):
		return {"ok": false, "error": "The developer tools window is not open."}
	return await _send(method, args)


func _send(method: String, args: Dictionary) -> Dictionary:
	_next_id += 1
	var id := _next_id
	var pending := PendingCall.new()
	pending.method = method
	_pending[id] = pending
	var line := JSON.stringify({"id": id, "method": method, "args": args})
	var watcher: Object = devtools if devtools != null and not method.begins_with("devtools.") else null
	if watcher:
		watcher.call("link_request", id, method, args, line.length())
	if not _sidecar.send(line):
		_pending.erase(id)
		var failed := {"ok": false, "error": "The game engine is not running."}
		if watcher and watcher == devtools:
			watcher.call("link_reply", id, failed, 0)
		return failed
	var long := LONG_WORK.has(method) and android_plugin() != null
	if long:
		_long_calls[id] = true
		_skip_started()
	var asked_at := Time.get_ticks_msec()
	var reply: Dictionary = await pending.done
	if _trace:
		print("[engine-call] %s %s in %d ms, %d chars" % [method, "ok" if reply.get("ok", false) else "failed", Time.get_ticks_msec() - asked_at, pending.size])
	if long:
		_skip_ended(id)
	if watcher and watcher == devtools:
		watcher.call("link_reply", id, reply, pending.size)
	return reply


func cancel(id: int) -> void:
	_sidecar.send(JSON.stringify({"id": 0, "method": "cancel", "args": {"call": id}}))


func last_request_id() -> int:
	return _next_id


func stop() -> void:
	_sidecar.stop()


func _on_message(line: String) -> void:
	if _inbox.is_empty() and line.length() < BACKGROUND_PARSE_CHARS:
		_deliver(line, JSON.parse_string(line))
		return
	var entry := {"line": line, "parsed": null, "task": -1}
	if line.length() >= BACKGROUND_PARSE_CHARS:
		entry["task"] = WorkerThreadPool.add_task(_parse_into.bind(entry), OS.get_name() == "Android", "engine message")
	_inbox.append(entry)
	set_process(true)


static func _parse_into(entry: Dictionary) -> void:
	entry["parsed"] = JSON.parse_string(str(entry["line"]))


func _process(_delta: float) -> void:
	_drain(false)


func _drain(wait: bool) -> void:
	while not _inbox.is_empty():
		var entry: Dictionary = _inbox[0]
		var task := int(entry["task"])
		var parsed: Variant = null
		if task >= 0:
			if not wait and not WorkerThreadPool.is_task_completed(task):
				return
			WorkerThreadPool.wait_for_task_completion(task)
			parsed = entry["parsed"]
		else:
			parsed = JSON.parse_string(str(entry["line"]))
		_inbox.pop_front()
		_deliver(str(entry["line"]), parsed)
	set_process(false)


func _exit_tree() -> void:
	for entry in _inbox:
		if int(entry["task"]) >= 0:
			WorkerThreadPool.wait_for_task_completion(int(entry["task"]))
	_inbox.clear()


func _deliver(line: String, parsed: Variant) -> void:
	if typeof(parsed) != TYPE_DICTIONARY:
		return
	var message: Dictionary = parsed
	if message.has("event"):
		var name := str(message["event"])
		if name == "ready":
			_started = true
			if OS.get_name() == "Android":
				print("[engine] ready %d ms after the app started" % Time.get_ticks_msec())
			engine_ready.emit(message.get("data", {}))
		elif name == "turn.progress" and not _long_calls.is_empty():
			_skip_progress(message.get("data"))
		elif name == "speech.system":
			_on_speech_system(message.get("data"))
		if devtools != null and not name.begins_with("devtools."):
			devtools.call("link_event", name, message.get("data"), line.length())
		engine_event.emit(name, message.get("data"))
		return
	var id := int(message.get("id", 0))
	if not _pending.has(id):
		return
	var pending: PendingCall = _pending[id]
	_pending.erase(id)
	pending.size = line.length()
	pending.done.emit(message)


func note_stall(gap: int, what: String, slow := 0, slow_ms := 0) -> void:
	var waiting: PackedStringArray = []
	for pending: PendingCall in _pending.values():
		if not waiting.has(pending.method):
			waiting.append(pending.method)
	var calls: String = ("; waiting on %s" % ", ".join(waiting)) if not waiting.is_empty() else ""
	var before: String = ("; %d slow frames (%.1f s) before it" % [slow, slow_ms / 1000.0]) if slow > 0 else ""
	_on_diagnostic("[stall] %s %d ms%s%s; %s" % [what, gap, calls, before, memory_text()])


func memory_text() -> String:
	var mb := 1048576.0
	var pictures := int(Performance.get_monitor(Performance.RENDER_TEXTURE_MEM_USED) / mb)
	if OS.get_name() == "Android":
		return "pictures %d MB, app %d MB, free %d of %d MB" % [
			pictures,
			_proc_kb("/proc/self/status", "VmRSS:") / 1024,
			_proc_kb("/proc/meminfo", "MemAvailable:") / 1024,
			_proc_kb("/proc/meminfo", "MemTotal:") / 1024,
		]
	var info := OS.get_memory_info()
	return "pictures %d MB, app %d MB, free %d of %d MB" % [
		pictures,
		int(OS.get_static_memory_usage() / mb),
		int(float(info.get("available", -1)) / mb),
		int(float(info.get("physical", -1)) / mb),
	]


static func _proc_kb(path: String, key: String) -> int:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return -1
	while not file.eof_reached():
		var line := file.get_line()
		if line.begins_with(key):
			return line.substr(key.length()).strip_edges().get_slice(" ", 0).to_int()
	return -1


func app_log() -> String:
	var lines: PackedStringArray = []
	lines.append("App: Open Historia Native %s" % str(ProjectSettings.get_setting("application/config/version", "")))
	lines.append("Device: %s, %s %s, %d processors, screen %s" % [OS.get_model_name(), OS.get_name(), OS.get_version(), OS.get_processor_count(), str(DisplayServer.screen_get_size())])
	lines.append("Graphics: %s (%s)" % [RenderingServer.get_video_adapter_name(), RenderingServer.get_video_adapter_vendor()])
	lines.append("Memory now: %s" % memory_text())
	lines.append("")
	lines.append_array(_diagnostics)
	return "\n".join(lines)


func _on_diagnostic(line: String) -> void:
	if OS.get_name() == "Android":
		print("[engine] ", line)
		line = "%s %s" % [Time.get_time_string_from_system(), line]
	_diagnostics.append(line)
	if _diagnostics.size() > 400:
		_diagnostics = _diagnostics.slice(_diagnostics.size() - 200)
	if devtools != null:
		devtools.call("link_diagnostic", line)


func _on_exited(code: int) -> void:
	_drain(true)
	_started = false
	for id in _pending.keys():
		var pending: PendingCall = _pending[id]
		pending.done.emit({"ok": false, "error": "The game engine stopped."})
	_pending.clear()
	engine_stopped.emit("The game engine stopped (code %d).\n%s" % [code, recent_diagnostics()])
