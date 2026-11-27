extends PanelContainer

const MEGAPHONE := "<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><path d='M3 9v6h4l12 5V4L7 9H3Z'/><path d='m7 15 2 6m12-11v4'/></svg>"
const AUDIENCES := [["domestic", "Domestic public"], ["foreign-public", "Foreign population"], ["worldwide", "International community"], ["institution", "International institution"]]
const TEXT := Color("#e7e9ea")

var engine: EngineLink
var store: Dictionary
var thread_id := ""
var reply_id := ""
var index := 0
var on_discuss: Callable
var _column: VBoxContainer


func setup(link: EngineLink, kept: Dictionary, thread: String, reply: String, at: int, draft: Dictionary, discuss: Callable) -> void:
	engine = link
	thread_id = thread
	reply_id = reply
	index = at
	on_discuss = discuss
	var key := "%s:public:%d" % [reply_id, index]
	if not kept.has(key):
		kept[key] = {"draft": draft.duplicate(true), "editing": false, "review": null, "busy": false, "status": "", "done": false, "armed": false, "backup": null, "info": {}, "issuerId": ""}
	store = kept[key]
	set_meta("public_statement", key)
	visible = false
	add_theme_stylebox_override("panel", UI.box(UiTheme.pick("overlay_card", Color(1, 1, 1, 0.045)), UiTheme.pick("line", Color(133 / 255.0, 203 / 255.0, 230 / 255.0, 0.3)), 8, 1, Vector4(11, 11, 11, 11)))
	_column = VBoxContainer.new()
	_column.add_theme_constant_override("separation", 10)
	add_child(_column)
	if not (store["info"] as Dictionary).is_empty():
		render()
	reload()


func accent() -> Color:
	return UiTheme.pick("accent", Color("#85cbe6"))


func reload() -> void:
	if engine == null:
		return
	var reply: Dictionary = await engine.request("advisor.public.state", {"threadId": thread_id, "replyId": reply_id, "index": index})
	if not is_instance_valid(self) or not reply.get("ok", false):
		return
	var info: Dictionary = reply["result"] if typeof(reply["result"]) == TYPE_DICTIONARY else {}
	var before: Dictionary = store["info"]
	if not before.is_empty() and JSON.stringify(before.get("game", {})) != JSON.stringify(info.get("game", {})):
		store["review"] = null
		store["done"] = false
		store["armed"] = false
	store["info"] = info
	render()


func draft() -> Dictionary:
	return store["draft"]


func info() -> Dictionary:
	return store["info"]


func selected_issuer() -> String:
	var chosen := str(store.get("issuerId", ""))
	if chosen.is_empty():
		chosen = str(draft().get("issuerId", ""))
	if chosen.is_empty():
		chosen = str(info().get("defaultIssuerId", ""))
	return chosen


func issuer_label() -> String:
	for entry in info().get("issuers", []):
		if str((entry as Dictionary).get("id", "")) == selected_issuer():
			return str((entry as Dictionary).get("label", ""))
	return ""


func audience_kind() -> String:
	return str((draft().get("audience", {}) as Dictionary).get("kind", ""))


func audience_target() -> String:
	return str((draft().get("audience", {}) as Dictionary).get("target", ""))


func choices() -> Array:
	if audience_kind() == "institution":
		return info().get("institutions", [])
	var polity := str(info().get("polity", ""))
	return (info().get("polities", []) as Array).filter(func(entry: Variant) -> bool: return str((entry as Dictionary).get("id", "")) != polity)


func audience_label() -> String:
	var kind := audience_kind()
	var target := audience_target()
	if kind == "foreign-public":
		var named := target
		for entry in info().get("polities", []):
			if str((entry as Dictionary).get("id", "")) == target:
				named = str((entry as Dictionary).get("label", ""))
		return "People of %s" % named
	if kind == "institution":
		for entry in info().get("institutions", []):
			if str((entry as Dictionary).get("id", "")) == target:
				return str((entry as Dictionary).get("label", ""))
		return target
	for pair in AUDIENCES:
		if pair[0] == kind:
			return I18n.ui(str(pair[1]))
	return kind


func valid() -> bool:
	var body := str(draft().get("body", "")).strip_edges()
	var title := str(draft().get("title", "")).strip_edges()
	if body.is_empty() or title.is_empty() or issuer_label().is_empty():
		return false
	var kind := audience_kind()
	if not ["domestic", "foreign-public", "worldwide", "institution"].has(kind):
		return false
	if kind == "foreign-public" or kind == "institution":
		return choices().any(func(entry: Variant) -> bool: return str((entry as Dictionary).get("id", "")) == audience_target())
	return true


