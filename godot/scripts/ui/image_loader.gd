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
			var texture: Texture2D = null
			if result == HTTPRequest.RESULT_SUCCESS and code == 200:
				texture = decode(body)
			_cache[url] = texture
			for callback in _waiting.get(url, []):
				(callback as Callable).call(texture)
			_waiting.erase(url)
			_pump())
		if request.request(origin + url) != OK:
			_active -= 1
			request.queue_free()
			_waiting.erase(url)


static func decode(body: PackedByteArray) -> Texture2D:
	if body.size() < 4:
		return null
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
