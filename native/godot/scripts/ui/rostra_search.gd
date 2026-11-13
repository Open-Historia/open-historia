class_name RostraSearch
extends VBoxContainer

const LIKED := Color("#f43f5e")

var engine: EngineLink
var render_post: Callable
var view := {}
var hits: Array = []
var query := ""
var picked: Variant = null
var nationwide := false
var session: Variant = null
var asked := {}
var loading := {}
var failed := {}
var wanted := {}
var liked := {}
var _shown := false
var _can_post := false
var _found := false
var _finding := 0
var _viewing := 0
var _input: LineEdit
var _clear: Button
var _body: VBoxContainer
var _shimmer: Array = []
var _clock := 0.0


func _init() -> void:
	add_theme_constant_override("separation", 0)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mouse_filter = Control.MOUSE_FILTER_PASS
	var box := HBoxContainer.new()
	box.add_theme_constant_override("separation", 7)
	box.mouse_filter = Control.MOUSE_FILTER_PASS
	box.add_child(RostraPanel.glyph_rect("find", 16, RostraPanel.INK_SOFT))
	_input = LineEdit.new()
	_input.set_meta("oh_tap_exempt", true)
	_input.placeholder_text = "Search countries and regions"
	_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_input.add_theme_font_override("font", RostraPanel.face(400))
	_input.add_theme_font_size_override("font_size", 13)
	_input.add_theme_color_override("font_color", RostraPanel.INK)
	_input.add_theme_color_override("font_placeholder_color", RostraPanel.INK_FAINT)
	_input.add_theme_color_override("caret_color", RostraPanel.INK)
	for state in ["normal", "focus", "read_only"]:
		_input.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	_input.text_changed.connect(_on_query)
	_input.gui_input.connect(_on_input_key)
	box.add_child(_input)
	_clear = RostraPanel.plain_button(StyleBoxEmpty.new())
	_clear.tooltip_text = "Clear the search"
	RostraPanel.fill_button(_clear, RostraPanel.glyph_rect("clear", 14, RostraPanel.INK_SOFT))
	_clear.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_clear.visible = false
	_clear.pressed.connect(func() -> void:
		_input.text = ""
		_on_query("")
		_input.grab_focus())
	box.add_child(_clear)
	var pill := RostraPanel.boxed(RostraPanel.WASH, RostraPanel.EDGE, 999, Vector4(12, 5, 12, 5))
	pill.mouse_filter = Control.MOUSE_FILTER_PASS
	pill.add_child(box)
	add_child(RostraPanel.pad(pill, 14, 10, 14, 10))
	add_child(RostraPanel.rule())
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 0)
	_body.mouse_filter = Control.MOUSE_FILTER_PASS
	add_child(_body)


func setup(link: EngineLink, renderer: Callable, opened: Variant, shown: bool) -> void:
	engine = link
	render_post = renderer
	_shown = shown
	if typeof(opened) == TYPE_DICTIONARY:
		picked = (opened as Dictionary).duplicate()
	refresh_view()


func set_shown(shown: bool) -> void:
	if shown == _shown:
		return
	_shown = shown
	if shown:
		session = null
		refresh_view()


func set_can_post(can_post: bool) -> void:
	if can_post == _can_post:
		return
	_can_post = can_post
	if query.strip_edges().is_empty():
		_render()


func open_place(place: Dictionary) -> void:
	picked = place.duplicate()
	nationwide = false
	query = ""
	_input.text = ""
	_clear.visible = false
	refresh_view()


func _process(delta: float) -> void:
	if _shimmer.is_empty():
		return
	_clock += delta
	var glow := 0.75 + 0.25 * cos(_clock / 1.4 * TAU)
	for node in _shimmer:
		if is_instance_valid(node):
			(node as CanvasItem).modulate.a = glow


func _on_input_key(event: InputEvent) -> void:
	if not (event is InputEventKey):
		return
	var key := event as InputEventKey
	if not key.pressed or key.echo:
		return
	if (key.keycode == KEY_ENTER or key.keycode == KEY_KP_ENTER) and not hits.is_empty():
		_input.accept_event()
		pick(hits[0])
	elif key.keycode == KEY_ESCAPE and not query.is_empty():
		_input.accept_event()
		_input.text = ""
		_on_query("")


