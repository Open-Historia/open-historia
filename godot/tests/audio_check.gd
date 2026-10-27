extends SceneTree

const GAME_FILES := ["frankincense-and-myrrh.mp3", "discovery.mp3", "honour-among-thieves.mp3"]
const WAR_FILES := ["legionnaire.mp3", "vanguard.mp3"]
const MENU_FILES := ["passage-of-time.mp3", "clear-skies.mp3"]

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var sound: SoundEngine
var scenes: PackedStringArray = []


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[audio_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["ok  " if ok else "FAIL", label, ("  (%s)" % detail) if not detail.is_empty() else ""])
	if not ok:
		failures.append(label)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _shoot(shot_name: String) -> void:
	if DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_MINIMIZED:
		_say("screenshot %s skipped: the window is minimised" % shot_name)
		return
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(shot_name + ".png"))
	_say("screenshot " + shot_name)


func _voice_of(local: Dictionary, el: int) -> Dictionary:
	for entry in local.get("voices", []):
		var voice: Dictionary = entry
		if int(voice.get("el", 0)) == el:
			return voice
	return {}


func _channel(state: Dictionary, channel_name: String) -> Dictionary:
	for group in ["channels", "lists"]:
		for entry in state.get(group, []):
			var channel: Dictionary = entry
			if str(channel.get("name", "")) == channel_name:
				return channel
	return {}


func _sounding(state: Dictionary) -> Array:
	var found: Array = []
	for group in ["channels", "lists"]:
		for entry in state.get(group, []):
			var channel: Dictionary = entry
			if bool(channel.get("want", false)) and bool(channel.get("playing", false)):
				found.append(channel)
	return found


func _snapshot(label: String) -> Dictionary:
	var before := sound.state()
	var state: Dictionary = await sound.engine_state()
	var local := sound.state()
	state["_before"] = before
	state["_after"] = local
	var parts: PackedStringArray = []
	for group in ["channels", "lists"]:
		for entry in state.get(group, []):
			var channel: Dictionary = entry
			if int(channel.get("element", 0)) == 0:
				continue
			var voice := _voice_of(local, int(channel.get("element", 0)))
			parts.append("%s[%s want=%s js=%s@%.2f vol=%.4f | godot=%s@%.2f vol=%.4f gain=%.3f boost=%.3f]" % [
				str(channel.get("name", "")), str(channel.get("file", "")), str(channel.get("want", false)),
				"play" if bool(channel.get("playing", false)) else "stop", float(channel.get("time", 0.0)), float(channel.get("volume", 0.0)),
				"play" if bool(voice.get("playing", false)) else "stop", float(voice.get("time", 0.0)), float(voice.get("volume", 0.0)),
				float(channel.get("gain", 0.0)), float(channel.get("boost", 0.0)),
			])
	_say("%s: scene=%s hidden=%s held=%s drama=%s cutAt=%s soft=%s readyAt=%s expected=%s war=%s levels=%s" % [label, str(state.get("scene", "")), str(state.get("hidden", false)), str(state.get("held", false)), str(state.get("inDrama", false)), str(state.get("cutAt")), str(state.get("softExit", false)), str(state.get("readyAt")), str(state.get("expectedLoad")), JSON.stringify(state.get("war", {})), JSON.stringify(state.get("levels", {}))])
	for part in parts:
		_say("    " + part)
	return state


func _agree(state: Dictionary, label: String) -> void:
	var before: Dictionary = state.get("_before", sound.state())
	var after: Dictionary = state.get("_after", sound.state())
	var worst_time := 0.0
	var worst_volume := 0.0
	var compared := 0
	for channel in _sounding(state):
		var el := int(channel.get("element", 0))
		var early := _voice_of(before, el)
		var late := _voice_of(after, el)
		if late.is_empty():
			continue
		compared += 1
		var js_time := float(channel.get("time", 0.0))
		var low := float(early.get("time", late.get("time", 0.0)))
		var high := float(late.get("time", 0.0))
		var gap := 0.0
		if js_time < low:
			gap = low - js_time
		elif js_time > high:
			gap = js_time - high
		worst_time = maxf(worst_time, gap)
		worst_volume = maxf(worst_volume, absf(float(late.get("volume", 0.0)) - float(channel.get("volume", 0.0))))
	_check("%s: the native players follow the director" % label, compared > 0 and worst_time < 0.25 and worst_volume < 0.03, "%d compared, clock gap %.3f s, volume gap %.4f" % [compared, worst_time, worst_volume])


func _expected_volume(channel: Dictionary, music_volume: float) -> float:
	return clampf(music_volume / 100.0 * float(channel.get("gain", 0.0)) * float(channel.get("boost", 0.0)), 0.0, 1.0)


