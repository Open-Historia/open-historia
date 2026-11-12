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
const GRAIN_KEYS := [Vector2(0, 0), Vector2(-6, 4), Vector2(5, -6), Vector2(-3, 7), Vector2(7, 2), Vector2(0, 0)]
const GRAIN_SHADER := """
shader_type canvas_item;
uniform sampler2D screen : hint_screen_texture, filter_nearest;
uniform sampler2D grain : filter_nearest, repeat_enable;
uniform vec2 origin;
varying vec2 spot;

void vertex() {
	spot = VERTEX;
}

void fragment() {
	vec4 speck = texture(grain, (spot - origin) / 160.0);
	vec3 below = texture(screen, SCREEN_UV).rgb;
	vec3 low = 2.0 * below * speck.rgb;
	vec3 high = 1.0 - 2.0 * (1.0 - below) * (1.0 - speck.rgb);
	vec3 blended = mix(low, high, step(0.5, below));
	COLOR = vec4(mix(below, blended, speck.a * 0.08), 1.0);
}
"""

static var _fonts := {}
static var _grain_tile: ImageTexture
static var _grain_shader: Shader

var still := false
var release := {}
var _scroll: ScrollContainer
var _page: VBoxContainer
var _stages: Array[Stage] = []
var _reveals: Array[Riser] = []
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
var _hud: Control
var _rail: Control
var _grain: ColorRect
var _chevron: Chevron
var _opened_at := 0
var _clock := 0.0
var _factor := 1.0
var _rise_curve: CubicBezier
var _ease_io: CubicBezier


class Stage:
	extends RefCounted

	var section: Control
	var holder: Control
	var view: ReleaseScene
	var kind := "chapter"
	var steps := 0
	var step := 0
	var progress := 0.0
	var numeral: Control
	var numeral_y := 0.0
	var shown := false


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var backdrop := ColorRect.new()
	backdrop.color = PAGE
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(backdrop)
	_rise_curve = CubicBezier.named("cubic-bezier(0.2, 0.8, 0.2, 1)")
	_ease_io = CubicBezier.named("ease-in-out")
	set_process(false)
	get_viewport().size_changed.connect(_on_viewport_resized)


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
	_opened_at = Time.get_ticks_msec()
	_factor = _scale_factor()
	_build()
	set_process(true)
	if not still:
		modulate.a = 0.0
		create_tween().tween_method(func(t: float) -> void: modulate.a = _rise_curve.at(t), 0.0, 1.0, 0.6)


func _scale_factor() -> float:
	return float(get_tree().root.content_scale_factor) if is_inside_tree() else 1.0


func is_settled() -> bool:
	for item in _stages:
		if item.shown and not item.view.is_ready():
			return false
	return true


func scenes_in_view() -> Array:
	var found: Array = []
	for item in _stages:
		if item.shown:
			found.append(item.view)
	return found


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


func _view(key: String) -> ReleaseScene:
	var view := ReleaseScene.new()
	view.setup(key, still)
	view.size = Vector2(_vw, _vh)
	return view


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


func _stage(section: Control, key: String, kind := "chapter", steps := 0) -> Stage:
	var holder := Control.new()
	holder.size = Vector2(_vw, _vh)
	holder.clip_contents = true
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	section.add_child(holder)
	var item := Stage.new()
	item.section = section
	item.holder = holder
	item.kind = kind
	item.steps = steps
	item.progress = 0.0 if kind == "hero" or not still else 1.0
	item.view = _view(key)
	holder.add_child(item.view)
	_stages.append(item)
	return item


func _reveal(control: Control) -> Control:
	if still:
		return control
	var riser := Riser.new()
	riser.add_child(control)
	riser.modulate.a = 0.0
	riser.rise = 42.0
	_reveals.append(riser)
	return riser


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
	_build_grain()
	_scroll.get_v_scroll_bar().value_changed.connect(func(_value: float) -> void: _on_scroll())
	_page.resized.connect(func() -> void: _on_scroll.call_deferred())
	_on_scroll.call_deferred()


func _hero() -> Control:
	var section := _section(_vh * 2.1)
	var stage := _stage(section, "hero", "hero").holder
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
	_chevron = chevron
	chevron.custom_minimum_size = Vector2(20, 22)
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
	var item := _stage(section, scene, "chapter", highlights.size() + 1)
	var stage := item.holder
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
	item.numeral = numeral
	item.numeral_y = numeral.position.y
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
	var shown := _reveal(content)
	holder.add_child(shown)
	var place := func() -> void:
		if is_instance_valid(shown):
			shown.size = Vector2(wide, shown.get_combined_minimum_size().y)
			shown.position = Vector2(_vw - _vw * 0.05 - wide, (tall - shown.size.y) * 0.5)
	place.call_deferred()
	shown.minimum_size_changed.connect(place)
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
	var stage := _stage(section, "finale", "finale").holder
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
	_hud = hud


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
	_rail = rail
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