func _on_query(value: String) -> void:
	query = value
	_clear.visible = not value.is_empty()
	if value.strip_edges().is_empty():
		hits = []
		_render()
		return
	_finding += 1
	var mine := _finding
	_render()
	var reply: Dictionary = await engine.request("social.find", {"query": value})
	if mine != _finding or not is_inside_tree():
		return
	_found = true
	hits = (reply.get("result", {}) as Dictionary).get("hits", []) if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY else []
	_render()


func pick(hit: Dictionary) -> void:
	picked = (hit.get("place", {}) as Dictionary).duplicate()
	nationwide = false
	query = ""
	_input.text = ""
	_clear.visible = false
	hits = []
	wanted[str(hit.get("key", ""))] = true
	refresh_view()


func ask() -> void:
	if typeof(session) != TYPE_DICTIONARY or view.is_empty():
		return
	wanted[str(view.get("placeKey", ""))] = true
	await _load()


func refresh_view() -> void:
	if engine == null:
		return
	_viewing += 1
	var mine := _viewing
	var reply: Dictionary = await engine.request("social.place", {"place": picked, "nationwide": nationwide, "session": session, "asked": asked, "loading": loading, "failed": failed, "wanted": wanted})
	if mine != _viewing or not is_inside_tree():
		return
	if not reply.get("ok", false) or typeof(reply.get("result")) != TYPE_DICTIONARY:
		return
	view = reply["result"]
	session = view.get("session")
	_can_post = bool(view.get("canPost", _can_post))
	if query.strip_edges().is_empty():
		_render()
	if _shown and bool(view.get("shouldAsk", false)):
		await _load()


func _load() -> void:
	var key := str(view.get("requestKey", ""))
	if key.is_empty() or loading.has(key):
		return
	asked[key] = true
	failed.erase(key)
	loading[key] = true
	var target: Dictionary = view.get("place", {})
	var language := str((session as Dictionary).get("language", "")) if typeof(session) == TYPE_DICTIONARY else ""
	await refresh_view()
	var reply: Dictionary = await engine.request("social.place.load", {"place": target, "language": language, "key": key})
	loading.erase(key)
	if not is_inside_tree():
		return
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY else {"ok": false, "error": str(reply.get("error", ""))}
	if not bool(result.get("ok", false)):
		failed[key] = str(result.get("error", ""))
	elif typeof(session) == TYPE_DICTIONARY and str(result.get("campaignId", "")) == str((session as Dictionary).get("gameId", "")):
		var landed := str(result.get("gameDate", ""))
		if not landed.is_empty() and landed != str((session as Dictionary).get("gameDate", "")):
			(session as Dictionary)["gameDate"] = landed
	await refresh_view()


func _render() -> void:
	for child in _body.get_children():
		_body.remove_child(child)
		child.queue_free()
	_shimmer.clear()
	if not query.strip_edges().is_empty():
		_render_hits()
	elif not view.is_empty():
		_render_place()


func _render_hits() -> void:
	if not _found and hits.is_empty():
		_body.add_child(RostraPanel.pad(RostraPanel.text("Reading the map…", 12, RostraPanel.INK_SOFT), 16, 13, 16, 13))
		return
	if hits.is_empty() and _finding > 0:
		_body.add_child(RostraPanel.pad(RostraPanel.para("No country or region by that name.", 12, RostraPanel.INK_SOFT), 16, 14, 16, 14))
		return
	for item in hits:
		var hit: Dictionary = item
		var button := RostraPanel.plain_button(StyleBoxEmpty.new(), UI.box(RostraPanel.WASH, Color(0, 0, 0, 0), 0, 0))
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var line := RostraPanel.row(10)
		line.add_child(RostraPanel.glyph_rect("pin" if str(hit.get("scope", "")) == "region" else "flag", 15, RostraPanel.INK_SOFT))
		var words := RostraPanel.column(1)
		words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		words.add_child(RostraPanel.clipped(str(hit.get("title", "")), 13, RostraPanel.INK, 700, true))
		var region := str(hit.get("scope", "")) == "region"
		var polity := str(hit.get("polity", ""))
		var sub := RostraPanel.clipped("Country" if not region else (polity if not polity.is_empty() else "Held by no country"), 11, RostraPanel.INK_FAINT, 400, region and not polity.is_empty())
		words.add_child(sub)
		line.add_child(words)
		var stack := RostraPanel.column(0)
		stack.add_child(RostraPanel.pad(line, 16, 10, 16, 10))
		stack.add_child(RostraPanel.rule())
		RostraPanel.fill_button(button, stack)
		button.pressed.connect(pick.bind(hit))
		_body.add_child(button)


