class_name WarLayers
extends Node2D

signal unit_selected(unit_id: String)
signal state_applied(info: Dictionary)
signal fronts_played

const PLAY_MS_PER_DAY := 320.0
const PLAY_MS_LEAST := 1400.0
const PLAY_MS_MOST := 10000.0
const PLAY_FRAME_MS := 1000.0 / 24.0
const TWEEN_MS := 1200.0
const SNAP_DEG := 40.0
const AIR_STEP_MS := 140.0
const AIR_TURN_SECONDS := 26.0

var engine: EngineLink
var map: MapView
var paint: WarPaint
var ground: WarGround
var overlay: WarOverlay
var overlay_layer: CanvasLayer
var mode := "political"
var reduce_motion := false
var war_room := {"open": false, "battlefield": "", "side": -1, "highlight": -1, "selected": []}

var _game_id := ""
var _settled := {}
var _entries: Array = []
var _playing := false
var _play_started := 0
var _play_duration := 1.0
var _last_paint_ms := 0
var _frame_busy := false
var _frame_again := false
var _arrows_level := -100.0
var _camera_key := Vector3.ZERO
var _camera_angles := Vector2.ZERO
var _view_size := Vector2.ZERO
var _camera_moved_ms := 0
var _state: Dictionary = {}
var _base_map: Dictionary = {}
var _overlay_signature := ""
var _units_from := {}
var _units_to := {}
var _units_started := 0
var _units_moving := false
var _transport_moves: Array = []
var _transport_started := 0
var _transport_duration := 0.0
var _transport_longest := 1.0
var _air: Array = []
var _air_ms := 0
var _strikes_playing := false
var _strike_busy := false
var _askers := {}
var _pressed := false
var _press_distance := 0.0
var _serial := 0
var _stage: Variant = null
var _retry_full := false
var _weather_key := ""
var _quiet_from: Dictionary = {}
var _frames: RefCounted = null
var _frames_ready := false
var frames_from_rust := 0
var frames_from_sidecar := 0


func setup(link: EngineLink, map_view: MapView) -> void:
	engine = link
	map = map_view
	if get_parent() == null:
		map.add_child(self)
	if _frames == null and ClassDB.class_exists("FrontFrames"):
		_frames = ClassDB.instantiate("FrontFrames")
	paint = WarPaint.new()
	add_child(paint)
	paint.setup(map)
	ground = WarGround.new()
	add_child(ground)
	ground.setup(map)
	overlay_layer = CanvasLayer.new()
	overlay_layer.layer = 2
	add_child(overlay_layer)
	overlay = WarOverlay.new()
	overlay.map = map
	overlay_layer.add_child(overlay)
	if not map.baked.is_connected(_on_baked):
		map.baked.connect(_on_baked)
	if not map.camera_moved.is_connected(_sync_camera):
		map.camera_moved.connect(_sync_camera)
	_on_baked({})


func _on_baked(_info: Dictionary) -> void:
	if paint == null:
		return
	paint.rebuild_copies()
	_camera_key = Vector3.ZERO
	if not _state.is_empty():
		_apply(_state, false)


func refresh() -> void:
	await _load()


func stage(through: int, live := false) -> void:
	_stage = {"through": through, "live": live}
	await _load()


func unstage() -> void:
	_stage = null
	await _load()


func set_map_mode(next: String) -> void:
	if next == mode:
		return
	mode = next
	await _load()


func show_every_troop(who: String, on: bool) -> void:
	if on:
		_askers[who] = true
	else:
		_askers.erase(who)
	overlay.every_troop = not _askers.is_empty() or bool(war_room.get("open", false))
	overlay.redraw_base()


