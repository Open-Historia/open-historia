class_name SoundEngine
extends Node

signal scene_changed(scene: String)
signal now_playing_changed(track: Dictionary)
signal settings_changed(settings: Dictionary)

const REPORT_EVERY := 0.5
const WINDOW_CHECK_EVERY := 0.5
const RATE := 44100
const SILENT_DB := -80.0
const VAULT_LEVEL := 0.5
const VAULT_SPIN_SECONDS := 1.5
const VAULT_OPEN_SECONDS := 1.8
const UI_SOUNDS := ["vault_rattle", "vault_spin", "vault_unlock", "vault_open", "music_note"]
const PRERENDERED := ["vault_rattle", "vault_spin:1.5", "vault_unlock", "vault_open:1.8", "diplomacy"]


class Voice extends RefCounted:
	var el := 0
	var pseq := 0
	var player: AudioStreamPlayer
	var path := ""
	var loop := false
	var want := false
	var time := 0.0
	var volume := 1.0
	var duration := 0.0
	var idle := 0.0


class Synth extends RefCounted:
	var rate := 44100
	var data := PackedFloat32Array()
	var rng := RandomNumberGenerator.new()

	func _init(seconds: float, sample_rate: int) -> void:
		rate = sample_rate
		data.resize(int(ceil(seconds * float(rate))))
		rng.randomize()

	func envelope(t: float, points: Array) -> float:
		var first: Vector3 = points[0]
		if t <= first.x:
			return first.y
		for index in range(1, points.size()):
			var point: Vector3 = points[index]
			if t < point.x:
				var before: Vector3 = points[index - 1]
				var part := (t - before.x) / maxf(point.x - before.x, 0.000001)
				if point.z == 1.0:
					return before.y * pow(point.y / before.y, part)
				if point.z == 2.0:
					return before.y + (point.y - before.y) * part
				return before.y
		var last: Vector3 = points[points.size() - 1]
		return last.y

	func oscillate(at: float, stop: float, wave: String, from: float, to: float, ramp_end: float, points: Array, scale := 1.0) -> void:
		var start_index := maxi(0, int(at * float(rate)))
		var end_index := mini(data.size(), int(stop * float(rate)))
		var top := maxf(from, to)
		var harmonics := 1 if wave == "sine" else maxi(1, int(float(rate) * 0.5 / top))
		var phase := 0.0
		for index in range(start_index, end_index):
			var t := float(index) / float(rate)
			var value := 0.0
			if wave == "square":
				var k := 1
				while k <= harmonics:
					value += sin(phase * k) / float(k)
					k += 2
				value *= 4.0 / PI
			elif wave == "triangle":
				var k := 1
				var sign_of := 1.0
				while k <= harmonics:
					value += sign_of * sin(phase * k) / float(k * k)
					sign_of = -sign_of
					k += 2
				value *= 8.0 / (PI * PI)
			else:
				value = sin(phase)
			data[index] += value * envelope(t, points) * scale
			var frequency := from
			if to != from:
				frequency = from * pow(to / from, clampf((t - at) / maxf(ramp_end - at, 0.000001), 0.0, 1.0))
			phase += TAU * frequency / float(rate)

	func noise(at: float, stop: float, kind: String, from: float, to: float, ramp_start: float, ramp_end: float, q: float, points: Array, scale := 1.0) -> void:
		var start_index := maxi(0, int(at * float(rate)))
		var end_index := mini(data.size(), int(stop * float(rate)))
		var x1 := 0.0
		var x2 := 0.0
		var y1 := 0.0
		var y2 := 0.0
		var coefficients := PackedFloat64Array([0.0, 0.0, 0.0, 0.0, 0.0])
		for index in range(start_index, end_index):
			var t := float(index) / float(rate)
			if (index - start_index) % 32 == 0:
				var frequency := from
				if to > 0.0 and to != from and t > ramp_start:
					frequency = from * pow(to / from, clampf((t - ramp_start) / maxf(ramp_end - ramp_start, 0.000001), 0.0, 1.0))
				coefficients = biquad(kind, frequency, q)
			var x := rng.randf_range(-1.0, 1.0)
			var y := coefficients[0] * x + coefficients[1] * x1 + coefficients[2] * x2 - coefficients[3] * y1 - coefficients[4] * y2
			x2 = x1
			x1 = x
			y2 = y1
			y1 = y
			data[index] += y * envelope(t, points) * scale

	func biquad(kind: String, frequency: float, q: float) -> PackedFloat64Array:
		var w0 := TAU * clampf(frequency, 1.0, float(rate) * 0.49) / float(rate)
		var cw := cos(w0)
		var sw := sin(w0)
		var b0 := 0.0
		var b1 := 0.0
		var b2 := 0.0
		var alpha := 0.0
		if kind == "bandpass":
			alpha = sw / (2.0 * maxf(q, 0.0001))
			b0 = alpha
			b2 = -alpha
		else:
			alpha = sw / (2.0 * pow(10.0, q / 20.0))
			if kind == "highpass":
				b0 = (1.0 + cw) / 2.0
				b1 = -(1.0 + cw)
			else:
				b0 = (1.0 - cw) / 2.0
				b1 = 1.0 - cw
			b2 = b0
		var a0 := 1.0 + alpha
		return PackedFloat64Array([b0 / a0, b1 / a0, b2 / a0, -2.0 * cw / a0, (1.0 - alpha) / a0])

	func tone(at: float, length: float, wave: String, from: float, to: float, peak: float) -> void:
		var points := [Vector3(at, 0.0001, 0.0), Vector3(at + 0.008, peak, 1.0), Vector3(at + length, 0.0001, 1.0)]
		oscillate(at, at + length + 0.02, wave, from, to, at + length, points)

	func hiss(at: float, length: float, kind: String, frequency: float, q: float, peak: float, to := 0.0, ramp_start := 0.0, ramp_end := 0.0) -> void:
		var points := [Vector3(at, 0.0001, 0.0), Vector3(at + minf(0.006, length / 4.0), peak, 1.0), Vector3(at + length, 0.0001, 1.0)]
		noise(at, at + length + 0.02, kind, frequency, to, ramp_start, ramp_end, q, points)

	func click(at: float, peak: float) -> void:
		hiss(at, 0.022, "highpass", 1800.0, 1.0, peak)
		tone(at, 0.03, "square", 1250.0, 700.0, peak * 0.18)

	func scale_by(points: Array) -> void:
		for index in range(data.size()):
			data[index] *= envelope(float(index) / float(rate), points)

	func stream(level: float) -> AudioStreamWAV:
		var bytes := PackedByteArray()
		bytes.resize(data.size() * 2)
		for index in range(data.size()):
			bytes.encode_s16(index * 2, int(clampf(data[index] * level, -1.0, 1.0) * 32767.0))
		var wav := AudioStreamWAV.new()
		wav.format = AudioStreamWAV.FORMAT_16_BITS
		wav.mix_rate = rate
		wav.stereo = false
		wav.data = bytes
		return wav


