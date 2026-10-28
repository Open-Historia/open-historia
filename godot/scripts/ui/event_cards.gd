class_name EventCards
extends RefCounted

const LINK_GLYPHS := {"polity": "⚑", "region": "⌖", "city": "●", "unit": "⛊", "structure": "▣", "sea": "≈"}
const GHOST_BG := Color(1, 1, 1, 0.04)
const GHOST_BORDER := Color(1, 1, 1, 0.08)
const GHOST_INK := Color(1, 1, 1, 0.84)
const EXTRA_ICONS := {
	"calendar": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M8 2v4'/><path d='M16 2v4'/><rect x='3' y='4' width='18' height='18' rx='2'/><path d='M3 10h18'/></svg>",
	"map": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z'/><path d='M9 3v15'/><path d='M15 6v15'/></svg>",
	"chevron": "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>",
}

static var _icons := {}


static func icon(name: String, size: int, color: Color) -> Texture2D:
	var key := "%s:%d:%s" % [name, size, color.to_html()]
	if _icons.has(key):
		return _icons[key]
	var svg: String = EXTRA_ICONS.get(name, "")
	if svg.is_empty():
		return UI.icon(name, size, color)
	svg = svg.replace("#fff", "#" + color.to_html(false))
	var image := Image.new()
	if image.load_svg_from_string(svg, float(size) / 24.0) != OK:
		return null
	if color.a < 1.0:
		image.convert(Image.FORMAT_RGBA8)
		for y in range(image.get_height()):
			for x in range(image.get_width()):
				var pixel := image.get_pixel(x, y)
				pixel.a *= color.a
				image.set_pixel(x, y, pixel)
	var texture := ImageTexture.create_from_image(image)
	_icons[key] = texture
	return texture


static func frame(bg: Color, border: Color, radius: int, margins := Vector4(0, 0, 0, 0), border_width := 1) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(bg, border, radius, border_width, margins))
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	holder.mouse_filter = Control.MOUSE_FILTER_PASS
	return holder


static func column(separation := 0) -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", separation)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return box


static func flow(separation := 6) -> HFlowContainer:
	var box := HFlowContainer.new()
	box.add_theme_constant_override("h_separation", separation)
	box.add_theme_constant_override("v_separation", separation)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return box


static func text(value: String, size: float, color: Color, weight := 400, spacing := 0) -> Label:
	var node := UI.label(value, int(round(size)), color, weight, "Arial", spacing)
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func button(value: String, bg: Color, border: Color, ink: Color, radius := 10, size := 12, weight := 600, pad := Vector4(12, 6, 12, 6), hover_bg := Color(0, 0, 0, 0)) -> Button:
	var node := Button.new()
	node.text = value
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	var normal := UI.box(bg, border, radius, 1, pad)
	var hover := normal.duplicate() as StyleBoxFlat
	hover.bg_color = hover_bg if hover_bg.a > 0.0 else Color(bg.r, bg.g, bg.b, minf(1.0, bg.a + 0.05))
	if border.a > 0.0:
		hover.border_color = Color(border.r, border.g, border.b, minf(1.0, border.a + 0.1))
	for state in [["normal", normal], ["focus", normal], ["disabled", normal], ["hover", hover], ["pressed", hover], ["hover_pressed", hover]]:
		node.add_theme_stylebox_override(state[0], state[1])
	node.add_theme_font_override("font", UI.font(weight))
	node.add_theme_font_size_override("font_size", size)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color", "font_disabled_color"]:
		node.add_theme_color_override(name, ink)
	node.add_theme_color_override("icon_normal_color", ink)
	node.add_theme_color_override("icon_hover_color", ink)
	node.add_theme_color_override("icon_pressed_color", ink)
	node.add_theme_constant_override("h_separation", 6)
	return node


static func ghost(value: String, min_height := 0.0) -> Button:
	var node := button(value, GHOST_BG, GHOST_BORDER, GHOST_INK, 10, 12, 600, Vector4(12, 8, 12, 8), Color(1, 1, 1, 0.08))
	node.custom_minimum_size.y = min_height
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func set_busy(control: Control, busy: bool, dim := 0.6) -> void:
	control.modulate.a = dim if busy else 1.0
	if control is BaseButton:
		(control as BaseButton).disabled = busy
		control.mouse_default_cursor_shape = Control.CURSOR_ARROW if busy else Control.CURSOR_POINTING_HAND


