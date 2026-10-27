class_name UpdateNotice
extends Control

signal closed

const Themes := preload("res://scripts/shell/themes/upd_themes.gd")

var _engine: EngineLink
var _prefs := {}
var _pages: Array[Dictionary] = []
var _at := 0
var _still := false
var _narrow := false
var _metal := {}
var _backdrop: ColorRect
var _column: VBoxContainer
var _scroll: ScrollContainer
var _page_view: Control
var _controls: ControlsRow
var _dots: Array[Button] = []
var _dot_widths: Array[float] = []
var _built := false


class ControlsRow extends Container:
	var gap := 9.6

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _visible_children() -> Array[Control]:
		var items: Array[Control] = []
		for child in get_children():
			if child is Control and (child as Control).visible:
				items.append(child as Control)
		return items

	func _rows() -> Array:
		var items := _visible_children()
		var rows: Array = []
		var current: Array[Control] = []
		var used := 0.0
		for item in items:
			var want := item.get_combined_minimum_size().x
			if not current.is_empty() and used + gap + want > size.x:
				rows.append(current)
				current = []
				used = 0.0
			used += (gap if not current.is_empty() else 0.0) + want
			current.append(item)
		if not current.is_empty():
			rows.append(current)
		return rows

	func _notification(what: int) -> void:
		if what == NOTIFICATION_SORT_CHILDREN:
			var rows := _rows()
			var y := 0.0
			for row in rows:
				var line: Array = row
				var height := 0.0
				for item in line:
					height = maxf(height, (item as Control).get_combined_minimum_size().y)
				if line.size() == 1:
					var only: Control = line[0]
					var want := only.get_combined_minimum_size()
					var at := 0.0 if bool(only.get_meta("start", false)) or rows.size() > 1 else size.x - want.x
					fit_child_in_rect(only, Rect2(Vector2(at, y + (height - want.y) * 0.5), want))
				else:
					var first: Control = line[0]
					var last: Control = line[line.size() - 1]
					var first_want := first.get_combined_minimum_size()
					var last_want := last.get_combined_minimum_size()
					fit_child_in_rect(first, Rect2(Vector2(0.0, y + (height - first_want.y) * 0.5), first_want))
					fit_child_in_rect(last, Rect2(Vector2(size.x - last_want.x, y + (height - last_want.y) * 0.5), last_want))
				y += height + gap
			update_minimum_size()

	func _get_minimum_size() -> Vector2:
		var total := 0.0
		var rows := _rows()
		for row in rows:
			var height := 0.0
			for item in row:
				height = maxf(height, (item as Control).get_combined_minimum_size().y)
			total += height
		return Vector2(0.0, total + gap * float(maxi(0, rows.size() - 1)))


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	_backdrop = ColorRect.new()
	_backdrop.color = Color(4 / 255.0, 6 / 255.0, 9 / 255.0, 0.84)
	_backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_backdrop)
	_column = VBoxContainer.new()
	_column.add_theme_constant_override("separation", roundi(UpdateKit.px(0.7)))
	_column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_column)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	_scroll.mouse_filter = Control.MOUSE_FILTER_PASS
	_scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_style_scrollbar(_scroll)
	_column.add_child(_scroll)
	_controls = ControlsRow.new()
	_controls.gap = UpdateKit.px(0.6)
	_controls.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_column.add_child(_controls)
	visible = false


static func _style_scrollbar(scroll: ScrollContainer) -> void:
	var bar := scroll.get_v_scroll_bar()
	var empty := StyleBoxEmpty.new()
	bar.add_theme_stylebox_override("scroll", empty)
	bar.add_theme_stylebox_override("scroll_focus", empty)
	var grab := UpdateKit.box(Color(1, 1, 1, 0.3), Color(0, 0, 0, 0), 4.0)
	bar.add_theme_stylebox_override("grabber", grab)
	bar.add_theme_stylebox_override("grabber_highlight", grab)
	bar.add_theme_stylebox_override("grabber_pressed", grab)
	bar.custom_minimum_size.x = 8.0


