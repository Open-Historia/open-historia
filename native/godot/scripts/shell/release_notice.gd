class_name ReleaseNotice
extends Control

signal closed

const NUMERALS := ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]
const ACCENTS := {"front": "#e2683c", "skies": "#7fb8e0", "table": "#d9a441", "world": "#8cc7a1", "map": "#5cc3c9", "yours": "#e0b35a", "engine": "#c9d2dc"}
const GOLD := Color("#d9a441")
const INK := Color("#f2eee5")
const SOFT := Color(242 / 255.0, 238 / 255.0, 229 / 255.0, 0.74)
const FAINT := Color(242 / 255.0, 238 / 255.0, 229 / 255.0, 0.42)
const PAGE := Color("#06080b")
const DISPLAY := ["Bahnschrift", "DIN Alternate", "Barlow Condensed", "Roboto Condensed", "Arial Narrow", "sans-serif"]
const BODY := ["Segoe UI", "Helvetica Neue", "Arial", "sans-serif"]

static var _fonts := {}

var still := false
var release := {}
var _scroll: ScrollContainer
var _page: VBoxContainer
var _stages: Array = []
var _reveals: Array = []
var _chapters: Array = []
var _rail_items: Array = []
var _bar_fill: ColorRect
var _bar: Control
var _hero_copy: Control
var _cue: Control
var _finale_copy: Control
var _vh := 900.0
var _vw := 1440.0
var _active := -1


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var backdrop := ColorRect.new()
	backdrop.color = PAGE
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(backdrop)


func open(link: EngineLink, id: String, reduce_motion := false) -> void:
	still = reduce_motion
	var reply: Dictionary = await link.request("look.release", {"id": id})
	var result: Dictionary = reply.get("result", {}) if reply.get("ok", false) else {}
	if typeof(result.get("release")) != TYPE_DICTIONARY:
		closed.emit()
		return
	release = result["release"]
	_vw = maxf(320.0, get_viewport_rect().size.x)
	_vh = maxf(320.0, get_viewport_rect().size.y)
	_build()
	if not still:
		modulate.a = 0.0
		create_tween().tween_property(self, "modulate:a", 1.0, 0.6).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)


static func font(display: bool, weight := 400, stretch := 100) -> Font:
	var key := "%s:%d:%d" % [display, weight, stretch]
	if _fonts.has(key):
		return _fonts[key]
	var system := SystemFont.new()
	system.font_names = PackedStringArray(DISPLAY if display else BODY)
	system.font_weight = weight
	system.font_stretch = stretch
	system.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	_fonts[key] = system
	return system


func _text(value: String, size: float, ink: Color, display := false, weight := 400, spacing_em := 0.0, upper := false, stretch := 100) -> Label:
	var label := Label.new()
	label.text = value
	label.uppercase = upper
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var base := font(display, weight, stretch)
	var spacing := int(round(spacing_em * size))
	if spacing != 0:
		var variation := FontVariation.new()
		variation.base_font = base
		variation.spacing_glyph = spacing
		base = variation
	label.add_theme_font_override("font", base)
	label.add_theme_font_size_override("font_size", int(round(size)))
	label.add_theme_color_override("font_color", ink)
	label.add_theme_constant_override("line_spacing", 0)
	return label


func _lined(label: Label, ratio: float) -> Label:
	var size := float(label.get_theme_font_size("font_size"))
	var height := label.get_theme_font("font").get_height(int(size))
	label.add_theme_constant_override("line_spacing", int(round(size * ratio - height)))
	return label


func _outlined(value: String, size: float, ink: Color, weight: int, stroke: float) -> Label:
	var label := _text(value, size, Color(0, 0, 0, 0), true, weight)
	label.autowrap_mode = TextServer.AUTOWRAP_OFF
	label.add_theme_color_override("font_outline_color", ink)
	label.add_theme_constant_override("outline_size", int(round(stroke * 2.0)))
	label.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	return label


func _art(key: String, align_bottom := false) -> TextureRect:
	var rect := TextureRect.new()
	var source := str(ReleaseArt.SCENES.get(key, ""))
	var image := Image.new()
	var native := Vector2(1200, 800) if key != "hero" else Vector2(1600, 900)
	var scale_by := maxf(_vw / native.x, _vh / native.y) * float(get_tree().root.content_scale_factor if get_tree() else 1.0)
	if not source.is_empty() and image.load_svg_from_string(source, scale_by) == OK:
		rect.texture = ImageTexture.create_from_image(image)
	rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if align_bottom:
		rect.set_meta("bottom", true)
	return rect


