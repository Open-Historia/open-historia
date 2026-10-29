class_name UpdateHistory
extends Control

signal closed

const Themes := preload("res://scripts/shell/themes/upd_themes.gd")
const PAGE := Color("#0b0c0f")
const INK := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 1.0)
const SOFT := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.66)
const FAINT := Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.42)
const LINE := Color(1, 1, 1, 0.12)
const FONT := "sans-serif"

var _engine: EngineLink
var _prefs := {}
var _still := false
var _updates: Array = []
var _viewing: UpdateNotice
var _scroll: ScrollContainer
var _timeline: VBoxContainer
var _version: Label


class Timeline extends Container:
	var content: Control
	var trail := 0.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_PASS
		size_flags_horizontal = Control.SIZE_EXPAND_FILL

	func _notification(what: int) -> void:
		if what == NOTIFICATION_SORT_CHILDREN and content:
			var width := minf(size.x, UpdateKit.px(46.0))
			var left := floorf((size.x - width) * 0.5)
			fit_child_in_rect(content, Rect2(Vector2(left, 0.0), Vector2(width, content.get_combined_minimum_size().y)))
			queue_redraw()
		elif what == NOTIFICATION_RESIZED:
			queue_redraw()

	func _get_minimum_size() -> Vector2:
		if not content:
			return Vector2.ZERO
		return Vector2(0.0, content.get_combined_minimum_size().y)

	func _draw() -> void:
		if not content:
			return
		var top := UpdateKit.px(0.4)
		draw_rect(Rect2(content.position.x + UpdateKit.px(1.06), top, 2.0, maxf(0.0, size.y - top - trail)), LINE)


class Item extends Container:
	var card: Control
	var major := true
	var accent := Color.WHITE
	var lift := 0.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_PASS
		size_flags_horizontal = Control.SIZE_EXPAND_FILL

	func _notification(what: int) -> void:
		if what == NOTIFICATION_SORT_CHILDREN and card:
			var inset := UpdateKit.px(2.4)
			fit_child_in_rect(card, Rect2(Vector2(inset, lift), Vector2(maxf(0.0, size.x - inset), card.get_combined_minimum_size().y)))
			queue_redraw()

	func _get_minimum_size() -> Vector2:
		if not card:
			return Vector2.ZERO
		return Vector2(0.0, card.get_combined_minimum_size().y)

	func _draw() -> void:
		if major:
			var side := UpdateKit.px(0.95)
			var centre := Vector2(UpdateKit.px(0.62) + side * 0.5, lift + UpdateKit.px(0.95) + side * 0.5)
			var half := side * 0.5 * sqrt(2.0)
			draw_colored_polygon(PackedVector2Array([centre + Vector2(0, -half), centre + Vector2(half, 0), centre + Vector2(0, half), centre + Vector2(-half, 0)]), accent)
		else:
			var size_px := UpdateKit.px(0.6)
			var centre := Vector2(UpdateKit.px(0.8) + size_px * 0.5, lift + UpdateKit.px(1.05) + size_px * 0.5)
			draw_circle(centre, size_px * 0.5, accent, true, -1.0, true)
			draw_circle(centre, size_px * 0.5 - 2.0, PAGE, true, -1.0, true)

	func rise(delay: float, still: bool) -> void:
		if still:
			return
		var apply := func(t: float) -> void:
			lift = 16.0 * (1.0 - t)
			modulate.a = t
			if card:
				card.pivot_offset = card.size * 0.5
				card.scale = Vector2.ONE * (0.985 + 0.015 * t)
			queue_sort()
		CubicBezier.animate(self, apply, 500.0, delay, UpdateKit.RISE)


