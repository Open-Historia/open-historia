extends WorkshopShell

signal created(key: String)

const TABS := [
	["identity", "Identity"],
	["appearance", "Appearance"],
	["people", "People & forces"],
	["relations", "Relations & land"],
	["review", "Review"],
]
const HINT := Color(1, 1, 1, 0.67)
const LINE := Color(1, 1, 1, 0.12)

var host: Workshop
var draft := {}
var pending := {"aliases": "", "formerNames": "", "tags": ""}
var tab := "identity"
var error := ""
var plan := {}
var options := {"choices": [], "kinds": [], "secrecy": [], "tagSuggestions": [], "maxTags": 8, "bands": []}
var relation_other := ""
var relation_score := ""
var relation_error := ""
var _name_label: Label
var _plan_serial := 0
var population_shown := ""


func _init() -> void:
	super._init("Create a polity", "flag", 485.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	draft = {
		"name": "", "aliases": [], "formerNames": [], "note": "", "population": "", "military": null,
		"color": null, "flag": null, "tags": [], "overlord": "", "dependencyKind": "satellite",
		"secrecy": "open", "loyalty": 50, "assignSelectedRegions": false, "startingRelations": [],
	}
	var reply := await host.request_raw("workshop.polity.draftOptions")
	if reply.get("ok", false) and reply["result"] is Dictionary:
		options = reply["result"]
	for button in _header.find_children("*", "Button", true, false):
		if (button as Button).tooltip_text == "Close":
			for connection in (button as Button).pressed.get_connections():
				(button as Button).pressed.disconnect(connection["callable"])
			(button as Button).pressed.connect(request_close)
	await _replan()
	render()


func request_close() -> void:
	var touched := not str(draft["name"]).strip_edges().is_empty() or not (draft["aliases"] as Array).is_empty() or not (draft["formerNames"] as Array).is_empty()
	touched = touched or not str(draft["note"]).strip_edges().is_empty() or not str(draft["population"]).strip_edges().is_empty() or draft["military"] != null
	touched = touched or draft["color"] != null or draft["flag"] != null or not (draft["tags"] as Array).is_empty() or not str(draft["overlord"]).is_empty()
	touched = touched or bool(draft["assignSelectedRegions"]) or not (draft["startingRelations"] as Array).is_empty()
	for field in pending:
		touched = touched or not str(pending[field]).strip_edges().is_empty()
	if touched and not await host.confirm("Discard this unfinished polity? No polity has been created."):
		return
	closed.emit()


func _patch(field: String, value: Variant, full := true) -> void:
	draft[field] = value
	error = ""
	await _replan()
	if full:
		render()
	else:
		_refresh_name()


func _replan() -> void:
	_plan_serial += 1
	var serial := _plan_serial
	var reply := await host.request_raw("workshop.polity.draftPlan", {"draft": draft})
	if serial == _plan_serial and reply.get("ok", false) and reply["result"] is Dictionary:
		plan = reply["result"]
	var people := str(draft["population"]).strip_edges()
	population_shown = ""
	if not people.is_empty():
		var shown := await host.request_raw("workshop.population.format", {"text": people})
		if serial == _plan_serial and shown.get("ok", false) and shown["result"] is Dictionary:
			population_shown = str((shown["result"] as Dictionary).get("text", ""))


func _refresh_name() -> void:
	if _name_label and is_instance_valid(_name_label):
		var shown := str(draft["name"]).strip_edges()
		_name_label.text = shown if not shown.is_empty() else "Untitled polity"


func _section(title_text: String) -> VBoxContainer:
	var parts := WorkshopUI.card(11, Color(1, 1, 1, 0.045), LINE, Vector4(13, 13, 13, 13), 10)
	body.add_child(parts[0])
	var inner: VBoxContainer = parts[1]
	if not title_text.is_empty():
		inner.add_child(UI.label(title_text, 14, Color(1, 1, 1), 700))
	return inner


func _hint(text: String) -> Label:
	return WorkshopUI.wrap(text, 11, HINT)


func _field(text: String) -> Label:
	return UI.label(text, 12, Color(1, 1, 1), 650)


func _name_list(box: VBoxContainer, title_text: String, field: String, placeholder: String, limit := 0) -> void:
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 5)
	holder.add_child(_field(title_text))
	var items: Array = draft[field]
	if not items.is_empty():
		var chips := HFlowContainer.new()
		chips.add_theme_constant_override("h_separation", 5)
		chips.add_theme_constant_override("v_separation", 5)
		for index in range(items.size()):
			var chip := PanelContainer.new()
			chip.add_theme_stylebox_override("panel", UI.box(Color(1, 1, 1, 0.11), Color(1, 1, 1, 0.16), 8, 1, Vector4(9, 3, 6, 3)))
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 6)
			row.add_child(UI.label(str(items[index]), WorkshopUI.font_size(11.5), Color(1, 1, 1)))
			var remove := WorkshopUI.base_button("×")
			WorkshopUI._ink(remove, Color(1, 1, 1), 15.0, 400)
			var clear := StyleBoxEmpty.new()
			for state_name in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
				remove.add_theme_stylebox_override(state_name, clear)
			remove.tooltip_text = "Remove %s" % str(items[index])
			var at := index
			remove.pressed.connect(func() -> void:
				var next: Array = (draft[field] as Array).duplicate()
				next.remove_at(at)
				_patch(field, next))
			row.add_child(remove)
			chip.add_child(row)
			chips.add_child(chip)
		holder.add_child(chips)
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 6)
	var add := WorkshopUI.pill("Add")
	var full := limit > 0 and items.size() >= limit
	add.disabled = str(pending[field]).strip_edges().is_empty() or full
	var edit := WorkshopUI.input(str(pending[field]), placeholder, func(text: String) -> void:
		pending[field] = text
		add.disabled = text.strip_edges().is_empty() or full, 13.6, 34.0)
	edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var commit := func() -> void:
		var text := str(pending[field]).strip_edges()
		if text.is_empty() or full:
			return
		pending[field] = ""
		_patch(field, (draft[field] as Array) + [text])
	edit.text_submitted.connect(func(_text: String) -> void: commit.call())
	add.pressed.connect(commit)
	line.add_child(edit)
	line.add_child(add)
	holder.add_child(line)
	box.add_child(holder)