func _section(height: float, bg := PAGE) -> Control:
	var section := Control.new()
	section.custom_minimum_size = Vector2(_vw, height)
	section.clip_contents = true
	var fill := ColorRect.new()
	fill.color = bg
	fill.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	section.add_child(fill)
	section.mouse_filter = Control.MOUSE_FILTER_PASS
	return section


func _stage(section: Control) -> Control:
	var stage := Control.new()
	stage.size = Vector2(_vw, _vh)
	stage.clip_contents = true
	stage.mouse_filter = Control.MOUSE_FILTER_IGNORE
	section.add_child(stage)
	_stages.append([section, stage])
	return stage


func _reveal(control: Control) -> Control:
	if not still:
		control.modulate.a = 0.0
		_reveals.append(control)
	return control


func _build() -> void:
	_scroll = ScrollContainer.new()
	_scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_SHOW_NEVER
	add_child(_scroll)
	_page = VBoxContainer.new()
	_page.add_theme_constant_override("separation", 0)
	_page.custom_minimum_size.x = _vw
	_scroll.add_child(_page)
	_page.add_child(_hero())
	_page.add_child(_intro())
	var chapters: Array = release.get("chapters", [])
	for index in range(chapters.size()):
		var chapter: Dictionary = chapters[index]
		_page.add_child(_chapter(chapter, index, chapters.size()))
		_page.add_child(_ledger(chapter))
	_page.add_child(_finale())
	_build_hud()
	_build_rail()
	_scroll.get_v_scroll_bar().value_changed.connect(func(_value: float) -> void: _on_scroll())
	_on_scroll.call_deferred()


func _hero() -> Control:
	var section := _section(_vh * 2.1)
	var stage := _stage(section)
	stage.add_child(_art("hero", true))
	var copy := VBoxContainer.new()
	copy.add_theme_constant_override("separation", 0)
	copy.alignment = BoxContainer.ALIGNMENT_BEGIN
	copy.position = Vector2(_vw * 0.06, _vh * 0.24)
	copy.size = Vector2(_vw * 0.88, 0)
	copy.custom_minimum_size.x = _vw * 0.88
	copy.mouse_filter = Control.MOUSE_FILTER_IGNORE
	copy.add_child(_centered(_version_line()))
	var title_size := clampf(_vw * 0.1, 49.6, 144.0)
	var gap := Control.new()
	gap.custom_minimum_size.y = title_size * 0.28
	copy.add_child(gap)
	var title := _text(str(release.get("title", "")), title_size, Color("#f6f1e6"), true, 800, 0.02, true, 80)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 1))
	title.add_theme_constant_override("shadow_offset_y", 6)
	title.add_theme_constant_override("shadow_offset_x", 0)
	_lined(title, 0.9)
	copy.add_child(title)
	var after := Control.new()
	after.custom_minimum_size.y = title_size * 0.2 + 9.6
	copy.add_child(after)
	copy.add_child(_centered(_rule(minf(544.0, _vw * 0.88))))
	var under := Control.new()
	under.custom_minimum_size.y = 16
	copy.add_child(under)
	var subtitle := _text(str(release.get("subtitle", "")), clampf(_vw * 0.022, 16.0, 24.8), INK, true, 600, 0.12, true)
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	copy.add_child(subtitle)
	var date_gap := Control.new()
	date_gap.custom_minimum_size.y = 12.8
	copy.add_child(date_gap)
	var date := _text(str(release.get("dateText", "")), 13.8, FAINT, false, 400, 0.14, true)
	date.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	date.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	copy.add_child(date)
	stage.add_child(copy)
	_hero_copy = copy
	var cue := VBoxContainer.new()
	cue.add_theme_constant_override("separation", 10)
	cue.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var word := _text("Scroll", 12.5, SOFT, true, 400, 0.4, true)
	word.autowrap_mode = TextServer.AUTOWRAP_OFF
	word.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	cue.add_child(word)
	var chevron := Chevron.new()
	chevron.custom_minimum_size = Vector2(20, 16)
	chevron.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	cue.add_child(chevron)
	stage.add_child(cue)
	var natural := cue.get_combined_minimum_size()
	cue.position = Vector2((_vw - natural.x) * 0.5, _vh * 0.95 - natural.y)
	_cue = cue
	return section


func _centered(control: Control) -> Control:
	var box := CenterContainer.new()
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(control)
	return box


