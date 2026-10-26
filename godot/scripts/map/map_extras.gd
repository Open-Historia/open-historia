class_name MapExtras
extends Node

signal settings_changed(settings: Dictionary)
signal globe_changed(active: bool)
signal world_refreshed(world: Dictionary)

const SLOTS := ["flood", "under", "season", "ice", "top"]
const LAT_NORTH := 85.0
const LAT_SOUTH := -80.0
const KEY_ALIASES := {
	"Globe": "globe",
	"Terrain": "terrain",
	"map_disable_idle_rotation": "disableIdleRotation",
	"map_disable_event_camera": "disableEventCamera",
	"map_seasons_weather": "seasonsWeather",
	"map_weather_effects": "weatherEffects",
	"map_basemap_default": "defaultBasemap",
	"map_basemap_default_on": "defaultBasemapOn",
	"map_scenario_terrain": "scenarioTerrain",
	"map_hide_country_labels": "hideCountryLabels",
	"map_label_font": "labelFont",
	"map_mode": "mapMode",
	"systemReducedMotion": "reduceMotion",
}
const BACKGROUND_KEYS := ["defaultBasemap", "defaultBasemapOn", "scenarioTerrain", "gamePick"]

var engine: EngineLink
var map_view: MapView
var settings := {
	"globe": false,
	"terrain": true,
	"disableIdleRotation": false,
	"disableEventCamera": false,
	"seasonsWeather": true,
	"weatherEffects": true,
	"defaultBasemap": "",
	"defaultBasemapOn": false,
	"scenarioTerrain": "",
	"gamePick": null,
	"reduceMotion": false,
	"transitionMode": "",
	"constrained": false,
	"hideCountryLabels": false,
	"labelFont": "",
	"mapMode": "political",
}
var world: Dictionary = {}
var background: Dictionary = {}
var globe: GlobeView
var overlays: RegionOverlays
var season: SeasonTint
var flood: OwnershipFlood
var offers: BasemapOffers
var _layer: CanvasLayer
var _ui: Control
var _slots: Array[Dictionary] = []
var _refreshing := false
var _again := false
var _background_key := ""
var _relief_stops: Array = []
var _basemap_shown := ""


func setup(link: EngineLink, context: Dictionary) -> void:
	engine = link
	map_view = context.get("map_view")
	if map_view == null:
		return
	overlays = RegionOverlays.new()
	add_child(overlays)
	overlays.setup(self)
	season = SeasonTint.new()
	add_child(season)
	season.setup(self)
	flood = OwnershipFlood.new()
	add_child(flood)
	flood.setup(self)
	globe = GlobeView.new()
	add_child(globe)
	globe.setup(self, map_view)
	var parent: Variant = context.get("overlay_parent")
	if parent is Control:
		_ui = Control.new()
		(parent as Control).add_child(_ui)
	else:
		_layer = CanvasLayer.new()
		_layer.layer = 5
		add_child(_layer)
		_ui = Control.new()
		_layer.add_child(_ui)
	_ui.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_ui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	offers = BasemapOffers.new()
	_ui.add_child(offers)
	offers.setup(self)
	map_view.attach_extras(self)
	if not map_view.baked.is_connected(_on_baked):
		map_view.baked.connect(_on_baked)
	if engine and not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)
	if map_view.basemap and map_view.basemap.has_signal("loading_changed"):
		map_view.basemap.connect("loading_changed", offers.set_loading)
	if map_view.extras_ready():
		_build_slots()
		flood.rebuild()
		flood.capture()
		overlays.rebuild()
		season.rebuild()
	if engine:
		var reply: Dictionary = await engine.request("mapextras.settings")
		if bool(reply.get("ok", false)) and reply.get("result") is Dictionary:
			_merge_settings(reply["result"])
	_apply_all()
	await refresh()


func open() -> void:
	refresh()


func close() -> void:
	pass


func _merge_settings(values: Dictionary) -> void:
	for key in values.keys():
		var name := str(key)
		if settings.has(name):
			settings[name] = values[key]


func apply_map_settings(values: Dictionary) -> void:
	var changed := {}
	for key in values.keys():
		var name: String = KEY_ALIASES.get(str(key), str(key))
		var value: Variant = values[key]
		if name == "scenarioTerrain":
			value = "painted" if str(value) == "painted" else ""
		if settings.get(name) != value:
			settings[name] = value
			changed[name] = true
	if changed.is_empty():
		return
	_apply_all()
	for key in BACKGROUND_KEYS:
		if changed.has(key):
			refresh_background()
			break
	if changed.has("seasonsWeather"):
		season.refresh()
	settings_changed.emit(map_settings())


func map_settings() -> Dictionary:
	return settings.duplicate(true)