func render() -> void:
	clear_body()
	var head := _section("")
	head.add_theme_constant_override("separation", 5)
	head.add_child(UI.label("NEW POLITY · NOT YET CREATED", 11, WorkshopUI.ACCENT_GREY, 800))
	_name_label = UI.label("", 18, Color(1, 1, 1), 700)
	_name_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	head.add_child(_name_label)
	_refresh_name()
	head.add_child(_hint("Set up its identity and starting conditions first. Optional fields may be left empty. The polity is not registered until you confirm on the Review tab."))
	var tabs := HFlowContainer.new()
	tabs.add_theme_constant_override("h_separation", 5)
	tabs.add_theme_constant_override("v_separation", 5)
	for index in range(TABS.size()):
		var id: String = TABS[index][0]
		var button := WorkshopUI.pill("%d. %s" % [index + 1, TABS[index][1]], tab == id)
		if tab == id:
			var on := UI.box(Color(1, 1, 1, 0.12), WorkshopUI.ACCENT_GREY, 9, 1, Vector4(10, 7, 10, 7))
			WorkshopUI._flat_styles(button, on, on, on, on)
		button.pressed.connect(_go.bind(id))
		tabs.add_child(button)
	body.add_child(tabs)
	match tab:
		"identity":
			_identity()
		"appearance":
			_appearance()
		"people":
			_people()
		"relations":
			_relations()
		"review":
			_review()
	if not error.is_empty():
		var parts := WorkshopUI.card(9, Color(0, 0, 0, 0), Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.4), Vector4(10, 10, 10, 10), 4)
		(parts[1] as VBoxContainer).add_child(WorkshopUI.wrap(error, 12, WorkshopUI.BAD))
		body.add_child(parts[0])
	body.add_child(WorkshopUI.rule())
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 8)
	var cancel := WorkshopUI.pill("Cancel")
	cancel.pressed.connect(request_close)
	actions.add_child(cancel)
	actions.add_child(UI.spacer())
	var index_now := _tab_index()
	if index_now > 0:
		var back := WorkshopUI.pill("Back")
		back.pressed.connect(_go.bind(str(TABS[index_now - 1][0])))
		actions.add_child(back)
	if tab == "review":
		var create := WorkshopUI.pill("Create polity", true)
		create.disabled = not bool(plan.get("ok", false))
		create.pressed.connect(_create)
		actions.add_child(create)
	else:
		var next := WorkshopUI.pill("Continue", true)
		next.pressed.connect(_go.bind(str(TABS[index_now + 1][0])))
		actions.add_child(next)
	body.add_child(actions)
	fit()
	host._place_panel()


