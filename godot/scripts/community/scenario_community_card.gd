class_name ScenarioCommunityCard
extends PanelContainer

signal changed
signal update_requested(scenario_id: String, post_id: int)

const UNLINK_ORIGIN := "Unlink this scenario from its community post? It becomes your own scenario: it no longer follows the post, and you can no longer suggest changes to it. This cannot be undone: a scenario cannot be linked to a post again."
const FORGET_POST := "Stop looking for suggested changes on your post? The post stays on the hub, but this cannot be undone: it can never be linked to this scenario again. Publishing the scenario again makes a new post."
const REJECT_ALL := "Reject everything @%s suggested? Their suggestions are put away on all your posts, and anything they suggest later is hidden. You can unblock them in the scenario's Community card."
const LINK_INK := Color("#7dd3fc")
const SUGGESTION_BG := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.08)
const SUGGESTION_BORDER := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.25)

var engine: EngineLink
var context := {}
var scenario_id := ""
var _card := {}
var _busy := false
var _note := ""
var _show_reviewed := false
var _stack: VBoxContainer


func _init() -> void:
	add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.08), 18, 1, Vector4(14, 14, 14, 14)))
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_stack = CommunityKit.column(13)
	add_child(_stack)
	visible = false


func setup(link: EngineLink, extra := {}) -> void:
	engine = link
	context = extra
	scenario_id = str(extra.get("scenario_id", ""))


func refresh() -> void:
	var reply := await engine.request("community.card", {"scenarioId": scenario_id})
	if not is_instance_valid(self):
		return
	_card = reply["result"] if reply.get("ok", false) and typeof(reply.get("result")) == TYPE_DICTIONARY else {}
	_render()


func set_note(text: String) -> void:
	_note = text
	_render()


func _section_label(text: String) -> Label:
	return CommunityDialog.field_label(text)


func _button(caption: String, primary := false, tooltip := "") -> Button:
	var node := CommunityDialog.button(caption, primary)
	node.tooltip_text = tooltip
	CommunityKit.set_idle(node, _busy)
	return node


func _link(caption: String, url: String) -> LinkButton:
	var link := LinkButton.new()
	link.text = caption
	link.underline = LinkButton.UNDERLINE_MODE_ALWAYS
	link.focus_mode = Control.FOCUS_NONE
	link.add_theme_font_override("font", UI.font(400))
	link.add_theme_font_size_override("font_size", 13)
	for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		link.add_theme_color_override(name, LINK_INK)
	link.pressed.connect(func() -> void: CommunityKit.open_url(url))
	return link


func _render() -> void:
	for child in _stack.get_children():
		_stack.remove_child(child)
		child.queue_free()
	visible = not _card.is_empty()
	if _card.is_empty():
		return
	var origin: Variant = _card.get("origin")
	var published: Variant = _card.get("published")
	if typeof(origin) == TYPE_DICTIONARY:
		_stack.add_child(_origin_block(origin))
	if typeof(published) == TYPE_DICTIONARY:
		_stack.add_child(_published_block(published))
	else:
		var block := CommunityKit.column(7)
		if typeof(origin) != TYPE_DICTIONARY:
			block.add_child(_section_label("Community"))
		var line := CommunityKit.flow(7, 7)
		var words := CommunityDialog.quiet("If you publish this scenario to the hub from the Community tab, the changes people suggest on your post show here.")
		line.add_child(CommunityKit.inline(words, line))
		var open_file := _button("Open a suggestion file")
		open_file.pressed.connect(_open_file)
		line.add_child(open_file)
		block.add_child(line)
		_stack.add_child(block)


func _origin_block(origin: Dictionary) -> Control:
	var block := CommunityKit.column(7)
	block.add_child(_section_label("From the community"))
	var title := str(origin.get("title", ""))
	var author := str(origin.get("author", ""))
	block.add_child(CommunityKit.para("“%s”, posted by %s" % [title, author] if not author.is_empty() else "“%s”" % title, 14, Color(1, 1, 1), 400, 1.4))
	var edited: bool = origin.get("edited", false)
	block.add_child(CommunityDialog.quiet("You have changed your copy. Suggest your changes to the author, and they can accept or reject each one." if edited else "Your copy is the same as the post. Change it, and you can suggest your changes to the author."))
	var row := CommunityKit.flow(7, 7)
	if edited:
		var suggest := _button("Suggest changes", true)
		suggest.pressed.connect(_suggest)
		row.add_child(suggest)
	var view := _button("View the post ↗")
	CommunityKit.set_idle(view, false)
	var post_url := str(origin.get("postUrl", ""))
	view.pressed.connect(func() -> void: CommunityKit.open_url(post_url))
	row.add_child(view)
	var unlink := _button("Unlink from the community post", false, "Make this your own scenario, for good: it stops following the post, you can no longer suggest changes to it, and it cannot be linked to a post again.")
	unlink.pressed.connect(func() -> void: _confirmed(UNLINK_ORIGIN, "community.unlinkOrigin"))
	row.add_child(unlink)
	block.add_child(row)
	return block


