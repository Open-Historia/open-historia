class_name CommunityPage
extends VBoxContainer

signal play_scenario(scenario_id: String)
signal library_changed

const CARD_WIDTH := 336.0
const GRID_MIN := 264.0
const GRID_GAP := 13.0
const HELP_BASIS := 320.0
const INK_HELP := Color(1, 1, 1, 0.55)
const INK_STAT := Color(1, 1, 1, 0.65)
const LIBRARY_BADGES := {
	"current": ["In your library", "A copy of this scenario is in your Scenarios tab."],
	"update": ["Update available", "Your copy is older than this post, or its basemap could not be downloaded. Update it from the Scenarios tab."],
	"unchecked": ["Update available", "Your copy was downloaded before the hub started checking its files. Update it from the Scenarios tab."],
	"edited": ["Edited copy in your library", "You changed your copy of this scenario, so it keeps your changes."],
}
const SORTS := [["installs", "Most Installed"], ["likes", "Most Liked"], ["recent", "Newest"]]

var engine: EngineLink
var context := {}
var _posts := {}
var _loaded := false
var _error := ""
var _notice := ""
var _busy_id := 0
var _armed_id := 0
var _selected: Dictionary = {}
var _publish_open := false
var _publish_url := ""
var _query := ""
var _date_from := ""
var _date_to := ""
var _sort := "installs"
var _library := {}
var _scenarios: Array = []
var _links := {}
var _browse := {}
var _browse_seq := 0
var _missing_map := {}
var _grids: Array[GridContainer] = []
var _featured_scroll := 0
var _offers_slot: VBoxContainer
var _list_view: VBoxContainer
var _list_body: VBoxContainer
var _detail_view: VBoxContainer
var _header: HFlowContainer
var _controls: HFlowContainer
var _search: LineEdit
var _from: LineEdit
var _to: LineEdit
var _clear: Button


func _init() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 0)
	_offers_slot = CommunityKit.column(0)
	add_child(_offers_slot)
	_list_view = CommunityKit.column(0)
	add_child(_list_view)
	_detail_view = CommunityKit.column(0)
	_detail_view.visible = false
	add_child(_detail_view)
	_build_header()
	_list_body = CommunityKit.column(0)
	_list_view.add_child(_list_body)
	resized.connect(_fit)


func setup(link: EngineLink, extra := {}) -> void:
	engine = link
	context = extra


func open() -> void:
	if not _loaded:
		load_posts(false)
	_render()


func refresh() -> void:
	load_posts(true)


func load_posts(force: bool) -> void:
	_error = ""
	_render()
	var reply := await engine.request("community.posts", {"force": force})
	if not is_instance_valid(self):
		return
	if not reply.get("ok", false):
		_error = str(reply.get("error", ""))
		_render()
		return
	var result: Dictionary = reply["result"]
	var next := {}
	for post in result.get("posts", []):
		next[int((post as Dictionary).get("id", 0))] = post
	_posts = next
	_library = result.get("library", {})
	_scenarios = result.get("scenarios", [])
	_links = result.get("links", {})
	_loaded = true
	await _rebrowse()


func _rebrowse() -> void:
	if not _loaded:
		_render()
		return
	_browse_seq += 1
	var seq := _browse_seq
	var reply := await engine.request("community.browse", {"query": _query, "from": _date_from, "to": _date_to, "sort": _sort})
	if not is_instance_valid(self) or seq != _browse_seq:
		return
	if reply.get("ok", false):
		_browse = reply["result"]
	_restyle_dates()
	_render()


func _status_of(post: Dictionary) -> String:
	var entry: Dictionary = _library.get(str(int(post.get("id", 0))), {})
	return str(entry.get("status", ""))


func _copy_of(post: Dictionary) -> Dictionary:
	var entry: Dictionary = _library.get(str(int(post.get("id", 0))), {})
	var copy: Variant = entry.get("copy")
	return copy if typeof(copy) == TYPE_DICTIONARY else {}


func _clear_banners() -> void:
	_notice = ""
	_error = ""
	_armed_id = 0
	_publish_url = ""


