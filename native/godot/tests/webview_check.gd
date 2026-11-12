extends SceneTree

const PAGE := "<!doctype html><html><body style='margin:0;background:#1d4ed8;color:#fff;font:20px sans-serif'><h1 id='t'>Web panel</h1><input id='i' style='font-size:18px'><script>document.getElementById('i').addEventListener('input', function(e){ window.oh.send('value:' + e.target.value); }); window.addEventListener('oh-message', function(e){ window.oh.send('echo:' + e.data); }); window.oh.send('ready:' + innerWidth + 'x' + innerHeight);</script></body></html>"

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var messages: Array = []
var keys: Array = []
var externals: Array = []
var app_keys := 0


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	root.mouse_passthrough = true
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[webview_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["ok  " if ok else "FAIL", label, ("  (" + detail + ")") if not detail.is_empty() else ""])
	if not ok:
		failures.append(label)


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _until(condition: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await process_frame
	return bool(condition.call())


func _shoot(shot_name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(shot_name + ".png"))
	_say("screenshot " + shot_name)


func _shoot_window(shot_name: String) -> void:
	var script := OS.get_environment("OH_WINSHOT")
	if shots.is_empty() or script.is_empty() or OS.get_name() != "Windows":
		return
	var file := shots.path_join(shot_name + ".png")
	var pid := OS.create_process("powershell.exe", PackedStringArray(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ProcessId", str(OS.get_process_id()), "-Out", file]))
	var deadline := Time.get_ticks_msec() + 30000
	while pid > 0 and OS.is_process_running(pid) and Time.get_ticks_msec() < deadline:
		await process_frame
	_say("window screenshot %s %s" % [shot_name, "saved" if FileAccess.file_exists(file) else "missing"])


func _find_button(node: Node, text: String) -> BaseButton:
	if node is Button and (node as Button).text == text and (node as Button).is_visible_in_tree():
		return node
	if node is LinkButton and (node as LinkButton).text == text and (node as LinkButton).is_visible_in_tree():
		return node
	for child in node.get_children():
		var found := _find_button(child, text)
		if found:
			return found
	return null


func _clear_shell() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell == null:
		return
	await _until(func() -> bool: return shell.door_state != "deciding", 30.0)
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
	if not shell.notice_updates.is_empty():
		await _until(func() -> bool: return shell.notice != null and is_instance_valid(shell.notice), 5.0)
		await _frames(5)
	if shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
	await _frames(3)


func _near(a: Rect2, b: Rect2) -> bool:
	return absf(a.position.x - b.position.x) <= 1.5 and absf(a.position.y - b.position.y) <= 1.5 and absf(a.size.x - b.size.x) <= 1.5 and absf(a.size.y - b.size.y) <= 1.5


func _screen_rect(control: Control) -> Rect2:
	var xform := control.get_viewport().get_screen_transform() * control.get_global_transform_with_canvas()
	return Rect2(xform * Vector2.ZERO, xform.basis_xform(control.size))


func _run() -> void:
	await _until(func() -> bool: return main.menu.visible, 120.0)
	await _clear_shell()
	await _until(func() -> bool: return bool(main.menu.get("loaded")), 30.0)
	_check("menu up", main.menu.visible)
	_say("web view available=%s reason=%s" % [WebPanel.is_available(), WebPanel.unavailable_reason()])
	if WebPanel.is_available():
		await _panel_part()
		await _video_part()
	else:
		await _fallback_part()
	_say("failures: %d %s" % [failures.size(), ", ".join(failures)])
	main.engine.stop()
	quit(1 if failures.size() > 0 else 0)


func _panel_part() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 100
	root.add_child(layer)
	var holder := Control.new()
	holder.position = Vector2(60, 60)
	holder.size = Vector2(400, 225)
	layer.add_child(holder)
	var panel := WebPanel.new()
	panel.allowed = "http://127.0.0.1:"
	panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	holder.add_child(panel)
	panel.message.connect(func(text: String) -> void: messages.append(text))
	panel.key_pressed.connect(func(key: String) -> void: keys.append(key))
	panel.open_external.connect(func(url: String) -> void: externals.append(url))
	var worst := [0]
	var last := [Time.get_ticks_usec()]
	var watch := func() -> void:
		var now := Time.get_ticks_usec()
		worst[0] = maxi(worst[0], now - last[0])
		last[0] = now
	process_frame.connect(watch)
	var began := Time.get_ticks_msec()
	_check("a web panel opens", panel.open_html(PAGE), panel.get_error())
	var ready := await _until(func() -> bool: return messages.any(func(m: String) -> bool: return m.begins_with("ready:")), 20.0)
	process_frame.disconnect(watch)
	_check("the page talks to the game (IPC page to Godot)", ready, "%d ms to first message, longest frame %d ms, %s" % [Time.get_ticks_msec() - began, worst[0] / 1000, str(messages)])
	_check("the web view covers its Control exactly", panel.is_shown() and _near(panel.get_native_rect(), _screen_rect(panel)), "%s vs %s" % [panel.get_native_rect(), _screen_rect(panel)])
	panel.post_message("ping")
	_check("the game talks to the page (IPC Godot to page)", await _until(func() -> bool: return messages.has("echo:ping"), 10.0), str(messages))
	panel.eval("window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))")
	_check("Escape inside the page reaches the game", await _until(func() -> bool: return keys.has("Escape"), 10.0), str(keys))
	panel.eval("window.open('https://example.com/new-window')")
	_check("a new window goes to the system browser instead", await _until(func() -> bool: return externals.has("https://example.com/new-window"), 10.0), str(externals))
	panel.eval("location.href = 'https://example.org/away'")
	_check("leaving the allowed pages is refused and handed out", await _until(func() -> bool: return externals.has("https://example.org/away"), 10.0), str(externals))
	await _typing_part(panel)
	await _shoot_window("webview-00-panel")
	holder.position = Vector2(140, 100)
	await _frames(3)
	_check("the web view follows its Control when it moves", _near(panel.get_native_rect(), _screen_rect(panel)), "%s vs %s" % [panel.get_native_rect(), _screen_rect(panel)])
	holder.visible = false
	await _frames(3)
	_check("the web view hides with its Control", not panel.is_shown())
	holder.visible = true
	await _frames(3)
	_check("and comes back with it", panel.is_shown())
	var clip := Control.new()
	clip.clip_contents = true
	clip.position = Vector2(0, 0)
	clip.size = Vector2(300, 300)
	layer.add_child(clip)
	holder.reparent(clip)
	holder.position = Vector2(200, 200)
	await _frames(3)
	_check("a web view scrolled half out of its clip hides", not panel.is_shown())
	holder.position = Vector2(20, 20)
	holder.size = Vector2(200, 112)
	await _frames(3)
	_check("and shows again once it is back inside", panel.is_shown() and panel.is_open())
	panel.close()
	_check("the web panel closes cleanly", not panel.is_open() and not panel.is_shown())
	layer.queue_free()
	await _frames(2)


func _typing_part(panel: WebPanel) -> void:
	var script := OS.get_environment("OH_WINKEYS")
	if script.is_empty() or OS.get_name() != "Windows":
		_say("typing check skipped: OH_WINKEYS is not set")
		return
	var count := func(event: InputEvent) -> void:
		if event is InputEventKey:
			app_keys += 1
	root.window_input.connect(count)
	keys.clear()
	panel.eval("document.getElementById('i').focus()")
	panel.focus_web()
	await _wait(0.5)
	var pid := OS.create_process("powershell.exe", PackedStringArray(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ProcessId", str(OS.get_process_id()), "-Text", "abc", "-Escape"]))
	var deadline := Time.get_ticks_msec() + 30000
	while pid > 0 and OS.is_process_running(pid) and Time.get_ticks_msec() < deadline:
		await process_frame
	var typed := await _until(func() -> bool: return messages.has("value:abc") and keys.has("Escape"), 10.0)
	root.window_input.disconnect(count)
	_check("real key presses type into the page and Escape reaches the game", typed, "%s %s" % [str(messages), str(keys)])
	_check("the game's own hotkeys see none of the typing", app_keys == 0, "%d key events reached Godot" % app_keys)
	panel.focus_app()


func _video_part() -> void:
	var menu: Node = main.game_menu
	var log_file := OS.get_environment("OH_NATIVE_ROOT").path_join("opened.txt")
	OS.set_environment("OH_OPEN_LOG", log_file)
	await menu.show_ai_setup(true, "")
	await _wait(0.8)
	var prompt: Control = menu.get("_prompt")
	_check("the AI setup card opens", prompt != null)
	if prompt == null:
		return
	prompt.set("online", true)
	prompt.call("_render")
	await _wait(0.3)
	var play := _find_button(prompt, "▶   Play the video (loads YouTube)")
	_check("the card asks before loading YouTube", play != null and prompt.get("_video") == null)
	await _shoot("webview-01-before-play")
	play.pressed.emit()
	await _until(func() -> bool: return prompt.get("_video") != null, 5.0)
	var video: WebPanel = prompt.get("_video")
	var live := await _until(func() -> bool: return video != null and is_instance_valid(video) and video.is_live() and video.get_loaded_url().contains("/video/YdalQ8UqMR4"), 30.0)
	_check("Play loads the player inside the card", live, video.get_loaded_url() if video else "no panel")
	var frame := video.get_parent() as Control if video else null
	var size_ok := frame != null and absf(frame.size.x - 470.2) <= 1.0 and absf(frame.size.y - 264.0) <= 1.0
	_check("at React's size, 16:9 470x264", size_ok, str(frame.size) if frame else "")
	await _frames(4)
	_check("the web view sits exactly on the card's video frame", video.is_shown() and _near(video.get_native_rect(), _screen_rect(video)), "%s vs %s" % [video.get_native_rect(), _screen_rect(video)])
	_check("the Watch on YouTube link stays", _find_button(prompt, "Watch on YouTube ↗") != null)
	await _wait(7.0)
	await _shoot_window("webview-02-video-playing")
	await _shoot("webview-02-card")
	prompt.call("_render")
	await _frames(4)
	_check("the video keeps playing when the card redraws", is_instance_valid(video) and video.is_open() and video.is_shown() and prompt.get("_video") == video)
	video.eval("window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))")
	var stopped := await _until(func() -> bool: return prompt.get("_video") == null and _find_button(prompt, "▶   Play the video (loads YouTube)") != null, 10.0)
	_check("Escape inside the video closes it", stopped)
	_find_button(prompt, "▶   Play the video (loads YouTube)").pressed.emit()
	await _until(func() -> bool: return prompt.get("_video") != null and (prompt.get("_video") as WebPanel).is_live(), 30.0)
	var again: WebPanel = prompt.get("_video")
	var hide := _find_button(prompt, "Hide the video")
	_check("Hide the video is there", hide != null)
	if hide:
		hide.pressed.emit()
		await _frames(4)
		_check("Hide the video closes the player", prompt.get("_video") == null and not is_instance_valid(again) and _find_button(prompt, "Show the video tutorial") != null)
	_check("nothing went to the system browser", not FileAccess.file_exists(log_file), FileAccess.get_file_as_string(log_file))
	menu.call("_close_prompt")
	await _frames(4)
	OS.set_environment("OH_OPEN_LOG", "")


func _fallback_part() -> void:
	var menu: Node = main.game_menu
	var log_file := OS.get_environment("OH_NATIVE_ROOT").path_join("opened.txt")
	OS.set_environment("OH_OPEN_LOG", log_file)
	_check("the web view reports why it is unavailable", not WebPanel.unavailable_reason().is_empty(), WebPanel.unavailable_reason())
	var panel := WebPanel.new()
	root.add_child(panel)
	_check("a web panel refuses cleanly", not panel.open_url("http://127.0.0.1:9/") and not panel.is_open() and not panel.get_error().is_empty(), panel.get_error())
	panel.queue_free()
	await menu.show_ai_setup(true, "")
	await _wait(0.8)
	var prompt: Control = menu.get("_prompt")
	if prompt == null:
		_check("the AI setup card opens", false)
		return
	prompt.set("online", true)
	prompt.call("_render")
	await _wait(0.3)
	var play := _find_button(prompt, "▶   Play the video (loads YouTube)")
	_check("the card still offers the video", play != null)
	if play:
		play.pressed.emit()
	await _frames(3)
	_check("without a web view the video opens in the browser as before", FileAccess.get_file_as_string(log_file).contains("https://www.youtube.com/watch?v=YdalQ8UqMR4") and prompt.get("_video") == null)
	menu.call("_close_prompt")
	await _frames(4)
	OS.set_environment("OH_OPEN_LOG", "")