func _button(caption: String, primary := false) -> Button:
	var node := Button.new()
	node.text = caption
	node.focus_mode = Control.FOCUS_NONE
	node.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size = Vector2(106, 34)
	node.add_theme_font_override("font", UI.font(700))
	node.add_theme_font_size_override("font_size", 12)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		node.add_theme_color_override(state, TEXT)
	node.add_theme_color_override("font_disabled_color", Color(TEXT, 0.48))
	var bg := UiTheme.pick("active", Color("#28546e")) if primary else UiTheme.pick("overlay_card", Color(1, 1, 1, 0.06))
	var border := accent() if primary else UiTheme.pick("line", Color(1, 1, 1, 0.2))
	var look := UI.box(bg, border, 6, 1, Vector4(9, 7, 9, 7))
	var dim := UI.box(Color(bg, bg.a * 0.48), Color(border, border.a * 0.48), 6, 1, Vector4(9, 7, 9, 7))
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
		node.add_theme_stylebox_override(state, look)
	node.add_theme_stylebox_override("disabled", dim)
	return node


func _meta(text: String, keep := false) -> Label:
	var node := UI.wrapped(text, 12, Color(TEXT, 0.8))
	if keep:
		node.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
	return node


func _field_look(node: Control) -> void:
	var look := UI.box(UiTheme.pick("overlay_card", Color(1, 1, 1, 0.06)), UiTheme.pick("line", Color(1, 1, 1, 0.2)), 6, 1, Vector4(9, 7, 9, 7))
	for state in ["normal", "focus", "hover", "pressed", "read_only", "disabled"]:
		node.add_theme_stylebox_override(state, look)
	node.add_theme_font_override("font", UI.font(400))
	node.add_theme_font_size_override("font_size", 12)
	node.add_theme_color_override("font_color", TEXT)


func _labelled(caption: String, field: Control) -> Control:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	box.add_child(UI.label(caption, 12, TEXT))
	box.add_child(field)
	return box


func _picker(entries: Array, chosen: String, placeholder := "") -> OptionButton:
	var node := OptionButton.new()
	node.focus_mode = Control.FOCUS_NONE
	node.clip_text = true
	node.fit_to_longest_item = false
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.custom_minimum_size.y = 34
	_field_look(node)
	if not placeholder.is_empty():
		node.add_item(placeholder)
		node.set_item_metadata(0, "")
	for entry in entries:
		node.add_item(str(entry[1]))
		node.set_item_metadata(node.item_count - 1, str(entry[0]))
		if str(entry[0]) == chosen:
			node.select(node.item_count - 1)
	node.disabled = bool(store["busy"])
	return node


func _update_draft(next: Dictionary) -> void:
	store["draft"] = next
	store["review"] = null
	store["status"] = ""