var engine: EngineLink
var bus := "Master"
var follow_window := true
var release_after := 60.0
var _voices := {}
var _bytes := {}
var _outbox: Array = []
var _flush_pending := false
var _settings := {}
var _scene := "menu"
var _linked := false
var _unlocked := false
var _hidden := false
var _app_paused := false
var _report_clock := 0.0
var _window_clock := 0.0
var _ui_streams := {}
var _ui_played: Array = []
var _now_playing := {}
var _prerender_task := -1


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func _exit_tree() -> void:
	if _prerender_task >= 0:
		WorkerThreadPool.wait_for_task_completion(_prerender_task)
		_prerender_task = -1


func setup(link: EngineLink) -> void:
	engine = link
	if not engine.engine_event.is_connected(_on_engine_event):
		engine.engine_event.connect(_on_engine_event)
	if not engine.is_ready():
		await engine.engine_ready
	var reply: Dictionary = await engine.request("audio.setup")
	if not reply.get("ok", false):
		push_warning("Sound: %s" % str(reply.get("error", "the sidecar has no audio")))
		return
	var result: Dictionary = reply.get("result", {})
	_settings = result.get("settings", {})
	_take_scene(str(result.get("scene", _scene)))
	_linked = true
	settings_changed.emit(_settings)
	if _unlocked:
		engine.request("audio.unlock")
	if _hidden:
		engine.request("audio.hidden", {"hidden": true})
	_prerender_task = WorkerThreadPool.add_task(_prerender)


