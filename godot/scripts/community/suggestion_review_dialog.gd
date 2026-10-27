class_name SuggestionReviewDialog
extends CommunityDialog

signal changed
signal contributor_rejected(login: String, note: String)

const MAP_REVIEW_MISSING := "Reviewing map changes needs the Workshop, which is not in the native app yet."

var engine: EngineLink
var scenario_id := ""
var _view := {}
var _phase := "loading"
var _error := ""
var _busy := false
var _ref_id := ""
var _file := ""


func _init() -> void:
	super._init("Suggested changes", "")


func open_for(link: EngineLink, id: String, host: Node, ref_id := "", file := "") -> void:
	engine = link
	scenario_id = id
	_ref_id = ref_id
	_file = file
	show_over(host)
	_render()
	var reply := await engine.request("community.review.open", {"scenarioId": id, "refId": ref_id, "file": file})
	if not is_instance_valid(self):
		return
	if not reply.get("ok", false):
		_phase = "error"
		_error = str(reply.get("error", ""))
	else:
		_adopt(reply["result"])
	_render()


func close() -> void:
	if engine and not str(_view.get("key", "")).is_empty():
		engine.request("community.review.close", {"scenarioId": scenario_id, "key": str(_view.get("key", ""))})
	super.close()


func _review_map() -> void:
	var looked := await engine.request("community.review.suggestion", {"scenarioId": scenario_id, "key": str(_view.get("key", ""))})
	if not is_instance_valid(self) or not looked.get("ok", false):
		return
	var hello := await engine.request("hello")
	var data_root := str((hello.get("result", {}) as Dictionary).get("dataRoot", "")) if hello.get("ok", false) else ""
	var layer := CanvasLayer.new()
	layer.layer = 60
	get_tree().root.add_child(layer)
	var workshop: Node = (load("res://scripts/editor/workshop.gd") as GDScript).new()
	layer.add_child(workshop)
	workshop.tree_exited.connect(func() -> void:
		if is_instance_valid(layer):
			layer.queue_free())
	workshop.call("setup", engine, {"tiles_cache": data_root.path_join("native-cache").path_join("tiles")})
	workshop.connect("review_saved", func(_record: Dictionary) -> void:
		var again := await engine.request("community.review.open", {"scenarioId": scenario_id, "refId": _ref_id, "file": _file})
		if is_instance_valid(self) and again.get("ok", false):
			_adopt(again["result"])
			_render()
			changed.emit())
	workshop.call("open", {"id": scenario_id}, {"review": looked["result"]})


func _adopt(view: Dictionary) -> void:
	_view = view
	_phase = str(view.get("phase", "error"))
	_error = str(view.get("error", ""))
	var parts: PackedStringArray = []
	if not str(view.get("author", "")).is_empty():
		parts.append("Suggested by %s" % str(view.get("author", "")))
	if not str(view.get("when", "")).is_empty():
		parts.append(CommunityKit.local_date(str(view.get("when", ""))))
	set_subtitle(" · ".join(parts))


func _act(op: String, ids: Array, status := "") -> bool:
	if _busy:
		return false
	_busy = true
	_render()
	var reply := await engine.request("community.review.act", {"scenarioId": scenario_id, "key": str(_view.get("key", "")), "op": op, "ids": ids, "status": status})
	if not is_instance_valid(self):
		return false
	_busy = false
	if reply.get("ok", false):
		_adopt(reply["result"])
	else:
		_error = str(reply.get("error", ""))
	changed.emit()
	_render()
	return _error.is_empty()


func _render() -> void:
	clear_body()
	clear_footer()
	if _phase == "loading":
		body.add_child(quiet("Opening the suggestion…"))
	if not _error.is_empty():
		body.add_child(error_box(_error))
	if _phase == "ready":
		_render_ready()
	var total := int(_view.get("total", 0))
	var counted := UI.label("%d of %d changes decided" % [int(_view.get("settled", 0)), total] if total > 0 else "", 12, QUIET)
	counted.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	footer.add_child(counted)
	footer.add_child(UI.spacer())
	var status := str(_view.get("status", "reviewing"))
	if _phase == "ready" and status != "done":
		var reviewed := button("Mark as reviewed")
		CommunityKit.set_idle(reviewed, _busy)
		reviewed.pressed.connect(func() -> void: _act("status", [], "done"))
		footer.add_child(reviewed)
	var login := str(_view.get("refAuthor", ""))
	if not login.is_empty():
		var reject_all := button("Reject all from @%s" % login)
		CommunityKit.set_idle(reject_all, _busy)
		reject_all.pressed.connect(func() -> void: _reject_contributor(login))
		footer.add_child(reject_all)
	if _phase != "loading" and status != "dismissed":
		var dismiss := button("Dismiss")
		CommunityKit.set_idle(dismiss, _busy)
		dismiss.pressed.connect(func() -> void:
			if await _act("status", [], "dismissed"):
				close())
		footer.add_child(dismiss)
	var done := button("Done", true)
	done.pressed.connect(close)
	footer.add_child(done)
	show_footer()
	_fit.call_deferred()