func set_war_room(state: Dictionary) -> void:
	var before := war_room
	war_room = {
		"open": bool(state.get("open", false)),
		"battlefield": str(state.get("battlefield", "")).to_lower(),
		"side": int(state.get("side", -1)),
		"highlight": int(state.get("highlight", -1)),
		"selected": state.get("selected", []),
		"transport_ways": state.get("transport_ways", {}),
	}
	overlay.war_room = war_room
	overlay.every_troop = not _askers.is_empty() or bool(war_room.get("open", false))
	overlay.redraw_base()
	if bool(before.get("open", false)) != bool(war_room["open"]) or JSON.stringify(before.get("transport_ways", {})) != JSON.stringify(war_room["transport_ways"]):
		await _load()


func show_strikes_of_event(event_id: String) -> void:
	await _strike_request(event_id, false)


func replay_strikes(event_id: String) -> void:
	await _strike_request(event_id, true)


func playing() -> bool:
	return _playing


func clear() -> void:
	_serial += 1
	_state = {}
	_entries = []
	_playing = false
	_units_from = {}
	_units_to = {}
	_units_moving = false
	_transport_moves = []
	_air = []
	_strikes_playing = false
	_overlay_signature = ""
	_weather_key = ""
	_stage = null
	_quiet_from = {}
	if map != null:
		map.war_quiet = {}
	paint.clear()
	ground.clear()
	overlay.units = []
	overlay.unit_positions = {}
	overlay.markers = []
	overlay.troops = []
	overlay.sides = []
	overlay.transports = {}
	overlay.carrier_override = {}
	overlay.planes = []
	overlay.seas = {}
	overlay.strikes = {}
	overlay.redraw()


func apply_map_state(state: Dictionary) -> void:
	_base_map = state
	_overlay_signature = ""
	_apply_owners(true)


func _load() -> void:
	if engine == null or not engine.is_ready():
		return
	_serial += 1
	var serial := _serial
	var args := {"mode": mode, "have": [] if _retry_full else paint.have_runs(), "planned": bool(war_room.get("open", false)), "previews": war_room.get("transport_ways", {}), "weatherKey": _weather_key}
	_retry_full = false
	if _stage != null:
		args["stage"] = _stage
	var reply: Dictionary = await engine.request("warmap.state", args)
	if serial != _serial:
		return
	if not reply.get("ok", false):
		push_warning("War map: %s" % str(reply.get("error", "")))
		return
	_apply(reply.get("result", {}), true)


func _apply(state: Dictionary, fresh: bool) -> void:
	var game_id := str(state.get("gameId", ""))
	var first := game_id != _game_id
	if first:
		_game_id = game_id
		_settled = {}
		_units_from = {}
		_units_to = {}
		_units_moving = false
		_transport_moves = []
		_entries = []
		_quiet_from = {}
		paint.clear()
	if first and bool((state.get("weather", {}) as Dictionary).get("same", false)):
		_weather_key = ""
	_state = state
	if _frames != null and (fresh or first):
		var stage_data := str(state.get("frontFrames", ""))
		_frames_ready = not stage_data.is_empty() and bool(_frames.call("load", stage_data))
	reduce_motion = bool(state.get("reduceMotion", false))
	_base_map = state.get("map", {})
	var fronts: Array = state.get("fronts", [])
	if first:
		for front in fronts:
			_settled[str((front as Dictionary).get("run", ""))] = true
	paint.set_fronts(fronts)
	for front in fronts:
		var run := str((front as Dictionary).get("run", ""))
		if paint.field(run) == null and (front as Dictionary).get("paint", null) == null and not paint.have_runs().has(run):
			_retry_full = true
	_overlay_signature = "|"
	_sync_fronts(fronts)
	_set_units(state.get("units", []))
	ground.set_orders(state.get("orders", []))
	overlay.markers = _with_world(state.get("markers", []))
	_set_transports(state.get("transports", {}), fresh)
	var seas: Dictionary = state.get("seas", {})
	overlay.seas = {
		"battles": _with_world(seas.get("battles", [])),
		"rings": _with_points(seas.get("rings", [])),
		"labels": _with_world(seas.get("labels", [])),
	}
	ground.set_walls(state.get("walls", []))
	var weather: Dictionary = state.get("weather", {})
	if not bool(weather.get("same", false)) and str(weather.get("key", "")) != _weather_key:
		_weather_key = str(weather.get("key", ""))
		ground.set_weather(weather)
	var strikes: Dictionary = state.get("strikes", {})
	if int(strikes.get("playing", 0)) > 0:
		_strikes_playing = true
	_camera_key = Vector3.ZERO
	overlay.redraw()
	if _retry_full and fresh:
		_load()
	state_applied.emit({"fronts": fronts.size(), "units": (state.get("units", []) as Array).size(), "game": game_id})