func _build_grain() -> void:
	if _grain_shader == null:
		_grain_shader = Shader.new()
		_grain_shader.code = GRAIN_SHADER
	if _grain_tile == null:
		var image := Image.create_empty(160, 160, false, Image.FORMAT_RGBA8)
		var dice := RandomNumberGenerator.new()
		dice.randomize()
		for at in range(2600):
			var shade := 1.0 if dice.randf() > 0.5 else 0.0
			image.set_pixel(dice.randi_range(0, 159), dice.randi_range(0, 159), Color(shade, shade, shade, snappedf(dice.randf() * 0.5, 0.01)))
		_grain_tile = ImageTexture.create_from_image(image)
	_grain = ColorRect.new()
	_grain.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_grain.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var material := ShaderMaterial.new()
	material.shader = _grain_shader
	material.set_shader_parameter("grain", _grain_tile)
	material.set_shader_parameter("origin", Vector2(-_vw * 0.5, -_vh * 0.5))
	_grain.material = material
	add_child(_grain)


func _on_viewport_resized() -> void:
	if release.is_empty() or not is_instance_valid(_scroll):
		return
	var now := get_viewport_rect().size
	if absf(now.x - _vw) >= 2.0 or absf(now.y - _vh) >= 2.0:
		_relayout.call_deferred()


func _relayout() -> void:
	var now := get_viewport_rect().size
	if not is_instance_valid(_scroll) or (absf(now.x - _vw) < 2.0 and absf(now.y - _vh) < 2.0):
		return
	var bar := _scroll.get_v_scroll_bar()
	var fraction := float(_scroll.scroll_vertical) / maxf(1.0, bar.max_value - bar.page)
	for node in [_scroll, _hud, _rail, _grain]:
		if node != null and is_instance_valid(node):
			remove_child(node)
			node.queue_free()
	_stages.clear()
	_reveals.clear()
	_chapters.clear()
	_rail_items.clear()
	_rail = null
	_active = -1
	_vw = maxf(320.0, now.x)
	_vh = maxf(320.0, now.y)
	_build()
	await get_tree().process_frame
	await get_tree().process_frame
	if is_instance_valid(_scroll):
		bar = _scroll.get_v_scroll_bar()
		_scroll.scroll_vertical = int(fraction * maxf(0.0, bar.max_value - bar.page))


func _process(_delta: float) -> void:
	var factor := _scale_factor()
	if not is_equal_approx(factor, _factor):
		_factor = factor
		_on_scroll()
	if still:
		return
	_clock = (Time.get_ticks_msec() - _opened_at) / 1000.0
	for item in _stages:
		if item.shown:
			item.view.advance(item.progress, _clock, item.step)
	if is_instance_valid(_chevron) and is_instance_valid(_cue) and _cue.modulate.a > 0.0:
		var u := fmod(_clock, 1.8) / 1.8
		_chevron.bob = 6.0 * _ease_io.at(u / 0.5) if u < 0.5 else 6.0 * (1.0 - _ease_io.at((u - 0.5) / 0.5))
	if is_instance_valid(_grain):
		var at := fmod(_clock, 1.2) / 1.2 * 5.0
		var part := mini(int(at), 4)
		var f := floorf((at - part) * 6.0) / 6.0
		var shift: Vector2 = (GRAIN_KEYS[part] as Vector2).lerp(GRAIN_KEYS[part + 1], f) * Vector2(_vw * 2.0, _vh * 2.0) / 100.0
		(_grain.material as ShaderMaterial).set_shader_parameter("origin", Vector2(-_vw * 0.5, -_vh * 0.5) + shift)