func _build_header() -> void:
	_header = CommunityKit.flow(16, 8)
	var help := RichTextLabel.new()
	help.bbcode_enabled = true
	help.fit_content = true
	help.scroll_active = false
	help.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	help.mouse_filter = Control.MOUSE_FILTER_IGNORE
	help.add_theme_font_override("normal_font", UI.font(400))
	help.add_theme_font_size_override("normal_font_size", 12)
	help.add_theme_color_override("default_color", INK_HELP)
	help.add_theme_constant_override("line_separation", 4)
	help.text = "Community scenarios from the hub — ⬇ = imports, 👍 = likes. Open any post to 👍 like or 💬 comment on GitHub. [color=#e4e4e7]The OFFICIAL badge marks a post made by a team member of the game.[/color]"
	help.custom_minimum_size.x = HELP_BASIS
	help.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	help.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_header.add_child(help)
	_controls = CommunityKit.flow(8, 8)
	_controls.alignment = FlowContainer.ALIGNMENT_END
	_controls.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_controls.size_flags_stretch_ratio = 0.001
	_search = CommunityKit.input("Search scenarios…", 192)
	_search.tooltip_text = "Search community scenarios"
	_search.text_changed.connect(func(value: String) -> void:
		_query = value
		_rebrowse())
	_controls.add_child(_search)
	var start := CommunityKit.text("Start date", 12, Color(1, 1, 1, 0.6), 600)
	start.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_controls.add_child(start)
	_from = CommunityKit.input("From", 104)
	_from.tooltip_text = "From"
	_from.text_changed.connect(func(value: String) -> void:
		_date_from = value
		_clear.visible = not _date_from.is_empty() or not _date_to.is_empty()
		_rebrowse())
	_controls.add_child(_from)
	_to = CommunityKit.input("To", 104)
	_to.tooltip_text = "To"
	_to.text_changed.connect(func(value: String) -> void:
		_date_to = value
		_clear.visible = not _date_from.is_empty() or not _date_to.is_empty()
		_rebrowse())
	_controls.add_child(_to)
	_clear = CommunityKit.pill_button("Clear")
	_clear.visible = false
	_clear.pressed.connect(func() -> void:
		_date_from = ""
		_date_to = ""
		_from.text = ""
		_to.text = ""
		_clear.visible = false
		_rebrowse())
	_controls.add_child(_clear)
	var reload := CommunityKit.pill_button("Refresh")
	reload.pressed.connect(func() -> void: load_posts(true))
	_controls.add_child(reload)
	var publish := CommunityKit.pill_button("⬆ Publish to Hub", {"bg": Color(1, 1, 1, 0.15), "border": Color(1, 1, 1, 0.25)})
	publish.pressed.connect(func() -> void:
		_publish_open = not _publish_open
		_render())
	_controls.add_child(publish)
	var hub := CommunityKit.pill_button("Open Hub ↗")
	hub.pressed.connect(func() -> void: CommunityKit.open_url(str(_links.get("hub", ""))))
	_controls.add_child(hub)
	var discord := CommunityKit.pill_button("", {"bg": CommunityKit.DISCORD_BLURPLE, "border": CommunityKit.DISCORD_EDGE, "ink": Color(1, 1, 1), "weight": 700})
	var discord_row := CommunityKit.row(7)
	discord_row.alignment = BoxContainer.ALIGNMENT_CENTER
	discord_row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	discord_row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	discord_row.add_child(CommunityKit.mark_rect("discord", 17))
	var discord_words := CommunityKit.text("Join the Discord", 13, Color(1, 1, 1), 700)
	discord_words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	discord_row.add_child(discord_words)
	discord.add_child(discord_row)
	discord.custom_minimum_size.x = UI.font(700).get_string_size("Join the Discord", HORIZONTAL_ALIGNMENT_LEFT, -1, 13).x + 17 + 7 + 28
	discord.pressed.connect(func() -> void: CommunityKit.open_url(str(_links.get("discord", ""))))
	_controls.add_child(discord)
	_header.add_child(_controls)
	_list_view.add_child(CommunityKit.margin_below(_header, 14))
	var licence := CommunityKit.text("Scenarios on the Hub are released under CC BY 4.0.", 12, INK_HELP)
	_list_view.add_child(CommunityKit.margin_below(licence, 11))


func _controls_width() -> float:
	var total := 0.0
	var count := 0
	for child in _controls.get_children():
		var control := child as Control
		if not control or not control.visible:
			continue
		total += control.get_combined_minimum_size().x
		count += 1
	return total + 8.0 * maxf(0.0, float(count - 1))


func _fit() -> void:
	var width := size.x
	if width <= 0.0:
		return
	_controls.custom_minimum_size.x = minf(_controls_width(), width)
	var columns: int = max(1, int((width + GRID_GAP) / (GRID_MIN + GRID_GAP)))
	for grid in _grids:
		if is_instance_valid(grid):
			grid.columns = columns


