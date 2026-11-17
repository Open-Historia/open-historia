extends SceneTree

const NOTICE := "2026-11-projects-that-build"

var main: Node
var shots := ""
var started := 0
var failures := 0


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[theme_projects_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(ok: bool, what: String) -> void:
	if ok:
		_say("PASS " + what)
	else:
		failures += 1
		_say("FAIL " + what)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _until(condition: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await process_frame
	return bool(condition.call())


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _texts(node: Node, out: PackedStringArray) -> PackedStringArray:
	if node is Label:
		out.append((node as Label).text)
	elif node is Button:
		out.append((node as Button).text)
	elif node is RichTextLabel:
		out.append((node as RichTextLabel).get_parsed_text())
	for child in node.get_children():
		_texts(child, out)
	return out


func _find(node: Node, test: Callable) -> Node:
	for child in node.get_children():
		if test.call(child):
			return child
		var found := _find(child, test)
		if found:
			return found
	return null


func _clear_shell(shell: ShellBoot) -> void:
	var deadline := Time.get_ticks_msec() + 30000
	while shell.door_state == "deciding" and Time.get_ticks_msec() < deadline:
		await process_frame
	if shell.door != null and is_instance_valid(shell.door):
		shell.door.opened.emit()
	if not shell.notice_updates.is_empty():
		deadline = Time.get_ticks_msec() + 5000
		while not (shell.notice != null and is_instance_valid(shell.notice)) and Time.get_ticks_msec() < deadline:
			await process_frame
		for i in range(5):
			await process_frame
	if shell.notice != null and is_instance_valid(shell.notice):
		shell.notice.closed.emit()
	for i in range(3):
		await process_frame


func _run() -> void:
	await process_frame
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_check(false, "the menu appeared")
			_finish()
			return
		await process_frame
	var shell: ShellBoot = main.get("shell") as ShellBoot
	await _clear_shell(shell)
	var reply: Dictionary = await main.engine.request("shell.updates")
	var listed: Array = reply.get("result", {}).get("updates", [])
	var wanted := listed.filter(func(update: Variant) -> bool: return update is Dictionary and str((update as Dictionary).get("id", "")) == NOTICE)
	_check(wanted.size() == 1, "the Projects That Build notice is served")
	if wanted.is_empty():
		_finish()
		return
	for still in [false, true]:
		var notice := UpdateNotice.new()
		shell.overlay.add_child(notice)
		await notice.setup(main.engine, wanted, {"reduceMotion": still})
		_check(notice.page_count() == 2, "its two pages, works and plans (%d)" % notice.page_count())
		for index in range(notice.page_count()):
			notice.show_page(index)
			var banner: Dictionary = notice._pages[index]["banner"]
			_check(UpdateNotice.Themes.registered(banner) and str(banner.get("theme", "")) == "projects", "page %d is drawn by the projects theme" % (index + 1))
			await _wait(0.6 if still else 3.2)
			await _shoot("tp-%s-%d" % ["still" if still else "moving", index + 1])
			var texts := Array(_texts(notice, PackedStringArray()))
			_check(texts.any(func(value: String) -> bool: return value.contains(str(banner.get("title", "")))), "page %d reads its title" % (index + 1))
			if index == 0:
				var keys := ["Off", "Low", "Normal", "High"]
				_check(keys.all(func(word: String) -> bool: return texts.has(word)), "the works page has its funding keys")
				var high: Node = _find(notice, func(node: Node) -> bool: return node is Button and (node as Button).tooltip_text == "High")
				if high and not still:
					(high as Button).pressed.emit()
					await _wait(0.4)
					var works: Node = _find(notice, func(node: Node) -> bool: return node.get("chosen") != null and node.get("value") != null)
					_check(works != null and str(works.get("value")) == "high" and bool(works.get("chosen")), "a funding key picks the pace and stops the walk")
					await _wait(2.5)
					await _shoot("tp-moving-1-high")
			if index == 1:
				_check(texts.has("Start"), "the plans page carries its Start stamp")
		notice.queue_free()
		await _frames(3)
	var window := root.get_window()
	var before := window.size
	window.size = Vector2i(400, 860)
	await _frames(4)
	var narrow := UpdateNotice.new()
	shell.overlay.add_child(narrow)
	await narrow.setup(main.engine, wanted, {"reduceMotion": false})
	await _wait(3.2)
	_check(narrow._narrow, "a phone-wide notice draws the narrow pages")
	await _shoot("tp-phone-1")
	narrow.show_page(1)
	await _wait(3.2)
	await _shoot("tp-phone-2")
	narrow.queue_free()
	window.size = before
	await _frames(4)
	_finish()


func _finish() -> void:
	_say("%s with %d failure(s)" % ["DONE" if failures == 0 else "FAILED", failures])
	main.engine.stop()
	await _frames(2)
	quit(1 if failures > 0 else 0)
