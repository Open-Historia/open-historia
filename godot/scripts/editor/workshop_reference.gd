class_name WorkshopReference
extends WorkshopShell

var host: Workshop


func _init() -> void:
	super._init("Reference image", "image", 280.0, "left")


func setup(workshop: Workshop) -> void:
	host = workshop
	host.map.reference_adjust = true
	host.map.redraw()
	tree_exiting.connect(func() -> void:
		if is_instance_valid(host) and host.map:
			host.map.reference_adjust = false
			host.map.redraw())
	_render()


func _button(text: String, ink := Color(1, 1, 1)) -> Button:
	var node := WorkshopUI.base_button(text)
	var normal := UI.box(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.1), 10, 1, Vector4(8, 6, 8, 6))
	var hover := UI.box(Color(1, 1, 1, 0.08), Color(1, 1, 1, 0.18), 10, 1, Vector4(8, 6, 8, 6))
	WorkshopUI._flat_styles(node, normal, hover, hover, normal)
	WorkshopUI._ink(node, ink, 13.6, 400)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


func _render() -> void:
	clear_body()
	var reference: Dictionary = host.map.reference
	var upload := _button("⬆ Replace image" if not reference.is_empty() else "⬆ Upload reference image")
	upload.pressed.connect(_upload)
	body.add_child(upload)
	if not reference.is_empty():
		var opacity := WorkshopUI.number_field(float(reference.get("opacity", 0.5)), func(value: Variant) -> void:
			host.map.reference["opacity"] = clampf(float(value) if value != null else 0.5, 0.0, 1.0)
			host.map.redraw(), 76.0)
		body.add_child(WorkshopUI.row("Opacity", opacity))
		body.add_child(WorkshopUI.row("Visible", WorkshopUI.toggle(bool(reference.get("visible", true)), func(on: bool) -> void:
			host.map.reference["visible"] = on
			host.map.redraw())))
		var actions := HBoxContainer.new()
		actions.add_theme_constant_override("separation", 8)
		var centre := _button("Center on view")
		centre.pressed.connect(func() -> void: host.map.center_reference())
		actions.add_child(centre)
		var remove := _button("Remove", Color("#fca5a5"))
		remove.pressed.connect(func() -> void:
			host.map.reference = {}
			host.map.redraw()
			_render())
		actions.add_child(remove)
		body.add_child(actions)
		body.add_child(WorkshopUI.wrap("Drag inside the image to move it; drag a corner to resize (free stretch, so you can match the map projection). Close this panel to draw and edit through the image.", 11.0, Color(1, 1, 1, 0.55)))
	fit()


func _upload() -> void:
	var path := await EditorKit.pick_file(self, false, "", PackedStringArray(["*.png, *.jpg, *.jpeg, *.webp, *.gif, *.svg ; Images"]))
	if path.is_empty():
		return
	var image := WorkshopThumbnail.load_still(path)
	if image == null or image.get_width() <= 0 or image.get_height() <= 0:
		await host.alert("That file is not a readable image.")
		return
	var texture := ImageTexture.create_from_image(image)
	host.map.set_reference(texture, float(image.get_width()) / float(image.get_height()))
	_render()
