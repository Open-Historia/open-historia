class_name ShellBoot
extends CanvasLayer

signal door_opening
signal door_opened
signal notice_shown(id: String)
signal notice_closed
signal history_closed

const LAYER := 20
const SETTLE_MARGIN_MS := 150

var engine: EngineLink
var overlay: Control
var startup: StartupScreen
var loading: GameLoadingScreen
var door: VaultDoor
var notice: UpdateNotice
var history: UpdateHistory
var prefs := {}
var door_state := "deciding"
var door_build := ""
var notice_updates: Array = []
var notice_preview := false
var parting := false
var _notice_started := false
var _held := false
var _game_view: CanvasItem
var map_view: MapView
var _settle_serial := 0
var _driven := false


func _init() -> void:
	layer = LAYER
	overlay = Control.new()
	overlay.name = "ShellOverlay"
	overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(overlay)
	startup = StartupScreen.new()
	overlay.add_child(startup)
	loading = GameLoadingScreen.new()
	overlay.add_child(loading)


func setup(link: EngineLink, image_loader: ImageLoader = null, game_view: CanvasItem = null) -> void:
	engine = link
	_game_view = game_view
	loading.setup(image_loader)
	if not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)
	if _game_view and not _game_view.visibility_changed.is_connected(_on_game_view_changed):
		_game_view.visibility_changed.connect(_on_game_view_changed)


func _on_game_view_changed() -> void:
	if _game_view and _game_view.visible and loading.is_open() and not _driven:
		end_game_loading()


func _on_engine_event(event_name: String, data: Variant) -> void:
	if event_name == "shell.prefs" and data is Dictionary:
		for key in (data as Dictionary).keys():
			prefs[key] = (data as Dictionary)[key]
		_share_motion()


func _share_motion() -> void:
	var still := bool(prefs.get("reduceMotion", false))
	MenuSkeleton.reduce_motion = still
	Presence.reduce_motion = still


func _preview_arg() -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--update-notice="):
			return arg.trim_prefix("--update-notice=")
	return ""


func _hold_music(held: bool) -> void:
	if held == _held and not held:
		return
	_held = held
	if engine and engine.is_ready():
		engine.request("audio.hold", {"reason": "door", "held": held})


func prepare() -> void:
	door_state = "deciding"
	_hold_music(true)
	var reply: Dictionary = await engine.request("shell.boot", {"preview": _preview_arg()})
	if not reply.get("ok", false):
		door_state = "open"
		_hold_music(false)
		return
	var result: Dictionary = reply.get("result", {})
	prefs = result.get("prefs", {})
	_share_motion()
	var told: Dictionary = result.get("notice", {})
	notice_updates = told.get("updates", [])
	notice_preview = bool(told.get("preview", false))
	var decided: Dictionary = result.get("door", {})
	if not bool(decided.get("show", false)):
		door_state = "open"
		_hold_music(false)
		return
	door_build = str(decided.get("build", ""))
	door = VaultDoor.new()
	overlay.add_child(door)
	overlay.move_child(door, startup.get_index())
	door.opening.connect(_on_door_opening)
	door.opened.connect(_on_door_opened)
	await door.setup(engine, prefs)
	door_state = "shut"


func reveal() -> void:
	startup.finish()
	if door and is_instance_valid(door) and door_state == "shut":
		overlay.move_child(door, overlay.get_child_count() - 1)
	overlay.move_child(loading, overlay.get_child_count() - 1)
	_maybe_show_notice()


func _on_door_opening() -> void:
	parting = true
	_hold_music(false)
	door_opening.emit()
	_maybe_show_notice()


func _on_door_opened() -> void:
	engine.request("shell.door.opened", {"build": door_build})
	if door and is_instance_valid(door):
		door.queue_free()
	door = null
	door_state = "open"
	_hold_music(false)
	door_opened.emit()
	_maybe_show_notice()


