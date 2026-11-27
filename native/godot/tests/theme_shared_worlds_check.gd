extends SceneTree

const NOTICE := "2026-11-shared-game-replies"
const SCENES := ["table", "ledger", "secrets", "envoys", "fronts"]
const TOUCHES := {"table": "Join", "secrets": "Open", "envoys": "Sign", "fronts": "Strike"}

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
	print("[theme_shared_worlds_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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


func _shoot(file_name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(file_name + ".png"))
	_say("screenshot " + file_name)


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


func _is_stage(node: Node) -> bool:
	return node.get("drives") != null and node.get("kind") != null and node.get("scene") != null


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


func _shapes(shape: Variant) -> int:
	var total := 1
	for child in shape.children:
		total += _shapes(child)
	return total


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
	_check(wanted.size() == 1, "the Shared Worlds notice is served")
	if wanted.is_empty():
		_finish()
		return
	var phone := UI.phone()
	var tag := "phone" if phone else "desk"
	for still in [false, true]:
		var notice := UpdateNotice.new()
		shell.overlay.add_child(notice)
		await notice.setup(main.engine, wanted, {"reduceMotion": still})
		_check(notice.page_count() == 5, "its five pages (%d)" % notice.page_count())
		for index in range(notice.page_count()):
			notice.show_page(index)
			var banner: Dictionary = notice._pages[index]["banner"]
			var scene_name := str(banner.get("scene", ""))
			_check(UpdateNotice.Themes.registered(banner) and str(banner.get("theme", "")) == "sharedWorlds", "page %d is drawn by the shared worlds theme" % (index + 1))
			_check(scene_name == SCENES[index], "page %d is the %s picture (%s)" % [index + 1, SCENES[index], scene_name])
			await _wait(0.6 if still else 3.5)
			var stage: Node = _find(notice, _is_stage)
			_check(stage != null and str(stage.get("kind")) == scene_name, "page %d draws its %s stage" % [index + 1, scene_name])
			if stage == null:
				continue
			var picture: Variant = stage.get("scene")
			_check(_shapes(picture.root) > 20, "the %s picture has its shapes (%d)" % [scene_name, _shapes(picture.root)])
			var holder := stage as Control
			_check(holder.size.y > 0.0 and absf(holder.size.y - holder.size.x * 220.0 / float(stage.get("view_w"))) < 2.0, "the %s picture keeps its height to its width (%s)" % [scene_name, holder.size])
			if not still and scene_name != "envoys":
				var drives: Array = stage.get("drives")
				if scene_name in ["ledger", "secrets", "fronts"]:
					_check(not drives.is_empty(), "the %s picture has its own motions running" % scene_name)
			await _shoot("sw-%s-%s-%d" % [tag, "still" if still else "moving", index + 1])
			var texts := Array(_texts(notice, PackedStringArray()))
			_check(texts.any(func(value: String) -> bool: return value.contains(str(banner.get("title", "")))), "page %d reads its title" % (index + 1))
			for section in banner.get("sections", []):
				var heading := str((section as Dictionary).get("heading", ""))
				_check(texts.has(heading), "page %d has its card %s" % [index + 1, heading])
			if TOUCHES.has(scene_name):
				var label: String = TOUCHES[scene_name]
				var touch: Node = _find(stage, func(node: Node) -> bool: return node is Button and node.name == label)
				_check(touch != null, "the %s picture has its %s touch" % [scene_name, label])
				if touch != null and not still:
					(touch as Button).pressed.emit()
					if scene_name in ["envoys", "fronts"]:
						await _wait(0.3)
						(touch as Button).pressed.emit()
					await _wait(2.6)
					match scene_name:
						"table":
							_check(bool(stage.get("joined")), "Join sits you down at the free seat")
						"secrets":
							_check(bool(stage.get("open")), "Open lifts your letter")
						"envoys":
							_check(int(stage.get("signs")) == 2, "Sign stamps the treaty")
						"fronts":
							_check(int(stage.get("strikes")) == 2, "Strike sends one more from each side")
					await _shoot("sw-%s-moving-%d-touched" % [tag, index + 1])
		notice.queue_free()
		await _frames(3)
	_finish()


func _finish() -> void:
	_say("%s with %d failure(s)" % ["DONE" if failures == 0 else "FAILED", failures])
	main.engine.stop()
	await _frames(2)
	quit(1 if failures > 0 else 0)
