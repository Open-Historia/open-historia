class_name WarRoom
extends Control

signal closed
signal shown_changed(open: bool)
signal open_chat(country: String)
signal map_state_changed(state: Dictionary)

const T := preload("res://scripts/ui/war_room_theme.gd")
const W := preload("res://scripts/ui/war_room_words.gd")
const FRAME_BAR := 2.2 * 16.0
const FRAME_STRIP := 0.55 * 16.0
const WIDTH_MIN := 280.0
const WIDTH_DEFAULT := 320.0
const LEFT_CLEARANCE := 23.5 * 16.0
const SLIDE := 0.35
const FIT_SVG := "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'/></svg>"
const CLOSE_SVG := "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.6' stroke-linecap='round'><path d='M5 5l14 14M19 5L5 19'/></svg>"
const SEND_SVG := "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='M5 12h14M13 6l6 6-6 6'/></svg>"
const GLYPH_HEAD := "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'>"
const GLYPHS := {
	"clear": "<circle cx='12' cy='12' r='4.2'/><path d='M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8'/>",
	"rain": "<path d='M7 14.5a4.5 4.5 0 1 1 1.1-8.9A5.5 5.5 0 0 1 18.5 8a3.3 3.3 0 0 1 .2 6.5H7z'/><path d='M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3'/>",
	"storm": "<path d='M7 14a4.5 4.5 0 1 1 1.1-8.9A5.5 5.5 0 0 1 18.5 7.5a3.3 3.3 0 0 1 .2 6.5'/><path d='M12.8 11.5L9.8 16.5h4l-2.6 5'/>",
	"mud": "<path d='M3 15.5c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1 2-1'/><path d='M4 19.5c1.7 0 1.7-1.2 3.4-1.2s1.7 1.2 3.4 1.2 1.7-1.2 3.4-1.2 1.7 1.2 3.4 1.2'/><path d='M8 10.5c0-2 2-4.5 4-6.5 2 2 4 4.5 4 6.5'/>",
	"snow": "<path d='M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9'/><path d='M9.6 4.6L12 6.6l2.4-2M9.6 19.4L12 17.4l2.4 2'/>",
	"blizzard": "<path d='M9 3.5v11M4.2 6.2l9.6 5.6M4.2 11.8l9.6-5.6'/><path d='M3 17.5h11.5a2.5 2.5 0 1 0-2.4-3.2M3 21h15.5a2.5 2.5 0 1 0-2.4-3.2'/>",
	"frost": "<path d='M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6'/><circle cx='12' cy='12' r='2.4'/>",
	"heat": "<circle cx='12' cy='8.5' r='3.8'/><path d='M12 1.8v1.6M5.3 8.5H3.7M20.3 8.5h-1.6M7.3 3.8l1 1M16.7 3.8l-1 1'/><path d='M4 16c1.6-1.2 3.2-1.2 4.8 0s3.2 1.2 4.8 0 3.2-1.2 4.8 0M4 20.5c1.6-1.2 3.2-1.2 4.8 0s3.2 1.2 4.8 0 3.2-1.2 4.8 0'/>",
	"fog": "<path d='M4 8h14M6 12h14M3 16h13M7 20h11'/>",
}

var engine: EngineLink
var map_view: MapView
var store := WarRoomStore.new()
var map_layer: WarRoomMap
var rail: WarRoomRail
var plates: WarRoomPlates

var _open := false
var _view: Dictionary = {}
var _record: Dictionary = {}
var _attacks: Variant = null
var _ways_key := ""
var _ways_seq := 0
var _turn_running := false
var _acting := false
var _notice := ""
var _sending: Dictionary = {}
var _failure: Dictionary = {}
var _took: Array = []
var _say_call := 0
var _rehearsal: Dictionary = {"status": "idle"}
var _rehearse_call := 0
var _rehearsed_name := ""
var _width := WIDTH_DEFAULT
var _resizing := false
var _view_seq := 0
var _cost_seq := 0
var _talk_text := ""
var _poll: Timer
var _drawer_tween: Tween
var _general_trays := {}
var _general_tags := {}
var _plan_trays := {}
var rehearsal_tray: Control

var _bar: PanelContainer
var _bar_name: Label
var _bar_sides: Label
var _bar_date: Label
var _strip_left: PanelContainer
var _strip_bottom: PanelContainer
var _drawer: Control
var _drawer_panel: PanelContainer
var _drawer_column: VBoxContainer
var _tabs_holder: PanelContainer
var _tabs_row: HBoxContainer
var _empty: Control
var _record_column: VBoxContainer
var _status_text: Label
var _sections_panel: PanelContainer
var _sections_scroll: ScrollContainer
var _sections: VBoxContainer
var _talk_panel: PanelContainer
var _talk_scroll: ScrollContainer
var _talk_column: VBoxContainer
var _talk_input: TextEdit
var _send: Button
var _handle: Control
var _handle_bar: ColorRect
var _status_holder: PanelContainer


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	visible = false
	map_layer = WarRoomMap.new()
	add_child(map_layer)
	_build_frame()
	rail = WarRoomRail.new()
	add_child(rail)
	plates = WarRoomPlates.new()
	add_child(plates)
	_build_drawer()
	_poll = Timer.new()
	_poll.wait_time = 0.8
	_poll.timeout.connect(_poll_turn)
	add_child(_poll)


func setup(engine_link: EngineLink, context: Dictionary = {}) -> void:
	engine = engine_link
	map_view = context.get("map_view") as MapView
	if map_view:
		map_layer.setup(map_view, store)
	rail.setup(store)
	plates.setup(store)
	store.changed.connect(_on_store)
	store.changed.connect(_announce_map_state)
	store.way_drawn.connect(_on_way)
	rail.order.connect(_order_picked)
	rail.release.connect(_release_picked)
	rail.withdraw.connect(_withdraw_picked)
	rail.send_back.connect(func() -> void: _act({"op": "return", "battlefield": _name()}))
	rail.carrier.connect(func(medium: String) -> void: store.take_tool("transport", {"medium": medium}))
	rail.fleets_toggled.connect(func() -> void: store.set_values({"fleets": not bool(store.value("fleets"))}))
	rail.supply_toggled.connect(func() -> void: store.set_values({"supply": not bool(store.value("supply"))}))
	rail.cleared.connect(func() -> void: store.set_values({"selected": []}))
	plates.fortify_level.connect(func(level: int) -> void: store.set_values({"level": level}))
	plates.fortify_confirm.connect(_build_line)
	plates.fortify_redraw.connect(func() -> void: store.take_tool("fortify"))
	plates.fortify_cancel.connect(func() -> void: store.set_values({"draft": null}))
	plates.fleet_pick.connect(_pick_fleet)
	plates.fleet_order.connect(func(op: Dictionary) -> void: _order_with("warroom.fleet", op))
	plates.fleet_place.connect(func(kind: String) -> void: store.take_tool("fleet", {"station": kind}))
	plates.fleets_close.connect(func() -> void: store.set_values({"fleets": false}))
	if engine:
		var reply: Dictionary = await engine.request("warroom.width")
		if reply.get("ok", false) and float(reply.get("result", 0)) > 0.0:
			_width = _clamp_width(float(reply["result"]))
	_layout()


func is_open() -> bool:
	return _open


func map_state() -> Dictionary:
	var ways: Variant = store.value("transport_ways")
	return {"open": bool(store.value("open")), "battlefield": str(store.value("battlefield")), "side": int(store.value("side")), "highlight": int(store.value("highlight")), "selected": (store.value("selected") as Array).duplicate(), "transport_ways": (ways as Dictionary).duplicate(true) if ways is Dictionary else null}


func _announce_map_state(keys: PackedStringArray) -> void:
	for key in ["open", "battlefield", "side", "highlight", "selected", "transport_ways"]:
		if key in keys:
			map_state_changed.emit(map_state())
			return


func open() -> void:
	set_open(true)


func close() -> void:
	set_open(false)


func toggle() -> void:
	set_open(not _open)


func set_open(value: bool) -> void:
	if value == _open:
		return
	_open = value
	if value:
		visible = true
		_notice = ""
		_rehearsal = {"status": "idle"}
		_layout()
		_drawer.offset_left = 0.0
		_drawer.offset_right = _width
		_slide(true)
		_poll.start()
		shown_changed.emit(true)
		await refresh()
		if not _open:
			return
		var fronts: Array = _view.get("fronts", [])
		if fronts.is_empty():
			close()
			return
		var front := str(_view.get("front", ""))
		store.open_room(front, int(_view.get("side", -1)))
		store.set_values({"deploy_form": str(_record.get("deployForm", "front"))})
		_sync_store_from_view()
		_render()
	else:
		_poll.stop()
		if _say_call > 0:
			engine.cancel(_say_call)
			_say_call = 0
			_sending = {}
		if _rehearse_call > 0:
			engine.cancel(_rehearse_call)
			_rehearse_call = 0
		store.close_room()
		_slide(false)
		shown_changed.emit(false)
		closed.emit()


func _slide(opening: bool) -> void:
	if _drawer_tween and _drawer_tween.is_valid():
		_drawer_tween.kill()
	_drawer_tween = create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	_drawer_tween.tween_property(_drawer, "offset_left", -_width if opening else 0.0, SLIDE)
	_drawer_tween.tween_property(_drawer, "offset_right", 0.0 if opening else _width, SLIDE)
	if not opening:
		_drawer_tween.chain().tween_callback(func() -> void:
			if not _open:
				visible = false)


func _name() -> String:
	return str(_record.get("name", ""))


func _side() -> int:
	return int(_view.get("side", -1))


func refresh() -> void:
	if not engine:
		return
	_view_seq += 1
	var seq := _view_seq
	var reply: Dictionary = await engine.request("warroom.view", {"battlefield": str(store.value("battlefield"))})
	if seq != _view_seq or not reply.get("ok", false):
		return
	_view = reply.get("result", {})
	_turn_running = bool(_view.get("busy", false))
	var record: Variant = _view.get("record")
	_record = record if typeof(record) == TYPE_DICTIONARY else {}
	if _open:
		var fronts: Array = _view.get("fronts", [])
		if fronts.is_empty() and bool(store.value("open")):
			close()
			return
		if bool(store.value("open")):
			store.show_battlefield(str(_view.get("front", "")), _side())
		_sync_store_from_view()
		_render()
		_fetch_ways()


