class_name TerrainRelief
extends Node

signal changed

const URL := "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/%d/%d/%d.png"
const EXAGGERATION := 15.0
const SOURCE_MAX_ZOOM := 5
const SOURCE_MIN_ZOOM := 0
const DELTA_ZOOM := 1
const RENDER_MAX_ZOOM := 22
const LEVELS := 6
const DEM_SIZE := 256
const NONE := 255
const MAX_REQUESTS := 6
const KEEP_TILES := 160
const LEVEL_TILES := 8
const LOD_LIMIT := 256
const RETRY_MS := 30000
const GLOBE_TILE_LIMIT := 1024
const WORLD := 4096.0
const PLAN_REFRESH_MS := 1000

var map_view: MapView
var globe: GlobeView
var enabled := false
var has_data := false
var revision := 0
var tiles := {}
var lod_rect := Rect2()
var lod_cell := 1.0
var lod_size := Vector2i.ZERO
var lod_data := PackedByteArray()
var lod_texture: ImageTexture
var level_rects: Array[Rect2] = []
var level_sizes: Array[Vector2i] = []
var level_data: Array[PackedFloat32Array] = []
var level_textures: Array[Texture2D] = []
var _pool := {}
var _arrivals: Array[Callable] = []
var low := 0.0
var high := 0.0
var step := 1.0
var _blank: ImageTexture
var _loading := {}
var _failed := {}
var _queue: Array[String] = []
var _active := 0
var _tick := 0
var _wanted := 0
var _shown := 0
var _building := false
var _again: Dictionary = {}
var _tasks: Array[int] = []
var _cover_signature := 0
var _planned_at := 0


func setup(view: MapView, projector: GlobeView) -> void:
	set_process(false)
	map_view = view
	globe = projector
	var image := Image.create_empty(1, 1, false, Image.FORMAT_RH)
	_blank = ImageTexture.create_from_image(image)
	_reset_levels()


func _reset_levels() -> void:
	level_rects.clear()
	level_sizes.clear()
	level_data.clear()
	level_textures.clear()
	for level in range(LEVELS):
		level_rects.append(Rect2(0, 0, 1, 1))
		level_sizes.append(Vector2i.ONE)
		level_data.append(PackedFloat32Array([0.0]))
		level_textures.append(_blank)


func set_enabled(value: bool) -> void:
	if enabled == value:
		return
	enabled = value
	if not enabled:
		_queue.clear()
		_wanted = 0
		_shown = 0
		_again = {}
		has_data = false
		low = 0.0
		high = 0.0
		lod_size = Vector2i.ZERO
		lod_data = PackedByteArray()
		_reset_levels()
		revision += 1
		changed.emit()


func texture_for(level: int) -> Texture2D:
	return level_textures[level] if level >= 0 and level < level_textures.size() else _blank


func elevation_at(world: Vector2) -> float:
	if not has_data or lod_size.x <= 0:
		return 0.0
	var point := world
	var cell_x := floori((point.x - lod_rect.position.x) / lod_cell)
	if cell_x < 0 or cell_x >= lod_size.x:
		var turned := point.x + WORLD * roundf((lod_rect.get_center().x - point.x) / WORLD)
		cell_x = floori((turned - lod_rect.position.x) / lod_cell)
		point.x = turned
	var cell_y := floori((point.y - lod_rect.position.y) / lod_cell)
	if cell_x < 0 or cell_y < 0 or cell_x >= lod_size.x or cell_y >= lod_size.y:
		return 0.0
	var level := int(lod_data[cell_y * lod_size.x + cell_x])
	if level >= LEVELS:
		return 0.0
	return sample_level(level, point) * EXAGGERATION