func _run() -> void:
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_check("the menu appears", false)
			_finish()
			return
		await process_frame
	_say("menu ready")
	if OS.get_environment("OH_AUDIO_AUDIBLE") != "1":
		AudioServer.set_bus_volume_db(0, -80.0)
	_say("audio output: %s at %d Hz" % [AudioServer.get_output_device(), int(AudioServer.get_mix_rate())])

	sound = SoundEngine.new()
	sound.follow_window = false
	main.add_child(sound)
	sound.scene_changed.connect(func(scene: String) -> void: scenes.append(scene))
	await sound.setup(main.engine)
	_check("the sound engine links to the sidecar", sound._linked)

	var tracks: Dictionary = await sound.tracks()
	var missing: PackedStringArray = []
	for entry in tracks.get("own", []):
		var track: Dictionary = entry
		if not FileAccess.file_exists(str(track.get("file", ""))):
			missing.append(str(track.get("file", "")))
	_check("every piece the game ships is found on disk", (tracks.get("own", []) as Array).size() == 7 and missing.is_empty(), "%d pieces, missing %s" % [(tracks.get("own", []) as Array).size(), ", ".join(missing)])
	_say("menu pieces %s, game pieces %s, war pieces %s, volumes %s" % [JSON.stringify(tracks.get("menu", [])), JSON.stringify(tracks.get("game", [])), JSON.stringify(tracks.get("war", [])), JSON.stringify(tracks.get("volumes", {}))])

	var settings: Dictionary = await sound.apply_settings({"music": true, "volume": 25, "effects": true})
	_check("the music settings read as the game ships them", bool(settings.get("music", false)) and int(settings.get("volume", 0)) == 25 and bool(settings.get("effects", false)), JSON.stringify({"music": settings.get("music"), "volume": settings.get("volume"), "effects": settings.get("effects"), "chat": settings.get("chatSound")}))
	_say("credit: %s %s %s" % [str(settings.get("credit", {}).get("text", "")), str(settings.get("credit", {}).get("works", "")), str(settings.get("credit", {}).get("site", ""))])

	await sound.enter_menu()
	var silent: Dictionary = await _snapshot("menu before the first click")
	_check("nothing sounds before the first click", _sounding(silent).is_empty())
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell != null:
		var deadline := Time.get_ticks_msec() + 30000
		while shell.door_state == "deciding" and Time.get_ticks_msec() < deadline:
			await process_frame
		if shell.door != null and is_instance_valid(shell.door):
			shell.door.opening.emit()
			shell.door.opened.emit()
			_say("vault door opened by the first click")
		await _wait(0.5)
		if shell.notice != null and is_instance_valid(shell.notice):
			shell.notice.closed.emit()
	sound.unlock()
	await _wait(3.0)
	var menu: Dictionary = await _snapshot("menu after the first click")
	var menu_voices := _sounding(menu)
	var menu_file := str(menu_voices[0].get("file", "")) if not menu_voices.is_empty() else ""
	_check("the menu plays one of its pieces", menu_voices.size() == 1 and MENU_FILES.has(menu_file), menu_file)
	if not menu_voices.is_empty():
		var expected := _expected_volume(menu_voices[0], 25.0)
		_check("the menu's piece is at the player's volume, levelled", absf(float(menu_voices[0].get("volume", 0.0)) - expected) < 0.01, "volume %.4f, 25%% x gain x boost %.4f" % [float(menu_voices[0].get("volume", 0.0)), expected])
	_agree(menu, "menu")
	var local_before := sound.state()
	await _wait(1.0)
	var local_after := sound.state()
	if not menu_voices.is_empty():
		var el := int(menu_voices[0].get("element", 0))
		var moved := float(_voice_of(local_after, el).get("time", 0.0)) - float(_voice_of(local_before, el).get("time", 0.0))
		_check("the menu's piece is really playing natively", moved > 0.8 and moved < 1.3, "%.3f s in 1 s" % moved)

	await main._start_scenario("default")
	main.picker._choose("France")
	await _wait(0.5)
	var picking: Dictionary = await _snapshot("country picker (still the menu)")
	_check("choosing a country is still the menu", str(picking.get("scene", "")) == "menu")

	await sound.enter_loading()
	await _wait(0.3)
	var loading: Dictionary = await _snapshot("game opening")
	_check("a game opening plays the loading music", str(loading.get("scene", "")) == "loading" and bool(loading.get("inDrama", false)))
	var build_name := "drama" if menu_file == "passage-of-time.mp3" else "clearSkiesDrama"
	var build := _channel(loading, build_name)
	if build.is_empty() or not bool(build.get("want", false)):
		build = _channel(loading, "themes")
		build_name = "themes"
	_check("the build is the menu piece's own", bool(build.get("want", false)) and str(build.get("file", "")) == menu_file, "%s on %s at %.2f s" % [build_name, str(build.get("file", "")), float(build.get("time", 0.0))])
	for second in range(6):
		await _wait(1.0)
		var during: Dictionary = await sound.engine_state()
		var now_build := _channel(during, build_name)
		_say("    loading +%d s: %s at %.2f s, gain %.3f, boost %.3f, volume %.4f" % [second + 1, build_name, float(now_build.get("time", 0.0)), float(now_build.get("gain", 0.0)), float(now_build.get("boost", 0.0)), float(now_build.get("volume", 0.0))])
	_agree(await _snapshot("game opening, later"), "loading")

	await main._on_country_chosen("France", "medium")
	await sound.enter_game({"country": "France"})
	var drawn: Dictionary = await _snapshot("game drawn")
	_check("the game is drawn: the loading music runs on to its end", str(drawn.get("scene", "")) == "game" and (drawn.get("cutAt") != null or not bool(drawn.get("inDrama", true))), "cutAt %s, soft %s" % [str(drawn.get("cutAt")), str(drawn.get("softExit"))])
	var game_in := false
	var deadline := Time.get_ticks_msec() + 45000
	var game_state := {}
	while Time.get_ticks_msec() < deadline:
		await _wait(0.5)
		game_state = await sound.engine_state()
		var piece := _channel(game_state, "game")
		if bool(piece.get("want", false)) and bool(piece.get("playing", false)) and absf(float(piece.get("gain", 0.0)) - 0.5) < 0.001:
			game_in = true
			break
	game_state = await _snapshot("in the game")
	var game_piece := _channel(game_state, "game")
	_check("the game's own music comes in after the loading music", game_in and GAME_FILES.has(str(game_piece.get("file", ""))), str(game_piece.get("file", "")))
	_check("the game's music is half the player's volume, levelled", absf(float(game_piece.get("volume", 0.0)) - _expected_volume(game_piece, 25.0)) < 0.01 and absf(float(game_piece.get("gain", 0.0)) - 0.5) < 0.001, "volume %.4f, gain %.3f, boost %.3f" % [float(game_piece.get("volume", 0.0)), float(game_piece.get("gain", 0.0)), float(game_piece.get("boost", 0.0))])
	_check("nothing else sounds in the game", _sounding(game_state).size() == 1, str(_sounding(game_state).size()))
	_agree(game_state, "game")
	var war_ledger: Dictionary = game_state.get("war", {})
	_say("France at war by the ledger: %s" % str(war_ledger.get("ledger", false)))
	var game_time := float(game_piece.get("time", 0.0))

	await sound.set_at_war(true)
	await _wait(2.5)
	var at_war: Dictionary = await _snapshot("at war")
	var war_list := _channel(at_war, "war")
	_check("at war the war pieces play", str(at_war.get("scene", "")) == "atWar" and bool(war_list.get("playing", false)) and WAR_FILES.has(str(war_list.get("file", ""))), str(war_list.get("file", "")))
	_check("the war pieces at war are half the player's volume", absf(float(war_list.get("volume", 0.0)) - 0.125) < 0.005, "%.4f" % float(war_list.get("volume", 0.0)))
	_check("the game's piece is faded out at war", not bool(_channel(at_war, "game").get("playing", true)))
	_agree(at_war, "at war")

	await sound.set_war_room(true)
	await _wait(2.0)
	var room: Dictionary = await _snapshot("war room open")
	var room_list := _channel(room, "war")
	_check("the war room carries the war pieces on, at three quarters", str(room.get("scene", "")) == "war" and str(room_list.get("file", "")) == str(war_list.get("file", "")) and absf(float(room_list.get("volume", 0.0)) - 0.1875) < 0.005, "%s %.4f" % [str(room_list.get("file", "")), float(room_list.get("volume", 0.0))])
	_check("the war room did not restart the piece", float(room_list.get("time", 0.0)) > float(war_list.get("time", 0.0)), "%.2f -> %.2f" % [float(war_list.get("time", 0.0)), float(room_list.get("time", 0.0))])

	await sound.set_war_room(false)
	await sound.set_at_war(false)
	await _wait(4.0)
	var peace: Dictionary = await _snapshot("peace again")
	var back := _channel(peace, "game")
	_check("at peace the game's piece comes back where it was", str(peace.get("scene", "")) == "game" and bool(back.get("playing", false)) and str(back.get("file", "")) == str(game_piece.get("file", "")) and float(back.get("time", 0.0)) > game_time, "%s from %.2f to %.2f" % [str(back.get("file", "")), game_time, float(back.get("time", 0.0))])
	_check("the war pieces are faded out at peace", not bool(_channel(peace, "war").get("playing", true)))

	var quiet_volume := float(back.get("volume", 0.0))
	await sound.apply_settings({"volume": 50})
	await _wait(0.4)
	var louder: Dictionary = await _snapshot("volume 50")
	var louder_volume := float(_channel(louder, "game").get("volume", 0.0))
	_check("the volume setting scales the music", quiet_volume > 0.0 and absf(louder_volume / quiet_volume - 2.0) < 0.15, "%.4f -> %.4f" % [quiet_volume, louder_volume])
	_agree(louder, "louder")

	await sound.apply_settings({"music": false})
	await _wait(0.4)
	var off_local := sound.state()
	var any_playing := false
	for entry in off_local.get("voices", []):
		if bool((entry as Dictionary).get("playing", false)):
			any_playing = true
	_check("music off silences every native player", not any_playing)
	await sound.apply_settings({"music": true, "volume": 25})
	await _wait(0.6)
	var on_again: Dictionary = await sound.engine_state()
	_check("music on again carries on", bool(_channel(on_again, "game").get("playing", false)))

	sound._set_hidden(true)
	await _wait(0.4)
	var hidden_playing := false
	for entry in sound.state().get("voices", []):
		if bool((entry as Dictionary).get("playing", false)):
			hidden_playing = true
	_check("a minimised window is silent", not hidden_playing)
	sound._set_hidden(false)
	await _wait(0.4)

	sound.play_ui("vault_rattle")
	sound.play_ui("vault_spin")
	sound.play_ui("vault_unlock")
	sound.play_ui("vault_open")
	sound.play_ui("music_note", 523.25)
	await sound.notify("diplomacy")
	var played: Array = sound.state().get("ui", [])
	_check("the door, note and diplomacy sounds play", played.size() == 6, JSON.stringify(played))
	await sound.apply_settings({"effects": false})
	sound.play_ui("vault_rattle")
	_check("sound effects off silences the door", (sound.state().get("ui", []) as Array).size() == 6)
	await sound.apply_settings({"effects": true})
	for key in ["vault_rattle", "vault_spin:1.5", "vault_unlock", "vault_open:1.8", "music_note:523.25", "diplomacy"]:
		var rendered: AudioStreamWAV = sound._ui_streams.get(key)
		var peak := 0.0
		var energy := 0.0
		var count := 0
		if rendered != null:
			var pcm := rendered.data
			count = pcm.size() / 2
			for index in range(count):
				var sample := absf(float(pcm.decode_s16(index * 2)) / 32767.0)
				peak = maxf(peak, sample)
				energy += sample * sample
		var rms := sqrt(energy / maxf(1.0, float(count)))
		_check("the %s sound is made, unclipped" % key, rendered != null and peak > 0.005 and peak < 0.999, "%.3f s, peak %.3f, rms %.4f" % [float(count) / 44100.0, peak, rms])

	sound.release_after = 1.0
	await sound.enter_menu()
	await _wait(3.0)
	var back_menu: Dictionary = await _snapshot("back to the menu")
	var menu_again := _sounding(back_menu)
	_check("the menu plays one of its pieces again", str(back_menu.get("scene", "")) == "menu" and menu_again.size() == 1 and MENU_FILES.has(str(menu_again[0].get("file", ""))) if not menu_again.is_empty() else false, str(menu_again.size()))
	var released: PackedStringArray = []
	for entry in sound.state().get("voices", []):
		var voice: Dictionary = entry
		if not bool(voice.get("playing", false)) and not bool(voice.get("loaded", true)):
			released.append(str(voice.get("file", "")))
	_check("pieces not heard for a while let go of their files", released.size() >= 3, ", ".join(released))
	await sound.enter_loading()
	await _wait(1.5)
	var reloaded: Dictionary = await _snapshot("loading after the files were let go")
	var build_voice := _voice_of(sound.state(), int(_channel(reloaded, "drama" if str(menu_again[0].get("file", "")) == "passage-of-time.mp3" else "clearSkiesDrama").get("element", 0))) if not menu_again.is_empty() else {}
	_check("a let-go build is read again and plays", bool(build_voice.get("playing", false)) and bool(build_voice.get("loaded", false)), JSON.stringify(build_voice))
	_agree(reloaded, "reloaded")
	await sound.enter_game({"country": "France"})
	_say("scenes seen: %s" % ", ".join(scenes))
	await _shoot("audio-1-menu")
	_finish()


func _finish() -> void:
	_say("done: %d failures %s" % [failures.size(), ", ".join(failures)])
	if main and main.engine:
		main.engine.stop()
	await _wait(0.3)
	quit(1 if failures.size() > 0 else 0)
