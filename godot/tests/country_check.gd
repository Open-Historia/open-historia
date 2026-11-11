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
	await create_timer(540.0).timeout
	if not finished:
		_say("FAIL the check did not finish in time")
		_finish(1)


func _say(text: String) -> void:
	print("[country_check %6d ms] %s" % [Time.get_ticks_msec() - started, text])


func _check(ok: bool, what: String) -> void:
	if ok:
		_say("ok   " + what)
	else:
		_say("FAIL " + what)
		failures.append(what)


func _frames(count: int) -> void:
	for i in range(count):
		await process_frame


func _wait(seconds: float) -> void:
	await create_timer(seconds).timeout


func _cover_gone() -> void:
	var shell: Variant = main.get("shell")
	if shell == null or shell.get("loading") == null:
		return
	var deadline := Time.get_ticks_msec() + 90000
	while (shell.loading as GameLoadingScreen).is_open() and Time.get_ticks_msec() < deadline:
		await process_frame
	await _wait(0.5)


func _shoot2x(name: String) -> void:
	if shots.is_empty():
		return
	var before := root.size
	root.size = Vector2i(before.x * 2, before.y * 2)
	root.content_scale_factor = 2.0
	await _frames(10)
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + "@2x.png"))
	root.size = before
	root.content_scale_factor = 1.0
	await _frames(6)


func _shoot(name: String) -> void:
	await _frames(4)
	await RenderingServer.frame_post_draw
	if shots.is_empty():
		return
	root.get_viewport().get_texture().get_image().save_png(shots.path_join(name + ".png"))
	_say("screenshot " + name)


func _texts(node: Node, into: PackedStringArray) -> PackedStringArray:
	if node is CanvasItem and not (node as CanvasItem).is_visible_in_tree():
		return into
	if node is Label:
		into.append((node as Label).text.to_upper() if (node as Label).uppercase else (node as Label).text)
	elif node is OptionButton:
		for index in range((node as OptionButton).item_count):
			into.append((node as OptionButton).get_item_text(index))
	elif node is Button:
		into.append((node as Button).text)
	elif node is RichTextLabel:
		into.append((node as RichTextLabel).get_parsed_text())
	elif node is LineEdit:
		into.append((node as LineEdit).placeholder_text)
	for child in node.get_children():
		_texts(child, into)
	return into


func _find_all(node: Node, test: Callable, into: Array) -> Array:
	if node == null or node.is_queued_for_deletion():
		return into
	if test.call(node):
		into.append(node)
	for child in node.get_children():
		_find_all(child, test, into)
	return into


func _press(node: Node, wanted: String) -> bool:
	if node is Button and (node as Button).text == wanted:
		(node as Button).pressed.emit()
		return true
	for child in node.get_children():
		if _press(child, wanted):
			return true
	return false


func _view_buttons(panel: Node) -> Array:
	return _find_all(panel.get("body"), func(node: Node) -> bool: return node is Button and node.has_meta("view") and (node as Button).is_visible_in_tree(), [])


func _power_blocs(panel: Node) -> void:
	panel.scroll.scroll_vertical = 0
	panel._render()
	await _wait(0.3)
	var buttons := _view_buttons(panel)
	_check(buttons.size() == 2 and (buttons[0] as Button).text == "Political parties" and (buttons[1] as Button).text == "Power blocs" and bool(buttons[0].get_meta("pressed")) and not bool(buttons[1].get_meta("pressed")), "politics: a country with parties and power blocs offers both, parties first")
	var overview := _find_all(panel.body, func(node: Node) -> bool: return node is CountryPanel.StatDonut, [])
	var switch_row: Control = (buttons[0] as Control).get_parent().get_parent().get_parent().get_parent() if buttons.size() == 2 else null
	var holder: Node = switch_row.get_parent() if switch_row else null
	var donut_row: Node = overview[0].get_parent().get_parent() if overview.size() == 1 else null
	var ordered := holder != null and donut_row != null and donut_row.get_parent() == holder and donut_row.get_index() < switch_row.get_index() and switch_row.get_index() < holder.get_child_count() - 1
	_check(ordered and is_equal_approx(float(overview[0].get("limit")), 185.0), "politics: the switch sits under the party donut, above the party records")
	var frame: Control = (buttons[0] as Control).get_parent().get_parent() if buttons.size() == 2 else null
	_check(frame != null and frame.size.x < panel.body.size.x - 60.0, "politics: the switch is a compact strip, not a full-width bar")
	await _shoot("02c-country-parties-switch")
	if buttons.size() == 2:
		(buttons[1] as Button).pressed.emit()
	await _wait(0.4)
	_check(panel.landscape_view == "blocs" and _caps_label(panel.body, "Power blocs") and _has_text(panel, "Recorded non-party influence; each strength is independent") and _has_text(panel, "2 recorded · 1 quantified"), "politics: Power blocs shows its own ledger, counted")
	_check(_has_text(panel, "Employers' federation") and _has_text(panel, "38%") and _has_text(panel, "business lobby  ·  Pierre Gattaz  ·  organised") and _has_text(panel, "Trade union confederations") and _has_text(panel, "strong") and _has_text(panel, "Qualitative influence assessment"), "politics: each bloc with its own strength, a qualitative one without a bar")
	_check(_find_all(panel.body, func(node: Node) -> bool: return node is CountryPanel.StatDonut, []).is_empty() and not _has_text(panel, "Socialist Party (PS)") and not _has_text(panel, "Other political support"), "politics: no party donut and no party rows behind the blocs")
	var tracks := _find_all(panel.body, func(node: Node) -> bool: return node is CountryPanel.StatBar and node.get_parent() is VBoxContainer and is_equal_approx(float(node.get("value")), 38.0), [])
	_check(tracks.size() == 1, "politics: the quantified bloc has its 0-100 bar")
	var after := _view_buttons(panel)
	_check(after.size() == 2 and bool(after[1].get_meta("pressed")), "politics: the switch stays under the ledger, Power blocs chosen")
	await _shoot("02d-country-power-blocs")
	panel._pick_party("medef")
	await _wait(0.3)
	_check(_has_text(panel, "The voice of large French employers.") and _has_text(panel, "Leading figure") and _has_text(panel, "38% influence"), "politics: a bloc opens onto its public details")
	await _shoot("02e-country-power-bloc-open")
	after = _view_buttons(panel)
	if after.size() == 2:
		(after[0] as Button).pressed.emit()
	await _wait(0.4)
	_check(panel.landscape_view == "parties" and panel.selected_party.is_empty() and _has_text(panel, "Socialist Party (PS)") and _find_all(panel.body, func(node: Node) -> bool: return node is CountryPanel.StatDonut, []).size() == 1, "politics: back to the parties, details closed")