func sample_level(level: int, point: Vector2) -> float:
	var rect := level_rects[level]
	var size := level_sizes[level]
	var data := level_data[level]
	var texel := rect.size.x / float(size.x)
	var px := (point.x - rect.position.x) / texel
	var py := (point.y - rect.position.y) / texel
	var ix := floori(px)
	var iy := floori(py)
	var fx := px - ix
	var fy := py - iy
	var x0 := clampi(ix, 0, size.x - 1)
	var x1 := clampi(ix + 1, 0, size.x - 1)
	var y0 := clampi(iy, 0, size.y - 1)
	var y1 := clampi(iy + 1, 0, size.y - 1)
	var top := lerpf(data[y0 * size.x + x0], data[y0 * size.x + x1], fx)
	var bottom := lerpf(data[y1 * size.x + x0], data[y1 * size.x + x1], fx)
	return lerpf(top, bottom, fy)


func update(frame: Dictionary, globe_rect: Rect2) -> void:
	if not enabled or map_view == null:
		return
	var entries: Array = []
	if float(frame.get("g", 0.0)) > 0.0:
		entries = _globe_cover(frame, globe_rect)
	else:
		entries = _flat_cover(frame)
	var signature := _signature(frame, entries)
	var now := Time.get_ticks_msec()
	if signature == _cover_signature and _wanted != 0 and now - _planned_at < PLAN_REFRESH_MS:
		_pump()
		return
	_cover_signature = signature
	_planned_at = now
	_tick += 1
	var plan := _plan(frame, entries)
	_pump()
	var key := int(plan["key"])
	if key == _wanted:
		return
	_wanted = key
	if _building:
		_again = plan
		return
	_start(plan)


func _flat_cover(frame: Dictionary) -> Array:
	var size: Vector2 = frame["size"]
	var centre: Vector2 = frame["cam_world"]
	var px_per_world: float = frame["px_per_world"]
	var level: float = frame["zoom"]
	var pitch: float = frame["pitch"]
	var bearing: float = frame["bearing"]
	var focal: float = frame["focal"]
	var up := Vector2(sin(bearing), -cos(bearing))
	var lifts: Array[float] = [0.0]
	if bool(frame.get("relief", false)):
		lifts = [float(frame["lift_low"]), 0.0, float(frame["lift_high"])]
	var points := PackedVector2Array()
	for corner in [Vector2.ZERO, Vector2(size.x, 0.0), size, Vector2(0.0, size.y)]:
		for lift in lifts:
			points.append(globe.unproject_lifted(frame, corner, lift))
	var hull := Geometry2D.convex_hull(points)
	if hull.size() > 1 and hull[0] == hull[hull.size() - 1]:
		hull.remove_at(hull.size() - 1)
	var hull_low := hull[0]
	var hull_high := hull[0]
	for point in hull:
		hull_low = hull_low.min(point)
		hull_high = hull_high.max(point)
	var camera_ground := (centre - up * (focal * sin(pitch) / px_per_world)) / WORLD
	var distance_z := focal * cos(pitch) / px_per_world / WORLD
	var distance_centre := focal / px_per_world / WORLD
	var requested := level
	var behaviour := Basemap.cover_loading_behaviour()
	var count_term := Basemap.cover_count_term(distance_z, distance_centre, behaviour)
	var axes := Basemap.quad_axes(hull)
	var wrap_world := true
	if map_view.basemap and map_view.basemap.has_method("wrap_enabled"):
		wrap_world = bool(map_view.basemap.call("wrap_enabled"))
	var found: Array = []
	var stack: Array[Array] = []
	if wrap_world:
		for wrap in range(1, 4):
			stack.append([0, 0, 0, -wrap])
			stack.append([0, 0, 0, wrap])
	stack.append([0, 0, 0, 0])
	while not stack.is_empty():
		var node: Array = stack.pop_back()
		var zoom: int = node[0]
		var x: int = node[1]
		var y: int = node[2]
		var wrap: int = node[3]
		var count := 1 << zoom
		var tile_low := Vector2((float(wrap) + float(x) / count) * WORLD, float(y) / count * WORLD)
		var tile_high := tile_low + Vector2.ONE * WORLD / count
		if not Basemap.quad_meets_with(axes, hull_low, hull_high, tile_low, tile_high):
			continue
		var nearest := camera_ground.clamp(tile_low / WORLD, tile_high / WORLD)
		var distance_2d := nearest.distance_to(camera_ground)
		var desired := maxi(0, floori(Basemap.cover_tile_zoom_with(requested, distance_2d, distance_z, distance_centre, behaviour, count_term)))
		var target := mini(desired, RENDER_MAX_ZOOM)
		if zoom >= target:
			var middle := (tile_low + tile_high) * 0.5
			found.append([zoom, x + wrap * count, y, middle.distance_squared_to(centre)])
			continue
		for child in range(4):
			stack.append([zoom + 1, (x << 1) + (child % 2), (y << 1) + (child >> 1), wrap])
	return found


