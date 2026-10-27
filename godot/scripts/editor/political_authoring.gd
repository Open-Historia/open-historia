class_name EditorPoliticalAuthoring
extends VBoxContainer

signal details_changed(details: Dictionary)
signal value_changed(value: Variant)

var _engine: EngineLink
var _props: Dictionary = {}
var _scenario_id := ""
var _rows: Array = []
var _actor_count := 0
var _traits: Array = []
var _trait_alias := {}
var _representations: Array = []
var _regimes: Array = []
var _card_box: VBoxContainer
var _manager: PoliticalManager
var _query := ""
var _selected_key := ""
var _label := ""
var _has_actor := false
var _draft: Dictionary = {}
var _loaded_draft: Dictionary = {}
var _debug: Dictionary = {}
var _dirty := false
var _busy := false
var _message := ""
var _delete_button: Button
var _discard_button: Button
var _save_button: Button
var _message_holder: VBoxContainer
var _trait_controls := {}
var _traits_json_edit: TextEdit
var _syncing := false
var _parties_section: Dictionary = {}
var _blocs_section: Dictionary = {}
var _open_states := {}


func _init() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 0)


func setup(engine: EngineLink, props: Dictionary) -> void:
	_engine = engine
	_props = props
	var details: Dictionary = props.get("details", {})
	_scenario_id = str((details.get("scenario", {}) as Dictionary).get("id", ""))
	_build_card()
	var reply := await _engine.request("editor.politics.author.load", {"scenarioId": _scenario_id})
	if not reply.get("ok", false) or not is_inside_tree():
		return
	var result: Dictionary = reply["result"]
	_traits = result.get("traits", [])
	_trait_alias.clear()
	for entry in _traits:
		var trait_info: Dictionary = entry
		_trait_alias[_alias_key(str(trait_info.get("key", "")))] = str(trait_info.get("key", ""))
		for alias in (trait_info.get("aliases", []) as Array):
			_trait_alias[_alias_key(str(alias))] = str(trait_info.get("key", ""))
	_representations = result.get("representations", [])
	_regimes = result.get("regimes", [])
	_take_state(result, true)
	_render_card()


func update_props(props: Dictionary) -> void:
	_props = props
	if _scenario_id.is_empty() or _traits.is_empty():
		return
	var reply := await _engine.request("editor.politics.author.draft", {"scenarioId": _scenario_id, "polityKey": _selected_key})
	if not reply.get("ok", false) or not is_inside_tree():
		return
	_take_state(reply["result"], not _dirty)
	_render_card()
	if _manager:
		_render_list()
		if not _dirty:
			_render_main()


func _host() -> Node:
	var host: Variant = _props.get("host")
	if host is Node and is_instance_valid(host):
		return host
	return self


func _take_state(result: Dictionary, take_draft: bool) -> void:
	_rows = result.get("rows", [])
	_actor_count = int(result.get("actorCount", 0))
	var key := str(result.get("polityKey", ""))
	if take_draft:
		_selected_key = key
		_label = str(result.get("label", ""))
		_has_actor = bool(result.get("hasActor", false))
		_draft = (result.get("draft", {}) as Dictionary).duplicate(true)
		_loaded_draft = _draft.duplicate(true)
		_debug = result.get("debug", {})
	elif key == _selected_key:
		_has_actor = bool(result.get("hasActor", false))
		_debug = result.get("debug", {})


func _build_card() -> void:
	EditorKit.clear(self)
	var parts := PoliticalKit.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.08), 18, Vector4(14, 14, 14, 14), 0)
	add_child(parts[0])
	add_child(PoliticalKit.gap(15))
	_card_box = parts[1]


func _render_card() -> void:
	EditorKit.clear(_card_box)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 11)
	var texts := VBoxContainer.new()
	texts.add_theme_constant_override("separation", 3)
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.add_child(UI.label("Manual Political World authoring", 15, Color(1, 1, 1, 0.94), 800))
	texts.add_child(PoliticalKit.text("Set each country's starting Political World: government, leaders, parties, blocs, strategy, perceptions and political traits.", 11, Color(1, 1, 1, 0.5)))
	texts.add_child(PoliticalKit.gap(2))
	texts.add_child(UI.label("%d actor%s configured across %d scenario polities." % [_actor_count, "" if _actor_count == 1 else "s", _rows.size()], 10, Color(1, 1, 1, 0.38)))
	row.add_child(texts)
	var manage := PoliticalKit.action_button("Manage Political World", "raised")
	manage.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	manage.pressed.connect(_open_manager)
	row.add_child(manage)
	_card_box.add_child(row)


