extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var finished := false


func _initialize() -> void:
	var redraw := Node2D.new()
	root.add_child(redraw)
	process_frame.connect(redraw.queue_redraw)
	shots = OS.get_environment("OH_SHOTS")
	started = Time.get_ticks_msec()
	main = (load("res://main.tscn") as PackedScene).instantiate()
	root.mouse_passthrough = true
	root.add_child(main)
	_watchdog.call_deferred()
	_run.call_deferred()


func _watchdog() -> void:
	await create_timer(600.0).timeout
	if not finished:
		_say("FAIL the check did not finish in time")
		_finish(1)


func _say(text: String) -> void:
	print("[economic_currency_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(ok: bool, what: String, detail := "") -> void:
	if ok:
		_say("ok   " + what)
	else:
		_say("FAIL " + what + ("" if detail.is_empty() else " — " + detail))
		failures.append(what)


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
	return condition.call()


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	var prefix := "phone-" if UI.phone() else ""
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(prefix + name + ".png"))
	_say("screenshot " + prefix + name)


func _texts(node: Node, into: PackedStringArray) -> PackedStringArray:
	if node is CanvasItem and not (node as CanvasItem).is_visible_in_tree():
		return into
	if node is Label:
		into.append((node as Label).text.to_upper() if (node as Label).uppercase else (node as Label).text)
	elif node is OptionButton:
		into.append((node as OptionButton).get_item_text((node as OptionButton).selected) if (node as OptionButton).selected >= 0 else "")
	elif node is Button:
		into.append((node as Button).text)
	elif node is RichTextLabel:
		into.append((node as RichTextLabel).get_parsed_text())
	elif node is LineEdit:
		into.append((node as LineEdit).placeholder_text)
	for child in node.get_children():
		_texts(child, into)
	return into


func _has_text(node: Node, wanted: String) -> bool:
	if node == null:
		return false
	for value in _texts(node, PackedStringArray()):
		if value.contains(wanted):
			return true
	return false


func _labels(node: Node, text: String, into: Array) -> Array:
	if node is Label and (node as Label).text == text and (node as Label).is_visible_in_tree():
		into.append(node)
	for child in node.get_children():
		_labels(child, text, into)
	return into


func _option_after(node: Node, label: String) -> OptionButton:
	for found in _labels(node, label, []):
		var parent := (found as Node).get_parent()
		var after := false
		for child in parent.get_children():
			if child == found:
				after = true
			elif after and child is OptionButton:
				return child
	return null


func _clear_shell() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
	var built_by := Time.get_ticks_msec() + 30000
	while shell == null and Time.get_ticks_msec() < built_by:
		await process_frame
		shell = main.get("shell") as ShellBoot
	if shell == null:
		return
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


func _cover_gone() -> void:
	var shell: Variant = main.get("shell")
	if shell == null or shell.get("loading") == null:
		return
	var deadline := Time.get_ticks_msec() + 90000
	while (shell.loading as GameLoadingScreen).is_open() and Time.get_ticks_msec() < deadline:
		await process_frame
	await _wait(0.5)


func _run() -> void:
	await process_frame
	if not await _until(func() -> bool: return main.menu.visible, 120.0):
		_say("FAIL the menu never appeared")
		_finish(1)
		return
	_say("menu ready")
	await _clear_shell()
	await main._start_scenario("default")
	await _wait(0.4)
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _until(func() -> bool: return main.hud.drawers.has("country") and main.hud.map_cards != null, 20.0)
	await _cover_gone()
	await _wait(1.0)
	await _stats("$", "USD", "")
	await _settings()
	await _stats("€", "EUR", "-eur")
	_say("done: %d failure(s) %s" % [failures.size(), ", ".join(failures)])
	_finish(0 if failures.is_empty() else 1)


