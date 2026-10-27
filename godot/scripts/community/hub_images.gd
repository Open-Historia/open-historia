class_name HubImages
extends Node

const MAX_ACTIVE := 6
const AVATAR_DAYS := 1

static var _instance: HubImages
static var _cache := {}
static var cache_dir := ""

var _waiting := {}
var _queue: Array[String] = []
var _active := 0
var _tasks := {}


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


static func use_data_root(data_root: String) -> void:
	if data_root.is_empty():
		return
	cache_dir = data_root.path_join("native-cache").path_join("hub-images")
	DirAccess.make_dir_recursive_absolute(cache_dir)


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


func _exit_tree() -> void:
	for id in _tasks.values():
		WorkerThreadPool.wait_for_task_completion(int(id))
	_tasks.clear()


func _enqueue(url: String, host_id: int, done: Callable) -> void:
	if _waiting.has(url):
		(_waiting[url] as Array).append([host_id, done])
		return
	_waiting[url] = [[host_id, done]]
	_queue.append(url)
	if is_inside_tree():
		_pump()


func _file_for(url: String) -> String:
	if cache_dir.is_empty():
		return ""
	return cache_dir.path_join(url.sha256_text() + ".img")


func _fresh(file: String, url: String) -> bool:
	if file.is_empty() or not FileAccess.file_exists(file):
		return false
	if not url.begins_with("https://avatars.githubusercontent.com/"):
		return true
	var age := Time.get_unix_time_from_system() - FileAccess.get_modified_time(file)
	return age < AVATAR_DAYS * 86400


func _pump() -> void:
	while _active < MAX_ACTIVE and not _queue.is_empty():
		var url: String = _queue.pop_front()
		_active += 1
		var file := _file_for(url)
		if _fresh(file, url):
			_tasks[url] = WorkerThreadPool.add_task(func() -> void:
				var bytes := FileAccess.get_file_as_bytes(file)
				_decoded.call_deferred(url, _decode_any(bytes)))
			continue
		var request := HTTPRequest.new()
		request.timeout = 40.0
		request.max_redirects = 8
		add_child(request)
		request.request_completed.connect(func(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
			request.queue_free()
			if result != HTTPRequest.RESULT_SUCCESS or code < 200 or code >= 300:
				_decoded(url, null)
				return
			_tasks[url] = WorkerThreadPool.add_task(func() -> void:
				var image: Variant = _decode_any(body)
				if image != null and not file.is_empty():
					var handle := FileAccess.open(file, FileAccess.WRITE)
					if handle:
						handle.store_buffer(body)
						handle.close()
				_decoded.call_deferred(url, image)))
		if request.request(url, PackedStringArray(["User-Agent: OpenHistoria"])) != OK:
			request.queue_free()
			_decoded(url, null)


func _decoded(url: String, image: Variant) -> void:
	if _tasks.has(url):
		WorkerThreadPool.wait_for_task_completion(int(_tasks[url]))
		_tasks.erase(url)
	_active -= 1
	var texture: Texture2D = null
	if image is Dictionary:
		texture = ImageLoader.texture_from_gif(image)
	elif image is Image:
		texture = ImageTexture.create_from_image(image)
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


static func _decode_any(body: PackedByteArray) -> Variant:
	if ImageLoader.is_gif(body):
		var frames := ImageLoader.gif_frames(body)
		return frames if not (frames.get("frames", []) as Array).is_empty() else null
	return decode_image(body)


static func decode_image(body: PackedByteArray) -> Image:
	if ImageLoader.is_gif(body):
		return ImageLoader.decode_gif(body)
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
	return image


static func decode(body: PackedByteArray) -> Texture2D:
	if ImageLoader.is_gif(body):
		return ImageLoader.texture_from_gif(ImageLoader.gif_frames(body))
	var image := decode_image(body)
	return ImageTexture.create_from_image(image) if image else null