func _subtitle() -> String:
	return "%d Political World profile%s · %d scenario polities" % [_actor_count, "" if _actor_count == 1 else "s", _rows.size()]


func _open_manager() -> void:
	if _manager:
		return
	_manager = PoliticalManager.new("Scenario authoring", "Political World", _subtitle(), 1472.0, 736.0, 0.24, 240.0, "Close Political World manager")
	_host().add_child(_manager)
	_manager.close_requested.connect(_close_manager)
	_manager.escape_pressed.connect(func() -> void:
		if not _dirty:
			_dispose_manager())
	var search := PoliticalKit.input(_query, "Search polity...", func(value: String) -> void:
		_query = value
		_render_list())
	search.tooltip_text = "Search scenario polities"
	_manager.aside_top.add_child(search)
	_render_list()
	_render_main()


func _close_manager() -> void:
	if _dirty and not await EditorKit.ask(_host(), "Discard unsaved Political World edits?"):
		return
	_dispose_manager()


func _dispose_manager() -> void:
	if _manager:
		_manager.queue_free()
		_manager = null
	_open_states.clear()
	_dirty = false
	_message = ""
	_draft = _loaded_draft.duplicate(true)


func _render_list() -> void:
	if not _manager:
		return
	_manager.subtitle_label.text = _subtitle()
	EditorKit.clear(_manager.aside_list)
	var needle := PoliticalKit.clean(_query).to_lower()
	var shown := 0
	for entry in _rows:
		var row: Dictionary = entry
		var key := str(row.get("polityKey", ""))
		var label := str(row.get("label", ""))
		if not needle.is_empty() and not ("%s %s" % [label, key]).to_lower().contains(needle):
			continue
		shown += 1
		var has_actor := bool(row.get("hasActor", false))
		var badge := PoliticalKit.badge("SET" if has_actor else "+", Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.15) if has_actor else Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.12), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.26) if has_actor else Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.24), PoliticalKit.GREEN_SOFT if has_actor else PoliticalKit.AMBER_SOFT)
		var item := _manager.list_row(label, key, key == _selected_key, badge, func() -> void: _select_polity(key), true)
		item.tooltip_text = "Political World configured" if has_actor else "No Political World profile yet"
		_manager.aside_list.add_child(item)
	if shown == 0:
		var empty := UI.label("No polities match this search.", 12, Color(1, 1, 1, 0.4))
		empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		var holder := MarginContainer.new()
		holder.add_theme_constant_override("margin_top", 16)
		holder.add_theme_constant_override("margin_bottom", 16)
		holder.add_child(empty)
		_manager.aside_list.add_child(holder)


func _select_polity(key: String) -> void:
	if key == _selected_key:
		return
	if _dirty and not await EditorKit.ask(_host(), "Discard unsaved Political World edits for this polity?"):
		return
	var reply := await _engine.request("editor.politics.author.draft", {"scenarioId": _scenario_id, "polityKey": key})
	if not reply.get("ok", false) or not is_inside_tree():
		return
	_dirty = false
	_message = ""
	_take_state(reply["result"], true)
	_render_list()
	_render_main()


func _set_dirty() -> void:
	_dirty = true
	_message = ""
	_update_header()


func _edit(field: String, value: Variant) -> void:
	_draft[field] = value
	_set_dirty()


func _render_main() -> void:
	if not _manager:
		return
	var scroll_at := _manager.main_scroll.scroll_vertical
	_manager.clear_main()
	_trait_controls.clear()
	_traits_json_edit = null
	if _selected_key.is_empty():
		var empty := UI.label("This scenario has no editable polity roster yet.", 14, Color(1, 1, 1, 0.44))
		empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		var holder := MarginContainer.new()
		holder.add_theme_constant_override("margin_top", 48)
		holder.add_child(empty)
		_manager.main_body.add_child(holder)
		return
	_render_header()
	_message_holder = VBoxContainer.new()
	_manager.main_body.add_child(_message_holder)
	_update_message()
	_render_sections()
	_restore_scroll(scroll_at)


func _restore_scroll(value: int) -> void:
	await get_tree().process_frame
	if _manager:
		_manager.main_scroll.scroll_vertical = value


