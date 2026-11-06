extends RefCounted

const GROUND := Color("#121418")
const CARD := "#1a1d23"
const OCHRE := Color("#E8B04B")
const INK := Color("#f3f1ec")
const SOFT := Color(243 / 255.0, 241 / 255.0, 236 / 255.0, 0.72)
const FAINT := Color(243 / 255.0, 241 / 255.0, 236 / 255.0, 0.3)
const FACE := "\"Segoe UI\", \"Helvetica Neue\", Arial, system-ui, sans-serif"
const PALETTES := [
	{"name": "Default (Original)", "background": "#131315", "surface": "#232327", "accent": "#D4D4D8"},
	{"name": "Midnight Navy", "background": "#111D2A", "surface": "#20364A", "accent": "#85CBE6"},
	{"name": "Graphite", "background": "#15171B", "surface": "#30343B", "accent": "#BAC6D2"},
	{"name": "Forest", "background": "#121E19", "surface": "#283C32", "accent": "#78C8A1"},
	{"name": "Oxblood", "background": "#21171B", "surface": "#3D2830", "accent": "#DA929E"},
	{"name": "Sepia", "background": "#241F19", "surface": "#403528", "accent": "#D6B77D"},
]
const TURN_SECONDS := 2.4
const LINE := "rgba(243,241,236,0.14)"
const BAR := "rgba(243,241,236,0.22)"
const HELLO_SPOTS := [[150, 44], [250, 84], [52, 92], [232, 166], [80, 168], [150, 196], [262, 126], [40, 132], [150, 120]]
const HELLOS := ["Hello", "Hola", "Bonjour", "Hallo", "你好", "مرحبا", "Olá", "Привет", "こんにちは"]


static func px(value: float) -> float:
	return UpdateKit.px(value)


static func accent() -> Color:
	return UiTheme.pick("accent", OCHRE)


static func hex(colour: Color) -> String:
	return "#" + colour.to_html(false)


static func chrome() -> Dictionary:
	var tint := accent()
	return {
		"button": {"bg": tint, "border": tint, "radius": 999.0, "ink": Color("#14110b"), "font": FACE, "weight": 800, "spacing": 0.01},
		"arrow": {"bg": Color(243 / 255.0, 241 / 255.0, 236 / 255.0, 0.06), "border": tint, "ink": tint},
		"dot": {"on": tint, "off": Color(243 / 255.0, 241 / 255.0, 236 / 255.0, 0.26)},
		"skip": {"ink": SOFT, "font": FACE, "spacing": 0.01},
	}


static func _blade(palette: Dictionary, angle: float) -> String:
	return "<g transform='rotate(%s 0 0)'><rect fill='%s' height='150' rx='9' stroke='rgba(243,241,236,0.22)' width='40' x='-20' y='-160'/><rect fill='%s' height='44' rx='4' width='30' x='-15' y='-152'/><rect fill='%s' height='28' rx='4' width='30' x='-15' y='-102'/><rect fill='rgba(243,241,236,0.3)' height='3' rx='1.5' width='22' x='-11' y='-64'/><rect fill='rgba(243,241,236,0.18)' height='3' rx='1.5' width='14' x='-11' y='-56'/></g>" % [angle, palette["background"], palette["surface"], palette["accent"]]


