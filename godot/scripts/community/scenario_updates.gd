class_name HubScenarioUpdates
extends Node

signal changed
signal library_changed

const NEWER_TITLE := "A newer version of this scenario is on the community hub. Updating replaces this copy (existing games keep working)."
const UNCHECKED_NOTE := "This copy was downloaded before the community hub started checking its files. Update it to get the checked copy."
const UPDATE_BG := Color("#1d7f4ccc")
const UPDATE_BORDER := Color("#27a663dd")

var engine: EngineLink
var reasons := {}
var edited := {}
var notes := {}
var running: Array = []


func setup(link: EngineLink) -> void:
	engine = link
	if not engine.engine_event.is_connected(_on_event):
		engine.engine_event.connect(_on_event)


func _exit_tree() -> void:
	if engine and engine.engine_event.is_connected(_on_event):
		engine.engine_event.disconnect(_on_event)


func refresh() -> void:
	var reply := await engine.request("community.updates")
	if not reply.get("ok", false):
		return
	var result: Dictionary = reply["result"]
	reasons = result.get("reasons", {})
	edited = result.get("edited", {})
	notes = result.get("notes", {})
	running = result.get("running", [])
	changed.emit()


func _on_event(name: String, data: Variant) -> void:
	if name != "community.updates" or typeof(data) != TYPE_DICTIONARY:
		return
	running = (data as Dictionary).get("running", [])
	notes = (data as Dictionary).get("notes", {})
	changed.emit()


func reason_for(scenario_id: String) -> String:
	return str(reasons.get(scenario_id, ""))


func is_updating(scenario_id: String) -> bool:
	return running.has(scenario_id)


func is_primary(scenario_id: String) -> bool:
	return not reason_for(scenario_id).is_empty() and not bool(edited.get(scenario_id, false))


func primary_button(scenario: Dictionary) -> Button:
	var id := str(scenario.get("id", ""))
	var updating := is_updating(id)
	if not updating and not is_primary(id):
		return null
	var button := CommunityKit.pill_button("", {"bg": UPDATE_BG, "border": UPDATE_BORDER, "ink": Color(1, 1, 1), "size": 14, "weight": 700, "height": 38.0, "radius": 11})
	var content := HBoxContainer.new()
	content.alignment = BoxContainer.ALIGNMENT_CENTER
	content.add_theme_constant_override("separation", 6)
	content.mouse_filter = Control.MOUSE_FILTER_IGNORE
	content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	content.add_child(CommunityKit.mark_rect("working" if updating else "update", 15))
	var caption := UI.label("Updating…" if updating else "Update", 14, Color(1, 1, 1), 700)
	caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	content.add_child(caption)
	button.add_child(content)
	button.tooltip_text = UNCHECKED_NOTE if reason_for(id) == "unchecked" else NEWER_TITLE
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if updating:
		button.disabled = true
		button.mouse_default_cursor_shape = Control.CURSOR_BUSY
	else:
		button.pressed.connect(func() -> void: update(id))
	return button


func note_for(scenario: Dictionary) -> Control:
	var id := str(scenario.get("id", ""))
	var reason := reason_for(id)
	var updating := is_updating(id)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 9)
	if reason == "unchecked" and not updating:
		var line := CommunityKit.flow(8, 6)
		var words := CommunityKit.para(UNCHECKED_NOTE, 12, Color("#fde68a"), 400, 1.4)
		words.custom_minimum_size.x = 160
		line.add_child(words)
		if not is_primary(id):
			var update_button := CommunityKit.pill_button("Update", {"bg": UPDATE_BG, "border": UPDATE_BORDER, "ink": Color(1, 1, 1), "height": 32.0, "pad": 13.0})
			update_button.pressed.connect(func() -> void: update(id))
			line.add_child(update_button)
		column.add_child(line)
	var last := str(notes.get(id, ""))
	if not last.is_empty() and not reason.is_empty() and not updating:
		var said := UI.wrapped(last, 12, Color("#fecaca"), 400, 4)
		said.tooltip_text = last
		said.mouse_filter = Control.MOUSE_FILTER_PASS
		column.add_child(said)
	return column if column.get_child_count() > 0 else null


func update(scenario_id: String, post_id := 0, replace_edits := false) -> void:
	var reply := await engine.request("community.update", {"scenarioId": scenario_id, "postId": post_id, "replaceEdits": replace_edits})
	if not reply.get("ok", false):
		notes[scenario_id] = "Update failed: %s" % str(reply.get("error", ""))
		changed.emit()
		return
	var result: Dictionary = reply["result"]
	if typeof(result.get("ask")) == TYPE_DICTIONARY:
		var ask: Dictionary = result["ask"]
		if await _ask_replace(str(ask.get("name", ""))):
			await update(scenario_id, int(ask.get("postId", post_id)), true)
		return
	await refresh()
	library_changed.emit()


func _ask_replace(scenario_name: String) -> bool:
	var tree := get_tree()
	var layer := CanvasLayer.new()
	layer.layer = 90
	tree.root.add_child(layer)
	var shade := ColorRect.new()
	shade.color = Color(0, 0, 0, 0.55)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(shade)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(centre)
	var card := CommunityKit.panel(CommunityKit.CARD_BG, CommunityKit.CARD_BORDER, 16, Vector4(18, 18, 18, 18))
	card.custom_minimum_size.x = 430
	var stack := VBoxContainer.new()
	stack.add_theme_constant_override("separation", 0)
	stack.add_child(UI.label("Replace your changes?", 16, Color(1, 1, 1), 800))
	var name := CommunityKit.para(scenario_name, 14, Color(1, 1, 1, 0.86), 700, 1.3)
	var name_gap := MarginContainer.new()
	name_gap.add_theme_constant_override("margin_top", 6)
	name_gap.add_child(name)
	stack.add_child(name_gap)
	var words := CommunityKit.para("You have changed this scenario since you downloaded it. Updating replaces it with the community hub's checked file, so your changes to it will be lost. To keep them, clone the scenario first. Games already started on it keep working.", 13, Color(1, 1, 1, 0.62), 400, 1.5)
	var words_gap := MarginContainer.new()
	words_gap.add_theme_constant_override("margin_top", 8)
	words_gap.add_theme_constant_override("margin_bottom", 16)
	words_gap.add_child(words)
	stack.add_child(words_gap)
	var answers := VBoxContainer.new()
	answers.add_theme_constant_override("separation", 7)
	var answer := [false]
	var finished := [false]
	var replace := CommunityKit.pill_button("Update and replace my changes", {"bg": Color(127 / 255.0, 29 / 255.0, 29 / 255.0, 0.34), "border": Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.28), "ink": Color("#fecaca"), "height": 42.0})
	replace.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	replace.pressed.connect(func() -> void:
		answer[0] = true
		finished[0] = true)
	answers.add_child(replace)
	var later := CommunityKit.pill_button("Not now", {"height": 42.0})
	later.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	later.pressed.connect(func() -> void: finished[0] = true)
	answers.add_child(later)
	shade.gui_input.connect(func(event: InputEvent) -> void:
		var click := event as InputEventMouseButton
		if click and click.pressed:
			finished[0] = true)
	stack.add_child(answers)
	card.add_child(stack)
	centre.add_child(card)
	while not finished[0] and is_instance_valid(layer):
		await tree.process_frame
	if is_instance_valid(layer):
		layer.queue_free()
	return bool(answer[0])