func reduce_motion() -> bool:
	return bool(settings.get("reduceMotion", false)) or (bool(settings.get("disableIdleRotation", false)) and bool(settings.get("disableEventCamera", false)))


func _apply_all() -> void:
	if not map_view:
		return
	var no_globe := bool(world.get("noGlobe", background.get("noGlobe", false)))
	globe.idle_rotation_disabled = bool(settings.get("disableIdleRotation", false)) or bool(settings.get("reduceMotion", false))
	globe.terrain_on = bool(settings.get("terrain", true)) and str(background.get("kind", "builtin")) == "builtin"
	globe.set_enabled(bool(settings.get("globe", false)) and not no_globe)
	season.set_enabled(bool(settings.get("seasonsWeather", true)))
	if map_view.basemap and map_view.basemap.has_method("set_terrain"):
		map_view.basemap.call("set_terrain", bool(settings.get("terrain", true)))
	_apply_wrap()


func _apply_wrap() -> void:
	var no_wrap := bool(world.get("noWrap", background.get("noWrap", false)))
	var copies := map_view.extras_copies()
	for index in range(copies.size()):
		var copy := copies[index]
		if is_instance_valid(copy):
			copy.visible = not no_wrap or is_zero_approx(copy.position.x)
	if map_view.basemap and map_view.basemap.has_method("set_wrap"):
		map_view.basemap.call("set_wrap", not no_wrap)


func refresh() -> void:
	if not engine or not map_view:
		return
	if _refreshing:
		_again = true
		return
	_refreshing = true
	var passes := 0
	while passes < 4:
		passes += 1
		_again = false
		await _refresh_once()
		if not _again or not is_inside_tree():
			break
	_refreshing = false


func _refresh_once() -> void:
	var reply: Dictionary = await engine.request("mapextras.world")
	if not bool(reply.get("ok", false)) or not (reply.get("result") is Dictionary):
		return
	world = reply["result"]
	_apply_all()
	overlays.set_world(world)
	season.refresh()
	world_refreshed.emit(world)
	await refresh_background()


func refresh_background() -> void:
	if not engine or not map_view:
		return
	var reply: Dictionary = await engine.request("mapextras.background", {"globe": globe.active})
	if not bool(reply.get("ok", false)) or not (reply.get("result") is Dictionary):
		return
	background = reply["result"]
	var relief: Variant = background.get("relief")
	_relief_stops = []
	if relief is Dictionary and (relief as Dictionary).get("fillOpacity") is Array:
		_relief_stops = (relief as Dictionary)["fillOpacity"]
	var shown := "%s|%s" % [str(background.get("kind", "")), str(background.get("basemapId", ""))]
	if not _basemap_shown.is_empty() and shown != _basemap_shown and str(background.get("kind", "")) == "builtin":
		offers.show_transition(str(background.get("basemapId", "")))
	_basemap_shown = shown
	if map_view.basemap and map_view.basemap.has_method("apply_style"):
		map_view.basemap.call("apply_style", background, engine)
	_apply_all()
	offers.set_background(background)
	map_view.call("_after_camera_move")


func fill_opacity_at(level: float) -> float:
	if _relief_stops.size() < 2:
		return -1.0
	var first: Array = _relief_stops[0]
	if level <= float(first[0]):
		return float(first[1])
	for index in range(1, _relief_stops.size()):
		var stop: Array = _relief_stops[index]
		if level <= float(stop[0]):
			var previous: Array = _relief_stops[index - 1]
			return lerpf(float(previous[1]), float(stop[1]), (level - float(previous[0])) / (float(stop[0]) - float(previous[0])))
	var last: Array = _relief_stops[_relief_stops.size() - 1]
	return float(last[1])


static func political_fill_opacity(level: float) -> float:
	var stops: Array = MapView.FILL_OPACITY
	var first: Array = stops[0]
	if level <= float(first[0]):
		return float(first[1])
	for index in range(1, stops.size()):
		var stop: Array = stops[index]
		if level <= float(stop[0]):
			var previous: Array = stops[index - 1]
			return lerpf(float(previous[1]), float(stop[1]), (level - float(previous[0])) / (float(stop[0]) - float(previous[0])))
	var last: Array = stops[stops.size() - 1]
	return float(last[1])


func _on_baked(_info: Dictionary) -> void:
	_build_slots()
	overlays.rebuild()
	season.rebuild()
	flood.rebuild()
	_apply_wrap()
	refresh()