static func metric(value: String, tone := "default", icon_name := "", active := false) -> Button:
	var tones := {
		"default": [Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.12), Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.18), Color(232 / 255.0, 232 / 255.0, 234 / 255.0, 0.84)],
		"accent": [Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.12), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.22), Color("#bfdbfe")],
	}
	var spec: Array = tones.get(tone, tones["default"])
	var bg: Color = Color(0, 0, 0, 0.42) if active else spec[0]
	var node := button(value, bg, spec[1], spec[2], 999, 11, 600, Vector4(10, 4, 10, 5))
	if not icon_name.is_empty():
		node.icon = icon(icon_name, 14, spec[2])
		node.add_theme_constant_override("h_separation", 5)
	node.mouse_default_cursor_shape = Control.CURSOR_ARROW
	return node


static func tag(value: String) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.08), 999, 1, Vector4(9, 4, 9, 4)))
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(UI.label(value, 11, Color(230 / 255.0, 230 / 255.0, 233 / 255.0, 0.74), 600))
	return holder


static func quotation(quote: Variant, compact := false) -> Control:
	if typeof(quote) != TYPE_DICTIONARY or str(quote.get("text", "")).is_empty():
		return null
	var holder := HBoxContainer.new()
	holder.add_theme_constant_override("separation", 10 if not compact else 9)
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var bar := ColorRect.new()
	bar.color = Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.42)
	bar.custom_minimum_size.x = 2
	holder.add_child(bar)
	var lines := column(3)
	lines.add_child(text("“%s”" % str(quote["text"]), 11.7 if compact else 12.6, Color(239 / 255.0, 239 / 255.0, 242 / 255.0, 0.86)))
	var attribution := str(quote.get("attribution", ""))
	if not attribution.is_empty():
		var who := text(attribution, 10.6 if compact else 11.2, Color(206 / 255.0, 206 / 255.0, 210 / 255.0, 0.62))
		who.add_theme_font_override("font", UI.font(400, "Arial"))
		lines.add_child(who)
	holder.add_child(lines)
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_top", 3)
	margin.add_theme_constant_override("margin_bottom", 3)
	margin.add_child(holder)
	return margin


static func filed_note(fate: String, note: String) -> Control:
	var strip := frame(Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.1), Color(0, 0, 0, 0), 0, Vector4(16, 7, 16, 7))
	var line := RichTextLabel.new()
	line.bbcode_enabled = true
	line.fit_content = true
	line.scroll_active = false
	line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	line.add_theme_font_override("normal_font", UI.font(400))
	line.add_theme_font_override("bold_font", UI.font(800, "Arial", 1))
	line.add_theme_font_size_override("normal_font_size", 11)
	line.add_theme_font_size_override("bold_font_size", 11)
	line.add_theme_color_override("default_color", Color(226 / 255.0, 232 / 255.0, 240 / 255.0, 0.86))
	line.text = "[b]%s[/b]%s" % [fate.to_upper().replace("[", "[lb]"), (" · " + note.replace("[", "[lb]")) if not note.is_empty() else ""]
	strip.add_child(line)
	return strip


static func document(report: Dictionary) -> Control:
	var holder := frame(Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.05), Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.18), 12)
	var stack := column(0)
	var head := Button.new()
	head.flat = true
	head.focus_mode = Control.FOCUS_NONE
	head.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	head.custom_minimum_size.y = 30
	head.add_theme_stylebox_override("normal", StyleBoxEmpty.new())
	head.add_theme_stylebox_override("hover", UI.box(Color(1, 1, 1, 0.03), Color(0, 0, 0, 0), 12, 0))
	head.add_theme_stylebox_override("pressed", UI.box(Color(1, 1, 1, 0.03), Color(0, 0, 0, 0), 12, 0))
	head.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	var row := HBoxContainer.new()
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.offset_left = 11
	row.offset_right = -11
	row.add_theme_constant_override("separation", 7)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(UI.label("📄", 12, Color(254 / 255.0, 243 / 255.0, 199 / 255.0, 0.92)))
	var title := UI.label(str(report.get("title", "")), 12, Color(254 / 255.0, 243 / 255.0, 199 / 255.0, 0.92), 700)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.clip_text = true
	title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	row.add_child(title)
	var dateline := str(report.get("dateline", ""))
	var meta_text := ("Published" if report.get("published", false) else "Our government's") + ((" · " + dateline) if not dateline.is_empty() else "")
	var meta := UI.label(meta_text + " ▾", 10, Color(254 / 255.0, 243 / 255.0, 199 / 255.0, 0.5), 600)
	row.add_child(meta)
	head.add_child(row)
	stack.add_child(head)
	var body := frame(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, Vector4(13, 9, 13, 11))
	var rule := ColorRect.new()
	rule.color = Color(251 / 255.0, 191 / 255.0, 36 / 255.0, 0.12)
	rule.custom_minimum_size.y = 1
	rule.visible = false
	stack.add_child(rule)
	body.add_child(UI.rich(str(report.get("body", "")), 12, Color(228 / 255.0, 228 / 255.0, 231 / 255.0, 0.84)))
	body.visible = false
	stack.add_child(body)
	head.pressed.connect(func() -> void:
		body.visible = not body.visible
		rule.visible = body.visible
		meta.text = meta_text + (" ▴" if body.visible else " ▾"))
	holder.add_child(stack)
	return holder