func _globe_cover(frame: Dictionary, rect: Rect2) -> Array:
	var found: Array = []
	if rect.size.x <= 0.0 or rect.size.y <= 0.0:
		return found
	var level: float = frame["zoom"]
	var zoom := clampi(floori(level), 0, RENDER_MAX_ZOOM)
	var centre: Vector2 = frame["cam_world"]
	if zoom <= 4:
		var count := 1 << zoom
		var span := WORLD / count
		var first_x := floori(rect.position.x / span)
		var last_x := mini(floori(rect.end.x / span), first_x + count - 1)
		var first_y := clampi(floori(rect.position.y / span), 0, count - 1)
		var last_y := clampi(floori(rect.end.y / span), 0, count - 1)
		for x in range(first_x, last_x + 1):
			for y in range(first_y, last_y + 1):
				var middle := Vector2((x + 0.5) * span, (y + 0.5) * span)
				found.append([zoom, x, y, middle.distance_squared_to(centre)])
				if found.size() >= GLOBE_TILE_LIMIT:
					return found
		return found
	var size: Vector2 = frame["size"]
	var pitch: float = frame["pitch"]
	var focal: float = frame["focal"]
	var world_px := WORLD * float(frame["px_per_world"])
	var seen := globe._unproject_location(frame, size * 0.5 + Vector2(0.0, focal * tan(pitch)))
	var camera_point := GlobeView.world_of_lonlat(seen.x, seen.y) / WORLD
	var centre_point := centre / WORLD
	var distance_z := cos(pitch) * focal / world_px
	var distance_centre := Vector2(centre_point.x - camera_point.x, centre_point.y - camera_point.y).length()
	var distance_3d := sqrt(distance_centre * distance_centre + distance_z * distance_z)
	var behaviour := Basemap.cover_loading_behaviour()
	var count_term := Basemap.cover_count_term(distance_z, distance_3d, behaviour)
	var stack: Array[Array] = []
	for wrap in range(floori(rect.position.x / WORLD), floori(rect.end.x / WORLD) + 1):
		stack.append([0, 0, 0, wrap])
	while not stack.is_empty():
		var node: Array = stack.pop_back()
		var z: int = node[0]
		var x: int = node[1]
		var y: int = node[2]
		var wrap: int = node[3]
		var count := 1 << z
		var span := WORLD / count
		var low := Vector2((wrap * count + x) * span, y * span)
		if not Rect2(low, Vector2(span, span)).intersects(rect):
			continue
		var distance := globe_tile_distance(camera_point, x, y, z)
		var desired := maxi(0, floori(Basemap.cover_tile_zoom_with(level, distance, distance_z, distance_3d, behaviour, count_term)))
		if z >= mini(desired, RENDER_MAX_ZOOM):
			found.append([z, x + wrap * count, y, (low + Vector2(span, span) * 0.5).distance_squared_to(centre)])
			if found.size() >= GLOBE_TILE_LIMIT:
				return found
			continue
		for child in range(4):
			stack.append([z + 1, (x << 1) + (child % 2), (y << 1) + (child >> 1), wrap])
	return found


