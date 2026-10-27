class_name WorkshopRegionOverlays
extends Node2D

const STRIPE_SHADER := "shader_type canvas_item;\nuniform float band = 7.0;\nvoid fragment() {\n\tfloat count = max(UV.y, 1.0);\n\tfloat size = count * band;\n\tfloat at = floor(mod(FRAGCOORD.x + FRAGCOORD.y, size) / band);\n\tif (abs(at - UV.x) > 0.5) {\n\t\tdiscard;\n\t}\n}\n"
const HATCH_SHADER := "shader_type canvas_item;\nvoid fragment() {\n\tif (mod(FRAGCOORD.x + FRAGCOORD.y, 10.0) > 1.98) {\n\t\tdiscard;\n\t}\n}\n"
const HATCH_INK := Color(226 / 255.0, 242 / 255.0, 1.0, 0.85)
const HATCH_EDGE := Color(226 / 255.0, 242 / 255.0, 1.0, 0.55)
const CASING := Color(5 / 255.0, 8 / 255.0, 13 / 255.0, 0.55)

var stripes: Array = []
var hatch: Array = []
var outlines: Array = []
var show_regions := true
var show_groups := true
var show_freezing := true
var _stripe_layer: Node2D
var _hatch_layer: Node2D
var _line_layer: Node2D
var _zoom := 1.0


func _init() -> void:
	z_index = 1
	_stripe_layer = _layer(STRIPE_SHADER, _draw_stripes)
	_hatch_layer = _layer(HATCH_SHADER, _draw_hatch)
	_line_layer = _layer("", _draw_lines)


func _layer(code: String, painter: Callable) -> Node2D:
	var node := Painter.new()
	node.painter = painter
	if not code.is_empty():
		var shader := Shader.new()
		shader.code = code
		var material := ShaderMaterial.new()
		material.shader = shader
		node.material = material
	add_child(node)
	return node


static func _world_rings(rings: Array) -> Array:
	var out: Array = []
	for ring in rings:
		var points := PackedVector2Array()
		for coord in ring:
			points.append(MapView.CityLayer.ohproject(float(coord[0]), float(coord[1])))
		if points.size() > 1 and points[0].is_equal_approx(points[points.size() - 1]):
			points.remove_at(points.size() - 1)
		if points.size() < 3:
			continue
		var triangles := Geometry2D.triangulate_polygon(points)
		if triangles.size() >= 3:
			out.append([points, triangles])
	return out


func set_data(data: Dictionary) -> void:
	stripes = []
	for entry in data.get("stripes", []):
		var row: Dictionary = entry
		var colors: Array = []
		for rgb in row.get("colors", []):
			colors.append(Color8(int(rgb[0]), int(rgb[1]), int(rgb[2])))
		stripes.append({"polygons": _world_rings(row.get("rings", [])), "colors": colors, "alpha": float(row.get("alpha", 0.5))})
	hatch = []
	for entry in data.get("hatch", []):
		hatch.append(_world_rings((entry as Dictionary).get("rings", [])))
	outlines = []
	for entry in data.get("outlines", []):
		var row: Dictionary = entry
		var color := Color.html(str(row.get("color", "#e11d48"))) if Color.html_is_valid(str(row.get("color", "#e11d48"))) else Color("#e11d48")
		for line in row.get("lines", []):
			var points := PackedVector2Array()
			for coord in line:
				points.append(MapView.CityLayer.ohproject(float(coord[0]), float(coord[1])))
			if points.size() >= 2:
				outlines.append([points, color])
	refresh()


func set_zoom(zoom: float) -> void:
	if is_equal_approx(zoom, _zoom):
		return
	_zoom = zoom
	_line_layer.queue_redraw()


func refresh() -> void:
	_stripe_layer.visible = show_regions
	_hatch_layer.visible = show_freezing
	_line_layer.visible = true
	_stripe_layer.queue_redraw()
	_hatch_layer.queue_redraw()
	_line_layer.queue_redraw()


func _triangles(canvas: Node2D, polygon: Array, color: Color, uv: Vector2) -> void:
	var points: PackedVector2Array = polygon[0]
	var colors := PackedColorArray()
	colors.resize(points.size())
	colors.fill(color)
	var uvs := PackedVector2Array()
	uvs.resize(points.size())
	uvs.fill(uv)
	RenderingServer.canvas_item_add_triangle_array(canvas.get_canvas_item(), polygon[1], points, colors, uvs)


func _draw_stripes(canvas: Node2D) -> void:
	for entry in stripes:
		var row: Dictionary = entry
		var colors: Array = row["colors"]
		for index in range(colors.size()):
			var color: Color = colors[index]
			color.a = float(row["alpha"])
			for polygon in row["polygons"]:
				_triangles(canvas, polygon, color, Vector2(index, colors.size()))


func _draw_hatch(canvas: Node2D) -> void:
	for polygons in hatch:
		for polygon in polygons:
			_triangles(canvas, polygon, HATCH_INK, Vector2.ZERO)


func _draw_lines(canvas: Node2D) -> void:
	var pixel := 1.0 / maxf(_zoom, 0.0001)
	if show_freezing:
		for polygons in hatch:
			for polygon in polygons:
				var ring: PackedVector2Array = (polygon[0] as PackedVector2Array).duplicate()
				ring.append(ring[0])
				canvas.draw_polyline(ring, HATCH_EDGE, pixel, true)
	if not show_groups:
		return
	for entry in outlines:
		canvas.draw_polyline(entry[0], CASING, 5.0 * pixel, true)
	for entry in outlines:
		canvas.draw_polyline(entry[0], entry[1], 2.6 * pixel, true)


class Painter extends Node2D:
	var painter: Callable

	func _draw() -> void:
		if painter.is_valid():
			painter.call(self)