func _render_header() -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var texts := VBoxContainer.new()
	texts.add_theme_constant_override("separation", 3)
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var title_row := EditorKit.flow(7)
	title_row.add_child(UI.label(_label, 17, UI.WHITE, 850))
	var badge := PoliticalKit.badge(("Political World configured" if _has_actor else "Creates Political World profile on save").to_upper(), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.12) if _has_actor else Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.12), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.26) if _has_actor else Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.24), PoliticalKit.GREEN_SOFT if _has_actor else PoliticalKit.AMBER_SOFT)
	title_row.add_child(badge)
	texts.add_child(title_row)
	var key_row := HBoxContainer.new()
	key_row.add_theme_constant_override("separation", 4)
	key_row.add_child(UI.label("Stable polity key:", 10, Color(1, 1, 1, 0.4)))
	var key_label := UI.label(_selected_key, 10, Color(1, 1, 1, 0.4))
	key_label.add_theme_font_override("font", UI.font(400, "Consolas"))
	key_row.add_child(key_label)
	texts.add_child(key_row)
	var note := PoliticalKit.text("These are the scenario's starting political facts. Blank trait values stay unset rather than becoming 0, and Political World data this editor does not show is preserved.", 11, Color(1, 1, 1, 0.44))
	note.custom_minimum_size.x = 360
	texts.add_child(note)
	row.add_child(texts)
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 6)
	buttons.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	_delete_button = PoliticalKit.action_button("Delete Political World profile", "danger_text")
	_delete_button.pressed.connect(_delete_profile)
	buttons.add_child(_delete_button)
	_discard_button = PoliticalKit.action_button("Discard", "plain")
	_discard_button.pressed.connect(_discard)
	buttons.add_child(_discard_button)
	_save_button = PoliticalKit.action_button("Save Political World", "raised")
	_save_button.pressed.connect(_save)
	buttons.add_child(_save_button)
	row.add_child(buttons)
	_manager.main_header.add_child(row)
	_update_header()


func _update_header() -> void:
	if not is_instance_valid(_save_button):
		return
	PoliticalKit.set_enabled(_delete_button, _has_actor and not _busy, 0.45)
	PoliticalKit.set_enabled(_discard_button, _dirty and not _busy, 0.45)
	PoliticalKit.set_enabled(_save_button, _dirty and not _busy, 0.5)
	_save_button.text = "Saving..." if _busy else "Save Political World"
	_update_message()


func _update_message() -> void:
	if not is_instance_valid(_message_holder):
		return
	EditorKit.clear(_message_holder)
	if _message.is_empty():
		return
	var success := _message == "Political World saved." or _message == "Political World profile deleted."
	_message_holder.add_child(PoliticalKit.tone_box(_message, Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.08) if success else Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.09), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.2) if success else Color(239 / 255.0, 68 / 255.0, 68 / 255.0, 0.24), PoliticalKit.GREEN_INK if success else PoliticalKit.RED_INK, 11, 10, Vector4(10, 8, 10, 8)))


func _input_field(label: String, field: String, placeholder := "") -> Control:
	var input := PoliticalKit.input(str(_draft.get(field, "")), placeholder, func(value: String) -> void: _edit(field, value))
	return PoliticalKit.field(label, input)


func _number_field(label: String, field: String) -> Control:
	var input := PoliticalKit.number_input(str(_draft.get(field, "")), 0.0, 100.0, 0.1, func(value: String) -> void: _edit(field, value))
	return PoliticalKit.field(label, input)


func _textarea_field(label: String, field: String, placeholder := "", height := 96.0) -> Control:
	var area := PoliticalKit.area(str(_draft.get(field, "")), height, func(value: String) -> void: _edit(field, value), placeholder)
	return PoliticalKit.field(label, area)


func _select_field(label: String, field: String, empty_label: String, options: Array) -> Control:
	var all: Array = [["", empty_label]]
	all.append_array(options)
	var select := PoliticalKit.select(all, str(_draft.get(field, "")), func(value: String) -> void: _edit(field, value))
	return PoliticalKit.field(label, select)


func _section_note(text: String) -> Label:
	return PoliticalKit.text(text, 10, Color(1, 1, 1, 0.42))