func _version_line() -> Control:
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", int(round(14.7 * 0.45 + 4)))
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var word := _text("Version", 14.7, GOLD, true, 600, 0.45, true)
	word.autowrap_mode = TextServer.AUTOWRAP_OFF
	line.add_child(word)
	var number := _text(str(release.get("version", "")), 14.7, GOLD, true, 600, 0.45, true)
	number.autowrap_mode = TextServer.AUTOWRAP_OFF
	number.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	line.add_child(number)
	return line


func _rule(wide: float) -> Control:
	var rule := GoldRule.new()
	rule.custom_minimum_size = Vector2(wide, 12)
	rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rule


func _intro() -> Control:
	var holder := MarginContainer.new()
	holder.add_theme_constant_override("margin_left", int(_vw * 0.08))
	holder.add_theme_constant_override("margin_right", int(_vw * 0.08))
	holder.add_theme_constant_override("margin_top", int(_vh * 0.16))
	holder.add_theme_constant_override("margin_bottom", int(_vh * 0.14))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	holder.add_child(column)
	var lead := _text(str(release.get("lead", "")), clampf(_vw * 0.026, 20.8, 33.6), INK, true, 500)
	lead.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lead.custom_minimum_size.x = minf(864.0, _vw * 0.84)
	_lined(lead, 1.35)
	column.add_child(_centered(_reveal(lead)))
	var space := Control.new()
	space.custom_minimum_size.y = _vh * 0.1
	column.add_child(space)
	var contents := VBoxContainer.new()
	contents.add_theme_constant_override("separation", 22)
	var wide := minf(1248.0, _vw * 0.84)
	contents.custom_minimum_size.x = wide
	var label := _text("Contents", 13.1, GOLD, true, 700, 0.32, true)
	contents.add_child(label)
	var grid := GridContainer.new()
	grid.columns = maxi(1, int(floor((wide + 16.0) / (240.0 + 16.0))))
	grid.add_theme_constant_override("h_separation", 16)
	grid.add_theme_constant_override("v_separation", 16)
	var chapters: Array = release.get("chapters", [])
	for index in range(chapters.size()):
		grid.add_child(_contents_item(chapters[index], index, (wide - 16.0 * (grid.columns - 1)) / grid.columns))
	contents.add_child(grid)
	column.add_child(_centered(_reveal(contents)))
	var section := _section(0)
	section.clip_contents = false
	section.add_child(holder)
	holder.resized.connect(func() -> void: section.custom_minimum_size.y = holder.size.y)
	holder.size.x = _vw
	return section


func _contents_item(chapter: Dictionary, index: int, wide: float) -> Control:
	var accent := Color(str(ACCENTS.get(str(chapter.get("scene", "")), "#d9a441")))
	var item := Clickable.new()
	item.custom_minimum_size.x = wide
	item.fill = Color("#0c1015")
	item.hover_fill = Color("#121820")
	item.line = Color(1, 1, 1, 0.08)
	item.accent = accent
	item.notch = 18.0
	var margin := MarginContainer.new()
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in [["margin_left", 19], ["margin_right", 19], ["margin_top", 20], ["margin_bottom", 21]]:
		margin.add_theme_constant_override(side[0], side[1])
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(_outlined(NUMERALS[index], 41.6, accent, 800, 1.5))
	column.add_child(_text(str(chapter.get("title", "")), 20, INK, true, 700, 0.04, true))
	column.add_child(_text(str(chapter.get("subtitle", "")), 13.8, FAINT))
	margin.add_child(column)
	item.add_child(margin)
	var key := str(chapter.get("key", ""))
	item.pressed.connect(func() -> void: go_to(key))
	item.set_meta("chapter", key)
	return item