static func _signature(frame: Dictionary, entries: Array) -> int:
	var centre: Vector2 = frame["cam_world"]
	var key := entries.size() + 1
	for level in range(LEVELS):
		var span := WORLD / float(1 << level)
		key = (key * 1000003 + floori(centre.x / span) * 65536 + floori(centre.y / span)) & 0x3fffffffffffffff
	for entry: Array in entries:
		key = (key * 1000003 + (int(entry[0]) * 16777216 + int(entry[1]) + 8388608) * 65536 + int(entry[2])) & 0x3fffffffffffffff
	return key


static func _tile_gap(point: float, tile: float, size: float) -> float:
	var delta := point - tile
	return -delta if delta < 0.0 else maxf(0.0, delta - size)


static func _tile_gap_wrapped(point: Vector2, corner: Vector2, size: float) -> float:
	var along := point.x - corner.x
	var across := 0.0
	if along < 0.0:
		across = minf(-along, 1.0 + along - size)
	elif along > 1.0:
		across = minf(maxf(along - size, 0.0), 1.0 - along)
	return maxf(across, _tile_gap(point.y, corner.y, size))


static func globe_tile_distance(point: Vector2, x: int, y: int, z: int) -> float:
	var scale := float(1 << z)
	var size := 1.0 / scale
	var corner := Vector2(x / scale, y / scale)
	var nearest := _tile_gap_wrapped(point, corner, size)
	nearest = minf(nearest, _tile_gap_wrapped(point, Vector2(corner.x + 0.5, -corner.y - size), size))
	nearest = minf(nearest, _tile_gap_wrapped(point, Vector2(corner.x + 0.5, 2.0 - corner.y - size), size))
	return nearest


func tile_min_at(world: Vector2, level: float) -> float:
	var dem := mini(maxi(0, floori(level)) - DELTA_ZOOM, SOURCE_MAX_ZOOM)
	if dem < SOURCE_MIN_ZOOM:
		return 0.0
	var count := 1 << dem
	var x := floori(world.x / WORLD * count)
	var y := clampi(floori(world.y / WORLD * count), 0, count - 1)
	for zoom in range(dem, SOURCE_MIN_ZOOM - 1, -1):
		var key := tile_key(zoom, x, y)
		if tiles.has(key):
			return float((tiles[key] as Dictionary)["min"]) * EXAGGERATION
		x = x >> 1
		y = y >> 1
	return 0.0


static func tile_key(z: int, x: int, y: int) -> String:
	return "%d/%d/%d" % [z, posmod(x, 1 << z), y]