func setup(engine: EngineLink, updates: Array, prefs: Dictionary) -> void:
	_engine = engine
	_prefs = prefs
	_still = bool(prefs.get("reduceMotion", false))
	_pages.clear()
	var needs_metal := false
	for raw in updates:
		var update: Dictionary = raw
		var banners: Array = update.get("banners", [])
		for index in range(banners.size()):
			var banner: Dictionary = banners[index]
			_pages.append({"key": "%s#%d" % [str(update.get("id", "")), index], "update": update, "banner": banner})
			if str(update.get("kind", "")) == "major" and str(banner.get("theme", "")) == "warsAndFronts2":
				needs_metal = true
	_at = 0
	if _pages.is_empty():
		visible = false
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		_backdrop.mouse_filter = Control.MOUSE_FILTER_IGNORE
		return
	if needs_metal:
		_metal = await UpdateKit.metal(engine)
	_narrow = _viewport_width() < 560.0
	_built = true
	visible = true
	_build_dots()
	_show_page(0)
	if not _still:
		modulate.a = 0.0
		CubicBezier.animate(self, func(t: float) -> void: modulate.a = t, 400.0, 0.0, UpdateKit.RISE)
	_watch_size()


func _ready() -> void:
	_watch_size()


func _watch_size() -> void:
	if is_inside_tree() and not get_viewport().size_changed.is_connected(_on_resized):
		get_viewport().size_changed.connect(_on_resized)


func page_count() -> int:
	return _pages.size()


func show_page(index: int) -> void:
	if _pages.is_empty():
		return
	_show_page(clampi(index, 0, _pages.size() - 1))


func _viewport_width() -> float:
	if is_inside_tree():
		return get_viewport_rect().size.x
	return 1440.0


func _on_resized() -> void:
	if not _built:
		return
	var narrow := _viewport_width() < 560.0
	if narrow != _narrow:
		_narrow = narrow
		_show_page(_at)


func _move(step: int) -> void:
	_show_page(clampi(_at + step, 0, _pages.size() - 1))


func _show_page(index: int) -> void:
	var changed := index != _at or _page_view == null
	_at = index
	if changed or _page_view == null:
		if _page_view:
			_scroll.remove_child(_page_view)
			_page_view.queue_free()
		var page: Dictionary = _pages[_at]
		var ctx := {"still": _still, "narrow": _narrow, "width": _viewport_width(), "sound": bool(_prefs.get("soundEffects", false)), "metal": _metal, "engine": _engine}
		_page_view = Themes.page(page["banner"], page["update"], ctx)
		_page_view.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_scroll.add_child(_page_view)
		_scroll.scroll_vertical = 0
	_build_controls()


func _build_dots() -> void:
	_dots.clear()
	_dot_widths.clear()
	for index in range(_pages.size()):
		var dot := Button.new()
		dot.focus_mode = Control.FOCUS_NONE
		dot.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		var target := index
		dot.pressed.connect(func() -> void: _show_page(target))
		_dots.append(dot)
		_dot_widths.append(UpdateKit.px(1.4) if index == 0 else UpdateKit.px(0.5))


func _build_controls() -> void:
	for dot in _dots:
		if dot.get_parent():
			dot.get_parent().remove_child(dot)
	for child in _controls.get_children():
		_controls.remove_child(child)
		child.queue_free()
	var page: Dictionary = _pages[_at]
	var banner: Dictionary = page["banner"]
	var update: Dictionary = page["update"]
	var chrome: Dictionary = Themes.chrome(banner, update)
	var several := _pages.size() > 1
	var last := _at >= _pages.size() - 1
	if several:
		var paging := UpdateKit.hbox(roundi(UpdateKit.px(0.55)))
		paging.add_child(_arrow("‹", _at == 0, -1, chrome.get("arrow", {})))
		var dots := UpdateKit.hbox(roundi(UpdateKit.px(0.35)))
		dots.alignment = BoxContainer.ALIGNMENT_CENTER
		var dot_spec: Dictionary = chrome.get("dot", {})
		for index in range(_dots.size()):
			var dot := _dots[index]
			_style_dot(dot, index == _at, dot_spec)
			dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			dots.add_child(dot)
		paging.add_child(dots)
		paging.add_child(_arrow("›", last, 1, chrome.get("arrow", {})))
		paging.set_meta("start", true)
		_controls.add_child(paging)
	var finish := UpdateKit.hbox(roundi(UpdateKit.px(0.8)))
	finish.alignment = BoxContainer.ALIGNMENT_END
	if several and not last:
		var skip := UpdateKit.chrome_button("Skip", {"bg": Color(0, 0, 0, 0), "border": Color(0, 0, 0, 0), "ink": UpdateKit.FAINT, "size": UpdateKit.px(0.8), "weight": 700, "pad": Vector2(6.0, 1.0), "radius": 0.0, "font": UpdateKit.BASE_FONT}, chrome.get("skip", {}))
		skip.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		skip.pressed.connect(func() -> void: closed.emit())
		finish.add_child(skip)
	var label := "Next"
	if last:
		label = str(banner.get("button", ""))
		if label.is_empty():
			label = "Continue"
	var main := UpdateKit.chrome_button(label, {"bg": Color(0, 0, 0, 0), "border": Color(0, 0, 0, 0), "ink": UpdateKit.INK, "radius": 8.0, "size": UpdateKit.px(0.88), "weight": 800, "min_height": UpdateKit.px(2.4), "pad": Vector2(UpdateKit.px(1.25), UpdateKit.px(0.45)), "font": UpdateKit.BASE_FONT}, chrome.get("button", {}))
	main.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	main.pressed.connect(func() -> void:
		if _at >= _pages.size() - 1:
			closed.emit()
		else:
			_move(1))
	finish.add_child(main)
	_controls.add_child(finish)