static func card(event: Dictionary, options: Dictionary = {}) -> Control:
	var filed: Variant = event.get("filed")
	var is_filed := typeof(filed) == TYPE_DICTIONARY
	var outer := frame(Color(1, 1, 1, 0.045), Color(1, 1, 1, 0.14) if is_filed else Color(1, 1, 1, 0.08), 16)
	outer.set_meta("event_id", str(event.get("id", "")))
	if is_filed:
		outer.modulate.a = 0.6
	var stack := column(0)
	if is_filed:
		stack.add_child(filed_note(str(filed.get("fate", "")), str(filed.get("note", ""))))
	var head := frame(Color(1, 1, 1, 0.02), Color(0, 0, 0, 0), 0, Vector4(16, 14, 16, 11))
	var pills := flow(7)
	pills.add_child(metric(str(event.get("dateLabel", "")), "default", "calendar"))
	var changes: Array = event.get("mapChanges", [])
	var map_open: bool = options.get("map_open", false)
	var change_box: Control = null
	if not changes.is_empty():
		var count := changes.size()
		var label := "%d map change%s" % [count, "" if count == 1 else "s"]
		var toggle := metric(label + (" ▴" if map_open else " ▾"), "accent", "map", map_open)
		toggle.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		pills.add_child(toggle)
		change_box = _map_changes(changes, str(event.get("id", "")))
		change_box.visible = map_open
		var on_toggle: Callable = options.get("on_toggle_map", Callable())
		toggle.pressed.connect(func() -> void:
			change_box.visible = not change_box.visible
			var tones := Color(0, 0, 0, 0.42) if change_box.visible else Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.12)
			for state in ["normal", "hover", "pressed", "focus"]:
				var style := (toggle.get_theme_stylebox(state) as StyleBoxFlat).duplicate() as StyleBoxFlat
				style.bg_color = tones
				toggle.add_theme_stylebox_override(state, style)
			toggle.text = label + (" ▴" if change_box.visible else " ▾")
			if on_toggle.is_valid():
				on_toggle.call(str(event.get("key", event.get("id", "")))))
	if str(event.get("source", "")) == "fallback":
		pills.add_child(metric("Fallback", "accent"))
	head.add_child(pills)
	stack.add_child(head)
	var rule := ColorRect.new()
	rule.color = Color(1, 1, 1, 0.05)
	rule.custom_minimum_size.y = 1
	stack.add_child(rule)
	var body := frame(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, Vector4(16, 15, 16, 16))
	var content := column(10)
	var tags: Array = event.get("tags", [])
	var links: Array = event.get("links", [])
	var struck: bool = event.get("struck", false)
	if not tags.is_empty() or not links.is_empty() or struck:
		var chips := flow(6)
		if struck:
			var strike := button("➶  Watch it on the map", Color(251 / 255.0, 146 / 255.0, 60 / 255.0, 0.09), Color(251 / 255.0, 146 / 255.0, 60 / 255.0, 0.28), Color(254 / 255.0, 215 / 255.0, 170 / 255.0, 0.92), 999, 11, 600, Vector4(9, 4, 9, 4))
			var on_watch: Callable = options.get("on_watch", Callable())
			if on_watch.is_valid():
				strike.tooltip_text = "Play this on the map again"
				strike.pressed.connect(func() -> void: on_watch.call(event))
			chips.add_child(strike)
		for value in tags:
			chips.add_child(tag(str(value)))
		var on_focus: Callable = options.get("on_focus", Callable())
		for link in links:
			var glyph: String = LINK_GLYPHS.get(str(link.get("kind", "")), "⌖")
			var chip := button("%s  %s" % [glyph, str(link.get("label", ""))], Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.07), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.2), Color(219 / 255.0, 234 / 255.0, 254 / 255.0, 0.86), 999, 11, 600, Vector4(9, 4, 9, 4))
			chip.tooltip_text = "Show %s on the map" % str(link.get("label", ""))
			var bounds: Array = link.get("bounds", [])
			chip.pressed.connect(func() -> void:
				if on_focus.is_valid():
					on_focus.call(bounds))
			chips.add_child(chip)
		content.add_child(chips)
	if change_box:
		content.add_child(change_box)
	content.add_child(text(str(event.get("title", "")).to_upper(), 13, Color(1, 1, 1, 0.94), 800, 1))
	var description := str(event.get("description", ""))
	if not description.is_empty():
		var markdown := UI.rich(description, 12, Color(228 / 255.0, 228 / 255.0, 231 / 255.0, 0.82))
		markdown.add_theme_constant_override("line_separation", 6)
		markdown.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		content.add_child(markdown)
	var quote := quotation(event.get("quote"))
	if quote:
		content.add_child(quote)
	var documents: Array = event.get("documents", [])
	if not documents.is_empty():
		var papers := column(6)
		for report in documents:
			papers.add_child(document(report))
		content.add_child(papers)
	var footer: Control = options.get("footer", null)
	if footer:
		content.add_child(footer)
	body.add_child(content)
	stack.add_child(body)
	outer.add_child(stack)
	return outer