class CardStyle extends StyleBox:
	var background := Color.BLACK
	var border := Color.WHITE
	var accent := Color.WHITE
	var _base: StyleBoxFlat
	var _edge: StyleBoxFlat

	func _draw(to_canvas_item: RID, area: Rect2) -> void:
		if not _base:
			_base = StyleBoxFlat.new()
			_base.bg_color = background
			_base.border_color = border
			_base.set_border_width_all(1)
			_base.set_corner_radius_all(10)
			_base.anti_aliasing = true
			_edge = StyleBoxFlat.new()
			_edge.draw_center = false
			_edge.border_color = accent
			_edge.border_width_left = 3
			_edge.set_corner_radius_all(10)
			_edge.anti_aliasing = true
		_base.draw(to_canvas_item, area)
		_edge.draw(to_canvas_item, area)


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var page := ColorRect.new()
	page.color = PAGE
	page.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	page.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(page)
	var column := VBoxContainer.new()
	column.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	column.add_theme_constant_override("separation", 0)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(column)
	var header := PanelContainer.new()
	header.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var header_style := StyleBoxFlat.new()
	header_style.bg_color = Color(0, 0, 0, 0)
	header_style.border_color = LINE
	header_style.border_width_bottom = 1
	header_style.content_margin_left = UpdateKit.px(1.0)
	header_style.content_margin_right = UpdateKit.px(1.0)
	header_style.content_margin_top = UpdateKit.px(0.8)
	header_style.content_margin_bottom = UpdateKit.px(0.8) + 1.0
	header.add_theme_stylebox_override("panel", header_style)
	var row := UpdateKit.hbox(roundi(UpdateKit.px(0.8)))
	row.alignment = BoxContainer.ALIGNMENT_BEGIN
	var mark := TextureRect.new()
	mark.texture = UI.logo()
	mark.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	mark.stretch_mode = TextureRect.STRETCH_SCALE
	mark.custom_minimum_size = Vector2(UpdateKit.px(2.2), UpdateKit.px(2.2))
	mark.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	mark.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(mark)
	var titles := UpdateKit.vbox(0)
	titles.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	titles.add_child(UpdateKit.text("Update history", UpdateKit.px(1.05), INK, FONT, 850))
	titles.add_child(UpdateKit.text("Every update to Open Historia, newest first.", UpdateKit.px(0.74), FAINT, FONT))
	_version = UpdateKit.text("", UpdateKit.px(0.66), FAINT, FONT)
	_version.visible = false
	titles.add_child(_version)
	row.add_child(titles)
	var close := UpdateKit.chrome_button("×", {"bg": Color(1, 1, 1, 0.06), "border": LINE, "ink": INK, "radius": 999.0, "size": UpdateKit.px(1.1), "weight": 400, "pad": Vector2.ZERO, "min_width": UpdateKit.px(2.3), "min_height": UpdateKit.px(2.3), "font": UpdateKit.BASE_FONT}, {})
	close.custom_minimum_size = Vector2(UpdateKit.px(2.3), UpdateKit.px(2.3))
	close.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	close.pressed.connect(func() -> void: closed.emit())
	row.add_child(close)
	header.add_child(row)
	column.add_child(header)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scroll.mouse_filter = Control.MOUSE_FILTER_PASS
	UpdateNotice._style_scrollbar(_scroll)
	column.add_child(_scroll)
	var padded := MarginContainer.new()
	padded.mouse_filter = Control.MOUSE_FILTER_PASS
	padded.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	padded.add_theme_constant_override("margin_left", roundi(UpdateKit.px(1.0)))
	padded.add_theme_constant_override("margin_top", roundi(UpdateKit.px(1.2)))
	padded.add_theme_constant_override("margin_right", roundi(UpdateKit.px(1.0)))
	padded.add_theme_constant_override("margin_bottom", roundi(UpdateKit.px(2.0)))
	var timeline := Timeline.new()
	_timeline = UpdateKit.vbox(0)
	timeline.content = _timeline
	timeline.add_child(_timeline)
	padded.add_child(timeline)
	_scroll.add_child(padded)


func setup(engine: EngineLink, prefs: Dictionary) -> void:
	_engine = engine
	_prefs = prefs
	_still = bool(prefs.get("reduceMotion", false))
	if not _still:
		modulate.a = 0.0
		CubicBezier.animate(self, func(t: float) -> void: modulate.a = t, 250.0, 0.0, UpdateKit.RISE)
	if not engine:
		return
	var reply: Dictionary = await engine.request("shell.updates")
	if not reply.get("ok", false):
		return
	_updates = (reply.get("result", {}) as Dictionary).get("updates", [])
	_build()
	var told: Dictionary = await engine.request("update.state")
	var state: Variant = told.get("result")
	if bool(told.get("ok", false)) and state is Dictionary and is_instance_valid(_version):
		_version.text = str((state as Dictionary).get("versionText", ""))
		var current: Variant = (state as Dictionary).get("current")
		var notes := str((current as Dictionary).get("notes", "")) if current is Dictionary else ""
		if not notes.is_empty() and not _version.text.is_empty():
			_version.text += " — " + notes
		_version.visible = not _version.text.is_empty()