func _chapter(chapter: Dictionary, index: int, _count: int) -> Control:
	var scene := str(chapter.get("scene", ""))
	var accent := Color(str(ACCENTS.get(scene, "#d9a441")))
	var highlights: Array = chapter.get("highlights", [])
	var height := _vh * 1.0 + highlights.size() * _vh * 0.95 + _vh * 0.18
	var section := _section(height)
	section.set_meta("chapter_index", index)
	section.set_meta("chapter_key", str(chapter.get("key", "")))
	var stage := _stage(section)
	if scene == "map":
		var water := ColorRect.new()
		water.color = Color("#081117")
		water.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		stage.add_child(water)
		var plane := _art("map-plane")
		plane.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		stage.add_child(plane)
		var globe := _art("map-globe")
		globe.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		var size_globe := clampf(_vw * 0.12, 90.0, 180.0)
		globe.set_anchors_preset(Control.PRESET_TOP_LEFT)
		globe.size = Vector2(size_globe, size_globe)
		globe.position = Vector2(_vw - minf(704.0, _vw * 0.48) - _vw * 0.03 - size_globe, _vh * 0.92 - size_globe)
		stage.add_child(globe)
	else:
		stage.add_child(_art(scene))
	var shade := Shade.new()
	var shade_wide := minf(704.0, _vw * 0.48)
	shade.position = Vector2(_vw - shade_wide, 0)
	shade.size = Vector2(shade_wide, _vh)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	stage.add_child(shade)
	var numeral_px := clampf(_vw * 0.22, 128.0, 320.0)
	var numeral := _outlined(NUMERALS[index], numeral_px, Color(1, 1, 1, 0.16), 900, 2.0)
	stage.add_child(numeral)
	numeral.position = Vector2(160, _vh * 0.97 - numeral_px)
	var passages := VBoxContainer.new()
	passages.add_theme_constant_override("separation", 0)
	passages.mouse_filter = Control.MOUSE_FILTER_IGNORE
	passages.size = Vector2(_vw, height)
	var title_block := VBoxContainer.new()
	title_block.add_theme_constant_override("separation", 0)
	var kicker := HBoxContainer.new()
	kicker.add_theme_constant_override("separation", 10)
	var kicker_word := _text("Chapter", 13.1, GOLD, true, 700, 0.32, true)
	kicker_word.autowrap_mode = TextServer.AUTOWRAP_OFF
	kicker.add_child(kicker_word)
	var kicker_number := _text(NUMERALS[index], 13.1, GOLD, true, 700, 0.32, true)
	kicker_number.autowrap_mode = TextServer.AUTOWRAP_OFF
	kicker_number.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	kicker.add_child(kicker_number)
	title_block.add_child(kicker)
	var title_size := clampf(_vw * 0.06, 41.6, 86.4)
	var above := Control.new()
	above.custom_minimum_size.y = title_size * 0.3
	title_block.add_child(above)
	var title := _text(str(chapter.get("title", "")), title_size, INK, true, 800, 0.01, true, 85)
	title.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 1))
	title.add_theme_constant_override("shadow_offset_y", 4)
	title.add_theme_constant_override("shadow_offset_x", 0)
	_lined(title, 0.92)
	title_block.add_child(title)
	var below := Control.new()
	below.custom_minimum_size.y = title_size * 0.25
	title_block.add_child(below)
	if not str(chapter.get("subtitle", "")).is_empty():
		title_block.add_child(_text(str(chapter["subtitle"]), 18.4, accent, true, 600, 0.12, true))
	var lead_gap := Control.new()
	lead_gap.custom_minimum_size.y = 17.6
	title_block.add_child(lead_gap)
	title_block.add_child(_lined(_text(str(chapter.get("lead", "")), 17.3, SOFT), 1.65))
	passages.add_child(_passage(title_block, _vh))
	for at in range(highlights.size()):
		var highlight: Dictionary = highlights[at]
		passages.add_child(_passage(_card(highlight, at, highlights.size(), accent), _vh * 0.95))
	section.add_child(passages)
	_chapters.append(section)
	return section


func _passage(content: Control, tall: float) -> Control:
	var holder := Control.new()
	holder.custom_minimum_size = Vector2(_vw, tall)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var wide := minf(544.0, _vw * 0.4)
	content.custom_minimum_size.x = wide
	holder.add_child(content)
	var place := func() -> void:
		if is_instance_valid(content):
			content.size = Vector2(wide, content.get_combined_minimum_size().y)
			content.position = Vector2(_vw - _vw * 0.05 - wide, (tall - content.size.y) * 0.5)
	place.call_deferred()
	content.minimum_size_changed.connect(place)
	_reveal(content)
	return holder


func _card(highlight: Dictionary, at: int, count: int, accent: Color) -> Control:
	var card := Notched.new()
	card.fill = Color(9 / 255.0, 12 / 255.0, 16 / 255.0, 0.9)
	card.line = Color(1, 1, 1, 0.1)
	card.accent = accent
	var margin := MarginContainer.new()
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in [["margin_left", 33], ["margin_right", 29], ["margin_top", 26], ["margin_bottom", 29]]:
		margin.add_theme_constant_override(side[0], side[1])
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var steps := _text("%s / %s" % [NUMERALS[at], NUMERALS[count - 1]], 12.8, accent, true, 700, 0.3)
	steps.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	column.add_child(steps)
	var heading_size := clampf(_vw * 0.026, 24.0, 33.6)
	var top := Control.new()
	top.custom_minimum_size.y = 6.4
	column.add_child(top)
	column.add_child(_text(str(highlight.get("heading", "")), heading_size, INK, true, 800, 0.02, true))
	var bottom := Control.new()
	bottom.custom_minimum_size.y = 8
	column.add_child(bottom)
	column.add_child(_lined(_text(str(highlight.get("text", "")), 16.3, SOFT), 1.6))
	margin.add_child(column)
	card.add_child(margin)
	return card