func _sync_store_from_view() -> void:
	var plans: Array = (_record.get("mapPlans", []) as Array).duplicate()
	var deploy: Variant = _record.get("deploy")
	if typeof(deploy) == TYPE_DICTIONARY:
		var line: Dictionary = deploy
		plans.append({"id": "deploy", "kind": "deploy", "form": str(line.get("form", "front")), "ways": [line.get("way", [])], "picked": [], "troops": 0})
	var intel: Dictionary = _record.get("intel", {})
	store.set_values({"plans": plans, "known": intel.get("plans", [])})
	map_layer.set_record(_record)
	if _rehearsed_name != _name():
		if _rehearse_call > 0:
			engine.cancel(_rehearse_call)
			_rehearse_call = 0
		_rehearsal = {"status": "idle"}
		store.set_values({"rehearsal_shade": null})
		_rehearsed_name = _name()


func _fetch_ways() -> void:
	if _record.is_empty():
		_attacks = null
		return
	var key := "%s|%s|%s" % [_name(), str(_record.get("ordersKey", "")), str(_record.get("waiting", ""))]
	if key == _ways_key:
		return
	_ways_key = key
	_ways_seq += 1
	var seq := _ways_seq
	var reply: Dictionary = await engine.request("warroom.ways", {"battlefield": _name()})
	if seq != _ways_seq or not _open:
		return
	if not reply.get("ok", false):
		_attacks = null
		store.set_values({"transport_ways": null})
		return
	var result: Dictionary = reply.get("result", {})
	_attacks = result.get("attacks")
	store.set_values({"transport_ways": result.get("ways") if not str(_record.get("waiting", "")).is_empty() else null})
	_render_sections()


func _poll_turn() -> void:
	if not engine or not _open:
		return
	var reply: Dictionary = await engine.request("warroom.busy")
	if not reply.get("ok", false):
		return
	var running := bool(reply.get("result", false))
	if running == _turn_running:
		return
	var landed := _turn_running and not running
	_turn_running = running
	_render()
	if landed:
		await refresh()


func _locked() -> bool:
	return _turn_running or _acting


func _act(op: Dictionary) -> bool:
	return await _send_op("warroom.op", op)


func _order_with(method: String, op: Dictionary) -> bool:
	return await _send_op(method, op)


func _send_op(method: String, op: Dictionary) -> bool:
	_acting = true
	_notice = ""
	_render_rail()
	var reply: Dictionary = await engine.request(method, {"op": op})
	_acting = false
	if not reply.get("ok", false):
		_notice = str(reply.get("error", ""))
		_render_rail()
		return false
	await refresh()
	return true


func _on_way(tool: String, way: Array, extra: Dictionary) -> void:
	var name := _name()
	if not _open or name.is_empty():
		return
	var selected: Array = store.value("selected")
	match tool:
		"route":
			if await _act({"op": "route", "battlefield": name, "troops": selected, "way": way}):
				store.set_values({"selected": []})
		"diversion":
			await _act({"op": "diversion", "battlefield": name, "way": way, "troops": selected.size() if selected.size() > 0 else int(_view.get("spearhead", 44))})
		"deploy":
			var op := {"op": "deploy", "battlefield": name, "way": way, "countText": str(store.value("deploy_count"))}
			if str(extra.get("form", "")) == "swarm":
				op["form"] = "swarm"
			if await _act(op):
				store.set_values({"tool": "pan"})
		"replan":
			if not str(extra.get("replan", "")).is_empty():
				await _act({"op": "plan", "battlefield": name, "project": str(extra["replan"]), "way": way})
		"transport":
			if not str(extra.get("medium", "")).is_empty() and not way.is_empty():
				var place: Array = way[0]
				if await _act({"op": "transport", "battlefield": name, "troops": selected, "medium": str(extra["medium"]), "to": [place[0], place[1]]}):
					store.set_values({"selected": []})
		"fortify":
			store.set_values({"draft": way})
		"fleet":
			if not str(extra.get("fleet", "")).is_empty() and not way.is_empty():
				await _order_with("warroom.fleet", {"op": "station", "unit": str(extra["fleet"]), "to": way[0], "order": "patrol" if str(extra.get("station", "")) == "patrol" else "move"})


func _build_line(title: String) -> void:
	var draft: Variant = store.value("draft")
	if not (draft is Array):
		return
	if await _order_with("warroom.fortify", {"op": "fortify", "points": draft, "level": int(store.value("level")), "name": title}):
		store.set_values({"draft": null})


func _order_picked(order: String) -> void:
	if await _act({"op": "order", "battlefield": _name(), "troops": store.value("selected"), "order": order}):
		store.set_values({"selected": []})


func _release_picked() -> void:
	if await _act({"op": "release", "battlefield": _name(), "troops": store.value("selected")}):
		store.set_values({"selected": []})


func _withdraw_picked() -> void:
	var selected: Array = store.value("selected")
	var troops: Array = selected if not selected.is_empty() else _record.get("ownTroops", [])
	if troops.size() > 0 and await _act({"op": "order", "battlefield": _name(), "troops": troops, "order": "withdraw"}):
		store.set_values({"selected": []})


func _pick_fleet(id: String) -> void:
	store.set_values({"fleet": id, "fleets": true})


func _on_store(keys: PackedStringArray) -> void:
	if not _open:
		return
	if "highlight" in keys:
		_restyle_generals()
	if "pointed" in keys:
		_restyle_plans()
	if "draft" in keys or "level" in keys:
		var draft: Variant = store.value("draft")
		if draft is Array:
			_fetch_cost()
		else:
			plates.reset_name()
			plates.set_cost({})
	if "supply" in keys and bool(store.value("supply")):
		_fetch_supply()
	if "supply" in keys and not bool(store.value("supply")):
		store.set_values({"supply_shade": null})
	if "selected" in keys or "tool" in keys or "fleets" in keys or "draft" in keys:
		_render_rail()
	if "battlefield" in keys and bool(store.value("open")) and str(store.value("battlefield")) != _name():
		refresh()


func _fetch_cost() -> void:
	_cost_seq += 1
	var seq := _cost_seq
	var reply: Dictionary = await engine.request("warroom.cost", {"points": store.value("draft"), "level": int(store.value("level"))})
	if seq != _cost_seq or not reply.get("ok", false):
		return
	plates.set_cost(reply.get("result", {}))


var _supply_areas: Variant = null


func _fetch_supply() -> void:
	var reply: Dictionary = await engine.request("warroom.supply", {"battlefield": _name()})
	if not reply.get("ok", false) or not bool(store.value("supply")):
		return
	var result: Dictionary = reply.get("result", {})
	_supply_areas = result.get("areas")
	store.set_values({"supply_shade": result.get("runs", [])})
	_render_rail()


func _input(event: InputEvent) -> void:
	if not _open or not (event is InputEventKey):
		return
	var key := event as InputEventKey
	if not key.pressed or key.echo or key.keycode != KEY_ESCAPE:
		return
	if str(store.value("tool")) != "pan":
		map_layer.cancel_drawing()
		store.take_tool("pan")
		get_viewport().set_input_as_handled()
		return
	var focus := get_viewport().gui_get_focus_owner()
	if focus is TextEdit or focus is LineEdit:
		return
	get_viewport().set_input_as_handled()
	close()


func _clamp_width(px: float) -> float:
	var viewport_width := get_viewport_rect().size.x if is_inside_tree() else 1440.0
	var most: float = maxf(viewport_width - LEFT_CLEARANCE, minf(WIDTH_DEFAULT, viewport_width - 16.0))
	return roundf(minf(maxf(px, minf(WIDTH_MIN, most)), most))


func _apply_width(px: float) -> void:
	_width = _clamp_width(px)
	_layout()


func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED:
		_layout()


func _layout() -> void:
	if not _drawer:
		return
	if _open and not (_drawer_tween and _drawer_tween.is_valid() and _drawer_tween.is_running()):
		_drawer.offset_left = -_width
		_drawer.offset_right = 0.0
	elif not _open:
		_drawer.offset_left = 0.0
		_drawer.offset_right = _width
	_bar.offset_right = -_width
	_strip_bottom.offset_right = -_width
	store.set_values({"cover": int(round(_width)) if _open else 0})
	_size_sections()
	_render_rail()


func _plate_panel(edges: Array, widths: Vector4, margins := Vector4(0, 0, 0, 0)) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
	panel.add_theme_stylebox_override("panel", T.plate_style(edges, widths, margins))
	return panel


func _build_frame() -> void:
	var none := Color(0, 0, 0, 0)
	_bar = _plate_panel([none, none, none, T.SEAM], Vector4(0, 0, 0, 2), Vector4(T.px(1.5), 0, T.px(1.5), 2))
	var bar_style := _bar.get_theme_stylebox("panel") as WarRoomTheme.Bevel
	T.add_rivet(bar_style, "bottom-left", T.px(0.45), T.px(0.75))
	T.add_rivet(bar_style, "bottom-right", T.px(0.45), T.px(0.75))
	_bar.anchor_left = 0.0
	_bar.anchor_right = 1.0
	_bar.offset_left = 0.0
	_bar.offset_top = 0.0
	_bar.offset_bottom = FRAME_BAR
	_bar.mouse_filter = Control.MOUSE_FILTER_STOP
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", int(round(T.px(0.8))))
	row.alignment = BoxContainer.ALIGNMENT_BEGIN
	_bar_name = T.stencil("", 1.0, T.BONE, 0.2)
	_bar_name.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(_bar_name)
	_bar_sides = T.stencil("", 0.74, T.BONE_SOFT)
	_bar_sides.clip_text = true
	_bar_sides.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_bar_sides.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_bar_sides.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_bar_sides.size_flags_stretch_ratio = 1.0
	row.add_child(_bar_sides)
	_bar_date = T.stencil("", 0.8)
	_bar_date.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(_bar_date)
	_bar.add_child(row)
	add_child(_bar)
	_strip_left = _plate_panel([none, none, T.SEAM, none], Vector4(0, 0, 2, 0))
	_strip_left.anchor_top = 0.0
	_strip_left.anchor_bottom = 1.0
	_strip_left.offset_top = FRAME_BAR
	_strip_left.offset_bottom = 0.0
	_strip_left.offset_left = 0.0
	_strip_left.offset_right = FRAME_STRIP
	_strip_left.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_strip_left)
	_strip_bottom = _plate_panel([none, T.SEAM, none, none], Vector4(0, 2, 0, 0))
	_strip_bottom.anchor_left = 0.0
	_strip_bottom.anchor_right = 1.0
	_strip_bottom.anchor_top = 1.0
	_strip_bottom.anchor_bottom = 1.0
	_strip_bottom.offset_top = -FRAME_STRIP
	_strip_bottom.offset_bottom = 0.0
	_strip_bottom.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_strip_bottom)