static func _window(palette: Dictionary) -> String:
	var parts: PackedStringArray = []
	parts.append("<rect fill='%s' height='168' rx='12' stroke='%s' width='300'/>" % [palette["background"], LINE])
	parts.append("<rect fill='%s' height='152' rx='8' width='48' x='8' y='8'/>" % palette["surface"])
	for at in range(4):
		parts.append("<rect fill='%s' height='22' rx='6' width='32' x='16' y='%d'/>" % [palette["accent"] if at == 0 else "rgba(243,241,236,0.14)", 20 + at * 32])
	parts.append("<rect fill='%s' height='22' rx='6' width='228' x='64' y='8'/>" % palette["surface"])
	parts.append("<rect fill='rgba(243,241,236,0.75)' height='6' rx='3' width='70' x='74' y='16'/>")
	for at in range(2):
		parts.append("<g transform='translate(%d 38)'><rect fill='%s' height='88' rx='8' width='110'/><rect fill='%s' height='34' rx='5' width='98' x='6' y='6'/><rect fill='rgba(243,241,236,0.7)' height='5' rx='2.5' width='60' x='8' y='50'/><rect fill='%s' height='4' rx='2' width='84' x='8' y='62'/><rect fill='%s' height='4' rx='2' width='50' x='8' y='72'/></g>" % [64 + at * 118, palette["surface"], palette["background"], BAR, BAR])
	parts.append("<rect fill='%s' height='22' rx='11' width='96' x='196' y='136'/>" % palette["accent"])
	parts.append("<rect fill='%s' height='5' rx='2.5' width='52' x='218' y='144.5'/>" % palette["background"])
	return "".join(parts)


static func palettes_svg(at: int, narrow: bool) -> String:
	var parts: PackedStringArray = []
	parts.append("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 220'><rect fill='%s' height='220' width='800'/>" % hex(GROUND))
	var spots := [[60, 40, 5], [740, 30, 4], [700, 190, 6], [300, 200, 3], [520, 26, 3]]
	for index in range(spots.size()):
		var spot: Array = spots[index]
		parts.append("<circle cx='%d' cy='%d' fill='%s' opacity='0.5' r='%d'/>" % [spot[0], spot[1], PALETTES[(index % 5) + 1]["accent"], spot[2]])
	parts.append("<g transform='%s'>" % ("translate(250 196) scale(0.8)" if narrow else "translate(180 196)"))
	for index in range(PALETTES.size()):
		parts.append(_blade(PALETTES[index], -62.0 + index * 24.0))
	parts.append("<circle fill='%s' r='9' stroke='rgba(243,241,236,0.5)' stroke-width='1.5'/><circle fill='rgba(243,241,236,0.6)' r='3'/></g>" % CARD)
	var palette: Dictionary = PALETTES[at]
	parts.append("<g transform='%s'>" % ("translate(345 40) scale(0.8)" if narrow else "translate(355 20) scale(0.95)"))
	parts.append(_window(palette))
	parts.append("<path d='M6 186 C 60 176, 120 194, 180 184 S 260 176, 296 186' fill='none' stroke='%s' stroke-linecap='round' stroke-width='7'/></g></svg>" % palette["accent"])
	return "".join(parts)