func _build() -> void:
	for child in _timeline.get_children():
		_timeline.remove_child(child)
		child.queue_free()
	var groups: Array[Dictionary] = []
	for raw in _updates:
		var update: Dictionary = raw
		var month := str(update.get("monthText", ""))
		if groups.is_empty() or str(groups[groups.size() - 1]["month"]) != month:
			groups.append({"month": month, "updates": []})
		(groups[groups.size() - 1]["updates"] as Array).append(update)
	var order := 0
	for group_index in range(groups.size()):
		var group: Dictionary = groups[group_index]
		_timeline.add_child(UpdateKit.gap(UpdateKit.px(0.4) if group_index == 0 else UpdateKit.px(0.9)))
		var heading := PanelContainer.new()
		heading.mouse_filter = Control.MOUSE_FILTER_IGNORE
		heading.add_theme_stylebox_override("panel", UpdateKit.box(PAGE, Color(0, 0, 0, 0), 0.0, 0, Vector4(UpdateKit.px(2.4), 0, 0, 0)))
		heading.add_child(UpdateKit.text(str(group["month"]), UpdateKit.px(0.72), FAINT, FONT, 800, false, 0.14, true))
		_timeline.add_child(heading)
		_timeline.add_child(UpdateKit.gap(UpdateKit.px(0.8)))
		var updates: Array = group["updates"]
		for index in range(updates.size()):
			order += 1
			if index > 0:
				_timeline.add_child(UpdateKit.gap(UpdateKit.px(0.9)))
			_timeline.add_child(_card(updates[index], float(mini(order, 12)) * 50.0))
	if not groups.is_empty():
		_timeline.add_child(UpdateKit.gap(UpdateKit.px(0.9)))
		(_timeline.get_parent() as Timeline).trail = UpdateKit.px(0.9)


