class_name WorkshopSessionRaster
extends Node2D

const EARTH := 6378137.0
const COLUMNS := 32
const ROWS := 48

var texture: Texture2D
var crs := "EPSG:4326"
var bounds: Array = [-180.0, -85.0, 180.0, 85.0]


static func from_file(file: String, width: int, height: int, raster_crs: String, raster_bounds: Array) -> WorkshopSessionRaster:
	var bytes := FileAccess.get_file_as_bytes(file)
	if width <= 0 or height <= 0 or bytes.size() != width * height * 4 or raster_bounds.size() < 4:
		return null
	var layer := WorkshopSessionRaster.new()
	layer.texture = ImageTexture.create_from_image(Image.create_from_data(width, height, false, Image.FORMAT_RGBA8, bytes))
	layer.crs = raster_crs
	layer.bounds = [float(raster_bounds[0]), float(raster_bounds[1]), float(raster_bounds[2]), float(raster_bounds[3])]
	return layer


func _lonlat(u: float, v: float) -> Vector2:
	var x := lerpf(float(bounds[0]), float(bounds[2]), u)
	var y := lerpf(float(bounds[3]), float(bounds[1]), v)
	if crs == "EPSG:3857":
		return Vector2(rad_to_deg(x / EARTH), rad_to_deg(2.0 * atan(exp(y / EARTH)) - PI * 0.5))
	return Vector2(x, y)


func _draw() -> void:
	if texture == null:
		return
	var grid: Array[PackedVector2Array] = []
	for row in range(ROWS + 1):
		var line := PackedVector2Array()
		for column in range(COLUMNS + 1):
			var lonlat := _lonlat(float(column) / COLUMNS, float(row) / ROWS)
			line.append(MapView.CityLayer.ohproject(lonlat.x, lonlat.y))
		grid.append(line)
	var colors := PackedColorArray([Color.WHITE, Color.WHITE, Color.WHITE, Color.WHITE])
	for row in range(ROWS):
		var top := float(row) / ROWS
		var bottom := float(row + 1) / ROWS
		for column in range(COLUMNS):
			var left := float(column) / COLUMNS
			var right := float(column + 1) / COLUMNS
			draw_primitive(PackedVector2Array([grid[row][column], grid[row][column + 1], grid[row + 1][column + 1], grid[row + 1][column]]), colors, PackedVector2Array([Vector2(left, top), Vector2(right, top), Vector2(right, bottom), Vector2(left, bottom)]), texture)