func enter_menu() -> void:
	await _scene_request({"scene": "menu"})


func enter_loading() -> void:
	await _scene_request({"scene": "loading"})


func enter_game(game_view: Dictionary = {}) -> void:
	await _scene_request({"scene": "game", "country": str(game_view.get("country", ""))})


func set_at_war(value: bool) -> void:
	await _scene_request({"atWar": value})


func set_war_room(shown: bool) -> void:
	await _scene_request({"war": shown})


func refresh_war() -> void:
	await _scene_request({})


func unlock() -> void:
	if _unlocked and _linked:
		return
	_unlocked = true
	if _linked:
		engine.request("audio.unlock")


func hold(reason: String, held: bool) -> void:
	if _linked:
		await engine.request("audio.hold", {"reason": reason, "held": held})


func apply_settings(values: Dictionary) -> Dictionary:
	var args := {}
	if values.has("music"):
		args["music"] = bool(values["music"])
	if values.has("volume"):
		args["volume"] = int(values["volume"])
	if values.has("effects"):
		args["effects"] = bool(values["effects"])
	if engine == null:
		return _settings
	var reply: Dictionary = await engine.request("audio.settings.set", args)
	if reply.get("ok", false):
		_settings = reply.get("result", {})
	return _settings


func get_settings() -> Dictionary:
	if engine == null:
		return _settings
	var reply: Dictionary = await engine.request("audio.settings.get")
	if reply.get("ok", false):
		_settings = reply.get("result", {})
	return _settings


func settings() -> Dictionary:
	return _settings


func scene() -> String:
	return _scene


func now_playing() -> Dictionary:
	return _now_playing


func play_ui(sound_name: String, value := 0.0) -> void:
	if not UI_SOUNDS.has(sound_name) or not bool(_settings.get("effects", true)):
		return
	var key := sound_name
	if sound_name == "vault_spin":
		key = "vault_spin:%s" % str(value if value > 0.0 else VAULT_SPIN_SECONDS)
	elif sound_name == "vault_open":
		key = "vault_open:%s" % str(value if value > 0.0 else VAULT_OPEN_SECONDS)
	elif sound_name == "music_note":
		if value <= 0.0:
			return
		key = "music_note:%s" % str(value)
	_one_shot(key)


func notify(kind: String) -> void:
	if kind != "diplomacy":
		return
	if engine != null and _linked:
		var reply: Dictionary = await engine.request("audio.settings.get")
		if reply.get("ok", false):
			_settings = reply.get("result", {})
	if not bool(_settings.get("chatSound", true)):
		return
	_one_shot("diplomacy")


func state() -> Dictionary:
	var voices: Array = []
	var keys := _voices.keys()
	keys.sort()
	for key in keys:
		var voice: Voice = _voices[key]
		voices.append({
			"el": voice.el,
			"file": voice.path.get_file(),
			"playing": voice.player.playing,
			"time": snappedf(_position(voice), 0.001),
			"volume": snappedf(voice.volume, 0.0001),
			"volume_db": snappedf(voice.player.volume_db, 0.01),
			"loop": voice.loop,
			"loaded": voice.player.stream != null,
			"duration": snappedf(voice.duration, 0.001),
		})
	return {"scene": _scene, "unlocked": _unlocked, "hidden": _hidden, "voices": voices, "ui": _ui_played.duplicate()}


func engine_state() -> Dictionary:
	if engine == null:
		return {}
	var reply: Dictionary = await engine.request("audio.state")
	return reply.get("result", {}) if reply.get("ok", false) else {}


func tracks() -> Dictionary:
	if engine == null:
		return {}
	var reply: Dictionary = await engine.request("audio.tracks")
	return reply.get("result", {}) if reply.get("ok", false) else {}


func _scene_request(args: Dictionary) -> Dictionary:
	if engine == null:
		return {}
	if not _linked and not engine.is_ready():
		await engine.engine_ready
	var reply: Dictionary = await engine.request("audio.scene", args)
	if not reply.get("ok", false):
		return {}
	var result: Dictionary = reply.get("result", {})
	_take_scene(str(result.get("scene", _scene)))
	return result