func render() -> void:
	for child in _column.get_children():
		_column.remove_child(child)
		child.queue_free()
	var shown := info()
	visible = bool(shown.get("allowed", false))
	if not visible:
		return
	var approved: Variant = shown.get("approved")
	var is_approved := typeof(approved) == TYPE_DICTIONARY and not (approved as Dictionary).is_empty()
	var cancelled := bool(shown.get("cancelled", false))
	var busy := bool(store["busy"])
	var heading := HBoxContainer.new()
	heading.add_theme_constant_override("separation", 8)
	var mark := TextureRect.new()
	mark.texture = UI.svg_texture(MEGAPHONE, 16.0 / 24.0)
	mark.modulate = accent()
	mark.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	mark.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	heading.add_child(mark)
	heading.add_child(UI.label("Cancelled public statement" if cancelled else ("Published public statement" if is_approved else "Proposed public address"), 13, accent(), 700))
	_column.add_child(heading)
	var editing := bool(store["editing"]) and not is_approved and not bool(store["done"]) and not cancelled
	if editing:
		_column.add_child(_fields(busy))
	else:
		var meta := VBoxContainer.new()
		meta.add_theme_constant_override("separation", 0)
		var issuer_now := str((approved as Dictionary).get("issuer", "")) if is_approved else issuer_label()
		meta.add_child(_meta("%s %s" % [I18n.ui("Issuer:"), issuer_now if not issuer_now.is_empty() else I18n.ui("Select a valid issuer")], true))
		var audience_now := str((approved as Dictionary).get("audienceLabel", "")) if is_approved else audience_label()
		meta.add_child(_meta("%s %s" % [I18n.ui("Audience:"), audience_now], true))
		_column.add_child(meta)
		var copy := PanelContainer.new()
		var copy_look := StyleBoxFlat.new()
		copy_look.bg_color = Color(0, 0, 0, 0)
		copy_look.border_color = UiTheme.pick("line", Color(1, 1, 1, 0.15))
		copy_look.border_width_top = 1
		copy_look.content_margin_top = 10
		copy.add_theme_stylebox_override("panel", copy_look)
		var words := VBoxContainer.new()
		words.add_theme_constant_override("separation", 6)
		var displayed: Dictionary = approved if is_approved else draft()
		var title := UI.wrapped(str(displayed.get("title", "")), 13, TEXT, 700)
		title.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		words.add_child(title)
		var body := UI.wrapped(str(displayed.get("body", "")), 13, TEXT)
		body.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		words.add_child(body)
		copy.add_child(words)
		_column.add_child(copy)
		if cancelled:
			_column.add_child(_meta("Withdrawn. Ask the Advisor for a fresh draft if needed."))
		elif is_approved:
			_column.add_child(_meta("%s %s" % [I18n.ui("Published on"), str(shown.get("receiptDate", ""))], true))
		elif not bool(store["done"]):
			var confirm := CheckBox.new()
			confirm.text = "I authorize publication of this exact wording to the selected public audience."
			confirm.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			confirm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			confirm.focus_mode = Control.FOCUS_NONE
			confirm.add_theme_font_override("font", UI.font(400))
			confirm.add_theme_font_size_override("font_size", 12)
			for state in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
				confirm.add_theme_color_override(state, TEXT)
			confirm.button_pressed = store["review"] != null
			confirm.disabled = not valid() or busy
			confirm.set_meta("public_authorize", true)
			confirm.toggled.connect(_authorize)
			_column.add_child(confirm)
			var row := HFlowContainer.new()
			row.add_theme_constant_override("h_separation", 6)
			row.add_theme_constant_override("v_separation", 6)
			var edit := _button("Edit statement")
			edit.disabled = busy
			edit.pressed.connect(_start_edit)
			row.add_child(edit)
			var publish := _button("Working..." if busy else "Publish address", true)
			publish.disabled = store["review"] == null or not valid() or busy
			publish.set_meta("public_publish", true)
			publish.pressed.connect(_publish)
			row.add_child(publish)
			_column.add_child(row)
			_column.add_child(_meta("Publication records your words in Events. Reactions may occur on the next ordinary time skip. It does not execute orders or enact laws."))
	if not editing and bool(shown.get("cancellable", false)):
		var row := HFlowContainer.new()
		row.add_theme_constant_override("h_separation", 6)
		row.add_theme_constant_override("v_separation", 6)
		if not is_approved:
			var discuss := _button("Discuss")
			discuss.disabled = busy or not on_discuss.is_valid()
			discuss.pressed.connect(_discuss)
			row.add_child(discuss)
		var armed := bool(store["armed"])
		var cancel := _button(("Confirm withdraw" if armed else "Withdraw publication") if is_approved else "Cancel")
		cancel.disabled = busy
		cancel.set_meta("public_cancel", true)
		cancel.pressed.connect(_cancel)
		row.add_child(cancel)
		if is_approved and armed:
			var keep := _button("Keep published")
			keep.disabled = busy
			keep.pressed.connect(_keep)
			row.add_child(keep)
		_column.add_child(row)
	if not str(store["status"]).is_empty():
		_column.add_child(_meta(str(store["status"])))