func _build_drawer() -> void:
	var none := Color(0, 0, 0, 0)
	_drawer = Control.new()
	_drawer_panel = PanelContainer.new()
	_drawer_panel.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
	var style := T.plate_style([T.SEAM, none, none, none], Vector4(3, 0, 0, 0), Vector4(3, 0, 0, 0))
	style.inner_left = T.LIP
	_drawer_panel.add_theme_stylebox_override("panel", style)
	_drawer_panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_drawer_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	_drawer.add_child(_drawer_panel)
	_drawer.anchor_left = 1.0
	_drawer.anchor_right = 1.0
	_drawer.anchor_top = 0.0
	_drawer.anchor_bottom = 1.0
	_drawer.offset_left = 0.0
	_drawer.offset_right = _width
	_drawer.offset_top = 0.0
	_drawer.offset_bottom = 0.0
	_drawer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_drawer.clip_contents = true
	add_child(_drawer)
	_drawer_column = VBoxContainer.new()
	_drawer_column.add_theme_constant_override("separation", 0)
	_drawer_panel.add_child(_drawer_column)
	_build_head()
	_tabs_holder = PanelContainer.new()
	var tabs_style := T.bevel(Color(0, 0, 0, 0.26), [none, none, none, T.SEAM], Vector4(0, 0, 0, 1), Vector4(T.px(0.7), T.px(0.45), T.px(0.7), T.px(0.45) + 1.0))
	_tabs_holder.add_theme_stylebox_override("panel", tabs_style)
	var tabs_scroll := ScrollContainer.new()
	tabs_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	tabs_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	_tabs_row = HBoxContainer.new()
	_tabs_row.add_theme_constant_override("separation", int(round(T.px(0.3))))
	tabs_scroll.add_child(_tabs_row)
	_tabs_holder.add_child(tabs_scroll)
	_tabs_holder.visible = false
	_drawer_column.add_child(_tabs_holder)
	var empty_label := T.text("Your troops are on no battlefield.", 0.85, T.BONE_SOFT)
	empty_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_empty = T.pad(empty_label, Vector4(T.px(1.0), T.px(1.5), T.px(1.0), T.px(1.5)))
	_empty.visible = false
	_drawer_column.add_child(_empty)
	_record_column = VBoxContainer.new()
	_record_column.add_theme_constant_override("separation", 0)
	_record_column.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_record_column.visible = false
	_record_column.resized.connect(_size_sections)
	_drawer_column.add_child(_record_column)
	_status_holder = PanelContainer.new()
	_status_holder.add_theme_stylebox_override("panel", T.bevel(none, [none, none, none, T.SEAM], Vector4(0, 0, 0, 1), Vector4(T.px(0.8), T.px(0.5), T.px(0.8), T.px(0.5) + 1.0)))
	_status_text = T.soft("")
	_status_holder.add_child(_status_text)
	_record_column.add_child(_status_holder)
	_record_column.add_child(_lip())
	_sections_panel = PanelContainer.new()
	_sections_panel.add_theme_stylebox_override("panel", T.bevel(none, [none, none, none, T.SEAM], Vector4(0, 0, 0, 2), Vector4(0, 0, 0, 2)))
	_sections_panel.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	_sections_scroll = ScrollContainer.new()
	_sections_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var sections_margin := MarginContainer.new()
	sections_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", T.px(0.8)], ["margin_right", T.px(0.8)], ["margin_top", T.px(0.7)], ["margin_bottom", T.px(0.8)]]:
		sections_margin.add_theme_constant_override(side[0], int(round(side[1])))
	_sections = VBoxContainer.new()
	_sections.add_theme_constant_override("separation", 0)
	_sections.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sections_margin.add_child(_sections)
	_sections_scroll.add_child(sections_margin)
	_sections_panel.add_child(_sections_scroll)
	_record_column.add_child(_sections_panel)
	_talk_panel = PanelContainer.new()
	_talk_panel.add_theme_stylebox_override("panel", T.bevel(Color(0, 0, 0, 0.3), [none, none, none, none], Vector4(0, 0, 0, 0)))
	_talk_panel.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_talk_panel.custom_minimum_size.y = T.px(9.0)
	var talk_box := VBoxContainer.new()
	talk_box.add_theme_constant_override("separation", 0)
	_talk_scroll = ScrollContainer.new()
	_talk_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_talk_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var talk_margin := MarginContainer.new()
	talk_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in [["margin_left", T.px(0.8)], ["margin_right", T.px(0.8)], ["margin_top", T.px(0.6)], ["margin_bottom", T.px(0.6)]]:
		talk_margin.add_theme_constant_override(side[0], int(round(side[1])))
	_talk_column = VBoxContainer.new()
	_talk_column.add_theme_constant_override("separation", 0)
	_talk_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	talk_margin.add_child(_talk_column)
	_talk_scroll.add_child(talk_margin)
	talk_box.add_child(_talk_scroll)
	var form := PanelContainer.new()
	form.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
	var form_style := T.plate_style([none, T.SEAM, none, none], Vector4(0, 2, 0, 0), Vector4(T.px(0.7), T.px(0.55) + 2.0, T.px(0.7), T.px(0.55)))
	form_style.inner_top = T.LIP
	form.add_theme_stylebox_override("panel", form_style)
	var form_row := HBoxContainer.new()
	form_row.add_theme_constant_override("separation", int(round(T.px(0.45))))
	form_row.alignment = BoxContainer.ALIGNMENT_END
	_talk_input = TextEdit.new()
	_talk_input.placeholder_text = "Speak to your generals…"
	_talk_input.tooltip_text = "Speak to your generals"
	_talk_input.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	_talk_input.scroll_fit_content_height = false
	_talk_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_talk_input.add_theme_font_override("font", UI.font(400))
	_talk_input.add_theme_font_size_override("font_size", T.font_size(0.85))
	_talk_input.add_theme_color_override("font_color", T.BONE)
	_talk_input.add_theme_color_override("font_placeholder_color", Color(T.BONE, 0.42))
	_talk_input.add_theme_color_override("caret_color", T.BONE)
	_talk_input.add_theme_constant_override("line_spacing", 3)
	var field := T.bevel(Color(0, 0, 0, 0.5), [T.SUNK_LINE, T.SUNK_LINE, T.LIP, T.LIP], Vector4(1, 1, 1, 1), Vector4(T.px(0.65), T.px(0.5), T.px(0.65), T.px(0.5)), 3.0)
	for state in ["normal", "focus", "read_only"]:
		_talk_input.add_theme_stylebox_override(state, field)
	_talk_input.custom_minimum_size.y = roundf(2.0 * T.px(0.85) * 1.15 + 3.0 + T.px(1.0) + 2.0 + 2.0)
	_talk_input.text_changed.connect(_on_talk_changed)
	_talk_input.gui_input.connect(_on_talk_key)
	form_row.add_child(_talk_input)
	_send = Button.new()
	_send.focus_mode = Control.FOCUS_NONE
	_send.tooltip_text = "Send"
	_send.custom_minimum_size = Vector2(T.px(2.6), T.px(2.6))
	_send.size_flags_vertical = Control.SIZE_SHRINK_END
	_send.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_send.pressed.connect(func() -> void: _say(_talk_input.text))
	form_row.add_child(_send)
	form.add_child(form_row)
	talk_box.add_child(form)
	_talk_panel.add_child(talk_box)
	_record_column.add_child(_talk_panel)
	_handle = Control.new()
	_handle.mouse_default_cursor_shape = Control.CURSOR_HSIZE
	_handle.tooltip_text = "Drag to resize"
	_handle.anchor_top = 0.0
	_handle.anchor_bottom = 1.0
	_handle.offset_left = 0.0
	_handle.offset_right = 10.0
	_handle.mouse_filter = Control.MOUSE_FILTER_STOP
	_handle_bar = ColorRect.new()
	_handle_bar.color = Color(236 / 255.0, 231 / 255.0, 218 / 255.0, 0.24)
	_handle_bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_handle_bar.anchor_left = 0.5
	_handle_bar.anchor_right = 0.5
	_handle_bar.anchor_top = 0.5
	_handle_bar.anchor_bottom = 0.5
	_handle_bar.offset_left = -1.5
	_handle_bar.offset_right = 1.5
	_handle_bar.offset_top = -21.0
	_handle_bar.offset_bottom = 21.0
	_handle.add_child(_handle_bar)
	_handle.gui_input.connect(_on_handle_input)
	_drawer.add_child(_handle)


func _lip() -> ColorRect:
	var rect := ColorRect.new()
	rect.color = T.LIP
	rect.custom_minimum_size = Vector2(0, 1)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rect


func _key_icon(svg_key: String, svg: String, size: int, pad: Vector2, tooltip: String, action: Callable) -> Button:
	var button := Button.new()
	button.focus_mode = Control.FOCUS_NONE
	button.tooltip_text = tooltip
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var style := T.key_style(false, Vector4(pad.x, T.px(0.42), pad.x, T.px(0.42)))
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
		button.add_theme_stylebox_override(state, style)
	button.icon = T.svg_icon(svg_key, svg, size, T.BONE)
	button.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	button.pressed.connect(action)
	return button


func _build_head() -> void:
	var none := Color(0, 0, 0, 0)
	var head := PanelContainer.new()
	var head_style := T.bevel(Color(0, 0, 0, 0.4), [none, T.RED, none, T.SEAM], Vector4(0, 4, 0, 2), Vector4(T.px(1.3), T.px(0.62) + 4.0, T.px(1.25), T.px(0.62) + 2.0))
	for corner in ["top-left", "bottom-left", "top-right", "bottom-right"]:
		T.add_rivet(head_style, corner, T.px(0.4), T.px(0.4), 0.5)
	head.add_theme_stylebox_override("panel", head_style)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", int(round(T.px(0.55))))
	var title := T.stencil("War Room", 1.25, T.BONE, 0.24)
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(title)
	row.add_child(_key_icon("wr-fit", FIT_SVG, 15, Vector2(T.px(0.5), 0), "Show the whole battlefield", func() -> void: store.set_values({"fit": int(store.value("fit")) + 1})))
	row.add_child(_key_icon("wr-close", CLOSE_SVG, 14, Vector2(T.px(0.55), 0), "Close the war room", close))
	head.add_child(row)
	_drawer_column.add_child(head)
	_drawer_column.add_child(_lip())