func _tab_index() -> int:
	for index in range(TABS.size()):
		if TABS[index][0] == tab:
			return index
	return 0


func _go(id: String) -> void:
	tab = id
	error = ""
	render()


func _identity() -> void:
	var box := _section("Name & identity")
	var name_box := VBoxContainer.new()
	name_box.add_theme_constant_override("separation", 5)
	name_box.add_child(_field("Polity name"))
	var name_edit := WorkshopUI.input(str(draft["name"]), "For example: Kingdom of Bulgaria", func(text: String) -> void: _patch("name", text, false), 13.6, 34.0)
	name_box.add_child(name_edit)
	box.add_child(name_box)
	box.add_child(_hint("This becomes the polity's registered name. Renaming later will not automatically create an alternative name."))
	_name_list(box, "Alternative names", "aliases", "Another name for the same polity")
	box.add_child(_hint("Alternative names help the game recognize the same polity. They do not change its government, history or ideology."))
	_name_list(box, "Former names", "formerNames", "Older name, if applicable")
	box.add_child(_hint("Only add former names supported by the scenario you're building. The editor does not invent historical transitions."))
	var note_box := VBoxContainer.new()
	note_box.add_theme_constant_override("separation", 5)
	note_box.add_child(_field("Scenario note"))
	note_box.add_child(WorkshopUI.area(str(draft["note"]), 3, "Context about this polity's role when the scenario begins", func(text: String) -> void: _patch("note", text, false)))
	box.add_child(note_box)
	if str(draft["name"]).is_empty():
		name_edit.grab_focus.call_deferred()


func _swatch(color: Variant) -> Panel:
	var tile := Panel.new()
	tile.custom_minimum_size = Vector2(58, 38)
	tile.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tile.add_theme_stylebox_override("panel", UI.box(WorkshopUI.rgb_color(color) if color is Array else Color(1, 1, 1, 0.12), Color(1, 1, 1, 0.25), 7, 1))
	return tile