func _plan(frame: Dictionary, entries: Array) -> Dictionary:
	entries.sort_custom(func(a: Array, b: Array) -> bool: return float(a[3]) < float(b[3]))
	var used: Array = []
	for entry: Array in entries:
		var z: int = entry[0]
		var x: int = entry[1]
		var y: int = entry[2]
		var dem_zoom := mini(z - DELTA_ZOOM, SOURCE_MAX_ZOOM)
		if dem_zoom < SOURCE_MIN_ZOOM:
			used.append([z, x, y, NONE, 0, 0])
			continue
		var shift := z - dem_zoom
		var dem_x := x >> shift
		var dem_y := y >> shift
		_request(tile_key(dem_zoom, dem_x, dem_y))
		used.append(_effective(z, x, y, dem_zoom, dem_x, dem_y, LEVELS))
	var centre: Vector2 = frame["cam_world"]
	var windows := {}
	for level in range(LEVELS - 1, -1, -1):
		var span := WORLD / float(1 << level)
		var middle := Vector2i(floori(centre.x / span), floori(centre.y / span))
		var low_tile := middle - Vector2i(LEVEL_TILES / 2 - 1, LEVEL_TILES / 2 - 1)
		var high_tile := low_tile + Vector2i(LEVEL_TILES - 1, LEVEL_TILES - 1)
		var any := false
		var box_low := Vector2i(1 << 30, 1 << 30)
		var box_high := Vector2i(-(1 << 30), -(1 << 30))
		for index in range(used.size()):
			var item: Array = used[index]
			if int(item[3]) != level:
				continue
			var at := Vector2i(int(item[4]), int(item[5]))
			if at.x < low_tile.x or at.y < low_tile.y or at.x > high_tile.x or at.y > high_tile.y:
				used[index] = _effective(int(item[0]), int(item[1]), int(item[2]), level - 1, at.x >> 1, at.y >> 1, level)
				continue
			any = true
			box_low = box_low.min(at)
			box_high = box_high.max(at)
		if any:
			windows[level] = [box_low, box_high]
	var finest := 0
	var bounds_low := Vector2(INF, INF)
	var bounds_high := Vector2(-INF, -INF)
	for item: Array in used:
		var z: int = item[0]
		finest = maxi(finest, z)
		var span := WORLD / float(1 << z)
		bounds_low = bounds_low.min(Vector2(int(item[1]) * span, int(item[2]) * span))
		bounds_high = bounds_high.max(Vector2((int(item[1]) + 1) * span, (int(item[2]) + 1) * span))
	var cell := WORLD / float(1 << finest)
	var cells := Vector2i.ZERO
	if not used.is_empty():
		while true:
			cells = Vector2i(ceili((bounds_high.x - bounds_low.x) / cell - 0.0001), ceili((bounds_high.y - bounds_low.y) / cell - 0.0001))
			if (cells.x <= LOD_LIMIT and cells.y <= LOD_LIMIT) or finest <= 0:
				break
			finest -= 1
			cell *= 2.0
	var parts: PackedStringArray = []
	for item: Array in used:
		parts.append("%d,%d,%d,%d,%d,%d" % item)
	parts.sort()
	for level in windows.keys():
		parts.append("w%d:%s" % [level, str(windows[level])])
	return {
		"key": "|".join(parts).hash(),
		"used": used,
		"windows": windows,
		"cell": cell,
		"origin": bounds_low,
		"cells": cells,
	}


func _effective(z: int, x: int, y: int, from_zoom: int, dem_x: int, dem_y: int, _limit: int) -> Array:
	var level_x := dem_x
	var level_y := dem_y
	for level in range(from_zoom, SOURCE_MIN_ZOOM - 1, -1):
		var key := tile_key(level, level_x, level_y)
		if tiles.has(key):
			(tiles[key] as Dictionary)["used"] = _tick
			return [z, x, y, level, level_x, level_y]
		level_x = level_x >> 1
		level_y = level_y >> 1
	return [z, x, y, NONE, 0, 0]


func _start(plan: Dictionary) -> void:
	var windows: Dictionary = plan["windows"]
	var levels: Array = []
	var lowest := INF
	var highest := -INF
	var bare := false
	for item: Array in plan["used"]:
		if int(item[3]) >= LEVELS:
			bare = true
	for level in windows.keys():
		var window: Array = windows[level]
		var box_low: Vector2i = window[0]
		var box_high: Vector2i = window[1]
		var span := WORLD / float(1 << int(level))
		var placed: Array = []
		for tile_x in range(box_low.x, box_high.x + 1):
			for tile_y in range(box_low.y, box_high.y + 1):
				var key := tile_key(int(level), tile_x, tile_y)
				if not tiles.has(key):
					continue
				var tile: Dictionary = tiles[key]
				tile["used"] = _tick
				placed.append([tile["image"], tile_x - box_low.x, tile_y - box_low.y])
				lowest = minf(lowest, float(tile["min"]))
				highest = maxf(highest, float(tile["max"]))
		levels.append({
			"level": int(level),
			"rect": Rect2(Vector2(box_low) * span, Vector2(box_high - box_low + Vector2i.ONE) * span),
			"count": box_high - box_low + Vector2i.ONE,
			"tiles": placed,
		})
	if bare or levels.is_empty():
		lowest = minf(lowest, 0.0)
		highest = maxf(highest, 0.0)
	var job := {
		"key": int(plan["key"]),
		"levels": levels,
		"used": plan["used"],
		"cell": float(plan["cell"]),
		"origin": plan["origin"],
		"cells": plan["cells"],
		"low": lowest if is_finite(lowest) else 0.0,
		"high": highest if is_finite(highest) else 0.0,
	}
	_building = true
	_tasks.append(WorkerThreadPool.add_task(_build.bind(job), false, "terrain mosaic"))