func _on_handle_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if button.button_index != MOUSE_BUTTON_LEFT:
			return
		if button.pressed:
			_resizing = true
		elif _resizing:
			_resizing = false
			if engine:
				engine.request("warroom.width", {"width": _width})
		_handle_bar.color = T.AMBER if _resizing else Color(236 / 255.0, 231 / 255.0, 218 / 255.0, 0.24)
		_handle.accept_event()
	elif event is InputEventMouseMotion and _resizing:
		var motion := event as InputEventMouseMotion
		_apply_width(get_viewport_rect().size.x - motion.global_position.x)
		_handle.accept_event()


func _on_talk_changed() -> void:
	var value := _talk_input.text
	if value.length() > 700:
		var caret_line := _talk_input.get_caret_line()
		var caret_column := _talk_input.get_caret_column()
		_talk_input.text = value.substr(0, 700)
		_talk_input.set_caret_line(caret_line)
		_talk_input.set_caret_column(caret_column)
	_talk_text = _talk_input.text
	_style_send()


func _on_talk_key(event: InputEvent) -> void:
	if event is InputEventKey:
		var key := event as InputEventKey
		if key.pressed and (key.keycode == KEY_ENTER or key.keycode == KEY_KP_ENTER) and not key.shift_pressed:
			_talk_input.accept_event()
			_say(_talk_input.text)


func _style_send() -> void:
	var generals: Array = _record.get("generals", [])
	var empty := _talk_input.text.strip_edges().is_empty()
	var off := not _sending.is_empty() or empty or generals.is_empty()
	var look_off := not _sending.is_empty() or empty
	var style := T.key_style(true, Vector4(0, 0, 0, 0))
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
		_send.add_theme_stylebox_override(state, style)
	_send.icon = T.svg_icon("wr-send", SEND_SVG, 16, T.BONE_FAINT if look_off else T.BONE)
	_send.disabled = off
	_send.modulate.a = 0.55 if look_off else 1.0
	_send.mouse_default_cursor_shape = Control.CURSOR_ARROW if look_off else Control.CURSOR_POINTING_HAND
	_talk_input.editable = not generals.is_empty()


func _say(text: String) -> void:
	var said := text.strip_edges()
	var name := _name()
	if said.is_empty() or not _sending.is_empty() or name.is_empty():
		return
	_sending = {"battlefield": name, "text": said}
	_failure = {}
	_took = []
	_talk_input.text = ""
	_talk_text = ""
	_render_talk()
	_style_send()
	var call := engine.last_request_id() + 1
	_say_call = call
	var reply: Dictionary = await engine.request("warroom.say", {"battlefield": name, "message": said})
	if _say_call != call:
		return
	_say_call = 0
	if reply.get("ok", false):
		var result: Dictionary = reply.get("result", {})
		if not bool(result.get("stale", false)):
			_took = result.get("took", [])
		_sending = {}
		await refresh()
	else:
		_sending = {}
		if not bool(reply.get("aborted", false)):
			_failure = {"battlefield": name, "text": said, "reason": str(reply.get("error", ""))}
	_render_talk()
	_style_send()


func _rehearse() -> void:
	if _rehearse_call > 0:
		engine.cancel(_rehearse_call)
	_rehearsal = {"status": "running"}
	store.set_values({"rehearsal_shade": null})
	_render_sections()
	var call := engine.last_request_id() + 1
	_rehearse_call = call
	var reply: Dictionary = await engine.request("warroom.rehearse", {"battlefield": _name()})
	if _rehearse_call != call:
		return
	_rehearse_call = 0
	if not reply.get("ok", false):
		if bool(reply.get("aborted", false)):
			return
		_rehearsal = {"status": "failed", "message": str(reply.get("error", ""))}
	else:
		var result: Dictionary = reply.get("result", {})
		var status := str(result.get("status", "idle"))
		if status == "done":
			_rehearsal = {"status": "done", "key": str(result.get("key", "")), "toLabel": str(result.get("toLabel", "")), "summary": result.get("summary", {})}
			store.set_values({"rehearsal_shade": result.get("runs", [])})
		else:
			_rehearsal = {"status": status}
	_render_sections()


func _cancel_rehearsal() -> void:
	if _rehearse_call > 0:
		engine.cancel(_rehearse_call)
		_rehearse_call = 0
	_rehearsal = {"status": "idle"}
	_render_sections()


func _clear_rehearsal() -> void:
	_rehearsal = {"status": "idle"}
	store.set_values({"rehearsal_shade": null})
	_render_sections()


func _render() -> void:
	if not _open:
		return
	var record := _record
	var mine: Array = record.get("mine", [])
	var other: Array = record.get("other", [])
	var has_record := not record.is_empty()
	_bar.visible = has_record
	_strip_left.visible = has_record
	_strip_bottom.visible = has_record
	if has_record:
		_bar_name.text = _name().to_upper()
		var sides := "%s against %s" % [", ".join(PackedStringArray(mine)), ", ".join(PackedStringArray(other))]
		if str(record.get("status", "")) == "frozen":
			sides += " · ceasefire"
		_bar_sides.text = sides.to_upper()
		var date_label := str(_view.get("dateLabel", ""))
		_bar_date.text = (date_label if not date_label.is_empty() else str(_view.get("gameDate", ""))).to_upper()
	_render_tabs()
	_empty.visible = not has_record
	_record_column.visible = has_record
	if has_record:
		_status_text.text = ("A turn is being resolved. Orders are taken once it has landed." if _turn_running else "Nothing moves here: orders are carried out when time next passes.") + " The troop tools are on the left of the map."
		_render_sections()
		_render_talk()
		_style_send()
	_render_rail()


func _render_tabs() -> void:
	for child in _tabs_row.get_children():
		_tabs_row.remove_child(child)
		child.queue_free()
	var fronts: Array = _view.get("fronts", [])
	_tabs_holder.visible = fronts.size() > 1
	if fronts.size() <= 1:
		return
	for entry in fronts:
		var front: Dictionary = entry
		var name := str(front.get("name", ""))
		var on := name == _name()
		var tab := T.key(name, on, false)
		tab.text = name.to_upper()
		var natural := T.stencil_font(T.spacing_px(0.8, 0.07)).get_string_size(tab.text, HORIZONTAL_ALIGNMENT_LEFT, -1, T.font_size(0.8)).x + 2.0 * T.px(0.62) + 4.0
		tab.clip_text = true
		tab.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		tab.custom_minimum_size.x = minf(natural, T.px(14.0))
		var side := int(front.get("side", -1))
		tab.pressed.connect(func() -> void: store.show_battlefield(name, side))
		_tabs_row.add_child(tab)


func _render_rail() -> void:
	if not rail:
		return
	var has_record := _open and not _record.is_empty()
	var draft: Variant = store.value("draft")
	rail.set_props({
		"shown": has_record,
		"top": FRAME_BAR + T.px(0.7),
		"locked": _locked(),
		"turn_running": _turn_running,
		"notice": _notice,
		"carriers": _record.get("carriers", []),
		"own": (_record.get("ownTroops", []) as Array).size(),
		"away": bool(_record.get("away", false)),
		"can_fortify": bool(_record.get("canFortify", false)),
		"drafted": draft is Array,
		"fleets": (_record.get("fleets", []) as Array).size(),
		"supply_areas": _supply_areas,
		"reinforce_most": int(_view.get("reinforceMost", 60)),
	})
	store.set_values({"rail": int(round(rail.right_edge()))})
	plates.set_props({
		"shown": has_record,
		"locked": _locked(),
		"fleets": _record.get("fleets", []),
		"enemies": _record.get("enemies", []),
		"convoys": _record.get("convoys", []),
	})


func _size_sections() -> void:
	if not _sections_panel or not _record_column.visible:
		return
	var column_height := _record_column.size.y
	if column_height <= 0.0:
		return
	var content: float = (_sections_scroll.get_child(0) as Control).get_combined_minimum_size().y + 2.0
	var status := _status_holder.get_combined_minimum_size().y + 1.0
	var room := maxf(0.0, column_height - status - T.px(9.0))
	var height := minf(content, minf(column_height * 0.44, room))
	_sections_panel.custom_minimum_size.y = height
	_sections_scroll.custom_minimum_size.y = maxf(0.0, height - 2.0)


func _clear(node: Node) -> void:
	for child in node.get_children():
		node.remove_child(child)
		child.queue_free()


func _gap(height_rem: float) -> Control:
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, T.px(height_rem))
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return gap


func _top(child: Control, rem: float) -> Control:
	return T.pad(child, Vector4(0, T.px(rem), 0, 0)) if rem > 0.0 else child


func _render_sections() -> void:
	if not _open or _record.is_empty():
		return
	var keep := _sections_scroll.scroll_vertical
	_clear(_sections)
	_general_trays = {}
	_general_tags = {}
	_plan_trays = {}
	_sections.add_child(_generals_block())
	var weather: Variant = _record.get("weather")
	if bool(_record.get("forecast", false)):
		var block := VBoxContainer.new()
		block.add_theme_constant_override("separation", 0)
		block.add_child(T.heading("Weather ahead"))
		if typeof(weather) == TYPE_DICTIONARY and not ((weather as Dictionary).get("spells", []) as Array).is_empty():
			block.add_child(_top(_weather_tray(weather), 0.4))
		_sections.add_child(_top(block, 0.85))
	_sections.add_child(_top(_plans_block(), 0.85))
	await get_tree().process_frame
	if is_instance_valid(_sections_scroll):
		_size_sections()
		_sections_scroll.scroll_vertical = keep