func _ledger(chapter: Dictionary) -> Control:
	var accent := Color(str(ACCENTS.get(str(chapter.get("scene", "")), "#d9a441")))
	var holder := MarginContainer.new()
	var left := _vw * 0.06 + 144.0
	holder.add_theme_constant_override("margin_left", int(left))
	holder.add_theme_constant_override("margin_right", int(_vw * 0.06))
	holder.add_theme_constant_override("margin_top", int(_vh * 0.12))
	holder.add_theme_constant_override("margin_bottom", int(_vh * 0.14))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	holder.add_child(column)
	var head := VBoxContainer.new()
	head.add_theme_constant_override("separation", 6)
	head.add_child(_text("Every change in this chapter", 13.1, accent, true, 700, 0.32, true))
	head.add_child(_text(str(chapter.get("title", "")), clampf(_vw * 0.04, 32.0, 51.2), INK, true, 800, 0.0, true))
	var rule := ColorRect.new()
	rule.color = accent
	rule.custom_minimum_size = Vector2(96, 3)
	rule.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	head.add_child(rule)
	column.add_child(_reveal(head))
	var gap := Control.new()
	gap.custom_minimum_size.y = 48
	column.add_child(gap)
	var wide := _vw - left - _vw * 0.06
	var count := maxi(1, mini(3, int(floor((wide + 48.0) / (304.0 + 48.0)))))
	var column_wide := (wide - 48.0 * (count - 1)) / count
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 48)
	var columns: Array = []
	for i in range(count):
		var lane := VBoxContainer.new()
		lane.add_theme_constant_override("separation", 35)
		lane.custom_minimum_size.x = column_wide
		lane.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		row.add_child(lane)
		columns.append(lane)
	var entries: Array = chapter.get("entries", [])
	var weights: Array = []
	var total := 0.0
	for entry in entries:
		var lines: Array = (entry as Dictionary).get("lines", [])
		var weight := 60.0
		for line in lines:
			weight += 26.0 + ceilf(str(line).length() * 7.4 / column_wide) * 22.3
		weights.append(weight)
		total += weight
	var lane_index := 0
	var filled := 0.0
	for i in range(entries.size()):
		if lane_index < count - 1 and filled > 0.0 and filled + weights[i] * 0.5 > total / count * (lane_index + 1):
			lane_index += 1
		filled += weights[i]
		(columns[lane_index] as VBoxContainer).add_child(_entry(entries[i], accent, column_wide))
	column.add_child(row)
	var section := _section(0, Color("#0a0d11"))
	section.clip_contents = false
	var line := ColorRect.new()
	line.color = Color(1, 1, 1, 0.06)
	line.size = Vector2(_vw, 1)
	section.add_child(holder)
	section.add_child(line)
	holder.size.x = _vw
	holder.resized.connect(func() -> void: section.custom_minimum_size.y = holder.size.y)
	return section


func _entry(entry: Dictionary, accent: Color, wide: float) -> Control:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	column.custom_minimum_size.x = wide
	var date := _text(str(entry.get("dateText", "")), 11.5, FAINT, false, 400, 0.16, true)
	date.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	column.add_child(date)
	var top := Control.new()
	top.custom_minimum_size.y = 4
	column.add_child(top)
	column.add_child(_text(str(entry.get("title", "")), 18.4, INK, true, 700, 0.03))
	var bottom := Control.new()
	bottom.custom_minimum_size.y = 8
	column.add_child(bottom)
	for line in entry.get("lines", []):
		var item := HBoxContainer.new()
		item.add_theme_constant_override("separation", 0)
		var bullet := Diamond.new()
		bullet.color = accent
		bullet.custom_minimum_size = Vector2(17.6, 0)
		bullet.size_flags_vertical = Control.SIZE_FILL
		item.add_child(bullet)
		var words := _lined(_text(str(line), 14.4, SOFT), 1.55)
		words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		words.custom_minimum_size.x = 1
		item.add_child(words)
		var gap := Control.new()
		gap.custom_minimum_size.y = 6.4
		column.add_child(gap)
		column.add_child(item)
	return column


