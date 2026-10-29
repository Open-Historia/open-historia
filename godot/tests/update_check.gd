extends SceneTree

var main: Node
var shots := ""
var mode := "newer"
var feed := ""
var started := 0
var failures: PackedStringArray = []
var cover_seen := false


func _initialize() -> void:
	shots = OS.get_environment("OH_SHOTS")
	mode = OS.get_environment("OH_UPDATE_TEST_MODE")
	if mode.is_empty():
		mode = "newer"
	feed = OS.get_environment("OH_NATIVE_UPDATE_URL").get_base_dir()
	started = Time.get_ticks_msec()
	root.mouse_passthrough = true
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[update %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(label: String, ok: bool, detail := "") -> void:
	_say("%s %s%s" % ["ok  " if ok else "FAIL", label, ("  (%s)" % detail) if not detail.is_empty() else ""])
	if not ok:
		failures.append(label)


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _shoot(name: String) -> void:
	var drawn := [false]
	var mark := func() -> void: drawn[0] = true
	RenderingServer.frame_post_draw.connect(mark)
	var deadline := Time.get_ticks_msec() + 5000
	var frames := 0
	while (frames < 4 or not drawn[0]) and Time.get_ticks_msec() < deadline:
		OS.low_processor_usage_mode = false
		if main.has_method("_stay_awake"):
			main.call("_stay_awake")
		root.get_viewport().get_texture()
		await process_frame
		frames += 1
	RenderingServer.frame_post_draw.disconnect(mark)
	if not drawn[0]:
		_say("screenshot %s skipped: no frame was drawn" % name)
		return
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _until(condition: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await process_frame
	return bool(condition.call())


func _http(path: String) -> void:
	var request := HTTPRequest.new()
	root.add_child(request)
	request.request(feed.path_join(path))
	await request.request_completed
	request.queue_free()


func _clear_shell() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell == null:
		return
	await _until(func() -> bool: return shell.door_state != "deciding", 30.0)
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
	if not shell.notice_updates.is_empty():
		await _until(func() -> bool: return shell.notice != null and is_instance_valid(shell.notice), 5.0)
		for i in range(5):
			await process_frame
	if shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
	for i in range(3):
		await process_frame


func _updater() -> AppUpdate:
	return main.get("app_update") as AppUpdate


func _run() -> void:
	_check("the update feed is this machine", feed.begins_with("http://127.0.0.1:"), feed)
	var updater := _updater()
	_check("the updater is mounted", updater != null)
	if updater == null:
		_finish()
		return
	if mode == "equal":
		await _run_equal(updater)
	elif mode == "chunks":
		await _run_chunks(updater)
	else:
		await _run_newer(updater)
	_finish()


func _run_newer(updater: AppUpdate) -> void:
	var appeared := await _until(func() -> bool: return updater.cover.visible, 120.0)
	_check("the Updating Open Historia screen appears before the menu", appeared and not main.menu.visible)
	if not appeared:
		return
	await _until(func() -> bool: return str(updater.state.get("state", "")) == "downloading" and int(updater.state.get("percent", 0)) >= 8, 20.0)
	await _wait(0.4)
	_check("its title", updater._cover_title.text == "Updating Open Historia", updater._cover_title.text)
	_check("its text says this is the super-experimental native build", updater._cover_lede.text.contains("super-experimental native build"), updater._cover_lede.text)
	_check("it shows the download's progress", updater._cover_pct.text.contains("%") and updater._cover_bar.fraction > 0.0, "%s, bar %.2f" % [updater._cover_pct.text, updater._cover_bar.fraction])
	_check("it offers Open the game now", updater._cover_update.visible and updater._cover_later.text == "Open the game now")
	await _shoot("u1-launch-update")
	updater._cover_later.pressed.emit()
	await _wait(0.1)
	_check("Open the game now says it is opening", updater._cover_pct.text == "Opening the game…", updater._cover_pct.text)
	var menu_up := await _until(func() -> bool: return main.menu.visible and not updater.cover.visible, 120.0)
	_check("Open the game now opens the game", menu_up)
	_check("the download carried on behind the menu", str(updater.state.get("state", "")) in ["downloading", "ready"], str(updater.state.get("state", "")))
	await _clear_shell()
	var downloading := await _until(func() -> bool: return updater.banner.visible and updater._banner_sub.text.begins_with("Downloading the update…"), 15.0)
	_check("the banner picks the download up", downloading, updater._banner_sub.text)
	_check("the banner says this is the super-experimental native build", updater._banner_head.text == "A new super-experimental native build of Open Historia is ready.", updater._banner_head.text)
	await _shoot("u2-banner-downloading")
	var ready := await _until(func() -> bool: return updater.is_banner_ready(), 60.0)
	_check("the banner offers Restart now once the download is verified", ready and updater._banner_button.text == "Restart now", updater._banner_button.text)
	_check("and says what restarting does", updater._banner_sub.text == "Downloaded. Restart to finish — your games are kept.", updater._banner_sub.text)
	await _shoot("u3-banner-restart")
	await _http("set?build=20261027130000")
	var menu_node: Node = main.get("game_menu")
	await menu_node.call("open")
	menu_node.call("_show_tab", "help")
	await _wait(0.4)
	var marks: Dictionary = menu_node.get("_marks")
	var tile: Control = marks.get("Check for updates") as Control
	_check("Check for updates is no longer dimmed", tile != null and not bool(tile.get("disabled")) and tile.modulate.a > 0.9)
	if tile == null:
		return
	tile.emit_signal("pressed")
	await _until(func() -> bool: return str((menu_node.get("_update_check") as Dictionary).get("status", "")) not in ["", "checking"], 15.0)
	var told: Dictionary = menu_node.get("_update_check")
	_check("Check for updates finds the newer build", str(told.get("status", "")) == "available", str(told))
	await _wait(0.3)
	_check("and says so as React does", menu_node.call("_update_check_text") == "Update available — use the update banner above to install it.")
	await _shoot("u4-menu-check-available")
	await menu_node.call("close")
	await _wait(0.4)
	_check("a newer build than the downloaded one is offered again", updater.banner.visible and updater._banner_sub.text == "A newer update is available. Download it before restarting." and updater._banner_button.text == "Update now", "%s | %s" % [updater._banner_sub.text, updater._banner_button.text])
	updater._banner_button.pressed.emit()
	var fetching := await _until(func() -> bool: return updater._banner_sub.text.begins_with("Downloading the update…"), 20.0)
	_check("Update now downloads in the background", fetching, updater._banner_sub.text)
	_check("the button shows the percentage meanwhile", updater._banner_button.disabled and updater._banner_button.text.ends_with("%"), updater._banner_button.text)
	await _shoot("u5-banner-update-now")
	ready = await _until(func() -> bool: return updater.is_banner_ready() and str(updater.state.get("build", "")) == "20261027130000", 60.0)
	_check("then offers Restart now for that build", ready, "%s %s" % [updater._banner_button.text, str(updater.state.get("build", ""))])
	await _shoot("u6-banner-restart-again")
	updater._banner_close.pressed.emit()
	await _wait(0.5)
	_check("× dismisses the banner", not updater.banner.visible)
	await menu_node.call("_check_for_updates")
	await _wait(0.5)
	_check("a manual check brings a dismissed banner back", updater.banner.visible)
	_check("the version is shown", str(menu_node.get("_version_text")).begins_with("Open Historia Native 0.1.0 · super experimental · built 2026-10-27 10:00 UTC"), str(menu_node.get("_version_text")))


func _run_equal(updater: AppUpdate) -> void:
	var menu_up := await _until(func() -> bool:
		if updater.cover.visible:
			cover_seen = true
		return main.menu.visible, 120.0)
	_check("the menu opens", menu_up)
	_check("no update screen for an equal build", not cover_seen)
	await _clear_shell()
	await _wait(3.0)
	_check("no banner for an equal build", not updater.banner.visible)
	var menu_node: Node = main.get("game_menu")
	await menu_node.call("open")
	menu_node.call("_show_tab", "help")
	await menu_node.call("_check_for_updates")
	await _wait(0.4)
	var told: Dictionary = menu_node.get("_update_check")
	_check("Check for updates says it is up to date", str(told.get("status", "")) == "current" and menu_node.call("_update_check_text") == "You are up to date.", str(told))
	_check("still no banner", not updater.banner.visible)
	await _wait(0.3)
	await _shoot("u7-equal-up-to-date")


func _run_chunks(updater: AppUpdate) -> void:
	var appeared := await _until(func() -> bool: return updater.cover.visible, 120.0)
	_check("the Updating Open Historia screen appears for a chunked update", appeared and not main.menu.visible)
	if not appeared:
		return
	var moving := await _until(func() -> bool: return str(updater.state.get("kind", "")) == "chunks" and int(updater.state.get("receivedBytes", 0)) > 0, 30.0)
	await _wait(0.3)
	_check("it fetches only the changed pieces", moving, str(updater.state))
	_check("the screen says how much of how much", updater._cover_pct.text.contains(" MB of ") and updater._cover_pct.text.contains("%"), updater._cover_pct.text)
	var want := float(updater.state.get("downloadBytes", 0))
	var full := float(updater.state.get("fullBytes", 0))
	_check("the pieces are far smaller than the installer", want > 0.0 and want < full / 2.0, "%d of %d bytes" % [int(want), int(full)])
	await _shoot("c1-launch-chunks")
	updater._cover_later.pressed.emit()
	var menu_up := await _until(func() -> bool: return main.menu.visible and not updater.cover.visible, 120.0)
	_check("Open the game now opens the game", menu_up)
	await _clear_shell()
	var menu_node: Node = main.get("game_menu")
	await menu_node.call("open")
	menu_node.call("_show_tab", "help")
	await _wait(0.3)
	if str(updater.state.get("state", "")) == "downloading":
		await menu_node.call("_check_for_updates")
		await _wait(0.2)
		var told := str(menu_node.call("_update_check_text"))
		_check("Check for updates shows the download's progress and the installer's size", told.begins_with("Downloading the update — ") and told.contains(" MB of ") and told.contains("the full installer is"), told)
		await _shoot("c2-menu-check-downloading")
	var ready := await _until(func() -> bool: return updater.is_banner_ready(), 60.0)
	_check("the banner offers Restart now once the pieces are put together", ready and updater._banner_button.text == "Restart now", updater._banner_button.text)
	_check("the feed's notes are shown in the banner", updater._banner_notes.visible and updater._banner_notes.text == "B brings a changed script.", updater._banner_notes.text)
	_check("the ready update was announced to the desktop", updater._toasted == str(updater.state.get("build", "")) and not updater._toasted.is_empty(), updater._toasted)
	await menu_node.call("_check_for_updates")
	await _wait(0.2)
	_check("Check for updates then says it is downloaded", str(menu_node.call("_update_check_text")).begins_with("Downloaded — use Restart now"), str(menu_node.call("_update_check_text")))
	await _shoot("c3-banner-ready")
	await menu_node.call("close")
	var staged := str(updater.state.get("staged", ""))
	_check("the update is staged, not an installer", not staged.is_empty(), staged)
	var install := OS.get_environment("OH_NATIVE_INSTALL_DIR")
	var marker := OS.get_environment("OH_NATIVE_ROOT").path_join("native-cache/updates/staged").path_join(staged).path_join("applied")
	await updater.install_on_quit()
	var applied := await _until(func() -> bool: return FileAccess.file_exists(marker), 60.0)
	await _wait(1.5)
	var version: Variant = JSON.parse_string(FileAccess.get_file_as_string(install.path_join("native/godot/version.json")))
	_check("closing the game applies the staged files", applied and version is Dictionary and str((version as Dictionary).get("build", "")) == staged, str(version))
	_check("the replaced files are kept until the new start is confirmed", DirAccess.dir_exists_absolute(marker.get_base_dir().path_join("previous")))


func _finish() -> void:
	_say("%d failure(s)%s" % [failures.size(), (": " + ", ".join(failures)) if not failures.is_empty() else ""])
	main.engine.stop()
	for i in range(2):
		await process_frame
	quit(1 if not failures.is_empty() else 0)
