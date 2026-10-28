extends SceneTree

var main: Node
var shots := ""
var started := 0
var failures: PackedStringArray = []
var finished := false


func _initialize() -> void:
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
		into.append((node as Label).text)
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


func _cadence_choices(panel: Node) -> Array:
	var labels := PackedStringArray()
	for item in (panel.get("_tracking_model") as Dictionary).get("intervals", []):
		labels.append(str((item as Dictionary).get("label", "")))
	var modal: Node = panel.get("_modal")
	return _find_all(modal, func(node: Node) -> bool: return node is Button and labels.has((node as Button).text), [])


func _tracking_button(panel: Node) -> Variant:
	var found := _find_all(panel.get("body"), func(node: Node) -> bool: return node.get_script() != null and node.get("enabled") != null and node is PanelContainer and _has_text(node, "Historical tracking"), [])
	return found[0] if not found.is_empty() else null


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
	await _wait(1.0)
	var seeded: Dictionary = await main.engine.request("country.standin_seed")
	_check(seeded.get("ok", false), "stand-in world seeded")
	main.hud.move_child(main.hud.war_cards, main.hud.map_cards.get_index() + 1)
	await _country_panel()
	await _map_cards()
	await _search()
	await _legend()
	await _war_and_peace()
	_say("static memory %.1f MB" % (OS.get_static_memory_usage() / 1048576.0))
	_say("done: %d failure(s) %s" % [failures.size(), ", ".join(failures)])
	_finish(0 if failures.is_empty() else 1)


func _country_panel() -> void:
	var panel = main.hud.drawers["country"]
	await main.hud.show_country("")
	await _wait(1.0)
	_check(panel.target == "France", "panel opens on the player's own country")
	_check(_has_text(panel, "🏛 Politics") and _has_text(panel, "🤝 Diplomacy") and _has_text(panel, "📈 Economy") and _has_text(panel, "🏆 Ranking"), "four tabs")
	_check(_has_text(panel, "Country") and _has_text(panel, "Politics, diplomacy and national statistics"), "drawer header")
	_check(_has_text(panel, "Your country"), "Your country badge")
	_check(_has_text(panel, "GOVERNMENT") and _has_text(panel, "François Hollande"), "politics: government card")
	_check(_has_text(panel, "POLITICAL LANDSCAPE"), "politics: landscape card")
	_check(_has_text(panel, "NATIONAL PRIORITIES"), "politics: national priorities")
	_check(_has_text(panel, "Click any country on the map to inspect it, or open its card and choose Stats."), "footer text")
	await _shoot("01-country-politics")
	panel._pick_party("ps")
	await _wait(0.3)
	_check(_has_text(panel, "Party leader") and _has_text(panel, "Government"), "politics: party detail opens")
	panel.scroll.scroll_vertical = 360
	await _wait(0.2)
	await _shoot("02-country-politics-party")
	panel._pick_party("ps")
	panel.scroll.scroll_vertical = 0

	await panel.set_tab("diplomacy")
	await _wait(0.6)
	_check(_has_text(panel, "Bilateral relations") and _has_text(panel, "Formal agreements") and _has_text(panel, "Current conflicts"), "diplomacy sections")
	_check(_has_text(panel, "Élysée Treaty") and _has_text(panel, "vs Libya") and _has_text(panel, "Fighting alongside Chad"), "diplomacy rows")
	_check(_has_text(panel, "War weariness: ") and _has_text(panel, "France 45") and _has_text(panel, "strained") and _has_text(panel, "Libya 83") and _has_text(panel, "exhausted") and not _has_text(panel, "Chad 30"), "war weariness: your own country beside the enemy's, a word for each")
	await _shoot("03-country-diplomacy")
	panel.peace["war-sahel"] = {"open": true, "territory": "restored", "money": "they-light", "busy": false, "said": ""}
	panel._render()
	await _wait(0.3)
	panel.scroll.scroll_vertical = 560
	await _wait(0.2)
	_check(_has_text(panel, "Put these terms") and _has_text(panel, "They pay 1% a year for 5 years"), "peace controls open")
	await _shoot("04-country-diplomacy-peace")

	await panel.set_tab("economy")
	var ready: bool = await _until(func() -> bool: return panel.sheet_status == "ready" or panel.sheet_status == "error", 120.0)
	await _wait(0.8)
	_check(ready and panel.sheet_status == "ready", "economy sheet generated (%s %s)" % [panel.sheet_status, panel.sheet_error])
	_check(_has_text(panel, "⚠ NATIONAL STABILITY") and _has_text(panel, "TOTAL POPULATION") and _has_text(panel, "GDP breakdown"), "economy cards")
	_check(_has_text(panel, "⚑ STRATEGIC INDICES") and _has_text(panel, "📈 ECONOMY") and _has_text(panel, "GDP/CAPITA"), "economy sections")
	await _shoot("05-country-economy")
	panel.scroll.scroll_vertical = 700
	await _wait(0.3)
	await _shoot("06-country-economy-lower")
	panel.scroll.scroll_vertical = 4000
	await _wait(0.3)
	_check(_has_text(panel, "MILITARY POWER") and _has_text(panel, "Advanced statistics") and _has_text(panel, "Historical tracking"), "military card and the two buttons")
	await _shoot("07-country-economy-bottom")
	panel.scroll.scroll_vertical = 0
	panel._toggle_refresh_menu()
	await _wait(0.3)
	_check(_has_text(panel, "Rebuild baseline from scratch") and _has_text(panel, "Uses a request only if something has changed since the last assessment."), "refresh menu")
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
	await panel._open_tracking()
	await _wait(0.8)
	_check(panel._modal != null and _has_text(panel._modal, "Historical tracking") and _has_text(panel._modal, "Auto-refresh cadence"), "historical tracking modal")
	await _shoot("11-country-tracking")
	var busy_script := GDScript.new()
	busy_script.source_code = "extends EngineLink