static func welcome_svg(narrow: bool) -> String:
	var tint := hex(accent())
	var parts: PackedStringArray = []
	parts.append("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 220'><rect fill='%s' height='220' width='800'/>" % hex(GROUND))
	parts.append("<g transform='translate(%d 0)'><g transform='translate(150 118)'><circle fill='none' r='84' stroke='rgba(243,241,236,0.3)' stroke-width='1.4'/>" % (120 if narrow else 40))
	for tilt in [-60, -25, 0, 25, 60]:
		parts.append("<ellipse fill='none' rx='%s' ry='84' stroke='rgba(243,241,236,0.16)'/>" % maxf(1.0, absf(cos(deg_to_rad(float(tilt)))) * 84.0))
	parts.append("</g></g>")
	if not narrow:
		parts.append("<g transform='translate(380 20) scale(0.8)'><rect fill='%s' height='150' rx='12' stroke='%s' width='170'/>" % [CARD, LINE])
		for row in range(4):
			var picked := row == 1
			parts.append("<g transform='translate(12 %d)'><rect fill='%s' height='26' rx='6' stroke='%s' stroke-width='%s' width='146'/><rect fill='rgba(243,241,236,0.7)' height='5' rx='2.5' width='%d' x='10' y='8'/><rect fill='%s' height='3.5' rx='1.7' width='34' x='10' y='17'/>%s</g>" % [14 + row * 32, "rgba(243,241,236,0.08)" if picked else "rgba(243,241,236,0.03)", tint if picked else LINE, "1.6" if picked else "1", 50 + (row % 2) * 22, BAR, ("<path d='M124 13 l5 5 l9 -10' fill='none' stroke='%s' stroke-linecap='round' stroke-linejoin='round' stroke-width='2.4'/>" % tint) if picked else ""])
		parts.append("<g transform='translate(186 0)'><rect fill='%s' height='150' rx='12' stroke='%s' width='150'/>" % [CARD, LINE])
		for index in range(6):
			var item: Dictionary = PALETTES[index]
			parts.append("<g transform='translate(%d %d)'><rect fill='%s' height='38' rx='6' stroke='%s' stroke-width='%s' width='60'/><rect fill='%s' height='16' rx='3' width='20' x='5' y='5'/><rect fill='%s' height='7' rx='3' width='24' x='31' y='26'/></g>" % [12 + (index % 2) * 66, 12 + (index / 2) * 44, item["background"], item["accent"] if index == 3 else LINE, "2" if index == 3 else "1", item["surface"], item["accent"]])
		parts.append("</g></g>")
	parts.append("<g transform='%s'><rect fill='%s' height='40' rx='10' stroke='%s' width='170'/><rect fill='rgba(243,241,236,0.7)' height='5' rx='2.5' width='100' x='14' y='17.5'/><rect fill='none' height='12' rx='4' stroke='rgba(243,241,236,0.72)' stroke-width='1.6' width='8' x='141' y='11'/><path d='M137 21 a8 8 0 0 0 16 0 M145 29 v4' fill='none' stroke='rgba(243,241,236,0.72)' stroke-linecap='round' stroke-width='1.6'/><rect fill='%s' height='40' rx='10' width='40' x='178'/><path d='M198 28 V12 m-7 7 7 -7 7 7' fill='none' stroke='#14110b' stroke-linecap='round' stroke-linejoin='round' stroke-width='2.2'/></g></svg>" % ["translate(390 150) scale(0.85)" if narrow else "translate(410 152) scale(0.85)", CARD, LINE, tint])
	return "".join(parts)


class Art extends Control:
	var welcome := false
	var narrow := false
	var still := false
	var at := 1
	var held := false
	var _cache := {}
	var _timer: Timer
	var _words: Array[Label] = []
	var render_svg: Callable

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_PASS
		clip_contents = true

	func _ready() -> void:
		resized.connect(queue_redraw)
		if welcome:
			_place_words()
		elif not still:
			_timer = Timer.new()
			_timer.wait_time = TURN_SECONDS
			_timer.timeout.connect(func() -> void:
				if held:
					return
				at = (at + 1) % PALETTES.size()
				queue_redraw())
			add_child(_timer)
			_timer.start()

	func pick(index: int) -> void:
		at = index
		held = true
		queue_redraw()

	func _texture() -> Texture2D:
		var scale_by := maxf(size.x / 800.0, size.y / 220.0)
		var key := "%s:%d:%d" % [welcome, at, int(scale_by * 100.0)]
		if _cache.has(key):
			return _cache[key]
		var source: String = render_svg.call(welcome, at, narrow)
		var texture := DPITexture.create_from_string(source, scale_by * maxf(1.0, get_tree().root.content_scale_factor if get_tree() else 1.0))
		_cache[key] = texture
		return texture

	func _draw() -> void:
		if size.x < 2.0 or size.y < 2.0:
			return
		var texture := _texture()
		if texture == null:
			return
		var scale_by := maxf(size.x / 800.0, size.y / 220.0)
		var drawn := Vector2(800.0, 220.0) * scale_by
		draw_texture_rect(texture, Rect2((size - drawn) * 0.5, drawn), false)

	func _place_words() -> void:
		for index in range(HELLO_SPOTS.size()):
			var word := Label.new()
			word.text = HELLOS[index]
			word.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
			word.mouse_filter = Control.MOUSE_FILTER_IGNORE
			word.add_theme_font_override("font", UpdateKit.font(FACE, 800))
			word.add_theme_color_override("font_color", INK)
			word.set_meta("spot", index)
			add_child(word)
			_words.append(word)
			if still:
				word.modulate.a = 0.9 if index < 5 else 0.0
			else:
				word.modulate.a = 0.0
				var tween := word.create_tween().set_loops()
				tween.tween_interval(index * 0.5)
				tween.tween_property(word, "modulate:a", 1.0, 0.675)
				tween.tween_interval(2.475)
				tween.tween_property(word, "modulate:a", 0.0, 1.35)
				tween.tween_interval(maxf(0.0, (HELLO_SPOTS.size() - 1) * 0.5 - index * 0.5))
		resized.connect(_lay_words)
		_lay_words.call_deferred()

	func _lay_words() -> void:
		var scale_by := maxf(size.x / 800.0, size.y / 220.0)
		var origin := (size - Vector2(800.0, 220.0) * scale_by) * 0.5
		for word in _words:
			var index := int(word.get_meta("spot"))
			var spot: Array = HELLO_SPOTS[index]
			var font_px := (26.0 if index == 0 else 16.0) * scale_by
			word.add_theme_font_size_override("font_size", int(round(font_px)))
			var natural := word.get_combined_minimum_size()
			var centre := origin + Vector2(float(spot[0]) + (120.0 if narrow else 40.0), float(spot[1])) * scale_by
			word.position = Vector2(centre.x - natural.x * 0.5, centre.y - natural.y * 0.78)


