class_name SuggestionRows
extends RefCounted

const ROW_BG := Color(1, 1, 1, 0.03)
const ROW_BORDER := Color(1, 1, 1, 0.07)
const CARD_BG := Color(1, 1, 1, 0.03)
const CARD_BORDER := Color(1, 1, 1, 0.08)
const ADD_BG := "#22c55e2e"
const ADD_INK := "#bbf7d0"
const DEL_BG := "#f8717129"
const DEL_INK := "#fecaca"
const SAME_INK := "#ffffffc7"
const BADGES := {
	"conflict": [Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.14), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.45), Color("#fbbf24")],
	"applied": [Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.12), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.4), Color("#86efac")],
	"missing": [Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.12), Color(148 / 255.0, 163 / 255.0, 184 / 255.0, 0.4), Color("#cbd5e1")],
}


static func badge(kind: String, text: String, tooltip := "") -> PanelContainer:
	var colors: Array = BADGES.get(kind, BADGES["missing"])
	var holder := CommunityKit.panel(colors[0], colors[1], 999, Vector4(8, 2, 8, 2))
	holder.tooltip_text = tooltip
	holder.mouse_filter = Control.MOUSE_FILTER_PASS
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	holder.add_child(UI.label(text, 11, colors[2], 700))
	return holder


static func escape(text: String) -> String:
	return text.replace("[", "[lb]")


static func rich(size := 13, color := Color(1, 1, 1, 0.78)) -> RichTextLabel:
	var node := RichTextLabel.new()
	node.bbcode_enabled = true
	node.fit_content = true
	node.scroll_active = false
	node.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	node.selection_enabled = false
	node.mouse_filter = Control.MOUSE_FILTER_PASS
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.add_theme_font_override("normal_font", UI.font(400))
	node.add_theme_font_override("bold_font", UI.font(700))
	node.add_theme_font_size_override("normal_font_size", size)
	node.add_theme_font_size_override("bold_font_size", size)
	node.add_theme_color_override("default_color", color)
	node.add_theme_constant_override("line_separation", 4)
	return node


static func struck(text: String) -> String:
	return "[color=%s][s]%s[/s][/color]" % [DEL_INK, escape(text)]


static func added(text: String) -> String:
	return "[color=%s]%s[/color]" % [ADD_INK, escape(text)]


static func dim(text: String, alpha := 0.55) -> String:
	return "[color=#ffffff%02x]%s[/color]" % [int(round(alpha * 255.0)), escape(text)]


static func tracked(parts: Array) -> Control:
	var holder := CommunityKit.panel(Color(0, 0, 0, 0.22), Color(0, 0, 0, 0), 10, Vector4(10, 9, 10, 9))
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var text := rich(13)
	var bbcode := ""
	for entry in parts:
		var part: Dictionary = entry
		var value := escape(str(part.get("text", "")))
		match str(part.get("type", "")):
			"add":
				bbcode += "[bgcolor=%s][color=%s][u]%s[/u][/color][/bgcolor]" % [ADD_BG, ADD_INK, value]
			"del":
				bbcode += "[bgcolor=%s][color=%s][s]%s[/s][/color][/bgcolor]" % [DEL_BG, DEL_INK, value]
			_:
				bbcode += "[color=%s]%s[/color]" % [SAME_INK, value]
	text.text = bbcode
	scroll.add_child(text)
	holder.add_child(scroll)
	text.resized.connect(func() -> void: scroll.custom_minimum_size.y = minf(192.0, text.size.y))
	return holder


static func image_of(source: Variant, width: float, height: float, alpha := 1.0) -> Control:
	if typeof(source) != TYPE_DICTIONARY:
		return CommunityDialog.quiet("No cover")
	var data: Dictionary = source
	var bytes := Marshalls.base64_to_raw(str(data.get("base64", "")))
	var texture := HubImages.decode(bytes)
	if not texture:
		return CommunityDialog.quiet("No cover")
	var cover := CommunityKit.Cover.new(8.0, 0.0)
	cover.custom_minimum_size = Vector2(width, height)
	cover.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	cover.modulate.a = alpha
	cover.set_texture(texture)
	return cover