func _build(job: Dictionary) -> void:
	var out_levels: Array = []
	for spec: Dictionary in job["levels"]:
		var count: Vector2i = spec["count"]
		var image := Image.create_empty(count.x * DEM_SIZE, count.y * DEM_SIZE, false, Image.FORMAT_RF)
		var have := {}
		for placed: Array in spec["tiles"]:
			var source: Image = placed[0]
			var at := Vector2i(int(placed[1]), int(placed[2]))
			have[at] = true
			image.blit_rect(source, Rect2i(0, 0, DEM_SIZE, DEM_SIZE), at * DEM_SIZE)
		for placed: Array in spec["tiles"]:
			var at := Vector2i(int(placed[1]), int(placed[2]))
			var origin := at * DEM_SIZE
			if at.x + 1 < count.x and not have.has(at + Vector2i(1, 0)):
				image.blit_rect(image.get_region(Rect2i(origin.x + DEM_SIZE - 1, origin.y, 1, DEM_SIZE)), Rect2i(0, 0, 1, DEM_SIZE), Vector2i(origin.x + DEM_SIZE, origin.y))
			if at.y + 1 < count.y and not have.has(at + Vector2i(0, 1)):
				image.blit_rect(image.get_region(Rect2i(origin.x, origin.y + DEM_SIZE - 1, DEM_SIZE, 1)), Rect2i(0, 0, DEM_SIZE, 1), Vector2i(origin.x, origin.y + DEM_SIZE))
			if at.x + 1 < count.x and at.y + 1 < count.y and not have.has(at + Vector2i(1, 1)):
				var right := have.has(at + Vector2i(1, 0))
				var below := have.has(at + Vector2i(0, 1))
				var from := Vector2i(origin.x + DEM_SIZE - 1, origin.y + DEM_SIZE - 1)
				if right:
					from = Vector2i(origin.x + DEM_SIZE, origin.y + DEM_SIZE - 1)
				elif below:
					from = Vector2i(origin.x + DEM_SIZE - 1, origin.y + DEM_SIZE)
				image.set_pixelv(Vector2i(origin.x + DEM_SIZE, origin.y + DEM_SIZE), image.get_pixelv(from))
		image.convert(Image.FORMAT_RH)
		var readable := image.duplicate() as Image
		readable.convert(Image.FORMAT_RF)
		out_levels.append({
			"level": spec["level"],
			"rect": spec["rect"],
			"size": Vector2i(image.get_width(), image.get_height()),
			"image": image,
			"data": readable.get_data().to_float32_array(),
		})
	var cells: Vector2i = job["cells"]
	var lod := PackedByteArray()
	lod.resize(maxi(cells.x * cells.y, 0))
	lod.fill(NONE)
	var cell: float = job["cell"]
	var origin: Vector2 = job["origin"]
	var used: Array = (job["used"] as Array).duplicate()
	used.sort_custom(func(a: Array, b: Array) -> bool: return int(a[0]) < int(b[0]))
	var present := {}
	for spec: Dictionary in out_levels:
		present[int(spec["level"])] = true
	for item: Array in used:
		var level := int(item[3])
		if level < LEVELS and not present.has(level):
			level = NONE
		var span := WORLD / float(1 << int(item[0]))
		var from_x := clampi(floori((int(item[1]) * span - origin.x) / cell + 0.0001), 0, cells.x)
		var from_y := clampi(floori((int(item[2]) * span - origin.y) / cell + 0.0001), 0, cells.y)
		var to_x := clampi(maxi(ceili(((int(item[1]) + 1) * span - origin.x) / cell - 0.0001), from_x + 1), 0, cells.x)
		var to_y := clampi(maxi(ceili(((int(item[2]) + 1) * span - origin.y) / cell - 0.0001), from_y + 1), 0, cells.y)
		for cy in range(from_y, to_y):
			for cx in range(from_x, to_x):
				lod[cy * cells.x + cx] = level
	_arrive.call_deferred(_built.bind({
		"key": job["key"],
		"levels": out_levels,
		"lod": lod,
		"cells": cells,
		"cell": cell,
		"origin": origin,
		"low": float(job["low"]) * EXAGGERATION,
		"high": float(job["high"]) * EXAGGERATION,
	}))