static func _chips(art: Art) -> Control:
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", int(round(px(0.4))))
	grid.add_theme_constant_override("v_separation", int(round(px(0.4))))
	var chips: Array[Button] = []
	for index in range(PALETTES.size()):
		var item: Dictionary = PALETTES[index]
		var chip := Button.new()
		chip.focus_mode = Control.FOCUS_NONE
		chip.custom_minimum_size = Vector2(px(1.6), px(1.6))
		chip.tooltip_text = str(item["name"])
		chip.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		chip.set_meta("palette", index)
		chip.draw.connect(func() -> void:
			var r := chip.size.x * 0.5
			var centre := chip.size * 0.5
			chip.draw_circle(centre, r, Color(str(item["background"])))
			var points := PackedVector2Array()
			for step in range(33):
				var a := -PI * 0.5 + PI * float(step) / 32.0
				points.append(centre + Vector2(cos(a), sin(a)) * (r - 2.0))
			var left := PackedVector2Array()
			var right := PackedVector2Array()
			for step in range(17):
				var a := PI * 0.5 + PI * float(step) / 16.0
				left.append(centre + Vector2(cos(a), sin(a)) * (r - 2.0))
				right.append(centre + Vector2(cos(-PI * 0.5 + PI * float(step) / 16.0), sin(-PI * 0.5 + PI * float(step) / 16.0)) * (r - 2.0))
			chip.draw_colored_polygon(left, Color(str(item["surface"])))
			chip.draw_colored_polygon(right, Color(str(item["accent"])))
			chip.draw_arc(centre, r - 1.0, 0.0, TAU, 48, Color(str(item["accent"])) if art.at == index else Color(243 / 255.0, 241 / 255.0, 236 / 255.0, 0.25), 2.0, true))
		var flat := StyleBoxEmpty.new()
		for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			chip.add_theme_stylebox_override(state, flat)
		chip.pressed.connect(func() -> void:
			art.pick(index)
			for other in chips:
				other.queue_redraw())
		chips.append(chip)
		grid.add_child(chip)
	return grid