func _stats(symbol: String, code: String, suffix: String) -> void:
	var panel = main.hud.drawers["country"]
	await main.hud.show_country("")
	await _wait(0.8)
	await panel.set_tab("economy")
	var ready: bool = await _until(func() -> bool: return panel.sheet_status == "ready" or panel.sheet_status == "error", 120.0)
	await _wait(0.8)
	_check(ready and panel.sheet_status == "ready", "France's economy is compiled", "%s %s" % [panel.sheet_status, panel.sheet_error])
	var unit := "2026-%s equivalent" % code
	var economy: Dictionary = panel.data.get("economy", {}) if typeof(panel.data.get("economy")) == TYPE_DICTIONARY else {}
	var gdp_card := ""
	var capita_card := ""
	var growth := ""
	var scope := ""
	for card_value in economy.get("cards", []):
		var card: Dictionary = card_value
		if str(card.get("label", "")) == "GDP":
			gdp_card = str(card.get("value", ""))
			growth = str(card.get("sub", ""))
		elif str(card.get("label", "")) == "GDP/CAPITA":
			capita_card = str(card.get("value", ""))
			scope = str(card.get("sub", ""))
	_check(gdp_card.begins_with(symbol) and capita_card.begins_with(symbol), "GDP and GDP per capita shown in %s" % code, "%s %s" % [gdp_card, capita_card])
	_check(growth.ends_with("· " + unit), "the GDP card names the display currency", growth)
	_check(scope == "Whole polity", "the per-capita headline is whole polity", scope)
	_check(_has_text(panel, "Domestic currency: ") and _has_text(panel, "· GDP display: %s. Canonical calculations remain in USD." % unit) and not _has_text(panel, "2026-EUR-equivalent values"), "the domestic currency line names the display currency")
	panel.scroll.scroll_vertical = 520
	await _wait(0.4)
	await _shoot("currency-01-stats%s" % suffix)
	panel.scroll.scroll_vertical = 0
	var ranking: Dictionary = await main.engine.request("country.ranking", {"target": "France", "metricKey": "gdp"})
	var rows: Array = ((ranking.get("result", {}) as Dictionary).get("rows", []) as Array) if ranking.get("ok", false) else []
	var first := str((rows[0] as Dictionary).get("value", "")) if not rows.is_empty() and typeof(rows[0]) == TYPE_DICTIONARY else ""
	_check(first.begins_with(symbol), "the GDP ranking in %s" % code, first)
	main.hud.set_active_panel("")
	await _wait(0.4)


func _settings() -> void:
	var menu: Node = main.game_menu
	menu.call("open")
	await _wait(0.6)
	menu.call("_open_workspace", "general", "game", Rect2(Vector2(40, 40), Vector2(300, 200)))
	await _wait(1.6)
	var workspace: Control = menu.get("_workspace")
	_check(workspace != null and workspace.visible, "the game's Settings open on General")
	var select := _option_after(workspace, "GDP display currency") if workspace else null
	var items := PackedStringArray()
	if select:
		for index in range(select.item_count):
			items.append(select.get_item_text(index))
	_check(select != null and select.get_item_text(select.selected) == "US dollar (USD, $)" and ", ".join(items) == "US dollar (USD, $), Euro (EUR, €), British pound (GBP, £), Russian ruble (RUB, ₽), Indian rupee (INR, ₹), Chinese yuan (CNY, ¥)", "Display offers the GDP display currency, dollars by default", ", ".join(items))
	_check(_has_text(workspace, "This campaign only. Fixed January 2026 reference rates; changes affect display, not economic simulation or the country's domestic currency."), "the currency's note")
	await _scroll_into_view(workspace, select)
	await _shoot("currency-02-settings")
	if select:
		for index in range(select.item_count):
			if select.get_item_text(index) == "Euro (EUR, €)":
				select.select(index)
				select.item_selected.emit(index)
	await _until(func() -> bool: return not bool(workspace.get("_currency_saving")), 10.0)
	await _wait(0.8)
	var game: Dictionary = await main.engine.request("doc.read", {"key": "game"})
	_check(str((game.get("result", {}) as Dictionary).get("economicDisplayCurrency", "")) == "EUR", "the choice is saved with this campaign", JSON.stringify(game.get("result", {})).left(160))
	select = _option_after(workspace, "GDP display currency")
	_check(select != null and select.get_item_text(select.selected) == "Euro (EUR, €)", "the select keeps the choice")
	menu.call("close")
	await _wait(0.8)


func _scroll_into_view(workspace: Control, node: Control) -> void:
	if node == null:
		return
	var scroller := workspace.find_children("*", "ScrollContainer", true, false)
	if scroller.is_empty():
		return
	var scroll := scroller[0] as ScrollContainer
	scroll.scroll_vertical = int(maxf(0.0, node.global_position.y - scroll.get_global_rect().position.y + scroll.scroll_vertical - 160.0))
	await _wait(0.4)


func _finish(code: int) -> void:
	if finished:
		return
	finished = true
	main.engine.stop()
	await _frames(2)
	quit(code)