func _with_world(list: Array) -> Array:
	var out: Array = []
	for item in list:
		var entry: Dictionary = (item as Dictionary).duplicate()
		var at: Array = entry.get("at", [0, 0])
		entry["world"] = Vector2(float(at[0]), float(at[1]))
		if entry.has("rgb"):
			entry["color"] = WarKit.color_of(entry["rgb"])
		out.append(entry)
	return out


func _with_points(list: Array) -> Array:
	var out: Array = []
	for item in list:
		var entry: Dictionary = (item as Dictionary).duplicate()
		entry["points"] = WarKit.points_of(entry.get("line", []))
		out.append(entry)
	return out


func _sync_fronts(fronts: Array) -> void:
	var before := {}
	for entry in _entries:
		before[str(entry["name"])] = entry
	var next: Array = []
	var longest := 0.0
	for item in fronts:
		var front: Dictionary = item
		var name := str(front.get("name", ""))
		var run := str(front.get("run", ""))
		var from: Variant = front.get("from", null)
		var until := float(front.get("until", 0.0))
		var stage_start := float(front.get("start", 0.0))
		var was: Variant = before.get(name, null)
		var start := 0.0
		if was != null and str(was["run"]) == run:
			var day := float(was["day"])
			start = float(from) if from != null and (day < float(from) or day > until) else day
		elif from != null:
			start = float(from)
		else:
			start = stage_start if not _settled.has(run) else until
		if start > until:
			start = until
		var frame: Dictionary = front.get("frame", {})
		next.append({
			"name": name,
			"run": run,
			"start": start,
			"until": until,
			"day": start,
			"from": from,
			"stage_start": stage_start,
			"end": float(front.get("end", 0.0)),
			"last": float(front.get("last", 0.0)),
			"known": bool(front.get("known", false)),
			"status": str(front.get("status", "")),
			"owners": front.get("owners", {}),
			"frame": frame,
			"air": front.get("air", []),
		})
		longest = maxf(longest, until - start)
	_entries = next
	_air = []
	for entry in _entries:
		for air in entry["air"]:
			_air.append([air, entry["frame"]])
	_air_ms = 0
	if not (longest > 0.0):
		for entry in _entries:
			entry["day"] = entry["until"]
		_playing = false
		_paint_all(true)
		_settle()
		if _entries.is_empty():
			overlay.troops = []
			overlay.sides = []
			ground.set_arrows([], [])
		return
	_play_duration = clampf(longest * PLAY_MS_PER_DAY, PLAY_MS_LEAST, PLAY_MS_MOST)
	_play_started = Time.get_ticks_msec()
	_last_paint_ms = 0
	_playing = true
	_paint_all(false)


func _front_shown(entry: Dictionary, day: float) -> bool:
	return bool(entry["known"]) and day >= float(entry["stage_start"]) and not (str(entry["status"]) == "closed" and day >= float(entry["last"]))


func _paint_all(at_rest: bool) -> void:
	for entry in _entries:
		var day := float(entry["day"])
		paint.show_day(str(entry["run"]), day, _front_shown(entry, day))
	_apply_owners(false)
	_request_frame()
	if at_rest:
		overlay.redraw_base()


func _settle() -> void:
	for entry in _entries:
		if entry["from"] == null and float(entry["day"]) >= float(entry["end"]):
			_settled[str(entry["run"])] = true