func _generals_block() -> Control:
	var block := VBoxContainer.new()
	block.add_theme_constant_override("separation", 0)
	block.mouse_filter = Control.MOUSE_FILTER_PASS
	block.mouse_exited.connect(func() -> void:
		if not Rect2(Vector2.ZERO, block.size).has_point(block.get_local_mouse_position()):
			store.set_values({"highlight": -1}))
	block.add_child(T.heading("Your generals"))
	var generals: Array = _record.get("generals", [])
	if generals.is_empty():
		block.add_child(_top(T.soft("No general has a command here yet. They are given their commands when time next passes."), 0.4))
	var highlight := int(store.value("highlight"))
	for entry in generals:
		var general: Dictionary = entry
		var command := int(general.get("command", 0))
		var lit := highlight == command
		var tray := T.tray(lit, Vector4(T.px(0.5), T.px(0.34), T.px(0.5), T.px(0.34)))
		tray.mouse_entered.connect(func() -> void: store.set_values({"highlight": command}))
		tray.gui_input.connect(func(event: InputEvent) -> void:
			if event is InputEventMouseButton and (event as InputEventMouseButton).pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
				store.set_values({"highlight": command}))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", int(round(T.px(0.55))))
		row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var tag := PanelContainer.new()
		tag.custom_minimum_size = Vector2(T.px(1.5), T.px(1.5))
		tag.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		tag.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var number := T.stencil(str(command + 1), 0.86, T.DARK_INK if lit else T.BRASS, 0.0)
		number.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		number.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		tag.add_child(number)
		_style_tag(tag, number, lit)
		row.add_child(tag)
		var info := VBoxContainer.new()
		info.add_theme_constant_override("separation", 0)
		info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		info.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var name_row := HBoxContainer.new()
		name_row.add_theme_constant_override("separation", int(round(T.px(0.4))))
		name_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var name := str(general.get("name", ""))
		var title := str(general.get("title", ""))
		var name_label := T.text(name if not name.is_empty() else title, 0.84, T.BONE, 700, 1.2)
		name_label.autowrap_mode = TextServer.AUTOWRAP_OFF
		name_label.clip_text = true
		name_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		name_label.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		var rank_width := 0.0
		var rank: Label = null
		if not name.is_empty():
			rank = T.stencil(title, 0.68, T.BONE_FAINT)
			rank.size_flags_vertical = Control.SIZE_SHRINK_END
			rank_width = rank.get_theme_font("font").get_string_size(rank.text, HORIZONTAL_ALIGNMENT_LEFT, -1, rank.get_theme_font_size("font_size")).x + T.px(0.4)
		var room := _width - 3.0 - T.px(1.6) - T.px(1.0) - 2.0 - T.px(1.5) - T.px(0.55) * 2.0 - _link_width("Pick") - rank_width
		var natural := UI.font(700).get_string_size(name_label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, T.font_size(0.84)).x + 1.0
		name_label.custom_minimum_size.x = maxf(20.0, minf(natural, room))
		name_row.add_child(name_label)
		if rank:
			name_row.add_child(rank)
		info.add_child(name_row)
		var doing := "%d formations at %d%% · %s" % [int(general.get("n", 0)), int(general.get("pct", 0)), W.doing_word(str(general.get("doing", "")))]
		if not str(general.get("at", "")).is_empty():
			doing += " near " + str(general.get("at", ""))
		if int(general.get("cut", 0)) > 0:
			doing += " · %d cut off" % int(general.get("cut", 0))
		info.add_child(_top(T.soft(doing), 0.1))
		for told_entry in general.get("told", []):
			var told: Dictionary = told_entry
			var said := "Ordered: "
			if bool(told.get("way", false)):
				said += "a route drawn for %d" % int(told.get("mine", 0))
			else:
				said += W.order_word(str(told.get("order", "")))
				if not str(told.get("objective", "")).is_empty():
					said += " toward " + str(told.get("objective", ""))
				if int(told.get("mine", 0)) < int(general.get("n", 0)):
					said += " (%d)" % int(told.get("mine", 0))
			info.add_child(_top(T.text(said, 0.72, T.AMBER, 400, 1.2), 0.12))
		row.add_child(info)
		var pick := T.link("Pick")
		pick.tooltip_text = "Pick out this general's troops"
		pick.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var troops: Array = general.get("troops", [])
		pick.pressed.connect(func() -> void: store.set_values({"selected": troops, "highlight": command}))
		row.add_child(pick)
		tray.add_child(row)
		_general_trays[command] = tray
		_general_tags[command] = [tag, number]
		block.add_child(_top(tray, 0.3))
	return T.pad(block, Vector4(0, 0, 0, T.px(0.8)))


func _link_width(text: String) -> float:
	return T.stencil_font(T.spacing_px(0.76, 0.06)).get_string_size(text.to_upper(), HORIZONTAL_ALIGNMENT_LEFT, -1, T.font_size(0.76)).x


func _style_tag(tag: PanelContainer, number: Label, lit: bool) -> void:
	tag.add_theme_stylebox_override("panel", UI.box(T.BRASS if lit else Color(0, 0, 0, 0.45), T.BRASS, 2, 1))
	number.add_theme_color_override("font_color", T.DARK_INK if lit else T.BRASS)


func _restyle_generals() -> void:
	var highlight := int(store.value("highlight"))
	for command in _general_trays.keys():
		var tray: PanelContainer = _general_trays[command]
		if not is_instance_valid(tray):
			continue
		var lit: bool = int(command) == highlight
		tray.add_theme_stylebox_override("panel", T.tray_style(lit, Vector4(T.px(0.5), T.px(0.34), T.px(0.5), T.px(0.34))))
		var pair: Array = _general_tags[command]
		_style_tag(pair[0], pair[1], lit)


func _restyle_plans() -> void:
	var pointed := str(store.value("pointed"))
	for id in _plan_trays.keys():
		var tray: PanelContainer = _plan_trays[id]
		if is_instance_valid(tray):
			tray.add_theme_stylebox_override("panel", T.tray_style(str(id) == pointed))