func _take_scene(next: String) -> void:
	if next.is_empty() or next == _scene:
		return
	_scene = next
	scene_changed.emit(_scene)


func _on_engine_event(event_name: String, data: Variant) -> void:
	var payload: Dictionary = data if data is Dictionary else {}
	if event_name == "audio.cmds":
		var commands: Array = payload.get("list", [])
		for command in commands:
			if command is Dictionary:
				_apply(command)
		_flush()
	elif event_name == "audio.now":
		var track: Variant = payload.get("track")
		_now_playing = track if track is Dictionary else {}
		now_playing_changed.emit(_now_playing)
	elif event_name == "audio.scene":
		_take_scene(str(payload.get("scene", _scene)))
	elif event_name == "audio.settings":
		_settings = payload
		settings_changed.emit(_settings)


func _apply(command: Dictionary) -> void:
	var voice := _voice(int(command.get("el", 0)))
	if command.has("pseq"):
		voice.pseq = int(command["pseq"])
	var op := str(command.get("op", ""))
	if op == "src":
		_load(voice, command)
	elif op == "seek":
		voice.time = maxf(0.0, float(command.get("time", 0.0)))
		if voice.player.playing:
			voice.player.seek(voice.time)
		_report(voice)
	elif op == "play":
		voice.want = true
		voice.time = maxf(0.0, float(command.get("time", voice.time)))
		_start(voice)
		_report(voice)
	elif op == "pause":
		voice.want = false
		if voice.player.playing:
			voice.time = _position(voice)
			voice.player.stop()
		_report(voice)
	elif op == "volume":
		voice.volume = clampf(float(command.get("volume", 1.0)), 0.0, 1.0)
		_apply_volume(voice)
	elif op == "loop":
		voice.loop = bool(command.get("loop", false))
		_set_loop(voice)


func _voice(el: int) -> Voice:
	if _voices.has(el):
		return _voices[el]
	var voice := Voice.new()
	voice.el = el
	voice.player = AudioStreamPlayer.new()
	voice.player.bus = bus
	voice.player.name = "Music%d" % el
	add_child(voice.player)
	voice.player.finished.connect(_on_finished.bind(el))
	_voices[el] = voice
	return voice


func _load(voice: Voice, command: Dictionary) -> void:
	voice.player.stop()
	voice.player.stream = null
	voice.path = str(command.get("path", ""))
	voice.loop = bool(command.get("loop", voice.loop))
	voice.time = maxf(0.0, float(command.get("time", 0.0)))
	voice.want = bool(command.get("playing", false))
	if command.has("volume"):
		voice.volume = clampf(float(command["volume"]), 0.0, 1.0)
	_apply_volume(voice)
	voice.duration = 0.0
	voice.idle = 0.0
	_prune_bytes()
	if voice.path.is_empty():
		_report(voice)
		return
	if not _attach(voice):
		voice.want = false
		_report(voice, {"error": "The file could not be played."})
		return
	if voice.want:
		_start(voice)
	_report(voice, {"duration": voice.duration})


func _attach(voice: Voice) -> bool:
	var stream := _stream_for(voice.path)
	if stream == null:
		return false
	voice.player.stream = stream
	voice.duration = stream.get_length()
	_set_loop(voice)
	return true


func _stream_for(file: String) -> AudioStream:
	var bytes: PackedByteArray
	if _bytes.has(file):
		bytes = _bytes[file]
	else:
		bytes = FileAccess.get_file_as_bytes(file)
		if bytes.is_empty():
			return null
		_bytes[file] = bytes
	var stream: AudioStream = null
	if bytes.size() >= 4 and bytes.slice(0, 4).get_string_from_ascii() == "OggS":
		stream = AudioStreamOggVorbis.load_from_buffer(bytes)
	else:
		var mp3 := AudioStreamMP3.new()
		mp3.data = bytes
		stream = mp3
	if stream == null or stream.get_length() <= 0.0:
		return null
	return stream


func _prune_bytes() -> void:
	var used := {}
	for key in _voices:
		var voice: Voice = _voices[key]
		if not voice.path.is_empty() and voice.player.stream != null:
			used[voice.path] = true
	for file in _bytes.keys():
		if not used.has(file):
			_bytes.erase(file)