func _render_sections() -> void:
	var government := PoliticalKit.remember(PoliticalKit.section("Government & political system", bool(_open_states.get("government", true))), _open_states, "government")
	_manager.main_body.add_child(government["panel"])
	var content: VBoxContainer = government["content"]
	content.add_child(PoliticalKit.gap(3))
	var grid := PoliticalKit.AutoGrid.new(208.0, 9.0)
	grid.add_child(_input_field("Government form", "governmentForm"))
	grid.add_child(_input_field("Government ideology", "governmentIdeology"))
	grid.add_child(_input_field("Head of state", "headOfState"))
	grid.add_child(_input_field("Head of government", "headOfGovernment"))
	grid.add_child(_input_field("Operative political leader", "politicalLeader"))
	grid.add_child(_input_field("Government status", "governmentStatus"))
	grid.add_child(_input_field("Coalition / cabinet name", "coalitionName"))
	grid.add_child(_input_field("Political system type", "politicalSystemType"))
	grid.add_child(_select_field("Representation model", "politicalRepresentation", "Auto / unspecified", _representations))
	grid.add_child(_select_field("Regime character", "regimeCharacter", "Unspecified", _regimes))
	grid.add_child(_number_field("Government approval / 100", "approval"))
	grid.add_child(_number_field("Political stability / 100", "politicalStability"))
	grid.add_child(_input_field("Public system label", "politicalSystemLabel"))
	content.add_child(grid)
	content.add_child(_textarea_field("Political-system notes", "politicalSystemNotes"))

	var outlook := PoliticalKit.remember(PoliticalKit.section("Strategic outlook", bool(_open_states.get("outlook", false))), _open_states, "outlook")
	_manager.main_body.add_child(outlook["panel"])
	var outlook_content: VBoxContainer = outlook["content"]
	outlook_content.add_child(_section_note("One item per line. These are canonical causal inputs, not flavor text."))
	var outlook_grid := PoliticalKit.AutoGrid.new(256.0, 9.0)
	outlook_grid.add_child(_textarea_field("Goals", "goalsText", "One goal per line"))
	outlook_grid.add_child(_textarea_field("Fears", "fearsText", "One fear per line"))
	outlook_grid.add_child(_textarea_field("Ambitions", "ambitionsText", "One ambition per line"))
	outlook_grid.add_child(_textarea_field("Domestic pressure notes", "domesticPressuresText", "One pressure per line"))
	outlook_content.add_child(outlook_grid)

	_parties_section = PoliticalKit.remember(PoliticalKit.section(_parties_title(), bool(_open_states.get("parties", false))), _open_states, "parties")
	_manager.main_body.add_child(_parties_section["panel"])
	_render_parties()

	_blocs_section = PoliticalKit.remember(PoliticalKit.section(_blocs_title(), bool(_open_states.get("blocs", false))), _open_states, "blocs")
	_manager.main_body.add_child(_blocs_section["panel"])
	_render_blocs()

	var traits := PoliticalKit.remember(PoliticalKit.section("Political traits · full supported catalog (%d)" % _traits.size(), bool(_open_states.get("traits", false))), _open_states, "traits")
	_manager.main_body.add_child(traits["panel"])
	var traits_content: VBoxContainer = traits["content"]
	traits_content.add_child(UI.rich("Every supported trait is shown. Blank means **not specified**, not 0. Values run from 0 to 100.", 10, Color(1, 1, 1, 0.44)))
	var traits_grid := PoliticalKit.AutoGrid.new(216.0, 8.0)
	for entry in _traits:
		traits_grid.add_child(_trait_card(entry))
	traits_content.add_child(traits_grid)

	var structured := PoliticalKit.remember(PoliticalKit.section("Advanced structured traits & perceptions", bool(_open_states.get("structured", false))), _open_states, "structured")
	_manager.main_body.add_child(structured["panel"])
	var structured_content: VBoxContainer = structured["content"]
	structured_content.add_child(_section_note("Raw JSON remains available for legacy or extension traits and structured perceptions. Registered traits stay synchronized with the controls above while this JSON is valid."))
	var structured_grid := PoliticalKit.AutoGrid.new(320.0, 9.0)
	_traits_json_edit = PoliticalKit.area(str(_draft.get("traitsJson", "{}")), 190, _edit_traits_json, "", true, 11)
	structured_grid.add_child(PoliticalKit.field("Traits JSON", _traits_json_edit))
	var perceptions := PoliticalKit.area(str(_draft.get("perceptionsJson", "{}")), 190, func(value: String) -> void: _edit("perceptionsJson", value), "", true, 11)
	structured_grid.add_child(PoliticalKit.field("Perceptions JSON", perceptions))
	structured_content.add_child(structured_grid)

	var debug := PoliticalKit.remember(PoliticalKit.section("Advanced saved state · read-only", bool(_open_states.get("debug", false))), _open_states, "debug")
	_manager.main_body.add_child(debug["panel"])
	var debug_content: VBoxContainer = debug["content"]
	debug_content.add_child(_section_note("This shows exactly what the scenario currently stores. Values calculated by the game are read-only here."))
	var debug_grid := PoliticalKit.AutoGrid.new(288.0, 9.0)
	debug_grid.add_child(PoliticalKit.field("Decision authority · derived", _pre(str(_debug.get("decisionAuthority", "null")), 208.0)))
	debug_grid.add_child(PoliticalKit.field("Behavioral disposition · derived now", _pre(str(_debug.get("derivedDisposition", "null")), 208.0)))
	debug_content.add_child(debug_grid)
	debug_content.add_child(PoliticalKit.field("Full saved Political World JSON", _pre(str(_debug.get("actor", "null")), 352.0)))