func _restyle_dates() -> void:
	var bad_from := not _date_from.is_empty() and str(_browse.get("fromBound", "")).is_empty()
	var bad_to := not _date_to.is_empty() and str(_browse.get("toBound", "")).is_empty()
	CommunityKit.set_field_border(_from, Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.6) if bad_from else CommunityKit.PILL_BORDER)
	CommunityKit.set_field_border(_to, Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.6) if bad_to else CommunityKit.PILL_BORDER)


func _render() -> void:
	_render_offers()
	var detail := not _selected.is_empty()
	_list_view.visible = not detail
	_detail_view.visible = detail
	if detail:
		_render_detail()
	else:
		_render_list()
	_fit.call_deferred()


func _clear_children(holder: Node) -> void:
	for child in holder.get_children():
		holder.remove_child(child)
		child.queue_free()


func _render_offers() -> void:
	if _missing_map.is_empty():
		_clear_children(_offers_slot)
		return
	if _offers_slot.get_child_count() > 0:
		return
	var offer := DetailedMapsOffer.new()
	if _missing_map.has("basemaps"):
		offer.setup_list(engine, _missing_map["basemaps"])
	else:
		offer.setup_single(engine, _missing_map["basemap"])
	offer.done.connect(_finish_install)
	_offers_slot.add_child(offer)


func _finish_install() -> void:
	var post_id := int(_missing_map.get("postId", 0))
	var play_next := str(_missing_map.get("playNext", ""))
	_missing_map = {}
	_render()
	if not play_next.is_empty() and int(_selected.get("id", 0)) == post_id:
		play_scenario.emit(play_next)


func _render_list() -> void:
	var featured := _list_body.find_child("Featured", true, false) as ScrollContainer
	if featured:
		_featured_scroll = featured.scroll_horizontal
	_clear_children(_list_body)
	_grids.clear()
	if _publish_open:
		_list_body.add_child(CommunityKit.margin_below(_publish_picker(), 14))
	_add_banners(_list_body)
	if not _publish_url.is_empty():
		var link := CommunityKit.pill_button("Open the GitHub post ↗")
		var url := _publish_url
		link.pressed.connect(func() -> void: CommunityKit.open_url(url))
		link.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		_list_body.add_child(CommunityKit.margin_below(link, 14))
	if not _loaded or _browse.is_empty():
		if _error.is_empty():
			_list_body.add_child(_skeleton_grid(8))
		return
	if not _query.strip_edges().is_empty():
		var results: Array = _browse.get("search", [])
		_list_body.add_child(_scenario_row("🔍 Results (%d)" % results.size(), results, "No scenarios match your search.", "grid"))
		return
	var pinned: Array = _browse.get("pinned", [])
	if not pinned.is_empty():
		_list_body.add_child(_scenario_row("📌 Featured", pinned, "", "scroll"))
	_list_body.add_child(_browse_header())
	_list_body.add_child(_scenario_row("", _browse.get("browse", []), "No community scenarios in this view.", "grid"))


func _add_banners(holder: VBoxContainer) -> void:
	if not _notice.is_empty():
		holder.add_child(CommunityKit.margin_below(CommunityKit.banner(_notice, false), 14))
	if not _error.is_empty():
		holder.add_child(CommunityKit.margin_below(CommunityKit.banner(_error, true), 14))


func _publish_picker() -> Control:
	var box := CommunityKit.panel(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 14, Vector4(13, 13, 13, 13))
	var stack := CommunityKit.column(0)
	box.add_child(stack)
	var intro := CommunityKit.para("Pick a scenario to publish. Its bundle downloads to your computer, and a prefilled hub post opens — drag the downloaded file into the Description box there and submit.", 13, Color(1, 1, 1, 0.7), 400, 1.25)
	stack.add_child(CommunityKit.margin_below(intro, 9))
	var licence := CommunityKit.panel(Color(1, 1, 1, 0.06), Color(1, 1, 1, 0.16), 10, Vector4(11, 9, 11, 9))
	var lines := CommunityKit.column(0)
	lines.add_child(CommunityKit.para("Everything you publish to the Hub is released under CC BY 4.0.", 13, Color(1, 1, 1, 0.88), 700, 1.5))
	lines.add_child(CommunityKit.para("Only publish what you made yourself, or what you may share under this licence.", 13, Color(1, 1, 1, 0.88), 400, 1.5))
	var about := LinkButton.new()
	about.text = "About CC BY 4.0 ↗"
	about.underline = LinkButton.UNDERLINE_MODE_ALWAYS
	about.focus_mode = Control.FOCUS_NONE
	about.add_theme_font_override("font", UI.font(400))
	about.add_theme_font_size_override("font_size", 13)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		about.add_theme_color_override(name, Color(1, 1, 1, 0.88))
	about.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	about.pressed.connect(func() -> void: CommunityKit.open_url(str(_links.get("license", ""))))
	lines.add_child(about)
	licence.add_child(lines)
	stack.add_child(CommunityKit.margin_below(licence, 10))
	var choices := CommunityKit.flow(7, 7)
	for entry in _scenarios:
		var scenario: Dictionary = entry
		var choice := CommunityKit.pill_button(str(scenario.get("name", "")))
		choice.pressed.connect(func() -> void: _publish(scenario))
		choices.add_child(choice)
	stack.add_child(choices)
	return box