func frame_days() -> Array:
	var days: Array = []
	for entry in _entries:
		days.append([entry["name"], float(entry["day"])])
	return days


func frames_local() -> bool:
	return _frames_ready


func local_frame(days: Array, level: float) -> Dictionary:
	if not _frames_ready:
		return {}
	return _frames.call("frame", days, level)


func _request_frame() -> void:
	if _frames_ready and not _entries.is_empty():
		var level := map.zoom_level()
		_show_frame(local_frame(frame_days(), level), level)
		frames_from_rust += 1
		return
	if _frame_busy:
		_frame_again = true
		return
	if _entries.is_empty():
		return
	_frame_busy = true
	var level := map.zoom_level()
	var serial := _serial
	var reply: Dictionary = await engine.request("warmap.frame", {"days": frame_days(), "zoom": level})
	_frame_busy = false
	if reply.get("ok", false) and serial == _serial and not _entries.is_empty() and not _frames_ready:
		_show_frame(reply["result"], level)
		frames_from_sidecar += 1
	if _frame_again:
		_frame_again = false
		_request_frame()


func _show_frame(frame: Dictionary, level: float) -> void:
	_arrows_level = level
	var names: Array = []
	for entry in _entries:
		names.append(entry["name"])
	overlay.troops = frame.get("troops", [])
	overlay.sides = frame.get("sides", [])
	overlay.troop_colours = frame.get("colours", [])
	overlay.troop_fields = names
	ground.set_arrows(frame.get("arrows", []), frame.get("colours", []))
	overlay.redraw_base()


func _shown_owners() -> Dictionary:
	var out := {}
	for entry in _entries:
		var owners: Dictionary = entry.get("owners", {})
		var first: Array = owners.get("first", [])
		var day := float(entry["day"])
		if not first.is_empty():
			for pair in first:
				out[int(pair[0])] = str(pair[1])
			for turn in owners.get("turns", []):
				if float(turn[0]) <= day:
					out[int(turn[1])] = str(turn[2])
		else:
			for pair in owners.get("contested", []):
				out[int(pair[0])] = str(pair[1])
	return out


func _apply_owners(force: bool) -> void:
	if _base_map.is_empty():
		return
	var shown := _shown_owners()
	var keys := shown.keys()
	keys.sort()
	var parts: PackedStringArray = []
	for key in keys:
		parts.append("%d=%s" % [key, shown[key]])
	var signature := "|".join(parts)
	if signature == _overlay_signature and not force:
		return
	var had := not _overlay_signature.is_empty()
	_overlay_signature = signature
	if shown.is_empty() and not had and not force:
		return
	var quiet := {}
	for key in _quiet_from.keys():
		quiet[int(key)] = true
	for key in shown.keys():
		quiet[int(key)] = true
	_quiet_from = shown
	map.war_quiet = quiet
	map.set_state(_merged_map(shown))


func _merged_map(shown: Dictionary) -> Dictionary:
	if shown.is_empty():
		return _base_map
	var owners: Array = (_base_map.get("owners", []) as Array).duplicate()
	var names: Array = (_base_map.get("ownerNames", []) as Array).duplicate()
	var colours: Array = (_base_map.get("ownerColors", []) as Array).duplicate()
	var overlay_colors: Dictionary = _state.get("overlayColors", {})
	for index in shown.keys():
		var name: String = shown[index]
		var at := names.find(name)
		if at < 0:
			names.append(name)
			colours.append(overlay_colors.get(name, [120, 120, 120]))
			at = names.size() - 1
		if int(index) < owners.size():
			owners[int(index)] = at
	var merged := _base_map.duplicate()
	merged["owners"] = owners
	merged["ownerNames"] = names
	merged["ownerColors"] = colours
	return merged



