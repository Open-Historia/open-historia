class_name DevToolsPerformance
extends VBoxContainer

const GODOT := [
	["fps", "Frames per second", "count"],
	["frame", "Frame time", "ms"],
	["physics", "Physics time", "ms"],
	["draw_calls", "Draw calls (game window)", "count"],
	["objects_drawn", "Objects drawn", "count"],
	["primitives", "Primitives drawn", "count"],
	["nodes", "Nodes", "count"],
	["orphans", "Orphan nodes", "count"],
	["objects", "Objects", "count"],
	["static_memory", "Memory (static)", "bytes"],
	["video_memory", "Video memory", "bytes"],
	["all_draw_calls", "Draw calls (all windows)", "count"],
]
const SIDECAR := [
	["rss", "Sidecar memory", "bytes"],
	["heap", "JS heap used", "bytes"],
	["lag", "Event-loop lag", "ms"],
	["cpu", "Sidecar CPU", "percent"],
]

var host: DevToolsWindow
var latest := {}
var sidecar_ok := false
var _cards := {}
var _timer: Timer
var _pause: Button
var _status: Label
var _busy := false
var _tick := 0
var _grids: Array[GridContainer] = []


func _init(window: DevToolsWindow) -> void:
	host = window
	name = "Performance"
	add_theme_constant_override("separation", 0)
	var top := DevToolsStyle.bar()
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	_pause = DevToolsStyle.button("Pause", "Stop sampling", true)
	_pause.toggled.connect(func(on: bool) -> void:
		_pause.text = "Resume" if on else "Pause"
		_sync())
	row.add_child(_pause)
	_status = DevToolsStyle.text("Sampled twice a second while this panel is open", 11, DevToolsStyle.FAINT)
	row.add_child(_status)
	top.add_child(row)
	add_child(top)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var pad := MarginContainer.new()
	pad.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in ["left", "right", "top", "bottom"]:
		pad.add_theme_constant_override("margin_" + side, 12)
	var column := VBoxContainer.new()
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_theme_constant_override("separation", 8)
	column.add_child(DevToolsStyle.text("Godot", 11, DevToolsStyle.MUTED, 700))
	column.add_child(_grid(GODOT))
	column.add_child(DevToolsStyle.text("Sidecar", 11, DevToolsStyle.MUTED, 700))
	column.add_child(_grid(SIDECAR))
	pad.add_child(column)
	scroll.add_child(pad)
	add_child(scroll)
	_timer = Timer.new()
	_timer.wait_time = 0.5
	_timer.timeout.connect(sample)
	add_child(_timer)
	visibility_changed.connect(_sync)
	resized.connect(_fit)


func _grid(metrics: Array) -> GridContainer:
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for metric in metrics:
		grid.add_child(_card(metric[0], metric[1]))
	_grids.append(grid)
	return grid