func _finale() -> Control:
	var section := _section(_vh * 1.8)
	var stage := _stage(section)
	stage.add_child(_art("finale"))
	var copy := VBoxContainer.new()
	copy.add_theme_constant_override("separation", 22)
	copy.alignment = BoxContainer.ALIGNMENT_END
	copy.mouse_filter = Control.MOUSE_FILTER_PASS
	copy.add_child(_centered(_version_line()))
	var title := _text("The world is waiting", clampf(_vw * 0.06, 38.4, 80.0), INK, true, 800, 0.04, true)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 1))
	title.add_theme_constant_override("shadow_offset_y", 4)
	title.add_theme_constant_override("shadow_offset_x", 0)
	copy.add_child(title)
	var button := GoldButton.new()
	button.text = str(release.get("button", "")) if not str(release.get("button", "")).is_empty() else "Continue"
	button.label_font = font(true, 800)
	button.pressed.connect(close)
	copy.add_child(_centered(button))
	stage.add_child(copy)
	copy.size = Vector2(_vw, _vh * 0.88)
	copy.position = Vector2.ZERO
	_finale_copy = copy
	return section


func _build_hud() -> void:
	var hud := HBoxContainer.new()
	hud.add_theme_constant_override("separation", 16)
	hud.position = Vector2(19.2, 12.8)
	hud.size = Vector2(_vw - 38.4, 36.8)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var mark := HBoxContainer.new()
	mark.add_theme_constant_override("separation", 10)
	var logo := TextureRect.new()
	logo.texture = UI.logo()
	logo.custom_minimum_size = Vector2(30.4, 30.4)
	logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	logo.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	mark.add_child(logo)
	var version := _text(str(release.get("version", "")), 13.8, GOLD, true, 700, 0.24)
	version.autowrap_mode = TextServer.AUTOWRAP_OFF
	version.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	version.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	mark.add_child(version)
	hud.add_child(mark)
	_bar = Control.new()
	_bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_bar.custom_minimum_size.y = 2
	var track := ColorRect.new()
	track.color = Color(1, 1, 1, 0.12)
	track.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_bar.add_child(track)
	_bar_fill = ColorRect.new()
	_bar_fill.color = GOLD
	_bar_fill.size = Vector2(0, 2)
	_bar.add_child(_bar_fill)
	hud.add_child(_bar)
	var skip := Button.new()
	skip.text = "Skip"
	skip.focus_mode = Control.FOCUS_NONE
	skip.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	skip.custom_minimum_size.y = 36.8
	skip.add_theme_font_override("font", _spaced_font(font(true, 700), 3))
	skip.add_theme_font_size_override("font_size", 13)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		skip.add_theme_color_override(name, INK)
	var face := UI.box(Color(6 / 255.0, 8 / 255.0, 11 / 255.0, 0.7), Color(217 / 255.0, 164 / 255.0, 65 / 255.0, 0.6), 0, 1, Vector4(17.6, 0, 17.6, 0))
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
		skip.add_theme_stylebox_override(state, face)
	skip.text = skip.text.to_upper()
	skip.pressed.connect(close)
	hud.add_child(skip)
	add_child(hud)


static func _spaced_font(base: Font, spacing: int) -> Font:
	var variation := FontVariation.new()
	variation.base_font = base
	variation.spacing_glyph = spacing
	return variation


func _build_rail() -> void:
	if _vw < 760.0:
		return
	var rail := VBoxContainer.new()
	rail.add_theme_constant_override("separation", 6)
	var chapters: Array = release.get("chapters", [])
	for index in range(chapters.size()):
		var chapter: Dictionary = chapters[index]
		var item := RailItem.new()
		item.accent = Color(str(ACCENTS.get(str(chapter.get("scene", "")), "#d9a441")))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var number := _text(NUMERALS[index], 13.4, FAINT, true, 700, 0.1)
		number.autowrap_mode = TextServer.AUTOWRAP_OFF
		number.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		row.add_child(number)
		var title := _text(str(chapter.get("title", "")), 11.8, INK, true, 400, 0.12, true)
		title.autowrap_mode = TextServer.AUTOWRAP_OFF
		title.visible = false
		row.add_child(title)
		item.number = number
		item.title = title
		var margin := MarginContainer.new()
		margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
		for side in [["margin_left", 12], ["margin_right", 10], ["margin_top", 5], ["margin_bottom", 5]]:
			margin.add_theme_constant_override(side[0], side[1])
		margin.add_child(row)
		item.add_child(margin)
		var key := str(chapter.get("key", ""))
		item.pressed.connect(func() -> void: go_to(key))
		item.mouse_entered.connect(func() -> void: item.hovered = true)
		item.mouse_exited.connect(func() -> void: item.hovered = false)
		rail.add_child(item)
		_rail_items.append(item)
	add_child(rail)
	var natural := rail.get_combined_minimum_size()
	rail.position = Vector2(17.6, (_vh - natural.y) * 0.5)