static func solid(svg: String) -> String:
	var pattern := RegEx.create_from_string("(fill|stroke)='rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)'")
	var out := ""
	var from := 0
	for found in pattern.search_all(svg):
		var colour := Color8(found.get_string(2).to_int(), found.get_string(3).to_int(), found.get_string(4).to_int())
		out += svg.substr(from, found.get_start() - from)
		out += "%s='#%s' %s-opacity='%s'" % [found.get_string(1), colour.to_html(false), found.get_string(1), found.get_string(5)]
		from = found.get_end()
	return out + svg.substr(from)


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var narrow: bool = ctx.get("narrow", false)
	var width: float = ctx.get("width", 1440.0)
	var tint := accent()
	var welcome := str(banner.get("scene", "")) == "welcome"
	var plate := UpdateKit.plate({"background": GROUND, "border": Color(243 / 255.0, 241 / 255.0, 236 / 255.0, 0.16), "radius": 14.0}, still)
	UpdateKit.brackets(plate, tint, px(0.7), px(1.4), 1.5, true)
	var column := UpdateKit.vbox(0)
	var holder := UpdateKit.frame(px(10.5) if narrow else ShellFonts.clamp_vw(11.5, 24.0, 15.0, width), 2.0, tint, GROUND)
	var area := Control.new()
	area.mouse_filter = Control.MOUSE_FILTER_PASS
	var art := Art.new()
	art.welcome = welcome
	art.narrow = narrow
	art.still = still
	art.render_svg = func(is_welcome: bool, index: int, small: bool) -> String: return solid(welcome_svg(small) if is_welcome else palettes_svg(index, small))
	art.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	area.add_child(art)
	if not welcome and not narrow:
		var chips := _chips(art)
		chips.anchor_left = 1.0
		chips.anchor_right = 1.0
		chips.anchor_top = 0.5
		chips.anchor_bottom = 0.5
		chips.grow_horizontal = Control.GROW_DIRECTION_BEGIN
		chips.grow_vertical = Control.GROW_DIRECTION_BOTH
		chips.offset_right = -px(1.4)
		area.add_child(chips)
	holder.add_child(area)
	column.add_child(UpdateKit.reveal(holder, 150.0, still))
	var body := UpdateKit.vbox(0)
	var head_row := UpdateKit.hbox(roundi(px(0.75) if narrow else px(1.0)))
	head_row.alignment = BoxContainer.ALIGNMENT_BEGIN
	var mark := UpdateKit.icon_rect("people" if welcome else "palette", 36 if narrow else 46, tint)
	head_row.add_child(mark)
	var head := UpdateKit.vbox(0)
	head.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var line: Array[Dictionary] = [UpdateKit.run(UpdateKit.major_line(update), px(0.78), tint, FACE, 700, false, 0.16, true)]
	head.add_child(UpdateKit.runs(line))
	head.add_child(UpdateKit.gap(px(0.15)))
	head.add_child(UpdateKit.para(str(banner.get("title", "")), px(2.0) if narrow else ShellFonts.clamp_vw(2.2, 5.5, 3.1, width), INK, FACE, 900, false, 1.04, -0.01))
	if not str(banner.get("subtitle", "")).is_empty():
		head.add_child(UpdateKit.gap(px(0.25)))
		head.add_child(UpdateKit.text(str(banner.get("subtitle", "")), px(1.02), SOFT, FACE, 400))
	head_row.add_child(head)
	body.add_child(UpdateKit.reveal(head_row, 300.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(0.9)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(0.98), SOFT, FACE, 400, false, 1.6), 420.0, still))
	body.add_child(UpdateKit.rule(FAINT, UpdateKit.icon_rect("palette", 18, tint)))
	body.add_child(UpdateKit.feature_cards(banner.get("sections", []), tint, SOFT, {"background": Color(243 / 255.0, 241 / 255.0, 236 / 255.0, 0.035), "border": Color(243 / 255.0, 241 / 255.0, 236 / 255.0, 0.14), "radius": 12.0}, FACE, false, 520.0, still))
	if narrow:
		column.add_child(UpdateKit.margins(body, px(1.1), px(1.1), px(1.1), px(1.3)))
	else:
		column.add_child(UpdateKit.margins(body, px(2.0), px(1.4), px(2.0), px(1.7)))
	plate.add_child(column)
	return UpdateKit.plate_reveal(plate, still)
