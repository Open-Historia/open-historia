extends RefCounted

const PROPOSAL_MOST := 1200
const RED_SOFT := Color("#fca5a5")
const RED_LINE := Color("#f87171")
const INK := Color8(231, 233, 234)
const DARK := Color("#04141a")
const PARCHMENT := "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M7 4h11a2 2 0 0 1 2 2v1h-4'/><path d='M16 7v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1h10'/><path d='M7 4a2 2 0 0 0-2 2v11'/><path d='M18 4a2 2 0 0 1 2 2'/><path d='M9 9h4M9 12h4'/></svg>"


static func _t(value: Variant) -> String:
	return "" if value == null else str(value).strip_edges()


static func _d(value: Variant) -> Dictionary:
	return value if typeof(value) == TYPE_DICTIONARY else {}


static func _a(value: Variant) -> Array:
	return value if typeof(value) == TYPE_ARRAY else []


static func accent() -> Color:
	return UiTheme.pick("accent", UI.ACCENT)


static func _name_label(text: String, size: int, color: Color, weight := 400) -> Label:
	var node := UI.wrapped(text, size, color, weight)
	node.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	return node


static func effect_line_text(parts: Array) -> String:
	var out := ""
	for part in parts:
		var piece := _d(part)
		if piece.has("w"):
			out += I18n.ui(str(piece["w"]))
		elif piece.has("n"):
			out += str(piece["n"])
		elif piece.has("x"):
			out += "[b]%s[/b]" % str(piece["x"]).replace("[", "[lb]")
		else:
			out += str(piece.get("t", ""))
	return out


static func effect_list(effects: Variant, compact := false) -> Control:
	var px := 10 if compact else 11
	var shown := _d(effects)
	if shown.is_empty():
		return UI.wrapped(I18n.ui("No effects written"), px, UiTheme.pick("muted", Color(1, 1, 1, 0.5)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var months := _t(shown.get("months", ""))
	var term := _name_label("%s: %s" % [I18n.ui("Term"), months if not months.is_empty() else I18n.ui("No set term")], px, UiTheme.pick("muted", Color(1, 1, 1, 0.55)))
	column.add_child(term)
	for entry in _a(shown.get("lists", [])):
		var group := _d(entry)
		var block := VBoxContainer.new()
		block.add_theme_constant_override("separation", 2)
		var heading := UI.label(_t(group.get("heading", "")), 9, accent(), 800, "Arial", 1)
		heading.uppercase = true
		block.add_child(heading)
		for line in _a(group.get("lines", [])):
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 6)
			row.mouse_filter = Control.MOUSE_FILTER_IGNORE
			var dot := UI.label("•", px, UiTheme.pick("text", INK))
			dot.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
			row.add_child(dot)
			var text := RichTextLabel.new()
			text.bbcode_enabled = true
			text.fit_content = true
			text.scroll_active = false
			text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			text.mouse_filter = Control.MOUSE_FILTER_IGNORE
			text.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
			text.add_theme_font_override("normal_font", UI.font(400))
			text.add_theme_font_override("bold_font", UI.font(760))
			text.add_theme_font_size_override("normal_font_size", px)
			text.add_theme_font_size_override("bold_font_size", px)
			text.add_theme_color_override("default_color", UiTheme.pick("text", INK))
			text.text = effect_line_text(_a(line))
			row.add_child(text)
			block.add_child(row)
		column.add_child(block)
	return column


static func button(caption: String, primary: bool, busy := false) -> Button:
	var node: Button
	if primary:
		node = ChatPanel.solid_button(caption, 11, DARK, 800, accent(), accent(), accent().lightened(0.08), accent(), 8, Vector4(10, 6, 10, 6))
	else:
		node = ChatPanel.solid_button(caption, 11, UiTheme.pick("text", INK), 800, UiTheme.pick("surface", Color(1, 1, 1, 0.06)), UiTheme.pick("line", Color(1, 1, 1, 0.18)), UiTheme.pick("hover", Color(1, 1, 1, 0.1)), Color(1, 1, 1, 0.26), 8, Vector4(10, 6, 10, 6))
	node.custom_minimum_size.y = 37
	node.disabled = busy
	node.mouse_default_cursor_shape = Control.CURSOR_WAIT if busy else Control.CURSOR_POINTING_HAND
	return node


static func _card(lit: bool) -> PanelContainer:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UI.box(UiTheme.pick("overlay_card", Color(1, 1, 1, 0.04)), accent() if lit else UiTheme.pick("line", Color(1, 1, 1, 0.14)), 12, 1, Vector4(14, 11, 14, 11)))
	return card


