class_name ImageLoader
extends Node

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
					var image := decode_gif(body)
					_deliver_image.call_deferred(url, image))
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


func _deliver(url: String, texture: Texture2D) -> void:
	_cache[url] = texture
	for callback in _waiting.get(url, []):
		(callback as Callable).call(texture)
	_waiting.erase(url)


static func is_gif(body: PackedByteArray) -> bool:
	return body.size() >= 6 and body[0] == 0x47 and body[1] == 0x49 and body[2] == 0x46 and body[3] == 0x38


static func decode(body: PackedByteArray) -> Texture2D:
	if body.size() < 4:
		return null
	if is_gif(body):
		var frame := decode_gif(body)
		return ImageTexture.create_from_image(frame) if frame else null
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