func _appearance() -> void:
	var box := _section("Flag, map colour & traits")
	var colour_row := HBoxContainer.new()
	colour_row.add_theme_constant_override("separation", 10)
	colour_row.add_child(_swatch(draft["color"]))
	var colour_text := VBoxContainer.new()
	colour_text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	colour_text.add_child(UI.label("Map colour", 12, Color(1, 1, 1), 700))
	colour_text.add_child(_hint(WorkshopUI.hex(WorkshopUI.rgb_color(draft["color"])) if draft["color"] is Array else "Use the game's automatic colour"))
	colour_row.add_child(colour_text)
	var picker := WorkshopUI.color_field(draft["color"] if draft["color"] is Array else [128, 128, 128], func(rgb: Array) -> void: _patch("color", rgb))
	picker.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	colour_row.add_child(picker)
	if draft["color"] is Array:
		var reset := WorkshopUI.pill("Reset")
		reset.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		reset.pressed.connect(func() -> void: _patch("color", null))
		colour_row.add_child(reset)
	box.add_child(colour_row)
	var flag_row := HBoxContainer.new()
	flag_row.add_theme_constant_override("separation", 10)
	var texture: Texture2D = WorkshopUI.flag_texture(str(draft["flag"]), "", 38) if draft["flag"] != null else null
	if texture:
		var image := TextureRect.new()
		image.texture = texture
		image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		image.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		image.custom_minimum_size = Vector2(58, 38)
		flag_row.add_child(image)
	else:
		var none := _hint("No flag")
		none.custom_minimum_size.x = 58
		none.size_flags_horizontal = Control.SIZE_FILL
		flag_row.add_child(none)
	var flag_text := VBoxContainer.new()
	flag_text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	flag_text.add_child(UI.label("Starting flag", 12, Color(1, 1, 1), 700))
	flag_text.add_child(_hint("Flag chosen" if draft["flag"] != null else "No custom flag selected"))
	flag_row.add_child(flag_text)
	var choose := WorkshopUI.pill("Choose flag", true)
	choose.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	choose.pressed.connect(func() -> void: host.open_flag_picker(str(draft["name"]).strip_edges(), func(value: Variant) -> void: _patch("flag", value)))
	flag_row.add_child(choose)
	if draft["flag"] != null:
		var clear := WorkshopUI.pill("Clear")
		clear.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		clear.pressed.connect(func() -> void: _patch("flag", null))
		flag_row.add_child(clear)
	box.add_child(flag_row)
	box.add_child(_hint("Uploading a new flag also stores it in My flags, even if you cancel this polity setup."))
	_name_list(box, "Polity traits (max %d)" % int(options.get("maxTags", 8)), "tags", "e.g. democratic", int(options.get("maxTags", 8)))
	box.add_child(_hint("These tags describe the polity's starting character. Its government and political actors are configured in the Scenario Editor."))


func _people() -> void:
	var box := _section("Population & military")
	var holder := VBoxContainer.new()
	holder.add_theme_constant_override("separation", 5)
	holder.add_child(_field("Starting population"))
	holder.add_child(WorkshopUI.input(str(draft["population"]), "Leave blank for scenario defaults", func(text: String) -> void: _patch("population", text, false), 13.6, 34.0))
	box.add_child(holder)
	box.add_child(_hint("A whole number of people, for example 4,600,000. Empty means no polity-specific population was authored."))
	var military := WorkshopMilitary.new()
	box.add_child(military)
	military.military_changed.connect(func(value: Variant) -> void: _patch("military", value, false))
	military.setup(host, "polity", "new-country-draft", draft["military"])
	box.add_child(_hint("Leave a military figure empty to inherit the scenario's normal behaviour. Zero is a deliberate value where allowed."))


func _choice_name(key: String) -> String:
	for choice in options.get("choices", []):
		if str((choice as Dictionary).get("key", "")) == key:
			return str((choice as Dictionary).get("name", key))
	return key