func _skeleton_grid(count: int) -> Control:
	var grid := GridContainer.new()
	grid.add_theme_constant_override("h_separation", int(GRID_GAP))
	grid.add_theme_constant_override("v_separation", int(GRID_GAP))
	grid.columns = 4
	for index in range(count):
		grid.add_child(_skeleton_card())
	_grids.append(grid)
	return CommunityKit.margin_below(grid, 6)


func _skeleton_card() -> Control:
	var card := SkeletonCard.new()
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return card


func _browse_header() -> Control:
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_top", 22)
	holder.add_theme_constant_override("margin_bottom", 13)
	var line := CommunityKit.row(11)
	var words := CommunityKit.column(4)
	words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	words.size_flags_vertical = Control.SIZE_SHRINK_END
	words.add_child(CommunityKit.text("Browse Community", 17, Color(1, 1, 1, 0.96), 800))
	words.add_child(CommunityKit.text("One catalog, sorted the way you want.", 12, INK_HELP))
	line.add_child(words)
	var pills := CommunityKit.row(6)
	pills.size_flags_vertical = Control.SIZE_SHRINK_END
	for entry in SORTS:
		var value: String = entry[0]
		var active := value == _sort
		var pill := CommunityKit.pill_button(entry[1], {
			"bg": CommunityKit.GREY_SELECTED if active else Color(1, 1, 1, 0.06),
			"border": CommunityKit.GREY_BORDER_STRONG if active else Color(1, 1, 1, 0.1),
			"ink": CommunityKit.GREY_TEXT if active else Color(1, 1, 1, 0.78),
		})
		pill.pressed.connect(func() -> void:
			_sort = value
			_rebrowse())
		pills.add_child(pill)
	line.add_child(pills)
	holder.add_child(line)
	return holder


func _scenario_row(title: String, ids: Array, empty_text: String, layout: String) -> Control:
	var stack := CommunityKit.column(0)
	if not title.is_empty():
		stack.add_child(CommunityKit.margin_below(CommunityKit.text(title, 15, Color(1, 1, 1, 0.9), 800), 9))
	var posts: Array = []
	for id in ids:
		if _posts.has(int(id)):
			posts.append(_posts[int(id)])
	if posts.is_empty():
		var empty := MarginContainer.new()
		empty.add_theme_constant_override("margin_top", 5)
		empty.add_theme_constant_override("margin_bottom", 10)
		empty.add_child(CommunityKit.text(empty_text if not empty_text.is_empty() else "Nothing here yet.", 13, Color(1, 1, 1, 0.4)))
		stack.add_child(empty)
	elif layout == "grid":
		var grid := GridContainer.new()
		grid.add_theme_constant_override("h_separation", int(GRID_GAP))
		grid.add_theme_constant_override("v_separation", int(GRID_GAP))
		grid.columns = 4
		for post in posts:
			grid.add_child(_card(post, true))
		_grids.append(grid)
		stack.add_child(CommunityKit.margin_below(grid, 6))
	else:
		var scroller := ScrollContainer.new()
		scroller.name = "Featured"
		scroller.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		scroller.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
		_thin_scrollbar(scroller.get_h_scroll_bar())
		var line := CommunityKit.row(GRID_GAP)
		for post in posts:
			line.add_child(_card(post, false))
		scroller.add_child(CommunityKit.margin_below(line, 6))
		stack.add_child(scroller)
		var restore := _featured_scroll
		scroller.ready.connect(func() -> void:
			await get_tree().process_frame
			if is_instance_valid(scroller):
				scroller.scroll_horizontal = restore)
	var holder := CommunityKit.margin_below(stack, 18)
	if layout == "scroll":
		holder.name = "FeaturedRow"
	return holder


