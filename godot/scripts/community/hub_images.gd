class_name HubImages
extends Node

const MAX_ACTIVE := 4

static var _instance: HubImages
static var _cache := {}

var _waiting := {}
var _queue: Array[String] = []
var _active := 0


static func fetch(host: Object, url: String, done: Callable) -> void:
	if url.is_empty():
		done.call(null)
		return
	if _cache.has(url):
		done.call(_cache[url])
		return
	var loader := _ensure()
	if loader:
		loader._enqueue(url, host.get_instance_id() if host else 0, done)


static func _ensure() -> HubImages:
	if is_instance_valid(_instance):
		return _instance
	var tree := Engine.get_main_loop() as SceneTree
	if not tree:
		return null
	_instance = HubImages.new()
	_instance.name = "HubImages"
	tree.root.add_child.call_deferred(_instance)
	return _instance


func _ready() -> void:
	_pump()


func _enqueue(url: String, host_id: int, done: Callable) -> void:
	if _waiting.has(url):
		(_waiting[url] as Array).append([host_id, done])
		return
	_waiting[url] = [[host_id, done]]
	_queue.append(url)
	if is_inside_tree():
		_pump()


func _pump() -> void:
	while _active < MAX_ACTIVE and not _queue.is_empty():
		var url: String = _queue.pop_front()
		_active += 1
		var request := HTTPRequest.new()
		request.timeout = 40.0
		request.max_redirects = 8
		add_child(request)
		request.request_completed.connect(func(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
			_active -= 1
			request.queue_free()
			var texture: Texture2D = null
			if result == HTTPRequest.RESULT_SUCCESS and code >= 200 and code < 300:
				texture = decode(body)
			_finish(url, texture))
		if request.request(url, PackedStringArray(["User-Agent: OpenHistoria"])) != OK:
			_active -= 1
			request.queue_free()
			_finish(url, null)


func _finish(url: String, texture: Texture2D) -> void:
	_cache[url] = texture
	var callbacks: Array = _waiting.get(url, [])
	_waiting.erase(url)
	for entry in callbacks:
		var host_id: int = entry[0]
		var callback: Callable = entry[1]
		if host_id != 0 and not is_instance_id_valid(host_id):
			continue
		callback.call(texture)
	_pump()


static func decode(body: PackedByteArray) -> Texture2D:
	if body.size() < 12:
		return null
	var image := Image.new()
	var status := ERR_FILE_UNRECOGNIZED
	if body[0] == 0x89 and body[1] == 0x50 and body[2] == 0x4E and body[3] == 0x47:
		status = image.load_png_from_buffer(body)
	elif body[0] == 0xFF and body[1] == 0xD8:
		status = image.load_jpg_from_buffer(body)
	elif body[0] == 0x52 and body[1] == 0x49 and body[2] == 0x46 and body[3] == 0x46 and body[8] == 0x57 and body[9] == 0x45 and body[10] == 0x42 and body[11] == 0x50:
		status = image.load_webp_from_buffer(body)
	if status != OK or image.is_empty():
		return null
	if image.get_width() > 1600:
		image.resize(1600, int(round(image.get_height() * 1600.0 / image.get_width())), Image.INTERPOLATE_LANCZOS)
	image.generate_mipmaps()
	return ImageTexture.create_from_image(image)