func _card(key: String, title: String) -> Control:
	var card := PanelContainer.new()
	card.name = "Metric_" + key
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	card.add_theme_stylebox_override("panel", UI.box(DevToolsStyle.RAISED, DevToolsStyle.LINE, 6, 1, Vector4(10, 8, 10, 8)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 3)
	column.add_child(DevToolsStyle.text(title, 11, DevToolsStyle.MUTED, 600))
	var value := DevToolsStyle.text("–", 18, DevToolsStyle.INK, 700, true)
	column.add_child(value)
	var note := DevToolsStyle.text("", 10, DevToolsStyle.FAINT)
	column.add_child(note)
	var graph := DevToolsGraph.new()
	column.add_child(graph)
	card.add_child(column)
	_cards[key] = {"value": value, "note": note, "graph": graph}
	return card


func _fit() -> void:
	var columns := clampi(int(size.x / 260.0), 1, 4)
	for grid in _grids:
		grid.columns = columns


func _sync() -> void:
	if not is_inside_tree():
		return
	var running := is_visible_in_tree() and not _pause.button_pressed
	if running and _timer.is_stopped():
		_timer.start()
		sample()
	elif not running:
		_timer.stop()


func stop() -> void:
	_timer.stop()


func sample() -> void:
	_tick += 1
	var root := get_tree().root
	var godot := {
		"fps": Engine.get_frames_per_second(),
		"frame": Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
		"physics": Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0,
		"draw_calls": _drawn(root, Viewport.RENDER_INFO_DRAW_CALLS_IN_FRAME),
		"objects_drawn": _drawn(root, Viewport.RENDER_INFO_OBJECTS_IN_FRAME),
		"primitives": _drawn(root, Viewport.RENDER_INFO_PRIMITIVES_IN_FRAME),
		"nodes": Performance.get_monitor(Performance.OBJECT_NODE_COUNT),
		"orphans": Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT),
		"objects": Performance.get_monitor(Performance.OBJECT_COUNT),
		"static_memory": Performance.get_monitor(Performance.MEMORY_STATIC),
		"video_memory": Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED),
		"all_draw_calls": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
	}
	for key in godot:
		_show(key, float(godot[key]))
	_note("fps", "%.1f ms a frame" % (1000.0 / maxf(1.0, float(godot["fps"]))))
	_note("static_memory", "peak %s" % DevToolsStyle.bytes(Performance.get_monitor(Performance.MEMORY_STATIC_MAX)))
	if _tick % 2 == 1 and not _busy:
		_read_sidecar()


static func _drawn(viewport: Viewport, info: Viewport.RenderInfo) -> float:
	var total := 0
	for kind in [Viewport.RENDER_INFO_TYPE_VISIBLE, Viewport.RENDER_INFO_TYPE_SHADOW, Viewport.RENDER_INFO_TYPE_CANVAS]:
		total += viewport.get_render_info(kind, info)
	return float(total)


func _read_sidecar() -> void:
	_busy = true
	var reply := await host.request("devtools.stats")
	_busy = false
	if not is_inside_tree():
		return
	sidecar_ok = bool(reply.get("ok", false)) and reply.get("result") is Dictionary
	if not sidecar_ok:
		_note("rss", str(reply.get("error", "The sidecar did not answer.")))
		return
	var stats: Dictionary = reply["result"]
	var lag: Dictionary = stats.get("lag", {}) if stats.get("lag") is Dictionary else {}
	_show("rss", float(stats.get("rss", 0)))
	_show("heap", float(stats.get("heapUsed", 0)))
	_show("lag", float(lag.get("mean", 0)))
	_show("cpu", float(stats.get("cpu", 0)))
	_note("rss", "external %s · buffers %s" % [DevToolsStyle.bytes(float(stats.get("external", 0))), DevToolsStyle.bytes(float(stats.get("arrayBuffers", 0)))])
	_note("heap", "of %s allocated" % DevToolsStyle.bytes(float(stats.get("heapTotal", 0))))
	_note("lag", "worst %.1f ms · p99 %.1f ms · loop busy %.0f %%" % [float(lag.get("max", 0)), float(lag.get("p99", 0)), float(stats.get("loopBusy", 0))])
	_note("cpu", "%d active handles · up %d s" % [int(stats.get("handles", 0)), int(stats.get("uptime", 0))])


func _show(key: String, value: float) -> void:
	latest[key] = value
	var card: Dictionary = _cards.get(key, {})
	if card.is_empty():
		return
	(card["graph"] as DevToolsGraph).push(value)
	(card["value"] as Label).text = _format(key, value)


func _note(key: String, text: String) -> void:
	var card: Dictionary = _cards.get(key, {})
	if not card.is_empty():
		(card["note"] as Label).text = text


func _format(key: String, value: float) -> String:
	for metric in GODOT + SIDECAR:
		if metric[0] == key:
			match str(metric[2]):
				"ms":
					return "%.2f ms" % value
				"bytes":
					return DevToolsStyle.bytes(value)
				"percent":
					return "%.1f %%" % value
	if key == "fps":
		return "%d" % int(round(value))
	return "%d" % int(value)