func _set_loop(voice: Voice) -> void:
	var stream := voice.player.stream
	if stream is AudioStreamMP3:
		(stream as AudioStreamMP3).loop = voice.loop
	elif stream is AudioStreamOggVorbis:
		(stream as AudioStreamOggVorbis).loop = voice.loop


func _apply_volume(voice: Voice) -> void:
	voice.player.volume_db = SILENT_DB if voice.volume <= 0.00001 else maxf(SILENT_DB, linear_to_db(voice.volume))


func _start(voice: Voice) -> void:
	voice.idle = 0.0
	if voice.player.stream == null:
		if voice.path.is_empty():
			return
		if not _attach(voice):
			voice.want = false
			_report(voice, {"error": "The file could not be played."})
			return
	var at := voice.time
	if voice.duration > 0.0 and at >= voice.duration:
		at = fmod(at, voice.duration) if voice.loop else voice.duration
	voice.player.play(at)


func _position(voice: Voice) -> float:
	if not voice.player.playing:
		return voice.time
	var at := voice.player.get_playback_position() + AudioServer.get_time_since_last_mix()
	if voice.duration > 0.0:
		at = fmod(at, voice.duration) if voice.loop else minf(at, voice.duration)
	return at


func _on_finished(el: int) -> void:
	if not _voices.has(el):
		return
	var voice: Voice = _voices[el]
	if voice.loop:
		return
	voice.want = false
	voice.time = voice.duration
	_report(voice, {"ended": true})
	_flush()


func _report(voice: Voice, extra := {}) -> void:
	var entry := {"el": voice.el, "pseq": voice.pseq, "time": _position(voice), "playing": voice.player.playing}
	entry.merge(extra, true)
	_outbox.append(entry)
	if not _flush_pending:
		_flush_pending = true
		_flush.call_deferred()


func _flush() -> void:
	_flush_pending = false
	if _outbox.is_empty() or engine == null:
		return
	var batch := _outbox
	_outbox = []
	engine.request("audio.report", {"list": batch})


func _process(delta: float) -> void:
	_report_clock += delta
	if _report_clock >= REPORT_EVERY:
		_report_clock = 0.0
		var released := false
		for key in _voices:
			var voice: Voice = _voices[key]
			if voice.player.playing:
				voice.idle = 0.0
				_report(voice)
			elif voice.player.stream != null:
				voice.idle += REPORT_EVERY
				if voice.idle >= release_after:
					voice.player.stream = null
					released = true
		if released:
			_prune_bytes()
	_window_clock += delta
	if follow_window and _window_clock >= WINDOW_CHECK_EVERY:
		_window_clock = 0.0
		_set_hidden(_app_paused or DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_MINIMIZED)


func _input(event: InputEvent) -> void:
	if _unlocked and _linked:
		return
	var gesture := false
	if event is InputEventMouseButton or event is InputEventKey:
		gesture = event.is_pressed() and not event.is_echo()
	elif event is InputEventScreenTouch:
		gesture = not event.is_pressed()
	if gesture:
		unlock()


func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_PAUSED:
		_app_paused = true
		_set_hidden(true)
	elif what == NOTIFICATION_APPLICATION_RESUMED:
		_app_paused = false
		_set_hidden(DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_MINIMIZED)


func _set_hidden(value: bool) -> void:
	if value == _hidden:
		return
	_hidden = value
	if _linked:
		engine.request("audio.hidden", {"hidden": value})


func _one_shot(key: String) -> void:
	var stream: AudioStreamWAV = _ui_streams.get(key)
	if stream == null:
		stream = _render(key)
		if stream == null:
			return
		_ui_streams[key] = stream
	var player := AudioStreamPlayer.new()
	player.stream = stream
	player.bus = bus
	add_child(player)
	player.finished.connect(player.queue_free)
	player.play()
	_ui_played.append({"sound": key, "seconds": snappedf(stream.get_length(), 0.001)})
	if _ui_played.size() > 20:
		_ui_played = _ui_played.slice(_ui_played.size() - 20)


func _prerender() -> void:
	for key in PRERENDERED:
		var stream := _render(str(key))
		if stream != null:
			_store_rendered.call_deferred(str(key), stream)