func request(method: String, args: Dictionary = {}) -> Dictionary:
	return {\"ok\": true, \"result\": {\"busy\": method == \"country.busy\"}}
"
	busy_script.reload()
	var busy_link: Node = busy_script.new()
	var live_link: EngineLink = panel.engine
	var cadence_before := _cadence_choices(panel)
	_check(not cadence_before.is_empty() and cadence_before.all(func(b: Button) -> bool: return not b.disabled), "cadence choices lit while no turn runs (%d)" % cadence_before.size())
	panel.engine = busy_link
	await panel._poll_busy()
	await _wait(0.2)
	var cadence_busy := _cadence_choices(panel)
	_check(panel._modal_kind == "tracking" and not cadence_busy.is_empty() and cadence_busy.all(func(b: Button) -> bool: return b.disabled), "open tracking sheet dims its cadence live when a turn starts (%d)" % cadence_busy.size())
	panel.engine = live_link
	await panel._poll_busy()
	await _wait(0.2)
	var cadence_after := _cadence_choices(panel)
	_check(panel._modal_kind == "tracking" and not cadence_after.is_empty() and cadence_after.all(func(b: Button) -> bool: return not b.disabled), "and lights them again when it ends (%d)" % cadence_after.size())
	panel._close_modal()
	await _wait(0.2)
	panel.engine = busy_link
	await panel._poll_busy()
	await _wait(0.2)
	var dimmed_button: Variant = _tracking_button(panel)
	_check(bool(panel.data.get("turnRunning", false)) and _has_text(panel, str(panel.data.get("turnRunningNote", "?"))), "the tracking button dims as soon as a turn runs")
	_check(dimmed_button != null and not bool(dimmed_button.get("enabled")), "the open drawer's Historical tracking button turns off live")
	panel.scroll.scroll_vertical = 4000
	await _wait(0.2)
	await _shoot("11b-country-tracking-dimmed")
	panel.engine = live_link
	busy_link.free()
	await panel._poll_busy()
	await _wait(0.2)
	var lit_button: Variant = _tracking_button(panel)
	_check(not bool(panel.data.get("turnRunning", true)), "and lights again when the turn ends")
	_check(lit_button != null and bool(lit_button.get("enabled")), "the Historical tracking button turns back on live")
	panel.scroll.scroll_vertical = 0

	await panel.set_tab("ranking")
	await _wait(1.2)
	_check(_has_text(panel, "RANKED BY") and _has_text(panel, "Land held"), "ranking chips")
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
	panel._poll_busy()
	await panel.set_tab("economy")
	await panel.set_tab("politics")
	await panel.on_region_selected("Germany")
	await _wait(1.2)
	var asked: Array = spy.get("calls")
	_check(asked.is_empty(), "the closed drawer asks the engine nothing (%s)" % ", ".join(PackedStringArray(asked)))
	panel.engine = real
	spy.free()


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
	_check(abs(tip - (screen.y - 10.0)) <= 1.5, "region card pointer tip sits 10 px above the click, as released (tip %.1f, click %.1f)" % [tip, screen.y])
	_check(abs(card.position.x + card.size.x * 0.5 - screen.x) <= 1.5, "region card centred on the click")
	await _shoot("14-region-card")
	var marker := _click_marker(screen)
	await _shoot("14b-region-card-click-marker")
	marker.queue_free()
	cards._region_info_open = true
	cards._build_region(false)
	await _wait(0.4)
	_check(_has_text(cards, "Cities") or _has_text(cards, "No cities or neighbouring regions are known for this region."), "region info section")
	_check(_has_text(cards, "Listen in"), "region card: Listen in button")
	await _shoot("15-region-card-info")
	var region: Dictionary = cards._region
	cards.open_listen_in({"regionId": str(region.get("regionId", "")), "regionName": str(region.get("regionName", "")), "polity": "France", "polityKey": "France"})
	var phone = cards._phone
	await _until(func() -> bool: return is_instance_valid(phone) and _has_text(phone, "Camille Bernard"), 40.0)
	await _wait(0.5)
	var phone_tabs: Array = phone._tabs.get_children() if is_instance_valid(phone) else []
	_check(is_instance_valid(phone) and phone.view.get("nationwide", false) and phone_tabs.size() == 2 and str(phone_tabs[0].text) == "France" and str(phone_tabs[1].text) == str(region.get("regionName", "")), "listen in: opens on the country's feed, its tab first")
	_check(is_instance_valid(phone) and _has_text(phone, "Camille Bernard") and _has_text(phone, "TRENDING") and _has_text(phone, "Written by your AI model. Each new feed is one AI request."), "listen in: the whole country")
	await _shoot("16-listen-in-country")
	phone.nationwide = false
	await phone.refresh_view()
	await _until(func() -> bool: return is_instance_valid(phone) and not bool(phone.view.get("waiting", true)), 40.0)
	await _wait(0.5)
	_check(is_instance_valid(phone) and not phone.view.get("nationwide", true) and _has_text(phone, "Camille Bernard"), "listen in: the region's feed")
	await _shoot("17-listen-in-region")
	phone.close()
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


func _war_and_peace() -> void:
	var cards_wp = main.hud.war_cards
	await cards_wp.refresh()
	await _wait(0.5)
	_check(cards_wp.visible and _has_text(cards_wp, "Honour the alliance") and _has_text(cards_wp, "PEACE OFFERED"), "war and peace cards")
	await _shoot("25-war-peace")
	cards_wp.folded = true
	cards_wp._render()
	await _wait(0.3)
	_check(_has_text(cards_wp, "Waiting for your answer: 2"), "folded")
	await _shoot("26-war-peace-folded")
	cards_wp.folded = false
	cards_wp._render()
	await cards_wp._answer("decline", "offer-libya")
	await _wait(0.5)
	_check(not _has_text(cards_wp, "PEACE OFFERED") and _has_text(cards_wp, "CALL TO ARMS"), "declined offer leaves")
	await _shoot("27-war-peace-after-decline")


func _finish(code: int) -> void:
	if finished:
		return
	finished = true
	main.engine.stop()
	await _frames(2)
	quit(code)