func _arrive(job: Callable) -> void:
	_arrivals.append(job)
	set_process(true)


func _process(_delta: float) -> void:
	var jobs := _arrivals
	_arrivals = []
	set_process(false)
	for job in jobs:
		job.call()


func _built(result: Dictionary) -> void:
	_building = false
	_reap()
	if not enabled:
		return
	_apply(result)


func _apply(result: Dictionary) -> void:
	_reset_levels()
	var finest := INF
	for spec: Dictionary in result["levels"]:
		var level := int(spec["level"])
		var size: Vector2i = spec["size"]
		level_rects[level] = spec["rect"]
		level_sizes[level] = size
		level_data[level] = spec["data"]
		level_textures[level] = _pooled(level, spec["image"])
		finest = minf(finest, (spec["rect"] as Rect2).size.x / float(size.x))
	var cells: Vector2i = result["cells"]
	lod_size = cells
	lod_cell = float(result["cell"])
	lod_rect = Rect2(result["origin"], Vector2(cells) * lod_cell)
	lod_data = result["lod"]
	if cells.x > 0 and cells.y > 0:
		var image := Image.create_from_data(cells.x, cells.y, false, Image.FORMAT_R8, lod_data)
		if lod_texture and lod_texture.get_size() == Vector2(cells) and lod_texture.get_format() == Image.FORMAT_R8:
			lod_texture.update(image)
		else:
			lod_texture = ImageTexture.create_from_image(image)
	low = float(result["low"])
	high = float(result["high"])
	step = finest if is_finite(finest) else 1.0
	has_data = not (result["levels"] as Array).is_empty()
	_shown = int(result["key"])
	revision += 1
	changed.emit()
	if not _again.is_empty() and not _building:
		var plan := _again
		_again = {}
		if int(plan["key"]) != _shown:
			_start(plan)


func _pooled(level: int, image: Image) -> ImageTexture:
	var texture: ImageTexture = _pool.get(level)
	if texture and texture.get_size() == Vector2(image.get_size()) and texture.get_format() == image.get_format():
		texture.update(image)
		return texture
	texture = ImageTexture.create_from_image(image)
	_pool[level] = texture
	return texture


func _cache_path(key: String) -> String:
	if map_view == null or map_view.basemap == null:
		return ""
	var root := str(map_view.basemap.cache_dir)
	if root.is_empty():
		return ""
	return root.path_join("terrarium").path_join(key + ".png")


func _request(key: String) -> void:
	if tiles.has(key) or _loading.has(key):
		return
	if _failed.has(key) and Time.get_ticks_msec() < int(_failed[key]):
		return
	_loading[key] = true
	_queue.append(key)


