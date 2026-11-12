class_name SuggestChangesDialog
extends CommunityDialog

signal update_requested(scenario_id: String, post_id: int)

var engine: EngineLink
var scenario_id := ""
var _phase := "loading"
var _view := {}
var _error := ""
var _by := ""
var _note := ""
var _sent := {}


func _init() -> void:
	super._init("Suggest changes", "")


func open_for(link: EngineLink, id: String, host: Node) -> void:
	engine = link
	scenario_id = id
	show_over(host)
	_render()
	var reply := await engine.request("community.suggest.compare", {"scenarioId": id})
	if not is_instance_valid(self):
		return
	if not reply.get("ok", false):
		_phase = "error"
		_error = str(reply.get("error", ""))
	else:
		_view = reply["result"]
		_phase = str(_view.get("phase", "error"))
		_error = str(_view.get("error", ""))
		set_subtitle(str(_view.get("subtitle", "")))
	_render()


func _render() -> void:
	clear_body()
	clear_footer()
	match _phase:
		"loading":
			body.add_child(quiet("Comparing your copy with the original on the hub…"))
		"error":
			body.add_child(error_box(_error))
		"empty":
			body.add_child(quiet("Your copy is the same as the post. Change something first — in this editor or on the map — and save it, then suggest it."))
		"outdated":
			var can_update: bool = _view.get("canUpdate", false)
			body.add_child(quiet("The file this copy came from is not one the community hub offers any more, so your changes cannot be compared with it. Update the scenario first, then make your changes and suggest them." if can_update else "The community hub no longer offers this scenario, so changes to it cannot be suggested.", Color("#fde68a")))
		"ready":
			_render_ready()
		"sent":
			_render_sent()
	if _phase == "ready":
		var save_open := button("Save the file and open the post", true)
		save_open.pressed.connect(func() -> void: _send(true))
		footer.add_child(save_open)
		var save := button("Only save the file")
		save.pressed.connect(func() -> void: _send(false))
		footer.add_child(save)
		footer.add_child(UI.spacer())
		var cancel := button("Cancel")
		cancel.pressed.connect(close)
		footer.add_child(cancel)
	else:
		if _phase == "outdated" and _view.get("canUpdate", false):
			var update := button("Update", true)
			update.pressed.connect(func() -> void:
				update_requested.emit(scenario_id, int(_view.get("hubPostId", 0)))
				close())
			footer.add_child(update)
		var done := button("Done" if _phase == "sent" else "Close")
		done.pressed.connect(close)
		footer.add_child(done)
	show_footer()
	_fit.call_deferred()


func _render_ready() -> void:
	body.add_child(quiet("This saves a small file with only your changes, not the whole scenario, and opens the scenario's post on GitHub. Comment there with the file attached: the author's game shows them your suggestion, and they accept or reject each change."))
	body.add_child(UI.label(str(_view.get("countText", "")), 14, Color(1, 1, 1), 700))
	var details: Array = _view.get("details", [])
	if not details.is_empty():
		var column := CommunityKit.column(7)
		column.add_child(field_label("Outside the map"))
		for entry in details:
			column.add_child(SuggestionRows.detail_row(entry, true, false, Callable(), Callable(), Callable()))
		body.add_child(column)
	var map: Array = _view.get("map", [])
	if not map.is_empty():
		var card := SuggestionRows.card()
		var stack := CommunityKit.column(6)
		stack.add_child(field_label("On the map"))
		stack.add_child(SuggestionRows.map_summary(map))
		card.add_child(stack)
		body.add_child(card)
	body.add_child(quiet("Changes you suggest are released under CC BY 4.0, like the scenario they are for."))
	var by_column := CommunityKit.column(6)
	by_column.add_child(field_label("Your name (optional)"))
	var by := input(_by, 80)
	by.text_changed.connect(func(value: String) -> void: _by = value)
	by_column.add_child(by)
	body.add_child(by_column)
	var note_column := CommunityKit.column(6)
	note_column.add_child(field_label("A note for the author (optional)"))
	var note := text_area(_note, 80.0, false, "What did you change, and why?")
	note.text_changed.connect(func() -> void:
		var value := note.text
		if value.length() > 1500:
			value = value.substr(0, 1500)
			note.text = value
		_note = value)
	note_column.add_child(note)
	body.add_child(note_column)


func _render_sent() -> void:
	var file_name := str(_sent.get("fileName", ""))
	var steps := CommunityKit.column(6)
	var lines := [
		"The file %s was saved." % file_name,
		"On the post that opened, click in the comment box at the bottom." if _sent.get("openedPost", false) else "Open the scenario's post and click in the comment box at the bottom.",
		"Paste the comment below: it is already copied." if _sent.get("copied", false) else "Copy the comment below and paste it there.",
		"Drag %s into the comment, then click Comment." % file_name,
	]
	for index in range(lines.size()):
		var row := CommunityKit.row(6)
		var number := UI.label("%d." % (index + 1), 12, Color(1, 1, 1, 0.82))
		number.custom_minimum_size.x = 14
		number.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		row.add_child(number)
		row.add_child(quiet(str(lines[index]), Color(1, 1, 1, 0.82)))
		steps.add_child(row)
	body.add_child(steps)
	var comment := text_area(str(_sent.get("comment", "")), 144.0, true)
	comment.editable = false
	body.add_child(comment)
	var buttons := CommunityKit.flow(8, 8)
	var copy := button("Copy the comment")
	copy.pressed.connect(func() -> void:
		DisplayServer.clipboard_set(str(_sent.get("comment", "")))
		_sent["copied"] = true
		_render())
	buttons.add_child(copy)
	var post_url := "%s#new_comment_field" % str(_view.get("postUrl", ""))
	var open_post := button("Open the post ↗")
	open_post.pressed.connect(func() -> void: CommunityKit.open_url(post_url))
	buttons.add_child(open_post)
	body.add_child(buttons)


func _send(open_post: bool) -> void:
	var post_url := "%s#new_comment_field" % str(_view.get("postUrl", ""))
	if open_post:
		CommunityKit.open_url(post_url)
	var target := await CommunityKit.pick_file(self, true, str(_view.get("fileName", "")), PackedStringArray(["*.zip ; Suggestion"]))
	if not is_instance_valid(self) or target.is_empty():
		return
	var reply := await engine.request("community.suggest.send", {"scenarioId": scenario_id, "by": _by, "note": _note, "path": target})
	if not is_instance_valid(self):
		return
	if not reply.get("ok", false):
		_error = str(reply.get("error", ""))
		_phase = "error"
		_render()
		return
	var result: Dictionary = reply["result"]
	DisplayServer.clipboard_set(str(result.get("comment", "")))
	_sent = {"fileName": str(result.get("fileName", "")), "comment": str(result.get("comment", "")), "copied": true, "openedPost": open_post}
	_phase = "sent"
	_render()