func _thin_scrollbar(bar: ScrollBar) -> void:
	var grabber := UI.box(Color(1, 1, 1, 0.16), Color(0, 0, 0, 0), 999, 0)
	var hover := UI.box(Color(1, 1, 1, 0.28), Color(0, 0, 0, 0), 999, 0)
	bar.add_theme_stylebox_override("grabber", grabber)
	bar.add_theme_stylebox_override("grabber_highlight", hover)
	bar.add_theme_stylebox_override("grabber_pressed", hover)
	bar.add_theme_stylebox_override("scroll", UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(0, 2, 0, 2)))
	bar.custom_minimum_size.y = 8


func _import_label(busy: bool, status: String, armed: bool) -> String:
	if busy:
		return "Importing…"
	if status.is_empty():
		return "Import"
	return "Import a second copy" if armed else "Import again"


func _library_badge(status: String) -> Control:
	if not LIBRARY_BADGES.has(status):
		return null
	var update := status == "update" or status == "unchecked"
	var badge := CommunityKit.panel(Color(39 / 255.0, 166 / 255.0, 99 / 255.0, 0.16) if update else Color(1, 1, 1, 0.08), Color(39 / 255.0, 166 / 255.0, 99 / 255.0, 0.45) if update else Color(1, 1, 1, 0.18), 999, Vector4(8, 2, 8, 2))
	badge.tooltip_text = LIBRARY_BADGES[status][1]
	badge.mouse_filter = Control.MOUSE_FILTER_PASS
	badge.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	badge.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	badge.add_child(CommunityKit.text(LIBRARY_BADGES[status][0], 11, Color("#bbf7d0") if update else CommunityKit.ZINC, 700))
	return badge


func _stat(value: String, tooltip: String) -> Label:
	var stat := CommunityKit.text(value, 12, INK_STAT)
	stat.tooltip_text = tooltip
	stat.mouse_filter = Control.MOUSE_FILTER_PASS
	stat.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return stat


func _card(post: Dictionary, fill: bool) -> Control:
	var id := int(post.get("id", 0))
	var status := _status_of(post)
	var busy := _busy_id == id
	var armed := _armed_id == id
	var card := CommunityKit.panel(CommunityKit.CARD_BG, CommunityKit.CARD_BORDER, 16, Vector4(14, 14, 14, 14))
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	card.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	if fill:
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	else:
		card.custom_minimum_size.x = CARD_WIDTH
	card.gui_input.connect(func(event: InputEvent) -> void:
		var click := event as InputEventMouseButton
		if click and click.pressed and click.button_index == MOUSE_BUTTON_LEFT:
			_select(post))
	var stack := CommunityKit.column(9)
	card.add_child(stack)
	var cover := CommunityKit.Cover.new(10.0)
	cover.show_url(str(post.get("coverImageUrl", "")))
	stack.add_child(cover)
	var author_row := CommunityKit.row(9)
	if not str(post.get("avatarUrl", "")).is_empty():
		var avatar := CommunityKit.Avatar.new(26)
		avatar.show_url(str(post.get("avatarUrl", "")))
		author_row.add_child(avatar)
	var names := CommunityKit.column(0)
	names.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var official: bool = post.get("official", false)
	var title := CommunityKit.text(("📌 " if post.get("pinned", false) else "") + str(post.get("title", "")), 15, CommunityKit.ZINC if official else Color(1, 1, 1), 800)
	title.clip_text = true
	title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if official:
		title.tooltip_text = "Official: posted by a hub maintainer (verified by GitHub, not by the title)"
		title.mouse_filter = Control.MOUSE_FILTER_PASS
	names.add_child(title)
	var meta := CommunityKit.row(6)
	if official:
		meta.add_child(_official_badge())
	var byline := CommunityKit.text("by %s · %s" % [str(post.get("author", "")), CommunityKit.local_date(str(post.get("createdAt", "")))], 11, Color(1, 1, 1, 0.5))
	byline.clip_text = true
	byline.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	byline.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	meta.add_child(byline)
	names.add_child(meta)
	author_row.add_child(names)
	stack.add_child(author_row)
	var badge_row := CommunityKit.row(0)
	badge_row.custom_minimum_size.y = 22
	var badge := _library_badge(status)
	if badge:
		badge_row.add_child(badge)
	stack.add_child(badge_row)
	var description_text := str(post.get("description", ""))
	var description := CommunityKit.leading(UI.wrapped(description_text if not description_text.is_empty() else "No description.", 13, Color(244 / 255.0, 244 / 255.0, 246 / 255.0, 0.72), 400, 2), 13, 1.45)
	description.custom_minimum_size.y = 38
	description.clip_text = true
	stack.add_child(description)
	stack.add_child(UI.spacer(false))
	var footer := CommunityKit.flow(7, 7)
	footer.custom_minimum_size.y = 30
	var stats := CommunityKit.row(7)
	stats.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	if post.get("installs") != null:
		stats.add_child(_stat("⬇ %d" % int(post["installs"]), "Times this scenario has been imported"))
	stats.add_child(_stat("👍 %d" % int(post.get("upvotes", 0)), "Liked (👍 reactions on the hub post)"))
	stats.add_child(_stat("💬 %d" % int(post.get("comments", 0)), "Comments on the hub post"))
	footer.add_child(stats)
	var actions := CommunityKit.row(6)
	actions.alignment = BoxContainer.ALIGNMENT_END
	actions.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	actions.size_flags_stretch_ratio = 0.001
	var like := CommunityKit.pill_button("👍 Like ↗", {"size": 12, "height": 30.0, "pad": 10.0})
	like.tooltip_text = "Open the GitHub post to 👍 like or 💬 comment"
	var url := str(post.get("url", ""))
	like.pressed.connect(func() -> void: CommunityKit.open_url(url))
	actions.add_child(like)
	var has_bundle: bool = post.get("hasBundle", false)
	var import := CommunityKit.pill_button(_import_label(busy, status, armed), {
		"size": 12, "height": 30.0, "pad": 10.0,
		"bg": Color(1, 1, 1, 0.1) if has_bundle else Color(1, 1, 1, 0.04),
		"border": Color(1, 1, 1, 0.25) if has_bundle else Color(1, 1, 1, 0.08),
		"ink": Color(1, 1, 1) if has_bundle else Color(1, 1, 1, 0.35),
	})
	if not has_bundle:
		import.tooltip_text = "This post has no scenario file attached"
	elif status.is_empty():
		import.tooltip_text = "Import into your Scenarios"
	elif armed:
		import.tooltip_text = "Click again to import another copy"
	else:
		import.tooltip_text = "This scenario is already in your library"
	CommunityKit.set_idle(import, not has_bundle or busy)
	import.pressed.connect(func() -> void: _import(post))
	actions.add_child(import)
	footer.add_child(actions)
	stack.add_child(footer)
	return card