func _relations() -> void:
	var box := _section("Relationships & starting territory")
	var choices: Array = [["", "Independent polity"]]
	for choice in options.get("choices", []):
		choices.append([str((choice as Dictionary)["key"]), str((choice as Dictionary).get("name", ""))])
	var lord_box := VBoxContainer.new()
	lord_box.add_theme_constant_override("separation", 5)
	lord_box.add_child(_field("Overlord or dependency"))
	lord_box.add_child(WorkshopUI.select(choices, str(draft["overlord"]), func(value: String) -> void: _patch("overlord", value), 13.0, 34.0))
	box.add_child(lord_box)
	var overlord := str(draft["overlord"]).strip_edges()
	if not overlord.is_empty():
		box.add_child(_hint("This polity will begin under %s." % _choice_name(overlord)))
		for spec in [["Relationship type", "dependencyKind", "kinds"], ["Public or secret", "secrecy", "secrecy"]]:
			var rows: Array = []
			for option in options.get(spec[2], []):
				rows.append([str((option as Dictionary)["id"]), str((option as Dictionary)["label"])])
			var field_box := VBoxContainer.new()
			field_box.add_theme_constant_override("separation", 5)
			field_box.add_child(_field(spec[0]))
			var field_name: String = spec[1]
			field_box.add_child(WorkshopUI.select(rows, str(draft[field_name]), func(value: String) -> void: _patch(field_name, value), 13.0, 34.0))
			box.add_child(field_box)
		var loyalty_box := VBoxContainer.new()
		loyalty_box.add_theme_constant_override("separation", 5)
		var loyalty_label := _field("Starting loyalty: %d/100" % int(draft["loyalty"]))
		loyalty_box.add_child(loyalty_label)
		var slider := HSlider.new()
		slider.min_value = 0
		slider.max_value = 100
		slider.step = 1
		slider.value = int(draft["loyalty"])
		slider.focus_mode = Control.FOCUS_NONE
		slider.value_changed.connect(func(value: float) -> void:
			loyalty_label.text = "Starting loyalty: %d/100" % int(value)
			_patch("loyalty", int(value), false))
		loyalty_box.add_child(slider)
		box.add_child(loyalty_box)
	box.add_child(WorkshopUI.rule())
	_starting_relations(box)
	box.add_child(WorkshopUI.rule())
	box.add_child(UI.label("Starting territory", 12, Color(1, 1, 1), 700))
	var count := host.selection.size()
	if count > 0:
		var tick := WorkshopUI.check("Give this new polity the %s regions currently selected on the map." % WorkshopUI.format_count(count), bool(draft["assignSelectedRegions"]), func(on: bool) -> void: _patch("assignSelectedRegions", on), 12.0)
		tick.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		box.add_child(tick)
	else:
		box.add_child(_hint("No regions selected. The new polity can start without land. Assign or paint its territory afterwards."))
	box.add_child(_hint("Territory assignment may change other polities' borders and requires confirmation. Creating the polity and assigning its territory becomes one map Undo step."))


func _band(score: int) -> String:
	var bands: Array = options.get("bands", [])
	var at := clampi(score + 100, 0, 200)
	return str(bands[at]) if at < bands.size() else ""


func _signed(score: Variant) -> String:
	var value := int(score)
	return ("+%d" % value) if value > 0 else str(value)