func _set_units(list: Array) -> void:
	overlay.units = list
	var next_to := {}
	var next_from := {}
	var moved := false
	for item in list:
		var unit: Dictionary = item
		var id := str(unit.get("id", ""))
		var target := Vector2(float(unit.get("lng", 0.0)), float(unit.get("lat", 0.0)))
		next_to[id] = target
		var previous: Variant = _units_from.get(id, _units_to.get(id, null))
		if previous == null:
			next_from[id] = target
			continue
		var was: Vector2 = previous
		var jump := maxf(absf(was.x - target.x), absf(was.y - target.y))
		if jump > SNAP_DEG:
			next_from[id] = target
			continue
		next_from[id] = was
		if jump > 0.000000001:
			moved = true
	_units_to = next_to
	_units_from = next_from
	if not moved:
		_units_from = next_to.duplicate()
		_units_moving = false
		_place_units(1.0)
		return
	_units_started = Time.get_ticks_msec()
	_units_moving = true
	_place_units(0.0)


func _place_units(progress: float) -> void:
	var positions := {}
	for id in _units_to.keys():
		var to: Vector2 = _units_to[id]
		var from: Vector2 = _units_from.get(id, to)
		var at := from + (to - from) * progress
		positions[id] = WarKit.project(at.x, at.y)
	overlay.unit_positions = positions
	overlay.redraw_top()


func _set_transports(transports: Dictionary, fresh: bool) -> void:
	overlay.transports = {
		"ways": _with_points(transports.get("ways", [])),
		"points": _with_world(transports.get("points", [])),
	}
	var moves: Array = transports.get("moves", [])
	if not fresh or moves.is_empty():
		return
	_transport_moves = moves
	if reduce_motion:
		_transport_moves = []
		overlay.carrier_override = {}
		return
	_transport_longest = 1.0
	for move in moves:
		_transport_longest = maxf(_transport_longest, float((move as Dictionary).get("days", 1.0)))
	_transport_duration = clampf(_transport_longest * PLAY_MS_PER_DAY, PLAY_MS_LEAST, PLAY_MS_MOST)
	_transport_started = Time.get_ticks_msec()
	_place_carriers(0.0)


func _place_carriers(days: float) -> void:
	var placed := {}
	for item in _transport_moves:
		var move: Dictionary = item
		var span := maxf(1.0, float(move.get("days", 1.0)))
		var km := float(move.get("from", 0.0)) + (float(move.get("to", 0.0)) - float(move.get("from", 0.0))) * minf(1.0, days / span)
		var place := _place_along(move.get("way", []), move.get("legs", []), km, bool(move.get("flat", false)))
		if place.is_empty():
			continue
		var way: Array = move.get("way", [])
		var lng := _unwrap(float(place[0]), float((way[0] as Array)[0]))
		placed[str(move.get("id", ""))] = [WarKit.project(lng, float(place[1])), roundf(float(place[2])), str(move.get("tone", "other")), str(move.get("medium", "sea")), str(move.get("count", ""))]
	overlay.carrier_override = placed
	overlay.redraw_base()


func _unwrap(lng: float, around: float) -> float:
	return lng - roundf((lng - around) / 360.0) * 360.0


func _place_along(way: Array, legs: Array, km: float, flat: bool) -> Array:
	if way.is_empty():
		return []
	var left := maxf(0.0, km)
	for leg in range(way.size() - 1):
		var a: Array = way[leg]
		var b: Array = way[leg + 1]
		var length := float(legs[leg]) if leg < legs.size() else 0.0
		if left <= length or leg + 2 == way.size():
			var share := minf(1.0, left / length) if length > 0.0 else 1.0
			var across := _unwrap(float(b[0]), float(a[0])) - float(a[0])
			var east := across if flat else across * cos(deg_to_rad((float(a[1]) + float(b[1])) / 2.0))
			var bearing := fposmod(rad_to_deg(atan2(east, float(b[1]) - float(a[1]))) + 360.0, 360.0)
			return [_unwrap(float(a[0]) + across * share, 0.0), float(a[1]) + (float(b[1]) - float(a[1])) * share, bearing]
		left -= length
	var first: Array = way[0]
	return [float(first[0]), float(first[1]), 0.0]