func _pre(text: String, max_height: float) -> TextEdit:
	var node := PoliticalKit.area(text, 34, Callable(), "", false, 12)
	node.editable = false
	var lines := text.count("\n") + 1
	node.custom_minimum_size.y = clampf(lines * 15.0 + 18.0, 34.0, max_height)
	return node


func _parties_title() -> String:
	return "Parties / political entities (%d)" % (_draft.get("parties", []) as Array).size()


func _blocs_title() -> String:
	return "Power blocs / non-party actors (%d)" % (_draft.get("powerBlocs", []) as Array).size()


func _party_title(party: Dictionary, index: int) -> String:
	var name := str(party.get("name", ""))
	var title := name if not name.is_empty() else "Political entity %d" % (index + 1)
	if bool(party.get("ruling", false)):
		title += " · Government"
	elif bool(party.get("coalition", false)):
		title += " · Coalition"
	return title


func _bloc_title(bloc: Dictionary, index: int) -> String:
	var name := str(bloc.get("name", ""))
	return name if not name.is_empty() else "Power bloc %d" % (index + 1)


func _entity_input(entity: Dictionary, label: String, field: String, on_change: Callable) -> Control:
	var input := PoliticalKit.input(str(entity.get(field, "")), "", func(value: String) -> void:
		entity[field] = value
		on_change.call()
		_set_dirty())
	return PoliticalKit.field(label, input)


func _entity_number(entity: Dictionary, label: String, field: String) -> Control:
	var input := PoliticalKit.number_input(str(entity.get(field, "")), 0.0, 100.0, 0.1, func(value: String) -> void:
		entity[field] = value
		_set_dirty())
	return PoliticalKit.field(label, input)


func _entity_area(entity: Dictionary, label: String, field: String) -> Control:
	var area := PoliticalKit.area(str(entity.get(field, "")), 64, func(value: String) -> void:
		entity[field] = value
		_set_dirty())
	return PoliticalKit.field(label, area)


func _render_parties() -> void:
	var content: VBoxContainer = _parties_section["content"]
	EditorKit.clear(content)
	PoliticalKit.set_section_title(_parties_section, _parties_title())
	content.add_child(_section_note("Ruling and coalition flags write to canonical government party IDs."))
	var parties: Array = _draft.get("parties", [])
	for index in range(parties.size()):
		var party: Dictionary = parties[index]
		var party_key := "party:" + str(party.get("_editorKey", index))
		var nested := PoliticalKit.remember(PoliticalKit.section(_party_title(party, index), bool(_open_states.get(party_key, false)), Color(1, 1, 1, 0.025), Color(1, 1, 1, 0.075), 10, Vector4(9, 8, 9, 9), 12, 800), _open_states, party_key)
		var refresh_title := func() -> void: PoliticalKit.set_section_title(nested, _party_title(party, index))
		var inner: VBoxContainer = nested["content"]
		var grid := PoliticalKit.AutoGrid.new(192.0, 8.0)
		for pair in [["Name", "name"], ["Short name", "shortName"], ["Leader", "leader"], ["Ideology", "ideology"], ["Influence label", "influenceLabel"]]:
			grid.add_child(_entity_input(party, str(pair[0]), str(pair[1]), refresh_title))
		grid.add_child(_entity_number(party, "Support (%)", "supportPercent"))
		grid.add_child(_entity_number(party, "Influence (%)", "influencePercent"))
		inner.add_child(grid)
		var flags := HBoxContainer.new()
		flags.add_theme_constant_override("separation", 13)
		var coalition_check := PoliticalKit.check("Coalition partner", bool(party.get("coalition", false)), Callable(), 11, UI.WHITE)
		var ruling_check := PoliticalKit.check("Ruling / government", bool(party.get("ruling", false)), Callable(), 11, UI.WHITE)
		coalition_check.disabled = bool(party.get("ruling", false))
		ruling_check.toggled.connect(func(on: bool) -> void:
			party["ruling"] = on
			coalition_check.disabled = on
			refresh_title.call()
			_set_dirty())
		coalition_check.toggled.connect(func(on: bool) -> void:
			party["coalition"] = on
			refresh_title.call()
			_set_dirty())
		flags.add_child(ruling_check)
		flags.add_child(coalition_check)
		inner.add_child(flags)
		var texts := PoliticalKit.AutoGrid.new(256.0, 9.0)
		texts.add_child(_entity_area(party, "Public description", "publicDescription"))
		texts.add_child(_entity_area(party, "Public priorities · one per line", "publicPrioritiesText"))
		texts.add_child(_entity_area(party, "Foreign-policy outlook · one per line", "publicForeignPolicyText"))
		inner.add_child(texts)
		var identity := PoliticalKit.section("Advanced identity", false, Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, Vector4(0, 0, 0, 0), 10, 750, Color(1, 1, 1, 0.5))
		(identity["content"] as VBoxContainer).add_child(_entity_input(party, "Stable party ID", "id", Callable(func() -> void: pass)))
		inner.add_child(identity["panel"])
		var remove := PoliticalKit.action_button("Remove political entity", "remove")
		remove.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		var at := index
		remove.pressed.connect(func() -> void:
			(_draft.get("parties", []) as Array).remove_at(at)
			_set_dirty()
			_render_parties())
		inner.add_child(remove)
		content.add_child(nested["panel"])
	var add := PoliticalKit.action_button("+ Add political entity", "plain")
	add.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	add.pressed.connect(func() -> void:
		if not _draft.has("parties"):
			_draft["parties"] = []
		(_draft["parties"] as Array).append(_empty_party())
		_set_dirty()
		_render_parties())
	content.add_child(add)