func _weather_tray(weather: Dictionary) -> Control:
	var tray := T.tray(false, Vector4(T.px(0.5), T.px(0.45), T.px(0.5), T.px(0.45)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var tiles := HFlowContainer.new()
	tiles.add_theme_constant_override("h_separation", int(round(T.px(0.2))))
	tiles.add_theme_constant_override("v_separation", int(round(T.px(0.2))))
	for entry in weather.get("tiles", []):
		var day: Dictionary = entry
		var state := str(day.get("w", ""))
		var tile := PanelContainer.new()
		tile.tooltip_text = str(day.get("title", ""))
		tile.mouse_filter = Control.MOUSE_FILTER_PASS
		tile.add_theme_stylebox_override("panel", UI.box(Color(0, 0, 0, 0.3), T.SEAM, 2, 1, Vector4(T.px(0.1), T.px(0.16), T.px(0.1), T.px(0.16))))
		tile.custom_minimum_size.x = T.px(1.45)
		var stack := VBoxContainer.new()
		stack.add_theme_constant_override("separation", int(round(T.px(0.08))))
		stack.alignment = BoxContainer.ALIGNMENT_CENTER
		stack.mouse_filter = Control.MOUSE_FILTER_IGNORE
		if GLYPHS.has(state):
			var glyph := T.icon_rect("wr-weather-" + state + ("-soft" if state == "clear" else ""), GLYPH_HEAD + str(GLYPHS[state]) + "</svg>", 18, T.BONE_SOFT if state == "clear" else T.AMBER)
			glyph.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
			stack.add_child(glyph)
		var number := T.stencil(T.num(day.get("day", "")) if typeof(day.get("day")) != TYPE_STRING else str(day.get("day", "")), 0.6, T.BONE_FAINT, 0.0)
		number.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		number.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		number.custom_minimum_size.y = roundf(T.px(0.6) * 1.15)
		stack.add_child(number)
		tile.add_child(stack)
		tiles.add_child(tile)
	column.add_child(tiles)
	var spells := VBoxContainer.new()
	spells.add_theme_constant_override("separation", int(round(T.px(0.18))))
	for entry in weather.get("spells", []):
		var spell: Dictionary = entry
		var state := str(spell.get("state", ""))
		var rich := _rich(0.72, T.BONE_SOFT)
		rich.push_font(UI.font(700))
		rich.push_color(T.BONE if state == "clear" else T.AMBER)
		rich.add_text(W.weather_word(state))
		rich.pop()
		rich.pop()
		var when := str(spell.get("from", ""))
		if int(spell.get("days", 1)) != 1:
			when += " – " + str(spell.get("to", ""))
		rich.add_text(" · " + when + ": " + W.weather_does(spell.get("does", [])))
		spells.add_child(rich)
	column.add_child(_top(spells, 0.35))
	tray.add_child(column)
	return tray


func _rich(size_rem := 0.72, colour := T.BONE_SOFT) -> RichTextLabel:
	var rich := RichTextLabel.new()
	rich.fit_content = true
	rich.scroll_active = false
	rich.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	rich.selection_enabled = false
	rich.add_theme_font_override("normal_font", UI.font(400))
	rich.add_theme_font_size_override("normal_font_size", T.font_size(size_rem))
	rich.add_theme_color_override("default_color", colour)
	rich.add_theme_constant_override("line_separation", 2)
	rich.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rich.mouse_filter = Control.MOUSE_FILTER_PASS
	return rich


func _swatch(colour: Color) -> Control:
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_top", int(round(T.px(0.45))))
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	var bar := ColorRect.new()
	bar.color = colour
	bar.custom_minimum_size = Vector2(T.px(0.95), T.px(0.22))
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bar.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	holder.add_child(bar)
	return holder


func _plan_title(plan: Dictionary) -> String:
	var kind := str(plan.get("kind", ""))
	var title := ""
	match kind:
		"diversion":
			title = "Diversion"
		"route":
			title = "Route"
		"project":
			title = str(plan.get("name", ""))
		"order":
			title = str(plan.get("name", "")) if not str(plan.get("name", "")).is_empty() else W.order_word(str(plan.get("order", "")))
	if not str(plan.get("objective", "")).is_empty() and kind != "project":
		title += " toward " + str(plan.get("objective", ""))
	return title


func _plan_soft(plan: Dictionary) -> String:
	var kind := str(plan.get("kind", ""))
	var done := bool(plan.get("done", false))
	var out := ""
	if kind == "project":
		out += W.order_word(str(plan.get("order", "")))
		if not str(plan.get("objective", "")).is_empty():
			out += " toward " + str(plan.get("objective", ""))
		out += " · "
	if kind == "diversion":
		out += "made to look like %d formations" % int(plan.get("troops", 0))
	if kind != "diversion" and not done:
		out += "%d formations" % int(plan.get("troops", 0))
	if done:
		out += "carried out"
	if kind == "project" and not done:
		out += " · " + W.project_status(str(plan.get("status", "")))
	if kind == "project" and bool(plan.get("off", false)):
		out += " · held back"
	if kind == "project" and bool(plan.get("edited", false)):
		out += " · redrawn"
	if kind == "order" and not bool(plan.get("chosen", false)) and not str(plan.get("sector", "")).is_empty() and str(plan.get("sector", "")) != "all":
		out += " · " + str(plan.get("sector", ""))
	return out


func _attacked_by(plan: Dictionary) -> Array:
	if str(plan.get("kind", "")) != "route":
		return []
	var attacks: Array = plan.get("attacks", [])
	if not attacks.is_empty():
		return attacks
	if typeof(_attacks) != TYPE_DICTIONARY:
		return []
	var index := str(plan.get("id", "")).replace("order:", "")
	if index.is_valid_int():
		index = str(int(index))
	return (_attacks as Dictionary).get(index, [])


func _plan_row(plan: Dictionary) -> Control:
	var id := str(plan.get("id", ""))
	var kind := str(plan.get("kind", ""))
	var past := bool(plan.get("begun", false)) or bool(plan.get("done", false))
	var tone := W.plan_tone(plan)
	var locked := _locked()
	var name := _name()
	var tray := T.tray(str(store.value("pointed")) == id)
	tray.mouse_entered.connect(func() -> void: store.set_values({"pointed": id}))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", int(round(T.px(0.55))))
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(_swatch(T.PLAN_COLOURS["idle"] if past else T.PLAN_COLOURS[tone]))
	var info := VBoxContainer.new()
	info.add_theme_constant_override("separation", 0)
	info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	info.mouse_filter = Control.MOUSE_FILTER_IGNORE
	info.add_child(T.line(_plan_title(plan)))
	info.add_child(T.soft(_plan_soft(plan)))
	var attacked := _attacked_by(plan)
	if not attacked.is_empty():
		info.add_child(_top(T.text("This route goes into %s, which is not in this war. Sending troops along it is an attack: when they reach its border it is at war with you, and its land is fought over." % ", ".join(PackedStringArray(attacked)), 0.72, T.AMBER), 0.12))
	var links := T.links_row()
	var project := str(plan.get("project", ""))
	if kind == "project" and bool(plan.get("own", false)) and not bool(plan.get("done", false)):
		var redrawing := str(store.value("tool")) == "replan" and str(store.value("replan")) == project
		var redraw := T.link("Cancel" if redrawing else "Redraw", locked)
		redraw.pressed.connect(func() -> void: store.take_tool("replan", {"replan": project}))
		links.add_child(redraw)
		if bool(plan.get("edited", false)):
			var suggested := T.link("Suggested way", locked)
			suggested.pressed.connect(func() -> void: _act({"op": "plan", "battlefield": name, "project": project, "way": []}))
			links.add_child(suggested)
		var off := bool(plan.get("off", false))
		var hold := T.link("Let it go ahead" if off else "Hold it back", locked)
		hold.pressed.connect(func() -> void: _act({"op": "plan", "battlefield": name, "project": project, "off": not off}))
		links.add_child(hold)
	if kind == "project" and bool(plan.get("own", false)) and bool(plan.get("done", false)):
		var again := T.link("Send it again", locked)
		again.pressed.connect(func() -> void: _act({"op": "plan", "battlefield": name, "project": project, "again": true}))
		links.add_child(again)
	if kind == "diversion":
		var remove := T.link("Remove", locked)
		remove.pressed.connect(func() -> void: _act({"op": "unplan", "battlefield": name, "id": id}))
		links.add_child(remove)
	var picked: Array = plan.get("picked", [])
	if (kind == "route" or (kind == "order" and bool(plan.get("chosen", false)))) and picked.size() > 0:
		var pick := T.link("Pick its troops")
		pick.pressed.connect(func() -> void: store.set_values({"selected": picked}))
		links.add_child(pick)
		var call_off := T.link("Call it off", locked)
		call_off.pressed.connect(func() -> void: _act({"op": "release", "battlefield": name, "troops": picked}))
		links.add_child(call_off)
	if links.get_child_count() > 0:
		info.add_child(_top(links, 0.1))
	row.add_child(info)
	tray.add_child(row)
	_plan_trays[id] = tray
	return _top(tray, 0.3)


func _plans_block() -> Control:
	var record := _record
	var locked := _locked()
	var name := _name()
	var block := VBoxContainer.new()
	block.add_theme_constant_override("separation", 0)
	block.mouse_filter = Control.MOUSE_FILTER_PASS
	block.mouse_exited.connect(func() -> void:
		if not Rect2(Vector2.ZERO, block.size).has_point(block.get_local_mouse_position()):
			store.set_values({"pointed": ""}))
	block.add_child(T.heading("Planned movements"))
	rehearsal_tray = _rehearsal_tray()
	block.add_child(_top(rehearsal_tray, 0.4))
	var planned: Array = record.get("planned", [])
	if planned.is_empty():
		block.add_child(_top(T.soft("None. A route you draw, an order a general takes, and an operation on your Board that sends troops at a place here all show on the map as arrows."), 0.4))
	for plan in planned:
		block.add_child(_plan_row(plan))
	var deploy: Variant = record.get("deploy")
	if typeof(deploy) == TYPE_DICTIONARY:
		block.add_child(_deploy_row(deploy))
	if bool(record.get("hasDiversion", false)):
		var intel: Dictionary = record.get("intel", {})
		var double := bool(intel.get("double", false))
		block.add_child(_top(T.text("The agent of theirs you turned will send them your diversions in place of your plans." if double else "You have turned no agent of theirs, so there is nobody to show a diversion to. An agent of theirs you have not caught sends them your real plans.", 0.72, T.AMBER if double else T.BONE_SOFT), 0.35))
	var under: Array = record.get("underWay", [])
	if not under.is_empty():
		block.add_child(T.heading("Under way", null, T.px(0.8)))
		block.add_child(_top(T.soft("Time has passed over these, so their arrows are off the map. Point at one to see what is left of it."), 0.3))
		for plan in under:
			block.add_child(_plan_row(plan))
	var allies: Array = record.get("allies", [])
	if not allies.is_empty():
		block.add_child(T.heading("Allies", null, T.px(0.8)))
		block.add_child(_top(T.soft("Each ally commands its own troops here. Agree a plan with its leader, and its troops carry it out when time passes."), 0.3))
		for entry in allies:
			var ally: Dictionary = entry
			var tray := T.tray(false)
			var column := VBoxContainer.new()
			column.add_theme_constant_override("separation", 0)
			column.add_child(T.line(str(ally.get("name", ""))))
			var said := "%d formations" % int(ally.get("n", 0))
			var orders: Array = ally.get("orders", [])
			if orders.is_empty():
				said += " · no orders of its own yet"
			else:
				for order in orders:
					said += " · " + W.order_word(str(order))
			column.add_child(T.soft(said))
			var talk := T.link("Talk strategy with its leader")
			var ally_name := str(ally.get("name", ""))
			talk.pressed.connect(func() -> void:
				close()
				open_chat.emit(ally_name))
			column.add_child(talk)
			tray.add_child(column)
			block.add_child(_top(tray, 0.3))
	var own_transports: Array = record.get("ownTransports", [])
	var their_transports: Array = record.get("theirTransports", [])
	if not own_transports.is_empty() or not their_transports.is_empty():
		block.add_child(T.heading("Transporters", null, T.px(0.8)))
		var ways: Variant = store.value("transport_ways")
		for entry in own_transports:
			block.add_child(_top(_own_transport(entry, ways, locked, name), 0.3))
		for entry in their_transports:
			block.add_child(_top(_their_transport(entry, locked, name), 0.3))
	var fleets: Array = record.get("fleets", [])
	if not fleets.is_empty():
		block.add_child(T.heading("Fleets", null, T.px(0.8)))
		block.add_child(_top(T.soft("Pick one to command it from the plate beside the map."), 0.3))
		var picked := str(store.value("fleet"))
		for entry in fleets:
			var fleet: Dictionary = entry
			var tray := T.tray(str(fleet.get("id", "")) == picked)
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", int(round(T.px(0.55))))
			var column := VBoxContainer.new()
			column.add_theme_constant_override("separation", 0)
			column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			var title := T.line(str(fleet.get("name", "")))
			title.autowrap_mode = TextServer.AUTOWRAP_OFF
			title.clip_text = true
			title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
			column.add_child(title)
			column.add_child(T.soft("%d%% strength · %s" % [int(fleet.get("strength", 0)), W.posture_word(str(fleet.get("posture", "")))]))
			column.add_child(T.soft(W.fleet_order_line(fleet)))
			row.add_child(column)
			var pick := T.link("Pick")
			pick.tooltip_text = "Pick out this fleet"
			pick.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			var id := str(fleet.get("id", ""))
			pick.pressed.connect(func() -> void: _pick_fleet(id))
			row.add_child(pick)
			tray.add_child(row)
			block.add_child(_top(tray, 0.3))
	var lines: Array = record.get("lines", [])
	if not lines.is_empty():
		block.add_child(T.heading("Fortified lines", null, T.px(0.8)))
		for entry in lines:
			var line: Dictionary = entry
			var colour := Color(str(line.get("colour", "#e09440")))
			var tray := PanelContainer.new()
			var style := T.tray_style(false)
			style.edges = [colour, style.edges[1], style.edges[2], style.edges[3]]
			style.widths = Vector4(3, 1, 1, 1)
			style.content_margin_left = T.px(0.5) + 2.0
			tray.add_theme_stylebox_override("panel", style)
			var column := VBoxContainer.new()
			column.add_theme_constant_override("separation", 0)
			var line_name := str(line.get("name", ""))
			column.add_child(T.line(line_name if not line_name.is_empty() else W.level_word(int(line.get("level", 5)))))
			var said := "Level %d · %d km" % [int(line.get("level", 5)), int(line.get("km", 0))]
			var building := bool(line.get("building", false))
			if building:
				var ready := str(line.get("ready", ""))
				said += " · being built, standing from about %s" % ready if not ready.is_empty() else " · being built"
			else:
				said += " · standing"
			if int(line.get("breaches", 0)) > 0:
				said += " · broken through in %d places" % int(line.get("breaches", 0))
			column.add_child(T.soft(said))
			if building:
				var stop := T.link("Stop building it", locked)
				var line_id := str(line.get("id", ""))
				stop.pressed.connect(func() -> void: _order_with("warroom.fortify", {"op": "unfortify", "id": line_id}))
				column.add_child(stop)
			tray.add_child(column)
			block.add_child(_top(tray, 0.3))
		block.add_child(_top(T.text("A line being built holds nothing until it stands.", 0.72, T.BRASS), 0.3))
	block.add_child(T.heading("What is known of theirs", null, T.px(0.8)))
	var edge: Variant = record.get("theirEdge")
	if typeof(edge) == TYPE_DICTIONARY:
		var given: Dictionary = edge
		block.add_child(_top(T.soft("At this difficulty their troops here fight at %d%% of their strength and advance at %d%% of their pace, with %d%% of the usual reserves." % [int(given.get("power", 0)), int(given.get("pace", 0)), int(given.get("reserves", 0))]), 0.4))
	var commander := str(record.get("theirCommander", "")) if record.get("theirCommander") != null else ""
	if not commander.is_empty():
		block.add_child(_top(T.soft("At this difficulty their staff is a plainer one: it looks less far ahead and weighs fewer plans." if commander == "plainer" else "At this difficulty their staff weighs each of its plans against how you are likely to answer it."), 0.4))
	var their_plan: Variant = record.get("theirPlan")
	var intel: Dictionary = record.get("intel", {})
	if typeof(their_plan) == TYPE_DICTIONARY:
		var staff: Dictionary = their_plan
		var tray := T.tray(false)
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 0)
		if str(staff.get("by", "")) == "agent":
			column.add_child(T.line("Their staff's plan: " + W.staff_plan_word(str(staff.get("plan", "")))))
			var said := ""
			if not str(staff.get("at", "")).is_empty():
				said += "Aimed at " + str(staff.get("at", ""))
				if int(staff.get("n", 0)) > 0:
					said += ", with about %d formations sent forward" % int(staff.get("n", 0))
				said += ". "
			said += "Decided on %s." % str(staff.get("since", ""))
			column.add_child(T.soft(said))
		else:
			column.add_child(T.soft("Your aircraft over the front see about %d of their formations on the move toward %s. An agent in one of their countries would tell you what their staff means by it." % [int(staff.get("n", 0)), str(staff.get("at", ""))]))
		tray.add_child(column)
		block.add_child(_top(tray, 0.4))
	var known: Array = intel.get("plans", [])
	if known.is_empty() and typeof(their_plan) != TYPE_DICTIONARY:
		block.add_child(_top(T.soft("Nothing. An agent inside one of their countries would send their planned movements here." if bool(_view.get("espionage", false)) else "Nothing."), 0.4))
	for entry in known:
		var plan: Dictionary = entry
		var id := str(plan.get("id", ""))
		var tray := T.tray(str(store.value("pointed")) == id)
		tray.mouse_entered.connect(func() -> void: store.set_values({"pointed": id}))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", int(round(T.px(0.55))))
		row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row.add_child(_swatch(T.PLAN_COLOURS["known"]))
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 0)
		column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var title := str(plan.get("name", "")) if not str(plan.get("name", "")).is_empty() else W.order_word(str(plan.get("order", "")))
		if not str(plan.get("objective", "")).is_empty():
			title += " toward " + str(plan.get("objective", ""))
		column.add_child(T.line(title))
		var said := ""
		if int(plan.get("troops", 0)) > 0:
			said += "about %d formations" % int(plan.get("troops", 0))
		if bool(plan.get("doubted", false)):
			said += " · doubted"
		column.add_child(T.soft(said))
		row.add_child(column)
		tray.add_child(row)
		_plan_trays[id] = tray
		block.add_child(_top(tray, 0.3))
	var sources: Array = intel.get("sources", [])
	if not sources.is_empty():
		block.add_child(_top(T.text("From your agent in %s." % ", ".join(PackedStringArray(sources)), 0.68, T.BONE_FAINT), 0.3))
	return block