func go_to(key: String) -> void:
	for section in _chapters:
		if is_instance_valid(section) and str(section.get_meta("chapter_key", "")) == key:
			var target := int(section.position.y)
			if still:
				_scroll.scroll_vertical = target
			else:
				create_tween().tween_property(_scroll, "scroll_vertical", target, 0.6).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
			return


func close() -> void:
	closed.emit()


func _unhandled_key_input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if key and key.pressed and key.keycode == KEY_ESCAPE:
		close()
		get_viewport().set_input_as_handled()


func _on_scroll() -> void:
	if not is_instance_valid(_scroll):
		return
	var top := float(_scroll.scroll_vertical)
	for pair in _stages:
		var section: Control = pair[0]
		var stage: Control = pair[1]
		if is_instance_valid(section) and is_instance_valid(stage):
			stage.position.y = clampf(top - section.position.y, 0.0, maxf(0.0, section.size.y - _vh))
	var total := maxf(1.0, _page.size.y - _vh)
	if is_instance_valid(_bar_fill):
		_bar_fill.size = Vector2(_bar.size.x * clampf(top / total, 0.0, 1.0), 2)
	if is_instance_valid(_hero_copy) and not still:
		var hero: Control = _stages[0][0]
		var p := clampf(top / maxf(1.0, hero.size.y - _vh), 0.0, 1.0)
		_hero_copy.modulate.a = clampf(1.0 - p * 1.8, 0.0, 1.0)
		_hero_copy.position.y = _vh * 0.24 - p * 140.0
		_cue.modulate.a = clampf(1.0 - p * 6.0, 0.0, 1.0)
	if is_instance_valid(_finale_copy):
		var finale: Control = _stages[_stages.size() - 1][0]
		var q := 1.0 if still else clampf((top - finale.position.y) / maxf(1.0, finale.size.y - _vh), 0.0, 1.0)
		_finale_copy.modulate.a = clampf(q * 2.2 - 0.3, 0.0, 1.0)
	var current := -1
	for section in _chapters:
		if is_instance_valid(section) and section.position.y <= top + _vh * 0.5:
			current = int(section.get_meta("chapter_index", -1))
	if current != _active:
		_active = current
		for index in range(_rail_items.size()):
			(_rail_items[index] as RailItem).active = index == current
	for control in _reveals.duplicate():
		if not is_instance_valid(control):
			_reveals.erase(control)
			continue
		var rect: Rect2 = control.get_global_rect()
		if rect.position.y < _vh - rect.size.y * 0.18 and rect.end.y > 0.0:
			_reveals.erase(control)
			var tween: Tween = control.create_tween()
			tween.tween_property(control, "modulate:a", 1.0, 0.7).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)


class GoldRule:
	extends Control

	func _draw() -> void:
		var middle := size.y * 0.5
		var gap := 16.0
		var diamond := 11.2
		var side := (size.x - diamond - gap * 2.0) * 0.5
		var faint := Color(217 / 255.0, 164 / 255.0, 65 / 255.0, 0.7)
		draw_rect(Rect2(0, middle - 1, side, 2), faint)
		draw_rect(Rect2(size.x - side, middle - 1, side, 2), faint)
		var centre := Vector2(size.x * 0.5, middle)
		var r := diamond * 0.7071
		draw_colored_polygon(PackedVector2Array([centre + Vector2(0, -r), centre + Vector2(r, 0), centre + Vector2(0, r), centre + Vector2(-r, 0)]), Color("#d9a441"))


class Chevron:
	extends Control

	func _draw() -> void:
		var c := Vector2(size.x * 0.5, size.y * 0.35)
		var s := 6.0
		draw_polyline(PackedVector2Array([c + Vector2(-s, -s * 0.5), c + Vector2(0, s * 0.5), c + Vector2(s, -s * 0.5)]), Color("#d9a441"), 2.0, true)


class Diamond:
	extends Control

	var color := Color.WHITE

	func _draw() -> void:
		var c := Vector2(2.9, 8.8 + 2.9)
		var r := 2.9 * 1.414
		draw_colored_polygon(PackedVector2Array([c + Vector2(0, -r), c + Vector2(r, 0), c + Vector2(0, r), c + Vector2(-r, 0)]), color)