func _render_blocs() -> void:
	var content: VBoxContainer = _blocs_section["content"]
	EditorKit.clear(content)
	PoliticalKit.set_section_title(_blocs_section, _blocs_title())
	var blocs: Array = _draft.get("powerBlocs", [])
	for index in range(blocs.size()):
		var bloc: Dictionary = blocs[index]
		var bloc_key := "bloc:" + str(bloc.get("_editorKey", index))
		var nested := PoliticalKit.remember(PoliticalKit.section(_bloc_title(bloc, index), bool(_open_states.get(bloc_key, false)), Color(1, 1, 1, 0.025), Color(1, 1, 1, 0.075), 10, Vector4(9, 8, 9, 9), 12, 800), _open_states, bloc_key)
		var refresh_title := func() -> void: PoliticalKit.set_section_title(nested, _bloc_title(bloc, index))
		var inner: VBoxContainer = nested["content"]
		var grid := PoliticalKit.AutoGrid.new(192.0, 8.0)
		for pair in [["Name", "name"], ["Short name", "shortName"], ["Kind", "kind"], ["Status", "status"], ["Leader", "leader"], ["Ideology", "ideology"], ["Influence label", "influenceLabel"]]:
			grid.add_child(_entity_input(bloc, str(pair[0]), str(pair[1]), refresh_title))
		grid.add_child(_entity_number(bloc, "Influence (%)", "influencePercent"))
		inner.add_child(grid)
		var texts := PoliticalKit.AutoGrid.new(256.0, 9.0)
		texts.add_child(_entity_area(bloc, "Public description", "publicDescription"))
		texts.add_child(_entity_area(bloc, "Public priorities · one per line", "publicPrioritiesText"))
		texts.add_child(_entity_area(bloc, "Foreign-policy outlook · one per line", "publicForeignPolicyText"))
		inner.add_child(texts)
		var identity := PoliticalKit.section("Advanced identity", false, Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, Vector4(0, 0, 0, 0), 10, 750, Color(1, 1, 1, 0.5))
		(identity["content"] as VBoxContainer).add_child(_entity_input(bloc, "Stable bloc ID", "id", Callable(func() -> void: pass)))
		inner.add_child(identity["panel"])
		var remove := PoliticalKit.action_button("Remove power bloc", "remove")
		remove.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		var at := index
		remove.pressed.connect(func() -> void:
			(_draft.get("powerBlocs", []) as Array).remove_at(at)
			_set_dirty()
			_render_blocs())
		inner.add_child(remove)
		content.add_child(nested["panel"])
	var add := PoliticalKit.action_button("+ Add power bloc", "plain")
	add.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	add.pressed.connect(func() -> void:
		if not _draft.has("powerBlocs"):
			_draft["powerBlocs"] = []
		(_draft["powerBlocs"] as Array).append(_empty_bloc())
		_set_dirty()
		_render_blocs())
	content.add_child(add)