func _published_block(published: Dictionary) -> Control:
	var block := CommunityKit.column(7)
	block.add_child(_section_label("Your post on the hub"))
	var post_ids: Array = published.get("postIds", [])
	var post_urls: Array = published.get("postUrls", [])
	if not post_ids.is_empty():
		var links := CommunityKit.flow(7, 4)
		for index in range(post_ids.size()):
			links.add_child(_link("Post #%d ↗" % int(post_ids[index]), str(post_urls[index]) if index < post_urls.size() else ""))
		block.add_child(links)
	else:
		block.add_child(CommunityDialog.quiet("Waiting to find your post on the hub. Once you have posted it, it shows here, with any changes people suggest."))
	var groups: Array = _card.get("groups", [])
	if int(_card.get("openCount", 0)) > 0:
		var list := CommunityKit.column(10)
		for entry in groups:
			list.add_child(_contributor(entry))
		block.add_child(list)
	elif not post_ids.is_empty():
		block.add_child(CommunityDialog.quiet("No suggested changes waiting."))
	var reviewed: Array = _card.get("reviewed", [])
	if not reviewed.is_empty():
		var holder := CommunityKit.column(7)
		var toggle := CommunityDialog.button("Hide reviewed suggestions" if _show_reviewed else "Reviewed suggestions (%d)" % reviewed.size())
		toggle.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		toggle.pressed.connect(func() -> void:
			_show_reviewed = not _show_reviewed
			_render())
		holder.add_child(toggle)
		if _show_reviewed:
			for entry in reviewed:
				var ref: Dictionary = entry
				var line := CommunityKit.row(8)
				var who := UI.label("@%s" % str(ref.get("author", "")) if not str(ref.get("author", "")).is_empty() else str(ref.get("id", "")), 13, Color(1, 1, 1))
				who.size_flags_vertical = Control.SIZE_SHRINK_CENTER
				line.add_child(who)
				var state := UI.label("Dismissed" if str(ref.get("reviewStatus", "")) == "dismissed" else "Reviewed", 12, CommunityDialog.QUIET)
				state.size_flags_vertical = Control.SIZE_SHRINK_CENTER
				line.add_child(state)
				var open := _button("Open")
				var ref_id := str(ref.get("id", ""))
				open.pressed.connect(func() -> void: _review(ref_id))
				line.add_child(open)
				holder.add_child(line)
		block.add_child(holder)
	var blocked: Array = published.get("blocked", [])
	if not blocked.is_empty():
		var line := CommunityKit.flow(7, 7)
		var words := UI.label("Blocked contributors:", 12, CommunityDialog.QUIET)
		words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		line.add_child(words)
		for login in blocked:
			var who := CommunityKit.row(5)
			var name := UI.label("@%s" % str(login), 13, Color(1, 1, 1))
			name.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			who.add_child(name)
			var unblock := CommunityKit.pill_button("Unblock", {"bg": CommunityDialog.BUTTON_BG, "border": CommunityDialog.BUTTON_BORDER, "ink": CommunityDialog.BUTTON_INK, "height": 29.0, "pad": 10.0})
			CommunityKit.set_idle(unblock, _busy)
			var name_text := str(login)
			unblock.pressed.connect(func() -> void: _unblock(name_text))
			who.add_child(unblock)
			line.add_child(who)
		block.add_child(line)
	if not _note.is_empty():
		block.add_child(CommunityDialog.quiet(_note))
	var actions := CommunityKit.flow(7, 7)
	var check := _button("Check for suggestions")
	check.pressed.connect(_refresh_suggestions)
	actions.add_child(check)
	var open_file := _button("Open a suggestion file")
	open_file.pressed.connect(_open_file)
	actions.add_child(open_file)
	var forget := _button("Unlink the post", false, "Stop looking for suggestions on this post, for good. The post itself stays on the hub, and it cannot be linked to this scenario again.")
	forget.pressed.connect(func() -> void: _confirmed(FORGET_POST, "community.forgetPost"))
	actions.add_child(forget)
	block.add_child(actions)
	return block


