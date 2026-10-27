class_name DevToolsLog
extends Logger

const KEEP := 2000

var listener: Callable
var _mutex := Mutex.new()
var _entries: Array = []
var _seq := 0
var _delivered := 0
var _queued := false


func _log_message(message: String, error: bool) -> void:
	_add("error" if error else "info", message.strip_edges(false, true))


func _log_error(function: String, file: String, line: int, code: String, rationale: String, _editor_notify: bool, error_type: int, _script_backtraces: Array[ScriptBacktrace]) -> void:
	var text := rationale if not rationale.is_empty() else code
	var level := "warning" if error_type == ERROR_TYPE_WARNING else "error"
	var kind := "Shader" if error_type == ERROR_TYPE_SHADER else ("Script" if error_type == ERROR_TYPE_SCRIPT else "")
	var where := "%s (%s:%d)" % [function, file, line] if not function.is_empty() else ""
	_add(level, ("%s error: " % kind if not kind.is_empty() else "") + text + ("\n    at: " + where if not where.is_empty() else ""))


func _add(level: String, text: String) -> void:
	_mutex.lock()
	_seq += 1
	_entries.append({"seq": _seq, "at": Time.get_unix_time_from_system(), "level": level, "source": "godot", "text": text})
	if _entries.size() > KEEP + 200:
		_entries = _entries.slice(_entries.size() - KEEP)
	var deliver := listener.is_valid() and not _queued
	if deliver:
		_queued = true
	_mutex.unlock()
	if deliver:
		_deliver.call_deferred()


func attach(target: Callable) -> Array:
	_mutex.lock()
	var copy := _entries.duplicate()
	_delivered = _seq
	listener = target
	_mutex.unlock()
	return copy


func detach() -> void:
	_mutex.lock()
	listener = Callable()
	_mutex.unlock()


func _deliver() -> void:
	_mutex.lock()
	_queued = false
	var fresh: Array = []
	for index in range(_entries.size() - 1, -1, -1):
		var entry: Dictionary = _entries[index]
		if int(entry["seq"]) <= _delivered:
			break
		fresh.push_front(entry)
	_delivered = _seq
	var target := listener
	_mutex.unlock()
	if target.is_valid() and not fresh.is_empty():
		target.call(fresh)
