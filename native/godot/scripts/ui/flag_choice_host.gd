class_name FlagChoiceHost
extends Workshop

signal chosen(value: Variant)

var current: Variant = null
var dialog_parent: Node


func request_raw(method: String, args := {}) -> Dictionary:
	match method:
		"workshop.flags.catalog":
			return await engine.request("picker.flags.catalog", {"owner": str(args.get("owner", "")), "current": current})
		"workshop.polity.flag":
			var value: Variant = args.get("value")
			current = value
			chosen.emit(value)
			return {"ok": true, "result": {}}
		"workshop.flags.save":
			var reply: Dictionary = await engine.request("picker.flags.save", {"owner": str(args.get("owner", "")), "name": str(args.get("name", "")), "dataUrl": str(args.get("dataUrl", ""))})
			if reply.get("ok", false):
				current = str(args.get("dataUrl", ""))
				chosen.emit(current)
			return reply
	return await engine.request(method, args)


func request(method: String, args := {}) -> Dictionary:
	var reply := await request_raw(method, args)
	if not reply.get("ok", false):
		await alert(str(reply.get("error", "Something went wrong.")))
		return {}
	var result: Variant = reply.get("result")
	return result if result is Dictionary else {}


func alert(text: String) -> void:
	await EditorKit.tell(_dialog_host(), text)


func confirm(text: String) -> bool:
	return await EditorKit.ask(_dialog_host(), text)


func _dialog_host() -> Node:
	return dialog_parent if dialog_parent and is_instance_valid(dialog_parent) else self