static func _kicker(pieces: Array) -> HFlowContainer:
	var flow := HFlowContainer.new()
	flow.add_theme_constant_override("h_separation", 0)
	flow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var ink := UiTheme.pick("muted", Color(1, 1, 1, 0.55))
	for piece in pieces:
		var entry := _d(piece)
		var node := UI.label(_t(entry.get("text", "")) if not entry.has("sep") else " · ", 10, ink, 800, "Arial", 1)
		node.uppercase = true
		if entry.get("name", false) == true:
			node.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		flow.add_child(node)
	return flow


static func treaty_card(offer: Dictionary, busy: bool, error: String, on_answer: Callable) -> Control:
	var open: bool = offer.get("open", false) == true
	var to_me: bool = offer.get("toMe", false) == true
	var mine: bool = offer.get("mine", false) == true
	var card := _card(open and to_me)
	card.set_meta("treaty_card", _t(offer.get("id", "")))
	if not open and _t(offer.get("status", "")) != "signed":
		card.modulate.a = 0.8
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 7)
	var pieces: Array = [{"text": _t(offer.get("heading", ""))}, {"sep": true}, {"text": _t(offer.get("party", "")), "name": true}]
	if not _t(offer.get("state", "")).is_empty():
		pieces.append({"sep": true})
		pieces.append({"text": _t(offer.get("state", ""))})
	column.add_child(_kicker(pieces))
	var proposal := _t(offer.get("proposal", ""))
	if not proposal.is_empty():
		var said := _name_label(proposal, 12, UiTheme.pick("muted", Color(1, 1, 1, 0.62)))
		said.add_theme_font_override("font", ChatPanel.italic_font())
		column.add_child(said)
	var title := _t(offer.get("title", ""))
	var kind := I18n.ui(_t(offer.get("kind", "")))
	column.add_child(_name_label(kind if title.is_empty() else "%s: %s" % [kind, title], 12, UiTheme.pick("text", INK), 800))
	var parties := _a(offer.get("parties", []))
	if not parties.is_empty():
		column.add_child(_name_label(" · ".join(PackedStringArray(parties)), 11, UiTheme.pick("muted", Color(1, 1, 1, 0.6))))
	var terms := _t(offer.get("terms", ""))
	if not terms.is_empty():
		column.add_child(_name_label(terms, 12, UiTheme.pick("text", INK)))
	column.add_child(effect_list(offer.get("effects")))
	if not error.is_empty():
		column.add_child(UI.wrapped(error, 12, RED_SOFT))
	if open and (to_me or mine):
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var ops: Array = [["Sign", "sign", true], ["Decline", "decline", false]] if to_me else [["Withdraw", "withdraw", false]]
		for op in ops:
			var node := button(str(op[0]), bool(op[2]), busy)
			node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			node.set_meta("treaty_op", str(op[1]))
			var chosen := str(op[1])
			node.pressed.connect(on_answer.bind(chosen, offer))
			row.add_child(node)
		column.add_child(row)
	card.add_child(column)
	return card


static func agreements_card(agreements: Array, armed: String, busy: String, error: String, on_end: Callable, on_disarm: Callable) -> Control:
	var card := _card(false)
	card.set_meta("agreements_in_force", true)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 9)
	column.add_child(_kicker([{"text": "Deals in force"}]))
	for entry in agreements:
		var agreement := _d(entry)
		var id := _t(agreement.get("id", ""))
		var ending := armed == id
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var text := VBoxContainer.new()
		text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		text.add_theme_constant_override("separation", 4)
		var title := _t(agreement.get("title", ""))
		var kind := I18n.ui(_t(agreement.get("kind", "")))
		text.add_child(_name_label(kind if title.is_empty() else "%s: %s" % [kind, title], 12, UiTheme.pick("text", INK), 780))
		text.add_child(effect_list(agreement.get("effects"), true))
		row.add_child(text)
		var end := ChatPanel.solid_button("End it?" if ending else "End", 11, RED_SOFT if ending else UiTheme.pick("text", INK), 800, UiTheme.pick("surface", Color(1, 1, 1, 0.06)), RED_LINE if ending else UiTheme.pick("line", Color(1, 1, 1, 0.18)), UiTheme.pick("hover", Color(1, 1, 1, 0.1)), RED_LINE if ending else Color(1, 1, 1, 0.26), 8, Vector4(10, 6, 10, 6))
		end.custom_minimum_size.y = 34
		end.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		end.disabled = busy == id
		end.set_meta("agreement_end", id)
		end.pressed.connect(on_end.bind(agreement))
		end.mouse_exited.connect(on_disarm.bind(id))
		row.add_child(end)
		column.add_child(row)
	if not error.is_empty():
		column.add_child(UI.wrapped(error, 11, RED_SOFT))
	card.add_child(column)
	return card