func _strike_request(event_id: String, again: bool) -> void:
	if engine == null or not engine.is_ready():
		return
	var reply: Dictionary = await engine.request("warmap.strikes.event", {"eventId": event_id, "again": again, "kmPerPixel": _km_per_pixel()})
	if reply.get("ok", false) and int((reply["result"] as Dictionary).get("playing", 0)) > 0:
		_strikes_playing = true


func _km_per_pixel() -> float:
	var level := map.zoom_level()
	var y := map.camera.position.y
	var lat := rad_to_deg(atan(sinh(PI * (1.0 - 2.0 * y / MapView.WORLD_WIDTH))))
	var held := clampf(lat, -80.0, 80.0)
	return 40075.017 * cos(deg_to_rad(held)) / (512.0 * pow(2.0, level))


func _strike_frame() -> void:
	_strike_busy = true
	var reply: Dictionary = await engine.request("warmap.strikes.frame", {"kmPerPixel": _km_per_pixel()})
	_strike_busy = false
	if not reply.get("ok", false):
		_strikes_playing = false
		overlay.strikes = {}
		overlay.redraw_strikes()
		return
	var frame: Dictionary = reply["result"]
	var ribbons: Array = []
	for item in frame.get("ribbons", []):
		var ribbon: Dictionary = item
		ribbons.append({"points": WarKit.points_of(ribbon.get("line", [])), "width": ribbon.get("width", 1.0), "colour": ribbon.get("colour", [1, 1, 1]), "from": ribbon.get("from", 1.0), "to": ribbon.get("to", 1.0)})
	var discs: Array = []
	for item in frame.get("discs", []):
		var disc: Dictionary = item
		var centre: Array = disc.get("centre", [0, 0])
		discs.append({"centre": Vector2(float(centre[0]), float(centre[1])), "rim": WarKit.points_of(disc.get("rim", [])), "colour": disc.get("colour", [1, 1, 1]), "alpha": disc.get("alpha", 1.0)})
	var points: Array = []
	for item in frame.get("points", []):
		var entry: Dictionary = item
		var at: Array = entry.get("at", [0, 0])
		var toward: Variant = entry.get("toward", null)
		points.append({
			"at": Vector2(float(at[0]), float(at[1])),
			"toward": Vector2(float((toward as Array)[0]), float((toward as Array)[1])) if toward is Array else null,
			"size": entry.get("size", 8.0),
			"shape": entry.get("shape", 0),
			"colour": entry.get("colour", [1, 1, 1]),
			"alpha": entry.get("alpha", 1.0),
		})
	overlay.strikes = {"ribbons": ribbons, "discs": discs, "points": points}
	overlay.redraw_strikes()
	if int(frame.get("playing", 0)) <= 0:
		_strikes_playing = false
		overlay.strikes = {}
		overlay.redraw_strikes()


func _place_planes() -> void:
	var seconds := 0.0 if reduce_motion else Time.get_ticks_msec() / 1000.0
	var planes: Array = []
	for item in _air:
		var air: Dictionary = item[0]
		var frame: Dictionary = item[1]
		var side := int(air.get("side", 0))
		var radius := float(air.get("radius", 1.0))
		var anchors: Array = air.get("anchors", [])
		for at in range(anchors.size()):
			var anchor: Array = anchors[at]
			var turn := 1.0 if at % 2 == 0 else -1.0
			var angle := at * 2.39996 + side * 1.3 + turn * ((2.0 * PI * seconds) / AIR_TURN_SECONDS)
			var x := float(anchor[0]) + radius * cos(angle)
			var y := float(anchor[1]) + radius * sin(angle)
			var east := -sin(angle) * turn
			var north := cos(angle) * turn
			var heading := float(roundi(fposmod(rad_to_deg(atan2(east, north)) + 360.0, 360.0)))
			var world := Vector2(float(frame.get("x", 0.0)) + x * float(frame.get("cx", 1.0)), float(frame.get("y", 0.0)) + y * float(frame.get("cy", -1.0)))
			planes.append([world, heading, str(air.get("tone", "other"))])
	overlay.planes = planes
	overlay.redraw_planes()


