extends SceneTree


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var column := VBoxContainer.new()
	column.position = Vector2(100, 100)
	column.size = Vector2(1270, 10)
	root.add_child(column)
	var banner := CommunityKit.banner("Imported \"Modern Day\" — it's in your Scenarios tab. Enjoyed it? Open its hub post (👍 Like ↗) and hit 👍 to like or 💬 to comment.", false)
	column.add_child(CommunityKit.margin_below(banner, 14))
	var label := banner.get_child(0) as Label
	for frame in range(8):
		await process_frame
		print("frame %d label size=%s min=%s custom=%s lines=%d visible=%d" % [frame, label.size, label.get_combined_minimum_size(), label.custom_minimum_size, label.get_line_count(), label.get_visible_line_count()])
	quit(0)