class Shade:
	extends Control

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), Color(5 / 255.0, 7 / 255.0, 10 / 255.0, 0.62))
		draw_rect(Rect2(0, 0, 1, size.y), Color(217 / 255.0, 164 / 255.0, 65 / 255.0, 0.22))


class Notched:
	extends PanelContainer

	var fill := Color.BLACK
	var line := Color.WHITE
	var accent := Color.WHITE

	func _init() -> void:
		add_theme_stylebox_override("panel", StyleBoxEmpty.new())
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		var w := size.x
		var h := size.y
		var cut := 24.0
		var shape := PackedVector2Array([Vector2(0, 0), Vector2(w - cut, 0), Vector2(w, cut), Vector2(w, h), Vector2(cut, h), Vector2(0, h - cut)])
		draw_colored_polygon(shape, fill)
		var outline := shape.duplicate()
		outline.append(shape[0])
		draw_polyline(outline, line, 1.0)
		draw_rect(Rect2(0, 0, 4, h - cut), accent)


class Clickable:
	extends PanelContainer

	signal pressed

	var fill := Color.BLACK
	var hover_fill := Color.BLACK
	var line := Color.WHITE
	var accent := Color.WHITE
	var notch := 18.0
	var _over := false

	func _init() -> void:
		add_theme_stylebox_override("panel", StyleBoxEmpty.new())
		mouse_filter = Control.MOUSE_FILTER_STOP
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		mouse_entered.connect(func() -> void:
			_over = true
			queue_redraw())
		mouse_exited.connect(func() -> void:
			_over = false
			queue_redraw())

	func _gui_input(event: InputEvent) -> void:
		var click := event as InputEventMouseButton
		if click and click.button_index == MOUSE_BUTTON_LEFT and not click.pressed:
			pressed.emit()
			accept_event()

	func _draw() -> void:
		var w := size.x
		var h := size.y
		var shape := PackedVector2Array([Vector2(0, 0), Vector2(w, 0), Vector2(w, h - notch), Vector2(w - notch, h), Vector2(0, h)])
		draw_colored_polygon(shape, hover_fill if _over else fill)
		var outline := shape.duplicate()
		outline.append(shape[0])
		draw_polyline(outline, line, 1.0)
		draw_rect(Rect2(0, 0, w, 3), accent)


class GoldButton:
	extends Button

	var label_font: Font

	func _ready() -> void:
		focus_mode = Control.FOCUS_NONE
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		flat = true
		custom_minimum_size.y = 51.2
		text = text.to_upper()
		var spaced := FontVariation.new()
		spaced.base_font = label_font
		spaced.spacing_glyph = 4
		add_theme_font_override("font", spaced)
		add_theme_font_size_override("font_size", 17)
		for name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
			add_theme_color_override(name, Color("#14100a"))
		var pad := StyleBoxEmpty.new()
		pad.content_margin_left = 41.6
		pad.content_margin_right = 41.6
		for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
			add_theme_stylebox_override(state, pad)

	func _draw() -> void:
		var w := size.x
		var h := size.y
		draw_colored_polygon(PackedVector2Array([Vector2(14, 0), Vector2(w, 0), Vector2(w - 14, h), Vector2(0, h)]), Color("#d9a441"))


class RailItem:
	extends PanelContainer

	signal pressed

	var accent := Color.WHITE
	var number: Label
	var title: Label
	var active := false:
		set(value):
			active = value
			_apply()
	var hovered := false:
		set(value):
			hovered = value
			_apply()

	func _init() -> void:
		add_theme_stylebox_override("panel", StyleBoxEmpty.new())
		mouse_filter = Control.MOUSE_FILTER_STOP
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND

	func _apply() -> void:
		if is_instance_valid(number):
			number.add_theme_color_override("font_color", Color("#f2eee5") if active else Color(242 / 255.0, 238 / 255.0, 229 / 255.0, 0.42))
		if is_instance_valid(title):
			title.visible = active or hovered
		queue_redraw()

	func _gui_input(event: InputEvent) -> void:
		var click := event as InputEventMouseButton
		if click and click.button_index == MOUSE_BUTTON_LEFT and not click.pressed:
			pressed.emit()
			accept_event()

	func _draw() -> void:
		draw_rect(Rect2(0, 0, 2, size.y), accent if active else Color(1, 1, 1, 0.14))
