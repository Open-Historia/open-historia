class_name ImageLoader
extends Node

const GIF_PIXEL_BUDGET := 24000000

static var link: EngineLink
static var avif_dir := ""
static var avif_missing := false

var origin := ""
var _cache := {}
var _waiting := {}
var _queue: Array[String] = []
var _active := 0


func fetch(url: String, done: Callable) -> void:
	if url.is_empty() or origin.is_empty():
		return
	if _cache.has(url):
		done.call(_cache[url])
		return
	if _waiting.has(url):
		(_waiting[url] as Array).append(done)
		return
	_waiting[url] = [done]
	_queue.append(url)
	_pump()


func _pump() -> void:
	while _active < 4 and not _queue.is_empty():
		var url: String = _queue.pop_front()
		_active += 1
		var request := HTTPRequest.new()
		add_child(request)
		request.request_completed.connect(func(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
			_active -= 1
			request.queue_free()
			if result == HTTPRequest.RESULT_SUCCESS and code == 200 and is_gif(body):
				WorkerThreadPool.add_task(func() -> void:
					var frames := gif_frames(body)
					_deliver_gif.call_deferred(url, frames))
				_pump()
				return
			if result == HTTPRequest.RESULT_SUCCESS and code == 200 and is_avif(body):
				_deliver_avif(weakref(self), url, body)
				_pump()
				return
			var texture: Texture2D = null
			if result == HTTPRequest.RESULT_SUCCESS and code == 200:
				texture = decode(body)
			_deliver(url, texture)
			_pump())
		if request.request(origin + url) != OK:
			_active -= 1
			request.queue_free()
			_waiting.erase(url)


func _deliver_image(url: String, image: Image) -> void:
	_deliver(url, ImageTexture.create_from_image(image) if image else null)


func _deliver_gif(url: String, frames: Dictionary) -> void:
	_deliver(url, texture_from_gif(frames))


static func _deliver_avif(owner: WeakRef, url: String, body: PackedByteArray) -> void:
	var data: Dictionary = await avif_frames(body)
	var loader := owner.get_ref() as ImageLoader
	if loader != null:
		loader._deliver(url, texture_from_gif(data))


func _deliver(url: String, texture: Texture2D) -> void:
	_cache[url] = texture
	for callback in _waiting.get(url, []):
		(callback as Callable).call(texture)
	_waiting.erase(url)


static func is_gif(body: PackedByteArray) -> bool:
	return body.size() >= 6 and body[0] == 0x47 and body[1] == 0x49 and body[2] == 0x46 and body[3] == 0x38


static func is_avif(body: PackedByteArray) -> bool:
	if body.size() < 16 or body[4] != 0x66 or body[5] != 0x74 or body[6] != 0x79 or body[7] != 0x70:
		return false
	var box := (body[0] << 24) | (body[1] << 16) | (body[2] << 8) | body[3]
	var end := mini(body.size(), clampi(box, 16, 256))
	var at := 8
	while at + 4 <= end:
		if at != 12:
			var brand := body.slice(at, at + 4).get_string_from_ascii()
			if brand == "avif" or brand == "avis":
				return true
		at += 4
	return false


static func is_avif_sequence(body: PackedByteArray) -> bool:
	if not is_avif(body) or body.slice(8, 12).get_string_from_ascii() == "avif":
		return false
	var at := 0
	while at + 8 <= body.size():
		var size := (body[at] << 24) | (body[at + 1] << 16) | (body[at + 2] << 8) | body[at + 3]
		if body.slice(at + 4, at + 8).get_string_from_ascii() == "moov":
			return true
		if size == 1 and at + 16 <= body.size() and body[at + 8] == 0 and body[at + 9] == 0 and body[at + 10] == 0 and body[at + 11] == 0:
			size = (body[at + 12] << 24) | (body[at + 13] << 16) | (body[at + 14] << 8) | body[at + 15]
		if size < 8:
			return false
		at += size
	return false


static func avif_size(body: PackedByteArray) -> Vector2i:
	var limit := mini(body.size(), 65536) - 16
	var at := body.find(0x69, 8)
	while at >= 0 and at <= limit:
		if body[at + 1] == 0x73 and body[at + 2] == 0x70 and body[at + 3] == 0x65:
			var width := (body[at + 8] << 24) | (body[at + 9] << 16) | (body[at + 10] << 8) | body[at + 11]
			var height := (body[at + 12] << 24) | (body[at + 13] << 16) | (body[at + 14] << 8) | body[at + 15]
			if width > 0 and height > 0 and width <= 65535 and height <= 65535:
				return Vector2i(height, width) if _avif_turned(body, limit) else Vector2i(width, height)
		at = body.find(0x69, at + 1)
	var start := (body[0] << 24) | (body[1] << 16) | (body[2] << 8) | body[3]
	at = body.find(0x61, maxi(start, 8))
	while at >= 0 and at <= limit - 16:
		if body[at + 1] == 0x76 and body[at + 2] == 0x30 and body[at + 3] == 0x31:
			var track_width := (body[at + 28] << 8) | body[at + 29]
			var track_height := (body[at + 30] << 8) | body[at + 31]
			if track_width > 0 and track_height > 0:
				return Vector2i(track_width, track_height)
		at = body.find(0x61, at + 1)
	return Vector2i.ZERO


static func _avif_turned(body: PackedByteArray, limit: int) -> bool:
	var at := body.find(0x69, 8)
	while at >= 0 and at <= limit:
		if body[at + 1] == 0x72 and body[at + 2] == 0x6F and body[at + 3] == 0x74:
			return (body[at + 4] & 1) == 1
		at = body.find(0x69, at + 1)
	return false


static func avif_key(body: PackedByteArray) -> String:
	var hashing := HashingContext.new()
	hashing.start(HashingContext.HASH_SHA256)
	hashing.update(body)
	return hashing.finish().hex_encode()


static func avif_cached(body: PackedByteArray) -> Image:
	if avif_dir.is_empty():
		return null
	var file := avif_dir.path_join(avif_key(body) + ".png")
	if not FileAccess.file_exists(file):
		return null
	var image := Image.new()
	if image.load_png_from_buffer(FileAccess.get_file_as_bytes(file)) != OK or image.is_empty():
		return null
	return image


static func avif_cached_frames(body: PackedByteArray) -> Dictionary:
	if avif_dir.is_empty():
		return {}
	var manifest_path := avif_dir.path_join(avif_key(body) + ".json")
	if not FileAccess.file_exists(manifest_path):
		return {}
	var manifest: Variant = JSON.parse_string(FileAccess.get_file_as_string(manifest_path))
	return _frames_from(avif_dir, manifest) if manifest is Dictionary else {}


static func _frames_from(dir: String, manifest: Dictionary) -> Dictionary:
	var names: Array = manifest.get("frames", []) if manifest.get("frames") is Array else []
	var durations: Array = manifest.get("durations", []) if manifest.get("durations") is Array else []
	var frames: Array = []
	var delays := PackedFloat32Array()
	var pixels := 0
	for index in range(names.size()):
		if frames.size() >= AnimatedTexture.MAX_FRAMES:
			break
		var image := Image.new()
		if image.load_png_from_buffer(FileAccess.get_file_as_bytes(dir.path_join(str(names[index]).get_file()))) != OK or image.is_empty():
			break
		var area := image.get_width() * image.get_height()
		if not frames.is_empty() and pixels + area > GIF_PIXEL_BUDGET:
			break
		pixels += area
		frames.append(image)
		delays.append(float(durations[index]) if index < durations.size() else 0.1)
	if frames.is_empty():
		return {}
	return {"frames": frames, "delays": delays, "loops": int(manifest.get("loops", -1))}


static func avif_frames(body: PackedByteArray) -> Dictionary:
	var cached := avif_cached_frames(body)
	if not cached.is_empty() or avif_missing:
		return cached
	var engine := _avif_link()
	if engine == null:
		return {}
	var reply: Dictionary = await engine.request("image.avif", {"data": Marshalls.raw_to_base64(body)})
	var result: Dictionary = reply["result"] if reply.get("ok", false) and reply.get("result") is Dictionary else {}
	if not result.get("ok", false):
		if result.get("missing", false):
			avif_missing = true
		return {}
	var png := str(result.get("png", "")).replace("\\", "/")
	if png.is_empty():
		return {}
	if avif_dir.is_empty():
		avif_dir = png.get_base_dir()
	var names: Array = []
	for frame in (result.get("frames", [png]) if result.get("frames") is Array else [png]):
		names.append(str(frame).replace("\\", "/").get_file())
	return _frames_from(png.get_base_dir(), {"frames": names, "durations": result.get("durations", []), "loops": result.get("loops", -1)})


static func avif_image(body: PackedByteArray) -> Image:
	var cached := avif_cached(body)
	if cached != null or avif_missing:
		return cached
	var engine := _avif_link()
	if engine == null:
		return null
	var reply: Dictionary = await engine.request("image.avif", {"data": Marshalls.raw_to_base64(body)})
	var result: Dictionary = reply["result"] if reply.get("ok", false) and reply.get("result") is Dictionary else {}
	if not result.get("ok", false):
		if result.get("missing", false):
			avif_missing = true
		return null
	var png := str(result.get("png", "")).replace("\\", "/")
	if png.is_empty():
		return null
	if avif_dir.is_empty():
		avif_dir = png.get_base_dir()
	var image := Image.new()
	if image.load_png_from_buffer(FileAccess.get_file_as_bytes(png)) != OK or image.is_empty():
		return null
	return image


static func avif_texture(body: PackedByteArray) -> Texture2D:
	var cached := avif_cached_frames(body)
	if not cached.is_empty():
		return texture_from_gif(cached)
	var sequence := is_avif_sequence(body)
	var still := avif_cached(body)
	if still != null and not sequence:
		return ImageTexture.create_from_image(still)
	if avif_missing or _avif_link() == null:
		return ImageTexture.create_from_image(still) if still != null else null
	var texture := ImageTexture.create_from_image(Image.create_empty(1, 1, false, Image.FORMAT_RGBA8))
	var size := avif_size(body)
	if size.x > 0 and size.y > 0:
		texture.set_size_override(size)
	if sequence:
		var animated := AnimatedTexture.new()
		animated.frames = 1
		animated.set_frame_texture(0, texture)
		_fill_avif_animation(animated, body)
		return animated
	_fill_avif(texture, body)
	return texture


static func _fill_avif_animation(animated: AnimatedTexture, body: PackedByteArray) -> void:
	var data: Dictionary = await avif_frames(body)
	if not data.is_empty():
		_animate(animated, data)


static func _fill_avif(texture: ImageTexture, body: PackedByteArray) -> void:
	var image: Image = await avif_image(body)
	if image != null:
		texture.set_image(image)


static func _avif_link() -> EngineLink:
	if is_instance_valid(link):
		return link
	link = null
	var tree := Engine.get_main_loop() as SceneTree
	if tree == null:
		return null
	for child in tree.root.get_children():
		var candidate: Variant = child.get("engine")
		if is_instance_valid(candidate) and candidate is EngineLink:
			link = candidate
			return link
	var found := tree.root.find_children("*", "EngineLink", true, false)
	if not found.is_empty():
		link = found[0] as EngineLink
	return link


static func decode(body: PackedByteArray) -> Texture2D:
	if body.size() < 4:
		return null
	if is_gif(body):
		return texture_from_gif(gif_frames(body))
	if is_avif(body):
		return avif_texture(body)
	var image := Image.new()
	var status := ERR_FILE_UNRECOGNIZED
	if body[0] == 0x89 and body[1] == 0x50:
		status = image.load_png_from_buffer(body)
	elif body[0] == 0xFF and body[1] == 0xD8:
		status = image.load_jpg_from_buffer(body)
	elif body[0] == 0x52 and body[1] == 0x49:
		status = image.load_webp_from_buffer(body)
	if status != OK:
		return null
	return ImageTexture.create_from_image(image)


static func decode_async(host: Node, body: PackedByteArray) -> Texture2D:
	if is_avif(body):
		var data: Dictionary = await avif_frames(body)
		return texture_from_gif(data) if is_instance_valid(host) else null
	if not is_gif(body):
		return decode(body)
	var frames := [{}]
	var task := WorkerThreadPool.add_task(func() -> void: frames[0] = gif_frames(body))
	while not WorkerThreadPool.is_task_completed(task):
		if not is_instance_valid(host) or not host.is_inside_tree():
			WorkerThreadPool.wait_for_task_completion(task)
			return null
		await host.get_tree().process_frame
	WorkerThreadPool.wait_for_task_completion(task)
	return texture_from_gif(frames[0])


static func texture_from_file(path: String) -> Texture2D:
	var body := FileAccess.get_file_as_bytes(path)
	if is_gif(body):
		return texture_from_gif(gif_frames(body))
	if is_avif(body):
		return avif_texture(body)
	var image := Image.load_from_file(path)
	return ImageTexture.create_from_image(image) if image and not image.is_empty() else null


static func texture_from_gif(data: Dictionary) -> Texture2D:
	var frames: Array = data.get("frames", [])
	if frames.is_empty():
		return null
	if frames.size() == 1:
		return ImageTexture.create_from_image(frames[0])
	var animated := AnimatedTexture.new()
	_animate(animated, data)
	return animated


static func _animate(animated: AnimatedTexture, data: Dictionary) -> void:
	var frames: Array = data.get("frames", [])
	var delays: PackedFloat32Array = data.get("delays", PackedFloat32Array())
	var loops := int(data.get("loops", -1))
	var kept := mini(frames.size(), AnimatedTexture.MAX_FRAMES)
	var plays := loops + 1 if loops > 0 and kept * (loops + 1) <= AnimatedTexture.MAX_FRAMES else 1
	var textures: Array = []
	for index in range(kept):
		textures.append(ImageTexture.create_from_image(frames[index]))
	animated.frames = kept * plays
	for index in range(kept * plays):
		var source := index % kept
		animated.set_frame_texture(index, textures[source])
		animated.set_frame_duration(index, delays[source] if source < delays.size() else 0.1)
	animated.one_shot = kept > 1 and (loops == 0 or plays > 1)


static func gif_frames(body: PackedByteArray, budget := GIF_PIXEL_BUDGET) -> Dictionary:
	var out := {"frames": [], "delays": PackedFloat32Array()}
	if body.size() < 13 or not is_gif(body):
		return out
	var width := body[6] | (body[7] << 8)
	var height := body[8] | (body[9] << 8)
	if width <= 0 or height <= 0:
		return out
	var packed := body[10]
	var at := 13
	var palette := PackedByteArray()
	if packed & 0x80:
		var count := 3 * (1 << ((packed & 7) + 1))
		palette = body.slice(at, at + count)
		at += count
	var canvas := PackedByteArray()
	canvas.resize(width * height * 4)
	var transparent := -1
	var delay := 0
	var disposal := 0
	var frames: Array = []
	var delays := PackedFloat32Array()
	while at < body.size():
		var block := body[at]
		at += 1
		if block == 0x21:
			if at >= body.size():
				break
			var label := body[at]
			at += 1
			if label == 0xF9 and at + 4 < body.size() and body[at] >= 4:
				var flags := body[at + 1]
				delay = body[at + 2] | (body[at + 3] << 8)
				transparent = body[at + 4] if flags & 1 else -1
				disposal = (flags >> 2) & 7
			while at < body.size():
				var length := body[at]
				at += 1
				if length == 0:
					break
				at += length
		elif block == 0x2C:
			if at + 9 > body.size():
				break
			var left := body[at] | (body[at + 1] << 8)
			var top := body[at + 2] | (body[at + 3] << 8)
			var frame_width := body[at + 4] | (body[at + 5] << 8)
			var frame_height := body[at + 6] | (body[at + 7] << 8)
			var frame_packed := body[at + 8]
			at += 9
			var frame_palette := palette
			if frame_packed & 0x80:
				var local_count := 3 * (1 << ((frame_packed & 7) + 1))
				frame_palette = body.slice(at, at + local_count)
				at += local_count
			if at >= body.size() or frame_palette.is_empty():
				break
			var minimum := body[at]
			at += 1
			var data := PackedByteArray()
			while at < body.size():
				var length := body[at]
				at += 1
				if length == 0:
					break
				data.append_array(body.slice(at, at + length))
				at += length
			var previous := canvas.duplicate() if disposal == 3 else PackedByteArray()
			canvas = _paint(canvas, _lzw(data, minimum, frame_width * frame_height), frame_palette, transparent, width, height, left, top, frame_width, frame_height, bool(frame_packed & 0x40))
			frames.append(Image.create_from_data(width, height, false, Image.FORMAT_RGBA8, canvas.duplicate()))
			delays.append(0.1 if delay <= 1 else delay / 100.0)
			if frames.size() >= AnimatedTexture.MAX_FRAMES or (frames.size() + 1) * width * height > budget:
				break
			if disposal == 2:
				canvas = _clear(canvas, width, height, left, top, frame_width, frame_height)
			elif disposal == 3:
				canvas = previous
			transparent = -1
			delay = 0
			disposal = 0
		elif block == 0x3B:
			break
		else:
			break
	out["frames"] = frames
	out["delays"] = delays
	return out


static func _clear(canvas: PackedByteArray, width: int, height: int, left: int, top: int, frame_width: int, frame_height: int) -> PackedByteArray:
	for y in range(maxi(0, top), mini(height, top + frame_height)):
		for x in range(maxi(0, left), mini(width, left + frame_width)):
			var at := (y * width + x) * 4
			canvas[at] = 0
			canvas[at + 1] = 0
			canvas[at + 2] = 0
			canvas[at + 3] = 0
	return canvas


static func _paint(canvas: PackedByteArray, indices: PackedByteArray, palette: PackedByteArray, transparent: int, width: int, height: int, left: int, top: int, frame_width: int, frame_height: int, interlaced: bool) -> PackedByteArray:
	var rows := PackedInt32Array()
	if interlaced:
		for pass_rule in [[0, 8], [4, 8], [2, 4], [1, 2]]:
			var row: int = pass_rule[0]
			while row < frame_height:
				rows.append(row)
				row += int(pass_rule[1])
	else:
		rows.resize(frame_height)
		for row in range(frame_height):
			rows[row] = row
	var colors := palette.size() / 3
	var source := 0
	for line in range(rows.size()):
		var y := top + rows[line]
		if y < 0 or y >= height:
			source += frame_width
			continue
		var target := (y * width + left) * 4
		for x in range(frame_width):
			var index := indices[source]
			source += 1
			if index == transparent or index >= colors or left + x >= width:
				target += 4
				continue
			var from := index * 3
			canvas[target] = palette[from]
			canvas[target + 1] = palette[from + 1]
			canvas[target + 2] = palette[from + 2]
			canvas[target + 3] = 255
			target += 4
	return canvas


static func decode_gif(body: PackedByteArray) -> Image:
	if body.size() < 13 or not is_gif(body):
		return null
	var width := body[6] | (body[7] << 8)
	var height := body[8] | (body[9] << 8)
	if width <= 0 or height <= 0:
		return null
	var packed := body[10]
	var at := 13
	var palette := PackedByteArray()
	if packed & 0x80:
		var count := 3 * (1 << ((packed & 7) + 1))
		palette = body.slice(at, at + count)
		at += count
	var transparent := -1
	while at < body.size():
		var block := body[at]
		at += 1
		if block == 0x21:
			if at >= body.size():
				return null
			var label := body[at]
			at += 1
			if label == 0xF9 and at + 4 < body.size() and body[at] >= 4:
				transparent = body[at + 4] if body[at + 1] & 1 else -1
			while at < body.size():
				var length := body[at]
				at += 1
				if length == 0:
					break
				at += length
		elif block == 0x2C:
			if at + 9 > body.size():
				return null
			var left := body[at] | (body[at + 1] << 8)
			var top := body[at + 2] | (body[at + 3] << 8)
			var frame_width := body[at + 4] | (body[at + 5] << 8)
			var frame_height := body[at + 6] | (body[at + 7] << 8)
			var frame_packed := body[at + 8]
			at += 9
			if frame_packed & 0x80:
				var local_count := 3 * (1 << ((frame_packed & 7) + 1))
				palette = body.slice(at, at + local_count)
				at += local_count
			if at >= body.size() or palette.is_empty():
				return null
			var minimum := body[at]
			at += 1
			var data := PackedByteArray()
			while at < body.size():
				var length := body[at]
				at += 1
				if length == 0:
					break
				data.append_array(body.slice(at, at + length))
				at += length
			var indices := _lzw(data, minimum, frame_width * frame_height)
			return _compose(indices, palette, transparent, width, height, left, top, frame_width, frame_height, bool(frame_packed & 0x40))
		elif block == 0x3B:
			break
		else:
			return null
	return null


static func _lzw(data: PackedByteArray, minimum: int, total: int) -> PackedByteArray:
	var pixels := PackedByteArray()
	pixels.resize(total)
	if minimum < 1 or minimum > 11:
		return pixels
	var clear := 1 << minimum
	var finish := clear + 1
	var code_size := minimum + 1
	var mask := (1 << code_size) - 1
	var available := clear + 2
	var old := -1
	var first := 0
	var prefix := PackedInt32Array()
	prefix.resize(4096)
	var suffix := PackedByteArray()
	suffix.resize(4096)
	for index in range(clear):
		suffix[index] = index
	var stack := PackedByteArray()
	stack.resize(4097)
	var datum := 0
	var bits := 0
	var read := 0
	var written := 0
	var size := data.size()
	while written < total:
		while bits < code_size and read < size:
			datum |= data[read] << bits
			bits += 8
			read += 1
		if bits < code_size:
			break
		var code := datum & mask
		datum >>= code_size
		bits -= code_size
		if code == clear:
			code_size = minimum + 1
			mask = (1 << code_size) - 1
			available = clear + 2
			old = -1
			continue
		if code == finish:
			break
		if old == -1:
			if code >= clear:
				break
			pixels[written] = suffix[code]
			written += 1
			old = code
			first = code
			continue
		var incoming := code
		var depth := 0
		if code >= available:
			stack[depth] = first
			depth += 1
			code = old
		while code >= clear and depth < 4096:
			stack[depth] = suffix[code]
			depth += 1
			code = prefix[code]
		first = suffix[code]
		stack[depth] = first
		depth += 1
		if available < 4096:
			prefix[available] = old
			suffix[available] = first
			available += 1
			if available >= (1 << code_size) and code_size < 12:
				code_size += 1
				mask = (1 << code_size) - 1
		old = incoming
		while depth > 0 and written < total:
			depth -= 1
			pixels[written] = stack[depth]
			written += 1
	return pixels


static func _compose(indices: PackedByteArray, palette: PackedByteArray, transparent: int, width: int, height: int, left: int, top: int, frame_width: int, frame_height: int, interlaced: bool) -> Image:
	var rgba := PackedByteArray()
	rgba.resize(width * height * 4)
	var rows := PackedInt32Array()
	if interlaced:
		for pass_rule in [[0, 8], [4, 8], [2, 4], [1, 2]]:
			var row: int = pass_rule[0]
			while row < frame_height:
				rows.append(row)
				row += int(pass_rule[1])
	else:
		rows.resize(frame_height)
		for row in range(frame_height):
			rows[row] = row
	var colors := palette.size() / 3
	var source := 0
	for line in range(rows.size()):
		var y := top + rows[line]
		if y < 0 or y >= height:
			source += frame_width
			continue
		var target := (y * width + left) * 4
		for x in range(frame_width):
			var index := indices[source]
			source += 1
			if index == transparent or index >= colors or left + x >= width:
				target += 4
				continue
			var from := index * 3
			rgba[target] = palette[from]
			rgba[target + 1] = palette[from + 1]
			rgba[target + 2] = palette[from + 2]
			rgba[target + 3] = 255
			target += 4
	return Image.create_from_data(width, height, false, Image.FORMAT_RGBA8, rgba)