func _arrow(glyph: String, disabled: bool, step: int, spec: Dictionary) -> Button:
	var base := {"bg": Color(1, 1, 1, 0.07), "border": Color(1, 1, 1, 0.14), "ink": UpdateKit.INK, "radius": 999.0, "size": UpdateKit.px(1.1), "weight": 400, "pad": Vector2.ZERO, "min_width": UpdateKit.px(2.3), "min_height": UpdateKit.px(2.3), "font": UpdateKit.BASE_FONT}
	var button := UpdateKit.chrome_button(glyph, base, spec)
	button.custom_minimum_size = Vector2(UpdateKit.px(2.3), UpdateKit.px(2.3))
	button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	if disabled:
		button.disabled = true
		button.modulate.a = 0.3
		button.mouse_default_cursor_shape = Control.CURSOR_ARROW
	else:
		button.pressed.connect(func() -> void: _move(step))
	return button


func _style_dot(dot: Button, on: bool, spec: Dictionary) -> void:
	var colour: Color = spec.get("on", Color.WHITE) if on else spec.get("off", Color(1, 1, 1, 0.25))
	var radius := float(spec.get("radius", 999.0))
	var style := UpdateKit.box(colour, Color(0, 0, 0, 0), radius, 0)
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
		dot.add_theme_stylebox_override(state, style)
	var index := _dots.find(dot)
	var from := _dot_widths[index] if index >= 0 else UpdateKit.px(0.5)
	var target := UpdateKit.px(1.4) if on else UpdateKit.px(0.5)
	if index >= 0:
		_dot_widths[index] = target
	dot.custom_minimum_size = Vector2(from, UpdateKit.px(0.5))
	if _still or is_equal_approx(from, target):
		dot.custom_minimum_size = Vector2(target, UpdateKit.px(0.5))
		return
	CubicBezier.animate(dot, func(t: float) -> void: dot.custom_minimum_size = Vector2(lerpf(from, target, t), UpdateKit.px(0.5)), 200.0, 0.0, UpdateKit.RISE, false)


func _input(event: InputEvent) -> void:
	if not visible or _pages.is_empty() or not is_visible_in_tree():
		return
	if event is InputEventKey and (event as InputEventKey).pressed:
		var key := event as InputEventKey
		match key.keycode:
			KEY_ESCAPE:
				get_viewport().set_input_as_handled()
				closed.emit()
			KEY_RIGHT:
				get_viewport().set_input_as_handled()
				_move(1)
			KEY_LEFT:
				get_viewport().set_input_as_handled()
				_move(-1)


func _process(_delta: float) -> void:
	if not visible or _page_view == null:
		return
	var view := get_viewport_rect().size
	var pad := UpdateKit.px(1.0)
	var available := view - Vector2(pad * 2.0, pad * 2.0)
	var minor := str((_pages[_at]["update"] as Dictionary).get("kind", "")) != "major"
	var width := minf(UpdateKit.px(28.0) if minor else UpdateKit.px(62.0), available.x)
	var gap := UpdateKit.px(0.7)
	var controls_height := _controls.get_combined_minimum_size().y
	var content := _page_view.get_combined_minimum_size().y
	var scroll_height := maxf(0.0, minf(content, available.y - controls_height - gap))
	_scroll.custom_minimum_size = Vector2(width, scroll_height)
	var total := Vector2(width, scroll_height + gap + controls_height)
	_column.size = total
	_column.position = ((view - total) * 0.5).round()