func _render_ready() -> void:
	var url := str(_view.get("refUrl", ""))
	if not url.is_empty():
		var link := LinkButton.new()
		link.text = "View the comment on GitHub ↗"
		link.underline = LinkButton.UNDERLINE_MODE_ALWAYS
		link.focus_mode = Control.FOCUS_NONE
		link.add_theme_font_override("font", UI.font(400))
		link.add_theme_font_size_override("font_size", 13)
		for name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
			link.add_theme_color_override(name, Color("#7dd3fc"))
		link.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		link.pressed.connect(func() -> void: CommunityKit.open_url(url))
		body.add_child(link)
	var note := str(_view.get("note", ""))
	if not note.is_empty():
		var quote := PanelContainer.new()
		var style := UI.box(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, Vector4(11, 2, 0, 2))
		style.border_color = Color(1, 1, 1, 0.25)
		style.border_width_left = 3
		quote.add_theme_stylebox_override("panel", style)
		quote.add_child(CommunityKit.para(note, 13, Color(1, 1, 1, 0.82), 400, 1.5))
		body.add_child(quote)
	if int(_view.get("total", 0)) == 0:
		body.add_child(quiet("This suggestion holds no changes this version of the game can read."))
	var details: Array = _view.get("details", [])
	if not details.is_empty():
		var column := CommunityKit.column(8)
		var head := CommunityKit.row(7)
		var label := field_label("Changes outside the map")
		label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		head.add_child(label)
		head.add_child(UI.spacer())
		var pending: Array = _view.get("pendingDetails", [])
		if pending.size() > 1:
			var accept_all := button("Accept all")
			CommunityKit.set_idle(accept_all, _busy)
			accept_all.pressed.connect(func() -> void: _act("accept", pending))
			head.add_child(accept_all)
			var reject_all := button("Reject all")
			CommunityKit.set_idle(reject_all, _busy)
			reject_all.pressed.connect(func() -> void: _act("reject", pending))
			head.add_child(reject_all)
		column.add_child(head)
		for entry in details:
			var row: Dictionary = entry
			var id := str(row.get("id", ""))
			column.add_child(SuggestionRows.detail_row(row, false, _busy,
				func() -> void: _act("accept", [id]),
				func() -> void: _act("reject", [id]),
				func() -> void: _act("undo", [id])))
		body.add_child(column)
	var map: Array = _view.get("map", [])
	if not map.is_empty():
		var card := SuggestionRows.card()
		var stack := CommunityKit.column(10)
		stack.add_child(field_label("Changes on the map"))
		stack.add_child(SuggestionRows.map_summary(map))
		stack.add_child(quiet("They open in the map editor, listed beside the map and marked on it, to accept or reject one by one. Save the map there to keep what you accepted."))
		var review := button("🗺️ Review the map changes", true)
		review.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		if load("res://scripts/editor/workshop.gd") is GDScript:
			review.pressed.connect(_review_map)
		else:
			UI.set_disabled_look(review, MAP_REVIEW_MISSING)
		stack.add_child(review)
		card.add_child(stack)
		body.add_child(card)


func _reject_contributor(login: String) -> void:
	if not await CommunityKit.confirm(self, "Reject everything @%s suggested? Their suggestions are put away on all your posts, and anything they suggest later is hidden. You can unblock them in the scenario's Community card." % login):
		return
	_busy = true
	_render()
	var reply := await engine.request("community.rejectContributor", {"login": login})
	if not is_instance_valid(self):
		return
	_busy = false
	if not reply.get("ok", false):
		_error = str(reply.get("error", ""))
		_render()
		return
	contributor_rejected.emit(login, str(reply["result"].get("note", "")))
	changed.emit()
	if str(_view.get("refAuthor", "")).to_lower() == login.to_lower():
		close()
	else:
		_render()
