class_name EngineLink
extends Node

signal engine_event(name: String, data: Variant)
signal engine_ready(info: Dictionary)
signal engine_stopped(message: String)

class PendingCall extends RefCounted:
	signal done(reply: Dictionary)

var _sidecar: Sidecar
var _next_id := 0
var _pending := {}
var _diagnostics: PackedStringArray = []
var _started := false


func _ready() -> void:
	_sidecar = Sidecar.new()
	add_child(_sidecar)
	_sidecar.message.connect(_on_message)
	_sidecar.diagnostic.connect(_on_diagnostic)
	_sidecar.exited.connect(_on_exited)


func start() -> bool:
	var node := OS.get_environment("OH_NODE")
	if node.is_empty():
		var bundled := ProjectSettings.globalize_path("res://").path_join("../../runtime/node.exe").simplify_path()
		node = bundled if FileAccess.file_exists(bundled) else "node"
	var script := ProjectSettings.globalize_path("res://").path_join("../sidecar/main.mjs").simplify_path()
	var override := OS.get_environment("OH_SIDECAR")
	if not override.is_empty():
		script = override
	return _sidecar.start(node, PackedStringArray([script]), script.get_base_dir(), {})


func is_ready() -> bool:
	return _started


func recent_diagnostics(count := 12) -> String:
	var start_at: int = max(0, _diagnostics.size() - count)
	return "\n".join(_diagnostics.slice(start_at))


func request(method: String, args: Dictionary = {}) -> Dictionary:
	_next_id += 1
	var id := _next_id
	var pending := PendingCall.new()
	_pending[id] = pending
	if not _sidecar.send(JSON.stringify({"id": id, "method": method, "args": args})):
		_pending.erase(id)
		return {"ok": false, "error": "The game engine is not running."}
	var reply: Dictionary = await pending.done
	return reply


func cancel(id: int) -> void:
	_sidecar.send(JSON.stringify({"id": 0, "method": "cancel", "args": {"call": id}}))


func last_request_id() -> int:
	return _next_id


func stop() -> void:
	_sidecar.stop()


func _on_message(line: String) -> void:
	var parsed: Variant = JSON.parse_string(line)
	if typeof(parsed) != TYPE_DICTIONARY:
		return
	var message: Dictionary = parsed
	if message.has("event"):
		var name := str(message["event"])
		if name == "ready":
			_started = true
			engine_ready.emit(message.get("data", {}))
		engine_event.emit(name, message.get("data"))
		return
	var id := int(message.get("id", 0))
	if not _pending.has(id):
		return
	var pending: PendingCall = _pending[id]
	_pending.erase(id)
	pending.done.emit(message)


func _on_diagnostic(line: String) -> void:
	_diagnostics.append(line)
	if _diagnostics.size() > 400:
		_diagnostics = _diagnostics.slice(_diagnostics.size() - 200)


func _on_exited(code: int) -> void:
	_started = false
	for id in _pending.keys():
		var pending: PendingCall = _pending[id]
		pending.done.emit({"ok": false, "error": "The game engine stopped."})
	_pending.clear()
	engine_stopped.emit("The game engine stopped (code %d).\n%s" % [code, recent_diagnostics()])