func _deploy_row(line: Dictionary) -> Control:
	var tray := T.tray(str(store.value("pointed")) == "deploy")
	tray.mouse_entered.connect(func() -> void: store.set_values({"pointed": "deploy"}))
	_plan_trays["deploy"] = tray
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", int(round(T.px(0.55))))
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var swarm := str(line.get("form", "front")) == "swarm"
	if swarm:
		var ring := _Ring.new()
		ring.colour = T.PLAN_COLOURS["deploy"]
		ring.custom_minimum_size = Vector2(T.px(0.8), T.px(0.8))
		var holder := T.pad(ring, Vector4(0, T.px(0.2), 0, 0))
		holder.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		row.add_child(holder)
	else:
		row.add_child(_swatch(T.PLAN_COLOURS["deploy"]))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if swarm:
		column.add_child(T.line("Swarm deployment"))
		column.add_child(T.soft("Your new troops here gather at this place as a swarm, under one general of their own: levies, drafts and reinforcements."))
	else:
		column.add_child(T.line("Deployment line"))
		column.add_child(T.soft("Your new troops here come in along it: levies, drafts and reinforcements."))
	var calling: Variant = line.get("call")
	if calling != null:
		var said := ""
		if str(calling) == "usual":
			said = "Fresh formations come in here when time next passes: as many as a draft usually brings."
		elif int(calling) == 1:
			said = "1 fresh formation comes in here when time next passes."
		else:
			said = "%d fresh formations come in here when time next passes." % int(calling)
		column.add_child(_top(T.text(said, 0.72, T.BONE), 0.15))
	elif typeof(line.get("last")) == TYPE_DICTIONARY:
		var last: Dictionary = line["last"]
		var called := int(last.get("n", 0))
		var on := str(last.get("on", ""))
		var why := str(last.get("why", ""))
		var said := ""
		if called == 1:
			said = "1 fresh formation came in here on %s." % on
		elif called > 0:
			said = "%d fresh formations came in here on %s." % [called, on]
		elif why == "men":
			said = "None could be called up on %s: your country has no more men fit to serve." % on
		elif why == "full":
			said = "None could be called up on %s: this battlefield holds as many of your troops as it can." % on
		elif why == "ground":
			said = "None could be called up on %s: your side holds no ground along it." % on
		elif why == "halted":
			said = "None could be called up on %s: the fighting here has halted." % on
		else:
			said = "None could be called up on %s." % on
		column.add_child(_top(T.text(said, 0.72, T.BONE_SOFT if called > 0 else T.AMBER), 0.15))
	var links := T.links_row()
	var locked := _locked()
	var redraw := T.link("Cancel" if str(store.value("tool")) == "deploy" else "Redraw", locked)
	redraw.pressed.connect(func() -> void: store.take_tool("deploy"))
	links.add_child(redraw)
	var remove := T.link("Remove", locked)
	var name := _name()
	remove.pressed.connect(func() -> void: _act({"op": "deploy", "battlefield": name, "way": []}))
	links.add_child(remove)
	column.add_child(_top(links, 0.1))
	row.add_child(column)
	tray.add_child(row)
	return _top(tray, 0.3)


func _own_transport(entry: Dictionary, ways: Variant, locked: bool, name: String) -> Control:
	var tray := T.tray(false)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var to := str(entry.get("to", ""))
	column.add_child(T.line(str(entry.get("kind", "")) + (" bound for " + to if not to.is_empty() else " bound for a place on the map")))
	var status := str(entry.get("status", ""))
	var said := "%d formations %s" % [int(entry.get("load", 0)), W.medium_word(str(entry.get("medium", "")))]
	match status:
		"ordered":
			said += " · sets out when time next passes"
		"moving":
			said += " · on its way, due %s" % str(entry.get("due", ""))
		"landed":
			said += " · put its troops down on %s" % str(entry.get("ended", ""))
		"lost":
			said += " · lost on the way on %s" % str(entry.get("ended", ""))
		"returned":
			said += " · turned back: " + W.way_refusal(str(entry.get("note", "")))
		"refused":
			said += " · did not set out: " + W.way_refusal(str(entry.get("note", "")))
	if int(entry.get("sunk", 0)) > 0 and status != "lost":
		said += " · %d lost on the way" % int(entry.get("sunk", 0))
	column.add_child(T.soft(said))
	var found: Variant = null
	if typeof(ways) == TYPE_DICTIONARY:
		found = (ways as Dictionary).get(str(entry.get("id", "")))
	if status == "ordered" and typeof(found) == TYPE_DICTIONARY:
		var way: Dictionary = found
		if way.get("error") == null or str(way.get("error", "")).is_empty():
			var days := int(way.get("days", 0))
			var line := ("About a day" if days == 1 else "About %d days" % days) + (" to where its line ends" if way.get("arrived") == false else " on the way found for it") + " (%d km)." % int(way.get("km", 0))
			column.add_child(T.soft(line))
		else:
			column.add_child(T.text("It cannot set out as things stand: %s." % W.way_refusal(str(way.get("error", ""))), 0.72, T.AMBER))
	if status == "ordered":
		var call_off := T.link("Call it off", locked)
		var id := str(entry.get("id", ""))
		call_off.pressed.connect(func() -> void: _act({"op": "untransport", "battlefield": name, "id": id}))
		column.add_child(call_off)
	tray.add_child(column)
	return tray


func _their_transport(entry: Dictionary, locked: bool, name: String) -> Control:
	var tray := T.tray(false)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	var to := str(entry.get("to", ""))
	column.add_child(T.line("%s: %s%s" % [str(entry.get("owner", "")), str(entry.get("kind", "")), " bound for " + to if not to.is_empty() else ""]))
	var hunted := bool(entry.get("hunted", false))
	var said := "About %d formations %s · due %s" % [int(entry.get("load", 0)), W.medium_word(str(entry.get("medium", ""))), str(entry.get("due", ""))]
	if hunted:
		said += " · your forces are after it"
	column.add_child(T.soft(said))
	var hunt := T.link("Call off the hunt" if hunted else "Go after it", locked or not bool(entry.get("underWay", false)))
	var id := str(entry.get("id", ""))
	hunt.pressed.connect(func() -> void: _act({"op": "hunt", "battlefield": name, "id": id, "off": hunted}))
	column.add_child(hunt)
	tray.add_child(column)
	return tray


