class_name WorkshopThumbnail
extends RefCounted

const SEA := Color("#0b1a2b")
const WORLD := 4096.0
const FILL_SHADER := "shader_type canvas_item;\nrender_mode unshaded;\nuniform sampler2D fills : filter_nearest;\nvarying vec4 tint;\nvoid vertex() {\n\tint region = int(UV.x + 0.5);\n\ttint = texelFetch(fills, ivec2(region % 1024, region / 1024), 0);\n}\nvoid fragment() {\n\tCOLOR = tint;\n}\n"


static func data_url(image: Image, quality: float) -> String:
	var source := image.duplicate() as Image
	if source.is_compressed():
		source.decompress()
	if source.get_format() != Image.FORMAT_RGBA8:
		source.convert(Image.FORMAT_RGBA8)
	var flat := Image.create_empty(source.get_width(), source.get_height(), false, Image.FORMAT_RGBA8)
	flat.fill(Color(0, 0, 0, 1))
	flat.blend_rect(source, Rect2i(Vector2i.ZERO, source.get_size()), Vector2i.ZERO)
	flat.convert(Image.FORMAT_RGB8)
	return "data:image/jpeg;base64," + Marshalls.raw_to_base64(flat.save_jpg_to_buffer(quality))


static func picture(image: Image, max_dim := 200) -> String:
	var width := maxi(1, image.get_width())
	var height := maxi(1, image.get_height())
	var scale := minf(1.0, float(max_dim) / float(maxi(width, height)))
	var copy := image.duplicate() as Image
	if copy.is_compressed():
		copy.decompress()
	if scale < 1.0:
		copy.resize(maxi(1, roundi(width * scale)), maxi(1, roundi(height * scale)), Image.INTERPOLATE_CUBIC)
	return data_url(copy, 0.7)


static func load_still(path: String) -> Image:
	var bytes := FileAccess.get_file_as_bytes(path)
	if ImageLoader.is_gif(bytes):
		return ImageLoader.decode_gif(bytes)
	var image := Image.new()
	return image if image.load(path) == OK else null


static func picture_file(file: String, max_dim := 200) -> String:
	var image := Image.new()
	if file.is_empty() or image.load(file) != OK or image.get_width() <= 0:
		return ""
	return picture(image, max_dim)


static func drawn(host: Node, source: Variant, max_dim := 220) -> String:
	if not (source is Dictionary):
		return ""
	var spec: Dictionary = source
	var file := str(spec.get("file", ""))
	var bbox: Variant = spec.get("bbox")
	if file.is_empty() or not (bbox is Array) or (bbox as Array).size() < 4:
		return ""
	var min_x := float(bbox[0])
	var min_y := float(bbox[1])
	var width := float(bbox[2]) - min_x
	var height := float(bbox[3]) - min_y
	if width == 0.0:
		width = 1.0
	if height == 0.0:
		height = 1.0
	var scale := minf(max_dim / width, max_dim / height)
	var size := Vector2i(maxi(1, roundi(width * scale)), maxi(1, roundi(height * scale)))
	var baker := MapBaker.new()
	host.add_child(baker)
	var outcome := [null]
	baker.baked.connect(func(result: Dictionary) -> void: outcome[0] = result)
	baker.failed.connect(func(_message: String) -> void: outcome[0] = {})
	baker.bake_file(file, WORLD)
	while outcome[0] == null and is_instance_valid(baker) and is_instance_valid(host):
		await host.get_tree().process_frame
	if not is_instance_valid(host):
		return ""
	baker.queue_free()
	var data: Dictionary = outcome[0] if outcome[0] is Dictionary else {}
	var indices: PackedInt32Array = data.get("indices", PackedInt32Array())
	var viewport := SubViewport.new()
	viewport.size = size
	viewport.transparent_bg = false
	viewport.disable_3d = true
	viewport.msaa_2d = Viewport.MSAA_4X
	viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	var sea := ColorRect.new()
	sea.color = SEA
	sea.size = Vector2(size)
	viewport.add_child(sea)
	if indices.size() > 0:
		var fill_list: Array = spec.get("fills", []) if spec.get("fills") is Array else []
		var rows := maxi(1, ceili(float(maxi(fill_list.size(), 1)) / 1024.0))
		var fills := Image.create_empty(1024, rows, false, Image.FORMAT_RGBA8)
		fills.fill(Color8(0x33, 0x43, 0x5c))
		for index in range(fill_list.size()):
			var rgb: Variant = fill_list[index]
			if rgb is Array and (rgb as Array).size() >= 3:
				var alpha := float(rgb[3]) if (rgb as Array).size() > 3 else 1.0
				fills.set_pixel(index % 1024, index / 1024, Color(float(rgb[0]) / 255.0, float(rgb[1]) / 255.0, float(rgb[2]) / 255.0, alpha))
		var shader := Shader.new()
		shader.code = FILL_SHADER
		var material := ShaderMaterial.new()
		material.shader = shader
		material.set_shader_parameter("fills", ImageTexture.create_from_image(fills))
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = data["vertices"]
		arrays[Mesh.ARRAY_TEX_UV] = data["uvs"]
		arrays[Mesh.ARRAY_INDEX] = indices
		var mesh := ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		var shape := MeshInstance2D.new()
		shape.mesh = mesh
		shape.material = material
		var k := 360.0 / WORLD * scale
		shape.scale = Vector2(k, k)
		shape.position = Vector2(-(min_x + 180.0) * scale, -(180.0 - float(bbox[3])) * scale)
		viewport.add_child(shape)
	host.add_child(viewport)
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	if not is_instance_valid(viewport):
		return ""
	var image := viewport.get_texture().get_image()
	viewport.queue_free()
	if image == null or image.is_empty():
		return ""
	return data_url(image, 0.75)