static func value_view(value: Dictionary) -> Control:
	match str(value.get("type", "")):
		"tracked":
			return tracked(value.get("parts", []))
		"cover":
			var row := CommunityKit.row(10)
			row.add_child(image_of(value.get("before"), 96, 54, 0.6))
			row.add_child(CommunityDialog.quiet("→"))
			row.add_child(image_of(value.get("after"), 96, 54))
			return row
		"text":
			return CommunityDialog.quiet(str(value.get("text", "")))
		"politics":
			var column := CommunityKit.column(3)
			column.add_child(CommunityDialog.quiet(str(value.get("text", ""))))
			for entry in value.get("paths", []):
				var path: Dictionary = entry
				var line := rich(12, Color(1, 1, 1, 0.78))
				line.text = "%s%s%s%s" % [dim(str(path.get("path", "")) + ": "), struck(str(path.get("from", ""))), dim(" → ", 0.5), added(str(path.get("to", "")))]
				column.add_child(line)
			if value.get("more", false):
				column.add_child(CommunityDialog.quiet("…"))
			return column
		"music":
			var column := CommunityKit.column(3)
			for entry in value.get("volumes", []):
				var volume: Dictionary = entry
				var line := rich(12, Color(1, 1, 1, 0.78))
				line.text = "%s%s%s%s%s%s%s" % [dim(str(volume.get("label", ""))), dim(", "), dim("Volume"), dim(": "), struck(str(volume.get("before", ""))), dim(" → ", 0.5), added(str(volume.get("after", "")))]
				column.add_child(line)
			for entry in value.get("lists", []):
				var listed: Dictionary = entry
				var line := rich(12, Color(1, 1, 1, 0.78))
				line.text = "%s%s%s%s%s" % [dim(str(listed.get("label", ""))), dim(": "), struck(str(listed.get("before", ""))), dim(" → ", 0.5), added(str(listed.get("after", "")))]
				column.add_child(line)
			return column
	var plain := CommunityKit.flow(7, 4)
	var from_color := str(value.get("fromColor", ""))
	if not from_color.is_empty():
		plain.add_child(_swatch(Color(from_color)))
	plain.add_child(_inline("[s]%s[/s]" % escape(str(value.get("from", ""))), Color(DEL_INK)))
	plain.add_child(_inline("→", Color(1, 1, 1, 0.5)))
	var to_color := str(value.get("toColor", ""))
	if not to_color.is_empty():
		plain.add_child(_swatch(Color(to_color)))
	plain.add_child(_inline(escape(str(value.get("to", ""))), Color(ADD_INK)))
	return plain


static func _inline(bbcode: String, color: Color) -> RichTextLabel:
	var text := rich(13, color)
	text.autowrap_mode = TextServer.AUTOWRAP_OFF
	text.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	text.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	text.text = bbcode
	return text


static func _swatch(color: Color) -> Control:
	var swatch := Panel.new()
	swatch.custom_minimum_size = Vector2(14, 14)
	swatch.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	swatch.add_theme_stylebox_override("panel", UI.box(color, Color(0, 0, 0, 0), 4, 0))
	return swatch


static func detail_row(view: Dictionary, read_only: bool, busy: bool, on_accept: Callable, on_reject: Callable, on_undo: Callable) -> PanelContainer:
	var row := CommunityKit.panel(ROW_BG, ROW_BORDER, 14, Vector4(12, 10, 12, 10))
	var stack := CommunityKit.column(7)
	row.add_child(stack)
	var label: Dictionary = view.get("label", {})
	var head := CommunityKit.flow(6, 4)
	var tab := UI.label(str(label.get("tab", "")).to_upper(), 11, Color(1, 1, 1, 0.45), 700, "Arial", 1)
	tab.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(tab)
	var title := UI.label(str(label.get("title", "")), 14, Color(1, 1, 1), 700)
	title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(title)
	var detail_text := str(label.get("detail", ""))
	if not detail_text.is_empty():
		var detail := UI.label(detail_text, 13, Color(1, 1, 1, 0.6))
		detail.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		head.add_child(detail)
	var status := str(view.get("status", ""))
	var decision := str(view.get("decision", ""))
	var badges := CommunityKit.row(6)
	badges.alignment = BoxContainer.ALIGNMENT_END
	badges.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	badges.size_flags_stretch_ratio = 0.001
	if not read_only and status == "conflict" and decision.is_empty():
		badges.add_child(badge("conflict", "You changed this too", "You changed this after you posted the scenario. Accepting replaces your version."))
	if not read_only and status == "applied" and decision.is_empty():
		badges.add_child(badge("applied", "Already in your scenario"))
	head.add_child(badges)
	stack.add_child(head)
	stack.add_child(value_view(view.get("value", {})))
	if read_only:
		return row
	var actions := CommunityKit.flow(7, 7)
	if not decision.is_empty():
		var said := UI.label("Accepted" if decision == "accepted" else "Rejected", 12, Color("#86efac") if decision == "accepted" else Color(1, 1, 1, 0.55), 700)
		said.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		actions.add_child(said)
		if view.get("canUndo", true):
			var undo := CommunityDialog.button("Undo")
			CommunityKit.set_idle(undo, busy)
			undo.pressed.connect(on_undo)
			actions.add_child(undo)
		else:
			var gone := CommunityDialog.quiet("It can no longer be undone here: the game was closed after it was accepted. Change it back in the editor.")
			actions.add_child(CommunityKit.inline(gone, actions))
	else:
		var accept := CommunityDialog.button("Accept", true)
		CommunityKit.set_idle(accept, busy or status == "applied")
		accept.pressed.connect(on_accept)
		actions.add_child(accept)
		var reject := CommunityDialog.button("Reject")
		CommunityKit.set_idle(reject, busy)
		reject.pressed.connect(on_reject)
		actions.add_child(reject)
	stack.add_child(actions)
	return row


static func map_summary(rows: Array) -> VBoxContainer:
	var column := CommunityKit.column(5)
	for entry in rows:
		var item: Dictionary = entry
		var line := CommunityKit.row(8)
		var name := UI.label(str(item.get("label", "")), 13, Color(1, 1, 1, 0.92))
		name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		line.add_child(name)
		line.add_child(UI.label(str(item.get("text", "")), 13, Color(1, 1, 1, 0.6)))
		column.add_child(line)
	return column


static func card() -> PanelContainer:
	return CommunityKit.panel(CARD_BG, CARD_BORDER, 18, Vector4(14, 14, 14, 14))