func _section(title: String, left := 16.0, top := 10.0, bottom := 6.0) -> Control:
	var label := UI.label(title, 10, RostraPanel.INK_SOFT, 800, "Arial", 1)
	if not RostraPanel.phone_look():
		label.add_theme_font_override("font", RostraPanel.face(800, false, 1.0))
	label.uppercase = true
	return RostraPanel.pad(label, left, top, 16, bottom)


func _render_place() -> void:
	var head := RostraPanel.row(10)
	var titles := RostraPanel.column(0)
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	titles.add_child(RostraPanel.clipped(str(view.get("title", "")), 16, RostraPanel.INK, 850, true))
	titles.add_child(RostraPanel.clipped(str(view.get("dateLong", "")), 11, RostraPanel.INK_SOFT))
	head.add_child(titles)
	if picked != null:
		var back := RostraPanel.plain_button(UI.box(RostraPanel.WASH, Color(0, 0, 0, 0), 999, 0, Vector4(11, 5, 11, 5)))
		back.text = "Your country"
		back.add_theme_font_override("font", RostraPanel.face(700))
		back.add_theme_font_size_override("font_size", 11)
		for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			back.add_theme_color_override(slot, RostraPanel.INK_SOFT)
		back.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		back.pressed.connect(func() -> void:
			picked = null
			nationwide = false
			refresh_view())
		head.add_child(back)
	var can_ask := bool(view.get("canAsk", false))
	var load_more := RostraPanel.round_button("refresh", 15, RostraPanel.INK, RostraPanel.WASH)
	load_more.tooltip_text = "Load new posts (one AI request)"
	load_more.disabled = not can_ask
	load_more.modulate.a = 1.0 if can_ask else 0.45
	load_more.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if can_ask else Control.CURSOR_ARROW
	load_more.pressed.connect(ask)
	head.add_child(load_more)
	_body.add_child(RostraPanel.pad(head, 16, 10, 16, 7))
	var tabs: Variant = view.get("tabs")
	if typeof(tabs) == TYPE_ARRAY and (tabs as Array).size() == 2:
		var strip := RostraPanel.row(0)
		strip.mouse_filter = Control.MOUSE_FILTER_PASS
		var whole := bool(view.get("nationwide", false))
		for index in range(2):
			var active := (index == 1) == whole
			var tab := Button.new()
			tab.text = str((tabs as Array)[index])
			tab.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
			tab.focus_mode = Control.FOCUS_NONE
			tab.clip_text = true
			tab.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
			tab.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			tab.custom_minimum_size = Vector2(1, 0)
			tab.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			tab.add_theme_font_override("font", RostraPanel.face(750))
			tab.add_theme_font_size_override("font_size", 13)
			for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
				tab.add_theme_color_override(state, RostraPanel.INK if active else RostraPanel.INK_SOFT)
			var style := StyleBoxFlat.new()
			style.bg_color = Color(0, 0, 0, 0)
			style.border_color = RostraPanel.INK if active else Color(0, 0, 0, 0)
			style.border_width_bottom = 2
			style.content_margin_left = 8
			style.content_margin_right = 8
			style.content_margin_top = 9
			style.content_margin_bottom = 7
			for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
				tab.add_theme_stylebox_override(state, style)
			var country_wide := index == 1
			tab.pressed.connect(func() -> void:
				nationwide = country_wide
				refresh_view())
			strip.add_child(tab)
		_body.add_child(strip)
		_body.add_child(RostraPanel.rule())
	var trends: Array = view.get("trends", [])
	if not trends.is_empty():
		var block := RostraPanel.column(0)
		block.add_child(_section("Trending", 0, 0, 6))
		var chips := HFlowContainer.new()
		chips.add_theme_constant_override("h_separation", 6)
		chips.add_theme_constant_override("v_separation", 6)
		chips.mouse_filter = Control.MOUSE_FILTER_IGNORE
		for trend in trends:
			var chip := RostraPanel.boxed(RostraPanel.WASH, Color(0, 0, 0, 0), 999, Vector4(10, 3, 10, 3))
			chip.add_child(RostraPanel.text(str(trend), 12, RostraPanel.INK, 650, true))
			chips.add_child(chip)
		block.add_child(chips)
		_body.add_child(RostraPanel.pad(block, 16, 10, 16, 10))
		_body.add_child(RostraPanel.rule())
	var rostra_posts: Array = view.get("rostraPosts", [])
	if not rostra_posts.is_empty() and render_post.is_valid():
		_body.add_child(_section("On Rostra"))
		for index in range(rostra_posts.size()):
			_body.add_child(render_post.call(rostra_posts[index], index == 0))
	_body.add_child(_section("What people are saying"))
	var waiting := bool(view.get("waiting", false))
	var failure: Variant = view.get("failure")
	var batches: Array = view.get("batches", [])
	if waiting and typeof(session) == TYPE_DICTIONARY and bool(view.get("wanted", false)):
		_body.add_child(RostraPanel.pad(RostraPanel.text("Tuning in…", 12, RostraPanel.INK_SOFT), 16, 3, 16, 3))
		for width in [0.7, 0.48, 0.82]:
			_body.add_child(_skeleton(width))
	if typeof(failure) == TYPE_STRING and not waiting:
		var stack := RostraPanel.column(5)
		var headline := RostraPanel.text("The posts could not be loaded.", 14, RostraPanel.INK, 700)
		headline.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		stack.add_child(headline)
		if not str(failure).is_empty():
			var detail := RostraPanel.para(str(failure), 12, RostraPanel.INK_SOFT, 400, 1.4, true)
			detail.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			stack.add_child(detail)
		var again := RostraPanel.plain_button(UI.box(RostraPanel.INK, Color(0, 0, 0, 0), 999, 0, Vector4(17, 7, 17, 7)))
		again.text = "Try again"
		again.add_theme_font_override("font", RostraPanel.face(800))
		again.add_theme_font_size_override("font_size", 12)
		for slot in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			again.add_theme_color_override(slot, RostraPanel.SCREEN)
		again.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		again.pressed.connect(ask)
		stack.add_child(RostraPanel.pad(again, 0, 6, 0, 0))
		_body.add_child(RostraPanel.pad(stack, 16, 16, 16, 16))
		_body.add_child(RostraPanel.rule())
	if not waiting and typeof(failure) != TYPE_STRING and batches.is_empty() and typeof(session) == TYPE_DICTIONARY:
		var stack := RostraPanel.column(0)
		var headline := RostraPanel.text("Nothing has been posted here yet.", 14, RostraPanel.INK, 750)
		headline.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		stack.add_child(headline)
		var words := RostraPanel.para(I18n.ui("Refresh to see what ordinary people in {{title}} are posting.", {"title": str(view.get("title", ""))}), 12, RostraPanel.INK_SOFT, 400, 1.45, true)
		words.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		stack.add_child(RostraPanel.pad(words, 0, 5, 0, 0))
		stack.add_child(RostraPanel.refresh_button(false, false, ask))
		_body.add_child(RostraPanel.pad(stack, 16, 18, 16, 22))
	for item in batches:
		var batch: Dictionary = item
		if not str(batch.get("line", "")).is_empty():
			var band := RostraPanel.boxed(RostraPanel.WASH_FAINT, Color(0, 0, 0, 0), 0, Vector4(16, 6, 16, 6))
			var words := RostraPanel.text(str(batch["line"]), 11, RostraPanel.INK_SOFT, 700)
			words.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			band.add_child(words)
			_body.add_child(band)
			_body.add_child(RostraPanel.rule())
		var shown: Array = batch.get("posts", [])
		for index in range(shown.size()):
			_body.add_child(_person_post(shown[index], index == 0))
	if not batches.is_empty():
		var note := RostraPanel.para("Written by your AI model. Each new feed is one AI request.", 11, RostraPanel.INK_FAINT)
		note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_body.add_child(RostraPanel.pad(note, 19, 14, 19, 18))


