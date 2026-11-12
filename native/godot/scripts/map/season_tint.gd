class_name SeasonTint
extends Node

const WIDTH := 512
const CONSTRAINED_WIDTH := 256

const TINT_SHADER := """
shader_type canvas_item;
render_mode unshaded;
uniform float opacity = 0.18;
void fragment() {
	vec4 c = texture(TEXTURE, UV);
	if (c.a <= 0.0) {
		discard;
	}
	COLOR = vec4(c.rgb / c.a, c.a * opacity);
}
"""

var extras: Node
var map_view: MapView
var enabled := true
var date := ""
var _texture: ImageTexture
var _material: ShaderMaterial
var _sprites: Array[Sprite2D] = []
var _request := 0
var _shown := false


func setup(owner_extras: Node) -> void:
	extras = owner_extras
	map_view = extras.get("map_view")
	var shader := Shader.new()
	shader.code = TINT_SHADER
	_material = ShaderMaterial.new()
	_material.shader = shader


func set_enabled(value: bool) -> void:
	enabled = value
	_sync()


static func opacity_at(level: float) -> float:
	if level <= 2.0:
		return 0.18
	if level <= 6.0:
		return lerpf(0.18, 0.14, (level - 2.0) / 4.0)
	if level <= 10.0:
		return lerpf(0.14, 0.1, (level - 6.0) / 4.0)
	return 0.1


func on_zoom(level: float) -> void:
	_material.set_shader_parameter("opacity", opacity_at(level))


func rebuild() -> void:
	for sprite in _sprites:
		if is_instance_valid(sprite):
			sprite.queue_free()
	_sprites.clear()
	for slot in extras.call("slots", "season"):
		var sprite := Sprite2D.new()
		sprite.centered = false
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
		sprite.material = _material
		sprite.texture = _texture
		if _texture:
			sprite.scale = Vector2.ONE * (MapView.WORLD_WIDTH / float(_texture.get_width()))
		(slot as Node2D).add_child(sprite)
		_sprites.append(sprite)
	_sync()


func refresh() -> void:
	var world: Dictionary = extras.get("world")
	_shown = enabled and bool(world.get("seasons", false)) and not str(world.get("date", "")).is_empty()
	if not _shown:
		_sync()
		return
	var wanted := str(world.get("date", ""))
	if wanted == date and _texture != null:
		_sync()
		return
	var engine: EngineLink = extras.get("engine")
	if engine == null:
		return
	_request += 1
	var ticket := _request
	var settings: Dictionary = extras.get("settings")
	var width := CONSTRAINED_WIDTH if bool(settings.get("constrained", false)) else WIDTH
	var reply: Dictionary = await engine.request("mapextras.seasonTint", {"width": width})
	if ticket != _request or not bool(reply.get("ok", false)) or not (reply.get("result") is Dictionary):
		return
	var result: Dictionary = reply["result"]
	if bool(result.get("none", false)):
		_texture = null
		date = wanted
		_sync()
		return
	var tint_width := int(result.get("width", 0))
	var tint_height := int(result.get("height", 0))
	var bytes := Marshalls.base64_to_raw(str(result.get("data", "")))
	if tint_width <= 0 or tint_height <= 0 or bytes.size() != tint_width * tint_height * 4:
		return
	var image := Image.create_from_data(tint_width, tint_height, false, Image.FORMAT_RGBA8, bytes)
	image.premultiply_alpha()
	_texture = ImageTexture.create_from_image(image)
	date = str(result.get("date", wanted))
	for sprite in _sprites:
		if is_instance_valid(sprite):
			sprite.texture = _texture
			sprite.scale = Vector2(MapView.WORLD_WIDTH / float(tint_width), MapView.WORLD_WIDTH / float(tint_height))
	_sync()


func _sync() -> void:
	var world: Dictionary = extras.get("world") if extras else {}
	var visible := enabled and bool(world.get("seasons", false)) and _texture != null
	for sprite in _sprites:
		if is_instance_valid(sprite):
			sprite.visible = visible
