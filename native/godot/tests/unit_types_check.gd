extends SceneTree

const UnitTypesPanel := preload("res://scripts/editor/unit_types_panel.gd")

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
	root.add_child(main)
	_run.call_deferred()


func _say(text: String) -> void:
	print("[unit_types %6d ms] %s" % [Time.get_ticks_msec() - started, text])


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


func _label(node: Node, text: String) -> Label:
	var found := _find_all(node, func(entry: Node) -> bool: return entry is Label and (entry as Label).text == text and (entry as Label).is_visible_in_tree(), [])
	return found[0] if not found.is_empty() else null


func _select_near(node: Node, caption: String) -> OptionButton:
	var label := _label(node, caption)
	if label == null:
		return null
	var holder := label.get_parent()
	for depth in range(3):
		var selects := _find_all(holder, func(entry: Node) -> bool: return entry is OptionButton, [])
		if not selects.is_empty():
			return selects[0]
		holder = holder.get_parent()
	return null


func _select_after(node: Node, caption: String) -> OptionButton:
	var label := _label(node, caption)
	if label == null:
		return null
	var after := false
	for child in label.get_parent().get_children():
		if child == label:
			after = true
		elif after and child is OptionButton:
			return child
	return null


func _pick(select: OptionButton, text: String) -> bool:
	if select == null:
		return false
	for index in range(select.item_count):
		if select.get_item_text(index) == text and not select.is_item_separator(index):
			select.select(index)
			select.item_selected.emit(index)
			return true
	return false


func _type(edit: LineEdit, text: String) -> void:
	edit.text = text
	edit.text_changed.emit(text)


func _clear_shell() -> void:
	var shell: ShellBoot = main.get("shell") as ShellBoot
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


func _run() -> void:
	await process_frame
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 120000:
			_say("FAIL the menu never appeared")
			_finish()
			return
		await process_frame
	_say("menu ready, phone=%s" % UI.phone())
	await _clear_shell()
	var mounted: Variant = main.get("editor")
	if mounted is ScenarioEditor:
		editor = mounted
	else:
		editor = ScenarioEditor.new()
		main.ui.add_child(editor)
		editor.setup(main.engine, {"loader": main.menu.loader})
	await _wait(0.5)
	await editor.open_scenario("default")
	await _until(func() -> bool: return not editor._constants.get("economicCurrencies", []).is_empty(), 20.0)
	await _world_tab()
	await _unit_types_card()
	await _save_scenario()
	await _workshop()
	await _game()
	_finish()


func _world_tab() -> void:
	editor._go_section("world")
	await _wait(0.6)
	var currency := _select_near(editor._content, "DEFAULT GDP DISPLAY CURRENCY")
	_check(currency != null and currency.item_count == 6 and currency.get_item_text(currency.selected) == "US dollar (USD, $)", "the World tab offers the scenario's default GDP display currency, US dollars first")
	_check(_label(editor._content, "Suggested for new campaigns; players can override it. GDP numbers remain in canonical 2026 USD.") != null, "with beta's line under it")
	var funding := _select_near(editor._content, "PROJECTS FUNDING BASIS")
	_check(funding != null and funding.get_item_text(funding.selected) == "Estimated national GDP allowance", "and the Projects funding basis, a GDP allowance by default")
	_check(_label(editor._content, "GDP allowance is an estimate, not treasury cash. Non-monetary scenarios advance projects by time and capacity without recording financial payments; no GDP is required.") != null, "with beta's line under it")
	_check(_pick(currency, "Euro (EUR, €)") and str(editor._form.get("economicDisplayCurrency", "")) == "EUR", "picking the euro sets the form")
	_check(_pick(funding, "Non-monetary time and effort") and str(editor._form.get("projectFundingMode", "")) == "nonmonetary", "picking non-monetary sets the form")
	await _shoot("ut-01-world-currency")