func _card(update: Dictionary, delay: float) -> Control:
	var major := str(update.get("kind", "")) == "major"
	var banners: Array = update.get("banners", [])
	var first: Dictionary = banners[0] if not banners.is_empty() else {}
	var chrome: Dictionary = Themes.chrome(first, update)
	var accent: Color = (chrome.get("dot", {}) as Dictionary).get("on", Color.WHITE) if major else Color(244 / 255.0, 244 / 255.0, 245 / 255.0, 0.5)
	var item := Item.new()
	item.major = major
	item.accent = accent
	var panel := PanelContainer.new()
	panel.mouse_filter = Control.MOUSE_FILTER_PASS
	var style := CardStyle.new()
	style.background = Color("#15181d") if major else Color(1, 1, 1, 0.03)
	style.border = Color(1, 1, 1, 0.1) if major else Color(1, 1, 1, 0.06)
	style.accent = accent
	if major:
		style.content_margin_left = UpdateKit.px(1.0) + 3.0
		style.content_margin_right = UpdateKit.px(1.0) + 1.0
		style.content_margin_top = UpdateKit.px(0.85) + 1.0
		style.content_margin_bottom = UpdateKit.px(0.9) + 1.0
	else:
		style.content_margin_left = UpdateKit.px(0.85) + 3.0
		style.content_margin_right = UpdateKit.px(0.85) + 1.0
		style.content_margin_top = UpdateKit.px(0.6) + 1.0
		style.content_margin_bottom = UpdateKit.px(0.65) + 1.0
	panel.add_theme_stylebox_override("panel", style)
	var column := UpdateKit.vbox(0)
	var meta := UpdateKit.hbox(roundi(UpdateKit.px(0.5)))
	var kind := UpdateKit.text("Major update" if major else "Minor update", UpdateKit.px(0.66), accent if major else FAINT, FONT, 800, false, 0.12, true)
	kind.autowrap_mode = TextServer.AUTOWRAP_OFF
	kind.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	kind.size_flags_vertical = Control.SIZE_SHRINK_END
	meta.add_child(kind)
	var when := UpdateKit.text(str(update.get("dateText", "")), UpdateKit.px(0.72), FAINT, FONT)
	when.autowrap_mode = TextServer.AUTOWRAP_OFF
	when.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	when.size_flags_vertical = Control.SIZE_SHRINK_END
	meta.add_child(when)
	var channel := str(update.get("channel", ""))
	if channel == "beta" or channel == "alpha":
		var pill := PanelContainer.new()
		pill.mouse_filter = Control.MOUSE_FILTER_IGNORE
		pill.add_theme_stylebox_override("panel", UpdateKit.box(Color(0, 0, 0, 0), LINE, 999.0, 1, Vector4(UpdateKit.px(0.4) + 1.0, 1.0, UpdateKit.px(0.4) + 1.0, 1.0)))
		var words := UpdateKit.text("First on the beta" if channel == "beta" else "First on the alpha", UpdateKit.px(0.64), FAINT, FONT)
		words.autowrap_mode = TextServer.AUTOWRAP_OFF
		pill.add_child(words)
		pill.size_flags_vertical = Control.SIZE_SHRINK_END
		meta.add_child(pill)
	column.add_child(meta)
	column.add_child(UpdateKit.gap(UpdateKit.px(0.2)))
	var title_size := UpdateKit.px(1.15) if major else UpdateKit.px(0.92)
	var runs: Array[Dictionary] = [UpdateKit.run(str(first.get("title", "")), title_size, INK, FONT, 800)]
	if major and not str(first.get("subtitle", "")).is_empty():
		var joiner := UpdateKit.run(" · ", title_size, SOFT, FONT, 600)
		joiner["translate"] = false
		runs.append(joiner)
		runs.append(UpdateKit.run(str(first.get("subtitle", "")), title_size, SOFT, FONT, 600))
	column.add_child(UpdateKit.runs(runs))
	if major and not str(first.get("lead", "")).is_empty():
		column.add_child(UpdateKit.gap(UpdateKit.px(0.35)))
		column.add_child(UpdateKit.para(str(first.get("lead", "")), UpdateKit.px(0.84), SOFT, FONT, 400, false, 1.5))
	if major and banners.size() > 1:
		var titles: PackedStringArray = []
		for banner in banners:
			titles.append(str((banner as Dictionary).get("title", "")))
		column.add_child(UpdateKit.gap(UpdateKit.px(0.4)))
		column.add_child(UpdateKit.text(" · ".join(titles), UpdateKit.px(0.76), FAINT, FONT))
	if not major:
		column.add_child(UpdateKit.gap(UpdateKit.px(0.35)))
		for banner in banners:
			for entry in (banner as Dictionary).get("items", []):
				column.add_child(UpdateKit.list_item(str(entry), UpdateKit.px(0.8), SOFT, FONT, 1.5, UpdateKit.px(1.05)))
	if major:
		column.add_child(UpdateKit.gap(UpdateKit.px(0.7)))
		var view_button := UpdateKit.chrome_button("View", {"bg": Color(0, 0, 0, 0), "border": Color(0, 0, 0, 0), "ink": INK, "radius": 8.0, "size": UpdateKit.px(0.8), "weight": 800, "min_height": UpdateKit.px(2.1), "pad": Vector2(UpdateKit.px(1.0), UpdateKit.px(0.35)), "font": UpdateKit.BASE_FONT}, chrome.get("button", {}))
		view_button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		var id := str(update.get("id", ""))
		view_button.pressed.connect(func() -> void: view(id))
		column.add_child(view_button)
	panel.add_child(column)
	item.card = panel
	item.add_child(panel)
	item.rise(delay, _still)
	return item


func view(update_id: String) -> void:
	var found := {}
	for raw in _updates:
		var update: Dictionary = raw
		if str(update.get("id", "")) == update_id:
			found = update
	if found.is_empty():
		return
	if _viewing and is_instance_valid(_viewing):
		_viewing.queue_free()
	_viewing = UpdateNotice.new()
	add_child(_viewing)
	_viewing.closed.connect(func() -> void:
		if is_instance_valid(_viewing):
			_viewing.queue_free()
		_viewing = null)
	_viewing.setup(_engine, [found], _prefs)


func viewing() -> UpdateNotice:
	return _viewing


func scroll_to(fraction: float) -> void:
	var bar := _scroll.get_v_scroll_bar()
	_scroll.scroll_vertical = int((bar.max_value - bar.page) * clampf(fraction, 0.0, 1.0))


func _input(event: InputEvent) -> void:
	if not is_visible_in_tree() or (_viewing and is_instance_valid(_viewing)):
		return
	if event is InputEventKey and (event as InputEventKey).pressed and (event as InputEventKey).keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		closed.emit()