func _empty_party() -> Dictionary:
	var stamp := PoliticalKit.now_base36()
	return {
		"_editorKey": "party-editor:new:%s:%s" % [stamp, PoliticalKit.random_base36(5)],
		"_sourceId": "",
		"id": "custom-party-%s" % stamp,
		"name": "New political entity",
		"shortName": "",
		"leader": "",
		"ideology": "",
		"publicDescription": "",
		"publicPrioritiesText": "",
		"publicForeignPolicyText": "",
		"supportPercent": "",
		"influencePercent": "",
		"influenceLabel": "",
		"ruling": false,
		"coalition": false,
		"priorityField": "publicPriorities",
	}


func _empty_bloc() -> Dictionary:
	var stamp := PoliticalKit.now_base36()
	return {
		"_editorKey": "bloc-editor:new:%s:%s" % [stamp, PoliticalKit.random_base36(5)],
		"_sourceId": "",
		"id": "custom-bloc-%s" % stamp,
		"name": "New power bloc",
		"shortName": "",
		"kind": "",
		"status": "",
		"leader": "",
		"ideology": "",
		"publicDescription": "",
		"publicPrioritiesText": "",
		"publicForeignPolicyText": "",
		"influencePercent": "",
		"influenceLabel": "",
		"priorityField": "publicPriorities",
	}


func _trait_card(entry: Dictionary) -> Control:
	var key := str(entry.get("key", ""))
	var parts := PoliticalKit.box(Color(1, 1, 1, 0.025), Color(1, 1, 1, 0.07), 10, Vector4(9, 9, 9, 9), 5)
	var column: VBoxContainer = parts[1]
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 6)
	var caps := PoliticalKit.caps(str(entry.get("label", "")))
	caps.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(caps)
	var state := UI.label("", 9, Color(1, 1, 1, 0.34), 900)
	head.add_child(state)
	column.add_child(head)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 7)
	var minimum := float(entry.get("min", 0))
	var maximum := float(entry.get("max", 100))
	var slider := PoliticalKit.slider(minimum, minimum, maximum, 0.1)
	slider.tooltip_text = "%s slider" % str(entry.get("label", ""))
	row.add_child(slider)
	var number := PoliticalKit.number_input("", minimum, maximum, 0.1, Callable(), "unset")
	number.custom_minimum_size.x = 74
	number.size_flags_horizontal = Control.SIZE_SHRINK_END
	number.tooltip_text = "%s value" % str(entry.get("label", ""))
	row.add_child(number)
	column.add_child(row)
	column.add_child(PoliticalKit.text(str(entry.get("description", "")), 9, Color(1, 1, 1, 0.4)))
	var code := UI.label(key, 9, PoliticalKit.GREY_MUTED)
	code.add_theme_font_override("font", UI.font(400, "Consolas"))
	column.add_child(code)
	_trait_controls[key] = {"slider": slider, "input": number, "state": state, "min": minimum}
	slider.value_changed.connect(func(value: float) -> void:
		if _syncing:
			return
		_edit_trait(key, PoliticalKit.js_number(snappedf(value, 0.1))))
	number.text_changed.connect(func(_value: String) -> void:
		if _syncing:
			return
		_edit_trait(key, PoliticalKit.number_value(number.text), number))
	_sync_trait(key)
	return parts[0]


func _sync_trait(key: String, typing: Control = null) -> void:
	if not _trait_controls.has(key):
		return
	var controls: Dictionary = _trait_controls[key]
	var values: Dictionary = _draft.get("traitValues", {})
	var raw: Variant = values.get(key, "")
	var raw_text := "" if raw == null else str(raw)
	var is_set := not raw_text.is_empty()
	_syncing = true
	var number: LineEdit = controls["input"]
	if number != typing and number.text != raw_text:
		number.text = raw_text
	var slider: HSlider = controls["slider"]
	var parsed: Array = PoliticalKit.js_to_number(raw_text)
	slider.value = float(parsed[1]) if is_set and bool(parsed[0]) else float(controls["min"])
	_syncing = false
	var state: Label = controls["state"]
	state.text = "SET" if is_set else "UNSET"
	state.add_theme_color_override("font_color", PoliticalKit.GREEN_SOFT if is_set else Color(1, 1, 1, 0.34))


func _alias_key(value: String) -> String:
	var regex := RegEx.create_from_string("[^a-zA-Z0-9]+")
	return regex.sub(value, "", true).to_lower()


func _canonical_trait(value: String) -> String:
	return str(_trait_alias.get(_alias_key(value), ""))