static func propose_button() -> Button:
	var node := Button.new()
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.tooltip_text = "Propose deal"
	node.custom_minimum_size = Vector2(44, 44)
	node.size_flags_vertical = Control.SIZE_SHRINK_END
	node.icon = UI.svg_texture(PARCHMENT, 20.0 / 24.0)
	node.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	node.expand_icon = false
	node.set_meta("propose_deal", true)
	return node


static func style_propose_button(node: Button, open: bool) -> void:
	var lit := accent()
	var idle := UiTheme.pick("muted", Color(1, 1, 1, 0.7))
	var bg := UiTheme.pick("active", Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.16)) if open else UiTheme.pick("surface", Color(1, 1, 1, 0.05))
	var line := lit if open else UiTheme.pick("line", Color(1, 1, 1, 0.15))
	ChatPanel.style_flat(node, bg, line, 10, Vector4(0, 0, 0, 0), bg, lit)
	for state in ["icon_normal_color", "icon_focus_color", "icon_disabled_color"]:
		node.add_theme_color_override(state, lit if open else idle)
	for state in ["icon_hover_color", "icon_pressed_color", "icon_hover_pressed_color"]:
		node.add_theme_color_override(state, lit)


static func proposal_box(counterpart: String, text: String, said: String, busy: bool, on_text: Callable, on_send: Callable, on_cancel: Callable) -> Control:
	var box := PanelContainer.new()
	box.set_meta("proposal_box", true)
	box.add_theme_stylebox_override("panel", UI.box(UiTheme.pick("overlay_card", Color(1, 1, 1, 0.03)), UiTheme.pick("line", Color(1, 1, 1, 0.1)), 10, 1, Vector4(10, 10, 10, 10)))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 7)
	column.add_child(_name_label("%s %s" % [I18n.ui("Propose a deal to"), counterpart], 10, UiTheme.pick("text", INK), 820))
	column.add_child(UI.wrapped("Write it out in your own words: what each side gives, gets and does, and for how long. Their answer writes the treaty and what it does.", 10, UiTheme.pick("muted", Color(1, 1, 1, 0.5))))
	var area := TextEdit.new()
	area.set_meta("proposal_text", true)
	area.text = text
	area.placeholder_text = "We pay 2bn a year for exclusive port access at Tartus for 10 years, and they close their airspace to Israel."
	area.tooltip_text = "Your proposal"
	area.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	area.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	area.custom_minimum_size = Vector2(1, 84)
	ChatPanel.style_text_edit(area, 12, Color(0, 0, 0, 0.35), UiTheme.pick("line", Color(1, 1, 1, 0.16)), accent(), 6, Vector4(8, 6, 8, 6))
	area.text_changed.connect(func() -> void:
		if area.text.length() > PROPOSAL_MOST:
			area.text = area.text.left(PROPOSAL_MOST)
			area.set_caret_column(area.get_line(area.get_line_count() - 1).length())
		on_text.call(area.text))
	column.add_child(area)
	if not said.is_empty():
		column.add_child(UI.wrapped(said, 10, RED_SOFT))
	var buttons := HBoxContainer.new()
	buttons.alignment = BoxContainer.ALIGNMENT_END
	buttons.add_theme_constant_override("separation", 6)
	var cancel := button("Cancel", false)
	cancel.pressed.connect(on_cancel)
	buttons.add_child(cancel)
	var send := button("Send proposal", true, busy)
	send.set_meta("proposal_send", true)
	send.disabled = busy or text.strip_edges().is_empty()
	send.pressed.connect(on_send)
	buttons.add_child(send)
	column.add_child(buttons)
	box.add_child(column)
	return box