func _fields(busy: bool) -> Control:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	var offices: Array = []
	for entry in info().get("issuers", []):
		offices.append([str((entry as Dictionary).get("id", "")), str((entry as Dictionary).get("label", ""))])
	var issuer := _picker(offices, selected_issuer())
	issuer.item_selected.connect(func(at: int) -> void:
		store["issuerId"] = str(issuer.get_item_metadata(at))
		var next := draft().duplicate(true)
		next["issuerId"] = store["issuerId"]
		_update_draft(next)
		render())
	box.add_child(_labelled("Issuer", issuer))
	var kinds: Array = []
	for pair in AUDIENCES:
		kinds.append([pair[0], I18n.ui(str(pair[1]))])
	var audience := _picker(kinds, audience_kind())
	audience.item_selected.connect(func(at: int) -> void:
		var next := draft().duplicate(true)
		next["audience"] = {"kind": str(audience.get_item_metadata(at)), "target": ""}
		_update_draft(next)
		render())
	box.add_child(_labelled("Audience", audience))
	if audience_kind() == "foreign-public" or audience_kind() == "institution":
		var listed: Array = []
		for entry in choices():
			listed.append([str((entry as Dictionary).get("id", "")), str((entry as Dictionary).get("label", ""))])
		var recipient := _picker(listed, audience_target(), I18n.ui("Select recipient"))
		recipient.item_selected.connect(func(at: int) -> void:
			var next := draft().duplicate(true)
			next["audience"] = {"kind": audience_kind(), "target": str(recipient.get_item_metadata(at))}
			_update_draft(next)
			render())
		box.add_child(_labelled("Recipient", recipient))
	var title := LineEdit.new()
	title.text = str(draft().get("title", ""))
	title.max_length = 180
	title.editable = not busy
	title.custom_minimum_size.y = 34
	_field_look(title)
	title.text_changed.connect(func(value: String) -> void:
		var next := draft().duplicate(true)
		next["title"] = value
		_update_draft(next))
	box.add_child(_labelled("Title", title))
	var most := int(info().get("max", 4000))
	var body := TextEdit.new()
	body.text = str(draft().get("body", ""))
	body.editable = not busy
	body.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	body.custom_minimum_size.y = 160
	_field_look(body)
	var count := _meta("%d / %d" % [body.text.length(), most], true)
	body.text_changed.connect(func() -> void:
		if body.text.length() > most:
			body.text = body.text.left(most)
		var next := draft().duplicate(true)
		next["body"] = body.text
		_update_draft(next)
		count.text = "%d / %d" % [body.text.length(), most])
	box.add_child(_labelled("Statement", body))
	box.add_child(count)
	var review := _button("Review statement")
	review.disabled = busy
	review.pressed.connect(func() -> void:
		if not valid():
			store["status"] = ""
			render()
			return
		store["backup"] = null
		store["review"] = null
		store["editing"] = false
		render())
	box.add_child(review)
	var back := _button("Back to draft")
	back.disabled = busy
	back.pressed.connect(func() -> void:
		if store["backup"] != null:
			store["draft"] = store["backup"]
			store["backup"] = null
		store["editing"] = false
		store["review"] = null
		store["status"] = ""
		render())
	box.add_child(back)
	return box


func _start_edit() -> void:
	store["backup"] = draft().duplicate(true)
	store["review"] = null
	store["editing"] = true
	render()


func _discuss() -> void:
	if bool(store["busy"]):
		return
	store["review"] = null
	store["editing"] = false
	on_discuss.call(draft())


func _keep() -> void:
	store["armed"] = false
	render()


func _authorize(checked: bool) -> void:
	store["review"] = null
	if not checked or not valid() or bool(store["busy"]):
		render()
		return
	store["busy"] = true
	store["status"] = ""
	render()
	var reply: Dictionary = await engine.request("advisor.public.review", {"draft": draft(), "issuerId": selected_issuer(), "issuerLabel": issuer_label(), "audienceLabel": audience_label(), "expected": info().get("game", {})})
	store["busy"] = false
	var result: Dictionary = reply["result"] if reply.get("ok", false) and typeof(reply["result"]) == TYPE_DICTIONARY else {"said": str(reply.get("error", ""))}
	if typeof(result.get("review")) == TYPE_DICTIONARY:
		store["review"] = result["review"]
	else:
		store["status"] = str(result.get("said", ""))
	if is_instance_valid(self):
		render()


func _publish() -> void:
	if store["review"] == null or not valid() or bool(store["busy"]) or bool(store["done"]):
		return
	store["busy"] = true
	store["status"] = ""
	render()
	var reply: Dictionary = await engine.request("advisor.public.publish", {"review": store["review"], "draft": draft(), "issuerId": selected_issuer(), "threadId": thread_id, "replyId": reply_id, "index": index})
	var result: Dictionary = reply["result"] if reply.get("ok", false) and typeof(reply["result"]) == TYPE_DICTIONARY else {"said": str(reply.get("error", "")), "ok": false}
	store["busy"] = false
	store["review"] = null
	if bool(result.get("ok", false)):
		store["done"] = true
	store["status"] = str(result.get("said", ""))
	if is_instance_valid(self):
		await reload()


func _cancel() -> void:
	if bool(store["busy"]):
		return
	var shown := info()
	var is_approved := typeof(shown.get("approved")) == TYPE_DICTIONARY and not (shown.get("approved") as Dictionary).is_empty()
	if is_approved and not bool(store["armed"]):
		store["armed"] = true
		render()
		return
	store["busy"] = true
	store["status"] = ""
	render()
	var reply: Dictionary = await engine.request("advisor.public.cancel", {"threadId": thread_id, "replyId": reply_id, "index": index, "approved": is_approved})
	var result: Dictionary = reply["result"] if reply.get("ok", false) and typeof(reply["result"]) == TYPE_DICTIONARY else {"said": str(reply.get("error", "")), "ok": false}
	store["busy"] = false
	store["armed"] = false
	if bool(result.get("ok", false)):
		store["review"] = null
		store["done"] = false
		store["editing"] = false
	store["status"] = str(result.get("said", ""))
	if is_instance_valid(self):
		await reload()