func _official_badge() -> Control:
	var badge := CommunityKit.panel(Color(1, 1, 1, 0.13), Color(1, 1, 1, 0.23), 999, Vector4(6, 1, 6, 1))
	badge.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	badge.add_child(CommunityKit.text("✓ OFFICIAL", 10, CommunityKit.ZINC, 700, 1))
	return badge


func _select(post: Dictionary) -> void:
	_selected = post.duplicate()
	_clear_banners()
	_render()


func _back_to_grid() -> void:
	_selected = {}
	_clear_banners()
	_render()


func _text_link(caption: String, url: String, tooltip: String) -> Button:
	var link := Button.new()
	link.text = caption
	link.flat = true
	link.focus_mode = Control.FOCUS_NONE
	link.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	link.tooltip_text = tooltip
	var none := StyleBoxEmpty.new()
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		link.add_theme_stylebox_override(state, none)
	link.add_theme_font_override("font", UI.font(400))
	link.add_theme_font_size_override("font_size", 14)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		link.add_theme_color_override(name, Color(1, 1, 1, 0.75))
	link.pressed.connect(func() -> void: CommunityKit.open_url(url))
	return link


func _render_detail() -> void:
	_clear_children(_detail_view)
	_grids.clear()
	var post := _selected
	var id := int(post.get("id", 0))
	var busy := _busy_id == id
	var armed := _armed_id == id
	var status := _status_of(post)
	var copy := _copy_of(post)
	var url := str(post.get("url", ""))
	var back := CommunityKit.pill_button("← Back")
	back.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	back.pressed.connect(_back_to_grid)
	_detail_view.add_child(CommunityKit.margin_below(back, 14))
	_add_banners(_detail_view)
	var cover := CommunityKit.Cover.new(14.0)
	cover.show_url(str(post.get("coverImageUrl", "")))
	_detail_view.add_child(CommunityKit.margin_below(cover, 14))
	var heading := CommunityKit.row(10)
	if not str(post.get("avatarUrl", "")).is_empty():
		var avatar := CommunityKit.Avatar.new(29)
		avatar.show_url(str(post.get("avatarUrl", "")))
		heading.add_child(avatar)
	var title := CommunityKit.text(("📌 " if post.get("pinned", false) else "") + str(post.get("title", "")), 21, Color(1, 1, 1), 800)
	title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	heading.add_child(title)
	_detail_view.add_child(CommunityKit.margin_below(heading, 5))
	var byline := CommunityKit.text("by %s · %s" % [str(post.get("author", "")), CommunityKit.local_date(str(post.get("createdAt", "")))], 13, Color(1, 1, 1, 0.55))
	_detail_view.add_child(CommunityKit.margin_below(byline, 14))
	if not status.is_empty():
		var badge := _library_badge(status)
		if badge:
			_detail_view.add_child(CommunityKit.margin_below(badge, 14))
	var stats := CommunityKit.flow(18, 6)
	if post.get("installs") != null:
		var installs := CommunityKit.text("⬇ %d imported" % int(post["installs"]), 14, Color(1, 1, 1, 0.75))
		installs.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		stats.add_child(installs)
	stats.add_child(_text_link("👍 %d liked" % int(post.get("upvotes", 0)), url, "Like this scenario on its GitHub post"))
	stats.add_child(_text_link("💬 %d comments" % int(post.get("comments", 0)), url, "Comment on its GitHub post"))
	_detail_view.add_child(CommunityKit.margin_below(stats, 9))
	var note := CommunityKit.para("Likes and comments live on the scenario's GitHub post — tap 👍 or 💬 above (or the button below) to open it and react there.", 12, CommunityKit.ZINC, 400, 1.25)
	_detail_view.add_child(CommunityKit.margin_below(note, 16))
	var full := str(post.get("fullDescription", ""))
	if full.is_empty():
		full = str(post.get("description", ""))
	if full.is_empty():
		full = "No description."
	var description := CommunityKit.para(full, 14, Color(244 / 255.0, 244 / 255.0, 246 / 255.0, 0.8), 400, 1.6)
	_detail_view.add_child(CommunityKit.margin_below(description, 21))
	var buttons := CommunityKit.flow(10, 10)
	var has_bundle: bool = post.get("hasBundle", false)
	var big := {"bg": Color(1, 1, 1, 0.1), "border": Color(0, 0, 0, 0), "ink": Color(1, 1, 1), "size": 16, "weight": 700, "height": 45.0, "pad": 26.0, "radius": 10}
	if not copy.is_empty():
		var play := CommunityKit.pill_button("▶ Play your copy", big)
		play.tooltip_text = "Start a new game from “%s” in your Scenarios tab" % str(copy.get("name", ""))
		CommunityKit.set_idle(play, busy)
		var copy_id := str(copy.get("id", ""))
		play.pressed.connect(func() -> void: play_scenario.emit(copy_id))
		buttons.add_child(play)
		var again := CommunityKit.pill_button(_import_label(busy, status, armed))
		again.tooltip_text = "Click again to import another copy" if armed else "This scenario is already in your library"
		CommunityKit.set_idle(again, not has_bundle or busy)
		again.pressed.connect(func() -> void: _import(post))
		buttons.add_child(again)
	else:
		var options := big.duplicate()
		if not has_bundle:
			options["bg"] = Color(1, 1, 1, 0.08)
			options["ink"] = Color(1, 1, 1, 0.35)
		var import_play := CommunityKit.pill_button("Importing…" if busy else "▶ Import & Play", options)
		CommunityKit.set_idle(import_play, not has_bundle or busy)
		import_play.pressed.connect(func() -> void: _import(post, true))
		buttons.add_child(import_play)
	var react := CommunityKit.pill_button("👍 Like / 💬 Comment ↗")
	react.pressed.connect(func() -> void: CommunityKit.open_url(url))
	buttons.add_child(react)
	_detail_view.add_child(buttons)


