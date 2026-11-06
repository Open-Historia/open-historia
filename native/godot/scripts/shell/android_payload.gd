class_name AndroidPayload
extends Node

signal finished(error: String)

const SOURCE := "res://android_payload/app.zip"
const STAMP := "res://android_payload/app.stamp"

var elapsed_ms := 0
var extracted := false
var _task := -1
var _error := ""
var _root := ""
var _stamp := ""
var _started_at := 0


static func root() -> String:
	return OS.get_user_data_dir().path_join("app")


func _ready() -> void:
	set_process(false)


func begin() -> void:
	_root = root()
	_stamp = FileAccess.get_file_as_string(STAMP).strip_edges()
	if _stamp.is_empty():
		_finish.call_deferred("The engine files are missing from this build of the app.")
		return
	if FileAccess.get_file_as_string(_root.path_join(".stamp")).strip_edges() == _stamp:
		_finish.call_deferred("")
		return
	_started_at = Time.get_ticks_msec()
	extracted = true
	_task = WorkerThreadPool.add_task(_extract, false, "engine files")
	set_process(true)


func _finish(error: String) -> void:
	finished.emit(error)


func _process(_delta: float) -> void:
	if _task < 0 or not WorkerThreadPool.is_task_completed(_task):
		return
	WorkerThreadPool.wait_for_task_completion(_task)
	_task = -1
	set_process(false)
	elapsed_ms = Time.get_ticks_msec() - _started_at
	finished.emit(_error)


func _exit_tree() -> void:
	if _task >= 0:
		WorkerThreadPool.wait_for_task_completion(_task)
		_task = -1


static func _remove_tree(path: String) -> void:
	var dir := DirAccess.open(path)
	if dir == null:
		return
	dir.include_hidden = true
	for name in dir.get_directories():
		_remove_tree(path.path_join(name))
	for name in dir.get_files():
		DirAccess.remove_absolute(path.path_join(name))
	DirAccess.remove_absolute(path)


func _copy_out(target: String) -> bool:
	var source := FileAccess.open(SOURCE, FileAccess.READ)
	if source == null:
		return false
	var out := FileAccess.open(target, FileAccess.WRITE)
	if out == null:
		return false
	while not source.eof_reached():
		var chunk := source.get_buffer(1 << 20)
		if chunk.is_empty():
			break
		out.store_buffer(chunk)
	out.close()
	source.close()
	return true


func _extract() -> void:
	var local := OS.get_cache_dir().path_join("app.zip")
	if not _copy_out(local):
		_error = "The engine files in this build could not be copied out."
		return
	_remove_tree(_root)
	DirAccess.make_dir_recursive_absolute(_root)
	if FileAccess.file_exists("/system/bin/unzip") and OS.execute("/system/bin/unzip", PackedStringArray(["-o", "-q", local, "-d", _root])) == 0:
		DirAccess.remove_absolute(local)
		_write_stamp()
		return
	var reader := ZIPReader.new()
	if reader.open(local) != OK:
		_error = "The engine files in this build could not be opened."
		DirAccess.remove_absolute(local)
		return
	for entry in reader.get_files():
		var relative := entry.trim_prefix("./")
		if relative.is_empty() or relative.ends_with("/"):
			continue
		var target := _root.path_join(relative)
		DirAccess.make_dir_recursive_absolute(target.get_base_dir())
		var out := FileAccess.open(target, FileAccess.WRITE)
		if out == null:
			_error = "The engine file %s could not be written (%s)." % [relative, error_string(FileAccess.get_open_error())]
			reader.close()
			DirAccess.remove_absolute(local)
			return
		out.store_buffer(reader.read_file(entry))
		out.close()
	reader.close()
	DirAccess.remove_absolute(local)
	_write_stamp()


func _write_stamp() -> void:
	var stamp := FileAccess.open(_root.path_join(".stamp"), FileAccess.WRITE)
	if stamp:
		stamp.store_string(_stamp + "\n")
		stamp.close()