func _unit_types_card() -> void:
	editor._go_section("features")
	var found := await _until(func() -> bool: return not _find_all(editor._content, func(entry: Node) -> bool: return entry.get_script() == UnitTypesPanel, []).is_empty(), 20.0)
	_check(found, "the Features tab has the Unit types card under Wars")
	if not found:
		return
	var panel: Node = _find_all(editor._content, func(entry: Node) -> bool: return entry.get_script() == UnitTypesPanel, [])[0]
	_check(_label(panel, "Unit types") != null and _label(panel, "No unit types yet.") != null, "titled Unit types, and says none yet")
	var name_input: LineEdit = panel.get("_name_input")
	_check(name_input.placeholder_text == "New unit type name (e.g. Dragon)", "the name field's placeholder is beta's")
	await _scroll_to(panel)
	await _shoot("ut-02-unit-types-empty")
	_type(name_input, "Dragon")
	await panel.call("_add_type")
	var made := await _until(func() -> bool: return (panel.get("_value") as Array).size() == 1, 10.0)
	_check(made and str(((panel.get("_value") as Array)[0] as Dictionary).get("id", "")) == "dragon", "Add makes a type named Dragon, id dragon, open below")
	_check(_label(panel, "×1 · ×1 · ×1") != null and _label(panel, "Infantry") != null, "an ordinary infantry unit until the author says otherwise")
	var kind := _select_near(panel, "KIND")
	_check(_pick(kind, "Air"), "the Kind select offers Air")
	await _until(func() -> bool: return str(((panel.get("_value") as Array)[0] as Dictionary).get("base", "")) == "air", 5.0)
	var attack := _find_all(panel, func(entry: Node) -> bool: return entry is LineEdit and (entry as LineEdit).tooltip_text.begins_with("How hard it hits"), [])
	var tough := _find_all(panel, func(entry: Node) -> bool: return entry is LineEdit and (entry as LineEdit).tooltip_text.begins_with("How little it loses"), [])
	var speed := _find_all(panel, func(entry: Node) -> bool: return entry is LineEdit and (entry as LineEdit).tooltip_text.begins_with("How fast it moves"), [])
	_check(attack.size() == 1 and tough.size() == 1 and speed.size() == 1, "Attack, Toughness and Speed, each with its hint")
	if attack.size() == 1:
		_type(attack[0], "5")
		await _until(func() -> bool: return is_equal_approx(float(((panel.get("_value") as Array)[0] as Dictionary).get("attack", 1)), 5.0), 5.0)
		_type(tough[0], "x3")
		await _until(func() -> bool: return is_equal_approx(float(((panel.get("_value") as Array)[0] as Dictionary).get("toughness", 1)), 3.0), 5.0)
		_type(speed[0], "9")
		await _until(func() -> bool: return is_equal_approx(float(((panel.get("_value") as Array)[0] as Dictionary).get("speed", 1)), 5.0), 5.0)
		(speed[0] as LineEdit).focus_exited.emit()
		await _until(func() -> bool: return (speed[0] as LineEdit).text == "5", 5.0)
		_check((speed[0] as LineEdit).text == "5", "a speed past 5 is held at 5 when the field is left")
	var icon := _find_all(panel, func(entry: Node) -> bool: return entry is LineEdit and (entry as LineEdit).placeholder_text == "✈", [])
	_check(icon.size() == 1, "the Icon field shows the kind's mark as its placeholder")
	if icon.size() == 1:
		_type(icon[0], "🐉")
		await _until(func() -> bool: return str(((panel.get("_value") as Array)[0] as Dictionary).get("icon", "")) == "🐉", 5.0)
	var owner_inputs := _find_all(panel, func(entry: Node) -> bool: return entry is LineEdit and (entry as LineEdit).placeholder_text == "Add a country", [])
	_check(owner_inputs.size() == 1 and _label(panel, "Any country") != null, "Who may field it: any country, and a field to add one")
	if owner_inputs.size() == 1:
		_type(owner_inputs[0], "France")
		(owner_inputs[0] as LineEdit).text_submitted.emit("France")
		await _until(func() -> bool: return (((panel.get("_value") as Array)[0] as Dictionary).get("owners", []) as Array).has("France"), 5.0)
	await _frames(4)
	var type: Dictionary = (panel.get("_value") as Array)[0]
	_say("the type: " + JSON.stringify(type))
	_check(str(type.get("base", "")) == "air" and is_equal_approx(float(type.get("attack", 0)), 5.0) and is_equal_approx(float(type.get("toughness", 0)), 3.0) and is_equal_approx(float(type.get("speed", 0)), 5.0) and str(type.get("icon", "")) == "🐉" and (type.get("owners", []) as Array) == ["France"], "the dragon: air, five times as strong, three times as tough, speed 5, its icon, France only")
	_check(JSON.stringify(editor._form.get("unitTypes")) == JSON.stringify(panel.get("_value")), "the card writes the editor's form")
	_check(_label(panel, "×5 · ×3 · ×5") != null and _label(panel, "Dragon") != null and _label(panel, "France") != null, "its row reads ×5 · ×3 · ×5 and lists France")
	await _scroll_to(panel)
	await _shoot("ut-03-unit-types-dragon")