func _import(post: Dictionary, play := false) -> void:
	var id := int(post.get("id", 0))
	if not post.get("hasBundle", false) or _busy_id != 0:
		return
	if not _status_of(post).is_empty() and _armed_id != id:
		_armed_id = id
		_render()
		return
	_busy_id = id
	_clear_banners()
	_render()
	var reply := await engine.request("community.import", {"postId": id})
	if not is_instance_valid(self):
		return
	var still_relevant := _selected.is_empty() or int(_selected.get("id", 0)) == id
	if reply.get("ok", false):
		var result: Dictionary = reply["result"]
		_library = result.get("library", _library)
		_scenarios = result.get("scenarios", _scenarios)
		library_changed.emit()
		var scenario: Variant = result.get("scenario")
		var scenario_name := str((scenario as Dictionary).get("name", "")) if typeof(scenario) == TYPE_DICTIONARY else str(post.get("title", ""))
		if still_relevant:
			_notice = "Imported \"%s\" — it's in your Scenarios tab. Enjoyed it? Open its hub post (👍 Like ↗) and hit 👍 to like or 💬 to comment." % scenario_name
			var missing := str(result.get("missingBasemap", ""))
			if not missing.is_empty():
				_error = "The scenario was imported, but its community basemap could not be downloaded. %s The game tries again the next time you start it and open the scenario." % missing
		if _missing_map.is_empty():
			var play_next := str((scenario as Dictionary).get("id", "")) if play and typeof(scenario) == TYPE_DICTIONARY else ""
			var offers: Array = result.get("offers", [])
			var count := int(result.get("detailedCount", 0))
			if count == 1 and offers.size() == 1 and (offers[0] as Dictionary).get("starting", false):
				_missing_map = {"basemap": offers[0], "postId": id, "playNext": play_next}
			elif not offers.is_empty():
				_missing_map = {"basemaps": offers, "postId": id, "playNext": play_next}
			elif not play_next.is_empty() and int(_selected.get("id", 0)) == id:
				_busy_id = 0
				_render()
				play_scenario.emit(play_next)
				return
	elif still_relevant:
		_error = "Import failed: %s" % str(reply.get("error", ""))
	_busy_id = 0
	_render()