static func _map_changes(changes: Array, id: String) -> Control:
	var box := frame(Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.06), Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.18), 12, Vector4(11, 9, 11, 9))
	var rows := column(5)
	rows.add_child(UI.label("WHAT CHANGED ON THE MAP", 10, Color("#bfdbfe"), 800, "Arial", 1))
	for change in changes:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 7)
		var kind := UI.label(str(change.get("kind", "")).to_upper(), 10, Color(191 / 255.0, 219 / 255.0, 254 / 255.0, 0.7), 700, "Arial", 1)
		kind.custom_minimum_size.x = 70
		kind.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		row.add_child(kind)
		row.add_child(text(str(change.get("text", "")), 12, Color(228 / 255.0, 228 / 255.0, 231 / 255.0, 0.86)))
		rows.add_child(row)
	box.add_child(rows)
	box.set_meta("event_id", id)
	return box


static func filed_section(events: Array) -> Control:
	if events.is_empty():
		return null
	var stack := column(8)
	var count := events.size()
	var label := "%d event%s kept off the timeline" % [count, "" if count == 1 else "s"]
	var toggle := ghost("▾ " + label)
	toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	toggle.modulate.a = 0.8
	toggle.tooltip_text = "Events the AI wrote for this skip that the engine's checks kept off the timeline"
	stack.add_child(toggle)
	var cards := column(8)
	cards.visible = false
	for event in events:
		var holder := frame(Color(0, 0, 0, 0), Color(1, 1, 1, 0.14), 16)
		holder.modulate.a = 0.6
		var inner := column(0)
		inner.add_child(filed_note(str(event.get("fate", "")), str(event.get("note", ""))))
		var padding := frame(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, Vector4(16, 12, 16, 14))
		var lines := column(7)
		if not str(event.get("dateLabel", "")).is_empty():
			lines.add_child(text(str(event["dateLabel"]), 11, Color(228 / 255.0, 228 / 255.0, 231 / 255.0, 0.6)))
		lines.add_child(text(str(event.get("title", "")).to_upper(), 12.5, Color(1, 1, 1, 0.9), 800, 1))
		if not str(event.get("description", "")).is_empty():
			lines.add_child(text(str(event["description"]), 12, Color(228 / 255.0, 228 / 255.0, 231 / 255.0, 0.76)))
		var quote := quotation(event.get("quote"), true)
		if quote:
			lines.add_child(quote)
		padding.add_child(lines)
		inner.add_child(padding)
		holder.add_child(inner)
		cards.add_child(holder)
	stack.add_child(cards)
	toggle.pressed.connect(func() -> void:
		cards.visible = not cards.visible
		toggle.text = ("▴ " if cards.visible else "▾ ") + label)
	return stack