func _skeleton(width: float) -> Control:
	var line := RostraPanel.row(10)
	var face := RostraPanel.boxed(RostraPanel.EDGE, Color(0, 0, 0, 0), 999, Vector4.ZERO)
	face.custom_minimum_size = Vector2(38, 38)
	face.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	_shimmer.append(face)
	line.add_child(face)
	var bars := RostraPanel.column(8)
	bars.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var gap := Control.new()
	gap.custom_minimum_size.y = 3
	bars.add_child(gap)
	for fraction in [0.45, 0.92, width]:
		var holder := Control.new()
		holder.custom_minimum_size.y = 10
		holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var bar := RostraPanel.boxed(RostraPanel.EDGE, Color(0, 0, 0, 0), 999, Vector4.ZERO)
		bar.anchor_right = float(fraction)
		bar.anchor_bottom = 1.0
		holder.add_child(bar)
		_shimmer.append(bar)
		bars.add_child(holder)
	line.add_child(bars)
	var stack := RostraPanel.column(0)
	stack.add_child(RostraPanel.pad(line, 16, 13, 16, 13))
	stack.add_child(RostraPanel.rule())
	return stack


func _person_post(item: Variant, lead := false) -> Control:
	var post: Dictionary = item
	var id := str(post.get("id", ""))
	var line := RostraPanel.row(10)
	var face := RostraPanel.boxed(Color.html(str(post.get("colour", "#5f6875ff"))), Color(0, 0, 0, 0), 999, Vector4.ZERO)
	face.custom_minimum_size = Vector2(38, 38)
	face.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	var letters := RostraPanel.text(str(post.get("initials", "?")), 13, UI.WHITE, 700, true)
	letters.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	letters.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	face.add_child(letters)
	line.add_child(face)
	var words := RostraPanel.column(0)
	words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var who := RostraPanel.FitRow.new(5)
	who.add_child(RostraPanel.shrinking(RostraPanel.clipped(str(post.get("author", "")), 13, RostraPanel.INK, 800, true)))
	if not str(post.get("handle", "")).is_empty():
		who.add_child(RostraPanel.shrinking(RostraPanel.clipped(str(post["handle"]), 12, RostraPanel.INK_SOFT, 400, true), 10.0, 32.0))
	who.add_child(RostraPanel.text(str(post.get("age", "")), 12, RostraPanel.INK_SOFT, 400, true))
	who.add_child(RostraPanel.filling(RostraPanel.spacer()))
	words.add_child(who)
	if not str(post.get("about", "")).is_empty():
		words.add_child(RostraPanel.clipped(str(post["about"]), 11, RostraPanel.INK_FAINT, 400, true))
	words.add_child(RostraPanel.pad(RostraPanel.para(str(post.get("text", "")), 14, RostraPanel.INK, 400, 1.45, true), 0, 4, 0, 0))
	var actions := RostraPanel.row(18)
	actions.mouse_filter = Control.MOUSE_FILTER_PASS
	actions.add_child(_action("reply", str(post.get("replies", "")), RostraPanel.INK_FAINT))
	actions.add_child(_action("reshare", str(post.get("reposts", "")), RostraPanel.INK_FAINT))
	var is_liked := liked.has(id)
	var heart := RostraPanel.plain_button(StyleBoxEmpty.new())
	heart.tooltip_text = "Like"
	var heart_row := RostraPanel.row(5)
	heart_row.add_child(RostraPanel.glyph_rect("liked" if is_liked else "like", 17, LIKED if is_liked else RostraPanel.INK_FAINT))
	var count := str(post.get("likesWithMine", "")) if is_liked else str(post.get("likes", ""))
	if not count.is_empty():
		heart_row.add_child(RostraPanel.text(count, 12, LIKED if is_liked else RostraPanel.INK_FAINT, 400, true))
	RostraPanel.fill_button(heart, heart_row)
	heart.custom_minimum_size.x = maxf(heart.custom_minimum_size.x, 45.0)
	heart.pressed.connect(func() -> void:
		if liked.has(id):
			liked.erase(id)
		else:
			liked[id] = true
		_render())
	actions.add_child(heart)
	words.add_child(RostraPanel.pad(actions, 0, 8, 0, 0))
	line.add_child(words)
	var stack := RostraPanel.column(0)
	stack.mouse_filter = Control.MOUSE_FILTER_PASS
	stack.add_child(RostraPanel.pad(line, 16, 13, 16, 13 + RostraPanel.post_tail()))
	stack.add_child(RostraPanel.post_rule(lead))
	return stack


func _action(name: String, count: String, color: Color) -> Control:
	var holder := RostraPanel.row(5)
	holder.custom_minimum_size.x = 45
	holder.add_child(RostraPanel.glyph_rect(name, 17, color))
	if not count.is_empty():
		holder.add_child(RostraPanel.text(count, 12, color, 400, true))
	return holder