func _on_scroll() -> void:
	if not is_instance_valid(_scroll):
		return
	var top := float(_scroll.scroll_vertical)
	for item in _stages:
		var section := item.section
		if not is_instance_valid(section):
			continue
		var raw := clampf((top - section.position.y) / maxf(1.0, section.size.y - _vh), 0.0, 1.0)
		item.holder.position.y = clampf(top - section.position.y, 0.0, maxf(0.0, section.size.y - _vh))
		item.shown = section.position.y < top + _vh and section.position.y + section.size.y > top
		item.holder.visible = item.shown
		if still:
			item.progress = 0.0 if item.kind == "hero" else 1.0
		else:
			item.progress = raw
		if item.steps > 0:
			item.step = mini(item.steps - 1, int(floorf(raw * item.steps)))
		if item.numeral:
			item.numeral.position.y = item.numeral_y - 60.0 * item.progress
		if section.position.y < top + _vh * 2.0 and section.position.y + section.size.y > top - _vh:
			item.view.prepare(_factor)
		if item.shown:
			item.view.advance(item.progress, _clock, item.step)
	var total := maxf(1.0, _page.size.y - _vh)
	if is_instance_valid(_bar_fill):
		_bar_fill.size = Vector2(_bar.size.x * clampf(top / total, 0.0, 1.0), 2)
	if not _stages.is_empty():
		var hero_p := _stages[0].progress
		if is_instance_valid(_hero_copy):
			_hero_copy.modulate.a = clampf(1.0 - hero_p * 1.8, 0.0, 1.0)
			_hero_copy.position.y = _vh * 0.24 - hero_p * 140.0
			_hero_copy.pivot_offset = _hero_copy.size * 0.5
			_hero_copy.scale = Vector2.ONE * (1.0 + hero_p * 0.06)
		if is_instance_valid(_cue):
			_cue.modulate.a = clampf(1.0 - hero_p * 6.0, 0.0, 1.0)
		if is_instance_valid(_finale_copy):
			_finale_copy.modulate.a = clampf(_stages[_stages.size() - 1].progress * 2.2 - 0.3, 0.0, 1.0)
	var current := -1
	for section in _chapters:
		if is_instance_valid(section) and section.position.y <= top + _vh * 0.5:
			current = int(section.get_meta("chapter_index", -1))
	if current != _active:
		_active = current
		for index in range(_rail_items.size()):
			(_rail_items[index] as RailItem).active = index == current
	if _page.size.y < _vh * 3.0:
		return
	var index := _reveals.size() - 1
	while index >= 0:
		var riser := _reveals[index]
		if not is_instance_valid(riser):
			_reveals.remove_at(index)
		else:
			var rect := Rect2(riser.global_position - _page.global_position - Vector2(0.0, top), riser.size)
			var seen := minf(rect.end.y, _vh) - maxf(rect.position.y, 0.0)
			if rect.size.y > 0.0 and seen >= rect.size.y * 0.18:
				_reveals.remove_at(index)
				_rise(riser)
		index -= 1


func _rise(riser: Riser) -> void:
	var curve := _rise_curve
	riser.create_tween().tween_method(func(t: float) -> void:
		var k := curve.at(t)
		riser.modulate.a = k
		riser.rise = 42.0 * (1.0 - k), 0.0, 1.0, 0.7)

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

	var bob := 0.0:
		set(value):
			if not is_equal_approx(bob, value):
				bob = value
				queue_redraw()

	func _draw() -> void:
		var c := Vector2(size.x * 0.5, size.y * 0.35 - 3.0 + bob)
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
		custom_minimum_size.y = 51.2
		text = text.to_upper()
		var spaced := FontVariation.new()
		spaced.base_font = label_font
		spaced.spacing_glyph = 4
		add_theme_font_override("font", spaced)
		add_theme_font_size_override("font_size", 17)
		for name in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
			add_theme_color_override(name, Color("#14100a"))
		var pad := Slant.new()
		pad.content_margin_left = 41.6
		pad.content_margin_right = 41.6
		for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
			add_theme_stylebox_override(state, pad)


class Slant:
	extends StyleBox

	func _draw(to_canvas_item: RID, area: Rect2) -> void:
		var at := area.position
		var w := area.size.x
		var h := area.size.y
		RenderingServer.canvas_item_add_polygon(to_canvas_item, PackedVector2Array([at + Vector2(14, 0), at + Vector2(w, 0), at + Vector2(w - 14, h), at + Vector2(0, h)]), PackedColorArray([Color("#d9a441")]))


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


class Riser:
	extends Container

	var rise := 0.0:
		set(value):
			rise = value
			queue_sort()

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _notification(what: int) -> void:
		if what == NOTIFICATION_SORT_CHILDREN:
			for child in get_children():
				if child is Control:
					fit_child_in_rect(child as Control, Rect2(Vector2(0.0, rise), size))

	func _get_minimum_size() -> Vector2:
		var least := Vector2.ZERO
		for child in get_children():
			if child is Control and (child as Control).visible:
				least = least.max((child as Control).get_combined_minimum_size())
		return least