func _publish(scenario: Dictionary) -> void:
	_publish_open = false
	_clear_banners()
	_render()
	var reply := await engine.request("community.publish", {"scenarioId": str(scenario.get("id", ""))})
	if not is_instance_valid(self):
		return
	if not reply.get("ok", false):
		_error = "Publish failed: %s" % str(reply.get("error", ""))
		_render()
		return
	var result: Dictionary = reply["result"]
	var zip_target := await CommunityKit.pick_file(self, true, str(result.get("fileName", "")), PackedStringArray(["*.zip ; Scenario"]))
	if not zip_target.is_empty():
		DirAccess.copy_absolute(str(result.get("zipFile", "")), zip_target)
	if not str(result.get("coverFile", "")).is_empty():
		var cover_target := await CommunityKit.pick_file(self, true, str(result.get("coverName", "")), PackedStringArray(["*.png, *.jpg, *.webp ; Cover image"]))
		if not cover_target.is_empty():
			DirAccess.copy_absolute(str(result.get("coverFile", "")), cover_target)
	var url := str(result.get("url", ""))
	CommunityKit.open_url(url)
	_publish_url = url
	_notice = str(result.get("notice", ""))
	_error = str(result.get("error", ""))
	library_changed.emit()
	_render()


class SkeletonCard extends CommunityKit.Skeleton:
	func _init() -> void:
		super._init(16.0)
		resized.connect(_layout)

	func _layout() -> void:
		var inner := size.x - 28.0
		var cover_height := roundf(inner * 9.0 / 16.0)
		custom_minimum_size.y = 14.0 + cover_height + 9.0 + 26.0 + 9.0 + 38.0 + 9.0 + 30.0 + 14.0
		var y := 14.0
		shapes = [{"rect": Rect2(14, y, inner, cover_height), "radius": 10.0}]
		y += cover_height + 9.0
		shapes.append({"rect": Rect2(14, y, 26, 26), "radius": 13.0})
		shapes.append({"rect": Rect2(49, y + 1, (inner - 35) * 0.72, 15), "radius": 6.0})
		shapes.append({"rect": Rect2(49, y + 20, (inner - 35) * 0.46, 11), "radius": 6.0})
		y += 26.0 + 9.0
		shapes.append({"rect": Rect2(14, y, inner * 0.96, 13), "radius": 6.0})
		shapes.append({"rect": Rect2(14, y + 20, inner * 0.70, 13), "radius": 6.0})
		y += 38.0 + 9.0 + 9.0
		for index in range(3):
			shapes.append({"rect": Rect2(14 + index * 40.0, y + 3, 32, 12), "radius": 6.0})
		shapes.append({"rect": Rect2(14 + inner - 67 - 8 - 74, y - 6, 74, 29), "radius": 999.0})
		shapes.append({"rect": Rect2(14 + inner - 67, y - 6, 67, 29), "radius": 999.0})
		queue_redraw()