func _scroll_to(node: Node) -> void:
	await _frames(4)
	var scroll: ScrollContainer = editor.get("_scroll")
	if scroll and node is Control:
		scroll.scroll_vertical = int((node as Control).global_position.y - (scroll.get_child(0) as Control).global_position.y) - 12
	await _frames(3)


func _save_scenario() -> void:
	await editor._save()
	var reply: Dictionary = await main.engine.request("editor.details", {"kind": "scenario", "id": "default"})
	var data: Dictionary = reply["result"]["details"]["data"]
	var world: Dictionary = data.get("world", {})
	var game: Dictionary = data.get("game", {})
	var types: Array = world.get("unitTypes", []) if world.get("unitTypes") is Array else []
	_check(types.size() == 1 and str((types[0] as Dictionary).get("id", "")) == "dragon", "Save writes the scenario's unit types")
	_check(str(game.get("economicDisplayCurrency", "")) == "EUR", "Save writes the default GDP display currency into the scenario's game")
	_check(str(world.get("projectFundingMode", "")) == "nonmonetary", "Save writes the Projects funding basis into the scenario's world")


func _workshop() -> void:
	editor._go_section("overview")
	await _wait(0.3)
	editor._open_workshop()
	var up := await _until(func() -> bool: return editor._workshop != null and is_instance_valid(editor._workshop) and bool(editor._workshop.get("hydrated")), 240.0)
	_check(up, "the Workshop opened on the scenario's map")
	if not up:
		return
	var workshop: Workshop = editor._workshop
	_check(workshop.unit_types.size() == 1 and str((workshop.unit_types[0] as Dictionary).get("name", "")) == "Dragon", "the Workshop is handed the scenario's unit types")
	var added: Dictionary = await workshop.request("workshop.unit.add", {"lng": 2.35, "lat": 48.85})
	var unit_id := str(added.get("id", ""))
	await workshop.request("workshop.unit.update", {"unitId": unit_id, "patch": {"ownerCode": "France", "name": "Escadron du Dragon"}})
	workshop.open_popup("unit", unit_id, Vector2(workshop.map.size.x * 0.5, workshop.map.size.y * 0.35), false)
	var popup: WorkshopPopup = workshop.get("_popup")
	var offered := await _until(func() -> bool: return popup != null and is_instance_valid(popup) and popup._kind_select.item_count > 6, 10.0)
	_check(offered and popup._kind_select.is_item_separator(6) and popup._kind_select.get_item_text(6) == "Unit types" and popup._kind_select.get_item_text(7) == "🐉 Dragon", "a French unit's kind offers the Unit types group: 🐉 Dragon")
	if offered:
		popup._kind_select.show_popup()
	await _shoot("ut-04-workshop-unit-kind")
	if offered:
		popup._kind_select.get_popup().hide()
		popup._kind_select.select(7)
		popup._kind_select.item_selected.emit(7)
	var typed := await _until(func() -> bool:
		for row in workshop.state.get("units", []):
			if str((row as Dictionary).get("id", "")) == unit_id:
				return str((row as Dictionary).get("unitType", "")) == "dragon" and str((row as Dictionary).get("type", "")) == "air"
		return false, 5.0)
	_check(typed, "picking it makes the unit a dragon, an air unit")
	workshop._close_popup()
	workshop.open_panel_named("units")
	await _wait(0.5)
	_check(_label(workshop, "🐉 Dragon · France · 100%") != null, "the Units panel calls it 🐉 Dragon")
	await _shoot("ut-05-workshop-units")
	var german: Dictionary = await workshop.request("workshop.unit.add", {"lng": 13.4, "lat": 52.5})
	var german_id := str(german.get("id", ""))
	await workshop.request("workshop.unit.update", {"unitId": german_id, "patch": {"ownerCode": "Germany"}})
	workshop.open_popup("unit", german_id, Vector2(workshop.map.size.x * 0.5, workshop.map.size.y * 0.35), false)
	popup = workshop.get("_popup")
	await _wait(1.0)
	_check(popup != null and popup._kind_select.item_count == 6, "a German unit is not offered a type only France may field")
	workshop._close_popup()
	await workshop.request("workshop.unit.remove", {"unitId": german_id})
	workshop.close_panel()
	var feature: Dictionary = await workshop.request("workshop.feature.add", {"coord": [-1.6, 47.2], "mapFeature": true})
	var feature_id := str(feature.get("id", ""))
	await workshop.request("workshop.feature.update", {"featureId": feature_id, "patch": {"name": "Chantiers de l'Atlantique", "kind": "chantier naval"}})
	var row := _feature(workshop, feature_id)
	_check(str(row.get("glyph", "")) == "•", "a kind of the author's own is a landmark until a family is picked")
	workshop.open_popup("feature", feature_id, Vector2(workshop.map.size.x * 0.5, workshop.map.size.y * 0.3), false)
	popup = workshop.get("_popup")
	await _frames(3)
	var drawn := _select_after(popup, "Drawn as")
	_check(drawn != null and drawn.get_item_text(drawn.selected) == "Landmark", "its popup offers Drawn as, Landmark first")
	_check(_pick(drawn, "Industry and science"), "Drawn as offers Industry and science")
	await _until(func() -> bool: return str(_feature(workshop, feature_id).get("glyph", "")) == "✦", 5.0)
	_check(str(_feature(workshop, feature_id).get("family", "")) == "industry-science" and str(_feature(workshop, feature_id).get("glyph", "")) == "✦", "drawn as industry and science: ✦, whatever its words")
	await _shoot("ut-06-workshop-drawn-as")
	workshop._close_popup()
	var saved: Dictionary = await workshop.request_raw("workshop.save", {"mode": "quick"})
	_check(saved.get("ok", false) and not (saved.get("result", {}) as Dictionary).has("error"), "the Workshop saved into the scenario")
	var reply: Dictionary = await main.engine.request("editor.details", {"kind": "scenario", "id": "default"})
	var world: Dictionary = reply["result"]["details"]["data"]["world"]
	var kept := false
	for unit in world.get("units", []):
		if str((unit as Dictionary).get("name", "")) == "Escadron du Dragon":
			kept = str((unit as Dictionary).get("unitType", "")) == "dragon" and str((unit as Dictionary).get("type", "")) == "air"
	_check(kept, "the unit keeps its type in the scenario")
	var family := ""
	for marker in world.get("markers", []):
		if str((marker as Dictionary).get("name", "")) == "Chantiers de l'Atlantique":
			family = str((marker as Dictionary).get("family", ""))
	_check(family == "industry-science", "the structure keeps the family it is drawn as (%s)" % family)
	workshop.emit_signal("closed")
	await _wait(0.5)
	editor._hide()