func _maybe_show_notice() -> void:
	if _notice_started or notice_updates.is_empty():
		return
	if not (door_state == "open" or parting):
		return
	_notice_started = true
	notice = UpdateNotice.new()
	overlay.add_child(notice)
	var below := door.get_index() if door and is_instance_valid(door) else loading.get_index()
	overlay.move_child(notice, below)
	notice.closed.connect(_on_notice_closed)
	var updates := notice_updates
	await notice.setup(engine, updates, prefs)
	var first: Dictionary = updates[0] if not updates.is_empty() else {}
	if not notice_preview and not first.is_empty():
		engine.request("shell.notice.shown", {"id": str(first.get("id", ""))})
	notice_shown.emit(str(first.get("id", "")))


func _on_notice_closed() -> void:
	if notice and is_instance_valid(notice):
		notice.queue_free()
	notice = null
	notice_updates = []
	notice_closed.emit()


func open_history() -> void:
	if history and is_instance_valid(history):
		return
	history = UpdateHistory.new()
	overlay.add_child(history)
	overlay.move_child(history, startup.get_index() + 1)
	history.closed.connect(func() -> void:
		if history and is_instance_valid(history):
			history.queue_free()
		history = null
		history_closed.emit())
	await history.setup(engine, prefs)


func close_history() -> void:
	if history and is_instance_valid(history):
		history.queue_free()
	history = null


func door_is_open() -> bool:
	return door_state == "open"


func begin_game_loading(info: Dictionary) -> void:
	_settle_serial += 1
	_driven = true
	loading.open(info)
	overlay.move_child(loading, overlay.get_child_count() - 1)


func update_game_loading(info: Dictionary) -> void:
	if loading.is_open():
		loading.set_info(info)


func refresh_game_loading(game_id: String) -> void:
	if not loading.is_open() or game_id.is_empty():
		return
	var reply: Dictionary = await engine.request("shell.loading.info", {"id": game_id})
	if reply.get("ok", false) and loading.is_open():
		loading.set_info(reply.get("result", {}))


func game_loading_phase(phase: String) -> void:
	loading.set_phase(phase)


func end_game_loading() -> void:
	if not loading.is_open():
		return
	_settle_serial += 1
	var serial := _settle_serial
	await _await_settled(serial)
	if serial == _settle_serial and loading.is_open():
		_driven = false
		loading.finish()


func cancel_game_loading(immediately := false) -> void:
	_settle_serial += 1
	_driven = false
	if immediately:
		loading.close_now()
	else:
		loading.finish()


func _await_settled(serial: int) -> void:
	var tree := get_tree()
	var deadline := Time.get_ticks_msec() + int(GameLoadingScreen.LOADING_CEILING_MS)
	var ready := false
	var idle_since := -1
	await tree.process_frame
	while serial == _settle_serial and loading.is_open() and Time.get_ticks_msec() < deadline:
		var drawn := _polities_drawn()
		if drawn and not ready:
			ready = true
			loading.set_phase("settling")
		var now := Time.get_ticks_msec()
		if not ready or not drawn or _map_moving():
			idle_since = -1
		elif idle_since < 0:
			idle_since = now
		elif now - idle_since > SETTLE_MARGIN_MS:
			await tree.process_frame
			await RenderingServer.frame_post_draw
			return
		await tree.process_frame


func _polities_drawn() -> bool:
	if map_view == null or not is_instance_valid(map_view) or not map_view.visible:
		return true
	if not bool(map_view.get("_ready_to_draw")):
		return false
	var text := map_view.polity_text()
	return text == null or not text.busy()


func _map_moving() -> bool:
	if map_view == null or not is_instance_valid(map_view) or not map_view.visible:
		return false
	var fly: Variant = map_view.get("_fly")
	if fly is Tween and (fly as Tween).is_valid() and (fly as Tween).is_running():
		return true
	return map_view.basemap != null and bool(map_view.basemap.get("_loading"))