func _rehearsal_tray() -> Control:
	var status := str(_rehearsal.get("status", "idle"))
	var locked := _locked()
	var tray := T.tray(false, Vector4(T.px(0.5), T.px(0.45), T.px(0.5), T.px(0.45)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	if status != "done":
		column.add_child(T.soft("See where the front would be in a week if time passed with your orders as they stand. Their staff thinks as it will, and the weather is the weather that will come."))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", int(round(T.px(0.6))))
		var running := status == "running"
		var start := T.key("Rehearsing…" if running else "Rehearse the next week", false, locked or running)
		start.pressed.connect(_rehearse)
		row.add_child(start)
		if running:
			var cancel := T.link("Cancel")
			cancel.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			cancel.pressed.connect(_cancel_rehearsal)
			row.add_child(cancel)
		column.add_child(_top(row, 0.35))
		if running:
			column.add_child(_top(T.soft("The other side's staff is thinking its moves through. The map stays yours meanwhile."), 0.3))
		if status == "nothing":
			column.add_child(_top(T.soft("Nothing would be fought here in the week ahead."), 0.3))
		if status == "failed":
			column.add_child(_top(T.text(str(_rehearsal.get("message", "")), 0.72, T.ALERT), 0.3))
	else:
		var summary: Dictionary = _rehearsal.get("summary", {})
		column.add_child(T.text("By %s, with your orders as they stand" % str(_rehearsal.get("toLabel", "")), 0.8, T.BONE, 700, 1.25))
		var moved := "The front would hardly move." if int(summary.get("gainedKm2", 0)) == 0 and int(summary.get("lostKm2", 0)) == 0 else "You would take about %s km² (shaded green on the map) and lose about %s km² (shaded red)." % [str(summary.get("gainedText", "")), str(summary.get("lostText", ""))]
		column.add_child(_top(T.soft(moved), 0.2))
		var taken: Array = summary.get("townsTaken", [])
		if not taken.is_empty():
			column.add_child(T.soft("Towns you would take: %s." % ", ".join(PackedStringArray(taken))))
		var lost: Array = summary.get("townsLost", [])
		if not lost.is_empty():
			column.add_child(T.text("Towns you would lose: %s." % ", ".join(PackedStringArray(lost)), 0.72, T.AMBER))
		var cut := int(summary.get("cutOff", 0))
		if cut > 0:
			column.add_child(T.text("Troops of yours would be cut off in %d place%s." % [cut, "" if cut == 1 else "s"], 0.72, T.AMBER))
		var they_cut := int(summary.get("theyCutOff", 0))
		if they_cut > 0:
			column.add_child(T.soft("Troops of theirs would be cut off in %d place%s." % [they_cut, "" if they_cut == 1 else "s"]))
		var ours: Array = summary.get("ours", [])
		if ours.size() == 2 and typeof(ours[0]) == TYPE_DICTIONARY and typeof(ours[1]) == TYPE_DICTIONARY:
			column.add_child(_top(T.soft("Your troops would go from %d formations at %d%% to %d at %d%%." % [int(ours[0].get("n", 0)), int(ours[0].get("pct", 0)), int(ours[1].get("n", 0)), int(ours[1].get("pct", 0))]), 0.2))
		var theirs: Array = summary.get("theirs", [])
		if theirs.size() == 2 and typeof(theirs[0]) == TYPE_DICTIONARY and typeof(theirs[1]) == TYPE_DICTIONARY:
			column.add_child(T.soft("Theirs would go from %d formations at %d%% to %d at %d%%." % [int(theirs[0].get("n", 0)), int(theirs[0].get("pct", 0)), int(theirs[1].get("n", 0)), int(theirs[1].get("pct", 0))]))
		if bool(summary.get("closed", false)):
			column.add_child(T.text("The fighting here would be over.", 0.72, T.AMBER))
		column.add_child(_top(T.soft("The story of the next turn can still change this: other countries act, and so do you."), 0.25))
		if str(_rehearsal.get("key", "")) != str(_record.get("ordersKey", "")):
			column.add_child(_top(T.text("Your orders have changed since: rehearse again to see what they would do.", 0.72, T.AMBER), 0.2))
		var links := T.links_row()
		var again := T.link("Rehearse again", locked)
		again.pressed.connect(_rehearse)
		links.add_child(again)
		var clear := T.link("Clear")
		clear.pressed.connect(_clear_rehearsal)
		links.add_child(clear)
		column.add_child(_top(links, 0.3))
	tray.add_child(column)
	return tray


func _render_talk() -> void:
	if _record.is_empty():
		return
	_clear(_talk_column)
	var name := _name()
	var talk: Array = _record.get("talk", [])
	if talk.is_empty() and _sending.is_empty() and _failure.is_empty():
		_talk_column.add_child(T.pad(T.text("Speak to your generals. Tell them what you want done and they will say what they think of it; an order they accept is carried out when time next passes.", 0.78, T.BONE_SOFT, 400, 1.45), Vector4(T.px(0.2), T.px(0.4), T.px(0.2), T.px(0.4))))
	for entry in talk:
		var line: Dictionary = entry
		_talk_column.add_child(_talk_line(line))
	if not _sending.is_empty() and str(_sending.get("battlefield", "")) == name:
		_talk_column.add_child(_talk_line({"who": "", "text": str(_sending.get("text", ""))}))
		_talk_column.add_child(T.pad(T.text("The generals are conferring…", 0.74, T.BONE_SOFT), Vector4(T.px(0.2), T.px(0.2), T.px(0.2), T.px(0.4))))
	if _sending.is_empty():
		var generals: Array = _record.get("generals", [])
		for entry in _took:
			var order: Dictionary = entry
			var command := int(order.get("command", 0))
			var who := ""
			for general_entry in generals:
				if int((general_entry as Dictionary).get("command", -1)) == command:
					who = str((general_entry as Dictionary).get("name", ""))
			if who.is_empty():
				who = _command_title(command)
			var said := "%s: %s" % [who, W.order_word(str(order.get("order", "")))]
			if not str(order.get("objective", "")).is_empty():
				said += " toward " + str(order.get("objective", ""))
			said += ". Carried out when time next passes."
			_talk_column.add_child(T.pad(T.text(said, 0.72, T.AMBER, 400, 1.3), Vector4(T.px(0.2), T.px(0.1), T.px(0.2), T.px(0.1))))
	if not _failure.is_empty() and str(_failure.get("battlefield", "")) == name and _sending.is_empty():
		var tray := T.tray(false, Vector4(T.px(0.7), T.px(0.6), T.px(0.7), T.px(0.6)))
		var column := VBoxContainer.new()
		column.add_theme_constant_override("separation", 0)
		column.add_child(T.line("The generals could not be reached."))
		var reason := str(_failure.get("reason", ""))
		if not reason.is_empty():
			column.add_child(_top(T.soft(reason), 0.25))
		var again := T.key("Try again")
		again.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		var text := str(_failure.get("text", ""))
		again.pressed.connect(func() -> void: _say(text))
		column.add_child(_top(again, 0.45))
		tray.add_child(column)
		_talk_column.add_child(T.pad(tray, Vector4(0, T.px(0.3), 0, T.px(0.3))))
	await get_tree().process_frame
	if is_instance_valid(_talk_scroll):
		_talk_scroll.scroll_vertical = int(_talk_scroll.get_v_scroll_bar().max_value)


static func _command_title(command: int) -> String:
	var ordinals := ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"]
	return "%s Army" % (ordinals[command] if command >= 0 and command < ordinals.size() else "%dth" % (command + 1))


func _talk_line(line: Dictionary) -> Control:
	var own := typeof(line.get("who")) == TYPE_STRING and str(line.get("who")) == ""
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 0)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if not own:
		var name := str(line.get("name", ""))
		var title := str(line.get("title", ""))
		var head := RichTextLabel.new()
		head.fit_content = true
		head.scroll_active = false
		head.autowrap_mode = TextServer.AUTOWRAP_OFF
		head.add_theme_font_override("normal_font", T.stencil_font(T.spacing_px(0.7, 0.16)))
		head.add_theme_font_size_override("normal_font_size", T.font_size(0.7))
		head.add_theme_color_override("default_color", T.BRASS)
		head.add_text((name if not name.is_empty() else title).to_upper())
		if not name.is_empty():
			head.push_color(T.BONE_FAINT)
			head.add_text((" · " + title).to_upper())
			head.pop()
		head.mouse_filter = Control.MOUSE_FILTER_IGNORE
		holder.add_child(T.pad(head, Vector4(T.px(0.1), 0, 0, T.px(0.15))))
	var bubble := PanelContainer.new()
	var edges: Array = [T.RED, T.RED_BRIGHT, T.SEAM, T.SEAM] if own else [T.OLIVE_LINE, T.OLIVE_LINE, T.SEAM, T.SEAM]
	bubble.add_theme_stylebox_override("panel", T.bevel(T.RED_DARK if own else T.OLIVE, edges, Vector4(1, 1, 1, 1), Vector4(T.px(0.7) + 1.0, T.px(0.5) + 1.0, T.px(0.7) + 1.0, T.px(0.5) + 1.0), 3.0))
	bubble.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var text := str(line.get("text", ""))
	var label := T.text(text, 0.84, T.BONE, 400, 1.45)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var available := maxf(80.0, _width - T.px(1.6) - 8.0)
	var most := available * 0.92 - T.px(1.4) - 2.0
	var font := UI.font(400)
	var natural := 0.0
	for part in text.split("\n"):
		natural = maxf(natural, font.get_string_size(part, HORIZONTAL_ALIGNMENT_LEFT, -1, T.font_size(0.84)).x)
	label.custom_minimum_size.x = minf(ceilf(natural) + 2.0, most)
	bubble.add_child(label)
	bubble.size_flags_horizontal = Control.SIZE_SHRINK_END if own else Control.SIZE_SHRINK_BEGIN
	holder.add_child(bubble)
	return T.pad(holder, Vector4(0, T.px(0.35), 0, T.px(0.35)))


class _Ring extends Control:
	var colour := Color.WHITE

	func _draw() -> void:
		var radius := minf(size.x, size.y) * 0.5
		draw_arc(size * 0.5, radius - 1.0, 0.0, TAU, 32, colour, 2.0, true)