func _feature(workshop: Workshop, id: String) -> Dictionary:
	for row in workshop.state.get("features", []):
		if str((row as Dictionary).get("id", "")) == id:
			return row
	return {}


func _game() -> void:
	await main._start_scenario("default")
	var picker: CountryPicker = main.picker
	await _wait(1.0)
	picker._choose("France")
	await _wait(0.5)
	var currency := _select_near(picker, "GDP display currency")
	_check(currency != null and currency.get_item_text(currency.selected) == "Euro (EUR, €)", "the difficulty step offers the GDP display currency, the scenario's euro first")
	_check(_label(picker, "Display only · fixed 2026 reference rates. The simulation keeps USD accounting; you can change this later.") != null, "with beta's line under it")
	await _shoot("ut-07-picker-currency")
	_check(_pick(currency, "British pound (GBP, £)"), "the pound can be picked")
	picker._start("medium")
	var entered := await _until(func() -> bool: return main.hud.visible and not str(main.get("game_id")).is_empty(), 120.0)
	_check(entered, "the game started")
	if not entered:
		return
	var shell: ShellBoot = main.get("shell") as ShellBoot
	if shell:
		await _until(func() -> bool: return not shell.loading.is_open(), 90.0)
	await _wait(1.5)
	var opened: Dictionary = await main.engine.request("editor.open", {"kind": "game", "id": str(main.get("game_id"))})
	_check(opened.get("ok", false) and str(opened["result"]["form"].get("economicDisplayCurrency", "")) == "GBP", "the new game keeps the currency picked")
	var listed: Dictionary = await main.engine.request("forces.list")
	var dragon := {}
	for unit in listed.get("result", {}).get("units", []):
		if str((unit as Dictionary).get("name", "")) == "Escadron du Dragon":
			dragon = unit
	_check(str(dragon.get("kindName", "")) == "Dragon" and str(dragon.get("kindIcon", "")) == "🐉" and str(dragon.get("unitType", "")) == "dragon", "the game's unit is of the scenario's Dragon type")
	var forces: ForcesPanel = main.get("forces") as ForcesPanel
	if forces:
		await forces.set_open(true)
		await _wait(0.8)
		_check(not _find_all(forces, func(entry: Node) -> bool: return entry is Label and (entry as Label).text.begins_with("Dragon · France"), []).is_empty() and _label(forces, "🐉") != null, "the Forces panel calls it 🐉 Dragon")
		forces.editing = str(dragon.get("id", ""))
		forces._editor = {"name": str(dragon.get("name", "")), "type": "own:dragon", "strength": "100", "status": str(dragon.get("status", "")), "note": "", "saving": false, "error": ""}
		forces._render()
		await _frames(3)
		var kinds := _find_all(forces, func(entry: Node) -> bool: return entry is OptionButton and (entry as OptionButton).item_count > 6, [])
		if kinds.size() == 1:
			(kinds[0] as OptionButton).show_popup()
		_check(kinds.size() == 1 and (kinds[0] as OptionButton).is_item_separator(6) and (kinds[0] as OptionButton).get_item_text(6) == "Unit types" and (kinds[0] as OptionButton).get_item_text((kinds[0] as OptionButton).selected) == "🐉 Dragon", "its editor offers the Unit types group, the Dragon picked")
		await _shoot("ut-08-forces-dragon")
		if kinds.size() == 1:
			(kinds[0] as OptionButton).get_popup().hide()
			_check(_pick(kinds[0], "Armor"), "the kinds are offered beside the types")
			await forces._save_unit(dragon)
			var after: Dictionary = await main.engine.request("forces.list")
			var plain := {}
			for unit in after.get("result", {}).get("units", []):
				if str((unit as Dictionary).get("id", "")) == str(dragon.get("id", "")):
					plain = unit
			_check(str(plain.get("type", "")) == "armor" and str(plain.get("unitType", "")) == "", "made armour again it is no type of the scenario's")
			forces.editing = ""
			await _editor_back(forces, dragon)
		await forces.set_open(false)
	var cards: Variant = main.hud.get("map_cards")
	if cards is Node:
		await (cards as Node).call("show_unit", str(dragon.get("id", "")))
		await _wait(0.6)
		_check(_label(cards as Node, "Dragon · France") != null and _label(cards as Node, "🐉") != null, "the unit card shows 🐉 and Dragon · France")
		await _shoot("ut-09-unit-card")


func _editor_back(forces: ForcesPanel, dragon: Dictionary) -> void:
	await main.engine.request("forces.edit", {"id": str(dragon.get("id", "")), "patch": {"type": "air", "unitType": "dragon"}})
	await forces.refresh()


func _finish() -> void:
	_say("done: %d failure(s)" % failures)
	main.engine.stop()
	for i in range(2):
		await process_frame
	quit(1 if failures > 0 else 0)