func _contributor(group: Dictionary) -> Control:
	var login := str(group.get("login", ""))
	var refs: Array = group.get("refs", [])
	var column := CommunityKit.column(6)
	if not login.is_empty() and refs.size() > 1:
		var head := CommunityKit.flow(7, 7)
		var who := UI.label("@%s: %d suggestions" % [login, refs.size()], 13, Color(1, 1, 1), 700)
		who.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		who.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		head.add_child(who)
		var reject := _button("Reject all from @%s" % login)
		reject.pressed.connect(func() -> void: _reject_contributor(login))
		head.add_child(reject)
		column.add_child(head)
	for entry in refs:
		var ref: Dictionary = entry
		var row := CommunityKit.panel(SUGGESTION_BG, SUGGESTION_BORDER, 12, Vector4(10, 8, 10, 8))
		var line := CommunityKit.flow(8, 8)
		var words := CommunityKit.column(2)
		words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		words.custom_minimum_size.x = 160
		var author := str(ref.get("author", ""))
		words.add_child(UI.label("Suggested changes from @%s" % author if not author.is_empty() else "Suggested changes", 13, Color(1, 1, 1), 700))
		var parts: PackedStringArray = []
		if not str(ref.get("createdAt", "")).is_empty():
			parts.append(CommunityKit.local_date(str(ref.get("createdAt", ""))))
		parts.append("Review started" if ref.get("started", false) else "New")
		words.add_child(CommunityDialog.quiet(" · ".join(parts)))
		if not str(ref.get("note", "")).is_empty():
			var note := UI.wrapped(str(ref.get("note", "")), 12, CommunityDialog.QUIET, 400, 2)
			words.add_child(note)
		line.add_child(words)
		var review := _button("Review", true)
		var ref_id := str(ref.get("id", ""))
		review.pressed.connect(func() -> void: _review(ref_id))
		line.add_child(review)
		if not login.is_empty() and refs.size() == 1:
			var reject := _button("Reject all from @%s" % login)
			reject.pressed.connect(func() -> void: _reject_contributor(login))
			line.add_child(reject)
		row.add_child(line)
		column.add_child(row)
	return column


func _host() -> Node:
	var host: Variant = context.get("host")
	return host if host is Node else self


func _suggest() -> void:
	var before: Variant = context.get("before_suggest")
	if before is Callable and (before as Callable).is_valid():
		var go: Variant = await (before as Callable).call()
		if not bool(go):
			return
	var dialog := SuggestChangesDialog.new()
	dialog.update_requested.connect(func(id: String, post_id: int) -> void: update_requested.emit(id, post_id))
	dialog.open_for(engine, scenario_id, _host())


func _review(ref_id: String, file := "") -> void:
	var dialog := SuggestionReviewDialog.new()
	dialog.changed.connect(func() -> void:
		changed.emit()
		refresh())
	dialog.contributor_rejected.connect(func(_login: String, note: String) -> void:
		_note = note
		refresh())
	dialog.open_for(engine, scenario_id, _host(), ref_id, file)


func _open_file() -> void:
	var path := await CommunityKit.pick_file(self, false, "", PackedStringArray(["*.zip, *.json ; Suggestion"]))
	if path.is_empty():
		return
	_review("", path)


func _confirmed(question: String, method: String) -> void:
	if not await CommunityKit.confirm(self, question):
		return
	_busy = true
	_render()
	var reply := await engine.request(method, {"scenarioId": scenario_id})
	if not is_instance_valid(self):
		return
	_busy = false
	if reply.get("ok", false):
		if method == "community.forgetPost":
			_note = ""
		_card = reply["result"] if typeof(reply.get("result")) == TYPE_DICTIONARY else {}
		changed.emit()
	else:
		_note = str(reply.get("error", ""))
	_render()


func _refresh_suggestions() -> void:
	_busy = true
	_note = ""
	_render()
	var reply := await engine.request("community.suggestions.refresh", {"scenarioId": scenario_id})
	if not is_instance_valid(self):
		return
	_busy = false
	if reply.get("ok", false):
		var result: Dictionary = reply["result"]
		_note = str(result.get("note", ""))
		if typeof(result.get("card")) == TYPE_DICTIONARY:
			_card = result["card"]
		changed.emit()
	else:
		_note = str(reply.get("error", ""))
	_render()


func _reject_contributor(login: String) -> void:
	if not await CommunityKit.confirm(self, REJECT_ALL % login):
		return
	_busy = true
	_render()
	var reply := await engine.request("community.rejectContributor", {"login": login})
	if not is_instance_valid(self):
		return
	_busy = false
	_note = str(reply["result"].get("note", "")) if reply.get("ok", false) else str(reply.get("error", ""))
	changed.emit()
	await refresh()


func _unblock(login: String) -> void:
	_busy = true
	_render()
	var reply := await engine.request("community.unblockContributor", {"login": login, "scenarioId": scenario_id})
	if not is_instance_valid(self):
		return
	_busy = false
	_note = str(reply["result"].get("note", "")) if reply.get("ok", false) else str(reply.get("error", ""))
	changed.emit()
	await refresh()