func _starting_relations(box: VBoxContainer) -> void:
	var owner := str(draft["name"]).strip_edges()
	var names := {}
	var valid: Array = [["", "Choose polity"]]
	for choice in options.get("choices", []):
		var key := str((choice as Dictionary).get("key", ""))
		if key.is_empty() or key == owner:
			continue
		names[key] = str((choice as Dictionary).get("name", key))
		valid.append([key, names[key]])
	box.add_child(UI.label("Starting diplomatic relations", WorkshopUI.font_size(12.5), Color(1, 1, 1), 800))
	box.add_child(_hint("One bilateral score per pair (-100 to +100). This is separate from overlord status. Unset means no authored relationship; 0 is an explicitly neutral relationship. Treaties and agreements belong in the Scenario Editor."))
	var rows: Array = draft["startingRelations"]
	if rows.is_empty():
		box.add_child(_hint("No starting diplomatic scores authored for this polity."))
	for entry in rows:
		var row: Dictionary = entry
		var other := str(row.get("other", ""))
		var parts := WorkshopUI.card(8, Color(0, 0, 0, 0), LINE, Vector4(7, 5, 7, 5), 0)
		var line := HBoxContainer.new()
		line.add_theme_constant_override("separation", 6)
		var who := UI.label(str(names.get(other, other)), 12, Color(1, 1, 1))
		who.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		line.add_child(who)
		line.add_child(UI.label(_signed(row.get("score", 0)), 12, Color(1, 1, 1), 800))
		line.add_child(UI.label(_band(int(row.get("score", 0))), WorkshopUI.font_size(10.5), HINT))
		var edit := WorkshopUI.pill("Edit")
		edit.disabled = not names.has(other)
		edit.pressed.connect(func() -> void:
			relation_other = other
			relation_score = str(row.get("score", ""))
			relation_error = ""
			render())
		line.add_child(edit)
		var unset := WorkshopUI.pill("Unset")
		unset.tooltip_text = "Remove the authored score, not set it to zero"
		unset.disabled = not names.has(other)
		unset.pressed.connect(func() -> void:
			if relation_other == other:
				relation_other = ""
				relation_score = ""
			relation_error = ""
			_patch("startingRelations", (draft["startingRelations"] as Array).filter(func(item: Variant) -> bool: return str((item as Dictionary).get("other", "")) != other)))
		line.add_child(unset)
		(parts[1] as VBoxContainer).add_child(line)
		box.add_child(parts[0])
	var other_box := VBoxContainer.new()
	other_box.add_theme_constant_override("separation", 4)
	other_box.add_child(UI.label("Counterpart polity", 12, Color(1, 1, 1)))
	var picker := WorkshopUI.select(valid, relation_other, func(value: String) -> void:
		relation_other = value
		relation_error = ""
		render(), 13.0, 34.0)
	picker.disabled = valid.size() <= 1
	other_box.add_child(picker)
	box.add_child(other_box)
	var score_box := VBoxContainer.new()
	score_box.add_theme_constant_override("separation", 4)
	score_box.add_child(UI.label("Relationship score (-100 to +100)", 12, Color(1, 1, 1)))
	var exists := rows.any(func(item: Variant) -> bool: return str((item as Dictionary).get("other", "")) == relation_other)
	var save := WorkshopUI.pill("Update starting score" if exists else "Add starting score", true)
	save.disabled = relation_other.is_empty() or relation_score.strip_edges().is_empty()
	var score_edit := WorkshopUI.input(relation_score, "Unset (enter 0 for neutral)", func(text: String) -> void:
		relation_score = text
		relation_error = ""
		save.disabled = relation_other.is_empty() or text.strip_edges().is_empty(), 13.6, 34.0)
	score_box.add_child(score_edit)
	box.add_child(score_box)
	save.pressed.connect(func() -> void:
		if relation_other.is_empty() or not names.has(relation_other):
			relation_error = "Choose an existing counterpart polity."
			render()
			return
		var text := relation_score.strip_edges()
		var pattern := RegEx.create_from_string("^-?(?:0|[1-9]\\d{0,2})$")
		if pattern.search(text) == null or int(text) < -100 or int(text) > 100:
			relation_error = "Enter a whole score from -100 to +100, including 0 for explicit neutrality."
			render()
			return
		var kept_rows: Array = (draft["startingRelations"] as Array).filter(func(item: Variant) -> bool: return str((item as Dictionary).get("other", "")) != relation_other)
		kept_rows.append({"other": relation_other, "score": text})
		relation_other = ""
		relation_score = ""
		relation_error = ""
		_patch("startingRelations", kept_rows))
	box.add_child(save)
	if not relation_error.is_empty():
		box.add_child(WorkshopUI.wrap(relation_error, 11.5, WorkshopUI.BAD))


func _summary(box: VBoxContainer, title_text: String, value: String) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	var left := _hint(title_text)
	left.custom_minimum_size.x = 120
	left.size_flags_horizontal = Control.SIZE_FILL
	row.add_child(left)
	var right := WorkshopUI.wrap(value, 12, Color(1, 1, 1), 600)
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(right)
	box.add_child(row)
	var line := ColorRect.new()
	line.color = Color(1, 1, 1, 0.09)
	line.custom_minimum_size.y = 1
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(line)