static func engine_changes(receipt: Variant) -> Control:
	if typeof(receipt) != TYPE_DICTIONARY:
		return null
	var count := int(receipt.get("count", 0))
	var holder := frame(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.08), 12)
	var stack := column(0)
	var title := "What the engine changed: 1 note" if count == 1 else "What the engine changed: %d notes" % count
	var head := button(title + "  ▾", Color(0, 0, 0, 0), Color(0, 0, 0, 0), Color(228 / 255.0, 228 / 255.0, 231 / 255.0, 0.78), 12, 12, 700, Vector4(12, 9, 12, 9), Color(1, 1, 1, 0.03))
	head.alignment = HORIZONTAL_ALIGNMENT_LEFT
	head.tooltip_text = "Why something an event describes may be missing from the map or the timeline"
	stack.add_child(head)
	var detail := frame(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, Vector4(13, 10, 13, 12))
	var lines := column(9)
	lines.add_child(text("What the engine left out of this time skip's answer, or changed, before it reached the map and the timeline.", 11, Color(228 / 255.0, 228 / 255.0, 231 / 255.0, 0.5)))
	for group in receipt.get("groups", []):
		var block := column(4)
		block.add_child(text(str(group.get("title", "")), 11, Color(1, 1, 1, 0.86), 700))
		for note in group.get("notes", []):
			var item := column(1)
			if not str(note.get("event", "")).is_empty():
				item.add_child(text("•  " + str(note["event"]), 11, Color(1, 1, 1, 0.8), 600))
				item.add_child(text("    " + str(note.get("text", "")), 11, Color(228 / 255.0, 228 / 255.0, 231 / 255.0, 0.72)))
			else:
				item.add_child(text("•  " + str(note.get("text", "")), 11, Color(228 / 255.0, 228 / 255.0, 231 / 255.0, 0.72)))
			block.add_child(item)
		lines.add_child(block)
	var omitted := int(receipt.get("omitted", 0))
	if omitted > 0:
		lines.add_child(text("1 more note was left out for length." if omitted == 1 else "%d more notes were left out for length." % omitted, 11, Color(228 / 255.0, 228 / 255.0, 231 / 255.0, 0.5)))
	detail.add_child(lines)
	detail.visible = false
	stack.add_child(detail)
	head.pressed.connect(func() -> void:
		detail.visible = not detail.visible
		head.text = title + ("  ▴" if detail.visible else "  ▾"))
	holder.add_child(stack)
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_top", 12)
	margin.add_child(holder)
	return margin


static func empty_state(value: String) -> Control:
	var holder := frame(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.1), 16, Vector4(18, 18, 18, 18))
	holder.custom_minimum_size.y = 152
	var label := text(value, 12.5, Color(229 / 255.0, 229 / 255.0, 232 / 255.0, 0.48))
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	holder.add_child(label)
	return holder


static func offer_strip(on_play: Callable, on_pass: Callable) -> Control:
	var holder := frame(Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.08), Color(250 / 255.0, 204 / 255.0, 21 / 255.0, 0.45), 12, Vector4(11, 9, 11, 9))
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 8)
	row.add_theme_constant_override("v_separation", 8)
	var words := column(1)
	words.custom_minimum_size.x = 190
	words.add_child(text("⚡ Interactive event", 12, Color("#fde047"), 800))
	words.add_child(text("Play this moment out as a scene: you make the moves, and how it ends goes into the record.", 11, Color(254 / 255.0, 249 / 255.0, 195 / 255.0, 0.72)))
	row.add_child(words)
	var play := button("Play it out", Color("#facc15"), Color(0, 0, 0, 0), Color("#1c1917"), 8, 12, 800, Vector4(12, 6, 12, 6), Color("#fde047"))
	play.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	play.pressed.connect(func() -> void: on_play.call())
	row.add_child(play)
	var let_pass := button("Let it pass", GHOST_BG, GHOST_BORDER, GHOST_INK, 10, 12, 600, Vector4(12, 6, 12, 6))
	let_pass.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	let_pass.tooltip_text = "Let the moment pass as it happened — free"
	let_pass.pressed.connect(func() -> void:
		if let_pass.disabled:
			return
		let_pass.text = "Letting it pass…"
		set_busy(let_pass, true)
		await on_pass.call()
		if is_instance_valid(let_pass):
			let_pass.text = "Let it pass"
			set_busy(let_pass, false))
	row.add_child(let_pass)
	holder.add_child(row)
	return holder