func _relation_names(panel: Node) -> PackedStringArray:
	var names := PackedStringArray()
	var box: Variant = panel.get("_relations_box")
	if not (box is Node) or not is_instance_valid(box):
		return names
	for entry in (box as Node).get_children():
		if entry.is_queued_for_deletion():
			continue
		var found := _find_all(entry, func(node: Node) -> bool: return node is Label and (node as Label).clip_text, [])
		if not found.is_empty():
			names.append((found[0] as Label).text)
	return names


func _index_columns(panel: Node) -> int:
	var grids := _find_all(panel.get("body"), func(node: Node) -> bool: return node is CountryPanel.StatFitGrid, [])
	return (grids[0] as GridContainer).columns if grids.size() == 1 else -1


func _caps_label(node: Node, wanted: String) -> bool:
	return not _find_all(node, func(item: Node) -> bool: return item is Label and (item as Label).uppercase and (item as Label).text == wanted and (item as Label).is_visible_in_tree(), []).is_empty()


func _has_text(node: Node, wanted: String) -> bool:
	if node == null:
		return false
	for value in _texts(node, PackedStringArray()):
		if value.contains(wanted):
			return true
	return false


func _until(condition: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await process_frame
	return condition.call()


func _rgb(colors: Dictionary, owner: String) -> String:
	var rgb: Array = colors.get(owner, [])
	var parts: PackedStringArray = []
	for value in rgb:
		parts.append(str(int(value)))
	return ",".join(parts)


func _click_marker(at: Vector2) -> Control:
	var holder := Control.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for bar in [Rect2(at.x - 8.0, at.y, 17.0, 1.0), Rect2(at.x, at.y - 8.0, 1.0, 17.0)]:
		var line := ColorRect.new()
		line.color = Color(1, 0.2, 0.2, 1)
		line.mouse_filter = Control.MOUSE_FILTER_IGNORE
		line.position = (bar as Rect2).position
		line.size = (bar as Rect2).size
		holder.add_child(line)
	main.hud.add_child(holder)
	return holder


func _region_of(owner: String, preferred: String) -> int:
	var view: MapView = main.map_view
	var best := -1
	var area := -1.0
	for index in range(view._names.size()):
		if view.region_owner(index) != owner:
			continue
		if view.region_name(index) == preferred:
			return index
		if view._areas[index] > area:
			area = view._areas[index]
			best = index
	return best



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

func _run() -> void:
	await process_frame
	while not main.menu.visible:
		if Time.get_ticks_msec() - started > 90000:
			_say("FAIL the menu never appeared")
			_finish(1)
			return
		await process_frame
	_say("menu ready")
	await _clear_shell()
	await main._start_scenario("default")
	main.picker._choose("France")
	await main._on_country_chosen("France", "medium")
	await _until(func() -> bool: return main.hud.drawers.has("country") and main.hud.map_cards != null, 20.0)
	await _cover_gone()
	await _wait(1.0)
	var seeded: Dictionary = await main.engine.request("country.standin_seed", {"blocs": true})
	_check(seeded.get("ok", false), "stand-in world seeded")
	await _country_panel()
	await _map_cards()
	await _search()
	await _legend()
	_say("static memory %.1f MB" % (OS.get_static_memory_usage() / 1048576.0))
	_say("done: %d failure(s) %s" % [failures.size(), ", ".join(failures)])
	_finish(0 if failures.is_empty() else 1)


func _country_panel() -> void:
	var panel = main.hud.drawers["country"]
	await main.hud.show_country("")
	await _wait(1.0)
	_check(panel.target == "France", "panel opens on the player's own country")
	_check(_has_text(panel, "🏛 Politics") and _has_text(panel, "🤝 Diplomacy") and _has_text(panel, "📈 Economy") and _has_text(panel, "🏆 Ranking"), "four tabs")
	_check(_has_text(panel, "COUNTRY") and panel.header_title.uppercase and not panel.header_subtitle.visible and not _has_text(panel, "Politics, diplomacy and national statistics"), "drawer toolbar: COUNTRY in capitals, no subtitle")
	var hero_flags := _find_all(panel.body, func(node: Node) -> bool: return node is TextureRect and node.get_parent() is PanelContainer and (node.get_parent() as Control).custom_minimum_size == Vector2(74, 50), [])
	_check(hero_flags.size() == 1 and (hero_flags[0] as TextureRect).stretch_mode == TextureRect.STRETCH_KEEP_ASPECT_CENTERED and (hero_flags[0] as TextureRect).texture != null, "hero: the flag is shown whole in its 74×50 frame")
	_check(_find_all(panel.body, func(node: Node) -> bool: return node is CountryPanel.DossierHero, []).size() == 1, "hero: the identity header")
	_check(_find_all(panel.body, func(node: Node) -> bool: return node is CountryPanel.GovernmentCard, []).size() == 1, "politics: the Government card is a leadership brief")
	var donuts := _find_all(panel.body, func(node: Node) -> bool: return node is CountryPanel.StatDonut, [])
	_check(donuts.size() == 1 and is_equal_approx(float(donuts[0].get("limit")), 185.0) and _has_text(panel, "PS") and _has_text(panel, "29%"), "politics: the party donut beside its legend")
	_check(_has_text(panel, "Your country"), "Your country badge")
	_check(_has_text(panel, "GOVERNMENT") and _has_text(panel, "François Hollande"), "politics: government card")
	_check(_has_text(panel, "POLITICAL LANDSCAPE"), "politics: landscape card")
	_check(_has_text(panel, "NATIONAL PRIORITIES"), "politics: national priorities")
	_check(_has_text(panel, "Click any country on the map to inspect it, or open its card and choose Stats."), "footer text")
	_check(_has_text(panel, "Legislature National Assembly (577 seats)") and _has_text(panel, "Next election June 2017"), "politics: the government card's legislature and next election")
	_check(_find_all(panel.body, func(node: Node) -> bool: return node.get_class() == "Control" and node.get("parts") != null and (node.get("parts") as Array).size() == 3, []).size() == 1, "politics: the legislature's seats as one bar of three parties")
	_check(_has_text(panel, "Compile the government and parties again") and not _has_text(panel, "Compile parties"), "politics: parties filled in offer a fresh compile")
	_check(not _has_text(panel, "GOVERNING PARTY") and not _has_text(panel, "GOVERNING COALITION"), "politics: no repeated governing-parties box")
	_check(_has_text(panel, "Socialist Party (PS)") and _has_text(panel, "Parti socialiste") and _has_text(panel, "Governing") and _has_text(panel, "Opposition"), "politics: party rows carry names, native names and roles")
	_check(_has_text(panel, "Social Democracy · Social Democracy") and _has_text(panel, "Leader: Jean-Christophe Cambadélis") and _has_text(panel, "286/577 seats") and _has_text(panel, "29% support") and _has_text(panel, "Founded 1969"), "politics: party row ideology, leader, seats, support, founded")
	_check(_has_text(panel, "National Populism · Frontism (unlisted)"), "politics: an unlisted subideology is marked")
	_check(_has_text(panel, "Other political support"), "politics: the other support row")
	await _shoot("01-country-politics")
	panel.scroll.scroll_vertical = 0
	await _wait(0.3)
	_check(panel._sticky != null and not panel._sticky.visible, "tabs: in place under the header, no floating copy")
	panel.scroll.scroll_vertical = 420
	await _until(func() -> bool: return panel._sticky != null and panel._sticky.visible, 5.0)
	await _wait(0.2)
	var pane_top: float = panel.scroll.get_global_rect().position.y
	_check(panel._sticky != null and panel._sticky.visible and absf(panel._sticky.global_position.y - pane_top) < 1.0 and _has_text(panel._sticky, "🏛 Politics"), "tabs: stick to the top of the pane when it scrolls")
	await _shoot("01b-country-sticky-tabs")
	panel.scroll.scroll_vertical = 0
	await _wait(0.2)
	panel._pick_party("ps")
	await _wait(0.3)
	_check(_has_text(panel, "The governing party of the centre-left.") and _has_text(panel, "Pro-Europeanism") and not _has_text(panel, "Party leader"), "politics: a party row opens onto its description and outlook")
	panel.scroll.scroll_vertical = 360
	await _wait(0.2)
	await _shoot("02-country-politics-party")
	panel._pick_party("ps")
	panel.scroll.scroll_vertical = 0
	var compile_spy := GDScript.new()
	compile_spy.source_code = "extends EngineLink
var real: EngineLink
var asked: Array = []
func request(method: String, args: Dictionary = {}) -> Dictionary:
	if method == \"country.compile\":
		asked.append(str(args.get(\"target\", \"\")))
		await Engine.get_main_loop().create_timer(0.6).timeout
		return {\"ok\": true, \"result\": {\"ok\": false, \"error\": \"The answer named no government and no parties.\"}}
	return await real.request(method, args)
func last_request_id() -> int:
	return real.last_request_id()
func cancel(id: int) -> void:
	real.cancel(id)
"
	compile_spy.reload()
	var compiler: Node = compile_spy.new()
	compiler.set("real", panel.engine)
	var live_engine: EngineLink = panel.engine
	panel.engine = compiler
	panel._compile_parties()
	await _wait(0.2)
	_check(_has_text(panel, "Compiling the government and parties…") and not _has_text(panel, "Compile the government and parties again"), "politics: compiling shows its progress")
	await _until(func() -> bool: return not panel.compiling and _has_text(panel, "Compile the government and parties again"), 30.0)
	await _wait(0.4)
	_check(compiler.get("asked") == ["France"] and _has_text(panel, "The answer named no government and no parties.") and _has_text(panel, "Compile the government and parties again"), "politics: a failed compile says why and can be tried again")
	await _shoot("02b-country-politics-compile-error")
	panel.engine = live_engine
	compiler.free()
	panel.compile_error = ""
	await _power_blocs(panel)

	await panel.set_tab("diplomacy")
	await _wait(0.6)
	_check(_has_text(panel, "Bilateral relations") and _has_text(panel, "Formal agreements") and _has_text(panel, "Current conflicts"), "diplomacy sections")
	_check(_has_text(panel, "Élysée Treaty") and _has_text(panel, "vs Libya") and _has_text(panel, "Fighting alongside Chad"), "diplomacy rows")
	_check(_has_text(panel, "War weariness: ") and _has_text(panel, "France 45") and _has_text(panel, "strained") and _has_text(panel, "Libya 83") and _has_text(panel, "exhausted") and not _has_text(panel, "Chad 30"), "war weariness: your own country beside the enemy's, a word for each")
	await _shoot("03-country-diplomacy")
	_check(_has_text(panel, "RELATIONS") and _has_text(panel, "ACTIVE AGREEMENTS") and _has_text(panel, "CONFLICTS") and not _has_text(panel, "🤝 DIPLOMACY"), "diplomacy: the three counts as one strip, no section title")
	_check(_has_text(panel, "−100 to +100 · 3 recorded"), "diplomacy: the relations header counts the records")
	_check(_relation_names(panel) == PackedStringArray(["Germany", "United Kingdom", "Libya"]), "diplomacy: relations strongest first (%s)" % ", ".join(_relation_names(panel)))
	_check(not _has_text(panel, "The Franco-German engine of the European Union.") and _has_text(panel, "Find country or relation…") and _has_text(panel, "Strongest first") and _has_text(panel, "Name A–Z"), "diplomacy: a compact roster with search and sort, stories folded")
	panel._toggle_relation("id:rel-fr-de")
	await _wait(0.2)
	_check(_has_text(panel, "The Franco-German engine of the European Union.") and _has_text(panel, "Inspect country ›"), "diplomacy: a row opens onto its story and Inspect country")
	await _shoot("03a-country-relation-open")
	panel._relation_field.text = "channel"
	await panel._search_relations("channel")
	await _wait(0.2)
	_check(_relation_names(panel) == PackedStringArray(["United Kingdom"]) and is_instance_valid(panel._relation_field) and panel._relation_field.text == "channel", "diplomacy: search finds a relation by its description (%s)" % ", ".join(_relation_names(panel)))
	panel._relation_field.text = "hostile"
	await panel._search_relations("hostile")
	await _wait(0.2)
	_check(_relation_names(panel) == PackedStringArray(["Libya"]), "diplomacy: search finds a relation by its status")
	panel._relation_field.text = "absent"
	await panel._search_relations("absent")
	await _wait(0.2)
	_check(_relation_names(panel).is_empty() and _has_text(panel, "No relationships match the search. 3 records are still available."), "diplomacy: no match says how many records remain")
	await _shoot("03b-country-relation-no-match")
	panel._relation_field.text = ""
	await panel._search_relations("")
	await panel._sort_relations("weakest")
	await _wait(0.2)
	_check(_relation_names(panel) == PackedStringArray(["Libya", "United Kingdom", "Germany"]), "diplomacy: weakest first (%s)" % ", ".join(_relation_names(panel)))
	await panel._sort_relations("alphabetical")
	await _wait(0.2)
	_check(_relation_names(panel) == PackedStringArray(["Germany", "Libya", "United Kingdom"]), "diplomacy: name A–Z (%s)" % ", ".join(_relation_names(panel)))
	await _shoot("03c-country-relations-sorted")
	var inspected := _press(panel, "Inspect country ›")
	await _until(func() -> bool: return panel.target == "Germany", 10.0)
	await _wait(0.6)
	_check(inspected and panel.target == "Germany" and panel.tab == "diplomacy" and panel.relation_sort == "strongest" and panel.relation_open.is_empty(), "diplomacy: Inspect country opens that country on the same tab, its roster reset")
	await panel.show_country("France")
	await _wait(0.6)
	panel.scroll.scroll_vertical = 560
	await _wait(0.2)
	_check(_has_text(panel, "Propose peace in the chat") and not _has_text(panel, "Put these terms"), "peace is proposed in the chat")
	await _shoot("04-country-diplomacy-peace")
	var opened: Array = []
	panel.open_chat.connect(func(enemy: String) -> void: opened.append(enemy), CONNECT_ONE_SHOT)
	var pressed := _press(panel, "Propose peace in the chat")
	var chat: Variant = main.hud.panels.get("chat")
	var talking := func() -> String:
		if not chat is ChatPanel:
			return ""
		var countries: Array = ChatPanel.a((chat as ChatPanel).active.get("countries", []))
		return ChatPanel.t(ChatPanel.d(countries[0]).get("name", "")) if not countries.is_empty() else ""
	await _until(func() -> bool: return talking.call() == "Libya", 60.0)
	await _wait(0.6)
	_check(pressed and opened == ["Libya"] and (chat as ChatPanel).is_open() and talking.call() == "Libya", "Propose peace in the chat opens the chat with the enemy (pressed %s, signal %s, open %s, with %s)" % [str(pressed), str(opened), str(chat is ChatPanel and (chat as ChatPanel).is_open()), talking.call()])
	await _shoot("04b-country-peace-chat")
	main.hud.set_active_panel("")
	await _wait(0.4)

	await panel.set_tab("economy")
	var ready: bool = await _until(func() -> bool: return panel.sheet_status == "ready" or panel.sheet_status == "error", 120.0)
	await _wait(0.8)
	_check(ready and panel.sheet_status == "ready", "economy sheet generated (%s %s)" % [panel.sheet_status, panel.sheet_error])
	_check(_has_text(panel, "⚠ NATIONAL STABILITY") and _has_text(panel, "TOTAL POPULATION") and _has_text(panel, "GDP breakdown"), "economy cards")
	_check(_has_text(panel, "⚑ STRATEGIC INDICES") and _has_text(panel, "📈 ECONOMY") and _has_text(panel, "GDP/CAPITA"), "economy sections")
	var grids := _find_all(panel.body, func(node: Node) -> bool: return node is CountryPanel.StatFitGrid, [])
	var index_grid: GridContainer = grids[0] if grids.size() == 1 else null
	_check(index_grid != null and index_grid.get_child_count() == 6 and index_grid.columns == 1, "economy: the six strategic indices in one compact grid, one column at the default width")
	_check(index_grid != null and _has_text(index_grid.get_child(0), "⚑ Sovereignty") and _has_text(index_grid.get_child(0), "82 / 100") and _has_text(index_grid.get_child(5), "International reputation") and _has_text(index_grid.get_child(5), "78 / 100"), "economy: indices keep their order and read N / 100")
	await _shoot("05-country-economy")
	panel.set_drawer_width(560)
	await _wait(0.5)
	_check(_index_columns(panel) == 2, "economy: a wider drawer fits two index columns (%d)" % _index_columns(panel))
	await _shoot("05a-country-economy-wide")
	panel.set_drawer_width(320)
	await _wait(0.5)
	_check(_index_columns(panel) == 1, "economy: and one again at the default width (%d)" % _index_columns(panel))
	panel.scroll.scroll_vertical = 700
	await _wait(0.3)
	await _shoot("06-country-economy-lower")
	panel.scroll.scroll_vertical = 4000
	await _wait(0.3)
	_check(_has_text(panel, "MILITARY POWER") and _has_text(panel, "Advanced statistics") and not _has_text(panel, "Historical tracking"), "military card and Advanced statistics, with no Historical tracking")
	await _shoot("07-country-economy-bottom")
	panel.scroll.scroll_vertical = 0
	panel._toggle_refresh_menu()
	await _wait(0.3)
	_check(_has_text(panel, "Rebuild baseline from scratch") and _has_text(panel, "\"Uses a request only if relevant canonical evidence has changed since the last assessment.\""), "refresh menu")
	await _shoot("08-country-refresh-menu")
	panel.refresh_step = "confirm"
	panel._render()
	await _wait(0.3)
	_check(_has_text(panel, "Rebuild this country's baseline from scratch? It uses 1 request and replaces the current numbers."), "rebuild confirm")
	await _shoot("09-country-refresh-confirm")
	panel.refresh_step = ""
	panel._render()

	await panel._open_advanced()
	await _wait(0.8)
	_check(panel._modal != null and _has_text(panel._modal, "Advanced Statistics") and _has_text(panel._modal, "TIME RANGE"), "advanced statistics modal")
	await _shoot("10-country-advanced")
	panel._close_modal()
	_check(not panel.has_method("_open_tracking") and panel.get("_tracking_model") == null, "Stats has no Historical tracking sheet")
	panel.scroll.scroll_vertical = 0

	await panel.set_tab("ranking")
	await _wait(1.2)
	_check(_has_text(panel, "RANKED BY") and _has_text(panel, "Land held"), "ranking metrics")
	var selects := _find_all(panel.body, func(node: Node) -> bool: return node is OptionButton, [])
	_check(selects.size() == 1 and (selects[0] as OptionButton).item_count == (panel.ranking.get("metrics", []) as Array).size() and (selects[0] as OptionButton).item_count > 1, "ranking: one complete metric selector instead of a cloud of buttons")
	var picked_rank := str(panel.ranking.get("selectedRank", ""))
	_check(picked_rank.begins_with("#") and _has_text(panel, picked_rank) and _caps_label(panel.body, "Selected country") and _caps_label(panel.body, "Countries ranked") and _has_text(panel, "%d / %d" % [int(panel.ranking.get("ranked", 0)), int(panel.ranking.get("total", 0))]), "ranking: the selected country's rank and how many are ranked (%s)" % picked_rank)
	_check(_caps_label(panel.body, "Rank") and _caps_label(panel.body, "Country") and _caps_label(panel.body, "Value"), "ranking: the leaderboard's column heads")
	var rank_rows := _find_all(panel.body, func(node: Node) -> bool: return node is CountryPanel.RankRow, [])
	_check(not rank_rows.is_empty() and _has_text(rank_rows[0], "01") and _find_all(rank_rows[0], func(node: Node) -> bool: return node is CountryPanel.StatBar, []).is_empty(), "ranking: rows read 01, 02… without the old bar")
	var rank_flags := _find_all(panel.body, func(node: Node) -> bool: return node is TextureRect and (node as TextureRect).texture != null, [])
	_check(not rank_flags.is_empty() and rank_flags.all(func(node: TextureRect) -> bool: return node.stretch_mode == TextureRect.STRETCH_KEEP_ASPECT_CENTERED), "ranking: flags shown whole (%d)" % rank_flags.size())
	_check(rank_rows.any(func(node: Node) -> bool: return bool(node.get("mine_bar"))), "ranking: the player's row is marked")
	await _shoot("12-country-ranking")
	var before: String = panel.target
	panel.ranking_all = true
	await panel._load_ranking(panel._sequence)
	var rows_before: int = (panel.ranking.get("rows", []) as Array).size()
	panel._retarget("Germany")
	await _frames(2)
	_check(not panel.ranking.is_empty() and panel.ranking_all, "a ranking pick keeps the list on screen while the panel moves")
	await _until(func() -> bool: return panel.target == "Germany", 10.0)
	await _wait(0.8)
	_check(before == "France" and panel.target == "Germany", "a ranking row retargets the panel")
	_check(panel.ranking_all and (panel.ranking.get("rows", []) as Array).size() == rows_before, "the ranking stays expanded after a pick (%d rows)" % rows_before)
	await _shoot("13-country-ranking-germany")
	main.hud.close_drawer()
	await _wait(0.5)
	var spy_script := GDScript.new()
	spy_script.source_code = "extends EngineLink
var calls: Array = []
func request(method: String, args: Dictionary = {}) -> Dictionary:
	calls.append(method)
	return {\"ok\": false}
"
	spy_script.reload()
	var spy: Node = spy_script.new()
	var real: EngineLink = panel.engine
	panel.engine = spy
	await panel.refresh()
	panel._background("ensureCountryAssessed", panel._sequence)
	await panel.set_tab("economy")
	await panel.set_tab("politics")
	await panel.on_region_selected("Germany")
	await _wait(1.2)
	var asked: Array = spy.get("calls")
	_check(asked.is_empty(), "the closed drawer asks the engine nothing (%s)" % ", ".join(PackedStringArray(asked)))
	panel.engine = real
	spy.free()


func _puppet_summary(cards: MapCards, view: MapView, index: int, screen: Vector2) -> void:
	var installed := 0
	for entry in [["Andorra", "client"], ["Tunisia", "satellite"], ["Luxembourg", "client"], ["Belgium", "satellite"], ["Mali", "protectorate"]]:
		var made: Dictionary = await main.engine.request("cheats.puppets.change", {"op": "install", "overlord": "France", "puppet": entry[0], "kind": entry[1]})
		if made.get("ok", false):
			installed += 1
	_check(installed == 5, "five subordinate states installed for France (%d)" % installed)
	cards.dismiss_all()
	await _wait(0.4)
	await cards.show_region(index, view.region_name(index), view.region_owner(index), screen)
	await _wait(0.8)
	var card: Control = cards._floating
	var counted := _find_all(card, func(node: Node) -> bool: return node is Label and (node as Label).text == "5", [])
	_check(_has_text(card, "Subordinate states") and counted.size() == 1, "region card: the subordinate states are counted")
	_check(_has_text(card, "+3 more"), "region card: two are named and the rest summed up as +3 more")
	var rows := _find_all(card, func(node: Node) -> bool: return node is RichTextLabel and (node as RichTextLabel).get_parsed_text().ends_with(")"), [])
	var named := rows.map(func(node: Node) -> String: return (node as RichTextLabel).get_parsed_text())
	var known := ["Andorra (client state)", "Tunisia (puppet state)", "Luxembourg (client state)", "Belgium (puppet state)", "Mali (protectorate)"]
	_check(named.size() == 2 and named.all(func(line: String) -> bool: return known.has(line)), "region card: each named with its kind (%s)" % ", ".join(named))
	var link := _find_all(card, func(node: Node) -> bool: return node is LinkButton and (node as LinkButton).text == "Country", [])
	_check(link.size() == 1 and _has_text(card, "Diplomacy") and _has_text(card, "→"), "region card: Country → Diplomacy points to the full list")
	await _shoot("14c-region-card-puppets")
	var opened: Array = []
	var hook := func(name: String) -> void: opened.append(name)
	cards.open_stats.connect(hook)
	if link.size() == 1:
		(link[0] as LinkButton).pressed.emit()
	await _wait(0.6)
	cards.open_stats.disconnect(hook)
	_check(opened == ["France"] and cards._floating == null, "Country opens the country's panel and closes the card (%s)" % str(opened))
	await _until(func() -> bool: return main.hud.drawers["country"].is_open(), 10.0)
	await _wait(0.6)
	await _shoot("14d-region-card-puppets-country")
	main.hud.close_drawer()
	await _wait(0.4)
	for entry in ["Andorra", "Tunisia", "Luxembourg", "Belgium", "Mali"]:
		await main.engine.request("cheats.puppets.change", {"op": "release", "overlord": "France", "puppet": entry})
	await cards.show_region(index, view.region_name(index), view.region_owner(index), screen)
	await _wait(0.6)


func _map_cards() -> void:
	var cards = main.hud.map_cards
	await cards.refresh()
	var view: MapView = main.map_view
	view.focus_owner("France")
	await _wait(1.5)
	var index := _region_of("France", "Île-de-France")
	_check(index >= 0, "a French region on the map")
	var screen := view.world_to_screen(view._centroids[index])
	view.select_region(index)
	await cards.show_region(index, view.region_name(index), view.region_owner(index), screen)
	await _wait(0.6)
	_check(_has_text(cards, "France") and _has_text(cards, view.region_name(index)), "region card shows country and region")
	var card: Control = cards._floating
	var tip: float = card.position.y + card.get_combined_minimum_size().y
	_check(abs(tip - (screen.y - 1.0)) <= 1.5, "region card pointer tip sits just above the click, as beta places it (tip %.1f, click %.1f)" % [tip, screen.y])
	_check(cards._region_pointer != null and cards._region_pointer.modulate.a > 0.5, "region card: the pointer shows while it points at the click")
	_check(abs(card.position.x + card.size.x * 0.5 - screen.x) <= 1.5, "region card centred on the click")
	var banners := _find_all(card, func(node: Node) -> bool: return node is Control and node.has_meta("banner"), [])
	var banner_flags := _find_all(card, func(node: Node) -> bool: return node is TextureRect and (node as TextureRect).texture != null and node.get_parent().has_meta("banner"), [])
	if banners.size() == 1 and banner_flags.size() == 1:
		var shown_flag: Texture2D = (banner_flags[0] as TextureRect).texture
		var whole: float = round(238.0 * shown_flag.get_height() / shown_flag.get_width())
		_check(absf(float(banners[0].get_meta("banner")) - whole) < 0.5 and (banners[0] as Control).size.y == whole and (banner_flags[0] as TextureRect).stretch_mode == TextureRect.STRETCH_KEEP_ASPECT_CENTERED, "region card: the flag banner keeps the flag's own proportions (%.0f px for %.0f)" % [(banners[0] as Control).size.y, whole])
	else:
		_check(false, "region card: a flag banner (%d, %d)" % [banners.size(), banner_flags.size()])
	await _shoot("14-region-card")
	var home: Vector2 = cards._floating_anchor
	cards._floating_anchor = cards._screen_to_world(Vector2(screen.x, 30.0))
	await _wait(0.4)
	_check(card.position.y >= 7.5 and card.position.y <= 8.5, "region card: near the top edge it stays on screen (top %.1f)" % card.position.y)
	_check(cards._region_pointer.modulate.a < 0.5, "region card: held on screen, its pointer no longer points at the click and is hidden")
	await _shoot("14a-region-card-top-edge")
	cards._floating_anchor = home
	await _wait(0.4)
	var marker := _click_marker(screen)
	await _shoot("14b-region-card-click-marker")
	marker.queue_free()
	await _puppet_summary(cards, view, index, screen)
	cards._region_info_open = true
	cards._build_region(false)
	await _wait(0.4)
	_check(_has_text(cards, "Cities") or _has_text(cards, "No cities or neighbouring regions are known for this region."), "region info section")
	_check(_has_text(cards, "Check in Rostra") and not _has_text(cards, "Listen in"), "region card: Check in Rostra, no Listen in")
	await _shoot("15-region-card-info")
	var region: Dictionary = cards._region
	var rostra := main.hud.panels.get("social") as RostraPanel
	main.hud.open_rostra({"polity": str(region.get("rostraPlace", "France")), "polityKey": str(region.get("rostraPlace", "France"))})
	await _until(func() -> bool: return rostra != null and is_instance_valid(rostra._search) and str(rostra._search.view.get("title", "")) == "France", 40.0)
	await _wait(0.5)
	_check(main.hud.active_panel == "social" and rostra != null and rostra.tab == "search" and is_instance_valid(rostra._search) and str(rostra._search.view.get("title", "")) == "France", "Check in Rostra opens Rostra's Search on the region's country")
	await _shoot("16-check-in-rostra")
	main.hud.set_active_panel("")
	await _wait(0.4)
	await cards._open_country_from_region()
	await _wait(1.0)
	_check(_has_text(cards._info_panel, "Related Events") and _has_text(cards._info_panel, "Details") and _has_text(cards._info_panel, "Sovereign Regions"), "country info panel")
	_check(not main.hud.drawers["country"].is_open(), "the info button opens the country's panel, not the stats drawer")
	await _shoot("18-country-info")
	await cards._run_report()
	await _wait(0.5)
	var info_scroll: ScrollContainer = cards._info_body.get_parent().get_parent()
	info_scroll.scroll_vertical = 100000
	await _wait(0.3)
	_check(_has_text(cards._info_panel, "Advisor Report") and _has_text(cards._info_panel, "Regenerate Report"), "advisor report")
	await _shoot("19-country-info-report")
	cards._open_flag_picker()
	await _wait(1.5)
	var picker = cards._flag_picker
	_check(is_instance_valid(picker) and _has_text(picker, "Change flag") and _has_text(picker, "In this game") and _has_text(picker, "Upload image") and _has_text(picker, "Use standard"), "flag picker")
	await _shoot("20-flag-picker")
	picker.close()
	await _wait(0.3)
	cards.dismiss_all()
	view.select_region(-1)
	await cards.refresh()
	var unit_pick: Dictionary = cards.pick_unit_or_feature(cards._project(1.6, 47.3))
	_check(str(unit_pick.get("kind", "")) == "unit", "a click on the unit picks it")
	await cards.open_pick(unit_pick)
	await _wait(0.6)
	_check(_has_text(cards, "2nd Armoured Brigade") and _has_text(cards, "Request orders") and _has_text(cards, "Disband"), "unit card")
	var unit_at := view.world_to_screen(cards._project(1.6, 47.3))
	var unit_card: Control = cards._floating
	var unit_tip: float = unit_card.position.y + unit_card.get_combined_minimum_size().y
	_check(abs(unit_tip - (unit_at.y - 14.0)) <= 1.5 and abs(unit_card.position.x + unit_card.size.x * 0.5 - unit_at.x) <= 1.5, "unit card pointer tip sits 14 px above the unit, as released (tip %.1f, unit %.1f)" % [unit_tip, unit_at.y])
	await _shoot("21-unit-card")
	cards.dismiss()
	await _wait(0.3)
	var handled: bool = await cards.handle_click(cards._project(5.93, 43.12))
	await _wait(0.6)
	_check(handled and _has_text(cards, "Toulon Naval Base") and _has_text(cards, "Map Feature · Naval Base"), "feature card")
	var feature_at := view.world_to_screen(cards._project(5.93, 43.12))
	var feature_card: Control = cards._floating
	var feature_tip: float = feature_card.position.y + feature_card.get_combined_minimum_size().y
	_check(abs(feature_tip - (feature_at.y - 14.0)) <= 1.5 and abs(feature_card.position.x + feature_card.size.x * 0.5 - feature_at.x) <= 1.5, "feature card pointer tip sits 14 px above the feature, as released (tip %.1f, feature %.1f)" % [feature_tip, feature_at.y])
	await _shoot("22-feature-card")
	cards.dismiss_all()
	await _wait(0.3)


func _search() -> void:
	var search = main.hud.search
	await search.open()
	search._input.text = "Pari"
	await search._on_text_changed("Pari")
	await _until(func() -> bool: return search.suggestions.size() > 1, 8.0)
	await _wait(0.6)
	_check(search.suggestions.size() > 0 and bool((search.suggestions[0] as Dictionary).get("local", false)), "search: local result first")
	_check(_has_text(search, "IN WORLD"), "search: IN WORLD tag")
	await _shoot("23-search")
	search.close()
	await _wait(0.4)


func _legend() -> void:
	main.hud.set_map_mode("diplomatic", true)
	await main.hud._apply_map_mode()
	main.map_view.focus_owner("France")
	main.map_view._zoom_at(main.map_view.get_viewport_rect().size * 0.5, 0.3)
	await _wait(1.5)
	var colors: Dictionary = await main.hud.legend.stance_colors()
	_check(_rgb(colors, "France") == "37,99,235" and _rgb(colors, "Libya") == "239,68,68" and _rgb(colors, "United Kingdom") == "56,189,248" and _rgb(colors, "Germany") == "34,197,94", "stance colours: you %s, at war %s, ally by a military treaty %s, friendly by a friendship treaty %s" % [_rgb(colors, "France"), _rgb(colors, "Libya"), _rgb(colors, "United Kingdom"), _rgb(colors, "Germany")])
	_check(main.hud.legend.visible and _has_text(main.hud.legend, "DIPLOMACY") and _has_text(main.hud.legend, "Friendly / Trade"), "legend")
	await _shoot("24-diplomatic-legend")
	main.hud.set_map_mode("political", true)
	await main.hud._apply_map_mode()


func _finish(code: int) -> void:
	if finished:
		return
	finished = true
	main.engine.stop()
	await _frames(2)
	quit(code)