func _process(_delta: float) -> void:
	if map == null or overlay == null:
		return
	var shown := map.is_visible_in_tree() and map.war_overlays_visible()
	if overlay_layer.visible != shown:
		overlay_layer.visible = shown
	ground.visible = shown
	var now := Time.get_ticks_msec()
	_sync_camera()
	if not _playing and not _entries.is_empty() and absf(map.zoom_level() - _arrows_level) > 0.12 and now - _camera_moved_ms > 160:
		_arrows_level = map.zoom_level()
		_request_frame()
	if _playing:
		var part := minf(1.0, float(now - _play_started) / _play_duration)
		if part >= 1.0:
			_playing = false
			for entry in _entries:
				entry["day"] = entry["until"]
			_paint_all(true)
			_settle()
			fronts_played.emit()
		elif now - _last_paint_ms >= PLAY_FRAME_MS:
			_last_paint_ms = now
			for entry in _entries:
				entry["day"] = float(entry["start"]) + (float(entry["until"]) - float(entry["start"])) * part
			_paint_all(false)
	if _units_moving:
		var t := minf(1.0, float(now - _units_started) / TWEEN_MS)
		_place_units(1.0 - pow(1.0 - t, 3.0))
		if t >= 1.0:
			_units_moving = false
			_units_from = _units_to.duplicate()
	if not _transport_moves.is_empty():
		var elapsed := float(now - _transport_started)
		var days := minf(1.0, elapsed / _transport_duration) * _transport_longest
		_place_carriers(days)
		if elapsed >= _transport_duration:
			_transport_moves = []
			overlay.carrier_override = {}
			overlay.redraw_base()
	if not _air.is_empty() and (now - _air_ms >= AIR_STEP_MS or _air_ms == 0):
		if not reduce_motion or _air_ms == 0:
			_air_ms = now
			_place_planes()
	elif _air.is_empty() and not overlay.planes.is_empty():
		overlay.planes = []
		overlay.redraw_planes()
	if _strikes_playing and not _strike_busy:
		_strike_frame()


func _sync_camera() -> void:
	if map == null or overlay == null:
		return
	var view := get_viewport_rect().size
	var key := Vector3(map.camera.position.x, map.camera.position.y, map.camera.zoom.x)
	var on_globe := map.is_globe()
	var angles := Vector2(map.bearing, map.pitch)
	if key == _camera_key and view == _view_size and on_globe == overlay.globe and angles == _camera_angles:
		return
	_camera_angles = angles
	overlay.globe = on_globe
	var zoom_changed := key.z != _camera_key.z or _camera_key == Vector3.ZERO
	_camera_key = key
	_view_size = view
	_camera_moved_ms = Time.get_ticks_msec()
	var level := map.zoom_level()
	overlay.camera = map.camera.position
	overlay.zoom = map.camera.zoom.x
	overlay.level = level
	overlay.view = view
	overlay.redraw()
	if zoom_changed:
		ground.set_view(level, map.camera.zoom.x)
		paint.set_view(level, map.camera.zoom.x, map.war_fill_opacity())


func _unhandled_input(event: InputEvent) -> void:
	if map == null or not map.input_enabled or not overlay_layer.visible:
		return
	if event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if button.button_index != MOUSE_BUTTON_LEFT:
			return
		if button.pressed:
			_pressed = true
			_press_distance = 0.0
			return
		if _pressed and _press_distance < 5.0:
			var id := overlay.unit_at(button.position)
			if not id.is_empty():
				_pressed = false
				map.war_cancel_drag()
				map.war_cancel_globe_drag()
				get_viewport().set_input_as_handled()
				unit_selected.emit(id)
				return
		_pressed = false
	elif event is InputEventMouseMotion and _pressed:
		_press_distance += (event as InputEventMouseMotion).relative.length()