func _pump() -> void:
	while _active < MAX_REQUESTS and not _queue.is_empty():
		var key: String = _queue.pop_front()
		if tiles.has(key):
			_loading.erase(key)
			continue
		_active += 1
		var path := _cache_path(key)
		if not path.is_empty() and FileAccess.file_exists(path):
			_tasks.append(WorkerThreadPool.add_task(_decode_file.bind(key, path), false, "terrain tile"))
			continue
		_fetch(key)


func _fetch(key: String) -> void:
	var parts := key.split("/")
	var request := HTTPRequest.new()
	request.timeout = 20.0
	add_child(request)
	request.request_completed.connect(func(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
		request.queue_free()
		if result == HTTPRequest.RESULT_SUCCESS and code == 200 and not body.is_empty():
			_store(key, body)
			_tasks.append(WorkerThreadPool.add_task(_decode.bind(key, body), false, "terrain tile"))
		else:
			_decoded(key, null, 0.0, 0.0))
	if request.request(URL % [int(parts[0]), int(parts[1]), int(parts[2])]) != OK:
		request.queue_free()
		_decoded(key, null, 0.0, 0.0)


func _store(key: String, body: PackedByteArray) -> void:
	var path := _cache_path(key)
	if path.is_empty():
		return
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file:
		file.store_buffer(body)


func _decode_file(key: String, path: String) -> void:
	_decode(key, FileAccess.get_file_as_bytes(path))


func _decode(key: String, bytes: PackedByteArray) -> void:
	var image := Image.new()
	if bytes.is_empty() or image.load_png_from_buffer(bytes) != OK or image.get_width() != DEM_SIZE or image.get_height() != DEM_SIZE:
		_arrive.call_deferred(_decoded.bind(key, null, 0.0, 0.0))
		return
	image.convert(Image.FORMAT_RGBA8)
	var source := image.get_data()
	var count := DEM_SIZE * DEM_SIZE
	var values := PackedFloat32Array()
	values.resize(count)
	var lowest := INF
	var highest := -INF
	for index in range(count):
		var at := index * 4
		var value := float(source[at]) * 256.0 + float(source[at + 1]) + float(source[at + 2]) / 256.0 - 32768.0
		values[index] = value
		if value < lowest:
			lowest = value
		if value > highest:
			highest = value
	var heights := Image.create_from_data(DEM_SIZE, DEM_SIZE, false, Image.FORMAT_RF, values.to_byte_array())
	_arrive.call_deferred(_decoded.bind(key, heights, lowest, highest))


func _decoded(key: String, image: Image, lowest: float, highest: float) -> void:
	_active = maxi(0, _active - 1)
	_loading.erase(key)
	_reap()
	if image == null:
		_failed[key] = Time.get_ticks_msec() + RETRY_MS
	elif enabled:
		tiles[key] = {"image": image, "min": lowest, "max": highest, "used": _tick}
		_trim()
		_wanted = 0
		if globe:
			globe.relief_tile_arrived()
	_pump()


func _trim() -> void:
	if tiles.size() <= KEEP_TILES:
		return
	var keys: Array = tiles.keys()
	keys.sort_custom(func(a: String, b: String) -> bool: return int((tiles[a] as Dictionary)["used"]) < int((tiles[b] as Dictionary)["used"]))
	for index in range(keys.size() - KEEP_TILES):
		if int((tiles[keys[index]] as Dictionary)["used"]) >= _tick:
			break
		tiles.erase(keys[index])


func _reap() -> void:
	var kept: Array[int] = []
	for task in _tasks:
		if WorkerThreadPool.is_task_completed(task):
			WorkerThreadPool.wait_for_task_completion(task)
		else:
			kept.append(task)
	_tasks = kept


func busy() -> bool:
	return _building or _active > 0 or not _queue.is_empty()


func _exit_tree() -> void:
	for task in _tasks:
		WorkerThreadPool.wait_for_task_completion(task)
	_tasks.clear()