func _build_slots() -> void:
	for entry in _slots:
		for name in SLOTS:
			var node: Variant = entry.get(name)
			if node is Node and is_instance_valid(node):
				(node as Node).queue_free()
	_slots.clear()
	for copy in map_view.extras_copies():
		var entry := {"copy": copy}
		for name in SLOTS:
			var slot := Node2D.new()
			slot.name = "extras_" + name
			copy.add_child(slot)
			entry[name] = slot
		_slots.append(entry)
	order_slots()


func order_slots() -> void:
	for entry in _slots:
		var copy: Node2D = entry["copy"]
		if not is_instance_valid(copy):
			continue
		var flood_slot: Node2D = entry["flood"]
		var under_slot: Node2D = entry["under"]
		var season_slot: Node2D = entry["season"]
		var ice_slot: Node2D = entry["ice"]
		var top_slot: Node2D = entry["top"]
		var fill_index := map_view.extras_child_index(copy, "fill")
		if fill_index >= 0 and flood_slot.get_index() != fill_index + 1:
			_place_after(copy, flood_slot, fill_index)
		if under_slot.get_index() != flood_slot.get_index() + 1:
			_place_after(copy, under_slot, flood_slot.get_index())
		var shadow_index := map_view.extras_child_index(copy, "shadow")
		if shadow_index >= 0 and ice_slot.get_index() != shadow_index - 1:
			_place_before(copy, ice_slot, shadow_index)
		if season_slot.get_index() != ice_slot.get_index() - 1:
			_place_before(copy, season_slot, ice_slot.get_index())
		var border_index := map_view.extras_child_index(copy, "border")
		if border_index >= 0 and top_slot.get_index() != border_index + 1:
			_place_after(copy, top_slot, border_index)


func _place_after(copy: Node2D, node: Node, anchor_index: int) -> void:
	copy.move_child(node, anchor_index + 1 if node.get_index() > anchor_index else anchor_index)


func _place_before(copy: Node2D, node: Node, anchor_index: int) -> void:
	copy.move_child(node, anchor_index - 1 if node.get_index() < anchor_index else anchor_index)


var _ordered_at := 0


func _process(_delta: float) -> void:
	var now := Time.get_ticks_msec()
	if now - _ordered_at > 500 and not _slots.is_empty():
		_ordered_at = now
		order_slots()


func slots(name: String) -> Array[Node2D]:
	var found: Array[Node2D] = []
	for entry in _slots:
		var node: Variant = entry.get(name)
		if node is Node2D and is_instance_valid(node):
			found.append(node)
	return found


func constrain_camera() -> void:
	if not map_view or not map_view.input_enabled:
		return
	if globe and globe.enabled and globe.active:
		globe.constrain()
		return
	var camera := map_view.camera
	var size := map_view.get_viewport_rect().size
	var zoom := camera.zoom.x
	if zoom < MapView.MIN_ZOOM:
		zoom = MapView.MIN_ZOOM
	var top := GlobeView.world_of_lonlat(0.0, LAT_NORTH).y
	var bottom := GlobeView.world_of_lonlat(0.0, LAT_SOUTH).y
	if (bottom - top) * zoom < size.y:
		zoom = size.y / (bottom - top)
	camera.zoom = Vector2.ONE * zoom
	var half := size.y * 0.5 / zoom
	if camera.position.y - half < top:
		camera.position.y = top + half
	if camera.position.y + half > bottom:
		camera.position.y = bottom - half
	if bool(world.get("noWrap", false)):
		camera.position.x = clampf(camera.position.x, 0.0, MapView.WORLD_WIDTH)


func render_view() -> Array:
	if globe and globe.active:
		return globe.render_view()
	return []


func after_camera_move(level: float) -> void:
	if globe and globe.active:
		globe.after_camera_move()
	overlays.on_zoom(level)
	season.on_zoom(level)
	flood.on_zoom(level)


func map_input(event: InputEvent) -> bool:
	if globe == null:
		return false
	if event is InputEventMouseButton or event is InputEventMagnifyGesture or event is InputEventPanGesture:
		globe.mark_interaction()
	if globe.active:
		return globe.handle_input(event)
	return false


func globe_world_to_screen(point: Vector2) -> Vector2:
	return globe.world_to_screen(point)


func globe_screen_to_world(point: Vector2) -> Vector2:
	return globe.screen_to_world(point)


func globe_frame_at(point: Vector2) -> Transform2D:
	return globe.frame_at(point)


func state_applied(previous_owners: PackedInt32Array, previous_names: PackedStringArray, palette: Array[Color]) -> void:
	overlays.on_state()
	flood.state_applied(previous_owners, previous_names, palette)


func set_rotation_paused(paused: bool) -> void:
	if globe:
		globe.set_rotation_paused(paused)


func _on_engine_event(name: String, data: Variant) -> void:
	if name == "mapextras.install" and data is Dictionary:
		offers.on_install_progress(data)
