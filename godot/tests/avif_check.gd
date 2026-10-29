extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures := 0
var editor: ScenarioEditor


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.mouse_passthrough = true
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[avif_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(ok: bool, text: String) -> void:
	if ok:
		_say("ok   " + text)
	else:
		failures += 1
		_say("FAIL " + text)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _until(test: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if test.call():
			return true
		await process_frame
	return bool(test.call())


func _shoot(name: String) -> void:
	await _frames(6)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _find_all(node: Node, test: Callable, out: Array) -> Array:
	if test.call(node):
		out.append(node)
	for child in node.get_children():
		_find_all(child, test, out)
	return out


func _button(node: Node, text: String) -> Button:
	var found := _find_all(node, func(entry: Node) -> bool: return entry is Button and (entry as Button).text == text and (entry as Button).is_visible_in_tree(), [])
	return found[0] if not found.is_empty() else null


func _clear_shell() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell == null:
		return
	await _until(func() -> bool: return shell.door_state != "deciding", 30.0)
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
		_say("vault door opened for the test")
	if not shell.notice_updates.is_empty():
		await _until(func() -> bool: return shell.notice != null and is_instance_valid(shell.notice), 5.0)
		await _frames(5)
	if shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
		_say("update notice closed for the test")
	await _frames(3)


func _transparent_and_solid(texture: Texture2D) -> bool:
	if texture == null:
		return false
	var image := texture.get_image()
	if image == null or image.get_width() != 1189 or image.get_height() != 896:
		return false
	return image.get_pixel(600, 400).a < 0.02 and image.get_pixel(40, 400).a > 0.98 and image.get_pixel(40, 400).r > 0.8


func _cover_texture(cover: Node) -> Texture2D:
	return cover.get("_texture") as Texture2D


func _run() -> void:
	var sample := OS.get_environment("OH_AVIF_SAMPLE")
	var body := FileAccess.get_file_as_bytes(sample)
	if body.is_empty():
		_say("FAIL set OH_AVIF_SAMPLE to an AVIF file")
		_finish()
		return
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 120000:
			_say("FAIL the menu never appeared")
			_finish()
			return
		await process_frame
	_say("menu ready")
	await _clear_shell()
	_check(ImageLoader.is_avif(body), "the sample is recognised as AVIF by its ftyp brand")
	_check(not ImageLoader.is_avif(FileAccess.get_file_as_bytes(UI.repo_path("public/icon-192.png"))), "a PNG is not taken for AVIF")
	_check(ImageLoader.avif_size(body) == Vector2i(1189, 896), "the picture size is read from the file (%s)" % str(ImageLoader.avif_size(body)))

	var second_path := sample.get_base_dir().path_join("google-nest-hub-max-horizontal.avif")
	var second := FileAccess.get_file_as_bytes(second_path)
	if ImageLoader.is_avif(second):
		var size := ImageLoader.avif_size(second)
		var held := ImageLoader.decode(second)
		_check(held != null and Vector2i(held.get_size()) == size, "the synchronous decode hands back a placeholder of the picture's size (%s)" % str(held.get_size() if held else Vector2.ZERO))
		var filled := await _until(func() -> bool: return held != null and held.get_image() != null and held.get_image().get_width() == size.x, 30.0)
		_check(filled, "the placeholder fills in with the picture when the sidecar has converted it")
	else:
		_say("note no second AVIF beside the sample; the placeholder path was not exercised")

	var rotated := FileAccess.get_file_as_bytes(OS.get_environment("OH_AVIF_ROTATED"))
	if ImageLoader.is_avif(rotated):
		var turned_size := ImageLoader.avif_size(rotated)
		var turned := await ImageLoader.decode_async(main, rotated)
		var turned_image := turned.get_image() if turned else null
		_check(turned_image != null and Vector2i(turned_image.get_size()) == turned_size and turned_size.y > turned_size.x, "a quarter-turned AVIF comes out upright-turned, %s as its size was read" % str(turned_size))
		_check(turned_image != null and turned_image.get_pixel(0, 0).a < 0.05 and turned_image.get_pixel(turned_size.x / 2, 12).a > 0.95, "its transparency is turned with it")
	else:
		_say("note OH_AVIF_ROTATED is not set; the rotated sample was not exercised")

	var animated_bytes := FileAccess.get_file_as_bytes(OS.get_environment("OH_AVIF_ANIMATED"))
	if ImageLoader.is_avif(animated_bytes):
		_check(ImageLoader.is_avif_sequence(animated_bytes) and not ImageLoader.is_avif_sequence(body), "an image sequence is told apart from a still")
		var moving := await ImageLoader.decode_async(main, animated_bytes)
		var anim := moving as AnimatedTexture
		var summary := "%d frames, one_shot %s, %.2f s" % [anim.frames, anim.one_shot, anim.get_frame_duration(0)] if anim else "not animated"
		_check(anim != null and anim.frames == 9 and anim.one_shot and is_equal_approx(anim.get_frame_duration(0), 0.3), "the animated AVIF becomes an AnimatedTexture: 3 frames of 0.3 s played 3 times, then it stops (%s)" % summary)
		var first_frame := anim.get_frame_texture(0).get_image() if anim else null
		_check(first_frame != null and first_frame.get_pixel(0, 0).a < 0.05 and first_frame.get_pixel(first_frame.get_width() / 2, 12).a > 0.9, "its alpha track is applied to every frame")
		var again := ImageLoader.decode(animated_bytes)
		_check(again is AnimatedTexture and (again as AnimatedTexture).frames == 9, "the synchronous decode reads the cached frames")
	else:
		_say("note OH_AVIF_ANIMATED is not set; animated AVIF was not exercised")
	var looping_bytes := FileAccess.get_file_as_bytes(OS.get_environment("OH_AVIF_LOOPING"))
	if ImageLoader.is_avif(looping_bytes):
		var held := ImageLoader.decode(looping_bytes)
		_check(held is AnimatedTexture, "a sequence that is not converted yet gets an animated placeholder")
		var filled := await _until(func() -> bool: return held is AnimatedTexture and (held as AnimatedTexture).frames == 3, 30.0)
		_check(filled and not (held as AnimatedTexture).one_shot and is_equal_approx((held as AnimatedTexture).get_frame_duration(1), 0.04), "it fills in with 3 frames of 0.04 s that loop forever")

	var clock := Time.get_ticks_msec()
	var texture := await ImageLoader.decode_async(main, body)
	_check(_transparent_and_solid(texture), "decode_async draws the AVIF with its transparency in %d ms" % (Time.get_ticks_msec() - clock))
	clock = Time.get_ticks_msec()
	var again := ImageLoader.decode(body)
	_check(_transparent_and_solid(again) and Time.get_ticks_msec() - clock < 500, "the synchronous decode is served from the disk cache in %d ms" % (Time.get_ticks_msec() - clock))

	var mounted: Variant = main.get("editor")
	if mounted is ScenarioEditor:
		editor = mounted
	else:
		editor = ScenarioEditor.new()
		main.ui.add_child(editor)
		editor.setup(main.engine, {"loader": main.menu.loader})
	await editor.open_scenario("default")
	_check(editor.is_open(), "the editor drawer opened on the built-in scenario")
	editor._go_section("assets")
	await _wait(0.6)
	var upload := _button(editor._content, "Upload")
	_check(upload != null, "the Assets section offers Upload for the cover")
	if upload:
		upload.pressed.emit()
		var stored := await _until(func() -> bool:
			var status: Variant = editor._details.get("assetStatus")
			return not editor._busy and status is Dictionary and bool((status as Dictionary).get("cover", false)), 30.0)
		_check(stored and editor._error.is_empty(), "the AVIF cover is accepted (%s)" % editor._error)
		var previews := []
		var shown := await _until(func() -> bool:
			previews.clear()
			_find_all(editor._content, func(entry: Node) -> bool: return entry is TextureRect and (entry as TextureRect).texture != null and (entry as TextureRect).is_visible_in_tree() and (entry as TextureRect).texture.get_width() == 1189, previews)
			return not previews.is_empty(), 30.0)
		_check(shown and _transparent_and_solid((previews[0] as TextureRect).texture), "the drawer previews the AVIF cover")
		await _shoot("avif-01-drawer-assets")
		var nav_cover: Variant = editor.get("_nav_cover")
		if nav_cover is Node:
			var nav_pictures := _find_all(nav_cover, func(entry: Node) -> bool: return entry is TextureRect, [])
			var nav_shown := await _until(func() -> bool: return not nav_pictures.is_empty() and (nav_pictures[0] as TextureRect).texture != null and (nav_pictures[0] as TextureRect).texture.get_width() == 1189, 30.0)
			_check(nav_shown, "the drawer's side cover shows the AVIF")
	editor.close_editor()
	await _wait(0.8)
	main.menu._show_page("scenarios")
	var covers := []
	var on_card := await _until(func() -> bool:
		covers.clear()
		_find_all(main.menu, func(entry: Node) -> bool: return entry is CoverRect and (entry as CoverRect).is_visible_in_tree() and _cover_texture(entry) != null and _cover_texture(entry).get_width() == 1189, covers)
		return not covers.is_empty(), 40.0)
	_check(on_card and _transparent_and_solid(_cover_texture(covers[0])), "the scenario card shows the AVIF cover")
	await _wait(0.5)
	await _shoot("avif-02-scenario-card")
	await RenderingServer.frame_post_draw
	var shot := root.get_viewport().get_texture().get_image()
	var live := _find_all(main.menu, func(entry: Node) -> bool: return entry is CoverRect and (entry as CoverRect).is_visible_in_tree() and _cover_texture(entry) != null and _cover_texture(entry).get_width() == 1189, [])
	_check(not live.is_empty(), "a card with the AVIF cover is on screen to look at")
	if not live.is_empty():
		var card: Control = live[0]
		var centre: Vector2 = card.get_global_transform_with_canvas() * (card.size * 0.5)
		var brightest := 0.0
		for dy in range(-8, 9):
			for dx in range(-8, 9):
				brightest = maxf(brightest, shot.get_pixel(clampi(int(centre.x) + dx, 0, shot.get_width() - 1), clampi(int(centre.y) + dy, 0, shot.get_height() - 1)).r)
		_check(brightest > 0.25, "the placeholder picture shows through the cover's transparent middle, as React layers them (%.2f)" % brightest)
	var animated_cover := OS.get_environment("OH_AVIF_ANIMATED")
	if FileAccess.file_exists(animated_cover):
		OS.set_environment("OH_EDITOR_PICK", "*=" + animated_cover)
		await editor.open_scenario("default")
		editor._go_section("assets")
		await _wait(0.6)
		var upload_again := _button(editor._content, "Upload")
		if upload_again:
			upload_again.pressed.emit()
		var moving_previews := []
		var preview_moves := await _until(func() -> bool:
			moving_previews.clear()
			_find_all(editor._content, func(entry: Node) -> bool: return entry is TextureRect and (entry as TextureRect).is_visible_in_tree() and (entry as TextureRect).texture is AnimatedTexture, moving_previews)
			return not moving_previews.is_empty(), 30.0)
		_check(preview_moves and editor._error.is_empty(), "the drawer accepts an animated AVIF cover and previews it as an animation (%s)" % editor._error)
		await _shoot("avif-03-animated-drawer")
		editor.close_editor()
		await _wait(0.8)
		main.menu._show_page("scenarios")
		var moving_cards := []
		var card_moves := await _until(func() -> bool:
			moving_cards.clear()
			_find_all(main.menu, func(entry: Node) -> bool: return entry is CoverRect and (entry as CoverRect).is_visible_in_tree() and _cover_texture(entry) is AnimatedTexture, moving_cards)
			return not moving_cards.is_empty(), 40.0)
		_check(card_moves, "the scenario card plays the animated AVIF cover")
		await _wait(0.4)
		await _shoot("avif-04-animated-card")
	_finish()


func _finish() -> void:
	_say("done: %d failure(s)" % failures)
	await _wait(1.0)
	main.engine.stop()
	await _wait(0.5)
	quit(1 if failures > 0 else 0)