func _normalize_trait(value: Variant) -> Variant:
	if value == null:
		return null
	if value is String and str(value).is_empty():
		return null
	var parsed: Array = PoliticalKit.js_to_number(value)
	if not bool(parsed[0]):
		return null
	var number := clampf(float(parsed[1]), 0.0, 100.0)
	return floorf(number * 10.0 + 0.5) / 10.0


func _edit_trait(key: String, value: String, typing: Control = null) -> void:
	if not _draft.has("traitValues") or not (_draft["traitValues"] is Dictionary):
		_draft["traitValues"] = {}
	(_draft["traitValues"] as Dictionary)[key] = value
	var source := str(_draft.get("traitsJson", "{}")) if PoliticalKit.js_truthy(_draft.get("traitsJson", "")) else "{}"
	source = source.strip_edges()
	if source.is_empty():
		source = "{}"
	var parsed: Array = PoliticalKit.parse_json(source)
	if bool(parsed[0]) and parsed[1] is Dictionary:
		var raw: Dictionary = parsed[1]
		for raw_key in raw.keys():
			if _canonical_trait(str(raw_key)) == key:
				raw.erase(raw_key)
		var normalized: Variant = _normalize_trait(value)
		if normalized != null:
			raw[key] = normalized
		_draft["traitsJson"] = PoliticalKit.js_stringify(raw)
		if _traits_json_edit:
			_syncing = true
			_traits_json_edit.text = str(_draft["traitsJson"])
			_syncing = false
	_sync_trait(key, typing)
	_set_dirty()


func _edit_traits_json(value: String) -> void:
	if _syncing:
		return
	_draft["traitsJson"] = value
	var source := value.strip_edges()
	if source.is_empty():
		source = "{}"
	var parsed: Array = PoliticalKit.parse_json(source)
	if bool(parsed[0]) and parsed[1] is Dictionary:
		var values := {}
		for entry in _traits:
			values[str((entry as Dictionary).get("key", ""))] = ""
		var raw: Dictionary = parsed[1]
		for raw_key in raw.keys():
			var key := _canonical_trait(str(raw_key))
			if key.is_empty():
				continue
			var normalized: Variant = _normalize_trait(raw[raw_key])
			if normalized != null:
				values[key] = PoliticalKit.js_number(float(normalized))
		_draft["traitValues"] = values
		for key in values.keys():
			_sync_trait(str(key))
	_set_dirty()


func _discard() -> void:
	_draft = _loaded_draft.duplicate(true)
	_dirty = false
	_message = ""
	_render_main()


func _save() -> void:
	if _scenario_id.is_empty() or _selected_key.is_empty() or _busy:
		return
	_busy = true
	_message = ""
	_update_header()
	var reply := await _engine.request("editor.politics.author.save", {"scenarioId": _scenario_id, "polityKey": _selected_key, "draft": _draft})
	_busy = false
	if not is_inside_tree():
		return
	if not reply.get("ok", false):
		_message = str(reply.get("error", "Could not save Political World."))
		_update_header()
		return
	var result: Dictionary = reply["result"]
	if bool(result.get("saved", false)):
		_take_state(result, true)
		_dirty = false
		_message = str(result.get("message", ""))
		_render_card()
		_render_list()
		_render_main()
		if result.get("details") is Dictionary:
			details_changed.emit(result["details"])
	else:
		_message = str(result.get("message", ""))
		_update_header()


func _delete_profile() -> void:
	if _scenario_id.is_empty() or _selected_key.is_empty() or not _has_actor or _busy:
		return
	var unsaved := "\n\nAny unsaved edits to this profile will also be discarded." if _dirty else ""
	if not await EditorKit.ask(_host(), "Delete the Political World profile for \"%s\"?\n\nThis does not delete the polity or its map territory.%s" % [_label, unsaved]):
		return
	_busy = true
	_message = ""
	_update_header()
	var reply := await _engine.request("editor.politics.author.delete", {"scenarioId": _scenario_id, "polityKey": _selected_key})
	_busy = false
	if not is_inside_tree():
		return
	if not reply.get("ok", false):
		_message = str(reply.get("error", "Could not delete Political World profile."))
		_update_header()
		return
	var result: Dictionary = reply["result"]
	if bool(result.get("saved", false)):
		_take_state(result, true)
		_dirty = false
		_message = str(result.get("message", ""))
		_render_card()
		_render_list()
		_render_main()
		if result.get("details") is Dictionary:
			details_changed.emit(result["details"])
	else:
		_message = str(result.get("message", ""))
		_update_header()
