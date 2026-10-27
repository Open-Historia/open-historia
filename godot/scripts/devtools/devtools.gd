class_name DevTools
extends Node

signal opened(window: DevToolsWindow)
signal closed

var engine: EngineLink
var app: Node
var capture: DevToolsLog
var window: DevToolsWindow
var focus_on_open := true


func _init() -> void:
	name = "DevTools"
	process_mode = Node.PROCESS_MODE_ALWAYS


func setup(link: EngineLink, host: Node) -> void:
	engine = link
	app = host
	if capture == null:
		capture = DevToolsLog.new()
		OS.add_logger(capture)


func _exit_tree() -> void:
	close()
	if capture:
		capture.detach()
		OS.remove_logger(capture)
		capture = null


func is_open() -> bool:
	return window != null and is_instance_valid(window) and not window.is_queued_for_deletion()


func toggle() -> void:
	if is_open():
		close()
	else:
		open()


func open() -> DevToolsWindow:
	if is_open():
		window.grab_focus()
		return window
	if engine == null or capture == null:
		return null
	window = DevToolsWindow.new(self, engine, app, capture)
	window.unfocusable = not focus_on_open
	window.close_requested.connect(close)
	add_child(window)
	window.show()
	opened.emit(window)
	return window


func close() -> void:
	if not is_open():
		window = null
		return
	var closing := window
	window = null
	closing.shutdown()
	closing.queue_free()
	closed.emit()