func _store_rendered(key: String, stream: AudioStreamWAV) -> void:
	if not _ui_streams.has(key):
		_ui_streams[key] = stream


func _render(key: String) -> AudioStreamWAV:
	var parts := key.split(":")
	var kind := parts[0]
	var value := float(parts[1]) if parts.size() > 1 else 0.0
	if kind == "vault_rattle":
		var synth := Synth.new(0.36, RATE)
		for knock in [Vector2(0.0, 0.35), Vector2(0.07, 0.28), Vector2(0.15, 0.22)]:
			synth.hiss(knock.x, 0.05, "bandpass", 2400.0, 4.0, knock.y)
			synth.tone(knock.x, 0.09, "triangle", 420.0, 300.0, knock.y * 0.25)
		synth.tone(0.0, 0.28, "sine", 95.0, 60.0, 0.3)
		return synth.stream(VAULT_LEVEL)
	if kind == "vault_spin":
		var seconds := value if value > 0.0 else VAULT_SPIN_SECONDS
		var synth := Synth.new(seconds + 0.06, RATE)
		var at := 0.0
		var gap := 0.045
		while at < seconds - 0.05:
			synth.click(at, 0.42)
			at += gap
			gap *= 1.045
		synth.hiss(0.0, seconds, "bandpass", 520.0, 1.2, 0.12, 260.0, 0.0, seconds)
		return synth.stream(VAULT_LEVEL)
	if kind == "vault_unlock":
		var synth := Synth.new(0.64, RATE)
		synth.tone(0.0, 0.42, "sine", 150.0, 42.0, 0.9)
		synth.hiss(0.0, 0.18, "lowpass", 420.0, 1.0, 0.7)
		synth.tone(0.01, 0.6, "triangle", 930.0, 900.0, 0.1)
		synth.tone(0.012, 0.45, "triangle", 1410.0, 1380.0, 0.05)
		return synth.stream(VAULT_LEVEL)
	if kind == "vault_open":
		var seconds := value if value > 0.0 else VAULT_OPEN_SECONDS
		var synth := Synth.new(seconds + 0.75, RATE)
		synth.hiss(0.0, 0.5, "highpass", 3200.0, 1.0, 0.16)
		var swell := [Vector3(0.0, 0.0001, 0.0), Vector3(seconds * 0.3, 0.9, 1.0), Vector3(seconds * 0.85, 0.5, 1.0), Vector3(seconds + 0.25, 0.0001, 1.0)]
		synth.noise(0.0, seconds + 0.3, "lowpass", 170.0, 0.0, 0.0, 0.0, 1.0, swell)
		synth.hiss(0.05, seconds, "bandpass", 850.0, 2.5, 0.1, 520.0, 0.0, seconds)
		synth.tone(seconds, 0.7, "sine", 78.0, 38.0, 0.85)
		synth.hiss(seconds, 0.25, "lowpass", 300.0, 1.0, 0.5)
		return synth.stream(VAULT_LEVEL)
	if kind == "music_note":
		if value <= 0.0:
			return null
		var synth := Synth.new(1.6, RATE)
		var level := [Vector3(0.0, 0.0001, 0.0), Vector3(0.008, 0.16, 2.0), Vector3(1.5, 0.0001, 1.0)]
		synth.oscillate(0.0, 1.6, "sine", value, value, 1.6, level)
		synth.oscillate(0.0, 1.6, "triangle", value * 2.0, value * 2.0, 1.6, level, 0.22)
		return synth.stream(1.0)
	if kind == "diplomacy":
		var synth := Synth.new(0.3, RATE)
		for note in [Vector3(740.0, 0.0, 0.115), Vector3(988.0, 0.082, 0.145)]:
			var start: float = note.y
			var stop: float = note.y + note.z
			var points := [Vector3(start, 0.0001, 0.0), Vector3(start + 0.006, 0.72, 1.0), Vector3(stop, 0.0001, 1.0)]
			synth.oscillate(start, stop + 0.01, "sine", note.x, note.x, stop, points)
		synth.scale_by([Vector3(0.0, 0.0001, 0.0), Vector3(0.008, 0.028, 1.0), Vector3(0.26, 0.0001, 1.0)])
		return synth.stream(1.0)
	return null