func _joined(field: String, empty: String) -> String:
	var items: Array = draft[field]
	if items.is_empty():
		return empty
	return ", ".join(PackedStringArray(items.map(func(item: Variant) -> String: return str(item))))


func _review() -> void:
	var box := _section("Review before creating")
	box.add_theme_constant_override("separation", 6)
	box.add_child(_hint("This is what will be registered. You can go back and change anything. The polity and its territory have not changed yet."))
	var named := str(draft["name"]).strip_edges()
	_summary(box, "Name", named if not named.is_empty() else "Required")
	_summary(box, "Other names", _joined("aliases", "None"))
	_summary(box, "Former names", _joined("formerNames", "None"))
	_summary(box, "Scenario note", str(draft["note"]).strip_edges() if not str(draft["note"]).strip_edges().is_empty() else "Not added")
	_summary(box, "Map colour", WorkshopUI.hex(WorkshopUI.rgb_color(draft["color"])) if draft["color"] is Array else "Automatic")
	_summary(box, "Starting flag", "Chosen" if draft["flag"] != null else "Not set")
	_summary(box, "Tags", _joined("tags", "Not added"))
	_summary(box, "Population", population_shown if not population_shown.is_empty() else "Scenario default")
	_summary(box, "Military", "Custom starting figures" if draft["military"] != null else "Scenario defaults")
	var scores: PackedStringArray = []
	for entry in draft["startingRelations"]:
		scores.append("%s: %s" % [_choice_name(str((entry as Dictionary)["other"])), _signed((entry as Dictionary)["score"])])
	_summary(box, "Diplomatic scores", ", ".join(scores) if not scores.is_empty() else "Unset")
	var overlord := str(draft["overlord"]).strip_edges()
	_summary(box, "Dependency", ("%s (%s)" % [_choice_name(overlord), str(draft["dependencyKind"])]) if not overlord.is_empty() else "Independent")
	_summary(box, "Territory", ("Assign %s selected regions" % WorkshopUI.format_count(host.selection.size())) if bool(draft["assignSelectedRegions"]) else "Start with no territory")
	if bool(plan.get("ok", false)):
		box.add_child(WorkshopUI.wrap("Ready to create. Polity identity and relationships have passed preflight checks.", 11.5, Color(1, 1, 1, 0.74)))
	else:
		box.add_child(WorkshopUI.wrap(str(plan.get("reason", "")), 12, WorkshopUI.BAD))


func _create() -> void:
	await _replan()
	if not bool(plan.get("ok", false)):
		error = str(plan.get("reason", ""))
		render()
		return
	var key := str(plan.get("key", ""))
	var ids: Array = host.selection.duplicate() if bool(draft["assignSelectedRegions"]) else []
	if bool(draft["assignSelectedRegions"]):
		if ids.is_empty():
			error = "Select regions on the map before assigning starting territory."
			render()
			return
		var owners: PackedStringArray = []
		var summaries := await host.request_raw("workshop.summaries", {"ids": ids})
		if summaries.get("ok", false):
			for summary in (summaries["result"] as Dictionary).get("summaries", []):
				var owner := str((summary as Dictionary).get("owner", ""))
				if not owner.is_empty() and not owners.has(owner):
					owners.append(owner)
		var question := "Create \"%s\" and assign %s selected regions?" % [key, WorkshopUI.format_count(ids.size())]
		if not owners.is_empty():
			question += " This changes the current ownership of regions belonging to: %s." % ", ".join(owners)
		question += "\n\nCreating the country and assigning its territory becomes ONE Undo step."
		if not await host.confirm(question):
			error = "Creation cancelled. The unfinished polity has not been added."
			render()
			return
	var reply := await host.request("workshop.polity.createDraft", {"draft": draft, "ids": ids})
	if not bool(reply.get("ok", false)):
		error = str(reply.get("reason", "Country creation was refused."))
		render()
		return
	created.emit(str(reply.get("key", key)))
